/*!
 * LightSnowFX
 * https://github.com/Bivort/LightSnowFX
 * Copyright (c) 2025 Bivort
 * MIT License 
 */
(function (window) {
  'use strict';

  const DEFAULTS = {
    target: 'body',            // selector or element
    canvasClass: 'lightsnowfx-canvas',
    zIndex: 2,

    // density & motion
    streams: 34,
    speedMin: 260,
    speedMax: 560,
    windMin: -25,
    windMax: 25,

    // streak geometry
    segW: 3.6,
    segHead: 20,
    segBody: 16,
    spacing: null,            // null => segBody (collés)

    // trail
    trailLeds: 14,
    headBoost: 1.30,
    twinkle: 0.18,

    // melt / impact
    meltZone: 48,
    flashTime: 0.14,
    meltTime: 0.55,
    spawnGapMin: 0.08,
    spawnGapMax: 0.60,

    // rendering
    retina: true,
    maxDPR: 2,
    glow: true,               // halos ronds
    flashDotRadius: 6.5       // pastille au flash
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function resolveTarget(t) {
    if (!t) return document.body;
    if (typeof t === 'string') return document.querySelector(t);
    return t; // assume element
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function createInstance(userOpts = {}) {
    const opt = Object.assign({}, DEFAULTS, userOpts);

    const parent = resolveTarget(opt.target);
    if (!parent) throw new Error('LightSnowFX: target not found');

    // Ensure parent is positioning context
    const cs = window.getComputedStyle(parent);
    if (cs.position === 'static') parent.style.position = 'relative';

    // Canvas
    let canvas = parent.querySelector('.' + opt.canvasClass);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = opt.canvasClass;
      parent.appendChild(canvas);
    }

    Object.assign(canvas.style, {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
      zIndex: String(opt.zIndex)
    });

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('LightSnowFX: canvas 2d context not available');

    let W = 1, H = 1, DPR = 1;
    let raf = 0;
    let running = true;

    function resize() {
      const r = parent.getBoundingClientRect();
      W = Math.max(1, Math.floor(r.width));
      H = Math.max(1, Math.floor(r.height));
      DPR = opt.retina ? clamp((window.devicePixelRatio || 1), 1, opt.maxDPR) : 1;

      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      canvas.width = Math.floor(W * DPR);
      canvas.height = Math.floor(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    const onResize = () => resize();
    window.addEventListener('resize', onResize, { passive: true });
    resize();

    const SEG = {
      w: opt.segW,
      hHead: opt.segHead,
      hBody: opt.segBody
    };

    const spacing = (opt.spacing == null) ? SEG.hBody : opt.spacing;

    function makeStream(first) {
      return {
        x: rand(0, W),
        y: first ? rand(-H, H) : rand(-H * 0.7, -60),
        vy: rand(opt.speedMin, opt.speedMax),
        vx: rand(opt.windMin, opt.windMax),
        phase: rand(0, Math.PI * 2),
        state: 'fall',
        t: 0,
        wait: 0
      };
    }

    let streams = Array.from({ length: opt.streams }, () => makeStream(true));

    function drawGlow(x, y, a, isHead) {
      if (!opt.glow || a <= 0.12) return;
      const R = isHead ? 26 : 16;
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, `rgba(255,255,255,${a * 0.18})`);
      g.addColorStop(1, `rgba(255,255,255,0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawSegment(x, y, a, isHead) {
      const w = SEG.w;
      const h = isHead ? SEG.hHead : SEG.hBody;

      drawGlow(x, y, a, isHead);

      const rr = Math.max(w, h) * 0.5; // capsule clean
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      roundRectPath(ctx, x - w / 2, y - h / 2, w, h, rr);
      ctx.fill();
    }

    function drawStream(s, dt) {
      s.phase += 1.15 * dt;
      const tw = 1 + (Math.sin(s.phase) * opt.twinkle);

      if (s.state === 'fall') {
        s.y += s.vy * dt;
        s.x += s.vx * dt;

        if (s.x < -50) s.x = W + 50;
        if (s.x > W + 50) s.x = -50;

        const headIndex = Math.floor(s.y / spacing);

        for (let i = 0; i < opt.trailLeds; i++) {
          const idx = headIndex - i;
          const ly = idx * spacing;
          if (ly < -40 || ly > H + 40) continue;

          let a = 1 - (i / opt.trailLeds);
          if (i === 0) a = Math.min(1, a * opt.headBoost);

          const meltStart = H - opt.meltZone;
          if (ly > meltStart) {
            const t = Math.min(1, (ly - meltStart) / opt.meltZone);
            a *= (1 - t);
          }

          a *= 0.92 * tw;
          if (a <= 0) continue;

          drawSegment(s.x, ly, a, i === 0);
        }

        if (s.y > H - 2) { s.state = 'flash'; s.t = 0; }
        return;
      }

      if (s.state === 'flash') {
        s.t += dt;
        const yb = H - 10;
        const a = clamp(1 - (s.t / opt.flashTime), 0, 1);

        // halo impact
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${0.30 * a})`;
        ctx.arc(s.x, yb, 42, 0, Math.PI * 2);
        ctx.fill();

        // ✅ pastille ronde (pas de carré)
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${0.98 * a})`;
        ctx.arc(s.x, yb, opt.flashDotRadius, 0, Math.PI * 2);
        ctx.fill();

        // goutte de fonte
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${0.22 * a})`;
        ctx.arc(s.x, yb + 14, 10, 0, Math.PI * 2);
        ctx.fill();

        if (s.t >= opt.flashTime) { s.state = 'melt'; s.t = 0; }
        return;
      }

      if (s.state === 'melt') {
        s.t += dt;
        const yb = H - 10;
        const p = clamp(s.t / opt.meltTime, 0, 1);
        const a = 1 - p;

        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${0.18 * a})`;
        ctx.arc(s.x, yb + 14, 10 * (1 + p * 1.0), 0, Math.PI * 2);
        ctx.fill();

        if (p >= 1) {
          s.state = 'wait';
          s.wait = rand(opt.spawnGapMin, opt.spawnGapMax);
          s.t = 0;
        }
        return;
      }

      if (s.state === 'wait') {
        s.wait -= dt;
        if (s.wait <= 0) {
          const ns = makeStream(false);
          s.x = ns.x; s.y = ns.y; s.vy = ns.vy; s.vx = ns.vx; s.phase = ns.phase;
          s.state = 'fall'; s.t = 0;
        }
      }
    }

    let last = performance.now();
    function loop(now) {
      if (!running) return;
      const dt = Math.min(40, now - last) / 1000;
      last = now;

      // auto-resize if parent resized without window resize
      const r = parent.getBoundingClientRect();
      if ((r.width | 0) !== W || (r.height | 0) !== H) resize();

      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < streams.length; i++) drawStream(streams[i], dt);

      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);

    return {
      canvas,
      options: opt,
      pause() { if (!running) return; running = false; cancelAnimationFrame(raf); },
      resume() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); },
      destroy() {
        running = false;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        streams = [];
      }
    };
  }

  // Public API
  const LightSnowFX = {
    init(opts) { return createInstance(opts); }
  };

  window.LightSnowFX = LightSnowFX;

})(window);
