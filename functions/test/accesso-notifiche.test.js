// Test delle parti pure di "accesso" (doppioni nelle proposte dei fan) e "notifiche" (eventi scelti da ogni telefono).
const test = require("node:test");
const assert = require("node:assert/strict");
const { normale, stessoPezzo } = require("../accesso")._interni;
const { eventiDi, idIscrizione, EVENTI, EVENTI_FAN } = require("../notifiche")._interni;

// ---------- doppioni nelle proposte ----------

test("normale: minuscole, senza accenti, parentesi, punteggiatura e articolo iniziale", () => {
  assert.equal(normale("Perché (Remastered 2011)"), "perche");
  assert.equal(normale("The Wall [Live]"), "wall");
  assert.equal(normale("Il  Mondo!"), "mondo");
  assert.equal(normale("Simon & Garfunkel"), "simon e garfunkel");
  assert.equal(normale("Theatre"), "theatre", "l'articolo solo se è una parola intera");
  assert.equal(normale(undefined), "");
});

test("stessoPezzo: stesso titolo, artista uguale o mancante", () => {
  assert.ok(stessoPezzo({ titolo: "Albachiara", artista: "Vasco Rossi" }, { titolo: "albachiara (live)", artista: "vasco rossi" }));
  assert.ok(stessoPezzo({ titolo: "Albachiara", artista: "" }, { titolo: "Albachiara", artista: "Vasco Rossi" }), "senza artista conta il titolo");
  assert.ok(!stessoPezzo({ titolo: "Hurt", artista: "Nine Inch Nails" }, { titolo: "Hurt", artista: "Johnny Cash" }), "cover di altri non sono doppioni");
  assert.ok(!stessoPezzo({ titolo: "Albachiara" }, { titolo: "Albachiara 2" }));
});

// ---------- notifiche ----------

test("eventiDi: le scelte del telefono, solo fra quelli ammessi", () => {
  assert.deepEqual(eventiDi({ eventi: ["task", "proposta", "inventato"], eventiV: 3 }, EVENTI), ["task", "proposta"]);
  assert.deepEqual(eventiDi({ eventi: ["task", "proposta"], eventiV: 3 }, EVENTI_FAN), ["proposta"], "i fan non ricevono le task");
  assert.deepEqual(eventiDi({ eventiV: 3 }, EVENTI), EVENTI, "senza scelta: tutti");
});

test("eventiDi: le iscrizioni vecchie ricevono anche gli eventi arrivati dopo", () => {
  assert.deepEqual(eventiDi({ eventi: ["proposta"] }, EVENTI), ["proposta", "bacheca", "commento"]);
  assert.deepEqual(eventiDi({ eventi: ["proposta"], eventiV: 2 }, EVENTI), ["proposta", "commento"]);
  assert.deepEqual(eventiDi({ eventi: [], eventiV: 3 }, EVENTI), [], "chi ha spento tutto resta spento");
});

test("idIscrizione: stabile e diverso per ogni telefono", () => {
  const a = idIscrizione("https://push.example/a"), b = idIscrizione("https://push.example/b");
  assert.match(a, /^[0-9a-f]{40}$/);
  assert.equal(a, idIscrizione("https://push.example/a"));
  assert.notEqual(a, b);
});
