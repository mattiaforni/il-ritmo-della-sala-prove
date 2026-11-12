// Controllo prima della pubblicazione: i numeri di versione dell'app devono coincidere
// (vedi README, «Pubblicare una nuova versione»). Se uno resta indietro i telefoni
// non vedono la barra «Aggiorna» o tengono in cache i file vecchi.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");

test("APP_VERSION, version.json, CACHE del service worker e novita.json vanno insieme", () => {
  const app = pub("app.js").match(/const APP_VERSION = "([^"]+)"/);
  const sw = pub("sw.js").match(/const CACHE = "prove-v([^"]+)"/);
  const version = JSON.parse(pub("version.json")).version;
  const novita = JSON.parse(pub("novita.json")).voci[0];
  assert.ok(app, "APP_VERSION non trovato in public/app.js");
  assert.ok(sw, "CACHE non trovato in public/sw.js");
  assert.equal(version, app[1], "public/version.json diverso da APP_VERSION");
  assert.equal(sw[1], app[1], "CACHE in public/sw.js diverso da APP_VERSION");
  assert.equal(novita.versione, app[1], "manca la voce della versione nuova in cima a public/novita.json");
});

test("i file elencati nel service worker esistono", () => {
  const shell = JSON.parse(pub("sw.js").match(/const SHELL = (\[[^\]]*\])/)[1]);
  for (const f of shell) {
    if (f === "./") continue;
    assert.ok(fs.existsSync(path.join(__dirname, "..", "..", "public", f)), `public/${f} non esiste`);
  }
});
