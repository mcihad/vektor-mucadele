const { Pool } = require('pg');
const path = require('path');
const { fetchStreets } = require('../server/services/overpass');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
    host: process.env.PG_HOST || '10.0.0.200',
    database: process.env.PG_DATABASE || 'burak',
    user: process.env.PG_USER || 'burak',
    password: process.env.PG_PASSWORD || 'Bkazan90.',
    port: parseInt(process.env.PG_PORT || '5432'),
});

const south = 39.76923768059679;
const west = 37.04954266393176;
const north = 39.811965522767764;
const east = 37.11069439184814;
const neighborhood = "AHMET TURANGAZİ";

async function main() {
    try {
        console.log("1. Fetching local streets from PostgreSQL...");
        const sql = `
            SELECT osm_id, fid, name, highway, width, length_m, mahalle, geometry_geojson
            FROM local_streets
            WHERE fid IN ('14031', '11831', '11830')
        `;
        const sRes = await pool.query(sql);
        console.log(`Fetched ${sRes.rows.length} targets.`);

        console.log("\n2. Fetching OSM streets from Overpass...");
        const osmGeoJSON = await fetchStreets(south, west, north, east);
        console.log(`Fetched ${osmGeoJSON.features.length} OSM streets.`);

        const getDistance = (lat1, lon1, lat2, lon2) => {
            const R = 6371000;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        };

        const getMidpoint = (geom) => {
            if (!geom || !geom.coordinates) return [0, 0];
            let sumLon = 0, sumLat = 0, count = 0;
            const processCoords = (arr) => {
                if (!Array.isArray(arr)) return;
                if (typeof arr[0] === 'number' && typeof arr[1] === 'number') {
                    sumLon += arr[0];
                    sumLat += arr[1];
                    count++;
                } else {
                    arr.forEach(processCoords);
                }
            };
            processCoords(geom.coordinates);
            return count > 0 ? [sumLat / count, sumLon / count] : [0, 0];
        };

        const osmMidpoints = osmGeoJSON.features
            .filter(f => f.geometry && f.geometry.coordinates)
            .map(f => getMidpoint(f.geometry));

        sRes.rows.forEach(row => {
            const geom = JSON.parse(row.geometry_geojson);
            const localMid = getMidpoint(geom);
            
            console.log(`\nLocal Street: ${row.name} (FID: ${row.fid}) | Midpoint: ${JSON.stringify(localMid)}`);
            
            let minDistance = Infinity;
            let closestOsm = null;
            let closestMid = null;

            osmGeoJSON.features.forEach((f, idx) => {
                const osmMid = osmMidpoints[idx];
                const dist = getDistance(localMid[0], localMid[1], osmMid[0], osmMid[1]);
                
                if (dist < minDistance) {
                    minDistance = dist;
                    closestOsm = f;
                    closestMid = osmMid;
                }
            });

            console.log(`  Closest OSM street: ${closestOsm.properties.name} (ID: ${closestOsm.id}, Highway: ${closestOsm.properties.highway}) at midpoint ${JSON.stringify(closestMid)}`);
            console.log(`  Distance: ${minDistance.toFixed(2)} meters`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
