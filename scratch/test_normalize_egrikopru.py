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

import sqlite3
conn = sqlite3.connect("SOKAK.gpkg")
cur = conn.cursor()
cur.execute("SELECT DISTINCT mahalle_adi FROM sokaklar WHERE mahalle_adi LIKE '%E%R%K%P%'")
row = cur.fetchone()[0]

input_neigh = "EĞRİKÖPRÜ"
print("Input:", repr(input_neigh))
print("Input upper:", repr(input_neigh.upper()))
print("Input Normalized:", repr(normalize_turkish(input_neigh)))

print("DB row:", repr(row))
print("DB row upper:", repr(row.upper()))
print("DB row Normalized:", repr(normalize_turkish(row)))

print("Equal?:", normalize_turkish(input_neigh) == normalize_turkish(row))
conn.close()
