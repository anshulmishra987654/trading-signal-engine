"""
Technical Indicators Calculator
Calculates RSI, MACD, EMA, Bollinger Bands, Volume Spike, Support/Resistance
"""
import pandas as pd
import numpy as np


def calculate_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    delta = prices.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calculate_macd(prices: pd.Series, fast=12, slow=26, signal=9):
    ema_fast = prices.ewm(span=fast, adjust=False).mean()
    ema_slow = prices.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def calculate_ema(prices: pd.Series, period: int) -> pd.Series:
    return prices.ewm(span=period, adjust=False).mean()


def calculate_bollinger_bands(prices: pd.Series, period: int = 20, std_dev: float = 2.0):
    middle = prices.rolling(window=period).mean()
    std = prices.rolling(window=period).std()
    upper = middle + (std * std_dev)
    lower = middle - (std * std_dev)
    return upper, middle, lower


def detect_volume_spike(volume: pd.Series, window: int = 20, threshold: float = 1.5) -> pd.Series:
    avg_volume = volume.rolling(window=window).mean()
    return volume > (avg_volume * threshold)


def find_support_resistance(df: pd.DataFrame, window: int = 10, n_levels: int = 3):
    """Find key support and resistance levels from recent highs/lows"""
    highs = df['high'].rolling(window=window, center=True).max()
    lows = df['low'].rolling(window=window, center=True).min()

    resistance_mask = df['high'] == highs
    support_mask = df['low'] == lows

    resistance_levels = df['high'][resistance_mask].tail(20).values
    support_levels = df['low'][support_mask].tail(20).values

    def cluster_levels(levels, tolerance_pct=0.005):
        if len(levels) == 0:
            return []
        levels = sorted(levels, reverse=True)
        clusters = []
        current_cluster = [levels[0]]
        for lvl in levels[1:]:
            if abs(lvl - current_cluster[-1]) / current_cluster[-1] < tolerance_pct:
                current_cluster.append(lvl)
            else:
                clusters.append(np.mean(current_cluster))
                current_cluster = [lvl]
        clusters.append(np.mean(current_cluster))
        return clusters[:n_levels]

    return cluster_levels(resistance_levels), cluster_levels(support_levels)


def compute_all_indicators(df: pd.DataFrame) -> dict:
    """
    Given a DataFrame with columns: open, high, low, close, volume
    Returns a dict of all computed indicators for the latest bar
    """
    close = df['close']
    high = df['high']
    low = df['low']
    volume = df['volume']

    # RSI
    rsi = calculate_rsi(close)
    rsi_val = rsi.iloc[-1]

    # MACD
    macd_line, signal_line, histogram = calculate_macd(close)
    macd_val = macd_line.iloc[-1]
    signal_val = signal_line.iloc[-1]
    hist_val = histogram.iloc[-1]
    prev_hist = histogram.iloc[-2] if len(histogram) > 1 else 0
    macd_bullish_cross = hist_val > 0 and prev_hist <= 0
    macd_bearish_cross = hist_val < 0 and prev_hist >= 0
    macd_bullish = hist_val > 0
    macd_bearish = hist_val < 0

    # EMA crossover
    ema20 = calculate_ema(close, 20)
    ema50 = calculate_ema(close, 50)
    ema20_val = ema20.iloc[-1]
    ema50_val = ema50.iloc[-1]
    prev_ema20 = ema20.iloc[-2] if len(ema20) > 1 else ema20_val
    prev_ema50 = ema50.iloc[-2] if len(ema50) > 1 else ema50_val
    ema_bullish_cross = ema20_val > ema50_val and prev_ema20 <= prev_ema50
    ema_bearish_cross = ema20_val < ema50_val and prev_ema20 >= prev_ema50
    ema_bullish = ema20_val > ema50_val
    ema_bearish = ema20_val < ema50_val

    # Bollinger Bands
    bb_upper, bb_middle, bb_lower = calculate_bollinger_bands(close)
    current_price = close.iloc[-1]
    bb_upper_val = bb_upper.iloc[-1]
    bb_lower_val = bb_lower.iloc[-1]
    bb_middle_val = bb_middle.iloc[-1]
    bb_touch_lower = current_price <= bb_lower_val
    bb_touch_upper = current_price >= bb_upper_val
    bb_pct = (current_price - bb_lower_val) / (bb_upper_val - bb_lower_val) if (bb_upper_val - bb_lower_val) != 0 else 0.5

    # Volume spike
    volume_spike = detect_volume_spike(volume)
    has_volume_spike = bool(volume_spike.iloc[-1])
    current_volume = volume.iloc[-1]
    avg_volume = volume.rolling(20).mean().iloc[-1]

    # Support / Resistance
    resistance_levels, support_levels = find_support_resistance(df)

    # Nearest support (for stop loss)
    nearest_support = max([s for s in support_levels if s < current_price], default=current_price * 0.97)
    nearest_resistance = min([r for r in resistance_levels if r > current_price], default=current_price * 1.03)

    return {
        "price": current_price,
        "rsi": round(rsi_val, 2),
        "macd": round(macd_val, 4),
        "macd_signal": round(signal_val, 4),
        "macd_hist": round(hist_val, 4),
        "macd_bullish": macd_bullish,
        "macd_bearish": macd_bearish,
        "macd_bullish_cross": macd_bullish_cross,
        "macd_bearish_cross": macd_bearish_cross,
        "ema20": round(ema20_val, 2),
        "ema50": round(ema50_val, 2),
        "ema_bullish": ema_bullish,
        "ema_bearish": ema_bearish,
        "ema_bullish_cross": ema_bullish_cross,
        "ema_bearish_cross": ema_bearish_cross,
        "bb_upper": round(bb_upper_val, 2),
        "bb_middle": round(bb_middle_val, 2),
        "bb_lower": round(bb_lower_val, 2),
        "bb_pct": round(bb_pct, 3),
        "bb_touch_lower": bb_touch_lower,
        "bb_touch_upper": bb_touch_upper,
        "volume": int(current_volume),
        "avg_volume": int(avg_volume) if not np.isnan(avg_volume) else 0,
        "volume_spike": has_volume_spike,
        "support_levels": [round(s, 2) for s in support_levels],
        "resistance_levels": [round(r, 2) for r in resistance_levels],
        "nearest_support": round(nearest_support, 2),
        "nearest_resistance": round(nearest_resistance, 2),
        # Series for charting (last 100 bars)
        "ema20_series": ema20.tail(100).round(2).tolist(),
        "ema50_series": ema50.tail(100).round(2).tolist(),
        "bb_upper_series": bb_upper.tail(100).round(2).tolist(),
        "bb_middle_series": bb_middle.tail(100).round(2).tolist(),
        "bb_lower_series": bb_lower.tail(100).round(2).tolist(),
        "rsi_series": rsi.tail(100).round(2).tolist(),
        "macd_series": macd_line.tail(100).round(4).tolist(),
        "signal_series": signal_line.tail(100).round(4).tolist(),
        "hist_series": histogram.tail(100).round(4).tolist(),
    }
