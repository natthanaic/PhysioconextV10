// utils/helpers.js - General Helper Functions
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

// ========================================
// CODE GENERATORS
// ========================================

// Generate unique PT numbers
const generatePTNumber = () => {
    // Use timestamp + UUID to guarantee uniqueness (no collision possible)
    const timestamp = moment().format('YYYYMMDDHHmmss');
    const uuid = uuidv4().split('-')[0]; // First 8 chars of UUID
    return `PT${timestamp}-${uuid}`;
};

// Generate unique PN codes
const generatePNCode = async (db) => {
    // Format: PNYYMMXXXX
    // YY = Year (last 2 digits), MM = Month (01-12), XXXX = Sequence (0001-9999)
    // Sequence continues throughout the year and resets only on new year

    const now = moment();
    const year = now.format('YY');  // Last 2 digits of year
    const month = now.format('MM'); // Month with leading zero
    const currentYear = now.format('YYYY'); // Full year for query

    // Get the highest sequence number for the current year (across all months)
    const [result] = await db.execute(
        `SELECT MAX(CAST(RIGHT(pn_code, 4) AS UNSIGNED)) as max_sequence
         FROM pn_cases
         WHERE pn_code LIKE ?
         AND YEAR(created_at) = ?`,
        [`PN${year}%`, currentYear]
    );

    let sequence = 1; // Default to 0001 if no codes exist for this year

    if (result.length > 0 && result[0].max_sequence !== null) {
        sequence = result[0].max_sequence + 1;

        // Check if we've exceeded the max sequence (9999)
        if (sequence > 9999) {
            throw new Error('PN code sequence limit reached for this year (max 9999)');
        }
    }

    // Format sequence with leading zeros (0001-9999)
    const sequenceStr = sequence.toString().padStart(4, '0');

    return `PN${year}${month}${sequenceStr}`;
};

// ========================================
// VALIDATION HELPERS
// ========================================

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

// Validate pagination parameters
const validatePagination = (page, limit, maxLimit = 100) => {
    const validPage = safeParseInt(page, 1, 1);
    const validLimit = safeParseInt(limit, 20, 1, maxLimit);
    const offset = (validPage - 1) * validLimit;

    return {
        page: validPage,
        limit: validLimit,
        offset: offset
    };
};

// Validate date range
const validateDateRange = (fromDate, toDate) => {
    const errors = [];

    if (fromDate && !moment(fromDate, 'YYYY-MM-DD', true).isValid()) {
        errors.push('Invalid from_date format. Use YYYY-MM-DD');
    }

    if (toDate && !moment(toDate, 'YYYY-MM-DD', true).isValid()) {
        errors.push('Invalid to_date format. Use YYYY-MM-DD');
    }

    if (fromDate && toDate && moment(fromDate).isAfter(moment(toDate))) {
        errors.push('from_date must be before or equal to to_date');
    }

    return {
        valid: errors.length === 0,
        errors: errors
    };
};

module.exports = {
    generatePTNumber,
    generatePNCode,
    safeParseInt,
    validatePagination,
    validateDateRange
};
