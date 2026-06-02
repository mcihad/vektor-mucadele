import sys
import os
import json
import math
import shapefile
from pyproj import Transformer

# Initialize transformers
# always_xy=True ensures output is in (longitude, latitude) format
transformer_to_5256 = Transformer.from_crs("EPSG:4326", "EPSG:5256", always_xy=True)
transformer_to_4326 = Transformer.from_crs("EPSG:5256", "EPSG:4326", always_xy=True)

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000  # meters
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat/2)**2 + \
        math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * \
        math.sin(dLon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

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

def clean_str(val):
    if val is None:
        return ""
    if isinstance(val, str):
        return val.strip()
    return str(val).strip()

def get_shape_lines(shape, transformer):
    if not shape.points:
        return []
    
    parts = list(shape.parts) if hasattr(shape, 'parts') and shape.parts is not None else [0]
    parts.append(len(shape.points))
    
    lines = []
    for idx in range(len(parts) - 1):
        start = parts[idx]
        end = parts[idx + 1]
        part_pts = shape.points[start:end]
        
        coords = []
        for x, y in part_pts:
            if math.isnan(x) or math.isnan(y) or math.isinf(x) or math.isinf(y):
                continue
            lon, lat = transformer.transform(x, y)
            if math.isnan(lon) or math.isnan(lat) or math.isinf(lon) or math.isinf(lat):
                continue
            coords.append([lon, lat])
            
        if len(coords) >= 2:
            lines.append(coords)
    return lines

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
        
        # Transform bbox to EPSG:5256 coordinates
        x1, y1 = transformer_to_5256.transform(west, south)
        x2, y2 = transformer_to_5256.transform(east, north)
        
        minx = min(x1, x2)
        maxx = max(x1, x2)
        miny = min(y1, y2)
        maxy = max(y1, y2)
        
        # Use Desktop shapefile layer
        shp_path = os.path.normpath("C:/Users/burakkazan/Desktop/sokaklar.shp")
        
        if not os.path.exists(shp_path):
            print(json.dumps({"error": f"Masaüstündeki sokaklar.shp dosyası bulunamadı: {shp_path}"}))
            return
            
        # Load shapefile using pyshp (actual encoding is ISO-8859-9 for Sivas GIS)
        sf = shapefile.Reader(shp_path, encoding='iso-8859-9')
        
        # Get field names starting from index 1 (ignoring DeletionFlag)
        fields = [f[0].lower() for f in sf.fields[1:]]
        
        # 1. Perform high-performance linear scan on shape bounding boxes
        matching_indices = []
        for i, shape in enumerate(sf.iterShapes()):
            if hasattr(shape, 'bbox') and shape.bbox:
                # shape.bbox is [xmin, ymin, xmax, ymax]
                # Check for overlap between shape bbox and projected query bbox
                if not (shape.bbox[0] > maxx or shape.bbox[2] < minx or 
                        shape.bbox[1] > maxy or shape.bbox[3] < miny):
                    matching_indices.append((i, shape))
        
        if not matching_indices:
            print(json.dumps({"type": "FeatureCollection", "features": []}))
            return
            
        normalized_target_neigh = normalize_turkish(neighborhood) if neighborhood else ""
        
        features = []
        
        # 2. Retrieve records and build GeoJSON features for overlapping shapes only
        for idx, shape in matching_indices:
            rec = sf.record(idx)
            rec_dict = dict(zip(fields, rec))
            
            # Map neighborhood name fields (supporting multiple potential column names)
            mahalle_adi = clean_str(rec_dict.get('mahalle_ad') or rec_dict.get('mahalle__1') or rec_dict.get('abs_mahall') or '')
            
            # If neighborhood is specified, check if it matches
            if normalized_target_neigh:
                normalized_row_neigh = normalize_turkish(mahalle_adi)
                if normalized_row_neigh != normalized_target_neigh:
                    continue
            
            # Map highway type
            h_type = 'residential'
            tip_val = clean_str(rec_dict.get('tip', ''))
            tip_upper = tip_val.upper()
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
            adi_val = clean_str(rec_dict.get('adi') or rec_dict.get('sokak_adi') or '')
            formatted_name = format_street_name(adi_val, tip_val)
            
            # Determine width
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
                
            # Parse shape geometry to WGS84 lines
            lines = get_shape_lines(shape, transformer_to_4326)
            if not lines:
                continue
                
            osm_id = clean_str(rec_dict.get('osm_id', ''))
            fid = rec_dict.get('id') or rec_dict.get('yol_id') or idx
            
            # Add line segments as features
            for sub_idx, line in enumerate(lines):
                # Calculate segment length in meters
                length_m = sum(
                    haversine(line[pt_idx-1][1], line[pt_idx-1][0], line[pt_idx][1], line[pt_idx][0])
                    for pt_idx in range(1, len(line))
                )
                if math.isnan(length_m) or math.isinf(length_m):
                    length_m = 0
                
                feat_id = osm_id if (osm_id and len(lines) == 1) else f"{osm_id or fid}_s{sub_idx}"
                
                features.append({
                    "type": "Feature",
                    "id": feat_id,
                    "properties": {
                        "osm_id": osm_id or fid,
                        "fid": fid,
                        "name": formatted_name,
                        "highway": h_type,
                        "width": width,
                        "length_m": round(length_m),
                        "surface": "asphalt",
                        "oneway": False,
                        "lanes": 2 if width > 12 else 1,
                        "maxspeed": "50",
                        "sprayable": True,
                        "mahalle": mahalle_adi
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": line
                    }
                })
                
        # Output as JSON to stdout
        sys.stdout.write(json.dumps({
            "type": "FeatureCollection",
            "features": features
        }, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({"error": f"Sokaklar sorgulanırken Python hatası oluştu: {str(e)}"}))

if __name__ == '__main__':
    main()
