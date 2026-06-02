const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');

// .env dosyasından ortam değişkenlerini yükle
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch(e) {
    // dotenv yoksa sistem ortam değişkenlerini kullan
}

const { initDatabase } = require('./config/database');

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
