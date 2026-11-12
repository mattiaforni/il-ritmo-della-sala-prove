// Test della funzione "tab" (functions/tab.js): lettura dei dati di Songsterr e conversione in Guitar Pro.
// Nessuna chiamata di rete: le tracce sono costruite a mano nel formato JSON di Songsterr.
// Se Songsterr cambia formato e la conversione si rompe, il caso da aggiungere è qui.
const test = require("node:test");
const assert = require("node:assert/strict");
const alphaTab = require("@coderline/alphatab");
const { statoDaHtml, songIdDi, slug, urlTab, costruisciGp } = require("../tab");

// ---------- link e pagine ----------

test("songIdDi: il numero della tab dal link", () => {
  assert.equal(songIdDi("https://www.songsterr.com/a/wsa/queen-bohemian-rhapsody-tab-s12345"), 12345);
  assert.equal(songIdDi("https://www.songsterr.com/a/wsa/queen-bohemian-rhapsody-tab-s12345t2"), 12345, "con la traccia scelta");
  assert.equal(songIdDi("https://www.songsterr.com/a/wsa/qualcosa"), null);
  assert.equal(songIdDi(undefined), null);
});

test("slug e urlTab: indirizzi come quelli di Songsterr", () => {
  assert.equal(slug("Guns N' Roses"), "guns-n-roses");
  assert.equal(slug("Simon & Garfunkel"), "simon-and-garfunkel");
  assert.equal(slug("Perché no?  Più là"), "perche-no-piu-la");
  assert.equal(slug(""), "");
  assert.equal(urlTab(42, "Vasco Rossi", "Albachiara"), "https://www.songsterr.com/a/wsa/vasco-rossi-albachiara-tab-s42");
  assert.equal(urlTab(7, "", "?!"), "https://www.songsterr.com/a/wsa/tab-tab-s7");
  assert.equal(songIdDi(urlTab(99, "A", "B")), 99, "i link costruiti si rileggono");
});

test("statoDaHtml: legge il JSON nascosto nella pagina della tab", () => {
  const stato = { meta: { current: {
    songId: 5, revisionId: 77, image: "abc", title: "Titolo", artist: "Artista",
    tracks: [{ partId: 0, title: "Chitarra" }, { title: "senza partId" }, { partId: 1, title: "Basso" }]
  } } };
  const html = `<html><body><script id="state" type="application/json">${JSON.stringify(stato)}</script></body></html>`;
  const meta = statoDaHtml(html);
  assert.equal(meta.songId, 5);
  assert.equal(meta.revisionId, 77);
  assert.equal(meta.image, "abc");
  assert.deepEqual(meta.tracks.map(t => t.title), ["Chitarra", "Basso"]);
});

test("statoDaHtml: errori leggibili se la pagina cambia formato", () => {
  assert.throws(() => statoDaHtml("<html></html>"), /formato cambiato/);
  const incompleto = `<script id="state">${JSON.stringify({ meta: { current: { songId: 1 } } })}</script>`;
  assert.throws(() => statoDaHtml(incompleto), /incompleti/);
});

// ---------- conversione in Guitar Pro ----------

const nota = (string, fret) => ({ string, fret });
const quarto = (...notes) => ({ duration: [1, 4], notes });
const pausa = (duration = [1, 1]) => ({ duration, rest: true, notes: [{ rest: true }] });

function tabFinta() {
  const meta = { songId: 1, revisionId: 1, image: "x", title: "Pezzo di prova", artist: "La band" };
  const chitarra = {
    trackMeta: { partId: 0, title: "Chitarra solista", instrumentId: 30 },
    revision: {
      instrument: "Distortion Guitar",
      tuning: [64, 59, 55, 50, 45, 40],
      measures: [
        { signature: [4, 4], marker: { text: "Intro" }, voices: [{ beats: [quarto(nota(0, 0)), quarto(nota(1, 3)), quarto(nota(2, 2)), quarto(nota(0, 0), nota(1, 1))] }] },
        { voices: [{ beats: [pausa()] }] }
      ]
    }
  };
  const voce = {
    trackMeta: { partId: 1, title: "Lead Vocals", instrumentId: 54 },
    revision: {
      instrument: "Voice Oohs",
      tuning: [64, 59, 55, 50, 45, 40],
      measures: [
        { voices: [{ beats: [quarto(nota(0, 0)), quarto(nota(0, 2)), quarto(nota(0, 4)), quarto(nota(0, 5))] }] },
        { voices: [{ beats: [quarto(nota(0, 7)), quarto(nota(0, 5)), { duration: [1, 2], notes: [nota(0, 4)] }] }] }
      ],
      newLyrics: [{ offset: 1, text: "can-ta-re in-sie-me" }, { offset: 2, text: "  " }]
    }
  };
  const batteria = {
    trackMeta: { partId: 2, title: "Drums", instrumentId: 1024, isDrums: true },
    revision: {
      instrument: "Drums",
      measures: [{ voices: [{ beats: [quarto(nota(0, 36)), quarto(nota(0, 38)), quarto(nota(0, 36)), quarto(nota(0, 38))] }] }]
    }
  };
  return { meta, tracce: [chitarra, voce, batteria] };
}

test("costruisciGp: un file Guitar Pro valido con tracce, voce, testo e note", () => {
  const { meta, tracce } = tabFinta();
  const { bytes, info, testi } = costruisciGp(meta, tracce);

  assert.ok(bytes instanceof Uint8Array && bytes.length > 1000, "file non vuoto");
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK", "GP7 è uno zip");

  assert.deepEqual(info.map(i => i.nome), ["Chitarra solista", "Lead Vocals", "Drums"]);
  assert.deepEqual(info.map(i => i.voce), [false, true, false], "la traccia voce si riconosce dal nome");
  assert.deepEqual(info.map(i => i.testo), [false, true, false]);
  assert.deepEqual(info.map(i => i.note), [4, 7, 4], "battiti con note, pause escluse");
  assert.deepEqual(testi, { 1: [{ offset: 1, text: "can-ta-re in-sie-me" }] }, "le righe vuote del testo si saltano");

  // il file si rilegge con alphaTab, come fa l'app nello Spartito
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings());
  assert.equal(score.title, "Pezzo di prova");
  assert.equal(score.artist, "La band");
  assert.equal(score.tracks.length, 3);
  assert.equal(score.masterBars.length, 2);
  assert.equal(score.masterBars[0].timeSignatureNumerator, 4);
  assert.equal(score.masterBars[0].section && score.masterBars[0].section.text, "Intro");
  assert.equal(score.masterBars[0].section.marker, "", "niente «[Intro] Intro» doppio");
  assert.ok(score.tracks[2].staves[0].isPercussion, "la batteria resta batteria");

  const sillabe = score.tracks[1].staves[0].bars[0].voices[0].beats.map(b => (b.lyrics || [])[0]).filter(Boolean);
  assert.deepEqual(sillabe, ["can-", "ta-", "re", "in-"], "il testo finisce sotto le note");
});

test("costruisciGp: una traccia vuota non rompe la conversione", () => {
  const meta = { songId: 2, revisionId: 1, image: "x", title: "Vuota", artist: "" };
  const { bytes, info } = costruisciGp(meta, [{ trackMeta: { partId: 0, name: "Basso" }, revision: { tuning: [43, 38, 33, 28], measures: [] } }]);
  assert.ok(bytes.length > 0);
  assert.equal(info[0].nome, "Basso");
  assert.equal(info[0].note, 0);
});
