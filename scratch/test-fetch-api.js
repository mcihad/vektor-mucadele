const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const south = 39.76923768059679;
const west = 37.04954266393176;
const north = 39.811965522767764;
const east = 37.11069439184814;
const neighborhood = "AHMET TURANGAZİ";

async function main() {
    try {
        console.log("1. Logging in as admin...");
        const loginRes = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123' })
        });
        
        if (!loginRes.ok) {
            console.error("Login failed:", loginRes.status);
            return;
        }
        
        const loginData = await loginRes.json();
        const token = loginData.token;
        console.log("Logged in successfully. Token obtained.");
        
        console.log("\n2. Calling /fetch-streets API...");
        const res = await fetch('http://localhost:3000/api/routes/fetch-streets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                south, west, north, east, neighborhood
            })
        });
        
        if (!res.ok) {
            console.error("Fetch streets API failed:", res.status, await res.text());
            return;
        }
        
        const geojson = await res.json();
        console.log(`Fetched ${geojson.features.length} streets total from API merge.`);
        
        const targetFids = ['14031', '11831', '11830'];
        const targets = geojson.features.filter(f => targetFids.includes(String(f.properties.fid)));
        
        console.log("\nTargets found in API response:");
        targets.forEach(t => {
            console.log(`  Street: ${t.properties.name} (FID: ${t.properties.fid}, ID: ${t.id}) | Sprayable: ${t.properties.sprayable}`);
        });
        
        if (targets.length === 3) {
            console.log("\nSUCCESS! All three diagonal street segments are successfully returned by the API!");
        } else {
            console.log(`\nPartial success. Found ${targets.length}/3 segments. Check if they were filtered by OSM distance.`);
        }
    } catch (e) {
        console.error("Error calling API:", e);
    }
}
main();
