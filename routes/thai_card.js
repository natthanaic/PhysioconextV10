// routes/thai_card.js - Thai National ID Card Reader Integration
const express = require('express');
const router = express.Router();

// Thai card reader endpoint (no authentication required - trusted local device)
router.post('/thai_card', async (req, res) => {
    console.log('[THAI CARD] Route matched! Processing request...');

    try {
        const db = req.app.locals.db;
        const cardData = req.body;

        console.log('Thai card data received:', cardData);

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

        if (existingPatient.length > 0) {
            // Patient exists - return patient info
            return res.json({
                success: true,
                exists: true,
                patient: existingPatient[0],
                message: 'Patient found in system'
            });
        }

        // Patient doesn't exist - return card data for registration
        res.json({
            success: true,
            exists: false,
            cardData: {
                citizen_id: cid,
                title: th_title,
                first_name: th_fname,
                last_name: th_lname,
                date_of_birth: dob,
                gender: gender,
                address: address
            },
            message: 'New patient - card data ready for registration'
        });

    } catch (error) {
        console.error('Thai card error:', error);
        res.status(500).json({ error: 'Failed to process Thai card data', details: error.message });
    }
});

module.exports = router;
