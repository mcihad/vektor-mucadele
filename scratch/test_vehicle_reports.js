const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

async function verifyVehicleReportsData() {
    const pool = new Pool({
        host: process.env.PG_HOST || '10.0.0.200',
        port: parseInt(process.env.PG_PORT || '5432'),
        database: process.env.PG_DATABASE || 'burak',
        user: process.env.PG_USER || 'burak',
        password: process.env.PG_PASSWORD || 'Bkazan90.',
    });

    try {
        console.log("--- Vehicle Records ---");
        const vehiclesRes = await pool.query("SELECT id, plate, machine_name, usage_type FROM vehicles ORDER BY plate");
        console.table(vehiclesRes.rows);

        console.log("\n--- Spray Sessions by Vehicle (Last 35 Days) ---");
        const sessionsRes = await pool.query(`
            SELECT s.id, s.start_time, s.end_time, s.total_km, s.chemical_used_lt,
                   v.plate, v.machine_name
            FROM spray_sessions s
            JOIN vehicles v ON s.vehicle_id = v.id
            WHERE s.start_time >= (CURRENT_DATE - INTERVAL '35 days')
            ORDER BY s.start_time DESC
            LIMIT 10
        `);
        console.table(sessionsRes.rows);

        const totalKms = sessionsRes.rows.reduce((sum, r) => sum + Number(r.total_km || 0), 0);
        console.log(`\nVerified ${sessionsRes.rows.length} sessions with active vehicles, total km in sample: ${totalKms.toFixed(2)} km`);
        
    } catch (err) {
        console.error("Database query failed:", err.message);
    } finally {
        await pool.end();
    }
}

verifyVehicleReportsData();
