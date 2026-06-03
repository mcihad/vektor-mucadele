const express = require('express');
const router = express.Router();
const { getDb, saveDatabase } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

function rowsToObjects(result) {
    if (!result || result.length === 0) return [];
    const cols = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => obj[c] = row[i]);
        return obj;
    });
}

// Get all chemicals with stock info
router.get('/', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec("SELECT * FROM chemicals ORDER BY name");
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add stock (incoming)
router.post('/:id/stock-in', authMiddleware, async (req, res) => {
    const { amount, description } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Geçersiz miktar' });

    const db = getDb();
    try {
        await db.run("UPDATE chemicals SET stock_amount = stock_amount + ? WHERE id = ?", [amount, req.params.id]);
        await db.run(`INSERT INTO chemical_transactions (chemical_id, transaction_type, amount, description) VALUES (?, 'giris', ?, ?)`,
            [req.params.id, amount, description || 'Stok girişi']);
        saveDatabase();
        res.json({ message: 'Stok eklendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get transaction history
router.get('/:id/transactions', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec(`
            SELECT ct.*, c.name as chemical_name
            FROM chemical_transactions ct
            JOIN chemicals c ON ct.chemical_id = c.id
            WHERE ct.chemical_id = ?
            ORDER BY ct.created_at DESC
            LIMIT 50
        `, [req.params.id]);
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add new chemical
router.post('/', authMiddleware, async (req, res) => {
    const { name, type, stock_amount, min_stock_alert } = req.body;
    const db = getDb();
    try {
        await db.run("INSERT INTO chemicals (name, type, stock_amount, min_stock_alert) VALUES (?,?,?,?)",
            [name, type, stock_amount || 0, min_stock_alert || 50]);
        saveDatabase();
        res.json({ message: 'İlaç eklendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Edit chemical
router.put('/:id', authMiddleware, async (req, res) => {
    const { name, type, min_stock_alert, stock_amount } = req.body;
    const db = getDb();
    let sql = "UPDATE chemicals SET";
    const sets = [];
    const params = [];
    if (name !== undefined) { sets.push(" name = ?"); params.push(name); }
    if (type !== undefined) { sets.push(" type = ?"); params.push(type); }
    if (min_stock_alert !== undefined) { sets.push(" min_stock_alert = ?"); params.push(min_stock_alert); }
    if (stock_amount !== undefined) { sets.push(" stock_amount = ?"); params.push(stock_amount); }
    if (sets.length === 0) return res.status(400).json({ error: 'Güncellenecek alan yok' });
    sql += sets.join(',') + " WHERE id = ?";
    params.push(req.params.id);
    try {
        await db.run(sql, params);
        saveDatabase();
        res.json({ message: 'İlaç güncellendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete chemical
router.delete('/:id', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        // Check if chemical is used in any active session
        const activeSessions = rowsToObjects(await db.exec(
            "SELECT id FROM spray_sessions WHERE chemical_id = ? AND status IN ('planned', 'active')", [req.params.id]
        ));
        if (activeSessions.length > 0) {
            return res.status(400).json({ error: 'Bu ilaç aktif oturumlarda kullanılıyor, silinemez' });
        }
        await db.run("DELETE FROM chemicals WHERE id = ?", [req.params.id]);
        saveDatabase();
        res.json({ message: 'İlaç silindi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Low stock alerts
router.get('/alerts/low-stock', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec("SELECT * FROM chemicals WHERE stock_amount <= min_stock_alert");
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
