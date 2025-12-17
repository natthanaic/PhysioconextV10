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
        const { patient_id } = req.query;

        // Check if courses table exists
        const [tables] = await db.execute(`
            SELECT TABLE_NAME
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courses'
        `);

        if (tables.length === 0) {
            console.log('Courses table does not exist, returning empty array');
            return res.json([]);
        }

        let query = `
            SELECT
                c.*,
                ct.name as template_name,
                ct.sessions as template_sessions,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name
            FROM courses c
            LEFT JOIN course_templates ct ON c.template_id = ct.id
            LEFT JOIN patients p ON c.patient_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (patient_id) {
            query += ` AND c.patient_id = ?`;
            params.push(patient_id);
        }

        query += ` ORDER BY c.created_at DESC`;

        const [courses] = await db.execute(query, params);
        res.json(courses);
    } catch (error) {
        console.error('Get courses error:', error);
        res.json([]); // Return empty array instead of error
    }
});

router.get('/course-templates', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { active } = req.query;

        // Check if course_templates table exists
        const [tables] = await db.execute(`
            SELECT TABLE_NAME
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'course_templates'
        `);

        if (tables.length === 0) {
            console.log('Course templates table does not exist, returning empty array');
            return res.json([]);
        }

        let query = `
            SELECT
                id,
                name,
                description,
                sessions,
                price,
                duration_weeks,
                active,
                created_at
            FROM course_templates
            WHERE 1=1
        `;
        const params = [];

        if (active !== undefined) {
            query += ` AND active = ?`;
            params.push(active === 'true' || active === '1' ? 1 : 0);
        }

        query += ` ORDER BY name`;

        const [templates] = await db.execute(query, params);
        res.json(templates);
    } catch (error) {
        console.error('Get course templates error:', error);
        res.json([]); // Return empty array instead of error
    }
});

// ========================================
// LOYALTY PROGRAM
// ========================================
router.get('/loyalty', authenticateToken, async (req, res) => {
    res.json({ message: 'Loyalty program endpoint' });
});

module.exports = router;
