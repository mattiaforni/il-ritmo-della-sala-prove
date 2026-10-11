// ============================================================
// Bot Telegram: registro delle modifiche e testi dei riepiloghi.
// Solo funzioni pure: ricevono i dati già letti da Firestore (date in
// millisecondi) e restituiscono oggetti o testi in HTML di Telegram.
// Nessun accesso alla rete né al database: si provano da soli.
// ============================================================
const crypto = require("crypto");

const GENERALE_ID = "generale";
const SOGLIA_SCALETTA = 5; // come nell'app: da 5 👍 una proposta è pronta per la scaletta
const STRUMENTI = { chitarra1: "Chitarra 1", chitarra2: "Chitarra 2", acustica: "Acustica", basso: "Basso", batteria: "Batteria", tastiera: "Tastiera", fisarmonica: "Fisarmonica", voce: "Voce" };
const APP_URL = "https://il-ritmo-della-sala-prove.web.app";
const ORA = 3600 * 1000;
const GIORNO = 24 * ORA;
const MAX_TESTO = 3900;  // Telegram accetta fino a 4096 caratteri per messaggio
const MAX_RIGHE = 12;    // righe per sezione, poi "… e altri N"

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isGenerale = (c) => c.id === GENERALE_ID || c.stato === "generale";
const ordine = (c) => (typeof c.ordine === "number" ? c.ordine : 0);
const nelPeriodo = (t, da, a) => typeof t === "number" && t >= da && t <= a;
const impronta = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 12);
const votanti = (c, v) => Object.keys(c.reazioni || {}).filter(n => c.reazioni[n] === v);
// commenti ai voti (dalla versione 21 dell'app): nome → testo, solo di chi ha votato
const commenti = (c) => Object.entries(c.commenti || {})
  .filter(([n, t]) => (c.reazioni || {})[n] && String(t || "").trim())
  .map(([n, t]) => [n, String(t).trim().slice(0, 100)]);
const VOTO = { up: "👍", down: "👎" };

const FMT_GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "short", day: "numeric", month: "short" });
const FMT_DATA = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short" });
const EURO = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const giorno = (ms) => FMT_GIORNO.format(new Date(ms));
const dataMov = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? FMT_DATA.format(new Date(s + "T12:00:00Z")) : "");
const euro = (cent) => EURO.format((cent || 0) / 100);
const durata = (sec) => (sec > 0 ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : "");

const MENU = {
  inline_keyboard: [
    // pochi pulsanti, scelta di Mattia; scaletta, proposte, task e cassa restano come comandi
    // (e i pulsanti dei messaggi già inviati continuano a funzionare)
    [{ text: "Novità 2 giorni", callback_data: "nov:2" }, { text: "Novità 7 giorni", callback_data: "nov:7" }],
    [{ text: "Apri l'app", url: APP_URL }]
  ]
};

// ---------- registro delle modifiche ----------
// Voti, passaggi in scaletta e modifiche ai setup non hanno una data nel database.
// Ogni ora il bot salva una "fotografia" leggera e la confronta con la precedente:
// le differenze diventano eventi datati. L'app non cambia, e funziona anche con
// i telefoni rimasti a versioni vecchie.
function fotografa({ canzoni = [], membri = [] }) {
  const foto = { canzoni: {}, membri: {} };
  for (const c of canzoni) {
    if (isGenerale(c)) continue;
    const su = {};
    for (const [k, v] of Object.entries(c.setup || {})) {
      const testo = String(v || "").trim();
      if (testo) su[k] = impronta(testo);
    }
    foto.canzoni[c.id] = { t: c.titolo || "", s: c.stato || "", r: { ...(c.reazioni || {}) }, su, cm: Object.fromEntries(commenti(c)) };
  }
  for (const m of membri) foto.membri[m.id] = m.nome || "";
  return foto;
}

function differenze(prima, dopo) {
  const ev = [];
  // una persona rinominata porta con sé i voti: non sono voti nuovi
  const rinomine = {};
  for (const [id, nome] of Object.entries(prima.membri || {})) {
    const nuovo = (dopo.membri || {})[id];
    if (nuovo && nuovo !== nome) rinomine[nome] = nuovo;
  }
  const pc = prima.canzoni || {}, dc = dopo.canzoni || {};
  for (const [id, d] of Object.entries(dc)) {
    const p = pc[id];
    if (!p) continue; // le canzoni nuove le racconta già il campo "creato"
    if (p.s === "proposta" && d.s && d.s !== "proposta") ev.push({ tipo: "in_scaletta", canzoneId: id, titolo: d.t });
    const pr = {};
    for (const [n, v] of Object.entries(p.r || {})) pr[rinomine[n] || n] = v;
    const dr = d.r || {};
    for (const n of new Set([...Object.keys(pr), ...Object.keys(dr)])) {
      if (pr[n] !== dr[n]) ev.push({ tipo: "voto", canzoneId: id, titolo: d.t, chi: n, voto: dr[n] || "tolto" });
    }
    // commenti nuovi o cambiati (un commento tolto insieme al voto è già nel voto "tolto")
    const pcm = {};
    for (const [n, t] of Object.entries(p.cm || {})) pcm[rinomine[n] || n] = t;
    for (const [n, t] of Object.entries(d.cm || {})) {
      if (pcm[n] !== t) ev.push({ tipo: "commento", canzoneId: id, titolo: d.t, chi: n, voto: dr[n] || "", testo: t });
    }
    const ps = p.su || {}, ds = d.su || {};
    for (const k of Object.keys(ds)) {
      if (ps[k] !== ds[k]) ev.push({ tipo: "setup", canzoneId: id, titolo: d.t, strumento: k });
    }
  }
  for (const [id, p] of Object.entries(pc)) {
    if (!dc[id]) ev.push({ tipo: "eliminata", canzoneId: id, titolo: p.t, stato: p.s });
  }
  return ev;
}

// ---------- aiuti per i testi ----------
function elenco(righe, nome = "altri") {
  if (righe.length <= MAX_RIGHE) return righe;
  return [...righe.slice(0, MAX_RIGHE), `<i>… e ${nome} ${righe.length - MAX_RIGHE}</i>`];
}

function sezione(titolo, righe, nome) {
  return righe.length ? `<b>${titolo}</b>\n${elenco(righe, nome).join("\n")}` : "";
}

function taglia(testo) {
  if (testo.length <= MAX_TESTO) return testo;
  const righe = testo.split("\n");
  let out = "";
  for (const r of righe) {
    if (out.length + r.length + 1 > MAX_TESTO - 60) break;
    out += (out ? "\n" : "") + r;
  }
  return out + "\n<i>… il resto è nell'app.</i>";
}

function contesto(dati) {
  const canzoni = dati.canzoni || [];
  const perId = new Map(canzoni.map(c => [c.id, c]));
  const membri = [...(dati.membri || [])].sort((a, b) => (a.creato || 0) - (b.creato || 0));
  const nomi = membri.map(m => m.nome).filter(Boolean);
  const nomeCanzone = (id) => (id === GENERALE_ID ? "Generale" : (perId.get(id) || {}).titolo || "");
  // come nell'app: si contano solo i task di canzoni che esistono ancora
  const tasks = (dati.tasks || []).filter(t => perId.has(t.canzoneId));
  const chiTask = (ass) => {
    const a = (ass || []).filter(Boolean);
    if (nomi.length > 1 && nomi.every(n => a.includes(n))) return "tutti";
    return a.join(", ");
  };
  const proposte = canzoni.filter(c => c.stato === "proposta");
  const daVotare = nomi
    .map(n => ({ n, k: proposte.filter(c => !(c.reazioni || {})[n]).length }))
    .filter(x => x.k > 0);
  return { canzoni, perId, membri, nomi, nomeCanzone, tasks, chiTask, proposte, daVotare };
}

const rigaDaVotare = (ctx) =>
  ctx.daVotare.length ? `<b>Da votare</b>: ${ctx.daVotare.map(x => `${esc(x.n)} ${x.k}`).join(" · ")}` : "";

// ---------- novità di un periodo ----------
// opzioni: da, a (ms), titolo, registroDa (ms dal quale esiste il registro, o null)
function novita(dati, { da, a = Date.now(), titolo, registroDa = null }) {
  const ctx = contesto(dati);
  const { canzoni, nomeCanzone, tasks, chiTask, perId } = ctx;
  const eventi = (dati.eventi || []).filter(e => nelPeriodo(e.quando, da, a)).sort((x, y) => x.quando - y.quando);
  const blocchi = [];

  // canzoni
  const nuove = canzoni.filter(c => !isGenerale(c) && nelPeriodo(c.creato, da, a)).sort((x, y) => x.creato - y.creato);
  const eraProposta = (c) => c.stato === "proposta" || !!c.propostaDa;
  const nomeArt = (c) => `<b>${esc(c.titolo)}</b>${c.artista ? " – " + esc(c.artista) : ""}`;
  blocchi.push(sezione("Proposte nuove",
    nuove.filter(eraProposta).map(c => `• ${nomeArt(c)}${c.propostaDa ? ` (${esc(c.propostaDa)})` : ""}`)));
  blocchi.push(sezione("Aggiunte in scaletta", nuove.filter(c => !eraProposta(c)).map(c => `• ${nomeArt(c)}`)));
  const passate = [...new Map(eventi.filter(e => e.tipo === "in_scaletta").map(e => [e.canzoneId, e])).values()];
  blocchi.push(sezione("Passate in scaletta", passate.map(e => `• <b>${esc((perId.get(e.canzoneId) || {}).titolo || e.titolo)}</b>`)));
  const eliminate = eventi.filter(e => e.tipo === "eliminata");
  blocchi.push(sezione("Eliminate", eliminate.map(e => `• ${esc(e.titolo)}${e.stato === "proposta" ? " <i>(proposta)</i>" : ""}`)));

  // voti: per ogni canzone vale l'ultimo voto di ciascuno nel periodo
  const voti = new Map();
  for (const e of eventi.filter(e => e.tipo === "voto")) {
    if (!voti.has(e.canzoneId)) voti.set(e.canzoneId, { titolo: e.titolo, chi: new Map() });
    voti.get(e.canzoneId).chi.set(e.chi, e.voto);
  }
  // commenti del periodo: per ogni canzone l'ultimo di ciascuno, se c'è ancora
  const comm = new Map();
  for (const e of eventi.filter(e => e.tipo === "commento")) {
    if (!comm.has(e.canzoneId)) comm.set(e.canzoneId, { titolo: e.titolo, chi: new Map() });
    comm.get(e.canzoneId).chi.set(e.chi, e);
  }
  const righeVoti = [];
  for (const id of new Set([...voti.keys(), ...comm.keys()])) {
    const v = voti.get(id) || { titolo: (comm.get(id) || {}).titolo, chi: new Map() };
    const su = [...v.chi].filter(([, x]) => x === "up").map(([n]) => esc(n));
    const giu = [...v.chi].filter(([, x]) => x === "down").map(([n]) => esc(n));
    const c = perId.get(id);
    const attuali = new Map(c ? commenti(c) : []);
    const righeCom = [...((comm.get(id) || {}).chi || new Map()).keys()]
      .filter(n => attuali.has(n))
      .map(n => `   <i>${esc(n)} ${VOTO[(c.reazioni || {})[n]] || ""}: «${esc(attuali.get(n))}»</i>`);
    if (!su.length && !giu.length && !righeCom.length) continue;
    const parti = [su.length ? `👍 ${su.join(", ")}` : "", giu.length ? `👎 ${giu.join(", ")}` : ""].filter(Boolean).join(" · ");
    const totale = c && c.stato === "proposta" ? ` <i>(ora 👍 ${votanti(c, "up").length} 👎 ${votanti(c, "down").length})</i>` : "";
    righeVoti.push([`• <b>${esc(c ? c.titolo : v.titolo)}</b>${parti ? ": " + parti : ""}${totale}`, ...righeCom].join("\n"));
  }
  blocchi.push(sezione("Voti", righeVoti));

  // task
  const fatti = tasks.filter(t => t.fatto && nelPeriodo(t.fattoIl, da, a)).sort((x, y) => x.fattoIl - y.fattoIl);
  const righeFatti = fatti.map(t =>
    `✓ ${esc(t.titolo)} — <i>${esc(nomeCanzone(t.canzoneId))}</i>${t.fattoDa ? ` (${esc(t.fattoDa)})` : ""}`);
  const pronte = [...new Set(fatti.map(t => t.canzoneId))].filter(id => {
    const c = perId.get(id);
    if (!c || isGenerale(c)) return false;
    const ts = tasks.filter(t => t.canzoneId === id);
    return ts.length > 0 && ts.every(t => t.fatto);
  });
  if (pronte.length) righeFatti.push(`★ Ora pronte: ${pronte.map(id => `<b>${esc(nomeCanzone(id))}</b>`).join(", ")}`);
  blocchi.push(sezione("Task completati", righeFatti));
  const nuoviTask = tasks.filter(t => !t.fatto && nelPeriodo(t.creato, da, a)).sort((x, y) => x.creato - y.creato);
  blocchi.push(sezione("Task nuovi", nuoviTask.map(t => {
    const chi = chiTask(t.assegnatari);
    return `• ${esc(t.titolo)} — <i>${esc(nomeCanzone(t.canzoneId))}</i>${chi ? ` (${esc(chi)})` : ""}`;
  })));

  // setup
  const setup = new Map();
  for (const e of eventi.filter(e => e.tipo === "setup")) {
    if (!setup.has(e.canzoneId)) setup.set(e.canzoneId, { titolo: e.titolo, str: new Set() });
    setup.get(e.canzoneId).str.add(STRUMENTI[e.strumento] || e.strumento);
  }
  blocchi.push(sezione("Setup aggiornati", [...setup].map(([id, s]) =>
    `• <b>${esc((perId.get(id) || {}).titolo || s.titolo)}</b>: ${esc([...s.str].join(", "))}`)));

  // registrazioni
  const reg = (dati.registrazioni || []).filter(r => nelPeriodo(r.creato, da, a)).sort((x, y) => x.creato - y.creato);
  blocchi.push(sezione("Registrazioni", reg.map(r => {
    const canzone = nomeCanzone(r.canzoneId);
    const nome = canzone ? `<b>${esc(canzone)}</b>${r.etichetta ? " · " + esc(r.etichetta) : ""}` : `<b>${esc(r.etichetta || "Registrazione")}</b>`;
    const d = durata(r.durata);
    return `• ${nome}${d ? ` — ${d}` : ""}${r.caricatoDa ? ` (${esc(r.caricatoDa)})` : ""}`;
  }), "altre"));

  // cassa
  const tutti = dati.movimenti || [];
  const mov = tutti.filter(m => nelPeriodo(m.creato, da, a)).sort((x, y) => x.creato - y.creato);
  if (mov.length) {
    const righe = mov.map(m => {
      const entrata = m.tipo === "versamento";
      return `• ${entrata ? "+" : "−"} ${euro(m.importoCent)} · ${esc(m.descrizione)}${m.chi ? ` (${esc(m.chi)})` : ""}`;
    });
    blocchi.push(`${sezione("Cassa", righe)}\nSaldo: <b>${euro(saldo(tutti))}</b>`);
  }

  // persone
  const persone = ctx.membri.filter(m => nelPeriodo(m.creato, da, a));
  blocchi.push(sezione("Nuovi nella band", persone.map(m => `• ${esc(m.nome)}`)));

  const pieni = blocchi.filter(Boolean);
  const vuoto = pieni.length === 0;
  const coda = [];
  if (!vuoto) {
    const dv = rigaDaVotare(ctx);
    if (dv) coda.push(dv);
  }
  // novità dell'app uscite nel periodo: solo un rimando, non fa partire da solo il riepilogo
  const app = (dati.app || []).filter(x => x.data && nelPeriodo(Date.parse(x.data + "T12:00:00Z"), da - 12 * ORA, a + 12 * ORA));
  if (app.length) coda.push(`L'app è stata aggiornata${app[0].versione ? ` (versione ${esc(app[0].versione)})` : ""}: /aggiornamenti per sapere cosa c'è di nuovo.`);
  if (!registroDa) coda.push("<i>Voti, passaggi in scaletta e setup si vedranno dalla prossima ora: il registro sta partendo.</i>");
  else if (da < registroDa - ORA) coda.push(`<i>Voti, passaggi in scaletta e setup sono registrati dal ${giorno(registroDa)}.</i>`);

  const intestazione = `<b>${esc(titolo)}</b>`;
  const corpo = vuoto ? "Nessuna novità nell'app in questo periodo." : pieni.join("\n\n");
  const testo = [intestazione, corpo, coda.join("\n")].filter(Boolean).join("\n\n");
  return { testo: taglia(testo), vuoto };
}

function titoloNovita(giorni) {
  return giorni === 1 ? "Novità delle ultime 24 ore" : `Novità degli ultimi ${giorni} giorni`;
}

// ---------- scaletta ----------
function scaletta(dati) {
  const ctx = contesto(dati);
  const lista = ctx.canzoni.filter(c => !isGenerale(c) && c.stato !== "proposta").sort((a, b) => ordine(a) - ordine(b));
  if (!lista.length) return "<b>Scaletta</b>\n\nNessuna canzone in scaletta.";
  let pronte = 0;
  const righe = lista.map((c, i) => {
    const ts = ctx.tasks.filter(t => t.canzoneId === c.id);
    const fatti = ts.filter(t => t.fatto).length;
    let stato;
    if (!ts.length) stato = "nessun task";
    else if (fatti === ts.length) { stato = "pronta ✓"; pronte++; }
    else stato = `${fatti} di ${ts.length} task`;
    return `${i + 1}. <b>${esc(c.titolo)}</b>${c.artista ? " – " + esc(c.artista) : ""} · ${stato}`;
  });
  const gen = ctx.tasks.filter(t => t.canzoneId === GENERALE_ID && !t.fatto).length;
  const testa = `<b>Scaletta</b> · ${lista.length} ${lista.length === 1 ? "canzone" : "canzoni"}, ${pronte} ${pronte === 1 ? "pronta" : "pronte"}`;
  const piede = gen ? `\n\nGenerale: ${gen} ${gen === 1 ? "task aperto" : "task aperti"}` : "";
  return taglia(`${testa}\n\n${righe.join("\n")}${piede}`);
}

// ---------- proposte e voti ----------
function proposte(dati) {
  const ctx = contesto(dati);
  const lista = [...ctx.proposte].sort((a, b) =>
    votanti(b, "up").length - votanti(a, "up").length || ordine(a) - ordine(b));
  if (!lista.length) return "<b>Proposte</b>\n\nNessuna proposta aperta.";
  const righe = lista.map(c => {
    const su = votanti(c, "up").length, giu = votanti(c, "down").length;
    const mancano = ctx.nomi.filter(n => !(c.reazioni || {})[n]);
    let r = `• <b>${esc(c.titolo)}</b>${c.artista ? " – " + esc(c.artista) : ""} · 👍 ${su} 👎 ${giu}`;
    if (c.propostaDa) r += ` · <i>da ${esc(c.propostaDa)}</i>`;
    for (const [n, t] of commenti(c)) r += `\n   <i>${esc(n)} ${VOTO[c.reazioni[n]] || ""}: «${esc(t)}»</i>`;
    if (su >= SOGLIA_SCALETTA) r += "\n   pronta per passare in scaletta";
    if (mancano.length) r += `\n   manca il voto di: ${esc(mancano.join(", "))}`;
    return r;
  });
  const dv = rigaDaVotare(ctx);
  return taglia(`<b>Proposte</b> · ${lista.length}, dalla più votata\n\n${righe.join("\n")}${dv ? "\n\n" + dv : ""}`);
}

// ---------- task aperti, per persona ----------
// task con più persone: ognuno spunta la sua parte (campo fattiDa, come nell'app)
const conParti = (t) => (t.assegnatari || []).length > 1 && Array.isArray(t.fattiDa);
const parteFatta = (t, n) => (conParti(t) ? t.fattiDa.includes(n) : !!t.fatto);
const taskFatta = (t) => (conParti(t) ? t.assegnatari.every(n => t.fattiDa.includes(n)) : !!t.fatto);
function taskAperti(dati) {
  const ctx = contesto(dati);
  const aperti = ctx.tasks.filter(t => !taskFatta(t)).sort((a, b) => (a.creato || 0) - (b.creato || 0));
  if (!aperti.length) return "<b>Task aperti</b>\n\nNessun task aperto.";
  const quanti = (t) => {
    const k = conParti(t) ? t.assegnatari.filter(n => t.fattiDa.includes(n)).length : 0;
    return k ? ` · fatto da ${k} su ${t.assegnatari.length}` : "";
  };
  const riga = (t) => `• ${esc(t.titolo)} — <i>${esc(ctx.nomeCanzone(t.canzoneId))}</i>${quanti(t)}`;
  const gruppi = [];
  const diTutti = aperti.filter(t => ctx.chiTask(t.assegnatari) === "tutti");
  if (diTutti.length) gruppi.push(sezione(`Tutti (${diTutti.length})`, diTutti.map(riga)));
  const resto = aperti.filter(t => !diTutti.includes(t));
  // persone nell'ordine della band, poi eventuali nomi che non corrispondono più a nessuno
  const nomi = [...ctx.nomi];
  for (const t of resto) for (const n of t.assegnatari || []) if (n && !nomi.includes(n)) nomi.push(n);
  for (const n of nomi) {
    const suoi = resto.filter(t => (t.assegnatari || []).includes(n) && !parteFatta(t, n));
    if (suoi.length) gruppi.push(sezione(`${esc(n)} (${suoi.length})`, suoi.map(riga)));
  }
  const nessuno = resto.filter(t => !(t.assegnatari || []).filter(Boolean).length);
  if (nessuno.length) gruppi.push(sezione(`Senza assegnatari (${nessuno.length})`, nessuno.map(riga)));
  return taglia(`<b>Task aperti</b> · ${aperti.length}\n\n${gruppi.join("\n\n")}`);
}

// ---------- cassa ----------
function saldo(movimenti) {
  return movimenti.reduce((s, m) => s + (m.tipo === "versamento" ? 1 : -1) * (m.importoCent || 0), 0);
}

function cassa(dati) {
  const movs = dati.movimenti || [];
  if (!movs.length) return "<b>Cassa</b>\n\nNessun movimento registrato.";
  const versato = movs.filter(m => m.tipo === "versamento").reduce((s, m) => s + (m.importoCent || 0), 0);
  const speso = movs.filter(m => m.tipo !== "versamento").reduce((s, m) => s + (m.importoCent || 0), 0);
  const ultimi = [...movs].sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")) || (b.creato || 0) - (a.creato || 0)).slice(0, 6);
  const righe = ultimi.map(m => {
    const entrata = m.tipo === "versamento";
    const d = dataMov(m.data);
    return `• ${d ? d + " · " : ""}${entrata ? "+" : "−"} ${euro(m.importoCent)} · ${esc(m.descrizione)}${m.chi ? ` (${esc(m.chi)})` : ""}`;
  });
  return `<b>Cassa</b>\n\nSaldo: <b>${euro(versato - speso)}</b>\nVersato ${euro(versato)} · speso ${euro(speso)}\n\n<b>Ultimi movimenti</b>\n${righe.join("\n")}`;
}

// ---------- novità dell'app (public/novita.json) ----------
const FMT_RILASCIO = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short" });
function aggiornamentiApp(voci, quante = 3) {
  if (!Array.isArray(voci)) return "Non riesco a leggere le novità dell'app in questo momento. Riprova tra poco.";
  if (!voci.length) return "<b>Novità dell'app</b>\n\nAncora nessuna novità registrata.";
  const n = Math.max(1, Math.min(20, Math.round(Number(quante)) || 3));
  const blocchi = voci.slice(0, n).map(v => {
    const quando = /^\d{4}-\d{2}-\d{2}$/.test(v.data || "") ? FMT_RILASCIO.format(new Date(v.data + "T12:00:00Z")) : "";
    const testa = [v.versione ? `Versione ${esc(v.versione)}` : "", quando].filter(Boolean).join(" · ");
    const punti = (v.punti || []).map(p => `• ${esc(p)}`).join("\n");
    return `<b>${esc(v.titolo || "")}</b>${testa ? ` <i>(${testa})</i>` : ""}${punti ? "\n" + punti : ""}`;
  });
  const altre = voci.length > n ? `\n\n<i>Le precedenti: /aggiornamenti ${Math.min(20, voci.length)}</i>` : "";
  return taglia(`<b>Novità dell'app</b>\n\n${blocchi.join("\n\n")}${altre}`);
}

// ---------- aiuto ----------
function aiuto(stato = {}) {
  const auto = stato.ogniGiorni > 0
    ? `Ogni ${stato.ogniGiorni === 1 ? "giorno" : stato.ogniGiorni + " giorni"} alle ${stato.ora ?? 19} mando un riepilogo, solo se nell'app si è mosso qualcosa.`
    : "Il riepilogo automatico è spento.";
  return [
    "<b>Il ritmo della sala prove</b>",
    "Riassumo cosa si muove nell'app. Usate i pulsanti qui sotto, oppure i comandi:",
    "/novita 3 · novità degli ultimi 3 giorni (da 1 a 60)\n/scaletta · /proposte · /task · /cassa\n/aggiornamenti · cosa c'è di nuovo nell'app\n/automatico 2 19 · riepilogo ogni 2 giorni alle 19 (<i>/automatico off</i> per spegnerlo)",
    auto
  ].join("\n\n");
}

module.exports = {
  GENERALE_ID, GIORNO, ORA, APP_URL, MENU,
  fotografa, differenze, novita, titoloNovita, scaletta, proposte, taskAperti, cassa, aiuto, saldo, esc, giorno,
  aggiornamentiApp
};
