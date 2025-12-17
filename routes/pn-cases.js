// routes/pn-cases.js - PN (Physiotherapy Note) Case Management Routes
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateToken, authorize, auditLog } = require('../middleware/auth');
const { generatePNCode } = require('../utils/helpers');

// ========================================
// DASHBOARD SUMMARY STATISTICS
// ========================================

// Get dashboard summary statistics
router.get('/dashboard/summary', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const now = new Date();
        const currentMonth = now.getMonth() + 1; // 1-12
        const currentYear = now.getFullYear();
        const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

        // Get CL001 clinic ID
        const [clinicResult] = await db.execute(
            `SELECT id FROM clinics WHERE code = 'CL001' LIMIT 1`
        );

        const cl001Id = clinicResult.length > 0 ? clinicResult[0].id : null;

        // Get bills paid summary (current month only)
        const [billsSummary] = await db.execute(
            `SELECT
                COUNT(*) as paid_count,
                COALESCE(SUM(total_amount), 0) as paid_amount
             FROM bills
             WHERE payment_status = 'PAID'
             AND MONTH(created_at) = ?
             AND YEAR(created_at) = ?`,
            [currentMonth, currentYear]
        );

        // Get bills today (all statuses)
        const [billsToday] = await db.execute(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(total_amount), 0) as amount
             FROM bills
             WHERE DATE(created_at) = CURDATE()`
        );

        // Get new patients this month in CL001
        const [patientsThisMonth] = await db.execute(
            `SELECT COUNT(*) as count
             FROM patients
             WHERE MONTH(created_at) = ?
             AND YEAR(created_at) = ?
             ${cl001Id ? 'AND clinic_id = ?' : ''}`,
            cl001Id ? [currentMonth, currentYear, cl001Id] : [currentMonth, currentYear]
        );

        // Get new patients last month in CL001 (for comparison)
        const [patientsLastMonth] = await db.execute(
            `SELECT COUNT(*) as count
             FROM patients
             WHERE MONTH(created_at) = ?
             AND YEAR(created_at) = ?
             ${cl001Id ? 'AND clinic_id = ?' : ''}`,
            cl001Id ? [lastMonth, lastMonthYear, cl001Id] : [lastMonth, lastMonthYear]
        );

        // Get total patients in CL001
        const [totalPatients] = await db.execute(
            `SELECT COUNT(*) as count
             FROM patients
             ${cl001Id ? 'WHERE clinic_id = ?' : ''}`,
            cl001Id ? [cl001Id] : []
        );

        const thisMonthCount = patientsThisMonth[0].count || 0;
        const lastMonthCount = patientsLastMonth[0].count || 0;
        const changeFromLastMonth = thisMonthCount - lastMonthCount;

        res.json({
            bills_paid: {
                count: billsSummary[0].paid_count || 0,
                amount: parseFloat(billsSummary[0].paid_amount) || 0
            },
            bills_today: {
                count: billsToday[0].count || 0,
                amount: parseFloat(billsToday[0].amount) || 0
            },
            patients_this_month: {
                count: thisMonthCount,
                change: changeFromLastMonth,
                month: now.toLocaleString('default', { month: 'long' }),
                year: currentYear,
                clinic: 'CL001'
            },
            total_patients: {
                count: totalPatients[0].count || 0,
                clinic: 'CL001'
            }
        });
    } catch (error) {
        console.error('Dashboard summary error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard summary' });
    }
});

// ========================================
// PN CASE MANAGEMENT ROUTES
// ========================================

// Get PN cases
router.get('/', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            status, clinic_id, from_date, to_date,
            search, page = 1, limit = 20
        } = req.query;

        const offset = (page - 1) * limit;

        // Query for PN cases with appointments
        let pnCasesQuery = `
            SELECT
                pn.id, pn.patient_id, pn.pn_code, pn.diagnosis, pn.purpose,
                pn.status, pn.created_at, pn.updated_at, pn.completed_at,
                pn.course_id,
                pn.recheck_body_part,
                pn.body_annotation_id,
                p.hn, p.first_name, p.last_name,
                sc.name as source_clinic_name,
                sc.code as source_clinic_code,
                tc.code as target_clinic_code,
                CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
                (SELECT MAX(r.created_at)
                 FROM pn_reports r
                 JOIN pn_visits v ON r.visit_id = v.id
                 WHERE v.pn_id = pn.id) as last_report_at,
                b.id as bill_id,
                (SELECT course_id
                 FROM appointments
                 WHERE pn_case_id = pn.id
                 ORDER BY appointment_date DESC, created_at DESC
                 LIMIT 1) as apt_course_id,
                (SELECT appointment_date
                 FROM appointments
                 WHERE pn_case_id = pn.id
                 ORDER BY appointment_date DESC, created_at DESC
                 LIMIT 1) as appointment_date,
                (SELECT start_time
                 FROM appointments
                 WHERE pn_case_id = pn.id
                 ORDER BY appointment_date DESC, created_at DESC
                 LIMIT 1) as appointment_start_time,
                (SELECT end_time
                 FROM appointments
                 WHERE pn_case_id = pn.id
                 ORDER BY appointment_date DESC, created_at DESC
                 LIMIT 1) as appointment_end_time,
                (SELECT booking_type
                 FROM appointments
                 WHERE pn_case_id = pn.id
                 ORDER BY appointment_date DESC, created_at DESC
                 LIMIT 1) as booking_type,
                (SELECT walk_in_name
                 FROM appointments
                 WHERE pn_case_id = pn.id
                 ORDER BY appointment_date DESC, created_at DESC
                 LIMIT 1) as walk_in_name,
                'PN_CASE' as record_type
            FROM pn_cases pn
            JOIN patients p ON pn.patient_id = p.id
            JOIN clinics sc ON pn.source_clinic_id = sc.id
            JOIN clinics tc ON pn.target_clinic_id = tc.id
            JOIN users u ON pn.created_by = u.id
            LEFT JOIN bills b ON pn.id = b.pn_case_id
            WHERE 1=1
        `;

        // Query for ALL walk-in appointments (with or without PN case)
        let walkInQuery = `
            SELECT
                apt.id, apt.patient_id,
                COALESCE(p.hn, '') as hn,
                COALESCE(p.first_name, apt.walk_in_name) as first_name,
                COALESCE(p.last_name, '') as last_name,
                c.name as source_clinic_name,
                CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
                apt.created_at,
                apt.appointment_date,
                apt.start_time as appointment_start_time,
                apt.end_time as appointment_end_time,
                apt.booking_type,
                apt.walk_in_name,
                'WALK_IN' as record_type
            FROM appointments apt
            LEFT JOIN patients p ON apt.patient_id = p.id
            JOIN clinics c ON apt.clinic_id = c.id
            JOIN users u ON apt.created_by = u.id
            WHERE apt.booking_type = 'WALK_IN'
            AND apt.status != 'CANCELLED'
        `;

        let countQuery = `
            SELECT COUNT(*) as total
            FROM pn_cases pn
            JOIN patients p ON pn.patient_id = p.id
            WHERE 1=1
        `;

        const pnParams = [];
        const walkInParams = [];
        const countParams = [];

        // Role-based filtering
        if (req.user.role === 'CLINIC') {
            if (!req.user.clinic_id) {
                return res.status(403).json({
                    error: 'CLINIC user must be assigned to a clinic'
                });
            }
            pnCasesQuery += ' AND (pn.source_clinic_id = ? OR pn.target_clinic_id = ?)';
            walkInQuery += ' AND c.id = ?';
            countQuery += ' AND (pn.source_clinic_id = ? OR pn.target_clinic_id = ?)';
            pnParams.push(req.user.clinic_id, req.user.clinic_id);
            walkInParams.push(req.user.clinic_id);
            countParams.push(req.user.clinic_id, req.user.clinic_id);
        }

        // Filter by specific clinic
        if (clinic_id) {
            pnCasesQuery += ' AND (pn.source_clinic_id = ? OR pn.target_clinic_id = ?)';
            walkInQuery += ' AND c.id = ?';
            countQuery += ' AND (pn.source_clinic_id = ? OR pn.target_clinic_id = ?)';
            pnParams.push(clinic_id, clinic_id);
            walkInParams.push(clinic_id);
            countParams.push(clinic_id, clinic_id);
        }

        // Filter by status (only for PN cases)
        if (status) {
            pnCasesQuery += ' AND pn.status = ?';
            countQuery += ' AND pn.status = ?';
            pnParams.push(status);
            countParams.push(status);
        } else {
            pnCasesQuery += ' AND pn.status != ?';
            countQuery += ' AND pn.status != ?';
            pnParams.push('CANCELLED');
            countParams.push('CANCELLED');
        }

        // Date range filter
        if (from_date) {
            pnCasesQuery += ` AND COALESCE(
                (SELECT appointment_date FROM appointments WHERE pn_case_id = pn.id ORDER BY appointment_date DESC, created_at DESC LIMIT 1),
                DATE(pn.created_at)
            ) >= ?`;
            walkInQuery += ' AND apt.appointment_date >= ?';
            countQuery += ' AND DATE(pn.created_at) >= ?';
            pnParams.push(from_date);
            walkInParams.push(from_date);
            countParams.push(from_date);
        }

        if (to_date) {
            pnCasesQuery += ` AND COALESCE(
                (SELECT appointment_date FROM appointments WHERE pn_case_id = pn.id ORDER BY appointment_date DESC, created_at DESC LIMIT 1),
                DATE(pn.created_at)
            ) <= ?`;
            walkInQuery += ' AND apt.appointment_date <= ?';
            countQuery += ' AND DATE(pn.created_at) <= ?';
            pnParams.push(to_date);
            walkInParams.push(to_date);
            countParams.push(to_date);
        }

        // Search filter
        if (search) {
            const searchPattern = `%${search}%`;
            pnCasesQuery += ` AND (p.hn LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?
                      OR pn.pn_code LIKE ? OR pn.diagnosis LIKE ? OR pn.purpose LIKE ?)`;
            walkInQuery += ` AND (COALESCE(p.first_name, apt.walk_in_name) LIKE ? OR COALESCE(p.last_name, '') LIKE ?)`;
            countQuery += ` AND (p.hn LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?
                           OR pn.pn_code LIKE ? OR pn.diagnosis LIKE ? OR pn.purpose LIKE ?)`;
            const pnSearchParams = Array(6).fill(searchPattern);
            pnParams.push(...pnSearchParams);
            walkInParams.push(searchPattern, searchPattern);
            countParams.push(...pnSearchParams);
        }

        // Get total count for PN cases
        const [countResult] = await db.execute(countQuery, countParams);
        const total = countResult[0].total;

        // Execute PN cases query with pagination
        pnCasesQuery += ' ORDER BY COALESCE(appointment_date, DATE(pn.created_at)) DESC, pn.created_at DESC LIMIT ? OFFSET ?';
        pnParams.push(parseInt(limit), offset);
        const [cases] = await db.execute(pnCasesQuery, pnParams);

        // Execute walk-in query (no pagination)
        walkInQuery += ' ORDER BY apt.appointment_date DESC, apt.created_at DESC';
        console.log('🔍 Walk-in Query:', walkInQuery);
        console.log('🔍 Walk-in Params:', walkInParams);
        const [walkIns] = await db.execute(walkInQuery, walkInParams);
        console.log('🔍 Walk-ins returned:', walkIns.length, 'records');
        if (walkIns.length > 0) {
            console.log('🔍 First walk-in:', walkIns[0]);
        }

        // Get statistics with role-based filtering (exclude CANCELLED from total)
        let statsQuery = `
            SELECT
                COUNT(CASE WHEN status != 'CANCELLED' THEN 1 END) as total,
                SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as waiting,
                SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted,
                SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN MONTH(created_at) = MONTH(CURRENT_DATE())
                    AND YEAR(created_at) = YEAR(CURRENT_DATE())
                    AND status != 'CANCELLED' THEN 1 ELSE 0 END) as this_month
            FROM pn_cases
            WHERE 1=1
        `;

        const statsParams = [];

        // Apply same role-based filtering to statistics
        if (req.user.role === 'CLINIC') {
            statsQuery += ' AND (source_clinic_id = ? OR target_clinic_id = ?)';
            statsParams.push(req.user.clinic_id, req.user.clinic_id);
        }

        const [stats] = await db.execute(statsQuery, statsParams);

        res.json({
            cases,
            walkIns,
            statistics: stats[0],
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get PN cases error:', error);
        res.status(500).json({ error: 'Failed to retrieve PN cases' });
    }
});

// Create PN case
router.post('/', authenticateToken, [
    body('patient_id').isInt(),
    body('diagnosis').notEmpty(),
    body('purpose').notEmpty(),
    body('target_clinic_id').optional().isInt(),
    body('course_id').optional().isInt()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const db = req.app.locals.db;
        const pnCode = await generatePNCode(db);

        // Get patient's clinic as source
        const [patients] = await db.execute(
            'SELECT clinic_id FROM patients WHERE id = ?',
            [req.body.patient_id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patientClinicId = patients[0].clinic_id;

        let sourceClinicId;
        let targetClinicId;

        if (req.user.role === 'CLINIC') {
            if (!req.user.clinic_id) {
                return res.status(403).json({
                    error: 'CLINIC user must be assigned to a clinic'
                });
            }

            sourceClinicId = patientClinicId;
            targetClinicId = req.user.clinic_id;

            if (req.body.target_clinic_id && req.body.target_clinic_id !== req.user.clinic_id) {
                return res.status(403).json({
                    error: 'CLINIC users can only create PN cases for their own clinic'
                });
            }
        } else {
            sourceClinicId = patientClinicId;
            targetClinicId = req.body.target_clinic_id;

            if (!targetClinicId) {
                return res.status(400).json({
                    error: 'Target clinic ID is required'
                });
            }
        }

        // Course validation if course_id is provided
        let courseId = req.body.course_id || null;
        if (courseId) {
            const [courses] = await db.execute(
                `SELECT id, course_code, remaining_sessions, status, patient_id, expiry_date
                 FROM courses WHERE id = ?`,
                [courseId]
            );

            if (courses.length === 0) {
                return res.status(404).json({ error: 'Course not found' });
            }

            const course = courses[0];

            let hasAccess = course.patient_id === req.body.patient_id;

            if (!hasAccess) {
                const [sharedCourses] = await db.execute(
                    `SELECT id FROM course_shared_users
                     WHERE course_id = ? AND patient_id = ? AND is_active = 1`,
                    [courseId, req.body.patient_id]
                );
                hasAccess = sharedCourses.length > 0;
            }

            if (!hasAccess) {
                return res.status(400).json({
                    error: 'Course does not belong to this patient'
                });
            }

            if (course.status !== 'ACTIVE') {
                return res.status(400).json({
                    error: `Course is ${course.status}. Only ACTIVE courses can be used.`
                });
            }

            if (course.remaining_sessions <= 0) {
                return res.status(400).json({
                    error: 'Course has no remaining sessions. Please purchase a new course.',
                    course_code: course.course_code,
                    remaining_sessions: course.remaining_sessions
                });
            }

            if (course.expiry_date && new Date(course.expiry_date) < new Date()) {
                return res.status(400).json({
                    error: 'Course has expired',
                    expiry_date: course.expiry_date
                });
            }
        }

        console.log('🟢 Creating PN Case - Received data:');
        console.log('   recheck_body_part (raw):', req.body.recheck_body_part);
        console.log('   recheck_body_part (converted):', req.body.recheck_body_part ? 1 : 0);

        const [result] = await db.execute(
            `INSERT INTO pn_cases (
                pn_code, patient_id, diagnosis, purpose, status,
                source_clinic_id, target_clinic_id, referring_doctor,
                notes, current_medications, allergies,
                pn_precautions, pn_contraindications, treatment_goals,
                expected_outcomes, medical_notes, pain_scale, functional_status,
                course_id, recheck_body_part, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                pnCode,
                req.body.patient_id,
                req.body.diagnosis,
                req.body.purpose,
                'PENDING',
                sourceClinicId,
                targetClinicId,
                req.body.referring_doctor || null,
                req.body.notes || null,
                req.body.current_medications || null,
                req.body.allergies || null,
                req.body.pn_precautions || null,
                req.body.pn_contraindications || null,
                req.body.treatment_goals || null,
                req.body.expected_outcomes || null,
                req.body.medical_notes || null,
                req.body.pain_scale || null,
                req.body.functional_status || null,
                courseId,
                req.body.recheck_body_part ? 1 : 0,
                req.user.id
            ]
        );

        await auditLog(db, req.user.id, 'CREATE', 'pn_case', result.insertId, null, req.body, req);

        const responseMessage = courseId
            ? 'PN case created successfully with course linked (session will be deducted when accepted)'
            : 'PN case created successfully';

        res.status(201).json({
            success: true,
            message: responseMessage,
            pn_id: result.insertId,
            pn_code: pnCode,
            course_id: courseId
        });
    } catch (error) {
        console.error('Create PN case error:', error);
        res.status(500).json({ error: 'Failed to create PN case' });
    }
});

// Update PN case medical information
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get current PN case
        const [cases] = await db.execute(
            'SELECT * FROM pn_cases WHERE id = ?',
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        const oldCase = cases[0];

        // Check access
        if (req.user.role === 'CLINIC') {
            if (oldCase.target_clinic_id !== req.user.clinic_id && oldCase.source_clinic_id !== req.user.clinic_id) {
                return res.status(403).json({ error: 'No access to update this PN case' });
            }
        }

        // Allowed medical fields to update
        const allowedFields = [
            'diagnosis', 'purpose', 'referring_doctor', 'notes',
            'current_medications', 'allergies', 'pn_precautions', 'pn_contraindications',
            'treatment_goals', 'expected_outcomes', 'medical_notes', 'pain_scale', 'functional_status'
        ];

        const updateFields = [];
        const updateValues = [];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updateFields.push(`${field} = ?`);
                updateValues.push(req.body[field]);
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.push('updated_at = NOW()');
        updateValues.push(id);

        await db.execute(
            `UPDATE pn_cases SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        await auditLog(db, req.user.id, 'UPDATE', 'pn_case', id, oldCase, req.body, req);

        res.json({ success: true, message: 'PN case updated successfully' });
    } catch (error) {
        console.error('Update PN case error:', error);
        res.status(500).json({ error: 'Failed to update PN case' });
    }
});

// Update PN case status
router.patch('/:id/status', authenticateToken, [
    body('status').isIn(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const db = req.app.locals.db;
        const { id } = req.params;
        const { status, pt_diagnosis, pt_chief_complaint, pt_present_history, pt_pain_score, soap_notes, body_annotation_id } = req.body;

        console.log('🟢 PATCH /api/pn/:id/status - Request body:', {
            status,
            body_annotation_id,
            pt_diagnosis: pt_diagnosis ? 'provided' : 'not provided'
        });

        // Get current case with clinic information and linked appointment (latest only)
        const [cases] = await db.execute(
            `SELECT pn.*,
                    COALESCE((SELECT course_id FROM appointments WHERE pn_case_id = pn.id ORDER BY appointment_date DESC, created_at DESC LIMIT 1), pn.course_id) as final_course_id,
                    sc.code as source_clinic_code,
                    tc.code as target_clinic_code,
                    (SELECT id FROM appointments WHERE pn_case_id = pn.id ORDER BY appointment_date DESC, created_at DESC LIMIT 1) as appointment_id,
                    (SELECT status FROM appointments WHERE pn_case_id = pn.id ORDER BY appointment_date DESC, created_at DESC LIMIT 1) as appointment_status
             FROM pn_cases pn
             JOIN clinics sc ON pn.source_clinic_id = sc.id
             JOIN clinics tc ON pn.target_clinic_id = tc.id
             WHERE pn.id = ?`,
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        const oldCase = cases[0];

        // Use final_course_id (from COALESCE) instead of pn.course_id
        oldCase.course_id = oldCase.final_course_id;

        // Check access - ADMIN and PT can change status
        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            return res.status(403).json({ error: 'Only ADMIN or PT can change PN case status' });
        }

        // Update status with appropriate timestamp
        let updateQuery = 'UPDATE pn_cases SET status = ?, updated_at = NOW()';
        const updateParams = [status];

        console.log('=== PN STATUS CHANGE DEBUG ===');
        console.log('PN ID:', id);
        console.log('Old Status:', oldCase.status);
        console.log('New Status:', status);
        console.log('Course ID:', oldCase.course_id);
        console.log('Source Clinic:', oldCase.source_clinic_code);
        console.log('Target Clinic:', oldCase.target_clinic_code);
        console.log('Linked Appointment ID:', oldCase.appointment_id);
        console.log('Appointment Status:', oldCase.appointment_status);

        // PENDING → ACCEPTED: Save PT information for non-CL001 clinics
        if (status === 'ACCEPTED' && oldCase.status === 'PENDING') {
            updateQuery += ', accepted_at = NOW()';

            // Save body_annotation_id if provided
            if (body_annotation_id) {
                console.log('✅ Saving body_annotation_id:', body_annotation_id);
                updateQuery += ', body_annotation_id = ?';
                updateParams.push(body_annotation_id);
            }

            // For non-CL001 clinics, require and save PT assessment information
            if (oldCase.source_clinic_code !== 'CL001' && oldCase.target_clinic_code !== 'CL001') {
                if (!pt_diagnosis || !pt_chief_complaint || !pt_present_history || pt_pain_score === undefined) {
                    return res.status(400).json({
                        error: 'PT assessment information required for non-CL001 clinics',
                        required_fields: ['pt_diagnosis', 'pt_chief_complaint', 'pt_present_history', 'pt_pain_score']
                    });
                }

                updateQuery += ', pt_diagnosis = ?, pt_chief_complaint = ?, pt_present_history = ?, pt_pain_score = ?';
                updateParams.push(pt_diagnosis, pt_chief_complaint, pt_present_history, pt_pain_score);
            }

            // Sync appointment to COMPLETED
            if (oldCase.appointment_id) {
                await db.execute(
                    `UPDATE appointments
                     SET status = 'COMPLETED', updated_at = NOW()
                     WHERE id = ?`,
                    [oldCase.appointment_id]
                );
                console.log('✅ Synced: PN ACCEPTED → Appointment COMPLETED');

                // Deduct course session when PN is accepted from dashboard
                if (oldCase.course_id) {
                    const [usageHistory] = await db.execute(
                        `SELECT id FROM course_usage_history
                         WHERE course_id = ? AND pn_id = ? AND action_type = 'USE'
                         LIMIT 1`,
                        [oldCase.course_id, id]
                    );

                    if (usageHistory.length === 0) {
                        console.log('🎯 Dashboard PN ACCEPTED: Deducting course session for course:', oldCase.course_id);

                        await db.execute(
                            `UPDATE courses
                             SET used_sessions = used_sessions + 1,
                                 remaining_sessions = remaining_sessions - 1,
                                 status = CASE
                                     WHEN remaining_sessions - 1 = 0 THEN 'COMPLETED'
                                     WHEN remaining_sessions - 1 < 0 THEN 'COMPLETED'
                                     ELSE status
                                 END,
                                 updated_at = NOW()
                             WHERE id = ?`,
                            [oldCase.course_id]
                        );

                        await db.execute(
                            `INSERT INTO course_usage_history
                             (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                             VALUES (?, NULL, ?, 1, CURDATE(), 'USE', 'Dashboard: PN case accepted - session deducted', ?)`,
                            [oldCase.course_id, id, req.user.id]
                        ).catch(err => console.warn('Failed to log course usage:', err.message));

                        console.log('✅ Course session deducted from dashboard');
                    } else {
                        console.log('ℹ️  Course session already deducted for this PN - skipping');
                    }
                }
            }
        }
        // ACCEPTED → PENDING: Return course session
        else if (status === 'PENDING' && oldCase.status === 'ACCEPTED') {
            updateQuery += ', accepted_at = NULL';

            // Return course session if from appointment
            if (oldCase.course_id && oldCase.appointment_id) {
                console.log('🔄 Returning course session (PN reversed to PENDING)');

                await db.execute(
                    `UPDATE courses
                     SET used_sessions = GREATEST(0, used_sessions - 1),
                         remaining_sessions = remaining_sessions + 1,
                         status = CASE
                             WHEN status = 'COMPLETED' AND remaining_sessions + 1 > 0 THEN 'ACTIVE'
                             ELSE status
                         END,
                         updated_at = NOW()
                     WHERE id = ?`,
                    [oldCase.course_id]
                );

                await db.execute(
                    `INSERT INTO course_usage_history
                     (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                     VALUES (?, NULL, ?, 1, CURDATE(), 'RETURN', 'PN case reversed to pending - session returned', ?)`,
                    [oldCase.course_id, id, req.user.id]
                ).catch(err => console.warn('Failed to log course return:', err.message));
            } else if (oldCase.course_id && !oldCase.appointment_id) {
                console.log('ℹ️  PN has course but no appointment - no session to return (Dashboard-created PN)');
            }

            // Sync appointment back to SCHEDULED
            if (oldCase.appointment_id) {
                await db.execute(
                    `UPDATE appointments
                     SET status = 'SCHEDULED', updated_at = NOW()
                     WHERE id = ?`,
                    [oldCase.appointment_id]
                );
                console.log('✅ Synced: PN PENDING → Appointment SCHEDULED');
            }
        }
        // ACCEPTED → COMPLETED: Require SOAP notes
        else if (status === 'COMPLETED' && oldCase.status === 'ACCEPTED') {
            updateQuery += ', completed_at = NOW()';

            // SOAP notes required for all clinics when completing
            if (!soap_notes || !soap_notes.subjective || !soap_notes.objective ||
                !soap_notes.assessment || !soap_notes.plan) {
                return res.status(400).json({
                    error: 'SOAP notes required when completing case',
                    required_fields: ['soap_notes.subjective', 'soap_notes.objective', 'soap_notes.assessment', 'soap_notes.plan']
                });
            }

            // Save SOAP notes to separate table
            await db.execute(
                `INSERT INTO pn_soap_notes (pn_id, subjective, objective, assessment, plan, timestamp, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
                [id, soap_notes.subjective, soap_notes.objective, soap_notes.assessment,
                 soap_notes.plan, soap_notes.notes || '', req.user.id]
            );

            // Sync appointment to COMPLETED
            if (oldCase.appointment_id) {
                await db.execute(
                    `UPDATE appointments
                     SET status = 'COMPLETED', updated_at = NOW()
                     WHERE id = ?`,
                    [oldCase.appointment_id]
                );
                console.log('✅ Synced: PN COMPLETED → Appointment COMPLETED');
            }
        }
        // CANCELLED: Return the course session
        else if (status === 'CANCELLED') {
            updateQuery += ', cancelled_at = NOW()';
            if (req.body.cancellation_reason) {
                updateQuery += ', cancellation_reason = ?';
                updateParams.push(req.body.cancellation_reason);
            }

            // Only return session if PN was ACCEPTED, has course, AND has appointment
            if (oldCase.status === 'ACCEPTED' && oldCase.course_id && oldCase.appointment_id) {
                console.log('🔄 DASHBOARD CANCELLATION: Returning course session (PN from Appointment)');

                await db.execute(
                    `UPDATE courses
                     SET used_sessions = GREATEST(0, used_sessions - 1),
                         remaining_sessions = remaining_sessions + 1,
                         status = CASE
                             WHEN status = 'COMPLETED' AND remaining_sessions + 1 > 0 THEN 'ACTIVE'
                             ELSE status
                         END,
                         updated_at = NOW()
                     WHERE id = ?`,
                    [oldCase.course_id]
                );

                await db.execute(
                    `INSERT INTO course_usage_history
                     (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                     VALUES (?, NULL, ?, 1, CURDATE(), 'RETURN', 'PN case cancelled - session returned', ?)`,
                    [oldCase.course_id, id, req.user.id]
                ).catch(err => console.warn('Failed to log course return:', err.message));

                console.log('✅ Course session returned successfully');
            } else {
                console.log('ℹ️  No course session to return');
            }

            // Sync appointment to CANCELLED
            if (oldCase.appointment_id) {
                await db.execute(
                    `UPDATE appointments
                     SET status = 'CANCELLED',
                         cancellation_reason = ?,
                         cancelled_at = NOW(),
                         updated_at = NOW()
                     WHERE id = ?`,
                    [req.body.cancellation_reason || 'Cancelled from Dashboard', oldCase.appointment_id]
                );
                console.log('✅ Synced: PN CANCELLED → Appointment CANCELLED');
            }
        }

        updateQuery += ' WHERE id = ?';
        updateParams.push(id);

        await db.execute(updateQuery, updateParams);

        // Log status change in history
        await db.execute(
            `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, is_reversal)
             VALUES (?, ?, ?, ?, FALSE)`,
            [id, oldCase.status, status, req.user.id]
        );

        await auditLog(db, req.user.id, 'UPDATE_STATUS', 'pn_case', id,
                      { status: oldCase.status }, { status }, req);

        res.json({
            success: true,
            message: `PN case status updated to ${status}`
        });
    } catch (error) {
        console.error('Update PN status error:', error);
        res.status(500).json({ error: 'Failed to update PN case status' });
    }
});

// Reverse PN case status (ADMIN only)
router.post('/:id/reverse-status', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Reversal reason is required' });
        }

        // Get current case
        const [cases] = await db.execute(
            'SELECT * FROM pn_cases WHERE id = ?',
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        const currentCase = cases[0];

        // Only allow reversal from COMPLETED to ACCEPTED
        if (currentCase.status !== 'COMPLETED') {
            return res.status(400).json({
                error: 'Can only reverse COMPLETED cases back to ACCEPTED'
            });
        }

        // Update status back to ACCEPTED and clear completed_at
        await db.execute(
            `UPDATE pn_cases
             SET status = 'ACCEPTED',
                 completed_at = NULL,
                 is_reversed = TRUE,
                 last_reversal_reason = ?,
                 last_reversed_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?`,
            [reason, id]
        );

        // Log status reversal in history
        await db.execute(
            `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, change_reason, is_reversal)
             VALUES (?, ?, ?, ?, ?, TRUE)`,
            [id, 'COMPLETED', 'ACCEPTED', req.user.id, reason]
        );

        await auditLog(db, req.user.id, 'REVERSE_STATUS', 'pn_case', id,
                      { status: 'COMPLETED' }, { status: 'ACCEPTED', reason }, req);

        res.json({
            success: true,
            message: 'Case status reversed to ACCEPTED. SOAP notes must be re-entered.'
        });
    } catch (error) {
        console.error('Reverse status error:', error);
        res.status(500).json({ error: 'Failed to reverse status' });
    }
});

// Get SOAP notes for a PN case
router.get('/:id/soap-notes', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [notes] = await db.execute(
            `SELECT s.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name
             FROM pn_soap_notes s
             JOIN users u ON s.created_by = u.id
             WHERE s.pn_id = ?
             ORDER BY s.timestamp DESC`,
            [id]
        );

        res.json(notes);
    } catch (error) {
        console.error('Get SOAP notes error:', error);
        res.status(500).json({ error: 'Failed to retrieve SOAP notes' });
    }
});

// Create PT certificate
router.post('/:id/certificate', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { certificate_type, certificate_data } = req.body;

        // Check access - ADMIN and PT only
        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            return res.status(403).json({ error: 'Only ADMIN or PT can create certificates' });
        }

        if (!certificate_type || !['thai', 'english'].includes(certificate_type)) {
            return res.status(400).json({ error: 'Invalid certificate type. Must be "thai" or "english"' });
        }

        // Verify case is COMPLETED
        const [cases] = await db.execute(
            'SELECT status FROM pn_cases WHERE id = ?',
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        if (cases[0].status !== 'COMPLETED') {
            return res.status(400).json({ error: 'Can only create certificates for COMPLETED cases' });
        }

        // Insert certificate
        const [result] = await db.execute(
            `INSERT INTO pt_certificates (pn_id, certificate_type, certificate_data, created_by)
             VALUES (?, ?, ?, ?)`,
            [id, certificate_type, JSON.stringify(certificate_data), req.user.id]
        );

        await auditLog(db, req.user.id, 'CREATE_CERTIFICATE', 'pt_certificate', result.insertId,
                      null, { pn_id: id, certificate_type }, req);

        res.json({
            success: true,
            message: 'Certificate created successfully',
            certificate_id: result.insertId
        });
    } catch (error) {
        console.error('Create certificate error:', error);
        res.status(500).json({ error: 'Failed to create certificate' });
    }
});

// Get certificates for a PN case
router.get('/:id/certificates', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [certificates] = await db.execute(
            `SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name
             FROM pt_certificates c
             JOIN users u ON c.created_by = u.id
             WHERE c.pn_id = ?
             ORDER BY c.created_at DESC`,
            [id]
        );

        res.json(certificates);
    } catch (error) {
        console.error('Get certificates error:', error);
        res.status(500).json({ error: 'Failed to retrieve certificates' });
    }
});

// ========================================
// CERTIFICATE SETTINGS ROUTES
// ========================================

// Get certificate settings
router.get('/certificate-settings', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id } = req.query;

        let query = 'SELECT * FROM certificate_settings WHERE ';
        let params = [];

        if (clinic_id) {
            query += 'clinic_id = ?';
            params.push(clinic_id);
        } else {
            query += 'clinic_id IS NULL';
        }

        query += ' LIMIT 1';

        const [settings] = await db.execute(query, params);

        res.json(settings.length > 0 ? settings[0] : null);
    } catch (error) {
        console.error('Get certificate settings error:', error);
        res.status(500).json({ error: 'Failed to retrieve settings' });
    }
});

// Create certificate settings
router.post('/certificate-settings', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can modify certificate settings' });
        }

        const db = req.app.locals.db;
        const {
            clinic_id, clinic_logo_url, clinic_name, clinic_address,
            clinic_phone, clinic_email, header_text, footer_text,
            show_pt_diagnosis, show_subjective, show_treatment_period
        } = req.body;

        const [result] = await db.execute(
            `INSERT INTO certificate_settings
             (clinic_id, clinic_logo_url, clinic_name, clinic_address, clinic_phone,
              clinic_email, header_text, footer_text, show_pt_diagnosis,
              show_subjective, show_treatment_period)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clinic_id || null, clinic_logo_url, clinic_name, clinic_address,
                clinic_phone, clinic_email, header_text, footer_text,
                show_pt_diagnosis !== false, show_subjective !== false,
                show_treatment_period !== false
            ]
        );

        res.json({
            success: true,
            message: 'Settings created successfully',
            id: result.insertId
        });
    } catch (error) {
        console.error('Create certificate settings error:', error);
        res.status(500).json({ error: 'Failed to create settings' });
    }
});

// Update certificate settings
router.put('/certificate-settings/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can modify certificate settings' });
        }

        const db = req.app.locals.db;
        const { id } = req.params;
        const {
            clinic_id, clinic_logo_url, clinic_name, clinic_address,
            clinic_phone, clinic_email, header_text, footer_text,
            show_pt_diagnosis, show_subjective, show_treatment_period
        } = req.body;

        await db.execute(
            `UPDATE certificate_settings
             SET clinic_id = ?, clinic_logo_url = ?, clinic_name = ?,
                 clinic_address = ?, clinic_phone = ?, clinic_email = ?,
                 header_text = ?, footer_text = ?, show_pt_diagnosis = ?,
                 show_subjective = ?, show_treatment_period = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [
                clinic_id || null, clinic_logo_url, clinic_name, clinic_address,
                clinic_phone, clinic_email, header_text, footer_text,
                show_pt_diagnosis !== false, show_subjective !== false,
                show_treatment_period !== false, id
            ]
        );

        res.json({
            success: true,
            message: 'Settings updated successfully'
        });
    } catch (error) {
        console.error('Update certificate settings error:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Update PT certificate (ADMIN only)
router.put('/certificates/:certificateId', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { certificateId } = req.params;
        const { certificate_data } = req.body;

        // Only ADMIN can edit certificates
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can edit certificates' });
        }

        // Check if certificate exists
        const [certificates] = await db.execute(
            'SELECT * FROM pt_certificates WHERE id = ?',
            [certificateId]
        );

        if (certificates.length === 0) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        // Update certificate
        await db.execute(
            `UPDATE pt_certificates
             SET certificate_data = ?, updated_at = NOW()
             WHERE id = ?`,
            [JSON.stringify(certificate_data), certificateId]
        );

        await auditLog(db, req.user.id, 'UPDATE_CERTIFICATE', 'pt_certificate', certificateId,
                      certificates[0], { certificate_data }, req);

        res.json({
            success: true,
            message: 'Certificate updated successfully'
        });
    } catch (error) {
        console.error('Update certificate error:', error);
        res.status(500).json({ error: 'Failed to update certificate' });
    }
});

// Delete PN case (Only PENDING status can be deleted)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get current PN case
        const [cases] = await db.execute(
            'SELECT * FROM pn_cases WHERE id = ?',
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        const pnCase = cases[0];

        // Only PENDING cases can be deleted
        if (pnCase.status !== 'PENDING') {
            return res.status(400).json({
                error: `Cannot delete PN case with status ${pnCase.status}. Only PENDING cases can be deleted.`
            });
        }

        // Check access
        if (req.user.role === 'CLINIC') {
            if (pnCase.target_clinic_id !== req.user.clinic_id && pnCase.source_clinic_id !== req.user.clinic_id) {
                return res.status(403).json({ error: 'No access to delete this PN case' });
            }
        }

        const removedAppointments = [];

        try {
            await db.beginTransaction();

            const [appointments] = await db.execute(
                'SELECT * FROM appointments WHERE pn_case_id = ?',
                [id]
            );

            if (appointments.length > 0) {
                removedAppointments.push(...appointments.map(apt => apt.id));
                await db.execute('DELETE FROM appointments WHERE pn_case_id = ?', [id]);

                for (const appointment of appointments) {
                    await auditLog(db, req.user.id, 'DELETE', 'appointment', appointment.id, appointment, null, req);
                }
            }

            await db.execute('DELETE FROM pn_status_history WHERE pn_id = ?', [id]);
            await db.execute('DELETE FROM pn_visits WHERE pn_id = ?', [id]);
            await db.execute('DELETE FROM pn_attachments WHERE pn_id = ?', [id]);
            await db.execute('DELETE FROM pt_certificates WHERE pn_id = ?', [id]);

            await db.execute('DELETE FROM pn_cases WHERE id = ?', [id]);
            await auditLog(db, req.user.id, 'DELETE', 'pn_case', id, pnCase, null, req);

            await db.commit();

            res.json({
                success: true,
                message: 'PN case deleted successfully',
                removed_appointments: removedAppointments
            });
        } catch (transactionError) {
            await db.rollback();
            console.error('Delete PN case transaction error:', transactionError);
            return res.status(500).json({ error: 'Failed to delete PN case' });
        }
    } catch (error) {
        console.error('Delete PN case error:', error);
        res.status(500).json({ error: 'Failed to delete PN case' });
    }
});

// Get single PN case with details
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [cases] = await db.execute(
            `SELECT
                pn.*,
                p.hn, p.pt_number, p.first_name, p.last_name, p.dob, p.gender,
                p.diagnosis as patient_diagnosis, p.rehab_goal, p.precaution,
                sc.name as source_clinic_name,
                tc.name as target_clinic_name,
                CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
                CONCAT(pt.first_name, ' ', pt.last_name) as assigned_pt_name
            FROM pn_cases pn
            JOIN patients p ON pn.patient_id = p.id
            JOIN clinics sc ON pn.source_clinic_id = sc.id
            JOIN clinics tc ON pn.target_clinic_id = tc.id
            JOIN users u ON pn.created_by = u.id
            LEFT JOIN users pt ON pn.assigned_pt_id = pt.id
            WHERE pn.id = ?`,
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        // Get visits
        let visits = [];
        try {
            const [result] = await db.execute(
                `SELECT v.*, CONCAT(u.first_name, ' ', u.last_name) as therapist_name
                 FROM pn_visits v
                 LEFT JOIN users u ON v.therapist_id = u.id
                 WHERE v.pn_id = ?
                 ORDER BY v.visit_no`,
                [id]
            );
            visits = result;
        } catch (err) {
            console.warn('Failed to load visits:', err.message);
        }

        // Get reports
        let reports = [];
        try {
            const [result] = await db.execute(
                `SELECT r.*, v.visit_no
                 FROM pn_reports r
                 JOIN pn_visits v ON r.visit_id = v.id
                 WHERE v.pn_id = ?
                 ORDER BY r.created_at DESC`,
                [id]
            );
            reports = result;
        } catch (err) {
            console.warn('Failed to load reports:', err.message);
        }

        // Get SOAP notes
        let soap_notes = [];
        try {
            const [result] = await db.execute(
                `SELECT s.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name
                 FROM pn_soap_notes s
                 JOIN users u ON s.created_by = u.id
                 WHERE s.pn_id = ?
                 ORDER BY s.timestamp DESC`,
                [id]
            );
            soap_notes = result;
        } catch (err) {
            console.warn('Failed to load SOAP notes (table may not exist):', err.message);
        }

        // Get attachments
        let attachments = [];
        try {
            const [result] = await db.execute(
                `SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) as uploaded_by_name
                 FROM pn_attachments a
                 JOIN users u ON a.uploaded_by = u.id
                 WHERE a.pn_id = ?
                 ORDER BY a.created_at DESC`,
                [id]
            );
            attachments = result;
        } catch (err) {
            console.warn('Failed to load attachments (table may not exist):', err.message);
        }

        res.json({
            ...cases[0],
            visits,
            reports,
            soap_notes,
            attachments
        });
    } catch (error) {
        console.error('Get PN case error:', error);
        res.status(500).json({ error: 'Failed to retrieve PN case details' });
    }
});

// Get PN case timeline
router.get('/:id/timeline', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [cases] = await db.execute(
            `SELECT pn.*,
                    CONCAT(creator.first_name, ' ', creator.last_name) AS created_by_name,
                    sc.name AS source_clinic_name,
                    tc.name AS target_clinic_name
             FROM pn_cases pn
             JOIN clinics sc ON pn.source_clinic_id = sc.id
             JOIN clinics tc ON pn.target_clinic_id = tc.id
             JOIN users creator ON pn.created_by = creator.id
             WHERE pn.id = ?`,
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        const pnCase = cases[0];

        if (req.user.role === 'CLINIC') {
            if (pnCase.source_clinic_id !== req.user.clinic_id && pnCase.target_clinic_id !== req.user.clinic_id) {
                return res.status(403).json({ error: 'No access to this PN case' });
            }
        }

        const timeline = [];

        timeline.push({
            type: 'CASE_CREATED',
            timestamp: pnCase.created_at,
            status: pnCase.status,
            title: 'PN case created',
            description: `Case created by ${pnCase.created_by_name || 'System'}`,
            meta: {
                created_by: pnCase.created_by_name || null,
                clinic: pnCase.target_clinic_name || null
            }
        });

        const [statusHistory] = await db.execute(
            `SELECT h.old_status, h.new_status, h.change_reason, h.is_reversal,
                    DATE_FORMAT(h.created_at, '%Y-%m-%d %H:%i:%s') AS changed_at,
                    CONCAT(u.first_name, ' ', u.last_name) AS changed_by_name
             FROM pn_status_history h
             LEFT JOIN users u ON h.changed_by = u.id
             WHERE h.pn_id = ?
             ORDER BY h.created_at ASC`,
            [id]
        );

        statusHistory.forEach(entry => {
            timeline.push({
                type: 'STATUS_CHANGE',
                timestamp: entry.changed_at,
                status: entry.new_status,
                title: `Status changed to ${entry.new_status}`,
                description: entry.change_reason || null,
                meta: {
                    changed_by: entry.changed_by_name || null,
                    old_status: entry.old_status,
                    is_reversal: !!entry.is_reversal
                }
            });
        });

        const [appointmentHistory] = await db.execute(
            `SELECT a.id, a.status, a.booking_type,
                    DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
                    TIME_FORMAT(a.start_time, '%H:%i:%s') AS start_time,
                    TIME_FORMAT(a.end_time, '%H:%i:%s') AS end_time,
                    DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                    a.walk_in_name, a.walk_in_email,
                    CASE
                        WHEN a.booking_type = 'WALK_IN' THEN CONCAT('W', LPAD(a.id, 6, '0'))
                        ELSE NULL
                    END AS walk_in_id,
                    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                    CONCAT(pt.first_name, ' ', pt.last_name) AS pt_name,
                    c.name AS clinic_name,
                    CONCAT(creator.first_name, ' ', creator.last_name) AS created_by_name
             FROM appointments a
             LEFT JOIN patients p ON a.patient_id = p.id
             LEFT JOIN users pt ON a.pt_id = pt.id
             JOIN clinics c ON a.clinic_id = c.id
             LEFT JOIN users creator ON a.created_by = creator.id
             WHERE a.pn_case_id = ?
             ORDER BY a.appointment_date ASC, a.start_time ASC`,
            [id]
        );

        appointmentHistory.forEach(apt => {
            const appointmentTitle = apt.status === 'CANCELLED'
                ? 'Appointment cancelled'
                : apt.status === 'COMPLETED'
                    ? 'Appointment completed'
                    : 'Appointment scheduled';
            const participant = apt.booking_type === 'WALK_IN'
                ? `Walk-in: ${apt.walk_in_name || 'Unknown visitor'}`
                : (apt.patient_name || 'Unknown patient');
            const description = `${participant} with ${apt.pt_name || 'Unassigned PT'}`;
            const timestamp = apt.appointment_date
                ? `${apt.appointment_date}T${apt.start_time || '00:00:00'}`
                : apt.created_at;

            timeline.push({
                type: 'APPOINTMENT',
                timestamp,
                status: apt.status,
                title: appointmentTitle,
                description,
                meta: {
                    appointment_id: apt.id,
                    booking_type: apt.booking_type,
                    clinic: apt.clinic_name,
                    start_time: apt.start_time,
                    end_time: apt.end_time,
                    created_at: apt.created_at,
                    created_by: apt.created_by_name,
                    walk_in_email: apt.walk_in_email,
                    walk_in_name: apt.walk_in_name,
                    walk_in_id: apt.walk_in_id
                }
            });
        });

        const [visits] = await db.execute(
            `SELECT v.id, v.visit_no, v.status,
                    DATE_FORMAT(v.visit_date, '%Y-%m-%d') AS visit_date,
                    TIME_FORMAT(v.visit_time, '%H:%i:%s') AS visit_time,
                    CONCAT(u.first_name, ' ', u.last_name) AS therapist_name
             FROM pn_visits v
             LEFT JOIN users u ON v.therapist_id = u.id
             WHERE v.pn_id = ?
             ORDER BY v.visit_date ASC, v.visit_time ASC`,
            [id]
        );

        visits.forEach(visit => {
            const visitTimestamp = visit.visit_date
                ? `${visit.visit_date}T${visit.visit_time || '00:00:00'}`
                : null;
            timeline.push({
                type: 'VISIT',
                timestamp: visitTimestamp,
                status: visit.status,
                title: `Visit #${visit.visit_no}`,
                description: `Visit ${visit.visit_no} recorded`,
                meta: {
                    visit_id: visit.id,
                    therapist: visit.therapist_name || null
                }
            });
        });

        timeline.sort((a, b) => {
            const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return aTime - bTime;
        });

        res.json({
            case: {
                id: pnCase.id,
                pn_code: pnCase.pn_code,
                status: pnCase.status
            },
            events: timeline
        });
    } catch (error) {
        console.error('Get PN timeline error:', error);
        res.status(500).json({ error: 'Failed to retrieve PN timeline' });
    }
});

module.exports = router;
