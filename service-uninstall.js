const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
    name: 'SivasVektorMucadele',
    description: 'Sivas Belediyesi Vektörle Mücadele Yönetim Sistemi',
    script: path.join(__dirname, 'server', 'index.js')
});

svc.on('uninstall', () => {
    console.log('✅ Servis başarıyla kaldırıldı.');
});

svc.on('error', (err) => {
    console.error('❌ Hata:', err);
});

svc.uninstall();
