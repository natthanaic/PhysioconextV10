// routes/specialized.js - Specialized Routes (Courses, Diagnostic, etc.)
const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');

// ========================================
// COURSES & COURSE TEMPLATES
// ========================================
router.get('/courses', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        console.log('[COURSES] Fetching courses from database');

        const [courses] = await db.execute('SELECT * FROM courses ORDER BY created_at DESC');

        console.log('[COURSES] Found', courses.length, 'courses');
        if (courses.length > 0) {
            console.log('[COURSES] Sample:', JSON.stringify(courses[0]).substring(0, 300));
        }

        res.json(courses);
    } catch (error) {
        console.error('[COURSES] Error:', error);
        console.error('[COURSES] Error details:', error.message);
        res.status(500).json({ error: 'Failed to retrieve courses' });
    }
});

router.get('/course-templates', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        console.log('[COURSE-TEMPLATES] Fetching templates from database');

        const [templates] = await db.execute('SELECT * FROM course_templates ORDER BY template_name');

        console.log('[COURSE-TEMPLATES] Found', templates.length, 'templates');
        res.json(templates);
    } catch (error) {
        console.error('[COURSE-TEMPLATES] Error:', error);
        console.error('[COURSE-TEMPLATES] Error details:', error.message);
        res.status(500).json({ error: 'Failed to retrieve course templates' });
    }
});

// Get single course with details
router.get('/courses/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [courses] = await db.execute(`
            SELECT
                c.*,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
                p.hn as patient_hn,
                cl.name as clinic_name,
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as created_by_name
            FROM courses c
            LEFT JOIN patients p ON c.patient_id = p.id
            LEFT JOIN clinics cl ON c.clinic_id = cl.id
            LEFT JOIN users u ON c.created_by = u.id
            WHERE c.id = ?
        `, [id]);

        if (courses.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        // Get shared users
        const [sharedUsers] = await db.execute(`
            SELECT
                csu.*,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as shared_by_name
            FROM course_shared_users csu
            LEFT JOIN patients p ON csu.patient_id = p.id
            LEFT JOIN users u ON csu.shared_by = u.id
            WHERE csu.course_id = ?
            ORDER BY csu.created_at DESC
        `, [id]);

        // Get usage history
        const [usageHistory] = await db.execute(`
            SELECT
                cuh.*,
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as created_by_name
            FROM course_usage_history cuh
            LEFT JOIN users u ON cuh.created_by = u.id
            WHERE cuh.course_id = ?
            ORDER BY cuh.usage_date DESC, cuh.created_at DESC
        `, [id]);

        res.json({
            ...courses[0],
            shared_users: sharedUsers,
            usage_history: usageHistory
        });
    } catch (error) {
        console.error('Get course error:', error);
        console.error('Error details:', error.message);
        return res.status(500).json({ error: 'Failed to retrieve course' });
    }
});

// Get course shared users
router.get('/courses/:id/shared-users', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [sharedUsers] = await db.execute(`
            SELECT
                csu.*,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
                p.hn as patient_hn,
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as shared_by_name
            FROM course_shared_users csu
            LEFT JOIN patients p ON csu.patient_id = p.id
            LEFT JOIN users u ON csu.shared_by = u.id
            WHERE csu.course_id = ? AND csu.is_active = 1
            ORDER BY csu.created_at DESC
        `, [id]);

        res.json(sharedUsers);
    } catch (error) {
        console.error('Get course shared users error:', error);
        return res.json([]);
    }
});

// Get course usage history
router.get('/courses/:id/usage-history', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [usageHistory] = await db.execute(`
            SELECT
                cuh.*,
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as created_by_name
            FROM course_usage_history cuh
            LEFT JOIN users u ON cuh.created_by = u.id
            WHERE cuh.course_id = ?
            ORDER BY cuh.usage_date DESC, cuh.created_at DESC
        `, [id]);

        res.json(usageHistory);
    } catch (error) {
        console.error('Get course usage history error:', error);
        return res.json([]);
    }
});

// ========================================
// LOYALTY PROGRAM
// ========================================
router.get('/loyalty', authenticateToken, async (req, res) => {
    res.json({ message: 'Loyalty program endpoint' });
});

module.exports = router;
