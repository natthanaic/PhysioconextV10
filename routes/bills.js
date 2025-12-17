// routes/bills.js - Bills and Billing Management Routes
const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');

// ========================================
// GET ALL BILLS
// ========================================
router.get('/bills', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { startDate, endDate, status, patientId } = req.query;

        let query = `
            SELECT
                b.*,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
                p.phone as patient_phone,
                p.email as patient_email
            FROM bills b
            LEFT JOIN patients p ON b.patient_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (startDate && endDate) {
            query += ` AND b.bill_date BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }

        if (status) {
            query += ` AND b.status = ?`;
            params.push(status);
        }

        if (patientId) {
            query += ` AND b.patient_id = ?`;
            params.push(patientId);
        }

        query += ` ORDER BY b.bill_date DESC, b.created_at DESC`;

        const [bills] = await db.execute(query, params);
        res.json(bills);
    } catch (error) {
        console.error('Get bills error:', error);
        res.status(500).json({ error: 'Failed to retrieve bills' });
    }
});

// ========================================
// GET BILLING SERVICES
// ========================================
router.get('/bills/services', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id } = req.query;

        let query = `
            SELECT
                id,
                service_name as name,
                service_code as code,
                price,
                category,
                description,
                active
            FROM services
            WHERE active = 1
        `;
        const params = [];

        if (clinic_id) {
            query += ` AND (clinic_id = ? OR clinic_id IS NULL)`;
            params.push(clinic_id);
        }

        query += ` ORDER BY category, service_name`;

        const [services] = await db.execute(query, params);
        res.json(services);
    } catch (error) {
        console.error('Get services error:', error);
        res.status(500).json({ error: 'Failed to retrieve services' });
    }
});

// ========================================
// CREATE NEW BILL
// ========================================
router.post('/bills', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            patient_id,
            bill_date,
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

        // Insert bill
        const [result] = await db.execute(`
            INSERT INTO bills (
                patient_id,
                bill_date,
                due_date,
                subtotal,
                discount,
                tax,
                total,
                notes,
                status,
                created_by,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
            patient_id,
            bill_date,
            due_date,
            subtotal || 0,
            discount || 0,
            tax || 0,
            total,
            notes || '',
            status || 'pending',
            created_by
        ]);

        const billId = result.insertId;

        // Insert bill items
        if (items && items.length > 0) {
            for (const item of items) {
                await db.execute(`
                    INSERT INTO bill_items (
                        bill_id,
                        service_id,
                        service_name,
                        quantity,
                        unit_price,
                        total_price
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    billId,
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
            message: 'Bill created successfully',
            billId: billId
        });
    } catch (error) {
        console.error('Create bill error:', error);
        res.status(500).json({ error: 'Failed to create bill' });
    }
});

// ========================================
// UPDATE BILL
// ========================================
router.put('/bills/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const {
            bill_date,
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

        // Update bill
        await db.execute(`
            UPDATE bills SET
                bill_date = ?,
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
            bill_date,
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
        await db.execute('DELETE FROM bill_items WHERE bill_id = ?', [id]);

        if (items && items.length > 0) {
            for (const item of items) {
                await db.execute(`
                    INSERT INTO bill_items (
                        bill_id,
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
            message: 'Bill updated successfully'
        });
    } catch (error) {
        console.error('Update bill error:', error);
        res.status(500).json({ error: 'Failed to update bill' });
    }
});

// ========================================
// DELETE BILL
// ========================================
router.delete('/bills/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Delete bill items first
        await db.execute('DELETE FROM bill_items WHERE bill_id = ?', [id]);

        // Delete bill
        await db.execute('DELETE FROM bills WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Bill deleted successfully'
        });
    } catch (error) {
        console.error('Delete bill error:', error);
        res.status(500).json({ error: 'Failed to delete bill' });
    }
});

// ========================================
// GET SINGLE BILL WITH ITEMS
// ========================================
router.get('/bills/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get bill
        const [bills] = await db.execute(`
            SELECT
                b.*,
                CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
                p.phone as patient_phone,
                p.email as patient_email,
                p.hn as patient_hn
            FROM bills b
            LEFT JOIN patients p ON b.patient_id = p.id
            WHERE b.id = ?
        `, [id]);

        if (bills.length === 0) {
            return res.status(404).json({ error: 'Bill not found' });
        }

        const bill = bills[0];

        // Get bill items
        const [items] = await db.execute(`
            SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id
        `, [id]);

        bill.items = items;

        res.json(bill);
    } catch (error) {
        console.error('Get bill error:', error);
        res.status(500).json({ error: 'Failed to retrieve bill' });
    }
});

module.exports = router;
