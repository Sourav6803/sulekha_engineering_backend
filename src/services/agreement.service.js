// src/services/agreement.service.js
import mongoose from 'mongoose';
import { Agreement, CompanyProfile, Quotation } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { containsRegex } from '../utils/escapeRegex.js';
import { buildPaymentSchedule, composeConsumerLine } from '../utils/agreementText.js';
import { DEFAULT_DISCOM, DEFAULT_REGISTERED_OFFICE, PAYMENT_STAGES } from '../data/agreementContent.js';

/** Fields a client may write. Anything else is ignored. */
const WRITABLE_FIELDS = [
  'consumerName',
  'consumerId',
  'relationLine',
  'address',
  'discom',
  'agreementDate',
  'amount',
  'quotation',
  'notes',
];

const SORTABLE_FIELDS = ['agreementDate', 'createdAt', 'updatedAt', 'consumerName', 'amount'];

const pick = (source = {}, fields = WRITABLE_FIELDS) => {
  const target = {};
  fields.forEach((field) => {
    if (source[field] !== undefined) target[field] = source[field];
  });
  return target;
};

/** Company details frozen onto the agreement, in the wording that page 1 prints. */
export const buildAgreementSnapshot = (profile = {}) => ({
  name: profile.name || '',
  registeredOffice: profile.registeredOffice || DEFAULT_REGISTERED_OFFICE,
  phone: profile.phone || '',
  email: profile.email || '',
  gstn: profile.gstn || '',
  logoPath: profile.logoPath || '',
});

/** Compose the consumer address from a quotation's separate address fields. */
const addressFromQuotation = (quotation = {}) =>
  [
    quotation.addressLine1,
    quotation.addressLine2,
    quotation.district,
    quotation.pincode ? `Pin- ${quotation.pincode}` : '',
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');

export const agreementService = {
  async resolveProfile() {
    return CompanyProfile.getProfile();
  },

  /** Values the form needs: defaults and the fixed payment wording. */
  async getDefaults() {
    const profile = await this.resolveProfile();

    return {
      discom: profile.discom || DEFAULT_DISCOM,
      registeredOffice: profile.registeredOffice || DEFAULT_REGISTERED_OFFICE,
      companyName: profile.name || '',
      paymentStages: PAYMENT_STAGES.map((stage) => ({
        label: stage.label,
        percent: stage.percent,
        note: stage.note,
      })),
      /** Common relation prefixes; the field itself stays free text. */
      relationOptions: ['W/o-', 'S/o-', 'D/o-', 'C/o-'],
    };
  },

  /**
   * Create an agreement. A quotation may be linked, in which case the consumer
   * details and the amount are prefilled from it - anything sent explicitly wins.
   */
  async createAgreement(payload = {}, userId = null) {
    const profile = await this.resolveProfile();
    const data = pick(payload);

    if (data.quotation) {
      if (!mongoose.isValidObjectId(data.quotation)) {
        throw ApiError.badRequest('Invalid quotation id');
      }

      const quotation = await Quotation.findById(data.quotation).lean();
      if (!quotation) throw ApiError.notFound('Quotation not found');

      data.consumerName = data.consumerName || quotation.customerName || '';
      data.consumerId = data.consumerId || quotation.consumerId || '';
      data.address = data.address || addressFromQuotation(quotation);
      if (data.amount === undefined || data.amount === null) {
        data.amount = quotation.amount ?? 0;
      }
      data.quotationNo = quotation.quotationNo || '';
    }

    if (!String(data.consumerName || '').trim()) {
      throw ApiError.validation('Consumer name is required', {
        consumerName: 'Consumer name is required',
      });
    }
    if (!String(data.address || '').trim()) {
      throw ApiError.validation('Consumer address is required', {
        address: 'Consumer address is required',
      });
    }
    if (data.amount === undefined || data.amount === null) {
      throw ApiError.validation('Agreement amount is required', { amount: 'Amount is required' });
    }

    const agreement = new Agreement({
      ...data,
      discom: data.discom || profile.discom || DEFAULT_DISCOM,
      companySnapshot: buildAgreementSnapshot(profile),
      createdBy: userId,
      updatedBy: userId,
    });

    await agreement.save();
    return agreement.toObject({ virtuals: true });
  },

  async listAgreements(query = {}) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));

    const filter = {};
    if (query.includeDeleted === true || query.includeDeleted === 'true') {
      // no isActive filter
    } else {
      filter.isActive = true;
    }

    if (query.search) {
      const pattern = containsRegex(query.search);
      filter.$or = [
        { consumerName: pattern },
        { consumerId: pattern },
        { address: pattern },
        { quotationNo: pattern },
      ];
    }

    if (query.dateFrom || query.dateTo) {
      filter.agreementDate = {};
      if (query.dateFrom) filter.agreementDate.$gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const to = new Date(query.dateTo);
        to.setHours(23, 59, 59, 999);
        filter.agreementDate.$lte = to;
      }
    }

    const sortBy = SORTABLE_FIELDS.includes(query.sortBy) ? query.sortBy : 'agreementDate';
    const sortOrder = String(query.sortOrder).toLowerCase() === 'asc' ? 1 : -1;

    const [items, total] = await Promise.all([
      Agreement.find(filter)
        .sort({ [sortBy]: sortOrder, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean({ virtuals: true }),
      Agreement.countDocuments(filter),
    ]);

    return {
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async getAgreementById(id) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid agreement id');

    const agreement = await Agreement.findById(id)
      .populate('quotation', 'quotationNo customerName systemSizeKW')
      .lean({ virtuals: true });

    if (!agreement) throw ApiError.notFound('Agreement not found');
    return agreement;
  },

  async updateAgreement(id, payload = {}, userId = null) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid agreement id');

    const agreement = await Agreement.findById(id);
    if (!agreement) throw ApiError.notFound('Agreement not found');
    if (!agreement.isActive) throw ApiError.conflict('This agreement has been deleted');

    const data = pick(payload);

    if (data.quotation !== undefined && data.quotation && !mongoose.isValidObjectId(data.quotation)) {
      throw ApiError.badRequest('Invalid quotation id');
    }

    const before = agreement.toObject();
    Object.entries(data).forEach(([key, value]) => {
      agreement[key] = value;
    });

    if (data.quotation) {
      const quotation = await Quotation.findById(data.quotation).lean();
      if (!quotation) throw ApiError.notFound('Quotation not found');
      agreement.quotationNo = quotation.quotationNo || '';
    }

    agreement.updatedBy = userId;
    // The pre-validate hook rebuilds the payment schedule from the new amount.
    await agreement.save();

    const changedFields = Object.keys(data).filter((key) => {
      const beforeValue = before[key];
      const afterValue = agreement[key];
      return JSON.stringify(beforeValue ?? null) !== JSON.stringify(afterValue ?? null);
    });

    return { agreement: agreement.toObject({ virtuals: true }), changedFields };
  },

  async deleteAgreement(id, userId = null, reason = '') {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid agreement id');

    const agreement = await Agreement.findById(id);
    if (!agreement) throw ApiError.notFound('Agreement not found');
    if (!agreement.isActive) throw ApiError.conflict('This agreement has already been deleted');

    agreement.isActive = false;
    agreement.deletedAt = new Date();
    agreement.deletedBy = userId;
    agreement.deleteReason = reason;
    await agreement.save();

    return {
      agreement: agreement.toObject({ virtuals: true }),
      message: `Agreement for ${agreement.consumerName} deleted`,
    };
  },

  /** Preview of the 50/40/10 split, used by the form before saving. */
  splitForAmount(amount) {
    return buildPaymentSchedule(amount);
  },

  /** The consumer line exactly as page 1 and page 4 print it. */
  consumerLineFor(agreement = {}) {
    return composeConsumerLine({
      relationLine: agreement.relationLine,
      address: agreement.address,
    });
  },
};

export default agreementService;
