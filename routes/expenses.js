// routes/expenses.js - Expense Management Routes (Admin Only)
const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const moment = require('moment');

// Get all expenses with filters
router.get('/', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { category, year, month } = req.query;

        let query = `
            SELECT e.*, c.name as category_name,
                   CONCAT(u.first_name, ' ', u.last_name) as created_by_name
            FROM expenses e
            LEFT JOIN expense_categories c ON e.category_id = c.id
            JOIN users u ON e.created_by = u.id
            WHERE 1=1
        `;
        const params = [];

        if (category) {
            query += ' AND e.category_id = ?';
            params.push(category);
        }

        if (year && month) {
            query += ' AND YEAR(e.expense_date) = ? AND MONTH(e.expense_date) = ?';
            params.push(year, month);
        }

        query += ' ORDER BY e.expense_date DESC';

        const [expenses] = await db.execute(query, params);
        res.json(expenses);
    } catch (error) {
        console.error('Get expenses error:', error);
        res.status(500).json({ error: 'Failed to retrieve expenses' });
    }
});

// Get expense summary
router.get('/summary', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Check if required tables exist
        try {
            const [expenseTables] = await db.execute(`
                SELECT TABLE_NAME
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN ('expenses', 'expense_categories')
            `);

            if (expenseTables.length < 2) {
                console.log('Missing expense tables. Found:', expenseTables.map(t => t.TABLE_NAME));
                return res.json({
                    expensesThisMonth: 0,
                    expensesThisYear: 0,
                    incomeThisMonth: 0,
                    incomeThisYear: 0,
                    profitThisMonth: 0,
                    profitThisYear: 0,
                    warning: 'Expense tables not initialized'
                });
            }
        } catch (tableCheckError) {
            console.error('Error checking tables:', tableCheckError);
            return res.json({
                expensesThisMonth: 0,
                expensesThisYear: 0,
                incomeThisMonth: 0,
                incomeThisYear: 0,
                profitThisMonth: 0,
                profitThisYear: 0,
                warning: 'Could not verify expense tables'
            });
        }

        const currentYear = moment().year();
        const currentMonth = moment().month() + 1;

        console.log('=== EXPENSE SUMMARY DEBUG ===');
        console.log('Current Year:', currentYear);
        console.log('Current Month:', currentMonth);

        // This month expenses
        const [monthExpenses] = await db.execute(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM expenses
            WHERE YEAR(expense_date) = ? AND MONTH(expense_date) = ?
        `, [currentYear, currentMonth]);

        // This year expenses
        const [yearExpenses] = await db.execute(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM expenses
            WHERE YEAR(expense_date) = ?
        `, [currentYear]);

        console.log('Month Expenses:', monthExpenses[0].total);
        console.log('Year Expenses:', yearExpenses[0].total);

        // Check PAID bills
        const [paidBillsCount] = await db.execute(`
            SELECT COUNT(*) as count
            FROM bills
            WHERE payment_status = 'PAID' AND payment_date IS NOT NULL
        `);
        console.log('Total PAID bills with payment_date:', paidBillsCount[0].count);

        // This month paid bills (income)
        const [monthIncome] = await db.execute(`
            SELECT COALESCE(SUM(total_amount), 0) as total
            FROM bills
            WHERE payment_status = 'PAID'
            AND payment_date IS NOT NULL
            AND YEAR(payment_date) = ? AND MONTH(payment_date) = ?
        `, [currentYear, currentMonth]);

        // This year paid bills (income)
        const [yearIncome] = await db.execute(`
            SELECT COALESCE(SUM(total_amount), 0) as total
            FROM bills
            WHERE payment_status = 'PAID'
            AND payment_date IS NOT NULL
            AND YEAR(payment_date) = ?
        `, [currentYear]);

        console.log('Month Income:', monthIncome[0].total);
        console.log('Year Income:', yearIncome[0].total);

        const summary = {
            expensesThisMonth: parseFloat(monthExpenses[0].total) || 0,
            expensesThisYear: parseFloat(yearExpenses[0].total) || 0,
            incomeThisMonth: parseFloat(monthIncome[0].total) || 0,
            incomeThisYear: parseFloat(yearIncome[0].total) || 0,
            profitThisMonth: (parseFloat(monthIncome[0].total) || 0) - (parseFloat(monthExpenses[0].total) || 0),
            profitThisYear: (parseFloat(yearIncome[0].total) || 0) - (parseFloat(yearExpenses[0].total) || 0)
        };

        console.log('Summary result:', summary);
        console.log('=== END EXPENSE SUMMARY DEBUG ===');

        res.json(summary);
    } catch (error) {
        console.error('Get summary error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Failed to retrieve summary', details: error.message });
    }
});

// Get expense categories
router.get('/categories', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [categories] = await db.execute('SELECT * FROM expense_categories ORDER BY name');
        res.json(categories);
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ error: 'Failed to retrieve categories' });
    }
});

// Create expense
router.post('/', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { category_id, amount, description, expense_date, receipt_number } = req.body;

        const [result] = await db.execute(`
            INSERT INTO expenses (category_id, amount, description, expense_date, receipt_number, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [category_id, amount, description, expense_date, receipt_number, req.user.id]);

        res.status(201).json({
            success: true,
            message: 'Expense created successfully',
            id: result.insertId
        });
    } catch (error) {
        console.error('Create expense error:', error);
        res.status(500).json({ error: 'Failed to create expense' });
    }
});

// Update expense
router.put('/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { category_id, amount, description, expense_date, receipt_number } = req.body;

        await db.execute(`
            UPDATE expenses
            SET category_id = ?, amount = ?, description = ?,
                expense_date = ?, receipt_number = ?
            WHERE id = ?
        `, [category_id, amount, description, expense_date, receipt_number, id]);

        res.json({ success: true, message: 'Expense updated successfully' });
    } catch (error) {
        console.error('Update expense error:', error);
        res.status(500).json({ error: 'Failed to update expense' });
    }
});

// Delete expense
router.delete('/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        await db.execute('DELETE FROM expenses WHERE id = ?', [id]);

        res.json({ success: true, message: 'Expense deleted successfully' });
    } catch (error) {
        console.error('Delete expense error:', error);
        res.status(500).json({ error: 'Failed to delete expense' });
    }
});

// Create expense category
router.post('/categories', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name, description } = req.body;

        const [result] = await db.execute(`
            INSERT INTO expense_categories (name, description)
            VALUES (?, ?)
        `, [name, description]);

        res.status(201).json({
            success: true,
            message: 'Category created successfully',
            id: result.insertId
        });
    } catch (error) {
        console.error('Create category error:', error);
        res.status(500).json({ error: 'Failed to create category' });
    }
});

module.exports = router;