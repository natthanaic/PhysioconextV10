// routes/views.js - View Routes for serving EJS pages
const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');

// ========================================
// LOGIN PAGE (Public)
// ========================================
router.get('/login', (req, res) => {
    res.render('login', {
        error: req.query.error,
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// DASHBOARD
// ========================================
router.get('/dashboard', authenticateToken, (req, res) => {
    res.render('dashboard', {
        user: req.user,
        activePage: 'dashboard',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// APPOINTMENTS
// ========================================
router.get('/appointments', authenticateToken, authorize('ADMIN', 'PT'), (req, res) => {
    res.render('appointments', {
        user: req.user,
        activePage: 'appointments',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// PATIENTS
// ========================================
router.get('/patients', authenticateToken, (req, res) => {
    res.render('patients', {
        user: req.user,
        activePage: 'patients',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// PATIENT REGISTRATION
// ========================================
router.get('/patient/register', authenticateToken, (req, res) => {
    res.render('patient-register', {
        user: req.user,
        activePage: 'register',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// PATIENT DETAIL
// ========================================
router.get('/patient/:id', authenticateToken, (req, res) => {
    res.render('patient-detail', {
        user: req.user,
        patientId: req.params.id,
        activePage: 'patients',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// PN CASES
// ========================================
router.get('/pn/:id', authenticateToken, (req, res) => {
    res.render('pn-detail', {
        user: req.user,
        pnId: req.params.id,
        activePage: 'patients',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/pn-logs', authenticateToken, (req, res) => {
    res.render('pn-logs', {
        user: req.user,
        activePage: 'pn-logs',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// HOMECACE (SERVICE)
// ========================================
router.get('/homecace', authenticateToken, (req, res) => {
    res.render('bodycheckdraw', {
        user: req.user,
        activePage: 'homecace',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/bodycheckdetails', authenticateToken, (req, res) => {
    res.render('bodycheckdetails', {
        user: req.user,
        activePage: 'homecace',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// CHAT
// ========================================
router.get('/chat', authenticateToken, authorize('ADMIN', 'PT'), (req, res) => {
    res.render('conextchat', {
        user: req.user,
        activePage: 'chat',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// COURSES
// ========================================
router.get('/courses', authenticateToken, (req, res) => {
    res.render('courses', {
        user: req.user,
        activePage: 'courses',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// DIAGNOSTIC
// ========================================
router.get('/diagnostic', authenticateToken, (req, res) => {
    res.render('diagnostic', {
        user: req.user,
        activePage: 'diagnostic',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// BILLS (ADMIN)
// ========================================
router.get('/bills', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('bills', {
        user: req.user,
        activePage: 'bills',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// STATISTICS
// ========================================
router.get('/statistics', authenticateToken, authorize('ADMIN', 'PT'), (req, res) => {
    res.render('statistics', {
        user: req.user,
        activePage: 'statistics',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// LOYALTY PROGRAM
// ========================================
router.get('/loyalty', authenticateToken, (req, res) => {
    res.render('loyalty', {
        user: req.user,
        activePage: 'loyalty',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// EXPENSES (ADMIN)
// ========================================
router.get('/expenses', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('expenses', {
        user: req.user,
        activePage: 'expenses',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// PROFILE
// ========================================
router.get('/profile', authenticateToken, (req, res) => {
    res.render('profile', {
        user: req.user,
        activePage: 'profile',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// ADMIN SETTINGS
// ========================================
router.get('/admin/settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-settings', {
        user: req.user,
        activePage: 'admin-settings',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/admin/users', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin/users', {
        user: req.user,
        activePage: 'admin-users',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/admin/clinics', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin/clinics', {
        user: req.user,
        activePage: 'admin-clinics',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/admin/services', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin/services', {
        user: req.user,
        activePage: 'admin-services',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/admin/notification-settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-notification-settings', {
        user: req.user,
        activePage: 'notification-settings',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/admin/booking-settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-booking-settings', {
        user: req.user,
        activePage: 'booking-settings',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/admin/theme-settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-theme-settings', {
        user: req.user,
        activePage: 'theme-settings',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/admin/google-calendar-settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-google-calendar-settings', {
        user: req.user,
        activePage: 'google-calendar-settings',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/admin/ai-settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-ai-settings', {
        user: req.user,
        activePage: 'ai-settings',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/admin/line-webhook-ids', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-line-webhook-ids', {
        user: req.user,
        activePage: 'line-webhook-ids',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/document-settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('document-settings', {
        user: req.user,
        activePage: 'document-settings',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// BROADCAST MARKETING PAGE
// ========================================
router.get('/broadcast', authenticateToken, authorize('ADMIN', 'PT'), (req, res) => {
    res.render('admin/broadcast', {
        user: req.user,
        activePage: 'broadcast',
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// PUBLIC PAGES
// ========================================
router.get('/public-booking', (req, res) => {
    res.render('public-booking', {
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

router.get('/public-home', (req, res) => {
    res.render('public-home', {
        appName: req.app.locals.appName || 'PhysioConext'
    });
});

// ========================================
// FAVICON
// ========================================
router.get('/favicon.ico', (req, res) => {
    res.redirect('/public/images/Fav.png');
});

// ========================================
// ROOT REDIRECT
// ========================================
// ROOT AND PUBLIC ROUTES
// ========================================
router.get('/', (req, res) => {
    // Check if user is authenticated
    if (req.cookies && req.cookies.authToken) {
        res.redirect('/dashboard');
    } else {
        // Show public booking page for non-logged-in users
        res.redirect('/public-booking');
    }
});

// Shortcut route for /book
router.get('/book', (req, res) => {
    res.redirect('/public-booking');
});

module.exports = router;
