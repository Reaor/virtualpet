/**
 * 字灵 · Pet Engine
 *
 * 核心：成百个「字」粒子通过弹簧物理追逐目标点，目标点由当前形态的轮廓采样而来。
 * 形态是一个函数：给定一块尺寸 S，返回 N 个目标点 + 两只眼睛位置。
 * 形态定义使用离屏 canvas 画出剪影，再均匀采样填充像素得到目标点；
 * 数学曲线（心、花、蝶）则直接参数化计算，更精确。
 */

(function () {
  "use strict";

  // ---------- 字池（默认字符集，会被吞字事件扩充） ----------
  const DEFAULT_POOL =
    "云月风雨雪露霜霞星辰烟岚山川溪涧花草木叶竹梅兰菊兽羽灵喵呜呀兮曦墨砚诗书笔宣素笺~·°✦".split("");

  // ---------- 工具 ---------- //
  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function hashShuffle(arr, seed) {
    // 稳定伪随机洗牌：换形时若粒子数不变，字序不乱窜
    const a = arr.slice();
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const j = Math.floor((s / 233280) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 剪影采样 ---------- //
  // 把绘制好的不透明像素均匀抽 N 个作为目标点
  function sampleSilhouette(drawFn, S, count) {
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, S, S);
    drawFn(ctx, S);
    const img = ctx.getImageData(0, 0, S, S).data;

    // 收集所有不透明像素
    const px = [];
    for (let y = 0; y < S; y += 2) {
      for (let x = 0; x < S; x += 2) {
        if (img[(y * S + x) * 4 + 3] > 128) px.push(x, y);
      }
    }
    if (px.length === 0) return [];

    // 均匀抽样
    const total = px.length / 2;
    const step = Math.max(1, Math.floor(total / count));
    const points = [];
    for (let i = 0; i < total && points.length < count; i += step) {
      const jitter = () => (Math.random() - 0.5) * 1.5;
      points.push({ x: px[i * 2] - S / 2 + jitter(), y: px[i * 2 + 1] - S / 2 + jitter() });
    }
    // 若不足，用已有点复制补齐
    while (points.length < count) {
      const p = points[points.length % Math.max(1, points.length)] || { x: 0, y: 0 };
      points.push({ x: p.x + rand(-3, 3), y: p.y + rand(-3, 3) });
    }
    return points.slice(0, count);
  }

  // 数学曲线采样（更光滑）
  function parametricPoints(fn, count, scale) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = (i / count) * TAU;
      const [x, y] = fn(t);
      out.push({ x: x * scale, y: y * scale });
    }
    return out;
  }

  // 在形状内部加噪声填充，把线状曲线变成体积
  function fillFromOutline(outline, count, thickness) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = outline[Math.floor(Math.random() * outline.length)];
      out.push({
        x: p.x + rand(-thickness, thickness),
        y: p.y + rand(-thickness, thickness),
      });
    }
    return out;
  }

  // ---------- 形态库 ---------- //
  // 每个形态：{ label, build(count, S) -> {targets: [{x,y}], eyes: [{x,y},{x,y}], faceDir } }
  const FORMS = {
    blob: {
      label: "软团",
      build(n, S) {
        const R = S * 0.32;
        const targets = [];
        for (let i = 0; i < n; i++) {
          // 柔和不规则团：半径由几个低频正弦叠加
          const a = Math.random() * TAU;
          const wob = 1 + 0.15 * Math.sin(a * 3) + 0.08 * Math.sin(a * 5 + 1.3);
          const r = R * wob * Math.sqrt(Math.random());
          targets.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.92 });
        }
        return {
          targets,
          eyes: [
            { x: -R * 0.32, y: -R * 0.1 },
            { x: R * 0.32, y: -R * 0.1 },
          ],
          eyeSize: 1.5,
        };
      },
    },

    cat: {
      label: "猫",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          // 脸
          ctx.beginPath();
          ctx.ellipse(s / 2, s / 2 + 6, s * 0.3, s * 0.26, 0, 0, TAU);
          ctx.fill();
          // 左耳
          ctx.beginPath();
          ctx.moveTo(s / 2 - s * 0.24, s / 2 - s * 0.1);
          ctx.lineTo(s / 2 - s * 0.32, s / 2 - s * 0.32);
          ctx.lineTo(s / 2 - s * 0.08, s / 2 - s * 0.16);
          ctx.closePath();
          ctx.fill();
          // 右耳
          ctx.beginPath();
          ctx.moveTo(s / 2 + s * 0.24, s / 2 - s * 0.1);
          ctx.lineTo(s / 2 + s * 0.32, s / 2 - s * 0.32);
          ctx.lineTo(s / 2 + s * 0.08, s / 2 - s * 0.16);
          ctx.closePath();
          ctx.fill();
        }, S, n);
        const R = S * 0.3;
        return {
          targets,
          eyes: [
            { x: -R * 0.35, y: 0 },
            { x: R * 0.35, y: 0 },
          ],
          eyeSize: 1.7,
        };
      },
    },

    fox: {
      label: "狐",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          // 尖脸（倒三角偏圆）
          ctx.beginPath();
          ctx.moveTo(s / 2, s / 2 + s * 0.28);
          ctx.quadraticCurveTo(s / 2 - s * 0.3, s / 2 + s * 0.1, s / 2 - s * 0.28, s / 2 - s * 0.1);
          ctx.lineTo(s / 2 - s * 0.32, s / 2 - s * 0.34);
          ctx.lineTo(s / 2 - s * 0.08, s / 2 - s * 0.18);
          ctx.lineTo(s / 2 + s * 0.08, s / 2 - s * 0.18);
          ctx.lineTo(s / 2 + s * 0.32, s / 2 - s * 0.34);
          ctx.lineTo(s / 2 + s * 0.28, s / 2 - s * 0.1);
          ctx.quadraticCurveTo(s / 2 + s * 0.3, s / 2 + s * 0.1, s / 2, s / 2 + s * 0.28);
          ctx.closePath();
          ctx.fill();
        }, S, n);
        const R = S * 0.3;
        return {
          targets,
          eyes: [
            { x: -R * 0.3, y: -R * 0.05 },
            { x: R * 0.3, y: -R * 0.05 },
          ],
          eyeSize: 1.6,
        };
      },
    },

    rabbit: {
      label: "兔",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          // 头
          ctx.beginPath();
          ctx.ellipse(s / 2, s / 2 + s * 0.1, s * 0.24, s * 0.22, 0, 0, TAU);
          ctx.fill();
          // 长耳 x2
          ctx.beginPath();
          ctx.ellipse(s / 2 - s * 0.12, s / 2 - s * 0.2, s * 0.06, s * 0.2, -0.1, 0, TAU);
          ctx.ellipse(s / 2 + s * 0.12, s / 2 - s * 0.2, s * 0.06, s * 0.2, 0.1, 0, TAU);
          ctx.fill();
        }, S, n);
        const R = S * 0.22;
        return {
          targets,
          eyes: [
            { x: -R * 0.5, y: R * 0.1 },
            { x: R * 0.5, y: R * 0.1 },
          ],
          eyeSize: 1.6,
        };
      },
    },

    dragon: {
      label: "龙",
      build(n, S) {
        // 蜿蜒体：沿 S 形曲线铺厚度
        const outline = [];
        const steps = 180;
        for (let i = 0; i < steps; i++) {
          const t = i / steps;
          const x = (t - 0.5) * S * 0.82;
          const y = Math.sin(t * Math.PI * 2.2) * S * 0.18;
          outline.push({ x, y });
        }
        const body = fillFromOutline(outline, Math.max(0, n - 8), S * 0.05);
        // 龙首更密（体积更大）
        const head = [];
        for (let i = 0; i < 8; i++) {
          head.push({
            x: outline[outline.length - 1].x + rand(-S * 0.05, S * 0.05),
            y: outline[outline.length - 1].y + rand(-S * 0.05, S * 0.05),
          });
        }
        const targets = body.concat(head);
        const headP = outline[outline.length - 1];
        return {
          targets,
          eyes: [
            { x: headP.x - S * 0.03, y: headP.y - S * 0.04 },
            { x: headP.x + S * 0.03, y: headP.y - S * 0.02 },
          ],
          eyeSize: 1.5,
        };
      },
    },

    snake: {
      label: "寻字",
      build(n, S) {
        // 长蛇体：沿正弦铺单层，用于觅食模式；头部位置后续由外部控制
        const outline = [];
        const steps = Math.max(40, n);
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const x = (t - 0.5) * S * 0.9;
          const y = Math.sin(t * Math.PI * 3) * S * 0.12;
          outline.push({ x, y });
        }
        const targets = outline.slice(0, n);
        const head = outline[outline.length - 1];
        return {
          targets,
          eyes: [
            { x: head.x - S * 0.015, y: head.y - S * 0.02 },
            { x: head.x + S * 0.015, y: head.y - S * 0.02 },
          ],
          eyeSize: 1.3,
          // 蛇形：目标点是"按顺序排列"的，这样粒子会形成有顺序的链
          ordered: true,
        };
      },
    },

    butterfly: {
      label: "蝶",
      build(n, S) {
        const fn = (t) => {
          // 蝴蝶参数曲线（Fay 曲线）
          const r =
            Math.exp(Math.cos(t)) -
            2 * Math.cos(4 * t) -
            Math.pow(Math.sin(t / 12), 5);
          return [Math.sin(t) * r, -Math.cos(t) * r];
        };
        const outline = parametricPoints(fn, 400, S * 0.07);
        const targets = fillFromOutline(outline, n, S * 0.02);
        return {
          targets,
          eyes: [
            { x: -S * 0.02, y: -S * 0.05 },
            { x: S * 0.02, y: -S * 0.05 },
          ],
          eyeSize: 1.2,
        };
      },
    },

    koi: {
      label: "锦鲤",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          // 身体椭圆
          ctx.beginPath();
          ctx.ellipse(s / 2 - s * 0.05, s / 2, s * 0.3, s * 0.14, -0.1, 0, TAU);
          ctx.fill();
          // 尾鳍
          ctx.beginPath();
          ctx.moveTo(s / 2 + s * 0.22, s / 2 - s * 0.02);
          ctx.lineTo(s / 2 + s * 0.42, s / 2 - s * 0.18);
          ctx.lineTo(s / 2 + s * 0.44, s / 2);
          ctx.lineTo(s / 2 + s * 0.42, s / 2 + s * 0.18);
          ctx.closePath();
          ctx.fill();
          // 上鳍
          ctx.beginPath();
          ctx.moveTo(s / 2 - s * 0.05, s / 2 - s * 0.12);
          ctx.lineTo(s / 2 + s * 0.02, s / 2 - s * 0.26);
          ctx.lineTo(s / 2 + s * 0.1, s / 2 - s * 0.1);
          ctx.closePath();
          ctx.fill();
        }, S, n);
        return {
          targets,
          eyes: [
            { x: -S * 0.28, y: -S * 0.03 },
            { x: -S * 0.23, y: -S * 0.03 },
          ],
          eyeSize: 1.3,
        };
      },
    },

    moon: {
      label: "月",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(s / 2, s / 2, s * 0.32, 0, TAU);
          ctx.fill();
          // 挖出内弧 -> 新月
          ctx.globalCompositeOperation = "destination-out";
          ctx.beginPath();
          ctx.arc(s / 2 + s * 0.14, s / 2 - s * 0.05, s * 0.3, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }, S, n);
        return {
          targets,
          eyes: [
            { x: -S * 0.2, y: -S * 0.02 },
            { x: -S * 0.1, y: -S * 0.05 },
          ],
          eyeSize: 1.4,
        };
      },
    },

    flower: {
      label: "花",
      build(n, S) {
        // 玫瑰曲线 r = cos(kθ)
        const k = 5;
        const fn = (t) => {
          const r = Math.cos(k * t);
          return [r * Math.cos(t), r * Math.sin(t)];
        };
        const outline = parametricPoints(fn, 500, S * 0.32);
        const targets = fillFromOutline(outline, n, S * 0.015);
        return {
          targets,
          eyes: [
            { x: -S * 0.04, y: -S * 0.01 },
            { x: S * 0.04, y: -S * 0.01 },
          ],
          eyeSize: 1.3,
        };
      },
    },

    heart: {
      label: "心",
      build(n, S) {
        const fn = (t) => {
          // 心形
          const x = 16 * Math.pow(Math.sin(t), 3);
          const y =
            -(13 * Math.cos(t) -
              5 * Math.cos(2 * t) -
              2 * Math.cos(3 * t) -
              Math.cos(4 * t));
          return [x, y];
        };
        const outline = parametricPoints(fn, 400, S * 0.02);
        const targets = fillFromOutline(outline, n, S * 0.018);
        return {
          targets,
          eyes: [
            { x: -S * 0.12, y: -S * 0.12 },
            { x: S * 0.12, y: -S * 0.12 },
          ],
          eyeSize: 1.4,
        };
      },
    },
  };

  const FORM_ORDER = [
    "blob",
    "cat",
    "fox",
    "rabbit",
    "koi",
    "butterfly",
    "flower",
    "heart",
    "moon",
    "dragon",
  ];

  // ---------- 表情 ---------- //
  const EXPRESSIONS = {
    normal: { left: "◉", right: "◉", color: "#1d1a15" },
    happy: { left: "^", right: "^", color: "#7d2c21" },
    wink: { left: "^", right: "◉", color: "#1d1a15" },
    sleep: { left: "ー", right: "ー", color: "#6f6555" },
    shy: { left: ">", right: "<", color: "#9c3a2d" },
    surprised: { left: "O", right: "O", color: "#1d1a15" },
  };

  // ---------- Pet 主类 ---------- //
  class Pet {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.DPR = Math.min(window.devicePixelRatio || 1, 2);
      this.width = 0;
      this.height = 0;
      this.center = { x: 0, y: 0 };
      this.size = 320; // 身体参考尺寸 S

      this.particleCount = opts.particleCount || 140;
      this.pool = (opts.pool || DEFAULT_POOL).slice();
      this.eatenChars = []; // 吞下的字，会混入 pool

      this.glyphs = [];
      this.eyes = [
        { x: 0, y: 0, tx: 0, ty: 0, size: 22, char: "◉" },
        { x: 0, y: 0, tx: 0, ty: 0, size: 22, char: "◉" },
      ];
      this.expression = "normal";

      this.form = "blob";
      this.formData = null;
      this.formStartTime = 0;

      // 宠物整体位置（世界坐标），正常时漂浮在画布中心附近
      this.pos = { x: 0, y: 0 };
      this.vel = { x: 0, y: 0 };
      this.anchor = { x: 0, y: 0 }; // 游荡的目标中心
      this.idleAngle = 0;

      // 呼吸 / 尺寸
      this.breath = 0;
      this.scale = 1;
      this.targetScale = 1;

      // 头朝向
      this.rotation = 0;
      this.targetRotation = 0;
      this.facingFlip = 1;

      // 鼠标/触摸交互
      this.ripples = []; // {x,y,r,alpha}
      this.dragging = false;
      this.dragOffset = { x: 0, y: 0 };
      this.pointerPos = null;

      // 飞行字（被喂食时从屏幕上飞进来的字）
      this.flyingGlyphs = [];

      // 觅食模式
      this.mode = "idle"; // idle | feeding | sleep
      this.feedQueue = [];
      this.feedTargetWorld = null;
      this.onFeedDone = null;

      this._resize = this._resize.bind(this);
      this._resize();
      window.addEventListener("resize", this._resize);

      this._initGlyphs();
      this.setForm("blob");

      this._lastTime = performance.now();
      this._raf = requestAnimationFrame(this._loop.bind(this));
    }

    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = rect.width * this.DPR;
      this.canvas.height = rect.height * this.DPR;
      this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
      this.center = { x: this.width / 2, y: this.height / 2 };
      // 身体参考尺寸：按短边
      this.size = Math.min(this.width, this.height) * 0.9;
      this.anchor = { x: this.center.x, y: this.center.y };
      if (this.pos.x === 0 && this.pos.y === 0) {
        this.pos.x = this.center.x;
        this.pos.y = this.center.y;
      }
      // 重建当前形态（尺寸变了）
      if (this.formData) this.setForm(this.form, true);
    }

    _randomChar() {
      const arr = this.eatenChars.length && Math.random() < 0.5
        ? this.eatenChars
        : this.pool;
      return arr[Math.floor(Math.random() * arr.length)];
    }

    _initGlyphs() {
      this.glyphs = [];
      for (let i = 0; i < this.particleCount; i++) {
        this.glyphs.push({
          char: this._randomChar(),
          x: this.center.x + rand(-60, 60),
          y: this.center.y + rand(-60, 60),
          vx: 0,
          vy: 0,
          tx: 0,
          ty: 0,
          size: rand(10, 18),
          alpha: rand(0.65, 1),
          rot: rand(-0.3, 0.3),
          targetRot: 0,
          // 外圈字略模糊：给粒子一个"深度"参数
          depth: Math.random(),
        });
      }
    }

    setForm(name, silent) {
      if (!FORMS[name]) return;
      this.form = name;
      this.formStartTime = performance.now();
      const S = this.size;
      const data = FORMS[name].build(this.particleCount, S);
      // 稳定分配：给粒子分配目标点（顺序洗一下以避免总是同号粒子去同位置）
      const order = data.ordered
        ? data.targets // 顺序形态（蛇）不洗牌
        : hashShuffle(data.targets, name.charCodeAt(0) + this.particleCount);
      for (let i = 0; i < this.glyphs.length; i++) {
        const t = order[i] || order[i % order.length];
        this.glyphs[i].tx = t.x;
        this.glyphs[i].ty = t.y;
        this.glyphs[i].targetRot = rand(-0.15, 0.15);
      }
      data.leftEyeSize = this.size * 0.065 * (data.eyeSize || 1.4);
      this.formData = data;
    }

    setExpression(name) {
      this.expression = EXPRESSIONS[name] ? name : "normal";
    }

    addPoolChars(chars) {
      for (const c of chars) {
        if (c && c.trim() && c !== "\n") this.eatenChars.push(c);
      }
      // 随机把一部分现有粒子换成新字，让"吃进去"看得见
      const replace = Math.min(this.glyphs.length, chars.length * 2);
      const indices = [];
      while (indices.length < replace) {
        const i = Math.floor(Math.random() * this.glyphs.length);
        if (!indices.includes(i)) indices.push(i);
      }
      for (const i of indices) {
        this.glyphs[i].char = chars[Math.floor(Math.random() * chars.length)] || this.glyphs[i].char;
      }
    }

    // 从屏幕坐标（画布坐标系）飞来一个字，最终并入身体
    flyInChar(char, fromX, fromY) {
      this.flyingGlyphs.push({
        char,
        x: fromX,
        y: fromY,
        vx: 0,
        vy: 0,
        t: 0,
        life: 0.9 + Math.random() * 0.3,
        size: 20 + Math.random() * 6,
      });
    }

    // 加一个触点涟漪
    pulse(x, y) {
      this.ripples.push({ x, y, r: 6, alpha: 0.55 });
    }

    // 觅食路径：传入一组世界坐标目标点（按顺序访问），每到一个触发 callback
    startFeeding(targets, onReach, onDone) {
      this.mode = "feeding";
      this.feedQueue = targets.slice();
      this.onFeedReach = onReach;
      this.onFeedDone = onDone;
      this.setForm("snake");
      this.setExpression("surprised");
    }

    stopFeeding() {
      this.mode = "idle";
      this.feedQueue = [];
      this.setForm("blob");
      this.setExpression("happy");
      setTimeout(() => {
        if (this.mode === "idle") this.setExpression("normal");
      }, 1200);
    }

    sleep(on) {
      if (on) {
        this.mode = "sleep";
        this.setExpression("sleep");
      } else {
        this.mode = "idle";
        this.setExpression("normal");
      }
    }

    shake() {
      // 抖擞：瞬时速度扰动 + 全体粒子获得随机冲量
      this.vel.x += rand(-200, 200);
      this.vel.y += rand(-100, 100);
      for (const g of this.glyphs) {
        g.vx += rand(-600, 600);
        g.vy += rand(-600, 600);
      }
      this.setExpression("surprised");
      setTimeout(() => this.setExpression("normal"), 800);
    }

    // 拖拽（世界坐标系）
    beginDrag(x, y) {
      this.dragging = true;
      this.dragOffset.x = this.pos.x - x;
      this.dragOffset.y = this.pos.y - y;
      this.setExpression("shy");
    }
    dragTo(x, y) {
      if (!this.dragging) return;
      this.pos.x = x + this.dragOffset.x;
      this.pos.y = y + this.dragOffset.y;
    }
    endDrag() {
      this.dragging = false;
      this.setExpression("happy");
      setTimeout(() => {
        if (this.expression === "happy") this.setExpression("normal");
      }, 1000);
    }

    // ---------- 主循环 ---------- //
    _loop(now) {
      const dt = Math.min(0.033, (now - this._lastTime) / 1000);
      this._lastTime = now;
      this._update(dt, now);
      this._render(now);
      this._raf = requestAnimationFrame(this._loop.bind(this));
    }

    _update(dt, now) {
      const t = now / 1000;
      this.breath = Math.sin(t * 1.3) * 0.06 + 1;

      // 自由漂移 —— 非拖拽且非觅食时
      if (!this.dragging) {
        if (this.mode === "idle") {
          this.idleAngle += dt * 0.35;
          const ax =
            this.center.x +
            Math.sin(this.idleAngle * 0.7) * this.width * 0.14 +
            Math.sin(this.idleAngle * 1.3 + 1.1) * this.width * 0.06;
          const ay =
            this.center.y +
            Math.cos(this.idleAngle * 0.6) * this.height * 0.1 +
            Math.sin(this.idleAngle * 1.1) * this.height * 0.05;
          this.anchor.x = ax;
          this.anchor.y = ay;
        } else if (this.mode === "sleep") {
          this.anchor.x = lerp(this.anchor.x, this.center.x, 0.05);
          this.anchor.y = lerp(this.anchor.y, this.center.y + this.height * 0.05, 0.05);
        } else if (this.mode === "feeding") {
          if (this.feedTargetWorld) {
            this.anchor.x = this.feedTargetWorld.x;
            this.anchor.y = this.feedTargetWorld.y;
          } else if (this.feedQueue.length) {
            this.feedTargetWorld = this.feedQueue.shift();
          } else {
            // 完成，回家
            this.feedTargetWorld = null;
            const doneCb = this.onFeedDone;
            this.onFeedDone = null;
            this.onFeedReach = null;
            this.stopFeeding();
            if (doneCb) doneCb();
          }

          if (this.feedTargetWorld) {
            const dx = this.feedTargetWorld.x - this.pos.x;
            const dy = this.feedTargetWorld.y - this.pos.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 26) {
              // 到达：触发回调，继续下一个
              const reached = this.feedTargetWorld;
              this.feedTargetWorld = null;
              if (this.onFeedReach) this.onFeedReach(reached);
            }
          }
        }
      }

      // 宠物整体位置向 anchor 靠近（有惯性）
      if (!this.dragging) {
        const k = this.mode === "feeding" ? 14 : 3.5;
        const damp = this.mode === "feeding" ? 4 : 2.2;
        const ax = (this.anchor.x - this.pos.x) * k - this.vel.x * damp;
        const ay = (this.anchor.y - this.pos.y) * k - this.vel.y * damp;
        this.vel.x += ax * dt;
        this.vel.y += ay * dt;
      } else {
        this.vel.x *= 0.85;
        this.vel.y *= 0.85;
      }
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;

      // 朝向：速度方向决定左右翻面 & 小角度倾斜
      if (Math.abs(this.vel.x) > 40) {
        this.facingFlip = this.vel.x > 0 ? 1 : -1;
      }
      this.targetRotation = clamp(this.vel.x * 0.0005, -0.2, 0.2);
      this.rotation = lerp(this.rotation, this.targetRotation, 0.1);
      this.scale = lerp(this.scale, this.targetScale * this.breath, 0.15);

      // 每个字粒子：向 (宠物位置 + 目标相对偏移) 做弹簧运动
      const bx = this.pos.x;
      const by = this.pos.y;
      const rot = this.rotation;
      const flip = this.facingFlip;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const springK = this.mode === "feeding" ? 60 : 28;
      const damping = this.mode === "feeding" ? 7 : 5.2;

      for (const g of this.glyphs) {
        // 目标点做旋转+翻转后平移到世界坐标
        const tx = g.tx * flip;
        const ty = g.ty;
        const wx = bx + (tx * cos - ty * sin);
        const wy = by + (tx * sin + ty * cos);
        // 轻微呼吸扰动（按深度参数差异化）
        const bw = Math.sin(t * 2 + g.depth * 6) * 1.2;
        const ax = (wx - g.x) * springK - g.vx * damping + bw;
        const ay = (wy - g.y) * springK - g.vy * damping;
        g.vx += ax * dt;
        g.vy += ay * dt;
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        // 旋转轻微回归
        g.rot = lerp(g.rot, g.targetRot, 0.08);
      }

      // 眼睛跟形态
      if (this.formData) {
        for (let i = 0; i < 2; i++) {
          const e = this.formData.eyes[i];
          const tx = e.x * flip;
          const ty = e.y;
          const wx = bx + (tx * cos - ty * sin);
          const wy = by + (tx * sin + ty * cos);
          this.eyes[i].tx = wx;
          this.eyes[i].ty = wy;
          this.eyes[i].x = lerp(this.eyes[i].x || wx, wx, 0.25);
          this.eyes[i].y = lerp(this.eyes[i].y || wy, wy, 0.25);
          this.eyes[i].size = this.formData.leftEyeSize;
        }
      }

      // 涟漪
      for (const r of this.ripples) {
        r.r += 160 * dt;
        r.alpha -= 0.9 * dt;
      }
      this.ripples = this.ripples.filter((r) => r.alpha > 0);

      // 飞来的字：弹簧到宠物中心，到了就合并
      for (const f of this.flyingGlyphs) {
        const dx = this.pos.x - f.x;
        const dy = this.pos.y - f.y;
        f.vx += dx * 20 * dt - f.vx * 4 * dt;
        f.vy += dy * 20 * dt - f.vy * 4 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.t += dt;
      }
      // 合并吸入
      this.flyingGlyphs = this.flyingGlyphs.filter((f) => {
        if (Math.hypot(f.x - this.pos.x, f.y - this.pos.y) < 18) {
          // 随机替换一个粒子
          const g = this.glyphs[Math.floor(Math.random() * this.glyphs.length)];
          g.char = f.char;
          // 触发一个小涟漪
          this.pulse(this.pos.x, this.pos.y);
          return false;
        }
        return f.t < f.life + 2;
      });
    }

    _render(now) {
      const ctx = this.ctx;
      const W = this.width;
      const H = this.height;
      ctx.clearRect(0, 0, W, H);

      // 背景墨晕（身体阴影）
      const shadowR = this.size * 0.24;
      const grd = ctx.createRadialGradient(
        this.pos.x,
        this.pos.y + 2,
        shadowR * 0.1,
        this.pos.x,
        this.pos.y + 2,
        shadowR
      );
      grd.addColorStop(0, "rgba(40, 28, 14, 0.22)");
      grd.addColorStop(0.6, "rgba(40, 28, 14, 0.06)");
      grd.addColorStop(1, "rgba(40, 28, 14, 0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);

      // 涟漪
      ctx.save();
      ctx.lineWidth = 1;
      for (const r of this.ripples) {
        ctx.strokeStyle = `rgba(124, 40, 30, ${r.alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();

      // 字粒子
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // 两遍：先画"淡墨"背层，再画"浓墨"前层，做层次
      // —— 背层（大而淡）——
      for (const g of this.glyphs) {
        const depth = g.depth;
        if (depth > 0.5) continue;
        const size = g.size * 1.6 * this.scale;
        ctx.fillStyle = `rgba(29, 26, 21, ${0.08 * g.alpha})`;
        ctx.font = `${size.toFixed(1)}px "LXGW WenKai", serif`;
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.rot);
        ctx.fillText(g.char, 0, 0);
        ctx.restore();
      }
      // —— 前层（清晰）——
      for (const g of this.glyphs) {
        const size = g.size * this.scale;
        const depth = g.depth;
        const alpha = (0.6 + 0.4 * (1 - depth)) * g.alpha;
        ctx.fillStyle = `rgba(29, 26, 21, ${alpha})`;
        ctx.font = `${size.toFixed(1)}px "LXGW WenKai", serif`;
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.rot);
        ctx.fillText(g.char, 0, 0);
        ctx.restore();
      }

      // 眼睛（在字群之上，最显眼）
      const expr = EXPRESSIONS[this.expression];
      for (let i = 0; i < 2; i++) {
        const e = this.eyes[i];
        const s = Math.max(10, e.size || this.size * 0.08);
        ctx.font = `${s.toFixed(1)}px "LXGW WenKai", serif`;
        ctx.fillStyle = expr.color;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(this.rotation);
        ctx.fillText(i === 0 ? expr.left : expr.right, 0, 0);
        ctx.restore();
      }

      // 飞字
      for (const f of this.flyingGlyphs) {
        const a = clamp(1 - f.t / (f.life + 0.1), 0, 1);
        ctx.font = `${f.size.toFixed(1)}px "LXGW WenKai", serif`;
        ctx.fillStyle = `rgba(124, 40, 30, ${a})`;
        ctx.fillText(f.char, f.x, f.y);
      }
      ctx.restore();
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      window.removeEventListener("resize", this._resize);
    }
  }

  // ---------- 对外暴露 ---------- //
  window.ZiLing = {
    Pet,
    FORMS,
    FORM_ORDER,
    DEFAULT_POOL,
  };
})();
