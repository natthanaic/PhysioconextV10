/**
 * Shared Utility Functions for RehabPlus System
 * Common functions used across multiple pages
 */

/**
 * Get cookie value by name
 * @param {string} name - Cookie name
 * @returns {string|undefined} Cookie value
 */
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// ============================================
// GLOBAL FETCH WRAPPER FOR AUTOMATIC CREDENTIALS
// ============================================
// This wrapper ensures ALL fetch requests include:
// 1. Credentials (cookies) for same-origin requests
// 2. Auto-redirect to login on 401/403 errors
// Note: httpOnly cookies are sent automatically, no Authorization header needed
(function() {
    // Store original fetch
    const originalFetch = window.fetch;

    // Override global fetch to always include credentials for same-origin requests
    window.fetch = function(url, options = {}) {
        // Only add credentials if not explicitly set
        if (!options.credentials) {
            options.credentials = 'same-origin';
        }

        // Note: We use httpOnly cookies for security
        // JavaScript cannot read httpOnly cookies (that's the point!)
        // The cookie is automatically sent with credentials: 'same-origin'
        // Server reads it from req.cookies.authToken
        // We don't need to set Authorization header - server uses cookie

        // Call original fetch with modified options
        return originalFetch(url, options).then(response => {
            // Auto-redirect to login on 401/403 for API calls
            if (!response.ok && (response.status === 401 || response.status === 403)) {
                if (url.startsWith('/api/')) {
                    console.warn('Authentication failed, redirecting to login...');
                    window.location.href = '/login';
                }
            }
            return response;
        });
    };

    console.log('✅ Global fetch wrapper initialized - credentials will be sent automatically');
})();

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} unsafe - Unsafe HTML string
 * @returns {string} Escaped HTML string
 */
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Show alert message to user
 * @param {string} message - Alert message
 * @param {string} type - Alert type (success, danger, warning, info)
 * @param {number} duration - Duration in milliseconds (default: 5000)
 */
function showAlert(message, type = 'info', duration = 5000) {
    const alertContainer = document.getElementById('alertsContainer') ||
                          document.getElementById('alertContainer') ||
                          document.body;

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.setAttribute('role', 'alert');
    alertDiv.innerHTML = `
        ${escapeHtml(message)}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;

    // If appending to body, make it fixed position
    if (alertContainer === document.body) {
        alertDiv.classList.add('position-fixed', 'top-0', 'start-50', 'translate-middle-x', 'mt-3');
        alertDiv.style.zIndex = '9999';
        alertDiv.style.maxWidth = '500px';
    }

    alertContainer.appendChild(alertDiv);

    // Auto-dismiss after duration
    setTimeout(() => {
        alertDiv.remove();
    }, duration);
}

/**
 * Logout user and redirect to login page
 */
function logout() {
    document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    localStorage.clear();
    window.location.href = '/login';
}

/**
 * Format date to locale string
 * @param {string|Date} date - Date to format
 * @param {string} locale - Locale (default: 'en-GB')
 * @returns {string} Formatted date
 */
function formatDate(date, locale = 'en-GB') {
    if (!date) return '';
    return new Date(date).toLocaleDateString(locale);
}

/**
 * Format date and time to locale string
 * @param {string|Date} date - Date to format
 * @param {string} locale - Locale (default: 'en-GB')
 * @returns {string} Formatted date and time
 */
function formatDateTime(date, locale = 'en-GB') {
    if (!date) return '';
    return new Date(date).toLocaleString(locale);
}

/**
 * Truncate text to specified length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait = 500) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Show loading spinner in container
 * @param {string} containerId - Container element ID
 * @param {string} message - Loading message (optional)
 */
function showLoading(containerId, message = 'Loading...') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">${escapeHtml(message)}</span>
            </div>
            <p class="mt-2 text-muted">${escapeHtml(message)}</p>
        </div>
    `;
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
function validateEmail(email) {
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
}

/**
 * Validate phone number (Thai format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid
 */
function validatePhone(phone) {
    const re = /^[0-9]{9,10}$/;
    return re.test(phone.replace(/[-\s]/g, ''));
}

/**
 * API request wrapper with authentication
 * @param {string} endpoint - API endpoint
 * @param {object} options - Fetch options
 * @returns {Promise} Response data
 */
async function apiRequest(endpoint, options = {}) {
    // Note: We use httpOnly cookies for authentication
    // The cookie is sent automatically with credentials: 'same-origin'
    // Server reads it from req.cookies.authToken
    // No need to set Authorization header

    const defaultOptions = {
        credentials: 'same-origin', // Send cookies with requests
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    };

    const response = await fetch(endpoint, { ...defaultOptions, ...options });

    if (!response.ok) {
        // Check if unauthorized - redirect to login
        if (response.status === 401 || response.status === 403) {
            console.warn('Authentication failed, redirecting to login...');
            window.location.href = '/login';
            return;
        }

        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || error.message || 'Request failed');
    }

    return response.json();
}

/**
 * API GET request
 * @param {string} endpoint - API endpoint
 * @returns {Promise} Response data
 */
async function apiGet(endpoint) {
    return apiRequest(endpoint);
}

/**
 * API POST request
 * @param {string} endpoint - API endpoint
 * @param {object} data - Request body data
 * @returns {Promise} Response data
 */
async function apiPost(endpoint, data) {
    return apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

/**
 * API PUT request
 * @param {string} endpoint - API endpoint
 * @param {object} data - Request body data
 * @returns {Promise} Response data
 */
async function apiPut(endpoint, data) {
    return apiRequest(endpoint, {
        method: 'PUT',
        body: JSON.stringify(data)
    });
}

/**
 * API DELETE request
 * @param {string} endpoint - API endpoint
 * @returns {Promise} Response data
 */
async function apiDelete(endpoint) {
    return apiRequest(endpoint, {
        method: 'DELETE'
    });
}