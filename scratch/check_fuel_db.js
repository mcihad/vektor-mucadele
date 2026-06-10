const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

async function checkDb() {
    const pool = new Pool({
        host: process.env.PG_HOST || '10.0.0.200',
        port: parseInt(process.env.PG_PORT || '5432'),
        database: process.env.PG_DATABASE || 'burak',
        user: process.env.PG_USER || 'burak',
        password: process.env.PG_PASSWORD || 'Bkazan90.',
    });

    try {
        console.log("Checking if vehicle_fuel_logs table exists and listing its structure...");
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'vehicle_fuel_logs'
            ORDER BY ordinal_position;
        `);
        
        if (result.rows.length === 0) {
            console.log("❌ Table 'vehicle_fuel_logs' does NOT exist!");
        } else {
            console.log("✅ Table 'vehicle_fuel_logs' exists! Column structure:");
            console.table(result.rows);
            
            console.log("Checking row count in 'vehicle_fuel_logs':");
            const countRes = await pool.query("SELECT COUNT(*) FROM vehicle_fuel_logs");
            console.log(`Current Row Count: ${countRes.rows[0].count}`);
        }

    } catch (err) {
        console.error("Database query failed:", err.message);
    } finally {
        await pool.end();
    }
}

checkDb();
