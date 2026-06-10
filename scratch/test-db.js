const { initDatabase, getDb } = require('../server/config/database');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
    console.log("Initializing database...");
    const db = await initDatabase();
    
    const testSessionId = 85;
    try {
        console.log(`Temporarily changing session ${testSessionId} status to 'beklemede'...`);
        await db.run("UPDATE spray_sessions SET status = 'beklemede' WHERE id = ?", [testSessionId]);
        
        console.log("Querying sessions with status=active,beklemede...");
        const status = 'active,beklemede';
        const statuses = status.split(',');
        
        let sql = `SELECT s.*, v.plate, v.machine_name, v.machine_type
                   FROM spray_sessions s
                   LEFT JOIN vehicles v ON s.vehicle_id = v.id
                   WHERE 1=1`;
        
        sql += ` AND s.status IN (${statuses.map(() => '?').join(',')})`;
        const params = [...statuses];
        
        const result = await db.exec(sql, params);
        if (result.length > 0) {
            const rows = [];
            const cols = result[0].columns;
            result[0].values.forEach(row => {
                const obj = {};
                cols.forEach((c, i) => obj[c] = row[i]);
                rows.push(obj);
            });
            console.log("Found sessions:", rows.map(r => ({ id: r.id, status: r.status, plate: r.plate })));
            
            // Query route points for this session
            console.log(`Querying route points for session ${testSessionId}...`);
            const ptsResult = await db.exec("SELECT * FROM route_points WHERE session_id = ? ORDER BY timestamp", [testSessionId]);
            if (ptsResult.length > 0) {
                const ptsCols = ptsResult[0].columns;
                console.log("Route points count:", ptsResult[0].values.length);
                const firstPt = {};
                ptsCols.forEach((c, i) => firstPt[c] = ptsResult[0].values[0][i]);
                console.log("First point sample:", firstPt);
                
                // Count of spraying vs non-spraying points
                let sprayingCount = 0;
                let nonSprayingCount = 0;
                const isSprayingIdx = ptsCols.indexOf('is_spraying');
                ptsResult[0].values.forEach(row => {
                    if (row[isSprayingIdx] === 1) sprayingCount++;
                    else nonSprayingCount++;
                });
                console.log(`Spraying points: ${sprayingCount}, Non-spraying points: ${nonSprayingCount}`);
            } else {
                console.log("No route points found.");
            }
        } else {
            console.log("No sessions found with status=active,beklemede.");
        }
    } catch (e) {
        console.error("Error in test:", e);
    } finally {
        console.log(`Restoring session ${testSessionId} status to 'completed'...`);
        await db.run("UPDATE spray_sessions SET status = 'completed' WHERE id = ?", [testSessionId]);
    }
    process.exit(0);
}

run();
