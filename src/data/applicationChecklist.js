// src/data/applicationChecklist.js
/**
 * The field-agent document checklist (Sulekha Engineering — PM Surya Ghar
 * Document Checklist). This is the single source of truth for what an agent has
 * to collect at the consumer's house: the API validates against it and the form
 * renders from it, so the two can never drift apart.
 *
 * The `labelBn` strings are the Bengali wording printed on the paper checklist
 * that the agents carry; keep them in sync with that sheet.
 */

/**
 * The electricity-board bill portal. Agents open this, enter the Consumer ID and
 * Installation ID, and download the bill. The app deep-links here (see
 * buildBillPortalUrl) so the agent never has to hunt for the URL.
 */
export const BILL_PORTAL_URL =
  'https://portal.wbsedcl.in/irj/go/km/docs/bills/IFRAME/ViewBillWithoutLogin.html';

const ALLOWED_HOSTS = ['portal.wbsedcl.in'];

/**
 * Build the bill-portal URL, optionally pre-filling the two ids.
 *
 * The portal's own form is filled in manually — it takes no documented query
 * string — so the ids are only appended when a caller explicitly asks for it
 * (`withIds`). Even then this only ever produces a URL on the WBSEDCL host:
 * nothing here can be turned into an open redirect by a crafted consumer id.
 */
export const buildBillPortalUrl = ({ consumerId, installationNo, withIds = false } = {}) => {
  if (!withIds) return BILL_PORTAL_URL;

  const params = new URLSearchParams();
  if (consumerId) params.set('consumerId', consumerId);
  if (installationNo) params.set('installationNo', installationNo);

  const query = params.toString();
  return query ? `${BILL_PORTAL_URL}?${query}` : BILL_PORTAL_URL;
};

/** Guard for anything that stores or echoes a bill-portal URL. */
export const isTrustedBillPortalUrl = (value) => {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
};

/**
 * Document kinds an agent collects. `required` is enforced on submit; the rest
 * can be attached later (e.g. the signed quotation after the consumer signs).
 */
export const CHECKLIST_DOCUMENTS = [
  {
    kind: 'aadhaar',
    label: 'Aadhaar card',
    labelBn: 'আধার কার্ড (Aadhaar)',
    hint: 'Both sides, all four corners visible, name and number readable.',
    hintBn: 'স্পষ্ট স্ক্যান / ছবি',
    required: true,
  },
  {
    kind: 'panCard',
    label: 'PAN card',
    labelBn: 'প্যান কার্ড (PAN)',
    hint: 'Name and PAN number must be readable.',
    hintBn: 'স্পষ্ট স্ক্যান / ছবি',
    required: true,
  },
  {
    kind: 'electricBill',
    label: 'Electricity bill',
    labelBn: 'ইলেকট্রিক বিল',
    hint: 'Download it from the bill portal with the Consumer ID and Installation ID.',
    hintBn: 'Consumer ID ও Installation ID নিয়ে বিল ডাউনলোড করুন',
    required: true,
  },
  {
    kind: 'rooftopPhoto',
    label: 'Rooftop photo',
    labelBn: 'রুফটপ ছবি',
    hint: 'Whole roof in daylight, nothing blocking the view.',
    hintBn: 'পরিষ্কার, ভালো আলোয় তোলা ছবি',
    required: true,
  },
  {
    kind: 'landRecord',
    label: 'Land record',
    labelBn: 'ল্যান্ড রেকর্ড (জমির কাগজ)',
    hint: 'Ownership papers for the property.',
    hintBn: 'জমির কাগজ',
    required: true,
  },
  {
    kind: 'passbookOrCheque',
    label: 'Bank passbook / cheque',
    labelBn: 'পাসবুক / চেক',
    hint: 'Account number, IFSC and branch name must be clearly visible.',
    hintBn: 'Account No, IFSC, Branch Name স্পষ্ট হতে হবে',
    required: true,
    extras: ['accountNumber', 'ifsc', 'branchName', 'accountType'],
  },
  {
    kind: 'signedQuotation',
    label: 'Signed quotation',
    labelBn: 'স্বাক্ষরিত কোটেশন',
    hint: 'Scan of the printed quotation signed by the consumer.',
    hintBn: 'consumer-এর সই করা কোটেশনের স্ক্যান',
    required: false,
    filedBy: 'office',
  },
  {
    kind: 'signedAgreement',
    label: 'Signed agreement',
    labelBn: 'স্বাক্ষরিত চুক্তিপত্র',
    hint: 'Scan of the printed agreement signed by the consumer.',
    hintBn: 'consumer-এর সই করা চুক্তিপত্রের স্ক্যান',
    required: false,
    filedBy: 'office',
  },
  {
    kind: 'other',
    label: 'Other document',
    labelBn: 'অন্যান্য নথি',
    hint: 'Anything else that supports the application.',
    hintBn: 'অন্যান্য',
    required: false,
  },
];

export const DOCUMENT_KINDS = CHECKLIST_DOCUMENTS.map((doc) => doc.kind);

/**
 * Kinds the office files and the field agent only reads.
 *
 * The quotation and the agreement are printed by the office, signed by the
 * consumer and scanned back — the agent is never the one who holds that paper,
 * so the agent may look at the copies and download them but must not be able to
 * file one. Declared here (and carried to the client through the checklist
 * endpoint) so neither side has to hardcode the list.
 */
export const OFFICE_FILED_DOCUMENT_KINDS = CHECKLIST_DOCUMENTS.filter(
  (doc) => doc.filedBy === 'office'
).map((doc) => doc.kind);

export const REQUIRED_DOCUMENT_KINDS = CHECKLIST_DOCUMENTS
  .filter((doc) => doc.required)
  .map((doc) => doc.kind);

export const documentLabel = (kind) =>
  CHECKLIST_DOCUMENTS.find((doc) => doc.kind === kind)?.label || kind;

/**
 * The Bengali name of a document kind.
 *
 * The field agents read Bengali, so anything addressed to them — the signed-copy
 * notice and its email — names the document from here rather than from the
 * English `label`, which is what the office's screens show.
 */
export const documentLabelBn = (kind) =>
  CHECKLIST_DOCUMENTS.find((doc) => doc.kind === kind)?.labelBn || kind;

/**
 * Where the system will be installed. `high_rise_structure` is a separate case
 * on the checklist because it needs a different mounting design from a plain
 * RCC rooftop.
 */
export const SITE_TYPES = [
  { value: 'rcc_rooftop', label: 'RCC rooftop', labelBn: 'আরসিসি ছাদ' },
  { value: 'tin_shed', label: 'Tin shed', labelBn: 'টিন শেড' },
  { value: 'high_rise_structure', label: 'High rise structure', labelBn: 'হাই রাইজ স্ট্রাকচার' },
  { value: 'ground_mount', label: 'Ground mount', labelBn: 'গ্রাউন্ড মাউন্ট' },
];

export const SITE_TYPE_VALUES = SITE_TYPES.map((site) => site.value);

/**
 * Application lifecycle.
 *
 *   draft ──submit──▶ submitted ──▶ under_review ──┬─▶ approved ─▶ quotation_issued ─▶ agreement_issued ─▶ completed
 *                                                  ├─▶ correction_required ─▶ (agent edits) ─▶ submitted
 *                                                  └─▶ rejected
 */
export const APPLICATION_STATUSES = [
  { value: 'draft', label: 'Draft', tone: 'muted' },
  { value: 'submitted', label: 'Submitted', tone: 'info' },
  { value: 'under_review', label: 'Under review', tone: 'info' },
  { value: 'correction_required', label: 'Correction required', tone: 'warning' },
  { value: 'approved', label: 'Approved', tone: 'success' },
  { value: 'quotation_issued', label: 'Quotation issued', tone: 'success' },
  { value: 'agreement_issued', label: 'Agreement issued', tone: 'success' },
  { value: 'completed', label: 'Completed', tone: 'success' },
  { value: 'rejected', label: 'Rejected', tone: 'error' },
];

export const APPLICATION_STATUS_VALUES = APPLICATION_STATUSES.map((status) => status.value);

/**
 * Allowed moves. Anything not listed here is refused by the service, so a
 * double-click on "Approve" or a stale tab cannot skip a step.
 */
export const STATUS_TRANSITIONS = {
  draft: ['submitted', 'rejected'],
  submitted: ['under_review', 'correction_required', 'approved', 'rejected'],
  under_review: ['correction_required', 'approved', 'rejected'],
  correction_required: ['submitted', 'rejected'],
  approved: ['quotation_issued', 'rejected'],
  quotation_issued: ['agreement_issued', 'rejected'],
  agreement_issued: ['completed'],
  completed: [],
  rejected: ['under_review'],
};

/** Statuses an agent may still edit freely. */
export const AGENT_EDITABLE_STATUSES = ['draft', 'correction_required'];

/** Statuses where the file set is still open (documents may be added/removed). */
export const DOCUMENT_EDITABLE_STATUSES = [
  'draft',
  'correction_required',
  'submitted',
  'under_review',
];

export const canTransition = (from, to) =>
  Boolean(STATUS_TRANSITIONS[from] && STATUS_TRANSITIONS[from].includes(to));

export default {
  BILL_PORTAL_URL,
  buildBillPortalUrl,
  isTrustedBillPortalUrl,
  CHECKLIST_DOCUMENTS,
  DOCUMENT_KINDS,
  REQUIRED_DOCUMENT_KINDS,
  documentLabel,
  SITE_TYPES,
  SITE_TYPE_VALUES,
  APPLICATION_STATUSES,
  APPLICATION_STATUS_VALUES,
  STATUS_TRANSITIONS,
  AGENT_EDITABLE_STATUSES,
  DOCUMENT_EDITABLE_STATUSES,
  canTransition,
};
