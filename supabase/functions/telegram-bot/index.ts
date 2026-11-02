// Supabase Edge Function: telegram-bot
// Cloud Serverless H24 su Supabase alimentato da Google Gemini 3.5 Flash (1500 req/die)
// Dotato di SKILL CLINICHE E METRICHE AVANZATE:
// - Analisi Vettoriale BIA Akern (BIVA, ICW/ECW, Na/K ratio, PhA dinamico)
// - Telemetria Hyrox & Gestione Lattato (Cardio Z2/Z4, cadenza 175-180 spm, watt ergometri)
// - Training Load & Readiness (CTL fitness, ATL fatica, TSB freschezza)
// - Precisione nutrizionale (glicogeno, turnover proteico, idratazione attiva)

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

const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite"
];

function cleanFormatting(t: string): string {
  if (!t) return "";
  return t.replaceAll("**", "").replaceAll("*", "").trim();
}

async function sendTelegram(chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });
}

async function sendTelegramPhoto(chatId: number, photoUrl: string, caption: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption: caption })
  });
}

async function sendTelegramVoice(chatId: number, text: string) {
  try {
    // Generiamo l'audio vocale in italiano usando le API text-to-speech
    // Troncamento a 200 caratteri per messaggi vocali rapidi da coach
    const shortText = text.slice(0, 300).replace(/[^\w\sàèéìòù,.]/gi, '');
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(shortText)}&tl=it&client=tw-ob`;
    const res = await fetch(ttsUrl);
    if (res.ok) {
      const audioBlob = await res.blob();
      const formData = new FormData();
      formData.append("chat_id", chatId.toString());
      formData.append("voice", audioBlob, "coach_voice.mp3");
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVoice`, {
        method: "POST",
        body: formData
      });
    }
  } catch (e) {
    console.error("TTS voice error", e);
  }
}

async function isVoiceEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/coach_memory?category=eq.impostazioni&fact=like.*VOCE_ATTIVA*`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (res.ok) {
      const data = await res.json();
      return data && data.length > 0;
    }
  } catch (e) {
    console.error("Voice check error", e);
  }
  return false;
}

async function generateBiaChartUrl(): Promise<string> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bia_records?select=exam_date,weight_kg,bcm_kg,phase_angle,fm_kg&order=exam_date.asc`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (res.ok) {
      const records = await res.json();
      if (records && records.length > 0) {
        const labels = records.map((r: any) => r.exam_date.substring(5)); // 'MM-DD'
        const bcmData = records.map((r: any) => r.bcm_kg);
        const phaData = records.map((r: any) => r.phase_angle);
        const weightData = records.map((r: any) => r.weight_kg);

        const chartConfig = {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              {
                label: 'BCM Massa Cellulare (kg)',
                data: bcmData,
                borderColor: '#22c55e',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                fill: false,
                yAxisID: 'y'
              },
              {
                label: 'PhA Angolo di Fase (°)',
                data: phaData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: false,
                yAxisID: 'y1'
              },
              {
                label: 'Peso Totale (kg)',
                data: weightData,
                borderColor: '#eab308',
                borderDash: [5, 5],
                fill: false,
                yAxisID: 'y'
              }
            ]
          },
          options: {
            title: {
              display: true,
              text: 'Evoluzione Composizione Corporea Akern BIA (Michele Gallone)'
            },
            scales: {
              yAxes: [
                { id: 'y', position: 'left', scaleLabel: { display: true, labelString: 'Kg' } },
                { id: 'y1', position: 'right', scaleLabel: { display: true, labelString: 'Gradi (°)' }, gridLines: { drawOnChartArea: false } }
              ]
            }
          }
        };

        return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=350&bkg=white`;
      }
    }
  } catch (e) {
    console.error("Chart gen error", e);
  }
  return "";
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

async function getRecentChatHistory(chatId: number, daysBack: number = 30, maxMessages: number = 60): Promise<string> {
  try {
    const sinceDate = new Date(Date.now() - daysBack * 86400000).toISOString();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages?chat_id=eq.${chatId}&created_at=gte.${sinceDate}&order=created_at.desc&limit=${maxMessages}`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        // Invertiamo l'ordine cronologico (dal più vecchio al più recente)
        const reversed = data.reverse();
        return reversed.map((m: any) => {
          const d = new Date(m.created_at);
          const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
          const speaker = m.role === 'user' ? 'Michele' : 'Coach';
          return `[${dateStr}] ${speaker}: ${m.content}`;
        }).join("\n\n");
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

async function getRecentStrengthWorkouts(): Promise<string> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/strength_workouts?select=*&order=workout_date.desc,created_at.desc&limit=15`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (res.ok) {
      const records = await res.json();
      if (records && records.length > 0) {
        return "ULTIMI CARICHI REGISTRATI IN PALESTRA:\n" + records.map((r: any) =>
          `- ${r.workout_date} [${r.exercise_name}]: ${r.sets}x${r.reps} con ${r.weight_kg} kg ${r.rpe ? `(RPE ${r.rpe})` : ''} ${r.notes ? `- Note: ${r.notes}` : ''}`
        ).join("\n");
      }
    }
  } catch (e) {
    console.error("Strength fetch error", e);
  }
  return "Nessun carico di forza/volume ancora registrato.";
}

async function getIntervalsRecent(): Promise<string> {
  try {
    const authHeader = "Basic " + btoa("API_KEY:" + INTERVALS_KEY);
    const today = new Date().toISOString().split("T")[0];
    const past = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    
    // 1. Wellness (Sonno, FC riposo, fitness/fatica)
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
        wellnessText = `Orologio GT 6 oggi: Sonno ${sleepHours} ore e ${sleepMins} minuti (punteggio ${Math.round(last.sleepScore || 0)}), FC a riposo ${last.restingHR} bpm, CTL ${Math.round(last.ctl || 0)}, ATL ${Math.round(last.atl || 0)}`;
      }
    }

    // 2. Ultimo Allenamento sincronizzato da Huawei Watch GT 6
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
        return `PASTI REGISTRATI OGGI:\n${listStr}\nTOTALE GIORNALIERO: ${totCal} kcal, Carboidrati: ${totCarbs}g, Proteine: ${totPro}g (target ~180-200g), Grassi: ${totFat}g`;
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
      } else {
        console.error(`Gemini model ${m} returned`, res.status, await res.text());
      }
    } catch (e) {
      console.error(`Gemini model ${m} failed`, e);
    }
  }
  return "C'è stato un rallentamento momentaneo, riprova tra 3 secondi!";
}

async function checkAndSendWorkoutSummary(chatId: number) {
  try {
    const authHeader = "Basic " + btoa("API_KEY:" + INTERVALS_KEY);
    const today = new Date().toISOString().split("T")[0];
    const past = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];

    const actRes = await fetch(`https://intervals.icu/api/v1/athlete/${ATHLETE_ID}/activities?oldest=${past}&newest=${today}`, {
      headers: { Authorization: authHeader }
    });
    if (!actRes.ok) return;

    const actList = await actRes.json();
    if (!actList || actList.length === 0) return;

    // Filtriamo gli allenamenti di oggi o delle ultime 6 ore
    const recentActs = actList.filter((a: any) => {
      const actTime = new Date(a.start_date_local).getTime();
      return (Date.now() - actTime) < 6 * 3600 * 1000;
    });

    if (recentActs.length === 0) return;

    // Controlliamo quali attività sono già state notificate
    const procRes = await fetch(`${SUPABASE_URL}/rest/v1/processed_activities?select=id`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const processedIds = new Set<string>();
    if (procRes.ok) {
      const data = await procRes.json();
      data.forEach((p: any) => processedIds.add(p.id));
    }

    const unnotified = recentActs.filter((a: any) => !processedIds.has(a.id));
    if (unnotified.length === 0) return;

    // Raggruppiamo tutte le attività svolte nella stessa finestra oraria (entro 2 ore l'una dall'altra)
    // es. Sessione Palestra/Forza + HIIT/Hyrox
    let totalMovingSecs = 0;
    let totalCalories = 0;
    let maxHrEver = 0;
    let detailsList: string[] = [];

    for (const act of unnotified) {
      totalMovingSecs += (act.moving_time || 0);
      totalCalories += (act.calories || 0);
      if (act.max_heartrate && act.max_heartrate > maxHrEver) {
        maxHrEver = act.max_heartrate;
      }
      const movingMins = Math.floor((act.moving_time || 0) / 60);
      const movingSecs = (act.moving_time || 0) % 60;
      const distKm = act.distance ? `${(act.distance / 1000).toFixed(2)} km` : "N/D";
      detailsList.push(`- ${act.name || act.type} (iniziato alle ${act.start_date_local?.substring(11, 16)}): Durata ${movingMins}m ${movingSecs}s, Distanza ${distKm}, FC media ${act.average_heartrate || 'N/D'} bpm (max ${act.max_heartrate || 'N/D'} bpm), Calorie ${act.calories || 0} kcal.`);
    }

    const totMins = Math.floor(totalMovingSecs / 60);
    const summaryPrompt = `Michele ha appena terminato la sessione di allenamento con il suo smartwatch Huawei Watch GT 6 (sincronizzato su Intervals.icu).
ALLENAMENTI SVOLTI NELLA STESSA SESSIONE (${unnotified.length} blocchi combinati):
${detailsList.join("\n")}
TOTALE COMBINATO: Durata ${totMins} minuti, Calorie bruciate ${totalCalories} kcal, FC max raggiunta ${maxHrEver} bpm.

Compito da Coach e Nutrizionista Sportivo:
1. Fai un debriefing unico, combinato e integrato della sessione appena conclusa (se ci sono 2 o più blocchi come palestra + HIIT, commenta come hanno interagito).
2. Valuta il dispendio energetico e la risposta cardiaca (frequenza media/picco rispetto alla soglia anaerobica).
3. Dai indicazioni immediate per il POST-WORKOUT di stasera:
   - Idratazione da reintegrare.
   - Timing e quantità di proteine (target ~40-50g a cena) e carboidrati per ripristinare il glicogeno dei 57 kg di BCM.
   - Assunzione dei 5g di creatina se non ancora presi.
   - De-compressione lombare e scarico articolare post-allenamento.
4. Tono sobrio, diretto, incisivo. Zero asterischi (* o **), zero tabelle ASCII. Massimo 8-10 righe.`;

    const summaryText = await callGemini("Sei il Coach Hyrox e Nutrizionista Sportivo personale di Michele Gallone.", [{ text: summaryPrompt }]);

    await sendTelegram(chatId, `Debriefing Post-Allenamento:\n\n${summaryText}`);

    // Segniamo tutte le attività come processate nel database
    for (const act of unnotified) {
      await fetch(`${SUPABASE_URL}/rest/v1/processed_activities`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: act.id })
      });
    }

    await recordChatMessage(chatId, "assistant", `[Debriefing Post-Allenamento Combinato]: ${summaryText}`);
  } catch (e) {
    console.error("Workout summary error", e);
  }
}

async function checkAndSendMorningBriefing(chatId: number) {
  try {
    const today = new Date().toISOString().split("T")[0];
    
    // Controlliamo se per la giornata odierna è già stato inviato il briefing
    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/morning_briefings?briefing_date=eq.${today}&select=id`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (checkRes.ok) {
      const data = await checkRes.json();
      if (data && data.length > 0) {
        return; // Già inviato per oggi
      }
    }

    // Interroghiamo Intervals.icu per verificare se Huawei Health ha caricato il sonno della notte appena trascorsa
    const authHeader = "Basic " + btoa("API_KEY:" + INTERVALS_KEY);
    const past = new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0];
    const res = await fetch(`https://intervals.icu/api/v1/athlete/${ATHLETE_ID}/wellness?oldest=${past}&newest=${today}`, {
      headers: { Authorization: authHeader }
    });

    if (res.ok) {
      const wList = await res.json();
      if (wList && wList.length > 0) {
        const todayWellness = wList.find((w: any) => w.id === today);
        // Se Huawei ha sincronizzato il sonno di oggi (sleepSecs > 0)
        if (todayWellness && (todayWellness.sleepSecs || 0) > 10800) { // almeno 3 ore di sonno registrate
          const sleepHours = Math.floor((todayWellness.sleepSecs || 0) / 3600);
          const sleepMins = Math.floor(((todayWellness.sleepSecs || 0) % 3600) / 60);
          const score = Math.round(todayWellness.sleepScore || 0);
          const rhr = todayWellness.restingHR || 48;
          const ctl = Math.round(todayWellness.ctl || 0);
          const atl = Math.round(todayWellness.atl || 0);

          // Alert Sovrallenamento: se FC a riposo è alta (>52 bpm) o sonno insufficiente (solo se il punteggio è stato effettivamente calcolato > 0)
          let overtrainingAlert = "";
          if (rhr >= 52 || (score > 0 && score < 65)) {
            overtrainingAlert = "\nALERT RECUPERO: La frequenza cardiaca a riposo è elevata (+3-4 bpm sopra baseline) o il sonno non è stato profondo. Sistema nervoso simpatico ancora attivo: oggi prediligi volume aerobico Z2 leggero o riposo, evitando massimali o intensità anaerobica.";
          }

          const prompt = `L'orologio Huawei Watch GT 6 ha rilevato il risveglio di Michele:
- Sonno registrato: ${sleepHours} ore e ${sleepMins} minuti${score > 0 ? ` (Punteggio qualità ${score})` : ' (in fase di sincronizzazione punteggio)'}
- FC a riposo: ${rhr} bpm (baseline tipica 48-50 bpm)
- Carico Fitness (CTL): ${ctl}, Fatica acuta (ATL): ${atl}
${overtrainingAlert}

Genera il Morning Briefing del risveglio per Michele:
1. Valutazione sintetica del recupero notturno basata sulle ore effettive di sonno e sulla FC a riposo. Non dare punteggio zero se le ore di sonno sono normali (oltre 6 ore).
2. Indicazione pratica per la giornata: focus su idratazione (target 4L), assunzione creatina e gestione dei carichi per oggi.
3. Tono sobrio, diretto, amichevole ma senza entusiasmo finto. Massimo 6-8 righe. Zero asterischi (* o **) e zero tabelle.`;

          const briefingText = await callGemini("Sei il Coach Hyrox e Nutrizionista Sportivo personale di Michele Gallone.", [{ text: prompt }]);
          
          await sendTelegram(chatId, `Buongiorno Michele!\n\n${briefingText}`);
          
          // Registriamo l'avvenuto invio su Supabase
          await fetch(`${SUPABASE_URL}/rest/v1/morning_briefings`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              briefing_date: today,
              sleep_score: score,
              resting_hr: rhr,
              content: briefingText
            })
          });

          await recordChatMessage(chatId, "assistant", `[Morning Briefing Automatico]: ${briefingText}`);
        }
      }
    }
  } catch (e) {
    console.error("Morning briefing error", e);
  }
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

    // Check automatico risveglio: invio Morning Briefing se disponibile
    await checkAndSendMorningBriefing(chatId);

    // Check automatico post-workout: rileva nuovi allenamenti e li unisce in un unico debriefing
    await checkAndSendWorkoutSummary(chatId);

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
      : "VIETATO SALUTARE: State già parlando, non dire 'Ciao Michele', 'Ciao Michi' o convenevoli simili. Vai direttamente al sodo rispondendo al punto.";

    const systemPrompt = `Sei il Coach Hyrox, Nutrizionista Sportivo e Consulente di Fisiologia/Ortopedia dello Sport di Michele Gallone (34 anni, 189 cm, 99 kg).

REGOLE FONDAMENTALI DI COMPORTAMENTO:
1. RISPONDI RIGOROSAMENTE IN ITALIANO.
2. REGOLA DEL SALUTO: ${greetingRule}
3. CONCISO, DIRETTO E NATURALE (MASSIMA PRIORITÀ):
   - Evita preamboli inutili o lezioni teoriche non richieste.
   - Sii conciso, pragmatico e chiaro: come un vero coach/specialista in chat privata.
4. TONO PROFESSIONALE E SOBRIO: Calmo, autorevole, zero entusiasmo finto (vietato 'carro armato', 'macchina da guerra', 'non ce ne frega niente').
5. ZERO ASTERISCHI NEL TESTO: Non usare mai asterischi (* o **).
6. ZERO TABELLE ASCII: Nessuna tabella con barre o trattini.
7. CONCLUDI SEMPRE IL DISCORSO senza lasciarlo a metà.
8. PERTINENZA ASSOLUTA:
   - Rispondi sempre e solo a quello che Michele ti chiede.
   - I dati BIA o le nozioni ortopediche servono come tuo bagaglio di competenze: tirali fuori SOLO quando Michele fa domande dirette a riguardo.

LE TUE SPECIALIZZAZIONI ED EXPERTISE (DA APPLICARE QUANDO PERTINENTE):
1. ORTOPEDIA DELLO SPORT & BIOMECCANICA CLINICA (ANAMNESI CHIRURGICA DI MICHELE):
   - Discectomia L5-S1 (a 20 anni): l'anello fibroso e lo spazio discale tra quinta lombare e prima sacrale hanno una resilienza elastica ridotta. Con 99 kg di stazza, i carichi assiali diretti (back squat pesante, military press pesante da in piedi) creano picchi di compressione discale e taglio anteriore. Prediligere lavoro in catena chiusa senza carico assiale (leg press bilaterale/unilaterale controllata, bulgarian split squat con manubri lungo i fianchi, hip thrust guidato). Per la de-compressione: trazioni alla sbarra con scarico del bacino, posizione a 90° psoas-relax, rinforzo profondo del muscolo trasverso dell'addome e multifido (core bracings).
   - Meniscectomia parziale esterna ginocchio sx (operato due volte a 16 e 17 anni): il menisco laterale gestisce oltre il 70% del carico in rotazione e flessione dell'arto inferiore. Un ginocchio con meniscectomia parziale esterna è più vulnerabile a valgismo dinamico e usura cartilaginea femoro-tibiale laterale. Lavoro essenziale: rinforzo vasto mediale obliquo (VMO), gluteo medio (stabilità anca-ginocchio), mobilità caviglia per evitare compensi in eversione/valgismo durante la corsa.
   - Pregressa asportazione tumore a cellule giganti tendine quadricipitale sx (2018): apparato estensore con cicatrice tendinea superiore alla rotula. Evitare stress eccessivi con angolo al ginocchio >90° sotto carico esplosivo senza riscaldamento. Isometria sul quadricipite (spanish squat, wall sit isonometrico) per migliorare la densità tendinea e la tolleranza al carico nelle stazioni Hyrox (Wall Balls, Burpees).

2. BIOIMPEDENZIOMETRIA VETTORIALE (BIVA & AKERN CLINICA):
   - PhA 8.8° e BCM 57.1 kg: elevata cellularità muscolare e ottima idratazione cellulare (ICW). Zero ritenzione infiammatoria extracellulare (ECW stabile).

3. TELEMETRIA HYROX & PACING:
   - Target Gara: SUB-1h 20m. Vantaggio biomeccanico su SkiErg/Rower (920-950 Cal/hr). Corsa 8x1000m a 5:00 min/km con cadenza 174-178 spm per ammortizzare l'impatto articolare sulla schiena e sul ginocchio sx.

4. NUTRIZIONE SPORTIVA & INTEGRAZIONE:
   - Apporto proteico ~180-200g/die per la stazza muscolare. Creatina 5g post-workout in acqua con carboidrati.`;

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
      const chatHistory = await getRecentChatHistory(chatId, 30, 60);
      const mime = msg.voice ? "audio/ogg" : (audioObj.mime_type || "audio/mp3");

      const parts = [
        { text: `DATI ATLETA:\n${mem}\n\nCRONOLOGIA COMPLETA DEGLI ULTIMI 30 GIORNI (CON DATE E ORE):\n${chatHistory}\n\nMichele ti ha inviato una nota vocale. Ascolta e rispondi rimanendo perfettamente coerente con tutta la conversazione recente e passata, con tono sobrio e senza tabelle o asterischi.` },
        { inlineData: { mimeType: mime, data: base64Audio } }
      ];

      const reply = await callGemini(systemPrompt, parts);
      await sendTelegram(chatId, reply);
      await recordChatMessage(chatId, "user", "[Nota Vocale]");
      await recordChatMessage(chatId, "assistant", reply);
      return new Response("OK", { status: 200 });
    }

    // 2. Gestione Foto
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
      const chatHistory = await getRecentChatHistory(chatId, 30, 60);
      const todayMacros = await getTodayMacroSummary();

      const promptText = `DATI ATLETA:\n${mem}\n\nCRONOLOGIA COMPLETA DEGLI ULTIMI 30 GIORNI (CON DATE E ORE):\n${chatHistory}\n\n${todayMacros}\n\nFOTO INVIATA DA MICHELE. Didascalia: "${caption}".

COMPITO:
1. SE LA FOTO È UN PIATTO O CIBO:
   - Stima chiara e diretta dei valori: Calorie, Carboidrati, Proteine, Grassi.
   - Includi in fondo al messaggio un blocco JSON nascosto su una riga: <!--MEAL:{"name":"Pranzo","calories":750,"carbs":80,"protein":45,"fat":25}--> per salvarlo nel diario.

2. SE LA FOTO È UNO SCREENSHOT DI FIT SQUARE / HYROX / CROSSFIT (WOD, circuito, lavagna o scheda di allenamento):
   - Leggi e decodifica tutti gli esercizi del circuito (stazioni, carichi in kg, ripetizioni, tempi o round AMRAP/EMOM).
   - Analizza la fattibilità per Michele tenendo conto della stazza (99 kg) e delle protezioni articolari (discectomia L5-S1 e ginocchio sx operato).
   - Dai la strategia di pacing (come gestire il ritmo cardiaco, dove spingere e dove risparmiarsi) e le eventuali alternative sicure se c'è un esercizio rischioso.
   - NUTRIZIONE & TIMING PRE-WORKOUT (FONDAMENTALE SE INVIATO AL MATTINO O PRIMA DI PRANZO):
     - Dagli consigli precisi su cosa mangiare a pranzo e come spuntino pomeridiano per arrivare alla sessione serale (ore 18:00 / 18:30) con le riserve di glicogeno muscolare piene ma a stomaco leggero.
     - Indicagli la quota di carboidrati complessi a pranzo (es. riso o quinoa), proteine magre, zero grassi pesanti che rallentano lo svuotamento gastrico e il timing di idratazione (bere almeno 2L entro le 16:30).
   - Salva gli esercizi nel database di forza includendo in fondo: <!--STRENGTH:[{"exercise":"Nome Esercizio","sets":4,"reps":10,"weight":50}]--> se sono presenti carichi/serie.

3. Stile: Diretto, sintetico, professionale, zero asterischi e zero tabelle.`;

      const parts = [
        { text: promptText },
        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ];

      const rawReply = await callGemini(systemPrompt, parts);

      // Estrazione del blocco MEAL se presente per salvarlo nel database Supabase
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

      // Estrazione del blocco STRENGTH se presente dalla foto
      const strengthMatch = rawReply.match(/<!--STRENGTH:(\[.*?\])-->/);
      if (strengthMatch) {
        try {
          const list = JSON.parse(strengthMatch[1]);
          const today = new Date().toISOString().split("T")[0];
          for (const item of list) {
            await fetch(`${SUPABASE_URL}/rest/v1/strength_workouts`, {
              method: "POST",
              headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                workout_date: today,
                exercise_name: item.exercise || "Esercizio WOD",
                sets: item.sets || 1,
                reps: item.reps || 0,
                weight_kg: item.weight || 0,
                notes: "Estratto da screenshot FitSquare"
              })
            });
          }
        } catch (e) {
          console.error("Strength from photo error", e);
        }
      }

      // Rimuoviamo i tag invisibili prima di inviare a Telegram
      let cleanReply = rawReply.replace(/<!--MEAL:.*?-->/g, "");
      cleanReply = cleanReply.replace(/<!--STRENGTH:.*?-->/g, "").trim();

      await sendTelegram(chatId, cleanReply);
      await recordChatMessage(chatId, "user", `[Foto]: ${caption}`);
      await recordChatMessage(chatId, "assistant", cleanReply);
      return new Response("OK", { status: 200 });
    }

    // 3. Gestione File Documento (PDF BIA automatico o file)
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

          const biaPrompt = `Hai ricevuto un referto di Bioimpedenziometria (BIA Akern / BodygramPlus) in formato PDF da parte di Michele Gallone.
STORICO BIA PRECEDENTI NEL DATABASE:
${previousBia}

Compito:
1. Estrai tutti i valori chiave: Data esame, Peso (kg), Angolo di Fase PhA (°), BCM (kg), Massa Grassa FM (kg e %), Massa Magra FFM (kg), Acqua Totale TBW (L), Acqua Extracellulare ECW (L), Resistenza Rz (Ohm), Reattanza Xc (Ohm).
2. Fai un'analisi differenziale clinica chiara e concisa confrontando i nuovi dati con l'ultimo esame storico. Spiega l'impatto sul recupero, sulla massa muscolare e sulla preparazione Hyrox.
3. Includi in fondo al testo un tag JSON su una riga con i dati estratti per salvarli nel database:
<!--BIA:{"exam_date":"YYYY-MM-DD","weight_kg":99.0,"phase_angle":8.8,"bcm_kg":57.1,"fm_kg":11.4,"fm_percent":11.5,"ffm_kg":87.6,"tbw_liters":64.3,"ecw_liters":23.1,"rz_ohm":380,"xc_ohm":58}-->
4. Zero asterischi (* o **), zero tabelle ASCII. Stile sobrio, professionale e diretto.`;

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

    // 4. Gestione Messaggio Testo & Comandi Telegram
    if (msg.text) {
      let userText = msg.text.trim();

      // Risposte istantanee ai comandi dal menu di Telegram
      if (userText === "/forza") {
        userText = "Oggi faccio la sessione settimanale di pura forza e volume in sala pesi (panca piana, rematore, spalle/alzate laterali, gambe/squat). Analizza lo storico dei carichi precedenti registrati, dammi gli obiettivi di sovraccarico progressivo per oggi e i consigli di biomeccanica e protezione articolare (L5-S1 e ginocchio sx).";
      } else if (userText === "/gara") {
        userText = "Come imposto il pacing e la tabella di marcia per la gara Hyrox Open Men per chiudere tassativamente SUB 1 ora e 20 minuti? Dammi i tempi precisi stazioni per stazioni e corsa compresa la Roxzone.";
      } else if (userText === "/recupero") {
        userText = "Analizza i dati del mio orologio Huawei GT 6: come ho dormito stanotte e come sono la mia FC a riposo e la fatica oggi? Segnalami se ci sono rischi di sovrallenamento.";
      } else if (userText === "/macro") {
        userText = "Fammi un riepilogo dei pasti che ho registrato oggi e dimmi quante calorie e proteine mi mancano per arrivare a target.";
      } else if (userText === "/allenamento") {
        userText = "Che allenamento mi consigli di fare oggi tra FitSquare, forza o scarico aerobico?";
      } else if (userText === "/mobilita") {
        userText = "Dammi una routine rapida di mobilità articolare, allungamento e riscaldamento preventivo prima dell'allenamento.";
      } else if (userText === "/grafico") {
        const chartUrl = await generateBiaChartUrl();
        if (chartUrl) {
          await sendTelegramPhoto(chatId, chartUrl, "Ecco il grafico del tuo andamento di composizione corporea (BIA Akern): crescita della massa cellulare attiva (BCM) e dell'angolo di fase (PhA).");
          await recordChatMessage(chatId, "user", "/grafico");
          await recordChatMessage(chatId, "assistant", "[Grafico BIA inviato]");
          return new Response("OK", { status: 200 });
        } else {
          await sendTelegram(chatId, "Non ho trovato abbastanza esami BIA per generare il grafico.");
          return new Response("OK", { status: 200 });
        }
      } else if (userText === "/voce") {
        const voiceActive = await isVoiceEnabled();
        if (voiceActive) {
          await fetch(`${SUPABASE_URL}/rest/v1/coach_memory?category=eq.impostazioni&fact=like.*VOCE_ATTIVA*`, {
            method: "DELETE",
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            }
          });
          await sendTelegram(chatId, "Risposte vocali DISATTIVATE. Ora risponderò solo con messaggi di testo.");
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/coach_memory`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ category: "impostazioni", fact: "VOCE_ATTIVA: invia anche nota vocale", importance: 5 })
          });
          await sendTelegram(chatId, "Risposte vocali ATTIVATE! Da adesso riceverai anche un messaggio audio del coach insieme al testo.");
        }
        return new Response("OK", { status: 200 });
      } else if (userText === "/aiuto" || userText === "/help") {
        const helpMsg = "Ecco i comandi rapidi disponibili nel menu:\n\n" +
          "/gara - Proiezione Pacing Hyrox SUB-1h 20m\n" +
          "/recupero - Analisi sonno, FC a riposo e carico da Huawei GT 6\n" +
          "/macro - Riepilogo pasti registrati oggi e target proteico\n" +
          "/allenamento - Consigli su sessione odierna FitSquare o corsa\n" +
          "/mobilita - Routine di mobilità e prevenzione articolare\n" +
          "/aiuto - Questo messaggio informativo.\n\n" +
          "Puoi anche inviarmi normalmente messaggi di testo, note vocali, foto di piatti o PDF di referti BIA.";
        await sendTelegram(chatId, helpMsg);
        return new Response("OK", { status: 200 });
      }

      // Se Michele scrive che la schiena o il dolore è passato/guarito, aggiorniamo il database per non parlarne più
      if (/schiena passat|non mi fa pi[uù] male|dolore passat|schiena a posto|sto bene con la schiena/i.test(userText)) {
        await fetch(`${SUPABASE_URL}/rest/v1/coach_memory?category=eq.infortuni`, {
          method: "DELETE",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          }
        });
      } else if (/male|dolore|infortunio|bloccato|strappo/i.test(userText)) {
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
      const chatHistory = await getRecentChatHistory(chatId, 30, 60);
      const todayMacros = await getTodayMacroSummary();
      const strengthHistory = await getRecentStrengthWorkouts();

      const promptText = `SCHEDA E DATI ATLETA (da consultare se necessario, non ripetere a memoria se non richiesto):
${mem}
${bia}
${intervals}
${todayMacros}
${strengthHistory}

CRONOLOGIA COMPLETA DEGLI ULTIMI 30 GIORNI (CON DATE E ORE ESATTE DEI MESSAGGI):
${chatHistory}

ULTIMO MESSAGGIO DI MICHELE A CUI DEVI RISPONDERE:
"${userText}"

ISTRUZIONI PER LA RISPOSTA:
1. Analizza la cronologia per capire esattamente il filo logico.
2. Sii BREVE, DIRETTO E PRATICO: niente giri di parole. Rispondi in poche righe essenziali, esattamente come scriverebbe un coach su Telegram.
3. Se Michele ti riporta carichi, serie e ripetizioni di palestra/forza (es. "panca 4x8 con 80kg, rematore 4x10 con 70kg"):
   - Conferma i carichi e dai un commento tecnico rapido sul sovraccarico progressivo.
   - Includi in fondo al testo un tag JSON nascosto nel formato: <!--STRENGTH:[{"exercise":"Panca Piana","sets":4,"reps":8,"weight":80},{"exercise":"Rematore","sets":4,"reps":10,"weight":70}]--> così che il sistema registri i dati in automatico nel diario di forza.
4. Se Michele usa il comando /forza o chiede della seduta di volume/ipertrofia, consulta i carichi registrati nello storico sopra per suggerirgli la progressione di peso e le accortezze di setup articolare.
5. Se Michele chiede del suo ultimo allenamento, della corsa o del recupero, consulta i dati della telemetria sopra.
6. Se Michele chiede cosa mangiare o dei macro, consulta il riepilogo pasti registrati oggi sopra.
7. Zero asterischi e zero tabelle.`;

      const parts = [{ text: promptText }];
      const rawReply = await callGemini(systemPrompt, parts);

      // Estrazione del blocco STRENGTH se presente per salvarlo nel database Supabase
      const strengthMatch = rawReply.match(/<!--STRENGTH:(\[.*?\])-->/);
      if (strengthMatch) {
        try {
          const list = JSON.parse(strengthMatch[1]);
          const today = new Date().toISOString().split("T")[0];
          for (const item of list) {
            await fetch(`${SUPABASE_URL}/rest/v1/strength_workouts`, {
              method: "POST",
              headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                workout_date: today,
                exercise_name: item.exercise || "Esercizio",
                sets: item.sets || 0,
                reps: item.reps || 0,
                weight_kg: item.weight || 0,
                rpe: item.rpe || null,
                notes: item.notes || null
              })
            });
          }
        } catch (e) {
          console.error("Strength record error", e);
        }
      }

      const reply = rawReply.replace(/<!--STRENGTH:.*?-->/g, "").trim();

      await sendTelegram(chatId, reply);

      // Se le risposte vocali sono attive, invia anche la nota vocale audio
      const voiceActive = await isVoiceEnabled();
      if (voiceActive) {
        await sendTelegramVoice(chatId, reply);
      }

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
