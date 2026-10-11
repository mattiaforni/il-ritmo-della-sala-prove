// ============================================================
// Notifiche push dell'app (Web Push standard, senza Firebase Cloud Messaging).
//
// Ogni telefono che attiva le notifiche si iscrive con la sua "subscription"
// del browser; l'iscrizione è legata alla persona (id in "membri") e agli
// eventi scelti. Tutto sta in Firestore sotto privato/push, che le regole non
// espongono ai telefoni: scrive e legge solo questa funzione.
//
//   privato/push                  { vapid: { publicKey, privateKey }, ultimi: { <evento>: ms } }
//   privato/push/iscrizioni/<id>  { sub, membroId, eventi[], aggiornata, ua }
//
// Le chiavi VAPID (che firmano le notifiche) si creano da sole alla prima
// richiesta: nessun segreto da impostare a mano.
//
// Gli eventi li segnala l'app di chi fa l'azione (op "evento"); il testo della
// notifica lo scrive la funzione leggendo il database, non il telefono.
// ============================================================
const crypto = require("crypto");
const webpush = require("web-push");
const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const EVENTI = ["proposta", "task", "registrazione", "diretta", "scaletta"];
const RIPETIZIONE_MS = { diretta: 15 * 60 * 1000 };   // la stessa diretta non si annuncia due volte
const RIPETIZIONE_STANDARD_MS = 10 * 60 * 1000;      // stesso evento sulla stessa cosa: una volta ogni 10 minuti
const TTL = 6 * 60 * 60;                              // una notifica non consegnata dopo 6 ore si butta

const db = () => getFirestore();
const refPush = () => db().doc("privato/push");
const iscrizioni = () => refPush().collection("iscrizioni");
const idIscrizione = (endpoint) => crypto.createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 40);
const virgolette = (t) => `«${t}»`;
const FMT_GIORNO = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "Europe/Rome" });
const giorno = (iso) => {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return y ? FMT_GIORNO.format(new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12))) : "";
};

async function chiavi() {
  const snap = await refPush().get();
  const v = snap.exists && snap.data().vapid;
  if (v && v.publicKey && v.privateKey) return v;
  const nuove = webpush.generateVAPIDKeys();
  // se due richieste arrivano insieme vince la prima scritta
  return db().runTransaction(async (tx) => {
    const s = await tx.get(refPush());
    const gia = s.exists && s.data().vapid;
    if (gia && gia.publicKey) return gia;
    tx.set(refPush(), { vapid: { ...nuove, creata: Date.now() } }, { merge: true });
    return nuove;
  });
}

function subValida(sub) {
  return sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint) &&
    sub.keys && typeof sub.keys.p256dh === "string" && typeof sub.keys.auth === "string";
}
const soloEventi = (lista) => (Array.isArray(lista) ? lista : EVENTI).filter(e => EVENTI.includes(e));

async function membri() {
  const snap = await db().collection("membri").get();
  return snap.docs.map(d => ({ id: d.id, nome: (d.data().nome || "").trim() }));
}

// testo, destinatari (null = tutti) e chiave per non ripetere
async function preparaEvento(corpo, persone) {
  const tipo = corpo.tipo;
  const da = String(corpo.da || "").trim();
  const idDa = (persone.find(p => p.nome === da) || {}).id || null;
  const canzone = async (id) => {
    if (!id || typeof id !== "string") return null;
    const s = await db().collection("canzoni").doc(id).get();
    return s.exists ? { id: s.id, ...s.data() } : null;
  };
  const conArtista = (c) => virgolette(c.titolo || "Senza titolo") + (c.artista ? ` (${c.artista})` : "");

  if (tipo === "proposta") {
    const c = await canzone(corpo.canzoneId);
    if (!c || c.stato !== "proposta") return null;
    const chi = c.propostaDa || da;
    return {
      chiave: `proposta:${c.id}`, idDa: (persone.find(p => p.nome === chi) || {}).id || idDa,
      titolo: "Nuova proposta da votare",
      testo: `${chi ? chi + " ha proposto" : "Proposta"} ${conArtista(c)}`,
      url: "./?vai=proposte", tag: `proposta-${c.id}`
    };
  }
  if (tipo === "scaletta") {
    const c = await canzone(corpo.canzoneId);
    if (!c || c.stato === "proposta") return null;
    return {
      chiave: `scaletta:${c.id}`, idDa,
      titolo: `In scaletta: ${c.titolo || "una proposta"}`,
      testo: `${conArtista(c)} è passata dalle proposte alla scaletta${da ? ` (l'ha spostata ${da})` : ""}.`,
      url: `./?vai=canzone&id=${encodeURIComponent(c.id)}`, tag: `scaletta-${c.id}`
    };
  }
  if (tipo === "task") {
    if (!corpo.taskId || typeof corpo.taskId !== "string") return null;
    const s = await db().collection("tasks").doc(corpo.taskId).get();
    if (!s.exists) return null;
    const t = s.data();
    const nomi = (t.assegnatari || []).filter(n => n !== da);
    const ids = persone.filter(p => nomi.includes(p.nome)).map(p => p.id);
    if (!ids.length) return null;
    const c = t.canzoneId === "generale" ? null : await canzone(t.canzoneId);
    const dove = t.canzoneId === "generale" ? "Generale" : (c ? virgolette(c.titolo || "") : "");
    return {
      chiave: `task:${s.id}`, idDa, soloA: ids,
      titolo: "Ti hanno assegnato una task",
      testo: `${dove ? dove + ": " : ""}${t.titolo || ""}${da ? ` · da ${da}` : ""}`,
      url: `./?vai=canzone&id=${encodeURIComponent(t.canzoneId || "generale")}`, tag: `task-${s.id}`
    };
  }
  if (tipo === "registrazione") {
    const ids = (Array.isArray(corpo.ids) ? corpo.ids : []).filter(x => typeof x === "string").slice(0, 20);
    if (!ids.length) return null;
    const snaps = await Promise.all(ids.map(id => db().collection("registrazioni").doc(id).get()));
    const regs = snaps.filter(s => s.exists).map(s => ({ id: s.id, ...s.data() }));
    if (!regs.length) return null;
    const chi = regs[0].caricatoDa || da;
    let testo;
    if (regs.length === 1) {
      const r = regs[0];
      const c = await canzone(r.canzoneId);
      const nome = c ? c.titolo : (r.etichetta || "Registrazione");
      testo = [nome, c && r.etichetta ? r.etichetta : "", giorno(r.data)].filter(Boolean).join(" · ");
    } else {
      const giorni = [...new Set(regs.map(r => giorno(r.data)).filter(Boolean))];
      testo = `${regs.length} registrazioni${giorni.length === 1 ? " del " + giorni[0] : ""}`;
    }
    return {
      chiave: `registrazione:${regs.map(r => r.id).sort().join(",")}`, idDa: (persone.find(p => p.nome === chi) || {}).id || idDa,
      titolo: regs.length === 1 ? "Nuova registrazione" : "Nuove registrazioni",
      testo: testo + (chi ? ` · ${regs.length === 1 ? "caricata" : "caricate"} da ${chi}` : ""),
      url: "./?vai=audio", tag: "registrazioni"
    };
  }
  if (tipo === "diretta") {
    const s = await db().collection("diretta").doc("stato").get();
    const st = s.exists ? s.data() : null;
    if (!st || !st.attiva) return null;
    const chi = st.da || da;
    return {
      chiave: "diretta", idDa: (persone.find(p => p.nome === chi) || {}).id || idDa,
      titolo: "La sala è in onda",
      testo: `${chi ? chi + " ha avviato" : "È partita"} la diretta: apri Audio per ascoltare.`,
      url: "./?vai=audio", tag: "diretta"
    };
  }
  return null;
}

async function invia(ev, tipo, persone) {
  const esistenti = new Set(persone.map(p => p.id));
  const snap = await iscrizioni().get();
  const dest = snap.docs.filter(d => {
    const x = d.data();
    if (!soloEventi(x.eventi).includes(tipo)) return false;
    if (!esistenti.has(x.membroId)) return false;
    if (ev.idDa && x.membroId === ev.idDa) return false;          // chi fa l'azione non la riceve
    if (ev.soloA && !ev.soloA.includes(x.membroId)) return false;
    return true;
  });
  if (!dest.length) return { inviate: 0, tolte: 0 };
  const v = await chiavi();
  const payload = JSON.stringify({ titolo: ev.titolo, testo: ev.testo, url: ev.url, tag: ev.tag });
  let inviate = 0, tolte = 0;
  await Promise.all(dest.map(async (d) => {
    try {
      await webpush.sendNotification(d.data().sub, payload, {
        TTL, urgency: "high",
        vapidDetails: { subject: "https://il-ritmo-della-sala-prove.web.app", publicKey: v.publicKey, privateKey: v.privateKey }
      });
      inviate++;
    } catch (e) {
      // iscrizione scaduta o revocata dal telefono: si toglie
      if (e.statusCode === 404 || e.statusCode === 410) { await d.ref.delete().catch(() => {}); tolte++; }
      else console.warn(`[notifiche] invio a ${d.id}: ${e.statusCode || ""} ${e.message}`);
    }
  }));
  return { inviate, tolte };
}

async function evento(corpo) {
  const tipo = corpo && corpo.tipo;
  if (!EVENTI.includes(tipo)) return { inviate: 0, motivo: "evento sconosciuto" };
  const persone = await membri();
  const ev = await preparaEvento(corpo, persone);
  if (!ev) return { inviate: 0, motivo: "niente da notificare" };
  // non ripetere lo stesso evento (es. due tocchi di fila, diretta riavviata)
  const attesa = RIPETIZIONE_MS[tipo] || RIPETIZIONE_STANDARD_MS;
  const libero = await db().runTransaction(async (tx) => {
    const s = await tx.get(refPush());
    const ultimi = (s.exists && s.data().ultimi) || {};
    const ora = Date.now();
    if (ultimi[ev.chiave] && ora - ultimi[ev.chiave] < attesa) return false;
    // tiene solo gli ultimi giorni
    const puliti = Object.fromEntries(Object.entries(ultimi).filter(([, t]) => ora - t < 3 * 24 * 3600 * 1000));
    puliti[ev.chiave] = ora;
    tx.set(refPush(), { ultimi: puliti }, { merge: true });
    return true;
  });
  if (!libero) return { inviate: 0, motivo: "già inviata" };
  const esito = await invia(ev, tipo, persone);
  console.log(`[notifiche] ${ev.chiave}: inviate ${esito.inviate}, tolte ${esito.tolte}`);
  return esito;
}

function crea({ cors, eBand, REGIONE }) {
  const notifiche = onRequest({ region: REGIONE, maxInstances: 2 }, async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    if (!(await eBand(req))) return res.status(403).json({ error: "accesso negato" });
    const b = req.body || {};
    try {
      if (b.op === "chiave") {
        const v = await chiavi();
        return res.status(200).json({ publicKey: v.publicKey });
      }
      if (b.op === "iscrivi") {
        if (!subValida(b.sub)) return res.status(400).json({ error: "iscrizione non valida" });
        const persone = await membri();
        if (!persone.some(p => p.id === b.membroId)) return res.status(400).json({ error: "persona sconosciuta" });
        await iscrizioni().doc(idIscrizione(b.sub.endpoint)).set({
          sub: { endpoint: b.sub.endpoint, keys: { p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth } },
          membroId: b.membroId, eventi: soloEventi(b.eventi),
          ua: String(req.get("User-Agent") || "").slice(0, 160), aggiornata: FieldValue.serverTimestamp()
        });
        return res.status(200).json({ ok: true });
      }
      if (b.op === "preferenze") {
        const ref = iscrizioni().doc(idIscrizione(b.endpoint));
        const s = await ref.get();
        if (!s.exists) return res.status(200).json({ error: "iscrizione non trovata" });
        await ref.update({ eventi: soloEventi(b.eventi), aggiornata: FieldValue.serverTimestamp() });
        return res.status(200).json({ ok: true });
      }
      if (b.op === "disiscrivi") {
        if (b.endpoint) await iscrizioni().doc(idIscrizione(b.endpoint)).delete();
        return res.status(200).json({ ok: true });
      }
      if (b.op === "evento") {
        return res.status(200).json(await evento(b));
      }
      return res.status(400).json({ error: "operazione sconosciuta" });
    } catch (e) {
      console.error(`[notifiche] ${b.op}: ${e.message}`);
      return res.status(200).json({ error: String(e.message).slice(0, 200) });
    }
  });
  return { notifiche };
}

module.exports = { crea, _interni: { preparaEvento, evento, invia, chiavi, idIscrizione, EVENTI } };
