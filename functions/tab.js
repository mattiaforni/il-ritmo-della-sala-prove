// ============================================================
// Cloud Function "tab" — la tablatura di una canzone da Songsterr, in un file Guitar Pro
// per la pagina «Spartito» dell'app (tab a schermo e modalità Canta).
//
// Come funziona Songsterr: la pagina della tab contiene un JSON (<script id="state">)
// con songId, revisionId, un hash "image" e le tracce (partId, strumento, nome); ogni
// traccia è un JSON pubblico su un CDN:
//   https://dqsljvtekg760.cloudfront.net/{songId}/{revisionId}/{image}/{partId}.json
// I JSON delle tracce vengono convertiti in un modello alphaTab con il convertitore di
// songsterr-downloader (MIT, Ryan Roberts; vedi songsterr-converter.js) ed esportati in
// formato Guitar Pro 7 con alphaTab. Il testo delle tracce voce (campo "newLyrics",
// nello stesso formato dei testi di Guitar Pro) viene applicato alle note.
//
// Operazioni (POST con il token della band; "file" anche con quello dei fan). "raccolta" è "canzoni"
// (scaletta e proposte, il default) o "studio" (i pezzi «Da cantare» di ognuno, dalla v49):
//   prepara { canzoneId, raccolta } → scarica, converte, salva in Storage (tab/<id>.gp, tab/studio/<id>.gp) e
//                            scrive sul documento il campo "tab" { songId, revisionId,
//                            url (link usato), tracce: [{ partId, nome, strumento, voce, testo, note }], testi: { <indice traccia>:
//                            [{ offset, text }] } (il testo originale, per correggerlo dalla pagina), byte, aggiornata }
//   file    { canzoneId, raccolta } → restituisce il file .gp (application/octet-stream)
//   cerca   { q }           → cerca su Songsterr (titolo o artista): { risultati: [{ songId, titolo, artista, url }] }
//   togli   { canzoneId }   → toglie un pezzo «Da cantare» e il suo file
//   carica  { canzoneId, raccolta, nome, dati (base64), da } → un file Guitar Pro caricato a mano (pezzi nostri,
//                            tab proprie, v51): lo legge con alphaTab per controllarlo e contare tracce e testo,
//                            lo salva com'è e scrive "tab" { fonte: "file", nome, da, revisionId (ora), tracce, … }
//
// Il formato interno di Songsterr non è documentato: quando cambia, questa funzione va
// aggiornata; i file già salvati restano.
// ============================================================
const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const alphaTab = require("@coderline/alphatab");
const { SongsterrToAlphaTabConverter } = require("./songsterr-converter");

const CDN = ["https://dqsljvtekg760.cloudfront.net", "https://d3d3l6a6rcgkaf.cloudfront.net"];
const SITO = "https://www.songsterr.com";
const RACCOLTE = ["canzoni", "studio"];
const SONGSTERR_RE = /^https:\/\/(?:www\.)?songsterr\.com\/a\/wsa\/[^\s"'<>]+$/i;
const INTESTAZIONI = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Accept-Language": "it-IT,it;q=0.9,en;q=0.8"
};

async function prendi(url, cosa, ms = 20000, conUrl = false) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { ...INTESTAZIONI, Accept: cosa === "json" ? "application/json" : "text/html" }, signal: ctl.signal });
    if (!r.ok) { const e = new Error(`${cosa} ${r.status}`); e.status = r.status; throw e; }
    const corpo = cosa === "json" ? await r.json() : await r.text();
    return conUrl ? { corpo, url: r.url || url } : corpo;
  } finally { clearTimeout(t); }
}

// pagina della tab; se il link non risponde (es. un indirizzo costruito dai risultati della ricerca con un
// nome scritto diversamente) si riprova con l'indirizzo per numero, che Songsterr gira alla pagina giusta
async function paginaTab(url) {
  try { return await prendi(url, "html", 20000, true); }
  catch (e) {
    const m = url.match(/-s(\d+)(?:t\d+)?$/);
    if (!m || e.status !== 404) throw e;
    return prendi(`${SITO}/a/wa/song?id=${m[1]}`, "html", 20000, true);
  }
}

// indirizzo della pagina di una tab, come quelli di Songsterr: /a/wsa/<artista>-<titolo>-tab-s<id>
function slug(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const urlTab = (songId, artista, titolo) => `${SITO}/a/wsa/${slug(`${artista} ${titolo}`) || "tab"}-tab-s${songId}`;

// ricerca: l'API pubblica del sito (la stessa della casella di ricerca); il formato vecchio come riserva
async function cercaSongsterr(q) {
  const p = encodeURIComponent(q);
  let lista = null, ultimo = null;
  for (const u of [`${SITO}/api/songs?pattern=${p}&size=25`, `${SITO}/a/ra/songs.json?pattern=${p}`]) {
    try { lista = await prendi(u, "json", 12000); if (Array.isArray(lista)) break; }
    catch (e) { ultimo = e; }
  }
  if (!Array.isArray(lista)) throw ultimo || new Error("ricerca non disponibile");
  const visti = new Set();
  return lista.map(x => {
    const songId = Number(x.songId ?? x.id);
    const artista = typeof x.artist === "string" ? x.artist : (x.artist && (x.artist.name || x.artist.nameWithoutThePrefix)) || "";
    const titolo = String(x.title || "").trim();
    return { songId, titolo, artista: String(artista).trim(), player: x.hasPlayer !== false };
  }).filter(x => x.songId > 0 && x.titolo && x.player && !visti.has(x.songId) && visti.add(x.songId))
    .slice(0, 20).map(({ songId, titolo, artista }) => ({ songId, titolo, artista, url: urlTab(songId, artista, titolo) }));
}

// legge lo stato della pagina Songsterr
function statoDaHtml(html) {
  const m = html.match(/<script[^>]*id="state"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error("La pagina Songsterr non contiene i dati della tab (formato cambiato?)");
  const st = JSON.parse(m[1]);
  const c = st && st.meta && st.meta.current;
  if (!c || !c.songId || !c.revisionId || !c.image) throw new Error("Dati della tab incompleti nella pagina Songsterr");
  return {
    songId: c.songId, revisionId: c.revisionId, image: c.image,
    title: c.title || "", artist: c.artist || "",
    tracks: (Array.isArray(c.tracks) ? c.tracks : []).filter(t => typeof t.partId === "number")
  };
}

async function tracceDi(meta) {
  const out = [];
  for (const tr of meta.tracks.sort((a, b) => a.partId - b.partId)) {
    let rev = null, ultimo = null;
    for (const base of CDN) {
      try { rev = await prendi(`${base}/${meta.songId}/${meta.revisionId}/${meta.image}/${tr.partId}.json`, "json"); break; }
      catch (e) { ultimo = e; if (!e.status) break; }   // 403/404: si prova l'altro CDN; timeout: no
    }
    if (!rev) { console.warn(`traccia ${tr.partId} non scaricata`, ultimo && ultimo.message); continue; }
    out.push({ trackMeta: tr, revision: rev });
  }
  return out;
}

const VOCE_RE = /vocal|voice|voc\b|sing|lead vocals|cantante|voce/i;
function nomeTraccia(tr) { return tr.trackMeta.title || tr.trackMeta.name || tr.revision.name || `Traccia ${tr.trackMeta.partId + 1}`; }

// converte e, se c'è, applica il testo (newLyrics: righe con offset = battuta di partenza, 1-based)
function costruisciGp(meta, tracce) {
  const conv = new SongsterrToAlphaTabConverter();
  const { data, warnings } = conv.toGp7({ meta, revisions: tracce });
  for (const w of warnings || []) console.log("conversione:", w.code, w.message, w.location || "");
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(data, settings);
  let conTesto = [], testi = {};
  tracce.forEach((tr, i) => {
    const righe = Array.isArray(tr.revision.newLyrics) ? tr.revision.newLyrics.filter(l => l && typeof l.text === "string" && l.text.trim()) : [];
    const track = score.tracks[i];
    if (!righe.length || !track) return;
    testi[i] = righe.map(l => ({ offset: Math.max(1, Number(l.offset) || 1), text: l.text }));
    const lyrics = righe.map(l => { const x = new alphaTab.model.Lyrics(); x.startBar = Math.max(0, (Number(l.offset) || 1) - 1); x.text = l.text; return x; });
    try { track.applyLyrics(lyrics); conTesto.push(i); } catch (e) { console.warn("testo non applicato alla traccia", i, e.message); }
  });
  score.title = meta.title || score.title; score.artist = meta.artist || score.artist;
  for (const mb of score.masterBars) if (mb.section && mb.section.marker === mb.section.text) mb.section.marker = "";   // altrimenti «[Intro] Intro»
  const bytes = new alphaTab.exporter.Gp7Exporter().export(score, settings);
  const info = tracce.map((tr, i) => ({
    partId: tr.trackMeta.partId, nome: nomeTraccia(tr),
    strumento: tr.revision.instrument || "", voce: VOCE_RE.test(nomeTraccia(tr)) || VOCE_RE.test(tr.revision.instrument || ""),
    testo: conTesto.includes(i), note: contaNote(score.tracks[i])
  }));
  return { bytes, info, testi };
}
function haTesto(track) {
  for (const st of track.staves) for (const bar of st.bars) for (const v of bar.voices) for (const b of v.beats) if (b.lyrics && b.lyrics.some(x => x && String(x).trim())) return true;
  return false;
}
const MAX_FILE = 5 * 1024 * 1024;
function contaNote(track) {
  let n = 0;
  if (!track) return 0;
  for (const st of track.staves) for (const bar of st.bars) for (const v of bar.voices) for (const b of v.beats) if (!b.isRest && b.notes.length) n++;
  return n;
}

function crea({ cors, ruolo, REGIONE }) {
  const db = () => getFirestore();
  const file = (id, raccolta) => getStorage().bucket().file(raccolta === "studio" ? `tab/studio/${id}.gp` : `tab/${id}.gp`);

  const tab = onRequest({ region: REGIONE, memory: "512MiB", timeoutSeconds: 120, maxInstances: 2 }, async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "metodo non valido" }); return; }
    const chi = await ruolo(req);
    if (!chi) { res.status(401).json({ error: "accesso negato" }); return; }
    const { op, canzoneId, q } = req.body || {};
    const raccolta = RACCOLTE.includes(req.body && req.body.raccolta) ? req.body.raccolta : "canzoni";
    try {
      if (op === "cerca") {
        if (chi !== "band") { res.status(403).json({ error: "solo la band" }); return; }
        const testo = String(q || "").replace(/\s+/g, " ").trim().slice(0, 80);
        if (testo.length < 2) { res.status(200).json({ risultati: [] }); return; }
        res.set("Cache-Control", "private, max-age=300");
        res.status(200).json({ risultati: await cercaSongsterr(testo) });
        return;
      }
    } catch (e) {
      console.error("tab cerca", e);
      res.status(502).json({ error: "Songsterr non risponde alla ricerca" });
      return;
    }
    const id = String(canzoneId || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!id) { res.status(400).json({ error: "manca la canzone" }); return; }
    try {
      if (op === "file") {
        const [esiste] = await file(id, raccolta).exists();
        if (!esiste) { res.status(404).json({ error: "tab non ancora preparata" }); return; }
        const [buf] = await file(id, raccolta).download();
        res.set("Content-Type", "application/octet-stream");
        res.set("Cache-Control", "private, max-age=3600");
        res.status(200).send(buf);
        return;
      }
      if (chi !== "band") { res.status(403).json({ error: "solo la band" }); return; }
      if (op === "togli") {
        // un pezzo «Da cantare» tolto dalla lista: via il documento (se c'è ancora) e il file
        if (raccolta !== "studio") { res.status(400).json({ error: "si tolgono solo i pezzi Da cantare" }); return; }
        await db().doc(`studio/${id}`).delete();
        await file(id, raccolta).delete({ ignoreNotFound: true });
        res.status(200).json({ ok: true });
        return;
      }
      if (op !== "prepara" && op !== "carica") { res.status(400).json({ error: "operazione sconosciuta" }); return; }
      const rif = db().doc(`${raccolta}/${id}`);
      const snap = await rif.get();
      if (!snap.exists) { res.status(404).json({ error: "canzone non trovata" }); return; }
      if (op === "carica") {
        const buf = Buffer.from(String(req.body.dati || ""), "base64");
        if (!buf.length) { res.status(400).json({ error: "file vuoto" }); return; }
        if (buf.length > MAX_FILE) { res.status(413).json({ error: "file troppo grande (massimo 5 MB)" }); return; }
        let score;
        try { score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(buf), new alphaTab.Settings()); }
        catch (e) { res.status(400).json({ error: "non è un file Guitar Pro leggibile" }); return; }
        if (!score.tracks.length) { res.status(400).json({ error: "il file non ha tracce" }); return; }
        const tracce = score.tracks.map((t, i) => {
          const nome = String(t.name || "").trim() || `Traccia ${i + 1}`;
          const prog = t.playbackInfo ? t.playbackInfo.program : -1;
          return { partId: i, nome, strumento: "", voce: VOCE_RE.test(nome) || [52, 53, 54, 85].includes(prog), testo: haTesto(t), note: contaNote(t) };
        });
        await file(id, raccolta).save(buf, { contentType: "application/octet-stream", resumable: false, metadata: { cacheControl: "private, max-age=0" } });
        const tab = {
          fonte: "file", nome: String(req.body.nome || "").replace(/[\\/]/g, "").slice(0, 120) || "tab.gp", da: String(req.body.da || "").slice(0, 40),
          songId: null, revisionId: Date.now(), url: null, titolo: score.title || "", artista: score.artist || "",
          tracce, testi: {}, byte: buf.length, aggiornata: FieldValue.serverTimestamp()
        };
        await rif.update({ tab });
        res.status(200).json({ ok: true, tab: { ...tab, aggiornata: Date.now() } });
        return;
      }
      const c = snap.data();
      let url = String(c.songsterrUrl || "").replace(/[?#].*$/, "");
      if (!SONGSTERR_RE.test(url)) { res.status(400).json({ error: "La canzone non ha il link Songsterr della pagina della tab" }); return; }
      const pagina = await paginaTab(url);
      const meta = statoDaHtml(pagina.corpo);
      const tracce = await tracceDi(meta);
      if (!tracce.length) { res.status(502).json({ error: "Nessuna traccia scaricata da Songsterr" }); return; }
      const { bytes, info, testi } = costruisciGp(meta, tracce);
      await file(id, raccolta).save(Buffer.from(bytes), { contentType: "application/octet-stream", resumable: false, metadata: { cacheControl: "private, max-age=0" } });
      // l'indirizzo vero della pagina (quelli scelti dalla ricerca sono ricostruiti); i pezzi «Da cantare»
      // prendono anche titolo e artista da Songsterr (aggiunti da un link incollato non li hanno)
      const extra = {};
      const vero = String(pagina.url || "").replace(/[?#].*$/, "");
      if (SONGSTERR_RE.test(vero) && vero !== url) { url = vero; extra.songsterrUrl = vero; }
      if (raccolta === "studio") {
        if (!c.titolo && meta.title) extra.titolo = meta.title;
        if (!c.artista && meta.artist) extra.artista = meta.artist;
        extra.songId = meta.songId;
      }
      // url: il link da cui viene la tab, per accorgersi quando la canzone ne ha uno diverso
      const tab = { songId: meta.songId, revisionId: meta.revisionId, url, titolo: meta.title, artista: meta.artist, tracce: info, testi, byte: bytes.length, aggiornata: FieldValue.serverTimestamp() };
      await rif.update({ tab, ...extra });
      res.status(200).json({ ok: true, tab: { ...tab, aggiornata: Date.now() }, ...extra });
    } catch (e) {
      console.error("tab", op, id, e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });
  return { tab };
}

module.exports = { crea, statoDaHtml, costruisciGp, cercaSongsterr, urlTab, slug };
