const fetch = globalThis.fetch || require('node-fetch');

async function test() {
    console.log("Logging in as admin...");
    try {
        const loginRes = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123', role: 'admin' })
        });
        
        if (!loginRes.ok) {
            console.error("Login failed:", loginRes.status, await loginRes.text());
            return;
        }
        
        const loginData = await loginRes.json();
        const token = loginData.token;
        console.log("Logged in successfully! Token received.");
        
        // Şeyh Şamil bounding box
        const bbox = {
            south: 39.7504,
            west: 37.0461,
            north: 39.7884,
            east: 37.0936,
            neighborhood: 'ŞEYH ŞAMİL'
        };
        
        console.log("Requesting streets for Şeyh Şamil bounding box...");
        const streetsRes = await fetch('http://localhost:3000/api/routes/fetch-streets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(bbox)
        });
        
        if (!streetsRes.ok) {
            console.error("Fetch streets failed:", streetsRes.status, await streetsRes.text());
            return;
        }
        
        const geojson = await streetsRes.json();
        console.log("--- SUCCESS ---");
        console.log("GeoJSON Type:", geojson.type);
        console.log("Features found:", geojson.features ? geojson.features.length : 0);
        if (geojson.features && geojson.features.length > 0) {
            console.log("Sample Street 1:", JSON.stringify(geojson.features[0].properties));
            console.log("Sample Street 2:", JSON.stringify(geojson.features[1].properties));
        }
        
    } catch (err) {
        console.error("Test encountered error:", err);
    }
}

test();
