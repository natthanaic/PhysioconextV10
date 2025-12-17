// PN Case Logs Management
const PNLogsManager = {
    currentPage: 1,
    perPage: 20,
    totalPages: 0,
    totalRecords: 0,
    currentView: 'table',
    filters: {
        search: '',
        status: '',
        clinic: '',
        dateFrom: '',
        dateTo: ''
    },
    allCases: [],
    clinics: [],

    async init() {
        await this.loadClinics();
        await this.loadLogs();
        this.setupEventListeners();
    },

    setupEventListeners() {
        // Search input with debounce
        let searchTimeout;
        document.getElementById('search-input').addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.filters.search = e.target.value;
                this.currentPage = 1;
                this.loadLogs();
            }, 500);
        });

        // Filter changes
        document.getElementById('filter-status').addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this.currentPage = 1;
            this.loadLogs();
        });

        document.getElementById('filter-clinic').addEventListener('change', (e) => {
            this.filters.clinic = e.target.value;
            this.currentPage = 1;
            this.loadLogs();
        });

        document.getElementById('filter-date-from').addEventListener('change', (e) => {
            this.filters.dateFrom = e.target.value;
            this.currentPage = 1;
            this.loadLogs();
        });

        document.getElementById('filter-date-to').addEventListener('change', (e) => {
            this.filters.dateTo = e.target.value;
            this.currentPage = 1;
            this.loadLogs();
        });
    },

    async loadClinics() {
        try {
            const response = await fetch('/api/clinics', {
                headers: {}
            });

            if (response.ok) {
                this.clinics = await response.json();
                this.renderClinicFilter();
            }
        } catch (error) {
            console.error('Error loading clinics:', error);
        }
    },

    renderClinicFilter() {
        const select = document.getElementById('filter-clinic');
        select.innerHTML = '<option value="">All Clinics</option>';

        this.clinics.forEach(clinic => {
            const option = document.createElement('option');
            option.value = clinic.id;
            option.textContent = clinic.name;
            select.appendChild(option);
        });
    },

    async loadLogs() {
        this.showLoading();

        try {
            const params = new URLSearchParams({
                page: this.currentPage,
                limit: this.perPage,
                search: this.filters.search,
                status: this.filters.status,
                clinic_id: this.filters.clinic
            });

            // Add date filters if present
            if (this.filters.dateFrom) {
                params.append('date_from', this.filters.dateFrom);
            }
            if (this.filters.dateTo) {
                params.append('date_to', this.filters.dateTo);
            }

            const response = await fetch(`/api/pn?${params}`, {
                headers: {}
            });

            if (response.ok) {
                const data = await response.json();
                this.allCases = data.cases || [];
                this.totalRecords = data.pagination?.total || 0;
                this.totalPages = data.pagination?.pages || 1;

                this.renderStats(data.statistics);
                this.renderLogs();
                this.renderPagination();
                this.updateRecordInfo();
            }
        } catch (error) {
            console.error('Error loading logs:', error);
            this.showError('Failed to load PN case logs');
        } finally {
            this.hideLoading();
        }
    },

    renderStats(stats) {
        if (!stats) return;

        document.getElementById('stat-total').textContent = stats.total || 0;
        document.getElementById('stat-pending').textContent = stats.waiting || 0;
        document.getElementById('stat-active').textContent = stats.accepted || 0;
        document.getElementById('stat-completed').textContent = stats.completed || 0;
    },

    renderLogs() {
        if (this.currentView === 'table') {
            this.renderTableView();
        } else {
            this.renderTimelineView();
        }
    },

    renderTableView() {
        const tbody = document.getElementById('logs-table-body');

        if (this.allCases.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8">
                        <div class="empty-state">
                            <i class="bi bi-inbox"></i>
                            <h5 class="text-muted">No PN cases found</h5>
                            <p class="text-muted">Try adjusting your filters or search criteria</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.allCases.map(pnCase => `
            <tr onclick="viewPNCase(${pnCase.id})">
                <td>
                    <span class="pn-code">${this.escapeHtml(pnCase.pn_code)}</span>
                </td>
                <td>
                    <div class="fw-semibold">${this.escapeHtml(pnCase.first_name)} ${this.escapeHtml(pnCase.last_name)}</div>
                </td>
                <td>
                    <span class="badge bg-light text-dark border">${this.escapeHtml(pnCase.hn || 'N/A')}</span>
                </td>
                <td>
                    <div class="text-truncate" style="max-width: 200px;" title="${this.escapeHtml(pnCase.diagnosis)}">
                        ${this.truncate(this.escapeHtml(pnCase.diagnosis), 50)}
                    </div>
                </td>
                <td>
                    <small class="text-muted">
                        <i class="bi bi-building me-1"></i>${this.escapeHtml(pnCase.source_clinic_name || 'N/A')}
                    </small>
                </td>
                <td>${this.getStatusBadge(pnCase.status)}</td>
                <td>
                    <div class="small">
                        <div><i class="bi bi-calendar me-1"></i>${this.formatDate(pnCase.created_at)}</div>
                        <div class="text-muted"><i class="bi bi-clock me-1"></i>${this.formatTime(pnCase.created_at)}</div>
                    </div>
                </td>
                <td>
                    <div class="quick-actions" onclick="event.stopPropagation()">
                        <button class="btn btn-sm btn-outline-primary" onclick="viewPNCase(${pnCase.id})" title="View Details">
                            <i class="bi bi-eye"></i>
                        </button>
                        ${pnCase.bill_id ? `
                            <button class="btn btn-sm btn-outline-success" onclick="viewBill(${pnCase.bill_id})" title="View Bill">
                                <i class="bi bi-receipt"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    },

    renderTimelineView() {
        const container = document.getElementById('timeline-view');

        if (this.allCases.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-inbox"></i>
                    <h5 class="text-muted">No PN cases found</h5>
                    <p class="text-muted">Try adjusting your filters or search criteria</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.allCases.map(pnCase => `
            <div class="timeline-item">
                <div class="timeline-card" onclick="viewPNCase(${pnCase.id})">
                    <div class="d-flex justify-content-between align-items-start mb-3">
                        <div>
                            <span class="pn-code">${this.escapeHtml(pnCase.pn_code)}</span>
                            <div class="mt-2">
                                <h5 class="mb-1">${this.escapeHtml(pnCase.first_name)} ${this.escapeHtml(pnCase.last_name)}</h5>
                                <small class="text-muted">HN: ${this.escapeHtml(pnCase.hn || 'N/A')}</small>
                            </div>
                        </div>
                        <div class="text-end">
                            ${this.getStatusBadge(pnCase.status)}
                            <div class="small text-muted mt-2">
                                <div><i class="bi bi-calendar me-1"></i>${this.formatDate(pnCase.created_at)}</div>
                                <div><i class="bi bi-clock me-1"></i>${this.formatTime(pnCase.created_at)}</div>
                            </div>
                        </div>
                    </div>
                    <div class="row g-3 mb-3">
                        <div class="col-md-12">
                            <div class="small text-muted">Diagnosis</div>
                            <div class="fw-semibold">${this.escapeHtml(pnCase.diagnosis)}</div>
                        </div>
                        <div class="col-md-12">
                            <div class="small text-muted"><i class="bi bi-building me-1"></i>Clinic</div>
                            <div>${this.escapeHtml(pnCase.source_clinic_name || 'N/A')}</div>
                        </div>
                        ${pnCase.purpose ? `
                        <div class="col-md-12">
                            <div class="small text-muted">Purpose</div>
                            <div class="text-truncate">${this.truncate(this.escapeHtml(pnCase.purpose), 100)}</div>
                        </div>
                        ` : ''}
                    </div>
                    <div class="quick-actions">
                        <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); viewPNCase(${pnCase.id})">
                            <i class="bi bi-eye me-1"></i>View Details
                        </button>
                        ${pnCase.bill_id ? `
                            <button class="btn btn-sm btn-success" onclick="event.stopPropagation(); viewBill(${pnCase.bill_id})">
                                <i class="bi bi-receipt me-1"></i>View Bill
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    },

    renderPagination() {
        const pagination = document.getElementById('pagination');

        if (this.totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }

        let pages = '';

        // Previous button
        pages += `
            <li class="page-item ${this.currentPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="PNLogsManager.goToPage(${this.currentPage - 1}); return false;">
                    <i class="bi bi-chevron-left"></i>
                </a>
            </li>
        `;

        // Page numbers
        const startPage = Math.max(1, this.currentPage - 2);
        const endPage = Math.min(this.totalPages, this.currentPage + 2);

        if (startPage > 1) {
            pages += `
                <li class="page-item">
                    <a class="page-link" href="#" onclick="PNLogsManager.goToPage(1); return false;">1</a>
                </li>
            `;
            if (startPage > 2) {
                pages += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            pages += `
                <li class="page-item ${i === this.currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="PNLogsManager.goToPage(${i}); return false;">${i}</a>
                </li>
            `;
        }

        if (endPage < this.totalPages) {
            if (endPage < this.totalPages - 1) {
                pages += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
            pages += `
                <li class="page-item">
                    <a class="page-link" href="#" onclick="PNLogsManager.goToPage(${this.totalPages}); return false;">${this.totalPages}</a>
                </li>
            `;
        }

        // Next button
        pages += `
            <li class="page-item ${this.currentPage === this.totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="PNLogsManager.goToPage(${this.currentPage + 1}); return false;">
                    <i class="bi bi-chevron-right"></i>
                </a>
            </li>
        `;

        pagination.innerHTML = pages;
    },

    updateRecordInfo() {
        const from = (this.currentPage - 1) * this.perPage + 1;
        const to = Math.min(this.currentPage * this.perPage, this.totalRecords);

        document.getElementById('showing-from').textContent = this.totalRecords > 0 ? from : 0;
        document.getElementById('showing-to').textContent = to;
        document.getElementById('total-records').textContent = this.totalRecords;
    },

    goToPage(page) {
        if (page < 1 || page > this.totalPages) return;
        this.currentPage = page;
        this.loadLogs();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    getStatusBadge(status) {
        const statusMap = {
            'PENDING': { class: 'pending', icon: 'clock-history', text: 'Pending' },
            'ACCEPTED': { class: 'accepted', icon: 'check-circle', text: 'Accepted' },
            'IN_PROGRESS': { class: 'in-progress', icon: 'arrow-repeat', text: 'In Progress' },
            'COMPLETED': { class: 'completed', icon: 'check-circle-fill', text: 'Completed' },
            'CANCELLED': { class: 'cancelled', icon: 'x-circle', text: 'Cancelled' }
        };

        const config = statusMap[status] || { class: 'secondary', icon: 'question-circle', text: status };

        return `
            <span class="status-badge ${config.class}">
                <i class="bi bi-${config.icon}"></i>
                ${config.text}
            </span>
        `;
    },

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    },

    formatTime(dateString) {
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    truncate(text, length) {
        if (!text) return '';
        return text.length > length ? text.substring(0, length) + '...' : text;
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    showLoading() {
        document.getElementById('loading-overlay').style.display = 'flex';
    },

    hideLoading() {
        document.getElementById('loading-overlay').style.display = 'none';
    },

    showError(message) {
        alert(message); // Replace with a better notification system if available
    }
};

// View switcher
function switchView(view) {
    PNLogsManager.currentView = view;

    const tableView = document.getElementById('table-view');
    const timelineView = document.getElementById('timeline-view');
    const tableBtn = document.getElementById('btn-table-view');
    const timelineBtn = document.getElementById('btn-timeline-view');

    if (view === 'table') {
        tableView.style.display = 'block';
        timelineView.style.display = 'none';
        tableBtn.classList.add('active');
        timelineBtn.classList.remove('active');
    } else {
        tableView.style.display = 'none';
        timelineView.style.display = 'block';
        tableBtn.classList.remove('active');
        timelineBtn.classList.add('active');
    }

    PNLogsManager.renderLogs();
}

// Change per page
function changePerPage() {
    PNLogsManager.perPage = parseInt(document.getElementById('per-page').value);
    PNLogsManager.currentPage = 1;
    PNLogsManager.loadLogs();
}

// Apply filters
function applyFilters() {
    PNLogsManager.currentPage = 1;
    PNLogsManager.loadLogs();
}

// View PN case details
function viewPNCase(id) {
    window.location.href = `/pn/${id}`;
}

// View bill details
function viewBill(billId) {
    window.location.href = `/bills?view=${billId}`;
}

// Export logs
async function exportLogs() {
    try {
        const params = new URLSearchParams({
            search: PNLogsManager.filters.search,
            status: PNLogsManager.filters.status,
            clinic_id: PNLogsManager.filters.clinic
        });

        if (PNLogsManager.filters.dateFrom) {
            params.append('date_from', PNLogsManager.filters.dateFrom);
        }
        if (PNLogsManager.filters.dateTo) {
            params.append('date_to', PNLogsManager.filters.dateTo);
        }

        window.location.href = `/api/pn/export?${params}&token=${token}`;
    } catch (error) {
        console.error('Export error:', error);
        alert('Failed to export logs');
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    PNLogsManager.init();
});