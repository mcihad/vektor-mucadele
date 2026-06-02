import sqlite3
import struct

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
    
    cur.execute("SELECT fid, adi, geom FROM sokaklar WHERE fid = 4571")
    fid, adi, geom_blob = cur.fetchone()
    
    wkb = parse_gpkg_geom_blob(geom_blob)
    byte_order = wkb[0]
    is_little = byte_order == 1
    fmt_prefix = "<" if is_little else ">"
    geom_type = struct.unpack(f"{fmt_prefix}I", wkb[1:5])[0]
    
    print(f"FID: {fid}, Name: {adi}, Geom Type: {geom_type}")
    
    offset = 5
    if geom_type == 5:
        num_lines = struct.unpack(f"{fmt_prefix}I", wkb[offset:offset+4])[0]
        offset += 4
        print(f"Num Lines in MultiLineString: {num_lines}")
        for l_idx in range(num_lines):
            sub_order = wkb[offset]
            sub_is_little = sub_order == 1
            sub_fmt = "<" if sub_is_little else ">"
            offset += 1
            
            sub_type = struct.unpack(f"{sub_fmt}I", wkb[offset:offset+4])[0]
            offset += 4
            num_points = struct.unpack(f"{sub_fmt}I", wkb[offset:offset+4])[0]
            offset += 4
            print(f"Line {l_idx}: Sub Type {sub_type}, Num Points {num_points}")
            for p_idx in range(num_points):
                x, y = struct.unpack(f"{sub_fmt}dd", wkb[offset:offset+16])
                offset += 16
                print(f"  Point {p_idx}: x = {x}, y = {y}")
                
    conn.close()

if __name__ == '__main__':
    check()
