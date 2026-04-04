"""
Smart Trading Signal Engine — FastAPI Backend v2.1
"""
import json, asyncio, time, os
from dataclasses import asdict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from indicators import compute_all_indicators
from signal_engine import generate_signal, signal_to_alert_message
from data_fetcher import fetch_ohlcv, get_candles_for_chart, search_symbol, normalize_symbol
from alerts import AlertDispatcher
from fo_engine import generate_fo_signal, fo_alert_message, INDEX_CONFIG
import config

app = FastAPI(title="Signal Engine", version="2.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
alert_dispatcher = AlertDispatcher()
signal_history: dict = {}

def load_history():
    global signal_history
    try:
        if os.path.exists(config.SIGNAL_HISTORY_FILE):
            with open(config.SIGNAL_HISTORY_FILE) as f:
                signal_history = json.load(f)
    except Exception:
        signal_history = {}

def save_history():
    try:
        with open(config.SIGNAL_HISTORY_FILE, "w") as f:
            json.dump(signal_history, f)
    except Exception:
        pass

def record_signal(symbol, entry):
    signal_history.setdefault(symbol, []).insert(0, entry)
    signal_history[symbol] = signal_history[symbol][:config.MAX_HISTORY_PER_SYMBOL]
    save_history()

async def analyze_symbol(symbol, timeframe):
    df      = fetch_ohlcv(symbol, timeframe, bars=200)
    ind     = compute_all_indicators(df)
    setup   = generate_signal(ind, symbol)
    candles = get_candles_for_chart(df, last_n=100)
    overlay = {
        "ema20":       ind.pop("ema20_series",  []),
        "ema50":       ind.pop("ema50_series",  []),
        "bb_upper":    ind.pop("bb_upper_series",  []),
        "bb_middle":   ind.pop("bb_middle_series", []),
        "bb_lower":    ind.pop("bb_lower_series",  []),
        "rsi":         ind.pop("rsi_series",    []),
        "macd":        ind.pop("macd_series",   []),
        "macd_signal": ind.pop("signal_series", []),
        "macd_hist":   ind.pop("hist_series",   []),
    }
    fo_signal    = None
    fo_supported = symbol in INDEX_CONFIG
    if fo_supported:
        try:
            fo_signal = generate_fo_signal(symbol, asdict(setup), ind)
        except Exception as e:
            print(f"[F&O] {e}")
    record_signal(symbol, {
        "signal": setup.signal, "confluence": setup.confluence,
        "entry": setup.entry, "stop_loss": setup.stop_loss,
        "target1": setup.target1, "target2": setup.target2,
        "risk_reward": setup.risk_reward, "timeframe": timeframe,
        "timestamp": setup.timestamp,
    })
    return {
        "symbol": symbol, "timeframe": timeframe,
        "setup": asdict(setup), "indicators": ind,
        "candles": candles, "overlay": overlay,
        "fo": fo_signal, "fo_supported": fo_supported,
        "server_time": time.time(),
    }

# ── API endpoints ──────────────────────────────────────────────────────────────
@app.get("/api/analyze")
async def analyze(symbol: str, timeframe: str = "1d"):
    symbol = normalize_symbol(symbol)
    try:
        return await analyze_symbol(symbol, timeframe)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/search")
async def search(q: str):
    return search_symbol(q)

@app.get("/api/history/{symbol}")
async def get_history(symbol: str):
    return signal_history.get(normalize_symbol(symbol), [])

@app.get("/api/watchlist")
async def get_watchlist():
    results = []
    for sym in config.DEFAULT_SYMBOLS:
        try:
            df  = fetch_ohlcv(sym, "1d", bars=100)
            ind = compute_all_indicators(df)
            for k in ["ema20_series","ema50_series","bb_upper_series","bb_middle_series",
                      "bb_lower_series","rsi_series","macd_series","signal_series","hist_series"]:
                ind.pop(k, None)
            setup = generate_signal(ind, sym)
            results.append({"symbol":sym,"price":ind["price"],"signal":setup.signal,"confluence":setup.confluence,"rsi":ind["rsi"]})
        except Exception as e:
            results.append({"symbol":sym,"error":str(e)})
    return results

@app.get("/api/health")
async def health():
    return {"status":"ok","version":"2.1.0"}

# ── WebSocket ──────────────────────────────────────────────────────────────────
@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=120)
            req = json.loads(raw)
            sym = normalize_symbol(req.get("symbol","^NSEI"))
            tf  = req.get("timeframe","1d")
            try:
                result = await analyze_symbol(sym, tf)
                await websocket.send_json(result)
            except Exception as e:
                await websocket.send_json({"error":str(e)})
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception as e:
        print(f"[WS] {e}")

# ── Frontend serving — works whether files are in /frontend or root ────────────
BASE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.join(BASE, "..")

def find_file(filename):
    """Search for frontend file in multiple locations"""
    candidates = [
        os.path.join(REPO_ROOT, "frontend", filename),  # frontend/ folder
        os.path.join(REPO_ROOT, filename),               # repo root
        os.path.join(BASE, filename),                    # backend/ folder
        os.path.join(BASE, "..", "frontend", filename),  # relative frontend
    ]
    for path in candidates:
        p = os.path.normpath(path)
        if os.path.isfile(p):
            return p
    return None

@app.get("/")
async def serve_index():
    path = find_file("index.html")
    if path:
        return FileResponse(path, media_type="text/html")
    return HTMLResponse("<h2>index.html not found. Check GitHub upload.</h2>", status_code=404)

@app.get("/chart.js")
async def serve_chartjs():
    path = find_file("chart.js")
    if path:
        return FileResponse(path, media_type="application/javascript")
    raise HTTPException(404, "chart.js not found")

@app.get("/signals.js")
async def serve_signalsjs():
    path = find_file("signals.js")
    if path:
        return FileResponse(path, media_type="application/javascript")
    raise HTTPException(404, "signals.js not found")

# ── Startup ────────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def on_startup():
    load_history()
    # Log where we found frontend files
    for f in ["index.html","chart.js","signals.js"]:
        p = find_file(f)
        print(f"[Frontend] {f} -> {p or 'NOT FOUND'}")
    print(f"🚀 Signal Engine v2.1 live on port {config.APP_PORT}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=config.APP_HOST, port=config.APP_PORT, reload=False)
