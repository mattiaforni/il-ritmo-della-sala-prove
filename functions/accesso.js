// ============================================================
// Accesso dei fan: un secondo account condiviso, in sola lettura.
//
// La band (e solo la band) imposta, cambia o disattiva la password dei fan
// dalla pagina Personale. L'account è fan@il-ritmo-della-sala-prove.web.app:
// le regole di Firestore gli lasciano leggere scaletta, proposte, task,
// registrazioni, diretta e bacheca (non la cassa) e scrivere solo la propria
// richiesta di ascolto della diretta. Il nome del fan sta solo sul suo telefono.
//
//   privato/fan   { attivo, password, generazione, aggiornata, da }
//   bacheca/*     post { nome, testo, band, creato, piace } e commenti (in più postId).
//                 Post e commenti dei fan li scrive questa funzione (op "messaggio");
//                 la band scrive e toglie direttamente; i "mi piace" li scrivono tutti.
//
// La password resta leggibile alla band (serve a mandare l'invito a chi arriva
// dopo). "generazione" cresce a ogni cambio o disattivazione: le iscrizioni alle
// notifiche fatte con una password vecchia non ricevono più niente.
// Cambiando la password le sessioni aperte vengono revocate: le richieste alle
// funzioni sono rifiutate subito, il database smette di rispondere entro un'ora.
//
// I messaggi dei fan in bacheca finiscono anche nel gruppo Telegram della band,
// se il bot è collegato (vedi telegram.js).
// ============================================================
const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const refFan = () => getFirestore().doc("privato/fan");
const bacheca = () => getFirestore().collection("bacheca");
const ms = (t) => (t && t.toMillis ? t.toMillis() : typeof t === "number" ? t : null);
const MAX_MESSAGGI_ORA = 20;            // tutti i fan insieme: oltre, si aspetta
const escHtml = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function utenteFan(email) {
  try { return await getAuth().getUserByEmail(email); }
  catch (e) { if (e.code === "auth/user-not-found") return null; throw e; }
}

async function stato(email) {
  const [snap, u] = await Promise.all([refFan().get(), utenteFan(email)]);
  const d = snap.exists ? snap.data() : {};
  const attivo = !!(d.attivo && u && !u.disabled);
  return { attivo, password: attivo ? (d.password || "") : "", aggiornata: ms(d.aggiornata), da: d.da || "" };
}

// generazione corrente delle iscrizioni dei fan (null = accesso spento)
async function generazioneFan() {
  const s = await refFan().get();
  const d = s.exists ? s.data() : null;
  return d && d.attivo ? (d.generazione || 1) : null;
}

function crea({ cors, ruolo, REGIONE, FAN_EMAIL, mandaAlGruppo = null, segreti = [] }) {
  const accesso = onRequest({ region: REGIONE, maxInstances: 1, secrets: segreti }, async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const chi = await ruolo(req);
    const b = req.body || {};
    // i fan possono solo pubblicare in bacheca; tutto il resto è della band
    if (b.op === "messaggio" ? chi !== "fan" : chi !== "band") return res.status(403).json({ error: "accesso negato" });
    const da = String(b.da || "").trim().replace(/\s+/g, " ").slice(0, 40);
    try {
      if (b.op === "stato") return res.status(200).json(await stato(FAN_EMAIL));

      if (b.op === "messaggio") {
        // un post, oppure un commento a un post esistente (postId)
        const postId = typeof b.postId === "string" && b.postId ? b.postId : null;
        const testo = typeof b.testo === "string" ? b.testo.trim().slice(0, postId ? 300 : 500) : "";
        if (!testo) return res.status(200).json({ error: "messaggio vuoto" });
        let post = null;
        if (postId) {
          const ps = await bacheca().doc(postId).get();
          post = ps.exists ? ps.data() : null;
          if (!post || post.postId) return res.status(200).json({ error: "il post non c'è più" });
        }
        // limite per tutti i fan insieme (si contano solo i loro, la band non ha limiti)
        const recenti = await bacheca().where("creato", ">", new Date(Date.now() - 3600 * 1000)).get();
        if (recenti.docs.filter(d => !d.data().band).length >= MAX_MESSAGGI_ORA) return res.status(200).json({ error: "troppi messaggi in poco tempo, riprova più tardi" });
        await bacheca().add({ nome: da || "Fan", testo, band: false, creato: FieldValue.serverTimestamp(), ...(postId ? { postId } : {}) });
        let telegram = false;
        if (mandaAlGruppo) {
          const dove = post ? ` commenta il post di ${escHtml(post.nome || "un fan")}` : " in bacheca";
          try { telegram = await mandaAlGruppo(`💬 <b>${escHtml(da || "Un fan")}</b>${dove}:\n<blockquote>${escHtml(testo)}</blockquote>`); }
          catch (e) { console.warn(`[accesso] messaggio non inoltrato su Telegram: ${e.message}`); }
        }
        console.log(`[accesso] ${post ? "commento" : "post"} da ${da || "?"} (${testo.length} caratteri, Telegram: ${telegram ? "sì" : "no"})`);
        return res.status(200).json({ ok: true });
      }

      if (b.op === "imposta") {
        const pw = typeof b.password === "string" ? b.password.trim() : "";
        if (pw.length < 6 || pw.length > 64) return res.status(200).json({ error: "la password deve avere da 6 a 64 caratteri" });
        const u = await utenteFan(FAN_EMAIL);
        if (u) {
          await getAuth().updateUser(u.uid, { password: pw, disabled: false });
          await getAuth().revokeRefreshTokens(u.uid);
        } else {
          await getAuth().createUser({ email: FAN_EMAIL, password: pw, displayName: "Fan", emailVerified: false });
        }
        const s = await refFan().get();
        const gen = ((s.exists && s.data().generazione) || 0) + 1;
        await refFan().set({ attivo: true, password: pw, generazione: gen, aggiornata: FieldValue.serverTimestamp(), da }, { merge: true });
        console.log(`[accesso] password dei fan ${u ? "cambiata" : "creata"} da ${da || "?"} (generazione ${gen})`);
        return res.status(200).json(await stato(FAN_EMAIL));
      }

      if (b.op === "disattiva") {
        const u = await utenteFan(FAN_EMAIL);
        if (u) {
          await getAuth().updateUser(u.uid, { disabled: true });
          await getAuth().revokeRefreshTokens(u.uid);
        }
        const s = await refFan().get();
        const gen = ((s.exists && s.data().generazione) || 0) + 1;
        await refFan().set({ attivo: false, password: FieldValue.delete(), generazione: gen, aggiornata: FieldValue.serverTimestamp(), da }, { merge: true });
        console.log(`[accesso] accesso dei fan disattivato da ${da || "?"}`);
        return res.status(200).json(await stato(FAN_EMAIL));
      }
      return res.status(400).json({ error: "operazione sconosciuta" });
    } catch (e) {
      console.error(`[accesso] ${b.op}: ${e.code || ""} ${e.message}`);
      const msg = e.code === "auth/invalid-password" ? "password non accettata da Firebase (almeno 6 caratteri)" : String(e.message).slice(0, 200);
      return res.status(200).json({ error: msg });
    }
  });
  return { accesso };
}

module.exports = { crea, generazioneFan, _interni: { stato } };
