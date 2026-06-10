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
        console.log("Personnel Ahmet rows:", pRes);
        if (!pRes || pRes.length === 0 || pRes[0].values.length === 0) {
            console.log("No personnel found for Ahmet");
            process.exit(0);
        }
        const personnelId = pRes[0].values[0][pRes[0].columns.indexOf('id')];
        console.log("Personnel ID for Ahmet:", personnelId);

        // Find all sessions for Ahmet
        const sRes = await db.exec(`
            SELECT s.id, s.status, s.neighborhood, s.planned_date, s.start_time, s.end_time, s.driver_id, s.operator_id
            FROM spray_sessions s
            WHERE s.driver_id = ? OR s.operator_id = ?
            ORDER BY s.created_at DESC
        `, [personnelId, personnelId]);
        
        console.log("All sessions for Ahmet:");
        if (sRes && sRes.length > 0 && sRes[0].values) {
            const cols = sRes[0].columns;
            const rows = sRes[0].values.map(val => {
                const obj = {};
                cols.forEach((col, idx) => obj[col] = val[idx]);
                return obj;
            });
            console.log(rows);
        } else {
            console.log("No sessions found.");
        }

        // Run the exact query from /field-active/:userId for Ahmet
        // Wait, what user_id does Ahmet have?
        const uRes = await db.exec("SELECT id FROM users WHERE username = 'ahmet'");
        const userId = uRes[0].values[0][0];
        console.log("User ID for ahmet:", userId);

        const activeRes = await db.exec(`
            SELECT s.id, s.status, s.neighborhood, s.planned_date, s.created_at
            FROM spray_sessions s
            WHERE (s.driver_id = ? OR s.operator_id = ?)
              AND (s.status IN ('active', 'beklemede') OR (s.status = 'planned' AND (s.planned_date IS NULL OR s.planned_date <= CURRENT_DATE)))
            ORDER BY CASE WHEN s.status = 'active' THEN 1 WHEN s.status = 'beklemede' THEN 2 ELSE 3 END, s.created_at DESC LIMIT 1
        `, [personnelId, personnelId]);

        console.log("Result of active session query:");
        if (activeRes && activeRes.length > 0 && activeRes[0].values) {
            const cols = activeRes[0].columns;
            const rows = activeRes[0].values.map(val => {
                const obj = {};
                cols.forEach((col, idx) => obj[col] = val[idx]);
                return obj;
            });
            console.log(rows);
        } else {
            console.log("No active/planned session found.");
        }

    } catch (err) {
        console.error("Error running query:", err);
    }
    process.exit(0);
}

run();
