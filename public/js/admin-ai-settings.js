// Admin AI Settings Management
document.addEventListener('DOMContentLoaded', () => {
    loadAISettings();
    setupEventListeners();
});

function setupEventListeners() {
    // Gemini form submission
    document.getElementById('gemini-settings-form').addEventListener('submit', saveAISettings);

    // Toggle API key visibility
    document.getElementById('toggle-api-key').addEventListener('click', toggleAPIKeyVisibility);

    // Test AI connection
    document.getElementById('test-ai-btn').addEventListener('click', testAIConnection);

    // ShinoAI form (uses same Gemini settings)
    document.getElementById('gemini-settings-form-shino').addEventListener('submit', saveAISettings);
    document.getElementById('toggle-api-key-shino').addEventListener('click', toggleAPIKeyVisibilityShino);
    document.getElementById('test-ai-btn-shino').addEventListener('click', testAIConnection);

    // Tab switching - load settings when switching to ShinoAI tab
    const shinoaiTab = document.getElementById('shinoai-tab');
    if (shinoaiTab) {
        shinoaiTab.addEventListener('shown.bs.tab', () => {
            loadAISettings(); // Reload to populate ShinoAI form
        });
    }
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
    // Populate Gemini AI form
    document.getElementById('gemini-enabled').value = settings.enabled ? '1' : '0';
    document.getElementById('gemini-model').value = settings.model || 'gemini-2.5-flash';
    document.getElementById('gemini-api-key').value = settings.apiKey || '';

    // Features
    document.getElementById('feature-symptom-analysis').checked = settings.features?.symptomAnalysis !== false;
    document.getElementById('feature-note-polish').checked = settings.features?.notePolish !== false;

    // Populate ShinoAI form (same settings)
    document.getElementById('gemini-enabled-shino').value = settings.enabled ? '1' : '0';
    document.getElementById('gemini-model-shino').value = settings.model || 'gemini-2.5-flash';
    document.getElementById('gemini-api-key-shino').value = settings.apiKey || '';

    // Features for ShinoAI
    document.getElementById('feature-symptom-analysis-shino').checked = settings.features?.symptomAnalysis !== false;
    document.getElementById('feature-note-polish-shino').checked = settings.features?.notePolish !== false;
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
    const formId = e.target.id;

    // Determine which form was submitted and get the correct checkbox IDs
    let symptomCheckbox, noteCheckbox;
    if (formId === 'gemini-settings-form-shino') {
        symptomCheckbox = document.getElementById('feature-symptom-analysis-shino');
        noteCheckbox = document.getElementById('feature-note-polish-shino');
    } else {
        symptomCheckbox = document.getElementById('feature-symptom-analysis');
        noteCheckbox = document.getElementById('feature-note-polish');
    }

    const settings = {
        enabled: formData.get('enabled') === '1',
        model: formData.get('model'),
        apiKey: formData.get('apiKey'),
        features: {
            symptomAnalysis: symptomCheckbox.checked,
            notePolish: noteCheckbox.checked
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
            // Reload settings to sync both forms
            await loadAISettings();
        } else {
            showAlert(result.error || 'Failed to save settings', 'danger');
        }
    } catch (error) {
        console.error('Save AI settings error:', error);
        showAlert('Error saving AI settings', 'danger');
    }
}

// Toggle API key visibility (Gemini form)
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

// Toggle API key visibility (ShinoAI form)
function toggleAPIKeyVisibilityShino() {
    const input = document.getElementById('gemini-api-key-shino');
    const button = document.getElementById('toggle-api-key-shino');
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