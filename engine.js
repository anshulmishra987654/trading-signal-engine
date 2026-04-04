/**
 * Signal Engine — Complete Frontend with Mock Data + Real Chart
 * Works 100% standalone — no backend needed
 */

// ── STOCK DATA ────────────────────────────────────────────────────────────────
const STOCKS = {
  NIFTY:      { name:'NIFTY 50',    base:24532, vol:180, lot:25,  strike_gap:50,  fo:true,  sector:'Index' },
  BANKNIFTY:  { name:'BANK NIFTY',  base:51240, vol:400, lot:15,  strike_gap:100, fo:true,  sector:'Index' },
  SENSEX:     { name:'SENSEX',      base:80890, vol:250, lot:10,  strike_gap:100, fo:true,  sector:'Index' },
  RELIANCE:   { name:'Reliance',    base:2847,  vol:28,  lot:250, strike_gap:20,  fo:false, sector:'Energy' },
  HDFCBANK:   { name:'HDFC Bank',   base:1654,  vol:18,  lot:550, strike_gap:10,  fo:false, sector:'Banking' },
  INFY:       { name:'Infosys',     base:1432,  vol:22,  lot:300, strike_gap:20,  fo:false, sector:'IT' },
  TCS:        { name:'TCS',         base:3521,  vol:35,  lot:150, strike_gap:20,  fo:false, sector:'IT' },
  ICICIBANK:  { name:'ICICI Bank',  base:1089,  vol:15,  lot:700, strike_gap:10,  fo:false, sector:'Banking' },
  SBIN:       { name:'SBI',         base:782,   vol:12,  lot:1500,strike_gap:5,   fo:false, sector:'Banking' },
  BAJFINANCE: { name:'Bajaj Fin',   base:6834,  vol:65,  lot:125, strike_gap:50,  fo:false, sector:'NBFC' },
  TATAMOTORS: { name:'Tata Motors', base:924,   vol:14,  lot:1425,strike_gap:5,   fo:false, sector:'Auto' },
  WIPRO:      { name:'Wipro',       base:461,   vol:8,   lot:1500,strike_gap:5,   fo:false, sector:'IT' },
};

// ── STATE ─────────────────────────────────────────────────────────────────────
let state = {
  sym: 'NIFTY', tf: '15m',
  showEma: true, showBb: true, showVol: true,
  prices: {}, signals: {}, history: [],
  charts: { main: null, rsi: null, macd: null },
  series: {},
  refreshTimer: null,
};

// ── CANDLE GENERATOR ──────────────────────────────────────────────────────────
function genCandles(sym, tf, count = 120) {
  const s = STOCKS[sym];
  const base = s.base + (Math.random() - 0.5) * s.base * 0.02;
  const volatility = s.vol;
  const now = Math.floor(Date.now() / 1000);
  const tfSecs = { '5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400 }[tf] || 900;

  let price = base;
  const candles = [];

  for (let i = count; i >= 0; i--) {
    const t = now - i * tfSecs;
    const open = price;
    const change = (Math.random() - 0.48) * volatility;
    const close = Math.max(open + change, 1);
    const high = Math.max(open, close) + Math.abs(Math.random() * volatility * 0.4);
    const low  = Math.min(open, close) - Math.abs(Math.random() * volatility * 0.4);
    const volume = Math.floor((500000 + Math.random() * 2000000) * (1 + Math.abs(change) / volatility));
    candles.push({ time: t, open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2), volume });
    price = close;
  }

  // Store current price
  state.prices[sym] = candles.at(-1).close;
  return candles;
}

// ── INDICATOR CALCULATIONS ────────────────────────────────────────────────────
function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  return closes.map(c => (ema = c * k + ema * (1 - k)));
}

function calcRSI(closes, period = 14) {
  const rsi = new Array(period).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    avgGain = (avgGain * (period-1) + Math.max(d,0)) / period;
    avgLoss = (avgLoss * (period-1) + Math.max(-d,0)) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain/avgLoss));
  }
  return rsi;
}

function calcBB(closes, period = 20, std = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return { mid: null, upper: null, lower: null };
    const slice = closes.slice(i - period + 1, i + 1);
    const mid = slice.reduce((a, b) => a + b) / period;
    const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
    const sd = Math.sqrt(variance) * std;
    return { mid: +mid.toFixed(2), upper: +(mid+sd).toFixed(2), lower: +(mid-sd).toFixed(2) };
  });
}

function calcMACD(closes, fast=12, slow=26, sig=9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => +(v - emaSlow[i]).toFixed(4));
  const signalLine = calcEMA(macdLine.slice(slow-1), sig);
  const fullSignal = new Array(slow-1).fill(null).concat(signalLine);
  const hist = macdLine.map((v, i) => fullSignal[i] !== null ? +(v - fullSignal[i]).toFixed(4) : null);
  return { macdLine, signalLine: fullSignal, hist };
}

// ── SIGNAL ENGINE ─────────────────────────────────────────────────────────────
function generateSignal(candles) {
  const closes = candles.map(c => c.close);
  const n = closes.length;

  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const rsi = calcRSI(closes);
  const bb = calcBB(closes);
  const { macdLine, signalLine, hist } = calcMACD(closes);

  const price   = closes[n-1];
  const rsiVal  = rsi[n-1] || 50;
  const ema20v  = ema20[n-1];
  const ema50v  = ema50[n-1];
  const bbData  = bb[n-1];
  const macdV   = hist[n-1] || 0;
  const macdP   = hist[n-2] || 0;

  // Score system
  let bull = 0, bear = 0, reasons = [];

  // RSI
  if (rsiVal < 30)      { bull += 25; reasons.push('RSI Oversold ('+rsiVal.toFixed(1)+')'); }
  else if (rsiVal < 45) { bull += 10; reasons.push('RSI leaning bullish'); }
  else if (rsiVal > 70) { bear += 25; reasons.push('RSI Overbought ('+rsiVal.toFixed(1)+')'); }
  else if (rsiVal > 55) { bear += 10; }

  // MACD
  if (macdV > 0 && macdP <= 0)      { bull += 25; reasons.push('MACD Bullish Crossover ✓'); }
  else if (macdV > 0)                { bull += 12; reasons.push('MACD Positive'); }
  else if (macdV < 0 && macdP >= 0) { bear += 25; reasons.push('MACD Bearish Crossover ✓'); }
  else if (macdV < 0)               { bear += 12; }

  // EMA
  if (ema20v > ema50v)  { bull += 20; reasons.push('Price above EMA50 (Uptrend)'); }
  else                  { bear += 20; }

  // Bollinger
  if (bbData.lower && price <= bbData.lower) { bull += 20; reasons.push('Price at Lower BB ✓'); }
  else if (bbData.upper && price >= bbData.upper) { bear += 20; reasons.push('Price at Upper BB ✓'); }

  // Volume
  const recentVols = candles.slice(-5).map(c => c.volume);
  const avgVol = candles.slice(-20).reduce((a,c) => a+c.volume,0) / 20;
  const volSpike = recentVols.at(-1) > avgVol * 1.5;
  if (volSpike) reasons.push('Volume Spike ⚡');

  const total = bull + bear;
  const bullRatio = total > 0 ? bull / total : 0.5;
  let score = total > 0 ? Math.round(50 + (bullRatio - 0.5) * 100) : 50;
  if (volSpike && score > 50) score = Math.min(100, score + 8);

  let signal, direction;
  if (score >= 72 && volSpike) { signal='STRONG BUY';  direction='LONG'; }
  else if (score >= 55)        { signal='BUY';          direction='LONG'; }
  else if (score >= 45)        { signal='NEUTRAL';      direction='FLAT'; }
  else if (score >= 28)        { signal='SELL';         direction='SHORT'; }
  else                         { signal='STRONG SELL';  direction='SHORT'; }

  // Trade setup
  const atr = candles.slice(-14).reduce((a,c) => a + (c.high - c.low), 0) / 14;
  let entry, sl, t1, t2;
  if (direction === 'LONG') {
    entry = price;
    sl    = +(price - atr * 1.2).toFixed(2);
    t1    = +(price + atr * 1.8).toFixed(2);
    t2    = +(price + atr * 3.0).toFixed(2);
  } else if (direction === 'SHORT') {
    entry = price;
    sl    = +(price + atr * 1.2).toFixed(2);
    t1    = +(price - atr * 1.8).toFixed(2);
    t2    = +(price - atr * 3.0).toFixed(2);
  } else {
    entry = price; sl = t1 = t2 = price;
  }
  const risk = Math.abs(entry - sl);
  const rr   = risk > 0 ? +(Math.abs(t1 - entry) / risk).toFixed(2) : 0;
  const riskPct = risk > 0 ? +((risk / entry) * 100).toFixed(2) : 0;

  return {
    signal, direction, score, entry, sl, t1, t2, rr, riskPct,
    rsi: rsiVal, ema20: ema20v, ema50: ema50v, bb: bbData,
    macdVal: macdV, volSpike, reasons,
    ema20Series: ema20, ema50Series: ema50,
    bbSeries: bb, macdSeries: { macdLine, signalLine, hist },
    rsiSeries: rsi,
  };
}

// ── F&O SIGNAL ────────────────────────────────────────────────────────────────
function getFOSignal(sym, sig) {
  const s = STOCKS[sym];
  if (!s || !s.fo) return null;
  const atm = Math.round(sig.entry / s.strike_gap) * s.strike_gap;
  const isBuy = sig.direction === 'LONG';
  const strike = isBuy ? atm : atm;
  const optType = isBuy ? 'CE' : 'PE';
  const action = isBuy ? 'BUY CALL' : 'BUY PUT';
  const risk = Math.abs(sig.entry - sig.sl) * s.lot;
  const profit = Math.abs(sig.t1 - sig.entry) * s.lot;

  // Next weekly expiry (Thursday for Nifty, Wednesday for BankNifty)
  const now = new Date();
  const days = sym === 'BANKNIFTY' ? 3 : 4; // Wed=3, Thu=4
  const diff = (days - now.getDay() + 7) % 7 || 7;
  const expiry = new Date(now); expiry.setDate(now.getDate() + diff);
  const expStr = expiry.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});

  return { action, strike: `${strike} ${optType}`, expiry: expStr, lot: s.lot, risk: Math.round(risk), profit: Math.round(profit) };
}

// ── CHART SETUP ───────────────────────────────────────────────────────────────
const CHART_OPTS = {
  layout: { background:{color:'#0a0e1a'}, textColor:'#4a5f88', fontFamily:"'JetBrains Mono',monospace", fontSize:9 },
  grid: { vertLines:{color:'#0f1629'}, horzLines:{color:'#0f1629'} },
  crosshair: { mode:LightweightCharts.CrosshairMode.Normal, vertLine:{color:'#253660',labelBackgroundColor:'#141d35'}, horzLine:{color:'#253660',labelBackgroundColor:'#141d35'} },
  rightPriceScale: { borderColor:'#1e2d4a' },
  timeScale: { borderColor:'#1e2d4a', timeVisible:true, secondsVisible:false },
};

function initCharts() {
  // Main chart
  const el = document.getElementById('cv');
  state.charts.main = LightweightCharts.createChart(el, { ...CHART_OPTS, width:el.offsetWidth, height:el.offsetHeight });
  state.series.candle = state.charts.main.addCandlestickSeries({
    upColor:'#00d68f',downColor:'#ff4d6d',borderUpColor:'#00d68f',borderDownColor:'#ff4d6d',wickUpColor:'#00d68f',wickDownColor:'#ff4d6d',
  });
  state.series.vol = state.charts.main.addHistogramSeries({ priceFormat:{type:'volume'}, priceScaleId:'vol', scaleMargins:{top:0.85,bottom:0} });
  state.charts.main.priceScale('vol').applyOptions({ scaleMargins:{top:0.85,bottom:0} });
  state.series.ema20 = state.charts.main.addLineSeries({ color:'rgba(139,92,246,.9)', lineWidth:1.5, priceLineVisible:false, lastValueVisible:false });
  state.series.ema50 = state.charts.main.addLineSeries({ color:'rgba(251,191,36,.9)', lineWidth:1.5, priceLineVisible:false, lastValueVisible:false });
  state.series.bbUp  = state.charts.main.addLineSeries({ color:'rgba(251,191,36,.35)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
  state.series.bbMid = state.charts.main.addLineSeries({ color:'rgba(251,191,36,.2)', lineWidth:1, lineStyle:3, priceLineVisible:false, lastValueVisible:false });
  state.series.bbLow = state.charts.main.addLineSeries({ color:'rgba(251,191,36,.35)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
  // Level lines
  state.series.entryLine = state.charts.main.addLineSeries({ color:'rgba(232,237,245,.6)', lineWidth:1, lineStyle:0, priceLineVisible:false, lastValueVisible:true, title:'Entry' });
  state.series.slLine    = state.charts.main.addLineSeries({ color:'rgba(255,77,109,.8)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:true, title:'SL' });
  state.series.t1Line    = state.charts.main.addLineSeries({ color:'rgba(0,214,143,.8)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:true, title:'T1' });
  state.series.t2Line    = state.charts.main.addLineSeries({ color:'rgba(0,255,157,.6)', lineWidth:1, lineStyle:3, priceLineVisible:false, lastValueVisible:true, title:'T2' });

  // RSI chart
  const rsiEl = document.getElementById('rsi-cv');
  state.charts.rsi = LightweightCharts.createChart(rsiEl, { ...CHART_OPTS, width:rsiEl.offsetWidth, height:rsiEl.offsetHeight });
  state.series.rsi = state.charts.rsi.addLineSeries({ color:'#8b5cf6', lineWidth:1.5, priceLineVisible:false });
  state.series.rsiOB = state.charts.rsi.addLineSeries({ color:'rgba(255,77,109,.3)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });
  state.series.rsiOS = state.charts.rsi.addLineSeries({ color:'rgba(0,214,143,.3)', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false });

  // MACD chart
  const macdEl = document.getElementById('macd-cv');
  state.charts.macd = LightweightCharts.createChart(macdEl, { ...CHART_OPTS, width:macdEl.offsetWidth, height:macdEl.offsetHeight });
  state.series.macdHist = state.charts.macd.addHistogramSeries({ priceLineVisible:false, lastValueVisible:false });
  state.series.macdLine = state.charts.macd.addLineSeries({ color:'#06b6d4', lineWidth:1.5, priceLineVisible:false });
  state.series.macdSig  = state.charts.macd.addLineSeries({ color:'#fbbf24', lineWidth:1.5, priceLineVisible:false });

  // Resize
  new ResizeObserver(() => {
    const e = document.getElementById('cv');
    if (state.charts.main) state.charts.main.applyOptions({ width:e.offsetWidth, height:e.offsetHeight });
    const r = document.getElementById('rsi-cv');
    if (state.charts.rsi) state.charts.rsi.applyOptions({ width:r.offsetWidth, height:r.offsetHeight });
    const m = document.getElementById('macd-cv');
    if (state.charts.macd) state.charts.macd.applyOptions({ width:m.offsetWidth, height:m.offsetHeight });
  }).observe(document.getElementById('cv'));
}

// ── CHART UPDATE ──────────────────────────────────────────────────────────────
function updateChart(candles, sig) {
  const sorted = [...candles].sort((a,b)=>a.time-b.time);
  const n = sorted.length;
  const closes = sorted.map(c=>c.close);
  const times = sorted.map(c=>c.time);

  state.series.candle.setData(sorted);

  // Volume
  if (state.showVol) {
    state.series.vol.setData(sorted.map(c=>({ time:c.time, value:c.volume, color:c.close>=c.open?'rgba(0,214,143,.3)':'rgba(255,77,109,.3)' })));
    state.series.vol.applyOptions({ visible:true });
  } else {
    state.series.vol.applyOptions({ visible:false });
  }

  // EMA
  const showE = state.showEma;
  if (showE) {
    const e20 = sig.ema20Series.map((v,i)=>v!=null?{time:times[i],value:+v.toFixed(2)}:null).filter(Boolean);
    const e50 = sig.ema50Series.map((v,i)=>v!=null?{time:times[i],value:+v.toFixed(2)}:null).filter(Boolean);
    state.series.ema20.setData(e20); state.series.ema20.applyOptions({visible:true});
    state.series.ema50.setData(e50); state.series.ema50.applyOptions({visible:true});
  } else {
    state.series.ema20.applyOptions({visible:false}); state.series.ema50.applyOptions({visible:false});
  }

  // BB
  if (state.showBb) {
    const bbu=[],bbm=[],bbl=[];
    sig.bbSeries.forEach((b,i)=>{ if(b.upper){bbu.push({time:times[i],value:b.upper});bbm.push({time:times[i],value:b.mid});bbl.push({time:times[i],value:b.lower});} });
    state.series.bbUp.setData(bbu); state.series.bbUp.applyOptions({visible:true});
    state.series.bbMid.setData(bbm); state.series.bbMid.applyOptions({visible:true});
    state.series.bbLow.setData(bbl); state.series.bbLow.applyOptions({visible:true});
  } else {
    [state.series.bbUp,state.series.bbMid,state.series.bbLow].forEach(s=>s.applyOptions({visible:false}));
  }

  // Level lines
  const first = times[0], last = times[n-1];
  if (sig.direction !== 'FLAT') {
    state.series.entryLine.setData([{time:first,value:sig.entry},{time:last,value:sig.entry}]);
    state.series.slLine   .setData([{time:first,value:sig.sl},{time:last,value:sig.sl}]);
    state.series.t1Line   .setData([{time:first,value:sig.t1},{time:last,value:sig.t1}]);
    state.series.t2Line   .setData([{time:first,value:sig.t2},{time:last,value:sig.t2}]);
    [state.series.entryLine,state.series.slLine,state.series.t1Line,state.series.t2Line].forEach(s=>s.applyOptions({visible:true}));
  } else {
    [state.series.entryLine,state.series.slLine,state.series.t1Line,state.series.t2Line].forEach(s=>s.applyOptions({visible:false}));
  }

  // BUY/SELL marker on last candle
  const sigMarkerMap = {
    'STRONG BUY':  { position:'belowBar', color:'#00d68f', shape:'arrowUp',   text:'▲ STRONG BUY' },
    'BUY':         { position:'belowBar', color:'#00ff9d', shape:'arrowUp',   text:'▲ BUY' },
    'NEUTRAL':     null,
    'SELL':        { position:'aboveBar', color:'#ff7090', shape:'arrowDown', text:'▼ SELL' },
    'STRONG SELL': { position:'aboveBar', color:'#ff4d6d', shape:'arrowDown', text:'▼ STRONG SELL' },
  };
  const mk = sigMarkerMap[sig.signal];
  state.series.candle.setMarkers(mk ? [{ time:sorted.at(-1).time, ...mk }] : []);

  // RSI
  const rsiData = sig.rsiSeries.map((v,i)=>v!=null?{time:times[i],value:+v.toFixed(2)}:null).filter(Boolean);
  state.series.rsi.setData(rsiData);
  state.series.rsiOB.setData(times.map(t=>({time:t,value:70})));
  state.series.rsiOS.setData(times.map(t=>({time:t,value:30})));

  // MACD
  const {macdLine,signalLine,hist} = sig.macdSeries;
  state.series.macdLine.setData(macdLine.map((v,i)=>v!=null?{time:times[i],value:v}:null).filter(Boolean));
  state.series.macdSig .setData(signalLine.map((v,i)=>v!=null?{time:times[i],value:v}:null).filter(Boolean));
  state.series.macdHist.setData(hist.map((v,i)=>v!=null?{time:times[i],value:v,color:v>=0?'rgba(0,214,143,.6)':'rgba(255,77,109,.6)'}:null).filter(Boolean));

  state.charts.main.timeScale().fitContent();
  state.charts.rsi.timeScale().fitContent();
  state.charts.macd.timeScale().fitContent();
}

// ── UI UPDATE ─────────────────────────────────────────────────────────────────
const COLOR = {
  'STRONG BUY':'#00d68f','BUY':'#00ff9d','NEUTRAL':'#4a5f88','SELL':'#ff7090','STRONG SELL':'#ff4d6d'
};
const BADGE = {
  'STRONG BUY':'sig-sb','BUY':'sig-b','NEUTRAL':'sig-n','SELL':'sig-s','STRONG SELL':'sig-ss'
};

function fmt(n) {
  if (n==null||isNaN(n)) return '—';
  return n >= 1000 ? n.toLocaleString('en-IN',{maximumFractionDigits:2}) : n.toFixed(2);
}

function updateUI(sym, sig) {
  const col = COLOR[sig.signal] || '#4a5f88';
  const s = STOCKS[sym];

  // Header
  set('hdr-sym', s.name);
  set('hdr-price', fmt(sig.entry));
  const chg = +((Math.random() - 0.45) * 1.2).toFixed(2);
  const el = document.getElementById('hdr-chg');
  el.textContent = (chg>0?'+':'')+chg+'%';
  el.className = 'sym-chg ' + (chg>0?'up':'dn');

  // Overlay
  document.getElementById('sig-ov').style.setProperty('--sig-col', col);
  set('so-sym-lbl', s.name + ' · ' + state.tf.toUpperCase());
  set('so-sig', sig.signal);
  document.getElementById('so-fill').style.width = sig.score+'%';
  set('so-conf-v', sig.score+'%');
  set('so-entry', fmt(sig.entry)); set('so-sl', fmt(sig.sl));
  set('so-t1', fmt(sig.t1)); set('so-t2', fmt(sig.t2));
  set('so-rr', '1:'+sig.rr); 

  // Right panel signal card
  document.getElementById('main-sig-card').style.setProperty('--sig-col', col);
  set('sc-sig-lbl', sig.signal); set('sc-score', sig.score+'% Conf.');
  set('sc-entry', fmt(sig.entry)); set('sc-sl', fmt(sig.sl));
  set('sc-t1', fmt(sig.t1)); set('sc-t2', fmt(sig.t2));
  set('sc-rr', '1:'+sig.rr); set('sc-risk', sig.riskPct+'%');

  // RSI / MACD sub-chart labels
  set('rsi-val', sig.rsi.toFixed(1));
  set('macd-val', sig.macdVal > 0 ? '+'+sig.macdVal.toFixed(3) : sig.macdVal.toFixed(3));
  document.getElementById('macd-val').style.color = sig.macdVal >= 0 ? '#00d68f' : '#ff4d6d';

  // Indicators panel
  const rsi = sig.rsi;
  set('ir-rsi', rsi.toFixed(1));
  setBadge('ib-rsi', rsi<30?'OVERSOLD':rsi>70?'OVERBOUGHT':'NORMAL', rsi<30?'bull':rsi>70?'bear':'neu');
  set('ir-macd', sig.macdVal>0?'Bullish':'Bearish');
  setBadge('ib-macd', sig.macdVal>0?'BULL':'BEAR', sig.macdVal>0?'bull':'bear');
  const emaUp = sig.ema20 > sig.ema50;
  set('ir-ema', emaUp?'Above 50':'Below 50');
  setBadge('ib-ema', emaUp?'UPTREND':'DOWNTREND', emaUp?'bull':'bear');
  const bbPct = sig.bb.lower ? ((sig.entry-sig.bb.lower)/(sig.bb.upper-sig.bb.lower)*100).toFixed(0)+'%' : 'Mid';
  set('ir-bb', bbPct);
  setBadge('ib-bb', sig.bb.lower && sig.entry<=sig.bb.lower?'LOWER':sig.bb.upper&&sig.entry>=sig.bb.upper?'UPPER':'MID', sig.bb.lower&&sig.entry<=sig.bb.lower?'bull':sig.bb.upper&&sig.entry>=sig.bb.upper?'bear':'neu');
  set('ir-vol', sig.volSpike?'Spike':'Normal');
  setBadge('ib-vol', sig.volSpike?'SPIKE':'NORMAL', sig.volSpike?'bull':'neu');

  // F&O
  const fo = getFOSignal(sym, sig);
  const foEl = document.getElementById('fo-ov');
  if (fo) {
    foEl.style.display='block';
    set('fo-act', fo.action); document.getElementById('fo-act').style.color = sig.direction==='LONG'?'#00d68f':'#ff4d6d';
    set('fo-str', fo.strike); set('fo-exp', fo.expiry);
    set('fo-lot', fo.lot+' units');
    set('fo-rl', '₹'+fo.risk.toLocaleString('en-IN'));
    set('fo-pt', '₹'+fo.profit.toLocaleString('en-IN'));
  } else {
    foEl.style.display='none';
  }

  // Sidebar item update
  const pb = document.getElementById('p-'+sym);
  const sb = document.getElementById('s-'+sym);
  if (pb) pb.textContent = fmt(sig.entry);
  if (sb) { sb.textContent = sig.signal.replace('STRONG BUY','S.BUY').replace('STRONG SELL','S.SELL'); sb.className='sb-sig '+BADGE[sig.signal]; }

  // Flash
  document.getElementById('sig-ov').classList.remove('flash');
  void document.getElementById('sig-ov').offsetWidth;
  document.getElementById('sig-ov').classList.add('flash');
}

function set(id, v) { const e=document.getElementById(id); if(e) e.textContent=v??'—'; }
function setBadge(id, txt, type) {
  const e=document.getElementById(id);
  if (!e) return;
  e.textContent=txt;
  e.className='ind-badge '+(type==='bull'?'ib-bull':type==='bear'?'ib-bear':'ib-neu');
}

// ── SIDEBAR STOCKS ────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('stock-list');
  const stocks = Object.entries(STOCKS).filter(([,v])=>!v.fo);
  list.innerHTML = stocks.map(([k,s]) => `
    <div class="sb-item" data-sym="${k}" onclick="App.pick(this,'${k}')">
      <div>
        <div class="sb-sym">${k}</div>
        <div class="sb-price" id="p-${k}">${fmt(s.base)}</div>
      </div>
      <span class="sb-sig sig-n" id="s-${k}">—</span>
    </div>
  `).join('');
}

// ── TRADE HISTORY ─────────────────────────────────────────────────────────────
const HIST_DATA = [
  {sym:'NIFTY',sig:'BUY',pnl:'+₹3,750',pos:true,date:'Today'},
  {sym:'BANKNIFTY',sig:'SELL',pnl:'+₹2,100',pos:true,date:'Today'},
  {sym:'RELIANCE',sig:'BUY',pnl:'-₹840',pos:false,date:'Yesterday'},
  {sym:'INFY',sig:'BUY',pnl:'+₹1,260',pos:true,date:'Yesterday'},
  {sym:'TCS',sig:'SELL',pnl:'+₹2,940',pos:true,date:'Apr 3'},
  {sym:'SBIN',sig:'BUY',pnl:'-₹520',pos:false,date:'Apr 3'},
  {sym:'HDFCBANK',sig:'BUY',pnl:'+₹1,680',pos:true,date:'Apr 2'},
];
function renderHistory() {
  const el = document.getElementById('trade-hist');
  el.innerHTML = HIST_DATA.map(h=>`
    <div class="trade-row">
      <div>
        <div class="tr-sym">${h.sym}</div>
        <div class="tr-date">${h.date}</div>
      </div>
      <span class="tr-sig ${h.sig==='BUY'?'tr-bull':'tr-bear'}">${h.sig}</span>
      <span class="tr-pnl ${h.pos?'pos':'neg'}">${h.pnl}</span>
    </div>
  `).join('');
}

// ── CLOCK ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5*60+30)*60000);
  const h=ist.getUTCHours(), m=ist.getUTCMinutes();
  const isOpen = (h===9&&m>=15)||(h>=10&&h<15)||(h===15&&m<=30);
  const el = document.getElementById('mkt-time');
  el.textContent = `IST ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${isOpen?'● MARKET OPEN':'● MARKET CLOSED'}`;
  el.style.color = isOpen ? '#00d68f' : '#4a5f88';
}

// ── MAIN LOAD ─────────────────────────────────────────────────────────────────
function loadSymbol(sym) {
  document.getElementById('loader').style.display='flex';
  setTimeout(() => {
    const candles = genCandles(sym, state.tf);
    const sig     = generateSignal(candles);
    state.signals[sym] = sig;
    updateChart(candles, sig);
    updateUI(sym, sig);
    document.getElementById('loader').style.display='none';
  }, 400);
}

// ── AUTO REFRESH ──────────────────────────────────────────────────────────────
function startRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    // Quietly update current symbol
    const candles = genCandles(state.sym, state.tf);
    const sig = generateSignal(candles);
    state.signals[state.sym] = sig;
    updateChart(candles, sig);
    updateUI(state.sym, sig);
    // Update all sidebar prices silently
    Object.keys(STOCKS).forEach(k => {
      const price = state.prices[k] || STOCKS[k].base;
      const nudge = (Math.random()-0.48) * STOCKS[k].vol * 0.3;
      state.prices[k] = +(price + nudge).toFixed(2);
      const pb = document.getElementById('p-'+k);
      if (pb) pb.textContent = fmt(state.prices[k]);
    });
  }, 8000);
}

// ── APP ───────────────────────────────────────────────────────────────────────
const App = {
  pick(el, sym) {
    document.querySelectorAll('.sb-item,.idx-btn').forEach(e=>e.classList.remove('active'));
    el.classList.add('active');
    state.sym = sym;
    loadSymbol(sym);
  },
  refresh() { loadSymbol(state.sym); }
};

// ── EVENTS ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tf').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    state.tf = btn.dataset.tf;
    loadSymbol(state.sym);
  });
});

document.querySelectorAll('.ind-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const ind = btn.dataset.ind;
    if (ind==='ema') { state.showEma=!state.showEma; btn.className='ind-btn'+(state.showEma?' on-ema':''); }
    if (ind==='bb')  { state.showBb =!state.showBb;  btn.className='ind-btn'+(state.showBb ?' on-bb':'');  }
    if (ind==='vol') { state.showVol=!state.showVol; btn.className='ind-btn'+(state.showVol?' on-vol':''); }
    loadSymbol(state.sym);
  });
});

// Search
const srch = document.getElementById('srch');
srch.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const q = srch.value.trim().toUpperCase();
    if (STOCKS[q]) {
      const items = document.querySelectorAll('.sb-item');
      items.forEach(el => { if (el.dataset.sym===q) App.pick(el,q); });
      srch.value='';
    }
  }
});

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  renderSidebar();
  renderHistory();
  loadSymbol('NIFTY');
  startRefresh();
  updateClock();
  setInterval(updateClock, 30000);
});
