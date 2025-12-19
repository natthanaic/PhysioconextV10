const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// =======================================================================
// 🔧 CONFIGURATION
// =======================================================================
const MANUAL_CONFIG = {
    apiKey: 'AIzaSyAAD5JRfykE_7sz53Vsw4VGeriHZcEuQ68',
    model: 'gemini-2.0-flash-exp',
    forceEnable: true
};

// =======================================================================
// 📋 TOOLS DEFINITION - บอก AI ว่ามีฟังก์ชันอะไรให้เรียกใช้บ้าง
// =======================================================================
const toolsDefinition = [
    {
        functionDeclarations: [
            {
                name: "search_patients",
                description: "ค้นหาผู้ป่วยจาก HN, ชื่อ, นามสกุล, หรือเลขบางส่วน (เช่น PT250112, 250112, ชื่อสมชาย)",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        keyword: {
                            type: "STRING",
                            description: "HN (เช่น PT250112), เลข 6 หลัก (เช่น 250112), ชื่อ, หรือนามสกุล"
                        }
                    },
                    required: ["keyword"]
                }
            },
            {
                name: "get_patient_full_details",
                description: "ดึงข้อมูลเต็มของผู้ป่วย 1 คน รวม appointments, bills, pn_cases, soap_notes",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        patient_id: {
                            type: "INTEGER",
                            description: "ID ของผู้ป่วยจากฐานข้อมูล (ต้องค้นหาก่อนเพื่อได้ ID)"
                        }
                    },
                    required: ["patient_id"]
                }
            },
            {
                name: "get_today_appointments",
                description: "ดูรายการนัดหมายวันนี้ทั้งหมด",
                parameters: {
                    type: "OBJECT",
                    properties: {}
                }
            },
            {
                name: "get_revenue_today",
                description: "ดูรายได้วันนี้ (เฉพาะบิลที่ชำระแล้ว)",
                parameters: {
                    type: "OBJECT",
                    properties: {}
                }
            },
            {
                name: "get_revenue_this_month",
                description: "ดูรายได้เดือนนี้ทั้งหมด",
                parameters: {
                    type: "OBJECT",
                    properties: {}
                }
            },
            {
                name: "get_pending_pn_cases",
                description: "ดูเคสกายภาพบำบัดที่รอดำเนินการ (status = PENDING)",
                parameters: {
                    type: "OBJECT",
                    properties: {}
                }
            },
            {
                name: "get_unpaid_bills",
                description: "ดูบิลที่ยังไม่ได้ชำระเงิน",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        limit: { type: "INTEGER", description: "จำนวนบิลที่ต้องการดึง (default 10)" }
                    }
                }
            }
        ]
    }
];

// =======================================================================
// 🛠️ TOOLS IMPLEMENTATION - ฟังก์ชันจริงที่ทำงานกับ Database
// =======================================================================

async function search_patients(db, args) {
    try {
        const keyword = args.keyword;

        // Search with LIKE for flexible matching
        const [rows] = await db.execute(`
            SELECT
                id,
                hn,
                CONCAT(first_name, ' ', last_name) as full_name,
                first_name,
                last_name,
                YEAR(CURDATE()) - YEAR(date_of_birth) as age,
                gender,
                phone,
                medical_conditions,
                allergies
            FROM patients
            WHERE hn LIKE ?
               OR first_name LIKE ?
               OR last_name LIKE ?
               OR CONCAT(first_name, ' ', last_name) LIKE ?
            ORDER BY hn DESC
            LIMIT 10
        `, [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`]);

        if (rows.length === 0) {
            return {
                success: false,
                message: `ไม่พบผู้ป่วยที่มีรหัสหรือชื่อ "${keyword}"`,
                count: 0,
                patients: []
            };
        }

        return {
            success: true,
            count: rows.length,
            message: rows.length === 1
                ? `พบผู้ป่วย 1 ราย`
                : `พบผู้ป่วย ${rows.length} รายที่ตรงกับ "${keyword}"`,
            patients: rows.map(p => ({
                id: p.id,
                hn: p.hn,
                name: p.full_name,
                age: p.age,
                gender: p.gender,
                phone: p.phone,
                medical_conditions: p.medical_conditions,
                allergies: p.allergies
            }))
        };
    } catch (error) {
        console.error('[search_patients] Error:', error);
        return { success: false, error: error.message };
    }
}

async function get_patient_full_details(db, args) {
    try {
        const patientId = args.patient_id;

        // 1. Patient basic info
        const [patients] = await db.execute(`
            SELECT
                id, hn,
                CONCAT(first_name, ' ', last_name) as full_name,
                first_name, last_name,
                date_of_birth,
                YEAR(CURDATE()) - YEAR(date_of_birth) as age,
                gender, phone, email, address,
                medical_conditions, allergies, current_medications, notes
            FROM patients
            WHERE id = ?
        `, [patientId]);

        if (patients.length === 0) {
            return { success: false, message: `ไม่พบผู้ป่วย ID ${patientId}` };
        }

        const patient = patients[0];

        // 2. Appointments
        const [appointments] = await db.execute(`
            SELECT
                appointment_date, start_time, end_time,
                status, reason, cancellation_reason
            FROM appointments
            WHERE patient_id = ?
            ORDER BY appointment_date DESC
            LIMIT 10
        `, [patientId]);

        // 3. PN Cases
        const [pnCases] = await db.execute(`
            SELECT
                pn.id, pn.pn_code, pn.diagnosis, pn.chief_complaint,
                pn.treatment_plan, pn.status, pn.created_at,
                c.name as clinic_name
            FROM pn_cases pn
            LEFT JOIN clinics c ON pn.clinic_id = c.id
            WHERE pn.patient_id = ?
            ORDER BY pn.created_at DESC
            LIMIT 10
        `, [patientId]);

        // 4. SOAP Notes
        const [soapNotes] = await db.execute(`
            SELECT
                s.id, s.subjective, s.objective, s.assessment, s.plan,
                s.pain_level, s.functional_status, s.created_at,
                pn.pn_code, pn.diagnosis
            FROM soap_notes s
            LEFT JOIN pn_cases pn ON s.pn_case_id = pn.id
            WHERE pn.patient_id = ?
            ORDER BY s.created_at DESC
            LIMIT 10
        `, [patientId]);

        // 5. Bills
        const [bills] = await db.execute(`
            SELECT
                bill_code, total_amount, payment_status,
                bill_date, payment_date, service_name,
                is_course_cutting
            FROM bills
            WHERE patient_id = ?
            ORDER BY created_at DESC
            LIMIT 10
        `, [patientId]);

        return {
            success: true,
            patient: {
                ...patient,
                total_appointments: appointments.length,
                total_pn_cases: pnCases.length,
                total_soap_notes: soapNotes.length,
                total_bills: bills.length
            },
            appointments,
            pn_cases: pnCases,
            soap_notes: soapNotes,
            bills
        };

    } catch (error) {
        console.error('[get_patient_full_details] Error:', error);
        return { success: false, error: error.message };
    }
}

async function get_today_appointments(db) {
    try {
        const [rows] = await db.execute(`
            SELECT
                a.id, a.appointment_date, a.start_time, a.end_time,
                a.status, a.reason,
                CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                p.hn, p.phone
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            WHERE DATE(a.appointment_date) = CURDATE()
            ORDER BY a.start_time ASC
        `);

        return {
            success: true,
            date: new Date().toISOString().split('T')[0],
            count: rows.length,
            appointments: rows
        };
    } catch (error) {
        console.error('[get_today_appointments] Error:', error);
        return { success: false, error: error.message };
    }
}

async function get_revenue_today(db) {
    try {
        const [rows] = await db.execute(`
            SELECT
                COUNT(*) as total_bills,
                SUM(total_amount) as total_revenue,
                SUM(CASE WHEN is_course_cutting = 1 THEN total_amount ELSE 0 END) as revenue_from_courses,
                SUM(CASE WHEN is_course_cutting = 0 THEN total_amount ELSE 0 END) as revenue_from_cash
            FROM bills
            WHERE payment_status = 'PAID'
              AND DATE(payment_date) = CURDATE()
        `);

        return {
            success: true,
            date: new Date().toISOString().split('T')[0],
            total_bills: rows[0].total_bills || 0,
            total_revenue: rows[0].total_revenue || 0,
            revenue_from_courses: rows[0].revenue_from_courses || 0,
            revenue_from_cash: rows[0].revenue_from_cash || 0
        };
    } catch (error) {
        console.error('[get_revenue_today] Error:', error);
        return { success: false, error: error.message };
    }
}

async function get_revenue_this_month(db) {
    try {
        const [rows] = await db.execute(`
            SELECT
                COUNT(*) as total_bills,
                SUM(total_amount) as total_revenue,
                SUM(CASE WHEN is_course_cutting = 1 THEN total_amount ELSE 0 END) as revenue_from_courses,
                SUM(CASE WHEN is_course_cutting = 0 THEN total_amount ELSE 0 END) as revenue_from_cash
            FROM bills
            WHERE payment_status = 'PAID'
              AND MONTH(payment_date) = MONTH(CURDATE())
              AND YEAR(payment_date) = YEAR(CURDATE())
        `);

        return {
            success: true,
            month: new Date().toISOString().substring(0, 7),
            total_bills: rows[0].total_bills || 0,
            total_revenue: rows[0].total_revenue || 0,
            revenue_from_courses: rows[0].revenue_from_courses || 0,
            revenue_from_cash: rows[0].revenue_from_cash || 0
        };
    } catch (error) {
        console.error('[get_revenue_this_month] Error:', error);
        return { success: false, error: error.message };
    }
}

async function get_pending_pn_cases(db) {
    try {
        const [rows] = await db.execute(`
            SELECT
                pn.id, pn.pn_code, pn.diagnosis, pn.chief_complaint,
                pn.created_at,
                CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                p.hn,
                c.name as clinic_name
            FROM pn_cases pn
            LEFT JOIN patients p ON pn.patient_id = p.id
            LEFT JOIN clinics c ON pn.clinic_id = c.id
            WHERE pn.status = 'PENDING'
            ORDER BY pn.created_at DESC
            LIMIT 20
        `);

        return {
            success: true,
            count: rows.length,
            cases: rows
        };
    } catch (error) {
        console.error('[get_pending_pn_cases] Error:', error);
        return { success: false, error: error.message };
    }
}

async function get_unpaid_bills(db, args) {
    try {
        const limit = args.limit || 10;

        const [rows] = await db.execute(`
            SELECT
                b.bill_code, b.total_amount, b.bill_date, b.service_name,
                CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                p.hn, p.phone
            FROM bills b
            LEFT JOIN patients p ON b.patient_id = p.id
            WHERE b.payment_status = 'UNPAID'
            ORDER BY b.bill_date DESC
            LIMIT ?
        `, [limit]);

        const [summary] = await db.execute(`
            SELECT
                COUNT(*) as total_unpaid_bills,
                SUM(total_amount) as total_unpaid_amount
            FROM bills
            WHERE payment_status = 'UNPAID'
        `);

        return {
            success: true,
            total_unpaid_bills: summary[0].total_unpaid_bills || 0,
            total_unpaid_amount: summary[0].total_unpaid_amount || 0,
            bills: rows
        };
    } catch (error) {
        console.error('[get_unpaid_bills] Error:', error);
        return { success: false, error: error.message };
    }
}

// =======================================================================
// 🔄 TOOL EXECUTOR - เรียกฟังก์ชันที่ถูกต้องตาม AI request
// =======================================================================
async function executeTool(db, functionName, args) {
    console.log(`[executeTool] Calling: ${functionName}`, args);

    switch (functionName) {
        case "search_patients":
            return await search_patients(db, args);
        case "get_patient_full_details":
            return await get_patient_full_details(db, args);
        case "get_today_appointments":
            return await get_today_appointments(db);
        case "get_revenue_today":
            return await get_revenue_today(db);
        case "get_revenue_this_month":
            return await get_revenue_this_month(db);
        case "get_pending_pn_cases":
            return await get_pending_pn_cases(db);
        case "get_unpaid_bills":
            return await get_unpaid_bills(db, args);
        default:
            return { success: false, error: `Unknown function: ${functionName}` };
    }
}

// =======================================================================
// 📝 SYSTEM PROMPT - บอก AI ว่าเธอคือใคร และทำงานอย่างไร
// =======================================================================
function buildSystemPrompt() {
    return `========================================
🏥 SYSTEM IDENTITY
========================================
Name: ShinoAI
Role: ผู้ช่วยอัจฉริยะบริหารจัดการคลินิกกายภาพบำบัด (Clinic Intelligence Assistant)
Organization: Lantavafix Physiotherapy Clinic
Primary Language: Thai (ภาษาไทย)
Tone: Professional, Clinical, Helpful, and Privacy-Conscious

========================================
🚨 CORE DIRECTIVES (กฎเหล็กที่ต้องปฏิบัติตามอย่างเคร่งครัด)
========================================

RULE_01: ห้ามมโนข้อมูล (Zero Tolerance for Fabrication)
- ห้ามสร้างข้อมูลเท็จ เช่น ชื่อคนไข้, อาการ, ยอดเงิน ที่ไม่มีในข้อมูลที่ได้รับ
- หากไม่พบข้อมูล → ตอบตรงๆ ว่า "ไม่พบข้อมูลในระบบ"
- ห้ามใช้ความรู้ทั่วไปมาปนกับข้อมูลจริง

RULE_02: รักษาความลับคนไข้ (Patient Confidentiality)
- ห้ามแสดงเบอร์โทร (phone) หรือที่อยู่ (address) ในบทสนทนาทั่วไป
- ยกเว้นได้รับคำสั่งเฉพาะเจาะจงเพื่อยืนยันตัวตน

RULE_03: ใช้ Function Calling เสมอ (Always Use Functions)
- เมื่อ user ถามเกี่ยวกับข้อมูล → เรียก function ที่เหมาะสมทันที
- ห้ามตอบจากความจำหรือการเดา
- ต้องค้นหาข้อมูลจากฐานข้อมูลจริงเสมอ

========================================
🔑 DATABASE UNDERSTANDING
========================================

HN FORMAT:
- รูปแบบ: PT{YY}{SEQUENCE}
- ตัวอย่าง: PT250003, PT250112, PT260009
- SEQUENCE: เริ่มจาก 0001 และนับต่อเนื่อง (ไม่รีเซ็ตตามปี)
- YY = ปี 2 หลัก (25 = 2025, 26 = 2026)

DATABASE RELATIONSHIPS:
- patients.id = PRIMARY KEY (ตัวเลข เช่น 1, 2, 42, 100)
- patients.hn = UNIQUE (รูปแบบ PT250003)
- ทุกตารางใช้ patient_id → patients.id เป็น FOREIGN KEY

TABLES:
- patients: ข้อมูลผู้ป่วย
- appointments: การนัดหมาย
- pn_cases: เคสกายภาพบำบัด
- soap_notes: บันทึกการรักษา
- bills: บิล/ใบเสร็จ
- courses: คอร์สการรักษา

========================================
📋 HOW TO USE FUNCTIONS
========================================

SCENARIO 1: ค้นหาผู้ป่วย
Q: "ข้อมูล PT250112" หรือ "ผู้ป่วยชื่อสมชาย"
A:
1. เรียก search_patients(keyword="PT250112") หรือ search_patients(keyword="สมชาย")
2. ถ้าเจอ 1 คน → เรียกต่อ get_patient_full_details(patient_id=X)
3. ถ้าเจอหลายคน → แสดงรายชื่อให้ user เลือก
4. ถ้าไม่เจอ → บอกว่า "ไม่พบข้อมูล"

SCENARIO 2: รายได้
Q: "รายได้วันนี้เท่าไหร่?"
A: เรียก get_revenue_today()

SCENARIO 3: นัดหมายวันนี้
Q: "วันนี้มีนัดกี่คน?"
A: เรียก get_today_appointments()

SCENARIO 4: เคสที่รอ
Q: "มีเคสไหนรออยู่บ้าง?"
A: เรียก get_pending_pn_cases()

========================================
⚠️ IMPORTANT NOTES
========================================

1. เมื่อ user ถามเกี่ยวกับผู้ป่วย → ต้อง search_patients ก่อนเสมอ
2. ได้ patient_id แล้ว → ใช้ get_patient_full_details เพื่อดูข้อมูลเต็ม
3. ห้ามแสดง phone/address เว้นแต่ user ขอเฉพาะเจาะจง
4. ตอบเป็นภาษาไทย มืออาชีพ กระชับ ชัดเจน
5. ถ้าไม่แน่ใจ → เรียก function เพื่อยืนยันข้อมูล

========================================`;
}

// =======================================================================
// 🚀 MAIN CHAT ENDPOINT
// =======================================================================
router.post('/chat', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // 1. Get API Key
        const apiKey = MANUAL_CONFIG.apiKey;
        if (!apiKey) {
            return res.status(400).json({ error: 'AI API key not configured.' });
        }

        // 2. Initialize Gemini with Function Calling
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: MANUAL_CONFIG.model,
            tools: toolsDefinition,
        });

        // 3. Start Chat with System Prompt
        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: buildSystemPrompt() }],
                },
                {
                    role: "model",
                    parts: [{ text: "เข้าใจครับ ผมคือ ShinoAI ผู้ช่วยคลินิกกายภาพบำบัด Lantavafix พร้อมค้นหาข้อมูลผู้ป่วยและตอบคำถามด้วย function calling ครับ" }],
                }
            ],
        });

        // 4. Send User Message
        console.log('[ShinoAI-RAG] User Question:', message);
        let result = await chat.sendMessage(message);
        let response = result.response;

        // 5. Function Calling Loop (อาจเรียกหลาย function ติดกัน)
        const MAX_ITERATIONS = 5;
        let iteration = 0;

        while (response.functionCalls && response.functionCalls().length > 0 && iteration < MAX_ITERATIONS) {
            iteration++;
            const functionCalls = response.functionCalls();
            console.log(`[ShinoAI-RAG] Iteration ${iteration}: AI requests ${functionCalls.length} function(s)`);

            const functionResponses = [];

            for (const call of functionCalls) {
                console.log(`[ShinoAI-RAG] Executing: ${call.name}`, call.args);

                // Execute the function
                const apiResponse = await executeTool(db, call.name, call.args);

                // Collect response
                functionResponses.push({
                    functionResponse: {
                        name: call.name,
                        response: apiResponse
                    }
                });
            }

            // Send function results back to AI
            result = await chat.sendMessage(functionResponses);
            response = result.response;
        }

        // 6. Return Final Answer
        const finalAnswer = response.text();
        console.log('[ShinoAI-RAG] Final Answer:', finalAnswer.substring(0, 200));

        return res.json({
            response: finalAnswer,
            iterations: iteration,
            success: true
        });

    } catch (error) {
        console.error('[ShinoAI-RAG] Error:', error);
        res.status(500).json({
            error: 'AI processing failed',
            details: error.message
        });
    }
});

module.exports = router;
