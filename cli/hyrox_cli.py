#!/usr/bin/env python3
"""hyrox-cli: Terminale di controllo rapido per Hyrox AI Coach (Intervals.icu + Supabase)."""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone


def require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"ERRORE: Variabile d'ambiente mancante: {name}", file=sys.stderr)
        sys.exit(1)
    return val


def intervals_get(path: str) -> object:
    athlete_id = require_env("INTERVALS_ATHLETE_ID")
    api_key = require_env("INTERVALS_API_KEY")
    auth = base64.b64encode(f"API_KEY:{api_key}".encode()).decode()
    url = f"https://intervals.icu/api/v1/athlete/{athlete_id}{path}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Basic {auth}", "User-Agent": "HyroxCLI/1.0"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def supabase_get(table_query: str) -> object:
    supa_url = require_env("SUPABASE_URL").rstrip("/")
    supa_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    url = f"{supa_url}/rest/v1/{table_query}"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": supa_key,
            "Authorization": f"Bearer {supa_key}",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def cmd_status(_args: argparse.Namespace) -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    past = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    w_list = intervals_get(f"/wellness?oldest={past}&newest={today}")
    if not w_list:
        print("Nessun dato wellness disponibile.")
        return
    last = w_list[-1]
    sleep_secs = last.get("sleepSecs") or 0
    ctl = float(last.get("ctl") or 0)
    atl = float(last.get("atl") or 0)
    tsb = ctl - atl
    acwr = (atl / ctl) if ctl > 0 else 1.0
    print(f"Data: {last.get('id')}")
    print(f"Sonno: {int(sleep_secs // 3600)}h {int((sleep_secs % 3600) // 60)}m")
    print(f"FC riposo: {last.get('restingHR') or 'N/D'} bpm")
    print(f"CTL: {ctl:.1f} | ATL: {atl:.1f} | TSB: {tsb:+.1f} | ACWR: {acwr:.2f}")


def cmd_workouts(args: argparse.Namespace) -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    past = (datetime.now(timezone.utc) - timedelta(days=args.days)).strftime("%Y-%m-%d")
    acts = intervals_get(f"/activities?oldest={past}&newest={today}")
    if not acts:
        print(f"Nessun allenamento negli ultimi {args.days} giorni.")
        return
    acts_sorted = sorted(
        acts,
        key=lambda a: a.get("start_date_local") or a.get("start_date") or "",
        reverse=True,
    )
    for a in acts_sorted[: args.limit]:
        dt = (a.get("start_date_local") or "")[:16].replace("T", " ")
        mins = int((a.get("moving_time") or 0) // 60)
        dist = f" | {(a['distance']/1000):.2f} km" if a.get("distance") else ""
        hr = f" | FC {a.get('average_heartrate')} (max {a.get('max_heartrate')})" if a.get("average_heartrate") else ""
        load = f" | Load {round(a['icu_training_load'])}" if a.get("icu_training_load") else ""
        print(f"[{dt}] {a.get('name') or a.get('type')}: {mins}m{dist}{hr}{load}")


def cmd_macros(_args: argparse.Namespace) -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = supabase_get(f"daily_meals?meal_date=eq.{today}&select=*")
    if not rows:
        print(f"Nessun pasto registrato oggi ({today}).")
        return
    tot = {"calories": 0, "carbs_g": 0, "protein_g": 0, "fat_g": 0}
    for r in rows:
        print(f"- {r.get('meal_name')}: {r.get('calories')} kcal (C:{r.get('carbs_g')}g P:{r.get('protein_g')}g G:{r.get('fat_g')}g)")
        for k in tot:
            tot[k] += r.get(k) or 0
    print(f"TOTALE OGGI: {tot['calories']} kcal | Carbo {tot['carbs_g']}g | Proteine {tot['protein_g']}g | Grassi {tot['fat_g']}g")


def cmd_strength(args: argparse.Namespace) -> None:
    rows = supabase_get(f"strength_workouts?select=*&order=workout_date.desc&limit={args.limit}")
    if not rows:
        print("Nessun carico di forza registrato.")
        return
    for r in rows:
        print(f"[{r.get('workout_date')}] {r.get('exercise_name')}: {r.get('sets')}x{r.get('reps')} @ {r.get('weight_kg')} kg")


def cmd_ping(_args: argparse.Namespace) -> None:
    supa_url = require_env("SUPABASE_URL").rstrip("/")
    tg_token = require_env("TELEGRAM_BOT_TOKEN")
    req_fn = urllib.request.Request(f"{supa_url}/functions/v1/telegram-bot", method="GET")
    with urllib.request.urlopen(req_fn, timeout=10) as resp:
        print(f"Edge Function telegram-bot: HTTP {resp.status}")
    req_tg = urllib.request.Request(f"https://api.telegram.org/bot{tg_token}/getWebhookInfo")
    with urllib.request.urlopen(req_tg, timeout=10) as resp:
        info = json.loads(resp.read().decode("utf-8")).get("result", {})
        print(f"Telegram Webhook: {info.get('url')} (pending={info.get('pending_update_count')})")


def main() -> None:
    parser = argparse.ArgumentParser(prog="hyrox-cli", description="CLI operativa per Hyrox AI Coach")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Mostra sonno, FC riposo, CTL, ATL, TSB e ACWR")
    p_wo = sub.add_parser("workouts", help="Elenca gli ultimi allenamenti da Intervals.icu")
    p_wo.add_argument("--days", type=int, default=7)
    p_wo.add_argument("--limit", type=int, default=5)

    sub.add_parser("macros", help="Mostra i pasti e macro registrati oggi su Supabase")
    p_st = sub.add_parser("strength", help="Mostra gli ultimi carichi di forza registrati")
    p_st.add_argument("--limit", type=int, default=10)

    sub.add_parser("ping", help="Verifica Edge Function Supabase e Webhook Telegram")

    args = parser.parse_args()
    dispatch = {
        "status": cmd_status,
        "workouts": cmd_workouts,
        "macros": cmd_macros,
        "strength": cmd_strength,
        "ping": cmd_ping,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
