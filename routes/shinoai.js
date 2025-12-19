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
// 📊 Sample Data Loader (AI Learning from Real Data)
// ==========================================

async function getSampleData(db) {
    const samples = {};

    try {
        // Sample patients (3-5 examples showing actual HN format and data structure)
        const [samplePatients] = await db.execute(`
            SELECT
                hn,
                CONCAT(first_name, ' ', last_name) as name,
                YEAR(CURDATE()) - YEAR(date_of_birth) as age,
                gender,
                medical_conditions,
                allergies,
                current_medications
            FROM patients
            LIMIT 5
        `);
        samples.patients = samplePatients;

        // Sample appointments
        const [sampleAppointments] = await db.execute(`
            SELECT
                a.appointment_date,
                a.appointment_time,
                a.status,
                p.hn
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            LIMIT 5
        `);
        samples.appointments = sampleAppointments;

        // Sample PN cases
        const [samplePNCases] = await db.execute(`
            SELECT
                pn.pn_code,
                p.hn,
                pn.diagnosis,
                pn.chief_complaint,
                pn.status
            FROM pn_cases pn
            LEFT JOIN patients p ON pn.patient_id = p.id
            LIMIT 5
        `);
        samples.pnCases = samplePNCases;

        // Sample bills
        const [sampleBills] = await db.execute(`
            SELECT
                b.bill_code,
                p.hn,
                b.total_amount,
                b.payment_status,
                b.bill_date
            FROM bills b
            LEFT JOIN patients p ON b.patient_id = p.id
            LIMIT 5
        `);
        samples.bills = sampleBills;

        return samples;

    } catch (error) {
        console.error('[ShinoAI] Sample data error:', error.message);
        return {};
    }
}

// ==========================================
// 📊 Database Schema Discovery
// ==========================================

async function getCompleteDBSchema(db) {
    try {
        // Get current database name
        const [dbInfo] = await db.execute(`SELECT DATABASE() as db_name`);
        const dbName = dbInfo[0].db_name;

        // Get all tables with their columns
        const [tables] = await db.execute(`
            SELECT
                TABLE_NAME,
                TABLE_COMMENT
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ?
            AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `, [dbName]);

        const schema = {
            database: dbName,
            tables: {},
            relationships: []
        };

        // For each table, get columns and relationships
        for (const table of tables) {
            const tableName = table.TABLE_NAME;

            // Get columns for this table
            const [columns] = await db.execute(`
                SELECT
                    COLUMN_NAME,
                    DATA_TYPE,
                    IS_NULLABLE,
                    COLUMN_KEY,
                    COLUMN_DEFAULT,
                    EXTRA,
                    COLUMN_COMMENT
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                ORDER BY ORDINAL_POSITION
            `, [dbName, tableName]);

            // Get foreign key relationships
            const [foreignKeys] = await db.execute(`
                SELECT
                    COLUMN_NAME,
                    REFERENCED_TABLE_NAME,
                    REFERENCED_COLUMN_NAME,
                    CONSTRAINT_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = ?
                AND TABLE_NAME = ?
                AND REFERENCED_TABLE_NAME IS NOT NULL
            `, [dbName, tableName]);

            schema.tables[tableName] = {
                comment: table.TABLE_COMMENT || '',
                columns: columns.map(col => ({
                    name: col.COLUMN_NAME,
                    type: col.DATA_TYPE,
                    nullable: col.IS_NULLABLE === 'YES',
                    key: col.COLUMN_KEY,
                    default: col.COLUMN_DEFAULT,
                    extra: col.EXTRA,
                    comment: col.COLUMN_COMMENT || ''
                })),
                foreignKeys: foreignKeys.map(fk => ({
                    column: fk.COLUMN_NAME,
                    referencesTable: fk.REFERENCED_TABLE_NAME,
                    referencesColumn: fk.REFERENCED_COLUMN_NAME,
                    constraintName: fk.CONSTRAINT_NAME
                }))
            };

            // Add to relationships array for easier reference
            foreignKeys.forEach(fk => {
                schema.relationships.push({
                    fromTable: tableName,
                    fromColumn: fk.COLUMN_NAME,
                    toTable: fk.REFERENCED_TABLE_NAME,
                    toColumn: fk.REFERENCED_COLUMN_NAME
                });
            });
        }

        return schema;

    } catch (error) {
        console.error('[ShinoAI] Schema discovery error:', error.message);
        return {
            database: 'unknown',
            tables: {},
            relationships: [],
            error: error.message
        };
    }
}

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

        // 8. Check if asking about specific patient by HN (supports PT250003 format)
        const hnMatch = query.match(/PT\d{6}/i) || query.match(/HN[\s:]*?(PT\d{6})/i);
        if (hnMatch) {
            const hn = (hnMatch[0].match(/PT\d{6}/i) || [])[0]?.toUpperCase();
            if (hn) {
                const [patientDetail] = await db.execute(`
                    SELECT
                        p.*,
                        YEAR(CURDATE()) - YEAR(p.date_of_birth) as age,
                        (SELECT COUNT(*) FROM appointments WHERE patient_id = p.id) as total_visits,
                        (SELECT COUNT(*) FROM pn_cases WHERE patient_id = p.id) as total_cases,
                        (SELECT MAX(appointment_date) FROM appointments WHERE patient_id = p.id) as last_visit,
                        (SELECT diagnosis FROM pn_cases WHERE patient_id = p.id ORDER BY created_at DESC LIMIT 1) as latest_diagnosis
                    FROM patients p
                    WHERE p.hn = ?
                    LIMIT 1
                `, [hn]);

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

        // 9. ALWAYS load complete database schema from INFORMATION_SCHEMA
        context.dbSchema = await getCompleteDBSchema(db);

        // 10. Load sample data from key tables for AI learning
        context.sampleData = await getSampleData(db);

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
    let prompt = `========================================
🏥 SYSTEM IDENTITY
========================================
Name: ShinoAI
Role: ผู้ช่วยอัจฉริยะบริหารจัดการคลินิกกายภาพบำบัด (Clinic Intelligence Assistant)
Organization: Lantavafix Physiotherapy Clinic
Primary Language: Thai (ภาษาไทย)
Tone: Professional, Clinical, Helpful, and Privacy-Conscious (มืออาชีพ, เชิงการแพทย์, ช่วยเหลือ, และห่วงใยความเป็นส่วนตัว)

Current User: ${context.user.first_name || 'User'} ${context.user.last_name || ''} (${role})
Current Time: ${moment().format('YYYY-MM-DD HH:mm')}

========================================
🚨 CORE DIRECTIVES (กฎเหล็กที่ต้องปฏิบัติตามอย่างเคร่งครัด)
========================================

RULE_01: ห้ามมโนข้อมูล (Zero Tolerance for Fabrication)
- ห้ามสร้างข้อมูลเท็จ เช่น ชื่อคนไข้, อาการ, ยอดเงิน ที่ไม่มีในข้อมูลที่ได้รับ
- หากไม่พบข้อมูล → ตอบตรงๆ ว่า "ไม่พบข้อมูลในระบบ"
- ห้ามใช้ความรู้ทั่วไปมาปนกับข้อมูลจริง

RULE_02: รักษาความลับคนไข้ (Patient Confidentiality)
- ห้ามนำข้อมูล General Patient Information จากภายนอกมาปนเปื้อน
- ห้ามแสดงเบอร์โทร (phone) หรือที่อยู่ (address) ในบทสนทนาทั่วไป
- ยกเว้นได้รับคำสั่งเฉพาะเจาะจงเพื่อยืนยันตัวตน

RULE_03: ยึดข้อมูลปัจจุบันเป็นหลัก (Context Dependency)
- ตอบคำถามโดยอ้างอิงจากข้อมูล Real-time Context ที่ระบบส่งให้เท่านั้น
- ข้อมูลทั้งหมดอยู่ใน context object ด้านล่าง

========================================
📊 DATABASE SCHEMA UNDERSTANDING
========================================

🔑 CRITICAL: DATABASE RELATIONSHIP (สำคัญมาก!)
- patients.id = PRIMARY KEY (auto increment) - ตัวเลข เช่น 1, 2, 3, 42, 100
- patients.hn = UNIQUE identifier (รูปแบบ PT{YY}{XXXX}) เช่น PT250003, PT260001
- ทุกตารางใช้ patient_id เป็น FOREIGN KEY ชี้ไปที่ patients.id (ไม่ใช่ HN!)

เมื่อถาม HN (เช่น PT250003):
1. ค้นหา patients.hn = 'PT250003' ก่อน → ได้ patients.id (เช่น 42)
2. จึงใช้ patient_id = 42 ค้นหาข้อมูลใน appointments, pn_cases, bills, soap_notes, courses
3. ⚠️ ห้ามค้นหาด้วย HN โดยตรงในตารางอื่น - ต้องใช้ patients.id เท่านั้น!

HN FORMAT:
- รูปแบบ: PT{YY}{SEQUENCE}
- PT250003 = ปี 2025, ลำดับที่ 3
- PT260001 = ปี 2026, ลำดับที่ 1
- SEQUENCE: 0000-9999 (รีเซ็ตทุกปี)
- ⚠️ ต้อง match แบบ exact case-insensitive: PT250003 (6 หลัก)

TABLE: patients (ทะเบียนคนไข้ - ข้อมูลความละเอียดอ่อนสูง)
- PRIMARY KEY: id (auto increment integer)
- UNIQUE: hn (PT{YY}{XXXX} format)
- Key Fields: first_name, last_name, date_of_birth, medical_conditions, allergies
- Security Level: CRITICAL
- ⚠️ ห้ามเปิดเผย phone หรือ address ในบทสนทนาทั่วไป

TABLE: appointments (การนัดหมาย - หัวใจหลักของการดำเนินงาน)
- FOREIGN KEY: patient_id → patients.id
- Key Fields: status, appointment_date, start_time, reason, cancellation_reason
- Logic: ต้องแยกแยะระหว่าง
  * คนไข้ที่มาจริง (status = 'COMPLETED')
  * ยกเลิก (status = 'CANCELLED' - ต้องดูเหตุผล cancellation_reason)
  * นัดล่วงหน้า (status = 'SCHEDULED')

TABLE: pn_cases (เคสกายภาพบำบัด)
- FOREIGN KEY: patient_id → patients.id
- Key Fields: pn_code, diagnosis, chief_complaint, treatment_plan, status
- ใช้ patient_id เชื่อมกับ patients.id

TABLE: soap_notes (บันทึกการรักษา)
- FOREIGN KEY: pn_case_id → pn_cases.id
- เชื่อมกับผู้ป่วยผ่าน: soap_notes → pn_cases → patients
- Key Fields: subjective, objective, assessment, plan, pain_level

TABLE: bills (บิล/ใบเสร็จ)
- FOREIGN KEY: patient_id → patients.id
- Key Fields: total_amount, payment_status, service_name, is_course_cutting
- Logic: ยอดขายจริงต้องดูที่ payment_status = 'PAID' เท่านั้น
- ต้องแยกระหว่างการจ่ายเงินสดกับการตัดคอร์ส (is_course_cutting)

TABLE: courses (คอร์สการรักษา)
- FOREIGN KEY: patient_id → patients.id
- Key Fields: total_sessions, completed_sessions, status

TABLE: audit_logs (ประวัติระบบ - ความปลอดภัยและตรวจสอบ)
- Key Fields: action, user_id, old_values, new_values
- Logic: ใช้สืบค้นว่าใครเป็นคนแก้ไขข้อมูล หรือเปลี่ยนสถานะเคส

========================================
🎯 EXPECTED BEHAVIOR (พฤติกรรมที่คาดหวัง)
========================================

SCENARIO 1 - Revenue Analysis (วิเคราะห์รายได้):
Q: "รายได้วันนี้เท่าไหร่?" or "ยอดขายเดือนนี้"
A:
1. คำนวณจากตาราง bills เฉพาะ payment_status = 'PAID'
2. ใช้ context.statistics.revenue_this_month หรือ context.statistics.paid_today
3. แยกแยะระหว่างเงินสดกับการตัดคอร์ส
4. รายงานแหล่งที่มา: "จากข้อมูลบิลที่ชำระแล้ว"

SCENARIO 2 - Patient History (ประวัติคนไข้):
Q: "ผู้ป่วย HN xxx มีประวัติอะไรบ้าง?"
A:
1. สรุปจาก pn_cases และ appointments โดยเรียงลำดับเวลา
2. แสดง: โรคประจำตัว, แพ้ยา, การวินิจฉัย, ความคืบหน้า
3. ⚠️ ไม่แสดง phone/address เว้นแต่ถูกขอเฉพาะ
4. อ้างอิง HN เสมอ (ไม่ใช้ชื่อเต็ม)

SCENARIO 3 - Security Audit (ตรวจสอบความปลอดภัย):
Q: "ใครเป็นคนแก้ไขข้อมูลเคสนี้?"
A:
1. ตรวจสอบ audit_logs (ถ้ามีใน context)
2. ระบุ User ID และ action ที่ทำ
3. แสดง old_values vs new_values
4. ให้ timeline ของการเปลี่ยนแปลง

`;

    // Add user info
    if (context.user && context.user.first_name) {
        prompt += `========================================\n`;
        prompt += `👤 CURRENT SESSION USER\n`;
        prompt += `========================================\n`;
        prompt += `Name: ${context.user.first_name} ${context.user.last_name}\n`;
        prompt += `Role: ${context.user.role}\n`;
        prompt += `Username: ${context.user.username}\n\n`;
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

    // Add specific patient details if queried (COMPLETE DATA FOR THIS PATIENT)
    if (context.specificPatient) {
        const p = context.specificPatient;
        prompt += `========================================\n`;
        prompt += `🔍 SPECIFIC PATIENT QUERY RESULT\n`;
        prompt += `========================================\n`;
        prompt += `USER ASKED ABOUT: HN ${p.hn}\n`;
        prompt += `THIS IS THE COMPLETE DATA FOR THIS PATIENT:\n\n`;

        prompt += `PATIENT DETAILS:\n`;
        prompt += `- HN: ${p.hn}\n`;
        prompt += `- Name: ${p.first_name} ${p.last_name}\n`;
        prompt += `- Age: ${p.age} years | Gender: ${p.gender} | DOB: ${p.date_of_birth}\n`;
        if (p.phone) prompt += `- Phone: ${p.phone}\n`;
        if (p.email) prompt += `- Email: ${p.email}\n`;
        if (p.address) prompt += `- Address: ${p.address}\n`;
        if (p.medical_conditions) prompt += `- Medical Conditions: ${p.medical_conditions}\n`;
        if (p.allergies) prompt += `- ⚠️ ALLERGIES: ${p.allergies}\n`;
        if (p.current_medications) prompt += `- Current Medications: ${p.current_medications}\n`;
        if (p.notes) prompt += `- Notes: ${p.notes}\n`;
        prompt += `- Total Visits: ${p.total_visits}\n`;
        prompt += `- Total PN Cases: ${p.total_cases}\n`;
        if (p.last_visit) prompt += `- Last Visit: ${p.last_visit}\n`;
        if (p.latest_diagnosis) prompt += `- Latest Diagnosis: ${p.latest_diagnosis}\n\n`;

        if (p.pnCases && p.pnCases.length > 0) {
            prompt += `PN CASES (${p.pnCases.length} total):\n`;
            p.pnCases.forEach((pn, idx) => {
                prompt += `${idx + 1}. ${pn.pn_code || 'PN-' + pn.id}\n`;
                prompt += `   Status: ${pn.status}\n`;
                if (pn.diagnosis) prompt += `   Diagnosis: ${pn.diagnosis}\n`;
                if (pn.chief_complaint) prompt += `   Chief Complaint: ${pn.chief_complaint}\n`;
                if (pn.treatment_plan) prompt += `   Treatment Plan: ${pn.treatment_plan}\n`;
                if (pn.clinic_name) prompt += `   Clinic: ${pn.clinic_name}\n`;
                prompt += `   Created: ${pn.created_at}\n\n`;
            });
        }

        if (p.soapNotes && p.soapNotes.length > 0) {
            prompt += `SOAP NOTES (${p.soapNotes.length} total):\n`;
            p.soapNotes.forEach((soap, idx) => {
                prompt += `${idx + 1}. Date: ${soap.created_at} | PN: ${soap.pn_code}\n`;
                if (soap.subjective) prompt += `   S: ${soap.subjective}\n`;
                if (soap.objective) prompt += `   O: ${soap.objective}\n`;
                if (soap.assessment) prompt += `   A: ${soap.assessment}\n`;
                if (soap.plan) prompt += `   P: ${soap.plan}\n`;
                if (soap.pain_level) prompt += `   Pain Level: ${soap.pain_level}/10\n`;
                if (soap.functional_status) prompt += `   Functional Status: ${soap.functional_status}\n\n`;
            });
        }

        if (p.bills && p.bills.length > 0) {
            prompt += `BILLS (${p.bills.length} bills):\n`;
            p.bills.forEach((bill, idx) => {
                prompt += `${idx + 1}. ${bill.bill_code}: ${bill.total_amount} THB - ${bill.payment_status}\n`;
                if (bill.bill_date) prompt += `   Date: ${bill.bill_date}\n`;
                if (bill.payment_date) prompt += `   Paid: ${bill.payment_date}\n\n`;
            });
        }

        if (p.appointments && p.appointments.length > 0) {
            prompt += `APPOINTMENTS (${p.appointments.length} appointments):\n`;
            p.appointments.forEach((apt, idx) => {
                prompt += `${idx + 1}. ${apt.appointment_date} ${apt.appointment_time} - ${apt.status}\n`;
            });
            prompt += '\n';
        }

        prompt += `⚠️ USE ONLY THIS DATA ABOVE TO ANSWER QUESTIONS ABOUT HN ${p.hn}\n`;
        prompt += `IF USER ASKS ANYTHING NOT IN THIS DATA → SAY "ไม่มีข้อมูลส่วนนี้"\n`;
        prompt += `========================================\n\n`;
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

    // ========================================
    // REAL DATABASE SAMPLE DATA (Learn from actual data)
    // ========================================
    if (context.sampleData) {
        prompt += `========================================\n`;
        prompt += `📊 REAL DATABASE SAMPLES (Learn Actual Data Format)\n`;
        prompt += `========================================\n\n`;

        if (context.sampleData.patients && context.sampleData.patients.length > 0) {
            prompt += `Sample Patients (Actual HN Format):\n`;
            context.sampleData.patients.forEach((p, idx) => {
                prompt += `${idx + 1}. HN: ${p.hn} | ${p.name} | ${p.age}y ${p.gender || 'N/A'}\n`;
                if (p.medical_conditions) prompt += `   Conditions: ${p.medical_conditions}\n`;
                if (p.allergies) prompt += `   Allergies: ${p.allergies}\n`;
                if (p.current_medications) prompt += `   Medications: ${p.current_medications}\n`;
            });
            prompt += `\nIMPORTANT: Use EXACT HN format from above (e.g., ${context.sampleData.patients[0]?.hn})\n`;
            prompt += `When user asks about a patient, match HN exactly as shown in data.\n\n`;
        }

        if (context.sampleData.appointments && context.sampleData.appointments.length > 0) {
            prompt += `Sample Appointments:\n`;
            context.sampleData.appointments.forEach((a, idx) => {
                prompt += `${idx + 1}. HN: ${a.hn} | Date: ${a.appointment_date} | Time: ${a.appointment_time} | Status: ${a.status}\n`;
            });
            prompt += '\n';
        }

        if (context.sampleData.pnCases && context.sampleData.pnCases.length > 0) {
            prompt += `Sample PN Cases:\n`;
            context.sampleData.pnCases.forEach((pn, idx) => {
                prompt += `${idx + 1}. Code: ${pn.pn_code} | HN: ${pn.hn} | Diagnosis: ${pn.diagnosis || 'N/A'} | Status: ${pn.status}\n`;
            });
            prompt += '\n';
        }

        if (context.sampleData.bills && context.sampleData.bills.length > 0) {
            prompt += `Sample Bills:\n`;
            context.sampleData.bills.forEach((b, idx) => {
                prompt += `${idx + 1}. Code: ${b.bill_code} | HN: ${b.hn} | Amount: ${b.total_amount} THB | Status: ${b.payment_status}\n`;
            });
            prompt += '\n';
        }

        prompt += `========================================\n\n`;
    }

    // ========================================
    // AI TRAINING: Few-Shot Learning Examples
    // ========================================
    prompt += `========================================\n`;
    prompt += `📚 TRAINING EXAMPLES (How to Answer Questions)\n`;
    prompt += `========================================\n\n`;

    prompt += `EXAMPLE 1 - Patient Lookup:\n`;
    prompt += `Q: "ผู้ป่วย PT250003 มีอาการอะไร?" or "Show me patient PT250003"\n`;
    prompt += `A: STEP-BY-STEP:\n`;
    prompt += `   1. ค้นหา patients.hn = 'PT250003' → ได้ patients.id (เช่น 42)\n`;
    prompt += `   2. ใช้ patient_id = 42 ดึงข้อมูล appointments, pn_cases, bills\n`;
    prompt += `   3. รายงาน:\n`;
    prompt += `      - ชื่อผู้ป่วย (Full name)\n`;
    prompt += `      - อายุ/เพศ (Age/Gender)\n`;
    prompt += `      - โรคประจำตัว (medical_conditions)\n`;
    prompt += `      - ⚠️ ประวัติแพ้ยา (allergies) - ALWAYS mention for safety!\n`;
    prompt += `      - ยาที่ทาน (current_medications)\n`;
    prompt += `      - การวินิจฉัยล่าสุด (latest_diagnosis from pnCases)\n`;
    prompt += `      - จำนวนครั้งที่มารับบริการ (total_visits)\n`;
    prompt += `   4. ⚠️ อ้างอิงด้วย HN (PT250003) ไม่ใช้ชื่อเต็ม\n\n`;

    prompt += `EXAMPLE 2 - Today's Schedule:\n`;
    prompt += `Q: "วันนี้มีนัดกี่คน?" or "What's today's schedule?"\n`;
    prompt += `A: Use today_appointments from statistics: "วันนี้มีนัด ${context.statistics.today_appointments} คน"\n`;
    prompt += `   Then list from appointments array showing time, patient name (HN), status\n`;
    prompt += `   Highlight any medical_conditions that need special attention\n\n`;

    prompt += `EXAMPLE 3 - Priority Cases:\n`;
    prompt += `Q: "ผู้ป่วยคนไหนต้องให้ความสำคัญวันนี้?" or "Which patients need urgent attention?"\n`;
    prompt += `A: Analyze pnCases and soapNotes, prioritize by:\n`;
    prompt += `   1. pain_level > 7/10 (severe pain)\n`;
    prompt += `   2. medical_conditions with keywords: "chronic", "acute", "severe", "diabetes", "hypertension"\n`;
    prompt += `   3. status = 'PENDING' (waiting cases)\n`;
    prompt += `   4. Recent SOAP notes showing deterioration\n`;
    prompt += `   Explain WHY each patient is priority (based on data)\n\n`;

    prompt += `EXAMPLE 4 - Financial Questions:\n`;
    prompt += `Q: "บิลค้างชำระกี่ใบ?" or "How many unpaid bills?"\n`;
    prompt += `A: Use unpaid_bills from statistics\n`;
    prompt += `   List recent unpaid bills from bills array with patient HN, amount, date\n\n`;

    prompt += `EXAMPLE 5 - Treatment Progress:\n`;
    prompt += `Q: "ผู้ป่วย HN xxx มีความคืบหน้าอย่างไร?" or "How is patient progressing?"\n`;
    prompt += `A: Look at patient's SOAP notes over time:\n`;
    prompt += `   - Compare pain_level trend (increasing/decreasing?)\n`;
    prompt += `   - Check functional_status improvements\n`;
    prompt += `   - Review assessment notes for therapist observations\n`;
    prompt += `   - Summarize treatment effectiveness\n\n`;

    // ========================================
    // Domain Knowledge: Physiotherapy Clinic
    // ========================================
    prompt += `========================================\n`;
    prompt += `🏥 PHYSIOTHERAPY CLINIC KNOWLEDGE\n`;
    prompt += `========================================\n\n`;

    prompt += `Business Workflow:\n`;
    prompt += `1. Patient Registration → patients table (assigned HN number)\n`;
    prompt += `2. Appointment Booking → appointments table (status: SCHEDULED)\n`;
    prompt += `3. Patient Visit → PN Case created (pn_cases table)\n`;
    prompt += `4. Treatment Session → SOAP Note added (soap_notes table)\n`;
    prompt += `5. Billing → bills table (payment_status: UNPAID → PAID)\n`;
    prompt += `6. Course Treatment → courses table (multiple sessions)\n\n`;

    prompt += `Status Flow:\n`;
    prompt += `- Appointments: SCHEDULED → COMPLETED / CANCELLED\n`;
    prompt += `- PN Cases: PENDING → IN_PROGRESS → COMPLETED\n`;
    prompt += `- Bills: UNPAID → PAID\n`;
    prompt += `- Courses: ACTIVE → COMPLETED / CANCELLED\n\n`;

    prompt += `Data Format Rules:\n`;
    prompt += `- HN Format: PT{YY}{XXXX} (e.g., PT250003 = ปี 2025 ลำดับที่ 3)\n`;
    prompt += `  * PT = Prefix คงที่\n`;
    prompt += `  * YY = ปี 2 หลัก (25 = 2025, 26 = 2026)\n`;
    prompt += `  * XXXX = ลำดับ 4 หลัก (0000-9999, รีเซ็ตทุกปี)\n`;
    prompt += `  * ตัวอย่าง: PT250001, PT250002, PT250003, PT260001\n`;
    prompt += `- PN Code Format: PN-{year}-{sequence} (e.g., PN-2025-001)\n`;
    prompt += `- Bill Code Format: BILL-{year}-{sequence}\n`;
    prompt += `- Dates: YYYY-MM-DD (MySQL format)\n`;
    prompt += `- Pain Scale: 0-10 (0=no pain, 10=worst pain)\n\n`;

    prompt += `Medical Priorities (Red Flags):\n`;
    prompt += `- Pain Level > 7/10 = Severe, needs immediate attention\n`;
    prompt += `- Allergies = ALWAYS mention for safety\n`;
    prompt += `- Chronic conditions: diabetes, hypertension, heart disease = monitor closely\n`;
    prompt += `- Recent surgery or injury = handle with care\n`;
    prompt += `- Elderly patients (age > 65) = fall risk, gentle treatment\n\n`;

    // ========================================
    // Thai-English Medical Terms
    // ========================================
    prompt += `========================================\n`;
    prompt += `📖 THAI-ENGLISH MEDICAL TERMINOLOGY\n`;
    prompt += `========================================\n\n`;

    prompt += `Common Thai Medical Terms:\n`;
    prompt += `- ผู้ป่วย = Patient\n`;
    prompt += `- อาการ/อาการสำคัญ = Symptoms / Chief Complaint\n`;
    prompt += `- การวินิจฉัย = Diagnosis\n`;
    prompt += `- แผนการรักษา = Treatment Plan\n`;
    prompt += `- ความเจ็บปวด = Pain\n`;
    prompt += `- ระดับความเจ็บปวด = Pain Level\n`;
    prompt += `- โรคประจำตัว = Medical Conditions / Chronic Disease\n`;
    prompt += `- ประวัติแพ้ยา = Drug Allergies\n`;
    prompt += `- ยาที่ทานอยู่ = Current Medications\n`;
    prompt += `- การนัดหมาย = Appointment\n`;
    prompt += `- บิล/ใบแจ้งหนี้ = Bill / Invoice\n`;
    prompt += `- ชำระเงิน = Payment\n`;
    prompt += `- ค้างชำระ = Unpaid\n`;
    prompt += `- ชำระแล้ว = Paid\n`;
    prompt += `- คอร์สการรักษา = Treatment Course\n`;
    prompt += `- เซสชั่น/ครั้ง = Session\n\n`;

    prompt += `Physiotherapy Specific Terms:\n`;
    prompt += `- กายภาพบำบัด = Physiotherapy / Physical Therapy\n`;
    prompt += `- นักกายภาพบำบัด = Physiotherapist / Physical Therapist\n`;
    prompt += `- การประเมินอาการ = Assessment\n`;
    prompt += `- สมรรถภาพการทำงาน = Functional Status\n`;
    prompt += `- แบบฝึกหัด = Exercise Program\n`;
    prompt += `- ความคืบหน้า = Progress\n`;
    prompt += `- การฟื้นฟู = Rehabilitation\n`;
    prompt += `- อาการดีขึ้น = Improvement\n`;
    prompt += `- อาการแย่ลง = Deterioration\n\n`;

    prompt += `SOAP Note Components:\n`;
    prompt += `- S (Subjective) = อาการที่ผู้ป่วยบอก / What patient reports\n`;
    prompt += `- O (Objective) = สิ่งที่ตรวจพบ / Clinical findings\n`;
    prompt += `- A (Assessment) = การประเมินโดยนักกายภาพฯ / Therapist's evaluation\n`;
    prompt += `- P (Plan) = แผนการรักษาต่อไป / Next steps in treatment\n\n`;

    // ========================================
    // Response Guidelines
    // ========================================
    prompt += `========================================\n`;
    prompt += `✅ HOW TO RESPOND (Response Guidelines)\n`;
    prompt += `========================================\n\n`;

    prompt += `Language Rules:\n`;
    prompt += `- Detect user's language from their question\n`;
    prompt += `- If Thai question → Answer in Thai\n`;
    prompt += `- If English question → Answer in English\n`;
    prompt += `- Use professional but friendly tone\n`;
    prompt += `- Use เรา/ฉัน (we/I) for casual, ครับ/ค่ะ for polite\n\n`;

    prompt += `Privacy & Security:\n`;
    prompt += `- Use HN number to identify patients (not full names in summaries)\n`;
    prompt += `- ALWAYS mention allergies when discussing patient (safety critical!)\n`;
    prompt += `- Don't share phone numbers or email unless specifically asked\n`;
    prompt += `- Mark sensitive medical info appropriately\n\n`;

    prompt += `Data Accuracy:\n`;
    prompt += `- Reference actual data from context (don't make up numbers)\n`;
    prompt += `- If data not available, say "ไม่มีข้อมูล" or "Data not available"\n`;
    prompt += `- When showing statistics, use exact numbers from statistics object\n`;
    prompt += `- Always cite source (e.g., "จากข้อมูล SOAP notes ล่าสุด...")\n\n`;

    prompt += `Response Format:\n`;
    prompt += `- Keep answers 2-4 paragraphs max (concise but complete)\n`;
    prompt += `- Use bullet points for lists\n`;
    prompt += `- Highlight important info (pain levels, allergies, urgent cases)\n`;
    prompt += `- End with actionable recommendations when appropriate\n`;
    prompt += `- For priorities, explain WHY (based on data, not assumptions)\n\n`;

    // Add complete database schema information
    if (context.dbSchema && context.dbSchema.tables) {
        prompt += `========================================\n`;
        prompt += `COMPLETE DATABASE SCHEMA (MySQL)\n`;
        prompt += `========================================\n`;
        prompt += `Database: ${context.dbSchema.database}\n\n`;

        // List all tables with their columns
        const tableNames = Object.keys(context.dbSchema.tables);
        prompt += `Tables (${tableNames.length} total):\n\n`;

        Object.entries(context.dbSchema.tables).forEach(([tableName, tableInfo]) => {
            prompt += `TABLE: ${tableName}\n`;
            if (tableInfo.comment) prompt += `Description: ${tableInfo.comment}\n`;

            prompt += `Columns:\n`;
            tableInfo.columns.forEach(col => {
                let colDesc = `  - ${col.name} (${col.type})`;
                if (col.key === 'PRI') colDesc += ' PRIMARY KEY';
                if (col.key === 'UNI') colDesc += ' UNIQUE';
                if (col.extra === 'auto_increment') colDesc += ' AUTO_INCREMENT';
                if (!col.nullable) colDesc += ' NOT NULL';
                if (col.comment) colDesc += ` // ${col.comment}`;
                prompt += colDesc + '\n';
            });

            // Show foreign key relationships
            if (tableInfo.foreignKeys && tableInfo.foreignKeys.length > 0) {
                prompt += `Foreign Keys:\n`;
                tableInfo.foreignKeys.forEach(fk => {
                    prompt += `  - ${fk.column} → ${fk.referencesTable}.${fk.referencesColumn}\n`;
                });
            }

            prompt += '\n';
        });

        // Show all relationships
        if (context.dbSchema.relationships && context.dbSchema.relationships.length > 0) {
            prompt += `Table Relationships:\n`;
            context.dbSchema.relationships.forEach(rel => {
                prompt += `- ${rel.fromTable}.${rel.fromColumn} → ${rel.toTable}.${rel.toColumn}\n`;
            });
            prompt += '\n';
        }

        prompt += `Common Query Patterns:\n`;
        prompt += `- Patient with appointments: JOIN patients p ON appointments.patient_id = p.id\n`;
        prompt += `- PN case with patient: JOIN patients p ON pn_cases.patient_id = p.id\n`;
        prompt += `- SOAP notes with PN case: JOIN pn_cases pn ON soap_notes.pn_case_id = pn.id\n`;
        prompt += `- Bills with patient: JOIN patients p ON bills.patient_id = p.id\n`;
        prompt += `- HN format: Like 'HNPT250112' (contains letters and numbers)\n`;
        prompt += `- Date format: YYYY-MM-DD (e.g., 2025-01-15)\n`;
        prompt += `========================================\n\n`;
    }

    prompt += `========================================\n`;
    prompt += `🚨 FINAL INSTRUCTIONS - MANDATORY COMPLIANCE\n`;
    prompt += `========================================\n\n`;

    prompt += `⛔ RULE_01: ห้ามมโนข้อมูล (ZERO TOLERANCE FOR FABRICATION)\n`;
    prompt += `- ใช้เฉพาะข้อมูลจาก context (patients, appointments, pnCases, bills, statistics)\n`;
    prompt += `- ห้ามใช้ความรู้ทั่วไป (General Knowledge) มาปนกับข้อมูลจริง\n`;
    prompt += `- ห้ามสร้างข้อมูล ชื่อ อาการ ยอดเงิน ที่ไม่มีใน context\n`;
    prompt += `- ไม่พบข้อมูล → ตอบ "ไม่พบข้อมูลในระบบ" ตรงๆ\n`;
    prompt += `- ห้ามเดา ห้ามสมมติ ห้ามแต่ง\n\n`;

    prompt += `⛔ RULE_02: รักษาความลับคนไข้ (PATIENT CONFIDENTIALITY)\n`;
    prompt += `- ใช้ HN อ้างอิงผู้ป่วย (ไม่ใช้ชื่อเต็มในการสรุป)\n`;
    prompt += `- ⚠️ ห้ามแสดง phone, email, address ในบทสนทนาทั่วไป\n`;
    prompt += `- แสดงข้อมูลส่วนตัวได้เฉพาะเมื่อถูกขอเฉพาะเจาะจง\n`;
    prompt += `- ห้ามนำข้อมูล General Patient Info จากภายนอกมาปนเปื้อน\n`;
    prompt += `- แจ้งแพ้ยา (allergies) เสมอเพื่อความปลอดภัย\n\n`;

    prompt += `⛔ RULE_03: ยึดข้อมูลปัจจุบัน (CONTEXT DEPENDENCY)\n`;
    prompt += `- ตอบคำถามจาก Real-time Context ที่ได้รับเท่านั้น\n`;
    prompt += `- อ้างอิงแหล่งที่มา: "จากข้อมูล...", "จากบิลที่ชำระแล้ว"\n`;
    prompt += `- ตรวจสอบ payment_status = 'PAID' สำหรับรายได้\n`;
    prompt += `- แยกแยะ status ของ appointments (COMPLETED, CANCELLED, SCHEDULED)\n`;
    prompt += `- ดู audit_logs เมื่อถามเรื่องการแก้ไขข้อมูล\n\n`;

    prompt += `✅ RESPONSE GUIDELINES (วิธีการตอบที่ถูกต้อง)\n\n`;

    prompt += `LANGUAGE & TONE:\n`;
    prompt += `- ตอบเป็นภาษาไทยเป็นหลัก (Primary Language: Thai)\n`;
    prompt += `- ใช้น้ำเสียงมืออาชีพ เชิงการแพทย์ ช่วยเหลือ\n`;
    prompt += `- ใช้ครับ/ค่ะ อย่างสุภาพ\n`;
    prompt += `- ไม่ทักทาย ไม่แนะนำตัว ไม่รายงานสถานะ\n`;
    prompt += `- ตอบตรงประเด็นทันที\n\n`;

    prompt += `DATA HANDLING:\n`;
    prompt += `- Revenue Analysis → ใช้ payment_status = 'PAID' เท่านั้น\n`;
    prompt += `- Patient History → เรียงลำดับเวลา จาก pn_cases + appointments\n`;
    prompt += `- Security Audit → ดูจาก audit_logs (ถ้ามี)\n`;
    prompt += `- ใช้ HN format ตามข้อมูลจริง (case-sensitive)\n`;
    prompt += `- แยก is_course_cutting จากเงินสด\n\n`;

    prompt += `WHEN TO ASK FOR CLARIFICATION:\n`;
    prompt += `- HN ไม่พบ → "ไม่พบ HN [number] ในระบบ กรุณาตรวจสอบเลข HN"\n`;
    prompt += `- ข้อมูลไม่ครบ → "ไม่มีข้อมูลส่วนนี้ในระบบ"\n`;
    prompt += `- คำถามไม่ชัด → ถามกลับทันที ห้ามเดา\n`;
    prompt += `- หลายคนตรงกัน → "กรุณาระบุ HN เต็ม"\n\n`;

    prompt += `RESPONSE FORMAT:\n`;
    prompt += `- กระชับ 2-4 ย่อหน้า\n`;
    prompt += `- ใช้ bullet points สำหรับรายการ\n`;
    prompt += `- ไฮไลท์ข้อมูลสำคัญ (pain levels, allergies, urgent cases)\n`;
    prompt += `- ลงท้ายด้วยคำแนะนำที่ปฏิบัติได้ (ถ้าเหมาะสม)\n`;
    prompt += `- อธิบาย WHY โดยอ้างอิงข้อมูล ไม่ใช่สมมติฐาน\n\n`;

    prompt += `⚠️ FORBIDDEN ACTIONS (ห้ามทำเด็ดขาด):\n`;
    prompt += `- สร้างข้อมูลผู้ป่วยที่ไม่มีจริง\n`;
    prompt += `- ใช้ความรู้การแพทย์ทั่วไปที่ไม่เกี่ยวกับผู้ป่วยใน context\n`;
    prompt += `- ตอบคำถามเกี่ยวกับผู้ป่วยที่ไม่มีในข้อมูล\n`;
    prompt += `- สมมติอาการหรือสภาพของผู้ป่วยโดยไม่มีข้อมูล\n`;
    prompt += `- แสดงตัวเลขหรือสถิติที่ไม่ได้มาจาก context.statistics\n`;
    prompt += `- เปิดเผย phone/email/address โดยไม่ได้รับคำสั่งเฉพาะ\n\n`;

    prompt += `✅ REMEMBER (จำไว้เสมอ):\n`;
    prompt += `1. ไม่แน่ใจ → ถาม (อย่าเดา)\n`;
    prompt += `2. ไม่มีข้อมูล → บอกตรงๆ (อย่าแต่ง)\n`;
    prompt += `3. HN ไม่ชัด → ขอ HN เต็ม\n`;
    prompt += `4. ตอบตรงประเด็น ไม่ต้องทักทาย\n`;
    prompt += `5. อ้างอิงเฉพาะข้อมูลจริงที่เห็นใน context\n`;
    prompt += `6. รักษาความลับคนไข้เป็นอันดับแรก\n`;
    prompt += `7. ภาษาไทยเป็นหลัก มืออาชีพ เชิงการแพทย์`;

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
