const crypto = require('crypto');
const nodemailer = require('nodemailer');

/**
 * Generate a 6-digit OTP code
 * @returns {string} 6-digit OTP code
 */
function generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
}

/**
 * Send OTP via email
 * @param {Object} db - Database connection
 * @param {string} email - Recipient email
 * @param {string} otpCode - OTP code
 * @param {string} userName - User's name
 * @returns {Promise<boolean>} Success status
 */
async function sendOTPEmail(db, email, otpCode, userName) {
    try {
        // Get SMTP settings from database
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'smtp' LIMIT 1
        `);

        if (settings.length === 0) {
            console.error('SMTP settings not configured');
            return false;
        }

        const smtpConfig = JSON.parse(settings[0].setting_value);

        if (!smtpConfig.enabled || smtpConfig.enabled !== 1) {
            console.error('SMTP is not enabled');
            return false;
        }

        // Create transporter
        const transporter = nodemailer.createTransporter({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.secure === 1,
            auth: {
                user: smtpConfig.username,
                pass: smtpConfig.password
            }
        });

        // Email content
        const mailOptions = {
            from: `"${smtpConfig.senderName || 'RehabPlus Security'}" <${smtpConfig.senderEmail}>`,
            to: email,
            subject: '🔐 Your Login Verification Code',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                        .otp-box { background: white; border: 2px dashed #667eea; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
                        .otp-code { font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 8px; margin: 10px 0; }
                        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
                        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>🔐 Login Verification</h1>
                        </div>
                        <div class="content">
                            <p>Hello <strong>${userName}</strong>,</p>

                            <p>A login attempt requires verification. Use the code below to complete your login:</p>

                            <div class="otp-box">
                                <p style="margin: 0; color: #666; font-size: 14px;">Your Verification Code</p>
                                <div class="otp-code">${otpCode}</div>
                                <p style="margin: 0; color: #666; font-size: 12px;">Valid for 5 minutes</p>
                            </div>

                            <div class="warning">
                                <strong>⚠️ Security Warning:</strong>
                                <ul style="margin: 10px 0;">
                                    <li>Never share this code with anyone</li>
                                    <li>Our staff will never ask for this code</li>
                                    <li>If you didn't request this code, please ignore this email and secure your account</li>
                                </ul>
                            </div>

                            <p>This code will expire in <strong>5 minutes</strong>.</p>

                            <p>If you did not attempt to log in, please contact your system administrator immediately.</p>
                        </div>
                        <div class="footer">
                            <p>This is an automated security message from RehabPlus System</p>
                            <p>Please do not reply to this email</p>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        // Send email
        await transporter.sendMail(mailOptions);
        console.log(`✅ OTP email sent to ${email}`);
        return true;

    } catch (error) {
        console.error('Error sending OTP email:', error);
        return false;
    }
}

/**
 * Create and store OTP in database
 * @param {Object} db - Database connection
 * @param {number} userId - User ID
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - User agent
 * @returns {Promise<string>} OTP code
 */
async function createOTP(db, userId, ipAddress, userAgent) {
    try {
        // Generate OTP
        const otpCode = generateOTP();

        // Set expiration (5 minutes from now)
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        // Invalidate previous OTPs for this user
        await db.execute(
            'UPDATE otp_codes SET verified = -1 WHERE user_id = ? AND verified = 0',
            [userId]
        );

        // Insert new OTP
        await db.execute(
            `INSERT INTO otp_codes (user_id, otp_code, expires_at, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, otpCode, expiresAt, ipAddress, userAgent]
        );

        return otpCode;

    } catch (error) {
        console.error('Error creating OTP:', error);
        throw error;
    }
}

/**
 * Verify OTP code
 * @param {Object} db - Database connection
 * @param {number} userId - User ID
 * @param {string} otpCode - OTP code to verify
 * @returns {Promise<boolean>} Verification result
 */
async function verifyOTP(db, userId, otpCode) {
    try {
        // Find valid OTP
        const [otps] = await db.execute(
            `SELECT * FROM otp_codes
             WHERE user_id = ?
             AND otp_code = ?
             AND verified = 0
             AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [userId, otpCode]
        );

        if (otps.length === 0) {
            return false;
        }

        // Mark as verified
        await db.execute(
            'UPDATE otp_codes SET verified = 1 WHERE id = ?',
            [otps[0].id]
        );

        // Invalidate other OTPs for this user
        await db.execute(
            'UPDATE otp_codes SET verified = -1 WHERE user_id = ? AND id != ? AND verified = 0',
            [userId, otps[0].id]
        );

        return true;

    } catch (error) {
        console.error('Error verifying OTP:', error);
        return false;
    }
}

/**
 * Clean up expired OTPs (run periodically)
 * @param {Object} db - Database connection
 */
async function cleanupExpiredOTPs(db) {
    try {
        await db.execute('DELETE FROM otp_codes WHERE expires_at < NOW()');
        console.log('✅ Expired OTPs cleaned up');
    } catch (error) {
        console.error('Error cleaning up OTPs:', error);
    }
}

module.exports = {
    generateOTP,
    sendOTPEmail,
    createOTP,
    verifyOTP,
    cleanupExpiredOTPs
};
