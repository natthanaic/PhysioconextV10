// routes/thai_card.js - Thai National ID Card Reader Integration
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// Temporary storage for card data (in production, use Redis or session)
let latestCardData = null;

// GET - Display Thai Card page (render HTML)
router.get('/thai_card', authenticateToken, async (req, res) => {
    try {
        console.log('[Thai Card] GET request - Rendering view');

        res.render('thai_card', {
            cardData: latestCardData,
            clinicName: 'Lantavafix Physiotherapy Clinic'
        });
    } catch (error) {
        console.error('[Thai Card] Render error:', error);
        res.status(500).send('Error loading Thai Card page');
    }
});

// POST - Receive card data from reader (API endpoint)
router.post('/thai_card', authenticateToken, async (req, res) => {
    try {
        console.log('[Thai Card] POST - Data received:', req.body);

        // Store the latest card data
        latestCardData = {
            cid: req.body.cid || req.body.citizenId,
            name: req.body.name || req.body.fullname,
            firstname: req.body.firstname,
            lastname: req.body.lastname,
            dob: req.body.dob || req.body.birthdate,
            address: req.body.address,
            issueDate: req.body.issueDate,
            expireDate: req.body.expireDate,
            timestamp: new Date()
        };

        // Clear data after 5 minutes
        setTimeout(() => {
            if (latestCardData && latestCardData.cid === req.body.cid) {
                latestCardData = null;
            }
        }, 5 * 60 * 1000);

        res.json({
            success: true,
            message: 'Thai card data received successfully',
            data: latestCardData
        });
    } catch (error) {
        console.error('[Thai Card] POST error:', error);
        res.status(500).json({ error: 'Failed to process Thai card data' });
    }
});

// DELETE - Clear card data
router.delete('/thai_card', authenticateToken, async (req, res) => {
    latestCardData = null;
    res.json({ success: true, message: 'Card data cleared' });
});

module.exports = router;
