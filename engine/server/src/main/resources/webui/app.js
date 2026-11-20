const $ = (sel) => document.querySelector(sel);
const api = "/api/v1";

let state = {
  sources: { manga: [], anime: [] },
  activeSource: null,
  detail: null,
  typeFilter: "all",
  currentView: "home",
  catalog: null,
  episodes: [],
  currentEncUrl: null,
  currentEpName: "",
  currentEpNumber: null,
};

// In-app navigation stack (SPA has no real browser history between views)
let navStack = [];
function navPush(restore) { navStack.push(restore); }
function goBack() {
  if (navStack.length) {
    const restore = navStack.pop();
    if (typeof restore === "function") restore();
  } else if (window.history.length > 1) {
    window.history.back();
  }
}

const DEFAULT_LANG = "en";
const AVAILABLE_LANGS = ["en", "es"];
let I18N = {};

function t(key, ...args) {
  let s = (I18N && I18N[key]) || key;
  if (args.length) args.forEach((a, i) => { s = s.split(`{${i}}`).join(String(a)); });
  return s;
}

function currentLang() {
  return localStorage.getItem("miwayomi.lang") || DEFAULT_LANG;
}

async function loadI18n(lang) {
  try {
    const res = await fetch(`/lang/${lang}.json`);
    if (res.ok) I18N = await res.json();
    else I18N = {};
  } catch (e) { I18N = {}; }
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && I18N[key] !== undefined) el.textContent = I18N[key];
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (key && I18N[key] !== undefined) el.innerHTML = I18N[key];
  });
}

function setLang(lang) {
  localStorage.setItem("miwayomi.lang", lang);
  location.reload();
}

async function getJSON(url) {
  // The engine can die mid-request (third-party extension bytecode). The
  // supervisor restarts it in a few seconds, so retry instead of showing an
  // error screen the user has to reload by hand.
  let res = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      res = await fetch(url);
      break;
    } catch (e) {
      if (attempt === 0) engineDownToast();
      await new Promise((r) => setTimeout(r, 2000 + attempt * 1500));
    }
  }
  if (!res) throw new Error(t("engine.down"));
  if (res.ok) return res.json();
  let body = null;
  try { body = await res.json(); } catch (e) { }
  if (body && body.challengeUrl) {
    throw new Error(t("cf.challengeError"));
  }
  throw new Error(`HTTP ${res.status}`);
}

function engineDownToast() {
  let el = document.getElementById("engineDown");
  if (!el) {
    el = document.createElement("div");
    el.id = "engineDown";
    el.className = "engine-down";
    document.body.appendChild(el);
  }
  el.textContent = t("engine.restarting");
  el.classList.add("on");
  const clear = () => { const x = document.getElementById("engineDown"); if (x) x.classList.remove("on"); };
  setTimeout(clear, 12000);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setNav(name) {
  document.querySelectorAll(".nav-link").forEach((n) => n.classList.toggle("active", n.dataset.nav === name));
}

const THUMB_CACHE_KEY = "miwayomi.thumbs";
function getThumbCache() {
  try { return JSON.parse(localStorage.getItem(THUMB_CACHE_KEY) || "{}"); } catch (e) { return {}; }
}
function setThumbCache(c) {
  const keys = Object.keys(c);
  if (keys.length > 800) {
    for (const k of keys.slice(0, keys.length - 400)) delete c[k];
  }
  try { localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(c)); } catch (e) { }
}
function proxyImg(u) {
  return `/api/v1/proxy?sourceId=${state.activeSource.id}&url=${encodeURIComponent(u)}`;
}
const THUMB_MAX_CONCURRENT = 3;
let thumbQueue = [];
let thumbActive = 0;
function enqueueThumb(img) { thumbQueue.push(img); pumpThumbs(); }
function pumpThumbs() {
  while (thumbActive < THUMB_MAX_CONCURRENT && thumbQueue.length) {
    const img = thumbQueue.shift();
    thumbActive++;
    loadChapterThumb(img).catch(() => { }).finally(() => { thumbActive--; pumpThumbs(); });
  }
}
let thumbObserver = null;
if ("IntersectionObserver" in window) {
  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) { thumbObserver.unobserve(en.target); enqueueThumb(en.target); }
    }
  }, { rootMargin: "400px" });
}
async function loadChapterThumb(img) {
  if (!img) return;
  const enc = img.dataset.ch;
  if (!enc) return;
  const ckey = `${state.activeSource.id}:${enc}`;
  const cache = getThumbCache();
  if (cache[ckey]) { img.src = proxyImg(cache[ckey]); img.classList.add("ready"); return; }
  try {
    const d = await getJSON(`${api}/manga/${state.activeSource.id}/pages?url=${enc}`);
    const p = d.pages && d.pages[0];
    if (p && p.imageUrl) {
      cache[ckey] = p.imageUrl;
      setThumbCache(cache);
      img.src = proxyImg(p.imageUrl);
      img.classList.add("ready");
    }
  } catch (e) { }
}

/* ---------------- Sidebar ---------------- */

async function loadSources() {
  const data = await getJSON(`${api}/sources`);
  state.sources = data;
  renderSources();
}

function setTypeFilter(type) {
  state.typeFilter = type;
  document.querySelectorAll(".type-tab").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
  renderSources();
}

function renderSources() {
  const list = $("#srcList");
  if (!list) return;
  list.innerHTML = "";
  const q = ($("#srcFilter")?.value || "").trim().toLowerCase();

  const favBtn = document.createElement("div");
  favBtn.className = "source-item";
  favBtn.innerHTML = `<span class="badge fav">★</span> ${escapeHtml(t("nav.favorites"))}`;
  favBtn.onclick = () => showFavorites();
  list.appendChild(favBtn);

  const groups = [
    ["manga", t("nav.manga"), state.sources.manga],
    ["anime", t("nav.anime"), state.sources.anime],
  ];
  for (const [type, label, srcs] of groups) {
    if (state.typeFilter !== "all" && state.typeFilter !== type) continue;
    if (!srcs || srcs.length === 0) continue;
    let shown = srcs;
    if (q) shown = srcs.filter((s) => (s.name + " " + (s.pkg || "")).toLowerCase().includes(q));
    if (shown.length === 0) continue;

    const title = document.createElement("div");
    title.className = "group-title";
    title.textContent = label;
    list.appendChild(title);

    const byPkg = new Map();
    for (const s of shown) {
      const k = s.pkg || "";
      if (!byPkg.has(k)) byPkg.set(k, []);
      byPkg.get(k).push(s);
    }
    for (const [pkg, sarr] of byPkg) {
      if (!pkg) {
        for (const s of sarr) appendSourceFlat(list, type, s, "");
        continue;
      }
      const uniq = new Map();
      for (const s of sarr) {
        const n = s.name;
        if (!uniq.has(n)) uniq.set(n, []);
        uniq.get(n).push(s);
      }
      if (uniq.size === 1) {
        const s = sarr[0];
        const extra = sarr.length > 1 ? ` (${sarr.length})` : "";
        appendSourceFlat(list, type, s, extra);
        continue;
      }
      const g = document.createElement("div");
      g.className = "source-group";
      g.innerHTML = `<span class="badge ${type}">${type}</span> <span class="sg-name">${escapeHtml(extGroupLabel(pkg, uniq))}</span> <span class="sg-count">${sarr.length}</span> <span class="sg-chevron">▸</span>`;
      const sub = document.createElement("div");
      sub.className = "source-group-sub";
      sub.style.display = "none";
      let containsActive = false;
      for (const [name, arr] of uniq) {
        const row = document.createElement("div");
        const isActive = arr.some((x) => x.id === state.activeSource?.id);
        if (isActive) containsActive = true;
        row.className = "source-item sub" + (isActive ? " active" : "");
        row.innerHTML = `${escapeHtml(name)}${arr.length > 1 ? ` <span class="sg-count">${arr.length}</span>` : ""}`;
        row.onclick = (e) => { e.stopPropagation(); openSource(arr[0]); };
        sub.appendChild(row);
      }
      if (containsActive) {
        sub.style.display = "block";
        g.classList.add("open");
        g.querySelector(".sg-chevron").textContent = "▾";
      }
      g.onclick = () => {
        const open = sub.style.display !== "none";
        sub.style.display = open ? "none" : "block";
        g.classList.toggle("open", !open);
        g.querySelector(".sg-chevron").textContent = open ? "▸" : "▾";
      };
      list.appendChild(g);
      list.appendChild(sub);
    }
  }
}

function appendSourceFlat(list, type, s, suffix) {
  const el = document.createElement("div");
  el.className = "source-item" + (state.activeSource?.id === s.id ? " active" : "");
  el.innerHTML = `<span class="badge ${type}">${type}</span> ${escapeHtml(s.name)}${escapeHtml(suffix)}`;
  el.onclick = () => openSource(s);
  list.appendChild(el);
}

function extGroupLabel(pkg, uniq) {
  const names = [...uniq.keys()];
  if (names.length >= 2) {
    let lcp = names[0];
    for (const n of names.slice(1)) {
      let i = 0;
      while (i < lcp.length && i < n.length && lcp[i] === n[i]) i++;
      lcp = lcp.slice(0, i);
    }
    lcp = lcp.trim();
    if (lcp.length >= 2) return lcp;
  }
  const short = (pkg.split(".").pop() || pkg).replace(/[_-]+/g, " ");
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/* ---------------- Home ---------------- */

function closeMangaReader() {
  const w = document.getElementById("mangaReader");
  if (w) w.classList.add("hidden");
}

async function goHome() {
  closeMangaReader();
  const _a = document.querySelector(".app"); if (_a) _a.classList.remove("mu-mode");
  setNav("home");
  renderHome();
}

async function goBrowse(type) {
  closeMangaReader();
  const app = document.querySelector(".app"); if (app) app.classList.remove("mu-mode");
  setNav(type);
  setTypeFilter(type);
  const list = sourcesFor(type);
  if (!list.length) { renderHome(); return; }
  const last = localStorage.getItem("aniyomi.lastSource:" + type) || localStorage.getItem("aniyomi.lastSource");
  const pick = list.find((s) => String(s.id) === String(last)) || list[0];
  renderBrowseView(pick);
}

async function renderHome() {
  state.currentView = "home";
  const main = $("#content");
  const manga = state.sources.manga || [];
  const anime = state.sources.anime || [];
  const pinnedFirst = sortSources([...anime, ...manga].filter((s) => isPinned(s.id)));
  let html = "";
  if (pinnedFirst.length) html += rowWrap("Your sources", pinnedFirst.map((s) => sourceCard(s)).join(""));
  html += `<div id="homeHero"></div>`;
  const watch = await listWatch();
  if (watch.length) html += rowWrap(t("player.continueWatching"), watch.map((w) => watchCard(w)).join(""));
  const mangaShown = manga.filter((s) => langOk(s.lang));
  const animeShown = anime.filter((s) => langOk(s.lang));
  if (mangaShown.length && (state.typeFilter === "all" || state.typeFilter === "manga")) {
    html += rowWrap(t("nav.manga"), mangaShown.map((s) => sourceCard(s)).join(""));
  }
  if (animeShown.length && (state.typeFilter === "all" || state.typeFilter === "anime")) {
    html += rowWrap(t("nav.anime"), animeShown.map((s) => sourceCard(s)).join(""));
  }
  try {
    const favs = await getJSON(`${api}/favorites`);
    if (favs && favs.length) {
      html += rowWrap(t("nav.favorites"), favs.map((f) => favCard(f)).join(""));
    }
  } catch (e) { }
  main.innerHTML = html;
  paintHomeHero();
}

/* Home hero + trending row, built from a real catalogue so the app opens on
   artwork instead of an empty source picker. */
function heroCandidateSource() {
  const anime = (state.sources.anime || []).filter((s) => !/^demo$/i.test(s.name || "") && !/mock/i.test(s.name || ""));
  if (!anime.length) return null;
  const last = localStorage.getItem("aniyomi.lastSource");
  return anime.find((s) => String(s.id) === last) || anime[0];
}

async function paintHomeHero() {
  const box = $("#homeHero");
  if (!box) return;
  const src = heroCandidateSource();
  if (!src) return;
  const key = `aniyomi.hero:${src.id}`;
  let items = null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || "null");
    if (cached && Date.now() - cached.at < 15 * 60 * 1000) items = cached.items;
  } catch (e) { }
  if (!items) {
    try {
      const page = await getJSON(`${api}/anime/${src.id}/popular?page=1`);
      items = (page.animes || []).slice(0, 18);
      if (items.length) sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), items }));
    } catch (e) { return; }
  }
  const stillThere = $("#homeHero");
  if (!stillThere || !items || !items.length) { if (stillThere) stillThere.remove(); return; }

  const pick = items[0];
  const art = pick.background_url || pick.thumbnail_url;
  const bg = art ? `/api/v1/proxy?sourceId=${src.id}&url=${encodeURIComponent(art)}` : "";
  const meta = [pick.genre, t("nav.anime"), src.name].filter(Boolean).join(" · ");
  stillThere.innerHTML = `
    <div class="hero-feature">
      <div class="hf-bg" ${bg ? `style="background-image:url('${bg}')"` : ""}></div>
      <div class="hf-fade"></div>
      <div class="hf-body">
        <div class="hf-kicker">${escapeHtml(t("home.trending"))} · ${escapeHtml(src.name)}</div>
        <h1>${escapeHtml(pick.title)}</h1>
        <div class="hf-meta">${escapeHtml(meta)}</div>
        <div class="hf-actions">
          <button class="btn-primary hf-play" onclick="openFromHome('${src.id}','anime','${encodeURIComponent(pick.url)}','${encodeURIComponent(pick.title || "")}')">
            <span class="hf-play-icon">▶</span> ${escapeHtml(t("home.watch"))}
          </button>
          <button class="btn-ghost" onclick="openSourceFromCard('anime','${src.id}')">${escapeHtml(t("home.browseSource"))}</button>
        </div>
      </div>
      ${bg ? `<div class="hf-poster"><img src="${bg}" alt=""></div>` : ""}
    </div>
    ${items.length > 1 ? rowWrap(t("home.trending") + " · " + src.name, items.slice(1, 15).map((m) => posterCard(src.id, "anime", m)).join("")) : ""}`;
}

function posterCard(sourceId, type, m) {
  return `
    <div class="card poster-card" onclick="openFromHome('${sourceId}','${type}','${encodeURIComponent(m.url)}','${encodeURIComponent(m.title || "")}')">
      ${m.thumbnail_url
        ? `<img loading="lazy" src="/api/v1/proxy?sourceId=${sourceId}&url=${encodeURIComponent(m.thumbnail_url)}">`
        : `<div class="card-img-placeholder">${escapeHtml((m.title || "?").charAt(0).toUpperCase())}</div>`}
      <div class="card-play">▶</div>
      <div class="card-title">${escapeHtml(m.title)}</div>
    </div>`;
}


function rowWrap(title, cards) {
  return `<div class="row"><div class="row-title">${escapeHtml(title)}</div><div class="row-scroll">${cards}</div></div>`;
}

function sourceCard(s) {
  const initials = (s.name || "?").charAt(0).toUpperCase();
  return `
    <div class="card" onclick="openSourceFromCard('${s.type}','${s.id}')">
      <div class="card-img-placeholder" style="background:linear-gradient(160deg, ${phColor(s.name)}, #1d1d26)">${escapeHtml(initials)}</div>
      <div class="card-title">${escapeHtml(s.name)}</div>
      <div class="card-sub">${escapeHtml((s.lang || "").toUpperCase())} · ${escapeHtml(s.type)}</div>
    </div>`;
}

function phColor(name) {
  const colors = ["#f47521", "#6fc3ff", "#9b7bf0", "#3ddc97", "#f7b733", "#e55d87", "#5b8def", "#ff9a9e"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function openSourceFromCard(type, id) {
  const list = type === "manga" ? state.sources.manga : state.sources.anime;
  const s = (list || []).find((x) => String(x.id) === String(id));
  if (s) openSource(s);
}

/* Opening a title from home (hero / trending row) must pin the source first,
   otherwise renderDetail falls back to whatever source was open before. */
function openFromHome(sourceId, type, encUrl, encTitle) {
  const list = type === "anime" ? (state.sources.anime || []) : (state.sources.manga || []);
  const s = (list || []).find((x) => String(x.id) === String(sourceId));
  if (s) state.activeSource = s;
  openEntry(sourceId, type, encUrl, null, encTitle);
}

function favCard(f) {
  const thumb = f.thumbnailUrl
    ? `<img loading="lazy" src="/api/v1/proxy?sourceId=${f.sourceId}&url=${encodeURIComponent(f.thumbnailUrl)}">`
    : `<div class="card-img-placeholder" style="background:#262631">${escapeHtml((f.title || "?").charAt(0).toUpperCase())}</div>`;
  return `
    <div class="card" onclick="openFavorite('${f.sourceId}','${f.type}','${encodeURIComponent(f.url)}')">
      ${thumb}
      <div class="card-title">${escapeHtml(f.title)}</div>
      ${f.lastReadName ? `<div class="card-sub fav-progress">▶ ${escapeHtml(f.lastReadName)}</div>` : ""}
    </div>`;
}


/* ---------------- Source picker: language filter + bookmarks ---------------- */

const LANGS_KEY = "aniyomi.langs";
const PIN_KEY = "aniyomi.pinned";
const LANG_LABELS = {
  en: "EN", ar: "AR", fr: "FR", es: "ES", pt: "PT", "pt-br": "PT-BR", de: "DE",
  it: "IT", tr: "TR", id: "ID", ru: "RU", hi: "HI", th: "TH", vi: "VI", zh: "ZH",
  ja: "JA", ko: "KO", all: "ALL", multi: "MULTI", other: "OTHER", ca: "CA",
  pl: "PL", uk: "UK", cs: "CS", el: "EL", he: "HE", fa: "FA", nl: "NL", ms: "MS",
  tl: "TL", sv: "SV", ro: "RO", hu: "HU", fi: "FI", bg: "BG", hr: "HR", sr: "SR",
  lt: "LT", lv: "LV", et: "ET", sk: "SK", sl: "SL", no: "NO", da: "DA",
};

function allowedLangs() {
  try {
    const v = JSON.parse(localStorage.getItem(LANGS_KEY) || "null");
    if (Array.isArray(v) && v.length) return v;
  } catch (e) { }
  return ["en", "ar"];
}
function setAllowedLangs(list) { localStorage.setItem(LANGS_KEY, JSON.stringify(list)); }
function langOk(lang) {
  const l = String(lang || "").toLowerCase();
  if (!l) return true;
  if (l === "all") return allowedLangs().includes("all");
  return allowedLangs().includes(l);
}
function allLangs(type) {
  const set = new Set();
  (state.sources[type] || []).forEach((s) => { const l = String(s.lang || "").toLowerCase(); if (l) set.add(l); });
  return [...set].sort((a, b) => (LANG_LABELS[a] || a).localeCompare(LANG_LABELS[b] || b));
}
function pinnedIds() {
  try { const v = JSON.parse(localStorage.getItem(PIN_KEY) || "[]"); return Array.isArray(v) ? v.map(String) : []; }
  catch (e) { return []; }
}
function isPinned(id) { return pinnedIds().includes(String(id)); }
function togglePin(id) {
  const was = isPinned(id);
  let list = pinnedIds().filter((x) => x !== String(id));
  if (!was) list = [String(id), ...list];
  localStorage.setItem(PIN_KEY, JSON.stringify(list));
  if (state.currentView === "browse" && state.activeSource) renderBrowseView(state.activeSource);
  else renderHome();
}
function sortSources(list) {
  const pins = pinnedIds();
  return [...list].sort((a, b) => {
    const pa = pins.indexOf(String(a.id)), pb = pins.indexOf(String(b.id));
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 9999 : pa) - (pb === -1 ? 9999 : pb);
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}
function sourcesFor(type) {
  return sortSources((state.sources[type] || []).filter((s) => langOk(s.lang)));
}
function switchSource(id) {
  const type = state.activeSource ? state.activeSource.type : "anime";
  const s = (state.sources[type] || []).find((x) => String(x.id) === String(id));
  if (s) renderBrowseView(s);
}
function toggleLang(l) {
  const allow = allowedLangs();
  const next = allow.includes(l) ? allow.filter((x) => x !== l) : [...allow, l];
  setAllowedLangs(next.length ? next : ["en"]);
  const type = state.activeSource ? state.activeSource.type : (state.typeFilter === "manga" ? "manga" : "anime");
  const list = sourcesFor(type);
  const still = list.find((s) => state.activeSource && String(s.id) === String(state.activeSource.id));
  if (state.currentView === "browse") renderBrowseView(still || list[0] || state.activeSource);
  else goBrowse(type);
}


/* ---------------- Searchable source picker ---------------- */

const SP = { items: [], shown: [], idx: 0, pick: null, open: false };

function spLabel(s) { return `${s.name} — ${(s.lang || "?").toUpperCase()}`; }

function spOpen(items, currentId) {
  SP.items = items;
  SP.open = true;
  SP.idx = Math.max(0, items.findIndex((s) => String(s.id) === String(currentId)));
  const pop = document.getElementById("spPop");
  if (!pop) return;
  pop.classList.add("on");
  const inp = document.getElementById("spSearch");
  if (inp) { inp.value = ""; setTimeout(() => inp.focus(), 20); }
  spRender("");
}

function spRender(q) {
  const list = document.getElementById("spList");
  if (!list) return;
  const needle = String(q || "").trim().toLowerCase();
  SP.shown = SP.items.filter((s) => !needle || spLabel(s).toLowerCase().includes(needle));
  if (SP.idx >= SP.shown.length) SP.idx = 0;
  list.innerHTML = SP.shown.length
    ? SP.shown.map((s, i) =>
        `<button class="sp-item ${i === SP.idx ? "on" : ""}" onmousedown="spPick(${i})">` +
        `<span>${isPinned(s.id) ? "★ " : ""}${escapeHtml(s.name)}</span>` +
        `<span class="sp-lang">${escapeHtml((s.lang || "").toUpperCase())}</span></button>`).join("")
    : `<div class="sp-empty">No source matches</div>`;
  const on = list.querySelector(".sp-item.on");
  if (on) on.scrollIntoView({ block: "nearest" });
}

function spFilter(q) { SP.idx = 0; spRender(q); }

function spPick(i) {
  const s = SP.shown[i];
  if (!s) return;
  spClose();
  if (SP.pick) SP.pick(s);
}

function spClose() {
  const p = document.getElementById("spPop");
  if (p) p.classList.remove("on");
  SP.open = false;
}

function spKeys(e) {
  if (e.key === "Escape") { e.stopPropagation(); spClose(); return; }
  if (e.key === "Enter") { e.preventDefault(); spPick(SP.idx); return; }
  const q = (document.getElementById("spSearch") || {}).value || "";
  if (e.key === "ArrowDown") { e.preventDefault(); SP.idx = Math.min(SP.idx + 1, SP.shown.length - 1); spRender(q); }
  if (e.key === "ArrowUp") { e.preventDefault(); SP.idx = Math.max(0, SP.idx - 1); spRender(q); }
}

function spToggleAnime() {
  const pop = document.getElementById("spPop");
  if (pop && pop.classList.contains("on")) { spClose(); return; }
  const type = state.activeSource ? state.activeSource.type : "anime";
  SP.pick = (s) => renderBrowseView(s);
  spOpen(sourcesFor(type), state.activeSource ? state.activeSource.id : null);
}

/* ---------------- Browse (source) ---------------- */

function openSource(source) {
  navPush(() => { setNav("home"); renderHome(); });
  renderBrowseView(source);
}

function renderBrowseView(source) {
  state.currentView = "browse";
  state.activeSource = source;
  try { localStorage.setItem("aniyomi.lastSource", String(source.id)); localStorage.setItem("aniyomi.lastSource:" + source.type, String(source.id)); } catch (e) { }
  setNav(source.type);
  const main = $("#content");
  const list = sourcesFor(source.type);
  const allow = allowedLangs();
  const chips = allLangs(source.type).map((l) =>
    `<button class="lang-chip ${allow.includes(l) ? "on" : ""}" onclick="toggleLang('${l}')">${escapeHtml(LANG_LABELS[l] || l.toUpperCase())}</button>`).join("");
  const pinned = isPinned(source.id);
  main.innerHTML = `
    <div class="mu-bar">
      <div class="src-wrap">
        <button type="button" class="src-btn" onclick="spToggleAnime()">
          <span class="src-btn-name">${isPinned(source.id) ? "★ " : ""}${escapeHtml(source.name)}</span>
          <span class="src-btn-lang">${escapeHtml((source.lang || "?").toUpperCase())}</span>
          <span class="src-caret">▾</span>
        </button>
        <div class="sp-pop" id="spPop">
          <input id="spSearch" class="sp-search" placeholder="Search source…" oninput="spFilter(this.value)" onkeydown="spKeys(event)">
          <div class="sp-list" id="spList"></div>
        </div>
      </div>
      <button class="pin-btn ${pinned ? "on" : ""}" title="${pinned ? "Remove bookmark" : "Bookmark this source"}" onclick="togglePin('${source.id}')">${pinned ? "\u2605" : "\u2606"}</button>
      <input type="text" id="searchInput" placeholder="${escapeHtml(t("toolbar.searchPh"))}">
      <button class="btn-primary" onclick="doSearch()">${escapeHtml(t("toolbar.search"))}</button>
    </div>
    <div class="lang-row">${chips}</div>
    <div class="browse-head">
      <div class="tab-pills">
        <button class="tab-pill active" onclick="loadPopular()">${escapeHtml(t("toolbar.popular"))}</button>
        <button class="tab-pill" onclick="loadLatest()">${escapeHtml(t("toolbar.latest"))}</button>
        <button class="tab-pill" onclick="openSourcePrefs()">${escapeHtml(t("toolbar.config"))}</button>
      </div>
    </div>
    <div id="catalog"><div class="loading">${escapeHtml(t("common.loading"))}</div></div>`;
  const box = $("#searchInput");
  if (box) box.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
  loadPopular();
}

async function loadPopular() { await loadGrid(`${api}/${state.activeSource.type}/${state.activeSource.id}/popular`, t("toolbar.popular")); }
async function loadLatest() { await loadGrid(`${api}/${state.activeSource.type}/${state.activeSource.id}/latest`, t("toolbar.latest")); }
async function doSearch() {
  const q = $("#searchInput")?.value.trim();
  if (!q) return loadPopular();
  await loadGrid(`${api}/${state.activeSource.type}/${state.activeSource.id}/search?query=${encodeURIComponent(q)}`, t("toolbar.search"));
}

function catalogCard(m) {
  const type = state.activeSource.type;
  return `
    <div class="card" onclick="openEntry('${state.activeSource.id}','${type}','${encodeURIComponent(m.url)}',null,'${encodeURIComponent(m.title || "")}')">
      ${m.thumbnail_url ? `<img loading="lazy" src="/api/v1/proxy?sourceId=${state.activeSource.id}&url=${encodeURIComponent(m.thumbnail_url)}">` : `<div class="card-img-placeholder">${escapeHtml((m.title || "?").charAt(0).toUpperCase())}</div>`}
      <div class="card-title">${escapeHtml(m.title)}</div>
    </div>`;
}

async function loadGrid(url, title) {
  const box = $("#catalog");
  if (!box) return;
  state.catalog = { url, page: 1, hasNext: true, loading: false, error: false, errorMsg: "", seen: new Set() };
  box.innerHTML = `<div class="row-title">${escapeHtml(title)}</div>` +
    `<div class="row-scroll" id="catalogGrid"></div><div id="catSentinel" class="cat-sentinel"></div>`;
  await loadMore();
  if (state.catalog && !state.catalog.loading) {
    const grid = $("#catalogGrid");
    if (grid && grid.children.length === 0) {
      if (state.catalog.error) box.innerHTML = `<div class="error">${escapeHtml(t("common.error", state.catalog.errorMsg))}</div>`;
      else box.innerHTML = `<div class="empty">${escapeHtml(t("common.noResults"))}</div>`;
      state.catalog = null;
    }
  }
}

async function loadMore() {
  const c = state.catalog;
  const grid = $("#catalogGrid");
  const sentinel = $("#catSentinel");
  if (!c || !grid || c.loading || !c.url) return;
  c.loading = true;
  if (sentinel) sentinel.innerHTML = `<div class="loading">${escapeHtml(t("common.loading"))}</div>`;
  const sep = c.url.includes("?") ? "&" : "?";
  let ok = false;
  try {
    const data = await getJSON(`${c.url}${sep}page=${c.page}`);
    const list = data.mangas || data.animes || [];
    const newItems = list.filter((m) => {
      if (!m.url || c.seen.has(m.url)) return false;
      c.seen.add(m.url);
      return true;
    });
    if (newItems.length) grid.insertAdjacentHTML("beforeend", newItems.map(catalogCard).join(""));
    c.page++;
    c.hasNext = data.hasNextPage === true && list.length > 0 && newItems.length > 0;
    ok = true;
  } catch (e) {
    c.error = true;
    c.errorMsg = e.message;
    if (sentinel) sentinel.innerHTML = `<div class="error">${escapeHtml(t("common.error", e.message))}</div>`;
  }
  c.loading = false;
  if (!ok) return;
  const content = $("#content");
  const atBottom = !!content && (content.scrollTop + content.clientHeight >= content.scrollHeight - 700);
  if (c.hasNext && atBottom) {
    loadMore();
  } else if (sentinel) {
    sentinel.innerHTML = c.hasNext
      ? ""
      : (grid.children.length ? `<div class="end-msg">${escapeHtml(t("toolbar.end"))}</div>` : "");
  }
}

function onContentScroll() {
  const c = state.catalog;
  if (!c || !c.url || c.loading || !c.hasNext || !$("#catalogGrid")) return;
  const content = $("#content");
  if (!content) return;
  if (content.scrollTop + content.clientHeight >= content.scrollHeight - 700) loadMore();
}

/* ---------------- Detail ---------------- */

async function openEntry(sourceId, type, url, backTo, encTitle) {
  navPush(backTo || (() => { if (state.activeSource) renderBrowseView(state.activeSource); }));
  const main = $("#content");
  main.innerHTML = `<div class="loading">${escapeHtml(t("common.loading"))}</div>`;
  let d = null;
  try {
    d = await getJSON(`${api}/${type}/${sourceId}/details?url=${url}${encTitle ? "&title=" + encTitle : ""}`);
  } catch (e) {
    const dec = decodeURIComponent(url);
    d = { url: dec, title: dec.split("/").pop() || t("detail.entry") };
  }
  renderDetail(type, d);
}

async function renderDetail(type, d) {
  state.currentView = "detail";
  const main = $("#content");
  state.detailObj = d;
  state.detail = { type, url: d.url || "", title: d.title || t("detail.entry"), thumb: d.thumbnail_url || "" };
  const thumb = d.thumbnail_url ? `src="/api/v1/proxy?sourceId=${state.activeSource.id}&url=${encodeURIComponent(d.thumbnail_url)}"` : "";
  const bg = d.thumbnail_url ? `style="background-image:url('/api/v1/proxy?sourceId=${state.activeSource.id}&url=${encodeURIComponent(d.thumbnail_url)}')"` : "";
  main.innerHTML = `
    <button class="btn-ghost" onclick="goBack()" style="margin-bottom:12px">← ${escapeHtml(t("reader.back"))}</button>
    <div class="detail-hero">
      <div class="hero-bg" ${bg}></div>
      <div class="detail-body">
        ${d.thumbnail_url ? `<img class="detail-cover" ${thumb}>` : ""}
        <div class="detail-info">
          <h1>${escapeHtml(d.title || t("detail.entry"))}</h1>
          <div class="meta">${d.author ? escapeHtml(t("detail.author", d.author)) + "<br>" : ""}${statusText(d.status)}</div>
          <button id="favBtn" class="fav-btn" data-fav="0" onclick="toggleFavorite(this)">${escapeHtml(t("fav.add"))}</button>
          <div class="desc">${escapeHtml(d.description || "")}</div>
        </div>
      </div>
    </div>
    <div id="entryList"><div class="loading">${escapeHtml(t("detail.loadingList"))}</div></div>`;

  try {
    const chk = await getJSON(`${api}/favorites/check?sourceId=${state.activeSource.id}&url=${encodeURIComponent(d.url || "")}`);
    const btn = $("#favBtn");
    if (btn && chk.ok) { btn.dataset.fav = "1"; btn.classList.add("on"); btn.textContent = t("fav.in"); }
  } catch (e) { }

  const url = encodeURIComponent(d.url);
  if (type === "manga") {
    const data = await getJSON(`${api}/manga/${state.activeSource.id}/chapters?url=${url}&title=${encodeURIComponent(d.title || "")}`);
    const items = (data.chapters || []).map((c, i) => `
      <div class="ep-card" onclick="openChapter('${encodeURIComponent(c.url)}','${escapeHtml(c.name)}')">
        <div class="ep-thumb">
          <span class="ep-num">#${i + 1}</span>
          <img class="ep-thumb-img" data-ch="${encodeURIComponent(c.url)}" alt="">
        </div>
        <div class="ep-name">${escapeHtml(c.name)}</div>
        ${c.scanlator ? `<div class="ep-meta">${escapeHtml(c.scanlator)}</div>` : ""}
      </div>`).join("");
    $("#entryList").innerHTML = `<div class="list-title">${escapeHtml(t("detail.chapters"))}</div>` +
      (items ? `<div class="ep-grid">${items}</div>` : `<div class="empty">${escapeHtml(t("detail.noChapters"))}</div>`);
    document.querySelectorAll("#entryList .ep-thumb-img").forEach((img) => {
      const enc = img.dataset.ch;
      const cache = getThumbCache();
      if (enc && cache[`${state.activeSource.id}:${enc}`]) {
        img.src = proxyImg(cache[`${state.activeSource.id}:${enc}`]);
        img.classList.add("ready");
      } else if (thumbObserver) {
        thumbObserver.observe(img);
      } else {
        enqueueThumb(img);
      }
    });
  } else {
    state.episodes = [];
    const data = await getJSON(`${api}/anime/${state.activeSource.id}/episodes?url=${url}&title=${encodeURIComponent(d.title || "")}`);
    state.episodes = data.episodes || [];
    renderAnimeEpisodes(d, state.episodes);
  }
}

async function toggleFavorite(btn) {
  const s = state.activeSource;
  const d = state.detail;
  if (!s || !d) return;
  const isFav = btn.dataset.fav === "1";
  try {
    if (isFav) {
      await fetch(`${api}/favorites?sourceId=${s.id}&url=${encodeURIComponent(d.url)}`, { method: "DELETE" });
      btn.dataset.fav = "0";
      btn.classList.remove("on");
      btn.textContent = t("fav.add");
    } else {
      const res = await fetch(`${api}/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: String(s.id), url: d.url, title: d.title, thumbnailUrl: d.thumb || null, type: d.type }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { alert(t("fav.saveError", data.error || t("common.unknown"))); return; }
      btn.dataset.fav = "1";
      btn.classList.add("on");
      btn.textContent = t("fav.in");
    }
  } catch (e) {
    alert(t("common.error", e.message));
  }
}

/* ---------------- Favorites ---------------- */

async function showFavorites() {
  closeMangaReader();
  state.currentView = "favorites";
  setNav("favorites");
  const main = $("#content");
  main.innerHTML = `<div class="loading">${escapeHtml(t("fav.loading"))}</div>`;
  try {
    const favs = await getJSON(`${api}/favorites`);
    if (!favs || favs.length === 0) {
      main.innerHTML = `<div class="empty"><h2>${escapeHtml(t("fav.emptyTitle"))}</h2><p>${escapeHtml(t("fav.emptyText"))}</p></div>`;
      return;
    }
    const byType = { manga: [], anime: [] };
    for (const f of favs) (byType[f.type] || (byType[f.type] = [])).push(f);
    let html = "";
    for (const [type, list] of Object.entries(byType)) {
      if (!list || !list.length) continue;
      html += rowWrap(type === "manga" ? t("nav.manga") : t("nav.anime"), list.map((f) => favCard(f)).join(""));
    }
    main.innerHTML = html || `<div class="empty">${escapeHtml(t("fav.emptyTitle"))}</div>`;
  } catch (e) {
    main.innerHTML = `<div class="error">${escapeHtml(t("common.error", e.message))}</div>`;
  }
}

function openFavorite(sourceId, type, url) {
  state.activeSource = { id: sourceId, type, name: "" };
  openEntry(sourceId, type, url, () => { setNav("favorites"); showFavorites(); });
}

/* ---------------- Reader ---------------- */

async function openChapter(encUrl, name) {
  state.currentView = "reader";
  navPush(() => { if (state.detail) renderDetail(state.detail.type, state.detailObj); });
  const main = $("#content");
  main.innerHTML = `<div class="loading">${escapeHtml(t("reader.loadingPages"))}</div>`;
  try {
    const data = await getJSON(`${api}/manga/${state.activeSource.id}/pages?url=${encUrl}&name=${encodeURIComponent(name || "")}`);
    const pages = data.pages;
    if (!pages || pages.length === 0) { main.innerHTML = `<div class="error">${escapeHtml(t("reader.noPages"))}</div>`; return; }

    if (state.detail && state.detail.url) {
      try {
        await fetch(`${api}/favorites/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceId: String(state.activeSource.id),
            url: state.detail.url,
            lastReadUrl: decodeURIComponent(encUrl),
            lastReadName: name,
          }),
        });
      } catch (e) { }
    }
    main.innerHTML = `
      <div class="reader-top">
        <button class="btn-ghost" onclick="goBack()">← ${escapeHtml(t("reader.back"))}</button>
        <h2 style="margin:0">${escapeHtml(name)}</h2>
      </div>
      <div class="viewer" id="viewer">
        ${pages.map((p) => `
          <img loading="lazy" src="/api/v1/proxy?sourceId=${state.activeSource.id}&url=${encodeURIComponent(p.imageUrl || "")}">`).join("")}
      </div>`;
  } catch (e) {
    main.innerHTML = `<div class="error">${escapeHtml(t("common.error", e.message))}</div>`;
  }
}

/* ---------------- Player helpers / order / watch ---------------- */

function episodeOrder() {
  return localStorage.getItem("miwayomi.episodeOrder") || "newest";
}
function setEpisodeOrder(o) {
  localStorage.setItem("miwayomi.episodeOrder", o);
}
function sortEpisodes(list) {
  const arr = (list || []).slice();
  const hasNum = arr.some((e) => e.episode_number != null && e.episode_number !== 0);
  if (hasNum) arr.sort((a, b) => (Number(a.episode_number) || 0) - (Number(b.episode_number) || 0));
  return episodeOrder() === "oldest" ? arr : arr.reverse();
}
function toggleDetailOrder() {
  setEpisodeOrder(episodeOrder() === "oldest" ? "newest" : "oldest");
  if (state.detailObj && state.episodes) renderAnimeEpisodes(state.detailObj, state.episodes);
}
function togglePlayerOrder() {
  setEpisodeOrder(episodeOrder() === "oldest" ? "newest" : "oldest");
  renderPlayerEpisodes(state.episodes || [], state.currentEncUrl);
}
function setAutoPlay(v) { localStorage.setItem("miwayomi.autoPlayNext", v ? "1" : "off"); }
function setAutoSource(v) { localStorage.setItem("miwayomi.autoSource", v ? "1" : "off"); }

function renderAnimeEpisodes(d, eps) {
  const list = sortEpisodes(eps || []);
  const orderLabel = episodeOrder() === "oldest" ? t("player.orderOldest") : t("player.orderNewest");
  const epThumb = (e) => {
    if (e.preview_url) return `<img class="ep-thumb-img ready" src="/api/v1/proxy?sourceId=${state.activeSource.id}&url=${encodeURIComponent(e.preview_url)}">`;
    if (d && d.thumbnail_url) return `<img class="ep-thumb-img ready" src="/api/v1/proxy?sourceId=${state.activeSource.id}&url=${encodeURIComponent(d.thumbnail_url)}">`;
    return "";
  };
  const items = list.map((e, i) => `
    <div class="ep-card" onclick="openEpisode('${encodeURIComponent(e.url)}','${escapeHtml(e.name)}')">
      <div class="ep-thumb">
        <span class="ep-num">E${e.episode_number ?? i + 1}</span>
        ${epThumb(e)}
      </div>
      <div class="ep-name">${escapeHtml(e.name)}</div>
    </div>`).join("");
  $("#entryList").innerHTML = `<div class="list-title">${escapeHtml(t("detail.episodes"))}
      <button class="order-btn" onclick="toggleDetailOrder()" title="${escapeHtml(t("player.orderHint"))}">${escapeHtml(t("player.orderIcon"))} ${escapeHtml(orderLabel)}</button>
    </div>` +
    (items ? `<div class="ep-grid">${items}</div>` : `<div class="empty">${escapeHtml(t("detail.noEpisodes"))}</div>`);
}

function pickBestVideo(videos) {
  let best = 0, bestRes = -1;
  (videos || []).forEach((v, i) => {
    const res = parseInt(v.resolution, 10) || 0;
    if (res > bestRes) { bestRes = res; best = i; }
  });
  return best;
}

function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = m < 10 ? "0" + m : "" + m;
  const ss = sec < 10 ? "0" + sec : "" + sec;
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

let toastTimer = null;
function toast(msg) {
  const el = $("#resumeToast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { const x = $("#resumeToast"); if (x) x.classList.add("hidden"); }, 4000);
}

/* ---------------- Watch history / resume (server DB) ---------------- */

function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
function watchEntryKey(sourceId, animeUrl, epUrl) { return `${sourceId}|||${animeUrl}|||${epUrl}`; }
function currentWatchEntry() {
  if (!state.activeSource || !state.detail || !state.currentEncUrl) return null;
  const key = watchEntryKey(state.activeSource.id, safeDecode(state.detail.url), safeDecode(state.currentEncUrl));
  return { key, sourceId: String(state.activeSource.id), type: "anime", animeUrl: safeDecode(state.detail.url),
    epUrl: safeDecode(state.currentEncUrl), animeTitle: state.detail.title || "",
    epName: state.currentEpName || "", thumb: state.detail.thumb || "", time: 0, duration: 0,
    updatedAt: Date.now(), completed: false, episodeNumber: state.currentEpNumber != null ? state.currentEpNumber : null };
}

let watchCache = null;
let watchCacheAt = 0;
async function loadWatchCache(force) {
  if (watchCache !== null && !force && Date.now() - watchCacheAt < 20000) return watchCache;
  try {
    const res = await fetch(`${api}/watch`);
    if (res.ok) { watchCache = await res.json(); watchCacheAt = Date.now(); }
  } catch (e) { }
  return watchCache || [];
}
function savedWatchFor(sourceId, animeUrl, epUrl) {
  const key = watchEntryKey(sourceId, animeUrl, epUrl);
  return (watchCache || []).find((w) => watchEntryKey(w.sourceId, w.animeUrl, w.epUrl) === key) || null;
}
function upsertWatchCache(w) {
  watchCache = watchCache || [];
  const key = watchEntryKey(w.sourceId, w.animeUrl, w.epUrl);
  const i = watchCache.findIndex((x) => watchEntryKey(x.sourceId, x.animeUrl, x.epUrl) === key);
  const entry = { sourceId: w.sourceId, animeUrl: w.animeUrl, epUrl: w.epUrl, animeTitle: w.animeTitle,
    epName: w.epName, thumb: w.thumb, timeSeconds: w.time, durationSeconds: w.duration,
    updatedAt: w.updatedAt, completed: w.completed || false, episodeNumber: w.episodeNumber };
  if (i >= 0) watchCache[i] = Object.assign({}, watchCache[i], entry);
  else watchCache.unshift(entry);
  watchCache = watchCache.slice(0, 40);
}
function removeWatchCache(w) {
  watchCache = (watchCache || []).filter((x) => watchEntryKey(x.sourceId, x.animeUrl, x.epUrl) !== watchEntryKey(w.sourceId, w.animeUrl, w.epUrl));
}

async function saveWatchProgress(time, duration) {
  const e = currentWatchEntry(); if (!e) return;
  e.time = Math.max(0, time || 0); e.duration = duration || 0;
  e.updatedAt = Date.now();
  upsertWatchCache(e);
  try {
    await fetch(`${api}/watch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: e.sourceId, animeUrl: e.animeUrl, epUrl: e.epUrl,
        animeTitle: e.animeTitle, epName: e.epName, thumb: e.thumb,
        timeSeconds: e.time, durationSeconds: e.duration, completed: e.completed,
        episodeNumber: e.episodeNumber,
      }),
    });
    syncToAniList(e);
  } catch (err) { }
}
async function clearWatchProgress() {
  const e = currentWatchEntry(); if (!e) return;
  removeWatchCache(e);
  try {
    await fetch(`${api}/watch?sourceId=${encodeURIComponent(e.sourceId)}&animeUrl=${encodeURIComponent(e.animeUrl)}&epUrl=${encodeURIComponent(e.epUrl)}`, { method: "DELETE" });
  } catch (err) { }
}
// "Continue watching" shows ONE card per anime, not one per episode. The list
// is already ordered by most-recently-watched, so keep the first (latest)
// entry per anime and skip repeats of the same title. Trailing slashes are
// stripped so harmless URL variations never create duplicates.
function dedupeWatchByAnime(list, max) {
  const seen = new Set();
  const out = [];
  for (const w of list || []) {
    const key = watchEntryKey(w.sourceId, (w.animeUrl || "").replace(/\/+$/, ""), "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (max != null && out.length >= max) break;
  }
  return out;
}
async function listWatch() {
  const list = await loadWatchCache();
  return dedupeWatchByAnime((list || []).filter((w) => w && w.epUrl), 12);
}
function watchCard(w) {
  const pct = w.durationSeconds ? Math.min(100, Math.round((w.timeSeconds / w.durationSeconds) * 100)) : 0;
  const thumb = w.thumb
    ? `<img loading="lazy" src="/api/v1/proxy?sourceId=${w.sourceId}&url=${encodeURIComponent(w.thumb)}">`
    : `<div class="card-img-placeholder">${escapeHtml((w.animeTitle || "?").charAt(0).toUpperCase())}</div>`;
  return `
    <div class="card watch-card" onclick="openWatch('${w.sourceId}','${encodeURIComponent(w.animeUrl)}','${encodeURIComponent(w.epUrl)}','${escapeHtml(w.epName)}')">
      ${thumb}
      <div class="card-title">${escapeHtml(w.animeTitle)}</div>
      <div class="card-sub watch-sub">${escapeHtml(w.epName)}</div>
      <div class="watch-bar"><div class="watch-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
}
async function openWatch(sourceId, animeUrl, epUrl, epName) {
  navPush(() => { setNav("home"); renderHome(); });
  state.activeSource = { id: sourceId, type: "anime", name: "" };
  const main = $("#content");
  main.innerHTML = `<div class="loading">${escapeHtml(t("common.loading"))}</div>`;
  try {
    const d = await getJSON(`${api}/anime/${sourceId}/details?url=${encodeURIComponent(safeDecode(animeUrl))}`);
    await renderDetail("anime", d);
    openEpisode(encodeURIComponent(safeDecode(epUrl)), epName, true);
  } catch (e) {
    main.innerHTML = `<div class="error">${escapeHtml(t("common.error", e.message))}</div>`;
  }
}

function nextEpisode() {
  const eps = sortEpisodes(state.episodes || []);
  if (!eps.length || !state.currentEncUrl) return null;
  const cur = decodeURIComponent(state.currentEncUrl);
  const idx = eps.findIndex((e) => decodeURIComponent(e.url) === cur);
  if (idx < 0 || idx >= eps.length - 1) return null;
  return eps[idx + 1];
}
function attemptPlay(video) {
  if (!video) return;
  const p = video.play && video.play();
  if (p && p.catch) p.catch(() => { });
}
function maybeResume(video) {
  const e = currentWatchEntry();
  if (!e) return;
  const saved = savedWatchFor(e.sourceId, e.animeUrl, e.epUrl);
  if (!saved) return;
  const savedTime = saved.timeSeconds || 0;
  const savedDur = saved.durationSeconds || 0;
  const nearEnd = savedDur > 0 && savedTime > savedDur - 15;
  if (savedTime < 10 || nearEnd) return;
  const sec = savedTime;
  const doResume = () => {
    try { if (!video.currentTime || video.currentTime < sec - 2) video.currentTime = sec; } catch (_) { }
    attemptPlay(video);
  };
  if (video.readyState >= 1) doResume();
  else video.addEventListener("loadedmetadata", doResume, { once: true });
  toast(t("player.resuming", fmtTime(sec)));
}
function bindVideoEvents(video) {
  if (video.__bound) return;
  video.__bound = true;
  let lastSave = 0;
  video.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - lastSave < 3000) return;
    lastSave = now;
    saveWatchProgress(video.currentTime, video.duration);
  });
  video.addEventListener("pause", () => saveWatchProgress(video.currentTime, video.duration));
  video.addEventListener("ended", () => {
    clearWatchProgress();
    if (localStorage.getItem("miwayomi.autoPlayNext") !== "off") {
      const nx = nextEpisode();
      if (nx) openEpisode(encodeURIComponent(nx.url), nx.name, true);
    }
  });
}
function restartEpisode() {
  const e = currentWatchEntry();
  if (e) clearWatchProgress();
  const x = $("#resumeToast"); if (x) x.classList.add("hidden");
  const v = $("#videoPlayer");
  if (v) { try { v.currentTime = 0; } catch (_) { } attemptPlay(v); }
}

/* ---------------- AniList sync ---------------- */

const ANILIST_API = "https://graphql.anilist.co/graphql";
function anilistClientId() { return (localStorage.getItem("miwayomi.anilist.clientId") || "").trim(); }
function anilistToken() { return localStorage.getItem("miwayomi.anilist.token") || ""; }
function anilistSyncOn() { return localStorage.getItem("miwayomi.anilist.sync") !== "off"; }
function anilistMediaCache() { try { return JSON.parse(localStorage.getItem("miwayomi.anilist.media") || "{}"); } catch (e) { return {}; } }
function anilistSaveMediaCache(c) { try { localStorage.setItem("miwayomi.anilist.media", JSON.stringify(c)); } catch (e) { } }

async function anilistGraphql(query, vars) {
  const res = await fetch(ANILIST_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": "Bearer " + anilistToken() },
    body: JSON.stringify({ query, variables: vars }),
  });
  if (!res.ok) throw new Error("AniList HTTP " + res.status);
  return res.json();
}

async function anilistUsername() {
  try {
    const d = await anilistGraphql("query { Viewer { name } }", {});
    return d && d.data && d.data.Viewer ? d.data.Viewer.name : null;
  } catch (e) { return null; }
}

async function syncToAniList(entry) {
  if (!anilistSyncOn()) return;
  if (!anilistToken()) return;
  if (!entry || !entry.episodeNumber || !entry.animeTitle) return;
  try {
    const cache = anilistMediaCache();
    const mkey = `${entry.sourceId}|||${entry.animeUrl}`;
    let mediaId = cache[mkey];
    if (!mediaId) {
      const s = await anilistGraphql("query($s: String) { Media(search: $s, type: ANIME) { id } }", { s: entry.animeTitle });
      const media = s && s.data && s.data.Media;
      if (!media || !media.id) return;
      mediaId = media.id;
      cache[mkey] = mediaId;
      anilistSaveMediaCache(cache);
    }
    let synced = {};
    try { synced = JSON.parse(localStorage.getItem("miwayomi.anilist.synced") || "{}"); } catch (e) { }
    if ((synced[mkey] || 0) >= entry.episodeNumber) return;
    const status = entry.completed ? "COMPLETED" : "CURRENT";
    await anilistGraphql(
      "mutation($id: Int, $p: Int, $st: MediaListStatus) { SaveMediaListEntry(mediaId: $id, progress: $p, status: $st) { id progress } }",
      { id: mediaId, p: entry.episodeNumber, st: status },
    );
    synced[mkey] = entry.episodeNumber;
    localStorage.setItem("miwayomi.anilist.synced", JSON.stringify(synced));
  } catch (e) {
    console.log("[miwayomi] AniList sync failed: " + e.message);
  }
}

function connectAniList() {
  const cid = anilistClientId();
  if (!cid) { alert(t("anilist.needClientId")); return; }
  const redirect = encodeURIComponent(location.origin + "/index.html");
  const url = `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(cid)}&response_type=token&redirect_uri=${redirect}`;
  window.open(url, "_blank", "width=520,height=720");
}

function disconnectAniList() {
  localStorage.removeItem("miwayomi.anilist.token");
  localStorage.removeItem("miwayomi.anilist.media");
  localStorage.removeItem("miwayomi.anilist.synced");
  refreshAniListUi();
  toast(t("anilist.disconnected"));
}

async function refreshAniListUi() {
  const status = $("#anilistStatus");
  if (!status) return;
  const cid = anilistClientId();
  const token = anilistToken();
  if (!cid) { status.innerHTML = `<span class="anilist-off">${escapeHtml(t("anilist.noClient"))}</span>`; return; }
  if (!token) { status.innerHTML = `<span class="anilist-off">${escapeHtml(t("anilist.notConnected"))}</span>`; return; }
  const name = await anilistUsername();
  status.innerHTML = name
    ? `<span class="anilist-on">${escapeHtml(t("anilist.connectedAs", name))}</span>`
    : `<span class="anilist-off">${escapeHtml(t("anilist.tokenInvalid"))}</span>`;
}

function setAniListSync(v) { localStorage.setItem("miwayomi.anilist.sync", v ? "1" : "off"); }
function setAniListClientId(v) {
  localStorage.setItem("miwayomi.anilist.clientId", v);
  refreshAniListUi();
}

function handleAniListHash() {
  const h = location.hash || "";
  if (!h.includes("access_token=")) return;
  const params = new URLSearchParams(h.replace(/^#/, ""));
  const token = params.get("access_token");
  if (token) {
    localStorage.setItem("miwayomi.anilist.token", token);
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; }
    refreshAniListUi();
    toast(t("anilist.connected"));
  }
}

/* ---------------- Player ---------------- */

async function openEpisode(encUrl, name, noPush) {
  state.currentView = "player";
  if (!noPush) navPush(() => { if (state.detail) renderDetail(state.detail.type, state.detailObj); });
  state.currentEncUrl = encUrl;
  state.currentEpName = name || "";
  const main = $("#content");
  main.innerHTML = `<div class="loading">${escapeHtml(t("player.fetching"))}</div>`;
  try {
    let eps = [];
    if (state.detail && state.detail.url) {
      try {
        const e = await getJSON(`${api}/anime/${state.activeSource.id}/episodes?url=${encodeURIComponent(state.detail.url)}&title=${encodeURIComponent(state.detail.title || "")}`);
        eps = e.episodes || [];
      } catch (err) { }
    }
    state.episodes = eps;
    const curEp = (eps || []).find((e) => decodeURIComponent(e.url) === decodeURIComponent(encUrl));
    let vq = "";
    if (curEp) {
      vq = `&name=${encodeURIComponent(curEp.name || "")}&episode_number=${encodeURIComponent(curEp.episode_number ?? -1)}`;
      if (curEp.scanlator) vq += `&scanlator=${encodeURIComponent(curEp.scanlator)}`;
      if (curEp.date_upload) vq += `&date_upload=${encodeURIComponent(curEp.date_upload)}`;
    } else if (name) {
      vq = `&name=${encodeURIComponent(name)}`;
    }
    const data = await getJSON(`${api}/anime/${state.activeSource.id}/videos?url=${encUrl}${vq}`);
    const videos = data.videos || [];
    if (!videos || videos.length === 0) { main.innerHTML = `<div class="error">${escapeHtml(t("player.noVideos"))}</div>`; return; }
    window.__videos = videos;
    state.currentEpNumber = curEp && curEp.episode_number != null ? curEp.episode_number : null;
    await loadWatchCache();

    const autoNext = localStorage.getItem("miwayomi.autoPlayNext") !== "off";
    const autoSrc = localStorage.getItem("miwayomi.autoSource") !== "off";

    main.innerHTML = `
      <div class="player-wrap cinema">
        <div class="player-main">
          <div class="ps" id="ps">
            <video id="videoPlayer" playsinline preload="metadata"></video>
            <div class="ps-top" id="psTop">
              <button class="ps-back" onclick="goBack()">←</button>
              <div class="ps-meta">
                <div class="ps-t1">${escapeHtml(name || "")}</div>
                <div class="ps-t2">${escapeHtml((state.activeSource && state.activeSource.name) || "")}</div>
              </div>
            </div>
            <button class="ps-center" id="psCenter" onclick="psToggle()">▶</button>
            <div class="ps-spinner" id="psSpin"></div>
            <div class="ps-bar">
              <div class="ps-seek" id="psSeek">
                <div class="ps-track"><div class="ps-buf" id="psBuf"></div><div class="ps-fill" id="psFill"></div><div class="ps-dot" id="psDot"></div></div>
                <div class="ps-tip" id="psTip"></div>
              </div>
              <div class="ps-row">
                <button class="ps-ic" id="psPlay" onclick="psToggle()">▶</button>
                <button class="ps-ic" onclick="psSeekBy(-10)" title="-10s">↺</button>
                <button class="ps-ic" onclick="psSeekBy(10)" title="+10s">↻</button>
                <button class="ps-ic" id="psNextBtn" onclick="psNext()" title="${escapeHtml(t("player.next"))}">⏭</button>
                <div class="ps-time"><span id="psCur">0:00</span><span class="ps-sep">/</span><span id="psDur">0:00</span></div>
                <div class="ps-grow"></div>
                <button class="ps-ic" id="psVol" onclick="psMute()" title="${escapeHtml(t("player.mute"))}">🔊</button>
                <button class="ps-ic" id="psSpeed" onclick="psMenu('speed')">1×</button>
                <button class="ps-ic" id="psCaps" onclick="psMenu('subs')">CC</button>
                <button class="ps-ic" onclick="psMenu('quality')" title="${escapeHtml(t("player.sources"))}">⚙</button>
                <button class="ps-ic" onclick="psLaunchMpv()" title="mpv">▣</button>
                <button class="ps-ic" onclick="psFullscreen()" title="${escapeHtml(t("player.fullscreen"))}">⛶</button>
              </div>
            </div>
            <div class="ps-panel" id="psPanel"></div>
            <div class="ps-toast" id="psToast"></div>
          </div>
          <div class="ps-strip">
            <span id="playingLabel" class="ps-src-label">${escapeHtml(t("player.select"))}</span>
            <span id="qualityBtns"></span>
            <button class="ps-chip" onclick="restartEpisode()" title="${escapeHtml(t("player.restart"))}">↺ ${escapeHtml(t("player.restartShort"))}</button>
            <span class="ps-grow"></span>
            <label class="pctl"><input type="checkbox" id="autoPlayCb" ${autoNext ? "checked" : ""} onchange="setAutoPlay(this.checked)"> ${escapeHtml(t("player.autoNext"))}</label>
            <label class="pctl"><input type="checkbox" id="autoSrcCb" ${autoSrc ? "checked" : ""} onchange="setAutoSource(this.checked)"> ${escapeHtml(t("player.autoSource"))}</label>
          </div>
          <div id="resumeToast" class="resume-toast hidden"></div>
        </div>
        <div class="player-episodes" id="playerEpisodes"></div>
      </div>`;

    renderQuality(videos);
    renderPlayerEpisodes(eps, encUrl);
    psInit();
    psBuildSubs();
    if (videos.length > 1) { const nb = $("#psNextBtn"); if (nb) nb.style.display = nextEpisode() ? "" : "none"; }
    if (autoSrc) {
      playVideo(pickBestVideo(videos));
      attemptPlay($("#videoPlayer"));
    } else if (videos.length === 1) playVideo(0);
  } catch (e) {
    main.innerHTML = `<div class="error">${escapeHtml(t("common.error", e.message))}</div>`;
  }
}

function renderQuality(videos) {
  const wrap = $("#qualityBtns");
  if (!wrap) return;
  const first = videos[0] || {};
  const title = first.videoTitle || (first.resolution ? first.resolution + "p" : t("player.video", 1));
  wrap.innerHTML = `<button class="ps-chip src-pick" data-i="0" onclick="psMenu('quality')" title="${escapeHtml(t("player.sources"))}">` +
    `<span class="src-label">${escapeHtml(t("player.source"))}</span>` +
    `<span class="src-name">${escapeHtml(title)}</span><span class="src-count">${videos.length}</span></button>`;
}
function setQualityActive(i) {
  const btn = document.querySelector("#qualityBtns .src-pick");
  const v = (window.__videos || [])[i];
  if (!btn || !v) return;
  btn.dataset.i = String(i);
  const name = btn.querySelector(".src-name");
  if (name) name.textContent = v.videoTitle || (v.resolution ? v.resolution + "p" : t("player.video", i + 1));
}

function renderPlayerEpisodes(eps, currentEnc) {
  const box = $("#playerEpisodes");
  if (!box) return;
  const list = sortEpisodes(eps || []);
  const orderLabel = episodeOrder() === "oldest" ? t("player.orderOldest") : t("player.orderNewest");
  box.innerHTML = `<div class="list-title">${escapeHtml(t("detail.episodes"))}
      <button class="order-btn" onclick="togglePlayerOrder()" title="${escapeHtml(t("player.orderHint"))}">${escapeHtml(t("player.orderIcon"))} ${escapeHtml(orderLabel)}</button>
    </div>` +
    (list.length ? list.map((e, i) => `
      <div class="player-episode ${decodeURIComponent(currentEnc) === decodeURIComponent(e.url) ? "active" : ""}" onclick="openEpisode('${encodeURIComponent(e.url)}','${escapeHtml(e.name)}',true)">
        <span class="pe-num">E${e.episode_number ?? i + 1}</span><span>${escapeHtml(e.name)}</span>
      </div>`).join("") : `<div class="empty">${escapeHtml(t("detail.noEpisodes"))}</div>`);
}

function playVideo(i) {
  const videos = window.__videos || [];
  const v = videos[i];
  if (!v) return;
  const headers = v.headers ? Object.entries(v.headers).map(([k, val]) => `${k}: ${val}`).join("\n") : "";
  const url = encodeURIComponent(v.videoUrl || "");
  const headersEnc = encodeURIComponent(headers);
  const proxyBase = `/api/v1/proxy?sourceId=${state.activeSource.id}&url=${url}&headers=${headersEnc}`;
  const hlsProxy = `/api/v1/hls?sourceId=${state.activeSource.id}&url=${url}&headers=${headersEnc}`;
  const dashProxy = `/api/v1/dash?sourceId=${state.activeSource.id}&url=${url}&headers=${headersEnc}`;
  const label = $("#playingLabel");
  if (label) label.textContent = t("player.playing", v.videoTitle || t("player.video"));
  const video = $("#videoPlayer");
  if (!video) return;
  video.dataset.index = String(i);
  try { video.playbackRate = PS.speed || 1; } catch (_) { }
  if (typeof psBuildSubs === "function") psBuildSubs();
  setQualityActive(i);
  bindVideoEvents(video);
  maybeResume(video);
  const videoUrl = v.videoUrl || "";
  const isHls = videoUrl.includes(".m3u8");
  const isDash = videoUrl.includes(".mpd");
  video.dataset.proxy = isHls ? hlsProxy : (isDash ? dashProxy : proxyBase);

  if (isDash && window.dashjs) {
    const player = dashjs.MediaPlayer().create();
    player.initialize(video, v.videoUrl, true);
    player.on(dashjs.MediaPlayer.events.ERROR, (e) => {
      if (e && e.error && (e.error.code === 27 || e.error.code === 25)) {
        try { player.reset(); } catch (_) { }
        const p2 = dashjs.MediaPlayer().create();
        p2.initialize(video, dashProxy, true);
      }
    });
    window.__dashPlayer = player;
  } else if (isHls && window.Hls && Hls.isSupported()) {
    const hls = new Hls({ maxBufferLength: 60 });
    hls.loadSource(hlsProxy);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (evt, data) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else video.controls = true;
      }
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = hlsProxy;
  } else {
    video.src = proxyBase;
  }
}

function statusText(s) {
  const map = {
    0: t("common.unknown"), 1: t("detail.airing"), 2: t("detail.completed"),
    3: t("detail.licensed"), 4: t("detail.finished"), 5: t("detail.cancelled"), 6: t("detail.onHiatus"),
  };
  return map[s] ? t("detail.status", map[s]) : "";
}

/* ---------------- Settings ---------------- */

function openSettings() {
  const box = $("#modalBox");
  box.innerHTML = `
    <h3>${escapeHtml(t("settings.title"))}</h3>
    <div class="settings-group">
      <h4>${escapeHtml(t("settings.appearance"))}</h4>
      <div class="setting-row">
        <div class="st-lbl"><b>${escapeHtml(t("settings.language"))}</b><span>${escapeHtml(t("settings.languageHint"))}</span></div>
        <select onchange="setLang(this.value)">${AVAILABLE_LANGS.map((l) => `<option value="${l}" ${currentLang() === l ? "selected" : ""}>${l.toUpperCase()}</option>`).join("")}</select>
      </div>
    </div>
    <div class="settings-group">
      <h4>${escapeHtml(t("settings.server"))}</h4>
      <div class="setting-row">
        <div class="st-lbl"><b>${escapeHtml(t("settings.health"))}</b><span id="setHealth">…</span></div>
      </div>
      <div class="setting-row">
        <div class="st-lbl"><b>${escapeHtml(t("settings.extensionsDir"))}</b><span>${escapeHtml(t("settings.extensionsDirHint"))}</span></div>
      </div>
    </div>
    <div class="settings-group">
      <h4>${escapeHtml(t("anilist.title"))}</h4>
      <div class="setting-row">
        <div class="st-lbl"><b>${escapeHtml(t("anilist.clientId"))}</b><span>${escapeHtml(t("anilist.clientIdHint", location.origin + "/index.html"))}</span></div>
        <input id="anilistClientId" type="text" value="${escapeHtml(anilistClientId())}" placeholder="12345" onchange="setAniListClientId(this.value)" style="max-width:180px">
      </div>
      <div class="setting-row">
        <div class="st-lbl"><b>${escapeHtml(t("anilist.status"))}</b><span id="anilistStatus">…</span></div>
        <span>
          ${anilistToken()
            ? `<button onclick="disconnectAniList()">${escapeHtml(t("anilist.disconnect"))}</button>`
            : `<button class="btn-primary" onclick="connectAniList()">${escapeHtml(t("anilist.connect"))}</button>`}
        </span>
      </div>
      <div class="setting-row">
        <div class="st-lbl"><b>${escapeHtml(t("anilist.sync"))}</b><span>${escapeHtml(t("anilist.syncHint"))}</span></div>
        <input type="checkbox" id="anilistSyncCb" ${anilistSyncOn() ? "checked" : ""} onchange="setAniListSync(this.checked)">
      </div>
    </div>
    <div class="pref-actions">
      <button class="btn-primary" onclick="closeModal()">${escapeHtml(t("common.close"))}</button>
    </div>`;
  openModal();
  refreshAniListUi();
  fetch(`${api}/health`).then((r) => r.json()).then((d) => {
    const el = $("#setHealth");
    if (el) el.textContent = `${d.service} · manga ${d.mangaSources} · anime ${d.animeSources}`;
  }).catch(() => { });
}

/* ---------------- Source prefs ---------------- */

async function openSourcePrefs() {
  const s = state.activeSource;
  if (!s) return;
  const box = $("#modalBox");
  box.innerHTML = `<div class="loading">${escapeHtml(t("prefs.loading"))}</div>`;
  openModal();
  try {
    const d = await getJSON(`${api}/sources/${s.id}/prefs`);
    box.innerHTML = renderPrefs(s, d);
  } catch (e) {
    box.innerHTML = `<div class="error">${escapeHtml(t("common.error", e.message))}</div>`;
  }
}

function renderPrefs(s, d) {
  if (!d.configurable) {
    return `<h3 style="margin-top:0">${escapeHtml(t("prefs.title", s.name))}</h3><p class="cf-help">${escapeHtml(t("prefs.notConfigurable"))}</p><button class="btn-primary" onclick="closeModal()">${escapeHtml(t("common.close"))}</button>`;
  }
  if (d.error) {
    return `<h3 style="margin-top:0">${escapeHtml(t("prefs.title", s.name))}</h3><p class="error">${escapeHtml(d.error)}</p><button class="btn-primary" onclick="closeModal()">${escapeHtml(t("common.close"))}</button>`;
  }
  if (!d.prefs || !d.prefs.length) {
    return `<h3 style="margin-top:0">${escapeHtml(t("prefs.title", s.name))}</h3><p class="cf-help">${escapeHtml(t("prefs.none"))}</p><button class="btn-primary" onclick="closeModal()">${escapeHtml(t("common.close"))}</button>`;
  }
  const rows = d.prefs.map((p) => {
    const key = escapeHtml(p.key || "");
    const title = escapeHtml(p.title || p.key || "");
    const summary = p.summary && p.summary !== "%s" ? `<div class="pref-summary">${escapeHtml(p.summary)}</div>` : "";
    const lbl = `<div class="pref-lbl"><b>${title}</b>${summary}</div>`;
    switch (p.type) {
      case "switch":
        return `<label class="pref-row">${lbl}<input type="checkbox" data-key="${key}" ${p.value === "true" ? "checked" : ""}></label>`;
      case "text":
        return `<label class="pref-row">${lbl}<input type="text" data-key="${key}" value="${escapeHtml(p.value || "")}"></label>`;
      case "list": {
        const opts = (p.labels || []).map((l, i) =>
          `<option value="${escapeHtml((p.values || [])[i] ?? l)}" ${p.value === (p.values || [])[i] ? "selected" : ""}>${escapeHtml(l)}</option>`).join("");
        return `<label class="pref-row">${lbl}<select data-key="${key}">${opts}</select></label>`;
      }
      case "multi": {
        const sel = new Set((p.value || "").split(","));
        const opts = (p.values || []).map((v, i) =>
          `<label class="pref-check"><input type="checkbox" data-key="${key}" data-multi value="${escapeHtml(v)}" ${sel.has(v) ? "checked" : ""}>${escapeHtml((p.labels || [])[i] || v)}</label>`).join("");
        return `<div class="pref-row pref-multi">${lbl}<div>${opts}</div></div>`;
      }
      default: return "";
    }
  }).join("");
  return `<h3 style="margin-top:0">${escapeHtml(t("prefs.title", s.name))}</h3>
    <div class="prefs">${rows}</div>
    <div class="pref-actions">
      <button class="btn-primary" onclick="saveSourcePrefs()">${escapeHtml(t("common.save"))}</button>
      <button onclick="closeModal()">${escapeHtml(t("common.cancel"))}</button>
    </div>`;
}

async function saveSourcePrefs() {
  const s = state.activeSource;
  const body = {};
  document.querySelectorAll("#modalBox [data-key]").forEach((el) => {
    const key = el.dataset.key;
    if (el.dataset.multi !== undefined) {
      if (!body[key]) body[key] = [];
      if (el.checked) body[key].push(el.value);
    } else if (el.type === "checkbox") {
      body[key] = el.checked;
    } else {
      body[key] = el.value;
    }
  });
  for (const k of Object.keys(body)) if (Array.isArray(body[k])) body[k] = body[k].join(",");
  try {
    const res = await fetch(`${api}/sources/${s.id}/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) closeModal();
    else alert(t("prefs.saveError", data.error || t("common.unknown")));
  } catch (e) {
    alert("Error: " + e.message);
  }
}

/* ---------------- Extensions (repos stored in the DB) ---------------- */

let REPOS = [];
let activeRepo = 0;

// Repository URLs are persisted server-side (SQLite) so the user doesn't have
// to re-enter them, and no repository is loaded by default.
async function loadRepos() {
  REPOS = [];
  try {
    const d = await getJSON(`${api}/extensions/repos`);
    REPOS = Array.isArray(d.repos) ? d.repos.filter(Boolean) : [];
  } catch (e) { REPOS = []; }
  if (activeRepo >= REPOS.length) activeRepo = 0;
}
async function saveRepos() {
  try {
    await fetch(`${api}/extensions/repos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repos: REPOS }),
    });
  } catch (e) { }
}
function shortRepo(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; }
}

async function openExtensions() {
  activeRepo = 0;
  await loadRepos();
  renderExtensionsModal();
  openModal();
  loadRepo();
}

function renderExtensionsModal() {
  const box = $("#modalBox");
  box.innerHTML = `
    <h3>${escapeHtml(t("ext.title"))}</h3>
    <p class="cf-help">${t("ext.help")}</p>
    <div class="repo-tabs">
      ${REPOS.map((r, i) => `<span class="repo-tab ${i === activeRepo ? "active" : ""}" onclick="switchRepo(${i})">${escapeHtml(shortRepo(r))}${REPOS.length > 1 ? ` <span onclick="event.stopPropagation();removeRepo(${i})" style="cursor:pointer;opacity:.7">✕</span>` : ""}</span>`).join("")}
      <span class="repo-tab" onclick="showAddRepo()">＋ ${escapeHtml(t("ext.addRepo"))}</span>
    </div>
    <div id="repoAdd" style="display:none" class="repo-add">
      <input id="repoUrl" type="text" placeholder="${escapeHtml(t("ext.repoPh"))}">
      <button class="btn-primary" onclick="confirmAddRepo()">${escapeHtml(t("ext.add"))}</button>
      <button onclick="hideAddRepo()">${escapeHtml(t("common.cancel"))}</button>
    </div>
    <div class="repo-filters">
      <input id="repoSearch" type="text" placeholder="${escapeHtml(t("ext.searchPh"))}" oninput="filterRepo()" class="repo-search">
      <select id="repoLang" onchange="filterRepo()" class="repo-lang" title="${escapeHtml(t("ext.filterLang"))}"></select>
    </div>
    <div id="repoList" class="repo-list"><div class="loading">${escapeHtml(t("ext.loading"))}</div></div>`;
}

function switchRepo(i) { activeRepo = i; renderExtensionsModal(); loadRepo(); }
function showAddRepo() { const el = $("#repoAdd"); if (el) el.style.display = "flex"; }
function hideAddRepo() { const el = $("#repoAdd"); if (el) el.style.display = "none"; }
async function confirmAddRepo() {
  const input = $("#repoUrl");
  const url = (input && input.value.trim()) || "";
  if (!url) return;
  REPOS.push(url);
  await saveRepos();
  activeRepo = REPOS.length - 1;
  renderExtensionsModal();
  loadRepo();
}
async function removeRepo(i) {
  REPOS.splice(i, 1);
  await saveRepos();
  if (activeRepo >= REPOS.length) activeRepo = REPOS.length - 1;
  renderExtensionsModal();
  loadRepo();
}

async function loadRepo() {
  const list = $("#repoList");
  const prevScroll = list ? list.scrollTop : 0;
  const url = REPOS[activeRepo];
  if (!url) {
    // No repository configured: show only the locally installed extensions.
    if (list) list.innerHTML = `<div class="loading">${escapeHtml(t("ext.loading"))}</div>`;
    try {
      const data = await getJSON(`${api}/extensions/installed`);
      window.__repo = data.extensions || [];
      if (!window.__repo.length) {
        if (list) list.innerHTML = `<div class="empty">${escapeHtml(t("ext.noRepos"))}</div>`;
        return;
      }
      populateLangFilter();
      renderRepo(window.__repo, $("#repoSearch")?.value || "", $("#repoLang")?.value || "");
      if (list) list.scrollTop = prevScroll;
    } catch (e) {
      if (list) list.innerHTML = `<div class="error">${escapeHtml(t("common.error", e.message))}</div>`;
    }
    return;
  }
  if (list) list.innerHTML = `<div class="loading">${escapeHtml(t("ext.consulting"))}</div>`;
  try {
    const data = await getJSON(`${api}/extensions/repo?url=${encodeURIComponent(url)}`);
    window.__repo = data.extensions || [];
    populateLangFilter();
    renderRepo(window.__repo, $("#repoSearch")?.value || "", $("#repoLang")?.value || "");
    if (list) list.scrollTop = prevScroll;
  } catch (e) {
    if (list) list.innerHTML = `<div class="error">${escapeHtml(t("common.error", e.message))}</div>`;
  }
}

const SOURCES_MAX_SHOWN = 3;
function summarizeSources(sources) {
  if (!sources || !sources.length) return "";
  const unique = [];
  const seen = {};
  for (const s of sources) {
    const n = s.name || "";
    if (!seen[n]) { seen[n] = true; unique.push(n); }
  }
  let str;
  if (unique.length <= SOURCES_MAX_SHOWN) {
    str = unique.join(", ");
  } else {
    const extra = unique.length - SOURCES_MAX_SHOWN;
    str = unique.slice(0, SOURCES_MAX_SHOWN).join(", ") + " " + t("ext.more", extra);
  }
  return " · " + str;
}

function populateLangFilter() {
  const sel = $("#repoLang");
  if (!sel) return;
  const entries = window.__repo || [];
  const langs = [...new Set(entries.map((e) => e.lang).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = `<option value="">${escapeHtml(t("ext.allLangs"))}</option>` +
    langs.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("");
  if (current && langs.includes(current)) sel.value = current;
}

function renderRepo(entries, q, lang) {
  const list = $("#repoList");
  if (!list) return;
  const filt = q.trim().toLowerCase();
  const langF = (lang || "").trim();
  const filtered = entries.filter((e) =>
    (!filt || (e.name + " " + e.pkg + " " + e.lang).toLowerCase().includes(filt)) &&
    (!langF || (e.lang || "") === langF));
  const byLang = {};
  for (const e of filtered) (byLang[e.lang] = byLang[e.lang] || []).push(e);
  const langOrder = Object.keys(byLang).sort();
  if (langOrder.length === 0) { list.innerHTML = `<div class="empty">${escapeHtml(t("common.noResults"))}</div>`; return; }
  list.innerHTML = langOrder.map((lang) => `
    <div class="group-title">${escapeHtml(lang)} (${byLang[lang].length})</div>
    ${byLang[lang].map((e) => `
      <div class="repo-item">
        <div class="repo-info">
          <strong>${escapeHtml(e.name)}</strong> ${e.nsfw ? '<span class="badge nsfw">NSFW</span>' : ""}
          <div class="repo-meta">${escapeHtml(e.version || "")}${summarizeSources(e.sources)}<br>${escapeHtml(e.pkg)}</div>
        </div>
        ${e.installed
          ? `<span class="repo-actions"><button class="btn-primary" disabled>${escapeHtml(t("ext.installed"))}</button><button class="btn-danger" onclick="uninstallExt('${escapeHtml(e.pkg).replace(/'/g, "\\'")}', this)">${escapeHtml(t("ext.uninstall"))}</button></span>`
          : `<button class="btn-primary" onclick="installExt('${escapeHtml(e.apk).replace(/'/g, "\\'")}', this)">${escapeHtml(t("ext.install"))}</button>`}
      </div>`).join("")}
  `).join("");
}

function filterRepo() {
  renderRepo(window.__repo || [], $("#repoSearch")?.value || "", $("#repoLang")?.value || "");
}

async function installExt(apk, btn) {
  btn.disabled = true;
  btn.textContent = t("ext.installing");
  try {
    const res = await fetch(`${api}/extensions/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: REPOS[activeRepo] || "", apk }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      btn.textContent = t("ext.installed");
      loadSources();
      loadRepo();
      if (state.currentView === "home") renderHome();
    } else {
      btn.textContent = "Error";
      btn.disabled = false;
      alert(t("ext.installError", data.error || t("common.unknown")));
    }
  } catch (e) {
    btn.textContent = "Error";
    btn.disabled = false;
    alert(t("common.error", e.message));
  }
}

async function uninstallExt(pkg, btn) {
  if (!confirm(t("ext.confirmUninstall", pkg))) return;
  btn.disabled = true;
  btn.textContent = t("ext.uninstalling");
  try {
    const res = await fetch(`${api}/extensions/uninstall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pkg }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      loadSources();
      loadRepo();
      if (state.currentView === "home") renderHome();
    } else {
      btn.textContent = t("ext.uninstall");
      btn.disabled = false;
      alert(t("ext.uninstallError", data.error || t("common.unknown")));
    }
  } catch (e) {
    btn.textContent = t("ext.uninstall");
    btn.disabled = false;
    alert(t("common.error", e.message));
  }
}

/* ---------------- Global search ---------------- */

function globalSearchGo() {
  const q = $("#globalSearch")?.value.trim();
  if (!q) { goHome(); return; }
  if (state.activeSource) {
    const input = $("#searchInput");
    if (input) input.value = q;
    doSearch();
  } else {
    const first = (state.sources.manga && state.sources.manga[0]) || (state.sources.anime && state.sources.anime[0]);
    if (first) {
      openSource(first);
      const input = $("#searchInput");
      if (input) input.value = q;
      doSearch();
    }
  }
}

/* ---------------- Modal helpers ---------------- */

function openModal() { $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); }

/* ---------------- Update banner ---------------- */

async function checkUpdate() {
  try {
    const d = await getJSON(`${api}/update`);
    if (!d || !d.available) return;
    let banner = document.getElementById("updateBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "updateBanner";
      banner.className = "update-banner";
      document.body.appendChild(banner);
    }
    const ver = d.latestVersion || "";
    const hint = d.downloaded
      ? `<span class="ub-hint">${escapeHtml(t("update.restart"))}</span>`
      : (d.url ? `<a class="ub-hint" href="${escapeHtml(d.url)}" target="_blank">${escapeHtml(t("update.openUrl"))}</a>` : "");
    banner.innerHTML =
      `<span class="ub-icon">⬆</span>` +
      `<span class="ub-text"><b>${escapeHtml(t("update.title"))}</b> ${escapeHtml(t("update.msg", ver))} ${hint}</span>` +
      `<button class="ub-close" onclick="dismissUpdate()">${escapeHtml(t("update.dismiss"))}</button>`;
  } catch (e) { }
}

function dismissUpdate() {
  const b = document.getElementById("updateBanner");
  if (b) b.remove();
}

/* ---------------- Boot ---------------- */

(async function boot() {
  handleAniListHash();
  await loadI18n(currentLang());
  const sel = $("#langSelect");
  if (sel) sel.value = currentLang();
  const contentEl = $("#content");
  if (contentEl) contentEl.addEventListener("scroll", onContentScroll);
  checkUpdate();
  try {
    await loadSources();
    setTypeFilter("all");
    renderHome();
  } catch (e) {
    $("#srcList").innerHTML = `<div class="error">${escapeHtml(t("api.error", e.message))}</div>`;
  }
})();

/* ---------------- Manga (our own views, manga service behind) ---------------- */

const MU = "http://127.0.0.1:4567";
const MU_SRC_KEY = "aniyomi.muSource";
let muSourcesCache = null;

async function muGql(query) {
  const r = await fetch(MU + "/api/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const d = await r.json();
  if (d.errors && d.errors.length) throw new Error(d.errors[0].message);
  return d.data;
}

function muImg(u) { return u ? (u.startsWith("/") ? MU + u : u) : ""; }

async function muSources() {
  if (muSourcesCache) return muSourcesCache;
  const d = await muGql("{ sources { nodes { id name lang } } }");
  muSourcesCache = (d.sources.nodes || []).filter((s) => s.name && s.name !== "Local source");
  return muSourcesCache;
}

async function goManga() {
  closeMangaReader();
  setNav("manga");
  state.currentView = "manga";
  const app = document.querySelector(".app");
  if (app) app.classList.add("mu-mode");
  const main = $("#content");
  main.innerHTML = `<div class="loading">Loading manga…</div>`;
  let srcs;
  try {
    srcs = await muSources();
  } catch (e) {
    main.innerHTML = `<div class="empty"><h2>Manga engine offline</h2><p>${escapeHtml(e.message)}</p><p>Start it with Start Aniyomi.bat.</p></div>`;
    return;
  }
  const filtered = srcs.filter((s) => langOk(s.lang));
  const visible = filtered.length ? filtered : srcs;
  const last = localStorage.getItem(MU_SRC_KEY);
  const cur = visible.find((s) => s.id === last) || visible[0];
  main.innerHTML = `
    <div class="mu-bar">
      <div class="src-wrap">
        <button type="button" class="src-btn" onclick="spToggleManga()">
          <span class="src-btn-name" id="muSrcName">${escapeHtml(cur.name)}</span>
          <span class="src-btn-lang">${escapeHtml((cur.lang || "?").toUpperCase())}</span>
          <span class="src-caret">▾</span>
        </button>
        <div class="sp-pop" id="spPop">
          <input id="spSearch" class="sp-search" placeholder="Search source…" oninput="spFilter(this.value)" onkeydown="spKeys(event)">
          <div class="sp-list" id="spList"></div>
        </div>
      </div>
      <input id="muQuery" type="text" placeholder="Search this source…" onkeydown="if(event.key==='Enter')muSearch()">
      <button class="btn-primary" onclick="muSearch()">Search</button>
    </div>
    <div class="mu-head"><h2 id="muTitle">Popular</h2><span class="mu-count" id="muCount"></span></div>
    <div class="mu-grid" id="muGrid"><div class="loading">Loading…</div></div>`;
  if (cur) muPopular(cur.id);
}

function spToggleManga() {
  const pop = document.getElementById("spPop");
  if (pop && pop.classList.contains("on")) { spClose(); return; }
  const srcs = (muSourcesCache || []).filter((s) => langOk(s.lang));
  const list = srcs.length ? srcs : (muSourcesCache || []);
  const curName = (document.getElementById("muSrcName") || {}).textContent;
  const cur = list.find((s) => s.name === curName);
  SP.pick = (s) => {
    localStorage.setItem(MU_SRC_KEY, s.id);
    const n = document.getElementById("muSrcName");
    if (n) n.textContent = s.name;
    muPopular(s.id);
  };
  spOpen(list, cur ? cur.id : null);
}

function muPick(id) {
  localStorage.setItem(MU_SRC_KEY, id);
  const t = document.getElementById("muTitle");
  if (t) t.textContent = "Popular";
  muPopular(id);
}

function muCards(list) {
  return list.map((m) => `
    <div class="card poster-card" onclick="muOpen(${m.id})">
      ${m.thumbnailUrl
        ? `<img loading="lazy" src="${escapeHtml(muImg(m.thumbnailUrl))}" alt="${escapeHtml(m.title)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card-img-placeholder',textContent:'${escapeHtml((m.title || "?").charAt(0).toUpperCase())}'}))">`
        : `<div class="card-img-placeholder">${escapeHtml((m.title || "?").charAt(0).toUpperCase())}</div>`}
      <div class="card-play">▶</div>
      <div class="card-title">${escapeHtml(m.title)}</div>
      <div class="card-sub">${escapeHtml(m.author || "")}</div>
    </div>`).join("");
}

async function muPopular(sourceId) {
  const grid = document.getElementById("muGrid");
  const count = document.getElementById("muCount");
  if (grid) grid.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    const d = await muGql(`mutation { fetchSourceManga(input:{source:"${sourceId}", type:POPULAR, page:1}) { mangas { id title thumbnailUrl author } } }`);
    const list = d.fetchSourceManga.mangas || [];
    if (grid) grid.innerHTML = list.length ? muCards(list) : `<div class="empty"><p>This source returned nothing.</p></div>`;
    if (count) count.textContent = `${list.length} titles`;
  } catch (e) {
    if (grid) grid.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
  }
}

async function muSearch() {
  const q = (document.getElementById("muQuery") || {}).value || "";
  const sid = (document.getElementById("muSource") || {}).value;
  if (!q.trim() || !sid) return;
  const grid = document.getElementById("muGrid");
  const title = document.getElementById("muTitle");
  const count = document.getElementById("muCount");
  if (title) title.textContent = `Search: ${q}`;
  if (grid) grid.innerHTML = `<div class="loading">Searching…</div>`;
  try {
    const safe = JSON.stringify(String(q)).slice(1, -1);
    const d = await muGql(`mutation { fetchSourceManga(input:{source:"${sid}", type:SEARCH, query:"${safe}", page:1}) { mangas { id title thumbnailUrl author } } }`);
    const list = d.fetchSourceManga.mangas || [];
    if (grid) grid.innerHTML = list.length ? muCards(list) : `<div class="empty"><p>No results.</p></div>`;
    if (count) count.textContent = `${list.length} results`;
  } catch (e) {
    if (grid) grid.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
  }
}

async function muOpen(id) {
  const main = $("#content");
  main.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    await muGql(`mutation { fetchMangaAndChapters(input:{id:${id}, fetchManga:true, fetchChapters:true}) { manga { id } } }`);
    const d = await muGql(`{ manga(id:${id}) { id title thumbnailUrl description author status genre chapters { nodes { id name chapterNumber } } } }`);
    const m = d.manga;
    const chs = (m.chapters && m.chapters.nodes) || [];
    main.innerHTML = `
      <div class="mu-detail">
        ${m.thumbnailUrl ? `<img class="mu-cover" src="${escapeHtml(muImg(m.thumbnailUrl))}" alt="">` : ""}
        <div class="mu-meta">
          <h2>${escapeHtml(m.title)}</h2>
          <p class="mu-sub">${escapeHtml(m.author || "")}${m.status ? " · " + escapeHtml(m.status) : ""}${m.genre && m.genre.length ? " · " + escapeHtml(m.genre.slice(0, 5).join(", ")) : ""}</p>
          <p class="mu-desc">${escapeHtml(m.description || "")}</p>
          <button class="btn-primary" onclick="muRead(${m.id}, ${chs.length ? chs[chs.length - 1].id : 0}, '${escapeHtml((chs.length ? chs[chs.length - 1].name : "").replace(/'/g, "\'"))}')" ${chs.length ? "" : "disabled"}>Read first chapter</button>
        </div>
      </div>
      <div class="mu-head"><h2>Chapters</h2><span class="mu-count">${chs.length}</span></div>
      <div class="mu-chapters">
        ${chs.map((c) => `<button class="mu-ch" onclick="muRead(${m.id}, ${c.id}, '${escapeHtml((c.name || "").replace(/'/g, "\'"))}')">${escapeHtml(c.name || "Chapter")}</button>`).join("") || `<div class="empty"><p>No chapters.</p></div>`}
      </div>`;
    window.scrollTo(0, 0);
  } catch (e) {
    main.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
  }
}

function mrFullscreen() {
  const w = document.getElementById("mangaReader");
  if (!w) return;
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => { }); return; }
  if (w.classList.contains("mr-fs")) { w.classList.remove("mr-fs"); document.body.classList.remove("no-scroll"); return; }
  w.classList.add("mr-fs");
  document.body.classList.add("no-scroll");
  if (w.requestFullscreen) w.requestFullscreen().catch(() => { });
}

async function muRead(mangaId, chapterId, name) {
  if (!chapterId) return;
  const w = document.getElementById("mangaReader");
  const pages = document.getElementById("mrPages");
  const title = document.getElementById("mrTitle");
  const count = document.getElementById("mrCount");
  if (title) title.textContent = name || "Reader";
  if (count) count.textContent = "";
  if (pages) pages.innerHTML = `<div class="loading">Loading pages…</div>`;
  w.classList.remove("hidden");
  try {
    const d = await muGql(`mutation { fetchChapterPages(input:{chapterId:${chapterId}}) { pages } }`);
    const list = d.fetchChapterPages.pages || [];
    if (pages) {
      pages.innerHTML = list.map((p) => `<img loading="lazy" src="${escapeHtml(muImg(p))}" alt="">`).join("") ||
        `<div class="empty"><p>No pages returned.</p></div>`;
      pages.scrollTop = 0;
    }
    if (count) count.textContent = `${list.length} pages`;
    if (pages && !pages.dataset.bound) {
      pages.dataset.bound = "1";
      // click a page: switch between fit-width and fit-height
      pages.addEventListener("click", () => pages.classList.toggle("mr-tall"));
      document.addEventListener("keydown", (e) => {
        const w = document.getElementById("mangaReader");
        if (!w || w.classList.contains("hidden")) return;
        if (e.key === "f") { mrFullscreen(); return; }
        if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); pages.scrollBy({ top: pages.clientHeight * 0.92, behavior: "smooth" }); }
        if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); pages.scrollBy({ top: -pages.clientHeight * 0.92, behavior: "smooth" }); }
        if (e.key === "Escape") closeMangaReader();
      });
    }
  } catch (e) {
    if (pages) pages.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
  }
}
