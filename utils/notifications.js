const axios = require('axios');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

/**
 * Send LINE notification
 * @param {Object} db - Database connection
 * @param {string} eventType - Event type: 'newAppointment', 'appointmentRescheduled', 'appointmentCancelled', 'newPatient', 'paymentReceived'
 * @param {string} message - Message to send
 * @returns {Promise<boolean>} - Success status
 */
const sendLINENotification = async (db, eventType, message) => {
    try {
        // Get LINE settings from database
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'line' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('LINE notification: No settings configured');
            return false;
        }

        const lineConfig = JSON.parse(settings[0].setting_value);

        // Check if LINE is enabled (strict integer comparison)
        if (lineConfig.enabled !== 1) {
            console.log('LINE notification: Service is disabled');
            return false;
        }

        // Check if event type is enabled
        let eventNotifications;
        if (typeof lineConfig.eventNotifications === 'string') {
            try {
                eventNotifications = JSON.parse(lineConfig.eventNotifications);
                // Handle double-encoded JSON (from old bug)
                if (typeof eventNotifications === 'string') {
                    eventNotifications = JSON.parse(eventNotifications);
                }
            } catch (e) {
                console.error('Failed to parse eventNotifications:', e);
                eventNotifications = {};
            }
        } else {
            eventNotifications = lineConfig.eventNotifications || {};
        }

        console.log(`[LINE] Checking event: ${eventType}, enabled:`, eventNotifications[eventType]);

        if (!eventNotifications[eventType]) {
            console.log(`LINE notification: Event type '${eventType}' is disabled`);
            return false;
        }

        // Validate required settings
        if (!lineConfig.accessToken) {
            console.error('LINE notification: Channel Access Token not configured');
            return false;
        }

        if (!lineConfig.targetId) {
            console.error('LINE notification: Target ID not configured');
            return false;
        }

        // Send LINE message via Messaging API
        const response = await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
                to: lineConfig.targetId,
                messages: [
                    {
                        type: 'text',
                        text: message
                    }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${lineConfig.accessToken}`
                }
            }
        );

        if (response.status === 200) {
            console.log(`✅ LINE notification sent successfully for event: ${eventType}`);
            return true;
        } else {
            console.error(`LINE notification failed: Status ${response.status}`);
            return false;
        }
    } catch (error) {
        console.error('LINE notification error:', error.message);
        if (error.response) {
            console.error('LINE API error:', error.response.data);
        }
        return false;
    }
};

/**
 * Send SMS notification via Thai Bulk SMS API
 * @param {Object} db - Database connection
 * @param {string} eventType - Event type: 'newAppointment', 'appointmentRescheduled', 'appointmentCancelled', 'newPatient', 'paymentReceived'
 * @param {string} message - Message to send
 * @returns {Promise<boolean>} - Success status
 */
const sendSMSNotification = async (db, eventType, message) => {
    try {
        // Get SMS settings from database
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'sms' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('SMS notification: No settings configured');
            return false;
        }

        const smsConfig = JSON.parse(settings[0].setting_value);

        // Check if SMS is enabled (strict integer comparison)
        if (smsConfig.enabled !== 1) {
            console.log('SMS notification: Service is disabled');
            return false;
        }

        // Check if event type is enabled
        let eventNotifications;
        if (typeof smsConfig.eventNotifications === 'string') {
            try {
                eventNotifications = JSON.parse(smsConfig.eventNotifications);
                // Handle double-encoded JSON (from potential old bug)
                if (typeof eventNotifications === 'string') {
                    eventNotifications = JSON.parse(eventNotifications);
                }
            } catch (e) {
                console.error('Failed to parse SMS eventNotifications:', e);
                eventNotifications = {};
            }
        } else {
            eventNotifications = smsConfig.eventNotifications || {};
        }

        console.log(`[SMS] Checking event: ${eventType}, enabled:`, eventNotifications[eventType]);

        if (!eventNotifications[eventType]) {
            console.log(`SMS notification: Event type '${eventType}' is disabled`);
            return false;
        }

        // Validate required settings
        if (!smsConfig.apiKey) {
            console.error('SMS notification: API Key not configured');
            return false;
        }

        if (!smsConfig.apiSecret) {
            console.error('SMS notification: API Secret not configured');
            return false;
        }

        if (!smsConfig.recipients) {
            console.error('SMS notification: Recipients not configured');
            return false;
        }

        // Send SMS via Thai Bulk SMS API (expects form-encoded data, NOT JSON)
        const querystring = require('querystring');

        // Create Basic Auth header manually (matches Thai Bulk SMS example)
        const authString = Buffer.from(`${smsConfig.apiKey}:${smsConfig.apiSecret}`).toString('base64');

        const response = await axios.post(
            'https://api-v2.thaibulksms.com/sms',
            querystring.stringify({
                msisdn: smsConfig.recipients,
                message: message,
                sender: smsConfig.sender || 'RehabPlus'
            }),
            {
                headers: {
                    'accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${authString}`
                }
            }
        );

        // Check response
        if (response.status === 200 && response.data) {
            console.log(`✅ SMS notification sent successfully for event: ${eventType}`);
            console.log('SMS Response:', {
                remainingCredit: response.data.remaining_credit,
                sentTo: response.data.phone_number_list,
                failed: response.data.bad_phone_number_list
            });
            return true;
        } else {
            console.error(`SMS notification failed: Status ${response.status}`);
            return false;
        }
    } catch (error) {
        console.error('SMS notification error:', error.message);
        if (error.response) {
            console.error('Thai Bulk SMS API error:', error.response.data);
        }
        return false;
    }
};

/**
 * Send SMS to patient's phone number (for appointment confirmations)
 * @param {Object} db - Database connection
 * @param {string} phoneNumber - Patient's phone number
 * @param {string} message - Message to send
 * @returns {Promise<boolean>} - Success status
 */
const sendPatientSMS = async (db, phoneNumber, message) => {
    try {
        // Get SMS settings from database
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'sms' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('Patient SMS: No SMS settings configured');
            return false;
        }

        const smsConfig = JSON.parse(settings[0].setting_value);

        // Check if SMS is enabled (strict integer comparison)
        if (smsConfig.enabled !== 1) {
            console.log('Patient SMS: Service is disabled');
            return false;
        }

        // Validate required settings
        if (!smsConfig.apiKey || !smsConfig.apiSecret) {
            console.error('Patient SMS: Missing API credentials');
            return false;
        }

        // Validate phone number
        if (!phoneNumber || phoneNumber.trim() === '') {
            console.log('Patient SMS: No phone number provided');
            return false;
        }

        // Clean phone number (remove spaces, dashes)
        const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');

        console.log(`📱 Sending appointment SMS to patient: ${cleanPhone}`);

        // Send SMS via Thai Bulk SMS API (expects form-encoded data, NOT JSON)
        const querystring = require('querystring');

        // Create Basic Auth header manually (matches Thai Bulk SMS example)
        const authString = Buffer.from(`${smsConfig.apiKey}:${smsConfig.apiSecret}`).toString('base64');

        const response = await axios.post(
            'https://api-v2.thaibulksms.com/sms',
            querystring.stringify({
                msisdn: cleanPhone,
                message: message,
                sender: smsConfig.sender || 'RehabPlus'
            }),
            {
                headers: {
                    'accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${authString}`
                }
            }
        );

        // Check response
        if (response.status === 200 && response.data) {
            console.log(`✅ Patient SMS sent successfully to ${cleanPhone}`);
            console.log('SMS Response:', {
                remainingCredit: response.data.remaining_credit,
                sentTo: response.data.phone_number_list,
                failed: response.data.bad_phone_number_list
            });
            return true;
        } else {
            console.error(`Patient SMS failed: Status ${response.status}`);
            return false;
        }
    } catch (error) {
        console.error('Patient SMS error:', error.message);
        if (error.response) {
            console.error('Thai Bulk SMS API error:', error.response.data);
        }
        return false;
    }
};

/**
 * Create Google Calendar event for appointment
 * @param {Object} db - Database connection
 * @param {Object} appointmentData - Appointment details
 * @returns {Promise<string|null>} - Google Calendar Event ID or null
 */
const createGoogleCalendarEvent = async (db, appointmentData) => {
    try {
        // Get Google Calendar settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('Google Calendar: No settings configured');
            return null;
        }

        const calendarConfig = JSON.parse(settings[0].setting_value);

        // Check if Google Calendar is enabled
        if (!calendarConfig.enabled || calendarConfig.enabled === '0') {
            console.log('Google Calendar: Service is disabled');
            return null;
        }

        // Validate required settings
        if (!calendarConfig.serviceAccountEmail || !calendarConfig.privateKey || !calendarConfig.calendarId) {
            console.error('Google Calendar: Missing required configuration');
            return null;
        }

        // Validate private key format
        const privateKey = calendarConfig.privateKey.trim();
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
            console.error('Google Calendar: Invalid private key format');
            return null;
        }

        // Process the private key - replace literal \n with actual newlines and trim
        let processedKey = privateKey;
        if (privateKey.includes('\\n')) {
            processedKey = privateKey.replace(/\\n/g, '\n');
        }
        processedKey = processedKey.trim();

        // Create JWT client with optional domain-wide delegation (for Google Workspace)
        const jwtClient = new google.auth.JWT(
            calendarConfig.serviceAccountEmail,
            null,
            processedKey,
            ['https://www.googleapis.com/auth/calendar'],
            calendarConfig.impersonateUser || null  // Subject for domain-wide delegation (Google Workspace)
        );

        // Log if using domain-wide delegation
        if (calendarConfig.impersonateUser) {
            console.log('🏢 Using Google Workspace Domain-wide Delegation');
            console.log('   Impersonating user:', calendarConfig.impersonateUser);
        } else {
            console.log('👤 Using regular service account (no impersonation)');
        }

        // Authorize
        await jwtClient.authorize();

        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        // Prepare event data
        const eventStartTime = new Date(`${appointmentData.appointment_date}T${appointmentData.start_time}`);
        const eventEndTime = new Date(`${appointmentData.appointment_date}T${appointmentData.end_time}`);

        const patientName = appointmentData.patient_name || appointmentData.walk_in_name || 'Walk-in Patient';
        const ptName = appointmentData.pt_name || 'PT';
        const clinicName = appointmentData.clinic_name || '';

        const event = {
            summary: `Appointment: ${patientName}`,
            description: `Patient: ${patientName}\nPhysiotherapist: ${ptName}\nClinic: ${clinicName}\n${appointmentData.reason ? `Reason: ${appointmentData.reason}` : ''}`,
            location: clinicName,
            start: {
                dateTime: eventStartTime.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            end: {
                dateTime: eventEndTime.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            attendees: [],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 30 },
                    { method: 'email', minutes: 1440 }, // 24 hours before
                ],
            },
            // Prevent guests (patients) from modifying the event
            guestsCanModify: false,
            guestsCanInviteOthers: false,
            guestsCanSeeOtherGuests: false,
        };

        // Add patient email if available and if sending invites is enabled
        // Handle both integer (1) and string ('1') values
        const isSendInvitesEnabled = calendarConfig.sendInvites === 1 || calendarConfig.sendInvites === '1';
        console.log('📧 Email invite check:', {
            sendInvites: calendarConfig.sendInvites,
            sendInvitesType: typeof calendarConfig.sendInvites,
            isSendInvitesEnabled: isSendInvitesEnabled,
            patientEmail: appointmentData.patient_email,
            clinicEmail: appointmentData.clinic_email,
            willSendInvite: isSendInvitesEnabled && appointmentData.patient_email
        });

        if (isSendInvitesEnabled && appointmentData.patient_email) {
            event.attendees.push({ email: appointmentData.patient_email });
            console.log('✅ Added patient email to calendar event attendees:', appointmentData.patient_email);
        } else {
            if (!isSendInvitesEnabled) {
                console.log('⚠️ Google Calendar invites are DISABLED in settings (sendInvites:', calendarConfig.sendInvites, ')');
            }
            if (!appointmentData.patient_email) {
                console.log('⚠️ No patient email provided for calendar invite');
            }
        }

        // Add clinic email to attendees if available and invites are enabled
        if (isSendInvitesEnabled && appointmentData.clinic_email) {
            event.attendees.push({ email: appointmentData.clinic_email });
            console.log('✅ Added clinic email to calendar event attendees:', appointmentData.clinic_email);
        }

        // Create event
        const sendUpdatesValue = isSendInvitesEnabled ? 'all' : 'none';
        console.log('📅 Creating calendar event with sendUpdates:', sendUpdatesValue);

        const response = await calendar.events.insert({
            calendarId: calendarConfig.calendarId,
            resource: event,
            sendUpdates: sendUpdatesValue,
        });

        console.log(`✅ Google Calendar event created: ${response.data.id}`);
        if (event.attendees && event.attendees.length > 0) {
            console.log(`📨 Calendar invites sent to: ${event.attendees.map(a => a.email).join(', ')}`);
        } else {
            console.log('📭 No calendar invites sent (no attendees)');
        }
        return response.data.id;

    } catch (error) {
        console.error('Google Calendar create error:', error.message);
        if (error.response) {
            console.error('Google Calendar API error:', error.response.data);
        }
        return null;
    }
};

/**
 * Update Google Calendar event
 * @param {Object} db - Database connection
 * @param {string} eventId - Google Calendar Event ID
 * @param {Object} appointmentData - Updated appointment details
 * @returns {Promise<boolean>} - Success status
 */
const updateGoogleCalendarEvent = async (db, eventId, appointmentData) => {
    try {
        if (!eventId) return false;

        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) return false;

        const calendarConfig = JSON.parse(settings[0].setting_value);
        if (!calendarConfig.enabled || calendarConfig.enabled === '0') return false;

        if (!calendarConfig.privateKey) return false;

        // Process the private key
        const privateKey = calendarConfig.privateKey.trim();
        let processedKey = privateKey;
        if (privateKey.includes('\\n')) {
            processedKey = privateKey.replace(/\\n/g, '\n');
        }
        processedKey = processedKey.trim();

        const jwtClient = new google.auth.JWT(
            calendarConfig.serviceAccountEmail,
            null,
            processedKey,
            ['https://www.googleapis.com/auth/calendar'],
            calendarConfig.impersonateUser || null  // Subject for domain-wide delegation
        );

        await jwtClient.authorize();
        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        const eventStartTime = new Date(`${appointmentData.appointment_date}T${appointmentData.start_time}`);
        const eventEndTime = new Date(`${appointmentData.appointment_date}T${appointmentData.end_time}`);

        const patientName = appointmentData.patient_name || appointmentData.walk_in_name || 'Walk-in Patient';
        const ptName = appointmentData.pt_name || 'PT';
        const clinicName = appointmentData.clinic_name || '';

        const event = {
            summary: `Appointment: ${patientName}`,
            description: `Patient: ${patientName}\nPhysiotherapist: ${ptName}\nClinic: ${clinicName}\n${appointmentData.reason ? `Reason: ${appointmentData.reason}` : ''}`,
            location: clinicName,
            start: {
                dateTime: eventStartTime.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            end: {
                dateTime: eventEndTime.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            attendees: [],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 30 },
                    { method: 'email', minutes: 1440 }, // 24 hours before
                ],
            },
            // Prevent guests (patients) from modifying the event
            guestsCanModify: false,
            guestsCanInviteOthers: false,
            guestsCanSeeOtherGuests: false,
        };

        // Handle both integer and string for sendInvites
        const isSendInvitesEnabled = calendarConfig.sendInvites === 1 || calendarConfig.sendInvites === '1';

        console.log('📧 Email invite check for reschedule:', {
            sendInvites: calendarConfig.sendInvites,
            isSendInvitesEnabled: isSendInvitesEnabled,
            patientEmail: appointmentData.patient_email,
            clinicEmail: appointmentData.clinic_email
        });

        // Add patient email to attendees if available and if sending invites is enabled
        if (isSendInvitesEnabled && appointmentData.patient_email) {
            event.attendees.push({ email: appointmentData.patient_email });
            console.log('✅ Added patient email to reschedule attendees:', appointmentData.patient_email);
        }

        // Add clinic email to attendees if available and invites are enabled
        if (isSendInvitesEnabled && appointmentData.clinic_email) {
            event.attendees.push({ email: appointmentData.clinic_email });
            console.log('✅ Added clinic email to reschedule attendees:', appointmentData.clinic_email);
        }

        await calendar.events.update({
            calendarId: calendarConfig.calendarId,
            eventId: eventId,
            resource: event,
            sendUpdates: isSendInvitesEnabled ? 'all' : 'none',
        });

        console.log(`✅ Google Calendar event updated: ${eventId}`);
        if (isSendInvitesEnabled && event.attendees.length > 0) {
            console.log(`📨 Reschedule notification emails sent to: ${event.attendees.map(a => a.email).join(', ')}`);
        }
        return true;

    } catch (error) {
        console.error('Google Calendar update error:', error.message);
        return false;
    }
};

/**
 * Delete Google Calendar event
 * @param {Object} db - Database connection
 * @param {string} eventId - Google Calendar Event ID
 * @returns {Promise<boolean>} - Success status
 */
const deleteGoogleCalendarEvent = async (db, eventId) => {
    try {
        if (!eventId) return false;

        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) return false;

        const calendarConfig = JSON.parse(settings[0].setting_value);
        if (!calendarConfig.enabled || calendarConfig.enabled === '0') return false;

        if (!calendarConfig.privateKey) return false;

        // Process the private key
        const privateKey = calendarConfig.privateKey.trim();
        let processedKey = privateKey;
        if (privateKey.includes('\\n')) {
            processedKey = privateKey.replace(/\\n/g, '\n');
        }
        processedKey = processedKey.trim();

        const jwtClient = new google.auth.JWT(
            calendarConfig.serviceAccountEmail,
            null,
            processedKey,
            ['https://www.googleapis.com/auth/calendar'],
            calendarConfig.impersonateUser || null  // Subject for domain-wide delegation
        );

        await jwtClient.authorize();
        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        // Handle both integer and string for sendInvites
        const isSendInvitesEnabled = calendarConfig.sendInvites === 1 || calendarConfig.sendInvites === '1';

        await calendar.events.delete({
            calendarId: calendarConfig.calendarId,
            eventId: eventId,
            sendUpdates: isSendInvitesEnabled ? 'all' : 'none',  // Send cancellation email to attendees
        });

        console.log(`✅ Google Calendar event deleted: ${eventId}`);
        if (isSendInvitesEnabled) {
            console.log('📧 Cancellation email sent to attendees');
        }
        return true;

    } catch (error) {
        console.error('Google Calendar delete error:', error.message);
        return false;
    }
};

/**
 * Generate .ics calendar file content
 * @param {Object} appointmentData - Appointment details
 * @returns {string} ICS file content
 */
const generateICSFile = (appointmentData) => {
    try {
        // Format dates for ICS format (YYYYMMDDTHHMMSS)
        const formatICSDate = (dateStr, timeStr) => {
            const date = new Date(`${dateStr}T${timeStr}`);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            return `${year}${month}${day}T${hours}${minutes}${seconds}`;
        };

        const startDateTime = formatICSDate(appointmentData.appointment_date, appointmentData.start_time);
        const endDateTime = formatICSDate(appointmentData.appointment_date, appointmentData.end_time);
        const now = formatICSDate(new Date().toISOString().split('T')[0], new Date().toTimeString().split(' ')[0]);

        // Create unique UID
        const uid = `appointment-${appointmentData.id}@rehabplus.com`;

        // Build description
        const description = [
            `Appointment at ${appointmentData.clinic_name}`,
            `Therapist: ${appointmentData.pt_name || 'To be assigned'}`,
            appointmentData.reason ? `Reason: ${appointmentData.reason}` : ''
        ].filter(Boolean).join('\\n');

        // Location
        const location = [
            appointmentData.clinic_name,
            appointmentData.clinic_address
        ].filter(Boolean).join(', ');

        // Generate ICS content
        const icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//RehabPlus//Appointment System//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:REQUEST',
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${now}`,
            `DTSTART:${startDateTime}`,
            `DTEND:${endDateTime}`,
            `SUMMARY:Appointment at ${appointmentData.clinic_name}`,
            `DESCRIPTION:${description}`,
            `LOCATION:${location}`,
            `STATUS:CONFIRMED`,
            `SEQUENCE:0`,
            `PRIORITY:5`,
            'BEGIN:VALARM',
            'TRIGGER:-PT30M',
            'DESCRIPTION:Appointment reminder',
            'ACTION:DISPLAY',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');

        return icsContent;
    } catch (error) {
        console.error('Error generating ICS file:', error);
        return null;
    }
};

/**
 * Send appointment confirmation email
 * @param {Object} db - Database connection
 * @param {number} appointmentId - Appointment ID
 * @param {string} recipientEmail - Email address to send to
 * @returns {Promise<boolean>} Success status
 */
const sendAppointmentConfirmationEmail = async (db, appointmentId, recipientEmail) => {
    try {
        if (!recipientEmail || !recipientEmail.includes('@')) {
            console.log('Email: No valid recipient email provided');
            return false;
        }

        // Get SMTP settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings
            WHERE setting_type = 'smtp' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('Email: No SMTP settings configured');
            return false;
        }

        const smtpConfig = JSON.parse(settings[0].setting_value);

        if (smtpConfig.enabled !== 1) {
            console.log('Email: SMTP is disabled');
            return false;
        }

        // Get appointment details
        const [appointments] = await db.execute(`
            SELECT a.*,
                   COALESCE(a.walk_in_name, CONCAT(p.first_name, ' ', p.last_name)) as patient_name,
                   CONCAT(u.first_name, ' ', u.last_name) as pt_name,
                   c.name as clinic_name,
                   c.address as clinic_address,
                   c.phone as clinic_phone
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            LEFT JOIN users u ON a.pt_id = u.id
            LEFT JOIN clinics c ON a.clinic_id = c.id
            WHERE a.id = ?
        `, [appointmentId]);

        if (appointments.length === 0) {
            console.log('Email: Appointment not found');
            return false;
        }

        const apt = appointments[0];

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

        // Format date and time
        const aptDate = new Date(apt.appointment_date);
        const dateStr = aptDate.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Email HTML template
        const emailHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                              color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                    .content { background: white; padding: 30px; border: 1px solid #e0e0e0; }
                    .appointment-details { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; }
                    .detail-row { padding: 10px 0; border-bottom: 1px solid #e0e0e0; }
                    .detail-label { font-weight: bold; color: #667eea; }
                    .footer { background: #f0f0f0; padding: 20px; text-align: center;
                              font-size: 12px; color: #666; border-radius: 0 0 10px 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Appointment Confirmation</h1>
                        <p>Your appointment has been successfully booked!</p>
                    </div>
                    <div class="content">
                        <p>Dear ${apt.patient_name},</p>
                        <p>This email confirms your appointment at <strong>${apt.clinic_name}</strong>.</p>

                        <div class="appointment-details">
                            <div class="detail-row">
                                <span class="detail-label">Date:</span> ${dateStr}
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Time:</span> ${apt.start_time} - ${apt.end_time}
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Therapist:</span> ${apt.pt_name || 'To be assigned'}
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Clinic:</span> ${apt.clinic_name}
                            </div>
                            ${apt.clinic_address ? `
                            <div class="detail-row">
                                <span class="detail-label">Address:</span> ${apt.clinic_address}
                            </div>
                            ` : ''}
                            ${apt.clinic_phone ? `
                            <div class="detail-row">
                                <span class="detail-label">Contact:</span> ${apt.clinic_phone}
                            </div>
                            ` : ''}
                            ${apt.reason ? `
                            <div class="detail-row">
                                <span class="detail-label">Reason:</span> ${apt.reason}
                            </div>
                            ` : ''}
                        </div>

                        <p><strong>Please arrive 10 minutes early for check-in.</strong></p>

                        <p>If you need to cancel or reschedule, please contact us as soon as possible.</p>

                        <p>Thank you for choosing our services!</p>
                    </div>
                    <div class="footer">
                        <p>&copy; 2025 RehabPlus. All rights reserved.</p>
                        <p>This is an automated message. Please do not reply to this email.</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        // Generate .ics calendar file for attachment
        const icsContent = generateICSFile(apt);

        // Prepare email options
        const mailOptions = {
            from: `"${smtpConfig.fromName || 'RehabPlus'}" <${smtpConfig.fromEmail}>`,
            to: recipientEmail,
            subject: `Appointment Confirmation - ${dateStr}`,
            html: emailHTML
        };

        // Add .ics attachment if generated successfully
        if (icsContent) {
            mailOptions.attachments = [{
                filename: 'appointment.ics',
                content: icsContent,
                contentType: 'text/calendar; charset=utf-8; method=REQUEST'
            }];
            console.log('Calendar file (.ics) attached to email');
        } else {
            console.log('Could not generate calendar file, sending email without attachment');
        }

        // Send email
        const info = await transporter.sendMail(mailOptions);

        console.log('Email sent successfully:', info.messageId);
        return true;

    } catch (error) {
        console.error('Failed to send email:', error);
        return false;
    }
};

// Export all notification functions
module.exports = {
    sendLINENotification,
    sendSMSNotification,
    sendPatientSMS,
    createGoogleCalendarEvent,
    updateGoogleCalendarEvent,
    deleteGoogleCalendarEvent,
    generateICSFile,
    sendAppointmentConfirmationEmail
};