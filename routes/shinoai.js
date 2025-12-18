const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const moment = require('moment'); // Required for date handling

// =======================================================================
// 🔧 MANUAL CONFIGURATION (ใช้เมื่อ DB Settings ไม่พร้อม)
// =======================================================================
const MANUAL_CONFIG = {
    apiKey: 'AIzaSyAAD5JRfykE_7sz53Vsw4VGeriHZcEuQ68', 
    model: 'gemini-2.5-flash',
    forceEnable: true
};
// =======================================================================

// POST /api/shinoai/chat
router.post('/chat', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { message } = req.body;
        const userRole = req.user.role; 

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // 1. Check API Key
        // Priority: Manual > DB > Env
        let settings = {};
        try {
            const [allSettings] = await db.execute(`SELECT setting_key, setting_value FROM system_settings`);
            allSettings.forEach(row => { settings[row.setting_key] = row.setting_value; });
        } catch (e) { /* Ignore DB error */ }

        const apiKey = MANUAL_CONFIG.apiKey || settings.ai_api_key || settings.apiKey || process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            return res.status(400).json({ error: 'AI API key not configured.' });
        }

        // 2. Gather Context (Management Data Only)
        // STRICTLY NO USER PROFILE / SECURITY DATA
        const context = await gatherManagementContext(db, userRole);

        // 3. Build Prompt
        const systemPrompt = buildSystemPrompt(context, userRole);

        // 4. Model Selection
        let selectedModel = MANUAL_CONFIG.model || settings.model || 'gemini-1.5-flash';
        if (!MANUAL_CONFIG.model && selectedModel.includes(' ')) {
             selectedModel = selectedModel.toLowerCase().replace(/\s+/g, '-');
        }
        
        // 5. Call AI
        const aiResponse = await callGeminiAI(apiKey, systemPrompt, message, selectedModel);

        res.json({
            success: true,
            reply: aiResponse,
            timestamp: new Date()
        });

    } catch (error) {
        console.error('[ShinoAI] Error:', error.message);
        res.status(500).json({ error: 'AI Processing Failed: ' + error.message });
    }
});

// ==========================================
// 📊 Management Context (Safe Data Only)
// ==========================================

async function gatherManagementContext(db, role) {
    const context = {
        timestamp: new Date().toLocaleString('th-TH'),
        data: null
    };

    // Only Admin/Owner/Manager can access management stats
    if (role === 'ADMIN' || role === 'OWNER' || role === 'MANAGER') {
        context.data = await getClinicStats(db);
    }

    return context;
}

// Function to fetch ONLY clinic management stats
// No sensitive user data
async function getClinicStats(db) {
    const today = moment().format('YYYY-MM-DD');
    const startOfMonth = moment().startOf('month').format('YYYY-MM-DD');
    const endOfMonth = moment().endOf('month').format('YYYY-MM-DD');

    const stats = {
        appointments: { totalToday: 0, pending: 0, briefList: [] },
        finance: { incomeMonth: 0, expenseMonth: 0 },
        patients: { newThisMonth: 0 },
        cases: { activeCount: 0 }
    };

    try {
        // 1. APPOINTMENTS (Operational Data)
        // Count today's volume
        try {
            const [todayCount] = await db.execute(
                `SELECT COUNT(*) as count FROM appointments WHERE date = ? AND status != 'cancelled'`, [today]
            );
            stats.appointments.totalToday = todayCount[0]?.count || 0;

            // Count pending requests (Action items for admin)
            const [pendingCount] = await db.execute(
                `SELECT COUNT(*) as count FROM appointments WHERE status = 'pending'`
            );
            stats.appointments.pending = pendingCount[0]?.count || 0;

            // Get Brief Schedule (Time + Patient Name ONLY - No contact info/medical history)
            // Used for "What is the schedule today?"
            const [briefList] = await db.execute(
                `SELECT a.time, p.first_name, p.last_name, a.status 
                 FROM appointments a
                 JOIN patients p ON a.patient_id = p.id
                 WHERE a.date = ? AND a.status != 'cancelled'
                 ORDER BY a.time ASC LIMIT 10`,
                [today]
            );
            stats.appointments.briefList = briefList;
        } catch (e) { console.log('Appt Error:', e.message); }

        // 2. FINANCE (Business Data)
        // Monthly Income Summary
        try {
            const [income] = await db.execute(
                `SELECT SUM(final_amount) as total FROM bills 
                 WHERE status = 'paid' AND created_at BETWEEN ? AND ?`,
                [startOfMonth, endOfMonth]
            );
            stats.finance.incomeMonth = income[0]?.total || 0;
        } catch (e) { /* Ignore */ }

        // Monthly Expenses Summary (from routes/expenses.js logic)
        try {
            const [expenses] = await db.execute(
                `SELECT SUM(amount) as total FROM expenses 
                 WHERE date BETWEEN ? AND ?`,
                [startOfMonth, endOfMonth]
            );
            stats.finance.expenseMonth = expenses[0]?.total || 0;
        } catch (e) { /* Ignore */ }

        // 3. PATIENTS (Growth Data)
        // Count new registrations
        try {
            const [newP] = await db.execute(
                `SELECT COUNT(*) as count FROM patients WHERE created_at BETWEEN ? AND ?`,
                [startOfMonth, endOfMonth]
            );
            stats.patients.newThisMonth = newP[0]?.count || 0;
        } catch (e) { /* Ignore */ }

        // 4. PN CASES (Clinical Volume)
        // Count active cases only
        try {
            const [pn] = await db.execute(
                `SELECT COUNT(*) as count FROM pn_cases WHERE status = 'active'`
            );
            stats.cases.activeCount = pn[0]?.count || 0;
        } catch (e) { /* Ignore */ }

        return stats;

    } catch (error) {
        console.error('[ShinoAI] Stats Error:', error.message);
        return stats; // Return empty structure rather than null
    }
}

// ==========================================
// 📝 System Prompt (Security & Role Enforced)
// ==========================================

function buildSystemPrompt(context, role) {
    let prompt = `You are ShinoAI, a Clinic Management Assistant.
    Current Time: ${context.timestamp}
    
    [SECURITY PROTOCOL]:
    - DO NOT access or reveal User Passwords, Emails, Addresses, or Personal Contact Info.
    - DO NOT discuss System Security Configuration.
    - FOCUS ONLY on Clinic Operations (Appointments, Sales stats, Patient volume).
    `;

    if (context.data && (role === 'ADMIN' || role === 'OWNER')) {
        const d = context.data;
        
        prompt += `
        \n[OPERATIONAL DASHBOARD DATA]:
        1. TODAY'S SCHEDULE (${moment().format('YYYY-MM-DD')}):
           - Total Appointments: ${d.appointments.totalToday}
           - Pending Requests: ${d.appointments.pending}
           ${d.appointments.briefList.length > 0 ? 
             '- Schedule:\n' + d.appointments.briefList.map(a => `     * ${a.time}: ${a.first_name} ${a.last_name} (${a.status})`).join('\n') : 
             '- Schedule: No appointments found.'}
        
        2. BUSINESS PERFORMANCE (This Month):
           - Income: ${d.finance.incomeMonth.toLocaleString()} THB
           - Expenses: ${d.finance.expenseMonth.toLocaleString()} THB
           - New Patients: ${d.patients.newThisMonth}
           - Active Cases: ${d.cases.activeCount}

        [INSTRUCTIONS]:
        - Answer questions about the clinic's status using the data above.
        - Be professional, concise, and helpful for management.
        - Answer in Thai (ภาษาไทย).
        `;
    } else {
        prompt += `
        \n[ROLE: GENERAL ASSISTANT]
        You are assisting a general user. Answer general questions about clinic services only.
        Do not reveal operational data.
        `;
    }

    return prompt;
}

// ==========================================
// 🤖 AI Service Caller
// ==========================================

async function callGeminiAI(apiKey, systemPrompt, userMessage, modelName) {
    try {
        const fetch = (await import('node-fetch')).default;
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        const requestBody = {
            contents: [{
                role: "user",
                parts: [{ text: systemPrompt + '\n\nUser Question: ' + userMessage }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000,
            }
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || 'ขออภัย ระบบไม่สามารถประมวลผลคำตอบได้ในขณะนี้';

    } catch (error) {
        console.error('[ShinoAI] Gemini API error:', error.message);
        throw new Error('AI Error: ' + error.message);
    }
}

module.exports = router;