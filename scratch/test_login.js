const http = require('http');

function postJSON(url, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const req = http.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: JSON.parse(body)
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        bodyText: body
                    });
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(payload);
        req.end();
    });
}

async function runTests() {
    console.log("=== GİRİŞ TESTLERİ BAŞLATILIYOR ===\n");

    // Test 1: Admin Girişi
    try {
        console.log("1. Admin girişi test ediliyor (admin / admin123)...");
        const adminRes = await postJSON('http://localhost:3000/api/auth/login', {
            username: 'admin',
            password: 'admin123'
        });
        
        console.log(`Durum Kodu: ${adminRes.statusCode}`);
        if (adminRes.statusCode === 200) {
            console.log("✅ Admin Girişi Başarılı!");
            console.log("Kullanıcı Bilgileri:", JSON.stringify(adminRes.data.user, null, 2));
            console.log("Token:", adminRes.data.token.substring(0, 20) + "...");
        } else {
            console.log("❌ Admin Girişi Başarısız!", adminRes.data || adminRes.bodyText);
        }
    } catch (err) {
        console.error("Hata:", err.message);
    }

    console.log("\n------------------------------------\n");

    // Test 2: Saha Personeli Girişi
    try {
        console.log("2. Saha personeli girişi test ediliyor (ufuk / sivas2024)...");
        const fieldRes = await postJSON('http://localhost:3000/api/auth/login', {
            username: 'ufuk',
            password: 'sivas2024'
        });

        console.log(`Durum Kodu: ${fieldRes.statusCode}`);
        if (fieldRes.statusCode === 200) {
            console.log("✅ Saha Personeli Girişi Başarılı!");
            console.log("Kullanıcı Bilgileri:", JSON.stringify(fieldRes.data.user, null, 2));
            console.log("Token:", fieldRes.data.token.substring(0, 20) + "...");
        } else {
            console.log("❌ Saha Personeli Girişi Başarısız!", fieldRes.data || fieldRes.bodyText);
        }
    } catch (err) {
        console.error("Hata:", err.message);
    }
}

runTests();
