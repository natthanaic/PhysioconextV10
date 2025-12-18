// middleware/theme.js - Theme Settings Middleware
/**
 * Middleware to load theme settings (app name, logo, and colors) for all views
 * Sets res.locals with theme configuration
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
            res.locals.themeColors = {
                headerColorStart: '#0284c7',
                headerColorEnd: '#14b8a6',
                sidebarColorStart: '#667eea',
                sidebarColorEnd: '#764ba2'
            };
            return next();
        }

        // Get all theme settings in one query
        const [settings] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key IN ('app_name', 'app_logo_url', 'header_color_start', 'header_color_end', 'sidebar_color_start', 'sidebar_color_end')`
        );

        // Initialize with defaults
        res.locals.appName = 'PhysioConext';
        res.locals.appLogoUrl = '/uploads/physioconext.svg';
        res.locals.themeColors = {
            headerColorStart: '#0284c7',
            headerColorEnd: '#14b8a6',
            sidebarColorStart: '#667eea',
            sidebarColorEnd: '#764ba2'
        };

        // Apply database values
        settings.forEach(row => {
            switch (row.setting_key) {
                case 'app_name':
                    res.locals.appName = row.setting_value;
                    break;
                case 'app_logo_url':
                    res.locals.appLogoUrl = row.setting_value;
                    break;
                case 'header_color_start':
                    res.locals.themeColors.headerColorStart = row.setting_value;
                    break;
                case 'header_color_end':
                    res.locals.themeColors.headerColorEnd = row.setting_value;
                    break;
                case 'sidebar_color_start':
                    res.locals.themeColors.sidebarColorStart = row.setting_value;
                    break;
                case 'sidebar_color_end':
                    res.locals.themeColors.sidebarColorEnd = row.setting_value;
                    break;
            }
        });

        next();
    } catch (error) {
        console.error('Error loading theme settings:', error);
        console.error('Error stack:', error.stack);
        // Use defaults on error and continue
        res.locals.appName = 'PhysioConext';
        res.locals.appLogoUrl = '/uploads/physioconext.svg';
        res.locals.themeColors = {
            headerColorStart: '#0284c7',
            headerColorEnd: '#14b8a6',
            sidebarColorStart: '#667eea',
            sidebarColorEnd: '#764ba2'
        };
        next();
    }
};

module.exports = { loadThemeSettings };