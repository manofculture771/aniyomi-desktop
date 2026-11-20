"""Uninstall every extension that produced no playable source.

Reads data/source-tests.jsonl (latest row per source), groups by extension
package and uninstalls the ones that never returned catalogue -> episodes ->
videos. Anything that crashed the JVM is always removed.

Usage: python scripts/prune.py [--dry]
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
BASE = "http://127.0.0.1:8790"
dry = "--dry" in sys.argv

rows = {}
with open(os.path.join(DATA, "source-tests.jsonl"), encoding="utf-8") as f:
    for line in f:
        if line.strip():
            r = json.loads(line)
            rows[r["id"]] = r

by_pkg = {}
for r in rows.values():
    pkg = r.get("pkg") or ""
    if not pkg:
        continue
    st = by_pkg.setdefault(pkg, {"ok": 0, "total": 0, "crash": 0, "names": []})
    st["total"] += 1
    st["names"].append(r["name"])
    if r.get("verdict") == "ok":
        st["ok"] += 1
    if r.get("verdict") == "crash":
        st["crash"] += 1

good = {p for p, s in by_pkg.items() if s["ok"] > 0}
bad = {p: s for p, s in by_pkg.items() if s["ok"] == 0}

print(f"extensions tested: {len(by_pkg)} | keep: {len(good)} | remove: {len(bad)}")
for p, s in sorted(bad.items(), key=lambda kv: kv[1]["names"][0]):
    tag = "CRASH" if s["crash"] else "dead "
    print(f"  {tag} {s['names'][0][:30]:<30} {p}")
if dry:
    raise SystemExit(0)

removed = 0
for p in sorted(bad):
    req = urllib.request.Request(
        BASE + "/api/v1/extensions/uninstall",
        data=json.dumps({"pkg": p}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            out = json.loads(resp.read() or b"{}")
        removed += 1 if out.get("ok") else 0
    except Exception as e:
        print(f"  ! {p}: {e}")
print(f"uninstalled {removed}/{len(bad)} extensions, {len(good)} kept")
