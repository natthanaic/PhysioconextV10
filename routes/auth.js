const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateToken, auditLog } = require('../middleware/auth');
const { hashPassword, verifyPassword, generateToken } = require('../utils/auth-helpers');
const { loginAttemptTracker, sanitizeEmail, isCommonPassword } = require('../utils/security');
const { isTOTPEnabled } = require('../utils/totp');

// Login with 2FA verification (step 2)
router.post('/login/verify-2fa', [
    body('userId').notEmpty(),
    body('token').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { userId, token, isBackupCode } = req.body;
        const db = req.app.locals.db;

        // Get user's TOTP data
        const [users] = await db.execute(
            `SELECT u.*, c.name as clinic_name
             FROM users u
             LEFT JOIN clinics c ON u.clinic_id = c.id
             WHERE u.id = ? AND u.active = 1`,
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        if (user.totp_enabled !== 1) {
            return res.status(400).json({ error: '2FA is not enabled for this user' });
        }

        // Verify TOTP or backup code
        let isValid = false;

        if (isBackupCode) {
            const { verifyBackupCode } = require('../utils/totp');
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
            const { verifyTOTP } = require('../utils/totp');
            isValid = verifyTOTP(user.totp_secret, token);
        }

        if (!isValid) {
            // Log failed 2FA attempt
            await auditLog(db, userId, '2FA_FAILED', 'user', userId, null, null, req);

            return res.status(400).json({
                error: 'Invalid verification code'
            });
        }

        // 2FA verification successful - complete login
        const sanitizedEmail = sanitizeEmail(user.email);

        // Clear failed login attempts
        loginAttemptTracker.clearAttempts(sanitizedEmail);

        // Update last login and last TOTP verified
        const { updateLastVerified } = require('../utils/totp');
        await Promise.all([
            db.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [userId]),
            updateLastVerified(db, userId)
        ]);

        // Generate token
        const token_jwt = generateToken(user);

        // Get user's clinic grants
        const [grants] = await db.execute(
            `SELECT g.clinic_id, c.name as clinic_name
             FROM user_clinic_grants g
             JOIN clinics c ON g.clinic_id = c.id
             WHERE g.user_id = ?`,
            [userId]
        );

        // Audit log
        await auditLog(db, userId, 'LOGIN_2FA_SUCCESS', 'user', userId, null, null, req);

        console.log('✅ 2FA login successful for user:', userId, user.email, user.role);

        // Set secure cookie
        res.cookie('authToken', token_jwt, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 12 * 60 * 60 * 1000 // 12 hours
        });

        res.json({
            success: true,
            token: token_jwt,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                name: `${user.first_name} ${user.last_name}`,
                clinic_id: user.clinic_id,
                clinic_name: user.clinic_name,
                clinic_grants: grants
            }
        });
    } catch (error) {
        console.error('2FA login verification error:', error);
        res.status(500).json({ error: '2FA verification failed' });
    }
});

// Login
router.post('/login', [
    body('email').isEmail(),
    body('password').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;
        const sanitizedEmail = sanitizeEmail(email);
        const db = req.app.locals.db;

        // Check if account is locked due to too many failed attempts
        const lockStatus = loginAttemptTracker.isLocked(sanitizedEmail);
        if (lockStatus.locked) {
            const remainingTime = Math.ceil((lockStatus.unlockTime - Date.now()) / 60000);
            return res.status(429).json({
                error: `Account temporarily locked due to too many failed login attempts. Please try again in ${remainingTime} minutes.`
            });
        }

        console.log('Login attempt for email:', sanitizedEmail);

        // Get user - case insensitive email search
        const [users] = await db.execute(
            `SELECT u.*, c.name as clinic_name
             FROM users u
             LEFT JOIN clinics c ON u.clinic_id = c.id
             WHERE LOWER(u.email) = LOWER(?) AND u.active = 1`,
            [sanitizedEmail]
        );

        if (users.length === 0) {
            console.log('User not found or inactive for email:', sanitizedEmail);

            // Record failed attempt
            loginAttemptTracker.recordFailedAttempt(sanitizedEmail);

            // Log failed login attempt
            await db.execute(
                `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, created_at)
                 VALUES (NULL, 'LOGIN_FAILED', 'user', NULL, ?, ?, NOW())`,
                [
                    req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                    req.headers['user-agent']
                ]
            ).catch(err => console.error('Failed to log failed login:', err));

            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];
        console.log('User found:', user.id, user.email, user.role);

        // Verify password
        const validPassword = await verifyPassword(password, user.password_hash);
        console.log('Password validation result:', validPassword);

        if (!validPassword) {
            console.log('Invalid password for user:', user.id);

            // Record failed attempt
            const attemptResult = loginAttemptTracker.recordFailedAttempt(sanitizedEmail);

            // Log failed login attempt
            await auditLog(db, user.id, 'LOGIN_FAILED', 'user', user.id, null, {
                email: sanitizedEmail,
                remainingAttempts: attemptResult.locked ? 0 : (5 - (attemptResult.attempts || 0))
            }, req);

            if (attemptResult.locked) {
                return res.status(429).json({
                    error: 'Account temporarily locked due to too many failed login attempts. Please try again in 30 minutes.'
                });
            }

            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if user has 2FA enabled (ADMIN and PT roles only)
        const requires2FA = await isTOTPEnabled(db, user.id);

        if (requires2FA) {
            console.log('🔐 2FA required for user:', user.id, user.email);

            // Don't clear failed attempts yet - wait for 2FA verification
            // Don't update last_login yet - wait for 2FA verification
            // Don't issue token yet - wait for 2FA verification

            return res.json({
                requires2FA: true,
                userId: user.id,
                email: user.email,
                message: 'Please enter your 2FA code from Google Authenticator'
            });
        }

        // Clear failed attempts on successful login
        loginAttemptTracker.clearAttempts(sanitizedEmail);

        // Update last login
        await db.execute(
            'UPDATE users SET last_login = NOW() WHERE id = ?',
            [user.id]
        );

        // Generate token
        const token = generateToken(user);

        // Get user's clinic grants
        const [grants] = await db.execute(
            `SELECT g.clinic_id, c.name as clinic_name
             FROM user_clinic_grants g
             JOIN clinics c ON g.clinic_id = c.id
             WHERE g.user_id = ?`,
            [user.id]
        );

        // Audit log
        await auditLog(db, user.id, 'LOGIN', 'user', user.id, null, null, req);

        console.log('Login successful for user:', user.id, user.email, user.role);

        // Set secure cookie with httpOnly flag (server-side only)
        res.cookie('authToken', token, {
            httpOnly: true, // Prevents JavaScript access (XSS protection)
            secure: process.env.NODE_ENV === 'production', // HTTPS only in production
            sameSite: 'lax', // CSRF protection (lax for better compatibility)
            maxAge: 12 * 60 * 60 * 1000 // 12 hours
        });

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                name: `${user.first_name} ${user.last_name}`,
                clinic_id: user.clinic_id,
                clinic_name: user.clinic_name,
                clinic_grants: grants
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        await auditLog(db, req.user.id, 'LOGOUT', 'user', req.user.id, null, null, req);

        res.clearCookie('authToken');
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [users] = await db.execute(
            `SELECT u.id, u.email, u.role, u.first_name, u.last_name, u.clinic_id,
                    c.name as clinic_name, u.phone, u.license_number,
                    u.google_id, u.google_email, u.google_name, u.google_picture, u.google_connected_at
             FROM users u
             LEFT JOIN clinics c ON u.clinic_id = c.id
             WHERE u.id = ?`,
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get clinic grants
        const [grants] = await db.execute(
            `SELECT g.clinic_id, c.name as clinic_name
             FROM user_clinic_grants g
             JOIN clinics c ON g.clinic_id = c.id
             WHERE g.user_id = ?`,
            [req.user.id]
        );

        res.json({
            ...users[0],
            clinic_grants: grants
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user information' });
    }
});

// Change password
router.post('/change-password', authenticateToken, [
    body('current_password').notEmpty(),
    body('new_password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/[A-Z]/)
        .withMessage('Password must contain at least one uppercase letter')
        .matches(/[a-z]/)
        .withMessage('Password must contain at least one lowercase letter')
        .matches(/[0-9]/)
        .withMessage('Password must contain at least one number')
        .matches(/[!@#$%^&*(),.?":{}|<>]/)
        .withMessage('Password must contain at least one special character')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { current_password, new_password } = req.body;
        const db = req.app.locals.db;

        // Check for common passwords
        if (isCommonPassword(new_password)) {
            return res.status(400).json({
                error: 'This password is too common. Please choose a more unique password.'
            });
        }

        // Get current password hash
        const [users] = await db.execute(
            'SELECT password_hash FROM users WHERE id = ?',
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify current password
        const validPassword = await verifyPassword(current_password, users[0].password_hash);
        if (!validPassword) {
            // Log failed password change attempt
            await auditLog(db, req.user.id, 'CHANGE_PASSWORD_FAILED', 'user', req.user.id, null, null, req);

            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const newHash = await hashPassword(new_password);

        // Update password
        await db.execute(
            'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
            [newHash, req.user.id]
        );

        await auditLog(db, req.user.id, 'CHANGE_PASSWORD', 'user', req.user.id, null, null, req);

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// Update profile
router.put('/update-profile', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { first_name, last_name, phone, license_number } = req.body;

        const updateFields = [];
        const updateValues = [];

        if (first_name) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name);
        }
        if (last_name) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name);
        }
        if (phone !== undefined) {
            updateFields.push('phone = ?');
            updateValues.push(phone);
        }
        if (license_number !== undefined) {
            updateFields.push('license_number = ?');
            updateValues.push(license_number);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.push('updated_at = NOW()');
        updateValues.push(userId);

        await db.execute(
            `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

module.exports = router;
