import sqlite3
from pyproj import Transformer

def debug():
    conn = sqlite3.connect("SOKAK.gpkg")
    cur = conn.cursor()
    
    # Let's see the unique mahalle_adi that contain "EGR" or similar
    cur.execute("SELECT DISTINCT mahalle_adi FROM sokaklar WHERE mahalle_adi LIKE '%E%R%K%P%'")
    rows = cur.fetchall()
    print("Matching mahalle names in SOKAK.gpkg:", rows)
    
    # Let's check the bounding box of Eğriköprü streets in SOKAK.gpkg
    cur.execute("SELECT min(minx), max(maxx), min(miny), max(maxy) FROM rtree_sokaklar_geom WHERE id IN (SELECT fid FROM sokaklar WHERE mahalle_adi LIKE '%E%R%K%P%')")
    bbox = cur.fetchone()
    print("Eğriköprü EPSG:5256 BBox in SOKAK.gpkg:", bbox)
    
    transformer_to_4326 = Transformer.from_crs("EPSG:5256", "EPSG:4326", always_xy=True)
    if bbox[0] is not None:
        min_lon, min_lat = transformer_to_4326.transform(bbox[0], bbox[2])
        max_lon, max_lat = transformer_to_4326.transform(bbox[1], bbox[3])
        print("Eğriköprü WGS84 BBox in SOKAK.gpkg:")
        print(f"  Lat: {min_lat} to {max_lat}")
        print(f"  Lon: {min_lon} to {max_lon}")
        
    conn.close()

if __name__ == '__main__':
    debug()
