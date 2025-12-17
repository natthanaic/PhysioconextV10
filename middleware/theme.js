// middleware/theme.js - Theme Settings Middleware
/**
 * Middleware to load theme settings (app name and logo) for all views
 * Sets res.locals.appName and res.locals.appLogoUrl
 */
const loadThemeSettings = async (req, res, next) => {
    // Skip for API routes and static files - only needed for HTML views
    if (req.path.startsWith('/api/') ||
        req.path.startsWith('/webhook/') ||
        req.path.startsWith('/public/') ||
        req.path.startsWith('/uploads/') ||
        req.path.startsWith('/reports/')) {
        return next();
    }

    try {
        const db = req.app.locals.db;

        if (!db) {
            // If no database connection, use defaults
            res.locals.appName = 'PhysioConext';
            res.locals.appLogoUrl = '/uploads/physioconext.svg';
            return next();
        }

        // Get app name
        const [appNameRows] = await db.execute(
            `SELECT setting_value FROM system_settings WHERE setting_key = 'app_name' LIMIT 1`
        );

        // Get logo URL
        const [logoRows] = await db.execute(
            `SELECT setting_value FROM system_settings WHERE setting_key = 'app_logo_url' LIMIT 1`
        );

        // Set in res.locals so all views can access
        res.locals.appName = appNameRows.length > 0 ? appNameRows[0].setting_value : 'PhysioConext';
        res.locals.appLogoUrl = logoRows.length > 0 ? logoRows[0].setting_value : '/uploads/physioconext.svg';

        next();
    } catch (error) {
        console.error('Error loading theme settings:', error);
        console.error('Error stack:', error.stack);
        // Use defaults on error and continue
        res.locals.appName = 'PhysioConext';
        res.locals.appLogoUrl = '/uploads/physioconext.svg';
        next();
    }
};

module.exports = { loadThemeSettings };