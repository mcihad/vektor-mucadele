import sqlite3

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

def main():
    conn = sqlite3.connect("SOKAK.gpkg")
    cur = conn.cursor()
    cur.execute("SELECT mahalle_adi FROM sokaklar WHERE mahalle_adi LIKE '%ŞAMİL%' LIMIT 1")
    row = cur.fetchone()[0]
    
    input_neigh = "ŞEYH ŞAMİL"
    
    print("Input:", repr(input_neigh))
    print("Input Normalized:", repr(normalize_turkish(input_neigh)))
    print("DB row:", repr(row))
    print("DB row Normalized:", repr(normalize_turkish(row)))
    print("Equal?:", normalize_turkish(input_neigh) == normalize_turkish(row))
    
    # Check if the coordinates of this neighborhood are within the bbox we tested
    # bbox tested: 39.7504, 37.0461, 39.7884, 37.0936
    # Let's get the bounding box of Şeyh Şamil streets in SOKAK.gpkg
    cur.execute("SELECT min(minx), max(maxx), min(miny), max(maxy) FROM rtree_sokaklar_geom WHERE id IN (SELECT fid FROM sokaklar WHERE mahalle_adi LIKE '%ŞAMİL%')")
    bbox = cur.fetchone()
    print("Şeyh Şamil EPSG:5256 BBox in SOKAK.gpkg:", bbox)
    
    from pyproj import Transformer
    transformer_to_4326 = Transformer.from_crs("EPSG:5256", "EPSG:4326", always_xy=True)
    if bbox[0] is not None:
        min_lon, min_lat = transformer_to_4326.transform(bbox[0], bbox[2])
        max_lon, max_lat = transformer_to_4326.transform(bbox[1], bbox[3])
        print("Şeyh Şamil WGS84 BBox in SOKAK.gpkg:")
        print(f"  Lat: {min_lat} to {max_lat}")
        print(f"  Lon: {min_lon} to {max_lon}")
        
    conn.close()

if __name__ == '__main__':
    main()
