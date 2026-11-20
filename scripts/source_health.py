"""Install Aniyomi extension APKs from repos and health-test every anime source.

Usage:  python scripts/source_health.py [--install] [--only NAME] [--limit N]
Writes data/source-tests.jsonl (one line per source) and prints a summary.
"""
import json, os, ssl, sys, time, urllib.parse, urllib.request, concurrent.futures

BASE = os.environ.get("MIWAYOMI", "http://127.0.0.1:8790")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
REPOS = [
    "https://raw.githubusercontent.com/salmanbappi/extensions-repo/repo/index.min.json",
    "https://raw.githubusercontent.com/aniyomi-addons/anime-extensions-repo/repo/index.min.json",
]
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def req(path, data=None, timeout=45):
    url = BASE + path
    body = None
    headers = {"Accept": "application/json"}
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=body, headers=headers)
    t0 = time.time()
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw or b"{}"), time.time() - t0


def health():
    for _ in range(90):
        try:
            return req("/api/v1/health", timeout=3)[0]
        except Exception:
            time.sleep(1)
    raise SystemExit("server not reachable on " + BASE)


def install_all():
    try:
        req("/api/v1/extensions/repos", {"repos": REPOS})
    except Exception as e:
        print("save repos failed:", e)
    total = 0
    for idx in REPOS:
        try:
            listing, _ = req("/api/v1/extensions/repo?url=" + urllib.parse.quote(idx, safe=""), timeout=90)
        except Exception as e:
            print("repo failed:", idx, e)
            continue
        entries = listing.get("extensions") or listing.get("entries") or []
        print(f"{idx.split('/')[3]}: {len(entries)} entries")
        for e in entries:
            if e.get("installed"):
                continue
            if e.get("nsfw") and "--nsfw" not in sys.argv:
                continue
            apk = e.get("apk") or ""
            if not apk.endswith(".apk"):
                continue
            try:
                res, dt = req("/api/v1/extensions/install", {"repoUrl": idx, "apk": apk}, timeout=180)
                total += 1
                print(f"  + {e.get('name')} [{apk}] anime={res.get('anime')} manga={res.get('manga')}"
                      f" ok={res.get('ok')} {dt:.1f}s {res.get('error') or ''}")
            except Exception as ex:
                print(f"  ! {e.get('name')} install failed: {ex}")
    print("installed:", total)


def test_source(src):
    sid, name, lang = src["id"], src["name"], src.get("lang", "")
    out = {"id": sid, "name": name, "lang": lang, "popular": None, "detail": None,
           "episodes": None, "videos": None, "error": None, "title": None, "url": None,
           "episode": None, "video": None, "ms": {}}
    try:
        page, dt = req(f"/api/v1/anime/{sid}/popular?page=1", timeout=60)
        out["ms"]["popular"] = round(dt, 1)
        animes = page.get("animes") or []
        out["popular"] = len(animes)
        if not animes:
            page, dt = req(f"/api/v1/anime/{sid}/latest?page=1", timeout=60)
            out["ms"]["latest"] = round(dt, 1)
            animes = page.get("animes") or []
            out["popular"] = len(animes)
        if not animes:
            out["error"] = "empty catalogue"
            return out
        first = animes[0]
        url = first.get("url")
        out["url"] = url
        out["title"] = first.get("title")
        det, dt = req(f"/api/v1/anime/{sid}/details?url=" + urllib.parse.quote(url, safe=""), timeout=60)
        out["ms"]["detail"] = round(dt, 1)
        out["detail"] = bool(det.get("title"))
        eps, dt = req(f"/api/v1/anime/{sid}/episodes?url=" + urllib.parse.quote(url, safe=""), timeout=90)
        out["ms"]["episodes"] = round(dt, 1)
        ep_list = eps.get("episodes") or []
        out["episodes"] = len(ep_list)
        if not ep_list:
            out["error"] = "no episodes"
            return out
        out["episode"] = ep_list[0].get("name")
        vids, dt = req(f"/api/v1/anime/{sid}/videos?url=" + urllib.parse.quote(ep_list[0]["url"], safe=""), timeout=120)
        out["ms"]["videos"] = round(dt, 1)
        vl = vids.get("videos") or []
        out["videos"] = len(vl)
        for v in vl:
            u = v.get("url") or ""
            if u.startswith("http"):
                out["video"] = (v.get("quality") or "") + " " + u[:180]
                break
        if not vl:
            out["error"] = "no videos"
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {str(e)[:160]}"
    return out


def main():
    do_install = "--install" in sys.argv
    only = None
    limit = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1].lower()
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    h = health()
    print("health:", h)
    if do_install:
        install_all()
        h = health()
        print("health after install:", h)

    srcs, _ = req("/api/v1/sources")
    anime = srcs.get("anime") or []
    if only:
        anime = [s for s in anime if only in s["name"].lower()]
    if limit:
        anime = anime[:limit]
    print(f"testing {len(anime)} anime sources")
    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, "source-tests.jsonl")
    results = []
    with open(path, "w", encoding="utf-8") as f, concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(test_source, s): s for s in anime}
        for fut in concurrent.futures.as_completed(futs):
            r = fut.result()
            results.append(r)
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            f.flush()
            ok = "OK " if r.get("videos") else "BAD"
            print(f"{ok} {r['name']:<28} pop={r['popular']} eps={r['episodes']} vid={r['videos']} "
                  f"{r['error'] or ''}", flush=True)
    good = [r for r in results if r.get("videos")]
    print(f"\n{len(good)}/{len(results)} sources returned a playable chain")
    for r in sorted(good, key=lambda x: -(x.get("videos") or 0))[:12]:
        print("  ", r["name"], "|", r["title"], "|", r["video"][:100] if r["video"] else "")


if __name__ == "__main__":
    main()
