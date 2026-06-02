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
      SELECT id, reporter_name, report_type, neighborhood, latitude, longitude, priority, status
      FROM citizen_reports
      ORDER BY id DESC
      LIMIT 15
    `);
    console.log("LAST 15 CITIZEN REPORTS:");
    console.log(JSON.stringify(res.rows, null, 2));

  } catch (err) {
    console.error("Database error:", err);
  } finally {
    await pool.end();
  }
}

main();
