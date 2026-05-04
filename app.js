/**
 * 应用层：把字灵接入页面 —— 交互、觅食、UI 喂食
 */
(function () {
  "use strict";
  const { Pet, FORMS, FORM_ORDER } = window.ZiLing;

  // ---------- 初始化 ----------
  const canvas = document.getElementById("petCanvas");
  const stage = document.getElementById("stage");
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

  const pet = new Pet(canvas, {
    particleCount: 150,
    onFormChange() {},
  });
  window._pet = pet; // 便于调试

  function setForm(key, announce = true) {
    pet.setForm(key);
    formLabel.textContent = FORMS[key].label;
    if (announce) toast("换形 · " + FORMS[key].label);
  }

  function morphToForm(key, announce = true) {
    if (!FORMS[key]) return;
    if (pet.gridMarch && pet.gridSnapping && pet.startMorphTo(key)) {
      formLabel.textContent = FORMS[key].label;
      if (announce) toast("换形中 · " + FORMS[key].label);
      return;
    }
    setForm(key, announce);
  }
  // 支持 URL ?form=cat 直接显示某形态（用于预览/调试）
  const initialForm = new URL(location.href).searchParams.get("form");
  document.title = "字灵 · " + (initialForm || "blob");
  if (initialForm && FORMS[initialForm]) {
    setForm(initialForm, false);
  } else {
    setForm("blob", false);
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

  function onDown(e) {
    if (e.cancelable) e.preventDefault();
    const p = getPos(e);
    downTime = performance.now();
    downPos = p;
    moved = false;
    // 按在宠物身上才算拖拽
    if (Math.hypot(p.x - pet.pos.x, p.y - pet.pos.y) < pet.size * 0.3) {
      pet.beginDrag(p.x, p.y);
    } else if (Math.hypot(p.x - pet.pos.x, p.y - pet.pos.y) < pet.size * 0.48) {
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
    if (Math.hypot(p.x - downPos.x, p.y - downPos.y) > 4) moved = true;
    if (pet.dragging) pet.dragTo(p.x, p.y);
  }

  function onUp(e) {
    if (e && e.cancelable) e.preventDefault();
    const now = performance.now();
    const dt = now - downTime;
    if (pet.dragging) pet.endDrag();

    if (!moved && dt < 260) {
      if (now - lastTap < 320) {
        triggerFeeding();
        lastTap = 0;
      } else {
        lastTap = now;
      }
    }
    downPos = null;
    moved = false;
  }

  function onCancel(e) {
    if (pet.dragging) pet.endDrag();
    downPos = null;
    moved = false;
  }

  stage.addEventListener("touchstart", onDown, { passive: false });
  stage.addEventListener("touchmove", onMove, { passive: false });
  stage.addEventListener("touchend", onUp, { passive: false });
  stage.addEventListener("touchcancel", onCancel, { passive: false });
  stage.addEventListener("mousedown", onDown);
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

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
  }

  // ---------- 工具栏 ----------
  document.querySelectorAll(".tool").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "morph") {
        pet.abortFeeding();
        const cur = pet.form;
        const idx = FORM_ORDER.indexOf(cur);
        const nextIdx = ((idx >= 0 ? idx : 0) + 1) % FORM_ORDER.length;
        const key = FORM_ORDER[nextIdx];
        morphToForm(key);
      } else if (action === "feed") {
        triggerFeeding();
      } else if (action === "sleep") {
        if (pet.mode === "sleep") {
          pet.sleep(false);
          toast("醒了");
        } else {
          pet.sleep(true);
          toast("小憩 · 晚安");
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
      stage.appendChild(el);
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
    if (pet.mode !== "idle" || pet.dragging) return;
    const r = Math.random();
    if (r < 0.15) pet.setExpression("wink");
    else if (r < 0.25) pet.setExpression("happy");
    else pet.setExpression("normal");
  }, 3000);

  const aiSuggest = document.getElementById("aiSuggest");
  const aiApplyBtn = document.getElementById("aiApplyBtn");
  const aiFlashChar = document.getElementById("aiFlashChar");

  function applyAiBlock() {
    const raw = (aiSuggest && aiSuggest.value) || "";
    pet.ingestAiSuggestionBlock(raw);
    const ch = (aiFlashChar && aiFlashChar.value && aiFlashChar.value.trim()[0]) || "";
    if (ch) {
      pet.flashUnifiedChar(ch, 1.7);
      aiFlashChar.value = "";
    }
    toast("已解析建议 · 躯体/冲击/日程词");
  }
  if (aiApplyBtn) aiApplyBtn.addEventListener("click", applyAiBlock);
  if (aiSuggest) {
    aiSuggest.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        applyAiBlock();
      }
    });
  }

  // ---------- 躯体字导入（日程等可先贴在外圈） ----------
  function applyBodyImport() {
    const raw = (bodyImport && bodyImport.value) || "";
    pet.attachBodyChars(raw.trim().slice(0, 24));
    pet.digestText(raw.trim());
    toast("已写入躯体 · 外圈字");
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
    toast("拖移 · 戳身边 · 双击觅食 · 再点觅食可停止 · ?form=blob 调试换形");
  });
})();
