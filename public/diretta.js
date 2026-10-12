// ============================================================
// Diretta dalla sala
// Il computer della sala trasmette quello che entra dal mixer (lo stesso ingresso
// che registra GarageBand); i telefoni ascoltano. L'audio va da dispositivo a
// dispositivo (WebRTC): Firestore, collezione "diretta", serve solo a farli incontrare.
//
// Documenti in "diretta":
//   stato            { attiva, sessione, da, inizio, battito }  — scritto dal computer che trasmette
//   ascolto-<id>     { tipo: "ascolto", sessione, chi, offer, answer, creato } — uno per ogni ascoltatore
//
// Scambio senza "trickle": ogni parte aspetta di aver raccolto i propri indirizzi e li
// scrive tutti insieme, così bastano due scritture per ascoltatore.
// ============================================================
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const STATO_ID = "stato";
const ICE = [{ urls: "stun:stun.l.google.com:19302" }];
const BATTITO_MS = 60 * 1000;     // il computer conferma ogni minuto di essere in onda
const SCADENZA_MS = 3 * 60 * 1000; // senza conferme da 3 minuti la diretta si considera chiusa
const BITRATE = 128000;           // Opus stereo a 128 kbps: qualità musica, non telefonata
const ATTESA_RISPOSTA_MS = 20000;
const CHIAVE_INGRESSO = "prove_diretta_ingresso";

export function creaDiretta({ db, toast, utente, esc, iniTag, isMobile, isIOS, alAvvio, primaDiAscoltare, ripristinaComandi }) {
  const supportata = typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const audioEl = document.getElementById("diretta-audio");
  const d = {
    docs: [], ready: false, negata: false, ultimoHtml: "",
    // trasmissione (computer della sala)
    stream: null, sessione: null, pcs: new Map(), battito: null, avvio: false,
    ingressi: [], ingresso: leggi(CHIAVE_INGRESSO),
    meter: null,
    // ascolto (telefoni)
    ascolto: null,   // { id, sessione, pc, stato: "connessione"|"in-ascolto"|"tocca"|"errore", msg, tentativi }
  };

  function leggi(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function scrivi(k, v) { try { localStorage.setItem(k, v); } catch {} }
  const rnd = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const ms = (t) => t?.toMillis ? t.toMillis() : 0;

  // ---------- stato condiviso ----------
  const statoDoc = () => d.docs.find(x => x.id === STATO_ID) || null;
  function inOnda() {
    const s = statoDoc();
    if (!s || !s.attiva || !s.sessione) return null;
    if (Date.now() - ms(s.battito) > SCADENZA_MS) return null;
    return s;
  }
  const trasmettoIo = () => !!d.sessione;
  const ascoltatori = () => d.docs.filter(x => x.tipo === "ascolto" && d.sessione && x.sessione === d.sessione);

  function subscribe() {
    if (!supportata) return;
    onSnapshot(collection(db, "diretta"), snap => {
      d.docs = snap.docs.map(x => ({ id: x.id, ...x.data({ serverTimestamps: "estimate" }) }));
      d.ready = true; d.negata = false;
      controllaTrasmissione();
      controllaAscolto();
      render();
    }, err => {
      // prima che la regola del database includa "diretta" arriva un rifiuto:
      // niente barra rossa per tutta l'app, solo un avviso nella scheda
      console.warn("[diretta]", err);
      d.ready = true;
      d.negata = err && err.code === "permission-denied";
      render();
    });
    // la scadenza della diretta va ricontrollata anche senza nuovi dati
    setInterval(() => { controllaAscolto(); render(); }, 30000);
    window.addEventListener("pagehide", () => {
      if (d.sessione) updateDoc(doc(db, "diretta", STATO_ID), { attiva: false }).catch(() => {});
      if (d.ascolto) deleteDoc(doc(db, "diretta", d.ascolto.id)).catch(() => {});
    });
  }

  // ---------- Opus stereo ad alta qualità ----------
  // Aggiunge stereo e bitrate ai parametri di Opus nella descrizione della connessione.
  // Si può applicare più volte senza effetti doppi.
  function opusStereo(sdp) {
    const m = sdp.match(/a=rtpmap:(\d+) opus\/48000(?:\/2)?/i);
    if (!m) return sdp;
    const pt = m[1];
    const voluti = { stereo: "1", "sprop-stereo": "1", maxaveragebitrate: String(BITRATE), useinbandfec: "1" };
    const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
    if (re.test(sdp)) {
      return sdp.replace(re, (_, params) => {
        const p = {};
        params.split(";").map(s => s.trim()).filter(Boolean).forEach(s => {
          const i = s.indexOf("=");
          p[i < 0 ? s : s.slice(0, i)] = i < 0 ? "" : s.slice(i + 1);
        });
        Object.assign(p, voluti);
        return `a=fmtp:${pt} ` + Object.entries(p).map(([k, v]) => v === "" ? k : `${k}=${v}`).join(";");
      });
    }
    return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ` + Object.entries(voluti).map(([k, v]) => `${k}=${v}`).join(";"));
  }
  function iceCompleto(pc, max = 3000) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(res => {
      const t = setTimeout(fine, max);
      function fine() { clearTimeout(t); pc.removeEventListener("icegatheringstatechange", ch); res(); }
      function ch() { if (pc.iceGatheringState === "complete") fine(); }
      pc.addEventListener("icegatheringstatechange", ch);
    });
  }
  async function impostaLocale(pc, desc) {
    try { await pc.setLocalDescription({ type: desc.type, sdp: opusStereo(desc.sdp) }); }
    catch (e) { console.warn("[diretta] descrizione modificata rifiutata, uso quella originale", e); await pc.setLocalDescription(desc); }
  }

  // ---------- trasmissione: il computer della sala ----------
  async function cattura(deviceId) {
    const audio = {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 }
    };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...audio, deviceId: { exact: deviceId } } : audio, video: false });
    } catch (e) {
      // l'ingresso scelto l'ultima volta non c'è più (es. mixer staccato): si usa quello predefinito
      if (deviceId && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) return cattura(null);
      throw e;
    }
  }
  async function elencaIngressi() {
    try {
      const tutti = await navigator.mediaDevices.enumerateDevices();
      d.ingressi = tutti.filter(x => x.kind === "audioinput" && x.deviceId);
    } catch { d.ingressi = []; }
    const attuale = d.stream?.getAudioTracks()[0]?.getSettings?.().deviceId;
    if (attuale) d.ingresso = attuale;
  }
  function erroreMicrofono(e) {
    const n = e && e.name;
    return n === "NotAllowedError" ? "Il browser non ha il permesso di usare l'ingresso audio: consentilo per questo sito e riprova."
      : n === "NotFoundError" ? "Nessun ingresso audio trovato: il mixer è collegato?"
      : n === "NotReadableError" ? "L'ingresso audio non si apre: forse è occupato in modo esclusivo da un'altra app."
      : `Diretta non avviata (${n || e?.message || "errore"}).`;
  }

  async function avvia() {
    if (d.avvio || d.sessione) return;
    d.avvio = true; render();
    try {
      d.stream = await cattura(d.ingresso);
      await elencaIngressi();
      if (d.ingresso) scrivi(CHIAVE_INGRESSO, d.ingresso);
      const sessione = rnd();
      // via gli ascoltatori rimasti da dirette precedenti
      const batch = writeBatch(db);
      d.docs.filter(x => x.tipo === "ascolto").forEach(x => batch.delete(doc(db, "diretta", x.id)));
      batch.set(doc(db, "diretta", STATO_ID), {
        attiva: true, sessione, da: utente() || "", inizio: serverTimestamp(), battito: serverTimestamp()
      });
      await batch.commit();
      // solo adesso questo dispositivo "trasmette": prima della scrittura lo stato
      // nel database è ancora quello vecchio e non va scambiato per un'altra diretta
      d.sessione = sessione;
      d.battito = setInterval(() => {
        updateDoc(doc(db, "diretta", STATO_ID), { battito: serverTimestamp() }).catch(e => console.warn("[diretta] battito", e));
      }, BATTITO_MS);
      avviaMeter();
      controllaTrasmissione();
      toast("Diretta avviata: i telefoni possono ascoltare dalla sezione Audio.");
      if (alAvvio) alAvvio();   // notifica a chi l'ha chiesta
    } catch (e) {
      console.error("[diretta]", e);
      fermaLocale();
      toast(e && e.code === "permission-denied" ? "Il database non accetta ancora la diretta: va aggiornata la regola (vedi README)." : erroreMicrofono(e));
    } finally {
      d.avvio = false; render();
    }
  }
  function fermaLocale() {
    clearInterval(d.battito); d.battito = null;
    d.pcs.forEach(pc => { try { pc.close(); } catch {} });
    d.pcs.clear();
    d.stream?.getTracks().forEach(t => t.stop());
    d.stream = null; d.sessione = null;
    fermaMeter();
  }
  async function ferma() {
    const sessione = d.sessione;
    const vecchi = d.docs.filter(x => x.tipo === "ascolto");
    fermaLocale();
    render();
    if (!sessione) return;
    const batch = writeBatch(db);
    vecchi.forEach(x => batch.delete(doc(db, "diretta", x.id)));
    batch.set(doc(db, "diretta", STATO_ID), { attiva: false, fine: serverTimestamp() }, { merge: true });
    await batch.commit().catch(e => console.warn("[diretta] chiusura", e));
  }

  // a ogni cambiamento dei dati: risponde ai nuovi ascoltatori, chiude chi se n'è andato
  function controllaTrasmissione() {
    if (!d.sessione) return;
    const s = statoDoc();
    if (s && s.sessione && s.sessione !== d.sessione && s.attiva) {
      // un altro dispositivo ha avviato la diretta: questo smette
      fermaLocale();
      toast("La diretta è passata a un altro dispositivo.");
      return;
    }
    const presenti = new Set();
    ascoltatori().forEach(a => {
      presenti.add(a.id);
      if (a.offer && !a.answer && !d.pcs.has(a.id)) rispondi(a);
    });
    [...d.pcs.keys()].forEach(id => {
      if (!presenti.has(id)) { try { d.pcs.get(id).close(); } catch {} d.pcs.delete(id); }
    });
  }
  async function rispondi(a) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    d.pcs.set(a.id, pc);
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") { try { pc.close(); } catch {} }
      render();
    });
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: opusStereo(a.offer) });
      const tr = pc.getTransceivers().find(t => t.receiver.track.kind === "audio");
      const traccia = d.stream?.getAudioTracks()[0];
      if (!tr || !traccia) throw new Error("niente audio da inviare");
      tr.direction = "sendonly";
      await tr.sender.replaceTrack(traccia);
      try { tr.sender.setStreams?.(d.stream); } catch {}
      await impostaLocale(pc, await pc.createAnswer());
      await iceCompleto(pc);
      try {
        const p = tr.sender.getParameters();
        if (p.encodings && p.encodings.length) { p.encodings[0].maxBitrate = BITRATE; await tr.sender.setParameters(p); }
      } catch {}
      await updateDoc(doc(db, "diretta", a.id), { answer: pc.localDescription.sdp });
    } catch (e) {
      console.warn("[diretta] ascoltatore non collegato", a.id, e);
      try { pc.close(); } catch {}
    }
  }
  async function cambiaIngresso(id) {
    d.ingresso = id;
    scrivi(CHIAVE_INGRESSO, id);
    if (!d.stream) return;
    try {
      const nuovo = await cattura(id);
      const traccia = nuovo.getAudioTracks()[0];
      for (const pc of d.pcs.values()) {
        for (const s of pc.getSenders()) { try { await s.replaceTrack(traccia); } catch {} }
      }
      d.stream.getTracks().forEach(t => t.stop());
      d.stream = nuovo;
      await elencaIngressi();
      avviaMeter();
    } catch (e) { toast(erroreMicrofono(e)); }
    render();
  }

  // indicatore di livello: per vedere che il segnale del mixer arriva davvero
  function avviaMeter() {
    fermaMeter();
    if (!d.stream) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(d.stream).connect(an); // non va agli altoparlanti: niente ritorno
      const buf = new Float32Array(an.fftSize);
      let picco = 0;
      const giro = () => {
        an.getFloatTimeDomainData(buf);
        let max = 0;
        for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > max) max = v; }
        picco = Math.max(max, picco * 0.92);
        const dbfs = picco > 0 ? 20 * Math.log10(picco) : -60;
        const el = document.getElementById("dir-meter");
        if (el) {
          el.style.width = Math.max(0, Math.min(100, (dbfs + 60) / 60 * 100)) + "%";
          el.classList.toggle("clip", dbfs > -1);
        }
        d.meter.raf = requestAnimationFrame(giro);
      };
      d.meter = { ctx, raf: requestAnimationFrame(giro) };
      ctx.resume?.().catch(() => {});
    } catch (e) { console.warn("[diretta] indicatore di livello", e); }
  }
  function fermaMeter() {
    if (!d.meter) return;
    cancelAnimationFrame(d.meter.raf);
    d.meter.ctx.close?.().catch(() => {});
    d.meter = null;
  }

  // ---------- ascolto a schermo bloccato ----------
  // Con lo schermo spento il telefono ferma l'audio di una pagina che non "sta riproducendo"
  // niente: per lui una connessione WebRTC non è una riproduzione. Un file quasi muto in loop
  // (−84 dB, non si sente), con titolo e comandi sullo schermo bloccato, fa risultare la pagina
  // in riproduzione e la tiene sveglia mentre arriva l'audio della diretta.
  const veglia = new Audio("silenzio.wav");
  veglia.loop = true;
  veglia.preload = "none";
  function comandiDiretta() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({
        title: "Diretta dalla sala", artist: "Il ritmo della sala prove",
        artwork: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }]
      });
      ms.playbackState = "playing";
    } catch (e) { /* browser senza supporto */ }
    const prova = (azione, fn) => { try { ms.setActionHandler(azione, fn); } catch (e) { /* azione non supportata */ } };
    prova("pause", () => smetti());
    prova("stop", () => smetti());
    prova("play", () => { veglia.play().catch(() => {}); audioEl.play().catch(() => {}); });
    prova("seekbackward", null); prova("seekforward", null); prova("seekto", null);
  }
  function tieniSveglio() {
    veglia.play().catch(() => {});
    comandiDiretta();
  }
  function lasciaDormire() {
    veglia.pause();
    try { veglia.currentTime = 0; } catch (e) { /* non ancora caricato */ }
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = "none"; } catch (e) { /* niente */ }
    }
    if (ripristinaComandi) ripristinaComandi();
  }
  // se il telefono ha messo in pausa l'audio passando in secondo piano, si riprova a farlo ripartire
  document.addEventListener("visibilitychange", () => {
    if (!d.ascolto || !audioEl.srcObject) return;
    if (audioEl.paused) audioEl.play().catch(() => {});
    if (veglia.paused) veglia.play().catch(() => {});
  });

  // ---------- ascolto: i telefoni ----------
  async function ascolta(tentativi = 0) {
    const s = inOnda();
    if (!s) return;
    smettiLocale(true);
    if (primaDiAscoltare) primaDiAscoltare();
    // va chiamato subito, nel tocco: sblocca la riproduzione su iPhone e su alcuni Android
    audioEl.play().catch(() => {});
    tieniSveglio();
    const id = "ascolto-" + rnd();
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const a = { id, sessione: s.sessione, pc, stato: "connessione", msg: "", tentativi };
    d.ascolto = a;
    render();
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.addEventListener("track", e => {
      audioEl.srcObject = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      audioEl.play()
        .then(() => { if (d.ascolto === a) { a.stato = "in-ascolto"; render(); } })
        .catch(() => { if (d.ascolto === a) { a.stato = "tocca"; render(); } });
    });
    pc.addEventListener("connectionstatechange", () => {
      if (d.ascolto !== a) return;
      if (pc.connectionState === "failed") {
        if (a.tentativi < 2 && inOnda()) { setTimeout(() => { if (d.ascolto === a) ascolta(a.tentativi + 1); }, 2000); }
        else { a.stato = "errore"; a.msg = "Collegamento con il computer della sala non riuscito."; render(); }
      }
    });
    try {
      await impostaLocale(pc, await pc.createOffer());
      await iceCompleto(pc);
      if (d.ascolto !== a) return;
      await setDoc(doc(db, "diretta", id), {
        tipo: "ascolto", sessione: s.sessione, chi: utente() || "", offer: pc.localDescription.sdp, creato: serverTimestamp()
      });
      setTimeout(() => {
        if (d.ascolto === a && !pc.remoteDescription) {
          a.stato = "errore"; a.msg = "Il computer della sala non risponde: la pagina della diretta è ancora aperta lassù?";
          render();
        }
      }, ATTESA_RISPOSTA_MS);
    } catch (e) {
      console.error("[diretta]", e);
      if (d.ascolto === a) { a.stato = "errore"; a.msg = "Non riesco a collegarmi alla diretta."; render(); }
    }
  }
  function smettiLocale(tieniAudio) {
    const a = d.ascolto;
    if (!a) return;
    d.ascolto = null;
    try { a.pc.close(); } catch {}
    deleteDoc(doc(db, "diretta", a.id)).catch(() => {});
    if (!tieniAudio) { audioEl.pause(); audioEl.srcObject = null; lasciaDormire(); }
  }
  function smetti() { smettiLocale(false); render(); }
  // a ogni cambiamento dei dati: arriva la risposta del computer, oppure la diretta finisce o ricomincia
  function controllaAscolto() {
    const a = d.ascolto;
    if (!a) return;
    const s = inOnda();
    if (!s) { smettiLocale(false); toast("La diretta è finita."); return; }
    if (s.sessione !== a.sessione) { ascolta(); return; }  // il computer ha riavviato la diretta
    const mio = d.docs.find(x => x.id === a.id);
    if (mio && mio.answer && !a.pc.remoteDescription && a.pc.signalingState === "have-local-offer") {
      a.pc.setRemoteDescription({ type: "answer", sdp: mio.answer }).catch(e => {
        console.error("[diretta]", e);
        a.stato = "errore"; a.msg = "Risposta del computer della sala non valida."; render();
      });
    }
  }

  // ---------- interfaccia ----------
  function quando(t) {
    const m = ms(t);
    return m ? new Date(m).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
  }
  function htmlScheda() {
    if (!supportata) return `<article class="card dircard"><h3 class="sec-title">Diretta dalla sala</h3><p class="dir-txt">Questo browser non supporta la diretta.</p></article>`;
    if (!d.ready) return "";
    if (d.negata) {
      return `<article class="card dircard"><h3 class="sec-title">Diretta dalla sala</h3>
        <p class="dir-txt">Il database non accetta ancora la diretta: va aggiornata una volta la regola di Firestore (istruzioni nel README del progetto).</p></article>`;
    }
    const s = inOnda();

    if (trasmettoIo()) {
      const n = ascoltatori();
      const collegati = n.filter(x => d.pcs.get(x.id)?.connectionState === "connected");
      const opzioni = d.ingressi.map((x, i) =>
        `<option value="${esc(x.deviceId)}"${x.deviceId === d.ingresso ? " selected" : ""}>${esc(x.label || `Ingresso ${i + 1}`)}</option>`).join("");
      return `
      <article class="card dircard live">
        <h3 class="sec-title"><span class="onair">In onda</span> Diretta dalla sala <small>dalle ${esc(quando(statoDoc()?.inizio))}</small></h3>
        <div class="dir-meter" aria-hidden="true"><i id="dir-meter"></i></div>
        <label class="dir-lbl">Ingresso
          <select class="field" data-change="dir-ingresso" aria-label="Ingresso audio da trasmettere">${opzioni || `<option>Ingresso predefinito</option>`}</select></label>
        <p class="dir-txt">${collegati.length
          ? `In ascolto: ${collegati.map(x => x.chi ? iniTag(x.chi) : `<span class="ini none">?</span>`).join("")}`
          : n.length ? "Un telefono si sta collegando…" : "Nessuno in ascolto per ora."}</p>
        <p class="dir-txt small">Tieni aperta questa pagina finché suonate: GarageBand registra normalmente dallo stesso ingresso.</p>
        <div class="dir-actions"><button class="btn fill" data-action="dir-ferma">Ferma la diretta</button></div>
      </article>`;
    }

    if (s) {
      const a = d.ascolto;
      let corpo, bottoni;
      if (!a) {
        corpo = `${s.da ? esc(s.da) + " trasmette" : "La sala trasmette"} dalle ${esc(quando(s.inizio))}.`;
        bottoni = `<button class="btn fill" data-action="dir-ascolta">▶ Ascolta</button>`;
      } else if (a.stato === "connessione") {
        corpo = "Collegamento alla sala…";
        bottoni = `<button class="btn quiet" data-action="dir-smetti">Annulla</button>`;
      } else if (a.stato === "in-ascolto") {
        corpo = "In ascolto. Il volume si regola con i tasti del telefono.";
        bottoni = `<button class="btn fill" data-action="dir-smetti">❚❚ Smetti</button>`;
      } else if (a.stato === "tocca") {
        corpo = "Il telefono aspetta un tocco per far partire l'audio.";
        bottoni = `<button class="btn fill" data-action="dir-riproduci">▶ Avvia l'audio</button><button class="btn quiet" data-action="dir-smetti">Smetti</button>`;
      } else {
        corpo = esc(a.msg || "Qualcosa non ha funzionato.");
        bottoni = `<button class="btn fill" data-action="dir-ascolta">Riprova</button><button class="btn quiet" data-action="dir-smetti">Chiudi</button>`;
      }
      return `
      <article class="card dircard live">
        <h3 class="sec-title"><span class="onair">In onda</span> Diretta dalla sala</h3>
        <p class="dir-txt">${corpo}</p>
        ${isIOS ? `<p class="dir-txt small">Su iPhone l'audio si ferma se si blocca lo schermo o si cambia app.</p>` : ""}
        <div class="dir-actions">${bottoni}</div>
      </article>`;
    }

    if (isMobile) {
      return `<article class="card dircard spenta"><p class="dir-txt">Diretta dalla sala: <b>spenta</b>. Si avvia dal computer della sala.</p></article>`;
    }
    return `
      <article class="card dircard">
        <h3 class="sec-title">Diretta dalla sala</h3>
        <p class="dir-txt">Manda ai telefoni quello che entra dal mixer, mentre GarageBand registra. Chi è di sotto ascolta dalla sezione Audio dell'app.</p>
        <div class="dir-actions"><button class="btn fill" data-action="dir-avvia" ${d.avvio ? "disabled" : ""}>${d.avvio ? "Avvio…" : "Avvia la diretta"}</button></div>
      </article>`;
  }
  function render() {
    document.querySelector('.tab[data-tab="audio"]')?.classList.toggle("live", !!inOnda());
    const box = document.getElementById("diretta-box");
    if (!box) return;
    const html = htmlScheda();
    // stesso contenuto: non si ridisegna (non chiude la tendina dell'ingresso)
    if (html === d.ultimoHtml && box.innerHTML) return;
    d.ultimoHtml = html;
    box.innerHTML = html;
  }

  function azione(nome) {
    switch (nome) {
      case "dir-avvia": avvia(); break;
      case "dir-ferma": ferma(); break;
      case "dir-ascolta": ascolta(); break;
      case "dir-smetti": smetti(); break;
      case "dir-riproduci":
        veglia.play().catch(() => {});
        audioEl.play()
          .then(() => { if (d.ascolto) { d.ascolto.stato = "in-ascolto"; render(); } })
          .catch(() => toast("Il telefono non fa partire l'audio."));
        break;
    }
  }
  // la scheda viene ricreata da renderAudio: va riscritta anche se il contenuto è lo stesso
  function ridisegna() { d.ultimoHtml = ""; render(); }

  return { subscribe, render: ridisegna, azione, cambiaIngresso };
}
