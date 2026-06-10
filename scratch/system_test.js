const http = require('http');

const BASE = 'http://localhost:3000';

// Test a URL and return status info
function testUrl(path, options = {}) {
    return new Promise((resolve) => {
        const url = new URL(path, BASE);
        const reqOpts = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 8000
        };
        
        const req = http.request(reqOpts, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({ path, status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 400, bodyLength: body.length, body: body.substring(0, 200) });
            });
        });
        req.on('error', (err) => {
            resolve({ path, status: 0, ok: false, error: err.message });
        });
        req.on('timeout', () => {
            req.destroy();
            resolve({ path, status: 0, ok: false, error: 'TIMEOUT' });
        });
        req.end(options.body || undefined);
    });
}

async function runTests() {
    console.log('=== KAPSAMLI SİSTEM TESTİ ===\n');
    
    // 1. LOGIN & TOKEN
    console.log('--- 1. GİRİŞ SİSTEMİ ---');
    const loginRes = await testUrl('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    console.log(`POST /api/auth/login => ${loginRes.status} (${loginRes.ok ? 'OK' : 'HATA'})`);
    
    let TOKEN = '';
    if (loginRes.ok) {
        try {
            const data = JSON.parse(loginRes.body.substring(0, loginRes.bodyLength > 500 ? 500 : loginRes.bodyLength));
            // body might be truncated, try full body
        } catch(e) {}
    }
    
    // Full login to get token
    const loginFull = await new Promise((resolve) => {
        const url = new URL('/api/auth/login', BASE);
        const postData = JSON.stringify({ username: 'admin', password: 'admin123' });
        const req = http.request({
            hostname: url.hostname, port: url.port, path: url.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', (err) => resolve({ status: 0, error: err.message }));
        req.end(postData);
    });
    
    if (loginFull.status === 200) {
        try {
            const parsed = JSON.parse(loginFull.body);
            TOKEN = parsed.token;
            console.log(`  Token alındı: ${TOKEN ? TOKEN.substring(0, 20) + '...' : 'YOK'}`);
        } catch(e) {
            console.log(`  Token parse hatası: ${e.message}`);
        }
    } else {
        console.log(`  GİRİŞ BAŞARISIZ! Status: ${loginFull.status}`);
    }
    
    const authHeaders = TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {};
    
    // 2. STATIC PAGES (no auth needed)
    console.log('\n--- 2. STATIK SAYFALAR (Auth Gerektirmeyen) ---');
    const publicPages = [
        '/',
        '/vatandas-harita',
        '/citizen',
    ];
    for (const p of publicPages) {
        const r = await testUrl(p);
        const icon = r.ok ? '✅' : '❌';
        console.log(`${icon} GET ${p} => ${r.status} (${r.bodyLength} bytes)`);
    }
    
    // 3. ADMIN PAGES (served as static, auth checked client-side)
    console.log('\n--- 3. ADMIN SAYFALARI ---');
    const adminPages = [
        '/admin/dashboard',
        '/admin/sessions',
        '/admin/planning',
        '/admin/vehicles',
        '/admin/personnel',
        '/admin/chemicals',
        '/admin/vehicle-stock',
        '/admin/fuel-tracking',
        '/admin/reports',
        '/admin/citizen-reports',
    ];
    for (const p of adminPages) {
        const r = await testUrl(p);
        const icon = r.ok ? '✅' : '❌';
        console.log(`${icon} GET ${p} => ${r.status} (${r.bodyLength} bytes)`);
    }
    
    // 4. MOBILE PAGES
    console.log('\n--- 4. MOBİL UYGULAMA ---');
    const mobilePages = [
        '/mobile',
        '/mobile/index.html',
    ];
    for (const p of mobilePages) {
        const r = await testUrl(p);
        const icon = r.ok ? '✅' : '❌';
        console.log(`${icon} GET ${p} => ${r.status} (${r.bodyLength} bytes)`);
    }
    
    // 5. PUBLIC APIs (no auth)
    console.log('\n--- 5. KAMUSAL API\'LER (Auth Gerektirmeyen) ---');
    const publicApis = [
        '/api/reports/public/expiry-map',
    ];
    for (const p of publicApis) {
        const r = await testUrl(p);
        const icon = r.ok ? '✅' : '❌';
        console.log(`${icon} GET ${p} => ${r.status}`);
    }
    
    // 6. AUTHENTICATED APIs
    console.log('\n--- 6. YETKİLİ API\'LER (Token ile) ---');
    const authApis = [
        '/api/reports/dashboard',
        '/api/reports/daily?date_from=2026-05-01&date_to=2026-06-10',
        '/api/reports/monthly?date_from=2026-05-01&date_to=2026-06-10',
        '/api/reports/expiry-map',
        '/api/reports/sprayed-streets',
        '/api/reports/schedule',
        '/api/reports/neighborhood-coverage',
        '/api/reports/vehicle-locations',
        '/api/vehicles',
        '/api/personnel',
        '/api/chemicals',
        '/api/vehicles/stock/levels',
        '/api/vehicles/fuel/logs',
        '/api/vehicles/fuel/stats',
        '/api/sessions',
        '/api/citizen-reports',
        '/api/routes',
    ];
    for (const p of authApis) {
        const r = await testUrl(p, { headers: authHeaders });
        const icon = r.ok ? '✅' : '❌';
        let extra = '';
        if (r.ok && r.body) {
            try {
                const d = JSON.parse(r.body.length > 500 ? r.body : r.body);
                if (Array.isArray(d)) extra = ` [${d.length} kayıt]`;
                else if (d.sessions) extra = ` [${d.sessions.length} oturum]`;
                else if (d.streets) extra = ` [${d.streets.length} sokak]`;
            } catch(e) {}
        }
        console.log(`${icon} GET ${p.split('?')[0]} => ${r.status}${extra}`);
    }
    
    // 7. CHECK FOR COMMON HTML ISSUES
    console.log('\n--- 7. HTML BÜTÜNLÜK KONTROLÜ ---');
    const pagesToCheck = [
        { path: '/', name: 'Giriş' },
        { path: '/vatandas-harita', name: 'Vatandaş Haritası' },
        { path: '/citizen', name: 'Vatandaş İhbar' },
        { path: '/admin/dashboard', name: 'Admin Dashboard' },
        { path: '/admin/reports', name: 'Raporlar' },
        { path: '/admin/sessions', name: 'Oturumlar' },
        { path: '/admin/planning', name: 'Planlama' },
        { path: '/admin/vehicles', name: 'Araçlar' },
        { path: '/admin/personnel', name: 'Personel' },
        { path: '/admin/chemicals', name: 'İlaçlar' },
        { path: '/admin/vehicle-stock', name: 'Araç Stok' },
        { path: '/admin/fuel-tracking', name: 'Yakıt Takip' },
        { path: '/admin/citizen-reports', name: 'Vatandaş İhbar Yönetim' },
        { path: '/mobile/index.html', name: 'Mobil Uygulama' },
    ];
    
    for (const pg of pagesToCheck) {
        const r = await new Promise((resolve) => {
            const url = new URL(pg.path, BASE);
            http.get({ hostname: url.hostname, port: url.port, path: url.pathname }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve({ status: res.statusCode, body }));
            }).on('error', (err) => resolve({ status: 0, error: err.message }));
        });
        
        if (r.status === 200 && r.body) {
            const issues = [];
            if (!r.body.includes('</html>')) issues.push('Eksik </html> kapatma etiketi');
            if (!r.body.includes('</body>')) issues.push('Eksik </body> kapatma etiketi');
            if (!r.body.includes('</head>')) issues.push('Eksik </head> kapatma etiketi');
            
            // Check for unclosed script tags
            const scriptOpens = (r.body.match(/<script/g) || []).length;
            const scriptCloses = (r.body.match(/<\/script>/g) || []).length;
            if (scriptOpens !== scriptCloses) issues.push(`Script etiketi uyumsuzluğu: ${scriptOpens} açılış vs ${scriptCloses} kapanış`);
            
            // Check for broken CSS/JS references
            const cssRefs = r.body.match(/href="([^"]*\.css)"/g) || [];
            const jsRefs = r.body.match(/src="([^"]*\.js)"/g) || [];
            
            const icon = issues.length === 0 ? '✅' : '⚠️';
            console.log(`${icon} ${pg.name} (${pg.path}): ${issues.length === 0 ? 'Sorunsuz' : issues.join(', ')}`);
        } else {
            console.log(`❌ ${pg.name} (${pg.path}): HTTP ${r.status}`);
        }
    }

    // 8. CHECK CSS AND JS STATIC ASSETS
    console.log('\n--- 8. STATİK DOSYA KONTROLÜ ---');
    const assets = [
        '/css/main.css',
        '/admin/admin-notifications.js',
    ];
    for (const a of assets) {
        const r = await testUrl(a);
        const icon = r.ok ? '✅' : '❌';
        console.log(`${icon} ${a} => ${r.status} (${r.bodyLength} bytes)`);
    }
    
    // 9. CITIZEN REPORT PUBLIC QUERY
    console.log('\n--- 9. VATANDAŞ İHBAR KAMUSAL SORGU ---');
    const cqr = await testUrl('/api/citizen-reports/public/query?phone=5551234567');
    console.log(`${cqr.ok ? '✅' : '❌'} GET /api/citizen-reports/public/query => ${cqr.status}`);
    
    console.log('\n=== TEST TAMAMLANDI ===');
}

runTests().catch(err => console.error('Test hatası:', err));
