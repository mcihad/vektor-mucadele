const { initDatabase } = require('../server/config/database');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
    try {
        const db = await initDatabase();
        console.log("Database initialized.");

        // Find all assigned/active routes
        const routesRes = await db.exec("SELECT * FROM planned_routes WHERE status IN ('assigned', 'active')");
        console.log("Currently assigned/active routes:");
        if (routesRes && routesRes.length > 0 && routesRes[0].values) {
            const cols = routesRes[0].columns;
            const rows = routesRes[0].values.map(val => {
                const obj = {};
                cols.forEach((col, idx) => obj[col] = val[idx]);
                return obj;
            });
            console.log(rows);

            // For each active/assigned route, check if there is a completed session for the same neighborhood and vehicle
            for (const route of rows) {
                const sessionRes = await db.exec(`
                    SELECT id, status, neighborhood, vehicle_id, end_time
                    FROM spray_sessions
                    WHERE neighborhood = ? AND vehicle_id = ? AND status = 'completed'
                `, [route.neighborhood, route.vehicle_id]);
                
                if (sessionRes && sessionRes.length > 0 && sessionRes[0].values && sessionRes[0].values.length > 0) {
                    console.log(`Route #${route.id} (${route.neighborhood}) has completed sessions. Updating route status to 'completed'...`);
                    await db.run("UPDATE planned_routes SET status = 'completed' WHERE id = ?", [route.id]);
                }
            }
        } else {
            console.log("No assigned/active routes found.");
        }

        console.log("Cleanup finished.");

    } catch (err) {
        console.error(err);
    }
    process.exit(0);
}

run();
