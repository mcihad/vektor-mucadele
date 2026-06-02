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

// Dashboard stats
router.get('/dashboard', authMiddleware, async (req, res) => {
    const db = getDb();

    try {
        const todaySessions = rowsToObjects(await db.exec(
            "SELECT COUNT(*) as count FROM spray_sessions WHERE date(start_time) = date('now')"
        ));
        const activeSessions = rowsToObjects(await db.exec(
            "SELECT COUNT(*) as count FROM spray_sessions WHERE status = 'active'"
        ));
        const totalKmToday = rowsToObjects(await db.exec(
            "SELECT COALESCE(SUM(total_km),0) as total FROM spray_sessions WHERE date(start_time) = date('now')"
        ));
        const totalChemicalToday = rowsToObjects(await db.exec(
            "SELECT COALESCE(SUM(chemical_used_lt),0) as total FROM spray_sessions WHERE date(start_time) = date('now')"
        ));
        const pendingReports = rowsToObjects(await db.exec(
            "SELECT COUNT(*) as count FROM citizen_reports WHERE status = 'beklemede'"
        ));
        const lowStockChemicals = rowsToObjects(await db.exec(
            "SELECT COUNT(*) as count FROM chemicals WHERE stock_amount <= min_stock_alert"
        ));
        const totalCompleted = rowsToObjects(await db.exec(
            "SELECT COUNT(*) as count FROM spray_sessions WHERE status = 'completed'"
        ));
        const expiringStreets = rowsToObjects(await db.exec(
            "SELECT COUNT(*) as count FROM sprayed_streets WHERE expires_at <= datetime('now', '+3 days') AND expires_at > datetime('now')"
        ));
        const expiredStreets = rowsToObjects(await db.exec(
            "SELECT COUNT(*) as count FROM sprayed_streets WHERE expires_at <= datetime('now')"
        ));

        res.json({
            today_sessions: todaySessions[0]?.count || 0,
            active_sessions: activeSessions[0]?.count || 0,
            total_km_today: totalKmToday[0]?.total || 0,
            total_chemical_today: totalChemicalToday[0]?.total || 0,
            pending_reports: pendingReports[0]?.count || 0,
            low_stock_chemicals: lowStockChemicals[0]?.count || 0,
            total_completed: totalCompleted[0]?.count || 0,
            expiring_streets: expiringStreets[0]?.count || 0,
            expired_streets: expiredStreets[0]?.count || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Kamu İlaçlama Etki Haritası Verisi (Public) ───
router.get('/public/expiry-map', async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec(`
            SELECT ss.id, ss.street_name, ss.osm_way_id, ss.sprayed_at, ss.expires_at,
                   ss.geometry_geojson, ss.width_mt, ss.length_mt,
                   s.neighborhood, s.vehicle_id, v.plate,
                   CAST(julianday(ss.expires_at) - julianday('now') AS REAL) as days_remaining,
                   CAST(julianday('now') - julianday(ss.sprayed_at) AS REAL) as days_elapsed
            FROM sprayed_streets ss
            JOIN spray_sessions s ON ss.session_id = s.id
            LEFT JOIN vehicles v ON s.vehicle_id = v.id
            WHERE ss.sprayed_at >= datetime('now', '-35 days')
            ORDER BY ss.sprayed_at DESC
        `);
        res.json({ streets: rowsToObjects(result) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── 30 Günlük İlaç Etki Haritası Verisi ───
router.get('/expiry-map', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        // Son 35 gündeki tüm ilaçlanmış sokaklar (süre dolmuşlar dahil uyarı için)
        const result = await db.exec(`
            SELECT ss.id, ss.street_name, ss.osm_way_id, ss.sprayed_at, ss.expires_at,
                   ss.geometry_geojson, ss.width_mt, ss.length_mt,
                   s.neighborhood, s.vehicle_id, v.plate,
                   CAST(julianday(ss.expires_at) - julianday('now') AS REAL) as days_remaining,
                   CAST(julianday('now') - julianday(ss.sprayed_at) AS REAL) as days_elapsed
            FROM sprayed_streets ss
            JOIN spray_sessions s ON ss.session_id = s.id
            LEFT JOIN vehicles v ON s.vehicle_id = v.id
            WHERE ss.sprayed_at >= datetime('now', '-35 days')
            ORDER BY ss.sprayed_at DESC
        `);
        
        const streets = rowsToObjects(result);
        
        // Uyarı gerektiren bölgeleri grupla
        const warnings = [];
        const neighborhoodMap = new Map();
        
        streets.forEach(s => {
            const remaining = s.days_remaining || 0;
            const neighborhood = s.neighborhood || 'Bilinmeyen';
            
            if (!neighborhoodMap.has(neighborhood)) {
                neighborhoodMap.set(neighborhood, { total: 0, expired: 0, expiring: 0, minRemaining: 999 });
            }
            const n = neighborhoodMap.get(neighborhood);
            n.total++;
            
            if (remaining <= 0) n.expired++;
            else if (remaining <= 5) n.expiring++;
            
            if (remaining < n.minRemaining) n.minRemaining = remaining;
        });
        
        neighborhoodMap.forEach((data, name) => {
            if (data.expired > 0) {
                warnings.push({
                    type: 'expired',
                    severity: 'danger',
                    neighborhood: name,
                    message: `${name} mahallesinde ${data.expired} sokağın ilaçlama süresi dolmuş!`,
                    count: data.expired
                });
            }
            if (data.expiring > 0) {
                warnings.push({
                    type: 'expiring',
                    severity: 'warning',
                    neighborhood: name,
                    message: `${name} mahallesinde ${data.expiring} sokağın süresi dolmak üzere (${Math.ceil(data.minRemaining)} gün)`,
                    count: data.expiring,
                    days_remaining: Math.ceil(data.minRemaining)
                });
            }
        });
        
        res.json({ streets, warnings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sprayed streets - map data (for color-fading visualization)
router.get('/sprayed-streets', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec(`
            SELECT ss.*, s.neighborhood, v.plate,
                   CAST(julianday(ss.expires_at) - julianday('now') AS REAL) as days_remaining
            FROM sprayed_streets ss
            JOIN spray_sessions s ON ss.session_id = s.id
            LEFT JOIN vehicles v ON s.vehicle_id = v.id
            WHERE ss.sprayed_at >= datetime('now', '-35 days')
            ORDER BY ss.sprayed_at DESC
        `);
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Rota bazlı rapor ───
router.get('/route-report/:routeId', authMiddleware, async (req, res) => {
    const db = getDb();
    
    try {
        // Rota bilgisi
        const routeResult = await db.exec(`
            SELECT pr.*, v.plate, v.machine_name, u.full_name as assigned_user_name
            FROM planned_routes pr
            LEFT JOIN vehicles v ON pr.vehicle_id = v.id
            LEFT JOIN users u ON pr.assigned_user_id = u.id
            WHERE pr.id = ?
        `, [req.params.routeId]);
        const route = rowsToObjects(routeResult);
        
        if (route.length === 0) {
            return res.status(404).json({ error: 'Rota bulunamadı' });
        }
        
        // Bu rotaya bağlı oturumlar
        const sessionsResult = await db.exec(`
            SELECT s.*, v.plate, p1.name as driver_name, p2.name as operator_name
            FROM spray_sessions s
            LEFT JOIN vehicles v ON s.vehicle_id = v.id
            LEFT JOIN personnel p1 ON s.driver_id = p1.id
            LEFT JOIN personnel p2 ON s.operator_id = p2.id
            WHERE s.route_id = ?
            ORDER BY s.start_time DESC
        `, [req.params.routeId]);
        
        // Toplam istatistikler
        const statsResult = await db.exec(`
            SELECT COALESCE(SUM(total_km),0) as total_km,
                   COALESCE(SUM(chemical_used_lt),0) as total_chemical,
                   COALESCE(SUM(area_covered_m2),0) as total_area,
                   COUNT(*) as session_count
            FROM spray_sessions
            WHERE route_id = ?
        `, [req.params.routeId]);
        
        res.json({
            route: route[0],
            sessions: rowsToObjects(sessionsResult),
            stats: rowsToObjects(statsResult)[0] || {}
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Daily report
router.get('/daily', authMiddleware, async (req, res) => {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const db = getDb();

    try {
        const sessions = rowsToObjects(await db.exec(`
            SELECT s.*, v.plate, v.machine_name, 
                   p1.name as driver_name, p2.name as operator_name,
                   c.name as chemical_name
            FROM spray_sessions s
            LEFT JOIN vehicles v ON s.vehicle_id = v.id
            LEFT JOIN personnel p1 ON s.driver_id = p1.id
            LEFT JOIN personnel p2 ON s.operator_id = p2.id
            LEFT JOIN chemicals c ON s.chemical_id = c.id
            WHERE date(s.start_time) = ?
            ORDER BY s.start_time
        `, [targetDate]));

        const summary = rowsToObjects(await db.exec(`
            SELECT COUNT(*) as total_sessions,
                   COALESCE(SUM(total_km),0) as total_km,
                   COALESCE(SUM(chemical_used_lt),0) as total_chemical,
                   COALESCE(SUM(area_covered_m2),0) as total_area
            FROM spray_sessions
            WHERE date(start_time) = ?
        `, [targetDate]));

        res.json({ date: targetDate, summary: summary[0] || {}, sessions });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Monthly report
router.get('/monthly', authMiddleware, async (req, res) => {
    const { month, year } = req.query;
    const m = month || (new Date().getMonth() + 1);
    const y = year || new Date().getFullYear();
    const db = getDb();

    try {
        const daily = rowsToObjects(await db.exec(`
            SELECT date(start_time) as day,
                   COUNT(*) as sessions,
                   COALESCE(SUM(total_km),0) as km,
                   COALESCE(SUM(chemical_used_lt),0) as chemical,
                   COALESCE(SUM(area_covered_m2),0) as area
            FROM spray_sessions
            WHERE strftime('%m', start_time) = ? AND strftime('%Y', start_time) = ?
            GROUP BY date(start_time)
            ORDER BY day
        `, [String(m).padStart(2, '0'), String(y)]));

        const byVehicle = rowsToObjects(await db.exec(`
            SELECT v.plate, COUNT(*) as sessions,
                   COALESCE(SUM(s.total_km),0) as km,
                   COALESCE(SUM(s.chemical_used_lt),0) as chemical
            FROM spray_sessions s
            JOIN vehicles v ON s.vehicle_id = v.id
            WHERE strftime('%m', s.start_time) = ? AND strftime('%Y', s.start_time) = ?
            GROUP BY v.plate
        `, [String(m).padStart(2, '0'), String(y)]));

        const byPersonnel = rowsToObjects(await db.exec(`
            SELECT p.name, COUNT(*) as sessions,
                   COALESCE(SUM(s.total_km),0) as km
            FROM spray_sessions s
            JOIN personnel p ON s.driver_id = p.id OR s.operator_id = p.id
            WHERE strftime('%m', s.start_time) = ? AND strftime('%Y', s.start_time) = ?
            GROUP BY p.name
        `, [String(m).padStart(2, '0'), String(y)]));

        res.json({ month: m, year: y, daily, by_vehicle: byVehicle, by_personnel: byPersonnel });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Vehicle locations
router.get('/vehicle-locations', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec(`
            SELECT id, plate, machine_name, usage_type, last_lat, last_lng, last_location_time, is_active
            FROM vehicles
            WHERE last_lat IS NOT NULL
        `);
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Schedule - upcoming expirations
router.get('/schedule', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec(`
            SELECT ss.street_name, ss.sprayed_at, ss.expires_at,
                   s.neighborhood, v.plate,
                   CAST(julianday(ss.expires_at) - julianday('now') AS INTEGER) as days_remaining
            FROM sprayed_streets ss
            JOIN spray_sessions s ON ss.session_id = s.id
            LEFT JOIN vehicles v ON s.vehicle_id = v.id
            WHERE ss.expires_at >= datetime('now', '-5 days')
            ORDER BY ss.expires_at ASC
            LIMIT 100
        `);
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Neighborhood coverage
router.get('/neighborhood-coverage', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec(`
            SELECT s.neighborhood,
                   COUNT(DISTINCT ss.id) as streets_sprayed,
                   MAX(ss.sprayed_at) as last_sprayed,
                   MIN(ss.expires_at) as earliest_expiry,
                   CAST(MIN(julianday(ss.expires_at) - julianday('now')) AS INTEGER) as min_days_remaining
            FROM sprayed_streets ss
            JOIN spray_sessions s ON ss.session_id = s.id
            WHERE ss.sprayed_at >= datetime('now', '-35 days')
            GROUP BY s.neighborhood
            ORDER BY min_days_remaining ASC
        `);
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
