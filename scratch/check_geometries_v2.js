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
            SELECT id, street_name, length_mt, geometry_geojson
            FROM sprayed_streets
            ORDER BY id DESC
            LIMIT 50
        `);
        
        console.log(`Found ${result.rows.length} sprayed streets.`);
        result.rows.forEach(r => {
            let innerType = 'Unknown';
            let coords = [];
            try {
                const feature = JSON.parse(r.geometry_geojson);
                const geom = feature.geometry || feature;
                innerType = geom.type;
                coords = geom.coordinates || [];
            } catch(e) {}
            
            let coordText = '';
            if (innerType === 'Point') {
                coordText = `[${coords[1]}, ${coords[0]}]`;
            } else if (innerType === 'LineString') {
                coordText = `${coords.length} coordinates`;
            } else if (innerType === 'MultiLineString') {
                coordText = `${coords.length} lines, total ${coords.reduce((a, b) => a + b.length, 0)} coords`;
            } else {
                coordText = `${coords.length} elements`;
            }
            
            console.log(`ID: ${r.id} | Name: ${r.street_name} | DbLength: ${r.length_mt}m | InnerGeomType: ${innerType} | Details: ${coordText}`);
        });

    } catch (err) {
        console.error("Database query failed:", err.message);
    } finally {
        await pool.end();
    }
}

checkGeometries();
