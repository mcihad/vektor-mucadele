import sqlite3
import os

def check():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.dirname(script_dir)
    gpkg_path = os.path.join(workspace_dir, "SOKAK.gpkg")
    
    conn = sqlite3.connect(gpkg_path)
    cur = conn.cursor()
    
    # Get a few rows for Şeyh Şamil or similar
    cur.execute("SELECT mahalle_adi, typeof(mahalle_adi) FROM sokaklar WHERE mahalle_adi LIKE '%AM%' LIMIT 5")
    rows = cur.fetchall()
    
    print("Direct select from sqlite3:")
    for r in rows:
        val = r[0]
        t = r[1]
        print(f"Value: {val!r}, Type: {t}")
        if val:
            # Let's inspect the characters and their unicode code points
            code_points = [ord(c) for c in val]
            print(f"Code points: {code_points}")
            # Try to encode back to see what bytes they were
            try:
                print("Bytes as UTF-8:", val.encode('utf-8'))
            except Exception as e:
                print("UTF-8 encoding error:", e)
                
            try:
                # If they were read incorrectly, maybe they were decoded as latin-1 or cp1254?
                # Let's see if we can decode as CP1254
                # Note: val in python is a unicode string already. If it was decoded as UTF-8 from raw bytes:
                raw_bytes = val.encode('utf-8', errors='surrogateescape')
                print("Raw bytes (UTF-8 decoded):", raw_bytes)
            except Exception as e:
                print("Raw bytes error:", e)

    conn.close()

if __name__ == '__main__':
    check()
