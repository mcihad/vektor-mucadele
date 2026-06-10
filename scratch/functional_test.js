const http = require('http');

const BASE = 'http://localhost:3000';

function httpReq(method, path, body, headers = {}) {
    return new Promise((resolve) => {
        const url = new URL(path, BASE);
        const postData = body ? JSON.stringify(body) : '';
        const reqOpts = {
            hostname: url.hostname, port: url.port,
            path: url.pathname + url.search,
            method, headers: { 'Content-Type': 'application/json', ...headers },
            timeout: 8000
        };
        if (postData) reqOpts.headers['Content-Length'] = Buffer.byteLength(postData);
        
        const req = http.request(reqOpts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch(e) { resolve({ status: res.statusCode, data, parseError: true }); }
            });
        });
        req.on('error', err => resolve({ status: 0, error: err.message }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'TIMEOUT' }); });
        if (postData) req.write(postData);
        req.end();
    });
}

async function main() {
    console.log('=== FONKSİYONEL API TESTLERİ ===\n');
    
    // 1. Login
    console.log('--- 1. GİRİŞ TESTİ ---');
    const loginRes = await httpReq('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    const TOKEN = loginRes.data?.token;
    console.log(`  Admin giriş: ${loginRes.status === 200 ? '✅' : '❌'} (${loginRes.status})`);
    
    // Try saha login
    const sahaLogin = await httpReq('POST', '/api/auth/login', { username: 'ufuk', password: 'ufuk123' });
    console.log(`  Saha personeli giriş (ufuk): ${sahaLogin.status === 200 ? '✅' : '❌'} (${sahaLogin.status})`);
    if (sahaLogin.status === 200) {
        console.log(`    Rol: ${sahaLogin.data?.user?.role}, Adı: ${sahaLogin.data?.user?.full_name}`);
    }
    
    // Wrong password
    const wrongLogin = await httpReq('POST', '/api/auth/login', { username: 'admin', password: 'wrongpassword' });
    console.log(`  Yanlış şifre ile giriş: ${wrongLogin.status === 401 ? '✅ (doğru şekilde reddedildi)' : '❌ (' + wrongLogin.status + ')'}`);
    
    const authH = { 'Authorization': 'Bearer ' + TOKEN };
    
    // 2. Dashboard stats
    console.log('\n--- 2. DASHBOARD İSTATİSTİKLERİ ---');
    const dashRes = await httpReq('GET', '/api/reports/dashboard', null, authH);
    if (dashRes.status === 200) {
        const d = dashRes.data;
        console.log(`  ✅ Bugünkü oturumlar: ${d.today_sessions}`);
        console.log(`  ✅ Aktif oturumlar: ${d.active_sessions}`);
        console.log(`  ✅ Bugünkü toplam km: ${d.total_km_today}`);
        console.log(`  ✅ Bekleyen ihbarlar: ${d.pending_reports}`);
        console.log(`  ✅ Stok uyarısı: ${d.low_stock_chemicals}`);
        console.log(`  ✅ Yaklaşan süreler: ${d.expiring_streets}`);
    } else {
        console.log(`  ❌ Dashboard stats hatası: ${dashRes.status}`);
    }
    
    // 3. Sessions
    console.log('\n--- 3. OTURUM YÖNETİMİ ---');
    const sessRes = await httpReq('GET', '/api/sessions', null, authH);
    if (sessRes.status === 200) {
        const sessions = Array.isArray(sessRes.data) ? sessRes.data : (sessRes.data.sessions || []);
        console.log(`  ✅ Toplam oturum: ${sessions.length}`);
        if (sessions.length > 0) {
            const last = sessions[sessions.length - 1];
            console.log(`  Son oturum: #${last.id}, Durum: ${last.status}, Araç: ${last.plate || '-'}`);
        }
    } else {
        console.log(`  ❌ Oturum listesi hatası: ${sessRes.status}`);
    }
    
    // 4. Vehicles
    console.log('\n--- 4. ARAÇ YÖNETİMİ ---');
    const vehRes = await httpReq('GET', '/api/vehicles', null, authH);
    if (vehRes.status === 200) {
        const vehicles = Array.isArray(vehRes.data) ? vehRes.data : [];
        console.log(`  ✅ Toplam araç: ${vehicles.length}`);
        vehicles.forEach(v => console.log(`    🚐 ${v.plate} (${v.machine_name}) - ${v.online_status || v.status || '-'}`));
    }
    
    // 5. Personnel
    console.log('\n--- 5. PERSONEL YÖNETİMİ ---');
    const persRes = await httpReq('GET', '/api/personnel', null, authH);
    if (persRes.status === 200) {
        const personnel = Array.isArray(persRes.data) ? persRes.data : [];
        console.log(`  ✅ Toplam personel: ${personnel.length}`);
        personnel.forEach(p => console.log(`    👤 ${p.name} (${p.role}) - ${p.status}`));
    }
    
    // 6. Chemicals
    console.log('\n--- 6. İLAÇ STOK ---');
    const chemRes = await httpReq('GET', '/api/chemicals', null, authH);
    if (chemRes.status === 200) {
        const chems = Array.isArray(chemRes.data) ? chemRes.data : [];
        console.log(`  ✅ Toplam ilaç kaydı: ${chems.length}`);
        chems.forEach(c => console.log(`    🧪 ${c.name}: ${c.stock_amount} ${c.unit} (Min: ${c.min_stock_alert})`));
    }
    
    // 7. Vehicle stock levels
    console.log('\n--- 7. ARAÇ STOK SEVİYELERİ ---');
    const stockRes = await httpReq('GET', '/api/vehicles/stock/levels', null, authH);
    if (stockRes.status === 200) {
        const stocks = Array.isArray(stockRes.data) ? stockRes.data : [];
        console.log(`  ✅ Araç stok kayıtları: ${stocks.length}`);
    }
    
    // 8. Fuel tracking
    console.log('\n--- 8. YAKIT TAKİP ---');
    const fuelLogs = await httpReq('GET', '/api/vehicles/fuel/logs', null, authH);
    const fuelStats = await httpReq('GET', '/api/vehicles/fuel/stats', null, authH);
    console.log(`  ✅ Yakıt log kayıtları: ${fuelLogs.status === 200 ? (Array.isArray(fuelLogs.data) ? fuelLogs.data.length : '?') : 'HATA'}`);
    console.log(`  ✅ Yakıt istatistikleri: ${fuelStats.status === 200 ? 'OK' : 'HATA'}`);
    
    // 9. Reports
    console.log('\n--- 9. RAPORLAR ---');
    const dailyRep = await httpReq('GET', '/api/reports/daily?date_from=2026-05-01&date_to=2026-06-10', null, authH);
    console.log(`  Günlük rapor: ${dailyRep.status === 200 ? '✅' : '❌'} ${dailyRep.data?.sessions?.length || 0} oturum`);
    
    const monthlyRep = await httpReq('GET', '/api/reports/monthly?date_from=2026-05-01&date_to=2026-06-10', null, authH);
    console.log(`  Aylık rapor: ${monthlyRep.status === 200 ? '✅' : '❌'}`);
    
    const coverageRep = await httpReq('GET', '/api/reports/neighborhood-coverage', null, authH);
    console.log(`  Mahalle kapsam: ${coverageRep.status === 200 ? '✅' : '❌'} ${Array.isArray(coverageRep.data) ? coverageRep.data.length : '?'} mahalle`);
    
    const scheduleRep = await httpReq('GET', '/api/reports/schedule', null, authH);
    console.log(`  Yaklaşan süreler: ${scheduleRep.status === 200 ? '✅' : '❌'} ${Array.isArray(scheduleRep.data) ? scheduleRep.data.length : '?'} kayıt`);
    
    // 10. Citizen reports
    console.log('\n--- 10. VATANDAŞ İHBARLARI ---');
    const citRepRes = await httpReq('GET', '/api/citizen-reports', null, authH);
    console.log(`  İhbar listesi: ${citRepRes.status === 200 ? '✅' : '❌'} ${Array.isArray(citRepRes.data) ? citRepRes.data.length : '?'} kayıt`);
    
    const pubQuery = await httpReq('GET', '/api/citizen-reports/public/query?phone=5551234567');
    console.log(`  Kamusal sorgu: ${pubQuery.status === 200 ? '✅' : '❌'}`);
    
    // 11. Expiry map
    console.log('\n--- 11. ETKİ HARİTASI ---');
    const pubExpiry = await httpReq('GET', '/api/reports/public/expiry-map');
    console.log(`  Kamusal etki haritası: ${pubExpiry.status === 200 ? '✅' : '❌'} ${pubExpiry.data?.streets?.length || 0} sokak`);
    
    const admExpiry = await httpReq('GET', '/api/reports/expiry-map', null, authH);
    console.log(`  Admin etki haritası: ${admExpiry.status === 200 ? '✅' : '❌'} ${admExpiry.data?.streets?.length || 0} sokak, ${admExpiry.data?.warnings?.length || 0} uyarı`);
    
    // 12. Planned routes
    console.log('\n--- 12. PLANLAMA ---');
    const routeNeighborhoods = await httpReq('GET', '/api/routes/neighborhoods', null, authH);
    console.log(`  Mahalleler: ${routeNeighborhoods.status === 200 ? '✅' : '❌'}`);
    
    const plannedRoutes = await httpReq('GET', '/api/routes/planned-routes', null, authH);
    console.log(`  Planlı rotalar: ${plannedRoutes.status === 200 ? '✅' : '❌'} ${Array.isArray(plannedRoutes.data) ? plannedRoutes.data.length : '?'} rota`);
    
    // 13. Mobile specific - assigned route for field user
    if (sahaLogin.status === 200) {
        const sahaToken = sahaLogin.data.token;
        const sahaAuth = { 'Authorization': 'Bearer ' + sahaToken };
        const userId = sahaLogin.data.user.id;
        
        console.log('\n--- 13. SAHA PERSONELİ MOBİL FONKSİYONLARI ---');
        const assignedRoute = await httpReq('GET', `/api/routes/assigned/${userId}`, null, sahaAuth);
        console.log(`  Atanmış rota: ${assignedRoute.status === 200 ? '✅' : '❌'} (${assignedRoute.status})`);
        
        // Check vehicles for mobile
        const mobileVehicles = await httpReq('GET', '/api/vehicles', null, sahaAuth);
        console.log(`  Araç listesi (mobil): ${mobileVehicles.status === 200 ? '✅' : '❌'}`);
    }
    
    console.log('\n=== FONKSİYONEL TEST TAMAMLANDI ===');
}

main().catch(err => console.error('Test hatası:', err));
