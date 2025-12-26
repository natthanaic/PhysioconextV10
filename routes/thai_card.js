// routes/thai_card.js - Thai National ID Card Reader Integration
const express = require('express');
const router = express.Router();

// In-memory cache for latest card data (expires after 30 seconds)
let latestCardData = null;
let cardDataTimestamp = null;
const CARD_DATA_EXPIRY_MS = 30000; // 30 seconds

// GET endpoint - returns cached card data if available
router.get('/', (req, res) => {
    console.log('[THAI CARD] GET request received');

    // Check if we have recent card data
    if (latestCardData && cardDataTimestamp) {
        const age = Date.now() - cardDataTimestamp;

        if (age < CARD_DATA_EXPIRY_MS) {
            console.log('[THAI CARD] Returning cached card data (age: ' + age + 'ms)');

            // Return the cached data and clear it (single use)
            const data = latestCardData;
            latestCardData = null;
            cardDataTimestamp = null;

            return res.json(data);
        } else {
            console.log('[THAI CARD] Cached card data expired (age: ' + age + 'ms)');
            latestCardData = null;
            cardDataTimestamp = null;
        }
    }

    // No card data available
    res.json({
        status: 'waiting',
        message: 'No card data available. Waiting for card insertion.'
    });
});

// Thai card reader endpoint (no authentication required - trusted local device)
// Route is mounted at /api/thai_card in app.js, so this is just '/'
router.post('/', async (req, res) => {
    console.log('[THAI CARD POST] Route matched! Processing request...');

    try {
        const db = req.app.locals.db;
        const cardData = req.body;

        console.log('[THAI CARD POST] Card data received:', cardData);

        // Extract data from Thai ID card
        const { cid, th_title, th_fname, th_lname, dob, gender, address } = cardData;

        if (!cid || cid.length !== 13) {
            return res.status(400).json({ error: 'Invalid citizen ID' });
        }

        // Check if patient already exists
        const [existingPatient] = await db.execute(
            'SELECT id, hn FROM patients WHERE citizen_id = ?',
            [cid]
        );

        let responseData;

        if (existingPatient.length > 0) {
            // Patient exists - return patient info
            responseData = {
                success: true,
                exists: true,
                patient: existingPatient[0],
                message: 'Patient found in system'
            };
        } else {
            // Patient doesn't exist - return card data for registration
            responseData = {
                success: true,
                exists: false,
                cid: cid,
                th_title: th_title,
                th_fname: th_fname,
                th_lname: th_lname,
                dob: dob,
                gender: gender,
                address: address,
                message: 'New patient - card data ready for registration'
            };
        }

        // Cache the card data for frontend polling
        latestCardData = responseData;
        cardDataTimestamp = Date.now();
        console.log('[THAI CARD POST] Card data cached for frontend polling');

        // Return response to the local card reader application
        res.json(responseData);

    } catch (error) {
        console.error('Thai card error:', error);
        res.status(500).json({ error: 'Failed to process Thai card data', details: error.message });
    }
});

module.exports = router;
