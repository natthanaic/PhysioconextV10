// Dashboard JavaScript - PN-App System

let currentPage = 1;
let currentFilters = {};

// Broadcast channel for instant cross-tab communication
let dashboardChannel = null;

// HTML escaping to prevent XSS attacks
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

// Ensure user data is loaded from server if missing in localStorage
async function ensureUserData() {
    let user = localStorage.getItem('user');

    if (!user || user === 'null' || user === 'undefined') {
        console.log('📥 User data missing in localStorage, fetching from server...');

        try {
            const response = await fetch('/api/auth/me');
            if (response.ok) {
                const userData = await response.json();
                localStorage.setItem('user', JSON.stringify(userData));
                console.log('✅ User data loaded and stored:', userData.email);
                return userData;
            } else {
                console.error('❌ Failed to fetch user data, redirecting to login...');
                window.location.href = '/login';
                return null;
            }
        } catch (error) {
            console.error('❌ Error fetching user data:', error);
            window.location.href = '/login';
            return null;
        }
    } else {
        return JSON.parse(user);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Ensure user data is available before loading dashboard
    await ensureUserData();

    initializeDatePickers();
    loadClinics();
    loadCases(); // Load cases without date filter (frontend filtering handles it)
    loadDashboardSummary();  // Load summary statistics
    loadWalkInAppointments(); // Load walk-in appointments table

    // Set up event listeners
    document.getElementById('filter-clinic').addEventListener('change', () => {
        loadCases();
        loadWalkInAppointments(); // Reload walk-in table with same filters
    });
    document.getElementById('filter-status').addEventListener('change', loadCases);
    document.getElementById('filter-from').addEventListener('change', () => {
        loadCases();
        loadWalkInAppointments(); // Reload walk-in table with same filters
    });
    document.getElementById('filter-to').addEventListener('change', () => {
        loadCases();
        loadWalkInAppointments(); // Reload walk-in table with same filters
    });
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadCases();
    });

    // Initialize BroadcastChannel for instant cross-tab sync
    if ('BroadcastChannel' in window) {
        dashboardChannel = new BroadcastChannel('pn-app-sync');
        dashboardChannel.onmessage = (event) => {
            console.log('Dashboard received sync message:', event.data);
            if (event.data.type === 'pn-status-changed' || event.data.type === 'appointment-updated') {
                // Instantly reload dashboard data
                loadCases();
                loadDashboardSummary();
                loadWalkInAppointments();
            }
        };
        console.log('Dashboard: BroadcastChannel initialized for instant sync');
    } else {
        // Fallback: Use localStorage for older browsers
        window.addEventListener('storage', (e) => {
            if (e.key === 'pn-sync-trigger') {
                console.log('Dashboard received localStorage sync trigger');
                loadCases();
                loadDashboardSummary();
                loadWalkInAppointments();
            }
        });
        console.log('Dashboard: localStorage fallback initialized for instant sync');
    }

    // Keep 10-second auto-refresh as backup (in case user doesn't have dashboard open when change happens)
    setInterval(() => {
        loadCases();
        loadDashboardSummary();
        loadWalkInAppointments();
    }, 10000); // 10 seconds
});

// Initialize date pickers
function initializeDatePickers() {
    const today = moment().format('YYYY-MM-DD');

    flatpickr('#filter-from', {
        dateFormat: 'Y-m-d',
        defaultDate: today,  // Set default to today
        onChange: () => loadCases()
    });

    flatpickr('#filter-to', {
        dateFormat: 'Y-m-d',
        defaultDate: today,  // Set default to today
        onChange: () => loadCases()
    });
}

// NEW: Load dashboard summary statistics
async function loadDashboardSummary() {
    try {
        const response = await fetch('/api/dashboard/summary', {
            headers: {
            }
        });

        if (response.ok) {
            const data = await response.json();

            // Validate response structure
            if (!data || typeof data !== 'object') {
                console.error('Invalid dashboard data structure:', data);
                return;
            }

            // Update Bills Paid card
            if (data.bills_paid) {
                const paidAmount = data.bills_paid.amount || 0;
                const paidCount = data.bills_paid.count || 0;
                const paidAmountEl = document.getElementById('stat-bills-paid-amount');
                const paidCountEl = document.getElementById('stat-bills-paid-count');
                if (paidAmountEl) paidAmountEl.textContent = `฿${paidAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                if (paidCountEl) paidCountEl.textContent = paidCount;
            }

            // Update Bills Today card
            if (data.bills_today) {
                const todayAmount = data.bills_today.amount || 0;
                const todayCount = data.bills_today.count || 0;
                const todayAmountEl = document.getElementById('stat-bills-today-amount');
                const todayCountEl = document.getElementById('stat-bills-today-count');
                if (todayAmountEl) todayAmountEl.textContent = `฿${todayAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                if (todayCountEl) todayCountEl.textContent = todayCount;
            }

            // Update New Patients This Month card (CL001)
            if (data.patients_this_month) {
                const patientsMonthCount = data.patients_this_month.count || 0;
                const change = data.patients_this_month.change || 0;
                const monthName = data.patients_this_month.month || '';
                const year = data.patients_this_month.year || '';

                const monthEl = document.getElementById('stat-patients-month');
                const monthLabelEl = document.getElementById('stat-patients-month-label');
                if (monthEl) monthEl.textContent = patientsMonthCount;
                if (monthLabelEl) monthLabelEl.textContent = `${monthName} ${year}`;

                // Display change indicator with color
                const changeEl = document.getElementById('stat-patients-change');
                if (changeEl) {
                    if (change !== 0) {
                        const changeText = change > 0 ? `+${change}` : change;
                        const changeColor = change > 0 ? 'text-success' : 'text-danger';
                        changeEl.innerHTML = `<span class="${changeColor}">(${changeText} from last month)</span>`;
                    } else {
                        changeEl.innerHTML = '<span class="text-muted">(no change)</span>';
                    }
                }
            }

            // Update Total Patients in Clinic card (CL001)
            if (data.total_patients) {
                const totalPatientsCount = data.total_patients.count || 0;
                const totalPatientsEl = document.getElementById('stat-total-patients');
                if (totalPatientsEl) totalPatientsEl.textContent = totalPatientsCount;
            }
        } else {
            console.error('Failed to load dashboard summary - HTTP', response.status);
        }
    } catch (error) {
        console.error('Error loading dashboard summary:', error);
    }
}

// Load clinics for filter
async function loadClinics() {
    try {
        const response = await fetch('/api/clinics', {
            headers: {
            }
        });
        
        if (response.ok) {
            const clinics = await response.json();
            const select = document.getElementById('filter-clinic');
            select.innerHTML = '<option value="">All Clinics</option>';
            
            clinics.forEach(clinic => {
                const option = document.createElement('option');
                option.value = clinic.id;
                option.textContent = clinic.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading clinics:', error);
    }
}

// Load PN cases
async function loadCases(page = 1) {
    try {
        currentPage = page;
        
        // Build query parameters
        const params = new URLSearchParams({
            page: page,
            limit: 20
        });
        
        // Add filters
        const clinicId = document.getElementById('filter-clinic').value;
        if (clinicId) params.append('clinic_id', clinicId);
        
        const status = document.getElementById('filter-status').value;
        if (status) params.append('status', status);
        
        const fromDate = document.getElementById('filter-from').value;
        if (fromDate) params.append('from_date', fromDate);
        
        const toDate = document.getElementById('filter-to').value;
        if (toDate) params.append('to_date', toDate);
        
        const search = document.getElementById('search-input').value;
        if (search) params.append('search', search);
        const response = await fetch(`/api/pn?${params}`, {
            headers: {
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            const displayedCount = displayCases(data.cases);
            displayPagination(data.pagination, displayedCount);
            updateStatistics(data.statistics);
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Error loading cases:', error);
        showAlert('Error loading cases', 'danger');
    }
}

function displayCases(cases) {
    const tbody = document.getElementById('cases-tbody');

    // Filter out walk-in appointments (they should be viewed in appointments page, not dashboard)
    let pnCases = cases.filter(pnCase => pnCase.record_type !== 'WALK_IN');

    // DEDUPLICATE by PN case ID to prevent showing same case multiple times
    // This handles cases where backend might return duplicates due to multiple appointments
    const seenIds = new Set();
    pnCases = pnCases.filter(pnCase => {
        if (pnCase.id && seenIds.has(pnCase.id)) {
            console.warn(`Duplicate PN case detected: ${pnCase.id} (${pnCase.pn_code})`);
            return false; // Skip duplicate
        }
        if (pnCase.id) seenIds.add(pnCase.id);
        return true;
    });

    // No frontend date filtering needed - backend handles it via from_date/to_date params
    // Default view automatically sets dates to today via flatpickr defaultDate

    // Sort by nearest time first (status-aware sorting)
    pnCases.sort((a, b) => {
        let timeA, timeB;

        // Get time for case A (status-aware)
        if (a.status === 'COMPLETED') {
            // For COMPLETED: use completion date
            timeA = moment(a.completed_at || a.updated_at);
        } else if (a.appointment_date && a.appointment_start_time) {
            // For PENDING/ACCEPTED with appointment: use appointment date/time
            timeA = moment(`${a.appointment_date} ${a.appointment_start_time}`, 'YYYY-MM-DD HH:mm:ss');
        } else {
            // For cases without appointment: use creation time
            timeA = moment(a.created_at);
        }

        // Get time for case B (status-aware)
        if (b.status === 'COMPLETED') {
            // For COMPLETED: use completion date
            timeB = moment(b.completed_at || b.updated_at);
        } else if (b.appointment_date && b.appointment_start_time) {
            // For PENDING/ACCEPTED with appointment: use appointment date/time
            timeB = moment(`${b.appointment_date} ${b.appointment_start_time}`, 'YYYY-MM-DD HH:mm:ss');
        } else {
            // For cases without appointment: use creation time
            timeB = moment(b.created_at);
        }

        // Sort ascending (nearest first)
        return timeA.valueOf() - timeB.valueOf();
    });

    if (pnCases.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No cases found</td></tr>';
        return 0;
    }

    // Log sample case data for debugging
    if (pnCases.length > 0) {
        console.log('📊 Sample PN case data (first case):', {
            id: pnCases[0].id,
            status: pnCases[0].status,
            recheck_body_part: pnCases[0].recheck_body_part,
            body_annotation_id: pnCases[0].body_annotation_id,
            source_clinic_code: pnCases[0].source_clinic_code,
            target_clinic_code: pnCases[0].target_clinic_code
        });
    }

    // Group cases by PTHN (HN)
    const groupedByHN = {};
    pnCases.forEach(pnCase => {
        const hn = pnCase.hn || 'NO_HN';
        if (!groupedByHN[hn]) {
            groupedByHN[hn] = [];
        }
        groupedByHN[hn].push(pnCase);
    });

    // Build HTML with collapsible groups
    let htmlRows = [];
    Object.keys(groupedByHN).forEach(hn => {
        const cases = groupedByHN[hn];
        const firstCase = cases[0];
        const caseCount = cases.length;
        const isWalkIn = firstCase.record_type === 'WALK_IN';

        // Format appointment date/time for parent row
        let appointmentInfo = '<span class="text-muted">-</span>';
        if (firstCase.appointment_date) {
            const aptDate = moment(firstCase.appointment_date).format('DD/MM/YYYY');
            const aptTime = firstCase.appointment_start_time && firstCase.appointment_end_time
                ? `${firstCase.appointment_start_time}-${firstCase.appointment_end_time}`
                : '';

            const walkInLabel = firstCase.booking_type === 'WALK_IN' ? '<span class="badge bg-info ms-1">Walk-in</span>' : '';

            appointmentInfo = `
                <div class="small">
                    <i class="bi bi-calendar-event text-primary"></i> ${escapeHtml(aptDate)}${walkInLabel}<br>
                    ${aptTime ? `<i class="bi bi-clock text-primary"></i> ${escapeHtml(aptTime)}` : ''}
                </div>
            `;
        }

        // If only one case, render as a regular row without expand functionality
        if (caseCount === 1) {
            const regularRow = `
                <tr>
                    <td class="ps-4">
                        ${hn !== 'NO_HN' ? escapeHtml(hn) : '<span class="text-muted">No HN</span>'}
                    </td>
                    <td>
                        <div>${escapeHtml(firstCase.first_name)} ${escapeHtml(firstCase.last_name)}</div>
                    </td>
                    <td>${firstCase.pn_code ? `<span class="badge bg-secondary">${escapeHtml(firstCase.pn_code)}</span>` : '<span class="text-muted">-</span>'}</td>
                    <td>${firstCase.diagnosis ? escapeHtml(truncateText(firstCase.diagnosis, 50)) : '<span class="text-muted">-</span>'}</td>
                    <td>${firstCase.purpose ? escapeHtml(truncateText(firstCase.purpose, 50)) : '<span class="text-muted">-</span>'}</td>
                    <td>${isWalkIn ? '<span class="badge bg-info">Walk-in Appointment</span>' : renderStatus(firstCase)}</td>
                    <td class="small">${escapeHtml(moment(firstCase.created_at).format('DD/MM/YYYY HH:mm'))}</td>
                    <td>${appointmentInfo}</td>
                    <td class="text-center pe-4">
                        ${firstCase.patient_id && !isWalkIn ?
                            `<button class="btn btn-sm btn-info" onclick="openPatientDetail(${parseInt(firstCase.patient_id)})" title="View Patient">
                                <i class="bi bi-eye-fill"></i>
                            </button>` : ''}
                        ${firstCase.id && !isWalkIn ?
                            `<button class="btn btn-sm btn-primary" onclick="viewCase(${parseInt(firstCase.id)})" title="View Case">
                                <i class="bi bi-clipboard-pulse"></i>
                            </button>` : ''}
                        ${firstCase.bill_id && !isWalkIn ?
                            `<button class="btn btn-sm btn-warning" onclick="viewBillDetails(${parseInt(firstCase.bill_id)})" title="View Bill">
                                <i class="bi bi-receipt-cutoff"></i>
                            </button>` :
                            (firstCase.status === 'ACCEPTED' && !isWalkIn && !(firstCase.course_id > 0) && !(firstCase.apt_course_id > 0) ?
                            `<button class="btn btn-sm btn-success" onclick="createBillForPN(${parseInt(firstCase.id)}, ${parseInt(firstCase.patient_id)})" title="Create Bill">
                                <i class="bi bi-plus-circle-fill"></i>
                            </button>` : '')}
                        ${firstCase.last_report_at && !isWalkIn ?
                            `<button class="btn btn-sm btn-danger" onclick="downloadLastReport(${parseInt(firstCase.id)})" title="Download Report">
                                <i class="bi bi-file-pdf-fill"></i>
                            </button>` : ''}
                        ${firstCase.status === 'COMPLETED' && !isWalkIn ?
                            `<button class="btn btn-sm btn-info" onclick="openCertificateModal(${parseInt(firstCase.id)})" title="Create/View PT Certificate">
                                <i class="bi bi-file-medical-fill"></i>
                            </button>` : ''}
                        ${isWalkIn ?
                            `<a href="/appointments" class="btn btn-sm btn-info" title="View in Appointments">
                                <i class="bi bi-calendar-check-fill"></i>
                            </a>` : ''}
                    </td>
                </tr>
            `;
            htmlRows.push(regularRow);
            return; // Skip child row creation for single cases
        }

        // For multiple cases, create parent row with expand icon (collapsible header)
        const parentRow = `
            <tr class="pthn-group-header" style="background-color: #f8f9fa; cursor: pointer; font-weight: 600;" onclick="togglePTHNGroup('${hn}')">
                <td class="ps-4">
                    <div class="d-flex align-items-center gap-2">
                        <i class="bi bi-plus-circle-fill pthn-toggle-icon" id="icon-${hn}" style="color: #6366f1; font-size: 1.2rem;"></i>
                        <span>${hn !== 'NO_HN' ? escapeHtml(hn) : '<span class="text-muted">No HN</span>'}</span>
                    </div>
                </td>
                <td>
                    <div>${escapeHtml(firstCase.first_name)} ${escapeHtml(firstCase.last_name)}</div>
                    ${caseCount > 1 ? `<span class="badge bg-primary">${caseCount} cases</span>` : ''}
                </td>
                <td>${firstCase.pn_code ? `<span class="badge bg-secondary">${escapeHtml(firstCase.pn_code)}</span>` : '<span class="text-muted">-</span>'}</td>
                <td>${firstCase.diagnosis ? escapeHtml(truncateText(firstCase.diagnosis, 50)) : '<span class="text-muted">-</span>'}</td>
                <td>${firstCase.purpose ? escapeHtml(truncateText(firstCase.purpose, 50)) : '<span class="text-muted">-</span>'}</td>
                <td>${isWalkIn ? '<span class="badge bg-info">Walk-in Appointment</span>' : renderStatus(firstCase)}</td>
                <td class="small">${escapeHtml(moment(firstCase.created_at).format('DD/MM/YYYY HH:mm'))}</td>
                <td>${appointmentInfo}</td>
                <td class="text-center pe-4">
                    ${firstCase.patient_id && !isWalkIn ?
                        `<button class="btn btn-sm btn-info" onclick="event.stopPropagation(); openPatientDetail(${parseInt(firstCase.patient_id)})" title="View Patient">
                            <i class="bi bi-eye-fill"></i>
                        </button>` : ''}
                    ${firstCase.id && !isWalkIn ?
                        `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); viewCase(${parseInt(firstCase.id)})" title="View Case">
                            <i class="bi bi-clipboard-pulse"></i>
                        </button>` : ''}
                    ${firstCase.bill_id && !isWalkIn ?
                        `<button class="btn btn-sm btn-warning" onclick="event.stopPropagation(); viewBillDetails(${parseInt(firstCase.bill_id)})" title="View Bill">
                            <i class="bi bi-receipt-cutoff"></i>
                        </button>` :
                        (firstCase.status === 'ACCEPTED' && !isWalkIn && !(firstCase.course_id > 0) && !(firstCase.apt_course_id > 0) ?
                        `<button class="btn btn-sm btn-success" onclick="event.stopPropagation(); createBillForPN(${parseInt(firstCase.id)}, ${parseInt(firstCase.patient_id)})" title="Create Bill">
                            <i class="bi bi-plus-circle-fill"></i>
                        </button>` : '')}
                    ${firstCase.last_report_at && !isWalkIn ?
                        `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); downloadLastReport(${parseInt(firstCase.id)})" title="Download Report">
                            <i class="bi bi-file-pdf-fill"></i>
                        </button>` : ''}
                    ${firstCase.status === 'COMPLETED' && !isWalkIn ?
                        `<button class="btn btn-sm btn-info" onclick="event.stopPropagation(); openCertificateModal(${parseInt(firstCase.id)})" title="Create/View PT Certificate">
                            <i class="bi bi-file-medical-fill"></i>
                        </button>` : ''}
                    ${isWalkIn ?
                        `<a href="/appointments" class="btn btn-sm btn-info" onclick="event.stopPropagation();" title="View in Appointments">
                            <i class="bi bi-calendar-check-fill"></i>
                        </a>` : ''}
                </td>
            </tr>
        `;
        htmlRows.push(parentRow);

        // Create child rows (initially hidden) - skip first case as it's shown in parent row
        cases.forEach((pnCase, index) => {
            // Skip the first case (index 0) as it's already displayed in the parent row
            if (index === 0) return;

            const isWalkIn = pnCase.record_type === 'WALK_IN';

            // Format appointment date/time if available
            let appointmentInfo = '<span class="text-muted">-</span>';
            if (pnCase.appointment_date) {
                const aptDate = moment(pnCase.appointment_date).format('DD/MM/YYYY');
                const aptTime = pnCase.appointment_start_time && pnCase.appointment_end_time
                    ? `${pnCase.appointment_start_time}-${pnCase.appointment_end_time}`
                    : '';

                const walkInLabel = pnCase.booking_type === 'WALK_IN' ? '<span class="badge bg-info ms-1">Walk-in</span>' : '';

                appointmentInfo = `
                    <div class="small">
                        <i class="bi bi-calendar-event text-primary"></i> ${escapeHtml(aptDate)}${walkInLabel}<br>
                        ${aptTime ? `<i class="bi bi-clock text-primary"></i> ${escapeHtml(aptTime)}` : ''}
                    </div>
                `;
            }

            // Render child row in normal table columns (not compact)
            const childRow = `
                <tr class="pthn-child-row pthn-child-${hn}" style="display: none; background-color: #f8f9fa;" data-parent-hn="${hn}">
                    <td class="ps-4" style="border-left: 4px solid #6366f1;">
                        ${pnCase.hn ? escapeHtml(pnCase.hn) : '<span class="text-muted">-</span>'}
                    </td>
                    <td>
                        <div>${escapeHtml(pnCase.first_name)} ${escapeHtml(pnCase.last_name)}</div>
                    </td>
                    <td>${pnCase.pn_code ? `<span class="badge bg-secondary">${escapeHtml(pnCase.pn_code)}</span>` : '<span class="text-muted">-</span>'}</td>
                    <td>${pnCase.diagnosis ? escapeHtml(truncateText(pnCase.diagnosis, 50)) : '<span class="text-muted">-</span>'}</td>
                    <td>${pnCase.purpose ? escapeHtml(truncateText(pnCase.purpose, 50)) : '<span class="text-muted">-</span>'}</td>
                    <td>${isWalkIn ? '<span class="badge bg-info">Walk-in Appointment</span>' : renderStatus(pnCase)}</td>
                    <td class="small">${escapeHtml(moment(pnCase.created_at).format('DD/MM/YYYY HH:mm'))}</td>
                    <td>${appointmentInfo}</td>
                    <td class="text-center pe-4">
                        ${pnCase.patient_id && !isWalkIn ?
                            `<button class="btn btn-sm btn-info" onclick="openPatientDetail(${parseInt(pnCase.patient_id)})" title="View Patient">
                                <i class="bi bi-eye-fill"></i>
                            </button>` : ''}
                        ${pnCase.id && !isWalkIn ?
                            `<button class="btn btn-sm btn-primary" onclick="viewCase(${parseInt(pnCase.id)})" title="View Case">
                                <i class="bi bi-clipboard-pulse"></i>
                            </button>` : ''}
                        ${pnCase.bill_id && !isWalkIn ?
                            `<button class="btn btn-sm btn-warning" onclick="viewBillDetails(${parseInt(pnCase.bill_id)})" title="View Bill">
                                <i class="bi bi-receipt-cutoff"></i>
                            </button>` :
                            (pnCase.status === 'ACCEPTED' && !isWalkIn && !(pnCase.course_id > 0) && !(pnCase.apt_course_id > 0) ?
                            `<button class="btn btn-sm btn-success" onclick="createBillForPN(${parseInt(pnCase.id)}, ${parseInt(pnCase.patient_id)})" title="Create Bill">
                                <i class="bi bi-plus-circle-fill"></i>
                            </button>` : '')}
                        ${pnCase.last_report_at && !isWalkIn ?
                            `<button class="btn btn-sm btn-danger" onclick="downloadLastReport(${parseInt(pnCase.id)})" title="Download Report">
                                <i class="bi bi-file-pdf-fill"></i>
                            </button>` : ''}
                        ${pnCase.status === 'COMPLETED' && !isWalkIn ?
                            `<button class="btn btn-sm btn-info" onclick="openCertificateModal(${parseInt(pnCase.id)})" title="Create/View PT Certificate">
                                <i class="bi bi-file-medical-fill"></i>
                            </button>` : ''}
                        ${isWalkIn ?
                            `<a href="/appointments" class="btn btn-sm btn-info" title="View in Appointments">
                                <i class="bi bi-calendar-check-fill"></i>
                            </a>` : ''}
                    </td>
                </tr>
            `;
            htmlRows.push(childRow);
        });
    });

    tbody.innerHTML = htmlRows.join('');

    // Return the actual number of cases displayed (after filtering)
    return pnCases.length;
}

// Load walk-in appointments (uses same filters as dashboard table)
async function loadWalkInAppointments() {
    try {

        // Build query parameters using the same filters as dashboard table
        const params = new URLSearchParams({
            booking_type: 'WALK_IN',
            status: 'SCHEDULED' // Only show scheduled appointments
        });

        // Apply same filters from dashboard
        const clinicId = document.getElementById('filter-clinic').value;
        if (clinicId) params.append('clinic_id', clinicId);

        const fromDate = document.getElementById('filter-from').value;
        if (fromDate) {
            params.append('start_date', fromDate);
        } else {
            // Default: show from today onwards if no filter set
            params.append('start_date', moment().format('YYYY-MM-DD'));
        }

        const toDate = document.getElementById('filter-to').value;
        if (toDate) {
            params.append('end_date', toDate);
        } else {
            // Default: show next 30 days if no filter set
            params.append('end_date', moment().add(30, 'days').format('YYYY-MM-DD'));
        }

        const response = await fetch(`/api/appointments?${params}`, {
            headers: {
            }
        });

        if (response.ok) {
            const appointments = await response.json();

            // Filter: Only show true walk-in visitors (no patient_id)
            // Exclude existing patients who booked as walk-in
            const trueWalkIns = appointments.filter(apt => !apt.patient_id);

            // Sort by appointment date/time - nearest first
            trueWalkIns.sort((a, b) => {
                const dateTimeA = moment(`${a.appointment_date} ${a.start_time}`, 'YYYY-MM-DD HH:mm:ss');
                const dateTimeB = moment(`${b.appointment_date} ${b.start_time}`, 'YYYY-MM-DD HH:mm:ss');
                return dateTimeA.valueOf() - dateTimeB.valueOf();
            });
            displayWalkInAppointments(trueWalkIns);
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Error loading walk-in appointments:', error);
        const tbody = document.getElementById('walkin-tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error loading walk-in visitors</td></tr>';
        }
    }
}

// Display walk-in appointments in table
function displayWalkInAppointments(appointments) {
    const tbody = document.getElementById('walkin-tbody');

    if (!tbody) return;

    if (appointments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No walk-in visitors found (showing only new visitors, not existing patients)</td></tr>';
        return;
    }

    tbody.innerHTML = appointments.map(apt => {
        const appointmentDate = moment(apt.appointment_date).format('DD/MM/YYYY');
        const dayOfWeek = moment(apt.appointment_date).format('ddd');
        const startTime = apt.start_time ? moment(apt.start_time, 'HH:mm:ss').format('HH:mm') : '-';
        const endTime = apt.end_time ? moment(apt.end_time, 'HH:mm:ss').format('HH:mm') : '-';
        const timeRange = `${startTime} - ${endTime}`;

        const walkInName = escapeHtml(apt.walk_in_name || 'Walk-in visitor');
        const walkInPhone = escapeHtml(apt.walk_in_phone || '-');
        const ptName = escapeHtml(apt.pt_name || 'Unassigned');
        const clinicName = escapeHtml(apt.clinic_name || '-');

        return `
            <tr>
                <td>
                    <div>${appointmentDate}</div>
                    <small class="text-muted">${dayOfWeek}</small>
                </td>
                <td>${timeRange}</td>
                <td>${walkInName}</td>
                <td>${walkInPhone}</td>
                <td>${ptName}</td>
                <td>${clinicName}</td>
                <td>
                    <a href="/appointments" class="btn btn-sm btn-primary" title="View in Appointments">
                        <i class="bi bi-calendar-check-fill"></i>
                    </a>
                </td>
            </tr>
        `;
    }).join('');
}

// Render status with appropriate badge and dropdown for status changes
function renderStatus(pnCase) {
    const userStr = localStorage.getItem('user');
    if (!userStr || userStr === 'null' || userStr === 'undefined') {
        // User data not loaded yet - show static status badge
        return `<span class="badge bg-secondary">${pnCase.status}</span>`;
    }

    const user = JSON.parse(userStr);
    const canChangeStatus = user.role === 'ADMIN' || user.role === 'PT'; // ADMIN and PT can change status

    // Show dropdown for PENDING cases (to ACCEPTED, CANCELLED)
    if (pnCase.status === 'PENDING' && canChangeStatus) {
        // Convert recheck_body_part to explicit boolean string for data attribute
        const recheckBodyPartValue = (pnCase.recheck_body_part === true || pnCase.recheck_body_part === 1 || pnCase.recheck_body_part === '1') ? 'true' : 'false';

        return `
            <div class="d-flex align-items-center">
                <select class="form-select form-select-sm status-dropdown"
                    data-pn-id="${pnCase.id}"
                    data-source-clinic="${pnCase.source_clinic_code || ''}"
                    data-target-clinic="${pnCase.target_clinic_code || ''}"
                    data-recheck-body-part="${recheckBodyPartValue}"
                    data-body-annotation-id="${pnCase.body_annotation_id || ''}"
                    style="width: auto;">
                    <option value="PENDING" selected>Pending</option>
                    <option value="ACCEPTED">Accept</option>
                    <option value="CANCELLED">Cancel</option>
                </select>
                <button class="btn btn-sm btn-success ms-1" onclick="saveStatus(${pnCase.id}, 'PENDING')">
                    <i class="bi bi-check-circle-fill"></i>
                </button>
            </div>
        `;
    }

    // Show dropdown for ACCEPTED cases (to COMPLETED, CANCELLED, or reverse to PENDING if ADMIN)
    if (pnCase.status === 'ACCEPTED' && canChangeStatus) {
        // ADMIN can reverse to PENDING, PT can only move forward to COMPLETED or CANCELLED
        const options = user.role === 'ADMIN'
            ? `
                <option value="PENDING">Pending</option>
                <option value="ACCEPTED" selected>Accepted</option>
                <option value="COMPLETED">Complete</option>
                <option value="CANCELLED">Cancel</option>
            `
            : `
                <option value="ACCEPTED" selected>Accepted</option>
                <option value="COMPLETED">Complete</option>
                <option value="CANCELLED">Cancel</option>
            `;

        return `
            <div class="d-flex align-items-center">
                <select class="form-select form-select-sm status-dropdown" data-pn-id="${pnCase.id}" data-source-clinic="${pnCase.source_clinic_code || ''}" data-target-clinic="${pnCase.target_clinic_code || ''}" style="width: auto;">
                    ${options}
                </select>
                <button class="btn btn-sm btn-success ms-1" onclick="saveStatus(${pnCase.id}, 'ACCEPTED')">
                    <i class="bi bi-check-circle-fill"></i>
                </button>
            </div>
        `;
    }

    // Show COMPLETED status with reverse button for ADMIN
    if (pnCase.status === 'COMPLETED' && user.role === 'ADMIN') {
        return `
            <div class="d-flex align-items-center">
                <span class="badge badge-status bg-success">COMPLETED</span>
                <button class="btn btn-sm btn-warning ms-1" onclick="reverseStatus(${pnCase.id})" title="Reverse to ACCEPTED">
                    <i class="bi bi-arrow-counterclockwise"></i>
                </button>
            </div>
        `;
    }

    const statusColors = {
        'PENDING': 'warning',
        'ACCEPTED': 'info',
        'IN_PROGRESS': 'primary',
        'COMPLETED': 'success',
        'CANCELLED': 'danger'
    };

    return `<span class="badge badge-status bg-${statusColors[pnCase.status] || 'secondary'}">${pnCase.status}</span>`;
}

// Save status change
async function saveStatus(caseId, currentStatus) {
    try {
        const selectEl = document.querySelector(`.status-dropdown[data-pn-id="${caseId}"]`);
        const newStatus = selectEl.value;

        console.log('=== SAVE STATUS DEBUG ===');
        console.log('Case ID:', caseId);
        console.log('Current Status:', currentStatus);
        console.log('New Status:', newStatus);

        // PENDING → ACCEPTED: Check if body annotation or PT assessment needed
        if (currentStatus === 'PENDING' && newStatus === 'ACCEPTED') {
            const recheckBodyPart = selectEl.dataset.recheckBodyPart === 'true';
            const hasBodyAnnotation = selectEl.dataset.bodyAnnotationId;
            const sourceClinic = selectEl.dataset.sourceClinic;
            const targetClinic = selectEl.dataset.targetClinic;

            console.log('Recheck Body Part:', recheckBodyPart, '(raw:', selectEl.dataset.recheckBodyPart, ')');
            console.log('Has Body Annotation:', hasBodyAnnotation);
            console.log('Source Clinic:', sourceClinic);
            console.log('Target Clinic:', targetClinic);

            const isCL001 = sourceClinic === 'CL001' || targetClinic === 'CL001';
            const isExistingPatient = !sourceClinic && !targetClinic;
            const needsPTAssessment = !isCL001 && !isExistingPatient;

            console.log('Is CL001:', isCL001);
            console.log('Is Existing Patient:', isExistingPatient);
            console.log('Needs PT Assessment:', needsPTAssessment);

            // If recheck body part is true and no annotation exists yet
            if (recheckBodyPart && !hasBodyAnnotation) {
                console.log('✅ SHOWING BODY ANNOTATION MODAL');
                window.currentAcceptingCaseId = caseId;
                window.currentAcceptingCaseData = {
                    sourceClinic: sourceClinic,
                    targetClinic: targetClinic,
                    needsPTAssessment: needsPTAssessment
                };

                if (needsPTAssessment) {
                    // Non-CL001: Show combined PT assessment + body annotation modal
                    console.log('→ Calling showPTAssessmentWithBodyAnnotationModal');
                    showPTAssessmentWithBodyAnnotationModal(caseId);
                } else {
                    // CL001: Show body annotation modal only
                    console.log('→ Calling showBodyAnnotationModalForAccept');
                    showBodyAnnotationModalForAccept(caseId);
                }
                return;
            } else {
                console.log('❌ NOT showing body annotation modal');
                console.log('   recheckBodyPart:', recheckBodyPart, 'hasBodyAnnotation:', hasBodyAnnotation);
            }

            // No body annotation needed, check if PT assessment needed
            if (needsPTAssessment) {
                console.log('→ Showing PT Assessment Modal (no body annotation)');
                // Only show PT assessment for non-CL001 referral cases
                showPTAssessmentModal(caseId);
                return;
            }
        }

        // ACCEPTED → COMPLETED: Always show SOAP modal
        if (currentStatus === 'ACCEPTED' && newStatus === 'COMPLETED') {
            showSOAPModal(caseId);
            return;
        }

        // ACCEPTED → PENDING: Confirm reversal (ADMIN only)
        if (currentStatus === 'ACCEPTED' && newStatus === 'PENDING') {
            const confirmReverse = confirm(
                'คุณต้องการย้อนสถานะจาก ACCEPTED กลับไปเป็น PENDING หรือไม่?\n\n' +
                'การดำเนินการนี้จะ:\n' +
                '- คืน course session กลับไป (ถ้ามี)\n' +
                '- ลบข้อมูล PT Assessment ที่บันทึกไว้\n\n' +
                'Are you sure you want to reverse status from ACCEPTED to PENDING?\n\n' +
                'This will:\n' +
                '- Return course session (if any)\n' +
                '- Clear PT Assessment data'
            );
            if (!confirmReverse) return;
        }

        // ACCEPTED → CANCELLED: Confirm cancellation and course return
        if (currentStatus === 'ACCEPTED' && newStatus === 'CANCELLED') {
            const confirmCancel = confirm(
                'คุณต้องการยกเลิกเคสนี้หรือไม่?\n\n' +
                'การดำเนินการนี้จะ:\n' +
                '- คืน course session กลับไป (ถ้ามี)\n' +
                '- ยกเลิก appointment ที่เชื่อมโยง (ถ้ามี)\n\n' +
                'Are you sure you want to CANCEL this case?\n\n' +
                'This will:\n' +
                '- Return course session (if any)\n' +
                '- Cancel linked appointment (if any)'
            );
            if (!confirmCancel) return;
        }

        // CANCELLED: Ask for reason
        let body = { status: newStatus };
        if (newStatus === 'CANCELLED') {
            const reason = prompt('Please provide cancellation reason:');
            if (!reason) return;
            body.cancellation_reason = reason;
        }

        // For simple status changes (e.g., CL001 PENDING to ACCEPTED)
        const response = await fetch(`/api/pn/${caseId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (response.ok) {
            showAlert('Status updated successfully', 'success');
            loadCases(currentPage);
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to update status', 'danger');
        }
    } catch (error) {
        console.error('Error updating status:', error);
        showAlert('Error updating status', 'danger');
    }
}

// Show PT Assessment Modal for non-CL001 clinics
function showPTAssessmentModal(caseId) {
    const modalHtml = `
        <div class="modal fade" id="ptAssessmentModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">PT Assessment Information</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form id="ptAssessmentForm">
                            <div class="mb-3">
                                <label class="form-label">Physiotherapy Diagnosis <span class="text-danger">*</span></label>
                                <textarea class="form-control" id="pt_diagnosis" rows="3" required></textarea>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Chief Complaint <span class="text-danger">*</span></label>
                                <textarea class="form-control" id="pt_chief_complaint" rows="3" required></textarea>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Present History <span class="text-danger">*</span></label>
                                <textarea class="form-control" id="pt_present_history" rows="3" required></textarea>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Pain Score (0-10) <span class="text-danger">*</span></label>
                                <input type="range" class="form-range" id="pt_pain_score" min="0" max="10" value="5">
                                <div class="text-center"><span id="pain_score_value">5</span>/10</div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="submitPTAssessment(${caseId})">Accept Case</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existing = document.getElementById('ptAssessmentModal');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Add event listener for pain score slider
    document.getElementById('pt_pain_score').addEventListener('input', (e) => {
        document.getElementById('pain_score_value').textContent = e.target.value;
    });

    const modal = new bootstrap.Modal(document.getElementById('ptAssessmentModal'));
    modal.show();
}

// Submit PT Assessment
async function submitPTAssessment(caseId) {
    try {

        const body = {
            status: 'ACCEPTED',
            pt_diagnosis: document.getElementById('pt_diagnosis').value,
            pt_chief_complaint: document.getElementById('pt_chief_complaint').value,
            pt_present_history: document.getElementById('pt_present_history').value,
            pt_pain_score: parseInt(document.getElementById('pt_pain_score').value)
        };

        if (!body.pt_diagnosis || !body.pt_chief_complaint || !body.pt_present_history) {
            showAlert('Please fill in all required fields', 'warning');
            return;
        }

        const response = await fetch(`/api/pn/${caseId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('ptAssessmentModal')).hide();
            showAlert('Case accepted with PT assessment', 'success');
            loadCases(currentPage);
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to accept case', 'danger');
        }
    } catch (error) {
        console.error('Error submitting PT assessment:', error);
        showAlert('Error submitting PT assessment', 'danger');
    }
}

// Show SOAP Modal for completing cases
async function showSOAPModal(caseId) {
    try {

        // Fetch case details with patient information
        const response = await fetch(`/api/pn/${caseId}`, {
            headers: {
            }
        });

        if (!response.ok) {
            showAlert('Failed to load case details', 'danger');
            return;
        }

        const caseData = await response.json();

        // Debug: Log the data received from API
        console.log('🔍 SOAP Modal - Case Data:', caseData);
        console.log('📋 HN:', caseData.hn);
        console.log('👤 Name:', caseData.first_name, caseData.last_name);
        console.log('🏥 Diagnosis:', caseData.diagnosis);
        console.log('💊 PT Assessment:', {
            pt_diagnosis: caseData.pt_diagnosis,
            pt_chief_complaint: caseData.pt_chief_complaint,
            pt_present_history: caseData.pt_present_history,
            pt_pain_score: caseData.pt_pain_score
        });

        const modalHtml = `
            <div class="modal fade" id="soapModal" tabindex="-1">
                <div class="modal-dialog modal-xl">
                    <div class="modal-content">
                        <div class="modal-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                            <h5 class="modal-title"><i class="bi bi-file-medical"></i> Complete Case - SOAP Notes Documentation</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body" style="background-color: #f5f5f5; padding: 2rem;">

                            <!-- TOP SECTION: Key Patient Information (PROMINENT) -->
                            <div class="card mb-4 shadow-lg" style="border: 3px solid #ff9800; border-radius: 12px;">
                                <div class="card-header text-white text-center" style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); padding: 1.5rem; border-radius: 10px 10px 0 0;">
                                    <h4 class="mb-0"><i class="bi bi-person-circle"></i> PATIENT IDENTIFICATION</h4>
                                </div>
                                <div class="card-body" style="background-color: white; padding: 2rem;">
                                    <div class="row text-center mb-3">
                                        <div class="col-md-4">
                                            <div class="p-3 rounded" style="background-color: #fff3e0; border-left: 5px solid #ff9800;">
                                                <h6 class="text-muted mb-2">HN</h6>
                                                <h3 class="mb-0" style="color: #e65100; font-weight: bold;">${caseData.hn || 'N/A'}</h3>
                                            </div>
                                        </div>
                                        <div class="col-md-8">
                                            <div class="p-3 rounded" style="background-color: #fff3e0; border-left: 5px solid #ff9800;">
                                                <h6 class="text-muted mb-2">Full Name</h6>
                                                <h3 class="mb-0" style="color: #e65100; font-weight: bold;">${caseData.first_name || ''} ${caseData.last_name || ''}</h3>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="row text-center">
                                        <div class="col-md-4">
                                            <p class="mb-1"><strong>PT Number:</strong></p>
                                            <p class="text-primary fs-5 mb-0">${caseData.pt_number || 'N/A'}</p>
                                        </div>
                                        <div class="col-md-4">
                                            <p class="mb-1"><strong>Gender:</strong></p>
                                            <p class="fs-5 mb-0">${caseData.gender || 'N/A'}</p>
                                        </div>
                                        <div class="col-md-4">
                                            <p class="mb-1"><strong>DOB:</strong></p>
                                            <p class="fs-5 mb-0">${caseData.dob ? moment(caseData.dob).format('DD/MM/YYYY') : 'N/A'}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Medical Information -->
                            <div class="card mb-4 shadow" style="border-left: 5px solid #4caf50; border-radius: 10px;">
                                <div class="card-header text-white" style="background: linear-gradient(135deg, #4caf50 0%, #388e3c 100%); padding: 1rem;">
                                    <h5 class="mb-0"><i class="bi bi-heart-pulse"></i> GENERAL DIAGNOSIS & MEDICAL INFORMATION</h5>
                                </div>
                                <div class="card-body" style="background-color: #f1f8e9; padding: 1.5rem;">
                                    <div class="row">
                                        <div class="col-md-12 mb-3">
                                            <div class="p-3 rounded" style="background-color: white; border-left: 4px solid #66bb6a;">
                                                <strong style="color: #2e7d32;">General Diagnosis:</strong>
                                                <p class="mb-0 mt-2 fs-5">${caseData.diagnosis || caseData.patient_diagnosis || 'N/A'}</p>
                                            </div>
                                        </div>
                                        <div class="col-md-12 mb-3">
                                            <div class="p-3 rounded" style="background-color: white; border-left: 4px solid #66bb6a;">
                                                <strong style="color: #2e7d32;">Rehab Goals:</strong>
                                                <p class="mb-0 mt-2">${caseData.rehab_goal || 'N/A'}</p>
                                            </div>
                                        </div>
                                        ${caseData.precaution ? `
                                            <div class="col-md-12 mb-2">
                                                <div class="alert alert-warning mb-0" style="border-left: 4px solid #ff9800;">
                                                    <strong><i class="bi bi-exclamation-triangle"></i> Precautions:</strong>
                                                    <p class="mb-0 mt-1">${caseData.precaution}</p>
                                                </div>
                                            </div>
                                        ` : ''}
                                        ${caseData.pn_precautions ? `
                                            <div class="col-md-12 mb-2">
                                                <div class="alert alert-warning mb-0" style="border-left: 4px solid #ff9800;">
                                                    <strong><i class="bi bi-exclamation-triangle"></i> PN Precautions:</strong>
                                                    <p class="mb-0 mt-1">${caseData.pn_precautions}</p>
                                                </div>
                                            </div>
                                        ` : ''}
                                        ${caseData.pn_contraindications ? `
                                            <div class="col-md-12 mb-2">
                                                <div class="alert alert-danger mb-0" style="border-left: 4px solid #f44336;">
                                                    <strong><i class="bi bi-x-octagon"></i> Contraindications:</strong>
                                                    <p class="mb-0 mt-1">${caseData.pn_contraindications}</p>
                                                </div>
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>

                            <!-- PT Assessment (if available) -->
                            ${(caseData.pt_diagnosis || caseData.pt_chief_complaint || caseData.pt_present_history || caseData.pt_pain_score !== null) ? `
                                <div class="card mb-4 shadow" style="border-left: 5px solid #2196F3; border-radius: 10px;">
                                    <div class="card-header text-white" style="background: linear-gradient(135deg, #2196F3 0%, #1976d2 100%); padding: 1rem;">
                                        <h5 class="mb-0"><i class="bi bi-clipboard-pulse"></i> PT ASSESSMENT PROFILE</h5>
                                    </div>
                                    <div class="card-body" style="background-color: #e3f2fd; padding: 1.5rem;">
                                        <div class="row">
                                            ${caseData.pt_diagnosis ? `
                                                <div class="col-md-12 mb-3">
                                                    <div class="p-3 rounded" style="background-color: white; border-left: 4px solid #42a5f5;">
                                                        <strong style="color: #1565c0;">PT Diagnosis:</strong>
                                                        <p class="mb-0 mt-2">${caseData.pt_diagnosis}</p>
                                                    </div>
                                                </div>
                                            ` : ''}
                                            ${caseData.pt_chief_complaint ? `
                                                <div class="col-md-12 mb-3">
                                                    <div class="p-3 rounded" style="background-color: white; border-left: 4px solid #42a5f5;">
                                                        <strong style="color: #1565c0;">Chief Complaint:</strong>
                                                        <p class="mb-0 mt-2">${caseData.pt_chief_complaint}</p>
                                                    </div>
                                                </div>
                                            ` : ''}
                                            ${caseData.pt_present_history ? `
                                                <div class="col-md-12 mb-3">
                                                    <div class="p-3 rounded" style="background-color: white; border-left: 4px solid #42a5f5;">
                                                        <strong style="color: #1565c0;">Present History:</strong>
                                                        <p class="mb-0 mt-2">${caseData.pt_present_history}</p>
                                                    </div>
                                                </div>
                                            ` : ''}
                                            ${caseData.pt_pain_score !== null && caseData.pt_pain_score !== undefined ? `
                                                <div class="col-md-12">
                                                    <div class="p-3 rounded text-center" style="background-color: white; border-left: 4px solid #42a5f5;">
                                                        <strong style="color: #1565c0;">Pain Score:</strong>
                                                        <h2 class="mb-0 mt-2">
                                                            <span class="badge" style="background-color: ${caseData.pt_pain_score >= 7 ? '#f44336' : caseData.pt_pain_score >= 4 ? '#ff9800' : '#4caf50'}; font-size: 2rem; padding: 0.5rem 1.5rem;">
                                                                ${caseData.pt_pain_score}/10
                                                            </span>
                                                        </h2>
                                                    </div>
                                                </div>
                                            ` : ''}
                                        </div>
                                    </div>
                                </div>
                            ` : ''}

                            <!-- SOAP Notes Form -->
                            <div class="card" style="border-left: 4px solid #9c27b0;">
                                <div class="card-header" style="background-color: #9c27b0; color: white;">
                                    <h6 class="mb-0"><i class="bi bi-journal-medical"></i> SOAP Notes - Complete Assessment</h6>
                                </div>
                                <div class="card-body">
                                    <form id="soapForm">
                                        <div class="table-responsive">
                                            <table class="table table-bordered">
                                                <thead class="table-light">
                                                    <tr>
                                                        <th width="25%" class="text-center">
                                                            Subjective
                                                            <button type="button" class="btn btn-sm btn-primary ms-2 soap-ai-btn"
                                                                onclick="generateSOAPField(${caseId}, 'subjective')"
                                                                id="ai-btn-subjective"
                                                                title="AI Generate Subjective">
                                                                <i class="bi bi-stars"></i>
                                                            </button>
                                                        </th>
                                                        <th width="25%" class="text-center">
                                                            Objective
                                                            <button type="button" class="btn btn-sm btn-primary ms-2 soap-ai-btn"
                                                                onclick="generateSOAPField(${caseId}, 'objective')"
                                                                id="ai-btn-objective"
                                                                title="AI Generate Objective">
                                                                <i class="bi bi-stars"></i>
                                                            </button>
                                                        </th>
                                                        <th width="25%" class="text-center">
                                                            Assessment
                                                            <button type="button" class="btn btn-sm btn-primary ms-2 soap-ai-btn"
                                                                onclick="generateSOAPField(${caseId}, 'assessment')"
                                                                id="ai-btn-assessment"
                                                                title="AI Generate Assessment">
                                                                <i class="bi bi-stars"></i>
                                                            </button>
                                                        </th>
                                                        <th width="25%" class="text-center">
                                                            Plan
                                                            <button type="button" class="btn btn-sm btn-primary ms-2 soap-ai-btn"
                                                                onclick="generateSOAPField(${caseId}, 'plan')"
                                                                id="ai-btn-plan"
                                                                title="AI Generate Plan">
                                                                <i class="bi bi-stars"></i>
                                                            </button>
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr>
                                                        <td>
                                                            <textarea class="form-control" id="soap_subjective" rows="10" required
                                                                placeholder="Patient's complaints, symptoms, history..."></textarea>
                                                        </td>
                                                        <td>
                                                            <textarea class="form-control" id="soap_objective" rows="10" required
                                                                placeholder="Observations, measurements, test results..."></textarea>
                                                        </td>
                                                        <td>
                                                            <textarea class="form-control" id="soap_assessment" rows="10" required
                                                                placeholder="Clinical impression, diagnosis, progress..."></textarea>
                                                        </td>
                                                        <td>
                                                            <textarea class="form-control" id="soap_plan" rows="10" required
                                                                placeholder="Treatment plan, goals, follow-up..."></textarea>
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                        <div class="mb-3">
                                            <label class="form-label"><strong>Additional Notes</strong></label>
                                            <textarea class="form-control" id="soap_notes" rows="3"
                                                placeholder="Any additional observations or comments..."></textarea>
                                        </div>
                                        <div class="alert alert-info">
                                            <i class="bi bi-info-circle"></i> Timestamp will be automatically recorded when you complete the case.
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                                <i class="bi bi-x-circle"></i> Cancel
                            </button>
                            <button type="button" class="btn btn-success btn-lg" onclick="submitSOAP(${caseId})">
                                <i class="bi bi-check-circle"></i> Complete Case
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existing = document.getElementById('soapModal');
        if (existing) existing.remove();

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = new bootstrap.Modal(document.getElementById('soapModal'));
        modal.show();

    } catch (error) {
        console.error('Error loading SOAP modal:', error);
        showAlert('Error loading case details', 'danger');
    }
}

// Submit SOAP notes
async function submitSOAP(caseId) {
    try {

        const body = {
            status: 'COMPLETED',
            soap_notes: {
                subjective: document.getElementById('soap_subjective').value,
                objective: document.getElementById('soap_objective').value,
                assessment: document.getElementById('soap_assessment').value,
                plan: document.getElementById('soap_plan').value,
                notes: document.getElementById('soap_notes').value
            }
        };

        if (!body.soap_notes.subjective || !body.soap_notes.objective ||
            !body.soap_notes.assessment || !body.soap_notes.plan) {
            showAlert('Please fill in all SOAP fields', 'warning');
            return;
        }

        const response = await fetch(`/api/pn/${caseId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('soapModal')).hide();
            showAlert('Case completed with SOAP notes', 'success');
            loadCases(currentPage);
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to complete case', 'danger');
        }
    } catch (error) {
        console.error('Error submitting SOAP:', error);
        showAlert('Error submitting SOAP notes', 'danger');
    }
}

// Generate SOAP field using AI
async function generateSOAPField(caseId, fieldType) {
    try {
        const button = document.getElementById(`ai-btn-${fieldType}`);
        const textarea = document.getElementById(`soap_${fieldType}`);

        if (!button || !textarea) {
            console.error('Button or textarea not found for field:', fieldType);
            return;
        }

        // Disable button and show loading state
        button.disabled = true;
        const originalHTML = button.innerHTML;
        button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

        // Get current content from other fields for context
        const context = {
            subjective: document.getElementById('soap_subjective')?.value || '',
            objective: document.getElementById('soap_objective')?.value || '',
            assessment: document.getElementById('soap_assessment')?.value || '',
            plan: document.getElementById('soap_plan')?.value || '',
            currentContent: textarea.value || ''
        };

        // Call backend API to generate SOAP field
        const response = await fetch('/api/admin/soap-smart/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                caseId: caseId,
                fieldType: fieldType,
                context: context
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to generate AI content');
        }

        const result = await response.json();

        if (result.suggestion) {
            // Show suggestion in a confirmation dialog
            const userAccepted = confirm(
                `AI Suggestion for ${fieldType.charAt(0).toUpperCase() + fieldType.slice(1)}:\n\n` +
                `${result.suggestion}\n\n` +
                `Do you want to use this text?`
            );

            if (userAccepted) {
                textarea.value = result.suggestion;
                showAlert(`AI ${fieldType} added successfully`, 'success');
            }
        }

        // Restore button
        button.disabled = false;
        button.innerHTML = originalHTML;

    } catch (error) {
        console.error('Error generating SOAP field:', error);
        showAlert(error.message || 'Error generating AI content', 'danger');

        // Restore button
        const button = document.getElementById(`ai-btn-${fieldType}`);
        if (button) {
            button.disabled = false;
            button.innerHTML = '<i class="bi bi-stars"></i>';
        }
    }
}

// Reverse status (ADMIN only)
async function reverseStatus(caseId) {
    try {
        const reason = prompt('Please provide reason for reversing status (e.g., "This case re-edit SOAP"):');
        if (!reason) return;
        const response = await fetch(`/api/pn/${caseId}/reverse-status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason })
        });

        if (response.ok) {
            showAlert('Status reversed to ACCEPTED. SOAP notes must be re-entered.', 'success');
            loadCases(currentPage);
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to reverse status', 'danger');
        }
    } catch (error) {
        console.error('Error reversing status:', error);
        showAlert('Error reversing status', 'danger');
    }
}

// Display pagination
function displayPagination(pagination, displayedCount) {
    const paginationEl = document.getElementById('pagination');
    const { page, total } = pagination;
    const limit = 20; // Must match the limit in loadCases()

    // Calculate actual pages based on displayed count (after frontend filtering)
    const actualTotal = displayedCount !== undefined ? displayedCount : total;
    const actualPages = Math.ceil(actualTotal / limit);

    // Hide pagination if all cases fit in one page
    if (actualPages <= 1) {
        paginationEl.innerHTML = '';
        return;
    }

    let html = '';

    // Previous button
    html += `
        <li class="page-item ${page === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadCases(${page - 1}); return false;">Previous</a>
        </li>
    `;

    // Page numbers
    for (let i = 1; i <= Math.min(actualPages, 5); i++) {
        if (i === page) {
            html += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
        } else {
            html += `<li class="page-item"><a class="page-link" href="#" onclick="loadCases(${i}); return false;">${i}</a></li>`;
        }
    }

    if (actualPages > 5) {
        html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        html += `<li class="page-item"><a class="page-link" href="#" onclick="loadCases(${actualPages}); return false;">${actualPages}</a></li>`;
    }

    // Next button
    html += `
        <li class="page-item ${page === actualPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadCases(${page + 1}); return false;">Next</a>
        </li>
    `;

    // Total info - Show actual displayed count and pages
    html += `
        <li class="page-item disabled">
            <span class="page-link">Showing: ${actualTotal} cases | Page ${page}/${actualPages}</span>
        </li>
    `;

    paginationEl.innerHTML = html;
}

// Update statistics
function updateStatistics(stats) {
    if (!stats) return;

    const totalEl = document.getElementById('stat-total');
    const waitingEl = document.getElementById('stat-waiting');
    const acceptedEl = document.getElementById('stat-accepted');
    const completedEl = document.getElementById('stat-completed');

    // ✅ FIX: Use stats.total directly from Backend (excludes CANCELLED cases)
    // Backend already calculates: COUNT(CASE WHEN status != 'CANCELLED' THEN 1 END) as total
    const total = parseInt(stats.total || 0);
    const waitingCount = parseInt(stats.waiting || 0);
    const acceptedCount = parseInt(stats.accepted || 0);
    const completedCount = parseInt(stats.completed || 0);

    // Update UI with correct values from Backend
    if (totalEl) totalEl.textContent = total;
    if (waitingEl) waitingEl.textContent = waitingCount;
    if (acceptedEl) acceptedEl.textContent = acceptedCount;
    if (completedEl) completedEl.textContent = completedCount;
}

// Quick filters
function setQuickFilter(type) {
    const fromEl = document.getElementById('filter-from');
    const toEl = document.getElementById('filter-to');
    const today = moment();

    switch(type) {
        case 'today':
            fromEl._flatpickr.setDate(today.format('YYYY-MM-DD'));
            toEl._flatpickr.setDate(today.format('YYYY-MM-DD'));
            break;
        case 'week':
            // Start of week (Monday) to end of week (Sunday)
            fromEl._flatpickr.setDate(today.clone().startOf('week').format('YYYY-MM-DD'));
            toEl._flatpickr.setDate(today.clone().endOf('week').format('YYYY-MM-DD'));
            break;
        case 'month':
            fromEl._flatpickr.setDate(today.clone().startOf('month').format('YYYY-MM-DD'));
            toEl._flatpickr.setDate(today.clone().endOf('month').format('YYYY-MM-DD'));
            break;
        case 'year':
            fromEl._flatpickr.setDate(today.clone().startOf('year').format('YYYY-MM-DD'));
            toEl._flatpickr.setDate(today.clone().endOf('year').format('YYYY-MM-DD'));
            break;
    }

    loadCases();
    loadWalkInAppointments(); // Reload walk-in table with same filters
}

// Clear filters
function clearFilters() {
    document.getElementById('filter-clinic').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-from')._flatpickr.clear();
    document.getElementById('filter-to')._flatpickr.clear();
    document.getElementById('search-input').value = '';
    loadCases();
    loadWalkInAppointments(); // Reload walk-in table with cleared filters
}

// Open patient detail in new tab
function openPatientDetail(patientId) {
    window.open(`/patient/${patientId}`, '_blank');
}

// View case details
function viewCase(caseId) {
    window.location.href = `/pn/${caseId}`;
}

// Download last report
async function downloadLastReport(caseId) {
    // Implementation for downloading last report
    window.open(`/api/pn/${caseId}/last-report`, '_blank');
}

// NEW: View bill details - Opens bill detail modal
async function viewBillDetails(billId) {
    try {
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('billDetailModal'));

        // Show loading state
        document.getElementById('billDetailLoading').style.display = 'block';
        document.getElementById('billDetailContent').style.display = 'none';

        modal.show();

        // Fetch bill details
        const response = await fetch(`/api/bills/${billId}`, {
            headers: {
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load bill details');
        }

        const bill = await response.json();

        // Hide loading and show content
        document.getElementById('billDetailLoading').style.display = 'none';
        document.getElementById('billDetailContent').style.display = 'block';

        // Populate bill details
        document.getElementById('bill-detail-code').textContent = bill.bill_code || '-';
        document.getElementById('bill-detail-date').textContent = bill.bill_date ? moment(bill.bill_date).format('DD/MM/YYYY') : '-';

        // Status badge
        const statusColors = {
            'PAID': 'success',
            'UNPAID': 'danger',
            'PARTIAL': 'warning',
            'CANCELLED': 'secondary'
        };
        const statusColor = statusColors[bill.payment_status] || 'secondary';
        document.getElementById('bill-detail-status').innerHTML = `<span class="badge bg-${statusColor}">${bill.payment_status}</span>`;

        document.getElementById('bill-detail-patient').textContent = bill.patient_name || 'Walk-in';
        document.getElementById('bill-detail-clinic').textContent = bill.clinic_name || '-';

        // Populate bill items
        const itemsHtml = bill.items && bill.items.length > 0
            ? bill.items.map(item => `
                <tr>
                    <td>${escapeHtml(item.service_name)}</td>
                    <td class="text-center">${item.quantity}</td>
                    <td class="text-end">฿${parseFloat(item.unit_price).toFixed(2)}</td>
                    <td class="text-end">฿${parseFloat(item.discount || 0).toFixed(2)}</td>
                    <td class="text-end">฿${parseFloat(item.total_price).toFixed(2)}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="5" class="text-center">No items</td></tr>';

        document.getElementById('bill-detail-items').innerHTML = itemsHtml;

        // Populate totals
        document.getElementById('bill-detail-subtotal').textContent = `฿${parseFloat(bill.subtotal || 0).toFixed(2)}`;
        document.getElementById('bill-detail-discount').textContent = `฿${parseFloat(bill.discount || 0).toFixed(2)}`;
        document.getElementById('bill-detail-tax').textContent = `฿${parseFloat(bill.tax || 0).toFixed(2)}`;
        document.getElementById('bill-detail-total').textContent = `฿${parseFloat(bill.total_amount || 0).toFixed(2)}`;

        // Store billId for print and edit functions
        document.getElementById('billDetailModal').dataset.billId = billId;

    } catch (error) {
        console.error('Error loading bill details:', error);
        showAlert('Failed to load bill details', 'danger');
        bootstrap.Modal.getInstance(document.getElementById('billDetailModal'))?.hide();
    }
}

// Print bill
function printBill() {
    const billId = document.getElementById('billDetailModal').dataset.billId;
    if (billId) {
        // Open bill print view in new tab
        window.open(`/documents/render/bill/${billId}`, '_blank');
    }
}

// Edit bill - Redirect to bills page with edit parameter
function editBill() {
    const billId = document.getElementById('billDetailModal').dataset.billId;
    if (!billId) return;

    // Redirect to bills page with edit parameter
    window.location.href = `/bills?edit=${billId}`;
}

// Create bill for PN case
async function createBillForPN(pnId, patientId) {
    try {

        // Get PN case details first to get clinic_id
        const response = await fetch(`/api/pn/${pnId}`, {
            headers: {
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load PN case details');
        }

        const pnCase = await response.json();

        // Redirect to bills page with pre-filled PN case information
        window.location.href = `/bills?pn_case_id=${pnId}&patient_id=${patientId}&clinic_id=${pnCase.target_clinic_id || pnCase.source_clinic_id}`;
    } catch (error) {
        console.error('Error creating bill for PN:', error);
        showAlert('Failed to create bill. Please try again.', 'danger');
    }
}

// Export data
function exportData() {
    const params = new URLSearchParams(window.location.search);
    params.append('export', 'csv');
    window.open(`/api/pn/export?${params}`, '_blank');
}

// Logout function
async function logout() {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
            }
        });
        
        // Clear storage
        document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        localStorage.clear();
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login';
    }
}

// Utility functions

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function showAlert(message, type = 'info') {
    const alertHtml = `
        <div class="alert alert-${type} alert-dismissible fade show position-fixed top-0 end-0 m-3" style="z-index: 9999;">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', alertHtml);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        const alert = document.querySelector('.alert');
        if (alert) alert.remove();
    }, 5000);
}

// ========================================
// PT CERTIFICATE FUNCTIONS
// ========================================

let currentCertificatePnId = null;
let currentEditCertId = null;

// Helper function to safely get logged in user data
function getLoggedInUser() {
    const userStr = localStorage.getItem('user');
    if (!userStr || userStr === 'null' || userStr === 'undefined') {
        return null;
    }
    return JSON.parse(userStr);
}

async function openCertificateModal(pnId) {
    currentCertificatePnId = pnId;
    currentEditCertId = null;

    // Reset form
    document.getElementById('newCertificateForm').reset();
    document.getElementById('cert_pn_id').value = pnId;
    document.getElementById('cert_edit_id').value = '';

    // Show loading
    document.getElementById('certificateLoading').style.display = 'block';
    document.getElementById('existingCertificates').style.display = 'none';
    document.getElementById('certificateForm').style.display = 'none';

    // Open modal
    const modal = new bootstrap.Modal(document.getElementById('certificateModal'));
    modal.show();

    // Load existing certificates
    try {
        const response = await fetch(`/api/pn/${pnId}/certificates`, {
            headers: {
            }
        });

        if (response.ok) {
            const certificates = await response.json();

            document.getElementById('certificateLoading').style.display = 'none';

            if (certificates.length > 0) {
                displayCertificatesList(certificates);
                document.getElementById('existingCertificates').style.display = 'block';
            }

            document.getElementById('certificateForm').style.display = 'block';
            document.getElementById('createCertBtn').style.display = 'inline-block';
            document.getElementById('saveCertBtn').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading certificates:', error);
        document.getElementById('certificateLoading').innerHTML = '<p class="text-danger">Error loading certificates</p>';
    }
}

function displayCertificatesList(certificates) {
    const listDiv = document.getElementById('certificatesList');
    const loggedInUser = getLoggedInUser();
    const isAdmin = loggedInUser && loggedInUser.role === 'ADMIN';

    listDiv.innerHTML = certificates.map(cert => {
        const certData = JSON.parse(cert.certificate_data || '{}');
        const createdDate = new Date(cert.created_at).toLocaleDateString('en-GB');

        return `
            <div class="card mb-2">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="mb-1">
                                <i class="bi bi-file-earmark-medical text-success me-2"></i>
                                Certificate #${cert.id} - ${cert.certificate_type.toUpperCase()}
                            </h6>
                            <small class="text-muted">
                                Created: ${createdDate} by ${escapeHtml(cert.created_by_name)}
                            </small>
                        </div>
                        <div>
                            <button class="btn btn-sm btn-primary" onclick="window.open('/documents/render/pt_cert/${cert.id}', '_blank')" title="View/Print">
                                <i class="bi bi-printer-fill"></i>
                            </button>
                            ${isAdmin ? `
                                <button class="btn btn-sm btn-warning" onclick="editCertificate(${cert.id}, ${escapeHtml(JSON.stringify(certData))})" title="Edit (Admin Only)">
                                    <i class="bi bi-pencil-fill"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    ${certData.pt_diagnosis ? `
                        <div class="mt-2">
                            <strong>PT Diagnosis:</strong> ${escapeHtml(certData.pt_diagnosis.substring(0, 100))}${certData.pt_diagnosis.length > 100 ? '...' : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function editCertificate(certId, certData) {
    currentEditCertId = certId;

    // Populate form with existing data
    document.getElementById('cert_edit_id').value = certId;
    document.getElementById('cert_pt_diagnosis').value = certData.pt_diagnosis || '';
    document.getElementById('cert_notes').value = certData.additional_notes || '';

    // Show save button, hide create button
    document.getElementById('createCertBtn').style.display = 'none';
    document.getElementById('saveCertBtn').style.display = 'inline-block';
    document.getElementById('certificateModalTitle').textContent = 'Edit Physiotherapy Certificate';
}

async function createCertificate() {
    const form = document.getElementById('newCertificateForm');

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const pnId = document.getElementById('cert_pn_id').value;
    const certType = document.getElementById('cert_type').value;
    const ptDiagnosis = document.getElementById('cert_pt_diagnosis').value.trim();
    const additionalNotes = document.getElementById('cert_notes').value.trim();

    if (!ptDiagnosis) {
        showAlert('Please enter PT diagnosis', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/pn/${pnId}/certificate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                certificate_type: certType,
                certificate_data: {
                    pt_diagnosis: ptDiagnosis,
                    additional_notes: additionalNotes
                }
            })
        });

        if (response.ok) {
            const result = await response.json();
            showAlert('Certificate created successfully!', 'success');

            // Close modal and open print view
            bootstrap.Modal.getInstance(document.getElementById('certificateModal')).hide();
            window.open(`/documents/render/pt_cert/${result.certificate_id}`, '_blank');

            // Reload cases to update UI
            loadCases();
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to create certificate', 'danger');
        }
    } catch (error) {
        console.error('Error creating certificate:', error);
        showAlert('Error creating certificate', 'danger');
    }
}

async function saveCertificate() {
    const form = document.getElementById('newCertificateForm');

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const certId = document.getElementById('cert_edit_id').value;
    const ptDiagnosis = document.getElementById('cert_pt_diagnosis').value.trim();
    const additionalNotes = document.getElementById('cert_notes').value.trim();

    if (!ptDiagnosis) {
        showAlert('Please enter PT diagnosis', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/certificates/${certId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                certificate_data: {
                    pt_diagnosis: ptDiagnosis,
                    additional_notes: additionalNotes
                }
            })
        });

        if (response.ok) {
            showAlert('Certificate updated successfully!', 'success');

            // Close modal and reload
            bootstrap.Modal.getInstance(document.getElementById('certificateModal')).hide();

            // Reload certificates
            openCertificateModal(currentCertificatePnId);
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to update certificate', 'danger');
        }
    } catch (error) {
        console.error('Error updating certificate:', error);
        showAlert('Error updating certificate', 'danger');
    }
}

// ========================================
// DASHBOARD BODY ANNOTATION MANAGER
// ========================================

class DashboardBodyAnnotationManager {
    constructor() {
        this.modal = null;
        this.drawingModal = null;
        this.previewCanvas = null;
        this.drawingCanvas = null;
        this.previewCtx = null;
        this.drawingCtx = null;
        this.strokes = [];
        this.currentStroke = null;
        this.isDrawing = false;
        this.bodyImage = null;
        this.currentColor = '#FF0000';
        this.currentWidth = 3;
        this.currentCaseId = null;
        this.needsPTAssessment = false;
    }

    init() {
        console.log('📋 Initializing modal elements...');

        const modalEl = document.getElementById('dashboardBodyAnnotationModal');
        const drawingModalEl = document.getElementById('dashboardBodyDrawingModal');

        console.log('   Main modal element:', modalEl ? '✅ Found' : '❌ Not found');
        console.log('   Drawing modal element:', drawingModalEl ? '✅ Found' : '❌ Not found');

        if (!modalEl || !drawingModalEl) {
            console.error('❌ Modal elements not found in DOM!');
            throw new Error('Modal elements not found');
        }

        if (typeof bootstrap === 'undefined') {
            console.error('❌ Bootstrap is not loaded!');
            throw new Error('Bootstrap is not loaded');
        }

        this.modal = new bootstrap.Modal(modalEl);
        this.drawingModal = new bootstrap.Modal(drawingModalEl);

        console.log('   Bootstrap modals initialized:', this.modal ? '✅' : '❌');

        this.previewCanvas = document.getElementById('dashboardBodyAnnotationPreview');
        this.drawingCanvas = document.getElementById('dashboardBodyAnnotationCanvas');

        console.log('   Preview canvas:', this.previewCanvas ? '✅ Found' : '❌ Not found');
        console.log('   Drawing canvas:', this.drawingCanvas ? '✅ Found' : '❌ Not found');

        if (this.previewCanvas) {
            this.previewCtx = this.previewCanvas.getContext('2d');
        }
        if (this.drawingCanvas) {
            this.drawingCtx = this.drawingCanvas.getContext('2d');
        }

        this.loadBodyImage();
        this.bindEvents();

        console.log('✅ Initialization complete');
    }

    bindEvents() {
        // Draw button - open full-screen drawing modal (fixed ID)
        const drawButton = document.getElementById('dashboardDrawBodyButton');
        if (drawButton) {
            drawButton.onclick = () => this.openDrawingModal();
        }

        // Undo button (preview)
        const undoButton = document.getElementById('dashboardUndoButton');
        if (undoButton) {
            undoButton.onclick = () => this.undo();
        }

        // Clear all button (preview)
        const clearButton = document.getElementById('dashboardClearButton');
        if (clearButton) {
            clearButton.onclick = () => this.clearAll();
        }

        // Undo button (drawing modal)
        const undoDrawingButton = document.getElementById('dashboardUndoDrawingButton');
        if (undoDrawingButton) {
            undoDrawingButton.onclick = () => this.undo();
        }

        // Clear all button (drawing modal)
        const clearDrawingButton = document.getElementById('dashboardClearDrawingButton');
        if (clearDrawingButton) {
            clearDrawingButton.onclick = () => this.clearAll();
        }

        // Save button
        const saveButton = document.getElementById('dashboardSaveAnnotationButton');
        if (saveButton) {
            saveButton.onclick = () => this.saveAnnotation();
        }

        // Save & Close drawing button
        const saveDrawingButton = document.getElementById('dashboardSaveDrawingButton');
        if (saveDrawingButton) {
            saveDrawingButton.onclick = () => this.closeDrawingModal();
        }

        // Cancel drawing button
        const cancelDrawingButton = document.getElementById('dashboardCancelDrawingButton');
        if (cancelDrawingButton) {
            cancelDrawingButton.onclick = () => {
                this.drawingModal.hide();
            };
        }

        // Close drawing button (X button)
        const closeDrawingButton = document.getElementById('dashboardCloseDrawingButton');
        if (closeDrawingButton) {
            closeDrawingButton.onclick = () => {
                this.drawingModal.hide();
            };
        }

        // Severity slider
        const severitySlider = document.getElementById('dashboardSeverity');
        if (severitySlider) {
            severitySlider.oninput = (e) => {
                const display = document.getElementById('dashboardSeverityValue');
                if (display) display.textContent = e.target.value;
            };
        }

        // Color buttons
        document.querySelectorAll('.dashboard-color-btn').forEach(btn => {
            btn.onclick = (e) => {
                const color = e.target.dataset.color;
                this.currentColor = color;
                document.querySelectorAll('.dashboard-color-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            };
        });

        // Width slider
        const widthSlider = document.getElementById('dashboardStrokeWidth');
        if (widthSlider) {
            widthSlider.oninput = (e) => {
                this.currentWidth = parseInt(e.target.value);
                const display = document.getElementById('dashboardWidthValue');
                if (display) display.textContent = this.currentWidth;
            };
        }

        // Drawing canvas events (Pointer API - Apple Pencil only mode)
        if (this.drawingCanvas) {
            this.drawingCanvas.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
            this.drawingCanvas.addEventListener('pointermove', (e) => this.handlePointerMove(e));
            this.drawingCanvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
            this.drawingCanvas.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
            this.drawingCanvas.addEventListener('pointerleave', (e) => this.handlePointerUp(e));
        }
    }

    loadBodyImage() {
        this.bodyImage = new Image();
        this.bodyImage.src = '/uploads/body.png';
        this.bodyImage.onload = () => {
            this.renderPreview();
            this.renderDrawingCanvas();
        };
        this.bodyImage.onerror = () => {
            console.error('Failed to load body image');
        };
    }

    showModal(caseId, needsPTAssessment = false) {
        console.log('🎨 DashboardBodyAnnotationManager.showModal() called');
        console.log('   Case ID:', caseId);
        console.log('   Needs PT Assessment:', needsPTAssessment);

        if (!this.modal) {
            console.error('❌ Modal not initialized!');
            showAlert('Modal not initialized. Please refresh the page.', 'danger');
            return;
        }

        this.currentCaseId = caseId;
        this.needsPTAssessment = needsPTAssessment;
        this.strokes = [];
        this.currentStroke = null;
        this.isDrawing = false;

        // Reset form
        const form = document.getElementById('dashboardBodyAnnotationForm');
        if (form) {
            form.reset();
            console.log('   Form reset: ✅');
        } else {
            console.warn('   Form not found');
        }

        this.updateStrokeCount();
        this.renderPreview();

        console.log('   Modal object:', this.modal);
        console.log('   About to call modal.show()...');

        try {
            // Try direct DOM manipulation as fallback
            const modalElement = document.getElementById('dashboardBodyAnnotationModal');
            console.log('   Modal element from DOM:', modalElement);

            if (modalElement) {
                // Force show with Bootstrap's native API
                const bsModal = bootstrap.Modal.getOrCreateInstance(modalElement);
                console.log('   Bootstrap Modal instance:', bsModal);
                bsModal.show();
                console.log('   ✅ Modal.show() called via getOrCreateInstance');
            } else {
                console.error('   ❌ Modal element not found in DOM');
            }
        } catch (error) {
            console.error('   ❌ Error showing modal:', error);
            console.error('   Error stack:', error.stack);
            showAlert('Error showing modal: ' + error.message, 'danger');
        }
    }

    // Test function to manually trigger modal (call from console: testDashboardModal())
    testModal() {
        console.log('🧪 Testing modal...');
        this.showModal(999, false);
    }

    openDrawingModal() {
        this.renderDrawingCanvas();
        this.drawingModal.show();
    }

    closeDrawingModal() {
        this.renderPreview();
        this.drawingModal.hide();
    }

    handlePointerDown(e) {
        // Block finger touch only - allow mouse (PC) and Apple Pencil (iPad)
        if (e.pointerType === 'touch') {
            console.log('Ignoring finger touch input');
            return;
        }

        e.preventDefault();
        this.isDrawing = true;

        const rect = this.drawingCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        this.currentStroke = {
            color: this.currentColor,
            width: this.currentWidth,
            points: [{ x, y, pressure: e.pressure || 0.5, timestamp: Date.now() }]
        };

        this.drawingCanvas.setPointerCapture(e.pointerId);
    }

    handlePointerMove(e) {
        if (!this.isDrawing || !this.currentStroke) return;

        // Block finger touch only - allow mouse (PC) and Apple Pencil (iPad)
        if (e.pointerType === 'touch') {
            return;
        }

        e.preventDefault();
        const rect = this.drawingCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        this.currentStroke.points.push({
            x,
            y,
            pressure: e.pressure || 0.5,
            timestamp: Date.now()
        });

        this.renderDrawingCanvas();
    }

    handlePointerUp(e) {
        if (!this.isDrawing) return;

        // Block finger touch only - allow mouse (PC) and Apple Pencil (iPad)
        if (e.pointerType === 'touch') {
            return;
        }

        e.preventDefault();
        this.isDrawing = false;

        if (this.currentStroke && this.currentStroke.points.length > 1) {
            this.strokes.push(this.currentStroke);
            this.updateStrokeCount();
        }

        this.currentStroke = null;
        this.renderDrawingCanvas();

        if (e.pointerId !== undefined) {
            this.drawingCanvas.releasePointerCapture(e.pointerId);
        }
    }

    renderPreview() {
        if (!this.previewCtx || !this.bodyImage) return;

        const canvas = this.previewCanvas;
        const ctx = this.previewCtx;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(this.bodyImage, 0, 0, canvas.width, canvas.height);

        this.strokes.forEach(stroke => {
            if (!stroke.points || stroke.points.length < 2) return;

            ctx.strokeStyle = stroke.color || '#FF0000';
            ctx.lineWidth = stroke.width || 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.beginPath();
            ctx.moveTo(
                stroke.points[0].x * canvas.width,
                stroke.points[0].y * canvas.height
            );

            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(
                    stroke.points[i].x * canvas.width,
                    stroke.points[i].y * canvas.height
                );
            }

            ctx.stroke();
        });
    }

    renderDrawingCanvas() {
        if (!this.drawingCtx || !this.bodyImage) return;

        const canvas = this.drawingCanvas;
        const ctx = this.drawingCtx;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(this.bodyImage, 0, 0, canvas.width, canvas.height);

        this.strokes.forEach(stroke => {
            if (!stroke.points || stroke.points.length < 2) return;

            ctx.strokeStyle = stroke.color || '#FF0000';
            ctx.lineWidth = stroke.width || 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.beginPath();
            ctx.moveTo(
                stroke.points[0].x * canvas.width,
                stroke.points[0].y * canvas.height
            );

            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(
                    stroke.points[i].x * canvas.width,
                    stroke.points[i].y * canvas.height
                );
            }

            ctx.stroke();
        });

        // Draw current stroke being drawn
        if (this.currentStroke && this.currentStroke.points.length > 0) {
            ctx.strokeStyle = this.currentStroke.color || '#FF0000';
            ctx.lineWidth = this.currentStroke.width || 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.beginPath();
            ctx.moveTo(
                this.currentStroke.points[0].x * canvas.width,
                this.currentStroke.points[0].y * canvas.height
            );

            for (let i = 1; i < this.currentStroke.points.length; i++) {
                ctx.lineTo(
                    this.currentStroke.points[i].x * canvas.width,
                    this.currentStroke.points[i].y * canvas.height
                );
            }

            ctx.stroke();
        }
    }

    undo() {
        if (this.strokes.length > 0) {
            this.strokes.pop();
            this.renderPreview();
            this.renderDrawingCanvas();
            this.updateStrokeCount();
        }
    }

    clearAll() {
        if (confirm('Clear all drawings?')) {
            this.strokes = [];
            this.renderPreview();
            this.renderDrawingCanvas();
            this.updateStrokeCount();
        }
    }

    updateStrokeCount() {
        const countEl = document.getElementById('dashboardStrokeCount');
        if (countEl) {
            countEl.textContent = `${this.strokes.length} stroke${this.strokes.length !== 1 ? 's' : ''}`;
        }
    }

    getAnnotationData() {
        const form = document.getElementById('dashboardBodyAnnotationForm');

        return {
            constant_pain: document.getElementById('dashboardConstantPain')?.checked || false,
            intermittent_pain: document.getElementById('dashboardIntermittentPain')?.checked || false,
            pain_type: document.getElementById('dashboardPainType')?.value || '',
            aggravation: document.getElementById('dashboardAggravation')?.value || '',
            easing_factor: document.getElementById('dashboardEasingFactor')?.value || '',
            severity: parseInt(document.getElementById('dashboardSeverity')?.value || 5),
            notes: document.getElementById('dashboardNotes')?.value || '',
            strokes: this.strokes,
            image_width: this.previewCanvas.width,
            image_height: this.previewCanvas.height
        };
    }

    async saveAnnotation() {
        try {
            if (this.strokes.length === 0) {
                showAlert('Please draw on the body diagram before saving', 'warning');
                return;
            }

            const annotationData = this.getAnnotationData();

            // Create body annotation
            console.log('📤 Sending annotation data:', annotationData);

            const annotationResponse = await fetch('/api/body-annotations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    entity_type: 'pn_case',
                    entity_id: this.currentCaseId,
                    strokes_json: JSON.stringify(annotationData.strokes),
                    image_width: annotationData.image_width,
                    image_height: annotationData.image_height,
                    // Send metadata fields at root level (not nested)
                    constant_pain: annotationData.constant_pain,
                    intermittent_pain: annotationData.intermittent_pain,
                    pain_type: annotationData.pain_type,
                    aggravation: annotationData.aggravation,
                    easing_factor: annotationData.easing_factor,
                    severity: annotationData.severity,
                    notes: annotationData.notes
                })
            });

            if (!annotationResponse.ok) {
                throw new Error('Failed to save body annotation');
            }

            const annotationResult = await annotationResponse.json();
            const annotationId = annotationResult.annotation_id;

            // Now accept the PN case with the annotation ID
            const acceptBody = {
                status: 'ACCEPTED',
                body_annotation_id: annotationId
            };

            // If PT assessment is needed, we would add those fields here
            // For now, we just accept with the annotation

            const acceptResponse = await fetch(`/api/pn/${this.currentCaseId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(acceptBody)
            });

            if (!acceptResponse.ok) {
                throw new Error('Failed to accept PN case');
            }

            showAlert('Body annotation saved and case accepted successfully!', 'success');
            this.modal.hide();
            loadCases(currentPage);

        } catch (error) {
            console.error('Error saving annotation:', error);
            showAlert('Failed to save annotation: ' + error.message, 'danger');
        }
    }
}

// Toggle PTHN group expansion/collapse
function togglePTHNGroup(hn) {
    // Find all child rows for this HN
    const childRows = document.querySelectorAll(`.pthn-child-${CSS.escape(hn)}`);
    const icon = document.getElementById(`icon-${hn}`);

    if (!childRows.length || !icon) return;

    // Check if currently expanded
    const isExpanded = childRows[0].style.display !== 'none';

    if (isExpanded) {
        // Collapse: hide all child rows
        childRows.forEach(row => {
            row.style.display = 'none';
        });
        // Change icon to plus
        icon.className = 'bi bi-plus-circle-fill pthn-toggle-icon';
    } else {
        // Expand: show all child rows
        childRows.forEach(row => {
            row.style.display = 'table-row';
        });
        // Change icon to minus
        icon.className = 'bi bi-dash-circle-fill pthn-toggle-icon';
    }
}

// Initialize dashboard body annotation manager
let dashboardBodyAnnotationManager = null;
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing DashboardBodyAnnotationManager...');
    console.log('   Bootstrap available:', typeof bootstrap !== 'undefined');
    console.log('   jQuery available:', typeof $ !== 'undefined');

    try {
        dashboardBodyAnnotationManager = new DashboardBodyAnnotationManager();
        dashboardBodyAnnotationManager.init();
        console.log('✅ DashboardBodyAnnotationManager initialized successfully');

        // Expose test function globally
        window.testDashboardModal = () => {
            console.log('🧪 Manual modal test triggered');
            if (dashboardBodyAnnotationManager) {
                dashboardBodyAnnotationManager.testModal();
            } else {
                console.error('Manager not available');
            }
        };
        console.log('📝 To test modal manually, run: testDashboardModal()');

    } catch (error) {
        console.error('❌ Failed to initialize DashboardBodyAnnotationManager:', error);
        console.error('   Error details:', error.stack);
    }
});

// Body Annotation for PN Case Acceptance (CL001 clinics)
function showBodyAnnotationModalForAccept(caseId) {
    console.log('📞 showBodyAnnotationModalForAccept() called for case:', caseId);
    if (dashboardBodyAnnotationManager) {
        console.log('   Manager exists, calling showModal()');
        dashboardBodyAnnotationManager.showModal(caseId, false);
    } else {
        console.error('   ❌ Manager not initialized!');
        showAlert('Body annotation manager not initialized', 'danger');
    }
}

// Combined PT Assessment + Body Annotation for PN Case Acceptance (Non-CL001 clinics)
function showPTAssessmentWithBodyAnnotationModal(caseId) {
    console.log('📞 showPTAssessmentWithBodyAnnotationModal() called for case:', caseId);
    // For now, show body annotation modal with PT assessment flag
    // In future, this could show a combined modal with PT assessment fields + body annotation
    if (dashboardBodyAnnotationManager) {
        console.log('   Manager exists, calling showModal()');
        dashboardBodyAnnotationManager.showModal(caseId, true);
    } else {
        console.error('   ❌ Manager not initialized!');
        showAlert('Body annotation manager not initialized', 'danger');
    }
}