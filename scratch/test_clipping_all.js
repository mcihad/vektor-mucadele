const path = require('path');
const fs = require('fs');
const workspaceDir = 'c:\\Users\\burakkazan\\Desktop\\KazanAİ_Vektör_İlaçlama\\SivasVektorMucadele-Dagitim';
const { Pool } = require(path.join(workspaceDir, 'node_modules', 'pg'));
require(path.join(workspaceDir, 'node_modules', 'dotenv')).config({ path: path.join(workspaceDir, '.env') });

// Client-side functions copied from planning.html
function isPointInPolygon(point, vs) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function isPointInPolygonCoords(point, polygonCoords) {
    const insideOuter = isPointInPolygon(point, polygonCoords[0]);
    if (!insideOuter) return false;
    for (let i = 1; i < polygonCoords.length; i++) {
        if (isPointInPolygon(point, polygonCoords[i])) {
            return false; // Point is inside a hole!
        }
    }
    return true;
}

function isPointInGeoJSONGeometry(point, geom) {
    if (!geom) return false;
    if (geom.type === 'Polygon') {
        return isPointInPolygonCoords(point, geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
        for (const polyCoords of geom.coordinates) {
            if (isPointInPolygonCoords(point, polyCoords)) {
                return true;
            }
        }
    }
    return false;
}

function clipLineStringToPolygon(coordinates, geom) {
    const segments = [];
    let currentSegment = [];
    
    for (let i = 0; i < coordinates.length; i++) {
        const pt = coordinates[i];
        const isInside = isPointInGeoJSONGeometry(pt, geom);
        
        if (isInside) {
            currentSegment.push(pt);
        } else {
            if (currentSegment.length > 0) {
                currentSegment.push(pt);
                if (currentSegment.length >= 2) {
                    segments.push(currentSegment);
                }
                currentSegment = [];
            }
            if (i < coordinates.length - 1) {
                const nextPt = coordinates[i + 1];
                if (isPointInGeoJSONGeometry(nextPt, geom)) {
                    currentSegment.push(pt);
                }
            }
        }
    }
    if (currentSegment.length >= 2) {
        segments.push(currentSegment);
    }
    return segments;
}

function fetchLocalStreets(south, west, north, east, neighborhood = '') {
    return new Promise((resolve, reject) => {
        const cp = require('child_process');
        const scriptPath = path.join(workspaceDir, 'server', 'services', 'query_streets.py');
        const child = cp.spawn('python', [scriptPath]);
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        
        child.on('close', (code) => {
            if (code !== 0) return reject(new Error(`Exit code ${code}: ${stderr}`));
            try {
                resolve(JSON.parse(stdout));
            } catch (err) {
                reject(err);
            }
        });
        
        child.stdin.write(JSON.stringify({ south, west, north, east, neighborhood }));
        child.stdin.end();
    });
}

async function testAll() {
    const pool = new Pool({
        host: process.env.PG_HOST || '10.0.0.200',
        database: process.env.PG_DATABASE || 'burak',
        user: process.env.PG_USER || 'burak',
        password: process.env.PG_PASSWORD || 'Bkazan90.',
        port: parseInt(process.env.PG_PORT || '5432')
    });

    try {
        console.log("Fetching all neighborhoods from PostgreSQL...");
        const dbRes = await pool.query("SELECT name, boundary_geojson FROM neighborhoods ORDER BY name");
        console.log(`Found ${dbRes.rows.length} neighborhoods.`);
        
        for (const row of dbRes.rows) {
            const name = row.name;
            if (!row.boundary_geojson) {
                console.log(`❌ ${name} has no boundary in database.`);
                continue;
            }
            
            const boundary = JSON.parse(row.boundary_geojson);
            
            // Calculate bbox from boundary
            let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
            function processCoords(coords) {
                if (Array.isArray(coords[0])) {
                    coords.forEach(processCoords);
                } else {
                    const [lng, lat] = coords;
                    if (lat < minLat) minLat = lat;
                    if (lat > maxLat) maxLat = lat;
                    if (lng < minLng) minLng = lng;
                    if (lng > maxLng) maxLng = lng;
                }
            }
            processCoords(boundary.coordinates);
            
            // Fetch streets
            let geojson;
            try {
                geojson = await fetchLocalStreets(minLat, minLng, maxLat, maxLng, name);
            } catch (err) {
                console.log(`❌ ${name}: Fetch streets failed: ${err.message}`);
                continue;
            }
            
            const fetchedCount = geojson.features ? geojson.features.length : 0;
            if (fetchedCount === 0) {
                console.log(`⚠️ ${name}: 0 streets fetched from database.`);
                continue;
            }
            
            // Apply clipping
            const clippedFeatures = [];
            for (const f of geojson.features) {
                if (f.geometry && f.geometry.type === 'LineString') {
                    const clippedSegments = clipLineStringToPolygon(f.geometry.coordinates, boundary);
                    for (let idx = 0; idx < clippedSegments.length; idx++) {
                        const segment = clippedSegments[idx];
                        const newFeature = JSON.parse(JSON.stringify(f));
                        newFeature.geometry.coordinates = segment;
                        clippedFeatures.push(newFeature);
                    }
                } else {
                    clippedFeatures.push(f);
                }
            }
            
            if (clippedFeatures.length === 0) {
                console.log(`🔴 RED ALERT! ${name}: ${fetchedCount} streets fetched, but 0 features after clipping! Boundary coordinates or street coordinates do not overlap!`);
            } else {
                console.log(`✅ ${name}: ${fetchedCount} fetched, ${clippedFeatures.length} clipped successfully.`);
            }
        }
        
    } catch (err) {
        console.error("Error in testAll:", err);
    } finally {
        await pool.end();
    }
}

testAll();
