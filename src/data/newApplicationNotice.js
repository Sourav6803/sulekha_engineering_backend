// src/data/newApplicationNotice.js

/**
 * The Bengali wording of "a field agent has filed an application" — in two stages.
 *
 * These notices go the other way from `signedDocumentNotice.js`: that one is the
 * office telling an agent, this one is the agent's work reaching the office. They
 * are written in Bengali for the same reason — the signed-copy notice is Bengali
 * because the agents read Bengali, and this one because the office asked for it
 * to match. The office's own screens stay in English; this does not.
 *
 * Two stages, because the application has two moments that matter and they call
 * for different reactions:
 *
 *   started   — the agent opened a draft. Nothing to do yet, and the counter
 *               staff said so when they chose it: this is a heads-up that a
 *               consumer is in play, so it is marked low priority and its copy
 *               says explicitly that a final notice will follow.
 *   submitted — the agent has finished and the file has left their hands. This
 *               is the one the office acts on, so it is high priority and asks
 *               for the work to be taken up quickly.
 *
 * Both the in-app notification and the email are built from here, so the two can
 * never say different things. The fields carrying markup (`emailIntro`) escape
 * the names they interpolate: a consumer whose name contains `<` or `&` must not
 * be able to break the mail's layout.
 */

/** The office roles the notice is addressed to, as against the field agents. */
export const OFFICE_ROLES = ['admin', 'manager'];

/** The two moments, in the order they happen. */
export const NEW_APPLICATION_STAGES = ['started', 'submitted'];

/** Escapes a value for the HTML variants of the copy. */
const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** "Raj Kumar Dawn" or a neutral stand-in, never an empty gap in the sentence. */
const nameOf = (value, fallback) => String(value || '').trim() || fallback;

/**
 * Everything either channel needs to say about one filing, in one object.
 *
 * @param {Object} args
 * @param {'started'|'submitted'} args.stage - Which moment this is.
 * @param {String} args.consumerName - The consumer on the application.
 * @param {String} args.applicationNo - The application number the office quotes.
 * @param {String} args.agentName - The field agent who filed it.
 * @param {Number} [args.systemSizeKW] - Quoted system size, when the deal set one.
 * @param {String} [args.district] - Site district, when it is on the file.
 * @param {Boolean} [args.resubmitted] - Sent back for correction and now returned.
 * @returns {Object} title, message, email subject/heading/intro, steps, priority, category.
 */
export const buildNewApplicationNotice = ({
  stage = 'submitted',
  consumerName,
  applicationNo,
  agentName,
  systemSizeKW,
  district,
  resubmitted = false,
} = {}) => {
  const consumer = nameOf(consumerName, 'গ্রাহক');
  const agent = nameOf(agentName, 'ফিল্ড এজেন্ট');
  const reference = applicationNo ? `আবেদন নম্বর: ${applicationNo}` : '';

  /* ------------------------------------------------------------------ started */
  if (stage === 'started') {
    return {
      stage,
      title: 'নতুন আবেদন শুরু হয়েছে',
      message:
        `ফিল্ড এজেন্ট ${agent} গ্রাহক ${consumer}-এর জন্য একটি নতুন আবেদন তৈরি করা শুরু করেছেন` +
        `${reference ? ` (${reference})` : ''}। আবেদনটি এখনও ড্রাফট অবস্থায় আছে — চূড়ান্ত জমা পড়লে ` +
        `আলাদা করে জানানো হবে।`,
      emailSubject: `নতুন আবেদন শুরু — ${consumer}${applicationNo ? ` (${applicationNo})` : ''}`,
      emailHeading: 'নতুন আবেদন শুরু হয়েছে',
      emailIntro:
        `ফিল্ড এজেন্ট <strong>${esc(agent)}</strong> গ্রাহক <strong>${esc(consumer)}</strong>-এর জন্য ` +
        `একটি নতুন আবেদন তৈরি করা শুরু করেছেন। আবেদনটি এখনও <strong>ড্রাফট</strong> অবস্থায় আছে — ` +
        `এখনই কিছু করার দরকার নেই, চূড়ান্ত জমা পড়লে আপনাকে আলাদা করে জানানো হবে।`,
      emailIntroText:
        `ফিল্ড এজেন্ট ${agent} গ্রাহক ${consumer}-এর জন্য একটি নতুন আবেদন তৈরি করা শুরু করেছেন। ` +
        `আবেদনটি এখনও ড্রাফট অবস্থায় আছে — এখনই কিছু করার দরকার নেই, চূড়ান্ত জমা পড়লে আপনাকে ` +
        `আলাদা করে জানানো হবে।`,
      steps: [
        'উপরের বোতামে ক্লিক করে আবেদনটি দেখে নিন।',
        'গ্রাহকের তথ্য ও নথি খতিয়ে দেখুন।',
        'কিছু অসম্পূর্ণ বা ভুল থাকলে এজেন্টকে জানিয়ে দিন।',
      ],
      stepsText: [
        'উপরের লিঙ্কে ক্লিক করে আবেদনটি দেখে নিন।',
        'গ্রাহকের তথ্য ও নথি খতিয়ে দেখুন।',
        'কিছু অসম্পূর্ণ বা ভুল থাকলে এজেন্টকে জানিয়ে দিন।',
      ],
      priority: 'low',
      category: 'info',
      /* Said in the mail's own words so the counter can tell the two apart at a glance. */
      badge: 'ড্রাফট শুরু',
    };
  }

  /* ---------------------------------------------------------------- submitted */
  const size = Number(systemSizeKW) > 0 ? `, সিস্টেম: ${Number(systemSizeKW)} কিলোওয়াট` : '';
  const place = district ? `, জেলা: ${district}` : '';

  return {
    stage,
    resubmitted,
    title: resubmitted
      ? 'সংশোধিত আবেদন পুনরায় জমা পড়েছে — প্রক্রিয়া শুরু করুন'
      : 'নতুন আবেদন জমা পড়েছে — প্রক্রিয়া শুরু করুন',
    message:
      `ফিল্ড এজেন্ট ${agent} গ্রাহক ${consumer}-এর আবেদন ` +
      `${resubmitted ? 'সংশোধন করে পুনরায় ' : ''}জমা দিয়েছেন` +
      `${reference ? ` (${reference}${size})` : ''}। অনুগ্রহ করে দ্রুত যাচাই করে পরের ধাপে এগিয়ে নিন।`,
    emailSubject: resubmitted
      ? `সংশোধিত আবেদন পুনরায় জমা — ${consumer}${applicationNo ? ` (${applicationNo})` : ''} — দ্রুত প্রক্রিয়া করুন`
      : `নতুন আবেদন জমা — ${consumer}${applicationNo ? ` (${applicationNo})` : ''} — দ্রুত প্রক্রিয়া করুন`,
    emailHeading: resubmitted ? 'সংশোধিত আবেদন পুনরায় জমা পড়েছে' : 'নতুন আবেদন জমা পড়েছে',
    emailIntro:
      `ফিল্ড এজেন্ট <strong>${esc(agent)}</strong> গ্রাহক <strong>${esc(consumer)}</strong>-এর আবেদন ` +
      `${resubmitted ? 'সংশোধন করে পুনরায় ' : ''}সফলভাবে জমা দিয়েছেন। আবেদনটি এখন যাচাইয়ের জন্য ` +
      `অপেক্ষা করছে — অনুগ্রহ করে দ্রুত প্রক্রিয়া করে পরের ধাপে এগিয়ে নিন।`,
    emailIntroText:
      `ফিল্ড এজেন্ট ${agent} গ্রাহক ${consumer}-এর আবেদন ${resubmitted ? 'সংশোধন করে পুনরায় ' : ''}` +
      `সফলভাবে জমা দিয়েছেন। আবেদনটি এখন যাচাইয়ের জন্য অপেক্ষা করছে — অনুগ্রহ করে দ্রুত প্রক্রিয়া করে ` +
      `পরের ধাপে এগিয়ে নিন।`,
    steps: [
      'উপরের বোতামে ক্লিক করে আবেদনটি খুলুন।',
      'গ্রাহকের তথ্য, নথি এবং নামের মিল যাচাই করুন।',
      'সব ঠিক থাকলে আবেদনটি অনুমোদন করে পরের ধাপে এগিয়ে নিন; কিছু বাকি থাকলে সংশোধনের জন্য এজেন্টকে ফিরিয়ে পাঠান।',
    ],
    stepsText: [
      'উপরের লিঙ্কে ক্লিক করে আবেদনটি খুলুন।',
      'গ্রাহকের তথ্য, নথি এবং নামের মিল যাচাই করুন।',
      'সব ঠিক থাকলে আবেদনটি অনুমোদন করে পরের ধাপে এগিয়ে নিন; কিছু বাকি থাকলে সংশোধনের জন্য এজেন্টকে ফিরিয়ে পাঠান।',
    ],
    priority: 'high',
    category: 'registration',
    badge: resubmitted ? 'সংশোধিত' : 'নতুন জমা',
    sizeText: size,
    placeText: place,
  };
};

export default buildNewApplicationNotice;
