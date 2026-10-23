// seed/seedHeroBanners.js
//
// The three campaign banners the office printed for the scheme, published through
// the same SiteBanner records the dashboard manages — so they can be reordered,
// scheduled or switched off from /banners without touching the code.
//
//   node seed/seedHeroBanners.js
//
// Files live in the client's public folder (client/public/banners/*.jpg) and are
// referenced by path; the record itself is what decides placement and order.

import { connectDB, disconnectDB } from '../src/config/db.js';
import { SiteBanner } from '../src/models/index.js';
import logger from '../src/utils/logger.js';

const BANNERS = [
  {
    title: 'Solar Power for a Brighter Future — Bengali campaign',
    altText:
      'সৌর শক্তিতে উজ্জ্বল ভবিষ্যৎ — পরিবারসহ বাড়ির ছাদে সোলার, ₹78,000 পর্যন্ত ভর্তুকি, SC/ST জন্য অতিরিক্ত ₹5,000 প্রতি কিলোওয়াট',
    imageUrl: '/banners/solar-future.jpg',
    placement: 'home_hero',
    order: 1,
    campaign: 'solar-future',
    linkUrl: '/enquiry',
    ctaLabel: 'ফ্রি সার্ভে',
  },
  {
    title: 'Diwali Dhamaka offer — Suvendu Adhikari & Narendra Modi',
    altText:
      'দীপাবলি ধামাকা অফার — প্রথম ৫ জন গ্রাহকের জন্য এক্সক্লুসিভ অফার, ₹5,000 অতিরিক্ত ছাড়',
    imageUrl: '/banners/diwali-offer.jpg',
    placement: 'home_hero',
    order: 2,
    campaign: 'diwali-offer',
    linkUrl: '/enquiry',
    ctaLabel: 'এখনই যোগাযোগ',
  },
  {
    title: 'PM Surya Ghar subsidy banner — ₹78,000 + SC/ST top-up',
    altText:
      'প্রধানমন্ত্রী সূর্য ঘর মুফত বিজলি যোজনা — সর্বোচ্চ ভর্তুকি ₹78,000, SC/ST অতিরিক্ত ₹5,000 প্রতি কিলোওয়াট (সর্বোচ্চ ₹15,000)',
    imageUrl: '/banners/subsidy-bengali.jpg',
    placement: 'home_hero',
    order: 3,
    campaign: 'subsidy-scheme',
    linkUrl: '/enquiry',
    ctaLabel: 'আবেদন করুন',
  },
];

const run = async () => {
  await connectDB();

  for (const banner of BANNERS) {
    await SiteBanner.updateOne(
      { title: banner.title },
      { $set: { ...banner, isActive: true } },
      { upsert: true }
    );
  }

  // The illustrated placeholder from the earlier seed is not a campaign; leaving
  // it live would put it in the rotation between the three real banners.
  const retired = await SiteBanner.updateMany(
    { campaign: 'test-banner' },
    { $set: { isActive: false } }
  );

  const live = await SiteBanner.find({ placement: 'home_hero', isActive: true })
    .sort({ order: 1 })
    .select('title order imageUrl')
    .lean();

  logger.info(
    { seeded: BANNERS.length, retiredPlaceholder: retired.modifiedCount, live: live.length },
    'Home hero banners seeded'
  );
  for (const row of live) logger.info(`  ${row.order}. ${row.title} → ${row.imageUrl}`);

  await disconnectDB();
};

run().catch(async (error) => {
  logger.error({ err: error.message }, 'Banner seeding failed');
  await disconnectDB().catch(() => {});
  process.exit(1);
});
