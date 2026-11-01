-- ==============================================================================
-- SCHEMA DATABASE COMPLETO PER HYROX AI COACH & SPORTS NUTRITIONIST
-- Esegui questo script nell'editor SQL di Supabase per creare tutte le tabelle.
-- ==============================================================================

-- 1. Tabella Storico Bioimpedenziometria Vettoriale (BIA Akern / BodygramPlus)
CREATE TABLE IF NOT EXISTS public.bia_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_date DATE NOT NULL,
    weight_kg NUMERIC NOT NULL,
    phase_angle NUMERIC NOT NULL,     -- Angolo di Fase (PhA)
    bcm_kg NUMERIC NOT NULL,          -- Massa Cellulare Corporea
    fm_kg NUMERIC NOT NULL,           -- Massa Grassa in kg
    fm_percent NUMERIC NOT NULL,      -- Massa Grassa in percentuale
    ffm_kg NUMERIC NOT NULL,          -- Massa Magra (Fat-Free Mass)
    tbw_liters NUMERIC NOT NULL,      -- Acqua Corporea Totale
    ecw_liters NUMERIC,               -- Acqua Extracellulare
    rz_ohm NUMERIC,                   -- Resistenza (Rz)
    xc_ohm NUMERIC,                   -- Reattanza (Xc)
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabella Tracciamento Pasti e Macronutrienti Giornalieri
CREATE TABLE IF NOT EXISTS public.daily_meals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meal_date DATE NOT NULL DEFAULT CURRENT_DATE,
    meal_name TEXT NOT NULL,          -- Colazione, Pranzo, Cena, Snack
    calories INT NOT NULL DEFAULT 0,
    carbs_g INT NOT NULL DEFAULT 0,
    protein_g INT NOT NULL DEFAULT 0,
    fat_g INT NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2b. Tabella Storico Morning Briefing Automatico al Risveglio
CREATE TABLE IF NOT EXISTS public.morning_briefings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    briefing_date DATE NOT NULL UNIQUE,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    sleep_score NUMERIC,
    resting_hr INT,
    content TEXT
);

-- 3. Tabella Memoria Clinica, Allenamento e Infortuni
CREATE TABLE IF NOT EXISTS public.coach_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL,           -- 'infortuni', 'infortuni_storici', 'nutrizione', 'obiettivi', 'profilo'
    fact TEXT NOT NULL,
    importance INT DEFAULT 3,         -- Da 1 a 5
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabella Cronologia Chat (per mantenere il contesto conversazionale)
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id BIGINT NOT NULL,
    role TEXT NOT NULL,               -- 'user' o 'assistant'
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabella Misure Corporee (Circonferenze cm)
CREATE TABLE IF NOT EXISTS public.body_measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    measurement_date DATE NOT NULL,
    chest_cm NUMERIC,
    waist_cm NUMERIC,
    hips_cm NUMERIC,
    arm_relaxed_cm NUMERIC,
    arm_flexed_cm NUMERIC,
    thigh_cm NUMERIC,
    calf_cm NUMERIC,
    wrist_cm NUMERIC,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indici per performance ottimali
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON public.chat_messages (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_meals_date ON public.daily_meals (meal_date);
CREATE INDEX IF NOT EXISTS idx_bia_records_date ON public.bia_records (exam_date DESC);
