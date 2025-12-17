const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    generateTOTPSecret,
    generateQRCode,
    verifyTOTP,
    generateBackupCodes,
    enableTOTP,
    disableTOTP,
    verifyBackupCode,
    updateLastVerified
} = require('../utils/totp');

/**
 * POST /api/auth/2fa/setup
 * Generate TOTP secret and QR code for setup
 * Requires authentication
 */
router.post('/2fa/setup', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const userEmail = req.user.email;

        // Check if user is ADMIN or PT
        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            return res.status(403).json({
                error: 'Only ADMIN and PT roles can enable 2FA'
            });
        }

        // Check if 2FA is already enabled
        const [users] = await db.execute(
            'SELECT totp_enabled FROM users WHERE id = ?',
            [userId]
        );

        if (users.length > 0 && users[0].totp_enabled === 1) {
            return res.status(400).json({
                error: '2FA is already enabled. Disable it first to set up again.'
            });
        }

        // Generate TOTP secret
        const { secret, otpauth_url } = generateTOTPSecret(userEmail);

        // Generate QR code
        const qrCode = await generateQRCode(otpauth_url);

        // Store secret temporarily (not enabled yet)
        await db.execute(
            'UPDATE users SET totp_secret = ? WHERE id = ?',
            [secret, userId]
        );

        res.json({
            secret: secret,
            qrCode: qrCode,
            message: 'Scan this QR code with Google Authenticator app'
        });

    } catch (error) {
        console.error('2FA setup error:', error);
        res.status(500).json({ error: 'Failed to setup 2FA' });
    }
});

/**
 * POST /api/auth/2fa/enable
 * Enable 2FA after verifying the first TOTP code
 * Requires authentication
 */
router.post('/2fa/enable', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { token } = req.body;

        if (!token || token.length !== 6) {
            return res.status(400).json({ error: 'Invalid token format' });
        }

        // Get user's secret
        const [users] = await db.execute(
            'SELECT totp_secret, totp_enabled FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        if (!user.totp_secret) {
            return res.status(400).json({
                error: 'No 2FA setup found. Please run setup first.'
            });
        }

        if (user.totp_enabled === 1) {
            return res.status(400).json({ error: '2FA is already enabled' });
        }

        // Verify token
        const isValid = verifyTOTP(user.totp_secret, token);

        if (!isValid) {
            return res.status(400).json({
                error: 'Invalid verification code. Please try again.'
            });
        }

        // Generate backup codes
        const backupCodes = generateBackupCodes(10);

        // Enable 2FA
        const success = await enableTOTP(db, userId, user.totp_secret, backupCodes);

        if (!success) {
            return res.status(500).json({ error: 'Failed to enable 2FA' });
        }

        res.json({
            success: true,
            message: '2FA enabled successfully!',
            backupCodes: backupCodes,
            warning: 'Save these backup codes in a safe place. You will need them if you lose access to your authenticator app.'
        });

    } catch (error) {
        console.error('2FA enable error:', error);
        res.status(500).json({ error: 'Failed to enable 2FA' });
    }
});

/**
 * POST /api/auth/2fa/verify
 * Verify TOTP code during login
 * Does NOT require authentication (used during login)
 */
router.post('/2fa/verify', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { userId, token, isBackupCode } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        // Get user's TOTP data
        const [users] = await db.execute(
            'SELECT totp_secret, totp_enabled, totp_backup_codes FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        if (user.totp_enabled !== 1) {
            return res.status(400).json({ error: '2FA is not enabled for this user' });
        }

        let isValid = false;

        if (isBackupCode) {
            // Verify backup code
            const hashedCodes = JSON.parse(user.totp_backup_codes || '[]');
            const result = verifyBackupCode(token, hashedCodes);

            isValid = result.valid;

            if (isValid) {
                // Update remaining backup codes
                await db.execute(
                    'UPDATE users SET totp_backup_codes = ? WHERE id = ?',
                    [JSON.stringify(result.remainingCodes), userId]
                );

                console.log(`⚠️ User ${userId} used a backup code. Remaining: ${result.remainingCodes.length}`);
            }
        } else {
            // Verify TOTP token
            isValid = verifyTOTP(user.totp_secret, token);
        }

        if (!isValid) {
            return res.status(400).json({
                error: 'Invalid verification code'
            });
        }

        // Update last verified timestamp
        await updateLastVerified(db, userId);

        res.json({
            success: true,
            message: '2FA verification successful'
        });

    } catch (error) {
        console.error('2FA verification error:', error);
        res.status(500).json({ error: 'Failed to verify 2FA code' });
    }
});

/**
 * POST /api/auth/2fa/disable
 * Disable 2FA for user
 * Requires authentication and password confirmation
 */
router.post('/2fa/disable', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { password, token } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        // Verify password
        const bcrypt = require('bcrypt');
        const [users] = await db.execute(
            'SELECT password, totp_secret FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(400).json({ error: 'Invalid password' });
        }

        // Verify TOTP token if provided
        if (token) {
            const isValid = verifyTOTP(user.totp_secret, token);
            if (!isValid) {
                return res.status(400).json({ error: 'Invalid 2FA code' });
            }
        }

        // Disable 2FA
        const success = await disableTOTP(db, userId);

        if (!success) {
            return res.status(500).json({ error: 'Failed to disable 2FA' });
        }

        res.json({
            success: true,
            message: '2FA has been disabled'
        });

    } catch (error) {
        console.error('2FA disable error:', error);
        res.status(500).json({ error: 'Failed to disable 2FA' });
    }
});

/**
 * GET /api/auth/2fa/status
 * Get 2FA status for current user
 * Requires authentication
 */
router.get('/2fa/status', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;

        const [users] = await db.execute(
            `SELECT totp_enabled, totp_enabled_at, last_totp_verified_at,
                    LENGTH(totp_backup_codes) as has_backup_codes
             FROM users WHERE id = ?`,
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        res.json({
            enabled: user.totp_enabled === 1,
            enabledAt: user.totp_enabled_at,
            lastVerified: user.last_totp_verified_at,
            hasBackupCodes: user.has_backup_codes > 0,
            canEnable: req.user.role === 'ADMIN' || req.user.role === 'PT'
        });

    } catch (error) {
        console.error('2FA status error:', error);
        res.status(500).json({ error: 'Failed to get 2FA status' });
    }
});

/**
 * POST /api/auth/2fa/regenerate-backup-codes
 * Generate new backup codes (invalidates old ones)
 * Requires authentication and 2FA verification
 */
router.post('/2fa/regenerate-backup-codes', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: '2FA code is required' });
        }

        // Get user's TOTP secret
        const [users] = await db.execute(
            'SELECT totp_secret, totp_enabled FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        if (user.totp_enabled !== 1) {
            return res.status(400).json({ error: '2FA is not enabled' });
        }

        // Verify token
        const isValid = verifyTOTP(user.totp_secret, token);

        if (!isValid) {
            return res.status(400).json({ error: 'Invalid 2FA code' });
        }

        // Generate new backup codes
        const backupCodes = generateBackupCodes(10);
        const hashedCodes = backupCodes.map(code =>
            require('crypto').createHash('sha256').update(code).digest('hex')
        );

        // Update backup codes
        await db.execute(
            'UPDATE users SET totp_backup_codes = ? WHERE id = ?',
            [JSON.stringify(hashedCodes), userId]
        );

        res.json({
            success: true,
            backupCodes: backupCodes,
            message: 'New backup codes generated. Old codes are no longer valid.'
        });

    } catch (error) {
        console.error('Regenerate backup codes error:', error);
        res.status(500).json({ error: 'Failed to regenerate backup codes' });
    }
});

module.exports = router;
