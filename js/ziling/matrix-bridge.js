/**
 * 矩阵桥接（Matrix Bridge）— PLAN.md M4：外部 AI 矩阵接入前的占位与工具。
 * 不发起网络请求；提供与时间滤波、二值栅格混合相关的纯函数，便于单元测试与后续接 API。
 *
 * 参考常见管线：时序低通（类似 IIR / 指数平滑）、二值场融合（与 OpenCV addWeighted
 * 思路同向，此处为零依赖极简实现）。
 */
(function (global) {
  "use strict";

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /**
   * 同形状二值栅格（0/1）向 `next` 插值一步。alpha=1 完全采用 next。
   * @param {Uint8Array} prev
   * @param {Uint8Array} next
   * @param {number} alpha 0..1
   * @param {Uint8Array} [out]
   */
  function blendBinaryGrids(prev, next, alpha, out) {
    const n = prev && next && prev.length === next.length ? prev.length : 0;
    if (!n) return new Uint8Array(0);
    const a = clamp(alpha, 0, 1);
    const dst = out && out.length === n ? out : new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = (1 - a) * prev[i] + a * next[i];
      dst[i] = v >= 0.5 ? 1 : 0;
    }
    return dst;
  }

  /**
   * 指数平滑持有：held = (1-a)*held + a*target（逐格，二值化）
   * 用于抑制 API 矩阵帧间抖动（PLAN 风险表）。
   */
  function exponentialHold(held, target, alpha, out) {
    const n = held && target && held.length === target.length ? held.length : 0;
    if (!n) return new Uint8Array(0);
    const a = clamp(alpha, 0, 1);
    const dst = out && out.length === n ? out : new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = (1 - a) * held[i] + a * target[i];
      dst[i] = v >= 0.5 ? 1 : 0;
    }
    return dst;
  }

  /**
   * 置信度门限占位：若 channels 为 { walk: Uint8Array, conf: Float32Array } 则返回 walk & (conf>=t)
   * @returns {Uint8Array|null}
   */
  function applyConfidenceThreshold(channels, threshold) {
    if (!channels || !channels.walk) return null;
    const w = channels.walk;
    const c = channels.conf;
    if (!c || c.length !== w.length) return w;
    const t = threshold == null ? 0.35 : threshold;
    const out = new Uint8Array(w.length);
    for (let i = 0; i < w.length; i++) {
      out[i] = w[i] && c[i] >= t ? 1 : 0;
    }
    return out;
  }

  /**
   * 最近邻重采样二值 packed（行主序），用于外部矩阵与本地 `packWalkGrid` 尺寸对齐。
   * @param {Uint8Array} src
   * @param {number} sw
   * @param {number} sh
   * @param {number} dw
   * @param {number} dh
   */
  function resampleBinaryPacked(src, sw, sh, dw, dh) {
    if (!src || sw < 1 || sh < 1 || dw < 1 || dh < 1) {
      return { packed: new Uint8Array(0), width: 0, height: 0 };
    }
    if (src.length !== sw * sh) {
      return { packed: new Uint8Array(0), width: 0, height: 0 };
    }
    const dst = new Uint8Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
        dst[y * dw + x] = src[sy * sw + sx] ? 1 : 0;
      }
    }
    return { packed: dst, width: dw, height: dh };
  }

  global.ZiLingMatrixBridge = {
    blendBinaryGrids,
    exponentialHold,
    applyConfidenceThreshold,
    resampleBinaryPacked,
  };
})(typeof window !== "undefined" ? window : globalThis);
