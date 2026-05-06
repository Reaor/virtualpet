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

  /** 情绪词：会短暂替换部分躯体内的字，与表情同步 */
  const MOOD_POOLS = {
    normal: "静安守默观息",
    happy: "悦朗笑暖晴",
    annoyed: "躁烦扰急",
    sleep: "眠梦幽沉",
    wink: "俏灵闪",
    shy: "羞敛藏",
    surprised: "讶愕醒",
  };

  /** 单字 → 日程语义（与多字词规则互补） */
  const CHAR_DIGEST_HINT = {
    拖: "delay",
    怠: "delay",
    欠: "todo",
    缺: "todo",
    缓: "delay",
    成: "done",
    毕: "done",
    结: "done",
    捷: "done",
    迟: "delay",
    误: "delay",
  };

  /** 吞噬文本中的子串 → 反馈（含情绪粒子比例：默认少量，冲击模式单独处理） */
  const DIGEST_RULES = [
    { keys: ["未完成", "没做完", "待办", "待完成"], kind: "todo" },
    { keys: ["已完成", "完成了", "做完", "搞定", "完成"], kind: "done" },
    { keys: ["拖延", "耽搁", "推迟", "延后"], kind: "delay" },
  ];

  /**
   * 单行日程语义（与后续日程 App 对齐）：已完成可吞食；未完成仅穿透不贴躯体。
   * 约定：【已完成】【完成】【未完成】【待办】、半角 []、行首 ✓/✅、行首「已完成：」「待办：」等。
   */
  function classifyScheduleLine(rawLine) {
    const line = String(rawLine || "").trim();
    if (!line) return { status: "neutral", content: "", line };

    const tagHits = [];
    const pushHit = (status, index, len) => {
      tagHits.push({ status, index, len });
    };
    const scan = (pattern, status) => {
      const r = new RegExp(pattern.source, pattern.global ? pattern.flags : pattern.flags + "g");
      let m;
      while ((m = r.exec(line)) !== null) {
        pushHit(status, m.index, m[0].length);
      }
    };
    scan(/【已完成】|【完成】|\[已完成\]|\[完成\]/g, "done");
    scan(/【未完成】|【待办】|\[未完成\]|\[待办\]/g, "todo");
    tagHits.sort((a, b) => a.index - b.index);
    const firstTag = tagHits[0];

    const donePrefix = /^\s*[✓✔✅]/;
    const leadDone = /^(已完成|完成了|搞定)\s*[：:]\s*/;
    const leadTodo = /^(未完成|待办|待完成|没做完)\s*[：:]\s*/;

    let status = "neutral";
    if (firstTag) status = firstTag.status;
    else if (donePrefix.test(line)) status = "done";
    else if (leadTodo.test(line)) status = "todo";
    else if (leadDone.test(line)) status = "done";

    let content = line
      .replace(/【已完成】|【完成】|【未完成】|【待办】/g, " ")
      .replace(/\[已完成\]|\[完成\]|\[未完成\]|\[待办\]/g, " ")
      .replace(/^\s*[✓✔✅]\s*/, "")
      .replace(/^(已完成|完成了|搞定|未完成|待办|待完成|没做完)\s*[：:]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();

    return { status, content, line };
  }

  /** 字池中出现某字时给形态的「饮食偏好」累积 */
  const CHAR_FORM_BIAS = {
    鱼: "koi",
    鲤: "koi",
    花: "flower",
    蝶: "butterfly",
    网: "kao_cool",
    符: "kao_cool",
    情: "kao_joy",
    绘: "kao_sweat",
    时: "clock",
    钟: "clock",
    数: "digit_8",
    龙: "dragon",
    云: "blob",
    心: "blob",
    猫: "cat",
    鹤: "crane",
    月: "blob",
    星: "blob",
    兔: "rabbit",
    狐: "fox",
    颜: "kao_joy",
    笑: "kao_joy",
    汗: "kao_sweat",
    囧: "kao_sweat",
    巨: "mega",
    傅: "fourier",
    蔷: "rose",
    纽: "lemniscate",
    秒: "chrono",
  };

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
  // 把绘制好的不透明像素均匀抽 N 个作为目标点（步长 1 更密）
  function sampleSilhouette(drawFn, S, count) {
    const cap = 280;
    const sampleS = Math.min(Math.round(S), cap);
    const scale = sampleS / S;
    const c = document.createElement("canvas");
    c.width = sampleS;
    c.height = sampleS;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, sampleS, sampleS);
    ctx.save();
    ctx.scale(scale, scale);
    drawFn(ctx, S);
    ctx.restore();
    const img = ctx.getImageData(0, 0, sampleS, sampleS).data;

    const px = [];
    for (let y = 0; y < sampleS; y += 1) {
      for (let x = 0; x < sampleS; x += 1) {
        if (img[(y * sampleS + x) * 4 + 3] > 128) px.push(x, y);
      }
    }
    if (px.length === 0) return [];

    const total = px.length / 2;
    const step = Math.max(1, Math.floor(total / count));
    const points = [];
    const off = sampleS / 2;
    for (let i = 0; i < total && points.length < count; i += step) {
      const jitter = () => (Math.random() - 0.5) * 0.22;
      points.push({
        x: (px[i * 2] - off) / scale + jitter(),
        y: (px[i * 2 + 1] - off) / scale + jitter(),
      });
    }
    while (points.length < count) {
      const p = points[points.length % Math.max(1, points.length)] || { x: 0, y: 0 };
      points.push({ x: p.x + rand(-2, 2), y: p.y + rand(-2, 2) });
    }
    return points.slice(0, count);
  }

  /** 与剪影相同的缩放栅格，用于轮廓内可走判定（alpha > 128） */
  function rasterizeMask(drawFn, S) {
    const cap = 280;
    const sampleS = Math.min(Math.round(S), cap);
    const scale = sampleS / S;
    const c = document.createElement("canvas");
    c.width = sampleS;
    c.height = sampleS;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, sampleS, sampleS);
    ctx.save();
    ctx.scale(scale, scale);
    drawFn(ctx, S);
    ctx.restore();
    const img = ctx.getImageData(0, 0, sampleS, sampleS).data;
    const grid = new Uint8Array(sampleS * sampleS);
    for (let i = 0; i < sampleS * sampleS; i++) {
      grid[i] = img[i * 4 + 3] > 128 ? 1 : 0;
    }
    return { grid, w: sampleS, h: sampleS, scale };
  }

  function maskLocalWalkable(maskPack, lx, ly, flip) {
    if (!maskPack || !maskPack.grid) return true;
    const lxu = lx * (flip || 1);
    const xi = Math.round(lxu * maskPack.scale + maskPack.w * 0.5);
    const yi = Math.round(ly * maskPack.scale + maskPack.h * 0.5);
    if (xi < 0 || yi < 0 || xi >= maskPack.w || yi >= maskPack.h) return false;
    return maskPack.grid[yi * maskPack.w + xi] === 1;
  }

  /** 将局部偏移拉回可走区域：螺旋搜索邻域 */
  function clampLocalToMask(maskPack, lx, ly, flip, maxR = 14) {
    if (!maskPack || !maskPack.grid) return { lx, ly };
    if (maskLocalWalkable(maskPack, lx, ly, flip)) return { lx, ly };
    const step = 1 / Math.max(maskPack.scale, 0.001);
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = lx + dx * step * 3;
          const ny = ly + dy * step * 3;
          if (maskLocalWalkable(maskPack, nx, ny, flip)) return { lx: nx, ly: ny };
        }
      }
    }
    return { lx, ly };
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

  /** 沿闭合轮廓均匀取点（曲线类形态保持可辨，避免随机填充打散） */
  function samplesOnOutlineLoop(outline, n, jitter) {
    const L = outline.length;
    if (!L || n < 1) return [];
    const out = [];
    const jt = jitter || 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.min(L - 1, Math.floor((i * L) / Math.max(n, 1)));
      const p = outline[idx];
      out.push({
        x: p.x + rand(-jt, jt),
        y: p.y + rand(-jt, jt),
      });
    }
    return out;
  }

  /** 低阶傅里叶闭合轮廓（类「视频关键帧」平滑有机外形，系数由 seed 固定） */
  function seededFourierCoeffs(seedStr) {
    let s = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
      s ^= seedStr.charCodeAt(i);
      s = Math.imul(s, 16777619);
    }
    const rnd = () => {
      s = (Math.imul(s, 48271) + 11) >>> 0;
      return (s & 0xfffffff) / 0x10000000;
    };
    const ax = [];
    const bx = [];
    const ay = [];
    const by = [];
    for (let k = 0; k < 5; k++) {
      const kk = k + 2;
      const inv = 1 / kk;
      ax.push((rnd() - 0.5) * 1.05 * inv);
      bx.push((rnd() - 0.5) * 1.05 * inv);
      ay.push((rnd() - 0.5) * 1.05 * inv);
      by.push((rnd() - 0.5) * 1.05 * inv);
    }
    const R = 0.92 + rnd() * 0.38;
    return { ax, bx, ay, by, R };
  }

  function fourierXY(t, cf, rm) {
    let x = cf.R * rm * Math.cos(t);
    let y = cf.R * rm * Math.sin(t);
    for (let i = 0; i < cf.ax.length; i++) {
      const k = i + 2;
      x += (cf.ax[i] * Math.cos(k * t) + cf.bx[i] * Math.sin(k * t)) * rm;
      y += (cf.ay[i] * Math.cos(k * t) + cf.by[i] * Math.sin(k * t)) * rm;
    }
    return { x, y };
  }

  const FONT_SILHOUETTE_SERIF =
    '"LXGW WenKai","LXGW WenKai Screen","Noto Serif SC","Noto Sans SC",serif';
  const FONT_SILHOUETTE_MONO =
    'ui-monospace,"Cascadia Code","SFMono-Regular","Consolas","Liberation Mono",monospace';
  /** 颜文字：混排符号，不用纯等宽，避免缺字形 */
  const FONT_SILHOUETTE_KAO =
    '"LXGW WenKai","Noto Sans SC","Noto Sans CJK SC","Segoe UI Symbol",sans-serif';

  /**
   * 小字粒子铺满任意字符串的笔画轮廓（与 sampleSilhouette 同源栅格采样）。
   * opts.kao：颜文字专用字体栈；否则无 CJK 时用等宽（数字/ASCII），有汉字用-serif。
   */
  function buildTextSilhouetteLayout(raw, n, S, opts) {
    const text = String(raw || "字").trim() || "字";
    const kao = opts && opts.kao;
    const forceMono = opts && opts.mono;
    const hasHan = /[\u3400-\u9fff\uf900-\ufadf]/.test(text);
    const fontStack = kao
      ? FONT_SILHOUETTE_KAO
      : forceMono || !hasHan
        ? FONT_SILHOUETTE_MONO
        : FONT_SILHOUETTE_SERIF;

    const draw = (ctx, s) => {
      ctx.fillStyle = "#000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let fs = s * 0.52;
      const maxW = s * 0.9;
      for (let iter = 0; iter < 22; iter++) {
        ctx.font = `700 ${fs}px ${fontStack}`;
        const w = ctx.measureText(text).width;
        if (w <= maxW && fs <= s * 0.58) break;
        fs *= 0.9;
      }
      fs = Math.max(fs, s * 0.055);
      ctx.font = `700 ${fs}px ${fontStack}`;
      ctx.fillText(text, s * 0.5, s * 0.52);
    };
    const targets = sampleSilhouette(draw, S, n);
    return {
      targets,
      ordered: true,
      eyes: [
        { x: -S * 0.12, y: -S * 0.3 },
        { x: S * 0.12, y: -S * 0.3 },
      ],
      eyeSize: 1,
      maskDraw: draw,
    };
  }

  function glyphUsesEmojiFont(str) {
    if (!str || !str.length) return false;
    const cp = str.codePointAt(0);
    return (
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x2300 && cp <= 0x23ff)
    );
  }

  /** 5×7 点阵数字（计时 / 数字形态用） */
  function digitPattern5x7(d) {
    const p = {
      0: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
      1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
      2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
      3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
      4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
      5: ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
      6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
      7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
      8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
      9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    };
    return p[d] || p[0];
  }

  function mergeDigitRows(leftRows, gapCols, rightRows) {
    const g = ".".repeat(gapCols);
    return leftRows.map((row, i) => row + g + (rightRows[i] || ""));
  }

  /** 纵向拼接两块点阵（用于时分 + 秒） */
  function padDigitRow(row, width, ch = ".") {
    if (row.length >= width) return row.slice(0, width);
    const padL = Math.floor((width - row.length) / 2);
    const padR = width - row.length - padL;
    return ch.repeat(padL) + row + ch.repeat(padR);
  }

  function stackDigitRowBlocks(topRows, bottomRows, gapRows = 2) {
    const w = Math.max(
      ...topRows.map((r) => r.length),
      ...bottomRows.map((r) => r.length)
    );
    const top = topRows.map((r) => padDigitRow(r, w));
    const bot = bottomRows.map((r) => padDigitRow(r, w));
    const gap = Array(gapRows).fill(".".repeat(w));
    return [...top, ...gap, ...bot];
  }

  function rowsToTargets(rows, cell, n, jitter = 0.12) {
    const h = rows.length;
    const w = rows[0] ? rows[0].length : 0;
    const pts = [];
    for (let y = 0; y < h; y++) {
      const row = rows[y] || "";
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === "1") {
          pts.push({
            x: (x - w / 2 + 0.5) * cell,
            y: (y - h / 2 + 0.5) * cell,
          });
        }
      }
    }
    if (pts.length === 0) {
      return Array.from({ length: n }, () => ({ x: 0, y: 0 }));
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i % pts.length];
      out.push({
        x: p.x + rand(-cell * jitter, cell * jitter),
        y: p.y + rand(-cell * jitter, cell * jitter),
      });
    }
    return out;
  }

  function colonRows() {
    const dot = ".....1.....";
    const emp = "...........";
    return [dot, dot, emp, dot, dot, emp, emp];
  }

  function countScriptSlotsFromLines(lines) {
    const cleaned = (lines || []).map((l) => String(l || "").trim()).filter(Boolean);
    if (!cleaned.length) return 0;
    let n = 0;
    for (const line of cleaned) {
      n += Array.from(line).length;
    }
    return Math.max(n, 1);
  }

  /**
   * 文稿形态：每个可见字符对应唯一格子；仅当 n > 字数时整段向下复制新块，绝不叠在同一格。
   */
  function buildScriptLayout(lines, n, S) {
    const cleaned = (lines || []).map((l) => String(l || "").trim()).filter(Boolean);
    const useLines = cleaned.length ? cleaned : ["山色有无中", "江流天地外", "云霞出海曙"];
    const cell = clamp(Math.round(S * 0.048), 12, 24);
    const slots = [];
    let flat = "";
    for (let li = 0; li < useLines.length; li++) {
      const chs = Array.from(useLines[li]);
      flat += useLines[li];
      const rowY = (li - (useLines.length - 1) / 2) * cell * 1.38;
      const w = chs.length;
      for (let i = 0; i < chs.length; i++) {
        slots.push({
          x: (i - (w - 1) / 2) * cell,
          y: rowY,
        });
      }
    }
    const L = slots.length;
    const targets = [];
    if (L === 0) {
      for (let i = 0; i < Math.max(1, n); i++) {
        targets.push({ x: 0, y: 0 });
      }
      return { targets, maskDraw: () => {}, flat: "", ordered: true };
    }
    const rowSpan =
      useLines.length > 1
        ? (useLines.length - 1) * cell * 1.38 + cell
        : cell * 1.38;
    const blockDy = rowSpan + cell * 0.42;
    for (let k = 0; k < n; k++) {
      const block = Math.floor(k / L);
      const j = k % L;
      const p = slots[j];
      targets.push({
        x: p.x,
        y: p.y + block * blockDy,
      });
    }
    const maskDraw = (ctx, s) => {
      const sc = Math.min(Math.round(s), 280);
      const c = cell * (sc / s);
      ctx.fillStyle = "#000";
      for (let li = 0; li < useLines.length; li++) {
        const chs = Array.from(useLines[li]);
        const cy = s * 0.5 + (li - (useLines.length - 1) / 2) * c * 1.38;
        for (let i = 0; i < chs.length; i++) {
          const cx = s * 0.5 + (i - (chs.length - 1) / 2) * c;
          ctx.fillRect(cx - c * 0.48, cy - c * 0.48, c * 0.96, c * 0.96);
        }
      }
    };
    return { targets, maskDraw, flat, ordered: true };
  }

  // ---------- 形态库 ---------- //
  // 每个形态：{ label, build(count, S) -> {targets: [{x,y}], eyes: [{x,y},{x,y}], faceDir } }
  const FORMS = {
    blob: {
      label: "软团",
      build(n, S) {
        const R = S * 0.34;
        const outline = [];
        for (let j = 0; j < 140; j++) {
          const t = (j / 140) * TAU;
          const wob = 1 + 0.06 * Math.sin(t * 3) + 0.04 * Math.sin(t * 5 + 1.1);
          outline.push({
            x: Math.cos(t) * R * wob,
            y: Math.sin(t) * R * wob * 0.9,
          });
        }
        const targets = samplesOnOutlineLoop(outline, n, S * 0.014);
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -R * 0.32, y: -R * 0.1 },
            { x: R * 0.32, y: -R * 0.1 },
          ],
          eyeSize: 1.5,
          maskDraw: (ctx, s) => {
            ctx.fillStyle = "#000";
            ctx.beginPath();
            const cx = s / 2;
            const cy = s / 2;
            for (let j = 0; j <= 140; j++) {
              const t = (j / 140) * TAU;
              const wob = 1 + 0.06 * Math.sin(t * 3) + 0.04 * Math.sin(t * 5 + 1.1);
              const rr = s * 0.34 * wob;
              const x = cx + Math.cos(t) * rr;
              const y = cy + Math.sin(t) * rr * 0.9;
              if (j === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
          },
        };
      },
    },

    cat: {
      label: "猫",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          const cx = s * 0.5;
          const cy = s * 0.52;
          // 蹲坐躯干 + 后腿
          ctx.beginPath();
          ctx.ellipse(cx + s * 0.02, cy + s * 0.12, s * 0.26, s * 0.16, 0.08, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cx - s * 0.18, cy + s * 0.2, s * 0.1, s * 0.07, -0.2, 0, TAU);
          ctx.ellipse(cx + s * 0.22, cy + s * 0.2, s * 0.1, s * 0.07, 0.2, 0, TAU);
          ctx.fill();
          // 前肢
          ctx.beginPath();
          ctx.ellipse(cx - s * 0.12, cy + s * 0.22, s * 0.06, s * 0.11, 0.3, 0, TAU);
          ctx.ellipse(cx + s * 0.14, cy + s * 0.22, s * 0.06, s * 0.11, -0.3, 0, TAU);
          ctx.fill();
          // 头
          ctx.beginPath();
          ctx.arc(cx, cy - s * 0.08, s * 0.2, 0, TAU);
          ctx.fill();
          // 双耳
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.16, cy - s * 0.18);
          ctx.lineTo(cx - s * 0.22, cy - s * 0.32);
          ctx.lineTo(cx - s * 0.06, cy - s * 0.22);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx + s * 0.16, cy - s * 0.18);
          ctx.lineTo(cx + s * 0.22, cy - s * 0.32);
          ctx.lineTo(cx + s * 0.06, cy - s * 0.22);
          ctx.closePath();
          ctx.fill();
          // 尾
          ctx.beginPath();
          ctx.moveTo(cx + s * 0.22, cy + s * 0.06);
          ctx.quadraticCurveTo(cx + s * 0.42, cy - s * 0.02, cx + s * 0.38, cy - s * 0.18);
          ctx.quadraticCurveTo(cx + s * 0.32, cy + s * 0.02, cx + s * 0.18, cy + s * 0.1);
          ctx.closePath();
          ctx.fill();
        }, S, n);
        const R = S * 0.2;
        return {
          targets,
          eyes: [
            { x: -R * 0.55, y: -R * 0.85 },
            { x: R * 0.55, y: -R * 0.85 },
          ],
          eyeSize: 1.55,
        };
      },
    },

    fox: {
      label: "狐",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          const cx = s * 0.48;
          const cy = s * 0.5;
          ctx.beginPath();
          ctx.ellipse(cx, cy + s * 0.14, s * 0.24, s * 0.15, 0.05, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cx - s * 0.08, cy - s * 0.06, s * 0.2, s * 0.19, 0, 0, TAU);
          ctx.fill();
          // 尖吻
          ctx.beginPath();
          ctx.moveTo(cx + s * 0.12, cy + s * 0.02);
          ctx.lineTo(cx + s * 0.28, cy + s * 0.06);
          ctx.lineTo(cx + s * 0.14, cy + s * 0.1);
          ctx.closePath();
          ctx.fill();
          // 大尾
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.18, cy + s * 0.12);
          ctx.quadraticCurveTo(cx - s * 0.42, cy - s * 0.08, cx - s * 0.28, cy - s * 0.22);
          ctx.quadraticCurveTo(cx - s * 0.15, cy + s * 0.02, cx - s * 0.05, cy + s * 0.08);
          ctx.closePath();
          ctx.fill();
          // 耳
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.12, cy - s * 0.18);
          ctx.lineTo(cx - s * 0.2, cy - s * 0.34);
          ctx.lineTo(cx - s * 0.04, cy - s * 0.22);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx + s * 0.08, cy - s * 0.2);
          ctx.lineTo(cx + s * 0.14, cy - s * 0.36);
          ctx.lineTo(cx + s * 0.02, cy - s * 0.24);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cx - s * 0.16, cy + s * 0.22, s * 0.06, s * 0.1, 0.35, 0, TAU);
          ctx.ellipse(cx + s * 0.12, cy + s * 0.22, s * 0.06, s * 0.1, -0.35, 0, TAU);
          ctx.fill();
        }, S, n);
        const R = S * 0.2;
        return {
          targets,
          eyes: [
            { x: -R * 0.25, y: -R * 0.55 },
            { x: R * 0.15, y: -R * 0.52 },
          ],
          eyeSize: 1.45,
        };
      },
    },

    rabbit: {
      label: "兔",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          const cx = s * 0.5;
          const cy = s * 0.52;
          ctx.beginPath();
          ctx.ellipse(cx, cy + s * 0.12, s * 0.22, s * 0.14, 0, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, cy - s * 0.02, s * 0.18, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cx - s * 0.1, cy - s * 0.32, s * 0.055, s * 0.22, -0.12, 0, TAU);
          ctx.ellipse(cx + s * 0.1, cy - s * 0.32, s * 0.055, s * 0.22, 0.12, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cx - s * 0.14, cy + s * 0.22, s * 0.07, s * 0.05, 0.2, 0, TAU);
          ctx.ellipse(cx + s * 0.14, cy + s * 0.22, s * 0.07, s * 0.05, -0.2, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cx, cy + s * 0.06, s * 0.04, s * 0.06, 0, 0, TAU);
          ctx.fill();
        }, S, n);
        const R = S * 0.18;
        return {
          targets,
          eyes: [
            { x: -R * 0.6, y: -R * 0.35 },
            { x: R * 0.6, y: -R * 0.35 },
          ],
          eyeSize: 1.55,
        };
      },
    },

    dragon: {
      label: "飞龙",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          const cx = s * 0.46;
          const cy = s * 0.48;
          // 胸腹
          ctx.beginPath();
          ctx.ellipse(cx - s * 0.02, cy + s * 0.06, s * 0.2, s * 0.14, -0.15, 0, TAU);
          ctx.fill();
          // 长颈抬头
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.12, cy - s * 0.02);
          ctx.quadraticCurveTo(cx - s * 0.22, cy - s * 0.22, cx - s * 0.08, cy - s * 0.38);
          ctx.quadraticCurveTo(cx + s * 0.02, cy - s * 0.34, cx - s * 0.02, cy - s * 0.12);
          ctx.quadraticCurveTo(cx + s * 0.06, cy + s * 0.02, cx - s * 0.02, cy + s * 0.1);
          ctx.closePath();
          ctx.fill();
          // 头与吻
          ctx.beginPath();
          ctx.ellipse(cx - s * 0.06, cy - s * 0.4, s * 0.1, s * 0.07, 0.35, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx + s * 0.02, cy - s * 0.38);
          ctx.lineTo(cx + s * 0.16, cy - s * 0.36);
          ctx.lineTo(cx + s * 0.06, cy - s * 0.32);
          ctx.closePath();
          ctx.fill();
          // 双翼（三角帆）
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.08, cy + s * 0.02);
          ctx.lineTo(cx - s * 0.42, cy - s * 0.28);
          ctx.lineTo(cx - s * 0.18, cy + s * 0.08);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx + s * 0.06, cy + s * 0.04);
          ctx.lineTo(cx + s * 0.38, cy - s * 0.2);
          ctx.lineTo(cx + s * 0.12, cy + s * 0.12);
          ctx.closePath();
          ctx.fill();
          // 长尾
          ctx.beginPath();
          ctx.moveTo(cx + s * 0.08, cy + s * 0.12);
          ctx.quadraticCurveTo(cx + s * 0.38, cy + s * 0.28, cx + s * 0.42, cy + s * 0.42);
          ctx.lineTo(cx + s * 0.32, cy + s * 0.38);
          ctx.quadraticCurveTo(cx + s * 0.2, cy + s * 0.22, cx + s * 0.02, cy + s * 0.14);
          ctx.closePath();
          ctx.fill();
          // 后腿
          ctx.beginPath();
          ctx.ellipse(cx - s * 0.06, cy + s * 0.2, s * 0.05, s * 0.1, 0.4, 0, TAU);
          ctx.fill();
        }, S, n);
        const hx = -S * 0.06;
        const hy = -S * 0.4;
        return {
          targets,
          eyes: [
            { x: hx - S * 0.04, y: hy - S * 0.02 },
            { x: hx + S * 0.02, y: hy - S * 0.02 },
          ],
          eyeSize: 1.35,
        };
      },
    },

    /** 鹤：全身站姿剪影 */
    crane: {
      label: "鹤",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          const cx = s * 0.48;
          const cy = s * 0.55;
          // 身
          ctx.beginPath();
          ctx.ellipse(cx + s * 0.06, cy + s * 0.06, s * 0.2, s * 0.12, -0.2, 0, TAU);
          ctx.fill();
          // 长腿
          ctx.fillRect(cx - s * 0.02, cy + s * 0.14, s * 0.04, s * 0.22);
          ctx.fillRect(cx + s * 0.06, cy + s * 0.14, s * 0.04, s * 0.22);
          // 颈与头
          ctx.beginPath();
          ctx.moveTo(cx + s * 0.02, cy - s * 0.02);
          ctx.quadraticCurveTo(cx - s * 0.08, cy - s * 0.28, cx - s * 0.02, cy - s * 0.44);
          ctx.quadraticCurveTo(cx + s * 0.06, cy - s * 0.4, cx + s * 0.04, cy - s * 0.2);
          ctx.quadraticCurveTo(cx + s * 0.06, cy + s * 0.02, cx + s * 0.12, cy + s * 0.04);
          ctx.closePath();
          ctx.fill();
          // 翅
          ctx.beginPath();
          ctx.moveTo(cx + s * 0.04, cy + s * 0.02);
          ctx.quadraticCurveTo(cx + s * 0.36, cy - s * 0.12, cx + s * 0.32, cy + s * 0.12);
          ctx.lineTo(cx + s * 0.1, cy + s * 0.08);
          ctx.closePath();
          ctx.fill();
        }, S, n);
        const R = S * 0.2;
        return {
          targets,
          eyes: [
            { x: -R * 0.35, y: -R * 1.35 },
            { x: -R * 0.2, y: -R * 1.32 },
          ],
          eyeSize: 1.2,
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

    /** 颜文字：小字沿轮廓排布（与巨字同源采样） */
    kao_joy: {
      label: "颜·喜",
      build(n, S) {
        return buildTextSilhouetteLayout("(´∀`)", n, S, { kao: true });
      },
    },
    kao_sweat: {
      label: "颜·汗",
      build(n, S) {
        return buildTextSilhouetteLayout("(；´д`)", n, S, { kao: true });
      },
    },
    kao_cool: {
      label: "颜·呆",
      build(n, S) {
        return buildTextSilhouetteLayout("(￣▽￣)", n, S, { kao: true });
      },
    },

    clock: {
      label: "计时",
      build(n, S) {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        const r1 = mergeDigitRows(digitPattern5x7(hh[0]), 1, digitPattern5x7(hh[1]));
        const rMid = mergeDigitRows(r1, 1, colonRows());
        const rows = mergeDigitRows(
          rMid,
          1,
          mergeDigitRows(digitPattern5x7(mm[0]), 1, digitPattern5x7(mm[1]))
        );
        const cell = S * 0.042;
        const targets = rowsToTargets(rows, cell, n, 0.035);
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -S * 0.25, y: -S * 0.32 },
            { x: S * 0.25, y: -S * 0.32 },
          ],
          eyeSize: 1,
        };
      },
    },

    /** 预设文稿：整齐行列；用于开场展示，mask 为字格矩形并集 */
    script: {
      label: "文稿",
      build(n, S) {
        const b = buildScriptLayout(null, n, S);
        return {
          targets: b.targets,
          ordered: b.ordered,
          eyes: [
            { x: -S * 0.14, y: -S * 0.32 },
            { x: S * 0.14, y: -S * 0.32 },
          ],
          eyeSize: 1,
          maskDraw: b.maskDraw,
        };
      },
    },

    /** 李萨如曲线：粒子沿曲线顺序排布，名实一致 */
    lissajous: {
      label: "李萨如",
      build(n, S) {
        const a = 3;
        const b = 2;
        const R = S * 0.34;
        const targets = [];
        for (let i = 0; i < n; i++) {
          const u = (i / Math.max(n, 1)) * TAU * 2;
          targets.push({
            x: Math.sin(a * u) * R,
            y: Math.sin(b * u + 0.7) * R * 0.92,
          });
        }
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -S * 0.1, y: -S * 0.22 },
            { x: S * 0.1, y: -S * 0.22 },
          ],
          eyeSize: 1.25,
          maskDraw: (ctx, s) => {
            ctx.strokeStyle = "#000";
            ctx.lineWidth = s * 0.1;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            const cx = s * 0.5;
            const cy = s * 0.52;
            const Rm = s * 0.34;
            for (let k = 0; k <= 280; k++) {
              const u = (k / 280) * TAU * 2;
              const x = cx + Math.sin(a * u) * Rm;
              const y = cy + Math.sin(b * u + 0.7) * Rm * 0.92;
              if (k === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          },
        };
      },
    },

    /** 内旋轮线：顺序沿轨迹排布 */
    spiro: {
      label: "旋迹",
      build(n, S) {
        const Rm = S * 0.22;
        const r = S * 0.078;
        const h = S * 0.095;
        const targets = [];
        for (let i = 0; i < n; i++) {
          const t = (i / Math.max(n, 1)) * TAU * 3;
          const x = (Rm - r) * Math.cos(t) + h * Math.cos(((Rm - r) / r) * t);
          const y = (Rm - r) * Math.sin(t) - h * Math.sin(((Rm - r) / r) * t);
          targets.push({
            x,
            y: y * 0.92,
          });
        }
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -S * 0.08, y: -S * 0.2 },
            { x: S * 0.08, y: -S * 0.2 },
          ],
          eyeSize: 1.2,
          maskDraw: (ctx, s) => {
            ctx.strokeStyle = "#000";
            ctx.lineWidth = s * 0.085;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            const cx = s * 0.5;
            const cy = s * 0.52;
            const Rk = s * 0.22;
            const rk = s * 0.078;
            const hk = s * 0.095;
            for (let k = 0; k <= 720; k++) {
              const t = (k / 720) * TAU * 3;
              const x =
                cx +
                (Rk - rk) * Math.cos(t) +
                hk * Math.cos(((Rk - rk) / rk) * t);
              const y =
                cy +
                (Rk - rk) * Math.sin(t) -
                hk * Math.sin(((Rk - rk) / rk) * t);
              if (k === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          },
        };
      },
    },

    /** 分秒刷新：在 clock 基础上增加两位秒（点阵） */
    chrono: {
      label: "时分秒",
      build(n, S) {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        const r1 = mergeDigitRows(digitPattern5x7(hh[0]), 1, digitPattern5x7(hh[1]));
        const rMid = mergeDigitRows(r1, 1, colonRows());
        const rowHM = mergeDigitRows(
          rMid,
          1,
          mergeDigitRows(digitPattern5x7(mm[0]), 1, digitPattern5x7(mm[1]))
        );
        const rowSec = mergeDigitRows(digitPattern5x7(ss[0]), 1, digitPattern5x7(ss[1]));
        const rows = stackDigitRowBlocks(rowHM, rowSec, 2);
        const cell = S * 0.032;
        const targets = rowsToTargets(rows, cell, n, 0.032);
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -S * 0.22, y: -S * 0.36 },
            { x: S * 0.22, y: -S * 0.36 },
          ],
          eyeSize: 0.92,
        };
      },
    },

    /** 小字铺满大字笔画；字符串由 macroText / macroChar / 文稿首字 决定（见 buildFormLayoutData） */
    mega: {
      label: "巨字",
      build(n, S) {
        return buildTextSilhouetteLayout("字", n, S, {});
      },
    },

    /** 低阶傅里叶闭合曲线：类运动捕捉平滑轮廓 */
    fourier: {
      label: "傅里叶形",
      build(n, S) {
        const cf = seededFourierCoeffs("fourier-v3");
        const rm = S * 0.29;
        const outline = [];
        const steps = 520;
        for (let j = 0; j < steps; j++) {
          const t = (j / steps) * TAU;
          outline.push(fourierXY(t, cf, rm));
        }
        const targets = samplesOnOutlineLoop(outline, n, S * 0.012);
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -S * 0.12, y: -S * 0.26 },
            { x: S * 0.12, y: -S * 0.26 },
          ],
          eyeSize: 1.15,
          maskDraw: (ctx, s) => {
            const cfx = seededFourierCoeffs("fourier-v3");
            const rmm = s * 0.29;
            ctx.fillStyle = "#000";
            ctx.beginPath();
            for (let j = 0; j <= steps; j++) {
              const t = (j / steps) * TAU;
              const p = fourierXY(t, cfx, rmm);
              const x = s * 0.5 + p.x;
              const y = s * 0.52 + p.y;
              if (j === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
          },
        };
      },
    },

    /** 玫瑰线 r=cos(kθ) 填充 */
    rose: {
      label: "蔷薇线",
      build(n, S) {
        const k = 5;
        const R = S * 0.34;
        const outline = [];
        const steps = 480;
        for (let j = 0; j < steps; j++) {
          const t = (j / steps) * TAU;
          const rk = R * Math.cos(k * t);
          outline.push({
            x: rk * Math.cos(t),
            y: rk * Math.sin(t) * 0.92,
          });
        }
        const targets = samplesOnOutlineLoop(outline, n, S * 0.012);
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -S * 0.1, y: -S * 0.22 },
            { x: S * 0.1, y: -S * 0.22 },
          ],
          eyeSize: 1.2,
          maskDraw: (ctx, s) => {
            const Rm = s * 0.34;
            ctx.fillStyle = "#000";
            ctx.beginPath();
            for (let j = 0; j <= steps; j++) {
              const t = (j / steps) * TAU;
              const rk = Rm * Math.cos(k * t);
              const x = s * 0.5 + rk * Math.cos(t);
              const y = s * 0.52 + rk * Math.sin(t) * 0.92;
              if (j === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
          },
        };
      },
    },

    /** Gerono 8 字双纽线填充 */
    lemniscate: {
      label: "双纽线",
      build(n, S) {
        const a = S * 0.38;
        const outline = [];
        const steps = 560;
        for (let j = 0; j < steps; j++) {
          const t = (j / steps) * TAU;
          const st = Math.sin(t);
          const ct = Math.cos(t);
          outline.push({ x: a * st, y: a * st * ct * 0.88 });
        }
        const targets = samplesOnOutlineLoop(outline, n, S * 0.012);
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -S * 0.1, y: -S * 0.22 },
            { x: S * 0.1, y: -S * 0.22 },
          ],
          eyeSize: 1.15,
          maskDraw: (ctx, s) => {
            const aa = s * 0.38;
            ctx.fillStyle = "#000";
            ctx.beginPath();
            for (let j = 0; j <= steps; j++) {
              const t = (j / steps) * TAU;
              const st = Math.sin(t);
              const ct = Math.cos(t);
              const x = s * 0.5 + aa * st;
              const y = s * 0.52 + aa * st * ct * 0.88;
              if (j === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
          },
        };
      },
    },
  };

  for (let di = 0; di <= 9; di++) {
    const ds = String(di);
    FORMS[`digit_${di}`] = {
      label: `数字·${ds}`,
      build(n, S) {
        const cell = S * 0.058;
        const rows = digitPattern5x7(ds);
        const targets = rowsToTargets(rows, cell, n, 0.04);
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -S * 0.1, y: -S * 0.2 },
            { x: S * 0.1, y: -S * 0.2 },
          ],
          eyeSize: 1.05,
        };
      },
    };
  }

  /** 需严格保持目标几何的形态：关闭游走/波纹/赛璐璐叠层，并跳过「一格一字」螺旋挤占 */
  function isLayoutLockedForm(form) {
    if (!form) return false;
    if (form === "script" || form === "clock" || form === "chrono") return true;
    if (
      form === "lissajous" ||
      form === "spiro" ||
      form === "rose" ||
      form === "lemniscate" ||
      form === "fourier" ||
      form === "mega" ||
      form === "kao_joy" ||
      form === "kao_sweat" ||
      form === "kao_cool"
    )
      return true;
    if (String(form).startsWith("digit_")) return true;
    return false;
  }

  function buildFormLayoutData(self, name, n, S) {
    if (name === "script" && self.scriptLines && self.scriptLines.length) {
      const b = buildScriptLayout(self.scriptLines, n, S);
      return {
        targets: b.targets,
        ordered: true,
        eyes: [
          { x: -S * 0.14, y: -S * 0.32 },
          { x: S * 0.14, y: -S * 0.32 },
        ],
        eyeSize: 1,
        maskDraw: b.maskDraw,
      };
    }
    if (name === "mega") {
      return buildTextSilhouetteLayout(self._pickMacroDisplay(), n, S, {});
    }
    if (!FORMS[name]) return null;
    return FORMS[name].build(n, S);
  }

  const FORM_ORDER = [
    "blob",
    "dragon",
    "cat",
    "fox",
    "rabbit",
    "crane",
    "koi",
    "butterfly",
    "flower",
    "kao_joy",
    "kao_sweat",
    "kao_cool",
    "mega",
    "fourier",
    "rose",
    "lemniscate",
    "digit_8",
    "clock",
    "chrono",
    "lissajous",
    "spiro",
  ];

  // ---------- 表情（眼区由躯体内的「字层」呈现；此处供旧逻辑/色值参考） ---------- //
  const EXPRESSIONS = {
    normal: { color: "#1d1a15", eyeLeft: "·", eyeRight: "·", brow: "一" },
    happy: { color: "#7d2c21", eyeLeft: "⌒", eyeRight: "⌒", brow: "︶" },
    wink: { color: "#1d1a15", eyeLeft: "～", eyeRight: "·", brow: "一" },
    sleep: { color: "#6f6555", eyeLeft: "一", eyeRight: "一", brow: "～" },
    shy: { color: "#9c3a2d", eyeLeft: "﹀", eyeRight: "﹀", brow: "﹏" },
    surprised: { color: "#1d1a15", eyeLeft: "○", eyeRight: "○", brow: "！" },
    annoyed: { color: "#8b2a22", eyeLeft: "×", eyeRight: "×", brow: "﹏" },
  };

  /**
   * 卡通分层设色（参考 cel / toon：亮·中·暗分层 + 轮廓权重）
   */
  function celRgbFromGlyph(g, lightCanvas, tSec, articPhase) {
    const Sref = 320;
    const nx = clamp(g.tx / (Sref * 0.48), -1, 1);
    const ny = clamp(g.ty / (Sref * 0.48), -1, 1);
    const ndotl = clamp(0.5 + (-ny) * 0.42 + nx * 0.06, 0, 1);
    const rim = clamp((g.edge || 0) - 0.52, 0, 1);
    const breathe =
      0.5 +
      0.5 * Math.sin(tSec * 0.95 + (g.patrolSeed || 0) * 0.5 + (articPhase || 0) * 0.25);
    const band = clamp(ndotl + (breathe - 0.5) * 0.07 - rim * 0.14, 0, 1);

    const shadeRgb = (lit, mid, shd, outlineRgb) => {
      let r;
      let gg;
      let b;
      if (band > 0.58) {
        const w = (band - 0.58) / 0.42;
        r = lerp(mid[0], lit[0], w);
        gg = lerp(mid[1], lit[1], w);
        b = lerp(mid[2], lit[2], w);
      } else if (band > 0.28) {
        const w = (band - 0.28) / 0.3;
        r = lerp(shd[0], mid[0], w);
        gg = lerp(shd[1], mid[1], w);
        b = lerp(shd[2], mid[2], w);
      } else {
        const w = band / 0.28;
        r = lerp(shd[0] * 0.72, shd[0], w);
        gg = lerp(shd[1] * 0.72, shd[1], w);
        b = lerp(shd[2] * 0.72, shd[2], w);
      }
      const edgeMul = 0.42 + rim * 0.58;
      return { r, gg, b, outlineRgb, edgeMul };
    };

    if (lightCanvas) {
      return shadeRgb([52, 54, 58], [34, 36, 42], [22, 24, 30], [16, 17, 22]);
    }
    return shadeRgb([248, 250, 255], [195, 205, 235], [95, 115, 175], [18, 22, 38]);
  }

  // ---------- Pet 主类 ---------- //
  class Pet {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.DPR = Math.min(window.devicePixelRatio || 1, 3);
      this._pxScale = this.DPR;
      this.width = 0;
      this.height = 0;
      this.center = { x: 0, y: 0 };
      this.size = 320; // 身体参考尺寸 S

      this.particleCount = opts.particleCount || 160;
      this.pool = (opts.pool || DEFAULT_POOL).slice();
      this.eatenChars = []; // 吞下的字，会混入 pool
      /** 多次「写入躯体」累积队列，轮换贴到更多粒子上 */
      this.bodyCharQueue = [];
      this.bodyCharQueueMax = opts.bodyCharQueueMax != null ? opts.bodyCharQueueMax : 96;
      /** 已在字灵模式下吞食过的「已完成」行指纹（整行 trim），避免重复吸入 */
      this._scriptDigestSeen =
        typeof Set !== "undefined" ? new Set() : { add() {}, has() { return false; } };
      /** 计时形态刷新间隔（秒） */
      this.clockRefreshSec = opts.clockRefreshSec != null ? opts.clockRefreshSec : 30;
      this._lastClockTick = 0;
      this._clockMinuteSlot = -1;
      this._chronoSecondSlot = -1;
      this.macroChar = opts.macroChar || null;
      /** 巨字/数字完整字符串（优先于 macroChar 单字） */
      this.macroText =
        opts.macroText != null && String(opts.macroText).trim()
          ? String(opts.macroText).trim().slice(0, 48)
          : null;

      this.glyphs = [];
      this.eyes = [
        { x: 0, y: 0, tx: 0, ty: 0, size: 22, char: "◉" },
        { x: 0, y: 0, tx: 0, ty: 0, size: 22, char: "◉" },
      ];
      this.expression = "normal";
      /** 五官由字粒子承担，不再画 canvas 墨点眼 */
      this.faceLayerMode = opts.faceLayerMode !== false;

      this.form = "blob";
      this.formData = null;
      this.formStartTime = 0;
      /** 连续戳点累积，高时躯体躁动、表情烦躁 */
      this.annoyance = 0;
      this._savedFormBeforeAnnoyed = null;

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
      this._formBeforeFeed = null;

      /** 情绪字：部分粒子临时显示 MOOD_POOLS 中的字 */
      this._moodSwap = []; // { i, saved }
      this._moodUntil = 0;

      /** 隐形格：目标吸附到格点 */
      this.gridSnapping = opts.gridSnapping !== false;
      /** 活字栅：统一字号、离散倾角、像素对齐 */
      this.gridUnity = opts.gridUnity !== false;
      /** 液体感：仅轻波面（不拉对角「凝聚」，以免破坏纵横走位） */
      this.fluidStrength = opts.fluidStrength != null ? opts.fluidStrength : 0.2;
      this._fluidPhase = 0;
      /** 沿格子纵横**各自**平滑走位（曼哈顿路径），队形变换感 */
      this.gridMarch = opts.gridMarch !== false;
      /** 沿格线移动速度（格/秒） */
      this.gridMarchSpeed = opts.gridMarchSpeed != null ? opts.gridMarchSpeed : 2;

      /** 吞字后对形态的偏好（多字命中同一形会提高概率） */
      this.formDigestBias = {};
      this.formDigestBiasDecay = 0.12; // per second
      /** 全字冲击：全体非眉眼字暂时变成同一字 */
      this._unifiedSwap = [];
      this._unifiedUntil = 0;
      /** 格点抖动 / 闪烁强度 0..1 */
      this._rumbleAmp = 0;
      this._glyphFlash = 0;
      /** 换形后短促「落格」：弹簧略紧，字像落到格点上 */
      this._layoutSettle = 0;

      /** 每字独立「巡逻」相位：体内相对位置持续缓慢变化 */
      this.internalMotion = opts.internalMotion !== false;
      this._patrolAmp = opts.patrolAmp != null ? opts.patrolAmp : 1;

      /** intro=仅背景；script=整齐文稿；pet=字灵 */
      this.viewMode =
        opts.initialViewMode === "pet"
          ? "pet"
          : opts.initialViewMode === "script"
            ? "script"
            : opts.initialViewMode === "intro"
              ? "intro"
              : "intro";
      /** 文稿行（script / intro 切回用） */
      this.scriptLines = (opts.scriptLines || []).slice();
      /** 化为字灵后的默认形态 */
      this._petEntryForm =
        opts.petEntryForm && FORMS[opts.petEntryForm]
          ? opts.petEntryForm
          : opts.initialForm && FORMS[opts.initialForm]
            ? opts.initialForm
            : "blob";
      /** 轮廓内可走：栅格位图 + scale */
      this._maskPack = null;
      this._maskFormKey = "";
      this._maskSizeIdx = 0;
      /** 轮廓内游走（曼哈顿累积偏移）；none 关闭 */
      this.pathMode =
        opts.pathMode !== undefined ? opts.pathMode : "wander";
      this._nextWanderPick = 0;

      /** 拖拽：每字滞后锚点（有序中的乱） */
      this.dragLagEnabled = opts.dragLag !== false;
      this.dragVel = { x: 0, y: 0 };
      this._pendingScriptReturn = false;

      /** 渐进换形：逐字走向新形态目标，速度与日常格移同量级 */
      this.morphToKey = null;
      this.morphFinalMeta = null;
      this.morphGlyphToTarget = null;
      this.morphApplyQueue = null;
      this.morphApplyIdx = 0;
      this.morphStepAcc = 0;
      this._morphQueued = null;

      /** 浅色画布（与 App 式浅 UI 搭配） */
      this.lightCanvas = opts.lightCanvas !== false;

      this.emojiFontStack =
        opts.emojiFontStack ||
        '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

      this.onFormChange = typeof opts.onFormChange === "function" ? opts.onFormChange : null;
      this._resize = this._resize.bind(this);
      this._resize();
      window.addEventListener("resize", this._resize);
      this._roHost = this.canvas.parentElement || this.canvas;
      if (typeof ResizeObserver !== "undefined") {
        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(this._roHost);
      } else {
        this._ro = null;
      }

      this._initGlyphs();
      if (this.viewMode === "intro") {
        this.form = "blob";
        this.formData = null;
      } else if (this.viewMode === "script") {
        this.setForm("script", true);
      } else {
        const startKey =
          opts.initialForm && FORMS[opts.initialForm]
            ? opts.initialForm
            : this._petEntryForm;
        this.setForm(startKey);
      }

      this._lastTime = performance.now();
      this._raf = requestAnimationFrame(this._loop.bind(this));
      requestAnimationFrame(() => this._resize());
    }

    _resize() {
      const host = this.canvas.parentElement;
      let w = host ? Math.floor(host.clientWidth) : 0;
      let h = host ? Math.floor(host.clientHeight) : 0;
      if (!w || !h) {
        const rect = this.canvas.getBoundingClientRect();
        w = Math.floor(rect.width || this.canvas.clientWidth || 0);
        h = Math.floor(rect.height || this.canvas.clientHeight || 0);
      }
      if (!w || !h) {
        w = 320;
        h = 320;
      }
      w = Math.max(64, w);
      h = Math.max(64, h);

      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const bw = Math.max(1, Math.round(w * dpr));
      const bh = Math.max(1, Math.round(h * dpr));

      this.width = w;
      this.height = h;
      this.DPR = dpr;

      this.canvas.width = bw;
      this.canvas.height = bh;
      this.canvas.style.width = w + "px";
      this.canvas.style.height = h + "px";

      this.ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0);
      /** 逻辑坐标对齐到物理像素（canvas buffer 栅格），减轻亚像素发糊 */
      this._pxScale = bw / w;
      this.center = { x: this.width / 2, y: this.height / 2 };
      // 身体参考尺寸：按短边
      this.size = Math.min(this.width, this.height) * 0.9;
      // 格距过小会导致 em 只有 3～4px，字「存在但看不见」
      this.gridCell = clamp(Math.round(this.size * 0.03), 9, 14);
      if (this.form === "script") {
        this.gridCell = Math.max(this.gridCell, 11);
      }
      this.anchor = { x: this.center.x, y: this.center.y };
      if (this.viewMode === "script" || this.viewMode === "pet") {
        this.pos.x = this.center.x;
        this.pos.y = this.center.y;
        this.vel.x = 0;
        this.vel.y = 0;
      } else if (this.pos.x === 0 && this.pos.y === 0) {
        this.pos.x = this.center.x;
        this.pos.y = this.center.y;
      }
      // 重建当前形态（尺寸变了）
      if (this.formData) {
        if (this.morphGlyphToTarget) this._cancelMorph(false);
        this.setForm(this.form, true);
      }
    }

    _snapLogicalToDevice(v) {
      const r = this._pxScale || this.DPR || 1;
      return Math.round(v * r) / r;
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
          baseTx: 0,
          baseTy: 0,
          size: rand(10, 18),
          alpha: rand(0.65, 1),
          rot: rand(-0.3, 0.3),
          targetRot: 0,
          // 外圈字略模糊：给粒子一个"深度"参数
          depth: Math.random(),
          edge: 0.5,
          /** 拖拽滞后位置（世界坐标，追 pos） */
          lagX: 0,
          lagY: 0,
          lagVx: 0,
          lagVy: 0,
          lagK: 1,
          /** 轮廓内游走：相对锚点格的偏移（整数格） */
          wgx: 0,
          wgy: 0,
          wtgx: 0,
          wtgy: 0,
          wanderNextAt: 0,
          wanderRad: 10,
          /** 巡逻相位（每字不同） */
          patrolSeed: Math.random() * TAU,
          patrolAmpMul: 0.85 + Math.random() * 0.3,
        });
      }
    }

    setForm(name, silent, noEmitOnFormChange) {
      if (!FORMS[name]) return;
      if (this.morphGlyphToTarget) this._cancelMorph(false);
      if (name === "script") {
        this._resizeGlyphsForScript(this.scriptLines, { mode: "script" });
      }
      const S = this.size;
      const data = buildFormLayoutData(this, name, this.particleCount, S);
      if (!data || !data.targets || !data.targets.length) return;
      this.form = name;
      this.formStartTime = performance.now();
      if (name === "clock") this._clockMinuteSlot = -1;
      if (name === "chrono") this._chronoSecondSlot = -1;
      // 稳定分配
      const order = data.ordered
        ? data.targets
        : hashShuffle(data.targets, name.charCodeAt(0) + this.particleCount);

      // 估算目标点质心与最大半径，用来计算每个目标点的"深度"（0=中心、1=边缘）
      let cx = 0, cy = 0;
      for (const t of order) { cx += t.x; cy += t.y; }
      cx /= order.length; cy /= order.length;
      let maxD = 1;
      for (const t of order) {
        const d = Math.hypot(t.x - cx, t.y - cy);
        if (d > maxD) maxD = d;
      }

      for (let i = 0; i < this.glyphs.length; i++) {
        const t = order[i] || order[i % order.length];
        this.glyphs[i].tx = t.x;
        this.glyphs[i].ty = t.y;
        this.glyphs[i].baseTx = t.x;
        this.glyphs[i].baseTy = t.y;
        // 边缘字更小更淡，中心字更大更实（水墨"浓淡干湿"）
        const d = Math.hypot(t.x - cx, t.y - cy) / maxD; // 0..1
        this.glyphs[i].edge = d;
        this.glyphs[i].faceRole = null;
      }
      this._layoutSettle = 0.42;
      data.leftEyeSize = this.size * 0.05 * (data.eyeSize || 1.4);
      this.formData = data;
      this._cinnabarIdx = null; // 换形 → 重新挑朱砂字

      if (data.maskDraw) {
        this._maskPack = rasterizeMask(data.maskDraw, S);
        this._maskFormKey = name;
        this._maskSizeIdx = Math.round(S * 10);
      } else {
        this._maskPack = null;
        this._maskFormKey = "";
      }

      if (this.faceLayerMode && name !== "script") this._assignFaceGlyphs();
      this._applyEmojiPaletteIfNeeded();
      if (!(this.formData && this.formData.charPalette)) {
        this._reapplyBodyFromQueue();
      }
      if (name === "script") {
        this._syncGlyphsFromScriptLines();
      } else if (
        this.viewMode === "pet" &&
        this.scriptLines &&
        this.scriptLines.length &&
        !(this.formData && this.formData.charPalette)
      ) {
        this._syncGlyphsFromScriptLines();
      }
      if (this.gridSnapping) this._snapGlyphTargetsToGrid();
      this._resolveUniqueLocalGrid();
      this._applyGridTypography();
      if (this.gridMarch && this.gridSnapping) {
        const c = this.gridCell;
        for (const g of this.glyphs) {
          g.mgx = Math.round(g.x / c);
          g.mgy = Math.round(g.y / c);
          g.x = g.mgx * c;
          g.y = g.mgy * c;
          g.vx = 0;
          g.vy = 0;
        }
      }

      const cell = this.gridCell;
      const rot = this.rotation;
      const flip = this.facingFlip;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const bx = this.pos.x;
      const by = this.pos.y;
      const nowSec = performance.now() / 1000;
      for (let i = 0; i < this.glyphs.length; i++) {
        const g = this.glyphs[i];
        g.wgx = 0;
        g.wgy = 0;
        g.wtgx = 0;
        g.wtgy = 0;
        const ph = (g.patrolSeed || 0) * 13.7 + i * 1.73;
        g.lagK = 0.38 + (Math.sin(ph * 1.1) * 0.5 + 0.5) * 1.45;
        if (g.faceRole) g.lagK *= 0.52;
        g.lagX = bx;
        g.lagY = by;
        g.lagVx = 0;
        g.lagVy = 0;
        g.wanderNextAt = nowSec + rand(0.15, 0.9);
        const radBase = 8 + Math.floor((g.depth || 0.5) * 24);
        g.wanderRad = isLayoutLockedForm(name)
          ? clamp(radBase, 4, 11)
          : clamp(radBase, 12, 44);
        const txl = g.tx * flip;
        const tyl = g.ty;
        const wx = bx + (txl * cos - tyl * sin);
        const wy = by + (txl * sin + tyl * cos);
        g._anchorGx = Math.round(wx / cell);
        g._anchorGy = Math.round(wy / cell);
      }
      this._nextWanderPick = nowSec + 0.35;

      if (typeof this.onFormChange === "function" && !noEmitOnFormChange) {
        try {
          this.onFormChange(this.form);
        } catch (_) {}
      }
    }

    _resizeGlyphsForScript(lines, opts) {
      const mode = (opts && opts.mode) || "pet";
      const slotN = countScriptSlotsFromLines(lines);
      if (slotN < 1) return;
      let want;
      if (mode === "script") {
        want = clamp(slotN, 1, 420);
      } else {
        want = clamp(Math.round(slotN * 2), Math.max(120, slotN), 480);
      }
      if (want === this.glyphs.length) return;
      this.particleCount = want;
      this._initGlyphs();
    }

    /** 非眉眼粒子按 scriptLines 顺序循环赋字（文稿 / 字灵躯体一致） */
    _syncGlyphsFromScriptLines() {
      const lines =
        this.scriptLines && this.scriptLines.length
          ? this.scriptLines
          : [];
      if (!lines.length) return;
      const cleaned = lines.map((l) => String(l || "").trim()).filter(Boolean);
      if (!cleaned.length) return;
      const chars = [];
      for (const line of cleaned) {
        for (const ch of Array.from(line)) {
          chars.push(ch);
        }
      }
      if (!chars.length) return;
      const slots = this.glyphs.filter((g) => !g.faceRole);
      for (let i = 0; i < slots.length; i++) {
        slots[i].char = chars[i % chars.length];
      }
    }

    _applyScriptCharsFromLayout() {
      this._syncGlyphsFromScriptLines();
    }

    /**
     * 世界格心是否在剪影 mask 内（局部坐标检测）
     */
    _worldCellWalkable(gx, gy, bx, by, cos, sin, flip) {
      if (!this._maskPack || !this._maskPack.grid) return true;
      const cell = this.gridCell;
      const wx = gx * cell;
      const wy = gy * cell;
      const rdx = wx - bx;
      const rdy = wy - by;
      const txl = rdx * cos + rdy * sin;
      const tyl = -rdx * sin + rdy * cos;
      const lx = txl / flip;
      return maskLocalWalkable(this._maskPack, lx, tyl, flip);
    }

    _pickWanderDelta(g, bx, by, cos, sin, flip) {
      const cell = this.gridCell;
      const txl = g.tx * flip;
      const tyl = g.ty;
      const wxb = bx + (txl * cos - tyl * sin);
      const wyb = by + (txl * sin + tyl * cos);
      const anchorGx = Math.round(wxb / cell);
      const anchorGy = Math.round(wyb / cell);
      const rad = g.wanderRad || 14;
      for (let k = 0; k < 48; k++) {
        const ddx = Math.floor(rand(-rad, rad + 1));
        const ddy = Math.floor(rand(-rad, rad + 1));
        if (ddx * ddx + ddy * ddy > rad * rad) continue;
        const tgx = anchorGx + ddx;
        const tgy = anchorGy + ddy;
        if (this._worldCellWalkable(tgx, tgy, bx, by, cos, sin, flip)) {
          g.wtgx = ddx;
          g.wtgy = ddy;
          return;
        }
      }
      g.wtgx = 0;
      g.wtgy = 0;
    }

    _stepWanderToward(g) {
      if (g.wgx === g.wtgx && g.wgy === g.wtgy) return;
      const adx = g.wtgx - g.wgx;
      const ady = g.wtgy - g.wgy;
      if (Math.abs(adx) >= Math.abs(ady) && adx !== 0) {
        g.wgx += adx > 0 ? 1 : -1;
      } else if (ady !== 0) {
        g.wgy += ady > 0 ? 1 : -1;
      }
    }

    _pickMacroDisplay() {
      if (this.macroText && String(this.macroText).trim()) {
        return String(this.macroText).trim().slice(0, 48);
      }
      return this._pickMacroChar();
    }

    _pickMacroChar() {
      const raw = this.macroChar && String(this.macroChar).trim();
      if (raw) {
        const a = Array.from(raw);
        if (a.length) return a[0];
      }
      const lines = this.scriptLines || [];
      for (const line of lines) {
        for (const ch of Array.from(String(line || ""))) {
          if (ch.trim()) return ch;
        }
      }
      return "字";
    }

    setScriptLines(lines) {
      this.scriptLines = Array.isArray(lines)
        ? lines.map((l) => String(l || "").trim()).filter(Boolean)
        : [];
    }

    enterScriptMode(lines, silent) {
      this.viewMode = "script";
      if (lines && lines.length) this.setScriptLines(lines);
      this.pos.x = this.center.x;
      this.pos.y = this.center.y;
      this.vel.x = 0;
      this.vel.y = 0;
      this.anchor.x = this.center.x;
      this.anchor.y = this.center.y;
      this.setForm("script", silent, silent);
    }

    /** 字灵拖回：回到整齐文稿（沿用当前 scriptLines） */
    revertToScript(silent) {
      const lines =
        this.scriptLines && this.scriptLines.length
          ? this.scriptLines
          : ["山色有无中", "江流天地外", "云霞出海曙"];
      this.enterScriptMode(lines, silent);
    }

    awakenPet(preferredForm, silent) {
      const key =
        (preferredForm && FORMS[preferredForm] && preferredForm) ||
        this._petEntryForm ||
        "blob";
      this._resizeGlyphsForScript(this.scriptLines, { mode: "pet" });
      this.viewMode = "pet";
      this.pos.x = this.center.x;
      this.pos.y = this.center.y;
      this.vel.x = 0;
      this.vel.y = 0;
      this.anchor.x = this.center.x;
      this.anchor.y = this.center.y;
      this.setForm(key, silent, silent);
    }

    enterIntroMode(silent) {
      this.viewMode = "intro";
      if (this._scriptDigestSeen && this._scriptDigestSeen.clear) {
        this._scriptDigestSeen.clear();
      }
      this.abortFeeding();
      if (this.morphGlyphToTarget) this._cancelMorph(false);
      this.dragging = false;
      this._dragPrevPos = null;
      this.form = "blob";
      this.formData = null;
      for (const g of this.glyphs) {
        g.mgx = null;
        g.mgy = null;
        g.lagX = this.center.x;
        g.lagY = this.center.y;
        g.lagVx = 0;
        g.lagVy = 0;
        g.wgx = 0;
        g.wgy = 0;
        g.wtgx = 0;
        g.wtgy = 0;
      }
    }

    /**
     * 与 _resolveUniqueLocalGrid 相同逻辑，作用在传入的「伪 glyph」数组上（用于换形目标格计算）。
     */
    _resolveUniqueLocalGridFor(list) {
      if (!this.gridSnapping || !list || !list.length) return;
      const step = this.gridCell;
      const occupied = new Set();
      const keyOf = (gx, gy) => `${gx},${gy}`;
      const toCell = (x, y) => ({
        gx: Math.round(x / step),
        gy: Math.round(y / step),
      });
      const toLocal = (gx, gy) => ({ x: gx * step, y: gy * step });

      for (const g of list) {
        if (!g.faceRole) continue;
        const { gx, gy } = toCell(g.tx, g.ty);
        occupied.add(keyOf(gx, gy));
      }

      const spiral = (gx, gy) => {
        if (!occupied.has(keyOf(gx, gy))) return { nx: gx, ny: gy, k: keyOf(gx, gy) };
        for (let r = 1; r < 28; r++) {
          for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const nx = gx + dx;
              const ny = gy + dy;
              const k = keyOf(nx, ny);
              if (!occupied.has(k)) return { nx, ny, k };
            }
          }
        }
        return null;
      };

      for (const g of list) {
        if (g.faceRole) continue;
        let { gx, gy } = toCell(g.tx, g.ty);
        let k = keyOf(gx, gy);
        if (!occupied.has(k)) {
          occupied.add(k);
          const p = toLocal(gx, gy);
          g.tx = p.x;
          g.ty = p.y;
          g.baseTx = p.x;
          g.baseTy = p.y;
          continue;
        }
        const sp = spiral(gx, gy);
        if (sp) {
          occupied.add(sp.k);
          const p = toLocal(sp.nx, sp.ny);
          g.tx = p.x;
          g.ty = p.y;
          g.baseTx = p.x;
          g.baseTy = p.y;
        }
      }
    }

    /** 计算某形态下每字应落到的格坐标（不改变当前躯体） */
    _computeMorphGridTargets(name) {
      if (!FORMS[name]) return null;
      const S = this.size;
      const data = buildFormLayoutData(this, name, this.particleCount, S);
      if (!data || !data.targets || !data.targets.length) return null;
      const order = data.ordered
        ? data.targets
        : hashShuffle(data.targets, name.charCodeAt(0) + this.particleCount);

      let cx = 0, cy = 0;
      for (const t of order) { cx += t.x; cy += t.y; }
      cx /= order.length;
      cy /= order.length;
      let maxD = 1;
      for (const t of order) {
        const d = Math.hypot(t.x - cx, t.y - cy);
        if (d > maxD) maxD = d;
      }

      const step = this.gridCell;
      const snap = (v) => Math.round(v / step) * step;
      const list = [];
      for (let i = 0; i < this.glyphs.length; i++) {
        const t = order[i] || order[i % order.length];
        const d = Math.hypot(t.x - cx, t.y - cy) / maxD;
        list.push({
          tx: snap(t.x),
          ty: snap(t.y),
          baseTx: snap(t.x),
          baseTy: snap(t.y),
          faceRole: null,
          edge: d,
        });
      }

      if (this.faceLayerMode && data.eyes && data.eyes.length >= 2) {
        const [eL, eR] = data.eyes;
        const dist = (g, ex, ey) => Math.hypot(g.tx - ex, g.ty - ey);
        const pickNear = (ex, ey, exclude) => {
          let best = -1;
          let bestD = Infinity;
          for (let k = 0; k < list.length; k++) {
            if (exclude.has(k)) continue;
            const d = dist(list[k], ex, ey);
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
          return best;
        };
        const used = new Set();
        const iL = pickNear(eL.x, eL.y, used);
        if (iL >= 0) {
          used.add(iL);
          list[iL].faceRole = "eyeL";
        }
        const iR = pickNear(eR.x, eR.y, used);
        if (iR >= 0) {
          used.add(iR);
          list[iR].faceRole = "eyeR";
        }
        const mx = (eL.x + eR.x) * 0.5;
        const my = (eL.y + eR.y) * 0.5 - S * 0.035;
        const iB = pickNear(mx, my, used);
        if (iB >= 0) list[iB].faceRole = "brow";
        for (const g of list) {
          if (!g.faceRole) continue;
          const ex = g.faceRole === "eyeL" ? eL.x : g.faceRole === "eyeR" ? eR.x : mx;
          const ey = g.faceRole === "eyeL" ? eL.y : g.faceRole === "eyeR" ? eR.y : my;
          g.tx = snap(ex);
          g.ty = snap(ey);
          g.baseTx = g.tx;
          g.baseTy = g.ty;
        }
      }

      if (!isLayoutLockedForm(name)) {
        this._resolveUniqueLocalGridFor(list);
      }

      const bx = this.pos.x;
      const by = this.pos.y;
      const rot = this.rotation;
      const flip = this.facingFlip;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);

      return {
        key: name,
        data,
        targets: list.map((g) => {
          const txl = g.tx * flip;
          const tyl = g.ty;
          const wx = bx + (txl * cos - tyl * sin);
          const wy = by + (txl * sin + tyl * cos);
          const twx = Math.round(wx / step) * step;
          const twy = Math.round(wy / step) * step;
          return {
            twx,
            twy,
            edge: g.edge,
            faceRole: g.faceRole,
          };
        }),
      };
    }

    _cancelMorph(emit) {
      this.morphToKey = null;
      this.morphFinalMeta = null;
      this.morphGlyphToTarget = null;
      this.morphApplyQueue = null;
      this.morphApplyIdx = 0;
      this.morphStepAcc = 0;
      this._morphQueued = null;
      if (emit && typeof this.onFormChange === "function") {
        try {
          this.onFormChange(this.form);
        } catch (_) {}
      }
    }

    /**
     * 渐进换形：每字沿格走向新目标，速度与 idle 巡逻一致；结束后再应用形态元数据。
     */
    startMorphTo(name) {
      if (!FORMS[name] || name === this.form) return false;
      if (this.mode === "feeding") this.abortFeeding();
      if (this.morphGlyphToTarget) this._cancelMorph(false);
      const pack = this._computeMorphGridTargets(name);
      if (!pack) return false;
      this.morphToKey = name;
      this.morphFinalMeta = { data: pack.data, key: name };
      this.morphGlyphToTarget = pack.targets;
      this.morphApplyQueue = null;
      this.morphApplyIdx = 0;
      this.morphStepAcc = 0;
      return true;
    }

    _finishMorph() {
      const meta = this.morphFinalMeta;
      const key = meta && meta.key;
      const data = meta && meta.data;
      const targets = this.morphGlyphToTarget;
      if (!key || !FORMS[key] || !data || !targets) {
        this._cancelMorph(true);
        return;
      }

      const step = this.gridCell;
      this.form = key;
      this.formStartTime = performance.now();
      data.leftEyeSize = this.size * 0.05 * (data.eyeSize || 1.4);
      this.formData = data;
      this._cinnabarIdx = null;
      this._layoutSettle = 0.35;

      const c = Math.cos(this.rotation);
      const s = Math.sin(this.rotation);
      for (let i = 0; i < this.glyphs.length && i < targets.length; i++) {
        const g = this.glyphs[i];
        const t = targets[i];
        const dx = t.twx - this.pos.x;
        const dy = t.twy - this.pos.y;
        const lx = dx * c + dy * s;
        const ly = -dx * s + dy * c;
        g.tx = lx / this.facingFlip;
        g.ty = ly;
        g.baseTx = g.tx;
        g.baseTy = g.ty;
        g.edge = t.edge;
        g.faceRole = t.faceRole || null;
        g.mgx = Math.round(t.twx / step);
        g.mgy = Math.round(t.twy / step);
        g.x = g.mgx * step;
        g.y = g.mgy * step;
        g.vx = 0;
        g.vy = 0;
      }

      this.morphGlyphToTarget = null;
      this.morphToKey = null;
      this.morphFinalMeta = null;
      this.morphApplyQueue = null;
      this.morphApplyIdx = 0;
      this.morphStepAcc = 0;

      this._applyGridTypography();
      if (this.formData && this.formData.charPalette) {
        this._applyEmojiPaletteIfNeeded();
      }
      if (!(this.formData && this.formData.charPalette)) {
        this._reapplyBodyFromQueue();
      }
      if (typeof this.onFormChange === "function") {
        try {
          this.onFormChange(this.form);
        } catch (_) {}
      }
    }

    /**
     * 局部目标吸附到格后，保证**一格一字**（避免堆叠），向邻格螺旋找空位。
     * 仅处理非眉眼粒子，眉眼保持眼窝附近。
     */
    _resolveUniqueLocalGrid() {
      if (!this.gridSnapping) return;
      if (isLayoutLockedForm(this.form)) return;
      const step = this.gridCell;
      const occupied = new Set();

      const keyOf = (gx, gy) => `${gx},${gy}`;
      const toCell = (x, y) => ({
        gx: Math.round(x / step),
        gy: Math.round(y / step),
      });
      const toLocal = (gx, gy) => ({ x: gx * step, y: gy * step });

      for (const g of this.glyphs) {
        if (!g.faceRole) continue;
        const { gx, gy } = toCell(g.tx, g.ty);
        occupied.add(keyOf(gx, gy));
      }

      const spiral = (gx, gy) => {
        if (!occupied.has(keyOf(gx, gy))) return { nx: gx, ny: gy, k: keyOf(gx, gy) };
        for (let r = 1; r < 28; r++) {
          for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const nx = gx + dx;
              const ny = gy + dy;
              const k = keyOf(nx, ny);
              if (!occupied.has(k)) return { nx, ny, k };
            }
          }
        }
        return null;
      };

      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        let { gx, gy } = toCell(g.tx, g.ty);
        let k = keyOf(gx, gy);
        if (!occupied.has(k)) {
          occupied.add(k);
          const p = toLocal(gx, gy);
          g.tx = p.x;
          g.ty = p.y;
          g.baseTx = p.x;
          g.baseTy = p.y;
          continue;
        }
        const sp = spiral(gx, gy);
        if (sp) {
          occupied.add(sp.k);
          const p = toLocal(sp.nx, sp.ny);
          g.tx = p.x;
          g.ty = p.y;
          g.baseTx = p.x;
          g.baseTy = p.y;
        }
      }
    }

    /** 离散倾角（约 4° 一档）+ 统一字号阶梯，接近活字排版 */
    _quantizeTargetRot(rad) {
      const step = (4 * Math.PI) / 180;
      return Math.round(rad / step) * step;
    }

    _applyGridTypography() {
      if (!this.gridUnity) {
        for (let i = 0; i < this.glyphs.length; i++) {
          this.glyphs[i].targetRot = rand(-0.18, 0.18);
        }
        return;
      }
      if (this.form === "script") {
        const em = clamp(this.gridCell * 0.84, 12.5, 20);
        for (const g of this.glyphs) {
          g.targetRot = 0;
          g.size = em * (0.96 + (1 - g.edge) * 0.08);
        }
        return;
      }
      if (isLayoutLockedForm(this.form)) {
        const em = clamp(this.gridCell * 0.83, 11.5, 20);
        for (const g of this.glyphs) {
          if (g.faceRole === "brow") {
            g.targetRot = this._quantizeTargetRot(rand(-0.04, 0.04));
            g.size = em * 0.93;
          } else if (g.faceRole === "eyeL" || g.faceRole === "eyeR") {
            g.targetRot = this._quantizeTargetRot(rand(-0.03, 0.03));
            g.size = em * 1.04;
          } else {
            g.targetRot = 0;
            g.size = em * lerp(1.02, 0.94, g.edge);
          }
        }
        return;
      }
      const emMin = Math.max(8, this.gridCell * 0.66);
      const emMax = Math.max(emMin + 0.5, this.gridCell * 0.86);
      const em = Math.max(9, clamp(this.gridCell * 0.78, emMin, emMax));
      for (const g of this.glyphs) {
        if (g.faceRole === "brow") {
          g.targetRot = this._quantizeTargetRot(rand(-0.06, 0.06));
          g.size = em * 0.94;
        } else if (g.faceRole === "eyeL" || g.faceRole === "eyeR") {
          g.targetRot = this._quantizeTargetRot(rand(-0.04, 0.04));
          g.size = em * 1.06;
        } else {
          const spread = lerp(0.02, 0.1, g.edge);
          g.targetRot = this._quantizeTargetRot(rand(-spread, spread));
          g.size = em * lerp(1.06, 0.9, g.edge);
        }
      }
    }

    /** 表情系列形态：躯体字换成 Unicode 表情（依赖系统彩色字体） */
    _applyEmojiPaletteIfNeeded() {
      const pal = this.formData && this.formData.charPalette;
      if (!pal || !pal.length) return;
      const chars = Array.from(pal);
      if (!chars.length) return;
      let k = 0;
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        g.char = chars[k % chars.length];
        k++;
      }
    }

    /** 将局部目标 (tx,ty) 吸附到隐形格，躯体更齐 */
    _snapGlyphTargetsToGrid() {
      const step = this.gridCell;
      const snap = (v) => Math.round(v / step) * step;
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        g.tx = snap(g.tx);
        g.ty = snap(g.ty);
        g.baseTx = snap(g.baseTx);
        g.baseTy = snap(g.baseTy);
      }
    }

    _snapLocal(x, y) {
      const step = this.gridCell;
      const snap = (v) => Math.round(v / step) * step;
      return { x: snap(x), y: snap(y) };
    }

    /** 在距眼窝最近的粒子中指定「眉眼」字层 */
    _assignFaceGlyphs() {
      if (!this.formData || !this.formData.eyes || this.formData.eyes.length < 2) return;
      const [eL, eR] = this.formData.eyes;
      const dist = (g, ex, ey) => Math.hypot(g.tx - ex, g.ty - ey);
      const pickNear = (ex, ey, exclude) => {
        let best = -1;
        let bestD = Infinity;
        for (let k = 0; k < this.glyphs.length; k++) {
          if (exclude.has(k)) continue;
          const d = dist(this.glyphs[k], ex, ey);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        return best;
      };
      const used = new Set();
      const iL = pickNear(eL.x, eL.y, used);
      if (iL >= 0) {
        used.add(iL);
        this.glyphs[iL].faceRole = "eyeL";
      }
      const iR = pickNear(eR.x, eR.y, used);
      if (iR >= 0) {
        used.add(iR);
        this.glyphs[iR].faceRole = "eyeR";
      }
      const mx = (eL.x + eR.x) * 0.5;
      const my = (eL.y + eR.y) * 0.5 - this.size * 0.035;
      const iB = pickNear(mx, my, used);
      if (iB >= 0) {
        this.glyphs[iB].faceRole = "brow";
      }
    }

    _faceGlyphLocalOffsets(tSec) {
      const w = Math.sin(tSec * 6) * 0.003 * this.size * this.annoyance;
      const blink = this.expression === "sleep" ? 1 : Math.sin(tSec * 2.1) > 0.92 ? 0.35 : 1;
      const jitter = Math.sin(tSec * 11.7) * this.annoyance * this.size * 0.004;
      return {
        eyeL: { dx: -this.size * 0.012 + w + jitter, dy: -this.size * 0.008 * blink },
        eyeR: { dx: this.size * 0.012 - w - jitter, dy: -this.size * 0.008 * blink },
        brow: { dx: jitter * 0.5, dy: -this.size * 0.028 + Math.sin(tSec * 1.7) * this.size * 0.006 },
      };
    }

    _syncFaceGlyphTargets(tSec) {
      if (!this.faceLayerMode || !this.formData || !this.formData.eyes) return;
      const expr = EXPRESSIONS[this.expression] || EXPRESSIONS.normal;
      const off = this._faceGlyphLocalOffsets(tSec);
      const eyes = this.formData.eyes;
      for (const g of this.glyphs) {
        if (!g.faceRole) continue;
        let ex;
        let ey;
        let o;
        if (g.faceRole === "eyeL") {
          ex = eyes[0].x;
          ey = eyes[0].y;
          o = off.eyeL;
          g.char = expr.eyeLeft || "·";
        } else if (g.faceRole === "eyeR") {
          ex = eyes[1].x;
          ey = eyes[1].y;
          o = off.eyeR;
          g.char = expr.eyeRight || "·";
        } else if (g.faceRole === "brow") {
          ex = (eyes[0].x + eyes[1].x) * 0.5;
          ey = (eyes[0].y + eyes[1].y) * 0.5 - this.size * 0.02;
          o = off.brow;
          g.char = expr.brow || "一";
        } else continue;
        g.baseTx = ex + o.dx;
        g.baseTy = ey + o.dy;
        if (this.gridSnapping) {
          const s = this._snapLocal(g.baseTx, g.baseTy);
          g.baseTx = s.x;
          g.baseTy = s.y;
        }
        g.tx = g.baseTx;
        g.ty = g.baseTy;
        g.targetRot = lerp(g.targetRot, Math.sin(tSec * 3 + g.depth * 5) * 0.12 * (0.2 + this.annoyance), 0.2);
      }
    }

    /** 戳身：累积烦躁；过高时短暂换形并刷情绪字 */
    nuisTap() {
      this.annoyance = clamp(this.annoyance + 0.22, 0, 1.35);
      this._rumbleAmp = Math.max(this._rumbleAmp || 0, 0.25);
      if (this.mode === "idle" && !this.dragging) {
        this.vel.x += rand(-120, 120);
        this.vel.y += rand(-80, 80);
      }
      if (this.annoyance >= 0.95 && this.mode === "idle") {
        if (!this._savedFormBeforeAnnoyed) this._savedFormBeforeAnnoyed = this.form;
        this.setExpression("annoyed");
        this._applyMoodChars("annoyed", 1.8);
        this._rumbleAmp = Math.max(this._rumbleAmp || 0, 0.85);
        this._glyphFlash = Math.min(0.55, Math.max(this._glyphFlash || 0, 0.5));
        const alt = ["butterfly", "flower", "dragon", "kao_joy", "kao_sweat", "fourier"];
        const pick = alt[Math.floor(Math.random() * alt.length)];
        if (FORMS[pick]) this.setForm(pick, true);
        this.annoyance = 0.45;
        setTimeout(() => {
          if (this.mode === "idle" && this._savedFormBeforeAnnoyed) {
            this.setForm(this._savedFormBeforeAnnoyed, true);
            this._savedFormBeforeAnnoyed = null;
          }
          this.setExpression("normal");
        }, 2200);
      } else if (this.annoyance >= 0.5) {
        this.setExpression("annoyed");
        this._applyMoodChars("annoyed", 1.2);
      } else {
        this.setExpression("surprised");
        setTimeout(() => {
          if (this.expression === "surprised") this.setExpression("normal");
        }, 500);
      }
    }

    _applyMoodChars(moodKey, durationSec) {
      if (performance.now() / 1000 < this._unifiedUntil) return;
      const pool = MOOD_POOLS[moodKey] || MOOD_POOLS.normal;
      const chars = Array.from(pool);
      if (!chars.length) return;
      this._restoreMoodChars();
      const n = Math.min(18, Math.floor(this.glyphs.length * (0.12 + this.annoyance * 0.08)));
      const candidates = this.glyphs
        .map((g, i) => ({ i, g }))
        .filter((x) => !x.g.faceRole && x.g.edge > 0.25)
        .sort(() => Math.random() - 0.5)
        .slice(0, n);
      this._moodSwap = candidates.map(({ i }) => {
        const saved = this.glyphs[i].char;
        this.glyphs[i].char = chars[Math.floor(Math.random() * chars.length)];
        return { i, saved };
      });
      this._moodUntil = performance.now() / 1000 + durationSec;
    }

    _restoreMoodChars() {
      for (const m of this._moodSwap) {
        if (this.glyphs[m.i]) this.glyphs[m.i].char = m.saved;
      }
      this._moodSwap = [];
    }

    _restoreUnifiedChars() {
      for (const m of this._unifiedSwap) {
        if (this.glyphs[m.i]) this.glyphs[m.i].char = m.saved;
      }
      this._unifiedSwap = [];
    }

    /**
     * 全体字冲击：除眉眼外全部暂时显示同一字（用于重要提示）
     * @param {string} ch 单字
     * @param {number} durationSec
     */
    flashUnifiedChar(ch, durationSec) {
      const c = (ch && String(ch).trim()[0]) || "注";
      this._restoreUnifiedChars();
      this._restoreMoodChars();
      const until = performance.now() / 1000 + (durationSec || 1.6);
      this._unifiedUntil = until;
      for (let i = 0; i < this.glyphs.length; i++) {
        const g = this.glyphs[i];
        if (g.faceRole) continue;
        this._unifiedSwap.push({ i, saved: g.char });
        g.char = c;
      }
      this._rumbleAmp = Math.min(0.42, (this._rumbleAmp || 0) + 0.35);
      this._glyphFlash = Math.min(0.45, (this._glyphFlash || 0) + 0.38);
      this.pulse(this.pos.x, this.pos.y);
    }

    /** 少量外圈字换成提示字（非全体冲击） */
    _hintEdgeChars(text, durationSec, maxReplace) {
      const arr = Array.from(String(text || "").replace(/\s/g, "")).filter(Boolean);
      if (!arr.length) return;
      this._restoreMoodChars();
      const n = Math.min(maxReplace || 12, this.glyphs.length);
      const pool = this.glyphs
        .map((g, i) => ({ i, g }))
        .filter((x) => !x.g.faceRole && x.g.edge > 0.38)
        .sort(() => Math.random() - 0.5)
        .slice(0, n);
      this._moodSwap = pool.map(({ i }, j) => {
        const saved = this.glyphs[i].char;
        this.glyphs[i].char = arr[j % arr.length];
        return { i, saved };
      });
      this._moodUntil = performance.now() / 1000 + (durationSec || 1.4);
    }

    /** 解析吞噬的字符串：日程关键词 + 单字 + 形态偏好 */
    digestText(text) {
      const s = String(text || "");
      if (!s.trim()) return null;
      let hitKind = null;
      const scores = { todo: 0, done: 0, delay: 0 };
      for (const rule of DIGEST_RULES) {
        for (const k of rule.keys) {
          if (s.includes(k)) scores[rule.kind] += 2;
        }
      }
      for (const ch of Array.from(s)) {
        const k = CHAR_DIGEST_HINT[ch];
        if (k) scores[k] += 1;
      }
      let best = 0;
      for (const kind of ["todo", "done", "delay"]) {
        if (scores[kind] > best) {
          best = scores[kind];
          hitKind = kind;
        }
      }
      if (best === 0) hitKind = null;

      if (hitKind) this._onDigestKind(hitKind);

      for (const ch of Array.from(s)) {
        const formKey = CHAR_FORM_BIAS[ch];
        if (formKey && FORMS[formKey]) {
          this.formDigestBias[formKey] = (this.formDigestBias[formKey] || 0) + 0.55;
        }
      }
      return hitKind;
    }

    _onDigestKind(kind) {
      if (kind === "done") {
        this.setExpression("happy");
        this._applyMoodChars("happy", 2);
        this.targetScale = 1.06;
        setTimeout(() => {
          this.targetScale = 1;
        }, 500);
        this._rumbleAmp = Math.min(0.5, Math.max(this._rumbleAmp || 0, 0.45));
        this._glyphFlash = Math.min(0.48, Math.max(this._glyphFlash || 0, 0.42));
      } else if (kind === "delay") {
        this.setExpression("annoyed");
        this._applyMoodChars("annoyed", 2.2);
        this._rumbleAmp = Math.min(0.55, Math.max(this._rumbleAmp || 0, 0.48));
        this._glyphFlash = Math.min(0.52, Math.max(this._glyphFlash || 0, 0.45));
      } else if (kind === "todo") {
        this.setExpression("surprised");
        this._hintEdgeChars("待办", 1.6, 14);
        this._rumbleAmp = Math.max(this._rumbleAmp || 0, 0.35);
      }
      this.pulse(this.pos.x, this.pos.y);
    }

    /** 根据饮食偏好随机取一形（idle 自动换形或外部调用） */
    pickBiasedForm(excludeKey) {
      const keys = FORM_ORDER.filter((k) => k !== excludeKey && FORMS[k]);
      if (!keys.length) return FORM_ORDER[0];
      let w = [];
      let sum = 0;
      for (const k of keys) {
        const wi = 1 + (this.formDigestBias[k] || 0) * 1.8;
        w.push({ k, wi });
        sum += wi;
      }
      let r = Math.random() * sum;
      for (const { k, wi } of w) {
        r -= wi;
        if (r <= 0) return k;
      }
      return keys[Math.floor(Math.random() * keys.length)];
    }

    _pickCinnabar() {
      // 挑 2~3 个距离身体中心较近、但不在眼睛位置的字
      const items = this.glyphs
        .map((g, i) => ({ i, g, d: Math.hypot(g.tx, g.ty) }))
        .filter((x) => !x.g.faceRole);
      if (items.length === 0) {
        this._cinnabarIdx = [0, Math.min(1, this.glyphs.length - 1)].filter((i) => i >= 0);
        return this._cinnabarIdx;
      }
      items.sort((a, b) => a.d - b.d);
      // 避开质心正中（让朱砂分布不挤在一处）
      const picked = [];
      for (const it of items) {
        if (picked.length >= 3) break;
        // 与已选过的字保持距离
        let ok = true;
        for (const pi of picked) {
          const gA = this.glyphs[pi];
          const gB = this.glyphs[it.i];
          if (Math.hypot(gA.tx - gB.tx, gA.ty - gB.ty) < this.size * 0.08) {
            ok = false;
            break;
          }
        }
        if (ok) picked.push(it.i);
      }
      this._cinnabarIdx = picked;
      return picked;
    }

    setExpression(name) {
      const next = EXPRESSIONS[name] ? name : "normal";
      this.expression = next;
      const t = performance.now() / 1000;
      if (
        t >= this._moodUntil &&
        t >= this._unifiedUntil &&
        (next === "happy" || next === "wink" || next === "shy")
      ) {
        this._applyMoodChars(next, 1.1);
      }
    }

    addPoolChars(chars) {
      const list = [];
      for (const c of chars) {
        if (c && c.trim() && c !== "\n") {
          this.eatenChars.push(c);
          list.push(c);
        }
      }
      const joined = list.join("");
      if (joined) this.digestText(joined);
      // 随机把一部分现有粒子换成新字，让"吃进去"看得见
      const replace = Math.min(this.glyphs.length, chars.length * 2);
      const indices = [];
      while (indices.length < replace) {
        const i = Math.floor(Math.random() * this.glyphs.length);
        if (!indices.includes(i)) indices.push(i);
      }
      for (const i of indices) {
        if (this.glyphs[i].faceRole) continue;
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
      if (this.dragging) this.endDrag();
      if (this.viewMode !== "pet") this.awakenPet(null, true);
      this.mode = "feeding";
      this._formBeforeFeed =
        this.form === "script"
          ? this._petEntryForm && FORMS[this._petEntryForm]
            ? this._petEntryForm
            : "blob"
          : this.form && FORMS[this.form]
            ? this.form
            : "blob";
      this.feedQueue = targets.slice();
      this.feedTargetWorld = null;
      this.onFeedReach = onReach;
      this.onFeedDone = onDone;
      this.setExpression("surprised");
    }

    stopFeeding() {
      this.mode = "idle";
      this.feedQueue = [];
      this.feedTargetWorld = null;
      const restore = this._formBeforeFeed && FORMS[this._formBeforeFeed] ? this._formBeforeFeed : "blob";
      this._formBeforeFeed = null;
      this.setForm(restore);
      this.setExpression("happy");
      setTimeout(() => {
        if (this.mode === "idle") this.setExpression("normal");
      }, 1200);
    }

    /** 中断觅食（不触发 onFeedDone），用于再次点击或调试 */
    abortFeeding() {
      if (this.mode !== "feeding") return;
      this.feedQueue = [];
      this.feedTargetWorld = null;
      this.onFeedReach = null;
      this.onFeedDone = null;
      this.mode = "idle";
      const restore = this._formBeforeFeed && FORMS[this._formBeforeFeed] ? this._formBeforeFeed : "blob";
      this._formBeforeFeed = null;
      this.setForm(restore);
      this.setExpression("normal");
    }

    sleep(on) {
      if (on) {
        if (this.mode === "feeding") this.abortFeeding();
        if (this.viewMode !== "pet") this.awakenPet(null, true);
        this.mode = "sleep";
        this.setExpression("sleep");
      } else {
        this.mode = "idle";
        this.setExpression("normal");
      }
    }

    shake() {
      if (this.mode === "feeding") this.abortFeeding();
      if (this.viewMode !== "pet") this.awakenPet(null, true);
      this._rumbleAmp = Math.min(0.55, (this._rumbleAmp || 0) + 0.45);
      this._glyphFlash = Math.min(0.55, (this._glyphFlash || 0) + 0.42);
      this.setExpression("surprised");
      setTimeout(() => this.setExpression("normal"), 800);
    }

    markRevertAfterDrag(on) {
      this._pendingScriptReturn = !!on;
    }

    /** 连续轻点画布：涟漪与闪光随链长增强 */
    tapInteractionBurst(chain) {
      const n = Math.min(6, Math.max(1, Math.floor(chain) || 1));
      this._rumbleAmp = Math.min(0.52, (this._rumbleAmp || 0) + 0.06 * n);
      this._glyphFlash = Math.min(0.48, (this._glyphFlash || 0) + 0.08 * n);
      for (let k = 0; k < 3 + n; k++) {
        this.ripples.push({
          x: this.pos.x + rand(-this.size * 0.22, this.size * 0.22),
          y: this.pos.y + rand(-this.size * 0.18, this.size * 0.18),
          r: 5 + n * 2,
          alpha: 0.35 + n * 0.05,
        });
      }
      if (n >= 3) {
        this._glyphFlash = Math.min(0.55, (this._glyphFlash || 0) + 0.2);
        this.setExpression("happy");
        setTimeout(() => {
          if (this.expression === "happy") this.setExpression("normal");
        }, 700);
      }
    }

    /** 画布内可移动边距：尽量贴近边缘 */
    _motionPad() {
      const half = (this.size || 320) * 0.5;
      return Math.max(4, half * 0.025);
    }

    // 拖拽（世界坐标系）
    beginDrag(x, y) {
      if (this.viewMode !== "pet") return;
      this.dragging = true;
      this.dragOffset.x = this.pos.x - x;
      this.dragOffset.y = this.pos.y - y;
      this._dragPrevPos = { x: this.pos.x, y: this.pos.y };
      this.dragVel = { x: 0, y: 0 };
      this.setExpression("shy");
    }
    dragTo(x, y) {
      if (!this.dragging) return;
      const pad = this._motionPad();
      const nx = clamp(x + this.dragOffset.x, pad, this.width - pad);
      const ny = clamp(y + this.dragOffset.y, pad, this.height - pad);
      if (this._dragPrevPos) {
        this.dragVel.x = nx - this._dragPrevPos.x;
        this.dragVel.y = ny - this._dragPrevPos.y;
        this._dragPrevPos.x = nx;
        this._dragPrevPos.y = ny;
      }
      this.pos.x = nx;
      this.pos.y = ny;
    }
    endDrag() {
      const pending = this._pendingScriptReturn;
      this._pendingScriptReturn = false;
      this.dragging = false;
      this._dragPrevPos = null;
      if (pending && this.scriptLines && this.scriptLines.length) {
        this.revertToScript(true);
      }
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
      this.breath = isLayoutLockedForm(this.form)
        ? 1
        : Math.sin(t * 1.05) * 0.032 + 1;

      if (this.viewMode === "intro") {
        for (const r of this.ripples) {
          r.r += 160 * dt;
          r.alpha -= 0.9 * dt;
        }
        this.ripples = this.ripples.filter((r) => r.alpha > 0);
        return;
      }

      // 觅食路径必须与拖拽解耦：否则手指在画布外松开时 dragging 一直为 true，会永久卡住
      if (this.mode === "feeding") {
        if (this.feedTargetWorld) {
          this.anchor.x = this.feedTargetWorld.x;
          this.anchor.y = this.feedTargetWorld.y;
        } else if (this.feedQueue.length) {
          this.feedTargetWorld = this.feedQueue.shift();
        } else {
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
            const reached = this.feedTargetWorld;
            this.feedTargetWorld = null;
            if (this.onFeedReach) this.onFeedReach(reached);
          }
        }
      } else if (!this.dragging) {
        if (this.mode === "idle" && this.viewMode === "pet") {
          if (isLayoutLockedForm(this.form)) {
            this.idleAngle += dt * 0.12;
            const s = 0.055;
            this.anchor.x =
              this.center.x +
              Math.sin(this.idleAngle * 0.42) * this.width * s;
            this.anchor.y =
              this.center.y +
              Math.cos(this.idleAngle * 0.38) * this.height * s * 0.92;
          } else {
            this.idleAngle += dt * 0.35;
            const ax =
              this.center.x +
              Math.sin(this.idleAngle * 0.7) * this.width * 0.3 +
              Math.sin(this.idleAngle * 1.3 + 1.1) * this.width * 0.12;
            const ay =
              this.center.y +
              Math.cos(this.idleAngle * 0.6) * this.height * 0.22 +
              Math.sin(this.idleAngle * 1.1) * this.height * 0.11;
            this.anchor.x = ax;
            this.anchor.y = ay;
          }
        } else if (this.mode === "sleep") {
          this.anchor.x = lerp(this.anchor.x, this.center.x, 0.05);
          this.anchor.y = lerp(this.anchor.y, this.center.y + this.height * 0.05, 0.05);
        }
      }

      if (this.viewMode === "script") {
        this.anchor.x = this.center.x;
        this.anchor.y = this.center.y;
        this.vel.x *= 0.82;
        this.vel.y *= 0.82;
      }
      if (!this.dragging) {
        const layoutLocked = isLayoutLockedForm(this.form);
        const k = this.mode === "feeding" ? 14 : layoutLocked ? 2.85 : 3.5;
        const damp = this.mode === "feeding" ? 4 : layoutLocked ? 2.75 : 2.2;
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
      if (!this.dragging) {
        const pad = this._motionPad();
        this.pos.x = clamp(this.pos.x, pad, this.width - pad);
        this.pos.y = clamp(this.pos.y, pad, this.height - pad);
      }

      if (
        this.form === "clock" &&
        this.mode === "idle" &&
        !this.dragging &&
        !this.morphGlyphToTarget
      ) {
        const d = new Date();
        const slot = d.getHours() * 60 + d.getMinutes();
        if (slot !== this._clockMinuteSlot) {
          this._clockMinuteSlot = slot;
          this.setForm("clock", true);
        }
      }

      if (
        this.form === "chrono" &&
        this.mode === "idle" &&
        !this.dragging &&
        !this.morphGlyphToTarget
      ) {
        const d = new Date();
        const slot = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
        if (slot !== this._chronoSecondSlot) {
          this._chronoSecondSlot = slot;
          this.setForm("chrono", true);
        }
      }

      // 朝向：速度方向决定左右翻面 & 小角度倾斜
      if (Math.abs(this.vel.x) > 40) {
        this.facingFlip = this.vel.x > 0 ? 1 : -1;
      }
      this.targetRotation = isLayoutLockedForm(this.form)
        ? 0
        : clamp(this.vel.x * 0.0005, -0.2, 0.2);
      this.rotation = lerp(this.rotation, this.targetRotation, 0.1);
      const breathUse = isLayoutLockedForm(this.form) ? 1 : this.breath;
      this.scale = lerp(this.scale, this.targetScale * breathUse, 0.15);

      this.annoyance = Math.max(0, this.annoyance - 0.22 * dt);
      if (t >= this._moodUntil && this._moodSwap.length) this._restoreMoodChars();
      if (t >= this._unifiedUntil && this._unifiedSwap.length) this._restoreUnifiedChars();

      for (const k of Object.keys(this.formDigestBias)) {
        this.formDigestBias[k] -= this.formDigestBiasDecay * dt;
        if (this.formDigestBias[k] <= 0.02) delete this.formDigestBias[k];
      }
      this._rumbleAmp = Math.max(0, (this._rumbleAmp || 0) - 1.8 * dt);
      this._glyphFlash = Math.max(0, (this._glyphFlash || 0) - 2.2 * dt);
      this._layoutSettle = Math.max(0, (this._layoutSettle || 0) - dt * 1.1);

      if (this.faceLayerMode) this._syncFaceGlyphTargets(t);

      const bx = this.pos.x;
      const by = this.pos.y;
      const rot = this.rotation;
      const flip = this.facingFlip;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);

      if (
        this.gridMarch &&
        this.gridSnapping &&
        !this.morphGlyphToTarget &&
        this.viewMode === "pet" &&
        this.pathMode !== "none" &&
        this.form !== "script"
      ) {
        if (t >= this._nextWanderPick) {
          this._nextWanderPick = t + rand(0.45, 1.15);
          for (const g of this.glyphs) {
            if (g.faceRole || isLayoutLockedForm(this.form)) continue;
            if (t >= g.wanderNextAt) {
              g.wanderNextAt = t + rand(1.0, 2.9);
              this._pickWanderDelta(g, bx, by, cos, sin, flip);
            }
          }
        }
        for (const g of this.glyphs) {
          if (!g.faceRole && !isLayoutLockedForm(this.form))
            this._stepWanderToward(g);
        }
      }

      if (this.dragLagEnabled) {
        const dvx = this.dragging ? this.dragVel.x : 0;
        const dvy = this.dragging ? this.dragVel.y : 0;
        for (const g of this.glyphs) {
          const rate = 4 + g.lagK * 6;
          const sp = 1 - Math.exp(-rate * dt);
          g.lagX = lerp(g.lagX, bx, sp);
          g.lagY = lerp(g.lagY, by, sp);
          if (this.dragging) {
            const imp = 0.022 * g.lagK * (g.faceRole ? 0.35 : 1);
            g.lagX += dvx * imp;
            g.lagY += dvy * imp;
          }
        }
      } else {
        for (const g of this.glyphs) {
          g.lagX = bx;
          g.lagY = by;
        }
      }

      const eyeClearR = this.size * 0.08;
      const useEyeClear = !this.faceLayerMode;

      // 眼睛位置（世界坐标）：字脸模式下不再推开周围字，避免与眉眼粒子冲突
      const eyeWorld =
        useEyeClear && this.formData
          ? this.formData.eyes.map((e) => {
              const tx = e.x * flip;
              const ty = e.y;
              return {
                x: bx + (tx * cos - ty * sin),
                y: by + (tx * sin + ty * cos),
              };
            })
          : null;

      const cell = this.gridCell;
      const rumble = (this._rumbleAmp || 0) * cell * 0.08;
      const waveAmp = (this.fluidStrength || 0) * cell * 0.09;
      this._fluidPhase += dt * 0.48;

      if (this.gridMarch && this.gridSnapping) {
        const stepBudget = Math.max(
          1,
          Math.min(4, Math.round((this.gridMarchSpeed || 2) * dt * 6))
        );

        for (let gi = 0; gi < this.glyphs.length; gi++) {
          const g = this.glyphs[gi];
          if (g.mgx == null || g.mgy == null) {
            g.mgx = Math.round(g.x / cell);
            g.mgy = Math.round(g.y / cell);
          }
          if (g.marchPref == null) {
            g.marchPref = g.depth > 0.5 ? 1 : 0;
          }

          const txl = g.tx * flip;
          const tyl = g.ty;
          const lbx = this.dragLagEnabled ? g.lagX : bx;
          const lby = this.dragLagEnabled ? g.lagY : by;
          let wx = lbx + (txl * cos - tyl * sin);
          let wy = lby + (txl * sin + tyl * cos);

          const mT = this.morphGlyphToTarget && this.morphGlyphToTarget[gi];
          if (
            !mT &&
            !g.faceRole &&
            this.viewMode === "pet" &&
            this.pathMode !== "none" &&
            !isLayoutLockedForm(this.form)
          ) {
            wx += (g.wgx || 0) * cell;
            wy += (g.wgy || 0) * cell;
          }

          if (
            this.internalMotion &&
            !g.faceRole &&
            !isLayoutLockedForm(this.form)
          ) {
            const pAmp =
              cell *
              0.055 *
              (this._patrolAmp || 1) *
              (g.patrolAmpMul || 1) *
              (this.dragging ? 1.35 : 1);
            const ph = g.patrolSeed || 0;
            wx +=
              Math.sin(t * 0.52 + ph * 2.1) * pAmp * 0.62 +
              Math.sin(t * 0.29 + ph * 5.4) * pAmp * 0.38;
            wy +=
              Math.cos(t * 0.47 + ph * 3.7) * pAmp * 0.58 +
              Math.cos(t * 0.33 + ph * 6.2) * pAmp * 0.35;
          }

          if (waveAmp > 0.001 && !isLayoutLockedForm(this.form)) {
            const nx = wx * 0.017 + this._fluidPhase;
            const ny = wy * 0.015 - this._fluidPhase * 0.75;
            wx += Math.sin(nx + g.depth * 2.1) * waveAmp * 0.55;
            wy += Math.cos(ny + g.depth * 1.5) * waveAmp * 0.48;
          }
          const rx = rumble ? Math.sin(t * 26 + g.depth * 15) * rumble : 0;
          const ry = rumble ? Math.cos(t * 24 + g.depth * 13) * rumble : 0;
          wx += rx;
          wy += ry;

          let tgx;
          let tgy;
          if (mT) {
            tgx = Math.round(mT.twx / cell);
            tgy = Math.round(mT.twy / cell);
          } else {
            tgx = Math.round(wx / cell);
            tgy = Math.round(wy / cell);
          }

          let s = stepBudget;
          while (s-- > 0 && (g.mgx !== tgx || g.mgy !== tgy)) {
            const dx = tgx - g.mgx;
            const dy = tgy - g.mgy;
            if (g.marchPref === 0) {
              if (dx !== 0 && (Math.abs(dx) >= Math.abs(dy) || dy === 0)) {
                g.mgx += dx > 0 ? 1 : -1;
              } else if (dy !== 0) {
                g.mgy += dy > 0 ? 1 : -1;
              }
            } else {
              if (dy !== 0 && (Math.abs(dy) >= Math.abs(dx) || dx === 0)) {
                g.mgy += dy > 0 ? 1 : -1;
              } else if (dx !== 0) {
                g.mgx += dx > 0 ? 1 : -1;
              }
            }
          }

          g.x = g.mgx * cell;
          g.y = g.mgy * cell;
          g.vx = 0;
          g.vy = 0;

          g.rot = lerp(g.rot, g.targetRot, this.gridUnity ? 0.18 : 0.08);
        }

        if (this.morphGlyphToTarget) {
          let all = true;
          const mt = this.morphGlyphToTarget;
          for (let i = 0; i < this.glyphs.length && i < mt.length; i++) {
            const g = this.glyphs[i];
            const tt = mt[i];
            const egx = Math.round(tt.twx / cell);
            const egy = Math.round(tt.twy / cell);
            if (g.mgx !== egx || g.mgy !== egy) {
              all = false;
              break;
            }
          }
          if (all) this._finishMorph();
        }
      } else {
        const fMul = (this.fluidStrength || 0) * 0.001 + 1;
        const springK =
          (this.mode === "feeding" ? 52 : 24) *
          fMul *
          (1 + (this._layoutSettle || 0) * 0.45);
        const damping =
          (this.mode === "feeding" ? 6.2 : 4.8) *
          (1 + (this._layoutSettle || 0) * 0.3);
        const rumble2 = (this._rumbleAmp || 0) * cell * 0.1;
        const waveAmp2 = (this.fluidStrength || 0) * cell * 0.11;

        this._fluidPhase += dt * 0.52;

        for (const g of this.glyphs) {
          const txl = g.tx * flip;
          const tyl = g.ty;
          const lbx = this.dragLagEnabled ? g.lagX : bx;
          const lby = this.dragLagEnabled ? g.lagY : by;
          let wx = lbx + (txl * cos - tyl * sin);
          let wy = lby + (txl * sin + tyl * cos);
          if (
            !g.faceRole &&
            this.viewMode === "pet" &&
            this.pathMode !== "none" &&
            !isLayoutLockedForm(this.form)
          ) {
            wx += (g.wgx || 0) * cell;
            wy += (g.wgy || 0) * cell;
          }
          if (this.gridSnapping && !g.faceRole) {
            wx = Math.round(wx / cell) * cell;
            wy = Math.round(wy / cell) * cell;
          }
          if (waveAmp2 > 0.001 && !isLayoutLockedForm(this.form)) {
            const nx = wx * 0.019 + this._fluidPhase;
            const ny = wy * 0.017 - this._fluidPhase * 0.82;
            wx += Math.sin(nx + g.depth * 2.2) * waveAmp2 * 0.62;
            wy += Math.cos(ny + g.depth * 1.6) * waveAmp2 * 0.52;
            wx += Math.sin(nx * 2.1 + wy * 0.007) * waveAmp2 * 0.22;
          }
          const rx = rumble2 ? Math.sin(t * 28 + g.depth * 16) * rumble2 : 0;
          const ry = rumble2 ? Math.cos(t * 26 + g.depth * 14) * rumble2 : 0;
          let ax = (wx + rx - g.x) * springK - g.vx * damping;
          let ay = (wy + ry - g.y) * springK - g.vy * damping;
          if (!g.faceRole) {
            const mush = this.gridSnapping ? 0.28 : 1.0;
            const mushUse = isLayoutLockedForm(this.form) ? 0.05 : mush;
            ax += Math.sin(t * 2 + g.depth * 6) * mushUse;
          }
          if (eyeWorld) {
            for (const e of eyeWorld) {
              const dx = g.x - e.x;
              const dy = g.y - e.y;
              const d = Math.hypot(dx, dy);
              if (d < eyeClearR && d > 0.01) {
                const push = ((eyeClearR - d) / eyeClearR) * 420;
                ax += (dx / d) * push;
                ay += (dy / d) * push;
              }
            }
          }
          g.vx += ax * dt;
          g.vy += ay * dt;
          g.x += g.vx * dt;
          g.y += g.vy * dt;
          g.rot = lerp(g.rot, g.targetRot, this.gridUnity ? 0.16 : 0.08);
        }
      }

      // 眼睛跟形态（保留坐标供调试；字脸模式不在画布上绘制眼）
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
          let g = this.glyphs[Math.floor(Math.random() * this.glyphs.length)];
          let tries = 0;
          while (g.faceRole && tries++ < 12) {
            g = this.glyphs[Math.floor(Math.random() * this.glyphs.length)];
          }
          if (!g.faceRole) g.char = f.char;
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
      const t = now / 1000;
      ctx.clearRect(0, 0, W, H);

      const light = this.lightCanvas;
      if (light) {
        const sky = ctx.createLinearGradient(0, 0, W, H);
        sky.addColorStop(0, "#f2f2f7");
        sky.addColorStop(0.5, "#fafafa");
        sky.addColorStop(1, "#ebebf0");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);
        if (!isLayoutLockedForm(this.form)) {
          ctx.save();
          ctx.strokeStyle = "rgba(0, 0, 0, 0.04)";
          ctx.lineWidth = 1;
          const gstep = 32;
          for (let x = 0; x <= W; x += gstep) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
          }
          for (let y = 0; y <= H; y += gstep) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
          }
          ctx.restore();
        }
      } else {
        const sky = ctx.createLinearGradient(0, 0, W, H);
        sky.addColorStop(0, "#0f1220");
        sky.addColorStop(0.45, "#15182e");
        sky.addColorStop(1, "#1a1030");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        ctx.strokeStyle = "rgba(160, 190, 255, 0.04)";
        ctx.lineWidth = 1;
        const step = 28;
        const off = (t * 12) % step;
        for (let x = -H; x < W + H; x += step) {
          ctx.beginPath();
          ctx.moveTo(x + off, 0);
          ctx.lineTo(x + off - H * 0.6, H);
          ctx.stroke();
        }
        ctx.restore();
      }

      const shadowR = this.size * 0.28;
      const grd = ctx.createRadialGradient(
        this.pos.x,
        this.pos.y + 4,
        shadowR * 0.08,
        this.pos.x,
        this.pos.y + 4,
        shadowR
      );
      if (light) {
        grd.addColorStop(0, "rgba(0, 122, 255, 0.06)");
        grd.addColorStop(0.5, "rgba(0, 0, 0, 0.02)");
        grd.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else {
        grd.addColorStop(0, "rgba(120, 100, 255, 0.14)");
        grd.addColorStop(0.55, "rgba(80, 140, 220, 0.06)");
        grd.addColorStop(1, "rgba(0, 0, 0, 0)");
      }
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.lineWidth = 1.2;
      for (const r of this.ripples) {
        ctx.strokeStyle = light
          ? `rgba(0, 122, 255, ${r.alpha * 0.35})`
          : `rgba(180, 210, 255, ${r.alpha * 0.45})`;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();

      if (this.viewMode === "intro") return;

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      try {
        if (typeof ctx.textRendering === "string") {
          ctx.textRendering = "geometricPrecision";
        }
      } catch (_) {}
      const flash = this._glyphFlash || 0;

      const drawGlyph = (g, opts) => {
        const crispForm =
          this.form === "script" || isLayoutLockedForm(this.form);
        const edge = g.edge;
        let rx = this.gridUnity ? Math.round(g.x) : g.x;
        let ry = this.gridUnity ? Math.round(g.y) : g.y;
        if (this.gridUnity) {
          rx = this._snapLogicalToDevice(rx);
          ry = this._snapLogicalToDevice(ry);
        }
        const roleMul =
          g.faceRole === "brow"
            ? lerp(1.05, 0.78, edge)
            : g.faceRole
              ? lerp(1.12, 0.88, edge)
              : crispForm
                ? 1
                : lerp(1.28, 0.72, edge);
        const baseSize = g.size * this.scale * (opts.sizeMul || 1);
        let size = baseSize * roleMul;
        if (this.gridUnity && this.gridCell) {
          const cap = this.gridCell * (crispForm ? 0.92 : 0.88) * this.scale;
          if (size > cap) size = cap;
        }
        const ch0 = g.char && g.char.length ? g.char.codePointAt(0) : 0;
        const emojiLike = glyphUsesEmojiFont(g.char);
        if (emojiLike) {
          const capE = (this.gridCell || 10) * 0.92 * this.scale;
          if (size > capE) size = capE;
        }
        if (size < 7.5) size = 7.5;
        if (this.gridUnity) size = Math.max(size, 8.5);
        const flashW = opts.flashWeight != null ? opts.flashWeight : 0.5;
        const flashBoost = 1 + Math.min(flash, 0.52) * flashW * 0.42;
        const edgeAlpha = crispForm ? lerp(0.99, 0.92, edge) : lerp(0.94, 0.42, edge);
        const alpha =
          (opts.alphaMul != null ? opts.alphaMul : 1) *
          flashBoost *
          edgeAlpha *
          g.alpha;
        const fontMain =
          '"LXGW WenKai","LXGW WenKai Screen","Noto Serif SC","Noto Sans SC",serif';
        const pxInt = Math.max(8, Math.round(size));
        const szLabel =
          crispForm || this.gridUnity ? `${pxInt}px` : `${(Math.round(size * 10) / 10).toFixed(1)}px`;
        const fontPrefix = emojiLike ? "" : "600 ";
        ctx.font = emojiLike
          ? `${szLabel} ${this.emojiFontStack}, ${fontMain}`
          : `${fontPrefix}${szLabel} ${fontMain}`;
        let fillStyle = null;
        let outlinePass = null;
        if (opts.color) {
          const c = opts.color;
          if (c.startsWith("#") && (c.length === 7 || c.length === 9)) {
            const r = parseInt(c.slice(1, 3), 16);
            const gg = parseInt(c.slice(3, 5), 16);
            const b = parseInt(c.slice(5, 7), 16);
            fillStyle = `rgba(${r},${gg},${b},${alpha})`;
          } else {
            fillStyle = c;
          }
        } else if (opts.cel === false) {
          if (light) {
            const inkR = Math.round(lerp(28, 100, edge));
            const inkG = Math.round(lerp(28, 110, edge));
            const inkB = Math.round(lerp(34, 120, edge));
            fillStyle = `rgba(${inkR},${inkG},${inkB},${alpha})`;
          } else {
            const inkR = Math.round(lerp(240, 110, edge));
            const inkG = Math.round(lerp(248, 160, edge));
            const inkB = Math.round(lerp(255, 210, edge));
            fillStyle = `rgba(${inkR},${inkG},${inkB},${alpha})`;
          }
        } else {
          const cel = celRgbFromGlyph(g, light, t, this._fluidPhase || 0);
          const [or, og, ob] = cel.outlineRgb;
          const outlineA = alpha * (0.5 + cel.edgeMul * 0.38);
          const px = this._pxScale || 1;
          const useCelHalo =
            !light &&
            !g.faceRole &&
            cel.edgeMul > 0.38;
          if (useCelHalo) {
            outlinePass = {
              rgba: `rgba(${or},${og},${ob},${outlineA})`,
              off: Math.max(0.45, 0.65 / Math.sqrt(px)),
            };
          }
          fillStyle = `rgba(${Math.round(cel.r)},${Math.round(cel.gg)},${Math.round(cel.b)},${alpha})`;
        }
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowColor = "transparent";
        ctx.translate(rx, ry);
        const snapRot =
          this.gridUnity && !g.faceRole && Math.abs(g.rot) < 0.07 ? 0 : g.rot;
        ctx.rotate(snapRot);
        if (outlinePass) {
          ctx.fillStyle = outlinePass.rgba;
          const o = outlinePass.off;
          ctx.fillText(g.char, -o, 0);
          ctx.fillText(g.char, o, 0);
          ctx.fillText(g.char, 0, -o);
          ctx.fillText(g.char, 0, o);
        }
        ctx.fillStyle = fillStyle;
        if (opts.shadow) {
          ctx.shadowColor = opts.shadow;
          ctx.shadowBlur = opts.shadowBlur || 6;
        } else {
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.shadowColor = "transparent";
        }
        ctx.fillText(g.char, 0, 0);
        ctx.restore();
      };

      // 浅色 UI 下躯体用单层实色（关 cel 渐变），避免边缘半透明与叠层发糊；深色保留 cel + 细描边
      const useCelInk = !isLayoutLockedForm(this.form) && !light;
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        drawGlyph(g, { flashWeight: 0.45, cel: useCelInk });
      }

      // 朱砂点缀（布局锁定形态跳过，避免叠影发糊）
      if (this.glyphs.length > 0 && !isLayoutLockedForm(this.form)) {
        const sorted = this._cinnabarIdx || this._pickCinnabar();
        for (let k = 0; k < sorted.length; k++) {
          const g = this.glyphs[sorted[k]];
          if (!g || g.faceRole) continue;
          drawGlyph(g, {
            sizeMul: 1.12,
            color: light
              ? `rgba(0, 122, 255, ${0.55 * g.alpha})`
              : `rgba(255, 160, 190, ${0.72 * g.alpha})`,
            shadow: light ? undefined : "rgba(255, 120, 180, 0.35)",
            shadowBlur: light ? 0 : 8,
            flashWeight: 0.4,
          });
        }
      }

      // 眉眼字层（表情由字符与微位移承担）
      const expr = EXPRESSIONS[this.expression] || EXPRESSIONS.normal;
      const eyeHex = light ? expr.color || "#1c1c1e" : expr.color || "#e8f0ff";
      for (const g of this.glyphs) {
        if (!g.faceRole) continue;
        const mul = g.faceRole === "brow" ? 0.92 : 1.18;
        drawGlyph(g, {
          sizeMul: mul,
          color: eyeHex,
          shadow: light ? "rgba(0, 0, 0, 0.12)" : "rgba(100, 160, 255, 0.45)",
          shadowBlur: 10,
          flashWeight: 0.22,
        });
      }

      // 飞字
      for (const f of this.flyingGlyphs) {
        const a = clamp(1 - f.t / (f.life + 0.1), 0, 1);
        ctx.font = `${f.size.toFixed(1)}px "LXGW WenKai","Noto Sans SC",serif`;
        if (light) {
          ctx.fillStyle = `rgba(0, 122, 255, ${a * 0.85})`;
          ctx.shadowColor = "rgba(0, 122, 255, 0.25)";
        } else {
          ctx.fillStyle = `rgba(255, 180, 220, ${a * 0.9})`;
          ctx.shadowColor = "rgba(255, 140, 200, 0.4)";
        }
        ctx.shadowBlur = 8;
        const fx = this.gridUnity ? Math.round(f.x) : f.x;
        const fy = this.gridUnity ? Math.round(f.y) : f.y;
        ctx.fillText(f.char, fx, fy);
      }
      ctx.restore();
    }

    /**
     * 字灵模式下根据文稿行处理日程：**已完成** → 吸入躯体；**未完成** → 不修改躯体（穿透）。
     * 同一「已完成」整行只在首次出现时吞食（指纹为 trim 后的整行）。
     */
    tryConsumeCompletedScriptLines(scriptLines) {
      if (this.viewMode !== "pet") return { ate: 0, todoTouch: 0 };
      const lines = Array.isArray(scriptLines)
        ? scriptLines.map((l) => String(l || "").trim()).filter(Boolean)
        : [];
      let ate = 0;
      let todoTouch = 0;
      const todoChunks = [];
      for (const line of lines) {
        const cl = classifyScheduleLine(line);
        if (cl.status === "todo") {
          todoTouch++;
          todoChunks.push(line);
          continue;
        }
        if (cl.status !== "done" || !cl.content) continue;
        const fp = line.trim();
        if (this._scriptDigestSeen.has(fp)) continue;
        this._scriptDigestSeen.add(fp);
        this.attachBodyChars(cl.content.slice(0, this.bodyCharQueueMax));
        this.digestText(line);
        ate++;
      }
      if (todoChunks.length > 0) {
        this.digestText(todoChunks.join("\n"));
      }
      return { ate, todoTouch };
    }

    /** 将一段文字「贴」到躯体粒子上；多次写入会**累积队列**并覆盖更多字 */
    attachBodyChars(text) {
      const arr = Array.from(String(text || "")).filter((c) => c.trim());
      if (!arr.length) return;
      for (const c of arr) {
        this.bodyCharQueue.push(c);
        if (this.bodyCharQueue.length > this.bodyCharQueueMax) {
          this.bodyCharQueue.splice(0, this.bodyCharQueue.length - this.bodyCharQueueMax);
        }
      }
      const pool = this.glyphs
        .map((g, i) => ({ g, i }))
        .filter((x) => !x.g.faceRole)
        .sort((a, b) => b.g.edge - a.g.edge);
      const q = this.bodyCharQueue;
      const nQ = q.length;
      const nP = pool.length;
      if (!nP || !nQ) return;
      const take = Math.min(nP, Math.max(nQ, Math.floor(nP * 0.55)));
      for (let j = 0; j < take; j++) {
        pool[j].g.char = q[j % nQ];
      }
    }

    /** 换形后仅按已有队列重贴字，不追加队列 */
    _reapplyBodyFromQueue() {
      const q = this.bodyCharQueue;
      if (!q || !q.length) return;
      const pool = this.glyphs
        .map((g, i) => ({ g, i }))
        .filter((x) => !x.g.faceRole)
        .sort((a, b) => b.g.edge - a.g.edge);
      const nQ = q.length;
      const nP = pool.length;
      if (!nP) return;
      const take = Math.min(nP, Math.max(nQ, Math.floor(nP * 0.55)));
      for (let j = 0; j < take; j++) {
        pool[j].g.char = q[j % nQ];
      }
    }

    /**
     * 接入 AI / 日程建议的规整文本块（约定格式，便于日后接 API）
     * 躯体:一行字 → 贴外圈；冲击:X → 全字冲击；整段仍参与 digest
     */
    ingestAiSuggestionBlock(raw) {
      const lines = String(raw || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      let bodyLine = "";
      for (const line of lines) {
        const u = line.match(/^(冲击|全字|FLASH)[:：]\s*(.)$/i);
        if (u && u[2]) {
          this.flashUnifiedChar(u[2], 1.8);
          continue;
        }
        const b = line.match(/^(躯体|BODY)[:：]\s*(.+)$/i);
        if (b && b[2]) {
          this.attachBodyChars(b[2].trim().slice(0, 28));
          bodyLine = b[2];
          continue;
        }
        if (!bodyLine && line.length <= 32 && !/[:：]/.test(line)) {
          this.attachBodyChars(line.slice(0, 28));
          bodyLine = line;
        }
      }
      this.digestText(lines.join(""));
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      window.removeEventListener("resize", this._resize);
      if (this._ro) {
        this._ro.disconnect();
        this._ro = null;
      }
    }
  }

  // ---------- 对外暴露 ---------- //
  window.ZiLing = {
    Pet,
    FORMS,
    FORM_ORDER,
    DEFAULT_POOL,
    DIGEST_RULES,
    CHAR_DIGEST_HINT,
    CHAR_FORM_BIAS,
    classifyScheduleLine,
  };
})();
