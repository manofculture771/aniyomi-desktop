"""Copy the web UI sources into the built jar without running Gradle.

Rebuilding the shadow jar takes 1-3 minutes; the UI is plain static files, so a
zip-entry rewrite is enough while iterating. Stop the engine first (the file is
locked while the JVM runs).
"""
import os, shutil, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_work", "miwayomi", "server", "src", "main", "resources", "webui")
JAR = os.path.join(ROOT, "app", "miwayomi-all.jar")


def main():
    files = {}
    for base, _dirs, names in os.walk(SRC):
        for n in names:
            if n.endswith((".md",)):
                continue
            full = os.path.join(base, n)
            rel = os.path.relpath(full, SRC).replace("\\", "/")
            files["webui/" + rel] = full
    if not files:
        raise SystemExit("no webui files found")
    tmp = JAR + ".tmp"
    with zipfile.ZipFile(JAR, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        replaced = 0
        for item in zin.infolist():
            if item.filename in files:
                with open(files[item.filename], "rb") as f:
                    data = f.read()
                zout.writestr(item.filename, data, compress_type=zipfile.ZIP_DEFLATED)
                replaced += 1
            else:
                zout.writestr(item, zin.read(item.filename))
        existing = {i.filename for i in zin.infolist()}
        added = 0
        for name, path in files.items():
            if name not in existing:
                with open(path, "rb") as f:
                    zout.writestr(name, f.read(), compress_type=zipfile.ZIP_DEFLATED)
                added += 1
    shutil.move(tmp, JAR)
    print(f"webui synced into jar: {replaced} replaced, {added} added")


if __name__ == "__main__":
    main()
