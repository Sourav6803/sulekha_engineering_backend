// src/routes/agent.routes.js
import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { validate, validateParams, validateQuery } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as agentController from '../controllers/agent.controller.js';
import {
  createAgentSchema,
  updateAgentSchema,
  listAgentsQuerySchema,
  agentIdParamSchema,
} from '../validations/agent.validation.js';

const router = Router();

router.use(authenticate);

/**
 * The whole module is admin-only, declared once for every route below.
 *
 * This is the requirement in its entirety: only an admin can bring an agent into
 * existence. `manager` is deliberately excluded — a manager runs the work, the
 * admin owns the accounts. Agents themselves have no access here at all, so they
 * cannot create peers or edit each other.
 */
router.use(authorize('admin'));

/** GET /api/v1/agents/email-status — will welcome emails actually go out? */
router.get('/email-status', asyncHandler(agentController.getEmailStatus));

/** POST /api/v1/agents/email-test — verify the SMTP handshake, send nothing. */
router.post('/email-test', asyncHandler(agentController.testEmailConnection));

/** GET /api/v1/agents — every agent with what each one has brought in. */
router.get(
  '/',
  validateQuery(listAgentsQuerySchema),
  asyncHandler(agentController.listAgents)
);

/** POST /api/v1/agents — create an agent and email the credentials. */
router.post(
  '/',
  validate(createAgentSchema),
  asyncHandler(agentController.createAgent)
);

/** GET /api/v1/agents/:id */
router.get(
  '/:id',
  validateParams(agentIdParamSchema),
  asyncHandler(agentController.getAgent)
);

/** PUT /api/v1/agents/:id — name, phone, employee id, department, status. */
router.put(
  '/:id',
  validateParams(agentIdParamSchema),
  validate(updateAgentSchema),
  asyncHandler(agentController.updateAgent)
);

/** POST /api/v1/agents/:id/activate — bring a suspended agent back. */
router.post(
  '/:id/activate',
  validateParams(agentIdParamSchema),
  asyncHandler(agentController.activateAgent)
);

/** POST /api/v1/agents/:id/reset-password — issue and email a new password. */
router.post(
  '/:id/reset-password',
  validateParams(agentIdParamSchema),
  asyncHandler(agentController.resetAgentPassword)
);

/** DELETE /api/v1/agents/:id — soft delete, refused if work is on record. */
router.delete(
  '/:id',
  validateParams(agentIdParamSchema),
  asyncHandler(agentController.deleteAgent)
);

export default router;
