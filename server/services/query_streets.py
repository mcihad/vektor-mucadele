import sys
import os
import sqlite3
import struct
import json
import math
from pyproj import Transformer

# Initialize transformers
# always_xy=True ensures output is in (longitude, latitude) format
transformer_to_5256 = Transformer.from_crs("EPSG:4326", "EPSG:5256", always_xy=True)
transformer_to_4326 = Transformer.from_crs("EPSG:5256", "EPSG:4326", always_xy=True)

def haversine(lat1, lon1, lat2, lon2):
    import math
    R = 6371000  # meters
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat/2)**2 + \
        math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * \
        math.sin(dLon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def parse_gpkg_geom_blob(blob):
    if not blob or len(blob) < 8:
        return None
    if blob[:2] != b'GP':
        return None
    flags = blob[3]
    env_indicator = (flags >> 1) & 0x07
    env_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    env_size = env_sizes.get(env_indicator, 0)
    header_size = 8 + env_size
    return blob[header_size:]

def parse_wkb_to_geojson(wkb):
    if not wkb or len(wkb) < 5:
        return None
    byte_order = wkb[0]
    is_little = byte_order == 1
    fmt_prefix = "<" if is_little else ">"
    
    geom_type = struct.unpack(f"{fmt_prefix}I", wkb[1:5])[0]
    offset = 5
    
    # 2 = LineString
    if geom_type == 2:
        num_points = struct.unpack(f"{fmt_prefix}I", wkb[offset:offset+4])[0]
        offset += 4
        coords = []
        for _ in range(num_points):
            x, y = struct.unpack(f"{fmt_prefix}dd", wkb[offset:offset+16])
            offset += 16
            if math.isnan(x) or math.isnan(y) or math.isinf(x) or math.isinf(y):
                continue
            lon, lat = transformer_to_4326.transform(x, y)
            if math.isnan(lon) or math.isnan(lat) or math.isinf(lon) or math.isinf(lat):
                continue
            coords.append([lon, lat])
        if len(coords) < 2:
            return None
        return {
            "type": "LineString",
            "coordinates": coords
        }
    
    # 5 = MultiLineString
    elif geom_type == 5:
        num_lines = struct.unpack(f"{fmt_prefix}I", wkb[offset:offset+4])[0]
        offset += 4
        lines = []
        for _ in range(num_lines):
            sub_order = wkb[offset]
            sub_is_little = sub_order == 1
            sub_fmt = "<" if sub_is_little else ">"
            offset += 1
            
            sub_type = struct.unpack(f"{sub_fmt}I", wkb[offset:offset+4])[0]
            offset += 4
            if sub_type != 2:
                continue
            
            num_points = struct.unpack(f"{sub_fmt}I", wkb[offset:offset+4])[0]
            offset += 4
            coords = []
            for _ in range(num_points):
                x, y = struct.unpack(f"{sub_fmt}dd", wkb[offset:offset+16])
                offset += 16
                if math.isnan(x) or math.isnan(y) or math.isinf(x) or math.isinf(y):
                    continue
                lon, lat = transformer_to_4326.transform(x, y)
                if math.isnan(lon) or math.isnan(lat) or math.isinf(lon) or math.isinf(lat):
                    continue
                coords.append([lon, lat])
            if len(coords) >= 2:
                lines.append(coords)
        if not lines:
            return None
        return {
            "type": "MultiLineString",
            "coordinates": lines
        }
    return None

def normalize_turkish(s):
    if not s:
        return ""
    mapping = {
        'I': 'i', 'İ': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ç': 'c', 'ç': 'c',
        'Ğ': 'g', 'ğ': 'g', 'Ö': 'o', 'ö': 'o', 'Ü': 'u', 'ü': 'u'
    }
    res = []
    for c in s.upper():
        if c in mapping:
            res.append(mapping[c])
        else:
            res.append(c.lower())
    return "".join(c for c in res if c.isalnum())

def format_street_name(adi, tip):
    if not adi:
        return "İsimsiz Yol"
    if not tip:
        return adi
    tip_lower = tip.lower()
    if 'cadde' in tip_lower:
        return f"{adi} Caddesi"
    elif 'sokak' in tip_lower:
        return f"{adi} Sokak"
    elif 'bulvar' in tip_lower:
        return f"{adi} Bulvarı"
    elif 'geçit' in tip_lower:
        return f"{adi} Geçidi"
    else:
        return f"{adi} {tip}"

def main():
    try:
        # Reconfigure standard I/O to use UTF-8 encoding
        try:
            sys.stdin.reconfigure(encoding='utf-8')
        except AttributeError:
            pass
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except AttributeError:
            pass
            
        # Read from stdin
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({"error": "Girdi verisi bulunamadı"}))
            return
            
        params = json.loads(input_data)
        south = float(params['south'])
        west = float(params['west'])
        north = float(params['north'])
        east = float(params['east'])
        neighborhood = params.get('neighborhood', '')
        
        # Transform bbox to EPSG:5256
        minx, miny = transformer_to_5256.transform(west, south)
        maxx, maxy = transformer_to_5256.transform(east, north)
        
        # Connect to SOKAK.gpkg
        script_dir = os.path.dirname(os.path.abspath(__file__))
        workspace_dir = os.path.dirname(os.path.dirname(script_dir))
        gpkg_path = os.path.join(workspace_dir, "SOKAK.gpkg")
        
        if not os.path.exists(gpkg_path):
            print(json.dumps({"error": f"SOKAK.gpkg dosyası bulunamadı: {gpkg_path}"}))
            return
            
        conn = sqlite3.connect(gpkg_path)
        cur = conn.cursor()
        
        # 1. Query RTree index to get overlapping features
        query_rtree = """
            SELECT id FROM rtree_sokaklar_geom
            WHERE minx <= ? AND maxx >= ? AND miny <= ? AND maxy >= ?
        """
        cur.execute(query_rtree, (maxx, minx, maxy, miny))
        street_ids = [row[0] for row in cur.fetchall()]
        
        if not street_ids:
            print(json.dumps({"type": "FeatureCollection", "features": []}))
            conn.close()
            return
            
        # 2. Query attributes and geometries from sokaklar table
        # We process in chunks to avoid SQLite parameter limit (999) if street_ids is huge
        features = []
        chunk_size = 500
        
        normalized_target_neigh = normalize_turkish(neighborhood) if neighborhood else ""
        
        for i in range(0, len(street_ids), chunk_size):
            chunk = street_ids[i:i + chunk_size]
            placeholders = ",".join("?" for _ in chunk)
            query_streets = f"""
                SELECT fid, geom, adi, tip, mahalle_adi, osm_id FROM sokaklar
                WHERE fid IN ({placeholders})
            """
            cur.execute(query_streets, chunk)
            rows = cur.fetchall()
            
            for fid, geom_blob, adi, tip, mahalle_adi, osm_id in rows:
                # If neighborhood is specified, check if it matches
                if normalized_target_neigh:
                    normalized_row_neigh = normalize_turkish(mahalle_adi)
                    if normalized_row_neigh != normalized_target_neigh:
                        continue
                        
                # Parse geometry
                wkb = parse_gpkg_geom_blob(geom_blob)
                if not wkb:
                    continue
                    
                geojson_geom = parse_wkb_to_geojson(wkb)
                if not geojson_geom:
                    continue
                    
                # Map highway type
                h_type = 'residential'
                tip_upper = (tip or '').upper()
                if 'BULVAR' in tip_upper:
                    h_type = 'primary'
                elif 'CADDE' in tip_upper:
                    h_type = 'secondary'
                elif 'SOK' in tip_upper:
                    h_type = 'residential'
                elif 'KARA YOL' in tip_upper:
                    h_type = 'trunk'
                elif 'KÖY' in tip_upper:
                    h_type = 'unclassified'
                elif any(x in tip_upper for x in ['YAYA', 'PARK', 'PASAJ', 'GEÇİT', 'GECIT']):
                    h_type = 'pedestrian'
                elif any(x in tip_upper for x in ['MERDİVEN', 'MERDIVEN']):
                    h_type = 'steps'
                elif any(x in tip_upper for x in ['PATİKA', 'PATIKA']):
                    h_type = 'path'
                
                # Format name
                formatted_name = format_street_name(adi, tip)
                
                # Determine width and sprayable
                width = 8
                if h_type == 'primary':
                    width = 16
                elif h_type == 'secondary':
                    width = 14
                elif h_type == 'residential':
                    width = 8
                elif h_type == 'unclassified':
                    width = 7
                elif h_type == 'trunk':
                    width = 20
                elif h_type in ['pedestrian', 'steps', 'path']:
                    width = 4
                
                # Build features, converting MultiLineStrings to individual LineString features
                # so that they are successfully processed by the client clipping logic
                # and the Chinese Postman route solver.
                geom_coords = geojson_geom['coordinates']
                if geojson_geom['type'] == 'LineString':
                    length_m = sum(haversine(geom_coords[idx-1][1], geom_coords[idx-1][0], geom_coords[idx][1], geom_coords[idx][0]) for idx in range(1, len(geom_coords)))
                    if math.isnan(length_m) or math.isinf(length_m):
                        length_m = 0
                    
                    features.append({
                        "type": "Feature",
                        "id": osm_id or f"local_{fid}",
                        "properties": {
                            "osm_id": osm_id or fid,
                            "name": formatted_name,
                            "highway": h_type,
                            "width": width,
                            "length_m": round(length_m),
                            "surface": "asphalt",
                            "oneway": False,
                            "lanes": 2 if width > 12 else 1,
                            "maxspeed": "50",
                            "sprayable": True
                        },
                        "geometry": geojson_geom
                    })
                elif geojson_geom['type'] == 'MultiLineString':
                    for sub_idx, line in enumerate(geom_coords):
                        length_m = sum(haversine(line[idx-1][1], line[idx-1][0], line[idx][1], line[idx][0]) for idx in range(1, len(line)))
                        if math.isnan(length_m) or math.isinf(length_m):
                            length_m = 0
                        
                        features.append({
                            "type": "Feature",
                            "id": f"{osm_id or fid}_s{sub_idx}",
                            "properties": {
                                "osm_id": osm_id or fid,
                                "name": formatted_name,
                                "highway": h_type,
                                "width": width,
                                "length_m": round(length_m),
                                "surface": "asphalt",
                                "oneway": False,
                                "lanes": 2 if width > 12 else 1,
                                "maxspeed": "50",
                                "sprayable": True
                            },
                            "geometry": {
                                "type": "LineString",
                                "coordinates": line
                            }
                        })
                
        conn.close()
        
        # Output as JSON to stdout
        sys.stdout.write(json.dumps({
            "type": "FeatureCollection",
            "features": features
        }, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({"error": f"Sokaklar sorgulanırken Python hatası oluştu: {str(e)}"}))

if __name__ == '__main__':
    main()
