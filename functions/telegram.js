// ============================================================
// Bot Telegram della band: riepiloghi di cosa si muove nell'app.
//
//   telegram         POST da Telegram (webhook): comandi e pulsanti.
//                    GET aperto da un browser: configura il webhook subito
//                    (lo fa comunque da solo la funzione oraria).
//   telegramOgniOra  ogni ora: configura il webhook se serve, aggiorna il
//                    registro delle modifiche, manda il riepilogo automatico.
//
// Il token del bot sta nel secret TELEGRAM_TOKEN (Secret Manager), mai nel codice.
// Il bot risponde solo nel gruppo collegato con /collega (il primo e unico) e,
// in privato, solo a chi è membro di quel gruppo. Qualunque altro gruppo lo
// fa uscire subito.
//
// Dati del bot in Firestore, collezione "privato" (le regole non la espongono
// ai telefoni): privato/telegram (gruppo, impostazioni, data di inizio del
// registro), privato/telegram/eventi (voti, passaggi in scaletta, setup,
// eliminazioni, con la data in cui il bot li ha visti), privato/telegram-foto
// (l'ultima fotografia del database con cui confrontare la successiva).
//
// Fase 2 (domande libere con l'AI): leggiDati() prepara già tutto quello che
// servirebbe a Gemini; basterà passarglielo insieme alla domanda.
// ============================================================
const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const T = require("./telegram-testi");

const TELEGRAM_TOKEN = defineSecret("TELEGRAM_TOKEN");
const PROGETTO = "il-ritmo-della-sala-prove";
const REGIONE = "us-central1";
const WEBHOOK_URL = `https://${REGIONE}-${PROGETTO}.cloudfunctions.net/telegram`;
const PREDEFINITI = { ogniGiorni: 2, ora: 19 };
const CONSERVA_EVENTI = 120 * T.GIORNO;

const COMANDI = [
  { command: "novita", description: "Novità degli ultimi giorni, es. /novita 3" },
  { command: "scaletta", description: "La scaletta e cosa è pronto" },
  { command: "proposte", description: "Proposte, voti e chi deve ancora votare" },
  { command: "task", description: "Task aperti, per persona" },
  { command: "cassa", description: "Saldo e ultimi movimenti" },
  { command: "aggiornamenti", description: "Cosa c'è di nuovo nell'app" },
  { command: "menu", description: "Mostra i pulsanti" },
  { command: "automatico", description: "Riepilogo automatico, es. /automatico 2 19 oppure off" },
  { command: "vai", description: "Il bot risponde /vai" }
];

const db = () => getFirestore();
const refStato = () => db().doc("privato/telegram");
const refFoto = () => db().doc("privato/telegram-foto");
const colEventi = () => refStato().collection("eventi");
const millis = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : 0);
const impronta = (s) => crypto.createHash("sha256").update(s).digest("hex");
// chiave che Telegram rimanda a ogni chiamata del webhook: chi non la conosce non può fingersi Telegram
const segreto = () => impronta("il-ritmo-webhook:" + TELEGRAM_TOKEN.value()).slice(0, 48);
const ORA_ROMA = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" });
const oraRoma = (ms) => Number(ORA_ROMA.format(new Date(ms)));

// ---------- Telegram ----------
async function tg(metodo, corpo) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN.value()}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo || {})
  });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) {
    const e = new Error(`${metodo}: ${d.description || "HTTP " + r.status}`);
    e.codice = d.error_code || r.status;
    throw e;
  }
  return d.result;
}

async function invia(chatId, testo, { menu = true } = {}) {
  const corpo = {
    chat_id: chatId, text: testo, parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(menu ? { reply_markup: T.MENU } : {})
  };
  try {
    return await tg("sendMessage", corpo);
  } catch (e) {
    // se l'HTML non passa, meglio il testo semplice che niente
    if (e.codice !== 400 || !/parse|entit/i.test(e.message)) throw e;
    console.error(`[telegram] HTML rifiutato, invio senza formattazione: ${e.message}`);
    const semplice = testo.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    return tg("sendMessage", { ...corpo, text: semplice, parse_mode: undefined });
  }
}

// webhook e comandi: li imposta solo se mancano o se il token è cambiato
async function configura({ forza = false } = {}) {
  const st = (await refStato().get()).data() || {};
  // la firma cambia anche quando cambia l'elenco dei comandi: così la funzione oraria lo ripubblica da sola
  const firma = impronta(segreto() + JSON.stringify(COMANDI)).slice(0, 16);
  const info = await tg("getWebhookInfo");
  if (!forza && info.url === WEBHOOK_URL && st.firma === firma && st.bot) return st;
  const me = await tg("getMe");
  await tg("setWebhook", {
    url: WEBHOOK_URL, secret_token: segreto(),
    allowed_updates: ["message", "callback_query", "my_chat_member"]
  });
  await tg("setMyCommands", { commands: COMANDI });
  await refStato().set({ bot: me.username, firma }, { merge: true });
  console.log(`[telegram] webhook impostato per @${me.username}`);
  return { ...st, bot: me.username, firma };
}

// ---------- dati ----------
function inMillis(o) {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) r[k] = v && typeof v.toMillis === "function" ? v.toMillis() : v;
  return r;
}

async function leggiDati() {
  const nomi = ["canzoni", "tasks", "membri", "registrazioni", "movimenti"];
  const snaps = await Promise.all(nomi.map(n => db().collection(n).get()));
  const dati = {};
  nomi.forEach((n, i) => { dati[n] = snaps[i].docs.map(d => ({ id: d.id, ...inMillis(d.data()) })); });
  return dati;
}

async function leggiEventi(da) {
  const q = await colEventi().where("quando", ">=", Timestamp.fromMillis(da)).orderBy("quando").get();
  return q.docs.map(d => inMillis(d.data()));
}

// confronta il database con l'ultima fotografia e registra le differenze;
// in una transazione, così due esecuzioni insieme non registrano due volte la stessa cosa
async function aggiornaRegistro(dati) {
  const dopo = T.fotografa(dati);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(refFoto());
    const adesso = Timestamp.now();
    if (!snap.exists) {
      tx.set(refFoto(), { ...dopo, aggiornata: adesso });
      tx.set(refStato(), { registroDa: adesso }, { merge: true });
      return 0;
    }
    const ev = T.differenze(snap.data(), dopo).slice(0, 450);
    for (const e of ev) tx.set(colEventi().doc(), { ...e, quando: adesso });
    tx.set(refFoto(), { ...dopo, aggiornata: adesso });
    return ev.length;
  });
}

async function pulisciEventi() {
  const vecchi = await colEventi().where("quando", "<", Timestamp.fromMillis(Date.now() - CONSERVA_EVENTI)).limit(400).get();
  if (vecchi.empty) return 0;
  const b = db().batch();
  vecchi.docs.forEach(d => b.delete(d.ref));
  await b.commit();
  return vecchi.size;
}

// novità dell'app: public/novita.json, pubblicato insieme all'app (null se non si riesce a leggerlo)
async function leggiNovitaApp() {
  try {
    const r = await fetch(`${T.APP_URL}/novita.json?t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return Array.isArray(d.voci) ? d.voci : null;
  } catch (e) {
    console.error(`[telegram] novità dell'app: ${e.message}`);
    return null;
  }
}

// ---------- risposte ----------
async function testoNovita(giorni, st) {
  const a = Date.now();
  const da = a - giorni * T.GIORNO;
  const dati = await leggiDati();
  await aggiornaRegistro(dati); // così compaiono anche i voti dell'ultima ora
  dati.eventi = await leggiEventi(da);
  dati.app = await leggiNovitaApp();
  const registroDa = millis(st.registroDa) || millis(((await refStato().get()).data() || {}).registroDa);
  return T.novita(dati, { da, a, titolo: T.titoloNovita(giorni), registroDa: registroDa || null }).testo;
}

async function risposta(azione, arg, st) {
  switch (azione) {
    case "novita": {
      const n = Math.round(Number(arg));
      const giorni = n >= 1 && n <= 60 ? n : 2;
      return testoNovita(giorni, st);
    }
    case "scaletta": return T.scaletta(await leggiDati());
    case "proposte": return T.proposte(await leggiDati());
    case "task": return T.taskAperti(await leggiDati());
    case "cassa": return T.cassa(await leggiDati());
    case "aggiornamenti": return T.aggiornamentiApp(await leggiNovitaApp(), arg || 3);
    default: return T.aiuto({ ...PREDEFINITI, ...st });
  }
}

const AZIONI = {
  novita: "novita", "novità": "novita", nov: "novita", news: "novita",
  scaletta: "scaletta", proposte: "proposte", voti: "proposte",
  task: "task", tasks: "task", cassa: "cassa",
  aggiornamenti: "aggiornamenti", app: "aggiornamenti", versioni: "aggiornamenti", sviluppi: "aggiornamenti",
  menu: "menu", start: "menu", aiuto: "menu", help: "menu"
};

async function automatico(chatId, arg, st) {
  const parti = String(arg || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parti.length) return invia(chatId, T.aiuto({ ...PREDEFINITI, ...st }));
  if (["off", "no", "0", "spento", "stop"].includes(parti[0])) {
    await refStato().set({ ogniGiorni: 0 }, { merge: true });
    return invia(chatId, "Riepilogo automatico spento. Per riaccenderlo: /automatico 2 19", { menu: false });
  }
  const giorni = Math.round(Number(parti[0]));
  const ora = parti[1] != null ? Math.round(Number(parti[1])) : (st.ora ?? PREDEFINITI.ora);
  if (!(giorni >= 1 && giorni <= 14) || !(ora >= 0 && ora <= 23)) {
    return invia(chatId, "Scrivi i giorni (da 1 a 14) e, se vuoi, l'ora (da 0 a 23). Esempio: /automatico 2 19", { menu: false });
  }
  await refStato().set({ ogniGiorni: giorni, ora }, { merge: true });
  return invia(chatId, `Fatto: riepilogo automatico ogni ${giorni === 1 ? "giorno" : giorni + " giorni"} alle ${ora}, solo se nell'app si è mosso qualcosa.`, { menu: false });
}

// il nome del bot (per riconoscere i comandi /comando@nome rivolti ad altri bot)
async function nomeBot(st) {
  if (st.bot) return String(st.bot);
  const me = await tg("getMe");
  await refStato().set({ bot: me.username }, { merge: true });
  st.bot = me.username;
  return me.username;
}

async function eMembro(gruppo, utente) {
  if (!gruppo || !utente) return false;
  try {
    const m = await tg("getChatMember", { chat_id: gruppo, user_id: utente });
    return ["creator", "administrator", "member"].includes(m.status) || (m.status === "restricted" && m.is_member);
  } catch (e) {
    return false;
  }
}

// può usare il bot? nel gruppo collegato sì; in privato solo chi è nel gruppo
async function autorizzato(chat, utente, st) {
  if (!st.chatId) return false;
  if (chat.type === "private") return eMembro(st.chatId, utente);
  return Number(chat.id) === Number(st.chatId);
}

async function collega(chat, st) {
  if (chat.type === "private") {
    return invia(chat.id, "Il collegamento si fa nel gruppo della band: aggiungimi lì e scrivete /collega.", { menu: false });
  }
  if (st.chatId && Number(st.chatId) === Number(chat.id)) {
    return invia(chat.id, "Sono già collegato a questo gruppo.\n\n" + T.aiuto({ ...PREDEFINITI, ...st }));
  }
  if (st.chatId) return esci(chat.id);
  const nuovo = { ...PREDEFINITI, ...st, chatId: chat.id, chatTitolo: chat.title || "", ultimoAuto: Timestamp.now() };
  await refStato().set({
    chatId: chat.id, chatTitolo: chat.title || "",
    ogniGiorni: nuovo.ogniGiorni, ora: nuovo.ora, ultimoAuto: nuovo.ultimoAuto
  }, { merge: true });
  console.log(`[telegram] collegato al gruppo ${chat.id}`);
  return invia(chat.id, "Collegato al gruppo della band.\n\n" + T.aiuto(nuovo));
}

async function esci(chatId) {
  console.log(`[telegram] gruppo non autorizzato ${chatId}: esco`);
  await invia(chatId, "Questo bot è riservato al gruppo di una band e non può restare qui.", { menu: false }).catch(() => {});
  await tg("leaveChat", { chat_id: chatId }).catch(() => {});
}

async function gestisci(u) {
  const st = (await refStato().get()).data() || {};

  // aggiunto o tolto da un gruppo
  if (u.my_chat_member) {
    const { chat, new_chat_member: nm } = u.my_chat_member;
    if (chat.type === "private") return;
    const dentro = ["member", "administrator"].includes(nm && nm.status);
    if (dentro && !st.chatId) {
      return invia(chat.id, "Ciao! Per collegarmi a questo gruppo scrivete /collega. Dopo il collegamento risponderò solo qui.", { menu: false });
    }
    if (dentro && Number(st.chatId) !== Number(chat.id)) return esci(chat.id);
    if (!dentro && Number(st.chatId) === Number(chat.id)) {
      // tolto dal gruppo della band: si potrà ricollegare con /collega
      await refStato().set({ chatId: null, chatTitolo: "" }, { merge: true });
      console.log(`[telegram] tolto dal gruppo ${chat.id}: collegamento azzerato`);
    }
    return;
  }

  // pulsanti
  if (u.callback_query) {
    const cq = u.callback_query;
    const chat = cq.message && cq.message.chat;
    if (!chat || !(await autorizzato(chat, cq.from && cq.from.id, st))) {
      return tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Non disponibile qui." }).catch(() => {});
    }
    await tg("answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
    const [azione, arg] = String(cq.data || "").split(":");
    console.log(`[telegram] pulsante ${azione}${arg ? " " + arg : ""}`);
    return invia(chat.id, await risposta(AZIONI[azione] || "menu", arg, st));
  }

  // messaggi
  const msg = u.message;
  if (!msg || !msg.chat) return;
  const chat = msg.chat;
  // un gruppo che diventa supergruppo cambia numero: lo seguo
  if (msg.migrate_to_chat_id && Number(chat.id) === Number(st.chatId)) {
    await refStato().set({ chatId: msg.migrate_to_chat_id }, { merge: true });
    return;
  }
  const m = String(msg.text || "").match(/^\/([\p{L}_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/u);
  if (!m) return; // per ora il bot risponde solo ai comandi
  const [, comando, destinatario, arg] = m;
  if (destinatario && destinatario.toLowerCase() !== (await nomeBot(st)).toLowerCase()) return; // comando per un altro bot
  const cmd = comando.toLowerCase();

  if (cmd === "collega") return collega(chat, st);
  if (!(await autorizzato(chat, msg.from && msg.from.id, st))) {
    if (chat.type === "private") {
      return invia(chat.id, "Questo bot risponde solo ai membri del gruppo della band.", { menu: false });
    }
    if (!st.chatId) return invia(chat.id, "Non sono ancora collegato: scrivete /collega.", { menu: false });
    return esci(chat.id);
  }
  console.log(`[telegram] comando /${cmd}`);
  if (cmd === "automatico") return automatico(chat.id, arg, st);
  if (cmd === "vai") return invia(chat.id, "/vai", { menu: false });
  if (!AZIONI[cmd]) return; // comandi di altri bot o sconosciuti: silenzio
  return invia(chat.id, await risposta(AZIONI[cmd], arg, st));
}

// ---------- riepilogo automatico ----------
async function riepilogoAutomatico(dati, adesso) {
  const st = { ...PREDEFINITI, ...((await refStato().get()).data() || {}) };
  if (!st.chatId || !(st.ogniGiorni > 0)) return "spento o non collegato";
  if (oraRoma(adesso) !== Number(st.ora)) return "non è l'ora";
  const ultimo = millis(st.ultimoAuto);
  if (ultimo && adesso - ultimo < st.ogniGiorni * T.GIORNO - 3 * T.ORA) return "troppo presto";
  const da = ultimo || adesso - st.ogniGiorni * T.GIORNO;
  // il periodo arriva fino a questo momento, così entrano anche le modifiche appena registrate
  const fine = Math.max(adesso, Date.now());
  dati.eventi = await leggiEventi(da);
  dati.app = await leggiNovitaApp();
  const r = T.novita(dati, { da, a: fine, titolo: `Riepilogo dal ${T.giorno(da)}`, registroDa: millis(st.registroDa) || null });
  // prima si segna, poi si manda: un errore non deve produrre un doppio invio
  await refStato().set({ ultimoAuto: Timestamp.fromMillis(fine) }, { merge: true });
  if (r.vuoto) return "niente di nuovo";
  await invia(st.chatId, r.testo);
  return "inviato";
}

// ---------- funzioni esportate ----------
exports.telegram = onRequest(
  { region: REGIONE, secrets: [TELEGRAM_TOKEN], maxInstances: 2, timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method === "GET") {
      try {
        const st = await configura({ forza: true });
        return res.status(200).type("text/plain; charset=utf-8").send(
          `Bot @${st.bot} configurato.\n` +
          (st.chatId ? "È già collegato al gruppo della band." : "Ora aggiungilo al gruppo della band e scrivete /collega."));
      } catch (e) {
        console.error(`[telegram] configurazione: ${e.message}`);
        return res.status(500).type("text/plain; charset=utf-8").send(
          "Configurazione non riuscita: controlla che il secret TELEGRAM_TOKEN contenga il token dato da @BotFather.");
      }
    }
    if (req.method !== "POST") return res.status(405).send("");
    if (req.get("X-Telegram-Bot-Api-Secret-Token") !== segreto()) return res.status(403).send("");
    try {
      await gestisci(req.body || {});
    } catch (e) {
      console.error(`[telegram] ${e.message}`);
    }
    // sempre 200: altrimenti Telegram riprova a mandare lo stesso aggiornamento
    return res.status(200).send("ok");
  }
);

exports.telegramOgniOra = onSchedule(
  { schedule: "0 * * * *", timeZone: "Europe/Rome", region: REGIONE, secrets: [TELEGRAM_TOKEN], retryCount: 0, timeoutSeconds: 120 },
  async () => {
    const adesso = Date.now();
    try { await configura(); } catch (e) { console.error(`[telegram] configurazione: ${e.message}`); }
    let dati;
    try {
      dati = await leggiDati();
      const n = await aggiornaRegistro(dati);
      if (n) console.log(`[telegram] registro: ${n} modifiche`);
    } catch (e) {
      console.error(`[telegram] registro: ${e.message}`);
      return;
    }
    try { await pulisciEventi(); } catch (e) { console.error(`[telegram] pulizia: ${e.message}`); }
    try {
      const esito = await riepilogoAutomatico(dati, adesso);
      if (esito === "inviato" || esito === "niente di nuovo") console.log(`[telegram] riepilogo automatico: ${esito}`);
    } catch (e) {
      console.error(`[telegram] riepilogo automatico: ${e.message}`);
    }
  }
);

// per le prove
exports._interni = { gestisci, riepilogoAutomatico, aggiornaRegistro, leggiDati, segreto, WEBHOOK_URL, leggiNovitaApp };
