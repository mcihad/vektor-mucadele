const { Pool } = require('pg');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pgHost = process.env.PG_HOST || '10.0.0.200';
const pgPort = parseInt(process.env.PG_PORT || '5432');
const pgDb = process.env.PG_DATABASE || 'burak';
const pgUser = process.env.PG_USER || 'burak';
const pgPass = process.env.PG_PASSWORD || 'Bkazan90.';

console.log(`Connecting to PostgreSQL at ${pgHost}:${pgPort}...`);
const pool = new Pool({
    host: pgHost,
    database: pgDb,
    user: pgUser,
    password: pgPass,
    port: pgPort,
});

async function main() {
    try {
        await pool.query('SELECT NOW()');
        console.log('Successfully connected to database.');

        // 1. Create table
        console.log('Creating table local_streets...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS local_streets (
                id SERIAL PRIMARY KEY,
                osm_id VARCHAR(100),
                fid VARCHAR(100),
                name VARCHAR(250),
                highway VARCHAR(100),
                width INTEGER,
                length_m INTEGER,
                mahalle VARCHAR(200),
                geometry_geojson TEXT,
                bbox_minx DOUBLE PRECISION,
                bbox_miny DOUBLE PRECISION,
                bbox_maxx DOUBLE PRECISION,
                bbox_maxy DOUBLE PRECISION
            )
        `);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_local_streets_bbox ON local_streets(bbox_minx, bbox_maxx, bbox_miny, bbox_maxy)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_local_streets_mahalle ON local_streets(mahalle)`);

        // 2. Truncate
        console.log('Truncating local_streets...');
        await pool.query('TRUNCATE local_streets RESTART IDENTITY');

        // 3. Run query_streets.py to fetch all features
        console.log('Spawning query_streets.py to fetch all features...');
        const scriptPath = path.join(__dirname, '..', 'server', 'services', 'query_streets.py');
        const child = cp.spawn('python', [scriptPath]);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        const geojson = await new Promise((resolve, reject) => {
            child.on('close', (code) => {
                if (code !== 0) return reject(new Error(`Python script exited with code ${code}. Stderr: ${stderr}`));
                try {
                    const cleanStdout = Buffer.from(stdout, 'latin1').toString('utf8');
                    const parsed = JSON.parse(cleanStdout);
                    if (parsed.error) return reject(new Error(parsed.error));
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`JSON Parse error: ${e.message}`));
                }
            });
            child.stdin.write(JSON.stringify({
                south: 38.0,
                west: 35.0,
                north: 41.0,
                east: 39.0
            }));
            child.stdin.end();
        });

        console.log(`Fetched ${geojson.features.length} features. Starting batch insert...`);

        // 4. Batch Insert
        const features = geojson.features;
        const batchSize = 200;
        
        for (let i = 0; i < features.length; i += batchSize) {
            const chunk = features.slice(i, i + batchSize);
            const values = [];
            const valueParams = [];
            let paramIndex = 1;

            chunk.forEach(f => {
                const props = f.properties;
                const geom = f.geometry;
                const coords = geom.coordinates;

                // Calculate bounding box in WGS84
                let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
                coords.forEach(pt => {
                    if (pt[0] < minx) minx = pt[0];
                    if (pt[0] > maxx) maxx = pt[0];
                    if (pt[1] < miny) miny = pt[1];
                    if (pt[1] > maxy) maxy = pt[1];
                });

                valueParams.push(
                    props.osm_id || null,
                    props.fid || null,
                    props.name || 'İsimsiz Yol',
                    props.highway || 'residential',
                    props.width || 8,
                    props.length_m || 0,
                    props.mahalle || '',
                    JSON.stringify(geom),
                    minx,
                    miny,
                    maxx,
                    maxy
                );

                values.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, $${paramIndex+4}, $${paramIndex+5}, $${paramIndex+6}, $${paramIndex+7}, $${paramIndex+8}, $${paramIndex+9}, $${paramIndex+10}, $${paramIndex+11})`);
                paramIndex += 12;
            });

            const query = `
                INSERT INTO local_streets 
                (osm_id, fid, name, highway, width, length_m, mahalle, geometry_geojson, bbox_minx, bbox_miny, bbox_maxx, bbox_maxy)
                VALUES ${values.join(',')}
            `;

            await pool.query(query, valueParams);
            console.log(`Inserted ${i + chunk.length} / ${features.length} streets...`);
        }

        console.log('Migration completed successfully!');
    } catch (e) {
        console.error('Error during migration:', e);
    } finally {
        await pool.end();
    }
}

main();
