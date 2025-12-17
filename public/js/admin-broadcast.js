// admin-broadcast.js - Broadcast Marketing Management
let quillEditor;
let campaignModal;
let currentCampaignId = null;
let selectedRecipients = [];

// Template variables available for personalization
const TEMPLATE_VARIABLES = [
    { name: '{patientName}', desc: 'Patient\'s full name' },
    { name: '{firstName}', desc: 'Patient\'s first name' },
    { name: '{lastName}', desc: 'Patient\'s last name' },
    { name: '{email}', desc: 'Patient\'s email address' },
    { name: '{phone}', desc: 'Patient\'s phone number' },
    { name: '{clinicName}', desc: 'Your clinic name' },
    { name: '{address}', desc: 'Patient\'s address' },
    { name: '{emergencyContact}', desc: 'Emergency contact name' },
    { name: '{emergencyPhone}', desc: 'Emergency contact phone' }
];

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Bootstrap modal
    campaignModal = new bootstrap.Modal(document.getElementById('campaignModal'));

    // Initialize Quill editor
    initializeQuillEditor();

    // Load initial data
    loadStatistics();
    loadCampaigns();

    // Setup event listeners
    setupEventListeners();
});

// ========================================
// QUILL EDITOR SETUP
// ========================================
function initializeQuillEditor() {
    const toolbarOptions = [
        [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
        [{ 'font': [] }],
        [{ 'size': ['small', false, 'large', 'huge'] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'align': [] }],
        ['link', 'image', 'video'],
        ['blockquote', 'code-block'],
        ['clean']
    ];

    quillEditor = new Quill('#editor-container', {
        theme: 'snow',
        modules: {
            toolbar: toolbarOptions
        },
        placeholder: 'Compose your email content here...'
    });
}

// ========================================
// EVENT LISTENERS
// ========================================
function setupEventListeners() {
    const messageText = document.getElementById('messageText');
    const patientSearch = document.getElementById('patientSearch');

    // Message text character counter
    messageText.addEventListener('input', function() {
        document.getElementById('charCount').textContent = this.value.length;
    });

    // Template variable autocomplete
    messageText.addEventListener('input', function(e) {
        handleTemplateVariableInput(e);
    });

    messageText.addEventListener('keydown', function(e) {
        handleTemplateVariableKeydown(e);
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#messageText') && !e.target.closest('#templateVarDropdown')) {
            hideTemplateVarDropdown();
        }
    });

    // Patient search on Enter key
    patientSearch.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchPatients();
        }
    });
}

// ========================================
// LOAD STATISTICS
// ========================================
async function loadStatistics() {
    try {
        const response = await fetch('/api/broadcast/stats');
        const stats = await response.json();

        document.getElementById('statTotalCampaigns').textContent = stats.total_campaigns || 0;
        document.getElementById('statSentCampaigns').textContent = stats.sent_campaigns || 0;
        document.getElementById('statScheduledCampaigns').textContent = stats.scheduled_campaigns || 0;
        document.getElementById('statTotalRecipients').textContent = stats.total_sent || 0;
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

// ========================================
// LOAD CAMPAIGNS
// ========================================
async function loadCampaigns() {
    try {
        const tbody = document.getElementById('campaignsTableBody');
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-4">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                </td>
            </tr>
        `;

        const response = await fetch('/api/broadcast/campaigns');
        const campaigns = await response.json();

        if (campaigns.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-4 text-muted">
                        <i class="bi bi-inbox display-4 d-block mb-3"></i>
                        No campaigns yet. Create your first broadcast campaign!
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = campaigns.map(campaign => `
            <tr>
                <td>
                    <strong>${escapeHtml(campaign.campaign_name)}</strong>
                    <br><small class="text-muted">by ${escapeHtml(campaign.created_by_name)}</small>
                </td>
                <td>
                    ${getCampaignTypeIcon(campaign.campaign_type)}
                    ${campaign.campaign_type.toUpperCase()}
                </td>
                <td>
                    <span class="status-badge status-${campaign.status}">
                        ${campaign.status.toUpperCase()}
                    </span>
                </td>
                <td>${campaign.total_recipients || 0}</td>
                <td>
                    <span class="text-success">${campaign.sent_count || 0}</span> /
                    <span class="text-danger">${campaign.failed_count || 0}</span>
                </td>
                <td>${formatDate(campaign.created_at)}</td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary" onclick="viewCampaign(${campaign.id})" title="View">
                            <i class="bi bi-eye"></i>
                        </button>
                        ${campaign.status === 'draft' || campaign.status === 'scheduled' ? `
                        <button class="btn btn-outline-warning" onclick="editCampaign(${campaign.id})" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        ` : ''}
                        ${campaign.status === 'draft' ? `
                        <button class="btn btn-outline-success" onclick="sendCampaign(${campaign.id})" title="Send">
                            <i class="bi bi-send"></i>
                        </button>
                        ` : ''}
                        ${campaign.status !== 'sending' ? `
                        <button class="btn btn-outline-danger" onclick="deleteCampaign(${campaign.id})" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading campaigns:', error);
        showAlert('Failed to load campaigns', 'danger');
    }
}

// ========================================
// SHOW CREATE MODAL
// ========================================
function showCreateModal() {
    currentCampaignId = null;
    document.getElementById('modalTitle').innerHTML = '<i class="bi bi-megaphone me-2"></i>Create New Campaign';
    document.getElementById('campaignForm').reset();
    document.getElementById('campaignId').value = '';
    document.getElementById('charCount').textContent = '0';
    quillEditor.setContents([]);

    // Hide conditional fields
    document.getElementById('emailSubjectGroup').style.display = 'none';
    document.getElementById('htmlEditorGroup').style.display = 'none';
    document.getElementById('scheduledTimeGroup').style.display = 'none';

    campaignModal.show();
}

// ========================================
// HANDLE CAMPAIGN TYPE CHANGE
// ========================================
function handleCampaignTypeChange() {
    const campaignType = document.getElementById('campaignType').value;
    const emailSubjectGroup = document.getElementById('emailSubjectGroup');
    const htmlEditorGroup = document.getElementById('htmlEditorGroup');
    const emailSubject = document.getElementById('emailSubject');

    if (campaignType === 'email' || campaignType === 'both') {
        emailSubjectGroup.style.display = 'block';
        htmlEditorGroup.style.display = 'block';
        emailSubject.required = true;
    } else {
        emailSubjectGroup.style.display = 'none';
        htmlEditorGroup.style.display = 'none';
        emailSubject.required = false;
    }
}

// ========================================
// HANDLE SCHEDULE TYPE CHANGE
// ========================================
function handleScheduleTypeChange() {
    const scheduleType = document.getElementById('scheduleType').value;
    const scheduledTimeGroup = document.getElementById('scheduledTimeGroup');
    const scheduledTime = document.getElementById('scheduledTime');

    if (scheduleType === 'scheduled') {
        scheduledTimeGroup.style.display = 'block';
        scheduledTime.required = true;
    } else {
        scheduledTimeGroup.style.display = 'none';
        scheduledTime.required = false;
    }
}

// ========================================
// SAVE CAMPAIGN
// ========================================
async function saveCampaign() {
    try {
        const campaignName = document.getElementById('campaignName').value.trim();
        const campaignType = document.getElementById('campaignType').value;
        const emailSubject = document.getElementById('emailSubject').value.trim();
        const messageText = document.getElementById('messageText').value.trim();
        const targetAudience = document.getElementById('targetAudience').value;
        const scheduleType = document.getElementById('scheduleType').value;
        const scheduledTime = document.getElementById('scheduledTime').value;

        // Validation
        if (!campaignName) {
            showAlert('Please enter campaign name', 'warning');
            return;
        }

        if (!campaignType) {
            showAlert('Please select campaign type', 'warning');
            return;
        }

        if ((campaignType === 'email' || campaignType === 'both') && !emailSubject) {
            showAlert('Please enter email subject', 'warning');
            return;
        }

        if (!messageText) {
            showAlert('Please enter message text', 'warning');
            return;
        }

        if (scheduleType === 'scheduled' && !scheduledTime) {
            showAlert('Please select scheduled time', 'warning');
            return;
        }

        // Validate custom recipients
        if (targetAudience === 'custom' && selectedRecipients.length === 0) {
            showAlert('Please select at least one recipient', 'warning');
            return;
        }

        // Get HTML content from Quill editor
        const messageHtml = quillEditor.root.innerHTML;

        // Prepare data
        const data = {
            campaign_name: campaignName,
            campaign_type: campaignType,
            subject: emailSubject,
            message_text: messageText,
            message_html: messageHtml !== '<p><br></p>' ? messageHtml : null,
            target_audience: targetAudience,
            custom_recipients: targetAudience === 'custom' ? JSON.stringify(selectedRecipients) : null,
            schedule_type: scheduleType,
            scheduled_time: scheduledTime || null
        };

        // Determine endpoint (create or update)
        const campaignId = document.getElementById('campaignId').value;
        const endpoint = campaignId
            ? `/api/broadcast/campaigns/${campaignId}`
            : '/api/broadcast/campaigns';
        const method = campaignId ? 'PUT' : 'POST';

        // Send request
        const response = await fetch(endpoint, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok) {
            showAlert(campaignId ? 'Campaign updated successfully' : 'Campaign created successfully', 'success');
            campaignModal.hide();
            loadCampaigns();
            loadStatistics();
        } else {
            showAlert(result.error || 'Failed to save campaign', 'danger');
        }
    } catch (error) {
        console.error('Error saving campaign:', error);
        showAlert('Failed to save campaign', 'danger');
    }
}

// ========================================
// VIEW CAMPAIGN
// ========================================
async function viewCampaign(id) {
    try {
        const response = await fetch(`/api/broadcast/campaigns/${id}`);
        const campaign = await response.json();

        // Show in modal with readonly fields
        const alertHtml = `
            <div class="modal fade" id="viewCampaignModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header bg-primary text-white">
                            <h5 class="modal-title"><i class="bi bi-eye me-2"></i>${escapeHtml(campaign.campaign_name)}</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <dl class="row">
                                <dt class="col-sm-3">Type:</dt>
                                <dd class="col-sm-9">${campaign.campaign_type.toUpperCase()}</dd>

                                <dt class="col-sm-3">Status:</dt>
                                <dd class="col-sm-9"><span class="status-badge status-${campaign.status}">${campaign.status.toUpperCase()}</span></dd>

                                ${campaign.subject ? `
                                <dt class="col-sm-3">Subject:</dt>
                                <dd class="col-sm-9">${escapeHtml(campaign.subject)}</dd>
                                ` : ''}

                                <dt class="col-sm-3">Message:</dt>
                                <dd class="col-sm-9"><pre class="bg-light p-3 rounded">${escapeHtml(campaign.message_text)}</pre></dd>

                                ${campaign.message_html ? `
                                <dt class="col-sm-3">HTML Content:</dt>
                                <dd class="col-sm-9"><div class="border p-3 rounded">${campaign.message_html}</div></dd>
                                ` : ''}

                                <dt class="col-sm-3">Target:</dt>
                                <dd class="col-sm-9">${campaign.target_audience}</dd>

                                <dt class="col-sm-3">Schedule:</dt>
                                <dd class="col-sm-9">${campaign.schedule_type}${campaign.scheduled_time ? ` (${formatDate(campaign.scheduled_time)})` : ''}</dd>

                                <dt class="col-sm-3">Recipients:</dt>
                                <dd class="col-sm-9">${campaign.total_recipients || 0}</dd>

                                <dt class="col-sm-3">Sent/Failed:</dt>
                                <dd class="col-sm-9">
                                    <span class="text-success">${campaign.sent_count || 0} sent</span> /
                                    <span class="text-danger">${campaign.failed_count || 0} failed</span>
                                </dd>

                                <dt class="col-sm-3">Created:</dt>
                                <dd class="col-sm-9">${formatDate(campaign.created_at)} by ${escapeHtml(campaign.created_by_name)}</dd>
                            </dl>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existingModal = document.getElementById('viewCampaignModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add and show modal
        document.body.insertAdjacentHTML('beforeend', alertHtml);
        const viewModal = new bootstrap.Modal(document.getElementById('viewCampaignModal'));
        viewModal.show();

        // Clean up on hide
        document.getElementById('viewCampaignModal').addEventListener('hidden.bs.modal', function() {
            this.remove();
        });
    } catch (error) {
        console.error('Error viewing campaign:', error);
        showAlert('Failed to load campaign details', 'danger');
    }
}

// ========================================
// EDIT CAMPAIGN
// ========================================
async function editCampaign(id) {
    try {
        const response = await fetch(`/api/broadcast/campaigns/${id}`);
        const campaign = await response.json();

        currentCampaignId = id;
        document.getElementById('modalTitle').innerHTML = '<i class="bi bi-pencil me-2"></i>Edit Campaign';
        document.getElementById('campaignId').value = id;
        document.getElementById('campaignName').value = campaign.campaign_name;
        document.getElementById('campaignType').value = campaign.campaign_type;
        document.getElementById('emailSubject').value = campaign.subject || '';
        document.getElementById('messageText').value = campaign.message_text;
        document.getElementById('targetAudience').value = campaign.target_audience;
        document.getElementById('scheduleType').value = campaign.schedule_type;
        document.getElementById('scheduledTime').value = campaign.scheduled_time
            ? new Date(campaign.scheduled_time).toISOString().slice(0, 16)
            : '';

        // Update character count
        document.getElementById('charCount').textContent = campaign.message_text.length;

        // Set HTML content
        if (campaign.message_html) {
            quillEditor.clipboard.dangerouslyPasteHTML(campaign.message_html);
        } else {
            quillEditor.setContents([]);
        }

        // Show/hide conditional fields
        handleCampaignTypeChange();
        handleScheduleTypeChange();

        campaignModal.show();
    } catch (error) {
        console.error('Error loading campaign for edit:', error);
        showAlert('Failed to load campaign', 'danger');
    }
}

// ========================================
// SEND CAMPAIGN
// ========================================
async function sendCampaign(id) {
    if (!confirm('Are you sure you want to send this campaign? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/broadcast/campaigns/${id}/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (response.ok) {
            showAlert(`Campaign is being sent to ${result.total_recipients} recipients`, 'success');
            loadCampaigns();
            loadStatistics();
        } else {
            showAlert(result.error || 'Failed to send campaign', 'danger');
        }
    } catch (error) {
        console.error('Error sending campaign:', error);
        showAlert('Failed to send campaign', 'danger');
    }
}

// ========================================
// DELETE CAMPAIGN
// ========================================
async function deleteCampaign(id) {
    if (!confirm('Are you sure you want to delete this campaign? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/broadcast/campaigns/${id}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (response.ok) {
            showAlert('Campaign deleted successfully', 'success');
            loadCampaigns();
            loadStatistics();
        } else {
            showAlert(result.error || 'Failed to delete campaign', 'danger');
        }
    } catch (error) {
        console.error('Error deleting campaign:', error);
        showAlert('Failed to delete campaign', 'danger');
    }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================
function showAlert(message, type = 'info', duration = 5000) {
    const alertHtml = `
        <div class="alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3" style="z-index: 9999; max-width: 500px;">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', alertHtml);
    setTimeout(() => {
        const alert = document.querySelector('.alert');
        if (alert) alert.remove();
    }, duration);
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text ? text.replace(/[&<>"']/g, m => map[m]) : '';
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getCampaignTypeIcon(type) {
    const icons = {
        'sms': '<i class="bi bi-phone me-1"></i>',
        'email': '<i class="bi bi-envelope me-1"></i>',
        'both': '<i class="bi bi-broadcast me-1"></i>'
    };
    return icons[type] || '';
}

// ========================================
// TEMPLATE VARIABLE AUTOCOMPLETE
// ========================================
let selectedVarIndex = -1;

function handleTemplateVariableInput(e) {
    const textarea = e.target;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPos);

    // Check if user just typed {
    const lastChar = textBeforeCursor[textBeforeCursor.length - 1];
    if (lastChar === '{') {
        showTemplateVarDropdown(textarea);
        return;
    }

    // Check if we're inside a { } and filter variables
    const lastOpenBrace = textBeforeCursor.lastIndexOf('{');
    const lastCloseBrace = textBeforeCursor.lastIndexOf('}');

    if (lastOpenBrace > lastCloseBrace) {
        const searchTerm = textBeforeCursor.substring(lastOpenBrace + 1).toLowerCase();
        filterTemplateVars(searchTerm, textarea);
    } else {
        hideTemplateVarDropdown();
    }
}

function handleTemplateVariableKeydown(e) {
    const dropdown = document.getElementById('templateVarDropdown');
    if (dropdown.style.display === 'none') return;

    const items = dropdown.querySelectorAll('.template-var-item');

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedVarIndex = Math.min(selectedVarIndex + 1, items.length - 1);
        highlightSelectedVar(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedVarIndex = Math.max(selectedVarIndex - 1, 0);
        highlightSelectedVar(items);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (selectedVarIndex >= 0 && selectedVarIndex < items.length) {
            e.preventDefault();
            const varName = items[selectedVarIndex].dataset.varName;
            insertTemplateVar(varName, e.target);
        }
    } else if (e.key === 'Escape') {
        hideTemplateVarDropdown();
    }
}

function showTemplateVarDropdown(textarea) {
    const dropdown = document.getElementById('templateVarDropdown');
    selectedVarIndex = -1;

    dropdown.innerHTML = TEMPLATE_VARIABLES.map(v => `
        <div class="template-var-item" data-var-name="${v.name}" onclick="insertTemplateVar('${v.name}', document.getElementById('messageText'))">
            <div class="var-name">${v.name}</div>
            <div class="var-desc">${v.desc}</div>
        </div>
    `).join('');

    // Position dropdown
    const rect = textarea.getBoundingClientRect();
    dropdown.style.display = 'block';
    dropdown.style.top = (textarea.offsetTop + textarea.offsetHeight) + 'px';
    dropdown.style.left = textarea.offsetLeft + 'px';
}

function filterTemplateVars(searchTerm, textarea) {
    const dropdown = document.getElementById('templateVarDropdown');
    const filtered = TEMPLATE_VARIABLES.filter(v =>
        v.name.toLowerCase().includes(searchTerm) ||
        v.desc.toLowerCase().includes(searchTerm)
    );

    if (filtered.length === 0) {
        hideTemplateVarDropdown();
        return;
    }

    selectedVarIndex = -1;
    dropdown.innerHTML = filtered.map(v => `
        <div class="template-var-item" data-var-name="${v.name}" onclick="insertTemplateVar('${v.name}', document.getElementById('messageText'))">
            <div class="var-name">${v.name}</div>
            <div class="var-desc">${v.desc}</div>
        </div>
    `).join('');

    dropdown.style.display = 'block';
}

function highlightSelectedVar(items) {
    items.forEach((item, index) => {
        if (index === selectedVarIndex) {
            item.style.background = '#f8f9fa';
        } else {
            item.style.background = 'white';
        }
    });

    // Scroll into view
    if (items[selectedVarIndex]) {
        items[selectedVarIndex].scrollIntoView({ block: 'nearest' });
    }
}

function insertTemplateVar(varName, textarea) {
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPos);
    const textAfterCursor = textarea.value.substring(cursorPos);

    // Find the last { before cursor
    const lastOpenBrace = textBeforeCursor.lastIndexOf('{');

    // Replace from { to cursor with the variable name
    const newTextBefore = textBeforeCursor.substring(0, lastOpenBrace) + varName;
    textarea.value = newTextBefore + textAfterCursor;

    // Update cursor position
    const newCursorPos = newTextBefore.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);
    textarea.focus();

    // Update char count
    document.getElementById('charCount').textContent = textarea.value.length;

    hideTemplateVarDropdown();
}

function hideTemplateVarDropdown() {
    document.getElementById('templateVarDropdown').style.display = 'none';
    selectedVarIndex = -1;
}

// ========================================
// TARGET AUDIENCE CHANGE
// ========================================
function handleTargetAudienceChange() {
    const targetAudience = document.getElementById('targetAudience').value;
    const customRecipientsGroup = document.getElementById('customRecipientsGroup');

    if (targetAudience === 'custom') {
        customRecipientsGroup.style.display = 'block';
    } else {
        customRecipientsGroup.style.display = 'none';
        selectedRecipients = [];
        updateSelectedRecipientsDisplay();
    }
}

// ========================================
// PATIENT SEARCH
// ========================================
async function searchPatients() {
    const searchTerm = document.getElementById('patientSearch').value.trim();
    const searchResults = document.getElementById('searchResults');

    if (!searchTerm) {
        searchResults.style.display = 'none';
        return;
    }

    try {
        searchResults.innerHTML = '<div class="text-center py-2"><div class="spinner-border spinner-border-sm" role="status"></div></div>';
        searchResults.style.display = 'block';

        const response = await fetch(`/api/broadcast/search-patients?q=${encodeURIComponent(searchTerm)}`);
        const patients = await response.json();

        if (patients.length === 0) {
            searchResults.innerHTML = '<div class="text-muted text-center py-2">No patients found</div>';
            return;
        }

        searchResults.innerHTML = patients.map(p => `
            <div class="search-result-item" onclick="addRecipient(${p.id}, '${escapeHtml(p.name)}', '${escapeHtml(p.email || '')}', '${escapeHtml(p.phone || '')}')">
                <div><strong>${escapeHtml(p.name)}</strong></div>
                <div class="small text-muted">
                    ${p.email ? `<i class="bi bi-envelope me-1"></i>${escapeHtml(p.email)}` : ''}
                    ${p.phone ? `<i class="bi bi-phone ms-2 me-1"></i>${escapeHtml(p.phone)}` : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Patient search error:', error);
        searchResults.innerHTML = '<div class="text-danger text-center py-2">Search failed</div>';
    }
}

function addRecipient(id, name, email, phone) {
    // Check if already selected
    if (selectedRecipients.find(r => r.id === id)) {
        showAlert('This patient is already selected', 'warning');
        return;
    }

    selectedRecipients.push({ id, name, email, phone });
    updateSelectedRecipientsDisplay();

    // Clear search
    document.getElementById('patientSearch').value = '';
    document.getElementById('searchResults').style.display = 'none';
}

function removeRecipient(id) {
    selectedRecipients = selectedRecipients.filter(r => r.id !== id);
    updateSelectedRecipientsDisplay();
}

function clearSelectedRecipients() {
    if (selectedRecipients.length === 0) return;

    if (confirm('Are you sure you want to clear all selected recipients?')) {
        selectedRecipients = [];
        updateSelectedRecipientsDisplay();
    }
}

function updateSelectedRecipientsDisplay() {
    const container = document.getElementById('selectedRecipients');
    const countSpan = document.getElementById('selectedCount');

    countSpan.textContent = selectedRecipients.length;

    if (selectedRecipients.length === 0) {
        container.innerHTML = '<small class="text-muted">No recipients selected</small>';
        return;
    }

    container.innerHTML = selectedRecipients.map(r => `
        <span class="recipient-badge">
            <i class="bi bi-person-fill me-1"></i>${escapeHtml(r.name)}
            ${r.email ? `<i class="bi bi-envelope ms-1" title="${escapeHtml(r.email)}"></i>` : ''}
            ${r.phone ? `<i class="bi bi-phone ms-1" title="${escapeHtml(r.phone)}"></i>` : ''}
            <span class="remove-btn" onclick="removeRecipient(${r.id})" title="Remove">×</span>
        </span>
    `).join('');
}
