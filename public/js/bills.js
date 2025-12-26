// Bills Management - RehabPlus V8

// Bills Manager
const BillsManager = {
    services: [],
    bills: [],
    currentBill: null,
    selectedPatient: null,
    billItems: [],
    currentPnCaseId: null,  // Store PN case ID for bill-PN linking
    pnBillItems: [],  // NEW: Separate items array for PN bill modal
    currentPNData: null,  // NEW: Store current PN case data

    async init() {
        // Set default date filters to this week
        this.setDefaultDateFilters();

        await this.loadClinics();
        await this.loadServices();
        await this.loadBills();
        await this.loadUnpaidBillsSummary();
        this.setupEventListeners();
        this.setupPNBillListeners();  // NEW: Setup PN bill listeners

        // Check URL parameters for auto-opening bill creation from PN
        this.checkURLParameters();
    },

    async loadUnpaidBillsSummary() {
        try {
            // Count unpaid bills from the loaded bills
            const unpaidBills = this.allBills.filter(bill => bill.payment_status === 'UNPAID');
            const unpaidCount = unpaidBills.length;
            const unpaidTotal = unpaidBills.reduce((sum, bill) => sum + parseFloat(bill.total_amount || 0), 0);

            document.getElementById('unpaid-bills-count').textContent = unpaidCount;
            document.getElementById('unpaid-bills-total').textContent = `฿${unpaidTotal.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
        } catch (error) {
            console.error('Load unpaid bills summary error:', error);
        }
    },

    // Get today's date in YYYY-MM-DD format (local timezone, not UTC)
    getTodayDate() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    // Format date to DD/MM/YYYY (Thai format)
    formatDate(dateString) {
        if (!dateString) return 'N/A';

        try {
            // Extract just the date part if it's an ISO string with time
            // "2025-11-16T17:00:00.000Z" -> "2025-11-16"
            let datePart = dateString;
            if (dateString.includes('T')) {
                datePart = dateString.split('T')[0];
            }

            // Parse as local date (YYYY-MM-DD format)
            const [year, month, day] = datePart.split('-');

            if (!year || !month || !day) return dateString;

            // Return in DD/MM/YYYY format
            return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
        } catch (error) {
            console.error('Date formatting error:', error);
            return dateString;
        }
    },

    // Set default date filters to show this week
    setDefaultDateFilters() {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

        // Calculate start of week (Monday)
        const startOfWeek = new Date(today);
        const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when day is Sunday
        startOfWeek.setDate(diff);
        startOfWeek.setHours(0, 0, 0, 0);

        // Calculate end of week (Sunday)
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        // Format dates as YYYY-MM-DD
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // Set the date inputs
        const dateFromInput = document.getElementById('filter-date-from');
        const dateToInput = document.getElementById('filter-date-to');

        if (dateFromInput) dateFromInput.value = formatDate(startOfWeek);
        if (dateToInput) dateToInput.value = formatDate(endOfWeek);

        console.log('Default date filters set to this week:', formatDate(startOfWeek), 'to', formatDate(endOfWeek));
    },

    // Check URL parameters to auto-open bill creation modal
    async checkURLParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const pnCaseId = urlParams.get('pn_case_id');
        const patientId = urlParams.get('patient_id');
        const clinicId = urlParams.get('clinic_id');
        const viewBillId = urlParams.get('view');
        const editBillId = urlParams.get('edit');

        // If pn_case_id present, open SIMPLIFIED PN bill creation modal
        if (pnCaseId && patientId && clinicId) {
            // Wait a bit for everything to load, then open modal
            setTimeout(async () => {
                await this.showPNBillModal(parseInt(pnCaseId));  // Use new simplified modal
                // Clean URL after opening modal
                window.history.replaceState({}, document.title, '/bills');
            }, 500);
        }

        // If view parameter present, open bill details
        if (viewBillId) {
            setTimeout(() => {
                this.viewBill(parseInt(viewBillId));
                // Clean URL after opening modal
                window.history.replaceState({}, document.title, '/bills');
            }, 500);
        }

        // If edit parameter present, open bill edit modal
        if (editBillId) {
            setTimeout(() => {
                this.editBill(parseInt(editBillId));
                // Clean URL after opening modal
                window.history.replaceState({}, document.title, '/bills');
            }, 500);
        }
    },

    async loadClinics() {
        try {
            const response = await fetch('/api/clinics', {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load clinics');

            const clinics = await response.json();

            // Populate clinic dropdowns
            const clinicSelects = [document.getElementById('bill-clinic'), document.getElementById('filter-clinic')];
            clinicSelects.forEach(select => {
                if (!select) return;

                select.innerHTML = '<option value="">All Clinics</option>';
                clinics.forEach(clinic => {
                    const option = document.createElement('option');
                    option.value = clinic.id;
                    option.textContent = clinic.name;
                    select.appendChild(option);
                });

                // If user has a clinic_id, pre-select it for bill-clinic
                if (select.id === 'bill-clinic') {
                    const userClinicId = document.getElementById('user-clinic-id')?.value;
                    const userRole = document.getElementById('user-role')?.value;
                    if (userClinicId && (userRole === 'CLINIC' || userRole === 'PT')) {
                        select.value = userClinicId;
                        if (userRole === 'CLINIC') {
                            select.disabled = true; // Clinic users can only create bills for their own clinic
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Load clinics error:', error);
            this.showAlert('Failed to load clinics', 'danger');
        }
    },

    setupEventListeners() {
        // Create bill button
        document.getElementById('btn-create-bill')?.addEventListener('click', async () => await this.showCreateBillModal());

        // Search/filter - use frontend filtering (no API call needed)
        document.getElementById('btn-search-bills')?.addEventListener('click', () => this.applyFilters());
        document.getElementById('filter-bill-code')?.addEventListener('input', () => this.applyFilters());
        document.getElementById('filter-clinic')?.addEventListener('change', () => this.applyFilters());
        document.getElementById('filter-status')?.addEventListener('change', () => this.applyFilters());

        // Add item button
        document.getElementById('btn-add-bill-item')?.addEventListener('click', () => this.addBillItem());

        // Save bill button - Note: onclick handler set dynamically in showCreateBillModal() or editBill()
        // Don't use addEventListener here as it can't be easily removed/changed

        // Patient selection
        document.getElementById('bill-patient-search')?.addEventListener('input', (e) => this.searchPatients(e.target.value));

        // Recalculate totals when discount or tax changes
        document.getElementById('bill-discount')?.addEventListener('input', () => this.updateBillTotals());
        document.getElementById('bill-tax')?.addEventListener('input', () => this.updateBillTotals());

        // Reload services when clinic is selected (to get clinic-specific services)
        document.getElementById('bill-clinic')?.addEventListener('change', (e) => {
            const clinicId = e.target.value;
            if (clinicId) {
                this.loadServices(clinicId);
            }
        });
    },

    async loadServices(clinicId = null) {
        try {
            const params = new URLSearchParams();
            if (clinicId) {
                params.append('clinic_id', clinicId);
            }

            const response = await fetch(`/api/bills/services?${params}`, {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load services');

            this.services = await response.json();
            this.renderServiceOptions();
        } catch (error) {
            console.error('Load services error:', error);
            this.showAlert('Failed to load services', 'danger');
        }
    },

    renderServiceOptions() {
        const select = document.getElementById('bill-item-service');
        if (!select) return;

        select.innerHTML = '<option value="">Select Service</option>';
        this.services.forEach(service => {
            const option = document.createElement('option');
            option.value = service.id;
            // Use clinic-specific price if available, otherwise use default price
            const displayPrice = service.price || service.default_price;
            option.textContent = `${service.service_code} - ${service.service_name} (฿${displayPrice})`;
            option.dataset.price = displayPrice;
            option.dataset.name = service.service_name;
            select.appendChild(option);
        });
    },

    async loadBills(forceReload = false) {
        try {
            // Only fetch from API if bills haven't been loaded or forceReload is true
            if (!this.allBills || forceReload) {
                // Only send clinic_id filter to backend (for role-based filtering)
                const userClinicId = document.getElementById('user-clinic-id')?.value;
                const userRole = document.getElementById('user-role')?.value;
                const params = new URLSearchParams();

                // For CLINIC role, only load their clinic's bills
                if (userRole === 'CLINIC' && userClinicId) {
                    params.append('clinic_id', userClinicId);
                }

                // Add cache-busting timestamp to ensure fresh data
                if (forceReload) {
                    params.append('_t', Date.now());
                }

                const response = await fetch(`/api/bills?${params}`, {
                    headers: {
                        'Cache-Control': 'no-cache'
                    }
                });

                if (!response.ok) throw new Error('Failed to load bills');

                this.allBills = await response.json();
            }

            // Apply frontend filters
            this.bills = this.filterBills();
            this.renderBillsTable();
        } catch (error) {
            console.error('Load bills error:', error);
            this.showAlert('Failed to load bills', 'danger');
        }
    },

    applyFilters() {
        // Apply filters without making API call
        this.bills = this.filterBills();
        this.renderBillsTable();
    },

    filterBills() {
        const billCode = document.getElementById('filter-bill-code')?.value?.trim().toLowerCase();
        const clinicId = document.getElementById('filter-clinic')?.value;
        const status = document.getElementById('filter-status')?.value;
        const dateFrom = document.getElementById('filter-date-from')?.value;
        const dateTo = document.getElementById('filter-date-to')?.value;

        return this.allBills.filter(bill => {
            // Bill code filter (partial match, case-insensitive)
            if (billCode && !bill.bill_code.toLowerCase().includes(billCode)) {
                return false;
            }

            // Clinic filter
            if (clinicId && bill.clinic_id != clinicId) {
                return false;
            }

            // Status filter
            if (status && bill.payment_status !== status) {
                return false;
            }

            // Date from filter - extract date part for comparison
            if (dateFrom) {
                const billDate = bill.bill_date ? bill.bill_date.split('T')[0] : '';
                if (billDate < dateFrom) {
                    return false;
                }
            }

            // Date to filter - extract date part for comparison
            if (dateTo) {
                const billDate = bill.bill_date ? bill.bill_date.split('T')[0] : '';
                if (billDate > dateTo) {
                    return false;
                }
            }

            return true;
        });
    },

    renderBillsTable() {
        const tbody = document.getElementById('bills-table-body');
        if (!tbody) return;

        const userRole = document.getElementById('user-role')?.value;

        if (this.bills.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">No bills found</td></tr>';
            return;
        }

        // Sort bills by ID in descending order (newest first)
        const sortedBills = [...this.bills].sort((a, b) => b.id - a.id);

        console.log('Rendering bills table. First bill date:', sortedBills[0]?.bill_date);

        tbody.innerHTML = sortedBills.map(bill => {
            // Role-based action buttons
            let actions = '';

            // Payment status dropdown - PT and ADMIN can update
            const statusOptions = [
                { value: 'UNPAID', label: 'Unpaid', class: 'danger' },
                { value: 'PAID', label: 'Paid', class: 'success' },
                { value: 'PARTIAL', label: 'Partial', class: 'warning' },
                { value: 'CANCELLED', label: 'Cancelled', class: 'secondary' }
            ];

            // View Details button - All roles can view
            actions += `
                <button class="btn btn-sm btn-info me-1" onclick="BillsManager.viewBill(${bill.id})" title="View Details">
                    <i class="bi bi-eye"></i>
                </button>
            `;

            // Print button - All roles can print
            actions += `
                <button class="btn btn-sm btn-secondary me-1" onclick="BillsManager.printBill(${bill.id})" title="Print Bill">
                    <i class="bi bi-printer"></i>
                </button>
            `;

            // Payment status dropdown - All roles can update
            actions += `
                <select class="form-select form-select-sm d-inline-block w-auto me-1"
                        onchange="BillsManager.updatePaymentStatus(${bill.id}, this.value)"
                        style="font-size: 0.875rem;">
                    ${statusOptions.map(opt => `
                        <option value="${opt.value}" ${bill.payment_status === opt.value ? 'selected' : ''}>
                            ${opt.label}
                        </option>
                    `).join('')}
                </select>
            `;

            // ADMIN gets Edit and Delete buttons
            if (userRole === 'ADMIN') {
                actions += `
                    <button class="btn btn-sm btn-warning me-1" onclick="BillsManager.editBill(${bill.id})" title="Edit Bill">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="BillsManager.deleteBill(${bill.id}, '${bill.bill_code}')" title="Delete Bill">
                        <i class="bi bi-trash"></i>
                    </button>
                `;
            }

            return `
                <tr>
                    <td>${bill.bill_code}</td>
                    <td>${bill.patient_name || bill.walk_in_name || 'N/A'}</td>
                    <td>${bill.clinic_name}</td>
                    <td>${this.formatDate(bill.bill_date)}</td>
                    <td class="text-right">฿${parseFloat(bill.total_amount).toFixed(2)}</td>
                    <td>
                        <span class="badge badge-${this.getStatusBadgeClass(bill.payment_status)}">
                            ${bill.payment_status}
                        </span>
                    </td>
                    <td>${actions}</td>
                </tr>
            `;
        }).join('');
    },

    getStatusBadgeClass(status) {
        const classes = {
            'PAID': 'success',
            'UNPAID': 'danger',
            'PARTIAL': 'warning',
            'CANCELLED': 'secondary'
        };
        return classes[status] || 'secondary';
    },

    async showCreateBillModal(pnCaseId = null, patientId = null, clinicId = null) {
        this.billItems = [];
        this.selectedPatient = null;
        this.currentPnCaseId = pnCaseId;  // NEW: Store PN case ID if provided

        // Reset form
        document.getElementById('bill-patient-id').value = '';
        document.getElementById('bill-patient-name').value = '';
        document.getElementById('bill-walk-in-name').value = '';
        document.getElementById('bill-walk-in-phone').value = '';
        document.getElementById('bill-date').value = this.getTodayDate();
        document.getElementById('bill-discount').value = '0';
        document.getElementById('bill-tax').value = '0';
        document.getElementById('bill-notes').value = '';
        document.getElementById('bill-items-container').innerHTML = '';
        document.getElementById('patient-courses-info').innerHTML = '';
        document.getElementById('bill-payment-method').value = '';

        // NEW: Load patient data FIRST if creating bill from PN case
        if (pnCaseId && patientId) {
            await this.loadPatientAndPNForBill(pnCaseId, patientId);
        }

        // Set clinic selection based on user role or provided clinicId
        const clinicSelect = document.getElementById('bill-clinic');
        const userClinicId = document.getElementById('user-clinic-id')?.value;
        const userRole = document.getElementById('user-role')?.value;

        if (clinicSelect) {
            // NEW: If clinic provided (from PN), use it
            if (clinicId) {
                clinicSelect.value = clinicId;
                this.loadServices(clinicId);
            } else if (userClinicId && (userRole === 'CLINIC' || userRole === 'PT')) {
                // Pre-select user's clinic for PT/CLINIC users
                clinicSelect.value = userClinicId;
                if (userRole === 'CLINIC') {
                    clinicSelect.disabled = true; // CLINIC users can only bill for their clinic
                }
                // Load services for this clinic
                this.loadServices(userClinicId);
            } else {
                // Reset for ADMIN users
                clinicSelect.value = '';
                clinicSelect.disabled = false;
                // Clear services until clinic is selected
                this.services = [];
                this.renderServiceOptions();
            }
        }

        this.updateBillTotals();

        // Reset save button to create mode (in case it was in edit mode)
        const saveBtn = document.getElementById('btn-save-bill');
        if (saveBtn) {
            saveBtn.textContent = 'Save Bill';
            saveBtn.onclick = () => this.saveBill();
        }

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('createBillModal'));
        modal.show();

        // Add focus management for accessibility
        if (window.A11y && window.A11y.manageFocusForModal) {
            window.A11y.manageFocusForModal(document.getElementById('createBillModal'), document.activeElement);
        }
    },

    // NEW: Load patient AND PN information for bill creation
    async loadPatientAndPNForBill(pnCaseId, patientId) {
        try {
            // Load patient info
            const patientResponse = await fetch(`/api/patients/${patientId}`, {
                headers: {}
            });

            if (!patientResponse.ok) throw new Error('Failed to load patient');
            const patient = await patientResponse.json();

            // Load PN info
            const pnResponse = await fetch(`/api/pn/${pnCaseId}`, {
                headers: {}
            });

            if (!pnResponse.ok) throw new Error('Failed to load PN case');
            const pnCase = await pnResponse.json();

            // Fill patient info
            this.selectPatient(patient.id, `${patient.first_name} ${patient.last_name}`);

            // Show PN connection info
            const pnInfoHtml = `
                <div class="alert alert-success mb-3" style="border-left: 4px solid #28a745;">
                    <h6><i class="bi bi-link-45deg me-2"></i>Creating Bill for PN Case</h6>
                    <p class="mb-1"><strong>PN Code:</strong> ${pnCase.pn_code || 'N/A'}</p>
                    <p class="mb-1"><strong>Diagnosis:</strong> ${pnCase.diagnosis || 'N/A'}</p>
                    <p class="mb-1"><strong>Purpose:</strong> ${pnCase.purpose || 'N/A'}</p>
                    <p class="mb-0"><strong>Patient:</strong> ${patient.first_name} ${patient.last_name} (HN: ${patient.hn || 'N/A'})</p>
                    <small class="text-muted">This bill will be linked to the PN case above.</small>
                </div>
            `;

            const coursesInfo = document.getElementById('patient-courses-info');
            if (coursesInfo) {
                coursesInfo.innerHTML = pnInfoHtml;
            }

        } catch (error) {
            console.error('Load patient/PN error:', error);
            this.showAlert('Failed to load patient or PN information', 'warning');
        }
    },

    async searchPatients(query) {
        if (query.length < 2) return;

        try {
            const response = await fetch(`/api/patients/search?q=${encodeURIComponent(query)}`, {
                headers: {}
            });

            const patients = await response.json();
            this.renderPatientSearchResults(patients);
        } catch (error) {
            console.error('Patient search error:', error);
        }
    },

    renderPatientSearchResults(patients) {
        const container = document.getElementById('patient-search-results');
        if (!container) return;

        if (patients.length === 0) {
            container.innerHTML = '<div class="list-group-item">No patients found</div>';
            return;
        }

        container.innerHTML = patients.map(p => `
            <button type="button" class="list-group-item list-group-item-action"
                    onclick="BillsManager.selectPatient(${p.id}, '${p.first_name} ${p.last_name}')">
                ${p.first_name} ${p.last_name} - ${p.patient_number}
            </button>
        `).join('');
    },

    selectPatient(patientId, patientName) {
        this.selectedPatient = { id: patientId, name: patientName };
        document.getElementById('bill-patient-id').value = patientId;
        document.getElementById('bill-patient-name').value = patientName;
        document.getElementById('patient-search-results').innerHTML = '';
        document.getElementById('bill-patient-search').value = '';

        // Clear courses info (not used - course cutting handled separately)
        const coursesInfo = document.getElementById('patient-courses-info');
        if (coursesInfo) coursesInfo.innerHTML = '';
    },

    addBillItem() {
        const serviceSelect = document.getElementById('bill-item-service');
        const quantityInput = document.getElementById('bill-item-quantity');
        const discountInput = document.getElementById('bill-item-discount');

        const serviceId = serviceSelect.value;
        const serviceName = serviceSelect.options[serviceSelect.selectedIndex]?.dataset.name || '';
        const unitPrice = parseFloat(serviceSelect.options[serviceSelect.selectedIndex]?.dataset.price || 0);
        const quantity = parseInt(quantityInput.value) || 1;
        const discount = parseFloat(discountInput.value) || 0;

        if (!serviceId) {
            this.showAlert('Please select a service', 'warning');
            return;
        }

        const item = {
            service_id: parseInt(serviceId),
            service_name: serviceName,
            quantity,
            unit_price: unitPrice,
            discount,
            total_price: (quantity * unitPrice) - discount,
            notes: null  // Explicitly set notes to null
        };

        this.billItems.push(item);
        this.renderBillItems();
        this.updateBillTotals();

        // Reset inputs
        serviceSelect.value = '';
        quantityInput.value = '1';
        discountInput.value = '0';
    },

    renderBillItems() {
        const container = document.getElementById('bill-items-container');
        if (!container) return;

        if (this.billItems.length === 0) {
            container.innerHTML = '<p class="text-muted">No items added</p>';
            return;
        }

        container.innerHTML = `
            <table class="table table-sm">
                <thead>
                    <tr>
                        <th>Service</th>
                        <th>Qty</th>
                        <th>Price</th>
                        <th>Discount</th>
                        <th>Total</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${this.billItems.map((item, index) => `
                        <tr>
                            <td>${item.service_name}</td>
                            <td>${item.quantity}</td>
                            <td>฿${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                            <td>฿${parseFloat(item.discount || 0).toFixed(2)}</td>
                            <td>฿${parseFloat(item.total_price || 0).toFixed(2)}</td>
                            <td>
                                <button type="button" class="btn btn-sm btn-danger"
                                        onclick="BillsManager.removeBillItem(${index})">
                                    <i class="fas fa-times"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    },

    removeBillItem(index) {
        this.billItems.splice(index, 1);
        this.renderBillItems();
        this.updateBillTotals();
    },

    updateBillTotals() {
        const subtotal = this.billItems.reduce((sum, item) => sum + item.total_price, 0);
        const discount = parseFloat(document.getElementById('bill-discount')?.value || 0);
        const tax = parseFloat(document.getElementById('bill-tax')?.value || 0);
        const total = subtotal - discount + tax;

        document.getElementById('bill-subtotal').textContent = `฿${subtotal.toFixed(2)}`;
        document.getElementById('bill-total').textContent = `฿${total.toFixed(2)}`;
    },

    async saveBill() {
        if (this.billItems.length === 0) {
            this.showAlert('Please add at least one item', 'warning');
            return;
        }

        const patientId = document.getElementById('bill-patient-id').value;
        const walkInName = document.getElementById('bill-walk-in-name').value;
        const walkInPhone = document.getElementById('bill-walk-in-phone').value;

        if (!patientId && !walkInName) {
            this.showAlert('Please select a patient or enter walk-in details', 'warning');
            return;
        }

        const clinicIdValue = document.getElementById('bill-clinic')?.value;
        const paymentMethodValue = document.getElementById('bill-payment-method')?.value;
        const billNotesValue = document.getElementById('bill-notes')?.value;
        const billDateValue = document.getElementById('bill-date')?.value;

        if (!clinicIdValue) {
            this.showAlert('Please select a clinic', 'warning');
            return;
        }

        const billData = {
            patient_id: patientId || null,
            walk_in_name: walkInName || null,
            walk_in_phone: walkInPhone || null,
            clinic_id: parseInt(clinicIdValue),
            bill_date: billDateValue || this.getTodayDate(),
            items: this.billItems,
            discount: parseFloat(document.getElementById('bill-discount')?.value) || 0,
            tax: parseFloat(document.getElementById('bill-tax')?.value) || 0,
            bill_notes: billNotesValue || null,
            payment_method: paymentMethodValue || null,
            payment_notes: null,
            appointment_id: null,
            pn_case_id: this.currentPnCaseId || null  // NEW: Include PN case ID if present
            // Note: Course cutting is handled separately through Appointments/PN Cases
            // Bills are for standard service payments only
        };

        try {
            const response = await fetch('/api/bills', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(billData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create bill');
            }

            const result = await response.json();
            this.showAlert(`Bill ${result.bill_code} created successfully!`, 'success');
            const modalEl = document.getElementById('createBillModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
            await this.loadBills(true);  // Force reload from API to get new bill
            await this.loadUnpaidBillsSummary();
        } catch (error) {
            console.error('Save bill error:', error);
            this.showAlert(error.message, 'danger');
        }
    },

    async viewBill(billId) {
        try {
            const response = await fetch(`/api/bills/${billId}`, {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load bill');

            const bill = await response.json();
            this.currentBill = bill;
            this.showBillDetails(bill);
        } catch (error) {
            console.error('View bill error:', error);
            this.showAlert('Failed to load bill details', 'danger');
        }
    },

    showBillDetails(bill) {
        // Ensure items is an array
        const items = Array.isArray(bill.items) ? bill.items : [];

        const detailsHtml = `
            <div class="bill-details">
                <h5>Bill: ${bill.bill_code || 'N/A'}</h5>
                ${bill.pn_number ? `
                    <div class="alert alert-info mb-3">
                        <i class="bi bi-link-45deg me-2"></i>
                        <strong>Connected to PN:</strong> ${bill.pn_number}
                        <br><small>Purpose: ${bill.pn_purpose || 'N/A'}</small>
                        <br><small>Status: ${bill.pn_status || 'N/A'}</small>
                    </div>
                ` : ''}
                <p><strong>Patient:</strong> ${bill.patient_name || bill.walk_in_name || 'N/A'}</p>
                <p><strong>Clinic:</strong> ${bill.clinic_name || 'N/A'}</p>
                <p><strong>Date:</strong> ${this.formatDate(bill.bill_date)}</p>
                <p><strong>Status:</strong> <span class="badge badge-${this.getStatusBadgeClass(bill.payment_status)}">${bill.payment_status || 'UNPAID'}</span></p>

                <h6>Items:</h6>
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Service</th>
                            <th>Qty</th>
                            <th>Price</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.length > 0 ? items.map(item => `
                            <tr>
                                <td>${item.service_name || 'N/A'}</td>
                                <td>${item.quantity || 0}</td>
                                <td>฿${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                                <td>฿${parseFloat(item.total_price || 0).toFixed(2)}</td>
                            </tr>
                        `).join('') : '<tr><td colspan="4" class="text-center">No items</td></tr>'}
                    </tbody>
                </table>

                <div class="text-end">
                    <p><strong>Subtotal:</strong> ฿${parseFloat(bill.subtotal || 0).toFixed(2)}</p>
                    <p><strong>Discount:</strong> ฿${parseFloat(bill.discount || 0).toFixed(2)}</p>
                    <p><strong>Tax:</strong> ฿${parseFloat(bill.tax || 0).toFixed(2)}</p>
                    <h5><strong>Total:</strong> ฿${parseFloat(bill.total_amount || 0).toFixed(2)}</h5>
                </div>
            </div>
        `;

        document.getElementById('bill-details-content').innerHTML = detailsHtml;
        const modal = new bootstrap.Modal(document.getElementById('viewBillModal'));
        modal.show();

        // Add focus management for accessibility
        if (window.A11y && window.A11y.manageFocusForModal) {
            window.A11y.manageFocusForModal(document.getElementById('viewBillModal'), document.activeElement);
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
        const alertElement = div.firstElementChild;
        container.insertBefore(alertElement, container.firstChild);

        setTimeout(() => {
            alertElement?.remove();
        }, 3000);  // Auto-dismiss after 3 seconds
    },

    async updatePaymentStatus(billId, newStatus) {
        try {
            const response = await fetch(`/api/bills/${billId}/payment-status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ payment_status: newStatus })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update payment status');
            }

            // Wait for bills to reload before showing success
            await this.loadBills(true);  // Reload bills to show updated status
            await this.loadUnpaidBillsSummary();
            this.showAlert(`Payment status updated to ${newStatus}`, 'success');
        } catch (error) {
            console.error('Update payment status error:', error);
            this.showAlert(error.message, 'danger');
            this.loadBills(true);  // Reload to revert dropdown
        }
    },

    async editBill(billId) {
        try {
            // Load bill details
            const response = await fetch(`/api/bills/${billId}`, {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load bill');

            const bill = await response.json();

            // Populate edit modal (reuse create modal)
            this.currentBill = bill;
            // Convert database string values to numbers
            this.billItems = (bill.items || []).map(item => ({
                ...item,
                quantity: parseInt(item.quantity) || 0,
                unit_price: parseFloat(item.unit_price) || 0,
                discount: parseFloat(item.discount) || 0,
                total_price: parseFloat(item.total_price) || 0
            }));

            // Clear all fields first
            document.getElementById('bill-patient-id').value = '';
            document.getElementById('bill-patient-name').value = '';
            document.getElementById('bill-walk-in-name').value = '';
            document.getElementById('bill-walk-in-phone').value = '';
            document.getElementById('patient-search-results').innerHTML = '';

            // Set form values based on bill type
            if (bill.patient_id) {
                document.getElementById('bill-patient-id').value = bill.patient_id || '';
                document.getElementById('bill-patient-name').value = bill.patient_name || '';
            } else {
                document.getElementById('bill-walk-in-name').value = bill.walk_in_name || '';
                document.getElementById('bill-walk-in-phone').value = bill.walk_in_phone || '';
            }

            // Ensure clinic dropdown is populated before setting value
            if (!document.getElementById('bill-clinic').options.length ||
                document.getElementById('bill-clinic').options.length <= 1) {
                await this.loadClinics();
            }

            document.getElementById('bill-clinic').value = bill.clinic_id || '';
            // Extract date part (YYYY-MM-DD) from ISO timestamp for date input
            const billDate = bill.bill_date ? bill.bill_date.split('T')[0] : '';
            document.getElementById('bill-date').value = billDate;
            document.getElementById('bill-payment-method').value = bill.payment_method || '';
            document.getElementById('bill-notes').value = bill.bill_notes || '';
            document.getElementById('bill-discount').value = bill.discount || 0;
            document.getElementById('bill-tax').value = bill.tax || 0;

            // Load services for this clinic
            await this.loadServices(bill.clinic_id);

            // Render existing bill items
            this.renderBillItems();
            this.updateBillTotals();

            // Change save button to update mode
            const saveBtn = document.getElementById('btn-save-bill');
            saveBtn.textContent = 'Update Bill';
            saveBtn.onclick = () => this.updateBill(billId);

            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('createBillModal'));
            modal.show();

            // Add focus management for accessibility
            if (window.A11y && window.A11y.manageFocusForModal) {
                window.A11y.manageFocusForModal(document.getElementById('createBillModal'), document.activeElement);
            }
        } catch (error) {
            console.error('Edit bill error:', error);
            this.showAlert('Failed to load bill for editing: ' + error.message, 'danger');
        }
    },

    async updateBill(billId) {
        if (this.billItems.length === 0) {
            this.showAlert('Please add at least one item', 'warning');
            return;
        }

        const patientId = document.getElementById('bill-patient-id').value;
        const walkInName = document.getElementById('bill-walk-in-name').value;
        const walkInPhone = document.getElementById('bill-walk-in-phone').value;

        if (!patientId && !walkInName) {
            this.showAlert('Please select a patient or enter walk-in details', 'warning');
            return;
        }

        const clinicIdValue = document.getElementById('bill-clinic')?.value;
        if (!clinicIdValue) {
            this.showAlert('Please select a clinic', 'warning');
            return;
        }

        const billDateValue = document.getElementById('bill-date')?.value || this.getTodayDate();

        const billData = {
            patient_id: patientId || null,
            walk_in_name: walkInName || null,
            walk_in_phone: walkInPhone || null,
            clinic_id: parseInt(clinicIdValue),
            bill_date: billDateValue,
            items: this.billItems,
            discount: parseFloat(document.getElementById('bill-discount')?.value) || 0,
            tax: parseFloat(document.getElementById('bill-tax')?.value) || 0,
            bill_notes: document.getElementById('bill-notes')?.value || null,
            payment_method: document.getElementById('bill-payment-method')?.value || null,
            payment_status: this.currentBill.payment_status || 'UNPAID',
            pn_case_id: this.currentBill.pn_case_id || null
        };

        console.log('Updating bill with date:', billDateValue);
        console.log('Full bill data:', billData);

        try {
            const response = await fetch(`/api/bills/${billId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(billData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update bill');
            }

            const result = await response.json();
            console.log('Bill update response:', result);

            this.showAlert('Bill updated successfully!', 'success');
            const modalEl = document.getElementById('createBillModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            // Reset save button
            const saveBtn = document.getElementById('btn-save-bill');
            saveBtn.textContent = 'Save Bill';
            saveBtn.onclick = () => this.saveBill();

            // Force reload bills from server with fresh data
            await this.loadBills(true);
            await this.loadUnpaidBillsSummary();
            console.log('Bills reloaded after update. Total bills:', this.bills.length);
        } catch (error) {
            console.error('Update bill error:', error);
            this.showAlert(error.message, 'danger');
        }
    },

    async deleteBill(billId, billCode) {
        if (!confirm(`Are you sure you want to delete bill ${billCode}? This action cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`/api/bills/${billId}`, {
                method: 'DELETE',
                headers: {}
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete bill');
            }

            this.showAlert(`Bill ${billCode} deleted successfully!`, 'success');
            await this.loadBills(true);
            await this.loadUnpaidBillsSummary();
        } catch (error) {
            console.error('Delete bill error:', error);
            this.showAlert(error.message, 'danger');
        }
    },

    async printBill(billId) {
        try {
            // Use centralized document rendering system
            // Simply open the document template with bill ID
            window.open(`/documents/render/bill/${billId}`, '_blank');
        } catch (error) {
            console.error('Print bill error:', error);
            this.showAlert('Failed to open bill for printing', 'danger');
        }
    },

    // ========================================
    // NEW: Simplified PN Bill Creation Functions
    // ========================================

    setupPNBillListeners() {
        // Add service button
        document.getElementById('btn-add-pn-bill-item')?.addEventListener('click', () => this.addPNBillItem());

        // Save bill button
        document.getElementById('btn-save-pn-bill')?.addEventListener('click', () => this.savePNBill());
    },

    async showPNBillModal(pnCaseId) {
        try {
            // Reset items
            this.pnBillItems = [];

            // Load PN case data
            const pnResponse = await fetch(`/api/pn/${pnCaseId}`, {
                headers: {}
            });

            if (!pnResponse.ok) throw new Error('Failed to load PN case');
            const pnCase = await pnResponse.json();

            // Check if this PN case already has a bill
            if (pnCase.bill_id) {
                this.showAlert('This PN case already has a bill. Cannot create duplicate bills.', 'warning');
                return;
            }

            // Store PN data
            this.currentPNData = pnCase;

            // Fill PN information (read-only display)
            document.getElementById('pn-bill-pn-code').textContent = pnCase.pn_code || 'N/A';
            document.getElementById('pn-bill-patient-name').textContent = `${pnCase.first_name} ${pnCase.last_name}`;
            document.getElementById('pn-bill-patient-hn').textContent = pnCase.hn || 'N/A';
            document.getElementById('pn-bill-diagnosis').textContent = pnCase.diagnosis || 'N/A';
            document.getElementById('pn-bill-purpose').textContent = pnCase.purpose || 'N/A';
            document.getElementById('pn-bill-clinic-name').textContent = pnCase.source_clinic_name || 'N/A';

            // Fill hidden fields
            document.getElementById('pn-bill-pn-id').value = pnCase.id;
            document.getElementById('pn-bill-patient-id').value = pnCase.patient_id;
            document.getElementById('pn-bill-clinic-id').value = pnCase.source_clinic_id;

            // Load services for this clinic
            await this.loadServices(pnCase.source_clinic_id);

            // Populate service dropdown
            const serviceSelect = document.getElementById('pn-bill-service');
            serviceSelect.innerHTML = '<option value="">Select Service</option>';
            this.services.forEach(service => {
                const option = document.createElement('option');
                option.value = service.id;
                const displayPrice = service.price || service.default_price;
                option.textContent = `${service.service_code} - ${service.service_name} (฿${displayPrice})`;
                option.dataset.price = displayPrice;
                option.dataset.name = service.service_name;
                serviceSelect.appendChild(option);
            });

            // Reset form fields
            document.getElementById('pn-bill-quantity').value = '1';
            document.getElementById('pn-bill-item-discount').value = '0';
            document.getElementById('pn-bill-payment-method').value = '';
            document.getElementById('pn-bill-notes').value = '';

            // Reset items display
            this.renderPNBillItems();
            this.updatePNBillTotals();

            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('createPNBillModal'));
            modal.show();

            // Add focus management for accessibility
            if (window.A11y && window.A11y.manageFocusForModal) {
                window.A11y.manageFocusForModal(document.getElementById('createPNBillModal'), document.activeElement);
            }

        } catch (error) {
            console.error('Load PN data error:', error);
            this.showAlert('Failed to load PN case information', 'danger');
        }
    },

    addPNBillItem() {
        const serviceSelect = document.getElementById('pn-bill-service');
        const quantityInput = document.getElementById('pn-bill-quantity');
        const discountInput = document.getElementById('pn-bill-item-discount');

        const serviceId = serviceSelect.value;
        const serviceName = serviceSelect.options[serviceSelect.selectedIndex]?.dataset.name || '';
        const unitPrice = parseFloat(serviceSelect.options[serviceSelect.selectedIndex]?.dataset.price || 0);
        const quantity = parseInt(quantityInput.value) || 1;
        const discount = parseFloat(discountInput.value) || 0;

        if (!serviceId) {
            this.showAlert('Please select a service', 'warning');
            return;
        }

        const item = {
            service_id: parseInt(serviceId),
            service_name: serviceName,
            quantity,
            unit_price: unitPrice,
            discount,
            total_price: (quantity * unitPrice) - discount,
            notes: null
        };

        this.pnBillItems.push(item);
        this.renderPNBillItems();
        this.updatePNBillTotals();

        // Reset inputs
        serviceSelect.value = '';
        quantityInput.value = '1';
        discountInput.value = '0';
    },

    renderPNBillItems() {
        const container = document.getElementById('pn-bill-items-container');
        if (!container) return;

        if (this.pnBillItems.length === 0) {
            container.innerHTML = '<p class="text-muted text-center py-3">No services added yet</p>';
            return;
        }

        container.innerHTML = `
            <table class="table table-sm table-hover">
                <thead class="table-light">
                    <tr>
                        <th>Service</th>
                        <th class="text-center">Qty</th>
                        <th class="text-end">Price</th>
                        <th class="text-end">Discount</th>
                        <th class="text-end">Total</th>
                        <th class="text-center" width="80">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.pnBillItems.map((item, index) => `
                        <tr>
                            <td>${item.service_name}</td>
                            <td class="text-center">${item.quantity}</td>
                            <td class="text-end">฿${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                            <td class="text-end">฿${parseFloat(item.discount || 0).toFixed(2)}</td>
                            <td class="text-end"><strong>฿${parseFloat(item.total_price || 0).toFixed(2)}</strong></td>
                            <td class="text-center">
                                <button type="button" class="btn btn-sm btn-danger" onclick="BillsManager.removePNBillItem(${index})">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    },

    removePNBillItem(index) {
        this.pnBillItems.splice(index, 1);
        this.renderPNBillItems();
        this.updatePNBillTotals();
    },

    updatePNBillTotals() {
        const subtotal = this.pnBillItems.reduce((sum, item) => sum + item.total_price, 0);

        document.getElementById('pn-bill-subtotal').textContent = `฿${subtotal.toFixed(2)}`;
        document.getElementById('pn-bill-total').textContent = `฿${subtotal.toFixed(2)}`;
    },

    async savePNBill() {
        if (this.pnBillItems.length === 0) {
            this.showAlert('Please add at least one service', 'warning');
            return;
        }

        const pnId = parseInt(document.getElementById('pn-bill-pn-id').value);
        const patientId = parseInt(document.getElementById('pn-bill-patient-id').value);
        const clinicId = parseInt(document.getElementById('pn-bill-clinic-id').value);
        const paymentMethod = document.getElementById('pn-bill-payment-method').value;
        const notes = document.getElementById('pn-bill-notes').value;

        // Double-check if PN case already has a bill before saving
        if (this.currentPNData && this.currentPNData.bill_id) {
            this.showAlert('This PN case already has a bill. Cannot create duplicate bills.', 'warning');
            return;
        }

        const billData = {
            patient_id: patientId,
            walk_in_name: null,
            walk_in_phone: null,
            clinic_id: clinicId,
            bill_date: this.getTodayDate(),
            items: this.pnBillItems,
            discount: 0,
            tax: 0,
            bill_notes: notes || null,
            payment_method: paymentMethod || null,
            payment_notes: null,
            appointment_id: null,
            pn_case_id: pnId  // Link to PN case
        };

        try {
            const response = await fetch('/api/bills', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(billData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create bill');
            }

            const result = await response.json();
            this.showAlert(`Bill ${result.bill_code} created successfully and linked to PN!`, 'success');

            // Close modal
            const modalEl = document.getElementById('createPNBillModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            // Reload bills table
            this.loadBills(true);

        } catch (error) {
            console.error('Save PN bill error:', error);
            this.showAlert(error.message, 'danger');
        }
    }
};

// CSV Import/Export functionality
const CSVHandler = {
    exportTemplate() {
        window.location.href = '/api/bills/export/template';
    },

    showImportModal() {
        const modal = new bootstrap.Modal(document.getElementById('importBillsModal'));
        modal.show();

        // Reset file input
        document.getElementById('import-file').value = '';
        document.getElementById('btn-upload-csv').disabled = true;
        document.getElementById('import-preview').style.display = 'none';
        document.getElementById('import-results').style.display = 'none';
    },

    parseCSV(text) {
        const lines = text.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('CSV file is empty or invalid');
        }

        const headers = lines[0].split(',').map(h => h.trim());
        const data = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            if (values.length !== headers.length) {
                console.warn(`Row ${i + 1} has ${values.length} columns, expected ${headers.length}`);
                continue;
            }

            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index].trim();
            });

            // Skip empty rows
            if (Object.values(row).every(val => !val)) {
                continue;
            }

            data.push(row);
        }

        return data;
    },

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = this.parseCSV(text);

            console.log('Parsed CSV data:', data);

            // Show preview
            const previewContent = document.getElementById('import-preview-content');
            previewContent.innerHTML = `
                <div class="alert alert-success">
                    <i class="bi bi-check-circle me-2"></i>
                    <strong>${data.length} rows</strong> ready to import
                </div>
                <small>First row: ${JSON.stringify(data[0], null, 2)}</small>
            `;
            document.getElementById('import-preview').style.display = 'block';

            // Enable upload button and store data
            document.getElementById('btn-upload-csv').disabled = false;
            document.getElementById('btn-upload-csv').dataset.csvData = JSON.stringify(data);

        } catch (error) {
            console.error('CSV parse error:', error);
            BillsManager.showAlert('Failed to parse CSV file: ' + error.message, 'danger');
        }
    },

    async uploadCSV() {
        const button = document.getElementById('btn-upload-csv');
        const csvData = JSON.parse(button.dataset.csvData || '[]');

        if (csvData.length === 0) {
            BillsManager.showAlert('No data to import', 'warning');
            return;
        }

        try {
            button.disabled = true;
            button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Importing...';

            const response = await fetch('/api/bills/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ csvData })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Import failed');
            }

            // Show results
            const resultsDiv = document.getElementById('import-results');
            let resultsHTML = `
                <div class="alert alert-${result.success > 0 ? 'success' : 'warning'}">
                    <h6><i class="bi bi-info-circle me-2"></i>Import Results</h6>
                    <ul>
                        <li><strong>${result.success}</strong> bills imported successfully</li>
                        <li><strong>${result.failed}</strong> bills failed</li>
                    </ul>
                </div>
            `;

            if (result.errors && result.errors.length > 0) {
                resultsHTML += '<div class="alert alert-danger"><h6>Errors:</h6><ul>';
                result.errors.forEach(err => {
                    resultsHTML += `<li>Row ${err.row}: ${err.error}</li>`;
                });
                resultsHTML += '</ul></div>';
            }

            resultsDiv.innerHTML = resultsHTML;
            resultsDiv.style.display = 'block';

            // Reload bills table if any succeeded
            if (result.success > 0) {
                setTimeout(() => {
                    bootstrap.Modal.getInstance(document.getElementById('importBillsModal')).hide();
                    BillsManager.loadBills(true);
                }, 3000);
            }

        } catch (error) {
            console.error('Upload CSV error:', error);
            BillsManager.showAlert('Failed to import bills: ' + error.message, 'danger');
        } finally {
            button.disabled = false;
            button.innerHTML = '<i class="bi bi-upload me-2"></i>Upload & Import';
        }
    }
};

// ========================================
// INVOICE MANAGER
// ========================================

const InvoiceManager = {
    invoices: [],
    invoiceItems: [],
    services: [],
    clinics: [],
    currentInvoice: null,  // Store current invoice for preserving data on update

    async init() {
        await this.loadClinics();
        await this.loadInvoiceSummary();
        await this.loadInvoices();
        await this.loadServices();
        this.populateYearFilter();
        this.setupEventListeners();
    },

    async loadClinics() {
        try {
            const response = await fetch('/api/clinics', {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load clinics');

            this.clinics = await response.json();
        } catch (error) {
            console.error('Load clinics error:', error);
            BillsManager.showAlert('Failed to load clinics', 'danger');
        }
    },

    populateYearFilter() {
        const yearSelect = document.getElementById('filter-invoice-year');
        if (!yearSelect) return;

        const currentYear = new Date().getFullYear();
        for (let year = currentYear; year >= currentYear - 5; year--) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            yearSelect.appendChild(option);
        }
    },

    setupEventListeners() {
        // Create invoice button
        document.getElementById('btn-create-invoice')?.addEventListener('click', () => this.showCreateInvoiceModal());

        // Add invoice item
        document.getElementById('btn-add-invoice-item')?.addEventListener('click', () => this.addInvoiceItem());

        // Save/Update invoice - handler checks mode from data attribute
        document.getElementById('btn-save-invoice')?.addEventListener('click', (e) => {
            const btn = e.target;
            const mode = btn.dataset.mode;
            const invoiceId = btn.dataset.invoiceId;

            if (mode === 'update' && invoiceId) {
                this.updateInvoice(parseInt(invoiceId));
            } else {
                this.saveInvoice();
            }
        });

        // Search invoices
        document.getElementById('btn-search-invoices')?.addEventListener('click', () => this.loadInvoices());

        // Recalculate totals when tax or discount changes
        document.getElementById('invoice-tax')?.addEventListener('input', () => this.updateInvoiceTotals());
        document.getElementById('invoice-discount')?.addEventListener('input', () => this.updateInvoiceTotals());

        // Auto-fill item name when service is selected
        document.getElementById('invoice-item-service')?.addEventListener('change', (e) => {
            const select = e.target;
            const selectedOption = select.options[select.selectedIndex];
            if (selectedOption && selectedOption.value) {
                document.getElementById('invoice-item-name').value = selectedOption.dataset.name || '';
                document.getElementById('invoice-item-price').value = selectedOption.dataset.price || 0;
            }
        });

        // Load services when clinic changes
        document.getElementById('invoice-clinic')?.addEventListener('change', (e) => {
            const clinicId = e.target.value;
            if (clinicId) {
                this.loadServices(clinicId);
            }
        });
    },

    async loadServices(clinicId = null) {
        try {
            const params = new URLSearchParams();
            if (clinicId) params.append('clinic_id', clinicId);

            const response = await fetch(`/api/bills/services?${params}`, {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load services');

            this.services = await response.json();
            this.renderServiceOptions();
        } catch (error) {
            console.error('Load services error:', error);
        }
    },

    renderServiceOptions() {
        const select = document.getElementById('invoice-item-service');
        if (!select) return;

        select.innerHTML = '<option value="">Select Service (optional)</option>';
        this.services.forEach(service => {
            const option = document.createElement('option');
            option.value = service.id;
            const displayPrice = service.price || service.default_price;
            option.textContent = `${service.service_code} - ${service.service_name} (฿${displayPrice})`;
            option.dataset.price = displayPrice;
            option.dataset.name = service.service_name;
            select.appendChild(option);
        });
    },

    async loadInvoiceSummary() {
        try {
            const response = await fetch('/api/invoices/summary', {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load invoice summary');

            const summary = await response.json();
            console.log('Invoice summary loaded:', summary);

            document.getElementById('unpaid-invoice-count').textContent = summary.unpaid_count || 0;
            document.getElementById('unpaid-invoice-total').textContent = `฿${parseFloat(summary.unpaid_total || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
        } catch (error) {
            console.error('Load invoice summary error:', error);
            BillsManager.showAlert('Failed to load invoice summary', 'warning');
        }
    },

    async loadInvoices() {
        try {
            const params = new URLSearchParams();

            const customerName = document.getElementById('filter-invoice-customer')?.value;
            const status = document.getElementById('filter-invoice-status')?.value;
            const year = document.getElementById('filter-invoice-year')?.value;
            const month = document.getElementById('filter-invoice-month')?.value;

            if (customerName) params.append('customer_name', customerName);
            if (status) params.append('payment_status', status);
            if (year) params.append('year', year);
            if (month) params.append('month', month);

            const response = await fetch(`/api/invoices?${params}`, {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load invoices');

            this.invoices = await response.json();
            this.renderInvoicesTable();
        } catch (error) {
            console.error('Load invoices error:', error);
            BillsManager.showAlert('Failed to load invoices', 'danger');
        }
    },

    renderInvoicesTable() {
        const tbody = document.getElementById('invoices-table-body');
        if (!tbody) return;

        const userRole = document.getElementById('user-role')?.value;

        if (this.invoices.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No invoices found</td></tr>';
            return;
        }

        tbody.innerHTML = this.invoices.map(invoice => {
            const statusBadgeClass = this.getStatusBadgeClass(invoice.payment_status);

            let actions = `
                <button class="btn btn-sm btn-info me-1" onclick="InvoiceManager.viewInvoice(${invoice.id})" title="View">
                    <i class="bi bi-eye"></i>
                </button>
                <button class="btn btn-sm btn-success me-1" onclick="InvoiceManager.printInvoice(${invoice.id})" title="Print">
                    <i class="bi bi-printer"></i>
                </button>
                <button class="btn btn-sm btn-warning me-1" onclick="InvoiceManager.editInvoice(${invoice.id})" title="Edit">
                    <i class="bi bi-pencil"></i>
                </button>
            `;

            // Admin can delete
            if (userRole === 'ADMIN') {
                actions += `
                    <button class="btn btn-sm btn-danger" onclick="InvoiceManager.deleteInvoice(${invoice.id}, '${invoice.invoice_number}')" title="Delete">
                        <i class="bi bi-trash"></i>
                    </button>
                `;
            }

            // Payment status dropdown
            const statusOptions = [
                { value: 'unpaid', label: 'Unpaid' },
                { value: 'paid', label: 'Paid' },
                { value: 'partially_paid', label: 'Partially Paid' },
                { value: 'cancelled', label: 'Cancelled' }
            ];

            actions += `
                <select class="form-select form-select-sm d-inline-block w-auto ms-1" style="font-size: 0.875rem;"
                        onchange="InvoiceManager.updatePaymentStatus(${invoice.id}, this.value)">
                    ${statusOptions.map(opt => `
                        <option value="${opt.value}" ${invoice.payment_status === opt.value ? 'selected' : ''}>
                            ${opt.label}
                        </option>
                    `).join('')}
                </select>
            `;

            return `
                <tr>
                    <td class="ps-4">${invoice.invoice_number}</td>
                    <td>${invoice.customer_name}</td>
                    <td>${invoice.clinic_name || 'N/A'}</td>
                    <td>${BillsManager.formatDate(invoice.invoice_date)}</td>
                    <td>${invoice.due_date ? BillsManager.formatDate(invoice.due_date) : '-'}</td>
                    <td class="text-end fw-bold">฿${parseFloat(invoice.total_amount).toFixed(2)}</td>
                    <td><span class="badge badge-${statusBadgeClass}">${invoice.payment_status.replace('_', ' ')}</span></td>
                    <td class="text-end pe-4">${actions}</td>
                </tr>
            `;
        }).join('');
    },

    getStatusBadgeClass(status) {
        const classes = {
            'paid': 'success',
            'unpaid': 'danger',
            'partially_paid': 'warning',
            'cancelled': 'secondary'
        };
        return classes[status] || 'secondary';
    },

    showCreateInvoiceModal() {
        this.invoiceItems = [];

        // Reset form
        document.getElementById('invoice-id').value = '';
        document.getElementById('invoice-customer-name').value = '';
        document.getElementById('invoice-customer-email').value = '';
        document.getElementById('invoice-customer-phone').value = '';
        document.getElementById('invoice-customer-address').value = '';
        document.getElementById('invoice-date').value = BillsManager.getTodayDate();
        document.getElementById('invoice-due-date').value = '';
        document.getElementById('invoice-payment-method').value = '';
        document.getElementById('invoice-notes').value = '';
        document.getElementById('invoice-tax').value = '0';
        document.getElementById('invoice-discount').value = '0';

        // Populate clinic dropdown
        const clinicSelect = document.getElementById('invoice-clinic');
        const userClinicId = document.getElementById('user-clinic-id')?.value;
        const userRole = document.getElementById('user-role')?.value;

        // Populate clinic options
        clinicSelect.innerHTML = '<option value="">Select Clinic</option>';
        this.clinics.forEach(clinic => {
            const option = document.createElement('option');
            option.value = clinic.id;
            option.textContent = clinic.name;
            clinicSelect.appendChild(option);
        });

        // Set default clinic based on role
        if (userClinicId && (userRole === 'CLINIC' || userRole === 'PT')) {
            clinicSelect.value = userClinicId;
            if (userRole === 'CLINIC') {
                clinicSelect.disabled = true;
            } else {
                clinicSelect.disabled = false;
            }
            this.loadServices(userClinicId);
        } else {
            // Admin can select any clinic
            clinicSelect.value = '';
            clinicSelect.disabled = false;
        }

        this.renderInvoiceItems();
        this.updateInvoiceTotals();

        // Reset save button to create mode
        const saveBtn = document.getElementById('btn-save-invoice');
        saveBtn.textContent = 'Save Invoice';
        saveBtn.dataset.mode = 'create';
        saveBtn.dataset.invoiceId = '';

        document.getElementById('invoiceModalTitle').innerHTML = '<i class="bi bi-file-earmark-text me-2"></i>Create Invoice';

        const modal = new bootstrap.Modal(document.getElementById('createInvoiceModal'));
        modal.show();
    },

    addInvoiceItem() {
        const serviceSelect = document.getElementById('invoice-item-service');
        const itemName = document.getElementById('invoice-item-name').value.trim();
        const quantity = parseInt(document.getElementById('invoice-item-quantity').value) || 1;
        const unitPrice = parseFloat(document.getElementById('invoice-item-price').value) || 0;

        if (!itemName) {
            BillsManager.showAlert('Please enter item name', 'warning');
            return;
        }

        const item = {
            service_id: serviceSelect.value ? parseInt(serviceSelect.value) : null,
            item_name: itemName,
            description: null,
            quantity,
            unit_price: unitPrice,
            total_price: quantity * unitPrice
        };

        this.invoiceItems.push(item);
        this.renderInvoiceItems();
        this.updateInvoiceTotals();

        // Reset inputs
        serviceSelect.value = '';
        document.getElementById('invoice-item-name').value = '';
        document.getElementById('invoice-item-quantity').value = '1';
        document.getElementById('invoice-item-price').value = '0';
    },

    renderInvoiceItems() {
        const container = document.getElementById('invoice-items-container');
        if (!container) return;

        if (this.invoiceItems.length === 0) {
            container.querySelector('tbody').innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No items added</td></tr>';
            return;
        }

        container.querySelector('tbody').innerHTML = this.invoiceItems.map((item, index) => `
            <tr>
                <td>${item.item_name}</td>
                <td>฿${parseFloat(item.unit_price).toFixed(2)}</td>
                <td>${item.quantity}</td>
                <td class="fw-bold">฿${parseFloat(item.total_price).toFixed(2)}</td>
                <td>
                    <button type="button" class="btn btn-sm btn-danger" onclick="InvoiceManager.removeInvoiceItem(${index})">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    },

    removeInvoiceItem(index) {
        this.invoiceItems.splice(index, 1);
        this.renderInvoiceItems();
        this.updateInvoiceTotals();
    },

    updateInvoiceTotals() {
        const subtotal = this.invoiceItems.reduce((sum, item) => sum + item.total_price, 0);
        const tax = parseFloat(document.getElementById('invoice-tax')?.value || 0);
        const discount = parseFloat(document.getElementById('invoice-discount')?.value || 0);
        const total = subtotal + tax - discount;

        document.getElementById('invoice-subtotal').textContent = this.formatCurrency(subtotal);
        document.getElementById('invoice-total').textContent = this.formatCurrency(total);
    },

    async saveInvoice() {
        if (this.invoiceItems.length === 0) {
            BillsManager.showAlert('Please add at least one item', 'warning');
            return;
        }

        const customerName = document.getElementById('invoice-customer-name').value.trim();
        const clinicId = document.getElementById('invoice-clinic').value;

        if (!customerName || !clinicId) {
            BillsManager.showAlert('Please fill in customer name and clinic', 'warning');
            return;
        }

        const invoiceData = {
            customer_name: customerName,
            customer_email: document.getElementById('invoice-customer-email').value.trim() || null,
            customer_phone: document.getElementById('invoice-customer-phone').value.trim() || null,
            customer_address: document.getElementById('invoice-customer-address').value.trim() || null,
            invoice_date: document.getElementById('invoice-date').value,
            due_date: document.getElementById('invoice-due-date').value || null,
            clinic_id: parseInt(clinicId),
            items: this.invoiceItems,
            tax_amount: parseFloat(document.getElementById('invoice-tax').value) || 0,
            discount_amount: parseFloat(document.getElementById('invoice-discount').value) || 0,
            notes: document.getElementById('invoice-notes').value.trim() || null
        };

        try {
            const response = await fetch('/api/invoices', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(invoiceData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create invoice');
            }

            const result = await response.json();
            BillsManager.showAlert(`Invoice ${result.invoice_number} created successfully!`, 'success');

            const modalEl = document.getElementById('createInvoiceModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            await this.loadInvoices();
            await this.loadInvoiceSummary();
        } catch (error) {
            console.error('Save invoice error:', error);
            BillsManager.showAlert(error.message, 'danger');
        }
    },

    async editInvoice(id) {
        try {
            const response = await fetch(`/api/invoices/${id}`, {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load invoice');

            const invoice = await response.json();

            // Store current invoice to preserve payment status and other fields
            this.currentInvoice = invoice;

            // Populate clinic dropdown first
            const clinicSelect = document.getElementById('invoice-clinic');
            clinicSelect.innerHTML = '<option value="">Select Clinic</option>';
            this.clinics.forEach(clinic => {
                const option = document.createElement('option');
                option.value = clinic.id;
                option.textContent = clinic.name;
                clinicSelect.appendChild(option);
            });

            // Populate form
            document.getElementById('invoice-id').value = invoice.id;
            document.getElementById('invoice-customer-name').value = invoice.customer_name;
            document.getElementById('invoice-customer-email').value = invoice.customer_email || '';
            document.getElementById('invoice-customer-phone').value = invoice.customer_phone || '';
            document.getElementById('invoice-customer-address').value = invoice.customer_address || '';
            document.getElementById('invoice-date').value = invoice.invoice_date.split('T')[0];
            document.getElementById('invoice-due-date').value = invoice.due_date ? invoice.due_date.split('T')[0] : '';
            document.getElementById('invoice-payment-method').value = invoice.payment_method || '';
            document.getElementById('invoice-notes').value = invoice.notes || '';
            document.getElementById('invoice-tax').value = invoice.tax_amount || 0;
            document.getElementById('invoice-discount').value = invoice.discount_amount || 0;
            document.getElementById('invoice-clinic').value = invoice.clinic_id;

            // Load services for this clinic
            await this.loadServices(invoice.clinic_id);

            // Set items
            this.invoiceItems = (invoice.items || []).map(item => ({
                service_id: item.service_id,
                item_name: item.item_name,
                description: item.description,
                quantity: parseInt(item.quantity),
                unit_price: parseFloat(item.unit_price),
                total_price: parseFloat(item.total_price)
            }));

            this.renderInvoiceItems();
            this.updateInvoiceTotals();

            // Change save button to update mode
            const saveBtn = document.getElementById('btn-save-invoice');
            saveBtn.textContent = 'Update Invoice';
            saveBtn.dataset.mode = 'update';
            saveBtn.dataset.invoiceId = id.toString();

            document.getElementById('invoiceModalTitle').innerHTML = '<i class="bi bi-file-earmark-text me-2"></i>Edit Invoice';

            const modal = new bootstrap.Modal(document.getElementById('createInvoiceModal'));
            modal.show();
        } catch (error) {
            console.error('Edit invoice error:', error);
            BillsManager.showAlert('Failed to load invoice for editing', 'danger');
        }
    },

    async updateInvoice(id) {
        console.log('=== UPDATE INVOICE START ===');
        console.log('Invoice ID to update:', id);
        console.log('Current invoice stored:', this.currentInvoice);

        if (this.invoiceItems.length === 0) {
            BillsManager.showAlert('Please add at least one item', 'warning');
            return;
        }

        const customerName = document.getElementById('invoice-customer-name').value.trim();
        const clinicId = document.getElementById('invoice-clinic').value;

        if (!customerName || !clinicId) {
            BillsManager.showAlert('Please fill in customer name and clinic', 'warning');
            return;
        }

        const invoiceData = {
            customer_name: customerName,
            customer_email: document.getElementById('invoice-customer-email').value.trim() || null,
            customer_phone: document.getElementById('invoice-customer-phone').value.trim() || null,
            customer_address: document.getElementById('invoice-customer-address').value.trim() || null,
            invoice_date: document.getElementById('invoice-date').value,
            due_date: document.getElementById('invoice-due-date').value || null,
            clinic_id: parseInt(clinicId),
            items: this.invoiceItems,
            tax_amount: parseFloat(document.getElementById('invoice-tax').value) || 0,
            discount_amount: parseFloat(document.getElementById('invoice-discount').value) || 0,
            payment_status: this.currentInvoice?.payment_status || 'unpaid', // Preserve existing status
            payment_method: document.getElementById('invoice-payment-method').value || null,
            payment_date: this.currentInvoice?.payment_date || null, // Preserve existing payment date
            notes: document.getElementById('invoice-notes').value.trim() || null
        };

        const url = `/api/invoices/${id}`;
        console.log('Sending PUT request to:', url);
        console.log('Request body:', JSON.stringify(invoiceData, null, 2));

        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(invoiceData)
            });

            console.log('Response status:', response.status);
            console.log('Response OK:', response.ok);

            if (!response.ok) {
                const error = await response.json();
                console.error('Backend error response:', error);
                throw new Error(error.error || 'Failed to update invoice');
            }

            const result = await response.json();
            console.log('Backend success response:', result);

            BillsManager.showAlert('Invoice updated successfully!', 'success');

            const modalEl = document.getElementById('createInvoiceModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            // Reset save button to create mode
            const saveBtn = document.getElementById('btn-save-invoice');
            saveBtn.textContent = 'Save Invoice';
            saveBtn.dataset.mode = 'create';
            saveBtn.dataset.invoiceId = '';

            // Clear current invoice
            this.currentInvoice = null;
            console.log('=== UPDATE INVOICE END ===');

            await this.loadInvoices();
            await this.loadInvoiceSummary();
        } catch (error) {
            console.error('Update invoice error:', error);
            BillsManager.showAlert(error.message, 'danger');
        }
    },

    async deleteInvoice(id, invoiceNumber) {
        if (!confirm(`Are you sure you want to delete invoice ${invoiceNumber}? This action cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`/api/invoices/${id}`, {
                method: 'DELETE',
                headers: {}
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete invoice');
            }

            BillsManager.showAlert(`Invoice ${invoiceNumber} deleted successfully!`, 'success');
            await this.loadInvoices();
            await this.loadInvoiceSummary();
        } catch (error) {
            console.error('Delete invoice error:', error);
            BillsManager.showAlert(error.message, 'danger');
        }
    },

    async updatePaymentStatus(id, newStatus) {
        try {
            const response = await fetch(`/api/invoices/${id}/payment-status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    payment_status: newStatus,
                    payment_method: null,
                    payment_date: newStatus === 'paid' ? BillsManager.getTodayDate() : null
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update payment status');
            }

            BillsManager.showAlert(`Payment status updated to ${newStatus}`, 'success');
            await this.loadInvoices();
            await this.loadInvoiceSummary();
        } catch (error) {
            console.error('Update payment status error:', error);
            BillsManager.showAlert(error.message, 'danger');
            await this.loadInvoices(); // Reload to revert dropdown
        }
    },

    async viewInvoice(id) {
        try {
            const response = await fetch(`/api/invoices/${id}`, {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load invoice');

            const invoice = await response.json();

            const detailsHtml = `
                <div class="invoice-details">
                    <h5>Invoice: ${invoice.invoice_number}</h5>
                    <p><strong>Customer:</strong> ${invoice.customer_name}</p>
                    ${invoice.customer_email ? `<p><strong>Email:</strong> ${invoice.customer_email}</p>` : ''}
                    ${invoice.customer_phone ? `<p><strong>Phone:</strong> ${invoice.customer_phone}</p>` : ''}
                    <p><strong>Clinic:</strong> ${invoice.clinic_name || 'N/A'}</p>
                    <p><strong>Date:</strong> ${BillsManager.formatDate(invoice.invoice_date)}</p>
                    ${invoice.due_date ? `<p><strong>Due Date:</strong> ${BillsManager.formatDate(invoice.due_date)}</p>` : ''}
                    <p><strong>Status:</strong> <span class="badge badge-${this.getStatusBadgeClass(invoice.payment_status)}">${invoice.payment_status.replace('_', ' ')}</span></p>

                    <h6 class="mt-3">Items:</h6>
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Qty</th>
                                <th>Price</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(invoice.items || []).map(item => `
                                <tr>
                                    <td>${item.item_name}</td>
                                    <td>${item.quantity}</td>
                                    <td>฿${parseFloat(item.unit_price).toFixed(2)}</td>
                                    <td>฿${parseFloat(item.total_price).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>

                    <div class="text-end mt-3">
                        <p><strong>Subtotal:</strong> ฿${parseFloat(invoice.subtotal).toFixed(2)}</p>
                        <p><strong>Tax:</strong> ฿${parseFloat(invoice.tax_amount || 0).toFixed(2)}</p>
                        <p><strong>Discount:</strong> ฿${parseFloat(invoice.discount_amount || 0).toFixed(2)}</p>
                        <h5><strong>Total:</strong> ฿${parseFloat(invoice.total_amount).toFixed(2)}</h5>
                    </div>
                </div>
            `;

            // Reuse the viewBillModal for invoices
            document.getElementById('bill-details-content').innerHTML = detailsHtml;
            const modal = new bootstrap.Modal(document.getElementById('viewBillModal'));
            modal.show();
        } catch (error) {
            console.error('View invoice error:', error);
            BillsManager.showAlert('Failed to load invoice details', 'danger');
        }
    },

    async printInvoice(id) {
        try {
            const response = await fetch(`/api/invoices/${id}`, {
                headers: {}
            });

            if (!response.ok) throw new Error('Failed to load invoice');

            const invoice = await response.json();

            // Open print window with invoice data
            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                BillsManager.showAlert('Please allow popups to print invoices', 'warning');
                return;
            }

            // Generate print HTML
            const printHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Invoice ${invoice.invoice_number}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Sarabun', Arial, sans-serif; padding: 20mm; font-size: 14px; }
        .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
        .header h1 { font-size: 28px; margin-bottom: 5px; }
        .invoice-info { display: flex; justify-content: space-between; margin: 20px 0; }
        .invoice-info div { flex: 1; }
        .invoice-info .right { text-align: right; }
        .customer-info { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #333; color: white; font-weight: bold; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .totals { margin: 20px 0; }
        .totals table { width: 50%; margin-left: auto; }
        .totals td { border: none; padding: 8px; }
        .totals .total-row { font-size: 18px; font-weight: bold; background: #f0f0f0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; text-align: center; font-size: 12px; color: #666; }
        .status-badge { display: inline-block; padding: 5px 15px; border-radius: 3px; font-weight: bold; font-size: 12px; }
        .status-paid { background: #d4edda; color: #155724; }
        .status-unpaid { background: #f8d7da; color: #721c24; }
        .status-partially_paid { background: #fff3cd; color: #856404; }
        .status-cancelled { background: #e2e3e5; color: #383d41; }
        @media print { body { padding: 0; } .no-print { display: none; } }
        .print-button { position: fixed; top: 20px; right: 20px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
        .print-button:hover { background: #0056b3; }
    </style>
</head>
<body>
    <button class="print-button no-print" onclick="window.print()">Print</button>

    <div class="header">
        <h1>INVOICE</h1>
        <p>${invoice.clinic_name || 'Clinic Name'}</p>
    </div>

    <div class="invoice-info">
        <div>
            <strong>Invoice Number:</strong> ${invoice.invoice_number}<br>
            <strong>Invoice Date:</strong> ${BillsManager.formatDate(invoice.invoice_date)}<br>
            ${invoice.due_date ? `<strong>Due Date:</strong> ${BillsManager.formatDate(invoice.due_date)}<br>` : ''}
            <strong>Status:</strong> <span class="status-badge status-${invoice.payment_status}">${invoice.payment_status.replace('_', ' ').toUpperCase()}</span>
        </div>
        <div class="right">
            ${invoice.payment_method ? `<strong>Payment Method:</strong> ${invoice.payment_method}<br>` : ''}
            ${invoice.payment_date ? `<strong>Payment Date:</strong> ${BillsManager.formatDate(invoice.payment_date)}<br>` : ''}
        </div>
    </div>

    <div class="customer-info">
        <h3>Bill To:</h3>
        <strong>${invoice.customer_name}</strong><br>
        ${invoice.customer_email ? `Email: ${invoice.customer_email}<br>` : ''}
        ${invoice.customer_phone ? `Phone: ${invoice.customer_phone}<br>` : ''}
        ${invoice.customer_address ? `Address: ${invoice.customer_address}<br>` : ''}
    </div>

    <table>
        <thead>
            <tr>
                <th style="width: 50%;">Item Description</th>
                <th class="text-center" style="width: 10%;">Qty</th>
                <th class="text-right" style="width: 20%;">Unit Price</th>
                <th class="text-right" style="width: 20%;">Total</th>
            </tr>
        </thead>
        <tbody>
            ${(invoice.items || []).map(item => `
                <tr>
                    <td>${item.item_name}</td>
                    <td class="text-center">${item.quantity}</td>
                    <td class="text-right">฿${parseFloat(item.unit_price).toFixed(2)}</td>
                    <td class="text-right">฿${parseFloat(item.total_price).toFixed(2)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>

    <div class="totals">
        <table>
            <tr>
                <td><strong>Subtotal:</strong></td>
                <td class="text-right">฿${parseFloat(invoice.subtotal).toFixed(2)}</td>
            </tr>
            ${invoice.tax_amount > 0 ? `
                <tr>
                    <td><strong>Tax:</strong></td>
                    <td class="text-right">฿${parseFloat(invoice.tax_amount).toFixed(2)}</td>
                </tr>
            ` : ''}
            ${invoice.discount_amount > 0 ? `
                <tr>
                    <td><strong>Discount:</strong></td>
                    <td class="text-right">-฿${parseFloat(invoice.discount_amount).toFixed(2)}</td>
                </tr>
            ` : ''}
            <tr class="total-row">
                <td><strong>TOTAL:</strong></td>
                <td class="text-right">฿${parseFloat(invoice.total_amount).toFixed(2)}</td>
            </tr>
        </table>
    </div>

    ${invoice.notes ? `
        <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #007bff;">
            <strong>Notes:</strong><br>
            ${invoice.notes}
        </div>
    ` : ''}

    <div class="footer">
        <p>Thank you for your business!</p>
        <p>Generated on ${new Date().toLocaleDateString('th-TH')}</p>
    </div>

    <script>
        // Auto-focus for better printing experience
        window.onload = function() {
            window.focus();
        };
    </script>
</body>
</html>
            `;

            printWindow.document.write(printHtml);
            printWindow.document.close();
        } catch (error) {
            console.error('Print invoice error:', error);
            BillsManager.showAlert('Failed to print invoice', 'danger');
        }
    },

    formatCurrency(amount) {
        return new Intl.NumberFormat('th-TH', {
            style: 'currency',
            currency: 'THB'
        }).format(amount || 0);
    }
};

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    BillsManager.init();
    InvoiceManager.init();

    // Attach CSV handlers
    document.getElementById('btn-export-template')?.addEventListener('click', () => {
        CSVHandler.exportTemplate();
    });

    document.getElementById('btn-import-bills')?.addEventListener('click', () => {
        CSVHandler.showImportModal();
    });

    document.getElementById('import-file')?.addEventListener('change', (e) => {
        CSVHandler.handleFileSelect(e);
    });

    document.getElementById('btn-upload-csv')?.addEventListener('click', () => {
        CSVHandler.uploadCSV();
    });
});

// NEW: Global function for creating bills from PN cases
// This is called from PN creation success handlers
window.createBillForPN = function(pnCaseId, patientId, clinicId) {
    if (typeof BillsManager !== 'undefined') {
        // If on bills page, open modal directly
        BillsManager.showCreateBillModal(pnCaseId, patientId, clinicId);
    } else {
        // If on different page, redirect to bills page with parameters
        window.location.href = `/bills?create=true&pn_case_id=${pnCaseId}&patient_id=${patientId}&clinic_id=${clinicId}`;
    }
};