require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  connectionTimeoutMillis: 5000
});

async function main() {
  try {
    const res = await pool.query(`
      SELECT id, name, neighborhood, vehicle_id, total_distance_km, transport_type, planned_date, status
      FROM planned_routes
      ORDER BY id DESC
      LIMIT 10
    `);
    console.log("LAST 10 PLANNED ROUTES:");
    console.log(JSON.stringify(res.rows, null, 2));

    const eskikaleRes = await pool.query(`
      SELECT id, name, neighborhood, vehicle_id, total_distance_km, transport_type, planned_date, status
      FROM planned_routes
      WHERE LOWER(neighborhood) LIKE '%eskikale%' OR LOWER(name) LIKE '%eskikale%'
      ORDER BY id DESC
    `);
    console.log("\nESKİKALE PLANNED ROUTES:");
    console.log(JSON.stringify(eskikaleRes.rows, null, 2));

  } catch (err) {
    console.error("Database error:", err);
  } finally {
    await pool.end();
  }
}

main();
