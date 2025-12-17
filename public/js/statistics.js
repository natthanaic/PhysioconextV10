// Statistics Dashboard - RehabPlus V8

const StatisticsManager = {
    summary: null,
    clinicStats: [],

    async init() {
        console.log('[StatisticsManager] Initializing...');
        // Note: Authentication now handled via httpOnly cookies (can't be read by JavaScript)
        // The global fetch wrapper automatically sends credentials with requests
        await this.loadStatistics();
        this.setupEventListeners();
    },

    setupEventListeners() {
        document.getElementById('btn-refresh-stats')?.addEventListener('click', () => this.loadStatistics());
        document.getElementById('btn-export-csv')?.addEventListener('click', () => this.exportToCSV());
        document.getElementById('filter-date-from')?.addEventListener('change', () => this.loadStatistics());
        document.getElementById('filter-date-to')?.addEventListener('change', () => this.loadStatistics());
    },

    async loadStatistics() {
        console.log('[loadStatistics] Starting to load all statistics sections...');

        // Load each section independently so one failure doesn't break all
        try {
            console.log('[loadStatistics] Loading summary...');
            await this.loadSummary();
            console.log('[loadStatistics] Summary loaded successfully');
        } catch (error) {
            console.error('[loadStatistics] Load summary failed:', error);
        }

        try {
            console.log('[loadStatistics] Loading clinic stats...');
            await this.loadClinicStats();
            console.log('[loadStatistics] Clinic stats loaded successfully');
        } catch (error) {
            console.error('[loadStatistics] Load clinic stats failed:', error);
        }

        try {
            console.log('[loadStatistics] Loading detailed bills...');
            await this.loadDetailedBills();
            console.log('[loadStatistics] Detailed bills loaded successfully');
        } catch (error) {
            console.error('[loadStatistics] Load detailed bills failed:', error);
        }

        try {
            console.log('[loadStatistics] Loading service ranking...');
            await this.loadServiceRanking();
            console.log('[loadStatistics] Service ranking loaded successfully');
        } catch (error) {
            console.error('[loadStatistics] Load service ranking failed:', error);
        }

        console.log('[loadStatistics] All sections loading complete');
    },

    async loadSummary() {
        try {
            const dateFrom = document.getElementById('filter-date-from')?.value;
            const dateTo = document.getElementById('filter-date-to')?.value;

            const params = new URLSearchParams();
            if (dateFrom) params.append('date_from', dateFrom);
            if (dateTo) params.append('date_to', dateTo);

            const response = await fetch(`/api/statistics/bills/summary?${params}`, {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load summary');

            this.summary = await response.json();
            this.renderSummary();
        } catch (error) {
            console.error('Load summary error:', error);
            throw error;
        }
    },

    renderSummary() {
        if (!this.summary) return;

        document.getElementById('stat-total-bills').textContent = this.summary.total_bills || 0;
        document.getElementById('stat-total-revenue').textContent = `฿${parseFloat(this.summary.total_revenue || 0).toFixed(2)}`;
        document.getElementById('stat-collected-revenue').textContent = `฿${parseFloat(this.summary.collected_revenue || 0).toFixed(2)}`;
        document.getElementById('stat-outstanding-revenue').textContent = `฿${parseFloat(this.summary.outstanding_revenue || 0).toFixed(2)}`;

        // Calculate collection rate
        const collectionRate = this.summary.total_revenue > 0
            ? (this.summary.collected_revenue / this.summary.total_revenue * 100).toFixed(1)
            : 0;

        const collectionRateElement = document.getElementById('stat-collection-rate');
        if (collectionRateElement) {
            collectionRateElement.textContent = `${collectionRate}%`;
            collectionRateElement.className = `text-${collectionRate >= 80 ? 'success' : collectionRate >= 50 ? 'warning' : 'danger'}`;
        }
    },

    async loadClinicStats() {
        try {
            const response = await fetch('/api/statistics/bills/by-clinic', {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load clinic statistics');

            this.clinicStats = await response.json();
            this.renderClinicStats();
            this.renderChart();
        } catch (error) {
            console.error('Load clinic stats error:', error);
            throw error;
        }
    },

    renderClinicStats() {
        const tbody = document.getElementById('clinic-stats-table-body');
        if (!tbody) return;

        if (this.clinicStats.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">No data available</td></tr>';
            return;
        }

        tbody.innerHTML = this.clinicStats.map(clinic => `
            <tr>
                <td>${clinic.clinic_name}</td>
                <td>${clinic.total_bills || 0}</td>
                <td class="text-right">฿${parseFloat(clinic.total_revenue || 0).toFixed(2)}</td>
                <td class="text-right">฿${parseFloat(clinic.collected_revenue || 0).toFixed(2)}</td>
            </tr>
        `).join('');

        // Add total row
        const totalBills = this.clinicStats.reduce((sum, c) => sum + (parseInt(c.total_bills) || 0), 0);
        const totalRevenue = this.clinicStats.reduce((sum, c) => sum + (parseFloat(c.total_revenue) || 0), 0);
        const totalCollected = this.clinicStats.reduce((sum, c) => sum + (parseFloat(c.collected_revenue) || 0), 0);

        tbody.innerHTML += `
            <tr class="font-weight-bold bg-light">
                <td>TOTAL</td>
                <td>${totalBills}</td>
                <td class="text-right">฿${totalRevenue.toFixed(2)}</td>
                <td class="text-right">฿${totalCollected.toFixed(2)}</td>
            </tr>
        `;
    },

    renderChart() {
        const canvas = document.getElementById('revenueChart');
        if (!canvas || this.clinicStats.length === 0) return;

        // Simple bar chart using canvas
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const padding = 40;
        const chartWidth = width - padding * 2;
        const chartHeight = height - padding * 2;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Get max revenue for scaling
        const maxRevenue = Math.max(...this.clinicStats.map(c => parseFloat(c.total_revenue || 0)));

        // Draw bars
        const barWidth = chartWidth / this.clinicStats.length - 10;
        this.clinicStats.forEach((clinic, index) => {
            const revenue = parseFloat(clinic.total_revenue || 0);
            const barHeight = (revenue / maxRevenue) * chartHeight;
            const x = padding + index * (barWidth + 10);
            const y = height - padding - barHeight;

            // Draw bar
            ctx.fillStyle = '#007bff';
            ctx.fillRect(x, y, barWidth, barHeight);

            // Draw clinic name
            ctx.save();
            ctx.translate(x + barWidth / 2, height - padding + 10);
            ctx.rotate(-Math.PI / 4);
            ctx.fillStyle = '#000';
            ctx.font = '10px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(clinic.clinic_name.substring(0, 15), 0, 0);
            ctx.restore();

            // Draw value
            ctx.fillStyle = '#000';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`฿${revenue.toFixed(0)}`, x + barWidth / 2, y - 5);
        });

        // Draw axes
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, height - padding);
        ctx.lineTo(width - padding, height - padding);
        ctx.stroke();

        // Chart title
        ctx.fillStyle = '#000';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Revenue by Clinic', width / 2, 20);
    },

    async loadDetailedBills() {
        try {
            const dateFrom = document.getElementById('filter-date-from')?.value;
            const dateTo = document.getElementById('filter-date-to')?.value;

            const params = new URLSearchParams();
            if (dateFrom) params.append('date_from', dateFrom);
            if (dateTo) params.append('date_to', dateTo);
            params.append('limit', '50');

            console.log('Fetching detailed bills with URL:', `/api/statistics/bills/detailed?${params}`);

            const response = await fetch(`/api/statistics/bills/detailed?${params}`, {
                headers: {}
            });

            console.log('Detailed bills response status:', response.status);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Detailed bills error:', errorData);
                throw new Error(errorData.details || 'Failed to load detailed bills');
            }

            this.detailedBills = await response.json();
            console.log('Detailed bills loaded:', this.detailedBills.length, 'records');
            this.renderDetailedBills();
        } catch (error) {
            console.error('Load detailed bills error:', error);
            throw error;
        }
    },

    renderDetailedBills() {
        console.log('[renderDetailedBills] Called with data:', this.detailedBills);
        const tbody = document.getElementById('detailed-bills-table-body');
        console.log('[renderDetailedBills] Table body element found:', !!tbody);

        if (!tbody) {
            console.error('[renderDetailedBills] Table body element not found!');
            return;
        }

        if (!this.detailedBills || this.detailedBills.length === 0) {
            console.log('[renderDetailedBills] No data available, showing empty message');
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">No detailed bills data available</td></tr>';
            return;
        }

        console.log('[renderDetailedBills] Rendering', this.detailedBills.length, 'bills');
        tbody.innerHTML = this.detailedBills.map((bill, index) => {
            const statusBadge = this.getPaymentStatusBadge(bill.payment_status);
            const formattedDate = new Date(bill.bill_date).toLocaleDateString('en-GB');
            const services = bill.services || 'N/A';

            return `
                <tr>
                    <td>${index + 1}</td>
                    <td><strong>${bill.bill_code}</strong></td>
                    <td>${formattedDate}</td>
                    <td>${bill.patient_name}</td>
                    <td><span class="badge bg-secondary">${bill.hn}</span></td>
                    <td>${bill.clinic_name}</td>
                    <td><small>${services.substring(0, 50)}${services.length > 50 ? '...' : ''}</small></td>
                    <td class="text-end"><strong>฿${parseFloat(bill.total_amount).toFixed(2)}</strong></td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        }).join('');
    },

    async loadServiceRanking() {
        try {
            const dateFrom = document.getElementById('filter-date-from')?.value;
            const dateTo = document.getElementById('filter-date-to')?.value;

            const params = new URLSearchParams();
            if (dateFrom) params.append('date_from', dateFrom);
            if (dateTo) params.append('date_to', dateTo);
            params.append('limit', '10');

            console.log('Fetching service ranking with URL:', `/api/statistics/services/ranking?${params}`);

            const response = await fetch(`/api/statistics/services/ranking?${params}`, {
                headers: {}
            });

            console.log('Service ranking response status:', response.status);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Service ranking error:', errorData);
                throw new Error(errorData.details || 'Failed to load service ranking');
            }

            this.serviceRanking = await response.json();
            console.log('Service ranking loaded:', this.serviceRanking.length, 'records');
            this.renderServiceRanking();
        } catch (error) {
            console.error('Load service ranking error:', error);
            throw error;
        }
    },

    renderServiceRanking() {
        console.log('[renderServiceRanking] Called with data:', this.serviceRanking);
        const tbody = document.getElementById('service-ranking-table-body');
        console.log('[renderServiceRanking] Table body element found:', !!tbody);

        if (!tbody) {
            console.error('[renderServiceRanking] Table body element not found!');
            return;
        }

        if (!this.serviceRanking || this.serviceRanking.length === 0) {
            console.log('[renderServiceRanking] No data available, showing empty message');
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">No service ranking data available</td></tr>';
            return;
        }

        console.log('[renderServiceRanking] Rendering', this.serviceRanking.length, 'services');
        tbody.innerHTML = this.serviceRanking.map((service, index) => {
            const rankBadge = index < 3
                ? `<span class="badge bg-warning text-dark"><i class="bi bi-trophy-fill"></i> ${index + 1}</span>`
                : `<span class="badge bg-light text-dark">${index + 1}</span>`;

            return `
                <tr>
                    <td>${rankBadge}</td>
                    <td><strong>${service.service_name}</strong></td>
                    <td class="text-center">${service.usage_count}</td>
                    <td class="text-center">${service.total_quantity}</td>
                    <td class="text-end"><strong>฿${parseFloat(service.total_revenue || 0).toFixed(2)}</strong></td>
                </tr>
            `;
        }).join('');
    },

    getPaymentStatusBadge(status) {
        const statusMap = {
            'PAID': '<span class="badge bg-success">Paid</span>',
            'UNPAID': '<span class="badge bg-danger">Unpaid</span>',
            'PARTIAL': '<span class="badge bg-warning text-dark">Partial</span>',
            'CANCELLED': '<span class="badge bg-secondary">Cancelled</span>'
        };
        return statusMap[status] || `<span class="badge bg-secondary">${status}</span>`;
    },

    async exportToCSV() {
        try {
            // Prepare CSV data
            const headers = ['Clinic', 'Total Bills', 'Total Revenue', 'Collected Revenue', 'Outstanding Revenue'];
            const rows = this.clinicStats.map(clinic => [
                clinic.clinic_name,
                clinic.total_bills || 0,
                parseFloat(clinic.total_revenue || 0).toFixed(2),
                parseFloat(clinic.collected_revenue || 0).toFixed(2),
                (parseFloat(clinic.total_revenue || 0) - parseFloat(clinic.collected_revenue || 0)).toFixed(2)
            ]);

            // Add totals row
            const totalBills = this.clinicStats.reduce((sum, c) => sum + (parseInt(c.total_bills) || 0), 0);
            const totalRevenue = this.clinicStats.reduce((sum, c) => sum + (parseFloat(c.total_revenue) || 0), 0);
            const totalCollected = this.clinicStats.reduce((sum, c) => sum + (parseFloat(c.collected_revenue) || 0), 0);

            rows.push([
                'TOTAL',
                totalBills,
                totalRevenue.toFixed(2),
                totalCollected.toFixed(2),
                (totalRevenue - totalCollected).toFixed(2)
            ]);

            // Create CSV content
            let csvContent = headers.join(',') + '\n';
            rows.forEach(row => {
                csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
            });

            // Download CSV
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);

            link.setAttribute('href', url);
            link.setAttribute('download', `bills_statistics_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            this.showAlert('Statistics exported to CSV successfully!', 'success');
        } catch (error) {
            console.error('Export CSV error:', error);
            this.showAlert('Failed to export CSV', 'danger');
        }
    },

    showAlert(message, type = 'info') {
        const alertHtml = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="close" data-dismiss="alert">
                    <span>&times;</span>
                </button>
            </div>
        `;

        const container = document.getElementById('alerts-container') || document.body;
        const div = document.createElement('div');
        div.innerHTML = alertHtml;
        container.insertBefore(div.firstElementChild, container.firstChild);

        setTimeout(() => {
            div.firstElementChild?.remove();
        }, 5000);
    }
};

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    StatisticsManager.init();
});