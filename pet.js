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

  /** 字池中出现某字时给形态的「饮食偏好」累积 */
  const CHAR_FORM_BIAS = {
    鱼: "koi",
    鲤: "koi",
    月: "moon",
    花: "flower",
    蝶: "butterfly",
    网: "emoji_face_c",
    符: "emoji_face_c",
    情: "emoji_face_a",
    绘: "emoji_face_b",
    时: "clock",
    钟: "clock",
    数: "digit_8",
    龙: "dragon",
    云: "cloud",
    心: "heart",
    猫: "cat",
    鹤: "crane",
    星: "star",
    兔: "rabbit",
    狐: "fox",
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

  /** Unicode 表情拼盘字符串（标准码位，非外链图片） */
  const EMOJI_MOSAIC_A =
    "😀😃😄😁😆🥹😅😂🤣🙂😉😊😇🥰😍🤩😘😗☺️😚🤪😜🤔🤨😐😑😶😏😒🙄😬😌😔😪🤤😴🥱😵🤯🥳🥸😎🤓🧐😕😟🙁☹️😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱🤤🫠🫡🫥😶‍🌫️🫨";
  const EMOJI_MOSAIC_B =
    "👍👎👌✌️🤞🫰🤟🤘🫶🙌👏🙏💪🦾🖐️✋🤚👋🤝💅❤️🧡💛💚💙💜🖤🤍💔❤️‍🔥💯🔥✨⭐🌟💫⚡️☄️🎉🎊🎈🎁🏆🥇🎯📌📍🔔🔕💬💭🗯️♨️🎵🎶🔊🔇";

  function glyphUsesEmojiFont(str) {
    if (!str || !str.length) return false;
    const cp = str.codePointAt(0);
    return (
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x2300 && cp <= 0x23ff)
    );
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

    /** 云团：比软团更有体积层次 */
    cloud: {
      label: "云",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          const cx = s / 2;
          const cy = s / 2;
          for (let k = 0; k < 5; k++) {
            const ox = (Math.sin(k * 1.7) * 0.22 + (k - 2) * 0.08) * s;
            const oy = (Math.cos(k * 1.3) * 0.08) * s;
            ctx.beginPath();
            ctx.ellipse(cx + ox, cy + oy, s * (0.22 + k * 0.02), s * (0.14 + k * 0.015), k * 0.15, 0, TAU);
            ctx.fill();
          }
        }, S, n);
        const R = S * 0.28;
        return {
          targets,
          eyes: [
            { x: -R * 0.15, y: -R * 0.12 },
            { x: R * 0.15, y: -R * 0.12 },
          ],
          eyeSize: 1.35,
        };
      },
    },

    /** 鹤：剪影 + 颈弧线 */
    crane: {
      label: "鹤",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          const cx = s / 2;
          const cy = s / 2 + s * 0.06;
          // 身
          ctx.beginPath();
          ctx.ellipse(cx + s * 0.08, cy, s * 0.18, s * 0.1, -0.25, 0, TAU);
          ctx.fill();
          // 颈与头
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.02, cy - s * 0.02);
          ctx.quadraticCurveTo(cx - s * 0.06, cy - s * 0.28, cx - s * 0.02, cy - s * 0.42);
          ctx.quadraticCurveTo(cx + s * 0.04, cy - s * 0.38, cx + s * 0.02, cy - s * 0.22);
          ctx.quadraticCurveTo(cx + s * 0.02, cy - s * 0.08, cx + s * 0.06, cy);
          ctx.closePath();
          ctx.fill();
          // 翅
          ctx.beginPath();
          ctx.moveTo(cx + s * 0.02, cy - s * 0.04);
          ctx.quadraticCurveTo(cx + s * 0.32, cy - s * 0.18, cx + s * 0.28, cy + s * 0.06);
          ctx.lineTo(cx + s * 0.06, cy + s * 0.04);
          ctx.closePath();
          ctx.fill();
        }, S, n);
        const R = S * 0.22;
        return {
          targets,
          eyes: [
            { x: -R * 0.35, y: -R * 0.85 },
            { x: -R * 0.22, y: -R * 0.82 },
          ],
          eyeSize: 1.25,
        };
      },
    },

    /** 星芒：几何放射，偏装饰性 */
    star: {
      label: "星",
      build(n, S) {
        const outline = [];
        const rays = 5;
        for (let r = 0; r < rays; r++) {
          const a = (r / rays) * TAU - Math.PI / 2;
          for (let t = 0; t < 1; t += 0.06) {
            const br = t * S * 0.38;
            outline.push({ x: Math.cos(a) * br, y: Math.sin(a) * br });
          }
        }
        const targets = fillFromOutline(outline, n, S * 0.04);
        return {
          targets,
          eyes: [
            { x: -S * 0.02, y: -S * 0.06 },
            { x: S * 0.02, y: -S * 0.06 },
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

    /** 表情拼盘 A：圆脸 + 大眼 + 弧嘴（Unicode 表情粒子） */
    emoji_face_a: {
      label: "表情·圆",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(s / 2, s / 2 + s * 0.04, s * 0.34, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = "destination-out";
          ctx.beginPath();
          ctx.arc(s * 0.38, s * 0.46, s * 0.07, 0, TAU);
          ctx.arc(s * 0.62, s * 0.46, s * 0.07, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(s / 2, s * 0.62, s * 0.12, s * 0.05, 0, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }, S, n);
        return {
          targets,
          eyes: [
            { x: -S * 0.22, y: -S * 0.06 },
            { x: S * 0.22, y: -S * 0.06 },
          ],
          eyeSize: 1.15,
          emojiPalette: EMOJI_MOSAIC_A,
        };
      },
    },

    /** 表情拼盘 B：宽脸笑眼（Unicode 表情粒子） */
    emoji_face_b: {
      label: "表情·笑",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.ellipse(s / 2, s / 2 + s * 0.05, s * 0.38, s * 0.3, 0, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = "destination-out";
          ctx.beginPath();
          ctx.ellipse(s * 0.36, s * 0.46, s * 0.07, s * 0.05, -0.2, 0, TAU);
          ctx.ellipse(s * 0.64, s * 0.46, s * 0.07, s * 0.05, 0.2, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(s / 2, s * 0.62, s * 0.16, s * 0.08, 0, 0.2, Math.PI - 0.2);
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }, S, n);
        return {
          targets,
          eyes: [
            { x: -S * 0.2, y: -S * 0.02 },
            { x: S * 0.2, y: -S * 0.02 },
          ],
          eyeSize: 1.1,
          emojiPalette: EMOJI_MOSAIC_B,
        };
      },
    },

    /** 表情拼盘 C：手势与心形符号云 */
    emoji_face_c: {
      label: "表情·符号",
      build(n, S) {
        const targets = sampleSilhouette((ctx, s) => {
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(s / 2, s / 2, s * 0.35, 0, TAU);
          ctx.fill();
        }, S, n);
        return {
          targets,
          eyes: [
            { x: -S * 0.18, y: -S * 0.08 },
            { x: S * 0.18, y: -S * 0.08 },
          ],
          eyeSize: 1.1,
          emojiPalette: EMOJI_MOSAIC_B + EMOJI_MOSAIC_A,
        };
      },
    },
  };

  /** 5×7 点阵数字 → 局部坐标点列表 */
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

    label: "计时",
    build(n, S) {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const r1 = mergeDigitRows(digitPattern5x7(hh[0]), 1, digitPattern5x7(hh[1]));
      const rMid = mergeDigitRows(r1, 1, colonRows());
      const rows = mergeDigitRows(rMid, 1, mergeDigitRows(digitPattern5x7(mm[0]), 1, digitPattern5x7(mm[1])));
      const cell = S * 0.028;
      const targets = rowsToTargets(rows, cell, n, 0.08);
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
  };

  for (let di = 0; di <= 9; di++) {
    const ds = String(di);
    FORMS[`digit_${di}`] = {
      label: `数字·${ds}`,
      build(n, S) {
        const cell = S * 0.058;
        const rows = digitPattern5x7(ds);
        const targets = rowsToTargets(rows, cell, n, 0.1);
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

  const FORM_ORDER = [
    "blob",
    "cloud",
    "cat",
    "fox",
    "rabbit",
    "crane",
    "koi",
    "butterfly",
    "flower",
    "heart",
    "moon",
    "star",
    "emoji_face_a",
    "emoji_face_b",
    "emoji_face_c",
    "digit_8",
    "clock",
    "dragon",
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

      this.particleCount = opts.particleCount || 160;
      this.pool = (opts.pool || DEFAULT_POOL).slice();
      this.eatenChars = []; // 吞下的字，会混入 pool
      /** 多次「写入躯体」累积队列，轮换贴到更多粒子上 */
      this.bodyCharQueue = [];
      this.bodyCharQueueMax = opts.bodyCharQueueMax != null ? opts.bodyCharQueueMax : 96;
      /** 计时形态刷新间隔（秒） */
      this.clockRefreshSec = opts.clockRefreshSec != null ? opts.clockRefreshSec : 30;
      this._lastClockTick = 0;
      this._clockMinuteSlot = -1;

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
      this.fluidStrength = opts.fluidStrength != null ? opts.fluidStrength : 0.75;
      this._fluidPhase = 0;
      /** 沿格子纵横**各自**平滑走位（曼哈顿路径），队形变换感 */
      this.gridMarch = opts.gridMarch !== false;
      /** 沿格线移动速度（格/秒） */
      this.gridMarchSpeed = opts.gridMarchSpeed != null ? opts.gridMarchSpeed : 3.1;

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
      if (typeof ResizeObserver !== "undefined") {
        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(this.canvas);
      } else {
        this._ro = null;
      }

      this._initGlyphs();
      this.setForm("blob");

      this._lastTime = performance.now();
      this._raf = requestAnimationFrame(this._loop.bind(this));
      requestAnimationFrame(() => this._resize());
    }

    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      let w = rect.width || this.canvas.clientWidth || this.canvas.offsetWidth;
      let h = rect.height || this.canvas.clientHeight || this.canvas.offsetHeight;
      if (!w || !h) {
        const stage = this.canvas.parentElement;
        if (stage) {
          const sr = stage.getBoundingClientRect();
          w = w || sr.width || 320;
          h = h || sr.height || 320;
        }
        w = w || 320;
        h = h || 320;
      }
      w = Math.max(64, w);
      h = Math.max(64, h);
      this.width = w;
      this.height = h;
      this.canvas.width = w * this.DPR;
      this.canvas.height = h * this.DPR;
      this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
      this.center = { x: this.width / 2, y: this.height / 2 };
      // 身体参考尺寸：按短边
      this.size = Math.min(this.width, this.height) * 0.9;
      // 格距过小会导致 em 只有 3～4px，字「存在但看不见」
      this.gridCell = clamp(Math.round(this.size * 0.03), 8, 13);
      this.anchor = { x: this.center.x, y: this.center.y };
      if (this.pos.x === 0 && this.pos.y === 0) {
        this.pos.x = this.center.x;
        this.pos.y = this.center.y;
      }
      // 重建当前形态（尺寸变了）
      if (this.formData) {
        if (this.morphGlyphToTarget) this._cancelMorph(false);
        this.setForm(this.form, true);
      }
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
          /** 巡逻相位（每字不同） */
          patrolSeed: Math.random() * TAU,
          patrolAmpMul: 0.85 + Math.random() * 0.3,
        });
      }
    }

    setForm(name, silent, noEmitOnFormChange) {
      if (!FORMS[name]) return;
      if (this.morphGlyphToTarget) this._cancelMorph(false);
      this.form = name;
      this.formStartTime = performance.now();
      if (name === "clock") this._clockMinuteSlot = -1;
      const S = this.size;
      const data = FORMS[name].build(this.particleCount, S);
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
      if (this.faceLayerMode) this._assignFaceGlyphs();
      this._applyEmojiPaletteIfNeeded();
      if (!(this.formData && this.formData.emojiPalette)) {
        this._reapplyBodyFromQueue();
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
      if (typeof this.onFormChange === "function" && !noEmitOnFormChange) {
        try {
          this.onFormChange(this.form);
        } catch (_) {}
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
      const data = FORMS[name].build(this.particleCount, S);
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

      this._resolveUniqueLocalGridFor(list);

      return {
        key: name,
        data,
        targets: list.map((g) => ({
          gx: Math.round(g.tx / step),
          gy: Math.round(g.ty / step),
          edge: g.edge,
          faceRole: g.faceRole,
        })),
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

      for (let i = 0; i < this.glyphs.length && i < targets.length; i++) {
        const g = this.glyphs[i];
        const t = targets[i];
        g.tx = t.gx * step;
        g.ty = t.gy * step;
        g.baseTx = g.tx;
        g.baseTy = g.ty;
        g.edge = t.edge;
        g.faceRole = t.faceRole || null;
      }

      this.morphGlyphToTarget = null;
      this.morphToKey = null;
      this.morphFinalMeta = null;
      this.morphApplyQueue = null;
      this.morphApplyIdx = 0;
      this.morphStepAcc = 0;

      this._applyGridTypography();
      if (this.formData && this.formData.emojiPalette) {
        this._applyEmojiPaletteIfNeeded();
      }
      if (!(this.formData && this.formData.emojiPalette)) {
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
      const pal = this.formData && this.formData.emojiPalette;
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
        const alt = ["cloud", "star", "heart", "butterfly", "moon", "flower"];
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
      this.mode = "feeding";
      this._formBeforeFeed = this.form && FORMS[this.form] ? this.form : "blob";
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
        this.mode = "sleep";
        this.setExpression("sleep");
      } else {
        this.mode = "idle";
        this.setExpression("normal");
      }
    }

    shake() {
      if (this.mode === "feeding") this.abortFeeding();
      this._rumbleAmp = Math.min(0.55, (this._rumbleAmp || 0) + 0.45);
      this._glyphFlash = Math.min(0.55, (this._glyphFlash || 0) + 0.42);
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
      const pad = this.size * 0.42;
      const nx = clamp(x + this.dragOffset.x, pad, this.width - pad);
      const ny = clamp(y + this.dragOffset.y, pad, this.height - pad);
      this.pos.x = nx;
      this.pos.y = ny;
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
      if (!this.dragging) {
        const pad = this.size * 0.38;
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

      // 朝向：速度方向决定左右翻面 & 小角度倾斜
      if (Math.abs(this.vel.x) > 40) {
        this.facingFlip = this.vel.x > 0 ? 1 : -1;
      }
      this.targetRotation = clamp(this.vel.x * 0.0005, -0.2, 0.2);
      this.rotation = lerp(this.rotation, this.targetRotation, 0.1);
      this.scale = lerp(this.scale, this.targetScale * this.breath, 0.15);

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
      this._fluidPhase += dt * 0.95;

      if (this.gridMarch && this.gridSnapping) {
        const stepBudget = Math.max(1, Math.min(6, Math.round((this.gridMarchSpeed || 3) * dt * 14)));

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
          let wx = bx + (txl * cos - tyl * sin);
          let wy = by + (txl * sin + tyl * cos);

          if (this.internalMotion && !g.faceRole) {
            const pAmp =
              cell *
              0.13 *
              (this._patrolAmp || 1) *
              (g.patrolAmpMul || 1) *
              (this.dragging ? 1.45 : 1);
            const ph = g.patrolSeed || 0;
            wx +=
              Math.sin(t * 0.52 + ph * 2.1) * pAmp * 0.62 +
              Math.sin(t * 0.29 + ph * 5.4) * pAmp * 0.38;
            wy +=
              Math.cos(t * 0.47 + ph * 3.7) * pAmp * 0.58 +
              Math.cos(t * 0.33 + ph * 6.2) * pAmp * 0.35;
          }

          if (waveAmp > 0.001) {
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
          const mT = this.morphGlyphToTarget && this.morphGlyphToTarget[gi];
          if (mT) {
            tgx = mT.gx;
            tgy = mT.gy;
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
            if (g.mgx !== tt.gx || g.mgy !== tt.gy) {
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

        this._fluidPhase += dt * 1.05;

        for (const g of this.glyphs) {
          const txl = g.tx * flip;
          const tyl = g.ty;
          let wx = bx + (txl * cos - tyl * sin);
          let wy = by + (txl * sin + tyl * cos);
          if (this.gridSnapping && !g.faceRole) {
            wx = Math.round(wx / cell) * cell;
            wy = Math.round(wy / cell) * cell;
          }
          if (waveAmp2 > 0.001) {
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
            ax += Math.sin(t * 2 + g.depth * 6) * (this.gridSnapping ? 0.28 : 1.0);
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

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const flash = this._glyphFlash || 0;

      const drawGlyph = (g, opts) => {
        const edge = g.edge;
        const rx = this.gridUnity ? Math.round(g.x) : g.x;
        const ry = this.gridUnity ? Math.round(g.y) : g.y;
        const roleMul =
          g.faceRole === "brow"
            ? lerp(1.05, 0.78, edge)
            : g.faceRole
              ? lerp(1.12, 0.88, edge)
              : lerp(1.28, 0.72, edge);
        const baseSize = g.size * this.scale * (opts.sizeMul || 1);
        let size = baseSize * roleMul;
        if (this.gridUnity && this.gridCell) {
          const cap = this.gridCell * 0.88 * this.scale;
          if (size > cap) size = cap;
        }
        const ch0 = g.char && g.char.length ? g.char.codePointAt(0) : 0;
        const emojiLike = glyphUsesEmojiFont(g.char);
        if (emojiLike) {
          const capE = (this.gridCell || 10) * 0.92 * this.scale;
          if (size > capE) size = capE;
        }
        if (size < 7.5) size = 7.5;
        const flashW = opts.flashWeight != null ? opts.flashWeight : 0.5;
        const flashBoost = 1 + Math.min(flash, 0.52) * flashW * 0.42;
        const alpha =
          (opts.alphaMul != null ? opts.alphaMul : 1) *
          flashBoost *
          lerp(0.94, 0.42, edge) *
          g.alpha;
        const fontMain =
          '"LXGW WenKai","LXGW WenKai Screen","Noto Serif SC","Noto Sans SC",serif';
        ctx.font = emojiLike
          ? `${size.toFixed(1)}px ${this.emojiFontStack}, ${fontMain}`
          : `${size.toFixed(1)}px ${fontMain}`;
        if (opts.color) {
          const c = opts.color;
          if (c.startsWith("#") && (c.length === 7 || c.length === 9)) {
            const r = parseInt(c.slice(1, 3), 16);
            const gg = parseInt(c.slice(3, 5), 16);
            const b = parseInt(c.slice(5, 7), 16);
            ctx.fillStyle = `rgba(${r},${gg},${b},${alpha})`;
          } else {
            ctx.fillStyle = c;
          }
        } else {
          if (light) {
            const inkR = Math.round(lerp(28, 100, edge));
            const inkG = Math.round(lerp(28, 110, edge));
            const inkB = Math.round(lerp(34, 120, edge));
            ctx.fillStyle = `rgba(${inkR},${inkG},${inkB},${alpha})`;
          } else {
            const inkR = Math.round(lerp(240, 110, edge));
            const inkG = Math.round(lerp(248, 160, edge));
            const inkB = Math.round(lerp(255, 210, edge));
            ctx.fillStyle = `rgba(${inkR},${inkG},${inkB},${alpha})`;
          }
        }
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(g.rot);
        if (opts.shadow) {
          ctx.shadowColor = opts.shadow;
          ctx.shadowBlur = opts.shadowBlur || 6;
        }
        ctx.fillText(g.char, 0, 0);
        ctx.restore();
      };

      // 主躯体字（单层绘制，减轻卡顿）
      for (const g of this.glyphs) {
        if (g.faceRole) continue;
        drawGlyph(g, { flashWeight: 0.55 });
      }

      // 朱砂点缀（略偏电粉，仍克制）
      if (this.glyphs.length > 0) {
        const sorted = this._cinnabarIdx || this._pickCinnabar();
        for (let k = 0; k < sorted.length; k++) {
          const g = this.glyphs[sorted[k]];
          if (!g || g.faceRole) continue;
          drawGlyph(g, {
            sizeMul: 1.12,
            color: light
              ? `rgba(0, 122, 255, ${0.55 * g.alpha})`
              : `rgba(255, 160, 190, ${0.72 * g.alpha})`,
            shadow: light ? "rgba(0, 122, 255, 0.2)" : "rgba(255, 120, 180, 0.35)",
            shadowBlur: 8,
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
  };
})();
