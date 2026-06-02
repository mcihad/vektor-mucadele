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

// Get all vehicles
router.get('/', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec("SELECT * FROM vehicles ORDER BY plate");
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get vehicle by id
router.get('/:id', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec("SELECT * FROM vehicles WHERE id = ?", [req.params.id]);
        const rows = rowsToObjects(result);
        if (rows.length === 0) return res.status(404).json({ error: 'Araç bulunamadı' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update vehicle location (from mobile)
router.post('/:id/location', authMiddleware, async (req, res) => {
    const { latitude, longitude } = req.body;
    const db = getDb();
    try {
        await db.run("UPDATE vehicles SET last_lat = ?, last_lng = ?, last_location_time = datetime('now') WHERE id = ?",
            [latitude, longitude, req.params.id]);
        saveDatabase();
        res.json({ message: 'Konum güncellendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update vehicle
router.put('/:id', authMiddleware, async (req, res) => {
    const { machine_name, tank_capacity_lt, consumption_info, spray_width_mt, usage_type, is_active } = req.body;
    const db = getDb();
    try {
        await db.run(`UPDATE vehicles SET machine_name=?, tank_capacity_lt=?, consumption_info=?, 
                spray_width_mt=?, usage_type=?, is_active=? WHERE id=?`,
            [machine_name, tank_capacity_lt, consumption_info, spray_width_mt, usage_type, is_active ? 1 : 0, req.params.id]);
        saveDatabase();
        res.json({ message: 'Araç güncellendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new vehicle
router.post('/', authMiddleware, async (req, res) => {
    const { plate, machine_name, machine_type, tank_capacity_lt, consumption_info, spray_width_mt, usage_type, is_active } = req.body;
    const db = getDb();
    try {
        await db.run(`INSERT INTO vehicles (plate, machine_name, machine_type, tank_capacity_lt, consumption_info, spray_width_mt, usage_type, is_active)
                VALUES (?,?,?,?,?,?,?,?)`,
            [plate, machine_name, machine_type || 'ulv', tank_capacity_lt, consumption_info, spray_width_mt || 10, usage_type, is_active ? 1 : 0]);
        saveDatabase();
        res.json({ message: 'Araç başarıyla eklendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete vehicle
router.delete('/:id', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        await db.run("DELETE FROM vehicles WHERE id = ?", [req.params.id]);
        saveDatabase();
        res.json({ message: 'Araç başarıyla kaldırıldı' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
