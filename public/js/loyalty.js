// Loyalty & Membership Management - RehabPlus System

const loyaltyManager = {
    members: [],
    currentMember: null,
    tierRules: [],
    giftCardCatalog: [],

    async init() {
        console.log('[LoyaltyManager] Initializing...');
        await this.loadTierRules();
        await this.loadMembers();
        this.setupEventListeners();
    },

    setupEventListeners() {
        // Search input with debounce
        let searchTimeout;
        document.getElementById('search-input')?.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.loadMembers(), 500);
        });

        // Filter dropdowns
        document.getElementById('filter-tier')?.addEventListener('change', () => this.loadMembers());
        document.getElementById('filter-status')?.addEventListener('change', () => this.loadMembers());
    },

    async loadTierRules() {
        try {
            const response = await fetch('/api/loyalty/tier-rules', {
                headers: {}
            });

            if (response.ok) {
                this.tierRules = await response.json();
                console.log('Tier rules loaded:', this.tierRules);
            }
        } catch (error) {
            console.error('Load tier rules error:', error);
        }
    },

    async loadMembers() {
        try {
            const search = document.getElementById('search-input')?.value || '';
            const tier = document.getElementById('filter-tier')?.value || '';
            const status = document.getElementById('filter-status')?.value || '';

            const params = new URLSearchParams();
            if (search) params.append('search', search);
            if (tier) params.append('tier', tier);
            if (status) params.append('status', status);

            const response = await fetch(`/api/loyalty/members?${params}`, {
                headers: {}
            });

            if (response.ok) {
                this.members = await response.json();
                this.renderMembers();
                this.updateTierCounts();
            } else {
                throw new Error('Failed to load members');
            }
        } catch (error) {
            console.error('Load members error:', error);
            this.showAlert('Failed to load loyalty members', 'danger');
        }
    },

    renderMembers() {
        const tbody = document.getElementById('members-table-body');
        if (!tbody) return;

        if (this.members.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">No loyalty members found</td></tr>';
            return;
        }

        tbody.innerHTML = this.members.map(member => {
            const tierBadge = this.getTierBadge(member.membership_tier);
            const statusBadge = this.getStatusBadge(member.status);
            const memberSince = new Date(member.member_since).toLocaleDateString('en-GB');

            return `
                <tr>
                    <td><strong>${member.hn || 'N/A'}</strong></td>
                    <td>${member.first_name} ${member.last_name}</td>
                    <td>${tierBadge}</td>
                    <td><strong>${member.total_points.toLocaleString()}</strong></td>
                    <td><span class="badge bg-success">${member.available_points.toLocaleString()}</span></td>
                    <td><strong>฿${parseFloat(member.lifetime_spending).toLocaleString('en-US', {minimumFractionDigits: 2})}</strong></td>
                    <td>${statusBadge}</td>
                    <td>${memberSince}</td>
                    <td>
                        <button class="btn btn-sm btn-info" onclick="loyaltyManager.showMemberDetails(${member.id})">
                            <i class="bi bi-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    updateTierCounts() {
        const counts = {
            BRONZE: 0,
            SILVER: 0,
            GOLD: 0,
            PLATINUM: 0
        };

        this.members.forEach(member => {
            if (counts.hasOwnProperty(member.membership_tier)) {
                counts[member.membership_tier]++;
            }
        });

        document.getElementById('bronze-count').textContent = counts.BRONZE;
        document.getElementById('silver-count').textContent = counts.SILVER;
        document.getElementById('gold-count').textContent = counts.GOLD;
        document.getElementById('platinum-count').textContent = counts.PLATINUM;
    },

    getTierBadge(tier) {
        const badges = {
            'BRONZE': '<span class="tier-badge tier-bronze"><i class="bi bi-award"></i> Bronze</span>',
            'SILVER': '<span class="tier-badge tier-silver"><i class="bi bi-award-fill"></i> Silver</span>',
            'GOLD': '<span class="tier-badge tier-gold"><i class="bi bi-trophy"></i> Gold</span>',
            'PLATINUM': '<span class="tier-badge tier-platinum"><i class="bi bi-trophy-fill"></i> Platinum</span>'
        };
        return badges[tier] || tier;
    },

    getStatusBadge(status) {
        const badges = {
            'ACTIVE': '<span class="badge bg-success">Active</span>',
            'INACTIVE': '<span class="badge bg-secondary">Inactive</span>',
            'SUSPENDED': '<span class="badge bg-danger">Suspended</span>'
        };
        return badges[status] || status;
    },

    async showMemberDetails(memberId) {
        try {
            const [memberResponse, transactionsResponse] = await Promise.all([
                fetch(`/api/loyalty/members/${memberId}`, {
                    headers: {}
                }),
                fetch(`/api/loyalty/members/${memberId}/transactions`, {
                    headers: {}
                })
            ]);

            if (!memberResponse.ok) throw new Error('Failed to load member details');

            const member = await memberResponse.json();
            const transactions = transactionsResponse.ok ? await transactionsResponse.json() : [];

            this.currentMember = member;
            this.renderMemberDetails(member, transactions);

            const modal = new bootstrap.Modal(document.getElementById('memberDetailsModal'));
            modal.show();
        } catch (error) {
            console.error('Show member details error:', error);
            this.showAlert('Failed to load member details', 'danger');
        }
    },

    renderMemberDetails(member, transactions) {
        const content = document.getElementById('member-details-content');
        if (!content) return;

        const tierBadge = this.getTierBadge(member.membership_tier);
        const tierRule = this.tierRules.find(r => r.tier === member.membership_tier) || {};

        // Check if user is admin for editing privileges
        const isAdmin = document.querySelector('[data-user-role]')?.getAttribute('data-user-role') === 'ADMIN';

        content.innerHTML = `
            <div class="row">
                <!-- Member Info -->
                <div class="col-md-4">
                    <div class="card mb-3">
                        <div class="card-body text-center">
                            <div class="mb-3">
                                <i class="bi bi-person-circle" style="font-size: 5rem; color: #667eea;"></i>
                            </div>
                            <h4>${member.first_name} ${member.last_name}</h4>
                            <p class="text-muted">HN: ${member.hn || 'N/A'}</p>
                            ${tierBadge}
                            <hr>
                            <div class="text-start">
                                <p><strong>Phone:</strong> ${member.phone || 'N/A'}</p>
                                <p><strong>Email:</strong> ${member.email || 'N/A'}</p>
                                <p><strong>Clinic:</strong> ${member.clinic_name || 'N/A'}</p>
                                <p><strong>Member Since:</strong> ${new Date(member.member_since).toLocaleDateString('en-GB')}</p>
                                <p><strong>Status:</strong> ${this.getStatusBadge(member.status)}</p>
                            </div>
                        </div>
                    </div>

                    ${isAdmin ? `
                    <div class="card">
                        <div class="card-body">
                            <h6>Admin Actions</h6>
                            <div class="d-grid gap-2">
                                <button class="btn btn-sm btn-primary" onclick="loyaltyManager.showEditTierModal(${member.id})">
                                    <i class="bi bi-pencil"></i> Change Tier
                                </button>
                                <button class="btn btn-sm btn-success" onclick="loyaltyManager.showAdjustPointsModal(${member.id})">
                                    <i class="bi bi-plus-circle"></i> Adjust Points
                                </button>
                                <button class="btn btn-sm btn-info" onclick="loyaltyManager.showRedeemGiftCardModal(${member.id})">
                                    <i class="bi bi-gift"></i> Redeem Gift Card
                                </button>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                </div>

                <!-- Stats & Transactions -->
                <div class="col-md-8">
                    <!-- Points & Spending Stats -->
                    <div class="row g-3 mb-3">
                        <div class="col-md-4">
                            <div class="card text-center" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                                <div class="card-body">
                                    <h6>Total Points Earned</h6>
                                    <h2>${member.total_points.toLocaleString()}</h2>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="card text-center" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white;">
                                <div class="card-body">
                                    <h6>Available Points</h6>
                                    <h2>${member.available_points.toLocaleString()}</h2>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="card text-center" style="background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%); color: white;">
                                <div class="card-body">
                                    <h6>Lifetime Spending</h6>
                                    <h2>฿${parseFloat(member.lifetime_spending).toLocaleString('en-US', {minimumFractionDigits: 0})}</h2>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Tier Benefits -->
                    <div class="card mb-3">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="bi bi-star-fill me-2"></i>Tier Benefits</h6>
                        </div>
                        <div class="card-body">
                            <ul class="list-unstyled mb-0">
                                <li><i class="bi bi-check-circle-fill text-success me-2"></i>Earn ${tierRule.points_per_100_baht || 1} points per ฿100 spent</li>
                                <li><i class="bi bi-check-circle-fill text-success me-2"></i>${tierRule.discount_percentage || 0}% discount on services</li>
                                <li><i class="bi bi-check-circle-fill text-success me-2"></i>${tierRule.description || 'Member benefits'}</li>
                            </ul>
                        </div>
                    </div>

                    <!-- Transaction History -->
                    <div class="card">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="bi bi-clock-history me-2"></i>Recent Transactions</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                                <table class="table table-sm">
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Type</th>
                                            <th>Points</th>
                                            <th>Description</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${transactions.length > 0 ? transactions.map(t => `
                                            <tr>
                                                <td>${new Date(t.transaction_date).toLocaleDateString('en-GB')}</td>
                                                <td><span class="badge bg-${t.transaction_type === 'EARN' ? 'success' : t.transaction_type === 'REDEEM' ? 'info' : 'secondary'}">${t.transaction_type}</span></td>
                                                <td class="${t.points >= 0 ? 'text-success' : 'text-danger'}">
                                                    ${t.points >= 0 ? '+' : ''}${t.points}
                                                </td>
                                                <td><small>${t.description || 'N/A'}</small></td>
                                            </tr>
                                        `).join('') : '<tr><td colspan="4" class="text-center">No transactions yet</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    async showRedeemGiftCardModal(memberId) {
        try {
            const response = await fetch('/api/loyalty/gift-cards/catalog', {
                headers: {}
            });

            if (response.ok) {
                this.giftCardCatalog = await response.json();
                const member = this.currentMember;

                const catalogHtml = this.giftCardCatalog.map(item => {
                    const canRedeem = member.available_points >= item.points_required;
                    return `
                        <div class="card mb-2 ${!canRedeem ? 'opacity-50' : ''}">
                            <div class="card-body">
                                <div class="row align-items-center">
                                    <div class="col-md-8">
                                        <h6>${item.name}</h6>
                                        <p class="mb-1 text-muted small">${item.description}</p>
                                        <span class="badge bg-warning text-dark">${item.points_required} points</span>
                                        <span class="badge bg-success">฿${parseFloat(item.gift_card_value).toFixed(2)}</span>
                                    </div>
                                    <div class="col-md-4 text-end">
                                        <button class="btn btn-sm btn-primary ${!canRedeem ? 'disabled' : ''}"
                                                onclick="loyaltyManager.redeemGiftCard(${memberId}, ${item.id})"
                                                ${!canRedeem ? 'disabled' : ''}>
                                            <i class="bi bi-gift"></i> Redeem
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                document.getElementById('gift-card-catalog').innerHTML = catalogHtml || '<p class="text-center">No gift cards available</p>';

                const modal = new bootstrap.Modal(document.getElementById('redeemGiftCardModal'));
                modal.show();
            }
        } catch (error) {
            console.error('Load gift card catalog error:', error);
            this.showAlert('Failed to load gift card catalog', 'danger');
        }
    },

    async redeemGiftCard(memberId, catalogId) {
        if (!confirm('Are you sure you want to redeem this gift card?')) {
            return;
        }

        try {
            const response = await fetch(`/api/loyalty/members/${memberId}/redeem-gift-card`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ catalog_id: catalogId })
            });

            const result = await response.json();

            if (response.ok) {
                this.showAlert(`Gift card redeemed successfully! Code: ${result.gift_card_code}`, 'success');
                bootstrap.Modal.getInstance(document.getElementById('redeemGiftCardModal')).hide();
                await this.showMemberDetails(memberId); // Refresh details
                await this.loadMembers(); // Refresh table
            } else {
                throw new Error(result.error || 'Failed to redeem gift card');
            }
        } catch (error) {
            console.error('Redeem gift card error:', error);
            this.showAlert(error.message, 'danger');
        }
    },

    async showAdjustPointsModal(memberId) {
        const points = prompt('Enter points to add (use negative number to subtract):');
        if (points === null || points === '') return;

        const pointsNum = parseInt(points);
        if (isNaN(pointsNum) || pointsNum === 0) {
            this.showAlert('Please enter a valid number', 'warning');
            return;
        }

        const description = prompt('Enter reason for adjustment:', 'Manual adjustment');
        if (description === null) return;

        try {
            const response = await fetch(`/api/loyalty/members/${memberId}/adjust-points`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    points: pointsNum,
                    description: description
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showAlert('Points adjusted successfully!', 'success');
                await this.showMemberDetails(memberId);
                await this.loadMembers();
            } else {
                throw new Error(result.error || 'Failed to adjust points');
            }
        } catch (error) {
            console.error('Adjust points error:', error);
            this.showAlert(error.message, 'danger');
        }
    },

    async showEditTierModal(memberId) {
        const newTier = prompt('Enter new tier (BRONZE, SILVER, GOLD, PLATINUM):');
        if (!newTier) return;

        const tierUpper = newTier.toUpperCase();
        if (!['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'].includes(tierUpper)) {
            this.showAlert('Invalid tier. Please use BRONZE, SILVER, GOLD, or PLATINUM', 'warning');
            return;
        }

        try {
            const response = await fetch(`/api/loyalty/members/${memberId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ membership_tier: tierUpper })
            });

            const result = await response.json();

            if (response.ok) {
                this.showAlert('Tier updated successfully!', 'success');
                await this.showMemberDetails(memberId);
                await this.loadMembers();
            } else {
                throw new Error(result.error || 'Failed to update tier');
            }
        } catch (error) {
            console.error('Update tier error:', error);
            this.showAlert(error.message, 'danger');
        }
    },

    async syncAllPatients() {
        if (!confirm('This will automatically sync ALL patients with paid bills into the loyalty system.\n\nIt will:\n- Create loyalty members for all patients with paid bills\n- Calculate tier based on lifetime spending\n- Award points automatically\n- Update existing members\n\nThis may take a while. Continue?')) {
            return;
        }

        try {
            // Show loading message
            this.showAlert('Syncing patients... Please wait.', 'info');

            const response = await fetch('/api/loyalty/sync-all-patients', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            if (response.ok) {
                this.showAlert(
                    `Sync completed successfully!\n\n` +
                    `✓ Total patients with bills: ${result.patients_with_bills}\n` +
                    `✓ New members created: ${result.members_created}\n` +
                    `✓ Existing members updated: ${result.members_updated}\n` +
                    `✓ Total loyalty members: ${result.total_members}`,
                    'success'
                );
                await this.loadMembers();
            } else {
                throw new Error(result.error || 'Failed to sync');
            }
        } catch (error) {
            console.error('Sync all patients error:', error);
            this.showAlert(error.message, 'danger');
        }
    },

    showAlert(message, type = 'info') {
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
        }, 5000);
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loyaltyManager.init();
});