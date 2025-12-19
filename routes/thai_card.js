// routes/thai_card.js - Thai National ID Card Reader Integration
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// Temporary storage for card data (in production, use Redis or session)
let latestCardData = null;

// GET - Display Thai Card data (inline HTML or JSON)
router.get('/thai_card', authenticateToken, async (req, res) => {
    try {
        console.log('[Thai Card] GET request - Data:', latestCardData);

        // If client wants JSON response
        if (req.query.format === 'json') {
            return res.json({
                success: true,
                data: latestCardData,
                timestamp: new Date()
            });
        }

        // Otherwise send simple HTML
        const html = `
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thai ID Card Reader - Lantavafix</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            margin: 0;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        .header {
            text-align: center;
            padding-bottom: 20px;
            border-bottom: 3px solid #667eea;
            margin-bottom: 30px;
        }
        .title { color: #667eea; font-size: 28px; font-weight: bold; }
        .status {
            display: inline-block;
            padding: 8px 20px;
            border-radius: 20px;
            font-weight: 600;
            margin-top: 10px;
        }
        .success { background: #d4edda; color: #155724; }
        .waiting { background: #fff3cd; color: #856404; }
        .data-row {
            padding: 15px;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
        }
        .data-row:last-child { border-bottom: none; }
        .label { font-weight: 600; color: #555; width: 200px; }
        .value { color: #333; font-size: 18px; }
        .spinner {
            width: 50px; height: 50px;
            border: 5px solid #f3f3f3;
            border-top: 5px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="container">
        ${latestCardData ? `
            <div class="header">
                <div style="font-size: 60px; color: #28a745;">✓</div>
                <h1 class="title">ข้อมูลบัตรประจำตัวประชาชน</h1>
                <span class="status success">อ่านข้อมูลสำเร็จ</span>
            </div>
            <div class="data-row">
                <div class="label">เลขบัตรประชาชน:</div>
                <div class="value"><strong>${latestCardData.cid || '-'}</strong></div>
            </div>
            <div class="data-row">
                <div class="label">คำนำหน้า:</div>
                <div class="value">${latestCardData.th_title || '-'}</div>
            </div>
            <div class="data-row">
                <div class="label">ชื่อ:</div>
                <div class="value">${latestCardData.th_fname || latestCardData.name || '-'}</div>
            </div>
            <div class="data-row">
                <div class="label">นามสกุล:</div>
                <div class="value">${latestCardData.th_lname || '-'}</div>
            </div>
            <div class="data-row">
                <div class="label">วัน/เดือน/ปีเกิด:</div>
                <div class="value">${latestCardData.dob || '-'}</div>
            </div>
            <div class="data-row">
                <div class="label">เพศ:</div>
                <div class="value">${latestCardData.gender || '-'}</div>
            </div>
            <div class="data-row">
                <div class="label">ที่อยู่:</div>
                <div class="value">${latestCardData.address || '-'}</div>
            </div>
        ` : `
            <div style="text-align: center;">
                <div class="spinner"></div>
                <h2 style="color: #667eea; margin: 20px 0;">กรุณาเสียบบัตรประชาชน</h2>
                <p style="color: #666;">ระบบกำลังรอการอ่านข้อมูลจากเครื่องอ่านบัตร...</p>
                <span class="status waiting">รอการเชื่อมต่อ</span>
            </div>
            <script>
                // Auto-refresh every 3 seconds when waiting
                setTimeout(() => window.location.reload(), 3000);
            </script>
        `}
    </div>
</body>
</html>`;

        res.send(html);
    } catch (error) {
        console.error('[Thai Card] GET error:', error);
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
