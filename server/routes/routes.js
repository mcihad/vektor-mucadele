const express = require('express');
const router = express.Router();
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const { getDb, saveDatabase } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { fetchStreets } = require('../services/overpass');
const { solveChinesePostman } = require('../services/chinesePostman');

function getPythonCommand() {
    // Priority 1: User defined PYTHON_PATH in .env
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
        console.log(`[Python Detector] Using custom PYTHON_PATH: ${process.env.PYTHON_PATH}`);
        return process.env.PYTHON_PATH;
    }

    if (process.platform === 'win32') {
        const pathsToTry = [];

        // Scan standard user directories for local Python installations
        try {
            const usersDir = 'C:\\Users';
            if (fs.existsSync(usersDir)) {
                const users = fs.readdirSync(usersDir);
                for (const user of users) {
                    if (['All Users', 'Default', 'Default User', 'Public', 'desktop.ini'].includes(user)) continue;

                    const pythonDir = path.join(usersDir, user, 'AppData', 'Local', 'Programs', 'Python');
                    if (fs.existsSync(pythonDir)) {
                        const versions = fs.readdirSync(pythonDir);
                        for (const ver of versions) {
                            const pyPath = path.join(pythonDir, ver, 'python.exe');
                            if (fs.existsSync(pyPath)) {
                                pathsToTry.push(pyPath);
                            }
                        }
                    }
                    
                    const pyLauncherPath = path.join(pythonDir, 'Launcher', 'py.exe');
                    if (fs.existsSync(pyLauncherPath)) {
                        pathsToTry.push(pyLauncherPath);
                    }
                }
            }
        } catch (e) {
            console.error('[Python Detector] Error scanning user directories:', e.message);
        }

        // Common system-wide paths
        const systemWidePaths = [
            'C:\\Windows\\py.exe',
            'C:\\Program Files\\Python312\\python.exe',
            'C:\\Program Files\\Python311\\python.exe',
            'C:\\Program Files\\Python310\\python.exe',
            'C:\\Program Files\\Python39\\python.exe',
            'C:\\Program Files (x86)\\Python312-32\\python.exe',
            'C:\\Program Files (x86)\\Python311-32\\python.exe',
            'C:\\Program Files (x86)\\Python310-32\\python.exe'
        ];
        pathsToTry.push(...systemWidePaths);

        // Find the first one that exists on disk
        for (const p of pathsToTry) {
            if (fs.existsSync(p)) {
                console.log(`[Python Detector] Auto-detected Python executable: ${p}`);
                return p;
            }
        }
    }

    // Default fallback
    return 'python';
}

function fetchLocalStreets(south, west, north, east, neighborhood = '') {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '..', 'services', 'query_streets.py');
        const pythonCmd = getPythonCommand();
        console.log(`[Routes] Spawning Python process: "${pythonCmd}" "${scriptPath}"`);
        const child = cp.spawn(pythonCmd, [scriptPath]);
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`Python script exited with code ${code}. Stderr: ${stderr}`));
            }
            try {
                const geojson = JSON.parse(stdout);
                if (geojson.error) {
                    return reject(new Error(geojson.error));
                }
                resolve(geojson);
            } catch (err) {
                reject(new Error(`Failed to parse Python output: ${err.message}. Output: ${stdout.slice(0, 200)}`));
            }
        });
        
        child.on('error', (err) => {
            reject(err);
        });
        
        child.stdin.write(JSON.stringify({ south, west, north, east, neighborhood }));
        child.stdin.end();
    });
}

function rowsToObjects(result) {
    if (!result || result.length === 0) return [];
    const cols = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => obj[c] = row[i]);
        return obj;
    });
}

// Get neighborhoods
router.get('/neighborhoods', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec("SELECT * FROM neighborhoods ORDER BY name");
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get public neighborhood names (no auth required)
router.get('/public/neighborhoods', async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec("SELECT name FROM neighborhoods ORDER BY name");
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get application types
router.get('/application-types', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec("SELECT * FROM application_types WHERE is_active = 1 ORDER BY name");
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── OSM: Sokakları çek (Overpass API) ───
router.post('/fetch-streets', authMiddleware, async (req, res) => {
    const { south, west, north, east, neighborhood } = req.body;
    if (!south || !west || !north || !east) {
        return res.status(400).json({ error: 'Bounding box koordinatları gerekli (south, west, north, east)' });
    }

    // 1. ÖNCELİK: Canlı OpenStreetMap Overpass API (Trafik kuralları, Tek Yön ve Yaya yollarını barındırır!)
    try {
        console.log(`[Routes] Canlı OpenStreetMap Overpass API'den sokaklar çekiliyor. BBox: ${south},${west},${north},${east}`);
        const geojson = await fetchStreets(
            parseFloat(south), parseFloat(west),
            parseFloat(north), parseFloat(east)
        );
        
        if (geojson.features && geojson.features.length > 0) {
            console.log(`[Routes] Canlı OSM'den ${geojson.features.length} sokak başarıyla çekildi.`);
            return res.json(geojson);
        }
        console.warn('[Routes] Canlı OSM veri tabanında sokak bulunamadı, yerel GPKG fall-back deneniyor...');
    } catch (err) {
        console.error('[Routes] Canlı OSM Overpass Hatası:', err.message);
        console.log('[Routes] Yerel GPKG veri tabanına (yedek olarak) geçiliyor...');
    }

    // 2. YEDEK: Yerel GPKG Veri Tabanı (Çevrimdışı/Offline durumlar için)
    try {
        console.log(`[Routes] Yerel GPKG veri tabanından sokaklar sorgulanıyor. BBox: ${south},${west},${north},${east} | Mahalle: ${neighborhood || 'Tümü'}`);
        const geojson = await fetchLocalStreets(
            parseFloat(south), parseFloat(west),
            parseFloat(north), parseFloat(east),
            neighborhood
        );
        
        if (geojson.features && geojson.features.length > 0) {
            console.log(`[Routes] Yerel GPKG veri tabanından (Yedek) ${geojson.features.length} sokak başarıyla çekildi.`);
            return res.json(geojson);
        }
        res.status(404).json({ error: 'Belirtilen sınırlar içerisinde hiçbir sokak bulunamadı!' });
    } catch (localErr) {
        console.error('[Routes] Yerel GPKG sorgu hatası:', localErr.message);
        res.status(500).json({ error: 'Sokak verisi alınamadı (Hem Canlı Sunucular hem de Yerel Veritabanı başarısız oldu): ' + localErr.message });
    }
});

// ─── Otomatik rota hesapla (Chinese Postman) ───
router.post('/calculate-route', authMiddleware, async (req, res) => {
    const { geojson, machine_type, tank_capacity, transport_type } = req.body;
    if (!geojson) {
        return res.status(400).json({ error: 'GeoJSON verisi gerekli' });
    }

    try {
        const data = typeof geojson === 'string' ? JSON.parse(geojson) : geojson;
        const result = await solveChinesePostman(
            data,
            machine_type || 'ulv',
            parseFloat(tank_capacity) || 100,
            transport_type || 'vehicle'
        );

        if (result.error) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (err) {
        console.error('[Routes] CPP hatası:', err.message);
        res.status(500).json({ error: 'Rota hesaplanamadı: ' + err.message });
    }
});

// ─── Manuel rota kaydet ───
router.post('/manual-route', authMiddleware, async (req, res) => {
    const { neighborhood, vehicle_id, route_coords, total_distance_km, estimated_time_min, estimated_chemical_lt, planned_date, name } = req.body;
    const db = getDb();
    
    try {
        await db.run(`INSERT INTO planned_routes (name, neighborhood, vehicle_id, route_coords, total_distance_km, estimated_time_min, estimated_chemical_lt, route_type, planned_date)
                VALUES (?,?,?,?,?,?,?,?,?)`,
            [name || 'Manuel Rota', neighborhood, vehicle_id, JSON.stringify(route_coords), total_distance_km, estimated_time_min, estimated_chemical_lt, 'manual', planned_date]);
        saveDatabase();
        const result = await db.exec("SELECT last_insert_rowid()");
        const lastId = result[0].values[0][0];
        res.json({ id: lastId, message: 'Manuel rota kaydedildi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Get planned routes ───
router.get('/planned-routes', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec(`
            SELECT pr.*, v.plate, v.machine_name, u.full_name as assigned_user_name
            FROM planned_routes pr
            LEFT JOIN vehicles v ON pr.vehicle_id = v.id
            LEFT JOIN users u ON pr.assigned_user_id = u.id
            ORDER BY pr.planned_date DESC
        `);
        res.json(rowsToObjects(result));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Save planned route (auto or manual) ───
router.post('/planned-routes', authMiddleware, async (req, res) => {
    const { name, neighborhood, vehicle_id, route_geojson, route_coords, total_distance_km, estimated_time_min, estimated_chemical_lt, street_count, route_type, planned_date, transport_type } = req.body;
    const db = getDb();
    try {
        await db.run(`INSERT INTO planned_routes (name, neighborhood, vehicle_id, route_geojson, route_coords, total_distance_km, estimated_time_min, estimated_chemical_lt, street_count, route_type, planned_date, transport_type)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [name || 'Rota', neighborhood, vehicle_id, route_geojson, route_coords, total_distance_km, estimated_time_min, estimated_chemical_lt, street_count || 0, route_type || 'auto', planned_date, transport_type || 'vehicle']);
        saveDatabase();
        const result = await db.exec("SELECT last_insert_rowid()");
        const lastId = result[0].values[0][0];
        res.json({ id: lastId, message: 'Rota planlandı' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Rotayı personele ata ───
router.post('/planned-routes/:id/assign', authMiddleware, async (req, res) => {
    const { user_id, personnel_ids } = req.body;
    const db = getDb();
    try {
        await db.run("UPDATE planned_routes SET assigned_user_id = ?, assigned_personnel_ids = ?, status = 'assigned' WHERE id = ?",
            [user_id ? parseInt(user_id) : null, JSON.stringify(personnel_ids || []), parseInt(req.params.id)]);
        saveDatabase();
        res.json({ message: 'Rota personele atandı' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Saha personeline atanmış aktif rotayı getir ───
router.get('/assigned/:userId', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.exec(`
            SELECT pr.*, v.plate, v.machine_name, v.machine_type, v.tank_capacity_lt
            FROM planned_routes pr
            LEFT JOIN vehicles v ON pr.vehicle_id = v.id
            WHERE pr.assigned_user_id = ? AND pr.status IN ('assigned', 'active')
            ORDER BY pr.planned_date DESC
            LIMIT 1
        `, [parseInt(req.params.userId)]);
        const rows = rowsToObjects(result);
        if (rows.length === 0) return res.json(null);
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Rota durumunu güncelle ───
router.post('/planned-routes/:id/status', authMiddleware, async (req, res) => {
    const { status } = req.body;
    const db = getDb();
    try {
        await db.run("UPDATE planned_routes SET status = ? WHERE id = ?", [status, parseInt(req.params.id)]);
        saveDatabase();
        res.json({ message: 'Rota durumu güncellendi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Delete planned route ───
router.delete('/planned-routes/:id', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        await db.run("DELETE FROM planned_routes WHERE id = ?", [parseInt(req.params.id)]);
        saveDatabase();
        res.json({ message: 'Rota silindi' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Google Maps Platform: Reverse Geocoding Proxy ───
router.get('/geocoding/reverse', async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
        return res.status(400).json({ error: 'lat ve lng parametreleri gerekli' });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (apiKey) {
        // Google Maps Reverse Geocoding API call
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=tr`;
        try {
            const googleRes = await fetch(url);
            const data = await googleRes.json();
            if (data.status === 'OK' && data.results && data.results.length > 0) {
                const firstResult = data.results[0];
                const address = firstResult.formatted_address;
                
                // Try to find the neighborhood from address components
                let neighborhood = '';
                for (const component of firstResult.address_components) {
                    if (component.types.includes('sublocality') || component.types.includes('neighborhood') || component.types.includes('administrative_area_level_4')) {
                        neighborhood = component.long_name.replace(/\s*mahallesi\s*/i, '');
                        break;
                    }
                }
                
                return res.json({
                    address: address,
                    neighborhood: neighborhood,
                    provider: 'google'
                });
            } else {
                console.warn('[Geocoding] Google API returned status:', data.status);
            }
        } catch (err) {
            console.error('[Geocoding] Google Geocoding Hatası:', err.message);
        }
    }

    // Fallback: Nominatim OpenStreetMap (Free Geocoder) if Google Key is missing or fails
    const fallbackUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=tr`;
    try {
        const osmRes = await fetch(fallbackUrl, {
            headers: { 'User-Agent': 'SivasVektorMucadeleSystem/1.0' }
        });
        const data = await osmRes.json();
        if (data && data.address) {
            const neighborhood = data.address.suburb || data.address.neighbourhood || data.address.village || '';
            const cleanNeigh = neighborhood.replace(/\s*mahallesi\s*/i, '').toUpperCase('tr-TR');
            const address = data.display_name;
            return res.json({
                address: address,
                neighborhood: cleanNeigh,
                provider: 'openstreetmap'
            });
        }
    } catch (err) {
        console.error('[Geocoding] Fallback Nominatim Geocoding Hatası:', err.message);
    }

    // Return empty fallback
    res.json({
        address: `${lat}, ${lng}`,
        neighborhood: '',
        provider: 'none'
    });
});

module.exports = router;
