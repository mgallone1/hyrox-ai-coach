import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ==============================================================================
// CONFIGURAZIONE VARIABILI D'AMBIENTE (SICUREZZA: ZERO CREDENZIALI HARDCODATE)
// ==============================================================================
const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

// Credenziali opzionali telemetria smartwatch
const INTERVALS_KEY = Deno.env.get("INTERVALS_API_KEY") || "";
const ATHLETE_ID = Deno.env.get("INTERVALS_ATHLETE_ID") || "";

// Dati anagrafici atleta (configurabili da variabili d'ambiente)
const ATHLETE_NAME = Deno.env.get("ATHLETE_NAME") || "Atleta";
const ATHLETE_AGE = Deno.env.get("ATHLETE_AGE") || "30";
const ATHLETE_HEIGHT = Deno.env.get("ATHLETE_HEIGHT") || "180";
const ATHLETE_TARGET = Deno.env.get("ATHLETE_TARGET") || "Hyrox Preparation";

// Modelli Google Gemini (fallback automatico)
const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash"
];

function cleanFormatting(text: string): string {
  if (!text) return "";
  let clean = text.replace(/\*\*(.*?)\*\*/g, "$1");
  clean = clean.replace(/\*(.*?)\*/g, "$1");
  clean = clean.replace(/^\s*[-|_|*]{3,}\s*$/gm, "");
  clean = clean.replace(/^\|.*\|$/gm, "");
  return clean.trim();
}

async function sendTelegram(chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });
}

async function getLastMessageTime(chatId: number): Promise<Date | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages?chat_id=eq.${chatId}&order=created_at.desc&limit=1`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        return new Date(data[0].created_at);
      }
    }
  } catch (e) {
    console.error("Last message fetch error", e);
  }
  return null;
}

async function getRecentChatHistory(chatId: number, limit: number = 8): Promise<string> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages?chat_id=eq.${chatId}&order=created_at.desc&limit=${limit}`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const reversed = data.reverse();
        return reversed.map((m: any) => `${m.role === 'user' ? ATHLETE_NAME : 'Coach'}: ${m.content}`).join("\n\n");
      }
    }
  } catch (e) {
    console.error("Recent chat fetch error", e);
  }
  return "";
}

async function recordChatMessage(chatId: number, role: string, content: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ chat_id: chatId, role: role, content: content })
    });
  } catch (e) {
    console.error("Record chat error", e);
  }
}

async function getSupabaseMemory(): Promise<string> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/coach_memory?select=category,fact&order=importance.desc`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (res.ok) {
      const data = await res.json();
      return data.map((d: any) => `- [${d.category.toUpperCase()}]: ${d.fact}`).join("\n");
    }
  } catch (e) {
    console.error("Memory fetch error", e);
  }
  return "";
}

async function getSupabaseBia(): Promise<string> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bia_records?select=*&order=exam_date.desc&limit=5`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (res.ok) {
      const data = await res.json();
      return data.map((b: any) => `- Esame ${b.exam_date}: Peso ${b.weight_kg}kg, PhA ${b.phase_angle}°, BCM ${b.bcm_kg}kg, Grasso ${b.fm_kg}kg (${b.fm_percent}%), Acqua ${b.tbw_liters}L, ECW ${b.ecw_liters || 'N/D'}L, Rz ${b.rz_ohm || 'N/D'}Ω, Xc ${b.xc_ohm || 'N/D'}Ω`).join("\n");
    }
  } catch (e) {
    console.error("BIA fetch error", e);
  }
  return "";
}

async function getIntervalsRecent(): Promise<string> {
  if (!INTERVALS_KEY || !ATHLETE_ID) return "";
  try {
    const authHeader = "Basic " + btoa("API_KEY:" + INTERVALS_KEY);
    const today = new Date().toISOString().split("T")[0];
    const past = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    
    let wellnessText = "";
    const res = await fetch(`https://intervals.icu/api/v1/athlete/${ATHLETE_ID}/wellness?oldest=${past}&newest=${today}`, {
      headers: { Authorization: authHeader }
    });
    if (res.ok) {
      const wList = await res.json();
      if (wList && wList.length > 0) {
        const last = wList[wList.length - 1];
        const sleepHours = Math.floor((last.sleepSecs || 0) / 3600);
        const sleepMins = Math.floor(((last.sleepSecs || 0) % 3600) / 60);
        wellnessText = `Smartwatch oggi: Sonno ${sleepHours} ore e ${sleepMins} minuti (punteggio ${Math.round(last.sleepScore || 0)}), FC a riposo ${last.restingHR} bpm, CTL ${Math.round(last.ctl || 0)}, ATL ${Math.round(last.atl || 0)}`;
      }
    }

    let workoutText = "";
    const actRes = await fetch(`https://intervals.icu/api/v1/athlete/${ATHLETE_ID}/activities?oldest=${past}&newest=${today}`, {
      headers: { Authorization: authHeader }
    });
    if (actRes.ok) {
      const actList = await actRes.json();
      if (actList && actList.length > 0) {
        const lastAct = actList[actList.length - 1];
        const distKm = lastAct.distance ? (lastAct.distance / 1000).toFixed(2) + " km" : "N/D";
        const movingMins = Math.floor((lastAct.moving_time || 0) / 60);
        const movingSecs = (lastAct.moving_time || 0) % 60;
        let paceStr = "";
        if (lastAct.distance && lastAct.moving_time) {
          const paceSecKm = lastAct.moving_time / (lastAct.distance / 1000);
          const pMin = Math.floor(paceSecKm / 60);
          const pSec = Math.floor(paceSecKm % 60);
          paceStr = `, Passo ${pMin}:${pSec < 10 ? '0' : ''}${pSec} min/km`;
        }
        workoutText = `Ultimo allenamento (${lastAct.start_date_local?.replace('T', ' ')}): ${lastAct.name || lastAct.type}, Durata ${movingMins}m ${movingSecs}s, Distanza ${distKm}${paceStr}, FC media ${lastAct.average_heartrate || 'N/D'} bpm (max ${lastAct.max_heartrate || 'N/D'} bpm), Calorie ${lastAct.calories || 'N/D'} kcal.`;
      }
    }

    return `${wellnessText}\n${workoutText}`.trim();
  } catch (e) {
    console.error("Intervals fetch error", e);
  }
  return "";
}

async function getTodayMacroSummary(): Promise<string> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_meals?meal_date=eq.${today}&select=*`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (res.ok) {
      const meals = await res.json();
      if (meals && meals.length > 0) {
        let totCal = 0, totCarbs = 0, totPro = 0, totFat = 0;
        const listStr = meals.map((m: any) => {
          totCal += m.calories || 0;
          totCarbs += m.carbs_g || 0;
          totPro += m.protein_g || 0;
          totFat += m.fat_g || 0;
          return `- ${m.meal_name || 'Pasto'}: ${m.calories || 0} kcal (Carbo ${m.carbs_g || 0}g, Pro ${m.protein_g || 0}g, Grassi ${m.fat_g || 0}g)`;
        }).join("\n");
        return `PASTI REGISTRATI OGGI:\n${listStr}\nTOTALE GIORNALIERO: ${totCal} kcal, Carboidrati: ${totCarbs}g, Proteine: ${totPro}g, Grassi: ${totFat}g`;
      }
    }
  } catch (e) {
    console.error("Macro summary fetch error", e);
  }
  return "Nessun pasto ancora registrato oggi.";
}

async function callGemini(systemPrompt: string, parts: any[]): Promise<string> {
  for (const m of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: parts }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 3000,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) {
          return cleanFormatting(text);
        }
      }
    } catch (e) {
      console.error(`Gemini model ${m} failed`, e);
    }
  }
  return "C'è stato un rallentamento momentaneo, riprova tra qualche secondo!";
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  try {
    const update = await req.json();
    const msg = update.message;
    if (!msg) {
      return new Response("OK", { status: 200 });
    }

    const chatId = msg.chat.id;

    // Regola sul saluto intelligente (evita di salutare a ogni messaggio)
    const lastTime = await getLastMessageTime(chatId);
    let shouldGreet = true;
    if (lastTime) {
      const diffHours = (Date.now() - lastTime.getTime()) / (1000 * 60 * 60);
      if (diffHours < 5) {
        shouldGreet = false;
      }
    }

    const greetingRule = shouldGreet
      ? "È passato molto tempo dall'ultimo contatto: puoi iniziare con un breve saluto naturale."
      : "VIETATO SALUTARE: State già parlando, non usare convenevoli e vai direttamente al sodo.";

    const systemPrompt = `Sei il Coach Hyrox, Nutrizionista Sportivo e Consulente di Biomeccanica/Ortopedia dello Sport di ${ATHLETE_NAME} (${ATHLETE_AGE} anni, ${ATHLETE_HEIGHT} cm).
Obiettivo dell'atleta: ${ATHLETE_TARGET}.

REGOLE FONDAMENTALI DI COMPORTAMENTO:
1. RISPONDI RIGOROSAMENTE IN ITALIANO.
2. REGOLA DEL SALUTO: ${greetingRule}
3. CONCISO, DIRETTO E PRATICO (MASSIMA PRIORITÀ):
   - Evita preamboli inutili o spiegazioni accademiche se non richieste.
   - Sii conciso come un vero coach via chat: poche frasi chiare, dritte al punto.
4. TONO PROFESSIONALE E SOBRIO: Calmo, autorevole, zero entusiasmo finto.
5. ZERO ASTERISCHI NEL TESTO: Non usare mai asterischi (* o **).
6. ZERO TABELLE ASCII: Nessuna tabella con barre o trattini.
7. CONCLUDI SEMPRE IL DISCORSO senza lasciarlo a metà.
8. PERTINENZA ASSOLUTA:
   - Rispondi sempre e solo a quello che l'atleta ti chiede.
   - I dati BIA o le competenze ortopediche servono come tuo sfondo conoscitivo: tirali fuori SOLO in caso di domande esplicite.

LE TUE SPECIALIZZAZIONI SCIENTIFICHE (DA APPLICARE QUANDO PERTINENTE):
- ORTOPEDIA DELLO SPORT & BIOMECCANICA CLINICA: protezione catena posteriore, carichi assiali sulla colonna, stabilità articolare (ginocchia/anche), gestione carichi ed esercizi alternativi sicuri.
- BIOIMPEDENZIOMETRIA VETTORIALE (BIVA CLINICA): interpretazione Angolo di Fase (PhA), BCM (massa cellulare attiva), idratazione intra/extracellulare (ICW/ECW).
- TELEMETRIA HYROX: gestione del ritmo (pacing) su SkiErg/Rower, cadenza di corsa per ridurre l'impatto articolare, transizioni rapide.
- NUTRIZIONE SPORTIVA & MACRONUTRIENTI: calcolo e modulazione di proteine, carboidrati e idratazione in base ai workout.`;

    // 1. Gestione Note Vocali
    if (msg.voice || msg.audio) {
      const audioObj = msg.voice || msg.audio;
      const fileRes = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${audioObj.file_id}`)).json();
      const filePath = fileRes.result?.file_path;
      const audioUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
      
      const audioRes = await fetch(audioUrl);
      const audioBytes = new Uint8Array(await audioRes.arrayBuffer());
      
      let binary = "";
      for (let i = 0; i < audioBytes.byteLength; i++) {
        binary += String.fromCharCode(audioBytes[i]);
      }
      const base64Audio = btoa(binary);

      const mem = await getSupabaseMemory();
      const chatHistory = await getRecentChatHistory(chatId, 6);
      const mime = msg.voice ? "audio/ogg" : (audioObj.mime_type || "audio/mp3");

      const parts = [
        { text: `DATI ATLETA:\n${mem}\n\nCRONOLOGIA RECENTE CHAT:\n${chatHistory}\n\nNota vocale inviata. Ascolta e rispondi rimanendo coerente con la conversazione, con tono sobrio e senza tabelle o asterischi.` },
        { inlineData: { mimeType: mime, data: base64Audio } }
      ];

      const reply = await callGemini(systemPrompt, parts);
      await sendTelegram(chatId, reply);
      await recordChatMessage(chatId, "user", "[Nota Vocale]");
      await recordChatMessage(chatId, "assistant", reply);
      return new Response("OK", { status: 200 });
    }

    // 2. Gestione Foto Piatti con diario Macro
    if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      const caption = msg.caption || "Analizza questo piatto e stima i macronutrienti";
      
      const fileRes = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${photo.file_id}`)).json();
      const filePath = fileRes.result?.file_path;
      const imgRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
      const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
      
      let binary = "";
      for (let i = 0; i < imgBytes.byteLength; i++) {
        binary += String.fromCharCode(imgBytes[i]);
      }
      const base64Data = btoa(binary);

      const mem = await getSupabaseMemory();
      const chatHistory = await getRecentChatHistory(chatId, 6);
      const todayMacros = await getTodayMacroSummary();

      const promptText = `DATI ATLETA:\n${mem}\n\nCRONOLOGIA RECENTE CHAT:\n${chatHistory}\n\n${todayMacros}\n\nFOTO INVIATA. Didascalia: "${caption}".
Se si tratta di cibo:
1. Dai una stima concisa dei valori: Calorie, Carboidrati, Proteine, Grassi.
2. Includi in fondo al messaggio un tag JSON nascosto nel formato: <!--MEAL:{"name":"Pranzo","calories":750,"carbs":80,"protein":45,"fat":25}--> per salvarlo nel diario.
3. Zero asterischi e zero tabelle.`;

      const parts = [
        { text: promptText },
        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ];

      const rawReply = await callGemini(systemPrompt, parts);

      const mealMatch = rawReply.match(/<!--MEAL:(\{.*?\})-->/);
      if (mealMatch) {
        try {
          const mealObj = JSON.parse(mealMatch[1]);
          const today = new Date().toISOString().split("T")[0];
          await fetch(`${SUPABASE_URL}/rest/v1/daily_meals`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              meal_date: today,
              meal_name: mealObj.name || "Pasto",
              calories: mealObj.calories || 0,
              carbs_g: mealObj.carbs || 0,
              protein_g: mealObj.protein || 0,
              fat_g: mealObj.fat || 0
            })
          });
        } catch (e) {
          console.error("Meal record error", e);
        }
      }

      const cleanReply = rawReply.replace(/<!--MEAL:.*?-->/g, "").trim();
      await sendTelegram(chatId, cleanReply);
      await recordChatMessage(chatId, "user", `[Foto]: ${caption}`);
      await recordChatMessage(chatId, "assistant", cleanReply);
      return new Response("OK", { status: 200 });
    }

    // 3. Gestione File PDF (BIA automatica)
    if (msg.document) {
      const doc = msg.document;
      const docName = doc.file_name || "";
      const isPdf = doc.mime_type === "application/pdf" || docName.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        try {
          const fileRes = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${doc.file_id}`)).json();
          const filePath = fileRes.result?.file_path;
          const pdfRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
          const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());

          let binary = "";
          for (let i = 0; i < pdfBytes.byteLength; i++) {
            binary += String.fromCharCode(pdfBytes[i]);
          }
          const base64Pdf = btoa(binary);

          const previousBia = await getSupabaseBia();

          const biaPrompt = `Hai ricevuto un referto di Bioimpedenziometria (BIA) in formato PDF.
STORICO BIA PRECEDENTI:
${previousBia}

Compito:
1. Estrai: Data esame, Peso (kg), PhA (°), BCM (kg), Grasso FM (kg e %), Massa Magra FFM (kg), Acqua TBW (L), ECW (L), Rz (Ohm), Xc (Ohm).
2. Fornisci un'analisi differenziale chiara e sintetica rispetto agli esami precedenti.
3. Includi in fondo al testo un tag JSON su una riga per salvarlo nel database:
<!--BIA:{"exam_date":"YYYY-MM-DD","weight_kg":99.0,"phase_angle":8.8,"bcm_kg":57.1,"fm_kg":11.4,"fm_percent":11.5,"ffm_kg":87.6,"tbw_liters":64.3,"ecw_liters":23.1,"rz_ohm":380,"xc_ohm":58}-->
4. Zero asterischi e zero tabelle.`;

          const parts = [
            { text: biaPrompt },
            { inlineData: { mimeType: "application/pdf", data: base64Pdf } }
          ];

          const rawBiaReply = await callGemini(systemPrompt, parts);

          const biaMatch = rawBiaReply.match(/<!--BIA:(\{.*?\})-->/);
          if (biaMatch) {
            try {
              const bObj = JSON.parse(biaMatch[1]);
              await fetch(`${SUPABASE_URL}/rest/v1/bia_records`, {
                method: "POST",
                headers: {
                  apikey: SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify(bObj)
              });
            } catch (e) {
              console.error("BIA insert error", e);
            }
          }

          const cleanBiaReply = rawBiaReply.replace(/<!--BIA:.*?-->/g, "").trim();
          await sendTelegram(chatId, cleanBiaReply);
          await recordChatMessage(chatId, "user", `[Referto BIA PDF]: ${docName}`);
          await recordChatMessage(chatId, "assistant", cleanBiaReply);
          return new Response("OK", { status: 200 });
        } catch (e) {
          console.error("PDF processing error", e);
        }
      }

      const text = `Ricevuto il file ${docName}. Se vuoi che esamini un aspetto specifico, dimmi pure.`;
      await sendTelegram(chatId, text);
      await recordChatMessage(chatId, "user", `[Documento]: ${docName}`);
      await recordChatMessage(chatId, "assistant", text);
      return new Response("OK", { status: 200 });
    }

    // 4. Gestione Messaggio di Testo
    if (msg.text) {
      const userText = msg.text;

      if (/male|dolore|infortunio|bloccato|strappo/i.test(userText)) {
        await fetch(`${SUPABASE_URL}/rest/v1/coach_memory`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ category: "infortuni", fact: `Segnalazione: ${userText}`, importance: 5 })
        });
      }

      const mem = await getSupabaseMemory();
      const bia = await getSupabaseBia();
      const intervals = await getIntervalsRecent();
      const chatHistory = await getRecentChatHistory(chatId, 8);
      const todayMacros = await getTodayMacroSummary();

      const promptText = `SCHEDA E DATI ATLETA:
${mem}
${bia}
${intervals}
${todayMacros}

CRONOLOGIA RECENTE DELLA CHAT:
${chatHistory}

MESSAGGIO DELL'ATLETA A CUI DEVI RISPONDERE:
"${userText}"

ISTRUZIONI PER LA RISPOSTA:
1. Analizza la cronologia recente per capire esattamente il contesto del messaggio.
2. Sii BREVE, DIRETTO E PRATICO: poche frasi essenziali.
3. Se l'atleta chiede dell'ultimo allenamento, consulta i dati della telemetria sopra (passo, durata, FC media/max, calorie).
4. Se chiede di pasti/macro, consulta il riepilogo giornaliero dei pasti registrati sopra.
5. Non citare valori clinici o BIA a meno di specifica domanda.
6. Zero asterischi e zero tabelle.`;

      const parts = [{ text: promptText }];
      const reply = await callGemini(systemPrompt, parts);
      await sendTelegram(chatId, reply);
      await recordChatMessage(chatId, "user", userText);
      await recordChatMessage(chatId, "assistant", reply);
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Function error", err);
    return new Response("ERROR", { status: 500 });
  }
});
