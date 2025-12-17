/**
 * HN Creation & Validation - Client-Side JavaScript
 * Handles ID verification, PTHN preview, and form validation
 * LOGIC: Patient MUST provide at least Thai ID OR Passport (not both empty)
 */

// Global State
const HNValidationState = {
    pidValue: null,
    passportValue: null,
    isVerified: false,
    isDuplicate: false,
    previewPTHN: null,
    existingPatient: null
};

// DOM Elements
const elements = {
    pidInput: document.getElementById('pidInput'),
    passportInput: document.getElementById('passportInput'),
    pidErrorText: document.getElementById('pidErrorText'),
    passportErrorText: document.getElementById('passportErrorText'),
    btnCheckID: document.getElementById('btnCheckID'),
    hn: document.getElementById('hn'),
    pid: document.getElementById('pid'),
    passport: document.getElementById('passport'),
    verificationSection: document.getElementById('verificationSection'),
    verificationAlert: document.getElementById('verificationAlert'),
    templateIdAvailable: document.getElementById('templateIdAvailable'),
    templateIdExists: document.getElementById('templateIdExists'),
    templateVerificationError: document.getElementById('templateVerificationError'),
    patientForm: document.getElementById('patientForm')
};

// Validation Functions
function validateThaiNationalID(id) {
    if (!id) return false;
    id = id.replace(/[\s-]/g, '');
    if (!/^\d{13}$/.test(id)) return false;

    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(id[i]) * (13 - i);
    }
    const checksum = (11 - (sum % 11)) % 10;
    return checksum === parseInt(id[12]);
}

function validatePassportID(passport) {
    if (!passport) return false;
    passport = passport.replace(/\s/g, '');
    return /^[A-Z0-9]{6,20}$/i.test(passport);
}

// Event Handlers
elements.pidInput.addEventListener('input', function() {
    const value = this.value.trim();
    HNValidationState.pidValue = value;
    resetVerificationState();
});

elements.pidInput.addEventListener('blur', function() {
    const value = this.value.trim();

    if (!value) {
        elements.pidInput.classList.remove('is-invalid');
        elements.pidErrorText.textContent = '';
        return;
    }

    const isValid = validateThaiNationalID(value);

    if (!isValid) {
        elements.pidInput.classList.add('is-invalid');
        elements.pidErrorText.textContent = 'Invalid Thai National ID checksum.';
    } else {
        elements.pidInput.classList.remove('is-invalid');
        elements.pidErrorText.textContent = '';
        HNValidationState.pidValue = value;
    }
});

elements.passportInput.addEventListener('input', function() {
    const value = this.value.trim();
    HNValidationState.passportValue = value;
    resetVerificationState();
});

elements.passportInput.addEventListener('blur', function() {
    const value = this.value.trim();

    if (!value) {
        elements.passportInput.classList.remove('is-invalid');
        elements.passportErrorText.textContent = '';
        return;
    }

    const isValid = validatePassportID(value);

    if (!isValid) {
        elements.passportInput.classList.add('is-invalid');
        elements.passportErrorText.textContent = 'Invalid passport format. Use 6-20 alphanumeric characters.';
    } else {
        elements.passportInput.classList.remove('is-invalid');
        elements.passportErrorText.textContent = '';
        HNValidationState.passportValue = value.toUpperCase();
        elements.passportInput.value = value.toUpperCase();
    }
});

elements.btnCheckID.addEventListener('click', async function() {
    const pidValue = elements.pidInput.value.trim();
    const passportValue = elements.passportInput.value.trim();

    // Validate Thai ID if provided
    if (pidValue) {
        if (!validateThaiNationalID(pidValue)) {
            elements.pidInput.classList.add('is-invalid');
            elements.pidErrorText.textContent = 'Invalid Thai National ID checksum.';
            return;
        }
    }

    // Validate Passport if provided
    if (passportValue) {
        if (!validatePassportID(passportValue)) {
            elements.passportInput.classList.add('is-invalid');
            elements.passportErrorText.textContent = 'Invalid passport format.';
            return;
        }
    }

    const originalText = this.innerHTML;
    this.disabled = true;
    this.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Checking...';

    try {
        const result = await checkIDDuplication(pidValue, passportValue);

        if (result.isDuplicate) {
            showDuplicateAlert(result.patient);
        } else {
            showAvailableAlert(result.nextPTHN);
        }
    } catch (error) {
        console.error('ID verification error:', error);
        showErrorAlert(error.message || 'Unable to verify ID. Please try again.');
    } finally {
        this.disabled = false;
        this.innerHTML = originalText;
    }
});

// API Functions
async function checkIDDuplication(pidValue, passportValue) {
    // Get token from cookie (same as patient registration form)

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
        const response = await fetch('/api/patients/check-id', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pid: pidValue || null,
                passport: passportValue || null
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'API request failed');
        }

        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Request timeout. The database may not be set up correctly. Please check server logs.');
        }
        throw error;
    }
}

// Helper function to get cookie value

// UI Update Functions
function revealFormSections() {
    // Show all hidden form sections with smooth animation
    const sectionsToReveal = [
        'nameSection',
        'demographicsSection',
        'emergencyClinicalSection',
        'rehabSection',
        'submitButtons'
    ];

    sectionsToReveal.forEach(sectionId => {
        const section = document.getElementById(sectionId);
        if (section) {
            section.classList.remove('hidden-until-verified');
        }
    });
}

function showAvailableAlert(nextPTHN) {
    HNValidationState.isVerified = true;
    HNValidationState.isDuplicate = false;
    HNValidationState.previewPTHN = nextPTHN;

    const template = elements.templateIdAvailable;
    const content = template.content.cloneNode(true);
    content.getElementById('previewPTHN').textContent = nextPTHN;

    elements.verificationAlert.innerHTML = '';
    elements.verificationAlert.appendChild(content);
    elements.verificationSection.style.display = 'block';

    elements.hn.value = nextPTHN;

    // Set hidden fields
    elements.pid.value = HNValidationState.pidValue || '';
    elements.passport.value = HNValidationState.passportValue || '';

    // Reveal the rest of the form sections after successful verification
    revealFormSections();

    elements.verificationSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    updateWorkflowStep(2);
}

function showDuplicateAlert(patient) {
    HNValidationState.isVerified = false;
    HNValidationState.isDuplicate = true;
    HNValidationState.existingPatient = patient;

    const template = elements.templateIdExists;
    const content = template.content.cloneNode(true);

    content.getElementById('existingHN').textContent = patient.hn;
    content.getElementById('existingPT').textContent = patient.pt_number;
    content.getElementById('existingName').textContent = `${patient.title || ''} ${patient.first_name} ${patient.last_name}`.trim();
    content.getElementById('existingDOB').textContent = formatDate(patient.dob);
    content.getElementById('existingClinic').textContent = patient.clinic_name || 'N/A';
    content.getElementById('existingDate').textContent = formatDate(patient.created_at);

    const btnViewPatient = content.getElementById('btnViewPatient');
    const btnCreatePN = content.getElementById('btnCreatePN');

    btnViewPatient.addEventListener('click', () => handleViewPatient(patient.id));
    btnCreatePN.addEventListener('click', () => handleCreatePN(patient.id, patient.hn));

    elements.verificationAlert.innerHTML = '';
    elements.verificationAlert.appendChild(content);
    elements.verificationSection.style.display = 'block';

    elements.hn.value = '';
    elements.verificationSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showErrorAlert(errorMessage) {
    const template = elements.templateVerificationError;
    const content = template.content.cloneNode(true);
    content.getElementById('errorMessage').textContent = errorMessage;

    elements.verificationAlert.innerHTML = '';
    elements.verificationAlert.appendChild(content);
    elements.verificationSection.style.display = 'block';

    resetVerificationState();
}

function resetVerificationState() {
    HNValidationState.isVerified = false;
    HNValidationState.isDuplicate = false;
    HNValidationState.previewPTHN = null;
    HNValidationState.existingPatient = null;

    elements.verificationSection.style.display = 'none';
    elements.verificationAlert.innerHTML = '';
    elements.hn.value = '';

    // Hide form sections again when resetting
    hideFormSections();

    updateWorkflowStep(1);
}

function hideFormSections() {
    // Hide all form sections when verification is reset
    const sectionsToHide = [
        'nameSection',
        'demographicsSection',
        'emergencyClinicalSection',
        'rehabSection',
        'submitButtons'
    ];

    sectionsToHide.forEach(sectionId => {
        const section = document.getElementById(sectionId);
        if (section) {
            section.classList.add('hidden-until-verified');
        }
    });
}

function handleViewPatient(patientId) {
    window.open(`/patient/${patientId}`, '_blank');
}

function handleCreatePN(patientId, patientHN) {
    // Redirect to patient detail page where PN can be created
    if (confirm(`This will take you to patient ${patientHN}'s detail page where you can create a new PN (Patient Number) case.\n\nContinue?`)) {
        window.location.href = `/patient/${patientId}`;
    }
}

function updateWorkflowStep(step) {
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    const step3 = document.getElementById('step3');

    if (!step1 || !step2 || !step3) return;

    [step1, step2, step3].forEach(el => {
        el.querySelector('.badge').classList.remove('bg-primary');
        el.querySelector('.badge').classList.add('bg-secondary');
        el.querySelector('small').classList.add('text-muted');
    });

    const steps = [step1, step2, step3];
    for (let i = 0; i < step; i++) {
        steps[i].querySelector('.badge').classList.remove('bg-secondary');
        steps[i].querySelector('.badge').classList.add('bg-primary');
        steps[i].querySelector('small').classList.remove('text-muted');
    }
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// Form Submission Validation
elements.patientForm.addEventListener('submit', function(e) {
    if (!HNValidationState.isVerified) {
        e.preventDefault();
        alert('Please verify the patient ID first by clicking "Check ID & Generate HN" button.');
        elements.btnCheckID.focus();
        return false;
    }

    const hn = elements.hn.value;
    if (!hn || !hn.startsWith('PT')) {
        e.preventDefault();
        alert('Hospital Number (HN) is not generated. Please verify the ID first.');
        return false;
    }

    updateWorkflowStep(3);
});

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    console.log('HN Validation module initialized');
    resetVerificationState();
    updateWorkflowStep(1);
});