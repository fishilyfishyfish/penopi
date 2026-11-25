// Konane (the Hawaiian jumping game). The engine (engine.js) was written for this site: alpha-beta search in plain JS,
// loaded twice, on the page for the rules and in worker.js for thinking (the arrangement breakthrough/ uses).
// Board and doodles follow the other square boards: a hand-drawn 8×8 grid, hatched squares, pencil trails, scribbled captures.
import { LINES } from './lines.js';
import { OPEN_FIGS, JUMP_FIGS } from './figures.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { easePlan } from '../shared/ease.js';
import { gridSvg, hopPiece, trail, wipe } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.KonaneEngine({ ttBits: 8 });
const WIN = R.WIN, BOUND = R.WIN_BOUND;
const sideName = (p) => (p === 1 ? '흑' : '백');
const colorOf = (p) => (p === 1 ? 'b' : 'w');

let api, boardEl, sqEls = [];
let human = 1, moves = [], state = null, sel = -1, playing = false, g = 0;
let engine = null, localE = null;

function replay() {
  R.setStart();
  for (const m of moves) R.play(m);
  const over = R.status() === 'over';
  return { b: Array.from(R.board), stm: R.stm, plies: R.plies, over, loser: over ? R.loser() : 0, legal: over ? [] : R.legalMoves(), last: moves.length ? moves[moves.length - 1] : -1 };
}

// ---------- thinking ----------
function client() {
  if (!engine) engine = workerClient(new URL('./worker.js', import.meta.url), { type: 'classic' });
  return engine;
}
async function think(time) {
  const ez = easePlan('konane', time); time = ez.time; // 봐주기 (shared/ease.js)
  try {
    return await client().call({ moves: moves.slice(), time, depth: ez.depth, slip: ez.slip }, { timeout: HARD_LIMIT });
  } catch (err) {
    if (/다시 시작/.test(err.message)) return null; // stopped on purpose (new game)
    if (!(err instanceof TimeoutError)) console.warn(err);
    if (!localE) localE = globalThis.KonaneEngine({ ttBits: 16 });
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
const isRemoval = (m) => (m & 63) === ((m >> 6) & 63);
function commit(m, info) {
  const mover = state.stm, from = m & 63, to = (m >> 6) & 63, was = state.b;
  const gone = isRemoval(m) ? [from] : R.jumped(m);
  moves.push(m); sel = -1;
  for (const q of gone) scribble(q, was[q]);
  state = replay();
  if (isRemoval(m)) render(); else render(from, to);
  if (mover === human) humanTalk(m); else engineTalk(m, info);
  if (mover !== human && !isRemoval(m)) api.runTo((visual(to) % 8 + 0.5) / 8);
  next();
}
function next() {
  if (!playing) return;
  if (state.over) { finish(); return; }
  if (state.stm === human) api.yourTurn({ color: colorOf(human), label: sideName(human), text: state.plies < 2 ? `${api.chip(colorOf(human))}내 차례 · 뺄 돌을 골라` : undefined });
  else engineMove();
  render();
}
const jumpsOf = (m) => (isRemoval(m) ? 0 : R.jumped(m).length);
function humanTalk(m) {
  if (state.over) return;
  const facts = [];
  if (jumpsOf(m) >= 2) facts.push(['humanMulti', null, 0.8]);
  if (state.plies >= 6 && state.legal.length <= 2) facts.push(['humanSqueeze', null, 0.8]);
  api.humanMoved({ facts, plies: moves.length });
}
function engineTalk(m, info) {
  if (state.over) return;
  const sc = info.score, facts = [];
  if (jumpsOf(m) >= 2) facts.push(['engineMulti', null, 0.7]);
  if (state.plies >= 6 && state.legal.length <= 2) facts.push(['engineSqueeze', null, 0.8]);
  api.engineMoved({
    p: 1 / (1 + Math.exp(-sc / 60)),
    mate: sc >= BOUND ? Math.ceil((WIN - sc) / 2) - 1 : 0,
    doomed: sc <= -BOUND,
    nodes: info.nodes, depth: info.depth,
    facts,
  });
}
function finish() {
  playing = false;
  const winner = 3 - state.loser, mine = winner === human;
  api.over({
    winner: mine ? 'human' : 'penopi',
    vars: { n: Math.ceil(moves.length / 2) },
    text: `${api.chip(colorOf(winner))}${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
}

function onSquare(s) {
  if (!playing || state.over || state.stm !== human) return;
  if (state.plies < 2) { // the opening: tap the stone to take off
    const m = state.legal.find((x) => (x & 63) === s);
    if (m !== undefined) commit(m);
    return;
  }
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
  api.peek((visual(s) % 8 + 0.5) / 8, peekPly !== moves.length);
  peekPly = moves.length;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel >= 0 && !document.querySelector('dialog[open]')) { sel = -1; render(); } });

// ---------- drawing ----------
// rank 1 at the bottom, file a at the left (the board is the same for both sides)
const visual = (s) => (7 - (s >> 3)) * 8 + (s & 7);
const squareAt = (v) => (7 - (v >> 3)) * 8 + (v & 7);
const centre = (s) => { const v = visual(s); return [(v & 7) * 100 + 50, (v >> 3) * 100 + 50]; };
const sqName = (s) => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
function stoneSvg(side, s) {
  return `<span class="stone ${colorOf(side)}" style="--k:${((s * 37) % 11) - 5}deg;--d:${((s & 7) + (s >> 3)) * 28}ms"></span>`;
}
function build() {
  boardEl.setAttribute('role', 'grid');
  for (let v = 0; v < 64; v++) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sq' + (((v >> 3) + (v & 7)) % 2 ? ' dk' : '');
    el.addEventListener('click', () => onSquare(squareAt(v)));
    boardEl.appendChild(el); sqEls.push(el);
  }
  boardEl.insertAdjacentHTML('beforeend', gridSvg(8));
}
function render(animFrom = -1, animTo = -1) {
  const st = state, targets = new Set(), removable = new Set();
  if (st.plies < 2 && playing && st.stm === human) for (const m of st.legal) removable.add(m & 63);
  else if (sel >= 0) for (const m of st.legal) if ((m & 63) === sel) targets.add((m >> 6) & 63);
  const lf = st.last >= 0 ? st.last & 63 : -1, lt = st.last >= 0 ? (st.last >> 6) & 63 : -1;
  for (let v = 0; v < 64; v++) {
    const s = squareAt(v), el = sqEls[v], p = st.b[s];
    el.classList.toggle('last', s === lf || s === lt);
    el.classList.toggle('sel', s === sel);
    let h = p ? stoneSvg(p, s) : '';
    if (targets.has(s)) h += '<span class="dot"></span>';
    if (removable.has(s)) h += '<span class="ring"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.setAttribute('aria-label', sqName(s) + (p ? (p === 1 ? ' 흑' : ' 백') : ' 빈칸') + (targets.has(s) ? ', 여기로 뛸 수 있음' : '') + (removable.has(s) ? ', 뺄 수 있는 돌' : ''));
  }
  if (animFrom >= 0 && animTo >= 0 && !reduced()) {
    hopPiece(sqEls[visual(animTo)].querySelector('.stone'), sqEls[visual(animFrom)], sqEls[visual(animTo)]);
    trail(boardEl, 8, centre(animFrom), centre(animTo));
  }
}
function scribble(s, colour) {
  if (reduced()) return;
  const v = visual(s), el = document.createElement('div');
  el.className = 'ghost ' + colorOf(colour);
  el.style.left = (v & 7) * 12.5 + '%'; el.style.top = (v >> 3) * 12.5 + '%';
  el.innerHTML = stoneSvg(colour, s) + '<svg class="x" viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>';
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
const clearDoodles = () => { for (const e of boardEl.querySelectorAll('.trail, .ghost')) e.remove(); };

function stop() {
  g++;
  if (engine) engine.restart();
}

export default {
  id: 'konane',
  name: '코네인',
  sides: [
    { id: 1, first: true, html: '<span class="chip b"></span>흑 · 선공' },
    { id: 2, first: false, html: '<span class="chip w"></span>백 · 후공' },
  ],
  lines: LINES,
  chat: ['chatKonane'],
  longGame: 24,
  rules: {
    html: `
    <li><b>상대 돌을 뛰어넘어 빈칸에 내리는 게임이야. 먼저 뛸 곳이 없어지는 쪽이 진다.</b>
      <span class="aside">돌 수가 많은 쪽이 아니라, 끝까지 뛸 길을 남겨 두는 쪽이 이겨.</span></li>
    <li><b>8×8 판에 흑돌과 백돌을 바둑판무늬로 꽉 채워 놓고 시작한다.</b> 흑이 먼저 귀퉁이나 가운데 자기 돌 하나를 빼고, 백은 그 구멍 바로 옆 자기 돌 하나를 뺀다.
      <span class="aside">판에서는 점선 동그라미가 뺄 수 있는 돌이야. 하나 눌러.</span>${OPEN_FIGS}</li>
    <li><b>그다음부터는 가로나 세로로 바로 옆의 상대 돌을 뛰어넘어, 그 바로 뒤 빈칸에 내려.</b> 뛰어넘은 돌은 치워.
      <span class="aside">내 돌을 누르면 갈 수 있는 칸이 빨간 점으로 나와.</span></li>
    <li><b>같은 방향이면 이어서 또 뛸 수 있어.</b> 두 개든 세 개든. 하지만 방향을 바꿀 수는 없어.
      <span class="aside">이어서 뛸 수 있다면 멈출 칸마다 점이 보여. 멈추고 싶은 칸을 눌러.</span>${JUMP_FIGS}</li>
    <li><b>내 차례에 뛸 수 있는 곳이 없으면 진다.</b> 비기는 일은 없어.
      <span class="aside">그래서 내가 뛸 길은 많이 남기고, 상대 길은 막아 가는 게 요령이야.</span></li>
    <li><b>팁: 돌을 따는 것보다 상대가 뛸 길을 줄이는 게 먼저야.</b>
      <span class="aside">규칙은 아니고 충고야. 근데 이게 이 게임의 전부야.</span></li>`,
    note: '코네인(Konane)은 하와이에서 오래전부터 두던 전통 게임입니다.',
  },
  debug: () => ({ legal: state.legal.slice(), stm: state.stm, human, over: state.over, playing, plies: moves.length,
    cells: Array.from({ length: 64 }, (_, s) => visual(s)) }),
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
    boardEl.setAttribute('aria-label', '코네인 판, 나는 ' + sideName(side));
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    const had = moves.length > 0;
    playing = false; moves = []; sel = -1; human = 1;
    state = replay();
    if (had && !reduced()) wipe(boardEl, 8, () => { clearDoodles(); render(); });
    else { clearDoodles(); render(); }
  },
};
