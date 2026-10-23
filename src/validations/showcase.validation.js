// src/validations/showcase.validation.js
import Joi from 'joi';

/**
 * The public site's project stories.
 *
 * `stripUnknown` is on in the validate middleware, so anything not named here
 * never reaches the service — which is what stops an admin request from setting a
 * field the shape below does not describe.
 */

const objectId = Joi.string().hex().length(24);

const slug = Joi.string()
  .trim()
  .lowercase()
  .min(3)
  .max(90)
  .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .messages({
    'string.pattern.base': 'Slug may contain lowercase letters, numbers and single hyphens',
  });

const mediaItem = Joi.object({
  kind: Joi.string().valid('image', 'video').required(),
  url: Joi.string().uri({ scheme: ['http', 'https'] }).max(500).required(),
  publicId: Joi.string().max(200).allow('', null),
  provider: Joi.string().valid('cloudinary', 'youtube', 'vimeo', 'drive', 'other'),
  thumbnailUrl: Joi.string().uri({ scheme: ['http', 'https'] }).max(500).allow('', null),
  caption: Joi.string().max(200).allow('', null),
  width: Joi.number().integer().min(0),
  height: Joi.number().integer().min(0),
  durationSeconds: Joi.number().min(0),
  order: Joi.number().integer().min(0),
});

const location = Joi.object({
  district: Joi.string().trim().max(60).allow('', null),
  state: Joi.string().trim().max(60).allow('', null),
  area: Joi.string().trim().max(120).allow('', null),
  pincode: Joi.string().pattern(/^[0-9]{6}$/).allow('', null).messages({
    'string.pattern.base': 'Pincode must be 6 digits',
  }),
});

/** Every field a story may carry. Reused for create (with `required` added). */
const mutableFields = {
  title: Joi.string().trim().min(3).max(120),
  slug: slug.optional(),
  summary: Joi.string().trim().max(300).allow('', null),
  story: Joi.string().trim().max(8000).allow('', null),
  customerName: Joi.string().trim().max(100).allow('', null),
  customerConsent: Joi.boolean(),
  location,
  capacityKW: Joi.number().min(0.1).max(1000),
  panelBrand: Joi.string().trim().max(60).allow('', null),
  panelModel: Joi.string().trim().max(80).allow('', null),
  panelCount: Joi.number().integer().min(0).allow(null),
  inverterBrand: Joi.string().trim().max(60).allow('', null),
  systemType: Joi.string().valid('on-grid', 'off-grid', 'hybrid'),
  structureType: Joi.string().trim().max(60).allow('', null),
  scheme: Joi.string().trim().max(20).allow('', null),
  commissionedAt: Joi.date().iso().allow(null),
  coverImage: Joi.object({
    url: Joi.string().uri({ scheme: ['http', 'https'] }).max(500).allow('', null),
    publicId: Joi.string().max(200).allow('', null),
  }),
  media: Joi.array().items(mediaItem).max(24),
  tags: Joi.array().items(Joi.string().trim().max(30)).max(12),
  highlight: Joi.boolean(),
  isPublished: Joi.boolean(),
  seo: Joi.object({
    title: Joi.string().trim().max(70).allow('', null),
    description: Joi.string().trim().max(160).allow('', null),
  }),
};

export const listShowcaseValidation = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(48),
  district: Joi.string().trim().max(60),
  brand: Joi.string().trim().max(60),
  minKW: Joi.number().min(0),
  maxKW: Joi.number().min(0),
  search: Joi.string().trim().max(80),
  sort: Joi.string().valid('newest', 'oldest', 'capacity', 'views'),
  highlight: Joi.string().valid('true', 'false'),
});

export const adminListShowcaseValidation = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  district: Joi.string().trim().max(60),
  search: Joi.string().trim().max(80),
  isPublished: Joi.string().valid('true', 'false'),
});

export const createProjectValidation = Joi.object({
  ...mutableFields,
  title: mutableFields.title.required(),
  capacityKW: mutableFields.capacityKW.required(),
});

export const updateProjectValidation = Joi.object(mutableFields).min(1);

export const idParamValidation = Joi.object({ id: objectId.required() });

export const slugParamValidation = Joi.object({ slug: Joi.string().trim().max(90).required() });

export const mediaIdParamValidation = Joi.object({
  id: objectId.required(),
  mediaId: objectId.required(),
});

export const publishValidation = Joi.object({
  isPublished: Joi.boolean().required(),
});

/**
 * Attaching media: either an uploaded file (handled by multer, so the body may be
 * almost empty) or a link to something already hosted elsewhere.
 */
export const addMediaValidation = Joi.object({
  url: Joi.string().uri({ scheme: ['http', 'https'] }).max(500),
  kind: Joi.string().valid('image', 'video'),
  provider: Joi.string().valid('cloudinary', 'youtube', 'vimeo', 'drive', 'other'),
  thumbnailUrl: Joi.string().uri({ scheme: ['http', 'https'] }).max(500).allow('', null),
  caption: Joi.string().max(200).allow('', null),
  width: Joi.number().integer().min(0),
  height: Joi.number().integer().min(0),
  durationSeconds: Joi.number().min(0),
  order: Joi.number().integer().min(0),
});
