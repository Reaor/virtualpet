/**
 * 字灵活动区边界：画布内碰撞夹紧 + 速度反弹（供 pet.js 调用）。
 * 加载顺序：本文件须在 pet.js 之前。
 */
(function (global) {
  "use strict";

  function inset(w, h) {
    return Math.max(1, Math.min(w, h) * 0.006);
  }

  /**
   * 将 pos 限制在轴对齐框内，使距边至少 r；若越界则按 restitution 反弹 vel 分量。
   * @returns {{ nx: number, ny: number } | null} 法线大致方向（用于撞边特效）
   */
  function resolve(pos, vel, bounds, r, restitution) {
    let nx = 0;
    let ny = 0;
    let hit = false;
    const rest = restitution == null ? 0.38 : restitution;

    if (pos.x < bounds.minX + r) {
      pos.x = bounds.minX + r;
      if (vel.x < 0) {
        vel.x *= -rest;
        nx = 1;
        hit = true;
      }
    } else if (pos.x > bounds.maxX - r) {
      pos.x = bounds.maxX - r;
      if (vel.x > 0) {
        vel.x *= -rest;
        nx = -1;
        hit = true;
      }
    }

    if (pos.y < bounds.minY + r) {
      pos.y = bounds.minY + r;
      if (vel.y < 0) {
        vel.y *= -rest;
        ny = 1;
        hit = true;
      }
    } else if (pos.y > bounds.maxY - r) {
      pos.y = bounds.maxY - r;
      if (vel.y > 0) {
        vel.y *= -rest;
        ny = -1;
        hit = true;
      }
    }

    return hit ? { nx, ny } : null;
  }

  global.ZiLingPlayBounds = {
    inset,
    resolve,
  };
})(typeof window !== "undefined" ? window : globalThis);
