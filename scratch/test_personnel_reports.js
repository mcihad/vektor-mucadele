const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

async function verifyPersonnelReportsData() {
    const pool = new Pool({
        host: process.env.PG_HOST || '10.0.0.200',
        port: parseInt(process.env.PG_PORT || '5432'),
        database: process.env.PG_DATABASE || 'burak',
        user: process.env.PG_USER || 'burak',
        password: process.env.PG_PASSWORD || 'Bkazan90.',
    });

    try {
        console.log("--- Personnel Records ---");
        const personnelRes = await pool.query("SELECT id, name, role, status FROM personnel ORDER BY name");
        console.table(personnelRes.rows);

        console.log("\n--- Spray Sessions (Last 35 Days) ---");
        const sessionsRes = await pool.query(`
            SELECT s.id, s.start_time, s.end_time, s.total_km, s.chemical_used_lt,
                   p1.name as driver_name, p2.name as operator_name
            FROM spray_sessions s
            LEFT JOIN personnel p1 ON s.driver_id = p1.id
            LEFT JOIN personnel p2 ON s.operator_id = p2.id
            WHERE s.start_time >= (CURRENT_DATE - INTERVAL '35 days')
            ORDER BY s.start_time DESC
            LIMIT 10
        `);
        console.table(sessionsRes.rows);

        const totalKms = sessionsRes.rows.reduce((sum, r) => sum + Number(r.total_km || 0), 0);
        console.log(`\nVerified ${sessionsRes.rows.length} sessions, total km in sample: ${totalKms.toFixed(2)} km`);
        
    } catch (err) {
        console.error("Database query failed:", err.message);
    } finally {
        await pool.end();
    }
}

verifyPersonnelReportsData();
