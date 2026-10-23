// seed/seedSiteTestData.js
//
// Test rows for the public site so the gallery, the hero carousel and the leads
// queue all have something in them while the office is setting up.
//
// Everything here is marked TEST and is safe to delete:
//   node seed/seedSiteTestData.js          (upsert, run as often as you like)
//   node seed/seedSiteTestData.js --clean  (remove exactly what this file wrote)
//
// The story images point at /hero-fallback.jpg, the illustration already in the
// client's public folder. They are not photographs of a real job — the real
// gallery entries should carry the office's own site photos.

import { connectDB, disconnectDB } from '../src/config/db.js';
import { ProjectShowcase, SiteBanner, Lead } from '../src/models/index.js';
import logger from '../src/utils/logger.js';

const STORY_PREFIX = 'test-';
const IMAGE = '/hero-fallback.jpg';

const STORIES = [
  {
    slug: `${STORY_PREFIX}3kw-purba-bardhaman`,
    title: 'TEST — 3 kW rooftop, Purba Bardhaman',
    summary: 'A tiled roof, a south-facing slope and a ₹78,000 central subsidy. Commissioned in nine days.',
    story:
      'A three-kilowatt on-grid system on a single-storey house. The roof had one shaded corner from a neem tree, so the array was laid out in two rows of six rather than one long string. Net metering was applied for the same week the structure went up.\n\nThis entry is test data — it exists so the gallery and the story page can be reviewed before the first real job is published.',
    location: { district: 'Purba Bardhaman', state: 'West Bengal', area: 'Uttarsura' },
    capacityKW: 3,
    panelBrand: 'Tata Power Solar',
    panelCount: 6,
    inverterBrand: 'Waaree',
    systemType: 'on-grid',
    structureType: 'RCC',
    scheme: 'PM Surya Ghar',
  },
  {
    slug: `${STORY_PREFIX}5kw-hooghly`,
    title: 'TEST — 5 kW rooftop, Hooghly',
    summary: 'Two roofs, one meter: the main house and the shop behind it, net-metered together.',
    story:
      'A five-kilowatt system split across the house and the adjoining shop, with a single net meter. The shop runs a cold-storage cabinet, so the daytime load absorbs most of the generation and very little is exported.\n\nThis entry is test data — replace it with the real job sheet and photographs.',
    location: { district: 'Hooghly', state: 'West Bengal', area: 'Chinsurah' },
    capacityKW: 5,
    panelBrand: 'Waaree',
    panelCount: 10,
    inverterBrand: 'Adani Solar',
    systemType: 'on-grid',
    structureType: 'Tin shed',
    scheme: 'PM Surya Ghar',
  },
  {
    slug: `${STORY_PREFIX}2kw-kolkata`,
    title: 'TEST — 2 kW rooftop, Kolkata',
    summary: 'A small terrace flat with a limited roof — the largest array that would fit without shading the stairwell.',
    story:
      'Two kilowatts on a terrace with a parapet. Panel count was capped by the free area, not the budget, so the design used the higher-Wp module to get the most out of the space.\n\nThis entry is test data — delete it once the first Kolkata job is photographed.',
    location: { district: 'Kolkata', state: 'West Bengal', area: 'Behala' },
    capacityKW: 2,
    panelBrand: 'Vikram Solar',
    panelCount: 4,
    inverterBrand: 'Tata Power Solar',
    systemType: 'on-grid',
    structureType: 'RCC',
    scheme: 'PM Surya Ghar',
  },
];

const BANNERS = [
  {
    title: 'TEST — PM Surya Ghar scheme strip',
    altText: 'Illustration of a rooftop solar array on a West Bengal home',
    imageUrl: IMAGE,
    placement: 'home_hero',
    order: 99,
    campaign: 'test-banner',
  },
];

const LEADS = [
  {
    name: 'TEST Arati Ghosh',
    phone: '9832000001',
    district: 'Nadia',
    systemSizeKW: 3,
    message: 'টেস্ট এন্ট্রি — ছাদে সোলার বসাতে চাই, বিল মাসে প্রায় ২,০০০ টাকা।',
    source: 'website',
  },
  {
    name: 'TEST Sk. Imran',
    phone: '9832000002',
    district: 'Murshidabad',
    systemSizeKW: 5,
    message: 'Test entry — asked about the loan route and the SC/ST top-up.',
    source: 'banner_qr',
    utm: { source: 'test', medium: 'qr', campaign: 'test-banner' },
  },
];

const clean = process.argv.includes('--clean');

const run = async () => {
  await connectDB();

  if (clean) {
    const stories = await ProjectShowcase.deleteMany({ slug: { $regex: `^${STORY_PREFIX}` } });
    const banners = await SiteBanner.deleteMany({ campaign: 'test-banner' });
    const leads = await Lead.deleteMany({ name: { $regex: '^TEST ' } });
    logger.info(
      { stories: stories.deletedCount, banners: banners.deletedCount, leads: leads.deletedCount },
      'Test site data removed'
    );
    await disconnectDB();
    return;
  }

  for (const story of STORIES) {
    await ProjectShowcase.updateOne(
      { slug: story.slug },
      {
        $set: {
          ...story,
          // No real photographs yet, so the illustration stands in and the entry
          // stays clearly marked as test data on the site itself.
          coverImage: { url: IMAGE },
          media: [{ kind: 'image', url: IMAGE, altText: story.title, order: 0 }],
          customerConsent: false,
          isPublished: true,
          publishedAt: new Date(),
          tags: ['test'],
        },
      },
      { upsert: true }
    );
  }

  for (const banner of BANNERS) {
    await SiteBanner.updateOne(
      { title: banner.title },
      { $set: { ...banner, isActive: true } },
      { upsert: true }
    );
  }

  for (const lead of LEADS) {
    await Lead.updateOne(
      { phone: lead.phone },
      { $set: { ...lead, status: 'new', isActive: true } },
      { upsert: true }
    );
  }

  const [storyCount, bannerCount, leadCount] = await Promise.all([
    ProjectShowcase.countDocuments({ slug: { $regex: `^${STORY_PREFIX}` } }),
    SiteBanner.countDocuments({ campaign: 'test-banner' }),
    Lead.countDocuments({ name: { $regex: '^TEST ' } }),
  ]);

  logger.info({ stories: storyCount, banners: bannerCount, leads: leadCount }, 'Test site data seeded');
  await disconnectDB();
};

run().catch(async (error) => {
  logger.error({ err: error.message }, 'Seeding failed');
  await disconnectDB().catch(() => {});
  process.exit(1);
});
