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

function normalizeTurkish(s) {
    if (!s) return "";
    const mapping = {
        'I': 'i', 'İ': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ç': 'c', 'ç': 'c',
        'Ğ': 'g', 'ğ': 'g', 'Ö': 'o', 'ö': 'o', 'Ü': 'u', 'ü': 'u'
    };
    const res = [];
    for (let i = 0; i < s.length; i++) {
        const c = s[i].toUpperCase();
        if (mapping[c]) {
            res.push(mapping[c]);
        } else {
            res.push(c.toLowerCase());
        }
    }
    return res.join('').replace(/[^a-z0-9]/gi, '');
}

// Bounding box from the screenshot:
// south: 39.76923768059679, west: 37.04954266393176, north: 39.811965522767764, east: 37.11069439184814
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
            WHERE bbox_minx <= $1 AND bbox_maxx >= $2 AND bbox_miny <= $3 AND bbox_maxy >= $4
        `;
        const params = [east, west, north, south];
        const res = await pool.query(sql, params);
        
        console.log(`Fetched ${res.rows.length} local streets inside bbox.`);
        
        // Find AHMET TURAN Caddesi (FID: 14031, 11831, 11830) in rows
        const targetFids = ['14031', '11831', '11830'];
        const targets = res.rows.filter(row => targetFids.includes(row.fid));
        console.log("Targets found in local_streets:", targets.map(t => ({ fid: t.fid, name: t.name, mahalle: t.mahalle })));

        console.log("\n2. Fetching OSM streets from Overpass...");
        const osmGeoJSON = await fetchStreets(south, west, north, east);
        console.log(`Fetched ${osmGeoJSON.features.length} OSM streets inside bbox.`);

        // Let's check if the diagonal coordinates are present in OSM streets
        // Let's see if there is any OSM street close to target coordinates
        const targetCoord = [37.069268628069864, 39.7789719795878];
        const closeOsm = osmGeoJSON.features.filter(f => {
            const coords = f.geometry.coordinates;
            let isClose = false;
            coords.forEach(pt => {
                const dx = Math.abs(pt[0] - targetCoord[0]);
                const dy = Math.abs(pt[1] - targetCoord[1]);
                if (dx < 0.001 && dy < 0.001) isClose = true;
            });
            return isClose;
        });
        console.log("\nOSM streets close to AHMET TURAN Caddesi:", closeOsm.map(o => ({ id: o.id, name: o.properties.name, highway: o.properties.highway })));

        // Run the exact merging logic
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

        console.log("\n3. Testing merging for target FIDs...");
        targets.forEach(row => {
            const geom = JSON.parse(row.geometry_geojson);
            const localMid = getMidpoint(geom);
            
            let minDistance = Infinity;
            let closestOsm = null;
            let closestMid = null;

            osmGeoJSON.features.forEach((f, idx) => {
                const osmMid = osmMidpoints[idx];
                const latDiff = Math.abs(localMid[0] - osmMid[0]);
                const lonDiff = Math.abs(localMid[1] - osmMid[1]);
                
                if (latDiff > 0.0005 || lonDiff > 0.0005) {
                    return; // Skipped
                }

                const dist = getDistance(localMid[0], localMid[1], osmMid[0], osmMid[1]);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestOsm = f;
                    closestMid = osmMid;
                }
            });

            console.log(`FID: ${row.fid} | Name: ${row.name} | Midpoint: ${JSON.stringify(localMid)}`);
            console.log(`  Min distance to OSM: ${minDistance.toFixed(2)} meters`);
            if (closestOsm) {
                console.log(`  Closest OSM street: ${closestOsm.properties.name} (ID: ${closestOsm.id}, Highway: ${closestOsm.properties.highway}) at midpoint: ${JSON.stringify(closestMid)}`);
            }
        });

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
