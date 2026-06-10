const fs = require('fs');
const path = require('path');

const dir = 'public/admin';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

const expectedLinks = [
    '/admin/dashboard',
    '/admin/sessions',
    '/admin/planning',
    '/admin/vehicles',
    '/admin/personnel',
    '/admin/chemicals',
    '/admin/vehicle-stock',
    '/admin/fuel-tracking',
    '/admin/reports',
    '/admin/citizen-reports'
];

console.log('=== SIDEBAR TUTARLILIK KONTROLÜ ===\n');

files.forEach(f => {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    const missing = expectedLinks.filter(e => !html.includes(`href="${e}"`));
    if (missing.length > 0) {
        console.log(`❌ ${f}: EKSIK sidebar linkleri:`);
        missing.forEach(m => console.log(`   - ${m}`));
    } else {
        console.log(`✅ ${f}: Sidebar OK`);
    }
});

// Check main.css exists
console.log('\n=== CSS DOSYASI KONTROLÜ ===');
const cssPath = 'public/css/main.css';
if (fs.existsSync(cssPath)) {
    const cssSize = fs.statSync(cssPath).size;
    console.log(`✅ main.css mevcut (${cssSize} bytes)`);
} else {
    console.log('❌ main.css BULUNAMADI!');
}

// Check admin-notifications.js
console.log('\n=== ADMIN NOTIFICATIONS JS ===');
const notifPath = 'public/admin/admin-notifications.js';
if (fs.existsSync(notifPath)) {
    const notifSize = fs.statSync(notifPath).size;
    console.log(`✅ admin-notifications.js mevcut (${notifSize} bytes)`);
} else {
    console.log('❌ admin-notifications.js BULUNAMADI!');
}

// Check icons directory
console.log('\n=== İKON/GÖRSEL DOSYALARI ===');
const iconDir = 'public/icons';
if (fs.existsSync(iconDir)) {
    const icons = fs.readdirSync(iconDir);
    console.log(`✅ /icons/ klasörü: ${icons.length} dosya`);
    icons.forEach(i => console.log(`   - ${i} (${fs.statSync(path.join(iconDir, i)).size} bytes)`));
} else {
    console.log('⚠️ /icons/ klasörü bulunamadı');
}
