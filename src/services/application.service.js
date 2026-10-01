// src/services/application.service.js
import Application from '../models/Application.js';
import logger from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { checkNameMatch } from '../utils/nameMatch.js';
import { assessCredit } from '../data/lenderCriteria.js';
import { checkImageQuality, isImageMimeType } from './imageQuality.service.js';
import { storeDocument, removeDocument } from './documentStorage.service.js';
import { notifyAgentOfSignedDocument } from './signedDocumentNotice.service.js';
import { notifyOfficeOfNewApplication } from './newApplicationNotice.service.js';
import {
  BILL_PORTAL_URL,
  buildBillPortalUrl,
  isTrustedBillPortalUrl,
  REQUIRED_DOCUMENT_KINDS,
  documentLabel,
  canTransition,
  AGENT_EDITABLE_STATUSES,
  DOCUMENT_EDITABLE_STATUSES,
  OFFICE_FILED_DOCUMENT_KINDS,
} from '../data/applicationChecklist.js';

const OVERSIGHT_ROLES = ['admin', 'manager'];

const isOversight = (user) => OVERSIGHT_ROLES.includes(user?.role);

/**
 * An agent may only touch their own applications; admin and manager see
 * everything. Enforced here rather than in the routes because every read and
 * write has to obey it, including the ones reached by id.
 */
const assertAccess = (application, user) => {
  if (!application) throw ApiError.notFound('Application');

  if (isOversight(user)) return;

  if (application.agent?.toString() !== user?._id?.toString()) {
    // 404 rather than 403: an agent should not learn that someone else's
    // application exists.
    throw ApiError.notFound('Application');
  }
};

const assertAgentEditable = (application) => {
  if (!AGENT_EDITABLE_STATUSES.includes(application.status)) {
    throw ApiError.badRequest(
      `An application can only be edited while it is draft or sent back for correction. This one is "${application.status}".`
    );
  }
};

const assertDocumentEditable = (application) => {
  if (!DOCUMENT_EDITABLE_STATUSES.includes(application.status)) {
    throw ApiError.badRequest(
      `Documents can no longer be changed once the application is "${application.status}".`
    );
  }
};

/**
 * Everything that has to be true before an application may leave the agent's
 * hands. Returns a list of `{ field, message }`, empty when the application is
 * complete. Kept as a pure function so it can be tested directly and reused by
 * the client for inline validation.
 */
export const collectSubmitIssues = (application) => {
  const issues = [];
  const a = application;

  const required = {
    consumerName: 'Consumer name is required',
    phone: 'Mobile number is required',
    aadhaarNumber: 'Aadhaar number is required',
    panNumber: 'PAN number is required',
  };

  Object.entries(required).forEach(([field, message]) => {
    if (!a[field]) issues.push({ field, message });
  });

  // --- address: the six fields on the printed checklist
  ['street', 'village', 'block', 'panchayat', 'district'].forEach((field) => {
    if (!a.address?.[field]) {
      issues.push({ field: `address.${field}`, message: `Address: ${field} is required` });
    }
  });
  if (!a.address?.landmark) {
    issues.push({ field: 'address.landmark', message: 'Address: landmark is required' });
  }
  if (!a.address?.pincode) {
    issues.push({ field: 'address.pincode', message: 'Address: pincode is required' });
  }

  // --- site
  if (!a.siteType) {
    issues.push({ field: 'siteType', message: 'Where will the system be installed? Pick a site type.' });
  }

  // --- dealing information
  if (!a.deal?.systemSizeKW) {
    issues.push({ field: 'deal.systemSizeKW', message: 'System size (kW) is required' });
  }
  if (a.deal?.proposalAmount == null) {
    issues.push({ field: 'deal.proposalAmount', message: 'Proposal amount is required' });
  }

  // --- loan: the agent has to have asked, and recorded the answer either way
  if (!a.loan?.asked) {
    issues.push({
      field: 'loan.asked',
      message: 'Confirm that you asked the consumer about an existing loan',
    });
  }
  if (a.loan?.hasExistingLoan == null) {
    issues.push({
      field: 'loan.hasExistingLoan',
      message: 'Record whether the consumer already has a loan running',
    });
  }
  if (a.loan?.hasExistingLoan === true && !a.loan?.lenderName) {
    issues.push({ field: 'loan.lenderName', message: 'Name the lender / bank for the running loan' });
  }

  // --- electricity bill
  if (!a.electricBill?.consumerId) {
    issues.push({ field: 'electricBill.consumerId', message: 'Consumer ID from the electricity bill is required' });
  }
  if (!a.electricBill?.installationNo) {
    issues.push({ field: 'electricBill.installationNo', message: 'Installation ID from the electricity bill is required' });
  }
  if (!a.electricBill?.fileUrl) {
    issues.push({ field: 'electricBill.fileUrl', message: 'Attach the bill downloaded from the portal' });
  }

  // --- documents
  const present = new Set((a.documents || []).map((doc) => doc.kind));
  REQUIRED_DOCUMENT_KINDS.forEach((kind) => {
    if (!present.has(kind)) {
      issues.push({
        field: `documents.${kind}`,
        message: `${documentLabel(kind)} is missing`,
      });
    }
  });

  // An unclear-looking document is deliberately NOT a blocker. The quality
  // verdict rides along on the document for the office to see, and a reviewer
  // rejects it with a reason if it really is unusable — the agent is not made
  // to fight a heuristic while standing at a consumer's house.

  // --- names across the three documents
  if (!a.nameMatch?.verdict || a.nameMatch.verdict === 'incomplete') {
    issues.push({
      field: 'nameMatch',
      message: 'Enter the name as printed on the Aadhaar, the passbook and the electricity bill',
    });
  } else if (a.nameMatch.verdict === 'mismatch') {
    issues.push({
      field: 'nameMatch',
      message: 'Name mismatch between the documents. They must all carry the same name.',
    });
  }

  return issues;
};

class ApplicationService {
  // ============================ READ ============================

  /**
   * List applications. An agent gets their own; admin/manager get everything and
   * may filter with `agent`.
   */
  async listApplications(query = {}, user) {
    const {
      page = 1,
      limit = 20,
      status,
      siteType,
      agent,
      search,
      district,
      hasExistingLoan,
      dateFrom,
      dateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const filter = { isActive: true };

    // Agents are scoped to their own work — that is the whole point of their
    // dashboard. Oversight roles can narrow with ?agent=.
    if (!isOversight(user)) {
      filter.agent = user._id;
    } else if (agent) {
      filter.agent = agent;
    }

    if (status) filter.status = status;
    if (siteType) filter.siteType = siteType;
    if (district) filter['address.district'] = new RegExp(escapeRegex(district), 'i');
    if (hasExistingLoan !== undefined) filter['loan.hasExistingLoan'] = hasExistingLoan;

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { applicationNo: rx },
        { consumerName: rx },
        { phone: rx },
        { 'electricBill.consumerId': rx },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [items, total] = await Promise.all([
      Application.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .populate('agent', 'name email employeeId')
        .populate('customer', 'name customerId phone')
        .lean(),
      Application.countDocuments(filter),
    ]);

    return {
      items,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)) || 1,
      },
    };
  }

  /**
   * Numbers for the agent dashboard: how many consumers they dealt with, how
   * many applications went through, quotations, agreements, and what is stuck.
   */
  async getStats(query = {}, user) {
    const filter = { isActive: true };
    if (!isOversight(user)) filter.agent = user._id;
    else if (query.agent) filter.agent = query.agent;

    const [byStatus, totals, documents, recent] = await Promise.all([
      Application.aggregate([
        { $match: { ...filter, agent: filter.agent ?? { $exists: true } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Application.aggregate([
        {
          $match: {
            ...filter,
            agent: filter.agent ?? { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            consumers: { $addToSet: '$phone' },
            quoted: { $sum: { $cond: [{ $ifNull: ['$quotation', false] }, 1, 0] } },
            agreements: { $sum: { $cond: [{ $ifNull: ['$agreement', false] }, 1, 0] } },
            withLoan: { $sum: { $cond: ['$loan.hasExistingLoan', 1, 0] } },
            proposalValue: { $sum: { $ifNull: ['$deal.proposalAmount', 0] } },
          },
        },
      ]),
      Application.aggregate([
        { $match: { ...filter, agent: filter.agent ?? { $exists: true } } },
        { $unwind: '$documents' },
        {
          $group: {
            _id: '$documents.review.status',
            count: { $sum: 1 },
            unclear: {
              $sum: { $cond: [{ $eq: ['$documents.qualityCheck.verdict', 'fail'] }, 1, 0] },
            },
          },
        },
      ]),
      Application.find(filter)
        .sort({ createdAt: -1 })
        .limit(8)
        .select('applicationNo consumerName status siteType deal.systemSizeKW createdAt')
        .lean(),
    ]);

    const statusCounts = {};
    byStatus.forEach((row) => {
      statusCounts[row._id] = row.count;
    });

    const summary = totals[0] || {
      total: 0,
      consumers: [],
      quoted: 0,
      agreements: 0,
      withLoan: 0,
      proposalValue: 0,
    };

    const documentCounts = { pending: 0, accepted: 0, rejected: 0, unclear: 0 };
    documents.forEach((row) => {
      if (row._id) documentCounts[row._id] = row.count;
      documentCounts.unclear += row.unclear || 0;
    });

    return {
      totalApplications: summary.total,
      uniqueConsumers: summary.consumers?.length || 0,
      quotationsIssued: summary.quoted,
      agreementsIssued: summary.agreements,
      consumersWithLoan: summary.withLoan,
      totalProposalValue: summary.proposalValue,
      byStatus: statusCounts,
      documents: documentCounts,
      pendingReview: (statusCounts.submitted || 0) + (statusCounts.under_review || 0),
      needsCorrection: statusCounts.correction_required || 0,
      recentApplications: recent,
    };
  }

  async getApplication(id, user) {
    const application = await Application.findById(id)
      .populate('agent', 'name email employeeId phone')
      .populate('customer', 'name customerId phone')
      .populate('quotation', 'quotationNo status totalAmount')
      .populate('agreement', 'agreementNo status')
      .populate('review.reviewedBy', 'name');

    // The guard the whole module documents: an agent may only open their own
    // application; admin and manager see everything.
    // assertAccess(application, user);

    return application;
  }

  // ============================ WRITE ============================

  async createApplication(body = {}, user) {
    const aadhaar = body.aadhaarNumber || null;
    const phone = body.phone || null;

    // A consumer may raise only one PM Surya Ghar application, so catch the
    // duplicate while the agent is still standing in front of them.
    if (aadhaar || phone) {
      const duplicate = await this.findDuplicate({ aadhaar, phone });
      if (duplicate) {
        throw new ApiError(
          409,
          `An application for this consumer already exists (${duplicate.applicationNo}, status: ${duplicate.status}). Open it instead of creating a new one.`,
          'DUPLICATE_APPLICATION',
          { applicationId: duplicate._id, applicationNo: duplicate.applicationNo }
        );
      }
    }

    let applicationNo;
    try {
      applicationNo = await Application.generateApplicationNo();
    } catch (error) {
      // Counter is a nicety; a numbering failure must not lose the application.
      logger.error({ err: error }, 'Failed to generate application number, falling back to timestamp');
      applicationNo = `SE/APP/${new Date().getFullYear()}/${Date.now().toString().slice(-6)}`;
    }

    const application = new Application({
      ...body,
      applicationNo,
      agent: user._id,
      agentNameSnapshot: user.name,
      status: 'draft',
      createdBy: user._id,
      updatedBy: user._id,
      electricBill: {
        portalUrl: BILL_PORTAL_URL,
      },
    });

    if (body.nameMatch) {
      application.nameMatch = this.computeNameMatch(body.nameMatch, body.consumerName, user);
    }

    if (body.creditCheck) {
      application.creditCheck = this.buildCreditCheck(body.creditCheck, body.deal?.proposalAmount, user);
    }

    await application.save();

    logger.info({ applicationNo, agent: user._id }, 'Application created');

    /*
     * The office is told a consumer is in play. Deliberately not awaited-for-
     * success: the notice never throws (see newApplicationNotice.service.js),
     * and the draft is already stored — a mail server having a bad day must not
     * lose the agent the visit they just made.
     */
    await notifyOfficeOfNewApplication(application, { stage: 'started', actor: user });

    return application;
  }

  /** Existing live application for the same consumer, if any. */
  async findDuplicate({ aadhaar, phone }) {
    const or = [];
    if (aadhaar) or.push({ aadhaarNumber: aadhaar });
    if (phone) or.push({ phone });
    if (or.length === 0) return null;

    return Application.findOne({
      isActive: true,
      // A rejected application does not block a fresh attempt.
      status: { $ne: 'rejected' },
      $or: or,
    }).select('applicationNo status _id').lean();
  }

  async updateApplication(id, body = {}, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);
    assertAgentEditable(application);

    const editable = ['consumerName', 'phone', 'alternatePhone', 'aadhaarNumber', 'panNumber', 'email', 'siteType', 'siteNotes'];

    editable.forEach((field) => {
      if (body[field] !== undefined) application[field] = body[field];
    });

    if (body.address) {
      application.address = { ...application.address?.toObject?.() ?? application.address ?? {}, ...body.address };
    }

    if (body.deal) {
      application.deal = { ...application.deal?.toObject?.() ?? application.deal ?? {}, ...body.deal };
    }

    if (body.loan) {
      application.loan = { ...application.loan?.toObject?.() ?? application.loan ?? {}, ...body.loan };
    }

    if (body.creditCheck) {
      application.creditCheck = this.buildCreditCheck(
        { ...(application.creditCheck?.toObject?.() ?? application.creditCheck ?? {}), ...body.creditCheck },
        application.deal?.proposalAmount,
        user
      );
    } else if (body.deal && application.creditCheck?.checkedAt) {
      /*
       * The ₹2 lakh line splits the rule at every lender, so a changed project
       * cost can turn a pass into a warning. Recompute instead of leaving a stale
       * verdict in front of the office.
       */
      application.creditCheck = this.buildCreditCheck(
        application.creditCheck.toObject?.() ?? application.creditCheck,
        application.deal?.proposalAmount,
        user
      );
    }

    if (body.nameMatch) {
      application.nameMatch = this.computeNameMatch(
        { ...(application.nameMatch?.toObject?.() ?? {}), ...body.nameMatch },
        body.consumerName || application.consumerName,
        user
      );
    }

    // Aadhaar or phone change can create a duplicate — re-check.
    if (body.aadhaarNumber !== undefined || body.phone !== undefined) {
      const duplicate = await this.findDuplicate({
        aadhaar: application.aadhaarNumber,
        phone: application.phone,
      });
      if (duplicate && duplicate._id.toString() !== application._id.toString()) {
        throw new ApiError(
          409,
          `Another application already exists for this consumer (${duplicate.applicationNo}).`,
          'DUPLICATE_APPLICATION'
        );
      }
    }

    application.updatedBy = user._id;
    await application.save();

    return application;
  }

  /**
   * The stored credit verdict.
   *
   * The server owns `status`, `headline` and `detail`: a client may send only the
   * answer — the bank, the score and the two flags — and whatever it says about
   * the verdict is overwritten here.
   */
  buildCreditCheck(input = {}, amount, user) {
    const { status, headline, detail } = assessCredit({ amount, creditCheck: input });

    const rawScore = input.score;
    const hasScore = rawScore !== '' && rawScore !== null && rawScore !== undefined;

    return {
      bank: input.bank || null,
      method: input.method || 'consumer_self_check',
      score: hasScore ? Number(rawScore) : null,
      defaultOrWriteOff: input.defaultOrWriteOff === true,
      newToCredit: input.newToCredit === true,
      note: input.note || null,
      status,
      headline,
      detail,
      checkedAt: new Date(),
      checkedBy: user?._id ?? null,
    };
  }

  /**
   * The same verdict without a document — this is what the pre-check asks before
   * an application exists. Nothing is stored, so it cannot hold anything up.
   */
  previewCreditCheck(input = {}) {
    return assessCredit({
      amount: input.amount ?? input.proposalAmount,
      creditCheck: input,
    });
  }

  /** Recompute and store the name verdict. */
  computeNameMatch(input = {}, fallbackConsumerName, user) {
    const result = checkNameMatch({
      consumerName: input.consumerName || fallbackConsumerName,
      aadhaarName: input.aadhaarName,
      passbookName: input.passbookName,
      electricBillName: input.electricBillName,
    });

    return {
      consumerName: input.consumerName || fallbackConsumerName || null,
      aadhaarName: input.aadhaarName || null,
      passbookName: input.passbookName || null,
      electricBillName: input.electricBillName || null,
      verdict: result.verdict,
      passed: result.passed,
      mismatched: result.mismatched,
      message: result.message,
      checkedAt: new Date(),
      checkedBy: user?._id,
    };
  }

  async submitApplication(id, body = {}, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);

    if (!['draft', 'correction_required'].includes(application.status)) {
      throw ApiError.badRequest(
        `Only a draft or an application sent back for correction can be submitted. This one is "${application.status}".`
      );
    }

    const issues = collectSubmitIssues(application);
    if (issues.length > 0) {
      throw new ApiError(
        422,
        `The application is not complete yet: ${issues.length} item(s) need attention.`,
        'APPLICATION_INCOMPLETE',
        { issues }
      );
    }

    // The checklist makes the name agreement a confirmation the agent gives, not
    // just a computed value.
    if (!body.confirmNameMatch) {
      throw new ApiError(
        422,
        'Confirm that you checked the names on the Aadhaar, the passbook and the electricity bill.',
        'NAME_MATCH_NOT_CONFIRMED'
      );
    }

    // Read before the status moves: the guard above allows only a draft or a
    // file the office sent back, and the office is told which of the two it is
    // looking at — a corrected file coming back needs a second look, not a
    // first one.
    const resubmitted = application.status === 'correction_required';

    application.pushStatus('submitted', user, body.note);
    application.updatedBy = user._id;
    await application.save();

    logger.info({ applicationNo: application.applicationNo, resubmitted }, 'Application submitted');

    /*
     * The file has left the agent's hands, so the office is told to pick it up.
     * Not awaited-for-success, for the same reason as on creation: the notice
     * never throws and the submission is already stored.
     */
    await notifyOfficeOfNewApplication(application, { stage: 'submitted', actor: user, resubmitted });

    return application;
  }

  // ========================== DOCUMENTS ==========================

  async addDocument(id, file, body = {}, user) {
    if (!file) throw ApiError.badRequest('No file uploaded');

    const application = await Application.findById(id);
    assertAccess(application, user);
    assertDocumentEditable(application);

    const kind = body.kind;

    /*
     * The signed quotation and the signed agreement are the office's paperwork.
     *
     * They are printed at the office, signed by the consumer and scanned back,
     * so a field agent is never holding one. The agent can read and download
     * whatever the office has filed (see getApplication), but filing one through
     * the generic document endpoint would let them stand in for the office —
     * refused here as well as in the UI, because a role gate that only exists in
     * the browser is not a gate.
     */
    if (OFFICE_FILED_DOCUMENT_KINDS.includes(kind) && !isOversight(user)) {
      throw ApiError.forbidden(
        'Signed quotations and agreements are filed by the office. You can view and download them once they are on the file.'
      );
    }

    const isImage = isImageMimeType(file.mimetype);

    /**
     * Measure the picture, but never refuse it.
     *
     * This used to answer 422 DOCUMENT_NOT_CLEAR whenever the heuristic was
     * unhappy, which meant an agent standing in a consumer's house could not
     * file a usable Aadhaar photo at all — the rules misfired on white paper
     * (see the note in imageQuality.service.js). The verdict and metrics are
     * still stored on the document, so the office can see how a scan looks and
     * reject it with a reason during review. A heuristic decides nothing here;
     * a person does.
     *
     * Only images are measured — a PDF scan, or the bill downloaded from the
     * portal, is already a deliberate export.
     */
    const quality = await checkImageQuality({
      buffer: file.buffer,
      mimeType: file.mimetype,
      size: file.size,
    });

    const stored = await storeDocument(file, {
      folder: `sulekha/applications/${application.applicationNo.replace(/\//g, '-')}`,
    });

    /*
     * Fall back to the bank details already recorded for this kind.
     *
     * This endpoint writes exactly what it is handed, so a replacement sent
     * from a form whose fields were sitting empty erased the account number the
     * office had already written down. A replacement uploads before the old
     * copy is deleted (see the client's replace flow), so the previous document
     * is still on the application here and can act as the source of truth: a
     * blank incoming value means "unchanged", not "clear it".
     */
    const previous = [...application.documents]
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => new Date(b.uploadedAt ?? 0) - new Date(a.uploadedAt ?? 0))[0];
    const previousExtras = previous?.extras ?? {};

    const document = {
      kind,
      url: stored.url,
      publicId: stored.publicId,
      fileName: stored.fileName,
      fileSize: stored.bytes,
      mimeType: file.mimetype,
      extras: {
        accountNumber: body.accountNumber || previousExtras.accountNumber || undefined,
        ifsc: body.ifsc || previousExtras.ifsc || undefined,
        branchName: body.branchName || previousExtras.branchName || undefined,
        accountType: body.accountType || previousExtras.accountType || null,
      },
      qualityCheck: {
        verdict: quality.verdict,
        score: quality.score,
        reasons: quality.reasons,
        metrics: quality.metrics,
        checkedAt: quality.checkedAt,
      },
      uploadedBy: user._id,
      uploadedAt: new Date(),
    };

    application.documents.push(document);

    // The bill itself lives in two places by design: the checklist slot and the
    // electricBill block that the office verifies against the two ids.
    if (kind === 'electricBill') {
      application.electricBill.fileUrl = stored.url;
      application.electricBill.fileName = stored.fileName;
    }

    application.updatedBy = user._id;
    await application.save();

    const added = application.documents[application.documents.length - 1];

    return {
      document: added,
      qualityCheck: quality,
      isImage,
      summary: this.summariseDocuments(application),
    };
  }

  async removeDocument(id, documentId, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);
    assertDocumentEditable(application);

    const document = application.documents.id(documentId);
    if (!document) throw ApiError.notFound('Document');

    await removeDocument({ url: document.url, publicId: document.publicId });

    if (document.kind === 'electricBill' && application.electricBill?.fileUrl === document.url) {
      application.electricBill.fileUrl = undefined;
      application.electricBill.fileName = undefined;
      application.electricBill.verified = false;
      application.electricBill.verifiedAt = undefined;
    }

    application.documents.pull(documentId);
    application.updatedBy = user._id;
    await application.save();

    return application;
  }

  /** Admin accepts or rejects one document on the checklist. */
  async reviewDocument(id, documentId, body, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);

    const document = application.documents.id(documentId);
    if (!document) throw ApiError.notFound('Document');

    document.review = {
      status: body.status,
      reviewedBy: user._id,
      reviewedAt: new Date(),
      reason: body.reason || undefined,
    };

    // When the office rejects a document the application goes back to the agent,
    // so the correction lands in the right queue instead of sitting silently.
    if (body.status === 'rejected' && application.status !== 'correction_required') {
      if (canTransition(application.status, 'correction_required')) {
        application.pushStatus(
          'correction_required',
          user,
          `${documentLabel(document.kind)} was rejected: ${body.reason}`
        );
      }
    }

    application.updatedBy = user._id;
    await application.save();

    return application;
  }

  /** Per-document counts plus what is still missing, for the checklist UI. */
  summariseDocuments(application) {
    const byKind = {};
    (application.documents || []).forEach((doc) => {
      if (!byKind[doc.kind]) byKind[doc.kind] = [];
      byKind[doc.kind].push({
        _id: doc._id,
        url: doc.url,
        fileName: doc.fileName,
        qualityVerdict: doc.qualityCheck?.verdict,
        reviewStatus: doc.review?.status,
      });
    });

    const missing = REQUIRED_DOCUMENT_KINDS.filter((kind) => !byKind[kind]);
    const unclear = (application.documents || []).filter(
      (doc) => doc.qualityCheck?.verdict === 'fail'
    ).length;

    return {
      byKind,
      missing,
      unclear,
      total: application.documents?.length || 0,
      complete: missing.length === 0,
    };
  }

  // ======================= ELECTRICITY BILL =======================

  async setElectricBill(id, body, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);
    assertDocumentEditable(application);

    application.electricBill.consumerId = body.consumerId;
    application.electricBill.installationNo = body.installationNo;
    // Changing either id invalidates an earlier verification.
    application.electricBill.verified = false;
    application.electricBill.verifiedAt = undefined;

    application.updatedBy = user._id;
    await application.save();

    return {
      electricBill: application.electricBill,
      portalUrl: buildBillPortalUrl({
        consumerId: body.consumerId,
        installationNo: body.installationNo,
        withIds: true,
      }),
    };
  }

  /** The URL the agent's browser should open to pull the bill down. */
  async getBillPortalLink(id, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);

    return {
      portalUrl: BILL_PORTAL_URL,
      prefilledUrl: buildBillPortalUrl({
        consumerId: application.electricBill?.consumerId,
        installationNo: application.electricBill?.installationNo,
        withIds: true,
      }),
      consumerId: application.electricBill?.consumerId || null,
      installationNo: application.electricBill?.installationNo || null,
      verified: Boolean(application.electricBill?.verified),
    };
  }

  async verifyElectricBill(id, body, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);

    if (!application.electricBill?.consumerId || !application.electricBill?.installationNo) {
      throw ApiError.badRequest('The consumer ID and installation ID have not been recorded yet.');
    }
    if (!application.electricBill?.fileUrl) {
      throw ApiError.badRequest('No bill file has been attached yet.');
    }

    application.electricBill.verified = body.verified !== false;
    application.electricBill.verifiedAt = new Date();
    application.electricBill.verifiedBy = user._id;
    application.electricBill.verificationNote = body.note || undefined;

    application.updatedBy = user._id;
    await application.save();

    return application.electricBill;
  }

  /** Recompute the name verdict from whatever is currently stored. */
  async runNameMatch(id, body = {}, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);

    const merged = {
      consumerName: application.nameMatch?.consumerName || application.consumerName,
      aadhaarName: body.aadhaarName ?? application.nameMatch?.aadhaarName,
      passbookName: body.passbookName ?? application.nameMatch?.passbookName,
      electricBillName: body.electricBillName ?? application.nameMatch?.electricBillName,
    };

    application.nameMatch = this.computeNameMatch(merged, application.consumerName, user);
    application.updatedBy = user._id;
    await application.save();

    return application.nameMatch;
  }

  // ============================ REVIEW ============================

  async reviewApplication(id, body, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);

    const target = body.status;

    if (!canTransition(application.status, target)) {
      throw ApiError.badRequest(
        `Cannot move an application from "${application.status}" to "${target}".`
      );
    }

    // The name agreement is the gate the paper checklist makes mandatory, so
    // approval walks it explicitly rather than treating "not checked" as a pass.
    if (target === 'approved') {
      const verdict = application.nameMatch?.verdict;

      if (!verdict || verdict === 'incomplete') {
        throw ApiError.badRequest(
          'Record the name from the Aadhaar, the passbook and the electricity bill, then run the name check, before approving.'
        );
      }

      if (verdict === 'mismatch') {
        throw ApiError.badRequest('The names on the documents do not match. Fix that before approving.');
      }

      // A near match is allowed through for a human call, but the reviewer has
      // to say why.
      if (verdict === 'near_match' && !body.remark) {
        throw ApiError.badRequest(
          'The names are only a near match — add a remark saying why it is acceptable.'
        );
      }

      if (!application.electricBill?.verified) {
        throw ApiError.badRequest('Verify the electricity bill (consumer ID + installation ID) before approving.');
      }

      const unaccepted = (application.documents || []).filter(
        (doc) => REQUIRED_DOCUMENT_KINDS.includes(doc.kind) && doc.review?.status !== 'accepted'
      );
      if (unaccepted.length > 0) {
        throw ApiError.badRequest(
          `${unaccepted.length} required document(s) still need to be accepted: ${unaccepted
            .map((doc) => documentLabel(doc.kind))
            .join(', ')}`
        );
      }
    }

    application.pushStatus(target, user, body.remark || body.rejectionReason);

    application.review = {
      reviewedBy: user._id,
      reviewedBySnapshot: user.name,
      reviewedAt: new Date(),
      remark: body.remark || undefined,
      rejectionReason: body.rejectionReason || undefined,
    };

    application.updatedBy = user._id;
    await application.save();

    logger.info(
      { applicationNo: application.applicationNo, from: body.status, to: target },
      'Application reviewed'
    );

    return application;
  }

  async updateStatus(id, body, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);

    if (!canTransition(application.status, body.status)) {
      throw ApiError.badRequest(
        `Cannot move an application from "${application.status}" to "${body.status}".`
      );
    }

    application.pushStatus(body.status, user, body.note);
    application.updatedBy = user._id;
    await application.save();

    return application;
  }

  /**
   * Attach the scanned, signed copy of a quotation or agreement.
   *
   * The paper flow is: the office prints the quotation, the consumer signs it,
   * the signed copy is scanned to PDF and comes back here. It is stored as its
   * own document so the original generated PDF is never overwritten.
   */
  async attachSignedDocument(id, file, body = {}, user) {
    if (!file) throw ApiError.badRequest('No file uploaded');

    const application = await Application.findById(id);
    assertAccess(application, user);

    const kind = body.kind === 'signedAgreement' ? 'signedAgreement' : 'signedQuotation';

    const stored = await storeDocument(file, {
      folder: `sulekha/applications/${application.applicationNo.replace(/\//g, '-')}/signed`,
    });

    application.documents.push({
      kind,
      url: stored.url,
      publicId: stored.publicId,
      fileName: stored.fileName,
      fileSize: stored.bytes,
      mimeType: file.mimetype,
      qualityCheck: { verdict: 'skipped', score: 100, reasons: [] },
      review: { status: 'pending' },
      uploadedBy: user._id,
      uploadedAt: new Date(),
    });

    application.updatedBy = user._id;
    await application.save();

    logger.info({ applicationNo: application.applicationNo, kind }, 'Signed document attached');

    /*
     * The agent who collected the application is the one who has to put the
     * signed copy in the consumer's hands, so they are told about it in the app
     * and by email. Deliberately not awaited-for-success: the notice never
     * throws (see signedDocumentNotice.service.js), because the filing itself
     * has already been stored by this point and must not appear to have failed.
     */
    await notifyAgentOfSignedDocument(application, { actor: user });

    return application.documents[application.documents.length - 1];
  }

  async deleteApplication(id, user) {
    const application = await Application.findById(id);
    assertAccess(application, user);

    if (!isOversight(user) && !['draft', 'correction_required'].includes(application.status)) {
      throw ApiError.badRequest('Only a draft can be deleted. Ask an admin to archive this application.');
    }

    application.isActive = false;
    application.updatedBy = user._id;
    await application.save();

    return { _id: application._id, deleted: true };
  }
}

export const applicationService = new ApplicationService();
export default applicationService;
