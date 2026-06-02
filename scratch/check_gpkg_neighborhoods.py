import sqlite3
import os

def check():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.dirname(script_dir)
    gpkg_path = os.path.join(workspace_dir, "SOKAK.gpkg")
    
    if not os.path.exists(gpkg_path):
        print(f"SOKAK.gpkg not found at {gpkg_path}")
        return
        
    conn = sqlite3.connect(gpkg_path)
    cur = conn.cursor()
    
    cur.execute("SELECT DISTINCT mahalle_adi FROM sokaklar ORDER BY mahalle_adi")
    rows = cur.fetchall()
    print("Unique mahalle_adi values in sokaklar table:")
    for r in rows:
        print(f" - {r[0]}")
        
    conn.close()

if __name__ == '__main__':
    check()
