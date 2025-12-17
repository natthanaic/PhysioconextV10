// routes/appointments.js - Appointment Management Routes
const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { authenticateToken, authorize, auditLog } = require('../middleware/auth');
const { generatePNCode } = require('../utils/helpers');
const { sendLINENotification, sendSMSNotification, sendPatientSMS, createGoogleCalendarEvent, updateGoogleCalendarEvent, deleteGoogleCalendarEvent } = require('../utils/notifications');

const router = express.Router();

// File upload configuration for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, process.env.UPLOAD_DIR || './uploads');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, GIF, PDF, DOC, DOCX are allowed.'));
        }
    }
});

// Appointment SELECT clause for consistent querying
const appointmentSelectClause = `
    SELECT
        a.id,
        a.patient_id,
        a.pt_id,
        a.clinic_id,
        DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
        TIME_FORMAT(a.start_time, '%H:%i:%s') AS start_time,
        TIME_FORMAT(a.end_time, '%H:%i:%s') AS end_time,
        a.status,
        a.appointment_type,
        a.booking_type,
        a.walk_in_name,
        a.walk_in_email,
        a.walk_in_phone,
        CASE
            WHEN a.booking_type = 'WALK_IN' THEN CONCAT('W', LPAD(a.id, 6, '0'))
            ELSE NULL
        END AS walk_in_id,
        a.pn_case_id,
        a.auto_created_pn,
        a.reason,
        a.notes,
        a.created_by,
        DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(a.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
        a.cancellation_reason,
        DATE_FORMAT(a.cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelled_at,
        a.cancelled_by,
        p.hn,
        p.pt_number,
        p.first_name AS patient_first_name,
        p.last_name AS patient_last_name,
        p.email AS patient_email,
        p.phone AS patient_phone,
        p.gender,
        p.dob,
        CASE
            WHEN a.booking_type = 'WALK_IN' THEN a.walk_in_name
            ELSE CONCAT_WS(' ', p.first_name, p.last_name)
        END AS patient_name,
        CONCAT_WS(' ', pt.first_name, pt.last_name) AS pt_name,
        c.name AS clinic_name,
        c.code AS clinic_code,
        c.email AS clinic_email,
        CONCAT_WS(' ', creator.first_name, creator.last_name) AS created_by_name,
        CONCAT_WS(' ', canceller.first_name, canceller.last_name) AS cancelled_by_name,
        pn.pn_code,
        pn.status AS pn_status
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id
    LEFT JOIN users pt ON a.pt_id = pt.id
    JOIN clinics c ON a.clinic_id = c.id
    LEFT JOIN users creator ON a.created_by = creator.id
    LEFT JOIN users canceller ON a.cancelled_by = canceller.id
    LEFT JOIN pn_cases pn ON a.pn_case_id = pn.id
`;

// Helper function to get accessible clinic IDs for a user
const getAccessibleClinicIds = async (db, user) => {
    if (!user || user.role === 'ADMIN') {
        return [];
    }

    const clinicIds = new Set();

    if (user.clinic_id) {
        clinicIds.add(user.clinic_id);
    }

    const [grants] = await db.execute(
        'SELECT clinic_id FROM user_clinic_grants WHERE user_id = ?',
        [user.id]
    );

    grants
        .map(grant => grant.clinic_id)
        .filter(id => id)
        .forEach(id => clinicIds.add(id));

    return Array.from(clinicIds);
};

// ========================================
// HELPER FUNCTIONS
// ========================================

// Note: generatePNCode, auditLog, and notification functions are imported from utils and middleware
// No need to redefine them here

// ========================================
// APPOINTMENT MANAGEMENT ROUTES
// ========================================

// Test route to verify appointment routes are loading
router.get('/appointments-test', (req, res) => {
    res.json({ message: 'Appointment routes loaded successfully', timestamp: new Date().toISOString() });
});

// GET /api/appointments - Get all appointments (with filters)
router.get('/appointments', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { pt_id, clinic_id, start_date, end_date, status } = req.query;

        const accessibleClinics = await getAccessibleClinicIds(db, req.user);

        if (req.user.role === 'CLINIC' && accessibleClinics.length === 0) {
            return res.json([]);
        }

        let query = `${appointmentSelectClause} WHERE 1=1`;
        const params = [];

        if (req.user.role !== 'ADMIN' && accessibleClinics.length > 0) {
            query += ` AND a.clinic_id IN (${accessibleClinics.map(() => '?').join(',')})`;
            params.push(...accessibleClinics);
        }

        if (pt_id) {
            query += ' AND a.pt_id = ?';
            params.push(pt_id);
        }

        if (clinic_id) {
            query += ' AND a.clinic_id = ?';
            params.push(clinic_id);
        }

        if (start_date) {
            query += ' AND a.appointment_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND a.appointment_date <= ?';
            params.push(end_date);
        }

        if (status) {
            query += ' AND a.status = ?';
            params.push(status);
        } else {
            query += ' AND a.status != ?';
            params.push('CANCELLED');
        }

        query += ' ORDER BY a.appointment_date, a.start_time';

        const [appointments] = await db.execute(query, params);

        res.json(appointments);
    } catch (error) {
        console.error('Get appointments error:', error);
        res.status(500).json({ error: 'Failed to retrieve appointments' });
    }
});

// POST /api/appointments/check-conflict - Check for appointment conflicts
router.post('/appointments/check-conflict', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { pt_id, appointment_date, start_time, end_time, exclude_appointment_id } = req.body;

        if (!pt_id || !appointment_date || !start_time || !end_time) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        let query = `
            SELECT id, start_time, end_time,
                   COALESCE(CONCAT(p.first_name, ' ', p.last_name), a.walk_in_name, 'Walk-in') as patient_name
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            WHERE a.pt_id = ?
              AND a.appointment_date = ?
              AND a.status != 'CANCELLED'
              AND (
                  (a.start_time < ? AND a.end_time > ?) OR
                  (a.start_time < ? AND a.end_time > ?) OR
                  (a.start_time >= ? AND a.end_time <= ?)
              )
        `;
        const params = [pt_id, appointment_date, end_time, start_time, end_time, start_time, start_time, end_time];

        if (exclude_appointment_id) {
            query += ' AND a.id != ?';
            params.push(exclude_appointment_id);
        }

        const [conflicts] = await db.execute(query, params);

        res.json({
            hasConflict: conflicts.length > 0,
            conflicts: conflicts
        });
    } catch (error) {
        console.error('Check conflict error:', error);
        res.status(500).json({ error: 'Failed to check conflicts' });
    }
});

// GET /api/appointments/available-slots - Get available time slots
router.get('/appointments/available-slots', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { date, clinic_id, pt_id } = req.query;

        if (!date || !clinic_id) {
            return res.status(400).json({ error: 'Date and clinic_id are required' });
        }

        const timeSlots = [];
        for (let hour = 8; hour < 20; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const startHour = hour.toString().padStart(2, '0');
                const startMinute = minute.toString().padStart(2, '0');
                const endMinute = (minute + 30) % 60;
                const endHour = minute === 30 ? hour + 1 : hour;

                timeSlots.push({
                    start_time: `${startHour}:${startMinute}:00`,
                    end_time: `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}:00`,
                    label: `${startHour}:${startMinute} - ${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`
                });
            }
        }

        let query = `
            SELECT start_time, end_time, pt_id
            FROM appointments
            WHERE appointment_date = ?
              AND clinic_id = ?
              AND status != 'CANCELLED'
        `;
        const params = [date, clinic_id];

        if (pt_id) {
            query += ' AND pt_id = ?';
            params.push(pt_id);
        }

        const [existingAppointments] = await db.execute(query, params);

        const availableSlots = timeSlots.map(slot => {
            const hasConflict = existingAppointments.some(apt => {
                return (slot.start_time < apt.end_time && slot.end_time > apt.start_time);
            });

            return {
                ...slot,
                available: !hasConflict,
                booked: hasConflict
            };
        });

        res.json({
            date,
            clinic_id,
            pt_id: pt_id || null,
            slots: availableSlots
        });
    } catch (error) {
        console.error('Get available slots error:', error);
        res.status(500).json({ error: 'Failed to retrieve available time slots' });
    }
});

// POST /api/appointments - Create new appointment
router.post('/appointments', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            booking_type,
            patient_id,
            walk_in_name,
            walk_in_email,
            walk_in_phone,
            pt_id,
            clinic_id,
            appointment_date,
            start_time,
            end_time,
            appointment_type,
            reason,
            notes,
            auto_create_pn,
            course_id,
            pn_case_id
        } = req.body;

        // Check access
        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            return res.status(403).json({ error: 'Only ADMIN or PT can create appointments' });
        }

        const validBookingType = booking_type || 'OLD_PATIENT';
        if (!['WALK_IN', 'OLD_PATIENT'].includes(validBookingType)) {
            return res.status(400).json({ error: 'Invalid booking_type' });
        }

        const sanitizedWalkInName = typeof walk_in_name === 'string' ? walk_in_name.trim() : walk_in_name;
        const sanitizedWalkInEmail = typeof walk_in_email === 'string' ? walk_in_email.trim() : walk_in_email;
        const sanitizedWalkInPhone = typeof walk_in_phone === 'string' ? walk_in_phone.trim() : walk_in_phone;

        if (validBookingType === 'WALK_IN') {
            if (!sanitizedWalkInName || !pt_id || !clinic_id || !appointment_date || !start_time || !end_time) {
                return res.status(400).json({ error: 'Missing required fields for walk-in booking' });
            }
        } else {
            if (!patient_id || !pt_id || !clinic_id || !appointment_date || !start_time || !end_time) {
                return res.status(400).json({ error: 'Missing required fields for patient booking' });
            }
        }

        // Check for conflicts
        const [conflicts] = await db.execute(
            `SELECT id FROM appointments
             WHERE pt_id = ? AND appointment_date = ? AND status != 'CANCELLED'
               AND (
                   (start_time < ? AND end_time > ?) OR
                   (start_time < ? AND end_time > ?) OR
                   (start_time >= ? AND end_time <= ?)
               )`,
            [pt_id, appointment_date, end_time, start_time, end_time, start_time, start_time, end_time]
        );

        if (conflicts.length > 0) {
            return res.status(409).json({ error: 'Time slot conflict detected' });
        }

        // Course validation
        let validatedCourseId = null;
        if (course_id && validBookingType === 'OLD_PATIENT' && patient_id) {
            const [courses] = await db.execute(
                `SELECT id, course_code, remaining_sessions, status, patient_id, expiry_date
                 FROM courses WHERE id = ?`,
                [course_id]
            );

            if (courses.length === 0) {
                return res.status(404).json({ error: 'Course not found' });
            }

            const course = courses[0];

            let hasAccess = course.patient_id === parseInt(patient_id);

            if (!hasAccess) {
                const [sharedCourses] = await db.execute(
                    `SELECT id FROM course_shared_users
                     WHERE course_id = ? AND patient_id = ? AND is_active = 1`,
                    [course_id, patient_id]
                );
                hasAccess = sharedCourses.length > 0;
            }

            if (!hasAccess) {
                return res.status(400).json({ error: 'Course does not belong to this patient' });
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

            validatedCourseId = course_id;
        }

        // Auto-create PN case
        let pnCaseId = pn_case_id || null;
        let autoCreatedPN = false;

        if (validBookingType === 'OLD_PATIENT' && auto_create_pn && patient_id && !pnCaseId) {
            try {
                const [patients] = await db.execute(
                    'SELECT clinic_id, first_name, last_name, diagnosis FROM patients WHERE id = ?',
                    [patient_id]
                );

                if (patients.length > 0) {
                    const patient = patients[0];
                    const pnCode = await generatePNCode(db);

                    const [pnResult] = await db.execute(
                        `INSERT INTO pn_cases (
                            pn_code, patient_id, diagnosis, purpose, status,
                            source_clinic_id, target_clinic_id, notes, created_by
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            pnCode,
                            patient_id,
                            patient.diagnosis || 'Appointment for physiotherapy treatment',
                            'Physiotherapy treatment from appointment booking',
                            'PENDING',
                            patient.clinic_id,
                            clinic_id,
                            `Auto-created from appointment on ${appointment_date}`,
                            req.user.id
                        ]
                    );

                    pnCaseId = pnResult.insertId;
                    autoCreatedPN = true;

                    console.log(`Auto-created PN case ${pnCode} (ID: ${pnCaseId}) for appointment`);
                }
            } catch (pnError) {
                console.error('Failed to auto-create PN case:', pnError);
            }
        }

        // Create appointment
        const [result] = await db.execute(
            `INSERT INTO appointments
             (patient_id, pt_id, clinic_id, appointment_date, start_time, end_time,
              appointment_type, booking_type, walk_in_name, walk_in_email, walk_in_phone,
              pn_case_id, auto_created_pn, course_id, reason, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                validBookingType === 'OLD_PATIENT' ? patient_id : null,
                pt_id,
                clinic_id,
                appointment_date,
                start_time,
                end_time,
                appointment_type,
                validBookingType,
                validBookingType === 'WALK_IN' ? sanitizedWalkInName : null,
                validBookingType === 'WALK_IN' ? (sanitizedWalkInEmail || null) : null,
                validBookingType === 'WALK_IN' ? (sanitizedWalkInPhone || null) : null,
                pnCaseId,
                autoCreatedPN ? 1 : 0,
                validatedCourseId,
                reason,
                notes,
                req.user.id
            ]
        );

        const [appointments] = await db.execute(
            `${appointmentSelectClause} WHERE a.id = ?`,
            [result.insertId]
        );

        const response = appointments[0];
        if (pnCaseId) {
            response.pn_case_id = pnCaseId;
            response.auto_created_pn = true;
        }

        // Send LINE notification
        try {
            const appointmentData = appointments[0];
            const patientName = validBookingType === 'WALK_IN'
                ? sanitizedWalkInName
                : `${appointmentData.patient_first_name || ''} ${appointmentData.patient_last_name || ''}`.trim();
            const ptName = appointmentData.pt_name || 'PT';
            const clinicName = appointmentData.clinic_name || 'N/A';

            const notificationMessage = `New Appointment Created\n\nAppointment ID: ${result.insertId}\nPatient: ${patientName || 'N/A'}\nPhysiotherapist: ${ptName}\nClinic: ${clinicName}\nDate: ${moment(appointment_date).format('DD/MM/YYYY')}\nTime: ${start_time} - ${end_time}`;

            await sendLINENotification(db, 'newAppointment', notificationMessage);
            await sendSMSNotification(db, 'newAppointment', notificationMessage);
        } catch (notifError) {
            console.error('Failed to send notifications:', notifError);
        }

        // Create Google Calendar event
        try {
            const appointmentData = appointments[0];
            const calendarData = {
                appointment_date: appointment_date,
                start_time: start_time,
                end_time: end_time,
                patient_name: validBookingType === 'WALK_IN'
                    ? sanitizedWalkInName
                    : `${appointmentData.patient_first_name || ''} ${appointmentData.patient_last_name || ''}`.trim(),
                patient_email: validBookingType === 'WALK_IN'
                    ? sanitizedWalkInEmail
                    : appointmentData.patient_email,
                pt_name: appointmentData.pt_name || 'PT',
                clinic_name: appointmentData.clinic_name || '',
                clinic_email: appointmentData.clinic_email,
                reason: reason
            };

            console.log('Creating calendar event for appointment:', result.insertId);
            const calendarEventId = await createGoogleCalendarEvent(db, calendarData);

            if (calendarEventId) {
                await db.execute(
                    'UPDATE appointments SET calendar_event_id = ? WHERE id = ?',
                    [calendarEventId, result.insertId]
                );
                console.log('✅ Calendar event created and saved:', calendarEventId);
            }
        } catch (calendarError) {
            console.error('Failed to create Google Calendar event:', calendarError);
        }

        // Note: Patient SMS is sent manually via user confirmation in frontend
        // See POST /api/appointments/:id/send-patient-sms endpoint

        res.status(201).json(response);
    } catch (error) {
        console.error('Create appointment error:', error);
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});

// PUT /api/appointments/:id - Update appointment (with PN case sync)
router.put('/appointments/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const {
            appointment_date,
            start_time,
            end_time,
            status,
            appointment_type,
            reason,
            notes,
            booking_type,
            patient_id,
            walk_in_name,
            walk_in_email,
            walk_in_phone,
            pt_diagnosis,
            pt_chief_complaint,
            pt_present_history,
            pt_pain_score
        } = req.body;

        const [appointments] = await db.execute(
            `SELECT a.*,
                    p.id as patient_id,
                    COALESCE(a.course_id, pn.course_id) as course_id,
                    pn.status as pn_status,
                    sc.code as source_clinic_code,
                    tc.code as target_clinic_code,
                    c.code as clinic_code,
                    c.name as clinic_name
             FROM appointments a
             LEFT JOIN pn_cases pn ON a.pn_case_id = pn.id
             LEFT JOIN patients p ON a.patient_id = p.id
             LEFT JOIN clinics sc ON pn.source_clinic_id = sc.id
             LEFT JOIN clinics tc ON pn.target_clinic_id = tc.id
             LEFT JOIN clinics c ON a.clinic_id = c.id
             WHERE a.id = ?`,
            [id]
        );

        if (appointments.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        const appointment = appointments[0];

        // Check for time conflicts if rescheduling
        if (appointment_date && start_time && end_time) {
            const [conflicts] = await db.execute(
                `SELECT id FROM appointments
                 WHERE pt_id = ? AND appointment_date = ? AND status != 'CANCELLED' AND id != ?
                   AND (
                       (start_time < ? AND end_time > ?) OR
                       (start_time < ? AND end_time > ?) OR
                       (start_time >= ? AND end_time <= ?)
                   )`,
                [appointment.pt_id, appointment_date, id, end_time, start_time, end_time, start_time, start_time, end_time]
            );

            if (conflicts.length > 0) {
                return res.status(409).json({ error: 'Time slot conflict detected' });
            }
        }

        // Build dynamic update query
        const updates = [];
        const params = [];

        if (appointment_date) {
            updates.push('appointment_date = ?');
            params.push(appointment_date);
        }
        if (start_time) {
            updates.push('start_time = ?');
            params.push(start_time);
        }
        if (end_time) {
            updates.push('end_time = ?');
            params.push(end_time);
        }
        if (status) {
            updates.push('status = ?');
            params.push(status);
        }
        if (appointment_type !== undefined) {
            updates.push('appointment_type = ?');
            params.push(appointment_type);
        }
        if (reason !== undefined) {
            updates.push('reason = ?');
            params.push(reason);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }

        const normalizedBookingType = booking_type ? booking_type.toUpperCase() : null;
        if (normalizedBookingType && !['OLD_PATIENT', 'WALK_IN'].includes(normalizedBookingType)) {
            return res.status(400).json({ error: 'Invalid booking_type' });
        }

        const trimmedWalkInName = typeof walk_in_name === 'string' ? walk_in_name.trim() : walk_in_name;
        const trimmedWalkInEmail = typeof walk_in_email === 'string' ? walk_in_email.trim() : walk_in_email;
        const trimmedWalkInPhone = typeof walk_in_phone === 'string' ? walk_in_phone.trim() : walk_in_phone;

        if (normalizedBookingType) {
            updates.push('booking_type = ?');
            params.push(normalizedBookingType);

            if (normalizedBookingType === 'OLD_PATIENT') {
                if (!patient_id) {
                    return res.status(400).json({ error: 'patient_id is required for OLD_PATIENT bookings' });
                }
                updates.push('patient_id = ?');
                params.push(patient_id);
                updates.push('walk_in_name = NULL');
                updates.push('walk_in_email = NULL');
                updates.push('walk_in_phone = NULL');
            } else if (normalizedBookingType === 'WALK_IN') {
                if (!trimmedWalkInName) {
                    return res.status(400).json({ error: 'walk_in_name is required for WALK_IN bookings' });
                }
                updates.push('patient_id = NULL');
                updates.push('walk_in_name = ?');
                params.push(trimmedWalkInName);
                updates.push('walk_in_email = ?');
                params.push(trimmedWalkInEmail || null);
                updates.push('walk_in_phone = ?');
                params.push(trimmedWalkInPhone || null);
            }
        }

        // Update appointment if there are changes
        if (updates.length > 0) {
            updates.push('updated_at = CURRENT_TIMESTAMP');
            params.push(id);

            await db.execute(
                `UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`,
                params
            );
        }

        // Send LINE notification if appointment is rescheduled
        if (appointment_date || start_time || end_time) {
            try {
                // Get updated appointment data with patient/PT details
                const [updatedAppointments] = await db.execute(
                    `${appointmentSelectClause} WHERE a.id = ?`,
                    [id]
                );

                if (updatedAppointments.length > 0) {
                    const updatedApt = updatedAppointments[0];
                    const finalDate = appointment_date || appointment.appointment_date;
                    const finalStartTime = start_time || appointment.start_time;
                    const finalEndTime = end_time || appointment.end_time;
                    const patientName = updatedApt.patient_name || updatedApt.walk_in_name || 'Walk-in Patient';
                    const ptName = updatedApt.pt_name || 'PT';
                    const clinicName = updatedApt.clinic_name || '';

                    // Send notifications for reschedule
                    try {
                        const notificationMessage = `Appointment Rescheduled\n\nAppointment ID: ${id}\nPatient: ${patientName}\nPhysiotherapist: ${ptName}\nClinic: ${clinicName}\nNew Date: ${moment(finalDate).format('DD/MM/YYYY')}\nNew Time: ${finalStartTime} - ${finalEndTime}`;
                        await sendLINENotification(db, 'appointmentRescheduled', notificationMessage);
                        await sendSMSNotification(db, 'appointmentRescheduled', notificationMessage);
                        console.log('✅ Notifications sent for reschedule');
                    } catch (notifError) {
                        console.error('Failed to send notifications for reschedule:', notifError);
                    }
                }
            } catch (error) {
                console.error('Failed to send reschedule notification:', error);
            }
        }

        // Update Google Calendar event if appointment is rescheduled and has calendar event
        if ((appointment_date || start_time || end_time) && appointment.calendar_event_id) {
            try {
                // Get updated appointment data with patient/PT details
                const [updatedAppointments] = await db.execute(
                    `${appointmentSelectClause} WHERE a.id = ?`,
                    [id]
                );

                if (updatedAppointments.length > 0) {
                    const updatedApt = updatedAppointments[0];
                    const calendarData = {
                        appointment_date: appointment_date || appointment.appointment_date,
                        start_time: start_time || appointment.start_time,
                        end_time: end_time || appointment.end_time,
                        patient_name: updatedApt.patient_name || updatedApt.walk_in_name || 'Walk-in Patient',
                        patient_email: updatedApt.patient_email || updatedApt.walk_in_email,
                        pt_name: updatedApt.pt_name || 'PT',
                        clinic_name: updatedApt.clinic_name || '',
                        clinic_email: updatedApt.clinic_email,
                        reason: reason || appointment.reason
                    };

                    console.log('Updating calendar event for rescheduled appointment:', id);
                    const updated = await updateGoogleCalendarEvent(db, appointment.calendar_event_id, calendarData);

                    if (updated) {
                        console.log('✅ Calendar event updated with reschedule notification sent to attendees');
                    } else {
                        console.warn('⚠️ Failed to update calendar event, but appointment was rescheduled');
                    }
                }
            } catch (calendarError) {
                console.error('Failed to update Google Calendar event:', calendarError);
                // Don't fail the appointment update if calendar update fails
            }
        }

        // Note: Patient SMS for reschedule is sent via calendar invitation if patient has email
        // Manual SMS option not needed for reschedule since patient already knows appointment exists

        // Sync with PN case if linked
        if (appointment.pn_case_id) {
            // COMPLETED → ACCEPTED
            if (status === 'COMPLETED') {
                const isCL001 = appointment.clinic_code === 'CL001' ||
                               appointment.source_clinic_code === 'CL001' ||
                               appointment.target_clinic_code === 'CL001';

                if (!isCL001) {
                    if (!pt_diagnosis || !pt_chief_complaint || !pt_present_history || pt_pain_score === undefined) {
                        return res.status(400).json({
                            error: 'PT assessment required for non-CL001 clinics',
                            required_fields: ['pt_diagnosis', 'pt_chief_complaint', 'pt_present_history', 'pt_pain_score']
                        });
                    }

                    await db.execute(
                        `UPDATE pn_cases
                         SET status = 'ACCEPTED',
                             accepted_at = NOW(),
                             pt_diagnosis = ?,
                             pt_chief_complaint = ?,
                             pt_present_history = ?,
                             pt_pain_score = ?,
                             updated_at = NOW()
                         WHERE id = ?`,
                        [pt_diagnosis, pt_chief_complaint, pt_present_history, pt_pain_score, appointment.pn_case_id]
                    );
                } else {
                    await db.execute(
                        `UPDATE pn_cases
                         SET status = 'ACCEPTED',
                             accepted_at = NOW(),
                             updated_at = NOW()
                         WHERE id = ?`,
                        [appointment.pn_case_id]
                    );
                }

                // Handle course session deduction
                if (appointment.course_id) {
                    const [usageHistory] = await db.execute(
                        `SELECT id FROM course_usage_history
                         WHERE course_id = ? AND pn_id = ? AND action_type = 'USE'
                         LIMIT 1`,
                        [appointment.course_id, appointment.pn_case_id]
                    );

                    if (usageHistory.length === 0) {
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
                            [appointment.course_id]
                        );

                        await db.execute(
                            `INSERT INTO course_usage_history
                             (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                             VALUES (?, NULL, ?, 1, CURDATE(), 'USE', 'Appointment completed - PN case accepted - session deducted', ?)`,
                            [appointment.course_id, appointment.pn_case_id, req.user.id]
                        ).catch(err => console.warn('Failed to log course usage:', err.message));
                    }
                }

                await db.execute(
                    `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, is_reversal)
                     VALUES (?, ?, 'ACCEPTED', ?, FALSE)`,
                    [appointment.pn_case_id, appointment.pn_status, req.user.id]
                ).catch(err => console.warn('Failed to log status history:', err.message));
            }
            // SCHEDULED ← COMPLETED: Reverse to PENDING
            else if (status === 'SCHEDULED' && appointment.status === 'COMPLETED') {
                if (req.user.role !== 'ADMIN') {
                    return res.status(403).json({ error: 'Only ADMIN can reverse completed appointments' });
                }

                await db.execute(
                    `UPDATE pn_cases
                     SET status = 'PENDING',
                         accepted_at = NULL,
                         pt_diagnosis = NULL,
                         pt_chief_complaint = NULL,
                         pt_present_history = NULL,
                         pt_pain_score = NULL,
                         updated_at = NOW()
                     WHERE id = ?`,
                    [appointment.pn_case_id]
                );

                if (appointment.course_id) {
                    const [usageHistory] = await db.execute(
                        `SELECT id FROM course_usage_history
                         WHERE course_id = ? AND pn_id = ? AND action_type = 'USE'
                         LIMIT 1`,
                        [appointment.course_id, appointment.pn_case_id]
                    );

                    if (usageHistory.length > 0) {
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
                            [appointment.course_id]
                        );

                        await db.execute(
                            `INSERT INTO course_usage_history
                             (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                             VALUES (?, NULL, ?, 1, CURDATE(), 'RETURN', 'Appointment reversed - session returned', ?)`,
                            [appointment.course_id, appointment.pn_case_id, req.user.id]
                        ).catch(err => console.warn('Failed to log course return:', err.message));
                    }
                }

                await db.execute(
                    `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, is_reversal)
                     VALUES (?, ?, 'PENDING', ?, TRUE)`,
                    [appointment.pn_case_id, appointment.pn_status, req.user.id]
                ).catch(err => console.warn('Failed to log status history:', err.message));
            }
            // CANCELLED: Return course session if was COMPLETED/ACCEPTED
            else if (status === 'CANCELLED') {
                if (appointment.course_id) {
                    const [usageHistory] = await db.execute(
                        `SELECT id FROM course_usage_history
                         WHERE course_id = ? AND pn_id = ? AND action_type = 'USE'
                         LIMIT 1`,
                        [appointment.course_id, appointment.pn_case_id]
                    );

                    if (usageHistory.length > 0) {
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
                            [appointment.course_id]
                        );

                        await db.execute(
                            `INSERT INTO course_usage_history
                             (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                             VALUES (?, NULL, ?, 1, CURDATE(), 'RETURN', 'Appointment cancelled - session returned', ?)`,
                            [appointment.course_id, appointment.pn_case_id, req.user.id]
                        ).catch(err => console.warn('Failed to log course return:', err.message));
                    }
                }

                await db.execute(
                    `UPDATE pn_cases
                     SET status = 'CANCELLED',
                         cancelled_at = NOW(),
                         updated_at = NOW()
                     WHERE id = ?`,
                    [appointment.pn_case_id]
                );
            }
        }

        res.json({ message: 'Appointment updated successfully' });
    } catch (error) {
        console.error('Update appointment error:', error);
        res.status(500).json({ error: 'Failed to update appointment' });
    }
});

// DELETE /api/appointments/:id - Cancel appointment
router.delete('/appointments/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { cancellation_reason } = req.body;

        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            return res.status(403).json({ error: 'Only ADMIN or PT can cancel appointments' });
        }

        const [appointments] = await db.execute(
            `SELECT a.*,
                    COALESCE(a.course_id, pn.course_id) as course_id,
                    pn.status as pn_status,
                    p.first_name as patient_first_name,
                    p.last_name as patient_last_name,
                    pt.first_name as pt_first_name,
                    pt.last_name as pt_last_name,
                    c.name as clinic_name
             FROM appointments a
             LEFT JOIN pn_cases pn ON a.pn_case_id = pn.id
             LEFT JOIN patients p ON a.patient_id = p.id
             LEFT JOIN users pt ON a.pt_id = pt.id
             LEFT JOIN clinics c ON a.clinic_id = c.id
             WHERE a.id = ?`,
            [id]
        );

        if (appointments.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        const appointment = appointments[0];

        await db.execute(
            `UPDATE appointments
             SET status = 'CANCELLED',
                 cancellation_reason = ?,
                 cancelled_at = NOW(),
                 cancelled_by = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [cancellation_reason || '', req.user.id, id]
        );

        // Sync with PN case
        if (appointment.pn_case_id) {
            if (appointment.pn_status === 'ACCEPTED' && appointment.course_id) {
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
                    [appointment.course_id]
                );

                await db.execute(
                    `INSERT INTO course_usage_history
                     (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                     VALUES (?, NULL, ?, 1, CURDATE(), 'RETURN', 'Appointment cancelled - session returned', ?)`,
                    [appointment.course_id, appointment.pn_case_id, req.user.id]
                ).catch(err => console.warn('Failed to log course return:', err.message));
            }

            await db.execute(
                `UPDATE pn_cases
                 SET status = 'CANCELLED',
                     cancelled_at = NOW(),
                     cancellation_reason = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [cancellation_reason || 'Cancelled from appointment', appointment.pn_case_id]
            );

            await db.execute(
                `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, change_reason, is_reversal)
                 VALUES (?, ?, 'CANCELLED', ?, ?, FALSE)`,
                [appointment.pn_case_id, appointment.pn_status, req.user.id, cancellation_reason || 'Cancelled from appointment']
            ).catch(err => console.warn('Failed to log status history:', err.message));
        }

        // Send LINE notification
        try {
            const patientName = appointment.booking_type === 'WALK_IN'
                ? appointment.walk_in_name
                : `${appointment.patient_first_name || ''} ${appointment.patient_last_name || ''}`.trim();
            const ptName = `${appointment.pt_first_name || ''} ${appointment.pt_last_name || ''}`.trim() || 'PT';
            const clinicName = appointment.clinic_name || 'N/A';

            const notificationMessage = `Appointment Cancelled\n\nAppointment ID: ${id}\nPatient: ${patientName || 'N/A'}\nPhysiotherapist: ${ptName}\nClinic: ${clinicName}\nDate: ${moment(appointment.appointment_date).format('DD/MM/YYYY')}\nTime: ${appointment.start_time} - ${appointment.end_time}\n${cancellation_reason ? `Reason: ${cancellation_reason}` : ''}\n${appointment.pn_case_id ? 'Linked PN Case also cancelled' : ''}`;

            await sendLINENotification(db, 'appointmentCancelled', notificationMessage);
            await sendSMSNotification(db, 'appointmentCancelled', notificationMessage);
        } catch (notifError) {
            console.error('Failed to send notifications:', notifError);
        }

        // Delete Google Calendar event and send cancellation emails
        try {
            if (appointment.calendar_event_id) {
                console.log('Deleting calendar event and sending cancellation emails:', appointment.calendar_event_id);
                const deleted = await deleteGoogleCalendarEvent(db, appointment.calendar_event_id);
                if (deleted) {
                    await db.execute(
                        'UPDATE appointments SET calendar_event_id = NULL WHERE id = ?',
                        [id]
                    );
                    console.log('✅ Calendar event deleted and cancellation emails sent to attendees');
                }
            }
        } catch (calendarError) {
            console.error('Failed to delete Google Calendar event:', calendarError);
        }

        // Note: Patient SMS for cancellation is sent via calendar event deletion if patient has email
        // Manual SMS option not needed for cancellation

        res.json({
            message: 'Appointment cancelled successfully',
            pn_synced: !!appointment.pn_case_id
        });
    } catch (error) {
        console.error('Cancel appointment error:', error);
        res.status(500).json({ error: 'Failed to cancel appointment' });
    }
});

// POST /api/appointments/:id/send-patient-sms - Manually send SMS to patient (user confirmation required)
router.post('/appointments/:id/send-patient-sms', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get appointment details with patient info
        const [appointments] = await db.execute(
            `${appointmentSelectClause} WHERE a.id = ?`,
            [id]
        );

        if (appointments.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        const appointment = appointments[0];

        // Get phone number from patient record or walk-in data
        const patientPhone = appointment.booking_type === 'WALK_IN'
            ? appointment.walk_in_phone
            : appointment.patient_phone;

        if (!patientPhone || patientPhone.trim() === '') {
            return res.status(400).json({ error: 'Patient/visitor has no phone number' });
        }

        const patientName = appointment.booking_type === 'WALK_IN'
            ? appointment.walk_in_name
            : `${appointment.patient_first_name || ''} ${appointment.patient_last_name || ''}`.trim();
        const ptName = appointment.pt_name || 'PT';
        const clinicName = appointment.clinic_name || '';

        // Get SMS template from database
        let smsTemplate;
        try {
            const [templates] = await db.execute(`
                SELECT setting_value FROM notification_settings WHERE setting_type = 'sms_template' LIMIT 1
            `);

            if (templates.length > 0) {
                smsTemplate = templates[0].setting_value;
            } else {
                // Use default template if not found
                smsTemplate = `[{clinicName}] Appointment Confirmed

Dear {patientName},

Your appointment has been booked:
📅 Date: {date}
🕐 Time: {startTime} - {endTime}
👨‍⚕️ Therapist: {ptName}
🏥 Clinic: {clinicName}

Please arrive 10 minutes early.

Thank you!`;
            }
        } catch (err) {
            console.error('Error loading SMS template:', err);
            // Fallback to default
            smsTemplate = `[{clinicName}] Appointment Confirmed

Dear {patientName},

Your appointment has been booked:
📅 Date: {date}
🕐 Time: {startTime} - {endTime}
👨‍⚕️ Therapist: {ptName}
🏥 Clinic: {clinicName}

Please arrive 10 minutes early.

Thank you!`;
        }

        // Replace placeholders in template
        const smsMessage = smsTemplate
            .replace(/{clinicName}/g, clinicName)
            .replace(/{patientName}/g, patientName)
            .replace(/{date}/g, moment(appointment.appointment_date).format('DD/MM/YYYY'))
            .replace(/{startTime}/g, appointment.start_time)
            .replace(/{endTime}/g, appointment.end_time)
            .replace(/{ptName}/g, ptName)
            .replace(/{appointmentType}/g, appointment.appointment_type || 'Appointment');

        console.log(`📱 Attempting to send SMS to: ${patientPhone}`);
        console.log(`👤 Patient name: ${patientName}`);
        console.log(`📋 Message preview: ${smsMessage.substring(0, 100)}...`);

        const success = await sendPatientSMS(db, patientPhone, smsMessage);

        if (success) {
            console.log(`✅ SMS sent successfully to ${patientPhone}`);
            res.json({
                success: true,
                message: 'SMS sent successfully',
                phone: patientPhone
            });
        } else {
            console.error(`❌ Failed to send SMS to ${patientPhone} - check server logs above for reason`);
            res.status(500).json({
                error: 'Failed to send SMS',
                hint: 'Check: 1) SMS enabled in settings, 2) API credentials correct, 3) Sender name is DEMO'
            });
        }

    } catch (error) {
        console.error('❌ Send patient SMS error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            error: 'Server error while sending SMS',
            details: error.message
        });
    }
});

// PUT /api/appointments/:id/complete - Update appointment completion with body annotation
router.put('/appointments/:id/complete', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { body_annotation_id } = req.body;

        const [appointments] = await db.execute(
            `SELECT pn_case_id, appointment_type FROM appointments WHERE id = ?`,
            [id]
        );

        if (appointments.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        const appointment = appointments[0];

        await db.execute(
            `UPDATE appointments
            SET status = 'COMPLETED', body_annotation_id = ?, updated_at = NOW()
            WHERE id = ?`,
            [body_annotation_id || null, id]
        );

        if (appointment.pn_case_id && body_annotation_id) {
            await db.execute(
                `UPDATE pn_cases
                SET body_annotation_id = ?, status = 'ACCEPTED', accepted_at = NOW(), updated_at = NOW()
                WHERE id = ?`,
                [body_annotation_id, appointment.pn_case_id]
            );

            console.log(`Synced: Appointment ${id} COMPLETED → PN Case ${appointment.pn_case_id} ACCEPTED with body annotation ${body_annotation_id}`);
        }

        res.json({ message: 'Appointment completed successfully' });
    } catch (error) {
        console.error('Complete appointment error:', error);
        res.status(500).json({ error: 'Failed to complete appointment' });
    }
});

// ========================================
// FILE ATTACHMENT ROUTES (PN Cases)
// ========================================

// POST /api/pn/:id/upload - Upload attachment
router.post('/pn/:id/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const pnId = req.params.id;
        const file = req.file;
        const userId = req.user.id;

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const [result] = await db.execute(
            `INSERT INTO pn_attachments (pn_id, file_name, file_path, mime_type, file_size, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [pnId, file.originalname, file.path, file.mimetype, file.size, userId]
        );

        await auditLog(db, userId, 'UPLOAD_ATTACHMENT', 'pn_attachment', result.insertId, null, file, req);

        const [newAttachment] = await db.execute(
            `SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) as uploaded_by_name
             FROM pn_attachments a
             JOIN users u ON a.uploaded_by = u.id
             WHERE a.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'File uploaded successfully',
            attachment: newAttachment[0]
        });

    } catch (error) {
        console.error('Upload attachment error:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// GET /api/attachment/:id/download - Download attachment
router.get('/attachment/:id/download', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [attachments] = await db.execute(
            `SELECT pa.*, pn.source_clinic_id, pn.target_clinic_id
             FROM pn_attachments pa
             JOIN pn_cases pn ON pa.pn_id = pn.id
             WHERE pa.id = ?`,
            [id]
        );

        if (attachments.length === 0) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const attachment = attachments[0];

        // Check clinic access
        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            if (req.user.role === 'CLINIC') {
                const hasAccess = (
                    req.user.clinic_id === attachment.source_clinic_id ||
                    req.user.clinic_id === attachment.target_clinic_id
                );

                if (!hasAccess) {
                    return res.status(403).json({ error: 'No access to this attachment' });
                }
            } else {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
        }

        const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
        const filePath = path.resolve(attachment.file_path);

        if (!filePath.startsWith(uploadDir)) {
            console.error('Path traversal attempt detected:', filePath);
            return res.status(403).json({ error: 'Invalid file path' });
        }

        try {
            await fs.promises.access(filePath);
            res.download(filePath, attachment.file_name);
        } catch {
            return res.status(404).json({ error: 'File not found on server' });
        }

    } catch (error) {
        console.error('Download attachment error:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// DELETE /api/attachment/:id - Delete attachment
router.delete('/attachment/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [attachments] = await db.execute(
            `SELECT pa.*, pn.source_clinic_id, pn.target_clinic_id
             FROM pn_attachments pa
             JOIN pn_cases pn ON pa.pn_id = pn.id
             WHERE pa.id = ?`,
            [id]
        );

        if (attachments.length === 0) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const attachment = attachments[0];

        const allowedRoles = ['ADMIN', 'PT', 'PT_ADMIN'];
        if (!allowedRoles.includes(req.user.role)) {
            if (req.user.role === 'CLINIC') {
                const hasAccess = (
                    req.user.clinic_id === attachment.source_clinic_id ||
                    req.user.clinic_id === attachment.target_clinic_id
                );

                if (!hasAccess) {
                    return res.status(403).json({ error: 'No access to delete this attachment' });
                }
            } else {
                return res.status(403).json({ error: 'You do not have permission to delete this file' });
            }
        }

        const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
        const filePath = path.resolve(attachment.file_path);

        if (!filePath.startsWith(uploadDir)) {
            console.error('Path traversal attempt detected during delete:', filePath);
            return res.status(403).json({ error: 'Invalid file path' });
        }

        try {
            await fs.promises.unlink(filePath);
        } catch (err) {
            console.error(`Failed to delete file from disk: ${filePath}`, err);
        }

        await db.execute('DELETE FROM pn_attachments WHERE id = ?', [id]);

        await auditLog(db, req.user.id, 'DELETE_ATTACHMENT', 'pn_attachment', id, attachment, null, req);

        res.json({ success: true, message: 'Attachment deleted successfully' });

    } catch (error) {
        console.error('Delete attachment error:', error);
        res.status(500).json({ error: 'Failed to delete attachment' });
    }
});

// ========================================
// VISIT AND REPORT ROUTES
// ========================================

// POST /api/pn/:id/visit - Create visit
router.post('/pn/:id/visit', authenticateToken, [
    body('visit_date').isDate(),
    body('status').isIn(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const db = req.app.locals.db;
        const pnId = req.params.id;

        const [maxVisit] = await db.execute(
            'SELECT MAX(visit_no) as max_no FROM pn_visits WHERE pn_id = ?',
            [pnId]
        );

        const visitNo = (maxVisit[0].max_no || 0) + 1;

        const [result] = await db.execute(
            `INSERT INTO pn_visits (
                pn_id, visit_no, visit_date, visit_time, status,
                chief_complaint, subjective, objective, assessment, plan,
                treatment_provided, therapist_id, duration_minutes, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                pnId, visitNo, req.body.visit_date, req.body.visit_time || null,
                req.body.status || 'SCHEDULED',
                req.body.chief_complaint || null, req.body.subjective || null,
                req.body.objective || null, req.body.assessment || null,
                req.body.plan || null, req.body.treatment_provided || null,
                req.body.therapist_id || req.user.id, req.body.duration_minutes || null,
                req.body.notes || null, req.user.id
            ]
        );

        await auditLog(db, req.user.id, 'CREATE', 'visit', result.insertId, null, req.body, req);

        res.status(201).json({
            success: true,
            message: 'Visit created successfully',
            visit_id: result.insertId,
            visit_no: visitNo
        });
    } catch (error) {
        console.error('Create visit error:', error);
        res.status(500).json({ error: 'Failed to create visit' });
    }
});

// POST /api/visit/:id/report - Generate and save report
router.post('/visit/:id/report', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const visitId = req.params.id;

        const [visits] = await db.execute(
            `SELECT v.*, pn.pn_code, pn.diagnosis, pn.purpose,
                    p.hn, p.pt_number, p.first_name, p.last_name, p.dob,
                    c.name as clinic_name, c.address as clinic_address
             FROM pn_visits v
             JOIN pn_cases pn ON v.pn_id = pn.id
             JOIN patients p ON pn.patient_id = p.id
             JOIN clinics c ON pn.target_clinic_id = c.id
             WHERE v.id = ?`,
            [visitId]
        );

        if (visits.length === 0) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        const visit = visits[0];
        const fileName = `report_${visit.pn_code}_visit${visit.visit_no}_${Date.now()}.pdf`;
        const filePath = path.join(process.env.REPORTS_DIR || './reports', fileName);

        // Create PDF
        const doc = new PDFDocument();
        const writeStream = fs.createWriteStream(filePath);
        const stream = doc.pipe(writeStream);

        // Header
        doc.fontSize(20).text('Physiotherapy Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text(visit.clinic_name, { align: 'center' });
        doc.fontSize(10).text(visit.clinic_address || '', { align: 'center' });
        doc.moveDown();

        // Report info
        doc.fontSize(12);
        doc.text(`Report Date: ${moment().format('DD/MM/YYYY HH:mm')}`);
        doc.text(`PN Code: ${visit.pn_code}`);
        doc.text(`Visit No: ${visit.visit_no}`);
        doc.moveDown();

        // Patient info
        doc.fontSize(14).text('Patient Information', { underline: true });
        doc.fontSize(11);
        doc.text(`HN: ${visit.hn}`);
        doc.text(`PT Number: ${visit.pt_number}`);
        doc.text(`Name: ${visit.first_name} ${visit.last_name}`);
        doc.text(`DOB: ${moment(visit.dob).format('DD/MM/YYYY')}`);
        doc.text(`Diagnosis: ${visit.diagnosis}`);
        doc.moveDown();

        // Visit details
        doc.fontSize(14).text('Visit Details', { underline: true });
        doc.fontSize(11);
        doc.text(`Visit Date: ${moment(visit.visit_date).format('DD/MM/YYYY')}`);
        doc.text(`Status: ${visit.status}`);

        if (visit.chief_complaint) {
            doc.moveDown();
            doc.text('Chief Complaint:', { underline: true });
            doc.text(visit.chief_complaint);
        }

        if (visit.subjective) {
            doc.moveDown();
            doc.text('Subjective:', { underline: true });
            doc.text(visit.subjective);
        }

        if (visit.objective) {
            doc.moveDown();
            doc.text('Objective:', { underline: true });
            doc.text(visit.objective);
        }

        if (visit.assessment) {
            doc.moveDown();
            doc.text('Assessment:', { underline: true });
            doc.text(visit.assessment);
        }

        if (visit.plan) {
            doc.moveDown();
            doc.text('Plan:', { underline: true });
            doc.text(visit.plan);
        }

        if (visit.treatment_provided) {
            doc.moveDown();
            doc.text('Treatment Provided:', { underline: true });
            doc.text(visit.treatment_provided);
        }

        // Generate QR code
        const downloadUrl = `${process.env.APP_BASE_URL}/api/report/${visitId}/download`;
        const qrCode = await QRCode.toDataURL(downloadUrl);

        doc.moveDown();
        doc.text('Scan QR code to download this report:', { align: 'center' });
        doc.image(qrCode, doc.page.width / 2 - 50, doc.y + 10, { width: 100 });

        // Footer
        doc.fontSize(10);
        doc.text(`Generated on ${moment().format('DD/MM/YYYY HH:mm:ss')}`,
                50, doc.page.height - 50, { align: 'center' });

        doc.end();

        await new Promise((resolve) => stream.on('finish', resolve));

        // Save report record
        const [result] = await db.execute(
            `INSERT INTO pn_reports (
                visit_id, report_type, file_path, file_name,
                mime_type, file_size, qr_code, report_data, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                visitId,
                req.body.report_type || 'PROGRESS',
                filePath,
                fileName,
                'application/pdf',
                (await fs.promises.stat(filePath)).size,
                qrCode,
                JSON.stringify(visit),
                req.user.id
            ]
        );

        await auditLog(db, req.user.id, 'CREATE', 'report', result.insertId, null,
                      { visit_id: visitId }, req);

        res.json({
            success: true,
            message: 'Report generated successfully',
            report_id: result.insertId,
            download_url: `/api/report/${result.insertId}/download`
        });
    } catch (error) {
        console.error('Generate report error:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// GET /api/report/:id/download - Download report
router.get('/report/:id/download', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [reports] = await db.execute(
            'SELECT * FROM pn_reports WHERE id = ?',
            [id]
        );

        if (reports.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }

        const report = reports[0];

        try {
            await fs.promises.access(report.file_path);
        } catch {
            return res.status(404).json({ error: 'Report file not found' });
        }

        res.download(report.file_path, report.file_name);
    } catch (error) {
        console.error('Download report error:', error);
        res.status(500).json({ error: 'Failed to download report' });
    }
});

module.exports = router;