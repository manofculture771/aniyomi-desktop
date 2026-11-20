"""Install manga extensions into Suwayomi (GraphQL).

The miwayomi engine cannot run Tachiyomi manga extensions (dex conversion breaks
typed arrays -> ArrayStoreException on every source), so manga lives on Suwayomi.
Usage: python scripts/install_manga_suwayomi.py en fr
"""
import json, sys, time, urllib.request

U = "http://127.0.0.1:4567/api/graphql"
LANGS = [a.lower() for a in sys.argv[1:]] or ["en"]


def gql(q, timeout=300):
    r = urllib.request.Request(U, data=json.dumps({"query": q}).encode(),
                              headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as f:
        return json.loads(f.read())


def main():
    r = gql('{ extensions { nodes { name pkgName lang isInstalled } } }', timeout=120)
    nodes = r["data"]["extensions"]["nodes"]
    want = [e for e in nodes if (e["lang"] or "").lower() in LANGS and not e["isInstalled"]]
    print(f"{len(nodes)} extensions known, {len(want)} to install for {LANGS}", flush=True)

    ok = bad = 0
    t0 = time.time()
    for i, e in enumerate(want, 1):
        q = 'mutation { updateExtension(input:{id:"%s", patch:{install:true}}) { extension { name isInstalled } } }' % e["pkgName"]
        for attempt in range(3):
            try:
                res = gql(q)
                if res.get("errors"):
                    bad += 1
                    print(f"{i:3}/{len(want)} ! {e['name'][:30]:<30} {res['errors'][0]['message'][:60]}", flush=True)
                else:
                    ok += 1
                    if i % 20 == 0 or i == len(want):
                        print(f"{i:3}/{len(want)} + {e['name'][:30]:<30} ok={ok} bad={bad} {int(time.time()-t0)}s", flush=True)
                break
            except Exception as ex:
                if attempt == 2:
                    bad += 1
                    print(f"{i:3}/{len(want)} ! {e['name'][:30]:<30} {type(ex).__name__}", flush=True)
                else:
                    time.sleep(8)
    print(f"\ninstalled {ok}, failed {bad}")


if __name__ == "__main__":
    main()
