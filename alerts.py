"""
Alert System — Simplified (no Telegram, no email)
Sab kuch chart pe dikhta hai — signal overlay + F&O overlay
"""

class AlertDispatcher:
    """Placeholder — alerts disabled. All signals shown on chart."""
    def __init__(self, config: dict = {}):
        pass

    async def dispatch(self, message: str, signal: str, symbol: str):
        # Signals are shown directly on the chart — no external alerts needed
        if signal in ("STRONG BUY", "STRONG SELL"):
            print(f"[Signal] {signal} — {symbol}")
