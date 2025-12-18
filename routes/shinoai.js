const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const moment = require('moment');

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
        const userId = req.user.id;
        const userRole = req.user.role;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // 1. Check API Key
        let settings = {};
        try {
            const [allSettings] = await db.execute(`SELECT setting_key, setting_value FROM system_settings`);
            allSettings.forEach(row => { settings[row.setting_key] = row.setting_value; });
        } catch (e) { /* Ignore DB error */ }

        const apiKey = MANUAL_CONFIG.apiKey || settings.ai_api_key || settings.apiKey || process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(400).json({ error: 'AI API key not configured.' });
        }

        // 2. Gather comprehensive context with patient data (READ-ONLY)
        const context = await gatherContext(db, userId, message);

        // 3. Build system prompt with all patient data
        const systemPrompt = buildSystemPrompt(context, userRole);

        // 4. Model selection
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
// 📊 Comprehensive Context Gathering (READ-ONLY Patient Data Access)
// ==========================================

async function gatherContext(db, userId, query) {
    const today = moment().format('YYYY-MM-DD');

    const context = {
        user: {},
        patients: [],
        appointments: [],
        pnCases: [],
        soapNotes: [],
        statistics: {},
        recentActivity: [],
        bills: [],
        courses: [],
        dbSchema: null
    };

    try {
        // Get user info (non-sensitive)
        const [userInfo] = await db.execute(
            `SELECT id, username, role, first_name, last_name FROM users WHERE id = ? LIMIT 1`,
            [userId]
        );
        if (userInfo.length > 0) {
            context.user = userInfo[0];
        }

        // ============================================
        // ALWAYS LOAD ALL DATA (No conditional loading)
        // Database queries are FREE - only AI response costs credits
        // ============================================

        // 1. ALWAYS load recent patients with full medical info
        const [patients] = await db.execute(`
            SELECT
                p.id,
                p.hn,
                CONCAT(p.first_name, ' ', p.last_name) as full_name,
                p.first_name,
                p.last_name,
                p.date_of_birth,
                YEAR(CURDATE()) - YEAR(p.date_of_birth) as age,
                p.gender,
                p.phone,
                p.email,
                p.address,
                p.medical_conditions,
                p.allergies,
                p.current_medications,
                p.notes,
                p.created_at,
                (SELECT COUNT(*) FROM appointments WHERE patient_id = p.id) as total_appointments,
                (SELECT COUNT(*) FROM pn_cases WHERE patient_id = p.id) as total_pn_cases,
                (SELECT MAX(appointment_date) FROM appointments WHERE patient_id = p.id) as last_visit
            FROM patients p
            ORDER BY p.created_at DESC
            LIMIT 100
        `);
        context.patients = patients;

        // 2. ALWAYS load today's appointments
        const [appointments] = await db.execute(`
            SELECT a.*,
                   CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                   p.hn,
                   p.phone as patient_phone,
                   p.medical_conditions,
                   c.name as clinic_name
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            LEFT JOIN clinics c ON a.clinic_id = c.id
            WHERE DATE(a.appointment_date) = ?
            ORDER BY a.appointment_time
            LIMIT 50
        `, [today]);
        context.appointments = appointments;

        // 3. ALWAYS load active PN cases with SOAP notes
        const [pnCases] = await db.execute(`
            SELECT pn.id, pn.pn_code,
                   CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                   p.hn,
                   p.medical_conditions,
                   p.current_medications,
                   p.allergies,
                   YEAR(CURDATE()) - YEAR(p.date_of_birth) as age,
                   p.gender,
                   pn.status,
                   pn.diagnosis,
                   pn.chief_complaint,
                   pn.treatment_plan,
                   pn.created_at,
                   s.subjective,
                   s.objective,
                   s.assessment,
                   s.plan,
                   s.created_at as soap_date,
                   s.pain_level,
                   s.functional_status
            FROM pn_cases pn
            LEFT JOIN patients p ON pn.patient_id = p.id
            LEFT JOIN soap_notes s ON pn.id = s.pn_case_id
            WHERE pn.status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED')
            ORDER BY pn.created_at DESC, s.created_at DESC
            LIMIT 30
        `);
        context.pnCases = pnCases;

        // 4. ALWAYS load recent SOAP notes for trend analysis
        const [recentSoap] = await db.execute(`
            SELECT s.*,
                   CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                   p.hn,
                   pn.pn_code,
                   pn.diagnosis
            FROM soap_notes s
            LEFT JOIN pn_cases pn ON s.pn_case_id = pn.id
            LEFT JOIN patients p ON pn.patient_id = p.id
            WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAYS)
            ORDER BY s.created_at DESC
            LIMIT 30
        `);
        context.soapNotes = recentSoap;

        // 5. ALWAYS load recent bills/invoices
        const [bills] = await db.execute(`
            SELECT b.*,
                   CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                   p.hn
            FROM bills b
            LEFT JOIN patients p ON b.patient_id = p.id
            WHERE b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAYS)
            ORDER BY b.created_at DESC
            LIMIT 50
        `);
        context.bills = bills;

        // 6. ALWAYS load active courses
        const [courses] = await db.execute(`
            SELECT c.*,
                   CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                   p.hn
            FROM courses c
            LEFT JOIN patients p ON c.patient_id = p.id
            WHERE c.status = 'ACTIVE' OR c.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAYS)
            ORDER BY c.created_at DESC
            LIMIT 30
        `);
        context.courses = courses;

        // 7. ALWAYS load overall statistics
        const [stats] = await db.execute(`
            SELECT
                (SELECT COUNT(*) FROM patients) as total_patients,
                (SELECT COUNT(*) FROM appointments WHERE DATE(appointment_date) = ?) as today_appointments,
                (SELECT COUNT(*) FROM appointments WHERE status = 'SCHEDULED' AND appointment_date >= CURDATE()) as upcoming_appointments,
                (SELECT COUNT(*) FROM pn_cases WHERE status = 'PENDING') as pending_cases,
                (SELECT COUNT(*) FROM pn_cases WHERE status = 'IN_PROGRESS') as in_progress_cases,
                (SELECT COUNT(*) FROM pn_cases WHERE status = 'COMPLETED' AND DATE(updated_at) = ?) as completed_today,
                (SELECT COUNT(*) FROM bills WHERE payment_status = 'UNPAID') as unpaid_bills,
                (SELECT COUNT(*) FROM bills WHERE payment_status = 'PAID' AND DATE(payment_date) = ?) as paid_today,
                (SELECT SUM(total_amount) FROM bills WHERE payment_status = 'PAID' AND MONTH(payment_date) = MONTH(CURDATE())) as revenue_this_month,
                (SELECT COUNT(*) FROM soap_notes WHERE DATE(created_at) = ?) as soap_notes_today,
                (SELECT COUNT(*) FROM courses WHERE status = 'ACTIVE') as active_courses
        `, [today, today, today, today]);
        context.statistics = stats[0] || {};

        // 8. Check if asking about specific patient by HN (supports HNPT250112 format)
        const hnMatch = query.match(/HN[\w\s:]*?([A-Z0-9]+)/i) || query.match(/patient\s+([A-Z0-9]+)/i);
        if (hnMatch) {
            const hn = hnMatch[1];
            const [patientDetail] = await db.execute(`
                SELECT
                    p.*,
                    YEAR(CURDATE()) - YEAR(p.date_of_birth) as age,
                    (SELECT COUNT(*) FROM appointments WHERE patient_id = p.id) as total_visits,
                    (SELECT COUNT(*) FROM pn_cases WHERE patient_id = p.id) as total_cases,
                    (SELECT MAX(appointment_date) FROM appointments WHERE patient_id = p.id) as last_visit,
                    (SELECT diagnosis FROM pn_cases WHERE patient_id = p.id ORDER BY created_at DESC LIMIT 1) as latest_diagnosis
                FROM patients p
                WHERE p.hn LIKE ?
                LIMIT 1
            `, [`%${hn}%`]);

            if (patientDetail.length > 0) {
                context.specificPatient = patientDetail[0];

                // Get this patient's PN cases
                const [patientPNCases] = await db.execute(`
                    SELECT pn.*,
                           c.name as clinic_name
                    FROM pn_cases pn
                    LEFT JOIN clinics c ON pn.clinic_id = c.id
                    WHERE pn.patient_id = ?
                    ORDER BY pn.created_at DESC
                    LIMIT 20
                `, [patientDetail[0].id]);
                context.specificPatient.pnCases = patientPNCases;

                // Get this patient's SOAP notes
                const [patientSoap] = await db.execute(`
                    SELECT s.*, pn.pn_code, pn.diagnosis
                    FROM soap_notes s
                    LEFT JOIN pn_cases pn ON s.pn_case_id = pn.id
                    WHERE pn.patient_id = ?
                    ORDER BY s.created_at DESC
                    LIMIT 20
                `, [patientDetail[0].id]);
                context.specificPatient.soapNotes = patientSoap;

                // Get this patient's bills
                const [patientBills] = await db.execute(`
                    SELECT * FROM bills WHERE patient_id = ? ORDER BY created_at DESC LIMIT 10
                `, [patientDetail[0].id]);
                context.specificPatient.bills = patientBills;

                // Get this patient's appointments
                const [patientAppts] = await db.execute(`
                    SELECT * FROM appointments WHERE patient_id = ? ORDER BY appointment_date DESC LIMIT 10
                `, [patientDetail[0].id]);
                context.specificPatient.appointments = patientAppts;
            }
        }

        // 9. ALWAYS provide database schema info
        context.dbSchema = {
            tables: {
                patients: 'Patient records with HN, demographics, medical history, conditions, allergies, medications',
                appointments: 'Scheduled appointments with dates, times, status (SCHEDULED, COMPLETED, CANCELLED)',
                pn_cases: 'Physiotherapy Notes cases with diagnosis, chief complaint, treatment plan, status',
                soap_notes: 'SOAP notes (Subjective, Objective, Assessment, Plan) with pain levels and functional status',
                bills: 'Bills and invoices with payment status (PAID, UNPAID), amounts, payment methods',
                courses: 'Treatment courses for patients with sessions and status',
                clinics: 'Clinic locations and information',
                users: 'Staff users with roles (ADMIN, THERAPIST, etc.)'
            },
            hnFormat: 'HN format is like HNPT250112 (contains letters and numbers)',
            dateFormat: 'Dates stored as YYYY-MM-DD'
        };

        return context;

    } catch (error) {
        console.error('[ShinoAI] Context gathering error:', error.message);
        return context; // Return partial context rather than null
    }
}

// ==========================================
// 📝 System Prompt with Comprehensive Patient Data
// ==========================================

function buildSystemPrompt(context, role) {
    let prompt = `You are ShinoAI, an intelligent assistant for a physiotherapy clinic management system called PhysioConext.
You are helpful, professional, and knowledgeable about physiotherapy practices and clinic management.

Current User Role: ${role}
Current Time: ${moment().format('YYYY-MM-DD HH:mm')}

`;

    // Add user info
    if (context.user && context.user.first_name) {
        prompt += `Current User: ${context.user.first_name} ${context.user.last_name} (${context.user.role})\n\n`;
    }

    // Add patients list
    if (context.patients && context.patients.length > 0) {
        prompt += `Patient Database (${context.patients.length} recent patients):\n`;
        context.patients.slice(0, 10).forEach(p => {
            prompt += `- HN: ${p.hn} | ${p.full_name} | Age: ${p.age || 'N/A'} | Gender: ${p.gender || 'N/A'}`;
            if (p.medical_conditions) prompt += ` | Conditions: ${p.medical_conditions.substring(0, 50)}`;
            if (p.last_visit) prompt += ` | Last Visit: ${p.last_visit}`;
            prompt += `\n`;
        });
        prompt += '\n';
    }

    // Add specific patient details if queried
    if (context.specificPatient) {
        const p = context.specificPatient;
        prompt += `DETAILED PATIENT INFO - HN: ${p.hn}\n`;
        prompt += `Name: ${p.first_name} ${p.last_name}\n`;
        prompt += `Age: ${p.age} | Gender: ${p.gender} | DOB: ${p.date_of_birth}\n`;
        if (p.phone) prompt += `Phone: ${p.phone}\n`;
        if (p.email) prompt += `Email: ${p.email}\n`;
        if (p.medical_conditions) prompt += `Medical Conditions: ${p.medical_conditions}\n`;
        if (p.allergies) prompt += `Allergies: ${p.allergies}\n`;
        if (p.current_medications) prompt += `Current Medications: ${p.current_medications}\n`;
        if (p.latest_diagnosis) prompt += `Latest Diagnosis: ${p.latest_diagnosis}\n`;
        prompt += `Total Visits: ${p.total_visits} | Total Cases: ${p.total_cases}\n`;

        if (p.pnCases && p.pnCases.length > 0) {
            prompt += `\nPN Cases for this patient:\n`;
            p.pnCases.forEach(pn => {
                prompt += `  - ${pn.pn_code}: ${pn.diagnosis || 'No diagnosis'} (${pn.status})\n`;
            });
        }

        if (p.soapNotes && p.soapNotes.length > 0) {
            prompt += `\nRecent SOAP Notes:\n`;
            p.soapNotes.slice(0, 3).forEach(soap => {
                prompt += `  - ${soap.created_at}: ${soap.subjective?.substring(0, 80) || 'N/A'}...\n`;
            });
        }
        prompt += '\n';
    }

    // Add today's appointments
    if (context.appointments && context.appointments.length > 0) {
        prompt += `Today's Appointments (${context.appointments.length}):\n`;
        context.appointments.forEach(apt => {
            prompt += `- ${apt.appointment_time}: ${apt.patient_name} (HN: ${apt.hn})`;
            if (apt.medical_conditions) prompt += ` | Conditions: ${apt.medical_conditions.substring(0, 40)}`;
            prompt += ` | ${apt.clinic_name || 'Main Clinic'} - ${apt.status}\n`;
        });
        prompt += '\n';
    }

    // Add PN cases with detailed patient info
    if (context.pnCases && context.pnCases.length > 0) {
        prompt += `Active PN Cases (${context.pnCases.length}):\n`;
        context.pnCases.forEach(pn => {
            prompt += `- ${pn.pn_code || 'PN-' + pn.id}: ${pn.patient_name} (HN: ${pn.hn})`;
            if (pn.age) prompt += ` | Age: ${pn.age}`;
            if (pn.diagnosis) prompt += ` | Diagnosis: ${pn.diagnosis}`;
            prompt += ` | Status: ${pn.status}\n`;
            if (pn.chief_complaint) prompt += `  Chief Complaint: ${pn.chief_complaint.substring(0, 80)}\n`;
            if (pn.medical_conditions) prompt += `  Medical Conditions: ${pn.medical_conditions.substring(0, 60)}\n`;
            if (pn.current_medications) prompt += `  Medications: ${pn.current_medications.substring(0, 60)}\n`;
            if (pn.subjective) prompt += `  Latest SOAP: ${pn.subjective.substring(0, 100)}...\n`;
            if (pn.pain_level) prompt += `  Pain Level: ${pn.pain_level}/10\n`;
        });
        prompt += '\n';
    }

    // Add recent SOAP notes
    if (context.soapNotes && context.soapNotes.length > 0) {
        prompt += `Recent SOAP Notes (Last 7 Days - ${context.soapNotes.length} entries):\n`;
        context.soapNotes.slice(0, 5).forEach(soap => {
            prompt += `- ${soap.patient_name} (HN: ${soap.hn}) | ${soap.pn_code}\n`;
            prompt += `  S: ${soap.subjective?.substring(0, 60) || 'N/A'}...\n`;
            prompt += `  A: ${soap.assessment?.substring(0, 60) || 'N/A'}...\n`;
            if (soap.pain_level) prompt += `  Pain: ${soap.pain_level}/10\n`;
        });
        prompt += '\n';
    }

    // Add statistics
    if (context.statistics && Object.keys(context.statistics).length > 0) {
        prompt += `System Statistics:\n`;
        if (context.statistics.total_patients) prompt += `- Total Patients: ${context.statistics.total_patients}\n`;
        if (context.statistics.today_appointments) prompt += `- Today's Appointments: ${context.statistics.today_appointments}\n`;
        if (context.statistics.upcoming_appointments) prompt += `- Upcoming Appointments: ${context.statistics.upcoming_appointments}\n`;
        if (context.statistics.pending_cases) prompt += `- Pending PN Cases: ${context.statistics.pending_cases}\n`;
        if (context.statistics.in_progress_cases) prompt += `- In-Progress Cases: ${context.statistics.in_progress_cases}\n`;
        if (context.statistics.completed_today) prompt += `- Completed Today: ${context.statistics.completed_today}\n`;
        if (context.statistics.unpaid_bills) prompt += `- Unpaid Bills: ${context.statistics.unpaid_bills}\n`;
        if (context.statistics.paid_today) prompt += `- Bills Paid Today: ${context.statistics.paid_today}\n`;
        if (context.statistics.revenue_this_month) prompt += `- Revenue This Month: ${context.statistics.revenue_this_month} THB\n`;
        if (context.statistics.soap_notes_today) prompt += `- SOAP Notes Today: ${context.statistics.soap_notes_today}\n`;
        if (context.statistics.active_courses) prompt += `- Active Courses: ${context.statistics.active_courses}\n`;
        prompt += '\n';
    }

    // Add recent bills
    if (context.bills && context.bills.length > 0) {
        prompt += `Recent Bills (Last 30 Days - ${context.bills.length} bills):\n`;
        context.bills.slice(0, 10).forEach(bill => {
            prompt += `- ${bill.bill_code || 'BILL-' + bill.id}: ${bill.patient_name || 'Walk-in'} (HN: ${bill.hn || 'N/A'})`;
            prompt += ` | Amount: ${bill.total_amount} THB | Status: ${bill.payment_status}`;
            if (bill.payment_date) prompt += ` | Paid: ${bill.payment_date}`;
            prompt += `\n`;
        });
        prompt += '\n';
    }

    // Add active courses
    if (context.courses && context.courses.length > 0) {
        prompt += `Active Treatment Courses (${context.courses.length} courses):\n`;
        context.courses.slice(0, 10).forEach(course => {
            prompt += `- ${course.patient_name} (HN: ${course.hn})`;
            prompt += ` | Status: ${course.status}`;
            if (course.total_sessions) prompt += ` | Sessions: ${course.completed_sessions || 0}/${course.total_sessions}`;
            prompt += `\n`;
        });
        prompt += '\n';
    }

    // Add database schema information
    if (context.dbSchema) {
        prompt += `DATABASE SCHEMA:\n`;
        prompt += `Available Tables:\n`;
        Object.entries(context.dbSchema.tables).forEach(([table, desc]) => {
            prompt += `- ${table}: ${desc}\n`;
        });
        prompt += `\nData Formats:\n`;
        prompt += `- HN Format: ${context.dbSchema.hnFormat}\n`;
        prompt += `- Date Format: ${context.dbSchema.dateFormat}\n`;
        prompt += '\n';
    }

    prompt += `IMPORTANT INSTRUCTIONS:
- You have READ-ONLY access to ALL patient data for analysis and recommendations
- You CANNOT modify, enter, or update any patient records
- ALWAYS have complete database context - no need to ask for missing data
- Provide specific, actionable recommendations based on the comprehensive data
- Reference patients by HN number when making recommendations
- When asked about specific HN (like HNPT250112), look for it in the patient database
- Be professional, empathetic, and HIPAA-compliant in responses
- Keep responses concise but informative (2-4 paragraphs max)
- When recommending priorities, explain WHY based on medical conditions, pain levels, or SOAP trends
- Answer in a friendly, helpful tone that makes complex medical information accessible
- You understand the complete database structure - use this knowledge to answer any question`;

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
