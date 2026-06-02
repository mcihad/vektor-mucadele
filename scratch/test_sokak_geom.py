import sqlite3
import struct
import json
from pyproj import Transformer

transformer = Transformer.from_crs("EPSG:5256", "EPSG:4326", always_xy=True)

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
            lon, lat = transformer.transform(x, y)
            coords.append([lon, lat])
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
            # Sub-linestring byte order
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
                lon, lat = transformer.transform(x, y)
                coords.append([lon, lat])
            lines.append(coords)
        return {
            "type": "MultiLineString",
            "coordinates": lines
        }
    else:
        print(f"Unknown geom type: {geom_type}")
        return None

def main():
    conn = sqlite3.connect("SOKAK.gpkg")
    cur = conn.cursor()
    cur.execute("SELECT fid, adi, geom FROM sokaklar LIMIT 5")
    for fid, adi, geom_blob in cur.fetchall():
        wkb = parse_gpkg_geom_blob(geom_blob)
        if not wkb:
            print(f"FID {fid}: No WKB")
            continue
        geom = parse_wkb_to_geojson(wkb)
        print(f"FID {fid} ({adi}): {json.dumps(geom)[:150]}...")
    conn.close()

if __name__ == '__main__':
    main()
