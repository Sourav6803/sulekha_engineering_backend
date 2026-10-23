// src/services/site.service.js
import { CompanyProfile } from '../models/index.js';
import { brandSlugOf, buildSavingsTable, panelBenefit, SAVINGS_CONFIG, SITE_FAQS, SOLAR_BRANDS, SOLAR_MATERIALS, INSTALLATION_STEPS } from '../data/siteContent.js';
import * as bannerService from './banner.service.js';
import * as showcaseService from './showcase.service.js';

/**
 * One payload for the landing page.
 *
 * The public site needs records (banners, published projects, the district
 * numbers), content (brands, materials, process, FAQs) and arithmetic (the
 * savings table) together. Assembling it here keeps the page to a single request
 * and keeps the numbers in one place rather than in the page's markup.
 */
export const getHome = async () => {
  const [banners, showcase, profile] = await Promise.all([
    bannerService.listPublic({}),
    showcaseService.summary(),
    // A missing profile must not take the public site down.
    CompanyProfile.getProfile().catch(() => null),
  ]);

  const known = new Set(SOLAR_BRANDS.map((brand) => brand.slug));

  /*
   * The catalogue is the marketing story ("we fit these four"), the aggregate is
   * what has actually been installed. Joining them shows both, and any brand that
   * appears on a project but not in the catalogue is still reported rather than
   * silently dropped.
   */
  const brands = SOLAR_BRANDS.map((brand) => {
    const installed = showcase.brands.find((row) => brandSlugOf(row.brand) === brand.slug);
    return {
      ...brand,
      installedProjects: installed?.projects || 0,
      installedKW: installed?.capacityKW || 0,
    };
  });

  const otherBrands = showcase.brands
    .filter((row) => !known.has(brandSlugOf(row.brand)))
    .map((row) => ({
      name: row.brand,
      installedProjects: row.projects,
      installedKW: row.capacityKW,
    }));

  return {
    company: {
      name: profile?.name || 'Sulekha Engineering',
      phone: profile?.phone || null,
      altPhone: profile?.altPhone || null,
      email: profile?.email || null,
      addressLines: profile?.addressLines || [],
      gstn: profile?.gstn || null,
      logoUrl: profile?.logoPath || null,
    },

    /* Official scheme artwork and campaign banners, grouped by where they go. */
    banners: banners.byPlacement,

    stats: {
      projects: showcase.projects,
      capacityKW: showcase.capacityKW,
      districts: showcase.districts.length,
      brandsInstalled: brands.filter((brand) => brand.installedProjects > 0).length,
    },

    districts: showcase.districts,
    brands,
    otherBrands,

    materials: SOLAR_MATERIALS,
    process: INSTALLATION_STEPS,

    savings: {
      assumptions: {
        unitsPerKWPerDay: SAVINGS_CONFIG.unitsPerKWPerDay,
        unitsPerKWPerDayMax: SAVINGS_CONFIG.unitsPerKWPerDayMax,
        billableDaysPerMonth: SAVINGS_CONFIG.billableDaysPerMonth,
        tariffPerUnit: SAVINGS_CONFIG.tariffPerUnit,
        panelWp: SAVINGS_CONFIG.panelWp,
      },
      table: buildSavingsTable(),
      panel: panelBenefit(),
      subsidy: SAVINGS_CONFIG.subsidy,
      disclaimer: SAVINGS_CONFIG.disclaimer,
    },

    faqs: SITE_FAQS,
    recentProjects: showcase.recent,
    generatedAt: new Date().toISOString(),
  };
};

export default { getHome };
