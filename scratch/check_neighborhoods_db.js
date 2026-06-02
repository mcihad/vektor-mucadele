const { initDatabase, getDb } = require('../server/config/database');

async function check() {
    try {
        console.log("Connecting to PostgreSQL...");
        const db = await initDatabase();
        console.log("Querying neighborhoods...");
        const result = await db.exec("SELECT id, name, boundary_geojson IS NOT NULL as has_boundary FROM neighborhoods ORDER BY name");
        if (result && result[0]) {
            const rows = result[0].values.map(val => {
                return {
                    id: val[0],
                    name: val[1],
                    has_boundary: val[2]
                };
            });
            console.log("Neighborhoods in database:");
            console.table(rows);
        } else {
            console.log("No neighborhoods found or empty result.");
        }
        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

check();
