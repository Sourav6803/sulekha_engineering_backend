// tests/quotation.validation.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as schemas from '../src/validations/quotation.validation.js';

/** Same options the validate() middleware uses at runtime. */
const OPTIONS = { abortEarly: false, stripUnknown: true, allowUnknown: true };

const run = (schema, value) => schema.validate(value, OPTIONS);

test('create: a minimal payload only needs the system size', () => {
  const { error, value } = run(schemas.createQuotationValidation, { systemSizeKW: 3 });
  assert.equal(error, undefined);
  assert.equal(value.systemSizeKW, 3);
});

test('create: system size is required and bounded', () => {
  assert.ok(run(schemas.createQuotationValidation, {}).error);
  assert.ok(run(schemas.createQuotationValidation, { systemSizeKW: 0 }).error);
  assert.ok(run(schemas.createQuotationValidation, { systemSizeKW: 101 }).error);
  assert.equal(run(schemas.createQuotationValidation, { systemSizeKW: 0.5 }).error, undefined);
});

test('create: BOQ line units accept the enum, lower case it and allow blank', () => {
  const valid = run(schemas.createQuotationValidation, {
    systemSizeKW: 3,
    items: [
      { description: 'Solar Modules', qty: 6, unit: 'Nos' },
      { description: 'DCDB with SPD', qty: 1, unit: null },
      { description: 'ACDB Box', qty: 1, unit: '' },
    ],
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.value.items[0].unit, 'nos');
  assert.equal(valid.value.items[1].unit, null);

  const badUnit = run(schemas.createQuotationValidation, {
    systemSizeKW: 3,
    items: [{ description: 'Something', qty: 1, unit: 'piece' }],
  });
  assert.ok(badUnit.error);
});

test('create: a BOQ line needs a description and a positive quantity', () => {
  assert.ok(run(schemas.createQuotationValidation, { systemSizeKW: 3, items: [{ qty: 1 }] }).error);
  assert.ok(run(schemas.createQuotationValidation, { systemSizeKW: 3, items: [{ description: 'x', qty: 0 }] }).error);
});

test('create: hard ceilings on lines and text blocks', () => {
  const manyItems = Array.from({ length: 31 }, (_, i) => ({ description: `line ${i}`, qty: 1 }));
  assert.ok(run(schemas.createQuotationValidation, { systemSizeKW: 3, items: manyItems }).error);

});

test('create: terms and payment terms cannot be set per quotation (fixed company-wide)', () => {
  const payload = run(schemas.createQuotationValidation, {
    systemSizeKW: 3,
    terms: Array.from({ length: 13 }, (_, i) => ({ text: `term ${i}` })),
    paymentTerms: Array.from({ length: 4 }, (_, i) => ({ text: `payment ${i}` })),
  });

  // Not an error: the fields are simply outside the contract and get stripped,
  // so the service always applies the CompanyProfile wording.
  assert.equal(payload.error, undefined);
  assert.equal(payload.value.terms, undefined);
  assert.equal(payload.value.paymentTerms, undefined);
});

test('create: a quotation date far in the future is rejected', () => {
  const soon = new Date(Date.now() + 5 * 86400000);
  assert.equal(run(schemas.createQuotationValidation, { systemSizeKW: 3, issueDate: soon }).error, undefined);

  const far = new Date(Date.now() + 60 * 86400000);
  const { error } = run(schemas.createQuotationValidation, { systemSizeKW: 3, issueDate: far });
  assert.ok(error);
  assert.match(error.message, /30 days/);
});

test('create: validUntil cannot precede issueDate, but either may be omitted', () => {
  const issue = new Date(2026, 5, 17);
  const before = new Date(2026, 5, 16);

  assert.ok(run(schemas.createQuotationValidation, { systemSizeKW: 3, issueDate: issue, validUntil: before }).error);
  assert.equal(
    run(schemas.createQuotationValidation, { systemSizeKW: 3, issueDate: issue, validUntil: new Date(2026, 5, 24) }).error,
    undefined
  );
  assert.equal(run(schemas.createQuotationValidation, { systemSizeKW: 3, validUntil: before }).error, undefined);
});

test('create: phone, pincode and consumer id are length-bounded', () => {
  assert.ok(run(schemas.createQuotationValidation, { systemSizeKW: 3, phoneNo: '1'.repeat(21) }).error);
  assert.equal(run(schemas.createQuotationValidation, { systemSizeKW: 3, phoneNo: '9432665126' }).error, undefined);
});

test('create: status must be one of the known values', () => {
  assert.ok(run(schemas.createQuotationValidation, { systemSizeKW: 3, status: 'archived' }).error);
  assert.equal(run(schemas.createQuotationValidation, { systemSizeKW: 3, status: 'sent' }).error, undefined);
});

test('update: an empty body is rejected', () => {
  assert.ok(run(schemas.updateQuotationValidation, {}).error);
  assert.equal(run(schemas.updateQuotationValidation, { amount: 195000 }).error, undefined);
});

test('list: pagination defaults and ceilings', () => {
  const { error, value } = run(schemas.listQuotationsValidation, {});
  assert.equal(error, undefined);
  assert.equal(value.page, 1);
  assert.equal(value.limit, 20);

  assert.ok(run(schemas.listQuotationsValidation, { limit: 101 }).error);
  assert.equal(run(schemas.listQuotationsValidation, { sortBy: 'quotationSeq', sortOrder: 'asc' }).error, undefined);
  assert.ok(run(schemas.listQuotationsValidation, { sortBy: 'passwordHash' }).error);
});

test('register: allows larger pages for the register view', () => {
  assert.equal(run(schemas.registerValidation, { limit: 500 }).error, undefined);
  assert.ok(run(schemas.registerValidation, { limit: 501 }).error);
  assert.equal(run(schemas.registerValidation, {}).value.limit, 50);
});

test('import: dry run is the default so nothing is written by accident', () => {
  const { error, value } = run(schemas.importRegisterValidation, {});
  assert.equal(error, undefined);
  assert.equal(value.dryRun, true);
  assert.equal(value.useLegacy, false);

  assert.equal(run(schemas.importRegisterValidation, { dryRun: 'false' }).value.dryRun, false);
  assert.ok(run(schemas.importRegisterValidation, { rows: Array.from({ length: 2001 }, () => ({})) }).error);
});

test('import confirm: requires at least one attachment with a stored url', () => {
  assert.ok(run(schemas.importConfirmValidation, { attachments: [] }).error);
  assert.ok(run(schemas.importConfirmValidation, {}).error);
  assert.ok(
    run(schemas.importConfirmValidation, {
      attachments: [{ quotationId: '60d5ec49f1b2c8a1e4f1a111' }],
    }).error
  );

  const ok = run(schemas.importConfirmValidation, {
    attachments: [
      {
        quotationId: '60d5ec49f1b2c8a1e4f1a111',
        url: 'https://res.cloudinary.com/demo/raw/upload/v1/quotation.pdf',
        fileName: 'Souvik Ghosh_Quotation.pdf',
      },
    ],
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.value.attachments[0].kind, undefined);
});

test('params: ids must be 24 character hex', () => {
  assert.equal(run(schemas.getQuotationValidation, { id: '60d5ec49f1b2c8a1e4f1a111' }).error, undefined);
  assert.ok(run(schemas.getQuotationValidation, { id: 'abc' }).error);
  assert.ok(run(schemas.attachmentParamsValidation, { id: '60d5ec49f1b2c8a1e4f1a111' }).error);
});

test('unknown keys are stripped by the middleware, so server-owned fields cannot be injected', () => {
  // The validate() middleware passes both stripUnknown:true and allowUnknown:true.
  // Verified behaviour: stripUnknown wins, unknown keys are REMOVED from
  // req.body. Server-owned fields are therefore dropped before the controller
  // ever sees them - and the service whitelist is the second layer of defence.
  //
  // `quotationNo` is the one deliberate exception: the office may type the
  // number instead of taking the next one, so it is declared on the create
  // schema. Everything else the server owns - the sequence, the financial year,
  // the soft-delete flag, the frozen company snapshot - is still stripped.
  // (Typed-number behaviour is covered in quotationNumberOverride.test.js.)
  const payload = run(schemas.createQuotationValidation, {
    systemSizeKW: 3,
    quotationNo: 'SE/PMSGY/2026-27/999',
    quotationSeq: 999,
    financialYear: '2099-00',
    isActive: false,
    companySnapshot: { name: 'Hacked' },
  });

  assert.equal(payload.error, undefined);
  assert.equal(payload.value.quotationNo, 'SE/PMSGY/2026-27/999'); // client-settable by design
  assert.equal(payload.value.quotationSeq, undefined);
  assert.equal(payload.value.financialYear, undefined);
  assert.equal(payload.value.isActive, undefined);
  assert.equal(payload.value.companySnapshot, undefined);
  assert.equal(payload.value.systemSizeKW, 3); // declared fields survive
});
