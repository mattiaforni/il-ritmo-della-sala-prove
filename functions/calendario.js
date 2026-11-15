// ============================================================
// Cloud Function "calendario" — le prove dal calendario Google della band, in sola lettura (v70).
//
// Il calendario si legge dal suo «indirizzo segreto in formato iCal» (Google Calendar → impostazioni
// del calendario → Integra calendario). L'indirizzo lo incolla la band in Personale e resta solo qui,
// in Firestore in privato/calendario (le regole non espongono "privato"): il repo è pubblico.
//   privato/calendario  { url, nome, aggiornata, da }
//
// Operazioni (POST con l'ID token):
//   leggi   (band e fan) → { collegato, nome, prove: [{ id, inizio, fine, tuttoIlGiorno, giorno, giornoFine,
//                            titolo, luogo, note }], letto }. Prove da adesso a 180 giorni, in ordine;
//                            le ricorrenze sono espanse (eccezioni e date tolte comprese). inizio/fine in ms;
//                            per gli eventi di tutto il giorno anche giorno/giornoFine "AAAA-MM-GG" (fine esclusa).
//   stato   (band)       → { collegato, nome, aggiornata, da, prove }
//   imposta (band) { url } → controlla che si legga, salva e restituisce come "leggi"
//   togli   (band)       → scollega
// La lettura resta in memoria 5 minuti, così le aperture dell'app non scaricano ogni volta il calendario.
// ============================================================
const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const ical = require("node-ical");

const GIORNI = 180;
const MAX_PROVE = 80;
const CACHE_MS = 5 * 60 * 1000;
const ref = () => getFirestore().doc("privato/calendario");

// accetta l'indirizzo iCal di Google (anche con webcal://); niente altri siti
function normalizza(u) {
  let s = String(u || "").trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, "https://");
  let x;
  try { x = new URL(s); } catch (e) { return null; }
  if (x.protocol !== "https:" || x.hostname !== "calendar.google.com") return null;
  if (!/^\/calendar\/ical\/[^/]+\/[^/]+\/basic\.ics$/.test(x.pathname)) return null;
  return x.toString();
}

const pad = (n) => String(n).padStart(2, "0");
// gli eventi di tutto il giorno arrivano come mezzanotte locale del processo: si legge il giorno con i getter locali
const giornoDi = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const testo = (v) => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.val === "string") return v.val;
  return String(v);
};

async function scarica(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "text/calendar" } });
    if (r.status === 404) throw new Error("calendario non trovato: l'indirizzo segreto è cambiato o è sbagliato");
    if (!r.ok) throw new Error(`Google Calendar risponde ${r.status}`);
    const corpo = await r.text();
    if (!/BEGIN:VCALENDAR/.test(corpo)) throw new Error("all'indirizzo non c'è un calendario");
    return corpo;
  } finally { clearTimeout(t); }
}

function estrai(corpo, adesso = Date.now()) {
  const dati = ical.sync.parseICS(corpo);
  let nome = "";
  const da = new Date(adesso);
  const a = new Date(adesso + GIORNI * 86400000);
  const prove = [];
  for (const k of Object.keys(dati)) {
    const ev = dati[k];
    if (ev && ev.type === "VCALENDAR" && ev["WR-CALNAME"]) nome = testo(ev["WR-CALNAME"]);
    if (!ev || ev.type !== "VEVENT" || !ev.start) continue;
    if (ev.recurrenceid) continue;   // le modifiche di una singola ricorrenza le applica expandRecurringEvent
    let istanze;
    try {
      istanze = ical.expandRecurringEvent(ev, { from: da, to: a, expandOngoing: true });
    } catch (e) {
      console.warn(`[calendario] evento ${ev.uid} non espanso: ${e.message}`);
      continue;
    }
    for (const i of istanze) {
      const sorgente = i.event || ev;
      if (String(sorgente.status || "").toUpperCase() === "CANCELLED") continue;
      const inizio = i.start.getTime();
      let fine = i.end ? i.end.getTime() : inizio + (i.isFullDay ? 86400000 : 3600000);
      if (fine <= inizio) fine = inizio + (i.isFullDay ? 86400000 : 0);
      if (fine <= adesso && !(fine === inizio && inizio >= adesso)) continue;
      const p = {
        id: `${sorgente.uid || k}@${inizio}`,
        inizio, fine,
        tuttoIlGiorno: !!i.isFullDay,
        titolo: testo(i.summary || sorgente.summary).trim().slice(0, 120) || "Prova",
        luogo: testo(sorgente.location).trim().slice(0, 160),
        note: testo(sorgente.description).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim().slice(0, 600)
      };
      if (p.tuttoIlGiorno) { p.giorno = giornoDi(i.start); p.giornoFine = giornoDi(new Date(fine)); }
      prove.push(p);
    }
  }
  prove.sort((x, y) => x.inizio - y.inizio);
  return { nome, prove: prove.slice(0, MAX_PROVE) };
}

function crea({ cors, ruolo, REGIONE }) {
  let cache = null;   // { url, quando, nome, prove }

  async function leggi(url, forza = false) {
    if (!forza && cache && cache.url === url && Date.now() - cache.quando < CACHE_MS) return cache;
    const { nome, prove } = estrai(await scarica(url));
    cache = { url, quando: Date.now(), nome, prove };
    return cache;
  }
  const pubblica = (c, nomeSalvato) => ({
    collegato: true,
    nome: nomeSalvato || c.nome || "",
    // le prove già finite fra una lettura e l'altra si tolgono anche dalla copia in memoria
    prove: c.prove.filter(p => p.fine > Date.now() || p.fine === p.inizio),
    letto: c.quando
  });

  const calendario = onRequest({ region: REGIONE, maxInstances: 2, timeoutSeconds: 30 }, async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const chi = await ruolo(req);
    const b = req.body || {};
    const op = b.op || "leggi";
    if (op === "leggi" ? !chi : chi !== "band") return res.status(403).json({ error: "accesso negato" });
    try {
      const snap = await ref().get();
      const conf = snap.exists ? snap.data() : null;

      if (op === "leggi") {
        if (!conf || !conf.url) return res.status(200).json({ collegato: false, prove: [] });
        return res.status(200).json(pubblica(await leggi(conf.url), conf.nome));
      }

      if (op === "stato") {
        if (!conf || !conf.url) return res.status(200).json({ collegato: false });
        let prove = null, errore = null;
        try { prove = pubblica(await leggi(conf.url), conf.nome).prove.length; } catch (e) { errore = e.message; }
        return res.status(200).json({
          collegato: true, nome: conf.nome || "", da: conf.da || "",
          aggiornata: conf.aggiornata && conf.aggiornata.toMillis ? conf.aggiornata.toMillis() : null,
          prove, errore
        });
      }

      if (op === "imposta") {
        const url = normalizza(b.url);
        if (!url) return res.status(200).json({ error: "non è l'indirizzo iCal di un calendario Google (finisce con basic.ics)" });
        const c = await leggi(url, true);
        const da = String(b.da || "").trim().slice(0, 40);
        await ref().set({ url, nome: c.nome || "", da, aggiornata: FieldValue.serverTimestamp() });
        console.log(`[calendario] collegato «${c.nome}» da ${da || "?"}: ${c.prove.length} prove`);
        return res.status(200).json(pubblica(c, c.nome));
      }

      if (op === "togli") {
        await ref().delete();
        cache = null;
        console.log(`[calendario] scollegato da ${String(b.da || "?").slice(0, 40)}`);
        return res.status(200).json({ collegato: false, prove: [] });
      }

      return res.status(400).json({ error: "operazione sconosciuta" });
    } catch (e) {
      console.error(`[calendario] ${op}: ${e.message}`);
      return res.status(200).json({ error: e.message });
    }
  });
  return { calendario };
}

module.exports = { crea, estrai, normalizza };
