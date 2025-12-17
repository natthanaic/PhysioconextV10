// routes/documents.js - Document-related routes for template settings and rendering
const express = require('express');
const router = express.Router();

// ========================================
// DOCUMENT SETTINGS ROUTES
// ========================================

/**
 * GET /api/document-settings
 * Retrieve all document settings (bill, certificate, appointment card)
 * Requires: Authentication, ADMIN role
 */
router.get('/api/document-settings', (req, res, next) => {
    // Middleware will be applied from app.js
    // This route needs authenticateToken and authorize('ADMIN')

    return next();
}, async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Load all document settings
        const [settingsRows] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE 'bill_%' OR setting_key LIKE 'pt_cert_%' OR setting_key LIKE 'appointment_card_%'`
        );

        if (settingsRows.length === 0) {
            return res.json({ settings: null });
        }

        // Reconstruct settings object
        const settings = {
            bill: {},
            certificate: {},
            appointment_card: {}
        };

        settingsRows.forEach(row => {
            if (row.setting_key.startsWith('bill_')) {
                const key = row.setting_key.replace('bill_', '');
                // Convert back to camelCase
                const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());

                // Handle special conversions
                if (key === 'company_name') settings.bill.companyName = row.setting_value;
                else if (key === 'company_address') settings.bill.address = row.setting_value;
                else if (key === 'company_phone') settings.bill.phone = row.setting_value;
                else if (key === 'tax_id') settings.bill.taxId = row.setting_value;
                else if (key === 'header_color') settings.bill.headerColor = row.setting_value;
                else if (key === 'footer_text') settings.bill.footerText = row.setting_value;
                else if (key === 'show_logo') settings.bill.showLogo = row.setting_value === 'true';
                else if (key === 'show_tax_id') settings.bill.showTax = row.setting_value === 'true';
                else if (key === 'show_qr') settings.bill.showQR = row.setting_value === 'true';
            } else if (row.setting_key.startsWith('pt_cert_')) {
                const key = row.setting_key.replace('pt_cert_', '');

                // Handle conversions
                if (key === 'clinic_name') settings.certificate.clinicName = row.setting_value;
                else if (key === 'clinic_address') settings.certificate.address = row.setting_value;
                else if (key === 'border_color') settings.certificate.borderColor = row.setting_value;
                else if (key === 'doctor_name') settings.certificate.doctorName = row.setting_value;
                else if (key === 'license_number') settings.certificate.license = row.setting_value;
            } else if (row.setting_key.startsWith('appointment_card_')) {
                const key = row.setting_key.replace('appointment_card_', '');
                settings.appointment_card[key] = row.setting_value;
            }
        });

        res.json({ settings: JSON.stringify(settings) });
    } catch (error) {
        console.error('Get document settings error:', error);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

/**
 * POST /api/document-settings
 * Save/update document settings for bill, certificate, and appointment card
 * Requires: Authentication, ADMIN role
 */
router.post('/api/document-settings', (req, res, next) => {
    // Middleware will be applied from app.js
    // This route needs authenticateToken and authorize('ADMIN')

    return next();
}, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { settings } = req.body;

        console.log('=== SAVE DOCUMENT SETTINGS ===');
        console.log('Received settings:', settings);

        // Parse settings JSON
        const settingsObj = typeof settings === 'string' ? JSON.parse(settings) : settings;
        console.log('Parsed settingsObj:', JSON.stringify(settingsObj, null, 2));

        // Save individual settings for bills
        if (settingsObj.bill) {
            const billSettings = settingsObj.bill;
            const billKeys = {
                'company_name': billSettings.companyName || '',
                'company_address': billSettings.address || '',
                'company_phone': billSettings.phone || '',
                'tax_id': billSettings.taxId || '',
                'header_color': billSettings.headerColor || '#667eea',
                'footer_text': billSettings.footerText || '',
                'show_logo': billSettings.showLogo ? 'true' : 'false',
                'show_tax_id': billSettings.showTax ? 'true' : 'false',
                'show_qr': billSettings.showQR ? 'true' : 'false'
            };

            for (const [key, value] of Object.entries(billKeys)) {
                await db.execute(
                    `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
                     VALUES (?, ?, NOW(), ?)
                     ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW(), updated_by = ?`,
                    [`bill_${key}`, value, req.user.id, value, req.user.id]
                );
            }
        }

        // Save individual settings for PT certificates
        if (settingsObj.certificate) {
            const certSettings = settingsObj.certificate;
            const certKeys = {
                'clinic_name': certSettings.clinicName || '',
                'clinic_address': certSettings.address || '',
                'border_color': certSettings.borderColor || '#667eea',
                'doctor_name': certSettings.doctorName || '',
                'license_number': certSettings.license || ''
            };

            for (const [key, value] of Object.entries(certKeys)) {
                await db.execute(
                    `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
                     VALUES (?, ?, NOW(), ?)
                     ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW(), updated_by = ?`,
                    [`pt_cert_${key}`, value, req.user.id, value, req.user.id]
                );
            }
        }

        // Save individual settings for Appointment Cards
        if (settingsObj.appointment_card) {
            const apptSettings = settingsObj.appointment_card;
            const apptKeys = {
                'clinic_name': apptSettings.clinic_name || '',
                'clinic_address': apptSettings.clinic_address || '',
                'clinic_phone': apptSettings.clinic_phone || '',
                'card_size': apptSettings.card_size || 'large',
                'header_color': apptSettings.header_color || '#667eea',
                'doctor_name': apptSettings.doctor_name || '',
                'instructions': apptSettings.instructions || '',
                'show_logo': apptSettings.show_logo || 'false',
                'show_qr': apptSettings.show_qr || 'true',
                'show_map': apptSettings.show_map || 'false',
                'map_link': apptSettings.map_link || ''
            };

            for (const [key, value] of Object.entries(apptKeys)) {
                await db.execute(
                    `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
                     VALUES (?, ?, NOW(), ?)
                     ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW(), updated_by = ?`,
                    [`appointment_card_${key}`, value, req.user.id, value, req.user.id]
                );
            }
        }

        res.json({ success: true, message: 'Settings saved successfully' });
    } catch (error) {
        console.error('Save document settings error:', error);
        console.error('Error details:', error.message);
        res.status(500).json({ error: 'Failed to save settings: ' + error.message });
    }
});

// ========================================
// CENTRALIZED DOCUMENT RENDERING SYSTEM
// ========================================

/**
 * GET /documents/preview/:templateType
 * Preview document with sample data for settings page
 * Supported template types: bill, pt_cert, appointment_card
 * Requires: Authentication, ADMIN role
 */
router.get('/documents/preview/:templateType', (req, res, next) => {
    // Middleware will be applied from app.js
    // This route needs authenticateToken and authorize('ADMIN')

    return next();
}, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { templateType } = req.params;

        // Load document settings for this template type
        const [settingsRows] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE ?`,
            [`${templateType}_%`]
        );

        const settings = {};
        settingsRows.forEach(row => {
            const key = row.setting_key.replace(`${templateType}_`, '');
            settings[key] = row.setting_value;
        });

        let data, templateFile;

        // Create sample data for preview
        if (templateType === 'bill') {
            data = {
                bill_code: 'BILL-2025-001',
                bill_date: new Date().toISOString().split('T')[0],
                clinic_name: 'Sample Clinic',
                patient_name: 'John Doe',
                patient_hn: 'HN-12345',
                payment_status: 'PAID',
                payment_method: 'CASH',
                subtotal: 800.00,
                discount: 0.00,
                tax: 0.00,
                total_amount: 800.00,
                items: [
                    {
                        service_name: 'Physiotherapy Session',
                        quantity: 1,
                        unit_price: 500.00,
                        discount: 0.00,
                        total_price: 500.00
                    },
                    {
                        service_name: 'Massage Therapy',
                        quantity: 1,
                        unit_price: 300.00,
                        discount: 0.00,
                        total_price: 300.00
                    }
                ],
                bill_notes: 'Sample bill for preview',
                payment_notes: null
            };
            templateFile = 'document_bill_template';

        } else if (templateType === 'pt_cert') {
            data = {
                certificate: {
                    id: 1,
                    pn_code: 'PN-2025-001',
                    created_at: new Date().toISOString(),
                    created_by_name: 'Dr. Sample'
                },
                certData: {
                    diagnosis: 'Sample diagnosis for preview',
                    treatment_plan: 'Continue physiotherapy sessions',
                    recommendations: 'Rest and follow treatment plan'
                },
                patient: {
                    hn: 'HN-12345',
                    first_name: 'John',
                    last_name: 'Doe',
                    dob: '1990-01-01',
                    phone: '02-123-4567'
                },
                pnCase: {
                    diagnosis: 'Lower back pain',
                    purpose: 'Physiotherapy treatment',
                    created_at: new Date().toISOString(),
                    completed_at: null
                },
                clinic: {
                    name: settings.clinic_name || 'Sample Clinic',
                    address: settings.clinic_address || 'Sample Address',
                    phone: '02-123-4567',
                    email: 'info@clinic.com',
                    logo_url: settings.clinic_logo || null,
                    border_color: settings.border_color || '#667eea',
                    doctor_name: settings.doctor_name || 'Dr. Sample',
                    license_number: settings.license_number || 'LICENSE-123'
                },
                soap: {
                    subjective: 'Sample subjective notes',
                    objective: 'Sample objective findings',
                    assessment: 'Sample assessment',
                    plan: 'Sample treatment plan'
                }
            };
            templateFile = 'document_pt_cert_template';

        } else if (templateType === 'appointment_card') {
            // Generate sample QR code
            const sampleQRData = 'APPT:SAMPLE|John Doe|2025-01-20';
            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(sampleQRData)}`;

            data = {
                patient_name: 'นาย สมชาย ใจดี / John Doe',
                hn: 'HN-12345',
                appointment_date: new Date(),
                appointment_time: '14:30:00',
                pt_name: settings.doctor_name || 'ดร. สมศักดิ์ / Dr. Jane Smith',
                appointment_type: 'กายภาพบำบัดทั่วไป / General Physiotherapy',
                reason: 'ปวดหลัง / Back pain treatment',
                clinic_name: settings.clinic_name || 'Sample Clinic',
                qr_code: qrCodeUrl
            };
            templateFile = 'appointment-card';

        } else {
            return res.status(400).send('Invalid template type');
        }

        // Render the template with sample data and settings
        res.render(templateFile, {
            data,
            settings,
            user: req.user,
            isPreview: true  // Flag to disable auto-print
        });

    } catch (error) {
        console.error('Document preview error:', error);
        res.status(500).send(`Failed to preview document: ${error.message}`);
    }
});

/**
 * GET /documents/render/:templateType/:dataId
 * Render document by template type and data ID
 * Loads actual data from database and renders as EJS template
 * Supported template types: bill, pt_cert, appointment_card
 * Requires: Authentication
 */
router.get('/documents/render/:templateType/:dataId', (req, res, next) => {
    // Middleware will be applied from app.js
    // This route needs authenticateToken

    return next();
}, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { templateType, dataId } = req.params;

        // Load document settings for this template type
        console.log('=== RENDER DOCUMENT ===');
        console.log('Template type:', templateType);
        console.log('Data ID:', dataId);

        const [settingsRows] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE ?`,
            [`${templateType}_%`]
        );

        console.log('Loaded settings rows:', settingsRows);

        const settings = {};
        settingsRows.forEach(row => {
            const key = row.setting_key.replace(`${templateType}_`, '');
            settings[key] = row.setting_value;
        });

        console.log('Final settings object:', settings);

        let data, templateFile;

        // Load data based on template type
        if (templateType === 'bill') {
            // Load bill data
            const [bills] = await db.execute(
                `SELECT b.*, c.name as clinic_name,
                        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                        p.hn as patient_hn
                 FROM bills b
                 LEFT JOIN clinics c ON b.clinic_id = c.id
                 LEFT JOIN patients p ON b.patient_id = p.id
                 WHERE b.id = ?`,
                [dataId]
            );

            if (bills.length === 0) {
                return res.status(404).send('Bill not found');
            }

            // Load bill items
            const [items] = await db.execute(
                `SELECT bi.*, s.service_name
                 FROM bill_items bi
                 LEFT JOIN services s ON bi.service_id = s.id
                 WHERE bi.bill_id = ?`,
                [dataId]
            );

            data = {
                ...bills[0],
                items: items
            };
            templateFile = 'document_bill_template';

        } else if (templateType === 'pt_cert') {
            // Load PT certificate data
            const [certificates] = await db.execute(
                `SELECT c.*,
                        pn.pn_code, pn.diagnosis, pn.purpose, pn.created_at as pn_created_at,
                        pn.completed_at, pn.target_clinic_id,
                        p.hn, p.first_name, p.last_name, p.dob, p.phone,
                        cl.name as clinic_name, cl.address as clinic_address,
                        cl.phone as clinic_phone, cl.email as clinic_email,
                        CONCAT(u.first_name, ' ', u.last_name) as created_by_name
                 FROM pt_certificates c
                 JOIN pn_cases pn ON c.pn_id = pn.id
                 JOIN patients p ON pn.patient_id = p.id
                 LEFT JOIN clinics cl ON pn.target_clinic_id = cl.id
                 JOIN users u ON c.created_by = u.id
                 WHERE c.id = ?`,
                [dataId]
            );

            if (certificates.length === 0) {
                return res.status(404).send('Certificate not found');
            }

            const certificate = certificates[0];
            const certData = JSON.parse(certificate.certificate_data || '{}');

            // Get latest SOAP note
            const [soapNotes] = await db.execute(
                `SELECT subjective, objective, assessment, plan
                 FROM pn_soap_notes
                 WHERE pn_id = ?
                 ORDER BY timestamp DESC
                 LIMIT 1`,
                [certificate.pn_id]
            );

            data = {
                certificate: {
                    id: certificate.id,
                    pn_code: certificate.pn_code,
                    created_at: certificate.created_at,
                    created_by_name: certificate.created_by_name
                },
                certData,
                patient: {
                    hn: certificate.hn,
                    first_name: certificate.first_name,
                    last_name: certificate.last_name,
                    dob: certificate.dob,
                    phone: certificate.phone
                },
                pnCase: {
                    diagnosis: certificate.diagnosis,
                    purpose: certificate.purpose,
                    created_at: certificate.pn_created_at,
                    completed_at: certificate.completed_at
                },
                clinic: {
                    name: settings.clinic_name || certificate.clinic_name || 'RehabPlus',
                    address: settings.clinic_address || certificate.clinic_address || '',
                    phone: certificate.clinic_phone || '',
                    email: certificate.clinic_email || '',
                    logo_url: settings.clinic_logo || null,
                    border_color: settings.border_color || '#667eea',
                    doctor_name: settings.doctor_name || certificate.created_by_name,
                    license_number: settings.license_number || ''
                },
                soap: soapNotes.length > 0 ? soapNotes[0] : null
            };
            templateFile = 'document_pt_cert_template';

        } else if (templateType === 'appointment_card') {
            // Load appointment data with PT name
            const [appointments] = await db.execute(
                `SELECT a.*,
                        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                        p.hn,
                        c.name as clinic_name,
                        CONCAT(u.first_name, ' ', u.last_name) as pt_name
                 FROM appointments a
                 LEFT JOIN patients p ON a.patient_id = p.id
                 LEFT JOIN clinics c ON a.clinic_id = c.id
                 LEFT JOIN users u ON a.pt_id = u.id
                 WHERE a.id = ?`,
                [dataId]
            );

            if (appointments.length === 0) {
                return res.status(404).send('Appointment not found');
            }

            const appointment = appointments[0];

            // Generate QR code for appointment check-in
            const qrCodeData = `APPT:${appointment.id}|${appointment.patient_name || appointment.walk_in_name}|${appointment.appointment_date}`;
            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCodeData)}`;

            data = {
                patient_name: appointment.patient_name || appointment.walk_in_name || 'N/A',
                hn: appointment.hn || 'N/A',
                appointment_date: appointment.appointment_date,
                appointment_time: appointment.start_time,
                pt_name: appointment.pt_name || '',
                appointment_type: appointment.appointment_type || '',
                reason: appointment.notes || '',
                clinic_name: appointment.clinic_name || 'N/A',
                qr_code: qrCodeUrl
            };
            templateFile = 'appointment-card';

        } else {
            return res.status(400).send('Invalid template type');
        }

        // Render the template with data and settings
        res.render(templateFile, {
            data,
            settings,
            user: req.user,
            isPreview: false  // Enable auto-print for actual documents
        });

    } catch (error) {
        console.error('Document render error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).send(`Failed to render document: ${error.message}`);
    }
});

module.exports = router;
