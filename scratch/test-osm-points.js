const { Pool } = require('pg');
const path = require('path');
const { fetchStreets } = require('../server/services/overpass');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
    host: process.env.PG_HOST || '10.0.0.200',
    database: process.env.PG_DATABASE || 'burak',
    user: process.env.PG_USER || 'burak',
    password: process.env.PG_PASSWORD || 'Bkazan90.',
    port: parseInt(process.env.PG_PORT || '5432'),
});

// Ray-casting point-in-polygon check
function isPointInPolygon(point, polygonCoords) {
    const x = point[0], y = point[1];
    let inside = false;
    const coords = polygonCoords[0]; // exterior ring
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        const xi = coords[i][0], yi = coords[i][1];
        const xj = coords[j][0], yj = coords[j][1];
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

const south = 39.76923768059679;
const west = 37.04954266393176;
const north = 39.811965522767764;
const east = 37.11069439184814;

async function main() {
    try {
        console.log("1. Fetching neighborhood boundary...");
        const nRes = await pool.query("SELECT boundary_geojson FROM neighborhoods WHERE name = 'AHMET TURANGAZİ'");
        const boundary = JSON.parse(nRes.rows[0].boundary_geojson);
        
        console.log("2. Fetching OSM streets...");
        const osmGeoJSON = await fetchStreets(south, west, north, east);
        
        console.log("\n3. Searching for 'Ahmet Turan Caddesi' in OSM features...");
        const matches = osmGeoJSON.features.filter(f => 
            f.properties.name && f.properties.name.toLowerCase().includes("ahmet turan")
        );
        
        console.log(`Found ${matches.length} matches in OSM.`);
        
        matches.forEach((f, idx) => {
            console.log(`\nMatch ${idx}: ${f.properties.name} (Highway: ${f.properties.highway}, Sprayable: ${f.properties.sprayable})`);
            const coords = f.geometry.coordinates;
            console.log(`  Coords (${coords.length} points): ${JSON.stringify(coords)}`);
            
            // Check each point
            coords.forEach((pt, ptIdx) => {
                const inside = isPointInPolygon(pt, boundary.coordinates);
                console.log(`    Point ${ptIdx} [${pt[0]}, ${pt[1]}]: ${inside ? 'INSIDE ✅' : 'OUTSIDE ❌'}`);
            });
        });
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
