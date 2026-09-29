// src/utils/quotationDefaults.js
/**
 * Builders for the default content of a quotation (BOQ lines, System Overview
 * sentence, terms). Pure functions: they take the company profile as data so
 * they can be unit-tested without a database.
 *
 * The default BOQ mirrors the 8-line template used on the existing manual
 * quotations, with the panel count, inverter capacity and structure wording
 * substituted in.
 */

import { calculatePanelQty } from './quotationNumber.js';
import { DEFAULT_OVERVIEW_TEMPLATE, DEFAULT_TERMS, DEFAULT_PAYMENT_TERMS } from '../models/CompanyProfile.js';
import {
  DEFAULT_PARTNER_OVERVIEW_TEMPLATE,
  DEFAULT_PARTNER_TERMS,
  DEFAULT_PARTNER_PAYMENT_TERMS,
  DEFAULT_PARTNER_TITLE,
  DEFAULT_PARTNER_TAGLINE,
  DEFAULT_QUOTATION_TYPE,
} from '../data/quotationTypes.js';

/** Is this the project/material sheet rather than the domestic one? */
const isPartner = (quotationType) => quotationType === 'partner';

/** Replace {{token}} placeholders. Unknown tokens are left untouched. */
export const fillTemplate = (template, values = {}) =>
  String(template ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : match
  );

/** Structure entry from the profile, with a safe fallback. */
export const resolveStructure = (profile, structureType) => {
  const list = profile?.structures || [];
  return (
    list.find((s) => s.value === structureType) ||
    list.find((s) => s.value === profile?.defaultStructure) ||
    list[0] || {
      value: structureType || 'high_rise',
      label: 'High-rise rooftop',
      defaultLine: 'solar roof top high-rise GI structures, SS nut bolt',
      overviewPhrase: 'solar roof top high rise structures',
    }
  );
};

/**
 * The System Overview paragraph from the existing template.
 * @returns {String}
 */
export const buildSystemOverview = (
  profile,
  { systemSizeKW, inverterCapacityKW, structureType, quotationType }
) => {
  const structure = resolveStructure(profile, structureType);
  const template = isPartner(quotationType)
    ? profile?.partnerOverviewTemplate || DEFAULT_PARTNER_OVERVIEW_TEMPLATE
    : profile?.overviewTemplate || DEFAULT_OVERVIEW_TEMPLATE;

  return fillTemplate(template, {
    systemSizeKW: formatNumber(systemSizeKW),
    inverterCapacityKW: formatNumber(inverterCapacityKW ?? systemSizeKW),
    structurePhrase: structure.overviewPhrase,
    structureLabel: structure.label,
  }).trim();
};

/** 3 -> "3", 3.5 -> "3.5", 5 -> "5" (never "3.0") */
const formatNumber = (value) => {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
};

/**
 * Default BOQ lines for a new quotation.
 *
 * @param {Object} profile  CompanyProfile document (or plain object)
 * @param {Object} data     { systemSizeKW, panelWp, panelQty, inverterCapacityKW, panelBrand, inverterBrand, structureType }
 * @returns {Array<{description,brandModel,qty,unit,order}>}
 */
export const buildDefaultItems = (profile, data = {}) => {
  // The domestic sheet starts from the company's eight-line template. A partner
  // sheet has no company-wide template — every project BOQ is priced line by
  // line against its own drawings — so it starts empty rather than pre-filled
  // with domestic lines that do not apply.
  if (isPartner(data.quotationType)) return [];

  const structure = resolveStructure(profile, data.structureType);
  const panelWp = data.panelWp || profile?.defaultPanelWp || 610;
  const panelQty =
    data.panelQty || calculatePanelQty(data.systemSizeKW, panelWp, profile?.panelSizingFactor ?? 1.2) || 1;
  const inverterCapacityKW = data.inverterCapacityKW ?? data.systemSizeKW ?? '';

  const templateLines = profile?.defaultItems?.length ? profile.defaultItems : [];

  return templateLines
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((line, index) => {
      let description = line.isStructureLine ? structure.defaultLine : line.description;
      description = fillTemplate(description, {
        panelWp,
        systemSizeKW: data.systemSizeKW,
        inverterCapacityKW: formatNumber(inverterCapacityKW),
      });

      let qty = line.qtyRule === 'panel' ? panelQty : Number(line.qtyRule);
      if (!Number.isFinite(qty) || qty <= 0) qty = 1;

      // Brand columns: the first line carries the panel brand, the second the inverter brand.
      let brandModel = line.brandModel || '';
      if (index === 0 && data.panelBrand) brandModel = data.panelBrand;
      if (index === 1 && data.inverterBrand) brandModel = data.inverterBrand;

      return {
        description,
        brandModel,
        qty,
        unit: line.unit ?? null,
        amount: null,
        isOptional: false,
        order: line.order ?? index + 1,
      };
    });
};

/**
 * A copy of the company's default terms (never the profile's own objects).
 *
 * The two sheets state different terms — the domestic one promises a 10-year
 * inverter warranty, the project sheet a 5-year one plus a 5-year AMC — so the
 * set is chosen by quotation type. The profile may override either set, but a
 * quotation must never print bare, hence the code-level fallbacks.
 */
export const buildDefaultTerms = (profile, quotationType) => {
  if (isPartner(quotationType)) {
    const source = profile?.partnerTerms?.length ? profile.partnerTerms : DEFAULT_PARTNER_TERMS;
    return source.map((term) => ({ label: term.label ?? null, text: term.text }));
  }
  return (profile?.defaultTerms?.length ? profile.defaultTerms : DEFAULT_TERMS).map((term) => ({
    label: term.label ?? null,
    text: term.text,
  }));
};

/** A copy of the company's default payment terms for this quotation type. */
export const buildDefaultPaymentTerms = (profile, quotationType) => {
  if (isPartner(quotationType)) {
    const source = profile?.partnerPaymentTerms?.length
      ? profile.partnerPaymentTerms
      : DEFAULT_PARTNER_PAYMENT_TERMS;
    return source.map((term) => ({ text: term.text }));
  }
  return (profile?.defaultPaymentTerms?.length ? profile.defaultPaymentTerms : DEFAULT_PAYMENT_TERMS).map(
    (term) => ({ text: term.text })
  );
};

/**
 * Snapshot of the company details frozen onto a quotation.
 *
 * Both sheet headings are frozen, not just the domestic one, so a reprint of a
 * project sheet still carries its own title and tagline even if the company
 * settings are edited afterwards. The terms are frozen for the sheet being
 * issued — the two sheets state different ones.
 */
export const buildCompanySnapshot = (profile, quotationType = DEFAULT_QUOTATION_TYPE) => ({
  name: profile?.name || '',
  addressLines: Array.isArray(profile?.addressLines) ? [...profile.addressLines] : [],
  phone: profile?.phone || '',
  email: profile?.email || '',
  gstn: profile?.gstn || '',
  stateCode: profile?.stateCode || (profile?.gstn ? profile.gstn.slice(0, 2) : ''),
  bankName: profile?.bankDetails?.bankName || '',
  accountName: profile?.bankDetails?.accountName || '',
  accountNumber: profile?.bankDetails?.accountNumber || '',
  ifsc: profile?.bankDetails?.ifsc || '',
  quotationTitle: profile?.quotationTitle || '',
  partnerTitle: profile?.partnerTitle || DEFAULT_PARTNER_TITLE,
  tagline: profile?.partnerTagline || DEFAULT_PARTNER_TAGLINE,
  logoPath: profile?.logoPath || '',
  // Fixed company-wide wording, so a reprinted quotation - including a record
  // imported from the old register - always states the standard terms.
  terms: buildDefaultTerms(profile, quotationType),
  paymentTerms: buildDefaultPaymentTerms(profile, quotationType),
});

export default {
  fillTemplate,
  resolveStructure,
  buildSystemOverview,
  buildDefaultItems,
  buildDefaultTerms,
  buildDefaultPaymentTerms,
  buildCompanySnapshot,
};
