// Courses Management - RehabPlus V9

// Global variables
let allTemplates = [];
let allClinics = [];
let selectedPatient = null;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    loadClinics();
    setDefaultDates();
});

function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    const purchaseDateInput = document.getElementById('purchaseDate');
    if (purchaseDateInput) {
        purchaseDateInput.value = today;
    }
}

// ============================================
// ALERT/NOTIFICATION FUNCTIONS
// ============================================
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    const container = document.getElementById('alertsContainer');
    container.appendChild(alertDiv);

    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// ============================================
// SECTION VISIBILITY FUNCTIONS
// ============================================
function showCourseSettings() {
    hideAllSections();
    const section = document.getElementById('courseSettingsSection');
    if (section) {
        section.style.display = 'block';
        loadTemplates();
    }
}

function showPurchaseCourse() {
    hideAllSections();
    const section = document.getElementById('purchaseCourseSection');
    if (section) {
        section.style.display = 'block';
        loadCourseTemplates();
        loadPurchasedCourses();
    }
}

function hideAllSections() {
    const sections = ['courseSettingsSection', 'purchaseCourseSection'];
    sections.forEach(id => {
        const section = document.getElementById(id);
        if (section) section.style.display = 'none';
    });
}

function hidePurchaseCourse() {
    hideAllSections();
}

// ============================================
// TEMPLATE MANAGEMENT (ADMIN)
// ============================================
async function loadTemplates() {
    try {
        const response = await fetch('/api/course-templates', {
            headers: {}
        });

        if (!response.ok) throw new Error('Failed to load templates');

        allTemplates = await response.json();
        renderTemplatesTable();
    } catch (error) {
        console.error('Load templates error:', error);
        showAlert('Failed to load course templates', 'danger');
    }
}

function renderTemplatesTable() {
    const tbody = document.getElementById('templatesTableBody');
    if (!tbody) return;

    if (allTemplates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No templates found. Create your first template!</td></tr>';
        return;
    }

    tbody.innerHTML = allTemplates.map(template => `
        <tr>
            <td><strong>${escapeHtml(template.template_name)}</strong></td>
            <td>${template.total_sessions} sessions</td>
            <td>฿${parseFloat(template.default_price).toFixed(2)}</td>
            <td>${template.validity_days ? template.validity_days + ' days' : 'No expiry'}</td>
            <td>
                <span class="badge ${template.active ? 'bg-success' : 'bg-secondary'}">
                    ${template.active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>
                <button class="btn btn-sm btn-info" onclick="editTemplate(${template.id})">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteTemplate(${template.id})">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function showAddTemplateModal() {
    document.getElementById('templateId').value = '';
    document.getElementById('templateModalTitle').textContent = 'Add Course Template';
    document.getElementById('templateForm').reset();
    document.getElementById('templateActive').checked = true;

    const modal = new bootstrap.Modal(document.getElementById('templateModal'));

    // Add focus management for accessibility
    if (window.A11y && window.A11y.manageFocusForModal) {
        window.A11y.manageFocusForModal(document.getElementById('templateModal'), document.activeElement);
    }
    modal.show();
}

function editTemplate(templateId) {
    const template = allTemplates.find(t => t.id === templateId);
    if (!template) return;

    document.getElementById('templateId').value = template.id;
    document.getElementById('templateModalTitle').textContent = 'Edit Course Template';
    document.getElementById('templateName').value = template.template_name;
    document.getElementById('templateDescription').value = template.description || '';
    document.getElementById('templateSessions').value = template.total_sessions;

    // Add focus management for accessibility
    if (window.A11y && window.A11y.manageFocusForModal) {
        window.A11y.manageFocusForModal(document.getElementById('templateModal'), document.activeElement);
    }
    document.getElementById('templatePrice').value = template.default_price;
    document.getElementById('templateValidity').value = template.validity_days || '';
    document.getElementById('templateActive').checked = template.active;

    const modal = new bootstrap.Modal(document.getElementById('templateModal'));
    modal.show();
}

async function saveTemplate() {
    const templateId = document.getElementById('templateId').value;
    const templateData = {
        template_name: document.getElementById('templateName').value.trim(),
        description: document.getElementById('templateDescription').value.trim(),
        total_sessions: parseInt(document.getElementById('templateSessions').value),
        default_price: parseFloat(document.getElementById('templatePrice').value),
        validity_days: document.getElementById('templateValidity').value ? parseInt(document.getElementById('templateValidity').value) : null,
        active: document.getElementById('templateActive').checked
    };

    // Validation
    if (!templateData.template_name || !templateData.total_sessions || !templateData.default_price) {
        showAlert('Please fill in all required fields', 'warning');
        return;
    }

    if (templateData.total_sessions < 1) {
        showAlert('Total sessions must be at least 1', 'warning');
        return;
    }

    if (templateData.default_price < 0) {
        showAlert('Price cannot be negative', 'warning');
        return;
    }

    try {
        const url = templateId
            ? `/api/course-templates/${templateId}`
            : '/api/course-templates';
        const method = templateId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(templateData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save template');
        }

        showAlert(`Template ${templateId ? 'updated' : 'created'} successfully!`, 'success');

        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('templateModal'));
        modal.hide();

        // Reload templates
        await loadTemplates();
    } catch (error) {
        console.error('Save template error:', error);
        showAlert(error.message, 'danger');
    }
}

async function deleteTemplate(templateId) {
    if (!confirm('Are you sure you want to delete this template? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/course-templates/${templateId}`, {
            method: 'DELETE',
            headers: {}
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete template');
        }

        showAlert('Template deleted successfully', 'success');
        await loadTemplates();
    } catch (error) {
        console.error('Delete template error:', error);
        showAlert(error.message, 'danger');
    }
}

// ============================================
// CLINIC MANAGEMENT
// ============================================
async function loadClinics() {
    try {
        const response = await fetch('/api/clinics', {
            headers: {}
        });

        if (!response.ok) throw new Error('Failed to load clinics');

        allClinics = await response.json();

        const clinicSelect = document.getElementById('courseClinic');
        if (clinicSelect) {
            clinicSelect.innerHTML = '<option value="">Select clinic</option>';
            allClinics.forEach(clinic => {
                const option = document.createElement('option');
                option.value = clinic.id;
                option.textContent = clinic.name;
                clinicSelect.appendChild(option);
            });

            // Pre-select user's clinic if available
            if (window.userInfo && window.userInfo.clinic_id) {
                clinicSelect.value = window.userInfo.clinic_id;
                if (window.userInfo.role === 'CLINIC') {
                    clinicSelect.disabled = true;
                }
            }
        }
    } catch (error) {
        console.error('Load clinics error:', error);
        showAlert('Failed to load clinics', 'danger');
    }
}

// ============================================
// COURSE TEMPLATES LOADING (For Purchase)
// ============================================
async function loadCourseTemplates() {
    try {
        const response = await fetch('/api/course-templates?active=true', {
            headers: {}
        });

        if (!response.ok) throw new Error('Failed to load course templates');

        const templates = await response.json();

        const templateSelect = document.getElementById('courseTemplate');
        if (templateSelect) {
            templateSelect.innerHTML = '<option value="">Select course package</option>';
            templates.forEach(template => {
                const option = document.createElement('option');
                option.value = template.id;
                option.textContent = `${template.template_name} (${template.total_sessions} sessions - ฿${parseFloat(template.default_price).toFixed(2)})`;
                option.dataset.sessions = template.total_sessions;
                option.dataset.price = template.default_price;
                option.dataset.validity = template.validity_days || '';
                option.dataset.description = template.description || '';
                templateSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Load course templates error:', error);
        showAlert('Failed to load course templates', 'danger');
    }
}

function updateCourseDetails() {
    const templateSelect = document.getElementById('courseTemplate');
    const selectedOption = templateSelect.options[templateSelect.selectedIndex];

    const detailsDiv = document.getElementById('courseDetailsDisplay');

    if (selectedOption.value) {
        document.getElementById('displaySessions').textContent = selectedOption.dataset.sessions;
        document.getElementById('displayPrice').textContent = parseFloat(selectedOption.dataset.price).toFixed(2);
        document.getElementById('displayValidity').textContent = selectedOption.dataset.validity || 'No limit';
        document.getElementById('displayDescription').textContent = selectedOption.dataset.description || 'No description';
        detailsDiv.style.display = 'block';
    } else {
        detailsDiv.style.display = 'none';
    }
}

// ============================================
// PATIENT SEARCH
// ============================================
async function searchPatientsForCourse() {
    const searchInput = document.getElementById('patientSearchInput');
    const searchTerm = searchInput.value.trim();

    if (searchTerm.length < 2) {
        showAlert('Please enter at least 2 characters to search', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/patients/search?q=${encodeURIComponent(searchTerm)}`, {
            headers: {}
        });

        if (!response.ok) throw new Error('Failed to search patients');

        const patients = await response.json();
        renderPatientSearchResults(patients);
    } catch (error) {
        console.error('Search patients error:', error);
        showAlert('Failed to search patients', 'danger');
    }
}

function renderPatientSearchResults(patients) {
    const resultsDiv = document.getElementById('patientSearchResultsCourse');

    if (patients.length === 0) {
        resultsDiv.innerHTML = '<div class="text-muted p-2">No patients found</div>';
        resultsDiv.style.display = 'block';
        return;
    }

    resultsDiv.innerHTML = patients.map(patient => `
        <div class="border-bottom p-2 cursor-pointer" style="cursor: pointer;" onclick='selectPatientForCourse(${JSON.stringify(patient)})'>
            <strong>${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}</strong><br>
            <small class="text-muted">HN: ${escapeHtml(patient.hn)} | PT: ${escapeHtml(patient.pt_number)}</small>
        </div>
    `).join('');

    resultsDiv.style.display = 'block';
}

function selectPatientForCourse(patient) {
    selectedPatient = patient;

    document.getElementById('selectedPatientId').value = patient.id;
    document.getElementById('selectedPatientName').textContent =
        `${patient.first_name} ${patient.last_name} (HN: ${patient.hn})`;
    document.getElementById('selectedPatientDisplay').style.display = 'block';

    // Hide search results
    document.getElementById('patientSearchResultsCourse').style.display = 'none';
    document.getElementById('patientSearchInput').value = '';
}

// ============================================
// COURSE PURCHASE
// ============================================
document.getElementById('purchaseCourseForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    await purchaseCourse();
});

async function purchaseCourse() {
    const patientId = document.getElementById('selectedPatientId').value;
    const clinicId = document.getElementById('courseClinic').value;
    const templateId = document.getElementById('courseTemplate').value;
    const customPrice = document.getElementById('customPrice').value;
    const purchaseDate = document.getElementById('purchaseDate').value;
    const notes = document.getElementById('courseNotes').value;

    // Validation
    if (!patientId) {
        showAlert('Please select a patient', 'warning');
        return;
    }

    if (!clinicId) {
        showAlert('Please select a clinic', 'warning');
        return;
    }

    if (!templateId) {
        showAlert('Please select a course package', 'warning');
        return;
    }

    const purchaseData = {
        template_id: parseInt(templateId),
        patient_id: parseInt(patientId),
        clinic_id: parseInt(clinicId),
        purchase_date: purchaseDate,
        notes: notes
    };

    // Add custom price if provided
    if (customPrice && parseFloat(customPrice) > 0) {
        purchaseData.course_price = parseFloat(customPrice);
    }

    try {
        const response = await fetch('/api/courses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(purchaseData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to purchase course');
        }

        const result = await response.json();

        showAlert(`Course purchased successfully! Code: ${result.course_code}`, 'success');

        // Reset form
        document.getElementById('purchaseCourseForm').reset();
        document.getElementById('selectedPatientId').value = '';
        document.getElementById('selectedPatientDisplay').style.display = 'none';
        document.getElementById('courseDetailsDisplay').style.display = 'none';
        selectedPatient = null;

        // Reset clinic if not locked
        if (window.userInfo && window.userInfo.clinic_id) {
            document.getElementById('courseClinic').value = window.userInfo.clinic_id;
        }

        // Set default date
        setDefaultDates();

        // Reload purchased courses list
        await loadPurchasedCourses();
    } catch (error) {
        console.error('Purchase course error:', error);
        showAlert(error.message, 'danger');
    }
}

// ============================================
// LOAD PURCHASED COURSES
// ============================================
async function loadPurchasedCourses() {
    try {
        const response = await fetch('/api/courses', {
            headers: {}
        });

        if (!response.ok) throw new Error('Failed to load purchased courses');

        const courses = await response.json();
        renderPurchasedCoursesTable(courses);
    } catch (error) {
        console.error('Load purchased courses error:', error);
        showAlert('Failed to load purchased courses', 'danger');
    }
}

function renderPurchasedCoursesTable(courses) {
    const tbody = document.getElementById('purchasedCoursesTableBody');
    if (!tbody) return;

    if (courses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No courses purchased yet</td></tr>';
        return;
    }

    tbody.innerHTML = courses.map(course => `
        <tr>
            <td><strong>${escapeHtml(course.course_code)}</strong></td>
            <td>${escapeHtml(course.patient_name)}</td>
            <td>${escapeHtml(course.course_name)}</td>
            <td>
                <span class="badge bg-info">${course.used_sessions}/${course.total_sessions}</span>
                <span class="badge bg-success">${course.remaining_sessions} left</span>
            </td>
            <td>฿${parseFloat(course.course_price).toFixed(2)}</td>
            <td>
                <span class="badge ${getStatusBadgeClass(course.status)}">
                    ${course.status}
                </span>
            </td>
            <td>${course.expiry_date ? formatDate(course.expiry_date) : 'No expiry'}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick='manageSharingModal(${JSON.stringify(course)})' title="Manage family sharing">
                    <i class="bi bi-people"></i> ${course.shared_count || 0}
                </button>
            </td>
        </tr>
    `).join('');
}

function getStatusBadgeClass(status) {
    const statusClasses = {
        'ACTIVE': 'bg-success',
        'COMPLETED': 'bg-primary',
        'EXPIRED': 'bg-danger',
        'CANCELLED': 'bg-secondary'
    };
    return statusClasses[status] || 'bg-secondary';
}

// ============================================
// FAMILY SHARING MANAGEMENT
// ============================================
let currentSharingCourse = null;
let selectedSharedPatient = null;

async function manageSharingModal(course) {
    currentSharingCourse = course;
    selectedSharedPatient = null;

    // Populate course info
    document.getElementById('sharingCourseId').value = course.id;
    document.getElementById('sharingCourseCode').textContent = course.course_code;
    document.getElementById('sharingCourseOwner').textContent = course.patient_name;
    document.getElementById('sharingCourseName').textContent = course.course_name;
    document.getElementById('sharingCourseSessions').textContent = `${course.used_sessions}/${course.total_sessions} (${course.remaining_sessions} remaining)`;

    // Clear search inputs
    document.getElementById('sharedPatientSearchInput').value = '';
    document.getElementById('sharedPatientSearchResults').style.display = 'none';
    document.getElementById('selectedSharedPatientDisplay').style.display = 'none';
    document.getElementById('sharingNotes').value = '';

    // Load shared users
    await loadSharedUsers(course.id);

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('sharingModal'));
    modal.show();
}

async function loadSharedUsers(courseId) {
    try {
        const response = await fetch(`/api/courses/${courseId}/shared-users`, {
            headers: {}
        });

        if (!response.ok) throw new Error('Failed to load shared users');

        const sharedUsers = await response.json();
        renderSharedUsersList(sharedUsers);
    } catch (error) {
        console.error('Load shared users error:', error);
        document.getElementById('sharedUsersListContainer').innerHTML =
            '<p class="text-danger">Failed to load shared users</p>';
    }
}

function renderSharedUsersList(sharedUsers) {
    const container = document.getElementById('sharedUsersListContainer');

    if (sharedUsers.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">No family members added yet</p>';
        return;
    }

    container.innerHTML = `
        <div class="table-responsive">
            <table class="table table-sm">
                <thead>
                    <tr>
                        <th>Patient Name</th>
                        <th>HN</th>
                        <th>Shared Date</th>
                        <th>Notes</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${sharedUsers.map(user => `
                        <tr>
                            <td>${escapeHtml(user.patient_name)}</td>
                            <td>${escapeHtml(user.hn)}</td>
                            <td>${formatDate(user.shared_date)}</td>
                            <td>${escapeHtml(user.notes || '-')}</td>
                            <td>
                                <span class="badge ${user.is_active ? 'bg-success' : 'bg-secondary'}">
                                    ${user.is_active ? 'Active' : 'Inactive'}
                                </span>
                            </td>
                            <td>
                                ${user.is_active ?
                                    `<button class="btn btn-sm btn-danger" onclick="removeSharedUser(${user.id})">
                                        <i class="bi bi-trash"></i>
                                    </button>` :
                                    `<button class="btn btn-sm btn-success" onclick="reactivateSharedUser(${user.id})">
                                        <i class="bi bi-arrow-clockwise"></i>
                                    </button>`
                                }
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function searchPatientsForSharing() {
    const searchInput = document.getElementById('sharedPatientSearchInput');
    const searchTerm = searchInput.value.trim();

    if (searchTerm.length < 2) {
        showAlert('Please enter at least 2 characters to search', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/patients/search?q=${encodeURIComponent(searchTerm)}`, {
            headers: {}
        });

        if (!response.ok) throw new Error('Failed to search patients');

        const patients = await response.json();

        // Filter out the course owner
        const filteredPatients = patients.filter(p => p.id !== currentSharingCourse.patient_id);

        renderSharedPatientSearchResults(filteredPatients);
    } catch (error) {
        console.error('Search patients error:', error);
        showAlert('Failed to search patients', 'danger');
    }
}

function renderSharedPatientSearchResults(patients) {
    const resultsDiv = document.getElementById('sharedPatientSearchResults');

    if (patients.length === 0) {
        resultsDiv.innerHTML = '<div class="text-muted p-2">No patients found</div>';
        resultsDiv.style.display = 'block';
        return;
    }

    resultsDiv.innerHTML = patients.map(patient => `
        <div class="border-bottom p-2 cursor-pointer" style="cursor: pointer;" onclick='selectSharedPatient(${JSON.stringify(patient)})'>
            <strong>${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}</strong><br>
            <small class="text-muted">HN: ${escapeHtml(patient.hn)} | PT: ${escapeHtml(patient.pt_number)}</small>
        </div>
    `).join('');

    resultsDiv.style.display = 'block';
}

function selectSharedPatient(patient) {
    selectedSharedPatient = patient;

    document.getElementById('selectedSharedPatientId').value = patient.id;
    document.getElementById('selectedSharedPatientName').textContent =
        `${patient.first_name} ${patient.last_name} (HN: ${patient.hn})`;
    document.getElementById('selectedSharedPatientDisplay').style.display = 'block';

    // Hide search results
    document.getElementById('sharedPatientSearchResults').style.display = 'none';
    document.getElementById('sharedPatientSearchInput').value = '';
}

async function addSharedUser() {
    const courseId = document.getElementById('sharingCourseId').value;
    const patientId = document.getElementById('selectedSharedPatientId').value;
    const notes = document.getElementById('sharingNotes').value.trim();

    if (!patientId) {
        showAlert('Please select a patient to share with', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/courses/${courseId}/shared-users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ patient_id: parseInt(patientId), notes })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to add shared user');
        }

        showAlert('Family member added successfully!', 'success');

        // Reset form
        document.getElementById('selectedSharedPatientDisplay').style.display = 'none';
        document.getElementById('sharingNotes').value = '';
        selectedSharedPatient = null;

        // Reload shared users list
        await loadSharedUsers(courseId);

        // Reload purchased courses to update count
        await loadPurchasedCourses();
    } catch (error) {
        console.error('Add shared user error:', error);
        showAlert(error.message, 'danger');
    }
}

async function removeSharedUser(sharedUserId) {
    if (!confirm('Remove this family member from the course?')) {
        return;
    }

    const courseId = document.getElementById('sharingCourseId').value;

    try {
        const response = await fetch(`/api/courses/shared-users/${sharedUserId}`, {
            method: 'DELETE',
            headers: {}
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to remove shared user');
        }

        showAlert('Family member removed successfully', 'success');

        // Reload shared users list
        await loadSharedUsers(courseId);

        // Reload purchased courses to update count
        await loadPurchasedCourses();
    } catch (error) {
        console.error('Remove shared user error:', error);
        showAlert(error.message, 'danger');
    }
}

async function reactivateSharedUser(sharedUserId) {
    const courseId = document.getElementById('sharingCourseId').value;

    try {
        const response = await fetch(`/api/courses/shared-users/${sharedUserId}/reactivate`, {
            method: 'PUT',
            headers: {}
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to reactivate shared user');
        }

        showAlert('Family member reactivated successfully', 'success');

        // Reload shared users list
        await loadSharedUsers(courseId);
    } catch (error) {
        console.error('Reactivate shared user error:', error);
        showAlert(error.message, 'danger');
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) {
        return '';
    }
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDate(dateString) {
    if (!dateString) return '-';

    const date = new Date(dateString);

    // Check if valid date
    if (isNaN(date.getTime())) return dateString;

    // Format as DD/MM/YYYY
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
}