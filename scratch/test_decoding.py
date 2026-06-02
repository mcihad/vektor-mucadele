import sqlite3

def main():
    conn = sqlite3.connect("SOKAK.gpkg")
    conn.text_factory = bytes
    cur = conn.cursor()
    cur.execute("SELECT fid, adi, mahalle_adi FROM sokaklar LIMIT 10")
    for fid, adi, mahalle in cur.fetchall():
        print(f"FID {fid}:")
        if adi:
            print("  Raw ADI:", adi)
            try:
                print("  UTF-8:", adi.decode('utf-8'))
            except:
                print("  UTF-8: Failed")
            try:
                print("  CP1254:", adi.decode('cp1254'))
            except:
                print("  CP1254: Failed")
            try:
                print("  ISO-8859-9:", adi.decode('iso-8859-9'))
            except:
                print("  ISO-8859-9: Failed")
        if mahalle:
            print("  Raw MAH:", mahalle)
            try:
                print("  CP1254 MAH:", mahalle.decode('cp1254'))
            except:
                pass
    conn.close()

if __name__ == '__main__':
    main()
