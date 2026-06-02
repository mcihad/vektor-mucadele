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

async function testInside() {
    const pool = new Pool({
        host: process.env.PG_HOST || '10.0.0.200',
        database: process.env.PG_DATABASE || 'burak',
        user: process.env.PG_USER || 'burak',
        password: process.env.PG_PASSWORD || 'Bkazan90.',
        port: parseInt(process.env.PG_PORT || '5432')
    });

    try {
        const targetNeigh = 'EĞRİKÖPRÜ';
        console.log(`Checking neighborhood: ${targetNeigh}`);
        const dbRes = await pool.query("SELECT name, boundary_geojson FROM neighborhoods WHERE name = $1", [targetNeigh]);
        if (dbRes.rows.length === 0) {
            console.error("Neighborhood not found in DB!");
            return;
        }
        
        const boundary = JSON.parse(dbRes.rows[0].boundary_geojson);
        console.log("Boundary type:", boundary.type);
        
        // Let's query streets for EGRIKOPRU bbox
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        function processCoords(coords) {
            coords.forEach(pt => {
                if (pt[1] < minLat) minLat = pt[1];
                if (pt[1] > maxLat) maxLat = pt[1];
                if (pt[0] < minLng) minLng = pt[0];
                if (pt[0] > maxLng) maxLng = pt[0];
            });
        }
        if (boundary.type === 'Polygon') {
            boundary.coordinates.forEach(processCoords);
        } else if (boundary.type === 'MultiPolygon') {
            boundary.coordinates.forEach(poly => poly.forEach(processCoords));
        }
        
        console.log(`Bounding Box: S:${minLat}, W:${minLng}, N:${maxLat}, E:${maxLng}`);
        
        // Spawn query_streets.py to fetch streets
        const cp = require('child_process');
        const scriptPath = path.join(workspaceDir, 'server', 'services', 'query_streets.py');
        
        // Simple python cmd resolver
        const pythonCmd = 'python';
        console.log(`Calling query_streets.py...`);
        
        const child = cp.spawnSync(pythonCmd, [scriptPath], {
            input: JSON.stringify({
                south: minLat,
                west: minLng,
                north: maxLat,
                east: maxLng,
                neighborhood: targetNeigh
            }),
            encoding: 'utf-8'
        });
        
        if (child.status !== 0) {
            console.error("Python exited with error status:", child.status, child.stderr);
            return;
        }
        
        const geojson = JSON.parse(child.stdout);
        if (geojson.error) {
            console.error("Python error inside stdout:", geojson.error);
            return;
        }
        
        console.log(`Fetched ${geojson.features.length} streets.`);
        
        let insideCount = 0;
        let totalCoords = 0;
        let clippedCount = 0;
        
        geojson.features.forEach((f, idx) => {
            const coords = f.geometry.coordinates;
            totalCoords += coords.length;
            
            coords.forEach(pt => {
                if (isPointInGeoJSONGeometry(pt, boundary)) {
                    insideCount++;
                }
            });
            
            const clipped = clipLineStringToPolygon(coords, boundary);
            if (clipped.length > 0) {
                clippedCount += clipped.length;
            }
        });
        
        console.log(`Total street coords: ${totalCoords}`);
        console.log(`Coords inside boundary: ${insideCount}`);
        console.log(`Clipped segments generated: ${clippedCount}`);
        
    } catch (e) {
        console.error("Error in test:", e);
    } finally {
        await pool.end();
    }
}

testInside();
