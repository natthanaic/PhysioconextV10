// routes/admin.js - Admin Management Routes
const express = require('express');
const router = express.Router();
const multer = require('multer');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { authenticateToken, authorize, auditLog } = require('../middleware/auth');
const { hashPassword } = require('../utils/auth-helpers');

// Note: auditLog and hashPassword are now imported from middleware/utils
// No need to redefine them here

// ========================================
// FILE UPLOAD CONFIGURATION
// ========================================

const logoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const logoDir = './public/images/logos';
        if (!fs.existsSync(logoDir)) {
            fs.mkdirSync(logoDir, { recursive: true });
        }
        cb(null, logoDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadLogo = multer({
    storage: logoStorage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|svg/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = file.mimetype.startsWith('image/');

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, and SVG images are allowed.'));
        }
    }
});

// ========================================
// DIAGNOSTIC ROUTES
// ========================================

// Test route to verify admin routes are loading
router.get('/admin-test', (req, res) => {
    res.json({ message: 'Admin routes loaded successfully', timestamp: new Date().toISOString() });
});

// Get database structure for diagnostic purposes
router.get('/diagnostic/db-structure', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const results = {};

        // Check if courses table exists
        try {
            const [coursesDesc] = await db.execute('DESCRIBE courses');
            results.courses_table = { exists: true, columns: coursesDesc.map(c => c.Field) };
        } catch (e) {
            results.courses_table = { exists: false, error: e.message };
        }

        // Check if course_templates table exists
        try {
            const [templatesDesc] = await db.execute('DESCRIBE course_templates');
            results.course_templates_table = { exists: true, columns: templatesDesc.map(c => c.Field) };
        } catch (e) {
            results.course_templates_table = { exists: false, error: e.message };
        }

        // Check if course_usage_history table exists
        try {
            const [historyDesc] = await db.execute('DESCRIBE course_usage_history');
            results.course_usage_history_table = { exists: true, columns: historyDesc.map(c => c.Field) };
        } catch (e) {
            results.course_usage_history_table = { exists: false, error: e.message };
        }

        // Check if pn_cases has course_id column
        try {
            const [pnDesc] = await db.execute('DESCRIBE pn_cases');
            const hasCourseId = pnDesc.some(c => c.Field === 'course_id');
            results.pn_cases_course_id = { exists: hasCourseId, all_columns: pnDesc.map(c => c.Field) };
        } catch (e) {
            results.pn_cases_course_id = { exists: false, error: e.message };
        }

        res.json(results);
    } catch (error) {
        console.error('Diagnostic error:', error);
        res.status(500).json({ error: 'Diagnostic failed', details: error.message });
    }
});

// ========================================
// CLINIC MANAGEMENT ROUTES
// ========================================

// Get clinics (non-admin users see only their accessible clinics)
router.get('/clinics', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        let query = 'SELECT * FROM clinics WHERE active = 1';
        const params = [];

        // If not admin, only show accessible clinics
        if (req.user.role !== 'ADMIN') {
            const [grants] = await db.execute(
                'SELECT clinic_id FROM user_clinic_grants WHERE user_id = ? UNION SELECT ? as clinic_id WHERE ? IS NOT NULL',
                [req.user.id, req.user.clinic_id, req.user.clinic_id]
            );

            if (grants.length > 0) {
                const clinicIds = grants.map(g => g.clinic_id).filter(id => id);
                query += ` AND id IN (${clinicIds.map(() => '?').join(',')})`;
                params.push(...clinicIds);
            }
        }

        query += ' ORDER BY name';

        const [clinics] = await db.execute(query, params);
        res.json(clinics);
    } catch (error) {
        console.error('Get clinics error:', error);
        res.status(500).json({ error: 'Failed to retrieve clinics' });
    }
});

// Get users by role (for appointments, etc.)
router.get('/users', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { role } = req.query;

        let query = 'SELECT id, email, first_name, last_name, role, clinic_id FROM users WHERE active = 1';
        const params = [];

        // Filter by role if provided
        if (role) {
            query += ' AND role = ?';
            params.push(role);
        }

        query += ' ORDER BY first_name, last_name';

        const [users] = await db.execute(query, params);
        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to retrieve users' });
    }
});

// ========================================
// USER MANAGEMENT ROUTES (ADMIN ONLY)
// ========================================

// Get all users
router.get('/users', async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [users] = await db.execute(
            `SELECT u.*, c.name as clinic_name
             FROM users u
             LEFT JOIN clinics c ON u.clinic_id = c.id
             ORDER BY u.created_at DESC`
        );

        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to retrieve users' });
    }
});

// Create user
router.post('/users', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { email, password, role, first_name, last_name, clinic_id, phone, license_number } = req.body;

        // Check if email exists
        const [existing] = await db.execute(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        const hashedPassword = await hashPassword(password);

        const [result] = await db.execute(
            `INSERT INTO users (email, password_hash, role, first_name, last_name, clinic_id, phone, license_number, active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [email, hashedPassword, role, first_name, last_name, clinic_id, phone, license_number, true]
        );

        await auditLog(db, req.user.id, 'CREATE', 'user', result.insertId, null, req.body, req);

        res.status(201).json({ success: true, user_id: result.insertId });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Update user
router.put('/users/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { email, first_name, last_name, role, clinic_id, phone, license_number, active, password } = req.body;

        console.log('Update user request for ID:', id);
        console.log('Has password in request:', !!password);

        const updateFields = [];
        const updateValues = [];

        if (email !== undefined) {
            // Check if email is already taken by another user
            const [existingUsers] = await db.execute(
                'SELECT id FROM users WHERE email = ? AND id != ?',
                [email, id]
            );
            if (existingUsers.length > 0) {
                return res.status(400).json({ error: 'Email already in use by another user' });
            }
            updateFields.push('email = ?');
            updateValues.push(email);
        }
        if (first_name !== undefined) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name);
        }
        if (last_name !== undefined) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name);
        }
        if (role !== undefined) {
            updateFields.push('role = ?');
            updateValues.push(role);
        }
        if (clinic_id !== undefined) {
            updateFields.push('clinic_id = ?');
            updateValues.push(clinic_id);
        }
        if (phone !== undefined) {
            updateFields.push('phone = ?');
            updateValues.push(phone);
        }
        if (license_number !== undefined) {
            updateFields.push('license_number = ?');
            updateValues.push(license_number);
        }
        if (active !== undefined) {
            updateFields.push('active = ?');
            updateValues.push(active);
        }
        if (password && password.trim() !== '') {
            console.log('Updating password for user:', id);
            const hashedPassword = await hashPassword(password);
            updateFields.push('password_hash = ?');
            updateValues.push(hashedPassword);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.push('updated_at = NOW()');
        updateValues.push(id);

        await db.execute(
            `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        console.log('User updated successfully. Fields updated:', updateFields.map(f => f.split(' = ')[0]));

        await auditLog(db, req.user.id, 'UPDATE', 'user', id, null, req.body, req);

        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Toggle user status
router.patch('/users/:id/status', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { active } = req.body;

        await db.execute(
            'UPDATE users SET active = ?, updated_at = NOW() WHERE id = ?',
            [active, id]
        );

        await auditLog(db, req.user.id, 'UPDATE_STATUS', 'user', id, null, { active }, req);

        res.json({ success: true });
    } catch (error) {
        console.error('Toggle user status error:', error);
        res.status(500).json({ error: 'Failed to update user status' });
    }
});

// Get user clinic grants
router.get('/users/:id/grants', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [grants] = await db.execute(
            `SELECT g.*, c.name as clinic_name
             FROM user_clinic_grants g
             JOIN clinics c ON g.clinic_id = c.id
             WHERE g.user_id = ?`,
            [id]
        );

        res.json(grants);
    } catch (error) {
        console.error('Get user grants error:', error);
        res.status(500).json({ error: 'Failed to retrieve grants' });
    }
});

// ========================================
// CLINIC GRANT ROUTES
// ========================================

// Add clinic grant
router.post('/grants', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { user_id, clinic_id } = req.body;

        // Check if grant already exists
        const [existing] = await db.execute(
            'SELECT id FROM user_clinic_grants WHERE user_id = ? AND clinic_id = ?',
            [user_id, clinic_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Grant already exists' });
        }

        await db.execute(
            'INSERT INTO user_clinic_grants (user_id, clinic_id, granted_by) VALUES (?, ?, ?)',
            [user_id, clinic_id, req.user.id]
        );

        await auditLog(db, req.user.id, 'CREATE', 'grant', null, null, { user_id, clinic_id }, req);

        res.json({ success: true });
    } catch (error) {
        console.error('Add grant error:', error);
        res.status(500).json({ error: 'Failed to add grant' });
    }
});

// Remove clinic grant
router.delete('/grants/:userId/:clinicId', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { userId, clinicId } = req.params;

        await db.execute(
            'DELETE FROM user_clinic_grants WHERE user_id = ? AND clinic_id = ?',
            [userId, clinicId]
        );

        await auditLog(db, req.user.id, 'DELETE', 'grant', null, { user_id: userId, clinic_id: clinicId }, null, req);

        res.json({ success: true });
    } catch (error) {
        console.error('Remove grant error:', error);
        res.status(500).json({ error: 'Failed to remove grant' });
    }
});

// ========================================
// CLINIC MANAGEMENT ROUTES (ADMIN ONLY)
// ========================================

// Get all clinics with statistics (ADMIN route - should be /admin/clinics)
router.get('/admin/clinics', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [clinics] = await db.execute(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM patients WHERE clinic_id = c.id) as patient_count,
                    (SELECT COUNT(*) FROM pn_cases WHERE source_clinic_id = c.id OR target_clinic_id = c.id) as case_count,
                    (SELECT COUNT(*) FROM users WHERE clinic_id = c.id AND active = 1) as user_count
             FROM clinics c
             ORDER BY c.name`
        );

        const [stats] = await db.execute(
            `SELECT
                COUNT(*) as total,
                SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active,
                (SELECT COUNT(*) FROM patients) as total_patients,
                (SELECT COUNT(*) FROM pn_cases) as total_cases
             FROM clinics`
        );

        res.json({
            clinics,
            statistics: stats[0]
        });
    } catch (error) {
        console.error('Get clinics error:', error);
        res.status(500).json({ error: 'Failed to retrieve clinics' });
    }
});

// Create clinic
router.post('/clinics', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { code, name, address, phone, email, contact_person } = req.body;

        // Check if code exists
        const [existing] = await db.execute(
            'SELECT id FROM clinics WHERE code = ?',
            [code]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Clinic code already exists' });
        }

        const [result] = await db.execute(
            `INSERT INTO clinics (code, name, address, phone, email, contact_person, active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [code, name, address, phone, email, contact_person, true]
        );

        await auditLog(db, req.user.id, 'CREATE', 'clinic', result.insertId, null, req.body, req);

        res.status(201).json({ success: true, clinic_id: result.insertId });
    } catch (error) {
        console.error('Create clinic error:', error);
        res.status(500).json({ error: 'Failed to create clinic' });
    }
});

// Update clinic
router.put('/clinics/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { code, name, address, phone, email, contact_person, active } = req.body;

        const updateFields = [];
        const updateValues = [];

        if (code !== undefined) {
            updateFields.push('code = ?');
            updateValues.push(code);
        }
        if (name !== undefined) {
            updateFields.push('name = ?');
            updateValues.push(name);
        }
        if (address !== undefined) {
            updateFields.push('address = ?');
            updateValues.push(address);
        }
        if (phone !== undefined) {
            updateFields.push('phone = ?');
            updateValues.push(phone);
        }
        if (email !== undefined) {
            updateFields.push('email = ?');
            updateValues.push(email);
        }
        if (contact_person !== undefined) {
            updateFields.push('contact_person = ?');
            updateValues.push(contact_person);
        }
        if (active !== undefined) {
            updateFields.push('active = ?');
            updateValues.push(active);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.push('updated_at = NOW()');
        updateValues.push(id);

        await db.execute(
            `UPDATE clinics SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        await auditLog(db, req.user.id, 'UPDATE', 'clinic', id, null, req.body, req);

        res.json({ success: true });
    } catch (error) {
        console.error('Update clinic error:', error);
        res.status(500).json({ error: 'Failed to update clinic' });
    }
});

// Toggle clinic status
router.patch('/clinics/:id/status', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { active } = req.body;

        await db.execute(
            'UPDATE clinics SET active = ?, updated_at = NOW() WHERE id = ?',
            [active, id]
        );

        await auditLog(db, req.user.id, 'UPDATE_STATUS', 'clinic', id, null, { active }, req);

        res.json({ success: true });
    } catch (error) {
        console.error('Toggle clinic status error:', error);
        res.status(500).json({ error: 'Failed to update clinic status' });
    }
});

// Get clinic details
router.get('/clinics/:id/details', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [clinic] = await db.execute(
            'SELECT * FROM clinics WHERE id = ?',
            [id]
        );

        if (clinic.length === 0) {
            return res.status(404).json({ error: 'Clinic not found' });
        }

        const [stats] = await db.execute(
            `SELECT
                (SELECT COUNT(*) FROM patients WHERE clinic_id = ?) as patient_count,
                (SELECT COUNT(*) FROM pn_cases WHERE source_clinic_id = ? OR target_clinic_id = ?) as case_count,
                (SELECT COUNT(*) FROM users WHERE clinic_id = ? AND active = 1) as user_count`,
            [id, id, id, id]
        );

        const [recentCases] = await db.execute(
            `SELECT pn.pn_code, pn.status, pn.created_at,
                    CONCAT(p.first_name, ' ', p.last_name) as patient_name
             FROM pn_cases pn
             JOIN patients p ON pn.patient_id = p.id
             WHERE pn.source_clinic_id = ? OR pn.target_clinic_id = ?
             ORDER BY pn.created_at DESC
             LIMIT 5`,
            [id, id]
        );

        res.json({
            ...clinic[0],
            ...stats[0],
            recent_cases: recentCases
        });
    } catch (error) {
        console.error('Get clinic details error:', error);
        res.status(500).json({ error: 'Failed to retrieve clinic details' });
    }
});

// ========================================
// NOTIFICATION SETTINGS ROUTES (ADMIN ONLY)
// ========================================

// Get SMTP settings
router.get('/notification/smtp', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [settings] = await db.execute(`
            SELECT * FROM notification_settings WHERE setting_type = 'smtp' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'No SMTP settings found' });
        }

        // Parse JSON fields
        const smtpSettings = settings[0];
        if (smtpSettings.setting_value) {
            try {
                const parsed = JSON.parse(smtpSettings.setting_value);
                res.json(parsed);
            } catch (e) {
                res.json(smtpSettings);
            }
        } else {
            res.json(smtpSettings);
        }
    } catch (error) {
        console.error('Get SMTP settings error:', error);
        res.status(500).json({ error: 'Failed to load SMTP settings' });
    }
});

// Save SMTP settings
router.post('/notification/smtp', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const settings = req.body;

        const settingValue = JSON.stringify(settings);

        await db.execute(`
            INSERT INTO notification_settings
            (setting_type, setting_value, updated_by, created_at, updated_at)
            VALUES ('smtp', ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
            setting_value = ?,
            updated_by = ?,
            updated_at = NOW()
        `, [settingValue, userId, settingValue, userId]);

        res.json({ success: true, message: 'SMTP settings saved successfully' });
    } catch (error) {
        console.error('Save SMTP settings error:', error);
        res.status(500).json({ error: 'Failed to save SMTP settings' });
    }
});

// Test SMTP configuration
router.post('/notification/smtp/test', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email address is required' });
        }

        // Get SMTP settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'smtp' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'SMTP settings not configured' });
        }

        const smtpConfig = JSON.parse(settings[0].setting_value);

        if (smtpConfig.enabled !== 1) {
            return res.status(400).json({ error: 'SMTP is not enabled' });
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

        // Send test email
        const info = await transporter.sendMail({
            from: `"${smtpConfig.fromName || 'RehabPlus'}" <${smtpConfig.fromEmail}>`,
            to: email,
            subject: 'Test Email from RehabPlus',
            html: `
                <h2>Test Email</h2>
                <p>This is a test email from RehabPlus notification system.</p>
                <p>If you receive this email, your SMTP configuration is working correctly.</p>
                <hr>
                <p><small>Sent at: ${new Date().toLocaleString()}</small></p>
            `
        });

        res.json({ success: true, message: 'Test email sent successfully', messageId: info.messageId });
    } catch (error) {
        console.error('Test SMTP error:', error);
        res.status(500).json({ error: error.message || 'Failed to send test email' });
    }
});

// Get LINE settings
router.get('/notification/line', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [settings] = await db.execute(`
            SELECT * FROM notification_settings WHERE setting_type = 'line' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'No LINE settings found' });
        }

        // Parse JSON fields
        const lineSettings = settings[0];
        if (lineSettings.setting_value) {
            try {
                const parsed = JSON.parse(lineSettings.setting_value);
                res.json(parsed);
            } catch (e) {
                res.json(lineSettings);
            }
        } else {
            res.json(lineSettings);
        }
    } catch (error) {
        console.error('Get LINE settings error:', error);
        res.status(500).json({ error: 'Failed to load LINE settings' });
    }
});

// Debug endpoint - show how LINE settings are parsed
router.get('/notification/line/debug', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'line' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.json({ error: 'No LINE settings found' });
        }

        const rawValue = settings[0].setting_value;
        const lineConfig = JSON.parse(rawValue);

        let eventNotifications;
        if (typeof lineConfig.eventNotifications === 'string') {
            eventNotifications = JSON.parse(lineConfig.eventNotifications);
            // Handle double-encoded
            if (typeof eventNotifications === 'string') {
                eventNotifications = JSON.parse(eventNotifications);
            }
        } else {
            eventNotifications = lineConfig.eventNotifications || {};
        }

        res.json({
            raw_database_value: rawValue,
            after_first_parse: lineConfig,
            eventNotifications_type: typeof lineConfig.eventNotifications,
            eventNotifications_parsed: eventNotifications,
            checks: {
                newAppointment: {
                    value: eventNotifications.newAppointment,
                    will_send: !!eventNotifications.newAppointment
                },
                appointmentRescheduled: {
                    value: eventNotifications.appointmentRescheduled,
                    will_send: !!eventNotifications.appointmentRescheduled
                },
                appointmentCancelled: {
                    value: eventNotifications.appointmentCancelled,
                    will_send: !!eventNotifications.appointmentCancelled
                },
                newPatient: {
                    value: eventNotifications.newPatient,
                    will_send: !!eventNotifications.newPatient
                },
                paymentReceived: {
                    value: eventNotifications.paymentReceived,
                    will_send: !!eventNotifications.paymentReceived
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// Save LINE settings
router.post('/notification/line', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const settings = req.body;

        const settingValue = JSON.stringify(settings);

        await db.execute(`
            INSERT INTO notification_settings
            (setting_type, setting_value, updated_by, created_at, updated_at)
            VALUES ('line', ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
            setting_value = ?,
            updated_by = ?,
            updated_at = NOW()
        `, [settingValue, userId, settingValue, userId]);

        res.json({ success: true, message: 'LINE settings saved successfully' });
    } catch (error) {
        console.error('Save LINE settings error:', error);
        res.status(500).json({ error: 'Failed to save LINE settings' });
    }
});

// Test LINE notification
router.post('/notification/line/test', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Get LINE settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'line' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'LINE settings not configured' });
        }

        const lineConfig = JSON.parse(settings[0].setting_value);

        if (lineConfig.enabled !== 1) {
            return res.status(400).json({ error: 'LINE notification is not enabled' });
        }

        if (!lineConfig.accessToken) {
            return res.status(400).json({ error: 'Channel Access Token not configured' });
        }

        if (!lineConfig.targetId) {
            return res.status(400).json({ error: 'Target User ID or Group ID not configured' });
        }

        // Send LINE Messaging API notification (Push Message)
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
            res.json({ success: true, message: 'Test notification sent successfully' });
        } else {
            throw new Error('Failed to send LINE notification');
        }
    } catch (error) {
        console.error('Test LINE error:', error);
        if (error.response) {
            // Log the full LINE API error for debugging
            console.error('LINE API error details:', JSON.stringify(error.response.data, null, 2));

            const lineError = error.response.data;
            let errorMessage = 'Failed to send test notification';

            // Provide more detailed error messages based on LINE API response
            if (lineError.message) {
                errorMessage = lineError.message;

                // Add helpful hints for common errors
                if (lineError.message.includes('Invalid reply token')) {
                    errorMessage += '. Make sure you are using Push Message API, not Reply API.';
                } else if (lineError.message.includes('The request body has 1 error(s)')) {
                    errorMessage += '. Check your Channel Access Token and Target ID format.';
                } else if (lineError.message.includes('authentication')) {
                    errorMessage += '. Please verify your Channel Access Token is correct.';
                } else if (lineError.message.includes('not found')) {
                    errorMessage += '. The Target User ID or Group ID may be invalid.';
                }
            }

            // Include details if available
            if (lineError.details && lineError.details.length > 0) {
                errorMessage += ' Details: ' + lineError.details.map(d => d.message).join(', ');
            }

            res.status(error.response.status).json({ error: errorMessage });
        } else {
            res.status(500).json({ error: error.message || 'Failed to send test notification' });
        }
    }
});

// ========================================
// SMS NOTIFICATION ROUTES
// ========================================

// Get SMS settings
router.get('/notification/sms', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [settings] = await db.execute(`
            SELECT * FROM notification_settings WHERE setting_type = 'sms' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'No SMS settings found' });
        }

        const smsSettings = settings[0];
        if (smsSettings.setting_value) {
            try {
                const parsed = JSON.parse(smsSettings.setting_value);
                res.json(parsed);
            } catch (e) {
                res.json(smsSettings);
            }
        } else {
            res.json(smsSettings);
        }
    } catch (error) {
        console.error('Get SMS settings error:', error);
        res.status(500).json({ error: 'Failed to load SMS settings' });
    }
});

// Save SMS settings
router.post('/notification/sms', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const settings = req.body;

        const settingValue = JSON.stringify(settings);

        await db.execute(`
            INSERT INTO notification_settings
            (setting_type, setting_value, updated_by, created_at, updated_at)
            VALUES ('sms', ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
            setting_value = ?,
            updated_by = ?,
            updated_at = NOW()
        `, [settingValue, userId, settingValue, userId]);

        res.json({ success: true, message: 'SMS settings saved successfully' });
    } catch (error) {
        console.error('Save SMS settings error:', error);
        res.status(500).json({ error: 'Failed to save SMS settings' });
    }
});

// Test SMS notification
router.post('/notification/sms/test', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Get SMS settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'sms' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'SMS settings not configured' });
        }

        const smsConfig = JSON.parse(settings[0].setting_value);

        if (!smsConfig.enabled || smsConfig.enabled === 0) {
            return res.status(400).json({ error: 'SMS notifications are disabled' });
        }

        if (!smsConfig.apiKey || !smsConfig.apiSecret) {
            return res.status(400).json({ error: 'API credentials not configured' });
        }

        if (!smsConfig.recipients) {
            return res.status(400).json({ error: 'No recipients configured' });
        }

        // Send test SMS using Thai Bulk SMS API (expects form-encoded data, NOT JSON)
        const axios = require('axios');
        const querystring = require('querystring');

        // Create Basic Auth header manually (matches Thai Bulk SMS example)
        const authString = Buffer.from(`${smsConfig.apiKey}:${smsConfig.apiSecret}`).toString('base64');

        const response = await axios.post(
            'https://api-v2.thaibulksms.com/sms',
            querystring.stringify({
                msisdn: smsConfig.recipients,
                message: message,
                sender: smsConfig.sender || 'RehabPlus',
                force: smsConfig.smsType || 'standard'
            }),
            {
                headers: {
                    'accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${authString}`
                }
            }
        );

        console.log('Thai Bulk SMS Response:', response.data);

        if (response.data && response.data.code === undefined) {
            // Success - no error code means message sent
            res.json({
                success: true,
                message: 'Test SMS sent successfully',
                details: response.data
            });
        } else if (response.data && response.data.code) {
            // Error response
            throw new Error(response.data.description || 'SMS API returned error');
        } else {
            res.json({
                success: true,
                message: 'Test SMS sent successfully',
                details: response.data
            });
        }
    } catch (error) {
        console.error('==========================================');
        console.error('SMS TEST ERROR - Full Details:');
        console.error('==========================================');
        console.error('Error Message:', error.message);
        console.error('Error Code:', error.code);
        console.error('Error Stack:', error.stack);

        if (error.response) {
            // API responded with error
            console.error('API Response Status:', error.response.status);
            console.error('API Response Headers:', error.response.headers);
            console.error('API Response Data:', JSON.stringify(error.response.data, null, 2));

            const smsError = error.response.data;
            let errorMessage = 'Failed to send test SMS';

            if (smsError.description) {
                errorMessage += ': ' + smsError.description;
            } else if (smsError.message) {
                errorMessage += ': ' + smsError.message;
            }

            res.status(400).json({
                error: errorMessage,
                details: {
                    status: error.response.status,
                    data: error.response.data
                }
            });
        } else if (error.request) {
            // Request made but no response received (network/connection issue)
            console.error('No response received from Thai Bulk SMS API');
            console.error('Request config:', {
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers,
                timeout: error.config?.timeout
            });

            res.status(400).json({
                error: 'Cannot connect to Thai Bulk SMS API',
                details: {
                    message: 'Network error or API unavailable',
                    code: error.code,
                    hint: 'Check server firewall, DNS, or Thai Bulk SMS API status'
                }
            });
        } else {
            // Something else went wrong
            console.error('Unexpected error:', error);
            res.status(400).json({
                error: 'Failed to send test SMS: ' + error.message,
                details: {
                    code: error.code,
                    message: error.message
                }
            });
        }
        console.error('==========================================');
    }
});

// Check SMS credit balance
router.get('/notification/sms/credit', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        console.log('💳 Checking SMS credit balance...');

        // Get SMS settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'sms' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('❌ No SMS settings found');
            return res.status(404).json({ error: 'SMS settings not configured' });
        }

        const smsConfig = JSON.parse(settings[0].setting_value);

        // Use type from query parameter if provided, otherwise use saved setting
        const smsType = req.query.type || smsConfig.smsType || 'standard';

        console.log('📋 SMS Config loaded:', {
            hasApiKey: !!smsConfig.apiKey,
            hasApiSecret: !!smsConfig.apiSecret,
            savedSmsType: smsConfig.smsType,
            requestedType: req.query.type,
            usingType: smsType
        });

        if (!smsConfig.apiKey || !smsConfig.apiSecret) {
            console.log('❌ Missing API credentials');
            return res.status(400).json({ error: 'API credentials not configured' });
        }

        // Check credit via Thai Bulk SMS API
        const axios = require('axios');
        const authString = Buffer.from(`${smsConfig.apiKey}:${smsConfig.apiSecret}`).toString('base64');

        console.log('🔄 Calling Thai Bulk SMS credit API with type:', smsType);

        const response = await axios.get(
            `https://api-v2.thaibulksms.com/credit?force=${smsType}`,
            {
                headers: {
                    'accept': 'application/json',
                    'Authorization': `Basic ${authString}`
                }
            }
        );

        console.log('✅ Credit API response:', response.data);

        // Parse the nested credit structure
        const remainingCredit = response.data.remaining_credit || {};
        const credit = remainingCredit[smsType] || 0;

        console.log(`📊 Credit balance for ${smsType}:`, credit);
        console.log(`📊 All credits:`, remainingCredit);

        res.json({
            success: true,
            credit: credit,
            smsType: smsType,
            allCredits: remainingCredit
        });
    } catch (error) {
        console.error('❌ Check SMS credit error:', error.message);
        if (error.response) {
            console.error('API Error Response:', {
                status: error.response.status,
                data: error.response.data
            });
            res.status(400).json({
                error: 'Failed to check SMS credit',
                details: error.response.data
            });
        } else {
            res.status(500).json({ error: 'Failed to check SMS credit: ' + error.message });
        }
    }
});

// GET SMS Template
router.get('/sms-template', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [templates] = await db.execute(`
            SELECT * FROM notification_settings WHERE setting_type = 'sms_template' LIMIT 1
        `);

        if (templates.length > 0) {
            res.json({
                template: templates[0].setting_value
            });
        } else {
            // Return default template
            res.json({
                template: `[{clinicName}] Appointment Confirmed

Dear {patientName},

Your appointment has been booked:
📅 Date: {date}
🕐 Time: {startTime} - {endTime}
👨‍⚕️ Therapist: {ptName}
🏥 Clinic: {clinicName}

Please arrive 10 minutes early.

Thank you!`
            });
        }
    } catch (error) {
        console.error('Get SMS template error:', error);
        res.status(500).json({ error: 'Failed to retrieve SMS template' });
    }
});

// POST SMS Template
router.post('/sms-template', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { template } = req.body;

        if (!template || template.trim() === '') {
            return res.status(400).json({ error: 'Template cannot be empty' });
        }

        // Check if template exists
        const [existing] = await db.execute(`
            SELECT * FROM notification_settings WHERE setting_type = 'sms_template' LIMIT 1
        `);

        if (existing.length > 0) {
            // Update existing template
            await db.execute(`
                UPDATE notification_settings
                SET setting_value = ?, updated_at = CURRENT_TIMESTAMP
                WHERE setting_type = 'sms_template'
            `, [template]);
        } else {
            // Insert new template
            await db.execute(`
                INSERT INTO notification_settings (setting_type, setting_value, created_at, updated_at)
                VALUES ('sms_template', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [template]);
        }

        res.json({ success: true, message: 'SMS template saved successfully' });
    } catch (error) {
        console.error('Save SMS template error:', error);
        res.status(500).json({ error: 'Failed to save SMS template' });
    }
});

// Get recent LINE webhook events (for admin to see captured IDs)
router.get('/notification/line/webhook-ids', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Get recent events from the database or in-memory store
        // This endpoint helps admins capture User/Group IDs from LINE webhook events
        res.json({
            events: [],
            count: 0,
            instructions: [
                '1. Add your LINE bot as a friend (or add to group)',
                '2. Send any message to the bot',
                '3. Refresh this page to see the User/Group ID',
                '4. Copy the ID and paste it into notification settings'
            ]
        });
    } catch (error) {
        console.error('Get LINE webhook IDs error:', error);
        res.status(500).json({ error: 'Failed to retrieve webhook IDs' });
    }
});

// Get Google Calendar settings
router.get('/notification/google-calendar', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [settings] = await db.execute(`
            SELECT * FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'No Google Calendar settings found' });
        }

        // Parse JSON fields
        const calendarSettings = settings[0];
        if (calendarSettings.setting_value) {
            try {
                const parsed = JSON.parse(calendarSettings.setting_value);
                res.json(parsed);
            } catch (e) {
                res.json(calendarSettings);
            }
        } else {
            res.json(calendarSettings);
        }
    } catch (error) {
        console.error('Get Google Calendar settings error:', error);
        res.status(500).json({ error: 'Failed to load Google Calendar settings' });
    }
});

// Save Google Calendar settings
router.post('/notification/google-calendar', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const settings = req.body;

        const settingValue = JSON.stringify(settings);

        await db.execute(`
            INSERT INTO notification_settings
            (setting_type, setting_value, updated_by, created_at, updated_at)
            VALUES ('google_calendar', ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
            setting_value = ?,
            updated_by = ?,
            updated_at = NOW()
        `, [settingValue, userId, settingValue, userId]);

        res.json({ success: true, message: 'Google Calendar settings saved successfully' });
    } catch (error) {
        console.error('Save Google Calendar settings error:', error);
        res.status(500).json({ error: 'Failed to save Google Calendar settings' });
    }
});

// Test Google Calendar configuration
router.post('/notification/google-calendar/test', authenticateToken, authorize('ADMIN'), async (req, res) => {
    let debugInfo = { step: 'start' };

    try {
        const db = req.app.locals.db;

        // Get Google Calendar settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'Google Calendar settings not configured' });
        }

        const calendarConfig = JSON.parse(settings[0].setting_value);

        if (!calendarConfig.enabled || calendarConfig.enabled === '0') {
            return res.status(400).json({ error: 'Google Calendar is not enabled' });
        }

        if (!calendarConfig.serviceAccountEmail) {
            return res.status(400).json({ error: 'Service Account Email not configured' });
        }

        if (!calendarConfig.privateKey) {
            return res.status(400).json({ error: 'Private Key not configured' });
        }

        if (!calendarConfig.calendarId) {
            return res.status(400).json({ error: 'Calendar ID not configured' });
        }

        // Validate private key format
        const privateKey = calendarConfig.privateKey ? calendarConfig.privateKey.trim() : '';

        // Collect debug info
        debugInfo = {
            step: 'initial',
            hasPrivateKey: !!calendarConfig.privateKey,
            privateKeyLength: privateKey.length,
            privateKeyType: typeof privateKey,
            hasBeginMarker: privateKey.includes('-----BEGIN PRIVATE KEY-----'),
            hasEndMarker: privateKey.includes('-----END PRIVATE KEY-----'),
            hasEscapedNewlines: privateKey.includes('\\n'),
            firstChars: privateKey.substring(0, 60),
            lastChars: privateKey.substring(privateKey.length - 60),
            serviceAccountEmail: calendarConfig.serviceAccountEmail,
            calendarId: calendarConfig.calendarId
        };

        console.log('Testing Google Calendar connection...');
        console.log('Debug Info:', JSON.stringify(debugInfo, null, 2));

        if (!privateKey || privateKey.length === 0) {
            return res.status(400).json({
                error: 'Private Key is empty',
                debug: debugInfo
            });
        }

        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
            return res.status(400).json({
                error: 'Invalid Private Key format. The key must include the "-----BEGIN PRIVATE KEY-----" and "-----END PRIVATE KEY-----" lines.',
                debug: debugInfo
            });
        }

        // Process the private key - replace literal \n with actual newlines
        let processedKey = privateKey;
        if (privateKey.includes('\\n')) {
            processedKey = privateKey.replace(/\\n/g, '\n');
            console.log('Converted escaped newlines to actual newlines');
        }

        // Trim the processed key
        processedKey = processedKey.trim();

        debugInfo.step = 'processed_key';
        debugInfo.processedKeyLength = processedKey.length;
        debugInfo.hasActualNewlines = processedKey.includes('\n');
        debugInfo.processedFirstChars = processedKey.substring(0, 60);
        debugInfo.processedLastChars = processedKey.substring(processedKey.length - 60);

        debugInfo.step = 'creating_jwt_client';

        const jwtClient = new google.auth.JWT(
            calendarConfig.serviceAccountEmail,
            null,
            processedKey,
            ['https://www.googleapis.com/auth/calendar'],
            calendarConfig.impersonateUser || null
        );

        debugInfo.step = 'authorizing';
        if (calendarConfig.impersonateUser) {
            console.log('Using Google Workspace Domain-wide Delegation');
            console.log('Impersonating user:', calendarConfig.impersonateUser);
        }
        console.log('Attempting to authorize with Google...');
        await jwtClient.authorize();
        console.log('Authorization successful!');
        debugInfo.step = 'authorized';
        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        // Create test event 1 hour from now
        const testStart = new Date(Date.now() + 60 * 60 * 1000);
        const testEnd = new Date(Date.now() + 90 * 60 * 1000);

        const testEvent = {
            summary: 'Test Event from RehabPlus',
            description: 'This is a test event to verify Google Calendar integration is working correctly.',
            start: {
                dateTime: testStart.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            end: {
                dateTime: testEnd.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
        };

        const response = await calendar.events.insert({
            calendarId: calendarConfig.calendarId,
            resource: testEvent,
        });

        // Delete the test event immediately
        await calendar.events.delete({
            calendarId: calendarConfig.calendarId,
            eventId: response.data.id,
        });

        res.json({
            success: true,
            message: 'Google Calendar test successful! Connection verified.',
            testEventId: response.data.id
        });

    } catch (error) {
        console.error('Test Google Calendar error:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        if (error.response) {
            console.error('Error response:', error.response.data);
        }

        let errorMessage = 'Failed to connect to Google Calendar';

        if (error.code === 401 || error.code === 403) {
            errorMessage = 'Authentication failed. Please check your Service Account credentials.';
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({
            error: errorMessage,
            errorDetails: {
                name: error.name,
                message: error.message,
                code: error.code
            },
            debug: debugInfo
        });
    }
});

// ========================================
// BOOKING SETTINGS ROUTES (ADMIN ONLY)
// ========================================

// Get all service packages
router.get('/booking/packages', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [packages] = await db.execute(`
            SELECT * FROM public_service_packages
            ORDER BY display_order ASC, id DESC
        `);
        res.json(packages);
    } catch (error) {
        console.error('Get packages error:', error);
        res.status(500).json({ error: 'Failed to load packages' });
    }
});

// Get single package
router.get('/booking/packages/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [packages] = await db.execute(`
            SELECT * FROM public_service_packages WHERE id = ?
        `, [req.params.id]);

        if (packages.length === 0) {
            return res.status(404).json({ error: 'Package not found' });
        }

        res.json(packages[0]);
    } catch (error) {
        console.error('Get package error:', error);
        res.status(500).json({ error: 'Failed to load package' });
    }
});

// Create package
router.post('/booking/packages', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.session.userId;
        const {
            package_name, package_code, price, duration_minutes,
            description, benefits, pain_zones, display_order,
            active, is_featured, is_best_value
        } = req.body;

        const [result] = await db.execute(`
            INSERT INTO public_service_packages (
                package_name, package_code, price, duration_minutes,
                description, benefits, pain_zones, display_order,
                active, is_featured, is_best_value, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            package_name, package_code, price, duration_minutes,
            description, benefits, pain_zones, display_order,
            active, is_featured, is_best_value, userId
        ]);

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Create package error:', error);
        res.status(500).json({ error: 'Failed to create package', message: error.message });
    }
});

// Update package
router.put('/booking/packages/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            package_name, package_code, price, duration_minutes,
            description, benefits, pain_zones, display_order,
            active, is_featured, is_best_value
        } = req.body;

        await db.execute(`
            UPDATE public_service_packages SET
                package_name = ?, package_code = ?, price = ?, duration_minutes = ?,
                description = ?, benefits = ?, pain_zones = ?, display_order = ?,
                active = ?, is_featured = ?, is_best_value = ?
            WHERE id = ?
        `, [
            package_name, package_code, price, duration_minutes,
            description, benefits, pain_zones, display_order,
            active, is_featured, is_best_value, req.params.id
        ]);

        res.json({ success: true });
    } catch (error) {
        console.error('Update package error:', error);
        res.status(500).json({ error: 'Failed to update package' });
    }
});

// Delete package
router.delete('/booking/packages/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        await db.execute('DELETE FROM public_service_packages WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete package error:', error);
        res.status(500).json({ error: 'Failed to delete package' });
    }
});

// Get all promotions
router.get('/booking/promotions', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [promos] = await db.execute(`
            SELECT * FROM public_promotions ORDER BY created_at DESC
        `);
        res.json(promos);
    } catch (error) {
        console.error('Get promotions error:', error);
        res.status(500).json({ error: 'Failed to load promotions' });
    }
});

// Get single promotion
router.get('/booking/promotions/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [promos] = await db.execute(`
            SELECT * FROM public_promotions WHERE id = ?
        `, [req.params.id]);

        if (promos.length === 0) {
            return res.status(404).json({ error: 'Promotion not found' });
        }

        res.json(promos[0]);
    } catch (error) {
        console.error('Get promotion error:', error);
        res.status(500).json({ error: 'Failed to load promotion' });
    }
});

// Create promotion
router.post('/booking/promotions', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.session.userId;
        const {
            promo_code, description, discount_type, discount_value,
            valid_from, valid_until, usage_limit, active
        } = req.body;

        const [result] = await db.execute(`
            INSERT INTO public_promotions (
                promo_code, description, discount_type, discount_value,
                valid_from, valid_until, usage_limit, active, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            promo_code, description, discount_type, discount_value,
            valid_from, valid_until, usage_limit, active, userId
        ]);

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Create promotion error:', error);
        res.status(500).json({ error: 'Failed to create promotion', message: error.message });
    }
});

// Update promotion
router.put('/booking/promotions/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            promo_code, description, discount_type, discount_value,
            valid_from, valid_until, usage_limit, active
        } = req.body;

        await db.execute(`
            UPDATE public_promotions SET
                promo_code = ?, description = ?, discount_type = ?, discount_value = ?,
                valid_from = ?, valid_until = ?, usage_limit = ?, active = ?
            WHERE id = ?
        `, [
            promo_code, description, discount_type, discount_value,
            valid_from, valid_until, usage_limit, active, req.params.id
        ]);

        res.json({ success: true });
    } catch (error) {
        console.error('Update promotion error:', error);
        res.status(500).json({ error: 'Failed to update promotion' });
    }
});

// Delete promotion
router.delete('/booking/promotions/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        await db.execute('DELETE FROM public_promotions WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete promotion error:', error);
        res.status(500).json({ error: 'Failed to delete promotion' });
    }
});

// Get all testimonials
router.get('/booking/testimonials', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [testimonials] = await db.execute(`
            SELECT * FROM public_testimonials ORDER BY display_order ASC, created_at DESC
        `);
        res.json(testimonials);
    } catch (error) {
        console.error('Get testimonials error:', error);
        res.status(500).json({ error: 'Failed to load testimonials' });
    }
});

// Get single testimonial
router.get('/booking/testimonials/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [testimonials] = await db.execute(`
            SELECT * FROM public_testimonials WHERE id = ?
        `, [req.params.id]);

        if (testimonials.length === 0) {
            return res.status(404).json({ error: 'Testimonial not found' });
        }

        res.json(testimonials[0]);
    } catch (error) {
        console.error('Get testimonial error:', error);
        res.status(500).json({ error: 'Failed to load testimonial' });
    }
});

// Create testimonial
router.post('/booking/testimonials', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.session.userId;
        const {
            patient_name, rating, testimonial_text,
            display_order, display_on_public
        } = req.body;

        const [result] = await db.execute(`
            INSERT INTO public_testimonials (
                patient_name, rating, testimonial_text,
                display_order, display_on_public, created_by
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [patient_name, rating, testimonial_text, display_order, display_on_public, userId]);

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Create testimonial error:', error);
        res.status(500).json({ error: 'Failed to create testimonial', message: error.message });
    }
});

// Update testimonial
router.put('/booking/testimonials/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            patient_name, rating, testimonial_text,
            display_order, display_on_public
        } = req.body;

        await db.execute(`
            UPDATE public_testimonials SET
                patient_name = ?, rating = ?, testimonial_text = ?,
                display_order = ?, display_on_public = ?
            WHERE id = ?
        `, [patient_name, rating, testimonial_text, display_order, display_on_public, req.params.id]);

        res.json({ success: true });
    } catch (error) {
        console.error('Update testimonial error:', error);
        res.status(500).json({ error: 'Failed to update testimonial' });
    }
});

// Delete testimonial
router.delete('/booking/testimonials/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        await db.execute('DELETE FROM public_testimonials WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete testimonial error:', error);
        res.status(500).json({ error: 'Failed to delete testimonial' });
    }
});

// Get general booking settings
router.get('/booking/settings', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const clinicId = req.session.clinicId || 1;

        const [settings] = await db.execute(`
            SELECT * FROM public_booking_settings WHERE clinic_id = ?
        `, [clinicId]);

        res.json(settings);
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

// Save general booking settings
router.post('/booking/settings', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.session.userId;
        const clinicId = req.session.clinicId || 1;
        const { settings } = req.body;

        // Update or insert each setting
        for (const setting of settings) {
            await db.execute(`
                INSERT INTO public_booking_settings
                (clinic_id, setting_key, setting_value, setting_type, updated_by)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                setting_value = VALUES(setting_value),
                updated_by = VALUES(updated_by),
                updated_at = CURRENT_TIMESTAMP
            `, [clinicId, setting.setting_key, setting.setting_value, setting.setting_type, userId]);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Save settings error:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// ========================================
// THEME SETTINGS ROUTES (ADMIN ONLY)
// ========================================

// Get theme settings
router.get('/theme-settings', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Get all theme settings
        const [settings] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE 'theme_%' OR setting_key IN ('app_name', 'app_logo_url')`
        );

        // Build response object with defaults
        const themeSettings = {
            // Basic branding
            appName: 'PhysioConext',
            logoUrl: null,
            faviconUrl: null,
            browserTitle: 'PhysioConext',

            // Header & Sidebar gradients
            headerColorStart: '#0284c7',
            headerColorEnd: '#14b8a6',
            sidebarColorStart: '#667eea',
            sidebarColorEnd: '#764ba2',

            // Primary & Accent colors
            primaryColor: '#0284c7',
            accentColor: '#14b8a6',
            successColor: '#10b981',
            warningColor: '#f59e0b',
            errorColor: '#ef4444',

            // Card & Panel colors
            cardBgColor: '#ffffff',
            cardBorderColor: '#e5e7eb',
            panelHeaderBg: '#f9fafb',

            // Login page
            loginBgImage: null,
            loginLogo: null,
            loginWelcomeText: 'Welcome to PhysioConext',

            // Typography
            fontHeadings: 'Plus Jakarta Sans',
            fontBody: 'Plus Jakarta Sans',
            fontSizeScale: 'medium',

            // Layout
            borderRadius: '8',
            sidebarWidth: '240',
            sidebarCollapsed: false,
            sidebarPosition: 'left',

            // Dark mode
            darkModeEnabled: false
        };

        // Apply database values
        settings.forEach(row => {
            const key = row.setting_key;
            const value = row.setting_value;

            // Map database keys to camelCase response keys
            const keyMap = {
                'app_name': 'appName',
                'app_logo_url': 'logoUrl',
                'theme_favicon_url': 'faviconUrl',
                'theme_browser_title': 'browserTitle',
                'header_color_start': 'headerColorStart',
                'header_color_end': 'headerColorEnd',
                'sidebar_color_start': 'sidebarColorStart',
                'sidebar_color_end': 'sidebarColorEnd',
                'theme_primary_color': 'primaryColor',
                'theme_accent_color': 'accentColor',
                'theme_success_color': 'successColor',
                'theme_warning_color': 'warningColor',
                'theme_error_color': 'errorColor',
                'theme_card_bg_color': 'cardBgColor',
                'theme_card_border_color': 'cardBorderColor',
                'theme_panel_header_bg': 'panelHeaderBg',
                'theme_login_bg_image': 'loginBgImage',
                'theme_login_logo': 'loginLogo',
                'theme_login_welcome_text': 'loginWelcomeText',
                'theme_font_headings': 'fontHeadings',
                'theme_font_body': 'fontBody',
                'theme_font_size_scale': 'fontSizeScale',
                'theme_border_radius': 'borderRadius',
                'theme_sidebar_width': 'sidebarWidth',
                'theme_sidebar_collapsed': 'sidebarCollapsed',
                'theme_sidebar_position': 'sidebarPosition',
                'theme_dark_mode_enabled': 'darkModeEnabled'
            };

            const responseKey = keyMap[key];
            if (responseKey) {
                // Convert string booleans to actual booleans
                if (responseKey === 'sidebarCollapsed' || responseKey === 'darkModeEnabled') {
                    themeSettings[responseKey] = value === 'true' || value === '1';
                } else {
                    themeSettings[responseKey] = value;
                }
            }
        });

        res.json(themeSettings);
    } catch (error) {
        console.error('Error fetching theme settings:', error);
        res.status(500).json({ error: 'Failed to fetch theme settings' });
    }
});

// Save theme settings
router.post('/theme-settings', authenticateToken, uploadLogo.single('logo'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;

        console.log('[THEME] Saving theme settings:', Object.keys(req.body));

        // Helper function to save a setting
        const saveSetting = async (key, value) => {
            if (value !== undefined && value !== null && value !== '') {
                await db.execute(
                    `INSERT INTO system_settings (setting_key, setting_value, updated_by)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE setting_value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP`,
                    [key, value, userId, value, userId]
                );
            }
        };

        // Validate required fields
        if (!req.body.appName || req.body.appName.trim() === '') {
            return res.status(400).json({ error: 'Application name is required' });
        }

        // Save all settings
        await saveSetting('app_name', req.body.appName?.trim());
        await saveSetting('theme_browser_title', req.body.browserTitle?.trim());

        // Header & Sidebar
        await saveSetting('header_color_start', req.body.headerColorStart);
        await saveSetting('header_color_end', req.body.headerColorEnd);
        await saveSetting('sidebar_color_start', req.body.sidebarColorStart);
        await saveSetting('sidebar_color_end', req.body.sidebarColorEnd);

        // Primary & Accent colors
        await saveSetting('theme_primary_color', req.body.primaryColor);
        await saveSetting('theme_accent_color', req.body.accentColor);
        await saveSetting('theme_success_color', req.body.successColor);
        await saveSetting('theme_warning_color', req.body.warningColor);
        await saveSetting('theme_error_color', req.body.errorColor);

        // Card & Panel colors
        await saveSetting('theme_card_bg_color', req.body.cardBgColor);
        await saveSetting('theme_card_border_color', req.body.cardBorderColor);
        await saveSetting('theme_panel_header_bg', req.body.panelHeaderBg);

        // Login page
        await saveSetting('theme_login_bg_image', req.body.loginBgImage);
        await saveSetting('theme_login_logo', req.body.loginLogo);
        await saveSetting('theme_login_welcome_text', req.body.loginWelcomeText);

        // Typography
        await saveSetting('theme_font_headings', req.body.fontHeadings);
        await saveSetting('theme_font_body', req.body.fontBody);
        await saveSetting('theme_font_size_scale', req.body.fontSizeScale);

        // Layout
        await saveSetting('theme_border_radius', req.body.borderRadius);
        await saveSetting('theme_sidebar_width', req.body.sidebarWidth);
        await saveSetting('theme_sidebar_collapsed', req.body.sidebarCollapsed);
        await saveSetting('theme_sidebar_position', req.body.sidebarPosition);

        // Dark mode
        await saveSetting('theme_dark_mode_enabled', req.body.darkModeEnabled);

        // Save logo URL if file was uploaded
        if (req.file) {
            const logoUrl = `/public/images/logos/${req.file.filename}`;
            await saveSetting('app_logo_url', logoUrl);
        }

        // Audit log
        await auditLog(db, userId, 'update', 'theme_settings', 0, null, {
            appName: req.body.appName,
            logoUpdated: !!req.file,
            fieldsUpdated: Object.keys(req.body).length
        }, req);

        console.log('[THEME] Theme settings saved successfully');

        res.json({
            success: true,
            message: 'Theme settings saved successfully',
            appName: req.body.appName.trim()
        });
    } catch (error) {
        console.error('[THEME] Error saving theme settings:', error);
        console.error('[THEME] Error details:', error.message);
        res.status(500).json({ error: 'Failed to save theme settings', details: error.message });
    }
});

// ========================================
// AI SETTINGS ROUTES (ADMIN ONLY)
// ========================================

// Get AI settings
router.get('/ai-settings', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [settings] = await db.execute(`
            SELECT * FROM notification_settings WHERE setting_type = 'gemini_ai' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'AI settings not configured yet' });
        }

        const aiConfig = JSON.parse(settings[0].setting_value);
        res.json(aiConfig);
    } catch (error) {
        console.error('Get AI settings error:', error);
        res.status(500).json({ error: 'Failed to load AI settings' });
    }
});

// Save AI settings
router.post('/ai-settings', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { enabled, model, apiKey, features } = req.body;

        // Validate required fields
        if (apiKey === undefined || model === undefined) {
            return res.status(400).json({ error: 'API key and model are required' });
        }

        const settingValue = JSON.stringify({
            enabled: enabled || false,
            model: model || 'gemini-2.5-flash',
            apiKey: apiKey,
            features: features || { symptomAnalysis: true, notePolish: true }
        });

        // Check if settings exist
        const [existing] = await db.execute(`
            SELECT id FROM notification_settings WHERE setting_type = 'gemini_ai' LIMIT 1
        `);

        if (existing.length > 0) {
            // Update existing
            await db.execute(`
                UPDATE notification_settings
                SET setting_value = ?, updated_at = NOW()
                WHERE setting_type = 'gemini_ai'
            `, [settingValue]);
        } else {
            // Insert new
            await db.execute(`
                INSERT INTO notification_settings
                (setting_type, setting_value, created_at, updated_at)
                VALUES ('gemini_ai', ?, NOW(), NOW())
            `, [settingValue]);
        }

        // Audit log
        await auditLog(db, userId, 'update', 'ai_settings', 0, null, { enabled, model: model }, req);

        res.json({ success: true, message: 'AI settings saved successfully' });
    } catch (error) {
        console.error('Save AI settings error:', error);
        res.status(500).json({ error: 'Failed to save AI settings' });
    }
});

// Test AI connection
router.post('/ai-settings/test', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Get current AI settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'gemini_ai' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(400).json({ error: 'AI settings not configured. Please save settings first.' });
        }

        const aiConfig = JSON.parse(settings[0].setting_value);

        if (!aiConfig.enabled) {
            return res.status(400).json({ error: 'AI features are currently disabled' });
        }

        if (!aiConfig.apiKey) {
            return res.status(400).json({ error: 'API key not configured' });
        }

        // Test Gemini API
        const testPrompt = 'Respond with exactly "AI connection successful" if you can read this message.';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.apiKey}`;

        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: testPrompt }]
            }]
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (aiResponse) {
            res.json({
                success: true,
                response: aiResponse.substring(0, 100), // Limit response length
                message: 'AI connection test successful'
            });
        } else {
            throw new Error('No response from AI');
        }
    } catch (error) {
        console.error('Test AI connection error:', error);

        let errorMessage = 'Failed to connect to AI service';
        if (error.response?.data?.error?.message) {
            errorMessage = error.response.data.error.message;
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({ error: errorMessage });
    }
});

// ========================================
// BILLS MANAGEMENT
// ========================================

// Get all bills
router.get('/bills', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { startDate, endDate, status, patientId, clinicId } = req.query;

        let query = `
            SELECT
                b.*,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
                p.phone as patient_phone,
                p.email as patient_email,
                p.hn as patient_hn,
                c.name as clinic_name,
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as created_by_name
            FROM bills b
            LEFT JOIN patients p ON b.patient_id = p.id
            LEFT JOIN clinics c ON b.clinic_id = c.id
            LEFT JOIN users u ON b.created_by = u.id
            WHERE 1=1
        `;
        const params = [];

        if (startDate && endDate) {
            query += ` AND b.bill_date BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }

        if (status) {
            query += ` AND b.payment_status = ?`;
            params.push(status);
        }

        if (patientId) {
            query += ` AND b.patient_id = ?`;
            params.push(patientId);
        }

        if (clinicId) {
            query += ` AND b.clinic_id = ?`;
            params.push(clinicId);
        }

        query += ` ORDER BY b.bill_date DESC, b.created_at DESC`;

        const [bills] = await db.execute(query, params);
        res.json(bills);
    } catch (error) {
        console.error('Get bills error:', error);
        res.status(500).json({ error: 'Failed to retrieve bills' });
    }
});

// Get billing services
router.get('/bills/services', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        console.log('[SERVICES] Fetching services from database');

        const [services] = await db.execute('SELECT * FROM services ORDER BY service_name');

        console.log('[SERVICES] Found', services.length, 'services');
        if (services.length > 0) {
            console.log('[SERVICES] Sample:', JSON.stringify(services[0]).substring(0, 200));
        }

        res.json(services);
    } catch (error) {
        console.error('[SERVICES] Error:', error);
        console.error('[SERVICES] Error details:', error.message);
        return res.json([]); // Return empty array instead of error
    }
});

// Get single bill
router.get('/bills/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [bills] = await db.execute(`
            SELECT
                b.*,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
                p.phone as patient_phone,
                p.email as patient_email,
                p.hn as patient_hn,
                c.name as clinic_name
            FROM bills b
            LEFT JOIN patients p ON b.patient_id = p.id
            LEFT JOIN clinics c ON b.clinic_id = c.id
            WHERE b.id = ?
        `, [id]);

        if (bills.length === 0) {
            return res.status(404).json({ error: 'Bill not found' });
        }

        // Get bill items
        const [items] = await db.execute(`
            SELECT bi.*, s.service_name, s.service_code
            FROM bill_items bi
            LEFT JOIN services s ON bi.service_id = s.id
            WHERE bi.bill_id = ?
        `, [id]);

        res.json({
            ...bills[0],
            items: items
        });
    } catch (error) {
        console.error('Get bill error:', error);
        res.status(500).json({ error: 'Failed to retrieve bill' });
    }
});

// Create new bill
router.post('/bills', authenticateToken, async (req, res) => {
    const connection = await req.app.locals.db.getConnection();
    try {
        await connection.beginTransaction();

        console.log('[BILLS] Creating bill with data:', JSON.stringify(req.body).substring(0, 500));

        const {
            patient_id,
            clinic_id,
            pn_case_id,
            appointment_id,
            bill_date,
            items,
            discount,
            tax,
            walk_in_name,
            walk_in_phone,
            payment_method,
            bill_notes,
            payment_notes
        } = req.body;

        // Generate bill_code: BILL-{year}-{sequence}
        const currentYear = new Date().getFullYear();
        const [lastBill] = await connection.execute(`
            SELECT bill_code FROM bills
            WHERE bill_code LIKE ?
            ORDER BY bill_code DESC
            LIMIT 1
        `, [`BILL-${currentYear}-%`]);

        let sequence = 1;
        if (lastBill.length > 0) {
            const lastCode = lastBill[0].bill_code;
            const lastSequence = parseInt(lastCode.split('-')[2]);
            sequence = lastSequence + 1;
        }
        const bill_code = `BILL-${currentYear}-${String(sequence).padStart(3, '0')}`;
        console.log('[BILLS] Generated bill_code:', bill_code);

        // Calculate totals from items
        let subtotal = 0;
        if (items && items.length > 0) {
            subtotal = items.reduce((sum, item) => sum + (parseFloat(item.total_price) || 0), 0);
        }
        const total_amount = subtotal - (parseFloat(discount) || 0) + (parseFloat(tax) || 0);

        // Insert bill
        console.log('[BILLS] Inserting bill into database...');
        const [result] = await connection.execute(`
            INSERT INTO bills (
                bill_code, patient_id, walk_in_name, walk_in_phone, clinic_id, bill_date,
                subtotal, discount, tax, total_amount,
                payment_status, payment_method, payment_notes, bill_notes,
                appointment_id, pn_case_id, course_id, is_course_cutting, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            bill_code,
            patient_id || null,
            walk_in_name || null,
            walk_in_phone || null,
            clinic_id || null,
            bill_date,
            subtotal,
            discount || 0,
            tax || 0,
            total_amount,
            'UNPAID',
            payment_method || null,
            payment_notes || null,
            bill_notes || null,
            appointment_id || null,
            pn_case_id || null,
            null, // course_id - not used in standard bill creation
            0,    // is_course_cutting - false for standard bills
            req.user.id
        ]);

        const billId = result.insertId;
        console.log('[BILLS] Bill created with ID:', billId);

        // Insert bill items
        if (items && items.length > 0) {
            console.log('[BILLS] Inserting', items.length, 'bill items...');
            for (const item of items) {
                await connection.execute(`
                    INSERT INTO bill_items (
                        bill_id, service_id, service_name, quantity, unit_price, total_price, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    billId,
                    item.service_id || null,
                    item.service_name || null,
                    item.quantity,
                    item.unit_price,
                    item.total_price,
                    item.notes || null
                ]);
            }
            console.log('[BILLS] All bill items inserted successfully');
        }

        await connection.commit();
        console.log('[BILLS] Transaction committed successfully');

        res.status(201).json({
            success: true,
            message: 'Bill created successfully',
            id: billId,
            bill_code: bill_code
        });
    } catch (error) {
        await connection.rollback();
        console.error('[BILLS] Create bill error:', error);
        console.error('[BILLS] Error message:', error.message);
        console.error('[BILLS] Error code:', error.code);
        console.error('[BILLS] SQL:', error.sql);
        res.status(500).json({
            error: 'Failed to create bill',
            details: error.message
        });
    } finally {
        connection.release();
    }
});

// Update bill
router.put('/bills/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    const connection = await req.app.locals.db.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const {
            patient_id,
            walk_in_name,
            walk_in_phone,
            clinic_id,
            appointment_id,
            pn_case_id,
            course_id,
            is_course_cutting,
            bill_date,
            due_date,
            items,
            subtotal,
            discount,
            tax,
            total_amount,
            payment_status,
            payment_method,
            payment_date,
            payment_notes,
            bill_notes
        } = req.body;

        // Update bill
        await connection.execute(`
            UPDATE bills SET
                patient_id = ?,
                walk_in_name = ?,
                walk_in_phone = ?,
                clinic_id = ?,
                appointment_id = ?,
                pn_case_id = ?,
                course_id = ?,
                is_course_cutting = ?,
                bill_date = ?,
                due_date = ?,
                subtotal = ?,
                discount = ?,
                tax = ?,
                total_amount = ?,
                payment_status = ?,
                payment_method = ?,
                payment_date = ?,
                payment_notes = ?,
                bill_notes = ?
            WHERE id = ?
        `, [
            patient_id || null,
            walk_in_name || null,
            walk_in_phone || null,
            clinic_id || null,
            appointment_id || null,
            pn_case_id || null,
            course_id || null,
            is_course_cutting ? 1 : 0,
            bill_date || null,
            due_date || null,
            subtotal || 0,
            discount || 0,
            tax || 0,
            total_amount || 0,
            payment_status || 'UNPAID',
            payment_method || null,
            payment_date || null,
            payment_notes || null,
            bill_notes || null,
            id
        ]);

        // Delete existing items and insert new ones
        if (items !== undefined) {
            await connection.execute('DELETE FROM bill_items WHERE bill_id = ?', [id]);

            if (items.length > 0) {
                for (const item of items) {
                    await connection.execute(`
                        INSERT INTO bill_items (
                            bill_id, service_id, service_name, quantity, unit_price, total_price, notes
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [
                        id,
                        item.service_id || null,
                        item.service_name || null,
                        item.quantity || 0,
                        item.unit_price || 0,
                        item.total_price || 0,
                        item.notes || null
                    ]);
                }
            }
        }

        await connection.commit();

        res.json({ success: true, message: 'Bill updated successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Update bill error:', error);
        res.status(500).json({ error: 'Failed to update bill' });
    } finally {
        connection.release();
    }
});

// Update bill payment status
// Update bill payment status (accepts both PUT and PATCH)
router.patch('/bills/:id/payment-status', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { payment_status, payment_method, payment_date } = req.body;

        console.log('[BILLS] Updating payment status for bill ID:', id);
        console.log('[BILLS] New status:', payment_status, 'Method:', payment_method, 'Date:', payment_date);

        // Set payment_date to now if marking as PAID and no date provided
        const finalPaymentDate = payment_status === 'PAID' && !payment_date
            ? new Date().toISOString().split('T')[0]
            : payment_date;

        await db.execute(`
            UPDATE bills SET
                payment_status = ?,
                payment_method = ?,
                payment_date = ?
            WHERE id = ?
        `, [payment_status, payment_method || null, finalPaymentDate || null, id]);

        console.log('[BILLS] Payment status updated successfully');
        res.json({ success: true, message: 'Payment status updated successfully' });
    } catch (error) {
        console.error('[BILLS] Update payment status error:', error);
        console.error('[BILLS] Error details:', error.message);
        res.status(500).json({ error: 'Failed to update payment status', details: error.message });
    }
});

// Also support PUT for backwards compatibility
router.put('/bills/:id/payment-status', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { payment_status, payment_method, payment_date } = req.body;

        console.log('[BILLS] Updating payment status for bill ID:', id);
        console.log('[BILLS] New status:', payment_status, 'Method:', payment_method, 'Date:', payment_date);

        // Set payment_date to now if marking as PAID and no date provided
        const finalPaymentDate = payment_status === 'PAID' && !payment_date
            ? new Date().toISOString().split('T')[0]
            : payment_date;

        await db.execute(`
            UPDATE bills SET
                payment_status = ?,
                payment_method = ?,
                payment_date = ?
            WHERE id = ?
        `, [payment_status, payment_method || null, finalPaymentDate || null, id]);

        console.log('[BILLS] Payment status updated successfully');
        res.json({ success: true, message: 'Payment status updated successfully' });
    } catch (error) {
        console.error('[BILLS] Update payment status error:', error);
        console.error('[BILLS] Error details:', error.message);
        res.status(500).json({ error: 'Failed to update payment status', details: error.message });
    }
});

// Delete bill
router.delete('/bills/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    const connection = await req.app.locals.db.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;

        // Delete bill items first
        await connection.execute('DELETE FROM bill_items WHERE bill_id = ?', [id]);

        // Delete bill
        await connection.execute('DELETE FROM bills WHERE id = ?', [id]);

        await connection.commit();

        res.json({ success: true, message: 'Bill deleted successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Delete bill error:', error);
        res.status(500).json({ error: 'Failed to delete bill' });
    } finally {
        connection.release();
    }
});

// ========================================
// INVOICES MANAGEMENT
// ========================================

// Get all invoices
router.get('/invoices', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Check if invoices table exists
        const [tables] = await db.execute(`
            SELECT TABLE_NAME
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
        `);

        if (tables.length === 0) {
            console.log('Invoices table does not exist, returning empty array');
            return res.json([]);
        }

        const { startDate, endDate, status, customer, clinicId } = req.query;

        let query = `
            SELECT
                i.*,
                c.name as clinic_name,
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as created_by_name
            FROM invoices i
            LEFT JOIN clinics c ON i.clinic_id = c.id
            LEFT JOIN users u ON i.created_by = u.id
            WHERE 1=1
        `;
        const params = [];

        if (startDate && endDate) {
            query += ` AND i.invoice_date BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }

        if (status) {
            query += ` AND i.payment_status = ?`;
            params.push(status);
        }

        if (customer) {
            query += ` AND (i.customer_name LIKE ? OR i.customer_email LIKE ? OR i.customer_phone LIKE ?)`;
            const searchTerm = `%${customer}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        if (clinicId) {
            query += ` AND i.clinic_id = ?`;
            params.push(clinicId);
        }

        query += ` ORDER BY i.invoice_date DESC, i.created_at DESC`;

        const [invoices] = await db.execute(query, params);
        res.json(invoices);
    } catch (error) {
        console.error('Get invoices error:', error);
        console.error('Error details:', error.message);
        return res.json([]); // Return empty array instead of error
    }
});

// Get invoices summary
router.get('/invoices/summary', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Check if invoices table exists
        const [tables] = await db.execute(`
            SELECT TABLE_NAME
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
        `);

        if (tables.length === 0) {
            console.log('Invoices table does not exist, returning zero summary');
            return res.json({
                total_count: 0,
                paid_count: 0,
                pending_count: 0,
                overdue_count: 0,
                total_amount: 0,
                paid_amount: 0,
                pending_amount: 0,
                overdue_amount: 0
            });
        }

        const [summary] = await db.execute(`
            SELECT
                COUNT(*) as total_count,
                COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END), 0) as paid_count,
                COALESCE(SUM(CASE WHEN payment_status = 'PENDING' THEN 1 ELSE 0 END), 0) as pending_count,
                COALESCE(SUM(CASE WHEN payment_status = 'OVERDUE' THEN 1 ELSE 0 END), 0) as overdue_count,
                COALESCE(SUM(total_amount), 0) as total_amount,
                COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN total_amount ELSE 0 END), 0) as paid_amount,
                COALESCE(SUM(CASE WHEN payment_status = 'PENDING' THEN total_amount ELSE 0 END), 0) as pending_amount,
                COALESCE(SUM(CASE WHEN payment_status = 'OVERDUE' THEN total_amount ELSE 0 END), 0) as overdue_amount
            FROM invoices
        `);

        res.json(summary[0]);
    } catch (error) {
        console.error('Get invoices summary error:', error);
        console.error('Error details:', error.message);
        return res.json({
            total_count: 0,
            paid_count: 0,
            pending_count: 0,
            overdue_count: 0,
            total_amount: 0,
            paid_amount: 0,
            pending_amount: 0,
            overdue_amount: 0
        }); // Return zero summary instead of error
    }
});

// Get single invoice
router.get('/invoices/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [invoices] = await db.execute(`
            SELECT
                i.*,
                c.name as clinic_name
            FROM invoices i
            LEFT JOIN clinics c ON i.clinic_id = c.id
            WHERE i.id = ?
        `, [id]);

        if (invoices.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Get invoice items
        const [items] = await db.execute(`
            SELECT * FROM invoice_items WHERE invoice_id = ?
        `, [id]);

        res.json({
            ...invoices[0],
            items: items
        });
    } catch (error) {
        console.error('Get invoice error:', error);
        res.status(500).json({ error: 'Failed to retrieve invoice' });
    }
});

// Create new invoice
router.post('/invoices', authenticateToken, async (req, res) => {
    const connection = await req.app.locals.db.getConnection();
    try {
        await connection.beginTransaction();

        const {
            invoice_number,
            customer_name,
            customer_email,
            customer_phone,
            customer_address,
            clinic_id,
            invoice_date,
            due_date,
            items,
            subtotal,
            discount_amount,
            tax_amount,
            total_amount,
            payment_status,
            payment_method,
            notes
        } = req.body;

        // Insert invoice
        const [result] = await connection.execute(`
            INSERT INTO invoices (
                invoice_number, customer_name, customer_email, customer_phone, customer_address,
                clinic_id, invoice_date, due_date,
                subtotal, discount_amount, tax_amount, total_amount,
                payment_status, payment_method, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            invoice_number, customer_name, customer_email, customer_phone, customer_address,
            clinic_id, invoice_date, due_date,
            subtotal, discount_amount || 0, tax_amount || 0, total_amount,
            payment_status || 'PENDING', payment_method, notes, req.user.id
        ]);

        const invoiceId = result.insertId;

        // Insert invoice items
        if (items && items.length > 0) {
            for (const item of items) {
                await connection.execute(`
                    INSERT INTO invoice_items (
                        invoice_id, service_id, item_name, description, quantity, unit_price, total_price
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    invoiceId,
                    item.service_id || null,
                    item.item_name || item.service_name || '',
                    item.description || '',
                    item.quantity,
                    item.unit_price,
                    item.total_price
                ]);
            }
        }

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Invoice created successfully',
            id: invoiceId
        });
    } catch (error) {
        await connection.rollback();
        console.error('Create invoice error:', error);
        res.status(500).json({ error: 'Failed to create invoice' });
    } finally {
        connection.release();
    }
});

// Update invoice
router.put('/invoices/:id', authenticateToken, async (req, res) => {
    const connection = await req.app.locals.db.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const {
            invoice_number,
            customer_name,
            customer_email,
            customer_phone,
            customer_address,
            clinic_id,
            invoice_date,
            due_date,
            items,
            subtotal,
            discount_amount,
            tax_amount,
            total_amount,
            payment_status,
            payment_method,
            payment_date,
            notes
        } = req.body;

        // Update invoice
        await connection.execute(`
            UPDATE invoices SET
                invoice_number = ?,
                customer_name = ?,
                customer_email = ?,
                customer_phone = ?,
                customer_address = ?,
                clinic_id = ?,
                invoice_date = ?,
                due_date = ?,
                subtotal = ?,
                discount_amount = ?,
                tax_amount = ?,
                total_amount = ?,
                payment_status = ?,
                payment_method = ?,
                payment_date = ?,
                notes = ?
            WHERE id = ?
        `, [
            invoice_number, customer_name, customer_email, customer_phone, customer_address,
            clinic_id, invoice_date, due_date,
            subtotal, discount_amount || 0, tax_amount || 0, total_amount,
            payment_status, payment_method, payment_date, notes, id
        ]);

        // Delete existing items and insert new ones
        if (items !== undefined) {
            await connection.execute('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);

            if (items.length > 0) {
                for (const item of items) {
                    await connection.execute(`
                        INSERT INTO invoice_items (
                            invoice_id, service_id, item_name, description, quantity, unit_price, total_price
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [
                        id,
                        item.service_id || null,
                        item.item_name || item.service_name || '',
                        item.description || '',
                        item.quantity,
                        item.unit_price,
                        item.total_price
                    ]);
                }
            }
        }

        await connection.commit();

        res.json({ success: true, message: 'Invoice updated successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Update invoice error:', error);
        res.status(500).json({ error: 'Failed to update invoice' });
    } finally {
        connection.release();
    }
});

// Update invoice payment status
router.put('/invoices/:id/payment-status', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { payment_status, payment_method, payment_date } = req.body;

        await db.execute(`
            UPDATE invoices SET
                payment_status = ?,
                payment_method = ?,
                payment_date = ?
            WHERE id = ?
        `, [payment_status, payment_method, payment_date, id]);

        res.json({ success: true, message: 'Payment status updated successfully' });
    } catch (error) {
        console.error('Update payment status error:', error);
        res.status(500).json({ error: 'Failed to update payment status' });
    }
});

// Delete invoice
router.delete('/invoices/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    const connection = await req.app.locals.db.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;

        // Delete invoice items first
        await connection.execute('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);

        // Delete invoice
        await connection.execute('DELETE FROM invoices WHERE id = ?', [id]);

        await connection.commit();

        res.json({ success: true, message: 'Invoice deleted successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Delete invoice error:', error);
        res.status(500).json({ error: 'Failed to delete invoice' });
    } finally {
        connection.release();
    }
});

// ========================================
// Statistics Endpoints
// ========================================

// Get bills summary statistics
router.get('/statistics/bills/summary', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { date_from, date_to } = req.query;

        let dateFilter = '';
        const params = [];

        if (date_from && date_to) {
            dateFilter = 'WHERE bill_date BETWEEN ? AND ?';
            params.push(date_from, date_to);
        }

        const [summary] = await db.execute(`
            SELECT
                COUNT(*) as total_bills,
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN total_amount ELSE 0 END), 0) as collected_revenue,
                COALESCE(SUM(CASE WHEN payment_status != 'PAID' THEN total_amount ELSE 0 END), 0) as outstanding_revenue
            FROM bills
            ${dateFilter}
        `, params);

        res.json(summary[0]);
    } catch (error) {
        console.error('[STATISTICS] Bills summary error:', error);
        res.status(500).json({ error: 'Failed to load bills summary' });
    }
});

// Get bills statistics by clinic
router.get('/statistics/bills/by-clinic', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [clinicStats] = await db.execute(`
            SELECT
                c.name as clinic_name,
                COUNT(b.id) as total_bills,
                COALESCE(SUM(b.total_amount), 0) as total_revenue,
                COALESCE(SUM(CASE WHEN b.payment_status = 'PAID' THEN b.total_amount ELSE 0 END), 0) as collected_revenue
            FROM clinics c
            LEFT JOIN bills b ON c.id = b.clinic_id
            GROUP BY c.id, c.name
            ORDER BY total_revenue DESC
        `);

        res.json(clinicStats);
    } catch (error) {
        console.error('[STATISTICS] Bills by clinic error:', error);
        res.status(500).json({ error: 'Failed to load clinic statistics' });
    }
});

// Get detailed bills for statistics table
router.get('/statistics/bills/detailed', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { date_from, date_to, limit = 50 } = req.query;

        let dateFilter = '';
        const params = [];

        if (date_from && date_to) {
            dateFilter = 'WHERE b.bill_date BETWEEN ? AND ?';
            params.push(date_from, date_to);
        }

        params.push(parseInt(limit));

        const [bills] = await db.execute(`
            SELECT
                b.id,
                b.bill_code,
                b.bill_date,
                b.total_amount,
                b.payment_status,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
                p.hn,
                c.name as clinic_name,
                GROUP_CONCAT(DISTINCT s.service_name SEPARATOR ', ') as services
            FROM bills b
            LEFT JOIN patients p ON b.patient_id = p.id
            LEFT JOIN clinics c ON b.clinic_id = c.id
            LEFT JOIN bill_items bi ON b.id = bi.bill_id
            LEFT JOIN services s ON bi.service_id = s.id
            ${dateFilter}
            GROUP BY b.id
            ORDER BY b.bill_date DESC
            LIMIT ?
        `, params);

        res.json(bills);
    } catch (error) {
        console.error('[STATISTICS] Detailed bills error:', error);
        res.status(500).json({ error: 'Failed to load detailed bills' });
    }
});

// Get service ranking by usage and revenue
router.get('/statistics/services/ranking', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { date_from, date_to, limit = 10 } = req.query;

        let dateFilter = '';
        const params = [];

        if (date_from && date_to) {
            dateFilter = 'AND b.bill_date BETWEEN ? AND ?';
            params.push(date_from, date_to);
        }

        params.push(parseInt(limit));

        const [ranking] = await db.execute(`
            SELECT
                s.id,
                s.service_name,
                COUNT(DISTINCT bi.bill_id) as usage_count,
                SUM(bi.quantity) as total_quantity,
                SUM(bi.total_price) as total_revenue
            FROM services s
            INNER JOIN bill_items bi ON s.id = bi.service_id
            INNER JOIN bills b ON bi.bill_id = b.id
            WHERE 1=1 ${dateFilter}
            GROUP BY s.id, s.service_name
            ORDER BY total_revenue DESC
            LIMIT ?
        `, params);

        res.json(ranking);
    } catch (error) {
        console.error('[STATISTICS] Service ranking error:', error);
        res.status(500).json({ error: 'Failed to load service ranking' });
    }
});

module.exports = router;