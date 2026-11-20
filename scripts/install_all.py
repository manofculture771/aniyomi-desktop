"""Install every candidate extension from data/ext-candidates.json, resuming.

Skips anything already installed (by package name) and remembers failures in
data/install-failed.json so a re-run does not retry dead APKs forever.
"""
import json, os, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
BASE = "http://127.0.0.1:8790"
cands = json.load(open(sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].endswith(".json")
                       else os.path.join(DATA, "ext-candidates.json"), encoding="utf-8"))
fail_path = os.path.join(DATA, "install-failed.json")
failed = {}
if os.path.exists(fail_path):
    failed = json.load(open(fail_path, encoding="utf-8"))


def req(path, data=None, timeout=240):
    body = json.dumps(data).encode() if data is not None else None
    headers = {"Content-Type": "application/json"} if body else {}
    r = urllib.request.Request(BASE + path, data=body, headers=headers)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read() or b"{}")


def installed_pkgs():
    try:
        return {e["pkg"] for e in req("/api/v1/extensions/installed")["extensions"]}
    except Exception:
        return set()


def main():
    repos = sorted({c["repoUrl"] for c in cands})
    try:
        req("/api/v1/extensions/repos", {"repos": repos})
        print(f"registered {len(repos)} repositories")
    except Exception as e:
        print("repo registration failed:", e)

    have = installed_pkgs()
    todo = [c for c in cands if c["pkg"] not in have and c["pkg"] not in failed]
    print(f"{len(cands)} candidates, {len(have)} already installed, {len(todo)} to install", flush=True)

    ok = bad = 0
    t0 = time.time()
    for i, c in enumerate(todo, 1):
        try:
            res = req("/api/v1/extensions/install", {"repoUrl": c["repoUrl"], "apk": c["apk"]}, timeout=300)
            if res.get("ok"):
                ok += 1
                print(f"{i:3}/{len(todo)} + {c['name'][:34]:<34} anime={res.get('anime')} ({c['repo'].split('/')[0]})", flush=True)
            else:
                bad += 1
                failed[c["pkg"]] = res.get("error") or "not ok"
                print(f"{i:3}/{len(todo)} ! {c['name'][:34]:<34} {res.get('error')}", flush=True)
        except urllib.error.HTTPError as e:
            bad += 1
            body = ""
            try:
                body = e.read().decode(errors="replace")[:160]
            except Exception:
                pass
            failed[c["pkg"]] = f"HTTP {e.code} {body}"
            print(f"{i:3}/{len(todo)} ! {c['name'][:34]:<34} HTTP {e.code}", flush=True)
        except Exception as e:
            bad += 1
            failed[c["pkg"]] = f"{type(e).__name__}: {str(e)[:100]}"
            print(f"{i:3}/{len(todo)} ! {c['name'][:34]:<34} {type(e).__name__}", flush=True)
        if i % 10 == 0:
            json.dump(failed, open(fail_path, "w", encoding="utf-8"), indent=1)
    json.dump(failed, open(fail_path, "w", encoding="utf-8"), indent=1)
    print(f"\ninstalled {ok}, failed {bad}, {int(time.time() - t0)}s total")


if __name__ == "__main__":
    main()
