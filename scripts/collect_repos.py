"""Collect every Aniyomi extension published in any known repository.

CloudStream providers are a different plugin format and cannot run here, so the
best real coverage comes from importing every Aniyomi-format extension that
exists: all repos are read, entries deduped by package name, and the result is
written to data/ext-candidates-all.json for scripts/install_all.py.
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "ext-candidates-all.json")

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142"}

# repos we already know about, plus a few extra seeds
SEEDS = [
    "https://raw.githubusercontent.com/warpdotsys/aniyomi-repo/repo/index.min.json",
    "https://raw.githubusercontent.com/OsmerGalarragaTKD/aniyomi-ext/repo/index.min.json",
    "https://raw.githubusercontent.com/salmanbappi/extensions-repo/repo/index.min.json",
    "https://raw.githubusercontent.com/idjoo/extensions/repo/index.min.json",
    "https://raw.githubusercontent.com/Kthedestroyer/aniyomi-extensions/repo/index.min.json",
    "https://raw.githubusercontent.com/Secozzi/aniyomi-extensions/repo/index.min.json",
    "https://raw.githubusercontent.com/amrkmn/x/repo/index.min.json",
    "https://raw.githubusercontent.com/aniyomi-addons/anime-extensions-repo/repo/index.min.json",
    "https://raw.githubusercontent.com/cuong-tran/aniyomi-extensions/repo/index.min.json",
    "https://raw.githubusercontent.com/Confused-Creature-180/aniyomi-extensions/repo/index.min.json",
]


def fetch(url, timeout=60):
    r = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(r, timeout=timeout) as f:
        return json.loads(f.read())


def main():
    repos = []
    seen = set()

    def add(url):
        if url not in seen:
            seen.add(url)
            repos.append(url)

    for u in SEEDS:
        add(u)
    path = os.path.join(DATA, "repos-discovered.json")
    if os.path.exists(path):
        for item in json.load(open(path, encoding="utf-8")):
            if isinstance(item, dict) and item.get("url"):
                add(item["url"])

    by_pkg = {}
    live = 0
    for url in repos:
        try:
            entries = fetch(url)
        except Exception as e:
            print(f"  dead: {url.split('/')[3]:<32} {type(e).__name__}")
            continue
        if isinstance(entries, dict):
            entries = entries.get("extensions") or []
        live += 1
        repo_slug = "/".join(url.split("/")[3:5])
        for e in entries:
            pkg = e.get("pkg") or ""
            apk = e.get("apk") or ""
            if not pkg or not apk:
                continue
            if "animeextension" not in pkg:
                continue
            if pkg in by_pkg:
                continue
            by_pkg[pkg] = {
                "name": e.get("name") or pkg,
                "pkg": pkg,
                "apk": apk,
                "version": e.get("version"),
                "lang": e.get("lang"),
                "nsfw": bool(e.get("nsfw")),
                "repo": repo_slug,
                "repoUrl": url,
            }
        print(f"  ok   {repo_slug:<32} {len(entries)} entries")

    cands = sorted(by_pkg.values(), key=lambda c: c["name"].lower())
    json.dump(cands, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n{live}/{len(repos)} repos alive, {len(cands)} unique anime extensions -> {OUT}")


if __name__ == "__main__":
    main()
