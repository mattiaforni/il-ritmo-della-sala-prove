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
// Operazioni (POST con il token della band; "file" anche con quello dei fan):
//   prepara { canzoneId }  → scarica, converte, salva in Storage (tab/<canzoneId>.gp) e
//                            scrive su canzoni/<id> il campo "tab" { songId, revisionId,
//                            tracce: [{ partId, nome, strumento, testo }], byte, aggiornata }
//   file    { canzoneId }  → restituisce il file .gp (application/octet-stream)
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
const SONGSTERR_RE = /^https:\/\/(?:www\.)?songsterr\.com\/a\/wsa\/[^\s"'<>]+$/i;
const INTESTAZIONI = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Accept-Language": "it-IT,it;q=0.9,en;q=0.8"
};

async function prendi(url, cosa, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { ...INTESTAZIONI, Accept: cosa === "json" ? "application/json" : "text/html" }, signal: ctl.signal });
    if (!r.ok) { const e = new Error(`${cosa} ${r.status}`); e.status = r.status; throw e; }
    return cosa === "json" ? r.json() : r.text();
  } finally { clearTimeout(t); }
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
  let conTesto = [];
  tracce.forEach((tr, i) => {
    const righe = Array.isArray(tr.revision.newLyrics) ? tr.revision.newLyrics.filter(l => l && typeof l.text === "string" && l.text.trim()) : [];
    const track = score.tracks[i];
    if (!righe.length || !track) return;
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
  return { bytes, info };
}
function contaNote(track) {
  let n = 0;
  if (!track) return 0;
  for (const st of track.staves) for (const bar of st.bars) for (const v of bar.voices) for (const b of v.beats) if (!b.isRest && b.notes.length) n++;
  return n;
}

function crea({ cors, ruolo, REGIONE }) {
  const db = () => getFirestore();
  const file = (id) => getStorage().bucket().file(`tab/${id}.gp`);

  const tab = onRequest({ region: REGIONE, memory: "512MiB", timeoutSeconds: 120, maxInstances: 2 }, async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "metodo non valido" }); return; }
    const chi = await ruolo(req);
    if (!chi) { res.status(401).json({ error: "accesso negato" }); return; }
    const { op, canzoneId } = req.body || {};
    const id = String(canzoneId || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!id) { res.status(400).json({ error: "manca la canzone" }); return; }
    try {
      if (op === "file") {
        const [esiste] = await file(id).exists();
        if (!esiste) { res.status(404).json({ error: "tab non ancora preparata" }); return; }
        const [buf] = await file(id).download();
        res.set("Content-Type", "application/octet-stream");
        res.set("Cache-Control", "private, max-age=3600");
        res.status(200).send(buf);
        return;
      }
      if (op !== "prepara") { res.status(400).json({ error: "operazione sconosciuta" }); return; }
      if (chi !== "band") { res.status(403).json({ error: "solo la band" }); return; }
      const snap = await db().doc(`canzoni/${id}`).get();
      if (!snap.exists) { res.status(404).json({ error: "canzone non trovata" }); return; }
      const c = snap.data();
      const url = String(c.songsterrUrl || "").replace(/[?#].*$/, "");
      if (!SONGSTERR_RE.test(url)) { res.status(400).json({ error: "La canzone non ha il link Songsterr della pagina della tab" }); return; }
      const meta = statoDaHtml(await prendi(url, "html"));
      const tracce = await tracceDi(meta);
      if (!tracce.length) { res.status(502).json({ error: "Nessuna traccia scaricata da Songsterr" }); return; }
      const { bytes, info } = costruisciGp(meta, tracce);
      await file(id).save(Buffer.from(bytes), { contentType: "application/octet-stream", resumable: false, metadata: { cacheControl: "private, max-age=0" } });
      const tab = { songId: meta.songId, revisionId: meta.revisionId, titolo: meta.title, artista: meta.artist, tracce: info, byte: bytes.length, aggiornata: FieldValue.serverTimestamp() };
      await db().doc(`canzoni/${id}`).update({ tab });
      res.status(200).json({ ok: true, tab: { ...tab, aggiornata: Date.now() } });
    } catch (e) {
      console.error("tab", op, id, e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });
  return { tab };
}

module.exports = { crea, statoDaHtml, costruisciGp };
