// routes/patients.js - Patient Management Routes
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateToken, authorize, uploadCSV, auditLog, getAccessibleClinicIds } = require('../middleware/auth');
const { validatePagination, generatePTNumber } = require('../utils/helpers');
const csv = require('csv-parser');
const fs = require('fs');
const moment = require('moment');

// ========================================
// HELPER FUNCTIONS FOR PATIENT MANAGEMENT
// ========================================

// Validate Thai National ID checksum
function validateThaiNationalID(pid) {
    if (!pid || typeof pid !== 'string') return false;
    pid = pid.replace(/[\s-]/g, '');
    if (!/^\d{13}$/.test(pid)) return false;

    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(pid[i]) * (13 - i);
    }
    const checksum = (11 - (sum % 11)) % 10;
    return checksum === parseInt(pid[12]);
}

// Validate Passport ID format
function validatePassportID(passport) {
    if (!passport || typeof passport !== 'string') return false;
    passport = passport.replace(/\s/g, '');
    return /^[A-Z0-9]{6,20}$/i.test(passport);
}

// Safe integer parsing with validation
const safeParseInt = (value, defaultValue = 0, min = null, max = null) => {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        return defaultValue;
    }
    if (min !== null && parsed < min) {
        return min;
    }
    if (max !== null && parsed > max) {
        return max;
    }
    return parsed;
};

// Preview next PTHN WITHOUT incrementing (for showing preview to user)
async function previewNextPTHN(db) {
    const currentYear = parseInt(moment().format('YY'));

    try {
        // Just read the current sequence (no lock, no increment)
        const [rows] = await db.query(
            'SELECT last_sequence FROM pthn_sequence WHERE year = ?',
            [currentYear]
        );

        let nextSequence;

        if (rows.length === 0) {
            // First PTHN of the year would be 1
            nextSequence = 1;
        } else {
            // Next sequence would be current + 1
            nextSequence = rows[0].last_sequence + 1;
        }

        // Format PTHN
        const pthn = `PT${currentYear.toString().padStart(2, '0')}${nextSequence.toString().padStart(4, '0')}`;
        return pthn;

    } catch (error) {
        throw error;
    }
}

// Generate next PTHN with format PTYYXXXX (ACTUALLY INCREMENTS - only call when saving patient!)
async function generateNextPTHN(db) {
    const currentYear = parseInt(moment().format('YY'));
    let connection;

    try {
        // Get connection from pool (mysql2/promise)
        connection = await db.getConnection();

        // Start transaction
        await connection.beginTransaction();

        // Get current sequence with lock
        const [rows] = await connection.query(
            'SELECT last_sequence FROM pthn_sequence WHERE year = ? FOR UPDATE',
            [currentYear]
        );

        let nextSequence;

        if (rows.length === 0) {
            // First PTHN of the year
            nextSequence = 1;
            await connection.query(
                'INSERT INTO pthn_sequence (year, last_sequence) VALUES (?, ?)',
                [currentYear, nextSequence]
            );
        } else {
            // Increment sequence
            nextSequence = rows[0].last_sequence + 1;

            if (nextSequence > 9999) {
                throw new Error('PTHN sequence limit reached for this year (max 9999)');
            }

            await connection.query(
                'UPDATE pthn_sequence SET last_sequence = ? WHERE year = ?',
                [nextSequence, currentYear]
            );
        }

        // Commit transaction
        await connection.commit();

        // Format PTHN
        const pthn = `PT${currentYear.toString().padStart(2, '0')}${nextSequence.toString().padStart(4, '0')}`;
        return pthn;

    } catch (error) {
        // Rollback on error
        if (connection) {
            await connection.rollback();
        }
        throw error;
    } finally {
        // Release connection
        if (connection) {
            connection.release();
        }
    }
}

// Send LINE notification for patient events
const sendLINENotification = async (db, eventType, message) => {
    try {
        // Get LINE settings from database
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'line' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('LINE notification: No settings configured');
            return false;
        }

        const lineConfig = JSON.parse(settings[0].setting_value);

        // Check if LINE is enabled (strict integer comparison)
        if (lineConfig.enabled !== 1) {
            console.log('LINE notification: Service is disabled');
            return false;
        }

        // Check if event type is enabled
        let eventNotifications;
        if (typeof lineConfig.eventNotifications === 'string') {
            try {
                eventNotifications = JSON.parse(lineConfig.eventNotifications);
                // Handle double-encoded JSON (from old bug)
                if (typeof eventNotifications === 'string') {
                    eventNotifications = JSON.parse(eventNotifications);
                }
            } catch (e) {
                console.error('Failed to parse eventNotifications:', e);
                eventNotifications = {};
            }
        } else {
            eventNotifications = lineConfig.eventNotifications || {};
        }

        console.log(`[LINE] Checking event: ${eventType}, enabled:`, eventNotifications[eventType]);

        if (!eventNotifications[eventType]) {
            console.log(`LINE notification: Event type '${eventType}' is disabled`);
            return false;
        }

        // Validate required settings
        if (!lineConfig.accessToken) {
            console.error('LINE notification: Channel Access Token not configured');
            return false;
        }

        if (!lineConfig.targetId) {
            console.error('LINE notification: Target ID not configured');
            return false;
        }

        // Send LINE message via Messaging API
        const axios = require('axios');

        const response = await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
                to: lineConfig.targetId,
                messages: [
                    {
                        type: 'text',
                        text: message
                    }
                ]
            },
            {
                headers: {
                    Authorization: `Bearer ${lineConfig.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`LINE notification sent for event: ${eventType}`);
        return true;

    } catch (error) {
        console.error('LINE notification error:', error.message);
        return false;
    }
};

// Send SMS notification for patient events
const sendSMSNotification = async (db, eventType, message) => {
    try {
        // Get SMS settings from database
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'sms' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('SMS notification: No settings configured');
            return false;
        }

        const smsConfig = JSON.parse(settings[0].setting_value);

        // Check if SMS is enabled (strict integer comparison)
        if (smsConfig.enabled !== 1) {
            console.log('SMS notification: Service is disabled');
            return false;
        }

        // Check if event type is enabled
        let eventNotifications;
        if (typeof smsConfig.eventNotifications === 'string') {
            try {
                eventNotifications = JSON.parse(smsConfig.eventNotifications);
                // Handle double-encoded JSON (from potential old bug)
                if (typeof eventNotifications === 'string') {
                    eventNotifications = JSON.parse(eventNotifications);
                }
            } catch (e) {
                console.error('Failed to parse SMS eventNotifications:', e);
                eventNotifications = {};
            }
        } else {
            eventNotifications = smsConfig.eventNotifications || {};
        }

        console.log(`[SMS] Checking event: ${eventType}, enabled:`, eventNotifications[eventType]);

        if (!eventNotifications[eventType]) {
            console.log(`SMS notification: Event type '${eventType}' is disabled`);
            return false;
        }

        // Validate required settings
        if (!smsConfig.apiKey || !smsConfig.apiSecret || !smsConfig.recipients) {
            console.error('SMS notification: Missing required configuration');
            return false;
        }

        // Send SMS via Thai Bulk SMS API
        const axios = require('axios');

        const response = await axios.post(
            'https://api-v2.thaibulksms.com/sms',
            {
                msisdn: smsConfig.recipients,
                message: message,
                sender: smsConfig.sender || 'RehabPlus'
            },
            {
                auth: {
                    username: smsConfig.apiKey,
                    password: smsConfig.apiSecret
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.status === 200 && response.data) {
            console.log(`SMS notification sent for event: ${eventType}`);
            console.log('SMS Response:', {
                remainingCredit: response.data.remaining_credit,
                sentTo: response.data.phone_number_list
            });
            return true;
        }

        return false;

    } catch (error) {
        console.error('SMS notification error:', error.message);
        if (error.response) {
            console.error('Thai Bulk SMS API error:', error.response.data);
        }
        return false;
    }
};

// ========================================
// PATIENT ROUTES
// ========================================

// Get all patients with pagination and filtering
router.get('/', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, search } = req.query;

        // Validate pagination
        const pagination = validatePagination(req.query.page, req.query.limit);

        let query = `
            SELECT p.*, c.name as clinic_name,
                   CONCAT(u.first_name, ' ', u.last_name) as created_by_name
            FROM patients p
            JOIN clinics c ON p.clinic_id = c.id
            JOIN users u ON p.created_by = u.id
            WHERE 1=1
        `;
        let countQuery = 'SELECT COUNT(*) as total FROM patients p WHERE 1=1';
        const params = [];
        const countParams = [];

        // Role-based filtering for patients
        // ADMIN: See all patients from all clinics
        // CLINIC: See only patients registered to their clinic
        // PT: See all patients (can access everything)

        if (req.user.role === 'CLINIC') {
            // CLINIC users can only see their own clinic's patients
            if (!req.user.clinic_id) {
                return res.status(403).json({
                    error: 'CLINIC user must be assigned to a clinic'
                });
            }
            query += ' AND p.clinic_id = ?';
            countQuery += ' AND p.clinic_id = ?';
            params.push(req.user.clinic_id);
            countParams.push(req.user.clinic_id);
        }
        // ADMIN and PT roles: No filtering, they see all patients

        // Filter by specific clinic (if provided in query)
        if (clinic_id && req.user.role !== 'CLINIC') {
            const clinicIdNum = safeParseInt(clinic_id, null, 1);
            if (clinicIdNum) {
                query += ' AND p.clinic_id = ?';
                countQuery += ' AND p.clinic_id = ?';
                params.push(clinicIdNum);
                countParams.push(clinicIdNum);
            }
        }

        // Search (sanitize search input)
        if (search && search.length > 0) {
            const searchPattern = `%${search.substring(0, 100)}%`; // Limit search length
            query += ' AND (p.hn LIKE ? OR p.pt_number LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR p.diagnosis LIKE ?)';
            countQuery += ' AND (p.hn LIKE ? OR p.pt_number LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR p.diagnosis LIKE ?)';
            params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
            countParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
        }

        // Get total count
        const [countResult] = await db.execute(countQuery, countParams);
        const total = countResult[0].total;

        // Add pagination
        query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
        params.push(pagination.limit, pagination.offset);

        const [patients] = await db.execute(query, params);

        res.json({
            patients,
            pagination: {
                page: pagination.page,
                limit: pagination.limit,
                total,
                pages: Math.ceil(total / pagination.limit)
            }
        });
    } catch (error) {
        console.error('Get patients error:', error);
        res.status(500).json({ error: 'Failed to retrieve patients' });
    }
});

// Search patients (for appointment booking)
router.get('/search', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { q } = req.query;

        if (!q || q.length < 2) {
            return res.json([]);
        }

        const searchPattern = `%${q}%`;
        let query = `
            SELECT p.id, p.hn, p.pt_number, p.first_name, p.last_name, p.dob, p.gender, p.diagnosis, p.email, p.phone
            FROM patients p
            WHERE (
                p.hn LIKE ? OR
                p.pt_number LIKE ? OR
                p.first_name LIKE ? OR
                p.last_name LIKE ?
            )
        `;
        const params = [searchPattern, searchPattern, searchPattern, searchPattern];

        if (req.user.role !== 'ADMIN') {
            const accessibleClinics = await getAccessibleClinicIds(db, req.user);

            if (req.user.role === 'CLINIC' && accessibleClinics.length === 0) {
                return res.json([]);
            }

            if (accessibleClinics.length > 0) {
                query += ` AND p.clinic_id IN (${accessibleClinics.map(() => '?').join(',')})`;
                params.push(...accessibleClinics);
            }
        }

        query += ' ORDER BY p.last_name, p.first_name LIMIT 20';

        const [patients] = await db.execute(query, params);

        res.json(patients);
    } catch (error) {
        console.error('Search patients error:', error);
        res.status(500).json({ error: 'Failed to search patients' });
    }
});

// Get single patient
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [patients] = await db.execute(
            `SELECT p.*, c.name as clinic_name,
                    CONCAT(u.first_name, ' ', u.last_name) as created_by_name
             FROM patients p
             JOIN clinics c ON p.clinic_id = c.id
             JOIN users u ON p.created_by = u.id
             WHERE p.id = ?`,
            [id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        // Check clinic access
        const patient = patients[0];
        if (req.user.role !== 'ADMIN') {
            const [grants] = await db.execute(
                'SELECT clinic_id FROM user_clinic_grants WHERE user_id = ? AND clinic_id = ? UNION SELECT ? as clinic_id WHERE ? = ?',
                [req.user.id, patient.clinic_id, req.user.clinic_id, req.user.clinic_id, patient.clinic_id]
            );

            if (grants.length === 0) {
                return res.status(403).json({ error: 'No access to this patient' });
            }
        }

        res.json(patient);
    } catch (error) {
        console.error('Get patient error:', error);
        res.status(500).json({ error: 'Failed to retrieve patient' });
    }
});

// Check if Thai ID or Passport exists and get next PTHN
router.post('/check-id', authenticateToken, async (req, res) => {
    const { pid, passport } = req.body;

    const pidValue = pid ? pid.trim() : null;
    const passportValue = passport ? passport.trim() : null;

    // If no ID provided, just preview PTHN without duplicate check
    if (!pidValue && !passportValue) {
        try {
            const db = req.app.locals.db;
            const nextPTHN = await previewNextPTHN(db);
            return res.json({
                success: true,
                isDuplicate: false,
                nextPTHN: nextPTHN,
                message: 'PTHN preview (no duplicate check performed).'
            });
        } catch (error) {
            console.error('PTHN preview error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to preview PTHN.'
            });
        }
    }

    try {
        // Validate Thai ID format if provided
        if (pidValue) {
            if (!validateThaiNationalID(pidValue)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid Thai National ID format or checksum.'
                });
            }
        }

        // Validate Passport format if provided
        if (passportValue) {
            if (!validatePassportID(passportValue)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid passport format. Use 6-20 alphanumeric characters.'
                });
            }
        }

        const db = req.app.locals.db;

        // Build query to check if EITHER Thai ID OR Passport exists
        let checkQuery;
        let queryParams;

        if (pidValue && passportValue) {
            // Both provided - check either
            checkQuery = `
                SELECT
                    p.id, p.hn, p.pt_number, p.title,
                    p.first_name, p.last_name, p.dob,
                    p.created_at, c.name as clinic_name
                FROM patients p
                LEFT JOIN clinics c ON p.clinic_id = c.id
                WHERE p.pid = ? OR p.passport_no = ?
                LIMIT 1
            `;
            queryParams = [pidValue, passportValue];
        } else if (pidValue) {
            // Only Thai ID provided
            checkQuery = `
                SELECT
                    p.id, p.hn, p.pt_number, p.title,
                    p.first_name, p.last_name, p.dob,
                    p.created_at, c.name as clinic_name
                FROM patients p
                LEFT JOIN clinics c ON p.clinic_id = c.id
                WHERE p.pid = ?
                LIMIT 1
            `;
            queryParams = [pidValue];
        } else {
            // Only Passport provided
            checkQuery = `
                SELECT
                    p.id, p.hn, p.pt_number, p.title,
                    p.first_name, p.last_name, p.dob,
                    p.created_at, c.name as clinic_name
                FROM patients p
                LEFT JOIN clinics c ON p.clinic_id = c.id
                WHERE p.passport_no = ?
                LIMIT 1
            `;
            queryParams = [passportValue];
        }

        const [results] = await db.query(checkQuery, queryParams);

        if (results.length > 0) {
            // ID exists - return patient information
            const patient = results[0];
            return res.json({
                success: true,
                isDuplicate: true,
                patient: {
                    id: patient.id,
                    hn: patient.hn,
                    pt_number: patient.pt_number,
                    title: patient.title,
                    first_name: patient.first_name,
                    last_name: patient.last_name,
                    dob: patient.dob,
                    clinic_name: patient.clinic_name,
                    created_at: patient.created_at
                },
                message: 'This ID is already registered.'
            });
        } else {
            // ID available - preview next PTHN (sequence will increment only on actual patient save)
            const nextPTHN = await previewNextPTHN(db);
            return res.json({
                success: true,
                isDuplicate: false,
                nextPTHN: nextPTHN,
                message: 'ID is available. You can create a new patient.'
            });
        }

    } catch (error) {
        console.error('Check ID error:', error);

        // Check if it's a missing table error
        if (error.message && (error.message.includes('pthn_sequence') || error.code === 'ER_NO_SUCH_TABLE')) {
            return res.status(500).json({
                success: false,
                message: 'Database table missing. Run this SQL: CREATE TABLE pthn_sequence (id INT AUTO_INCREMENT PRIMARY KEY, year INT(4) NOT NULL, last_sequence INT(4) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY (year)); INSERT INTO pthn_sequence (year, last_sequence) VALUES (25, 0);'
            });
        }

        res.status(500).json({
            success: false,
            message: error.message || 'An error occurred while checking the ID.'
        });
    }
});

// Create patient
router.post('/', authenticateToken, [
    body('hn').notEmpty(),
    body('first_name').notEmpty(),
    body('last_name').notEmpty(),
    body('dob').isDate(),
    body('diagnosis').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const db = req.app.locals.db;
        const ptNumber = generatePTNumber();

        // Generate actual PTHN and increment sequence
        // The preview HN is just a preview - always generate fresh to avoid race conditions
        const actualPTHN = await generateNextPTHN(db);
        console.log('Generated HN:', actualPTHN, 'PT Number:', ptNumber);

        // Role-based clinic assignment
        // ADMIN: Can create patients for any clinic (clinic_id from request)
        // CLINIC: Can only create patients for their own clinic
        // PT: Can create patients for any clinic (clinic_id from request)

        let clinicId;

        if (req.user.role === 'CLINIC') {
            // CLINIC users can only create patients for their own clinic
            if (!req.user.clinic_id) {
                return res.status(403).json({
                    error: 'CLINIC user must be assigned to a clinic'
                });
            }
            clinicId = req.user.clinic_id; // Always use their clinic
        } else {
            // ADMIN and PT can specify clinic_id
            clinicId = req.body.clinic_id;
            if (!clinicId) {
                return res.status(400).json({
                    error: 'Clinic ID is required for patient registration'
                });
            }
        }

        const patientData = {
            ...req.body,
            pt_number: ptNumber,
            clinic_id: clinicId,
            created_by: req.user.id
        };

        // Convert empty strings to null for UNIQUE fields to avoid duplicate entry errors
        // MySQL UNIQUE constraints allow multiple NULLs but not multiple empty strings
        if (patientData.pid === '' || patientData.pid === undefined) {
            patientData.pid = null;
        }
        if (patientData.passport_no === '' || patientData.passport_no === undefined) {
            patientData.passport_no = null;
        }
        if (patientData.ssn === '' || patientData.ssn === undefined) {
            patientData.ssn = null;
        }

        console.log('Inserting patient with IDs:', {
            hn: actualPTHN,
            pt_number: ptNumber,
            pid: patientData.pid,
            passport_no: patientData.passport_no
        });

        const [result] = await db.execute(
            `INSERT INTO patients (
                hn, pt_number, pid, passport_no, title, first_name, last_name,
                dob, gender, phone, email, address, emergency_contact, emergency_phone,
                diagnosis, rehab_goal, rehab_goal_other, body_area, frequency,
                expected_duration, doctor_note, precaution, contraindication,
                medical_history, clinic_id, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                actualPTHN, ptNumber, patientData.pid, patientData.passport_no,
                patientData.title, patientData.first_name, patientData.last_name,
                patientData.dob, patientData.gender, patientData.phone, patientData.email,
                patientData.address, patientData.emergency_contact, patientData.emergency_phone,
                patientData.diagnosis, patientData.rehab_goal, patientData.rehab_goal_other,
                patientData.body_area, patientData.frequency, patientData.expected_duration,
                patientData.doctor_note, patientData.precaution, patientData.contraindication,
                patientData.medical_history, clinicId, req.user.id
            ]
        );

        await auditLog(db, req.user.id, 'CREATE', 'patient', result.insertId, null, patientData, req);

        // Send LINE notification for new patient registration
        try {
            const patientName = `${patientData.first_name} ${patientData.last_name}`.trim();

            // Get clinic name
            const [clinics] = await db.execute(
                'SELECT name FROM clinics WHERE id = ?',
                [clinicId]
            );
            const clinicName = clinics.length > 0 ? clinics[0].name : 'N/A';

            const notificationMessage = `Patient Registered

Patient ID: ${result.insertId}
PT Number: ${ptNumber}
Name: ${patientName}
${patientData.gender ? `Gender: ${patientData.gender}` : ''}
Date of Birth: ${moment(patientData.dob).format('DD/MM/YYYY')}
Phone: ${patientData.phone || 'N/A'}
Email: ${patientData.email || 'N/A'}
Clinic: ${clinicName}
Diagnosis: ${patientData.diagnosis}
${patientData.rehab_goal ? `Rehab Goal: ${patientData.rehab_goal}` : ''}`;

            await sendLINENotification(db, 'newPatient', notificationMessage);
            await sendSMSNotification(db, 'newPatient', notificationMessage);
        } catch (notifError) {
            console.error('Failed to send notifications:', notifError);
            // Don't fail the request if notification fails
        }

        res.status(201).json({
            success: true,
            message: 'Patient created successfully',
            patient_id: result.insertId,
            pt_number: ptNumber
        });
    } catch (error) {
        console.error('Create patient error:', error);

        // Send detailed error information back to client for debugging
        let errorMessage = 'Failed to create patient';
        let errorDetails = null;

        if (error.code === 'ER_DUP_ENTRY') {
            errorMessage = 'Duplicate entry detected';
            // Parse SQL message to identify which field is duplicate
            if (error.sqlMessage) {
                if (error.sqlMessage.includes("'unique_hn'")) {
                    errorMessage = 'Duplicate HN: This Hospital Number already exists';
                } else if (error.sqlMessage.includes("'pt_number'")) {
                    errorMessage = 'Duplicate PT Number: This PT Number already exists';
                } else if (error.sqlMessage.includes("'unique_pid'")) {
                    errorMessage = 'Duplicate National ID: This ID is already registered';
                } else {
                    errorMessage = 'Duplicate entry: A patient with this information already exists';
                }
            }
            errorDetails = error.sqlMessage;
        } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            errorMessage = 'Invalid clinic_id or created_by reference';
        } else if (error.code === 'ER_BAD_NULL_ERROR') {
            errorMessage = 'Required field is missing or null';
            errorDetails = error.sqlMessage;
        } else if (error.sqlMessage) {
            errorDetails = error.sqlMessage;
        }

        res.status(500).json({
            error: errorMessage,
            details: errorDetails,
            code: error.code,
            field: error.errno
        });
    }
});

// Update patient
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get current patient data
        const [patients] = await db.execute(
            'SELECT * FROM patients WHERE id = ?',
            [id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const oldData = patients[0];

        // Check clinic access
        if (req.user.role !== 'ADMIN') {
            const [grants] = await db.execute(
                'SELECT clinic_id FROM user_clinic_grants WHERE user_id = ? AND clinic_id = ? UNION SELECT ? as clinic_id WHERE ? = ?',
                [req.user.id, oldData.clinic_id, req.user.clinic_id, req.user.clinic_id, oldData.clinic_id]
            );

            if (grants.length === 0) {
                return res.status(403).json({ error: 'No access to update this patient' });
            }
        }

        // Update patient
        const updateFields = [];
        const updateValues = [];
        const allowedFields = [
            'pid', 'passport_no', 'title', 'first_name', 'last_name', 'gender',
            'phone', 'email', 'address', 'emergency_contact', 'emergency_phone',
            'diagnosis', 'rehab_goal', 'rehab_goal_other', 'body_area', 'frequency',
            'expected_duration', 'doctor_note', 'precaution', 'contraindication', 'medical_history'
        ];

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
            `UPDATE patients SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        await auditLog(db, req.user.id, 'UPDATE', 'patient', id, oldData, req.body, req);

        res.json({ success: true, message: 'Patient updated successfully' });
    } catch (error) {
        console.error('Update patient error:', error);
        res.status(500).json({ error: 'Failed to update patient' });
    }
});

// Delete patient (ADMIN only)
router.delete('/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get current patient data for audit log
        const [patients] = await db.execute(
            'SELECT * FROM patients WHERE id = ?',
            [id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patientData = patients[0];

        // Check if patient has associated PN cases
        const [pnCases] = await db.execute(
            'SELECT COUNT(*) as count FROM pn_cases WHERE patient_id = ?',
            [id]
        );

        if (pnCases[0].count > 0) {
            return res.status(400).json({
                error: 'Cannot delete patient with associated PN cases. Please delete or reassign PN cases first.'
            });
        }

        // Delete the patient (CASCADE will handle related records if configured)
        await db.execute('DELETE FROM patients WHERE id = ?', [id]);

        // Log the deletion
        await auditLog(db, req.user.id, 'DELETE', 'patient', id, patientData, null, req);

        res.json({ success: true, message: 'Patient deleted successfully' });
    } catch (error) {
        console.error('Delete patient error:', error);
        res.status(500).json({ error: 'Failed to delete patient' });
    }
});

// ========================================
// PATIENT CSV IMPORT/EXPORT
// ========================================

// Download CSV template
router.get('/csv/template', authenticateToken, (req, res) => {
    try {
        const csvHeaders = [
            'hn', 'pid', 'passport_no', 'title', 'first_name', 'last_name',
            'dob', 'gender', 'phone', 'email', 'address',
            'emergency_contact', 'emergency_phone',
            'diagnosis', 'rehab_goal', 'rehab_goal_other',
            'body_area', 'frequency', 'expected_duration',
            'doctor_note', 'precaution', 'contraindication',
            'medical_history', 'clinic_id'
        ];

        const sampleData = [
            'HN001', '1234567890123', '', 'Mr.', 'John', 'Doe',
            '1990-01-15', 'Male', '0812345678', 'john@email.com', '123 Main St',
            'Jane Doe', '0898765432',
            'Back pain', 'Improve mobility', '',
            'Lower back', '3 times/week', '6 weeks',
            'Avoid heavy lifting', 'None', 'Heart condition',
            'Previous surgery in 2020', '1'
        ];

        const csvContent = [
            csvHeaders.join(','),
            sampleData.join(','),
            csvHeaders.map(() => '').join(',') // Empty row for user to fill
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=patients_template.csv');
        res.send(csvContent);
    } catch (error) {
        console.error('Download template error:', error);
        res.status(500).json({ error: 'Failed to generate template' });
    }
});

// Import patients from CSV
router.post('/csv/import', authenticateToken, uploadCSV.single('file'), async (req, res) => {
    let filePath = null;

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        filePath = req.file.path;
        const db = req.app.locals.db;
        const results = [];
        const errors = [];
        let rowNumber = 1; // Start from 1 (header is 0)

        // Read and parse CSV
        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => results.push({ ...data, rowNumber: ++rowNumber }))
                .on('end', resolve)
                .on('error', reject);
        });

        let successCount = 0;
        let failedCount = 0;

        // Process each row
        for (const row of results) {
            try {
                // Skip empty rows
                if (!row.first_name || !row.last_name) {
                    continue;
                }

                // Generate PT number
                const ptNumber = generatePTNumber();

                // Validate required fields
                if (!row.clinic_id) {
                    errors.push({ row: row.rowNumber, error: 'clinic_id is required' });
                    failedCount++;
                    continue;
                }

                // Insert patient
                await db.execute(
                    `INSERT INTO patients (
                        hn, pt_number, pid, passport_no, title, first_name, last_name,
                        dob, gender, phone, email, address, emergency_contact, emergency_phone,
                        diagnosis, rehab_goal, rehab_goal_other, body_area, frequency,
                        expected_duration, doctor_note, precaution, contraindication,
                        medical_history, clinic_id, created_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        row.hn || null,
                        ptNumber,
                        row.pid || null,
                        row.passport_no || null,
                        row.title || null,
                        row.first_name,
                        row.last_name,
                        row.dob || null,
                        row.gender || null,
                        row.phone || null,
                        row.email || null,
                        row.address || null,
                        row.emergency_contact || null,
                        row.emergency_phone || null,
                        row.diagnosis || null,
                        row.rehab_goal || null,
                        row.rehab_goal_other || null,
                        row.body_area || null,
                        row.frequency || null,
                        row.expected_duration || null,
                        row.doctor_note || null,
                        row.precaution || null,
                        row.contraindication || null,
                        row.medical_history || null,
                        row.clinic_id,
                        req.user.id
                    ]
                );

                successCount++;
            } catch (error) {
                console.error(`Error importing row ${row.rowNumber}:`, error);
                errors.push({
                    row: row.rowNumber,
                    error: error.message
                });
                failedCount++;
            }
        }

        // Delete uploaded file
        if (filePath) {
            fs.unlinkSync(filePath);
        }

        res.json({
            success: true,
            total: results.length,
            success: successCount,
            failed: failedCount,
            errors: errors
        });

    } catch (error) {
        console.error('CSV import error:', error);

        // Clean up file on error
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.status(500).json({ error: 'Failed to import CSV: ' + error.message });
    }
});

module.exports = router;
