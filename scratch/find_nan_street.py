import sqlite3
import struct
import math
from pyproj import Transformer

transformer_to_4326 = Transformer.from_crs("EPSG:5256", "EPSG:4326", always_xy=True)

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
    
    if geom_type == 2:
        num_points = struct.unpack(f"{fmt_prefix}I", wkb[offset:offset+4])[0]
        offset += 4
        coords = []
        for _ in range(num_points):
            x, y = struct.unpack(f"{fmt_prefix}dd", wkb[offset:offset+16])
            offset += 16
            lon, lat = transformer_to_4326.transform(x, y)
            coords.append([lon, lat])
        return {"type": "LineString", "coordinates": coords}
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
                lon, lat = transformer_to_4326.transform(x, y)
                coords.append([lon, lat])
            lines.append(coords)
        return {"type": "MultiLineString", "coordinates": lines}
    return None

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000  # meters
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat/2)**2 + \
        math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * \
        math.sin(dLon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def check():
    conn = sqlite3.connect("SOKAK.gpkg")
    cur = conn.cursor()
    
    cur.execute("SELECT fid, adi, geom FROM sokaklar WHERE mahalle_adi LIKE '%E%R%K%P%'")
    rows = cur.fetchall()
    
    for fid, adi, geom_blob in rows:
        wkb = parse_gpkg_geom_blob(geom_blob)
        if not wkb:
            continue
            
        geojson_geom = parse_wkb_to_geojson(wkb)
        if not geojson_geom:
            continue
            
        geom_coords = geojson_geom['coordinates']
        length_m = 0
        try:
            if geojson_geom['type'] == 'LineString':
                length_m = sum(haversine(geom_coords[idx-1][1], geom_coords[idx-1][0], geom_coords[idx][1], geom_coords[idx][0]) for idx in range(1, len(geom_coords)))
            elif geojson_geom['type'] == 'MultiLineString':
                for line in geom_coords:
                    length_m += sum(haversine(line[idx-1][1], line[idx-1][0], line[idx][1], line[idx][0]) for idx in range(1, len(line)))
            
            if math.isnan(length_m):
                print(f"NaN length found! FID: {fid}, Name: {adi}")
                # Print coordinates to see what's wrong
                print("Coords:", geom_coords)
        except Exception as e:
            print(f"Error for FID {fid}: {e}")
            
    conn.close()

if __name__ == '__main__':
    check()
