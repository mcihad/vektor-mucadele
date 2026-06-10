const { initDatabase } = require('../server/config/database');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
    try {
        const db = await initDatabase();
        console.log("Database initialized.");

        // Find personnel ID for 'Ahmet'
        const pRes = await db.exec("SELECT * FROM personnel WHERE name = ?", ['Ahmet']);
        const personnelId = pRes[0].values[0][pRes[0].columns.indexOf('id')];
        console.log("Personnel ID for Ahmet:", personnelId);

        const uRes = await db.exec("SELECT id FROM users WHERE username = 'ahmet'");
        const userId = uRes[0].values[0][0];
        console.log("User ID for ahmet:", userId);

        // Find all planned routes for Ahmet
        const prRes = await db.exec(`
            SELECT id, name, neighborhood, vehicle_id, assigned_user_id, status, total_distance_km, estimated_time_min, estimated_chemical_lt, planned_date
            FROM planned_routes
            WHERE assigned_user_id = ?
            ORDER BY created_at DESC
        `, [userId]);
        
        console.log("All planned routes for Ahmet:");
        if (prRes && prRes.length > 0 && prRes[0].values) {
            const cols = prRes[0].columns;
            const rows = prRes[0].values.map(val => {
                const obj = {};
                cols.forEach((col, idx) => obj[col] = val[idx]);
                return obj;
            });
            console.log(rows);
        } else {
            console.log("No planned routes found.");
        }

    } catch (err) {
        console.error("Error running query:", err);
    }
    process.exit(0);
}

run();
