"""
F&O Engine — Nifty / BankNifty / Sensex Options & Futures Signal Generator
Suggests strike price, expiry, CE/PE based on index signal
"""
import math
from datetime import datetime, timedelta
import pytz

IST = pytz.timezone("Asia/Kolkata")

# ── Index Config ──────────────────────────────────────────────────────────────
INDEX_CONFIG = {
    "^NSEI": {
        "name": "NIFTY",
        "lot_size": 25,
        "strike_gap": 50,        # Nifty strikes at every 50 points
        "margin_approx": 120000, # approx margin per lot for futures
        "currency": "₹",
        "exchange": "NSE",
    },
    "^NSEBANK": {
        "name": "BANKNIFTY",
        "lot_size": 15,
        "strike_gap": 100,       # BankNifty strikes at every 100 points
        "margin_approx": 45000,
        "currency": "₹",
        "exchange": "NSE",
    },
    "^BSESN": {
        "name": "SENSEX",
        "lot_size": 10,
        "strike_gap": 100,
        "margin_approx": 100000,
        "currency": "₹",
        "exchange": "BSE",
    },
    "^NSMIDCP": {
        "name": "MIDCPNIFTY",
        "lot_size": 75,
        "strike_gap": 25,
        "margin_approx": 60000,
        "currency": "₹",
        "exchange": "NSE",
    },
    "^CNXIT": {
        "name": "NIFTYIT",
        "lot_size": 25,
        "strike_gap": 50,
        "margin_approx": 80000,
        "currency": "₹",
        "exchange": "NSE",
    },
}

# ── Expiry Calculator ─────────────────────────────────────────────────────────

def get_weekly_expiry(index_name: str) -> str:
    """
    Nifty weekly expiry = every Thursday
    BankNifty weekly expiry = every Wednesday
    Sensex weekly expiry = every Friday
    """
    now = datetime.now(IST)
    expiry_day_map = {
        "NIFTY":       3,  # Thursday (0=Mon)
        "BANKNIFTY":   2,  # Wednesday
        "SENSEX":      4,  # Friday
        "MIDCPNIFTY":  1,  # Tuesday
        "NIFTYIT":     3,  # Thursday
    }
    target_weekday = expiry_day_map.get(index_name, 3)
    days_ahead = target_weekday - now.weekday()
    if days_ahead <= 0:
        days_ahead += 7
    expiry = now + timedelta(days=days_ahead)
    return expiry.strftime("%d %b %Y")  # e.g. "25 Apr 2025"


def get_monthly_expiry() -> str:
    """Last Thursday of the month"""
    now = datetime.now(IST)
    # Find last Thursday of current month
    year, month = now.year, now.month
    if month == 12:
        next_month_first = datetime(year + 1, 1, 1, tzinfo=IST)
    else:
        next_month_first = datetime(year, month + 1, 1, tzinfo=IST)
    last_day = next_month_first - timedelta(days=1)
    # Go back to find last Thursday
    while last_day.weekday() != 3:
        last_day -= timedelta(days=1)
    # If already past this month's expiry, use next month
    if last_day.date() < now.date():
        if month == 12:
            next_month_first = datetime(year + 1, 2, 1, tzinfo=IST)
        else:
            next_month_first = datetime(year, month + 2, 1, tzinfo=IST)
        last_day = next_month_first - timedelta(days=1)
        while last_day.weekday() != 3:
            last_day -= timedelta(days=1)
    return last_day.strftime("%d %b %Y")


# ── Strike Price Suggester ────────────────────────────────────────────────────

def get_nearest_strikes(price: float, strike_gap: int, n: int = 5):
    """Return n strikes above and below current price"""
    atm = round(price / strike_gap) * strike_gap
    strikes = []
    for i in range(-n, n + 1):
        strikes.append(atm + i * strike_gap)
    return sorted(strikes)


def suggest_strike(price: float, direction: str, strike_gap: int, otm_levels: int = 1) -> dict:
    """
    Suggest optimal strike based on direction.
    direction: LONG (buy CE) or SHORT (buy PE)
    otm_levels: 0 = ATM, 1 = 1 strike OTM, 2 = 2 strikes OTM
    """
    atm = round(price / strike_gap) * strike_gap

    if direction == "LONG":
        # For calls: ATM or slightly OTM call
        ce_strike = atm + (strike_gap * otm_levels)
        pe_strike = None
        action = "BUY CALL (CE)"
        strike = ce_strike
        option_type = "CE"
    elif direction == "SHORT":
        # For puts: ATM or slightly OTM put
        pe_strike = atm - (strike_gap * otm_levels)
        ce_strike = None
        action = "BUY PUT (PE)"
        strike = pe_strike
        option_type = "PE"
    else:
        strike = atm
        option_type = "CE/PE"
        action = "WAIT"

    return {
        "strike": strike,
        "option_type": option_type,
        "action": action,
        "atm": atm,
        "nearby_strikes": get_nearest_strikes(price, strike_gap, n=3),
    }


# ── Main F&O Signal Generator ─────────────────────────────────────────────────

def generate_fo_signal(symbol: str, trade_setup: dict, indicators: dict) -> dict:
    """
    Given a trade setup from signal_engine, generate F&O specific details.
    trade_setup: dict from TradeSetup dataclass
    indicators: raw indicators dict
    """
    config = INDEX_CONFIG.get(symbol)
    if not config:
        return {"supported": False, "reason": "Symbol not in F&O list"}

    price = indicators["price"]
    direction = trade_setup.get("direction", "FLAT")
    signal = trade_setup.get("signal", "NEUTRAL")
    confluence = trade_setup.get("confluence", 0)
    entry = trade_setup.get("entry", price)
    sl = trade_setup.get("stop_loss", price)
    t1 = trade_setup.get("target1", price)
    t2 = trade_setup.get("target2", price)

    strike_gap = config["strike_gap"]
    lot_size = config["lot_size"]
    index_name = config["name"]

    # Suggest strike
    # Use ATM for strong signals, 1 OTM for normal signals
    otm_levels = 0 if "STRONG" in signal else 1
    strike_info = suggest_strike(price, direction, strike_gap, otm_levels)

    # Expiry recommendation based on signal strength
    weekly_exp = get_weekly_expiry(index_name)
    monthly_exp = get_monthly_expiry()

    if "STRONG" in signal or confluence >= 70:
        recommended_expiry = weekly_exp
        expiry_reason = "Strong signal — weekly expiry for quick move"
    else:
        recommended_expiry = monthly_exp
        expiry_reason = "Moderate signal — monthly expiry for safer trade"

    # Points calculation
    if direction == "LONG":
        risk_points = round(entry - sl, 0)
        target1_points = round(t1 - entry, 0)
        target2_points = round(t2 - entry, 0)
    elif direction == "SHORT":
        risk_points = round(sl - entry, 0)
        target1_points = round(entry - t1, 0)
        target2_points = round(entry - t2, 0)
    else:
        risk_points = target1_points = target2_points = 0

    # Option strategy
    if direction == "LONG":
        strategy = "Buy Call Option"
        hedge = f"Sell {strike_info['strike'] + strike_gap} CE (optional hedge)"
    elif direction == "SHORT":
        strategy = "Buy Put Option"
        hedge = f"Sell {strike_info['strike'] - strike_gap} PE (optional hedge)"
    else:
        strategy = "No Trade — Wait for clear signal"
        hedge = ""

    # Futures info
    futures_signal = {
        "action": "BUY Futures" if direction == "LONG" else ("SELL Futures" if direction == "SHORT" else "NO TRADE"),
        "entry": entry,
        "sl": sl,
        "target1": t1,
        "target2": t2,
        "approx_margin": config["margin_approx"],
        "lot_size": lot_size,
        "risk_per_lot": round(risk_points * lot_size, 0),
        "profit_t1_per_lot": round(target1_points * lot_size, 0),
        "profit_t2_per_lot": round(target2_points * lot_size, 0),
    }

    return {
        "supported": True,
        "index_name": index_name,
        "lot_size": lot_size,
        "strike_gap": strike_gap,
        "current_index": round(price, 2),

        # Options
        "options": {
            "strike": strike_info["strike"],
            "option_type": strike_info["option_type"],
            "action": strike_info["action"],
            "atm_strike": strike_info["atm"],
            "strategy": strategy,
            "hedge_suggestion": hedge,
            "expiry_weekly": weekly_exp,
            "expiry_monthly": monthly_exp,
            "recommended_expiry": recommended_expiry,
            "expiry_reason": expiry_reason,
            "nearby_strikes": strike_info["nearby_strikes"],
        },

        # Futures
        "futures": futures_signal,

        # Key levels in points
        "levels": {
            "entry_level": round(entry, 0),
            "sl_level": round(sl, 0),
            "target1_level": round(t1, 0),
            "target2_level": round(t2, 0),
            "risk_points": risk_points,
            "target1_points": target1_points,
            "target2_points": target2_points,
        },
    }


def fo_alert_message(symbol: str, fo: dict, signal: str) -> str:
    """Format a clean Telegram alert for F&O"""
    if not fo.get("supported"):
        return ""

    emoji = "🟢" if "BUY" in signal else ("🔴" if "SELL" in signal else "⚪")
    opt = fo["options"]
    fut = fo["futures"]
    lvl = fo["levels"]
    name = fo["index_name"]

    msg = (
        f"{emoji} <b>{signal} — {name} F&O Signal</b>\n\n"
        f"📊 <b>Index Level:</b> {fo['current_index']:,.0f}\n\n"
        f"<b>── OPTIONS ──</b>\n"
        f"Trade: <b>{opt['action']}</b>\n"
        f"Strike: <b>{opt['strike']} {opt['option_type']}</b>\n"
        f"Expiry: {opt['recommended_expiry']}\n"
        f"Strategy: {opt['strategy']}\n\n"
        f"<b>── FUTURES ──</b>\n"
        f"Action: <b>{fut['action']}</b>\n"
        f"Entry: {lvl['entry_level']:,.0f} pts\n"
        f"Stop Loss: {lvl['sl_level']:,.0f} pts  ({lvl['risk_points']:,.0f} pts risk)\n"
        f"Target 1: {lvl['target1_level']:,.0f} pts  (+{lvl['target1_points']:,.0f} pts)\n"
        f"Target 2: {lvl['target2_level']:,.0f} pts  (+{lvl['target2_points']:,.0f} pts)\n\n"
        f"Lot Size: {fo['lot_size']} | Risk/Lot: ₹{fut['risk_per_lot']:,.0f}\n"
        f"Profit T1/Lot: ₹{fut['profit_t1_per_lot']:,.0f} | T2/Lot: ₹{fut['profit_t2_per_lot']:,.0f}"
    )
    return msg
