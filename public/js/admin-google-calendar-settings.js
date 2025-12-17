// Google Calendar Settings Management

// Get authentication token from cookie

// Show notification
function showNotification(message, type = 'success') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3`;
    alertDiv.style.zIndex = '9999';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), 5000);
}

// Load Google Calendar settings
async function loadGoogleCalendarSettings() {
    try {
        const response = await fetch('/api/admin/notification/google-calendar', {
            headers: {}
        });

        if (response.status === 404) {
            // No settings found - use defaults
            document.getElementById('gcEnabled').value = '0';
            document.getElementById('gcSendInvites').value = '0';
            document.getElementById('gcTimeZone').value = 'Asia/Bangkok';
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to load settings');
        }

        const settings = await response.json();

        console.log('🔍 Loaded Private Key Debug:');
        console.log('Length:', (settings.privateKey || '').length);
        console.log('First 50 chars:', (settings.privateKey || '').substring(0, 50));
        console.log('Last 50 chars:', (settings.privateKey || '').substring((settings.privateKey || '').length - 50));
        console.log('Contains BEGIN:', (settings.privateKey || '').includes('-----BEGIN PRIVATE KEY-----'));
        console.log('Contains END:', (settings.privateKey || '').includes('-----END PRIVATE KEY-----'));
        console.log('Contains \\n:', (settings.privateKey || '').includes('\\n'));

        document.getElementById('gcEnabled').value = settings.enabled || '0';
        document.getElementById('gcServiceAccountEmail').value = settings.serviceAccountEmail || '';
        document.getElementById('gcPrivateKey').value = settings.privateKey || '';
        document.getElementById('gcCalendarId').value = settings.calendarId || '';
        document.getElementById('gcSendInvites').value = settings.sendInvites || '0';
        document.getElementById('gcTimeZone').value = settings.timeZone || 'Asia/Bangkok';

    } catch (error) {
        console.error('Load settings error:', error);
        showNotification('Failed to load Google Calendar settings', 'danger');
    }
}

// Save Google Calendar settings
async function saveGoogleCalendarSettings() {
    try {
        const privateKeyValue = document.getElementById('gcPrivateKey').value.trim();

        console.log('🔍 Saving Private Key Debug:');
        console.log('Length:', privateKeyValue.length);
        console.log('First 50 chars:', privateKeyValue.substring(0, 50));
        console.log('Last 50 chars:', privateKeyValue.substring(privateKeyValue.length - 50));
        console.log('Contains BEGIN:', privateKeyValue.includes('-----BEGIN PRIVATE KEY-----'));
        console.log('Contains END:', privateKeyValue.includes('-----END PRIVATE KEY-----'));
        console.log('Contains \\n:', privateKeyValue.includes('\\n'));

        const settings = {
            enabled: document.getElementById('gcEnabled').value,
            serviceAccountEmail: document.getElementById('gcServiceAccountEmail').value.trim(),
            privateKey: privateKeyValue,
            calendarId: document.getElementById('gcCalendarId').value.trim(),
            sendInvites: document.getElementById('gcSendInvites').value,
            timeZone: document.getElementById('gcTimeZone').value
        };
        const response = await fetch('/api/admin/notification/google-calendar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save settings');
        }

        showNotification('Google Calendar settings saved successfully!', 'success');
    } catch (error) {
        console.error('Save settings error:', error);
        showNotification(error.message, 'danger');
    }
}

// Test Google Calendar connection
async function testGoogleCalendar() {
    const testBtn = document.getElementById('testGoogleCalendarBtn');
    const originalText = testBtn.innerHTML;
    testBtn.disabled = true;
    testBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Testing...';

    try {
        const response = await fetch('/api/admin/notification/google-calendar/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (!response.ok) {
            // Log detailed debug info from server
            if (result.debug) {
                console.error('🔍 Server Debug Info:', result.debug);
            }
            if (result.errorDetails) {
                console.error('❌ Error Details:', result.errorDetails);
            }
            throw new Error(result.error || 'Test failed');
        }

        showNotification('✅ ' + result.message, 'success');
    } catch (error) {
        console.error('Test error:', error);
        showNotification('❌ ' + error.message, 'danger');
    } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = originalText;
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadGoogleCalendarSettings();

    // Save button handler
    document.getElementById('saveGoogleCalendarBtn').addEventListener('click', saveGoogleCalendarSettings);

    // Test button handler
    document.getElementById('testGoogleCalendarBtn').addEventListener('click', testGoogleCalendar);
});