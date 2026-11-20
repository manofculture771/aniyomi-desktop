/* ---------------- Cinema player ---------------- */

const PS = {
  hideTimer: null,
  seeking: false,
  speed: 1,
  subs: [],
  subIndex: 0,
  bound: false,
  videoEl: null,
  keysBound: false,
};

function psFmt(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}

function psVideo() { return document.getElementById("videoPlayer"); }

function psShow(force) {
  const ps = document.getElementById("ps");
  if (!ps) return;
  ps.classList.remove("idle");
  clearTimeout(PS.hideTimer);
  const v = psVideo();
  const active = v && !v.paused;
  if (force || !active) return;
  PS.hideTimer = setTimeout(() => {
    const box = document.getElementById("ps");
    const v2 = psVideo();
    if (box && v2 && !v2.paused && !PS.seeking) {
      box.classList.add("idle");
      psClosePanel();
    }
  }, 2600);
}

function psInit() {
  const v = psVideo();
  const ps = document.getElementById("ps");
  if (!v || !ps) return;
  // the player markup is rebuilt for every episode: bind to the new <video>
  if (PS.bound && PS.videoEl === v) { psSetIcon(!v.paused); return; }
  PS.videoEl = v;
  PS.bound = true;

  const on = (evt, fn) => v.addEventListener(evt, fn);
  on("timeupdate", psSyncClock);
  on("durationchange", psSyncClock);
  on("progress", psSyncBuffer);
  on("play", () => { psSetIcon(true); psShow(); });
  on("playing", () => { psSetIcon(true); psShow(); });
  on("loadedmetadata", () => { psSetIcon(!v.paused); psSyncClock(); });
  on("ended", () => { psSetIcon(false); psShow(true); });
  on("pause", () => { psSetIcon(false); psShow(true); });
  on("waiting", () => ps.classList.add("buffering"));
  on("playing", () => { ps.classList.remove("buffering"); psSetIcon(true); psShow(); });
  on("error", () => ps.classList.remove("buffering"));
  on("volumechange", psSyncVolume);

  ps.addEventListener("mousemove", () => psShow());
  ps.addEventListener("mouseleave", () => psShow());

  const seek = document.getElementById("psSeek");
  if (seek) {
    const ratioAt = (clientX) => {
      const r = seek.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    };
    seek.addEventListener("pointerdown", (e) => {
      PS.seeking = true;
      seek.setPointerCapture(e.pointerId);
      psSeekTo(ratioAt(e.clientX));
    });
    seek.addEventListener("pointermove", (e) => {
      const r = ratioAt(e.clientX);
      const tip = document.getElementById("psTip");
      if (tip && v.duration) {
        tip.style.left = (r * 100) + "%";
        tip.textContent = psFmt(r * v.duration);
        tip.classList.add("on");
      }
      if (PS.seeking) psSeekTo(r);
    });
    seek.addEventListener("pointerup", (e) => {
      PS.seeking = false;
      try { seek.releasePointerCapture(e.pointerId); } catch (_) { }
    });
    seek.addEventListener("pointerleave", () => {
      const tip = document.getElementById("psTip");
      if (tip) tip.classList.remove("on");
    });
  }

  if (!PS.keysBound) { document.addEventListener("keydown", psKeys); PS.keysBound = true; }
  psSyncClock();
  psSetIcon(false);
  psShow(true);
}

function psKeys(e) {
  if (state.currentView !== "player") return;
  const tag = (e.target && e.target.tagName) || "";
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  const v = psVideo();
  if (!v) return;
  switch (e.key) {
    case " ": case "k": e.preventDefault(); psToggle(); break;
    case "ArrowRight": e.preventDefault(); psSeekBy(10); break;
    case "ArrowLeft": e.preventDefault(); psSeekBy(-10); break;
    case "ArrowUp": e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); break;
    case "ArrowDown": e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); break;
    case "f": psFullscreen(); break;
    case "m": v.muted = !v.muted; break;
    case "n": psNext(); break;
    case "Escape":
      if (document.fullscreenElement) psFullscreen();
      else if (document.getElementById("ps") && document.getElementById("ps").classList.contains("ps-fs")) psExitCssFs();
      else psClosePanel();
      break;
  }
}

function psToggle() {
  const v = psVideo();
  if (!v) return;
  if (v.paused) { psSetIcon(true); attemptPlay(v); }  // optimistic: hide the overlay at once
  else v.pause();
}

function psMute() {
  const v = psVideo();
  if (!v) return;
  v.muted = !v.muted;
  psSyncVolume();
  psShow();
}

function psSeekBy(delta) {
  const v = psVideo();
  if (!v || !isFinite(v.duration)) return;
  v.currentTime = Math.min(v.duration - 0.4, Math.max(0, v.currentTime + delta));
  psSyncClock();
  psShow();
}

function psSeekTo(ratio) {
  const v = psVideo();
  if (!v || !isFinite(v.duration)) return;
  v.currentTime = ratio * v.duration;
  psSyncClock();
}

function psSyncClock() {
  const v = psVideo();
  if (!v) return;
  const fill = document.getElementById("psFill");
  const dot = document.getElementById("psDot");
  const cur = document.getElementById("psCur");
  const dur = document.getElementById("psDur");
  const pct = v.duration ? (v.currentTime / v.duration) * 100 : 0;
  if (fill) fill.style.width = pct + "%";
  if (dot) dot.style.left = pct + "%";
  if (cur) cur.textContent = isFinite(v.duration) ? psFmt(v.currentTime) : "--:--";
  if (dur) dur.textContent = isFinite(v.duration) ? psFmt(v.duration) : "--:--";
}

function psSyncBuffer() {
  const v = psVideo();
  const buf = document.getElementById("psBuf");
  if (!v || !buf || !v.buffered.length || !v.duration) return;
  buf.style.width = ((v.buffered.end(v.buffered.length - 1) / v.duration) * 100) + "%";
}

function psSyncVolume() {
  const v = psVideo();
  const btn = document.getElementById("psVol");
  if (v && btn) btn.textContent = v.muted || v.volume === 0 ? "🔇" : "🔊";
}

function psSetIcon(playing) {
  const c = document.getElementById("psCenter");
  const p = document.getElementById("psPlay");
  if (c) c.classList.toggle("hidden", playing);
  if (p) p.textContent = playing ? "❚❚" : "▶";
}

function psFullscreen() {
  const ps = document.getElementById("ps");
  if (!ps) return;
  // leave native fullscreen if we are in it
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => { }); return; }
  // CSS fullscreen toggle (Brave --app windows can refuse the native API)
  if (ps.classList.contains("ps-fs")) { psExitCssFs(); return; }
  // Always size the player with our own class: the native :fullscreen pseudo
  // can be scoped to another element (or refused), which left the 16:9 box
  // floating in a black window. Native fullscreen only hides the browser chrome.
  psEnterCssFs();
  if (ps.requestFullscreen) {
    ps.requestFullscreen().then(() => {
      document.addEventListener("fullscreenchange", psFsSync, { once: true });
    }).catch(() => { });
  }
}

function psEnterCssFs() {
  const ps = document.getElementById("ps");
  if (!ps) return;
  ps.classList.add("ps-fs");
  document.body.classList.add("no-scroll");
  psShow(true);
}

function psExitCssFs() {
  const ps = document.getElementById("ps");
  if (ps) ps.classList.remove("ps-fs");
  document.body.classList.remove("no-scroll");
}

function psFsSync() {
  const ps = document.getElementById("ps");
  if (!ps) return;
  // leaving native fullscreen: make sure the CSS mode is not left on
  if (!document.fullscreenElement) psExitCssFs();
}

function psNext() {
  const nx = nextEpisode();
  if (!nx) { psToast(t("player.noNext")); return; }
  openEpisode(encodeURIComponent(nx.url), nx.name, true);
}

function psToast(msg) {
  const box = document.getElementById("psToast");
  if (!box) return;
  box.textContent = msg;
  box.classList.add("on");
  setTimeout(() => box.classList.remove("on"), 1600);
}

function psClosePanel() {
  const p = document.getElementById("psPanel");
  if (p) { p.classList.remove("open"); p.innerHTML = ""; }
}

function psMenu(kind) {
  const panel = document.getElementById("psPanel");
  if (!panel) return;
  if (panel.classList.contains("open") && panel.dataset.kind === kind) { psClosePanel(); return; }
  panel.dataset.kind = kind;
  const v = psVideo();
  let html = "";
  if (kind === "quality") {
    const list = window.__videos || [];
    html = `<div class="psp-title">${escapeHtml(t("player.sources"))}</div>` +
      list.map((x, i) => {
        const label = x.videoTitle || (x.resolution ? x.resolution + "p" : t("player.video", i + 1));
        const active = Number(v && v.dataset.index) === i ? " on" : "";
        return `<button class="psp-row${active}" onclick="psPickSource(${i})">${escapeHtml(label)}</button>`;
      }).join("");
  } else if (kind === "speed") {
    html = `<div class="psp-title">${escapeHtml(t("player.speed"))}</div>` +
      [0.5, 0.75, 1, 1.25, 1.5, 2].map((s) =>
        `<button class="psp-row${s === PS.speed ? " on" : ""}" onclick="psSetSpeed(${s})">${s}×</button>`).join("");
  } else if (kind === "subs") {
    if (!PS.subs.length) { html = `<div class="psp-title">${escapeHtml(t("player.subtitles"))}</div><div class="psp-empty">${escapeHtml(t("player.noSubs"))}</div>`; }
    else {
      html = `<div class="psp-title">${escapeHtml(t("player.subtitles"))}</div>
        <button class="psp-row${PS.subIndex === 0 ? " on" : ""}" onclick="psPickSub(0)">${escapeHtml(t("player.subsOff"))}</button>` +
        PS.subs.map((s, i) => `<button class="psp-row${PS.subIndex === i + 1 ? " on" : ""}" onclick="psPickSub(${i + 1})">${escapeHtml(s.lang || ("Track " + (i + 1)))}</button>`).join("");
    }
  }
  panel.innerHTML = html;
  panel.classList.add("open");
}

function psPickSource(i) {
  playVideo(i);
  psClosePanel();
  psToast((window.__videos[i] || {}).videoTitle || t("player.video", i + 1));
}

function psSetSpeed(s) {
  PS.speed = s;
  const v = psVideo();
  if (v) v.playbackRate = s;
  const btn = document.getElementById("psSpeed");
  if (btn) btn.textContent = s + "×";
  psClosePanel();
}

function psBuildSubs() {
  const v = psVideo();
  if (!v) return;
  const cur = (window.__videos || [])[Number(v.dataset.index || 0)] || {};
  const tracks = cur.subtitleTracks || [];
  PS.subs = tracks;
  PS.subIndex = 0;
  v.querySelectorAll("track").forEach((tr) => tr.remove());
  tracks.forEach((s, i) => {
    const tr = document.createElement("track");
    tr.kind = "subtitles";
    tr.label = s.lang || ("Track " + (i + 1));
    tr.srclang = (s.lang || "en").slice(0, 2).toLowerCase();
    tr.src = `/api/v1/proxy?sourceId=${state.activeSource.id}&url=${encodeURIComponent(s.url)}`;
    v.appendChild(tr);
  });
  const cc = document.getElementById("psCaps");
  if (cc) cc.classList.toggle("dim", tracks.length === 0);
}

function psPickSub(idx) {
  const v = psVideo();
  if (!v) return;
  PS.subIndex = idx;
  Array.from(v.textTracks).forEach((tt, i) => { tt.mode = (i === idx - 1) ? "showing" : "disabled"; });
  psClosePanel();
}

async function psLaunchMpv() {
  const v = psVideo();
  if (!v) return;
  const path = v.dataset.proxy || "";
  if (!path) { psToast(t("player.mpvError", "no stream")); return; }
  const url = location.origin + path;
  // subtitles live on the extension's own little server: pull the text through
  // the proxy and let mpv read a real file, otherwise mpv opens silent
  const subs = [];
  for (const s of (PS.subs || []).slice(0, 4)) {
    if (!s || !s.url) continue;
    try {
      const r = await fetch(`/api/v1/proxy?sourceId=${state.activeSource.id}&url=${encodeURIComponent(s.url)}`);
      if (!r.ok) continue;
      const raw = await r.text();
      // SRT parsers (mpv/libass) drop the last cue when the file does not end
      // with a blank line, so normalise before handing it over
      const text = raw ? raw.replace(/\r\n/g, "\n").trimEnd() + "\n\n" : "";
      if (text.length > 2 && text.length < 3_000_000) subs.push({ lang: s.lang || "", content: text });
    } catch (e) { }
  }
  try {
    const res = await fetch(`${api}/player/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title: state.currentEpName || "", subs }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) psToast(t("player.mpvError", data.error || "mpv"));
    else psToast(subs.length ? t("player.mpvOpenedSubs", subs.length) : t("player.mpvOpened"));
  } catch (e) {
    psToast(t("player.mpvError", e.message));
  }
}
