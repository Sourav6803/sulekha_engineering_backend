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

export default router;