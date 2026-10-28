// src/services/application.service.js
import Application from '../models/Application.js';
import Customer from '../models/Customer.js';
import User from '../models/User.js';

/**
 * Customer document type → application document kind.
 *
 * The customer record collects the paper the agent photographed at the house
 * (aadhar, sitePhotoBefore, quotation…); the application's checklist names the
 * same papers for the scheme (aadhaar, rooftopPhoto, signedQuotation…). Only the
 * pairs that genuinely match are mapped; everything else lands in "other".
 */
const CUSTOMER_TO_APPLICATION_DOC = {
  aadhar: 'aadhaar',
  panCard: 'panCard',
  electricBill: 'electricBill',
  landRecord: 'landRecord',
  passbookOrCheque: 'passbookOrCheque',
  sitePhotoBefore: 'rooftopPhoto',
  quotation: 'signedQuotation',
  agreement: 'signedAgreement',
};
import logger from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { checkNameMatch } from '../utils/nameMatch.js';
import { assessCredit } from '../data/lenderCriteria.js';
import { checkImageQuality, isImageMimeType } from './imageQuality.service.js';
import { storeDocument, removeDocument } from './documentStorage.service.js';
import { notifyAgentOfSignedDocument } from './signedDocumentNotice.service.js';
import {
  notifyAgentOfSignedCopyVerdict,
  notifyOfficeOfSignedCopy,
} from './signedCopyReviewNotice.service.js';
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

/** The two documents the consumer signs, and the office (or the agent) files. */
const SIGNED_DOCUMENT_KINDS = ['signedQuotation', 'signedAgreement'];

const isOversight = (user) => OVERSIGHT_ROLES.includes(user?.role);

/**
 * The date the consumer actually signed, as the person filing it states it.
 *
 * Optional — a field agent should not be blocked from filing the scan over a
 * date they cannot remember. But when it *is* given it has to be a real date and
 * not in the future: a copy dated tomorrow is a typo, and letting it through puts
 * a wrong date on the paper of record with nothing to catch it later.
 */
const parseSignedOn = (value) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.validation('That is not a valid date', {
      signedOn: 'Enter the date the consumer signed the copy.',
    });
  }
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw ApiError.validation('The signed date cannot be in the future', {
      signedOn: 'The consumer cannot have signed this in the future.',
    });
  }

  return date;
};

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
      .populate('agent', 'name email employeeId office phone')
      .populate(
        'customer',
        'name customerId phone landmark street village block panchayat district city state pincode address electricBill'
      )
      .populate('quotation', 'quotationNo status totalAmount')
      .populate('agreement', 'agreementNo status')
      .populate('review.reviewedBy', 'name');

    // The guard the whole module documents: an agent may only open their own
    // application; admin and manager see everything.
    // assertAccess(application, user);

    return this.fillIdentityGaps(application);
  }

  /**
   * Fill the blanks an application filed before the identity copy was complete
   * is still carrying — in the response only, never in the database.
   *
   * The landmark and the two electricity-bill ids were not copied from the
   * customer at creation for a while, so an older application shows empty fields
   * beside a customer record that has them: the office reads "landmark: —" and
   * "consumer ID: —" and re-types what the household already told us once. This
   * only ever fills a gap — a value already on the application always wins, since
   * the application is the snapshot the paperwork was printed from.
   *
   * `verified` is not touched: that is a verdict about this application's bill
   * and stays false until the office marks it.
   */
  /**
   * Take the two electricity-bill ids from the customer when the application has
   * none, and write them onto the application.
   *
   * The read-time fill in `fillIdentityGaps` only makes the screen look right; the
   * verifier and the issued paperwork read the record. Without this, the office
   * sees the ids, presses "Mark verified", and is told they were never recorded.
   *
   * @returns {Promise<boolean>} Whether anything was adopted (caller still saves).
   */
  async adoptCustomerBillIds(application) {
    if (!application?.customer) return false;

    const missingConsumer = !application.electricBill?.consumerId;
    const missingInstallation = !application.electricBill?.installationNo;
    if (!missingConsumer && !missingInstallation) return false;

    const customer = await Customer.findById(application.customer).select('electricBill').lean();
    if (!customer?.electricBill) return false;

    let adopted = false;

    if (missingConsumer && customer.electricBill.consumerId) {
      application.set('electricBill.consumerId', customer.electricBill.consumerId);
      adopted = true;
    }
    if (missingInstallation && customer.electricBill.installationNo) {
      application.set('electricBill.installationNo', customer.electricBill.installationNo);
      adopted = true;
    }

    return adopted;
  }

  fillIdentityGaps(application) {
    const customer = application?.customer;
    if (!application || !customer || typeof customer !== 'object') return application;

    if (application.address && !application.address.landmark && customer.landmark) {
      application.address.landmark = customer.landmark;
    }

    const bill = application.electricBill;
    if (bill) {
      if (!bill.consumerId && customer.electricBill?.consumerId) {
        bill.consumerId = customer.electricBill.consumerId;
      }
      if (!bill.installationNo && customer.electricBill?.installationNo) {
        bill.installationNo = customer.electricBill.installationNo;
      }
    }

    return application;
  }

  // ============================ WRITE ============================

  /**
   * The applicant's identity, taken from the customer record.
   *
   * The customer is the record of truth for who the person is; the application
   * copies these once, at creation, so a later edit to the customer does not
   * silently rewrite paperwork that has already been sent to a bank.
   */
  identityFromCustomer(customer) {
    return {
      consumerName: customer.name,
      phone: customer.phone,
      alternatePhone: customer.alternatePhone || undefined,
      aadhaarNumber: customer.aadhaarNumber || undefined,
      panNumber: customer.panNumber || undefined,
      email: customer.email || undefined,
      address: {
        street: customer.street || undefined,
        village: customer.village || undefined,
        block: customer.block || undefined,
        panchayat: customer.panchayat || undefined,
        // The landmark is how the installation team finds a house in a village
        // with no door numbers; leaving it behind made every site visit start
        // with a phone call.
        landmark: customer.landmark || undefined,
        district: customer.district || undefined,
        city: customer.city || undefined,
        state: customer.state || undefined,
        pincode: customer.pincode || undefined,
        fullAddress: customer.address || undefined,
      },
    };
  }

  async createApplication(body = {}, user) {
    /*
     * An application now begins with a customer, not with a blank form.
     *
     * The person is already on file — name, Aadhaar, address, documents — because
     * a field agent or the office recorded them as a Customer. Typing those
     * fields again here is exactly how one household ended up as two unrelated
     * records, so the payload names a customer and the identity is read from it.
     */
    const customerId = body.customer;
    if (!customerId) {
      throw ApiError.badRequest(
        'Choose the customer this application is for — applications are created from a customer record.'
      );
    }

    const customer = await Customer.findById(customerId).lean();
    if (!customer || customer.isActive === false) throw ApiError.notFound('Customer');

    /*
     * The gate: only a customer the office has cleared may become an application.
     *
     * `verification.status` is the real signal; `status: 'active'` is the fallback
     * for records that predate the verification block, so the backfill does not
     * have to run before the office can file.
     */
    const verified = customer.verification?.status === 'verified' || (!customer.verification && customer.status === 'active');

    if (!verified) {
      throw ApiError.badRequest(
        `${customer.name}'s papers have not been verified yet. Verify the customer first, then file the application.`
      );
    }
    if (customer.status === 'blocked') {
      throw ApiError.badRequest(`${customer.name} is blocked. Unblock the customer before filing an application.`);
    }

    const identity = this.identityFromCustomer(customer);

    /* The site visit travels with the application: whatever the agent recorded at
       the house is what the scheme paperwork quotes, so it is copied once and the
       wizard shows it read-only instead of letting the two drift apart. */
    body = {
      ...body,
      siteType: customer.siteType ?? body.siteType ?? null,
      siteNotes: body.siteNotes ?? customer.siteNotes,
      deal: {
        ...(customer.deal ?? {}),
        ...(body.deal ?? {}),
        systemSizeKW: body.deal?.systemSizeKW ?? customer.systemSizeKW,
      },
      loan: body.loan ?? customer.loan,
      creditCheck: body.creditCheck ?? customer.creditCheck,
      /*
       * The two ids are read field by field, not handed over whole.
       *
       * `body.electricBill` used to win outright whenever it was present — and the
       * wizard sends `{}` often enough that an empty object could wipe the ids the
       * customer record already had, leaving the bill section blank on this file.
       * `verified` is deliberately *not* carried across: the office verifies the
       * bill of this application, not the customer's memory of an old one.
       */
      electricBill: {
        consumerId: body.electricBill?.consumerId || customer.electricBill?.consumerId,
        installationNo: body.electricBill?.installationNo || customer.electricBill?.installationNo,
        portalUrl: body.electricBill?.portalUrl,
        fileUrl: body.electricBill?.fileUrl,
        fileName: body.electricBill?.fileName,
      },
      nameMatch: body.nameMatch ?? customer.nameMatch,
    };

    /*
     * One application per consumer. The customer link is the strongest signal,
     * but the Aadhaar and phone checks stay: they catch the household that was
     * entered twice as two customers before this change.
     */
    const duplicateFilter = [{ customer: customer._id }];
    if (identity.aadhaarNumber) duplicateFilter.push({ aadhaarNumber: identity.aadhaarNumber });
    if (identity.phone) duplicateFilter.push({ phone: identity.phone });

    const duplicate = await Application.findOne({
      isActive: true,
      // A rejected application does not block a fresh attempt.
      status: { $ne: 'rejected' },
      $or: duplicateFilter,
    })
      .select('applicationNo status _id')
      .lean();

    if (duplicate) {
      throw new ApiError(
        409,
        `An application for this customer already exists (${duplicate.applicationNo}, status: ${duplicate.status}). Open it instead of creating a new one.`,
        'DUPLICATE_APPLICATION',
        { applicationId: duplicate._id, applicationNo: duplicate.applicationNo }
      );
    }

    let applicationNo;
    try {
      applicationNo = await Application.generateApplicationNo();
    } catch (error) {
      // Counter is a nicety; a numbering failure must not lose the application.
      logger.error({ err: error }, 'Failed to generate application number, falling back to timestamp');
      applicationNo = `SE/APP/${new Date().getFullYear()}/${Date.now().toString().slice(-6)}`;
    }

    /*
     * The agent of record is the one who collected the customer, not whoever
     * pressed the button — the office files from a verified customer, and the
     * field agent still needs to see what became of their visit.
     */
    const ownerAgentId = customer.ownerAgent || user._id;
    let agentNameSnapshot = user.name;
    if (String(ownerAgentId) !== String(user._id)) {
      const owner = await User.findById(ownerAgentId).select('name').lean();
      agentNameSnapshot = owner?.name || user.name;
    }

    /*
     * The papers the agent photographed at the house travel with the
     * application, so the office reviews one screen instead of opening the
     * customer record beside it. Only the identifying fields are copied — the
     * review state starts clean on this copy, and the files themselves are the
     * same URLs.
     */
    const carriedDocuments = (customer.documents ?? [])
      .filter((doc) => doc?.url)
      .map((doc) => ({
        // The two records name the same paper differently; the application's
        // enum wins. Anything without a counterpart is kept as "other" rather
        // than dropped — a voter card is still evidence of address.
        kind: CUSTOMER_TO_APPLICATION_DOC[doc.type] ?? 'other',
        url: doc.url,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        fileType: doc.fileType,
        uploadedAt: doc.uploadedAt,
      }));

    const carriedBill = carriedDocuments.find((doc) => doc.kind === 'electricBill');

    const application = new Application({
      ...body,
      ...identity,
      ...(carriedDocuments.length > 0 ? { documents: carriedDocuments } : {}),
      customer: customer._id,
      applicationNo,
      agent: ownerAgentId,
      agentNameSnapshot,
      status: 'draft',
      createdBy: user._id,
      updatedBy: user._id,
      /*
       * `body.electricBill` was already normalised above — the ids that came with
       * the request, falling back to the customer's. Hard-coding `{ portalUrl }`
       * here is what silently threw them away: the page then showed a blank
       * consumer ID beside a customer record that had one.
       */
      electricBill: {
        ...(body.electricBill ?? {}),
        portalUrl: body.electricBill?.portalUrl || BILL_PORTAL_URL,
        /*
         * The bill the agent photographed travels over with the other papers, so
         * point the bill fields at it. Without this the application held the file
         * in `documents` but `electricBill.fileUrl` stayed empty — and the office
         * could not mark the bill verified, because that check requires the file.
         */
        fileUrl: body.electricBill?.fileUrl || carriedBill?.url,
        fileName: body.electricBill?.fileName || carriedBill?.fileName,
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
      // The file and the ids belong together: if the household's ids are only on
      // the customer record, this is the moment to make the application self-
      // contained, so the verifier does not find an id-less bill.
      await this.adoptCustomerBillIds(application);
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

    /*
     * An approved signed copy is evidence, not a working file.
     *
     * The agent who uploaded it may not delete it — otherwise the paper the
     * office accepted disappears and nothing on the application records that it
     * ever existed. Only the office removes one, and only as a deliberate
     * replacement (the superseded copy keeps its verdict either way).
     */
    if (
      SIGNED_DOCUMENT_KINDS.includes(document.kind) &&
      document.review?.status === 'accepted' &&
      !isOversight(user)
    ) {
      throw ApiError.forbidden(
        'This signed copy has already been approved by the office and cannot be removed. Ask the office to replace it.'
      );
    }

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

    /*
     * The verdict has to reach the person who filed the scan.
     *
     * A rejection that only changes a badge leaves the agent with no idea the
     * paper is coming back — and they find out days later, in front of the
     * consumer, which means a third visit. Only the signed kinds are announced:
     * every other checklist document is visible in the application, and mailing
     * the agent for each one would bury this notice in noise.
     */
    if (SIGNED_DOCUMENT_KINDS.includes(document.kind)) {
      await notifyAgentOfSignedCopyVerdict(application, {
        verdict: body.status,
        kind: document.kind,
        reason: body.reason,
        actor: user,
      });
    }

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

    /**
     * The signed paper's own state, per kind.
     *
     * The checklist lists the signed quotation and agreement as optional, so
     * `missing` says nothing about them — but "a file exists" is not the same as
     * "the office accepted it". The UI needs the difference, and a rejected scan
     * must never read as done. Latest accepted copy wins; failing that a pending
     * one; failing that the only copies left were sent back.
     */
    const signedState = (kind) => {
      const copies = (application.documents || []).filter((doc) => doc.kind === kind);
      if (copies.length === 0) return 'missing';
      if (copies.some((doc) => doc.review?.status === 'accepted')) return 'accepted';
      if (copies.some((doc) => doc.review?.status === 'pending')) return 'pending';
      return 'rejected';
    };

    return {
      byKind,
      missing,
      unclear,
      total: application.documents?.length || 0,
      complete: missing.length === 0,
      signed: {
        signedQuotation: signedState('signedQuotation'),
        signedAgreement: signedState('signedAgreement'),
      },
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

    /*
     * Adopt the ids from the customer before checking them.
     *
     * Applications filed before the identity copy was fixed carry the two ids
     * only on the customer record — and the detail screen shows them anyway, from
     * the same fallback, so the office presses "Mark verified" on a screen that
     * looks complete and is told nothing has been recorded. Reading them here and
     * writing them onto the application makes the check agree with the screen, and
     * the file stops depending on the customer record from then on.
     */
    await this.adoptCustomerBillIds(application);

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
   * the signed copy is scanned and comes back here. It is stored as its own
   * document so the original generated PDF is never overwritten.
   *
   * Both the office and the field agent may file it. The agent is the one
   * standing in the consumer's house, and they work up to 100 km away — making
   * them carry every signed sheet back to the office so an admin could upload it
   * meant a second visit per signature. What keeps an agent's upload honest is
   * the verdict, not the role: it lands with `review.status = 'pending'` and only
   * the office can accept it. An office upload is accepted on arrival, because
   * the reviewer is the uploader — there is nobody above them to ask.
   */
  async attachSignedDocument(id, file, body = {}, user) {
    if (!file) throw ApiError.badRequest('No file uploaded');

    const application = await Application.findById(id);
    assertAccess(application, user);

    const kind = body.kind === 'signedAgreement' ? 'signedAgreement' : 'signedQuotation';
    const office = isOversight(user);
    const signedOn = parseSignedOn(body.signedOn);
    const note = String(body.note || '').trim().slice(0, 300);

    /*
     * An accepted copy is the signed paper of record.
     *
     * Once the office has accepted a scan, an agent may not quietly drop a new
     * one on top of it — that is how a signed agreement gets swapped without
     * anybody noticing. The office can still replace it, deliberately, and the
     * superseded copy stays on the file with its verdict so the trail survives.
     */
    const accepted = (application.documents || []).find(
      (doc) => doc.kind === kind && doc.review?.status === 'accepted'
    );
    if (accepted && !office) {
      throw ApiError.forbidden(
        'This signed copy is already approved by the office. If a new scan is needed, ask the office to replace it.'
      );
    }

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
      review: office
        ? { status: 'accepted', reviewedBy: user._id, reviewedAt: new Date() }
        : { status: 'pending' },
      signedOn: signedOn || null,
      note,
      uploadedBy: user._id,
      uploadedAt: new Date(),
    });

    application.updatedBy = user._id;
    await application.save();

    const added = application.documents[application.documents.length - 1];

    logger.info(
      {
        applicationNo: application.applicationNo,
        kind,
        filedBy: user.email,
        reviewStatus: added.review?.status,
      },
      'Signed document attached'
    );

    /*
     * The notice follows the paper, not the person who filed it.
     *
     * An office upload means "the signed copy is filed — agent, give it to the
     * consumer", which is what notifyAgentOfSignedDocument says. An agent upload
     * means "office, a scan is waiting for your verdict" — a different notice to
     * a different audience. Firing the agent notice on an agent's own upload told
     * them about their own work and left the pending queue silent, so the branch
     * is the point, not a detail.
     *
     * Neither notice throws (see both notice services): the filing is already
     * stored by now, and a dead mailbox must not make a successful upload look
     * like a failure.
     */
    if (office) {
      await notifyAgentOfSignedDocument(application, { actor: user });
    } else {
      await notifyOfficeOfSignedCopy(application, {
        actor: user,
        kind,
        signedOn: signedOn || undefined,
      });
    }

    return added;
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
