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
        const res = await pool.query("SELECT DISTINCT mahalle FROM local_streets ORDER BY mahalle");
        console.log("Distinct neighborhoods in DB:", res.rows);
        
        const countRes = await pool.query("SELECT COUNT(*) as count FROM local_streets WHERE mahalle ILIKE '%AHMET%'");
        console.log("Ahmet neighborhood count:", countRes.rows);
        
        const sampleRes = await pool.query("SELECT fid, name, mahalle, geometry_geojson FROM local_streets WHERE mahalle ILIKE '%AHMET%' LIMIT 10");
        console.log("Ahmet neighborhood sample:", sampleRes.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
