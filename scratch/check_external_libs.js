const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Extract all external URLs from HTML files
function extractExternalUrls(htmlContent) {
    const urls = new Set();
    const patterns = [
        /src="(https?:\/\/[^"]+)"/g,
        /href="(https?:\/\/[^"]+)"/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(htmlContent)) !== null) {
            urls.add(match[1]);
        }
    }
    return [...urls];
}

async function checkUrl(url) {
    return new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: 8000 }, (res) => {
            resolve({ url, status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 400 });
            res.resume();
        });
        req.on('error', (err) => resolve({ url, status: 0, ok: false, error: err.message }));
        req.on('timeout', () => { req.destroy(); resolve({ url, status: 0, ok: false, error: 'TIMEOUT' }); });
    });
}

async function main() {
    const filesToCheck = [
        'public/index.html',
        'public/citizen.html',
        'public/vatandas-harita.html',
        'public/mobile/index.html',
        'public/admin/dashboard.html',
        'public/admin/reports.html',
        'public/admin/sessions.html',
        'public/admin/planning.html',
    ];

    const allUrls = new Map();

    for (const f of filesToCheck) {
        if (!fs.existsSync(f)) continue;
        const html = fs.readFileSync(f, 'utf8');
        const urls = extractExternalUrls(html);
        for (const url of urls) {
            if (!allUrls.has(url)) {
                allUrls.set(url, []);
            }
            allUrls.get(url).push(path.basename(f));
        }
    }

    console.log(`=== HARİCİ KÜTÜPHANE ERİŞİLEBİLİRLİK TESTİ ===`);
    console.log(`Toplam ${allUrls.size} harici URL bulundu.\n`);

    for (const [url, files] of allUrls) {
        const result = await checkUrl(url);
        const icon = result.ok ? '✅' : '❌';
        const shortUrl = url.length > 80 ? url.substring(0, 77) + '...' : url;
        console.log(`${icon} ${shortUrl}`);
        if (!result.ok) {
            console.log(`   Durum: ${result.status || result.error}`);
            console.log(`   Kullanan: ${files.join(', ')}`);
        }
    }
}

main().catch(err => console.error('Hata:', err));
