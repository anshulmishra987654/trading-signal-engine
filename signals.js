/**
 * App — Live signal, chart overlays, F&O panel. No Telegram.
 */
const App = (() => {
  const API = ['localhost','127.0.0.1'].includes(location.hostname)
    ? `http://${location.hostname}:8000`
    : location.origin;

  let sym = '^NSEI', tf = '15m', ws = null;
  const FO = ['^NSEI','^NSEBANK','^BSESN','^NSMIDCP'];

  // ── Init ────────────────────────────────────────────────────────────────────
  function init() {
    ChartManager.init();
    setupEvents();
    loadWatchlist();
    connectWS();
  }

  // ── WebSocket ───────────────────────────────────────────────────────────────
  function connectWS() {
    ws = new WebSocket(API.replace('http','ws') + '/ws/live');
    ws.onopen  = () => { setConn(true); send(); };
    ws.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.error) { hideLoader(); return; }
      hideLoader();
      render(d);
    };
    ws.onerror  = () => setConn(false);
    ws.onclose  = () => { setConn(false); setTimeout(connectWS, 3000); };
  }

  function send() {
    showLoader();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ symbol:sym, timeframe:tf }));
    } else { restFetch(); }
  }

  async function restFetch() {
    try {
      const r = await fetch(`${API}/api/analyze?symbol=${encodeURIComponent(sym)}&timeframe=${tf}`);
      const d = await r.json();
      if (!d.error) render(d);
    } catch(e) {}
    hideLoader();
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  function render(data) {
    const { setup, indicators:ind, candles, overlay, symbol, fo, fo_supported } = data;

    // Chart update (candles + overlays + arrows + level lines)
    ChartManager.update({ candles, overlay, setup });

    // Header
    set('hdr-sym',   symbol.replace('.NS','').replace('^',''));
    const pe = document.getElementById('hdr-price');
    pe.textContent = fmt(setup.entry, symbol);
    pe.style.color = setup.direction==='LONG' ? '#00c076' : setup.direction==='SHORT' ? '#ff3b5c' : '#e2e8f0';

    // ── Signal overlay (top-left on chart) ──
    const cmap = {
      'STRONG BUY':'#00c076','BUY':'#34d399',
      'NEUTRAL':'#4b6080',
      'SELL':'#fb7185','STRONG SELL':'#ff3b5c'
    };
    const col = cmap[setup.signal] || '#4b6080';
    const ov = document.getElementById('sig-ov');
    ov.style.setProperty('--sc', col);

    set('so-sym',   symbol.replace('.NS','').replace('^','') + ' · ' + tf.toUpperCase());
    const slbl = document.getElementById('so-sig');
    slbl.textContent = setup.signal; slbl.style.color = col;
    set('so-score', `Confluence: ${setup.confluence}/100 · R:R = 1:${setup.risk_reward}`);
    document.getElementById('so-fill').style.width = setup.confluence + '%';

    set('lv-en', fmt(setup.entry));
    set('lv-sl', fmt(setup.stop_loss));
    set('lv-t1', fmt(setup.target1));
    set('lv-t2', fmt(setup.target2));
    set('lv-rr', `1:${setup.risk_reward}  (Risk: ${setup.risk_pct}%)`);

    // ── F&O overlay (top-right on chart) ──
    const foEl = document.getElementById('fo-ov');
    if (fo_supported && fo?.supported) {
      foEl.style.display = 'block';
      const opt = fo.options, fut = fo.futures, lvl = fo.levels;
      const isBuy = setup.direction === 'LONG';
      document.getElementById('fo-act').textContent = opt.action;
      document.getElementById('fo-act').style.color = isBuy ? '#00c076' : '#ff3b5c';
      set('fo-str', `${opt.strike.toLocaleString('en-IN')} ${opt.option_type}`);
      set('fo-exp', opt.recommended_expiry);
      set('fo-atm', opt.atm_strike.toLocaleString('en-IN'));
      set('fo-lot', `${fo.lot_size} units`);
      set('fo-rl',  '₹' + fut.risk_per_lot.toLocaleString('en-IN'));
      set('fo-pt',  '₹' + fut.profit_t1_per_lot.toLocaleString('en-IN'));
    } else {
      foEl.style.display = 'none';
    }

    // Highlight active index button
    document.querySelectorAll('.idx-item').forEach(e => e.classList.remove('on'));
    const idxMap={'^NSEI':'idx-nsei','^NSEBANK':'idx-bank','^BSESN':'idx-bsesn'};
    if (idxMap[symbol]) document.getElementById(idxMap[symbol])?.classList.add('on');
  }

  // ── Watchlist ───────────────────────────────────────────────────────────────
  async function loadWatchlist() {
    try {
      const r = await fetch(`${API}/api/watchlist`);
      const items = await r.json();
      const el = document.getElementById('wl');
      el.innerHTML = items.map(item => `
        <div class="wl-item ${item.symbol===sym?'on':''}" onclick="App.pick('${item.symbol}','${tf}')">
          <div>
            <div class="wn">${item.symbol.replace('.NS','').replace('.BO','')}</div>
            <div class="wp">${item.price ? fmt(item.price) : (item.error ? 'Error' : '—')}</div>
          </div>
          <span class="sbadge ${badge(item.signal)}">${item.signal||'—'}</span>
        </div>`).join('');
    } catch(e) {
      document.getElementById('wl').innerHTML = '<div style="padding:10px;color:#ff3b5c;font-size:10px">Backend start karo</div>';
    }
  }

  // ── Events ──────────────────────────────────────────────────────────────────
  function setupEvents() {
    // Search
    const si = document.getElementById('srch');
    const sr = document.getElementById('sresults');
    let t;
    si.addEventListener('input', () => {
      clearTimeout(t);
      const q = si.value.trim();
      if (!q) { sr.style.display='none'; return; }
      t = setTimeout(async () => {
        try {
          const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
          const res = await r.json();
          if (!res.length) { sr.style.display='none'; return; }
          sr.innerHTML = res.map(x=>`<div class="sri" onclick="App.pick('${x.symbol}','${tf}');document.getElementById('sresults').style.display='none';document.getElementById('srch').value=''"><span>${x.name}</span><span>${x.market}</span></div>`).join('');
          sr.style.display='block';
        } catch(e){}
      }, 280);
    });
    si.addEventListener('keydown', e => {
      if (e.key==='Enter' && si.value.trim()) {
        sr.style.display='none';
        sym = si.value.trim();
        si.value = '';
        send();
      }
    });
    document.addEventListener('click', e => { if (!si.contains(e.target)) sr.style.display='none'; });

    // Timeframe
    document.querySelectorAll('.tf').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tf').forEach(b=>b.classList.remove('on'));
        btn.classList.add('on');
        tf = btn.dataset.tf;
        send();
      });
    });

    // Indicator toggles
    document.querySelectorAll('.itog').forEach(btn => {
      btn.classList.add('on');
      btn.addEventListener('click', () => {
        const ind = btn.dataset.i;
        const on = !btn.classList.toggle('on');
        ChartManager.toggleIndicator(ind, !on);
      });
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function pick(s, t) { sym=s; tf=t||tf; send(); }
  function refresh()  { send(); }
  function set(id, v) { const e=document.getElementById(id); if(e) e.textContent=v??'—'; }
  function showLoader(){ const e=document.getElementById('loader'); if(e){e.style.display='flex';} }
  function hideLoader(){ const e=document.getElementById('loader'); if(e){e.style.display='none';} }
  function setConn(on){ document.getElementById('cdot').className='cdot'+(on?' live':''); document.getElementById('cstat').textContent=on?'LIVE':'OFFLINE'; }
  function fmt(p, s='') {
    if (p==null||isNaN(p)) return '—';
    if (p<1) return p.toFixed(4);
    if (p<100) return p.toFixed(2);
    return p.toLocaleString('en-IN',{maximumFractionDigits:2});
  }
  function badge(sig) {
    if (!sig) return 'bn';
    const s=sig.toUpperCase();
    if (s.includes('STRONG BUY'))  return 'bsb';
    if (s.includes('BUY'))         return 'bb';
    if (s.includes('STRONG SELL')) return 'bss';
    if (s.includes('SELL'))        return 'bs';
    return 'bn';
  }

  return { init, pick, refresh };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
