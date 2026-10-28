// src/data/signedCopyReviewNotice.js
import { documentLabelBn } from './applicationChecklist.js';
import { SIGNED_DOCUMENT_LABELS } from './signedDocumentNotice.js';

/**
 * The wording of the second half of the signed-copy loop.
 *
 * Until now the signed quotation and agreement only moved one way: the office
 * filed the scan and told the agent. The paper is signed in the consumer's
 * house, though, and the agents work up to 100 km away — carrying it back to the
 * office meant a second trip for every signature. So the agent may now file the
 * scan themselves, and that creates two notices that did not exist before:
 *
 *   1. the office is told an agent has filed a signed copy and is waiting for a
 *      verdict (they are the only ones who can accept it), and
 *   2. the agent is told the verdict — accepted, or sent back with a reason.
 *
 * Bengali, like every other notice either side receives, and built here rather
 * than inside the templates so the in-app notification and the email cannot say
 * different things. The document names come from the checklist's `labelBn`, so a
 * reworded checklist cannot leave these behind.
 */

/** The Bengali name of one signed kind — "স্বাক্ষরিত কোটেশন". */
export const signedCopyLabel = (kind) =>
  SIGNED_DOCUMENT_LABELS[kind] ?? documentLabelBn(kind) ?? 'স্বাক্ষরিত নথি';

const consumerOf = (name) => String(name || '').trim() || 'গ্রাহক';

const reference = (applicationNo) => (applicationNo ? ` (আবেদন নম্বর: ${applicationNo})` : '');

const signedOnLine = (signedOn) => {
  if (!signedOn) return '';
  const date = new Date(signedOn);
  if (Number.isNaN(date.getTime())) return '';
  const printed = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return ` গ্রাহক ${printed} তারিখে সাইন করেছেন।`;
};

/**
 * Office-facing: "an agent has filed a signed copy, decide on it".
 *
 * @param {Object} args
 * @param {String} args.consumerName
 * @param {String} args.applicationNo
 * @param {String} args.kind - signedQuotation | signedAgreement
 * @param {String} [args.agentName] - who filed it
 * @param {Date}   [args.signedOn] - the date the consumer signed, if the agent said
 */
export const buildSignedCopyPendingNotice = ({
  consumerName,
  applicationNo,
  kind,
  agentName,
  signedOn,
} = {}) => {
  const label = signedCopyLabel(kind);
  const consumer = consumerOf(consumerName);
  const ref = reference(applicationNo);
  const by = String(agentName || '').trim();
  const byLine = by ? ` ${by} আপলোড করেছেন।` : ' সেলস এজেন্ট আপলোড করেছেন।';
  const dateLine = signedOnLine(signedOn);

  const title = `${label} অনুমোদনের অপেক্ষায়`;
  const message = `গ্রাহক ${consumer}-এর ${label}${byLine}${dateLine} অনুমোদন করুন বা কারণসহ ফেরত পাঠান।${ref}`;

  return {
    kind,
    label,
    title,
    message,
    category: 'warning',
    priority: 'high',
    emailSubject: `${consumer} — ${label} অনুমোদনের অপেক্ষায়${applicationNo ? ` (${applicationNo})` : ''}`,
    emailHeading: `${label} অনুমোদনের অপেক্ষায়`,
    emailIntro: `গ্রাহক <strong>${consumer}</strong>-এর <strong>${label}</strong> পোর্টালে আপলোড হয়েছে এবং অফিসের অনুমোদনের অপেক্ষায় আছে। স্ক্যানটি দেখে অনুমোদন করুন, অথবা কারণ লিখে ফেরত পাঠান।`,
    emailIntroText: `গ্রাহক ${consumer}-এর ${label} পোর্টালে আপলোড হয়েছে এবং অফিসের অনুমোদনের অপেক্ষায় আছে। স্ক্যানটি দেখে অনুমোদন করুন, অথবা কারণ লিখে ফেরত পাঠান।`,
    steps: [
      'উপরের বোতামে ক্লিক করে আবেদনটি খুলুন।',
      `<strong>${label}</strong> ফাইলটি <strong>দেখুন</strong> — গ্রাহকের সই, নাম ও তারিখ ঠিক আছে কি না।`,
      'ঠিক থাকলে <strong>Accept</strong> করুন; না হলে কারণ লিখে <strong>Send back</strong> করুন।',
    ],
    stepsText: [
      'উপরের লিঙ্কে ক্লিক করে আবেদনটি খুলুন।',
      `${label} ফাইলটি দেখুন — গ্রাহকের সই, নাম ও তারিখ ঠিক আছে কি না।`,
      'ঠিক থাকলে Accept করুন; না হলে কারণ লিখে Send back করুন।',
    ],
    metaLine: agentName ? `আপলোড করেছেন: ${agentName}` : '',
  };
};

/**
 * Agent-facing: the office's verdict on the scan they filed.
 *
 * A rejection always carries the reason — an agent who is told "sent back" with
 * no reason has to guess, and guessing here means a third visit to the house.
 *
 * @param {Object} args
 * @param {String} args.consumerName
 * @param {String} args.applicationNo
 * @param {String} args.kind
 * @param {'accepted'|'rejected'} args.verdict
 * @param {String} [args.reason]
 */
export const buildSignedCopyVerdictNotice = ({
  consumerName,
  applicationNo,
  kind,
  verdict,
  reason,
} = {}) => {
  const label = signedCopyLabel(kind);
  const consumer = consumerOf(consumerName);
  const ref = reference(applicationNo);
  const accepted = verdict === 'accepted';
  const why = String(reason || '').trim();

  const title = accepted ? `${label} অনুমোদিত হয়েছে` : `${label} ফেরত পাঠানো হয়েছে`;
  const message = accepted
    ? `গ্রাহক ${consumer}-এর ${label} অফিস অনুমোদন করেছে। ফাইলটি এখন সম্পূর্ণ।${ref}`
    : `গ্রাহক ${consumer}-এর ${label} অফিস গ্রহণ করেনি।${why ? ` কারণ: ${why}।` : ''} আবার স্ক্যান করে আপলোড করুন।${ref}`;

  return {
    kind,
    label,
    verdict,
    title,
    message,
    category: accepted ? 'info' : 'warning',
    priority: accepted ? 'medium' : 'high',
    emailSubject: accepted
      ? `${consumer} — ${label} অনুমোদিত${applicationNo ? ` (${applicationNo})` : ''}`
      : `${consumer} — ${label} ফেরত পাঠানো হয়েছে${applicationNo ? ` (${applicationNo})` : ''}`,
    emailHeading: title,
    emailIntro: accepted
      ? `গ্রাহক <strong>${consumer}</strong>-এর <strong>${label}</strong> অফিস অনুমোদন করেছে। এই নথিটির কাজ শেষ — আর কিছু করার নেই।`
      : `গ্রাহক <strong>${consumer}</strong>-এর <strong>${label}</strong> অফিস গ্রহণ করেনি।${why ? ` কারণ: <strong>${why}</strong>` : ''} আবার স্ক্যান করে পোর্টালে আপলোড করুন।`,
    emailIntroText: accepted
      ? `গ্রাহক ${consumer}-এর ${label} অফিস অনুমোদন করেছে। এই নথিটির কাজ শেষ — আর কিছু করার নেই।`
      : `গ্রাহক ${consumer}-এর ${label} অফিস গ্রহণ করেনি।${why ? ` কারণ: ${why}` : ''} আবার স্ক্যান করে পোর্টালে আপলোড করুন।`,
    steps: accepted
      ? [
          'উপরের বোতামে ক্লিক করে আবেদনটি খুলুন।',
          '<strong>ডাউনলোড</strong> করে গ্রাহককে একটি কপি দিন।',
        ]
      : [
          'উপরের বোতামে ক্লিক করে আবেদনটি খুলুন।',
          why ? `<strong>কারণ:</strong> ${why}` : 'ফাইলটি আবার দেখুন — কী সমস্যা ছিল।',
          'আবার প্রিন্ট করান, গ্রাহকের সই নিন এবং নতুন স্ক্যান আপলোড করুন।',
        ],
    stepsText: accepted
      ? ['উপরের লিঙ্কে ক্লিক করে আবেদনটি খুলুন।', 'ডাউনলোড করে গ্রাহককে একটি কপি দিন।']
      : [
          'উপরের লিঙ্কে ক্লিক করে আবেদনটি খুলুন।',
          why ? `কারণ: ${why}` : 'ফাইলটি আবার দেখুন — কী সমস্যা ছিল।',
          'আবার প্রিন্ট করান, গ্রাহকের সই নিন এবং নতুন স্ক্যান আপলোড করুন।',
        ],
    reason: why,
  };
};

export default { buildSignedCopyPendingNotice, buildSignedCopyVerdictNotice, signedCopyLabel };
