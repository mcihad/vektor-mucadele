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

router.get('/', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec("SELECT p.*, u.username FROM personnel p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.name");
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec("SELECT * FROM personnel WHERE id = ?", [req.params.id]);
        const rows = rowsToObjects(result);
        if (rows.length === 0) return res.status(404).json({ error: 'Personel bulunamadı' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', authMiddleware, async (req, res) => {
    const { name, role, phone, is_active } = req.body;
    const db = getDb();
    try {
        await db.run("UPDATE personnel SET name=?, role=?, phone=?, is_active=? WHERE id=?",
            [name, role, phone, is_active ? 1 : 0, req.params.id]);
        saveDatabase();
        res.json({ message: 'Personel güncellendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', authMiddleware, async (req, res) => {
    const { name, role, phone } = req.body;
    const db = getDb();
    try {
        await db.run("INSERT INTO personnel (name, role, phone) VALUES (?,?,?)", [name, role || 'operator', phone]);
        saveDatabase();
        res.json({ message: 'Personel eklendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
