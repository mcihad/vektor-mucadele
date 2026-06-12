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


// ─── Mobiliz Entegrasyonu (Simüle Edilmiş Araç Listesi ve Konumları) ───
router.get('/mobiliz', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const query = `
            SELECT v.*, 
                   p1.name as driver_name,
                   p2.name as operator_name
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
        
        // Simüle edilmiş Mobiliz konumları ve online durumları (Sistem GPS'ten farklı olsun)
        const mockPositions = {
            '58 TD 620': { lat: 39.7495, lng: 37.0125, status: 'çevrimiçi' },
            '58 TD 621': { lat: 39.7420, lng: 37.0250, status: 'çevrimiçi' },
            '58 TD 622': { lat: 39.7610, lng: 37.0090, status: 'çevrimdışı' },
            '58 TD 623': { lat: 39.7380, lng: 36.9850, status: 'çevrimdışı' }
        };
        
        const now = new Date();
        const enriched = vehicles.map((v, i) => {
            const mock = mockPositions[v.plate] || {
                lat: 39.7500 + (v.id * 0.003),
                lng: 37.0150 - (v.id * 0.004),
                status: (v.id % 2 === 0) ? 'çevrimiçi' : 'çevrimdışı'
            };
            return {
                ...v,
                last_lat: mock.lat,
                last_lng: mock.lng,
                online_status: mock.status,
                last_location_time: mock.status === 'çevrimiçi' 
                    ? new Date(now.getTime() - 45000).toISOString() 
                    : new Date(now.getTime() - 3600000 * 4).toISOString()
            };
        });
        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Mobiliz Entegrasyonu (Simüle Edilmiş Sürüş Raporları / Oturumları) ───
router.get('/mobiliz/sessions', authMiddleware, async (req, res) => {
    const db = getDb();
    const { date_from, date_to } = req.query;
    try {
        const result = await db.exec("SELECT * FROM vehicles ORDER BY id");
        const vehicles = rowsToObjects(result);
        
        const startStr = date_from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        const endStr = date_to || new Date().toISOString().split('T')[0];
        
        const sessions = [];
        const start = new Date(startStr);
        const end = new Date(endStr + 'T23:59:59');
        
        const neighborhoods = ["Fatih", "Şeyh Şamil", "Diriliş", "Kılavuz", "Yüceyurt", "Yenişehir", "Alibaba", "Mimar Sinan", "Kardeşler", "Esentepe"];
        const drivers = ["Ahmet Yılmaz", "Kamil Kaya", "Ufuk Demir", "Samet Öztürk", "Tolga Şahin"];
        
        let sessionId = 90000;
        const limitDays = 31;
        let dayCount = 0;
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            dayCount++;
            if (dayCount > limitDays) break;
            
            const dateStr = d.toISOString().split('T')[0];
            
            vehicles.forEach(v => {
                // Deterministic seed based on vehicle ID and day
                const seed = (v.id * 33 + d.getDate() * 7) % 100;
                if (seed > 85) return; // 15% idle chance
                
                const startHour = 8 + (seed % 4); // 8 to 11
                const durationHours = 2 + (seed % 5); // 2 to 6 hours
                
                const startStr = `${dateStr}T${String(startHour).padStart(2, '0')}:30:00Z`;
                const endStr = `${dateStr}T${String(startHour + durationHours).padStart(2, '0')}:${String(seed % 60).padStart(2, '0')}:00Z`;
                
                // Mobiliz hardware tracking is usually ~5% to 15% higher mileage than app pings
                const totalKm = durationHours * (14 + (seed % 8)); 
                
                sessions.push({
                    id: sessionId++,
                    vehicle_id: v.id,
                    driver_name: drivers[seed % drivers.length],
                    neighborhood: neighborhoods[seed % neighborhoods.length] + " Mah.",
                    application_type: v.usage_type || "sokak_ilacalama",
                    start_time: startStr,
                    end_time: endStr,
                    total_km: parseFloat(totalKm.toFixed(1)),
                    status: 'completed',
                    chemical_name: 'Simüle (Mobiliz GPS)',
                    chemical_used_lt: 0
                });
            });
        }
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Araç Takip Yorum / Analiz Değerlendirme Çekme ───
router.get('/comments', authMiddleware, async (req, res) => {
    const { vehicle_id, period_type, period_date, source_type } = req.query;
    if (!period_type || !period_date || !source_type) {
        return res.status(400).json({ error: 'Gerekli parametreler eksik' });
    }
    const db = getDb();
    const vId = (!vehicle_id || vehicle_id === 'all' || vehicle_id === '0') ? null : parseInt(vehicle_id);
    try {
        let query = `
            SELECT * FROM vehicle_tracking_comments 
            WHERE period_type = ? AND period_date = ? AND source_type = ?
        `;
        const params = [period_type, period_date, source_type];
        if (vId === null) {
            query += " AND vehicle_id IS NULL";
        } else {
            query += " AND vehicle_id = ?";
            params.push(vId);
        }
        const result = await db.exec(query, params);
        const rows = rowsToObjects(result);
        res.json(rows[0] || { comment_text: '' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Araç Takip Yorum / Analiz Değerlendirme Kaydetme ───
router.post('/comments', authMiddleware, async (req, res) => {
    const { vehicle_id, period_type, period_date, source_type, comment_text } = req.body;
    if (!period_type || !period_date || !source_type || comment_text === undefined) {
        return res.status(400).json({ error: 'Gerekli alanlar eksik' });
    }
    const db = getDb();
    const vId = (!vehicle_id || vehicle_id === 'all' || vehicle_id === '0') ? null : parseInt(vehicle_id);
    try {
        let selectQuery = `SELECT id FROM vehicle_tracking_comments WHERE period_type = ? AND period_date = ? AND source_type = ?`;
        const selectParams = [period_type, period_date, source_type];
        if (vId === null) {
            selectQuery += " AND vehicle_id IS NULL";
        } else {
            selectQuery += " AND vehicle_id = ?";
            selectParams.push(vId);
        }
        const checkResult = await db.exec(selectQuery, selectParams);
        const rows = rowsToObjects(checkResult);
        
        if (rows.length > 0) {
            const commentId = rows[0].id;
            await db.run(`UPDATE vehicle_tracking_comments SET comment_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [comment_text, commentId]);
        } else {
            await db.run(`INSERT INTO vehicle_tracking_comments (vehicle_id, period_type, period_date, source_type, comment_text) VALUES (?, ?, ?, ?, ?)`, 
                [vId, period_type, period_date, source_type, comment_text]);
        }
        saveDatabase();
        res.json({ success: true, message: 'Yönetici yorumu başarıyla kaydedildi' });
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
    const { machine_name, tank_capacity_lt, consumption_info, spray_width_mt, usage_type, is_active, device_id } = req.body;
    const db = getDb();
    try {
        await db.run(`UPDATE vehicles SET machine_name=?, tank_capacity_lt=?, consumption_info=?, 
                spray_width_mt=?, usage_type=?, is_active=?, device_id=? WHERE id=?`,
            [machine_name, tank_capacity_lt, consumption_info, spray_width_mt, usage_type, is_active ? 1 : 0, device_id || null, req.params.id]);
        saveDatabase();
        res.json({ message: 'Araç güncellendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new vehicle
router.post('/', authMiddleware, async (req, res) => {
    const { plate, machine_name, machine_type, tank_capacity_lt, consumption_info, spray_width_mt, usage_type, is_active, device_id } = req.body;
    const db = getDb();
    try {
        await db.run(`INSERT INTO vehicles (plate, machine_name, machine_type, tank_capacity_lt, consumption_info, spray_width_mt, usage_type, is_active, device_id)
                VALUES (?,?,?,?,?,?,?,?,?)`,
            [plate, machine_name, machine_type || 'ulv', tank_capacity_lt, consumption_info, spray_width_mt || 10, usage_type, is_active ? 1 : 0, device_id || null]);
        saveDatabase();
        res.json({ message: 'Araç başarıyla eklendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Device anonymous location ping (Public)
router.post('/device-ping', async (req, res) => {
    const { device_uuid, latitude, longitude, speed } = req.body;
    if (!device_uuid || !latitude || !longitude) {
        return res.status(400).json({ error: 'Eksik konum veya cihaz parametreleri' });
    }
    const db = getDb();
    try {
        const result = await db.exec("SELECT id, plate FROM vehicles WHERE device_id = ?", [device_uuid]);
        const vehicles = rowsToObjects(result);
        if (vehicles.length === 0) {
            return res.status(404).json({ error: 'Bu cihaz koduna atanmış bir araç bulunamadı' });
        }
        const vehicle = vehicles[0];

        await db.run(
            "UPDATE vehicles SET last_lat = ?, last_lng = ?, last_location_time = datetime('now') WHERE id = ?",
            [latitude, longitude, vehicle.id]
        );
        // Log to vehicle_location_log
        await db.run(
            "INSERT INTO vehicle_location_log (vehicle_id, latitude, longitude, speed_kmh, is_spraying) VALUES (?,?,?,?,0)",
            [vehicle.id, latitude, longitude, speed || 0]
        );
        saveDatabase();

        const io = req.app.get('io');
        if (io) {
            io.emit('vehicle-update', {
                vehicle_id: vehicle.id,
                plate: vehicle.plate,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                speed: parseFloat(speed) || 0,
                is_spraying: 0
            });
        }
        res.json({ ok: true, vehicle: vehicle.plate });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get vehicle location history with datetime filters
router.get('/:id/history', authMiddleware, async (req, res) => {
    const db = getDb();
    const { date_from, date_to } = req.query;
    if (!date_from || !date_to) {
        return res.status(400).json({ error: 'Başlangıç ve bitiş tarih/saat bilgileri zorunludur' });
    }
    try {
        const result = await db.exec(
            "SELECT * FROM vehicle_location_log WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC",
            [req.params.id, date_from, date_to]
        );
        res.json(rowsToObjects(result));
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
