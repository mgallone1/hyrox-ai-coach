# 🏋️ Hyrox AI Coach & Sports Nutritionist Bot

Assistente intelligente H24 per atleti Hyrox e sportivi, sviluppato su architettura **serverless cloud (Supabase Edge Functions)** con **Google Gemini**, sincronizzazione smartwatch (**Intervals.icu / Huawei / Garmin**) e analisi bioimpedenziometria vettoriale (**BIA Akern BodygramPlus**).

---

## ⚡ Caratteristiche Principali

- **Coach Personale Telegram H24:** Nessun bisogno di tenere il PC acceso. Risponde in tempo reale via cloud.
- **Supporto Multimodale:**
  - 🎙️ **Note Vocali:** trascrizione e comprensione immediata dei messaggi audio.
  - 📸 **Foto Piatti & Macro Tracker:** stima istantanea di calorie, carboidrati, proteine e grassi con salvataggio cumulativo nel database giornaliero.
  - 📄 **Analisi BIA Automatica (PDF):** inviando il PDF di un referto BIA Akern, il bot estrae tutti i valori (PhA, BCM, FFM, FM, TBW, ECW, Rz, Xc), aggiorna lo storico e restituisce il confronto differenziale con l'esame precedente.
- **Telemetria Smartwatch (Huawei / Garmin):** sincronizzazione con Intervals.icu per monitorare sonno, FC a riposo, carico atletico (CTL/ATL) e analisi del passo (min/km) dell'ultimo allenamento.
- **Competenze Cliniche e Ortopediche:** consulenza su biomeccanica articolare, protezione della colonna vertebrale (discectomie/ernie), stabilità delle ginocchia (menischi) e prevenzione infortuni.
- **Sicurezza al 100%:** zero credenziali o dati personali salvati nel codice sorgente.

---

## 🚀 Guida all'Installazione (Setup in 10 Minuti)

### 1. Prerequisiti Gratuiti
1. Un bot Telegram creato con [@BotFather](https://t.me/BotFather) (ti fornirà il `TELEGRAM_BOT_TOKEN`).
2. Un account gratuito su [Supabase](https://supabase.com).
3. Una chiave API gratuita su [Google AI Studio](https://aistudio.google.com).
4. (Opzionale) Un account [Intervals.icu](https://intervals.icu) per la telemetria da orologio.

---

### 2. Configurazione Database Supabase
1. Accedi alla dashboard del tuo progetto Supabase.
2. Apri la sezione **SQL Editor**.
3. Copia e incolla l'intero contenuto del file `schema.sql` presente in questa cartella e premi **Run**.
4. Le 5 tabelle necessarie (`bia_records`, `daily_meals`, `coach_memory`, `chat_messages`, `body_measurements`) verranno create all'istante.

---

### 3. Configurazione Secrets su Supabase
Nella dashboard di Supabase, vai in **Project Settings** ➔ **Edge Functions** ➔ **Secrets** (oppure usa la CLI di Supabase) e aggiungi le seguenti variabili:

| Variabile | Descrizione | Obbligatoria |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Token ottenuto da BotFather | Sì |
| `GEMINI_API_KEY` | Chiave API di Google AI Studio | Sì |
| `SUPABASE_URL` | URL del tuo progetto (`https://xyz.supabase.co`) | Sì |
| `SUPABASE_SERVICE_ROLE_KEY` | Chiave segreta Service Role di Supabase | Sì |
| `INTERVALS_ATHLETE_ID` | Tuo Athlete ID su Intervals.icu (es. `i12345`) | Opzionale |
| `INTERVALS_API_KEY` | Tua API Key di Intervals.icu | Opzionale |
| `ATHLETE_NAME` | Nome dell'atleta | Opzionale |
| `ATHLETE_AGE` | Età dell'atleta | Opzionale |
| `ATHLETE_HEIGHT` | Altezza in cm | Opzionale |
| `ATHLETE_TARGET` | Obiettivo sportivo (es. *Hyrox Open SUB-1h 20m*) | Opzionale |

---

### 4. Deploy della Funzione Cloud
Dalla cartella principale del progetto, esegui tramite terminale:

```bash
npx supabase functions deploy telegram-bot --project-ref TUO_PROJECT_REF --no-verify-jwt
```

---

### 5. Attivazione Webhook Telegram
Collega il bot Telegram alla funzione Supabase appena deployata aprendo questo URL nel browser (sostituendo il tuo token e l'URL del tuo progetto Supabase):

```text
https://api.telegram.org/bot<TUO_TELEGRAM_TOKEN>/setWebhook?url=https://<TUO_PROJECT_REF>.supabase.co/functions/v1/telegram-bot
```

Se ricevi `{"ok":true,"result":true,"description":"Webhook was set"}`, il bot è attivo, pronto e risponderà H24 in cloud!

---

## 🔒 Sicurezza e Privacy (Pre-Launch Security Checklist)
- Il file `.gitignore` blocca tassativamente l'upload di chiavi `.env`, referti PDF e immagini.
- Nessun dato sensibile dell'atleta è presente nel codice sorgente: la memoria clinica viene gestita privatamente nelle tabelle Supabase protette con cifratura a riposo e accesso con Service Role Key.
