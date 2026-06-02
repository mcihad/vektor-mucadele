/**
 * OpenStreetMap Overpass API Servisi
 * Sokak verilerini OSM'den çeker ve GeoJSON formatına dönüştürür
 */

// Birden fazla Overpass sunucusu (biri çalışmazsa diğerini dener)
const OVERPASS_SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

// Basit in-memory cache
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 saat

/**
 * Node.js uyumlu fetch fonksiyonu
 * Node 18+ native fetch kullanır, eski sürümlerde http modülü kullanır
 */
async function safeFetch(url, options = {}) {
    // Node 18+ has global fetch
    if (typeof globalThis.fetch === 'function') {
        return globalThis.fetch(url, options);
    }
    
    // Fallback: Node.js http/https modülü ile istek
    return new Promise((resolve, reject) => {
        const https = require('https');
        const http = require('http');
        const { URL } = require('url');
        
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'POST',
            headers: options.headers || {},
            timeout: 45000
        };
        
        const req = protocol.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    json: () => Promise.resolve(JSON.parse(data)),
                    text: () => Promise.resolve(data)
                });
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('İstek zaman aşımına uğradı'));
        });
        
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

/**
 * Bounding box içindeki yolları Overpass API'den çeker
 * @param {number} south - Güney enlem
 * @param {number} west - Batı boylam  
 * @param {number} north - Kuzey enlem
 * @param {number} east - Doğu boylam
 * @returns {Object} GeoJSON FeatureCollection
 */
async function fetchStreets(south, west, north, east) {
    const cacheKey = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`;
    
    // Cache kontrolü
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log('[Overpass] Cache hit:', cacheKey);
            return cached.data;
        }
        cache.delete(cacheKey);
    }

    // Daha geniş yol tipleri - kırsal/banliyö alanlar için de yol bulsun
    const query = `
        [out:json][timeout:45];
        (
            way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|track|footway|cycleway|path)$"](${south},${west},${north},${east});
        );
        out geom;
    `;

    console.log('[Overpass] Fetching streets for bbox:', cacheKey);

    let lastError = null;
    
    // Birden fazla sunucuyu dene
    for (const serverUrl of OVERPASS_SERVERS) {
        try {
            console.log(`[Overpass] Trying server: ${serverUrl}`);
            
            const response = await safeFetch(serverUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded', 
                    'User-Agent': 'SivasVMS-App/1.0 (contact@sivasvms.local)',
                    'Accept': 'application/json, */*'
                },
                body: 'data=' + encodeURIComponent(query)
            });

            if (!response.ok) {
                console.log(`[Overpass] Server ${serverUrl} returned ${response.status}`);
                lastError = new Error(`Overpass API hatası: ${response.status} ${response.statusText}`);
                continue;
            }

            const osmData = await response.json();
            const geojson = osmToGeoJSON(osmData);

            // Cache'e kaydet
            cache.set(cacheKey, { data: geojson, timestamp: Date.now() });
            console.log(`[Overpass] ${geojson.features.length} yol segmenti alındı (${serverUrl})`);

            return geojson;
        } catch (err) {
            console.error(`[Overpass] Server ${serverUrl} hatası:`, err.message);
            lastError = err;
            continue;
        }
    }
    
    // Tüm sunucular başarısız oldu
    throw lastError || new Error('Hiçbir Overpass sunucusuna bağlanılamadı');
}

/**
 * OSM JSON verisini GeoJSON FeatureCollection'a dönüştürür
 */
function osmToGeoJSON(osmData) {
    const features = [];

    if (!osmData.elements) return { type: 'FeatureCollection', features };

    osmData.elements.forEach(element => {
        if (element.type === 'way' && element.geometry) {
            let coordinates = element.geometry.map(node => [node.lon, node.lat]);
            
            if (coordinates.length < 2) return;

            const tags = element.tags || {};
            
            // İlaçlamaya uygun yollar (araç ve yaya modları için genis küme, filtreleme istemcide dinamik yapilacak)
            const sprayableTypes = [
                'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 
                'unclassified', 'residential', 'service', 'living_street',
                'pedestrian', 'footway', 'path'
            ];
            const isSprayable = sprayableTypes.includes(tags.highway);
            
            // Yol genişliği tahmini
            let width = 8;
            if (tags.width) {
                width = parseFloat(tags.width) || 8;
            } else {
                switch (tags.highway) {
                    case 'motorway': case 'trunk': width = 20; break;
                    case 'primary': width = 16; break;
                    case 'secondary': width = 14; break;
                    case 'tertiary': width = 10; break;
                    case 'residential': case 'living_street': width = 8; break;
                    case 'service': width = 6; break;
                    case 'unclassified': width = 7; break;
                    case 'track': width = 4; break;
                    case 'pedestrian': case 'footway': case 'cycleway': case 'path': width = 3; break;
                    default: width = 8;
                }
            }

            // Robust oneway check
            let isOneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === 'true';
            if (tags.junction === 'roundabout' || tags.highway === 'motorway' || tags.highway === 'motorway_link') {
                if (tags.oneway !== 'no' && tags.oneway !== '0' && tags.oneway !== 'false') {
                    isOneway = true;
                }
            }
            if (tags.oneway === '-1') {
                // If it's a reverse one-way, reverse coordinates array and treat as a standard one-way forward!
                coordinates.reverse();
                isOneway = true;
            }

            // Yol uzunluğu hesapla (metre)
            let length = 0;
            for (let i = 1; i < coordinates.length; i++) {
                length += haversine(
                    coordinates[i-1][1], coordinates[i-1][0],
                    coordinates[i][1], coordinates[i][0]
                );
            }

            features.push({
                type: 'Feature',
                properties: {
                    osm_id: element.id,
                    name: tags.name || tags['name:tr'] || 'İsimsiz Yol',
                    highway: tags.highway || 'residential',
                    width: width,
                    length_m: Math.round(length),
                    surface: tags.surface || '',
                    oneway: isOneway,
                    lanes: parseInt(tags.lanes) || (width > 12 ? 2 : 1),
                    maxspeed: tags.maxspeed || '',
                    sprayable: isSprayable
                },
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates
                }
            });
        }
    });

    return { type: 'FeatureCollection', features };
}

/**
 * Haversine mesafe hesabı (metre)
 */
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + 
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Cache'i temizle
 */
function clearCache() {
    cache.clear();
    console.log('[Overpass] Cache temizlendi');
}

module.exports = { fetchStreets, clearCache, haversine };
