// src/data/newLeadNotice.js

/**
 * The wording for "someone just asked for a free site survey".
 *
 * Public enquiries are the one lead source nobody is watching: the visitor has
 * already left the page by the time the office could look at a list, and a
 * callback that waits until someone happens to refresh /leads is a callback
 * after the neighbour has already signed with another vendor.
 *
 * Bengali first, with the English line underneath, because the counter staff
 * read Bengali and the site's visitors may have typed their name in either
 * script. The same strings feed the in-app notification and the email, so the
 * two channels cannot drift apart.
 */

/** Which staff see an enquiry alert — the same people the leads queue lands on. */
export const LEAD_NOTICE_ROLES = ['admin', 'manager'];

/** Where a lead came from, in words rather than an enum value. */
const SOURCE_LABELS = {
  website: 'ওয়েবসাইট ফর্ম',
  banner_qr: 'ব্যানার / QR কোড',
  phone: 'ফোন কল',
  walk_in: 'সরাসরি অফিসে',
  referral: 'পরিচিতির মাধ্যমে',
  social: 'সোশ্যাল মিডিয়া',
  exhibition: 'প্রদর্শনী',
  other: 'অন্যান্য',
};

export const sourceLabel = (source) => SOURCE_LABELS[source] || 'ওয়েবসাইট ফর্ম';

/**
 * @param {Object} lead - The stored lead document.
 * @returns {Object} Title, message and the copy the email reuses.
 */
export const buildNewLeadNotice = ({
  name,
  phone,
  district,
  systemSizeKW,
  monthlyBill,
  source,
  message,
  email,
} = {}) => {
  const who = String(name || '').trim() || 'নাম দেওয়া হয়নি';
  const where = String(district || '').trim() || 'জেলা দেওয়া হয়নি';
  const size = Number(systemSizeKW) > 0 ? `${Number(systemSizeKW)} kW` : null;
  const bill = Number(monthlyBill) > 0 ? `₹${Number(monthlyBill).toLocaleString('en-IN')}` : null;
  const from = sourceLabel(source);

  const facts = [phone, where, size, bill ? `বিল ${bill}` : null].filter(Boolean);

  return {
    title: 'নতুন সাইট সার্ভে অনুরোধ',
    // The bell shows one line, so the phone number sits right after the name —
    // the only two things needed to start the callback.
    message: `${who} · ${facts.join(' · ')} · ${from}`,
    category: 'alert',
    priority: 'high',
    emailSubject: `নতুন সাইট সার্ভে অনুরোধ — ${who} (${where})`,
    emailHeading: 'নতুন সাইট সার্ভে অনুরোধ',
    emailIntro:
      'ওয়েবসাইট থেকে একটি নতুন সার্ভে অনুরোধ এসেছে। গ্রাহক ফোনে যোগাযোগের অপেক্ষায় আছেন — যত দ্রুত কল করবেন, তত ভালো।',
    emailIntroText:
      'ওয়েবসাইট থেকে একটি নতুন সার্ভে অনুরোধ এসেছে। গ্রাহক ফোনে যোগাযোগের অপেক্ষায় আছেন — যত দ্রুত কল করবেন, তত ভালো।',
    steps: [
      'গ্রাহককে ফোন করে সময় ঠিক করুন।',
      'সার্ভের তারিখ ও জেলা লিখে রাখুন।',
      'সার্ভের পরে সিস্টেম সাইজ ও দাম জানিয়ে দিন।',
    ],
    stepsText: [
      'গ্রাহককে ফোন করে সময় ঠিক করুন।',
      'সার্ভের তারিখ ও জেলা লিখে রাখুন।',
      'সার্ভের পরে সিস্টেম সাইজ ও দাম জানিয়ে দিন।',
    ],
    // Raw fields, for the email body and the notification metadata.
    fields: {
      name: who,
      phone: phone || null,
      email: email || null,
      district: where,
      systemSizeKW: size,
      monthlyBill: bill,
      source: from,
      message: String(message || '').trim() || null,
    },
  };
};

export default { buildNewLeadNotice, LEAD_NOTICE_ROLES, sourceLabel };
