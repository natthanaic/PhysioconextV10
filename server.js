// server.js - Main Server Configuration for PN-App Physiotherapy System
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs').promises;
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const rateLimit = require('express-rate-limit');

// Import app configuration
const app = require('./app');
const { initializeSocketIO } = require('./socket-server');

// Create necessary directories
const createDirectories = async () => {
    const dirs = [
        './uploads',
        './reports',
        './public',
        './public/css',
        './public/js',
        './public/images',
        './views',
        './views/partials',
        './logs'
    ];
    
    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
            console.log(`✓ Directory created/verified: ${dir}`);
        } catch (error) {
            console.error(`✗ Error creating directory ${dir}:`, error);
        }
    }
};

// Database connection pool
const createDatabasePool = () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
    });
    
    return pool;
};

// Test database connection
const testDatabaseConnection = async (pool) => {
    try {
        const connection = await pool.getConnection();
        console.log('✓ Database connected successfully');
        console.log(`  Host: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
        console.log(`  Database: ${process.env.DB_NAME}`);
        connection.release();
        return true;
    } catch (error) {
        console.error('✗ Database connection failed:', error.message);
        return false;
    }
};

// Security middleware setup
const setupSecurity = (app) => {
    // Helmet for security headers - Enhanced CSP policy
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                // Use nonces or hashes instead of unsafe-inline in production
                // For now, keeping unsafe-inline for compatibility but should migrate to nonces
                styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
                // SECURITY NOTE: unsafe-eval should be removed if not strictly necessary
                // Consider refactoring code to avoid eval if possible
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                imgSrc: ["'self'", "data:", "https:", "blob:"],
                fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com", "data:"],
                connectSrc: ["'self'", "wss:", "ws:"], // Added WebSocket support for Socket.IO
                workerSrc: ["'self'", "blob:"],
                manifestSrc: ["'self'"],
                objectSrc: ["'none'"], // Prevent plugins
                baseUri: ["'self'"], // Restrict base tag URLs
                formAction: ["'self'"], // Restrict form submissions
                frameAncestors: ["'none'"], // Prevent clickjacking
                upgradeInsecureRequests: [] // Force HTTPS in production
            },
        },
        crossOriginEmbedderPolicy: false,
        // Additional security headers
        hsts: {
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true
        },
        noSniff: true, // Prevent MIME type sniffing
        xssFilter: true, // Enable XSS filter
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    }));
    
    // CORS configuration
    const corsOptions = {
        origin: function (origin, callback) {
            const allowedOrigins = process.env.CORS_ORIGIN.split(',');
            if (!origin || allowedOrigins.indexOf('*') !== -1 || allowedOrigins.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: process.env.CORS_CREDENTIALS === 'true',
        optionsSuccessStatus: 200
    };
    app.use(cors(corsOptions));
    
    // Rate limiting
    const limiter = rateLimit({
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
        message: 'Too many requests from this IP, please try again later.',
        standardHeaders: true,
        legacyHeaders: false,
    });
    
    // Apply rate limiting to API routes
    app.use('/api/', limiter);
    
    // Stricter rate limit for auth endpoints
    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: 'Too many authentication attempts, please try again later.',
        skipSuccessfulRequests: true,
    });
    app.use('/api/auth/login', authLimiter);
    app.use('/api/auth/register', authLimiter);
};

// Middleware setup
const setupMiddleware = (app, pool) => { // Updated to receive pool
    // Compression
    app.use(compression());

    // Logging - Skip static file requests to reduce noise
    const skipStatic = (req, res) => req.url.startsWith('/public/') ||
                                      req.url.startsWith('/uploads/') ||
                                      req.url.startsWith('/reports/');

    if (process.env.NODE_ENV === 'production') {
        app.use(morgan('combined', { skip: skipStatic }));
    } else {
        app.use(morgan('dev', { skip: skipStatic }));
    }

    // Initialize MySQL Session Store
    const sessionStore = new MySQLStore({
        expiration: 86400000, // Session duration in milliseconds (24 hours)
        createDatabaseTable: true, // Whether to create the table automatically
        schema: {
            tableName: 'sessions',
            columnNames: {
                session_id: 'session_id',
                expires: 'expires',
                data: 'data'
            }
        }
    }, pool); // Pass the existing database pool

    // Session configuration (cookie parser and body parsing already in app.js)
    app.use(session({
        key: 'pn_app_session', // Recommended: explicit cookie name
        secret: process.env.SESSION_SECRET || 'default-secret-change-in-production',
        store: sessionStore, // Use the MySQL store
        resave: false, // Recommended for MySQL store
        saveUninitialized: false, // Recommended for login sessions
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    }));

    // Request logging middleware
    app.use((req, res, next) => {
        req.requestTime = new Date().toISOString();
        next();
    });
};

// Error handling
const setupErrorHandling = (app) => {
    // 404 handler - DON'T render HTML, return appropriate response
    app.use((req, res, next) => {
        console.log(`[404] Not found: ${req.method} ${req.url}`);

        // If request accepts JSON or is an API request, return JSON
        if (req.accepts('json') || req.url.startsWith('/api/')) {
            return res.status(404).json({
                error: 'Not Found',
                message: `Cannot ${req.method} ${req.url}`,
                timestamp: new Date().toISOString()
            });
        }

        // For other requests (like JS files), return plain text
        res.status(404).type('text/plain').send(`Not Found: ${req.url}`);
    });
    
    // Global error handler
    app.use((err, req, res, next) => {
        // Log error
        console.error('Error:', err);
        
        // Default error
        let status = err.status || 500;
        let message = err.message || 'Internal Server Error';
        
        // Mongoose validation error
        if (err.name === 'ValidationError') {
            status = 400;
            message = 'Validation Error';
        }
        
        // JWT errors
        if (err.name === 'JsonWebTokenError') {
            status = 401;
            message = 'Invalid token';
        }
        
        if (err.name === 'TokenExpiredError') {
            status = 401;
            message = 'Token expired';
        }
        
        // Send error response
        res.status(status).json({
            error: true,
            message: message,
            ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
            timestamp: new Date().toISOString()
        });
    });
};

// Graceful shutdown
const setupGracefulShutdown = (server, pool) => {
    const gracefulShutdown = async (signal) => {
        console.log(`\n${signal} received. Starting graceful shutdown...`);
        
        // Stop accepting new connections
        server.close(() => {
            console.log('✓ HTTP server closed');
        });
        
        // Close database pool
        try {
            await pool.end();
            console.log('✓ Database pool closed');
        } catch (error) {
            console.error('✗ Error closing database pool:', error);
        }
        
        // Exit process
        process.exit(0);
    };
    
    // Listen for termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
};

// Main server initialization
const initializeServer = async () => {
    try {
        console.log('=====================================');
        console.log('PN-App Physiotherapy System');
        console.log('Starting server initialization...');
        console.log('=====================================\n');
        
        // Create necessary directories
        await createDirectories();
        
        // Create database pool
        const pool = createDatabasePool();
        
        // Test database connection
        const dbConnected = await testDatabaseConnection(pool);
        if (!dbConnected) {
            console.error('Cannot start server without database connection');
            process.exit(1);
        }
        
        // Make pool available globally
        app.locals.db = pool;
        global.db = pool;
        
        // Setup security
        setupSecurity(app);
        
        // Setup middleware (Pass pool for session store)
        setupMiddleware(app, pool);
        
        // Setup error handling
        setupErrorHandling(app);
        
        // Start server
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log('\n=====================================');
            console.log('✓ Server started successfully');
            console.log(`✓ Listening on port ${PORT}`);
            console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`✓ URL: ${process.env.APP_BASE_URL || `http://localhost:${PORT}`}`);
            console.log('=====================================\n');
        });

        // Initialize Socket.IO for cross-domain chat
        const io = initializeSocketIO(server, pool);
        app.locals.io = io;
        console.log('✓ Socket.IO initialized for cross-domain chat');
        console.log('  - rehabplus.lantavafix.com');
        console.log('  - famcare.lantavafix.com\n');

        // Setup graceful shutdown
        setupGracefulShutdown(server, pool);
        
    } catch (error) {
        console.error('✗ Server initialization failed:', error);
        process.exit(1);
    }
};

// Start the server
initializeServer();

module.exports = app;