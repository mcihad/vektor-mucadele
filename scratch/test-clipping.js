const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
    host: process.env.PG_HOST || '10.0.0.200',
    database: process.env.PG_DATABASE || 'burak',
    user: process.env.PG_USER || 'burak',
    password: process.env.PG_PASSWORD || 'Bkazan90.',
    port: parseInt(process.env.PG_PORT || '5432'),
});

// A simple ray-casting algorithm to check if a point is inside a polygon
function isPointInPolygon(point, polygon) {
    const x = point[0], y = point[1];
    let inside = false;
    // Handle coordinates arrays
    const coords = polygon.coordinates[0]; // Exterior ring
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        const xi = coords[i][0], yi = coords[i][1];
        const xj = coords[j][0], yj = coords[j][1];
        
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

async function main() {
    try {
        const nRes = await pool.query("SELECT boundary_geojson FROM neighborhoods WHERE name = 'AHMET TURANGAZİ'");
        if (nRes.rows.length === 0 || !nRes.rows[0].boundary_geojson) {
            console.log("No neighborhood boundary found.");
            return;
        }
        const boundary = JSON.parse(nRes.rows[0].boundary_geojson);
        
        const sRes = await pool.query(
            "SELECT fid, name, geometry_geojson FROM local_streets WHERE fid IN ('14031', '11831', '11830')"
        );
        
        sRes.rows.forEach(row => {
            const geom = JSON.parse(row.geometry_geojson);
            const coords = geom.coordinates;
            console.log(`\nStreet: ${row.name} (FID: ${row.fid})`);
            coords.forEach((pt, idx) => {
                const inside = isPointInPolygon(pt, boundary);
                console.log(`  Point ${idx} [${pt[0]}, ${pt[1]}]: ${inside ? 'INSIDE ✅' : 'OUTSIDE ❌'}`);
            });
        });
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
