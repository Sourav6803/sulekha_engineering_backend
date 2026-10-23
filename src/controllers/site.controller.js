// src/controllers/site.controller.js
import { ApiResponse } from '../utils/ApiResponse.js';
import * as siteService from '../services/site.service.js';

/**
 * The landing page's single read.
 *
 * Anonymous on purpose: this is what a visitor's browser fetches first, before
 * they have any account. It carries no customer data — only published stories,
 * aggregate counts and the company's public contact details.
 */
export const getHome = async (_req, res) => {
  const data = await siteService.getHome();
  return ApiResponse.send(res, data, 'Home content fetched');
};
