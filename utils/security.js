// utils/security.js - Security Utilities

/**
 * Sanitize user input to prevent XSS attacks
 * Basic HTML entity encoding
 */
const sanitizeInput = (input) => {
    if (typeof input !== 'string') return input;

    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
};

/**
 * Sanitize object recursively
 */
const sanitizeObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) {
        return sanitizeInput(obj);
    }

    if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
    }

    const sanitized = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            sanitized[key] = sanitizeObject(obj[key]);
        }
    }
    return sanitized;
};

/**
 * Validate and sanitize email
 */
const sanitizeEmail = (email) => {
    if (typeof email !== 'string') return '';
    return email.toLowerCase().trim();
};

/**
 * Remove potentially dangerous characters from filename
 */
const sanitizeFilename = (filename) => {
    if (typeof filename !== 'string') return '';

    // Remove path traversal attempts and dangerous characters
    return filename
        .replace(/\.\./g, '')
        .replace(/[\/\\]/g, '')
        .replace(/[<>:"|?*]/g, '')
        .trim();
};

/**
 * Check if password has been compromised (basic check)
 * In production, integrate with HaveIBeenPwned API
 */
const isCommonPassword = (password) => {
    const commonPasswords = [
        'password', '123456', '12345678', 'qwerty', 'abc123',
        'monkey', '1234567', 'letmein', 'trustno1', 'dragon',
        'baseball', 'iloveyou', 'master', 'sunshine', 'ashley',
        'bailey', 'passw0rd', 'shadow', '123123', '654321'
    ];

    return commonPasswords.includes(password.toLowerCase());
};

/**
 * Generate secure random token
 */
const generateSecureToken = (length = 32) => {
    const crypto = require('crypto');
    return crypto.randomBytes(length).toString('hex');
};

/**
 * Check for SQL injection patterns (additional layer of defense)
 * Note: This should NOT replace parameterized queries
 */
const containsSQLInjection = (input) => {
    if (typeof input !== 'string') return false;

    const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/i,
        /(--|\*\/|\/\*)/,
        /(\bOR\b.*=.*|1=1|1=0)/i,
        /(\bUNION\b.*\bSELECT\b)/i,
        /(;|\||&&)/
    ];

    return sqlPatterns.some(pattern => pattern.test(input));
};

/**
 * Rate limiting store for failed login attempts
 */
class LoginAttemptTracker {
    constructor() {
        this.attempts = new Map();
        this.lockouts = new Map();

        // Clean up old entries every hour
        setInterval(() => this.cleanup(), 60 * 60 * 1000);
    }

    /**
     * Record failed login attempt
     */
    recordFailedAttempt(identifier) {
        const now = Date.now();
        const key = identifier.toLowerCase();

        if (!this.attempts.has(key)) {
            this.attempts.set(key, []);
        }

        this.attempts.get(key).push(now);

        // Keep only last 15 minutes of attempts
        const fifteenMinutesAgo = now - (15 * 60 * 1000);
        const recentAttempts = this.attempts.get(key).filter(time => time > fifteenMinutesAgo);
        this.attempts.set(key, recentAttempts);

        // Lock account if too many attempts
        if (recentAttempts.length >= 5) {
            this.lockouts.set(key, now + (30 * 60 * 1000)); // Lock for 30 minutes
            return { locked: true, unlockTime: this.lockouts.get(key) };
        }

        return { locked: false, attempts: recentAttempts.length };
    }

    /**
     * Clear attempts on successful login
     */
    clearAttempts(identifier) {
        const key = identifier.toLowerCase();
        this.attempts.delete(key);
        this.lockouts.delete(key);
    }

    /**
     * Check if account is locked
     */
    isLocked(identifier) {
        const key = identifier.toLowerCase();
        const lockoutTime = this.lockouts.get(key);

        if (!lockoutTime) return { locked: false };

        if (Date.now() < lockoutTime) {
            return { locked: true, unlockTime: lockoutTime };
        }

        // Lockout expired
        this.lockouts.delete(key);
        this.attempts.delete(key);
        return { locked: false };
    }

    /**
     * Get remaining attempts before lockout
     */
    getRemainingAttempts(identifier) {
        const key = identifier.toLowerCase();
        const attempts = this.attempts.get(key) || [];
        const now = Date.now();
        const fifteenMinutesAgo = now - (15 * 60 * 1000);
        const recentAttempts = attempts.filter(time => time > fifteenMinutesAgo);

        return Math.max(0, 5 - recentAttempts.length);
    }

    /**
     * Cleanup old entries
     */
    cleanup() {
        const now = Date.now();

        // Clean lockouts
        for (const [key, unlockTime] of this.lockouts.entries()) {
            if (now > unlockTime) {
                this.lockouts.delete(key);
            }
        }

        // Clean attempts
        const fifteenMinutesAgo = now - (15 * 60 * 1000);
        for (const [key, attempts] of this.attempts.entries()) {
            const recentAttempts = attempts.filter(time => time > fifteenMinutesAgo);
            if (recentAttempts.length === 0) {
                this.attempts.delete(key);
            } else {
                this.attempts.set(key, recentAttempts);
            }
        }
    }
}

// Create singleton instance
const loginAttemptTracker = new LoginAttemptTracker();

module.exports = {
    sanitizeInput,
    sanitizeObject,
    sanitizeEmail,
    sanitizeFilename,
    isCommonPassword,
    generateSecureToken,
    containsSQLInjection,
    loginAttemptTracker
};
