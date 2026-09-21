// ============================================================
// PROVE — micro task manager delle prove della band
// Vanilla JS + Firebase (Auth Google + Firestore realtime)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, writeBatch, getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ---------- config check ----------
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
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  db = getFirestore(app); // fallback (es. browser senza IndexedDB)
}
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ---------- stato ----------
const PALETTE = ["#b4552d", "#d99a2b", "#5b7553", "#5a6b8c", "#8c5a7a", "#3a6b6b", "#a04a4a"];
const state = {
  membri: [],
  canzoni: [],
  tasks: [],
  expanded: new Set(),
  tab: "scaletta",
  user: localStorage.getItem("prove_user") || null,   // nome "di band" per firmare i task
  account: null,                                       // utente Google autenticato
  ready: { membri: false, canzoni: false, tasks: false },
  subscribed: false
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const colorOf = (nome) => {
  const i = state.membri.findIndex(m => m.nome === nome);
  return PALETTE[(i >= 0 ? i : 0) % PALETTE.length];
};

// ---------- autenticazione ----------
onAuthStateChanged(auth, (account) => {
  state.account = account;
  const loginOv = $("#login-overlay");
  if (account) {
    loginOv.classList.add("hidden");
    subscribe();          // i listener partono solo da autenticati (le regole lo richiedono)
    ensureUser();
  } else {
    loginOv.classList.remove("hidden");
    $("#overlay").classList.add("hidden");
  }
});
getRedirectResult(auth).catch(() => {});

$("#login-btn").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // le PWA installate su iOS a volte bloccano il popup: ripiego sul redirect
    try { await signInWithRedirect(auth, provider); }
    catch (e2) { toast("Accesso non riuscito: " + (e2.code || e2.message)); }
  }
});

// ---------- listener realtime ----------
function subscribe() {
  if (state.subscribed) return;
  state.subscribed = true;
  onSnapshot(query(collection(db, "membri"), orderBy("creato")), snap => {
    state.membri = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.ready.membri = true;
    ensureUser();
    render();
  });
  onSnapshot(query(collection(db, "canzoni"), orderBy("ordine")), snap => {
    state.canzoni = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.ready.canzoni = true;
    render();
  });
  onSnapshot(query(collection(db, "tasks"), orderBy("creato")), snap => {
    state.tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.ready.tasks = true;
    render();
  });
}

// ---------- nome di band (per firmare i task) ----------
function ensureUser() {
  if (!state.account || !state.ready.membri) return;
  const overlay = $("#overlay");
  if (state.user && state.membri.some(m => m.nome === state.user)) {
    overlay.classList.add("hidden");
    $("#user-chip").textContent = "🎧 " + state.user;
    return;
  }
  overlay.classList.remove("hidden");
  $("#member-picker").innerHTML = state.membri.map(m =>
    `<button class="member-pick" data-nome="${esc(m.nome)}" style="background:${colorOf(m.nome)}">${esc(m.nome)}</button>`
  ).join("");
  // suggerisci il nome dell'account Google
  const first = (state.account.displayName || "").split(" ")[0];
  const input = $("#new-member-name");
  if (first && !input.value) input.value = first;
}
function setUser(nome) {
  state.user = nome;
  localStorage.setItem("prove_user", nome);
  ensureUser();
  render();
}
$("#member-picker").addEventListener("click", e => {
  const b = e.target.closest(".member-pick");
  if (b) setUser(b.dataset.nome);
});
$("#new-member-form").addEventListener("submit", async e => {
  e.preventDefault();
  const nome = $("#new-member-name").value.trim();
  if (!nome) return;
  if (!state.membri.some(m => m.nome.toLowerCase() === nome.toLowerCase())) {
    await addDoc(collection(db, "membri"), { nome, creato: serverTimestamp() });
  }
  $("#new-member-name").value = "";
  setUser(nome);
});
$("#user-chip").addEventListener("click", () => {
  localStorage.removeItem("prove_user");
  state.user = null;
  ensureUser();
});
$("#logout-btn").addEventListener("click", () => signOut(auth));

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  state.tab = t.dataset.tab;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + state.tab));
}));

// ---------- helper dati ----------
const tasksOf = (canzoneId) => state.tasks.filter(t => t.canzoneId === canzoneId);
const pct = (done, tot) => tot === 0 ? 0 : Math.round(done / tot * 100);
const spotifyHref = (c) => c.spotifyUrl ||
  ("https://open.spotify.com/search/" + encodeURIComponent(c.titolo + (c.artista ? " " + c.artista : "")));

// ---------- render ----------
function render() {
  if (!(state.ready.canzoni && state.ready.tasks)) return;
  renderScaletta();
  renderPersone();
}

function renderScaletta() {
  const view = $("#view-scaletta");
  const songsHtml = state.canzoni.map((c, idx) => {
    const ts = tasksOf(c.id);
    const done = ts.filter(t => t.fatto).length;
    const p = pct(done, ts.length);
    const pronta = ts.length > 0 && done === ts.length;
    const open = state.expanded.has(c.id);
    return `
    <article class="song ${pronta ? "pronta" : ""}" data-id="${c.id}">
      <button class="song-head" data-action="toggle" data-id="${c.id}">
        <div class="song-title-row">
          <h2 class="song-title">${esc(c.titolo)}</h2>
          <a class="spotify-link ${c.spotifyUrl ? "" : "approx"}" href="${esc(spotifyHref(c))}"
             target="_blank" rel="noopener" data-stop
             title="${c.spotifyUrl ? "Apri su Spotify" : "Cerca su Spotify"}" aria-label="Apri su Spotify">▶</a>
          ${pronta ? `<span class="badge-pronta">★ pronta</span>` : `<span class="song-count">${done}/${ts.length} task</span>`}
        </div>
        ${c.artista ? `<div class="song-artist">${esc(c.artista)}</div>` : ""}
        <div class="bar"><div class="fill ${pronta ? "done" : ""}" style="width:${p}%"></div></div>
      </button>
      ${open ? songBody(c, ts, idx) : ""}
    </article>`;
  }).join("");

  view.innerHTML = `
    ${state.canzoni.length ? songsHtml : `<p class="empty">Nessuna canzone in scaletta.<br>Aggiungi la prima qui sotto 🤘</p>`}
    <div class="add-song">
      <h3>+ Aggiungi canzone</h3>
      <form class="inline-form" data-form="add-song">
        <input type="text" name="titolo" placeholder="Titolo" maxlength="80" required autocomplete="off">
        <input type="text" name="artista" placeholder="Artista (facoltativo)" maxlength="60" autocomplete="off">
        <button class="btn" type="submit">Aggiungi</button>
      </form>
    </div>`;
}

function songBody(c, ts, idx) {
  const taskHtml = ts.map(t => `
    <div class="task ${t.fatto ? "fatto" : ""}">
      <button class="task-check" data-action="check" data-id="${t.id}" aria-label="Segna fatto">${t.fatto ? "✓" : ""}</button>
      <div class="task-main">
        <div class="task-title">${esc(t.titolo)}</div>
        <div class="task-meta">
          ${(t.assegnatari || []).map(n => `<span class="chip" style="background:${colorOf(n)}">${esc(n)}</span>`).join("")}
          ${t.fatto && t.fattoDa ? `<span class="chip small" style="background:var(--verde)">fatto da ${esc(t.fattoDa)}</span>` : ""}
        </div>
      </div>
      <button class="task-del" data-action="del-task" data-id="${t.id}" aria-label="Elimina task">✕</button>
    </div>`).join("");

  const pickers = state.membri.map(m =>
    `<button type="button" class="assignee-toggle" data-nome="${esc(m.nome)}">${esc(m.nome)}</button>`
  ).join("");

  return `
  <div class="song-body">
    ${ts.length ? taskHtml : `<p class="empty" style="padding:10px">Nessun task per questo pezzo.</p>`}
    <form class="task-form" data-form="add-task" data-song="${c.id}">
      <div class="inline-form">
        <input type="text" name="titolo" placeholder="Nuovo task (es. imparare il bridge)" maxlength="120" required autocomplete="off">
      </div>
      <div class="assignee-picker">${pickers}</div>
      <div class="inline-form" style="margin-top:6px">
        <button class="btn btn-amber" type="submit">+ Task</button>
      </div>
    </form>
    <div class="song-actions">
      <button class="mini-btn" data-action="up" data-id="${c.id}" ${idx === 0 ? "disabled" : ""}>↑</button>
      <button class="mini-btn" data-action="down" data-id="${c.id}" ${idx === state.canzoni.length - 1 ? "disabled" : ""}>↓</button>
      <div class="spacer"></div>
      <button class="mini-btn" data-action="del-song" data-id="${c.id}">Elimina canzone</button>
    </div>
  </div>`;
}

function renderPersone() {
  const view = $("#view-persone");
  if (!state.membri.length) {
    view.innerHTML = `<p class="empty">Nessun membro ancora.</p>`;
    return;
  }
  const membri = [...state.membri].sort((a, b) =>
    (b.nome === state.user) - (a.nome === state.user));

  const cards = membri.map(m => {
    const mine = state.tasks.filter(t => (t.assegnatari || []).includes(m.nome));
    const done = mine.filter(t => t.fatto).length;
    const p = pct(done, mine.length);
    const open = mine.filter(t => !t.fatto);
    const rows = open.map(t => {
      const song = state.canzoni.find(c => c.id === t.canzoneId);
      return `
      <div class="ptask">
        <button class="task-check" data-action="check" data-id="${t.id}" aria-label="Segna fatto"></button>
        <div class="task-main">
          <span class="ptask-song">${esc(song ? song.titolo : "—")}</span>
          <div class="task-title">${esc(t.titolo)}</div>
        </div>
      </div>`;
    }).join("");
    return `
    <article class="person">
      <div class="person-head">
        <span class="person-dot" style="background:${colorOf(m.nome)}"></span>
        <h2 class="person-name">${esc(m.nome)}${m.nome === state.user ? " (tu)" : ""}</h2>
        <span class="person-stat">${done}/${mine.length} · ${p}%</span>
      </div>
      <div class="bar"><div class="fill ${p === 100 && mine.length ? "done" : ""}" style="width:${p}%"></div></div>
      <div style="margin-top:8px">
        ${mine.length === 0 ? `<p class="empty" style="padding:8px">Nessun task assegnato.</p>`
          : open.length === 0 ? `<p class="empty" style="padding:8px">Tutto fatto ★</p>` : rows}
      </div>
    </article>`;
  }).join("");

  view.innerHTML = cards + `
    <div class="add-song">
      <h3>+ Aggiungi membro</h3>
      <form class="inline-form" data-form="add-member">
        <input type="text" name="nome" placeholder="Nome" maxlength="30" required autocomplete="off">
        <button class="btn" type="submit">Aggiungi</button>
      </form>
    </div>`;
}

// ---------- azioni (event delegation) ----------
document.querySelector("main").addEventListener("click", async e => {
  const link = e.target.closest("[data-stop]");
  if (link) { e.stopPropagation(); return; } // il link Spotify non apre/chiude la card

  const btn = e.target.closest("[data-action], .assignee-toggle");
  if (!btn) return;

  if (btn.classList.contains("assignee-toggle")) {
    btn.classList.toggle("on");
    btn.style.background = btn.classList.contains("on") ? colorOf(btn.dataset.nome) : "";
    return;
  }

  const { action, id } = btn.dataset;
  if (action === "toggle") {
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    renderScaletta();
  }
  if (action === "check") {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    const fatto = !t.fatto;
    await updateDoc(doc(db, "tasks", id), {
      fatto,
      fattoDa: fatto ? (state.user || "") : "",
      fattoIl: fatto ? serverTimestamp() : null
    });
    if (fatto) maybeCelebrate(t.canzoneId);
  }
  if (action === "del-task") {
    if (confirm("Eliminare questo task?")) await deleteDoc(doc(db, "tasks", id));
  }
  if (action === "del-song") {
    if (!confirm("Eliminare la canzone e tutti i suoi task?")) return;
    const batch = writeBatch(db);
    tasksOf(id).forEach(t => batch.delete(doc(db, "tasks", t.id)));
    batch.delete(doc(db, "canzoni", id));
    await batch.commit();
  }
  if (action === "up" || action === "down") {
    const idx = state.canzoni.findIndex(c => c.id === id);
    const j = action === "up" ? idx - 1 : idx + 1;
    if (j < 0 || j >= state.canzoni.length) return;
    const a = state.canzoni[idx], b = state.canzoni[j];
    const batch = writeBatch(db);
    batch.update(doc(db, "canzoni", a.id), { ordine: b.ordine });
    batch.update(doc(db, "canzoni", b.id), { ordine: a.ordine });
    await batch.commit();
  }
});

document.querySelector("main").addEventListener("submit", async e => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;

  if (kind === "add-song") {
    const titolo = form.titolo.value.trim();
    if (!titolo) return;
    const artista = form.artista.value.trim();
    const maxOrd = state.canzoni.reduce((m, c) => Math.max(m, c.ordine || 0), 0);
    const ref = await addDoc(collection(db, "canzoni"), {
      titolo, artista,
      ordine: maxOrd + 1,
      spotifyUrl: "",
      creato: serverTimestamp()
    });
    form.reset();
    toast("Canzone aggiunta 🎸");
    enrichSpotify(ref.id, titolo, artista); // in background, senza bloccare
  }

  if (kind === "add-task") {
    const titolo = form.titolo.value.trim();
    if (!titolo) return;
    const assegnatari = [...form.querySelectorAll(".assignee-toggle.on")].map(b => b.dataset.nome);
    await addDoc(collection(db, "tasks"), {
      canzoneId: form.dataset.song,
      titolo,
      assegnatari,
      fatto: false,
      fattoDa: "",
      creato: serverTimestamp()
    });
    form.titolo.value = "";
    form.querySelectorAll(".assignee-toggle.on").forEach(b => { b.classList.remove("on"); b.style.background = ""; });
  }

  if (kind === "add-member") {
    const nome = form.nome.value.trim();
    if (!nome || state.membri.some(m => m.nome.toLowerCase() === nome.toLowerCase())) return;
    await addDoc(collection(db, "membri"), { nome, creato: serverTimestamp() });
    form.reset();
  }
});

// ---------- arricchimento Spotify (Cloud Function via rewrite /api/spotify-link) ----------
async function enrichSpotify(songId, titolo, artista) {
  try {
    const r = await fetch("/api/spotify-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titolo, artista })
    });
    const j = await r.json();
    if (j && j.url) {
      await updateDoc(doc(db, "canzoni", songId), { spotifyUrl: j.url });
    }
  } catch (e) {
    // nessun problema: resta il link di ricerca Spotify come ripiego
  }
}

// ---------- gamification leggera ----------
function maybeCelebrate(canzoneId) {
  const ts = tasksOf(canzoneId);
  const remaining = ts.filter(t => !t.fatto).length;
  if (ts.length > 0 && remaining <= 1) {
    const song = state.canzoni.find(c => c.id === canzoneId);
    setTimeout(() => toast(`★ "${song ? song.titolo : "Canzone"}" è pronta! 🤘`), 350);
  }
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}
