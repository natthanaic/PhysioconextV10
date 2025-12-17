// middleware/csrf.js - CSRF Protection Middleware
const crypto = require('crypto');

/**
 * Generate CSRF token
 */
const generateCSRFToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * CSRF Protection Middleware
 * Generates and validates CSRF tokens for state-changing operations
 */
const csrfProtection = (req, res, next) => {
    // Generate token if not exists
    if (!req.session.csrfToken) {
        req.session.csrfToken = generateCSRFToken();
    }

    // Make token available to views
    res.locals.csrfToken = req.session.csrfToken;

    // For GET, HEAD, OPTIONS requests, just pass through
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // For state-changing requests, validate token
    const tokenFromClient = req.body._csrf || req.headers['x-csrf-token'];

    if (!tokenFromClient || tokenFromClient !== req.session.csrfToken) {
        console.error('CSRF validation failed:', {
            method: req.method,
            path: req.path,
            sessionToken: req.session.csrfToken,
            clientToken: tokenFromClient
        });
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }

    next();
};

/**
 * Generate new CSRF token endpoint
 */
const refreshCSRFToken = (req, res) => {
    req.session.csrfToken = generateCSRFToken();
    res.json({ csrfToken: req.session.csrfToken });
};

module.exports = {
    csrfProtection,
    generateCSRFToken,
    refreshCSRFToken
};
