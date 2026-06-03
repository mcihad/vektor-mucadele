import sqlite3
import json
import sys

def query():
    try:
        conn = sqlite3.connect('SOKAK.gpkg')
        cur = conn.cursor()
        cur.execute("SELECT fid, adi, tip, mahalle_adi FROM sokaklar WHERE mahalle_adi LIKE '%TURAN%' LIMIT 30")
        rows = cur.fetchall()
        for r in rows:
            print(r)
        conn.close()
    except Exception as e:
        print("Error:", e)

if __name__ == '__main__':
    query()
