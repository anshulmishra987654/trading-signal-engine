"""
Signal Engine — Confluence Scoring & Trade Setup Generator
Combines all indicators into a single actionable signal with entry/SL/targets
"""
from dataclasses import dataclass, asdict
from typing import List, Optional
import time


@dataclass
class TradeSetup:
    signal: str          # STRONG BUY / BUY / NEUTRAL / SELL / STRONG SELL
    confluence: int      # 0–100
    entry: float
    stop_loss: float
    target1: float
    target2: float
    risk_reward: float
    risk_pct: float
    direction: str       # LONG / SHORT / FLAT
    reasons: List[str]
    warnings: List[str]
    indicators: dict
    timestamp: float


def compute_confluence(ind: dict) -> tuple[int, list, list, str]:
    """
    Score each indicator's bullish/bearish contribution.
    Returns: (score 0-100, bullish_reasons, bearish_reasons, direction)
    """
    bullish_points = 0
    bearish_points = 0
    bullish_reasons = []
    bearish_reasons = []
    warnings = []

    # ── RSI (max 20 pts each side) ──────────────────────────────
    rsi = ind["rsi"]
    if rsi < 30:
        pts = 20 if rsi < 25 else 15
        bullish_points += pts
        bullish_reasons.append(f"RSI oversold ({rsi:.1f})")
    elif rsi > 70:
        pts = 20 if rsi > 75 else 15
        bearish_points += pts
        bearish_reasons.append(f"RSI overbought ({rsi:.1f})")
    elif rsi < 45:
        bullish_points += 5
        bullish_reasons.append(f"RSI leaning oversold ({rsi:.1f})")
    elif rsi > 55:
        bearish_points += 5
        bearish_reasons.append(f"RSI leaning overbought ({rsi:.1f})")

    # ── MACD (max 20 pts) ────────────────────────────────────────
    if ind["macd_bullish_cross"]:
        bullish_points += 20
        bullish_reasons.append("MACD bullish crossover ✅")
    elif ind["macd_bullish"]:
        bullish_points += 10
        bullish_reasons.append("MACD positive histogram")
    elif ind["macd_bearish_cross"]:
        bearish_points += 20
        bearish_reasons.append("MACD bearish crossover ✅")
    elif ind["macd_bearish"]:
        bearish_points += 10
        bearish_reasons.append("MACD negative histogram")

    # ── EMA Crossover (max 20 pts) ───────────────────────────────
    if ind["ema_bullish_cross"]:
        bullish_points += 20
        bullish_reasons.append("EMA 20 crossed above EMA 50 ✅")
    elif ind["ema_bullish"]:
        bullish_points += 10
        bullish_reasons.append("Price above EMA 50 (uptrend)")
    elif ind["ema_bearish_cross"]:
        bearish_points += 20
        bearish_reasons.append("EMA 20 crossed below EMA 50 ✅")
    elif ind["ema_bearish"]:
        bearish_points += 10
        bearish_reasons.append("Price below EMA 50 (downtrend)")

    # ── Bollinger Bands (max 20 pts) ─────────────────────────────
    if ind["bb_touch_lower"]:
        bullish_points += 20
        bullish_reasons.append("Price at lower Bollinger Band ✅")
    elif ind["bb_pct"] < 0.25:
        bullish_points += 10
        bullish_reasons.append("Price near lower Bollinger Band")
    elif ind["bb_touch_upper"]:
        bearish_points += 20
        bearish_reasons.append("Price at upper Bollinger Band ✅")
    elif ind["bb_pct"] > 0.75:
        bearish_points += 10
        bearish_reasons.append("Price near upper Bollinger Band")

    # ── Volume Spike (bonus 20 pts — confirms signal) ────────────
    vol_bonus = 0
    if ind["volume_spike"]:
        vol_bonus = 20
        warnings.append("⚡ Volume spike detected — signal confirmed")

    # ── Compute raw score ────────────────────────────────────────
    total_directional = bullish_points + bearish_points
    if total_directional == 0:
        base_score = 50
        direction = "FLAT"
    else:
        bullish_ratio = bullish_points / total_directional
        if bullish_ratio > 0.5:
            direction = "LONG"
            base_score = int(50 + bullish_ratio * 50)
        elif bullish_ratio < 0.5:
            direction = "SHORT"
            base_score = int(50 - (1 - bullish_ratio) * 50)
        else:
            direction = "FLAT"
            base_score = 50

    # Volume only boosts score if it agrees with direction
    if direction == "LONG" and ind["volume_spike"]:
        final_score = min(100, base_score + vol_bonus // 2)
    elif direction == "SHORT" and ind["volume_spike"]:
        final_score = max(0, base_score - vol_bonus // 2)
    else:
        final_score = base_score

    return final_score, bullish_reasons, bearish_reasons, direction


def generate_signal(ind: dict, symbol: str = "") -> TradeSetup:
    score, bull_reasons, bear_reasons, direction = compute_confluence(ind)
    price = ind["price"]
    nearest_support = ind["nearest_support"]
    nearest_resistance = ind["nearest_resistance"]
    warnings = []

    if ind["volume_spike"]:
        warnings.append("⚡ Volume spike — move may accelerate")

    # ── Signal classification ────────────────────────────────────
    if score >= 70 and ind["volume_spike"]:
        signal = "STRONG BUY"
    elif score >= 70:
        signal = "BUY +"
    elif score >= 50:
        signal = "BUY"
    elif score >= 40:
        signal = "NEUTRAL"
    elif score >= 30:
        signal = "SELL"
    elif score < 30 and ind["volume_spike"]:
        signal = "STRONG SELL"
    else:
        signal = "SELL -"

    # Remap for clean labels
    label_map = {
        "STRONG BUY": "STRONG BUY",
        "BUY +": "BUY",
        "BUY": "BUY",
        "NEUTRAL": "NEUTRAL",
        "SELL": "SELL",
        "SELL -": "SELL",
        "STRONG SELL": "STRONG SELL",
    }
    signal = label_map.get(signal, signal)

    # ── Trade setup (LONG) ───────────────────────────────────────
    if direction == "LONG":
        entry = price
        stop_loss = nearest_support * 0.995  # slightly below support
        risk = entry - stop_loss
        target1 = entry + risk * 1.5
        target2 = entry + risk * 2.5
        rr = round((target1 - entry) / risk, 2) if risk > 0 else 0
        risk_pct = round((risk / entry) * 100, 2) if entry > 0 else 0
        reasons = bull_reasons

    # ── Trade setup (SHORT) ──────────────────────────────────────
    elif direction == "SHORT":
        entry = price
        stop_loss = nearest_resistance * 1.005  # slightly above resistance
        risk = stop_loss - entry
        target1 = entry - risk * 1.5
        target2 = entry - risk * 2.5
        rr = round((entry - target1) / risk, 2) if risk > 0 else 0
        risk_pct = round((risk / entry) * 100, 2) if entry > 0 else 0
        reasons = bear_reasons
        signal = signal.replace("BUY", "SELL").replace("SELL", "SELL")

    # ── No trade ─────────────────────────────────────────────────
    else:
        entry = price
        stop_loss = nearest_support
        target1 = nearest_resistance
        target2 = nearest_resistance * 1.02
        rr = 0
        risk_pct = 0
        reasons = ["No clear directional bias"]

    # Safety check — avoid negative targets
    if direction == "LONG" and target2 < entry:
        target2 = entry * 1.05
    if direction == "SHORT" and target2 > entry:
        target2 = entry * 0.95

    indicator_summary = {
        "rsi": ind["rsi"],
        "macd_bullish": ind["macd_bullish"],
        "macd_cross": ind["macd_bullish_cross"] or ind["macd_bearish_cross"],
        "ema_bullish": ind["ema_bullish"],
        "ema_cross": ind["ema_bullish_cross"] or ind["ema_bearish_cross"],
        "bb_signal": "Lower" if ind["bb_touch_lower"] else ("Upper" if ind["bb_touch_upper"] else "Mid"),
        "volume_spike": ind["volume_spike"],
        "ema20": ind["ema20"],
        "ema50": ind["ema50"],
    }

    return TradeSetup(
        signal=signal,
        confluence=score,
        entry=round(entry, 2),
        stop_loss=round(stop_loss, 2),
        target1=round(target1, 2),
        target2=round(target2, 2),
        risk_reward=rr,
        risk_pct=risk_pct,
        direction=direction,
        reasons=reasons,
        warnings=warnings,
        indicators=indicator_summary,
        timestamp=time.time(),
    )


def signal_to_alert_message(setup: TradeSetup, symbol: str, currency: str = "₹") -> str:
    emoji = {
        "STRONG BUY": "🟢",
        "BUY": "🟡",
        "NEUTRAL": "⚪",
        "SELL": "🔴",
        "STRONG SELL": "🔴🔴",
    }.get(setup.signal, "⚪")

    ind = setup.indicators
    macd_icon = "✅" if ind["macd_bullish"] else "❌"
    ema_icon = "✅" if ind["ema_bullish"] else "❌"
    vol_icon = "✅" if ind["volume_spike"] else "❌"
    bb_icon = "✅" if ind["bb_signal"] == "Lower" else "❌"

    msg = (
        f"{emoji} {setup.signal} — {symbol}\n"
        f"Entry: {currency}{setup.entry:,.2f} | SL: {currency}{setup.stop_loss:,.2f}\n"
        f"T1: {currency}{setup.target1:,.2f} | T2: {currency}{setup.target2:,.2f}\n"
        f"Confluence: {setup.confluence}/100 | R:R = 1:{setup.risk_reward}\n"
        f"RSI:{ind['rsi']:.0f} MACD:{macd_icon} EMA:{ema_icon} BB:{bb_icon} Vol:{vol_icon}"
    )
    return msg
