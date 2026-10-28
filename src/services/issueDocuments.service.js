// src/services/issueDocuments.service.js
import Application from '../models/Application.js';
import { Agreement, Customer, Quotation } from '../models/index.js';
import { quotationService } from './quotation.service.js';
import { agreementService } from './agreement.service.js';
import { quotationPdfService } from './quotationPdf.service.js';
import { agreementPdfService } from './agreementPdf.service.js';
import { removeDocument, storeDocument } from './documentStorage.service.js';
import { notifyAgentOfIssuedDocuments } from './issuedDocumentNotice.service.js';
import { PAYMENT_STAGES } from '../data/agreementContent.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';

/**
 * Issuing the unsigned quotation and agreement from the application.
 *
 * Until now these documents lived in their own modules, tied to nothing: the
 * office created a quotation, printed it, and drove it to the agent — who then
 * drove it to the consumer. With the agents working up to 100 km apart, and
 * several of them signing on the same day, that is a trip per signature before
 * the customer has signed anything.
 *
 * Here the application is the source. "Issue quotation" builds the quotation
 * record from the application (identity, address, system size, agreed amount),
 * renders the PDF the module already knows how to render, and files that PDF on
 * the application as `issuedQuotation` — so the agent downloads and prints the
 * same document the register holds, without access to the quotations module.
 * The agreement follows the same path, from the quotation when one is linked.
 *
 * Re-issuing is safe: if the application already carries a quotation, its PDF is
 * re-rendered from the record (so an amount corrected in the quotations module
 * reaches the paper), and the previous copy is replaced rather than piled up.
 */

const OVERSIGHT_ROLES = ['admin', 'manager'];

const assertOffice = (user) => {
  if (!OVERSIGHT_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('Only the office can issue the quotation or the agreement.');
  }
};

const toAmount = (value) => {
  if (value === undefined || value === null || value === '') return undefined;

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) {
    throw ApiError.validation('That amount looks wrong', {
      amount: 'Enter a number up to 10,00,00,000.',
    });
  }
  return amount;
};

/**
 * The consumer ID that goes on the paper, and the guarantee that there is one.
 *
 * It is printed on both documents — on the quotation beside the consumer's name,
 * inside the agreement's first paragraph — and a blank there is a document the
 * DISCOM will hand back. Older applications never copied it from the customer,
 * so it is read from the application first and from the customer second; a value
 * found on the customer is written back, so the file stops showing a blank and
 * the next issue does not depend on the customer record at all.
 */
const requireConsumerId = async (application, subject) => {
  const onFile = String(application.electricBill?.consumerId || '').trim();
  if (onFile) return onFile;

  const customer = application.customer
    ? await Customer.findById(application.customer).select('electricBill').lean()
    : null;

  const onCustomer = String(customer?.electricBill?.consumerId || '').trim();
  if (!onCustomer) {
    throw ApiError.validation(
      `The consumer ID is missing and it is printed on the ${subject}. Record it on the electricity bill section first.`,
      { 'electricBill.consumerId': 'Enter the consumer ID from the electricity bill.' }
    );
  }

  application.set('electricBill.consumerId', onCustomer);

  return onCustomer;
};

/** The two address lines the printed documents carry. */
const addressFor = (application = {}) => {
  const address = application.address || {};
  const line1 = [address.street, address.village].filter(Boolean).join(', ') || address.fullAddress || '';
  const line2 = [address.block, address.panchayat].filter(Boolean).join(', ');

  return { line1, line2 };
};

const safeFileName = (base) =>
  String(base || 'document')
    .replace(/[/\\]+/g, '-')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .slice(0, 110) || 'document';

/**
 * Replace any earlier issue of this kind with the PDF just rendered.
 *
 * The old file is deleted from storage as well as from the array — an issued
 * document is regenerated from the record, so a stale copy on the file is a
 * wrong number waiting to be printed. The superseded signed *scans* are a
 * different matter and are never deleted (see attachSignedDocument).
 */
const fileIssuedPdf = async (application, { kind, buffer, fileName, user }) => {
  const obsolete = (application.documents || []).filter((doc) => doc.kind === kind);

  for (const doc of obsolete) {
    try {
      await removeDocument({ url: doc.url, publicId: doc.publicId });
    } catch (error) {
      // A file we cannot delete must not stop the new one being filed; the record
      // is what the office prints from.
      logger.warn(
        { applicationNo: application.applicationNo, kind, err: error.message },
        'Superseded issued document could not be removed from storage'
      );
    }
    application.documents.pull(doc._id);
  }

  const stored = await storeDocument(
    {
      buffer,
      originalname: fileName,
      mimetype: 'application/pdf',
      size: buffer.length,
    },
    { folder: `sulekha/applications/${application.applicationNo.replace(/\//g, '-')}/issued` }
  );

  application.documents.push({
    kind,
    url: stored.url,
    publicId: stored.publicId,
    fileName: stored.fileName,
    fileSize: stored.bytes,
    mimeType: 'application/pdf',
    qualityCheck: { verdict: 'skipped', score: 100, reasons: [] },
    // Nothing to approve: the office issuing it *is* the approval. The human
    // verdict exists for scans that arrive from the field, not for paper we made.
    review: { status: 'accepted', reviewedBy: user._id, reviewedAt: new Date() },
    uploadedBy: user._id,
    uploadedAt: new Date(),
  });

  return stored;
};

const renderOrRefuse = async (render, subject) => {
  try {
    return await render();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error({ err: error.message }, `Could not render ${subject} PDF`);
    throw new ApiError(
      503,
      'The PDF renderer is unavailable right now. The record was saved — try issuing again in a minute.',
      'PDF_RENDERER_UNAVAILABLE'
    );
  }
};

const linkedNumbers = async (application) => {
  const [quotation, agreement] = await Promise.all([
    application.quotation
      ? Quotation.findById(application.quotation).select('quotationNo').lean()
      : null,
    application.agreement ? Agreement.findById(application.agreement).select('amount').lean() : null,
  ]);

  return { quotationNo: quotation?.quotationNo || '', hasAgreement: Boolean(agreement) };
};

/** POST /applications/:id/issue-quotation */
export const issueQuotation = async (applicationId, body = {}, user) => {
  assertOffice(user);

  const application = await Application.findById(applicationId);
  if (!application) throw ApiError.notFound('Application');
  if (application.isActive === false) throw ApiError.badRequest('This application is deleted.');

  // Parsed before the branch: a number that is not a number is refused whether
  // this is the first issue or a re-issue with a corrected price.
  const requestedAmount = toAmount(body.amount);

  /*
   * A quotation that already exists, built in the quotations editor.
   *
   * The application card used to issue paper straight from defaults, which meant
   * the BOQ could not be touched — no rewording the panel line, no non-DCR
   * module, no quantity left as "5/6" until the survey settles it. So the office
   * now writes the quotation in the real editor (prefilled from the application)
   * and hands it back here to be linked, rendered and filed.
   *
   * The customer check is the guard rail, and it runs before anything is written:
   * an id from another household's quotation must not print its amount on this
   * consumer's paper, and must not leave a trace on this application either.
   */
  let provided = null;
  if (body.quotationId) {
    provided = await quotationService.getQuotationById(body.quotationId);

    const quotationCustomer = provided.customer ? String(provided.customer) : '';
    const applicationCustomer = application.customer ? String(application.customer) : '';
    if (quotationCustomer && applicationCustomer && quotationCustomer !== applicationCustomer) {
      throw ApiError.validation('That quotation belongs to a different customer', {
        quotationId: 'Choose this customer’s quotation.',
      });
    }
  }

  const consumerId = await requireConsumerId(application, 'quotation');

  let quotation;

  if (provided) {
    quotation = provided;

    if (!String(quotation.consumerId || '').trim()) {
      const updated = await quotationService.updateQuotation(
        quotation._id,
        { consumerId },
        user._id
      );
      quotation = updated.quotation;
    }
  } else if (application.quotation) {
    quotation = await quotationService.getQuotationById(application.quotation);

    /*
     * A re-issue with a different amount means the price moved. The quotation is
     * the record of what the consumer is being asked to pay, so the correction is
     * written to it first and the PDF is rendered from the corrected record —
     * otherwise the paper and the register would disagree. The consumer ID is
     * written the same way: a quotation created before this was copied carries a
     * blank where the DISCOM reads the number.
     */
    const changes = {};
    if (requestedAmount !== undefined && requestedAmount !== quotation.amount) {
      changes.amount = requestedAmount;
    }
    if (!String(quotation.consumerId || '').trim()) {
      changes.consumerId = consumerId;
    }

    if (Object.keys(changes).length > 0) {
      const updated = await quotationService.updateQuotation(quotation._id, changes, user._id);
      quotation = updated.quotation;
    }
  } else {
    const { line1, line2 } = addressFor(application);
    const amount =
      requestedAmount ?? application.deal?.quotedAmount ?? application.deal?.proposalAmount;

    const created = await quotationService.createQuotation(
      {
        customer: application.customer || undefined,
        customerName: application.consumerName,
        phoneNo: application.phone,
        consumerId,
        addressLine1: line1,
        addressLine2: line2,
        district: application.address?.district || '',
        pincode: application.address?.pincode || '',
        systemSizeKW: application.deal?.systemSizeKW ?? undefined,
        quotationType: 'consumer',
        amount,
        notes: `Issued from application ${application.applicationNo}`,
      },
      user._id
    );

    // createQuotation answers { quotation, attempts } — the attempts count is
    // about the serial-number race, not about this call.
    const quotationId = created?.quotation?._id || created?._id;
    quotation = await quotationService.getQuotationById(quotationId);
  }

  const rendered = await renderOrRefuse(
    () =>
      quotationPdfService.renderQuotationPdf(
        quotation.toObject ? quotation.toObject({ virtuals: true }) : quotation
      ),
    'quotation'
  );

  const fileName = `${safeFileName(`${quotation.quotationNo}-${application.consumerName}`)}.pdf`;

  await fileIssuedPdf(application, {
    kind: 'issuedQuotation',
    buffer: rendered.buffer,
    fileName,
    user,
  });

  // The link the application has always had a field for and nothing ever wrote.
  application.quotation = quotation._id;
  application.updatedBy = user._id;
  await application.save();

  logger.info(
    { applicationNo: application.applicationNo, quotationNo: quotation.quotationNo },
    'Quotation issued from application'
  );

  const { quotationNo } = await linkedNumbers(application);
  await notifyAgentOfIssuedDocuments(application, { actor: user, quotationNo });

  return {
    application,
    quotationNo: quotation.quotationNo,
    document: application.documents[application.documents.length - 1],
  };
};

/** POST /applications/:id/issue-agreement */
export const issueAgreement = async (applicationId, body = {}, user) => {
  assertOffice(user);

  const application = await Application.findById(applicationId);
  if (!application) throw ApiError.notFound('Application');
  if (application.isActive === false) throw ApiError.badRequest('This application is deleted.');

  const consumerId = await requireConsumerId(application, 'agreement');

  /*
   * The agreement prints the consumer ID inside its first paragraph and the
   * model refuses anything but 5–20 digits there — the DISCOM's own format. A
   * letter that slipped into the customer record would otherwise fail deep inside
   * a Mongoose validator and read as a server error.
   */
  if (!/^[0-9]{5,20}$/.test(consumerId)) {
    throw ApiError.validation(
      'The consumer ID must be 5 to 20 digits to print on the agreement.',
      { 'electricBill.consumerId': 'Correct the consumer ID on the electricity bill section.' }
    );
  }

  let agreement;

  /*
   * An agreement written (or edited) in the agreements screen.
   *
   * Same handoff as the quotation: the office wants the date, the address, the
   * notes and the amount under their own hand rather than generated from the
   * application, so the editor owns the record and this endpoint only links,
   * renders and files it.
   *
   * The guard matters more here than for a quotation, because an agreement has no
   * customer link to compare: the only proof it belongs here is that it is not
   * already attached to another application.
   */
  if (body.agreementId) {
    agreement = await agreementService.getAgreementById(body.agreementId);

    const alreadyLinked = await Application.findOne({
      agreement: agreement._id,
      _id: { $ne: application._id },
      isActive: true,
    })
      .select('applicationNo')
      .lean();

    if (alreadyLinked) {
      throw ApiError.validation(
        `That agreement is already on ${alreadyLinked.applicationNo || 'another application'}`,
        { agreementId: 'Write a new agreement for this application.' }
      );
    }

    if (!String(agreement.consumerId || '').trim()) {
      const updated = await agreementService.updateAgreement(
        agreement._id,
        { consumerId },
        user._id
      );
      agreement = updated.agreement;
    }
  } else if (application.agreement) {
    agreement = await agreementService.getAgreementById(application.agreement);

    /*
     * An agreement is printed with the split it was saved with, so a paper signed
     * last month keeps its 50/40/10 for ever. A *re-issue* is different: it is a
     * fresh print for the consumer, so it follows today's 70/20/10. Re-saving the
     * amount rebuilds the milestones through the same hook a normal edit uses.
     */
    const currentSplit = PAYMENT_STAGES.map((stage) => stage.percent).join('/');
    const storedSplit = (agreement.paymentSchedule ?? []).map((stage) => stage.percent).join('/');
    const scheduleOutdated = agreement.paymentSchedule?.length > 0 && storedSplit !== currentSplit;

    // Same reason as the quotation: an agreement created before this was copied
    // carries a blank where the number belongs, so the re-issue writes it in.
    if (!String(agreement.consumerId || '').trim() || scheduleOutdated) {
      const changes = { consumerId };
      if (scheduleOutdated) changes.amount = agreement.amount;

      const updated = await agreementService.updateAgreement(agreement._id, changes, user._id);
      agreement = updated.agreement;
    }
  } else {
    const quotation = application.quotation
      ? await quotationService.getQuotationById(application.quotation)
      : null;

    const amount =
      toAmount(body.amount) ??
      (quotation?.amount ?? null) ??
      application.deal?.quotedAmount ??
      application.deal?.proposalAmount;

    if (amount === undefined || amount === null) {
      throw ApiError.validation(
        'Enter the agreement amount — no quotation is linked to this application.',
        { amount: 'Enter the amount printed on the agreement.' }
      );
    }

    const { line1, line2 } = addressFor(application);
    const address = [line1, line2, application.address?.district, application.address?.pincode]
      .filter(Boolean)
      .join(', ');

    const created = await agreementService.createAgreement(
      {
        consumerName: application.consumerName,
        consumerId,
        address,
        amount,
        quotation: application.quotation || undefined,
        agreementDate: new Date(),
        notes: `Issued from application ${application.applicationNo}`,
      },
      user._id
    );

    agreement = await agreementService.getAgreementById(created._id || created.id);
  }

  const rendered = await renderOrRefuse(
    () => agreementPdfService.renderAgreementPdf(agreement),
    'agreement'
  );

  const fileName = `${safeFileName(`${application.consumerName}-agreement`)}.pdf`;

  await fileIssuedPdf(application, {
    kind: 'issuedAgreement',
    buffer: rendered.buffer,
    fileName,
    user,
  });

  application.agreement = agreement._id;
  application.updatedBy = user._id;
  await application.save();

  logger.info(
    { applicationNo: application.applicationNo, agreement: String(agreement._id) },
    'Agreement issued from application'
  );

  const { quotationNo } = await linkedNumbers(application);
  await notifyAgentOfIssuedDocuments(application, { actor: user, quotationNo });

  return {
    application,
    document: application.documents[application.documents.length - 1],
  };
};

export const issueDocumentsService = { issueQuotation, issueAgreement };

export default issueDocumentsService;
