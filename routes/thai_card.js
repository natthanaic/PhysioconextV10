// routes/thai_card.js - Thai National ID Card Reader Integration
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// Thai card reader endpoint
router.post('/thai_card', authenticateToken, async (req, res) => {
    try {
        console.log('Thai card data received:', req.body);
        res.json({ success: true, message: 'Thai card data received' });
    } catch (error) {
        console.error('Thai card error:', error);
        res.status(500).json({ error: 'Failed to process Thai card data' });
    }
});

module.exports = router;
