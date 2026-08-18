// ════════════════════════════════════════════════════════════════════════════
// defaults.js
// ════════════════════════════════════════════════════════════════════════════

// 預設無球員（由 localStorage 讀取）
const DEFAULT_PLAYERS = [];

const DEFAULT_EVENT = {
  day: 'TUE',
  time: '20:00–22:00',
  location: '南科新力羽球館',
};

window.DEFAULT_PLAYERS = DEFAULT_PLAYERS;
window.DEFAULT_EVENT = DEFAULT_EVENT;

// ════════════════════════════════════════════════════════════════════════════
// scheduling.js
// ════════════════════════════════════════════════════════════════════════════

// 球員資料正規化（補齊新欄位）
window.normalizePlayer = function(p) {
  // checkedIn：是否已報到（未報到＝名字不亮、不能拖曳、不進排點）
  // paid：是否已繳費（獨立記錄，不影響排點；季繳球員不適用）
  // regular（★）：常客/保留，重整時不消失
  // seasonPass（季）：季繳身分＝固定班底、免繳費，重整時也保留
  return Object.assign({ games: 0, consecutiveGames: 0, partners: {}, opponents: {}, pinned: true, regular: true, checkedIn: false, paid: false, seasonPass: false }, p);
};

// 臨打名單批次解析：把貼上的多行文字轉成一串姓名。
// 規則：只取「開頭是數字編號」的行（例如 "8.JJ"、"11.秉諭 🌐"、"15. 言"），
//       這樣標題行（如 "🎯 臨打報名"）與空行會自動被略過；
//       去掉開頭編號與分隔符，並移除姓名尾端的 emoji / 標記（如 🌐）與空白。
window.parseGuestList = function(text) {
  var names = [];
  String(text || '').split(/\r?\n/).forEach(function(line) {
    var m = line.match(/^\s*\d+\s*[.．、,:)\-\s]+(.+)$/);
    if (!m) return;                       // 沒有開頭編號 → 略過（標題／空行）
    var name = m[1]
      .replace(/[\s\u{200D}\u{FE0F}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}]+$/u, '') // 去尾端 emoji/符號
      .trim();
    if (name) names.push(name);
  });
  return names;
};

// 排程演算法（score-based exhaustive search）
// score = 實力差² × W_LEVEL + 出場數標準差 × W_FAIR
//       + 重複隊友 × W_PARTNER + 連續出賽 × W_CONSEC
//
// ⚠ 權重調整說明（針對「奇數等級會讓同一組一直打」的問題）：
// 舊版實力差權重為 100。全部使用偶數等級時，兩隊實力和很容易湊到完全相等
// （差 0），這一項歸零，後面的公平性考量才有機會決定結果。
// 但只要出現奇數等級，實力差常常最少只能到 1，此項就變成 1²×100 = 100，
// 直接壓過出場數（數十分）與重複隊友（個位數），
// 導致系統為了將實力差從 1 縮到 0，寧可讓同一組人一直上場。
// 新版降低實力權重、拉高公平性權重，並新增連續出賽惩罰。
// options: { numCourts: 1|2 }  預設 2
// 權重常數（要微調手感改這裡就好）
window.SCHED_WEIGHTS = {
  LEVEL:   20,   // 實力差²。舊值 100 太高，會壓死其他考量
  FAIR:    60,   // 出場數總和（見下方 calcScore）。拉高後「大家輪流上場」優先
  PARTNER: 10,   // 重複隊友。舊值 3，拉高後比較不會一直同一組
  CONSEC:  40    // 連續出賽懲罰（新增）。剛打完的人不會馬上又被排上
};

window.scheduleNextRound = function(players, options) {
  var W = window.SCHED_WEIGHTS;
  var PER_COURT = 4;
  var NUM_COURTS = (options && options.numCourts) ? options.numCourts : 2;
  var NEED = NUM_COURTS * PER_COURT;

  // 排除 consecutiveGames >= 2 的球員，其餘全數進入選人池
  var eligible = players.filter(function(p) { return (p.consecutiveGames || 0) < 2; });
  if (eligible.length < PER_COURT) eligible = players.slice();

  var playCount = Math.floor(Math.min(eligible.length, NEED) / PER_COURT) * PER_COURT;
  if (playCount === 0) return { courts: [], bench: players.map(function(p) { return p.id; }) };
  var numCourts = playCount / PER_COURT;

  function calcScore(courtAssigns) {
    var s = 0;
    var all = [];
    courtAssigns.forEach(function(ca) { all = all.concat(ca[0]).concat(ca[1]); });

    courtAssigns.forEach(function(ca) {
      var t1 = ca[0], t2 = ca[1];
      var s1 = t1.reduce(function(a, p) { return a + (p.level || 6); }, 0);
      var s2 = t2.reduce(function(a, p) { return a + (p.level || 6); }, 0);
      s += (s1 - s2) * (s1 - s2) * W.LEVEL;
    });

    // 公平性：直接惩罰「選到已經打很多場的人」
    // 舊版這裡算的是「被選中這 4 人彼此出場數是否接近」，
    // 並不是「有沒有優先選到出場數最少的人」。
    // 四個已經打很多場的人標準差也是 0，舊版完全不介意，
    // 這就是人數不是 4 的倍數時會有人一直被跳過的真正原因。
    var g = all.map(function(p) { return p.games || 0; });
    var total = g.reduce(function(a, b) { return a + b; }, 0);
    s += total * W.FAIR;

    // 連續出賽惩罰：上一場剛打過的人再被排上就加分（分數越低越好）
    all.forEach(function(p) {
      s += (p.consecutiveGames || 0) * W.CONSEC;
    });

    courtAssigns.forEach(function(ca) {
      [ca[0], ca[1]].forEach(function(t) {
        if (t.length >= 2) s += ((t[0].partners || {})[t[1].id] || 0) * W.PARTNER;
      });
    });
    return s;
  }

  var bestScore = Infinity, bestCourts = null;

  function trySelected(sel) {
    if (numCourts === 1) {
      for (var j = 1; j < 4; j++) {
        var t1 = [sel[0], sel[j]];
        var t2 = sel.filter(function(_, k) { return k !== 0 && k !== j; });
        var s = calcScore([[t1, t2]]);
        if (s < bestScore) { bestScore = s; bestCourts = [[t1, t2]]; }
      }
    } else {
      for (var b = 1; b < 6; b++) for (var c = b+1; c < 7; c++) for (var d = c+1; d < 8; d++) {
        var c1 = [sel[0], sel[b], sel[c], sel[d]];
        var c2 = sel.filter(function(p) { return c1.indexOf(p) === -1; });
        for (var j2 = 1; j2 < 4; j2++) {
          var t1a = [c1[0], c1[j2]];
          var t1b = c1.filter(function(_, k) { return k !== 0 && k !== j2; });
          for (var q = 1; q < 4; q++) {
            var t2a = [c2[0], c2[q]];
            var t2b = c2.filter(function(_, k) { return k !== 0 && k !== q; });
            var sc = calcScore([[t1a, t1b], [t2a, t2b]]);
            if (sc < bestScore) { bestScore = sc; bestCourts = [[t1a, t1b], [t2a, t2b]]; }
          }
        }
      }
    }
  }

  // 依 games 由少到多排序，取 minGames
  var sortedEligible = eligible.slice().sort(function(a, b) { return (a.games || 0) - (b.games || 0); });
  var minG = sortedEligible.length > 0 ? (sortedEligible[0].games || 0) : 0;

  // 優先限制：只從 minG 和 minG+1 的球員中選人，確保出場數差距不超過 1。
  // 但若合格球員（eligible）人數已經足夠排場，卻因為出場數差距被切得太窄而湊不滿一場，
  // 就逐步放寬門檻（minG+2, +3, ...），直到湊滿為止，避免明明有人可排卻回傳空場地。
  var gap = 1;
  var pool = sortedEligible.filter(function(p) { return (p.games || 0) <= minG + gap; });
  while (pool.length < playCount && pool.length < sortedEligible.length) {
    gap += 1;
    pool = sortedEligible.filter(function(p) { return (p.games || 0) <= minG + gap; });
  }

  // 根據 pool 大小決定實際可排場數（不超過原本 numCourts）
  var maxCourts = Math.min(numCourts, Math.floor(pool.length / PER_COURT));
  if (maxCourts === 0) return { courts: [], bench: players.map(function(p) { return p.id; }) };
  numCourts = maxCourts;
  playCount = numCourts * PER_COURT;

  function combos(arr, k, start, current, results) {
    if (!results) results = [];
    if (!current) current = [];
    if (!start) start = 0;
    if (current.length === k) { results.push(current.slice()); return results; }
    for (var i = start; i <= arr.length - (k - current.length); i++) {
      current.push(arr[i]);
      combos(arr, k, i + 1, current, results);
      current.pop();
    }
    return results;
  }

  // pool 內枚舉最佳 playCount 人組合
  if (pool.length === playCount) {
    trySelected(pool);
  } else {
    var allCombos = combos(pool, playCount);
    for (var ci = 0; ci < allCombos.length; ci++) trySelected(allCombos[ci]);
  }

  if (!bestCourts) return { courts: [], bench: players.map(function(p) { return p.id; }) };

  var onIds = new Set();
  bestCourts.forEach(function(ca) {
    ca[0].concat(ca[1]).forEach(function(p) { onIds.add(p.id); });
  });

  return {
    courts: bestCourts.map(function(ca) {
      return {
        team1: ca[0].map(function(p) { return p.id; }),
        team2: ca[1].map(function(p) { return p.id; }),
      };
    }),
    bench: players.filter(function(p) { return !onIds.has(p.id); }).map(function(p) { return p.id; }),
  };
};

// 向下相容
window.pickNextLineup = function(players) {
  var result = window.scheduleNextRound(players);
  var pMap = {};
  players.forEach(function(p) { pMap[p.id] = p; });
  return {
    courts: result.courts.map(function(c) {
      return {
        teamA: c.team1.map(function(id) { return pMap[id]; }).filter(Boolean),
        teamB: c.team2.map(function(id) { return pMap[id]; }).filter(Boolean),
      };
    }),
  };
};

window.rotateOneCourt = function(allPlayers, currentCourts) {
  return { newCourts: currentCourts, updatedPlayers: allPlayers };
};

// ════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
// dnd.js — 跨裝置拖曳引擎（Pointer Events）
// 舊版使用 HTML5 Drag & Drop API（draggable / dataTransfer），
// 該 API 在 Android 平板與手機瀏覽器支援不完整，導致完全無法拖曳。
// 此引擎改用 Pointer Events，滑鼠 / 觸控 / 觸控筆均走同一套邏輯。
// ═════════════════════════════════════════════════════════════════════════════

window.__DND = (function() {
  var src = null;          // 目前拖曳中的來源資料
  var overKey = null;      // 目前懸停的放置目標 key
  var ghost = null;        // 跟隨手指的浮動卡片
  var subs = [];
  var lastX = 0, lastY = 0; // 最近一次指標視窗座標（供自動捲動重算落點）
  var edgeV = 0;           // 目前邊緣自動捲動速度（px/frame，正=向下）
  var rafId = null;        // 自動捲動的 requestAnimationFrame id
  var moveRAF = null;      // 拖曳移動的 rAF 批次 id（每幀只處理一次，iOS 才順）

  function notify() {
    for (var i = 0; i < subs.length; i++) subs[i](overKey);
  }

  // 用 transform（translate3d）定位 ghost：只走合成層，不觸發 layout，iOS 較順。
  function positionGhost() {
    if (ghost) ghost.style.transform =
      'translate3d(' + lastX + 'px,' + lastY + 'px,0) translate(-50%,-50%) scale(1.06)';
  }

  // 用 elementFromPoint 偵測放置目標（取代 dragover 事件）。
  // ghost 有 pointer-events:none，elementFromPoint 本來就會忽略它，
  // 因此「不」需要每幀隱藏/顯示 ghost（那會造成兩次強制重排，是 iOS 卡頓主因）。
  function hitTest(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    var t = el.closest('[data-drop]');
    return t ? t.getAttribute('data-drop') : null;
  }

  // ── 邊緣自動捲動 ────────────────────────────────────────────────────────
  // 拖曳時把球員拖到畫面外的場地：手指靠近上/下邊緣就自動捲動。
  // 直式時捲整頁；橫式時若手指在可捲動的名單內就捲那個容器。
  function pageScrollBy(dy) {
    // 不同瀏覽器/版面下真正的捲動容器可能是 html、body 或 window，逐一嘗試。
    var doc = document.scrollingElement || document.documentElement;
    var b1 = doc.scrollTop; doc.scrollTop += dy;
    if (doc.scrollTop !== b1) return;
    var body = document.body;
    var b2 = body.scrollTop; body.scrollTop += dy;
    if (body.scrollTop !== b2) return;
    window.scrollBy(0, dy);
  }
  function nearestScrollableY(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body && el !== document.documentElement) {
      var ov = window.getComputedStyle(el).overflowY;
      if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return null; // 沒有可捲動容器 → 捲整頁
  }
  function autoTick() {
    if (!src || edgeV === 0) { rafId = null; return; }
    var sc = nearestScrollableY(lastX, lastY);
    if (sc) sc.scrollTop += edgeV; else pageScrollBy(edgeV);
    // 捲動後手指底下的落點會變，重新偵測（ghost 位置維持貼在手指視窗座標，不需動）
    var k = hitTest(lastX, lastY);
    if (k !== overKey) { overKey = k; notify(); }
    rafId = requestAnimationFrame(autoTick);
  }
  function updateEdge(y) {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var edge = 90;      // 邊緣感應區高度(px)
    var maxSpeed = 22;  // 每幀最大捲動量(px)
    if (y < edge)            edgeV = -Math.ceil((edge - y) / edge * maxSpeed);
    else if (y > vh - edge)  edgeV =  Math.ceil((y - (vh - edge)) / edge * maxSpeed);
    else edgeV = 0;
    if (edgeV !== 0 && rafId == null) rafId = requestAnimationFrame(autoTick);
  }
  function stopAuto() {
    edgeV = 0;
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // 每幀批次處理拖曳移動：定位 ghost + 偵測落點 + 邊緣捲動判斷
  function flushMove() {
    moveRAF = null;
    if (!src) return;
    positionGhost();
    var k = hitTest(lastX, lastY);
    if (k !== overKey) { overKey = k; notify(); }
    updateEdge(lastY);
  }

  return {
    subscribe: function(fn) {
      subs.push(fn);
      return function() {
        subs = subs.filter(function(f) { return f !== fn; });
      };
    },
    isDragging: function() { return !!src; },

    start: function(s, label, x, y) {
      src = s;
      lastX = x; lastY = y;
      ghost = document.createElement('div');
      ghost.className = 'dnd-ghost';
      document.body.classList.add('dnd-active');
      ghost.textContent = label || '';
      document.body.appendChild(ghost);
      positionGhost();                 // 立刻定位，避免第一幀閃在左上角
      flushMove();                     // 先算一次落點
    },

    move: function(x, y) {
      if (!src) return;
      lastX = x; lastY = y;
      // 只記座標，實際處理丟到下一個動畫幀（每幀最多一次，避免 iOS 卡頓）
      if (moveRAF == null) moveRAF = requestAnimationFrame(flushMove);
    },

    end: function() {
      if (!src) return;
      var k = overKey, s = src;
      this.cancel();
      if (k && window.__onDropKey) window.__onDropKey(s, k);
    },

    cancel: function() {
      stopAuto();
      if (moveRAF != null) { cancelAnimationFrame(moveRAF); moveRAF = null; }
      src = null;
      document.body.classList.remove('dnd-active');
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      ghost = null;
      if (overKey !== null) { overKey = null; notify(); }
    },

    // 拖曳中用「第二根手指」手動捲動頁面（多點觸控）。捲完重算手指底下的落點。
    manualScroll: function(dy) {
      if (!src || !dy) return;
      pageScrollBy(dy);
      var k = hitTest(lastX, lastY);
      if (k !== overKey) { overKey = k; notify(); }
    }
  };
})();

// 放置目標：訂閱是否被懸停
window.useDropOver = function(key) {
  var st = React.useState(false);
  var over = st[0], setOver = st[1];
  React.useEffect(function() {
    return window.__DND.subscribe(function(k) { setOver(k === key); });
  }, [key]);
  return over;
};

// 拖曳來源：回傳一組 pointer 事件 handler
// makeSrc: function → 來源資料物件；label: 浮動卡片上的文字
window.useDragSource = function(makeSrc, enabled, label) {
  var ref = React.useRef({ active: false, moved: false, x: 0, y: 0, id: null, timer: null, captured: false });

  // 拖曳啟動後，阻止瀏覽器把手指移動解讀成捲動。
  // ⚠ blockScroll 必須是「穩定參照」：若每次 render 重新產生新函式，
  //   addEventListener 註冊的實體與後續 removeEventListener 想移除的實體會對不上，
  //   拖曳結束後攔截器殘留在 document 上 → 整頁 touchmove 永久被 preventDefault
  //   → 平板放完球員後就再也無法捲動。故用 useRef 固定同一個函式實體。
  // 追蹤「第二根手指」以支援拖曳中多點觸控滑動（iPhone 那種一指拖、一指滑）
  var secondRef = React.useRef({ id: null, lastY: 0 });
  var blockerRef = React.useRef(null);
  if (!blockerRef.current) {
    blockerRef.current = function(e) {
      // 全程攔截原生捲動：iOS 才不會在第二指落下時 pointercancel 中斷拖曳。
      if (e.cancelable) e.preventDefault();
      var ts = e.touches;
      if (ts && ts.length >= 2) {
        // 以「最後落下的那根手指」的垂直位移手動捲動頁面（手指上移→內容上捲）
        var t2 = ts[ts.length - 1];
        var s = secondRef.current;
        if (s.id !== t2.identifier) { s.id = t2.identifier; s.lastY = t2.clientY; }
        else {
          var dy = s.lastY - t2.clientY;
          s.lastY = t2.clientY;
          if (dy && window.__DND) window.__DND.manualScroll(dy);
        }
      } else {
        secondRef.current.id = null;   // 回到單指 → 清掉第二指狀態
      }
    };
  }
  function addBlocker() {
    secondRef.current.id = null;
    document.addEventListener('touchmove', blockerRef.current, { passive: false });
  }
  function removeBlocker() {
    secondRef.current.id = null;
    document.removeEventListener('touchmove', blockerRef.current, { passive: false });
  }

  // 保險：元件卸載時，確保殘留的攔截器一定被移除，避免捲動被鎖死。
  React.useEffect(function() {
    return function() {
      document.removeEventListener('touchmove', blockerRef.current, { passive: false });
    };
  }, []);

  function clearTimer() {
    var st = ref.current;
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
  }

  function beginDrag(e, x, y) {
    var st = ref.current;
    st.moved = true;
    st.captured = false;
    try {
      if (st.el) { st.el.setPointerCapture(st.id); st.captured = true; }
    } catch (err) {}
    addBlocker();
    // 震動回饋，讓使用者知道已經進入拖曳模式
    try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) {}
    window.__DND.start(makeSrc(), label, x, y);
    window.__DND.move(x, y);
  }

  function down(e) {
    if (!enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 按在按鈕、輸入框等互動元件上時不啟動拖曳
    if (e.target && e.target.closest &&
        e.target.closest('button, input, select, textarea, a, [data-no-drag]')) return;

    var st = ref.current;
    st.active = true; st.moved = false;
    st.x = e.clientX; st.y = e.clientY; st.id = e.pointerId;
    st.el = e.currentTarget;
    st.touch = (e.pointerType === 'touch' || e.pointerType === 'pen');

    clearTimer();
    if (st.touch) {
      // ── 觸控：長按 250ms 才進入拖曳。這段期間手指一動就改成捲動頁面。
      var sx = e.clientX, sy = e.clientY;
      st.timer = setTimeout(function() {
        st.timer = null;
        if (st.active && !st.moved) beginDrag(e, sx, sy);
      }, 250);
    }
    // 滑鼠不需長按，超過 6px 位移就直接拖
  }

  function move(e) {
    var st = ref.current;
    if (!st.active || e.pointerId !== st.id) return;

    if (!st.moved) {
      var dist = Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y);
      if (st.touch) {
        // 長按尚未成立前就移動，視為使用者要捲動頁面：放棄拖曳
        if (dist > 10) { clearTimer(); st.active = false; }
        return;
      }
      if (dist < 6) return;
      beginDrag(e, e.clientX, e.clientY);
    }

    if (e.cancelable) e.preventDefault();
    window.__DND.move(e.clientX, e.clientY);
  }

  function up(e) {
    var st = ref.current;
    if (!st.active || e.pointerId !== st.id) return;
    clearTimer();
    st.active = false;
    if (st.captured) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) {}
      st.captured = false;
    }
    if (st.moved) { st.moved = false; removeBlocker(); window.__DND.end(); }
  }

  function cancel(e) {
    var st = ref.current;
    clearTimer();
    if (!st.active) return;
    st.active = false; st.moved = false; st.captured = false;
    removeBlocker();
    window.__DND.cancel();
  }

  return {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: cancel,
  };
};

// components/Court.js
// ════════════════════════════════════════════════════════════════════════════

// 直式羽球場 - 支援 role (admin/player)
function Court({ index, teamA = [], teamB = [], meId, theme, accent, round, onNext, animating, role }) {
  const isAdmin = role === 'admin';
  const courtColor = theme === 'minimal' ? '#1a2029' : '#0f5a36';
  const courtDark = theme === 'minimal' ? '#151a22' : '#0a4428';
  const lineColor = theme === 'minimal' ? '#2a3340' : 'rgba(255,255,255,0.85)';

  return (
    <div style={{
      position: 'relative', flex: 1,
      display: 'flex', flexDirection: 'column',
      minHeight: 0, minWidth: 0, gap: 8,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 4px 2px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10, color: 'var(--muted)',
            letterSpacing: 1.5, fontWeight: 700,
          }}>COURT {String(index + 1).padStart(2, '0')}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{
              fontSize: 10, color: 'var(--dim)',
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: 1, fontWeight: 600,
            }}>ROUND</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 800, fontSize: 16, color: 'var(--text)', lineHeight: 1,
            }}>{String(round).padStart(2,'0')}</span>
          </div>
        </div>
        {isAdmin ? (
          <button
            onClick={onNext} disabled={animating}
            style={{
              background: animating ? `${accent}55` : accent,
              border: 'none', color: '#0a1a10',
              padding: '6px 14px', borderRadius: 7,
              fontSize: 11, fontWeight: 800,
              cursor: animating ? 'wait' : 'pointer',
              fontFamily: "'Noto Sans TC', sans-serif", letterSpacing: 1,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              boxShadow: animating ? 'none' : `0 3px 10px ${accent}55`,
              transition: 'transform 120ms',
            }}
            onMouseDown={e => !animating && (e.currentTarget.style.transform = 'scale(0.97)')}
            onMouseUp={e => e.currentTarget.style.transform = ''}
            onMouseLeave={e => e.currentTarget.style.transform = ''}
          >
            {animating ? '排點中' : '下一場'}
            {!animating && <span style={{fontSize:13,lineHeight:1}}>→</span>}
          </button>
        ) : (
          <div style={{
            fontSize: 10, color: 'var(--dim)',
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
          }}>{animating ? '管理者排點中…' : '等待排點'}</div>
        )}
      </div>

      <div style={{
        flex: 1, minHeight: 0,
        borderRadius: theme === 'sport' ? 8 : 14,
        overflow: 'hidden',
        background: `linear-gradient(180deg, ${courtColor} 0%, ${courtDark} 50%, ${courtColor} 100%)`,
        border: theme === 'minimal' ? '1px solid var(--line)' : 'none',
        display: 'flex', flexDirection: 'column', position: 'relative',
      }}>
        <svg viewBox="0 0 100 160" preserveAspectRatio="none" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none'
        }}>
          <rect x="5" y="6" width="90" height="148" fill="none" stroke={lineColor} strokeWidth="0.7" />
          <line x1="11" y1="6" x2="11" y2="154" stroke={lineColor} strokeWidth="0.4" opacity="0.5" />
          <line x1="89" y1="6" x2="89" y2="154" stroke={lineColor} strokeWidth="0.4" opacity="0.5" />
          <line x1="50" y1="6" x2="50" y2="40" stroke={lineColor} strokeWidth="0.4" opacity="0.5" />
          <line x1="50" y1="120" x2="50" y2="154" stroke={lineColor} strokeWidth="0.4" opacity="0.5" />
          <line x1="5" y1="52" x2="95" y2="52" stroke={lineColor} strokeWidth="0.5" opacity="0.6" />
          <line x1="5" y1="108" x2="95" y2="108" stroke={lineColor} strokeWidth="0.5" opacity="0.6" />
          <line x1="5" y1="18" x2="95" y2="18" stroke={lineColor} strokeWidth="0.4" opacity="0.4" />
          <line x1="5" y1="142" x2="95" y2="142" stroke={lineColor} strokeWidth="0.4" opacity="0.4" />
        </svg>

        <div style={{
          position: 'absolute', left: '2%', right: '2%', top: '50%',
          height: 10, transform: 'translateY(-50%)',
          background: theme === 'minimal'
            ? 'repeating-linear-gradient(90deg, #3a4555 0 2px, transparent 2px 5px)'
            : 'repeating-linear-gradient(90deg, rgba(255,255,255,0.85) 0 1.5px, rgba(255,255,255,0.25) 1.5px 4px)',
          borderTop: theme === 'minimal' ? '1px solid #4a5566' : '2px solid white',
          borderBottom: theme === 'minimal' ? '1px solid #4a5566' : '2px solid white',
          zIndex: 3,
        }} />

        <div style={{
          flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
          padding: '14px', position: 'relative', zIndex: 2,
          alignItems: 'center', justifyItems: 'center',
        }}>
          {[0, 1].map(i => (
            <PlayerSlot key={`A${i}`} player={teamA[i]} meId={meId} team="A" theme={theme} accent={accent} court={index} pos={i} role={role} />
          ))}
        </div>
        <div style={{
          flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
          padding: '14px', position: 'relative', zIndex: 2,
          alignItems: 'center', justifyItems: 'center',
        }}>
          {[0, 1].map(i => (
            <PlayerSlot key={`B${i}`} player={teamB[i]} meId={meId} team="B" theme={theme} accent={accent} court={index} pos={i} role={role} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerSlot({ player, meId, team, theme, accent, court, pos, role }) {
  const isAdmin = role === 'admin';
  const isMe = player && player.id === meId;

  // 放置目標 key：供 elementFromPoint 偵測
  const dropKey = 'court:' + court + ':' + team + ':' + pos;
  const dragOver = window.useDropOver(dropKey);

  // 拖曳來源（Pointer Events，跨裝置通用）
  const dragHandlers = window.useDragSource(
    function() { return { from: 'court', id: player.id, courtIdx: court, team: team, pos: pos }; },
    isAdmin && !!player,
    player ? player.name : ''
  );

  // ── Drag handlers ──────────────────────────────────────────────────────────

  // ── Empty slot ─────────────────────────────────────────────────────────────
  if (!player) {
    return (
      <div
        data-drop={dropKey}
        style={{
          width: '100%', height: '100%', minHeight: 60,
          borderRadius: 10,
          touchAction: 'manipulation',
          border: `1.5px dashed ${dragOver ? accent : 'rgba(255,255,255,0.2)'}`,
          background: dragOver ? `${accent}22` : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: dragOver ? accent : 'rgba(255,255,255,0.4)', fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
          transition: 'all 140ms ease',
        }}
      >{team}{pos + 1}</div>
    );
  }

  // ── Player card ────────────────────────────────────────────────────────────
  const highlightColor = isMe ? '#eab308' : accent;
  const bgGradient = theme === 'minimal' ? highlightColor : `linear-gradient(160deg, ${highlightColor}, ${highlightColor}dd)`;

  return (
    <div
      data-drop={dropKey}
      {...dragHandlers}
      className="player-slot"
      style={{
        width: '100%', height: '100%', minHeight: 60,
        borderRadius: 12,
        touchAction: 'manipulation',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        background: dragOver ? `${highlightColor}bb` : bgGradient,
        color: '#0a0e14',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '6px 10px',
        cursor: isAdmin ? 'grab' : 'default',
        border: isMe ? `2px solid #fff` : `1px solid ${highlightColor}`,
        position: 'relative',
        transition: 'transform 200ms cubic-bezier(.4,.0,.2,1), background 120ms',
        userSelect: 'none',
        outline: dragOver ? `2px solid ${highlightColor}` : 'none',
        outlineOffset: 2,
      }}
    >
      {isMe && (
        <div style={{
          position: 'absolute', top: -6, right: -6,
          background: '#fff', color: '#111', fontSize: 9, fontWeight: 800,
          padding: '2px 6px', borderRadius: 10, letterSpacing: 0.5,
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        }}>ME</div>
      )}
      <div style={{
        fontWeight: 700, fontSize: 15, letterSpacing: 0.5,
        lineHeight: 1.1, textAlign: 'center',
        fontFamily: "'Noto Sans TC', 'Inter', sans-serif",
      }}>{player.name}</div>
    </div>
  );
}

window.Court = Court;

// ════════════════════════════════════════════════════════════════════════════
// components/TopBar.js
// ════════════════════════════════════════════════════════════════════════════

// 頂部列
function TopBar({ theme, accent, onReset, onShowQR, onLogout, role, eventInfo }) {
  const isAdmin = role === 'admin';
  const dot = <span style={{ color: 'var(--dim)', fontSize: 11, padding: '0 4px' }}>·</span>;
  const fieldStyle = {
    fontSize: 11, color: 'var(--dim)',
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600, letterSpacing: 1,
  };

  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 18px',
      borderBottom: '1px solid var(--line)',
      background: theme === 'minimal' ? 'transparent' : 'rgba(0,0,0,0.2)',
      gap: 14, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontWeight: 800, letterSpacing: 1, fontSize: 13,
        }}>
          <span style={{
            width: 22, height: 22, borderRadius: 6, background: accent,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, color: '#0a1a10', fontWeight: 900,
          }}>羽</span>
          <span>排點 <span style={{color:'var(--muted)',fontWeight:500,fontSize:11}}>ROTATION</span></span>
          <span style={{
            marginLeft: 6,
            fontSize: 9, fontWeight: 800, letterSpacing: 1.5,
            padding: '2px 7px', borderRadius: 4,
            background: isAdmin ? `${accent}22` : '#eab30822',
            color: isAdmin ? accent : '#eab308',
            border: `1px solid ${isAdmin ? accent+'55' : '#eab30855'}`,
            fontFamily: "'JetBrains Mono', monospace",
          }}>{isAdmin ? 'ADMIN' : 'PLAYER'}</span>
        </div>
        <div style={{ height: 20, width: 1, background: 'var(--line)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={fieldStyle}>{eventInfo.day}</span>
          {dot}
          <span style={fieldStyle}>{eventInfo.time}</span>
          {dot}
          <span style={fieldStyle}>{eventInfo.location}</span>
        </div>
      </div>

      {isAdmin && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onLogout}
            style={{
              background: 'transparent', border: '1px solid var(--line)',
              color: 'var(--dim)', padding: '7px 12px', borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'Noto Sans TC', sans-serif",
            }}
            onMouseEnter={e => { e.currentTarget.style.color='var(--text)'; e.currentTarget.style.borderColor='#3a4555'; }}
            onMouseLeave={e => { e.currentTarget.style.color='var(--dim)'; e.currentTarget.style.borderColor='var(--line)'; }}
          >登出</button>
          <button
            onClick={onReset}
            style={{
              background: 'transparent', border: '1px solid var(--line)',
              color: 'var(--muted)', padding: '7px 14px', borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'Noto Sans TC', sans-serif",
            }}
            onMouseEnter={e => { e.currentTarget.style.color='var(--text)'; e.currentTarget.style.borderColor='#3a4555'; }}
            onMouseLeave={e => { e.currentTarget.style.color='var(--muted)'; e.currentTarget.style.borderColor='var(--line)'; }}
          >重設活動</button>
          <button
            onClick={onShowQR}
            style={{
              background: accent, border: 'none', color: '#0a1a10',
              padding: '7px 14px', borderRadius: 8,
              fontSize: 12, fontWeight: 800, cursor: 'pointer',
              fontFamily: "'Noto Sans TC', sans-serif", letterSpacing: 0.5,
              display: 'inline-flex', alignItems: 'center', gap: 7,
              boxShadow: `0 3px 10px ${accent}55`,
            }}
          >
            <QRIcon />
            QR Code
          </button>
        </div>
      )}
    </header>
  );
}

function QRIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="0" y="0" width="5" height="5" rx="1"/>
      <rect x="1.2" y="1.2" width="2.6" height="2.6" rx="0.3" fill="#0a1a10"/>
      <rect x="9" y="0" width="5" height="5" rx="1"/>
      <rect x="10.2" y="1.2" width="2.6" height="2.6" rx="0.3" fill="#0a1a10"/>
      <rect x="0" y="9" width="5" height="5" rx="1"/>
      <rect x="1.2" y="10.2" width="2.6" height="2.6" rx="0.3" fill="#0a1a10"/>
      <rect x="7" y="7" width="1.5" height="1.5"/>
      <rect x="9.5" y="7" width="1.5" height="1.5"/>
      <rect x="12" y="7" width="1.5" height="1.5"/>
      <rect x="7" y="9.5" width="1.5" height="1.5"/>
      <rect x="10.5" y="9.5" width="3" height="3"/>
      <rect x="7" y="12.5" width="1.5" height="1.5"/>
    </svg>
  );
}

window.TopBar = TopBar;

// ════════════════════════════════════════════════════════════════════════════
// components/Sidebar.js
// ════════════════════════════════════════════════════════════════════════════

// 右側球員名單 - 支援 admin / player 兩種角色
function Sidebar({ players, onCourtIds, meId, theme, accent, role, onEditLevel, onAddPlayer, onImportPlayers, onDeletePlayer, onTogglePin, onToggleCheckIn, onTogglePaid, isPortrait }) {
  const isAdmin = role === 'admin';
  const [editingId, setEditingId] = React.useState(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const existingNames = {};
  players.forEach(function(p) { existingNames[p.name] = true; });

  const pinnedCount = players.filter(p => p.regular).length;

  // ── Bench drop zone handlers ──────────────────────────────────────────────
  const dragOverBench = window.useDropOver('bench');

  const editingPlayer = editingId ? players.find(function(p) { return p.id === editingId; }) : null;

  return (
    <aside style={{
      width: isPortrait ? '100%' : '30%',
      minWidth: isPortrait ? 0 : 280,
      background: theme === 'minimal' ? '#131820' : '#1a2029',
      borderLeft: isPortrait ? 'none' : '1px solid var(--line)',
      borderTop: isPortrait ? '1px solid var(--line)' : 'none',
      display: 'flex', flexDirection: 'column',
      height: '100%', minHeight: 0,
      // 直向：填滿場地橫幅下方的剩餘空間，名單在內部自己捲動
      flex: isPortrait ? '1 1 0' : 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px 10px',
        borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.5 }}>
            球員名單
          </div>
          <div style={{
            fontSize: 11, color: 'var(--muted)', marginTop: 2,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {players.length} PLAYERS · {pinnedCount}★ · 報到 {players.filter(function(p){return p.checkedIn;}).length}<br/>{onCourtIds.size} ON COURT
          </div>
        </div>
        {isAdmin ? (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => setImportOpen(true)}
              title="批次匯入臨打名單"
              style={{
                background: 'transparent',
                border: `1px solid var(--line)`,
                color: 'var(--muted)', borderRadius: 7, padding: '5px 10px',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                fontFamily: "'Noto Sans TC', sans-serif", letterSpacing: 0.5,
                whiteSpace: 'nowrap',
                transition: 'all 120ms',
              }}
            >
              匯入
            </button>
            <button
              onClick={() => setAddOpen(true)}
              style={{
                background: 'transparent',
                border: `1px solid ${accent}66`,
                color: accent, borderRadius: 7, padding: '5px 10px',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                fontFamily: "'Noto Sans TC', sans-serif", letterSpacing: 0.5,
                whiteSpace: 'nowrap',
                transition: 'all 120ms',
              }}
            >
              + 新增
            </button>
          </div>
        ) : (
          <div style={{
            fontSize: 10, color: 'var(--dim)',
            fontFamily: "'JetBrains Mono', monospace",
          }}>Roster</div>
        )}
      </div>

      {/* Legend */}
      <div style={{
        padding: '8px 18px', display: 'flex', gap: 12,
        borderBottom: '1px solid var(--line)', fontSize: 10,
        color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace",
      }}>
        <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:accent,marginRight:5}}/>場上</span>
        <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'#eab308',marginRight:5}}/>我</span>
        <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'#3a4555',marginRight:5}}/>休息</span>
      </div>

      {/* 球員清單（可拖回場地球員的放置區）。直向也在此內部捲動。 */}
      <div
        data-drop="bench"
        style={{
          flex: 1, minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '8px 10px',
          transition: 'background 160ms',
          background: dragOverBench ? `${accent}08` : 'transparent',
        }}
      >
        {players.map(p => (
          <PlayerRow
            key={p.id} player={p}
            onCourt={onCourtIds.has(p.id)}
            isMe={p.id === meId}
            theme={theme} accent={accent}
            isAdmin={isAdmin}
            onBeginEdit={() => setEditingId(p.id)}
            onEditLevel={onEditLevel}
            onDelete={onDeletePlayer}
            onTogglePin={onTogglePin}
            onToggleCheckIn={onToggleCheckIn}
            onTogglePaid={onTogglePaid}
          />
        ))}

        {/* 拖曳放置提示區 */}
        {isAdmin && (
          <div
            data-drop="bench"
            style={{
              margin: '6px 0 2px',
              padding: '10px 14px',
              borderRadius: 8,
              border: `1.5px dashed ${dragOverBench ? accent : 'rgba(255,255,255,0.08)'}`,
              background: dragOverBench ? `${accent}18` : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              color: dragOverBench ? accent : 'var(--dim)',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: 0.5,
              transition: 'all 150ms ease',
              minHeight: 40,
              userSelect: 'none',
            }}
          >
            <span style={{ fontSize: 14 }}>←</span>
            拖曳場地球員至此移出場地
          </div>
        )}
      </div>

      {/* Add Player Dialog */}
      {addOpen && isAdmin && (
        <AddPlayerDialog
          accent={accent}
          onAdd={function(name, level, pinned) {
            onAddPlayer(name, level, pinned);
            setAddOpen(false);
          }}
          onCancel={function() { setAddOpen(false); }}
        />
      )}

      {/* Import Guests Dialog */}
      {importOpen && isAdmin && (
        <ImportDialog
          accent={accent}
          existingNames={existingNames}
          onImport={function(names, level) {
            onImportPlayers(names, level);
            setImportOpen(false);
          }}
          onCancel={function() { setImportOpen(false); }}
        />
      )}

      {/* Level Edit Dialog */}
      {editingId && editingPlayer && (
        <LevelDialog
          player={editingPlayer}
          accent={accent}
          onCommit={function(v) { onEditLevel(editingPlayer.id, v); setEditingId(null); }}
          onCancel={function() { setEditingId(null); }}
        />
      )}
    </aside>
  );
}

function AddPlayerDialog({ accent, onAdd, onCancel }) {
  const [name, setName] = React.useState('');
  const [level, setLevel] = React.useState(6);
  const [regular, setRegular] = React.useState(false);
  const inputRef = React.useRef(null);

  React.useEffect(function() {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  function handleSubmit() {
    var trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, level, regular);
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={function(e) { e.stopPropagation(); }}
        style={{
          background: '#1a2029', border: '1px solid var(--line)',
          borderRadius: 16, padding: '28px 28px 24px',
          width: 320, maxWidth: '90vw',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}
      >
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11, fontWeight: 700, letterSpacing: 2,
          color: 'var(--muted)',
        }}>NEW PLAYER</div>

        {/* Name input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            ref={inputRef}
            value={name}
            onChange={function(e) { setName(e.target.value); }}
            onKeyDown={function(e) {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') onCancel();
            }}
            placeholder="球員名字"
            maxLength={8}
            style={{
              background: '#0c1016',
              border: `1.5px solid #2a3340`,
              borderRadius: 9, padding: '10px 14px',
              color: '#fff', fontSize: 15, outline: 'none',
              fontFamily: "'Noto Sans TC', sans-serif",
              width: '100%',
            }}
          />
        </div>

        {/* Level slider */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: 11, color: 'var(--muted)',
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
            }}>LEVEL</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 800, fontSize: 32, color: accent, lineHeight: 1,
            }}>{level}</span>
          </div>
          <input
            type="range" min={1} max={12} value={level}
            onChange={function(e) { setLevel(+e.target.value); }}
            style={{ width: '100%', accentColor: accent }}
          />
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 10, color: 'var(--dim)',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <span>1 新手</span>
            <span>6 中階</span>
            <span>12 高手</span>
          </div>
        </div>

        {/* Regular checkbox */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer', userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={regular}
            onChange={function(e) { setRegular(e.target.checked); }}
            style={{ accentColor: '#fbbf24', width: 16, height: 16 }}
          />
          <span style={{
            fontSize: 13, color: regular ? '#fbbf24' : 'var(--muted)',
            fontFamily: "'Noto Sans TC', sans-serif",
            transition: 'color 120ms',
          }}>★ 固定班底</span>
        </label>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent', border: '1px solid var(--line)',
              color: 'var(--muted)', borderRadius: 8, padding: '8px 18px',
              fontSize: 13, cursor: 'pointer',
              fontFamily: "'Noto Sans TC', sans-serif",
            }}
          >取消</button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            style={{
              background: name.trim() ? accent : `${accent}55`,
              border: 'none', color: '#0a1a10',
              borderRadius: 8, padding: '8px 22px',
              fontSize: 13, fontWeight: 800, cursor: name.trim() ? 'pointer' : 'not-allowed',
              fontFamily: "'Noto Sans TC', sans-serif",
            }}
          >新增</button>
        </div>
      </div>
    </div>
  );
}

// 臨打名單批次匯入對話框
function ImportDialog({ accent, existingNames, onImport, onCancel }) {
  const [text, setText] = React.useState('');
  const [level, setLevel] = React.useState(6);

  const parsed = window.parseGuestList(text);
  const seen = {};
  const toAdd = [];
  const dup = [];
  parsed.forEach(function(n) {
    if (seen[n]) return; seen[n] = true;
    if (existingNames[n]) dup.push(n); else toAdd.push(n);
  });

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={function(e) { e.stopPropagation(); }}
        style={{
          background: '#1a2029', border: '1px solid var(--line)',
          borderRadius: 16, padding: '24px 24px 20px',
          width: 460, maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11, fontWeight: 700, letterSpacing: 2, color: 'var(--muted)',
        }}>IMPORT 臨打名單</div>

        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, fontFamily: "'Noto Sans TC', sans-serif" }}>
          直接貼上報名清單即可（可含編號、標題行、🌐 等標記，會自動忽略）。<br/>
          匯入的球員<span style={{ color: '#fbbf24' }}> 星號不會點亮</span>（視為臨打，重設時清除）。
        </div>

        <textarea
          value={text}
          onChange={function(e) { setText(e.target.value); }}
          placeholder={'🎯 臨打報名\n8.JJ\n9.珉佑\n10.土豆\n11.秉諭 🌐\n...'}
          rows={8}
          style={{
            background: '#0c1016', border: '1.5px solid #2a3340', borderRadius: 9,
            padding: '10px 12px', color: '#fff', fontSize: 14, outline: 'none',
            fontFamily: "'JetBrains Mono','Noto Sans TC', monospace", lineHeight: 1.5,
            width: '100%', resize: 'vertical',
          }}
        />

        {/* 統一等級 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>統一等級 LEVEL</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: 26, color: accent, lineHeight: 1 }}>{level}</span>
          </div>
          <input type="range" min={1} max={12} value={level}
            onChange={function(e) { setLevel(+e.target.value); }}
            style={{ width: '100%', accentColor: accent }} />
        </div>

        {/* 預覽 */}
        <div style={{
          fontSize: 12, color: 'var(--muted)', fontFamily: "'Noto Sans TC', sans-serif",
          borderTop: '1px solid var(--line)', paddingTop: 12,
        }}>
          {parsed.length === 0
            ? <span style={{ color: 'var(--dim)' }}>尚未偵測到名單…</span>
            : (
              <React.Fragment>
                將新增 <span style={{ color: accent, fontWeight: 800 }}>{toAdd.length}</span> 位
                {dup.length > 0 && <span style={{ color: 'var(--dim)' }}>（略過 {dup.length} 位重複：{dup.join('、')}）</span>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {toAdd.map(function(n, i) {
                    return <span key={i} style={{
                      fontSize: 12, padding: '3px 9px', borderRadius: 6,
                      background: `${accent}18`, color: accent, border: `1px solid ${accent}44`,
                      fontFamily: "'Noto Sans TC', sans-serif",
                    }}>{n}</span>;
                  })}
                </div>
              </React.Fragment>
            )}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent', border: '1px solid var(--line)',
              color: 'var(--muted)', borderRadius: 8, padding: '8px 18px',
              fontSize: 13, cursor: 'pointer', fontFamily: "'Noto Sans TC', sans-serif",
            }}
          >取消</button>
          <button
            onClick={function() { if (toAdd.length) onImport(toAdd, level); }}
            disabled={toAdd.length === 0}
            style={{
              background: toAdd.length ? accent : `${accent}55`,
              border: 'none', color: '#0a1a10', borderRadius: 8, padding: '8px 22px',
              fontSize: 13, fontWeight: 800,
              cursor: toAdd.length ? 'pointer' : 'not-allowed',
              fontFamily: "'Noto Sans TC', sans-serif",
            }}
          >匯入 {toAdd.length} 位</button>
        </div>
      </div>
    </div>
  );
}

function LevelDialog({ player, accent, onCommit, onCancel }) {
  const [level, setLevel] = React.useState(player.level || 6);
  const [games, setGames] = React.useState(player.games || 0);
  const [season, setSeason] = React.useState(player.seasonPass === true);

  function setG(v) { setGames(Math.max(0, Math.min(999, v | 0))); }
  function commit() {
    // 勾選季繳＝固定班底，順便把 ★ 點亮（取消季繳不動 ★，交給管理者手動）
    var patch = { level: level, games: games, seasonPass: season };
    if (season) patch.regular = true;
    onCommit(patch);
  }

  React.useEffect(function() {
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') commit();
    }
    window.addEventListener('keydown', onKey);
    return function() { window.removeEventListener('keydown', onKey); };
  }, [level, games, season]);

  const stepBtn = {
    width: 44, height: 44, borderRadius: 10,
    background: '#0c1016', border: '1.5px solid #2a3340',
    color: 'var(--text)', fontSize: 24, fontWeight: 700, lineHeight: 1,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    userSelect: 'none',
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={function(e) { e.stopPropagation(); }}
        style={{
          background: '#1a2029', border: '1px solid var(--line)',
          borderRadius: 16, padding: '28px 28px 24px',
          width: 300, maxWidth: '90vw',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}
      >
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11, fontWeight: 700, letterSpacing: 2,
          color: 'var(--muted)',
        }}>EDIT PLAYER</div>

        <div style={{
          fontSize: 18, fontWeight: 700,
          fontFamily: "'Noto Sans TC', sans-serif",
          color: 'var(--text)',
        }}>{player.name}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 800, fontSize: 52, color: accent, lineHeight: 1,
            }}>{level}</span>
          </div>
          <input
            type="range" min={1} max={12} value={level}
            onChange={function(e) { setLevel(+e.target.value); }}
            style={{ width: '100%', accentColor: accent }}
            autoFocus
          />
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 10, color: 'var(--dim)',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <span>1 新手</span>
            <span>6 中階</span>
            <span>12 高手</span>
          </div>
        </div>

        {/* 場次（可手動調整） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{
            fontSize: 11, color: 'var(--muted)',
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
          }}>場次 GAMES</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            <button onClick={function() { setG(games - 1); }} style={stepBtn} title="減一場">−</button>
            <input
              type="number" min={0} value={games}
              onChange={function(e) { setG(+e.target.value); }}
              style={{
                width: 90, textAlign: 'center',
                background: '#0c1016', border: '1.5px solid #2a3340', borderRadius: 9,
                padding: '6px 4px', color: '#fff',
                fontSize: 30, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
                outline: 'none',
              }}
            />
            <button onClick={function() { setG(games + 1); }} style={stepBtn} title="加一場">+</button>
          </div>
        </div>

        {/* 季繳球員（免繳費、重整保留） */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox" checked={season}
            onChange={function(e) { setSeason(e.target.checked); }}
            style={{ accentColor: '#34d399', width: 16, height: 16 }}
          />
          <span style={{
            fontSize: 13, color: season ? '#34d399' : 'var(--muted)',
            fontFamily: "'Noto Sans TC', sans-serif", transition: 'color 120ms',
          }}>季繳球員（免繳費）</span>
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent', border: '1px solid var(--line)',
              color: 'var(--muted)', borderRadius: 8, padding: '8px 18px',
              fontSize: 13, cursor: 'pointer',
              fontFamily: "'Noto Sans TC', sans-serif",
            }}
          >取消</button>
          <button
            onClick={commit}
            style={{
              background: accent, border: 'none', color: '#0a1a10',
              borderRadius: 8, padding: '8px 22px',
              fontSize: 13, fontWeight: 800, cursor: 'pointer',
              fontFamily: "'Noto Sans TC', sans-serif",
            }}
          >確定</button>
        </div>
      </div>
    </div>
  );
}

function PlayerRow({ player, onCourt, isMe, theme, accent, isAdmin, onBeginEdit, onEditLevel, onDelete, onTogglePin, onToggleCheckIn, onTogglePaid }) {
  const [hover, setHover] = React.useState(false);
  const checkedIn = player.checkedIn === true;

  // 只有「已報到」的球員能拖曳
  const dragHandlers = window.useDragSource(
    function() { return { from: 'bench', id: player.id }; },
    isAdmin && !onCourt && checkedIn,
    player.name
  );

  const highlightColor = isMe ? '#eab308' : accent;

  // 報到 / 繳費 小徽章樣式（active = 已完成，實心；否則外框）
  const chip = function(active, col) {
    return {
      background: active ? col : 'transparent',
      border: '1px solid ' + (active ? col : '#3a4555'),
      color: active ? '#0a1a10' : 'var(--muted)',
      cursor: 'pointer', padding: '2px 9px', borderRadius: 5,
      fontFamily: "'Noto Sans TC', sans-serif", fontSize: 11, fontWeight: 700,
      minHeight: 24, lineHeight: 1.4, whiteSpace: 'nowrap', transition: 'all 120ms',
    };
  };

  return (
    <div
      {...dragHandlers}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        touchAction: 'manipulation',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 10px', marginBottom: 4,
        borderRadius: 8,
        background: isMe
          ? `${highlightColor}1a`
          : onCourt ? `${accent}15` : (hover ? 'rgba(255,255,255,0.03)' : 'transparent'),
        border: isMe
          ? `1px solid ${highlightColor}66`
          : onCourt ? `1px solid ${accent}33` : '1px solid transparent',
        cursor: isAdmin ? (onCourt ? 'default' : 'grab') : 'default',
        opacity: onCourt ? 0.92 : 1,
        transition: 'background 140ms, border 140ms',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      <div style={{
        width: 4, height: 30, borderRadius: 2,
        background: isMe ? highlightColor : onCourt ? accent : '#3a4555',
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 600, fontSize: 14,
          fontFamily: "'Noto Sans TC', sans-serif",
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          color: isMe ? '#fbd34d' : (checkedIn ? 'var(--text)' : 'var(--dim)'),
        }}>
          {isAdmin ? (
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePin && onTogglePin(player.id); }}
              title={player.regular === true ? '取消固定班底' : '設為固定班底'}
              style={{
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                color: player.regular === true ? '#fbbf24' : '#3a4555',
                fontSize: 14, lineHeight: 1, display: 'inline-flex',
              }}
            >★</button>
          ) : (
            player.regular === true && <span style={{ color: '#fbbf24', fontSize: 14, lineHeight: 1 }}>★</span>
          )}
          {player.name}
          {isMe && <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
            background: '#eab308', color: '#1a1408',
            padding: '1px 5px', borderRadius: 4,
          }}>ME</span>}
          {player.seasonPass === true && <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
            background: '#34d39922', color: '#34d399', border: '1px solid #34d39955',
            padding: '1px 6px', borderRadius: 4,
            fontFamily: "'Noto Sans TC', sans-serif",
          }}>季繳</span>}
          {!checkedIn && <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
            background: '#2a3340', color: '#c0c7d0',
            padding: '1px 6px', borderRadius: 4,
            fontFamily: "'Noto Sans TC', sans-serif",
          }}>未報到</span>}
        </div>
        <div style={{
          fontSize: 10, color: 'var(--muted)', marginTop: 3,
          fontFamily: "'JetBrains Mono', monospace",
          display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
        }}>
          {isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); onBeginEdit(); }}
              style={{
                background: 'transparent', border: `1px dashed ${hover ? accent : '#3a4555'}`,
                color: 'var(--text)', cursor: 'pointer',
                padding: '2px 10px', borderRadius: 5,
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
                transition: 'border 120ms', minHeight: 24,
              }}
              title="調整等級"
            >
              Lv {player.level}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCheckIn && onToggleCheckIn(player.id); }}
              style={chip(checkedIn, '#34d399')}
              title={checkedIn ? '點擊取消報到' : '標記已報到'}
            >{checkedIn ? '✓ 報到' : '報到'}</button>
          )}
          {/* 季繳球員免逐場繳費，故只有「非季繳」的球員才顯示繳費徽章 */}
          {isAdmin && player.seasonPass !== true && (
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePaid && onTogglePaid(player.id); }}
              style={chip(player.paid === true, '#fbbf24')}
              title={player.paid === true ? '點擊取消繳費' : '標記已繳費'}
            >{player.paid === true ? '✓ 繳費' : '繳費'}</button>
          )}
          {onCourt && <span style={{color:accent,fontWeight:700}}>ON COURT</span>}
        </div>
      </div>

      {/* 右側：出場數 + admin 刪除 */}
      {isAdmin && hover && !onCourt && !isMe ? (
        <button
          onClick={(e) => { e.stopPropagation(); if (confirm(`刪除 ${player.name}？`)) onDelete(player.id); }}
          style={{
            background: 'transparent', color: '#f87171',
            border: '1px solid #f8717166', borderRadius: 6,
            padding: '3px 8px', fontSize: 10, fontWeight: 700,
            cursor: 'pointer', fontFamily: "'Noto Sans TC', sans-serif",
          }}
        >刪除</button>
      ) : (
        <div
          onClick={isAdmin ? function(e) { e.stopPropagation(); onBeginEdit(); } : undefined}
          title={isAdmin ? '點擊調整等級 / 場次' : undefined}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 18, fontWeight: 700,
            color: isMe ? highlightColor : onCourt ? accent : 'var(--dim)',
            minWidth: 24, textAlign: 'right',
            cursor: isAdmin ? 'pointer' : 'default',
          }}
        >
          {String(player.games).padStart(2,'0')}
        </div>
      )}
    </div>
  );
}

window.Sidebar = Sidebar;

// ════════════════════════════════════════════════════════════════════════════
// components/JoinScreen.js
// ════════════════════════════════════════════════════════════════════════════

// 加入活動頁面 - 支援 admin / player 兩種模式
// 球員自助報到：從名單挑自己的名字 → 確認報到（可選同時繳費）
function PlayerCheckInScreen({ players, accent, onCheckIn, onSkip }) {
  const [query, setQuery] = React.useState('');
  const [selId, setSelId] = React.useState(null);

  const list = (players || []).slice().sort(function(a, b) {
    if (!!a.checkedIn !== !!b.checkedIn) return a.checkedIn ? 1 : -1; // 未報到在前
    return String(a.name).localeCompare(String(b.name), 'zh-Hant');
  });
  const q = query.trim().toLowerCase();
  const filtered = q ? list.filter(function(p) { return String(p.name).toLowerCase().indexOf(q) !== -1; }) : list;
  const sel = selId ? (players || []).find(function(p) { return p.id === selId; }) : null;

  const shell = {
    minHeight: '100dvh', width: '100vw',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(ellipse at top, #1a2533 0%, #131820 50%, #0c1016 100%)',
    padding: 24,
  };
  const card = {
    width: '100%', maxWidth: 460, maxHeight: '90dvh',
    background: '#1a2029', border: '1px solid var(--line)',
    borderRadius: 18, padding: '28px 26px',
    boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', gap: 14,
  };

  function Header() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 34, height: 34, borderRadius: 9, background: accent,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, color: '#0a1a10', fontWeight: 900,
        }}>羽</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: 1 }}>
            排點 <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 11 }}>報到</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
            星期二 · 20:00–22:00 · 南科新力羽球館
          </div>
        </div>
      </div>
    );
  }

  // ── 確認畫面 ──
  if (sel) {
    return (
      <div style={shell}>
        <div style={card}>
          <Header />
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: 2, color: 'var(--muted)' }}>CHECK-IN 確認報到</div>
          <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'Noto Sans TC', sans-serif", color: 'var(--text)' }}>{sel.name}</div>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>確認後即完成報到、加入排點。</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button onClick={function() { setSelId(null); }} style={{
              flex: '0 0 auto', background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)',
              borderRadius: 10, padding: '13px 20px', fontSize: 14, cursor: 'pointer', fontFamily: "'Noto Sans TC', sans-serif",
            }}>返回</button>
            <button onClick={function() { onCheckIn(sel.id, false); }} style={{
              flex: 1, background: accent, color: '#0a1a10', border: 'none',
              borderRadius: 10, padding: '13px', fontSize: 15, fontWeight: 800, letterSpacing: 1,
              cursor: 'pointer', boxShadow: `0 8px 22px ${accent}55`, fontFamily: "'Noto Sans TC', sans-serif",
            }}>完成報到</button>
          </div>
        </div>
      </div>
    );
  }

  // ── 名單挑選畫面 ──
  return (
    <div style={shell}>
      <div style={card}>
        <Header />
        <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 700, fontFamily: "'Noto Sans TC', sans-serif" }}>選擇你的名字報到</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
          找到你在 LINE 報名的名字，點一下即可完成報到、加入排點。
        </p>
        <input
          value={query}
          onChange={function(e) { setQuery(e.target.value); }}
          placeholder="搜尋名字…"
          style={{
            width: '100%', background: '#0d1218', border: '1.5px solid var(--line)',
            borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 15,
            fontFamily: "'Noto Sans TC', sans-serif", outline: 'none',
          }}
          onFocus={function(e) { e.target.style.borderColor = accent; }}
          onBlur={function(e) { e.target.style.borderColor = 'var(--line)'; }}
        />
        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 60, maxHeight: '42dvh' }}>
          {filtered.length === 0 ? (
            <div style={{ color: 'var(--dim)', fontSize: 13, textAlign: 'center', padding: '20px 0', fontFamily: "'Noto Sans TC', sans-serif" }}>
              {(players || []).length === 0 ? '名單載入中，或尚未建立…' : '找不到這個名字，請通知管理者。'}
            </div>
          ) : filtered.map(function(p) {
            return (
              <button key={p.id}
                onClick={function() { p.checkedIn ? onCheckIn(p.id, false) : setSelId(p.id); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  background: p.checkedIn ? 'transparent' : '#0d1218',
                  border: '1px solid ' + (p.checkedIn ? 'var(--line)' : '#2a3340'),
                  borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                  opacity: p.checkedIn ? 0.55 : 1,
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: "'Noto Sans TC', sans-serif" }}>
                  {p.regular === true && <span style={{ color: '#fbbf24', marginRight: 5 }}>★</span>}{p.name}
                </span>
                {p.checkedIn
                  ? <span style={{ fontSize: 11, color: 'var(--dim)', fontFamily: "'Noto Sans TC', sans-serif" }}>已報到</span>
                  : <span style={{ fontSize: 13, color: accent, fontWeight: 700, fontFamily: "'Noto Sans TC', sans-serif" }}>報到 →</span>}
              </button>
            );
          })}
        </div>
        <button onClick={onSkip} style={{
          width: '100%', background: 'transparent', color: 'var(--muted)',
          border: '1px solid var(--line)', borderRadius: 10, padding: '11px',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Noto Sans TC', sans-serif",
        }}>只看排點，不加入</button>
      </div>
    </div>
  );
}

function JoinScreen({ onJoin, onSkip, theme, accent, role, players, onCheckIn }) {
  const [name, setName] = React.useState('');
  const inputRef = React.useRef(null);
  const isPlayer = role === 'player';

  // 球員模式：改用「從名單挑選報到」流程
  if (isPlayer) {
    return <PlayerCheckInScreen players={players} accent={accent} onCheckIn={onCheckIn} onSkip={onSkip} />;
  }

  React.useEffect(() => {
    inputRef.current && inputRef.current.focus();
  }, []);

  const submit = () => {
    if (name.trim()) onJoin(name.trim());
  };

  return (
    <div style={{
      height: '100vh', width: '100vw',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at top, #1a2533 0%, #131820 50%, #0c1016 100%)',
      padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 460,
        background: '#1a2029', border: '1px solid var(--line)',
        borderRadius: 18, padding: '34px 32px',
        boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22,
        }}>
          <span style={{
            width: 34, height: 34, borderRadius: 9,
            background: accent,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: '#0a1a10', fontWeight: 900,
          }}>羽</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: 1 }}>
              排點 <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 11 }}>ROTATION</span>
              <span style={{
                marginLeft: 6,
                fontSize: 9, fontWeight: 800, letterSpacing: 1.5,
                padding: '2px 7px', borderRadius: 4,
                background: isPlayer ? '#eab30822' : `${accent}22`,
                color: isPlayer ? '#eab308' : accent,
                border: `1px solid ${isPlayer ? '#eab30855' : accent+'55'}`,
                fontFamily: "'JetBrains Mono', monospace",
              }}>{isPlayer ? 'PLAYER' : 'ADMIN'}</span>
            </div>
            <div style={{
              fontSize: 10, color: 'var(--dim)', marginTop: 2,
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
            }}>
              星期二 · 20:00–22:00 · 南科新力羽球館
            </div>
          </div>
        </div>

        <h2 style={{
          margin: '0 0 6px', fontSize: 22, fontWeight: 700, letterSpacing: 0.5,
          fontFamily: "'Noto Sans TC', sans-serif",
        }}>
          {isPlayer ? '加入怕乙球的活動' : '開啟活動（管理者）'}
        </h2>
        <p style={{
          margin: '0 0 22px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.6,
        }}>
          {isPlayer
            ? '輸入你的名字後就能看到排點，場上出現你的時候會用黃色高亮。'
            : '輸入你的名字以管理者身份開始。你可以排點、調整球員等級、產生 QR 給球員掃描。'}
        </p>

        <label style={{
          display: 'block',
          fontSize: 10, color: 'var(--muted)',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 1.5, fontWeight: 700, marginBottom: 7,
        }}>你的名字</label>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="例如：王小明"
          maxLength={8}
          style={{
            width: '100%',
            background: '#0d1218',
            border: '1.5px solid var(--line)',
            borderRadius: 10, padding: '13px 14px',
            color: 'var(--text)', fontSize: 16,
            fontFamily: "'Noto Sans TC', sans-serif",
            outline: 'none', transition: 'border 160ms',
          }}
          onFocus={e => e.target.style.borderColor = accent}
          onBlur={e => e.target.style.borderColor = 'var(--line)'}
        />
        <div style={{
          fontSize: 10, color: 'var(--dim)', marginTop: 6,
          fontFamily: "'JetBrains Mono', monospace",
        }}>{name.length} / 8</div>

        <button
          onClick={submit}
          disabled={!name.trim()}
          style={{
            width: '100%', marginTop: 18,
            background: name.trim() ? accent : '#2a3340',
            color: name.trim() ? '#0a1a10' : 'var(--dim)',
            border: 'none', borderRadius: 10,
            padding: '14px', fontSize: 14, fontWeight: 800,
            letterSpacing: 1,
            cursor: name.trim() ? 'pointer' : 'not-allowed',
            boxShadow: name.trim() ? `0 8px 22px ${accent}55` : 'none',
            transition: 'all 140ms',
            fontFamily: "'Noto Sans TC', sans-serif",
          }}
        >
          {isPlayer ? '加入活動' : '開始管理'}
        </button>

        {!isPlayer && (
          <React.Fragment>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              margin: '18px 0 14px',
            }}>
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              <span style={{
                fontSize: 10, color: 'var(--dim)',
                fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
              }}>OR</span>
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>
            <button onClick={onSkip} style={{
              width: '100%',
              background: 'transparent', color: 'var(--muted)',
              border: '1px solid var(--line)', borderRadius: 10,
              padding: '11px', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'Noto Sans TC', sans-serif",
            }}>只看排點，不加入</button>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

window.JoinScreen = JoinScreen;

// ════════════════════════════════════════════════════════════════════════════
// components/TweaksPanel.js
// ════════════════════════════════════════════════════════════════════════════

// Tweaks 面板
function TweaksPanel({ state, onChange, show }) {
  if (!show) return null;

  const themes = [
    { id: 'classic',  label: '經典', desc: '標準卡片 · 實用' },
    { id: 'sport',    label: '競技', desc: '大數字 · 運動感' },
    { id: 'minimal',  label: '極簡', desc: '單色 · 編輯器風' },
  ];

  const accents = [
    { id: '#22c55e', label: '球場綠' },
    { id: '#38bdf8', label: '電光藍' },
    { id: '#f472b6', label: '粉紅' },
    { id: '#fb923c', label: '橘' },
    { id: '#a78bfa', label: '紫' },
  ];

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16,
      width: 260, zIndex: 1000,
      background: 'rgba(20,26,34,0.96)',
      backdropFilter: 'blur(14px)',
      border: '1px solid #2a3340',
      borderRadius: 14,
      padding: 16,
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      fontFamily: "'Inter','Noto Sans TC',sans-serif",
      color: '#e8ecf1',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>
          Tweaks
        </div>
        <div style={{
          fontSize: 9, color: '#5b6472',
          fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1.5,
        }}>
          DESIGN
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{
          fontSize: 10, color: '#8892a0',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 1.5, fontWeight: 700, marginBottom: 7,
        }}>
          THEME
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
          {themes.map(t => (
            <button
              key={t.id}
              onClick={() => onChange({ theme: t.id })}
              style={{
                background: state.theme === t.id ? state.accent : 'transparent',
                color: state.theme === t.id ? '#0a1a10' : '#8892a0',
                border: state.theme === t.id ? 'none' : '1px solid #2a3340',
                borderRadius: 8,
                padding: '8px 4px',
                fontSize: 11, fontWeight: 700,
                cursor: 'pointer',
                fontFamily: "'Noto Sans TC', sans-serif",
                letterSpacing: 0.5,
                transition: 'all 140ms',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{
          fontSize: 10, color: '#5b6472', marginTop: 6,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {themes.find(t => t.id === state.theme)?.desc}
        </div>
      </div>

      <div>
        <div style={{
          fontSize: 10, color: '#8892a0',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 1.5, fontWeight: 700, marginBottom: 7,
        }}>
          ACCENT
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {accents.map(c => (
            <button
              key={c.id}
              onClick={() => onChange({ accent: c.id })}
              title={c.label}
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: c.id,
                border: state.accent === c.id ? '2px solid #fff' : '2px solid transparent',
                cursor: 'pointer',
                outline: 'none',
                boxShadow: state.accent === c.id ? `0 0 0 1px ${c.id}, 0 4px 10px ${c.id}66` : 'none',
                transition: 'all 140ms',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

window.TweaksPanel = TweaksPanel;

// ════════════════════════════════════════════════════════════════════════════
// components/QRDialog.js
// ════════════════════════════════════════════════════════════════════════════

// QR Code 彈窗 - 使用 qrserver.com 生成 QR (免授權、簡單圖片)
// 為了離線可用，也提供純 SVG 備用 (手繪棋盤格的樣子，純為示意)
function QRDialog({ url, onClose, accent }) {
  const [copied, setCopied] = React.useState(false);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=${encodeURIComponent(url)}&color=e8ecf1&bgcolor=131820`;

  const copy = () => {
    navigator.clipboard && navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 3000, backdropFilter: 'blur(6px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1a2029', border: '1px solid #2a3340',
        borderRadius: 18, padding: 28, width: 420,
        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 10, color: 'var(--muted)',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 2, fontWeight: 700, marginBottom: 4,
        }}>JOIN AS PLAYER</div>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>
          掃描加入活動
        </h2>
        <p style={{
          margin: '0 0 20px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6,
        }}>
          球員掃描後輸入名字即可看到排點。不會看到等級、也無法控制排點。
        </p>

        <div style={{
          background: '#131820', border: `1px solid ${accent}33`,
          borderRadius: 14, padding: 18,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          marginBottom: 16,
        }}>
          <img
            src={qrSrc}
            alt="QR Code"
            width="280" height="280"
            style={{ display: 'block', borderRadius: 6 }}
            onError={(e) => {
              // fallback: 畫格狀 placeholder
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'block';
            }}
          />
          <div style={{ display: 'none', color: 'var(--muted)', fontSize: 12 }}>
            無法載入 QR，請使用下方連結
          </div>
        </div>

        <div style={{
          display: 'flex', gap: 8, marginBottom: 12,
        }}>
          <input
            readOnly value={url}
            onFocus={(e) => e.target.select()}
            style={{
              flex: 1, background: '#0d1218', border: '1px solid #2a3340',
              borderRadius: 8, padding: '9px 12px',
              color: 'var(--text)', fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
              outline: 'none',
            }}
          />
          <button onClick={copy} style={{
            background: copied ? accent : 'transparent',
            border: `1px solid ${copied ? accent : '#2a3340'}`,
            color: copied ? '#0a1a10' : 'var(--text)',
            borderRadius: 8, padding: '0 14px',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            fontFamily: "'Noto Sans TC', sans-serif",
            transition: 'all 140ms',
          }}>
            {copied ? '已複製 ✓' : '複製'}
          </button>
        </div>

        <button onClick={onClose} style={{
          width: '100%',
          background: 'transparent', color: 'var(--muted)',
          border: '1px solid #2a3340', borderRadius: 8,
          padding: '10px', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', fontFamily: "'Noto Sans TC', sans-serif",
        }}>關閉</button>
      </div>
    </div>
  );
}

window.QRDialog = QRDialog;

// ════════════════════════════════════════════════════════════════════════════
// Firebase 資料層
// ════════════════════════════════════════════════════════════════════════════
var FIREBASE_URL = 'https://badmintion-ranking-default-rtdb.asia-southeast1.firebasedatabase.app/badminton';

function fbGet(path) {
  return fetch(FIREBASE_URL + path + '.json')
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });
}

// 寫入必須帶上登入者的 ID Token，配合 Firebase 安全規則擋下未登入的篡改
function fbPut(path, data) {
  var token = window.__AUTH_TOKEN__;
  var url = FIREBASE_URL + path + '.json' + (token ? '?auth=' + token : '');
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(function() {});
}

function loadData()           { return fbGet(''); }
function savePlayers(list)    { fbPut('/players', list); }
function saveRoundNumbers(rn) { fbPut('/roundNumbers', rn); }

function saveCurrentMatch(match) {
  var c1 = (match.courts && match.courts[0]) || { team1: [], team2: [] };
  var c2 = (match.courts && match.courts[1]) || { team1: [], team2: [] };
  fbPut('/currentMatch', match);
  fbPut('/court1', c1);
  fbPut('/court2', c2);
}

// ════════════════════════════════════════════════════════════════════════════
// PasswordOverlay
// ════════════════════════════════════════════════════════════════════════════
function PasswordOverlay({ accent }) {
  const [email, setEmail] = React.useState('');
  const [input, setInput] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // ── Firebase Authentication 登入（帳號密碼不再寫在前端）─────────────
  const check = () => {
    if (busy) return;
    if (!email.trim() || !input) { setError('請輸入帳號與密碼'); return; }
    setBusy(true);
    setError('');
    firebase.auth().signInWithEmailAndPassword(email.trim(), input)
      .then(function() {
        // 登入成功後由 onAuthStateChanged 接手，此處不需額外處理
        setBusy(false);
      })
      .catch(function(err) {
        setBusy(false);
        setInput('');
        var msg = '登入失敗，請再試一次';
        if (err && err.code === 'auth/invalid-email') msg = '帳號格式不正確';
        else if (err && (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')) msg = '帳號或密碼錯誤';
        else if (err && err.code === 'auth/user-not-found') msg = '找不到此帳號';
        else if (err && err.code === 'auth/too-many-requests') msg = '嘗試次數過多，請稍後再試';
        setError(msg);
        setTimeout(function() { setError(''); }, 3000);
      });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'radial-gradient(ellipse at center, #1a2533 0%, #0c1016 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, backdropFilter: 'blur(10px)',
    }}>
      <div style={{
        width: '100%', maxWidth: 360, textAlign: 'center',
        background: '#1a2029', border: `1px solid ${error ? '#ef4444' : 'var(--line)'}`,
        borderRadius: 20, padding: '40px 30px',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
        transition: 'all 200ms',
        transform: error ? 'translateX(10px)' : 'none',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, background: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px', fontSize: 24, color: '#0a1a10',
        }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>管理員登入</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 24px' }}>請以管理員帳號登入以開啟排點功能</p>

        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && check()}
          placeholder="管理員帳號 (Email)"
          style={{
            width: '100%', background: '#0c1016', border: '1px solid #2a3340',
            borderRadius: 10, padding: '12px 16px', color: '#fff',
            fontSize: 14, textAlign: 'center',
            outline: 'none', marginBottom: 10,
          }}
        />

        <input
          type="password"
          autoComplete="current-password"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && check()}
          placeholder="••••••••"
          style={{
            width: '100%', background: '#0c1016', border: '1px solid #2a3340',
            borderRadius: 10, padding: '12px 16px', color: '#fff',
            fontSize: 18, textAlign: 'center', letterSpacing: 4,
            outline: 'none', marginBottom: 16,
          }}
        />

        <button
          onClick={check}
          disabled={busy}
          style={{
            width: '100%', background: busy ? accent + '66' : accent, border: 'none',
            color: '#0a1a10', borderRadius: 10, padding: '12px',
            fontSize: 14, fontWeight: 800, cursor: busy ? 'wait' : 'pointer',
          }}
        >{busy ? '登入中…' : '登入'}</button>

        {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 12, fontWeight: 600 }}>{error}</div>}
        
        <div style={{ marginTop: 24 }}>
          <a href="?player" style={{ color: 'var(--dim)', fontSize: 12, textDecoration: 'none' }}>我是球員，切換至唯讀模式</a>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// App
// ════════════════════════════════════════════════════════════════════════════
function App() {
  // ── 認證狀態：完全交給 Firebase Auth，不再自行用 localStorage 記錄 ─────
  const [authenticated, setAuthenticated] = React.useState(false);
  const [authReady, setAuthReady] = React.useState(false);

  React.useEffect(function() {
    return firebase.auth().onAuthStateChanged(function(user) {
      if (user) {
        user.getIdToken().then(function(t) {
          window.__AUTH_TOKEN__ = t;
          setAuthenticated(true);
          setAuthReady(true);
        });
      } else {
        window.__AUTH_TOKEN__ = null;
        setAuthenticated(false);
        setAuthReady(true);
      }
    });
  }, []);

  // ID Token 有效期約 1 小時，每 30 分鐘主動更新，避免排點到一半寫入失敗
  React.useEffect(function() {
    if (!authenticated) return;
    var t = setInterval(function() {
      var u = firebase.auth().currentUser;
      if (u) u.getIdToken(true).then(function(tok) { window.__AUTH_TOKEN__ = tok; });
    }, 30 * 60 * 1000);
    return function() { clearInterval(t); };
  }, [authenticated]);

  function handleLogout() {
    firebase.auth().signOut();
  }

  var [tweaks, setTweaks] = React.useState(function() {
    var t = window.__TWEAKS__ || {};
    return { theme: t.theme || 'minimal', accent: t.accent || '#8ff3b5', myName: t.myName || '' };
  });
  var [showTweaks, setShowTweaks] = React.useState(false);

  // ── 角色判斷：URL 含 ?player 參數即為球員模式 ────────────────────────────
  var role = React.useMemo(function() {
    var p = new URLSearchParams(window.location.search);
    return p.has('player') ? 'player' : 'admin';
  }, []);

  const isAdmin = role === 'admin';
  const showLock = isAdmin && authReady && !authenticated;

  // ── 內部工具：將 courts 陣列轉成 match 物件，呼叫三個儲存函式 ────────────
  function saveToStorage(pList, cList, rNums) {
    var onIds = new Set();
    cList.forEach(function(c) {
      (c.teamA || []).concat(c.teamB || []).filter(Boolean).forEach(function(p) { onIds.add(p.id); });
    });
    var match = {
      courts: cList.map(function(c) {
        return {
          team1: (c.teamA || []).filter(Boolean).map(function(p) { return p.id; }),
          team2: (c.teamB || []).filter(Boolean).map(function(p) { return p.id; }),
        };
      }),
      bench: pList.filter(function(p) { return !onIds.has(p.id); }).map(function(p) { return p.id; }),
    };
    savePlayers(pList);
    saveCurrentMatch(match);
    saveRoundNumbers(rNums);
  }

  function resultToCourts(result, pMap) {
    return result.courts.map(function(c) {
      return {
        teamA: c.team1.map(function(id) { return pMap[id]; }).filter(Boolean),
        teamB: c.team2.map(function(id) { return pMap[id]; }).filter(Boolean),
      };
    });
  }

  // ── State（初始值：球員空、兩個空場地）───────────────────────────────────
  var EMPTY_COURTS = [{ teamA: [], teamB: [] }, { teamA: [], teamB: [] }];

  var [players, setPlayers] = React.useState([]);
  var [roundNumbers, setRoundNumbers] = React.useState([1, 1]);
  var [courts, setCourts] = React.useState(EMPTY_COURTS);
  var [animatingCourts, setAnimatingCourts] = React.useState([false, false]);
  var [animKeys, setAnimKeys] = React.useState([0, 0]);
  var [meId, setMeId] = React.useState(null);

  // joined: admin = true（直接進入），player = null（載入中）→ false（顯示輸入畫面）→ true
  var [joined, setJoined] = React.useState(role !== 'player' ? true : null);

  var [qrOpen, setQROpen] = React.useState(false);
  // isPortrait 其實是「compact 堆疊版面」開關：直向手機/平板，或「矮螢幕」(手機橫向 <480px)。
  // 加 max-height:480px 是為了讓手機橫向也用堆疊版面（平板橫向高度 768px+ 不受影響）。
  var COMPACT_MQ = '(max-width: 1180px) and (orientation: portrait), (max-height: 480px)';
  var [isPortrait, setIsPortrait] = React.useState(function() {
    return typeof window !== 'undefined' && window.matchMedia(COMPACT_MQ).matches;
  });

  React.useEffect(function() {
    var mq = window.matchMedia(COMPACT_MQ);
    var on = function() { setIsPortrait(mq.matches); };
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return function() { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on); };
  }, []);

  // ── 啟動時從 Firebase 載入資料 ───────────────────────────────────────────
  React.useEffect(function() {
    loadData().then(function(data) {
      var pArr = (data && Array.isArray(data.players))
        ? data.players.map(window.normalizePlayer)
        : [];
      var pMap = {};
      pArr.forEach(function(p) { pMap[p.id] = p; });

      setPlayers(pArr);

      if (data && data.roundNumbers) setRoundNumbers(data.roundNumbers);

      if (data && data.currentMatch && Array.isArray(data.currentMatch.courts)) {
        var loadedCourts = data.currentMatch.courts.map(function(c) {
          return {
            teamA: (c.team1 || []).map(function(id) { return pMap[id]; }).filter(Boolean),
            teamB: (c.team2 || []).map(function(id) { return pMap[id]; }).filter(Boolean),
          };
        });
        // 確保固定兩個場地
        while (loadedCourts.length < 2) loadedCourts.push({ teamA: [], teamB: [] });
        setCourts(loadedCourts.slice(0, 2));
        // 遷移：將 currentMatch 同步寫入 /court1、/court2，確保球員端能讀到
        if (role === 'admin') saveCurrentMatch(data.currentMatch);
      }
      // 無 currentMatch 時保持預設兩個空場地，不自動排程

      // 球員模式：確認 sessionStorage 姓名是否已在名單
      if (role === 'player') {
        var savedName = sessionStorage.getItem('badminton_myName');
        if (savedName) {
          var found = pArr.find(function(p) { return p.name === savedName; });
          if (found) {
            setMeId(found.id);
            setJoined(true);
            return;
          }
        }
        setJoined(false);
      }
    });
  }, []); // 只在 mount 時執行一次

  // ── 球員加入網址 ────────────────────────────────────────────────────────
  // 從管理者目前所在的網址自動推導（同一個部署 + ?player），
  // 不再寫死舊網址；日後換網域 / 路徑也不用改程式，QR 永遠指向現在這一版。
  var playerUrl = React.useMemo(function() {
    return window.location.origin + window.location.pathname + '?player';
  }, []);

  React.useEffect(function() {
    var handler = function(e) {
      if (!e.data || !e.data.type) return;
      if (e.data.type === '__activate_edit_mode') setShowTweaks(true);
      if (e.data.type === '__deactivate_edit_mode') setShowTweaks(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return function() { window.removeEventListener('message', handler); };
  }, []);

  function updateTweaks(partial) {
    var next = Object.assign({}, tweaks, partial);
    setTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: partial }, '*');
  }

  var onCourtIds = React.useMemo(function() {
    var s = new Set();
    courts.forEach(function(c) {
      (c.teamA || []).concat(c.teamB || []).filter(Boolean).forEach(function(p) { s.add(p.id); });
    });
    return s;
  }, [courts]);

  // ── 管理者模式：每 3 秒讀取 /players 更新名單 ────────────────────────────
  React.useEffect(function() {
    if (role !== 'admin') return;
    var interval = setInterval(function() {
      fbGet('/players').then(function(data) {
        if (Array.isArray(data)) setPlayers(data.map(window.normalizePlayer));
      });
    }, 3000);
    return function() { clearInterval(interval); };
  }, [role]);

  // ── 球員模式：立刻讀取一次，之後每 2 秒輪詢 ─────────────────────────────
  React.useEffect(function() {
    if (role !== 'player' || !joined) return;

    function poll() {
      return Promise.all([
        fbGet('/players'),
        fbGet('/court1'),
        fbGet('/court2'),
        fbGet('/roundNumbers'),
      ]).then(function(res) {
        var pArr = Array.isArray(res[0]) ? res[0].map(window.normalizePlayer) : [];
        var pMap = {};
        pArr.forEach(function(p) { pMap[p.id] = p; });
        setPlayers(pArr);

        function toCourtObj(c) {
          if (!c) return { teamA: [], teamB: [] };
          return {
            teamA: (c.team1 || []).map(function(id) { return pMap[id]; }).filter(Boolean),
            teamB: (c.team2 || []).map(function(id) { return pMap[id]; }).filter(Boolean),
          };
        }
        setCourts([toCourtObj(res[1]), toCourtObj(res[2])]);
        if (Array.isArray(res[3])) setRoundNumbers(res[3]);
      });
    }

    poll();
    var interval = setInterval(poll, 2000);
    return function() { clearInterval(interval); };
  }, [role, joined]);

  // ── 「下一場」：各球場獨立排程 ──────────────────────────────────────────
  function handleNextCourt(courtIdx) {
    if (role !== 'admin') return;
    if (animatingCourts[courtIdx]) return;

    setAnimatingCourts(function(prev) {
      var next = prev.slice(); next[courtIdx] = true; return next;
    });

    setTimeout(function() {
      var thisCourt = courts[courtIdx] || { teamA: [], teamB: [] };

      var thisCourtIds = new Set();
      (thisCourt.teamA || []).concat(thisCourt.teamB || []).filter(Boolean).forEach(function(p) {
        thisCourtIds.add(p.id);
      });

      var otherCourtIds = new Set();
      for (var i = 0; i < courts.length; i++) {
        if (i === courtIdx) continue;
        (courts[i].teamA || []).concat(courts[i].teamB || []).filter(Boolean).forEach(function(p) {
          otherCourtIds.add(p.id);
        });
      }

      var updatedPlayers = players.map(function(p) {
        if (otherCourtIds.has(p.id)) return p;
        if (!thisCourtIds.has(p.id)) return Object.assign({}, p, { consecutiveGames: 0 });

        var inA = (thisCourt.teamA || []).some(function(m) { return m && m.id === p.id; });
        var myTeam = inA ? thisCourt.teamA : thisCourt.teamB;
        var oppTeam = inA ? thisCourt.teamB : thisCourt.teamA;
        var teammates = (myTeam || []).filter(function(m) { return m && m.id !== p.id; });
        var opps = (oppTeam || []).filter(Boolean);

        var newPartners = Object.assign({}, p.partners);
        teammates.forEach(function(t) { newPartners[t.id] = (newPartners[t.id] || 0) + 1; });
        var newOpponents = Object.assign({}, p.opponents);
        opps.forEach(function(o) { newOpponents[o.id] = (newOpponents[o.id] || 0) + 1; });

        return Object.assign({}, p, {
          games: (p.games || 0) + 1,
          consecutiveGames: (p.consecutiveGames || 0) + 1,
          partners: newPartners,
          opponents: newOpponents,
        });
      });

      // 只有「已報到」的球員能進入排點候選（未報到者不參與）
      var availablePool = updatedPlayers.filter(function(p) {
        return !otherCourtIds.has(p.id) && p.checkedIn;
      });

      var pMap = {};
      updatedPlayers.forEach(function(p) { pMap[p.id] = p; });

      var result = window.scheduleNextRound(availablePool, { numCourts: 1 });

      var newCourtData;
      if (result.courts.length > 0) {
        var c = result.courts[0];
        newCourtData = {
          teamA: c.team1.map(function(id) { return pMap[id]; }).filter(Boolean),
          teamB: c.team2.map(function(id) { return pMap[id]; }).filter(Boolean),
        };
      } else {
        newCourtData = { teamA: [], teamB: [] };
      }

      var newCourts = courts.map(function(c, i) {
        return i === courtIdx ? newCourtData : c;
      });

      var newRoundNumbers = roundNumbers.map(function(r, i) {
        return i === courtIdx ? r + 1 : r;
      });

      saveToStorage(updatedPlayers, newCourts, newRoundNumbers);
      setPlayers(updatedPlayers);
      setCourts(newCourts);
      setRoundNumbers(newRoundNumbers);
      setAnimKeys(function(keys) {
        var next = keys.slice(); next[courtIdx] = next[courtIdx] + 1; return next;
      });
      setTimeout(function() {
        setAnimatingCourts(function(prev) {
          var next = prev.slice(); next[courtIdx] = false; return next;
        });
      }, 520);
    }, 260);
  }

  // ── 重設：保留★球員、場地清空（兩個空場地）─────────────────────────────
  function handleReset() {
    if (role !== 'admin') return;
    if (!confirm('確定要重設？所有資料將清除。')) return;

    // 重設＝新的一場：保留★常客與季繳球員，但所有人都要重新報到／繳費
    var kept = players.filter(function(p) { return p.regular || p.seasonPass; }).map(function(p) {
      return Object.assign({}, p, { games: 0, consecutiveGames: 0, partners: {}, opponents: {}, checkedIn: false, paid: false });
    });

    var newCourts = [{ teamA: [], teamB: [] }, { teamA: [], teamB: [] }];
    var newRoundNumbers = [1, 1];
    saveToStorage(kept, newCourts, newRoundNumbers);
    setPlayers(kept);
    setCourts(newCourts);
    setRoundNumbers(newRoundNumbers);
    setAnimKeys([0, 0]);
  }

  // ── 球員管理 ──────────────────────────────────────────────────────────────
  function handleAddPlayer(name, level, pinned) {
    // 手動即時新增的球員視為已到場（checkedIn:true），繳費留給管理者另外標記
    var newP = window.normalizePlayer({ id: 'p-' + Date.now(), name: name, level: level, games: 0, pinned: !!pinned, regular: pinned === true, checkedIn: true, paid: false });
    var next = players.concat([newP]);
    setPlayers(next);
    saveToStorage(next, courts, roundNumbers);
  }

  // 批次匯入臨打球員：星號不亮（regular:false），重設時會被清除
  function handleImportPlayers(names, level) {
    var existing = {};
    players.forEach(function(p) { existing[p.name] = true; });
    var ts = Date.now();
    var added = [];
    names.forEach(function(nm, i) {
      if (existing[nm]) return;          // 防呆：略過已存在的名字
      existing[nm] = true;
      added.push(window.normalizePlayer({
        id: 'p-' + ts + '-' + i, name: nm, level: level || 6, games: 0,
        pinned: false, regular: false,
      }));
    });
    if (added.length === 0) return;
    var next = players.concat(added);
    setPlayers(next);
    saveToStorage(next, courts, roundNumbers);
  }

  // patch 可能是舊的純數字（等級）或新的 { level, games } 物件，兩者都相容
  function handleEditLevel(pid, patch) {
    var upd = (typeof patch === 'object' && patch !== null) ? patch : { level: patch };
    var next = players.map(function(p) { return p.id === pid ? Object.assign({}, p, upd) : p; });
    setPlayers(next);
    savePlayers(next);
  }

  function handleTogglePin(pid) {
    var next = players.map(function(p) { return p.id === pid ? Object.assign({}, p, { regular: !p.regular }) : p; });
    setPlayers(next);
    savePlayers(next);
  }

  // 報到／取消報到（在場上時不允許取消，避免把上場中的人踢出排點狀態）
  function handleToggleCheckIn(pid) {
    var p = players.find(function(x) { return x.id === pid; });
    if (!p) return;
    var nowIn = !p.checkedIn;
    if (!nowIn && onCourtIds.has(pid)) {
      alert('該球員正在場上，請先讓其下場再取消報到。');
      return;
    }
    var next = players.map(function(x) { return x.id === pid ? Object.assign({}, x, { checkedIn: nowIn }) : x; });
    setPlayers(next);
    savePlayers(next);
  }

  // 繳費／取消繳費（獨立狀態，不影響排點）
  function handleTogglePaid(pid) {
    var next = players.map(function(x) { return x.id === pid ? Object.assign({}, x, { paid: !x.paid }) : x; });
    setPlayers(next);
    savePlayers(next);
  }

  function handleDeletePlayer(pid) {
    if (onCourtIds.has(pid)) {
      alert('無法刪除上場中的球員，請先等對局結束。');
      return;
    }
    var next = players.filter(function(p) { return p.id !== pid; });
    setPlayers(next);
    savePlayers(next);
  }

  // ── 加入活動（球員模式）──────────────────────────────────────────────────
  function handleJoin(name) {
    sessionStorage.setItem('badminton_myName', name);
    // 先從 Firebase 取得最新球員清單，避免覆蓋其他人的資料
    fbGet('/players').then(function(current) {
      var pArr = Array.isArray(current) ? current.map(window.normalizePlayer) : [];
      var existing = pArr.find(function(p) { return p.name === name; });
      if (existing) {
        setPlayers(pArr);
        setMeId(existing.id);
        setJoined(true);
        return;
      }
      var myId = 'p-' + Date.now();
      var newMe = window.normalizePlayer({ id: myId, name: name, level: 6, games: 0, regular: false });
      var next = pArr.concat([newMe]);
      setPlayers(next);
      setMeId(myId);
      fbPut('/players', next).then(function() { setJoined(true); });
    }).catch(function() {
      setJoined(true);
    });
  }

  function handleSkip() { setJoined(true); }

  // 球員自助報到：從名單挑選自己的 id → 標記報到（可選同時繳費）→ 設為 me
  function handlePlayerCheckIn(pid, markPaid) {
    fbGet('/players').then(function(current) {
      var pArr = Array.isArray(current) ? current.map(window.normalizePlayer) : players;
      var found = pArr.find(function(p) { return p.id === pid; });
      if (!found) { pArr = players; found = players.find(function(p) { return p.id === pid; }); }
      var next = pArr.map(function(p) {
        return p.id === pid ? Object.assign({}, p, { checkedIn: true, paid: markPaid ? true : p.paid }) : p;
      });
      setPlayers(next);
      setMeId(pid);
      if (found && found.name) sessionStorage.setItem('badminton_myName', found.name);
      fbPut('/players', next).then(function() { setJoined(true); });
    }).catch(function() {
      var next = players.map(function(p) { return p.id === pid ? Object.assign({}, p, { checkedIn: true, paid: markPaid ? true : p.paid }) : p; });
      setPlayers(next); setMeId(pid); setJoined(true);
    });
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  React.useEffect(function() {
    window.__onDrop = function(src, dstType, dstCourtIdx, dstTeam, dstPos) {
      if (role !== 'admin') return;

      var pMap = {};
      players.forEach(function(p) { pMap[p.id] = p; });
      var srcPlayer = pMap[src.id];
      if (!srcPlayer) return;

      var next = courts.map(function(c) {
        var a = [c.teamA ? c.teamA[0] : undefined, c.teamA ? c.teamA[1] : undefined];
        var b = [c.teamB ? c.teamB[0] : undefined, c.teamB ? c.teamB[1] : undefined];
        return { teamA: a, teamB: b };
      });

      if (dstType === 'bench') {
        if (src.from === 'court' && next[src.courtIdx]) {
          var srcTk = src.team === 'A' ? 'teamA' : 'teamB';
          next[src.courtIdx][srcTk][src.pos] = undefined;
        }
      } else {
        if (!next[dstCourtIdx]) return;
        var dstTk = dstTeam === 'A' ? 'teamA' : 'teamB';
        var targetPlayer = next[dstCourtIdx][dstTk][dstPos];

        if (src.from === 'court' &&
            src.courtIdx === dstCourtIdx &&
            src.team === dstTeam &&
            src.pos === dstPos) return;

        next[dstCourtIdx][dstTk][dstPos] = srcPlayer;

        if (src.from === 'court' && next[src.courtIdx]) {
          var srcTk2 = src.team === 'A' ? 'teamA' : 'teamB';
          next[src.courtIdx][srcTk2][src.pos] = targetPlayer;
        }
      }

      setCourts(next);
      saveToStorage(players, next, roundNumbers);
    };

    // 拖曳引擎會回傳一個字串 key（例："court:0:A:1" 或 "bench"），這裡解析後轉發
    window.__onDropKey = function(src, key) {
      if (role !== 'admin' || !key) return;
      if (key === 'bench') {
        if (src.from === 'court') window.__onDrop(src, 'bench');
        return;
      }
      var parts = key.split(':');
      if (parts[0] !== 'court') return;
      window.__onDrop(src, 'court', parseInt(parts[1], 10), parts[2], parseInt(parts[3], 10));
    };

    return function() { window.__onDrop = null; window.__onDropKey = null; };
  }, [players, role, courts, roundNumbers]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (joined === null) {
    return (
      <div style={{
        height: '100vh', width: '100vw',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0c1016', color: 'var(--muted)',
        fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 1.5,
      }}>
        LOADING…
      </div>
    );
  }

  // 認證狀態尚未確認前不渲染，避免登入畫面閃一下
  if (isAdmin && !authReady) {
    return (
      <div style={{
        height: '100vh', width: '100vw',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0c1016', color: 'var(--muted)',
        fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 1.5,
      }}>
        AUTH…
      </div>
    );
  }

  if (showLock) {
    return (
      <React.Fragment>
        <PasswordOverlay accent={tweaks.accent} />
        <TweaksPanel state={tweaks} onChange={updateTweaks} show={showTweaks} />
      </React.Fragment>
    );
  }

  if (!joined) {
    return (
      <React.Fragment>
        <JoinScreen onJoin={handleJoin} onSkip={handleSkip} theme={tweaks.theme} accent={tweaks.accent} role={role} players={players} onCheckIn={handlePlayerCheckIn} />
        <TweaksPanel state={tweaks} onChange={updateTweaks} show={showTweaks} />
      </React.Fragment>
    );
  }

  return (
    <div style={{
      // 直向也用固定 100dvh：場地常駐上方、名單在下方自己捲動（不再整頁捲動）
      height: '100dvh',
      width: '100vw',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      background: tweaks.theme === 'minimal'
        ? '#0c1016'
        : 'radial-gradient(ellipse at 20% 0%, #1a2533 0%, #131820 60%, #0c1016 100%)',
    }}>
      <TopBar
        theme={tweaks.theme}
        accent={tweaks.accent}
        onReset={handleReset}
        onShowQR={function() { setQROpen(true); }}
        onLogout={handleLogout}
        role={role}
        eventInfo={{ day: 'TUE', time: '20:00-22:00', location: '南科新力羽球館' }}
      />

      <div style={{
        flex: 1, display: 'flex',
        flexDirection: isPortrait ? 'column' : 'row',
        minHeight: 0, minWidth: 0,
      }}>
        <main style={{
          // 直向：固定高度的「場地橫幅」，並排、常駐可見、不隨名單捲動
          width: isPortrait ? '100%' : '70%',
          height: isPortrait ? '40dvh' : '100%',
          flex: isPortrait ? '0 0 auto' : 'none',
          minWidth: 0, minHeight: 0,
          padding: isPortrait ? '10px 10px 4px' : '16px 18px',
          display: 'flex',
          flexDirection: 'row',
          gap: isPortrait ? 8 : 16,
        }}>
          {courts.map(function(c, i) {
            return (
              <div
                key={animKeys[i] + '-' + i}
                style={{
                  flex: 1,
                  display: 'flex',
                  minHeight: 0, minWidth: 0,
                  width: 'auto',
                  animation: animatingCourts[i]
                    ? 'fadeOut 260ms ease forwards'
                    : 'fadeIn 520ms cubic-bezier(.2,.8,.2,1) both',
                }}
              >
                <Court
                  index={i}
                  teamA={c.teamA}
                  teamB={c.teamB}
                  meId={meId}
                  theme={tweaks.theme}
                  accent={tweaks.accent}
                  round={roundNumbers[i]}
                  onNext={function() { handleNextCourt(i); }}
                  animating={animatingCourts[i]}
                  role={role}
                />
              </div>
            );
          })}
        </main>

        <Sidebar
          players={players}
          onCourtIds={onCourtIds}
          meId={meId}
          theme={tweaks.theme}
          accent={tweaks.accent}
          role={role}
          onEditLevel={handleEditLevel}
          onAddPlayer={handleAddPlayer}
          onImportPlayers={handleImportPlayers}
          onDeletePlayer={handleDeletePlayer}
          onTogglePin={handleTogglePin}
          onToggleCheckIn={handleToggleCheckIn}
          onTogglePaid={handleTogglePaid}
          isPortrait={isPortrait}
        />
      </div>

      <TweaksPanel state={tweaks} onChange={updateTweaks} show={showTweaks} />

      {qrOpen && <QRDialog url={playerUrl} onClose={function() { setQROpen(false); }} accent={tweaks.accent} />}

      <style>{`
        @keyframes fadeIn {
          0% { opacity: 0; transform: translateY(8px) scale(0.98); }
          100% { opacity: 1; transform: none; }
        }
        @keyframes fadeOut {
          0% { opacity: 1; }
          100% { opacity: 0.15; transform: scale(0.97); }
        }
        .player-slot:hover { transform: translateY(-2px) scale(1.02); }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a3340; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #3a4555; }
      `}</style>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
