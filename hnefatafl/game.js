// Hnefatafl (the Viking board game). The engine (engine.js) was written for this site: alpha-beta search in plain JS,
// loaded twice, on the page for the rules and in worker.js for thinking (the arrangement breakthrough/ uses).
// Board and doodles follow the other square boards: a hand-drawn grid, pencil trails, scribbled captures.
import { LINES } from './lines.js';
import { MOVE_FIGS, CAPTURE_FIGS, KING_FIGS } from './figures.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { easePlan, easeLevel } from '../shared/ease.js';
import { gridSvg, hopPiece, trail, wipe } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.HnefataflEngine({ ttBits: 8, size: 7 });
const WIN = R.WIN, BOUND = R.WIN_BOUND;
const sideName = (p) => (p === 1 ? '공격' : '수비');
const classOf = (p) => (p === 1 ? 'a' : p === 2 ? 'd' : 'k');
const chipOf = (side) => (side === 1 ? 'b' : 'w');
const CROWN = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M9 29 L7 13 L15 20 L20 9 L25 20 L33 13 L31 29 Z M10 33 H30"/></svg>';

let api, boardEl, sqEls = [], n = 7;
let human = 1, moves = [], state = null, sel = -1, playing = false, g = 0, optSize = '7';
let engine = null, localE = null, edgeSaid = { h: false, e: false }, boxedSaid = false;

function replay() {
  R.setStart(n);
  for (const m of moves) R.play(m);
  const res = R.result();
  return { b: Array.from(R.board).slice(0, n * n), stm: R.stm, over: res !== 0, result: res, legal: res ? [] : R.legalMoves(), king: R.kingSq,
    escapes: R.kingEscapes(), caps: R.lastCaptured(), last: moves.length ? moves[moves.length - 1] : -1 };
}

// ---------- thinking ----------
function client() {
  if (!engine) engine = workerClient(new URL('./worker.js', import.meta.url), { type: 'classic' });
  return engine;
}
// The defenders have the easier game: engine against engine at the same strength the attackers won 29% (7×7) and
// 16% (11×11, most of the rest draws), and no weight of the evaluation moved that by more than the noise. So when
// Penopi defends it looks less deep and slips now and then (shared/slip.js), at every 봐주기 level, by the amount that
// brought engine-vs-engine games back to about even (tools/arena-hnefatafl.mjs; numbers in CLAUDE.md).
// [size][level]: depth cap, slip chance and margin, shallow = chance of one move less deep. Attacking Penopi uses
// the full engine (level 0) or PLANS.hnefatafl of shared/ease.js.
const DEF_PLANS = {
  7: [{ depth: 4, slip: 0.3, margin: 150 }, { ms: 300, depth: 2, slip: 0.3, margin: 250 }, { ms: 150, depth: 2, shallow: 0.3 }],
  11: [{ depth: 3, slip: 0.3, margin: 150 }, { ms: 300, depth: 2, slip: 0.3, margin: 250 }, null],
};
function plan(time) {
  const lv = Number(easeLevel()) || 0, p = human === 1 ? (DEF_PLANS[n] || DEF_PLANS[7])[lv] : null;
  if (!p) return easePlan('hnefatafl', time); // 봐주기 (shared/ease.js): attacking Penopi, or the plan of shared/ease.js
  const o = { time: p.ms ? Math.min(time, p.ms) : time, depth: p.depth };
  if (p.shallow && Math.random() < p.shallow) o.depth--;
  if (p.slip && Math.random() < p.slip) o.slip = { margin: p.margin };
  return o;
}
async function think(time) {
  const ez = plan(time); time = ez.time;
  try {
    return await client().call({ size: n, moves: moves.slice(), time, depth: ez.depth, slip: ez.slip }, { timeout: HARD_LIMIT });
  } catch (err) {
    if (/다시 시작/.test(err.message)) return null; // stopped on purpose (new game)
    if (!(err instanceof TimeoutError)) console.warn(err);
    if (!localE || localE.size !== n) localE = globalThis.HnefataflEngine({ ttBits: 16, size: n });
    localE.setStart(n); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600), depth: ez.depth });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: chipOf(3 - human) });
  render();
  const t0 = Date.now();
  const info = await think(THINK_MS);
  if (my !== g || !info) return;
  if (Date.now() - t0 < 500) await new Promise((r) => setTimeout(r, 500));
  if (my !== g) return;
  const m = state.legal.includes(info.move) ? info.move : state.legal[0];
  commit(m, info);
}

// ---------- moves ----------
function commit(m, info) {
  const mover = state.stm, from = m & 127, to = (m >> 7) & 127;
  moves.push(m); sel = -1;
  state = replay();
  for (const [q, p] of state.caps) scribble(q, p);
  render(from, to);
  if (mover === human) humanTalk(m); else engineTalk(m, info);
  if (mover !== human && state.caps.length) api.runTo(((to % n) + 0.5) / n);
  next();
}
function next() {
  if (!playing) return;
  if (state.over) { finish(); return; }
  if (state.stm === human) api.yourTurn({ color: chipOf(human), label: sideName(human) });
  else engineMove();
  render();
}
const onEdge = (s) => { const r = Math.floor(s / n), c = s % n; return r === 0 || c === 0 || r === n - 1 || c === n - 1; };
function kingBoxedIn() { // all four neighbours of the king are taken
  if (state.king < 0) return false;
  const r = Math.floor(state.king / n), c = state.king % n;
  let taken = 0;
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= n || cc < 0 || cc >= n || state.b[rr * n + cc]) taken++;
  }
  return taken >= 3;
}
function humanTalk(m) {
  if (state.over) return;
  const facts = [];
  if (state.caps.length) facts.push(['humanCap', null, 0.7]);
  if (human === 2) { // I'm the defenders: my king may be running
    if (state.escapes >= 2) facts.push(['humanFork']);
    else if (state.escapes === 1) facts.push(['humanThreat', null, 0.8]);
    if (!edgeSaid.h && state.king >= 0 && onEdge(state.king)) { edgeSaid.h = true; facts.push(['humanKingEdge']); }
  } else if (!boxedSaid && kingBoxedIn()) { boxedSaid = true; facts.push(['kingBoxed', null, 0.6]); }
  api.humanMoved({ facts, plies: moves.length });
}
function engineTalk(m, info) {
  if (state.over) return;
  const sc = info.score, facts = [];
  if (state.caps.length) facts.push(['engineCap', null, 0.7]);
  if (human === 1) { // Penopi has the defenders
    if (state.escapes >= 2) facts.push(['engineFork']);
    else if (state.escapes === 1) facts.push(['engineThreat', null, 0.8]);
    if (!edgeSaid.e && state.king >= 0 && onEdge(state.king)) { edgeSaid.e = true; facts.push(['engineKingEdge']); }
  }
  api.engineMoved({
    p: 1 / (1 + Math.exp(-sc / 300)),
    mate: sc >= BOUND ? Math.ceil((WIN - sc) / 2) - 1 : 0,
    doomed: sc <= -BOUND,
    nodes: info.nodes, depth: info.depth,
    facts,
  });
}
function finish() {
  playing = false;
  const res = state.result;
  if (res === 3) { api.over({ winner: 'draw', key: 'draw', text: '무승부' }); return; }
  const mine = res === human;
  const how = state.king < 0 ? 'King' : R.corners.includes(state.king) ? 'Corner' : 'Stuck';
  api.over({
    winner: mine ? 'human' : 'penopi',
    vars: { n: Math.ceil(moves.length / 2) },
    key: (mine ? 'humanWin' : 'engineWin') + how,
    text: `${api.chip(chipOf(res))}${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
}

function onSquare(s) {
  if (!playing || state.over || state.stm !== human) return;
  if (sel >= 0) {
    const m = state.legal.find((x) => (x & 127) === sel && ((x >> 7) & 127) === s);
    if (m !== undefined) { commit(m); return; }
    sel = mineAt(s) && state.legal.some((x) => (x & 127) === s) ? s : -1;
    render(); if (sel >= 0) peek(sel); return;
  }
  if (mineAt(s) && state.legal.some((x) => (x & 127) === s)) { sel = s; render(); peek(s); }
}
const mineAt = (s) => { const p = state.b[s]; return human === 1 ? p === 1 : p === 2 || p === 3; };
let peekPly = -1;
function peek(s) {
  api.peek(((s % n) + 0.5) / n, peekPly !== moves.length);
  peekPly = moves.length;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel >= 0 && !document.querySelector('dialog[open]')) { sel = -1; render(); } });

// ---------- drawing ----------
const centre = (s) => [(s % n) * 100 + 50, Math.floor(s / n) * 100 + 50];
const sqName = (s) => 'abcdefghijk'[s % n] + (n - Math.floor(s / n));
function stoneSvg(p, s) {
  return `<span class="stone ${classOf(p)}" style="--k:${((s * 37) % 11) - 5}deg">${p === 3 ? CROWN : ''}</span>`;
}
function build() {
  boardEl.innerHTML = '';
  sqEls = [];
  boardEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`; boardEl.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  boardEl.setAttribute('role', 'grid');
  const corners = [0, n - 1, (n - 1) * n, n * n - 1], throne = ((n - 1) / 2) * n + (n - 1) / 2;
  for (let s = 0; s < n * n; s++) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sq' + (corners.includes(s) ? ' corner' : s === throne ? ' throne' : '');
    el.addEventListener('click', () => onSquare(s));
    boardEl.appendChild(el); sqEls.push(el);
  }
  boardEl.insertAdjacentHTML('beforeend', gridSvg(n));
}
function render(animFrom = -1, animTo = -1) {
  const st = state, targets = new Set();
  if (sel >= 0) for (const m of st.legal) if ((m & 127) === sel) targets.add((m >> 7) & 127);
  const lf = st.last >= 0 ? st.last & 127 : -1, lt = st.last >= 0 ? (st.last >> 7) & 127 : -1;
  for (let s = 0; s < n * n; s++) {
    const el = sqEls[s], p = st.b[s];
    el.classList.toggle('last', s === lf || s === lt);
    el.classList.toggle('sel', s === sel);
    let h = p ? stoneSvg(p, s) : '';
    if (targets.has(s)) h += '<span class="dot"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.setAttribute('aria-label', sqName(s) + (p ? (p === 1 ? ' 공격 말' : p === 2 ? ' 수비 말' : ' 왕') : ' 빈칸') + (targets.has(s) ? ', 여기로 이동 가능' : ''));
  }
  if (animFrom >= 0 && animTo >= 0 && !reduced()) {
    hopPiece(sqEls[animTo].querySelector('.stone'), sqEls[animFrom], sqEls[animTo]);
    trail(boardEl, n, centre(animFrom), centre(animTo));
  }
}
function scribble(s, p) {
  if (reduced()) return;
  const el = document.createElement('div');
  el.className = 'ghost';
  el.style.width = el.style.height = 100 / n + '%';
  el.style.left = (s % n) * (100 / n) + '%'; el.style.top = Math.floor(s / n) * (100 / n) + '%';
  el.innerHTML = stoneSvg(p, s) + '<svg class="x" viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>';
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
const clearDoodles = () => { for (const e of boardEl.querySelectorAll('.trail, .ghost')) e.remove(); };

function stop() {
  g++;
  if (engine) engine.restart();
}
function resize(size) { // the board for the picked size, before and during the game
  const next = size === '11' ? 11 : 7;
  optSize = String(next);
  if (next === n && sqEls.length) return;
  n = next;
  build();
  state = replay();
  render();
}

export default {
  id: 'hnefatafl',
  name: '하네프타플',
  sides: [
    { id: 1, first: true, html: '<span class="chip b"></span>공격 · 선공' },
    { id: 2, first: false, html: '<span class="chip w"></span>수비 · 후공' },
  ],
  options: [{ key: 'size', label: '판', choices: [{ id: '7', html: '브랜두브 7×7' }, { id: '11', html: '코펜하겐 11×11' }], default: '7' }],
  lines: LINES,
  chat: ['chatHnefatafl'],
  longGame: 40,
  rules: {
    html: `
    <li><b>수비는 왕을 네 구석 중 한 곳에 보내면 이기고, 공격은 왕을 잡으면 이긴다.</b> 공격이 먼저 둔다.
      <span class="aside">공격은 수가 두 배쯤 많지만, 수비는 왕이 한 번만 빠져나가면 돼. 판의 한가운데가 왕의 자리(왕좌)야.</span></li>
    <li><b>모든 말이 룩처럼 움직인다. 가로나 세로로 빈 칸을 몇 칸이든 간다.</b> 다른 말은 건너뛸 수 없어.
      <span class="aside">구석과 왕좌에는 왕만 멈출 수 있어. 다른 말은 빈 왕좌를 지나가는 건 돼. 말을 누르면 갈 수 있는 칸이 점으로 나와.</span>${MOVE_FIGS}</li>
    <li><b>상대 말을 두 말 사이에 끼우면 잡는다.</b> 내가 움직여서 끼울 때만이야. 스스로 상대 말 사이로 들어가는 건 안전해.
      <span class="aside">구석은 누구에게나 적이야. 왕좌는 공격에게 늘 적이고, 수비에게는 비어 있을 때만 적이야. 왕도 말을 잡는 데 같이 일해.</span>${CAPTURE_FIGS}</li>
    <li><b>왕은 11×11 판에서는 공격 말 넷이 사방을 막아야 잡힌다.</b> 왕좌 옆이면 셋 + 빈 왕좌, 왕좌 위면 넷. 7×7 판에서는 왕도 다른 말처럼 둘이 끼우면 잡혀. 단 왕좌 위에서는 넷이 필요해.
      <span class="aside">가장자리는 막은 걸로 안 쳐. 그래서 왕이 가장자리에 있으면 못 잡아. 대신 길을 막아야 해.</span>${KING_FIGS}</li>
    <li><b>내 차례에 움직일 말이 없으면 진다.</b> 같은 판이 세 번 나오거나 300수가 되면 비긴다.</li>
    <li><b>팁: 공격은 구석 근처 대각선 자리를 먼저 막아.</b> 수비는 왕 앞길이 한꺼번에 두 군데 열리게 해 봐.
      <span class="aside">규칙은 아니고 충고야. 근데 이게 이 게임의 전부야.</span></li>`,
    note: '하네프타플(Hnefatafl)은 북유럽에서 천 년 넘게 두던 전통 게임입니다. 규칙은 코펜하겐 규칙을 쉽게 고친 것입니다.',
  },
  optionChanged(key, val) { if (key === 'size') resize(val); },
  debug: () => ({ legal: state.legal.slice(), stm: state.stm, human, over: state.over, playing, plies: moves.length, size: n }),
  mount(a) {
    api = a; boardEl = a.board;
    n = a.options && a.options.size === '11' ? 11 : 7; optSize = String(n);
    build();
    state = replay();
    render();
  },
  start(side, opts) {
    stop();
    resize((opts && opts.size) || optSize);
    human = side; moves = []; sel = -1; playing = true;
    edgeSaid = { h: false, e: false }; boxedSaid = false;
    clearDoodles();
    boardEl.setAttribute('aria-label', '하네프타플 판, 나는 ' + sideName(side));
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    const had = moves.length > 0;
    playing = false; moves = []; sel = -1; human = 1;
    state = replay();
    if (had && !reduced()) wipe(boardEl, n, () => { clearDoodles(); render(); });
    else { clearDoodles(); render(); }
  },
};
