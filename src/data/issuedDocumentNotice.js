// src/data/issuedDocumentNotice.js
import { documentLabelBn } from './applicationChecklist.js';

/**
 * The notice that starts the paper flow: the office has issued the quotation or
 * the agreement, and the agent now has a printable PDF waiting on the file.
 *
 * Until this existed, the quotation and the agreement were produced in their own
 * modules, tied to nothing — the paper reached the agent only if somebody at the
 * office printed it and handed it over. Now both are generated from the
 * application, filed on it, and the agent is told by notification and email with
 * a link they can actually open (the quotations module itself is office-only).
 *
 * Bengali, like the other agent-facing notices, and built in `data/` so the bell
 * and the mailbox cannot say different things.
 */

export const ISSUED_DOCUMENT_LABELS = {
  issuedQuotation: 'কোটেশন',
  issuedAgreement: 'চুক্তিপত্র',
  both: 'কোটেশন ও চুক্তিপত্র',
};

/** The kinds that are on file, in workflow order (quotation first). */
export const issuedKindsOnFile = (documents = []) =>
  ['issuedQuotation', 'issuedAgreement'].filter((kind) =>
    (documents ?? []).some((doc) => doc.kind === kind)
  );

const issuedLabel = (kind) => ISSUED_DOCUMENT_LABELS[kind] ?? documentLabelBn(kind) ?? 'নথি';

export const buildIssuedDocumentsNotice = ({
  consumerName,
  applicationNo,
  kinds = [],
  quotationNo = '',
  agreementNo = '',
} = {}) => {
  const both = kinds.length > 1;
  const label = both ? ISSUED_DOCUMENT_LABELS.both : issuedLabel(kinds[0] || 'issuedQuotation');
  const consumer = String(consumerName || '').trim() || 'গ্রাহক';
  const ref = applicationNo ? ` (আবেদন নম্বর: ${applicationNo})` : '';
  const numbers = [quotationNo, agreementNo].filter(Boolean).join(', ');
  const numbersLine = numbers ? ` নম্বর: ${numbers}।` : '';

  const title = both ? 'কোটেশন ও চুক্তিপত্র প্রস্তুত' : `${label} প্রস্তুত`;
  const message = `গ্রাহক ${consumer}-এর ${label} তৈরি হয়েছে।${numbersLine} এখনই ডাউনলোড করে প্রিন্ট করুন এবং গ্রাহকের সই নিন।${ref}`;

  return {
    kinds,
    label,
    title,
    message,
    category: 'info',
    priority: 'high',
    emailSubject: both
      ? `${consumer} — কোটেশন ও চুক্তিপত্র প্রস্তুত, প্রিন্ট করে সই নিন`
      : `${consumer} — ${label} প্রস্তুত, প্রিন্ট করে সই নিন`,
    emailHeading: title,
    emailIntro: both
      ? `গ্রাহক <strong>${consumer}</strong>-এর <strong>কোটেশন ও চুক্তিপত্র</strong> তৈরি হয়েছে এবং আবেদনের সঙ্গে সংযুক্ত করা হয়েছে। এখনই ডাউনলোড করে প্রিন্ট করুন, গ্রাহকের সই নিন, তারপর সই করা স্ক্যানটি পোর্টালে আপলোড করুন।`
      : `গ্রাহক <strong>${consumer}</strong>-এর <strong>${label}</strong> তৈরি হয়েছে এবং আবেদনের সঙ্গে সংযুক্ত করা হয়েছে। এখনই ডাউনলোড করে প্রিন্ট করুন, গ্রাহকের সই নিন, তারপর সই করা স্ক্যানটি পোর্টালে আপলোড করুন।`,
    emailIntroText: both
      ? `গ্রাহক ${consumer}-এর কোটেশন ও চুক্তিপত্র তৈরি হয়েছে এবং আবেদনের সঙ্গে সংযুক্ত করা হয়েছে। এখনই ডাউনলোড করে প্রিন্ট করুন, গ্রাহকের সই নিন, তারপর সই করা স্ক্যানটি পোর্টালে আপলোড করুন।`
      : `গ্রাহক ${consumer}-এর ${label} তৈরি হয়েছে এবং আবেদনের সঙ্গে সংযুক্ত করা হয়েছে। এখনই ডাউনলোড করে প্রিন্ট করুন, গ্রাহকের সই নিন, তারপর সই করা স্ক্যানটি পোর্টালে আপলোড করুন।`,
    steps: [
      'উপরের বোতামে ক্লিক করে আবেদনটি খুলুন।',
      '<strong>Quotation &amp; agreement</strong> অংশ থেকে ফাইলটি <strong>ডাউনলোড</strong> করুন।',
      'প্রিন্ট করে গ্রাহকের সই নিন এবং সই করা স্ক্যানটি সেখানেই <strong>আপলোড</strong> করুন।',
    ],
    stepsText: [
      'উপরের লিঙ্কে ক্লিক করে আবেদনটি খুলুন।',
      'Quotation & agreement অংশ থেকে ফাইলটি ডাউনলোড করুন।',
      'প্রিন্ট করে গ্রাহকের সই নিন এবং সই করা স্ক্যানটি সেখানেই আপলোড করুন।',
    ],
  };
};

export default { buildIssuedDocumentsNotice, issuedKindsOnFile };
