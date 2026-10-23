// src/validations/banner.validation.js
import Joi from 'joi';

/** Artwork placements the public site knows how to render. */
export const BANNER_PLACEMENTS = ['home_hero', 'scheme_strip', 'home_popup', 'footer', 'other'];

const objectId = Joi.string().hex().length(24);

const fields = {
  title: Joi.string().trim().min(2).max(120),
  altText: Joi.string().trim().max(200).allow('', null),
  imageUrl: Joi.string().uri({ scheme: ['http', 'https'] }).max(500),
  publicId: Joi.string().max(200).allow('', null),
  linkUrl: Joi.string().uri({ scheme: ['http', 'https'] }).max(500).allow('', null),
  ctaLabel: Joi.string().trim().max(40).allow('', null),
  placement: Joi.string().valid(...BANNER_PLACEMENTS),
  campaign: Joi.string().trim().lowercase().max(60).allow('', null),
  order: Joi.number().integer().min(0),
  isActive: Joi.boolean(),
  startsAt: Joi.date().iso().allow(null),
  endsAt: Joi.date().iso().allow(null),
};

export const createBannerValidation = Joi.object({
  ...fields,
  title: fields.title.required(),
  imageUrl: fields.imageUrl.required(),
}).custom((value, helpers) => {
  if (value.startsAt && value.endsAt && new Date(value.startsAt) > new Date(value.endsAt)) {
    return helpers.error('any.invalid', { message: 'startsAt must be before endsAt' });
  }
  return value;
});

export const updateBannerValidation = Joi.object(fields).min(1);

export const listBannerValidation = Joi.object({
  placement: Joi.string().valid(...BANNER_PLACEMENTS),
  isActive: Joi.string().valid('true', 'false'),
});

export const activeValidation = Joi.object({
  isActive: Joi.boolean().required(),
});

export const reorderValidation = Joi.object({
  ids: Joi.array().items(objectId.required()).min(1).max(50).required(),
});

export const idParamValidation = Joi.object({ id: objectId.required() });
