// src/services/issuedDocumentNotice.service.js
import { User } from '../models/index.js';
import { notificationService } from './notification.service.js';
import { getAppUrl, sendIssuedDocumentsEmail } from './email.service.js';
import { buildIssuedDocumentsNotice, issuedKindsOnFile } from '../data/issuedDocumentNotice.js';
import logger from '../utils/logger.js';

/**
 * Tell the agent that the office has issued the quotation or the agreement.
 *
 * This is the notice that closes the gap the paper flow had: the documents were
 * produced in their own modules and tied to nothing, so the agent only ever saw
 * the paper if somebody at the office printed it and handed it over — with
 * agents working 100 km apart, that meant a wasted trip before the customer had
 * even signed anything.
 *
 * Best-effort and never throws, like the rest: the document is already stored
 * and attached by the time this runs, and a mailbox that bounces must not make
 * the office believe the issue failed.
 *
 * @param {Object} application - The application the document now hangs on.
 * @param {Object} [options]
 * @param {Object} [options.actor] - The office user who issued it (for the log).
 * @param {String} [options.quotationNo]
 * @param {String} [options.agreementNo]
 * @returns {Promise<{notification: Object|null, email: Object, kinds: String[], notice: Object}|null>}
 */
export const notifyAgentOfIssuedDocuments = async (
  application,
  { actor, quotationNo = '', agreementNo = '' } = {}
) => {
  try {
    if (!application) return null;

    const kinds = issuedKindsOnFile(application.documents);
    if (kinds.length === 0) return null;

    // The agent on the file, not the issuer: the office issues the paper, the
    // agent is the one who has to put it in the consumer's hands.
    const agent = await User.findById(application.agent).select('name email isActive').lean();
    if (!agent?.email) {
      logger.warn(
        { applicationNo: application.applicationNo, agent: String(application.agent) },
        'Documents issued but the agent has no email on record'
      );
      return null;
    }

    const notice = buildIssuedDocumentsNotice({
      consumerName: application.consumerName,
      applicationNo: application.applicationNo,
      kinds,
      quotationNo,
      agreementNo,
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
        'Issued-document notification could not be stored'
      );
    }

    let email = { sent: false, reason: 'not-attempted' };
    try {
      email = await sendIssuedDocumentsEmail({
        to: agent.email,
        notice,
        agentName: agent.name,
        consumerName: application.consumerName,
        applicationNo: application.applicationNo,
        quotationNo,
        agreementNo,
        applicationUrl: `${getAppUrl()}/applications/${application._id}`,
      });
    } catch (error) {
      logger.error(
        { applicationNo: application.applicationNo, err: error.message },
        'Issued-document email could not be sent'
      );
      email = { sent: false, reason: error.message };
    }

    logger.info(
      {
        applicationNo: application.applicationNo,
        kinds,
        issuedBy: actor?.email,
        notified: Boolean(notification),
        emailSent: email.sent === true,
      },
      'Agent notified about issued documents'
    );

    return { notification, email, kinds, notice };
  } catch (error) {
    logger.error({ err: error.message }, 'Could not notify the agent about issued documents');
    return null;
  }
};

export default { notifyAgentOfIssuedDocuments };
