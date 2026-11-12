// Nine Men's Morris, with flying. The engine (engine.js) was written for this site: alpha-beta in plain JS,
// loaded on the page for the rules and in worker.js for thinking (the arrangement LOA 튀르크 used).
// A move can take three taps: where (placing) or which piece and where (moving / flying), then — after a
// mill — which opposing piece to remove. The status line says which step I'm on; Esc or a tap elsewhere
// before the last step cancels.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.MorrisEngine({ ttBits: 8 });
const { WIN, WIN_BOUND, mFrom, mTo, mRm, ADJ, MILLS, NAMES } = R;
// point positions on a 7×7 drawing grid
const XY = [[0, 0], [3, 0], [6, 0], [1, 1], [3, 1], [5, 1], [2, 2], [3, 2], [4, 2], [0, 3], [1, 3], [2, 3], [4, 3], [5, 3], [6, 3],
  [2, 4], [3, 4], [4, 4], [1, 5], [3, 5], [5, 5], [0, 6], [3, 6], [6, 6]];
const colorOf = (c) => (c === 1 ? 'w' : 'b');
const sideName = (c) => (c === 1 ? '백' : '흑');

let api, boardEl, ptEls = [];
let human = 1, moves = [], state = null, sel = { from: -2, to: -1 }, playing = false, g = 0; // from −2: nothing chosen, −1: placing
let engine = null, localE = null;

function replay() {
  R.setStart();
  for (const m of moves) R.play(m);
  const result = R.status();
  return { b: Array.from(R.board), stm: R.stm, result, legal: result ? [] : R.legalMoves(), last: moves.length ? moves[moves.length - 1] : -1,
    hand: [0, R.hand(1), R.hand(2)], on: [0, R.onBoard(1), R.onBoard(2)], phase: R.phaseOf(R.stm) };
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
    if (/다시 시작/.test(err.message)) return null;
    if (!(err instanceof TimeoutError)) console.warn(err);
    if (!localE) localE = globalThis.MorrisEngine({ ttBits: 16 });
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600) });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorOf(3 - human), text: `${api.chip(colorOf(3 - human))}${api.name} 차례` });
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
// lines of two of `c` with the third point empty (a mill next move)
function openTwos(b, c) {
  return MILLS.filter((m) => m.filter((p) => b[p] === c).length === 2 && m.some((p) => !b[p])).map((m) => m.find((p) => !b[p]));
}
function commit(m, info) {
  const mover = state.stm, before = state.b, beforeFly = state.on[3 - mover] === 3 && state.hand[3 - mover] === 0;
  const threatsBefore = openTwos(before, 3 - mover);
  moves.push(m); sel = { from: -2, to: -1 };
  state = replay();
  render(m);
  const facts = [], r = mRm(m), opp = 3 - mover;
  const flyNow = state.on[opp] === 3 && state.hand[opp] === 0 && !beforeFly;
  if (mover === human) {
    if (r >= 0) facts.push(['humanMill']);
    api.humanMoved({ facts: facts.concat(flyNow ? [['engineFlies', null, 0.8]] : []), plies: moves.length });
  } else {
    if (r >= 0) facts.push(['engineMill']);
    if (threatsBefore.includes(mTo(m))) facts.push(['engineBlock', null, 0.6]);
    if (flyNow) facts.push(['humanFlies', null, 0.8]);
    const sc = info ? info.score : 0;
    if (!state.result) api.engineMoved({
      p: 1 / (1 + Math.exp(-sc / 300)),
      mate: sc >= WIN_BOUND ? Math.max(1, Math.ceil((WIN - sc) / 2) - 1) : 0,
      doomed: sc <= -WIN_BOUND,
      nodes: info && info.nodes, depth: info && info.depth,
      facts,
    });
    if (r >= 0) api.runTo((XY[r][0] + 0.5) / 7);
  }
  next();
}
function handText() { // short: the status line shares its row with the rules button
  const h = state.hand;
  if (!h[1] && !h[2]) return `남은 말 ${state.on[human]}:${state.on[3 - human]}`;
  return `놓을 말 ${h[human]}:${h[3 - human]}`;
}
function myStatus() {
  const base = `${api.chip(colorOf(human))}`;
  if (sel.to >= 0) return `${base}가져갈 말을 골라`;
  if (state.phase === 'place') return `${base}놓을 곳 · ${handText()}`;
  if (sel.from >= 0) return `${base}${state.phase === 'fly' ? '날아갈' : '옮길'} 곳`;
  return `${base}${state.phase === 'fly' ? '날 말' : '옮길 말'} · ${handText()}`;
}
function next() {
  if (!playing) return;
  if (state.result) { finish(); return; }
  if (state.stm === human) api.yourTurn({ text: myStatus() });
  else engineMove();
  render();
}
function finish() {
  playing = false;
  const r = state.result;
  if (r.startsWith('draw')) { api.over({ winner: 'draw', key: r === 'draw:quiet' ? 'drawQuiet' : 'drawRepetition', text: '무승부' }); render(); return; }
  const winner = 3 - state.stm, mine = winner === human; // the side to move has lost
  api.over({
    winner: mine ? 'human' : 'penopi',
    vars: { n: Math.ceil(moves.length / 2) },
    text: `${api.chip(colorOf(winner))}${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
  render();
}

// ---------- input ----------
function onPoint(p) {
  if (!playing || state.result || state.stm !== human) return;
  const L = state.legal;
  if (sel.to >= 0) { // choosing what to remove
    const m = L.find((x) => mFrom(x) === sel.from && mTo(x) === sel.to && mRm(x) === p);
    if (m !== undefined) { commit(m); return; }
    sel = { from: -2, to: -1 }; changed(); return; // a tap elsewhere cancels the move
  }
  if (state.phase === 'place') {
    const opts = L.filter((x) => mFrom(x) === -1 && mTo(x) === p);
    if (!opts.length) return;
    if (opts.length === 1 && mRm(opts[0]) < 0) { commit(opts[0]); return; }
    sel = { from: -1, to: p }; changed(); return; // a mill: now pick what to take
  }
  if (sel.from >= 0) {
    const opts = L.filter((x) => mFrom(x) === sel.from && mTo(x) === p);
    if (opts.length === 1 && mRm(opts[0]) < 0) { commit(opts[0]); return; }
    if (opts.length) { sel = { from: sel.from, to: p }; changed(); return; }
  }
  if (state.b[p] === human && L.some((x) => mFrom(x) === p)) { sel = { from: p, to: -1 }; api.peek((XY[p][0] + 0.5) / 7, true); }
  else sel = { from: -2, to: -1 };
  changed();
}
function changed() { api.status(myStatus()); render(); }
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel.from !== -2 && !document.querySelector('dialog[open]')) { sel = { from: -2, to: -1 }; changed(); } });

// ---------- drawing: three pen squares and the four joining lines ----------
const pct = (v) => ((v + 0.5) / 7) * 100;
function build() {
  const j = (k, i) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return (x - Math.floor(x) - 0.5) * k; };
  const P = (c) => c * 100 + 50;
  const seg = (a, b, i) => `M${(P(a[0]) + j(4, i)).toFixed(1)} ${(P(a[1]) + j(4, i + 1)).toFixed(1)} Q${((P(a[0]) + P(b[0])) / 2 + j(9, i + 2)).toFixed(1)} ${((P(a[1]) + P(b[1])) / 2 + j(9, i + 3)).toFixed(1)} ${(P(b[0]) + j(4, i + 4)).toFixed(1)} ${(P(b[1]) + j(4, i + 5)).toFixed(1)} `;
  let d = '', i = 0;
  for (const [a, b] of [[0, 2], [3, 5], [6, 8], [9, 11], [12, 14], [15, 17], [18, 20], [21, 23], [0, 21], [3, 18], [6, 15], [1, 7], [16, 22], [8, 17], [5, 20], [2, 23]]) d += seg(XY[a], XY[b], (i += 7));
  const dots = XY.map(([x, y]) => `<circle cx="${P(x)}" cy="${P(y)}" r="11" fill="#1b1b1b"/>`).join('');
  boardEl.innerHTML = `<svg class="mgrid" viewBox="0 0 700 700" aria-hidden="true"><path d="${d}" fill="none" stroke="#1b1b1b" stroke-width="2.8" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${dots}</svg>`;
  boardEl.setAttribute('role', 'grid');
  for (let p = 0; p < 24; p++) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'mp';
    el.style.left = `${pct(XY[p][0])}%`; el.style.top = `${pct(XY[p][1])}%`;
    el.addEventListener('click', () => onPoint(p));
    boardEl.appendChild(el); ptEls.push(el);
  }
}
function render(anim) {
  const st = state, L = st.legal, mine = playing && st.stm === human && !st.result;
  const dests = new Set(), removable = new Set(), movable = new Set();
  if (mine) {
    if (sel.to >= 0) for (const m of L) { if (mFrom(m) === sel.from && mTo(m) === sel.to && mRm(m) >= 0) removable.add(mRm(m)); }
    else if (st.phase === 'place') for (const m of L) dests.add(mTo(m));
    else if (sel.from >= 0) for (const m of L) { if (mFrom(m) === sel.from) dests.add(mTo(m)); }
    else for (const m of L) movable.add(mFrom(m));
  }
  const last = st.last, lastSet = new Set(last >= 0 ? [mTo(last), mFrom(last)].filter((x) => x >= 0) : []);
  for (let p = 0; p < 24; p++) {
    const el = ptEls[p];
    let c = st.b[p];
    // while choosing what to take, show my piece already moved
    if (sel.to >= 0) { if (p === sel.from) c = 0; if (p === sel.to) c = human; }
    let h = '';
    if (c) h = `<span class="piece ${colorOf(c)}${anim !== undefined && mTo(anim) === p && !reduced() ? ' drop' : ''}"></span>`;
    if (p === sel.from || p === sel.to) h += '<span class="selring"></span>';
    if (dests.has(p)) h += '<span class="dot"></span>';
    if (removable.has(p)) h += '<span class="ring"></span>';
    if (movable.has(p) && st.phase !== 'place') h += '<span class="can"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.classList.toggle('last', lastSet.has(p));
    el.setAttribute('aria-label', NAMES[p] + (c ? (c === 1 ? ' 백' : ' 흑') : ' 빈 점') + (dests.has(p) ? ', 갈 수 있음' : removable.has(p) ? ', 가져갈 수 있음' : ''));
  }
  // a removed piece is scribbled out where it stood
  if (anim !== undefined && mRm(anim) >= 0 && !reduced()) {
    const el = document.createElement('div');
    el.className = 'ghost';
    el.style.left = `${pct(XY[mRm(anim)][0])}%`; el.style.top = `${pct(XY[mRm(anim)][1])}%`;
    el.innerHTML = `<span class="piece ${colorOf(state.stm)}"></span><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>`;
    boardEl.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
}
function stop() { g++; if (engine) engine.restart(); }

export default {
  id: 'morris',
  name: '나인 멘스 모리스',
  sides: [
    { id: 1, first: true, html: '<span class="chip w"></span>백 · 선공' },
    { id: 2, first: false, html: '<span class="chip b"></span>흑 · 후공' },
  ],
  lines: LINES,
  chat: ['chatMorris'],
  longGame: 60,
  rules: {
    title: '모리스, 규칙도 몰라?',
    html: `
    <li><b>상대 말을 두 개만 남기거나, 상대가 움직일 수 없게 만들면 이긴다.</b></li>
    <li><b>각자 말 아홉 개. 백부터 한 번에 하나씩 빈 점에 놓는다.</b> 다 놓으면 그때부터 옮긴다.</li>
    <li><b>옮길 때는 줄을 따라 바로 옆 빈 점으로 한 칸.</b>
      <span class="aside">점과 점 사이에 선이 있어야 이웃이야.</span></li>
    <li><b>내 말 셋을 한 줄(가로나 세로의 세 점)로 세우면(밀), 상대 말 하나를 골라 판에서 뺀다.</b>
      이미 한 줄을 이룬 상대 말은 못 빼. 상대 말이 전부 줄에 들어가 있으면 그때는 아무거나.
      <span class="aside">놓을 때든 옮길 때든 줄이 서면 다 쳐. 줄을 풀었다가 다시 세워도 또 쳐.</span></li>
    <li><b>말이 셋만 남으면 날 수 있다: 아무 빈 점으로나 옮긴다.</b>
      <span class="aside">지고 있을 때 쓰는 마지막 무기야. 그래 봤자지만.</span></li>
    <li><b>무승부:</b> 같은 자리가 같은 차례로 세 번 나오거나, 다 놓은 뒤 양쪽 50수씩 아무도 못 뺐을 때.</li>
    <li><b>판에서는</b> 놓을 점, 또는 내 말과 갈 점을 누른다. 줄이 서면 가져갈 상대 말(점선 동그라미)을 누른다.</li>`,
  },
  debug: () => ({ legal: state.legal.slice(), stm: state.stm, human, over: !!state.result, playing, plies: moves.length }),
  mount(a) {
    api = a; boardEl = a.board;
    build();
    state = replay();
    render();
  },
  start(side) {
    stop();
    human = side; moves = []; sel = { from: -2, to: -1 }; playing = true;
    boardEl.setAttribute('aria-label', '나인 멘스 모리스 판, 나는 ' + sideName(side));
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    playing = false; moves = []; sel = { from: -2, to: -1 };
    state = replay();
    render();
  },
};
