// routes/views.js - View Routes for serving EJS pages
const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');

// ========================================
// BROADCAST MARKETING PAGE
// ========================================
router.get('/broadcast', authenticateToken, authorize('ADMIN', 'PT'), (req, res) => {
    res.render('admin/broadcast', {
        user: req.user,
        activePage: 'broadcast',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

module.exports = router;
