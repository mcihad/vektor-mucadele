const express = require('express');
const { getDb, saveDatabase } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { calculateChemicalUsage } = require('../services/chinesePostman');

function rowsToObjects(result) {
    if (!result || result.length === 0) return [];
    const cols = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => obj[c] = row[i]);
        return obj;
    });
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000; // meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function sendStartNotification(db, req, sessionId) {
    try {
        const sendPushToUser = req.app.get('sendPushToUser');
        if (sendPushToUser) {
            const detailsResult = await db.exec(`
                SELECT s.id, v.plate, p1.name as driver_name, p2.name as operator_name, s.neighborhood
                FROM spray_sessions s
                LEFT JOIN vehicles v ON s.vehicle_id = v.id
                LEFT JOIN personnel p1 ON s.driver_id = p1.id
                LEFT JOIN personnel p2 ON s.operator_id = p2.id
                WHERE s.id = ?
            `, [parseInt(sessionId)]);
            const details = rowsToObjects(detailsResult);
            if (details.length > 0) {
                const d = details[0];
                const vehiclePlate = d.plate || 'Araç';
                const crew = `${d.driver_name || ''} - ${d.operator_name || ''}`;
                const neighborhood = d.neighborhood || '';
                
                const title = '🚀 İlaçlama Başladı';
                const body = `${vehiclePlate} plakalı araç ile ${neighborhood} mahallesinde ilaçlama başlatıldı. Ekip: ${crew}`;
                
                const adminsResult = await db.exec("SELECT id FROM users WHERE role = 'admin'");
                const admins = rowsToObjects(adminsResult);
                for (const admin of admins) {
                    await sendPushToUser(admin.id, title, body, '/admin/dashboard');
                }
            }
        }
    } catch (pushErr) {
        console.error('[Push] Yöneticiye bildirim gönderilemedi:', pushErr.message);
    }
}

async function sendIssueNotification(db, req, sessionId, issueNotes) {
    try {
        const sendPushToUser = req.app.get('sendPushToUser');
        if (sendPushToUser) {
            const detailsResult = await db.exec(`
                SELECT s.id, v.plate, s.neighborhood
                FROM spray_sessions s
                LEFT JOIN vehicles v ON s.vehicle_id = v.id
                WHERE s.id = ?
            `, [parseInt(sessionId)]);
            const details = rowsToObjects(detailsResult);
            if (details.length > 0) {
                const d = details[0];
                const vehiclePlate = d.plate || 'Araç';
                const neighborhood = d.neighborhood || '';
                
                let cleanedNotes = issueNotes || '';
                const match = cleanedNotes.match(/⚠️ SAHA SORUNU \([^)]+\):\s*([^|\]]+)/);
                if (match) {
                    cleanedNotes = match[1].trim();
                }
                
                const title = '⚠️ Sahada Sorun Bildirildi';
                const body = `${vehiclePlate} plakalı araç (${neighborhood} Mah.) sorun bildirdi: ${cleanedNotes}`;
                
                const adminsResult = await db.exec("SELECT id FROM users WHERE role = 'admin'");
                const admins = rowsToObjects(adminsResult);
                for (const admin of admins) {
                    await sendPushToUser(admin.id, title, body, '/admin/dashboard');
                }
            }
        }
    } catch (pushErr) {
        console.error('[Push] Sorun bildirim gönderimi başarısız:', pushErr.message);
    }
}

module.exports = function(io) {
    const router = express.Router();

    // Get all sessions with filters
    router.get('/', authMiddleware, async (req, res) => {
        const db = getDb();
        const { status, vehicle_id, date_from, date_to } = req.query;
        let sql = `SELECT s.*, v.plate, v.machine_name, v.machine_type,
                   p1.name as driver_name, p2.name as operator_name,
                   c.name as chemical_name,
                   r.route_coords, r.route_geojson
                   FROM spray_sessions s
                   LEFT JOIN vehicles v ON s.vehicle_id = v.id
                   LEFT JOIN personnel p1 ON s.driver_id = p1.id
                   LEFT JOIN personnel p2 ON s.operator_id = p2.id
                   LEFT JOIN chemicals c ON s.chemical_id = c.id
                   LEFT JOIN planned_routes r ON s.route_id = r.id
                   WHERE 1=1`;
        const params = [];

        if (status) { sql += " AND s.status = ?"; params.push(status); }
        if (vehicle_id) { sql += " AND s.vehicle_id = ?"; params.push(vehicle_id); }
        if (date_from) { sql += " AND s.start_time >= ?"; params.push(date_from); }
        if (date_to) { sql += " AND s.start_time <= ?"; params.push(date_to); }

        sql += " ORDER BY s.created_at DESC";

        try {
            const result = await db.exec(sql, params);
            res.json(rowsToObjects(result));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get session by id
    router.get('/:id', authMiddleware, async (req, res) => {
        const db = getDb();
        try {
            const result = await db.exec(`SELECT s.*, v.plate, v.machine_name, v.machine_type,
                    p1.name as driver_name, p2.name as operator_name,
                    c.name as chemical_name,
                    r.route_coords, r.route_geojson
                    FROM spray_sessions s
                    LEFT JOIN vehicles v ON s.vehicle_id = v.id
                    LEFT JOIN personnel p1 ON s.driver_id = p1.id
                    LEFT JOIN personnel p2 ON s.operator_id = p2.id
                    LEFT JOIN chemicals c ON s.chemical_id = c.id
                    LEFT JOIN planned_routes r ON s.route_id = r.id
                    WHERE s.id = ?`, [req.params.id]);
            const rows = rowsToObjects(result);
            if (rows.length === 0) return res.status(404).json({ error: 'Oturum bulunamadı' });
            res.json(rows[0]);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get active session for field user
    router.get('/field-active/:userId', authMiddleware, async (req, res) => {
        const db = getDb();
        try {
            // Kullanıcının personel ID'sini bul
            const userResult = await db.exec("SELECT id FROM personnel WHERE user_id = ?", [req.params.userId]);
            const personnelRows = rowsToObjects(userResult);
            
            if (personnelRows.length === 0) {
                return res.json(null);
            }
            
            const personnelId = personnelRows[0].id;
            const result = await db.exec(`SELECT s.*, v.plate, v.machine_name, v.machine_type, v.tank_capacity_lt,
                    c.name as chemical_name
                    FROM spray_sessions s
                    LEFT JOIN vehicles v ON s.vehicle_id = v.id
                    LEFT JOIN chemicals c ON s.chemical_id = c.id
                    WHERE (s.driver_id = ? OR s.operator_id = ?) AND s.status IN ('active', 'planned', 'beklemede')
                    ORDER BY CASE WHEN s.status = 'active' THEN 1 WHEN s.status = 'beklemede' THEN 2 ELSE 3 END, s.created_at DESC LIMIT 1`, [personnelId, personnelId]);
            const rows = rowsToObjects(result);
            res.json(rows.length > 0 ? rows[0] : null);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Create new session
    router.post('/', authMiddleware, async (req, res) => {
        const { 
            vehicle_id, driver_id, operator_id, chemical_id, route_id, neighborhood, district, application_type, notes,
            intake_chemical_name, intake_received_from, intake_amount_lt, intake_date, intake_chemical_type
        } = req.body;
        const db = getDb();
        try {
            await db.run(`INSERT INTO spray_sessions (vehicle_id, driver_id, operator_id, chemical_id, route_id, neighborhood, district, application_type, status, notes, intake_chemical_name, intake_received_from, intake_amount_lt, intake_date, intake_chemical_type)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    vehicle_id, driver_id, operator_id, chemical_id, route_id || null, neighborhood, district || 'Merkez', application_type || 'sokak_ilacalama', 'planned', notes,
                    intake_chemical_name || null, intake_received_from || null, intake_amount_lt ? parseFloat(intake_amount_lt) : null, intake_date || null, intake_chemical_type || null
                ]);
            saveDatabase();
            const result = await db.exec("SELECT last_insert_rowid()");
            const lastId = result[0].values[0][0];
            if (io) {
                io.to('admin').emit('session-created', { id: lastId, vehicle_id, driver_id, operator_id, neighborhood });
            }
            res.json({ id: lastId, message: 'İlaçlama oturumu oluşturuldu' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Start session
    router.post('/:id/start', authMiddleware, async (req, res) => {
        const { intake_chemical_name, intake_received_from, intake_amount_lt, intake_date, intake_chemical_type } = req.body;
        const db = getDb();
        try {
            await db.run(`UPDATE spray_sessions SET 
                status = 'active', 
                start_time = datetime('now'),
                intake_chemical_name = ?,
                intake_received_from = ?,
                intake_amount_lt = ?,
                intake_date = ?,
                intake_chemical_type = ?
                WHERE id = ?`, 
                [
                    intake_chemical_name || null, 
                    intake_received_from || null, 
                    intake_amount_lt ? parseFloat(intake_amount_lt) : null, 
                    intake_date || null, 
                    intake_chemical_type || null,
                    req.params.id
                ]);
            
            // Eğer rotaya bağlıysa, rotanın durumunu da güncelle
            const sessionResult = await db.exec("SELECT route_id, vehicle_id, driver_id, operator_id, chemical_id FROM spray_sessions WHERE id = ?", [req.params.id]);
            const session = rowsToObjects(sessionResult);
            if (session.length > 0) {
                const sess = session[0];
                if (sess.route_id) {
                    await db.run("UPDATE planned_routes SET status = 'active' WHERE id = ?", [sess.route_id]);
                }
                // Make vehicle online immediately
                if (sess.vehicle_id) {
                    await db.run("UPDATE vehicles SET last_location_time = datetime('now') WHERE id = ?", [sess.vehicle_id]);
                }
                // Set personnel to active
                if (sess.driver_id) {
                    await db.run("UPDATE personnel SET status = 'aktif' WHERE id = ?", [sess.driver_id]);
                }
                if (sess.operator_id) {
                    await db.run("UPDATE personnel SET status = 'aktif' WHERE id = ?", [sess.operator_id]);
                }

                // ─── İlaç Stokundan Düş ───
                let chemicalId = sess.chemical_id;
                if (!chemicalId && intake_chemical_name) {
                    // İlaç adına göre tablodan bulmaya çalış
                    const chemRes = await db.exec("SELECT id FROM chemicals WHERE name = ?", [intake_chemical_name]);
                    const chems = rowsToObjects(chemRes);
                    if (chems.length > 0) {
                        chemicalId = chems[0].id;
                    } else {
                        const chemLikeRes = await db.exec("SELECT id FROM chemicals WHERE name LIKE ?", [`%${intake_chemical_name}%`]);
                        const chemsLike = rowsToObjects(chemLikeRes);
                        if (chemsLike.length > 0) {
                            chemicalId = chemsLike[0].id;
                        } else {
                            const allChemsRes = await db.exec("SELECT id FROM chemicals LIMIT 1");
                            const allChems = rowsToObjects(allChemsRes);
                            if (allChems.length > 0) {
                                chemicalId = allChems[0].id;
                            }
                        }
                    }
                }

                const intakeAmountFloat = intake_amount_lt ? parseFloat(intake_amount_lt) : 0;
                
                // Oturumu güncel chemical_id ve chemical_used_lt (başlangıçta 0) ile güncelle
                await db.run(`UPDATE spray_sessions SET 
                    chemical_id = ?,
                    chemical_used_lt = 0
                    WHERE id = ?`,
                    [chemicalId, req.params.id]
                );

                // ─── İlaç Stokundan Düş (Depodan) ve Araca Yükle ───
                if (chemicalId && intakeAmountFloat > 0) {
                    // Depo (ana stok) miktarını düşür
                    await db.run("UPDATE chemicals SET stock_amount = CASE WHEN stock_amount - ? > 0 THEN stock_amount - ? ELSE 0 END WHERE id = ?",
                        [intakeAmountFloat, intakeAmountFloat, chemicalId]);
                    
                    const userName = req.user ? (req.user.full_name || req.user.username) : 'Saha Operatörü';
                    const mainStockDesc = `Depodan Araç Deposuna Yükleme - Oturum #${req.params.id} (Operatör: ${userName})`;
                    
                    // İlaç stok hareket kaydı (cıkıs/kullanim)
                    await db.run(`INSERT INTO chemical_transactions (chemical_id, transaction_type, amount, description, session_id)
                        VALUES (?, 'kullanim', ?, ?, ?)`,
                        [chemicalId, intakeAmountFloat, mainStockDesc, req.params.id]);

                    // Araç deposu (tank) stok miktarını arttır ve ilacı güncelle
                    if (sess.vehicle_id) {
                        await db.run("UPDATE vehicles SET tank_chemical_id = ?, tank_chemical_amount = COALESCE(tank_chemical_amount, 0) + ? WHERE id = ?",
                            [chemicalId, intakeAmountFloat, sess.vehicle_id]);
                        
                        const vehicleStockDesc = `Depodan Araç Deposuna Alınan İlaç - Oturum #${req.params.id}`;
                        // Araç stok hareket logu (giris)
                        await db.run(`INSERT INTO vehicle_stock_transactions (vehicle_id, chemical_id, transaction_type, amount, description, received_from, session_id)
                            VALUES (?, ?, 'giris', ?, ?, ?, ?)`,
                            [sess.vehicle_id, chemicalId, intakeAmountFloat, vehicleStockDesc, intake_received_from || null, req.params.id]);
                    }
                    console.log(`[Sessions] Oturum #${req.params.id} başlatıldı: ${intakeAmountFloat} lt ${intake_chemical_name || 'ilaç'} (ID: ${chemicalId}) depodan düşüldü ve araca yüklendi.`);
                } else {
                    console.log(`[Sessions] Oturum #${req.params.id} başlatıldı: Alınan ilaç miktarı 0 veya ilaç tanımsız (stok hareketi yapılmadı).`);
                }


                // Send push notification to all admin users
                await sendStartNotification(db, req, req.params.id);
            }
            
            saveDatabase();
            if (io) {
                io.to('admin').emit('session-started', { session_id: parseInt(req.params.id) });
            }
            res.json({ message: 'İlaçlama başlatıldı' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // End session - Otomatik ilaç hesaplama
    router.post('/:id/end', authMiddleware, async (req, res) => {
        const { total_km, notes } = req.body;
        const db = getDb();

        try {
            // Oturum bilgilerini al
            const sessionResult = await db.exec(`
                SELECT s.*, v.machine_type, v.tank_capacity_lt 
                FROM spray_sessions s 
                LEFT JOIN vehicles v ON s.vehicle_id = v.id 
                WHERE s.id = ?
            `, [req.params.id]);
            const session = rowsToObjects(sessionResult);
            
            if (session.length === 0) {
                return res.status(404).json({ error: 'Oturum bulunamadı' });
            }

            const sess = session[0];

            if (sess.status === 'completed' || sess.status === 'sorunlu') {
                return res.json({ message: 'Oturum zaten sonlandırılmış', already_ended: true });
            }
            
            // Süreyi hesapla (dakika)
            const endTime = new Date();
            const durationMinutes = req.body.duration_seconds !== undefined
                ? parseFloat(req.body.duration_seconds) / 60
                : (endTime - new Date(sess.start_time)) / (1000 * 60);
            
            const intakeAmountFloat = sess.intake_amount_lt || 0;
            let chemical_used_lt = 0;
            let remaining_chemical_lt = 0;

            if (req.body.remaining_chemical_lt !== undefined) {
                remaining_chemical_lt = parseFloat(req.body.remaining_chemical_lt);
                chemical_used_lt = Math.max(0, intakeAmountFloat - remaining_chemical_lt);
            } else if (req.body.chemical_used_lt !== undefined) {
                chemical_used_lt = parseFloat(req.body.chemical_used_lt);
                remaining_chemical_lt = Math.max(0, intakeAmountFloat - chemical_used_lt);
            } else {
                chemical_used_lt = intakeAmountFloat;
                remaining_chemical_lt = 0;
            }
            
            // Gidilen km (client'tan gelen veya hesaplanan)
            const finalKm = total_km || 0;
            
            // Alan hesapla (km × 10m genişlik × 2 taraf)
            const area_covered_m2 = finalKm * 1000 * 10;

            await db.run(`UPDATE spray_sessions SET status = 'completed', end_time = datetime('now'),
                    chemical_used_lt = ?, total_km = ?, area_covered_m2 = ?, notes = ?
                    WHERE id = ?`,
                [Math.round(chemical_used_lt * 10) / 10, finalKm, area_covered_m2, notes, req.params.id]);

            // ─── İlaçlama Tamamlandığında Araç Deposundan Düş (İlaçlama Tüketimi) ───
            const chemicalId = sess.chemical_id;
            if (sess.vehicle_id && chemical_used_lt > 0) {
                // Araç deposu (tank) miktarını kullanılan ilaç miktarı kadar düşür
                await db.run("UPDATE vehicles SET tank_chemical_amount = CASE WHEN tank_chemical_amount - ? > 0 THEN tank_chemical_amount - ? ELSE 0 END WHERE id = ?",
                    [chemical_used_lt, chemical_used_lt, sess.vehicle_id]);
                
                // Araç stok hareket logu (cikis)
                const vehicleStockDesc = `İlaçlama Tüketimi - Oturum #${req.params.id}`;
                await db.run(`INSERT INTO vehicle_stock_transactions (vehicle_id, chemical_id, transaction_type, amount, description, session_id)
                        VALUES (?, ?, 'cikis', ?, ?, ?)`,
                    [sess.vehicle_id, chemicalId, chemical_used_lt, vehicleStockDesc, req.params.id]);

                console.log(`[Sessions] Oturum #${req.params.id} sonlandırıldı. Araç tankı stoğundan ${chemical_used_lt} lt düşürüldü.`);
            }

            // Eğer rotaya bağlıysa, rotanın durumunu güncelle
            if (sess.route_id) {
                await db.run("UPDATE planned_routes SET status = 'completed' WHERE id = ?", [sess.route_id]);
            }

            // Set personnel status to 'pasif'
            if (sess.driver_id) {
                await db.run("UPDATE personnel SET status = 'pasif' WHERE id = ?", [sess.driver_id]);
            }
            if (sess.operator_id) {
                await db.run("UPDATE personnel SET status = 'pasif' WHERE id = ?", [sess.operator_id]);
            }

            // ─── Gerçek Güzergahı sprayed_streets Tablosuna Otomatik Kaydet ───
            try {
                const pointsResult = await db.exec(
                    "SELECT latitude, longitude, COALESCE(is_spraying, 1) as is_spraying FROM route_points WHERE session_id = ? ORDER BY timestamp ASC",
                    [req.params.id]
                );
                const rawPoints = rowsToObjects(pointsResult);

                // Group points into continuous segments where is_spraying = 1
                const segments = [];
                let currentSegment = [];

                for (const p of rawPoints) {
                    if (p.is_spraying === 1) {
                        currentSegment.push(p);
                    } else {
                        if (currentSegment.length >= 2) {
                            segments.push(currentSegment);
                        }
                        currentSegment = [];
                    }
                }
                if (currentSegment.length >= 2) {
                    segments.push(currentSegment);
                }

                if (segments.length > 0) {
                    for (let i = 0; i < segments.length; i++) {
                        const segPoints = segments[i];
                        const coordinates = segPoints.map(p => [p.longitude, p.latitude]);

                        // Calculate segment length using haversine
                        let segmentLengthMt = 0;
                        for (let j = 1; j < segPoints.length; j++) {
                            segmentLengthMt += haversine(
                                segPoints[j-1].latitude, segPoints[j-1].longitude,
                                segPoints[j].latitude, segPoints[j].longitude
                            );
                        }

                        const geojsonFeature = {
                            type: 'Feature',
                            properties: {
                                name: (sess.neighborhood || 'Saha') + ` İlaçlama Hattı ${i + 1}`,
                                session_id: parseInt(req.params.id),
                                oneway: false
                            },
                            geometry: {
                                type: 'LineString',
                                coordinates: coordinates
                            }
                        };

                        const streetName = (sess.neighborhood || 'Saha') + ` İlaçlama Hattı ${i + 1}`;
                        const lengthMt = Math.round(segmentLengthMt);
                        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

                        await db.run(
                            `INSERT INTO sprayed_streets (session_id, street_name, osm_way_id, width_mt, pass_count, length_mt, sprayed_at, expires_at, geometry_geojson)
                             VALUES (?,?,?,?,?,?,datetime('now'),?,?)`,
                            [
                                req.params.id,
                                streetName,
                                '',
                                8,
                                1,
                                lengthMt,
                                expiresAt,
                                JSON.stringify(geojsonFeature)
                            ]
                        );
                    }
                    console.log(`[Sessions] Oturum #${req.params.id} için ${segments.length} aktif ilaçlama segmenti sprayed_streets tablosuna kaydedildi.`);
                } else {
                    console.log(`[Sessions] Oturum #${req.params.id} için aktif ilaçlama segmenti bulunamadı.`);
                }
            } catch (geoErr) {
                console.error(`[Sessions] Oturum #${req.params.id} güzergah kaydı sırasında hata:`, geoErr.message);
            }

            saveDatabase();
            if (io) {
                io.to('admin').emit('session-completed', { session_id: parseInt(req.params.id), summary: { duration_min: Math.round(durationMinutes), total_km: finalKm, chemical_used_lt: Math.round(chemical_used_lt * 10) / 10 } });
            }
            res.json({ 
                message: 'İlaçlama tamamlandı',
                summary: {
                    duration_min: Math.round(durationMinutes),
                    total_km: finalKm,
                    chemical_used_lt: Math.round(chemical_used_lt * 10) / 10,
                    area_covered_m2: Math.round(area_covered_m2),
                    machine_type: sess.machine_type
                }
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update session status / notes / metadata
    router.put('/:id', authMiddleware, async (req, res) => {
        const { status, notes, chemical_used_lt, total_km, area_covered_m2 } = req.body;
        const db = getDb();
        
        try {
            // Get current session before updating to avoid double chemical stock deduction
            const currentSessionResult = await db.exec("SELECT * FROM spray_sessions WHERE id = ?", [req.params.id]);
            const currentSessionRows = rowsToObjects(currentSessionResult);
            if (currentSessionRows.length === 0) return res.status(404).json({ error: 'Oturum bulunamadı' });
            const prevSession = currentSessionRows[0];

            let sql = "UPDATE spray_sessions SET";
            const sets = [];
            const params = [];
        
        if (status !== undefined) {
            sets.push(" status = ?");
            params.push(status);
        }
        if (notes !== undefined) {
            sets.push(" notes = ?");
            params.push(notes);
        }
        if (chemical_used_lt !== undefined) {
            sets.push(" chemical_used_lt = ?");
            params.push(chemical_used_lt);
        }
        if (total_km !== undefined) {
            sets.push(" total_km = ?");
            params.push(total_km);
        }
        if (area_covered_m2 !== undefined) {
            sets.push(" area_covered_m2 = ?");
            params.push(area_covered_m2);
        }
        
        if (sets.length === 0) return res.status(400).json({ error: 'Güncellenecek alan yok' });
        
        sql += sets.join(',') + " WHERE id = ?";
        params.push(req.params.id);
        
        await db.run(sql, params);
            
            // Eğer status 'sorunlu' yapıldıysa ve oturum daha önce tamamlanmamış/sorunlu değilse
            if (status === 'sorunlu' && prevSession.status !== 'completed' && prevSession.status !== 'sorunlu') {
                const sessionResult = await db.exec(`
                    SELECT s.*, v.machine_type, v.tank_capacity_lt
                    FROM spray_sessions s
                    LEFT JOIN vehicles v ON s.vehicle_id = v.id
                    WHERE s.id = ?
                `, [req.params.id]);
                const sessionRows = rowsToObjects(sessionResult);
                if (sessionRows.length > 0) {
                    const sess = sessionRows[0];
                    if (sess.route_id) {
                        await db.run("UPDATE planned_routes SET status = 'sorunlu' WHERE id = ?", [sess.route_id]);
                    }

                    // ─── MADDE 1: Sorun bildirildiğinde end_time ve stok güncellemesi ───
                    if (sess.start_time) {
                        try {
                            const intakeAmountFloat = sess.intake_amount_lt || 0;
                            let chemical_used_lt = 0;
                            let remaining_chemical_lt = 0;

                            if (req.body.remaining_chemical_lt !== undefined) {
                                remaining_chemical_lt = parseFloat(req.body.remaining_chemical_lt);
                                chemical_used_lt = Math.max(0, intakeAmountFloat - remaining_chemical_lt);
                            } else if (req.body.chemical_used_lt !== undefined) {
                                chemical_used_lt = parseFloat(req.body.chemical_used_lt);
                                remaining_chemical_lt = Math.max(0, intakeAmountFloat - chemical_used_lt);
                            } else {
                                chemical_used_lt = intakeAmountFloat;
                                remaining_chemical_lt = 0;
                            }

                            await db.run("UPDATE spray_sessions SET chemical_used_lt = ?, end_time = datetime('now') WHERE id = ?",
                                [Math.round(chemical_used_lt * 10) / 10, req.params.id]);

                            // ─── İlaçlama Tamamlandığında Araç Deposundan Düş (Sorun Bildirildi) ───
                            const chemicalId = sess.chemical_id;
                            if (sess.vehicle_id && chemical_used_lt > 0) {
                                // Araç deposu (tank) miktarını kullanılan ilaç miktarı kadar düşür
                                await db.run("UPDATE vehicles SET tank_chemical_amount = CASE WHEN tank_chemical_amount - ? > 0 THEN tank_chemical_amount - ? ELSE 0 END WHERE id = ?",
                                    [chemical_used_lt, chemical_used_lt, sess.vehicle_id]);
                                
                                // Araç stok hareket logu (cikis)
                                const vehicleStockDesc = `İlaçlama Tüketimi (Sorun Bildirildi) - Oturum #${req.params.id}`;
                                await db.run(`INSERT INTO vehicle_stock_transactions (vehicle_id, chemical_id, transaction_type, amount, description, session_id)
                                        VALUES (?, ?, 'cikis', ?, ?, ?)`,
                                    [sess.vehicle_id, chemicalId, chemical_used_lt, vehicleStockDesc, req.params.id]);

                                console.log(`[Sessions] Oturum #${req.params.id} sorunlu sonlandırıldı. Araç tankı stoğundan ${chemical_used_lt} lt (kullanılan miktar) düşüldü.`);
                            }
                        } catch (chemErr) {
                            console.error(`[Sessions] Sorunlu oturum #${req.params.id} end_time/stok güncelleme hatası:`, chemErr.message);
                        }
                    }

                    // ─── MADDE 2: İlaçlanan alanı haritada işaretle (sprayed_streets) ───
                    try {
                        const pointsResult = await db.exec(
                            "SELECT latitude, longitude, COALESCE(is_spraying, 1) as is_spraying FROM route_points WHERE session_id = ? ORDER BY timestamp ASC",
                            [req.params.id]
                        );
                        const rawPoints = rowsToObjects(pointsResult);

                        // Sadece is_spraying = 1 olan noktaları segmentlere ayır
                        const segments = [];
                        let currentSegment = [];
                        for (const p of rawPoints) {
                            if (p.is_spraying === 1) {
                                currentSegment.push(p);
                            } else {
                                if (currentSegment.length >= 2) segments.push(currentSegment);
                                currentSegment = [];
                            }
                        }
                        if (currentSegment.length >= 2) segments.push(currentSegment);

                        if (segments.length > 0) {
                            const neighborhood = sessionRows[0].neighborhood || 'Saha';
                            for (let i = 0; i < segments.length; i++) {
                                const segPoints = segments[i];
                                const coordinates = segPoints.map(p => [p.longitude, p.latitude]);
                                let segmentLengthMt = 0;
                                for (let j = 1; j < segPoints.length; j++) {
                                    segmentLengthMt += haversine(segPoints[j-1].latitude, segPoints[j-1].longitude, segPoints[j].latitude, segPoints[j].longitude);
                                }
                                const geojsonFeature = {
                                    type: 'Feature',
                                    properties: { name: `${neighborhood} İlaçlama Hattı ${i + 1} (Kısmi)`, session_id: parseInt(req.params.id), oneway: false },
                                    geometry: { type: 'LineString', coordinates }
                                };
                                const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                                await db.run(
                                    `INSERT INTO sprayed_streets (session_id, street_name, osm_way_id, width_mt, pass_count, length_mt, sprayed_at, expires_at, geometry_geojson)
                                     VALUES (?,?,?,?,?,?,datetime('now'),?,?)`,
                                    [req.params.id, `${neighborhood} İlaçlama Hattı ${i + 1} (Kısmi)`, '', 8, 1, Math.round(segmentLengthMt), expiresAt, JSON.stringify(geojsonFeature)]
                                );
                            }
                            console.log(`[Sessions] Sorunlu oturum #${req.params.id}: ${segments.length} kısmi ilaçlama segmenti sprayed_streets tablosuna kaydedildi.`);
                        } else {
                            console.log(`[Sessions] Sorunlu oturum #${req.params.id}: Hiç ilaçlama yapılmamış, sprayed_streets kaydı oluşturulmadı.`);
                        }
                    } catch (geoErr) {
                        console.error(`[Sessions] Sorunlu oturum #${req.params.id} güzergah kaydı hatası:`, geoErr.message);
                    }
                }
            }

            // Güncellenen duruma göre personel durumunu ve araç durumunu ayarla
            if (status !== undefined) {
                const sessRes = await db.exec("SELECT driver_id, operator_id, vehicle_id FROM spray_sessions WHERE id = ?", [req.params.id]);
                const sessRows = rowsToObjects(sessRes);
                if (sessRows.length > 0) {
                    const { driver_id, operator_id, vehicle_id } = sessRows[0];
                    if (status === 'active') {
                        if (driver_id) await db.run("UPDATE personnel SET status = 'aktif' WHERE id = ?", [driver_id]);
                        if (operator_id) await db.run("UPDATE personnel SET status = 'aktif' WHERE id = ?", [operator_id]);
                        if (vehicle_id) await db.run("UPDATE vehicles SET last_location_time = datetime('now') WHERE id = ?", [vehicle_id]);
                        // Send push notification when resuming
                        await sendStartNotification(db, req, req.params.id);
                    } else if (status === 'beklemede' || status === 'sorunlu') {
                        if (driver_id) await db.run("UPDATE personnel SET status = 'pasif' WHERE id = ?", [driver_id]);
                        if (operator_id) await db.run("UPDATE personnel SET status = 'pasif' WHERE id = ?", [operator_id]);
                        if (status === 'sorunlu') {
                            await sendIssueNotification(db, req, req.params.id, notes);
                        }
                    }
                }
            }
            
            saveDatabase();
            
            // Socket.io: Notify admins on session status update
            if (io) {
                const updatedSessionResult = await db.exec(`
                    SELECT s.*, v.plate, v.machine_name 
                    FROM spray_sessions s
                    LEFT JOIN vehicles v ON s.vehicle_id = v.id
                    WHERE s.id = ?
                `, [req.params.id]);
                const updatedSessionRows = rowsToObjects(updatedSessionResult);
                const updatedSession = updatedSessionRows.length > 0 ? updatedSessionRows[0] : null;
                
                io.to('admin').emit('session-issue-updated', {
                    session_id: parseInt(req.params.id),
                    status: status || (updatedSession ? updatedSession.status : undefined),
                    notes: notes || (updatedSession ? updatedSession.notes : undefined),
                    session: updatedSession
                });
                if (status === 'beklemede') {
                    io.to('admin').emit('session-paused', {
                        session_id: parseInt(req.params.id),
                        status: 'beklemede',
                        session: updatedSession
                    });
                }
            }
            
            res.json({ message: 'Oturum güncellendi' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Add route point (GPS tracking)
    router.post('/:id/track', authMiddleware, async (req, res) => {
        const { latitude, longitude, speed_kmh, is_spraying } = req.body;
        const db = getDb();
        try {
            await db.run("INSERT INTO route_points (session_id, latitude, longitude, speed_kmh, is_spraying) VALUES (?,?,?,?,?)",
                [req.params.id, latitude, longitude, speed_kmh || 0, is_spraying !== undefined ? is_spraying : 1]);

            // Also update vehicle location
            const session = rowsToObjects(await db.exec("SELECT vehicle_id FROM spray_sessions WHERE id = ?", [req.params.id]));
            let vehicleId = null;
            if (session.length > 0) {
                vehicleId = session[0].vehicle_id;
                await db.run("UPDATE vehicles SET last_lat = ?, last_lng = ?, last_location_time = datetime('now') WHERE id = ?",
                    [latitude, longitude, vehicleId]);
            }

            if (io) {
                io.to('admin').emit('vehicle-location-update', { 
                    session_id: parseInt(req.params.id), 
                    vehicle_id: vehicleId,
                    latitude, 
                    longitude, 
                    speed_kmh: speed_kmh || 0, 
                    is_spraying: is_spraying !== undefined ? is_spraying : 1 
                });
            }

            saveDatabase();
            res.json({ message: 'Konum kaydedildi' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Bulk track (batch GPS points)
    router.post('/:id/track-bulk', authMiddleware, async (req, res) => {
        const { points } = req.body;
        if (!points || !Array.isArray(points)) return res.status(400).json({ error: 'Geçersiz veri' });

        const db = getDb();
        try {
            for (const p of points) {
                await db.run("INSERT INTO route_points (session_id, latitude, longitude, speed_kmh, timestamp, is_spraying) VALUES (?,?,?,?,?,?)",
                    [req.params.id, p.latitude, p.longitude, p.speed_kmh || 0, p.timestamp || new Date().toISOString(), p.is_spraying !== undefined ? p.is_spraying : 1]);
            }
            saveDatabase();
            res.json({ message: `${points.length} konum kaydedildi` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get route points
    router.get('/:id/route', authMiddleware, async (req, res) => {
        const db = getDb();
        try {
            const result = await db.exec("SELECT * FROM route_points WHERE session_id = ? ORDER BY timestamp", [req.params.id]);
            res.json(rowsToObjects(result));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Add sprayed street
    router.post('/:id/street', authMiddleware, async (req, res) => {
        const { street_name, osm_way_id, width_mt, pass_count, length_mt, geometry_geojson, oneway } = req.body;
        const db = getDb();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        try {
            let geomObj;
            try {
                geomObj = typeof geometry_geojson === 'string' ? JSON.parse(geometry_geojson) : geometry_geojson;
            } catch (e) {
                geomObj = geometry_geojson;
            }

            if (geomObj && geomObj.type !== 'Feature') {
                geomObj = {
                    type: 'Feature',
                    properties: {
                        oneway: !!oneway,
                        name: street_name || 'İsimsiz',
                        osm_id: osm_way_id || ''
                    },
                    geometry: geomObj
                };
            } else if (geomObj && geomObj.type === 'Feature') {
                if (!geomObj.properties) geomObj.properties = {};
                geomObj.properties.oneway = oneway !== undefined ? !!oneway : !!geomObj.properties.oneway;
            }

            await db.run(`INSERT INTO sprayed_streets (session_id, street_name, osm_way_id, width_mt, pass_count, length_mt, sprayed_at, expires_at, geometry_geojson)
                    VALUES (?,?,?,?,?,?,datetime('now'),?,?)`,
                [req.params.id, street_name, osm_way_id, width_mt || 8, pass_count || 1, length_mt || 0, expiresAt, JSON.stringify(geomObj)]);
            saveDatabase();
            res.json({ message: 'Sokak kaydedildi' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Bulk add sprayed streets
    router.post('/:id/streets-bulk', authMiddleware, async (req, res) => {
        const { streets } = req.body;
        if (!streets || !Array.isArray(streets)) return res.status(400).json({ error: 'Geçersiz veri' });

        const db = getDb();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        try {
            for (const s of streets) {
                let geomObj;
                try {
                    geomObj = typeof s.geometry === 'string' ? JSON.parse(s.geometry) : s.geometry;
                } catch (e) {
                    geomObj = s.geometry;
                }

                if (geomObj && geomObj.type !== 'Feature') {
                    geomObj = {
                        type: 'Feature',
                        properties: {
                            oneway: !!s.oneway,
                            name: s.name || 'İsimsiz',
                            osm_id: s.osm_id || ''
                        },
                        geometry: geomObj
                    };
                } else if (geomObj && geomObj.type === 'Feature') {
                    if (!geomObj.properties) geomObj.properties = {};
                    geomObj.properties.oneway = s.oneway !== undefined ? !!s.oneway : !!geomObj.properties.oneway;
                }

                await db.run(`INSERT INTO sprayed_streets (session_id, street_name, osm_way_id, width_mt, length_mt, sprayed_at, expires_at, geometry_geojson)
                        VALUES (?,?,?,?,?,datetime('now'),?,?)`,
                    [req.params.id, s.name || 'İsimsiz', s.osm_id || '', s.width || 8, s.length || 0, expiresAt, JSON.stringify(geomObj)]);
            }
            saveDatabase();
            res.json({ message: `${streets.length} sokak kaydedildi` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Delete a spray session
    router.delete('/:id', authMiddleware, async (req, res) => {
        const db = getDb();
        try {
            await db.run("DELETE FROM spray_sessions WHERE id = ?", [req.params.id]);
            saveDatabase();
            res.json({ message: 'İlaçlama kaydı başarıyla silindi' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
