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

async function main() {
    try {
        const res = await pool.query(
            "SELECT id, fid, name, mahalle, geometry_geojson FROM local_streets WHERE mahalle ILIKE '%AHMET%'"
        );
        console.log(`Total AHMET TURANGAZİ streets in local_streets: ${res.rows.length}`);
        
        // Print all streets that have coords close to the center of Ahmet Turangazi (around 37.06 to 37.07 longitude, 39.77 to 39.78 latitude)
        res.rows.forEach(row => {
            const geom = JSON.parse(row.geometry_geojson);
            const coords = geom.coordinates;
            // Check if any coordinate is around the blocks shown in the screenshot
            // The screenshot shows blocks with latitude ~39.773 to 39.778, longitude ~37.065 to 37.075
            let isClose = false;
            coords.forEach(pt => {
                if (pt[0] >= 37.06 && pt[0] <= 37.075 && pt[1] >= 39.77 && pt[1] <= 39.78) {
                    isClose = true;
                }
            });
            if (isClose) {
                console.log(`Street: ${row.name} (FID: ${row.fid}) | Coords Sample: ${JSON.stringify(coords.slice(0, 2))}`);
            }
        });
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
