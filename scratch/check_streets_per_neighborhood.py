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
    
    cur.execute("SELECT mahalle_adi, COUNT(*) FROM sokaklar GROUP BY mahalle_adi ORDER BY COUNT(*) DESC")
    rows = cur.fetchall()
    print("Streets count per mahalle_adi in GPKG:")
    for r in rows[:40]:
        print(f" - {r[0]}: {r[1]} streets")
        
    conn.close()

if __name__ == '__main__':
    check()
