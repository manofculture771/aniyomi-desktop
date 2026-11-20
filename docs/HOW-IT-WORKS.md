# How this desktop build works

## The shape of the problem

Aniyomi is an Android app: Kotlin + Jetpack Compose on top of the Android
framework, and a **source API** (`eu.kanade.tachiyomi.animesource.*`) that
third-party extensions compile against. Extensions ship as APKs — DEX bytecode,
not JVM classes — and they call into `HttpSource`, `AnimeHttpSource`,
`Context`, `SharedPreferences`, `WebView`, `Log`, plus okhttp/jsoup.

"Running it on Windows without an emulator" therefore means replacing the
Android runtime, not the app UI. That is exactly what
[miwayomi](https://github.com/miwayomi/miwayomi) does, and this build is built
on top of it:

| Layer | What it is here |
|---|---|
| Android compat | a small JVM reimplementation of the framework classes extensions touch (`android.content.Context`, `SharedPreferences`, `Log`, `WebView` stubs, Base64, Uri…) |
| Source API | Aniyomi's `source-api` ported to plain JVM (`AnimeSource`, `AnimeCatalogueSource`, `AnimeHttpSource`, `ParsedAnimeHttpSource`, `SAnime`, `SEpisode`, `Video`) |
| Extension loader | reads the APK, extracts `classes.dex`, converts it with **dex2jar**, repairs bytecode with ASM (`JarFixer`), loads it through a child-first `URLClassLoader` |
| Server | Ktor on `127.0.0.1` — `/api/v1/sources`, `/anime/{id}/popular|latest|search|details|episodes|videos`, `/hls` and `/proxy` for media, `/extensions/*` for the repo manager |
| UI | one-page web app served from the jar, drawn in a Chrome/Brave `--app` window (no tabs, no address bar) |

An extension APK never runs on an Android runtime here: its DEX is translated to
JVM bytecode at install time and instantiated by reflection
(`AnimeSourceFactory.createSources()`).

## The two bugs that made every player empty

Both come from Aniyomi's own model classes: `SAnime.title` and `SEpisode.name`
are `lateinit`. On Android the app always hands the extension a *populated*
object, so no extension defends against them being unset. The port built a stub
with only `url` set, so every extension that reads `anime.title` or
`episode.name` (most do, `ParsedAnimeHttpSource` itself does) threw
`UninitializedPropertyAccessException`:

- `/anime/{id}/videos` → `videos: []` for every source, player always empty.
- `/anime/{id}/details` → HTTP 500 for ~8 sources.

Fix: the routes now rebuild the object from query parameters the UI already
knows (`&title=`, `&name=`, `&episode_number=`, `&scanlator=`,
`&date_upload=`), defaulting to the URL slug when absent
(`ApiHelpers.episodeFromQuery` / `animeFromQuery`).

## The crash

`dex2jar` produces bytecode that is *almost* valid. Some methods end up with
stack-map frames HotSpot will not accept. With `-Xverify:none` the JVM skips the
verifier — which is why most extensions work — but the C1 compiler still builds
oop maps and **hard-crashes** on the malformed method:

```
# fatal error: Illegal class file encountered. Try running with -Xverify:all
# in method getVideoList
# Problematic frame: j eu.kanade...animotvslash.Animotvslash.getVideoList
```

That is a native `Internal Error` in HotSpot: no exception, no stack trace, the
process is gone. Three extensions in the tested set had such a method
(`Animotvslash`, `AnimeSalt`, `CinemaOS`, `Vostfree`).

Handling:

1. `scripts/harness.py` tests every source end-to-end, writes
   `data/current-source.json` before each request, and when the connection dies
   it restarts the engine and records the in-flight source as `crash`.
2. `scripts/prune.py` uninstalls every extension that never produced a playable
   chain — crashes are always removed, dead sources go with them.

Rebuilding frames with `COMPUTE_FRAMES` for every class was tried and rejected
upstream: type resolution through a classloader that lacks half the Android
framework emits wrong frames and breaks otherwise-fine extensions.

## Media pipeline

Two kinds of streams exist:

- **Direct URL** (mp4/m3u8 on a CDN) → `/api/v1/proxy` or `/api/v1/hls`, which
  re-fetches server-side (needed for `Referer`/`User-Agent`/cookie gates) and
  rewrites playlist URLs to itself.
- **Extension-hosted HLS** — some extensions start their own tiny HTTP server
  inside the JVM (`http://127.0.0.1:<random>/variant/sub/720p.m3u8`). That is
  Aniyomi's `HttpServer` model working unchanged on the JVM; those URLs are
  played as-is.

`hls.js` and `dash.js` are vendored in `webui/vendor/` (they used to be pulled
from jsDelivr, which fails behind a blocked CDN or offline).

## Testing harness

`scripts/harness.py` = catalogue → details → episodes → videos, per source,
resumable, crash-aware. Results in `data/source-tests.jsonl`
(`ok` = a playable video URL was returned). `--retry-details` re-tests sources
that got a catalogue but failed later; `--retry-errors` re-tests everything that
failed.

Most failures are not engine bugs: dead hosts (`UnknownHostException`),
unreachable networks, Cloudflare walls, and extensions that open a `WebView` to
extract a token (no browser in a headless JVM).
