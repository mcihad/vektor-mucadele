const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
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

async function main() {
    const south = 39.76923768059679;
    const west = 37.04954266393176;
    const north = 39.811965522767764;
    const east = 37.11069439184814;
    const neighborhood = "AHMET TURANGAZİ";

    try {
        const sql = `
            SELECT osm_id, fid, name, highway, width, length_m, mahalle, geometry_geojson
            FROM local_streets
            WHERE bbox_minx <= $1 AND bbox_maxx >= $2 AND bbox_miny <= $3 AND bbox_maxy >= $4
        `;
        const params = [east, west, north, south];
        const result = await pool.query(sql, params);
        
        const normalizedTarget = neighborhood ? normalizeTurkish(neighborhood) : '';
        const features = [];
        
        result.rows.forEach(row => {
            if (normalizedTarget) {
                const rowNeigh = normalizeTurkish(row.mahalle);
                if (rowNeigh !== normalizedTarget) return;
            }
            
            try {
                const geom = JSON.parse(row.geometry_geojson);
                features.push({
                    type: "Feature",
                    id: row.osm_id || `local_${row.fid}`,
                    properties: {
                        osm_id: row.osm_id || row.fid,
                        fid: row.fid,
                        name: row.name,
                        highway: row.highway,
                        width: row.width,
                        length_m: row.length_m,
                        surface: "asphalt",
                        oneway: false,
                        lanes: row.width > 12 ? 2 : 1,
                        maxspeed: "50",
                        sprayable: true,
                        mahalle: row.mahalle
                    },
                    geometry: geom
                });
            } catch (err) {
                console.error(err);
            }
        });
        
        const collection = {
            type: "FeatureCollection",
            features: features
        };
        
        fs.writeFileSync('scratch/local_streets.json', JSON.stringify(collection, null, 2));
        console.log(`Successfully wrote ${features.length} local streets to scratch/local_streets.json`);
        
        // Let's check if our target FIDs are in the exported features
        const targetFids = ['14031', '11831', '11830'];
        const exportedTargets = features.filter(f => targetFids.includes(String(f.properties.fid)));
        console.log("Targets in exported local streets GeoJSON:", exportedTargets.map(f => ({ fid: f.properties.fid, name: f.properties.name })));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
