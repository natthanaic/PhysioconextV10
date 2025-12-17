// routes/invoices.js - Invoice Management Routes
const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');

// ========================================
// GET ALL INVOICES
// ========================================
router.get('/invoices', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { startDate, endDate, status, patientId } = req.query;

        let query = `
            SELECT
                i.*,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
                p.phone as patient_phone,
                p.email as patient_email
            FROM invoices i
            LEFT JOIN patients p ON i.patient_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (startDate && endDate) {
            query += ` AND i.invoice_date BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }

        if (status) {
            query += ` AND i.status = ?`;
            params.push(status);
        }

        if (patientId) {
            query += ` AND i.patient_id = ?`;
            params.push(patientId);
        }

        query += ` ORDER BY i.invoice_date DESC, i.created_at DESC`;

        const [invoices] = await db.execute(query, params);
        res.json(invoices);
    } catch (error) {
        console.error('Get invoices error:', error);
        res.status(500).json({ error: 'Failed to retrieve invoices' });
    }
});

// ========================================
// GET INVOICE SUMMARY
// ========================================
router.get('/invoices/summary', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { startDate, endDate } = req.query;

        let query = `
            SELECT
                COUNT(*) as total_invoices,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue_count,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
                SUM(total) as total_amount,
                SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as paid_amount,
                SUM(CASE WHEN status = 'pending' THEN total ELSE 0 END) as pending_amount,
                SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END) as overdue_amount
            FROM invoices
            WHERE 1=1
        `;
        const params = [];

        if (startDate && endDate) {
            query += ` AND invoice_date BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }

        const [summary] = await db.execute(query, params);
        res.json(summary[0] || {
            total_invoices: 0,
            paid_count: 0,
            pending_count: 0,
            overdue_count: 0,
            cancelled_count: 0,
            total_amount: 0,
            paid_amount: 0,
            pending_amount: 0,
            overdue_amount: 0
        });
    } catch (error) {
        console.error('Get invoice summary error:', error);
        res.status(500).json({ error: 'Failed to retrieve invoice summary' });
    }
});

// ========================================
// CREATE NEW INVOICE
// ========================================
router.post('/invoices', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            patient_id,
            invoice_number,
            invoice_date,
            due_date,
            items,
            subtotal,
            discount,
            tax,
            total,
            notes,
            status
        } = req.body;

        const created_by = req.user.id;

        // Insert invoice
        const [result] = await db.execute(`
            INSERT INTO invoices (
                patient_id,
                invoice_number,
                invoice_date,
                due_date,
                subtotal,
                discount,
                tax,
                total,
                notes,
                status,
                created_by,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
            patient_id,
            invoice_number,
            invoice_date,
            due_date,
            subtotal || 0,
            discount || 0,
            tax || 0,
            total,
            notes || '',
            status || 'pending',
            created_by
        ]);

        const invoiceId = result.insertId;

        // Insert invoice items
        if (items && items.length > 0) {
            for (const item of items) {
                await db.execute(`
                    INSERT INTO invoice_items (
                        invoice_id,
                        service_id,
                        service_name,
                        quantity,
                        unit_price,
                        total_price
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    invoiceId,
                    item.service_id || null,
                    item.service_name,
                    item.quantity,
                    item.unit_price,
                    item.total_price
                ]);
            }
        }

        res.json({
            success: true,
            message: 'Invoice created successfully',
            invoiceId: invoiceId
        });
    } catch (error) {
        console.error('Create invoice error:', error);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});

// ========================================
// UPDATE INVOICE
// ========================================
router.put('/invoices/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const {
            invoice_date,
            due_date,
            items,
            subtotal,
            discount,
            tax,
            total,
            notes,
            status
        } = req.body;

        const updated_by = req.user.id;

        // Update invoice
        await db.execute(`
            UPDATE invoices SET
                invoice_date = ?,
                due_date = ?,
                subtotal = ?,
                discount = ?,
                tax = ?,
                total = ?,
                notes = ?,
                status = ?,
                updated_by = ?,
                updated_at = NOW()
            WHERE id = ?
        `, [
            invoice_date,
            due_date,
            subtotal,
            discount,
            tax,
            total,
            notes,
            status,
            updated_by,
            id
        ]);

        // Delete existing items and re-insert
        await db.execute('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);

        if (items && items.length > 0) {
            for (const item of items) {
                await db.execute(`
                    INSERT INTO invoice_items (
                        invoice_id,
                        service_id,
                        service_name,
                        quantity,
                        unit_price,
                        total_price
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    id,
                    item.service_id || null,
                    item.service_name,
                    item.quantity,
                    item.unit_price,
                    item.total_price
                ]);
            }
        }

        res.json({
            success: true,
            message: 'Invoice updated successfully'
        });
    } catch (error) {
        console.error('Update invoice error:', error);
        res.status(500).json({ error: 'Failed to update invoice' });
    }
});

// ========================================
// DELETE INVOICE
// ========================================
router.delete('/invoices/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Delete invoice items first
        await db.execute('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);

        // Delete invoice
        await db.execute('DELETE FROM invoices WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Invoice deleted successfully'
        });
    } catch (error) {
        console.error('Delete invoice error:', error);
        res.status(500).json({ error: 'Failed to delete invoice' });
    }
});

// ========================================
// GET SINGLE INVOICE WITH ITEMS
// ========================================
router.get('/invoices/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get invoice
        const [invoices] = await db.execute(`
            SELECT
                i.*,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
                p.phone as patient_phone,
                p.email as patient_email,
                p.hn as patient_hn
            FROM invoices i
            LEFT JOIN patients p ON i.patient_id = p.id
            WHERE i.id = ?
        `, [id]);

        if (invoices.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const invoice = invoices[0];

        // Get invoice items
        const [items] = await db.execute(`
            SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id
        `, [id]);

        invoice.items = items;

        res.json(invoice);
    } catch (error) {
        console.error('Get invoice error:', error);
        res.status(500).json({ error: 'Failed to retrieve invoice' });
    }
});

module.exports = router;
