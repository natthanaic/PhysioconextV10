// utils/auth-helpers.js - Authentication Helper Functions
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// ========================================
// PASSWORD MANAGEMENT
// ========================================

// Hash password
const hashPassword = async (password) => {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
};

// Verify password
const verifyPassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};

// ========================================
// TOKEN MANAGEMENT
// ========================================

// Generate JWT token
const generateToken = (user) => {
    const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        clinic_id: user.clinic_id
    };
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '12h'
    });
};

module.exports = {
    hashPassword,
    verifyPassword,
    generateToken
};
