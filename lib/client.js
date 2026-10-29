/**
 * @name dsh-plugin-starlight-protocol
 * @description 星轨协议 2077 (Starlight Protocol) — 旗舰级综合外观系统客户端 Bundle
 * 集成：
 *   1) 深空全景动态宇宙天体引擎 (Space Horizon)
 *   2) 赛博朋克 2077 夜之城 HUD 终端主题 (Cyberpunk 2077 HUD)
 *   3) 开机冷启动认证序列与特工档案 (Startup Sequence)
 *   4) 星轨协议统一多模块总控设置面板 (Unified Master Control Settings Section)
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-starlight-protocol',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var react = require('react');
    var h = react.createElement;

    var API = '/dsh-starlight/config';
    var LEGACY_API = '/dsh-startup/config';
    var globalThemeCtx = null;
    var globalLayoutCtx = null;

    /* ══════════════════════════════════════════════════════════════════════════
     * 1. 深空全景动态宇宙视界 (DEEP SPACE CELESTIAL ENGINE)
     * ══════════════════════════════════════════════════════════════════════════ */

const TINTS = ['255,250,242', '205,220,255', '255,241,214', '255,224,168', '255,196,148', '255,166,140'];

    /** 天幕星点的量化样式（带内微星 0-3，全天恒星 4+）。 */
    const DOT_STYLES = [];
    (function () {
      const bandA = [0.08, 0.14, 0.2, 0.28];
      for (let i = 0; i < 4; i++) DOT_STYLES.push(`rgba(235,232,225,${bandA[i]})`);
      const magA = [0.15, 0.35, 0.55, 0.8];
      for (let t = 0; t < 6; t++) for (let a = 0; a < 4; a++) DOT_STYLES.push(`rgba(${TINTS[t]},${magA[a]})`);
    })();

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function pickTint() {
      const r = Math.random();
      if (r < 0.5) return 0;
      if (r < 0.65) return 1;
      if (r < 0.8) return 2;
      if (r < 0.9) return 3;
      if (r < 0.96) return 4;
      return 5;
    }

    /** 整周期正弦银河带：bandYFor(a,p,w,0) === bandYFor(a,p,w,w)，环绕天然无缝。 */
    function bandYFor(amp, phase, w, x) {
      return amp * Math.sin((x / w) * 6.283185307179586 + phase);
    }

    /** 相机正交基（前/右/上），yaw 任意、pitch ∈ [-π/2, π/2]。 */
    function buildBasis(yaw, pitch) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const f = [sy * cp, sp, cy * cp];
      const r = [cy, 0, -sy];
      const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
      return { f, r, u };
    }

    /** 随机星座：4-8 星的随机链 + 偶发分叉，每个星域不同。 */
    function makeConstellations() {
      const list = [];
      const count = 5 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const n = 4 + Math.floor(Math.random() * 5);
        const pts = [], edges = [];
        let x = 0.3 + Math.random() * 0.4, y = 0.3 + Math.random() * 0.4;
        pts.push([x, y]);
        for (let p = 1; p < n; p++) {
          const ang = Math.random() * Math.PI * 2;
          const step = 0.14 + Math.random() * 0.16;
          x = clamp(x + Math.cos(ang) * step, 0.02, 0.98);
          y = clamp(y + Math.sin(ang) * step, 0.02, 0.98);
          pts.push([x, y]);
          edges.push([p - 1, p]);
          if (Math.random() < 0.18 && pts.length < n + 2) {
            const bAng = Math.random() * Math.PI * 2;
            pts.push([clamp(x + Math.cos(bAng) * (0.1 + Math.random() * 0.12), 0.02, 0.98),
                      clamp(y + Math.sin(bAng) * (0.1 + Math.random() * 0.12), 0.02, 0.98)]);
            edges.push([p, pts.length - 1]);
          }
        }
        const br = pts.map(() => 0.55 + Math.random() * 0.4);
        const hot = 1 + Math.floor(Math.random() * 2);
        for (let k = 0; k < hot; k++) br[Math.floor(Math.random() * br.length)] = 0.95;
        const ti = pts.map(() => (Math.random() < 0.7 ? 0 : pickTint()));
        list.push({
          fx: 0.05 + Math.random() * 0.75, fy: 0.08 + Math.random() * 0.62,
          fw: 0.09 + Math.random() * 0.09, fh: 0.12 + Math.random() * 0.14,
          pts, edges, br, ti,
        });
      }
      return list;
    }

    /* ======================================================================
     * 星空引擎（实例闭包状态；全局背景一个实例常驻）
     * ==================================================================== */

    /**
     * @param {HTMLElement} root 引擎宿主（引擎在其内创建画布层）
     * @param {object} opts
     *   interactive  指针/键盘自由视角（外观背景固定 false）
     *   hud          座舱准星与舷窗括框
     *   autoDrift    自动偏航漂移 rad/s
     *   fpsCap       帧率上限（0 = 不限）
     *   density      穿越层恒星数
     *   speed/boost  固定航速/跃迁
     * @returns {{ dispose(): void }}
     */
    function createSpaceEngine(root, opts) {
      opts = opts || {};
      const interactive = opts.interactive !== false;
      const showHud = opts.hud !== false;
      const autoDrift = opts.autoDrift || 0;
      const fpsCap = opts.fpsCap || 0;
      const density = Math.round(clamp(opts.density || 1000, 50, 4000));

      const Z_FAR = 1.6, Z_NEAR = 0.03, SPREAD = 1.05;
      const YAW_RATE = 1.6, PITCH_RATE = 1.15, PITCH_MAX = 1.48;
      const widths = [0.7, 1.4, 2.4];
      const DOT_R = [0.9, 1.6, 2.6];
      const alphaTable = [0.32, 0.58, 0.82, 1.0];
      const NB = 72; // 6 色 × 3 尺寸 × 4 亮度

      const bucketStyle = [];
      for (let ci = 0; ci < 6; ci++)
        for (let wb = 0; wb < 3; wb++)
          for (let ab = 0; ab < 4; ab++)
            bucketStyle[(ci * 3 + wb) * 4 + ab] = `rgba(${TINTS[ci]},${alphaTable[ab]})`;
      const lineBuckets = [], dotBuckets = [];
      for (let i = 0; i < NB; i++) { lineBuckets.push([]); dotBuckets.push([]); }
      const coreDots = [];

      let reducedMotion = false;
      try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* 无障碍探测失败按常规模拟 */ }

      /* ---------- 画布层 ---------- */
      const skyCanvasEl = document.createElement('canvas');
      const canvas = document.createElement('canvas');
      skyCanvasEl.className = canvas.className = 'sbg-cv';
      root.appendChild(skyCanvasEl);
      root.appendChild(canvas);
      const ctxSky = skyCanvasEl.getContext('2d');
      const ctx = canvas.getContext('2d');
      let hudCanvasEl = null, ctxHud = null;
      if (showHud) {
        hudCanvasEl = document.createElement('canvas');
        hudCanvasEl.className = 'sbg-cv';
        root.appendChild(hudCanvasEl);
        ctxHud = hudCanvasEl.getContext('2d');
      }

      /* ---------- 状态 ---------- */
      let W = 0, H = 0;
      let sky = null, skyNext = null, skyTrans = 0, transStartT = 0, nextSectorAt = 0;
      let vig = null;
      let skyRebuildPending = false, lastSkyBuildAt = 0, lastSkyKey = '';
      const cam = { yaw: Math.random() * 6.2832, pitch: 0 };
      const steer = { x: 0, y: 0 }, steerTarget = { x: 0, y: 0 }, kbOffset = { x: 0, y: 0 };
      const keys = {};
      let boostEase = 0, skyZoom = 0;
      let cancelled = false, rafId = 0, lastT = 0, lastDrawT = 0;
      const stars = [];
      const skyFillJobs = [];
      let meteor = null, nextMeteorAt = 6000;
      let planetSprites = null;
      const flyby = { active: false, x: 0, y: 0, z: 0, sprite: null, r: 0.2, nextAt: 9000 };

      // 鼠标阻尼微视差（Parallax Micro-Drift）：让星空随指针滑动微量三维偏转
      const parallax = opts.parallax !== false;
      let targetParallaxYaw = 0, targetParallaxPitch = 0;
      let curParallaxYaw = 0, curParallaxPitch = 0;

      function onWindowPointer(e) {
        if (W <= 0 || H <= 0) return;
        targetParallaxYaw = (e.clientX / W - 0.5) * 0.04;
        targetParallaxPitch = (e.clientY / H - 0.5) * 0.025;
      }

      function newStar(randomZ) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * SPREAD;
        return {
          x: Math.cos(ang) * r, y: Math.sin(ang) * r,
          z: randomZ ? Z_NEAR + Math.random() * (Z_FAR - Z_NEAR) : Z_FAR - Math.random() * 0.1,
          px: NaN, py: NaN,
          ci: pickTint(),
          m: Math.pow(Math.random(), 2.2),
          tw: Math.random() * 6.2832,
        };
      }
      while (stars.length < density) stars.push(newStar(true));

      /** 热更新穿越层恒星数：只增删 stars 数组，绝不销毁重建 canvas / RAF。 */
      function setDensity(next) {
        const target = Math.round(clamp(next || 1000, 50, 4000));
        if (target === stars.length) return;
        if (target > stars.length) {
          while (stars.length < target) stars.push(newStar(true));
        } else {
          stars.length = target;
        }
      }

      /* ---------- 天体绘制 ---------- */

      function drawPlanetBody(c, x, y, r, type) {
        const palettes = [
          ['255,228,185', '212,158,108', '108,72,50'],
          ['255,195,155', '208,105,75', '82,40,36'],
          ['225,242,255', '150,186,232', '66,96,148'],
          ['255,236,200', '202,172,132', '108,84,64'],
        ];
        const p = palettes[type] || palettes[0];
        const g = c.createRadialGradient(x - r * 0.42, y - r * 0.42, r * 0.12, x, y, r * 1.02);
        g.addColorStop(0, `rgba(${p[0]},0.96)`);
        g.addColorStop(0.55, `rgba(${p[1]},0.94)`);
        g.addColorStop(1, `rgba(${p[2]},0.94)`);
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
        if (type === 0 || type === 3) {
          c.save();
          c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.clip();
          c.globalAlpha = 0.16;
          for (let b = 0; b < 4; b++) {
            c.fillStyle = b % 2 ? 'rgb(90,60,40)' : 'rgb(255,240,220)';
            c.fillRect(x - r, y - r * 0.6 + b * r * 0.32, r * 2, r * 0.15);
          }
          c.restore();
        }
        if (type === 3) {
          c.save();
          c.translate(x, y);
          c.rotate(-0.35);
          c.strokeStyle = 'rgba(230,216,186,0.5)';
          c.lineWidth = Math.max(1.5, r * 0.15);
          c.beginPath(); c.ellipse(0, 0, r * 1.8, r * 0.52, 0, 0, 6.2832); c.stroke();
          c.strokeStyle = 'rgba(230,216,186,0.22)';
          c.lineWidth = Math.max(1, r * 0.07);
          c.beginPath(); c.ellipse(0, 0, r * 2.1, r * 0.64, 0, 0, 6.2832); c.stroke();
          c.restore();
        }
      }

      function buildPlanetSprites() {
        planetSprites = [];
        for (let t = 0; t < 3; t++) {
          const s = document.createElement('canvas');
          s.width = 360; s.height = 260;
          drawPlanetBody(s.getContext('2d'), 180, 130, 70, t === 2 ? 3 : t);
          planetSprites.push(s);
        }
      }

      function drawNebula(c, x, y, r, hue, k) {
        const blobs = 4 + Math.floor(Math.random() * 3);
        const dir = Math.random() * Math.PI * 2;
        for (let i = 0; i < blobs; i++) {
          const bx = x + Math.cos(dir + i * 0.9) * r * 0.35 * Math.random();
          const by = y + Math.sin(dir + i * 1.1) * r * 0.3 * Math.random();
          const br = r * (0.35 + Math.random() * 0.45);
          const a = (0.10 + Math.random() * 0.08) * k;
          const g = c.createRadialGradient(bx, by, 0, bx, by, br);
          g.addColorStop(0, `rgba(${hue},${a.toFixed(3)})`);
          g.addColorStop(0.6, `rgba(${hue},${(a * 0.45).toFixed(3)})`);
          g.addColorStop(1, `rgba(${hue},0)`);
          c.fillStyle = g;
          c.fillRect(bx - br, by - br, br * 2, br * 2);
        }
        for (let d = 0; d < 2; d++) {
          const dx = x + (Math.random() - 0.5) * r * 0.6, dy = y + (Math.random() - 0.5) * r * 0.5;
          const dr = r * (0.15 + Math.random() * 0.2);
          const g2 = c.createRadialGradient(dx, dy, 0, dx, dy, dr);
          g2.addColorStop(0, 'rgba(5,6,12,0.4)');
          g2.addColorStop(1, 'rgba(5,6,12,0)');
          c.fillStyle = g2;
          c.fillRect(dx - dr, dy - dr, dr * 2, dr * 2);
        }
      }

      function drawGalaxy(c, x, y, r, tilt, k) {
        c.save();
        c.translate(x, y);
        c.rotate(tilt);
        c.scale(2.3, 1);
        const layers = [
          [r, `rgba(255,243,220,${(0.55 * k).toFixed(3)})`],
          [r * 1.9, `rgba(210,220,250,${(0.30 * k).toFixed(3)})`],
          [r * 3.1, `rgba(185,200,245,${(0.16 * k).toFixed(3)})`],
        ];
        for (let i = 0; i < layers.length; i++) {
          const g = c.createRadialGradient(0, 0, 0, 0, 0, layers[i][0]);
          g.addColorStop(0, layers[i][1]);
          g.addColorStop(1, 'rgba(160,180,240,0)');
          c.fillStyle = g;
          c.beginPath();
          c.arc(0, 0, layers[i][0], 0, 6.2832);
          c.fill();
        }
        c.restore();
      }

      /** 水平环绕无缝：越界内容在对侧补画。 */
      function wrapDraw(c, skyW, x, y, r, fn) {
        fn(c, x, y);
        if (x - r < 0) fn(c, x + skyW, y);
        if (x + r > skyW) fn(c, x - skyW, y);
      }

      /** 预渲染精灵（保证对侧补画与本体逐像素一致）。 */
      function makeSprite(w, h, fn) {
        const s = document.createElement('canvas');
        s.width = Math.max(2, Math.ceil(w * 0.6));
        s.height = Math.max(2, Math.ceil(h * 0.6));
        const c2 = s.getContext('2d');
        c2.scale(0.6, 0.6);
        fn(c2);
        return { cv: s, w, h };
      }

      function drawConstellationAt(c, ox, oy, K, bw, bh) {
        c.strokeStyle = 'rgba(150,170,210,0.28)';
        c.lineWidth = 0.9;
        c.beginPath();
        for (let e = 0; e < K.edges.length; e++) {
          const a = K.pts[K.edges[e][0]], b = K.pts[K.edges[e][1]];
          c.moveTo(ox + a[0] * bw, oy + a[1] * bh);
          c.lineTo(ox + b[0] * bw, oy + b[1] * bh);
        }
        c.stroke();
        for (let p = 0; p < K.pts.length; p++) {
          const px = ox + K.pts[p][0] * bw, py = oy + K.pts[p][1] * bh;
          const br = K.br[p];
          const tint = TINTS[K.ti[p] || 0];
          if (br >= 0.9) {
            const g = c.createRadialGradient(px, py, 0, px, py, 6 + br * 6);
            g.addColorStop(0, `rgba(${tint},${(0.22 * br).toFixed(3)})`);
            g.addColorStop(1, `rgba(${tint},0)`);
            c.fillStyle = g;
            c.fillRect(px - 14, py - 14, 28, 28);
          }
          c.fillStyle = `rgba(${tint},${(0.55 + 0.4 * br).toFixed(3)})`;
          c.beginPath();
          c.arc(px, py, 0.9 + br * 1.1, 0, 6.2832);
          c.fill();
        }
      }

      function drawConstellations(c, skyW, skyH, list) {
        for (let i = 0; i < list.length; i++) {
          const K = list[i];
          const bw = K.fw * skyW, bh = K.fh * skyH;
          const ox = K.fx * skyW, oy = K.fy * skyH;
          wrapDraw(c, skyW, ox + bw / 2, oy + bh / 2, Math.max(bw, bh) / 2 + 16, (cc, x2, y2) => {
            drawConstellationAt(cc, x2 - bw / 2, y2 - bh / 2, K, bw, bh);
          });
        }
      }

      /** 每个星域随机生成的天幕（0.6 倍分辨率绘制，水平无缝环绕）。 */
      function buildSkyCanvas() {
        const skyW = Math.max(1400, Math.ceil(W * 1.7));
        const skyH = Math.max(1000, Math.ceil(H * 2.6));
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(skyW * 0.6); cv.height = Math.ceil(skyH * 0.6);
        const c = cv.getContext('2d');
        c.scale(0.6, 0.6);

        // 银河带：整周期正弦弯曲，环绕无缝
        const bandPairs = [['235,228,210', '205,215,240'], ['225,215,235', '190,210,250'], ['235,222,200', '210,200,230']];
        const pair = bandPairs[Math.floor(Math.random() * bandPairs.length)];
        const amp = skyH * (0.05 + Math.random() * 0.07);
        const phase = Math.random() * 6.2832;
        const bandY = (x) => skyH * 0.5 + bandYFor(amp, phase, skyW, x);
        for (let i = 0; i < 8; i++) {
          const bx0 = ((i + 0.5) / 8) * skyW;
          const px = bx0 + (Math.random() - 0.5) * skyW * 0.05;
          const py = bandY(bx0) + (Math.random() - 0.5) * skyH * 0.03;
          const r = skyH * (0.18 + Math.random() * 0.1);
          const col = Math.random() < 0.5 ? pair[0] : pair[1];
          wrapDraw(c, skyW, px, py, r, (cc, x2, y2) => {
            const g = cc.createRadialGradient(x2, y2, 0, x2, y2, r);
            g.addColorStop(0, `rgba(${col},0.09)`);
            g.addColorStop(0.55, `rgba(${col},0.04)`);
            g.addColorStop(1, `rgba(${col},0)`);
            cc.fillStyle = g;
            cc.fillRect(x2 - r, y2 - r, r * 2, r * 2);
          });
        }
        // 尘埃暗纹（沿银河带）
        for (let d = 0; d < 12; d++) {
          const dxx = Math.random() * skyW;
          const dyy = bandY(dxx) + (Math.random() - 0.5) * skyH * 0.07;
          const dr = skyH * (0.05 + Math.random() * 0.09);
          wrapDraw(c, skyW, dxx, dyy, dr, (cc, x2, y2) => {
            const g2 = cc.createRadialGradient(x2, y2, 0, x2, y2, dr);
            g2.addColorStop(0, 'rgba(6,7,12,0.5)');
            g2.addColorStop(1, 'rgba(6,7,12,0)');
            cc.fillStyle = g2;
            cc.fillRect(x2 - dr, y2 - dr, dr * 2, dr * 2);
          });
        }
        // 随机星云（不规则团块）
        const nebHues = ['255,110,150', '70,180,190', '140,110,220', '230,140,90'];
        const nebN = 1 + Math.floor(Math.random() * 3);
        for (let nb = 0; nb < nebN; nb++) {
          const nbr = skyH * (0.06 + Math.random() * 0.08);
          const nbHue = nebHues[Math.floor(Math.random() * nebHues.length)];
          const nbK = 0.7 + Math.random() * 0.5;
          const nbSize = Math.ceil(nbr * 2.6);
          const nbSpr = makeSprite(nbSize, nbSize, (cc) => drawNebula(cc, nbSize / 2, nbSize / 2, nbr, nbHue, nbK));
          const nbx = skyW * (0.08 + Math.random() * 0.84), nby = skyH * (0.08 + Math.random() * 0.84);
          wrapDraw(c, skyW, nbx, nby, nbSize / 2, (cc, x2, y2) => {
            cc.drawImage(nbSpr.cv, x2 - nbSpr.w / 2, y2 - nbSpr.h / 2, nbSpr.w, nbSpr.h);
          });
        }
        // 星点收集（延后分帧绘制；边缘点对侧补画）
        const dots = [];
        function pushDot(x, y, sz, st) {
          dots.push(x, y, sz, st);
          if (x < 2) dots.push(x + skyW, y, sz, st);
          else if (x > skyW - 2) dots.push(x - skyW, y, sz, st);
        }
        const bandStars = Math.round((skyW * skyH) / 240);
        for (let b = 0; b < bandStars; b++) {
          const sx = Math.random() * skyW;
          const gauss = (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
          const sy = bandY(sx) + gauss * skyH * 0.075;
          if (sy < -4 || sy > skyH + 4) continue;
          pushDot(sx, sy, Math.random() < 0.85 ? 0.6 : 1.0, Math.floor(Math.random() * 4));
        }
        const fieldStars = Math.round((skyW * skyH) / 2000);
        for (let f = 0; f < fieldStars; f++) {
          const fx = Math.random() * skyW, fy = Math.random() * skyH;
          const mag = Math.pow(Math.random(), 2.4);
          pushDot(fx, fy, 0.5 + mag * 1.1, 4 + pickTint() * 4 + Math.min(3, Math.floor(mag * 4)));
        }
        // 亮星衍射十字
        for (let s2 = 0; s2 < 7; s2++) {
          const gx = Math.random() * skyW, gy = Math.random() * skyH;
          const tint2 = TINTS[pickTint()];
          const r2 = 1.1 + Math.random() * 1.2;
          const L = r2 * (5 + Math.random() * 4);
          wrapDraw(c, skyW, gx, gy, L, (cc, x2, y2) => {
            cc.fillStyle = `rgba(${tint2},0.95)`;
            cc.beginPath(); cc.arc(x2, y2, r2, 0, 6.2832); cc.fill();
            cc.strokeStyle = `rgba(${tint2},0.3)`;
            cc.lineWidth = 0.8;
            cc.beginPath();
            cc.moveTo(x2 - L, y2); cc.lineTo(x2 + L, y2);
            cc.moveTo(x2, y2 - L); cc.lineTo(x2, y2 + L);
            cc.stroke();
          });
        }
        // 星系
        const gal = 2 + Math.floor(Math.random() * 3);
        for (let gl = 0; gl < gal; gl++) {
          const ggr = skyH * (0.012 + Math.random() * 0.024);
          const ggx = skyW * (0.1 + Math.random() * 0.8), ggy = skyH * (0.1 + Math.random() * 0.8);
          const ggt = (Math.random() - 0.5) * 1.6, ggk = 0.5 + Math.random() * 0.5;
          wrapDraw(c, skyW, ggx, ggy, ggr * 8, (cc, x2, y2) => drawGalaxy(cc, x2, y2, ggr, ggt, ggk));
        }
        if (Math.random() < 0.35) {
          const bgr = skyH * (0.03 + Math.random() * 0.02);
          const bgx = skyW * (0.2 + Math.random() * 0.6), bgy = skyH * (0.2 + Math.random() * 0.6);
          const bgt = (Math.random() - 0.5) * 1.2;
          wrapDraw(c, skyW, bgx, bgy, bgr * 8, (cc, x2, y2) => drawGalaxy(cc, x2, y2, bgr, bgt, 1));
        }
        // 疏散星团（六成星域）
        if (Math.random() < 0.6) {
          const clR = skyH * 0.04;
          const clSize = Math.ceil(clR * 2.4);
          const clSpr = makeSprite(clSize, clSize, (cc) => {
            for (let q = 0; q < 46; q++) {
              const a2 = Math.random() * 6.2832;
              const rr2 = Math.pow(Math.random(), 1.6) * clR * 0.85;
              cc.fillStyle = `rgba(215,225,250,${(0.15 + Math.random() * 0.4).toFixed(3)})`;
              cc.beginPath();
              cc.arc(clSize / 2 + Math.cos(a2) * rr2, clSize / 2 + Math.sin(a2) * rr2 * 0.8, 0.4 + Math.random() * 0.8, 0, 6.2832);
              cc.fill();
            }
          });
          const clx = skyW * (0.15 + Math.random() * 0.7), cly = skyH * (0.15 + Math.random() * 0.7);
          wrapDraw(c, skyW, clx, cly, clSize / 2, (cc, x2, y2) => {
            cc.drawImage(clSpr.cv, x2 - clSpr.w / 2, y2 - clSpr.h / 2, clSpr.w, clSpr.h);
          });
        }
        // 远景行星（0-2 颗，含带环）
        const pl = Math.floor(Math.random() * 3);
        for (let pl2 = 0; pl2 < pl; pl2++) {
          const plr = H * (0.025 + Math.random() * 0.03);
          const pt = Math.random();
          const ptype = pt < 0.2 ? 3 : pt < 0.55 ? 0 : pt < 0.85 ? 1 : 2;
          const plSpr = makeSprite(Math.ceil(plr * 4.4), Math.ceil(plr * 3), (cc) => drawPlanetBody(cc, plr * 2.2, plr * 1.5, plr, ptype));
          const plx = skyW * (0.1 + Math.random() * 0.8), ply = skyH * (0.1 + Math.random() * 0.8);
          wrapDraw(c, skyW, plx, ply, Math.max(plSpr.w, plSpr.h) / 2, (cc, x2, y2) => {
            cc.drawImage(plSpr.cv, x2 - plSpr.w / 2, y2 - plSpr.h / 2, plSpr.w, plSpr.h);
          });
        }
        drawConstellations(c, skyW, skyH, makeConstellations());
        return { cv, c, w: skyW, h: skyH, dots };
      }

      function newSky() {
        const s = buildSkyCanvas();
        skyFillJobs.push({ c: s.c, dots: s.dots, i: 0 });
        return s;
      }

      function buildVignette() {
        vig = document.createElement('canvas');
        vig.width = Math.max(2, Math.ceil(W));
        vig.height = Math.max(2, Math.ceil(H));
        const c = vig.getContext('2d');
        const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
        g.addColorStop(0, 'rgba(2,3,8,0)');
        g.addColorStop(1, 'rgba(2,3,8,0.5)');
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);
        // 舷窗四角括框
        c.strokeStyle = 'rgba(160,190,230,0.28)';
        c.lineWidth = 1;
        const o = 14, L = 22;
        c.beginPath();
        c.moveTo(o, o + L); c.lineTo(o, o); c.lineTo(o + L, o);
        c.moveTo(W - o - L, o); c.lineTo(W - o, o); c.lineTo(W - o, o + L);
        c.moveTo(o, H - o - L); c.lineTo(o, H - o); c.lineTo(o + L, H - o);
        c.moveTo(W - o - L, H - o); c.lineTo(W - o, H - o); c.lineTo(W - o, H - o - L);
        c.stroke();
        lastSkyKey = '';
      }

      /** 天幕随偏航/俯仰旋转；随速度整体缩放；星域切换交叉淡入。 */
      function drawSkyFrame(yaw, pitch) {
        yaw = typeof yaw === 'number' ? yaw : cam.yaw;
        pitch = typeof pitch === 'number' ? pitch : cam.pitch;
        const slw = sky.w, slh = sky.h;
        const zs = 1 + skyZoom;
        ctxSky.globalCompositeOperation = 'source-over';
        ctxSky.fillStyle = '#04060e';
        ctxSky.fillRect(0, 0, W, H);
        const cx = W / 2, cy = H / 2;
        const xo = -(yaw / 6.2832) * slw;
        const vppr = ((slh - H) / 2) / 1.5708;
        const yo = (H - slh) / 2 + pitch * vppr;
        const x0 = ((xo % slw) + slw) % slw - slw;
        const zx0 = cx + (x0 - cx) * zs;
        const zy0 = cy + (yo - cy) * zs;
        const zw = slw * zs, zh = slh * zs;
        ctxSky.drawImage(sky.cv, zx0, zy0, zw, zh);
        ctxSky.drawImage(sky.cv, zx0 + zw, zy0, zw, zh);
        if (skyNext) {
          ctxSky.globalAlpha = Math.min(1, skyTrans);
          ctxSky.drawImage(skyNext.cv, zx0, zy0, zw, zh);
          ctxSky.drawImage(skyNext.cv, zx0 + zw, zy0, zw, zh);
          ctxSky.globalAlpha = 1;
        }
        if (vig) ctxSky.drawImage(vig, 0, 0, W, H);
      }

      function resize() {
        const rect = root.getBoundingClientRect();
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        W = Math.max(1, rect.width); H = Math.max(1, rect.height);
        skyCanvasEl.width = Math.round(W * dpr); skyCanvasEl.height = Math.round(H * dpr);
        ctxSky.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (hudCanvasEl) {
          hudCanvasEl.width = Math.round(W * dpr); hudCanvasEl.height = Math.round(H * dpr);
          ctxHud.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        skyRebuildPending = true;
        skyNext = null;
        nextSectorAt = performance.now() + 12000;
      }

      /* ---------- 交互（仅 interactive 实例） ---------- */

      function deadzone(v) {
        const a = Math.abs(v);
        if (a < 0.07) return 0;
        return (v - (v < 0 ? -0.07 : 0.07)) / 0.93;
      }
      function pointSteer(e) {
        const r = root.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        if (py > H - Math.max(70, H * 0.15)) { steerTarget.x = 0; steerTarget.y = 0; return; }
        steerTarget.x = deadzone(clamp((px - W / 2) / (W / 2), -1, 1));
        steerTarget.y = deadzone(clamp((py - H / 2) / (H / 2), -1, 1));
      }
      function onPointerMove(e) { pointSteer(e); }
      function onPointerDown(e) {
        if (e.pointerType !== 'mouse') { try { root.setPointerCapture(e.pointerId); } catch (err) { /* 捕获失败按普通移动处理 */ } }
        pointSteer(e);
      }
      function onPointerLeave(e) {
        if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        steerTarget.x = 0; steerTarget.y = 0;
      }
      function onKeyDown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.target && e.target.closest && e.target.closest('button,input,select,textarea,[contenteditable]')) return;
        if (e.key === 'ArrowLeft') { keys.l = true; e.preventDefault(); }
        else if (e.key === 'ArrowRight') { keys.r = true; e.preventDefault(); }
        else if (e.key === 'ArrowUp') { keys.u = true; e.preventDefault(); }
        else if (e.key === 'ArrowDown') { keys.d = true; e.preventDefault(); }
      }
      function onKeyUp(e) {
        if (e.key === 'ArrowLeft') keys.l = false;
        else if (e.key === 'ArrowRight') keys.r = false;
        else if (e.key === 'ArrowUp') keys.u = false;
        else if (e.key === 'ArrowDown') keys.d = false;
      }
      function onContextMenu(e) { e.preventDefault(); }
      function onVisibility() {
        if (document.hidden || cancelled) return;
        const now = performance.now();
        if (nextSectorAt < now) nextSectorAt = now + 6000;
        if (flyby.nextAt < now) flyby.nextAt = now + 8000;
        if (nextMeteorAt < now) nextMeteorAt = now + 4000;
      }

      /* ---------- 主循环 ---------- */

      function frame(t) {
        if (cancelled) return;
        rafId = requestAnimationFrame(frame);
        if (fpsCap > 0 && t - lastDrawT < 1000 / fpsCap - 2) return;
        lastDrawT = t;
        const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
        lastT = t;
        if (!W || !H || document.hidden) return;

        // 尺寸变化后重建天幕（节流；无 hud 模式仅重建天幕）
        if (!sky || (skyRebuildPending && t - lastSkyBuildAt > 200)) {
          skyFillJobs.length = 0;
          sky = newSky();
          if (showHud) buildVignette();
          skyRebuildPending = false;
          lastSkyBuildAt = t;
        }

        // 星域演化
        if (!skyNext && t >= nextSectorAt) {
          skyNext = newSky();
          transStartT = t;
          skyTrans = 0;
        }
        if (skyNext) {
          skyTrans = (t - transStartT) / 2500;
          if (skyTrans >= 1) {
            sky = skyNext; skyNext = null; lastSkyKey = '';
            nextSectorAt = t + 16000 + Math.random() * 12000;
          }
        }

        // 分帧填充天幕星点
        if (skyFillJobs.length) {
          const job = skyFillJobs[0];
          const jd = job.dots, jc = job.c;
          const jEnd = Math.min(jd.length, job.i + 9600);
          for (let ji = job.i; ji < jEnd; ji += 4) {
            const jst = jd[ji + 3];
            jc.fillStyle = DOT_STYLES[jst];
            if (jst < 4) {
              jc.fillRect(jd[ji], jd[ji + 1], jd[ji + 2], jd[ji + 2]);
            } else {
              jc.beginPath();
              jc.arc(jd[ji], jd[ji + 1], jd[ji + 2], 0, 6.2832);
              jc.fill();
            }
          }
          job.i = jEnd;
          if (job.i >= jd.length) skyFillJobs.shift();
        }

        // 航速 / 缩放脉动（外观背景为恒速巡航，无跃迁）
        const speedNow = typeof opts.getSpeed === 'function' ? clamp(opts.getSpeed() || 0.12, 0.02, 10) : (opts.speed || 0.12);
        const bt = 0;
        const spdC = speedNow * (1 + 2.8 * boostEase);
        const zoomTarget = Math.min(0.18, 0.05 * spdC) + (reducedMotion ? 0 : boostEase * 0.03 * Math.sin(t * 0.0012));
        skyZoom += (zoomTarget - skyZoom) * Math.min(1, dt * 1.4);

        // 视角：自由转向（interactive）或环境漂移（外观背景）
        const kx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
        const ky = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
        if (kx || ky) {
          kbOffset.x = clamp(kbOffset.x + kx * dt * 1.6, -1, 1);
          kbOffset.y = clamp(kbOffset.y + ky * dt * 1.6, -1, 1);
        } else {
          const decay = Math.pow(0.12, dt);
          kbOffset.x *= decay; kbOffset.y *= decay;
        }
        const tx = clamp(steerTarget.x + kbOffset.x, -1, 1);
        const ty = clamp(steerTarget.y + kbOffset.y, -1, 1);
        const st = Math.min(1, dt * 6.5);
        steer.x += (tx - steer.x) * st;
        steer.y += (ty - steer.y) * st;
        cam.yaw += steer.x * YAW_RATE * dt + (reducedMotion ? 0 : autoDrift * dt);
        cam.pitch = clamp(cam.pitch - steer.y * PITCH_RATE * dt, -PITCH_MAX, PITCH_MAX);

        if (parallax && !reducedMotion) {
          const pSt = Math.min(1, dt * 4.0);
          curParallaxYaw += (targetParallaxYaw - curParallaxYaw) * pSt;
          curParallaxPitch += (targetParallaxPitch - curParallaxPitch) * pSt;
        } else {
          curParallaxYaw = 0;
          curParallaxPitch = 0;
        }
        const effYaw = cam.yaw + curParallaxYaw;
        const effPitch = clamp(cam.pitch - curParallaxPitch, -PITCH_MAX, PITCH_MAX);

        const { f, r, u } = buildBasis(effYaw, effPitch);

        // 天幕重绘（旋转 / 过渡 / 缩放期间）
        if (skyNext) {
          drawSkyFrame(effYaw, effPitch);
        } else {
          const skyKey = `${W}x${H}:${Math.round(effYaw * 60)},${Math.round(effPitch * 60)},${Math.round(skyZoom * 400)}`;
          if (skyKey !== lastSkyKey) { drawSkyFrame(effYaw, effPitch); lastSkyKey = skyKey; }
        }

        const minDim = Math.min(W, H);
        const cx = W / 2, cy = H / 2;
        const focal = minDim * (0.92 - 0.2 * boostEase);
        const f2 = focal * (1 + 0.08 * boostEase);
        const v = speedNow * (1 + 2.8 * boostEase) * 0.9;
        const mv = v * dt;

        for (let i = 0; i < NB; i++) { lineBuckets[i].length = 0; dotBuckets[i].length = 0; }
        coreDots.length = 0;

        const m = 40;
        for (let i2 = 0; i2 < stars.length; i2++) {
          const s = stars[i2];
          s.x -= f[0] * mv; s.y -= f[1] * mv; s.z -= f[2] * mv;
          let cz = s.x * f[0] + s.y * f[1] + s.z * f[2];
          if (cz <= Z_NEAR) {
            const ang = Math.random() * Math.PI * 2;
            const rad = Math.sqrt(Math.random()) * SPREAD;
            const dz = Z_FAR - Math.random() * 0.15;
            const ox2 = Math.cos(ang) * rad, oy2 = Math.sin(ang) * rad;
            s.x = f[0] * dz + r[0] * ox2 + u[0] * oy2;
            s.y = f[1] * dz + r[1] * ox2 + u[1] * oy2;
            s.z = f[2] * dz + r[2] * ox2 + u[2] * oy2;
            cz = dz;
            s.px = NaN; s.py = NaN;
          }
          const cxr = s.x * r[0] + s.y * r[1] + s.z * r[2];
          const cyu = s.x * u[0] + s.y * u[1] + s.z * u[2];
          const x = cx + (cxr / cz) * f2;
          const y = cy - (cyu / cz) * f2;
          if (x < -m || x > W + m || y < -m || y > H + m) { s.px = x; s.py = y; continue; }
          if (isFinite(s.px)) {
            const wb = cz > 0.55 ? 0 : cz > 0.16 ? 1 : 2;
            const fade = Math.min(1, Math.max(0, (Z_FAR - cz) / (Z_FAR - 0.55)));
            let eff = fade * (0.35 + 0.65 * s.m);
            if (!reducedMotion) eff *= 1 + 0.07 * Math.sin(t * 0.004 + s.tw);
            const ab = Math.min(3, Math.floor(eff * 4));
            const key = (s.ci * 3 + wb) * 4 + ab;
            const ddx = x - s.px, ddy = y - s.py;
            if (ddx * ddx + ddy * ddy < 2.25) {
              dotBuckets[key].push(x, y, DOT_R[wb] * (0.65 + 0.7 * s.m));
            } else {
              lineBuckets[key].push(s.px, s.py, x, y);
            }
          }
          s.px = x; s.py = y;
          if (cz < 0.14) coreDots.push(x, y, cz);
        }

        // 1) 运动模糊
        const fa = reducedMotion ? 0.75 : 0.38 - 0.16 * boostEase;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0,0,0,${fa})`;
        ctx.fillRect(0, 0, W, H);

        // 2) 掠过的大行星
        if (!flyby.active && t >= flyby.nextAt && planetSprites) {
          const fAng = Math.random() * 6.2832;
          const fLat = 0.55 + Math.random() * 0.8;
          const fOx = Math.cos(fAng) * fLat, fOy = Math.sin(fAng) * fLat;
          const fDz = Z_FAR * 1.35;
          flyby.x = f[0] * fDz + r[0] * fOx + u[0] * fOy;
          flyby.y = f[1] * fDz + r[1] * fOx + u[1] * fOy;
          flyby.z = f[2] * fDz + r[2] * fOx + u[2] * fOy;
          flyby.sprite = planetSprites[Math.floor(Math.random() * planetSprites.length)];
          flyby.r = 0.15 + Math.random() * 0.13;
          flyby.active = true;
        }
        if (flyby.active) {
          flyby.x -= f[0] * mv; flyby.y -= f[1] * mv; flyby.z -= f[2] * mv;
          const fcz = flyby.x * f[0] + flyby.y * f[1] + flyby.z * f[2];
          if (fcz < 0.06) {
            flyby.active = false;
            flyby.nextAt = t + 25000 + Math.random() * 35000;
          } else {
            const fcx = flyby.x * r[0] + flyby.y * r[1] + flyby.z * r[2];
            const fcy = flyby.x * u[0] + flyby.y * u[1] + flyby.z * u[2];
            const pr = (f2 * flyby.r) / fcz;
            const nx2 = fcx / fcz, ny2 = fcy / fcz;
            if (Math.abs(nx2) < 1.7 && Math.abs(ny2) < 1.3 && pr < H * 0.8) {
              const ppx = cx + nx2 * f2, ppy = cy - ny2 * f2;
              const psc = pr / 70;
              const farFade = fcz > 1.1 ? Math.min(1, (Z_FAR * 1.35 - fcz) / 0.45) : 1;
              const nearFade = pr > H * 0.45 ? Math.max(0, (H * 0.8 - pr) / (H * 0.35)) : 1;
              ctx.globalCompositeOperation = 'source-over';
              ctx.globalAlpha = farFade * nearFade;
              ctx.drawImage(flyby.sprite, ppx - 180 * psc, ppy - 130 * psc, 360 * psc, 260 * psc);
              ctx.globalAlpha = 1;
            }
          }
        }

        // 3) 星点与光轨
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let k = 0; k < NB; k++) {
          const dots = dotBuckets[k];
          if (dots.length) {
            ctx.fillStyle = bucketStyle[k];
            for (let q = 0; q < dots.length; q += 3) {
              const r3 = dots[q + 2];
              ctx.fillRect(dots[q] - r3, dots[q + 1] - r3, r3 * 2, r3 * 2);
            }
          }
          const segs = lineBuckets[k];
          if (segs.length) {
            ctx.strokeStyle = bucketStyle[k];
            ctx.lineWidth = widths[Math.floor(k / 4) % 3];
            ctx.beginPath();
            for (let q2 = 0; q2 < segs.length; q2 += 4) {
              ctx.moveTo(segs[q2], segs[q2 + 1]);
              ctx.lineTo(segs[q2 + 2], segs[q2 + 3]);
            }
            ctx.stroke();
          }
        }

        // 4) 近处恒星光核
        if (coreDots.length) {
          ctx.fillStyle = 'rgba(255,250,242,0.85)';
          for (let d2 = 0; d2 < coreDots.length; d2 += 3) {
            const cr = Math.min(3.2, (focal * 0.0026) / coreDots[d2 + 2]);
            ctx.beginPath();
            ctx.arc(coreDots[d2], coreDots[d2 + 1], cr, 0, 6.2832);
            ctx.fill();
          }
        }

        // 5) 流星
        if (!meteor && !reducedMotion && t >= nextMeteorAt) {
          const mAng = Math.random() * 6.2832;
          const mLen = 140 + Math.random() * 160;
          meteor = {
            x: W * (0.1 + Math.random() * 0.8), y: H * (0.05 + Math.random() * 0.55),
            dx: Math.cos(mAng) * mLen, dy: Math.sin(mAng) * mLen,
            t0: t, dur: 650 + Math.random() * 450,
          };
        }
        if (meteor) {
          const pm = (t - meteor.t0) / meteor.dur;
          if (pm >= 1) { meteor = null; nextMeteorAt = t + 5000 + Math.random() * 11000; }
          else {
            const mhx = meteor.x + meteor.dx * pm, mhy = meteor.y + meteor.dy * pm;
            const mAlpha = Math.sin(Math.PI * pm) * 0.6;
            ctx.strokeStyle = `rgba(255,250,240,${mAlpha.toFixed(3)})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(mhx - meteor.dx * 0.22, mhy - meteor.dy * 0.22);
            ctx.lineTo(mhx, mhy);
            ctx.stroke();
            ctx.fillStyle = `rgba(255,255,255,${(mAlpha * 0.9).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(mhx, mhy, 1.4, 0, 6.2832);
            ctx.fill();
          }
        }
      }

      /* ---------- 启动 / 释放 ---------- */

      buildPlanetSprites();
      resize();
      let ro = null;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(resize);
        ro.observe(root);
      } else {
        window.addEventListener('resize', resize);
      }
      sky = newSky();
      if (showHud) buildVignette();
      skyRebuildPending = false;
      nextSectorAt = performance.now() + 14000 + Math.random() * 10000;

      if (interactive) {
        root.addEventListener('pointermove', onPointerMove);
        root.addEventListener('pointerdown', onPointerDown);
        root.addEventListener('pointerleave', onPointerLeave);
        root.addEventListener('contextmenu', onContextMenu);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
      }
      if (parallax && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pointermove', onWindowPointer, { passive: true });
      }
      document.addEventListener('visibilitychange', onVisibility);
      rafId = requestAnimationFrame(frame);

      return {
        /** 热更新恒星数量（不销毁引擎）。 */
        setDensity,
        dispose() {
          cancelled = true;
          cancelAnimationFrame(rafId);
          if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
          if (interactive) {
            root.removeEventListener('pointermove', onPointerMove);
            root.removeEventListener('pointerdown', onPointerDown);
            root.removeEventListener('pointerleave', onPointerLeave);
            root.removeEventListener('contextmenu', onContextMenu);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
          }
          if (parallax && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('pointermove', onWindowPointer);
          }
          document.removeEventListener('visibilitychange', onVisibility);
          skyCanvasEl.remove(); canvas.remove();
          if (hudCanvasEl) hudCanvasEl.remove();
        },
      };
    }
    /**
     * 极简星空层挂载：纯净、免配置、零侵入。
     * 仅挂载底层 Canvas 星空动画，不侵入主题 Token、不设悬浮按钮、不提供设置项。
     */


    const SpaceManager = (function() {
      const SPEED_CONFIGS = [
        {
          mode: 'cruise',
          speed: 0.12,
          title: '星空航速 (SPD) [1/3 慢速巡航]：星系缓慢平移，宁静防晕（点击切换 2× 加速）'
        },
        {
          mode: 'boost',
          speed: 0.25,
          title: '星空航速 (SPD) [2/3 动力推进]：2倍巡航加速（点击切换 星际穿越）'
        },
        {
          mode: 'warp',
          speed: 0.96,
          title: '星空航速 (SPD) [3/3 星际穿越]：8倍超光速折跃，星轨流线（点击恢复 慢速巡航）'
        }
      ];

      let currentTier = 0;
      try {
        const saved = localStorage.getItem('sbg-speed-mode');
        const foundIdx = SPEED_CONFIGS.findIndex(c => c.mode === saved);
        if (foundIdx >= 0) currentTier = foundIdx;
      } catch (e) {}

      let engine = null;
      let rootEl = null;
      let styleEl = null;
      let speedBtnEl = null;

      function start() {
        if (engine) return;

        // 1. 样式与穿透层叠
        if (!styleEl) {
          styleEl = document.getElementById('sbg-minimal-style');
          if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'sbg-minimal-style';
            styleEl.textContent = [
              '#sbg-canvas-root { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; pointer-events: none !important; z-index: 0 !important; overflow: hidden !important; }',
              '.sbg-cv { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; display: block !important; pointer-events: none !important; }',
              '#root { position: relative !important; z-index: 1 !important; background: transparent !important; }',
              'html, body, #root, #app, [class*="_frame"], [class*="q_frame"], [class*="_root"], [class*="_viewArea"], [class*="_mainCol"], [class*="_content"], [class*="an3WzG_root"], [class*="CsSxCG_frame"], [class*="bZwPEG_frame"], [class*="ConversationRoot"], [class*="viewArea"], [class*="sidebarCol"] { background: transparent !important; background-color: transparent !important; }',
              ':root, html body, html body #root { --dsw-alias-label-primary: #FFFFFF !important; --dsw-alias-label-secondary: #cde0ff !important; --dsw-alias-label-tertiary: #a0bde8 !important; --dsw-alias-label-caption: #7d9bc7 !important; --dsw-alias-label-dimmed: #6884ab !important; --dsw-alias-label-primary-bluish: #FFFFFF !important; --dsw-alias-bg-base: transparent !important; --dsw-alias-bg-layer-1: rgba(14, 21, 34, 0.45) !important; --dsw-alias-bg-layer-2: rgba(18, 27, 42, 0.55) !important; --dsw-specific-sidebar-fill: rgba(8, 12, 22, 0.45) !important; color: #FFFFFF !important; }',
              '#root [class*="label"], #root [class*="title"], #root [class*="name"], #root [class*="desc"], #root [class*="item"], #root span, #root p, #root h1, #root h2, #root h3, #root h4 { opacity: 1 !important; visibility: visible !important; }',
              '#sbg-speed-toggle { position: fixed !important; right: 14px !important; bottom: 74px !important; z-index: 10050 !important; padding: 4px 10px !important; font: 700 11px "SF Mono", "JetBrains Mono", Consolas, "Liberation Mono", Menlo, "PingFang SC", "Microsoft YaHei" !important; letter-spacing: 0.16em !important; cursor: pointer !important; clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px) !important; user-select: none !important; transition: all 0.2s cubic-bezier(0.2, 0, 0, 1) !important; }',
              '#sbg-speed-toggle[data-speed-mode="cruise"] { color: #00f0ff !important; background: rgba(6, 14, 24, 0.88) !important; border: 1px solid rgba(0, 240, 255, 0.45) !important; box-shadow: 0 0 6px rgba(0, 240, 255, 0.25) !important; opacity: 0.75 !important; }',
              '#sbg-speed-toggle[data-speed-mode="cruise"]:hover { opacity: 1 !important; border-color: #00f0ff !important; filter: drop-shadow(0 0 8px rgba(0, 240, 255, 0.7)) !important; }',
              '#sbg-speed-toggle[data-speed-mode="boost"] { color: #fce300 !important; background: rgba(22, 18, 4, 0.9) !important; border: 1px solid rgba(252, 227, 0, 0.75) !important; box-shadow: 0 0 10px rgba(252, 227, 0, 0.4) !important; opacity: 0.95 !important; }',
              '#sbg-speed-toggle[data-speed-mode="boost"]:hover { opacity: 1 !important; border-color: #ffee33 !important; filter: drop-shadow(0 0 12px rgba(252, 227, 0, 0.9)) !important; }',
              '#sbg-speed-toggle[data-speed-mode="warp"] { color: #ff007f !important; background: rgba(28, 4, 18, 0.92) !important; border: 1px solid rgba(255, 0, 127, 0.85) !important; box-shadow: 0 0 14px rgba(255, 0, 127, 0.55) !important; opacity: 1 !important; }',
              '#sbg-speed-toggle[data-speed-mode="warp"]:hover { border-color: #ff3399 !important; filter: drop-shadow(0 0 16px rgba(255, 0, 127, 1)) !important; }',
              '#cp2077-deck { bottom: 106px !important; }'
            ].join('\n');
            document.head.appendChild(styleEl);
          }
        }

        // 2. 画布宿主
        if (!rootEl) {
          rootEl = document.getElementById('sbg-canvas-root');
          if (!rootEl) {
            rootEl = document.createElement('div');
            rootEl.id = 'sbg-canvas-root';
            rootEl.setAttribute('data-sbg-root', '1');
            document.body.prepend(rootEl);
          }
        }

        // 3. 右下角 SPD 按钮
        if (!speedBtnEl) {
          speedBtnEl = document.getElementById('sbg-speed-toggle');
          if (!speedBtnEl) {
            speedBtnEl = document.createElement('button');
            speedBtnEl.id = 'sbg-speed-toggle';
            speedBtnEl.type = 'button';
            speedBtnEl.textContent = 'SPD';

            const renderBtn = () => {
              const cfg = SPEED_CONFIGS[currentTier];
              speedBtnEl.textContent = 'SPD';
              speedBtnEl.setAttribute('data-speed-mode', cfg.mode);
              speedBtnEl.setAttribute('aria-pressed', String(currentTier > 0));
              speedBtnEl.title = cfg.title;
            };

            speedBtnEl.addEventListener('click', () => {
              currentTier = (currentTier + 1) % SPEED_CONFIGS.length;
              try {
                localStorage.setItem('sbg-speed-mode', SPEED_CONFIGS[currentTier].mode);
              } catch (e) {}
              renderBtn();
            });

            renderBtn();
            (document.body || document.documentElement).appendChild(speedBtnEl);
          }
        }

        // 4. 启动星空引擎
        engine = createSpaceEngine(rootEl, {
          density: 1600,
          interactive: false,
          hud: false,
          parallax: true,
          getSpeed: () => SPEED_CONFIGS[currentTier].speed,
        });
      }

      function stop() {
        if (engine) {
          try { engine.dispose(); } catch (e) {}
          engine = null;
        }
        if (rootEl && rootEl.parentNode) {
          rootEl.parentNode.removeChild(rootEl);
          rootEl = null;
        }
        if (styleEl && styleEl.parentNode) {
          styleEl.parentNode.removeChild(styleEl);
          styleEl = null;
        }
        if (speedBtnEl && speedBtnEl.parentNode) {
          speedBtnEl.parentNode.removeChild(speedBtnEl);
          speedBtnEl = null;
        }
      }

      return {
        start,
        stop,
        isRunning: () => !!engine
      };
    })();

    /* ══════════════════════════════════════════════════════════════════════════
     * 2. 赛博朋克 2077 HUD 终端主题系统 (CYBERPUNK 2077 HUD THEME)
     * ══════════════════════════════════════════════════════════════════════════ */

const TOKENS = {
			// surfaces — deep night blue-black
			"--dsw-alias-bg-base": "#05070d",
			"--dsw-alias-bg-layer-1": "#0a0e18",
			"--dsw-alias-bg-layer-2": "#0d1322",
			"--dsw-alias-bg-layer-3": "#121a2c",
			"--dsw-alias-bg-overlay": "#141c30",
			"--dsw-alias-bg-module-platform": "#0a101d",
			"--dsw-alias-bg-multi-select": "#11182a",
			"--dsw-alias-bg-skeleton": "rgba(0, 240, 255, 0.07)",
			"--dsw-alias-bg-mask-1": "rgba(0, 0, 0, 0.72)",
			"--dsw-alias-bg-mask-2": "rgba(0, 0, 0, 0.4)",
			"--dsw-alias-bg-mask-3": "rgba(0, 0, 0, 0.72)",
			"--dsw-alias-bg-mask-photo": "rgba(0, 0, 0, 0.9)",
			"--dsw-alias-bg-mask-drop": "rgba(5, 7, 13, 0.72)",

			// labels
			"--dsw-alias-label-primary": "#e8f1ff",
			"--dsw-alias-label-secondary": "#9fb2d6",
			"--dsw-alias-label-tertiary": "#6e80a6",
			"--dsw-alias-label-caption": "#8fa3c8",
			"--dsw-alias-label-dimmed": "#5a6b8c",
			"--dsw-alias-label-primary-bluish": "#e8f1ff",
			"--dsw-alias-label-primary-dimmed": "#d8e6ff",
			"--dsw-alias-label-primary-foreground": "#0a0f18",
			"--dsw-alias-label-primary-inverted": "#0a0f18",

			// brand — the Cyberpunk 2077 yellow
			"--dsw-alias-brand-primary": "#fce300",
			"--dsw-alias-brand-text": "#fce300",
			"--dsw-alias-brand-primary-invert": "#141200",
			"--dsw-alias-brand-primary-new-colorprimary-new-color": "#00f0ff",

			// buttons
			"--dsw-alias-button-primary-fill": "#fce300",
			"--dsw-alias-button-primary-hover": "#fcee0a",
			"--dsw-alias-button-primary-dimmed": "rgba(252, 227, 0, 0.12)",
			"--dsw-alias-button-contrast-fill": "#e8f1ff",
			"--dsw-alias-button-elevated-fill": "#101624",
			"--dsw-alias-button-floating-fill": "#0d1322",
			"--dsw-alias-button-floating-hover": "#141c30",
			"--dsw-alias-button-ghost-active-fill": "#101a2c",
			"--dsw-alias-button-ghost-active-hover": "#162035",
			"--dsw-alias-button-info-fill": "#00c2d9",
			"--dsw-alias-button-info-hover": "#00f0ff",
			"--dsw-alias-button-tool-bar-fill-invisible": "rgba(0, 240, 255, 0.08)",
			"--dsw-alias-button-tool-bar-fill": "rgba(0, 240, 255, 0.14)",
			"--dsw-alias-button-tool-bar-hover": "rgba(0, 240, 255, 0.22)",
			"--dsw-alias-button-ghost-active-border": "#00f0ff",

			// interactive
			"--dsw-alias-interactive-bg-hover": "rgba(0, 240, 255, 0.09)",
			"--dsw-alias-interactive-bg-active": "rgba(0, 240, 255, 0.15)",
			"--dsw-alias-interactive-bg-hover-accent": "rgba(252, 227, 0, 0.14)",
			"--dsw-alias-interactive-bg-hover-danger": "rgba(255, 0, 60, 0.14)",
			"--dsw-alias-interactive-bg-hover-solid": "#141c2b",

			// borders
			"--dsw-alias-border-l1": "rgba(0, 240, 255, 0.12)",
			"--dsw-alias-border-l2": "rgba(0, 240, 255, 0.20)",
			"--dsw-alias-border-l2-darkmode-thin": "rgba(0, 240, 255, 0.10)",
			"--dsw-alias-border-l3": "rgba(252, 227, 0, 0.22)",
			"--dsw-alias-border-l4": "rgba(0, 240, 255, 0.34)",
			"--dsw-alias-border-inverted": "rgba(255, 255, 255, 0.10)",
			"--dsw-alias-border-inverted2": "rgba(255, 255, 255, 0.14)",

			// state
			"--dsw-alias-state-business-primary": "#00f0ff",
			"--dsw-alias-state-business-tertiary": "#0c2a3d",
			"--dsw-alias-state-error-primary": "#ff003c",
			"--dsw-alias-state-error-secondary": "#ff3b69",
			"--dsw-alias-state-success-primary": "#00f5a0",
			"--dsw-alias-state-success-secondary": "#3dffbe",
			"--dsw-alias-state-success-tertiary": "#07301f",
			"--dsw-alias-state-warn-label": "#ffc94d",
			"--dsw-alias-state-warn-primary": "#ffb300",
			"--dsw-alias-state-warn-secondary": "#ffc94d",
			"--dsw-alias-state-warn-tertiary": "#3a2a00",

			// markdown / code
			"--dsw-alias-markdown-code-block": "#060a12",
			"--dsw-alias-markdown-code-block-banner": "#0a0f1c",
			"--dsw-alias-markdown-inline-code": "#12202f",
			"--dsw-alias-markdown-placeholder": "#0e141f",
			"--dsw-alias-markdown-tag": "#0f1a2b",
			"--dsw-alias-markdown-citation": "#0e1626",
			"--dsw-alias-markdown-code-segment-selected": "#10182a",
			"--dsw-alias-markdown-code-segment-unselected": "#0a0f18",

			// scrollbar — neon yellow
			"--dsw-alias-scrollbar-bg-l1": "rgba(252, 227, 0, 0.26)",
			"--dsw-alias-scrollbar-bg-l2": "rgba(252, 227, 0, 0.32)",
			"--dsw-alias-scrollbar-hover-l1": "rgba(252, 227, 0, 0.48)",
			"--dsw-alias-scrollbar-hover-l2": "rgba(252, 227, 0, 0.55)",

			// toast / tooltip
			"--dsw-alias-toast-bg": "#0d1322",
			"--dsw-alias-tooltip-bg": "#141c30",

			// specific surfaces
			"--dsw-specific-bubble": "#0a0f1c",
			"--dsw-specific-bubble-highlight": "#12222e",
			"--dsw-specific-input-major": "#070b12",
			"--dsw-specific-login-input": "#060a11",
			"--dsw-specific-menu": "#121a2c",
			"--dsw-specific-selector": "#0d1322",
			"--dsw-specific-tip": "#0d1424",
			"--dsw-specific-sidebar-fill": "#060a11",
			"--dsw-specific-sidebar-nav-item-active": "#101826",
			"--dsw-specific-sidebar-nav-item-active-accent": "#fce300",
			"--dsw-specific-sidebar-nav-item-hover": "#0f1522",

			// statics
			"--dsw-static-neutral-bluish-00": "#05070d",
			"--dsw-static-neutral-bluish-1000": "#e8f1ff",
			"--dsw-static-neutral-bluish-100": "#0a0e18",
			"--dsw-static-neutral-bluish-200": "#0d1322",
			"--dsw-static-neutral-bluish-300": "#121a2c",
			"--dsw-static-neutral-bluish-400": "#9fb2d6",
			"--dsw-static-neutral-bluish-50": "#0a0e18",
			"--dsw-static-neutral-bluish-500": "#6e80a6",
			"--dsw-static-neutral-bluish-600": "#5a6b8c",
			"--dsw-static-neutral-bluish-700": "#3a4a68",
			"--dsw-static-neutral-bluish-750": "#24324c",
			"--dsw-static-neutral-bluish-75": "#0d1322",
			"--dsw-static-neutral-bluish-800": "#1a2234",
			"--dsw-static-neutral-bluish-850": "#111827",
			"--dsw-static-neutral-bluish-875": "#0d121d",
			"--dsw-static-neutral-bluish-900": "#090d16",
			"--dsw-static-neutral-bluish-950": "#060910",
			"--dsw-static-neutral-bluish-60": "#0a0f18",

			"--dsw-static-deepseek-400": "#00f0ff",
			"--dsw-static-deepseek-450": "#00cfe8",
			"--dsw-static-deepseek-500": "#00c2d9",
			"--dsw-static-deepseek-600": "#0f7da8",
			"--dsw-static-deepseek-700-delete": "#0b4a66",
			"--dsw-static-deepseek-800": "#0a3548",
			"--dsw-static-deepseek-900": "#092433",
			"--dsw-static-deepseek-100": "#12293a",
			"--dsw-static-deepseek-200": "#0f2d42",
			"--dsw-static-deepseek-300": "#0d3550",
			"--dsw-static-deepseek-50": "#0a1526",

			"--dsw-static-blue-400": "#00f0ff",
			"--dsw-static-blue-450": "#00cfe8",
			"--dsw-static-blue-500": "#00b3c9",
			"--dsw-static-blue-600": "#0f7da8",
			"--dsw-static-blue-800": "#0b4a66",
			"--dsw-static-blue-900": "#0a3548",
			"--dsw-static-blue-950": "#092433",
			"--dsw-static-blue-100": "#12263d",
			"--dsw-static-blue-300": "#2bd9f0",
			"--dsw-static-blue-50": "#0a1526",
			"--dsw-static-blue-75": "#0e1c30",
			"--dsw-static-blue-50p": "#0a1a2e",

			"--dsw-static-green-400": "#3dffbe",
			"--dsw-static-green-500": "#00f5a0",
			"--dsw-static-green-100": "#07301f",
			"--dsw-static-green-900": "#043524",

			"--dsw-static-red-400": "#ff3b69",
			"--dsw-static-red-500": "#ff003c",
			"--dsw-static-red-600": "#ff003c",
			"--dsw-static-red-100": "#3a1020",
			"--dsw-static-red-50": "#2b0e1a",
			"--dsw-static-red-900": "#4b0d1c",

			"--dsw-static-amber-400": "#ffc94d",
			"--dsw-static-amber-500": "#ffb300",
			"--dsw-static-amber-600": "#ff9f00",
			"--dsw-static-amber-100": "#3a2a00",
			"--dsw-static-amber-900": "#2b1f00"
		};

		const THEME_ID = "cyberpunk2077";

		// ── config (persisted in localStorage under one key) ───────────────
		const CFG_KEY = "cp2077-cfg";
		const CFG_DEFAULTS = { scan: true, relic: true, boot: true, type: true, sfx: true };
		let cfg = { ...CFG_DEFAULTS };
		function loadCfg() {
			try {
				const raw = localStorage.getItem(CFG_KEY);
				if (raw !== null) cfg = { ...CFG_DEFAULTS, ...JSON.parse(raw) };
			} catch {}
		}
		function saveCfg() {
			try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
		}
		// Effects gate on body classes so CSS can switch them off cheaply.
		function applyCfgToBody() {
			const b = document.body;
			if (b === undefined || b === null) return;
			b.classList.toggle("cp-off-scan", !cfg.scan);
			b.classList.toggle("cp-off-relic", !cfg.relic);
			b.classList.toggle("cp-off-sfx", !cfg.sfx);
		}

		// ── sound engine (Web Audio; everything synthesized, no assets) ────
		let audioCtx = null;
		let noiseBuf = null;
		function ensureAudio() {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (AC === undefined) return null;
			if (audioCtx === null) audioCtx = new AC();
			if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
			return audioCtx;
		}
		function noiseBuffer(ctx) {
			if (noiseBuf !== null) return noiseBuf;
			const len = Math.floor(ctx.sampleRate * 0.06);
			const buf = ctx.createBuffer(1, len, ctx.sampleRate);
			const data = buf.getChannelData(0);
			for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
			noiseBuf = buf;
			return buf;
		}
		// One key click: noise transient + pitch-drop body.
		function playKeyClick(key) {
			if (!cfg.type) return;
			const ctx = ensureAudio();
			if (ctx === null || ctx.state !== "running") return;
			const t = ctx.currentTime;
			const src = ctx.createBufferSource();
			src.buffer = noiseBuffer(ctx);
			const bp = ctx.createBiquadFilter();
			bp.type = "bandpass";
			const base = key === " " ? 1300 : key === "Enter" ? 1000 : 1900;
			bp.frequency.value = base + Math.random() * 900;
			bp.Q.value = 1.1;
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(0.1 + Math.random() * 0.05, t + 0.002);
			g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
			src.connect(bp); bp.connect(g); g.connect(ctx.destination);
			src.start(t); src.stop(t + 0.07);
			const osc = ctx.createOscillator();
			osc.type = "triangle";
			const f0 = key === "Enter" ? 190 : key === " " ? 130 : 150 + Math.random() * 40;
			osc.frequency.setValueAtTime(f0, t);
			osc.frequency.exponentialRampToValueAtTime(55, t + 0.055);
			const g2 = ctx.createGain();
			g2.gain.setValueAtTime(0.0001, t);
			g2.gain.exponentialRampToValueAtTime(0.07, t + 0.003);
			g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
			osc.connect(g2); g2.connect(ctx.destination);
			osc.start(t); osc.stop(t + 0.07);
		}
		// Generic blip helper: oscillator sweep with envelope.
		function blip(freqA, freqB, dur, vol, type, when) {
			const ctx = ensureAudio();
			if (ctx === null || ctx.state !== "running") return;
			const t = ctx.currentTime + (when ?? 0);
			const osc = ctx.createOscillator();
			osc.type = type ?? "square";
			osc.frequency.setValueAtTime(freqA, t);
			if (freqB !== null && freqB !== freqA) osc.frequency.exponentialRampToValueAtTime(freqB, t + dur);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
			g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
			osc.connect(g); g.connect(ctx.destination);
			osc.start(t); osc.stop(t + dur + 0.02);
		}
		// Message lifecycle SFX (all gated on cfg.sfx).
		function playSend() { if (!cfg.sfx) return; blip(680, 1240, 0.09, 0.05, "square"); }
		function playDone() { if (!cfg.sfx) return; blip(880, 880, 0.07, 0.05, "square"); blip(1320, 1320, 0.09, 0.05, "square", 0.1); }
		function playNotify() { if (!cfg.sfx) return; blip(1560, 1560, 0.05, 0.035, "triangle"); blip(2080, 2080, 0.06, 0.03, "triangle", 0.07); }
		function playError() {
			if (!cfg.sfx) return;
			const ctx = ensureAudio();
			if (ctx === null || ctx.state !== "running") return;
			const t = ctx.currentTime;
			const src = ctx.createBufferSource();
			src.buffer = noiseBuffer(ctx);
			const lp = ctx.createBiquadFilter();
			lp.type = "lowpass"; lp.frequency.value = 900;
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.09, t);
			g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
			src.connect(lp); lp.connect(g); g.connect(ctx.destination);
			src.start(t); src.stop(t + 0.3);
			blip(160, 70, 0.28, 0.07, "sawtooth");
		}
		function playWake() {
			if (!cfg.sfx) return;
			blip(120, 48, 0.6, 0.09, "sawtooth");
			blip(2400, 300, 0.35, 0.04, "square", 0.05);
			blip(90, 40, 0.8, 0.08, "sawtooth", 0.35);
		}
		// Johnny engram booting in: two detuned saws beating against each
		// other, punctuated by data-shrieks.
		function playJohnny() {
			if (!cfg.sfx) return;
			blip(58, 52, 0.9, 0.08, "sawtooth");
			blip(61, 55, 0.9, 0.07, "sawtooth");
			blip(1400, 200, 0.12, 0.04, "square", 0.12);
			blip(1400, 180, 0.12, 0.04, "square", 0.5);
		}

		// ── DECK control panel + SND quick chip ────────────────────────────
		function ensureDeckPanel() {
			if (document.getElementById("cp2077-deck") !== null) return null;
			const wrap = document.createElement("div");
			wrap.id = "cp2077-deck";
			wrap.setAttribute("role", "group");
			wrap.setAttribute("aria-label", "Cyberdeck theme settings");
			const title = document.createElement("div");
			title.className = "cp2077-deck-title";
			title.textContent = "CYBERDECK";
			wrap.appendChild(title);
			const items = [
				["scan", "CRT 扫描线"],
				["relic", "Relic 干扰"],
				["boot", "开机转场"],
				["type", "打字音效"],
				["sfx", "消息/提示音"]
			];
			const paint = (btn, on) => {
				btn.textContent = (on ? "◉ " : "○ ") + btn.dataset.label;
				btn.setAttribute("aria-pressed", String(on));
				btn.classList.toggle("cp2077-on", on);
			};
			for (const [key, label] of items) {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.dataset.label = label;
				btn.addEventListener("click", () => {
					cfg[key] = !cfg[key];
					saveCfg();
					applyCfgToBody();
					paint(btn, cfg[key]);
					playNotify();
				});
				paint(btn, cfg[key]);
				wrap.appendChild(btn);
			}
			const deckBtn = document.createElement("button");
			deckBtn.id = "cp2077-deck-toggle";
			deckBtn.type = "button";
			deckBtn.title = "Cyberdeck theme settings";
			deckBtn.textContent = "DECK";
			deckBtn.addEventListener("click", () => {
				const open = wrap.classList.toggle("cp2077-open");
				deckBtn.setAttribute("aria-expanded", String(open));
				deckBtn.classList.toggle("cp2077-open", open);
			});
			(document.body || document.documentElement).append(deckBtn, wrap);
			return { deckBtn, wrap };
		}
		function ensureSndChip() {
			if (document.getElementById("cp2077-snd-toggle") !== null) return null;
			const btn = document.createElement("button");
			btn.id = "cp2077-snd-toggle";
			btn.type = "button";
			btn.title = "Toggle all sounds";
			const paint = () => {
				const on = cfg.type || cfg.sfx;
				btn.textContent = on ? "SND ◉" : "SND ○";
				btn.setAttribute("aria-pressed", String(on));
			};
			btn.addEventListener("click", () => {
				const on = cfg.type || cfg.sfx;
				cfg.type = !on;
				cfg.sfx = !on;
				saveCfg();
				applyCfgToBody();
				paint();
				if (!on) playNotify();
			});
			paint();
			(document.body || document.documentElement).appendChild(btn);
			return btn;
		}

		// ── interaction watchers (send / done / error / toast) ────────────
		let lastSfxAt = 0;
		function throttled(fn) {
			return () => {
				const now = Date.now();
				if (now - lastSfxAt < 90) return;
				lastSfxAt = now;
				fn();
			};
		}
		const onSendSound = throttled(playSend);
		const onNotifySound = throttled(playNotify);
		function onKeydown(e) {
			const el = e.target;
			if (el === null || el.tagName !== "TEXTAREA") return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key === "Enter") {
				onSendSound();
				const word = (el.value ?? "").trim().toLowerCase();
				if (word === "relic" || word === "johnny") return; // egg handles its own audio
				flashChip("GIG UP // 单子已发", "info");
				return;
			}
			playKeyClick(e.key);
		}
		// ── working state: combat HUD, NC loading tips, slang chips ──────
		let workingNow = false;
		let tipTimer = null;
		const NC_TIPS = [
			"TIP：NCPD 的扫描仪分不清义体人和原装人——但账单分得清。",
			"TIP：在夜之城，“免费”的东西最贵。",
			"TIP：超梦看多了，现实会开始像盗版。",
			"TIP：荒坂的合同用小字杀人。",
			"TIP：接单前先问一句：谁吃亏？",
			"TIP：义体不是装得多就强，是装得对就强。",
			"TIP：中间人永远抽成——包括你以为是朋友的那位。",
			"TIP：别在市中心堵车的时候接急单。"
		];
		function flashChip(text, tone) {
			let chip = document.getElementById("cp2077-chip");
			if (chip === null) {
				chip = document.createElement("div");
				chip.id = "cp2077-chip";
				chip.setAttribute("role", "status");
				(document.body || document.documentElement).appendChild(chip);
			}
			chip.className = tone;
			chip.textContent = text;
			// restart the entrance animation
			chip.style.animation = "none";
			void chip.offsetWidth;
			chip.style.animation = "";
			clearTimeout(chip._t);
			chip._t = setTimeout(() => chip.remove(), 1700);
		}
		function startTipRotation() {
			if (tipTimer !== null) return;
			flashChip("GIG IN PROGRESS // " + NC_TIPS[0], "info");
			let i = 1;
			tipTimer = setInterval(() => {
				flashChip("GIG IN PROGRESS // " + NC_TIPS[i % NC_TIPS.length], "info");
				i++;
			}, 6000);
		}
		function stopTipRotation() {
			if (tipTimer === null) return;
			clearInterval(tipTimer);
			tipTimer = null;
		}
		// Poll the composer's pending dot: appears while the agent streams,
		// vanishes on completion → combat-state chrome off, PREEM chip + chime.
		// (An interval is cheaper and more robust than a subtree
		// MutationObserver against a React tree.)
		function startPendingPoll() {
			const timer = setInterval(() => {
				const pending = document.querySelector("[class*='_pending']");
				const is = pending !== null;
				if (is !== workingNow) {
					workingNow = is;
					document.body.classList.toggle("cp-working", is);
					paintTitle();
					if (is) startTipRotation();
					else { stopTipRotation(); flashChip("PREEM. // 任务完成", "ok"); playDone(); }
				}
			}, 450);
			return () => { clearInterval(timer); stopTipRotation(); };
		}

		// ── Night City HUD footer: clock + hex stream, docked into the app's
		// own settings bar (its empty right half) so it never fights the
		// layout for a corner. Hidden when the bar is missing or collapsed.
		function startHudFooter() {
			const hud = document.createElement("div");
			hud.id = "cp2077-hud";
			hud.setAttribute("aria-hidden", "true");
			const hex = document.createElement("span");
			hex.id = "cp2077-hex";
			const clock = document.createElement("span");
			clock.id = "cp2077-clock";
			hud.append(hex, clock);
			(document.body || document.documentElement).appendChild(hud);
			const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
			const rnd = () => Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, "0");
			const bytes = [];
			for (let i = 0; i < 3; i++) bytes.push(rnd());
			const paintHex = () => {
				hex.textContent = "0x" + bytes.join("");
				hex.hidden = !cfg.scan || reduced;
			};
			const paintClock = () => {
				const d = new Date();
				const p = (n) => String(n).padStart(2, "0");
				clock.textContent = p(d.getHours()) + ":" + p(d.getMinutes()) + " NC-TIME";
			};
			// Find the settings bar (zh-CN "设置" / zh-TW "設定" / en "Settings").
			const findBar = () => {
				for (const b of document.querySelectorAll("button")) {
					const label = b.getAttribute("aria-label") || b.title || (b.textContent || "").trim();
					if (label === "设置" || label === "設定" || label.toLowerCase() === "settings") return b;
				}
				return null;
			};
			// Dock right-aligned inside the bar's empty right half.
			const dock = () => {
				const bar = findBar();
				if (bar === null) { hud.style.display = "none"; return; }
				const r = bar.getBoundingClientRect();
				if (r.width < 170 || r.height === 0) { hud.style.display = "none"; return; }
				hud.style.display = "";
				hud.style.left = Math.round(r.right - 10) + "px";
				hud.style.bottom = Math.round(window.innerHeight - r.bottom + (r.height - 13) / 2) + "px";
			};
			paintHex(); paintClock(); dock();
			// The settings bar renders after the app boots — poll the dock
			// every second for the first 20s, then settle into the slow tick.
			const earlyTimer = setInterval(dock, 1000);
			const earlyStop = setTimeout(() => clearInterval(earlyTimer), 20000);
			let hexIdx = 0;
			const t1 = setInterval(() => {
				if (document.hidden) return;
				bytes[hexIdx = (hexIdx + 1) % bytes.length] = rnd();
				paintHex();
			}, 400);
			const t2 = setInterval(() => {
				if (!document.hidden) paintClock();
				dock();
			}, 10000);
			window.addEventListener("resize", dock);
			// Sidebar collapse/expand shifts the bar without a window resize —
			// any click re-docks shortly after (narrow bars auto-hide the hud).
			const onClick = () => setTimeout(dock, 600);
			document.addEventListener("click", onClick, true);
			return () => {
				clearInterval(t1); clearInterval(t2);
				clearInterval(earlyTimer); clearTimeout(earlyStop);
				window.removeEventListener("resize", dock);
				document.removeEventListener("click", onClick, true);
				hud.remove();
			};
		}
		// Watch for error notices / toasts appearing anywhere.
		function startNoticeObserver() {
			const seen = new WeakSet();
			const observer = new MutationObserver((records) => {
				for (const rec of records) {
					for (const node of rec.addedNodes) {
						if (node.nodeType !== 1) continue;
						const el = node;
						if (seen.has(el)) continue;
						seen.add(el);
						const cls = (el.className && typeof el.className === "string") ? el.className : "";
						if (/_noticeError|_turnError/.test(cls)) { playError(); flashChip("FLATLINE // 连接中断", "err"); }
						else if (/_notice([^A-Za-z]|$)|_toast/.test(cls)) onNotifySound();
					}
				}
			});
			observer.observe(document.body, { childList: true, subtree: true });
			return () => observer.disconnect();
		}

		// ── ambient relic interference (random 40–70s, ~200ms) ────────────
		function startRelicLoop() {
			let stopped = false;
			let overlay = null;
			const flick = () => {
				if (stopped) return;
				if (cfg.relic && !document.hidden) {
					if (overlay === null) {
						overlay = document.createElement("div");
						overlay.id = "cp2077-relic";
						overlay.setAttribute("aria-hidden", "true");
					}
					if (!overlay.isConnected) (document.body || document.documentElement).appendChild(overlay);
					setTimeout(() => overlay.remove(), 220);
				}
				setTimeout(flick, 40000 + Math.random() * 30000);
			};
			setTimeout(flick, 25000 + Math.random() * 20000);
			return () => { stopped = true; };
		}

		// ── easter eggs: type a trigger word + Enter ──────────────────────
		// relic  → WAKE UP, SAMURAI (the Relic booting V)
		// johnny → the engram seizes the screen for 2.6s
		const EGGS = {
			relic: {
				id: "cp2077-wake",
				hold: 2000,
				sound: playWake,
				build(ov) {
					const l1 = document.createElement("div");
					l1.className = "cp2077-wake-line1";
					l1.textContent = "WAKE UP, SAMURAI.";
					const l2 = document.createElement("div");
					l2.className = "cp2077-wake-line2";
					l2.textContent = "WE HAVE A CITY TO BURN.";
					ov.append(l1, l2);
				}
			},
			johnny: {
				id: "cp2077-johnny",
				hold: 2600,
				sound: playJohnny,
				build(ov) {
					const LINES = [
						["THIS CITY'S GOT NO ROOM FOR GHOSTS.", "这座城市容不下幽灵。"],
						["NEVER STOP FIGHTING.", "别停下战斗。"],
						["WE HAD A CITY ONCE. WE LET IT BURN.", "我们曾拥有一座城，然后任它烧尽。"],
						["LEGENDS DON'T DIE. THEY JUST GO OFFLINE.", "传奇不死，只是下线。"]
					];
					const pick = LINES[Math.floor(Math.random() * LINES.length)];
					ov.append(
						Object.assign(document.createElement("div"), { className: "cp2077-johnny-tint" }),
						Object.assign(document.createElement("div"), { className: "cp2077-johnny-tear" })
					);
					const box = document.createElement("div");
					box.className = "cp2077-johnny-box";
					const q = document.createElement("div");
					q.className = "cp2077-johnny-quote";
					q.textContent = pick[0];
					const cn = document.createElement("div");
					cn.className = "cp2077-johnny-cn";
					cn.textContent = pick[1];
					const by = document.createElement("div");
					by.className = "cp2077-johnny-attr";
					by.textContent = "— JOHNNY SILVERHAND // ENGRAM";
					box.append(q, cn, by);
					ov.append(box);
				}
			}
		};
		function startTriggerWatcher() {
			const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
			const handler = (e) => {
				const el = e.target;
				if (el === null || el.tagName !== "TEXTAREA") return;
				if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey) return;
				const egg = EGGS[(el.value ?? "").trim().toLowerCase()];
				if (egg === undefined || document.getElementById(egg.id) !== null) return;
				if (egg.id === "cp2077-johnny" && reduced()) return;
				const ov = document.createElement("div");
				ov.id = egg.id;
				ov.setAttribute("aria-hidden", "true");
				egg.build(ov);
				(document.body || document.documentElement).appendChild(ov);
				egg.sound();
				setTimeout(() => ov.remove(), egg.hold);
			};
			document.addEventListener("keydown", handler, true);
			return () => document.removeEventListener("keydown", handler, true);
		}

		// ── tab takeover: glitched favicon + terminal title ───────────────
		const TITLE_BASE = "DSH // NC-TERMINAL";
		function paintTitle() {
			document.title = (workingNow ? "▶ NC-JOB // " : "") + TITLE_BASE;
		}
		function applyTabIdentity() {
			try {
				const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
					+ "<rect width='32' height='32' fill='#05070d'/>"
					+ "<polygon points='6,3 26,3 29,6 29,26 26,29 3,29 3,6' fill='#fce300'/>"
					+ "<polygon points='10,8 22,8 24,10 24,22 22,24 8,24 8,10' fill='#05070d'/>"
					+ "<rect x='12' y='12' width='8' height='8' fill='#00f0ff'/></svg>";
				const href = "data:image/svg+xml," + encodeURIComponent(svg);
				let link = document.querySelector("link[rel*='icon']");
				if (link === null) {
					link = document.createElement("link");
					link.rel = "icon";
					(document.head || document.documentElement).appendChild(link);
				}
				link.href = href;
			} catch {}
			const glitchChars = "▓▒░#%@&$";
			paintTitle();
			const timer = setInterval(() => {
				if (document.hidden) return;
				const b = workingNow ? "▶ NC-JOB // " + TITLE_BASE : TITLE_BASE;
				const i = Math.floor(Math.random() * b.length);
				document.title = b.slice(0, i) + glitchChars[Math.floor(Math.random() * glitchChars.length)] + b.slice(i + 1);
				setTimeout(paintTitle, 160);
			}, 9000);
			return () => clearInterval(timer);
		}

		// ── boot glitch transition (once per tab SESSION: the first load of a
		// tab plays it; reloads/reconnects within that session skip the replay,
		// a fresh tab or a new day sees it again) ─────────────────────────
		const BOOT_SEEN_KEY = "cp2077-boot-seen";
		function playBootTransition() {
			if (!cfg.boot) return null;
			if (document.getElementById("cp2077-boot") !== null) return null;
			if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
			try {
				if (sessionStorage.getItem(BOOT_SEEN_KEY) === "1") return null;
				sessionStorage.setItem(BOOT_SEEN_KEY, "1");
			} catch {}
			const ov = document.createElement("div");
			ov.id = "cp2077-boot";
			ov.setAttribute("aria-hidden", "true");
			const mk = (cls, text) => {
				const d = document.createElement("div");
				d.className = cls;
				if (text !== undefined) d.textContent = text;
				return d;
			};
			ov.append(
				mk("cp-line"),
				mk("cp-crt"),
				mk("cp-bars"),
				mk("cp-title", "NIGHT CITY"),
				mk("cp-sub", "DSH TERMINAL // NETRUNNER OS"),
				mk("cp-flash")
			);
			(document.body || document.documentElement).appendChild(ov);
			const removeOv = () => { try { if (ov.parentNode) ov.remove(); } catch(e) {} };
			ov.addEventListener("animationend", removeOv);
			setTimeout(removeOv, 2300);
			return ov;
		}

		// ── the identity layer (CSS) ──────────────────────────────────────
		function injectCyberpunkStyles() {
			if (document.querySelector("style[data-cyberpunk-theme]")) return;
			const tokenLines = Object.entries(TOKENS)
				.map(([name, value]) => "  " + name + ": " + value + " !important;")
				.join("\n");
			const style = document.createElement("style");
			style.dataset.cyberpunkTheme = "dsh-theme-cyberpunk2077";
			style.textContent = [
				// MiSans (Xiaomi) carries the whole UI — CJK-sharded woff2 from jsDelivr;
				// code keeps a local mono stack so no Google Fonts dependency remains.
				"@import url('https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Regular.min.css');",
				"@import url('https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Medium.min.css');",
				"@import url('https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Semibold.min.css');",
				"@import url('https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Bold.min.css');",
				"html { color-scheme: dark !important; }",
				"body {",
				"  background-color: #05070d !important;",
				"  color: #e8f1ff;",
				"  --dsw-font-family: 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif;",
				"  --ds-font-family-code: 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei';",
				tokenLines,
				"}",

				// ── CRT: scanlines + city grid + neon haze (toggle: scan) ─────
				"#root::after {",
				"  content: \"\";",
				"  position: fixed; inset: 0; z-index: 9999; pointer-events: none;",
				"  background:",
				"    repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0 1px, transparent 1px 3px),",
				"    repeating-linear-gradient(90deg, rgba(0,240,255,0.022) 0 1px, transparent 1px 84px),",
				"    repeating-linear-gradient(0deg, rgba(0,240,255,0.018) 0 1px, transparent 1px 84px),",
				"    radial-gradient(1100px 520px at 92% -6%, rgba(255,0,127,0.075), transparent 62%),",
				"    radial-gradient(950px 480px at -6% 106%, rgba(0,240,255,0.065), transparent 62%);",
				"}",
				"body.cp-off-scan #root::after { display: none; }",

				// ── hazard stripe across the top ──────────────────────────────
				"[class*='frame']::before {",
				"  content: \"\";",
				"  position: absolute; top: 0; left: 0; right: 0; height: 3px;",
				"  z-index: 60; pointer-events: none; opacity: 0.55;",
				"  background: repeating-linear-gradient(-45deg, rgba(252,227,0,0.85) 0 7px, transparent 7px 14px);",
				"}",

				// ── chamfered chrome: every button gets the NC 45° cut ────────
				"button {",
				"  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);",
				"  font-family: 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif;",
				"  font-weight: 600; letter-spacing: 0.06em;",
				"  transition: filter 0.15s var(--ds-ease-in-out), color 0.15s var(--ds-ease-in-out), background-color 0.15s var(--ds-ease-in-out);",
				"}",
				"button:hover { color: #fce300; filter: drop-shadow(0 0 6px rgba(252,227,0,0.45)); }",
				"button:active { transform: translateY(1px); }",
				"button:disabled { filter: none; }",

				// primary actions: solid NC yellow, black text, neon pulse
				"button[class*='primary'], button[class*='newSession'], button[class*='add'] {",
				"  background: #fce300 !important; color: #0a0a05 !important; border-color: transparent !important;",
				"}",
				"button[class*='primary']:hover, button[class*='newSession']:hover, button[class*='add']:hover {",
				"  background: #fcee0a !important; color: #0a0a05 !important;",
				"  filter: drop-shadow(0 0 10px rgba(252,227,0,0.6));",
				"}",
				"@keyframes cpPulse {",
				"  0%, 100% { filter: drop-shadow(0 0 3px rgba(252,227,0,0.25)); }",
				"  50% { filter: drop-shadow(0 0 12px rgba(252,227,0,0.55)); }",
				"}",
				"button[class*='primary'], button[class*='newSession'] { animation: cpPulse 2.8s ease-in-out infinite; }",

				// ── composer: transparent-input + mirror architecture ────────
				"body textarea {",
				"  background: transparent !important;",
				"  caret-color: #fce300 !important;",
				"}",
				"[class*='_card']:has(textarea:focus) {",
				"  box-shadow: 0 0 0 1px rgba(252, 227, 0, 0.35), 0 0 18px rgba(252, 227, 0, 0.12) !important;",
				"}",
				"[class*='_backdrop'] { color: #e8f1ff !important; }",

				// send button: EXECUTE hint on hover
				"[class*='_row'] button[class*='_primary'] { position: relative; }",
				"[class*='_row'] button[class*='_primary']::after {",
				"  content: 'EXECUTE ⏎';",
				"  position: absolute; right: 0; bottom: calc(100% + 8px);",
				"  padding: 2px 8px; white-space: nowrap;",
				"  font: 600 10px 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei'; letter-spacing: 0.18em;",
				"  color: #fce300; background: rgba(6,10,18,0.92); border: 1px solid rgba(252,227,0,0.35);",
				"  clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px);",
				"  opacity: 0; transform: translateY(3px); transition: opacity .12s, transform .12s; pointer-events: none; z-index: 30;",
				"}",
				"[class*='_row'] button[class*='_primary']:hover::after { opacity: 1; transform: translateY(0); }",
				// RGB-split glitch, only on the EXECUTE button hover
				"[class*='_row'] button[class*='_primary']:hover {",
				"  text-shadow: -2px 0 rgba(255,0,60,0.9), 2px 0 rgba(0,240,255,0.9);",
				"}",

				// ── agent working: segmented HUD spinner + PROCESSING ────────
				"[class*='_pending'] {",
				"  width: 14px !important; height: 14px !important; border-radius: 50% !important;",
				"  background: conic-gradient(#00f0ff 0 25%, transparent 25% 50%, #fce300 50% 62%, transparent 62% 87%, #00f0ff 87% 100%) !important;",
				"  animation: cpSpin 1.1s steps(8) infinite !important;",
				"  filter: drop-shadow(0 0 5px rgba(0,240,255,0.6));",
				"}",
				"@keyframes cpSpin { to { transform: rotate(360deg); } }",
				"[class*='_accessory']:has([class*='_pending'])::after {",
				"  content: 'PROCESSING_';",
				"  font: 600 10px 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei'; letter-spacing: 0.22em;",
				"  color: #00f0ff; text-shadow: 0 0 8px rgba(0,240,255,0.5);",
				"  animation: cpBlink 1.2s steps(2) infinite;",
				"}",
				"@keyframes cpBlink { 50% { opacity: 0.45; } }",

				// ── combat state: stamina bar while the agent works ───────────
				"body.cp-working [class*='_accessory']:has([class*='_pending'])::before {",
				"  content: \"\"; display: block; margin: 3px 0 2px; width: 108px; height: 2px;",
				"  background-image: linear-gradient(90deg, transparent, #00f0ff 30%, #fce300 50%, #00f0ff 70%, transparent);",
				"  background-size: 200% 100%;",
				"  animation: cpStamina 1.6s linear infinite;",
				"}",
				"@keyframes cpStamina { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }",

				// ── sessions as shards: rarity cycling + legendary active ────
				"[class*='_sessionRow'] {",
				"  position: relative; border-radius: 2px !important;",
				"  border-left: 2px solid rgba(159,178,214,0.25);",
				"  transition: border-color .15s, filter .15s;",
				"}",
				"[class*='_sessionRow']:nth-child(5n+2) { border-left-color: rgba(61,255,190,0.4); }",
				"[class*='_sessionRow']:nth-child(5n+3) { border-left-color: rgba(0,240,255,0.4); }",
				"[class*='_sessionRow']:nth-child(5n+4) { border-left-color: rgba(190,80,255,0.4); }",
				"[class*='_sessionRow']:nth-child(5n+5) { border-left-color: rgba(255,140,0,0.45); }",
				"[class*='_sessionRow']:hover { filter: drop-shadow(0 0 4px rgba(0,240,255,0.25)); }",
				"[class*='_sessionRow'][class*='_selected'] {",
				"  border-left: 2px solid #ffb300 !important;",
				"  background: linear-gradient(90deg, rgba(252,227,0,0.10), rgba(252,227,0,0.02)) !important;",
				"  box-shadow: inset 0 0 12px rgba(252,227,0,0.06), 0 0 10px rgba(252,227,0,0.18);",
				"  filter: drop-shadow(0 0 6px rgba(255,179,0,0.35));",
				"}",

				// ── Kiroshi optics: hover = target lock (sweep + brackets) ───
				"[class*='_sessionRow']::before {",
				"  content: \"\"; position: absolute; left: 0; right: 0; top: 0; height: 1px; z-index: 6;",
				"  pointer-events: none; opacity: 0;",
				"  background: linear-gradient(90deg, transparent, rgba(0,240,255,0.85), transparent);",
				"}",
				"[class*='_sessionRow']:hover::before { animation: cpKiroshi 1.5s linear infinite; }",
				"@keyframes cpKiroshi { 0% { top: 0; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } }",
				"[class*='_sessionRow']:not([class*='_selected']):hover {",
				"  background-image:",
				"    linear-gradient(rgba(0,240,255,0.75), rgba(0,240,255,0.75)), linear-gradient(rgba(0,240,255,0.75), rgba(0,240,255,0.75)),",
				"    linear-gradient(rgba(0,240,255,0.75), rgba(0,240,255,0.75)), linear-gradient(rgba(0,240,255,0.75), rgba(0,240,255,0.75)),",
				"    linear-gradient(rgba(0,240,255,0.75), rgba(0,240,255,0.75)), linear-gradient(rgba(0,240,255,0.75), rgba(0,240,255,0.75)),",
				"    linear-gradient(rgba(0,240,255,0.75), rgba(0,240,255,0.75)), linear-gradient(rgba(0,240,255,0.75), rgba(0,240,255,0.75)) !important;",
				"  background-repeat: no-repeat;",
				"  background-size: 12px 2px, 2px 12px, 12px 2px, 2px 12px, 12px 2px, 2px 12px, 12px 2px, 2px 12px;",
				"  background-position: 0 0, 0 0, 100% 0, 100% 0, 0 100%, 0 100%, 100% 100%, 100% 100%;",
				"}",

				// ── goal bar → mission tracker ────────────────────────────────
				"[class*='_dock'] {",
				"  border-left: 2px solid rgba(252,227,0,0.5) !important;",
				"  background: linear-gradient(90deg, rgba(252,227,0,0.05), transparent 65%) !important;",
				"}",
				"[class*='_dock'] [class*='_label'] {",
				"  font-family: 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif !important;",
				"  letter-spacing: 0.14em; color: #fce300 !important;",
				"}",
				"[class*='_dock'] [class*='_label']::before { content: '◈ '; color: #ffb300; }",

				// ── stats strip → HUD readout ────────────────────────────────
				"[class*='_strip'] {",
				"  font-family: 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei' !important;",
				"  letter-spacing: 0.08em; color: #8fa3c8 !important;",
				"}",
				"[class*='_strip']::before { content: '⟨ '; color: rgba(252,227,0,0.5); }",
				"[class*='_strip']::after { content: ' ⟩'; color: rgba(252,227,0,0.5); }",

				// ── notices / toasts → CP notification chrome ────────────────
				"[class*='_notice'], [class*='_toast'] {",
				"  position: relative;",
				"  border: 1px solid rgba(252,227,0,0.35) !important; border-left: 3px solid #fce300 !important;",
				"  background: linear-gradient(90deg, rgba(252,227,0,0.08), rgba(13,19,34,0.95)) !important;",
				"  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);",
				"  animation: cpToastIn .28s cubic-bezier(0.2, 0.9, 0.3, 1.2);",
				"}",
				"@keyframes cpToastIn {",
				"  0% { opacity: 0; transform: translateX(-14px); filter: drop-shadow(0 0 0 rgba(252,227,0,0)); }",
				"  35% { opacity: 1; filter: drop-shadow(0 0 10px rgba(252,227,0,0.5)); }",
				"  100% { opacity: 1; transform: translateX(0); }",
				"}",
				"[class*='_noticeError'] {",
				"  border-color: rgba(255,0,60,0.5) !important; border-left: 3px solid #ff003c !important;",
				"  background: linear-gradient(90deg, rgba(255,0,60,0.10), rgba(13,19,34,0.95)) !important;",
				"}",
				// hazard tape across the top of every error notice
				"[class*='_noticeError']::after {",
				"  content: \"\"; position: absolute; top: 0; left: 0; right: 0; height: 3px; pointer-events: none;",
				"  background: repeating-linear-gradient(-45deg, rgba(255,0,60,0.85) 0 6px, transparent 6px 12px);",
				"}",
				"[class*='_turnErrorTitle'] { color: #ff3b69 !important; font-family: 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif !important; letter-spacing: 0.08em; }",

				// ── empty-state flavor line ──────────────────────────────────
				"[class*='_composerHero']::after {",
				"  content: '— NIGHT CITY LOCAL // 2077 —';",
				"  display: block; margin-top: 10px;",
				"  font: 400 11px 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei'; letter-spacing: 0.3em;",
				"  color: rgba(0,240,255,0.55);",
				"}",

				// ── glitching logo ────────────────────────────────────────────
				"@keyframes cpLogoGlitch {",
				"  0%, 86%, 100% { text-shadow: none; transform: none; }",
				"  88% { text-shadow: -2px 0 #ff003c, 2px 0 #00f0ff; transform: translateX(1px); }",
				"  90% { text-shadow: 2px 0 #ff003c, -2px 0 #00f0ff; transform: translateX(-1px); }",
				"  92% { text-shadow: none; transform: none; }",
				"  94% { text-shadow: -1px 0 #ff003c, 1px 0 #00f0ff; }",
				"  96% { text-shadow: none; }",
				"}",
				"[class*='logoRow'] {",
				"  font-family: 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif;",
				"  color: #fce300 !important;",
				"  letter-spacing: 0.04em;",
				"  text-shadow: 0 0 14px rgba(252, 227, 0, 0.35);",
				"  animation: cpLogoGlitch 5.5s infinite steps(1);",
				"}",
				"[class*='logoRow'] svg, [class*='logoRow'] path { color: #fce300; }",

				// headings
				"h1, h2, h3, h4 {",
				"  font-family: 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif;",
				"  letter-spacing: 0.03em;",
				"}",
				"h1, h2 { text-shadow: 0 0 12px rgba(0, 240, 255, 0.3), 0 0 30px rgba(252, 227, 0, 0.15); }",

				// sidebar chrome
				"[class*='sidebarCol'] { box-shadow: inset -1px 0 0 rgba(0, 240, 255, 0.10); }",
				"[class*='sidebarCol'] [class*='footArea'] { border-top: 1px solid rgba(252, 227, 0, 0.25); }",
				"[class*='sidebarCol'] [class*='railFish'], [class*='sidebarCol'] svg { color: #fce300; }",

				// details panel — HUD corner brackets
				"[class*='detailsCol'] { position: relative; }",
				"[class*='detailsCol']::after {",
				"  content: \"\"; position: absolute; top: 10px; right: 10px;",
				"  width: 16px; height: 16px; pointer-events: none;",
				"  border-top: 2px solid rgba(252, 227, 0, 0.6);",
				"  border-right: 2px solid rgba(252, 227, 0, 0.6);",
				"}",
				"[class*='detailsCol']::before {",
				"  content: \"\"; position: absolute; bottom: 10px; left: 10px;",
				"  width: 16px; height: 16px; pointer-events: none;",
				"  border-bottom: 2px solid rgba(0, 240, 255, 0.45);",
				"  border-left: 2px solid rgba(0, 240, 255, 0.45);",
				"}",

				// markdown
				"pre {",
				"  clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px);",
				"  border-left: 2px solid rgba(0, 240, 255, 0.5);",
				"  background: #060a12 !important;",
				"  font-family: 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei' !important;",
				"}",
				"code { font-family: 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei'; color: #fcee0a; }",
				":not(pre) > code { background: rgba(252, 227, 0, 0.08); padding: 1px 5px; }",
				"blockquote { border-left: 2px solid rgba(252, 227, 0, 0.45); }",

				// selection / focus / forms
				"::selection { background: rgba(252, 227, 0, 0.30); color: #ffffff; }",
				":focus-visible { outline: 1px solid #00f0ff; outline-offset: 1px; box-shadow: 0 0 0 3px rgba(0, 240, 255, 0.22); }",
				"input[type='checkbox'], input[type='radio'] { accent-color: #fce300; }",
				"a { color: #00f0ff; }",
				"a:hover { color: #fce300; }",

				// dialogs — hazard edge for confirmations
				"[role='dialog'], [role='alertdialog'] {",
				"  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);",
				"  border: 1px solid rgba(252, 227, 0, 0.22);",
				"}",

				// scrollbars
				"*::-webkit-scrollbar { width: 8px; height: 8px; }",
				"*::-webkit-scrollbar-track { background: transparent; }",
				"*::-webkit-scrollbar-thumb { background: rgba(252, 227, 0, 0.28) !important; border-radius: 0; }",
				"*::-webkit-scrollbar-thumb:hover { background: rgba(252, 227, 0, 0.5) !important; }",

				// ── slang status chips: GIG UP / PREEM. / FLATLINE / tips ─────
				"#cp2077-chip { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 10052;",
				"  max-width: min(64vw, 560px); padding: 4px 12px; pointer-events: none; text-align: center;",
				"  font: 600 11px 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei'; letter-spacing: 0.16em;",
				"  background: rgba(6,10,18,0.92);",
				"  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);",
				"  animation: cpChipIn .22s cubic-bezier(0.2, 0.9, 0.3, 1.2); }",
				"#cp2077-chip.info { color: #00f0ff; box-shadow: inset 0 0 0 1px rgba(0,240,255,0.45), 0 0 12px rgba(0,240,255,0.18); }",
				"#cp2077-chip.ok { color: #00f5a0; box-shadow: inset 0 0 0 1px rgba(0,245,160,0.45), 0 0 12px rgba(0,245,160,0.18); }",
				"#cp2077-chip.err { color: #ff3b69; box-shadow: inset 0 0 0 1px rgba(255,0,60,0.5), 0 0 12px rgba(255,0,60,0.2); }",
				"@keyframes cpChipIn { 0% { opacity: 0; transform: translate(-50%, -6px); } 100% { opacity: 1; transform: translate(-50%, 0); } }",

				// ── Night City HUD footer (docked into the settings bar) ──────
				"#cp2077-hud { position: fixed; z-index: 10048; pointer-events: none; user-select: none;",
				"  display: flex; align-items: center; gap: 10px; white-space: nowrap;",
				"  transform: translateX(-100%);",
				"  font: 600 10px 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei'; }",
				"#cp2077-hud #cp2077-clock { color: rgba(0,240,255,0.6); letter-spacing: 0.2em; text-shadow: 0 0 8px rgba(0,240,255,0.35); }",
				"#cp2077-hud #cp2077-hex { color: rgba(0,240,255,0.3); letter-spacing: 0.18em; }",
				"body.cp-off-scan #cp2077-hud #cp2077-hex { display: none; }",

				// ── easter egg: JOHNNY SILVERHAND seizes the screen ──────────
				"#cp2077-johnny { position: fixed; inset: 0; z-index: 2147483644; pointer-events: none;",
				"  animation: cpJohnnyOut 2.6s forwards; }",
				"#cp2077-johnny .cp2077-johnny-tint { position: absolute; inset: 0; backdrop-filter: saturate(0.35) contrast(1.18);",
				"  background: linear-gradient(90deg, rgba(255,0,60,0.16), transparent 30%, transparent 70%, rgba(0,240,255,0.16)); }",
				"#cp2077-johnny .cp2077-johnny-tear { position: absolute; inset: -10%; mix-blend-mode: screen;",
				"  background: repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 18px, rgba(255,0,60,0.06) 18px 20px, transparent 20px 44px);",
				"  animation: cpJohnnyTear 0.4s steps(4) infinite; }",
				"@keyframes cpJohnnyTear { 0% { transform: translateX(-8px); } 50% { transform: translateX(8px); } 100% { transform: translateX(-8px); } }",
				"#cp2077-johnny .cp2077-johnny-box { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; text-align: center; }",
				"#cp2077-johnny .cp2077-johnny-quote { font: 700 clamp(26px, 4.4vw, 54px) 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif;",
				"  letter-spacing: 0.12em; color: #e8f1ff; text-shadow: -3px 0 rgba(255,0,60,0.8), 3px 0 rgba(0,240,255,0.8);",
				"  animation: cpJohnnyQuote 2.6s steps(1) forwards; }",
				"#cp2077-johnny .cp2077-johnny-cn { font: 400 clamp(11px, 1.4vw, 15px) 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif;",
				"  letter-spacing: 0.3em; color: rgba(159,178,214,0.85); }",
				"#cp2077-johnny .cp2077-johnny-attr { font: 600 10px 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei';",
				"  letter-spacing: 0.26em; color: rgba(255,59,105,0.8); margin-top: 6px; }",
				"@keyframes cpJohnnyQuote {",
				"  0% { opacity: 0; } 6% { opacity: 1; transform: translateX(-5px) skewX(-2deg); }",
				"  10% { transform: translateX(5px) skewX(2deg); } 14% { transform: none; }",
				"  40% { transform: none; } 46% { transform: translateX(3px); } 50% { transform: none; }",
				"  84% { opacity: 1; } 100% { opacity: 0; } }",
				"@keyframes cpJohnnyOut { 0% { opacity: 0; } 6% { opacity: 1; } 86% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }",

				// ── DECK panel + SND chip chrome ─────────────────────────────
				"#cp2077-snd-toggle, #cp2077-deck-toggle { position: fixed; right: 14px; z-index: 10050; padding: 4px 10px;",
				"  font: 600 11px 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei'; letter-spacing: 0.14em; color: #fce300;",
				"  background: rgba(6, 10, 18, 0.85); border: 1px solid rgba(252, 227, 0, 0.35); cursor: pointer; opacity: 0.55;",
				"  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); }",
				"#cp2077-snd-toggle:hover, #cp2077-deck-toggle:hover { opacity: 1; filter: drop-shadow(0 0 6px rgba(252, 227, 0, 0.45)); }",
				"#cp2077-snd-toggle { bottom: 14px; }",
				"#cp2077-deck-toggle { bottom: 44px; color: #00f0ff; border-color: rgba(0, 240, 255, 0.35); }",
				"#cp2077-deck-toggle.cp2077-open { opacity: 1; }",
				"#cp2077-deck { position: fixed; right: 14px; bottom: 76px; z-index: 10049; width: 176px; padding: 10px;",
				"  background: rgba(6, 10, 18, 0.94); border: 1px solid rgba(0, 240, 255, 0.3);",
				"  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);",
				"  display: none; flex-direction: column; gap: 4px;",
				"  box-shadow: 0 0 18px rgba(0, 240, 255, 0.12); }",
				"#cp2077-deck.cp2077-open { display: flex; }",
				"#cp2077-deck .cp2077-deck-title { font: 700 11px 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.3em;",
				"  color: #00f0ff; margin-bottom: 6px; padding-bottom: 5px;",
				"  background: repeating-linear-gradient(-45deg, rgba(0,240,255,0.4) 0 5px, transparent 5px 10px) bottom / 100% 3px no-repeat; }",
				"#cp2077-deck button { width: 100%; text-align: left; padding: 5px 8px; font: 600 11px 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif;",
				"  letter-spacing: 0.1em; color: #9fb2d6; background: transparent; border: none; cursor: pointer;",
				"  clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px); }",
				"#cp2077-deck button:hover { color: #e8f1ff; background: rgba(0, 240, 255, 0.08); filter: none; }",
				"#cp2077-deck button.cp2077-on { color: #fce300; }",

				// ── relic interference flicker (ambient, toggle: relic) ──────
				"#cp2077-relic { position: fixed; inset: 0; z-index: 2147483640; pointer-events: none;",
				"  background: linear-gradient(0deg, rgba(255,0,60,0.05), transparent 30%, transparent 70%, rgba(0,240,255,0.05)),",
				"    repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 9px);",
				"  mix-blend-mode: screen; animation: cpRelic .22s steps(3); }",
				"@keyframes cpRelic {",
				"  0% { transform: translateX(-3px) skewX(-0.4deg); filter: hue-rotate(25deg); }",
				"  50% { transform: translateX(3px) skewX(0.4deg); filter: hue-rotate(-30deg) saturate(1.6); }",
				"  100% { transform: none; filter: none; } }",
				"body.cp-off-relic #cp2077-relic { display: none; }",
				"@media (prefers-reduced-motion: reduce) { #cp2077-relic { display: none; } }",

				// ── easter egg: WAKE UP SAMURAI ─────────────────────────────
				"#cp2077-wake { position: fixed; inset: 0; z-index: 2147483645; background: #05070d;",
				"  pointer-events: none; display: grid; place-content: center; gap: 8px;",
				"  animation: cpWakeIn 2s forwards; }",
				"#cp2077-wake .cp2077-wake-line1 { font: 700 clamp(30px, 5vw, 64px) 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif;",
				"  letter-spacing: 0.14em; color: #fce300; text-shadow: -3px 0 #ff003c, 3px 0 #00f0ff; }",
				"#cp2077-wake .cp2077-wake-line2 { font: 400 clamp(12px, 1.6vw, 18px) 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei';",
				"  letter-spacing: 0.3em; color: #00f0ff; }",
				"@keyframes cpWakeIn {",
				"  0% { opacity: 0; transform: scaleY(0.02); }",
				"  8% { opacity: 1; transform: scaleY(1); }",
				"  12% { transform: translateX(-6px) skewX(-2deg); }",
				"  14% { transform: translateX(6px) skewX(2deg); }",
				"  16% { transform: none; }",
				"  30% { opacity: 1; } 88% { opacity: 1; }",
				"  100% { opacity: 0; visibility: hidden; } }",

				// ── boot transition ──────────────────────────────────────────
				"#cp2077-boot { position: fixed; inset: 0; z-index: 2147483646; background: #05070d;",
				"  pointer-events: none; animation: cpBootFade 2s forwards; }",
				"#cp2077-boot .cp-line { position: absolute; top: 50%; left: 0; right: 0; height: 2px; transform: translateY(-50%);",
				"  background: linear-gradient(90deg, transparent, #00f0ff 18%, #fff 50%, #00f0ff 82%, transparent);",
				"  box-shadow: 0 0 26px 3px rgba(0, 240, 255, 0.75); animation: cpBootLine 0.7s cubic-bezier(0.2, 0.75, 0.3, 1) forwards; }",
				"#cp2077-boot .cp-crt { position: absolute; inset: 0;",
				"  background: radial-gradient(58% 78% at 50% 50%, rgba(0, 240, 255, 0.14), transparent 72%);",
				"  clip-path: inset(49.9% 0 49.9% 0); animation: cpBootCrt 0.8s cubic-bezier(0.2, 0.8, 0.25, 1) forwards; }",
				"#cp2077-boot .cp-bars { position: absolute; inset: -15%; mix-blend-mode: screen; animation: cpBootBars 1s steps(7) forwards;",
				"  background: repeating-linear-gradient(0deg, rgba(0, 240, 255, 0.10) 0 2px, transparent 2px 26px, rgba(255, 0, 60, 0.09) 26px 27px, transparent 27px 53px); }",
				"#cp2077-boot .cp-title { position: absolute; left: 50%; top: 44%; transform: translate(-50%, -50%); white-space: nowrap;",
				"  font: 700 clamp(34px, 6vw, 72px) 'MiSans', 'PingFang SC', 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.16em; color: #fce300;",
				"  animation: cpBootTitle 1.5s steps(1) forwards; }",
				"#cp2077-boot .cp-sub { position: absolute; left: 50%; top: 56%; transform: translate(-50%, -50%);",
				"  font: 400 clamp(10px, 1.3vw, 14px) 'SF Mono', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei'; letter-spacing: 0.34em; color: #00f0ff;",
				"  opacity: 0; animation: cpBootSub 1.5s ease-out forwards; }",
				"#cp2077-boot .cp-flash { position: absolute; inset: 0; background: #fff; opacity: 0; mix-blend-mode: screen; animation: cpBootFlash 2s forwards; }",
				"@keyframes cpBootFade { 0% { opacity: 0; } 3% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }",
				"@keyframes cpBootLine { 0% { transform: translateY(-50%) scaleX(0.02); opacity: 1; } 45% { transform: translateY(-50%) scaleX(1); opacity: 1; } 100% { transform: translateY(-50%) scaleX(1); opacity: 0; } }",
				"@keyframes cpBootCrt { 0% { clip-path: inset(49.9% 0 49.9% 0); opacity: 1; } 70% { opacity: 0.8; } 100% { clip-path: inset(0 0 0 0); opacity: 0; } }",
				"@keyframes cpBootBars { 0% { transform: translateY(-5%); opacity: 1; } 70% { opacity: 0.7; } 100% { transform: translateY(5%); opacity: 0; } }",
				"@keyframes cpBootTitle { 0% { opacity: 0; } 10% { opacity: 1; transform: translate(-50%, -50%) skewX(0); }",
				"  14% { opacity: 1; transform: translate(-49%, -50%) skewX(-6deg); text-shadow: -3px 0 #ff003c, 3px 0 #00f0ff; }",
				"  18% { transform: translate(-51%, -50%) skewX(4deg); text-shadow: 3px 0 #ff003c, -3px 0 #00f0ff; }",
				"  22% { transform: translate(-50%, -50%) skewX(0); text-shadow: 0 0 18px rgba(252, 227, 0, 0.45); }",
				"  55% { opacity: 1; } 88% { opacity: 1; } 100% { opacity: 0; letter-spacing: 0.34em; } }",
				"@keyframes cpBootSub { 0% { opacity: 0; letter-spacing: 0.1em; } 25% { opacity: 1; } 90% { opacity: 1; } 100% { opacity: 0; letter-spacing: 0.4em; } }",
				"@keyframes cpBootFlash { 0%, 68% { opacity: 0; } 73% { opacity: 0.85; } 77% { opacity: 0.1; } 80% { opacity: 0.5; } 84%, 100% { opacity: 0; } }",
				"@media (prefers-reduced-motion: reduce) { #cp2077-boot { display: none; } }",

				// ── perf guards: small screens go lean, reduced motion goes still ──
				"@media (max-width: 768px) {",
				"  #root::after, #cp2077-hud, #cp2077-chip { display: none; }",
				"  button[class*='primary'], button[class*='newSession'] { animation: none; }",
				"  [class*='_sessionRow']:hover::before { animation: none; }",
				"}",
				"@media (prefers-reduced-motion: reduce) {",
				"  button[class*='primary'], button[class*='newSession'], [class*='logoRow'] { animation: none !important; }",
				"  [class*='_sessionRow']:hover::before { animation: none !important; }",
				"  body.cp-working [class*='_accessory']:has([class*='_pending'])::before { animation: none !important; }",
				"  [class*='_accessory']:has([class*='_pending'])::after { animation: none !important; }",
				"  #cp2077-hud #cp2077-hex, #cp2077-chip { display: none !important; }",
				"}"
			].join("\n");
			(document.head || document.documentElement).appendChild(style);
		}

		// Browser plugin: register/focus the theme, force dark chroma, wire
		// every subsystem (SFX, watchers, deck, relic, tab identity, boot).


    const CyberThemeManager = (function() {
      let active = false;
      let cleanupFns = [];
      let observer = null;

      function start(ctxTheme) {
        if (active) return;
        active = true;
        document.documentElement.style.colorScheme = "dark";
        document.body.toggleAttribute("data-ds-dark-theme", true);
        loadCfg();
        applyCfgToBody();
        injectCyberpunkStyles();
        playBootTransition();
        ensureSndChip();
        ensureDeckPanel();
        document.addEventListener("keydown", onKeydown, true);
        const stopPending = startPendingPoll();
        const stopNotices = startNoticeObserver();
        const stopRelic = startRelicLoop();
        const stopWake = startTriggerWatcher();
        const stopTitle = applyTabIdentity();
        const stopClock = startHudFooter();

        observer = new MutationObserver(() => {
          document.documentElement.style.colorScheme = "dark";
          if (!document.body.hasAttribute("data-ds-dark-theme")) {
            document.body.setAttribute("data-ds-dark-theme", "true");
          }
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });

        if (ctxTheme && typeof ctxTheme.register === "function") {
          try {
            ctxTheme.register({
              id: THEME_ID,
              colorScheme: "dark",
              tokens: TOKENS
            });
            ctxTheme.setTheme(THEME_ID);
          } catch (e) {
            console.error("starlight-protocol theme register failed", e);
          }
        }

        cleanupFns = [
          () => { if (observer) observer.disconnect(); },
          () => document.removeEventListener("keydown", onKeydown, true),
          stopPending,
          stopNotices,
          stopRelic,
          stopWake,
          stopTitle,
          stopClock
        ];
      }

      function stop() {
        if (!active) return;
        active = false;
        for (const fn of cleanupFns) {
          try { if (typeof fn === "function") fn(); } catch (e) {}
        }
        cleanupFns = [];
        const st = document.getElementById("cp2077-styles");
        if (st && st.parentNode) st.parentNode.removeChild(st);
        const chip = document.getElementById("cp2077-snd-chip");
        if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
        const deck = document.getElementById("cp2077-deck");
        if (deck && deck.parentNode) deck.parentNode.removeChild(deck);
        const hud = document.getElementById("cp2077-hud");
        if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
        document.body.classList.remove("cp-night-city");
      }

      return {
        start,
        stop,
        isRunning: () => active
      };
    })();

    /* ══════════════════════════════════════════════════════════════════════════
     * 3. 开机认证界面自举 (STARTUP SEQUENCE SELF-BOOT)
     * ══════════════════════════════════════════════════════════════════════════ */
    var BOOT_ROUTE = '/dsh-starlight';

    function readFlag(store, key) {
      try {
        var s = window[store];
        return s ? s.getItem(key) : null;
      } catch (e) { return null; }
    }

    function writeFlag(store, key, value) {
      try {
        var s = window[store];
        if (s) s.setItem(key, value);
      } catch (e) {}
    }

    function loadScript(src, fail) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      if (typeof fail === 'function') {
        s.addEventListener('load', function () { fail(null); });
        s.addEventListener('error', function () { fail(new Error('script load failed: ' + src)); });
      }
      (document.head || document.documentElement).appendChild(s);
    }

    function loadCss(href, fail) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      if (typeof fail === 'function') {
        link.addEventListener('load', function () { fail(null); });
        link.addEventListener('error', function () { fail(new Error('css load failed: ' + href)); });
      }
      (document.head || document.documentElement).appendChild(link);
    }

    function release(ok) {
      if (ok) return;
      try {
        var r = document.getElementById('dsh-startup-root');
        if (r && r.parentNode) r.parentNode.removeChild(r);
        if (document.documentElement.classList) document.documentElement.classList.remove('dsu-lock');
        if (document.body && document.body.style) document.body.style.overflow = '';
        window.__DSH_STARTUP_FAILED__ = true;
      } catch (e) {}
    }

    function injectRoot(cfg) {
      var root = document.getElementById('dsh-startup-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'dsh-startup-root';
        document.body.appendChild(root);
      }
      root.className = 'dsu-root dsu-boot';
      if (document.documentElement.classList) document.documentElement.classList.add('dsu-lock');
      if (document.body && document.body.style) document.body.style.overflow = 'hidden';

      var failed = false;
      var cssReady = false;
      var scriptReady = false;
      function guard(err) {
        if (err) {
          failed = true;
          release(false);
          return;
        }
        if (cssReady && scriptReady) release(true);
      }

      loadCss(BOOT_ROUTE + '/splash.css', function (err) {
        if (err) { guard(err); return; }
        cssReady = true;
        guard(null);
      });

      window.__DSH_STARLIGHT__ = cfg || {};
      window.__DSH_STARTUP__ = cfg || {};
      try {
        delete window.__DSH_STARTUP_LOADED__;
      } catch (e) { window.__DSH_STARTUP_LOADED__ = undefined; }

      loadScript(BOOT_ROUTE + '/splash.js?t=' + Date.now(), function (err) {
        if (err) { guard(err); return; }
        scriptReady = true;
        guard(null);
      });

      setTimeout(function () {
        try {
          var r = document.getElementById('dsh-startup-root');
          if (r && r.className && r.className.indexOf('dsu-boot') !== -1) release(false);
        } catch (e) {}
      }, 9000);
    }

    function selfBoot() {
      try {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        if (!document.body) return;
        if (window.__DSH_STARTUP_BOOT__) return;
        if (window.__DSH_STARTUP__) return;
        if (document.getElementById('dsh-startup-root')) return;
        if (window.__DSH_STARTUP_FAILED__ === true) return;
        window.__DSH_STARTUP_BOOT__ = 'client';

        fetch(API, { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (j) { return j && j.ok === true ? j.config : null; })
          .catch(function () {
            return fetch(LEGACY_API, { headers: { Accept: 'application/json' } })
              .then(function (r2) { return r2.json(); })
              .then(function (j2) { return j2 && j2.ok === true ? j2.config : null; })
              .catch(function () { return null; });
          })
          .then(function (cfg) {
            cfg = cfg || { enabled: true, mode: 'session', speed: 1 };
            if (cfg.enabled === false) return;
            var today = new Date().toISOString().slice(0, 10);
            if (cfg.mode === 'session' && readFlag('sessionStorage', 'dsh-startup-screen:shown') === '1') return;
            if (cfg.mode === 'daily' && readFlag('localStorage', 'dsh-startup-screen:day') === today) return;
            if (cfg.mode === 'session') writeFlag('sessionStorage', 'dsh-startup-screen:shown', '1');
            if (cfg.mode === 'daily') writeFlag('localStorage', 'dsh-startup-screen:day', today);
            return injectRoot(cfg);
          })
          .catch(function () {});
      } catch (e) {}
    }

    /* ══════════════════════════════════════════════════════════════════════════
     * 4. 星轨协议统一设置面板 (STARLIGHT PROTOCOL UNIFIED SETTINGS SECTION)
     * ══════════════════════════════════════════════════════════════════════════ */
    var PANEL_CSS = [
      '.__sp_root { max-width: 660px; display: flex; flex-direction: column; gap: 14px; font-size: 13px; color: var(--dsw-alias-label-primary, #ffffff); }',
      '.__sp_banner { border: 1px solid rgba(0, 240, 255, 0.35); border-radius: 12px; padding: 14px 16px; background: linear-gradient(135deg, rgba(8, 16, 28, 0.85) 0%, rgba(20, 12, 32, 0.85) 100%); display: flex; justify-content: space-between; align-items: center; box-shadow: 0 0 15px rgba(0, 240, 255, 0.12); }',
      '.__sp_bannerTitle { font-family: ui-monospace, Consolas, monospace; font-size: 15px; font-weight: 700; color: #00f0ff; letter-spacing: 0.08em; display: flex; align-items: center; gap: 10px; }',
      '.__sp_bannerDesc { font-size: 12px; color: var(--dsw-alias-label-secondary, #9fb2d6); margin-top: 4px; line-height: 1.4; }',
      '.__sp_badge { font-family: ui-monospace, Consolas, monospace; font-size: 11px; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.08em; background: rgba(0, 240, 255, 0.15); color: #00f0ff; border: 1px solid rgba(0, 240, 255, 0.35); }',
      '.__sp_group { border: 1px solid var(--dsw-alias-border-l2, rgba(0, 240, 255, 0.2)); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 11px; background: rgba(10, 14, 22, 0.6); }',
      '.__sp_groupTitle { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dsw-alias-brand-primary, #fce300); display: flex; align-items: center; gap: 6px; }',
      '.__sp_moduleGrid { display: flex; flex-direction: column; gap: 9px; }',
      '.__sp_moduleCard { border: 1px solid var(--dsw-alias-border-l2, rgba(0, 240, 255, 0.2)); border-radius: 8px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; background: rgba(12, 18, 30, 0.65); transition: all 0.15s ease; user-select: none; }',
      '.__sp_moduleCard:hover { border-color: rgba(0, 240, 255, 0.55); background: rgba(16, 24, 40, 0.8); }',
      '.__sp_moduleCardActive { border-color: rgba(0, 240, 255, 0.7); background: rgba(14, 28, 48, 0.75); box-shadow: 0 0 10px rgba(0, 240, 255, 0.15); }',
      '.__sp_moduleInfo { display: flex; flex-direction: column; gap: 3px; }',
      '.__sp_moduleTitle { font-size: 13px; font-weight: 600; color: #ffffff; display: flex; align-items: center; gap: 8px; }',
      '.__sp_moduleDesc { font-size: 11px; line-height: 1.45; color: var(--dsw-alias-label-tertiary, #6e80a6); }',
      '.__sp_field { display: flex; flex-direction: column; gap: 5px; }',
      '.__sp_label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #ffffff); }',
      '.__sp_hint { font-size: 11px; line-height: 1.55; color: var(--dsw-alias-label-tertiary, #6e80a6); }',
      '.__sp_row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
      '.__sp_input { border: 1px solid var(--dsw-alias-border-l2, rgba(0, 240, 255, 0.2)); background: rgba(18, 26, 44, 0.8); font: inherit; color: #ffffff; border-radius: 8px; padding: 6px 10px; font-size: 13px; box-sizing: border-box; width: 100%; outline: none; }',
      '.__sp_input:focus { border-color: var(--dsw-alias-state-business-primary, #00f0ff); box-shadow: 0 0 6px rgba(0, 240, 255, 0.4); }',
      '.__sp_inputMono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; letter-spacing: 0.06em; }',
      '.__sp_select { border: 1px solid var(--dsw-alias-border-l2, rgba(0, 240, 255, 0.2)); background: rgba(18, 26, 44, 0.8); color: #ffffff; border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 13px; min-width: 180px; }',
      '.__sp_check { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }',
      '.__sp_check input { margin-top: 2px; accent-color: var(--dsw-alias-state-business-primary, #00f0ff); }',
      '.__sp_checkText { display: flex; flex-direction: column; gap: 2px; }',
      '.__sp_two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
      '.__sp_actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 4px; }',
      '.__sp_btn { border: 1px solid var(--dsw-alias-border-l2, rgba(0, 240, 255, 0.25)); background: rgba(18, 26, 44, 0.8); color: #ffffff; border-radius: 8px; padding: 6px 14px; font: inherit; font-size: 13px; cursor: pointer; transition: all 0.15s ease; }',
      '.__sp_btn:hover:not(:disabled) { border-color: var(--dsw-alias-state-business-primary, #00f0ff); filter: drop-shadow(0 0 6px rgba(0, 240, 255, 0.5)); }',
      '.__sp_btn:disabled { opacity: 0.5; cursor: default; }',
      '.__sp_btnPrimary { border-color: #00f0ff !important; background: rgba(0, 240, 255, 0.2) !important; color: #00f0ff !important; font-weight: 600; }',
      '.__sp_status { font-size: 12px; color: var(--dsw-alias-label-tertiary, #6e80a6); }',
      '.__sp_ok { font-size: 12px; color: #00f5a0; font-weight: 600; display: flex; align-items: center; gap: 4px; }',
      '.__sp_err { font-size: 12px; color: #ff003c; font-weight: 600; }',
      '.__sp_swatch { width: 38px; height: 26px; padding: 0; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 240, 255, 0.2)); border-radius: 6px; background: transparent; cursor: pointer; }',
      '.__sp_preview { margin-top: 2px; border: 1px dashed rgba(0, 240, 255, 0.3); border-radius: 10px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: rgba(6, 12, 20, 0.5); }',
      '.__sp_previewText { font-size: 12px; color: var(--dsw-alias-label-tertiary, #6e80a6); line-height: 1.5; }',
      '.__sp_switch { position: relative; width: 42px; height: 22px; background: rgba(255, 255, 255, 0.15); border-radius: 11px; transition: all 0.2s ease; flex-shrink: 0; }',
      '.__sp_switchActive { background: #00f0ff; box-shadow: 0 0 8px rgba(0, 240, 255, 0.6); }',
      '.__sp_switchThumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; background: #ffffff; border-radius: 50%; transition: all 0.2s ease; }',
      '.__sp_switchActive .__sp_switchThumb { left: 22px; background: #05070d; }'
    ].join('\n');

    if (typeof document !== 'undefined' && document.getElementById('starlight-protocol-css') === null) {
      var tag = document.createElement('style');
      tag.id = 'starlight-protocol-css';
      tag.textContent = PANEL_CSS;
      (document.head || document.documentElement).appendChild(tag);
    }

    function Field(props) {
      return h('div', { className: '__sp_field' },
        h('label', { className: '__sp_label' }, props.label),
        props.children,
        props.hint ? h('div', { className: '__sp_hint' }, props.hint) : null
      );
    }

    function TextInput(props) {
      return h('input', {
        className: '__sp_input' + (props.mono ? ' __sp_inputMono' : ''),
        type: 'text',
        value: props.value == null ? '' : String(props.value),
        placeholder: props.placeholder || '',
        maxLength: props.maxLength || 64,
        spellCheck: false,
        onChange: (e) => props.onChange(e.target.value)
      });
    }

    function Select(props) {
      return h('select', {
        className: '__sp_select',
        value: props.value,
        onChange: (e) => props.onChange(e.target.value)
      }, props.options.map((o) => h('option', { key: o[0], value: o[0] }, o[1])));
    }

    function Check(props) {
      return h('label', { className: '__sp_check' },
        h('input', {
          type: 'checkbox',
          checked: !!props.checked,
          onChange: (e) => props.onChange(e.target.checked)
        }),
        h('span', { className: '__sp_checkText' },
          h('span', null, props.label),
          props.hint ? h('span', { className: '__sp_hint' }, props.hint) : null
        )
      );
    }

    function ColorInput(props) {
      return h('input', {
        className: '__sp_swatch',
        type: 'color',
        value: props.value,
        onChange: (e) => props.onChange(e.target.value)
      });
    }

    function Range(props) {
      return h('div', { className: '__sp_row' },
        h('input', {
          type: 'range',
          min: props.min,
          max: props.max,
          step: props.step || 0.05,
          value: props.value,
          style: { flex: 1 },
          onChange: (e) => props.onChange(Number(e.target.value))
        }),
        h('span', { className: '__sp_status', style: { width: '48px', textAlign: 'right' } }, props.display || props.value)
      );
    }

    function ModuleToggleCard(props) {
      return h('div', {
        className: '__sp_moduleCard' + (props.checked ? ' __sp_moduleCardActive' : ''),
        onClick: () => props.onChange(!props.checked)
      },
        h('div', { className: '__sp_moduleInfo' },
          h('div', { className: '__sp_moduleTitle' },
            props.title,
            props.badge ? h('span', { className: '__sp_badge' }, props.badge) : null
          ),
          h('div', { className: '__sp_moduleDesc' }, props.desc)
        ),
        h('div', { className: '__sp_switch' + (props.checked ? ' __sp_switchActive' : '') },
          h('div', { className: '__sp_switchThumb' })
        )
      );
    }

    function StarlightPanel() {
      const [loading, setLoading] = react.useState(true);
      const [busy, setBusy] = react.useState(false);
      const [config, setConfig] = react.useState(null);
      const [draft, setDraft] = react.useState(null);
      const [file, setFile] = react.useState('');
      const [notice, setNotice] = react.useState('');
      const [error, setError] = react.useState('');

      const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

      const load = () => {
        setLoading(true);
        setError('');
        fetch(API, { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .catch(() => fetch(LEGACY_API, { headers: { Accept: 'application/json' } }).then((r2) => r2.json()))
          .then((j) => {
            if (!j || j.ok !== true) throw new Error((j && j.error) || '读取配置失败');
            setConfig(j.config);
            setDraft({ ...j.config });
            setFile(j.file || '');
            setLoading(false);
          })
          .catch((err) => {
            setError(err.message || '加载配置失败');
            setLoading(false);
          });
      };

      react.useEffect(() => { load(); }, []);

      const set = (k, v) => setDraft((prev) => ({ ...prev, [k]: v }));

      const syncSubsystems = (cfgToSync) => {
        // 同步深空天体背景
        if (cfgToSync.spaceEnabled !== false) {
          SpaceManager.start();
        } else {
          SpaceManager.stop();
        }
        // 同步赛博朋克主题
        if (cfgToSync.themeEnabled !== false) {
          CyberThemeManager.start(globalThemeCtx);
        } else {
          CyberThemeManager.stop();
        }
      };

      const save = () => {
        if (!draft) return;
        setBusy(true);
        setError('');
        setNotice('');
        fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ patch: draft })
        })
          .then((r) => r.json())
          .then((j) => {
            if (!j || j.ok !== true) throw new Error((j && j.error) || '保存失败');
            setConfig(j.config);
            setDraft({ ...j.config });
            syncSubsystems(j.config);
            setNotice('星轨协议配置已保存，已即时生效！');
            setTimeout(() => setNotice(''), 4500);
          })
          .catch((err) => setError(err.message || '保存失败'))
          .finally(() => setBusy(false));
      };

      const reset = () => {
        if (!window.confirm('确定将星轨协议所有设置恢复为默认配置吗？')) return;
        setBusy(true);
        fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset' })
        })
          .then((r) => r.json())
          .then((j) => {
            if (!j || j.ok !== true) throw new Error('重置失败');
            setConfig(j.config);
            setDraft({ ...j.config });
            syncSubsystems(j.config);
            setNotice('已恢复星轨协议默认配置');
            setTimeout(() => setNotice(''), 4500);
          })
          .catch((err) => setError(err.message || '重置失败'))
          .finally(() => setBusy(false));
      };

      const preview = () => {
        if (typeof window !== 'undefined' && window.__DSH_STARTUP_API__ && typeof window.__DSH_STARTUP_API__.replay === 'function') {
          window.__DSH_STARTUP_API__.replay();
        } else {
          window.location.reload();
        }
      };

      if (loading) {
        return h('div', { className: '__sp_root' }, h('span', { className: '__sp_status' }, '正在加载星轨协议配置...'));
      }
      if (!draft) {
        return h('div', { className: '__sp_root' }, h('span', { className: '__sp_err' }, error || '配置不可用'));
      }

      return h('div', { className: '__sp_root' },
        /* 顶部 Banner */
        h('div', { className: '__sp_banner' },
          h('div', null,
            h('div', { className: '__sp_bannerTitle' },
              'STARLIGHT PROTOCOL 2077',
              h('span', { className: '__sp_badge' }, 'v1.0.0 综合外观系统')
            ),
            h('div', { className: '__sp_bannerDesc' },
              '融合冷启动认证、夜之城 HUD 终端与全域通透深空天体引擎，三合一模块化自控。'
            )
          )
        ),

        /* 一、 模块矩阵总控 */
        h('div', { className: '__sp_group' },
          h('div', { className: '__sp_groupTitle' }, '一、 核心模块总控 (Sub-Modules Control)'),
          h('div', { className: '__sp_moduleGrid' },
            h(ModuleToggleCard, {
              title: '🌌 深空全景动态天体背景 (Space Horizon)',
              badge: '动态天幕',
              desc: '360° 无缝流动银河、3D 星座、穿梭流星与右下角 SPD 三档航速调控按键（慢速巡航 / 动力推进 / 8倍星际穿越折跃）。',
              checked: draft.spaceEnabled !== false,
              onChange: (v) => set('spaceEnabled', v)
            }),
            h(ModuleToggleCard, {
              title: '🌆 赛博朋克 2077 外观主题 (Cyberpunk HUD Theme)',
              badge: '夜之城终端',
              desc: '夜之城全息高对比战术配色、CRT 扫描线、机械键盘打字音效、Kiroshi 准星交互、Relic 故障彩蛋与 DECK 面板。',
              checked: draft.themeEnabled !== false,
              onChange: (v) => set('themeEnabled', v)
            }),
            h(ModuleToggleCard, {
              title: '⚡ 开机冷启动认证序列 (Startup Sequence)',
              badge: '特工鉴权',
              desc: 'DeepSeek Harness 启动时播放黑幕鉴权序列、过曝白屏转场、机密档案卡展示与神经网络女声念白。',
              checked: draft.enabled !== false,
              onChange: (v) => set('enabled', v)
            })
          )
        ),

        /* 二、 特工档案身份 */
        h('div', { className: '__sp_group' },
          h('div', { className: '__sp_groupTitle' }, '二、 启动特工身份卡资料 (Agent Identification)'),
          h(Field, { label: '身份名称 (IDENTITY)', hint: '终幕「欢迎 xxx 访问 / WELCOME, XXX」里的名称，展示在档案卡核心位置。' },
            h(TextInput, { value: draft.identity, onChange: (v) => set('identity', v) })
          ),
          h('div', { className: '__sp_two' },
            h(Field, { label: '身份编号 (ID)', hint: '卡面右上角特工序列号（如 0001、0087）。' },
              h(TextInput, { value: draft.identityId, mono: true, onChange: (v) => set('identityId', v) })
            ),
            h(Field, { label: '权限等级 (ACCESS LEVEL)', hint: '访问权限级别（如 LEVEL 99999 或 LEVEL 3）。' },
              h(TextInput, { value: draft.accessLevel, mono: true, onChange: (v) => set('accessLevel', v) })
            )
          )
        ),

        /* 三、 启动序列交互与动画 */
        h('div', { className: '__sp_group' },
          h('div', { className: '__sp_groupTitle' }, '三、 开机交互与动画控制 (Playback & Flow)'),
          h(Field, { label: '播放速度倍率' },
            h(Range, { value: num(draft.speed, 1), min: 0.35, max: 3, display: num(draft.speed, 1).toFixed(2) + '×', onChange: (v) => set('speed', v) })
          ),
          h(Field, { label: '弹出频次模式' },
            h(Select, {
              value: draft.mode,
              options: [
                ['always', '每次打开或刷新都播放 (always)'],
                ['session', '每个会话只播放一次 (session)'],
                ['daily', '每日首次打开时播放 (daily)']
              ],
              onChange: (v) => set('mode', v)
            })
          ),
          h(Check, {
            label: '需要人工确认 (Click / Enter / Space)',
            hint: '在第 1、2 步停下来等待用户按键继续；关闭则全流程自动流畅播完。',
            checked: draft.requireInteraction,
            onChange: (v) => set('requireInteraction', v)
          }),
          h(Check, {
            label: '允许跳过 (SKIP / ESC)',
            hint: '右上角显示 SKIP 按钮，按 Esc 键直接进入主工作区。',
            checked: draft.allowSkip,
            onChange: (v) => set('allowSkip', v)
          }),
          h(Check, {
            label: '启动界面音效',
            hint: '包含机械咔哒、过场扫频与和声钟，由 WebAudio 现场纯净合成。',
            checked: draft.sound,
            onChange: (v) => set('sound', v)
          }),
          draft.sound ? h(Field, { label: '启动音效音量' },
            h(Range, { value: num(draft.soundVolume, 0.6), min: 0, max: 1, display: Math.round(num(draft.soundVolume, 0.6) * 100) + '%', onChange: (v) => set('soundVolume', v) })
          ) : null
        ),

        /* 四、 语音念白 */
        h('div', { className: '__sp_group' },
          h('div', { className: '__sp_groupTitle' }, '四、 语音播报与念白 (Voice & Audio)'),
          h(Check, {
            label: '女声播报每一行台词',
            hint: '在动画每一阶段由神经网络女声朗诵台词，极具科幻电影沉浸感。',
            checked: draft.voice,
            onChange: (v) => set('voice', v)
          }),
          draft.voice ? h(Field, { label: '语音来源' },
            h(Select, {
              value: draft.voiceSource,
              options: [
                ['asset', '内置真声素材（极佳电影质感，优先推荐）'],
                ['tts', '系统 Web Speech TTS 语音合成']
              ],
              onChange: (v) => set('voiceSource', v)
            })
          ) : null,
          draft.voice ? h('div', { className: '__sp_two' },
            h(Field, { label: '语速' },
              h(Range, { value: num(draft.voiceRate, 0.88), min: 0.5, max: 1.5, display: num(draft.voiceRate, 0.88).toFixed(2) + '×', onChange: (v) => set('voiceRate', v) })
            ),
            h(Field, { label: '音量' },
              h(Range, { value: num(draft.voiceVolume, 0.9), min: 0, max: 1, display: Math.round(num(draft.voiceVolume, 0.9) * 100) + '%', onChange: (v) => set('voiceVolume', v) })
            )
          ) : null
        ),

        /* 五、 视觉与文案定制 */
        h('div', { className: '__sp_group' },
          h('div', { className: '__sp_groupTitle' }, '五、 视觉与文案定制 (Visuals & Customization)'),
          h(Field, { label: '认证底板风格' },
            h(Select, {
              value: draft.theme,
              options: [
                ['dark', '深色 · 夜行暗黑底板（推荐搭配深空星空与夜之城主题）'],
                ['light', '浅色 · 暖白档案底板（参考片原色）']
              ],
              onChange: (v) => set('theme', v)
            })
          ),
          h('div', { className: '__sp_two' },
            h(Field, { label: '强调色 (ACCENT)' },
              h('div', { className: '__sp_row' },
                h(ColorInput, { value: draft.accent, onChange: (v) => set('accent', v) }),
                h('span', { className: '__sp_status' }, draft.accent)
              )
            ),
            h(Field, { label: '故障色 (GLITCH)' },
              h('div', { className: '__sp_row' },
                h(ColorInput, { value: draft.glitchB, onChange: (v) => set('glitchB', v) }),
                h('span', { className: '__sp_status' }, draft.glitchB)
              )
            )
          ),
          h('div', { className: '__sp_two' },
            h(Field, { label: '左上主标题' }, h(TextInput, { value: draft.brand1, onChange: (v) => set('brand1', v) })),
            h(Field, { label: '右下页脚' }, h(TextInput, { value: draft.footer, mono: true, onChange: (v) => set('footer', v) }))
          )
        ),

        /* 六、 预览与保存操作 */
        h('div', { className: '__sp_preview' },
          h('div', { className: '__sp_previewText' },
            '点击「立即预览」将重播一次开机认证序列。更改模块开关后点击「保存」，当前窗口将实时刷新深空和主题状态。',
            file ? h('div', { style: { marginTop: '4px', opacity: 0.75 } }, '当前配置文件：' + file) : null
          ),
          h('button', { className: '__sp_btn', onClick: preview }, '立即预览启动动画')
        ),

        h('div', { className: '__sp_actions' },
          h('button', {
            className: '__sp_btn __sp_btnPrimary',
            disabled: busy,
            onClick: save
          }, busy ? '正在保存...' : '保存配置 (即时生效)'),
          h('button', { className: '__sp_btn', disabled: busy, onClick: reset }, '恢复默认'),
          h('button', { className: '__sp_btn', disabled: busy, onClick: load }, '放弃修改'),
          notice ? h('span', { className: '__sp_ok' }, '✔ ' + notice) : null,
          error ? h('span', { className: '__sp_err' }, '✖ ' + error) : null
        )
      );
    }

    /* ══════════════════════════════════════════════════════════════════════════
     * 4.5. 战术左上角侧边栏隐藏/展开总控 (STARLIGHT TACTICAL SIDEBAR TOGGLE)
     * ══════════════════════════════════════════════════════════════════════════ */
    var SidebarToggleManager = (function () {
      var btnEl = null;
      var tipEl = null;
      var layoutCtx = null;
      var audioCtx = null;
      var observer = null;
      var isCollapsedState = false;

      function playChime() {
        try {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          if (!audioCtx) audioCtx = new AC();
          if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
          var t = audioCtx.currentTime;
          var osc = audioCtx.createOscillator();
          var g = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(840, t);
          osc.frequency.exponentialRampToValueAtTime(1260, t + 0.05);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.04, t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
          osc.connect(g);
          g.connect(audioCtx.destination);
          osc.start(t);
          osc.stop(t + 0.06);
        } catch (e) {}
      }

      var SVG_COLLAPSE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2.5" width="12" height="11" rx="1" stroke="currentColor" stroke-width="1.2" opacity="0.65"/><line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" stroke-width="1.2"/><path d="M11 6L9 8L11 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      var SVG_EXPAND = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2.5" width="12" height="11" rx="1" stroke="currentColor" stroke-width="1.2" opacity="0.65"/><line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.5 1.5"/><path d="M8.5 6L10.5 8L8.5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

      function checkCollapsed() {
        var frame = document.querySelector('[class*="_frame"], [class*="q_frame"]');
        if (frame) {
          if (frame.hasAttribute('data-sidebar-collapsed')) return true;
          var cols = frame.style.gridTemplateColumns;
          if (cols && (cols.startsWith('0px') || cols.startsWith('0 '))) return true;
        }
        if (document.querySelector('[data-sidebar-collapsed="true"], [data-sidebar-collapsed=""]')) return true;

        var sb = document.querySelector('[class*="sidebarCol"], [class*="_sidebarCol"], aside');
        if (sb) {
          var r = sb.getBoundingClientRect();
          if (r.width <= 60 || sb.classList.contains('starlight-sidebar-forced-hidden')) return true;
          if (sb.className && typeof sb.className === 'string' && sb.className.includes('collapsed')) return true;
        }
        return false;
      }

      function updateUI() {
        if (!btnEl) return;
        isCollapsedState = checkCollapsed();
        btnEl.innerHTML = isCollapsedState ? SVG_EXPAND : SVG_COLLAPSE;
        var labelText = isCollapsedState ? '展开侧边栏 (Ctrl+B)' : '收起侧边栏 (Ctrl+B)';
        btnEl.setAttribute('aria-label', labelText);
        btnEl.setAttribute('data-collapsed', isCollapsedState ? 'true' : 'false');
        if (tipEl) {
          tipEl.textContent = labelText;
        }
      }

      function toggle() {
        playChime();
        var handled = false;

        var ctrl = layoutCtx || globalLayoutCtx;
        if (ctrl && typeof ctrl.toggleSidebar === 'function') {
          try {
            ctrl.toggleSidebar();
            handled = true;
          } catch (e) {
            console.warn('[Starlight] ctrl.toggleSidebar error:', e);
          }
        }

        if (!handled) {
          var candidates = document.querySelectorAll('button[aria-label*="侧边栏"], button[aria-label*="sidebar" i], [class*="wtg9ga_toggle"]');
          for (var i = 0; i < candidates.length; i++) {
            var b = candidates[i];
            if (b !== btnEl && !btnEl.contains(b)) {
              try {
                b.click();
                handled = true;
                break;
              } catch (e) {}
            }
          }
        }

        if (!handled) {
          try {
            var ev = new KeyboardEvent('keydown', {
              key: 'b',
              code: 'KeyB',
              keyCode: 66,
              which: 66,
              ctrlKey: true,
              bubbles: true,
              cancelable: true
            });
            document.dispatchEvent(ev);
            window.dispatchEvent(ev);
            handled = true;
          } catch (e) {}
        }

        var sb = document.querySelector('[class*="sidebarCol"], [class*="_sidebarCol"], aside');
        if (sb) {
          setTimeout(function () {
            if (isCollapsedState === checkCollapsed()) {
              if (sb.classList.contains('starlight-sidebar-forced-hidden')) {
                sb.classList.remove('starlight-sidebar-forced-hidden');
              } else {
                sb.classList.add('starlight-sidebar-forced-hidden');
              }
              window.dispatchEvent(new Event('resize'));
            }
            updateUI();
          }, 60);
        }

        setTimeout(updateUI, 200);
      }

      function init(ctx) {
        if (ctx && ctx.layout) layoutCtx = ctx.layout;
        else if (ctx && ctx.get) layoutCtx = ctx.get('layout');

        if (!document.getElementById('starlight-sidebar-toggle-css')) {
          var style = document.createElement('style');
          style.id = 'starlight-sidebar-toggle-css';
          style.textContent = [
            ':root { --dsh-windows-titlebar-height: 38px; }',
            '#starlight-sidebar-toggle {',
            '  position: fixed !important;',
            '  top: 6px !important;',
            '  left: 10px !important;',
            '  z-index: 10050 !important;',
            '  -webkit-app-region: no-drag !important;',
            '  width: 28px !important;',
            '  height: 28px !important;',
            '  display: inline-flex !important;',
            '  align-items: center !important;',
            '  justify-content: center !important;',
            '  padding: 0 !important;',
            '  margin: 0 !important;',
            '  background: rgba(8, 14, 26, 0.82) !important;',
            '  backdrop-filter: blur(10px) !important;',
            '  -webkit-backdrop-filter: blur(10px) !important;',
            '  border: 1px solid rgba(0, 240, 255, 0.45) !important;',
            '  color: #00f0ff !important;',
            '  cursor: pointer !important;',
            '  clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px) !important;',
            '  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1) !important;',
            '  user-select: none !important;',
            '  box-shadow: 0 0 8px rgba(0, 240, 255, 0.2) !important;',
            '}',
            '#starlight-sidebar-toggle:hover {',
            '  background: rgba(14, 28, 48, 0.95) !important;',
            '  border-color: #00f0ff !important;',
            '  color: #ffffff !important;',
            '  box-shadow: 0 0 14px rgba(0, 240, 255, 0.65), inset 0 0 8px rgba(0, 240, 255, 0.3) !important;',
            '  transform: scale(1.06) !important;',
            '}',
            '#starlight-sidebar-toggle:active {',
            '  background: rgba(252, 227, 0, 0.22) !important;',
            '  border-color: #fce300 !important;',
            '  color: #fce300 !important;',
            '  box-shadow: 0 0 16px rgba(252, 227, 0, 0.8) !important;',
            '  transform: scale(0.94) !important;',
            '}',
            '#starlight-sidebar-toggle svg {',
            '  pointer-events: none !important;',
            '  transition: transform 0.2s ease !important;',
            '}',
            '#starlight-sidebar-toggle:hover svg {',
            '  filter: drop-shadow(0 0 5px #00f0ff);',
            '}',
            '#starlight-sidebar-tip {',
            '  position: fixed !important;',
            '  top: 40px !important;',
            '  left: 10px !important;',
            '  z-index: 10051 !important;',
            '  pointer-events: none !important;',
            '  padding: 4px 8px !important;',
            '  font: 500 11px "SF Mono", "JetBrains Mono", Consolas, monospace !important;',
            '  letter-spacing: 0.06em !important;',
            '  color: #00f0ff !important;',
            '  background: rgba(6, 10, 18, 0.95) !important;',
            '  border: 1px solid rgba(0, 240, 255, 0.45) !important;',
            '  clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px) !important;',
            '  box-shadow: 0 0 10px rgba(0, 240, 255, 0.25) !important;',
            '  opacity: 0 !important;',
            '  transform: translateY(-4px) !important;',
            '  transition: opacity 0.18s ease, transform 0.18s ease !important;',
            '}',
            '#starlight-sidebar-toggle:hover + #starlight-sidebar-tip {',
            '  opacity: 1 !important;',
            '  transform: translateY(0) !important;',
            '}',
            '/* 侧边栏展开时让品牌 logo 右移，避免与左上角按钮重叠 */',
            '[class*="sidebarCol"]:not([class*="collapsed"]) [class*="logoRow"] {',
            '  padding-left: 36px !important;',
            '}',
            '/* 强制隐藏残缺错位的旧原生隐藏按钮，保持视觉统一 */',
            '.wtg9ga_toggle, [class*="_toggle"][aria-label*="侧边栏"] {',
            '  display: none !important;',
            '}',
            '.starlight-sidebar-forced-hidden {',
            '  width: 0 !important;',
            '  min-width: 0 !important;',
            '  max-width: 0 !important;',
            '  padding: 0 !important;',
            '  margin: 0 !important;',
            '  overflow: hidden !important;',
            '  border: none !important;',
            '  opacity: 0 !important;',
            '  pointer-events: none !important;',
            '}'
          ].join('\n');
          (document.head || document.documentElement).appendChild(style);
        }

        if (document.getElementById('starlight-sidebar-toggle')) {
          updateUI();
          return;
        }

        btnEl = document.createElement('button');
        btnEl.id = 'starlight-sidebar-toggle';
        btnEl.type = 'button';
        btnEl.setAttribute('tabindex', '0');

        tipEl = document.createElement('div');
        tipEl.id = 'starlight-sidebar-tip';

        btnEl.addEventListener('click', function (e) {
          e.stopPropagation();
          e.preventDefault();
          toggle();
        });

        function mount() {
          var host = document.body || document.documentElement;
          if (host && !document.getElementById('starlight-sidebar-toggle')) {
            host.appendChild(btnEl);
            host.appendChild(tipEl);
            updateUI();
          }
        }

        if (document.body) {
          mount();
        } else {
          window.addEventListener('DOMContentLoaded', mount);
        }

        if (!observer && typeof MutationObserver !== 'undefined') {
          var updateTimer = null;
          observer = new MutationObserver(function () {
            if (updateTimer) return;
            updateTimer = setTimeout(function () {
              updateTimer = null;
              updateUI();
            }, 120);
          });
          var target = document.body || document.documentElement;
          if (target) {
            observer.observe(target, {
              attributes: true,
              subtree: true,
              attributeFilter: ['class', 'data-sidebar-collapsed']
            });
          }
        }
        window.addEventListener('resize', updateUI);
      }

      return {
        init: init,
        toggle: toggle,
        update: updateUI
      };
    })();

    /* ══════════════════════════════════════════════════════════════════════════
     * 5. 插件装载与调度 (PLUGIN ENTRY & LIFECYCLE)
     * ══════════════════════════════════════════════════════════════════════════ */
    function apply(ctx) {
      globalThemeCtx = ctx && ctx.theme ? ctx.theme : null;
      globalLayoutCtx = (ctx && ctx.layout) || (ctx && ctx.get ? ctx.get("layout") : null);

      // 0. 战术左上角侧边栏隐藏/展开总控
      SidebarToggleManager.init(ctx);

      // 1. 读取配置并初始化子系统
      fetch(API, { headers: { Accept: 'application/json' } })
        .then((r) => r.json())
        .catch(() => fetch(LEGACY_API, { headers: { Accept: 'application/json' } }).then((r2) => r2.json()))
        .then((j) => {
          const cfg = (j && j.ok === true && j.config) ? j.config : { spaceEnabled: true, themeEnabled: true, enabled: true };
          if (cfg.spaceEnabled !== false) {
            SpaceManager.start();
          }
          if (cfg.themeEnabled !== false) {
            CyberThemeManager.start(globalThemeCtx);
          }
        })
        .catch(() => {
          SpaceManager.start();
          CyberThemeManager.start(globalThemeCtx);
        });

      // 2. 桌面自举（兜底开机动画）
      selfBoot();

      // 3. 注册统一设置面板
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'starlight-protocol', order: 26, label: '星轨协议 (Starlight)' },
          function () { return h(StarlightPanel, {}); }
        );
      });
    }

    exports.apply = apply;
    exports.inject = ['slots', 'theme', 'layout'];
    return module.exports;
  }
});
