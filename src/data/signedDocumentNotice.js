// src/data/signedDocumentNotice.js
import { documentLabelBn } from './applicationChecklist.js';

/**
 * The Bengali wording of "the office has filed the signed copy".
 *
 * This notice goes to the field agent who collected the application, and it is
 * written in Bengali because that is the language the agents read — the office's
 * own screens stay in English, this does not. Both the in-app notification and
 * the email are built from here, so the two can never say different things, and
 * the copy lives in `data/` beside the checklist it names rather than inside a
 * template where it cannot be tested.
 *
 * The two kinds are the only documents the office files (see
 * OFFICE_FILED_DOCUMENT_KINDS). They are named with the same Bengali strings the
 * paper checklist uses — a test asserts these agree with `labelBn`, so a reworded
 * checklist cannot leave the notice behind.
 */
export const SIGNED_DOCUMENT_LABELS = {
  signedQuotation: 'স্বাক্ষরিত কোটেশন',
  signedAgreement: 'স্বাক্ষরিত চুক্তিপত্র',
  /** Said once rather than twice: "স্বাক্ষরিত কোটেশন ও চুক্তিপত্র". */
  both: 'স্বাক্ষরিত কোটেশন ও চুক্তিপত্র',
};

/** The office-filed kinds that are on file, in workflow order (quotation first). */
export const signedKindsOnFile = (documents = []) =>
  ['signedQuotation', 'signedAgreement'].filter((kind) =>
    (documents ?? []).some((doc) => doc.kind === kind)
  );

/** The Bengali name for the set of signed kinds now on file. */
export const signedSetLabel = (kinds = []) => {
  if (kinds.length > 1) return SIGNED_DOCUMENT_LABELS.both;
  if (kinds.length === 1) return SIGNED_DOCUMENT_LABELS[kinds[0]] ?? documentLabelBn(kinds[0]);
  return '';
};

/** Whether the set is complete — both the quotation and the agreement. */
export const isSignedSetComplete = (kinds = []) => kinds.length > 1;

/**
 * Everything either channel needs to say, in one object.
 *
 * `both` is the case the office waits for: once the signed quotation *and* the
 * signed agreement are on the file the paperwork is done, and the notice says so
 * and tells the agent to hand a copy to the consumer. While only one of the two
 * has come back the notice names just that one — a message claiming the
 * paperwork is "done" over a single upload is exactly how an agent ends up
 * promising a consumer something the file cannot back up.
 */
export const buildSignedDocumentNotice = ({ consumerName, applicationNo, kinds = [] } = {}) => {
  const complete = isSignedSetComplete(kinds);
  const label = signedSetLabel(kinds);
  const consumer = String(consumerName || '').trim() || 'গ্রাহক';
  const reference = applicationNo ? ` (আবেদন নম্বর: ${applicationNo})` : '';

  const title = complete ? `${label} সম্পন্ন হয়েছে` : `${label} আপলোড হয়েছে`;

  const message = complete
    ? `গ্রাহক ${consumer}-এর স্বাক্ষরিত কোটেশন ও চুক্তিপত্র সফলভাবে সম্পন্ন হয়েছে এবং আপলোড করা হয়েছে। আপনি এখন ডাউনলোড করে গ্রাহকের সাথে শেয়ার করতে পারেন।${reference}`
    : `গ্রাহক ${consumer}-এর ${label} সফলভাবে আপলোড করা হয়েছে। আপনি এখন ডাউনলোড করে গ্রাহকের সাথে শেয়ার করতে পারেন।${reference}`;

  const emailSubject = complete
    ? `${consumer}-এর স্বাক্ষরিত কোটেশন ও চুক্তিপত্র সম্পন্ন — ডাউনলোড করে গ্রাহককে দিন`
    : `${consumer}-এর ${label} আপলোড হয়েছে — ডাউনলোড করে গ্রাহককে দিন`;

  const emailHeading = complete
    ? 'স্বাক্ষরিত কোটেশন ও চুক্তিপত্র সম্পন্ন'
    : `${label} আপলোড হয়েছে`;

  const emailIntro = complete
    ? `গ্রাহক <strong>${consumer}</strong>-এর স্বাক্ষরিত কোটেশন ও চুক্তিপত্র সফলভাবে সম্পন্ন হয়েছে এবং পোর্টালে আপলোড করা হয়েছে। এখন আপনি ফাইলগুলো ডাউনলোড করে গ্রাহকের সাথে শেয়ার করতে পারেন।`
    : `গ্রাহক <strong>${consumer}</strong>-এর <strong>${label}</strong> সফলভাবে পোর্টালে আপলোড করা হয়েছে। এখন আপনি ফাইলটি ডাউনলোড করে গ্রাহকের সাথে শেয়ার করতে পারেন।`;

  const emailIntroText = complete
    ? `গ্রাহক ${consumer}-এর স্বাক্ষরিত কোটেশন ও চুক্তিপত্র সফলভাবে সম্পন্ন হয়েছে এবং পোর্টালে আপলোড করা হয়েছে। এখন আপনি ফাইলগুলো ডাউনলোড করে গ্রাহকের সাথে শেয়ার করতে পারেন।`
    : `গ্রাহক ${consumer}-এর ${label} সফলভাবে পোর্টালে আপলোড করা হয়েছে। এখন আপনি ফাইলটি ডাউনলোড করে গ্রাহকের সাথে শেয়ার করতে পারেন।`;

  /** Rendered as a numbered list — the three moves that end with the consumer. */
  const steps = [
    'উপরের বোতামে ক্লিক করে আবেদনটি খুলুন।',
    complete
      ? '<strong>স্বাক্ষরিত কোটেশন ও চুক্তিপত্র</strong> অংশ থেকে দুটি ফাইলই <strong>ডাউনলোড</strong> করুন।'
      : `<strong>${label}</strong> অংশ থেকে ফাইলটি <strong>ডাউনলোড</strong> করুন।`,
    'ডাউনলোড করা কপিটি গ্রাহককে দিন বা হোয়াটসঅ্যাপে পাঠিয়ে দিন।',
  ];

  const stepsText = [
    'উপরের লিঙ্কে ক্লিক করে আবেদনটি খুলুন।',
    complete
      ? 'স্বাক্ষরিত কোটেশন ও চুক্তিপত্র অংশ থেকে দুটি ফাইলই ডাউনলোড করুন।'
      : `${label} অংশ থেকে ফাইলটি ডাউনলোড করুন।`,
    'ডাউনলোড করা কপিটি গ্রাহককে দিন বা হোয়াটসঅ্যাপে পাঠিয়ে দিন।',
  ];

  return {
    kinds,
    complete,
    label,
    title,
    message,
    emailSubject,
    emailHeading,
    emailIntro,
    emailIntroText,
    steps,
    stepsText,
  };
};

export default buildSignedDocumentNotice;
