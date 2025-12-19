// routes/thai_card.js - Thai National ID Card Reader Integration
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// Thai card reader endpoint
// Mounted at /api, so this becomes /api/thai_card
router.post('/thai_card', authenticateToken, async (req, res) => {
    try {
        console.log('[Thai Card] Data received:', req.body);
        const { cid, name, dob, address } = req.body;

        res.json({
            success: true,
            message: 'Thai card data received successfully',
            data: {
                cid,
                name,
                dob,
                address
            }
        });
    } catch (error) {
        console.error('[Thai Card] Error:', error);
        res.status(500).json({ error: 'Failed to process Thai card data' });
    }
});

// GET endpoint for testing
router.get('/thai_card', authenticateToken, async (req, res) => {
    res.json({
        success: true,
        message: 'Thai Card API is working',
        endpoint: '/api/thai_card',
        methods: ['GET', 'POST']
    });
});

module.exports = router;
