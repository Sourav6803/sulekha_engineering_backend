// src/controllers/lead.controller.js
import { ApiResponse } from '../utils/ApiResponse.js';
import * as leadService from '../services/lead.service.js';

/**
 * Enquiries from the public site.
 *
 * `create` is the only anonymous write in this module, and it returns almost
 * nothing: an id and whether the number was already seen. It must not become a
 * way to read anything back.
 */

// ===========================================================================
// PUBLIC
// ===========================================================================

export const create = async (req, res) => {
  const result = await leadService.create(req.body, {
    userAgent: req.get('user-agent'),
    pagePath: req.body?.pagePath,
  });

  const message = result.duplicate
    ? 'We already have your enquiry — we will call you back'
    : 'Thank you — we will call you back';

  // A repeat submit is an accepted request, but it did not create anything.
  if (result.duplicate) return ApiResponse.send(res, result, message, 200);

  return ApiResponse.sendCreated(res, result, message);
};

// ===========================================================================
// ADMIN
// ===========================================================================

export const list = async (req, res) => {
  const { items, pagination, counts } = await leadService.list(req.query);

  const payload = ApiResponse.paginated(items, pagination, 'Leads fetched');
  payload.counts = counts;

  return res.status(200).json(payload);
};

export const get = async (req, res) => {
  const lead = await leadService.getById(req.params.id);
  return ApiResponse.send(res, lead, 'Lead fetched');
};

export const updateStatus = async (req, res) => {
  const lead = await leadService.updateStatus(req.params.id, req.body.status, req.user);
  return ApiResponse.send(res, lead, 'Lead status updated');
};

export const addNote = async (req, res) => {
  const lead = await leadService.addNote(req.params.id, req.body.text, req.user);
  return ApiResponse.send(res, lead, 'Note added');
};

export const assign = async (req, res) => {
  const lead = await leadService.assign(req.params.id, req.body.userId, req.user);
  return ApiResponse.send(res, lead, 'Lead assigned');
};

export const stats = async (_req, res) => {
  const data = await leadService.stats();
  return ApiResponse.send(res, data, 'Lead stats fetched');
};
