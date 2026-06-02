import sys
import os
import json
import io

# We will import the main function from server/services/query_streets.py
# and call it with simulated stdin

def test():
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "server", "services")))
    import query_streets
    
    # Eğriköprü BBox from neighborhoods table
    params = {
        "south": 39.71071119282486,
        "west": 37.03990225301617,
        "north": 39.744100330866715,
        "east": 37.078768893302325,
        "neighborhood": "EĞRİKÖPRÜ"
    }
    
    # Mock sys.stdin
    sys.stdin = io.StringIO(json.dumps(params))
    
    # Capture sys.stdout
    old_stdout = sys.stdout
    sys.stdout = io.StringIO()
    
    query_streets.main()
    
    output = sys.stdout.getvalue()
    sys.stdout = old_stdout
    
    res = json.loads(output)
    if "error" in res:
        print("ERROR returned:", res["error"])
    else:
        print("Success! Features found:", len(res["features"]))
        if len(res["features"]) > 0:
            print("Sample feature properties:", res["features"][0]["properties"])
            
if __name__ == '__main__':
    test()
