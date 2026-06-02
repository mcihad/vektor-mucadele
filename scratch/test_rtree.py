import sqlite3
from pyproj import Transformer

transformer_to_5256 = Transformer.from_crs("EPSG:4326", "EPSG:5256", always_xy=True)
transformer_to_4326 = Transformer.from_crs("EPSG:5256", "EPSG:4326", always_xy=True)

def main():
    # Let's define a bounding box around Şeyh Şamil neighborhood
    # From the logs, the bbox is: 39.7504,37.0461,39.7884,37.0936
    # south = 39.7504, west = 37.0461, north = 39.7884, east = 37.0936
    
    south, west, north, east = 39.7504, 37.0461, 39.7884, 37.0936
    
    # Transform bbox corners to EPSG:5256
    # pyproj transformer always_xy=True takes (lon, lat) i.e. (west/east, south/north)
    minx, miny = transformer_to_5256.transform(west, south)
    maxx, maxy = transformer_to_5256.transform(east, north)
    
    print(f"WGS84 BBox: Lon [{west} to {east}], Lat [{south} to {north}]")
    print(f"EPSG:5256 BBox: X [{minx} to {maxx}], Y [{miny} to {maxy}]")
    
    conn = sqlite3.connect("SOKAK.gpkg")
    cur = conn.cursor()
    
    # Query using RTree index
    query = """
        SELECT id, minx, maxx, miny, maxy FROM rtree_sokaklar_geom
        WHERE minx <= ? AND maxx >= ? AND miny <= ? AND maxy >= ?
    """
    # SQLite RTree overlap query:
    # minx <= maxx_query AND maxx >= minx_query AND miny <= maxy_query AND maxy >= miny_query
    cur.execute(query, (maxx, minx, maxy, miny))
    rows = cur.fetchall()
    print(f"RTree returned {len(rows)} street IDs.")
    
    if len(rows) > 0:
        ids = [r[0] for r in rows[:10]]
        cur.execute(f"SELECT fid, adi, mahalle_adi FROM sokaklar WHERE fid IN ({','.join(map(str, ids))})")
        for fid, adi, mahalle in cur.fetchall():
            print(f"  FID {fid}: {adi} in neighborhood {mahalle}")
            
    conn.close()

if __name__ == '__main__':
    main()
