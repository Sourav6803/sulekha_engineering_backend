// src/services/agent.service.js
import crypto from 'crypto';
import { User } from '../models/index.js';
import Application from '../models/Application.js';
import logger from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { sendAgentWelcomeEmail, sendAgentPasswordResetEmail } from './email.service.js';

/**
 * Field-agent accounts.
 *
 * Agents are created only by an admin (enforced on the route). The admin does
 * not choose the password: the office generating it keeps one weak link out of
 * the chain, and it means the credential in the welcome email is always fresh.
 * The generated password is flagged with `mustChangePassword` so the agent is
 * pushed to set their own the first time they sign in.
 */

/**
 * Ambiguous glyphs (0/O, 1/l/I) are left out — agents read these passwords off a
 * phone screen and type them on another device, and a misread becomes a support
 * call. Guarantees one of each required class so the password always satisfies
 * the same policy the change-password form enforces.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '@#$%&*!';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

const pick = (alphabet) => alphabet[crypto.randomInt(0, alphabet.length)];

export const generateTemporaryPassword = (length = 12) => {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: Math.max(0, length - required.length) }, () => pick(ALL));

  // Shuffle so the required characters are not always in the same positions.
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
};

/** Fields safe to hand back to the client. Never the hash. */
const publicAgent = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  employeeId: user.employeeId,
  department: user.department,
  status: user.status,
  isActive: user.isActive,
  mustChangePassword: user.mustChangePassword === true,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

class AgentService {
  /**
   * Create an agent and email them their credentials.
   *
   * The account is created first and the email is best-effort: if SMTP is down
   * or switched off, the admin still gets the account plus the password in the
   * response and can pass it on by hand. The reverse order (email first) would
   * risk telling someone about an account that failed to save.
   */
  async createAgent(body = {}, admin) {
    const email = String(body.email || '').trim().toLowerCase();

    const existing = await User.findOne({ email });
    if (existing) {
      throw new ApiError(
        409,
        `A user with this email already exists (${existing.role}).`,
        'EMAIL_ALREADY_REGISTERED'
      );
    }

    const temporaryPassword = body.password || generateTemporaryPassword();

    const agent = await User.createUser({
      name: body.name,
      email,
      password: temporaryPassword,
      role: 'agent',
      phone: body.phone,
      employeeId: body.employeeId,
      department: body.department || 'sales',
      status: 'active',
      isActive: true,
      // Forces a password change on first sign-in; cleared by User.setPassword.
      mustChangePassword: true,
      createdBy: admin?._id,
      updatedBy: admin?._id,
    });

    const emailResult = await sendAgentWelcomeEmail({
      name: agent.name,
      email: agent.email,
      password: temporaryPassword,
      employeeId: agent.employeeId,
    });

    logger.info(
      { agentId: agent._id, email: agent.email, emailSent: emailResult.sent },
      'Agent created by admin'
    );

    return {
      agent: publicAgent(agent),
      /**
       * Returned so the admin can share it manually when the email did not go
       * out. This is the only time the plaintext password is ever available.
       */
      temporaryPassword: emailResult.sent ? undefined : temporaryPassword,
      email: emailResult,
    };
  }

  /** Agents with how much each one has actually brought in. */
  async listAgents(query = {}) {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const filter = { role: 'agent' };
    if (status) filter.status = status;

    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { employeeId: rx }];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [agents, total] = await Promise.all([
      User.find(filter).sort(sort).skip(skip).limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    // One aggregation for every agent on the page rather than N queries.
    const ids = agents.map((agent) => agent._id);
    const counts = await Application.aggregate([
      { $match: { agent: { $in: ids }, isActive: true } },
      {
        $group: {
          _id: '$agent',
          applications: { $sum: 1 },
          consumers: { $addToSet: '$phone' },
          quotations: { $sum: { $cond: [{ $ifNull: ['$quotation', false] }, 1, 0] } },
          agreements: { $sum: { $cond: [{ $ifNull: ['$agreement', false] }, 1, 0] } },
          pending: {
            $sum: {
              $cond: [{ $in: ['$status', ['submitted', 'under_review']] }, 1, 0],
            },
          },
          proposalValue: { $sum: { $ifNull: ['$deal.proposalAmount', 0] } },
        },
      },
    ]);

    const byAgent = new Map(counts.map((row) => [String(row._id), row]));

    return {
      items: agents.map((agent) => {
        const stat = byAgent.get(String(agent._id));
        return {
          ...publicAgent(agent),
          stats: {
            applications: stat?.applications || 0,
            consumers: stat?.consumers?.length || 0,
            quotations: stat?.quotations || 0,
            agreements: stat?.agreements || 0,
            pendingReview: stat?.pending || 0,
            totalProposalValue: stat?.proposalValue || 0,
          },
        };
      }),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)) || 1,
      },
    };
  }

  async getAgent(id) {
    const agent = await User.findOne({ _id: id, role: 'agent' });
    if (!agent) throw ApiError.notFound('Agent');

    const applications = await Application.find({ agent: id, isActive: true })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('applicationNo consumerName status siteType deal.systemSizeKW createdAt')
      .lean();

    return { agent: publicAgent(agent), recentApplications: applications };
  }

  async updateAgent(id, body = {}, admin) {
    const agent = await User.findOne({ _id: id, role: 'agent' });
    if (!agent) throw ApiError.notFound('Agent');

    ['name', 'phone', 'employeeId', 'department'].forEach((field) => {
      if (body[field] !== undefined) agent[field] = body[field];
    });

    if (body.status !== undefined) {
      // Deactivating has to take effect immediately, not just at the next login,
      // so the account is closed to new sessions as well.
      agent.status = body.status;
      if (body.status !== 'active') agent.isActive = false;
    }

    agent.updatedBy = admin?._id;
    await agent.save();

    return publicAgent(agent);
  }

  /** Reactivate a suspended agent. */
  async activateAgent(id, admin) {
    const agent = await User.findOne({ _id: id, role: 'agent' });
    if (!agent) throw ApiError.notFound('Agent');

    agent.status = 'active';
    agent.isActive = true;
    agent.updatedBy = admin?._id;
    await agent.save();

    return publicAgent(agent);
  }

  /**
   * Issue a brand-new temporary password and email it.
   *
   * Used when an agent forgets theirs and the office wants it sorted out over
   * the phone rather than through the self-service reset link.
   */
  async resetAgentPassword(id, admin) {
    const agent = await User.findOne({ _id: id, role: 'agent' });
    if (!agent) throw ApiError.notFound('Agent');

    const temporaryPassword = generateTemporaryPassword();

    await agent.setPassword(temporaryPassword);
    // setPassword clears mustChangePassword; a reset is exactly the case where
    // it must be set again.
    agent.mustChangePassword = true;
    agent.updatedBy = admin?._id;
    await agent.save();

    const emailResult = await sendAgentPasswordResetEmail({
      name: agent.name,
      email: agent.email,
      password: temporaryPassword,
    });

    logger.info(
      { agentId: agent._id, resetBy: admin?._id, emailSent: emailResult.sent },
      'Agent password reset by admin'
    );

    return {
      agent: publicAgent(agent),
      temporaryPassword: emailResult.sent ? undefined : temporaryPassword,
      email: emailResult,
    };
  }

  /** Soft delete: an agent with application history is never truly removed. */
  async deleteAgent(id, admin) {
    const agent = await User.findOne({ _id: id, role: 'agent' });
    if (!agent) throw ApiError.notFound('Agent');

    const applicationCount = await Application.countDocuments({ agent: id, isActive: true });
    if (applicationCount > 0) {
      throw ApiError.badRequest(
        `This agent has ${applicationCount} application(s) on record. Deactivate the account instead of deleting it.`
      );
    }

    agent.isActive = false;
    agent.status = 'inactive';
    agent.updatedBy = admin?._id;
    await agent.save();

    return { id: agent._id, deleted: true };
  }
}

export const agentService = new AgentService();
export default agentService;
