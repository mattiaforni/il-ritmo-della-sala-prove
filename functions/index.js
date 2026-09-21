// ============================================================
// Cloud Function "spotifyLink" — trova il link Spotify di una canzone
// Raggiunta dal client come /api/spotify-link (rewrite in firebase.json).
// La chiave Gemini vive in un Secret di Firebase (mai nel codice client):
//   firebase functions:secrets:set GEMINI_API_KEY
// Usa Gemini con grounding su Google Search, così il link è trovato
// davvero sul web e non "immaginato" dal modello.
// ============================================================
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

exports.spotifyLink = onRequest(
  { region: "us-central1", secrets: [GEMINI_API_KEY], maxInstances: 3 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const key = GEMINI_API_KEY.value();
    if (!key) return res.status(200).json({ url: null, note: "Secret GEMINI_API_KEY non configurato" });

    const { titolo, artista } = req.body || {};
    if (!titolo) return res.status(400).json({ error: "titolo mancante" });

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const q = `${titolo}${artista ? " di " + artista : ""}`;
    const prompt =
      `Cerca su Google la pagina Spotify della canzone "${q}". ` +
      `Rispondi SOLO con l'URL completo che inizia con https://open.spotify.com/track/ ` +
      `(o /intl-it/track/). Se non la trovi con certezza rispondi solo: NONE.`;

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0 }
          })
        }
      );
      const data = await r.json();
      const text = (data?.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || "").join(" ");
      const m = text.match(/https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]+/);
      return res.status(200).json({ url: m ? m[0] : null });
    } catch (e) {
      return res.status(200).json({ url: null, error: String(e) });
    }
  }
);
