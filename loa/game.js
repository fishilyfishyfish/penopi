// Lines of Action. The engine is LOA 튀르크's LoaEngine (engine.js, unchanged), loaded twice:
// on the page for the rules (legal moves, results), and in worker.js for thinking.
// Board drawing and the move doodles are LOA 튀르크's.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { gridSvg, overlay, hopPiece, trail, wipe } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';

// Think time: LOA 튀르크 took 5 s. Capped at 2.5 s so a phone answers within a few seconds;
// iterative deepening returns the best move found by then. Penopi also thinks on my time (ponder).
const THINK_MS = 2500, PONDER_MS = 700, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.LoaEngine({ ttBits: 8 });
const PASS = R.PASS, WIN = R.WIN, MATE = R.MATE_BOUND;
const sqName = (s) => 'abcdefgh'[s & 7] + (8 - (s >> 3));
const sideName = (p) => (p === 1 ? '흑' : '백');
const colorOf = (p) => (p === 1 ? 'b' : 'w');

let api, boardEl, sqEls = [];
let human = 1, moves = [], state = null, sel = -1, playing = false, g = 0;
let engine = null, ponder = null, humanNearSaid = false, engineNearSaid = false, loopFor = -1;
let localE = null;

// the game so far, replayed from the start: board, side to move, result
function replay() {
  R.setStart();
  const counts = new Map(), key = () => R.hash.join(',');
  counts.set(key(), 1);
  let over = false, winner = 0, passes = 0;
  for (const m of moves) {
    const side = R.stm;
    R.play(m);
    if (m === PASS) { if (++passes >= 2) { over = true; break; } }
    else {
      passes = 0;
      const r = R.resultAfter(side, (m & 4096) !== 0);
      if (r === 1) { over = true; winner = side; break; }
      if (r === -1) { over = true; winner = 3 - side; break; }
      if (r === 2) { over = true; break; }
    }
    const k = key(), c = (counts.get(k) || 0) + 1; counts.set(k, c);
    if (c >= 3) { over = true; break; }
  }
  const b = Array.from(R.board), won = [];
  if (winner) for (let s = 0; s < 64; s++) if (b[s] === winner) won.push(s);
  return { b, stm: R.stm, over, winner, won, legal: over ? [] : R.legalMoves(), last: moves.length ? moves[moves.length - 1] : -1,
           groups: (p) => R._label(p) };
}

// ---------- thinking ----------
function client() {
  if (!engine) engine = workerClient(new URL('./worker.js', import.meta.url), { type: 'classic' });
  return engine;
}
async function think(time) {
  try {
    return await client().call({ moves: moves.slice(), time }, { timeout: HARD_LIMIT });
  } catch (err) {
    if (/다시 시작/.test(err.message)) return null; // stopped on purpose (new game)
    if (!(err instanceof TimeoutError)) console.warn(err);
    // no worker, or it hung: think on the page for a moment (the page pauses meanwhile)
    if (!localE) { localE = globalThis.LoaEngine({ ttBits: 16 }); localE.setWeights(globalThis.TUNED_WEIGHTS); }
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600), keepHistory: true });
  }
}
// on my time: short slices in a row so the engine's tables stay warm, until I move
function startPonder() {
  const my = g, ply = moves.length;
  ponder = (async () => {
    while (my === g && playing && moves.length === ply && !state.over && state.stm === human) {
      if (!(await think(PONDER_MS))) break;
    }
  })();
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorOf(3 - human) });
  render();
  if (ponder) await ponder;
  if (my !== g) return;
  if (!state.legal.length) { commit(PASS, null); return; }
  const t0 = Date.now();
  const info = await think(THINK_MS);
  if (my !== g || !info) return;
  if (Date.now() - t0 < 400) await new Promise((r) => setTimeout(r, 400)); // an instant answer looks like a glitch
  if (my !== g) return;
  let m = info.move;
  if (m !== PASS && !state.legal.includes(m)) m = state.legal[0];
  commit(m, info);
}

// ---------- moves ----------
function commit(m, info) {
  const mover = state.stm, taken = m !== PASS && (m & 4096) ? state.b[(m >> 6) & 63] : 0;
  moves.push(m); sel = -1;
  if (taken) scribble((m >> 6) & 63, taken);
  state = replay();
  render(m === PASS ? -1 : m & 63, m === PASS ? -1 : (m >> 6) & 63);
  if (mover === human) humanTalk(m); else engineTalk(m, info);
  if (taken && mover !== human) api.runTo((((m >> 6) & 63 & 7) + 0.5) / 8); // runs over to the column it captured in
  next();
}
function next() {
  if (!playing) return;
  if (state.over) { finish(); return; }
  if (state.stm === human) {
    if (!state.legal.length) { setTimeout(() => commit(PASS), 600); return; }
    api.yourTurn({ color: colorOf(human), label: sideName(human) });
    startPonder();
  } else engineMove();
  render();
}
function humanTalk(m) {
  if (state.over) return;
  const facts = [];
  if (m === PASS) facts.push(['humanPass']);
  else if (m & 4096) facts.push(['humanCap']);
  else if (!humanNearSaid && state.groups(human) === 2) { humanNearSaid = true; facts.push(['humanNear']); }
  api.humanMoved({ facts, plies: moves.length });
}
function engineTalk(m, info) {
  if (state.over) return;
  if (m === PASS) { api.thinking(false); api.say('enginePass'); return; }
  const sc = info.score;
  const facts = [];
  if (m & 4096) facts.push(['engineCap']);
  else if (!engineNearSaid && state.groups(3 - human) === 2) { engineNearSaid = true; facts.push(['engineNear']); }
  api.engineMoved({
    p: 1 / (1 + Math.exp(-sc / 300)),
    mate: sc >= MATE ? Math.ceil((WIN - sc) / 2) - 1 : 0, // engine moves still needed after this one
    doomed: sc <= -MATE,
    nodes: info.nodes, depth: info.depth,
    facts,
  });
}
function finish() {
  playing = false;
  const st = state, chip = (p) => api.chip(colorOf(p));
  if (!st.winner) { api.over({ winner: 'draw' }); return; }
  const mine = st.winner === human, groups = st.groups(human);
  api.over({
    winner: mine ? 'human' : 'penopi',
    vars: { n: Math.ceil(moves.length / 2), g: groups },
    key: !mine && groups > 1 && Math.random() < 0.15 ? 'engineWinGroups' : undefined,
    text: `${chip(st.winner)}${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
}

function onSquare(s) {
  if (!playing || state.over || state.stm !== human) return;
  if (sel >= 0) {
    const m = state.legal.find((x) => (x & 63) === sel && ((x >> 6) & 63) === s);
    if (m !== undefined) { commit(m); return; }
    sel = state.b[s] === human && state.legal.some((x) => (x & 63) === s) ? s : -1;
    render(); if (sel >= 0) peek(sel); return;
  }
  if (state.b[s] === human && state.legal.some((x) => (x & 63) === s)) { sel = s; render(); peek(s); }
}
let peekPly = -1;
function peek(s) {
  api.peek(((s & 7) + 0.5) / 8, peekPly !== moves.length);
  peekPly = moves.length;
}

// ---------- drawing ----------
function build() {
  boardEl.setAttribute('role', 'grid');
  for (let s = 0; s < 64; s++) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sq' + (((s >> 3) + (s & 7)) % 2 ? ' dk' : '');
    el.addEventListener('click', () => onSquare(s));
    boardEl.appendChild(el); sqEls.push(el);
  }
  boardEl.insertAdjacentHTML('beforeend', gridSvg(8));
}
function render(animFrom = -1, animTo = -1) {
  const st = state, targets = new Map();
  if (sel >= 0) for (const m of st.legal) if ((m & 63) === sel) targets.set((m >> 6) & 63, (m & 4096) !== 0);
  const real = st.last >= 0 && st.last !== PASS;
  const lf = real ? st.last & 63 : -1, lt = real ? (st.last >> 6) & 63 : -1;
  for (let s = 0; s < 64; s++) {
    const el = sqEls[s], p = st.b[s];
    el.classList.toggle('last', s === lf || s === lt);
    el.classList.toggle('sel', s === sel);
    let h = p ? `<span class="piece ${colorOf(p)}" style="rotate:${(s * 47) % 31 - 15}deg;--d:${((s & 7) + (s >> 3)) * 28}ms"></span>` : '';
    if (targets.has(s)) h += targets.get(s) ? '<span class="ring"></span>' : '<span class="dot"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.setAttribute('aria-label', sqName(s) + (p ? (p === 1 ? ' 흑' : ' 백') : ' 빈칸') + (targets.has(s) ? ', 여기로 이동 가능' : ''));
  }
  boardEl.classList.toggle('drawn', st.over && !st.winner);
  if (st.over && st.winner && loopFor !== g) { // once per game, after the last move has landed
    loopFor = g;
    const my = g, won = st.won.slice();
    setTimeout(() => { if (my === g) drawLoop(won); }, reduced() ? 0 : 500);
  }
  if (animFrom >= 0 && animTo >= 0 && !reduced()) {
    hopPiece(sqEls[animTo].querySelector('.piece'), sqEls[animFrom], sqEls[animTo]);
    trail(boardEl, 8, centre(animFrom), centre(animTo));
  }
}
const centre = (s) => [(s & 7) * 100 + 50, (s >> 3) * 100 + 50];
// a captured piece is scribbled out with the pen and fades before the mover lands on it
function scribble(s, colour) {
  if (reduced()) return;
  const el = document.createElement('div');
  el.className = 'ghost ' + colorOf(colour);
  el.style.left = (s & 7) * 12.5 + '%'; el.style.top = (s >> 3) * 12.5 + '%';
  el.innerHTML = `<span class="piece ${colorOf(colour)}"></span><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>`;
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
// a hand-drawn loop around the winning group: a rounded hull of the squares, wobbled a little,
// that runs past its starting point the way a quick pen circle does
function drawLoop(squares) {
  const jit = (k) => (Math.random() - 0.5) * k, pts = [];
  for (const s of squares) {
    const [cx, cy] = centre(s);
    for (let a = 0; a < 12; a++) pts.push([cx + Math.cos(a * Math.PI / 6) * 50, cy + Math.sin(a * Math.PI / 6) * 50]);
  }
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const half = (list) => { const h = []; for (const p of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
  let hull = half(pts).concat(half(pts.slice().reverse()));
  const seg = hull.map((p, i) => Math.hypot(hull[(i + 1) % hull.length][0] - p[0], hull[(i + 1) % hull.length][1] - p[1]));
  const total = seg.reduce((x, y) => x + y, 0), even = [];
  for (let k = 0, i = 0, acc = 0; k < 16; k++) {
    const want = (k / 16) * total;
    while (acc + seg[i] < want) acc += seg[i++];
    const t = (want - acc) / seg[i], p = hull[i], q = hull[(i + 1) % hull.length];
    even.push([p[0] + (q[0] - p[0]) * t + jit(8), p[1] + (q[1] - p[1]) * t + jit(8)]);
  }
  hull = even;
  const n = hull.length, run = hull.concat([0, 1, 2].map((i) => [hull[i % n][0] + jit(14), hull[i % n][1] + jit(14)]));
  const at = (i) => run[Math.max(0, Math.min(run.length - 1, i))];
  let d = `M${run[0][0].toFixed(1)} ${run[0][1].toFixed(1)}`;
  for (let i = 0; i < run.length - 1; i++) { // Catmull-Rom through the points
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1.map((v) => v.toFixed(1)).join(' ')} ${c2.map((v) => v.toFixed(1)).join(' ')} ${p2.map((v) => v.toFixed(1)).join(' ')}`;
  }
  const svg = overlay('win-loop', 8);
  svg.innerHTML = `<path pathLength="1" vector-effect="non-scaling-stroke" d="${d}"/>`;
  boardEl.appendChild(svg);
}
const clearDoodles = () => { for (const e of boardEl.querySelectorAll('.win-loop, .trail, .ghost')) e.remove(); };

function stopThinking() {
  g++;
  if (engine) engine.restart(); // don't wait out a think
  ponder = null;
}

export default {
  id: 'loa',
  name: 'LOA',
  legacyRecord: 'turk-record', // LOA 튀르크's record on this same site, taken over once
  sides: [
    { id: 1, first: true, html: '<span class="chip b"></span>흑 · 선공' },
    { id: 2, first: false, html: '<span class="chip w"></span>백 · 후공' },
  ],
  lines: LINES,
  chat: ['chatLoa'],
  longGame: 60,
  rules: {
    html: `
    <li><b>내 말을 전부 한 덩어리로 이으면 이긴다.</b> 가로, 세로, 대각선으로 붙어 있으면 이어진 거야.
      <span class="aside">목표는 잇는 거야. 잡는 게 아니고.</span></li>
    <li><b>가로, 세로, 대각선으로 움직인다. 몇 칸 갈지는 그 줄에 놓인 말 수로 정해진다.</b> 내 말, 상대 말 다 센다.
      <svg viewBox="0 0 400 96" aria-label="말이 3개 있는 줄에서 흑돌이 3칸 가는 그림">
        <g fill="none" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round">
          <path d="M2 40 H398 M2 90 H398"/><path d="M2 40 V90 M52 40 V90 M102 40 V90 M152 40 V90 M202 40 V90 M252 40 V90 M302 40 V90 M352 40 V90 M398 40 V90"/>
          <path d="M28 34 Q102 -4 172 30" stroke="#d8452f" stroke-width="2.6"/><path d="M160 22 L174 32 L158 36" stroke="#d8452f" stroke-width="2.6"/>
          <circle cx="177" cy="65" r="16" stroke="#d8452f" stroke-dasharray="5 5"/>
          <circle cx="327" cy="65" r="17" fill="#fdfdfb" stroke-width="2.6"/>
        </g>
        <circle cx="27" cy="65" r="18" fill="#1b1b1b"/><circle cx="127" cy="65" r="18" fill="#1b1b1b"/>
      </svg>
      <span class="aside">이 줄엔 흑 둘, 백 하나로 말이 3개. 그러니까 3칸. 말로 하면 못 알아들을 것 같아서 그렸어.</span></li>
    <li><b>내 말은 넘어가도 되고, 상대 말은 못 넘는다.</b>
      <span class="aside">위 그림에서 흑돌이 자기 편을 넘어간 거 봤지?</span></li>
    <li><b>상대 말이 있는 칸에 멈추면 잡는다.</b>
      <span class="aside">근데 잡으면 상대 말이 줄어서 걔가 잇기 쉬워져. 알아서 해.</span></li>
    <li><b>흑이 먼저 둔다.</b> 둘 데가 없으면 차례를 넘긴다.
      <span class="aside">너한테 자주 일어날 일이야.</span></li>
    <li><b>무승부:</b> 한 수로 둘 다 동시에 이어지거나, 같은 국면이 같은 차례로 세 번 나오면.
      <span class="aside">나랑 비기는 것도 쉽지 않아.</span></li>`,
  },
  debug: () => ({ legal: state.legal.slice(), stm: state.stm, human, over: state.over, playing, plies: moves.length }),
  mount(a) {
    api = a; boardEl = a.board;
    build();
    state = replay();
    render();
  },
  start(side) {
    stopThinking();
    human = side; moves = []; sel = -1; playing = true;
    humanNearSaid = engineNearSaid = false;
    clearDoodles();
    boardEl.setAttribute('aria-label', 'LOA 판, 나는 ' + sideName(side));
    state = replay();
    render();
    next();
  },
  reset() {
    stopThinking();
    const had = moves.length > 0;
    playing = false; moves = []; sel = -1;
    state = replay();
    if (had && !reduced()) wipe(boardEl, 8, () => { clearDoodles(); render(); });
    else { clearDoodles(); render(); }
  },
};
