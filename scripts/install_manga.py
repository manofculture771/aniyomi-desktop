"""Install Mihon/Tachiyomi manga extensions from a repository index.

Keiyoushi publishes a protobuf index (index.pb); the engine already parses it,
so this asks /api/v1/extensions/repo for the list and installs what matches the
wanted languages. Usage: python scripts/install_manga.py [langs...]
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
BASE = "http://127.0.0.1:8790"
REPO = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.pb"
LANGS = [a.lower() for a in sys.argv[1:]] or ["en", "fr", "ar", "all"]
fail_path = os.path.join(DATA, "install-manga-failed.json")
failed = json.load(open(fail_path, encoding="utf-8")) if os.path.exists(fail_path) else {}


def req(path, data=None, timeout=300):
    body = json.dumps(data).encode() if data is not None else None
    headers = {"Content-Type": "application/json"} if body else {}
    r = urllib.request.Request(BASE + path, data=body, headers=headers)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read() or b"{}")


def installed():
    try:
        return {e["pkg"] for e in req("/api/v1/extensions/installed")["extensions"]}
    except Exception:
        return set()


def main():
    try:
        req("/api/v1/extensions/repos", {"repos": [REPO]})
    except Exception as e:
        print("repo save failed:", e)
    listing = req("/api/v1/extensions/repo?url=" + urllib.parse.quote(REPO, safe=""), timeout=180)
    entries = listing.get("extensions") or []
    print(f"keiyoushi index: {len(entries)} entries")
    want = [e for e in entries
            if "tachiyomi.extension" in (e.get("pkg") or "")
            and (e.get("lang") or "").lower() in LANGS]
    print(f"{len(want)} manga extensions in languages {LANGS}")
    have = installed()
    todo = [e for e in want if e["pkg"] not in have and e["pkg"] not in failed]
    print(f"{len(todo)} to install", flush=True)

    ok = bad = 0
    for i, e in enumerate(todo, 1):
        res = None
        for attempt in range(3):
            try:
                res = req("/api/v1/extensions/install", {"repoUrl": REPO, "apk": e["apk"]}, timeout=300)
                break
            except urllib.error.HTTPError as ex:
                body = ""
                try:
                    body = ex.read().decode()[:120]
                except Exception:
                    pass
                if ex.code >= 500 and "download failed" not in body:
                    time.sleep(8)  # engine probably crashed and is restarting
                    continue
                res = {"ok": False, "error": f"HTTP {ex.code} {body}"}
                break
            except Exception as ex:
                time.sleep(8)  # watchdog restart window
                res = {"ok": False, "error": type(ex).__name__}
        if res is None:
            res = {"ok": False, "error": "no response"}
        if res.get("ok"):
            ok += 1
            print(f"{i:3}/{len(todo)} + {e['name'][:32]:<32} ({e.get('lang')})", flush=True)
        else:
            bad += 1
            failed[e["pkg"]] = res.get("error") or "not ok"
            print(f"{i:3}/{len(todo)} ! {e['name'][:32]:<32} {str(res.get('error'))[:40]}", flush=True)
        if i % 10 == 0:
            json.dump(failed, open(fail_path, "w", encoding="utf-8"), indent=1)
    json.dump(failed, open(fail_path, "w", encoding="utf-8"), indent=1)
    print(f"\ninstalled {ok}, failed {bad}")


if __name__ == "__main__":
    main()
