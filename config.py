"""
Configuration — Indian Markets (NSE/BSE) — Chart-only signals
"""
import os

APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT = int(os.getenv("APP_PORT", "8000"))
DEBUG    = os.getenv("DEBUG", "true").lower() == "true"

MARKET   = "NSE"
CURRENCY = "₹"
TIMEZONE = "Asia/Kolkata"

DEFAULT_SYMBOLS = [
    "RELIANCE.NS",
    "HDFCBANK.NS",
    "INFY.NS",
    "TCS.NS",
    "ICICIBANK.NS",
    "SBIN.NS",
    "BAJFINANCE.NS",
    "TATAMOTORS.NS",
    "ADANIENT.NS",
    "WIPRO.NS",
]

INDEX_SYMBOLS = {
    "NIFTY 50":   "^NSEI",
    "BANK NIFTY": "^NSEBANK",
    "SENSEX":     "^BSESN",
}

DEFAULT_TIMEFRAME = "1d"
ALERTS = {}   # No external alerts — everything shown on chart

SIGNAL_HISTORY_FILE = os.getenv("SIGNAL_HISTORY", "./signal_history.json")
MAX_HISTORY_PER_SYMBOL = 50
