// src/services/leadNotice.service.js
import { User } from '../models/index.js';
import { notificationService } from './notification.service.js';
import { sendNewLeadEmail, getAppUrl } from './email.service.js';
import { buildNewLeadNotice, LEAD_NOTICE_ROLES } from '../data/newLeadNotice.js';
import logger from '../utils/logger.js';

/**
 * Tell the office that a visitor has asked for a free site survey — in the app
 * and by email, with the same Bengali wording on both.
 *
 * Why this exists: the public form used to store the lead and say nothing. The
 * only way anyone found out was to open /leads and notice a new row, so a
 * Saturday enquiry was answered on Monday — by which time the visitor had often
 * already booked whoever called first.
 *
 * Both channels are best-effort and this function never throws. The lead is
 * already saved when it runs, and a notification table that is unhappy or a
 * mailbox that bounces must not turn the visitor's form into an error they see.
 * One recipient's failure does not stop the others.
 *
 * @param {Object} lead - The stored lead document.
 * @returns {Promise<Object|null>} A per-recipient summary, or null if nothing was attempted.
 */
export const notifyOfficeOfNewLead = async (lead) => {
  try {
    if (!lead) return null;

    const recipients = await User.find({
      role: { $in: LEAD_NOTICE_ROLES },
      status: 'active',
      isActive: true,
    })
      .select('name email')
      .lean();

    if (recipients.length === 0) {
      // Worth a warning rather than silence: with no office account on the books
      // nobody will ever see the enquiry, and that is invisible from the form.
      logger.warn(
        { leadId: String(lead._id), roles: LEAD_NOTICE_ROLES },
        'Enquiry received but there is no active office user to notify'
      );
      return { recipients: 0, notified: 0, emailed: 0, results: [] };
    }

    const notice = buildNewLeadNotice({
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      district: lead.district,
      systemSizeKW: lead.systemSizeKW,
      source: lead.source,
      message: lead.message,
    });

    const leadUrl = `${getAppUrl()}/leads`;
    const results = [];

    for (const recipient of recipients) {
      let notification = null;
      try {
        notification = await notificationService.createNewLeadNotification({
          lead,
          recipient: recipient._id,
          notice,
        });
      } catch (error) {
        logger.error(
          { leadId: String(lead._id), recipient: String(recipient._id), err: error.message },
          'New-lead notification could not be stored'
        );
      }

      let email = { sent: false, reason: recipient.email ? 'not-attempted' : 'no-email' };
      if (recipient.email) {
        try {
          email = await sendNewLeadEmail({
            to: recipient.email,
            notice,
            recipientName: recipient.name,
            leadUrl,
          });
        } catch (error) {
          logger.error(
            { leadId: String(lead._id), to: recipient.email, err: error.message },
            'New-lead email could not be sent'
          );
          email = { sent: false, reason: error.message };
        }
      }

      results.push({
        recipient: String(recipient._id),
        notified: Boolean(notification),
        emailed: email.sent === true,
        reason: email.sent === true ? undefined : email.reason,
      });
    }

    const notified = results.filter((row) => row.notified).length;
    const emailed = results.filter((row) => row.emailed).length;

    logger.info(
      {
        leadId: String(lead._id),
        phone: lead.phone,
        recipients: recipients.length,
        notified,
        emailed,
      },
      'Office notified about a new enquiry'
    );

    return { recipients: recipients.length, notified, emailed, notice, results };
  } catch (error) {
    logger.error({ leadId: lead?._id, err: error.message }, 'Could not notify the office about an enquiry');
    return null;
  }
};

export default { notifyOfficeOfNewLead };
