"""
Smart Trading Signal Engine — FastAPI Backend
Run: uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""
import json
import asyncio
import time
import os
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Local imports
import sys
sys.path.insert(0, os.path.dirname(__file__))

from indicators import compute_all_indicators
from signal_engine import generate_signal, signal_to_alert_message
from data_fetcher import fetch_ohlcv, get_candles_for_chart, search_symbol, normalize_symbol
from alerts import AlertDispatcher
import config

# ── App Setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Smart Trading Signal Engine",
    version="1.0.0",
    description="Real-time trading signals with confluence scoring"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Alert dispatcher
alert_dispatcher = AlertDispatcher(config.ALERTS)

# Signal history store (in-memory + file persistence)
signal_history: dict = {}

# Active WebSocket connections
ws_clients: list = []


# ── Persistence ───────────────────────────────────────────────────────────────
def load_history():
    global signal_history
    if os.path.exists(config.SIGNAL_HISTORY_FILE):
        try:
            with open(config.SIGNAL_HISTORY_FILE) as f:
                signal_history = json.load(f)
        except Exception:
            signal_history = {}


def save_history():
    try:
        with open(config.SIGNAL_HISTORY_FILE, "w") as f:
            json.dump(signal_history, f)
    except Exception as e:
        print(f"[History] Save error: {e}")


def record_signal(symbol: str, setup_dict: dict):
    if symbol not in signal_history:
        signal_history[symbol] = []
    signal_history[symbol].insert(0, setup_dict)
    signal_history[symbol] = signal_history[symbol][:config.MAX_HISTORY_PER_SYMBOL]
    save_history()


# ── Core Analysis ─────────────────────────────────────────────────────────────
async def analyze_symbol(symbol: str, timeframe: str) -> dict:
    """Full pipeline: fetch → indicators → signal → result dict"""
    df = fetch_ohlcv(symbol, timeframe, bars=200)
    ind = compute_all_indicators(df)
    setup = generate_signal(ind, symbol)
    candles = get_candles_for_chart(df, last_n=100)

    result = {
        "symbol": symbol,
        "timeframe": timeframe,
        "setup": asdict(setup),
        "indicators": ind,
        "candles": candles,
        "alert_message": signal_to_alert_message(setup, symbol),
        "server_time": time.time(),
    }

    # Remove large series from indicators (sent separately for efficiency)
    for key in ["ema20_series", "ema50_series", "bb_upper_series", "bb_middle_series",
                "bb_lower_series", "rsi_series", "macd_series", "signal_series", "hist_series"]:
        result["indicators"].pop(key, None)

    # Store overlay series in separate key
    result["overlay"] = {
        "ema20": ind.get("ema20_series", []),
        "ema50": ind.get("ema50_series", []),
        "bb_upper": ind.get("bb_upper_series", []),
        "bb_middle": ind.get("bb_middle_series", []),
        "bb_lower": ind.get("bb_lower_series", []),
        "rsi": ind.get("rsi_series", []),
        "macd": ind.get("macd_series", []),
        "macd_signal": ind.get("signal_series", []),
        "macd_hist": ind.get("hist_series", []),
    }

    # Record to history
    hist_entry = {
        "signal": setup.signal,
        "confluence": setup.confluence,
        "entry": setup.entry,
        "stop_loss": setup.stop_loss,
        "target1": setup.target1,
        "target2": setup.target2,
        "risk_reward": setup.risk_reward,
        "timeframe": timeframe,
        "timestamp": setup.timestamp,
    }
    record_signal(symbol, hist_entry)

    # Dispatch alerts for strong signals
    asyncio.create_task(
        alert_dispatcher.dispatch(result["alert_message"], setup.signal, symbol)
    )

    return result


# ── REST Endpoints ────────────────────────────────────────────────────────────

@app.get("/api/analyze")
async def analyze(symbol: str, timeframe: str = "1d"):
    """Analyze a symbol and return full signal data"""
    symbol = normalize_symbol(symbol)
    try:
        result = await analyze_symbol(symbol, timeframe)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/search")
async def search(q: str):
    """Search for symbol suggestions"""
    return search_symbol(q)


@app.get("/api/history/{symbol}")
async def get_history(symbol: str):
    """Get signal history for a symbol"""
    symbol = normalize_symbol(symbol)
    return signal_history.get(symbol, [])


@app.get("/api/watchlist")
async def get_watchlist():
    """Get default watchlist with quick signals"""
    results = []
    for sym in config.DEFAULT_SYMBOLS:
        try:
            df = fetch_ohlcv(sym, "1d", bars=100)
            ind = compute_all_indicators(df)
            setup = generate_signal(ind, sym)
            results.append({
                "symbol": sym,
                "price": ind["price"],
                "signal": setup.signal,
                "confluence": setup.confluence,
                "rsi": ind["rsi"],
            })
        except Exception as e:
            results.append({"symbol": sym, "error": str(e)})
    return results


@app.post("/api/config/alerts")
async def update_alert_config(body: dict):
    """Update alert configuration at runtime"""
    for key in ["telegram_token", "telegram_chat_id", "smtp_user", "smtp_pass", "alert_email"]:
        if key in body:
            setattr(alert_dispatcher, key, body[key])
    return {"status": "updated"}


# ── WebSocket — Live Updates ──────────────────────────────────────────────────

@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    await websocket.accept()
    ws_clients.append(websocket)
    print(f"[WS] Client connected. Total: {len(ws_clients)}")

    try:
        while True:
            # Wait for client message: {"symbol": "RELIANCE.NS", "timeframe": "1d"}
            data = await asyncio.wait_for(websocket.receive_text(), timeout=60)
            req = json.loads(data)
            symbol = normalize_symbol(req.get("symbol", "RELIANCE.NS"))
            timeframe = req.get("timeframe", "1d")

            try:
                result = await analyze_symbol(symbol, timeframe)
                await websocket.send_json(result)
            except Exception as e:
                await websocket.send_json({"error": str(e)})

    except (WebSocketDisconnect, asyncio.TimeoutError):
        ws_clients.remove(websocket)
        print(f"[WS] Client disconnected. Total: {len(ws_clients)}")
    except Exception as e:
        print(f"[WS] Error: {e}")
        if websocket in ws_clients:
            ws_clients.remove(websocket)


# ── Static Files (frontend) ───────────────────────────────────────────────────
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    load_history()
    print("🚀 Smart Trading Signal Engine started")
    print(f"📊 Dashboard: http://localhost:{config.APP_PORT}")
    print(f"📚 API Docs:  http://localhost:{config.APP_PORT}/docs")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=config.APP_HOST, port=config.APP_PORT, reload=config.DEBUG)
