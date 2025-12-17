// app.js - Main Application Logic for PN-App Physiotherapy System
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { loadThemeSettings } = require('./middleware/theme');

// Import the Thai Card Route
const thaiCardRoute = require('./routes/thai_card');
const expensesRoutes = require('./routes/expenses');

const app = express();

// ========================================
// REQUEST LOGGER - For debugging
// ========================================
app.use((req, res, next) => {
    if (!req.url.startsWith('/public/images/') && !req.url.startsWith('/uploads/')) {
        console.log(`[REQUEST] ${req.method} ${req.url}`);
    }
    next();
});

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ... existing static file handling ...
const fs = require('fs');
app.get('/public/js/:filename', (req, res, next) => {
    // ... (keep existing JS route logic) ...
    const fileName = req.params.filename;
    if (!fileName.endsWith('.js')) return next();
    const filePath = path.join(__dirname, 'public', 'js', fileName);
    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(filePath);
    }
    next();
});

app.get('/public/css/:filename', (req, res, next) => {
    // ... (keep existing CSS route logic) ...
    const fileName = req.params.filename;
    if (!fileName.endsWith('.css')) return next();
    const filePath = path.join(__dirname, 'public', 'css', fileName);
    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(filePath);
    }
    next();
});

app.use('/public', express.static(path.join(__dirname, 'public'), {
    fallthrough: true,
    index: false,
    setHeaders: (res, filepath) => {
        if (filepath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        else if (filepath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
        else if (filepath.endsWith('.json')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
}));

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { fallthrough: true }));
app.use('/reports', express.static(path.join(__dirname, 'reports'), { fallthrough: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(loadThemeSettings);

// IMPORT ROUTE MODULES
const authRoutes = require('./routes/auth');
const tfaRoutes = require('./routes/2fa');
const googleOAuthRoutes = require('./routes/google-oauth');
const patientsRoutes = require('./routes/patients');
const pnCasesRoutes = require('./routes/pn-cases');
const appointmentsRoutes = require('./routes/appointments');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');
const documentsRoutes = require('./routes/documents');
const chatRoutes = require('./routes/chat');

// Optional routes - only load if files exist
let specializedRoutes, webhooksRoutes, viewsRoutes, testRoutes, broadcastRoutes;
try { specializedRoutes = require('./routes/specialized'); } catch(e) { specializedRoutes = null; }
try { webhooksRoutes = require('./routes/webhooks'); } catch(e) { webhooksRoutes = null; }
try { viewsRoutes = require('./routes/views'); } catch(e) { viewsRoutes = null; }
try { testRoutes = require('./routes/test'); } catch(e) { testRoutes = null; }
try { broadcastRoutes = require('./routes/broadcast'); } catch(e) { broadcastRoutes = null; }

// MOUNT ROUTES
if (webhooksRoutes) app.use('/webhook', webhooksRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/auth', tfaRoutes);
app.use('/api/google', googleOAuthRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', appointmentsRoutes);
app.use('/api/chat', chatRoutes);
if (testRoutes) app.use('/api', testRoutes);
if (specializedRoutes) app.use('/api', specializedRoutes);

// --- THAI CARD API ROUTE ---
// IMPORTANT: Must be mounted BEFORE pn-cases to avoid /:id catch-all conflict
// This enables: https://rehabplus.lantavafix.com/api/thai_card
app.use('/api', thaiCardRoute);

// --- EXPENSE MANAGEMENT ROUTE ---
// Admin-only expense tracking and financial management
app.use('/api/expenses', expensesRoutes);

// --- BROADCAST MARKETING ROUTE ---
// Admin and PT broadcast marketing for SMS and Email campaigns
if (broadcastRoutes) app.use('/api/broadcast', broadcastRoutes);

app.use('/api/pn', pnCasesRoutes);
app.use('/api', pnCasesRoutes);

app.use('/', documentsRoutes);
if (viewsRoutes) app.use('/', viewsRoutes);

// Fallback view routes if views.js doesn't exist
if (!viewsRoutes) {
    const { authenticateToken, authorize } = require('./middleware/auth');

    // Root redirect - show public booking page
    app.get('/', (req, res) => {
        if (req.cookies && req.cookies.authToken) {
            res.redirect('/dashboard');
        } else {
            res.redirect('/public-booking');
        }
    });

    // Shortcut route for /book
    app.get('/book', (req, res) => {
        res.redirect('/public-booking');
    });

    // Staff/Admin login shortcuts
    app.get('/admin', (req, res) => {
        res.redirect('/login');
    });

    app.get('/staff', (req, res) => {
        res.redirect('/login');
    });

    // Essential view routes
    app.get('/login', (req, res) => res.render('login', { error: req.query.error, appName: 'PhysioConext' }));
    app.get('/dashboard', authenticateToken, (req, res) => res.render('dashboard', { user: req.user, activePage: 'dashboard', appName: 'PhysioConext' }));
    app.get('/patients', authenticateToken, (req, res) => res.render('patients', { user: req.user, activePage: 'patients', appName: 'PhysioConext' }));
    app.get('/appointments', authenticateToken, authorize('ADMIN', 'PT'), (req, res) => res.render('appointments', { user: req.user, activePage: 'appointments', appName: 'PhysioConext' }));
    app.get('/broadcast', authenticateToken, authorize('ADMIN', 'PT'), (req, res) => res.render('admin/broadcast', { user: req.user, activePage: 'broadcast', appName: 'PhysioConext' }));

    console.log('⚠️  Using fallback view routes (routes/views.js not found)');
}

app.use((req, res, next) => {
    console.log(`[FALLTHROUGH] Request not handled: ${req.method} ${req.originalUrl}`);
    next();
});

module.exports = app;