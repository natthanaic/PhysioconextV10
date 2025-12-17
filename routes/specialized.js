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
        const [courses] = await db.execute('SELECT * FROM courses WHERE active = 1 ORDER BY name');
        res.json(courses);
    } catch (error) {
        console.error('Get courses error:', error);
        res.status(500).json({ error: 'Failed to retrieve courses' });
    }
});

// ========================================
// LOYALTY PROGRAM
// ========================================
router.get('/loyalty', authenticateToken, async (req, res) => {
    res.json({ message: 'Loyalty program endpoint' });
});

module.exports = router;
