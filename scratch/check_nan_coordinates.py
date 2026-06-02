import sqlite3
import struct
from pyproj import Transformer
import math

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

def check():
    conn = sqlite3.connect("SOKAK.gpkg")
    cur = conn.cursor()
    
    cur.execute("SELECT fid, adi, geom FROM sokaklar WHERE mahalle_adi LIKE '%E%R%K%P%'")
    rows = cur.fetchall()
    
    for fid, adi, geom_blob in rows:
        wkb = parse_gpkg_geom_blob(geom_blob)
        if not wkb:
            continue
            
        byte_order = wkb[0]
        is_little = byte_order == 1
        fmt_prefix = "<" if is_little else ">"
        geom_type = struct.unpack(f"{fmt_prefix}I", wkb[1:5])[0]
        
        if geom_type == 2:
            num_points = struct.unpack(f"{fmt_prefix}I", wkb[5:9])[0]
            offset = 9
            for idx in range(num_points):
                x, y = struct.unpack(f"{fmt_prefix}dd", wkb[offset:offset+16])
                offset += 16
                lon, lat = transformer_to_4326.transform(x, y)
                if math.isnan(lon) or math.isnan(lat):
                    print(f"NaN coordinate found in LineString! Street FID: {fid}, Name: {adi}, Point: ({x}, {y})")
        elif geom_type == 5:
            print(f"MultiLineString found: FID {fid}")
            
    conn.close()

if __name__ == '__main__':
    check()
