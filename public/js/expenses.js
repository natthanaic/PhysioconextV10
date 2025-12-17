// Expense Management JavaScript
const ExpenseManager = {
    expenses: [],
    categories: [],
    modal: null,

    async init() {
        this.modal = new bootstrap.Modal(document.getElementById('expenseModal'));
        await this.loadCategories();
        await this.loadSummary();
        await this.loadExpenses();
        this.populateYearFilter();

        // Set default date to today
        document.getElementById('expenseDate').valueAsDate = new Date();
    },

    populateYearFilter() {
        const yearSelect = document.getElementById('filterYear');
        const currentYear = new Date().getFullYear();

        for (let year = currentYear; year >= currentYear - 5; year--) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            yearSelect.appendChild(option);
        }
    },

    async loadCategories() {
        try {
            const response = await fetch('/api/expenses/categories', {
                headers: {
                }
            });

            if (response.ok) {
                this.categories = await response.json();
                this.populateCategorySelects();
            }
        } catch (error) {
            console.error('Error loading categories:', error);
        }
    },

    populateCategorySelects() {
        const filterSelect = document.getElementById('filterCategory');
        const expenseSelect = document.getElementById('expenseCategory');

        this.categories.forEach(category => {
            // Filter dropdown
            const filterOption = document.createElement('option');
            filterOption.value = category.id;
            filterOption.textContent = category.name;
            filterSelect.appendChild(filterOption);

            // Expense form dropdown
            const expenseOption = document.createElement('option');
            expenseOption.value = category.id;
            expenseOption.textContent = category.name;
            expenseSelect.appendChild(expenseOption);
        });
    },

    async loadSummary() {
        try {
            const response = await fetch('/api/expenses/summary', {
                headers: {
                }
            });

            if (response.ok) {
                const summary = await response.json();

                document.getElementById('expensesMonth').textContent =
                    this.formatCurrency(summary.expensesThisMonth);
                document.getElementById('incomeMonth').textContent =
                    this.formatCurrency(summary.incomeThisMonth);
                document.getElementById('profitMonth').textContent =
                    this.formatCurrency(summary.profitThisMonth);

                document.getElementById('expensesYear').textContent =
                    this.formatCurrency(summary.expensesThisYear);
                document.getElementById('incomeYear').textContent =
                    this.formatCurrency(summary.incomeThisYear);
                document.getElementById('profitYear').textContent =
                    this.formatCurrency(summary.profitThisYear);

                // Color profit values based on positive/negative
                this.updateProfitColors('profitMonth', summary.profitThisMonth);
                this.updateProfitColors('profitYear', summary.profitThisYear);
            }
        } catch (error) {
            console.error('Error loading summary:', error);
        }
    },

    updateProfitColors(elementId, value) {
        const element = document.getElementById(elementId);
        if (value < 0) {
            element.style.color = '#ef4444';
        } else if (value > 0) {
            element.style.color = '#10b981';
        }
    },

    async loadExpenses() {
        try {
            const category = document.getElementById('filterCategory').value;
            const year = document.getElementById('filterYear').value;
            const month = document.getElementById('filterMonth').value;

            let url = '/api/expenses?';
            if (category) url += `category=${category}&`;
            if (year) url += `year=${year}&`;
            if (month) url += `month=${month}&`;

            const response = await fetch(url, {
                headers: {
                }
            });

            if (response.ok) {
                this.expenses = await response.json();
                this.renderExpenses();
            }
        } catch (error) {
            console.error('Error loading expenses:', error);
            this.showError('Failed to load expenses');
        }
    },

    renderExpenses() {
        const tbody = document.getElementById('expensesTableBody');

        if (this.expenses.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-muted">
                        <i class="bi bi-inbox fs-1"></i>
                        <p>No expenses found</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.expenses.map(expense => `
            <tr>
                <td>${this.formatDate(expense.expense_date)}</td>
                <td><span class="badge bg-secondary">${this.escapeHtml(expense.category_name)}</span></td>
                <td>${this.escapeHtml(expense.description || '-')}</td>
                <td>${this.escapeHtml(expense.receipt_number || '-')}</td>
                <td class="fw-bold">${this.formatCurrency(expense.amount)}</td>
                <td>${this.escapeHtml(expense.created_by_name)}</td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="ExpenseManager.editExpense(${expense.id})">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="ExpenseManager.deleteExpense(${expense.id})">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    },

    showAddModal() {
        document.getElementById('expenseModalTitle').textContent = 'Add Expense';
        document.getElementById('expenseForm').reset();
        document.getElementById('expenseId').value = '';
        document.getElementById('expenseDate').valueAsDate = new Date();
        this.modal.show();
    },

    editExpense(id) {
        const expense = this.expenses.find(e => e.id === id);
        if (!expense) return;

        document.getElementById('expenseModalTitle').textContent = 'Edit Expense';
        document.getElementById('expenseId').value = expense.id;
        document.getElementById('expenseCategory').value = expense.category_id;
        document.getElementById('expenseAmount').value = expense.amount;
        document.getElementById('expenseDate').value = expense.expense_date;
        document.getElementById('expenseReceipt').value = expense.receipt_number || '';
        document.getElementById('expenseDescription').value = expense.description || '';

        this.modal.show();
    },

    async saveExpense() {
        const form = document.getElementById('expenseForm');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const expenseId = document.getElementById('expenseId').value;
        const data = {
            category_id: document.getElementById('expenseCategory').value,
            amount: document.getElementById('expenseAmount').value,
            expense_date: document.getElementById('expenseDate').value,
            receipt_number: document.getElementById('expenseReceipt').value,
            description: document.getElementById('expenseDescription').value
        };

        try {
            const url = expenseId ? `/api/expenses/${expenseId}` : '/api/expenses';
            const method = expenseId ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                this.showSuccess(expenseId ? 'Expense updated successfully' : 'Expense added successfully');
                this.modal.hide();
                await this.loadSummary();
                await this.loadExpenses();
            } else {
                const error = await response.json();
                this.showError(error.error || 'Failed to save expense');
            }
        } catch (error) {
            console.error('Error saving expense:', error);
            this.showError('Failed to save expense');
        }
    },

    async deleteExpense(id) {
        if (!confirm('Are you sure you want to delete this expense?')) {
            return;
        }

        try {
            const response = await fetch(`/api/expenses/${id}`, {
                method: 'DELETE',
                headers: {
                }
            });

            if (response.ok) {
                this.showSuccess('Expense deleted successfully');
                await this.loadSummary();
                await this.loadExpenses();
            } else {
                this.showError('Failed to delete expense');
            }
        } catch (error) {
            console.error('Error deleting expense:', error);
            this.showError('Failed to delete expense');
        }
    },

    clearFilters() {
        document.getElementById('filterCategory').value = '';
        document.getElementById('filterYear').value = '';
        document.getElementById('filterMonth').value = '';
        this.loadExpenses();
    },

    formatCurrency(amount) {
        return new Intl.NumberFormat('th-TH', {
            style: 'currency',
            currency: 'THB'
        }).format(amount || 0);
    },

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    },

    showSuccess(message) {
        this.showAlert(message, 'success');
    },

    showError(message) {
        this.showAlert(message, 'danger');
    },

    showAlert(message, type) {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 end-0 m-3`;
        alertDiv.style.zIndex = '9999';
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(alertDiv);

        setTimeout(() => alertDiv.remove(), 3000);
    }
};

// Manual initialization required - call ExpenseManager.init() explicitly when needed
// This prevents automatic initialization on pages where ExpenseManager is not the primary feature