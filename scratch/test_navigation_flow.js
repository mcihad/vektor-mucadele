const { initDatabase, getDb } = require('../server/config/database');
const path = require('path');

// Dynamically load the .env configuration
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runSimulation() {
    console.log("=== SİVAS BELEDİYESİ VMS - NAVİGASYON ENTEGRASYON TESTİ ===");
    
    let db;
    try {
        db = await initDatabase();
    } catch(err) {
        console.error("PostgreSQL bağlantı hatası. Test lokal modda bir yapay rota ile devam edecek...");
    }
    
    let route = null;
    
    if (db) {
        try {
            // Find the most recent planned route in the PostgreSQL database
            const result = await db.exec("SELECT * FROM planned_routes ORDER BY id DESC LIMIT 1");
            if (result && result[0] && result[0].values.length > 0) {
                const cols = result[0].columns;
                const row = result[0].values[0];
                route = {};
                cols.forEach((col, idx) => {
                    route[col] = row[idx];
                });
                console.log(`\n[Veritabanı] Son planlanan rota başarıyla yüklendi:`);
                console.log(`- Rota Adı: ${route.name}`);
                console.log(`- Mahalle: ${route.neighborhood}`);
                console.log(`- Toplam Mesafe: ${route.total_distance_km} km`);
            } else {
                console.log("\n[Veritabanı] Henüz planlanmış bir rota bulunamadı.");
            }
        } catch (e) {
            console.error("Veritabanı sorgulama hatası:", e.message);
        }
    }
    
    // Fallback or custom dummy route coordinates if no route was found
    if (!route) {
        console.log("\n[Simülasyon] Test için örnek bir Sivas Yenişehir Mahallesi rotası oluşturuluyor...");
        const dummyCoords = [
            [39.7405, 37.0125], // Start point (Yenişehir girişi)
            [39.7410, 37.0130],
            [39.7420, 37.0145],
            [39.7425, 37.0150],
            [39.7430, 37.0162],
            [39.7445, 37.0180],
            [39.7455, 37.0200],
            [39.7460, 37.0215],
            [39.7470, 37.0230],
            [39.7475, 37.0242]  // End point (Yenişehir çıkışı)
        ];
        route = {
            name: "Yenişehir Örnek Rota",
            neighborhood: "Yenişehir",
            route_coords: JSON.stringify(dummyCoords),
            total_distance_km: 1.8
        };
    }
    
    try {
        const coords = JSON.parse(route.route_coords);
        if (coords.length < 2) {
            throw new Error("Rota koordinatları yetersiz.");
        }
        
        console.log(`\n[Rota Analizi] Toplam Koordinat Sayısı: ${coords.length}`);
        console.log(`- Başlangıç Noktası (Yeşil 🏁): [${coords[0][0]}, ${coords[0][1]}]`);
        console.log(`- Bitiş Noktası (Kırmızı 🏁): [${coords[coords.length - 1][0]}, ${coords[coords.length - 1][1]}]`);
        
        // Target: Current worker position (lastPos)
        // Let's assume the worker is currently at Sivas Municipality center (GPS simulation)
        const workerPos = { lat: 39.7477, lng: 37.0179 };
        console.log(`- Saha Personeli Mevcut Konumu (Simüle): [${workerPos.lat}, ${workerPos.lng}]`);
        
        const origin = `${workerPos.lat},${workerPos.lng}`;
        const destination = `${coords[coords.length - 1][0]},${coords[coords.length - 1][1]}`;
        
        // Helper function to calculate bearing/direction between coordinates
        function getBearing(lat1, lon1, lat2, lon2) {
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const lat1Rad = lat1 * Math.PI / 180;
            const lat2Rad = lat2 * Math.PI / 180;
            
            const y = Math.sin(dLon) * Math.cos(lat2Rad);
            const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
            
            let bearing = Math.atan2(y, x) * 180 / Math.PI;
            return (bearing + 360) % 360;
        }

        // Upgraded smart turn-based waypoint selector
        let waypointsStr = "";
        let sampled = [];
        if (coords.length > 2) {
            const numWaypoints = Math.min(8, coords.length - 2);
            
            if (coords.length - 2 <= numWaypoints) {
                // If we have 8 or fewer intermediate points, take all of them
                for (let i = 1; i < coords.length - 1; i++) {
                    sampled.push(`${coords[i][0]},${coords[i][1]}`);
                }
            } else {
                // Divide the intermediate points into 8 equal chunks
                const chunkSize = (coords.length - 2) / numWaypoints;
                
                for (let step = 0; step < numWaypoints; step++) {
                    const startIdx = Math.floor(1 + step * chunkSize);
                    const endIdx = Math.floor(1 + (step + 1) * chunkSize);
                    
                    let bestIdx = startIdx;
                    let maxTurnAngle = -1;
                    
                    // In each chunk, find the coordinate with the sharpest turn angle (bearing change)
                    for (let i = startIdx; i < endIdx && i < coords.length - 1; i++) {
                        let prevB = getBearing(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
                        let nextB = getBearing(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
                        let turnAngle = Math.abs(prevB - nextB);
                        if (turnAngle > 180) turnAngle = 360 - turnAngle;
                        
                        if (turnAngle > maxTurnAngle) {
                            maxTurnAngle = turnAngle;
                            bestIdx = i;
                        }
                    }
                    sampled.push(`${coords[bestIdx][0]},${coords[bestIdx][1]}`);
                }
            }
            waypointsStr = "&waypoints=" + sampled.join("|");
        }
        
        console.log(`\n[Navigasyon Hesaplama] Seçilen Keskin Dönüş Noktaları (Waypoints - Max 8 adet):`);
        sampled.forEach((wp, index) => {
            console.log(`  Dönüş ${index + 1}: ${wp}`);
        });
        
        // Construct standard URL
        const navUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointsStr}&travelmode=driving`;
        
        console.log(`\n[Navigasyon Sonucu] Üretilen Google Haritalar Yönlendirme Linki:`);
        console.log("--------------------------------------------------------------------------------");
        console.log(navUrl);
        console.log("--------------------------------------------------------------------------------");
        console.log("\n✅ Test Başarıyla Tamamlandı! Saha personeli 'Navigasyon' butonuna tıkladığında yukarıdaki link yeni sekmede açılacak ve sürücüyü yönlendirecektir.");
        
    } catch(err) {
        console.error("Test sırasında hata:", err.message);
    }
    
    // Process exit will close active pool connections automatically
    process.exit(0);
}

runSimulation();
