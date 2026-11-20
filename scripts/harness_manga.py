"""Manga source harness: catalogue -> details -> chapters -> pages.

Same crash discipline as harness.py: the in-flight source is recorded before each
request, the engine is restarted when it dies, and the offender is marked.
Usage: python scripts/harness_manga.py [--limit N]
"""
import json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
JDK = os.path.join(ROOT, "tools", "jdk-21.0.13+9", "bin", "java.exe")
JAR = os.path.join(ROOT, "app", "miwayomi-all.jar")
PORT = 8790
BASE = f"http://127.0.0.1:{PORT}"
RESULTS = os.path.join(DATA, "manga-tests.jsonl")
INFLIGHT = os.path.join(DATA, "current-manga.json")
SERVERLOG = os.path.join(DATA, "server.log")

proc = None


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def http(path, timeout=45):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def server_alive():
    try:
        http("/api/v1/health", timeout=3)
        return True
    except Exception:
        return False


def start_server():
    global proc
    if server_alive():
        return
    log("starting engine...")
    out = open(SERVERLOG, "ab")
    env = os.environ.copy()
    env["JAVA_HOME"] = os.path.dirname(os.path.dirname(JDK))
    proc = subprocess.Popen(
        [JDK, "-Xverify:none", "-jar", JAR, "--port", str(PORT), "--data", DATA, "--no-open", "-f", ""],
        stdout=out, stderr=subprocess.STDOUT, env=env, cwd=ROOT,
        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )
    for _ in range(300):
        if server_alive():
            log(f"engine up ({http('/api/v1/health')['mangaSources']} manga sources)")
            return
        if proc.poll() is not None:
            break
        time.sleep(2)
    raise SystemExit("engine did not come up")


def stop_server():
    global proc
    if proc and proc.poll() is None:
        proc.kill()
        try:
            proc.wait(10)
        except Exception:
            pass
    proc = None
    time.sleep(2)


def main():
    start_server()
    existing = {}
    if os.path.exists(RESULTS):
        with open(RESULTS, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    r = json.loads(line)
                    existing[r["id"]] = r
    skip = {sid for sid, r in existing.items() if r.get("verdict") != "crash"}
    sources = http("/api/v1/sources")["manga"]
    todo = [s for s in sources if s["id"] not in skip]
    if "--limit" in sys.argv:
        todo = todo[: int(sys.argv[sys.argv.index("--limit") + 1])]
    log(f"{len(sources)} manga sources, {len(todo)} to test")

    q = lambda s: urllib.parse.quote(s, safe="")
    with open(RESULTS, "a", encoding="utf-8") as out:
        for i, src in enumerate(todo, 1):
            res = {"id": src["id"], "name": src["name"], "pkg": src.get("pkg"), "verdict": None}
            with open(INFLIGHT, "w", encoding="utf-8") as f:
                json.dump(src, f)
            t0 = time.time()
            try:
                page = http(f"/api/v1/manga/{src['id']}/popular?page=1", timeout=60)
                mangas = page.get("mangas") or []
                if not mangas:
                    page = http(f"/api/v1/manga/{src['id']}/latest?page=1", timeout=60)
                    mangas = page.get("mangas") or []
                res["catalogue"] = len(mangas)
                if not mangas:
                    res["verdict"] = "empty-catalogue"
                else:
                    m = mangas[0]
                    res["title"] = m.get("title")
                    title_q = f"&title={q(m.get('title') or '')}"
                    det = http(f"/api/v1/manga/{src['id']}/details?url={q(m['url'])}{title_q}", timeout=60)
                    res["detail"] = bool(det.get("title"))
                    chs = http(f"/api/v1/manga/{src['id']}/chapters?url={q(m['url'])}{title_q}", timeout=90)
                    chapters = chs.get("chapters") or []
                    res["chapters"] = len(chapters)
                    if not chapters:
                        res["verdict"] = "no-chapters"
                    else:
                        res["chapter"] = chapters[0].get("name")
                        pgs = http(f"/api/v1/manga/{src['id']}/pages?url={q(chapters[0]['url'])}{title_q}", timeout=120)
                        pages = pgs.get("pages") or []
                        res["pages"] = len(pages)
                        if pages:
                            res["verdict"] = "ok"
                            res["sample"] = (pages[0].get("imageUrl") or "")[:120]
                        else:
                            res["verdict"] = "no-pages"
            except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
                dead = proc is None or proc.poll() is not None or not server_alive()
                if dead:
                    res["verdict"] = "crash"
                    res["error"] = "engine died while testing this source"
                    log(f"CRASH on {src['name']} — restarting engine")
                    stop_server()
                    start_server()
                else:
                    res["verdict"] = "error"
                    res["error"] = f"{type(e).__name__}: {str(e)[:120]}"
            except Exception as e:
                res["verdict"] = "error"
                res["error"] = f"{type(e).__name__}: {str(e)[:120]}"
            res["ms"] = int((time.time() - t0) * 1000)
            out.write(json.dumps(res, ensure_ascii=False) + "\n")
            out.flush()
            log(f"{i:3}/{len(todo)} {res['verdict']:<15} {src['name'][:28]:<28} "
                f"cat={res.get('catalogue')} ch={res.get('chapters')} pages={res.get('pages')} {res.get('error','')}")

    stop_server()
    rows = {}
    with open(RESULTS, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                r = json.loads(line)
                rows[r["id"]] = r
    ok = [r for r in rows.values() if r.get("verdict") == "ok"]
    log(f"\n{len(ok)}/{len(rows)} manga sources playable")
    json.dump(sorted(rows.values(), key=lambda r: r["name"]),
              open(os.path.join(DATA, "manga-sources.json"), "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
