// Services Management JavaScript

// Get auth token from cookie

// Show alert message
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3`;
    alertDiv.style.zIndex = '9999';
    alertDiv.style.minWidth = '300px';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(alertDiv);

    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

let allServices = [];
let currentServiceId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadServices();
});

// Load services
async function loadServices() {
    try {
        const filterType = document.getElementById('filterType')?.value || '';
        const filterStatus = document.getElementById('filterStatus')?.value || '';
        const searchTerm = document.getElementById('searchService')?.value || '';

        const response = await fetch('/api/bills/services', {
            headers: {}
        });

        if (!response.ok) throw new Error('Failed to load services');

        allServices = await response.json();

        // Apply filters
        let filteredServices = allServices.filter(service => {
            if (filterType && service.service_type !== filterType) return false;
            if (filterStatus !== '' && service.active != filterStatus) return false;
            if (searchTerm) {
                const search = searchTerm.toLowerCase();
                if (!service.service_name.toLowerCase().includes(search) &&
                    !service.service_code.toLowerCase().includes(search)) {
                    return false;
                }
            }
            return true;
        });

        renderServicesTable(filteredServices);

    } catch (error) {
        console.error('Load services error:', error);
        showAlert('Failed to load services', 'danger');
    }
}

// Render services table
function renderServicesTable(services) {
    const tbody = document.getElementById('services-table-body');
    if (!tbody) return;

    if (services.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No services found</td></tr>';
        return;
    }

    tbody.innerHTML = services.map(service => `
        <tr>
            <td><strong>${escapeHtml(service.service_code)}</strong></td>
            <td>${escapeHtml(service.service_name)}</td>
            <td><span class="badge bg-info">${escapeHtml(service.service_type)}</span></td>
            <td>฿${parseFloat(service.default_price).toFixed(2)}</td>
            <td>
                <span class="badge ${service.active ? 'bg-success' : 'bg-secondary'}">
                    ${service.active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick="editService(${service.id})" title="Edit">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-info" onclick="manageClinicPricing(${service.id})" title="Manage Clinic Pricing">
                    <i class="bi bi-currency-dollar"></i>
                </button>
                <button class="btn btn-sm btn-outline-${service.active ? 'warning' : 'success'}"
                        onclick="toggleServiceStatus(${service.id}, ${service.active})"
                        title="${service.active ? 'Deactivate' : 'Activate'}">
                    <i class="bi bi-${service.active ? 'eye-slash' : 'eye'}"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// HTML escaping
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Show create service modal
function showCreateServiceModal() {
    currentServiceId = null;
    document.getElementById('serviceModalTitle').innerHTML = '<i class="bi bi-plus-circle me-2"></i>New Service';
    document.getElementById('serviceForm').reset();
    document.getElementById('serviceId').value = '';
    document.getElementById('serviceActive').value = '1';

    const modal = new bootstrap.Modal(document.getElementById('serviceModal'));
    modal.show();
}

// Edit service
function editService(serviceId) {
    const service = allServices.find(s => s.id === serviceId);
    if (!service) {
        showAlert('Service not found', 'danger');
        return;
    }

    currentServiceId = serviceId;
    document.getElementById('serviceModalTitle').innerHTML = '<i class="bi bi-pencil me-2"></i>Edit Service';
    document.getElementById('serviceId').value = service.id;
    document.getElementById('serviceCode').value = service.service_code;
    document.getElementById('serviceName').value = service.service_name;
    document.getElementById('serviceDescription').value = service.service_description || '';
    document.getElementById('defaultPrice').value = service.default_price;
    document.getElementById('serviceType').value = service.service_type;
    document.getElementById('serviceActive').value = service.active ? '1' : '0';

    const modal = new bootstrap.Modal(document.getElementById('serviceModal'));
    modal.show();
}

// Save service (create or update)
async function saveService() {
    try {
        const serviceId = document.getElementById('serviceId').value;
        const serviceCode = document.getElementById('serviceCode').value.trim();
        const serviceName = document.getElementById('serviceName').value.trim();
        const serviceDescription = document.getElementById('serviceDescription').value.trim();
        const defaultPrice = document.getElementById('defaultPrice').value;
        const serviceType = document.getElementById('serviceType').value;
        const active = document.getElementById('serviceActive').value;

        // Validation
        if (!serviceCode || !serviceName || !defaultPrice || !serviceType) {
            showAlert('Please fill in all required fields', 'warning');
            return;
        }

        const serviceData = {
            service_code: serviceCode,
            service_name: serviceName,
            service_description: serviceDescription,
            default_price: parseFloat(defaultPrice),
            service_type: serviceType,
            active: parseInt(active)
        };

        const url = serviceId ? `/api/bills/services/${serviceId}` : '/api/bills/services';
        const method = serviceId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(serviceData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save service');
        }

        showAlert(`Service ${serviceId ? 'updated' : 'created'} successfully!`, 'success');

        // Close modal
        const modalEl = document.getElementById('serviceModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        // Reload services
        await loadServices();

    } catch (error) {
        console.error('Save service error:', error);
        showAlert(error.message, 'danger');
    }
}

// Toggle service status
async function toggleServiceStatus(serviceId, currentStatus) {
    const newStatus = currentStatus ? 0 : 1;
    const action = newStatus ? 'activate' : 'deactivate';

    if (!confirm(`Are you sure you want to ${action} this service?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/bills/services/${serviceId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ active: newStatus })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update service status');
        }

        showAlert(`Service ${action}d successfully!`, 'success');
        await loadServices();

    } catch (error) {
        console.error('Toggle service status error:', error);
        showAlert(error.message, 'danger');
    }
}

// Clinic Pricing Management
let currentClinicPricings = [];
let currentPricingServiceId = null;
let allClinics = [];

// Load clinics for pricing management
async function loadClinicsForPricing() {
    try {
        const response = await fetch('/api/clinics', {
            headers: {}
        });

        if (!response.ok) throw new Error('Failed to load clinics');

        allClinics = await response.json();
    } catch (error) {
        console.error('Load clinics error:', error);
        showAlert('Failed to load clinics', 'danger');
    }
}

// Manage clinic pricing for a service
async function manageClinicPricing(serviceId) {
    currentPricingServiceId = serviceId;
    const service = allServices.find(s => s.id === serviceId);
    if (!service) {
        showAlert('Service not found', 'danger');
        return;
    }

    // Load clinics if not already loaded
    if (allClinics.length === 0) {
        await loadClinicsForPricing();
    }

    // Update modal title
    document.getElementById('clinicPricingModalTitle').textContent = `Clinic Pricing - ${service.service_name}`;
    document.getElementById('pricing-default-price').textContent = `Default Price: ฿${parseFloat(service.default_price).toFixed(2)}`;

    // Load clinic pricing data
    await loadClinicPricingData(serviceId);

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('clinicPricingModal'));
    modal.show();
}

// Load clinic pricing data for a service
async function loadClinicPricingData(serviceId) {
    try {

        // Load existing pricing for this service
        const response = await fetch(`/api/bills/clinic-pricing?service_id=${serviceId}`, {
            headers: {}
        });

        if (!response.ok) throw new Error('Failed to load clinic pricing');

        const existingPricing = await response.json();

        // Create pricing map
        const pricingMap = {};
        existingPricing.forEach(p => {
            pricingMap[p.clinic_id] = {
                clinic_price: p.clinic_price,
                is_enabled: p.is_enabled
            };
        });

        // Render clinic pricing table
        renderClinicPricingTable(pricingMap);

    } catch (error) {
        console.error('Load clinic pricing error:', error);
        showAlert('Failed to load clinic pricing', 'danger');
    }
}

// Render clinic pricing table
function renderClinicPricingTable(pricingMap) {
    const tbody = document.getElementById('clinic-pricing-table-body');
    if (!tbody) return;

    if (allClinics.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">No clinics found</td></tr>';
        return;
    }

    tbody.innerHTML = allClinics.map(clinic => {
        const pricing = pricingMap[clinic.id] || {};
        const isEnabled = pricing.is_enabled !== undefined ? pricing.is_enabled : true;
        const clinicPrice = pricing.clinic_price || '';

        return `
            <tr>
                <td><strong>${escapeHtml(clinic.code)}</strong></td>
                <td>${escapeHtml(clinic.name)}</td>
                <td>
                    <div class="form-check form-switch">
                        <input class="form-check-input clinic-pricing-enabled"
                               type="checkbox"
                               data-clinic-id="${clinic.id}"
                               ${isEnabled ? 'checked' : ''}>
                    </div>
                </td>
                <td>
                    <input type="number"
                           class="form-control form-control-sm clinic-pricing-price"
                           data-clinic-id="${clinic.id}"
                           value="${clinicPrice}"
                           min="0"
                           step="0.01"
                           placeholder="Default price"
                           ${!isEnabled ? 'disabled' : ''}>
                </td>
            </tr>
        `;
    }).join('');

    // Add event listeners to enable/disable price inputs
    tbody.querySelectorAll('.clinic-pricing-enabled').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const clinicId = e.target.dataset.clinicId;
            const priceInput = tbody.querySelector(`.clinic-pricing-price[data-clinic-id="${clinicId}"]`);
            if (priceInput) {
                priceInput.disabled = !e.target.checked;
            }
        });
    });
}

// Save clinic pricing
async function saveClinicPricing() {
    try {
        const tbody = document.getElementById('clinic-pricing-table-body');

        // Collect all pricing data
        const pricingUpdates = [];
        allClinics.forEach(clinic => {
            const enabledCheckbox = tbody.querySelector(`.clinic-pricing-enabled[data-clinic-id="${clinic.id}"]`);
            const priceInput = tbody.querySelector(`.clinic-pricing-price[data-clinic-id="${clinic.id}"]`);

            if (enabledCheckbox && priceInput) {
                const isEnabled = enabledCheckbox.checked;
                const price = priceInput.value ? parseFloat(priceInput.value) : null;

                pricingUpdates.push({
                    clinic_id: clinic.id,
                    service_id: currentPricingServiceId,
                    is_enabled: isEnabled,
                    clinic_price: price
                });
            }
        });

        // Save all pricing updates
        for (const pricing of pricingUpdates) {
            const response = await fetch('/api/bills/clinic-pricing', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(pricing)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to save clinic pricing');
            }
        }

        showAlert('Clinic pricing updated successfully!', 'success');

        // Close modal
        const modalEl = document.getElementById('clinicPricingModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

    } catch (error) {
        console.error('Save clinic pricing error:', error);
        showAlert(error.message, 'danger');
    }
}