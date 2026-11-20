"""Crash-aware source harness.

Tests every anime source end to end (catalogue -> details -> episodes -> videos).
Extensions converted by dex2jar can contain bytecode that kills the JVM outright,
so this runner:
  * marks the in-flight source before each request,
  * restarts the engine itself when the connection dies,
  * blacklists whatever was running at crash time,
  * resumes from data/source-tests.jsonl and never re-tests a source twice.

Usage: python scripts/harness.py [--retry-crashed] [--limit N]
"""
import json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
JDK = os.path.join(ROOT, "tools", "jdk-21.0.13+9", "bin", "java.exe")
JAR = os.path.join(ROOT, "app", "miwayomi-all.jar")
PORT = 8790
BASE = f"http://127.0.0.1:{PORT}"
RESULTS = os.path.join(DATA, "source-tests.jsonl")
INFLIGHT = os.path.join(DATA, "current-source.json")
SERVERLOG = os.path.join(DATA, "server.log")

proc = None


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def http(path, timeout=30):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        raw = r.read()
    return json.loads(raw or b"{}")


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
    env = os.environ.copy()
    env["JAVA_HOME"] = os.path.dirname(os.path.dirname(JDK))
    out = open(SERVERLOG, "ab")
    proc = subprocess.Popen(
        [JDK, "-Xverify:none", "-Xint", "-jar", JAR, "--port", str(PORT), "--data", DATA, "--no-open", "-f", ""],
        stdout=out, stderr=subprocess.STDOUT, env=env, cwd=ROOT,
        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )
    for _ in range(300):
        if server_alive():
            n = http("/api/v1/health")["animeSources"]
            log(f"engine up ({n} sources)")
            return
        if proc.poll() is not None:
            log(f"engine exited with {proc.returncode} during startup")
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


def mark(src):
    with open(INFLIGHT, "w", encoding="utf-8") as f:
        json.dump(src, f)


def test_source(src, res):
    sid, name = src["id"], src["name"]
    q = lambda s: urllib.parse.quote(s, safe="")
    page = http(f"/api/v1/anime/{sid}/popular?page=1", timeout=45)
    animes = page.get("animes") or []
    if not animes:
        page = http(f"/api/v1/anime/{sid}/latest?page=1", timeout=45)
        animes = page.get("animes") or []
    res["catalogue"] = len(animes)
    if not animes:
        res["verdict"] = "empty-catalogue"
        return
    first = animes[0]
    res["title"] = first.get("title")
    res["url"] = first.get("url")
    det = http(f"/api/v1/anime/{sid}/details?url={q(first['url'])}", timeout=45)
    res["detail"] = bool(det.get("title"))
    eps = http(f"/api/v1/anime/{sid}/episodes?url={q(first['url'])}", timeout=60)
    ep_list = eps.get("episodes") or []
    res["episodes"] = len(ep_list)
    if not ep_list:
        res["verdict"] = "no-episodes"
        return
    ep = ep_list[0]
    res["episode"] = ep.get("name")
    extra = f"&name={q(ep.get('name') or '')}&episode_number={ep.get('episode_number', -1)}"
    vids = http(f"/api/v1/anime/{sid}/videos?url={q(ep['url'])}{extra}", timeout=90)
    vs = vids.get("videos") or []
    res["videos"] = len(vs)
    if vs:
        res["verdict"] = "ok"
        res["sample"] = (vs[0].get("videoTitle") or "") + " " + (vs[0].get("videoUrl") or "")[:120]
    else:
        res["verdict"] = "no-videos"


def main():
    global proc
    start_server()
    existing = {}
    if os.path.exists(RESULTS):
        with open(RESULTS, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                    existing[r["id"]] = r
                except Exception:
                    pass
    retry_crashed = "--retry-crashed" in sys.argv
    retry_errors = "--retry-errors" in sys.argv
    retry_details = "--retry-details" in sys.argv

    def skip_row(r):
        verdict = r.get("verdict")
        if verdict == "crash":
            return not retry_crashed
        if verdict == "error":
            if retry_details:
                return not (r.get("catalogue") or 0) > 0
            return not retry_errors
        return True

    skip = {sid for sid, r in existing.items() if skip_row(r)}
    sources = http("/api/v1/sources")["anime"]
    todo = [s for s in sources if s["id"] not in skip]
    if "--limit" in sys.argv:
        todo = todo[: int(sys.argv[sys.argv.index("--limit") + 1])]
    log(f"{len(sources)} anime sources, {len(todo)} left to test")

    results = []
    with open(RESULTS, "a", encoding="utf-8") as out:
        for i, src in enumerate(todo, 1):
            res = {"id": src["id"], "name": src["name"], "pkg": src.get("pkg"), "verdict": None}
            mark(src)
            t0 = time.time()
            try:
                test_source(src, res)
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
                    res["error"] = f"{type(e).__name__}: {str(e)[:140]}"
            except Exception as e:
                res["verdict"] = "error"
                res["error"] = f"{type(e).__name__}: {str(e)[:140]}"
            res["ms"] = int((time.time() - t0) * 1000)
            results.append(res)
            out.write(json.dumps(res, ensure_ascii=False) + "\n")
            out.flush()
            log(f"{i:3}/{len(todo)} {res['verdict']:<15} {src['name'][:28]:<28} "
                f"cat={res.get('catalogue')} eps={res.get('episodes')} vid={res.get('videos')} "
                f"{res.get('error', '')}")

    stop_server()
    with open(RESULTS, encoding="utf-8") as f:
        raw = [json.loads(l) for l in f if l.strip()]
    latest = {}
    for r in raw:
        latest[r["id"]] = r
    allres = list(latest.values())
    ok = [r for r in allres if r.get("verdict") == "ok"]
    crashed = [r for r in allres if r.get("verdict") == "crash"]
    log(f"\n{len(ok)}/{len(allres)} sources playable, {len(crashed)} killed the engine")
    for r in crashed:
        log(f"  CRASH {r['name']} ({r.get('pkg')})")
    with open(os.path.join(DATA, "working-sources.json"), "w", encoding="utf-8") as f:
        json.dump(sorted(allres, key=lambda r: r["name"]), f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
