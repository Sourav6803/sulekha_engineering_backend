// src/services/newApplicationNotice.service.js
import { User } from '../models/index.js';
import { notificationService } from './notification.service.js';
import { sendNewApplicationEmail, getAppUrl } from './email.service.js';
import {
  buildNewApplicationNotice,
  NEW_APPLICATION_STAGES,
  OFFICE_ROLES,
} from '../data/newApplicationNotice.js';
import logger from '../utils/logger.js';

/**
 * Tell the office that a field agent has filed an application — in the app and by
 * email, with the same Bengali wording on both.
 *
 * The counter has to know a consumer is in play to plan the visit, the material
 * and the subsidy paperwork, and until this existed the only way they found out
 * was by opening the applications list and noticing. Two moments are announced,
 * because the two call for different reactions (see `data/newApplicationNotice.js`):
 * a draft is a heads-up, a submission is work to be taken up.
 *
 * Addressed to each office user individually rather than left staff-wide: every
 * agent would otherwise see a colleague's consumer announced in their own bell,
 * and the agent who filed it least needs telling. The office roles come from
 * `OFFICE_ROLES`, which mirrors the review roles on the application routes — the
 * same people the work lands on.
 *
 * Both channels are best-effort and this function never throws. The application
 * has already been saved when it runs, and a notification table that is unhappy
 * or a mailbox that bounces must not turn the agent's save into an error they see
 * — the field agent would be left believing their work was lost. One recipient's
 * failure does not stop the others. Whatever failed is logged and reported back.
 *
 * @param {Object} application - The application document (agent, deal, address).
 * @param {Object} [options]
 * @param {'started'|'submitted'} [options.stage] - Which moment this is.
 * @param {Object} [options.actor] - The agent who filed it (for the log + fallback name).
 * @param {Boolean} [options.resubmitted] - Sent back for correction and now returned.
 * @returns {Promise<Object|null>} A per-recipient summary, or null if nothing was attempted.
 */
export const notifyOfficeOfNewApplication = async (application, { stage, actor, resubmitted = false } = {}) => {
  try {
    if (!application) return null;

    if (!NEW_APPLICATION_STAGES.includes(stage)) {
      logger.warn({ stage }, 'New-application notice skipped: unknown stage');
      return null;
    }

    const recipients = await User.find({
      role: { $in: OFFICE_ROLES },
      status: 'active',
      isActive: true,
    })
      .select('name email')
      .lean();

    if (recipients.length === 0) {
      // Worth a warning rather than silence: with no office account on the books
      // nobody will ever see it, which is the failure this whole flow exists to
      // prevent — and it is invisible from the agent's side.
      logger.warn(
        { applicationNo: application.applicationNo, stage, roles: OFFICE_ROLES },
        'Application filed but there is no active office user to notify'
      );
      return { stage, recipients: 0, notified: 0, emailed: 0, results: [] };
    }

    const notice = buildNewApplicationNotice({
      stage,
      resubmitted,
      consumerName: application.consumerName,
      applicationNo: application.applicationNo,
      // The snapshot is written when the draft is created, so it is the agent who
      // collected the consumer rather than whoever happens to be saving now.
      agentName: application.agentNameSnapshot || actor?.name,
      systemSizeKW: application.deal?.systemSizeKW,
      district: application.address?.district,
    });

    const applicationUrl = `${getAppUrl()}/applications/${application._id}`;
    const results = [];

    for (const recipient of recipients) {
      let notification = null;
      try {
        notification = await notificationService.createNewApplicationNotification({
          application,
          recipient: recipient._id,
          notice,
        });
      } catch (error) {
        logger.error(
          {
            applicationNo: application.applicationNo,
            stage,
            recipient: String(recipient._id),
            err: error.message,
          },
          'New-application notification could not be stored'
        );
      }

      let email = { sent: false, reason: recipient.email ? 'not-attempted' : 'no-email' };
      if (recipient.email) {
        try {
          email = await sendNewApplicationEmail({
            to: recipient.email,
            notice,
            recipientName: recipient.name,
            consumerName: application.consumerName,
            applicationNo: application.applicationNo,
            agentName: application.agentNameSnapshot || actor?.name,
            systemSizeKW: application.deal?.systemSizeKW,
            district: application.address?.district,
            filedAt: new Date(),
            applicationUrl,
          });
        } catch (error) {
          logger.error(
            {
              applicationNo: application.applicationNo,
              stage,
              to: recipient.email,
              err: error.message,
            },
            'New-application email could not be sent'
          );
          email = { sent: false, reason: error.message };
        }
      }

      results.push({
        recipient: String(recipient._id),
        notified: Boolean(notification),
        emailed: email.sent === true,
        // Only meaningful when the send did not happen.
        reason: email.sent === true ? undefined : email.reason,
      });
    }

    const notified = results.filter((row) => row.notified).length;
    const emailed = results.filter((row) => row.emailed).length;

    logger.info(
      {
        applicationNo: application.applicationNo,
        stage,
        resubmitted,
        filedBy: actor?.email,
        recipients: recipients.length,
        notified,
        emailed,
      },
      'Office notified about a filed application'
    );

    return { stage, recipients: recipients.length, notified, emailed, notice, results };
  } catch (error) {
    logger.error(
      { applicationNo: application?.applicationNo, stage, err: error.message },
      'Could not notify the office about a filed application'
    );
    return null;
  }
};

export default { notifyOfficeOfNewApplication };
