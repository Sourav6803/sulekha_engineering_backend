// src/controllers/agent.controller.js
import { ApiResponse } from '../utils/ApiResponse.js';
import { agentService } from '../services/agent.service.js';
import { isEmailEnabled, isEmailConfigured, verifyEmailTransport } from '../services/email.service.js';

/**
 * Agent management. Every route on this controller is admin-only (enforced in
 * src/routes/agent.routes.js) — an agent can never create or edit another agent.
 */

/** POST /api/v1/agents */
export const createAgent = async (req, res) => {
  const result = await agentService.createAgent(req.body, req.user);

  const message = result.email.sent
    ? `Agent created — the login details were emailed to ${result.agent.email}`
    : `Agent created, but the welcome email could not be sent (${result.email.reason}). Share the password below manually.`;

  return ApiResponse.sendCreated(res, result, message);
};

/** GET /api/v1/agents */
export const listAgents = async (req, res) => {
  const { items, pagination } = await agentService.listAgents(req.query);

  return ApiResponse.sendPaginated(res, items, pagination, 'Agents fetched');
};

/** GET /api/v1/agents/:id */
export const getAgent = async (req, res) => {
  const result = await agentService.getAgent(req.params.id);

  return ApiResponse.send(res, result, 'Agent fetched');
};

/** PUT /api/v1/agents/:id */
export const updateAgent = async (req, res) => {
  const agent = await agentService.updateAgent(req.params.id, req.body, req.user);

  return ApiResponse.send(res, agent, 'Agent updated');
};

/** POST /api/v1/agents/:id/activate */
export const activateAgent = async (req, res) => {
  const agent = await agentService.activateAgent(req.params.id, req.user);

  return ApiResponse.send(res, agent, 'Agent reactivated');
};

/** POST /api/v1/agents/:id/reset-password */
export const resetAgentPassword = async (req, res) => {
  const result = await agentService.resetAgentPassword(req.params.id, req.user);

  const message = result.email.sent
    ? `A new password was emailed to ${result.agent.email}`
    : `Password reset, but the email could not be sent (${result.email.reason}). Share the password below manually.`;

  return ApiResponse.send(res, result, message);
};

/** DELETE /api/v1/agents/:id — soft delete; refuses when work is on record. */
export const deleteAgent = async (req, res) => {
  const result = await agentService.deleteAgent(req.params.id, req.user);

  return ApiResponse.send(res, result, 'Agent deleted');
};

/**
 * GET /api/v1/agents/email-status
 * Lets the admin screen warn up front that welcome emails will not go out,
 * instead of the admin discovering it only after creating someone.
 */
export const getEmailStatus = async (req, res) => {
  return ApiResponse.send(res, {
    enabled: isEmailEnabled(),
    configured: isEmailConfigured(),
  });
};

/**
 * POST /api/v1/agents/email-test
 * Sends nothing: it only verifies the SMTP handshake, so a wrong app password
 * can be diagnosed without spamming a real inbox.
 */
export const testEmailConnection = async (req, res) => {
  const result = await verifyEmailTransport();

  return ApiResponse.send(
    res,
    result,
    result.ok ? 'SMTP connection is working' : `SMTP check failed: ${result.reason}`
  );
};

export default {
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  activateAgent,
  resetAgentPassword,
  deleteAgent,
  getEmailStatus,
  testEmailConnection,
};
