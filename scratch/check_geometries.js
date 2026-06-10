const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

async function checkGeometries() {
    const pool = new Pool({
        host: process.env.PG_HOST || '10.0.0.200',
        port: parseInt(process.env.PG_PORT || '5432'),
        database: process.env.PG_DATABASE || 'burak',
        user: process.env.PG_USER || 'burak',
        password: process.env.PG_PASSWORD || 'Bkazan90.',
    });

    try {
        console.log("Fetching streets from sprayed_streets...");
        const result = await pool.query(`
            SELECT id, street_name, length_mt, width_mt, geometry_geojson
            FROM sprayed_streets
            ORDER BY id DESC
            LIMIT 50
        `);
        
        console.log(`Found ${result.rows.length} sprayed streets. Listing details:`);
        result.rows.forEach(r => {
            let geomType = 'Unknown';
            let coordCount = 0;
            try {
                const geom = JSON.parse(r.geometry_geojson);
                geomType = geom.type;
                if (geom.coordinates) {
                    coordCount = geom.type === 'LineString' ? geom.coordinates.length : geom.coordinates[0].length;
                }
            } catch(e) {}
            console.log(`ID: ${r.id} | Name: ${r.street_name} | Length: ${r.length_mt}m | GeomType: ${geomType} | Coords: ${coordCount}`);
        });

    } catch (err) {
        console.error("Database query failed:", err.message);
    } finally {
        await pool.end();
    }
}

checkGeometries();
