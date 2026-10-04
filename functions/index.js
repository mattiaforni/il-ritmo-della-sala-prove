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
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

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
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

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
