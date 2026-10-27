// ============================================================
// Il ritmo della sala prove
// Vanilla JS + Firebase (Auth con account condiviso, Firestore, Storage)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, getFirestore,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, writeBatch, arrayUnion, arrayRemove, deleteField, FieldPath
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { creaDiretta } from "./diretta.js";

// ---------- costanti ----------
// Email dell'unico account condiviso della band (creato in Console Firebase → Authentication).
// Non è una casella vera: serve solo a Firebase. La password non sta nel codice.
const BAND_EMAIL = window.BAND_EMAIL || "band@il-ritmo-della-sala-prove.web.app";
// Secondo account condiviso, per i fan: guardano scaletta e proposte e ascoltano, ma non modificano nulla
// (lo impongono le regole del database) e non vedono cassa e pagine personali. La password la imposta la band da Personale.
const FAN_EMAIL = window.FAN_EMAIL || "fan@il-ritmo-della-sala-prove.web.app";
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
const APP_VERSION = "35";
// Versione dei dati salvati sul telefono: si aumenta solo quando serve una pulizia (vedi MIGRAZIONI).
const DATA_VERSION = 2;
// parti del setup di una canzone: legate alla parte, non alla persona (chi suona cosa cambia da pezzo a pezzo).
// Ogni canzone ha le sue parti (chiavi di canzoni.setup, anche con testo vuoto); oltre a queste si possono
// aggiungere parti con un nome libero (la chiave è il nome stesso, es. "Banjo").
const STRUMENTI = [
  { key: "chitarra1", nome: "Chitarra 1" },
  { key: "chitarra2", nome: "Chitarra 2" },
  { key: "acustica", nome: "Acustica" },
  { key: "basso", nome: "Basso" },
  { key: "batteria", nome: "Batteria" },
  { key: "tastiera", nome: "Tastiera" },
  { key: "fisarmonica", nome: "Fisarmonica" },
  { key: "voce", nome: "Voce" }
];
const ordineParte = (k) => { const i = STRUMENTI.findIndex(s => s.key === k); return i < 0 ? 100 : i; };
const nomeParte = (k) => STRUMENTI.find(s => s.key === k)?.nome || k;
const ordinaParti = (a, b) => ordineParte(a) - ordineParte(b) || a.localeCompare(b, "it");
// parti di una canzone, nell'ordine dell'elenco e poi quelle con nome libero
const partiDi = (c) => Object.keys(c.setup || {}).filter(k => typeof c.setup[k] === "string").sort(ordinaParti);
// parti con nome libero già usate in qualche canzone: si propongono anche nelle altre
function partiLibere() {
  const s = new Set();
  state.canzoni.forEach(c => Object.keys(c.setup || {}).forEach(k => { if (ordineParte(k) === 100) s.add(k); }));
  return [...s].sort(ordinaParti);
}
// dal nome scritto alla chiave: le parti dell'elenco e quelle già usate si riconoscono anche scritte diverse
function chiaveParte(nome) {
  let n = String(nome || "").replace(/["'`<>\\.]/g, "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!n) return "";
  const basso = n.toLowerCase();
  const std = STRUMENTI.find(s => s.nome.toLowerCase() === basso || s.key === basso);
  if (std) return std.key;
  const gia = partiLibere().find(k => k.toLowerCase() === basso);
  return gia || n.charAt(0).toUpperCase() + n.slice(1);
}
const SPOTIFY_RE = /https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]+/;
const SONGSTERR_RE = /https:\/\/(?:www\.)?songsterr\.com\/a\/[^\s"'<>]+/;
// l'app Songsterr su Android apre solo le pagine delle canzoni su www.songsterr.com
const normalizzaSongsterr = (u) => String(u || "").replace(/^https:\/\/songsterr\.com/i, "https://www.songsterr.com").replace(/[?#].*$/, "");
// funzione che tiene aggiornate le playlist Spotify (vedi functions/index.js)
const PLAYLIST_FN = "https://us-central1-il-ritmo-della-sala-prove.cloudfunctions.net/playlist";
// notifiche push (vedi functions/notifiche.js): ognuno sceglie sul suo telefono quali ricevere
const NOTIFICHE_FN = "https://us-central1-il-ritmo-della-sala-prove.cloudfunctions.net/notifiche";
// password dei fan (la imposta, cambia o disattiva la band) e messaggi dei fan alla band: vedi functions/accesso.js
const ACCESSO_FN = "https://us-central1-il-ritmo-della-sala-prove.cloudfunctions.net/accesso";
const EVENTI_PUSH = [
  { key: "proposta", nome: "Nuove proposte da votare" },
  { key: "task", nome: "Task assegnate a te" },
  { key: "registrazione", nome: "Nuove registrazioni" },
  { key: "diretta", nome: "Diretta dalla sala avviata" },
  { key: "scaletta", nome: "Proposte passate in scaletta" }
];
// i fan non hanno task e non votano: le proposte arrivano solo come novità
const eventiPush = () => state.fan
  ? EVENTI_PUSH.filter(e => e.key !== "task").map(e => e.key === "proposta" ? { ...e, nome: "Nuove proposte" } : e)
  : EVENTI_PUSH;
const PUSH_OK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const IN_APP = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;

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
  fan: false,                 // entrato con la password dei fan: sola lettura, niente cassa e pagine personali
  fanNome: store.get("prove_fan_nome"),   // il nome del fan resta sul telefono, come quello della band
  fanMenu: false,             // pannello del fan (tocco sul nome in alto)
  fanCambia: false,           // nel pannello: campo per cambiare nome
  user: store.get("prove_user"),
  userId: store.get("prove_user_id"),   // l'identità del telefono segue la persona anche se cambia nome
  renaming: null,                        // id della persona che si sta rinominando
  membri: [], canzoni: [], tasks: [], registrazioni: [], movimenti: [], bacheca: [],
  ready: { membri: false, canzoni: false, tasks: false, registrazioni: false, movimenti: false, bacheca: false },
  subscribed: false,
  generaleOk: false,
  tab: (store.get("prove_tab") || "scaletta").replace("persone", "personale"),
  viewPerson: null,           // di chi si guarda la pagina personale (null = la propria)
  songPage: null,             // id della canzone aperta nella sua pagina (dentro Scaletta)
  listScroll: 0,              // dove era la lista della scaletta prima di aprire una canzone
  addTaskOpen: null,          // id della canzone con il modulo "nuovo task" aperto
  partePicker: null,          // id della canzone con l'elenco delle parti da aggiungere aperto
  parteAltro: false,          // nell'elenco: campo per una parte con nome libero
  editSetup: null,            // { song, key } riga di setup in modifica
  linkEdit: null,             // id della canzone con il modulo dei link aperto
  enrichTried: new Set(),
  votersOpen: new Set(),
  addOpen: { scaletta: false, proposte: false, personale: false, cassa: false },
  drafts: {},                 // songId → Set di nomi selezionati per il nuovo task
  tipoMov: "spesa",
  movOpen: null,
  pendingFiles: [],
  righeUpload: [],            // una riga per file scelto: { file, breve, data, ora, canzoneId, etichetta, salta }
  upload: { active: false, pct: 0, txt: "" },
  playId: null,
  coda: null,                 // registrazioni da ascoltare di fila (id), quella in riproduzione compresa
  push: null,                 // { endpoint, membroId, eventi } se le notifiche sono attive su questo telefono
  pushOcc: false,
  vaiCanzone: null,           // canzone da aprire appena arrivano i dati (tocco su una notifica)
  commentaPost: null,         // bacheca: post con il campo del commento aperto
  recInfo: null,              // registrazione con i dettagli aperti (file, chi l'ha caricata, Elimina)
  accesso: null,              // per la band: { attivo, password, aggiornata, da } dell'accesso dei fan
  accessoStato: "",             // "" | "carico" | "errore"
  accessoForm: false, accessoOcc: false, accessoVedi: false,
  spIcon: "icons/spotify.png",
  sigle: {},
  deniedShown: false
};

try { state.push = JSON.parse(store.get("prove_push") || "null"); } catch { state.push = null; }
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
// pezzi nostri: canzoni della band, non su Spotify (niente ricerca automatica, niente icone, fuori dalle playlist)
const isNostro = (c) => !!(c && c.nostro);
const scaletta = () => state.canzoni.filter(c => !isGenerale(c) && c.stato !== "proposta");
const proposte = () => state.canzoni.filter(c => c.stato === "proposta");
// classifica delle proposte: più 👍 prima; a parità, meno 👎; poi la più vecchia
const contaVoti = (c, v) => Object.values(c.reazioni || {}).filter(x => x === v).length;
const perClassifica = (a, b) => contaVoti(b, "up") - contaVoti(a, "up") || contaVoti(a, "down") - contaVoti(b, "down") || (a.ordine || 0) - (b.ordine || 0);
// dove finisce una proposta nella classifica di chi usa l'app dopo il suo voto
function posizioneDopoVoto(id, voto) {
  const me = state.user;
  const lista = proposte()
    .map(c => c.id === id ? { ...c, reazioni: { ...(c.reazioni || {}), [me]: voto } } : c)
    .filter(c => (c.reazioni || {})[me]).sort(perClassifica);
  return { pos: lista.findIndex(c => c.id === id) + 1, tot: lista.length };
}
const msgPosizione = (id, voto) => { const { pos, tot } = posizioneDopoVoto(id, voto); return pos ? ` Ora è ${pos}ª su ${tot}.` : ""; };
const tasksOf = (id) => state.tasks.filter(t => t.canzoneId === id);
// Task con più persone: ognuno spunta la sua parte (campo fattiDa, elenco di nomi);
// la task è fatta quando l'hanno spuntata tutti. Task senza fattiDa (vecchie): vale "fatto".
const assegnati = (t) => t.assegnatari || [];
const multipla = (t) => assegnati(t).length > 1;
function fattiDi(t) {
  if (multipla(t) && Array.isArray(t.fattiDa)) return t.fattiDa.filter(n => assegnati(t).includes(n));
  return t.fatto ? assegnati(t).slice() : [];
}
const taskFatta = (t) => multipla(t) ? assegnati(t).every(n => fattiDi(t).includes(n)) : !!t.fatto;
const parteFatta = (t, nome) => multipla(t) ? fattiDi(t).includes(nome) : !!t.fatto;
const recsOf = (id) => state.registrazioni.filter(r => r.canzoneId === id);
// dentro lo stesso giorno le registrazioni vanno nell'ordine in cui sono state caricate (l'ordine della prova)
const msDi = (t) => (t && t.toMillis ? t.toMillis() : t && t.seconds ? t.seconds * 1000 : 0);
const perOrdineDiProva = (a, b) => msDi(a.creato) - msDi(b.creato) || String(a.nomeFile || "").localeCompare(String(b.nomeFile || ""), "it", { numeric: true });
// riproduzione di fila: le registrazioni dello stesso giorno (da Audio) o della stessa canzone (dalla sua pagina)
const codaGiorno = (data) => state.registrazioni.filter(r => (r.data || "") === (data || "")).sort(perOrdineDiProva).map(r => r.id);
const codaCanzone = (canzoneId) => recsOf(canzoneId).map(r => r.id);
// preferite: le registrazioni venute meglio (campo preferita), nell'ordine della scaletta, poi proposte,
// poi quelle senza canzone; a parità di canzone dalla più recente
const perData = (a, b) => String(b.data || "").localeCompare(String(a.data || "")) || perOrdineDiProva(b, a);
function preferite() {
  const ordine = [...scaletta(), ...proposte()].map(c => c.id);
  const pos = (r) => { const i = ordine.indexOf(r.canzoneId); return i < 0 ? ordine.length : i; };
  return state.registrazioni.filter(r => r.preferita).sort((a, b) => pos(a) - pos(b) || perData(a, b));
}
const codaPreferite = () => preferite().map(r => r.id);
// la coda da cui parte una registrazione dipende da dove la si tocca: blocco delle preferite, pagina della canzone o giorno
function codaDi(btn, id) {
  const r = state.registrazioni.find(x => x.id === id);
  if (btn.closest(".pref-group")) return codaPreferite();
  return r && btn.closest(".pagina") && r.canzoneId ? codaCanzone(r.canzoneId) : codaGiorno(r && r.data);
}
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
// Con le playlist collegate il brano si apre "dentro" la playlist della sua sezione:
// finito il brano, Spotify continua con i successivi della scaletta (o delle proposte).
// Parametro "context" non documentato da Spotify: se lo ignora, si apre il brano da solo come prima.
function linkSpotify(c) {
  const track = (c.spotifyUrl || "").match(/track\/([A-Za-z0-9]+)/);
  if (!track) return null;
  const info = playlistInfo();
  const kind = c.stato === "proposta" ? "proposte" : "scaletta";
  const pl = info && (String(info[kind] || "").match(/playlist\/([A-Za-z0-9]+)/) || [])[1];
  if (!pl) return { url: c.spotifyUrl, kind: null };
  return { url: `https://open.spotify.com/track/${track[1]}?context=${encodeURIComponent("spotify:playlist:" + pl)}`, kind };
}
// icone a linea sottile (simboli in index.html)
const IC = (nome, cls = "i") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${nome}"/></svg>`;
// logo di Spotify a tinta unica (maschera sull'icona ufficiale, colore del testo)
const SP_ICO = `<span class="ico-sp" aria-hidden="true"></span>`;
function linksHtml(c, conTesto) {
  if (isNostro(c)) return `<span class="nostro-tag">pezzo nostro</span>`;
  const q = encodeURIComponent(songQuery(c));
  const ls = linkSpotify(c);
  const sp = ls ? ls.url : `https://open.spotify.com/search/${q}`;
  const spTitolo = ls && ls.kind ? `Ascolta nella playlist ${ls.kind === "scaletta" ? "della scaletta" : "delle proposte"}` : "Ascolta su Spotify";
  const tab = c.songsterrUrl ? normalizzaSongsterr(c.songsterrUrl) : `https://www.songsterr.com/?pattern=${q}`;
  return `<div class="links">
    <a ${appLink(sp, "com.spotify.music")} data-link title="${spTitolo}" aria-label="${spTitolo}">${SP_ICO}${conTesto ? "<span>Spotify</span>" : ""}</a>
    <a ${appLink(tab, "com.songsterr")} data-link title="${c.songsterrUrl ? "Apri la tablatura su Songsterr" : "Cerca la tablatura su Songsterr"}" aria-label="Tablatura su Songsterr"><svg class="ico" aria-hidden="true"><use href="#ico-clef"/></svg>${conTesto ? "<span>Tablatura</span>" : ""}</a>
  </div>`;
}
// icona Spotify: icons/spotify.png; se non si carica, un'icona di ripiego
document.addEventListener("error", e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains("ico-sp")) return;
  if (img.getAttribute("src") !== state.spIcon) { img.src = state.spIcon; return; }
  if (state.spIcon.endsWith(".svg")) state.spIcon = "icons/spotify.png";
  else if (state.spIcon.endsWith(".png")) state.spIcon = SP_FALLBACK;
  else return;
  document.querySelectorAll("img.ico-sp").forEach(i => { i.src = state.spIcon; });
}, true);

// ---------- playlist Spotify ----------
// Le playlist "Scaletta" e "Proposte" stanno sull'account Spotify collegato e le scrive
// solo la funzione. I loro link arrivano nel documento Generale (campo playlist).
const playlistInfo = () => state.canzoni.find(c => c.id === GENERALE_ID)?.playlist || null;
const haLinkSpotify = (c) => SPOTIFY_RE.test(c.spotifyUrl || "");
function contaBrani(lista) {
  const con = lista.filter(haLinkSpotify).length, nostri = lista.filter(isNostro).length;
  return { con, nostri, senza: lista.length - con - nostri };
}
function descriviBrani(lista) {
  const { con, nostri, senza } = contaBrani(lista);
  return `${con} ${con === 1 ? "brano" : "brani"}${senza ? ` · ${senza} senza link` : ""}${nostri ? ` · ${nostri} ${nostri === 1 ? "nostro" : "nostri"}` : ""}`;
}
function plStrip(kind) {
  const info = playlistInfo();
  if (!info || !info[kind]) return "";
  const lista = kind === "scaletta" ? scaletta() : proposte();
  return `
    <a class="pl-strip" ${appLink(info[kind], "com.spotify.music")} data-link>
      ${SP_ICO}
      <span class="pl-txt"><b>${kind === "scaletta" ? "Playlist della scaletta" : "Playlist delle proposte"}</b><small>${descriviBrani(lista)}${kind === "proposte" ? " · dalla più votata" : ""}</small></span>
      <span class="pl-go" aria-hidden="true">${IC("freccia")}</span>
    </a>`;
}
async function chiamaPlaylist(op, extra = {}, keepalive = false) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch(PLAYLIST_FN, {
    method: "POST", keepalive,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ op, ...extra })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `errore ${r.status}`);
  return j;
}
// ---------- notifiche push ----------
async function chiamaNotifiche(op, extra = {}, keepalive = false) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch(NOTIFICHE_FN, {
    method: "POST", keepalive,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ op, ...extra })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `errore ${r.status}`);
  return j;
}
function salvaPush(p) {
  state.push = p;
  if (p) store.set("prove_push", JSON.stringify(p)); else store.del("prove_push");
}
const chiaveInByte = (b64) => {
  const s = (b64 + "=".repeat((4 - b64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
};
// segnala un evento: le notifiche le prepara e le manda la funzione (chi fa l'azione non la riceve)
function notifica(tipo, extra = {}) {
  if (!auth.currentUser || state.fan) return;
  chiamaNotifiche("evento", { tipo, da: state.user || "", ...extra }, true).catch(e => console.warn("[notifiche]", e.message));
}
async function attivaNotifiche() {
  if (!state.userId && !state.fan) { toast("Scegli prima il tuo nome."); return; }
  state.pushOcc = true; render();
  try {
    // il permesso va chiesto subito, dentro il tocco sul pulsante
    const permesso = await Notification.requestPermission();
    if (permesso !== "granted") {
      toast(permesso === "denied" ? "Notifiche bloccate: si riattivano dalle impostazioni del telefono." : "Notifiche non attivate.");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await chiamaNotifiche("chiave");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiaveInByte(publicKey) });
    const eventi = eventiPush().map(e => e.key);
    const membroId = state.fan ? null : state.userId;
    await chiamaNotifiche("iscrivi", { sub: sub.toJSON(), membroId, eventi });
    salvaPush({ endpoint: sub.endpoint, membroId, fan: state.fan, eventi });
    toast("Notifiche attive su questo telefono.");
  } catch (e) {
    toast("Notifiche non attivate: " + (e.message || e));
  } finally {
    state.pushOcc = false; render();
  }
}
async function disattivaNotifiche() {
  const p = state.push;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe().catch(() => {});
  } catch (e) { /* niente da togliere */ }
  if (p) chiamaNotifiche("disiscrivi", { endpoint: p.endpoint }).catch(() => {});
  salvaPush(null);
  render();
  toast("Notifiche disattivate su questo telefono.");
}
// tiene allineata l'iscrizione: persona cambiata sul telefono, permesso tolto, iscrizione rinnovata dal browser.
// I fan si riscrivono a ogni apertura: se la band ha cambiato la password, l'iscrizione passa a quella nuova.
async function riallineaNotifiche() {
  if (!state.push || !PUSH_OK || !auth.currentUser) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub || Notification.permission !== "granted") { salvaPush(null); render(); return; }
    const membroId = state.fan ? null : state.userId;
    const cambiata = sub.endpoint !== state.push.endpoint || (state.push.membroId || null) !== membroId || !!state.push.fan !== state.fan;
    if (cambiata || state.fan) {
      if (!membroId && !state.fan) return;
      const ammessi = eventiPush().map(e => e.key);
      const eventi = state.push.eventi.filter(k => ammessi.includes(k));
      await chiamaNotifiche("iscrivi", { sub: sub.toJSON(), membroId, eventi });
      if (sub.endpoint !== state.push.endpoint) chiamaNotifiche("disiscrivi", { endpoint: state.push.endpoint }).catch(() => {});
      salvaPush({ ...state.push, endpoint: sub.endpoint, membroId, fan: state.fan, eventi });
    }
  } catch (e) { console.warn("[notifiche] riallineamento", e.message); }
}
function notificheCorpo() {
  if (IS_IOS && !IN_APP) {
    return `<p class="nt-txt">Su iPhone le notifiche arrivano solo all'app aggiunta alla schermata Home. In Safari tocca <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>, poi apri l'app da lì e torna qui.</p>`;
  }
  if (!PUSH_OK) return `<p class="nt-txt">Questo browser non riceve notifiche.</p>`;
  if (Notification.permission === "denied" && !state.push) {
    return `<p class="nt-txt">Le notifiche dell'app sono bloccate nelle impostazioni del telefono: vanno riattivate lì, poi torna qui.</p>`;
  }
  if (!state.push) {
    return `<p class="nt-txt">Avvisi sul telefono anche ad app chiusa: proposte nuove, ${state.fan ? "" : "task assegnate a te, "}registrazioni, diretta e passaggi in scaletta. Poi scegli quali tenere.</p>
      <button class="btn fill" data-action="push-attiva" ${state.pushOcc ? "disabled" : ""}>${state.pushOcc ? "Attivo…" : "Attiva notifiche"}</button>`;
  }
  return eventiPush().map(e => {
    const on = state.push.eventi.includes(e.key);
    return `<button class="nt-row" data-action="push-evento" data-key="${e.key}" aria-pressed="${on}"><span class="nt-box">${on ? IC("check") : ""}</span><span>${e.nome}</span></button>`;
  }).join("") + `<button class="btn quiet nt-off" data-action="push-disattiva">Disattiva su questo telefono</button>`;
}
function notificheCard() {
  return `
    <article class="card ntcard">
      <h3 class="sec-title">Notifiche <small>${state.push ? "attive su questo telefono" : ""}</small></h3>
      <div class="pg-sec">${notificheCorpo()}</div>
    </article>`;
}
// ---------- accesso dei fan ----------
// la band imposta la password; i fan pubblicano in Bacheca
async function chiamaAccesso(op, extra = {}) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch(ACCESSO_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ op, da: state.fan ? (state.fanNome || "") : (state.user || ""), ...extra })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `errore ${r.status}`);
  return j;
}
async function caricaAccesso() {
  if (state.fan || state.accessoStato === "carico") return;
  state.accessoStato = "carico";
  try { state.accesso = await chiamaAccesso("stato"); state.accessoStato = ""; }
  catch (e) { console.warn("[accesso]", e.message); state.accessoStato = "errore"; }
  render();
}
// la password dei fan non può essere quella della band: si prova a entrare come band con un'app separata
async function eLaPasswordDellaBand(pw) {
  const prova = getAuth(initializeApp(cfg, "verifica-" + Date.now()));
  try { await signInWithEmailAndPassword(prova, BAND_EMAIL, pw); await signOut(prova).catch(() => {}); return true; }
  catch (e) { return false; }
}
// link d'invito: contiene la password, così il fan scrive solo il nome
const linkInvito = () => `${location.origin}/?fan=${encodeURIComponent((state.accesso && state.accesso.password) || "")}`;
function invitoFan() {
  const pw = (state.accesso && state.accesso.password) || "";
  return `Il ritmo della sala prove: la scaletta, le registrazioni delle prove, la diretta dalla sala e una bacheca per scriverci.\n` +
    `Entra da qui: ${linkInvito()}\n` +
    `(se te la chiede, la password da fan è: ${pw})`;
}
const quandoGiorno = (t) => t ? new Date(t).toLocaleDateString("it-IT", { day: "numeric", month: "long" }) : "";
function accessoCard() {
  const a = state.accesso;
  let corpo;
  if (!a) {
    corpo = state.accessoStato === "errore"
      ? `<p class="nt-txt">Non riesco a leggere l'accesso dei fan.</p><button class="btn quiet" data-action="accesso-riprova">Riprova</button>`
      : `<p class="nt-txt">Controllo l'accesso dei fan…</p>`;
  } else if (state.accessoForm) {
    corpo = `
      <form class="am-form" data-form="accesso">
        <input class="field" name="password" data-keep="accesso-pw" placeholder="Password per i fan" minlength="6" maxlength="64" autocomplete="off" autocapitalize="off" spellcheck="false" required>
        <button class="btn fill" type="submit" ${state.accessoOcc ? "disabled" : ""}>${state.accessoOcc ? "Salvo…" : "Salva"}</button>
        <button type="button" class="btn quiet" data-action="accesso-annulla">Annulla</button>
      </form>
      <p class="am-hint">Almeno 6 caratteri, diversa da quella della band.${a.attivo ? " Chi usa quella di adesso esce entro un'ora." : ""}</p>`;
  } else if (!a.attivo) {
    corpo = `<p class="nt-txt">Una seconda password per i fan, da mandare con il link d'invito. Entrano con il loro nome e vedono Scaletta, Proposte, Audio e Bacheca.</p>
      <button class="btn fill" data-action="accesso-apri">Imposta la password</button>`;
  } else {
    const pw = a.password || "";
    corpo = `
      <div class="am-row"><span class="am-lbl">Password</span><span class="am-pw">${state.accessoVedi ? esc(pw) : "•".repeat(Math.min(pw.length || 8, 12))}</span>
        <button class="btn quiet am-mini" data-action="accesso-vedi">${state.accessoVedi ? "nascondi" : "mostra"}</button></div>
      ${a.aggiornata ? `<p class="am-meta">Impostata il ${esc(quandoGiorno(a.aggiornata))}${a.da ? ` da ${esc(a.da)}` : ""}.</p>` : ""}
      <div class="am-actions">
        <button class="btn fill" data-action="accesso-invita">Manda l'invito</button>
        <button class="btn quiet" data-action="accesso-apri">Cambia</button>
        <button class="btn quiet" data-action="accesso-disattiva">Disattiva</button>
      </div>`;
  }
  return `
    <article class="card ntcard amcard">
      <h3 class="sec-title">Accesso fan <small>${a && a.attivo ? "attivo" : a ? "spento" : ""}</small></h3>
      <div class="pg-sec">${corpo}</div>
    </article>`;
}
// ---------- fan: nome (se manca) e pannello dal nome in alto ----------
function renderFan() {
  const box = $("#fan-box");
  if (!box) return;
  const serveNome = state.fan && state.account && !state.fanNome;
  const aperto = state.fan && state.account && (serveNome || state.fanMenu);
  box.classList.toggle("hidden", !aperto);
  if (!aperto) { box.dataset.vista = ""; return; }
  const kept = {};
  box.querySelectorAll("[data-keep]").forEach(el => { kept[el.dataset.keep] = el.value; });
  let html;
  if (serveNome || state.fanCambia) {
    html = `
      <h2 class="overlay-title">${serveNome ? "Come ti chiami?" : "Cambia nome"}</h2>
      <form class="fan-nome" data-form="fan-nome">
        <input class="field" name="nome" data-keep="fan-nome" value="${esc(serveNome ? "" : state.fanNome || "")}" placeholder="Il tuo nome" maxlength="30" autocomplete="given-name" autocapitalize="words" required>
        <div class="fan-azioni">${serveNome ? "" : `<button type="button" class="btn quiet" data-action="fan-annulla">Annulla</button>`}<button class="btn amb" type="submit">${serveNome ? "Entra" : "Salva"}</button></div>
      </form>`;
  } else {
    html = `
      <div class="fan-top"><h2 class="overlay-title">${esc(state.fanNome)}</h2><button class="x" data-action="fan-chiudi" aria-label="Chiudi">${IC("x")}</button></div>
      <section class="fan-sez">
        <h3 class="fan-h">Notifiche${state.push ? " <small>attive</small>" : ""}</h3>
        ${notificheCorpo()}
      </section>
      <section class="fan-sez"><h3 class="fan-h">Aspetto</h3>${temaHtml()}</section>
      <div class="fan-fondo"><button class="btn quiet" data-action="fan-cambia">Cambia nome</button><button class="btn quiet" data-action="esci">Esci</button></div>`;
  }
  $("#fan-card").innerHTML = html;
  box.dataset.vista = serveNome || state.fanCambia ? "nome" : "menu";
  Object.entries(kept).forEach(([k, v]) => { const el = box.querySelector(`[data-keep="${k}"]`); if (el && v) el.value = v; });
}
function salvaNomeFan(nome) {
  state.fanNome = nome;
  store.set("prove_fan_nome", nome);
  state.fanCambia = false;
  ensureUser();
  render();
}

// tocco su una notifica: la pagina giusta (?vai=proposte|audio|canzone&id=…)
function vaiA(url) {
  let q;
  try { q = new URL(url, location.href).searchParams; } catch { return; }
  const vai = q.get("vai");
  if (vai === "canzone") {
    const id = q.get("id");
    if (state.ready.canzoni && state.canzoni.some(c => c.id === id)) { showTab("scaletta"); apriCanzone(id); }
    else { state.vaiCanzone = id; showTab("scaletta"); }
  } else if (vai === "proposte" || vai === "audio") showTab(vai);
}
navigator.serviceWorker?.addEventListener("message", e => {
  if (e.data && e.data.tipo === "vai") vaiA(e.data.url);
});

// dopo una modifica a canzoni o voti: un solo aggiornamento anche per più tocchi di fila
let plTimer = null;
function playlistDaAggiornare() {
  if (!playlistInfo()?.scaletta) return;
  clearTimeout(plTimer);
  plTimer = setTimeout(() => { plTimer = null; chiamaPlaylist("aggiorna").catch(e => console.warn("[playlist]", e.message)); }, 2500);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || !plTimer) return;
  clearTimeout(plTimer); plTimer = null;
  chiamaPlaylist("aggiorna", {}, true).catch(() => {});
});
function quandoBreve(d) {
  if (!d) return "";
  const ora = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const oggi = new Date().toDateString() === d.toDateString();
  return oggi ? `oggi alle ${ora}` : `il ${d.toLocaleDateString("it-IT", { day: "numeric", month: "long" })} alle ${ora}`;
}
function spotifyCard() {
  const info = playlistInfo();
  if (!info || !info.scaletta) {
    return `
    <article class="card spcard">
      <h3 class="sec-title">Playlist Spotify</h3>
      <p class="sp-txt">Due playlist pubbliche, <b>Scaletta</b> e <b>Proposte</b>, che si aggiornano da sole quando cambiate qualcosa qui. Si collegano una volta sola, con l'account Spotify che ha creato l'app Spotify della band.</p>
      <div class="sp-actions"><button class="btn fill" data-action="sp-collega">Collega Spotify</button></div>
    </article>`;
  }
  const senza = [...scaletta(), ...proposte()].filter(c => !haLinkSpotify(c) && !isNostro(c)).map(c => c.titolo);
  const riga = (kind, nome, lista) => `
      <div class="sp-row">
        ${SP_ICO}
        <span class="t"><b>${nome}</b><span>${descriviBrani(lista)}</span></span>
        <a class="btn quiet" ${appLink(info[kind], "com.spotify.music")} data-link>Apri</a>
      </div>`;
  const agg = info.aggiornata?.toDate ? info.aggiornata.toDate() : null;
  return `
    <article class="card spcard">
      <h3 class="sec-title">Playlist Spotify <small>account di ${esc(info.account || "—")}</small></h3>
      ${info.errore ? `<p class="sp-err">${esc(info.errore)}</p>` : ""}
      ${riga("scaletta", "Scaletta", scaletta())}
      ${riga("proposte", "Proposte", proposte())}
      ${senza.length ? `<p class="sp-txt sp-senza">Non sono in playlist perché manca il link Spotify: ${senza.map(esc).join(", ")}. Aggiungilo da «Link» nella scheda della canzone.</p>` : ""}
      <div class="sp-actions">
        <span class="sp-meta">${agg ? `Aggiornata ${quandoBreve(agg)}` : ""}</span>
        <button class="btn quiet" data-action="sp-aggiorna">Aggiorna adesso</button>
        <button class="btn quiet" data-action="sp-collega">Ricollega</button>
      </div>
    </article>`;
}

// ---------- accesso ----------
onAuthStateChanged(auth, (account) => {
  // un accesso rimasto da versioni precedenti (es. login Google) non vale:
  // si esce e si chiede la password
  const email = ((account && account.email) || "").toLowerCase();
  if (account && email !== BAND_EMAIL.toLowerCase() && email !== FAN_EMAIL.toLowerCase()) {
    signOut(auth).catch(() => {});
    return;
  }
  state.account = account;
  // i fan non sono nella band: il loro nome sta solo sul telefono, niente firma e niente voti
  state.fan = !!account && email === FAN_EMAIL.toLowerCase();
  document.body.classList.toggle("fan", state.fan);
  if (state.fan) { state.user = null; state.userId = null; if (state.tab === "cassa" || state.tab === "personale") showTab("scaletta"); }
  else { state.user = store.get("prove_user"); state.userId = store.get("prove_user_id"); }
  state.accesso = null; state.accessoStato = ""; state.fanMenu = false; state.fanCambia = false;
  if (account) {
    $("#gate").classList.add("hidden");
    subscribe();
    ensureUser();
    render();
    setTimeout(riallineaNotifiche, 4000);   // permesso tolto o iscrizione rinnovata dal telefono
  } else {
    $("#gate").classList.remove("hidden");
    $("#overlay").classList.add("hidden");
    $("#user-chip").classList.add("hidden");
    renderFan();
    setTimeout(() => (gateModo === "fan" ? $("#gate-nome") : $("#gate-pw"))?.focus(), 50);
  }
});

// ingresso: "Band" (password della band) o "Fan" (nome e password da fan).
// Il link d'invito dei fan (?fan=…) porta la password: al fan resta solo da scrivere il nome.
const INVITO = (() => {
  const q = new URLSearchParams(location.search);
  const v = q.get("fan");
  if (v === null) return "";
  q.delete("fan");
  history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : ""));
  return v.trim();
})();
let gateModo = INVITO ? "fan" : (store.get("prove_gate_modo") === "fan" ? "fan" : "band");
let invitoValido = !!INVITO;
function modoGate(m) {
  gateModo = m;
  const fan = m === "fan", conInvito = fan && invitoValido;
  document.querySelectorAll(".gate-seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.modo === m)));
  $(".gate-seg").classList.toggle("hidden", conInvito);
  $(".gate-nome").classList.toggle("hidden", !fan);
  $(".gate-pw-row").classList.toggle("hidden", conInvito);
  $("#gate-pw").placeholder = fan ? "Password da fan" : "Password della band";
  $("#gate-user").value = fan ? "fan" : "band";
  const puoNotifiche = PUSH_OK && !(IS_IOS && !IN_APP) && Notification.permission !== "denied";
  $(".gate-check").classList.toggle("hidden", !fan || !puoNotifiche);
  $("#gate-nota").textContent = conInvito ? "La band ti ha mandato l'invito. Come ti chiami?"
    : fan ? "Il tuo nome e la password da fan che ti ha dato la band."
    : "La password della band: il telefono la ricorda.";
  $("#gate-err").textContent = "";
}
document.querySelectorAll(".gate-seg button").forEach(b => b.addEventListener("click", () => {
  modoGate(b.dataset.modo);
  (gateModo === "fan" ? $("#gate-nome") : $("#gate-pw")).focus();
}));
modoGate(gateModo);

$("#gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#gate-err");
  const fan = gateModo === "fan";
  const nome = $("#gate-nome").value.trim().replace(/\s+/g, " ").slice(0, 30);
  const pw = fan && invitoValido ? INVITO : $("#gate-pw").value;
  if (fan && !nome) { err.textContent = "Scrivi il tuo nome."; $("#gate-nome").focus(); return; }
  if (!pw) { err.textContent = fan ? "Scrivi la password da fan." : "Scrivi la password della band."; $("#gate-pw").focus(); return; }
  err.textContent = "";
  // il permesso per le notifiche va chiesto adesso, dentro il tocco su «Entra»
  const conNotifiche = fan && !$(".gate-check").classList.contains("hidden") && $("#gate-notifiche").checked;
  const permesso = conNotifiche ? Notification.requestPermission().catch(() => "default") : null;
  const btn = e.target.querySelector(".enter");
  btn.disabled = true; btn.textContent = "Accesso…";
  const sbagliata = (ex) => ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(ex.code || "");
  // il nome del fan si salva prima, così entrando non lo si chiede di nuovo
  const nomePrima = state.fanNome;
  if (fan) { state.fanNome = nome; store.set("prove_fan_nome", nome); }
  try {
    await signInWithEmailAndPassword(auth, fan ? FAN_EMAIL : BAND_EMAIL, pw);
    store.set("prove_gate_modo", gateModo);
    $("#gate-pw").value = ""; $("#gate-nome").value = "";
    if (permesso && (await permesso) === "granted") attivaNotifiche();
    else if (fan) toast(`Ciao ${nome}!`);
  } catch (ex) {
    if (fan) { state.fanNome = nomePrima; if (nomePrima) store.set("prove_fan_nome", nomePrima); else store.del("prove_fan_nome"); }
    const code = ex.code || "";
    if (fan && invitoValido && sbagliata(ex)) {
      // la password è cambiata dopo l'invito: si chiede quella nuova
      invitoValido = false; modoGate("fan");
      err.textContent = "Questo invito non vale più: chiedi alla band la password nuova.";
      return;
    }
    err.textContent =
      sbagliata(ex) ? "Password non corretta." :
      code === "auth/user-disabled" ? "L'ingresso dei fan per ora è chiuso." :
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
// diretta dalla sala (vedi diretta.js): ha i suoi dati e la sua scheda in cima ad Audio
const diretta = creaDiretta({
  db, toast: (m) => toast(m), utente: () => state.fan ? (state.fanNome || "Fan") : state.user, esc, iniTag: (n) => iniTag(n),
  puoTrasmettere: () => !state.fan,
  alAvvio: () => notifica("diretta"),
  // ascoltando la diretta si ferma la registrazione eventualmente in riproduzione
  primaDiAscoltare: () => { if (state.playId) fermaRiproduzione(); },
  ripristinaComandi: () => comandiRegistrazioni(),
  isMobile: IS_ANDROID || IS_IOS, isIOS: IS_IOS
});
function subscribe() {
  if (state.subscribed) return;
  state.subscribed = true;
  diretta.subscribe();
  const listen = (name, q, key, opts, errore) => onSnapshot(q, opts || {}, snap => {
    state[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.ready[key] = true;
    if (key === "bacheca") state.bachecaNegata = false;
    if (key === "membri") { computeSigle(); ensureUser(); }
    if (key === "canzoni") ensureGenerale(snap);
    render();
  }, errore || onDenied);
  listen("membri", query(collection(db, "membri"), orderBy("creato")), "membri");
  listen("canzoni", query(collection(db, "canzoni"), orderBy("ordine")), "canzoni", { includeMetadataChanges: true });
  listen("tasks", query(collection(db, "tasks"), orderBy("creato")), "tasks");
  listen("registrazioni", query(collection(db, "registrazioni"), orderBy("data", "desc")), "registrazioni");
  // finché le regole del database non includono la bacheca: avviso solo nella sezione, non la barra rossa
  listen("bacheca", query(collection(db, "bacheca"), orderBy("creato", "desc")), "bacheca", null, err => {
    console.warn("[bacheca]", err);
    state.ready.bacheca = true;
    state.bachecaNegata = !!err && err.code === "permission-denied";
    render();
  });
  // la cassa i fan non la vedono (e il database non gliela darebbe)
  if (!state.fan) listen("movimenti", query(collection(db, "movimenti"), orderBy("data", "desc")), "movimenti");
  else state.ready.movimenti = true;
}
// la scheda Generale è un documento con id fisso: crearla due volte non produce doppioni
function ensureGenerale(snap) {
  if (state.generaleOk || state.fan) return;
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
  if (state.userId) {
    const me = state.membri.find(m => m.id === state.userId);
    if (!me) { state.userId = null; store.del("prove_user_id"); }
    else if (me.nome !== state.user) { state.user = me.nome; store.set("prove_user", me.nome); }
  }
  if (state.user && !state.userId) {
    const me = state.membri.find(m => m.nome === state.user);
    if (me) { state.userId = me.id; store.set("prove_user_id", me.id); }
  }
  updateNavMe();
  if (state.fan) {
    overlay.classList.add("hidden");
    chip.textContent = state.fanNome || "Fan";
    chip.title = "Notifiche, nome, esci";
    chip.classList.remove("hidden");
    renderFan();
    return;
  }
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
  el.style.background = col && state.tab === "personale" ? col : "";
  el.style.color = col && state.tab === "personale" && LIGHT_BG.has(col) ? "var(--legno)" : "";
}
function setUser(nome) {
  state.user = nome;
  state.viewPerson = null;
  store.set("prove_user", nome);
  const me = state.membri.find(m => m.nome === nome);
  state.userId = me ? me.id : null;
  if (me) store.set("prove_user_id", me.id); else store.del("prove_user_id");
  ensureUser();
  render();
  riallineaNotifiche();
}
$("#member-picker").addEventListener("click", e => {
  const b = e.target.closest(".member-pick");
  if (b) setUser(b.dataset.nome);
});
$("#new-member-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (state.fan) return;
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
  if (state.fan) { state.fanMenu = true; state.fanCambia = false; renderFan(); return; }
  store.del("prove_user");
  store.del("prove_user_id");
  state.user = null;
  state.userId = null;
  ensureUser();
});

// ---------- tema: segue il telefono, oppure giorno o notte scelti a mano (solo su questo telefono) ----------
const META_TEMA = [...document.querySelectorAll('meta[name="theme-color"]')].map(m => [m, m.content]);
function applicaTema(t) {
  const forzato = t === "giorno" || t === "notte";
  if (forzato) document.documentElement.dataset.tema = t; else delete document.documentElement.dataset.tema;
  // la barra del telefono prende il colore della testata del tema in uso
  META_TEMA.forEach(([m, orig]) => { m.content = forzato ? (t === "notte" ? "#1B1714" : "#ECE7DF") : orig; });
}
applicaTema(store.get("prove_tema"));
function temaHtml() {
  const t = store.get("prove_tema") || "auto";
  const b = (k, nome) => `<button type="button" data-action="tema" data-tema="${k}" aria-pressed="${t === k}">${nome}</button>`;
  return `<div class="tema" role="group" aria-label="Aspetto">${b("auto", "Come il telefono")}${b("giorno", "Giorno")}${b("notte", "Notte")}</div>`;
}

// ---------- testata: nome della sezione e una riga di contesto ----------
const TITOLI = { scaletta: "Scaletta", proposte: "Proposte", audio: "Audio", bacheca: "Bacheca", cassa: "Cassa", personale: "Personale" };
const plurale = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;
function contesto(tab) {
  if (!state.account || !state.ready.canzoni) return "";
  if (tab === "scaletta") {
    const l = scaletta(), pronte = l.filter(c => statoTask(c).pronta).length;
    return plurale(l.length, "pezzo", "pezzi") + (pronte ? ` · ${plurale(pronte, "pronto", "pronti")}` : "");
  }
  if (tab === "proposte") {
    const l = proposte(), dv = state.user ? l.filter(c => !(c.reazioni || {})[state.user]).length : 0;
    return plurale(l.length, "proposta", "proposte") + (dv ? ` · ${dv} da votare` : "");
  }
  if (tab === "audio") {
    if (!state.ready.registrazioni) return "";
    const giorni = new Set(state.registrazioni.map(r => r.data || "")).size;
    return plurale(state.registrazioni.length, "registrazione", "registrazioni") + (giorni ? ` · ${plurale(giorni, "prova", "prove")}` : "");
  }
  if (tab === "bacheca") {
    if (!state.ready.bacheca) return "";
    return plurale(state.bacheca.filter(m => !m.postId).length, "post", "post");
  }
  if (tab === "personale") return state.ctxPersonale || "";
  if (tab === "cassa") {
    if (!state.ready.movimenti) return "";
    const s = state.movimenti.reduce((t, m) => t + (m.tipo === "versamento" ? 1 : -1) * (m.importoCent || 0), 0);
    return `In cassa ${euro(s)}`;
  }
  return "";
}
function testata() {
  const t = $("#tb-titolo"), s = $("#tb-sub");
  if (!t) return;
  t.textContent = state.account ? (TITOLI[state.tab] || "") : "Il ritmo della sala prove";
  s.textContent = contesto(state.tab);
}

// ---------- tab ----------
function showTab(name) {
  if (!document.getElementById("view-" + name)) name = "scaletta";
  if (state.fan && (name === "cassa" || name === "personale")) name = "scaletta";
  if (state.songPage) { lasciaCanzone(); if (history.state && history.state.canzone) history.back(); render(); }
  state.tab = name;
  store.set("prove_tab", name);
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.tab === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  updateNavMe();
  testata();
  window.scrollTo({ top: 0 });
  if (name === "bacheca") segnaBachecaVista();
  if (name === "personale" && state.account && !state.fan && !state.accesso && !state.accessoStato) caricaAccesso();
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));
// ritorno dalla pagina di consenso di Spotify (?spotify=ok|annullato|errore)
(function ritornoDaSpotify() {
  const q = new URLSearchParams(location.search);
  const esito = q.get("spotify");
  if (!esito) return;
  history.replaceState(null, "", location.pathname);
  state.tab = "personale";
  const msg = esito === "ok" ? "Spotify collegato: le playlist sono pronte."
    : esito === "annullato" ? "Collegamento a Spotify annullato."
    : `Spotify non collegato: ${q.get("motivo") || "errore"}`;
  setTimeout(() => toast(msg), 700);
})();
(function daNotifica() {
  const q = new URLSearchParams(location.search);
  const vai = q.get("vai");
  if (!vai) return;
  history.replaceState(null, "", location.pathname);
  if (vai === "canzone") { state.tab = "scaletta"; state.vaiCanzone = q.get("id"); }
  else if (vai === "proposte" || vai === "audio") state.tab = vai;
})();
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
  document.querySelectorAll("main [data-keep]").forEach(el => { vals[el.dataset.keep] = el.type === "checkbox" ? (el.checked ? "✓" : "✗") : el.value; });
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
    if (el && el.type === "checkbox") el.checked = v === "✓";
    else if (el && v != null && v !== "") el.value = v;
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
  if (state.vaiCanzone) {
    const id = state.vaiCanzone;
    state.vaiCanzone = null;
    if (state.canzoni.some(c => c.id === id)) { if (state.tab !== "scaletta") showTab("scaletta"); apriCanzone(id); return; }
  }
  const kept = captureInputs();
  renderScaletta();
  renderProposte();
  renderAudio();
  renderBacheca();
  if (!state.fan) { renderCassa(); renderPersonale(); }
  restoreInputs(kept);
  renderFan();
  updateNavMe();
  testata();
  syncPlayer();
}

// ---------- scaletta ----------
function renderScaletta() {
  const aperta = state.songPage && state.canzoni.find(c => c.id === state.songPage);
  if (state.songPage && !aperta) lasciaCanzone();   // eliminata da qualcun altro
  if (aperta) { $("#view-scaletta").innerHTML = songPage(aperta); return; }
  const gen = state.canzoni.find(c => c.id === GENERALE_ID);
  const lista = scaletta();
  let html = plStrip("scaletta") + (gen ? songCard(gen) : "");
  html += lista.map((c, i) => songCard(c, i + 1)).join("");
  if (!lista.length) html += `<p class="empty big">Nessuna canzone in scaletta.${state.fan ? "" : " Aggiungine una con il +."}</p>`;
  if (!state.fan) html += addSongBlock("scaletta", "Aggiungi canzone", "Aggiungi");
  $("#view-scaletta").innerHTML = html;
}
function statoTask(c) {
  const ts = tasksOf(c.id);
  const done = ts.filter(taskFatta).length;
  const pronta = !isGenerale(c) && ts.length > 0 && done === ts.length;
  return { ts, done, pronta, p: pct(done, ts.length) };
}
// nella lista solo l'essenziale: numero in scaletta, titolo, link e task fatti;
// il filetto sotto la riga si riempie con i task fatti. Toccando la canzone si apre la sua pagina.
function songCard(c, n) {
  const gen = isGenerale(c);
  const { ts, done, pronta, p } = statoTask(c);
  const count = pronta ? `<span class="cnt ok">pronta</span>` : `<span class="cnt" aria-label="${done} task fatti su ${ts.length}">${done}/${ts.length}</span>`;
  return `
  <article class="brano${gen ? " generale" : ""}${pronta ? " pronta" : ""}" data-action="open-song" data-id="${c.id}" role="button" tabindex="0">
    <span class="num" aria-hidden="true">${gen ? IC("pin") : n}</span>
    <div class="brano-testo">
      <h2 class="song-title">${gen ? "Generale" : esc(c.titolo)}</h2>
      <div class="song-artist">${gen ? "Cose da fare non legate a un pezzo" : esc(c.artista || "")}</div>
    </div>
    <div class="brano-lato">${gen ? "" : linksHtml(c)}${count}</div>
    <span class="brano-linea" aria-hidden="true"><i style="width:${p}%"></i></span>
  </article>`;
}
function apriCanzone(id) {
  const c = state.canzoni.find(x => x.id === id);
  if (!c) return;
  state.listScroll = window.scrollY;
  state.songPage = id;
  state.addTaskOpen = null; state.partePicker = null; state.parteAltro = false;
  state.editSetup = null; state.linkEdit = null;
  history.pushState({ canzone: id }, "");
  enrichSong(c);
  render();
  window.scrollTo({ top: 0 });
}
function lasciaCanzone() {
  state.songPage = null;
  state.addTaskOpen = null; state.partePicker = null; state.parteAltro = false;
  state.editSetup = null; state.linkEdit = null;
}
function chiudiCanzone() {
  lasciaCanzone();
  render();
  window.scrollTo({ top: state.listScroll });
}
// tasto indietro del telefono (o freccia nella pagina): si torna alla lista
window.addEventListener("popstate", () => { if (state.songPage) chiudiCanzone(); });

function songPage(c) {
  const gen = isGenerale(c);
  const { ts, done, pronta, p } = statoTask(c);
  const lista = scaletta();
  const idx = lista.findIndex(x => x.id === c.id);
  const sel = state.drafts[c.id] || new Set();
  const picks = state.membri.map(m => {
    const on = sel.has(m.nome), col = colorOf(m.nome);
    return `<button type="button" class="ini${on ? " on" : ""}${on && LIGHT_BG.has(col) ? " light" : ""}" data-action="pick" data-song="${c.id}" data-nome="${esc(m.nome)}" title="${esc(m.nome)}" aria-pressed="${on}" style="${on ? `background:${col}` : ""}">${esc(siglaOf(m.nome))}</button>`;
  }).join("");
  const nuovoTask = state.fan ? "" : state.addTaskOpen === c.id ? `
      <form class="newtask" data-form="add-task" data-song="${c.id}">
        <div class="inrow">
          <input class="field" name="titolo" data-keep="task-${c.id}" placeholder="Nuovo task" maxlength="120" autocomplete="off" required>
          <button class="btn fill" type="submit">Aggiungi</button>
        </div>
        <div class="picks">${picks}</div>
      </form>` : `<button class="addline" data-action="addtask-open" data-id="${c.id}"><span class="plus">${IC("piu")}</span>Nuovo task</button>`;
  return `
  <div class="pagina">
    <div class="pg-top">
      <button class="pg-back" data-action="close-song" aria-label="Torna alla scaletta">${IC("indietro")}Scaletta</button>
      ${!gen && idx >= 0 ? `<span class="pg-pos">${idx + 1} di ${lista.length}</span>` : ""}
    </div>
    <header class="pg-head${gen ? " generale" : ""}${pronta ? " pronta" : ""}">
      <h2 class="pg-title">${gen ? "Generale" : esc(c.titolo)}</h2>
      <div class="song-artist">${gen ? "Cose da fare non legate a un pezzo" : esc(c.artista || "")}</div>
      ${gen ? "" : `<div class="pg-link">${linksHtml(c, true)}</div>`}
      ${linkBlock(c)}
    </header>
    <section class="sez">
      <h3 class="fascia">Task <small${pronta ? ` class="ok"` : ""}>${pronta ? "pronta" : `${done} di ${ts.length}`}</small></h3>
      <div class="bar pg-bar"><i class="${pronta ? "ok" : ""}" style="width:${p}%"></i></div>
      ${ts.length ? ts.map(taskRow).join("") : `<p class="empty">Nessun task per ${gen ? "ora" : "questo pezzo"}.</p>`}
      ${nuovoTask}
    </section>
    ${gen ? "" : setupCard(c) + recsCard(c) + (state.fan ? "" : `
    <div class="pg-actions">
      <button class="btn quiet" data-action="up" data-id="${c.id}" ${idx <= 0 ? "disabled" : ""} aria-label="Sposta su nella scaletta" title="Sposta su">${IC("sopra")}</button>
      <button class="btn quiet" data-action="down" data-id="${c.id}" ${idx < 0 || idx === lista.length - 1 ? "disabled" : ""} aria-label="Sposta giù nella scaletta" title="Sposta giù">${IC("sotto")}</button>
      <button class="btn quiet" data-action="link-edit" data-id="${c.id}" aria-expanded="${state.linkEdit === c.id}">${IC("matita")}Modifica</button>
      <button class="btn quiet" data-action="demote" data-id="${c.id}" aria-label="Rimetti fra le proposte">${IC("ritorno")}Proposte</button>
      <span class="sp"></span>
      <button class="x" data-action="del-song" data-id="${c.id}" aria-label="Elimina canzone" title="Elimina">${IC("cestino")}</button>
    </div>`)}
  </div>`;
}
function taskRow(t) {
  const ro = state.fan;   // fan: si vede lo stato, non si tocca
  const del = ro ? "" : `<button class="del-mini" data-action="del-task" data-id="${t.id}" aria-label="Elimina task">${IC("x")}</button>`;
  if (!multipla(t)) return `
    <div class="task${t.fatto ? " fatto" : ""}">
      <button class="chk" data-action="check" data-id="${t.id}" ${ro ? `disabled aria-label="${t.fatto ? "Fatto" : "Da fare"}"` : `aria-label="${t.fatto ? "Segna da fare" : "Segna fatto"}"`}>${t.fatto ? IC("check") : ""}</button>
      <span><span class="tt">${esc(t.titolo)}</span>${t.fatto && t.fattoDa ? `<span class="by">fatto da ${esc(t.fattoDa)}</span>` : ""}</span>
      <span class="task-side">${whoTags(t.assegnatari)}${del}</span>
    </div>`;
  // più persone: ogni sigla è la parte di una persona e si tocca per segnarla;
  // colorata = da fare, grigia e barrata = fatto. A sinistra solo lo stato (non si tocca).
  const fatti = fattiDi(t), tutta = taskFatta(t);
  const parti = assegnati(t).map(n => {
    const on = fatti.includes(n), col = colorOf(n);
    return `<button class="ini parte${on ? " on" : ""}${LIGHT_BG.has(col) ? " light" : ""}" style="--c:${col}" data-action="parte" data-id="${t.id}" data-nome="${esc(n)}"${ro ? " disabled" : ""} aria-pressed="${on}" title="${esc(n)}: ${on ? "fatto" : "da fare"}" aria-label="${esc(n)}: ${on ? "fatto, tocca per segnare da fare" : "da fare, tocca per segnare fatto"}">${esc(siglaOf(n))}</button>`;
  }).join("");
  const stato = tutta
    ? `<span class="chk stato" aria-label="Fatto da tutti">${IC("check")}</span>`
    : `<span class="pbox" aria-label="Fatto da ${fatti.length} su ${assegnati(t).length}">${fatti.length}/${assegnati(t).length}</span>`;
  return `
    <div class="task multi${tutta ? " fatto" : ""}">
      ${stato}
      <span><span class="tt">${esc(t.titolo)}</span><span class="parti">${parti}</span></span>
      <span class="task-side">${del}</span>
    </div>`;
}
// salva voto e commento di chi usa l'app (voto null = toglie il voto e il commento)
async function salvaVoto(c, voto, commento) {
  const reazioni = { ...(c.reazioni || {}) }, commenti = { ...(c.commenti || {}) };
  if (voto) reazioni[state.user] = voto; else delete reazioni[state.user];
  const t = String(commento || "").trim().slice(0, 100);
  if (voto && t) commenti[state.user] = t; else delete commenti[state.user];
  await updateDoc(doc(db, "canzoni", c.id), { reazioni, commenti }).catch(erroreScrittura);
  playlistDaAggiornare();
}
// segna la parte di una persona; la task diventa fatta quando l'hanno fatta tutti
async function segnaParte(t, nome) {
  const prima = fattiDi(t);
  const fatto = !prima.includes(nome);
  const dopo = fatto ? [...prima, nome] : prima.filter(n => n !== nome);
  const tutta = assegnati(t).every(n => dopo.includes(n));
  await updateDoc(doc(db, "tasks", t.id), {
    // la prima volta (task vecchie) si scrive l'elenco intero, poi un nome alla volta: due spunte insieme non si perdono
    fattiDa: Array.isArray(t.fattiDa) ? (fatto ? arrayUnion(nome) : arrayRemove(nome)) : dopo,
    fatto: tutta, fattoDa: tutta ? (state.user || "") : "", fattoIl: tutta ? serverTimestamp() : null
  }).catch(erroreScrittura);
  if (tutta) maybeCelebrate(t.canzoneId, t.id);
}
function setupEditor(songId, key, testo) {
  return `
    <form class="setup-edit" data-form="setup" data-song="${songId}" data-key="${key}">
      <textarea name="testo" data-keep="setup-${songId}-${esc(key)}" maxlength="400" placeholder="Effetti, preset, suoni, accorgimenti…">${esc(testo || "")}</textarea>
      <div class="ed"><button type="button" class="btn quiet" data-action="setup-cancel">Annulla</button><button class="btn fill" type="submit">Salva</button></div>
    </form>`;
}
function setupCard(c) {
  const setup = c.setup || {};
  const inModifica = (k) => state.editSetup && state.editSetup.song === c.id && state.editSetup.key === k;
  const parti = partiDi(c);
  if (state.editSetup && state.editSetup.song === c.id && !parti.includes(state.editSetup.key)) parti.push(state.editSetup.key);
  const scritte = parti.filter(k => (setup[k] || "").trim()).length;
  const rows = parti.map(k => {
    const testo = (setup[k] || "").trim();
    const nome = esc(nomeParte(k));
    if (inModifica(k) && !state.fan) return `
      <div class="setup-row editing"><span class="setup-parte">${nome}</span>${setupEditor(c.id, k, testo)}</div>`;
    if (state.fan) return `
      <div class="setup-row sola"><span class="setup-parte">${nome}</span><span class="setup-txt">${testo ? esc(testo) : `<span class="empty">—</span>`}</span></div>`;
    return `
      <div class="setup-row">
        <span class="setup-parte">${nome}</span>
        <span class="setup-txt" data-action="setup-edit" data-id="${c.id}" data-key="${esc(k)}" role="button" tabindex="0">${testo ? esc(testo) : `<span class="empty">Tocca per scrivere</span>`}</span>
        <button class="del-mini" data-action="parte-del" data-id="${c.id}" data-key="${esc(k)}" aria-label="Togli ${nome}">${IC("x")}</button>
      </div>`;
  }).join("");
  let add;
  if (state.fan) {
    add = "";
  } else if (state.partePicker !== c.id) {
    add = `<button class="addline" data-action="parte-picker" data-id="${c.id}"><span class="plus">${IC("piu")}</span>Aggiungi parte</button>`;
  } else {
    const libere = STRUMENTI.map(s => s.key).concat(partiLibere()).filter(k => !parti.includes(k));
    add = `
      <div class="parte-picker">
        <div class="setup-add">${libere.map(k => `<button class="parte-add" data-action="parte-add" data-id="${c.id}" data-key="${esc(k)}">${esc(nomeParte(k))}</button>`).join("")}${state.parteAltro ? "" : `<button class="parte-add altro" data-action="parte-altro" data-id="${c.id}">Altro…</button>`}</div>
        ${state.parteAltro ? `
        <form class="inrow parte-nuova" data-form="parte-nuova" data-song="${c.id}">
          <input class="field" name="nome" data-keep="parte-nuova-${c.id}" placeholder="Nome della parte (es. Banjo, Cori)" maxlength="24" autocomplete="off" required>
          <button class="btn fill" type="submit">Aggiungi</button>
        </form>` : ""}
        <div class="ed"><button type="button" class="btn quiet" data-action="parte-picker-chiudi">Chiudi</button></div>
      </div>`;
  }
  return `
    <section class="sez">
      <h3 class="fascia">Setup <small>${parti.length ? `${parti.length} ${parti.length === 1 ? "parte" : "parti"}${scritte < parti.length ? `, ${scritte} con appunti` : ""}` : ""}</small></h3>
      ${rows || `<p class="empty">${state.fan ? "Nessun appunto di setup per questo pezzo." : "Nessuna parte ancora: aggiungi gli strumenti che suonano in questo pezzo."}</p>`}
      ${add}
    </section>`;
}
function recsCard(c) {
  const recs = recsOf(c.id);
  if (!recs.length) return "";
  return `
    <section class="sez">
      <h3 class="fascia">Registrazioni <small>${recs.length}</small></h3>
      ${recs.map(r => recRow(r, "song")).join("")}
    </section>`;
}
function linkBlock(c) {
  if (state.linkEdit !== c.id) return "";
  // si correggono titolo e artista: il brano su Spotify si cerca di nuovo da solo (niente link da incollare)
  return `
    <form class="link-form" data-form="links" data-song="${c.id}">
      <label><span>Titolo</span>
        <input class="field" name="titolo" data-keep="ed-tit-${c.id}" value="${esc(c.titolo || "")}" maxlength="80" autocomplete="off" required></label>
      <label><span>Artista</span>
        <input class="field" name="artista" data-keep="ed-art-${c.id}" value="${esc(c.artista || "")}" maxlength="60" autocomplete="off"></label>
      <label class="chk-row"><input type="checkbox" name="nostro" data-keep="ed-nostro-${c.id}" ${isNostro(c) ? "checked" : ""}><span class="nt-box"></span>Pezzo nostro (non è su Spotify)</label>
      <div class="solo-cover">
      <label><span>Link Songsterr della canzone</span>
        <input class="field" name="songsterr" data-keep="link-ss-${c.id}" value="${esc(c.songsterrUrl || "")}" placeholder="https://www.songsterr.com/a/wsa/…" autocomplete="off" inputmode="url"></label>
      <p class="hint">Se correggi titolo o artista, il brano su Spotify si cerca di nuovo. Se il brano è sbagliato ma il testo è giusto, tocca «Cerca di nuovo».</p>
      </div>
      <div class="ed"><button type="submit" class="btn quiet solo-cover" name="cerca" value="1" title="Cerca di nuovo il brano su Spotify">Cerca di nuovo</button><span class="sp"></span><button type="button" class="btn quiet" data-action="link-cancel">Annulla</button><button class="btn fill" type="submit">Salva</button></div>
    </form>`;
}
// + in basso a destra; toccandolo il modulo si apre in un foglio a tutta altezza, con il pulsante sotto il pollice
function addSongBlock(where, label, cta) {
  if (!state.addOpen[where]) {
    return `<button class="fab" data-action="add-open" data-where="${where}" aria-label="${label}" title="${label}">${IC("piu")}</button>`;
  }
  return `
    <form class="foglio addform" data-form="add-song" data-stato="${where === "proposte" ? "proposta" : "scaletta"}">
      <div class="foglio-testa"><h2>${label}</h2><button type="button" class="x" data-action="add-chiudi" data-where="${where}" aria-label="Chiudi">${IC("x")}</button></div>
      <div class="foglio-corpo">
        <label class="campo"><span>Titolo</span><input class="field" name="titolo" data-keep="add-${where}-titolo" maxlength="80" autocomplete="off" required></label>
        <label class="campo"><span>Artista</span><input class="field" name="artista" data-keep="add-${where}-artista" maxlength="60" autocomplete="off"></label>
        <label class="chk-row"><input type="checkbox" name="nostro" data-keep="add-${where}-nostro"><span class="nt-box"></span>Pezzo nostro (non è su Spotify)</label>
      </div>
      <div class="foglio-barra"><span class="sp"></span><button class="btn fill" type="submit">${cta}</button></div>
    </form>`;
}

// ---------- proposte ----------
// commenti ai voti: una riga, obbligatoria per 👎 e facoltativa per 👍 (campo commenti: nome → testo)
const commentiDi = (c) => {
  const r = c.reazioni || {}, m = c.commenti || {};
  return Object.keys(m).filter(n => r[n] && String(m[n] || "").trim()).map(n => [n, String(m[n]).trim()]);
};
function commentoForm(c) {
  const cv = state.commentoVoto;
  if (!cv || cv.id !== c.id) return "";
  const giu = cv.voto === "down";
  const att = ((c.commenti || {})[state.user] || "");
  return `
    <form class="vcomm${giu ? " giu" : ""}" data-form="commento" data-id="${c.id}" data-voto="${cv.voto}">
      <input class="field" name="testo" data-keep="vc-${c.id}" value="${esc(att)}" maxlength="100" autocomplete="off" placeholder="${giu ? "Perché no? (obbligatorio)" : "Un commento? (facoltativo)"}"${giu ? " required" : ""}>
      <button type="button" class="x" data-action="commento-chiudi" data-id="${c.id}" aria-label="${giu ? "Annulla il voto" : "Chiudi"}">${IC("x")}</button>
      <button class="btn ${giu ? "fill" : ""}" type="submit">${giu ? `${IC("giu")}Vota` : "Salva"}</button>
    </form>`;
}
function renderProposte() {
  // in alto, evidenziate, quelle che chi usa l'app non ha ancora votato (dalla più recente);
  // sotto la classifica. Dopo un 👍 la proposta resta in alto finché è aperto il campo del commento.
  const tieni = (c) => state.commentoVoto && state.commentoVoto.tieni && state.commentoVoto.id === c.id;
  const daVotare = (c) => state.user && (!(c.reazioni || {})[state.user] || tieni(c));
  const tutte = proposte();
  const nuove = tutte.filter(daVotare).sort((a, b) => (b.ordine || 0) - (a.ordine || 0));
  const classifica = tutte.filter(c => !daVotare(c)).sort(perClassifica);
  const lista = nuove.concat(classifica);
  const card = (c, rango) => {
    const r = c.reazioni || {};
    const su = Object.keys(r).filter(n => r[n] === "up");
    const giu = Object.keys(r).filter(n => r[n] === "down");
    const mia = state.user ? r[state.user] : null;
    const open = state.votersOpen.has(c.id);
    const com = commentiDi(c);
    // chi ha commentato compare con il suo commento, gli altri solo con la sigla
    const conCom = new Set(com.map(([n]) => n));
    const suSolo = su.filter(n => !conCom.has(n)), giuSolo = giu.filter(n => !conCom.has(n));
    const pollice = (v) => `<span class="vl ${v === "down" ? "giu" : "su"}" aria-label="${v === "down" ? "Non mi piace" : "Mi piace"}">${IC(v === "down" ? "giu" : "su")}</span>`;
    // sulla riga solo titolo e i due voti (si votano da lì); toccando la riga si aprono
    // ascolto, chi ha votato, commenti e le azioni (Modifica, Elimina, In scaletta)
    const voters = `
      <div class="voters">
        ${suSolo.length ? `<span class="vg">${pollice("up")}${suSolo.map(iniTag).join("")}</span>` : ""}
        ${giuSolo.length ? `<span class="vg">${pollice("down")}${giuSolo.map(iniTag).join("")}</span>` : ""}
        ${!su.length && !giu.length ? `<span class="none">Nessun voto ancora.</span>` : ""}
        ${com.length ? `<div class="vcom-list">${com.map(([n, t]) => `<div class="vcom">${pollice(r[n])}${iniTag(n)}<span class="vcom-t">${esc(t)}</span></div>`).join("")}</div>` : ""}
      </div>`;
    const pronta = su.length >= SOGLIA_SCALETTA;
    const voti = state.fan ? `
        <span class="voto sola" aria-label="Mi piace: ${su.length}">${IC("su")}${su.length}</span>
        <span class="voto sola" aria-label="Non mi piace: ${giu.length}">${IC("giu")}${giu.length}</span>` : `
        <button class="voto${mia === "up" ? " on up" : ""}" data-action="react-up" data-id="${c.id}" aria-pressed="${mia === "up"}" aria-label="Mi piace, ${su.length}">${IC("su")}${su.length}</button>
        <button class="voto${mia === "down" ? " on down" : ""}" data-action="react-down" data-id="${c.id}" aria-pressed="${mia === "down"}" aria-label="Non mi piace, ${giu.length}">${IC("giu")}${giu.length}</button>`;
    const dettagli = !(open || state.linkEdit === c.id) ? "" : `
      <div class="prop-dett">
        <div class="pg-link">${linksHtml(c, true)}</div>
        ${voters}
        ${state.linkEdit === c.id ? linkBlock(c) : ""}
        ${state.fan ? "" : `
        <div class="prop-az">
          <button class="btn quiet" data-action="link-edit" data-id="${c.id}" aria-expanded="${state.linkEdit === c.id}">${IC("matita")}Modifica</button>
          <button class="btn quiet" data-action="del-song" data-id="${c.id}">${IC("cestino")}Elimina</button>
          <span class="sp"></span>
          <button class="btn${pronta ? " go" : ""}" data-action="promote" data-id="${c.id}">${IC("sopra")}In scaletta</button>
        </div>`}
      </div>`;
    return `
    <article class="prop${daVotare(c) ? " da-votare" : ""}${dettagli ? " aperta" : ""}">
      <div class="prop-riga" data-action="voters" data-id="${c.id}" role="button" tabindex="0" aria-expanded="${!!dettagli}">
        <span class="num" aria-hidden="true">${rango || ""}</span>
        <div class="brano-testo">
          <h2 class="song-title">${esc(c.titolo)}</h2>
          <div class="song-artist">${esc(c.artista || "")}${com.length ? `<span class="ncom"> · ${com.length} ${com.length === 1 ? "commento" : "commenti"}</span>` : ""}${pronta ? `<span class="ok"> · pronta per la scaletta</span>` : ""}</div>
        </div>
        <div class="prop-voti">${voti}</div>
      </div>
      ${commentoForm(c)}
      ${dettagli}
    </article>`;
  };
  const cards = (nuove.length ? `<h3 class="prop-sez amb">Da votare <small>${nuove.length}</small></h3>${nuove.map(c => card(c)).join("")}` : "") +
    (classifica.length ? `<h3 class="prop-sez">Classifica</h3>${classifica.map((c, i) => card(c, i + 1)).join("")}` : "");
  $("#view-proposte").innerHTML = plStrip("proposte") +
    (lista.length ? cards : `<p class="empty big">Nessuna proposta${state.fan ? " per ora." : ". Butta lì un pezzo da provare."}</p>`) +
    (state.fan ? "" : addSongBlock("proposte", "Proponi un pezzo", "Proponi"));
}

// ---------- registrazioni ----------
function recRow(r, mode) {
  const song = state.canzoni.find(c => c.id === r.canzoneId);
  // sulla riga solo titolo, etichetta, data e durata; file, chi l'ha caricata e Elimina si aprono toccando il titolo
  const senza = song ? r.etichetta : "senza canzone";
  let titolo, sotto;
  if (mode === "song") { titolo = fmtGiorno(r.data); sotto = [r.etichetta]; }
  else if (mode === "pref") { titolo = song ? song.titolo : (r.etichetta || "Registrazione"); sotto = [fmtGiorno(r.data), senza]; }
  else { titolo = song ? song.titolo : (r.etichetta || "Registrazione"); sotto = [senza]; }
  sotto = sotto.filter(Boolean).map(esc);
  // la stessa registrazione può stare sia fra le preferite sia nel suo giorno: si apre solo dove la si tocca
  const aperta = !state.fan && state.recInfo === `${r.id}:${mode}`;
  // stellina a destra, grande: la band la accende e la spegne; i fan la vedono solo accesa
  const stella = state.fan
    ? (r.preferita ? `<span class="stella on" aria-label="Preferita">${IC("stella")}</span>` : "")
    : `<button class="stella${r.preferita ? " on" : ""}" data-action="pref" data-id="${r.id}" aria-label="${r.preferita ? "Togli dalle preferite" : "Segna come preferita"}" aria-pressed="${r.preferita ? "true" : "false"}">${IC("stella")}</button>`;
  const nome = state.fan
    ? `<span class="rec-name">${esc(titolo)}</span>`
    : `<span class="rec-name" data-action="rec-info" data-id="${r.id}" data-modo="${mode}" role="button" tabindex="0" aria-expanded="${aperta}">${esc(titolo)}</span>`;
  const dettagli = !aperta ? "" : `
      <div class="rec-det">
        <span class="rec-det-t"><span class="rec-file">${esc(r.nomeFile || "nome del file non salvato")}</span>${[r.caricatoDa ? `caricata da ${esc(r.caricatoDa)}` : "", esc(fmtMB(r.size))].filter(Boolean).join(" · ")}</span>
        <button class="btn quiet" data-action="del-rec" data-id="${r.id}">${IC("cestino")}Elimina</button>
      </div>`;
  return `
    <div class="rec${r.preferita ? " pref" : ""}${aperta ? " aperta" : ""}" data-rec="${r.id}">
      ${nome}
      <span class="rec-meta">${sotto.map(t => `<span>${t}</span>`).join("")}<span class="time" data-time="${r.id}">${fmtTime(r.durata)}</span></span>
      ${stella}
      <div class="player">
        <button class="play" data-action="play" data-id="${r.id}" aria-label="Riproduci">${IC("play")}</button>
        <div class="line" data-action="seek" data-id="${r.id}"><span><i data-prog="${r.id}"></i></span></div>
      </div>${dettagli}
    </div>`;
}
function renderAudio() {
  const gruppi = [];
  state.registrazioni.forEach(r => {
    const g = gruppi.find(x => x.data === r.data);
    g ? g.items.push(r) : gruppi.push({ data: r.data, items: [r] });
  });
  const pref = preferite();
  const blocco = pref.length ? `
    <section class="rec-group pref-group">
      <h2 class="rec-date"><span class="stella on" aria-hidden="true">${IC("stella")}</span>Preferite <small>${pref.length}</small>${pref.length > 1 ? `<button class="tutte" data-action="play-preferite" aria-label="Ascolta tutte le preferite di fila">${IC("play")}Tutte</button>` : ""}</h2>
      ${pref.map(r => recRow(r, "pref")).join("")}
    </section>` : "";
  const lista = blocco + gruppi.map(g => `
    <section class="rec-group">
      <h2 class="rec-date">${esc(fmtDataLunga(g.data))} <small>${g.items.length}</small>${g.items.length > 1 ? `<button class="tutte" data-action="play-giorno" data-data="${esc(g.data || "")}" aria-label="Ascolta tutte le registrazioni di questo giorno, di fila">${IC("play")}Tutte</button>` : ""}</h2>
      ${[...g.items].sort(perOrdineDiProva).map(r => recRow(r, "audio")).join("")}
    </section>`).join("");
  const righe = state.righeUpload || [];
  const n = righe.length;
  const daCaricare = righe.filter(r => !r.salta).length;
  const up = state.upload;
  // una riga per file: nome breve dal file, canzone (indovinata), etichetta; la casella esclude il file
  const righeHtml = righe.map((r, i) => `
    <div class="up-row${r.salta ? " salta" : ""}">
      <label class="chk-row up-chk" aria-label="Carica questo file"><input type="checkbox" data-row="${i}" data-campo="carica" ${r.salta ? "" : "checked"}><span class="nt-box"></span></label>
      <span class="up-file"><b>${esc(r.breve)}</b>${r.ora != null ? ` <small>${String(Math.floor(r.ora / 60)).padStart(2, "0")}:${String(r.ora % 60).padStart(2, "0")}</small>` : ""}</span>
      <select class="field up-song" data-row="${i}" data-campo="canzoneId" data-keep="up-song-${i}" aria-label="Canzone" ${r.salta ? "disabled" : ""}>
        <option value="">senza canzone</option>${[...scaletta(), ...proposte()].map(c =>
          `<option value="${c.id}" ${c.id === r.canzoneId ? "selected" : ""}>${esc(c.titolo)}${c.artista ? " – " + esc(c.artista) : ""}</option>`).join("")}
      </select>
      <input class="field up-label" data-row="${i}" data-campo="etichetta" data-keep="up-label-${i}" value="${esc(r.etichetta)}" placeholder="Etichetta" maxlength="60" autocomplete="off" aria-label="Etichetta" ${r.salta ? "disabled" : ""}>
    </div>`).join("");
  const ACCETTA = `accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac" multiple`;
  // + in basso a destra: sceglie i file; con i file scelti (o durante il caricamento) le righe stanno in un foglio.
  // Sul computer resta anche una zona dove trascinare i file di una prova intera.
  const caricamento = state.fan ? "" : (n || up.active) ? `
    <form class="foglio upload con-righe" data-form="upload">
      <div class="foglio-testa"><h2>Carica registrazioni</h2>${up.active ? "" : `<button type="button" class="x" data-action="up-annulla" aria-label="Annulla">${IC("x")}</button>`}</div>
      <div class="foglio-corpo">
        ${n ? `
        <div class="up-testa">
          <label class="campo" style="margin:0"><span>Data della prova</span><input class="field" type="date" name="data" data-keep="up-date" value="${esc(dataDalleRighe(righe))}"></label>
          <label class="file-btn">${IC("piu")}<input type="file" ${ACCETTA}><span>Altri file</span></label>
        </div>
        <p class="up-hint">Pezzo e data sono ricavati dal nome dei file: controlla e correggi. Le righe senza pezzo si caricano con la loro etichetta.</p>
        <div class="up-rows">${righeHtml}</div>` : `<p class="up-hint">Non chiudere l'app finché il caricamento non è finito.</p>`}
      </div>
      <div class="foglio-barra">
        <div class="upload-progress${up.active ? "" : " hidden"}" id="up-prog">
          <div class="bar"><i style="width:${up.pct}%"></i></div><span class="upload-txt">${esc(up.txt)}</span>
        </div>
        ${up.active ? "" : `<span class="sp"></span>`}
        <button class="btn fill" type="submit" ${up.active || !daCaricare ? "disabled" : ""}>${up.active ? "Caricamento…" : daCaricare === 1 ? "Carica 1 file" : `Carica ${daCaricare} file`}</button>
      </div>
    </form>` : `
    <form class="upload upload-zona" data-form="upload">${IC("carica")}<span>Trascina qui i file di una prova, oppure tocca il +.</span></form>
    <label class="fab" title="Carica registrazioni" aria-label="Carica registrazioni"><input type="file" ${ACCETTA}>${IC("carica")}</label>`;
  $("#view-audio").innerHTML = `
    <div id="diretta-box"></div>
    ${state.registrazioni.length ? lista : `<p class="empty big">Nessuna registrazione${state.fan ? " per ora." : ". Carica l'audio delle prove con il pulsante in basso."}</p>`}
    ${caricamento}`;
  diretta.render();
}

// Riproduzione con due lettori che si danno il cambio: quello in uso suona, l'altro carica in anticipo
// la registrazione successiva della coda. Così il passaggio è quasi immediato e non dipende dalla rete
// (in macchina: gallerie, poca copertura). Con l'autoradio in Bluetooth un buco tra un brano e l'altro
// viene preso per una fermata e l'autoradio manda "pausa": per questo il passaggio deve essere rapido
// e una pausa arrivata dai comandi esterni subito dopo un cambio automatico non si esegue.
const lettori = [$("#player"), $("#player2")];
let player = lettori[0];
const altroLettore = () => (player === lettori[0] ? lettori[1] : lettori[0]);
const riproduzione = {
  vuole: false,        // chi ascolta vuole che suoni (play) o no (pausa, stop)
  cambio: 0,           // quando è avvenuto l'ultimo passaggio automatico al brano successivo
  pronto: null,        // id della registrazione caricata in anticipo nell'altro lettore
  prontoErrore: 0,     // quando è fallito l'ultimo caricamento in anticipo (si riprova dopo un po')
  srcCambiato: 0,      // quando l'app ha cambiato file al lettore (il cambio produce una "pausa" che non è di chi ascolta)
  riprendiDa: null,    // { url, pos }: dopo un errore di rete, il punto da cui ripartire
  errori: 0, timer: null,
  pos: 0, posUrl: null, // ultima posizione vista mentre suonava, e di quale file è (solo quello può ripartire da lì)
  ultimoT: -1, fermoDa: 0, // per il controllo periodico: ultima posizione vista e da quando non si muove
  ripartenze: 0        // ripartenze automatiche dopo l'ultimo cambio di brano (al massimo poche)
};
// ---------- diagnostica ----------
// Gli ultimi eventi della riproduzione (avvii, fine brano, pause e da dove vengono, errori, riprese)
// restano sul telefono: «Copia diagnostica» in fondo a Personale li mette negli appunti, da incollare
// a chi segue l'app quando la riproduzione di fila si ferma o salta un brano.
const DIAG_MAX = 120;
let diagVoci = [];
try { diagVoci = JSON.parse(localStorage.getItem("prove_diag") || "[]"); if (!Array.isArray(diagVoci)) diagVoci = []; } catch (e) { diagVoci = []; }
function diag(evento, dettagli) {
  const d = new Date();
  const ora = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  const r = state.playId && state.registrazioni.find(x => x.id === state.playId);
  const t = isFinite(player.currentTime) ? Math.round(player.currentTime) : "-";
  const dove = r ? ` [${infoRegistrazione(r).titolo.slice(0, 22)} ${t}s${player === lettori[1] ? " L2" : " L1"}]` : "";
  diagVoci.push(`${ora} ${evento}${dove}${dettagli ? " · " + dettagli : ""}`);
  if (diagVoci.length > DIAG_MAX) diagVoci.splice(0, diagVoci.length - DIAG_MAX);
  try { localStorage.setItem("prove_diag", JSON.stringify(diagVoci)); } catch (e) { /* niente */ }
}
function testoDiagnostica() {
  const testa = `Il ritmo della sala prove · versione ${APP_VERSION} · ${IS_IOS ? "iPhone/iPad" : IS_ANDROID ? "Android" : "computer"} · ${navigator.onLine ? "online" : "offline"} · schermo ${document.hidden ? "spento/altra app" : "acceso"}`;
  return [testa, ...diagVoci].join("\n");
}
function caricaIn(el, url) {
  if (el === player) riproduzione.srcCambiato = Date.now();
  el.src = url;
}
function svuotaLettore(el) {
  el.pause();
  el.removeAttribute("src");
  try { el.load(); } catch (e) { /* niente */ }
}
function suona() {
  riproduzione.vuole = true;
  statoSessione();
  return player.play().catch(e => {
    diag("avvio rifiutato", e && e.name);
    // in secondo piano il telefono può rifiutare: ci riprova il controllo periodico e il ritorno sull'app
    if (e && e.name === "NotAllowedError") return;
    if (e && e.name === "AbortError") return;
    toast("Impossibile riprodurre questo file.");
  });
}
// play dopo un errore di rete: si ricarica dal punto in cui era, altrimenti si riprende normalmente
function riparti() {
  if (player.error || riproduzione.timer) { riproduzione.vuole = true; riprendi(); } else suona();
}
function metti(r) {
  // la registrazione è già caricata nell'altro lettore: si scambiano
  const el = altroLettore();
  if (riproduzione.pronto === r.id && el.getAttribute("src") === r.url && !el.error) {
    const prima = player;
    player = altroLettore();
    riproduzione.srcCambiato = Date.now();
    svuotaLettore(prima);
    try { player.currentTime = 0; } catch (e) { /* niente */ }
    diag("scambio lettori", "pronta in anticipo");
  } else {
    // scelta a mano un'altra registrazione: quella caricata in anticipo non serve più
    if (altroLettore().getAttribute("src")) svuotaLettore(altroLettore());
    caricaIn(player, r.url);
    diag("carico", riproduzione.pronto === r.id ? "precarico non utilizzabile" : "non precaricata");
  }
  riproduzione.pronto = null;
  riproduzione.riprendiDa = null;
  // la posizione vista finora era del brano precedente: non deve diventare il punto di ripresa di questo
  riproduzione.pos = 0;
  riproduzione.posUrl = r.url;
  riproduzione.ultimoT = -1;
  riproduzione.fermoDa = Date.now();
  riproduzione.ripartenze = 0;
}
function playToggle(id, coda) {
  const r = state.registrazioni.find(x => x.id === id);
  if (!r) return;
  if (state.playId === id) {
    if (player.paused) { diag("play (tocco)"); riparti(); } else { diag("pausa (tocco)"); riproduzione.vuole = false; player.pause(); }
    return;
  }
  if (coda) state.coda = coda;
  if (!state.coda || !state.coda.includes(id)) state.coda = [id];
  state.playId = id;
  annullaRipresa();
  metti(r);
  diag("avvio", `${posizioneInCoda() || "sola"}`);
  suona();
  comandiRegistrazioni();
  infoSchermoBloccato(r);
  syncPlayer();
}
// stop: si ferma, si torna all'inizio e la barra in basso si chiude
function fermaRiproduzione() {
  if (state.playId) diag("stop");
  riproduzione.vuole = false;
  annullaRipresa();
  player.pause();
  try { player.currentTime = 0; } catch (e) { /* file non ancora caricato */ }
  svuotaLettore(altroLettore());
  riproduzione.pronto = null;
  riproduzione.riprendiDa = null;
  riproduzione.pos = 0;
  riproduzione.posUrl = null;
  state.playId = null;
  state.coda = null;
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = null;
    try { navigator.mediaSession.playbackState = "none"; } catch (e) { /* niente */ }
  }
  syncPlayer();
}
// passa alla registrazione successiva (passo 1) o precedente (−1) della coda; false se non c'è
function vaiInCoda(passo, automatico = false) {
  const c = (state.coda || []).filter(id => state.registrazioni.some(r => r.id === id));
  const i = c.indexOf(state.playId);
  const j = i + passo;
  if (i < 0 || j < 0 || j >= c.length) return false;
  state.coda = c;
  if (automatico) riproduzione.cambio = Date.now();
  playToggle(c[j]);
  return true;
}
// la successiva della coda, da caricare in anticipo
function prossimaInCoda() {
  const c = (state.coda || []).filter(id => state.registrazioni.some(r => r.id === id));
  const i = c.indexOf(state.playId);
  return i >= 0 && i < c.length - 1 ? state.registrazioni.find(r => r.id === c[i + 1]) : null;
}
// si carica la successiva quando mancano due minuti alla fine (subito, per i brani brevi)
function preparaProssima() {
  const r = prossimaInCoda();
  if (!r || riproduzione.pronto === r.id || Date.now() - riproduzione.prontoErrore < 20000) return;
  const dur = player.duration;
  if (!isFinite(dur) || dur - player.currentTime > 120) return;
  const el = altroLettore();
  el.preload = "auto";
  el.src = r.url;
  try { el.load(); } catch (e) { /* niente */ }
  riproduzione.pronto = r.id;
  diag("precarico", `prossima: ${infoRegistrazione(r).titolo.slice(0, 22)}`);
}
// posizione nella coda, es. "2 di 7" (vuoto se si ascolta una registrazione sola)
function posizioneInCoda() {
  const c = (state.coda || []).filter(id => state.registrazioni.some(r => r.id === id));
  const i = c.indexOf(state.playId);
  return c.length > 1 && i >= 0 ? `${i + 1} di ${c.length}` : "";
}
function salta(sec) {
  if (!state.playId || !isFinite(player.duration)) return;
  player.currentTime = Math.max(0, Math.min(player.duration - 0.1, player.currentTime + sec));
  diag(`salto di ${sec > 0 ? "+" : ""}${sec} s`);
}
// ---------- ripresa dopo un errore di rete (galleria, campo che va e viene) ----------
// si ricarica la stessa registrazione dal punto in cui era, con attese crescenti (fino a circa 5 minuti)
const ATTESE_RIPRESA = [2, 4, 8, 15, 30, 30, 60, 60, 90];
function annullaRipresa() {
  clearTimeout(riproduzione.timer);
  riproduzione.timer = null;
  riproduzione.errori = 0;
}
function programmaRipresa(motivo) {
  if (!state.playId || !riproduzione.vuole || riproduzione.timer) return;
  if (riproduzione.errori >= ATTESE_RIPRESA.length) { diag("ripresa abbandonata", motivo); toast("Registrazione interrotta: niente rete."); return; }
  const attesa = ATTESE_RIPRESA[riproduzione.errori++] * 1000;
  diag("ripresa fra " + attesa / 1000 + " s", motivo);
  riproduzione.timer = setTimeout(riprendi, attesa);
}
function riprendi() {
  clearTimeout(riproduzione.timer);
  riproduzione.timer = null;
  const r = state.registrazioni.find(x => x.id === state.playId);
  if (!r || !riproduzione.vuole) return;
  // il punto si applica quando il file è di nuovo caricato (vedi loadedmetadata), solo se è ancora lui:
  // la posizione vale solo se è stata vista su questo stesso file, mai quella del brano precedente
  const pos = riproduzione.posUrl === r.url ? riproduzione.pos : 0;
  if (!riproduzione.riprendiDa || riproduzione.riprendiDa.url !== r.url) riproduzione.riprendiDa = { url: r.url, pos };
  diag("ripresa", `da ${Math.round(riproduzione.riprendiDa.pos)} s`);
  caricaIn(player, r.url);
  suona();
}
window.addEventListener("online", () => { diag("rete tornata"); if (riproduzione.timer) riprendi(); });
// tornando sull'app: se doveva suonare e il telefono l'aveva bloccata, riparte
document.addEventListener("visibilitychange", () => {
  diag(document.visibilityState === "visible" ? "app in primo piano" : "app in secondo piano");
  if (document.visibilityState !== "visible") return;
  if (state.playId && riproduzione.vuole && player.paused && !riproduzione.timer && !player.error) suona();
  syncPlayer();
});
// Controllo periodico: copre quello che gli eventi non segnalano. Se dovrebbe suonare ma il lettore è in
// pausa (avvio rifiutato a schermo spento, pausa del sistema arrivata subito dopo un cambio di brano)
// riparte, poche volte per brano. Se il tempo non avanza da un po' senza errori (rete sparita negli ultimi
// secondi, fine brano mai segnalata) ricarica dal punto in cui era, o passa al brano dopo se era alla fine.
const FERMO_MS = 12000, MAX_RIPARTENZE = 3;
function controlloRiproduzione() {
  if (!state.playId || !riproduzione.vuole || riproduzione.timer) return;
  const t = player.currentTime || 0;
  if (player.paused && !player.ended && !player.error) {
    if (riproduzione.ripartenze >= MAX_RIPARTENZE) return;
    riproduzione.ripartenze++;
    diag("ripartenza automatica", `${riproduzione.ripartenze} di ${MAX_RIPARTENZE}`);
    suona();
    return;
  }
  if (t !== riproduzione.ultimoT) { riproduzione.ultimoT = t; riproduzione.fermoDa = Date.now(); return; }
  // un file che sta ancora arrivando (nessun dato, posizione 0) ha più tempo: ricaricarlo lo farebbe ripartire da capo
  const limite = t === 0 && player.readyState < 2 ? FERMO_MS * 2.5 : FERMO_MS;
  if (player.paused || Date.now() - riproduzione.fermoDa < limite) return;
  riproduzione.fermoDa = Date.now();
  const dur = player.duration;
  if (isFinite(dur) && dur > 0 && dur - t < 1.5) {
    diag("fine brano non segnalata");
    if (!vaiInCoda(1, true)) fermaRiproduzione();
    return;
  }
  diag("fermo da " + Math.round(limite / 1000) + " s", `rete ${navigator.onLine ? "ok" : "assente"}, stato ${player.readyState}`);
  programmaRipresa("fermo");
}
setInterval(controlloRiproduzione, 4000);
// stato e posizione per lo schermo bloccato, le cuffie e l'autoradio (Bluetooth, Android Auto)
function statoSessione() {
  // senza una registrazione in corso la sessione non è delle registrazioni (può essere della diretta)
  if (!("mediaSession" in navigator) || !state.playId) return;
  const ms = navigator.mediaSession;
  try { ms.playbackState = riproduzione.vuole ? "playing" : "paused"; } catch (e) { /* niente */ }
  const dur = player.duration;
  if (state.playId && ms.setPositionState && isFinite(dur) && dur > 0) {
    try { ms.setPositionState({ duration: dur, playbackRate: player.playbackRate || 1, position: Math.min(player.currentTime || 0, dur) }); } catch (e) { /* niente */ }
  }
}
// titolo della registrazione: la canzone (o l'etichetta), sotto etichetta e data
function infoRegistrazione(r) {
  const song = state.canzoni.find(c => c.id === r.canzoneId);
  const titolo = song ? song.titolo : (r.etichetta || "Registrazione");
  const sotto = [song && r.etichetta ? r.etichetta : "", fmtGiorno(r.data)].filter(Boolean).join(" · ");
  return { titolo, sotto };
}
// comandi sullo schermo bloccato e nelle notifiche del telefono
function infoSchermoBloccato(r) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  const { titolo, sotto } = infoRegistrazione(r);
  const pos = posizioneInCoda();
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titolo, artist: [sotto, pos].filter(Boolean).join(" · "), album: "Il ritmo della sala prove",
      artwork: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }]
    });
  } catch (e) { /* browser senza supporto */ }
}
// comandi delle registrazioni (la diretta mette i suoi mentre si ascolta, poi li rimette questi)
function comandiRegistrazioni() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const prova = (azione, fn) => { try { ms.setActionHandler(azione, fn); } catch (e) { /* azione non supportata */ } };
  prova("play", () => { diag("play (comando esterno)"); riparti(); });
  // una pausa che arriva dall'autoradio subito dopo un cambio automatico di brano non è di chi ascolta
  const appenaCambiato = () => Date.now() - riproduzione.cambio < 2500;
  prova("pause", () => { if (appenaCambiato()) { diag("pausa (comando esterno) ignorata", "subito dopo il cambio"); return; } diag("pausa (comando esterno)"); riproduzione.vuole = false; player.pause(); statoSessione(); });
  prova("stop", () => { if (appenaCambiato()) { diag("stop (comando esterno) ignorato", "subito dopo il cambio"); return; } diag("stop (comando esterno)"); fermaRiproduzione(); });
  prova("seekbackward", (d) => salta(-(d.seekOffset || 10)));
  prova("seekforward", (d) => salta(d.seekOffset || 10));
  prova("seekto", (d) => { if (isFinite(player.duration)) player.currentTime = d.seekTime; });
  // tasti avanti/indietro di brano (schermo bloccato, cuffie, volante dell'auto)
  const c = state.coda || [], i = c.indexOf(state.playId);
  prova("nexttrack", i >= 0 && i < c.length - 1 ? () => { diag("brano successivo (comando esterno)"); vaiInCoda(1); } : null);
  prova("previoustrack", () => {
    diag("brano precedente (comando esterno)");
    if (player.currentTime > 3 || !vaiInCoda(-1)) { try { player.currentTime = 0; } catch (e) { /* niente */ } }
  });
}
comandiRegistrazioni();
// barra "in riproduzione" sopra la barra delle sezioni: c'è finché una registrazione è caricata
// (anche in pausa); si chiude con lo stop o a fine brano
const ICO_INDIETRO = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.5 6v12L3 12zM21 6v12l-8.5-6z"/></svg>`;
const ICO_AVANTI = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 6v12L21 12zM3 6v12l8.5-6z"/></svg>`;
function renderMini() {
  const el = $("#mini");
  if (!el) return;
  const r = state.playId && state.registrazioni.find(x => x.id === state.playId);
  document.body.classList.toggle("con-mini", !!r);
  if (!r) { el.classList.add("hidden"); el.innerHTML = ""; el.dataset.id = ""; return; }
  const info = infoRegistrazione(r);
  const titolo = info.titolo;
  const sotto = [info.sotto, posizioneInCoda()].filter(Boolean).join(" · ");
  const chiave = `${r.id}|${titolo}|${sotto}`;
  if (el.dataset.id === chiave) return;
  el.dataset.id = chiave;
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="line mini-line" data-action="seek" data-id="${r.id}"><span><i data-prog="${r.id}"></i></span></div>
    <button class="mini-salta" data-action="mini-salta" data-sec="-10" aria-label="Indietro di 10 secondi">${ICO_INDIETRO}</button>
    <button class="play on mini-play" data-action="play" data-id="${r.id}" aria-label="Pausa">${IC("pausa")}</button>
    <button class="mini-salta" data-action="mini-salta" data-sec="10" aria-label="Avanti di 10 secondi">${ICO_AVANTI}</button>
    <button class="mini-txt" data-action="mini-vai" data-id="${r.id}" aria-label="Vai alla registrazione">
      <b>${esc(titolo)}</b><span class="mini-sub"><span class="mini-quando">${esc(sotto)}</span><span class="mini-time" data-time="${r.id}"></span></span>
    </button>
    <button class="mini-stop" data-action="mini-stop" aria-label="Ferma e chiudi">${IC("stop")}</button>`;
}
function syncPlayer() {
  // a schermo spento non serve ridisegnare: si aggiorna al ritorno
  if (document.hidden) return;
  renderMini();
  const cur = state.playId, playing = cur && !player.paused, dur = player.duration;
  document.querySelectorAll(".play").forEach(b => {
    const isCur = b.dataset.id === cur;
    b.classList.toggle("on", isCur);
    const p = isCur && playing;
    // l'icona si cambia solo quando cambia lo stato (timeupdate arriva più volte al secondo)
    if (b.dataset.stato !== (p ? "pausa" : "play")) { b.dataset.stato = p ? "pausa" : "play"; b.innerHTML = IC(p ? "pausa" : "play"); }
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
// gli eventi contano solo per il lettore in uso (l'altro sta solo caricando la successiva)
lettori.forEach(el => {
  const delPlayer = (fn) => (e) => { if (e.target === player) fn(e); };
  ["play", "pause", "timeupdate", "ended", "loadedmetadata"].forEach(ev => el.addEventListener(ev, delPlayer(syncPlayer)));
  el.addEventListener("timeupdate", delPlayer(() => {
    if (!player.paused) {
      riproduzione.pos = player.currentTime;
      riproduzione.posUrl = player.getAttribute("src");
      if (riproduzione.errori && player.currentTime > 0) riproduzione.errori = 0;
    }
    preparaProssima();
  }));
  el.addEventListener("loadedmetadata", delPlayer(() => {
    const rd = riproduzione.riprendiDa;
    if (rd && player.getAttribute("src") === rd.url) {
      riproduzione.riprendiDa = null;
      // mai oltre la fine del file: un punto fuori dal brano lo farebbe finire subito (e saltare al successivo)
      const dur = player.duration;
      const ok = rd.pos > 0 && (!isFinite(dur) || rd.pos < dur - 1);
      try { if (ok) player.currentTime = rd.pos; } catch (e) { /* niente */ }
      if (rd.pos > 0 && !ok) diag("punto di ripresa scartato", `${Math.round(rd.pos)} s su ${Math.round(dur)} s`);
    }
    statoSessione(); preparaProssima();
  }));
  el.addEventListener("play", delPlayer(() => { riproduzione.vuole = true; statoSessione(); }));
  el.addEventListener("playing", delPlayer(() => diag("suona")));
  el.addEventListener("waiting", delPlayer(() => diag("in attesa di dati", `stato ${player.readyState}`)));
  el.addEventListener("stalled", delPlayer(() => diag("rete ferma")));
  // pausa decisa dal telefono (cuffie staccate, telefonata): chi ascolta non vuole più che suoni.
  // A fine brano la pausa arriva insieme a "ended" e non conta.
  el.addEventListener("pause", delPlayer(() => {
    // non è di chi ascolta: fine brano, errore di rete, ripresa in corso, file appena cambiato dall'app
    if (!riproduzione.vuole || !player.paused || player.ended || player.error || riproduzione.timer) return;
    // nei 20 s dopo un cambio di file una pausa del sistema (perdita dell'audio, autoradio in Bluetooth)
    // non è di chi ascolta: resta la volontà di suonare e il controllo periodico fa ripartire
    if (Date.now() - riproduzione.srcCambiato < 20000) { diag("pausa (sistema) ignorata", "subito dopo il cambio"); return; }
    diag("pausa (sistema)");
    riproduzione.vuole = false;
    statoSessione();
  }));
  el.addEventListener("seeked", delPlayer(statoSessione));
  // a fine brano parte la successiva della coda; a fine coda la barra si chiude (come con lo stop)
  el.addEventListener("ended", delPlayer(() => { diag("fine brano"); if (!vaiInCoda(1, true)) fermaRiproduzione(); }));
  // errore di rete mentre si ascolta: si riprova dallo stesso punto
  el.addEventListener("error", (e) => {
    if (e.target === player) {
      diag("errore", `codice ${player.error && player.error.code}, rete ${navigator.onLine ? "ok" : "assente"}`);
      if (state.playId && riproduzione.vuole) programmaRipresa("errore");
      return;
    }
    // fallito il caricamento in anticipo: al passaggio si caricherà normalmente
    if (riproduzione.pronto && el.getAttribute("src")) { diag("precarico fallito"); riproduzione.pronto = null; riproduzione.prontoErrore = Date.now(); }
  });
  el.addEventListener("loadedmetadata", delPlayer(() => {
    const r = state.registrazioni.find(x => x.id === state.playId);
    if (r && !r.durata && isFinite(player.duration) && !state.fan) {
      updateDoc(doc(db, "registrazioni", r.id), { durata: Math.round(player.duration) }).catch(() => {});
    }
  }));
});

// ---------- caricamento di più file: cosa dice il nome del file ----------
// GarageBand esporta "<nome del progetto> - 27/10/26, 09.19.mp3": il nome del progetto è un nome breve
// della canzone (anche storpiato: "shut", "foxey") seguito a volte dal giorno della prova ("26ott26").
// Da qui si ricavano: il nome breve, il giorno della prova e l'ora dell'esportazione (per l'ordine).
const MESI_BREVI = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12 };
function analizzaNomeFile(nome) {
  let s = String(nome || "").replace(/\.[a-z0-9]{2,5}$/i, "");
  let ora = null;
  const m = s.match(/\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s*(\d{1,2})[.:](\d{2})\s*$/);
  if (m) { ora = Number(m[4]) * 60 + Number(m[5]); s = s.slice(0, m.index); }
  let data = null;
  const d = s.match(/\b(\d{1,2})\s*(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*\.?\s*(\d{2}|\d{4})?\b/i);
  if (d) {
    const anno = d[3] ? (d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3])) : annoCorrente;
    data = `${anno}-${String(MESI_BREVI[d[2].toLowerCase()]).padStart(2, "0")}-${String(d[1]).padStart(2, "0")}`;
    s = s.slice(0, d.index) + s.slice(d.index + d[0].length);
  }
  const breve = s.replace(/[_\s]+/g, " ").replace(/\s*[-–,]+\s*$/, "").trim();
  return { breve: breve || String(nome || "").replace(/\.[a-z0-9]{2,5}$/i, ""), data, ora };
}
const senzaAccenti = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const parole = (s) => senzaAccenti(s).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
// Canzone per un nome breve: prima la memoria (una registrazione già caricata con lo stesso nome
// breve e una canzone: se Mattia l'ha abbinata una volta, le volte dopo è automatico), poi il testo
// (le parole del nome breve, senza numeri in coda, sono l'inizio delle parole del titolo, nell'ordine).
// Se più canzoni vanno bene allo stesso modo non si sceglie: meglio un menu vuoto che un abbinamento sbagliato.
function indovinaCanzone(breve) {
  const chiave = parole(breve).join(" ");
  if (!chiave) return "";
  const memoria = [...state.registrazioni]
    .sort((a, b) => msDi(b.creato) - msDi(a.creato))
    .find(r => r.canzoneId && r.nomeFile && parole(analizzaNomeFile(r.nomeFile).breve).join(" ") === chiave && state.canzoni.some(c => c.id === r.canzoneId));
  if (memoria) return memoria.canzoneId;
  const cerca = parole(breve.replace(/\d+$/, ""));
  if (!cerca.length) return "";
  let migliori = [], punteggio = 0;
  [...scaletta(), ...proposte()].forEach(c => {
    const tit = parole(c.titolo);
    let i = 0, p = 0;
    for (const w of cerca) {
      const j = tit.findIndex((t, k) => k >= i && t.startsWith(w));
      if (j < 0) { p = 0; break; }
      p += w.length === tit[j].length ? 2 : 1;
      i = j + 1;
    }
    if (!p) return;
    if (p > punteggio) { punteggio = p; migliori = [c]; }
    else if (p === punteggio) migliori.push(c);
  });
  return migliori.length === 1 ? migliori[0].id : "";
}
// Righe del modulo: una per file, nell'ordine di esportazione (l'ordine della prova)
function preparaRighe(files) {
  const righe = [...files].map((file, i) => ({ file, i, ...analizzaNomeFile(file.name), canzoneId: "", etichetta: "", salta: false }));
  righe.sort((a, b) => (a.ora ?? -1) - (b.ora ?? -1) || a.i - b.i);
  righe.forEach(r => { r.canzoneId = indovinaCanzone(r.breve); if (!r.canzoneId) r.etichetta = r.breve; });
  // lo stesso pezzo più volte nella stessa prova: "take 1", "take 2"…
  const perCanzone = {};
  righe.forEach(r => { if (r.canzoneId) (perCanzone[r.canzoneId] ||= []).push(r); });
  Object.values(perCanzone).forEach(l => { if (l.length > 1) l.forEach((r, n) => { r.etichetta = `take ${n + 1}`; }); });
  return righe;
}
// giorno della prova: quello scritto nel nome dei file (il più frequente), altrimenti oggi
function dataDalleRighe(righe) {
  const conta = {};
  righe.forEach(r => { if (r.data) conta[r.data] = (conta[r.data] || 0) + 1; });
  const [best] = Object.entries(conta).sort((a, b) => b[1] - a[1]);
  return best ? best[0] : oggi();
}
function impostaFile(files) {
  const audio = [...files].filter(f => /^audio\//.test(f.type) || /\.(m4a|mp3|wav|ogg|aac|aif|aiff|flac)$/i.test(f.name));
  state.pendingFiles = audio;
  state.righeUpload = preparaRighe(audio);
  render();
}

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

// ---------- bacheca: post, commenti sotto ai post, mi piace ----------
// Documenti in "bacheca": post { nome, testo, band, creato, piace } e commenti con in più postId.
// I fan pubblicano passando dalla funzione "accesso" (che li gira anche nel gruppo Telegram);
// la band scrive direttamente e può togliere post e commenti. I "mi piace" (campo piace:
// chiave → true) li scrivono tutti direttamente: per i fan le regole permettono solo quel campo.
const msMsg = (m) => msDi(m.creato) || Date.now();
function quandoMsg(m) {
  const d = new Date(msMsg(m));
  const ora = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (new Date().toDateString() === d.toDateString()) return `oggi ${ora}`;
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short", ...(d.getFullYear() !== annoCorrente ? { year: "numeric" } : {}) }) + ` ${ora}`;
}
const mioMsg = (m) => state.fan ? !m.band && m.nome === state.fanNome : m.band && m.nome === state.user;
// chi mette mi piace: la persona della band, o il telefono del fan (due fan con lo stesso nome restano distinti)
function chiavePiace() {
  if (!state.fan) return "b:" + (state.userId || state.user || "band");
  let id = store.get("prove_fan_id");
  if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); store.set("prove_fan_id", id); }
  return "f:" + id;
}
const quantiPiace = (m) => Object.keys(m.piace || {}).length;
function segnaBachecaVista() {
  const ultimo = state.bacheca.reduce((t, m) => Math.max(t, msMsg(m)), 0);
  store.set("prove_bacheca_vista", String(Math.max(ultimo, Number(store.get("prove_bacheca_vista") || 0))));
  aggiornaPuntoBacheca();
}
// pallino sulla sezione: post o commenti di altri arrivati dopo l'ultima visita
function aggiornaPuntoBacheca() {
  const vista = Number(store.get("prove_bacheca_vista") || 0);
  const nuovi = state.tab !== "bacheca" && state.bacheca.some(m => msMsg(m) > vista && !mioMsg(m));
  document.querySelector('.tab[data-tab="bacheca"]')?.classList.toggle("nuovi", nuovi);
}
function chiMsg(m) {
  return m.band ? `${iniTag(m.nome)}<b>${esc(m.nome)}</b><span class="msg-band">band</span>` : `<b>${esc(m.nome || "Fan")}</b>`;
}
function bottonePiace(m) {
  const n = quantiPiace(m), mio = !!(m.piace || {})[chiavePiace()];
  return `<button class="piace${mio ? " on" : ""}" data-action="piace" data-id="${m.id}" aria-pressed="${mio}" aria-label="Mi piace${n ? ", " + n : ""}">${IC("cuore")}${n ? n : ""}</button>`;
}
function renderBacheca() {
  const view = $("#view-bacheca");
  if (!view) return;
  if (state.bachecaNegata) {
    view.innerHTML = `<p class="empty big">${state.fan ? "La bacheca non è ancora pronta." : "La bacheca si attiva quando le regole del database includono «bacheca» (file firestore.rules del progetto, da incollare in Console Firebase → Firestore Database → Regole)."}</p>`;
    return;
  }
  if (state.tab === "bacheca" && state.ready.bacheca) segnaBachecaVista(); else aggiornaPuntoBacheca();
  const togli = (m, cosa) => state.fan ? "" : `<button class="del-mini" data-action="del-msg" data-id="${m.id}" aria-label="Togli ${cosa}" title="Togli">${IC("x")}</button>`;
  const posts = state.bacheca.filter(m => !m.postId);
  const commentiDi = (id) => state.bacheca.filter(m => m.postId === id).sort((a, b) => msMsg(a) - msMsg(b));
  const lista = posts.map(p => {
    const cs = commentiDi(p.id);
    const aperto = state.commentaPost === p.id;
    return `
      <article class="msg${p.band ? " band" : ""}" data-post="${p.id}">
        <div class="msg-head"><span class="msg-chi">${chiMsg(p)}</span><span class="msg-quando">${esc(quandoMsg(p))}</span>${togli(p, "il post e i suoi commenti")}</div>
        <p class="msg-txt">${esc(p.testo)}</p>
        <div class="msg-piede">${bottonePiace(p)}<button class="msg-commenta" data-action="commenta" data-id="${p.id}" aria-expanded="${aperto}">Commenta</button></div>
        ${cs.length || aperto ? `<div class="cmts">
          ${cs.map(c => `
            <div class="cmt">
              <div class="cmt-riga"><span class="cmt-chi">${chiMsg(c)}</span><span class="msg-quando">${esc(quandoMsg(c))}</span>${togli(c, "il commento")}</div>
              <div class="cmt-corpo"><span class="cmt-txt">${esc(c.testo)}</span>${bottonePiace(c)}</div>
            </div>`).join("")}
          ${aperto ? `
            <form class="cmt-form" data-form="bacheca-commento" data-post="${p.id}">
              <input class="field" name="testo" data-keep="cmt-${p.id}" maxlength="300" placeholder="Scrivi un commento…" autocomplete="off" required>
              <button class="btn fill" type="submit">Invia</button>
            </form>` : ""}
        </div>` : ""}
      </article>`;
  }).join("");
  view.innerHTML = `
    <form class="msg-form" data-form="bacheca">
      <textarea class="field" name="testo" data-keep="bacheca-testo" maxlength="500" rows="3" placeholder="${state.fan ? "Scrivi un post per la band: un commento, un pezzo da suonare, un'idea per l'app…" : "Scrivi un post…"}" required></textarea>
      <div class="msg-azioni"><span class="msg-come">${state.fan ? `come <b>${esc(state.fanNome || "Fan")}</b>` : state.user ? `come <b>${esc(state.user)}</b>` : ""}</span><button class="btn fill" type="submit">Pubblica</button></div>
    </form>
    ${lista || `<p class="empty big">Ancora nessun post.</p>`}`;
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
    // data a colonna: giorno sopra, mese sotto (l'anno solo se non è quello in corso)
    const g = m.data ? parseIso(m.data) : null;
    const mese = g ? g.toLocaleDateString("it-IT", { month: "short" }).replace(".", "") + (g.getFullYear() !== annoCorrente ? ` ${String(g.getFullYear()).slice(2)}` : "") : "";
    return `
      <div class="mov" data-action="mov" data-id="${m.id}" role="button" tabindex="0" aria-expanded="${open}">
        <span class="d">${g ? `<b>${g.getDate()}</b>${esc(mese)}` : ""}</span>
        <span><span class="what">${esc(m.descrizione)}</span><span class="w">${esc(m.chi || "")}</span></span>
        <span class="amt${entrata ? " in" : ""}">${entrata ? "+" : "−"} ${NUM.format((m.importoCent || 0) / 100)}</span>
        ${open ? `<div class="mov-detail"><span>Registrato da ${esc(m.registratoDa || "—")}${quando ? ` il ${esc(quando)}` : ""}</span><span class="sp"></span>
          <button class="x" data-action="del-mov" data-id="${m.id}" aria-label="Elimina movimento" title="Elimina">${IC("cestino")}</button></div>` : ""}
      </div>`;
  }).join("");
  const spesa = state.tipoMov === "spesa";
  const chiOpts = state.membri.map(m =>
    `<option value="${esc(m.nome)}"${m.nome === state.user ? " selected" : ""}>${esc(m.nome)}</option>`).join("");
  // nuovo movimento: + in basso a destra, il modulo in un foglio con «Registra» sotto il pollice
  const modulo = !state.addOpen.cassa
    ? `<button class="fab" data-action="add-open" data-where="cassa" aria-label="Nuovo movimento" title="Nuovo movimento">${IC("piu")}</button>`
    : `
      <form class="foglio" data-form="mov">
        <div class="foglio-testa"><h2>Nuovo movimento</h2><button type="button" class="x" data-action="add-chiudi" data-where="cassa" aria-label="Chiudi">${IC("x")}</button></div>
        <div class="foglio-corpo">
          <div class="cassa-form">
            <div class="seg" role="group" aria-label="Tipo di movimento">
              <button type="button" class="${spesa ? "on" : ""}" data-action="tipo" data-tipo="spesa" aria-pressed="${spesa}">Spesa</button>
              <button type="button" class="${spesa ? "" : "on"}" data-action="tipo" data-tipo="versamento" aria-pressed="${!spesa}">Versamento</button>
            </div>
            <label class="campo wide"><span>Importo</span><input class="field importo" name="importo" data-keep="mov-imp" inputmode="decimal" placeholder="0,00 €" autocomplete="off" required></label>
            <label class="campo wide"><span>${spesa ? "Cosa è stato comprato" : "Per cosa"}</span><input class="field" name="descrizione" data-keep="mov-desc" placeholder="${spesa ? "es. corde, pelli, cavi" : "es. quota di ottobre"}" maxlength="80" autocomplete="off" required></label>
            <label class="campo"><span>${spesa ? "Chi ha comprato" : "Chi ha versato"}</span><select class="field" name="chi" data-keep="mov-chi">${chiOpts}</select></label>
            <label class="campo"><span>Data</span><input class="field" type="date" name="data" data-keep="mov-data" value="${oggi()}"></label>
          </div>
        </div>
        <div class="foglio-barra"><span class="sp"></span><button class="btn fill" type="submit">Registra ${spesa ? "spesa" : "versamento"}</button></div>
      </form>`;
  $("#view-cassa").innerHTML = `
      <div class="saldo">
        <span class="lbl">In cassa</span>
        <span class="tot">versato <b>${euro(versato)}</b><br>speso <b>${euro(speso)}</b></span>
        <span class="big${saldo < 0 ? " neg" : ""}">${euro(saldo)}</span>
      </div>
      ${movs.length ? rows : `<div class="mov-empty">Nessun movimento. Registra il primo con il +.</div>`}
      ${modulo}`;
}

// ---------- nomi nei dati: rinominare e unire ----------
// Voti, task, spese e registrazioni portano il nome della persona: rinominando,
// il nome va cambiato ovunque; un nome che non corrisponde più a nessuno è "orfano".
function nomiInUso() {
  const uso = new Map();
  const add = (n, k) => { if (!n) return; const o = uso.get(n) || { voti: 0, task: 0, altro: 0 }; o[k]++; uso.set(n, o); };
  state.tasks.forEach(t => { (t.assegnatari || []).forEach(n => add(n, "task")); add(t.fattoDa, "task"); (Array.isArray(t.fattiDa) ? t.fattiDa : []).forEach(n => add(n, "task")); });
  state.canzoni.forEach(c => { Object.keys(c.reazioni || {}).forEach(n => add(n, "voti")); add(c.propostaDa, "altro"); });
  state.registrazioni.forEach(r => add(r.caricatoDa, "altro"));
  state.movimenti.forEach(m => { add(m.chi, "altro"); add(m.registratoDa, "altro"); });
  return uso;
}
const ignorati = () => new Set(JSON.parse(store.get("prove_nomi_ignorati") || "[]"));
function nomiOrfani() {
  const noti = new Set(state.membri.map(m => m.nome)), ign = ignorati();
  return [...nomiInUso()].filter(([n]) => !noti.has(n) && !ign.has(n));
}
// prepara in un unico batch il passaggio di tutto ciò che è di "vecchio" a "nuovo"
function sostituisciNome(vecchio, nuovo) {
  const batch = writeBatch(db);
  let n = 0;
  state.tasks.forEach(t => {
    const ass = t.assegnatari || [], upd = {};
    if (ass.includes(vecchio)) upd.assegnatari = [...new Set(ass.map(x => x === vecchio ? nuovo : x))];
    if (t.fattoDa === vecchio) upd.fattoDa = nuovo;
    if (Array.isArray(t.fattiDa) && t.fattiDa.includes(vecchio)) upd.fattiDa = [...new Set(t.fattiDa.map(x => x === vecchio ? nuovo : x))];
    if (Object.keys(upd).length) { batch.update(doc(db, "tasks", t.id), upd); n++; }
  });
  state.canzoni.forEach(c => {
    const r = c.reazioni || {}, upd = {};
    if (Object.prototype.hasOwnProperty.call(r, vecchio)) {
      const nr = { ...r };
      const cm = { ...(c.commenti || {}) };
      if (Object.prototype.hasOwnProperty.call(cm, vecchio)) {
        if (!Object.prototype.hasOwnProperty.call(nr, nuovo)) cm[nuovo] = cm[vecchio];
        delete cm[vecchio];
        upd.commenti = cm;
      }
      if (!Object.prototype.hasOwnProperty.call(nr, nuovo)) nr[nuovo] = nr[vecchio]; // se ha votato con entrambi i nomi resta il voto dato col nome nuovo
      delete nr[vecchio];
      upd.reazioni = nr;
    }
    if (c.propostaDa === vecchio) upd.propostaDa = nuovo;
    if (Object.keys(upd).length) { batch.update(doc(db, "canzoni", c.id), upd); n++; }
  });
  state.registrazioni.forEach(r => { if (r.caricatoDa === vecchio) { batch.update(doc(db, "registrazioni", r.id), { caricatoDa: nuovo }); n++; } });
  state.movimenti.forEach(m => {
    const upd = {};
    if (m.chi === vecchio) upd.chi = nuovo;
    if (m.registratoDa === vecchio) upd.registratoDa = nuovo;
    if (Object.keys(upd).length) { batch.update(doc(db, "movimenti", m.id), upd); n++; }
  });
  return { batch, n };
}
function descriviUso(o) {
  const p = [];
  if (o.voti) p.push(`${o.voti} ${o.voti === 1 ? "voto" : "voti"}`);
  if (o.task) p.push(`${o.task} task`);
  if (o.altro) p.push(`${o.altro} ${o.altro === 1 ? "altro riferimento" : "altri riferimenti"}`);
  return p.join(", ");
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

  const whoBar = `<div class="who-bar"><span class="lbl">Pagina di</span>${state.membri.map(m => {
    const col = colorOf(m.nome);
    return `<button class="ini${LIGHT_BG.has(col) ? " light" : ""}${m.nome === nome ? " sel" : ""}" style="background:${col}" data-action="view-person" data-nome="${esc(m.nome)}" title="${esc(m.nome)}" aria-pressed="${m.nome === nome}">${esc(siglaOf(m.nome))}</button>`;
  }).join("")}</div>`;

  // i task di un pezzo tornato fra le proposte restano da parte e non si vedono finché non è di nuovo in scaletta
  const mine = state.tasks.filter(t => (t.assegnatari || []).includes(nome) && state.canzoni.some(c => c.id === t.canzoneId && c.stato !== "proposta"));
  const aperti = mine.filter(t => !parteFatta(t, nome));
  const daFare = aperti.map(t => {
    const song = state.canzoni.find(c => c.id === t.canzoneId);
    const gen = song && isGenerale(song);
    return `
      <div class="ptask">
        <button class="chk" data-action="check" data-id="${t.id}" data-nome="${esc(nome)}" aria-label="Segna fatto"></button>
        <span><span class="ptask-song${gen ? " gen" : ""}">${gen ? "Generale" : esc(song?.titolo || "—")}${multipla(t) ? (fattiDi(t).length ? ` · fatto da ${fattiDi(t).length} su ${assegnati(t).length}` : ` · con altri ${assegnati(t).length - 1}`) : ""}</span><span class="tt">${esc(t.titolo)}</span></span>
      </div>`;
  }).join("");

  const daVotare = mia ? proposte().filter(c => !(c.reazioni || {})[nome]) : [];
  const votiHtml = daVotare.map(c => `
    <div class="vrow">
      <span class="t"><b>${esc(c.titolo)}</b><span>${esc(c.artista || "")}</span></span>
      <button class="vote" data-action="react-up" data-id="${c.id}" aria-label="Mi piace">${IC("su")}</button>
      <button class="vote" data-action="react-down" data-id="${c.id}" aria-label="Non mi piace">${IC("giu")}</button>
    </div>${commentoForm(c)}`).join("");

  const stats = [`${aperti.length} ${aperti.length === 1 ? "task aperto" : "task aperti"}`]
    .concat(mia && daVotare.length ? [`${daVotare.length} da votare`] : []).join(" · ");
  state.ctxPersonale = stats;   // riga di contesto nella testata

  const orfani = mia ? nomiOrfani() : [];
  const opzioniPersone = state.membri.map(m => `<option value="${esc(m.nome)}">${esc(m.nome)}</option>`).join("");
  const orfaniHtml = !orfani.length ? "" : `
    <article class="card orfani">
      <h3 class="sec-title">Nomi da sistemare <small>${orfani.length}</small></h3>
      <p class="orfani-txt">Questi nomi compaiono nei dati ma non corrispondono più a nessuna persona: di solito è qualcuno che è stato rinominato. Scegli a chi appartengono.</p>
      ${orfani.map(([n, o]) => `
        <form class="orfano" data-form="unisci" data-vecchio="${esc(n)}">
          <div class="orfano-nome"><b>${esc(n)}</b><span>${descriviUso(o)}</span></div>
          <select class="field" name="nuovo" required aria-label="Persona a cui appartiene ${esc(n)}"><option value="">È…</option>${opzioniPersone}</select>
          <button class="btn fill" type="submit">Unisci</button>
          <button type="button" class="btn quiet" data-action="ignora-nome" data-nome="${esc(n)}">Lascia</button>
        </form>`).join("")}
    </article>`;

  const add = state.addOpen.personale
    ? `<form class="inline-form add-person" data-form="add-member" style="padding:6px 0"><input class="field" name="nome" data-keep="add-membro" placeholder="Nome" maxlength="30" autocomplete="off" required><button class="btn fill" type="submit">Aggiungi</button></form>`
    : `<button class="addline add-person" data-action="add-open" data-where="personale"><span class="plus">${IC("piu")}</span>Aggiungi una persona</button>`;

  // l'accesso dei fan si legge dalla funzione solo quando si apre Personale
  if (mia && state.tab === "personale" && !state.accesso && !state.accessoStato) setTimeout(caricaAccesso, 0);
  view.innerHTML = `
    ${whoBar}
    ${mia ? "" : `<p class="viewing">Stai guardando la pagina di ${esc(nome)}: spuntando qui segni la sua parte dei task.</p>`}
    ${orfaniHtml}
    ${state.renaming === persona.id ? `
    <form class="rename-form" data-form="rename" data-id="${persona.id}">
      <input class="field" name="nome" data-keep="rename-${persona.id}" value="${esc(nome)}" maxlength="30" autocomplete="off" required aria-label="Nuovo nome">
      <button type="button" class="btn quiet" data-action="rename-cancel">Annulla</button><button class="btn fill" type="submit">Salva</button>
    </form>
    <p class="rename-hint">Il nome cambia anche in voti, task, spese e registrazioni. La sigla si aggiorna da sola.</p>` : `
    <div class="me-head"><h2>${esc(nome)}</h2>
      <button class="btn quiet rename-btn" data-action="rename" data-id="${persona.id}">${IC("matita")}Rinomina</button></div>`}
    <article class="card">
      <h3 class="sec-title">Da fare <small>${aperti.length}</small></h3>
      ${aperti.length ? daFare : `<p class="empty">${mine.length ? "Tutto fatto ★" : "Nessun task assegnato."}</p>`}
    </article>
    ${mia && daVotare.length ? `<article class="card"><h3 class="sec-title">Da votare <small>${daVotare.length}</small></h3>${votiHtml}</article>` : ""}
    ${mia ? notificheCard() : ""}
    ${mia ? accessoCard() : ""}
    ${mia ? spotifyCard() : ""}
    ${add}
    <h3 class="fascia">Aspetto</h3>${temaHtml()}
    <p class="app-ver">Versione ${APP_VERSION} · ${IS_IOS ? "iPhone/iPad" : IS_ANDROID ? "Android" : "computer"} · <button class="app-ver-btn" data-action="copia-diag">Copia diagnostica</button></p>`;
}

// ---------- azioni ----------
// aggiunge una parte alla canzone (senza appunti) e apre subito il campo per scriverli
async function aggiungiParte(songId, key) {
  const c = state.canzoni.find(x => x.id === songId);
  if (!c || !key) return;
  state.partePicker = null; state.parteAltro = false;
  state.editSetup = { song: songId, key };
  if (typeof (c.setup || {})[key] !== "string") {
    await scrivi(updateDoc(doc(db, "canzoni", songId), new FieldPath("setup", key), ""));
  }
  render();
  document.querySelector(`[data-keep="${CSS.escape(`setup-${songId}-${key}`)}"]`)?.focus();
}
// azioni che scrivono nel database: ai fan non arrivano (e il database le rifiuterebbe comunque)
const SCRITTURE = new Set([
  "addtask-open", "parte-picker", "parte-altro", "parte-add", "parte-del", "pick", "check", "parte",
  "del-task", "del-song", "up", "down", "react-up", "react-down", "promote", "del-rec", "pref", "add-open",
  "tipo", "setup-edit", "link-edit", "rename", "sp-collega", "sp-aggiorna", "del-mov", "dir-avvia", "dir-ferma",
  "accesso-apri", "accesso-disattiva", "accesso-invita", "accesso-vedi", "del-msg"
]);
async function act(btn) {
  const { action, id } = btn.dataset;
  if (state.fan && SCRITTURE.has(action)) return;
  switch (action) {
    case "open-song":
      apriCanzone(id); break;
    case "close-song":
      if (history.state && history.state.canzone) history.back(); else chiudiCanzone();
      break;
    case "addtask-open":
      state.addTaskOpen = id;
      render();
      document.querySelector(`[data-keep="task-${id}"]`)?.focus();
      break;
    case "parte-picker":
      state.partePicker = id; state.parteAltro = false; state.editSetup = null;
      render(); break;
    case "parte-picker-chiudi":
      state.partePicker = null; state.parteAltro = false;
      render(); break;
    case "parte-altro":
      state.parteAltro = true;
      render();
      document.querySelector(`[data-keep="parte-nuova-${id}"]`)?.focus();
      break;
    case "parte-add":
      await aggiungiParte(id, btn.dataset.key);
      break;
    case "parte-del": {
      const c = state.canzoni.find(x => x.id === id), k = btn.dataset.key;
      if (!c || !k) return;
      const testo = ((c.setup || {})[k] || "").trim();
      if (testo && !confirm(`Togliere ${nomeParte(k)} e i suoi appunti?`)) return;
      if (state.editSetup?.song === id && state.editSetup.key === k) state.editSetup = null;
      await scrivi(updateDoc(doc(db, "canzoni", id), new FieldPath("setup", k), deleteField()));
      render();
      break;
    }
    case "voters":
      state.votersOpen.has(id) ? state.votersOpen.delete(id) : state.votersOpen.add(id);
      render(); break;
    case "rec-info":
      state.recInfo = state.recInfo === `${id}:${btn.dataset.modo}` ? null : `${id}:${btn.dataset.modo}`;
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
      if (multipla(t)) {
        // dalla pagina personale: la parte di quella persona
        const chi = btn.dataset.nome || (assegnati(t).includes(state.user) ? state.user : null);
        if (chi) await segnaParte(t, chi);
        break;
      }
      const fatto = !t.fatto;
      await updateDoc(doc(db, "tasks", id), {
        fatto, fattoDa: fatto ? (state.user || "") : "", fattoIl: fatto ? serverTimestamp() : null
      }).catch(erroreScrittura);
      if (fatto) maybeCelebrate(t.canzoneId, t.id);
      break;
    }
    case "parte": {
      const t = state.tasks.find(x => x.id === id);
      if (t && btn.dataset.nome) await segnaParte(t, btn.dataset.nome);
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
      const eraAperta = state.songPage === id;
      await batch.commit().catch(erroreScrittura);
      if (eraAperta) { if (history.state && history.state.canzone) history.back(); else chiudiCanzone(); }
      playlistDaAggiornare();
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
      playlistDaAggiornare();
      break;
    }
    case "react-up": case "react-down": {
      if (!state.user) { toast("Scegli prima il tuo nome."); return; }
      const c = state.canzoni.find(x => x.id === id);
      if (!c) return;
      const voto = action === "react-up" ? "up" : "down";
      const gia = (c.reazioni || {})[state.user] === voto;
      if (gia) {
        // stesso voto di nuovo: si toglie, insieme al commento
        state.commentoVoto = null;
        await salvaVoto(c, null, null);
      } else if (voto === "down") {
        // 👎: prima il perché, poi il voto
        state.commentoVoto = { id, voto: "down" };
        render();
        document.querySelector(`[data-keep="vc-${id}"]`)?.focus();
      } else {
        // 👍: il voto vale subito, il commento è facoltativo (dalla pagina personale niente commento).
        // Se non l'aveva ancora votata, resta in alto finché il campo del commento è aperto.
        const nuova = !(c.reazioni || {})[state.user];
        state.commentoVoto = btn.closest("#view-personale") ? null : { id, voto: "up", tieni: nuova };
        await salvaVoto(c, "up", null);
        document.querySelector(`[data-keep="vc-${id}"]`)?.focus();
      }
      break;
    }
    case "commento-chiudi": {
      const cv = state.commentoVoto;
      state.commentoVoto = null;
      render();
      if (cv && cv.tieni) toast("Voto 👍 salvato." + msgPosizione(cv.id, "up"));
      break;
    }
    case "promote": {
      const c = state.canzoni.find(x => x.id === id);
      const maxOrd = scaletta().reduce((m, x) => Math.max(m, x.ordine || 0), 0);
      const fatto = await updateDoc(doc(db, "canzoni", id), { stato: "scaletta", ordine: maxOrd + 1 }).then(() => true, erroreScrittura);
      toast(`"${c?.titolo || "Pezzo"}" è in scaletta.`);
      playlistDaAggiornare();
      if (fatto) notifica("scaletta", { canzoneId: id });
      break;
    }
    case "demote": {
      // il contrario di "In scaletta": per i pezzi finiti in scaletta per sbaglio. Voti e commenti restano;
      // task e setup restano nel database e ricompaiono se il pezzo torna in scaletta. Nessuna notifica.
      const c = state.canzoni.find(x => x.id === id);
      if (!c || c.stato === "proposta") return;
      const nt = tasksOf(id).length;
      if (!confirm(`Rimettere "${c.titolo}" fra le proposte?${nt ? (nt === 1 ? " Il suo task resta da parte." : ` I suoi ${nt} task restano da parte.`) : ""}`)) return;
      const maxOrd = state.canzoni.reduce((m, x) => Math.max(m, x.ordine || 0), 0);
      const eraAperta = state.songPage === id;
      const fatto = await updateDoc(doc(db, "canzoni", id), { stato: "proposta", ordine: maxOrd + 1 }).then(() => true, erroreScrittura);
      if (!fatto) return;
      if (eraAperta) { if (history.state && history.state.canzone) history.back(); else chiudiCanzone(); }
      toast(`"${c.titolo}" è tornata fra le proposte.`);
      playlistDaAggiornare();
      break;
    }
    case "play": {
      if (state.playId === id || btn.closest("#mini")) { playToggle(id); break; }
      playToggle(id, codaDi(btn, id));
      break;
    }
    case "play-giorno": {
      const coda = codaGiorno(btn.dataset.data);
      if (coda.length) { if (state.playId) fermaRiproduzione(); playToggle(coda[0], coda); }
      break;
    }
    case "copia-diag": {
      // il registro della riproduzione, da incollare nel messaggio a chi segue l'app
      const testo = testoDiagnostica();
      try { await navigator.clipboard.writeText(testo); toast("Diagnostica copiata: incollala nel messaggio."); }
      catch (e) { prompt("Copia questo testo:", testo); }
      break;
    }
    case "play-preferite": {
      const coda = codaPreferite();
      if (coda.length) { if (state.playId) fermaRiproduzione(); playToggle(coda[0], coda); }
      break;
    }
    case "pref": {
      // una sola preferita per pezzo: accendendone una, quella di prima dello stesso pezzo si spegne
      const r = state.registrazioni.find(x => x.id === id);
      if (!r) return;
      const on = !r.preferita;
      const spenta = { preferita: false, preferitaDa: deleteField(), preferitaIl: deleteField() };
      const batch = writeBatch(db);
      batch.update(doc(db, "registrazioni", id), on ? { preferita: true, preferitaDa: state.user || "", preferitaIl: serverTimestamp() } : spenta);
      const prima = on && r.canzoneId ? state.registrazioni.filter(x => x.id !== id && x.preferita && x.canzoneId === r.canzoneId) : [];
      prima.forEach(x => batch.update(doc(db, "registrazioni", x.id), spenta));
      const ok = await batch.commit().then(() => true, erroreScrittura);
      if (ok && prima.length) {
        const song = state.canzoni.find(c => c.id === r.canzoneId);
        toast(`Ora è la preferita di «${song ? song.titolo : "questo pezzo"}», al posto di quella del ${fmtGiorno(prima[0].data)}.`);
      }
      break;
    }
    case "mini-stop": fermaRiproduzione(); break;
    case "push-attiva": attivaNotifiche(); break;
    case "push-disattiva": disattivaNotifiche(); break;
    case "push-evento": {
      const p = state.push;
      if (!p) return;
      const k = btn.dataset.key;
      const eventi = p.eventi.includes(k) ? p.eventi.filter(x => x !== k) : [...p.eventi, k];
      salvaPush({ ...p, eventi });
      render();
      chiamaNotifiche("preferenze", { endpoint: p.endpoint, eventi })
        .catch(e => { if (/non trovata/.test(e.message)) riallineaNotifiche(); else toast("Scelta non salvata: controlla la connessione."); });
      break;
    }
    case "mini-salta": salta(Number(btn.dataset.sec) || 0); break;
    case "esci":
      // si esce e si ricarica: chi entra dopo (band o fan) riparte pulito
      if (state.playId) fermaRiproduzione();
      if (state.push) await disattivaNotifiche();
      store.del("prove_fan_nome");
      await signOut(auth).catch(() => {});
      location.reload();
      break;
    case "del-msg": {
      const m = state.bacheca.find(x => x.id === id);
      if (!m) return;
      const cs = m.postId ? [] : state.bacheca.filter(x => x.postId === id);
      const cosa = m.postId ? `il commento di ${m.nome || "un fan"}` : `il post di ${m.nome || "un fan"}${cs.length ? ` e ${cs.length === 1 ? "il suo commento" : `i suoi ${cs.length} commenti`}` : ""}`;
      if (!confirm(`Togliere ${cosa}?`)) return;
      const batch = writeBatch(db);
      cs.forEach(c => batch.delete(doc(db, "bacheca", c.id)));
      batch.delete(doc(db, "bacheca", id));
      await batch.commit().catch(erroreScrittura);
      break;
    }
    case "piace": {
      const m = state.bacheca.find(x => x.id === id);
      if (!m) return;
      const k = chiavePiace();
      const gia = !!(m.piace || {})[k];
      await updateDoc(doc(db, "bacheca", id), new FieldPath("piace", k), gia ? deleteField() : true).catch(erroreScrittura);
      break;
    }
    case "commenta":
      state.commentaPost = state.commentaPost === id ? null : id;
      render();
      if (state.commentaPost) document.querySelector(`[data-keep="cmt-${CSS.escape(id)}"]`)?.focus();
      break;
    case "fan-chiudi":
      state.fanMenu = false; state.fanCambia = false; renderFan(); break;
    case "fan-cambia":
      state.fanCambia = true; renderFan();
      $("#fan-box [data-keep='fan-nome']")?.select();
      break;
    case "fan-annulla":
      state.fanCambia = false; renderFan(); break;
    case "accesso-riprova":
      state.accessoStato = ""; caricaAccesso(); break;
    case "accesso-apri":
      state.accessoForm = true; render();
      document.querySelector('[data-keep="accesso-pw"]')?.focus();
      break;
    case "accesso-annulla":
      state.accessoForm = false; render(); break;
    case "accesso-vedi":
      state.accessoVedi = !state.accessoVedi; render(); break;
    case "accesso-invita": {
      const testo = invitoFan();
      try {
        if (navigator.share) { await navigator.share({ text: testo }); break; }
      } catch (e) { if (e && e.name === "AbortError") break; }
      try { await navigator.clipboard.writeText(testo); toast("Invito copiato: incollalo nel messaggio."); }
      catch (e) { state.accessoVedi = true; render(); toast("Non riesco a copiare: la password ora è visibile."); }
      break;
    }
    case "accesso-disattiva": {
      if (!confirm("Disattivare l'accesso dei fan? Chi è dentro esce entro un'ora e smette di ricevere notifiche.")) return;
      btn.disabled = true;
      try { state.accesso = await chiamaAccesso("disattiva"); state.accessoVedi = false; toast("Accesso dei fan disattivato."); }
      catch (e) { toast("Non disattivato: " + e.message); }
      render();
      break;
    }
    case "mini-vai": {
      // si va alla registrazione nella sezione Audio
      showTab("audio");
      const riga = document.querySelector(`#view-audio [data-rec="${CSS.escape(id)}"]`);
      if (riga) {
        riga.scrollIntoView({ block: "center" });
        riga.classList.add("evidenzia");
        setTimeout(() => riga.classList.remove("evidenzia"), 1600);
      }
      break;
    }
    case "seek": {
      if (state.playId !== id) { playToggle(id, codaDi(btn, id)); break; }
      if (isFinite(player.duration)) {
        const r = btn.getBoundingClientRect();
        player.currentTime = Math.max(0, Math.min(1, (window.__lastX - r.left) / r.width)) * player.duration;
        diag("spostato con la linea (tocco)", `a ${Math.round(player.currentTime)} s su ${Math.round(player.duration)}`);
      }
      break;
    }
    case "up-annulla": state.pendingFiles = []; state.righeUpload = []; render(); break;
    case "del-rec": {
      const r = state.registrazioni.find(x => x.id === id);
      if (!r || !confirm(`Eliminare questa registrazione?${r.nomeFile ? "\n" + r.nomeFile : ""}`)) return;
      if (state.playId === id) fermaRiproduzione();
      try { if (r.path) await deleteObject(storageRef(storage, r.path)); } catch (e) { /* file già assente */ }
      await deleteDoc(doc(db, "registrazioni", id)).catch(erroreScrittura);
      break;
    }
    case "add-open": {
      const w = btn.dataset.where;
      state.addOpen[w] = true;
      render();
      document.querySelector(w === "personale" ? '[data-keep="add-membro"]' : w === "cassa" ? '[data-keep="mov-imp"]' : `[data-keep="add-${w}-titolo"]`)?.focus();
      break;
    }
    case "tema": {
      const t = btn.dataset.tema;
      if (t === "auto") store.del("prove_tema"); else store.set("prove_tema", t);
      applicaTema(t);
      render(); break;
    }
    case "add-chiudi":
      state.addOpen[btn.dataset.where] = false;
      render(); break;
    case "tipo":
      state.tipoMov = btn.dataset.tipo;
      render(); break;
    case "setup-edit":
      state.editSetup = { song: id, key: btn.dataset.key };
      state.partePicker = null; state.parteAltro = false;
      render();
      document.querySelector(`[data-keep="${CSS.escape(`setup-${id}-${btn.dataset.key}`)}"]`)?.focus();
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
    case "rename":
      state.renaming = id;
      render();
      document.querySelector(`[data-keep="rename-${id}"]`)?.select();
      break;
    case "rename-cancel":
      state.renaming = null;
      render(); break;
    case "sp-collega": {
      btn.disabled = true; btn.textContent = "Apro Spotify…";
      try {
        const { url } = await chiamaPlaylist("collega");
        location.href = url;
      } catch (e) {
        toast(e.message);
        btn.disabled = false; btn.textContent = playlistInfo()?.scaletta ? "Ricollega" : "Collega Spotify";
      }
      break;
    }
    case "sp-aggiorna": {
      btn.disabled = true; btn.textContent = "Aggiorno…";
      try {
        const r = await chiamaPlaylist("aggiorna", { forza: true });
        toast(r.collegato === false ? "Spotify non è collegato." : "Playlist aggiornate.");
      } catch (e) { toast("Playlist non aggiornate: " + e.message); }
      render();
      break;
    }
    case "ignora-nome": {
      const ign = ignorati(); ign.add(btn.dataset.nome);
      store.set("prove_nomi_ignorati", JSON.stringify([...ign]));
      render(); break;
    }
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
    default:
      if (action && action.startsWith("dir-")) diretta.azione(action);
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
// pannello del fan: nome, messaggio alla band, notifiche, esci
$("#fan-box")?.addEventListener("click", e => {
  if (e.target.id === "fan-box" && state.fanNome) { state.fanMenu = false; state.fanCambia = false; renderFan(); return; }
  const btn = e.target.closest("[data-action]");
  if (btn && !btn.disabled) act(btn);
});
$("#fan-box")?.addEventListener("submit", async e => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === "fan-nome") {
    const nome = form.nome.value.trim().replace(/\s+/g, " ").slice(0, 30);
    if (!nome) return;
    form.nome.value = "";
    salvaNomeFan(nome);
    return;
  }
});
$("#mini")?.addEventListener("click", e => {
  window.__lastX = e.clientX;
  const btn = e.target.closest("[data-action]");
  if (btn && !btn.disabled) act(btn);
});
mainEl.addEventListener("keydown", e => {
  // Esc chiude il foglio aperto
  if (e.key === "Escape") { const x = e.target.closest?.(".foglio")?.querySelector("[data-action$='-chiudi']"); if (x) act(x); return; }
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = e.target;
  if (el.matches?.('[role="button"][data-action]')) { e.preventDefault(); act(el); }
});
mainEl.addEventListener("change", e => {
  if (e.target.dataset.change === "dir-ingresso") { diretta.cambiaIngresso(e.target.value); return; }
  if (e.target.dataset.row != null) {
    const r = state.righeUpload[Number(e.target.dataset.row)];
    if (!r) return;
    if (e.target.dataset.campo === "carica") { r.salta = !e.target.checked; render(); }
    else r[e.target.dataset.campo] = e.target.value.trim();
    return;
  }
  if (e.target.type !== "file") return;
  // altri file scelti dopo i primi si aggiungono (lo stesso file una volta sola)
  const nuovi = [...e.target.files].filter(f => !state.pendingFiles.some(p => p.name === f.name && p.size === f.size));
  impostaFile([...state.pendingFiles, ...nuovi]);
});
// trascinare i file di una prova sul modulo
mainEl.addEventListener("dragover", e => {
  const box = e.target.closest?.("form.upload");
  if (!box) return;
  e.preventDefault(); box.classList.add("drag");
});
mainEl.addEventListener("dragleave", e => { e.target.closest?.("form.upload")?.classList.remove("drag"); });
mainEl.addEventListener("drop", e => {
  const box = e.target.closest?.("form.upload");
  if (!box) return;
  e.preventDefault(); box.classList.remove("drag");
  const nuovi = [...(e.dataTransfer?.files || [])].filter(f => !state.pendingFiles.some(p => p.name === f.name && p.size === f.size));
  if (nuovi.length) impostaFile([...state.pendingFiles, ...nuovi]);
});

mainEl.addEventListener("submit", async e => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  // i fan scrivono solo in Bacheca (passando dalla funzione, vedi functions/accesso.js)
  if (state.fan && kind !== "bacheca" && kind !== "bacheca-commento") return;

  if (kind === "bacheca" || kind === "bacheca-commento") {
    const campo = form.testo;
    const postId = kind === "bacheca-commento" ? form.dataset.post : null;
    const testo = campo.value.trim().slice(0, postId ? 300 : 500);
    if (!testo) return;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (state.fan) await chiamaAccesso("messaggio", postId ? { testo, postId } : { testo });
      else {
        if (!state.user) { toast("Scegli prima il tuo nome."); return; }
        await addDoc(collection(db, "bacheca"), { nome: state.user, testo, band: true, creato: serverTimestamp(), ...(postId ? { postId } : {}) });
      }
      campo.value = "";
      document.querySelectorAll(`main [data-keep="${postId ? "cmt-" + postId : "bacheca-testo"}"]`).forEach(el => { el.value = ""; });
      if (postId) { state.commentaPost = null; render(); }
      segnaBachecaVista();
    } catch (ex) {
      toast(state.fan ? "Non pubblicato: " + ex.message : "Non pubblicato. Controlla la connessione e riprova.");
    } finally { btn.disabled = false; }
    return;
  }

  if (kind === "accesso") {
    const pw = form.password.value.trim();
    if (pw.length < 6) { toast("Almeno 6 caratteri."); return; }
    state.accessoOcc = true; render();
    try {
      if (await eLaPasswordDellaBand(pw)) { toast("È la password della band: scegline un'altra per i fan."); return; }
      const prima = state.accesso && state.accesso.attivo;
      state.accesso = await chiamaAccesso("imposta", { password: pw });
      state.accessoForm = false; state.accessoVedi = true;
      document.querySelectorAll('main [data-keep="accesso-pw"]').forEach(el => { el.value = ""; });
      toast(prima ? "Password dei fan cambiata." : "Accesso dei fan attivo.");
    } catch (ex) {
      toast("Non salvata: " + ex.message);
    } finally {
      state.accessoOcc = false; render();
    }
    return;
  }

  if (kind === "add-song") {
    const titolo = form.titolo.value.trim();
    if (!titolo) return;
    const artista = form.artista.value.trim();
    const nostro = !!(form.nostro && form.nostro.checked);
    const stato = form.dataset.stato === "proposta" ? "proposta" : "scaletta";
    const where = stato === "proposta" ? "proposte" : "scaletta";
    form.titolo.value = ""; form.artista.value = ""; if (form.nostro) form.nostro.checked = false;
    // il foglio si chiude subito; se il salvataggio fallisce si riapre con il testo di prima
    state.addOpen[where] = false;
    render();
    const maxOrd = state.canzoni.reduce((m, c) => Math.max(m, c.ordine || 0), 0);
    const ref = await scrivi(addDoc(collection(db, "canzoni"), {
      titolo, artista, stato, ordine: maxOrd + 1, spotifyUrl: "", reazioni: {}, nostro,
      propostaDa: stato === "proposta" ? (state.user || "") : "", creato: serverTimestamp()
    }), () => { state.addOpen[where] = true; render(); rimetti(`add-${where}-titolo`, titolo); rimetti(`add-${where}-artista`, artista); });
    if (ref) {
      toast(stato === "proposta" ? "Proposta aggiunta." : "Canzone aggiunta.");
      enrichSong({ id: ref.id, titolo, artista, nostro });
      playlistDaAggiornare();
      if (stato === "proposta") notifica("proposta", { canzoneId: ref.id });
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
    const ref = await scrivi(addDoc(collection(db, "tasks"), {
      canzoneId: song, titolo, assegnatari, fatto: false, fattoDa: "", creato: serverTimestamp()
    }), () => rimetti(`task-${song}`, titolo));
    if (ref && assegnatari.some(n => n !== state.user)) notifica("task", { taskId: ref.id });
  }

  if (kind === "add-member") {
    const nome = form.nome.value.trim().replace(/\s+/g, " ");
    if (!nome) return;
    form.nome.value = "";
    state.addOpen.personale = false;
    if (state.membri.some(m => m.nome.toLowerCase() === nome.toLowerCase())) { toast(`${nome} c'è già.`); render(); return; }
    await addDoc(collection(db, "membri"), { nome, creato: serverTimestamp() }).catch(erroreScrittura);
  }

  if (kind === "rename") {
    const persona = state.membri.find(m => m.id === form.dataset.id);
    const nuovo = form.nome.value.trim().replace(/\s+/g, " ");
    if (!persona || !nuovo) return;
    if (nuovo === persona.nome) { state.renaming = null; render(); return; }
    if (state.membri.some(m => m.id !== persona.id && m.nome.toLowerCase() === nuovo.toLowerCase())) {
      toast(`C'è già una persona che si chiama ${nuovo}.`); return;
    }
    const vecchio = persona.nome;
    const { batch, n } = sostituisciNome(vecchio, nuovo);
    batch.update(doc(db, "membri", persona.id), { nome: nuovo });
    state.renaming = null;
    if (state.viewPerson === vecchio) state.viewPerson = nuovo;
    const ok = await scrivi(batch.commit().then(() => true));
    if (ok) toast(`${vecchio} ora si chiama ${nuovo}${n ? ` (${n} ${n === 1 ? "elemento aggiornato" : "elementi aggiornati"})` : ""}.`);
    render();
  }

  if (kind === "unisci") {
    const vecchio = form.dataset.vecchio, nuovo = form.nuovo.value;
    if (!nuovo) { toast("Scegli a chi appartiene questo nome."); return; }
    if (!confirm(`Tutto ciò che è di ${vecchio} passa a ${nuovo}. Se hanno votato la stessa proposta con entrambi i nomi, resta il voto di ${nuovo}. Procedo?`)) return;
    const { batch, n } = sostituisciNome(vecchio, nuovo);
    const ok = await scrivi(batch.commit().then(() => true));
    if (ok) toast(`Uniti: ${n} ${n === 1 ? "elemento" : "elementi"} di ${vecchio} ora sono di ${nuovo}.`);
    render();
  }

  if (kind === "setup") {
    const song = form.dataset.song, key = form.dataset.key;
    const testo = form.testo.value.trim();
    form.testo.value = "";
    state.editSetup = null;
    // anche vuoto: la parte resta nella canzone (si toglie con la ✕)
    await scrivi(updateDoc(doc(db, "canzoni", song), new FieldPath("setup", key), testo));
    render();
  }

  if (kind === "parte-nuova") {
    const song = form.dataset.song;
    const key = chiaveParte(form.nome.value);
    form.nome.value = "";
    if (key) await aggiungiParte(song, key);
  }

  if (kind === "commento") {
    const c = state.canzoni.find(x => x.id === form.dataset.id);
    if (!c || !state.user) return;
    const voto = form.dataset.voto === "down" ? "down" : "up";
    const testo = form.testo.value.trim().replace(/\s+/g, " ");
    if (voto === "down" && !testo) { toast("Per il 👎 serve una riga sul perché."); form.testo.focus(); return; }
    form.testo.value = "";
    // se arrivava da "Da votare", si dice dove è finita nella classifica
    const eraNuova = !(c.reazioni || {})[state.user] || (state.commentoVoto && state.commentoVoto.tieni);
    const dove = eraNuova ? msgPosizione(c.id, voto) : "";
    state.commentoVoto = null;
    await salvaVoto(c, voto, testo);
    toast((voto === "down" ? "Voto 👎 salvato." : (testo ? "Commento salvato." : "Salvato.")) + dove);
    render();
  }

  if (kind === "links") {
    const song = form.dataset.song;
    const c = state.canzoni.find(x => x.id === song);
    if (!c) return;
    const titolo = form.titolo.value.trim().replace(/\s+/g, " "), artista = form.artista.value.trim().replace(/\s+/g, " ");
    if (!titolo) { toast("Il titolo non può essere vuoto."); return; }
    const ssIn = form.songsterr.value.trim();
    const ss = ssIn ? (ssIn.match(SONGSTERR_RE) || [null])[0] : "";
    if (ss === null) { toast("Il link Songsterr deve essere quello della canzone (songsterr.com/a/…)."); return; }
    const nostro = !!(form.nostro && form.nostro.checked);
    const cerca = !nostro && e.submitter && e.submitter.name === "cerca";
    const testoCambiato = titolo !== (c.titolo || "") || artista !== (c.artista || "");
    // si cerca di nuovo se lo si chiede, o se il testo è cambiato e il link era stato trovato in automatico;
    // un pezzo nostro non si cerca mai (e un link trovato per sbaglio si toglie)
    const ricerca = !nostro && (cerca || (testoCambiato && c.spotifyAuto !== false) || !c.spotifyUrl || isNostro(c));
    const upd = { titolo, artista, nostro, songsterrUrl: nostro ? "" : ss ? normalizzaSongsterr(ss) : "" };
    if (ricerca) { upd.spotifyUrl = ""; upd.spotifyAuto = null; }
    if (nostro) { upd.spotifyUrl = ""; upd.spotifyAuto = false; }
    form.songsterr.value = "";
    state.linkEdit = null;
    const ok = await scrivi(updateDoc(doc(db, "canzoni", song), upd).then(() => true));
    render();
    if (!ok) return;
    if (!ricerca) { toast("Salvato."); playlistDaAggiornare(); return; }
    if (playlistInfo()?.scaletta) {
      // con Spotify collegato la ricerca la fa la funzione delle playlist: subito, per dire com'è andata
      toast(`Salvato. Cerco "${titolo}" su Spotify…`);
      try {
        const r = await chiamaPlaylist("aggiorna");
        if ((r.trovate || []).includes(titolo)) toast(`Trovato su Spotify: "${titolo}".`);
        else if ((r.senza || []).includes(titolo)) toast("Non trovato su Spotify: controlla titolo e artista.");
        else toast("Salvato.");
      } catch (err) { toast("Salvato. La ricerca su Spotify non è riuscita: " + err.message); }
    } else {
      // senza Spotify collegato il link lo cerca Gemini, come quando si aggiunge una canzone
      toast("Salvato.");
      enrichLink(song, titolo, artista, "spotify");
    }
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
    // il foglio si chiude subito; se il salvataggio fallisce si riapre con il testo di prima
    state.addOpen.cassa = false;
    render();
    const ok = await scrivi(addDoc(collection(db, "movimenti"), {
      tipo, importoCent, data, descrizione, chi, registratoDa: state.user || "", creato: serverTimestamp()
    }), () => { state.addOpen.cassa = true; render(); rimetti("mov-imp", importoTesto); rimetti("mov-desc", descrizione); });
    if (ok) toast(tipo === "spesa" ? `Spesa registrata: ${euro(importoCent)}.` : `Versamento registrato: ${euro(importoCent)}.`);
  }

  if (kind === "upload") {
    const righe = state.righeUpload.filter(r => !r.salta);
    if (!righe.length) { toast("Scegli almeno un file audio."); return; }
    const data = form.data?.value || oggi();
    state.pendingFiles = [];
    state.righeUpload = [];
    setUpload({ active: true, pct: 0, txt: "" });
    const submit = form.querySelector("button[type=submit]");
    if (submit) { submit.disabled = true; submit.textContent = "Caricamento…"; }
    const caricate = [];
    try {
      for (let i = 0; i < righe.length; i++) {
        const { file: f, canzoneId, etichetta } = righe[i];
        setUpload({ pct: 0, txt: righe.length > 1 ? `File ${i + 1} di ${righe.length}: ${f.name}` : f.name });
        const durata = await durataFile(f);
        const up = await uploadAudio(f, p => setUpload({ pct: p }));
        const ref = await addDoc(collection(db, "registrazioni"), {
          canzoneId, etichetta, nomeFile: f.name, url: up.url, path: up.path,
          size: f.size, durata, data, caricatoDa: state.user || "", creato: serverTimestamp()
        });
        caricate.push(ref.id);
      }
      toast(righe.length > 1 ? `${righe.length} registrazioni caricate.` : "Registrazione caricata.");
    } catch (ex) {
      toast("Caricamento non riuscito: " + (ex.code || ex.message) + (caricate.length ? ` (caricate ${caricate.length} su ${righe.length})` : ""));
    } finally {
      setUpload({ active: false, pct: 0, txt: "" });
      render();
      if (caricate.length) notifica("registrazione", { ids: caricate });
    }
  }
});

// ---------- link trovati in automatico (Cloud Function con Gemini) ----------
// La funzione risponde con un URL; lo teniamo solo se è del servizio giusto.
async function enrichLink(songId, titolo, artista, cosa) {
  try {
    if (!auth.currentUser || state.fan) return;
    const token = await auth.currentUser.getIdToken();
    const r = await fetch("/api/spotify-link", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ titolo, artista, cosa })
    });
    const j = await r.json();
    const re = cosa === "songsterr" ? SONGSTERR_RE : SPOTIFY_RE;
    const url = j && typeof j.url === "string" ? (j.url.match(re) || [null])[0] : null;
    if (!url) return;
    const c = state.canzoni.find(x => x.id === songId);
    const campo = cosa === "songsterr" ? "songsterrUrl" : "spotifyUrl";
    if (c && !c[campo]) await updateDoc(doc(db, "canzoni", songId), { [campo]: cosa === "songsterr" ? normalizzaSongsterr(url) : url });
  } catch (e) { /* resta il link di ricerca */ }
}
function enrichSong(c) {
  if (!c || isGenerale(c) || isNostro(c) || state.enrichTried.has(c.id) || state.fan) return;
  state.enrichTried.add(c.id);
  // con le playlist collegate il link Spotify lo cerca la funzione delle playlist, direttamente su Spotify
  if (!c.spotifyUrl && !playlistInfo()?.scaletta) enrichLink(c.id, c.titolo, c.artista, "spotify");
  // il link Songsterr non si cerca in automatico: senza link l'icona apre la ricerca su Songsterr,
  // e il link alla pagina della canzone si incolla a mano da «Link»
}

// ---------- piccoli premi ----------
function maybeCelebrate(canzoneId, appenaFatta) {
  const song = state.canzoni.find(c => c.id === canzoneId);
  if (!song || isGenerale(song)) return;
  const ts = tasksOf(canzoneId);
  if (ts.length > 0 && ts.every(t => t.id === appenaFatta || taskFatta(t))) {
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
