// src/services/signedCopyReviewNotice.service.js
import { User } from '../models/index.js';
import { notificationService } from './notification.service.js';
import {
  getAppUrl,
  sendSignedCopyPendingEmail,
  sendSignedCopyVerdictEmail,
} from './email.service.js';
import {
  buildSignedCopyPendingNotice,
  buildSignedCopyVerdictNotice,
} from '../data/signedCopyReviewNotice.js';
import { OFFICE_ROLES } from '../data/newApplicationNotice.js';
import logger from '../utils/logger.js';

/**
 * The other half of the signed-copy loop.
 *
 * Until now the loop only ran one way: the office filed the scan and the agent
 * was told. The paper is signed in the consumer's house and the agents work up
 * to 100 km away, so carrying it back to the office meant a second trip for
 * every signature — sometimes several agents a day, on the same day. The agent
 * can now file the scan themselves, and that needs two notices:
 *
 *   - `notifyOfficeOfSignedCopy` — an agent has filed a scan; every office user
 *     who can accept it is told in the app and by email, because the paperwork
 *     must not sit unnoticed in a pending queue.
 *   - `notifyAgentOfSignedCopyVerdict` — the office accepted or rejected it. A
 *     rejection carries the reason: an agent told only "sent back" has to guess,
 *     and guessing here means a third visit to the house.
 *
 * Both never throw. The upload or the verdict has already been stored when these
 * run, and a notification table that is unhappy or a mailbox that bounces must
 * not turn a successful action into an error the caller sees. Whatever failed is
 * logged and reported back in the result.
 */

/** Office users who may give a verdict — mirrors REVIEW_ROLES on the routes. */
const officeRecipients = () =>
  User.find({ role: { $in: OFFICE_ROLES }, status: 'active', isActive: true })
    .select('name email')
    .lean();

/**
 * Tell the office that an agent has filed a consumer-signed copy.
 *
 * @param {Object} application - The application document (agent, consumer, no.).
 * @param {Object} [options]
 * @param {Object} [options.actor] - The agent who filed it (name in the mail).
 * @param {String} [options.kind] - signedQuotation | signedAgreement.
 * @param {Date}   [options.signedOn] - The date the consumer signed it.
 * @returns {Promise<Object|null>} Per-recipient summary, or null if nothing was attempted.
 */
export const notifyOfficeOfSignedCopy = async (application, { actor, kind, signedOn } = {}) => {
  try {
    if (!application || !kind) return null;

    const recipients = await officeRecipients();

    if (recipients.length === 0) {
      // Worth a warning rather than silence: with no office account on the books
      // nobody can accept the scan, so the paperwork would sit pending forever.
      logger.warn(
        { applicationNo: application.applicationNo, kind, roles: OFFICE_ROLES },
        'Signed copy filed but there is no active office user to notify'
      );
      return { recipients: 0, notified: 0, emailed: 0, results: [] };
    }

    const notice = buildSignedCopyPendingNotice({
      consumerName: application.consumerName,
      applicationNo: application.applicationNo,
      kind,
      agentName: actor?.name || application.agentNameSnapshot,
      signedOn,
    });

    const applicationUrl = `${getAppUrl()}/applications/${application._id}`;
    const results = [];

    for (const recipient of recipients) {
      let notification = null;
      try {
        notification = await notificationService.createDocumentNoticeNotification({
          application,
          recipient: recipient._id,
          notice,
        });
      } catch (error) {
        logger.error(
          {
            applicationNo: application.applicationNo,
            recipient: String(recipient._id),
            err: error.message,
          },
          'Signed-copy review notification could not be stored'
        );
      }

      let email = { sent: false, reason: recipient.email ? 'not-attempted' : 'no-email' };
      if (recipient.email) {
        try {
          email = await sendSignedCopyPendingEmail({
            to: recipient.email,
            notice,
            officeName: recipient.name,
            consumerName: application.consumerName,
            applicationNo: application.applicationNo,
            agentName: actor?.name || application.agentNameSnapshot,
            signedOn,
            uploadedAt: new Date(),
            applicationUrl,
          });
        } catch (error) {
          logger.error(
            {
              applicationNo: application.applicationNo,
              recipient: String(recipient._id),
              err: error.message,
            },
            'Signed-copy review email could not be sent'
          );
          email = { sent: false, reason: error.message };
        }
      }

      results.push({ recipient: String(recipient._id), notified: Boolean(notification), email });
    }

    logger.info(
      {
        applicationNo: application.applicationNo,
        kind,
        filedBy: actor?.email,
        recipients: recipients.length,
        notified: results.filter((row) => row.notified).length,
        emailed: results.filter((row) => row.email?.sent === true).length,
      },
      'Office notified about a signed copy waiting for a verdict'
    );

    return {
      recipients: recipients.length,
      notified: results.filter((row) => row.notified).length,
      emailed: results.filter((row) => row.email?.sent === true).length,
      notice,
      results,
    };
  } catch (error) {
    logger.error({ err: error.message }, 'Could not notify the office about a signed copy');
    return null;
  }
};

/**
 * Tell the agent of record what the office decided about the scan they filed.
 *
 * @param {Object} application - The application document.
 * @param {Object} options
 * @param {'accepted'|'rejected'} options.verdict
 * @param {String} options.kind - signedQuotation | signedAgreement.
 * @param {String} [options.reason] - Required for a rejection, in the office's words.
 * @param {Object} [options.actor] - The office user who gave the verdict (for the log).
 * @returns {Promise<Object|null>}
 */
export const notifyAgentOfSignedCopyVerdict = async (
  application,
  { verdict, kind, reason, actor } = {}
) => {
  try {
    if (!application || !kind || !verdict) return null;

    const agent = await User.findById(application.agent).select('name email isActive').lean();
    if (!agent?.email) {
      logger.warn(
        { applicationNo: application.applicationNo, agent: String(application.agent) },
        'Signed-copy verdict given but the agent has no email on record'
      );
      return null;
    }

    const notice = buildSignedCopyVerdictNotice({
      consumerName: application.consumerName,
      applicationNo: application.applicationNo,
      kind,
      verdict,
      reason,
    });

    let notification = null;
    try {
      notification = await notificationService.createDocumentNoticeNotification({
        application,
        recipient: agent._id,
        notice,
      });
    } catch (error) {
      logger.error(
        { applicationNo: application.applicationNo, err: error.message },
        'Signed-copy verdict notification could not be stored'
      );
    }

    let email = { sent: false, reason: 'not-attempted' };
    try {
      email = await sendSignedCopyVerdictEmail({
        to: agent.email,
        notice,
        agentName: agent.name,
        consumerName: application.consumerName,
        applicationNo: application.applicationNo,
        applicationUrl: `${getAppUrl()}/applications/${application._id}`,
      });
    } catch (error) {
      logger.error(
        { applicationNo: application.applicationNo, err: error.message },
        'Signed-copy verdict email could not be sent'
      );
      email = { sent: false, reason: error.message };
    }

    logger.info(
      {
        applicationNo: application.applicationNo,
        kind,
        verdict,
        decidedBy: actor?.email,
        notified: Boolean(notification),
        emailSent: email.sent === true,
      },
      'Agent notified about the signed-copy verdict'
    );

    return { notification, email, notice };
  } catch (error) {
    logger.error({ err: error.message }, 'Could not notify the agent about the signed-copy verdict');
    return null;
  }
};

export default { notifyOfficeOfSignedCopy, notifyAgentOfSignedCopyVerdict };
