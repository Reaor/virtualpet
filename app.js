/**
 * 应用层：把字灵接入页面 —— 交互、觅食、UI 喂食
 */
(function () {
  "use strict";
  const {
    Pet,
    FORMS,
    getFormOrderForUiArcMode,
    STANDBY_MATH_ORDER,
    BODY_MOTION_LABELS,
    BODY_MOTION_STYLES,
    TEXTURE_MOTION_LABELS,
  } = window.ZiLing;

  // ---------- 初始化 ----------
  const canvas = document.getElementById("petCanvas");
  const stage = document.getElementById("stage");
  const stageMain = document.getElementById("stageMain");
  const formLabel = document.getElementById("formLabel");
  const hint = document.getElementById("hint");
  const toastEl = document.getElementById("toast");
  const pouchCount = document.getElementById("pouchCount");
  const bodyImport = document.getElementById("bodyImport");
  const bodyImportBtn = document.getElementById("bodyImportBtn");
  const buildStamp = document.getElementById("buildStamp");
  const buildMeta = document.querySelector('meta[name="ziling-build"]');
  if (buildStamp && buildMeta && buildMeta.content) {
    buildStamp.textContent = "build " + buildMeta.content;
  }

  const openingPanel = document.getElementById("openingPanel");
  const openingPreset = document.getElementById("openingPreset");
  const btnPresentScript = document.getElementById("btnPresentScript");
  const btnAwakenPet = document.getElementById("btnAwakenPet");
  const btnBackIntro = document.getElementById("btnBackIntro");
  const btnRevertScript = document.getElementById("btnRevertScript");

  const params = new URL(location.href).searchParams;
  const devHud = params.get("dev") === "1";
  const skipIntro = params.get("skipIntro") === "1" || params.get("pet") === "1";
  const urlForm = params.get("form");
  const urlMacroStr = (params.get("macroText") || params.get("mega") || "").trim();
  const scriptLinesFromUi = openingPreset
    ? openingPreset.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : [];

  const urlUiArcRaw = params.get("uiArc");
  const urlUiArc =
    urlUiArcRaw === "presentation"
      ? "presentation"
      : urlUiArcRaw === "standby"
        ? "standby"
        : undefined;

  const urlMotion = (params.get("motionStyle") || params.get("bodyMotion") || "").trim();
  const urlSnakePath = (params.get("snakePath") || "").trim();
  const bodyMotionFromUrl =
    urlMotion && BODY_MOTION_STYLES.includes(urlMotion) ? urlMotion : undefined;
  const snakePathFromUrl =
    urlSnakePath === "zigzag" || urlSnakePath === "spiral"
      ? urlSnakePath
      : undefined;
  const urlGlyphsJit =
    params.get("glyphsJitter") === "1" ||
    params.get("silhouetteJitter") === "1";
  const urlTexMot = (params.get("textureMotion") || params.get("motion") || "").trim();
  const textureMotionFromUrl =
    urlTexMot === "swap" || urlTexMot === "adjacent_swap"
      ? "adjacent_swap"
      : urlTexMot === "flow" || urlTexMot === "spring_flow"
        ? "spring_flow"
        : undefined;

  function syncRailUiArcClass(p) {
    const appRoot = document.querySelector(".app");
    if (!appRoot || !p) return;
    appRoot.dataset.uiArc =
      p.uiArcMode === "presentation" ? "presentation" : "standby";
  }

  const pet = new Pet(canvas, {
    particleCount: 220,
    initialViewMode: skipIntro ? "pet" : "intro",
    initialForm: urlForm && FORMS[urlForm] ? urlForm : undefined,
    uiArcMode: urlUiArc,
    scriptLines: scriptLinesFromUi.length ? scriptLinesFromUi : undefined,
    macroText: urlMacroStr ? urlMacroStr.slice(0, 48) : undefined,
    bodyMotionStyle: bodyMotionFromUrl,
    snakePathVariant: snakePathFromUrl,
    silhouetteGlyphJitter: urlGlyphsJit ? true : undefined,
    textureMotionMode: textureMotionFromUrl,
    showPlayfieldGuide: devHud,
    onFormChange(key) {
      if (FORMS[key] && formLabel) formLabel.textContent = FORMS[key].label;
      syncUiMode();
    },
    onUiArcModeChange() {
      syncRailUiArcClass(pet);
    },
  });
  window._pet = pet;
  syncRailUiArcClass(pet);
  if (params.get("shapeDebug") === "1") {
    window._shapeDump = () => pet.dumpShapeField();
    window._ingestDemoWalk = () => {
      const w = 8;
      const h = 8;
      const u8 = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ring = x === 0 || x === w - 1 || y === 0 || y === h - 1;
          u8[y * w + x] = ring ? 1 : 0;
        }
      }
      const ok = pet.ingestExternalWalkPacked(u8, w, h, 0.4);
      const d = pet.dumpShapeField();
      console.info("[ZiLing] _ingestDemoWalk ok=", ok, d);
      return d;
    };
    console.info(
      "[ZiLing] shapeDebug=1 → _shapeDump() 、 _ingestDemoWalk()（外部 walk Consumer）"
    );
  }

  function syncUiMode() {
    if (!openingPanel || !formLabel) return;
    const vm = pet.viewMode;
    if (vm === "intro") {
      formLabel.textContent = "空白";
      openingPanel.classList.remove("docked");
    } else if (vm === "script") {
      formLabel.textContent = "文稿";
      openingPanel.classList.remove("docked");
    } else {
      formLabel.textContent = FORMS[pet.form] ? FORMS[pet.form].label : "";
      openingPanel.classList.add("docked");
    }
  }

  function circledIndex(i) {
    if (i >= 0 && i < 20) return String.fromCharCode(0x2460 + i);
    return String(i + 1);
  }

  function buildStandbyRailButtons() {
    const host = document.getElementById("railStandbyBtns");
    if (!host || !STANDBY_MATH_ORDER) return;
    host.textContent = "";
    STANDBY_MATH_ORDER.forEach((key, idx) => {
      const f = FORMS[key];
      if (!f) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rail-form compact";
      b.dataset.form = key;
      b.title = `${f.label} · ${key}`;
      b.textContent = circledIndex(idx);
      host.appendChild(b);
    });
  }

  buildStandbyRailButtons();
  syncUiMode();

  const glyphShapeInput = document.getElementById("glyphShapeInput");
  const glyphShapeBtn = document.getElementById("glyphShapeBtn");
  if (glyphShapeInput && pet.macroText) {
    glyphShapeInput.value = pet.macroText;
  }

  function applyGlyphShapeFromInput() {
    if (!glyphShapeInput) return;
    const v = glyphShapeInput.value.trim();
    if (!v) {
      toast("请先输入化身字形（大字、数字或短语）");
      return;
    }
    pet.macroText = v.slice(0, 48);
    if (pet.viewMode === "intro") {
      toast("先点「呈」或「灵」进入画布后再试");
      return;
    }
    pet.setUiArcMode("presentation", true);
    syncRailUiArcClass(pet);
    if (pet.viewMode === "script") {
      pet.awakenPet("mega", false);
    } else {
      pet.setForm("mega");
    }
    syncUiMode();
    toast("已切换巨字形态");
  }
  if (glyphShapeBtn) {
    glyphShapeBtn.addEventListener("click", applyGlyphShapeFromInput);
  }
  if (glyphShapeInput) {
    glyphShapeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyGlyphShapeFromInput();
      }
    });
  }

  document.title =
    "字灵 · " +
    (skipIntro ? urlForm || "blob" : "开场");

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
  }
  function arcLayerZh() {
    return pet.uiArcMode === "presentation" ? "呈现层" : "待机层";
  }

  function parseOpeningLines() {
    if (!openingPreset) return [];
    return openingPreset.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }

  let scheduleInputTimer = null;
  function applyLinesToPetFromInput() {
    const lines = parseOpeningLines();
    pet.setScriptLines(lines);
    if (pet.viewMode !== "pet") return;
    if (scheduleInputTimer) clearTimeout(scheduleInputTimer);
    scheduleInputTimer = setTimeout(() => {
      scheduleInputTimer = null;
      const L = parseOpeningLines();
      pet.setScriptLines(L);
      const r = pet.tryConsumeCompletedScriptLines(L);
      if (r.ate > 0) {
        toast(
          r.todoTouch > 0
            ? `已吞食 ${r.ate} 条已完成（待办未贴躯体）`
            : `已吞食 ${r.ate} 条已完成`
        );
      }
    }, 420);
  }
  if (openingPreset) {
    openingPreset.addEventListener("input", applyLinesToPetFromInput);
    openingPreset.addEventListener("change", applyLinesToPetFromInput);
    openingPreset.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const lines = parseOpeningLines();
      if (!lines.length) {
        toast("请先输入至少一行");
        return;
      }
      pet.setScriptLines(lines);
      pet.awakenPet(urlForm && FORMS[urlForm] ? urlForm : null, false);
      pet.tryConsumeCompletedScriptLines(parseOpeningLines());
      syncUiMode();
      toast("化为字灵");
    });
  }

  if (btnPresentScript) {
    btnPresentScript.addEventListener("click", () => {
      const lines = parseOpeningLines();
      pet.setScriptLines(lines);
      pet.enterScriptMode(lines, false);
      syncUiMode();
      toast(lines.length ? "已呈现文稿 · 可点「化为字灵」" : "请先输入文稿");
    });
  }
  if (btnAwakenPet) {
    btnAwakenPet.addEventListener("click", () => {
      const lines = parseOpeningLines();
      if (lines.length) pet.setScriptLines(lines);
      pet.awakenPet(urlForm && FORMS[urlForm] ? urlForm : null, false);
      pet.tryConsumeCompletedScriptLines(parseOpeningLines());
      syncUiMode();
      toast("化为字灵");
    });
  }
  if (btnBackIntro) {
    btnBackIntro.addEventListener("click", () => {
      pet.enterIntroMode(false);
      syncUiMode();
      toast("已回空白");
    });
  }
  if (btnRevertScript) {
    btnRevertScript.addEventListener("click", () => {
      if (pet.viewMode !== "pet") {
        toast("请先化为字灵");
        return;
      }
      pet.revertToScript(false);
      syncUiMode();
      toast("已回到文稿");
    });
  }

  function setForm(key, announce = true) {
    if (pet.viewMode !== "pet") pet.awakenPet(null, true);
    pet.setForm(key);
    formLabel.textContent = FORMS[key].label;
    syncUiMode();
    if (announce) toast("换形 · " + FORMS[key].label);
  }

  function morphToForm(key, announce = true) {
    if (!FORMS[key]) return;
    if (pet.viewMode !== "pet") pet.awakenPet(null, true);
    if (pet.gridMarch && pet.gridSnapping && pet.startMorphTo(key)) {
      formLabel.textContent = FORMS[key].label;
      syncUiMode();
      if (announce) toast("换形中 · " + FORMS[key].label);
      return;
    }
    setForm(key, announce);
  }

  // ---------- 触摸/鼠标交互 ----------
  function getPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const p = evt.touches ? evt.touches[0] : evt;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }

  let downTime = 0;
  let downPos = null;
  let moved = false;
  let lastTap = 0;
  let tapChainCount = 0;
  /** inner pet | mid nuis | far */
  let downZone = "";
  let dragPhase = "none";
  let longPressTimer = null;
  /** 长按蓄满后松手才回文稿（避免与拖动同时触发） */
  let revertArmOnRelease = false;
  /** 是否已超过拖动阈值：超过则取消「松手回稿」意图 */
  let exceededDragThreshold = false;
  const LONG_PRESS_MS = 580;
  const DRAG_THRESHOLD = 8;

  function clearLongPressTimer() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function zoneAt(canvasPos) {
    const innerR =
      pet.pointerInnerRadius && typeof pet.pointerInnerRadius === "function"
        ? pet.pointerInnerRadius()
        : pet.size * 0.32;
    const d = Math.hypot(canvasPos.x - pet.pos.x, canvasPos.y - pet.pos.y);
    if (d < innerR) return "inner";
    if (d < innerR * 1.52) return "mid";
    return "far";
  }

  function onDown(e) {
    if (e.cancelable) e.preventDefault();
    const p = getPos(e);
    downTime = performance.now();
    downPos = p;
    moved = false;
    downZone = zoneAt(p);
    dragPhase = "none";
    revertArmOnRelease = false;
    exceededDragThreshold = false;
    clearLongPressTimer();

    if (pet.viewMode === "pet" && downZone === "inner") {
      dragPhase = "pending";
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (
          !exceededDragThreshold &&
          pet.viewMode === "pet" &&
          downZone === "inner" &&
          pet.scriptLines &&
          pet.scriptLines.length
        ) {
          revertArmOnRelease = true;
          toast("松手还原文稿");
        }
      }, LONG_PRESS_MS);
    } else if (downZone === "mid") {
      pet.nuisTap();
      pet.pulse(p.x, p.y);
    } else {
      pet.pulse(p.x, p.y);
    }
    hideHint();
  }

  function onMove(e) {
    if (!downPos) return;
    if (e.cancelable) e.preventDefault();
    const p = getPos(e);
    const dist = Math.hypot(p.x - downPos.x, p.y - downPos.y);
    if (dist > 4) moved = true;
    if (dist > DRAG_THRESHOLD) {
      exceededDragThreshold = true;
      if (revertArmOnRelease) revertArmOnRelease = false;
    }

    if (
      dragPhase === "pending" &&
      pet.viewMode === "pet" &&
      dist > DRAG_THRESHOLD
    ) {
      pet.beginDrag(downPos.x, downPos.y);
      if (pet.dragging) {
        revertArmOnRelease = false;
        dragPhase = "dragging";
        clearLongPressTimer();
        pet.dragTo(p.x, p.y);
      }
      return;
    }
    if (pet.dragging) pet.dragTo(p.x, p.y);
  }

  function onUp(e) {
    if (e && e.cancelable) e.preventDefault();
    const now = performance.now();
    const dt = now - downTime;
    clearLongPressTimer();

    if (
      revertArmOnRelease &&
      !exceededDragThreshold &&
      !pet.dragging &&
      dragPhase !== "dragging" &&
      pet.viewMode === "pet" &&
      pet.scriptLines &&
      pet.scriptLines.length
    ) {
      pet.revertToScript(false);
      toast("已回到文稿");
      revertArmOnRelease = false;
      downPos = null;
      moved = false;
      dragPhase = "none";
      downZone = "";
      tapChainCount = 0;
      exceededDragThreshold = false;
      return;
    }
    revertArmOnRelease = false;

    if (pet.dragging) pet.endDrag();

    if (moved || dragPhase === "dragging") tapChainCount = 0;

    if (dragPhase === "pending" && !moved && dt < 280 && downZone === "inner") {
      pet.pulse(pet.pos.x, pet.pos.y);
    }

    if (!moved && dt < 260 && dragPhase !== "dragging") {
      let chain = 1;
      if (now - lastTap < 340) tapChainCount += 1;
      else tapChainCount = 1;
      chain = tapChainCount;
      lastTap = now;
      pet.tapInteractionBurst(chain);
      if (chain >= 3) {
        triggerFeeding();
        tapChainCount = 0;
      }
    } else if (!moved && dt >= 260) {
      tapChainCount = 0;
    }

    downPos = null;
    moved = false;
    dragPhase = "none";
    downZone = "";
    exceededDragThreshold = false;
  }

  function onCancel(e) {
    clearLongPressTimer();
    revertArmOnRelease = false;
    exceededDragThreshold = false;
    if (pet.dragging) pet.endDrag();
    downPos = null;
    moved = false;
    dragPhase = "none";
    downZone = "";
  }

  const petHost = stageMain || stage;
  if (petHost) {
    petHost.addEventListener("touchstart", onDown, { passive: false });
    petHost.addEventListener("touchmove", onMove, { passive: false });
    petHost.addEventListener("touchend", onUp, { passive: false });
    petHost.addEventListener("touchcancel", onCancel, { passive: false });
    petHost.addEventListener("mousedown", onDown);
    petHost.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey) return;
        e.preventDefault();
        window.scrollBy({ top: e.deltaY, left: 0, behavior: "auto" });
      },
      { passive: false }
    );
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("blur", onCancel);

  // ---------- 隐藏提示 ----------
  let hintHidden = false;
  function hideHint() {
    if (hintHidden) return;
    hintHidden = true;
    hint.classList.add("hidden");
  }
  setTimeout(hideHint, 6000);

  const railGroups = document.getElementById("railGroups");
  if (railGroups) {
    railGroups.addEventListener("click", (e) => {
      const btn = e.target.closest(".rail-form");
      if (!btn || !railGroups.contains(btn)) return;
      const key = btn.dataset.form;
      if (!key || !FORMS[key]) return;
      morphToForm(key);
    });
  }

  const tintPopover = document.getElementById("tintPopover");
  const tintPopoverClose = document.getElementById("tintPopoverClose");
  const tintSwatches = document.getElementById("tintSwatches");
  const tintColorPicker = document.getElementById("tintColorPicker");

  function closeTintPopover() {
    if (tintPopover) tintPopover.hidden = true;
  }

  if (tintPopoverClose) tintPopoverClose.addEventListener("click", closeTintPopover);

  if (tintSwatches) {
    tintSwatches.addEventListener("click", (e) => {
      const sw = e.target.closest("[data-tint]");
      if (!sw) return;
      const v = sw.getAttribute("data-tint");
      pet.setBodyTint(v || "");
      if (tintColorPicker && v) tintColorPicker.value = v;
      toast((v ? `字色：${v}` : "字色：默认") + `（${arcLayerZh()}）`);
      closeTintPopover();
    });
  }

  if (tintColorPicker) {
    tintColorPicker.addEventListener("change", () => {
      const v = tintColorPicker.value;
      pet.setBodyTint(v);
      toast(`字色：${v}（${arcLayerZh()}）`);
    });
  }

  document.addEventListener("click", (e) => {
    if (!tintPopover || tintPopover.hidden) return;
    const t = e.target;
    if (t.closest("#tintPopover") || t.closest('[data-action="tint"]')) return;
    closeTintPopover();
  });

  // ---------- 侧栏：互动 + 快捷形态 ----------
  document.querySelectorAll(".rail-tool").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      const action = btn.dataset.action;
      if (action === "tint") {
        ev.stopPropagation();
        const pop = document.getElementById("tintPopover");
        if (pop) pop.hidden = !pop.hidden;
        return;
      }
      if (action === "arcMode") {
        pet.cycleUiArcMode();
        const lab = pet.uiArcMode === "presentation" ? "呈现" : "待机";
        toast(
          `层级 · ${lab}（色/速/轨/颤/紊/廓/墨/浮/波/徙/粒 分套保留）`
        );
      } else if (action === "morph") {
        pet.abortFeeding();
        const order = getFormOrderForUiArcMode(pet.uiArcMode);
        const cur = pet.form;
        const idx = order.indexOf(cur);
        const nextIdx = ((idx >= 0 ? idx : 0) + 1) % order.length;
        const key = order[nextIdx];
        morphToForm(key);
      } else if (action === "feed") {
        triggerFeeding();
      } else if (action === "ink") {
        pet.cycleBodyColorMode();
        const labels = [
          "默认（边缘浓淡 + 轻呼吸）",
          "纵向渐变 + 强呼吸",
          "径向渐变 + 强呼吸",
          "纵向渐变 + 慢呼吸",
        ];
        toast(`墨色：${labels[pet.bodyColorMode | 0]}（${arcLayerZh()}）`);
      } else if (action === "glow") {
        pet.cycleGlowMode();
        const gl = [
          "浮光：关",
          "呼吸",
          "纵波",
          "径向脉动",
          "星闪",
          "心跳",
        ];
        toast((gl[pet.glowMode | 0] || "浮光") + `（${arcLayerZh()}）`);
      } else if (action === "speed") {
        const v = pet.cycleGlyphMotionSpeed();
        toast(
          `运动 ×${v.toFixed(2)}（${arcLayerZh()}；节拍 / 格移 / 谐波亚格见「颤」）`
        );
      } else if (action === "motionStyle") {
        const k = pet.cycleBodyMotionStyle();
        const lab =
          (BODY_MOTION_LABELS && BODY_MOTION_LABELS[k]) || k;
        toast(`运动轨：${lab}（${arcLayerZh()}；巨字/颜文字 mask 内）`);
      } else if (action === "glyphsJitter") {
        const on = pet.cycleSilhouetteGlyphJitter();
        toast(
          on
            ? `亚格颤抖：开（${arcLayerZh()}；谐波轨下为亚格位移+微振）`
            : `亚格颤抖：关（${arcLayerZh()}；谐波轨下=严格格点）`
        );
      } else if (action === "textureMotion") {
        const k = pet.cycleTextureMotionMode();
        const lab = (TEXTURE_MOTION_LABELS && TEXTURE_MOTION_LABELS[k]) || k;
        toast(`纹理体动 · ${lab}`);
      } else if (action === "silhouetteMatteUnderlay") {
        const on = pet.cycleSilhouetteMatteUnderlay();
        toast(
          on
            ? `剪影垫底：开（${arcLayerZh()}；巨字/颜 mask 下半透明静态轮廓）`
            : `剪影垫底：关（${arcLayerZh()}）`
        );
      } else if (action === "fluid") {
        const v = pet.cycleArcFluidStrength();
        toast(`波纹强度 ×${v.toFixed(2)}（${arcLayerZh()}）`);
      } else if (action === "gridMarch") {
        const v = pet.cycleArcGridMarchSpeed();
        toast(`格移速度 ×${v.toFixed(2)}（${arcLayerZh()}）`);
      } else if (action === "megaPack") {
        const m = pet.cycleArcMegaParticleMul();
        toast(`巨字粒数 ×${m.toFixed(2)}（${arcLayerZh()}；已巨字则重建）`);
      } else if (action === "sleep") {
        if (pet.mode === "sleep") {
          pet.sleep(false);
          toast("已醒");
        } else {
          pet.sleep(true);
          toast("小憩");
        }
      } else if (action === "shake") {
        pet.shake();
        toast("抖擞精神");
      }
    });
  });

  // ---------- 把下面诗笺里的每个字拆成 span ----------
  const feedableNodes = [];
  document.querySelectorAll("[data-feedable]").forEach((card) => {
    splitTextInto(card);
  });

  function splitTextInto(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // 跳过仅空白节点
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      const text = node.nodeValue;
      for (const ch of Array.from(text)) {
        if (ch === " " || ch === "\t" || ch === "\n") {
          frag.appendChild(document.createTextNode(ch));
        } else {
          const span = document.createElement("span");
          span.className = "glyph";
          span.textContent = ch;
          span.dataset.orig = ch;
          frag.appendChild(span);
          feedableNodes.push(span);
        }
      }
      node.parentNode.replaceChild(frag, node);
    }
  }

  // ---------- 单字点击 → 飞入字灵 ----------
  document.body.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains("glyph") && !t.classList.contains("eaten")) {
      eatGlyphElement(t);
    }
  });

  function eatGlyphElement(el) {
    if (pet.viewMode !== "pet") pet.awakenPet(null, true);
    const rect = el.getBoundingClientRect();
    const cvsRect = canvas.getBoundingClientRect();
    const fromX = rect.left + rect.width / 2 - cvsRect.left;
    const fromY = rect.top + rect.height / 2 - cvsRect.top;
    const ch = el.textContent;
    el.classList.add("eaten");
    // 从画布内 (fromX,fromY) 飞一个字进去；如果字来源不在画布内，flyingGlyphs 用画布坐标系，所以即便在画布上方也能被绘制
    pet.flyInChar(ch, fromX, fromY);
    pet.addPoolChars(Array.from(ch));
    bumpPouch();
  }

  function bumpPouch() {
    pet.totalEaten = (pet.totalEaten || 0) + 1;
    pouchCount.textContent = pet.totalEaten;
  }

  // ---------- 觅食模式 ----------
  // 让字灵化为蛇形，在画布内"吞食"我们指定的一串假目标
  // （注意：字灵活动范围在画布内，所以觅食的可视路径也在画布内；
  //  我们另外把下方面板上的真字在 pet 回到 idle 后依次"吸"进来作为收尾）
  function triggerFeeding() {
    if (pet.viewMode !== "pet") pet.awakenPet(null, true);
    if (pet.mode === "feeding") {
      pet.abortFeeding();
      toast("已停止觅食");
      return;
    }

    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const count = 7;
    const pad = 50;
    const path = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = pad + (W - pad * 2) * t;
      const y = H * 0.5 + Math.sin(i * 1.1) * H * 0.22;
      path.push({ x, y });
    }

    // 沿途"撒"一些诱饵字（只是视觉展示，实际吞字来自下方面板）
    const bait = spawnBaits(path);

    pet.startFeeding(
      path,
      (reached) => {
        // 每经过一个路径点：吃掉最近的诱饵字；触发一个小涟漪
        const nearest = nearestBait(bait, reached);
        if (nearest) {
          pet.flyInChar(nearest.ch, nearest.x, nearest.y);
          nearest.el.classList.add("eaten");
          bumpPouch();
        }
        pet.pulse(reached.x, reached.y);
      },
      () => {
        const ateCount = eatSomeFromPanel(3 + Math.floor(Math.random() * 3));
        if (ateCount > 0) toast("觅食结束 · 字池 +" + ateCount);
        else toast("觅食结束");
        bait.forEach((b) => b.el.remove());
      }
    );
    toast("觅食中 · 沿路径巡游");
  }

  function spawnBaits(path) {
    // 在 stage 上方放飘浮字作为"视觉零食"
    const baits = [];
    const candidates = ["山", "水", "风", "月", "灵", "笺", "茶", "雨", "归", "慢", "码", "流", "光"];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const el = document.createElement("div");
      const ch = candidates[Math.floor(Math.random() * candidates.length)];
      el.textContent = ch;
      el.style.cssText = `
        position:absolute;
        left:${p.x}px;
        top:${p.y}px;
        transform: translate(-50%, -50%);
        font-family: ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
        font-size: ${14 + Math.random() * 6}px;
        color: rgba(0, 122, 255, 0.35);
        text-shadow: none;
        pointer-events: none;
        z-index: 3;
        transition: opacity 0.4s ease, transform 0.4s ease;
      `;
      (stageMain || stage).appendChild(el);
      baits.push({ el, x: p.x, y: p.y, ch });
    }
    return baits;
  }

  function nearestBait(baits, p) {
    let best = null, bestD = Infinity;
    for (const b of baits) {
      if (b.el.classList.contains("eaten")) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) {
      best.el.classList.add("eaten");
      best.el.style.opacity = "0";
      best.el.style.transform = "translate(-50%,-50%) scale(1.8)";
    }
    return best;
  }

  function resetFeedableGlyphs() {
    for (const el of feedableNodes) {
      if (el.dataset.orig) el.textContent = el.dataset.orig;
      el.classList.remove("eaten");
    }
  }

  function eatSomeFromPanel(n) {
    const available = feedableNodes.filter((el) => !el.classList.contains("eaten"));
    if (!available.length) {
      resetFeedableGlyphs();
    }
    const pool = feedableNodes.filter((el) => !el.classList.contains("eaten"));
    shuffle(pool);
    const picked = pool.slice(0, n);
    const ateCount = picked.length;
    picked.forEach((el, i) => {
      setTimeout(() => eatGlyphElement(el), i * 180);
    });
    return ateCount;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ---------- 自动换形 / 偶发表情 ----------
  setInterval(() => {
    if (pet.viewMode !== "pet") return;
    if (pet.mode !== "idle" || pet.dragging || pet.morphGlyphToTarget) return;
    if (Math.random() < 0.18) {
      const cur = pet.form;
      const nextKey = pet.pickBiasedForm(cur);
      if (pet.gridMarch && pet.gridSnapping && pet.startMorphTo(nextKey)) {
        formLabel.textContent = FORMS[nextKey].label;
      } else {
        setForm(nextKey, false);
      }
      formLabel.style.opacity = 0;
      setTimeout(() => (formLabel.style.opacity = 1), 400);
    }
  }, 11000);

  setInterval(() => {
    if (pet.viewMode !== "pet") return;
    if (pet.mode !== "idle" || pet.dragging) return;
    const r = Math.random();
    if (r < 0.15) pet.setExpression("wink");
    else if (r < 0.25) pet.setExpression("happy");
    else pet.setExpression("normal");
  }, 3000);

  function applyBodyImport() {
    const raw = (bodyImport && bodyImport.value) || "";
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (pet.viewMode !== "pet") pet.awakenPet(null, true);
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const blocks = lines.length ? lines : [trimmed];
    const r = pet.tryConsumeCompletedScriptLines(blocks);
    const anyTodoOrDone = blocks.some((line) => {
      const cl = window.ZiLing.classifyScheduleLine(line);
      return cl.status === "todo" || cl.status === "done";
    });
    if (r.ate === 0 && !anyTodoOrDone) {
      pet.attachBodyChars(trimmed.slice(0, 24));
      pet.digestText(trimmed);
      toast("已写入躯体 · 外圈字");
    } else if (r.ate > 0 && r.todoTouch > 0) {
      toast(`已吞食 ${r.ate} 条已完成 · 待办未贴躯体`);
    } else if (r.ate > 0) {
      toast(`已吞食 ${r.ate} 条已完成`);
    } else if (anyTodoOrDone) {
      toast("待办未贴躯体 · 标记已完成后可吞食");
    }
  }
  if (bodyImportBtn) bodyImportBtn.addEventListener("click", applyBodyImport);
  if (bodyImport) {
    bodyImport.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyBodyImport();
      }
    });
  }

  // ---------- 说明 ----------
  document.getElementById("infoBtn").addEventListener("click", () => {
    toast("拖移 · 戳身边 · 双击觅食 · 躯体可多次写入 · ?form=soft_ray / kao_party / digit_0 / mega&macroText=2026");
  });
})();
