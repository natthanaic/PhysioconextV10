// middleware/auth.js - Authentication and Authorization Middleware
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');

// ========================================
// AUTHENTICATION MIDDLEWARE
// ========================================

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        // Check for token in cookies for web pages
        const cookieToken = req.cookies?.authToken;
        if (!cookieToken) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Access token required' });
            }
            return res.redirect('/login');
        }
        req.token = cookieToken;
    } else {
        req.token = token;
    }

    jwt.verify(req.token || token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ error: 'Invalid or expired token' });
            }
            return res.redirect('/login');
        }
        req.user = user;
        next();
    });
};

// ========================================
// AUTHORIZATION MIDDLEWARE
// ========================================

// Role-based access control
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
};

// Clinic access control
const checkClinicAccess = async (req, res, next) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const clinicId = req.params.clinicId || req.body.clinic_id || req.query.clinic_id;

        if (!clinicId) {
            return next();
        }

        // Admin has access to all clinics
        if (req.user.role === 'ADMIN') {
            return next();
        }

        // Check if user's primary clinic matches
        if (req.user.clinic_id === clinicId) {
            return next();
        }

        // Check user_clinic_grants
        const [grants] = await db.execute(
            'SELECT * FROM user_clinic_grants WHERE user_id = ? AND clinic_id = ?',
            [userId, clinicId]
        );

        if (grants.length > 0) {
            return next();
        }

        return res.status(403).json({ error: 'No access to this clinic' });
    } catch (error) {
        console.error('Clinic access check error:', error);
        return res.status(500).json({ error: 'Access verification failed' });
    }
};

// Helper to resolve clinic access lists for non-admin users
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
// FILE UPLOAD MIDDLEWARE
// ========================================

// File upload configuration
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

// Configure multer for CSV file uploads
const uploadCSV = multer({ dest: 'uploads/' });

// ========================================
// AUDIT LOGGING
// ========================================

// Audit logging
const auditLog = async (db, userId, action, entityType, entityId, oldValues = null, newValues = null, req = null) => {
    try {
        const ipAddress = req ? (req.headers['x-forwarded-for'] || req.connection.remoteAddress) : null;
        const userAgent = req ? req.headers['user-agent'] : null;

        await db.execute(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                action,
                entityType,
                entityId,
                oldValues ? JSON.stringify(oldValues) : null,
                newValues ? JSON.stringify(newValues) : null,
                ipAddress,
                userAgent
            ]
        );
    } catch (error) {
        console.error('Audit logging error:', error);
    }
};

module.exports = {
    authenticateToken,
    authorize,
    checkClinicAccess,
    getAccessibleClinicIds,
    upload,
    uploadCSV,
    auditLog
};
