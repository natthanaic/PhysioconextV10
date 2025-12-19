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
const specializedRoutes = require('./routes/specialized');
const publicRoutes = require('./routes/public');
const documentsRoutes = require('./routes/documents');
const webhooksRoutes = require('./routes/webhooks');
const viewsRoutes = require('./routes/views');
const chatRoutes = require('./routes/chat');
const testRoutes = require('./routes/test');
const shinoaiRoutes = require('./routes/shinoai');
const shinoaiRagRoutes = require('./routes/shinoai-rag');

// Optional broadcast routes
let broadcastRoutes;
try { broadcastRoutes = require('./routes/broadcast'); } catch(e) { console.log('Broadcast routes not found'); }

// MOUNT ROUTES
app.use('/webhook', webhooksRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/auth', tfaRoutes);
app.use('/api/google', googleOAuthRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', appointmentsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api', testRoutes);
app.use('/api', specializedRoutes);

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

// --- SHINOAI ASSISTANT ROUTES ---
// AI-powered assistant for clinic management and recommendations
app.use('/api/shinoai', shinoaiRoutes);

// --- SHINOAI RAG (Function Calling) ROUTE ---
// RAG version with Gemini 2.0 Function Calling - More scalable and token-efficient
app.use('/api/shinoai-rag', shinoaiRagRoutes);

app.use('/api/pn', pnCasesRoutes);
app.use('/api', pnCasesRoutes);

app.use('/', documentsRoutes);
app.use('/', viewsRoutes);

app.use((req, res, next) => {
    console.log(`[FALLTHROUGH] Request not handled: ${req.method} ${req.originalUrl}`);
    next();
});

module.exports = app;