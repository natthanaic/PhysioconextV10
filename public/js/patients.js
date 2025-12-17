// Patients Page JavaScript
let currentPage = 1;

/**
 * Load clinics into dropdown
 */
async function loadClinics() {
    try {
        const response = await apiGet('/api/clinics');

        if (response) {
            const select = document.getElementById('filterClinic');

            response.forEach(clinic => {
                const option = document.createElement('option');
                option.value = clinic.id;
                option.textContent = escapeHtml(clinic.name);
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading clinics:', error);
    }
}

/**
 * Load patients with pagination and filters
 * @param {number} page - Page number
 */
async function loadPatients(page = 1) {
    try {
        currentPage = page;
        const params = new URLSearchParams({
            page: page,
            limit: 12
        });

        const searchHN = document.getElementById('searchHN').value;
        const searchName = document.getElementById('searchName').value;
        const clinicId = document.getElementById('filterClinic').value;

        if (searchHN || searchName) {
            params.append('search', searchHN || searchName);
        }
        if (clinicId) {
            params.append('clinic_id', clinicId);
        }

        const data = await apiGet(`/api/patients?${params}`);

        if (data) {
            displayPatients(data.patients);
            displayPagination(data.pagination);
        }
    } catch (error) {
        console.error('Error loading patients:', error);
        showAlert('Failed to load patients', 'danger');
    }
}

/**
 * Display patients in grid
 * @param {Array} patients - Array of patient objects
 */
function displayPatients(patients) {
    const grid = document.getElementById('patientsGrid');

    if (patients.length === 0) {
        grid.innerHTML = `
            <div class="col-12 text-center">
                <p class="text-muted">No patients found</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = patients.map(patient => `
        <div class="col-md-6 col-lg-4 mb-3">
            <div class="card patient-card h-100" onclick="viewPatient(${patient.id})">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h5 class="card-title mb-0">${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}</h5>
                        <span class="badge bg-primary">${escapeHtml(patient.hn)}</span>
                    </div>
                    <p class="card-text">
                        <small class="text-muted">
                            <i class="bi bi-card-text me-1"></i>PT: ${escapeHtml(patient.pt_number)}<br>
                            <i class="bi bi-calendar me-1"></i>DOB: ${formatDate(patient.dob)}<br>
                            <i class="bi bi-building me-1"></i>${escapeHtml(patient.clinic_name)}<br>
                            <i class="bi bi-file-medical me-1"></i>${truncateText(escapeHtml(patient.diagnosis), 50)}
                        </small>
                    </p>
                    <div class="d-flex justify-content-between">
                        <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); viewPatient(${patient.id})">
                            <i class="bi bi-eye"></i> View
                        </button>
                        <button class="btn btn-sm btn-outline-success" onclick="event.stopPropagation(); createPN(${patient.id})">
                            <i class="bi bi-plus-circle"></i> PN
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Display pagination controls
 * @param {Object} pagination - Pagination object with page and pages
 */
function displayPagination(pagination) {
    const paginationEl = document.getElementById('pagination');
    const { page, pages } = pagination;

    if (pages <= 1) {
        paginationEl.innerHTML = '';
        return;
    }

    let html = '';

    // Previous button
    html += `
        <li class="page-item ${page === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadPatients(${page - 1}); return false;" aria-label="Previous">
                Previous
            </a>
        </li>
    `;

    // Page numbers
    for (let i = 1; i <= Math.min(pages, 5); i++) {
        html += `
            <li class="page-item ${i === page ? 'active' : ''}">
                <a class="page-link" href="#" onclick="loadPatients(${i}); return false;">${i}</a>
            </li>
        `;
    }

    // Next button
    html += `
        <li class="page-item ${page === pages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadPatients(${page + 1}); return false;" aria-label="Next">
                Next
            </a>
        </li>
    `;

    paginationEl.innerHTML = html;
}

/**
 * Search patients
 */
function searchPatients() {
    loadPatients(1);
}

/**
 * View patient detail page
 * @param {number} id - Patient ID
 */
function viewPatient(id) {
    window.location.href = `/patient/${id}`;
}

/**
 * Create PN case for patient
 * @param {number} patientId - Patient ID
 */
function createPN(patientId) {
    window.location.href = `/patient/${patientId}#create-pn`;
}

/**
 * Download CSV template
 */
function downloadCSVTemplate() {
    window.location.href = `/api/patients/csv/template?token=${token}`;
}

/**
 * Show import modal
 */
function showImportModal() {
    const modal = new bootstrap.Modal(document.getElementById('importCSVModal'));
    // Reset form
    document.getElementById('csvFileInput').value = '';
    document.getElementById('import-results').innerHTML = '';
    document.getElementById('import-progress').classList.add('d-none');
    modal.show();
}

/**
 * Upload and import CSV file
 */
async function uploadCSV() {
    const fileInput = document.getElementById('csvFileInput');
    const file = fileInput.files[0];

    if (!file) {
        showAlert('Please select a CSV file to upload', 'warning');
        return;
    }

    if (!file.name.endsWith('.csv')) {
        showAlert('Please select a valid CSV file', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    const progressDiv = document.getElementById('import-progress');
    const resultsDiv = document.getElementById('import-results');
    const uploadBtn = document.getElementById('btn-upload');

    try {
        // Show progress
        progressDiv.classList.remove('d-none');
        uploadBtn.disabled = true;
        resultsDiv.innerHTML = '';
        const response = await fetch('/api/patients/csv/import', {
            method: 'POST',
            headers: {
            },
            body: formData
        });

        const result = await response.json();

        // Hide progress
        progressDiv.classList.add('d-none');
        uploadBtn.disabled = false;

        if (response.ok) {
            // Show success results
            resultsDiv.innerHTML = `
                <div class="alert alert-success">
                    <h6><i class="bi bi-check-circle me-2"></i>Import Successful!</h6>
                    <p class="mb-1"><strong>Total processed:</strong> ${result.total}</p>
                    <p class="mb-1"><strong>Successfully imported:</strong> ${result.success}</p>
                    ${result.failed > 0 ? `<p class="mb-0"><strong>Failed:</strong> ${result.failed}</p>` : ''}
                </div>
            `;

            if (result.errors && result.errors.length > 0) {
                resultsDiv.innerHTML += `
                    <div class="alert alert-warning">
                        <h6>Errors:</h6>
                        <ul class="mb-0">
                            ${result.errors.map(err => `<li>Row ${err.row}: ${escapeHtml(err.error)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // Reload patients list
            if (result.success > 0) {
                setTimeout(() => {
                    loadPatients();
                    bootstrap.Modal.getInstance(document.getElementById('importCSVModal')).hide();
                }, 2000);
            }
        } else {
            resultsDiv.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>${escapeHtml(result.error || 'Import failed')}
                </div>
            `;
        }
    } catch (error) {
        console.error('Upload error:', error);
        progressDiv.classList.add('d-none');
        uploadBtn.disabled = false;
        resultsDiv.innerHTML = `
            <div class="alert alert-danger">
                <i class="bi bi-exclamation-triangle me-2"></i>Network error. Please try again.
            </div>
        `;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    loadClinics();
    loadPatients();

    // Search on enter key
    document.getElementById('searchHN').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchPatients();
    });
    document.getElementById('searchName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchPatients();
    });
});