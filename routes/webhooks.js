// routes/webhooks.js - Webhook Handlers (LINE, etc.)
const express = require('express');
const router = express.Router();

// LINE webhook handler
router.post('/line', async (req, res) => {
    try {
        console.log('LINE webhook received:', req.body);
        res.status(200).send('OK');
    } catch (error) {
        console.error('LINE webhook error:', error);
        res.status(500).send('Error');
    }
});

module.exports = router;
