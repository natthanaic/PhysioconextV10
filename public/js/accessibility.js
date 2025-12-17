/**
 * Accessibility Utilities
 * Helper functions for improving accessibility across the application
 */

/**
 * Announce message to screen readers
 * @param {string} message - Message to announce
 * @param {string} priority - 'polite' or 'assertive'
 */
function announceToScreenReader(message, priority = 'polite') {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', priority);
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;

    document.body.appendChild(announcement);

    // Remove after announcement
    setTimeout(() => {
        document.body.removeChild(announcement);
    }, 1000);
}

/**
 * Trap focus within a container (for modals)
 * @param {HTMLElement} container - Container to trap focus in
 * @returns {Function} Cleanup function
 */
function trapFocus(container) {
    const focusableElements = container.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), ' +
        'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    function handleTabKey(e) {
        if (e.key !== 'Tab') return;

        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                e.preventDefault();
                lastFocusable.focus();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                e.preventDefault();
                firstFocusable.focus();
            }
        }
    }

    container.addEventListener('keydown', handleTabKey);

    // Focus first element
    if (firstFocusable) {
        firstFocusable.focus();
    }

    // Return cleanup function
    return () => {
        container.removeEventListener('keydown', handleTabKey);
    };
}

/**
 * Manage focus for modals
 * @param {HTMLElement} modal - Modal element
 * @param {HTMLElement} trigger - Element that opened the modal
 */
function manageFocusForModal(modal, trigger) {
    let cleanup = null;

    modal.addEventListener('shown.bs.modal', () => {
        cleanup = trapFocus(modal);
        announceToScreenReader('Modal opened', 'assertive');
    });

    modal.addEventListener('hidden.bs.modal', () => {
        if (cleanup) cleanup();
        if (trigger) trigger.focus();
        announceToScreenReader('Modal closed', 'assertive');
    });
}

/**
 * Add skip navigation link
 * @param {string} targetId - ID of main content
 */
function addSkipLink(targetId = 'main-content') {
    const skipLink = document.createElement('a');
    skipLink.href = `#${targetId}`;
    skipLink.className = 'skip-link';
    skipLink.textContent = 'Skip to main content';
    skipLink.setAttribute('aria-label', 'Skip to main content');

    document.body.insertBefore(skipLink, document.body.firstChild);
}

/**
 * Ensure element has proper ARIA label
 * @param {HTMLElement} element - Element to check
 * @param {string} label - Label text
 */
function ensureAriaLabel(element, label) {
    if (!element) return;

    if (!element.getAttribute('aria-label') &&
        !element.getAttribute('aria-labelledby') &&
        !element.textContent.trim()) {
        element.setAttribute('aria-label', label);
    }
}

/**
 * Make table accessible
 * @param {HTMLTableElement} table - Table element
 */
function makeTableAccessible(table) {
    if (!table) return;

    // Add role if missing
    if (!table.getAttribute('role')) {
        table.setAttribute('role', 'table');
    }

    // Add caption if missing
    if (!table.querySelector('caption')) {
        const caption = document.createElement('caption');
        caption.className = 'sr-only';
        caption.textContent = table.getAttribute('aria-label') || 'Data table';
        table.insertBefore(caption, table.firstChild);
    }

    // Ensure headers have scope
    const headers = table.querySelectorAll('th');
    headers.forEach(th => {
        if (!th.getAttribute('scope')) {
            th.setAttribute('scope', 'col');
        }
    });
}

/**
 * Add loading announcement
 * @param {string} message - Loading message
 */
function announceLoading(message = 'Loading...') {
    announceToScreenReader(message, 'polite');
}

/**
 * Add success announcement
 * @param {string} message - Success message
 */
function announceSuccess(message) {
    announceToScreenReader(message, 'assertive');
}

/**
 * Add error announcement
 * @param {string} message - Error message
 */
function announceError(message) {
    announceToScreenReader(message, 'assertive');
}

/**
 * Check if element is visible to screen readers
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if visible
 */
function isVisibleToScreenReaders(element) {
    if (!element) return false;

    return element.getAttribute('aria-hidden') !== 'true' &&
           !element.classList.contains('d-none') &&
           element.offsetParent !== null;
}

/**
 * Set up accessible form
 * @param {HTMLFormElement} form - Form element
 */
function setupAccessibleForm(form) {
    if (!form) return;

    // Ensure all inputs have labels
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        const id = input.getAttribute('id');
        if (!id) return;

        const label = form.querySelector(`label[for="${id}"]`);
        if (!label && !input.getAttribute('aria-label')) {
            console.warn(`Input ${id} is missing a label`);
        }

        // Add aria-required for required fields
        if (input.hasAttribute('required') && !input.getAttribute('aria-required')) {
            input.setAttribute('aria-required', 'true');
        }
    });
}

/**
 * Create visually hidden element (screen reader only)
 * @param {string} text - Text content
 * @returns {HTMLElement} Hidden element
 */
function createSROnlyElement(text) {
    const element = document.createElement('span');
    element.className = 'sr-only';
    element.textContent = text;
    return element;
}

/**
 * Add accessible icon
 * @param {string} iconClass - Icon class (e.g., 'bi-check')
 * @param {string} label - Screen reader label
 * @returns {HTMLElement} Icon element
 */
function createAccessibleIcon(iconClass, label) {
    const icon = document.createElement('i');
    icon.className = iconClass;
    icon.setAttribute('aria-hidden', 'true');

    if (label) {
        const srText = createSROnlyElement(label);
        const wrapper = document.createElement('span');
        wrapper.appendChild(icon);
        wrapper.appendChild(srText);
        return wrapper;
    }

    return icon;
}

/**
 * Ensure button has accessible name
 * @param {HTMLButtonElement} button - Button element
 * @param {string} fallbackLabel - Fallback label if none exists
 */
function ensureButtonAccessibility(button, fallbackLabel) {
    if (!button) return;

    const hasText = button.textContent.trim().length > 0;
    const hasAriaLabel = button.getAttribute('aria-label');
    const hasAriaLabelledby = button.getAttribute('aria-labelledby');
    const hasTitle = button.getAttribute('title');

    if (!hasText && !hasAriaLabel && !hasAriaLabelledby && !hasTitle) {
        if (fallbackLabel) {
            button.setAttribute('aria-label', fallbackLabel);
        } else {
            console.warn('Button is missing accessible name:', button);
        }
    }
}

/**
 * Set up pagination accessibility
 * @param {HTMLElement} pagination - Pagination container
 */
function setupAccessiblePagination(pagination) {
    if (!pagination) return;

    pagination.setAttribute('role', 'navigation');
    pagination.setAttribute('aria-label', 'Pagination');

    const links = pagination.querySelectorAll('a, button');
    links.forEach((link, index) => {
        const text = link.textContent.trim();

        if (text === 'Previous' || text === 'Prev') {
            link.setAttribute('aria-label', 'Go to previous page');
        } else if (text === 'Next') {
            link.setAttribute('aria-label', 'Go to next page');
        } else if (/^\d+$/.test(text)) {
            link.setAttribute('aria-label', `Go to page ${text}`);

            if (link.classList.contains('active')) {
                link.setAttribute('aria-current', 'page');
            }
        }
    });
}

/**
 * Create accessible tooltip
 * @param {HTMLElement} trigger - Element that triggers tooltip
 * @param {string} text - Tooltip text
 */
function addAccessibleTooltip(trigger, text) {
    if (!trigger || !text) return;

    trigger.setAttribute('aria-describedby', `tooltip-${Date.now()}`);
    trigger.setAttribute('title', text);
}

/**
 * Ensure image has alt text
 * @param {HTMLImageElement} img - Image element
 * @param {string} fallbackAlt - Fallback alt text
 */
function ensureImageAlt(img, fallbackAlt = '') {
    if (!img) return;

    if (!img.getAttribute('alt')) {
        img.setAttribute('alt', fallbackAlt);
        if (!fallbackAlt) {
            console.warn('Image is missing alt text:', img);
        }
    }
}

/**
 * Set up live region for dynamic content
 * @param {HTMLElement} element - Element to make live
 * @param {string} politeness - 'polite' or 'assertive'
 */
function setupLiveRegion(element, politeness = 'polite') {
    if (!element) return;

    element.setAttribute('aria-live', politeness);
    element.setAttribute('aria-atomic', 'true');
}

/**
 * Check color contrast ratio
 * @param {string} foreground - Foreground color (hex)
 * @param {string} background - Background color (hex)
 * @returns {number} Contrast ratio
 */
function getContrastRatio(foreground, background) {
    // Convert hex to RGB
    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    };

    // Get relative luminance
    const getLuminance = (rgb) => {
        const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(val => {
            val = val / 255;
            return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const fg = hexToRgb(foreground);
    const bg = hexToRgb(background);

    if (!fg || !bg) return 0;

    const l1 = getLuminance(fg);
    const l2 = getLuminance(bg);

    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);

    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if contrast ratio meets WCAG standards
 * @param {number} ratio - Contrast ratio
 * @param {string} level - 'AA' or 'AAA'
 * @param {boolean} isLargeText - True for large text (18pt+ or 14pt+ bold)
 * @returns {boolean} True if passes
 */
function meetsWCAGContrast(ratio, level = 'AA', isLargeText = false) {
    if (level === 'AAA') {
        return isLargeText ? ratio >= 4.5 : ratio >= 7;
    }
    return isLargeText ? ratio >= 3 : ratio >= 4.5;
}

// Export functions
if (typeof window !== 'undefined') {
    window.A11y = {
        announceToScreenReader,
        announceLoading,
        announceSuccess,
        announceError,
        trapFocus,
        manageFocusForModal,
        addSkipLink,
        ensureAriaLabel,
        makeTableAccessible,
        setupAccessibleForm,
        createSROnlyElement,
        createAccessibleIcon,
        ensureButtonAccessibility,
        setupAccessiblePagination,
        addAccessibleTooltip,
        ensureImageAlt,
        setupLiveRegion,
        getContrastRatio,
        meetsWCAGContrast,
        isVisibleToScreenReaders
    };
}

/**
 * Auto-close mobile sidebar when clicking a navigation link
 */
function initMobileSidebarAutoClose() {
    // Only run on mobile devices
    if (window.innerWidth < 768) {
        const sidebar = document.getElementById('sidebarMenu');
        const navLinks = sidebar ? sidebar.querySelectorAll('.nav-link') : [];
        
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                // Close the sidebar collapse
                const bsCollapse = bootstrap.Collapse.getInstance(sidebar);
                if (bsCollapse) {
                    bsCollapse.hide();
                }
            });
        });
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileSidebarAutoClose);
} else {
    initMobileSidebarAutoClose();
}

// Re-initialize on window resize
let resizeTimer;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(initMobileSidebarAutoClose, 250);
});

// Export to A11y namespace
if (window.A11y) {
    window.A11y.initMobileSidebarAutoClose = initMobileSidebarAutoClose;
}