// Test dei testi del bot Telegram e del registro delle modifiche (functions/telegram-testi.js).
// Si lanciano con: cd functions && npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const t = require("../telegram-testi");

const ORA = t.ORA, GIORNO = t.GIORNO;
const ADESSO = Date.UTC(2026, 10, 12, 18);   // 12 novembre 2026, 18:00 UTC

// ---------- registro: fotografia e differenze ----------

test("fotografa: salta la canzone Generale e tiene titolo, stato, voti, setup e commenti", () => {
  const foto = t.fotografa({
    canzoni: [
      { id: "generale", titolo: "Generale" },
      {
        id: "c1", titolo: "Pezzo", stato: "proposta",
        reazioni: { Anna: "up" }, votiFan: { tel1: { voto: "down", nome: "Fan" }, tel2: null },
        setup: { basso: "  plettro  ", voce: "" }, commenti: { Anna: "bello", Bruno: "senza voto" }
      }
    ],
    membri: [{ id: "m1", nome: "Anna" }]
  });
  assert.deepEqual(Object.keys(foto.canzoni), ["c1"]);
  const c = foto.canzoni.c1;
  assert.equal(c.t, "Pezzo");
  assert.equal(c.s, "proposta");
  assert.deepEqual(c.r, { Anna: "up", "f:tel1": "down" });
  assert.deepEqual(Object.keys(c.su), ["basso"], "le parti vuote non entrano");
  assert.match(c.su.basso, /^[0-9a-f]{12}$/);
  assert.deepEqual(c.cm, { Anna: "bello" }, "solo i commenti di chi ha votato");
  assert.deepEqual(foto.membri, { m1: "Anna" });
});

test("differenze: nessun evento se non cambia niente", () => {
  const dati = { canzoni: [{ id: "c1", titolo: "A", stato: "proposta", reazioni: { Anna: "up" } }], membri: [] };
  assert.deepEqual(t.differenze(t.fotografa(dati), t.fotografa(dati)), []);
});

test("differenze: voti, passaggio in scaletta, setup, commenti ed eliminazioni", () => {
  const prima = t.fotografa({
    canzoni: [
      { id: "c1", titolo: "Uno", stato: "proposta", reazioni: { Anna: "up" } },
      { id: "c2", titolo: "Due", stato: "proposta", reazioni: { Anna: "down" } },
      { id: "c3", titolo: "Tre", setup: { basso: "vecchio" } },
      { id: "c4", titolo: "Quattro", stato: "proposta" }
    ]
  });
  const dopo = t.fotografa({
    canzoni: [
      { id: "c1", titolo: "Uno", stato: "proposta", reazioni: { Anna: "up", Bruno: "up" }, commenti: { Bruno: "sì!" } },
      { id: "c2", titolo: "Due", stato: "attiva", reazioni: {} },
      { id: "c3", titolo: "Tre", setup: { basso: "nuovo" } },
      { id: "c5", titolo: "Nuova", stato: "proposta" }
    ]
  });
  const ev = t.differenze(prima, dopo);
  const trova = (tipo, id) => ev.filter(e => e.tipo === tipo && e.canzoneId === id);

  assert.deepEqual(trova("voto", "c1"), [{ tipo: "voto", canzoneId: "c1", titolo: "Uno", chi: "Bruno", voto: "up" }]);
  assert.deepEqual(trova("commento", "c1").map(e => e.testo), ["sì!"]);
  assert.equal(trova("in_scaletta", "c2").length, 1);
  assert.deepEqual(trova("voto", "c2").map(e => e.voto), ["tolto"]);
  assert.deepEqual(trova("setup", "c3").map(e => e.strumento), ["basso"]);
  assert.deepEqual(trova("eliminata", "c4"), [{ tipo: "eliminata", canzoneId: "c4", titolo: "Quattro", stato: "proposta" }]);
  assert.equal(ev.filter(e => e.canzoneId === "c5").length, 0, "le canzoni nuove le racconta il campo creato");
});

test("differenze: chi cambia nome si porta dietro i voti, senza voti nuovi", () => {
  const canzoni = (nome) => [{ id: "c1", titolo: "Uno", stato: "proposta", reazioni: { [nome]: "up" }, commenti: { [nome]: "ok" } }];
  const prima = t.fotografa({ canzoni: canzoni("Anna"), membri: [{ id: "m1", nome: "Anna" }] });
  const dopo = t.fotografa({ canzoni: canzoni("Annina"), membri: [{ id: "m1", nome: "Annina" }] });
  assert.deepEqual(t.differenze(prima, dopo), []);
});

test("differenze: i voti dei fan hanno una chiave che non si confonde con i nomi", () => {
  const prima = t.fotografa({ canzoni: [{ id: "c1", titolo: "Uno", stato: "proposta" }] });
  const dopo = t.fotografa({ canzoni: [{ id: "c1", titolo: "Uno", stato: "proposta", votiFan: { abc: { voto: "up" } } }] });
  const ev = t.differenze(prima, dopo);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].chi, "f:abc");
});

// ---------- novità ----------

test("novita: periodo vuoto", () => {
  const r = t.novita({ canzoni: [], membri: [] }, { da: ADESSO - GIORNO, a: ADESSO, titolo: "Novità", registroDa: ADESSO - 10 * GIORNO });
  assert.equal(r.vuoto, true);
  assert.match(r.testo, /Nessuna novità/);
});

test("novita: proposte, task fatti, canzone pronta, cassa e persone nuove", () => {
  const ieri = ADESSO - 12 * ORA;
  const dati = {
    canzoni: [
      { id: "c1", titolo: "Proposta <nuova>", artista: "Band & Co", stato: "proposta", creato: ieri },
      { id: "c2", titolo: "In scaletta", stato: "attiva", creato: ADESSO - 30 * GIORNO }
    ],
    membri: [{ id: "m1", nome: "Anna", creato: ieri }, { id: "m2", nome: "Bruno", creato: 1 }],
    tasks: [{ id: "t1", canzoneId: "c2", titolo: "Imparare l'assolo", fatto: true, fattoIl: ieri, creato: 1 }],
    movimenti: [
      { tipo: "versamento", importoCent: 2000, descrizione: "quota", creato: ieri },
      { tipo: "spesa", importoCent: 500, descrizione: "corde", creato: 1 }
    ]
  };
  const r = t.novita(dati, { da: ADESSO - GIORNO, a: ADESSO, titolo: "Novità", registroDa: ADESSO - 10 * GIORNO });
  assert.equal(r.vuoto, false);
  assert.match(r.testo, /Proposte nuove \(1\)/);
  assert.match(r.testo, /Proposta &lt;nuova&gt;/, "i titoli sono protetti per l'HTML di Telegram");
  assert.match(r.testo, /Band &amp; Co/);
  assert.match(r.testo, /Imparare l'assolo/);
  assert.match(r.testo, /Ora pronte: <b>In scaletta<\/b>/);
  assert.match(r.testo, /Saldo: <b>15,00\s€<\/b>/, "il saldo conta anche i movimenti fuori dal periodo");
  assert.match(r.testo, /Nuovi nella band<\/b>\nAnna$/m, "Bruno c'era già prima del periodo");
  assert.match(r.testo, /Ancora da votare<\/b>: Bruno 1 · Anna 1/, "nell'ordine in cui sono entrati nella band");
});

test("novita: i task di una canzone tornata fra le proposte non contano", () => {
  const dati = {
    canzoni: [{ id: "c1", titolo: "Uno", stato: "proposta", creato: 1 }],
    tasks: [{ canzoneId: "c1", titolo: "Nascosto", fatto: true, fattoIl: ADESSO - ORA }]
  };
  const r = t.novita(dati, { da: ADESSO - GIORNO, a: ADESSO, titolo: "N", registroDa: 1 });
  assert.doesNotMatch(r.testo, /Nascosto/);
});

test("novita: un testo lunghissimo viene tagliato sotto il limite di Telegram e il blockquote resta chiuso", () => {
  const canzoni = Array.from({ length: 400 }, (_, i) => ({
    id: "c" + i, titolo: "Titolo piuttosto lungo numero " + i, artista: "Artista con un nome lungo", stato: "attiva", creato: ADESSO - ORA
  }));
  const r = t.novita({ canzoni }, { da: ADESSO - GIORNO, a: ADESSO, titolo: "N", registroDa: 1 });
  assert.ok(r.testo.length <= 4096, `lunghezza ${r.testo.length}`);
  // con 400 righe in una sezione l'elenco si ferma a 12 e dice quante ne mancano
  assert.match(r.testo, /… e altri 388/);
});

test("titoloNovita", () => {
  assert.equal(t.titoloNovita(1), "Novità delle ultime 24 ore");
  assert.equal(t.titoloNovita(7), "Novità degli ultimi 7 giorni");
});

// ---------- scaletta, proposte, task ----------

test("scaletta: ordine, stato dei task e task generali aperti", () => {
  const testo = t.scaletta({
    canzoni: [
      { id: "generale", stato: "generale" },
      { id: "b", titolo: "Seconda", ordine: 2 },
      { id: "a", titolo: "Prima", artista: "X", ordine: 1 },
      { id: "p", titolo: "Proposta", stato: "proposta" }
    ],
    tasks: [
      { canzoneId: "a", fatto: true }, { canzoneId: "a", fatto: true },
      { canzoneId: "b", fatto: true }, { canzoneId: "b", fatto: false },
      { canzoneId: "generale", fatto: false }
    ]
  });
  assert.match(testo, /2 canzoni, 1 pronta/);
  assert.match(testo, /1\. <b>Prima<\/b> – X · pronta ✓\n2\. <b>Seconda<\/b> · 1 di 2 task/);
  assert.match(testo, /Generale: 1 task aperto/);
  assert.doesNotMatch(testo, /Proposta/);
});

test("scaletta vuota", () => {
  assert.match(t.scaletta({ canzoni: [] }), /Nessuna canzone in scaletta/);
});

test("proposte: classifica con i voti dei fan, senza voti in fondo", () => {
  const testo = t.proposte({
    canzoni: [
      { id: "a", titolo: "Poco", stato: "proposta", ordine: 1, reazioni: { Anna: "up", Bruno: "down" } },
      { id: "b", titolo: "Tanto", stato: "proposta", ordine: 2, reazioni: { Anna: "up" }, votiFan: { f1: { voto: "up" } }, commenti: { Anna: "<forte>" } },
      { id: "c", titolo: "Nessuno", stato: "proposta", ordine: 3 }
    ],
    membri: [{ nome: "Anna" }, { nome: "Bruno" }]
  });
  assert.ok(testo.indexOf("Tanto") < testo.indexOf("Poco"), "più 👍 prima");
  assert.match(testo, /Tanto<\/b>\n👍 2 · 👎 0/);
  assert.match(testo, /<blockquote>«&lt;forte&gt;»<\/blockquote>/);
  assert.match(testo, /Ancora senza voti<\/b>: Nessuno/);
  assert.match(testo, /Ancora da votare<\/b>: Anna 1 · Bruno 2/);
});

test("taskAperti: raggruppati per persona, con le parti già fatte", () => {
  const testo = t.taskAperti({
    canzoni: [{ id: "generale", stato: "generale" }, { id: "c1", titolo: "Uno" }],
    membri: [{ nome: "Anna", creato: 1 }, { nome: "Bruno", creato: 2 }],
    tasks: [
      { canzoneId: "c1", titolo: "Di tutti", assegnatari: ["Anna", "Bruno"], creato: 1 },
      { canzoneId: "c1", titolo: "A metà", assegnatari: ["Anna", "Ex"], fattiDa: ["Anna"], creato: 2 },
      { canzoneId: "c1", titolo: "Di Bruno", assegnatari: ["Bruno"], creato: 3 },
      { canzoneId: "generale", titolo: "Senza nessuno", assegnatari: [], creato: 4 },
      { canzoneId: "c1", titolo: "Chiuso", assegnatari: ["Anna"], fatto: true, creato: 5 }
    ]
  });
  assert.match(testo, /<b>Task aperti<\/b> · 4/);
  assert.match(testo, /<b>Tutti \(1\)<\/b>\n• Di tutti — <i>Uno<\/i>\n\n/);
  assert.match(testo, /<b>Bruno \(1\)<\/b>\n• Di Bruno/);
  assert.doesNotMatch(testo, /<b>Anna \(/, "Anna ha già fatto la sua parte");
  assert.match(testo, /<b>Ex \(1\)<\/b>\n• A metà — <i>Uno<\/i> · fatto da 1 su 2/, "anche i nomi che non sono più nella band");
  assert.match(testo, /Senza assegnatari \(1\)<\/b>\n• Senza nessuno — <i>Generale<\/i>/);
  assert.doesNotMatch(testo, /Chiuso/);
});

// ---------- cassa ----------

test("saldo: versamenti meno spese, in centesimi", () => {
  assert.equal(t.saldo([]), 0);
  assert.equal(t.saldo([
    { tipo: "versamento", importoCent: 5000 },
    { tipo: "spesa", importoCent: 1250 },
    { tipo: "spesa" }
  ]), 3750);
});

test("cassa: saldo, totali e ultimi movimenti dal più recente", () => {
  const testo = t.cassa({
    movimenti: [
      { tipo: "versamento", importoCent: 5000, descrizione: "quota", chi: "Anna", data: "2026-10-01", creato: 1 },
      { tipo: "spesa", importoCent: 1250, descrizione: "sala", data: "2026-10-02", creato: 2 }
    ]
  });
  assert.match(testo, /Saldo: <b>37,50\s€<\/b>/);
  assert.match(testo, /Versato 50,00\s€ · speso 12,50\s€/);
  assert.match(testo, /• 2 ott · − 12,50\s€ · sala\n• 1 ott · \+ 50,00\s€ · quota \(Anna\)/);
  assert.match(t.cassa({}), /Nessun movimento/);
});

// ---------- novità dell'app ----------

test("aggiornamentiApp: le ultime voci di novita.json", () => {
  const voci = [
    { versione: "64", data: "2026-11-10", titolo: "Batteria", punti: ["uno", "<due>"] },
    { versione: "63", data: "2026-11-01", titolo: "Tonalità" },
    { versione: "62", titolo: "Tab" }
  ];
  const testo = t.aggiornamentiApp(voci, 2);
  assert.match(testo, /<b>Batteria<\/b> <i>\(Versione 64 · 10 nov\)<\/i>\n• uno\n• &lt;due&gt;/);
  assert.match(testo, /Tonalità/);
  assert.doesNotMatch(testo, /<b>Tab<\/b>/);
  assert.match(testo, /\/aggiornamenti 3/);
  assert.match(t.aggiornamentiApp(null), /Non riesco/);
  assert.match(t.aggiornamentiApp([]), /Ancora nessuna/);
});

test("novita.json dell'app è leggibile dal bot", () => {
  const { voci } = require("../../public/novita.json");
  assert.ok(Array.isArray(voci) && voci.length > 0);
  for (const v of voci) {
    assert.equal(typeof v.titolo, "string", `voce senza titolo: ${JSON.stringify(v).slice(0, 80)}`);
    if (v.data !== undefined) assert.match(v.data, /^\d{4}-\d{2}-\d{2}$/);
    if (v.punti !== undefined) assert.ok(Array.isArray(v.punti));
  }
  assert.ok(t.aggiornamentiApp(voci).length <= 4096);
});

test("esc: protegge i caratteri dell'HTML di Telegram", () => {
  assert.equal(t.esc("a < b & c > d"), "a &lt; b &amp; c &gt; d");
  assert.equal(t.esc(null), "");
});
