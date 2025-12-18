// Temporary migration endpoint - REMOVE AFTER USE
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth-helpers');

// POST /api/run-google-migration (ADMIN only)
router.post('/run-google-migration', authenticateToken, async (req, res) => {
    try {
        // Only allow ADMIN to run migrations
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can run migrations' });
        }

        const db = req.app.locals.db;
        const results = [];

        // Add Google OAuth columns
        try {
            await db.execute(`
                ALTER TABLE users
                ADD COLUMN google_id VARCHAR(255) DEFAULT NULL COMMENT 'Google account ID',
                ADD COLUMN google_email VARCHAR(255) DEFAULT NULL COMMENT 'Email from Google account',
                ADD COLUMN google_name VARCHAR(255) DEFAULT NULL COMMENT 'Name from Google account',
                ADD COLUMN google_picture TEXT DEFAULT NULL COMMENT 'Profile picture URL from Google',
                ADD COLUMN google_connected_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When Google account was connected'
            `);
            results.push('✅ Added Google OAuth columns');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                results.push('ℹ️  Google OAuth columns already exist');
            } else {
                throw err;
            }
        }

        // Create unique index on google_id
        try {
            await db.execute('CREATE UNIQUE INDEX idx_google_id ON users(google_id)');
            results.push('✅ Created unique index on google_id');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME') {
                results.push('ℹ️  Index idx_google_id already exists');
            } else {
                throw err;
            }
        }

        // Create index on google_email
        try {
            await db.execute('CREATE INDEX idx_google_email ON users(google_email)');
            results.push('✅ Created index on google_email');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME') {
                results.push('ℹ️  Index idx_google_email already exists');
            } else {
                throw err;
            }
        }

        // Verify columns exist
        const [columns] = await db.execute("SHOW COLUMNS FROM users LIKE 'google_%'");

        res.json({
            success: true,
            message: 'Google OAuth migration completed',
            results: results,
            columns: columns.map(col => col.Field)
        });

    } catch (error) {
        console.error('Migration error:', error);
        res.status(500).json({
            error: 'Migration failed',
            message: error.message,
            code: error.code
        });
    }
});

module.exports = router;
