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

function normalizeTurkish(s) {
    if (!s) return "";
    const mapping = {
        'I': 'i', 'İ': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ç': 'c', 'ç': 'c',
        'Ğ': 'g', 'ğ': 'g', 'Ö': 'o', 'ö': 'o', 'Ü': 'u', 'ü': 'u'
    };
    const res = [];
    for (let i = 0; i < s.length; i++) {
        const c = s[i].toUpperCase();
        if (mapping[c]) {
            res.push(mapping[c]);
        } else {
            res.push(c.toLowerCase());
        }
    }
    return res.join('').replace(/[^a-z0-9]/gi, '');
}

async function fetchLocalStreets(south, west, north, east, neighborhood = '') {
    const db = getDb();
    
    // Bounding Box overlap query in WGS84
    // bbox_minx <= east AND bbox_maxx >= west AND bbox_miny <= north AND bbox_maxy >= south
    const sql = `
        SELECT osm_id, fid, name, highway, width, length_m, mahalle, geometry_geojson
        FROM local_streets
        WHERE bbox_minx <= ? AND bbox_maxx >= ? AND bbox_miny <= ? AND bbox_maxy >= ?
    `;
    
    const params = [
        parseFloat(east),
        parseFloat(west),
        parseFloat(north),
        parseFloat(south)
    ];
    
    try {
        console.log(`[Routes] Veri tabanındaki local_streets tablosu sorgulanıyor. BBox: [${south}, ${west}] -> [${north}, ${east}]`);
        const result = await db.exec(sql, params);
        const rows = rowsToObjects(result);
        
        const normalizedTarget = neighborhood ? normalizeTurkish(neighborhood) : '';
        const features = [];
        
        rows.forEach(row => {
            if (normalizedTarget) {
                const rowNeigh = normalizeTurkish(row.mahalle);
                if (rowNeigh !== normalizedTarget) return;
            }
            
            try {
                const geom = JSON.parse(row.geometry_geojson);
                
                features.push({
                    type: "Feature",
                    id: row.osm_id || `local_${row.fid}`,
                    properties: {
                        osm_id: row.osm_id || row.fid,
                        fid: row.fid,
                        name: row.name,
                        highway: row.highway,
                        width: row.width,
                        length_m: row.length_m,
                        surface: "asphalt",
                        oneway: false,
                        lanes: row.width > 12 ? 2 : 1,
                        maxspeed: "50",
                        sprayable: true,
                        mahalle: row.mahalle
                    },
                    geometry: geom
                });
            } catch (err) {
                console.error('[Routes] Yerel sokak geometrisi JSON parse hatası:', err.message);
            }
        });
        
        return {
            type: "FeatureCollection",
            features: features
        };
    } catch (err) {
        console.error('[Routes] Veri tabanından local_streets çekme hatası:', err.message);
        throw err;
    }
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
// ─── OSM & GPKG Akıllı Birleştirme (Sokakları Çek) ───
router.post('/fetch-streets', authMiddleware, async (req, res) => {
    const { south, west, north, east, neighborhood } = req.body;
    if (!south || !west || !north || !east) {
        return res.status(400).json({ error: 'Bounding box koordinatları gerekli (south, west, north, east)' });
    }

    let osmGeoJSON = null;
    let localGeoJSON = null;

    // 1. Canlı OpenStreetMap Verilerini Çek
    try {
        console.log(`[Routes] Canlı OpenStreetMap Overpass API'den sokaklar çekiliyor. BBox: ${south},${west},${north},${east}`);
        osmGeoJSON = await fetchStreets(
            parseFloat(south), parseFloat(west),
            parseFloat(north), parseFloat(east)
        );
    } catch (err) {
        console.error('[Routes] Canlı OSM Overpass Hatası:', err.message);
    }

    // 2. Yerel Masaüstü Shapefile Katmanından (c:\Users\burakkazan\Desktop\sokaklar.shp) verileri çek
    try {
        console.log(`[Routes] Masaüstü Shapefile katmanından sokaklar çekiliyor. BBox: ${south},${west},${north},${east} | Mahalle: ${neighborhood || 'Tümü'}`);
        localGeoJSON = await fetchLocalStreets(
            parseFloat(south), parseFloat(west),
            parseFloat(north), parseFloat(east),
            neighborhood
        );
    } catch (localErr) {
        console.error('[Routes] Masaüstü Shapefile sorgu hatası:', localErr.message);
    }

    // 3. AKILLI BİRLEŞTİRME VE DEDÜPLİKASYON (Gaps Filler):
    // Eğer hem OSM hem de yerel Shapefile verisi varsa, OSM verilerini birincil (esas) alıyoruz.
    // Ancak, yerel Shapefile'da olup OSM haritasında OLMAYAN (uydu görüntüsünde var ama OSM'ye çizilmemiş olan)
    // tüm sokakları otomatik olarak saptıyor ve bunları araya enjekte ediyoruz!
    if (osmGeoJSON && osmGeoJSON.features && localGeoJSON && localGeoJSON.features) {
        const mergedFeatures = [...osmGeoJSON.features];
        let injectedCount = 0;

        // İki nokta arasındaki mesafeyi metre cinsinden hesapla (Haversine)
        const getDistance = (lat1, lon1, lat2, lon2) => {
            const R = 6371000;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        };

        const getMidpoint = (geom) => {
            if (!geom || !geom.coordinates) return [0, 0];
            let sumLon = 0, sumLat = 0, count = 0;
            const processCoords = (arr) => {
                if (!Array.isArray(arr)) return;
                if (typeof arr[0] === 'number' && typeof arr[1] === 'number') {
                    sumLon += arr[0];
                    sumLat += arr[1];
                    count++;
                } else {
                    arr.forEach(processCoords);
                }
            };
            processCoords(geom.coordinates);
            return count > 0 ? [sumLat / count, sumLon / count] : [0, 0]; // [lat, lon]
        };

        const osmMidpoints = osmGeoJSON.features
            .filter(f => f.geometry && f.geometry.coordinates)
            .map(f => getMidpoint(f.geometry));

        localGeoJSON.features.forEach(localFeature => {
            if (!localFeature.geometry || localFeature.geometry.type !== 'LineString') return;
            const localMid = getMidpoint(localFeature.geometry);

            // Bu lokal sokağın orta noktasının herhangi bir OSM sokağına olan minimum mesafesini bul
            let minDistance = Infinity;
            for (const osmMid of osmMidpoints) {
                // Hızlı koordinat ön-filtresi (30 metrelik mesafe yaklaşık ~0.0005 derecedir)
                // Bu basit karşılaştırma ağır trigonometrik Haversine hesaplamasını %99.9 oranında eler!
                const latDiff = Math.abs(localMid[0] - osmMid[0]);
                const lonDiff = Math.abs(localMid[1] - osmMid[1]);
                if (latDiff > 0.0005 || lonDiff > 0.0005) {
                    continue;
                }

                const dist = getDistance(localMid[0], localMid[1], osmMid[0], osmMid[1]);
                if (dist < minDistance) {
                    minDistance = dist;
                }
            }

            // Eğer lokal sokak hiçbir OSM sokağına 30 metreden daha yakın değilse,
            // bu sokak OSM haritasında EKSİK demektir! Otomatik enjekte et!
            if (minDistance > 30) {
                // Eşsiz bir ID ata
                localFeature.properties.osm_id = 'local_' + (localFeature.properties.fid || Math.random().toString(36).substr(2, 9));
                mergedFeatures.push(localFeature);
                injectedCount++;
            }
        });

        console.log(`[Routes] Akıllı Birleştirme Tamamlandı. Canlı OSM: ${osmGeoJSON.features.length} yol. Masaüstü Shapefile'dan eksik olup otomatik doldurulan yol sayısı: ${injectedCount}. Toplam: ${mergedFeatures.length} yol.`);
        return res.json({
            type: 'FeatureCollection',
            features: mergedFeatures
        });
    }

    // Fallbacks if one of them is missing:
    if (osmGeoJSON && osmGeoJSON.features && osmGeoJSON.features.length > 0) {
        return res.json(osmGeoJSON);
    }
    if (localGeoJSON && localGeoJSON.features && localGeoJSON.features.length > 0) {
        return res.json(localGeoJSON);
    }

    res.status(404).json({ error: 'Belirtilen sınırlar içerisinde hiçbir sokak bulunamadı!' });
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
    const { user_id, personnel_ids, vehicle_id, planned_date, transport_type } = req.body;
    const db = getDb();
    try {
        await db.run(`
            UPDATE planned_routes 
            SET assigned_user_id = ?, 
                assigned_personnel_ids = ?, 
                vehicle_id = COALESCE(?, vehicle_id),
                planned_date = COALESCE(?, planned_date),
                transport_type = COALESCE(?, transport_type),
                status = 'assigned' 
            WHERE id = ?
        `, [
            user_id ? parseInt(user_id) : null,
            JSON.stringify(personnel_ids || []),
            vehicle_id ? parseInt(vehicle_id) : null,
            planned_date || null,
            transport_type || null,
            parseInt(req.params.id)
        ]);
        saveDatabase();

        // Send push notification to assigned user
        if (user_id) {
            try {
                const routeResult = await db.exec("SELECT name, neighborhood FROM planned_routes WHERE id = ?", [parseInt(req.params.id)]);
                const routeRows = rowsToObjects(routeResult);
                const routeName = routeRows.length > 0 ? routeRows[0].name || routeRows[0].neighborhood || 'Yeni Rota' : 'Yeni Rota';
                
                const sendPushToUser = req.app.get('sendPushToUser');
                if (sendPushToUser) {
                    sendPushToUser(parseInt(user_id), '📋 Yeni Görev Atandı', `Size yeni bir ilaçlama görevi atandı: ${routeName}`, '/mobile/');
                }
            } catch(pushErr) {
                console.error('[Push] Görev atama bildirimi gönderilemedi:', pushErr.message);
            }
        }

        res.json({ message: 'Rota personele atandı' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Saha personeline atanmış aktif rotayı getir ───
router.get('/assigned/:userId', authMiddleware, async (req, res) => {
    const db = getDb();
    try {
        const todayStr = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD' format in local time
        const result = await db.exec(`
            SELECT pr.*, v.plate, v.machine_name, v.machine_type, v.tank_capacity_lt
            FROM planned_routes pr
            LEFT JOIN vehicles v ON pr.vehicle_id = v.id
            WHERE pr.assigned_user_id = ? 
              AND (
                pr.status = 'active'
                OR (pr.status = 'assigned' AND (pr.planned_date IS NULL OR pr.planned_date <= ?))
              )
            ORDER BY pr.planned_date DESC
            LIMIT 1
        `, [parseInt(req.params.userId), todayStr]);
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
