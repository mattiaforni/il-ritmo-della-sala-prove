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

## Costi

Con Blaze paghi solo l'eccedenza oltre i free tier, che a 5 persone non toccherete mai: Firestore 50k letture/20k scritture al giorno, Hosting 10 GB storage + 360 MB/giorno di traffico, Functions 2M invocazioni/mese, Gemini free tier a parte. Il budget con avviso del passo 1.4 è la rete di sicurezza.

## Pubblicare una nuova versione

L'interfaccia (`public/`) va online da sola a ogni merge su `main`. A ogni pubblicazione aumentare **insieme** tre numeri:

- `APP_VERSION` in `public/app.js`
- `"version"` in `public/version.json`
- `CACHE` in `public/sw.js`

Le app aperte sui telefoni controllano `version.json` quando tornano in primo piano (e ogni 15 minuti): se la versione online è diversa compare la barra "È disponibile una versione nuova" con il bottone **Aggiorna**.

Se una modifica richiede di ripulire dati salvati sui telefoni (chiavi di `localStorage`, accessi vecchi), aumentare `DATA_VERSION` in `public/app.js` e aggiungere la pulizia corrispondente in `MIGRAZIONI`: viene eseguita una volta sola su ogni telefono.

La Cloud Function (`functions/`) non passa dalla pubblicazione automatica: si pubblica da terminale con `firebase deploy --only functions`.
