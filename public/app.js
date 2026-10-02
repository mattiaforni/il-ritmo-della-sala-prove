// ============================================================
// PROVE — micro task manager delle prove della band
// Vanilla JS + Firebase Firestore realtime — accesso libero, senza login
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, writeBatch, getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
const storage = getStorage(app);

// ---------- stato ----------
const PALETTE = ["#b4552d", "#d99a2b", "#5b7553", "#5a6b8c", "#8c5a7a", "#3a6b6b", "#a04a4a"];
const state = {
  membri: [],
  canzoni: [],
  tasks: [],
  registrazioni: [],
  expanded: new Set(),
  tab: "scaletta",
  user: localStorage.getItem("prove_user") || null,   // nome "di band" per firmare i task
  ready: { membri: false, canzoni: false, tasks: false, registrazioni: false },
  subscribed: false
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const colorOf = (nome) => {
  const i = state.membri.findIndex(m => m.nome === nome);
  return PALETTE[(i >= 0 ? i : 0) % PALETTE.length];
};

// ---------- niente login: nascondi gli elementi dell'accesso Google ----------
// (restano nell'HTML ma non servono più; li togliamo qui così basta cambiare questo file)
document.getElementById("login-overlay")?.remove();
document.getElementById("logout-btn")?.remove();

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
  onSnapshot(query(collection(db, "registrazioni"), orderBy("data", "desc")), snap => {
    state.registrazioni = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.ready.registrazioni = true;
    render();
  });
}

subscribe(); // accesso libero: i dati arrivano subito

// ---------- nome di band (per firmare i task) ----------
function ensureUser() {
  if (!state.ready.membri) return;
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

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  state.tab = t.dataset.tab;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + state.tab));
}));

// ---------- helper dati ----------
const tasksOf = (canzoneId) => state.tasks.filter(t => t.canzoneId === canzoneId);
const pct = (done, tot) => tot === 0 ? 0 : Math.round(done / tot * 100);
const titoloCompleto = (c) => c.titolo + (c.artista ? " " + c.artista : "");
const spotifyHref = (c) => c.spotifyUrl ||
  ("https://open.spotify.com/search/" + encodeURIComponent(titoloCompleto(c)));
const songsterrHref = (c) => "https://www.songsterr.com/?pattern=" + encodeURIComponent(titoloCompleto(c));
// le canzoni senza campo "stato" (inserite prima di questa versione) sono in scaletta
const inScaletta = (c) => c.stato !== "proposta";
const recsOf = (canzoneId) => state.registrazioni.filter(r => r.canzoneId === canzoneId);
const oggi = () => new Date().toISOString().slice(0, 10);
const fmtData = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const recRow = (r, conCanzone) => {
  const song = conCanzone ? state.canzoni.find(c => c.id === r.canzoneId) : null;
  return `
    <div class="rec" data-id="${r.id}">
      <div class="rec-head">
        <div class="rec-main">
          ${song ? `<span class="ptask-song">${esc(song.titolo)}</span>` : ""}
          <div class="rec-title">${esc(r.etichetta || r.nomeFile || "Registrazione")}</div>
          <div class="rec-meta">${fmtData(r.data)}${r.caricatoDa ? " · " + esc(r.caricatoDa) : ""}${r.size ? " · " + (r.size / 1048576).toFixed(1) + " MB" : ""}</div>
        </div>
        <button class="task-del" data-action="del-rec" data-id="${r.id}" aria-label="Elimina registrazione">✕</button>
      </div>
      <audio controls preload="none" src="${esc(r.url)}"></audio>
    </div>`;
};
const scaletta = () => state.canzoni.filter(inScaletta);
const proposte = () => state.canzoni.filter(c => !inScaletta(c));
const linkIcons = (c) => `
          <a class="spotify-link ${c.spotifyUrl ? "" : "approx"}" href="${esc(spotifyHref(c))}"
             target="_blank" rel="noopener" data-stop
             title="${c.spotifyUrl ? "Apri su Spotify" : "Cerca su Spotify"}" aria-label="Spotify">▶</a>
          <a class="tab-link" href="${esc(songsterrHref(c))}" target="_blank" rel="noopener" data-stop
             title="Cerca la tab su Songsterr" aria-label="Songsterr">tab</a>`;

// ---------- render ----------
function render() {
  if (!(state.ready.canzoni && state.ready.tasks && state.ready.registrazioni)) return;
  renderScaletta();
  renderProposte();
  renderAudio();
  renderPersone();
}

function renderScaletta() {
  const view = $("#view-scaletta");
  const lista = scaletta();
  const songsHtml = lista.map((c, idx) => {
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
          ${linkIcons(c)}
          ${pronta ? `<span class="badge-pronta">★ pronta</span>` : `<span class="song-count">${done}/${ts.length} task</span>`}
        </div>
        ${c.artista ? `<div class="song-artist">${esc(c.artista)}</div>` : ""}
        <div class="bar"><div class="fill ${pronta ? "done" : ""}" style="width:${p}%"></div></div>
      </button>
      ${open ? songBody(c, ts, idx, lista.length) : ""}
    </article>`;
  }).join("");

  view.innerHTML = `
    ${lista.length ? songsHtml : `<p class="empty">Nessuna canzone in scaletta.<br>Aggiungi la prima qui sotto 🤘</p>`}
    <div class="add-song">
      <h3>+ Aggiungi canzone</h3>
      <form class="inline-form" data-form="add-song" data-stato="scaletta">
        <input type="text" name="titolo" placeholder="Titolo" maxlength="80" required autocomplete="off">
        <input type="text" name="artista" placeholder="Artista (facoltativo)" maxlength="60" autocomplete="off">
        <button class="btn" type="submit">Aggiungi</button>
      </form>
    </div>`;
}

function songBody(c, ts, idx, totale) {
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
    ${recsOf(c.id).length ? `<div class="rec-section"><div class="label">Registrazioni</div>${recsOf(c.id).map(r => recRow(r, false)).join("")}</div>` : ""}
    <div class="song-actions">
      <button class="mini-btn" data-action="up" data-id="${c.id}" ${idx === 0 ? "disabled" : ""}>↑</button>
      <button class="mini-btn" data-action="down" data-id="${c.id}" ${idx === totale - 1 ? "disabled" : ""}>↓</button>
      <div class="spacer"></div>
      <button class="mini-btn" data-action="del-song" data-id="${c.id}">Elimina canzone</button>
    </div>
  </div>`;
}

function renderProposte() {
  const view = $("#view-proposte");
  const lista = proposte();
  const cards = lista.map(c => {
    const r = c.reazioni || {};
    const su = Object.entries(r).filter(([, v]) => v === "up").map(([n]) => n);
    const giu = Object.entries(r).filter(([, v]) => v === "down").map(([n]) => n);
    const mia = state.user ? r[state.user] : null;
    const chips = (nomi, cls) => nomi.map(n =>
      `<span class="chip ${cls}" style="background:${colorOf(n)}">${esc(n)}</span>`).join("");
    return `
    <article class="song proposta" data-id="${c.id}">
      <div class="song-head static">
        <div class="song-title-row">
          <h2 class="song-title">${esc(c.titolo)}</h2>
          ${linkIcons(c)}
        </div>
        ${c.artista ? `<div class="song-artist">${esc(c.artista)}</div>` : ""}
        <div class="reactions">
          <button class="react ${mia === "up" ? "on up" : ""}" data-action="react-up" data-id="${c.id}" aria-label="Mi piace">👍 <b>${su.length}</b></button>
          <button class="react ${mia === "down" ? "on down" : ""}" data-action="react-down" data-id="${c.id}" aria-label="Non mi convince">👎 <b>${giu.length}</b></button>
        </div>
        ${su.length || giu.length ? `
        <div class="react-who">
          ${su.length ? `<div class="react-row"><span class="react-lbl">👍</span>${chips(su, "")}</div>` : ""}
          ${giu.length ? `<div class="react-row"><span class="react-lbl">👎</span>${chips(giu, "")}</div>` : ""}
        </div>` : `<p class="empty" style="padding:6px 0 0;text-align:left">Nessuna reazione ancora.</p>`}
        <div class="song-actions">
          <button class="mini-btn mini-primary" data-action="promote" data-id="${c.id}">↑ Porta in scaletta</button>
          <div class="spacer"></div>
          <button class="mini-btn" data-action="del-song" data-id="${c.id}">Elimina</button>
        </div>
      </div>
    </article>`;
  }).join("");

  view.innerHTML = `
    ${lista.length ? cards : `<p class="empty">Nessuna proposta.<br>Butta lì un pezzo da provare 🎸</p>`}
    <div class="add-song">
      <h3>+ Proponi un pezzo</h3>
      <form class="inline-form" data-form="add-song" data-stato="proposta">
        <input type="text" name="titolo" placeholder="Titolo" maxlength="80" required autocomplete="off">
        <input type="text" name="artista" placeholder="Artista (facoltativo)" maxlength="60" autocomplete="off">
        <button class="btn" type="submit">Proponi</button>
      </form>
    </div>`;
}

function renderAudio() {
  const view = $("#view-audio");
  const recs = state.registrazioni;
  // raggruppa per data (decrescente, già ordinata dal DB)
  const gruppi = [];
  recs.forEach(r => {
    const g = gruppi.find(x => x.data === r.data);
    g ? g.items.push(r) : gruppi.push({ data: r.data, items: [r] });
  });
  const lista = gruppi.map(g => `
    <section class="rec-group">
      <h2 class="rec-date">${fmtData(g.data)}</h2>
      ${g.items.map(r => recRow(r, true)).join("")}
    </section>`).join("");

  const opzioni = [...scaletta(), ...proposte()].map(c =>
    `<option value="${c.id}">${esc(c.titolo)}${c.artista ? " — " + esc(c.artista) : ""}</option>`).join("");

  view.innerHTML = `
    ${recs.length ? lista : `<p class="empty">Nessuna registrazione.<br>Carica l'audio delle prove qui sotto 🎧</p>`}
    <div class="add-song">
      <h3>+ Carica registrazione</h3>
      <form class="upload-form" data-form="upload">
        <select name="canzoneId" class="select">
          <option value="">— Canzone (facoltativo) —</option>
          ${opzioni}
        </select>
        <div class="inline-form">
          <input type="text" name="etichetta" placeholder="Etichetta (es. prova 1 ott, definitiva)" maxlength="60" autocomplete="off">
          <input type="date" name="data" value="${oggi()}" class="date-input">
        </div>
        <div class="inline-form">
          <label class="file-btn">
            <input type="file" name="files" accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac" multiple>
            <span class="file-btn-txt">Scegli file audio…</span>
          </label>
          <button class="btn btn-amber" type="submit">Carica</button>
        </div>
        <div class="upload-progress hidden"><div class="bar"><div class="fill"></div></div><span class="upload-txt"></span></div>
      </form>
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
  if (action === "del-rec") {
    const r = state.registrazioni.find(x => x.id === id);
    if (!r || !confirm("Eliminare questa registrazione?")) return;
    try { await deleteObject(storageRef(storage, r.path)); } catch (e) { /* già sparita: ok */ }
    await deleteDoc(doc(db, "registrazioni", id));
  }
  if (action === "del-task") {
    if (confirm("Eliminare questo task?")) await deleteDoc(doc(db, "tasks", id));
  }
  if (action === "del-song") {
    if (!confirm("Eliminare la canzone e tutti i suoi task?")) return;
    const batch = writeBatch(db);
    tasksOf(id).forEach(t => batch.delete(doc(db, "tasks", t.id)));
    recsOf(id).forEach(r => batch.update(doc(db, "registrazioni", r.id), { canzoneId: "" })); // le registrazioni restano, scollegate
    batch.delete(doc(db, "canzoni", id));
    await batch.commit();
  }
  if (action === "react-up" || action === "react-down") {
    if (!state.user) { toast("Scegli prima il tuo nome"); return; }
    const c = state.canzoni.find(x => x.id === id);
    if (!c) return;
    const voto = action === "react-up" ? "up" : "down";
    const reazioni = { ...(c.reazioni || {}) };
    if (reazioni[state.user] === voto) delete reazioni[state.user]; // secondo tap = ritira
    else reazioni[state.user] = voto;
    await updateDoc(doc(db, "canzoni", id), { reazioni });
  }
  if (action === "promote") {
    const maxOrd = scaletta().reduce((m, c) => Math.max(m, c.ordine || 0), 0);
    await updateDoc(doc(db, "canzoni", id), { stato: "scaletta", ordine: maxOrd + 1 });
    toast("In scaletta! 🤘");
  }
  if (action === "up" || action === "down") {
    const lista = scaletta();
    const idx = lista.findIndex(c => c.id === id);
    const j = action === "up" ? idx - 1 : idx + 1;
    if (j < 0 || j >= lista.length) return;
    const a = lista[idx], b = lista[j];
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
    const stato = form.dataset.stato === "proposta" ? "proposta" : "scaletta";
    const maxOrd = state.canzoni.reduce((m, c) => Math.max(m, c.ordine || 0), 0);
    const ref = await addDoc(collection(db, "canzoni"), {
      titolo, artista, stato,
      ordine: maxOrd + 1,
      spotifyUrl: "",
      reazioni: {},
      propostaDa: stato === "proposta" ? (state.user || "") : "",
      creato: serverTimestamp()
    });
    form.reset();
    toast(stato === "proposta" ? "Proposta aggiunta 💡" : "Canzone aggiunta 🎸");
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

  if (kind === "upload") {
    const files = [...form.files.files];
    if (!files.length) { toast("Scegli almeno un file"); return; }
    const canzoneId = form.canzoneId.value;
    const etichetta = form.etichetta.value.trim();
    const data = form.data.value || oggi();
    const prog = form.querySelector(".upload-progress");
    const fill = prog.querySelector(".fill");
    const txt = prog.querySelector(".upload-txt");
    const submit = form.querySelector("button[type=submit]");
    prog.classList.remove("hidden");
    submit.disabled = true;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        txt.textContent = files.length > 1 ? `File ${i + 1} di ${files.length}: ${f.name}` : f.name;
        const url = await uploadAudio(f, p => { fill.style.width = p + "%"; });
        await addDoc(collection(db, "registrazioni"), {
          canzoneId, etichetta,
          nomeFile: f.name,
          url: url.url, path: url.path,
          size: f.size,
          data,
          caricatoDa: state.user || "",
          creato: serverTimestamp()
        });
      }
      toast(files.length > 1 ? "Registrazioni caricate 🎧" : "Registrazione caricata 🎧");
      form.reset();
      form.data.value = oggi();
      form.querySelector(".file-btn-txt").textContent = "Scegli file audio…";
    } catch (e) {
      toast("Caricamento fallito: " + (e.code || e.message));
    } finally {
      submit.disabled = false;
      prog.classList.add("hidden");
      fill.style.width = "0%";
    }
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

// ---------- upload su Firebase Storage ----------
function uploadAudio(file, onProgress) {
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `registrazioni/${Date.now()}-${safe}`;
  const r = storageRef(storage, path);
  const contentType = file.type || "audio/mpeg";
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(r, file, { contentType });
    task.on("state_changed",
      s => onProgress(Math.round(s.bytesTransferred / s.totalBytes * 100)),
      reject,
      async () => resolve({ url: await getDownloadURL(r), path })
    );
  });
}

// un solo audio in riproduzione alla volta
document.addEventListener("play", e => {
  if (e.target.tagName !== "AUDIO") return;
  document.querySelectorAll("audio").forEach(a => { if (a !== e.target) a.pause(); });
}, true);

// mostra il nome dei file scelti nel bottone
document.querySelector("main").addEventListener("change", e => {
  if (e.target.type !== "file") return;
  const n = e.target.files.length;
  const lbl = e.target.closest(".file-btn")?.querySelector(".file-btn-txt");
  if (lbl) lbl.textContent = n === 0 ? "Scegli file audio…" : n === 1 ? e.target.files[0].name : `${n} file selezionati`;
});

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
