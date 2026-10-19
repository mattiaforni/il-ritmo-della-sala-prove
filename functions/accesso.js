// ============================================================
// Accesso degli amici: un secondo account condiviso, in sola lettura.
//
// La band (e solo la band) imposta, cambia o disattiva la password degli amici
// dalla pagina Personale. L'account è amici@il-ritmo-della-sala-prove.web.app:
// le regole di Firestore gli lasciano leggere tutto e scrivere solo la propria
// richiesta di ascolto della diretta.
//
//   privato/amici  { attivo, password, generazione, aggiornata, da }
//
// La password resta leggibile alla band (serve a mandare l'invito a chi arriva
// dopo). "generazione" cresce a ogni cambio o disattivazione: le iscrizioni alle
// notifiche fatte con una password vecchia non ricevono più niente.
// Cambiando la password le sessioni aperte vengono revocate: le richieste alle
// funzioni sono rifiutate subito, il database smette di rispondere entro un'ora.
// ============================================================
const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const refAmici = () => getFirestore().doc("privato/amici");
const ms = (t) => (t && t.toMillis ? t.toMillis() : typeof t === "number" ? t : null);

async function utenteAmici(email) {
  try { return await getAuth().getUserByEmail(email); }
  catch (e) { if (e.code === "auth/user-not-found") return null; throw e; }
}

async function stato(email) {
  const [snap, u] = await Promise.all([refAmici().get(), utenteAmici(email)]);
  const d = snap.exists ? snap.data() : {};
  const attivo = !!(d.attivo && u && !u.disabled);
  return { attivo, password: attivo ? (d.password || "") : "", aggiornata: ms(d.aggiornata), da: d.da || "" };
}

// generazione corrente delle iscrizioni degli amici (null = accesso spento)
async function generazioneAmici() {
  const s = await refAmici().get();
  const d = s.exists ? s.data() : null;
  return d && d.attivo ? (d.generazione || 1) : null;
}

function crea({ cors, ruolo, REGIONE, AMICI_EMAIL }) {
  const accesso = onRequest({ region: REGIONE, maxInstances: 1 }, async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    if ((await ruolo(req)) !== "band") return res.status(403).json({ error: "accesso negato" });
    const b = req.body || {};
    const da = String(b.da || "").trim().slice(0, 40);
    try {
      if (b.op === "stato") return res.status(200).json(await stato(AMICI_EMAIL));

      if (b.op === "imposta") {
        const pw = typeof b.password === "string" ? b.password.trim() : "";
        if (pw.length < 6 || pw.length > 64) return res.status(200).json({ error: "la password deve avere da 6 a 64 caratteri" });
        const u = await utenteAmici(AMICI_EMAIL);
        if (u) {
          await getAuth().updateUser(u.uid, { password: pw, disabled: false });
          await getAuth().revokeRefreshTokens(u.uid);
        } else {
          await getAuth().createUser({ email: AMICI_EMAIL, password: pw, displayName: "Amici", emailVerified: false });
        }
        const s = await refAmici().get();
        const gen = ((s.exists && s.data().generazione) || 0) + 1;
        await refAmici().set({ attivo: true, password: pw, generazione: gen, aggiornata: FieldValue.serverTimestamp(), da }, { merge: true });
        console.log(`[accesso] password degli amici ${u ? "cambiata" : "creata"} da ${da || "?"} (generazione ${gen})`);
        return res.status(200).json(await stato(AMICI_EMAIL));
      }

      if (b.op === "disattiva") {
        const u = await utenteAmici(AMICI_EMAIL);
        if (u) {
          await getAuth().updateUser(u.uid, { disabled: true });
          await getAuth().revokeRefreshTokens(u.uid);
        }
        const s = await refAmici().get();
        const gen = ((s.exists && s.data().generazione) || 0) + 1;
        await refAmici().set({ attivo: false, password: FieldValue.delete(), generazione: gen, aggiornata: FieldValue.serverTimestamp(), da }, { merge: true });
        console.log(`[accesso] accesso degli amici disattivato da ${da || "?"}`);
        return res.status(200).json(await stato(AMICI_EMAIL));
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

module.exports = { crea, generazioneAmici, _interni: { stato } };
