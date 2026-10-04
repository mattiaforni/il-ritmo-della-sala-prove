// ============================================================
// Il ritmo della sala prove
// Vanilla JS + Firebase (Auth con account condiviso, Firestore, Storage)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, getFirestore,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ---------- costanti ----------
// Email dell'unico account condiviso della band (creato in Console Firebase → Authentication).
// Non è una casella vera: serve solo a Firebase. La password non sta nel codice.
const BAND_EMAIL = window.BAND_EMAIL || "band@il-ritmo-della-sala-prove.web.app";
const GENERALE_ID = "generale";
const SOGLIA_SCALETTA = 5;          // da quanti 👍 il bottone "In scaletta" diventa verde
const PALETTE = ["#b4552d", "#d99a2b", "#5b7553", "#5a6b8c", "#8c5a7a", "#3a6b6b", "#a04a4a"];
const LIGHT_BG = new Set(["#d99a2b"]); // sfondi chiari: testo scuro
const SP_FALLBACK = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='#1a9a48'>" +
  "<path d='M8.6 5.6 19.4 3.4v3.2L8.6 8.8z'/><path d='M9.6 6.2v11.4M18.4 4.2v11' stroke='#1a9a48' stroke-width='2' fill='none'/>" +
  "<ellipse cx='6.9' cy='17.9' rx='3' ry='2.3' transform='rotate(-18 6.9 17.9)'/>" +
  "<ellipse cx='15.7' cy='15.6' rx='3' ry='2.3' transform='rotate(-18 15.7 15.6)'/></svg>");
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// A ogni pubblicazione aumentare insieme: APP_VERSION qui, "version" in version.json, CACHE in sw.js.
const APP_VERSION = "11";
// Versione dei dati salvati sul telefono: si aumenta solo quando serve una pulizia (vedi MIGRAZIONI).
const DATA_VERSION = 2;
const STRUMENTI = [
  { key: "chitarra1", nome: "Chitarra 1" },
  { key: "chitarra2", nome: "Chitarra 2" },
  { key: "basso", nome: "Basso" },
  { key: "batteria", nome: "Batteria" },
  { key: "tastiera", nome: "Tastiera" }
];
const nomeStrumento = (k) => STRUMENTI.find(s => s.key === k)?.nome || "";
const SPOTIFY_RE = /https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]+/;
const SONGSTERR_RE = /https:\/\/(?:www\.)?songsterr\.com\/a\/[^\s"'<>]+/;

// ---------- configurazione ----------
const cfg = window.FIREBASE_CONFIG || {};
if (!cfg.projectId || cfg.projectId.includes("INCOLLA")) {
  document.getElementById("setup-notice").classList.remove("hidden");
  document.querySelector("main").classList.add("hidden");
  document.querySelector(".tabs").classList.add("hidden");
  throw new Error("Firebase non configurato: compila config.js");
}
const app = initializeApp(cfg);
let db;
try {
  db = initializeFirestore(app, IS_IOS
    ? { localCache: memoryLocalCache() }
    : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = getFirestore(app);
}
const auth = getAuth(app);
const storage = getStorage(app);

// ---------- stato ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
// Ogni voce porta i dati del telefono dalla versione precedente a quella indicata.
const MIGRAZIONI = {
  2: () => {
    // la tab "Persone" è diventata "Personale"; via le chiavi delle prime versioni
    if (store.get("prove_tab") === "persone") store.set("prove_tab", "personale");
    ["prove_user_google", "prove_login"].forEach(k => store.del(k));
  }
};
(function migraDatiLocali() {
  const da = Number(store.get("prove_data_version") || 1);
  if (da >= DATA_VERSION) return;
  for (let n = da + 1; n <= DATA_VERSION; n++) {
    try { MIGRAZIONI[n] && MIGRAZIONI[n](); } catch (e) { console.error("migrazione", n, e); }
  }
  store.set("prove_data_version", String(DATA_VERSION));
})();

const state = {
  account: null,
  user: store.get("prove_user"),
  membri: [], canzoni: [], tasks: [], registrazioni: [], movimenti: [],
  ready: { membri: false, canzoni: false, tasks: false, registrazioni: false, movimenti: false },
  subscribed: false,
  generaleOk: false,
  tab: (store.get("prove_tab") || "scaletta").replace("persone", "personale"),
  viewPerson: null,           // di chi si guarda la pagina personale (null = la propria)
  setupOpen: new Set(),
  recsOpen: new Set(),
  editSetup: null,            // { song, key } riga di setup in modifica
  linkEdit: null,             // id della canzone con il modulo dei link aperto
  enrichTried: new Set(),
  expanded: new Set(),
  votersOpen: new Set(),
  addOpen: { scaletta: false, proposte: false, personale: false },
  drafts: {},                 // songId → Set di nomi selezionati per il nuovo task
  tipoMov: "spesa",
  movOpen: null,
  pendingFiles: [],
  upload: { active: false, pct: 0, txt: "" },
  playId: null,
  spIcon: "icons/spotify.svg",
  sigle: {},
  deniedShown: false
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- formattazione ----------
const oggi = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const parseIso = (iso) => { const [y, m, d] = (iso || "").split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const annoCorrente = new Date().getFullYear();
const fmtGiorno = (iso) => {
  if (!iso) return "";
  const d = parseIso(iso);
  const s = d.toLocaleDateString("it-IT", { day: "numeric", month: "long" });
  return d.getFullYear() === annoCorrente ? s : `${s} ${d.getFullYear()}`;
};
const fmtDataLunga = (iso) => {
  if (!iso) return "Senza data";
  const d = parseIso(iso);
  const opts = { weekday: "long", day: "numeric", month: "long" };
  if (d.getFullYear() !== annoCorrente) opts.year = "numeric";
  const s = d.toLocaleDateString("it-IT", opts);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fmtDdMm = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return Number(y) === annoCorrente ? `${d}/${m}` : `${d}/${m}/${y.slice(2)}`;
};
const fmtTime = (sec) => {
  if (!isFinite(sec) || sec <= 0) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const EUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const NUM = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euro = (cent) => EUR.format((cent || 0) / 100);
const fmtMB = (b) => b ? (b / 1048576).toLocaleString("it-IT", { maximumFractionDigits: 1 }) + " MB" : "";

// ---------- persone: colori e sigle a tre lettere ----------
function computeSigle() {
  const map = {}, used = new Set();
  state.membri.forEach(m => {
    const clean = m.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z ]/g, "").trim();
    const words = clean.split(/\s+/).filter(Boolean);
    let s = (words.join("").slice(0, 3) || m.nome.slice(0, 3)).toUpperCase();
    if (used.has(s) && words.length > 1) s = (words[0][0] + words[words.length - 1].slice(0, 2)).toUpperCase();
    const base = s; let k = 2;
    while (used.has(s)) { s = base.slice(0, 2) + k++; }
    used.add(s); map[m.nome] = s;
  });
  state.sigle = map;
}
const colorOf = (nome) => {
  const i = state.membri.findIndex(m => m.nome === nome);
  return i < 0 ? "#8a7d70" : PALETTE[i % PALETTE.length];
};
const siglaOf = (nome) => state.sigle[nome] || String(nome || "?").slice(0, 3).toUpperCase();
const iniTag = (nome) => {
  const c = colorOf(nome);
  return `<span class="ini${LIGHT_BG.has(c) ? " light" : ""}" style="background:${c}" title="${esc(nome)}">${esc(siglaOf(nome))}</span>`;
};
function whoTags(nomi = []) {
  const tutti = state.membri.length > 1 && state.membri.every(m => nomi.includes(m.nome));
  if (tutti) return `<span class="who"><span class="tutti">Tutti</span></span>`;
  return nomi.length ? `<span class="who">${nomi.map(iniTag).join("")}</span>` : "";
}

// ---------- canzoni ----------
const isGenerale = (c) => c.id === GENERALE_ID || c.stato === "generale";
const scaletta = () => state.canzoni.filter(c => !isGenerale(c) && c.stato !== "proposta");
const proposte = () => state.canzoni.filter(c => c.stato === "proposta");
const tasksOf = (id) => state.tasks.filter(t => t.canzoneId === id);
const recsOf = (id) => state.registrazioni.filter(r => r.canzoneId === id);
const pct = (d, t) => t ? Math.round(d / t * 100) : 0;
const songQuery = (c) => c.titolo + (c.artista ? " " + c.artista : "");

// link che su Android chiedono di aprire l'app, con ripiego sul browser
function appLink(httpsUrl, pkg) {
  if (!IS_ANDROID) return `href="${esc(httpsUrl)}" target="_blank" rel="noopener"`;
  const u = new URL(httpsUrl);
  const intent = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=${pkg};` +
    `S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`;
  return `href="${esc(intent)}"`;
}
function linksHtml(c) {
  const q = encodeURIComponent(songQuery(c));
  const sp = c.spotifyUrl || `https://open.spotify.com/search/${q}`;
  const tab = c.songsterrUrl || `https://www.songsterr.com/?pattern=${q}`;
  return `<div class="links">
    <a ${appLink(sp, "com.spotify.music")} data-link title="Ascolta su Spotify" aria-label="Ascolta su Spotify"><img class="ico ico-sp" src="${esc(state.spIcon)}" alt=""></a>
    <a ${appLink(tab, "com.songsterr")} data-link title="${c.songsterrUrl ? "Apri la tablatura su Songsterr" : "Cerca la tablatura su Songsterr"}" aria-label="Tablatura su Songsterr"><svg class="ico" aria-hidden="true"><use href="#ico-clef"/></svg></a>
  </div>`;
}
// icona Spotify: prima .svg, poi .png, infine un'icona di ripiego
document.addEventListener("error", e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains("ico-sp")) return;
  if (img.getAttribute("src") !== state.spIcon) { img.src = state.spIcon; return; }
  if (state.spIcon.endsWith(".svg")) state.spIcon = "icons/spotify.png";
  else if (state.spIcon.endsWith(".png")) state.spIcon = SP_FALLBACK;
  else return;
  document.querySelectorAll("img.ico-sp").forEach(i => { i.src = state.spIcon; });
}, true);

// ---------- accesso ----------
onAuthStateChanged(auth, (account) => {
  // un accesso rimasto da versioni precedenti (es. login Google) non vale:
  // si esce e si chiede la password della band
  if (account && (account.email || "").toLowerCase() !== BAND_EMAIL.toLowerCase()) {
    signOut(auth).catch(() => {});
    return;
  }
  state.account = account;
  if (account) {
    $("#gate").classList.add("hidden");
    subscribe();
    ensureUser();
    render();
  } else {
    $("#gate").classList.remove("hidden");
    $("#overlay").classList.add("hidden");
    $("#user-chip").classList.add("hidden");
    setTimeout(() => $("#gate-pw")?.focus(), 50);
  }
});

$("#gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("#gate-pw").value;
  const err = $("#gate-err");
  if (!pw) return;
  err.textContent = "";
  const btn = e.target.querySelector(".enter");
  btn.disabled = true; btn.textContent = "Accesso…";
  try {
    await signInWithEmailAndPassword(auth, BAND_EMAIL, pw);
    $("#gate-pw").value = "";
  } catch (ex) {
    const code = ex.code || "";
    err.textContent =
      ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(code) ? "Password non corretta." :
      code === "auth/too-many-requests" ? "Troppi tentativi. Riprova tra qualche minuto." :
      code === "auth/network-request-failed" ? "Nessuna connessione. Riprova quando sei online." :
      code === "auth/operation-not-allowed" ? "L'accesso con password non è ancora attivo su Firebase." :
      `Accesso non riuscito (${code || ex.message}).`;
  } finally {
    btn.disabled = false; btn.textContent = "Entra";
  }
});
$("#gate-show").addEventListener("click", () => {
  const i = $("#gate-pw");
  const show = i.type === "password";
  i.type = show ? "text" : "password";
  $("#gate-show").textContent = show ? "nascondi" : "mostra";
});

// ---------- dati in tempo reale ----------
function onDenied(err) {           // errori di lettura: i dati smettono di aggiornarsi
  console.error(err);
  const box = document.getElementById("conn-banner");
  if (box) {
    box.querySelector("span").textContent = err && err.code === "permission-denied"
      ? "Il database ha rifiutato l'accesso: i dati non si aggiornano."
      : "Collegamento ai dati interrotto: i dati non si aggiornano.";
    box.classList.remove("hidden");
  }
}
function erroreScrittura(err) {    // errori di scrittura: sempre un messaggio
  console.error(err);
  const code = (err && err.code) || "";
  toast(code === "permission-denied"
    ? "Non salvato: il database ha rifiutato la modifica. Chiudi e riapri l'app."
    : `Non salvato${code ? " (" + code + ")" : ""}. Controlla la connessione e riprova.`);
}
// scrive, avvisa se resta in sospeso, rimette il testo nei campi se fallisce
async function scrivi(promessa, ripristina) {
  const lento = setTimeout(() => toast("Salvataggio in sospeso: controlla la connessione."), 10000);
  try { return await promessa; }
  catch (ex) { if (ripristina) ripristina(); erroreScrittura(ex); return null; }
  finally { clearTimeout(lento); }
}
function rimetti(key, valore) {
  const el = document.querySelector(`main [data-keep="${CSS.escape(key)}"]`);
  if (el && !el.value) el.value = valore;
}
function subscribe() {
  if (state.subscribed) return;
  state.subscribed = true;
  const listen = (name, q, key, opts) => onSnapshot(q, opts || {}, snap => {
    state[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.ready[key] = true;
    if (key === "membri") { computeSigle(); ensureUser(); }
    if (key === "canzoni") ensureGenerale(snap);
    render();
  }, onDenied);
  listen("membri", query(collection(db, "membri"), orderBy("creato")), "membri");
  listen("canzoni", query(collection(db, "canzoni"), orderBy("ordine")), "canzoni", { includeMetadataChanges: true });
  listen("tasks", query(collection(db, "tasks"), orderBy("creato")), "tasks");
  listen("registrazioni", query(collection(db, "registrazioni"), orderBy("data", "desc")), "registrazioni");
  listen("movimenti", query(collection(db, "movimenti"), orderBy("data", "desc")), "movimenti");
}
// la scheda Generale è un documento con id fisso: crearla due volte non produce doppioni
function ensureGenerale(snap) {
  if (state.generaleOk) return;
  if (state.canzoni.some(c => c.id === GENERALE_ID)) { state.generaleOk = true; return; }
  if (snap.metadata.fromCache) return; // aspetta la risposta del server
  state.generaleOk = true;
  setDoc(doc(db, "canzoni", GENERALE_ID), {
    titolo: "Generale", artista: "", stato: "generale", ordine: 0, creato: serverTimestamp()
  }, { merge: true }).catch(erroreScrittura);
}

// ---------- nome con cui firmare ----------
function ensureUser() {
  if (!state.account || !state.ready.membri) return;
  const overlay = $("#overlay");
  const chip = $("#user-chip");
  updateNavMe();
  if (state.user && state.membri.some(m => m.nome === state.user)) {
    overlay.classList.add("hidden");
    chip.textContent = state.user;
    chip.classList.remove("hidden");
    return;
  }
  chip.classList.add("hidden");
  overlay.classList.remove("hidden");
  $("#member-picker").innerHTML = state.membri.map(m =>
    `<button class="member-pick" data-nome="${esc(m.nome)}">${iniTag(m.nome)}${esc(m.nome)}</button>`
  ).join("");
}
function updateNavMe() {
  const el = document.getElementById("nav-me");
  if (!el) return;
  const known = state.user && state.membri.some(m => m.nome === state.user);
  el.textContent = known ? siglaOf(state.user) : "—";
  const col = known ? colorOf(state.user) : "";
  el.style.background = known && state.tab === "personale" ? col : "";
  el.style.color = known && state.tab === "personale" && LIGHT_BG.has(col) ? "var(--legno)" : "";
}
function setUser(nome) {
  state.user = nome;
  state.viewPerson = null;
  store.set("prove_user", nome);
  ensureUser();
  render();
}
$("#member-picker").addEventListener("click", e => {
  const b = e.target.closest(".member-pick");
  if (b) setUser(b.dataset.nome);
});
$("#new-member-form").addEventListener("submit", async e => {
  e.preventDefault();
  const input = $("#new-member-name");
  const nome = input.value.trim().replace(/\s+/g, " ");
  if (!nome) return;
  input.value = "";
  if (!state.membri.some(m => m.nome.toLowerCase() === nome.toLowerCase())) {
    await addDoc(collection(db, "membri"), { nome, creato: serverTimestamp() }).catch(erroreScrittura);
  }
  setUser(state.membri.find(m => m.nome.toLowerCase() === nome.toLowerCase())?.nome || nome);
});
$("#user-chip").addEventListener("click", () => {
  store.del("prove_user");
  state.user = null;
  ensureUser();
});

// ---------- tab ----------
function showTab(name) {
  if (!document.getElementById("view-" + name)) name = "scaletta";
  state.tab = name;
  store.set("prove_tab", name);
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.tab === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  updateNavMe();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));
showTab(state.tab);

// ---------- aggiornamenti: se online c'è una versione nuova, barra con "Aggiorna" ----------
async function controllaVersione() {
  try {
    const r = await fetch("version.json", { cache: "no-store" });
    if (!r.ok) return;
    const { version } = await r.json();
    if (version && String(version) !== APP_VERSION) $("#update-banner")?.classList.remove("hidden");
  } catch (e) { /* offline: si riprova più tardi */ }
}
$("#update-btn")?.addEventListener("click", async () => {
  const btn = $("#update-btn");
  btn.disabled = true; btn.textContent = "Aggiorno…";
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch (e) { /* si ricarica comunque */ }
  location.reload();
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") controllaVersione(); });
setInterval(() => { if (document.visibilityState === "visible") controllaVersione(); }, 15 * 60 * 1000);
setTimeout(controllaVersione, 3000);

// ---------- render (conserva campi in compilazione e riproduzione) ----------
function captureInputs() {
  const vals = {};
  document.querySelectorAll("main [data-keep]").forEach(el => { vals[el.dataset.keep] = el.value; });
  const a = document.activeElement;
  let focus = null;
  if (a && a.dataset && a.dataset.keep && a.closest("main")) {
    focus = { key: a.dataset.keep };
    try { focus.s = a.selectionStart; focus.e = a.selectionEnd; } catch {}
  }
  return { vals, focus };
}
function restoreInputs({ vals, focus }) {
  Object.entries(vals).forEach(([k, v]) => {
    const el = document.querySelector(`main [data-keep="${CSS.escape(k)}"]`);
    if (el && v != null && v !== "") el.value = v;
  });
  if (focus) {
    const el = document.querySelector(`main [data-keep="${CSS.escape(focus.key)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      try { if (focus.s != null) el.setSelectionRange(focus.s, focus.e); } catch {}
    }
  }
}
function render() {
  if (!state.account) return;
  if (!(state.ready.membri && state.ready.canzoni && state.ready.tasks)) return;
  const kept = captureInputs();
  renderScaletta();
  renderProposte();
  renderAudio();
  renderCassa();
  renderPersonale();
  restoreInputs(kept);
  updateNavMe();
  syncPlayer();
}

// ---------- scaletta ----------
function renderScaletta() {
  const gen = state.canzoni.find(c => c.id === GENERALE_ID);
  const lista = scaletta();
  let html = gen ? songCard(gen, 0, 0) : "";
  html += lista.map((c, i) => songCard(c, i, lista.length)).join("");
  if (!lista.length) html += `<p class="empty big">Nessuna canzone in scaletta. Aggiungine una qui sotto.</p>`;
  html += addSongBlock("scaletta", "Aggiungi canzone", "Aggiungi");
  $("#view-scaletta").innerHTML = html;
}
function songCard(c, idx, tot) {
  const gen = isGenerale(c);
  const ts = tasksOf(c.id);
  const done = ts.filter(t => t.fatto).length;
  const p = pct(done, ts.length);
  const pronta = !gen && ts.length > 0 && done === ts.length;
  const open = state.expanded.has(c.id);
  const count = pronta ? `<span class="cnt ok">pronta ✓</span>` : `<span class="cnt">${done} / ${ts.length} task</span>`;
  return `
  <article class="card song${gen ? " generale" : ""}${pronta ? " pronta" : ""}">
    <div class="song-head" data-action="toggle" data-id="${c.id}" role="button" tabindex="0" aria-expanded="${open}">
      <div class="song-row">
        <h2 class="song-title">${gen ? `Generale<span class="pin" aria-hidden="true">📌</span>` : esc(c.titolo)}</h2>
        <div class="song-right">${gen ? "" : linksHtml(c)}${count}</div>
        <div class="song-artist">${gen ? "Cose da fare non legate a un pezzo" : esc(c.artista || "")}</div>
      </div>
      <div class="bar"><i class="${pronta ? "ok" : ""}" style="width:${p}%"></i></div>
    </div>
    ${open ? songBody(c, ts, idx, tot, gen) : ""}
  </article>`;
}
function songBody(c, ts, idx, tot, gen) {
  const tasks = ts.map(t => `
    <div class="task${t.fatto ? " fatto" : ""}">
      <button class="chk" data-action="check" data-id="${t.id}" aria-label="${t.fatto ? "Segna da fare" : "Segna fatto"}">${t.fatto ? "✓" : ""}</button>
      <span><span class="tt">${esc(t.titolo)}</span>${t.fatto && t.fattoDa ? `<span class="by">fatto da ${esc(t.fattoDa)}</span>` : ""}</span>
      <span class="task-side">${whoTags(t.assegnatari)}<button class="del-mini" data-action="del-task" data-id="${t.id}" aria-label="Elimina task">✕</button></span>
    </div>`).join("");
  const sel = state.drafts[c.id] || new Set();
  const picks = state.membri.map(m => {
    const on = sel.has(m.nome), col = colorOf(m.nome);
    return `<button type="button" class="ini${on ? " on" : ""}${on && LIGHT_BG.has(col) ? " light" : ""}" data-action="pick" data-song="${c.id}" data-nome="${esc(m.nome)}" title="${esc(m.nome)}" aria-pressed="${on}" style="${on ? `background:${col}` : ""}">${esc(siglaOf(m.nome))}</button>`;
  }).join("");
  return `
    <div class="song-body">
      ${ts.length ? tasks : `<p class="empty">Nessun task per ${gen ? "ora" : "questo pezzo"}.</p>`}
      <form class="newtask" data-form="add-task" data-song="${c.id}">
        <div class="inrow">
          <input class="field" name="titolo" data-keep="task-${c.id}" placeholder="Nuovo task" maxlength="120" autocomplete="off" required>
          <button class="btn amb" type="submit">Aggiungi</button>
        </div>
        <div class="picks">${picks}</div>
      </form>
      ${gen ? "" : setupBlock(c) + recsBlock(c) + linkBlock(c)}
      ${gen ? "" : `
      <div class="actions">
        <button class="btn quiet" data-action="up" data-id="${c.id}" ${idx === 0 ? "disabled" : ""} aria-label="Sposta su">↑</button>
        <button class="btn quiet" data-action="down" data-id="${c.id}" ${idx === tot - 1 ? "disabled" : ""} aria-label="Sposta giù">↓</button>
        <button class="btn quiet" data-action="link-edit" data-id="${c.id}">Link</button>
        <span class="sp"></span>
        <button class="x" data-action="del-song" data-id="${c.id}" aria-label="Elimina canzone">✕</button>
      </div>`}
    </div>`;
}
const chiSuona = (key) => state.membri.find(m => m.strumento === key)?.nome || null;
function setupEditor(songId, key, testo, mode) {
  return `
    <form class="${mode === "card" ? "setup-edit" : ""}" data-form="setup" data-song="${songId}" data-key="${key}">
      <textarea name="testo" data-keep="setup-${songId}-${key}" maxlength="400" placeholder="Effetti, preset, suoni, accorgimenti…">${esc(testo || "")}</textarea>
      <div class="ed"><button type="button" class="btn quiet" data-action="setup-cancel">Annulla</button><button class="btn fill" type="submit">Salva</button></div>
    </form>`;
}
function setupBlock(c) {
  const setup = c.setup || {};
  const compilati = STRUMENTI.filter(s => (setup[s.key] || "").trim()).length;
  const open = state.setupOpen.has(c.id);
  const rows = !open ? "" : STRUMENTI.map(s => {
    const chi = chiSuona(s.key);
    const tag = chi ? iniTag(chi) : `<span class="ini none" title="Nessuno">—</span>`;
    const editing = state.editSetup && state.editSetup.song === c.id && state.editSetup.key === s.key;
    const testo = (setup[s.key] || "").trim();
    return `
      <div class="setup-row" ${editing ? "" : `data-action="setup-edit" data-id="${c.id}" data-key="${s.key}" role="button" tabindex="0"`}>
        ${tag}
        <span class="setup-txt"><b>${s.nome}</b>${testo ? esc(testo) : `<span class="empty">da compilare</span>`}</span>
        ${editing ? setupEditor(c.id, s.key, testo, "card") : ""}
      </div>`;
  }).join("");
  return `<button class="disc" data-action="setup-toggle" data-id="${c.id}" aria-expanded="${open}">Setup <span class="n">${compilati} di ${STRUMENTI.length}</span><span class="chev">${open ? "▾" : "▸"}</span></button>${rows}`;
}
function recsBlock(c) {
  const recs = recsOf(c.id);
  if (!recs.length) return "";
  const open = state.recsOpen.has(c.id);
  return `<button class="disc" data-action="recs-toggle" data-id="${c.id}" aria-expanded="${open}">Registrazioni <span class="n">${recs.length}</span><span class="chev">${open ? "▾" : "▸"}</span></button>
    ${open ? recs.map(r => recRow(r, "song")).join("") : ""}`;
}
function linkBlock(c) {
  if (state.linkEdit !== c.id) return "";
  return `
    <form class="link-form" data-form="links" data-song="${c.id}">
      <label>Link Spotify della canzone
        <input class="field" name="spotify" data-keep="link-sp-${c.id}" value="${esc(c.spotifyUrl || "")}" placeholder="https://open.spotify.com/track/…" autocomplete="off" inputmode="url"></label>
      <label>Link Songsterr della canzone
        <input class="field" name="songsterr" data-keep="link-ss-${c.id}" value="${esc(c.songsterrUrl || "")}" placeholder="https://www.songsterr.com/a/wsa/…" autocomplete="off" inputmode="url"></label>
      <p class="hint">Dall'app Spotify o Songsterr: Condividi → Copia link, poi incolla qui. Lascia vuoto per usare la ricerca.</p>
      <div class="ed"><button type="button" class="btn quiet" data-action="link-cancel">Annulla</button><button class="btn fill" type="submit">Salva link</button></div>
    </form>`;
}
function addSongBlock(where, label, cta) {
  if (!state.addOpen[where]) {
    return `<button class="addline" data-action="add-open" data-where="${where}"><span class="plus">+</span>${label}</button>`;
  }
  return `
    <form class="addform" data-form="add-song" data-stato="${where === "proposte" ? "proposta" : "scaletta"}">
      <input class="field" name="titolo" data-keep="add-${where}-titolo" placeholder="Titolo" maxlength="80" autocomplete="off" required>
      <input class="field" name="artista" data-keep="add-${where}-artista" placeholder="Artista" maxlength="60" autocomplete="off">
      <button class="btn fill" type="submit">${cta}</button>
    </form>`;
}

// ---------- proposte ----------
function renderProposte() {
  const lista = proposte();
  const cards = lista.map(c => {
    const r = c.reazioni || {};
    const su = Object.keys(r).filter(n => r[n] === "up");
    const giu = Object.keys(r).filter(n => r[n] === "down");
    const mia = state.user ? r[state.user] : null;
    const open = state.votersOpen.has(c.id);
    const voters = !open ? "" : `
      <div class="voters">
        ${su.length ? `<span class="vg"><span class="vl" aria-label="Mi piace">👍</span>${su.map(iniTag).join("")}</span>` : ""}
        ${giu.length ? `<span class="vg"><span class="vl" aria-label="Non mi piace">👎</span>${giu.map(iniTag).join("")}</span>` : ""}
        ${!su.length && !giu.length ? `<span class="none">Nessun voto ancora.</span>` : ""}
      </div>`;
    return `
    <article class="card">
      <div class="song-head" data-action="voters" data-id="${c.id}" role="button" tabindex="0" aria-expanded="${open}">
        <div class="song-row">
          <h2 class="song-title">${esc(c.titolo)}</h2>
          <div class="song-right">${linksHtml(c)}</div>
          <div class="song-artist">${esc(c.artista || "")}</div>
        </div>
      </div>
      <div class="prop-bar">
        <button class="vote${mia === "up" ? " on up" : ""}" data-action="react-up" data-id="${c.id}" aria-pressed="${mia === "up"}" aria-label="Mi piace, ${su.length}">👍 ${su.length}</button>
        <button class="vote${mia === "down" ? " on down" : ""}" data-action="react-down" data-id="${c.id}" aria-pressed="${mia === "down"}" aria-label="Non mi piace, ${giu.length}">👎 ${giu.length}</button>
        <span class="sp"></span>
        <button class="btn${su.length >= SOGLIA_SCALETTA ? " go" : ""}" data-action="promote" data-id="${c.id}">↑ In scaletta</button>
        <button class="x" data-action="del-song" data-id="${c.id}" aria-label="Elimina proposta">✕</button>
      </div>
      ${voters}
    </article>`;
  }).join("");
  $("#view-proposte").innerHTML =
    (lista.length ? cards : `<p class="empty big">Nessuna proposta. Butta lì un pezzo da provare.</p>`) +
    addSongBlock("proposte", "Proponi un pezzo", "Proponi");
}

// ---------- registrazioni ----------
function recRow(r, mode) {
  const song = state.canzoni.find(c => c.id === r.canzoneId);
  const label = r.etichetta ? ` <em>· ${esc(r.etichetta)}</em>` : "";
  let name;
  if (mode === "song") name = esc(fmtGiorno(r.data)) + label;
  else if (song) name = esc(song.titolo) + label;
  else name = esc(r.etichetta || "Registrazione") + ` <em>· senza canzone</em>`;
  const meta = [r.caricatoDa, fmtMB(r.size)].filter(Boolean).map(esc).join(" · ");
  return `
    <div class="rec">
      <span class="rec-name">${name}</span>
      <span class="rec-meta">${meta}<button class="del-mini" data-action="del-rec" data-id="${r.id}" aria-label="Elimina registrazione">✕</button></span>
      ${mode === "audio" && r.nomeFile ? `<span class="rec-file">${esc(r.nomeFile)}</span>` : ""}
      <div class="player">
        <button class="play" data-action="play" data-id="${r.id}" aria-label="Riproduci">▶</button>
        <div class="line" data-action="seek" data-id="${r.id}"><span><i data-prog="${r.id}"></i></span></div>
        <span class="time" data-time="${r.id}">${fmtTime(r.durata)}</span>
      </div>
    </div>`;
}
function renderAudio() {
  const gruppi = [];
  state.registrazioni.forEach(r => {
    const g = gruppi.find(x => x.data === r.data);
    g ? g.items.push(r) : gruppi.push({ data: r.data, items: [r] });
  });
  const lista = gruppi.map(g => `
    <section class="card rec-group">
      <h2 class="rec-date">${esc(fmtDataLunga(g.data))} <small>${g.items.length} ${g.items.length === 1 ? "registrazione" : "registrazioni"}</small></h2>
      ${g.items.map(r => recRow(r, "audio")).join("")}
    </section>`).join("");
  const opzioni = [...scaletta(), ...proposte()].map(c =>
    `<option value="${c.id}">${esc(c.titolo)}${c.artista ? " – " + esc(c.artista) : ""}</option>`).join("");
  const n = state.pendingFiles.length;
  const filesLabel = n === 0 ? "Scegli file audio…" : n === 1 ? state.pendingFiles[0].name : `${n} file selezionati`;
  const up = state.upload;
  $("#view-audio").innerHTML = `
    ${state.registrazioni.length ? lista : `<p class="empty big">Nessuna registrazione. Carica l'audio delle prove qui sotto.</p>`}
    <form class="upload" data-form="upload">
      <h3>+ Carica registrazione</h3>
      <div class="upload-grid">
        <select class="field wide" name="canzoneId" data-keep="up-song" aria-label="Canzone">
          <option value="">Canzone (facoltativo)</option>${opzioni}
        </select>
        <input class="field" name="etichetta" data-keep="up-label" placeholder="Etichetta, es. seconda take" maxlength="60" autocomplete="off">
        <input class="field" type="date" name="data" data-keep="up-date" value="${oggi()}" aria-label="Data della prova">
        <label class="file-btn wide"><input type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac" multiple><span>${esc(filesLabel)}</span></label>
        <button class="btn fill wide" type="submit" ${up.active ? "disabled" : ""}>${up.active ? "Caricamento…" : "Carica"}</button>
      </div>
      <div class="upload-progress${up.active ? "" : " hidden"}" id="up-prog">
        <div class="bar"><i style="width:${up.pct}%"></i></div><span class="upload-txt">${esc(up.txt)}</span>
      </div>
    </form>`;
}

// player unico: la riproduzione continua anche quando la pagina si ridisegna
const player = $("#player");
function playToggle(id) {
  const r = state.registrazioni.find(x => x.id === id);
  if (!r) return;
  if (state.playId === id) { player.paused ? player.play().catch(() => {}) : player.pause(); return; }
  state.playId = id;
  player.src = r.url;
  player.play().catch(() => toast("Impossibile riprodurre questo file."));
  syncPlayer();
}
function syncPlayer() {
  const cur = state.playId, playing = cur && !player.paused, dur = player.duration;
  document.querySelectorAll(".play").forEach(b => {
    const isCur = b.dataset.id === cur;
    b.classList.toggle("on", isCur);
    const p = isCur && playing;
    b.textContent = p ? "❚❚" : "▶";
    b.setAttribute("aria-label", p ? "Pausa" : "Riproduci");
  });
  document.querySelectorAll("[data-prog]").forEach(i => {
    i.style.width = (i.dataset.prog === cur && isFinite(dur) && dur > 0) ? `${player.currentTime / dur * 100}%` : "0%";
  });
  document.querySelectorAll("[data-time]").forEach(s => {
    const id = s.dataset.time;
    if (id === cur && isFinite(dur) && dur > 0) s.textContent = `${fmtTime(player.currentTime) || "0:00"} / ${fmtTime(dur)}`;
    else s.textContent = fmtTime(state.registrazioni.find(x => x.id === id)?.durata);
  });
}
["play", "pause", "timeupdate", "ended", "loadedmetadata"].forEach(ev => player.addEventListener(ev, syncPlayer));
player.addEventListener("loadedmetadata", () => {
  const r = state.registrazioni.find(x => x.id === state.playId);
  if (r && !r.durata && isFinite(player.duration)) {
    updateDoc(doc(db, "registrazioni", r.id), { durata: Math.round(player.duration) }).catch(() => {});
  }
});

function durataFile(file) {
  return new Promise(resolve => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(isFinite(a.duration) ? Math.round(a.duration) : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    a.src = url;
  });
}
function uploadAudio(file, onProgress) {
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `registrazioni/${Date.now()}-${safe}`;
  const r = storageRef(storage, path);
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(r, file, { contentType: file.type || "audio/mpeg" });
    task.on("state_changed",
      s => onProgress(Math.round(s.bytesTransferred / s.totalBytes * 100)),
      reject,
      async () => resolve({ url: await getDownloadURL(r), path }));
  });
}
function setUpload(patch) {
  Object.assign(state.upload, patch);
  const box = document.getElementById("up-prog");
  if (box) {
    box.classList.toggle("hidden", !state.upload.active);
    box.querySelector(".bar i").style.width = state.upload.pct + "%";
    box.querySelector(".upload-txt").textContent = state.upload.txt;
  }
}

// ---------- cassa ----------
function parseImporto(s) {
  let t = String(s || "").replace(/[€\s]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const v = Number(t);
  return isFinite(v) ? Math.round(v * 100) : NaN;
}
function renderCassa() {
  const movs = [...state.movimenti].sort((a, b) =>
    (b.data || "").localeCompare(a.data || "") || ((b.creato?.seconds || 0) - (a.creato?.seconds || 0)));
  const versato = movs.filter(m => m.tipo === "versamento").reduce((s, m) => s + (m.importoCent || 0), 0);
  const speso = movs.filter(m => m.tipo !== "versamento").reduce((s, m) => s + (m.importoCent || 0), 0);
  const saldo = versato - speso;
  const rows = movs.map(m => {
    const entrata = m.tipo === "versamento";
    const open = state.movOpen === m.id;
    const quando = m.creato?.toDate ? m.creato.toDate().toLocaleDateString("it-IT", { day: "numeric", month: "short" }) : "";
    return `
      <div class="mov" data-action="mov" data-id="${m.id}" role="button" tabindex="0" aria-expanded="${open}">
        <span class="d">${esc(fmtDdMm(m.data))}</span>
        <span><span class="what">${esc(m.descrizione)}</span><span class="w">${esc(m.chi || "")}</span></span>
        <span class="amt${entrata ? " in" : ""}">${entrata ? "+" : "−"} ${NUM.format((m.importoCent || 0) / 100)}</span>
        ${open ? `<div class="mov-detail"><span>Registrato da ${esc(m.registratoDa || "—")}${quando ? ` il ${esc(quando)}` : ""}</span><span class="sp"></span>
          <button class="x" data-action="del-mov" data-id="${m.id}" aria-label="Elimina movimento">✕</button></div>` : ""}
      </div>`;
  }).join("");
  const spesa = state.tipoMov === "spesa";
  const chiOpts = state.membri.map(m =>
    `<option value="${esc(m.nome)}"${m.nome === state.user ? " selected" : ""}>${esc(m.nome)}</option>`).join("");
  $("#view-cassa").innerHTML = `
    <article class="card">
      <div class="saldo">
        <span class="lbl">In cassa</span>
        <span class="tot">versato <b>${euro(versato)}</b><br>speso <b>${euro(speso)}</b></span>
        <span class="big${saldo < 0 ? " neg" : ""}">${euro(saldo)}</span>
      </div>
      ${movs.length ? rows : `<div class="mov-empty">Nessun movimento. Registra il primo qui sotto.</div>`}
      <form class="cassa-form" data-form="mov">
        <div class="seg" role="group" aria-label="Tipo di movimento">
          <button type="button" class="${spesa ? "on" : ""}" data-action="tipo" data-tipo="spesa" aria-pressed="${spesa}">Spesa</button>
          <button type="button" class="${spesa ? "" : "on"}" data-action="tipo" data-tipo="versamento" aria-pressed="${!spesa}">Versamento</button>
        </div>
        <input class="field" name="importo" data-keep="mov-imp" inputmode="decimal" placeholder="€ 0,00" autocomplete="off" required aria-label="Importo">
        <input class="field" type="date" name="data" data-keep="mov-data" value="${oggi()}" aria-label="Data">
        <input class="field wide" name="descrizione" data-keep="mov-desc" placeholder="${spesa ? "Cosa è stato comprato" : "Per cosa, es. quota di ottobre"}" maxlength="80" autocomplete="off" required aria-label="Descrizione">
        <select class="field wide" name="chi" data-keep="mov-chi" aria-label="${spesa ? "Chi ha comprato" : "Chi ha versato"}">${chiOpts}</select>
        <button class="btn fill wide" type="submit">Registra ${spesa ? "spesa" : "versamento"}</button>
      </form>
    </article>`;
}

// ---------- area personale ----------
function renderPersonale() {
  const view = $("#view-personale");
  if (!state.membri.length) { view.innerHTML = `<p class="empty big">Nessuno ancora.</p>`; return; }
  const meName = state.user;
  let nome = state.viewPerson && state.membri.some(m => m.nome === state.viewPerson) ? state.viewPerson : meName;
  if (!nome || !state.membri.some(m => m.nome === nome)) nome = state.membri[0].nome;
  const persona = state.membri.find(m => m.nome === nome);
  const mia = nome === meName;
  const strumento = persona.strumento || "";

  const whoBar = `<div class="who-bar"><span class="lbl">Pagina di</span>${state.membri.map(m => {
    const col = colorOf(m.nome);
    return `<button class="ini${LIGHT_BG.has(col) ? " light" : ""}${m.nome === nome ? " sel" : ""}" style="background:${col}" data-action="view-person" data-nome="${esc(m.nome)}" title="${esc(m.nome)}" aria-pressed="${m.nome === nome}">${esc(siglaOf(m.nome))}</button>`;
  }).join("")}</div>`;

  const mine = state.tasks.filter(t => (t.assegnatari || []).includes(nome) && state.canzoni.some(c => c.id === t.canzoneId));
  const aperti = mine.filter(t => !t.fatto);
  const daFare = aperti.map(t => {
    const song = state.canzoni.find(c => c.id === t.canzoneId);
    const gen = song && isGenerale(song);
    return `
      <div class="ptask">
        <button class="chk" data-action="check" data-id="${t.id}" aria-label="Segna fatto"></button>
        <span><span class="ptask-song${gen ? " gen" : ""}">${gen ? "Generale" : esc(song?.titolo || "—")}</span><span class="tt">${esc(t.titolo)}</span></span>
      </div>`;
  }).join("");

  const daVotare = mia ? proposte().filter(c => !(c.reazioni || {})[nome]) : [];
  const votiHtml = daVotare.map(c => `
    <div class="vrow">
      <span class="t"><b>${esc(c.titolo)}</b><span>${esc(c.artista || "")}</span></span>
      <button class="vote" data-action="react-up" data-id="${c.id}" aria-label="Mi piace">👍</button>
      <button class="vote" data-action="react-down" data-id="${c.id}" aria-label="Non mi piace">👎</button>
    </div>`).join("");

  let setupHtml;
  if (!strumento) {
    setupHtml = `<p class="empty">${mia ? "Scegli il tuo strumento qui sopra per vedere e scrivere i tuoi appunti di setup." : `${esc(nome)} non ha ancora scelto uno strumento.`}</p>`;
  } else {
    const songs = scaletta();
    setupHtml = songs.length ? songs.map(c => {
      const testo = ((c.setup || {})[strumento] || "").trim();
      const editing = state.editSetup && state.editSetup.song === c.id && state.editSetup.key === strumento;
      return `
        <div class="srow" ${editing ? "" : `data-action="setup-edit" data-id="${c.id}" data-key="${strumento}" role="button" tabindex="0"`}>
          <div class="s">${esc(c.titolo)}</div>
          ${editing ? setupEditor(c.id, strumento, testo, "page") : `<div class="snote${testo ? "" : " empty"}">${testo ? esc(testo) : "Tocca per aggiungere appunti"}</div>`}
        </div>`;
    }).join("") : `<p class="empty">Nessuna canzone in scaletta.</p>`;
  }

  const strOpts = `<option value="">Nessuno strumento</option>` + STRUMENTI.map(s =>
    `<option value="${s.key}"${s.key === strumento ? " selected" : ""}>${s.nome}</option>`).join("");
  const stats = [`${aperti.length} ${aperti.length === 1 ? "task aperto" : "task aperti"}`]
    .concat(mia && daVotare.length ? [`${daVotare.length} ${daVotare.length === 1 ? "proposta" : "proposte"} da votare`] : []).join(", ");

  const add = state.addOpen.personale
    ? `<form class="inline-form add-person" data-form="add-member" style="padding:6px 0"><input class="field" name="nome" data-keep="add-membro" placeholder="Nome" maxlength="30" autocomplete="off" required><button class="btn fill" type="submit">Aggiungi</button></form>`
    : `<button class="addline add-person" data-action="add-open" data-where="personale"><span class="plus">+</span>Aggiungi una persona</button>`;

  view.innerHTML = `
    ${whoBar}
    ${mia ? "" : `<p class="viewing">Stai guardando la pagina di ${esc(nome)}. Task e voti restano firmati da te${meName ? `, ${esc(meName)}` : ""}.</p>`}
    <div class="me-head"><h2>${esc(nome)}</h2>${mia
      ? `<select class="instr" data-change="strumento" data-nome="${esc(nome)}" aria-label="Il tuo strumento">${strOpts}</select>`
      : (strumento ? `<span class="instr">${nomeStrumento(strumento)}</span>` : "")}</div>
    <p class="me-stats">${stats}</p>
    <article class="card">
      <h3 class="sec-title">Da fare <small>${aperti.length}</small></h3>
      ${aperti.length ? daFare : `<p class="empty">${mine.length ? "Tutto fatto ★" : "Nessun task assegnato."}</p>`}
    </article>
    ${mia && daVotare.length ? `<article class="card"><h3 class="sec-title">Da votare <small>${daVotare.length}</small></h3>${votiHtml}</article>` : ""}
    <article class="card">
      <h3 class="sec-title">${mia ? "Il mio setup" : "Setup"} <small>${strumento ? nomeStrumento(strumento) : ""}</small></h3>
      ${setupHtml}
    </article>
    ${add}
    <p class="app-ver">Versione ${APP_VERSION} · ${IS_IOS ? "iPhone/iPad" : IS_ANDROID ? "Android" : "computer"}</p>`;
}

// ---------- azioni ----------
async function act(btn) {
  const { action, id } = btn.dataset;
  switch (action) {
    case "toggle":
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      if (state.expanded.has(id)) enrichSong(state.canzoni.find(c => c.id === id));
      render(); break;
    case "voters":
      state.votersOpen.has(id) ? state.votersOpen.delete(id) : state.votersOpen.add(id);
      render(); break;
    case "pick": {
      const song = btn.dataset.song, nome = btn.dataset.nome;
      const set = state.drafts[song] || (state.drafts[song] = new Set());
      set.has(nome) ? set.delete(nome) : set.add(nome);
      const on = set.has(nome), col = colorOf(nome);
      btn.classList.toggle("on", on);
      btn.classList.toggle("light", on && LIGHT_BG.has(col));
      btn.style.background = on ? col : "";
      btn.setAttribute("aria-pressed", on);
      break;
    }
    case "check": {
      const t = state.tasks.find(x => x.id === id);
      if (!t) return;
      const fatto = !t.fatto;
      await updateDoc(doc(db, "tasks", id), {
        fatto, fattoDa: fatto ? (state.user || "") : "", fattoIl: fatto ? serverTimestamp() : null
      }).catch(erroreScrittura);
      if (fatto) maybeCelebrate(t.canzoneId);
      break;
    }
    case "del-task":
      if (confirm("Eliminare questo task?")) await deleteDoc(doc(db, "tasks", id)).catch(erroreScrittura);
      break;
    case "del-song": {
      const c = state.canzoni.find(x => x.id === id);
      if (!c || isGenerale(c)) return;
      const msg = c.stato === "proposta" ? `Eliminare la proposta "${c.titolo}"?` : `Eliminare "${c.titolo}" e i suoi task?`;
      if (!confirm(msg)) return;
      const batch = writeBatch(db);
      tasksOf(id).forEach(t => batch.delete(doc(db, "tasks", t.id)));
      recsOf(id).forEach(r => batch.update(doc(db, "registrazioni", r.id), { canzoneId: "" }));
      batch.delete(doc(db, "canzoni", id));
      state.expanded.delete(id);
      await batch.commit().catch(erroreScrittura);
      break;
    }
    case "up": case "down": {
      const lista = scaletta();
      const i = lista.findIndex(c => c.id === id);
      const j = action === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= lista.length) return;
      const a = lista[i], b = lista[j];
      const batch = writeBatch(db);
      batch.update(doc(db, "canzoni", a.id), { ordine: b.ordine });
      batch.update(doc(db, "canzoni", b.id), { ordine: a.ordine });
      await batch.commit().catch(erroreScrittura);
      break;
    }
    case "react-up": case "react-down": {
      if (!state.user) { toast("Scegli prima il tuo nome."); return; }
      const c = state.canzoni.find(x => x.id === id);
      if (!c) return;
      const voto = action === "react-up" ? "up" : "down";
      const reazioni = { ...(c.reazioni || {}) };
      if (reazioni[state.user] === voto) delete reazioni[state.user];
      else reazioni[state.user] = voto;
      if (!btn.closest("#view-personale")) state.votersOpen.add(id);
      await updateDoc(doc(db, "canzoni", id), { reazioni }).catch(erroreScrittura);
      break;
    }
    case "promote": {
      const c = state.canzoni.find(x => x.id === id);
      const maxOrd = scaletta().reduce((m, x) => Math.max(m, x.ordine || 0), 0);
      await updateDoc(doc(db, "canzoni", id), { stato: "scaletta", ordine: maxOrd + 1 }).catch(erroreScrittura);
      toast(`"${c?.titolo || "Pezzo"}" è in scaletta.`);
      break;
    }
    case "play": playToggle(id); break;
    case "seek": {
      if (state.playId !== id) { playToggle(id); break; }
      if (isFinite(player.duration)) {
        const r = btn.getBoundingClientRect();
        player.currentTime = Math.max(0, Math.min(1, (window.__lastX - r.left) / r.width)) * player.duration;
      }
      break;
    }
    case "del-rec": {
      const r = state.registrazioni.find(x => x.id === id);
      if (!r || !confirm("Eliminare questa registrazione?")) return;
      if (state.playId === id) { player.pause(); state.playId = null; }
      try { if (r.path) await deleteObject(storageRef(storage, r.path)); } catch (e) { /* file già assente */ }
      await deleteDoc(doc(db, "registrazioni", id)).catch(erroreScrittura);
      break;
    }
    case "add-open": {
      const w = btn.dataset.where;
      state.addOpen[w] = true;
      render();
      document.querySelector(w === "personale" ? '[data-keep="add-membro"]' : `[data-keep="add-${w}-titolo"]`)?.focus();
      break;
    }
    case "tipo":
      state.tipoMov = btn.dataset.tipo;
      render(); break;
    case "setup-toggle":
      state.setupOpen.has(id) ? state.setupOpen.delete(id) : state.setupOpen.add(id);
      if (!state.setupOpen.has(id) && state.editSetup?.song === id) state.editSetup = null;
      render(); break;
    case "recs-toggle":
      state.recsOpen.has(id) ? state.recsOpen.delete(id) : state.recsOpen.add(id);
      render(); break;
    case "setup-edit":
      state.editSetup = { song: id, key: btn.dataset.key };
      render();
      document.querySelector(`[data-keep="setup-${id}-${btn.dataset.key}"]`)?.focus();
      break;
    case "setup-cancel":
      state.editSetup = null;
      render(); break;
    case "link-edit":
      state.linkEdit = state.linkEdit === id ? null : id;
      render(); break;
    case "link-cancel":
      state.linkEdit = null;
      render(); break;
    case "view-person":
      state.viewPerson = btn.dataset.nome === state.user ? null : btn.dataset.nome;
      state.editSetup = null;
      render(); break;
    case "mov":
      state.movOpen = state.movOpen === id ? null : id;
      render(); break;
    case "del-mov": {
      const m = state.movimenti.find(x => x.id === id);
      if (!m || !confirm(`Eliminare "${m.descrizione}" (${euro(m.importoCent)})?`)) return;
      state.movOpen = null;
      await deleteDoc(doc(db, "movimenti", id)).catch(erroreScrittura);
      break;
    }
  }
}
const mainEl = document.querySelector("main");
mainEl.addEventListener("click", e => {
  window.__lastX = e.clientX;
  if (e.target.closest("a[data-link]")) return;       // i link aprono Spotify/Songsterr
  const btn = e.target.closest("[data-action]");
  if (!btn || btn.disabled) return;
  // un click su un bottone interno non deve aprire/chiudere la scheda
  act(btn);
});
mainEl.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = e.target;
  if (el.matches?.('[role="button"][data-action]')) { e.preventDefault(); act(el); }
});
mainEl.addEventListener("change", e => {
  if (e.target.dataset.change === "strumento") {
    const m = state.membri.find(x => x.nome === e.target.dataset.nome);
    if (m) updateDoc(doc(db, "membri", m.id), { strumento: e.target.value }).catch(erroreScrittura);
    return;
  }
  if (e.target.type !== "file") return;
  state.pendingFiles = [...e.target.files];
  const lbl = e.target.closest(".file-btn")?.querySelector("span");
  const n = state.pendingFiles.length;
  if (lbl) lbl.textContent = n === 0 ? "Scegli file audio…" : n === 1 ? state.pendingFiles[0].name : `${n} file selezionati`;
});

mainEl.addEventListener("submit", async e => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;

  if (kind === "add-song") {
    const titolo = form.titolo.value.trim();
    if (!titolo) return;
    const artista = form.artista.value.trim();
    const stato = form.dataset.stato === "proposta" ? "proposta" : "scaletta";
    const where = stato === "proposta" ? "proposte" : "scaletta";
    form.titolo.value = ""; form.artista.value = "";
    const maxOrd = state.canzoni.reduce((m, c) => Math.max(m, c.ordine || 0), 0);
    const ref = await scrivi(addDoc(collection(db, "canzoni"), {
      titolo, artista, stato, ordine: maxOrd + 1, spotifyUrl: "", reazioni: {},
      propostaDa: stato === "proposta" ? (state.user || "") : "", creato: serverTimestamp()
    }), () => { rimetti(`add-${where}-titolo`, titolo); rimetti(`add-${where}-artista`, artista); });
    if (ref) {
      toast(stato === "proposta" ? "Proposta aggiunta." : "Canzone aggiunta.");
      enrichSong({ id: ref.id, titolo, artista });
    }
  }

  if (kind === "add-task") {
    const titolo = form.titolo.value.trim();
    if (!titolo) return;
    const song = form.dataset.song;
    const assegnatari = [...(state.drafts[song] || [])];
    form.titolo.value = "";
    delete state.drafts[song];
    form.querySelectorAll("button.ini.on").forEach(b => { b.classList.remove("on", "light"); b.style.background = ""; });
    await scrivi(addDoc(collection(db, "tasks"), {
      canzoneId: song, titolo, assegnatari, fatto: false, fattoDa: "", creato: serverTimestamp()
    }), () => rimetti(`task-${song}`, titolo));
  }

  if (kind === "add-member") {
    const nome = form.nome.value.trim().replace(/\s+/g, " ");
    if (!nome) return;
    form.nome.value = "";
    state.addOpen.personale = false;
    if (state.membri.some(m => m.nome.toLowerCase() === nome.toLowerCase())) { toast(`${nome} c'è già.`); render(); return; }
    await addDoc(collection(db, "membri"), { nome, creato: serverTimestamp() }).catch(erroreScrittura);
  }

  if (kind === "setup") {
    const song = form.dataset.song, key = form.dataset.key;
    const testo = form.testo.value.trim();
    form.testo.value = "";
    state.editSetup = null;
    await scrivi(updateDoc(doc(db, "canzoni", song), { [`setup.${key}`]: testo }));
    render();
  }

  if (kind === "links") {
    const song = form.dataset.song;
    const spIn = form.spotify.value.trim(), ssIn = form.songsterr.value.trim();
    const sp = spIn ? (spIn.match(SPOTIFY_RE) || [null])[0] : "";
    const ss = ssIn ? (ssIn.match(SONGSTERR_RE) || [null])[0] : "";
    if (sp === null) { toast("Il link Spotify deve essere quello di un brano (open.spotify.com/track/…)."); return; }
    if (ss === null) { toast("Il link Songsterr deve essere quello della canzone (songsterr.com/a/…)."); return; }
    form.spotify.value = ""; form.songsterr.value = "";
    state.linkEdit = null;
    await updateDoc(doc(db, "canzoni", song), { spotifyUrl: sp, songsterrUrl: ss.replace(/[?#].*$/, "") }).catch(erroreScrittura);
    toast("Link salvati.");
    render();
  }

  if (kind === "mov") {
    const importoCent = parseImporto(form.importo.value);
    const descrizione = form.descrizione.value.trim();
    if (!(importoCent > 0) || importoCent > 10000000) { toast("Scrivi un importo valido, es. 18,90."); form.importo.focus(); return; }
    if (!descrizione) return;
    const data = form.data.value || oggi();
    const chi = form.chi.value || state.user || "";
    const tipo = state.tipoMov;
    const importoTesto = form.importo.value;
    form.importo.value = ""; form.descrizione.value = "";
    const ok = await scrivi(addDoc(collection(db, "movimenti"), {
      tipo, importoCent, data, descrizione, chi, registratoDa: state.user || "", creato: serverTimestamp()
    }), () => { rimetti("mov-imp", importoTesto); rimetti("mov-desc", descrizione); });
    if (ok) toast(tipo === "spesa" ? `Spesa registrata: ${euro(importoCent)}.` : `Versamento registrato: ${euro(importoCent)}.`);
  }

  if (kind === "upload") {
    const files = state.pendingFiles;
    if (!files.length) { toast("Scegli almeno un file audio."); return; }
    const canzoneId = form.canzoneId.value;
    const etichetta = form.etichetta.value.trim();
    const data = form.data.value || oggi();
    state.pendingFiles = [];
    setUpload({ active: true, pct: 0, txt: "" });
    const submit = form.querySelector("button[type=submit]");
    if (submit) { submit.disabled = true; submit.textContent = "Caricamento…"; }
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setUpload({ pct: 0, txt: files.length > 1 ? `File ${i + 1} di ${files.length}: ${f.name}` : f.name });
        const durata = await durataFile(f);
        const up = await uploadAudio(f, p => setUpload({ pct: p }));
        await addDoc(collection(db, "registrazioni"), {
          canzoneId, etichetta, nomeFile: f.name, url: up.url, path: up.path,
          size: f.size, durata, data, caricatoDa: state.user || "", creato: serverTimestamp()
        });
      }
      toast(files.length > 1 ? "Registrazioni caricate." : "Registrazione caricata.");
      document.querySelectorAll('main [data-keep="up-label"]').forEach(el => { el.value = ""; });
    } catch (ex) {
      toast("Caricamento non riuscito: " + (ex.code || ex.message));
    } finally {
      setUpload({ active: false, pct: 0, txt: "" });
      render();
    }
  }
});

// ---------- link trovati in automatico (Cloud Function con Gemini) ----------
// La funzione risponde con un URL; lo teniamo solo se è del servizio giusto.
async function enrichLink(songId, titolo, artista, cosa) {
  try {
    const r = await fetch("/api/spotify-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titolo, artista, cosa })
    });
    const j = await r.json();
    const re = cosa === "songsterr" ? SONGSTERR_RE : SPOTIFY_RE;
    const url = j && typeof j.url === "string" ? (j.url.match(re) || [null])[0] : null;
    if (!url) return;
    const c = state.canzoni.find(x => x.id === songId);
    const campo = cosa === "songsterr" ? "songsterrUrl" : "spotifyUrl";
    if (c && !c[campo]) await updateDoc(doc(db, "canzoni", songId), { [campo]: url });
  } catch (e) { /* resta il link di ricerca */ }
}
function enrichSong(c) {
  if (!c || isGenerale(c) || state.enrichTried.has(c.id)) return;
  state.enrichTried.add(c.id);
  if (!c.spotifyUrl) enrichLink(c.id, c.titolo, c.artista, "spotify");
  if (!c.songsterrUrl) enrichLink(c.id, c.titolo, c.artista, "songsterr");
}

// ---------- piccoli premi ----------
function maybeCelebrate(canzoneId) {
  const song = state.canzoni.find(c => c.id === canzoneId);
  if (!song || isGenerale(song)) return;
  const ts = tasksOf(canzoneId);
  if (ts.length > 0 && ts.filter(t => !t.fatto).length <= 1) {
    setTimeout(() => toast(`★ "${song.titolo}" è pronta.`), 350);
  }
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2800);
}
