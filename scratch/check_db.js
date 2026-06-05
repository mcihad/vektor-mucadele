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
        const todayStr = new Date().toLocaleDateString('en-CA');
        console.log(`Current Date Local: ${todayStr}`);
        
        console.log("Executing the new query...");
        const result = await pool.query(`
            SELECT pr.id, pr.name, pr.status, pr.assigned_user_id, pr.planned_date
            FROM planned_routes pr
            WHERE pr.assigned_user_id = $1
              AND (
                pr.status = 'active'
                OR (pr.status = 'assigned' AND pr.planned_date >= $2)
              )
            ORDER BY pr.planned_date DESC
            LIMIT 1
        `, [9, todayStr]);
        
        console.log("Assigned route for user 9:");
        console.table(result.rows);

    } catch (err) {
        console.error("Database query failed:", err.message);
    } finally {
        await pool.end();
    }
}

checkDb();
