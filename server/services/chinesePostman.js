/**
 * Chinese Postman Problem (CPP) Çözücü - Çoklu Bileşen Desteği
 * Her sokaktan en az 1 kez geçen en kısa rotayı hesaplar
 * 
 * Algoritma:
 * 1. GeoJSON'dan graph oluştur
 * 2. Bağlantısız bileşenleri (connected components) bul
 * 3. Her bileşen için ayrı ayrı CPP çöz:
 *    a. Tek dereceli (odd-degree) düğümleri bul
 *    b. Tek dereceli düğümler arası en kısa yolları hesapla (Dijkstra)
 *    c. Minimum ağırlıklı eşleme (greedy)
 *    d. Eşleme kenarlarını ekle → Euler graph
 *    e. Euler turu bul (Hierholzer)
 * 4. Bileşenleri en yakın komşu sıralamasıyla birleştir
 * 5. Bileşenler arası köprü (bridge) geçişleri ekle
 */

const { haversine } = require('./overpass');

// ─── SABITLER ───
const VEHICLE_SPEED_KMH = 20;        // Ortalama araç hızı (km/saat)
const ULV_TANK_LT = 100;             // ULV tank kapasitesi (litre)
const ULV_SPRAY_TIME_MIN = 22.5;     // ULV 100lt püskürtme süresi (dakika)
const ULV_RATE_LT_PER_MIN = ULV_TANK_LT / ULV_SPRAY_TIME_MIN;  // ~4.44 lt/dk
const MISBLOWER_TANK_LT = 200;       // Misblower tank kapasitesi
const MISBLOWER_SPRAY_TIME_MIN = 45; // Misblower 200lt püskürtme süresi
const MISBLOWER_RATE_LT_PER_MIN = MISBLOWER_TANK_LT / MISBLOWER_SPRAY_TIME_MIN;
const CHEMICAL_EFFECT_DAYS = 30;      // İlaç etki süresi (gün)

/**
 * GeoJSON FeatureCollection'dan segment bazlı graph oluşturur
 * Sokakları segmentlere bölerek ara kavşakların da bağlanmasını sağlar
 */
function buildGraph(geojson) {
    const nodes = new Map();  // key: "lon,lat" → { id, lon, lat, neighbors: [] }
    const edges = [];
    let nodeIdCounter = 0;

    function getNodeId(lon, lat) {
        const key = `${lon.toFixed(6)},${lat.toFixed(6)}`;
        if (!nodes.has(key)) {
            nodes.set(key, { id: nodeIdCounter++, lon, lat, neighbors: [] });
        }
        return nodes.get(key);
    }

    geojson.features.forEach((feature, idx) => {
        if (feature.geometry.type !== 'LineString') return;
        const coords = feature.geometry.coordinates;
        if (!coords || coords.length < 2) return;

        // Her bir iki ardışık koordinatı bağımsız bir kenar (segment) olarak ekle
        for (let i = 1; i < coords.length; i++) {
            const startNode = getNodeId(coords[i-1][0], coords[i-1][1]);
            const endNode = getNodeId(coords[i][0], coords[i][1]);

            const dist = haversine(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]);

            const edge = {
                id: edges.length,
                from: startNode.id,
                to: endNode.id,
                dist: dist,  // metre
                coords: [coords[i-1], coords[i]],
                name: feature.properties.name || '',
                osmId: feature.properties.osm_id || '',
                width: feature.properties.width || 8,
                oneway: !!feature.properties.oneway
            };

            edges.push(edge);
            startNode.neighbors.push({ nodeId: endNode.id, edgeId: edge.id, dist });
            endNode.neighbors.push({ nodeId: startNode.id, edgeId: edge.id, dist });
        }
    });

    return { nodes: Array.from(nodes.values()), edges, nodeMap: nodes };
}

/**
 * Tek dereceli (odd-degree) düğümleri bulur
 */
function findOddDegreeNodes(nodes, edges) {
    const degree = new Map();
    nodes.forEach(n => degree.set(n.id, 0));
    
    edges.forEach(e => {
        degree.set(e.from, (degree.get(e.from) || 0) + 1);
        degree.set(e.to, (degree.get(e.to) || 0) + 1);
    });

    return nodes.filter(n => (degree.get(n.id) || 0) % 2 !== 0);
}

/**
 * Dijkstra algoritması ile iki düğüm arası en kısa yol
 */
function dijkstra(nodes, edges, startId, transportType = 'vehicle') {
    const adjList = new Map();
    nodes.forEach(n => adjList.set(n.id, []));
    
    edges.forEach(e => {
        adjList.get(e.from).push({ to: e.to, dist: e.dist, edgeId: e.id });
        if (transportType !== 'vehicle' || !e.oneway) {
            adjList.get(e.to).push({ to: e.from, dist: e.dist, edgeId: e.id });
        }
    });

    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    
    nodes.forEach(n => dist.set(n.id, Infinity));
    dist.set(startId, 0);

    // Simple priority queue (for small graphs this is fine)
    while (true) {
        let minDist = Infinity;
        let current = -1;
        
        for (const [nodeId, d] of dist) {
            if (!visited.has(nodeId) && d < minDist) {
                minDist = d;
                current = nodeId;
            }
        }
        
        if (current === -1) break;
        visited.add(current);

        const neighbors = adjList.get(current) || [];
        for (const { to, dist: edgeDist } of neighbors) {
            if (visited.has(to)) continue;
            const newDist = minDist + edgeDist;
            if (newDist < dist.get(to)) {
                dist.set(to, newDist);
                prev.set(to, current);
            }
        }
    }

    return { dist, prev };
}

/**
 * Minimum ağırlıklı eşleme (Greedy yaklaşım)
 * Optimal değil ama pratik ve hızlı
 */
function greedyMinMatching(oddNodes, nodes, edges, transportType = 'vehicle') {
    if (oddNodes.length === 0) return [];
    
    // Tüm odd-node çiftleri arası mesafeleri hesapla
    const pairs = [];
    for (let i = 0; i < oddNodes.length; i++) {
        let { dist } = dijkstra(nodes, edges, oddNodes[i].id, transportType);
        for (let j = i + 1; j < oddNodes.length; j++) {
            let d = dist.get(oddNodes[j].id);
            if (d === undefined || d === Infinity) {
                // Yönlü yol bulunamazsa, iki-yönlü yedek yol bul (kurtarma mekanizması)
                const undir = dijkstra(nodes, edges, oddNodes[i].id, 'pedestrian');
                d = undir.dist.get(oddNodes[j].id) || Infinity;
            }
            pairs.push({
                i: i, j: j,
                nodeA: oddNodes[i].id,
                nodeB: oddNodes[j].id,
                dist: d
            });
        }
    }

    // Sort by distance
    pairs.sort((a, b) => a.dist - b.dist);

    const matched = new Set();
    const matchingEdges = [];

    for (const pair of pairs) {
        if (matched.has(pair.i) || matched.has(pair.j)) continue;
        matched.add(pair.i);
        matched.add(pair.j);
        matchingEdges.push(pair);
        if (matched.size >= oddNodes.length) break;
    }

    return matchingEdges;
}

/**
 * Euler turu bulur (Hierholzer algoritması)
 */
function findEulerTour(nodes, edges, transportType = 'vehicle') {
    const adj = new Map();
    nodes.forEach(n => adj.set(n.id, []));
    
    edges.forEach((e, idx) => {
        // e.from -> e.to is always allowed
        adj.get(e.from).push({ to: e.to, edgeIdx: idx, dir: 'forward', oneway: e.oneway });
        
        // e.to -> e.from is only allowed if it's not a one-way street OR we are in pedestrian mode
        if (transportType !== 'vehicle' || !e.oneway) {
            adj.get(e.to).push({ to: e.from, edgeIdx: idx, dir: 'backward', oneway: e.oneway });
        }
    });

    const tour = [];
    const stack = [nodes[0].id];
    const usedEdges = new Set();

    while (stack.length > 0) {
        const v = stack[stack.length - 1];
        const neighbors = adj.get(v) || [];
        let found = false;

        for (const neighbor of neighbors) {
            if (!usedEdges.has(neighbor.edgeIdx)) {
                usedEdges.add(neighbor.edgeIdx);
                stack.push(neighbor.to);
                found = true;
                break;
            }
        }

        if (!found) {
            tour.push(stack.pop());
        }
    }

    if (tour.length <= 1 && nodes.length > 0) {
        return [nodes[0].id];
    }

    return tour;
}

/**
 * Bağlantılı bileşenleri bulur (BFS)
 * Yol ağındaki birbirine bağlı olmayan ada gruplarını tespit eder
 */
function findConnectedComponents(nodes, edges) {
    const visited = new Set();
    const components = [];
    
    // Komşuluk listesi oluştur
    const adj = new Map();
    nodes.forEach(n => adj.set(n.id, []));
    edges.forEach(e => {
        adj.get(e.from).push(e.to);
        adj.get(e.to).push(e.from);
    });
    
    for (const node of nodes) {
        if (visited.has(node.id)) continue;
        
        const component = new Set();
        const queue = [node.id];
        visited.add(node.id);
        
        while (queue.length > 0) {
            const current = queue.shift();
            component.add(current);
            for (const neighbor of (adj.get(current) || [])) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }
        
        components.push(component);
    }
    
    return components;
}

/**
 * Euler turunu belirtilen düğümden başlayacak şekilde döndürür
 * Tur bir çevrim (cycle) olduğundan, herhangi bir noktadan başlatılabilir
 */
function rotateTour(tour, startNodeId) {
    if (tour.length <= 2) return tour;
    
    const idx = tour.indexOf(startNodeId);
    if (idx === -1 || idx === 0) return tour;
    
    // Tur bir çevrimse (ilk ve son düğüm aynıysa) döndür
    if (tour[0] === tour[tour.length - 1]) {
        const coreTour = tour.slice(0, -1);
        return [...coreTour.slice(idx), ...coreTour.slice(0, idx), coreTour[idx]];
    }
    
    // Çevrim değilse ve hedef sondaysa, ters çevir
    if (tour[tour.length - 1] === startNodeId) {
        return [...tour].reverse();
    }
    
    return tour;
}

/**
 * OSRM API üzerinden iki nokta arasındaki gerçek karayolu rotasını çeker
 */
async function fetchOSRMRoute(fromNode, toNode, transportType = 'vehicle') {
    const profile = transportType === 'pedestrian' ? 'foot' : 'driving';
    const url = `https://router.project-osrm.org/route/v1/${profile}/${fromNode.lon},${fromNode.lat};${toNode.lon},${toNode.lat}?overview=full&geometries=geojson`;
    
    try {
        console.log(`[OSRM] Querying bridge path (${profile}): ${fromNode.lon},${fromNode.lat} -> ${toNode.lon},${toNode.lat}`);
        const response = await fetch(url, {
            headers: { 'User-Agent': 'SivasVMS-App/1.0 (contact@sivasvms.local)' }
        });
        
        if (!response.ok) {
            console.error(`[OSRM] HTTP error: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        if (data && data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            if (route.geometry && route.geometry.coordinates) {
                console.log(`[OSRM] Successfully fetched path: ${route.distance} meters, ${route.geometry.coordinates.length} coords`);
                return {
                    coordinates: route.geometry.coordinates,
                    distance_m: route.distance
                };
            }
        }
    } catch (err) {
        console.error(`[OSRM] Error fetching route from OSRM:`, err.message);
    }
    return null;
}

/**
 * Ana fonksiyon: Chinese Postman Problem çöz (Çoklu Bileşen Destekli)
 * 
 * Yol ağı birbirine bağlı olmayan birden fazla "ada" içerebilir.
 * (Örneğin bir mahalledeki sokaklar arasında büyük bir cadde veya boşluk
 * nedeniyle fiziksel bağlantı kopabilir.)
 * 
 * Bu güncelleme ile:
 * 1. Tüm bağlantısız bileşenler ayrı ayrı tespit edilir
 * 2. Her bileşen için CPP bağımsız olarak çözülür
 * 3. Bileşenler en yakın komşu sıralamasıyla birleştirilir
 * 4. Bileşenler arası "köprü" geçişleri (ilaçlamasız sürüş) eklenir
 * 
 * @param {Object} geojson - GeoJSON FeatureCollection (sokaklar)
 * @param {string} machineType - 'ulv' veya 'misblower'
 * @param {number} tankCapacity - Tank kapasitesi (lt)
 * @returns {Object} Çözüm: rota, istatistikler
 */
async function solveChinesePostman(geojson, machineType = 'ulv', tankCapacity = 100, transportType = 'vehicle') {
    console.log(`[CPP] Çözüm başlatılıyor (Mod: ${transportType})...`);
    
    if (!geojson.features || geojson.features.length === 0) {
        return { error: 'Sokak verisi bulunamadı' };
    }

    // ─── Güvenlik Filtresi: Araç modunda yaya/bisiklet/patika yollarını tamamen yoksay ───
    let featuresToUse = geojson.features;
    if (transportType === 'vehicle') {
        const pedestrianTypes = ['pedestrian', 'footway', 'path', 'steps', 'cycleway'];
        featuresToUse = geojson.features.filter(f => {
            const h = f.properties && f.properties.highway;
            return !pedestrianTypes.includes(h);
        });
        console.log(`[CPP] Araç modu filtresi uygulandı. Toplam: ${geojson.features.length}, İlaçlanacak araç yolu: ${featuresToUse.length} (${geojson.features.length - featuresToUse.length} yaya yolu elendi)`);
        
        if (featuresToUse.length === 0) {
            return { error: 'Seçilen alanda araçla ilaçlamaya uygun yol bulunamadı! Lütfen yaya modunu seçin veya bölgeyi genişletin.' };
        }
    }

    // 1. Graph oluştur
    const { nodes, edges } = buildGraph({ type: 'FeatureCollection', features: featuresToUse });
    console.log(`[CPP] Graph: ${nodes.length} düğüm, ${edges.length} kenar`);

    if (nodes.length === 0 || edges.length === 0) {
        return { error: 'Geçerli yol verisi bulunamadı' };
    }

    // 2. Bağlantılı bileşenleri bul
    const componentNodeIdSets = findConnectedComponents(nodes, edges);
    console.log(`[CPP] ${componentNodeIdSets.length} bağlantılı bileşen bulundu`);

    // Düğüm lookup tablosu
    const nodeById = new Map();
    nodes.forEach(n => nodeById.set(n.id, n));

    // 3. Her bileşen için CPP çöz
    const componentResults = [];
    for (const nodeIdSet of componentNodeIdSets) {
        const compNodes = nodes.filter(n => nodeIdSet.has(n.id));
        const compEdges = edges.filter(e => nodeIdSet.has(e.from) && nodeIdSet.has(e.to));
        
        // Çok küçük bileşenleri atla (en az 2 düğüm ve 1 kenar olmalı)
        if (compNodes.length < 2 || compEdges.length === 0) continue;
        
        const hasOneway = compEdges.some(e => e.oneway);
        let augmentedEdges;
        let tour;
        let oddNodeCount = 0;

        if (transportType === 'vehicle' && hasOneway) {
            console.log(`[CPP] Bileşen bir yön kurallarıyla (Araç Modu) çözülüyor... ${compEdges.length} kenar`);
            
            // 1. Her düğüm için in-degree ve out-degree hesapla
            const inDegree = new Map();
            const outDegree = new Map();
            compNodes.forEach(n => {
                inDegree.set(n.id, 0);
                outDegree.set(n.id, 0);
            });

            compEdges.forEach(e => {
                outDegree.set(e.from, (outDegree.get(e.from) || 0) + 1);
                inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
            });

            // 2. Dengesiz düğümleri (imbalanced nodes) tespit et
            const sources = []; // out_degree > in_degree
            const sinks = [];   // in_degree > out_degree

            compNodes.forEach(n => {
                const diff = outDegree.get(n.id) - inDegree.get(n.id);
                if (diff > 0) {
                    for (let d = 0; d < diff; d++) sources.push(n.id);
                } else if (diff < 0) {
                    for (let d = 0; d < -diff; d++) sinks.push(n.id);
                }
            });

            oddNodeCount = sources.length + sinks.length;
            augmentedEdges = [...compEdges];

            // 3. Sinks ve Sources düğümlerini eşle
            if (sinks.length > 0 && sources.length > 0) {
                const matchedSinks = new Set();
                const matchedSources = new Set();
                const pairs = [];

                for (let i = 0; i < sinks.length; i++) {
                    const sinkId = sinks[i];
                    let { dist } = dijkstra(compNodes, compEdges, sinkId, 'vehicle');
                    
                    for (let j = 0; j < sources.length; j++) {
                        const sourceId = sources[j];
                        let d = dist.get(sourceId);
                        
                        let fallbackUsed = false;
                        if (d === undefined || d === Infinity) {
                            const undir = dijkstra(compNodes, compEdges, sinkId, 'pedestrian');
                            d = undir.dist.get(sourceId) || Infinity;
                            fallbackUsed = true;
                        }

                        pairs.push({
                            sinkIdx: i,
                            sourceIdx: j,
                            sinkId,
                            sourceId,
                            dist: d,
                            fallbackUsed
                        });
                    }
                }

                pairs.sort((a, b) => a.dist - b.dist);

                const matchingEdges = [];
                for (const pair of pairs) {
                    if (matchedSinks.has(pair.sinkIdx) || matchedSources.has(pair.sourceIdx)) continue;
                    matchedSinks.add(pair.sinkIdx);
                    matchedSources.add(pair.sourceIdx);
                    matchingEdges.push(pair);
                    if (matchedSinks.size >= sinks.length || matchedSources.size >= sources.length) break;
                }

                matchingEdges.forEach(m => {
                    const { prev } = dijkstra(compNodes, compEdges, m.sinkId, m.fallbackUsed ? 'pedestrian' : 'vehicle');
                    let current = m.sourceId;
                    
                    while (current !== m.sinkId && prev.has(current)) {
                        const prevNode = prev.get(current);
                        const existingEdge = compEdges.find(e => 
                            (e.from === current && e.to === prevNode) || 
                            (e.from === prevNode && e.to === current)
                        );
                        if (existingEdge) {
                            augmentedEdges.push({ ...existingEdge, id: augmentedEdges.length, duplicate: true });
                        }
                        current = prevNode;
                    }
                });
            }

            // 4. Yönlü Euler Turunu Bul (Hierholzer)
            tour = findEulerTour(compNodes, augmentedEdges, 'vehicle');
            
        } else {
            // Standart İki-Yönlü (Yaya veya Tek Yön Olmayan Bölgeler) CPP Çözümü
            const oddNodes = findOddDegreeNodes(compNodes, compEdges);
            augmentedEdges = [...compEdges];
            oddNodeCount = oddNodes.length;

            if (oddNodes.length > 0 && oddNodes.length <= 1000) {
                const matching = greedyMinMatching(oddNodes, compNodes, compEdges, 'pedestrian');
                matching.forEach(m => {
                    const { prev } = dijkstra(compNodes, compEdges, m.nodeA, 'pedestrian');
                    let current = m.nodeB;
                    while (current !== m.nodeA && prev.has(current)) {
                        const prevNode = prev.get(current);
                        const existingEdge = compEdges.find(e => 
                            (e.from === current && e.to === prevNode) || 
                            (e.from === prevNode && e.to === current)
                        );
                        if (existingEdge) {
                            augmentedEdges.push({ ...existingEdge, id: augmentedEdges.length, duplicate: true });
                        }
                        current = prevNode;
                    }
                });
            }

            // Standart Euler turu bul
            tour = findEulerTour(compNodes, augmentedEdges, 'pedestrian');
        }
        
        componentResults.push({
            nodes: compNodes,
            edges: compEdges,
            augmentedEdges,
            tour,
            oddNodeCount
        });
    }
    
    if (componentResults.length === 0) {
        return { error: 'Geçerli yol verisi bulunamadı' };
    }

    // 4. Bileşenleri büyükten küçüğe sırala (en büyük bileşenden başla)
    componentResults.sort((a, b) => b.edges.length - a.edges.length);

    // 5. En yakın komşu sıralamasıyla bileşenleri birleştir
    const orderedComponents = [componentResults[0]];
    const usedIndices = new Set([0]);
    
    for (let step = 1; step < componentResults.length; step++) {
        const lastComp = orderedComponents[orderedComponents.length - 1];
        const lastTour = lastComp.tour;
        const lastNodeId = lastTour[lastTour.length - 1];
        const lastNode = nodeById.get(lastNodeId);
        
        if (!lastNode) continue;
        
        let nearestIdx = -1;
        let nearestDist = Infinity;
        let nearestNodeId = null;
        
        // Kullanılmamış bileşenler arasından en yakınını bul
        for (let j = 0; j < componentResults.length; j++) {
            if (usedIndices.has(j)) continue;
            
            for (const node of componentResults[j].nodes) {
                const d = haversine(lastNode.lat, lastNode.lon, node.lat, node.lon);
                if (d < nearestDist) {
                    nearestDist = d;
                    nearestIdx = j;
                    nearestNodeId = node.id;
                }
            }
        }
        
        if (nearestIdx !== -1) {
            const comp = componentResults[nearestIdx];
            // Euler turunu en yakın düğümden başlayacak şekilde döndür
            comp.tour = rotateTour(comp.tour, nearestNodeId);
            comp.bridgeFrom = lastNode;
            comp.bridgeTo = nodeById.get(nearestNodeId);
            comp.bridgeDist = nearestDist;
            orderedComponents.push(comp);
            usedIndices.add(nearestIdx);
        }
    }

    // 6. Birleşik rota oluştur
    const routeFeatures = [];
    let totalSprayDistanceM = 0;
    let extraDistanceM = 0;
    let bridgeDistanceM = 0;
    let totalOddNodes = 0;
    let featureOrder = 0;

    // Tüm orijinal kenar mesafelerini topla (ilaçlanacak mesafe)
    edges.forEach(e => { totalSprayDistanceM += e.dist; });

    for (let ci = 0; ci < orderedComponents.length; ci++) {
        const comp = orderedComponents[ci];
        totalOddNodes += comp.oddNodeCount;

        // Ekstra mesafe (duplicate kenarlar - zorunlu tekrar geçişler)
        comp.augmentedEdges.forEach(e => {
            if (e.duplicate) extraDistanceM += e.dist;
        });

        // Köprü segmenti (bileşenler arası geçiş - ilaçlamasız sürüş)
        if (comp.bridgeFrom && comp.bridgeTo) {
            const osrmRes = await fetchOSRMRoute(comp.bridgeFrom, comp.bridgeTo, transportType);
            
            let bridgeCoords = [
                [comp.bridgeFrom.lon, comp.bridgeFrom.lat],
                [comp.bridgeTo.lon, comp.bridgeTo.lat]
            ];
            let bridgeDist = comp.bridgeDist;
            
            if (osrmRes && osrmRes.coordinates && osrmRes.coordinates.length >= 2) {
                bridgeCoords = osrmRes.coordinates;
                bridgeDist = osrmRes.distance_m;
            }
            
            bridgeDistanceM += bridgeDist;
            routeFeatures.push({
                type: 'Feature',
                properties: {
                    order: featureOrder++,
                    name: '↗️ Bölge Geçişi',
                    osm_id: '',
                    distance_m: Math.round(bridgeDist),
                    duplicate: false,
                    bridge: true
                },
                geometry: {
                    type: 'LineString',
                    coordinates: bridgeCoords
                }
            });
        }

        // Euler turu segmentleri
        const tour = comp.tour;
        for (let i = 0; i < tour.length - 1; i++) {
            const fromId = tour[i];
            const toId = tour[i + 1];
            
            // Bu kenarı bul
            const edge = comp.augmentedEdges.find(e => 
                (e.from === fromId && e.to === toId) || 
                (e.from === toId && e.to === fromId)
            );
            
            if (edge) {
                let coords = edge.coords;
                if (edge.from === toId) {
                    coords = [...coords].reverse();
                }
                
                routeFeatures.push({
                    type: 'Feature',
                    properties: {
                        order: featureOrder++,
                        name: edge.name,
                        osm_id: edge.osmId,
                        distance_m: Math.round(edge.dist),
                        duplicate: edge.duplicate || false,
                        bridge: false,
                        oneway: edge.oneway || false
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: coords
                    }
                });
            }
        }
    }

    // 7. İstatistikler
    const sprayDistanceM = totalSprayDistanceM + extraDistanceM;
    const totalRouteDistanceM = sprayDistanceM + bridgeDistanceM;
    const totalDistanceKm = totalRouteDistanceM / 1000;
    const sprayDistanceKm = sprayDistanceM / 1000;

    // Toplam süre (sürüş + ilaçlama + köprü geçişleri dahil)
    const timeMinutes = (totalDistanceKm / VEHICLE_SPEED_KMH) * 60;
    
    // İlaç tüketimi sadece ilaçlama mesafesi üzerinden (köprü geçişlerinde makine kapalı)
    const sprayTimeMinutes = (sprayDistanceKm / VEHICLE_SPEED_KMH) * 60;
    let rateLtPerMin;
    if (machineType === 'ulv') {
        rateLtPerMin = ULV_RATE_LT_PER_MIN;
    } else {
        rateLtPerMin = MISBLOWER_RATE_LT_PER_MIN;
    }
    const chemicalLt = sprayTimeMinutes * rateLtPerMin;
    
    const refills = Math.max(0, Math.ceil(chemicalLt / tankCapacity) - 1);

    // 8. Rota GeoJSON oluştur
    const routeGeoJSON = {
        type: 'FeatureCollection',
        features: routeFeatures
    };

    // Düz koordinat dizisi (mobil uygulama için)
    const flatCoords = [];
    routeFeatures.forEach(f => {
        f.geometry.coordinates.forEach(c => {
            flatCoords.push([c[1], c[0]]); // [lat, lng] formatı
        });
    });

    const result = {
        route_geojson: routeGeoJSON,
        route_coords: flatCoords,
        stats: {
            total_distance_km: Math.round(totalDistanceKm * 100) / 100,
            spray_distance_km: Math.round(sprayDistanceKm * 100) / 100,
            extra_distance_km: Math.round((extraDistanceM / 1000) * 100) / 100,
            bridge_distance_km: Math.round((bridgeDistanceM / 1000) * 100) / 100,
            estimated_time_min: Math.round(timeMinutes),
            estimated_chemical_lt: Math.round(chemicalLt * 10) / 10,
            tank_refills: refills,
            street_count: edges.length,
            node_count: nodes.length,
            odd_nodes: totalOddNodes,
            connected_components: orderedComponents.length,
            vehicle_speed_kmh: VEHICLE_SPEED_KMH,
            machine_type: machineType,
            tank_capacity_lt: tankCapacity
        }
    };

    console.log(`[CPP] Çözüm: ${totalDistanceKm.toFixed(2)} km toplam (${sprayDistanceKm.toFixed(2)} km ilaçlama + ${(bridgeDistanceM/1000).toFixed(2)} km geçiş), ${Math.round(timeMinutes)} dk, ${chemicalLt.toFixed(1)} lt, ${orderedComponents.length} bileşen`);
    return result;
}

/**
 * Süre bazlı ilaç tüketimi hesapla
 * @param {number} durationMinutes - İlaçlama süresi (dakika)
 * @param {string} machineType - 'ulv' veya 'misblower'
 * @returns {number} Tahmini ilaç tüketimi (litre)
 */
function calculateChemicalUsage(durationMinutes, machineType = 'ulv') {
    if (machineType === 'ulv') {
        return durationMinutes * ULV_RATE_LT_PER_MIN;
    } else {
        return durationMinutes * MISBLOWER_RATE_LT_PER_MIN;
    }
}

/**
 * Mesafe bazlı ilaç tüketimi hesapla
 * @param {number} distanceKm - Gidilen mesafe (km)
 * @param {string} machineType - 'ulv' veya 'misblower'
 * @returns {number} Tahmini ilaç tüketimi (litre)
 */
function calculateChemicalByDistance(distanceKm, machineType = 'ulv') {
    const timeMinutes = (distanceKm / VEHICLE_SPEED_KMH) * 60;
    return calculateChemicalUsage(timeMinutes, machineType);
}

module.exports = {
    solveChinesePostman,
    calculateChemicalUsage,
    calculateChemicalByDistance,
    VEHICLE_SPEED_KMH,
    ULV_RATE_LT_PER_MIN,
    MISBLOWER_RATE_LT_PER_MIN,
    CHEMICAL_EFFECT_DAYS
};
