/**
 * 形场 Consumer（状态层）— 接 PLAN「Producer / Consumer」：吸收外部二值 walk 密铺，
 * 用 MatrixBridge 做时间平滑，可选重采样到与本地 `packWalkGrid` 相同宽高。
 * 不修改 Pet 内部 mask；供 `Pet.ingestExternalWalkPacked` 与调试/未来 API 使用。
 */
(function (global) {
  "use strict";

  function createShapeFieldConsumer() {
    let held = null;
    let w = 0;
    let h = 0;

    function snapshot() {
      const SF = global.ZiLingShapeField;
      const hash = SF && held ? SF.hashPackedGrid(held) : 0;
      return held && w && h
        ? { packed: held, width: w, height: h, hash }
        : null;
    }

    return {
      /**
       * @param {{ packed: Uint8Array, width: number, height: number }} obs
       * @param {number} [smoothAlpha] 指数持有强度 0..1，越大越跟新帧
       * @param {{ width: number, height: number } | null} targetDims 与本地形场密铺一致时先重采样
       */
      pushObservation(obs, smoothAlpha, targetDims) {
        const MB = global.ZiLingMatrixBridge;
        const SF = global.ZiLingShapeField;
        if (!MB || !SF || !obs || !obs.packed) return null;
        let p = obs.packed;
        let pw = obs.width | 0;
        let ph = obs.height | 0;
        if (pw < 1 || ph < 1 || p.length !== pw * ph) return null;

        if (
          targetDims &&
          targetDims.width > 0 &&
          targetDims.height > 0 &&
          (targetDims.width !== pw || targetDims.height !== ph)
        ) {
          const r = MB.resampleBinaryPacked(
            p,
            pw,
            ph,
            targetDims.width,
            targetDims.height
          );
          p = r.packed;
          pw = r.width;
          ph = r.height;
        }

        const n = pw * ph;
        const a = smoothAlpha == null ? 0.26 : Math.max(0, Math.min(1, +smoothAlpha));

        if (!held || held.length !== n) {
          held = new Uint8Array(p);
          w = pw;
          h = ph;
          return snapshot();
        }
        held = MB.exponentialHold(held, p, a, held);
        return snapshot();
      },

      reset() {
        held = null;
        w = 0;
        h = 0;
      },

      getSnapshot() {
        return snapshot();
      },
    };
  }

  global.ZiLingShapeFieldConsumer = {
    create: createShapeFieldConsumer,
  };
})(typeof window !== "undefined" ? window : globalThis);
