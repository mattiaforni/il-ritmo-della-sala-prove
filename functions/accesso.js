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
//                 Post e commenti dei fan li scrive questa funzione (op "messaggio"), con
//                 "fanId" (id del telefono del fan, lo stesso dei mi piace: serve alle
//                 notifiche); la band scrive e toglie direttamente; i "mi piace" li scrivono tutti.
//   canzoni/*     dalla v43 i fan propongono (op "proposta": stato "proposta", daFan, fanId,
//                 propostaDa = nome del fan) e votano (op "voto": campo votiFan,
//                 { <fanId>: { voto: "up" | "down", nome, il } }, un voto per telefono). Ogni voto
//                 vale uno, come quelli della band (campo reazioni, chiavi = nomi della band).
//   commenti/*    dalla v43 commenti alle registrazioni { su: "registrazione", rifId, nome, band,
//                 fanId, testo, creato, piace }: quelli dei fan li scrive questa funzione (op "commento").
//
// La password resta leggibile alla band (serve a mandare l'invito a chi arriva
// dopo). "generazione" cresce a ogni cambio o disattivazione: le iscrizioni alle
// notifiche fatte con una password vecchia non ricevono più niente.
// Cambiando la password le sessioni aperte vengono revocate: le richieste alle
// funzioni sono rifiutate subito, il database smette di rispondere entro un'ora.
//
// I messaggi dei fan in bacheca finiscono anche nel gruppo Telegram della band,
// se il bot è collegato (vedi telegram.js), e fanno partire la notifica push
// "bacheca" (vedi notifiche.js): la band la segnala dall'app, i fan da qui.
// Allo stesso modo le proposte dei fan ("proposta") e i loro commenti alle registrazioni
// ("commento"); proposte e voti dei fan riallineano anche la playlist Proposte di Spotify.
// ============================================================
const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const refFan = () => getFirestore().doc("privato/fan");
const bacheca = () => getFirestore().collection("bacheca");
const ms = (t) => (t && t.toMillis ? t.toMillis() : typeof t === "number" ? t : null);
const MAX_MESSAGGI_ORA = 20;            // tutti i fan insieme: oltre, si aspetta
const MAX_COMMENTI_ORA = 30;            // commenti alle registrazioni, tutti i fan insieme
const MAX_PROPOSTE_SETTIMANA = 3;       // per telefono
const MAX_PROPOSTE_ORA = 10;            // tutti i fan insieme
const MAX_VOTI_ORA = 300;               // tutti i fan insieme (conteggio in memoria: c'è un'istanza sola)
const SETTIMANA = 7 * 24 * 3600 * 1000;
const FAN_OP = ["messaggio", "proposta", "voto", "commento"];
// per riconoscere i doppioni: minuscole, senza accenti, punteggiatura e parentesi ("(Remastered)")
const normale = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/&/g, " e ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^(the|il|lo|la|i|gli|le) /, "");
const stessoPezzo = (a, b) => normale(a.titolo) === normale(b.titolo) &&
  (!normale(a.artista) || !normale(b.artista) || normale(a.artista) === normale(b.artista));
let votiRecenti = [];                   // istanti dei voti dei fan nell'ultima ora
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

const pulisciId = (v) => (typeof v === "string" ? v.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) : "") || null;

function crea({ cors, ruolo, REGIONE, FAN_EMAIL, mandaAlGruppo = null, notifica = null, aggiornaPlaylist = null, segreti = [] }) {
  const db = () => getFirestore();
  const manda = async (ev) => {
    if (!notifica) return;
    try { await notifica(ev); } catch (e) { console.warn(`[accesso] notifica ${ev.tipo} non mandata: ${e.message}`); }
  };
  // la playlist Proposte segue i voti: dopo una proposta o un voto dei fan si riallinea (al massimo 6 s di attesa)
  const playlist = async () => {
    if (!aggiornaPlaylist) return;
    try { await Promise.race([aggiornaPlaylist(), new Promise(r => setTimeout(r, 6000))]); }
    catch (e) { console.warn(`[accesso] playlist non aggiornata: ${e.message}`); }
  };
  const accesso = onRequest({ region: REGIONE, maxInstances: 1, secrets: segreti }, async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const chi = await ruolo(req);
    const b = req.body || {};
    // i fan pubblicano in bacheca, propongono, votano e commentano le registrazioni; il resto è della band
    if (FAN_OP.includes(b.op) ? chi !== "fan" : chi !== "band") return res.status(403).json({ error: "accesso negato" });
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
        const fanId = pulisciId(b.fanId);
        const ref = await bacheca().add({ nome: da || "Fan", testo, band: false, creato: FieldValue.serverTimestamp(), ...(fanId ? { fanId } : {}), ...(postId ? { postId } : {}) });
        await manda({ tipo: "bacheca", id: ref.id, da });
        let telegram = false;
        if (mandaAlGruppo) {
          const dove = post ? ` commenta il post di ${escHtml(post.nome || "un fan")}` : " in bacheca";
          try { telegram = await mandaAlGruppo(`💬 <b>${escHtml(da || "Un fan")}</b>${dove}:\n<blockquote>${escHtml(testo)}</blockquote>`); }
          catch (e) { console.warn(`[accesso] messaggio non inoltrato su Telegram: ${e.message}`); }
        }
        console.log(`[accesso] ${post ? "commento" : "post"} da ${da || "?"} (${testo.length} caratteri, Telegram: ${telegram ? "sì" : "no"})`);
        return res.status(200).json({ ok: true });
      }

      if (b.op === "proposta") {
        const fanId = pulisciId(b.fanId);
        if (!fanId) return res.status(200).json({ error: "aggiorna l'app e riprova" });
        const titolo = typeof b.titolo === "string" ? b.titolo.trim().replace(/\s+/g, " ").slice(0, 80) : "";
        const artista = typeof b.artista === "string" ? b.artista.trim().replace(/\s+/g, " ").slice(0, 60) : "";
        if (!titolo) return res.status(200).json({ error: "manca il titolo" });
        const tutte = (await db().collection("canzoni").get()).docs.map(d => ({ id: d.id, ...d.data() }));
        // c'è già (anche in scaletta): niente doppione, l'app la mostra
        const gia = tutte.find(c => c.id !== "generale" && c.stato !== "generale" && stessoPezzo(c, { titolo, artista }));
        if (gia) return res.status(200).json({ gia: { id: gia.id, titolo: gia.titolo || "", stato: gia.stato || "" } });
        const ora = Date.now();
        const quando = (c) => ms(c.creato) || 0;
        const mie = tutte.filter(c => c.daFan && c.fanId === fanId && ora - quando(c) < SETTIMANA);
        if (mie.length >= MAX_PROPOSTE_SETTIMANA) {
          return res.status(200).json({ error: `hai già proposto ${MAX_PROPOSTE_SETTIMANA} canzoni questa settimana: riprova fra qualche giorno` });
        }
        if (tutte.filter(c => c.daFan && ora - quando(c) < 3600 * 1000).length >= MAX_PROPOSTE_ORA) {
          return res.status(200).json({ error: "troppe proposte in poco tempo, riprova più tardi" });
        }
        const ordine = tutte.reduce((m, c) => Math.max(m, typeof c.ordine === "number" ? c.ordine : 0), 0) + 1;
        const ref = await db().collection("canzoni").add({
          titolo, artista, stato: "proposta", ordine, spotifyUrl: "", reazioni: {}, votiFan: {},
          propostaDa: da || "Fan", daFan: true, fanId, creato: FieldValue.serverTimestamp()
        });
        console.log(`[accesso] proposta da ${da || "?"} (fan): ${titolo}${artista ? " · " + artista : ""}`);
        await manda({ tipo: "proposta", canzoneId: ref.id, da });
        await playlist();
        return res.status(200).json({ ok: true, id: ref.id });
      }

      if (b.op === "voto") {
        const fanId = pulisciId(b.fanId);
        if (!fanId) return res.status(200).json({ error: "aggiorna l'app e riprova" });
        const voto = b.voto === "up" || b.voto === "down" ? b.voto : null;
        const ref = typeof b.canzoneId === "string" && b.canzoneId ? db().collection("canzoni").doc(b.canzoneId) : null;
        const s = ref ? await ref.get() : null;
        if (!s || !s.exists || s.data().stato !== "proposta") return res.status(200).json({ error: "la proposta non c'è più" });
        const ora = Date.now();
        votiRecenti = votiRecenti.filter(t => ora - t < 3600 * 1000);
        if (votiRecenti.length >= MAX_VOTI_ORA) return res.status(200).json({ error: "troppi voti in poco tempo, riprova più tardi" });
        votiRecenti.push(ora);
        const campo = new FieldPath("votiFan", fanId);
        if (voto) await ref.update(campo, { voto, nome: da || "Fan", il: FieldValue.serverTimestamp() });
        else await ref.update(campo, FieldValue.delete());
        await playlist();
        return res.status(200).json({ ok: true });
      }

      if (b.op === "commento") {
        // commento a una registrazione (la collezione è generica: "su" dice a cosa si riferisce)
        const fanId = pulisciId(b.fanId);
        const rifId = typeof b.rifId === "string" && b.rifId ? b.rifId : null;
        const testo = typeof b.testo === "string" ? b.testo.trim().slice(0, 300) : "";
        if (!testo) return res.status(200).json({ error: "commento vuoto" });
        const rs = rifId ? await db().collection("registrazioni").doc(rifId).get() : null;
        if (!rs || !rs.exists) return res.status(200).json({ error: "la registrazione non c'è più" });
        const recenti = await db().collection("commenti").where("creato", ">", new Date(Date.now() - 3600 * 1000)).get();
        if (recenti.docs.filter(d => !d.data().band).length >= MAX_COMMENTI_ORA) return res.status(200).json({ error: "troppi commenti in poco tempo, riprova più tardi" });
        const ref = await db().collection("commenti").add({
          su: "registrazione", rifId, nome: da || "Fan", band: false, testo, piace: {},
          ...(fanId ? { fanId } : {}), creato: FieldValue.serverTimestamp()
        });
        console.log(`[accesso] commento a una registrazione da ${da || "?"} (${testo.length} caratteri)`);
        await manda({ tipo: "commento", id: ref.id, da });
        return res.status(200).json({ ok: true, id: ref.id });
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

module.exports = { crea, generazioneFan, _interni: { stato, normale, stessoPezzo } };
