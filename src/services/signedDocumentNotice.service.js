// src/services/signedDocumentNotice.service.js
import { User } from '../models/index.js';
import { notificationService } from './notification.service.js';
import { sendSignedDocumentFiledEmail, getAppUrl } from './email.service.js';
import { buildSignedDocumentNotice, signedKindsOnFile } from '../data/signedDocumentNotice.js';
import logger from '../utils/logger.js';

/**
 * Tell the agent who collected an application that the office has filed a signed
 * copy — in the app and by email, with the same Bengali wording on both.
 *
 * The office prints the quotation and the agreement, the consumer signs them and
 * the scans come back to be filed (POST /applications/:id/signed-document). Until
 * this existed nothing told the agent, so the document sat on the file until they
 * happened to open the application again — and the consumer, who is waiting for
 * their copy, stayed waiting.
 *
 * Both channels are best-effort and this function never throws: the upload has
 * already been stored when it runs, and a notification table that is unhappy or a
 * mailbox that bounces must not turn a successful filing into an error the office
 * sees. Whatever failed is logged and reported back in the result.
 *
 * @param {Object} application - The application document (agent id + documents).
 * @param {Object} [options]
 * @param {Object} [options.actor] - The office user who filed it (for the log).
 * @returns {Promise<{notification: Object|null, email: Object, kinds: String[], notice: Object}|null>}
 */
export const notifyAgentOfSignedDocument = async (application, { actor } = {}) => {
  try {
    if (!application) return null;

    const kinds = signedKindsOnFile(application.documents);
    if (kinds.length === 0) return null;

    // The agent on the file, not the uploader: the office files the copy, but the
    // person who has to hand it to the consumer is the one who collected it.
    const agent = await User.findById(application.agent).select('name email isActive').lean();
    if (!agent?.email) {
      logger.warn(
        { applicationNo: application.applicationNo, agent: String(application.agent) },
        'Signed document filed but the agent has no email on record'
      );
      return null;
    }

    const notice = buildSignedDocumentNotice({
      consumerName: application.consumerName,
      applicationNo: application.applicationNo,
      kinds,
    });

    let notification = null;
    try {
      notification = await notificationService.createSignedDocumentNotification({
        application,
        recipient: agent._id,
        notice,
      });
    } catch (error) {
      logger.error(
        { applicationNo: application.applicationNo, err: error.message },
        'Signed-document notification could not be stored'
      );
    }

    let email = { sent: false, reason: 'not-attempted' };
    try {
      email = await sendSignedDocumentFiledEmail({
        to: agent.email,
        notice,
        consumerName: application.consumerName,
        applicationNo: application.applicationNo,
        agentName: agent.name,
        filedAt: new Date(),
        applicationUrl: `${getAppUrl()}/applications/${application._id}`,
      });
    } catch (error) {
      logger.error(
        { applicationNo: application.applicationNo, err: error.message },
        'Signed-document email could not be sent'
      );
      email = { sent: false, reason: error.message };
    }

    logger.info(
      {
        applicationNo: application.applicationNo,
        kinds,
        filedBy: actor?.email,
        notified: Boolean(notification),
        emailSent: email.sent === true,
        emailReason: email.sent === true ? undefined : email.reason,
      },
      'Agent notified about the signed copy'
    );

    return { notification, email, kinds, notice };
  } catch (error) {
    logger.error({ err: error.message }, 'Could not notify the agent about the signed copy');
    return null;
  }
};

export default { notifyAgentOfSignedDocument };
