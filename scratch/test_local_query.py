import subprocess
import json
import sys

payload = {
    "south": 39.750421647482675,
    "west": 37.04608008616128,
    "north": 39.788407688027085,
    "east": 37.09357861531679,
    "neighborhood": "ŞEYH ŞAMİL"
}

# Run query_streets.py via subprocess
p = subprocess.Popen(
    [sys.executable, "server/services/query_streets.py"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE
)

stdout, stderr = p.communicate(input=json.dumps(payload).encode('utf-8'))

print("EXIT CODE:", p.returncode)
print("STDERR:")
print(stderr.decode('utf-8', errors='ignore'))
print("STDOUT LENGTH:", len(stdout))
try:
    res = json.loads(stdout.decode('utf-8'))
    if "error" in res:
        print("ERROR IN RESPONSE:", res["error"])
    else:
        print("FEATURES COUNT:", len(res.get("features", [])))
        if len(res.get("features", [])) > 0:
            print("FIRST FEATURE PREVIEW:", json.dumps(res["features"][0], ensure_ascii=False)[:300])
except Exception as e:
    print("FAILED TO PARSE JSON:", e)
    print("STDOUT (first 500 chars):")
    print(stdout.decode('utf-8', errors='ignore')[:500])
