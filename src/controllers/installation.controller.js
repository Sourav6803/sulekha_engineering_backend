// src/controllers/installation.controller.js
import { Installation, Customer, Material, Application, User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { installationService } from '../services/installation.service.js';
import { bomTemplateService } from '../services/bomTemplate.service.js';
import { pdfService } from '../services/pdf.service.js';
import { excelService } from '../services/excel.service.js';
import logger from '../utils/logger.js';
import { redisGet, redisSet, redisDel } from '../config/redis.js';
import { isInstallationCrew } from '../data/rolePermissions.js';
import { removeDocument, storeDocument } from '../services/documentStorage.service.js';

const CACHE_TTL = 3600; // 1 hour

/**
 * List all installations with pagination and filters
 */
export const listInstallations = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    customer,
    status,
    roofType,
    dateFrom,
    dateTo,
    search,
    sortBy = 'installDate',
    sortOrder = 'desc',
  } = req.query;

  // Build filter
  const filter = { isActive: true };

  /*
   * The crew sees the jobs they are on, not the whole company's.
   *
   * A fitter opening the list on a phone should not have to scroll past forty
   * jobs in three districts to find the one he is driving to. Admin and manager
   * still see everything.
   */
  if (isInstallationCrew(req.user)) {
    filter['teamAssigned.member'] = req.user._id;
  }

  if (customer) filter.customer = customer;
  if (status) filter.status = status;
  if (roofType) filter.roofType = roofType;

  // Date range
  if (dateFrom || dateTo) {
    filter.installDate = {};
    if (dateFrom) filter.installDate.$gte = new Date(dateFrom);
    if (dateTo) filter.installDate.$lte = new Date(dateTo);
  }

  // Search
  if (search) {
    filter.$or = [
      { installationId: { $regex: search, $options: 'i' } },
      { projectNo: { $regex: search, $options: 'i' } },
      { quotationNo: { $regex: search, $options: 'i' } },
    ];
  }

  // Build sort
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Execute query
  const [installations, total] = await Promise.all([
    Installation.find(filter)
      .populate('customer', 'name phone customerId address')
      .populate('teamAssigned.member', 'name email')
      .populate('createdBy', 'name email')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Installation.countDocuments(filter),
  ]);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  return ApiResponse.sendPaginated(res, installations, pagination, 'Installations fetched successfully');
};

/**
 * Get installation by ID
 */
export const getInstallation = async (req, res) => {
  const { id } = req.params;

  const installation = await Installation.findById(id)
    .populate('customer', 'name phone customerId address city state pincode')
    .populate('materialsUsed.material', 'name materialCode unit description category')
    .populate('teamAssigned.member', 'name email phone')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email')
    .lean();

  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  return ApiResponse.send(res, installation, 'Installation fetched successfully');
};

/**
 * Applications that can become an installation.
 *
 * "Application bana hua hai, installation nahi hua hai" — that is the only list
 * the office should be choosing from. An application whose customer already has
 * an active installation is left out, because a second one is refused anyway and
 * offering it only produces a 409 at the end of the form.
 *
 * The quotation number, system size and roof type travel with the row: the form
 * shows them read-only, so the installation cannot end up disagreeing with the
 * paperwork it is built from.
 */
export const listInstallableApplications = async (req, res) => {
  const installedCustomers = await Installation.distinct('customer', { isActive: true });

  const applications = await Application.find({
    isActive: true,
    status: { $nin: ['rejected'] },
    customer: { $nin: installedCustomers },
  })
    .select('applicationNo consumerName phone customer siteType deal quotation status')
    .populate('customer', 'name phone customerId')
    .populate('quotation', 'quotationNo totalAmount')
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();

  const data = applications.map((application) => ({
    _id: application._id,
    applicationNo: application.applicationNo,
    applicationStatus: application.status,
    customer: application.customer,
    consumerName: application.consumerName || application.customer?.name || '',
    phone: application.phone || application.customer?.phone || '',
    customerId: application.customer?.customerId || '',
    /** What the installation will be created as — read-only on the form. */
    systemSizeKW: application.deal?.systemSizeKW ?? null,
    roofType: application.siteType ?? null,
    quotationNo: application.quotation?.quotationNo ?? null,
  }));

  // `ApiResponse.success` only *builds* the body — it never writes the response,
  // and using it here left the request open until the client gave up.
  return ApiResponse.send(res, data, 'Installable applications fetched successfully');
};

/**
 * Create new installation
 */
export const createInstallation = async (req, res) => {
  const { customer, systemSizeKW, roofType, application: applicationId, ...rest } = req.body;

  /*
   * When the office picks an application, the application is the source of truth
   * for the customer, the system size, the roof type and the quotation number.
   * Anything sent in those fields is ignored rather than validated: the form
   * shows them read-only, and a stale tab must not be able to write a size the
   * consumer never agreed to.
   */
  const application = applicationId
    ? await Application.findById(applicationId).populate('quotation', 'quotationNo')
    : null;
  if (applicationId && !application) {
    throw ApiError.notFound('Application');
  }

  const resolvedCustomer = application ? application.customer : customer;

  // Check if customer exists
  const customerData = await Customer.findById(resolvedCustomer);
  if (!customerData) {
    throw ApiError.notFound('Customer');
  }

  // A customer can only have one active installation
  const existingInstallation = await Installation.findOne({
    customer: resolvedCustomer,
    isActive: true,
  });
  if (existingInstallation) {
    throw ApiError.conflict(
      `This customer already has an installation (${existingInstallation.installationId}). ` +
      'Each customer can only have one installation.'
    );
  }

  // Generate installation ID and, serially, the project number.
  const installationId = await Installation.generateInstallationId();
  const projectNo = await Installation.generateProjectNo();

  const resolvedSystemSizeKW = application
    ? application.deal?.systemSizeKW ?? systemSizeKW
    : systemSizeKW;
  const resolvedRoofType = application ? application.siteType ?? roofType : roofType;
  const resolvedQuotationNo = application
    ? application.quotation?.quotationNo ?? rest.quotationNo
    : rest.quotationNo;

  if (resolvedSystemSizeKW == null) {
    throw ApiError.validation('The application does not carry a system size', {
      systemSizeKW: 'Set the system size on the application first.',
    });
  }
  if (!resolvedRoofType) {
    throw ApiError.validation('The application does not carry a site type', {
      roofType: 'Set the site type on the application first.',
    });
  }

  // Get suggested BOM
  const suggestedMaterials = await bomTemplateService.getSuggestedBOM(
    resolvedRoofType,
    resolvedSystemSizeKW
  );

  // Analyze load
  const loadAnalysis = await installationService.analyzeLoad(resolvedSystemSizeKW);

  // Create installation
  const installation = await Installation.create({
    ...rest,
    customer: resolvedCustomer,
    application: application?._id,
    projectNo,
    quotationNo: resolvedQuotationNo,
    systemSizeKW: resolvedSystemSizeKW,
    roofType: resolvedRoofType,
    installationId,
    customerNameSnapshot: customerData.name,
    customerPhoneSnapshot: customerData.phone,
    suggestedMaterials,
    totalLoad: loadAnalysis.recommendedInverterKW,
    inverterCapacity: loadAnalysis.recommendedInverterKW,
    canRunSubmersible: loadAnalysis.submersibleCanRun,
    loadAnalysisDetails: loadAnalysis,
    createdBy: req.userId,
    updatedBy: req.userId,
  });

  logger.info(`Installation created: ${installation.installationId} for ${customerData.name}`);

  return ApiResponse.sendCreated(res, {
    installation,
    suggestedMaterials,
    loadAnalysis,
  }, 'Installation created successfully');
};

/**
 * Update installation
 */
export const updateInstallation = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  // Check if installation exists
  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Check if installation can be updated
  if (installation.status === 'completed') {
    throw ApiError.badRequest('Cannot update a completed installation');
  }

  if (installation.status === 'cancelled') {
    throw ApiError.badRequest('Cannot update a cancelled installation');
  }

  // Update installation
  Object.assign(installation, updateData);
  installation.updatedBy = req.userId;
  await installation.save();

  // Invalidate cache
  await redisDel(`installation:${id}`);
  await redisDel('installations:list:*');

  logger.info(`Installation updated: ${installation.installationId}`);

  return ApiResponse.send(res, installation, 'Installation updated successfully');
};

/**
 * Delete installation (soft delete)
 */
export const deleteInstallation = async (req, res) => {
  const { id } = req.params;

  // Check if installation exists
  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Check if installation has materials assigned
  const hasMaterials = installation.materialsUsed.some(m => m.status === 'installed');
  if (hasMaterials) {
    throw ApiError.conflict('Cannot delete installation with assigned materials. Reverse materials first.');
  }

  // Soft delete
  installation.isActive = false;
  installation.status = 'cancelled';
  installation.updatedBy = req.userId;
  await installation.save();

  // Invalidate cache
  await redisDel(`installation:${id}`);
  await redisDel('installations:list:*');

  logger.info(`Installation deleted: ${installation.installationId}`);

  return ApiResponse.send(res, null, 'Installation deleted successfully');
};

/**
 * Assign materials to installation
 */
export const assignMaterials = async (req, res) => {
  const { id } = req.params;
  const { items, idempotencyKey } = req.body;

  // Check if installation exists
  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Check if installation can accept materials
  if (installation.status === 'completed') {
    throw ApiError.badRequest('Cannot assign materials to a completed installation');
  }

  if (installation.status === 'cancelled') {
    throw ApiError.badRequest('Cannot assign materials to a cancelled installation');
  }

  // Assign materials
  const updatedInstallation = await installationService.assignMaterials(
    id,
    items,
    idempotencyKey,
    req.userId
  );

  // Invalidate cache
  await redisDel(`installation:${id}`);
  await redisDel('installations:list:*');

  logger.info(`Materials assigned to installation: ${installation.installationId}`);

  return ApiResponse.send(res, updatedInstallation, 'Materials assigned successfully');
};

/**
 * Reverse material assignment
 */
export const reverseMaterial = async (req, res) => {
  const { id, usageId } = req.params;
  const { reason } = req.body;

  // Check if installation exists
  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Reverse material
  const updatedInstallation = await installationService.reverseAssignment(
    id,
    usageId,
    reason,
    req.userId
  );

  // Invalidate cache
  await redisDel(`installation:${id}`);
  await redisDel('installations:list:*');

  logger.info(`Material reversed for installation: ${installation.installationId}`);

  return ApiResponse.send(res, updatedInstallation, 'Material reversed successfully');
};

/**
 * Generate BOM PDF
 */
export const generateBOMPDF = async (req, res) => {
  const { id } = req.params;
  const { variant = 'final' } = req.query;
  const safeVariant = variant === 'suggested' ? 'suggested' : 'final';

  // Check if installation exists
  const installation = await Installation.findById(id)
    .populate('customer', 'name phone gstNumber address city state pincode')
    .populate('materialsUsed.material', 'name materialCode unit description category')
    .lean();

  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Suggested BOM requires the stored suggested list; final requires usage.
  if (safeVariant === 'final' && (!installation.materialsUsed || installation.materialsUsed.length === 0)) {
    throw ApiError.badRequest('No materials confirmed to generate a final BOM');
  }
  if (safeVariant === 'suggested' && !installation.suggestedMaterials) {
    throw ApiError.badRequest('No suggested BOM available for this installation');
  }

  // Generate PDF
  const pdfBuffer = await pdfService.generateBOMPDF(installation, safeVariant);

  // Set response headers
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="BOM-${installation.installationId}-${safeVariant}.pdf"`
  );
  res.setHeader('Content-Length', pdfBuffer.length);

  return res.send(pdfBuffer);
};

/**
 * Generate BOM Excel
 */
export const generateBOMExcel = async (req, res) => {
  const { id } = req.params;
  const { variant = 'suggested' } = req.query;
  const safeVariant = variant === 'final' ? 'final' : 'suggested';

  const installation = await Installation.findById(id)
    .populate('customer', 'name phone gstNumber address city state pincode')
    .lean();

  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  const excelBuffer = await excelService.generateBOMExcel(installation, safeVariant);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="BOM-${installation.installationId}-${safeVariant}.xlsx"`
  );
  res.setHeader('Content-Length', excelBuffer.length);

  return res.send(excelBuffer);
};

/**
 * Update installation status
 */
export const updateInstallationStatus = async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  // Check if installation exists
  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // Update status
  installation.status = status;
  if (notes) installation.notes = notes;
  installation.updatedBy = req.userId;

  if (status === 'completed') {
    installation.completionDate = new Date();
    // Calculate total cost
    await installation.calculateTotalCost();
  }

  await installation.save();

  // Invalidate cache
  await redisDel(`installation:${id}`);
  await redisDel('installations:list:*');

  logger.info(`Installation status updated: ${installation.installationId} -> ${status}`);

  return ApiResponse.send(res, installation, 'Installation status updated successfully');
};

/**
 * Get load analysis
 */
export const getLoadAnalysis = async (req, res) => {
  const { id } = req.params;

  const installation = await Installation.findById(id);
  if (!installation) {
    throw ApiError.notFound('Installation');
  }

  // If load analysis not performed, calculate it
  let loadAnalysis = installation.loadAnalysisDetails;
  if (!loadAnalysis) {
    loadAnalysis = await installationService.analyzeLoad(installation.systemSizeKW);
    // Update installation with analysis
    installation.loadAnalysisDetails = loadAnalysis;
    installation.totalLoad = loadAnalysis.recommendedInverterKW;
    installation.inverterCapacity = loadAnalysis.recommendedInverterKW;
    installation.canRunSubmersible = loadAnalysis.submersibleCanRun;
    await installation.save();
  }

  return ApiResponse.send(res, {
    installationId: installation.installationId,
    systemSizeKW: installation.systemSizeKW,
    loadAnalysis,
  }, 'Load analysis fetched successfully');
};

/**
 * Get suggested BOM
 */
export const getSuggestedBOM = async (req, res) => {
  const { roofType, systemSizeKW } = req.query;

  const suggestedMaterials = await bomTemplateService.getSuggestedBOM(
    roofType,
    parseFloat(systemSizeKW)
  );

  return ApiResponse.send(res, {
    roofType,
    systemSizeKW: parseFloat(systemSizeKW),
    materials: suggestedMaterials,
  }, 'Suggested BOM generated successfully');
};

// ===========================================================================
// Evidence — what the crew records on site
// ===========================================================================

const EVIDENCE_SLOTS = ['panels', 'meter', 'inverter', 'marketing'];

/**
 * Everything still missing before the job can be called complete.
 *
 * Aimed at a phone, on a roof: it names each gap in the order the crew fills
 * them, so the list reads as a job sheet rather than a validation dump.
 */
export const evidenceGaps = (installation) => {
  const gaps = [];
  const panels = installation.panelUnits ?? [];

  if (panels.length === 0) {
    gaps.push('Add the panels and their serial numbers');
  } else {
    const noSerial = panels.filter((panel) => !String(panel.serial || '').trim()).length;
    const noPhoto = panels.filter((panel) => !panel.photoUrl).length;
    if (noSerial) gaps.push(`${noSerial} panel(s) without a serial number`);
    if (noPhoto) gaps.push(`${noPhoto} panel(s) without a photograph`);
  }

  if (!installation.sitePhotos?.panels?.url) gaps.push('Site photo of the panels');
  if (!installation.sitePhotos?.meter?.url) gaps.push('Site photo with the new meter');
  if (!installation.inverter?.brand) gaps.push('Inverter brand');
  if (!installation.inverter?.serial) gaps.push('Inverter serial number');
  if (!installation.inverter?.photoUrl) gaps.push('Photograph of the inverter');

  return gaps;
};

/** GET /:id/evidence-gaps — the same list, for the screen to show up front. */
export const getEvidenceGaps = async (req, res) => {
  const installation = await Installation.findById(req.params.id);
  if (!installation) throw ApiError.notFound('Installation');

  return ApiResponse.send(
    res,
    { gaps: evidenceGaps(installation), complete: evidenceGaps(installation).length === 0 },
    'Evidence checked'
  );
};

/**
 * POST /:id/panels — add one panel row, or `count` empty rows.
 *
 * The form seeds the row count from system size ÷ panel wattage, then the crew
 * adds or removes rows to match the pallet they actually carried up.
 */
export const addPanelUnit = async (req, res) => {
  const installation = await Installation.findById(req.params.id);
  if (!installation) throw ApiError.notFound('Installation');

  const count = Number(req.body.count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 60) {
    throw ApiError.validation('Add between 1 and 60 panels at a time', {
      count: 'Panel count must be a whole number up to 60.',
    });
  }

  const serial = String(req.body.serial ?? '').trim().slice(0, 60);

  if (count === 1) {
    installation.panelUnits.push({ serial });
  } else {
    for (let index = 0; index < count; index += 1) {
      installation.panelUnits.push({ serial: '' });
    }
  }

  await installation.save();

  return ApiResponse.send(
    res,
    { panelUnits: installation.panelUnits },
    count === 1 ? 'Panel added' : `${count} panels added`
  );
};

/** PATCH /:id/panels/:panelId — the serial, typed off the sticker on the roof. */
export const updatePanelUnit = async (req, res) => {
  const installation = await Installation.findById(req.params.id);
  if (!installation) throw ApiError.notFound('Installation');

  const panel = installation.panelUnits.id(req.params.panelId);
  if (!panel) throw ApiError.notFound('Panel');

  panel.serial = String(req.body.serial ?? '').trim().slice(0, 60);
  await installation.save();

  return ApiResponse.send(res, { panelUnits: installation.panelUnits }, 'Panel serial saved');
};

/** DELETE /:id/panels/:panelId */
export const removePanelUnit = async (req, res) => {
  const installation = await Installation.findById(req.params.id);
  if (!installation) throw ApiError.notFound('Installation');

  const panel = installation.panelUnits.id(req.params.panelId);
  if (!panel) throw ApiError.notFound('Panel');

  // The photograph goes with the row; leaving it behind would quietly fill the
  // bucket with images nothing points at.
  await removeDocument({ url: panel.photoUrl, publicId: panel.photoPublicId }).catch(() => undefined);
  panel.deleteOne();
  await installation.save();

  return ApiResponse.send(res, { panelUnits: installation.panelUnits }, 'Panel removed');
};

/** PATCH /:id/inverter — brand and serial of the unit that went in. */
export const updateInverter = async (req, res) => {
  const installation = await Installation.findById(req.params.id);
  if (!installation) throw ApiError.notFound('Installation');

  if (req.body.brand !== undefined) {
    installation.inverter.brand = String(req.body.brand).trim().slice(0, 80);
  }
  if (req.body.serial !== undefined) {
    installation.inverter.serial = String(req.body.serial).trim().slice(0, 60);
  }

  /*
   * The rating of the unit that actually went on the wall.
   *
   * It is stored on the installation rather than inside `inverter` because the
   * summary header and the quotation already read `inverterCapacity`; a second
   * copy under `inverter` would drift the first time one of them was edited.
   * Empty clears it.
   */
  if (req.body.capacityKW !== undefined) {
    if (req.body.capacityKW === null || req.body.capacityKW === '') {
      installation.inverterCapacity = undefined;
    } else {
      const capacity = Number(req.body.capacityKW);
      if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 100) {
        throw ApiError.validation('Inverter capacity must be between 0 and 100 kW', {
          capacityKW: 'Enter the inverter rating in kW',
        });
      }
      installation.inverterCapacity = capacity;
    }
  }

  await installation.save();

  return ApiResponse.send(res, { inverter: installation.inverter }, 'Inverter saved');
};

/**
 * POST /:id/evidence-photo — one file, one slot.
 *
 * `slot` is `panels` | `meter` | `inverter` | `marketing`, or `panel` with a
 * `panelId`. Four near-identical upload routes would have been four places for
 * the folder naming to drift.
 */
export const uploadEvidencePhoto = async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded');

  const installation = await Installation.findById(req.params.id);
  if (!installation) throw ApiError.notFound('Installation');

  const slot = String(req.body.slot || '');
  const folder = `sulekha/installations/${installation.installationId}/evidence`;
  const stored = await storeDocument(req.file, { folder });

  if (slot === 'panel') {
    const panel = installation.panelUnits.id(req.body.panelId);
    if (!panel) throw ApiError.notFound('Panel');

    await removeDocument({ url: panel.photoUrl, publicId: panel.photoPublicId }).catch(() => undefined);
    panel.photoUrl = stored.url;
    panel.photoPublicId = stored.publicId;
    panel.photoFileName = stored.fileName;
  } else if (slot === 'inverter') {
    await removeDocument({
      url: installation.inverter?.photoUrl,
      publicId: installation.inverter?.photoPublicId,
    }).catch(() => undefined);
    installation.inverter.photoUrl = stored.url;
    installation.inverter.photoPublicId = stored.publicId;
    installation.inverter.photoFileName = stored.fileName;
  } else if (EVIDENCE_SLOTS.includes(slot)) {
    const previous = installation.sitePhotos?.[slot];

    await removeDocument({ url: previous?.url, publicId: previous?.publicId }).catch(() => undefined);
    installation.sitePhotos[slot] = {
      url: stored.url,
      publicId: stored.publicId,
      fileName: stored.fileName,
      uploadedAt: new Date(),
    };
  } else {
    throw ApiError.validation('Unknown photo slot', {
      slot: 'Use panels, meter, inverter, marketing or panel.',
    });
  }

  await installation.save();

  return ApiResponse.send(res, installation, 'Photo saved');
};

/**
 * PATCH /:id/complete — the only way to "completed", and it checks the evidence.
 *
 * The status endpoint will happily move a job to `completed` from a dropdown; this
 * one refuses until every panel has a serial and a photograph, both site photos
 * exist, and the inverter is recorded. That is the difference between a job being
 * marked done and a job being documented.
 */
export const completeInstallation = async (req, res) => {
  const installation = await Installation.findById(req.params.id);
  if (!installation) throw ApiError.notFound('Installation');

  const gaps = evidenceGaps(installation);
  if (gaps.length > 0) {
    throw ApiError.validation(`The installation is not documented yet: ${gaps.join('; ')}.`, {
      evidence: gaps.join('; '),
    });
  }

  installation.status = 'completed';
  installation.completionDate = installation.completionDate || new Date();
  await installation.save();

  logger.info(
    { installationId: installation.installationId, panels: installation.panelUnits.length },
    'Installation completed with evidence'
  );

  return ApiResponse.send(res, installation, 'Installation completed');
};

// ===========================================================================
// The crew
// ===========================================================================

/** GET /team-candidates — the people a crew can be built from. */
export const listTeamCandidates = async (req, res) => {
  /*
   * Crew only — not every account that happens to be an `agent`.
   *
   * The installers already in the database carry `role: 'agent'` and
   * `department: 'installation'`, so the query has to read the department as well.
   * Listing plain sales agents here used to fill the picker with people who would
   * never be sent to a roof.
   */
  const users = await User.find({
    isActive: true,
    $or: [{ role: 'installation_team' }, { role: 'agent', department: 'installation' }],
  })
    .select('name email phone role employeeId department')
    .sort({ name: 1 })
    .lean();

  return ApiResponse.send(res, users, 'Team candidates fetched');
};

/**
 * POST /:id/team — replace the crew on a job.
 *
 * Replaces rather than appends: the office is editing one list, and "who is on
 * this job" has a single true answer. Removing somebody does not delete their
 * evidence — it is already on the record under their name.
 */
export const setInstallationTeam = async (req, res) => {
  const installation = await Installation.findById(req.params.id);
  if (!installation) throw ApiError.notFound('Installation');

  const members = Array.isArray(req.body.members) ? req.body.members : [];
  if (members.length > 12) {
    throw ApiError.validation('A crew of twelve is the limit', {
      members: 'Remove somebody before adding more.',
    });
  }

  const ids = [...new Set(members.map((entry) => String(entry?.member ?? '')).filter(Boolean))];

  if (ids.length !== members.length) {
    throw ApiError.validation('The same person is listed twice', {
      members: 'Each crew member appears once.',
    });
  }

  const people = await User.find({ _id: { $in: ids }, isActive: true }).select('_id role').lean();
  if (people.length !== ids.length) {
    throw ApiError.validation('One of the crew members does not exist', {
      members: 'Reload the list and pick again.',
    });
  }

  const roles = ['lead', 'technician', 'helper', 'supervisor'];

  installation.teamAssigned = members.map((entry) => ({
    member: entry.member,
    role: roles.includes(entry.role) ? entry.role : 'technician',
    assignedAt: new Date(),
  }));

  await installation.save();

  return ApiResponse.send(res, { teamAssigned: installation.teamAssigned }, 'Crew updated');
};

/**
 * GET /dashboard — the installation board.
 *
 * For the crew the numbers are their own jobs; for the office they are the whole
 * pipeline. The "evidence pending" count is the one that matters on a phone: a
 * finished roof with two panels left unphotographed is a job that cannot be
 * closed, and nobody remembers which ones those are by evening.
 */
export const getInstallationDashboard = async (req, res) => {
  const mine = isInstallationCrew(req.user);
  const scope = mine ? { 'teamAssigned.member': req.user._id } : {};

  const activeFilter = { isActive: true, status: { $nin: ['completed', 'cancelled'] }, ...scope };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [active, today, completedThisMonth, activeJobs] = await Promise.all([
    Installation.countDocuments(activeFilter),
    Installation.countDocuments({
      ...activeFilter,
      installDate: { $gte: startOfToday, $lt: endOfToday },
    }),
    Installation.countDocuments({
      isActive: true,
      status: 'completed',
      completionDate: { $gte: startOfMonth },
      ...scope,
    }),
    Installation.find(activeFilter)
      .select(
        'installationId projectNo customerNameSnapshot customer installDate status systemSizeKW panelUnits sitePhotos inverter'
      )
      .populate('customer', 'name')
      .sort({ installDate: 1 })
      // The count of jobs still missing evidence is taken over every active job, so
      // this is a bound on the answer rather than a page of ten.
      .limit(200)
      .lean(),
  ]);

  const jobs = activeJobs.map((job) => {
    const gaps = evidenceGaps(job);
    return {
      _id: job._id,
      installationId: job.installationId,
      projectNo: job.projectNo,
      // Older records were made straight from a customer and carry no snapshot.
      consumerName: job.customerNameSnapshot || job.customer?.name,
      installDate: job.installDate,
      status: job.status,
      systemSizeKW: job.systemSizeKW,
      gaps: gaps.length,
    };
  });

  return ApiResponse.send(
    res,
    {
      scope: mine ? 'mine' : 'all',
      counts: {
        active,
        today,
        evidencePending: jobs.filter((job) => job.gaps > 0).length,
        completedThisMonth,
      },
      // The board shows the next ten; the numbers above are the whole truth.
      jobs: jobs.slice(0, 10),
    },
    'Installation dashboard fetched'
  );
};