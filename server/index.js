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

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
const authRoutes = require('./routes/auth');
const vehicleRoutes = require('./routes/vehicles');
const personnelRoutes = require('./routes/personnel');
const createSessionRoutes = require('./routes/sessions');
const reportRoutes = require('./routes/reports');
const chemicalRoutes = require('./routes/chemicals');
const createCitizenReportRoutes = require('./routes/citizenReports');
const routeRoutes = require('./routes/routes');

app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/personnel', personnelRoutes);
app.use('/api/sessions', createSessionRoutes(io));
app.use('/api/reports', reportRoutes);
app.use('/api/chemicals', chemicalRoutes);
app.use('/api/citizen-reports', createCitizenReportRoutes(io));
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
        await webpush.sendNotification(subscription, JSON.stringify({ title, body, url: url || '/mobile/' }));
        console.log(`[Push] Kullanıcı #${userId}'ye bildirim gönderildi: ${title}`);
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
app.get('/vatandas-veri', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'vatandas-veri.html')));

// Socket.io - real-time vehicle tracking
io.on('connection', (socket) => {
    console.log(`[Socket] Yeni bağlantı: ${socket.id}`);

    socket.on('vehicle-location', (data) => {
        // Broadcast vehicle location to all admin clients
        io.emit('vehicle-update', data);
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
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Bağlantı koptu: ${socket.id}`);
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

// Start server
const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
    try {
        await initDatabase();
        console.log('✅ Veritabanı başlatıldı');

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
