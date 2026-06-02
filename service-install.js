const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
    name: 'SivasVektorMucadele',
    description: 'Sivas Belediyesi Vektörle Mücadele Yönetim Sistemi',
    script: path.join(__dirname, 'server', 'index.js'),
    nodeOptions: [],
    env: [{
        name: 'NODE_ENV',
        value: 'production'
    }],
    // Otomatik yeniden başlatma
    wait: 2,
    grow: 0.5,
    maxRestarts: 10
});

svc.on('install', () => {
    console.log('✅ Servis başarıyla kuruldu!');
    svc.start();
    console.log('▶️  Servis başlatıldı.');
});

svc.on('alreadyinstalled', () => {
    console.log('⚠️  Servis zaten kurulu. Yeniden başlatılıyor...');
    svc.start();
});

svc.on('error', (err) => {
    console.error('❌ Servis hatası:', err);
});

svc.install();
