// ============================================================
// Cloud Function "spotifyLink" — trova il link di una canzone
// su Spotify (pagina del brano) o su Songsterr (pagina della tablatura).
// Raggiunta dal client come /api/spotify-link (rewrite in firebase.json).
// Corpo della richiesta: { titolo, artista, cosa: "spotify" | "songsterr" }.
// La chiave Gemini vive in un Secret di Firebase (mai nel codice client):
//   firebase functions:secrets:set GEMINI_API_KEY
// Usa Gemini con ricerca Google, così il link è trovato sul web
// e non inventato dal modello. Ogni esito finisce nel log della funzione.
// ============================================================
const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// Modelli provati in ordine: se uno non è disponibile si passa al successivo.
// Con la variabile d'ambiente GEMINI_MODEL se ne forza uno.
const MODELLI = (process.env.GEMINI_MODEL || "gemini-3.7-flash,gemini-3.5-flash,gemini-2.5-flash")
  .split(",").map(s => s.trim()).filter(Boolean);

const CERCA = {
  spotify: {
    istruzione: (q) =>
      `Cerca su Google la pagina Spotify del brano "${q}". ` +
      `Rispondi SOLO con l'URL completo che inizia con https://open.spotify.com/track/ ` +
      `(anche nella forma /intl-it/track/). Se non la trovi con certezza rispondi solo: NONE.`,
    re: /https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]+/
  },
  songsterr: {
    istruzione: (q) =>
      `Cerca su Google la pagina della tablatura di "${q}" sul sito songsterr.com. ` +
      `Rispondi SOLO con l'URL completo della pagina della canzone, che inizia con https://www.songsterr.com/a/wsa/ ` +
      `e finisce con -s seguito da un numero. Se non la trovi con certezza rispondi solo: NONE.`,
    re: /https:\/\/(?:www\.)?songsterr\.com\/a\/wsa\/[a-z0-9-]+-s\d+/i
  }
};

async function chiediAGemini(key, modello, testo) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: testo }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0 }
      })
    }
  );
  const data = await r.json();
  if (data.error) {
    const err = new Error(data.error.message || "errore Gemini");
    err.status = data.error.status || r.status;
    err.code = data.error.code;
    throw err;
  }
  return (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join(" ");
}

exports.spotifyLink = onRequest(
  { region: "us-central1", secrets: [GEMINI_API_KEY], maxInstances: 3 },
  async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    // solo la band: senza questo controllo chiunque potrebbe usare la chiave Gemini della band
    if ((await ruolo(req)) !== "band") return res.status(403).json({ error: "accesso negato" });

    const key = GEMINI_API_KEY.value();
    if (!key) {
      console.error("[link] Secret GEMINI_API_KEY non configurato");
      return res.status(200).json({ url: null, note: "Secret GEMINI_API_KEY non configurato" });
    }

    const { titolo, artista } = req.body || {};
    const cosa = (req.body && req.body.cosa) === "songsterr" ? "songsterr" : "spotify";
    if (!titolo) return res.status(400).json({ error: "titolo mancante" });
    const q = `${titolo}${artista ? " di " + artista : ""}`;
    const { istruzione, re } = CERCA[cosa];

    for (const modello of MODELLI) {
      try {
        const testo = await chiediAGemini(key, modello, istruzione(q));
        const m = testo.match(re);
        console.log(`[link ${cosa}] ${modello} "${q}" → ${m ? m[0] : "nessun link (risposta: " + testo.slice(0, 160) + ")"}`);
        return res.status(200).json({ url: m ? m[0] : null, modello });
      } catch (e) {
        console.error(`[link ${cosa}] ${modello} errore ${e.status || ""} ${e.code || ""}: ${String(e.message).slice(0, 300)}`);
        // modello non disponibile: prova il successivo; altri errori: stop
        if (!(e.code === 404 || e.status === "NOT_FOUND")) {
          return res.status(200).json({ url: null, error: String(e.message).slice(0, 200) });
        }
      }
    }
    return res.status(200).json({ url: null, error: "nessun modello disponibile" });
  }
);

// ============================================================
// Playlist Spotify della band: "Scaletta" e "Proposte".
// Stanno sull'account Spotify di chi le collega (una volta sola, da Personale),
// sono pubbliche e le modifica solo l'app: a ogni cambiamento vengono riscritte.
//
//   playlist         POST { op: "collega" }  → { url } della pagina di consenso Spotify
//                    POST { op: "aggiorna", forza? } → riallinea le due playlist
//                    (solo con l'accesso della band: header Authorization: Bearer <ID token>)
//   spotifyCallback  GET, dove Spotify rimanda dopo il consenso
//
// Accesso con "Authorization Code + PKCE": non serve nessuna chiave segreta,
// solo il Client ID dell'app Spotify (in functions/.env: SPOTIFY_CLIENT_ID=...).
// Token e id delle playlist stanno in Firestore in privato/spotify: le regole
// non lasciano leggere quella collezione dai telefoni, la legge solo la funzione.
// I link alle playlist, che l'app mostra, stanno in canzoni/generale.playlist.
// ============================================================
const PROGETTO = "il-ritmo-della-sala-prove";
const REGIONE = "us-central1";
const APP_URL = `https://${PROGETTO}.web.app`;
const ORIGINI = [APP_URL, `https://${PROGETTO}.firebaseapp.com`];
const BAND_EMAIL = "band@il-ritmo-della-sala-prove.web.app";
const FAN_EMAIL = "fan@il-ritmo-della-sala-prove.web.app";   // sola lettura, vedi accesso.js
const SPOTIFY_CLIENT_ID = (process.env.SPOTIFY_CLIENT_ID || "").trim();
const CALLBACK_URL = `https://${REGIONE}-${PROGETTO}.cloudfunctions.net/spotifyCallback`;
const SCOPES = "playlist-modify-public playlist-modify-private playlist-read-private";
const TRACK_RE = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)/;
const NOMI = { scaletta: "Il ritmo della sala prove · Scaletta", proposte: "Il ritmo della sala prove · Proposte" };
const DESCRIZIONI = {
  scaletta: "La scaletta della band, nell'ordine delle prove. Si aggiorna da sola dall'app.",
  proposte: "Le canzoni proposte, dalla più votata. Si aggiorna da sola dall'app."
};

const db = () => getFirestore();
const refPrivato = () => db().doc("privato/spotify");
const refGenerale = () => db().doc("canzoni/generale");
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const attendi = (ms) => new Promise(r => setTimeout(r, ms));

// le richieste vengono eseguite una alla volta (con maxInstances: 1 c'è un'istanza sola)
let coda = Promise.resolve();
function inCoda(fn) {
  const p = coda.then(fn, fn);
  coda = p.catch(() => {});
  return p;
}

function cors(req, res) {
  const o = req.get("Origin");
  if (ORIGINI.includes(o)) res.set("Access-Control-Allow-Origin", o);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

// chi chiama: "band", "fan" (sola lettura) oppure null
async function ruolo(req) {
  const m = (req.get("Authorization") || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const t = await getAuth().verifyIdToken(m[1]);
    const email = (t.email || "").toLowerCase();
    if (email === BAND_EMAIL) return "band";
    // per i fan si controlla anche che la sessione non sia stata revocata (password cambiata)
    if (email === FAN_EMAIL) { await getAuth().verifyIdToken(m[1], true); return "fan"; }
    return null;
  } catch (e) {
    return null;
  }
}
async function eBand(req) {
  return (await ruolo(req)) === "band";
}

async function tokenSpotify(params) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...params })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.error_description || d.error || `token ${r.status}`);
    e.codice = d.error;
    throw e;
  }
  return d;
}

async function api(token, metodo, percorso, corpo, tentativo = 0) {
  const r = await fetch("https://api.spotify.com/v1" + percorso, {
    method: metodo,
    headers: { Authorization: "Bearer " + token, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  if (r.status === 429 && tentativo < 2) {
    await attendi(Math.min(Number(r.headers.get("Retry-After")) || 2, 10) * 1000);
    return api(token, metodo, percorso, corpo, tentativo + 1);
  }
  if (r.status === 204) return {};
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`${metodo} ${percorso.split("?")[0]} → ${r.status} ${(d.error && d.error.message) || ""}`.trim());
    e.status = r.status;
    throw e;
  }
  return d;
}

// access token valido, rinnovato con il refresh token quando scade
async function accessToken(dati) {
  if (dati.access && dati.scade > Date.now() + 60000) return dati.access;
  let d;
  try {
    d = await tokenSpotify({ grant_type: "refresh_token", refresh_token: dati.refresh });
  } catch (e) {
    if (e.codice === "invalid_grant") {
      await refGenerale().set({ playlist: { errore: "Il collegamento a Spotify è scaduto: ricollegalo da Personale." } }, { merge: true });
    }
    throw e;
  }
  const upd = { access: d.access_token, scade: Date.now() + d.expires_in * 1000 };
  if (d.refresh_token) upd.refresh = d.refresh_token; // con PKCE il refresh token può cambiare a ogni rinnovo
  await refPrivato().set(upd, { merge: true });
  Object.assign(dati, upd);
  return dati.access;
}

// Ricerca del brano su Spotify: si prova in più modi e si accetta solo un risultato
// che somiglia davvero a titolo e artista (tollera piccoli errori di battitura).
// Se niente somiglia abbastanza si lascia la canzone senza link: meglio vuoto che sbagliato.
const pulisci = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s-\s.*$/, " ")
  .replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function distanza(a, b) {
  const v = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prec = v[0]; v[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = v[j];
      v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prec + (a[i - 1] === b[j - 1] ? 0 : 1));
      prec = t;
    }
  }
  return v[b.length];
}
function somiglianza(a, b) {
  a = pulisci(a); b = pulisci(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b))) return 0.9;
  return 1 - distanza(a, b) / Math.max(a.length, b.length);
}
const SOGLIA_TITOLO = 0.75, SOGLIA_ARTISTA = 0.6;
function punteggio(c, t) {
  const st = somiglianza(c.titolo, t.name);
  if (st < SOGLIA_TITOLO) return 0;
  if (!c.artista) return st;
  const sa = Math.max(0, ...(t.artists || []).map(a => somiglianza(c.artista, a.name)));
  if (sa < SOGLIA_ARTISTA) return 0;
  return st * 0.6 + sa * 0.4;
}
async function cercaBrano(token, c) {
  const prove = c.artista
    ? [`track:${c.titolo} artist:${c.artista}`, `${c.titolo} artist:${c.artista}`, `${c.titolo} ${c.artista}`]
    : [`track:${c.titolo}`, c.titolo];
  let migliore = null, best = 0;
  for (const q of prove) {
    const d = await api(token, "GET", `/search?type=track&limit=10&q=${encodeURIComponent(q)}`);
    for (const t of (d.tracks && d.tracks.items) || []) {
      const p = punteggio(c, t);
      if (p > best && t.external_urls && t.external_urls.spotify) { best = p; migliore = t; }
    }
    if (best >= 0.95) break;
  }
  if (!migliore) console.log(`[playlist] nessun brano abbastanza simile a "${c.titolo}" (${c.artista || "senza artista"})`);
  return migliore ? migliore.external_urls.spotify : null;
}

const voti = (c) => Object.values(c.reazioni || {}).filter(v => v === "up").length;
const contro = (c) => Object.values(c.reazioni || {}).filter(v => v === "down").length;
const ord = (c) => (typeof c.ordine === "number" ? c.ordine : 0);

// stesse regole dell'app: scaletta = tutto ciò che non è proposta né Generale, nell'ordine dell'app;
// proposte = dalla più votata; a parità, meno 👎; poi nell'ordine dell'app
function liste(canzoni) {
  const gen = (c) => c.id === "generale" || c.stato === "generale";
  return {
    scaletta: canzoni.filter(c => !gen(c) && c.stato !== "proposta").sort((a, b) => ord(a) - ord(b)),
    proposte: canzoni.filter(c => c.stato === "proposta").sort((a, b) => voti(b) - voti(a) || contro(a) - contro(b) || ord(a) - ord(b))
  };
}

async function scriviPlaylist(token, id, uris) {
  await api(token, "PUT", `/playlists/${id}/items`, { uris: uris.slice(0, 100) });
  for (let i = 100; i < uris.length; i += 100) {
    await api(token, "POST", `/playlists/${id}/items`, { uris: uris.slice(i, i + 100) });
  }
}

async function sincronizza({ forza = false } = {}) {
  const dati = (await refPrivato().get()).data();
  if (!dati || !dati.refresh || !dati.playlist) return { collegato: false };
  const token = await accessToken(dati);
  const canzoni = (await db().collection("canzoni").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const trovate = [], senza = [];
  const uriDi = async (c) => {
    if (c.nostro) return null;   // pezzo della band: non è su Spotify, non si cerca e non va in playlist
    let m = (c.spotifyUrl || "").match(TRACK_RE);
    if (!m && c.titolo) {
      const url = await cercaBrano(token, c).catch(e => { console.error(`[playlist] ricerca "${c.titolo}": ${e.message}`); return null; });
      if (url) {
        await db().doc(`canzoni/${c.id}`).update({ spotifyUrl: url, spotifyAuto: true });
        trovate.push(c.titolo);
        m = url.match(TRACK_RE);
      }
    }
    if (!m) { senza.push(c.titolo); return null; }
    return `spotify:track:${m[1]}`;
  };
  const l = liste(canzoni);
  const ultime = dati.ultime || {};
  const esito = { collegato: true, cambiate: [], trovate, senza };
  for (const k of ["scaletta", "proposte"]) {
    const uris = [];
    for (const c of l[k]) { const u = await uriDi(c); if (u) uris.push(u); }
    if (!forza && JSON.stringify(uris) === JSON.stringify(ultime[k] || [])) continue;
    await scriviPlaylist(token, dati.playlist[k], uris);
    await refPrivato().set({ ultime: { [k]: uris } }, { merge: true });
    esito.cambiate.push(k);
  }
  if (esito.cambiate.length) {
    await refGenerale().set({ playlist: { aggiornata: FieldValue.serverTimestamp(), errore: null } }, { merge: true });
  }
  console.log(`[playlist] aggiornate: ${esito.cambiate.join(", ") || "nessuna"}; trovate: ${trovate.length}; senza link: ${senza.join(" | ") || "—"}`);
  return esito;
}

exports.playlist = onRequest({ region: REGIONE, maxInstances: 1 }, async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!SPOTIFY_CLIENT_ID) return res.status(200).json({ error: "Spotify non è ancora configurato (manca il Client ID)." });
  if (!(await eBand(req))) return res.status(403).json({ error: "accesso negato" });
  const op = req.body && req.body.op;
  try {
    if (op === "collega") {
      const verifier = b64url(crypto.randomBytes(48));
      const state = b64url(crypto.randomBytes(16));
      await refPrivato().set({ attesa: { verifier, state, creato: Date.now() } }, { merge: true });
      const url = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
        response_type: "code",
        client_id: SPOTIFY_CLIENT_ID,
        scope: SCOPES,
        redirect_uri: CALLBACK_URL,
        code_challenge_method: "S256",
        code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
        state
      });
      return res.status(200).json({ url });
    }
    if (op === "aggiorna") {
      const esito = await inCoda(() => sincronizza({ forza: !!req.body.forza }));
      return res.status(200).json(esito);
    }
    return res.status(400).json({ error: "operazione sconosciuta" });
  } catch (e) {
    console.error(`[playlist] ${op}: ${e.message}`);
    return res.status(200).json({ error: String(e.message).slice(0, 200) });
  }
});

exports.spotifyCallback = onRequest({ region: REGIONE, maxInstances: 1 }, async (req, res) => {
  const torna = (esito, motivo) =>
    res.redirect(302, `${APP_URL}/?spotify=${esito}${motivo ? "&motivo=" + encodeURIComponent(String(motivo).slice(0, 140)) : ""}`);
  try {
    const { code, state, error } = req.query;
    if (error) return torna("annullato", error);
    const dati = (await refPrivato().get()).data() || {};
    const att = dati.attesa;
    if (!code || !att || att.state !== state || Date.now() - att.creato > 15 * 60 * 1000) {
      return torna("errore", "Richiesta scaduta: riprova da Personale.");
    }
    const t = await tokenSpotify({ grant_type: "authorization_code", code, redirect_uri: CALLBACK_URL, code_verifier: att.verifier });
    const me = await api(t.access_token, "GET", "/me");
    const utente = { id: me.id, nome: me.display_name || me.id };
    const nuovo = {
      refresh: t.refresh_token, access: t.access_token, scade: Date.now() + t.expires_in * 1000,
      utente, attesa: FieldValue.delete()
    };
    let playlist = dati.playlist;
    if (!playlist || !dati.utente || dati.utente.id !== me.id) {
      playlist = {};
      for (const k of ["scaletta", "proposte"]) {
        const p = await api(t.access_token, "POST", "/me/playlists", { name: NOMI[k], description: DESCRIZIONI[k], public: true });
        playlist[k] = p.id;
      }
      nuovo.ultime = { scaletta: [], proposte: [] };
    }
    nuovo.playlist = playlist;
    await refPrivato().set(nuovo, { merge: true });
    await refGenerale().set({
      playlist: {
        scaletta: `https://open.spotify.com/playlist/${playlist.scaletta}`,
        proposte: `https://open.spotify.com/playlist/${playlist.proposte}`,
        account: utente.nome,
        errore: null
      }
    }, { merge: true });
    await sincronizza({ forza: true });
    console.log(`[playlist] collegato l'account Spotify ${utente.id}`);
    return torna("ok");
  } catch (e) {
    console.error(`[playlist] collegamento: ${e.message}`);
    return torna("errore", e.message);
  }
});

// ============================================================
// Bot Telegram della band (riepiloghi nel gruppo): vedi telegram.js
// ============================================================
const telegram = require("./telegram");
exports.telegram = telegram.telegram;
exports.telegramOgniOra = telegram.telegramOgniOra;

// ============================================================
// Notifiche push ai telefoni della band: vedi notifiche.js
// ============================================================
exports.notifiche = require("./notifiche").crea({ cors, ruolo, REGIONE }).notifiche;
// accesso dei fan e messaggi dei fan alla band (inoltrati nel gruppo Telegram): vedi accesso.js
exports.accesso = require("./accesso").crea({
  cors, ruolo, REGIONE, FAN_EMAIL, mandaAlGruppo: telegram.mandaAlGruppo, segreti: [telegram.TELEGRAM_TOKEN]
}).accesso;
