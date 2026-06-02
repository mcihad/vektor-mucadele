const { initDatabase } = require('../server/config/database');

async function check() {
    try {
        const db = await initDatabase();
        const result = await db.exec("SELECT name, boundary_geojson FROM neighborhoods WHERE name = 'ŞEYH ŞAMİL'");
        if (result && result[0]) {
            const name = result[0].values[0][0];
            const geojsonStr = result[0].values[0][1];
            const geojson = JSON.parse(geojsonStr);
            console.log("Neighborhood:", name);
            console.log("GeoJSON Type:", geojson.type);
            
            // Calculate bbox from GeoJSON
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
            
            if (geojson.type === 'Polygon') {
                processCoords(geojson.coordinates);
            } else if (geojson.type === 'MultiPolygon') {
                processCoords(geojson.coordinates);
            }
            
            console.log(`Bounding Box for ŞEYH ŞAMİL:`);
            console.log(`South (minLat):`, minLat);
            console.log(`West (minLng):`, minLng);
            console.log(`North (maxLat):`, maxLat);
            console.log(`East (maxLng):`, maxLng);
        } else {
            console.log("ŞEYH ŞAMİL not found!");
        }
        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

check();
