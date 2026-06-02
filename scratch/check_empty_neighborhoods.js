const { initDatabase } = require('../server/config/database');
const path = require('path');
const cp = require('child_process');

function fetchLocalStreets(south, west, north, east, neighborhood = '') {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '..', 'server', 'services', 'query_streets.py');
        const child = cp.spawn('python', [scriptPath]);
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        
        child.on('close', (code) => {
            if (code !== 0) return reject(new Error(`Exit code ${code}: ${stderr}`));
            try {
                resolve(JSON.parse(stdout));
            } catch (err) {
                reject(err);
            }
        });
        
        child.stdin.write(JSON.stringify({ south, west, north, east, neighborhood }));
        child.stdin.end();
    });
}

async function check() {
    try {
        const db = await initDatabase();
        const result = await db.exec("SELECT name, boundary_geojson FROM neighborhoods ORDER BY name");
        const rows = result[0].values.map(val => ({ name: val[0], boundary_geojson: val[1] }));
        
        console.log("Checking all neighborhoods for street queries...");
        for (const row of rows) {
            if (!row.boundary_geojson) {
                console.log(`❌ ${row.name} has no boundary in database.`);
                continue;
            }
            
            const geom = JSON.parse(row.boundary_geojson);
            // Calculate bbox
            let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
            function processCoords(coords) {
                if (Array.isArray(coords[0])) {
                    coords.forEach(processCoords);
                } else {
                    const [lng, lat] = coords;
                    if (lat < minLat) minLat = lat;
                    if (lat > maxLat) maxLat = lat;
                    if (lng < minLng) minLng = lng;
                    if (lng > maxLng) maxLng = lng;
                }
            }
            processCoords(geom.coordinates);
            
            try {
                const geojson = await fetchLocalStreets(minLat, minLng, maxLat, maxLng, row.name);
                const count = geojson.features ? geojson.features.length : 0;
                if (count === 0) {
                    console.log(`⚠️ ${row.name}: 0 streets found! BBox: ${minLat}, ${minLng}, ${maxLat}, ${maxLng}`);
                } else {
                    console.log(`✅ ${row.name}: ${count} streets found.`);
                }
            } catch (err) {
                console.log(`❌ ${row.name} query failed: ${err.message}`);
            }
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
