const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');
const webpush = require('web-push');

// .env dosyasından ortam değişkenlerini yükle
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch(e) {
    // dotenv yoksa sistem ortam değişkenlerini kullan
}

const { initDatabase, getDb, saveDatabase } = require('./config/database');
const { authMiddleware } = require('./middleware/auth');

// ─── Web Push VAPID Configuration ───
const VAPID_PUBLIC_KEY = 'BCNZxnaZ6X2a7wUpIjMzJCneTmdR3kp-NRQGALaynB1Q8HoASJOpb959lcbPLmz1c9RNHTaaj333De2HttcoxYM';
const VAPID_PRIVATE_KEY = '7E_XQxWTjy81In-mMysuCrJC4PZkWW-D51iXJsvGwzQ';
webpush.setVapidDetails('mailto:vms@sivas.bel.tr', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// In-memory push subscriptions store (persisted to DB)
const pushSubscriptions = new Map(); // user_id -> subscription

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
const createAuthRoutes = require('./routes/auth');
const vehicleRoutes = require('./routes/vehicles');
const personnelRoutes = require('./routes/personnel');
const createSessionRoutes = require('./routes/sessions');
const reportRoutes = require('./routes/reports');
const chemicalRoutes = require('./routes/chemicals');
const createCitizenReportRoutes = require('./routes/citizenReports');
const routeRoutes = require('./routes/routes');

app.use('/api/auth', createAuthRoutes(io));
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/personnel', personnelRoutes);
app.use('/api/sessions', createSessionRoutes(io));
app.use('/api/reports', reportRoutes);
app.use('/api/chemicals', chemicalRoutes);
app.use('/api/citizen-reports', createCitizenReportRoutes(io));

// ─── Kullanıcı Konum Ping Endpoint (Socket yoksa yedek) ───
app.post('/api/location/ping', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const { latitude, longitude, speed, accuracy } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ error: 'Konum bilgisi gerekli' });
    try {
        const db = getDb();
        await db.run(
            "UPDATE users SET last_lat = $1, last_lng = $2, last_speed = $3, last_location_time = NOW() WHERE id = $4",
            [latitude, longitude, speed || 0, userId]
        );
        // 15 saniyede bir geçmiş loguna yaz
        const now = Date.now();
        const lastLogKey = `_locPing_${userId}`;
        if (!app.locals[lastLogKey] || (now - app.locals[lastLogKey]) >= 15000) {
            app.locals[lastLogKey] = now;
            await db.run(
                "INSERT INTO user_location_log (user_id, latitude, longitude, speed, accuracy) VALUES ($1, $2, $3, $4, $5)",
                [userId, latitude, longitude, speed || 0, accuracy || null]
            );
        }
        saveDatabase();
        res.json({ ok: true });
    } catch(err) {
        console.error('[Location Ping] Hata:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── Kullanıcı Konum Geçmişi Sorgulama ───
app.get('/api/location/history/:userId', authMiddleware, async (req, res) => {
    const { userId } = req.params;
    const { start_date, end_date } = req.query;
    // Sadece admin veya kendi konumunu görebilir
    if (req.user.role !== 'admin' && req.user.id !== parseInt(userId)) {
        return res.status(403).json({ error: 'Yetkiniz yok' });
    }
    try {
        const db = getDb();
        let query = `SELECT latitude, longitude, speed, accuracy, recorded_at FROM user_location_log WHERE user_id = $1`;
        const params = [userId];
        if (start_date) {
            query += ` AND recorded_at >= $${params.length + 1}`;
            params.push(start_date);
        }
        if (end_date) {
            query += ` AND recorded_at <= $${params.length + 1}`;
            params.push(end_date);
        }
        query += ' ORDER BY recorded_at DESC LIMIT 1000';
        const result = await db.exec(query, params);
        const rows = result && result.length > 0 && result[0].values ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((c, i) => obj[c] = row[i]);
            return obj;
        }) : [];
        res.json(rows);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Tüm Kullanıcıların Son Konumu (Admin) ───
app.get('/api/location/all-users', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Yetkiniz yok' });
    try {
        const db = getDb();
        const result = await db.exec(`
            SELECT u.id, u.full_name, u.last_lat, u.last_lng, u.last_speed, u.last_location_time,
                   p.name as personnel_name, p.role as personnel_role
            FROM users u
            LEFT JOIN personnel p ON p.user_id = u.id
            WHERE u.last_lat IS NOT NULL AND u.last_lng IS NOT NULL
            ORDER BY u.last_location_time DESC
        `);
        const rows = result && result.length > 0 && result[0].values ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((c, i) => obj[c] = row[i]);
            return obj;
        }) : [];
        res.json(rows);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});
app.use('/api/routes', routeRoutes);

// ─── Push Notification Endpoints ───
app.get('/api/push/vapid-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
    const { subscription } = req.body;
    const userId = req.user.id;
    if (!subscription) return res.status(400).json({ error: 'Subscription gerekli' });
    try {
        pushSubscriptions.set(userId, subscription);
        // Also save to DB for persistence
        const db = getDb();
        await db.run(
            `INSERT INTO push_subscriptions (user_id, subscription_json, created_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT (user_id) DO UPDATE SET subscription_json = EXCLUDED.subscription_json, created_at = CURRENT_TIMESTAMP`,
            [userId, JSON.stringify(subscription)]
        );
        saveDatabase();
        console.log(`[Push] Kullanıcı #${userId} push subscription kaydedildi`);
        res.json({ message: 'Push subscription kaydedildi' });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/push/unsubscribe', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    try {
        pushSubscriptions.delete(userId);
        const db = getDb();
        await db.run('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
        saveDatabase();
        res.json({ message: 'Push subscription silindi' });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper: Send push notification to a specific user
async function sendPushToUser(userId, title, body, url) {
    let subscription = pushSubscriptions.get(userId);
    if (!subscription) {
        // Try loading from DB
        try {
            const db = getDb();
            const rows = await db.exec('SELECT subscription_json FROM push_subscriptions WHERE user_id = ?', [userId]);
            if (rows.length > 0 && rows[0].values.length > 0) {
                subscription = JSON.parse(rows[0].values[0][0]);
                pushSubscriptions.set(userId, subscription);
            }
        } catch(e) {}
    }
    if (!subscription) return false;
    try {
        await webpush.sendNotification(
            subscription, 
            JSON.stringify({ title, body, url: url || '/mobile/' }),
            {
                TTL: 86400, // 24 saat (cihaz kapalıysa bağlantı geldiğinde teslim edilmesi için)
                urgency: 'high' // Pil tasarrufu/uyku modunu aşarak anında teslim et
            }
        );
        console.log(`[Push] Kullanıcı #${userId}'ye yüksek öncelikli bildirim gönderildi: ${title}`);
        return true;
    } catch(err) {
        console.error(`[Push] Kullanıcı #${userId} push hatası:`, err.message);
        if (err.statusCode === 410 || err.statusCode === 404) {
            pushSubscriptions.delete(userId);
            try {
                const db = getDb();
                await db.run('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
                saveDatabase();
            } catch(e) {}
        }
        return false;
    }
}
// Export sendPushToUser for use in routes
app.set('sendPushToUser', sendPushToUser);

// Sağlık kontrolü endpoint'i
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform
    });
});

// Page routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/admin/*', (req, res) => {
    const page = req.params[0] || 'dashboard';
    const filePath = path.join(__dirname, '..', 'public', 'admin', `${page}.html`);
    res.sendFile(filePath, (err) => {
        if (err) res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'dashboard.html'));
    });
});
app.get('/mobile/*', (req, res) => {
    const page = req.params[0] || 'index';
    const filePath = path.join(__dirname, '..', 'public', 'mobile', `${page}.html`);
    res.sendFile(filePath, (err) => {
        if (err) res.sendFile(path.join(__dirname, '..', 'public', 'mobile', 'index.html'));
    });
});
app.get('/ihbar', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'citizen.html')));
app.get('/vatandas-harita', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'vatandas-harita.html')));
app.get('/vatandas_harita', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'vatandas-harita.html')));

// ─── Araç Konum Hareketi Takip Sistemi ───
// Her aracın son konum bilgisini ve hareket zamanlayıcısını tutan yapı
const vehicleMovementTrackers = new Map(); // vehicle_id -> { lastLat, lastLng, lastMoveTime, offlineTimeout }
const VEHICLE_OFFLINE_TIMEOUT_MS = 30000; // 30 saniye hareket yoksa çevrimdışı

function checkVehicleMovement(vehicleId, latitude, longitude) {
    const tracker = vehicleMovementTrackers.get(vehicleId);
    const now = Date.now();
    
    if (!tracker) {
        // İlk konum - çevrimiçi yap
        vehicleMovementTrackers.set(vehicleId, {
            lastLat: latitude,
            lastLng: longitude,
            lastMoveTime: now,
            offlineTimeout: setTimeout(() => setVehicleOffline(vehicleId), VEHICLE_OFFLINE_TIMEOUT_MS)
        });
        io.to('admin').emit('vehicle-online-status', { vehicle_id: vehicleId, online: true });
        return;
    }
    
    // Hareket oldu mu? (3 metreden fazla değişim)
    const R = 6371000;
    const dLat = (latitude - tracker.lastLat) * Math.PI / 180;
    const dLon = (longitude - tracker.lastLng) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(tracker.lastLat*Math.PI/180)*Math.cos(latitude*Math.PI/180)*Math.sin(dLon/2)**2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    if (dist > 3) {
        // Hareket var - çevrimiçi
        tracker.lastLat = latitude;
        tracker.lastLng = longitude;
        tracker.lastMoveTime = now;
        // Zamanlayıcıyı sıfırla
        if (tracker.offlineTimeout) clearTimeout(tracker.offlineTimeout);
        tracker.offlineTimeout = setTimeout(() => setVehicleOffline(vehicleId), VEHICLE_OFFLINE_TIMEOUT_MS);
        io.to('admin').emit('vehicle-online-status', { vehicle_id: vehicleId, online: true });
    } else {
        // Hareket yok - zamanlayıcı çalışmaya devam eder
    }
}

function setVehicleOffline(vehicleId) {
    console.log(`[Vehicle] Araç #${vehicleId} → ÇEVRİMDIŞI (30sn hareket yok)`);
    io.to('admin').emit('vehicle-online-status', { vehicle_id: vehicleId, online: false });
    vehicleMovementTrackers.delete(vehicleId);
}

// ─── Kullanıcı-Socket Eşleştirme ───
const userSocketMap = new Map(); // userId -> socketId

// Socket.io - real-time vehicle tracking
io.on('connection', (socket) => {
    console.log(`[Socket] Yeni bağlantı: ${socket.id}`);

    socket.on('vehicle-location', async (data) => {
        // Konum hareketi kontrolü
        if (data.vehicle_id && data.latitude && data.longitude) {
            checkVehicleMovement(data.vehicle_id, data.latitude, data.longitude);
            // Araç konumunu veritabanına kaydet
            try {
                const db = getDb();
                await db.run(
                    "UPDATE vehicles SET last_lat = $1, last_lng = $2, last_location_time = NOW() WHERE id = $3",
                    [data.latitude, data.longitude, data.vehicle_id]
                );
                saveDatabase();
            } catch(e) {
                console.error('[Vehicle Location DB] Hata:', e.message);
            }
        }
        // Broadcast vehicle location to all admin clients
        io.emit('vehicle-update', data);
    });

    socket.on('device-location', async (data) => {
        if (!data.device_uuid || !data.latitude || !data.longitude) return;
        try {
            const db = getDb();
            const vehicleResult = rowsToObjects(await db.exec("SELECT id, plate FROM vehicles WHERE device_id = $1", [data.device_uuid]));
            if (vehicleResult.length > 0) {
                const vehicle = vehicleResult[0];
                checkVehicleMovement(vehicle.id, data.latitude, data.longitude);
                
                await db.run(
                    "UPDATE vehicles SET last_lat = $1, last_lng = $2, last_location_time = NOW() WHERE id = $3",
                    [data.latitude, data.longitude, vehicle.id]
                );
                saveDatabase();

                io.emit('vehicle-update', {
                    vehicle_id: vehicle.id,
                    plate: vehicle.plate,
                    latitude: data.latitude,
                    longitude: data.longitude,
                    speed: data.speed || 0,
                    is_spraying: 0
                });
            }
        } catch(e) {
            console.error('[Device Location Socket] Hata:', e.message);
        }
    });

    // ─── Kullanıcı Konum Takibi (Oturum Bağımsız) ───
    socket.on('user-location', async (data) => {
        if (!data.user_id || !data.latitude || !data.longitude) return;
        try {
            const db = getDb();
            // 1) Kullanıcının son konumunu güncelle
            await db.run(
                "UPDATE users SET last_lat = $1, last_lng = $2, last_speed = $3, last_location_time = NOW() WHERE id = $4",
                [data.latitude, data.longitude, data.speed || 0, data.user_id]
            );
            // 2) Konum geçmişi loguna yaz (15 saniyede bir kaydet - throttle sunucu tarafında)
            const lastLogKey = `_lastLocLog_${data.user_id}`;
            const now = Date.now();
            if (!socket[lastLogKey] || (now - socket[lastLogKey]) >= 15000) {
                socket[lastLogKey] = now;
                await db.run(
                    "INSERT INTO user_location_log (user_id, latitude, longitude, speed, accuracy) VALUES ($1, $2, $3, $4, $5)",
                    [data.user_id, data.latitude, data.longitude, data.speed || 0, data.accuracy || null]
                );
            }
            saveDatabase();
        } catch(e) {
            console.error('[User Location] Hata:', e.message);
        }
        // Admin panele kullanıcı konumunu yayınla
        io.to('admin').emit('user-location-update', {
            user_id: data.user_id,
            latitude: data.latitude,
            longitude: data.longitude,
            speed: data.speed || 0,
            timestamp: new Date().toISOString()
        });
    });

    socket.on('vehicle-speed-violation', (data) => {
        io.to('admin').emit('admin-speed-violation', data);
    });

    socket.on('spray-status', (data) => {
        io.emit('spray-update', data);
    });

    socket.on('join-admin', () => {
        socket.join('admin');
    });

    socket.on('join-field', (vehicleId) => {
        socket.join(`vehicle-${vehicleId}`);
    });

    socket.on('join-field-user', (userId) => {
        socket.join(`user-${userId}`);
        socket.userId = userId;
        userSocketMap.set(userId, socket.id);
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Bağlantı koptu: ${socket.id}`);
        // Kullanıcı bağlantısı koptuğunda personeli pasif yap
        if (socket.userId) {
            userSocketMap.delete(socket.userId);
            const db = getDb();
            db.exec("SELECT id FROM personnel WHERE user_id = ?", [socket.userId]).then(result => {
                const rows = result && result.length > 0 ? result[0].values : [];
                if (rows.length > 0) {
                    db.run("UPDATE personnel SET status = 'pasif' WHERE user_id = ?", [socket.userId]).then(() => {
                        saveDatabase();
                        console.log(`[Socket] Kullanıcı #${socket.userId} bağlantısı koptu → Personel PASİF`);
                        io.to('admin').emit('personnel-status-changed', {
                            user_id: socket.userId,
                            personnel_id: rows[0][0],
                            status: 'pasif'
                        });
                    }).catch(() => {});
                }
            }).catch(() => {});
        }
    });
});

// Ağ IP adreslerini bul
function getNetworkIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push({ name, address: iface.address });
            }
        }
    }
    return ips;
}

// Helper: Convert SQLite raw result structure to object array
function rowsToObjects(result) {
    if (!result || result.length === 0 || !result[0].values) return [];
    const cols = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => obj[c] = row[i]);
        return obj;
    });
}

// 5 dakikada bir aktif ilaçlama oturumlarını kontrol edip yöneticilere bildirim gönderen fonksiyon
function startActiveSessionNotifier() {
    setInterval(async () => {
        try {
            const db = getDb();
            if (!db) return;

            // Durumu 'active' olan (yani duraklatılmamış/devam eden) aktif ilaçlama oturumlarını çek
            const result = await db.exec(`
                SELECT s.id, v.plate, s.neighborhood
                FROM spray_sessions s
                LEFT JOIN vehicles v ON s.vehicle_id = v.id
                WHERE s.status = 'active'
            `);

            const sessions = rowsToObjects(result);
            if (sessions.length === 0) return;

            // Bildirim içeriğini oluştur
            let body = '';
            if (sessions.length === 1) {
                const s = sessions[0];
                const vehiclePlate = s.plate || 'Araç';
                const neighborhood = s.neighborhood || 'Bilinmeyen Mahalle';
                body = `${vehiclePlate} plakalı araç ile ${neighborhood} mahallesinde ilaçlama devam ediyor.`;
            } else {
                const details = sessions.map(s => `${s.plate || 'Araç'} (${s.neighborhood || 'Bilinmeyen Mahalle'})`).join(', ');
                body = `${sessions.length} araç ile ilaçlama devam ediyor. Aktif araçlar: ${details}`;
            }

            const title = '🔄 İlaçlama Devam Ediyor';
            
            // Tüm admin kullanıcılarını bul
            const adminsResult = await db.exec("SELECT id FROM users WHERE role = 'admin'");
            const admins = rowsToObjects(adminsResult);

            // Her bir admine Web Push üzerinden bildirimi gönder
            for (const admin of admins) {
                await sendPushToUser(admin.id, title, body, '/admin/dashboard');
            }

            // Canlı paneli açık olan yöneticilere de socket üzerinden gönder
            io.to('admin').emit('active-sessions-reminder', {
                sessionsCount: sessions.length,
                message: body,
                sessions: sessions
            });

            console.log(`[Bildirim Hatırlatıcısı] ${sessions.length} adet aktif ilaçlama için yöneticilere 5 dk hatırlatması yapıldı.`);
        } catch (err) {
            console.error('[Bildirim Hatırlatıcısı] Hata:', err.message);
        }
    }, 5 * 60 * 1000); // 5 dakika (5 * 60 * 1000 ms)
}

// Start server
const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
    try {
        await initDatabase();
        console.log('✅ Veritabanı başlatıldı');
        
        // Aktif ilaçlama bildirim hatırlatıcısını başlat
        startActiveSessionNotifier();

        server.listen(PORT, HOST, () => {
            const networkIPs = getNetworkIPs();
            const lanIP = networkIPs.length > 0 ? networkIPs[0].address : 'bilinmiyor';

            console.log(`
╔════════════════════════════════════════════════════════════════╗
║     SİVAS BELEDİYESİ VEKTÖRLE MÜCADELE YÖNETİM SİSTEMİ      ║
║════════════════════════════════════════════════════════════════║
║                                                                ║
║   🏠 Bu Bilgisayar:  http://localhost:${PORT}                    ║
║   🌐 Ağ Erişimi:     http://${lanIP}:${PORT}                     ║
║                                                                ║
║   🖥️  Admin Panel:    http://${lanIP}:${PORT}/admin/dashboard     ║
║   📱  Mobil Uygulama: http://${lanIP}:${PORT}/mobile              ║
║   📋  Vatandaş İhbar: http://${lanIP}:${PORT}/ihbar              ║
║                                                                ║
║   👤 Kullanıcı: admin  |  🔑 Şifre: admin123                  ║
║                                                                ║
║   📡 Sunucu ${HOST}:${PORT} üzerinde dinleniyor                   ║
╚════════════════════════════════════════════════════════════════╝`);

            if (networkIPs.length > 1) {
                console.log('\n   Diğer ağ arayüzleri:');
                networkIPs.forEach(ip => {
                    console.log(`   • ${ip.name}: http://${ip.address}:${PORT}`);
                });
            }
            console.log('');
        });
    } catch (err) {
        console.error('❌ Sunucu başlatma hatası:', err);
        process.exit(1);
    }
}

// Zarif kapanma (Graceful shutdown)
process.on('SIGTERM', () => {
    console.log('\n🛑 Sunucu kapatılıyor...');
    server.close(() => {
        console.log('✅ Sunucu başarıyla kapatıldı.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\n🛑 Sunucu kapatılıyor (Ctrl+C)...');
    server.close(() => {
        console.log('✅ Sunucu başarıyla kapatıldı.');
        process.exit(0);
    });
});

startServer();
