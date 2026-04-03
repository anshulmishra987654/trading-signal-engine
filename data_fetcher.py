"""
Data Fetcher — Yahoo Finance (supports NSE, BSE, US stocks, crypto)
Includes caching to avoid rate limits
"""
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import time
import os

# Try to import yfinance
try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False

# Simple in-memory cache
_cache = {}
_CACHE_TTL = {
    "1m": 60,
    "2m": 120,
    "5m": 300,
    "15m": 600,
    "30m": 900,
    "60m": 1800,
    "1h": 1800,
    "4h": 3600,
    "1d": 3600 * 4,
}

# Timeframe → yfinance period mapping
PERIOD_MAP = {
    "1m":  ("7d",  "1m"),
    "5m":  ("60d", "5m"),
    "15m": ("60d", "15m"),
    "30m": ("60d", "30m"),
    "1h":  ("730d","1h"),
    "4h":  ("730d","1h"),   # yfinance doesn't have 4h; we resample
    "1d":  ("2y",  "1d"),
}


def normalize_symbol(symbol: str) -> str:
    """Add .NS for Indian NSE stocks if no suffix present"""
    symbol = symbol.strip().upper()
    # Already has suffix
    if "." in symbol or symbol.endswith("USDT") or symbol.endswith("-USD"):
        return symbol
    # Common crypto tickers
    crypto_tickers = ["BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "DOT", "AVAX", "MATIC", "LINK"]
    if symbol in crypto_tickers:
        return symbol + "-USD"
    # US stocks (assume if > 5 chars probably Indian)
    if len(symbol) <= 4 and symbol.isalpha():
        return symbol  # likely US stock
    # Default: assume Indian NSE
    if not symbol.endswith(".NS") and not symbol.endswith(".BO"):
        return symbol + ".NS"
    return symbol


def resample_to_4h(df: pd.DataFrame) -> pd.DataFrame:
    """Resample 1h OHLCV data to 4h"""
    df = df.resample("4h").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna()
    return df


def fetch_ohlcv(symbol: str, timeframe: str = "1d", bars: int = 200) -> pd.DataFrame:
    """
    Fetch OHLCV data for any symbol via Yahoo Finance.
    Returns DataFrame with columns: open, high, low, close, volume
    """
    if not YFINANCE_AVAILABLE:
        raise RuntimeError("yfinance not installed. Run: pip install yfinance")

    symbol = normalize_symbol(symbol)
    cache_key = f"{symbol}_{timeframe}"
    ttl = _CACHE_TTL.get(timeframe, 300)

    # Check cache
    if cache_key in _cache:
        cached_time, cached_df = _cache[cache_key]
        if time.time() - cached_time < ttl:
            return cached_df

    period, interval = PERIOD_MAP.get(timeframe, ("2y", "1d"))
    resample_4h = (timeframe == "4h")
    fetch_interval = "1h" if resample_4h else interval

    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=fetch_interval, auto_adjust=True)

        if df.empty:
            raise ValueError(f"No data returned for symbol: {symbol}")

        # Standardize column names
        df.columns = [c.lower() for c in df.columns]
        df = df[["open", "high", "low", "close", "volume"]]
        df.index = pd.to_datetime(df.index)
        df = df.dropna()

        if resample_4h:
            df = resample_to_4h(df)

        df = df.tail(max(bars, 200))  # ensure enough bars for indicators

        _cache[cache_key] = (time.time(), df)
        return df

    except Exception as e:
        raise RuntimeError(f"Failed to fetch data for {symbol}: {str(e)}")


def get_candles_for_chart(df: pd.DataFrame, last_n: int = 100) -> list:
    """Convert DataFrame to list of OHLCV dicts for charting"""
    df = df.tail(last_n)
    result = []
    for ts, row in df.iterrows():
        # Handle timezone-aware timestamps
        if hasattr(ts, 'timestamp'):
            unix_ts = int(ts.timestamp())
        else:
            unix_ts = int(ts.value // 1e9)
        result.append({
            "time": unix_ts,
            "open": round(float(row["open"]), 4),
            "high": round(float(row["high"]), 4),
            "low": round(float(row["low"]), 4),
            "close": round(float(row["close"]), 4),
            "volume": int(row["volume"]),
        })
    return result


def search_symbol(query: str) -> list:
    """Basic symbol suggestions"""
    query = query.upper().strip()
    suggestions = []

    # Popular Indian stocks
    nse_popular = [
        "RELIANCE", "TCS", "INFY", "HDFC", "HDFCBANK", "ICICIBANK",
        "SBIN", "BAJFINANCE", "WIPRO", "TATAMOTORS", "ADANIENT",
        "MARUTI", "TITAN", "ASIANPAINT", "AXISBANK", "ONGC",
        "SUNPHARMA", "LTIM", "ULTRACEMCO", "NESTLEIND", "POWERGRID",
        "BHARTIARTL", "KOTAKBANK", "NTPC", "M&M", "HINDALCO", "JSWSTEEL",
    ]
    # Popular US stocks
    us_popular = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "NFLX"]
    # Crypto
    crypto_popular = ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD", "ADA-USD"]

    for s in nse_popular:
        if query in s:
            suggestions.append({"symbol": s + ".NS", "name": s, "market": "NSE"})
    for s in us_popular:
        if query in s:
            suggestions.append({"symbol": s, "name": s, "market": "NASDAQ/NYSE"})
    for s in crypto_popular:
        if query in s.replace("-USD", ""):
            suggestions.append({"symbol": s, "name": s.replace("-USD", ""), "market": "Crypto"})

    return suggestions[:8]


def get_current_price(symbol: str) -> float:
    """Get the latest price for a symbol"""
    symbol = normalize_symbol(symbol)
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.fast_info
        return float(info.last_price)
    except Exception:
        # Fallback: fetch 1 bar
        df = fetch_ohlcv(symbol, "1d", bars=5)
        return float(df["close"].iloc[-1])
