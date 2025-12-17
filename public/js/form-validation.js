/**
 * Form Validation Utilities
 * Comprehensive validation functions for RehabPlus forms
 */

/**
 * Validation rules and error messages
 */
const ValidationRules = {
    // Email validation
    email: {
        pattern: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
        message: 'Please enter a valid email address'
    },

    // Phone validation (Thai format)
    phone: {
        pattern: /^[0-9]{9,10}$/,
        message: 'Please enter a valid phone number (9-10 digits)'
    },

    // Thai ID Card number (13 digits)
    thaiId: {
        pattern: /^[0-9]{13}$/,
        message: 'Please enter a valid Thai ID card number (13 digits)'
    },

    // HN (Hospital Number) format
    hn: {
        pattern: /^HN[0-9]{6,}$/,
        message: 'Please enter a valid HN number (HN followed by at least 6 digits)'
    },

    // PT Number format
    ptNumber: {
        pattern: /^PT[0-9]{6,}$/,
        message: 'Please enter a valid PT number (PT followed by at least 6 digits)'
    },

    // PN Code format
    pnCode: {
        pattern: /^PN[0-9]{8}$/,
        message: 'Please enter a valid PN code (PN followed by 8 digits)'
    },

    // Password strength
    password: {
        pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
        message: 'Password must be at least 8 characters with uppercase, lowercase, and number'
    },

    // Simple password (minimum 6 characters)
    passwordSimple: {
        pattern: /^.{6,}$/,
        message: 'Password must be at least 6 characters'
    },

    // Number (positive integers)
    number: {
        pattern: /^[0-9]+$/,
        message: 'Please enter a valid number'
    },

    // Decimal number
    decimal: {
        pattern: /^[0-9]+(\.[0-9]+)?$/,
        message: 'Please enter a valid number'
    },

    // Date (YYYY-MM-DD)
    date: {
        pattern: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
        message: 'Please enter a valid date (YYYY-MM-DD)'
    },

    // Time (HH:MM)
    time: {
        pattern: /^[0-2][0-9]:[0-5][0-9]$/,
        message: 'Please enter a valid time (HH:MM)'
    },

    // URL
    url: {
        pattern: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
        message: 'Please enter a valid URL'
    }
};

/**
 * Validate a single field
 * @param {HTMLElement} field - Input element to validate
 * @param {Object} rules - Validation rules
 * @returns {Object} - {valid: boolean, message: string}
 */
function validateField(field, rules = {}) {
    const value = field.value.trim();
    const fieldName = field.getAttribute('name') || field.getAttribute('id') || 'This field';

    // Check if required
    if (rules.required && !value) {
        return {
            valid: false,
            message: rules.requiredMessage || `${fieldName} is required`
        };
    }

    // Skip other validations if empty and not required
    if (!value && !rules.required) {
        return { valid: true, message: '' };
    }

    // Check pattern
    if (rules.pattern) {
        const pattern = rules.pattern instanceof RegExp ? rules.pattern : ValidationRules[rules.pattern]?.pattern;
        if (pattern && !pattern.test(value)) {
            return {
                valid: false,
                message: rules.message || ValidationRules[rules.pattern]?.message || 'Invalid format'
            };
        }
    }

    // Check minimum length
    if (rules.minLength && value.length < rules.minLength) {
        return {
            valid: false,
            message: rules.minLengthMessage || `Minimum ${rules.minLength} characters required`
        };
    }

    // Check maximum length
    if (rules.maxLength && value.length > rules.maxLength) {
        return {
            valid: false,
            message: rules.maxLengthMessage || `Maximum ${rules.maxLength} characters allowed`
        };
    }

    // Check minimum value
    if (rules.min !== undefined && parseFloat(value) < rules.min) {
        return {
            valid: false,
            message: rules.minMessage || `Minimum value is ${rules.min}`
        };
    }

    // Check maximum value
    if (rules.max !== undefined && parseFloat(value) > rules.max) {
        return {
            valid: false,
            message: rules.maxMessage || `Maximum value is ${rules.max}`
        };
    }

    // Custom validator function
    if (rules.validator && typeof rules.validator === 'function') {
        const result = rules.validator(value, field);
        if (result !== true) {
            return {
                valid: false,
                message: typeof result === 'string' ? result : 'Invalid value'
            };
        }
    }

    return { valid: true, message: '' };
}

/**
 * Show validation error on field
 * @param {HTMLElement} field - Input element
 * @param {string} message - Error message
 */
function showFieldError(field, message) {
    // Add invalid class
    field.classList.add('is-invalid');
    field.classList.remove('is-valid');

    // Find or create feedback element
    let feedback = field.nextElementSibling;
    if (!feedback || !feedback.classList.contains('invalid-feedback')) {
        feedback = document.createElement('div');
        feedback.className = 'invalid-feedback';
        field.parentNode.insertBefore(feedback, field.nextSibling);
    }

    feedback.textContent = message;
    feedback.style.display = 'block';

    // Set aria-invalid
    field.setAttribute('aria-invalid', 'true');
}

/**
 * Clear validation error on field
 * @param {HTMLElement} field - Input element
 */
function clearFieldError(field) {
    field.classList.remove('is-invalid');
    field.classList.add('is-valid');

    const feedback = field.nextElementSibling;
    if (feedback && feedback.classList.contains('invalid-feedback')) {
        feedback.style.display = 'none';
    }

    field.setAttribute('aria-invalid', 'false');
}

/**
 * Clear all validation errors on field
 * @param {HTMLElement} field - Input element
 */
function clearFieldValidation(field) {
    field.classList.remove('is-invalid', 'is-valid');

    const feedback = field.nextElementSibling;
    if (feedback && feedback.classList.contains('invalid-feedback')) {
        feedback.style.display = 'none';
    }

    field.removeAttribute('aria-invalid');
}

/**
 * Validate entire form
 * @param {HTMLFormElement|string} form - Form element or selector
 * @param {Object} validationRules - Object mapping field names/ids to validation rules
 * @returns {Object} - {valid: boolean, errors: Object}
 */
function validateForm(form, validationRules = {}) {
    if (typeof form === 'string') {
        form = document.querySelector(form);
    }

    if (!form) {
        console.error('Form not found');
        return { valid: false, errors: {} };
    }

    const errors = {};
    let firstInvalidField = null;

    // Validate each field
    for (const [fieldName, rules] of Object.entries(validationRules)) {
        const field = form.querySelector(`[name="${fieldName}"], #${fieldName}`);

        if (!field) {
            console.warn(`Field ${fieldName} not found in form`);
            continue;
        }

        const result = validateField(field, rules);

        if (!result.valid) {
            errors[fieldName] = result.message;
            showFieldError(field, result.message);

            if (!firstInvalidField) {
                firstInvalidField = field;
            }
        } else {
            clearFieldError(field);
        }
    }

    // Focus first invalid field
    if (firstInvalidField) {
        firstInvalidField.focus();
        firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors: errors
    };
}

/**
 * Setup real-time validation for a form
 * @param {HTMLFormElement|string} form - Form element or selector
 * @param {Object} validationRules - Object mapping field names/ids to validation rules
 */
function setupLiveValidation(form, validationRules = {}) {
    if (typeof form === 'string') {
        form = document.querySelector(form);
    }

    if (!form) {
        console.error('Form not found');
        return;
    }

    for (const [fieldName, rules] of Object.entries(validationRules)) {
        const field = form.querySelector(`[name="${fieldName}"], #${fieldName}`);

        if (!field) continue;

        // Validate on blur
        field.addEventListener('blur', () => {
            const result = validateField(field, rules);
            if (!result.valid) {
                showFieldError(field, result.message);
            } else {
                clearFieldError(field);
            }
        });

        // Clear error on input
        field.addEventListener('input', () => {
            if (field.classList.contains('is-invalid')) {
                const result = validateField(field, rules);
                if (result.valid) {
                    clearFieldError(field);
                }
            }
        });
    }
}

/**
 * Validate password match
 * @param {string} password1Selector - First password field selector
 * @param {string} password2Selector - Confirm password field selector
 * @returns {boolean} - True if passwords match
 */
function validatePasswordMatch(password1Selector, password2Selector) {
    const password1 = document.querySelector(password1Selector);
    const password2 = document.querySelector(password2Selector);

    if (!password1 || !password2) return false;

    if (password1.value !== password2.value) {
        showFieldError(password2, 'Passwords do not match');
        return false;
    }

    clearFieldError(password2);
    return true;
}

/**
 * Validate date range
 * @param {string} startDateSelector - Start date field selector
 * @param {string} endDateSelector - End date field selector
 * @returns {boolean} - True if range is valid
 */
function validateDateRange(startDateSelector, endDateSelector) {
    const startDate = document.querySelector(startDateSelector);
    const endDate = document.querySelector(endDateSelector);

    if (!startDate || !endDate) return false;

    const start = new Date(startDate.value);
    const end = new Date(endDate.value);

    if (end < start) {
        showFieldError(endDate, 'End date must be after start date');
        return false;
    }

    clearFieldError(endDate);
    return true;
}

/**
 * Reset form validation
 * @param {HTMLFormElement|string} form - Form element or selector
 */
function resetFormValidation(form) {
    if (typeof form === 'string') {
        form = document.querySelector(form);
    }

    if (!form) return;

    const fields = form.querySelectorAll('input, select, textarea');
    fields.forEach(field => clearFieldValidation(field));
}

// Export functions for use in other scripts
if (typeof window !== 'undefined') {
    window.FormValidator = {
        ValidationRules,
        validateField,
        validateForm,
        setupLiveValidation,
        showFieldError,
        clearFieldError,
        clearFieldValidation,
        validatePasswordMatch,
        validateDateRange,
        resetFormValidation
    };
}