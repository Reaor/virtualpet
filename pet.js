/**
 * 字灵 · Pet Engine
 *
 * 核心：成百个「字」粒子通过弹簧物理追逐目标点，目标点由当前形态的轮廓采样而来。
 * 形态是一个函数：给定一块尺寸 S，返回 N 个目标点 + 两只眼睛位置。
 * 形态定义使用离屏 canvas 画出剪影，再均匀采样填充像素得到目标点；
 * 数学曲线（心、花、蝶）则直接参数化计算，更精确。
 *
 * 依赖：`js/ziling/play-bounds.js` 先于本文件加载（`window.ZiLingPlayBounds`）。
 * 形场 / 矩阵占位：`js/ziling/shape-field.js`、`js/ziling/matrix-bridge.js`（`PLAN.md` / `DESIGN.md`）。
 * 目录说明：`docs/ZILING_LAYOUT.txt`
 */

(function () {
  "use strict";

  const PB =
    typeof window !== "undefined" && window.ZiLingPlayBounds
      ? window.ZiLingPlayBounds
      : {
          inset(w, h) {
            return Math.max(1, Math.min(w, h) * 0.006);
          },
          resolve(pos, vel, bounds, r, restitution, kickSpeed) {
            const rest = restitution == null ? 0.42 : restitution;
            const kick = kickSpeed == null ? 115 : kickSpeed;
            let nx = 0;
            let ny = 0;
            let hit = false;
            if (pos.x < bounds.minX + r) {
              pos.x = bounds.minX + r;
              nx = 1;
              hit = true;
              vel.x = Math.max(vel.x * -rest, kick);
            } else if (pos.x > bounds.maxX - r) {
              pos.x = bounds.maxX - r;
              nx = -1;
              hit = true;
              vel.x = Math.min(vel.x * -rest, -kick);
            }
            if (pos.y < bounds.minY + r) {
              pos.y = bounds.minY + r;
              ny = 1;
              hit = true;
              vel.y = Math.max(vel.y * -rest, kick);
            } else if (pos.y > bounds.maxY - r) {
              pos.y = bounds.maxY - r;
              ny = -1;
              hit = true;
              vel.y = Math.min(vel.y * -rest, -kick);
            }
            return hit ? { nx, ny } : null;
          },
        };

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
    鱼: "tro_ep_a",
    鲤: "tro_ep_a",
    花: "flower",
    蝶: "flower",
    网: "kao_cool",
    符: "kao_cool",
    情: "kao_joy",
    绘: "kao_sweat",
    时: "clock",
    钟: "clock",
    数: "mega",
    龙: "fourier",
    云: "blob",
    心: "blob",
    猫: "blob",
    鹤: "flower",
    月: "blob",
    星: "blob",
    兔: "blob",
    狐: "blob",
    颜: "kao_joy",
    笑: "kao_joy",
    汗: "kao_sweat",
    囧: "kao_sweat",
    巨: "mega",
    傅: "fourier",
    蔷: "rose",
    纽: "lemniscate",
    秒: "chrono",
    触: "cv_gear",
    须: "tro_hyp_a",
    母: "tro_ep_b",
    藻: "cv_butterfly",
    舞: "kao_party",
    气: "kao_angry",
    爱: "kao_love",
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
  function sampleSilhouette(drawFn, S, count, sampleOpts) {
    const so = sampleOpts || {};
    const cap = so.cap != null ? so.cap : 280;
    const jitterScale = so.jitterScale != null ? so.jitterScale : 0.22;
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
    const start =
      so.startPhase != null
        ? Math.abs(so.startPhase | 0) % Math.max(1, total)
        : 0;
    for (let pos = 0; pos < count; pos++) {
      const i = (start + pos * step) % total;
      const jitter = () => (Math.random() - 0.5) * jitterScale;
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

  /**
   * 巨字全笔画：栅格化后收集不透明像素中心（与 `sampleSilhouette` 同尺度）。
   * 点列可能上万，后续须 `subsampleInkPointsUniform` 再 FPS。
   */
  function collectSilhouetteInkPointsWorld(drawFn, S, capPx) {
    const cap = clamp(capPx != null ? +capPx : 420, 200, 512);
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
    const off = sampleS / 2;
    const pts = [];
    const stride = sampleS > 240 ? 2 : 1;
    for (let y = 0; y < sampleS; y += stride) {
      const row = y * sampleS;
      for (let x = 0; x < sampleS; x += stride) {
        if (img[(row + x) * 4 + 3] > 128) {
          pts.push({
            x: (x - off) / scale,
            y: (y - off) / scale,
          });
        }
      }
    }
    return { pts, sampleS, scale };
  }

  /** 均匀压到至多 maxN 点，控制 FPS 复杂度 */
  function subsampleInkPointsUniform(pts, maxN) {
    if (!pts || pts.length <= maxN) return pts || [];
    const out = [];
    const step = pts.length / maxN;
    let acc = 0;
    for (let i = 0; i < pts.length && out.length < maxN; i++) {
      acc += 1;
      if (acc >= step) {
        out.push(pts[i]);
        acc -= step;
      }
    }
    let j = 0;
    while (out.length < maxN && j < pts.length) {
      out.push(pts[j++]);
    }
    return out;
  }

  /**
   * 最远点采样（贪心 FPS）：在笔画点云上取 k 个互斥性较好的代表点，
   * 近似蓝噪声/Poisson-disk，减轻步进扫描条纹与局部空洞（自研、零依赖）。
   */
  function farthestPointSamplingInk(pts, kWant, seedU32) {
    if (!pts || !pts.length || kWant < 1) return [];
    if (pts.length <= kWant) return pts.slice(0, kWant);
    const chosen = [];
    const picked = new Uint8Array(pts.length);
    const first = (seedU32 ^ (pts.length * 2654435761)) % pts.length;
    chosen.push(pts[first]);
    picked[first] = 1;
    const minD2 = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].x - pts[first].x;
      const dy = pts[i].y - pts[first].y;
      minD2[i] = dx * dx + dy * dy;
    }
    let rnd = seedU32 >>> 0;
    while (chosen.length < kWant) {
      let bestI = -1;
      let bestD = -1;
      for (let i = 0; i < pts.length; i++) {
        if (picked[i]) continue;
        const d = minD2[i];
        if (d > bestD || (d === bestD && ((rnd = (rnd * 1664525 + 1013904223) >>> 0) & 1))) {
          bestD = d;
          bestI = i;
        }
      }
      if (bestI < 0 || bestD < 1e-12) break;
      const p = pts[bestI];
      chosen.push(p);
      picked[bestI] = 1;
      for (let i = 0; i < pts.length; i++) {
        if (picked[i]) continue;
        const dx = pts[i].x - p.x;
        const dy = pts[i].y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2[i]) minD2[i] = d2;
      }
    }
    let pad = 0;
    while (chosen.length < kWant && pad < pts.length * 2) {
      const q = pts[pad++ % pts.length];
      chosen.push({ x: q.x + rand(-0.35, 0.35), y: q.y + rand(-0.35, 0.35) });
    }
    return chosen.slice(0, kWant);
  }

  /**
   * 壳带像素分层抽样：网格分桶后在波次间轮转取点，减轻扫描条纹。
   */
  function stratifiedPickFromShellPixels(pxFlat, w, h, want) {
    const pairs = [];
    for (let i = 0; i + 1 < pxFlat.length; i += 2) {
      pairs.push({ x: pxFlat[i], y: pxFlat[i + 1] });
    }
    const nb = clamp(Math.round((w + h) * 0.034), 5, 14);
    const bw = nb;
    const bh = nb;
    const buckets = [];
    for (let i = 0; i < bw * bh; i++) buckets.push([]);
    for (const p of pairs) {
      const bx = Math.min(bw - 1, Math.max(0, ((p.x / w) * bw) | 0));
      const by = Math.min(bh - 1, Math.max(0, ((p.y / h) * bh) | 0));
      buckets[by * bw + bx].push(p);
    }
    const order = [];
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length) order.push(i);
    }
    if (!order.length) return pairs.slice(0, want);
    const out = [];
    let wave = 0;
    while (out.length < want && wave < want * 6) {
      for (const bi of order) {
        if (out.length >= want) break;
        const b = buckets[bi];
        const pick = b[(wave * 17 + bi * 31) % b.length];
        out.push(pick);
      }
      wave++;
    }
    while (out.length < want) {
      const p = pairs[(Math.random() * pairs.length) | 0];
      out.push(p);
    }
    return out.slice(0, want);
  }

  /** spread/enforce 后把明显飞出笔画壳层的目标拉回最近壳像素，减少断笔；近处不强行吸附以免多点塌缩。 */
  function snapTargetsToShellPx(targets, pxFlat, scale, sampleS, onlyIfFarSq) {
    if (!targets || !targets.length || !pxFlat || pxFlat.length < 4) return;
    const thr = onlyIfFarSq != null ? onlyIfFarSq : (Math.max(sampleS / scale, 100) * 0.2) ** 2;
    const off = sampleS / 2;
    const world = [];
    for (let i = 0; i + 1 < pxFlat.length; i += 2) {
      world.push({
        x: (pxFlat[i] - off) / scale,
        y: (pxFlat[i + 1] - off) / scale,
      });
    }
    for (let i = 0; i < targets.length; i++) {
      const tx = targets[i].x;
      const ty = targets[i].y;
      let bd = 1e18;
      let bi = 0;
      for (let j = 0; j < world.length; j++) {
        const wx = world[j].x;
        const wy = world[j].y;
        const d2 = (wx - tx) * (wx - tx) + (wy - ty) * (wy - ty);
        if (d2 < bd) {
          bd = d2;
          bi = j;
        }
      }
      if (bd > thr) {
        targets[i].x = world[bi].x;
        targets[i].y = world[bi].y;
      }
    }
  }

  /** 将 drawFn 栅格化为二值 ink（alpha>128） */
  function rasterizeDrawToGrid(drawFn, S, cap) {
    const sampleS = Math.min(Math.round(S), cap || 400);
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
    const w = sampleS;
    const h = sampleS;
    const grid = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      grid[i] = img[p + 3] > 128 ? 1 : 0;
    }
    return { grid, w, h, scale, sampleS };
  }

  /** 与画布边缘连通的「外部白」，不含封闭字腔内的白 */
  function floodExteriorWhiteGrid(grid, w, h) {
    const ext = new Uint8Array(w * h);
    const q = [];
    const seed = (i) => {
      if (!grid[i] && !ext[i]) {
        ext[i] = 1;
        q.push(i);
      }
    };
    for (let x = 0; x < w; x++) {
      seed(x);
      seed((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      seed(y * w);
      seed(y * w + (w - 1));
    }
    let qi = 0;
    while (qi < q.length) {
      const i = q[qi++];
      const x = i % w;
      const y = (i / w) | 0;
      const pushIf = (ni, ok) => {
        if (!ok) return;
        if (!grid[ni] && !ext[ni]) {
          ext[ni] = 1;
          q.push(ni);
        }
      };
      pushIf(i - 1, x > 0);
      pushIf(i + 1, x + 1 < w);
      pushIf(i - w, y > 0);
      pushIf(i + w, y + 1 < h);
    }
    return ext;
  }

  /** ink 四邻是否有「内部白」（字谷），用于去掉贴腔笔画上的采样点 */
  function inkAdjacentInteriorHole(i, grid, extWhite, w, h) {
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) {
      const ni = i - 1;
      if (!grid[ni] && !extWhite[ni]) return true;
    }
    if (x + 1 < w) {
      const ni = i + 1;
      if (!grid[ni] && !extWhite[ni]) return true;
    }
    if (y > 0) {
      const ni = i - w;
      if (!grid[ni] && !extWhite[ni]) return true;
    }
    if (y + 1 < h) {
      const ni = i + w;
      if (!grid[ni] && !extWhite[ni]) return true;
    }
    return false;
  }

  /** 仅从外部白向内 BFS，得到 ink 到「画布外背景」的曼哈顿深度（字腔内白不参与播种） */
  function distanceInkFromExterior(grid, w, h, extWhite, shellMax) {
    const sm = shellMax;
    const INF = 30000;
    const dist = new Int16Array(w * h);
    dist.fill(INF);
    const q = [];
    for (let i = 0; i < w * h; i++) {
      if (!grid[i] && extWhite[i]) {
        dist[i] = 0;
        q.push(i);
      }
    }
    let qi = 0;
    while (qi < q.length) {
      const i = q[qi++];
      const d = dist[i];
      if (d >= sm) continue;
      const x = i % w;
      const y = (i / w) | 0;
      const nd = d + 1;
      if (x > 0) {
        const ni = i - 1;
        if (grid[ni] && nd < dist[ni]) {
          dist[ni] = nd;
          q.push(ni);
        }
      }
      if (x + 1 < w) {
        const ni = i + 1;
        if (grid[ni] && nd < dist[ni]) {
          dist[ni] = nd;
          q.push(ni);
        }
      }
      if (y > 0) {
        const ni = i - w;
        if (grid[ni] && nd < dist[ni]) {
          dist[ni] = nd;
          q.push(ni);
        }
      }
      if (y + 1 < h) {
        const ni = i + w;
        if (grid[ni] && nd < dist[ni]) {
          dist[ni] = nd;
          q.push(ni);
        }
      }
    }
    return dist;
  }

  function flattenOuterShellPx(
    grid,
    dist,
    w,
    h,
    shellMax,
    extWhite,
    excludeHoleAdjacent
  ) {
    const sm = shellMax;
    const px = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!grid[i]) continue;
        const dd = dist[i];
        if (dd < 1 || dd > sm) continue;
        if (
          excludeHoleAdjacent &&
          inkAdjacentInteriorHole(i, grid, extWhite, w, h)
        ) {
          continue;
        }
        px.push(x, y);
      }
    }
    return px;
  }

  /**
   * 外轮廓壳层像素（仅连通画布背景的白参与距离场；可选去掉紧贴字腔的 ink）。
   */
  function collectOuterShellBandFlat(drawFn, S, cap, shellMax, excludeHoleAdjacent) {
    const sm = clamp(shellMax != null ? shellMax : 3, 1, 8);
    const { grid, w, h, scale, sampleS } = rasterizeDrawToGrid(drawFn, S, cap);
    const extWhite = floodExteriorWhiteGrid(grid, w, h);
    const dist = distanceInkFromExterior(grid, w, h, extWhite, sm);
    let px = flattenOuterShellPx(
      grid,
      dist,
      w,
      h,
      sm,
      extWhite,
      excludeHoleAdjacent
    );
    if (excludeHoleAdjacent && px.length < 28) {
      px = flattenOuterShellPx(grid, dist, w, h, sm, extWhite, false);
    }
    return { pxFlat: px, w, h, scale, sampleS, grid, extWhite, dist };
  }

  /**
   * 距空白最近的笔画环带采样：保留字心留白，避免巨字被「实心糊满」。
   * shellMax：笔画内距边界的像素深度（1≈仅轮廓，3~4≈薄墨壳层）。
   * outMeta：若传入对象，写入 pxFlat / scale / sampleS / w / h 供 snap 复用。
   */
  function sampleSilhouetteShell(drawFn, S, count, sampleOpts, outMeta) {
    const so = sampleOpts || {};
    const cap = so.cap != null ? so.cap : 336;
    const shellMax = clamp(so.shellMax != null ? so.shellMax : 3, 1, 8);
    const jitterScale = so.jitterScale != null ? so.jitterScale : 0.01;
    const excludeHole = so.excludeInteriorCounters !== false;
    const pack = collectOuterShellBandFlat(drawFn, S, cap, shellMax, excludeHole);
    const px = pack.pxFlat;
    const w = pack.w;
    const h = pack.h;
    const scale = pack.scale;
    const sampleS = pack.sampleS;
    const total = px.length / 2;
    if (outMeta && typeof outMeta === "object") {
      outMeta.pxFlat = px;
      outMeta.scale = scale;
      outMeta.sampleS = sampleS;
      outMeta.w = w;
      outMeta.h = h;
    }
    if (total === 0) {
      return sampleSilhouette(drawFn, S, count, {
        cap,
        jitterScale: Math.max(jitterScale, 0.02),
      });
    }
    const picked = stratifiedPickFromShellPixels(px, w, h, count);
    const points = [];
    const off = sampleS / 2;
    const jitter = () => (Math.random() - 0.5) * jitterScale * sampleS;
    for (let i = 0; i < picked.length && points.length < count; i++) {
      const pr = picked[i];
      points.push({
        x: (pr.x - off) / scale + jitter(),
        y: (pr.y - off) / scale + jitter(),
      });
    }
    while (points.length < count) {
      const p = points[points.length % Math.max(1, points.length)] || { x: 0, y: 0 };
      points.push({ x: p.x + rand(-1.2, 1.2), y: p.y + rand(-1.2, 1.2) });
    }
    return points.slice(0, count);
  }

  function spreadTargets2D(points, minD, passes) {
    if (!points || points.length < 2 || minD <= 0) return;
    const minDSq = minD * minD;
    const P = Math.max(1, passes | 0);
    for (let p = 0; p < P; p++) {
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const ax = points[i].x;
          const ay = points[i].y;
          const bx = points[j].x;
          const by = points[j].y;
          let dx = bx - ax;
          let dy = by - ay;
          const dsq = dx * dx + dy * dy;
          if (dsq >= minDSq || dsq < 1e-10) continue;
          const dlen = Math.sqrt(dsq);
          const push = (minD - dlen) * 0.68;
          dx /= dlen;
          dy /= dlen;
          points[i].x -= dx * push;
          points[i].y -= dy * push;
          points[j].x += dx * push;
          points[j].y += dy * push;
        }
      }
    }
  }

  /** 巨字等：在 spread 后再强制最小间距（减轻笔画带内重叠） */
  function enforceTargetsMinSpacing(points, minD, passes) {
    if (!points || points.length < 2 || minD <= 0) return;
    const minDSq = minD * minD;
    const P = Math.max(1, passes | 0);
    for (let p = 0; p < P; p++) {
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const ax = points[i].x;
          const ay = points[i].y;
          const bx = points[j].x;
          const by = points[j].y;
          let dx = bx - ax;
          let dy = by - ay;
          const dsq = dx * dx + dy * dy;
          if (dsq >= minDSq || dsq < 1e-12) continue;
          const dlen = Math.sqrt(dsq);
          const push = (minD - dlen) * 0.78;
          dx /= dlen;
          dy /= dlen;
          points[i].x -= dx * push;
          points[i].y -= dy * push;
          points[j].x += dx * push;
          points[j].y += dy * push;
        }
      }
    }
  }

  /** 统计剪影不透明像素数（用于巨字粒子数自适应） */
  function countSilhouetteFillPixels(drawFn, S, cap) {
    const sampleS = Math.min(Math.round(S), cap || 336);
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
    let n = 0;
    for (let i = 3; i < img.length; i += 4) {
      if (img[i] > 128) n++;
    }
    return n;
  }

  /** 统计笔画壳层像素数（与巨字外轮廓壳采样同口径：外部背景距离场 + 可选去字腔环） */
  function countSilhouetteBandPixels(drawFn, S, cap, shellMax) {
    const sm = clamp(shellMax != null ? shellMax : 3, 1, 8);
    const { pxFlat } = collectOuterShellBandFlat(drawFn, S, cap || 420, sm, true);
    return pxFlat.length / 2;
  }

  /** 与剪影相同的缩放栅格，用于轮廓内可走判定（alpha > 128） */
  function rasterizeMask(drawFn, S, capPx) {
    const cap = clamp(capPx != null ? +capPx : 300, 200, 384);
    const sampleS = Math.min(Math.round(S), cap);
    const scale = sampleS / S;
    const c = document.createElement("canvas");
    c.width = sampleS;
    c.height = sampleS;
    const ctx = c.getContext("2d", { willReadFrequently: false });
    ctx.clearRect(0, 0, sampleS, sampleS);
    ctx.save();
    ctx.scale(scale, scale);
    drawFn(ctx, S);
    ctx.restore();
    const img = ctx.getImageData(0, 0, sampleS, sampleS).data;
    const grid = new Uint8Array(sampleS * sampleS);
    let fillCount = 0;
    for (let i = 0; i < sampleS * sampleS; i++) {
      const v = img[i * 4 + 3] > 128 ? 1 : 0;
      grid[i] = v;
      fillCount += v;
    }
    return { grid, w: sampleS, h: sampleS, scale, fillCount };
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

  /**
   * 多向凸起软体轮廓（海星 / 触手团）：r(θ)=R₀+L·max(0,cos(Nθ))^p，再乘垂直缩放。
   * ripple：边界低频调制，触须更「卷曲」。
   */
  function radialSoftBodyOutline(S, nArms, R0Mul, ampMul, pinchPow, aspectY, ripple) {
    const R0 = S * R0Mul;
    const L = S * ampMul;
    const rip = ripple || 0;
    const outline = [];
    const steps = 520;
    for (let j = 0; j < steps; j++) {
      const t = (j / steps) * TAU;
      const k = Math.max(0, Math.cos(nArms * t));
      let r = R0 + L * Math.pow(k, pinchPow);
      if (rip > 0) {
        r *= 1 + rip * Math.sin((nArms * 2 + 3) * t + 0.7);
      }
      outline.push({ x: Math.cos(t) * r, y: Math.sin(t) * r * aspectY });
    }
    return outline;
  }

  function fillRadialSoftBodyMask(ctx, s, nArms, R0Mul, ampMul, pinchPow, aspectY, ripple) {
    const outline = radialSoftBodyOutline(s, nArms, R0Mul, ampMul, pinchPow, aspectY, ripple);
    const cx = s * 0.5;
    const cy = s * 0.5;
    ctx.beginPath();
    for (let j = 0; j < outline.length; j++) {
      const p = outline[j];
      const x = cx + p.x;
      const y = cy + p.y;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
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

  /** 巨字 mask / 测量：与 DOM `--font-app`、画布 `drawGlyph` 同置 LXGW 于前，减少「屏上字 vs 离屏量」口径漂移（仍保留无衬线回退以保字腔几何）。 */
  const FONT_MACRO_CJK_OPEN =
    '"LXGW WenKai","LXGW WenKai Screen","Noto Sans SC","Source Han Sans SC","Noto Sans CJK SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei UI","Liberation Sans",sans-serif';
  const FONT_SILHOUETTE_MONO =
    'ui-monospace,"Cascadia Code","SFMono-Regular","Consolas","Liberation Mono",monospace';
  /** 颜文字：混排符号，不用纯等宽，避免缺字形 */
  const FONT_SILHOUETTE_KAO =
    '"LXGW WenKai","Noto Sans SC","Noto Sans CJK SC","Segoe UI Symbol",sans-serif';

  /**
   * 巨字/剪影用：与 buildTextSilhouetteLayout 完全一致的绘制逻辑（供采样与像素计数复用）。
   */
  function createMacroTextDraw(raw, drawOpts) {
    const doa = drawOpts || {};
    const text = String(raw || "字").trim() || "字";
    const kao = doa.kao;
    const noStroke = !!doa.noStroke;
    const forceMono = doa.mono;
    const hasHan = /[\u3400-\u9fff\uf900-\ufadf]/.test(text.replace(/\n/g, ""));
    const fontStack = kao
      ? FONT_SILHOUETTE_KAO
      : forceMono || !hasHan
        ? FONT_SILHOUETTE_MONO
        : FONT_MACRO_CJK_OPEN;
    const fontWeight = kao ? "700" : "600";
    return (ctx, s) => {
      ctx.fillStyle = "#000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = text
        .split(/\n/)
        .map((ln) => ln.trim())
        .filter(Boolean);
      const useLines = lines.length ? lines : [text];
      const joined = useLines.join("");
      const gLen = Math.max(2, segmentStringGraphemes(joined).length);
      let fs = s * 0.52 * Math.min(1, 8.5 / gLen);
      const maxW = s * 0.9;
      for (let iter = 0; iter < 26; iter++) {
        ctx.font = `${fontWeight} ${fs}px ${fontStack}`;
        let ok = true;
        for (const ln of useLines) {
          if (ctx.measureText(ln).width > maxW) {
            ok = false;
            break;
          }
        }
        if (ok && fs <= s * 0.58) break;
        fs *= 0.9;
      }
      fs = Math.max(fs, s * 0.055);
      ctx.font = `${fontWeight} ${fs}px ${fontStack}`;
      const cx = s * 0.5;
      const lh = fs * 1.18;
      const cy0 = s * 0.52 - (lh * (useLines.length - 1)) / 2;
      for (let li = 0; li < useLines.length; li++) {
        const ln = useLines[li];
        const cy = cy0 + li * lh;
        if (!kao && !noStroke) {
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.lineWidth = Math.max(fs * 0.07, 1.15);
          ctx.strokeStyle = "#000";
          ctx.strokeText(ln, cx, cy);
        }
        ctx.fillText(ln, cx, cy);
      }
    };
  }

  const MACRO_FIT_MODES = ["shrink", "truncate", "wrap2"];
  const MACRO_FIT_LABELS = {
    shrink: "缩字",
    truncate: "截断",
    wrap2: "双行",
  };

  function normalizeMacroFitMode(s) {
    return MACRO_FIT_MODES.indexOf(s) >= 0 ? s : "shrink";
  }

  const MEGA_PRESENTATION_LAYOUT_MODES = ["fit_canvas", "sequential_chars"];
  const MEGA_PRESENTATION_LAYOUT_LABELS = {
    fit_canvas: "拼满画布",
    sequential_chars: "逐字轮换",
  };

  function normalizeMegaPresentationLayoutMode(m) {
    const s = String(m || "").trim();
    return MEGA_PRESENTATION_LAYOUT_MODES.indexOf(s) >= 0
      ? s
      : "fit_canvas";
  }

  /**
   * 巨字测量：复用单离屏 2D 上下文，减少反复 `createElement`（借鉴 Pretext 等
   * 「热路径轻量、测量与绘制同口径」思路；仍不引入外部依赖）。
   */
  let _macroMeasureCtx2d = null;
  function getMacroMeasureContext2d() {
    if (_macroMeasureCtx2d) return _macroMeasureCtx2d;
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    try {
      if (typeof ctx.textRendering === "string") {
        ctx.textRendering = "geometricPrecision";
      }
    } catch (_) {}
    _macroMeasureCtx2d = ctx;
    return _macroMeasureCtx2d;
  }

  /** 字素级拆分（emoji / 代理对等），无 `Intl.Segmenter` 时退回 `Array.from` */
  function segmentStringGraphemes(s) {
    const str = String(s || "");
    try {
      if (typeof Intl !== "undefined" && Intl.Segmenter) {
        try {
          const seg = new Intl.Segmenter(undefined, {
            granularity: "grapheme",
          });
          return Array.from(seg.segment(str), (p) => p.segment);
        } catch (_) {}
      }
      return Array.from(str);
    } catch (_) {
      return Array.from(str);
    }
  }

  /**
   * 与 `createMacroTextDraw` 同逻辑：在给定布局尺度 `Slay` 下收敛字号并返回
   * 各行最大像素宽，供呈现层格距预估（测量先于强排）。
   */
  function measureMacroLayoutMaxWidth(raw, Slay, kao) {
    const ctx = getMacroMeasureContext2d();
    if (!ctx || !(Slay > 0)) return { fs: Slay * 0.12, maxLineW: 0 };
    const text = String(raw || "字").trim() || "字";
    const hasHan = /[\u3400-\u9fff\uf900-\ufadf]/.test(text.replace(/\n/g, ""));
    const fontStack = kao
      ? FONT_SILHOUETTE_KAO
      : !hasHan
        ? FONT_SILHOUETTE_MONO
        : FONT_MACRO_CJK_OPEN;
    const fontWeight = kao ? "700" : "600";
    const lines = text
      .split(/\n/)
      .map((ln) => ln.trim())
      .filter(Boolean);
    const useLines = lines.length ? lines : [text];
    const joined = useLines.join("");
    const gLen = Math.max(2, segmentStringGraphemes(joined).length);
    let fs = Slay * 0.52 * Math.min(1, 8.5 / gLen);
    const maxW = Slay * 0.9;
    for (let iter = 0; iter < 26; iter++) {
      ctx.font = `${fontWeight} ${fs}px ${fontStack}`;
      let ok = true;
      for (const ln of useLines) {
        if (ctx.measureText(ln).width > maxW) {
          ok = false;
          break;
        }
      }
      if (ok && fs <= Slay * 0.58) break;
      fs *= 0.9;
    }
    fs = Math.max(fs, Slay * 0.055);
    ctx.font = `${fontWeight} ${fs}px ${fontStack}`;
    let maxLineW = 0;
    for (const ln of useLines) {
      maxLineW = Math.max(maxLineW, ctx.measureText(ln).width);
    }
    return { fs, maxLineW };
  }

  /**
   * 呈现层短串（2–3 字）也拆行：`macroTextWrapTwoLines` 对 ≤3 字原样返回，
   * 多字巨字易挤乱；此处做 1+1 / 2+1 等轻量分行。
   */
  function macroTextBalancedWrapShort(raw, S) {
    const t0 = String(raw || "").trim() || "字";
    const chars = segmentStringGraphemes(t0);
    const n = chars.length;
    if (n <= 1) return t0;
    if (n === 2) return `${chars[0]}\n${chars[1]}`;
    if (n === 3) {
      const w2 = macroTextWrapTwoLines(t0, S);
      if (w2.indexOf("\n") >= 0) return w2;
      return `${chars[0]}${chars[1]}\n${chars[2]}`;
    }
    return macroTextWrapTwoLines(t0, S);
  }

  /** 呈现巨字「拼满」：按可用画布估算小字格距，多字时略收紧以减叠格。 */
  function computePresentationMegaGridCell(self, S, graphemeCount) {
    const g = Math.max(1, graphemeCount | 0);
    let usable = Math.min(S * 2.05, 520);
    try {
      const inset =
        self.width > 0 ? PB.inset(self.width, self.height) : 0;
      const W = Math.max(120, self.width || S * 2.2);
      const H = Math.max(90, self.height || S * 2.2);
      usable = Math.min(W - inset * 2, H - inset * 2) * 0.58;
    } catch (e) {
      /* ignore */
    }
    const stem = 13.5 + g * 5.4 + (g >= 3 ? 6 : 0);
    let cell = clamp(Math.round(usable / stem), 9, 18);
    try {
      if (typeof self._pickMacroDisplayForLayout === "function") {
        const rawInk =
          String(self._pickMacroDisplayForLayout() || "字").trim() || "字";
        const SlayProbe = S * 0.9;
        const { maxLineW } = measureMacroLayoutMaxWidth(rawInk, SlayProbe, false);
        if (maxLineW > SlayProbe * 0.82) cell = Math.max(9, cell - 1);
        if (maxLineW > SlayProbe * 0.92) cell = Math.max(9, cell - 1);
      }
    } catch (_) {
      /* ignore */
    }
    return cell;
  }

  /** 按画布宽度截断巨字串（与 createMacroTextDraw 字体栈一致）。 */
  function macroTextTruncateToWidth(raw, S, margin) {
    const t0 = String(raw || "").trim() || "字";
    const chars = segmentStringGraphemes(t0);
    const maxW = S * (margin != null ? margin : 0.88);
    const ctx = getMacroMeasureContext2d();
    if (!ctx) return t0;
    const hasHan = /[\u3400-\u9fff\uf900-\ufadf]/.test(t0);
    const fontStack = !hasHan ? FONT_SILHOUETTE_MONO : FONT_MACRO_CJK_OPEN;
    const gLen = Math.max(2, chars.length);
    let fs = S * 0.52 * Math.min(1, 8.5 / gLen);
    for (let iter = 0; iter < 22; iter++) {
      ctx.font = `600 ${fs}px ${fontStack}`;
      if (ctx.measureText(t0).width <= maxW && fs <= S * 0.58) break;
      fs *= 0.9;
    }
    fs = Math.max(fs, S * 0.055);
    ctx.font = `600 ${fs}px ${fontStack}`;
    if (ctx.measureText(t0).width <= maxW) return t0;
    for (let L = chars.length - 1; L >= 1; L--) {
      const sub = chars.slice(0, L).join("");
      if (ctx.measureText(sub).width <= maxW) return sub;
    }
    return chars[0] || "字";
  }

  /** 在首字后切一刀，尽量两行宽度平衡（与双行绘制一致）。 */
  function macroTextWrapTwoLines(raw, S) {
    const t0 = String(raw || "").trim() || "字";
    const chars = segmentStringGraphemes(t0);
    if (chars.length <= 3) return t0;
    const ctx = getMacroMeasureContext2d();
    if (!ctx) return t0;
    const hasHan = /[\u3400-\u9fff\uf900-\ufadf]/.test(t0);
    const fontStack = !hasHan ? FONT_SILHOUETTE_MONO : FONT_MACRO_CJK_OPEN;
    let best = null;
    const maxW = S * 0.42;
    for (let k = 1; k < chars.length; k++) {
      const a = chars.slice(0, k).join("");
      const b = chars.slice(k).join("");
      let fs =
        S * 0.44 * Math.min(1, 8 / Math.max(a.length, b.length, 2));
      let ok = false;
      for (let iter = 0; iter < 20; iter++) {
        ctx.font = `600 ${fs}px ${fontStack}`;
        const wa = ctx.measureText(a).width;
        const wb = ctx.measureText(b).width;
        if (wa <= maxW && wb <= maxW && fs <= S * 0.5) {
          ok = true;
          break;
        }
        fs *= 0.9;
        if (fs < S * 0.05) break;
      }
      if (!ok) continue;
      ctx.font = `600 ${fs}px ${fontStack}`;
      const wa = ctx.measureText(a).width;
      const wb = ctx.measureText(b).width;
      const score = Math.abs(wa - wb);
      if (!best || score < best.score) best = { s: `${a}\n${b}`, score };
    }
    return best ? best.s : t0;
  }

  /** 巨字布局：按小字格距抬升缩放下限，并返回实际布局尺度与已容纳的显示串。 */
  function resolveMegaLayoutInput(self, S) {
    const gc =
      self.gridCell != null
        ? self.gridCell
        : clamp(Math.round(S * 0.042), 13, 19);
    const scaleUser = clamp(
      self.megaLayoutScale != null ? +self.megaLayoutScale : 1,
      0.78,
      1.14
    );
    const minByCell = clamp((gc * 10) / (S * 0.5), 0.76, 0.96);
    const scaleEff = clamp(Math.max(minByCell, scaleUser), 0.76, 1.14);
    const Slay = S * scaleEff;
    const mode = normalizeMacroFitMode(self.macroFitMode);
    const rawFull =
      typeof self._pickMacroDisplayForLayout === "function"
        ? String(self._pickMacroDisplayForLayout() || "字").trim() || "字"
        : String(self._pickMacroDisplay() || "字").trim() || "字";
    const isSeq =
      self.uiArcMode === "presentation" &&
      normalizeMegaPresentationLayoutMode(self.presentationMegaLayoutMode) ===
        "sequential_chars";

    let disp = rawFull;
    if (mode === "truncate") {
      disp = macroTextTruncateToWidth(rawFull, Slay, 0.88);
    } else if (mode === "wrap2") {
      disp = macroTextWrapTwoLines(rawFull, Slay);
    }

    let scaleEffFinal = scaleEff;
    let dispFinal = disp;
    if (
      !isSeq &&
      self.uiArcMode === "presentation" &&
      normalizeMegaPresentationLayoutMode(self.presentationMegaLayoutMode) ===
        "fit_canvas"
    ) {
      const rawTrim = rawFull;
      const gCount = Math.max(1, segmentStringGraphemes(rawTrim).length);
      if (gCount >= 2 && mode !== "truncate") {
        dispFinal = macroTextBalancedWrapShort(rawTrim, S * scaleEffFinal);
      }
      let se = scaleEffFinal;
      for (let it = 0; it < 8; it++) {
        const Stry = S * se;
        const dTry =
          mode === "truncate"
            ? macroTextTruncateToWidth(rawFull, Stry, 0.88)
            : mode === "wrap2"
              ? macroTextWrapTwoLines(rawFull, Stry)
              : gCount >= 2 && mode !== "truncate"
                ? macroTextBalancedWrapShort(rawTrim, Stry)
                : rawTrim;
        const need = 28 + gCount * 34 + (gCount >= 3 ? 24 : 0);
        if (
          suggestMegaGlyphParticleCount(dTry, Stry, gc, {
            densePresentation: true,
          }) >= need ||
          se <= 0.78
        ) {
          break;
        }
        se = Math.max(0.78, se * 0.935);
      }
      scaleEffFinal = se;
      const Sfin = S * scaleEffFinal;
      if (mode === "truncate") {
        dispFinal = macroTextTruncateToWidth(rawFull, Sfin, 0.88);
      } else if (mode === "wrap2") {
        dispFinal = macroTextWrapTwoLines(rawFull, Sfin);
      } else if (gCount >= 2) {
        dispFinal = macroTextBalancedWrapShort(rawTrim, Sfin);
      } else {
        dispFinal = rawTrim;
      }
    }

    if (isSeq) {
      const one =
        String(self._pickMacroDisplay() || "字").trim().slice(0, 4) || "字";
      return { Slay: S * scaleEffFinal, disp: one, gc, mode };
    }

    return { Slay: S * scaleEffFinal, disp: dispFinal, gc, mode };
  }

  /** 巨字粒子估算缓存：fit_canvas 迭代与 setForm 前后会重复问同一 (字串,S,格)；借鉴 Pretext「测量少次、口径一致」。 */
  const _megaSuggestMemo = new Map();
  function megaSuggestMemoKey(text, S, cellEst, dense) {
    return `${dense ? 1 : 0}|${cellEst}|${Math.round(S * 4) / 4}|${text}`;
  }

  /**
   * 巨字粒子数：按剪影填充面积 / 格面积估算；`opts.densePresentation` 为真时
   * 提高目标密度（略减留白乘子），便于呈现层「辨形」而非待机层的壳层水墨感。
   */
  function suggestMegaGlyphParticleCount(displayText, S, cellPx, opts) {
    const o = opts || {};
    const dense = !!o.densePresentation;
    const text = String(displayText || "字").trim() || "字";
    const graphemes = segmentStringGraphemes(text.replace(/\n/g, ""));
    const gcount = Math.max(1, graphemes.length);
    const cellEst =
      cellPx != null && cellPx > 0
        ? cellPx
        : clamp(Math.round(S * 0.043), 12, 20);
    const mkey = megaSuggestMemoKey(text, S, cellEst, dense);
    if (_megaSuggestMemo.has(mkey)) return _megaSuggestMemo.get(mkey);

    const draw = createMacroTextDraw(text, { noStroke: true });
    const sampleS = Math.min(420, Math.round(S));
    const scaleRel = S / sampleS;
    const fillPx = countSilhouetteFillPixels(draw, S, sampleS);
    const areaLogical = fillPx * scaleRel * scaleRel;
    const cellPack = dense ? 0.86 : 0.92;
    const cellArea = cellEst * cellEst * cellPack;
    const voidFrac = dense
      ? clamp(0.055 + 0.009 * gcount, 0.05, 0.16)
      : clamp(0.2 + 0.021 * gcount, 0.19, 0.36);
    let n = Math.floor((areaLogical * (1 - voidFrac)) / Math.max(cellArea, 1));
    const shellPx = countSilhouetteBandPixels(draw, S, sampleS, 3);
    const bandLogical = shellPx * scaleRel * scaleRel;
    const nBand = Math.ceil(bandLogical / Math.max(cellArea * (dense ? 0.5 : 0.58), 1));
    n = Math.max(n, nBand);
    n = Math.max(n, (dense ? 32 : 20) + (dense ? 16 : 12) * gcount);
    const out = clamp(n, dense ? 34 : 28, 250);
    if (_megaSuggestMemo.size > 64) _megaSuggestMemo.clear();
    _megaSuggestMemo.set(mkey, out);
    return out;
  }

  /**
   * 呈现层巨字：按 mask 栅格与格距估算「一格一字」上限，略留空位给华容道；
   * 须在 `rasterizeMask` 之后调用（依赖 `mp.scale`）。
   */
  function presentationMegaParticleCapFromMask(mp, cellW) {
    if (!mp || mp.fillCount == null) return 250;
    const cW = Math.max(8, cellW || 12);
    const scaleM =
      mp.scale != null && mp.scale > 0 ? +mp.scale : mp.w / 320;
    const cellPx = Math.max(0.55, cW * scaleM);
    const approx = Math.floor(mp.fillCount / Math.max(1, cellPx * cellPx));
    return clamp(Math.floor(approx * 0.985), 32, 250);
  }

  /**
   * 小字粒子铺满任意字符串的笔画轮廓（与 sampleSilhouette 同源栅格采样）。
   * opts.kao：颜文字专用字体栈；否则无 CJK 时用等宽（数字/ASCII），有汉字用-serif。
   * opts.shellSample：真=仅外圈薄墨壳（待机水墨感）；假=**全不透明笔画**步进抽样（呈现辨形）。
   * opts.inkFpsSampling：假分支内用栅格点云 + 最远点采样（FPS）近似蓝噪声铺点，减轻扫描条纹。
   * spread / enforce 在两种采样后统一执行；仅 shell 路径在末尾做 snapTargetsToShellPx。
   */
  function buildTextSilhouetteLayout(raw, n, S, opts) {
    const o = opts || {};
    const draw = createMacroTextDraw(raw, {
      kao: o.kao,
      mono: o.mono,
      noStroke: o.noStroke,
    });
    const kao = o.kao;
    let targets;
    let shellMeta = null;
    const capFill = o.cap != null ? o.cap : 420;
    const jitterFill =
      o.jitterScale != null ? o.jitterScale : kao ? 0.05 : 0.018;
    const phaseFromRaw = () => {
      let h = ((n | 0) * 1103515245) | 0;
      const rs = String(raw || "");
      for (let i = 0; i < rs.length; i++) {
        h = (Math.imul(h, 31) + rs.charCodeAt(i)) | 0;
      }
      return h >>> 0;
    };
    if (o.shellSample) {
      shellMeta = o.snapToShell !== false ? {} : null;
      targets = sampleSilhouetteShell(draw, S, n, {
        cap: o.cap != null ? o.cap : 400,
        shellMax: o.shellMax != null ? o.shellMax : 3,
        jitterScale: o.jitterScale != null ? o.jitterScale : 0.008,
      }, shellMeta);
    } else if (o.inkFpsSampling) {
      const ink = collectSilhouetteInkPointsWorld(draw, S, capFill);
      const pts0 = ink.pts;
      if (!pts0.length) {
        targets = sampleSilhouette(draw, S, n, {
          cap: capFill,
          jitterScale: jitterFill,
          startPhase: o.startPhase != null ? o.startPhase : phaseFromRaw(),
        });
      } else {
        const maxPre = clamp(Math.round(n * 52 + 2200), 3000, 10000);
        const pts = subsampleInkPointsUniform(pts0, maxPre);
        let seedU = 2166136261 ^ ((n | 0) * 2654435761) >>> 0;
        const rs = String(raw || "");
        for (let i = 0; i < rs.length; i++) {
          seedU = Math.imul(seedU ^ rs.charCodeAt(i), 16777619) >>> 0;
        }
        const picked = farthestPointSamplingInk(pts, n, seedU);
        targets = picked.map((p) => ({
          x: p.x + (Math.random() - 0.5) * jitterFill,
          y: p.y + (Math.random() - 0.5) * jitterFill,
        }));
        while (targets.length < n) {
          const p =
            targets[targets.length % Math.max(1, targets.length)] || {
              x: 0,
              y: 0,
            };
          targets.push({ x: p.x + rand(-2, 2), y: p.y + rand(-2, 2) });
        }
        targets = targets.slice(0, n);
      }
    } else {
      targets = sampleSilhouette(draw, S, n, {
        cap: capFill,
        jitterScale: jitterFill,
        startPhase: o.startPhase != null ? o.startPhase : phaseFromRaw(),
      });
    }
    if (o.spreadMin != null && targets.length > 1) {
      spreadTargets2D(
        targets,
        o.spreadMin,
        o.spreadPasses != null ? o.spreadPasses : 4
      );
    }
    if (o.enforceSpacing != null && targets.length > 1) {
      enforceTargetsMinSpacing(
        targets,
        o.enforceSpacing,
        o.enforceSpacingPasses != null ? o.enforceSpacingPasses : 8
      );
    }
    if (
      o.shellSample &&
      shellMeta &&
      shellMeta.pxFlat &&
      shellMeta.pxFlat.length >= 4
    ) {
      const farSq = (Math.max(S * 0.017, 9)) ** 2;
      snapTargetsToShellPx(
        targets,
        shellMeta.pxFlat,
        shellMeta.scale,
        shellMeta.sampleS,
        farSq
      );
      if (o.enforceSpacing != null && targets.length > 1) {
        enforceTargetsMinSpacing(
          targets,
          o.enforceSpacing * 0.92,
          6
        );
      }
    }
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

  /**
   * 点阵「亮」格 → 目标点：按格均分粒子，避免 n>格数 时大量叠在同一点导致计时字形塌缩。
   */
  function rowsToTargets(rows, cell, n, jitter = 0.12) {
    const h = rows.length;
    const w = rows[0] ? rows[0].length : 0;
    const centers = [];
    for (let y = 0; y < h; y++) {
      const row = rows[y] || "";
      for (let x = 0; x < row.length; x++) {
        if (row[x] === "1") {
          centers.push({
            x: (x - w / 2 + 0.5) * cell,
            y: (y - h / 2 + 0.5) * cell,
          });
        }
      }
    }
    const M = centers.length;
    if (M === 0) {
      return Array.from({ length: n }, () => ({ x: 0, y: 0 }));
    }
    const jx = cell * jitter;
    if (n <= M) {
      const out = [];
      const step = Math.max(1, Math.floor(M / Math.max(n, 1)));
      for (let i = 0; i < n; i++) {
        const j = (i * step) % M;
        const c = centers[j];
        out.push({
          x: c.x + rand(-jx, jx) * 0.35,
          y: c.y + rand(-jx, jx) * 0.35,
        });
      }
      return out;
    }
    const out = [];
    const base = Math.floor(n / M);
    let extra = n % M;
    for (let i = 0; i < M; i++) {
      const ki = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
      const c = centers[i];
      for (let s = 0; s < ki; s++) {
        const ang =
          ki <= 1
            ? 0
            : (s / (ki - 1)) * TAU + i * 0.61 + c.x * 0.02;
        const rad = ki <= 1 ? 0 : cell * 0.29 * Math.sqrt(s / (ki - 1));
        out.push({
          x: c.x + Math.cos(ang) * rad + rand(-jx, jx) * 0.4,
          y: c.y + Math.sin(ang) * rad + rand(-jx, jx) * 0.4,
        });
      }
    }
    return out.slice(0, n);
  }

  /** 点阵行 → maskDraw，与 rowsToTargets 同一几何（cellRel = cell/s） */
  function digitRowsMaskDraw(rows, cellRel) {
    return (ctx, s) => {
      const h = rows.length;
      const w = rows[0] ? rows[0].length : 0;
      if (!w || !h) return;
      const cell = s * cellRel;
      const cx = s * 0.5;
      const cy = s * 0.52;
      ctx.fillStyle = "#000";
      for (let y = 0; y < h; y++) {
        const row = rows[y] || "";
        for (let x = 0; x < row.length; x++) {
          if (row[x] === "1") {
            const px = cx + (x - w / 2 + 0.5) * cell;
            const py = cy + (y - h / 2 + 0.5) * cell;
            const hw = cell * 0.46;
            ctx.fillRect(px - hw, py - hw, hw * 2, hw * 2);
          }
        }
      }
    };
  }

  function colonRows() {
    const dot = ".....1.....";
    const emp = "...........";
    return [dot, dot, emp, dot, dot, emp, emp];
  }

  function countTimerOnes(rows) {
    let n = 0;
    for (const row of rows || []) {
      for (let i = 0; i < row.length; i++) {
        if (row[i] === "1") n++;
      }
    }
    return n;
  }

  function getLiveClockRows() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const r1 = mergeDigitRows(digitPattern5x7(hh[0]), 1, digitPattern5x7(hh[1]));
    const rMid = mergeDigitRows(r1, 1, colonRows());
    return mergeDigitRows(
      rMid,
      1,
      mergeDigitRows(digitPattern5x7(mm[0]), 1, digitPattern5x7(mm[1]))
    );
  }

  function getLiveChronoRows() {
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
    return stackDigitRowBlocks(rowHM, rowSec, 2);
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
    const cell = clamp(Math.round(S * 0.052), 13, 26);
    const slots = [];
    let flat = "";
    for (let li = 0; li < useLines.length; li++) {
      const chs = Array.from(useLines[li]);
      flat += useLines[li];
      const rowY = (li - (useLines.length - 1) / 2) * cell * 1.42;
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
        ? (useLines.length - 1) * cell * 1.42 + cell
        : cell * 1.42;
    const blockDy = rowSpan + cell * 0.44;
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
        const cy = s * 0.5 + (li - (useLines.length - 1) / 2) * c * 1.42;
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

    /** 径向触须团：cos₊^p 星形 + 轮廓 mask，适合软体「多触手」意象 */
    soft_ray: {
      label: "触须团",
      build(n, S) {
        const outline = radialSoftBodyOutline(S, 10, 0.1, 0.34, 0.4, 0.86, 0);
        const targets = samplesOnOutlineLoop(outline, n, S * 0.012);
        const R = S * 0.2;
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -R * 0.28, y: -R * 0.15 },
            { x: R * 0.28, y: -R * 0.15 },
          ],
          eyeSize: 1.45,
          maskDraw: (ctx, s) => {
            ctx.fillStyle = "#000";
            fillRadialSoftBodyMask(ctx, s, 10, 0.1, 0.34, 0.4, 0.86, 0);
          },
        };
      },
    },

    /** 卷须：在径向触手上叠加边界 ripple（类 Fourier 描述子低频项） */
    soft_curl: {
      label: "卷须",
      build(n, S) {
        const outline = radialSoftBodyOutline(S, 7, 0.12, 0.36, 0.38, 0.9, 0.11);
        const targets = samplesOnOutlineLoop(outline, n, S * 0.013);
        const R = S * 0.2;
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -R * 0.26, y: -R * 0.12 },
            { x: R * 0.26, y: -R * 0.12 },
          ],
          eyeSize: 1.4,
          maskDraw: (ctx, s) => {
            ctx.fillStyle = "#000";
            fillRadialSoftBodyMask(ctx, s, 7, 0.12, 0.36, 0.38, 0.9, 0.11);
          },
        };
      },
    },

    /** 水母：钟形伞 + 贝塞尔拖须（笔画栅格采样，非闭合径向式） */
    soft_medusa: {
      label: "水母",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          const cx = s * 0.5;
          const cy = s * 0.42;
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.22, cy + s * 0.06);
          ctx.bezierCurveTo(
            cx - s * 0.28,
            cy - s * 0.2,
            cx + s * 0.28,
            cy - s * 0.2,
            cx + s * 0.22,
            cy + s * 0.06
          );
          ctx.quadraticCurveTo(cx, cy + s * 0.15, cx - s * 0.22, cy + s * 0.06);
          ctx.fill();

          ctx.strokeStyle = "#000";
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          const nt = 9;
          for (let i = 0; i < nt; i++) {
            const u = i / (nt - 1 || 1);
            const ox = (u - 0.5) * 2;
            const wob = 0.88 + 0.12 * Math.sin(i * 1.73);
            ctx.beginPath();
            ctx.lineWidth = s * 0.036 * wob;
            ctx.moveTo(cx + ox * s * 0.08, cy + s * 0.08);
            ctx.bezierCurveTo(
              cx + ox * s * 0.26,
              cy + s * 0.22,
              cx + ox * s * 0.18,
              cy + s * 0.36,
              cx + ox * s * 0.24,
              cy + s * 0.5 * wob
            );
            ctx.stroke();
          }
        }, S, n);
        const R = S * 0.18;
        return {
          targets,
          eyes: [
            { x: -R * 0.35, y: -R * 0.55 },
            { x: R * 0.35, y: -R * 0.55 },
          ],
          eyeSize: 1.25,
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
    kao_party: {
      label: "颜·舞",
      build(n, S) {
        return buildTextSilhouetteLayout("＼(^o^)／", n, S, { kao: true });
      },
    },
    kao_angry: {
      label: "颜·气",
      build(n, S) {
        return buildTextSilhouetteLayout("(╬﹏╬)", n, S, { kao: true });
      },
    },
    kao_love: {
      label: "颜·爱",
      build(n, S) {
        return buildTextSilhouetteLayout("(♡‿♡)", n, S, { kao: true });
      },
    },
    kao_sleep: {
      label: "颜·眠",
      build(n, S) {
        return buildTextSilhouetteLayout("(－ω－)zZ", n, S, { kao: true });
      },
    },
    kao_spark: {
      label: "颜·闪",
      build(n, S) {
        return buildTextSilhouetteLayout("(☆▽☆)", n, S, { kao: true });
      },
    },
    kao_shrug: {
      label: "颜·摊",
      build(n, S) {
        return buildTextSilhouetteLayout("¯\\_(ツ)_/¯", n, S, { kao: true });
      },
    },

    clock: {
      label: "计时",
      build(n, S) {
        const rows = getLiveClockRows();
        const cellRel = 0.05;
        const cell = S * cellRel;
        const targets = rowsToTargets(rows, cell, n, 0.05);
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -S * 0.25, y: -S * 0.32 },
            { x: S * 0.25, y: -S * 0.32 },
          ],
          eyeSize: 1,
          maskDraw: digitRowsMaskDraw(rows, cellRel),
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
        const rows = getLiveChronoRows();
        const cellRel = 0.042;
        const cell = S * cellRel;
        const targets = rowsToTargets(rows, cell, n, 0.045);
        return {
          targets,
          ordered: true,
          eyes: [
            { x: -S * 0.22, y: -S * 0.36 },
            { x: S * 0.22, y: -S * 0.36 },
          ],
          eyeSize: 0.92,
          maskDraw: digitRowsMaskDraw(rows, cellRel),
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

  /** 待机数学曲线：李萨如变体、蔷薇瓣数、内外旋轮线、经典平面闭曲线 */
  (function registerStandbyMathForms() {
    const eyePair = (S) => [
      { x: -S * 0.1, y: -S * 0.22 },
      { x: S * 0.1, y: -S * 0.22 },
    ];

    function lissajousMaskDraw(ctx, s, a, b, ph, cycles, Rm) {
      const cx = s * 0.5;
      const cy = s * 0.52;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = s * 0.09;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const steps = 300;
      for (let k = 0; k <= steps; k++) {
        const u = (k / steps) * TAU * cycles;
        const x = cx + Math.sin(a * u + ph) * Rm;
        const y = cy + Math.sin(b * u) * Rm * 0.92;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    function addLissajous(id, label, a, b, ph, cycles = 2) {
      FORMS[id] = {
        label,
        build(n, S) {
          const R = S * 0.34;
          const targets = [];
          for (let i = 0; i < n; i++) {
            const u = (i / Math.max(n, 1)) * TAU * cycles;
            targets.push({
              x: Math.sin(a * u + ph) * R,
              y: Math.sin(b * u) * R * 0.92,
            });
          }
          return {
            targets,
            ordered: true,
            eyes: eyePair(S),
            eyeSize: 1.22,
            maskDraw: (ctx, s) =>
              lissajousMaskDraw(ctx, s, a, b, ph, cycles, s * 0.34),
          };
        },
      };
    }

    function addRoseK(id, label, k) {
      const steps = 480;
      FORMS[id] = {
        label,
        build(n, S) {
          const R = S * 0.34;
          const outline = [];
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
            eyes: eyePair(S),
            eyeSize: 1.18,
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
      };
    }

    function addTrochoid(id, label, Rf, rf, df, epi, turns = 3) {
      FORMS[id] = {
        label,
        build(n, S) {
          const R = S * Rf;
          const r = S * rf;
          const d = S * df;
          const targets = [];
          const span = TAU * turns;
          for (let i = 0; i < n; i++) {
            const t = (i / Math.max(n, 1)) * span;
            let x;
            let y;
            if (epi) {
              x = (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t);
              y = (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t);
            } else {
              x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
              y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
            }
            targets.push({ x, y: y * 0.92 });
          }
          return {
            targets,
            ordered: true,
            eyes: eyePair(S),
            eyeSize: 1.15,
            maskDraw: (ctx, s) => {
              const Rk = s * Rf;
              const rk = s * rf;
              const dk = s * df;
              ctx.strokeStyle = "#000";
              ctx.lineWidth = s * 0.085;
              ctx.lineCap = "round";
              ctx.lineJoin = "round";
              ctx.beginPath();
              const steps = Math.round(240 * turns);
              for (let k = 0; k <= steps; k++) {
                const t = (k / steps) * span;
                let x;
                let y;
                if (epi) {
                  x =
                    s * 0.5 +
                    (Rk + rk) * Math.cos(t) -
                    dk * Math.cos(((Rk + rk) / rk) * t);
                  y =
                    s * 0.52 +
                    (Rk + rk) * Math.sin(t) -
                    dk * Math.sin(((Rk + rk) / rk) * t);
                } else {
                  x =
                    s * 0.5 +
                    (Rk - rk) * Math.cos(t) +
                    dk * Math.cos(((Rk - rk) / rk) * t);
                  y =
                    s * 0.52 +
                    (Rk - rk) * Math.sin(t) -
                    dk * Math.sin(((Rk - rk) / rk) * t);
                }
                if (k === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.stroke();
            },
          };
        },
      };
    }

    function addPolarLoop(id, label, rFn, steps = 640) {
      FORMS[id] = {
        label,
        build(n, S) {
          const R = S * 0.34;
          const outline = [];
          for (let j = 0; j < steps; j++) {
            const t = (j / steps) * TAU;
            const rp = rFn(t);
            outline.push({
              x: rp * Math.cos(t) * R,
              y: rp * Math.sin(t) * R * 0.92,
            });
          }
          const targets = samplesOnOutlineLoop(outline, n, S * 0.012);
          return {
            targets,
            ordered: true,
            eyes: eyePair(S),
            eyeSize: 1.15,
            maskDraw: (ctx, s) => {
              const Rm = s * 0.34;
              ctx.fillStyle = "#000";
              ctx.beginPath();
              for (let j = 0; j <= steps; j++) {
                const t = (j / steps) * TAU;
                const rp = rFn(t) * Rm;
                const x = s * 0.5 + rp * Math.cos(t);
                const y = s * 0.52 + rp * Math.sin(t) * 0.92;
                if (j === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.closePath();
              ctx.fill();
            },
          };
        },
      };
    }

    function addParamLoop(id, label, xyFn, steps = 560) {
      FORMS[id] = {
        label,
        build(n, S) {
          const R = S * 0.34;
          const outline = [];
          for (let j = 0; j < steps; j++) {
            const t = (j / steps) * TAU;
            const p = xyFn(t);
            outline.push({ x: p.x * R, y: p.y * R * 0.92 });
          }
          const targets = samplesOnOutlineLoop(outline, n, S * 0.012);
          return {
            targets,
            ordered: true,
            eyes: eyePair(S),
            eyeSize: 1.15,
            maskDraw: (ctx, s) => {
              const Rm = s * 0.34;
              ctx.fillStyle = "#000";
              ctx.beginPath();
              for (let j = 0; j <= steps; j++) {
                const t = (j / steps) * TAU;
                const p = xyFn(t);
                const x = s * 0.5 + p.x * Rm;
                const y = s * 0.52 + p.y * Rm * 0.92;
                if (j === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.closePath();
              ctx.fill();
            },
          };
        },
      };
    }

    addLissajous("liss_43", "李萨如·4:3", 4, 3, 0.55, 2);
    addLissajous("liss_54", "李萨如·5:4", 5, 4, 0.2, 2);
    addLissajous("liss_56", "李萨如·5:6", 5, 6, 0.4, 2);
    addLissajous("liss_75", "李萨如·7:5", 7, 5, 0.65, 2);
    addLissajous("liss_85", "李萨如·8:5", 8, 5, 0.3, 2);

    addRoseK("rose_2", "蔷薇·2瓣", 2);
    addRoseK("rose_3", "蔷薇·3瓣", 3);
    addRoseK("rose_4", "蔷薇·4瓣", 4);
    addRoseK("rose_6", "蔷薇·6瓣", 6);
    addRoseK("rose_7", "蔷薇·7瓣", 7);
    addRoseK("rose_8", "蔷薇·8瓣", 8);

    addTrochoid("tro_hyp_a", "内旋·宽", 0.24, 0.065, 0.11, false, 3);
    addTrochoid("tro_hyp_b", "内旋·紧", 0.2, 0.095, 0.065, false, 3);
    addTrochoid("tro_ep_a", "外旋·A", 0.14, 0.07, 0.095, true, 2);
    addTrochoid("tro_ep_b", "外旋·B", 0.12, 0.055, 0.08, true, 3);

    addPolarLoop(
      "cv_cardioid",
      "心脏线",
      (t) => 0.55 * (1 + Math.cos(t)),
      520
    );
    addParamLoop("cv_astroid", "星形线", (t) => {
      const c = Math.cos(t);
      const si = Math.sin(t);
      return { x: c * c * c, y: si * si * si };
    });
    addParamLoop("cv_deltoid", "三尖内摆", (t) => {
      return {
        x: (2 * Math.cos(t) + Math.cos(2 * t)) / 3.2,
        y: (2 * Math.sin(t) - Math.sin(2 * t)) / 3.2,
      };
    });
    addParamLoop("cv_nephroid", "肾形线", (t) => {
      return {
        x: 0.45 * (3 * Math.cos(t) - Math.cos(3 * t)),
        y: 0.38 * (3 * Math.sin(t) - Math.sin(3 * t)),
      };
    });
    addParamLoop("cv_hypo5", "五角内摆", (t) => {
      return {
        x: (4 * Math.cos(t) + Math.cos(4 * t)) / 5.5,
        y: (4 * Math.sin(t) - Math.sin(4 * t)) / 5.5,
      };
    });
    addParamLoop("cv_super3", "超椭圆·3", (t) => {
      const n = 3;
      const np = 2 / n;
      return {
        x: Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), np),
        y: Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), np),
      };
    });
    addParamLoop("cv_super2p5", "超椭圆·2.5", (t) => {
      const n = 2.5;
      const np = 2 / n;
      return {
        x: Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), np),
        y: Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), np),
      };
    });
    addParamLoop("cv_butterfly", "蝶形线", (t) => {
      const ex =
        Math.exp(Math.cos(t)) -
        2 * Math.cos(4 * t) +
        Math.pow(Math.sin(t / 12), 5);
      return { x: Math.sin(t) * ex * 0.22, y: Math.cos(t) * ex * 0.22 };
    });
    addParamLoop("cv_heart", "心形参数", (t) => {
      const si = Math.sin(t);
      return {
        x: 0.2 * Math.pow(si, 3),
        y:
          0.05 *
          (13 * Math.cos(t) -
            5 * Math.cos(2 * t) -
            2 * Math.cos(3 * t) -
            Math.cos(4 * t)),
      };
    });
    addParamLoop("cv_oval", "扁圆· Cassini 近似", (t) => {
      const a = 1.05;
      const b = 0.72;
      return { x: a * Math.cos(t), y: b * Math.sin(t) };
    });
    addParamLoop("cv_gear", "齿轮波", (t) => {
      const k = 7;
      const r = 0.72 + 0.28 * Math.cos(k * t);
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    });
    addParamLoop("cv_star5", "五角波", (t) => {
      const k = 5;
      const r = 0.55 + 0.45 * Math.abs(Math.cos((k * t) / 2));
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    });
  })();

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

  /**
   * 仅文稿/计时/数字：整体巡逻与单字游走都关闭，避免读数被打散。
   */
  function isMotionLayoutLockedForm(form) {
    if (!form) return false;
    if (form === "script" || form === "clock" || form === "chrono") return true;
    if (String(form).startsWith("digit_")) return true;
    return false;
  }

  /**
   * 目标几何不可破坏（螺旋挤占会破坏巨字/曲线轮廓），但允许内部格点华容道式移动。
   */
  function isGridLayoutImmutableForm(form) {
    if (!form) return false;
    if (form === "script" || form === "clock" || form === "chrono") return true;
    if (String(form).startsWith("digit_")) return true;
    if (form === "mega" || String(form).startsWith("kao_")) return true;
    if (
      form === "lissajous" ||
      form === "spiro" ||
      form === "flower" ||
      form === "rose" ||
      form === "lemniscate" ||
      form === "fourier" ||
      /^(liss_|rose_|tro_|cv_)/.test(String(form))
    )
      return true;
    return false;
  }

  /**
   * 运动模态：**呈现**（计时、巨字、颜文字轮廓）——低幅、低速，利于辨形；
   * 其余形态为 **待机**（数学曲线、软团等），保持原有灵动幅度。
   */
  function isDisplayPresentationForm(form) {
    if (!form) return false;
    if (form === "clock" || form === "chrono" || form === "mega") return true;
    if (String(form).startsWith("kao_")) return true;
    return false;
  }

  /** 有 mask 栅格的巨字 / 颜文字剪影（待机与呈现共用几何约束） */
  function isMaskBackedMegaKao(self) {
    if (!self || self.viewMode !== "pet") return false;
    if (!self._maskPack || !self._maskPack.grid) return false;
    const f = self.form;
    return f === "mega" || String(f || "").startsWith("kao_");
  }

  /** 呈现层 + 剪影 mask：和谐场 + 淡出补位（比 isMaskBackedMegaKao 多一层 UI 模式） */
  function isPresentationSilhouetteHarm(self) {
    return self.uiArcMode === "presentation" && isMaskBackedMegaKao(self);
  }

  /** 侧栏「轨」：有 mask 的巨字/颜文字躯体运动范式（待机/呈现各记一套） */
  const BODY_MOTION_STYLES = ["harmonic", "snake_stream", "contour_drift"];

  const BODY_MOTION_LABELS = {
    harmonic: "① 横竖谐步（离散格、一字一格）",
    snake_stream: "② 序贯廊道（可走格走廊、一队字滑移）",
    contour_drift: "③ 壳内漫游（随机游走，易叠字）",
  };

  function normalizeBodyMotionStyle(s) {
    return BODY_MOTION_STYLES.indexOf(s) >= 0 ? s : "harmonic";
  }

  /** 非格移弹簧轨下的纹理调度（P3）；与 mask 内「轨」`bodyMotionStyle` 正交 */
  const TEXTURE_MOTION_MODES = ["spring_flow", "adjacent_swap"];
  const TEXTURE_MOTION_LABELS = {
    spring_flow: "流 · 弹簧纹理（默认）",
    adjacent_swap: "序 · 芯层邻接换位（关格移时）",
  };

  function normalizeTextureMotionMode(m) {
    return TEXTURE_MOTION_MODES.indexOf(m) >= 0 ? m : "spring_flow";
  }

  function usesMaskSnakeStream(self) {
    return (
      isMaskBackedMegaKao(self) &&
      normalizeBodyMotionStyle(self.bodyMotionStyle) === "snake_stream"
    );
  }

  function usesContourDrift(self) {
    return (
      isMaskBackedMegaKao(self) &&
      normalizeBodyMotionStyle(self.bodyMotionStyle) === "contour_drift"
    );
  }

  /** 谐波：mask 内以离散格目标驱动曼哈顿步进；「颤」只影响亚像素绘制偏移，不再关掉离散谐步（避免叠乱与「不像格点」） */
  function silhouetteStrictHarmonicGrid(self) {
    return (
      isMaskBackedMegaKao(self) &&
      normalizeBodyMotionStyle(self.bodyMotionStyle) === "harmonic" &&
      !usesMaskSnakeStream(self) &&
      !usesContourDrift(self)
    );
  }

  const SNAKE_PATH_VARIANTS = ["spiral", "zigzag"];

  function normalizeSnakePathVariant(v) {
    return v === "zigzag" ? "zigzag" : "spiral";
  }

  /** 侧栏「待机」模式：体内运动保持全倍率（与 3.15 前一致）。 */
  const STANDBY_MOTION_KERNELS = {
    id: "standby",
    timeScale: 1,
    ampScale: 1,
    wanderRadScale: 1,
    wanderPickIntervalMul: 1,
    anchorAmpScale: 1,
    huarongCooldownMul: 1,
    megaSlideCooldownMul: 1,
    crispMicroScale: 1,
    springFollowScale: 1,
    breathMix: 1,
  };

  /** 侧栏「呈现」模式：压低时间尺度与振幅，利于辨形（计时/巨字/颜文字共用）。 */
  const DISPLAY_MOTION_KERNELS = {
    id: "display",
    timeScale: 0.32,
    ampScale: 0.24,
    wanderRadScale: 0.48,
    wanderPickIntervalMul: 1.72,
    anchorAmpScale: 0.4,
    huarongCooldownMul: 2.45,
    megaSlideCooldownMul: 2.85,
    crispMicroScale: 0.4,
    springFollowScale: 0.82,
    breathMix: 0.48,
  };

  /**
   * 实际生效的运动内核：**仅由** `Pet.uiArcMode`（侧栏 待机/呈现）决定，
   * 不再按形态名推导——避免「计时被 layoutLock 跳过缩放、曲线却被全局乘子拖慢」的错位。
   */
  function getMotionProfileKernelsForPet(self) {
    return self.uiArcMode === "presentation"
      ? DISPLAY_MOTION_KERNELS
      : STANDBY_MOTION_KERNELS;
  }

  /** 呈现层剪影（巨字 / 颜文字）：在 DISPLAY 内核上再压低，轮廓优先 */
  function mergePresentationSilhouetteMotion(self, mk) {
    if (!isPresentationSilhouetteHarm(self)) return mk;
    const dynOn = !!self.presentationGlyphDynamics;
    /** 开内动时再略压时间/振幅，减轻「过快、难辨形」；关内动仍走下方 sleep 支路 */
    const ts0 = dynOn ? 0.31 : 0.42;
    const amp0 = dynOn ? 0.18 : 0.26;
    let out = {
      ...mk,
      timeScale: mk.timeScale * ts0,
      ampScale: mk.ampScale * amp0,
      crispMicroScale: Math.min(0.22, mk.crispMicroScale * 0.28),
      anchorAmpScale: mk.anchorAmpScale * 0.48,
      springFollowScale: mk.springFollowScale * 0.85,
      breathMix: Math.min(0.88, mk.breathMix + 0.22),
    };
    /** 呈现层「体内动」关：先静态辨形（仅格位/垫底），与侧栏「动」键对应 */
    if (!self.presentationGlyphDynamics) {
      out = {
        ...out,
        timeScale: out.timeScale * 0.32,
        ampScale: out.ampScale * 0.15,
        crispMicroScale: Math.min(0.08, out.crispMicroScale * 0.4),
        anchorAmpScale: out.anchorAmpScale * 0.35,
        springFollowScale: out.springFollowScale * 0.92,
        wanderRadScale: out.wanderRadScale * 0.12,
      };
    }
    return out;
  }

  /**
   * 层级 `mk.timeScale`（待机 1、呈现压低、剪影再压低）与侧栏「速」`gms0` 的组合：
   * 旧实现用 `gms = gms0 * timeScale`，在呈现+剪影下 timeScale 可至 ~0.14，导致节拍/格移/流体相位几乎不随「速」变化。
   * 这里用 **凸组合** 保留「层越冷静越快不起来」的趋势，但为 `gms0` 留出下限通道，使速键始终可感知。
   */
  function motionTimeBlend(mkTimeScale) {
    const ts = clamp(mkTimeScale != null ? +mkTimeScale : 1, 0.12, 1);
    const floor = 0.37;
    return floor + (1 - floor) * ts;
  }

  /** 兼容旧调用 / 调试：按形态名推测内核（不等同于运行时逻辑）。 */
  function getMotionProfileKernels(form) {
    return isDisplayPresentationForm(form)
      ? DISPLAY_MOTION_KERNELS
      : STANDBY_MOTION_KERNELS;
  }

  function snapshotArcVisualPrefs(self) {
    const b = self._arcPrefs[self.uiArcMode];
    b.glyphMotionSpeed = clamp(self.glyphMotionSpeed, 0.25, 2.5);
    b.bodyTintHex = self.bodyTintHex;
    b.glowMode = self.glowMode | 0;
    b.bodyColorMode = self.bodyColorMode | 0;
    b.fluidStrength = clamp(
      self.fluidStrength != null ? +self.fluidStrength : 0.2,
      0,
      0.55
    );
    b.gridMarchSpeed = clamp(
      self.gridMarchSpeed != null ? +self.gridMarchSpeed : 2,
      0.85,
      3.6
    );
    b.megaParticleMul = clamp(
      b.megaParticleMul != null ? +b.megaParticleMul : 1,
      0.72,
      1.28
    );
    b.bodyMotionStyle = normalizeBodyMotionStyle(self.bodyMotionStyle);
    b.glyphsJitter = !!self.silhouetteGlyphJitter;
    b.silhouetteMatteUnderlay = !!self.silhouetteMatteUnderlay;
    b.outlineContourFirst = !!self.outlineContourFirst;
    b.textureMotionMode = normalizeTextureMotionMode(self.textureMotionMode);
    if (self.uiArcMode === "presentation") {
      b.presentationGlyphDynamics = !!self.presentationGlyphDynamics;
    }
    b.macroFitMode = normalizeMacroFitMode(self.macroFitMode);
    b.megaLayoutScale = clamp(
      self.megaLayoutScale != null ? +self.megaLayoutScale : 1,
      0.78,
      1.14
    );
    b.bodyGlyphEmMul = clamp(
      self.bodyGlyphEmMul != null ? +self.bodyGlyphEmMul : 1,
      0.82,
      1.18
    );
    b.silhouetteJitterAmpMul = clamp(
      self.silhouetteJitterAmpMul != null ? +self.silhouetteJitterAmpMul : 1,
      0.45,
      1.45
    );
    self._arcPrefs.presentation.presentationMegaLayoutMode =
      normalizeMegaPresentationLayoutMode(self.presentationMegaLayoutMode);
  }

  function applyArcVisualPrefsToPet(self) {
    const b = self._arcPrefs[self.uiArcMode];
    self.glyphMotionSpeed = clamp(b.glyphMotionSpeed, 0.25, 2.5);
    self.bodyTintHex = b.bodyTintHex;
    self.glowMode = b.glowMode | 0;
    self.bodyColorMode = b.bodyColorMode | 0;
    self.fluidStrength = clamp(
      b.fluidStrength != null ? +b.fluidStrength : 0.2,
      0,
      0.55
    );
    self.gridMarchSpeed = clamp(
      b.gridMarchSpeed != null ? +b.gridMarchSpeed : 2,
      0.85,
      3.6
    );
    self.bodyMotionStyle = normalizeBodyMotionStyle(b.bodyMotionStyle);
    self.silhouetteGlyphJitter = !!b.glyphsJitter;
    self.silhouetteMatteUnderlay = !!b.silhouetteMatteUnderlay;
    self.outlineContourFirst = !!b.outlineContourFirst;
    self.textureMotionMode = normalizeTextureMotionMode(b.textureMotionMode);
    self.presentationGlyphDynamics =
      self.uiArcMode === "presentation"
        ? !!b.presentationGlyphDynamics
        : !!self._arcPrefs.presentation.presentationGlyphDynamics;
    self.macroFitMode = normalizeMacroFitMode(
      b.macroFitMode != null ? b.macroFitMode : "shrink"
    );
    self.megaLayoutScale = clamp(
      b.megaLayoutScale != null ? +b.megaLayoutScale : 1,
      0.78,
      1.14
    );
    self.bodyGlyphEmMul = clamp(
      b.bodyGlyphEmMul != null ? +b.bodyGlyphEmMul : 1,
      0.82,
      1.18
    );
    self.silhouetteJitterAmpMul = clamp(
      b.silhouetteJitterAmpMul != null ? +b.silhouetteJitterAmpMul : 1,
      0.45,
      1.45
    );
    self.presentationMegaLayoutMode = normalizeMegaPresentationLayoutMode(
      self._arcPrefs.presentation.presentationMegaLayoutMode
    );
    self.motionProfile =
      self.uiArcMode === "presentation" ? "display" : "standby";
    /** 呈现巨字/颜：壳漫游与「小字拼轮廓」目标冲突，强制回到横竖谐步 */
    if (
      self.uiArcMode === "presentation" &&
      isMaskBackedMegaKao(self) &&
      normalizeBodyMotionStyle(self.bodyMotionStyle) === "contour_drift"
    ) {
      self.bodyMotionStyle = "harmonic";
      self._arcPrefs.presentation.bodyMotionStyle = "harmonic";
    }
  }

  function buildFormLayoutData(self, name, n, S, resolvedMegaCache) {
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
      const gc =
        self.gridCell != null
          ? self.gridCell
          : clamp(Math.round(S * 0.042), 13, 19);
      const pres = self.uiArcMode === "presentation";
      const { Slay, disp } =
        resolvedMegaCache &&
        resolvedMegaCache.Slay > 0 &&
        String(resolvedMegaCache.disp || "").length
          ? resolvedMegaCache
          : resolveMegaLayoutInput(self, S);
      const dispFlat = String(disp || "字").replace(/\n/g, "");
      const gLen = Math.max(1, segmentStringGraphemes(dispFlat).length);
      const presOne = pres && gLen <= 1;
      if (pres) {
        /** 呈现层：全笔画撒点 + 较紧 spread/enforce，优先「可辨形」；待机见 shellSample 分支 */
        return buildTextSilhouetteLayout(disp, n, Slay, {
          shellSample: false,
          inkFpsSampling: true,
          noStroke: true,
          cap: 480,
          spreadMin:
            Math.max(Slay * 0.028, gc * 0.72) * (presOne ? 0.95 : 1),
          spreadPasses: presOne ? 22 : 20,
          jitterScale: 0.001,
          enforceSpacing:
            Math.max(Slay * 0.034, gc * 0.84) * (presOne ? 0.93 : 1),
          enforceSpacingPasses: presOne ? 30 : 26,
        });
      }
      return buildTextSilhouetteLayout(disp, n, Slay, {
        shellSample: true,
        noStroke: true,
        shellMax: 3,
        cap: 420,
        spreadMin: Math.max(S * 0.051, gc * 1.02),
        spreadPasses: 12,
        jitterScale: 0.0022,
        enforceSpacing: Math.max(S * 0.054, gc * 1.12),
        enforceSpacingPasses: 16,
        snapToShell: true,
      });
    }
    if (name === "clock") {
      const sec = self.clockGranularity === "sec";
      const rows = sec ? getLiveChronoRows() : getLiveClockRows();
      const cellRel = sec ? 0.042 : 0.05;
      const cell = S * cellRel;
      const jitter = sec ? 0.045 : 0.05;
      const targets = rowsToTargets(rows, cell, n, jitter);
      return {
        targets,
        ordered: true,
        eyes: [
          { x: -S * 0.25, y: -S * 0.32 },
          { x: S * 0.25, y: -S * 0.32 },
        ],
        eyeSize: 1,
        maskDraw: digitRowsMaskDraw(rows, cellRel),
      };
    }
    if (!FORMS[name]) return null;
    return FORMS[name].build(n, S);
  }

  const STANDBY_MATH_ORDER = [
    "blob",
    "lissajous",
    "liss_43",
    "liss_54",
    "liss_56",
    "liss_75",
    "liss_85",
    "spiro",
    "tro_hyp_a",
    "tro_hyp_b",
    "tro_ep_a",
    "tro_ep_b",
    "flower",
    "rose",
    "rose_2",
    "rose_3",
    "rose_4",
    "rose_6",
    "rose_7",
    "rose_8",
    "fourier",
    "lemniscate",
    "cv_cardioid",
    "cv_astroid",
    "cv_deltoid",
    "cv_nephroid",
    "cv_hypo5",
    "cv_super3",
    "cv_super2p5",
    "cv_butterfly",
    "cv_heart",
    "cv_oval",
    "cv_gear",
    "cv_star5",
  ];

  const FORM_ORDER = [
    ...STANDBY_MATH_ORDER,
    "kao_joy",
    "kao_sweat",
    "kao_cool",
    "kao_party",
    "kao_angry",
    "kao_love",
    "kao_sleep",
    "kao_spark",
    "kao_shrug",
    "clock",
    "chrono",
    "mega",
  ];

  function getFormOrderForUiArcMode(mode) {
    if (mode === "presentation") {
      return FORM_ORDER.filter(isDisplayPresentationForm);
    }
    return STANDBY_MATH_ORDER.slice();
  }

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
      /** `min`：计时形态仅时分；`sec`：仍用 `clock` 键但布局与刷新同「时分秒」点阵（计划书 P2） */
      this.clockGranularity =
        opts.clockGranularity === "sec" ? "sec" : "min";
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
      /** 五官由字粒子承担；默认关闭以保持躯体仅为用户字，不含 · 一 等眉眼符号 */
      this.faceLayerMode = opts.faceLayerMode === true;
      /** 躯体墨色场：0 默认（赛璐璐/边缘）；1 纵向+呼吸；2 径向+呼吸；3 纵向稳态 */
      this.bodyColorMode = opts.bodyColorMode != null ? opts.bodyColorMode & 3 : 0;
      /** 躯体字色（#RRGGBB）；null 则随主题默认墨色 */
      this.bodyTintHex =
        opts.bodyTintHex != null && String(opts.bodyTintHex).trim()
          ? String(opts.bodyTintHex).trim()
          : null;
      /** 浮光：0 关；1 呼吸；2 纵波；3 径向脉动；4 星闪；5 心跳 */
      this.glowMode = opts.glowMode != null ? opts.glowMode | 0 : 0;
      /** 朱砂叠绘高亮（重复绘制同色字粒子）；默认关 */
      this.spotAccent = opts.spotAccent === true;

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
      this._targetScaleBeforeSleep = null;

      // 头朝向
      this.rotation = 0;
      this.targetRotation = 0;
      this.facingFlip = 1;

      // 鼠标/触摸交互
      this.ripples = []; // {x,y,r,alpha}
      /** URL ?dev=1 或 opts：显示活动区虚线框（默认关，避免「漂浮轮廓」观感） */
      this.showPlayfieldGuide = opts.showPlayfieldGuide === true;
      /** 与 `showPlayfieldGuide` 同闸：`setForm` 后写入，供画布诊断 overlay */
      this._devPerfHud = null;
      this._devLoopLastMs = 0;
      this._devLoopEmaMs = 0;
      this._devUpdateLastMs = 0;
      this._devRenderLastMs = 0;
      this._devResizeLastMs = 0;
      this.dragging = false;
      this.dragOffset = { x: 0, y: 0 };
      /** 呈现巨字排版：拼满画布（分行+自动缩） / 逐字轮换 */
      this.presentationMegaLayoutMode = "fit_canvas";
      this._megaSeqIdx = 0;
      this._megaSeqAcc = 0;
      /** 亚格颤动画位移幅度（与「颤」开关联用） */
      this.silhouetteJitterAmpMul = 1;
      /** 拖曳时格向残留，削弱「整块平移」观感 */
      this._dragResidualLx = 0;
      this._dragResidualLy = 0;
      this._dragShellDecoupled = false;
      this._dragShellWorld = null;
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
      /** 格移后 `g.x/y` 向 `(mgx,mgy)*cell` 平滑贴靠，减轻一步一格的锯齿感（计划 P2）；`false` 关闭 */
      this.gridCellMotionEase = opts.gridCellMotionEase !== false;
      /** 每字体内运动总倍率（格移、波纹、巡逻） */
      this.glyphMotionSpeed =
        opts.glyphMotionSpeed != null
          ? clamp(+opts.glyphMotionSpeed, 0.25, 2.5)
          : 1;
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
      this._huarongNextAt = 0;
      this._megaSlideNextAt = 0;
      this._lastWallFxAt = 0;
      /** 呈现剪影：淡出后内向补位目标格队列 {ax, ay, until} */
      this._silhouetteVacancyPulls = [];
      this._silVacPullNextAt = 0;
      /** 全队共享节拍相位（体内运动谐和） */
      this._ensemblePhase = 0;
      /** mask 内蛇行走廊（世界格 gx,gy），供 snake_stream 范式 */
      this._snakeWalkPath = [];
      this._snakePhase = 0;
      this._snakePathT = 0;
      /** URL 显式 `presentationDynamics=1` 时，不在「文稿→灵」初切巨字时强行关内动 */
      this._presentationDynamicsPinnedByUrl =
        opts.presentationGlyphDynamics === true;
      /** 与 DISPLAY/STANDBY 内核同步，供 UI toast 使用 */
      this.motionProfile = "standby";
      /** 侧栏层级：standby=待机形态；presentation=计时/巨字/颜文字（决定运动内核与独立参数） */
      this.uiArcMode =
        opts.uiArcMode === "presentation"
          ? "presentation"
          : opts.uiArcMode === "standby"
            ? "standby"
            : "standby";
      this._lastStandbyForm = "blob";
      this._lastPresentationForm =
        opts.initialForm && isDisplayPresentationForm(opts.initialForm)
          ? opts.initialForm
          : "mega";
      const _sp0 = clamp(
        this.glyphMotionSpeed != null ? this.glyphMotionSpeed : 1,
        0.25,
        2.5
      );
      const _fs0 = clamp(
        this.fluidStrength != null ? +this.fluidStrength : 0.2,
        0,
        0.55
      );
      const _gm0 = clamp(
        this.gridMarchSpeed != null ? +this.gridMarchSpeed : 2,
        0.85,
        3.6
      );
      const _tex0 = normalizeTextureMotionMode(opts.textureMotionMode);
      this._arcPrefs = {
        standby: {
          glyphMotionSpeed: _sp0,
          bodyTintHex: this.bodyTintHex,
          glowMode: this.glowMode | 0,
          bodyColorMode: this.bodyColorMode | 0,
          fluidStrength: _fs0,
          gridMarchSpeed: _gm0,
          megaParticleMul: 1,
          bodyMotionStyle: "harmonic",
          glyphsJitter: false,
          silhouetteMatteUnderlay: false,
          outlineContourFirst: true,
          textureMotionMode: _tex0,
          bodyGlyphEmMul: 1,
          presentationGlyphDynamics: true,
          macroFitMode: "shrink",
          megaLayoutScale: 1,
          silhouetteJitterAmpMul: 1,
        },
        presentation: {
          glyphMotionSpeed: _sp0,
          bodyTintHex: this.bodyTintHex,
          glowMode: this.glowMode | 0,
          bodyColorMode: this.bodyColorMode | 0,
          fluidStrength: clamp(Math.min(_fs0, 0.11), 0, 0.55),
          gridMarchSpeed: _gm0,
          megaParticleMul: 1,
          bodyMotionStyle: "harmonic",
          glyphsJitter: false,
          silhouetteMatteUnderlay: false,
          outlineContourFirst: false,
          textureMotionMode: _tex0,
          /** 躯体字统一字号乘子（待机/呈现各记一套；与字比/容纳独立） */
          bodyGlyphEmMul: 1,
          /** 巨字/颜呈现层：体内字粒是否跑谐波/流体/游走（关=先静后动，仅格位/垫底） */
          presentationGlyphDynamics: false,
          macroFitMode: "shrink",
          megaLayoutScale: 1,
          /** 巨字串在呈现层如何铺排（与「容纳」字串截断/双行独立） */
          presentationMegaLayoutMode: "fit_canvas",
          silhouetteJitterAmpMul: 1,
        },
      };
      if (opts.outlineContourFirst === false) {
        this._arcPrefs.standby.outlineContourFirst = false;
        this._arcPrefs.presentation.outlineContourFirst = false;
      }
      const _jitInit = opts.silhouetteGlyphJitter === true;
      this._arcPrefs.standby.glyphsJitter = _jitInit;
      this._arcPrefs.presentation.glyphsJitter = _jitInit;
      this.bodyMotionStyle = normalizeBodyMotionStyle(
        opts.bodyMotionStyle != null ? opts.bodyMotionStyle : "harmonic"
      );
      this._arcPrefs.standby.bodyMotionStyle = this.bodyMotionStyle;
      this._arcPrefs.presentation.bodyMotionStyle = this.bodyMotionStyle;
      /** 流线蛇行：走廊排序（螺旋≈由心向外挤满；弓字=逐行扫描） */
      this.snakePathVariant = normalizeSnakePathVariant(opts.snakePathVariant);
      /** 离散形场（可走格密铺 / 拓扑壳层）；换形纹理预算 */
      this.shapeFieldVersion = 0;
      this.shapeField = null;
      this._shapeMutationT = 0;
      this.shapeShellDampen = opts.shapeShellDampen !== false;
      this.textureMotionMode = _tex0;
      this._swapNextAt = 0;
      /** 外部 walk 密铺 Consumer（平滑 + 重采样对齐）；见 `shape-consumer.js` */
      this._shapeConsumer = null;
      this._externalWalkSnapshot = null;
      /** 呈现剪影静态垫底（与 `rasterizeMask` 同尺度离屏缓存，每换形重建） */
      this._silhouetteMatteLayer = null;
      if (opts.presentationGlyphDynamics === true) {
        this._arcPrefs.presentation.presentationGlyphDynamics = true;
      } else if (opts.presentationGlyphDynamics === false) {
        this._arcPrefs.presentation.presentationGlyphDynamics = false;
      }
      if (opts.macroFitMode != null) {
        const mf = normalizeMacroFitMode(String(opts.macroFitMode).trim());
        this._arcPrefs.standby.macroFitMode = mf;
        this._arcPrefs.presentation.macroFitMode = mf;
      }
      if (
        opts.megaLayoutScale != null &&
        !Number.isNaN(Number(opts.megaLayoutScale))
      ) {
        const ms = clamp(+opts.megaLayoutScale, 0.78, 1.14);
        this._arcPrefs.standby.megaLayoutScale = ms;
        this._arcPrefs.presentation.megaLayoutScale = ms;
      }
      if (
        opts.bodyGlyphEmMul != null &&
        !Number.isNaN(Number(opts.bodyGlyphEmMul))
      ) {
        const gem = clamp(+opts.bodyGlyphEmMul, 0.82, 1.18);
        this._arcPrefs.standby.bodyGlyphEmMul = gem;
        this._arcPrefs.presentation.bodyGlyphEmMul = gem;
      }
      applyArcVisualPrefsToPet(this);
      this.onUiArcModeChange =
        typeof opts.onUiArcModeChange === "function"
          ? opts.onUiArcModeChange
          : null;

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

      if (this.viewMode === "pet") {
        if (opts.uiArcMode == null) {
          this.uiArcMode = isDisplayPresentationForm(this.form)
            ? "presentation"
            : "standby";
        }
        if (
          this.uiArcMode === "presentation" &&
          !isDisplayPresentationForm(this.form) &&
          this.form !== "script"
        ) {
          this.setForm(this._lastPresentationForm || "mega", true, true);
        } else if (
          this.uiArcMode === "standby" &&
          isDisplayPresentationForm(this.form)
        ) {
          this.setForm(this._lastStandbyForm || "blob", true, true);
        }
        applyArcVisualPrefsToPet(this);
      }

      this._lastTime = performance.now();
      this._raf = requestAnimationFrame(this._loop.bind(this));
      requestAnimationFrame(() => this._resize());
    }

    _resize() {
      const dev = this.showPlayfieldGuide === true;
      const tr0 =
        dev && typeof performance !== "undefined" ? performance.now() : 0;
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
      // 文稿格距必须与 buildScriptLayout 内 cell 一致，否则吸附后行列会乱
      if (this.form === "script") {
        this.gridCell = clamp(Math.round(this.size * 0.052), 13, 26);
      } else {
        this.gridCell = clamp(Math.round(this.size * 0.0345), 10, 15);
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
      if (dev && tr0) {
        this._devResizeLastMs = performance.now() - tr0;
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
          patrolAmpMul: 0.93 + (Math.sin(i * 2.17) * 0.5 + 0.5) * 0.14,
          /** 形场分层：壳 / 芯（`shape-field.js`）；格移形态下可仍为 null */
          shapeBand: null,
        });
      }
    }

    setForm(name, silent, noEmitOnFormChange) {
      if (!FORMS[name]) return;
      const devHud = this.showPlayfieldGuide === true;
      const perfAll0 =
        devHud && typeof performance !== "undefined" ? performance.now() : 0;
      let perfMega0 = 0;
      let perfMega1 = 0;
      let perfLayout0 = 0;
      let perfLayout1 = 0;
      if (this.morphGlyphToTarget) this._cancelMorph(false);
      const prevForm = this.form;
      const S = this.size;
      let megaResolvedCache = null;
      if (name === "script") {
        this.gridCell = clamp(Math.round(S * 0.052), 13, 26);
        this._resizeGlyphsForScript(this.scriptLines, { mode: "script" });
      } else if (name === "mega") {
        if (
          this.uiArcMode === "presentation" &&
          normalizeMegaPresentationLayoutMode(this.presentationMegaLayoutMode) ===
            "fit_canvas"
        ) {
          const rawT = String(this._pickMacroDisplayForLayout() || "字");
          const G = Math.max(
            1,
            segmentStringGraphemes(String(rawT).trim() || "字").length
          );
          this.gridCell = computePresentationMegaGridCell(this, S, G);
        } else {
          this.gridCell = clamp(Math.round(S * 0.0425), 13, 20);
        }
      } else if (name === "clock") {
        this.gridCell =
          this.clockGranularity === "sec"
            ? clamp(Math.round(S * 0.042), 13, 22)
            : clamp(Math.round(S * 0.05), 14, 24);
      } else if (name === "chrono") {
        this.gridCell = clamp(Math.round(S * 0.042), 13, 22);
      } else {
        /** 待机曲线：略抬格距，使小字与呈现巨字在观感上更接近同一尺度带 */
        this.gridCell = clamp(Math.round(S * 0.0345), 10, 15);
      }
      if (name === "mega") {
        if (devHud) perfMega0 = performance.now();
        _megaSuggestMemo.clear();
        const mul =
          this._arcPrefs[this.uiArcMode].megaParticleMul != null
            ? clamp(+this._arcPrefs[this.uiArcMode].megaParticleMul, 0.72, 1.28)
            : 1;
        const resolvedMega = resolveMegaLayoutInput(this, S);
        megaResolvedCache = resolvedMega;
        const suggestOpts =
          this.viewMode === "pet" && this.uiArcMode === "presentation"
            ? { densePresentation: true }
            : undefined;
        let want = suggestMegaGlyphParticleCount(
          resolvedMega.disp,
          resolvedMega.Slay,
          this.gridCell,
          suggestOpts
        );
        want = clamp(Math.round(want * mul), 26, 255);
        if (
          this.viewMode === "pet" &&
          this.uiArcMode === "presentation"
        ) {
          const probeDraw = createMacroTextDraw(resolvedMega.disp, {
            noStroke: true,
          });
          const mpProbe = rasterizeMask(probeDraw, resolvedMega.Slay, 320);
          const capP = presentationMegaParticleCapFromMask(
            mpProbe,
            this.gridCell || 12
          );
          want = clamp(Math.min(want, capP), 26, 255);
        }
        if (want !== this.glyphs.length) {
          this.particleCount = want;
          this._initGlyphs();
        }
        if (devHud) perfMega1 = performance.now();
      } else if (name === "clock") {
        const sec = this.clockGranularity === "sec";
        const on = countTimerOnes(sec ? getLiveChronoRows() : getLiveClockRows());
        const want = clamp(
          Math.max(this.particleCount, Math.min(on * 3, on + (sec ? 120 : 100))),
          Math.min(on, sec ? 80 : 72),
          sec ? 360 : 340
        );
        if (want !== this.glyphs.length) {
          this.particleCount = want;
          this._initGlyphs();
        }
      } else if (name === "chrono") {
        const on = countTimerOnes(getLiveChronoRows());
        const want = clamp(
          Math.max(this.particleCount, Math.min(on * 3, on + 120)),
          Math.min(on, 80),
          360
        );
        if (want !== this.glyphs.length) {
          this.particleCount = want;
          this._initGlyphs();
        }
      }
      if (devHud) perfLayout0 = performance.now();
      const data = buildFormLayoutData(
        this,
        name,
        this.particleCount,
        S,
        megaResolvedCache
      );
      if (devHud) perfLayout1 = performance.now();
      if (!data || !data.targets || !data.targets.length) {
        if (devHud && perfAll0) {
          this._devPerfHud = {
            ok: false,
            key: name,
            allMs: performance.now() - perfAll0,
            megaSizingMs:
              name === "mega" && perfMega0 && perfMega1
                ? perfMega1 - perfMega0
                : null,
            buildLayoutMs:
              perfLayout0 && perfLayout1 ? perfLayout1 - perfLayout0 : null,
            particles: this.glyphs ? this.glyphs.length : 0,
            gridCell: this.gridCell,
            uiArc: this.uiArcMode,
            memoSize: _megaSuggestMemo.size,
          };
        }
        return;
      }
      const megaMaskS =
        name === "mega" && megaResolvedCache
          ? megaResolvedCache.Slay
          : S;
      this.form = name;
      if (name !== "script") {
        if (isDisplayPresentationForm(name)) {
          this._lastPresentationForm = name;
        } else {
          this._lastStandbyForm = name;
        }
      }
      this.formStartTime = performance.now();
      if (name === "clock") {
        const d = new Date();
        if (this.clockGranularity === "sec") {
          this._chronoSecondSlot =
            d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
        } else {
          this._clockMinuteSlot = d.getHours() * 60 + d.getMinutes();
        }
      }
      if (name === "chrono") {
        const d = new Date();
        this._chronoSecondSlot =
          d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      }
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
        this._maskPack = rasterizeMask(data.maskDraw, megaMaskS, 320);
        this._maskFormKey = name;
        this._maskSizeIdx = Math.round(S * 10);
        this._rebuildMatteLayerCanvas(data.maskDraw, megaMaskS);
      } else {
        this._maskPack = null;
        this._maskFormKey = "";
        this._silhouetteMatteLayer = null;
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
      const flip = 1;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const bx = this.pos.x;
      const by = this.pos.y;
      const nowSec = performance.now() / 1000;
      const silMk =
        this.viewMode === "pet" &&
        !!data.maskDraw &&
        (name === "mega" || String(name).startsWith("kao_"));
      for (let i = 0; i < this.glyphs.length; i++) {
        const g = this.glyphs[i];
        g.wgx = 0;
        g.wgy = 0;
        g.wtgx = 0;
        g.wtgy = 0;
        const ph = (g.patrolSeed || 0) * 13.7 + i * 1.73;
        const lagBase =
          silMk &&
          !g.faceRole &&
          isPresentationSilhouetteHarm(this) &&
          !this.presentationGlyphDynamics
            ? 0.96
            : silMk && !g.faceRole
              ? 0.9 + (Math.sin(ph * 1.1) * 0.5 + 0.5) * 0.1
              : 0.86 + (Math.sin(ph * 1.1) * 0.5 + 0.5) * 0.2;
        g.lagK = g.faceRole ? lagBase * 0.52 : lagBase;
        g.lagX = bx;
        g.lagY = by;
        g.lagVx = 0;
        g.lagVy = 0;
        g.wanderNextAt =
          nowSec +
          rand(0.08, 0.55) +
          ((i * 0.11) % 1.85) +
          (g.faceRole ? 0.35 : 0);
        const radBase = 8 + Math.floor((g.depth || 0.5) * 24);
        g._megaEdgeRing = false;
        g._megaDeepInterior = false;
        if (name === "mega" && !g.faceRole) {
          const e = g.edge != null ? g.edge : 0.5;
          g._megaEdgeRing = e > 0.66;
          g._megaDeepInterior = e < 0.37;
          if (g._megaEdgeRing) {
            g.wanderRad = clamp(Math.round(radBase * 0.5), 4, 10);
          } else if (g._megaDeepInterior) {
            g.wanderRad = clamp(radBase + 14, 20, 44);
          } else {
            g.wanderRad = clamp(radBase + 7, 14, 34);
          }
        } else {
          g.wanderRad = isMotionLayoutLockedForm(name)
            ? clamp(radBase, 4, 11)
            : clamp(radBase, 12, 44);
        }
        const txl = g.tx * flip;
        const tyl = g.ty;
        const wx = bx + (txl * cos - tyl * sin);
        const wy = by + (txl * sin + tyl * cos);
        g._anchorGx = Math.round(wx / cell);
        g._anchorGy = Math.round(wy / cell);
      }
      if (silMk) {
        for (const g of this.glyphs) {
          if (g.faceRole) continue;
          g.patrolAmpMul = 1;
          g._megaOutsideAcc = 0;
        }
      }
      if (
        (name === "mega" || String(name).startsWith("kao_")) &&
        this.uiArcMode === "presentation"
      ) {
        for (const g of this.glyphs) {
          if (g.faceRole) continue;
          g.alpha = 0.94;
          g._megaBaseAlpha = g.alpha;
        }
      }
      this._nextWanderPick = nowSec + 0.35;

      if (!isMaskBackedMegaKao(this)) {
        this._silhouetteVacancyPulls.length = 0;
      } else {
        const rb = this.rotation;
        this._rebuildMaskSnakeWalkPath(
          this.pos.x,
          this.pos.y,
          Math.cos(rb),
          Math.sin(rb),
          1
        );
        this._snakePathT = nowSec;
      }
      if (typeof this.onFormChange === "function" && !noEmitOnFormChange) {
        try {
          this.onFormChange(this.form);
        } catch (_) {}
      }

      /** 呈现巨字/颜初落位：多遍叠分、推迟邻格互换；从「文稿」成化灵时若无 URL 钉死内动则先关内动，便于先辨形 */
      const presSilShellSettle =
        this.viewMode === "pet" &&
        this.uiArcMode === "presentation" &&
        (name === "mega" || String(name).startsWith("kao_")) &&
        this._maskPack &&
        this._maskPack.grid &&
        this.gridMarch &&
        this.gridSnapping &&
        this.glyphs &&
        this.glyphs.length > 1;
      if (presSilShellSettle) {
        if (prevForm === "script" && !this._presentationDynamicsPinnedByUrl) {
          this._arcPrefs.presentation.presentationGlyphDynamics = false;
          applyArcVisualPrefsToPet(this);
        }
        for (let si = 0; si < 10; si++) {
          this._separateOverlappingGridGlyphs();
        }
        const nowMs =
          typeof performance !== "undefined"
            ? performance.now()
            : Date.now();
        this._huarongNextAt = Math.max(this._huarongNextAt || 0, nowMs + 1250);
        this._glyphFlash = Math.min(this._glyphFlash || 0, 0.05);
      }

      this._shapeMutationT = 0.72;
      this._rebuildShapeFieldFromForm();
      if (
        this._externalWalkSnapshot &&
        this.shapeField &&
        this.shapeField.packedWidth > 0 &&
        (this._externalWalkSnapshot.width !== this.shapeField.packedWidth ||
          this._externalWalkSnapshot.height !== this.shapeField.packedHeight)
      ) {
        this.resetExternalWalkConsumer();
      }
      if (devHud && perfAll0) {
        const wall =
          typeof performance !== "undefined" ? performance.now() : perfAll0;
        this._devPerfHud = {
          ok: true,
          key: name,
          allMs: wall - perfAll0,
          megaSizingMs:
            name === "mega" && perfMega0 && perfMega1
              ? perfMega1 - perfMega0
              : null,
          buildLayoutMs:
            perfLayout0 && perfLayout1 ? perfLayout1 - perfLayout0 : null,
          particles: this.glyphs.length,
          gridCell: this.gridCell,
          uiArc: this.uiArcMode,
          memoSize: _megaSuggestMemo.size,
        };
      }
    }

    /**
     * 由躯体目标点 (tx,ty) 构建形场；写入 g.shapeBand。蛇形觅食跳过。
     * 巨字 / mask 轨仍以 `bodyMotionStyle` 为主；本形场服务密铺 hash、调试与弹簧轨壳芯阻尼。
     */
    _rebuildShapeFieldFromForm() {
      const SF = typeof window !== "undefined" ? window.ZiLingShapeField : null;
      if (!SF || !this.shapeShellDampen) {
        for (const g of this.glyphs) g.shapeBand = null;
        this.shapeField = null;
        return;
      }
      if (this.form === "snake") {
        for (const g of this.glyphs) g.shapeBand = null;
        this.shapeField = null;
        return;
      }
      const cell = this.gridCell;
      const pts = [];
      for (const g of this.glyphs) {
        if (!g.faceRole) pts.push({ x: g.tx, y: g.ty });
      }
      const walk = SF.buildWalkSetFromLocalPoints(pts, cell);
      const shell = SF.shellCellsFromWalkSet(walk);
      for (const g of this.glyphs) {
        if (g.faceRole) {
          g.shapeBand = null;
          continue;
        }
        const gx = Math.round(g.tx / cell);
        const gy = Math.round(g.ty / cell);
        g.shapeBand = SF.bandAtGrid(gx, gy, shell, walk);
      }
      this.shapeFieldVersion++;
      const packedInfo = SF.packWalkGrid(walk);
      const packedHash = SF.hashPackedGrid(packedInfo.packed);
      this.shapeField = {
        version: this.shapeFieldVersion,
        cell,
        walk,
        shell,
        packed: packedInfo.packed,
        packedWidth: packedInfo.width,
        packedHeight: packedInfo.height,
        packedMinGx: packedInfo.minGx,
        packedMinGy: packedInfo.minGy,
        packedHash,
        meta: SF.summarizeWalkSet(walk, shell, 32),
      };
    }

    /** 换形后的纹理预算倍率 0.62..1 */
    _textureBudgetMul() {
      const dur = 0.72;
      const tt = this._shapeMutationT || 0;
      if (tt <= 0) return 1;
      return clamp(0.62 + 0.38 * (tt / dur), 0.62, 1);
    }

    /** 开发：形场摘要（含 packedHash） */
    dumpShapeField() {
      if (!this.shapeField) return null;
      const m = this.shapeField.meta || {};
      return {
        version: this.shapeField.version,
        form: this.form,
        cell: this.shapeField.cell,
        walkCount: m.walkCount,
        shellCount: m.shellCount,
        bounds: m.bounds,
        sampleWalk: m.sampleWalk,
        packedHash: this.shapeField.packedHash,
        packed: {
          w: this.shapeField.packedWidth,
          h: this.shapeField.packedHeight,
          minGx: this.shapeField.packedMinGx,
          minGy: this.shapeField.packedMinGy,
          bytes: this.shapeField.packed ? this.shapeField.packed.length : 0,
        },
        textureMotion: normalizeTextureMotionMode(this.textureMotionMode),
        externalWalk: this._externalWalkSnapshot,
      };
    }

    _ensureShapeConsumer() {
      const SC =
        typeof window !== "undefined" ? window.ZiLingShapeFieldConsumer : null;
      if (!SC || this._shapeConsumer) return;
      this._shapeConsumer = SC.create();
    }

    /**
     * 注入外部二值 walk 密铺（未来 AI 矩阵帧）。尺寸与当前本地 packed 不一致时最近邻重采样。
     * @param {Uint8Array} packed
     * @param {number} width
     * @param {number} height
     * @param {number} [smoothAlpha] 0..1
     * @returns {boolean}
     */
    ingestExternalWalkPacked(packed, width, height, smoothAlpha) {
      const SC =
        typeof window !== "undefined" ? window.ZiLingShapeFieldConsumer : null;
      if (!SC || !packed) return false;
      this._ensureShapeConsumer();
      const td =
        this.shapeField &&
        this.shapeField.packedWidth > 0 &&
        this.shapeField.packedHeight > 0
          ? {
              width: this.shapeField.packedWidth,
              height: this.shapeField.packedHeight,
            }
          : null;
      const snap = this._shapeConsumer.pushObservation(
        { packed, width: width | 0, height: height | 0 },
        smoothAlpha,
        td
      );
      this._externalWalkSnapshot = snap || null;
      if (this._externalWalkSnapshot) {
        this._shapeMutationT = Math.max(this._shapeMutationT || 0, 0.55);
      }
      return !!this._externalWalkSnapshot;
    }

    resetExternalWalkConsumer() {
      if (this._shapeConsumer) this._shapeConsumer.reset();
      this._externalWalkSnapshot = null;
    }

    /**
     * 序模式：仅芯层、4-邻格成对交换目标（不改变可走格集合）。
     * 格移开启时跳过，避免与 mgx/mgy 脱节；mask 巨字/颜文字跳过。
     */
    _maybeAdjacentTargetSwap(t) {
      if (normalizeTextureMotionMode(this.textureMotionMode) !== "adjacent_swap")
        return;
      if (this.dragging || this.mode === "feeding") return;
      if (this.form === "snake") return;
      if (this.gridMarch && this.gridSnapping) return;
      if (isMaskBackedMegaKao(this)) return;
      if (!this.shapeShellDampen || !this.shapeField) return;
      if (t < this._swapNextAt) return;
      const texMul = this._textureBudgetMul();
      this._swapNextAt = t + 0.34 / (0.55 + 0.45 * texMul);

      const cell = this.gridCell;
      const body = [];
      for (let i = 0; i < this.glyphs.length; i++) {
        const g = this.glyphs[i];
        if (!g.faceRole) body.push({ g, i });
      }
      if (body.length < 2) return;

      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const swapKeys = ["tx", "ty", "baseTx", "baseTy", "char", "edge", "depth"];

      for (let attempt = 0; attempt < 10; attempt++) {
        const a = body[Math.floor(Math.random() * body.length)];
        const ga = a.g;
        if (ga.shapeBand !== "core") continue;
        const gx0 = Math.round(ga.tx / cell);
        const gy0 = Math.round(ga.ty / cell);
        const d = dirs[Math.floor(Math.random() * dirs.length)];
        const ngx = gx0 + d[0];
        const ngy = gy0 + d[1];

        let partner = null;
        for (const b of body) {
          if (b.i === a.i) continue;
          const gx = Math.round(b.g.tx / cell);
          const gy = Math.round(b.g.ty / cell);
          if (gx === ngx && gy === ngy) {
            partner = b;
            break;
          }
        }
        if (!partner || partner.g.shapeBand !== "core") continue;

        const gb = partner.g;
        for (const k of swapKeys) {
          const tmp = ga[k];
          ga[k] = gb[k];
          gb[k] = tmp;
        }
        if (this.gridSnapping) {
          const s1 = this._snapLocal(ga.tx, ga.ty);
          const s2 = this._snapLocal(gb.tx, gb.ty);
          ga.tx = s1.x;
          ga.ty = s1.y;
          ga.baseTx = s1.x;
          ga.baseTy = s1.y;
          gb.tx = s2.x;
          gb.ty = s2.y;
          gb.baseTx = s2.x;
          gb.baseTy = s2.y;
        }
        this._rebuildShapeFieldFromForm();
        break;
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

    /**
     * 谐波/流体把 wx/wy 推到 mask 外时，将本帧 march 目标格吸附到最近可走格，
     * 避免小字长期占格在剪影外（辨形优先）；仍保留呈现层淡出重生作兜底。
     */
    _nearestWalkableMarchCell(gx, gy, bx, by, cos, sin, flip) {
      if (!this._maskPack || !this._maskPack.grid) return { gx, gy };
      if (this._worldCellWalkable(gx, gy, bx, by, cos, sin, flip))
        return { gx, gy };
      const mega = this.form === "mega";
      const maxR = mega ? 96 : 58;
      for (let r = 1; r <= maxR; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = gx + dx;
            const ny = gy + dy;
            if (this._worldCellWalkable(nx, ny, bx, by, cos, sin, flip))
              return { gx: nx, gy: ny };
          }
        }
      }
      return { gx, gy };
    }

    /**
     * 叠分 / 华容 / 滑步之后，个别 `(mgx,mgy)` 可能落在 mask 外（与 `_worldCellWalkable` 不一致）。
     * 按 PLAN「形场与判定同源」：强制 snap 到最近可走格并同步 `g.x/y`，避免字粒长期停在剪影外。
     */
    _enforceMaskBackedGlyphWalkable(bx, by, cos, sin, flip) {
      if (!isMaskBackedMegaKao(this)) return;
      const cell = this.gridCell;
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        const gx = g.mgx;
        const gy = g.mgy;
        if (gx == null || gy == null) continue;
        if (this._worldCellWalkable(gx, gy, bx, by, cos, sin, flip)) continue;
        const sn = this._nearestWalkableMarchCell(gx, gy, bx, by, cos, sin, flip);
        g.mgx = sn.gx;
        g.mgy = sn.gy;
        g.x = sn.gx * cell;
        g.y = sn.gy * cell;
        g.vx = 0;
        g.vy = 0;
        g._silDrawOx = 0;
        g._silDrawOy = 0;
      }
    }

    /**
     * 将 mask 内可走世界格排成走廊：`spiral` 切比雪夫环 + 极角（由心向外「挤满」感）；
     * `zigzag` 为弓字形行扫描（旧版）。
     */
    _rebuildMaskSnakeWalkPath(bx, by, cos, sin, flip) {
      if (!this._maskPack || !this._maskPack.grid) {
        this._snakeWalkPath = [];
        return;
      }
      const cell = this.gridCell || 12;
      const R = Math.max(
        this.size * 0.8,
        Math.min(this.width, this.height) * 0.24,
        150
      );
      const g0x = Math.floor((bx - R) / cell);
      const g1x = Math.ceil((bx + R) / cell);
      const g0y = Math.floor((by - R) / cell);
      const g1y = Math.ceil((by + R) / cell);
      const cells = [];
      for (let gy = g0y; gy <= g1y; gy++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          if (this._worldCellWalkable(gx, gy, bx, by, cos, sin, flip)) {
            cells.push({ gx, gy });
          }
        }
      }
      if (cells.length < 2) {
        this._snakeWalkPath = cells;
        return;
      }
      if (this.snakePathVariant === "zigzag") {
        cells.sort((a, b) => a.gy - b.gy || a.gx - b.gx);
        const byRow = new Map();
        for (const c of cells) {
          if (!byRow.has(c.gy)) byRow.set(c.gy, []);
          byRow.get(c.gy).push(c);
        }
        const ys = [...byRow.keys()].sort((a, b) => a - b);
        const path = [];
        ys.forEach((y, ri) => {
          const row = byRow.get(y).slice();
          row.sort((a, b) => a.gx - b.gx);
          if (ri % 2) row.reverse();
          path.push(...row);
        });
        this._snakeWalkPath = path;
        return;
      }
      const cx = cells.reduce((s, c) => s + c.gx, 0) / cells.length;
      const cy = cells.reduce((s, c) => s + c.gy, 0) / cells.length;
      cells.sort((a, b) => {
        const dxa = a.gx - cx;
        const dya = a.gy - cy;
        const dxb = b.gx - cx;
        const dyb = b.gy - cy;
        const ra = Math.max(Math.abs(dxa), Math.abs(dya));
        const rb = Math.max(Math.abs(dxb), Math.abs(dyb));
        if (ra !== rb) return ra - rb;
        return Math.atan2(dya, dxa) - Math.atan2(dyb, dxb);
      });
      this._snakeWalkPath = cells;
    }

    _pickWanderDelta(g, bx, by, cos, sin, flip) {
      const cell = this.gridCell;
      const txl = g.tx * flip;
      const tyl = g.ty;
      const wxb = bx + (txl * cos - tyl * sin);
      const wyb = by + (txl * sin + tyl * cos);
      const anchorGx = Math.round(wxb / cell);
      const anchorGy = Math.round(wyb / cell);
      const mkW = getMotionProfileKernelsForPet(this);
      const presW = isPresentationSilhouetteHarm(this);
      const rad =
        (g.wanderRad || 14) * mkW.wanderRadScale * (presW ? 0.48 : 1);
      const maxK =
        this.form === "mega" && g._megaDeepInterior
          ? 62
          : this.form === "mega" && g._megaEdgeRing
            ? 40
            : 48;
      for (let k = 0; k < maxK; k++) {
        if (
          k === 0 &&
          Math.random() < 0.36 &&
          g._lastWdx != null &&
          g._lastWdy != null
        ) {
          const tgx = anchorGx + g._lastWdx;
          const tgy = anchorGy + g._lastWdy;
          if (this._worldCellWalkable(tgx, tgy, bx, by, cos, sin, flip)) {
            g.wtgx = g._lastWdx;
            g.wtgy = g._lastWdy;
            return;
          }
        }
        const ddx = Math.floor(rand(-rad, rad + 1));
        const ddy = Math.floor(rand(-rad, rad + 1));
        if (ddx * ddx + ddy * ddy > rad * rad) continue;
        const tgx = anchorGx + ddx;
        const tgy = anchorGy + ddy;
        if (this._worldCellWalkable(tgx, tgy, bx, by, cos, sin, flip)) {
          g.wtgx = ddx;
          g.wtgy = ddy;
          g._lastWdx = ddx;
          g._lastWdy = ddy;
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

    /**
     * 格点 march 后若多粒落在同一 (mgx,mgy)，将后续粒子螺旋挪到最近空位，减轻字体重叠。
     */
    _separateOverlappingGridGlyphs() {
      if (!this.gridSnapping || !this.gridMarch) return;
      if (this.form === "script") return;
      const presDense = isPresentationSilhouetteHarm(this);
      const decoupDrag =
        this.dragging &&
        this._dragShellDecoupled &&
        isPresentationSilhouetteHarm(this);
      if (this.dragging && !presDense && !decoupDrag) return;
      const cell = this.gridCell;
      if (!cell) return;
      const shell = this._bodyWorldForShell();
      const bx = shell.x;
      const by = shell.y;
      const flip = this.facingFlip || 1;
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      const useMask = this._maskPack && this._maskPack.grid;
      const mega = this.form === "mega";
      const kaoMask = useMask && String(this.form || "").startsWith("kao_");
      const rMax = mega ? 90 : kaoMask ? 52 : useMask ? 40 : 22;
      const silMask = isMaskBackedMegaKao(this);
      const passes =
        presDense
          ? decoupDrag
            ? 16
            : this.presentationGlyphDynamics
              ? 12
              : 15
          : usesMaskSnakeStream(this) && silMask
            ? 7
            : mega
              ? 4
              : useMask
                ? 3
                : 1;
      const key = (gx, gy) => `${gx},${gy}`;

      for (let pass = 0; pass < passes; pass++) {
        const occ = new Map();
        for (let i = 0; i < this.glyphs.length; i++) {
          const g = this.glyphs[i];
          if (g.faceRole) continue;
          const k = key(g.mgx, g.mgy);
          if (!occ.has(k)) occ.set(k, []);
          occ.get(k).push(i);
        }
        for (const [, idxs] of occ) {
          if (idxs.length < 2) continue;
          for (let j = 1; j < idxs.length; j++) {
            const gi = idxs[j];
            const g = this.glyphs[gi];
            const gx = g.mgx;
            const gy = g.mgy;
            let found = null;
            /** 呈现层：优先正交邻格（曼哈顿 1），规整且少「大跳」叠乱 */
            if (presDense) {
              const orth = [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ];
              const rot = (pass + gx + gy) & 3;
              for (let q = 0; q < 4; q++) {
                const [dx, dy] = orth[(q + rot) % 4];
                const nx = gx + dx;
                const ny = gy + dy;
                const nk = key(nx, ny);
                const list = occ.get(nk);
                if (list && list.length) continue;
                if (
                  useMask &&
                  !this._worldCellWalkable(nx, ny, bx, by, cos, sin, flip)
                ) {
                  continue;
                }
                found = { nx, ny, nk };
                break;
              }
            }
            for (let r = 1; r < rMax && !found; r++) {
              for (let dx = -r; dx <= r && !found; dx++) {
                for (let dy = -r; dy <= r && !found; dy++) {
                  if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                  const nx = gx + dx;
                  const ny = gy + dy;
                  if (presDense && Math.abs(nx - gx) + Math.abs(ny - gy) === 1) {
                    continue;
                  }
                  const nk = key(nx, ny);
                  const list = occ.get(nk);
                  if (list && list.length) continue;
                  if (
                    useMask &&
                    !this._worldCellWalkable(nx, ny, bx, by, cos, sin, flip)
                  ) {
                    continue;
                  }
                  found = { nx, ny, nk };
                }
              }
            }
            if (!found) continue;
            const oldK = key(gx, gy);
            const oldList = occ.get(oldK);
            if (oldList) {
              const ix = oldList.indexOf(gi);
              if (ix >= 0) oldList.splice(ix, 1);
            }
            g.mgx = found.nx;
            g.mgy = found.ny;
            g.x = g.mgx * cell;
            g.y = g.mgy * cell;
            if (!occ.has(found.nk)) occ.set(found.nk, []);
            occ.get(found.nk).push(gi);
          }
        }
      }
    }

    /**
     * 华容道式邻格互换：在保持整体形态的前提下，让内部字沿格交换位置（不用于 script / 计时；普通拖曳中跳过，**呈现剪影拖曳解耦时仍可走**，冷却略放慢）。
     */
    _tryHuarongAdjacentSwaps(now) {
      if (!this.gridMarch || !this.gridSnapping) return;
      const decoupDrag =
        this.dragging &&
        this._dragShellDecoupled &&
        isPresentationSilhouetteHarm(this);
      if ((this.dragging && !decoupDrag) || this.morphGlyphToTarget) return;
      if (this.viewMode !== "pet" || this.form === "script") return;
      if (isMotionLayoutLockedForm(this.form)) return;
      if (now < this._huarongNextAt) return;
      const gmsH = clamp(
        this.glyphMotionSpeed != null ? this.glyphMotionSpeed : 1,
        0.25,
        2.5
      );
      const mkH = getMotionProfileKernelsForPet(this);
      const presL = isPresentationSilhouetteHarm(this);
      const presSleep = presL && !this.presentationGlyphDynamics;
      let hSleep = 1;
      if (presSleep) hSleep = 2.55;
      else if (presL && this.presentationGlyphDynamics) hSleep = 1.12;
      if (decoupDrag) hSleep *= 1.55;
      this._huarongNextAt =
        now +
        ((260 + Math.random() * 320) * mkH.huarongCooldownMul * hSleep) /
          gmsH;

      const sw = this._bodyWorldForShell();
      const bx = sw.x;
      const by = sw.y;
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      const flip = this.facingFlip || 1;
      const useMask = this._maskPack && this._maskPack.grid;

      const bodyIdx = [];
      for (let i = 0; i < this.glyphs.length; i++) {
        if (!this.glyphs[i].faceRole) bodyIdx.push(i);
      }
      if (bodyIdx.length < 2) return;

      const pickIdxMega = () => {
        let sum = 0;
        const wt = [];
        for (const i of bodyIdx) {
          const g = this.glyphs[i];
          let w = 1.4;
          if (g._megaDeepInterior) w = 3.8;
          else if (g._megaEdgeRing) w = 0.65;
          else w = 2;
          sum += w;
          wt.push(w);
        }
        let r = Math.random() * sum;
        for (let k = 0; k < bodyIdx.length; k++) {
          r -= wt[k];
          if (r <= 0) return bodyIdx[k];
        }
        return bodyIdx[bodyIdx.length - 1];
      };

      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const swapPair = (a, b) => {
        const keys = [
          "tx",
          "ty",
          "baseTx",
          "baseTy",
          "char",
          "mgx",
          "mgy",
          "x",
          "y",
          "edge",
        ];
        for (const k of keys) {
          const t = a[k];
          a[k] = b[k];
          b[k] = t;
        }
      };

      for (let attempt = 0; attempt < 14; attempt++) {
        const ia =
          this.form === "mega"
            ? pickIdxMega()
            : bodyIdx[Math.floor(Math.random() * bodyIdx.length)];
        const gA = this.glyphs[ia];
        const d = dirs[Math.floor(Math.random() * dirs.length)];
        const ngx = gA.mgx + d[0];
        const ngy = gA.mgy + d[1];
        let ib = -1;
        for (const j of bodyIdx) {
          if (j === ia) continue;
          const gB = this.glyphs[j];
          if (gB.mgx === ngx && gB.mgy === ngy) {
            ib = j;
            break;
          }
        }
        if (ib < 0) continue;
        const gB = this.glyphs[ib];
        if (
          this.form === "mega" &&
          gA._megaEdgeRing &&
          gB._megaEdgeRing &&
          Math.random() < 0.72
        ) {
          continue;
        }
        if (useMask) {
          if (
            !this._worldCellWalkable(gA.mgx, gA.mgy, bx, by, cos, sin, flip) ||
            !this._worldCellWalkable(gB.mgx, gB.mgy, bx, by, cos, sin, flip)
          ) {
            continue;
          }
        }
        swapPair(gA, gB);
        if (presSleep) {
          const dip = 0.78;
          gA.alpha = clamp(
            (gA.alpha != null ? gA.alpha : 0.9) * dip,
            0.12,
            0.94
          );
          gB.alpha = clamp(
            (gB.alpha != null ? gB.alpha : 0.9) * dip,
            0.12,
            0.94
          );
        }
        return;
      }
    }

    /**
     * 将巨字单字锚定到世界格 (ngx,ngy)，同步 tx/ty 与格心，便于滑入空位后仍沿 mask 约束。
     */
    _megaNudgeGlyphToGrid(g, ngx, ngy, bx, by, cos, sin, flip) {
      const cell = this.gridCell;
      const wx = ngx * cell;
      const wy = ngy * cell;
      const rdx = wx - bx;
      const rdy = wy - by;
      const txl = rdx * cos + rdy * sin;
      const tyl = -rdx * sin + rdy * cos;
      const f = this.facingFlip || 1;
      g.tx = txl / f;
      g.ty = tyl;
      g.baseTx = g.tx;
      g.baseTy = g.ty;
      g.mgx = ngx;
      g.mgy = ngy;
      g.x = ngx * cell;
      g.y = ngy * cell;
    }

    /**
     * 巨字：单字滑入相邻空walkable格（华容道让位），优先内部字、边缘较少触发。
     */
    _tryMegaSlideIntoVoid(now) {
      if (this.form !== "mega" || !this.gridMarch || !this.gridSnapping) return;
      if (this.dragging || this.morphGlyphToTarget) return;
      if (this.viewMode !== "pet") return;
      if (now < this._megaSlideNextAt) return;
      const gmsH = clamp(
        this.glyphMotionSpeed != null ? this.glyphMotionSpeed : 1,
        0.25,
        2.5
      );
      const mkS = getMotionProfileKernelsForPet(this);
      this._megaSlideNextAt =
        now + ((95 + Math.random() * 115) * mkS.megaSlideCooldownMul) / gmsH;

      const bx = this.pos.x;
      const by = this.pos.y;
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      const flip = this.facingFlip || 1;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const key = (gx, gy) => `${gx},${gy}`;
      const occ = new Set();
      const body = [];
      for (let i = 0; i < this.glyphs.length; i++) {
        const g = this.glyphs[i];
        if (g.faceRole) continue;
        occ.add(key(g.mgx, g.mgy));
        body.push(g);
      }
      if (body.length < 2) return;

      const pickWeightedGlyph = () => {
        let sum = 0;
        const w = [];
        for (const g of body) {
          let wt = 1.2;
          if (g._megaDeepInterior) wt = 4.2;
          else if (g._megaEdgeRing) wt = 0.55;
          else wt = 2.1;
          sum += wt;
          w.push(wt);
        }
        let r = Math.random() * sum;
        for (let i = 0; i < body.length; i++) {
          r -= w[i];
          if (r <= 0) return body[i];
        }
        return body[body.length - 1];
      };

      for (let attempt = 0; attempt < 36; attempt++) {
        const g = pickWeightedGlyph();
        if (g._megaEdgeRing && Math.random() < 0.48) continue;
        const d = dirs[Math.floor(Math.random() * dirs.length)];
        const ngx = g.mgx + d[0];
        const ngy = g.mgy + d[1];
        if (occ.has(key(ngx, ngy))) continue;
        if (!this._worldCellWalkable(ngx, ngy, bx, by, cos, sin, flip)) {
          continue;
        }
        occ.delete(key(g.mgx, g.mgy));
        this._megaNudgeGlyphToGrid(g, ngx, ngy, bx, by, cos, sin, flip);
        occ.add(key(ngx, ngy));
        return;
      }
    }

    /**
     * 淡出后的语义空位：从剪影内部拉一粒向锚点格迈一步（曼哈顿），形成「邻字挪入」感。
     */
    _stepSilhouetteVacancyInpull(t, gms, bx, by, cos, sin, flip) {
      if (
        isPresentationSilhouetteHarm(this) &&
        !this.presentationGlyphDynamics
      ) {
        return;
      }
      if (!this._silhouetteVacancyPulls.length) return;
      if (t < (this._silVacPullNextAt || 0)) return;
      this._silVacPullNextAt =
        t + clamp(0.084 / Math.max(gms, 0.38), 0.05, 0.14);

      this._silhouetteVacancyPulls = this._silhouetteVacancyPulls.filter(
        (v) => t < v.until
      );
      if (!this._silhouetteVacancyPulls.length) return;

      const v = this._silhouetteVacancyPulls[0];
      const ax = v.ax;
      const ay = v.ay;
      const key = (gx, gy) => `${gx},${gy}`;
      const occ = new Set();
      for (const g of this.glyphs) {
        if (!g.faceRole) occ.add(key(g.mgx, g.mgy));
      }

      const tryMove = (g, preferX) => {
        let ngx = g.mgx;
        let ngy = g.mgy;
        const dx = ax - g.mgx;
        const dy = ay - g.mgy;
        if (preferX) {
          if (dx !== 0) ngx += dx > 0 ? 1 : -1;
          else if (dy !== 0) ngy += dy > 0 ? 1 : -1;
        } else {
          if (dy !== 0) ngy += dy > 0 ? 1 : -1;
          else if (dx !== 0) ngx += dx > 0 ? 1 : -1;
        }
        if (ngx === g.mgx && ngy === g.mgy) return false;
        if (occ.has(key(ngx, ngy))) return false;
        if (!this._worldCellWalkable(ngx, ngy, bx, by, cos, sin, flip))
          return false;
        occ.delete(key(g.mgx, g.mgy));
        this._megaNudgeGlyphToGrid(g, ngx, ngy, bx, by, cos, sin, flip);
        occ.add(key(ngx, ngy));
        return true;
      };

      const candidates = this.glyphs
        .filter(
          (g) =>
            !g.faceRole &&
            (g.edge || 0) < 0.56 &&
            g._megaEdgeRing !== true
        )
        .sort(
          (a, b) =>
            Math.abs(b.mgx - ax) +
            Math.abs(b.mgy - ay) -
            (Math.abs(a.mgx - ax) + Math.abs(a.mgy - ay))
        );

      for (const g of candidates) {
        if (tryMove(g, Math.abs(ax - g.mgx) >= Math.abs(ay - g.mgy)))
          return;
        if (tryMove(g, Math.abs(ax - g.mgx) < Math.abs(ay - g.mgy)))
          return;
      }
    }

    /** 呈现层巨字：在笔画锚点邻域找可走格重生 */
    _respawnMegaGlyphNearShell(g, bx, by, cos, sin, flip) {
      const cell = this.gridCell || 12;
      let gx =
        g._anchorGx != null ? g._anchorGx : Math.round(g.mgx || 0);
      let gy =
        g._anchorGy != null ? g._anchorGy : Math.round(g.mgy || 0);
      if (this._worldCellWalkable(gx, gy, bx, by, cos, sin, flip)) {
        g.mgx = gx;
        g.mgy = gy;
        g.x = gx * cell;
        g.y = gy * cell;
        return;
      }
      for (let r = 1; r < 52; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = gx + dx;
            const ny = gy + dy;
            if (this._worldCellWalkable(nx, ny, bx, by, cos, sin, flip)) {
              g.mgx = nx;
              g.mgy = ny;
              g.x = nx * cell;
              g.y = ny * cell;
              return;
            }
          }
        }
      }
    }

    /** 呈现层剪影（巨字/颜）：离轮廓淡出 → 登记空位 → 壳上重生并换新字 */
    _updatePresentationSilhouetteGlyphLifecycle(dt, bx, by, cos, sin, flip) {
      if (!isPresentationSilhouetteHarm(this)) return;
      if (!this._maskPack || !this._maskPack.grid) return;
      const spd = clamp(
        this.glyphMotionSpeed != null ? this.glyphMotionSpeed : 1,
        0.25,
        2.5
      );
      /** 轮廓难辨 / 越界时：略快淡出；合法区内：慢淡入减轻闪现与叠乱感 */
      const presSleep = !this.presentationGlyphDynamics;
      const fadeOut =
        (0.4 / (0.62 + 0.38 * spd)) * (presSleep ? 0.92 : 1);
      const fadeIn =
        (0.2 + 0.16 * spd) * (presSleep ? 0.78 : 1.08);
      const tWall = performance.now() / 1000;
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        if (g._megaBaseAlpha == null) {
          g._megaBaseAlpha = g.alpha != null ? g.alpha : 0.94;
        }
        const ok = this._worldCellWalkable(
          g.mgx,
          g.mgy,
          bx,
          by,
          cos,
          sin,
          flip
        );
        const prevA = g.alpha != null ? g.alpha : 1;
        let a = prevA;
        if (!ok) {
          g._megaOutsideAcc = (g._megaOutsideAcc || 0) + dt;
          a -= dt * fadeOut * (1 + (g._megaOutsideAcc || 0) * 0.32);
        } else {
          g._megaOutsideAcc = Math.max(0, (g._megaOutsideAcc || 0) - dt * 2.4);
          const tgt = g._megaBaseAlpha;
          a += dt * fadeIn;
          if (a > tgt) a = tgt;
        }
        let aNext = clamp(a, 0, 1);
        const maxStep = (presSleep ? 0.28 : 1.12) * dt;
        if (aNext - prevA > maxStep) aNext = prevA + maxStep;
        if (prevA - aNext > maxStep) aNext = prevA - maxStep;
        g.alpha = aNext;
        if (g.alpha < 0.038) {
          if (g._anchorGx != null && g._anchorGy != null) {
            this._silhouetteVacancyPulls.push({
              ax: g._anchorGx,
              ay: g._anchorGy,
              until: tWall + 2.25,
            });
            while (this._silhouetteVacancyPulls.length > 16) {
              this._silhouetteVacancyPulls.shift();
            }
          }
          this._respawnMegaGlyphNearShell(g, bx, by, cos, sin, flip);
          if (isPresentationSilhouetteHarm(this)) {
            g.char = this._randomChar();
          }
          const presL = isPresentationSilhouetteHarm(this);
          const sleepFade = presL && !this.presentationGlyphDynamics;
          g.alpha = clamp(
            g._megaBaseAlpha * (sleepFade ? 0.36 : presL ? 0.32 : 0.48),
            sleepFade ? 0.22 : presL ? 0.08 : 0.14,
            sleepFade ? 0.42 : presL ? 0.36 : 0.5
          );
          g._megaOutsideAcc = 0;
          g.wgx = 0;
          g.wgy = 0;
          g.wtgx = 0;
          g.wtgy = 0;
          g._silDrawOx = 0;
          g._silDrawOy = 0;
        }
      }
    }

    /** 呈现巨字：拖曳格向扰动衰减；逐字模式定时换形。 */
    _tickPresentationMegaAux(dt) {
      if (this.viewMode !== "pet") return;
      if (isPresentationSilhouetteHarm(this) && isMaskBackedMegaKao(this)) {
        const dcc = dt * 2.35;
        this._dragResidualLx = (this._dragResidualLx || 0) * Math.exp(-dcc);
        this._dragResidualLy = (this._dragResidualLy || 0) * Math.exp(-dcc);
      }
      if (!isPresentationSilhouetteHarm(this) || this.form !== "mega") return;
      if (
        normalizeMegaPresentationLayoutMode(this.presentationMegaLayoutMode) !==
        "sequential_chars"
      ) {
        return;
      }
      const base =
        this.macroText && String(this.macroText).trim()
          ? String(this.macroText).trim()
          : String(this._pickMacroChar() || "字");
      const arr = Array.from(base);
      if (arr.length <= 1) return;
      this._megaSeqAcc = (this._megaSeqAcc || 0) + dt;
      if (this._megaSeqAcc < 2.35) return;
      this._megaSeqAcc = 0;
      this._megaSeqIdx = ((this._megaSeqIdx || 0) + 1) % arr.length;
      this.setForm("mega", true, true);
      this._glyphFlash = Math.min(0.38, (this._glyphFlash || 0) + 0.18);
    }

    _pickMacroDisplay() {
      if (
        this.uiArcMode === "presentation" &&
        normalizeMegaPresentationLayoutMode(this.presentationMegaLayoutMode) ===
          "sequential_chars" &&
        this.viewMode === "pet" &&
        this.form === "mega"
      ) {
        const base =
          this.macroText && String(this.macroText).trim()
            ? String(this.macroText).trim()
            : null;
        if (base) {
          const arr = Array.from(base);
          if (arr.length > 1) {
            const i = (this._megaSeqIdx || 0) % arr.length;
            return arr[i];
          }
        }
      }
      if (this.macroText && String(this.macroText).trim()) {
        return String(this.macroText).trim().slice(0, 48);
      }
      return this._pickMacroChar();
    }

    /** 巨字排版用：始终取完整宏串（逐字轮换模式仍按全文算格距/分行）。 */
    _pickMacroDisplayForLayout() {
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

      if (!isGridLayoutImmutableForm(name)) {
        this._resolveUniqueLocalGridFor(list);
      }

      const bx = this.pos.x;
      const by = this.pos.y;
      const rot = this.rotation;
      const flip = 1;
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
      if (isGridLayoutImmutableForm(this.form)) return;
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
      this._presSilUniformBodyPx = null;
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
        this._applyBodyGlyphEmMulToGlyphs();
        return;
      }
      if (isGridLayoutImmutableForm(this.form)) {
        const cell = this.gridCell || 14;
        let em;
        if (isMaskBackedMegaKao(this) && this.viewMode === "pet") {
          const ref = clamp(Math.round(this.size * 0.04), 12, 18);
          const pres = isPresentationSilhouetteHarm(this);
          const blend = 0.5;
          const eff = clamp(cell * (1 - blend) + ref * blend, 11.5, 19);
          /** 呈现巨字略压 em，待机 mask 略抬，减少「呈现巨大、待机过小」分裂 */
          const k = pres ? 0.72 : 0.8;
          em = clamp(eff * k, 10.5, 17);
        } else {
          em = clamp(cell * 0.83, 11.5, 20);
        }
        for (const g of this.glyphs) {
          if (g.faceRole === "brow") {
            g.targetRot = this._quantizeTargetRot(rand(-0.04, 0.04));
            g.size = em * 0.93;
          } else if (g.faceRole === "eyeL" || g.faceRole === "eyeR") {
            g.targetRot = this._quantizeTargetRot(rand(-0.03, 0.03));
            g.size = em * 1.04;
          } else {
            g.targetRot = 0;
            if (
              isPresentationSilhouetteHarm(this) &&
              isMaskBackedMegaKao(this)
            ) {
              /** 呈现层巨字/颜：字身统一字号，避免边缘缩放导致「大小不一、难辨整体」 */
              g.size = em;
            } else {
              const edgeMul =
                isMaskBackedMegaKao(this) && this.viewMode === "pet"
                  ? lerp(0.99, 0.93, g.edge)
                  : lerp(1.02, 0.94, g.edge);
              g.size = em * edgeMul;
            }
          }
        }
        this._applyBodyGlyphEmMulToGlyphs();
        if (
          isPresentationSilhouetteHarm(this) &&
          isMaskBackedMegaKao(this)
        ) {
          const g0 = this.glyphs.find((gg) => !gg.faceRole);
          if (g0 && g0.size != null && !Number.isNaN(+g0.size)) {
            this._presSilUniformBodyPx = +g0.size;
          }
        }
        return;
      }
      const emMin = Math.max(8, this.gridCell * 0.68);
      const emMax = Math.max(emMin + 0.5, this.gridCell * 0.88);
      const em = Math.max(9, clamp(this.gridCell * 0.81, emMin, emMax));
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
      this._applyBodyGlyphEmMulToGlyphs();
    }

    _applyBodyGlyphEmMulToGlyphs() {
      const b = this._arcPrefs[this.uiArcMode];
      const mul = clamp(
        b.bodyGlyphEmMul != null ? +b.bodyGlyphEmMul : 1,
        0.82,
        1.18
      );
      if (Math.abs(mul - 1) < 0.001) return;
      for (const g of this.glyphs) {
        if (g.size != null && !Number.isNaN(g.size)) g.size *= mul;
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

    /** 轻点：所有形态下小字沿格目标方向短暂散开（华容道位移的可见反馈） */
    scatterTapBurst() {
      const cell = this.gridCell || 12;
      const megaCalm = isMaskBackedMegaKao(this);
      const damp = megaCalm
        ? isPresentationSilhouetteHarm(this)
          ? this.presentationGlyphDynamics
            ? 0.18
            : 0.06
          : 0.36
        : 1;
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        const a = Math.random() * Math.PI * 2;
        const mag = cell * (2.0 + Math.random() * 4.8) * damp;
        g._tapScatterT = 0.42;
        g._tapScatterT0 = 0.42;
        g._tapScatterOX = Math.cos(a) * mag;
        g._tapScatterOY = Math.sin(a) * mag;
      }
    }

    /** 戳身：累积烦躁；过高时短暂换形并刷情绪字 */
    nuisTap() {
      this.scatterTapBurst();
      this.annoyance = clamp(this.annoyance + 0.22, 0, 1.35);
      this._rumbleAmp = Math.max(this._rumbleAmp || 0, 0.25);
      if (this.mode === "idle" && !this.dragging) {
        this.vel.x += rand(-120, 120);
        this.vel.y += rand(-80, 80);
      }
      if (this.annoyance >= 0.95 && this.mode === "idle") {
        this.setExpression("annoyed");
        this._applyMoodChars("annoyed", 1.8);
        this._rumbleAmp = Math.max(this._rumbleAmp || 0, 0.85);
        this._glyphFlash = Math.min(0.55, Math.max(this._glyphFlash || 0, 0.5));
        const lockPresentation =
          this.viewMode === "pet" && this.uiArcMode === "presentation";
        if (!lockPresentation) {
          if (!this._savedFormBeforeAnnoyed) this._savedFormBeforeAnnoyed = this.form;
          const alt = [
            "tro_ep_a",
            "cv_butterfly",
            "flower",
            "kao_party",
            "kao_spark",
            "fourier",
          ];
          const pick = alt[Math.floor(Math.random() * alt.length)];
          if (FORMS[pick]) this.setForm(pick, true);
        }
        this.annoyance = 0.45;
        setTimeout(() => {
          if (
            this.mode === "idle" &&
            this._savedFormBeforeAnnoyed &&
            !(this.viewMode === "pet" && this.uiArcMode === "presentation")
          ) {
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
      const order =
        this.viewMode === "pet"
          ? getFormOrderForUiArcMode(this.uiArcMode)
          : FORM_ORDER;
      const keys = order.filter((k) => k !== excludeKey && FORMS[k]);
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
      if (this.viewMode === "intro") {
        this.ripples.push({ x, y, r: 4, alpha: 0.42 });
      }
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
        this._targetScaleBeforeSleep = this.targetScale;
        this.targetScale = Math.min(this.targetScale, 0.88);
      } else {
        this.mode = "idle";
        this.setExpression("normal");
        if (this._targetScaleBeforeSleep != null) {
          this.targetScale = this._targetScaleBeforeSleep;
          this._targetScaleBeforeSleep = null;
        }
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
      this.scatterTapBurst();
      const n = Math.min(6, Math.max(1, Math.floor(chain) || 1));
      this._rumbleAmp = Math.min(0.52, (this._rumbleAmp || 0) + 0.06 * n);
      this._glyphFlash = Math.min(0.48, (this._glyphFlash || 0) + 0.08 * n);
      if (this.viewMode === "intro") {
        for (let k = 0; k < Math.min(4, 2 + n); k++) {
          this.ripples.push({
            x: this.pos.x + rand(-this.size * 0.12, this.size * 0.12),
            y: this.pos.y + rand(-this.size * 0.1, this.size * 0.1),
            r: 3 + k * 2,
            alpha: 0.28 + n * 0.04,
          });
        }
      }
      if (n >= 3) {
        this._glyphFlash = Math.min(0.55, (this._glyphFlash || 0) + 0.2);
        this.setExpression("happy");
        setTimeout(() => {
          if (this.expression === "happy") this.setExpression("normal");
        }, 700);
      }
    }

    /** 画布内活动区（几乎贴边，由 play-bounds 统一缩进） */
    _playBounds() {
      const inset = PB.inset(this.width, this.height);
      return {
        minX: inset,
        maxX: this.width - inset,
        minY: inset,
        maxY: this.height - inset,
      };
    }

    /** 整体碰撞半径：保证大字灵也不会穿出画布 */
    _bodyClampRadius() {
      const w = this.width;
      const h = this.height;
      const ins = PB.inset(w, h);
      const pr = this.pointerInnerRadius();
      const cap = Math.min(w, h) * 0.44;
      let rHi = Math.min(w, h) * 0.5 - ins - 2;
      rHi = Math.max(rHi, 10);
      let r = Math.min(pr, cap);
      r = Math.min(r, rHi);
      return clamp(Math.max(r, 10), 10, rHi);
    }

    _wallShatter(nx, ny) {
      if (isMaskBackedMegaKao(this)) {
        this._rumbleAmp = Math.min(0.18, (this._rumbleAmp || 0) + 0.06);
        return;
      }
      const cell = this.gridCell || 12;
      const push = cell * (2.9 + Math.random() * 3.2);
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        g._tapScatterT = 0.62;
        g._tapScatterT0 = 0.62;
        const fx = nx || rand(-0.5, 0.5);
        const fy = ny || rand(-0.5, 0.5);
        g._tapScatterOX = fx * push + rand(-cell * 0.45, cell * 0.45);
        g._tapScatterOY = fy * push + rand(-cell * 0.45, cell * 0.45);
      }
      this._rumbleAmp = Math.min(0.62, (this._rumbleAmp || 0) + 0.34);
      this._glyphFlash = Math.min(0.52, (this._glyphFlash || 0) + 0.24);
    }

    _applyPlayfieldBounds(dt, now) {
      const b = this._playBounds();
      const r = this._bodyClampRadius();
      if (this.dragging) {
        if (this._dragShellDecoupled && this._dragShellWorld) {
          this._dragShellWorld.x = clamp(
            this._dragShellWorld.x,
            b.minX + r,
            b.maxX - r
          );
          this._dragShellWorld.y = clamp(
            this._dragShellWorld.y,
            b.minY + r,
            b.maxY - r
          );
        } else {
          this.pos.x = clamp(this.pos.x, b.minX + r, b.maxX - r);
          this.pos.y = clamp(this.pos.y, b.minY + r, b.maxY - r);
        }
        return;
      }
      const hit = PB.resolve(this.pos, this.vel, b, r, 0.38, 155);
      if (hit && now - this._lastWallFxAt > 55) {
        this._lastWallFxAt = now;
        this._wallShatter(hit.nx, hit.ny);
        const tx = -hit.ny;
        const ty = hit.nx;
        const sk = 28 * (0.85 + Math.random() * 0.55);
        this.vel.x += tx * sk * dt;
        this.vel.y += ty * sk * dt;
      }
    }

    /** 剪影 / mask 格迈与绘制的世界中心：呈现层拖曳解耦时为 `_dragShellWorld`，否则为 `pos` */
    _bodyWorldForShell() {
      if (
        this.dragging &&
        this._dragShellDecoupled &&
        this._dragShellWorld
      ) {
        return this._dragShellWorld;
      }
      return this.pos;
    }

    /** 交互命中：按当前字形包围球估计，避免巨字/扁形时「点不中拖不动」 */
    pointerInnerRadius() {
      const cell = this.gridCell || 12;
      const w = this._bodyWorldForShell();
      const bx = w.x;
      const by = w.y;
      const flip = this.facingFlip || 1;
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      let maxR = this.size * 0.3;
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        const txl = g.tx * flip;
        const tyl = g.ty;
        const wx = bx + (txl * cos - tyl * sin);
        const wy = by + (txl * sin + tyl * cos);
        const d = Math.hypot(wx - bx, wy - by) + cell * 0.95;
        if (d > maxR) maxR = d;
      }
      return Math.max(maxR, this.size * 0.24);
    }

    // 拖拽（世界坐标系）
    beginDrag(x, y) {
      if (this.viewMode !== "pet") return;
      this.dragging = true;
      this.dragOffset.x = this.pos.x - x;
      this.dragOffset.y = this.pos.y - y;
      this._dragResidualLx = 0;
      this._dragResidualLy = 0;
      this._dragShellDecoupled =
        isPresentationSilhouetteHarm(this) &&
        this.gridMarch &&
        this.gridSnapping;
      this._dragShellWorld = { x: this.pos.x, y: this.pos.y };
      this._dragPrevPos = { x: this.pos.x, y: this.pos.y };
      this.dragVel = { x: 0, y: 0 };
      if (this._dragShellDecoupled) {
        this.vel.x = 0;
        this.vel.y = 0;
      }
      this.setExpression("shy");
      for (const g of this.glyphs) {
        g.lagX = this.pos.x;
        g.lagY = this.pos.y;
      }
    }
    dragTo(x, y) {
      if (!this.dragging) return;
      const b = this._playBounds();
      const r = this._bodyClampRadius();
      const wantX = x + this.dragOffset.x;
      const wantY = y + this.dragOffset.y;
      const nx = clamp(wantX, b.minX + r, b.maxX - r);
      const ny = clamp(wantY, b.minY + r, b.maxY - r);
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (nowMs - this._lastWallFxAt > 70) {
        let wnx = 0;
        let wny = 0;
        if (wantX < b.minX + r - 0.5) wnx = 1;
        else if (wantX > b.maxX - r + 0.5) wnx = -1;
        if (wantY < b.minY + r - 0.5) wny = 1;
        else if (wantY > b.maxY - r + 0.5) wny = -1;
        if (wnx !== 0 || wny !== 0) {
          this._lastWallFxAt = nowMs;
          this._wallShatter(wnx, wny);
        }
      }
      if (this._dragPrevPos) {
        this.dragVel.x = nx - this._dragPrevPos.x;
        this.dragVel.y = ny - this._dragPrevPos.y;
        this._dragPrevPos.x = nx;
        this._dragPrevPos.y = ny;
      }
      if (this._dragShellDecoupled && this._dragShellWorld) {
        const ptx = this._dragShellWorld.x;
        const pty = this._dragShellWorld.y;
        this._dragShellWorld.x = nx;
        this._dragShellWorld.y = ny;
        const cell = this.gridCell || 12;
        const cos = Math.cos(this.rotation);
        const sin = Math.sin(this.rotation);
        const dwx = nx - ptx;
        const dwy = ny - pty;
        const dlx = (dwx * cos + dwy * sin) / Math.max(cell, 1);
        const dly = (-dwx * sin + dwy * cos) / Math.max(cell, 1);
        this._dragResidualLx = (this._dragResidualLx || 0) - dlx * 0.58;
        this._dragResidualLy = (this._dragResidualLy || 0) - dly * 0.58;
        const cap = 13;
        this._dragResidualLx = clamp(this._dragResidualLx, -cap, cap);
        this._dragResidualLy = clamp(this._dragResidualLy, -cap, cap);
      } else {
        this.pos.x = nx;
        this.pos.y = ny;
        this._dragShellWorld = null;
      }
    }
    endDrag() {
      const pending = this._pendingScriptReturn;
      this._pendingScriptReturn = false;
      this.dragging = false;
      this._dragPrevPos = null;
      if (this._dragShellDecoupled && this._dragShellWorld) {
        this.pos.x = this._dragShellWorld.x;
        this.pos.y = this._dragShellWorld.y;
      }
      this._dragShellWorld = null;
      this._dragShellDecoupled = false;
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
      const dev = this.showPlayfieldGuide === true;
      const tLoop0 =
        dev && typeof performance !== "undefined" ? performance.now() : 0;
      const dt = Math.min(0.033, (now - this._lastTime) / 1000);
      this._lastTime = now;
      const tUp0 =
        dev && typeof performance !== "undefined" ? performance.now() : 0;
      this._update(dt, now);
      const tUp1 =
        dev && tUp0 ? performance.now() : 0;
      const tRn0 =
        dev && typeof performance !== "undefined" ? performance.now() : 0;
      this._render(now);
      if (dev && tLoop0) {
        const tEnd = performance.now();
        this._devLoopLastMs = tEnd - tLoop0;
        this._devUpdateLastMs = tUp1 > tUp0 ? tUp1 - tUp0 : 0;
        this._devRenderLastMs = tEnd - tRn0;
        const ema = this._devLoopEmaMs;
        this._devLoopEmaMs = ema
          ? ema * 0.85 + this._devLoopLastMs * 0.15
          : this._devLoopLastMs;
      }
      this._raf = requestAnimationFrame(this._loop.bind(this));
    }

    _update(dt, now) {
      const t = now / 1000;
      const gms0 = clamp(
        this.glyphMotionSpeed != null ? this.glyphMotionSpeed : 1,
        0.25,
        2.5
      );
      const mk = mergePresentationSilhouetteMotion(
        this,
        getMotionProfileKernelsForPet(this)
      );
      const presSilHarm = isPresentationSilhouetteHarm(this);
      const presGlyphSleep =
        presSilHarm && !this.presentationGlyphDynamics;
      const silMaskPet = isMaskBackedMegaKao(this);
      this.breath = isMotionLayoutLockedForm(this.form)
        ? 1
        : Math.sin(t * 1.05) * 0.032 + 1;

      if (this.viewMode === "intro") {
        const capR = Math.min(this.width, this.height) * 0.22;
        for (const r of this.ripples) {
          r.r += 55 * dt * gms0;
          r.alpha -= 1.5 * dt;
          if (r.r > capR) r.alpha -= 2.2 * dt;
        }
        this.ripples = this.ripples.filter(
          (r) => r.alpha > 0 && r.r < capR * 1.05
        );
        return;
      }

      this._tickPresentationMegaAux(dt);

      if (!silMaskPet) {
        for (const g of this.glyphs) {
          g._silDrawOx = 0;
          g._silDrawOy = 0;
        }
      }

      const gms = gms0 * motionTimeBlend(mk.timeScale);
      /** 仅「呈现层剪影 + 关体内动」走强静态门控；勿把「辨」对折到待机 mask，否则待机巨字/颜会像被拖慢、与格移打架 */
      const contourStatic = !!presGlyphSleep;
      const gmsSil = contourStatic ? gms * 0.32 : gms;
      const sleepMul =
        this.mode === "sleep" && this.viewMode === "pet" ? 0.32 : 1;
      this._sleepMotionMul = sleepMul;
      const ensBoostCore = silMaskPet
        ? 0.62 + 0.48 * clamp(gms0, 0.35, 2.5)
        : 1;
      const ensBoost =
        ensBoostCore *
        (presSilHarm && this.presentationGlyphDynamics ? 0.55 : 1);
      this._ensemblePhase +=
        dt *
        (silMaskPet
          ? 0.82
          : 0.78 + 0.12 * Math.sin(t * 0.17)) *
        (silMaskPet ? gmsSil : gms) *
        ensBoost *
        sleepMul;

      if (this.viewMode !== "intro") {
        this.ripples.length = 0;
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
          if (isMotionLayoutLockedForm(this.form)) {
            this.idleAngle += dt * 0.12 * mk.anchorAmpScale;
            const s = 0.055 * mk.anchorAmpScale;
            this.anchor.x =
              this.center.x +
              Math.sin(this.idleAngle * 0.42) * this.width * s;
            this.anchor.y =
              this.center.y +
              Math.cos(this.idleAngle * 0.38) * this.height * s * 0.92;
          } else {
            this.idleAngle += dt * 0.35 * gms * mk.anchorAmpScale;
            const aM = mk.anchorAmpScale;
            const ax =
              this.center.x +
              Math.sin(this.idleAngle * 0.7) * this.width * 0.3 * aM +
              Math.sin(this.idleAngle * 1.3 + 1.1) * this.width * 0.12 * aM;
            const ay =
              this.center.y +
              Math.cos(this.idleAngle * 0.6) * this.height * 0.22 * aM +
              Math.sin(this.idleAngle * 1.1) * this.height * 0.11 * aM;
            this.anchor.x = ax;
            this.anchor.y = ay;
          }
        } else if (this.mode === "sleep") {
          this.anchor.x = lerp(this.anchor.x, this.center.x, 0.05);
          this.anchor.y = lerp(this.anchor.y, this.center.y + this.height * 0.05, 0.05);
        }
      }

      if (this.viewMode === "pet" && !this.dragging && this.mode !== "feeding") {
        const b = this._playBounds();
        const rBody = this._bodyClampRadius();
        const margin = Math.max(1, Math.min(this.width, this.height) * 0.002);
        const ar = Math.max(rBody - margin, 8);
        this.anchor.x = clamp(this.anchor.x, b.minX + ar, b.maxX - ar);
        this.anchor.y = clamp(this.anchor.y, b.minY + ar, b.maxY - ar);
      }

      if (this.viewMode === "script") {
        this.anchor.x = this.center.x;
        this.anchor.y = this.center.y;
        this.vel.x *= 0.82;
        this.vel.y *= 0.82;
      }
      if (!this.dragging) {
        const layoutLocked = isMotionLayoutLockedForm(this.form);
        const gmsVel =
          (layoutLocked ? 1 : 0.82 + 0.26 * gms) * mk.springFollowScale;
        const k = (this.mode === "feeding" ? 14 : layoutLocked ? 2.85 : 3.5) * gmsVel;
        const damp = (this.mode === "feeding" ? 4 : layoutLocked ? 2.75 : 2.2) / gmsVel;
        const ax = (this.anchor.x - this.pos.x) * k - this.vel.x * damp;
        const ay = (this.anchor.y - this.pos.y) * k - this.vel.y * damp;
        this.vel.x += ax * dt;
        this.vel.y += ay * dt;
      } else {
        this.vel.x *= 0.85;
        this.vel.y *= 0.85;
      }
      if (!(this.dragging && this._dragShellDecoupled)) {
        this.pos.x += this.vel.x * dt;
        this.pos.y += this.vel.y * dt;
      }
      this._applyPlayfieldBounds(dt, now);

      if (
        this.form === "clock" &&
        this.viewMode === "pet" &&
        !this.dragging &&
        !this.morphGlyphToTarget
      ) {
        const d = new Date();
        if (this.clockGranularity === "sec") {
          const slot =
            d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
          if (slot !== this._chronoSecondSlot) {
            this._chronoSecondSlot = slot;
            this.setForm("clock", true);
          }
        } else {
          const slot = d.getHours() * 60 + d.getMinutes();
          if (slot !== this._clockMinuteSlot) {
            this._clockMinuteSlot = slot;
            this.setForm("clock", true);
          }
        }
      }

      if (
        this.form === "chrono" &&
        this.viewMode === "pet" &&
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

      // 朝向：不再做水平翻面（facingFlip 曾导致文稿/巨字与阅读方向镜像相反）
      this.facingFlip = 1;
      this.targetRotation = isMotionLayoutLockedForm(this.form)
        ? 0
        : clamp(this.vel.x * 0.0005, -0.2, 0.2);
      this.rotation = lerp(this.rotation, this.targetRotation, 0.1);
      const breathUse = isMotionLayoutLockedForm(this.form)
        ? 1
        : lerp(1, this.breath, mk.breathMix);
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
      this._shapeMutationT = Math.max(0, (this._shapeMutationT || 0) - dt);

      if (this.faceLayerMode) this._syncFaceGlyphTargets(t);

      const shell = this._bodyWorldForShell();
      const bx = shell.x;
      const by = shell.y;
      const rot = this.rotation;
      const flip = 1;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const contourDrift = usesContourDrift(this);
      const snakeStream = usesMaskSnakeStream(this);
      const strictSilGrid =
        silhouetteStrictHarmonicGrid(this) &&
        !(presSilHarm && presGlyphSleep);
      const silJit = !!this.silhouetteGlyphJitter;
      const allowGridWander =
        !presSilHarm &&
        !snakeStream &&
        !(silMaskPet && !contourDrift);

      if (
        this.gridMarch &&
        this.gridSnapping &&
        !this.morphGlyphToTarget &&
        this.viewMode === "pet" &&
        this.pathMode !== "none" &&
        this.form !== "script" &&
        allowGridWander
      ) {
        if (t >= this._nextWanderPick) {
          this._nextWanderPick =
            t + (rand(0.28, 0.82) * mk.wanderPickIntervalMul) / gms;
          for (const g of this.glyphs) {
            if (g.faceRole || isMotionLayoutLockedForm(this.form)) continue;
            if (t >= g.wanderNextAt) {
              g.wanderNextAt =
                t + (rand(0.5, 1.75) * mk.wanderPickIntervalMul) / gms;
              this._pickWanderDelta(g, bx, by, cos, sin, flip);
            }
          }
        }
        for (const g of this.glyphs) {
          if (!g.faceRole && !isMotionLayoutLockedForm(this.form))
            this._stepWanderToward(g);
        }
      }

      if (this.dragLagEnabled) {
        const dvx = this.dragging ? this.dragVel.x : 0;
        const dvy = this.dragging ? this.dragVel.y : 0;
        for (const g of this.glyphs) {
          const rateBase = 4 + g.lagK * 6;
          const rate = this.dragging ? 24 + g.lagK * 30 : rateBase;
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

      this._maybeAdjacentTargetSwap(t);

      const cell = this.gridCell;
      const rumble =
        presSilHarm || silMaskPet ? 0 : (this._rumbleAmp || 0) * cell * 0.08;
      const waveAmp = (this.fluidStrength || 0) * cell * 0.09 * mk.ampScale;
      const maskFluidMul =
        this._maskPack && this._maskPack.grid ? 0.16 : 1;
      let waveAmpEff =
        waveAmp *
        maskFluidMul *
        (silMaskPet ? gmsSil : gms) *
        (presSilHarm ? 0.1 : 1) *
        (this._sleepMotionMul || 1);
      if (strictSilGrid) waveAmpEff = 0;
      if (!strictSilGrid) {
        this._fluidPhase +=
          dt *
          (presSilHarm ? 0.09 : 0.48) *
          (silMaskPet ? gmsSil : gms) *
          (this._sleepMotionMul || 1);
      }

      if (this.gridMarch && this.gridSnapping) {
        const marchGms =
          (gms * 0.55 + gms0 * 0.45) *
          (contourStatic ? 0.5 : 1) *
          (this._sleepMotionMul || 1);
        /** 呈现层剪影：每字每帧最多迈一格（匀速曼哈顿），避免多步追赶造成叠乱 */
        const rawMarchSteps = Math.round(
          (this.gridMarchSpeed || 2) *
            marchGms *
            dt *
            6 *
            (this._sleepMotionMul || 1)
        );
        const stepBudget = presSilHarm
          ? 1
          : Math.max(
              1,
              Math.min(
                silMaskPet ? 4 : 6,
                rawMarchSteps
              )
            );
        const crispMotion = isGridLayoutImmutableForm(this.form);

        if (snakeStream) {
          for (const gg of this.glyphs) {
            delete gg._snakeResolvedIdx;
          }
          if (t - (this._snakePathT || 0) > 0.72) {
            this._rebuildMaskSnakeWalkPath(bx, by, cos, sin, flip);
            this._snakePathT = t;
          }
          const snakeVisMul =
            presSilHarm && !presGlyphSleep ? 1.52 : presSilHarm ? 0.34 : 1;
          this._snakePhase +=
            dt *
            (0.28 + 0.46 * gms0) *
            (0.4 + 0.36 * clamp(this.gridMarchSpeed || 2, 0.85, 3.6)) *
            (contourStatic ? 0.42 : 1) *
            (this._sleepMotionMul || 1) *
            snakeVisMul;
          const pathSnake = this._snakeWalkPath;
          if (pathSnake && pathSnake.length > 1) {
            const L = pathSnake.length;
            const bodyGi = [];
            for (let gi = 0; gi < this.glyphs.length; gi++) {
              const g0 = this.glyphs[gi];
              const mT0 = this.morphGlyphToTarget && this.morphGlyphToTarget[gi];
              if (!g0.faceRole && !mT0) bodyGi.push(gi);
            }
            const N = bodyGi.length;
            if (N > 0) {
              const entries = [];
              for (let i = 0; i < N; i++) {
                const gi = bodyGi[i];
                const slot = (i * L) / N;
                const idx0 =
                  (Math.floor(this._snakePhase + slot) % L + L) % L;
                entries.push({ gi, idx0, ord: i });
              }
              entries.sort((a, b) => a.idx0 - b.idx0 || a.ord - b.ord);
              const used = new Set();
              for (const e of entries) {
                let idx = e.idx0;
                let guard = 0;
                while (used.has(idx) && guard < L) {
                  idx = (idx + 1) % L;
                  guard++;
                }
                used.add(idx);
                this.glyphs[e.gi]._snakeResolvedIdx = idx;
              }
            }
          }
        }

        for (let gi = 0; gi < this.glyphs.length; gi++) {
          const g = this.glyphs[gi];
          if (g.mgx == null || g.mgy == null) {
            g.mgx = Math.round(g.x / cell);
            g.mgy = Math.round(g.y / cell);
          }
          if (silMaskPet && !contourDrift) {
            g.marchPref = 0;
          } else if (g.marchPref == null) {
            g.marchPref = g.depth > 0.5 ? 1 : 0;
          }

          const txl = g.tx * flip;
          const tyl = g.ty;
          let wx = bx + (txl * cos - tyl * sin);
          let wy = by + (txl * sin + tyl * cos);
          if (presSilHarm && this.dragging && silMaskPet) {
            const ph = (gi + 1) * 2.03 + t * 0.95;
            const drx = (this._dragResidualLx || 0) * cell;
            const dry = (this._dragResidualLy || 0) * cell;
            wx += drx * (0.5 + 0.5 * Math.sin(ph));
            wy += dry * (0.5 + 0.5 * Math.cos(ph * 0.91));
          }

          const mT = this.morphGlyphToTarget && this.morphGlyphToTarget[gi];
          let useSnakeCell = false;
          if (
            snakeStream &&
            !presGlyphSleep &&
            !g.faceRole &&
            !mT &&
            this._snakeWalkPath &&
            this._snakeWalkPath.length > 1 &&
            g._snakeResolvedIdx != null
          ) {
            const idx = g._snakeResolvedIdx;
            const c = this._snakeWalkPath[idx];
            g._snakeSlot = idx;
            g._snakeMgx = c.gx;
            g._snakeMgy = c.gy;
            const mic = silJit
              ? cell *
                0.034 *
                Math.sin(this._ensemblePhase * 0.29 + idx * 0.07)
              : 0;
            wx = c.gx * cell + mic;
            wy = c.gy * cell + mic * 0.9;
            useSnakeCell = true;
          }

          if (
            !useSnakeCell &&
            !mT &&
            !g.faceRole &&
            this.viewMode === "pet" &&
            this.pathMode !== "none" &&
            !isMotionLayoutLockedForm(this.form) &&
            allowGridWander
          ) {
            wx += (g.wgx || 0) * cell;
            wy += (g.wgy || 0) * cell;
          }

          if (
            !useSnakeCell &&
            this.internalMotion &&
            !presGlyphSleep &&
            !g.faceRole &&
            !isMotionLayoutLockedForm(this.form)
          ) {
            const gmsPat = silMaskPet ? gmsSil : gms;
            let silStyleHarmMul = 1;
            if (silMaskPet && presSilHarm) {
              if (snakeStream) silStyleHarmMul = 0.4;
              else if (contourDrift) silStyleHarmMul = 1.38;
              else silStyleHarmMul = 0.66;
            }
            const pAmpBase =
              cell *
              0.072 *
              (this._patrolAmp || 1) *
              (this.dragging ? 1.15 : 1) *
              gmsPat *
              mk.ampScale *
              (this._sleepMotionMul || 1) *
              silStyleHarmMul;
            if (
              (presSilHarm || silMaskPet) &&
              !snakeStream &&
              !strictSilGrid
            ) {
              const phase =
                this._ensemblePhase * 0.58 + t * 0.06 * (silMaskPet ? gmsSil : gms);
              const spat = g.tx * 0.013 + g.ty * 0.0105;
              const tight = presSilHarm ? 1 : 1.06;
              const speedVis = clamp(0.68 + 0.44 * gms0, 0.62, 2.15);
              const uAmp =
                cell *
                0.058 *
                (this._patrolAmp || 1) *
                (this.dragging ? 1.06 : 1) *
                mk.ampScale *
                mk.crispMicroScale *
                speedVis *
                tight *
                (this._sleepMotionMul || 1);
              const ph2 = phase + spat * 1.72;
              wx += Math.sin(ph2) * uAmp;
              wx += Math.sin(ph2 * 2 + gi * 0.41) * uAmp * 0.16;
              wx += Math.sin(phase * 0.5 + spat * 2.9 + gi * 0.19) * uAmp * 0.09;
              wy +=
                Math.cos(phase * 0.93 + spat * 1.72 + 0.62) * uAmp * 0.86;
              wy +=
                Math.cos(phase * 1.87 + gi * 0.31) * uAmp * 0.13;
              wy +=
                Math.cos(phase * 0.48 + spat * 2.1 + gi * 0.23) * uAmp * 0.08;
            } else if (crispMotion) {
              const dispScale =
                (this.form === "mega" ? 1.08 : 1) * mk.crispMicroScale;
              const sync = this._ensemblePhase;
              const breath = Math.sin(sync);
              const sway = Math.sin(sync * 0.5 + 0.85);
              const ang = g.tx * 0.012 + g.ty * 0.01;
              /** 全队同拍前提下，用格位哈希弱去相关，减轻邻字同相「整块晃」感（幅面 <±5%） */
              const deco =
                1 +
                0.034 *
                Math.sin(g.tx * 0.31 + g.ty * 0.27 + gi * 0.19);
              const m =
                (0.82 + 0.18 * Math.sin(ang * 1.35 + sync * 0.28)) * deco;
              wx +=
                (breath * Math.cos(ang) + sway * 0.3 * Math.sin(ang)) *
                pAmpBase *
                0.44 *
                m *
                dispScale;
              wy +=
                (sway * Math.sin(ang) - breath * 0.3 * Math.cos(ang)) *
                pAmpBase *
                0.44 *
                m *
                dispScale;
            } else {
              const pAmpFull = pAmpBase * (g.patrolAmpMul || 1);
              const sync = this._ensemblePhase;
              const ph = (g.patrolSeed || 0) * 0.35;
              wx +=
                Math.sin(sync + ph) * pAmpFull * 0.63 +
                Math.sin(sync * 0.5 + ph * 1.05) * pAmpFull * 0.37;
              wy +=
                Math.cos(sync * 0.97 + ph * 0.95) * pAmpFull * 0.57 +
                Math.cos(sync * 0.48 + ph * 0.65) * pAmpFull * 0.35;
            }
          }

          if (
            !useSnakeCell &&
            waveAmpEff > 0.001 &&
            !presGlyphSleep &&
            !isMotionLayoutLockedForm(this.form)
          ) {
            if (crispMotion) {
              const dispScale =
                (this.form === "mega" ? 1.03 : 1) * mk.crispMicroScale;
              const ph = this._fluidPhase;
              const decoF =
                1 +
                0.03 *
                Math.sin(g.tx * 0.29 + g.ty * 0.21 + gi * 0.13);
              wx +=
                Math.sin(t * 0.95 + ph + g.tx * 0.008) *
                waveAmpEff *
                0.24 *
                dispScale *
                decoF;
              wy +=
                Math.cos(t * 0.88 - ph * 0.65 + g.ty * 0.008) *
                waveAmpEff *
                0.22 *
                dispScale *
                decoF;
            } else {
              const nx = wx * 0.017 + this._fluidPhase;
              const ny = wy * 0.015 - this._fluidPhase * 0.75;
              wx += Math.sin(nx + g.depth * 2.1) * waveAmpEff * 0.55;
              wy += Math.cos(ny + g.depth * 1.5) * waveAmpEff * 0.48;
            }
          }
          if (!useSnakeCell) {
            const rx = rumble ? Math.sin(t * 26 + g.depth * 15) * rumble : 0;
            const ry = rumble ? Math.cos(t * 24 + g.depth * 13) * rumble : 0;
            wx += rx;
            wy += ry;
          }
          if (g._tapScatterT > 0) {
            const t0 = g._tapScatterT0 || 0.38;
            const f = clamp(g._tapScatterT / t0, 0, 1);
            const sc = useSnakeCell
              ? 0.16
              : presSilHarm
                ? 0.2
                : silMaskPet
                  ? 0.42
                  : 1;
            wx += (g._tapScatterOX || 0) * f * sc;
            wy += (g._tapScatterOY || 0) * f * sc;
            g._tapScatterT -= dt;
          }

          let tgx;
          let tgy;
          if (mT) {
            tgx = Math.round(mT.twx / cell);
            tgy = Math.round(mT.twy / cell);
          } else if (useSnakeCell) {
            tgx = g._snakeMgx;
            tgy = g._snakeMgy;
          } else {
            tgx = Math.round(wx / cell);
            tgy = Math.round(wy / cell);
          }

          if (strictSilGrid && !mT && !useSnakeCell && !g.faceRole && !presGlyphSleep) {
            const ph =
              this._ensemblePhase * (0.38 + 0.2 * gms0) +
              gi * 0.37 +
              g.tx * 0.011 +
              0.055 * Math.sin(g.ty * 0.17 + g.tx * 0.13);
            const sx = Math.sin(ph);
            const sy = Math.cos(ph * 0.93 + 0.71);
            const on = 0.535;
            const off = 0.38;
            const prevX = g._silHistDgx | 0;
            const prevY = g._silHistDgy | 0;
            let dgx = 0;
            let dgy = 0;
            if (prevX === 1) {
              if (sx >= off) dgx = 1;
              else if (sx <= -on) dgx = -1;
            } else if (prevX === -1) {
              if (sx <= -off) dgx = -1;
              else if (sx >= on) dgx = 1;
            } else {
              if (sx >= on) dgx = 1;
              else if (sx <= -on) dgx = -1;
            }
            if (prevY === 1) {
              if (sy >= off) dgy = 1;
              else if (sy <= -on) dgy = -1;
            } else if (prevY === -1) {
              if (sy <= -off) dgy = -1;
              else if (sy >= on) dgy = 1;
            } else {
              if (sy >= on) dgy = 1;
              else if (sy <= -on) dgy = -1;
            }
            if (dgx !== 0 && dgy !== 0) {
              if (Math.abs(sx) >= Math.abs(sy)) dgy = 0;
              else dgx = 0;
            }
            g._silHistDgx = dgx;
            g._silHistDgy = dgy;
            tgx += dgx;
            tgy += dgy;
          }

          if (silMaskPet && !mT && !useSnakeCell) {
            const sn = this._nearestWalkableMarchCell(
              tgx,
              tgy,
              bx,
              by,
              cos,
              sin,
              flip
            );
            tgx = sn.gx;
            tgy = sn.gy;
          }

          const presSleepLock =
            presSilHarm &&
            presGlyphSleep &&
            silMaskPet &&
            !mT &&
            !useSnakeCell;

          if (presSleepLock) {
            g.mgx = tgx;
            g.mgy = tgy;
            g.x = tgx * cell;
            g.y = tgy * cell;
            g.vx = 0;
            g.vy = 0;
            g._silDrawOx = 0;
            g._silDrawOy = 0;
            g.rot = lerp(g.rot, g.targetRot, this.gridUnity ? 0.18 : 0.08);
            continue;
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

          const tgtX = g.mgx * cell;
          const tgtY = g.mgy * cell;
          /** mask 巨字/颜：禁用格间绘制 ease，否则对角插值会把字粒画出笔画轮廓外（辨形破坏） */
          const useEase =
            this.gridCellMotionEase && !mT && !silMaskPet;
          if (useEase) {
            const gEase = clamp(gms0, 0.35, 2.5);
            const rate =
              (10.5 + 8.5 * gEase) * (this.mode === "sleep" ? 0.62 : 1);
            const sm = 1 - Math.exp(-rate * dt);
            if (g.x == null || g.y == null || Number.isNaN(g.x)) {
              g.x = tgtX;
              g.y = tgtY;
            } else {
              g.x = lerp(g.x, tgtX, sm);
              g.y = lerp(g.y, tgtY, sm);
              const eps = Math.max(0.05, cell * 0.045);
              if (Math.abs(g.x - tgtX) < eps) g.x = tgtX;
              if (Math.abs(g.y - tgtY) < eps) g.y = tgtY;
            }
          } else {
            g.x = tgtX;
            g.y = tgtY;
          }
          g.vx = 0;
          g.vy = 0;

          if (
            silMaskPet &&
            silJit &&
            !g.faceRole &&
            !mT &&
            !(presSilHarm && presGlyphSleep)
          ) {
            const txo = wx - g.x;
            const tyo = wy - g.y;
            const jitAmp = clamp(
              this.silhouetteJitterAmpMul != null
                ? +this.silhouetteJitterAmpMul
                : 1,
              0.45,
              1.45
            );
            const cap = cell * 0.46 * jitAmp;
            const tox = clamp(txo, -cap, cap);
            const toy = clamp(tyo, -cap, cap);
            const oxPrev = g._silDrawOx || 0;
            const oyPrev = g._silDrawOy || 0;
            const err = Math.hypot(tox - oxPrev, toy - oyPrev);
            const errNorm = cap > 1e-6 ? err / cap : 0;
            const baseRate = presGlyphSleep ? 13.5 : 22;
            /** 误差大时略提高收敛率，贴近目标后自动柔化，减轻贴边微振 */
            const rate = baseRate * (1 + 2.15 * errNorm * errNorm);
            const sm = 1 - Math.exp(-dt * rate);
            g._silDrawOx = lerp(oxPrev, tox, sm);
            g._silDrawOy = lerp(oyPrev, toy, sm);
          } else {
            g._silDrawOx = 0;
            g._silDrawOy = 0;
          }

          g.rot = lerp(g.rot, g.targetRot, this.gridUnity ? 0.18 : 0.08);
        }

        this._separateOverlappingGridGlyphs();
        this._tryHuarongAdjacentSwaps(now);
        if (!presSilHarm) {
          this._tryMegaSlideIntoVoid(now);
        }
        if (silMaskPet) {
          this._stepSilhouetteVacancyInpull(t, gms, bx, by, cos, sin, flip);
          if (isPresentationSilhouetteHarm(this)) {
            this._updatePresentationSilhouetteGlyphLifecycle(
              dt,
              bx,
              by,
              cos,
              sin,
              flip
            );
          }
          /** 呈现剪影：每帧必跑第一遍叠分；关内动时每帧双遍；开内动时隔帧第二遍，减轻卡顿 */
          this._sepAltFrame = (this._sepAltFrame || 0) + 1;
          const sepSecondPass =
            !presSilHarm ||
            presGlyphSleep ||
            (this._sepAltFrame & 1) === 1;
          if (sepSecondPass) {
            this._separateOverlappingGridGlyphs();
          }
        }

        if (silMaskPet) {
          this._enforceMaskBackedGlyphWalkable(bx, by, cos, sin, flip);
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
        const gmsSpring = (0.88 + 0.22 * gms) * mk.springFollowScale;
        const springK =
          (this.mode === "feeding" ? 52 : 24) *
          fMul *
          (1 + (this._layoutSettle || 0) * 0.45) *
          gmsSpring;
        const damping =
          (this.mode === "feeding" ? 6.2 : 4.8) *
          (1 + (this._layoutSettle || 0) * 0.3);
        const rumble2 = (this._rumbleAmp || 0) * cell * 0.1;
        const waveAmp2 = (this.fluidStrength || 0) * cell * 0.11 * mk.ampScale;
        const waveAmp2Eff = waveAmp2 * maskFluidMul * gms;
        const texBudgetMul = this._textureBudgetMul();

        this._fluidPhase += dt * 0.52 * gms;

        for (const g of this.glyphs) {
          const shellBw = g.shapeBand === "shell" ? 0.35 : 1;
          const shellRu = g.shapeBand === "shell" ? 0.42 : 1;
          const tb = texBudgetMul;
          const txl = g.tx * flip;
          const tyl = g.ty;
          let wx = bx + (txl * cos - tyl * sin);
          let wy = by + (txl * sin + tyl * cos);
          if (
            !g.faceRole &&
            this.viewMode === "pet" &&
            this.pathMode !== "none" &&
            !isMotionLayoutLockedForm(this.form)
          ) {
            wx += (g.wgx || 0) * cell;
            wy += (g.wgy || 0) * cell;
          }
          if (this.gridSnapping && !g.faceRole) {
            wx = Math.round(wx / cell) * cell;
            wy = Math.round(wy / cell) * cell;
          }
          if (waveAmp2Eff > 0.001 && !isMotionLayoutLockedForm(this.form)) {
            const wEff = waveAmp2Eff * tb * (g.shapeBand === "shell" ? 0.52 : 1);
            const nx = wx * 0.019 + this._fluidPhase;
            const ny = wy * 0.017 - this._fluidPhase * 0.82;
            wx += Math.sin(nx + g.depth * 2.2) * wEff * 0.62;
            wy += Math.cos(ny + g.depth * 1.6) * wEff * 0.52;
            wx += Math.sin(nx * 2.1 + wy * 0.007) * wEff * 0.22;
          }
          const rx = rumble2
            ? Math.sin(t * 28 + g.depth * 16) * rumble2 * tb * shellRu
            : 0;
          const ry = rumble2
            ? Math.cos(t * 26 + g.depth * 14) * rumble2 * tb * shellRu
            : 0;
          let ax = (wx + rx - g.x) * springK - g.vx * damping;
          let ay = (wy + ry - g.y) * springK - g.vy * damping;
          if (!g.faceRole) {
            const mush = this.gridSnapping ? 0.28 : 1.0;
            const mushUse = isMotionLayoutLockedForm(this.form) ? 0.05 : mush;
            ax += Math.sin(t * 2 + g.depth * 6) * mushUse * tb * shellBw;
          }
          if (eyeWorld) {
            for (const e of eyeWorld) {
              const dx = g.x - e.x;
              const dy = g.y - e.y;
              const d = Math.hypot(dx, dy);
              if (d < eyeClearR && d > 0.01) {
                const push = ((eyeClearR - d) / eyeClearR) * 340;
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

      // 涟漪：仅 intro 使用；字灵/文稿模式不绘制扩张线圈，避免「漂浮形状轮廓」
      const rippleCap = Math.min(this.width, this.height) * 0.26;
      if (this.viewMode === "intro") {
        for (const r of this.ripples) {
          r.r += 62 * dt * gms;
          r.alpha -= 1.45 * dt;
          if (r.r > rippleCap) r.alpha -= 2.4 * dt;
        }
        this.ripples = this.ripples.filter(
          (r) => r.alpha > 0 && r.r < rippleCap * 1.08
        );
        if (this.ripples.length > 22) {
          this.ripples = this.ripples.slice(-22);
        }
      }

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

    /**
     * 与 `rasterizeMask` 相同缩放绘制 mask，保证垫底与可走格几何一致。
     */
    _rebuildMatteLayerCanvas(maskDrawFn, S) {
      if (typeof maskDrawFn !== "function" || !S) {
        this._silhouetteMatteLayer = null;
        return;
      }
      const cap = 320;
      const sampleS = Math.min(Math.max(8, Math.round(S)), cap);
      const scale = sampleS / S;
      const c = document.createElement("canvas");
      c.width = sampleS;
      c.height = sampleS;
      const g = c.getContext("2d", { willReadFrequently: false });
      if (!g) {
        this._silhouetteMatteLayer = null;
        return;
      }
      g.clearRect(0, 0, sampleS, sampleS);
      try {
        g.save();
        g.scale(scale, scale);
        maskDrawFn(g, S);
        g.restore();
      } catch (_) {
        this._silhouetteMatteLayer = null;
        return;
      }
      this._silhouetteMatteLayer = c;
    }

    /**
     * 在字粒之下绘制半透明 mask，提供静态辨形锚点（与 `_maskPack` 同源几何）。
     */
    _drawSilhouetteMatteUnderlay(ctx, light, bx, by, rot) {
      if (!isMaskBackedMegaKao(this)) return;
      /** 呈现层巨字/颜：轮廓由小字粒拼出，不叠整张 mask「大字底」；待机层仍可用整块灰底/淡影辅助 */
      if (isPresentationSilhouetteHarm(this)) return;
      const lay = this._silhouetteMatteLayer;
      if (!lay || !lay.width) return;
      const fullMatte = !!this.silhouetteMatteUnderlay;
      if (!fullMatte) return;
      const S = this.size;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(rot);
      ctx.translate(-S / 2, -S / 2);
      let a = light ? 0.19 : 0.29;
      if (this.outlineContourFirst) a += light ? 0.04 : 0.05;
      ctx.globalAlpha = a;
      ctx.drawImage(lay, 0, 0, lay.width, lay.height, 0, 0, S, S);
      ctx.globalAlpha = 1;
      ctx.restore();
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
        const skipDecorGrid =
          this.viewMode === "pet" &&
          isPresentationSilhouetteHarm(this) &&
          this.glyphs.length > 108;
        if (!isMotionLayoutLockedForm(this.form) && !skipDecorGrid) {
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

      if (this.showPlayfieldGuide && this.viewMode === "pet") {
        const box = this._playBounds();
        const rw = box.maxX - box.minX;
        const rh = box.maxY - box.minY;
        ctx.save();
        ctx.strokeStyle = light
          ? "rgba(0, 122, 255, 0.2)"
          : "rgba(130, 170, 255, 0.18)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(box.minX + 0.5, box.minY + 0.5, rw - 1, rh - 1);
        ctx.setLineDash([]);
        ctx.restore();
      }

      if (this.showPlayfieldGuide) {
        const lines = [];
        const lf = this._devLoopLastMs;
        const em = this._devLoopEmaMs;
        const up = this._devUpdateLastMs;
        const rn = this._devRenderLastMs;
        const rs = this._devResizeLastMs;
        lines.push(
          `frame ${lf > 0 ? lf.toFixed(1) + "ms" : "—"} (~${em > 0 ? em.toFixed(1) : "—"}ms) upd=${(up > 0 ? up : 0).toFixed(1)} ren=${(rn > 0 ? rn : 0).toFixed(1)}`
        );
        if (rs > 0) {
          lines.push(`resize ${rs.toFixed(1)}ms`);
        }
        const p = this._devPerfHud;
        if (p) {
          lines.push(
            `${p.ok ? "setForm" : "setForm·fail"} · ${p.key} · ${
              p.allMs != null ? p.allMs.toFixed(1) + "ms" : "—"
            }`
          );
          if (p.megaSizingMs != null) {
            lines.push(`mega定粒/resolve ${p.megaSizingMs.toFixed(1)}ms`);
          }
          if (p.buildLayoutMs != null) {
            lines.push(`buildLayout ${p.buildLayoutMs.toFixed(1)}ms`);
          }
          lines.push(`N=${p.particles} cell=${p.gridCell} ${p.uiArc}`);
          if (p.memoSize != null) {
            lines.push(`suggestMemo×${p.memoSize}`);
          }
        }
        ctx.save();
        ctx.font =
          '11px ui-monospace,SFMono-Regular,"Cascadia Code",Consolas,monospace';
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        const pad = 8;
        let y = pad + 4;
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          const tw = ctx.measureText(line).width;
          ctx.fillStyle = light ? "rgba(255,255,255,0.92)" : "rgba(28,28,30,0.92)";
          ctx.fillRect(W - pad - tw - 6, y - 2, tw + 10, 15);
          ctx.fillStyle = light ? "rgba(0,0,0,0.72)" : "rgba(255,255,255,0.82)";
          ctx.fillText(line, W - pad, y);
          y += 15;
        }
        ctx.restore();
      }

      if (this.viewMode === "intro") {
        ctx.save();
        ctx.lineWidth = 1.2;
        const rippleCapR = Math.min(W, H) * 0.26;
        for (const r of this.ripples) {
          const fall = 1 - Math.min(1, (r.r / rippleCapR) * 0.85) * 0.55;
          const a = r.alpha * fall;
          if (a < 0.03) continue;
          ctx.strokeStyle = light
            ? `rgba(0, 122, 255, ${a * 0.22})`
            : `rgba(180, 210, 255, ${a * 0.28})`;
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.r, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (this.viewMode === "intro") return;

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      try {
        if (typeof ctx.textRendering === "string") {
          ctx.textRendering = "geometricPrecision";
        }
      } catch (_) {}
      const flash = isMaskBackedMegaKao(this)
        ? (this._glyphFlash || 0) * 0.1
        : this._glyphFlash || 0;

      this._drawSilhouetteMatteUnderlay(
        ctx,
        light,
        this.pos.x,
        this.pos.y,
        this.rotation
      );

      /** 呈现剪影躯体：本帧共用的整数 px 字号，避免逐字 round 造成大小不一 */
      this._presSilUniformPxInt = null;

      const drawGlyph = (g, opts) => {
        const crispForm = isGridLayoutImmutableForm(this.form);
        const edge = g.edge;
        const silDraw =
          isMaskBackedMegaKao(this) && !g.faceRole && this.silhouetteGlyphJitter;
        let rx = this.gridUnity ? Math.round(g.x) : g.x;
        let ry = this.gridUnity ? Math.round(g.y) : g.y;
        if (silDraw) {
          rx += g._silDrawOx || 0;
          ry += g._silDrawOy || 0;
        }
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
        const megaSilPres =
          isPresentationSilhouetteHarm(this) &&
          crispForm &&
          isMaskBackedMegaKao(this) &&
          !g.faceRole;
        const uniformBodyPx =
          megaSilPres &&
          this._presSilUniformBodyPx != null &&
          !Number.isNaN(+this._presSilUniformBodyPx)
            ? +this._presSilUniformBodyPx
            : null;
        const baseSize =
          (uniformBodyPx != null ? uniformBodyPx : g.size) *
          this.scale *
          (opts.sizeMul || 1);
        let size = baseSize * (megaSilPres ? 1 : roleMul);
        if (this.gridUnity && this.gridCell) {
          let cap = this.gridCell * (crispForm ? 0.92 : 0.88) * this.scale;
          if (isPresentationSilhouetteHarm(this) && crispForm) {
            cap *= megaSilPres ? 0.96 : 0.93;
          }
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
        const flashBoost =
          megaSilPres || silDraw
            ? 1
            : 1 + Math.min(flash, 0.52) * flashW * 0.42;
        const edgeAlpha = megaSilPres
          ? 1
          : crispForm
            ? lerp(0.99, 0.92, edge)
            : lerp(0.94, 0.42, edge);
        const glowMul =
          g.faceRole || megaSilPres ? 1 : this._glowAlphaMul(g, t);
        const presBodyAlphaMul =
          isPresentationSilhouetteHarm(this) &&
          !this.presentationGlyphDynamics &&
          !g.faceRole
            ? 0.74
            : 1;
        const ga = g.alpha == null || Number.isNaN(+g.alpha) ? 1 : +g.alpha;
        const glyphAlpha =
          megaSilPres && !this.presentationGlyphDynamics
            ? clamp(ga, 0.9, 1)
            : ga;
        const alpha =
          (opts.alphaMul != null ? opts.alphaMul : 1) *
          presBodyAlphaMul *
          flashBoost *
          edgeAlpha *
          glyphAlpha *
          glowMul;
        const fontMain =
          '"LXGW WenKai","LXGW WenKai Screen","Noto Serif SC","Noto Sans SC",serif';
        let pxInt = Math.max(8, Math.round(size));
        if (
          megaSilPres &&
          uniformBodyPx != null &&
          !emojiLike &&
          this.gridUnity
        ) {
          if (this._presSilUniformPxInt == null) {
            this._presSilUniformPxInt = pxInt;
          }
          pxInt = this._presSilUniformPxInt;
        }
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
        } else if (
          !g.faceRole &&
          this.bodyTintHex &&
          /^#[0-9A-Fa-f]{6}$/.test(this.bodyTintHex)
        ) {
          const br = parseInt(this.bodyTintHex.slice(1, 3), 16);
          const bge = parseInt(this.bodyTintHex.slice(3, 5), 16);
          const bb = parseInt(this.bodyTintHex.slice(5, 7), 16);
          const ek = megaSilPres
            ? light
              ? 0.88
              : 0.82
            : light
              ? lerp(0.5, 1, edge)
              : lerp(0.42, 1, 1 - edge * 0.65);
          fillStyle = `rgba(${clamp(Math.round(br * ek), 0, 255)},${clamp(
            Math.round(bge * ek),
            0,
            255
          )},${clamp(Math.round(bb * ek), 0, 255)},${alpha})`;
        } else if (!g.faceRole && (this.bodyColorMode || 0) > 0) {
          const cm = this.bodyColorMode || 0;
          const breath = 0.5 + 0.5 * Math.sin(t * 2.35 + (g.depth || 0) * 1.55);
          const by0 = this.pos.y;
          const bx0 = this.pos.x;
          const Sref = Math.max(this.size * 0.48, 105);
          let u = 0.5;
          if (!(megaSilPres && !this.presentationGlyphDynamics)) {
            if (cm === 1) {
              const ny = clamp((g.y - by0) / Sref + 0.5, 0, 1);
              u = clamp(ny * 0.32 + breath * 0.68, 0, 1);
            } else if (cm === 2) {
              const d = clamp(Math.hypot(g.x - bx0, g.y - by0) / Sref, 0, 1);
              u = clamp(d * 0.42 + breath * 0.58, 0, 1);
            } else if (cm === 3) {
              const ny = clamp((g.y - by0) / Sref + 0.5, 0, 1);
              u = clamp(
                ny * 0.35 + breath * 0.65 + Math.sin(t * 2.05 + (g.depth || 0)) * 0.2,
                0,
                1
              );
            }
          }
          if (light) {
            const inkR = Math.round(lerp(6, 152, u));
            const inkG = Math.round(lerp(10, 158, u));
            const inkB = Math.round(lerp(18, 168, u));
            fillStyle = `rgba(${inkR},${inkG},${inkB},${alpha})`;
          } else {
            const inkR = Math.round(lerp(255, 72, u));
            const inkG = Math.round(lerp(255, 118, u));
            const inkB = Math.round(lerp(255, 178, u));
            fillStyle = `rgba(${inkR},${inkG},${inkB},${alpha})`;
          }
        } else if (opts.cel === false) {
          const pulse = megaSilPres
            ? 0
            : Math.sin(t * 2.25 + (g.depth || 0) * 2.8) * 0.1;
          const edgeUse = megaSilPres
            ? 0.54
            : clamp(edge + pulse, 0, 1);
          if (light) {
            const inkR = Math.round(lerp(22, 108, edgeUse));
            const inkG = Math.round(lerp(24, 118, edgeUse));
            const inkB = Math.round(lerp(30, 128, edgeUse));
            fillStyle = `rgba(${inkR},${inkG},${inkB},${alpha})`;
          } else {
            const inkR = Math.round(lerp(248, 100, edgeUse));
            const inkG = Math.round(lerp(252, 148, edgeUse));
            const inkB = Math.round(lerp(255, 198, edgeUse));
            fillStyle = `rgba(${inkR},${inkG},${inkB},${alpha})`;
          }
        } else {
          const celGn = megaSilPres
            ? Object.assign({}, g, {
                edge: 0.5,
                tx: 0,
                ty: 0,
                patrolSeed: 0,
              })
            : g;
          const celT =
            megaSilPres && !this.presentationGlyphDynamics ? 0 : t;
          const cel = celRgbFromGlyph(
            celGn,
            light,
            celT,
            this._fluidPhase || 0
          );
          const [or, og, ob] = cel.outlineRgb;
          const outlineA = alpha * (0.5 + cel.edgeMul * 0.38);
          const px = this._pxScale || 1;
          const useCelHalo =
            !light &&
            !g.faceRole &&
            !megaSilPres &&
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

      // 自定义墨色场开启时关闭 cel，保证整块渐变一致
      const useCelInk =
        !isGridLayoutImmutableForm(this.form) &&
        !light &&
        (this.bodyColorMode || 0) === 0 &&
        !this.bodyTintHex;
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        drawGlyph(g, { flashWeight: 0.45, cel: useCelInk });
      }

      if (usesMaskSnakeStream(this) && this.viewMode === "pet" && this.gridMarch) {
        const body = this.glyphs.filter((g) => !g.faceRole);
        if (body.length > 1) {
          body.sort((a, b) => (a._snakeSlot | 0) - (b._snakeSlot | 0));
          ctx.save();
          ctx.strokeStyle = light
            ? "rgba(0, 115, 175, 0.11)"
            : "rgba(130, 200, 255, 0.14)";
          ctx.lineWidth = Math.max(0.9, (this.gridCell || 12) * 0.065);
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          const silPt = (g) => {
            const ox = this.silhouetteGlyphJitter ? g._silDrawOx || 0 : 0;
            const oy = this.silhouetteGlyphJitter ? g._silDrawOy || 0 : 0;
            let px = (this.gridUnity ? Math.round(g.x) : g.x) + ox;
            let py = (this.gridUnity ? Math.round(g.y) : g.y) + oy;
            if (this.gridUnity) {
              px = this._snapLogicalToDevice(px);
              py = this._snapLogicalToDevice(py);
            }
            return [px, py];
          };
          ctx.beginPath();
          for (let i = 0; i < body.length; i++) {
            const [px, py] = silPt(body[i]);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.restore();
        }
      }

      // 朱砂点缀（巨字/曲线等清晰形态跳过，避免叠影发糊）
      if (
        this.spotAccent &&
        this.glyphs.length > 0 &&
        !isGridLayoutImmutableForm(this.form)
      ) {
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

    /**
     * 侧栏或脚本改完偏好后调用：**快照当前活属性 → 写回当前层级桶 → 再应用**，并重算格点字号；
     * 可选对 mask 巨字/颜跑两遍叠分，缓解连点后参数漂移、叠字、字身歪斜残留。
     * @param {{ layoutHard?: boolean }} [opts] layoutHard=true 时在格迈+贴格下额外叠分（较重）
     */
    stabilizeAfterControl(opts) {
      const layoutHard = !!(opts && opts.layoutHard);
      snapshotArcVisualPrefs(this);
      applyArcVisualPrefsToPet(this);
      if (this.viewMode !== "pet" || !this.glyphs || !this.glyphs.length) return;
      this._snapSilhouetteBodyUprightIfStill();
      if (!this.gridUnity) return;
      this._applyGridTypography();
      if (
        layoutHard &&
        this.gridMarch &&
        this.gridSnapping &&
        isMaskBackedMegaKao(this) &&
        this.glyphs.length > 1
      ) {
        this._separateOverlappingGridGlyphs();
        this._separateOverlappingGridGlyphs();
      }
    }

    /** 呈现剪影且关内动：字身立即扶正，避免 `rot` 慢跟随造成「整片歪」 */
    _snapSilhouetteBodyUprightIfStill() {
      if (
        !isPresentationSilhouetteHarm(this) ||
        !isMaskBackedMegaKao(this) ||
        this.presentationGlyphDynamics
      ) {
        return;
      }
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        g.rot = 0;
      }
    }

    /** 浮光：浓淡律动乘在透明度上（0=关） */
    _glowAlphaMul(g, t) {
      const gm = this.glowMode | 0;
      if (gm <= 0) return 1;
      const ph = (g.depth || 0) * 4.2 + (g.patrolSeed || 0);
      let m = 1;
      if (gm === 1) m = 0.62 + 0.38 * Math.sin(t * 2.1 + ph * 0.31);
      else if (gm === 2) m = 0.55 + 0.45 * Math.sin(t * 1.85 + g.y * 0.022);
      else if (gm === 3)
        m =
          0.58 +
          0.42 *
            Math.sin(
              t * 2.35 +
                Math.hypot(g.x - this.pos.x, g.y - this.pos.y) * 0.013
            );
      else if (gm === 4) m = 0.48 + 0.52 * Math.sin(t * 4.05 + ph + g.tx * 0.024);
      else if (gm === 5) m = Math.sin(t * 6.8) > 0.1 ? 1.18 : 0.62;
      return clamp(m, 0.38, 1.28);
    }

    setBodyTint(hex) {
      if (hex == null || hex === "") {
        this.bodyTintHex = null;
      } else {
        const s = String(hex).trim();
        this.bodyTintHex = /^#[0-9A-Fa-f]{6}$/.test(s) ? s : this.bodyTintHex;
      }
      snapshotArcVisualPrefs(this);
    }

    /** 侧栏「走格」循环：呈现巨字/颜仅 **谐步 ⟷ 廊道**（壳漫游易与小字拼轮廓冲突，已禁用）。 */
    cycleBodyMotionStyle() {
      const order =
        this.uiArcMode === "presentation"
          ? ["harmonic", "snake_stream"]
          : BODY_MOTION_STYLES.slice();
      const cur = normalizeBodyMotionStyle(this.bodyMotionStyle);
      let ix = order.indexOf(cur);
      if (ix < 0) ix = 0;
      const next = order[(ix + 1) % order.length];
      this.bodyMotionStyle = next;
      snapshotArcVisualPrefs(this);
      return this.bodyMotionStyle;
    }

    /** 显式设置走格范式（侧栏三键直达）；呈现层拒绝 `contour_drift`。 */
    setBodyMotionStyle(style) {
      let s = normalizeBodyMotionStyle(style);
      if (this.uiArcMode === "presentation" && s === "contour_drift") {
        s = "harmonic";
      }
      this.bodyMotionStyle = s;
      snapshotArcVisualPrefs(this);
      applyArcVisualPrefsToPet(this);
      return this.bodyMotionStyle;
    }

    /** 躯体字统一字号挡（待机/呈现各记一套；与巨字「字比」独立） */
    cycleBodyGlyphEmMul() {
      const tiers = [0.86, 0.92, 1, 1.06, 1.12];
      const b = this._arcPrefs[this.uiArcMode];
      let cur = b.bodyGlyphEmMul != null ? +b.bodyGlyphEmMul : 1;
      cur = clamp(cur, 0.82, 1.18);
      let i = tiers.findIndex((t) => Math.abs(t - cur) < 0.045);
      if (i < 0) {
        let best = 0;
        let bd = Infinity;
        for (let k = 0; k < tiers.length; k++) {
          const d = Math.abs(tiers[k] - cur);
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        i = best;
      }
      const next = clamp(tiers[(i + 1) % tiers.length], 0.82, 1.18);
      b.bodyGlyphEmMul = next;
      this.bodyGlyphEmMul = next;
      this._applyGridTypography();
      snapshotArcVisualPrefs(this);
      return next;
    }

    /** 呈现层巨字：拼满画布（自动分行+缩比）↔ 全文逐字轮换剪影 */
    cyclePresentationMegaLayoutMode() {
      const b = this._arcPrefs.presentation;
      const cur = normalizeMegaPresentationLayoutMode(
        b.presentationMegaLayoutMode
      );
      const next =
        cur === "fit_canvas" ? "sequential_chars" : "fit_canvas";
      b.presentationMegaLayoutMode = next;
      this.presentationMegaLayoutMode = next;
      this._megaSeqIdx = 0;
      this._megaSeqAcc = 0;
      if (this.form === "mega" && this.viewMode === "pet") {
        this.setForm("mega", true, true);
      }
      snapshotArcVisualPrefs(this);
      return next;
    }

    /** 亚格颤动画位移幅度挡（与「颤」开关联用；当前层记忆） */
    cycleSilhouetteJitterAmpMul() {
      const tiers = [0.55, 0.72, 0.88, 1, 1.12, 1.32];
      const b = this._arcPrefs[this.uiArcMode];
      let cur =
        b.silhouetteJitterAmpMul != null ? +b.silhouetteJitterAmpMul : 1;
      cur = clamp(cur, 0.45, 1.45);
      let i = tiers.findIndex((t) => Math.abs(t - cur) < 0.06);
      if (i < 0) {
        let best = 0;
        let bd = Infinity;
        for (let k = 0; k < tiers.length; k++) {
          const d = Math.abs(tiers[k] - cur);
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        i = best;
      }
      const next = clamp(tiers[(i + 1) % tiers.length], 0.45, 1.45);
      b.silhouetteJitterAmpMul = next;
      this.silhouetteJitterAmpMul = next;
      snapshotArcVisualPrefs(this);
      return next;
    }

    /** 侧栏「颤」：巨字/颜文字 mask 内亚格绘制位移 + 谐波微振（默认关；谐波轨下关=严格格点） */
    cycleSilhouetteGlyphJitter() {
      this.silhouetteGlyphJitter = !this.silhouetteGlyphJitter;
      snapshotArcVisualPrefs(this);
      return this.silhouetteGlyphJitter;
    }

    /** 侧栏「整块灰底」：mask 静态垫底（分套；与「淡影」二选一强度链） */
    cycleSilhouetteMatteUnderlay() {
      const b = this._arcPrefs[this.uiArcMode];
      b.silhouetteMatteUnderlay = !b.silhouetteMatteUnderlay;
      applyArcVisualPrefsToPet(this);
      return this.silhouetteMatteUnderlay;
    }

    /**
     * 侧栏「淡影」：**可选**叠极弱整幅 mask 垫底（与「整块灰底」二选一强度链；默认关，防「第二重剪影」抢读）。
     */
    cycleOutlineContourFirst() {
      const b = this._arcPrefs[this.uiArcMode];
      b.outlineContourFirst = !b.outlineContourFirst;
      applyArcVisualPrefsToPet(this);
      return this.outlineContourFirst;
    }

    /**
     * 侧栏「内动」：**呈现层**巨字/颜体内字粒是否跑谐波/流体/蛇行等（分套；默认关=先静后动）。
     * 待机层无此概念，仍写入呈现层偏好供下次切入呈现层生效。
     */
    cyclePresentationGlyphDynamics() {
      const b = this._arcPrefs.presentation;
      const prev = !!b.presentationGlyphDynamics;
      b.presentationGlyphDynamics = !b.presentationGlyphDynamics;
      const next = !!b.presentationGlyphDynamics;
      if (next && !prev) {
        // 关→开：极弱提亮，避免巨字辨形时「整屏闪一下」
        this._glyphFlash = Math.min(0.16, Math.max(this._glyphFlash || 0, 0.09));
      }
      if (this.uiArcMode === "presentation") {
        applyArcVisualPrefsToPet(this);
      } else {
        this.presentationGlyphDynamics = !!b.presentationGlyphDynamics;
      }
      return next;
    }

    /**
     * 侧栏「规整」：写入 **呈现层**偏好 — 横竖格谐步、关体内动、关亚格颤、纹理回到流、略抑流体；不切「层」、不换形。
     * 若当前已在呈现层且为巨字/颜 mask，会立刻重算字号并 **双遍疏散叠格**。
     */
    applyPresentationSilhouetteHarmonicCalm() {
      const b = this._arcPrefs.presentation;
      b.bodyMotionStyle = "harmonic";
      b.glyphsJitter = false;
      b.presentationGlyphDynamics = false;
      b.textureMotionMode = normalizeTextureMotionMode("spring_flow");
      b.fluidStrength = clamp(Math.min(+b.fluidStrength || 0, 0.1), 0, 0.55);
      if (this.uiArcMode === "presentation") {
        applyArcVisualPrefsToPet(this);
        this._applyGridTypography();
        if (this.gridMarch && this.gridSnapping && this.glyphs && this.glyphs.length) {
          this._separateOverlappingGridGlyphs();
          this._separateOverlappingGridGlyphs();
        }
        const nowMs =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        /** 先静约 0.9s，再允许邻格互换；互换时在关内动下带一次淡入淡出感 */
        this._huarongNextAt = nowMs + 1050;
      }
      return true;
    }

    /** 巨字相对身幅缩放挡；与 `gridCell` 决定的下限取 max；换形巨字时生效 */
    cycleMegaLayoutScale() {
      const tiers = [0.86, 0.92, 1, 1.06, 1.12];
      const b = this._arcPrefs[this.uiArcMode];
      const cur = clamp(
        b.megaLayoutScale != null ? +b.megaLayoutScale : 1,
        0.78,
        1.14
      );
      let i = tiers.findIndex((t) => Math.abs(t - cur) < 0.02);
      if (i < 0) i = 2;
      b.megaLayoutScale = tiers[(i + 1) % tiers.length];
      applyArcVisualPrefsToPet(this);
      if (this.form === "mega") this.setForm("mega", true, true);
      return this.megaLayoutScale;
    }

    /** 巨字容纳：缩字填满 / 截断可放下的前缀 / 双行 */
    cycleMacroFitMode() {
      const b = this._arcPrefs[this.uiArcMode];
      const cur = normalizeMacroFitMode(b.macroFitMode);
      const ix = MACRO_FIT_MODES.indexOf(cur);
      b.macroFitMode = MACRO_FIT_MODES[(ix + 1) % MACRO_FIT_MODES.length];
      applyArcVisualPrefsToPet(this);
      if (this.form === "mega") this.setForm("mega", true, true);
      return this.macroFitMode;
    }

    /** 侧栏「紊」：弹簧纹理流 ↔ 芯层邻接换位（关格移时生效；分套记忆） */
    cycleTextureMotionMode() {
      const b = this._arcPrefs[this.uiArcMode];
      const cur = normalizeTextureMotionMode(b.textureMotionMode);
      const ix = TEXTURE_MOTION_MODES.indexOf(cur);
      b.textureMotionMode =
        TEXTURE_MOTION_MODES[(ix + 1) % TEXTURE_MOTION_MODES.length];
      applyArcVisualPrefsToPet(this);
      return this.textureMotionMode;
    }

    /** 螺旋 / 弓字走廊；切换后下一帧强制重建蛇行路径 */
    setSnakePathVariant(v) {
      this.snakePathVariant = normalizeSnakePathVariant(v);
      this._snakePathT = 0;
      return this.snakePathVariant;
    }

    /** 侧栏「速」：循环体内运动速度挡位 */
    cycleGlyphMotionSpeed() {
      const tiers = [0.4, 0.65, 1, 1.45, 1.9, 2.35];
      let i = tiers.indexOf(this.glyphMotionSpeed);
      if (i < 0) {
        let best = 0;
        let bd = Infinity;
        for (let k = 0; k < tiers.length; k++) {
          const d = Math.abs(tiers[k] - (this.glyphMotionSpeed || 1));
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        i = best;
      }
      this.glyphMotionSpeed = tiers[(i + 1) % tiers.length];
      snapshotArcVisualPrefs(this);
      return this.glyphMotionSpeed;
    }

    cycleGlowMode() {
      this.glowMode = ((this.glowMode | 0) + 1) % 6;
      snapshotArcVisualPrefs(this);
    }

    /** 循环躯体墨色场模式（0～3），供 UI「墨」按钮调用 */
    cycleBodyColorMode() {
      this.bodyColorMode = ((this.bodyColorMode | 0) + 1) % 4;
      snapshotArcVisualPrefs(this);
    }

    /** 当前层：液体波纹强度（与速/墨等分套记忆） */
    cycleArcFluidStrength() {
      const tiers = [0, 0.06, 0.12, 0.18, 0.25, 0.34, 0.44];
      const cur = clamp(this.fluidStrength != null ? +this.fluidStrength : 0.2, 0, 0.55);
      let i = tiers.findIndex((t) => Math.abs(t - cur) < 0.026);
      if (i < 0) {
        let best = 0;
        let bd = Infinity;
        for (let k = 0; k < tiers.length; k++) {
          const d = Math.abs(tiers[k] - cur);
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        i = best;
      }
      this.fluidStrength = clamp(tiers[(i + 1) % tiers.length], 0, 0.55);
      snapshotArcVisualPrefs(this);
      return this.fluidStrength;
    }

    /** 当前层：格点沿路径移动速度 */
    cycleArcGridMarchSpeed() {
      const tiers = [1.1, 1.45, 1.85, 2.25, 2.75, 3.2];
      const cur = clamp(
        this.gridMarchSpeed != null ? +this.gridMarchSpeed : 2,
        0.85,
        3.6
      );
      let i = tiers.findIndex((t) => Math.abs(t - cur) < 0.11);
      if (i < 0) {
        let best = 0;
        let bd = Infinity;
        for (let k = 0; k < tiers.length; k++) {
          const d = Math.abs(tiers[k] - cur);
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        i = best;
      }
      this.gridMarchSpeed = clamp(tiers[(i + 1) % tiers.length], 0.85, 3.6);
      snapshotArcVisualPrefs(this);
      return this.gridMarchSpeed;
    }

    /**
     * 当前层：巨字粒数乘子（越小越疏）；已是巨字时立即重建布局。
     */
    cycleArcMegaParticleMul() {
      const b = this._arcPrefs[this.uiArcMode];
      const tiers = [0.78, 0.88, 1, 1.1, 1.18];
      let cur = b.megaParticleMul != null ? +b.megaParticleMul : 1;
      cur = clamp(cur, 0.72, 1.28);
      let i = tiers.findIndex((t) => Math.abs(t - cur) < 0.045);
      if (i < 0) {
        let best = 0;
        let bd = Infinity;
        for (let k = 0; k < tiers.length; k++) {
          const d = Math.abs(tiers[k] - cur);
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        i = best;
      }
      b.megaParticleMul = clamp(tiers[(i + 1) % tiers.length], 0.72, 1.28);
      if (this.form === "mega" && this.viewMode === "pet") {
        this.setForm("mega", true, true);
      }
      snapshotArcVisualPrefs(this);
      return b.megaParticleMul;
    }

    /**
     * 侧栏「待机 / 呈现」层级：决定运动内核与独立一套色·速·墨·浮光参数。
     * @param {boolean} [silent] 为 true 时不触发 onUiArcModeChange
     */
    setUiArcMode(mode, silent) {
      const m = mode === "presentation" ? "presentation" : "standby";
      if (m === this.uiArcMode) {
        if (!silent && this.onUiArcModeChange) {
          try {
            this.onUiArcModeChange(this.uiArcMode);
          } catch (_) {}
        }
        return this.uiArcMode;
      }
      snapshotArcVisualPrefs(this);
      this.uiArcMode = m;
      applyArcVisualPrefsToPet(this);
      if (this.viewMode === "pet") {
        if (
          this.uiArcMode === "presentation" &&
          !isDisplayPresentationForm(this.form) &&
          this.form !== "script"
        ) {
          this.setForm(this._lastPresentationForm || "mega", true, true);
        } else if (
          this.uiArcMode === "standby" &&
          isDisplayPresentationForm(this.form)
        ) {
          this.setForm(this._lastStandbyForm || "blob", true, true);
        }
      }
      if (!silent && this.onUiArcModeChange) {
        try {
          this.onUiArcModeChange(this.uiArcMode);
        } catch (_) {}
      }
      return this.uiArcMode;
    }

    cycleUiArcMode(silent) {
      return this.setUiArcMode(
        this.uiArcMode === "presentation" ? "standby" : "presentation",
        silent
      );
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
    STANDBY_MATH_ORDER,
    DEFAULT_POOL,
    DIGEST_RULES,
    CHAR_DIGEST_HINT,
    CHAR_FORM_BIAS,
    classifyScheduleLine,
    isDisplayPresentationForm,
    isPresentationSilhouetteHarm,
    isMaskBackedMegaKao,
    BODY_MOTION_STYLES,
    BODY_MOTION_LABELS,
    normalizeBodyMotionStyle,
    SNAKE_PATH_VARIANTS,
    normalizeSnakePathVariant,
    usesMaskSnakeStream,
    usesContourDrift,
    silhouetteStrictHarmonicGrid,
    TEXTURE_MOTION_MODES,
    TEXTURE_MOTION_LABELS,
    MACRO_FIT_MODES,
    MACRO_FIT_LABELS,
    normalizeMacroFitMode,
    MEGA_PRESENTATION_LAYOUT_MODES,
    MEGA_PRESENTATION_LAYOUT_LABELS,
    normalizeMegaPresentationLayoutMode,
    getMotionProfileKernels,
    getMotionProfileKernelsForPet,
    motionTimeBlend,
    getFormOrderForUiArcMode,
    get ShapeField() {
      return typeof window !== "undefined" ? window.ZiLingShapeField : undefined;
    },
    get MatrixBridge() {
      return typeof window !== "undefined" ? window.ZiLingMatrixBridge : undefined;
    },
    get ShapeFieldConsumer() {
      return typeof window !== "undefined"
        ? window.ZiLingShapeFieldConsumer
        : undefined;
    },
  };
})();
