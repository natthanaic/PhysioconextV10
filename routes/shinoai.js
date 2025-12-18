const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// POST /api/shinoai/chat - Chat with ShinoAI
router.post('/chat', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { message } = req.body;
        const userId = req.user.id;

        console.log('[ShinoAI] User query:', message);

        // Get AI settings
        const [aiSettings] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE 'ai_%'`
        );

        const settings = {};
        aiSettings.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });

        // Check if AI is enabled
        if (settings.ai_enabled !== '1' && settings.ai_enabled !== 'true') {
            return res.status(400).json({
                error: 'AI is not enabled. Please enable it in AI Settings.'
            });
        }

        // Get API key
        const apiKey = settings.ai_api_key || settings.ai_gemini_api_key;
        if (!apiKey) {
            return res.status(400).json({
                error: 'AI API key not configured. Please configure it in AI Settings.'
            });
        }

        // Gather context from database
        const context = await gatherContext(db, userId, message);

        // Build system prompt
        const systemPrompt = buildSystemPrompt(context);

        // Call Google Gemini AI
        const aiResponse = await callGeminiAI(apiKey, systemPrompt, message);

        res.json({
            success: true,
            response: aiResponse
        });

    } catch (error) {
        console.error('[ShinoAI] Error:', error);
        res.status(500).json({
            error: 'Failed to process AI request',
            details: error.message
        });
    }
});

// Gather context from database based on query
async function gatherContext(db, userId, query) {
    const context = {
        user: {},
        todayCases: [],
        appointments: [],
        pnCases: [],
        statistics: {}
    };

    try {
        // Get user info
        const [users] = await db.execute(
            'SELECT id, username, first_name, last_name, role FROM users WHERE id = ?',
            [userId]
        );
        if (users.length > 0) {
            context.user = users[0];
        }

        // Get today's date
        const today = new Date().toISOString().split('T')[0];

        // Check if query is about today's cases/appointments
        const isAboutToday = /today|today's|current|now/i.test(query);

        if (isAboutToday) {
            // Get today's appointments
            const [appointments] = await db.execute(`
                SELECT a.*,
                       CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                       p.hn,
                       c.name as clinic_name
                FROM appointments a
                LEFT JOIN patients p ON a.patient_id = p.id
                LEFT JOIN clinics c ON a.clinic_id = c.id
                WHERE DATE(a.appointment_date) = ?
                ORDER BY a.appointment_time
                LIMIT 20
            `, [today]);
            context.appointments = appointments;

            // Get active PN cases
            const [pnCases] = await db.execute(`
                SELECT pn.*,
                       CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                       p.hn,
                       c.name as clinic_name
                FROM pn_cases pn
                LEFT JOIN patients p ON pn.patient_id = p.id
                LEFT JOIN clinics c ON pn.clinic_id = c.id
                WHERE pn.status IN ('PENDING', 'IN_PROGRESS')
                ORDER BY pn.created_at DESC
                LIMIT 10
            `);
            context.pnCases = pnCases;
        }

        // Check if query is about priorities/recommendations
        const isAboutPriorities = /priority|urgent|recommend|important/i.test(query);

        if (isAboutPriorities) {
            // Get PN cases with SOAP notes
            const [pnWithSoap] = await db.execute(`
                SELECT pn.id, pn.pn_code,
                       CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                       p.hn,
                       pn.status,
                       pn.diagnosis,
                       pn.created_at,
                       s.subjective,
                       s.objective,
                       s.assessment,
                       s.plan,
                       s.created_at as soap_date
                FROM pn_cases pn
                LEFT JOIN patients p ON pn.patient_id = p.id
                LEFT JOIN soap_notes s ON pn.id = s.pn_case_id
                WHERE pn.status IN ('PENDING', 'IN_PROGRESS')
                ORDER BY pn.created_at DESC
                LIMIT 10
            `);
            context.pnCases = pnWithSoap;

            // Get statistics
            const [stats] = await db.execute(`
                SELECT
                    (SELECT COUNT(*) FROM appointments WHERE DATE(appointment_date) = ?) as today_appointments,
                    (SELECT COUNT(*) FROM pn_cases WHERE status = 'PENDING') as pending_cases,
                    (SELECT COUNT(*) FROM pn_cases WHERE status = 'IN_PROGRESS') as in_progress_cases,
                    (SELECT COUNT(*) FROM patients) as total_patients
            `, [today]);
            context.statistics = stats[0] || {};
        }

        // Check if query is about how to use the system
        const isAboutUsage = /how to|how do|guide|help|create|add|register/i.test(query);

        if (isAboutUsage) {
            context.features = {
                patients: 'Register and manage patient records with HN numbers',
                appointments: 'Schedule appointments by date, time, and clinic',
                pnCases: 'Create PN (Physiotherapy Notes) cases with referral details',
                soapNotes: 'Add SOAP notes (Subjective, Objective, Assessment, Plan) to track progress',
                bills: 'Generate bills and invoices for services',
                courses: 'Manage physiotherapy courses for patients',
                statistics: 'View reports and analytics'
            };
        }

        return context;

    } catch (error) {
        console.error('[ShinoAI] Context gathering error:', error);
        return context;
    }
}

// Build system prompt with context
function buildSystemPrompt(context) {
    let prompt = `You are ShinoAI, an intelligent assistant for a physiotherapy clinic management system called PhysioConext.

You are helpful, professional, and knowledgeable about physiotherapy practices and clinic management.

`;

    // Add user context
    if (context.user && context.user.username) {
        prompt += `Current user: ${context.user.first_name || ''} ${context.user.last_name || ''} (${context.user.role})\n\n`;
    }

    // Add today's appointments
    if (context.appointments && context.appointments.length > 0) {
        prompt += `Today's Appointments (${context.appointments.length}):\n`;
        context.appointments.forEach(apt => {
            prompt += `- ${apt.appointment_time}: ${apt.patient_name} (HN: ${apt.hn}) at ${apt.clinic_name || 'Main Clinic'} - ${apt.status}\n`;
        });
        prompt += '\n';
    }

    // Add PN cases
    if (context.pnCases && context.pnCases.length > 0) {
        prompt += `Active PN Cases (${context.pnCases.length}):\n`;
        context.pnCases.forEach(pn => {
            prompt += `- ${pn.pn_code || 'PN-' + pn.id}: ${pn.patient_name} (HN: ${pn.hn}) - Status: ${pn.status}`;
            if (pn.diagnosis) prompt += ` - Diagnosis: ${pn.diagnosis}`;
            if (pn.subjective) prompt += `\n  SOAP: ${pn.subjective.substring(0, 100)}...`;
            prompt += '\n';
        });
        prompt += '\n';
    }

    // Add statistics
    if (context.statistics && Object.keys(context.statistics).length > 0) {
        prompt += `Statistics:\n`;
        if (context.statistics.today_appointments) prompt += `- Today's appointments: ${context.statistics.today_appointments}\n`;
        if (context.statistics.pending_cases) prompt += `- Pending PN cases: ${context.statistics.pending_cases}\n`;
        if (context.statistics.in_progress_cases) prompt += `- In-progress PN cases: ${context.statistics.in_progress_cases}\n`;
        if (context.statistics.total_patients) prompt += `- Total patients: ${context.statistics.total_patients}\n`;
        prompt += '\n';
    }

    // Add features guide
    if (context.features) {
        prompt += `System Features:\n`;
        Object.entries(context.features).forEach(([key, value]) => {
            prompt += `- ${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}\n`;
        });
        prompt += '\n';
    }

    prompt += `Please provide helpful, accurate responses based on the context above.
If you recommend actions, be specific about which cases or appointments to prioritize and why.
Keep responses concise but informative.`;

    return prompt;
}

// Call Google Gemini AI
async function callGeminiAI(apiKey, systemPrompt, userMessage) {
    try {
        const fetch = (await import('node-fetch')).default;

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;

        const requestBody = {
            contents: [{
                parts: [{
                    text: systemPrompt + '\n\nUser Question: ' + userMessage
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            }
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();

        // Extract response text
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI';

        return aiResponse;

    } catch (error) {
        console.error('[ShinoAI] Gemini API error:', error);
        throw new Error('Failed to get AI response: ' + error.message);
    }
}

module.exports = router;
