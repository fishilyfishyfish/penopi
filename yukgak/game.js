// 육각잇기: a connection game on a rhombus of hexagons (Piet Hein 1942, John Nash 1948; the site calls it 육각잇기).
// The engine (engine.js) was written for this site: Monte Carlo tree search with RAVE in plain JS, loaded on the page
// for the rules and in worker.js for thinking. 흑 joins top and bottom, 백 joins left and right. A move: tap a cell
// (a pale stone), tap it again to play (the cells are small, like gomoku's points). The swap rule: on the second move
// 백 may take 흑's first stone ("바꾸기" under the board), which turns into a 백 stone at the mirrored cell.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { easePlan, easeSlip } from '../shared/ease.js';
import { HEX_FIG } from './figures.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const SIZES = { 9: 9, 11: 11, 13: 13 };
const R = globalThis.HexEngine({ size: 9, nodes: 2000 });
const SWAP = R.SWAP;
const colorOf = (c) => (c === 1 ? 'b' : 'w');
const sideName = (c) => (c === 1 ? '흑' : '백');
const goal = (c) => (c === 1 ? '위아래 잇기' : '왼쪽 오른쪽 잇기');
const W3 = Math.sqrt(3);

let api, boardEl, cellEls = [];
let N = 9, human = 1, moves = [], state = null, playing = false, g = 0, pending = -1;
let engine = null, localE = null;

function replay() {
  R.setup(N);
  for (const m of moves) R.play(m);
  const chain = [], w = R.winner(chain);
  return { b: Array.from(R.board), stm: R.toMove, winner: w, chain, last: moves.length ? moves[moves.length - 1] : null, canSwap: moves.length === 1 };
}

// ---------- thinking ----------
function client() {
  if (!engine) engine = workerClient(new URL('./worker.js', import.meta.url), { type: 'classic' });
  return engine;
}
async function think(time) {
  const ez = easePlan('yukgak', time); time = ez.time; // 봐주기 (shared/ease.js): less time
  try {
    return await client().call({ size: N, moves: moves.slice(), time }, { timeout: HARD_LIMIT });
  } catch (err) {
    if (/다시 시작/.test(err.message)) return null;
    if (!(err instanceof TimeoutError)) console.warn(err);
    if (!localE) localE = globalThis.HexEngine({ size: N, nodes: 200000 });
    localE.setup(N); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600) });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorOf(3 - human), text: `${api.chip(colorOf(3 - human))}${api.name} 차례` });
  tray(); render();
  const t0 = Date.now();
  if (moves.length === 0) {
    // the first stone: not too good, or 백 just swaps it away. One row in from 흑's own edge, away from the corners, at random.
    const opts = [];
    for (const r of [1, N - 2]) for (let c = 2; c <= N - 3; c++) opts.push(r * N + c);
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 500));
    if (my !== g) return;
    commit(opts[Math.floor(Math.random() * opts.length)], { p: 0.5 });
    return;
  }
  const info = await think(THINK_MS);
  if (my !== g || !info) return;
  if (Date.now() - t0 < 500) await new Promise((r) => setTimeout(r, 500));
  if (my !== g) return;
  let m = info.move;
  if (m !== SWAP) { const cand = []; state.b.forEach((x, i) => { if (!x) cand.push(i); }); const sl = easeSlip('yukgak', cand); if (sl !== undefined) m = sl; }
  if (m === SWAP ? !state.canSwap : m < 0 || state.b[m]) m = state.b.findIndex((x) => !x);
  commit(m, info);
}

// ---------- moves ----------
function commit(m, info) {
  const mover = state.stm;
  moves.push(m); pending = -1;
  state = replay();
  render(m);
  if (mover === human) {
    if (!state.winner) api.humanMoved({ facts: m === SWAP ? [['humanSwap']] : [], plies: moves.length });
  } else if (!state.winner) {
    api.engineMoved({ p: info ? info.p : 0.5, nodes: info && info.playouts, facts: m === SWAP ? [['engineSwap']] : [] });
  }
  next();
}
function next() {
  tray();
  if (!playing) return;
  if (state.winner) { finish(); return; }
  if (state.stm === human) {
    api.yourTurn({ color: colorOf(human), label: sideName(human), text: myStatus() });
    if (state.canSwap) api.say('swapOffer'); // the swap button is only there now: say so
  }
  else engineMove();
  render();
}
function myStatus() {
  const base = `${api.chip(colorOf(human))}내 차례 (${sideName(human)} · ${goal(human)})`;
  return state.canSwap && human === 2 ? `${base} · 바꿀 수도 있어` : base;
}
function finish() {
  playing = false;
  tray();
  const w = state.winner, mine = w === human;
  api.over({
    winner: mine ? 'human' : 'penopi',
    key: mine ? 'humanWinConnect' : 'engineWinConnect',
    vars: { n: Math.ceil(moves.length / 2) },
    text: `${api.chip(colorOf(w))}${sideName(w)} ${goal(w).replace(' 잇기', '')} 연결 · ${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
  render();
}

// ---------- input: tap twice ----------
function onCell(s) {
  if (!playing || state.winner || state.stm !== human || state.b[s]) return;
  if (pending === s) { commit(s); return; }
  pending = s;
  render();
}
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (pending >= 0) { pending = -1; render(); }
});
function tray() {
  const t = api.tray, mine = playing && state && !state.winner && state.stm === human && state.canSwap;
  if (!mine) { t.hidden = true; t.innerHTML = ''; t.dataset.h = ''; return; }
  const html = '<button type="button" class="btn small" data-act="swap">바꾸기</button>';
  if (t.dataset.h !== html) { t.innerHTML = html; t.dataset.h = html; }
  t.hidden = false;
}

// ---------- drawing: pointy-top hexagons, row r shifted right by half a cell per row ----------
let VW = 0, VH = 0;
const RAD = 50, CW = W3 * RAD, PAD = 18; // hexagon radius, cell width, margin (for the edge lines)
const centre = (s) => { const r = (s / N) | 0, c = s % N; return [PAD + CW / 2 + (c + r / 2) * CW, PAD + RAD + r * 1.5 * RAD]; };
const hexPts = (x, y, k = 1) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + i * Math.PI / 3; return `${(x + Math.cos(a) * RAD * k).toFixed(1)},${(y + Math.sin(a) * RAD * k).toFixed(1)}`; }).join(' ');
function build() {
  VW = PAD * 2 + CW * (N + (N - 1) / 2); VH = PAD * 2 + RAD * 2 + 1.5 * RAD * (N - 1);
  boardEl.style.height = `calc(var(--size) * ${(VH / VW).toFixed(4)})`;
  let cells = '';
  for (let s = 0; s < N * N; s++) { const [x, y] = centre(s); cells += `<polygon points="${hexPts(x, y)}"/>`; }
  // the edges: 흑's (top and bottom) a thick ink line, 백's (left and right) a double line
  const vtx = (s, i) => { const [x, y] = centre(s), a = Math.PI / 6 + i * Math.PI / 3; return [x + Math.cos(a) * RAD, y + Math.sin(a) * RAD]; };
  const zig = (pts) => 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L');
  const top = [], bottom = [], left = [], right = [];
  for (let c = 0; c < N; c++) { top.push(vtx(c, 3), vtx(c, 4)); bottom.push(vtx((N - 1) * N + c, 2), vtx((N - 1) * N + c, 1)); }
  top.push(vtx(N - 1, 5)); bottom.push(vtx(N * N - 1, 0)); // close the zigzags at the corners
  for (let r = 0; r < N; r++) { left.push(vtx(r * N, 3), vtx(r * N, 2)); right.push(vtx(r * N + N - 1, 5), vtx(r * N + N - 1, 0)); }
  const off = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
  const edges = `<path class="eb" d="${zig(off(top, 0, -6))} ${zig(off(bottom, 0, 6))}"/>`
    + `<path class="ew" d="${zig(off(left, -7, 0))} ${zig(off(left, -13, 0))} ${zig(off(right, 7, 0))} ${zig(off(right, 13, 0))}"/>`;
  boardEl.innerHTML = `<svg class="hexgrid" viewBox="0 0 ${VW.toFixed(1)} ${VH.toFixed(1)}" aria-hidden="true"><g class="cells">${cells}</g>${edges}<path class="chain" d=""/></svg>`;
  boardEl.setAttribute('role', 'grid');
  cellEls = [];
  for (let s = 0; s < N * N; s++) {
    const [x, y] = centre(s), el = document.createElement('button');
    el.type = 'button'; el.className = 'hx';
    el.style.left = `${((x - CW / 2) / VW) * 100}%`; el.style.top = `${((y - RAD) / VH) * 100}%`;
    el.style.width = `${(CW / VW) * 100}%`; el.style.height = `${((2 * RAD) / VH) * 100}%`;
    el.addEventListener('click', () => onCell(s));
    boardEl.appendChild(el); cellEls.push(el);
  }
}
const cellName = (s) => 'abcdefghijklm'[s % N] + ((s / N | 0) + 1);
function render(anim) {
  const st = state;
  const lastCell = st.last === SWAP ? R.mirror(moves[0]) : st.last;
  for (let s = 0; s < N * N; s++) {
    const el = cellEls[s], p = st.b[s];
    let h = '';
    if (p) h = `<span class="stone ${colorOf(p)}${s === lastCell ? ' last' : ''}${anim !== undefined && s === lastCell && !reduced() ? ' drop' : ''}"></span>`;
    else if (s === pending) h = `<span class="stone ${colorOf(human)} ghost"></span>`;
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.setAttribute('aria-label', cellName(s) + (p ? ` ${sideName(p)}` : ' 빈칸'));
  }
  const chainEl = boardEl.querySelector('.chain');
  const d = st.winner && st.chain.length ? 'M' + st.chain.map((s) => centre(s).map((v) => v.toFixed(1)).join(' ')).join(' L') : '';
  if (chainEl.getAttribute('d') !== d) chainEl.setAttribute('d', d);
}
function stop() { g++; if (engine) engine.restart(); }

export default {
  id: 'yukgak',
  name: '육각잇기',
  sides: [
    { id: 1, first: true, html: '<span class="chip b"></span>흑 · 선공' },
    { id: 2, first: false, html: '<span class="chip w"></span>백 · 후공' },
  ],
  options: [{ key: 'size', label: '판', choices: [{ id: '9', html: '9×9' }, { id: '11', html: '11×11' }, { id: '13', html: '13×13' }], default: '9' }],
  optionChanged(key, val) { if (key === 'size' && !playing) { N = SIZES[val] || 9; moves = []; build(); state = replay(); render(); } },
  lines: LINES,
  chat: ['chatYukgak'],
  longGame: 60,
  rules: {
    title: '육각잇기, 규칙도 몰라?',
    html: `
    <li><b>육각형 칸에 번갈아 내 돌을 하나씩 놓는다.</b> 흑이 먼저. 놓은 돌은 움직이지 않는다.</li>
    <li><b>흑은 위아래 변(굵은 선)을, 백은 왼쪽 오른쪽 변(두 줄 선)을 내 돌로 끊김 없이 이으면 이긴다.</b>
      <span class="aside">붙어 있는 육각형끼리만 이어진 걸로 쳐. 판이 다 차기 전에 누군가는 꼭 이어서, 비기는 일이 없어.</span>${HEX_FIG}</li>
    <li><b>바꾸기:</b> 첫 수 다음에 백은 흑의 첫 돌을 자기 것으로 가질 수 있다(판 아래 "바꾸기"). 그 돌은 대각선으로 뒤집은 자리의 백 돌이 되고, 흑이 다시 둔다.
      <span class="aside">먼저 두는 쪽이 너무 유리해서 있는 규칙이야. 그래서 흑은 첫 수를 너무 좋은 데 두면 뺏겨.</span></li>
    <li><b>칸을 한 번 누르면 흐린 돌, 한 번 더 누르면 둔다.</b> 판 크기는 대국 전에 골라.</li>`,
    note: '처음 만든 사람: 피트 하인(Piet Hein, 1942), 존 내시(John Nash, 1948)가 따로 만들었다.',
  },
  debug: () => ({ legal: playing && !state.winner ? state.b.map((x, s) => (x ? -1 : s)).filter((s) => s >= 0) : [], stm: state.stm, human, over: !!state.winner || !playing, playing, plies: moves.length, canSwap: state.canSwap, cells: null }),
  mount(a) {
    api = a; boardEl = a.board;
    N = SIZES[(a.options && a.options.size) || '9'] || 9;
    build();
    state = replay();
    render();
    api.tray.addEventListener('click', (e) => {
      if (!e.target.closest('[data-act="swap"]')) return;
      if (playing && state.stm === human && state.canSwap) commit(SWAP);
    });
  },
  start(side, opts) {
    stop();
    N = SIZES[(opts && opts.size) || '9'] || 9;
    human = side; moves = []; pending = -1; playing = true;
    build();
    boardEl.setAttribute('aria-label', `육각잇기 ${N}×${N} 판, 나는 ${sideName(side)}`);
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    playing = false; moves = []; pending = -1; human = 1;
    tray();
    state = replay();
    render();
  },
};
