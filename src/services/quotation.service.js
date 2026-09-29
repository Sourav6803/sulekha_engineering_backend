// src/services/quotation.service.js
import mongoose from 'mongoose';
import { Quotation, CompanyProfile, Customer } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { containsRegex } from '../utils/escapeRegex.js';
import {
  financialYearOf,
  financialYearRange,
  buildQuotationNo,
  parseQuotationNo,
  normaliseSchemeCode,
  isValidSchemeCode,
  calculatePanelQty,
} from '../utils/quotationNumber.js';
import { amountInWords } from '../utils/amountInWords.js';
import {
  buildDefaultItems,
  buildDefaultTerms,
  buildDefaultPaymentTerms,
  buildSystemOverview,
  buildCompanySnapshot,
} from '../utils/quotationDefaults.js';
import { uploadToCloudinaryDetailed, deleteFromCloudinary } from './storage.service.js';
import { MAX_ITEM_LINES } from '../models/Quotation.js';
import {
  QUOTATION_TYPES,
  DEFAULT_QUOTATION_TYPE,
  DEFAULT_PARTNER_TITLE,
  DEFAULT_PARTNER_TAGLINE,
  rulesForType,
} from '../data/quotationTypes.js';

/** Lines the domestic sheet is kept to. One flat table has to fit one page. */
const DEFAULT_ITEM_LIMIT = 14;

/**
 * Quotation Service
 *
 * Numbering rules (agreed with the business):
 *  - format  SE/<scheme>/<FY>/<seq>, e.g. SE/PMSGY/2026-27/39
 *  - the sequence is global across schemes and scoped per financial year
 *  - the next number is `max(active seq in the FY) + 1`, so deleting the last
 *    quotation frees its number for the next one, while a gap in the middle of
 *    the year is preserved
 *  - allocation is protected by partial unique indexes on
 *    (quotationNo) and (financialYear, quotationSeq), both filtered to
 *    isActive:true, plus a bounded retry loop for concurrent creates.
 *
 * No multi-document transaction is used: the sequence is recomputed on every
 * attempt (nothing is consumed), so the unique index alone is sufficient — and
 * this keeps the feature working on a standalone mongod, not just a replica set.
 */

const MAX_ALLOCATION_ATTEMPTS = 5;

const isDuplicateKeyError = (error) =>
  Boolean(error) && (error.code === 11000 || error.code === 11001 || error.name === 'MongoServerError' && /duplicate key/i.test(error.message || ''));

const assertValidObjectId = (id, label = 'Quotation') => {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.badRequest(`Invalid ${label.toLowerCase()} id`);
  }
};

/** Fields a client is allowed to write. Anything else is ignored. */
const CREATABLE_FIELDS = [
  'customer', 'customerName', 'consumerId', 'phoneNo', 'addressLine1', 'addressLine2',
  'district', 'pincode', 'shipTo',
  'systemSizeKW', 'panelWp', 'panelQty', 'panelBrand', 'inverterCapacityKW', 'inverterBrand',
  'structureType', 'systemOverview',
  'items', 'amount', 'amountIncludesGST', 'amountInWords',
  // 'terms' and 'paymentTerms' are fixed company-wide and are never written by
  // a client - they are copied from the CompanyProfile at creation time.
  'issueDate', 'validUntil', 'validityDays', 'status', 'notes',
  'schemeCode', 'schemeLabel', 'quotationType',
];

/** Sub-documents are managed through their own endpoints, never by mass assignment. */
const NON_UPDATABLE_FIELDS = [
  'quotationNo', 'quotationSeq', 'financialYear', 'isActive', 'deletedAt', 'deletedBy',
  'deleteReason', 'attachments', 'revisions', 'companySnapshot', 'isHistorical',
  'importedFrom', 'importedAt', 'importedSlNo', 'convertedInstallation', 'conversionDate',
  'createdBy', 'updatedBy', 'createdAt', 'updatedAt', '_id', 'id',
];

const pickCreatable = (payload = {}) => {
  const out = {};
  for (const field of CREATABLE_FIELDS) {
    if (payload[field] !== undefined) out[field] = payload[field];
  }
  return out;
};

/** Normalise BOQ lines: numeric qty, integer order, trimmed description. */
const normaliseItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items.map((raw, index) => ({
    description: String(raw?.description ?? '').trim(),
    brandModel: String(raw?.brandModel ?? '').trim(),
    // Partner/project sheet columns; blank on the domestic sheet.
    specification: String(raw?.specification ?? '').trim(),
    section: String(raw?.section ?? '').trim(),
    qty: Number(raw?.qty),
    unit: raw?.unit ? String(raw.unit).trim().toLowerCase() : null,
    amount: raw?.amount === undefined || raw?.amount === null || raw?.amount === '' ? null : Number(raw.amount),
    isOptional: Boolean(raw?.isOptional),
    order: Number.isFinite(Number(raw?.order)) ? Number(raw.order) : index + 1,
  }));
};

export const quotationService = {
  // ==========================================================================
  // helpers
  // ==========================================================================
  async resolveProfile() {
    return CompanyProfile.getProfile();
  },

  /** Sum of the per-line amounts, or null when no line carries an amount. */
  sumItemAmounts(items) {
    const values = (items || [])
      .map((item) => (item?.amount === null || item?.amount === undefined ? null : Number(item.amount)))
      .filter((value) => Number.isFinite(value));
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;
  },

  /** Reject a BOQ that cannot fit the configured single page. */
  /**
   * How many BOQ lines this quotation type may carry.
   *
   * The domestic sheet is a single flat table that has to fit one page, so the
   * company setting is respected. A partner sheet is a multi-section project BOQ
   * — the Bank of Baroda one alone runs 29 lines across two sections — so it is
   * allowed the schema's hard ceiling instead.
   */
  itemLimitFor(profile, quotationType = DEFAULT_QUOTATION_TYPE) {
    const configured = Number(profile?.quotationItemLimit) || DEFAULT_ITEM_LIMIT;
    if (quotationType === 'partner') return Math.max(configured, MAX_ITEM_LINES);
    return configured;
  },

  assertItemLimit(items, profile, quotationType = DEFAULT_QUOTATION_TYPE) {
    const limit = this.itemLimitFor(profile, quotationType);
    if (Array.isArray(items) && items.length > limit) {
      throw new ApiError(
        422,
        `A quotation can hold at most ${limit} BOQ lines so that it prints on a single page (received ${items.length}).`,
        'QUOTATION_OVERFLOW',
        { itemLimit: limit, received: items.length }
      );
    }
  },

  /** Fill blank customer fields from a linked customer record. */
  async applyCustomerDefaults(payload) {
    if (!payload.customer) return payload;
    assertValidObjectId(payload.customer, 'Customer');

    const customer = await Customer.findOne({ _id: payload.customer, isActive: true }).lean();
    if (!customer) throw ApiError.notFound('Customer');

    const filled = { ...payload };
    filled.customerName = filled.customerName || customer.name;
    filled.consumerId = filled.consumerId || customer.consumerId || '';
    filled.phoneNo = filled.phoneNo || customer.phone || '';
    filled.addressLine1 = filled.addressLine1 || customer.address || customer.village || '';
    filled.district = filled.district || customer.city || '';
    filled.pincode = filled.pincode || customer.pincode || '';

    return filled;
  },

  // ==========================================================================
  // numbering
  // ==========================================================================
  /**
   * Preview the number the next save would receive. Read-only: does not consume
   * anything, so it is safe to call from the "New quotation" form.
   */
  async previewNextNumber({ schemeCode, issueDate } = {}) {
    const profile = await this.resolveProfile();
    const date = issueDate ? new Date(issueDate) : new Date();
    const financialYear = financialYearOf(date);
    if (!financialYear) throw ApiError.badRequest('A valid quotation date is required');

    const resolvedScheme = normaliseSchemeCode(schemeCode) || profile.defaultSchemeCode || 'PMSGY';
    if (!isValidSchemeCode(resolvedScheme)) {
      throw ApiError.badRequest(`Invalid scheme code: "${schemeCode}"`);
    }

    const quotationSeq = (await Quotation.getMaxSequence(financialYear)) + 1;

    return {
      quotationNo: buildQuotationNo({
        prefix: profile.quotationNumberPrefix,
        schemeCode: resolvedScheme,
        financialYear,
        seq: quotationSeq,
      }),
      quotationSeq,
      financialYear,
      schemeCode: resolvedScheme,
      schemeLabel: (profile.schemes || []).find((s) => s.code === resolvedScheme)?.label || '',
      basedOnMaxSequence: quotationSeq - 1,
    };
  },

  /**
   * Can this quotation number be used? Read-only — nothing is reserved, so two
   * admins can both be told "available" and the unique indexes still have the
   * final word at save time.
   *
   * Two separate things can make a number unusable, and the answer has to say
   * which one it was:
   *
   *  1. the number itself is on a live quotation, and
   *  2. the **serial** inside it is already taken for that financial year.
   *
   * The second is the one that surprises people: the sequence is global across
   * schemes by design, so SE/PMSGY/2026-27/45 and SE/BOB/2026-27/45 are the same
   * serial 45. A number can look perfectly free and still be refused by the
   * (financialYear, quotationSeq) index because a different scheme got there
   * first — so the check reports the holder by name instead of leaving the admin
   * to guess.
   *
   * @param {String} quotationNo - As typed, e.g. "SE/BOB/2026-27/45".
   * @param {Object} [options]
   * @param {Date|String} [options.issueDate] - When given, the number's financial
   *   year must match the one that date falls in.
   * @returns {Promise<Object>} `{ available, reason?, message, quotationNo, ... }`
   */
  async checkNumber(quotationNo, { issueDate = null } = {}) {
    const profile = await this.resolveProfile();
    const raw = String(quotationNo || '').trim();
    const example = `${profile.quotationNumberPrefix || 'SE'}/${
      profile.defaultSchemeCode || 'PMSGY'
    }/${financialYearOf(new Date())}/45`;

    if (!raw) {
      return {
        quotationNo: '',
        available: false,
        reason: 'required',
        message: 'Enter a quotation number.',
      };
    }

    const parsed = parseQuotationNo(raw);
    if (!parsed) {
      return {
        quotationNo: raw,
        available: false,
        reason: 'format',
        message: `"${raw}" is not a quotation number. Use the form ${example}.`,
      };
    }

    const expectedYear = issueDate ? financialYearOf(issueDate) : null;
    if (expectedYear && parsed.financialYear !== expectedYear) {
      return {
        quotationNo: parsed.quotationNo,
        available: false,
        reason: 'financial_year',
        financialYear: parsed.financialYear,
        expectedFinancialYear: expectedYear,
        message: `This number belongs to ${parsed.financialYear}, but the quotation date falls in ${expectedYear}. The register keeps a separate series for each financial year.`,
      };
    }

    const [byNumber, bySequence] = await Promise.all([
      Quotation.findOne({ quotationNo: parsed.quotationNo, isActive: true })
        .select('quotationNo customerName issueDate')
        .lean(),
      Quotation.findOne({
        financialYear: parsed.financialYear,
        quotationSeq: parsed.seq,
        isActive: true,
      })
        .select('quotationNo customerName issueDate')
        .lean(),
    ]);

    if (byNumber) {
      return {
        quotationNo: parsed.quotationNo,
        available: false,
        reason: 'duplicate',
        existing: { ...byNumber, _id: String(byNumber._id) },
        message: `${parsed.quotationNo} is already saved${
          byNumber.customerName ? ` for ${byNumber.customerName}` : ''
        }. Please use another quotation number.`,
      };
    }

    if (bySequence) {
      return {
        quotationNo: parsed.quotationNo,
        available: false,
        reason: 'sequence_taken',
        existing: { ...bySequence, _id: String(bySequence._id) },
        message: `Serial ${parsed.seq} of ${parsed.financialYear} is already used by ${bySequence.quotationNo}${
          bySequence.customerName ? ` (${bySequence.customerName})` : ''
        }. Please use another quotation number.`,
      };
    }

    return {
      quotationNo: parsed.quotationNo,
      available: true,
      reason: null,
      quotationSeq: parsed.seq,
      financialYear: parsed.financialYear,
      schemeCode: parsed.schemeCode,
      message: `${parsed.quotationNo} is free.`,
    };
  },

  // ==========================================================================
  // create
  // ==========================================================================
  /**
   * Everything the client needs to render the quotation form: the fixed terms,
   * the scheme list and the sizing / validity defaults. Read-only.
   */
  async getDefaults() {
    const profile = await this.resolveProfile();

    const consumerTitle = profile.quotationTitle || 'Quotation for PM Surya Ghar Muft Bijli Yojana';
    const partnerTitle = profile.partnerTitle || DEFAULT_PARTNER_TITLE;

    return {
      quotationItemLimit: profile.quotationItemLimit ?? DEFAULT_ITEM_LIMIT,
      defaultPanelWp: profile.defaultPanelWp ?? 610,
      panelSizingFactor: profile.panelSizingFactor ?? 1.2,
      validityDays: profile.validityDays ?? 7,
      defaultSchemeCode: profile.defaultSchemeCode || 'PMSGY',
      quotationNumberPrefix: profile.quotationNumberPrefix || 'SE',
      quotationTitle: consumerTitle,
      partnerTitle,
      /**
       * Both sheets described side by side, so the form can switch between them
       * without another round trip. Every text and toggle the printed document
       * depends on is here.
       */
      quotationTypes: QUOTATION_TYPES.map((type) => {
        const rules = rulesForType(type);
        const isPartnerType = type === 'partner';
        return {
          value: type,
          label: rules.label,
          title: isPartnerType ? partnerTitle : consumerTitle,
          tagline: isPartnerType ? profile.partnerTagline || DEFAULT_PARTNER_TAGLINE : '',
          showSerialColumn: rules.showSerialColumn,
          showSpecificationColumn: rules.showSpecificationColumn,
          showSections: rules.showSections,
          amountIncludesGST: rules.amountIncludesGST,
          acceptance: rules.acceptance,
          itemLimit: this.itemLimitFor(profile, type),
          terms: buildDefaultTerms(profile, type),
          paymentTerms: buildDefaultPaymentTerms(profile, type),
        };
      }),
      companyName: profile.name || '',
      schemes: (profile.schemes || [])
        .filter((scheme) => scheme.isActive !== false)
        .map((scheme) => ({ code: scheme.code, label: scheme.label || '' })),
      structures: (profile.structures || []).map((structure) => ({
        value: structure.value,
        label: structure.label || structure.value,
      })),
      terms: buildDefaultTerms(profile),
      paymentTerms: buildDefaultPaymentTerms(profile),
    };
  },

  async createQuotation(payload = {}, userId = null) {
    const profile = await this.resolveProfile();
    const input = pickCreatable(payload);

    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    if (Number.isNaN(issueDate.getTime())) throw ApiError.badRequest('A valid quotation date is required');

    const financialYear = financialYearOf(issueDate);
    if (!financialYear) throw ApiError.badRequest('A valid quotation date is required');

    let withCustomer = input;
    if (input.customer) {
      withCustomer = await this.applyCustomerDefaults(input);
    }
    if (!String(withCustomer.customerName || '').trim()) {
      throw ApiError.validation('Customer name is required', { customerName: 'Customer name is required' });
    }

    /*
     * A typed number wins over the allocated one.
     *
     * Numbers are normally taken from the sequence, but the office also issues
     * them by hand: a solar-partner quotation carries its own scheme
     * (SE/BOB/2026-27/45), and by the time it is filed the bank's printed copy
     * already shows that number, so the record has to match it. A typed number is
     * therefore parsed back into its parts — the scheme it names becomes the
     * quotation's scheme, the serial it names becomes its sequence — so the
     * register, the duplicate check and the printed document all agree.
     *
     * The financial year is the one part that is refused rather than adopted: the
     * year follows the issue date everywhere else in this module, and a number
     * from another year would file the serial under the wrong year in the
     * register. Saying so is better than filing it silently.
     */
    const requestedNo = String(payload.quotationNo || '').trim();
    const requested = requestedNo ? parseQuotationNo(requestedNo) : null;

    if (requestedNo && !requested) {
      throw ApiError.validation(`"${requestedNo}" is not a quotation number.`, {
        quotationNo: 'Use the form SE/PMSGY/2026-27/45.',
      });
    }
    if (requested && requested.financialYear !== financialYear) {
      throw ApiError.validation(
        `${requested.quotationNo} belongs to ${requested.financialYear}, but this quotation is dated in ${financialYear}.`,
        { quotationNo: `The serial must belong to ${financialYear}.` }
      );
    }

    const schemeCode =
      requested?.schemeCode || normaliseSchemeCode(withCustomer.schemeCode) || profile.defaultSchemeCode || 'PMSGY';
    if (!isValidSchemeCode(schemeCode)) {
      throw ApiError.validation(`Invalid scheme code: "${withCustomer.schemeCode}"`, {
        schemeCode: 'Scheme code must be 2-12 alphanumeric characters',
      });
    }
    const schemeLabel =
      withCustomer.schemeLabel || (profile.schemes || []).find((s) => s.code === schemeCode)?.label || '';

    // Which sheet this is. The domestic template is the default, so every
    // existing caller and every imported record keeps behaving as before.
    const quotationType = QUOTATION_TYPES.includes(withCustomer.quotationType)
      ? withCustomer.quotationType
      : DEFAULT_QUOTATION_TYPE;
    const typeRules = rulesForType(quotationType);

    // Panel sizing: the caller's value wins, otherwise suggest one from the
    // company's panel watt-peak and DC oversizing factor.
    const panelWp = withCustomer.panelWp ?? profile.defaultPanelWp ?? null;
    const panelQty =
      withCustomer.panelQty ??
      calculatePanelQty(withCustomer.systemSizeKW, panelWp, profile.panelSizingFactor ?? 1.2) ??
      null;

    // BOQ: use what was sent, otherwise start from the company's template.
    const hasItems = Array.isArray(withCustomer.items) && withCustomer.items.length > 0;
    const items = hasItems
      ? normaliseItems(withCustomer.items)
      : buildDefaultItems(profile, {
          quotationType,
          systemSizeKW: withCustomer.systemSizeKW,
          panelWp,
          panelQty,
          inverterCapacityKW: withCustomer.inverterCapacityKW,
          panelBrand: withCustomer.panelBrand,
          inverterBrand: withCustomer.inverterBrand,
          structureType: withCustomer.structureType,
        });
    this.assertItemLimit(items, profile, quotationType);

    const inverterCapacityKW = withCustomer.inverterCapacityKW ?? withCustomer.systemSizeKW ?? null;

    const amount =
      withCustomer.amount !== undefined
        ? withCustomer.amount
        : this.sumItemAmounts(items);
    // Fixed company-wide terms for this sheet, copied onto the quotation so a
    // reprint shows the wording that applied on the day it was issued.
    const terms = buildDefaultTerms(profile, quotationType);
    const paymentTerms = buildDefaultPaymentTerms(profile, quotationType);

    const systemOverview =
      withCustomer.systemOverview ||
      buildSystemOverview(profile, {
        quotationType,
        systemSizeKW: withCustomer.systemSizeKW,
        inverterCapacityKW,
        structureType: withCustomer.structureType || profile.defaultStructure,
      });

    const baseDoc = {
      schemeCode,
      schemeLabel,
      quotationType,
      customer: withCustomer.customer || null,
      customerName: String(withCustomer.customerName).trim(),
      consumerId: withCustomer.consumerId || '',
      phoneNo: withCustomer.phoneNo || '',
      addressLine1: withCustomer.addressLine1 || '',
      addressLine2: withCustomer.addressLine2 || '',
      district: withCustomer.district || '',
      pincode: withCustomer.pincode || '',
      shipTo: withCustomer.shipTo || {},
      systemSizeKW: withCustomer.systemSizeKW,
      panelWp,
      panelQty,
      panelBrand: withCustomer.panelBrand || '',
      inverterCapacityKW,
      inverterBrand: withCustomer.inverterBrand || '',
      structureType: withCustomer.structureType || profile.defaultStructure,
      systemOverview,
      items,
      amount: amount ?? null,
      // The domestic sheet quotes a GST-inclusive figure; the project sheet
      // quotes before tax and states the rate in its terms. The caller may
      // always override.
      amountIncludesGST:
        withCustomer.amountIncludesGST !== undefined
          ? withCustomer.amountIncludesGST
          : typeRules.amountIncludesGST,
      amountInWords: withCustomer.amountInWords || (amount !== null && amount !== undefined ? amountInWords(amount) : ''),
      terms,
      paymentTerms,
      companySnapshot: buildCompanySnapshot(profile, quotationType),
      issueDate,
      validUntil: withCustomer.validUntil ? new Date(withCustomer.validUntil) : null,
      validityDays: withCustomer.validityDays ?? profile.validityDays ?? null,
      status: withCustomer.status || 'draft',
      notes: withCustomer.notes || '',
      createdBy: userId,
      updatedBy: userId,
    };

    let lastError = null;

    /*
     * A typed number is used exactly as given — one attempt, no retry.
     *
     * The retry loop below exists to race for the next *free* serial. Here there
     * is nothing to race for: retrying would issue the quotation under a number
     * other than the one the office wrote on the consumer's paper copy, which is
     * worse than refusing the save.
     */
    if (requested) {
      try {
        const created = await Quotation.create({
          ...baseDoc,
          quotationNo: requested.quotationNo,
          quotationSeq: requested.seq,
          financialYear,
        });

        logger.info(
          `Quotation created with a typed number: ${requested.quotationNo} for ${created.customerName}`
        );

        return { quotation: created.toObject({ virtuals: true }), attempts: 1 };
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          if (error instanceof ApiError) throw error;
          logger.error('Quotation creation failed:', error);
          throw error;
        }

        // Someone took it between the availability check and this save, or the
        // clash is on the serial rather than the number — either way, name the
        // holder instead of answering "duplicate key".
        const verdict = await this.checkNumber(requested.quotationNo, { issueDate });
        throw ApiError.conflict(
          verdict.available
            ? `${requested.quotationNo} was taken a moment ago. Please use another quotation number.`
            : verdict.message
        );
      }
    }

    for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
      const quotationSeq = (await Quotation.getMaxSequence(financialYear)) + 1;
      const quotationNo = buildQuotationNo({
        prefix: profile.quotationNumberPrefix,
        schemeCode,
        financialYear,
        seq: quotationSeq,
      });

      try {
        const created = await Quotation.create({ ...baseDoc, quotationNo, quotationSeq, financialYear });
        logger.info(`Quotation created: ${quotationNo} for ${created.customerName}`);

        // The create response must not depend on a second read succeeding.
        return { quotation: created.toObject({ virtuals: true }), attempts: attempt };
      } catch (error) {
        lastError = error;

        if (isDuplicateKeyError(error)) {
          logger.warn(`Quotation number collision on ${quotationNo} (attempt ${attempt}), retrying`);
          continue; // someone else took that sequence slot - recompute and retry
        }
        if (error instanceof ApiError) throw error;
        logger.error('Quotation creation failed:', error);
        throw error;
      }
    }

    logger.error('Quotation number allocation exhausted retries', lastError);
    throw ApiError.conflict(
      'Could not allocate a quotation number because of concurrent activity. Please try again.'
    );
  },

  // ==========================================================================
  // read
  // ==========================================================================
  buildListFilter(query = {}) {
    const filter = {};

    if (query.includeDeleted === true || query.includeDeleted === 'true') {
      // no isActive restriction
    } else if (query.onlyDeleted === true || query.onlyDeleted === 'true') {
      filter.isActive = false;
    } else {
      filter.isActive = true;
    }

    if (query.financialYear) filter.financialYear = query.financialYear;
    if (query.schemeCode) filter.schemeCode = normaliseSchemeCode(query.schemeCode);
    if (query.status) filter.status = query.status;
    if (query.customer && mongoose.isValidObjectId(query.customer)) filter.customer = query.customer;
    if (query.isHistorical !== undefined && query.isHistorical !== '') {
      filter.isHistorical = query.isHistorical === true || query.isHistorical === 'true';
    }

    if (query.dateFrom || query.dateTo) {
      filter.issueDate = {};
      if (query.dateFrom) filter.issueDate.$gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const to = new Date(query.dateTo);
        to.setHours(23, 59, 59, 999);
        filter.issueDate.$lte = to;
      }
    }

    const regex = containsRegex(query.search);
    if (regex) {
      filter.$or = [
        { quotationNo: regex },
        { customerName: regex },
        { consumerId: regex },
        { phoneNo: regex },
      ];
    }

    return filter;
  },

  buildSort(query = {}) {
    const allowed = {
      quotationSeq: 'quotationSeq',
      issueDate: 'issueDate',
      customerName: 'customerName',
      amount: 'amount',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      status: 'status',
    };
    const field = allowed[query.sortBy] || 'quotationSeq';
    const order = query.sortOrder === 'asc' ? 1 : -1;

    // A stable secondary key keeps pagination deterministic.
    return order === -1 ? { [field]: -1, _id: -1 } : { [field]: 1, _id: 1 };
  },

  async listQuotations(query = {}) {
    const page = Number.parseInt(query.page ?? 1, 10) || 1;
    const limit = Number.parseInt(query.limit ?? 20, 10) || 20;
    const filter = this.buildListFilter(query);
    const sort = this.buildSort(query);

    const [items, total] = await Promise.all([
      Quotation.find(filter)
        .populate('customer', 'name customerId phone consumerId city')
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean({ virtuals: true }),
      Quotation.countDocuments(filter),
    ]);

    return {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
    };
  },

  async getQuotationById(id, options = {}) {
    assertValidObjectId(id);

    const query = Quotation.findById(id).populate('customer', 'name customerId phone consumerId city pincode address');
    if (options.includeDeleted) query.setOptions({ includeDeleted: true });

    const quotation = await query;
    if (!quotation) throw ApiError.notFound('Quotation');
    return quotation;
  },

  /**
   * The Quotation SL Number register — same four columns as the manual sheet.
   * Ordered by financial year then sequence, which reproduces the original
   * sheet order (SE/GP/2026-27/10, SE/SOLAR/2026-27/11, SE/PMSGY/2026-27/17, ...).
   */
  async getRegister(query = {}) {
    const page = Number.parseInt(query.page ?? 1, 10) || 1;
    const limit = Number.parseInt(query.limit ?? 50, 10) || 50;

    const filter = {};
    if (query.onlyDeleted === true || query.onlyDeleted === 'true') {
      filter.isActive = false;
    } else if (!(query.includeDeleted === true || query.includeDeleted === 'true')) {
      filter.isActive = true;
    }
    if (query.financialYear) filter.financialYear = query.financialYear;
    if (query.schemeCode) filter.schemeCode = normaliseSchemeCode(query.schemeCode);

    const regex = containsRegex(query.search);
    if (regex) {
      filter.$or = [{ quotationNo: regex }, { customerName: regex }, { consumerId: regex }];
    }

    const [rows, total] = await Promise.all([
      Quotation.find(filter)
        .sort({ financialYear: 1, quotationSeq: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select(
          'quotationNo quotationSeq financialYear schemeCode customerName consumerId issueDate status amount isHistorical isActive importedSlNo attachments'
        )
        .lean(),
      Quotation.countDocuments(filter),
    ]);

    const offset = (page - 1) * limit;

    return {
      rows: rows.map((row, index) => ({
        slNo: offset + index + 1,
        id: row._id,
        quotationNo: row.quotationNo,
        details: row.customerName,
        consumerId: row.consumerId || '',
        date: row.issueDate,
        financialYear: row.financialYear,
        quotationSeq: row.quotationSeq,
        schemeCode: row.schemeCode,
        status: row.status,
        amount: row.amount,
        isHistorical: Boolean(row.isHistorical),
        isDeleted: row.isActive === false,
        importedSlNo: row.importedSlNo,
        attachmentCount: Array.isArray(row.attachments) ? row.attachments.length : 0,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
    };
  },

  async getStats(query = {}) {
    const profile = await this.resolveProfile();
    const financialYear = query.financialYear || financialYearOf(new Date());
    const range = financialYearRange(financialYear);

    const match = { isActive: true, financialYear };

    const [result] = await Quotation.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalQuotations: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ['$amount', 0] } },
          byStatus: { $push: '$status' },
          historical: { $sum: { $cond: ['$isHistorical', 1, 0] } },
          maxSequence: { $max: '$quotationSeq' },
        },
      },
    ]);

    const byStatus = (result?.byStatus || []).reduce((acc, status) => {
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    const maxSequence = result?.maxSequence ?? 0;
    const nextSeq = maxSequence + 1;

    return {
      financialYear,
      financialYearRange: range,
      totalQuotations: result?.totalQuotations ?? 0,
      totalAmount: Math.round((result?.totalAmount ?? 0) * 100) / 100,
      byStatus,
      historical: result?.historical ?? 0,
      maxSequence,
      nextNumber: buildQuotationNo({
        prefix: profile.quotationNumberPrefix,
        schemeCode: profile.defaultSchemeCode || 'PMSGY',
        financialYear,
        seq: nextSeq,
      }),
      nextSequence: nextSeq,
    };
  },

  // ==========================================================================
  // update
  // ==========================================================================
  async updateQuotation(id, payload = {}, userId = null) {
    assertValidObjectId(id);

    const quotation = await Quotation.findById(id);
    if (!quotation) throw ApiError.notFound('Quotation');
    if (quotation.isActive === false) {
      throw ApiError.conflict('This quotation is deleted. Restore it before editing.');
    }

    const input = pickCreatable(payload);
    for (const forbidden of NON_UPDATABLE_FIELDS) {
      delete input[forbidden];
    }

    // The quotation number embeds the scheme, so the scheme is immutable once a
    // number has been issued - otherwise the number and the record would disagree.
    if (input.schemeCode && normaliseSchemeCode(input.schemeCode) !== quotation.schemeCode) {
      throw ApiError.conflict(
        `The scheme cannot be changed after the quotation number (${quotation.quotationNo}) has been issued. Delete this quotation and create a new one for a different scheme.`
      );
    }
    delete input.schemeCode;
    delete input.schemeLabel;

    /*
     * The sheet itself may be corrected before anything is printed - a domestic
     * quotation that turns out to be a partner order, or the reverse.
     *
     * Terms and payment terms are never written by a client: they are fixed
     * company-wide per sheet, so switching type re-copies them from the profile
     * exactly the way creation does. The BOQ lines are left untouched; the
     * caller is editing those in the same request when they need to.
     */
    const typeChanged = Boolean(input.quotationType) && input.quotationType !== quotation.quotationType;
    const effectiveType = input.quotationType || quotation.quotationType;
    let updateProfile = null;

    if (typeChanged) {
      updateProfile = await this.resolveProfile();
      input.terms = buildDefaultTerms(updateProfile, effectiveType);
      input.paymentTerms = buildDefaultPaymentTerms(updateProfile, effectiveType);
    }

    const previousValues = {};
    const changedFields = [];
    const wasConverted = quotation.status === 'converted' || Boolean(quotation.convertedInstallation);

    // Checked whenever the lines change *or* the sheet does — switching a
    // 29-line project BOQ to the domestic sheet has to be refused, since that
    // sheet has to fit one page.
    if (Array.isArray(input.items) || typeChanged) {
      if (!updateProfile) updateProfile = await this.resolveProfile();
      const items = Array.isArray(input.items) ? normaliseItems(input.items) : quotation.items;
      this.assertItemLimit(items, updateProfile, effectiveType);
      if (Array.isArray(input.items)) input.items = items;
    }

    // terms / paymentTerms are not updatable - they are fixed company-wide.
    if (input.validUntil) input.validUntil = new Date(input.validUntil);
    if (input.issueDate) input.issueDate = new Date(input.issueDate);
    if (input.customer) assertValidObjectId(input.customer, 'Customer');

    // Amount resolution: an explicit amount wins; otherwise follow the BOQ line
    // amounts; otherwise keep whatever the quotation already had.
    const effectiveItems = Array.isArray(input.items) ? input.items : quotation.items;
    if (input.amount === undefined) {
      const summed = this.sumItemAmounts(effectiveItems);
      if (summed !== null) input.amount = summed;
    }
    if (input.amount !== undefined) {
      input.amount = input.amount === null ? null : Number(input.amount);
      if (input.amountInWords === undefined) {
        input.amountInWords = input.amount === null ? '' : amountInWords(input.amount);
      }
    }

    // Keep the derived overview in step when the system changes and the caller
    // did not supply new wording.
    if (input.systemOverview === undefined && (input.systemSizeKW !== undefined || input.structureType !== undefined || input.inverterCapacityKW !== undefined)) {
      const profile = await this.resolveProfile();
      input.systemOverview = buildSystemOverview(profile, {
        quotationType: effectiveType,
        systemSizeKW: input.systemSizeKW ?? quotation.systemSizeKW,
        inverterCapacityKW: input.inverterCapacityKW ?? quotation.inverterCapacityKW ?? quotation.systemSizeKW,
        structureType: input.structureType ?? quotation.structureType,
      });
    }

    for (const [key, value] of Object.entries(input)) {
      const before = quotation.get(key);
      const beforeComparable = before && typeof before.toObject === 'function' ? before.toObject() : before;
      const changed = JSON.stringify(beforeComparable ?? null) !== JSON.stringify(value ?? null);
      if (!changed) continue;

      changedFields.push(key);
      previousValues[key] = beforeComparable ?? null;
      quotation.set(key, value);
    }

    if (changedFields.length === 0) {
      return {
        quotation,
        changedFields,
        warnings: [],
        message: 'No changes were detected.',
      };
    }

    quotation.updatedBy = userId;
    quotation.revisions.push({
      at: new Date(),
      by: userId,
      action: 'update',
      changedFields,
      previousValues,
    });

    await quotation.save();

    const warnings = [];
    if (wasConverted && ['systemSizeKW', 'structureType', 'amount', 'items'].some((f) => changedFields.includes(f))) {
      warnings.push(
        'This quotation is already linked to an installation. The installation was NOT updated automatically.'
      );
    }

    logger.info(`Quotation updated: ${quotation.quotationNo} (${changedFields.join(', ')})`);

    return { quotation, changedFields, warnings, message: 'Quotation updated' };
  },

  async changeStatus(id, status, userId = null) {
    assertValidObjectId(id);

    const quotation = await Quotation.findById(id);
    if (!quotation) throw ApiError.notFound('Quotation');
    if (quotation.isActive === false) {
      throw ApiError.conflict('This quotation is deleted. Restore it before changing its status.');
    }
    if (quotation.status === status) {
      return { quotation, changed: false, message: `Quotation is already ${status}` };
    }

    const previous = quotation.status;
    quotation.status = status;
    quotation.updatedBy = userId;
    quotation.revisions.push({
      at: new Date(),
      by: userId,
      action: 'status_change',
      changedFields: ['status'],
      previousValues: { status: previous },
    });

    await quotation.save();
    logger.info(`Quotation status changed: ${quotation.quotationNo} ${previous} -> ${status}`);

    return { quotation, changed: true, message: `Status changed from ${previous} to ${status}` };
  },

  // ==========================================================================
  // soft delete / restore
  // ==========================================================================
  async deleteQuotation(id, userId = null, reason = '') {
    assertValidObjectId(id);

    const quotation = await Quotation.findById(id);
    if (!quotation) throw ApiError.notFound('Quotation');
    if (quotation.isActive === false) {
      throw ApiError.conflict('This quotation is already deleted.');
    }
    if (quotation.convertedInstallation) {
      throw ApiError.conflict(
        'This quotation is linked to an installation and cannot be deleted. Remove the installation link first.'
      );
    }

    const { financialYear, quotationSeq, quotationNo } = quotation;

    quotation.isActive = false;
    quotation.deletedAt = new Date();
    quotation.deletedBy = userId;
    quotation.deleteReason = reason || '';
    quotation.updatedBy = userId;
    quotation.revisions.push({
      at: new Date(),
      by: userId,
      action: 'soft_delete',
      changedFields: ['isActive'],
      previousValues: { isActive: true },
    });

    await quotation.save();

    // Recompute the tail AFTER the delete so the caller can tell the user
    // whether the freed number will be reused.
    const maxAfter = await Quotation.getMaxSequence(financialYear);
    const numberFreed = quotationSeq > maxAfter;

    logger.info(
      `Quotation soft deleted: ${quotationNo} (number ${numberFreed ? 'released for reuse' : 'gap preserved'})`
    );

    return {
      quotation,
      numberFreed,
      financialYear,
      deletedSequence: quotationSeq,
      nextSequence: maxAfter + 1,
      message: numberFreed
        ? `Quotation ${quotationNo} deleted. Its number is free again and the next quotation will reuse it.`
        : `Quotation ${quotationNo} deleted. The next quotation will continue after the highest number in use.`,
    };
  },

  async restoreQuotation(id, userId = null, options = {}) {
    assertValidObjectId(id);
    const assignNewNumber = options.assignNewNumber === true;

    const quotation = await Quotation.findById(id);
    if (!quotation) throw ApiError.notFound('Quotation');
    if (quotation.isActive !== false) {
      throw ApiError.conflict('This quotation is not deleted.');
    }

    const conflict = await Quotation.findOne({
      _id: { $ne: quotation._id },
      isActive: true,
      $or: [
        { quotationNo: quotation.quotationNo },
        { financialYear: quotation.financialYear, quotationSeq: quotation.quotationSeq },
      ],
    })
      .select('_id quotationNo customerName')
      .lean();

    if (conflict && !assignNewNumber) {
      throw new ApiError(
        409,
        `Quotation number ${quotation.quotationNo} has since been issued to "${conflict.customerName}". Restore with a new number instead.`,
        'QUOTATION_NUMBER_IN_USE',
        { conflictingQuotationId: conflict._id, conflictingQuotationNo: conflict.quotationNo }
      );
    }

    const profile = await this.resolveProfile();
    const previousNumber = quotation.quotationNo;

    if (conflict && assignNewNumber) {
      const financialYear = financialYearOf(quotation.issueDate) || quotation.financialYear;
      const quotationSeq = (await Quotation.getMaxSequence(financialYear)) + 1;
      quotation.financialYear = financialYear;
      quotation.quotationSeq = quotationSeq;
      quotation.quotationNo = buildQuotationNo({
        prefix: profile.quotationNumberPrefix,
        schemeCode: quotation.schemeCode,
        financialYear,
        seq: quotationSeq,
      });
    }

    quotation.isActive = true;
    quotation.deletedAt = null;
    quotation.deletedBy = null;
    quotation.deleteReason = '';
    quotation.updatedBy = userId;
    quotation.revisions.push({
      at: new Date(),
      by: userId,
      action: conflict ? 'restore_reassigned' : 'restore',
      changedFields: ['isActive'],
      previousValues: { isActive: false, quotationNo: previousNumber },
    });

    await quotation.save();
    logger.info(`Quotation restored: ${quotation.quotationNo}`);

    return {
      quotation,
      reassigned: Boolean(conflict),
      previousNumber: conflict ? previousNumber : null,
      message: conflict
        ? `Quotation restored with the new number ${quotation.quotationNo}.`
        : `Quotation ${quotation.quotationNo} restored.`,
    };
  },

  // ==========================================================================
  // attachments
  // ==========================================================================
  async addAttachment(id, file, kind = 'original_manual', userId = null) {
    assertValidObjectId(id);
    if (!file) throw ApiError.badRequest('A file is required');

    const quotation = await Quotation.findById(id);
    if (!quotation) throw ApiError.notFound('Quotation');

    let uploaded;
    try {
      uploaded = await uploadToCloudinaryDetailed(file, { folder: `quotations/${quotation.quotationNo.replace(/\//g, '-')}` });
    } catch (error) {
      logger.error('Quotation attachment upload failed:', error);
      throw new ApiError(502, 'The file could not be stored. Please check the file storage configuration.', 'STORAGE_ERROR');
    }

    quotation.attachments.push({
      kind,
      url: uploaded.url,
      publicId: uploaded.publicId || null,
      fileName: file.originalname || '',
      fileSize: uploaded.bytes ?? file.size ?? null,
      mimeType: file.mimetype || '',
      uploadedAt: new Date(),
      uploadedBy: userId,
    });
    quotation.updatedBy = userId;
    await quotation.save();

    return quotation.attachments[quotation.attachments.length - 1];
  },

  async removeAttachment(id, attachmentId, userId = null) {
    assertValidObjectId(id, 'Quotation');

    const quotation = await Quotation.findById(id);
    if (!quotation) throw ApiError.notFound('Quotation');

    const attachment = quotation.attachments.id(attachmentId);
    if (!attachment) throw ApiError.notFound('Attachment');

    const { publicId } = attachment;
    attachment.deleteOne();
    quotation.updatedBy = userId;
    await quotation.save();

    // Best effort: the database is already consistent even if this fails.
    if (publicId) await deleteFromCloudinary(publicId);

    return { removed: true, attachmentId };
  },
};

export default quotationService;
