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

// Get all vehicles (with online_status based on 30 second movement threshold and currently assigned active/planned personnel)
router.get('/', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const query = `
            SELECT v.*, 
                   s.id as active_session_id,
                   p1.name as driver_name, p1.status as driver_status,
                   p2.name as operator_name, p2.status as operator_status
            FROM vehicles v
            LEFT JOIN spray_sessions s ON s.id = (
                SELECT id FROM spray_sessions 
                WHERE vehicle_id = v.id AND status IN ('planned', 'active', 'beklemede')
                ORDER BY created_at DESC LIMIT 1
            )
            LEFT JOIN personnel p1 ON s.driver_id = p1.id
            LEFT JOIN personnel p2 ON s.operator_id = p2.id
            ORDER BY v.plate
        `;
        const result = await db.exec(query);
        const vehicles = rowsToObjects(result);
        // Her araç için çevrimiçi/çevrimdışı durumunu hesapla (30 sn eşik)
        const now = Date.now();
        const enriched = vehicles.map(v => ({
            ...v,
            online_status: v.last_location_time && (now - new Date(v.last_location_time).getTime()) < 30000 ? 'çevrimiçi' : 'çevrimdışı'
        }));
        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current vehicle stock levels (tank remaining amounts)
router.get('/stock/levels', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const query = `
            SELECT v.id as vehicle_id, v.plate, v.machine_name, v.tank_capacity_lt, v.usage_type,
                   v.tank_chemical_id, COALESCE(v.tank_chemical_amount, 0) as tank_chemical_amount,
                   s.id as session_id, s.status as session_status,
                   s.intake_amount_lt, s.chemical_used_lt,
                   COALESCE(c2.name, c.name) as chemical_name
            FROM vehicles v
            LEFT JOIN spray_sessions s ON s.id = (
                SELECT id FROM spray_sessions
                WHERE vehicle_id = v.id
                ORDER BY start_time DESC, id DESC
                LIMIT 1
            )
            LEFT JOIN chemicals c ON s.chemical_id = c.id
            LEFT JOIN chemicals c2 ON v.tank_chemical_id = c2.id
            ORDER BY v.plate
        `;
        const result = await db.exec(query);
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all fuel logs
router.get('/fuel/logs', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const query = `
            SELECT fl.*, v.plate as vehicle_plate, v.machine_name, p.name as driver_name
            FROM vehicle_fuel_logs fl
            JOIN vehicles v ON fl.vehicle_id = v.id
            LEFT JOIN personnel p ON fl.driver_id = p.id
            ORDER BY fl.fill_date DESC
        `;
        const result = await db.exec(query);
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get fuel logs summary stats
router.get('/fuel/stats', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const query = `
            SELECT 
                COALESCE(SUM(fuel_liters), 0) as total_liters,
                COALESCE(SUM(total_cost), 0) as total_cost,
                COUNT(*) as total_records,
                COALESCE(AVG(price_per_liter), 0) as avg_price
            FROM vehicle_fuel_logs
        `;
        const result = await db.exec(query);
        const stats = rowsToObjects(result);
        res.json(stats[0] || { total_liters: 0, total_cost: 0, total_records: 0, avg_price: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save a new fuel log
router.post('/fuel/logs', authMiddleware, async (req, res) => {
    const { vehicle_id, driver_id, odometer, fuel_liters, price_per_liter, total_cost, station_name, description, fuel_type } = req.body;
    const db = getDb();
    try {
        await db.run(`
            INSERT INTO vehicle_fuel_logs (vehicle_id, driver_id, odometer, fuel_liters, price_per_liter, total_cost, station_name, description, fuel_type, fill_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
            vehicle_id, 
            driver_id ? parseInt(driver_id) : null, 
            parseFloat(odometer), 
            parseFloat(fuel_liters), 
            price_per_liter ? parseFloat(price_per_liter) : null, 
            parseFloat(total_cost), 
            station_name || null, 
            description || null,
            fuel_type || null
        ]);
        saveDatabase();
        res.json({ message: 'Yakıt kaydı başarıyla eklendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a fuel log
router.delete('/fuel/logs/:id', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        await db.run("DELETE FROM vehicle_fuel_logs WHERE id = ?", [req.params.id]);
        saveDatabase();
        res.json({ message: 'Yakıt kaydı silindi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get vehicle stock transaction history
router.get('/:id/transactions', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec(`
            SELECT vt.*, c.name as chemical_name, v.plate as vehicle_plate,
                   s.id as session_id, s.application_type, s.intake_received_from as session_received_from,
                   d.name as driver_name, op.name as operator_name
            FROM vehicle_stock_transactions vt
            LEFT JOIN chemicals c ON vt.chemical_id = c.id
            LEFT JOIN vehicles v ON vt.vehicle_id = v.id
            LEFT JOIN spray_sessions s ON vt.session_id = s.id
            LEFT JOIN personnel d ON s.driver_id = d.id
            LEFT JOIN personnel op ON s.operator_id = op.id
            WHERE vt.vehicle_id = ?
            ORDER BY vt.created_at DESC
            LIMIT 50
        `, [req.params.id]);
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
