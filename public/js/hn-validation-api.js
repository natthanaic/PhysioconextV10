/**
 * HN Creation & Validation - Backend API Endpoints
 * Add these endpoints to app.js or include as a module
 */

const moment = require('moment');
const { body, validationResult } = require('express-validator');

/**
 * Generate next PTHN with format PTYYXXXX
 * @param {Object} db - MySQL database connection
 * @returns {Promise<string>} - Next PTHN (e.g., "PT250001")
 */
function generateNextPTHN(db) {
    const currentYear = parseInt(moment().format('YY'));

    return new Promise((resolve, reject) => {
        db.beginTransaction((err) => {
            if (err) return reject(err);

            const getSequenceQuery = `
                SELECT last_sequence
                FROM pthn_sequence
                WHERE year = ?
                FOR UPDATE
            `;

            db.query(getSequenceQuery, [currentYear], (err, results) => {
                if (err) {
                    return db.rollback(() => reject(err));
                }

                let nextSequence;

                if (results.length === 0) {
                    nextSequence = 1;
                    const insertQuery = `INSERT INTO pthn_sequence (year, last_sequence) VALUES (?, ?)`;

                    db.query(insertQuery, [currentYear, nextSequence], (err) => {
                        if (err) return db.rollback(() => reject(err));
                        commitAndResolve(nextSequence);
                    });
                } else {
                    nextSequence = results[0].last_sequence + 1;

                    if (nextSequence > 9999) {
                        return db.rollback(() => {
                            reject(new Error('PTHN sequence limit reached for this year (max 9999)'));
                        });
                    }

                    const updateQuery = `UPDATE pthn_sequence SET last_sequence = ? WHERE year = ?`;

                    db.query(updateQuery, [nextSequence, currentYear], (err) => {
                        if (err) return db.rollback(() => reject(err));
                        commitAndResolve(nextSequence);
                    });
                }

                function commitAndResolve(sequence) {
                    db.commit((err) => {
                        if (err) return db.rollback(() => reject(err));
                        const pthn = `PT${currentYear.toString().padStart(2, '0')}${sequence.toString().padStart(4, '0')}`;
                        resolve(pthn);
                    });
                }
            });
        });
    });
}

/**
 * Validate Thai National ID checksum
 */
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

/**
 * Validate Passport ID format
 */
function validatePassportID(passport) {
    if (!passport || typeof passport !== 'string') return false;
    passport = passport.replace(/\s/g, '');
    return /^[A-Z0-9]{6,20}$/i.test(passport);
}

/**
 * Setup HN Validation Routes
 * @param {Object} app - Express app instance
 * @param {Object} db - MySQL database connection
 * @param {Function} authenticateToken - JWT authentication middleware
 */
function setupHNValidationRoutes(app, db, authenticateToken) {

    /**
     * POST /api/patients/check-id
     * Check if Thai ID or Passport exists and get next PTHN
     * Request body: { pid: "xxx" | null, passport: "xxx" | null }
     * At least one must be provided
     */
    app.post('/api/patients/check-id', authenticateToken, async (req, res) => {
        const { pid, passport } = req.body;

        // Validation: At least one ID must be provided
        if (!pid && !passport) {
            return res.status(400).json({
                success: false,
                message: 'Please provide at least Thai ID or Passport number.'
            });
        }

        const pidValue = pid ? pid.trim() : null;
        const passportValue = passport ? passport.trim() : null;

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

            db.query(checkQuery, queryParams, async (err, results) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Database error occurred.'
                    });
                }

                if (results.length > 0) {
                    // ID exists
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
                    // ID available - generate next PTHN
                    try {
                        const nextPTHN = await generateNextPTHN(db);
                        return res.json({
                            success: true,
                            isDuplicate: false,
                            nextPTHN: nextPTHN,
                            message: 'ID is available. You can create a new patient.'
                        });
                    } catch (error) {
                        console.error('PTHN generation error:', error);
                        return res.status(500).json({
                            success: false,
                            message: error.message || 'Failed to generate PTHN.'
                        });
                    }
                }
            });

        } catch (error) {
            console.error('Check ID error:', error);
            res.status(500).json({
                success: false,
                message: 'An error occurred while checking the ID.'
            });
        }
    });

    /**
     * GET /api/admin/pthn-stats
     * Get PTHN generation statistics (Admin only)
     */
    app.get('/api/admin/pthn-stats', authenticateToken, (req, res) => {
        // Add role check if you have authorization middleware
        // For example: authorizeRole(['ADMIN'])

        const statsQuery = `
            SELECT
                year,
                last_sequence,
                CONCAT('PT', LPAD(year, 2, '0'), LPAD(last_sequence, 4, '0')) as last_pthn,
                CONCAT('PT', LPAD(year, 2, '0'), LPAD(last_sequence + 1, 4, '0')) as next_pthn,
                (9999 - last_sequence) as remaining,
                created_at,
                updated_at
            FROM pthn_sequence
            ORDER BY year DESC
        `;

        db.query(statsQuery, (err, results) => {
            if (err) {
                console.error('Stats query error:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch PTHN statistics.'
                });
            }

            res.json({
                success: true,
                stats: results
            });
        });
    });

}

// Export functions
module.exports = {
    generateNextPTHN,
    validateThaiNationalID,
    validatePassportID,
    setupHNValidationRoutes
};