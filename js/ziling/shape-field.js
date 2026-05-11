/**
 * 形场（Shape Field）— 与 PLAN.md / DESIGN.md 对齐的离散栅格抽象。
 * 从「局部坐标下的目标点」生成可走格集合，并标出拓扑壳层（邻接空格的格）。
 * 供 Pet 辨形优先：壳层纹理动效压低；将来 AI 矩阵 Consumer 可替换/合并 walk 集合。
 *
 * 参考思路：栅格化轮廓 + 4-邻域边界（类似形态学中的外边界像素）。
 */
(function (global) {
  "use strict";

  function cellKey(gx, gy) {
    return gx + "," + gy;
  }

  /**
   * @param {Array<{x:number,y:number}>} points 局部坐标（与 Pet 的 tx,ty 一致）
   * @param {number} cell 格距
   * @returns {Set<string>} 被至少一个目标占用的逻辑格键 "gx,gy"
   */
  function buildWalkSetFromLocalPoints(points, cell) {
    const walk = new Set();
    if (!points || !cell || cell <= 0) return walk;
    for (const p of points) {
      const gx = Math.round(p.x / cell);
      const gy = Math.round(p.y / cell);
      walk.add(cellKey(gx, gy));
    }
    return walk;
  }

  /**
   * 壳层：可走格且 4-邻域中至少一格非可走（拓扑外轮廓）
   * @param {Set<string>} walk
   * @returns {Set<string>}
   */
  function shellCellsFromWalkSet(walk) {
    const shell = new Set();
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const k of walk) {
      const parts = k.split(",");
      const gx = +parts[0];
      const gy = +parts[1];
      let boundary = false;
      for (let d = 0; d < dirs.length; d++) {
        if (!walk.has(cellKey(gx + dirs[d][0], gy + dirs[d][1]))) {
          boundary = true;
          break;
        }
      }
      if (boundary) shell.add(k);
    }
    return shell;
  }

  /**
   * @param {number} gx
   * @param {number} gy
   * @param {Set<string>} shell
   * @param {Set<string>} walk
   * @returns {'shell'|'core'|null}
   */
  function bandAtGrid(gx, gy, shell, walk) {
    const k = cellKey(gx, gy);
    if (!walk.has(k)) return null;
    return shell.has(k) ? "shell" : "core";
  }

  /**
   * 调试：可走格包围盒与稀疏采样
   */
  function summarizeWalkSet(walk, shell, maxSample) {
    let minGx = Infinity;
    let maxGx = -Infinity;
    let minGy = Infinity;
    let maxGy = -Infinity;
    for (const k of walk) {
      const [a, b] = k.split(",").map(Number);
      if (a < minGx) minGx = a;
      if (a > maxGx) maxGx = a;
      if (b < minGy) minGy = b;
      if (b > maxGy) maxGy = b;
    }
    const sample = [];
    let i = 0;
    const lim = maxSample == null ? 24 : maxSample;
    for (const k of walk) {
      sample.push(k);
      if (++i >= lim) break;
    }
    return {
      walkCount: walk.size,
      shellCount: shell ? shell.size : 0,
      bounds:
        walk.size === 0
          ? null
          : { minGx, maxGx, minGy, maxGy, width: maxGx - minGx + 1, height: maxGy - minGy + 1 },
      sampleWalk: sample,
    };
  }

  global.ZiLingShapeField = {
    cellKey,
    buildWalkSetFromLocalPoints,
    shellCellsFromWalkSet,
    bandAtGrid,
    summarizeWalkSet,
  };
})(typeof window !== "undefined" ? window : globalThis);
