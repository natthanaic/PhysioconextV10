const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * Generate TOTP secret for a user
 * @param {string} userEmail - User's email
 * @param {string} appName - Application name (default: RehabPlus)
 * @returns {Object} Secret object with base32 secret and otpauth_url
 */
function generateTOTPSecret(userEmail, appName = 'RehabPlus') {
    const secret = speakeasy.generateSecret({
        name: `${appName} (${userEmail})`,
        length: 32,
        issuer: appName
    });

    return {
        secret: secret.base32,
        otpauth_url: secret.otpauth_url
    };
}

/**
 * Generate QR code as data URL
 * @param {string} otpauthUrl - OTP auth URL from secret generation
 * @returns {Promise<string>} QR code data URL
 */
async function generateQRCode(otpauthUrl) {
    try {
        const qrCodeDataURL = await QRCode.toDataURL(otpauthUrl);
        return qrCodeDataURL;
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw error;
    }
}

/**
 * Verify TOTP token
 * @param {string} secret - User's TOTP secret (base32)
 * @param {string} token - 6-digit token from user
 * @param {number} window - Time window for verification (default: 1 = ±30 seconds)
 * @returns {boolean} True if token is valid
 */
function verifyTOTP(secret, token, window = 1) {
    try {
        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: token,
            window: window
        });

        return verified;
    } catch (error) {
        console.error('Error verifying TOTP:', error);
        return false;
    }
}

/**
 * Generate backup codes
 * @param {number} count - Number of backup codes to generate (default: 10)
 * @returns {Array<string>} Array of backup codes
 */
function generateBackupCodes(count = 10) {
    const codes = [];
    for (let i = 0; i < count; i++) {
        // Generate 8-character alphanumeric code
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        // Format as XXXX-XXXX
        const formatted = code.match(/.{1,4}/g).join('-');
        codes.push(formatted);
    }
    return codes;
}

/**
 * Hash backup code for storage
 * @param {string} code - Backup code to hash
 * @returns {string} Hashed code
 */
function hashBackupCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Verify backup code
 * @param {string} inputCode - Code provided by user
 * @param {Array<string>} hashedCodes - Array of hashed backup codes from database
 * @returns {Object} {valid: boolean, remainingCodes: Array<string>}
 */
function verifyBackupCode(inputCode, hashedCodes) {
    const hashedInput = hashBackupCode(inputCode);
    const index = hashedCodes.indexOf(hashedInput);

    if (index === -1) {
        return { valid: false, remainingCodes: hashedCodes };
    }

    // Remove used code
    const remainingCodes = hashedCodes.filter((_, i) => i !== index);

    return {
        valid: true,
        remainingCodes: remainingCodes
    };
}

/**
 * Enable 2FA for user
 * @param {Object} db - Database connection
 * @param {number} userId - User ID
 * @param {string} secret - TOTP secret
 * @param {Array<string>} backupCodes - Array of backup codes
 * @returns {Promise<boolean>} Success status
 */
async function enableTOTP(db, userId, secret, backupCodes) {
    try {
        // Hash backup codes before storing
        const hashedCodes = backupCodes.map(code => hashBackupCode(code));

        await db.execute(
            `UPDATE users
             SET totp_secret = ?,
                 totp_enabled = 1,
                 totp_backup_codes = ?,
                 totp_enabled_at = NOW()
             WHERE id = ?`,
            [secret, JSON.stringify(hashedCodes), userId]
        );

        return true;
    } catch (error) {
        console.error('Error enabling TOTP:', error);
        return false;
    }
}

/**
 * Disable 2FA for user
 * @param {Object} db - Database connection
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
async function disableTOTP(db, userId) {
    try {
        await db.execute(
            `UPDATE users
             SET totp_secret = NULL,
                 totp_enabled = 0,
                 totp_backup_codes = NULL,
                 totp_enabled_at = NULL
             WHERE id = ?`,
            [userId]
        );

        return true;
    } catch (error) {
        console.error('Error disabling TOTP:', error);
        return false;
    }
}

/**
 * Update last TOTP verification time
 * @param {Object} db - Database connection
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
async function updateLastVerified(db, userId) {
    try {
        await db.execute(
            'UPDATE users SET last_totp_verified_at = NOW() WHERE id = ?',
            [userId]
        );
    } catch (error) {
        console.error('Error updating last verified:', error);
    }
}

/**
 * Check if user has 2FA enabled
 * @param {Object} db - Database connection
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} True if 2FA is enabled
 */
async function isTOTPEnabled(db, userId) {
    try {
        const [users] = await db.execute(
            'SELECT totp_enabled FROM users WHERE id = ?',
            [userId]
        );

        return users.length > 0 && users[0].totp_enabled === 1;
    } catch (error) {
        console.error('Error checking TOTP status:', error);
        return false;
    }
}

module.exports = {
    generateTOTPSecret,
    generateQRCode,
    verifyTOTP,
    generateBackupCodes,
    hashBackupCode,
    verifyBackupCode,
    enableTOTP,
    disableTOTP,
    updateLastVerified,
    isTOTPEnabled
};
