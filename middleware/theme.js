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
            res.locals.faviconUrl = null;
            res.locals.browserTitle = 'PhysioConext';
            res.locals.themeColors = {
                headerColorStart: '#0284c7',
                headerColorEnd: '#14b8a6',
                sidebarColorStart: '#667eea',
                sidebarColorEnd: '#764ba2',
                primaryColor: '#0284c7',
                accentColor: '#14b8a6',
                successColor: '#10b981',
                warningColor: '#f59e0b',
                errorColor: '#ef4444',
                cardBgColor: '#ffffff',
                cardBorderColor: '#e5e7eb',
                panelHeaderBg: '#f9fafb'
            };
            res.locals.themeTypography = {
                fontHeadings: 'Plus Jakarta Sans',
                fontBody: 'Plus Jakarta Sans',
                fontSizeScale: 'medium'
            };
            res.locals.themeLayout = {
                borderRadius: '8',
                sidebarWidth: '240',
                sidebarCollapsed: false,
                sidebarPosition: 'left'
            };
            res.locals.themeDarkMode = false;
            res.locals.loginPage = {
                bgImage: null,
                logo: null,
                welcomeText: 'Welcome to PhysioConext'
            };
            return next();
        }

        // Get all theme settings in one query
        const [settings] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE 'theme_%' OR setting_key IN ('app_name', 'app_logo_url', 'header_color_start', 'header_color_end', 'sidebar_color_start', 'sidebar_color_end')`
        );

        // Initialize with defaults
        res.locals.appName = 'PhysioConext';
        res.locals.appLogoUrl = '/uploads/physioconext.svg';
        res.locals.faviconUrl = null;
        res.locals.browserTitle = 'PhysioConext';

        res.locals.themeColors = {
            // Header & Sidebar
            headerColorStart: '#0284c7',
            headerColorEnd: '#14b8a6',
            sidebarColorStart: '#667eea',
            sidebarColorEnd: '#764ba2',

            // Primary & Accent
            primaryColor: '#0284c7',
            accentColor: '#14b8a6',
            successColor: '#10b981',
            warningColor: '#f59e0b',
            errorColor: '#ef4444',

            // Card & Panel
            cardBgColor: '#ffffff',
            cardBorderColor: '#e5e7eb',
            panelHeaderBg: '#f9fafb'
        };

        res.locals.themeTypography = {
            fontHeadings: 'Plus Jakarta Sans',
            fontBody: 'Plus Jakarta Sans',
            fontSizeScale: 'medium'
        };

        res.locals.themeLayout = {
            borderRadius: '8',
            sidebarWidth: '240',
            sidebarCollapsed: false,
            sidebarPosition: 'left'
        };

        res.locals.themeDarkMode = false;

        res.locals.loginPage = {
            bgImage: null,
            logo: null,
            welcomeText: 'Welcome to PhysioConext'
        };

        // Apply database values
        settings.forEach(row => {
            const key = row.setting_key;
            const val = row.setting_value;

            // Basic branding
            if (key === 'app_name') res.locals.appName = val;
            else if (key === 'app_logo_url') res.locals.appLogoUrl = val;
            else if (key === 'theme_favicon_url') res.locals.faviconUrl = val;
            else if (key === 'theme_browser_title') res.locals.browserTitle = val;

            // Colors
            else if (key === 'header_color_start') res.locals.themeColors.headerColorStart = val;
            else if (key === 'header_color_end') res.locals.themeColors.headerColorEnd = val;
            else if (key === 'sidebar_color_start') res.locals.themeColors.sidebarColorStart = val;
            else if (key === 'sidebar_color_end') res.locals.themeColors.sidebarColorEnd = val;
            else if (key === 'theme_primary_color') res.locals.themeColors.primaryColor = val;
            else if (key === 'theme_accent_color') res.locals.themeColors.accentColor = val;
            else if (key === 'theme_success_color') res.locals.themeColors.successColor = val;
            else if (key === 'theme_warning_color') res.locals.themeColors.warningColor = val;
            else if (key === 'theme_error_color') res.locals.themeColors.errorColor = val;
            else if (key === 'theme_card_bg_color') res.locals.themeColors.cardBgColor = val;
            else if (key === 'theme_card_border_color') res.locals.themeColors.cardBorderColor = val;
            else if (key === 'theme_panel_header_bg') res.locals.themeColors.panelHeaderBg = val;

            // Typography
            else if (key === 'theme_font_headings') res.locals.themeTypography.fontHeadings = val;
            else if (key === 'theme_font_body') res.locals.themeTypography.fontBody = val;
            else if (key === 'theme_font_size_scale') res.locals.themeTypography.fontSizeScale = val;

            // Layout
            else if (key === 'theme_border_radius') res.locals.themeLayout.borderRadius = val;
            else if (key === 'theme_sidebar_width') res.locals.themeLayout.sidebarWidth = val;
            else if (key === 'theme_sidebar_collapsed') res.locals.themeLayout.sidebarCollapsed = val === 'true' || val === '1';
            else if (key === 'theme_sidebar_position') res.locals.themeLayout.sidebarPosition = val;

            // Dark mode
            else if (key === 'theme_dark_mode_enabled') res.locals.themeDarkMode = val === 'true' || val === '1';

            // Login page
            else if (key === 'theme_login_bg_image') res.locals.loginPage.bgImage = val;
            else if (key === 'theme_login_logo') res.locals.loginPage.logo = val;
            else if (key === 'theme_login_welcome_text') res.locals.loginPage.welcomeText = val;
        });

        next();
    } catch (error) {
        console.error('Error loading theme settings:', error);
        console.error('Error stack:', error.stack);
        // Use defaults on error and continue
        res.locals.appName = 'PhysioConext';
        res.locals.appLogoUrl = '/uploads/physioconext.svg';
        res.locals.faviconUrl = null;
        res.locals.browserTitle = 'PhysioConext';
        res.locals.themeColors = {
            headerColorStart: '#0284c7',
            headerColorEnd: '#14b8a6',
            sidebarColorStart: '#667eea',
            sidebarColorEnd: '#764ba2',
            primaryColor: '#0284c7',
            accentColor: '#14b8a6',
            successColor: '#10b981',
            warningColor: '#f59e0b',
            errorColor: '#ef4444',
            cardBgColor: '#ffffff',
            cardBorderColor: '#e5e7eb',
            panelHeaderBg: '#f9fafb'
        };
        res.locals.themeTypography = {
            fontHeadings: 'Plus Jakarta Sans',
            fontBody: 'Plus Jakarta Sans',
            fontSizeScale: 'medium'
        };
        res.locals.themeLayout = {
            borderRadius: '8',
            sidebarWidth: '240',
            sidebarCollapsed: false,
            sidebarPosition: 'left'
        };
        res.locals.themeDarkMode = false;
        res.locals.loginPage = {
            bgImage: null,
            logo: null,
            welcomeText: 'Welcome to PhysioConext'
        };
        next();
    }
};

module.exports = { loadThemeSettings };