// src/routes/index.js
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import supplierRoutes from './supplier.routes.js';
import materialRoutes from './material.routes.js';
import purchaseRoutes from './purchase.routes.js';
import customerRoutes from './customer.routes.js';
import installationRoutes from './installation.routes.js';
import bomTemplateRoutes from './bomTemplate.routes.js';
import notificationRoutes from './notification.routes.js';
import quotationRoutes from './quotation.routes.js';
import agreementRoutes from './agreement.routes.js';
import applicationRoutes from './application.routes.js';
import agentRoutes from './agent.routes.js';

const router = Router();

// Public routes (no authentication required)
router.use('/auth', authRoutes);

// Protected routes (authentication required)
// Note: Authentication middleware will be applied in individual route files
router.use('/suppliers', supplierRoutes);
router.use('/materials', materialRoutes);
router.use('/purchases', purchaseRoutes);
router.use('/customers', customerRoutes);
router.use('/installations', installationRoutes);
router.use('/bom-templates', bomTemplateRoutes);
router.use('/notifications', notificationRoutes);
router.use('/quotations', quotationRoutes);
router.use('/agreements', agreementRoutes);
// Field-agent consumer applications (document intake → office review).
router.use('/applications', applicationRoutes);
// Agent account management — admin only (see agent.routes.js).
router.use('/agents', agentRoutes);

export default router;