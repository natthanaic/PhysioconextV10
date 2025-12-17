const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const { authenticateToken } = require('../middleware/auth');

// Initialize Google OAuth client
const getGoogleClient = () => {
    return new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL}/api/google/callback`
    );
};

/**
 * GET /api/google/auth-url
 * Generate Google OAuth URL for user to authorize
 */
router.get('/auth-url', authenticateToken, async (req, res) => {
    try {
        const client = getGoogleClient();

        const authUrl = client.generateAuthUrl({
            access_type: 'offline',
            scope: [
                'https://www.googleapis.com/auth/userinfo.profile',
                'https://www.googleapis.com/auth/userinfo.email'
            ],
            state: req.user.id.toString() // Pass user ID in state for verification
        });

        res.json({
            authUrl: authUrl
        });

    } catch (error) {
        console.error('Google auth URL generation error:', error);
        res.status(500).json({ error: 'Failed to generate Google auth URL' });
    }
});

/**
 * GET /api/google/callback
 * Handle Google OAuth callback
 */
router.get('/callback', async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.redirect('/profile?error=google_auth_failed');
        }

        const userId = parseInt(state);
        if (!userId) {
            return res.redirect('/profile?error=invalid_state');
        }

        const client = getGoogleClient();
        const db = req.app.locals.db;

        // Exchange code for tokens
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        // Get user info from Google
        const ticket = await client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        const googleId = payload['sub'];
        const googleEmail = payload['email'];
        const googleName = payload['name'];
        const googlePicture = payload['picture'];

        // Check if this Google account is already connected to another user
        const [existingUsers] = await db.execute(
            'SELECT id FROM users WHERE google_id = ? AND id != ?',
            [googleId, userId]
        );

        if (existingUsers.length > 0) {
            return res.redirect('/profile?error=google_account_already_linked');
        }

        // Update user with Google account info
        await db.execute(
            `UPDATE users
             SET google_id = ?,
                 google_email = ?,
                 google_name = ?,
                 google_picture = ?,
                 google_connected_at = NOW()
             WHERE id = ?`,
            [googleId, googleEmail, googleName, googlePicture, userId]
        );

        console.log(`✅ Google account connected for user ${userId}:`, googleEmail);

        // Redirect back to profile with success message
        res.redirect('/profile?success=google_connected');

    } catch (error) {
        console.error('Google OAuth callback error:', error);
        res.redirect('/profile?error=google_auth_failed');
    }
});

/**
 * POST /api/google/disconnect
 * Disconnect Google account from user profile
 */
router.post('/disconnect', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;

        // Remove Google account info
        await db.execute(
            `UPDATE users
             SET google_id = NULL,
                 google_email = NULL,
                 google_name = NULL,
                 google_picture = NULL,
                 google_connected_at = NULL
             WHERE id = ?`,
            [userId]
        );

        console.log(`✅ Google account disconnected for user ${userId}`);

        res.json({
            success: true,
            message: 'Google account disconnected successfully'
        });

    } catch (error) {
        console.error('Google disconnect error:', error);
        res.status(500).json({ error: 'Failed to disconnect Google account' });
    }
});

/**
 * GET /api/google/status
 * Get Google connection status for current user
 */
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;

        const [users] = await db.execute(
            `SELECT google_id, google_email, google_name, google_picture, google_connected_at
             FROM users WHERE id = ?`,
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];
        const isConnected = user.google_id !== null;

        res.json({
            connected: isConnected,
            googleEmail: user.google_email,
            googleName: user.google_name,
            googlePicture: user.google_picture,
            connectedAt: user.google_connected_at
        });

    } catch (error) {
        console.error('Google status error:', error);
        res.status(500).json({ error: 'Failed to get Google status' });
    }
});

/**
 * GET /api/google/signin-url
 * Generate Google OAuth URL for sign-in (no authentication required)
 */
router.get('/signin-url', async (req, res) => {
    try {
        const client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_SIGNIN_REDIRECT_URI || `${process.env.APP_URL}/api/google/signin-callback`
        );

        const authUrl = client.generateAuthUrl({
            access_type: 'offline',
            scope: [
                'https://www.googleapis.com/auth/userinfo.profile',
                'https://www.googleapis.com/auth/userinfo.email'
            ],
            state: 'signin' // Indicate this is for sign-in, not profile linking
        });

        res.json({
            authUrl: authUrl
        });

    } catch (error) {
        console.error('Google sign-in URL generation error:', error);
        res.status(500).json({ error: 'Failed to generate Google sign-in URL' });
    }
});

/**
 * GET /api/google/signin-callback
 * Handle Google OAuth callback for sign-in
 */
router.get('/signin-callback', async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.redirect('/login?error=google_signin_failed');
        }

        if (state !== 'signin') {
            return res.redirect('/login?error=invalid_state');
        }

        const client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_SIGNIN_REDIRECT_URI || `${process.env.APP_URL}/api/google/signin-callback`
        );

        const db = req.app.locals.db;

        // Exchange code for tokens
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        // Get user info from Google
        const ticket = await client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        const googleId = payload['sub'];
        const googleEmail = payload['email'];
        const googleName = payload['name'];
        const googlePicture = payload['picture'];

        console.log('🔐 Google Sign-In attempt:', googleEmail);

        // Scenario 1: Check if user already exists with this Google ID (already linked)
        let [users] = await db.execute(
            `SELECT u.*, c.name as clinic_name
             FROM users u
             LEFT JOIN clinics c ON u.clinic_id = c.id
             WHERE u.google_id = ? AND u.active = 1`,
            [googleId]
        );

        let user = users.length > 0 ? users[0] : null;

        // Scenario 2: User doesn't have Google ID but email matches - link account
        if (!user) {
            [users] = await db.execute(
                `SELECT u.*, c.name as clinic_name
                 FROM users u
                 LEFT JOIN clinics c ON u.clinic_id = c.id
                 WHERE u.email = ? AND u.active = 1`,
                [googleEmail]
            );

            if (users.length > 0) {
                user = users[0];
                // Link Google account to existing user
                await db.execute(
                    `UPDATE users
                     SET google_id = ?,
                         google_email = ?,
                         google_name = ?,
                         google_picture = ?,
                         google_connected_at = NOW()
                     WHERE id = ?`,
                    [googleId, googleEmail, googleName, googlePicture, user.id]
                );

                console.log('✅ Linked Google account to existing user:', user.id);
            }
        }

        // Scenario 3: New user - create account automatically
        if (!user) {
            // Extract first and last name from Google name
            const nameParts = googleName.split(' ');
            const firstName = nameParts[0] || googleName;
            const lastName = nameParts.slice(1).join(' ') || '';

            // Create new user account (role: USER by default, assign to first clinic)
            const [clinics] = await db.execute('SELECT id FROM clinics LIMIT 1');
            const defaultClinicId = clinics.length > 0 ? clinics[0].id : 1;

            const [result] = await db.execute(
                `INSERT INTO users
                 (email, password, first_name, last_name, role, clinic_id, active,
                  google_id, google_email, google_name, google_picture, google_connected_at, created_at)
                 VALUES (?, ?, ?, ?, 'USER', ?, 1, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    googleEmail,
                    '', // Empty password - will use Google Sign-In only
                    firstName,
                    lastName,
                    defaultClinicId,
                    googleId,
                    googleEmail,
                    googleName,
                    googlePicture
                ]
            );

            const newUserId = result.insertId;

            // Fetch the newly created user
            [users] = await db.execute(
                `SELECT u.*, c.name as clinic_name
                 FROM users u
                 LEFT JOIN clinics c ON u.clinic_id = c.id
                 WHERE u.id = ?`,
                [newUserId]
            );

            user = users[0];

            console.log('✅ Created new user account via Google Sign-In:', newUserId, googleEmail);
        }

        // Update last login
        await db.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

        // Generate JWT token
        const { generateToken } = require('../utils/auth-helpers');
        const token = generateToken(user);

        // Get user's clinic grants
        const [grants] = await db.execute(
            `SELECT g.clinic_id, c.name as clinic_name
             FROM user_clinic_grants g
             JOIN clinics c ON g.clinic_id = c.id
             WHERE g.user_id = ?`,
            [user.id]
        );

        console.log('✅ Google Sign-In successful for user:', user.id, user.email, user.role);

        // Set secure cookie
        res.cookie('authToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 12 * 60 * 60 * 1000 // 12 hours
        });

        // Redirect to dashboard (the cookie is set, so they'll be authenticated)
        res.redirect('/dashboard');

    } catch (error) {
        console.error('Google Sign-In callback error:', error);
        res.redirect('/login?error=google_signin_failed');
    }
});

module.exports = router;
