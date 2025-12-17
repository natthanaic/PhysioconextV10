// routes/broadcast.js - Broadcast Marketing Routes
const express = require('express');
const router = express.Router();
const { authenticateToken, authorize, auditLog } = require('../middleware/auth');
const { sendPatientSMS, sendAppointmentConfirmationEmail } = require('../utils/notifications');
const nodemailer = require('nodemailer');

// ========================================
// GET ALL BROADCAST CAMPAIGNS
// ========================================
router.get('/campaigns', authenticateToken, authorize('ADMIN', 'PT'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [campaigns] = await db.execute(`
            SELECT bc.*,
                   CONCAT(u.first_name, ' ', u.last_name) as created_by_name
            FROM broadcast_campaigns bc
            LEFT JOIN users u ON bc.created_by = u.id
            ORDER BY bc.created_at DESC
        `);

        res.json(campaigns);
    } catch (error) {
        console.error('Get broadcast campaigns error:', error);
        res.status(500).json({ error: 'Failed to retrieve broadcast campaigns' });
    }
});

// ========================================
// GET SINGLE BROADCAST CAMPAIGN
// ========================================
router.get('/campaigns/:id', authenticateToken, authorize('ADMIN', 'PT'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [campaigns] = await db.execute(`
            SELECT bc.*,
                   CONCAT(u.first_name, ' ', u.last_name) as created_by_name
            FROM broadcast_campaigns bc
            LEFT JOIN users u ON bc.created_by = u.id
            WHERE bc.id = ?
        `, [id]);

        if (campaigns.length === 0) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        res.json(campaigns[0]);
    } catch (error) {
        console.error('Get broadcast campaign error:', error);
        res.status(500).json({ error: 'Failed to retrieve campaign' });
    }
});

// ========================================
// CREATE BROADCAST CAMPAIGN
// ========================================
router.post('/campaigns', authenticateToken, authorize('ADMIN', 'PT'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            campaign_name,
            campaign_type,
            subject,
            message_text,
            message_html,
            target_audience,
            custom_recipients,
            schedule_type,
            scheduled_time
        } = req.body;

        // Validation
        if (!campaign_name || !campaign_type || !message_text) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (campaign_type === 'email' && !subject) {
            return res.status(400).json({ error: 'Email subject is required for email campaigns' });
        }

        if (schedule_type === 'scheduled' && !scheduled_time) {
            return res.status(400).json({ error: 'Scheduled time is required for scheduled campaigns' });
        }

        // Insert campaign
        const [result] = await db.execute(`
            INSERT INTO broadcast_campaigns (
                campaign_name, campaign_type, subject, message_text, message_html,
                target_audience, custom_recipients, schedule_type, scheduled_time,
                status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            campaign_name,
            campaign_type,
            subject,
            message_text,
            message_html,
            target_audience,
            custom_recipients,
            schedule_type,
            scheduled_time,
            schedule_type === 'immediate' ? 'draft' : 'scheduled',
            req.user.id
        ]);

        // Audit log
        await auditLog(db, req.user.id, 'CREATE', 'broadcast_campaign', result.insertId, null, req.body, req);

        res.status(201).json({
            success: true,
            campaign_id: result.insertId,
            message: 'Campaign created successfully'
        });
    } catch (error) {
        console.error('Create broadcast campaign error:', error);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
});

// ========================================
// UPDATE BROADCAST CAMPAIGN
// ========================================
router.put('/campaigns/:id', authenticateToken, authorize('ADMIN', 'PT'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const {
            campaign_name,
            campaign_type,
            subject,
            message_text,
            message_html,
            target_audience,
            custom_recipients,
            schedule_type,
            scheduled_time
        } = req.body;

        // Check if campaign exists and is not sent
        const [existing] = await db.execute(
            'SELECT status FROM broadcast_campaigns WHERE id = ?',
            [id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (existing[0].status === 'sent' || existing[0].status === 'sending') {
            return res.status(400).json({ error: 'Cannot update a sent or sending campaign' });
        }

        // Update campaign
        await db.execute(`
            UPDATE broadcast_campaigns SET
                campaign_name = ?,
                campaign_type = ?,
                subject = ?,
                message_text = ?,
                message_html = ?,
                target_audience = ?,
                custom_recipients = ?,
                schedule_type = ?,
                scheduled_time = ?,
                status = ?
            WHERE id = ?
        `, [
            campaign_name,
            campaign_type,
            subject,
            message_text,
            message_html,
            target_audience,
            custom_recipients,
            schedule_type,
            scheduled_time,
            schedule_type === 'immediate' ? 'draft' : 'scheduled',
            id
        ]);

        // Audit log
        await auditLog(db, req.user.id, 'UPDATE', 'broadcast_campaign', id, null, req.body, req);

        res.json({
            success: true,
            message: 'Campaign updated successfully'
        });
    } catch (error) {
        console.error('Update broadcast campaign error:', error);
        res.status(500).json({ error: 'Failed to update campaign' });
    }
});

// ========================================
// DELETE BROADCAST CAMPAIGN
// ========================================
router.delete('/campaigns/:id', authenticateToken, authorize('ADMIN', 'PT'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Check if campaign exists and is not sent
        const [existing] = await db.execute(
            'SELECT status FROM broadcast_campaigns WHERE id = ?',
            [id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (existing[0].status === 'sending') {
            return res.status(400).json({ error: 'Cannot delete a campaign that is currently sending' });
        }

        // Delete campaign
        await db.execute('DELETE FROM broadcast_campaigns WHERE id = ?', [id]);

        // Audit log
        await auditLog(db, req.user.id, 'DELETE', 'broadcast_campaign', id, existing[0], null, req);

        res.json({
            success: true,
            message: 'Campaign deleted successfully'
        });
    } catch (error) {
        console.error('Delete broadcast campaign error:', error);
        res.status(500).json({ error: 'Failed to delete campaign' });
    }
});

// ========================================
// SEND BROADCAST CAMPAIGN
// ========================================
router.post('/campaigns/:id/send', authenticateToken, authorize('ADMIN', 'PT'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get campaign details
        const [campaigns] = await db.execute(
            'SELECT * FROM broadcast_campaigns WHERE id = ?',
            [id]
        );

        if (campaigns.length === 0) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const campaign = campaigns[0];

        if (campaign.status === 'sent' || campaign.status === 'sending') {
            return res.status(400).json({ error: 'Campaign is already sent or sending' });
        }

        // Update status to sending
        await db.execute(
            'UPDATE broadcast_campaigns SET status = ? WHERE id = ?',
            ['sending', id]
        );

        // Get recipients based on target audience
        let recipients = [];

        if (campaign.target_audience === 'all_patients') {
            // Get all active patients with their full data for template variables
            const [patients] = await db.execute(`
                SELECT
                    id,
                    CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) as name,
                    first_name,
                    last_name,
                    email,
                    phone
                FROM patients
                WHERE (
                    (email IS NOT NULL AND email != '' AND ? IN ('email', 'both'))
                    OR (phone IS NOT NULL AND phone != '' AND ? IN ('sms', 'both'))
                )
            `, [campaign.campaign_type, campaign.campaign_type]);

            // Build recipients list based on campaign type
            for (const patient of patients) {
                if ((campaign.campaign_type === 'email' || campaign.campaign_type === 'both') && patient.email) {
                    recipients.push({
                        type: 'email',
                        value: patient.email,
                        patientData: patient
                    });
                }
                if ((campaign.campaign_type === 'sms' || campaign.campaign_type === 'both') && patient.phone) {
                    recipients.push({
                        type: 'phone',
                        value: patient.phone,
                        patientData: patient
                    });
                }
            }
        } else if (campaign.target_audience === 'custom') {
            // Get selected patients with full data
            const customList = JSON.parse(campaign.custom_recipients || '[]');
            const patientIds = customList.map(r => r.id);

            if (patientIds.length > 0) {
                const placeholders = patientIds.map(() => '?').join(',');
                const [patients] = await db.execute(`
                    SELECT
                        id,
                        CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) as name,
                        first_name,
                        last_name,
                        email,
                        phone
                    FROM patients
                    WHERE id IN (${placeholders})
                `, patientIds);

                // Build recipients list based on campaign type
                for (const patient of patients) {
                    if ((campaign.campaign_type === 'email' || campaign.campaign_type === 'both') && patient.email) {
                        recipients.push({
                            type: 'email',
                            value: patient.email,
                            patientData: patient
                        });
                    }
                    if ((campaign.campaign_type === 'sms' || campaign.campaign_type === 'both') && patient.phone) {
                        recipients.push({
                            type: 'phone',
                            value: patient.phone,
                            patientData: patient
                        });
                    }
                }
            }
        }

        // Update total recipients
        await db.execute(
            'UPDATE broadcast_campaigns SET total_recipients = ? WHERE id = ?',
            [recipients.length, id]
        );

        // Send messages asynchronously
        sendBroadcastMessages(db, id, campaign, recipients);

        res.json({
            success: true,
            message: 'Broadcast sending started',
            total_recipients: recipients.length
        });

    } catch (error) {
        console.error('Send broadcast campaign error:', error);
        console.error('Error details:', error.message, error.stack);
        res.status(500).json({
            error: 'Failed to send campaign',
            details: error.message
        });
    }
});

// ========================================
// HELPER FUNCTION: REPLACE TEMPLATE VARIABLES
// ========================================
function replaceTemplateVariables(text, patientData, clinicName = 'PhysioConext') {
    if (!text || !patientData) return text;

    let result = text;

    // Replace all template variables
    result = result.replace(/{patientName}/g, patientData.name || '');
    result = result.replace(/{firstName}/g, patientData.first_name || '');
    result = result.replace(/{lastName}/g, patientData.last_name || '');
    result = result.replace(/{email}/g, patientData.email || '');
    result = result.replace(/{phone}/g, patientData.phone || '');
    result = result.replace(/{clinicName}/g, clinicName);
    // Optional fields that may not be available
    result = result.replace(/{address}/g, '');
    result = result.replace(/{emergencyContact}/g, '');
    result = result.replace(/{emergencyPhone}/g, '');

    return result;
}

// ========================================
// HELPER FUNCTION: SEND BROADCAST MESSAGES
// ========================================
async function sendBroadcastMessages(db, campaignId, campaign, recipients) {
    let sentCount = 0;
    let failedCount = 0;

    try {
        // Get SMTP settings if sending email
        let smtpConfig = null;
        if (campaign.campaign_type === 'email' || campaign.campaign_type === 'both') {
            const [settings] = await db.execute(`
                SELECT setting_value FROM notification_settings WHERE setting_type = 'smtp' LIMIT 1
            `);
            if (settings.length > 0) {
                smtpConfig = JSON.parse(settings[0].setting_value);
            }
        }

        // Get clinic name for template variables
        const [clinicSettings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'clinic_info' LIMIT 1
        `);
        const clinicName = clinicSettings.length > 0
            ? (JSON.parse(clinicSettings[0].setting_value).name || 'PhysioConext')
            : 'PhysioConext';

        // Process each recipient
        for (const recipient of recipients) {
            try {
                let success = false;

                console.log(`[BROADCAST] Processing recipient type=${recipient.type}, value=${recipient.value}, campaign_type=${campaign.campaign_type}`);

                if (recipient.type === 'email' && (campaign.campaign_type === 'email' || campaign.campaign_type === 'both')) {
                    // Send email with template variables replaced
                    success = await sendBroadcastEmail(db, smtpConfig, recipient, campaign, clinicName);
                    console.log(`[BROADCAST] Email send result for ${recipient.value}: ${success}`);
                } else if (recipient.type === 'phone' && (campaign.campaign_type === 'sms' || campaign.campaign_type === 'both')) {
                    // Send SMS with template variables replaced
                    const personalizedMessage = replaceTemplateVariables(
                        campaign.message_text,
                        recipient.patientData,
                        clinicName
                    );
                    success = await sendBroadcastSMS(db, recipient.value, personalizedMessage);
                    console.log(`[BROADCAST] SMS send result for ${recipient.value}: ${success}`);
                } else {
                    console.log(`[BROADCAST] WARNING: No matching send method for recipient type=${recipient.type}, campaign_type=${campaign.campaign_type}`);
                }

                if (success) {
                    sentCount++;
                    console.log(`[BROADCAST] ✅ Success logged for ${recipient.value}`);
                    // Log success
                    await db.execute(`
                        INSERT INTO broadcast_logs (campaign_id, recipient_type, recipient, status, sent_at)
                        VALUES (?, ?, ?, 'sent', NOW())
                    `, [campaignId, recipient.type, recipient.value]);
                } else {
                    failedCount++;
                    console.log(`[BROADCAST] ❌ Failure logged for ${recipient.value} (success=${success})`);
                    // Log failure
                    await db.execute(`
                        INSERT INTO broadcast_logs (campaign_id, recipient_type, recipient, status, error_message)
                        VALUES (?, ?, ?, 'failed', 'Send failed')
                    `, [campaignId, recipient.type, recipient.value]);
                }
            } catch (error) {
                failedCount++;
                console.error(`[BROADCAST] ❌ Exception for ${recipient.value}:`, error);
                // Log error
                await db.execute(`
                    INSERT INTO broadcast_logs (campaign_id, recipient_type, recipient, status, error_message)
                    VALUES (?, ?, ?, 'failed', ?)
                `, [campaignId, recipient.type, recipient.value, error.message]);
            }
        }

        // Update campaign with final counts
        await db.execute(`
            UPDATE broadcast_campaigns SET
                status = 'sent',
                sent_count = ?,
                failed_count = ?,
                sent_at = NOW()
            WHERE id = ?
        `, [sentCount, failedCount, campaignId]);

        console.log(`Broadcast ${campaignId} completed: ${sentCount} sent, ${failedCount} failed`);
    } catch (error) {
        console.error(`Broadcast ${campaignId} error:`, error);
        // Update campaign status to failed
        await db.execute(`
            UPDATE broadcast_campaigns SET
                status = 'failed',
                error_log = ?
            WHERE id = ?
        `, [error.message, campaignId]);
    }
}

// ========================================
// HELPER: SEND BROADCAST EMAIL
// ========================================
async function sendBroadcastEmail(db, smtpConfig, recipient, campaign, clinicName) {
    try {
        if (!smtpConfig || smtpConfig.enabled !== 1) {
            console.log('SMTP not enabled');
            return false;
        }

        // Create transporter
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: parseInt(smtpConfig.port),
            secure: smtpConfig.secure === 'ssl',
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.password
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        // Replace template variables in subject and content
        const personalizedSubject = replaceTemplateVariables(
            campaign.subject,
            recipient.patientData,
            clinicName
        );

        const personalizedText = replaceTemplateVariables(
            campaign.message_text,
            recipient.patientData,
            clinicName
        );

        const personalizedHtml = campaign.message_html
            ? replaceTemplateVariables(campaign.message_html, recipient.patientData, clinicName)
            : personalizedText.replace(/\n/g, '<br>');

        // Prepare email
        const mailOptions = {
            from: `"${smtpConfig.fromName || 'Broadcast'}" <${smtpConfig.fromEmail}>`,
            to: recipient.value,
            subject: personalizedSubject,
            text: personalizedText,
            html: personalizedHtml
        };

        // Send email
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Broadcast email error:', error);
        return false;
    }
}

// ========================================
// HELPER: SEND BROADCAST SMS
// ========================================
async function sendBroadcastSMS(db, phoneNumber, message) {
    const result = await sendPatientSMS(db, phoneNumber, message);
    console.log(`[BROADCAST SMS] sendPatientSMS returned: ${result} (type: ${typeof result}) for ${phoneNumber}`);
    return result;
}

// ========================================
// GET BROADCAST STATISTICS
// ========================================
router.get('/stats', authenticateToken, authorize('ADMIN', 'PT'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [stats] = await db.execute(`
            SELECT
                COUNT(*) as total_campaigns,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_campaigns,
                SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled_campaigns,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_campaigns,
                SUM(total_recipients) as total_recipients_all_time,
                SUM(sent_count) as total_sent,
                SUM(failed_count) as total_failed
            FROM broadcast_campaigns
        `);

        res.json(stats[0]);
    } catch (error) {
        console.error('Get broadcast stats error:', error);
        res.status(500).json({ error: 'Failed to retrieve statistics' });
    }
});

module.exports = router;
