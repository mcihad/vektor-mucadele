const path = require('path');
const fs = require('fs');
const workspaceDir = 'c:\\Users\\burakkazan\\Desktop\\KazanAİ_Vektör_İlaçlama\\SivasVektorMucadele-Dagitim';
const { Pool } = require(path.join(workspaceDir, 'node_modules', 'pg'));
require(path.join(workspaceDir, 'node_modules', 'dotenv')).config({ path: path.join(workspaceDir, '.env') });

const { solveChinesePostman } = require(path.join(workspaceDir, 'server', 'services', 'chinesePostman'));

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

function getCoordinatesLengthMeters(coords) {
    // simple haversine for client-side matching
    let length = 0;
    for (let i = 1; i < coords.length; i++) {
        const lat1 = coords[i-1][1], lon1 = coords[i-1][0];
        const lat2 = coords[i][1], lon2 = coords[i][0];
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
        length += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    return length;
}

async function testAllNeighborhoods() {
    const pool = new Pool({
        host: process.env.PG_HOST || '10.0.0.200',
        database: process.env.PG_DATABASE || 'burak',
        user: process.env.PG_USER || 'burak',
        password: process.env.PG_PASSWORD || 'Bkazan90.',
        port: parseInt(process.env.PG_PORT || '5432')
    });

    try {
        const dbRes = await pool.query("SELECT name, boundary_geojson FROM neighborhoods ORDER BY name");
        console.log(`Testing all ${dbRes.rows.length} neighborhoods...`);
        
        const cp = require('child_process');
        const scriptPath = path.join(workspaceDir, 'server', 'services', 'query_streets.py');
        const pythonCmd = 'python';

        for (const row of dbRes.rows) {
            const name = row.name;
            if (!row.boundary_geojson) {
                console.log(`[-] ${name}: No boundary geometry in DB`);
                continue;
            }
            
            const boundary = JSON.parse(row.boundary_geojson);
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
            
            // Execute python script
            const child = cp.spawnSync(pythonCmd, [scriptPath], {
                input: JSON.stringify({
                    south: minLat,
                    west: minLng,
                    north: maxLat,
                    east: maxLng,
                    neighborhood: name
                }),
                encoding: 'utf-8'
            });
            
            if (child.status !== 0) {
                console.log(`[x] ${name}: Python script crashed! Stderr: ${child.stderr}`);
                continue;
            }
            
            let geojson;
            try {
                geojson = JSON.parse(child.stdout);
            } catch (err) {
                console.log(`[x] ${name}: Failed to parse Python stdout! Output snippet: ${child.stdout.slice(0, 100)}`);
                continue;
            }
            
            if (geojson.error) {
                console.log(`[x] ${name}: Python returned error: ${geojson.error}`);
                continue;
            }
            
            const features = geojson.features || [];
            if (features.length === 0) {
                console.log(`[?] ${name}: 0 streets fetched by Python (bbox: S:${minLat.toFixed(4)}, W:${minLng.toFixed(4)}, N:${maxLat.toFixed(4)}, E:${maxLng.toFixed(4)})`);
                continue;
            }
            
            // Clip features client-side style
            const clippedFeatures = [];
            for (const f of features) {
                if (f.geometry && f.geometry.type === 'LineString') {
                    const clippedSegments = clipLineStringToPolygon(f.geometry.coordinates, boundary);
                    for (let idx = 0; idx < clippedSegments.length; idx++) {
                        const segment = clippedSegments[idx];
                        const newFeature = JSON.parse(JSON.stringify(f));
                        newFeature.geometry.coordinates = segment;
                        
                        const newLength = getCoordinatesLengthMeters(segment);
                        newFeature.properties.length_m = Math.round(newLength);
                        newFeature.id = f.id + '_s' + idx;
                        clippedFeatures.push(newFeature);
                    }
                } else {
                    clippedFeatures.push(f);
                }
            }
            
            if (clippedFeatures.length === 0) {
                console.log(`[x] ${name}: 0 streets remain after client-side clipping!`);
                continue;
            }
            
            // Filter sprayable
            const sprayable = {
                type: 'FeatureCollection',
                features: clippedFeatures.filter(f => f.properties.sprayable !== false)
            };
            
            if (sprayable.features.length === 0) {
                console.log(`[x] ${name}: 0 sprayable streets after clipping!`);
                continue;
            }
            
            const result = solveChinesePostman(sprayable, 'ulv', 100);
            if (result.error) {
                console.log(`[ERROR] ${name}: solveChinesePostman returned error: ${result.error} (Clipped features count: ${sprayable.features.length})`);
            } else {
                console.log(`[OK] ${name}: CPP success. ${result.stats.node_count} nodes, ${result.stats.street_count} streets, ${result.stats.total_distance_km} km`);
            }
        }
    } catch (e) {
        console.error("Error in testAll:", e);
    } finally {
        await pool.end();
    }
}

testAllNeighborhoods();
