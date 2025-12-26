// Admin AI Settings Management
document.addEventListener('DOMContentLoaded', () => {
    loadAISettings();
    loadShinoAISettings();
    setupEventListeners();
});

function setupEventListeners() {
    // Gemini form submission
    document.getElementById('gemini-settings-form').addEventListener('submit', saveAISettings);

    // Toggle API key visibility
    document.getElementById('toggle-api-key').addEventListener('click', toggleAPIKeyVisibility);

    // Test AI connection
    document.getElementById('test-ai-btn').addEventListener('click', testAIConnection);

    // ShinoAI form submission
    document.getElementById('shinoai-settings-form').addEventListener('submit', saveShinoAISettings);

    // Toggle ShinoAI API key visibility
    document.getElementById('toggle-shinoai-key').addEventListener('click', toggleShinoAIKeyVisibility);

    // Test ShinoAI connection
    document.getElementById('test-shinoai-btn').addEventListener('click', testShinoAIConnection);
}

// Load current AI settings
async function loadAISettings() {
    try {
        const response = await fetch('/api/admin/ai-settings');

        if (response.ok) {
            const settings = await response.json();
            populateForm(settings);
            updateStatusIndicator(settings.enabled);
        } else if (response.status === 404) {
            // No settings yet - use defaults
            updateStatusIndicator(false);
        } else {
            showAlert('Failed to load AI settings', 'danger');
        }
    } catch (error) {
        console.error('Load AI settings error:', error);
        showAlert('Error loading AI settings', 'danger');
    }
}

// Populate form with settings
function populateForm(settings) {
    document.getElementById('gemini-enabled').value = settings.enabled ? '1' : '0';
    document.getElementById('gemini-model').value = settings.model || 'gemini-2.5-flash';
    document.getElementById('gemini-api-key').value = settings.apiKey || '';

    // Features
    document.getElementById('feature-symptom-analysis').checked = settings.features?.symptomAnalysis !== false;
    document.getElementById('feature-note-polish').checked = settings.features?.notePolish !== false;
}

// Update status indicator
function updateStatusIndicator(enabled) {
    const container = document.getElementById('ai-status-container');
    const statusClass = enabled ? 'enabled' : 'disabled';
    const statusText = enabled ? 'Active' : 'Inactive';

    container.innerHTML = `
        <div class="status-indicator ${statusClass}">
            <span class="status-dot ${statusClass}"></span>
            ${statusText}
        </div>
    `;
}

// Save AI settings
async function saveAISettings(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const settings = {
        enabled: formData.get('enabled') === '1',
        model: formData.get('model'),
        apiKey: formData.get('apiKey'),
        features: {
            symptomAnalysis: document.getElementById('feature-symptom-analysis').checked,
            notePolish: document.getElementById('feature-note-polish').checked
        }
    };

    try {
        const response = await fetch('/api/admin/ai-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        const result = await response.json();

        if (response.ok) {
            showAlert('AI settings saved successfully', 'success');
            updateStatusIndicator(settings.enabled);
        } else {
            showAlert(result.error || 'Failed to save settings', 'danger');
        }
    } catch (error) {
        console.error('Save AI settings error:', error);
        showAlert('Error saving AI settings', 'danger');
    }
}

// Toggle API key visibility
function toggleAPIKeyVisibility() {
    const input = document.getElementById('gemini-api-key');
    const button = document.getElementById('toggle-api-key');
    const icon = button.querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('bi-eye');
        icon.classList.add('bi-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('bi-eye-slash');
        icon.classList.add('bi-eye');
    }
}

// Test AI connection
async function testAIConnection() {
    const button = document.getElementById('test-ai-btn');
    const originalHTML = button.innerHTML;

    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Testing...';

    try {
        const response = await fetch('/api/admin/ai-settings/test', {
            method: 'POST'
        });

        const result = await response.json();

        if (response.ok) {
            showAlert(`AI Connection Test Successful! Response: "${result.response}"`, 'success');
        } else {
            showAlert(`Test Failed: ${result.error}`, 'danger');
        }
    } catch (error) {
        console.error('Test AI connection error:', error);
        showAlert('Error testing AI connection', 'danger');
    } finally {
        button.disabled = false;
        button.innerHTML = originalHTML;
    }
}

// Show alert message
function showAlert(message, type = 'info') {
    const container = document.getElementById('alert-container');

    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show`;
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    container.appendChild(alert);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        alert.remove();
    }, 5000);
}

// ========================================
// SHINOAI SETTINGS
// ========================================

// Load current ShinoAI settings
async function loadShinoAISettings() {
    try {
        const response = await fetch('/api/admin/shinoai-settings');

        if (response.ok) {
            const settings = await response.json();
            populateShinoAIForm(settings);
        } else if (response.status === 404) {
            // No settings yet - use defaults
            console.log('ShinoAI settings not configured yet');
        } else {
            showAlert('Failed to load ShinoAI settings', 'warning');
        }
    } catch (error) {
        console.error('Load ShinoAI settings error:', error);
    }
}

// Populate ShinoAI form with settings
function populateShinoAIForm(settings) {
    document.getElementById('shinoai-enabled').value = settings.enabled ? '1' : '0';
    document.getElementById('shinoai-model').value = settings.model || 'shino-default';
    document.getElementById('shinoai-api-url').value = settings.apiUrl || '';
    document.getElementById('shinoai-api-key').value = settings.apiKey || '';

    // Features
    document.getElementById('feature-chat-assistant').checked = settings.features?.chatAssistant !== false;
    document.getElementById('feature-doc-generation').checked = settings.features?.documentGeneration !== false;
    document.getElementById('feature-data-analysis').checked = settings.features?.dataAnalysis !== false;
}

// Save ShinoAI settings
async function saveShinoAISettings(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const settings = {
        enabled: formData.get('enabled') === '1',
        model: formData.get('model'),
        apiUrl: formData.get('apiUrl'),
        apiKey: formData.get('apiKey'),
        features: {
            chatAssistant: document.getElementById('feature-chat-assistant').checked,
            documentGeneration: document.getElementById('feature-doc-generation').checked,
            dataAnalysis: document.getElementById('feature-data-analysis').checked
        }
    };

    try {
        const response = await fetch('/api/admin/shinoai-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        const result = await response.json();

        if (response.ok) {
            showAlert('ShinoAI settings saved successfully', 'success');
        } else {
            showAlert(result.error || 'Failed to save ShinoAI settings', 'danger');
        }
    } catch (error) {
        console.error('Save ShinoAI settings error:', error);
        showAlert('Error saving ShinoAI settings', 'danger');
    }
}

// Toggle ShinoAI API key visibility
function toggleShinoAIKeyVisibility() {
    const input = document.getElementById('shinoai-api-key');
    const button = document.getElementById('toggle-shinoai-key');
    const icon = button.querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('bi-eye');
        icon.classList.add('bi-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('bi-eye-slash');
        icon.classList.add('bi-eye');
    }
}

// Test ShinoAI connection
async function testShinoAIConnection() {
    const button = document.getElementById('test-shinoai-btn');
    const originalHTML = button.innerHTML;

    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Testing...';

    try {
        const response = await fetch('/api/admin/shinoai-settings/test', {
            method: 'POST'
        });

        const result = await response.json();

        if (response.ok) {
            showAlert(`ShinoAI Connection Test Successful!`, 'success');
        } else {
            showAlert(`Test Failed: ${result.error}`, 'danger');
        }
    } catch (error) {
        console.error('Test ShinoAI connection error:', error);
        showAlert('Error testing ShinoAI connection', 'danger');
    } finally {
        button.disabled = false;
        button.innerHTML = originalHTML;
    }
}