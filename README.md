# PROVE — micro task manager delle prove (tutto su Firebase)

App web (PWA installabile) per gestire la scaletta della band: canzoni con link Spotify, task per canzone assegnabili a più persone, barre di avanzamento e vista per persona. Login Google obbligatorio; il nome "di band" con cui firmi i task lo scegli al primo ingresso.

**Stack, tutto in un pannello:** Firebase Hosting (l'app), Firestore (dati realtime), Authentication (login Google), Cloud Functions (la funzione che chiede a Gemini di trovare il link Spotify). Deploy con un solo comando: `firebase deploy`.

⚠️ **Prerequisito che Vercel non aveva:** le Cloud Functions richiedono il piano **Blaze** (pagamento a consumo). A questi volumi resta di fatto a costo zero — il free tier di Functions è 2 milioni di invocazioni/mese — ma serve registrare una carta. È il prezzo del pannello unico.

## Struttura

```
prove-firebase/
├── firebase.json        ← hosting + rewrite /api/spotify-link → funzione
├── .firebaserc          ← ID del progetto (da compilare)
├── public/              ← l'app (HTML, JS, CSS, icone, service worker)
│   └── config.js        ← configurazione Firebase (da compilare)
└── functions/
    └── index.js         ← Cloud Function spotifyLink (Gemini + Google Search)
```

## 1. Configura il progetto Firebase (≈10 minuti)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Crea un progetto** (es. `sala-prove`).

2. **Firestore** — Crea (Build) → *Firestore Database* → Crea database → località `eur3 (europe-west)` → modalità produzione. Tab **Regole**, incolla e pubblica:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{collection}/{doc} {
         allow read, write: if request.auth != null
           && collection in ['canzoni', 'tasks', 'membri'];
       }
     }
   }
   ```

   Variante più stretta (solo la band, non qualunque account Google): sostituisci la prima condizione con

   ```
   request.auth.token.email in [
     'tu@gmail.com', 'membro2@gmail.com', 'membro3@gmail.com',
     'membro4@gmail.com', 'membro5@gmail.com'
   ]
   ```

3. **Authentication** — Crea → *Authentication* → Inizia → *Metodo di accesso* → abilita **Google** → Salva. (I domini `*.web.app` e `*.firebaseapp.com` del progetto sono già autorizzati: nessun passaggio extra, a differenza di Vercel.)

4. **Piano Blaze** — in basso a sinistra nella console: *Esegui l'upgrade* → Blaze → collega/crea un account di fatturazione. Consigliato: imposta un budget con avviso (es. 5 €) da Google Cloud → Fatturazione → Budget, così se qualcosa andasse storto lo sai subito.

5. **App web** — Panoramica → icona **`</>`** → registra l'app (puoi spuntare "Configura anche Firebase Hosting", ma non è necessario) → copia `firebaseConfig` → incollalo in **`public/config.js`**.

6. **ID progetto** — apri **`.firebaserc`** e sostituisci `INCOLLA_QUI_ID_PROGETTO` con l'ID del progetto (lo vedi in Impostazioni progetto, es. `sala-prove-a1b2c`).

## 2. Deploy (dal terminale, una volta sola il setup)

Serve Node.js. Poi:

```bash
npm install -g firebase-tools
firebase login

cd prove-firebase
firebase functions:secrets:set GEMINI_API_KEY   # incolla la chiave da aistudio.google.com/apikey
cd functions && npm install && cd ..

firebase deploy
```

Il primo deploy delle functions impiega qualche minuto (abilita da solo le API necessarie). Alla fine ti stampa l'URL: `https://<id-progetto>.web.app`.

Per gli aggiornamenti futuri: modifichi i file → `firebase deploy` (oppure `firebase deploy --only hosting` se hai toccato solo l'app, è questione di secondi).

**GitHub facoltativo ma consigliato:** tieni comunque la cartella in un repo per il versionamento. Se vuoi il deploy automatico a ogni push come su Vercel: `firebase init hosting:github` configura la GitHub Action da solo (vale per l'hosting; le functions le deployi tu con `firebase deploy --only functions` quando le tocchi).

## 3. Installala sui telefoni

Manda l'URL nel gruppo, ognuno fa login col proprio Google e poi:
- **Android (Chrome):** menu ⋮ → *Aggiungi a schermata Home / Installa app*
- **iPhone (Safari):** Condividi → *Aggiungi alla schermata Home*

Nota iOS: nella PWA installata il popup di login a volte è capriccioso; l'app ripiega da sola sul redirect. Se non parte, primo login in Safari e poi installazione.

## Come funziona il link Spotify

- Aggiunta una canzone, l'app chiama in background `/api/spotify-link`; il rewrite in `firebase.json` la instrada alla Cloud Function `spotifyLink`. Gemini cerca su Google la pagina `open.spotify.com/track/...` e, se la trova con certezza, il link compare da solo sull'icona ▶ verde dopo qualche secondo, su tutti i telefoni.
- Se non trova nulla (o il secret manca), l'icona resta semitrasparente e apre la **ricerca** Spotify con titolo+artista: funziona comunque, un tap in più.
- La chiave vive in un **Secret** di Firebase, mai nel codice che scaricano i browser. La funzione gira in `us-central1`: è la regione più affidabile per i rewrite dell'Hosting, e la latenza è irrilevante visto che lavora in background.
- Onestà tecnica: il grounding rende il link affidabile ma non infallibile (titoli ambigui, cover). L'alternativa deterministica è l'API ufficiale Spotify (gratuita, app su developer.spotify.com) — integrabile in seguito nella stessa funzione. I `spotifyUrl` sbagliati si correggono a mano da Console → Firestore.

## Struttura dati

| Collezione | Campi |
|---|---|
| `canzoni` | `titolo`, `artista`, `ordine`, `spotifyUrl`, `creato` |
| `tasks` | `canzoneId`, `titolo`, `assegnatari` (array di nomi), `fatto`, `fattoDa`, `fattoIl`, `creato` |
| `membri` | `nome`, `creato` |
| `diretta` | `stato`: `attiva`, `sessione`, `da`, `inizio`, `battito`; `ascolto-…`: `tipo`, `sessione`, `chi`, `offer`, `answer`, `creato` |
| `privato` | solo per le funzioni, i telefoni non la leggono: `spotify` (playlist), `telegram` (gruppo e impostazioni del bot) con la sottocollezione `eventi`, `telegram-foto` (ultima fotografia del database) |

## Costi

Con Blaze paghi solo l'eccedenza oltre i free tier, che a 5 persone non toccherete mai: Firestore 50k letture/20k scritture al giorno, Hosting 10 GB storage + 360 MB/giorno di traffico, Functions 2M invocazioni/mese, Gemini free tier a parte. Il budget con avviso del passo 1.4 è la rete di sicurezza.

## Pubblicare una nuova versione

L'interfaccia (`public/`) va online da sola a ogni merge su `main`. A ogni pubblicazione aumentare **insieme** tre numeri:

- `APP_VERSION` in `public/app.js`
- `"version"` in `public/version.json`
- `CACHE` in `public/sw.js`

Le app aperte sui telefoni controllano `version.json` quando tornano in primo piano (e ogni 15 minuti): se la versione online è diversa compare la barra "È disponibile una versione nuova" con il bottone **Aggiorna**.

Se una modifica richiede di ripulire dati salvati sui telefoni (chiavi di `localStorage`, accessi vecchi), aumentare `DATA_VERSION` in `public/app.js` e aggiungere la pulizia corrispondente in `MIGRAZIONI`: viene eseguita una volta sola su ogni telefono.

## Diretta dalla sala

In cima alla sezione **Audio**. Il computer della sala trasmette quello che entra dal mixer (lo stesso ingresso USB da cui registra GarageBand: macOS lo fa leggere a più app insieme); i telefoni ascoltano.

- **Trasmettere:** dal computer della sala, Audio → *Avvia la diretta* → scegliere l'ingresso del mixer. La pagina va tenuta aperta finché si suona. Un indicatore mostra il livello del segnale e chi è in ascolto.
- **Ascoltare:** dal telefono, Audio → *Ascolta*. Su Android l'audio continua di norma anche a schermo bloccato; su iPhone si ferma quando si blocca lo schermo o si cambia app (limite di iOS per WebRTC).
- **Come funziona:** l'audio va dal computer al telefono direttamente (WebRTC, Opus stereo 128 kbps, ritardo sotto il secondo). Firestore, collezione `diretta`, serve solo a far incontrare i dispositivi: documento `stato` (chi trasmette, battito ogni minuto; senza battito da 3 minuti la diretta si considera chiusa) e un documento `ascolto-…` per ogni telefono. Nessun server in più, nessun costo.
- **Fuori casa:** di solito funziona anche da un'altra rete grazie al server STUN di Google; con alcune reti mobili o router serve un server ponte (TURN), che non c'è.
- **Regola del database:** la collezione `diretta` va aggiunta una volta alle regole Firestore (file `firestore.rules`, da copiare in Console Firebase → Firestore Database → Regole → Pubblica). Finché manca, la scheda della diretta lo segnala e il resto dell'app funziona come prima.

## Pubblicare le funzioni da GitHub

Le Cloud Functions (`functions/`) si pubblicano da sole quando cambia qualcosa in quella cartella su `main` (workflow `firebase-functions-merge.yml`, avviabile anche a mano da GitHub → Actions → "Pubblica le funzioni"). Il terminale non serve più.

Il workflow usa l'account di servizio `github-action-…` che pubblica già il sito. In Google Cloud Console → IAM, a quell'account vanno dati una volta questi ruoli:

- Cloud Functions Admin (`roles/cloudfunctions.admin`)
- Cloud Run Admin (`roles/run.admin`)
- Service Account User (`roles/iam.serviceAccountUser`)
- Artifact Registry Administrator (`roles/artifactregistry.admin`)
- Secret Manager Admin (`roles/secretmanager.admin`)
- Service Usage Consumer (`roles/serviceusage.serviceUsageConsumer`)
- Firebase Viewer (`roles/firebase.viewer`)
- Cloud Scheduler Admin (`roles/cloudscheduler.admin`), per la funzione oraria del bot Telegram; serve anche l'API Cloud Scheduler attiva nel progetto

Funzioni presenti:

- `spotifyLink` — cerca con Gemini il link Spotify o Songsterr di una canzone (secret `GEMINI_API_KEY`).
- `playlist` e `spotifyCallback` — collegano l'account Spotify e tengono aggiornate le playlist "Scaletta" e "Proposte". Serve il Client ID dell'app Spotify in `functions/.env` (`SPOTIFY_CLIENT_ID=...`, non è un segreto) e, nell'app Spotify, il Redirect URI `https://us-central1-il-ritmo-della-sala-prove.cloudfunctions.net/spotifyCallback`.

- `telegram` e `telegramOgniOra` — il bot Telegram della band (secret `TELEGRAM_TOKEN`), vedi sotto.

Runtime Node.js 22 (il 20 viene dismesso da Google il 30 ottobre 2026).

## Bot Telegram

Nel gruppo Telegram della band riassume cosa si muove nell'app, per chi non la apre spesso. Codice in `functions/telegram.js` (Telegram e database) e `functions/telegram-testi.js` (registro e testi, funzioni pure).

- **Pulsanti e comandi:** Novità 2 o 7 giorni (`/novita 3` per un numero a scelta, fino a 60), Scaletta, Proposte e voti (con chi deve ancora votare), Task aperti per persona, Cassa.
- **`/vai`:** il bot risponde `/vai`.
- **Riepilogo automatico:** ogni 2 giorni alle 19, solo se si è mosso qualcosa. Si cambia dal gruppo con `/automatico 3 21` (ogni 3 giorni alle 21) o `/automatico off`.
- **Registro:** voti, passaggi in scaletta, modifiche ai setup ed eliminazioni non hanno una data nel database. La funzione `telegramOgniOra` confronta ogni ora il database con una fotografia salvata e registra le differenze in `privato/telegram/eventi` (conservate 120 giorni). Canzoni, task, registrazioni, movimenti e persone nuove si leggono invece dal loro campo `creato` (e `fattoIl` per i task). L'app non cambia.
- **Chi lo usa:** risponde solo nel gruppo collegato con `/collega` (il primo e unico) e, in privato, a chi è membro di quel gruppo. Aggiunto ad altri gruppi, esce. Telegram firma ogni chiamata al webhook con una chiave ricavata dal token.

Configurazione, una volta:

1. Su Telegram, @BotFather → `/newbot` → nome e username del bot → copiare il token.
2. Google Cloud Console → Security → Secret Manager → *Create secret*: nome `TELEGRAM_TOKEN`, valore il token. Va fatto **prima** di pubblicare le funzioni: senza il secret la pubblicazione si ferma.
3. Google Cloud Console → API → abilitare *Cloud Scheduler API*; IAM → all'account `github-action-…` aggiungere *Cloud Scheduler Admin*.
4. Pubblicare le funzioni (merge su `main`). Poi aprire una volta https://us-central1-il-ritmo-della-sala-prove.cloudfunctions.net/telegram nel browser: imposta il webhook (lo farebbe comunque la funzione oraria entro un'ora).
5. Aggiungere il bot al gruppo della band e scrivere `/collega`.
6. Da @BotFather → `/mybots` → il bot → *Bot Settings* → *Allow Groups?* → *Turn groups off*: nessun altro potrà aggiungerlo a un gruppo.

Per un bot nuovo (token cambiato) basta aggiornare il secret con una nuova versione e ripubblicare: il webhook si reimposta da solo. Anche l'elenco dei comandi che Telegram suggerisce scrivendo `/` si aggiorna da solo entro un'ora quando cambia nel codice (o subito riaprendo il link del passo 4); le app Telegram possono mostrarlo solo dopo essere state chiuse e riaperte.
