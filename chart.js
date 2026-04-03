/**
 * ChartManager — BUY/SELL arrows + Entry/SL/T1/T2 lines drawn ON the chart
 */
const ChartManager = (() => {
  let main, candle, vol;
  let ema20, ema50;
  let bbUp, bbMid, bbLow;
  let rsiChart, rsiLine, rsiOB, rsiOS;
  let macdChart, macdHist, macdLine, macdSig;
  let entryLine, slLine, t1Line, t2Line;
  let indState = { ema: true, bb: true, vol: true };

  const OPT = {
    layout:{ background:{color:'#07090f'}, textColor:'#4b6080', fontFamily:"'Space Mono',monospace", fontSize:10 },
    grid:{ vertLines:{color:'#0e1828'}, horzLines:{color:'#0e1828'} },
    crosshair:{ mode:LightweightCharts.CrosshairMode.Normal, vertLine:{color:'#1a2640',labelBackgroundColor:'#111827'}, horzLine:{color:'#1a2640',labelBackgroundColor:'#111827'} },
    rightPriceScale:{ borderColor:'#1a2640' },
    timeScale:{ borderColor:'#1a2640', timeVisible:true, secondsVisible:false },
  };

  function init() {
    const el = document.getElementById('cv');
    if (!el || !window.LightweightCharts) return;

    main = LightweightCharts.createChart(el, { ...OPT, width: el.offsetWidth, height: el.offsetHeight });

    // Candles
    candle = main.addCandlestickSeries({
      upColor:'#00c076', downColor:'#ff3b5c',
      borderUpColor:'#00c076', borderDownColor:'#ff3b5c',
      wickUpColor:'#00c076', wickDownColor:'#ff3b5c',
    });

    // Volume
    vol = main.addHistogramSeries({
      priceFormat:{type:'volume'}, priceScaleId:'vol',
      scaleMargins:{top:0.85, bottom:0},
    });
    main.priceScale('vol').applyOptions({ scaleMargins:{top:0.85, bottom:0} });

    // EMA
    ema20 = main.addLineSeries({ color:'rgba(167,139,250,.85)', lineWidth:1.5, priceLineVisible:false, lastValueVisible:false });
    ema50 = main.addLineSeries({ color:'rgba(251,146,60,.85)', lineWidth:1.5, priceLineVisible:false, lastValueVisible:false });

    // Bollinger Bands
    bbUp  = main.addLineSeries({ color:'rgba(251,146,60,.35)', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dashed, priceLineVisible:false, lastValueVisible:false });
    bbMid = main.addLineSeries({ color:'rgba(251,146,60,.2)', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dotted, priceLineVisible:false, lastValueVisible:false });
    bbLow = main.addLineSeries({ color:'rgba(251,146,60,.35)', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dashed, priceLineVisible:false, lastValueVisible:false });

    // ── RSI sub chart ──
    const rsiEl = document.getElementById('rsi-cv');
    rsiChart = LightweightCharts.createChart(rsiEl, { ...OPT, width:rsiEl.offsetWidth, height:rsiEl.offsetHeight });
    rsiLine = rsiChart.addLineSeries({ color:'#a78bfa', lineWidth:1.5, priceLineVisible:false });
    rsiOB   = rsiChart.addLineSeries({ color:'rgba(255,59,92,.3)', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dashed, priceLineVisible:false, lastValueVisible:false });
    rsiOS   = rsiChart.addLineSeries({ color:'rgba(0,192,118,.3)', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dashed, priceLineVisible:false, lastValueVisible:false });

    // ── MACD sub chart ──
    const macdEl = document.getElementById('macd-cv');
    macdChart = LightweightCharts.createChart(macdEl, { ...OPT, width:macdEl.offsetWidth, height:macdEl.offsetHeight });
    macdHist  = macdChart.addHistogramSeries({ priceLineVisible:false, lastValueVisible:false });
    macdLine  = macdChart.addLineSeries({ color:'#00d4ff', lineWidth:1.5, priceLineVisible:false });
    macdSig   = macdChart.addLineSeries({ color:'#f59e0b', lineWidth:1.5, priceLineVisible:false });

    // Resize
    new ResizeObserver(() => {
      if (main) main.applyOptions({ width:el.offsetWidth, height:el.offsetHeight });
      if (rsiChart) rsiChart.applyOptions({ width:rsiEl.offsetWidth, height:rsiEl.offsetHeight });
      if (macdChart) macdChart.applyOptions({ width:macdEl.offsetWidth, height:macdEl.offsetHeight });
    }).observe(el);
  }

  function removeLevels() {
    [entryLine, slLine, t1Line, t2Line].forEach(l => { try { if(l) main.removeSeries(l); } catch(e){} });
    entryLine = slLine = t1Line = t2Line = null;
  }

  function drawLevelLines(setup) {
    removeLevels();
    if (!setup || setup.direction === 'FLAT') return;

    const mkLine = (price, color, title, style=LightweightCharts.LineStyle.Solid) =>
      main.addLineSeries({
        color, lineWidth:1, lineStyle:style,
        priceLineVisible:false, lastValueVisible:true,
        title,
        crosshairMarkerVisible:false,
      });

    entryLine = mkLine(setup.entry,     '#e2e8f0', 'Entry',  LightweightCharts.LineStyle.Solid);
    slLine    = mkLine(setup.stop_loss, '#ff3b5c', '⬛ SL',   LightweightCharts.LineStyle.Dashed);
    t1Line    = mkLine(setup.target1,   '#00c076', '🎯 T1',   LightweightCharts.LineStyle.Dashed);
    t2Line    = mkLine(setup.target2,   '#34d399', '🎯 T2',   LightweightCharts.LineStyle.Dotted);

    // Need at least 2 points for a line — use first and last candle time
    const firstTime = _lastCandles?.[0]?.time;
    const lastTime  = _lastCandles?.at(-1)?.time;
    if (!firstTime || !lastTime) return;

    const pts = (price) => [{ time:firstTime, value:price }, { time:lastTime, value:price }];
    entryLine.setData(pts(setup.entry));
    slLine   .setData(pts(setup.stop_loss));
    t1Line   .setData(pts(setup.target1));
    t2Line   .setData(pts(setup.target2));
  }

  let _lastCandles = [];

  function update(data) {
    const { candles, overlay, setup } = data;
    if (!candles?.length) return;

    const sorted = [...candles].sort((a,b)=>a.time-b.time);
    _lastCandles = sorted;

    // Candles
    candle.setData(sorted);

    // Volume
    if (indState.vol) {
      vol.setData(sorted.map(c=>({ time:c.time, value:c.volume, color: c.close>=c.open?'rgba(0,192,118,.3)':'rgba(255,59,92,.3)' })));
    }

    // EMA
    const alignSeries = (values) => {
      const off = values.length - sorted.length;
      return sorted.map((c,i)=>({ time:c.time, value:values[off+i] })).filter(d=>d.value!=null && !isNaN(d.value));
    };

    if (indState.ema) {
      if (overlay.ema20?.length) ema20.setData(alignSeries(overlay.ema20));
      if (overlay.ema50?.length) ema50.setData(alignSeries(overlay.ema50));
    }

    // Bollinger
    if (indState.bb) {
      if (overlay.bb_upper?.length) {
        bbUp .setData(alignSeries(overlay.bb_upper));
        bbMid.setData(alignSeries(overlay.bb_middle));
        bbLow.setData(alignSeries(overlay.bb_lower));
      }
    }

    // RSI
    if (overlay.rsi?.length) {
      const rsiData = alignSeries(overlay.rsi);
      rsiLine.setData(rsiData);
      rsiOB.setData(sorted.map(c=>({time:c.time,value:70})));
      rsiOS.setData(sorted.map(c=>({time:c.time,value:30})));
    }

    // MACD
    if (overlay.macd?.length) {
      macdLine.setData(alignSeries(overlay.macd));
      macdSig .setData(alignSeries(overlay.macd_signal));
      macdHist.setData(sorted.map((c,i)=>{
        const off=overlay.macd_hist.length-sorted.length;
        const v=overlay.macd_hist[off+i];
        return v!=null?{time:c.time,value:v,color:v>=0?'rgba(0,192,118,.55)':'rgba(255,59,92,.55)'}:null;
      }).filter(Boolean));
    }

    // BUY/SELL Markers on candles
    if (setup) {
      const lastCandle = sorted.at(-1);
      const sigMap = {
        'STRONG BUY': { position:'belowBar', color:'#00c076', shape:'arrowUp',   text:'▲ STRONG BUY' },
        'BUY':        { position:'belowBar', color:'#34d399', shape:'arrowUp',   text:'▲ BUY' },
        'NEUTRAL':    null,
        'SELL':       { position:'aboveBar', color:'#fb7185', shape:'arrowDown', text:'▼ SELL' },
        'STRONG SELL':{ position:'aboveBar', color:'#ff3b5c', shape:'arrowDown', text:'▼ STRONG SELL' },
      };
      const mk = sigMap[setup.signal];
      if (mk && lastCandle) {
        candle.setMarkers([{ time:lastCandle.time, ...mk }]);
      } else {
        candle.setMarkers([]);
      }

      // Draw level lines
      drawLevelLines(setup);
    }

    main.timeScale().fitContent();
    rsiChart.timeScale().fitContent();
    macdChart.timeScale().fitContent();
  }

  function toggleIndicator(name, on) {
    indState[name] = on;
    const hide = s => s.applyOptions({ visible:on });
    if (name==='ema') { hide(ema20); hide(ema50); }
    if (name==='bb')  { hide(bbUp);  hide(bbMid); hide(bbLow); }
    if (name==='vol') { vol.applyOptions({ visible:on }); }
  }

  return { init, update, toggleIndicator };
})();
