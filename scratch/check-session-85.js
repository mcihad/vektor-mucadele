const { initDatabase } = require('../server/config/database');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
    try {
        const db = await initDatabase();
        console.log("Database initialized.");

        // Query session 85 details
        const sRes = await db.exec("SELECT * FROM spray_sessions WHERE id = ?", [85]);
        console.log("Session 85 columns and values:");
        if (sRes && sRes.length > 0 && sRes[0].values) {
            const cols = sRes[0].columns;
            const row = sRes[0].values[0];
            const obj = {};
            cols.forEach((col, idx) => obj[col] = row[idx]);
            console.log(obj);
        } else {
            console.log("Session 85 not found.");
        }

    } catch (err) {
        console.error(err);
    }
    process.exit(0);
}

run();
