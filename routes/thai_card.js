// routes/thai_card.js - Thai National ID Card Reader Integration
const express = require('express');
const router = express.Router();

// In-memory cache for card reader status
let latestCardData = null;
let cardDataTimestamp = null;
let lastReaderHeartbeat = null;
const CARD_DATA_EXPIRY_MS = 60000; // 60 seconds - keep data longer for testing
const READER_TIMEOUT_MS = 10000; // 10 seconds - if no heartbeat, reader is disconnected

// GET endpoint - returns card reader status and data
router.get('/', (req, res) => {
    console.log('[THAI CARD] GET request received');

    const now = Date.now();
    const readerConnected = lastReaderHeartbeat ? (now - lastReaderHeartbeat) < READER_TIMEOUT_MS : false;

    // Check if we have recent card data
    if (latestCardData && cardDataTimestamp) {
        const age = now - cardDataTimestamp;

        if (age < CARD_DATA_EXPIRY_MS) {
            console.log('[THAI CARD] Returning cached card data (age: ' + age + 'ms)');

            // Return the cached data with metadata (keep cache for testing)
            return res.json({
                ...latestCardData,
                _metadata: {
                    readerConnected: readerConnected,
                    dataAge: age,
                    cachedAt: new Date(cardDataTimestamp).toISOString(),
                    lastHeartbeat: lastReaderHeartbeat ? new Date(lastReaderHeartbeat).toISOString() : null
                }
            });
        } else {
            console.log('[THAI CARD] Cached card data expired (age: ' + age + 'ms)');
            latestCardData = null;
            cardDataTimestamp = null;
        }
    }

    // No card data available - return connection status
    res.json({
        status: 'waiting',
        readerConnected: readerConnected,
        message: readerConnected
            ? 'Card reader connected. Waiting for card insertion.'
            : 'No card reader connected. Please ensure the local NFC reader application is running.',
        lastHeartbeat: lastReaderHeartbeat ? new Date(lastReaderHeartbeat).toISOString() : null
    });
});

// Heartbeat endpoint - local app can ping this to show it's running
router.post('/heartbeat', (req, res) => {
    lastReaderHeartbeat = Date.now();
    console.log('[THAI CARD] Heartbeat received from card reader');
    res.json({
        success: true,
        message: 'Card reader heartbeat registered',
        timestamp: new Date().toISOString()
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

        // Update heartbeat - reader is connected
        lastReaderHeartbeat = Date.now();

        // Cache the card data for frontend polling
        latestCardData = responseData;
        cardDataTimestamp = Date.now();
        console.log('[THAI CARD POST] Card data cached for frontend polling');
        console.log('[THAI CARD POST] Reader heartbeat updated');

        // Return response to the local card reader application
        res.json(responseData);

    } catch (error) {
        console.error('Thai card error:', error);
        res.status(500).json({ error: 'Failed to process Thai card data', details: error.message });
    }
});

module.exports = router;
