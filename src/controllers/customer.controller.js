// src/controllers/customer.controller.js
import { Customer, Installation } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import logger from '../utils/logger.js';
import { redisGet, redisSet, redisDel } from '../config/redis.js';
import { uploadToCloudinary } from '../services/storage.service.js';

const CACHE_TTL = 3600; // 1 hour

/** Roles that see every customer. Everyone else sees only their own. */
const OFFICE_ROLES = ['admin', 'manager'];

const isOffice = (user) => OFFICE_ROLES.includes(user?.role);

/**
 * Guard for a customer record.
 *
 * A customer now carries Aadhaar, PAN and bank papers, and field agents create
 * them — so an agent may only ever read, edit or attach documents to the ones
 * they collected. An office user is not scoped.
 *
 * A customer outside the caller's scope is reported as "not found" rather than
 * "forbidden": a 403 would confirm that a record exists, which is exactly what
 * someone guessing ids should not learn.
 */
const assertCanReadCustomer = (customer, user) => {
  if (!customer) throw ApiError.notFound('Customer');
  if (isOffice(user)) return;
  if (String(customer.ownerAgent || '') !== String(user._id)) {
    throw ApiError.notFound('Customer');
  }
};

/** Extra filter clause for a scoped caller. Empty for the office. */
const scopeFilter = (user) => (isOffice(user) ? {} : { ownerAgent: user._id });

/**
 * List all customers with pagination and filters
 */
export const listCustomers = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    city,
    state,
    roofType,
    search,
    sortBy = 'name',
    sortOrder = 'asc',
  } = req.query;

  // Build filter — a field agent only ever lists their own customers.
  const filter = { isActive: true, ...scopeFilter(req.user) };
  if (status) filter.status = status;
  if (city) filter.city = { $regex: city, $options: 'i' };
  if (state) filter.state = { $regex: state, $options: 'i' };
  if (roofType) filter.roofType = roofType;

  // Search
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { customerId: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  // Build sort
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Cache key
  const cacheKey = `customers:list:${JSON.stringify({ ...filter, page, limit, sort })}`;
  const cached = await redisGet(cacheKey);

  // if (cached) {
  //   return ApiResponse.send(res, cached.data, 'Customers fetched from cache', 200, {
  //     pagination: cached.pagination,
  //   });
  // }

  // Execute query
  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Customer.countDocuments(filter),
  ]);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  // Cache result
  await redisSet(cacheKey, { data: customers, pagination }, CACHE_TTL);

  return ApiResponse.sendPaginated(res, customers, pagination, 'Customers fetched successfully');
};

/**
 * Search customers
 */
export const searchCustomers = async (req, res) => {
  const { q, limit = 20 } = req.query;

  const query = Customer.search(q).limit(parseInt(limit));
  if (!isOffice(req.user)) query.where('ownerAgent').equals(req.user._id);

  const customers = await query.lean();

  return ApiResponse.send(res, customers, 'Search results fetched successfully');
};

/**
 * Get customer by ID
 */
export const getCustomer = async (req, res) => {
  const { id } = req.params;

  const cacheKey = `customer:${id}`;
  const cached = await redisGet(cacheKey);

  if (cached) {
    // The scope check has to run on the cached copy too, otherwise a hit would
    // hand an agent a customer they are not allowed to see.
    assertCanReadCustomer(cached, req.user);
    return ApiResponse.send(res, cached, 'Customer fetched from cache');
  }

  const customer = await Customer.findById(id).lean();

  assertCanReadCustomer(customer, req.user);

  // Cache result
  await redisSet(cacheKey, customer, CACHE_TTL);

  return ApiResponse.send(res, customer, 'Customer fetched successfully');
};

/**
 * Create new customer
 */
export const createCustomer = async (req, res) => {
  const customerData = req.body;

  // Check if customer with same phone exists
  const existing = await Customer.findOne({ phone: customerData.phone });
  if (existing) {
    throw ApiError.conflict('Customer with this phone number already exists');
  }

  // Generate customer ID
  const customerId = await Customer.generateCustomerId();

  /*
   * The agent who collected this customer owns the record; the office may hand
   * it to a named agent, otherwise it stays with whoever created it. `ownerAgent`
   * is taken from the body only for the office, never for an agent — an agent
   * could otherwise file customers against a colleague.
   */
  const ownerAgent = isOffice(req.user)
    ? customerData.ownerAgent || req.userId
    : req.userId;

  /*
   * A customer collected in the field starts unverified.
   *
   * The schema default is `active`, which quietly made every new record
   * application-ready the moment an agent typed it in — the verification step
   * existed but nothing ever landed in it. The office can still create a
   * customer it has already checked, so this only overrides the agent path.
   */
  const status = isOffice(req.user)
    ? customerData.status || 'active'
    : 'pending_verification';

  const customer = await Customer.create({
    ...customerData,
    status,
    ownerAgent,
    customerId,
    createdBy: req.userId,
    updatedBy: req.userId,
  });

  // Invalidate cache
  await redisDel('customers:list:*');

  logger.info(`Customer created: ${customer.customerId} - ${customer.name}`);

  return ApiResponse.sendCreated(res, customer, 'Customer created successfully');
};

/**
 * Update customer
 */
export const updateCustomer = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  // Check if customer exists, and that the caller is allowed to touch it
  const customer = await Customer.findById(id);
  assertCanReadCustomer(customer, req.user);

  // Ownership is the office's to reassign, not the agent's to give away.
  if (!isOffice(req.user)) delete updateData.ownerAgent;

  // Check phone uniqueness if updating
  if (updateData.phone && updateData.phone !== customer.phone) {
    const existing = await Customer.findOne({
      phone: updateData.phone,
      _id: { $ne: id },
    });
    if (existing) {
      throw ApiError.conflict('Customer with this phone number already exists');
    }
  }

  // Update customer
  Object.assign(customer, updateData);
  customer.updatedBy = req.userId;
  await customer.save();

  // Invalidate cache
  await redisDel(`customer:${id}`);
  await redisDel('customers:list:*');

  logger.info(`Customer updated: ${customer.customerId} - ${customer.name}`);

  return ApiResponse.send(res, customer, 'Customer updated successfully');
};

/**
 * Delete customer (soft delete)
 */
export const deleteCustomer = async (req, res) => {
  const { id } = req.params;

  // Check if customer exists
  const customer = await Customer.findById(id);
  if (!customer) {
    throw ApiError.notFound('Customer');
  }

  // Check if customer has installations
  const installationCount = await Installation.countDocuments({ customer: id });
  if (installationCount > 0) {
    throw ApiError.conflict(
      `Cannot delete customer with ${installationCount} installations. Use soft delete or deactivate instead.`
    );
  }

  // Soft delete
  customer.isActive = false;
  customer.status = 'inactive';
  customer.updatedBy = req.userId;
  await customer.save();

  // Invalidate cache
  await redisDel(`customer:${id}`);
  await redisDel('customers:list:*');

  logger.info(`Customer deleted: ${customer.customerId} - ${customer.name}`);

  return ApiResponse.send(res, null, 'Customer deleted successfully');
};

/**
 * Get customer installations
 */
export const getCustomerInstallations = async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;

  // Check if customer exists, and that the caller may see it
  const customer = await Customer.findById(id);
  assertCanReadCustomer(customer, req.user);

  // Get installations
  const [installations, total] = await Promise.all([
    Installation.find({ customer: id, isActive: true })
      .populate('customer', 'name phone customerId')
      .populate('teamAssigned.member', 'name email')
      .sort({ installDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Installation.countDocuments({ customer: id, isActive: true }),
  ]);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  return ApiResponse.sendPaginated(
    res,
    installations,
    pagination,
    `Installations for ${customer.name}`
  );
};

/**
 * Get customer history
 */
export const getCustomerHistory = async (req, res) => {
  const { id } = req.params;

  const customer = await Customer.findById(id);
  assertCanReadCustomer(customer, req.user);

  // Get all installations
  const installations = await Installation.find({ customer: id, isActive: true })
    .sort({ installDate: -1 })
    .lean();

  // Calculate summary
  const summary = {
    totalInstallations: installations.length,
    totalSystemCapacity: installations.reduce((sum, i) => sum + i.systemSizeKW, 0),
    completedInstallations: installations.filter(i => i.status === 'completed').length,
    averageSystemSize: installations.length > 0
      ? installations.reduce((sum, i) => sum + i.systemSizeKW, 0) / installations.length
      : 0,
    totalCost: installations.reduce((sum, i) => sum + (i.totalCost || 0), 0),
  };

  return ApiResponse.send(res, {
    customer,
    summary,
    installations,
  }, 'Customer history fetched successfully');
};

/**
 * Upload customer document(s)
 */
export const uploadCustomerDocument = async (req, res) => {
  const { id } = req.params;
  const { type } = req.body;

  const files = Array.isArray(req.files) ? req.files : req.file ? [req.file] : [];

  if (files.length === 0) {
    throw ApiError.badRequest('No files uploaded');
  }

  if (!type) {
    throw ApiError.badRequest('Document type is required');
  }

  const validTypes = [
    'aadhar',
    'voterId',
    'panCard',
    'passbookOrCheque',
    'electricBill',
    'landRecord',
    'sitePhotoBefore',
    'sitePhotoAfter',
    'loanApprovalLetter',
    'rtsFeasibilityReport',
    'feasibilityApproval',
    'agreement',
    'quotation',
    'dcrCertificate',
    'panelSerialNumber',
    'eToken',
    'acknowledgement',
    'netMetering'
  ];

  if (!validTypes.includes(type)) {
    throw ApiError.badRequest('Invalid document type');
  }

  const customer = await Customer.findById(id);
  assertCanReadCustomer(customer, req.user);

  const uploadedDocuments = [];

  const uploadPromises = files.map(async (file) => {
    const fileUrl = await uploadToCloudinary(file, {
      folder: 'customer-documents',
    });

    return {
      type,
      url: fileUrl,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
      uploadedAt: new Date(),
    };
  });

  const documents = await Promise.all(uploadPromises);

  for (const doc of documents) {
    customer.documents.push(doc);
    uploadedDocuments.push(doc);
  }

  await customer.save();

  await redisDel(`customer:${id}`);
  await redisDel('customers:list:*');

  logger.info(`Documents uploaded for customer: ${customer.customerId} - ${type} (${files.length} files)`);

  return ApiResponse.send(res, uploadedDocuments, `${uploadedDocuments.length} document(s) uploaded successfully`);
};

/**
 * Delete customer document
 */
export const deleteCustomerDocument = async (req, res) => {
  const { id, documentId } = req.params;

  const customer = await Customer.findById(id);
  assertCanReadCustomer(customer, req.user);

  const documentIndex = customer.documents.findIndex(doc => doc._id.toString() === documentId);
  if (documentIndex === -1) {
    throw ApiError.notFound('Document not found');
  }

  customer.documents.splice(documentIndex, 1);
  await customer.save();

  await redisDel(`customer:${id}`);
  await redisDel('customers:list:*');

  logger.info(`Document deleted for customer: ${customer.customerId} - ${documentId}`);

  return ApiResponse.send(res, null, 'Document deleted successfully');
};