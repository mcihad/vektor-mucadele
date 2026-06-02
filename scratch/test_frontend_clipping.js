const { initDatabase } = require('../server/config/database');
const fetch = globalThis.fetch || require('node-fetch');

// Frontend logic
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
            // Point is outside
            if (currentSegment.length > 0) {
                // To keep the transitioning segment, include the first outside point
                currentSegment.push(pt);
                if (currentSegment.length >= 2) {
                    segments.push(currentSegment);
                }
                currentSegment = [];
            }
            // Check if next point is inside. If so, start a new segment starting with this outside point
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
    // simplified haversine
    function haversine(lat1,lon1,lat2,lon2){
        const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
        const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
        return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
    }
    let length = 0;
    for (let i = 1; i < coords.length; i++) {
        length += haversine(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]);
    }
    return length;
}

async function test() {
    try {
        console.log("Connecting to DB and getting ŞEYH ŞAMİL boundary...");
        const db = await initDatabase();
        const result = await db.exec("SELECT boundary_geojson FROM neighborhoods WHERE name = 'ŞEYH ŞAMİL'");
        if (!result || !result[0]) {
            console.error("ŞEYH ŞAMİL not found!");
            return;
        }
        
        const boundaryGeom = JSON.parse(result[0].values[0][0]);
        console.log("Boundary retrieved successfully!");
        
        console.log("Logging in to get a token...");
        const loginRes = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123', role: 'admin' })
        });
        
        const loginData = await loginRes.json();
        const token = loginData.token;
        
        // Bounding box from the boundary
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
        processCoords(boundaryGeom.coordinates);
        
        const bbox = {
            south: minLat,
            west: minLng,
            north: maxLat,
            east: maxLng,
            neighborhood: 'ŞEYH ŞAMİL'
        };
        
        console.log("Fetching streets from API...");
        const streetsRes = await fetch('http://localhost:3000/api/routes/fetch-streets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(bbox)
        });
        
        const geojson = await streetsRes.json();
        console.log("API returned streets count:", geojson.features ? geojson.features.length : 0);
        
        // Run clipping
        console.log("Clipping streets using frontend clipping logic...");
        const clippedFeatures = [];
        for (const f of geojson.features) {
            if (f.geometry && f.geometry.type === 'LineString') {
                const clippedSegments = clipLineStringToPolygon(f.geometry.coordinates, boundaryGeom);
                for (let idx = 0; idx < clippedSegments.length; idx++) {
                    const segment = clippedSegments[idx];
                    const newFeature = JSON.parse(JSON.stringify(f));
                    newFeature.geometry.coordinates = segment;
                    
                    // Recalculate length
                    const newLength = getCoordinatesLengthMeters(segment);
                    newFeature.properties.length_m = Math.round(newLength);
                    
                    clippedFeatures.push(newFeature);
                }
            } else {
                clippedFeatures.push(f);
            }
        }
        
        console.log("Clipped streets count:", clippedFeatures.length);
        if (clippedFeatures.length > 0) {
            console.log("Sample clipped feature properties:", clippedFeatures[0].properties);
            console.log("Sample clipped feature coords length:", clippedFeatures[0].geometry.coordinates.length);
        } else {
            console.log("WARNING: Zero features after clipping!");
        }
        
        process.exit(0);
    } catch (err) {
        console.error("Test error:", err);
        process.exit(1);
    }
}

test();
