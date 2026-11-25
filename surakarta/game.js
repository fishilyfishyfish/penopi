// Surakarta. The engine (engine.js) was written for this site: alpha-beta search in plain JS, loaded twice,
// on the page for the rules and in worker.js for thinking (the arrangement breakthrough/ uses).
// The board is a 6×6 grid of points with the two loops drawn round the corners (art.js); pieces stand on the points.
import { LINES } from './lines.js';
import { LOOP_FIGS, STEP_FIGS, CAPTURE_FIGS } from './figures.js';
import { VIEW, pct, px, boardArt } from './art.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { easePlan } from '../shared/ease.js';
import { hopPiece, wipe } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.SurakartaEngine({ ttBits: 8 });
const WIN = R.WIN, BOUND = R.WIN_BOUND;
const sideName = (p) => (p === 1 ? '흑' : '백');
const colorOf = (p) => (p === 1 ? 'b' : 'w');

let api, boardEl, ptEls = [], svgEl;
let human = 1, moves = [], state = null, sel = -1, playing = false, g = 0;
let engine = null, localE = null;

function replay() {
  R.setStart();
  for (const m of moves) R.play(m);
  const res = R.result();
  return { b: Array.from(R.board), stm: R.stm, over: res !== 0, result: res, quiet: R.quiet, legal: res ? [] : R.legalMoves(),
    last: moves.length ? moves[moves.length - 1] : -1, black: R.pieceCount(1), white: R.pieceCount(2) };
}

// ---------- thinking ----------
function client() {
  if (!engine) engine = workerClient(new URL('./worker.js', import.meta.url), { type: 'classic' });
  return engine;
}
async function think(time) {
  const ez = easePlan('surakarta', time); time = ez.time; // 봐주기 (shared/ease.js)
  try {
    return await client().call({ moves: moves.slice(), time, depth: ez.depth, slip: ez.slip }, { timeout: HARD_LIMIT });
  } catch (err) {
    if (/다시 시작/.test(err.message)) return null; // stopped on purpose (new game)
    if (!(err instanceof TimeoutError)) console.warn(err);
    if (!localE) localE = globalThis.SurakartaEngine({ ttBits: 16 });
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600), depth: ez.depth });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorOf(3 - human) });
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
  const mover = state.stm, from = m & 63, to = (m >> 6) & 63, taken = m & 4096 ? state.b[to] : 0;
  const prev = moves.length ? moves[moves.length - 1] : 0;
  let way = null;
  if (taken) { // the shortest loop route, for the pencil trail
    R.setStart(); for (const x of moves) R.play(x);
    const ps = R.paths(from, to).sort((a, b) => a.way.length - b.way.length);
    way = ps.length ? ps[0].way : null;
  }
  moves.push(m); sel = -1;
  if (taken) scribble(to, taken);
  state = replay();
  render(from, to, way);
  if (mover === human) humanTalk(m, prev); else engineTalk(m, prev, info);
  if (taken && mover !== human) api.runTo(pct(to % 6) / 100);
  next();
}
function next() {
  if (!playing) return;
  if (state.over) { finish(); return; }
  if (state.stm === human) api.yourTurn({ color: colorOf(human), label: sideName(human) });
  else engineMove();
  render();
}
function humanTalk(m, prev) {
  if (state.over) return;
  const facts = [];
  if (m & 4096 && !(prev & 4096)) facts.push(['humanCap', null, 0.7]);
  api.humanMoved({ facts, plies: moves.length });
}
function engineTalk(m, prev, info) {
  if (state.over) return;
  const sc = info.score, facts = [];
  if (m & 4096) facts.push([prev & 4096 ? 'engineBack' : 'engineCap', null, 0.7]);
  api.engineMoved({
    p: 1 / (1 + Math.exp(-sc / 250)),
    mate: sc >= BOUND ? Math.ceil((WIN - sc) / 2) - 1 : 0,
    doomed: sc <= -BOUND,
    nodes: info.nodes, depth: info.depth,
    facts,
  });
}
function finish() {
  playing = false;
  const res = state.result, count = state.black > 0 && state.white > 0; // ended on the 40-ply rule or a side without a move
  if (res === 3) { api.over({ winner: 'draw', key: 'draw', text: '무승부' }); return; }
  const mine = res === human;
  api.over({
    winner: mine ? 'human' : 'penopi',
    vars: { n: Math.ceil(moves.length / 2) },
    key: count ? (mine ? 'humanWinCount' : 'engineWinCount') : undefined,
    text: `${api.chip(colorOf(res))}${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
}

function onPoint(s) {
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
  api.peek(pct(col(s)) / 100, peekPly !== moves.length);
  peekPly = moves.length;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel >= 0 && !document.querySelector('dialog[open]')) { sel = -1; render(); } });

// ---------- drawing ----------
// my side at the bottom: White's rows (4, 5) are already there; as Black the board is turned half way round
const row = (s) => { const r = Math.floor(s / 6); return human === 1 ? 5 - r : r; };
const col = (s) => (human === 1 ? 5 - (s % 6) : s % 6);
const sqName = (s) => 'abcdef'[s % 6] + (Math.floor(s / 6) + 1);
function build() {
  boardEl.innerHTML = `<svg class="sk" viewBox="0 0 ${VIEW} ${VIEW}" aria-hidden="true">${boardArt()}</svg>`;
  svgEl = boardEl.querySelector('svg');
  boardEl.setAttribute('role', 'grid');
  ptEls = [];
  for (let s = 0; s < 36; s++) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'pt';
    el.addEventListener('click', () => onPoint(s));
    boardEl.appendChild(el); ptEls.push(el);
  }
}
function place(el, s) { el.style.left = `${pct(col(s)) - 6.1}%`; el.style.top = `${pct(row(s)) - 6.1}%`; }
function render(animFrom = -1, animTo = -1, way = null) {
  const st = state, steps = new Set(), caps = new Set();
  if (sel >= 0) for (const m of st.legal) if ((m & 63) === sel) ((m & 4096) ? caps : steps).add((m >> 6) & 63);
  const lf = st.last >= 0 ? st.last & 63 : -1, lt = st.last >= 0 ? (st.last >> 6) & 63 : -1;
  for (let s = 0; s < 36; s++) {
    const el = ptEls[s], p = st.b[s];
    place(el, s);
    el.classList.toggle('sel', s === sel);
    let h = p ? `<span class="stone ${colorOf(p)}${s === lt ? ' last' : ''}" style="--k:${((s * 37) % 11) - 5}deg"></span>` : s === lf ? '<span class="was"></span>' : '';
    if (steps.has(s)) h += '<span class="dot"></span>';
    if (caps.has(s)) h += '<span class="ring"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.setAttribute('aria-label', sqName(s) + (p ? (p === 1 ? ' 흑' : ' 백') : ' 빈 점') + (steps.has(s) ? ', 한 칸 이동 가능' : '') + (caps.has(s) ? ', 고리로 잡을 수 있음' : ''));
  }
  if (animFrom >= 0 && animTo >= 0 && !reduced()) {
    hopPiece(ptEls[animTo].querySelector('.stone'), ptEls[animFrom], ptEls[animTo]);
    if (way) drawWay(way);
  }
}
// a pencil trail along the loop route (through the squares it passed, a corner arc as a chord)
function drawWay(way) {
  const pts = way.map((s) => `${px(col(s))} ${px(row(s))}`);
  const d = 'M' + pts.join(' L');
  const NS = 'http://www.w3.org/2000/svg', path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d); path.setAttribute('class', 'way'); path.setAttribute('pathLength', '1');
  svgEl.appendChild(path);
  setTimeout(() => path.remove(), 1700);
}
function scribble(s, colour) {
  if (reduced()) return;
  const el = document.createElement('div');
  el.className = 'ghost ' + colorOf(colour);
  el.style.left = `${pct(col(s)) - 6.1}%`; el.style.top = `${pct(row(s)) - 6.1}%`;
  el.innerHTML = `<span class="stone ${colorOf(colour)}"></span><svg class="x" viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>`;
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
const clearDoodles = () => { for (const e of boardEl.querySelectorAll('.way, .ghost')) e.remove(); };

function stop() {
  g++;
  if (engine) engine.restart();
}

export default {
  id: 'surakarta',
  name: '수라카르타',
  sides: [
    { id: 1, first: true, html: '<span class="chip b"></span>흑 · 선공' },
    { id: 2, first: false, html: '<span class="chip w"></span>백 · 후공' },
  ],
  lines: LINES,
  chat: ['chatSurakarta'],
  longGame: 40,
  rules: {
    html: `
    <li><b>상대 말을 전부 잡으면 이긴다.</b> 흑이 먼저 두고, 번갈아 한 수씩 둔다.
      <span class="aside">말은 6×6 점 위에 서. 각자 12개씩 자기 쪽 두 줄에 놓고 시작해.</span></li>
    <li><b>이동은 두 가지야. 하나는 걷기: 빈 점 한 칸으로, 어느 방향이든(대각선도).</b>
      <span class="aside">내 말을 누르면 갈 수 있는 점이 빨간 점으로 나와.</span>${STEP_FIGS}</li>
    <li><b>다른 하나는 잡기: 고리를 따라 달려서 처음 만나는 상대 말을 잡는다.</b>
      고리는 둘이야. 작은 고리(빨강)는 둘째·다섯째 줄, 큰 고리(검정)는 셋째·넷째 줄이고, 구석의 둥근 길로 이어져 있어.
      <span class="aside">바깥 줄(첫째·여섯째 줄)은 고리가 아니야. 빈 점은 그냥 지나가고, 점선 동그라미가 잡을 수 있는 말이야.</span>${LOOP_FIGS}</li>
    <li><b>고리 위에서는 방향을 바꾸지 않고 앞으로만 간다.</b> 줄이 만나는 점에서도 곧장 가. 뒤쪽으로 달리는 것도 돼.
      <span class="aside">내 말이 방금 떠난 자리는 빈 점으로 쳐. 그래서 고리를 한 바퀴 돌아 내 뒤에서 잡기도 해.</span>${CAPTURE_FIGS}</li>
    <li><b>내 말이 길에 서 있으면 그 너머로는 못 간다.</b> 상대 말은 잡을 수 있지만 건너뛰지는 못해.</li>
    <li><b>40수 동안 아무도 못 잡으면 끝난다.</b> 말이 많은 쪽이 이기고, 같으면 비긴다. 둘 수 있는 수가 없어도 진다.
      <span class="aside">그래서 하나라도 앞서면 시간을 끄는 것도 작전이야.</span></li>
    <li><b>팁: 내 말을 고리 위에 세워 두면 다른 말의 길이 막혀.</b>
      <span class="aside">규칙은 아니고 충고야. 근데 고리는 내 편에게도 길이 돼.</span></li>`,
    note: '수라카르타(Surakarta)는 인도네시아 자바섬에서 전해 오는 전통 게임입니다.',
  },
  debug: () => ({ legal: state.legal.slice(), stm: state.stm, human, over: state.over, playing, plies: moves.length }),
  mount(a) {
    api = a; boardEl = a.board;
    build();
    state = replay();
    render();
  },
  start(side) {
    stop();
    human = side; moves = []; sel = -1; playing = true;
    clearDoodles();
    boardEl.setAttribute('aria-label', '수라카르타 판, 나는 ' + sideName(side));
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    const had = moves.length > 0;
    playing = false; moves = []; sel = -1; human = 1;
    state = replay();
    if (had && !reduced()) wipe(boardEl, 6, () => { clearDoodles(); render(); });
    else { clearDoodles(); render(); }
  },
};
