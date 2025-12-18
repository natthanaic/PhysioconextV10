// routes/test.js - Test Routes for Development/Debug
const express = require('express');
const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Test endpoint working',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
