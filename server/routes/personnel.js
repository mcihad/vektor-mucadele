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
    const { name, role, phone, is_active, user_id, status } = req.body;
    const db = getDb();
    let sql = "UPDATE personnel SET";
    const sets = [];
    const params = [];
    if (name !== undefined) { sets.push(" name = ?"); params.push(name); }
    if (role !== undefined) { sets.push(" role = ?"); params.push(role); }
    if (phone !== undefined) { sets.push(" phone = ?"); params.push(phone); }
    if (is_active !== undefined) { sets.push(" is_active = ?"); params.push(is_active); }
    if (user_id !== undefined) { sets.push(" user_id = ?"); params.push(user_id || null); }
    if (status !== undefined) { sets.push(" status = ?"); params.push(status); }
    if (sets.length === 0) return res.status(400).json({ error: 'Güncellenecek alan yok' });
    sql += sets.join(',') + " WHERE id = ?";
    params.push(req.params.id);
    try {
        await db.run(sql, params);
        saveDatabase();
        res.json({ message: 'Personel güncellendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', authMiddleware, async (req, res) => {
    const { name, role, phone, user_id, status } = req.body;
    const db = getDb();
    try {
        await db.run("INSERT INTO personnel (name, role, phone, user_id, status) VALUES (?,?,?,?,?)",
            [name, role || 'operator', phone, user_id || null, status || 'aktif']);
        saveDatabase();
        const result = await db.exec("SELECT last_insert_rowid()");
        const lastId = result[0].values[0][0];
        res.json({ id: lastId, message: 'Personel eklendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete personnel
router.delete('/:id', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const activeSessions = rowsToObjects(await db.exec(
            "SELECT id FROM spray_sessions WHERE (driver_id = ? OR operator_id = ?) AND status IN ('planned', 'active')", [req.params.id, req.params.id]
        ));
        if (activeSessions.length > 0) {
            return res.status(400).json({ error: 'Bu personel aktif oturumlarda görevli, silinemez' });
        }
        await db.run("DELETE FROM personnel WHERE id = ?", [req.params.id]);
        saveDatabase();
        res.json({ message: 'Personel silindi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
