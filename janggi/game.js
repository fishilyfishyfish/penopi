// Janggi (장기). The engine (engine.js) was written for this site: alpha-beta in plain JS, loaded on the page for the
// rules and in worker.js for thinking, like chess. The board is a pen grid of 9×10 lines with the two palaces'
// diagonals; pieces sit on the intersections as octagons with their name written in pen (초 ink, 한 red).
// Input: tap a piece, then where it goes. "한수 쉼" (pass) under the board when not in check.
// Before the game I pick my 상차림 (option); Penopi picks its own at random.
import { LINES } from './lines.js';
import { BOOK } from './book.js';
import { GLYPHS } from '../shared/glyphs.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { hopPiece, trail, wipe } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.JanggiEngine({ ttBits: 8 });
const { CHO, HAN, SOL, GUA, ELE, HOR, CAN, CHA, GEN, MATE, MATE_BOUND, COUNT_WIN, PASS, mFrom, mTo, isCap } = R;
const NAMES = ['', '졸', '사', '상', '마', '포', '차', '궁'];
const pieceName = (p) => ((p & 7) === SOL && (p & 8) === HAN ? '병' : NAMES[p & 7]);
// the piece's name as a drawing (shared/glyphs.js), in hangul or hanja (option '말 글씨'): no font needed
const HANJA = ['', '卒', '士', '象', '馬', '包', '車', ''];
let script = 'hangul';
const glyph = (p) => (script === 'hanja'
  ? ((p & 7) === GEN ? ((p & 8) === CHO ? '楚' : '漢') : (p & 7) === SOL && (p & 8) === HAN ? '兵' : HANJA[p & 7])
  : ((p & 7) === GEN ? ((p & 8) === CHO ? '초' : '한') : pieceName(p)));
const sideName = (c) => (c === CHO ? '초' : '한');
const colorOf = (c) => (c === CHO ? 'cho' : 'han');
const ARR_NAMES = ['마상마상', '상마상마', '마상상마', '상마마상'];
const fmt = (x) => String(x).replace(/\.5$/, '.5');

let api, boardEl, ptEls = [];
let human = CHO, myArr = 2, penArr = 2, moves = [], state = null, sel = -1, playing = false, g = 0;
let engine = null, localE = null, inBook = true, firstSearch = false;

const arrs = () => (human === CHO ? [myArr, penArr] : [penArr, myArr]);
function replay() {
  const [a, b] = arrs();
  R.setup(a, b);
  for (const m of moves) R.play(m);
  const result = R.status();
  return {
    b: Array.from(R.board), side: R.side, result, legal: result ? [] : R.legalMoves(), check: R.inCheck(),
    king: R.kings[R.side >> 3], last: moves.length ? moves[moves.length - 1] : 0, facing: R.facing(),
    key: R.fen().split(' ').slice(0, 2).join(' '),
    pts: [R.points(CHO), R.points(HAN)], winner: result.startsWith('count') ? R.countWinner() : result ? R.side ^ 8 : -1,
  };
}

// ---------- thinking ----------
function client() {
  if (!engine) engine = workerClient(new URL('./worker.js', import.meta.url), { type: 'classic' });
  return engine;
}
async function think(time) {
  try {
    return await client().call({ arr: arrs(), moves: moves.slice(), time }, { timeout: HARD_LIMIT });
  } catch (err) {
    if (/다시 시작/.test(err.message)) return null;
    if (!(err instanceof TimeoutError)) console.warn(err);
    if (!localE) localE = globalThis.JanggiEngine({ ttBits: 16 });
    localE.setup(...arrs()); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600) });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorOf(human ^ 8) });
  render();
  const t0 = Date.now();
  // the opening book (janggi/book.js, the engine's own deep searches): while the game follows it
  const bk = inBook && BOOK[state.key] ? BOOK[state.key].map((u) => state.legal.find((x) => R.uci(x) === u)).filter((x) => x !== undefined) : [];
  if (bk.length) {
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 600));
    if (my !== g) return;
    commit(bk[Math.floor(Math.random() * bk.length)], { score: 0, nodes: 0, book: true });
    return;
  }
  inBook = false;
  const info = await think(THINK_MS);
  if (my !== g || !info) return;
  if (Date.now() - t0 < 500) await new Promise((r) => setTimeout(r, 500 - (Date.now() - t0)));
  if (my !== g) return;
  const m = state.legal.includes(info.move) ? info.move : state.legal[0];
  commit(m, info);
}

// ---------- moves ----------
// A capture is remarked on only when it wins material: not when the other side can just take back, and not the
// taking back itself (values: the engine's material, roughly 졸 100).
const VAL = [0, 100, 170, 170, 300, 380, 650, 0];
let prevCapture = null; // {to, gain}: the last move if it was a capture
function captureKind(m, taken, mover) {
  if (!taken) { prevCapture = null; return null; }
  const to = mTo(m), moved = state.b[mFrom(m)] & 7;
  let net;
  if (prevCapture && prevCapture.to === to) net = VAL[taken] - prevCapture.gain; // taking back
  else {
    R.setup(...arrs()); for (const x of moves) R.play(x); R.play(m);
    // can the other side take back on that point at once?
    const back = R.legalMoves().some((x) => x !== PASS && mTo(x) === to);
    net = VAL[taken] - (back ? VAL[moved] : 0);
  }
  prevCapture = { to, gain: VAL[taken] };
  void mover;
  return net >= 150 ? 'win' : 'trade';
}
function commit(m, info) {
  const mover = state.side, before = state.b;
  const taken = m !== PASS && isCap(m) ? before[mTo(m)] : 0;
  const kind = captureKind(m, taken & 7, mover);
  const wasFacing = state.facing;
  moves.push(m); sel = -1;
  if (taken) scribble(mTo(m), taken);
  state = replay();
  render(m);
  if (mover === human) humanTalk(m, taken & 7, kind, wasFacing); else engineTalk(m, info, taken & 7, kind, wasFacing);
  if (taken && mover !== human) api.runTo((vis(mTo(m))[0] + 0.5) / 9);
  next();
}
function next() {
  tray();
  if (!playing) return;
  if (state.result) { finish(); return; }
  if (state.side === human) api.yourTurn({ color: colorOf(human), label: sideName(human), text: myStatus() });
  else engineMove();
  render();
}
function myStatus() {
  const base = `${api.chip(colorOf(human))}내 차례 (${sideName(human)})`;
  if (state.check) return `${base} · 장군!`;
  if (state.facing) return `${base} · 빅장! 풀거나, 쉬고 점수 세기`;
  return base;
}
function humanTalk(m, taken, kind, wasFacing) {
  if (state.result) return;
  const facts = [];
  if (m === PASS) facts.push(['humanPass', null, 0.7]);
  if (state.check) facts.push(['humanCheck', null, 0.6]);
  if (state.facing && !wasFacing) facts.push(['humanBikjang']);
  if (kind === 'win') facts.push(taken === CHA ? ['humanTakesCha'] : ['humanCap', { pc: NAMES[taken] }, 0.5]);
  api.humanMoved({ facts, plies: moves.length });
}
function engineTalk(m, info, taken, kind, wasFacing) {
  if (state.result) return;
  const sc = info ? info.score : 0, facts = [];
  if (m === PASS) facts.push(['enginePass']);
  if (state.facing && !wasFacing) facts.push(['engineBikjang']);
  if (kind === 'win' && taken === CHA) facts.push(['engineTakesCha']);
  if (state.check) facts.push(['engineCheck', null, 0.8]);
  if (kind === 'win' && taken !== CHA) facts.push(['engineCap', { pc: NAMES[taken] }, 0.6]);
  const counted = Math.abs(sc) >= COUNT_WIN - 1000 && Math.abs(sc) < MATE_BOUND; // the game will end by counting
  const fresh = info && info.book ? true : firstSearch; // the book has no evaluation to compare against
  firstSearch = !!(info && info.book);
  api.engineMoved({
    verdict: fresh ? null : undefined,
    p: counted ? (sc > 0 ? 0.97 : 0.03) : 1 / (1 + Math.exp(-sc / 300)),
    mate: sc >= MATE_BOUND ? Math.ceil((MATE - sc) / 2) : 0,
    doomed: sc <= -MATE_BOUND,
    nodes: info && info.nodes, depth: info && info.depth,
    facts,
  });
}
function finish() {
  playing = false;
  tray();
  const r = state.result, winner = state.winner, mine = winner === human;
  const vars = { a: fmt(state.pts[human >> 3]), b: fmt(state.pts[(human ^ 8) >> 3]), n: Math.ceil(moves.length / 2) };
  if (r === 'mate') {
    api.over({ winner: mine ? 'human' : 'penopi', key: mine ? 'humanWinMate' : 'engineWinMate', vars,
      text: `${api.chip(colorOf(winner))}외통 · ${mine ? '내가 이겼다' : `${api.name}가 이겼다`}` });
    return;
  }
  const why = { 'count:bikjang': '빅장', 'count:pass': '둘 다 쉼', 'count:repetition': '같은 수 반복', 'count:limit': '200수' }[r];
  api.over({ winner: mine ? 'human' : 'penopi', key: mine ? 'humanWinCount' : 'engineWinCount', vars,
    text: `${why} · 점수 ${vars.a} : ${vars.b} · ${mine ? '내가 이겼다' : `${api.name}가 이겼다`}` });
}

// ---------- input ----------
function onPoint(s) {
  if (!playing || state.result || state.side !== human) return;
  if (sel >= 0) {
    const m = state.legal.find((x) => x !== PASS && mFrom(x) === sel && mTo(x) === s);
    if (m !== undefined) { commit(m); return; }
  }
  const p = state.b[s];
  if (p && (p & 8) === human && state.legal.some((x) => x !== PASS && mFrom(x) === s)) { sel = s; peek(s); }
  else sel = -1;
  render();
}
let peekPly = -1;
function peek(s) { api.peek((vis(s)[0] + 0.5) / 9, peekPly !== moves.length); peekPly = moves.length; }
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (sel >= 0) { sel = -1; render(); }
});
function tray() {
  const t = api.tray, mine = playing && state && !state.result && state.side === human && state.legal.includes(PASS);
  if (!mine) { t.hidden = true; t.innerHTML = ''; t.dataset.h = ''; return; }
  const html = `<button type="button" class="btn small" data-act="pass">${state.facing ? '한수 쉼 · 점수 세기' : '한수 쉼'}</button>`;
  if (t.dataset.h !== html) { t.innerHTML = html; t.dataset.h = html; }
  t.hidden = false;
}

// ---------- drawing ----------
// my side at the bottom: as 초 rank 10 on top; as 한 the board turned around
const vis = (s) => { const r = (s / 9) | 0, f = s % 9; return human === CHO ? [f, 9 - r] : [8 - f, r]; };
const pointAt = (vf, vr) => (human === CHO ? (9 - vr) * 9 + vf : vr * 9 + (8 - vf));
const centre = (s) => { const [x, y] = vis(s); return [x * 100 + 50, y * 100 + 50]; };
const ptName = (s) => 'abcdefghi'[s % 9] + (((s / 9) | 0) + 1);
const SIZE = [0, 0.64, 0.66, 0.78, 0.78, 0.78, 0.84, 0.96];
function pieceSvg(p) {
  const k = SIZE[p & 7], c = 50, rr = 46 * k, a = rr * 0.414; // a regular octagon of "radius" rr
  const pts = [[-a, -rr], [a, -rr], [rr, -a], [rr, a], [a, rr], [-a, rr], [-rr, a], [-rr, -a]].map(([x, y]) => `${(c + x).toFixed(1)},${(c + y).toFixed(1)}`).join(' ');
  const fs = (p & 7) === GEN ? 44 : 40 * k / 0.78;
  return `<svg class="jp ${colorOf(p & 8)}" viewBox="0 0 100 100" aria-hidden="true"><polygon points="${pts}"/><polygon class="in" points="${pts}" transform="translate(50 50) scale(.8) translate(-50 -50)"/><path class="g ${script}" d="${GLYPHS[script][glyph(p)]}" transform="translate(50 50) scale(${(fs / 100 * (script === 'hanja' ? 1.12 : 1.05)).toFixed(3)}) translate(-50 -50)"/></svg>`;
}
function build() {
  const W = 900, H = 1000, j = (k, i) => { const x = Math.sin(i * 12.9898 + 7.1) * 43758.5453; return (x - Math.floor(x) - 0.5) * k; };
  let d = '';
  for (let i = 0; i < 10; i++) { const y = i * 100 + 50; d += `M${(50 + j(4, i)).toFixed(1)} ${(y + j(3, i + 20)).toFixed(1)} Q${W / 2 + j(8, i + 7)} ${(y + j(6, i + 9)).toFixed(1)} ${(W - 50 + j(4, i + 3)).toFixed(1)} ${(y + j(3, i + 5)).toFixed(1)} `; }
  for (let i = 0; i < 9; i++) { const x = i * 100 + 50; d += `M${(x + j(3, i + 60)).toFixed(1)} ${(50 + j(4, i + 70)).toFixed(1)} Q${(x + j(6, i + 80)).toFixed(1)} ${H / 2 + j(8, i + 90)} ${(x + j(3, i + 100)).toFixed(1)} ${(H - 50 + j(4, i + 110)).toFixed(1)} `; }
  let pal = '';
  for (const y0 of [50, 750]) pal += `M350 ${y0} L550 ${y0 + 200} M550 ${y0} L350 ${y0 + 200} `;
  boardEl.innerHTML = `<svg class="jgrid" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="#1b1b1b" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path d="${pal}" fill="none" stroke="#1b1b1b" stroke-width="1.8" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  boardEl.setAttribute('role', 'grid');
  ptEls = new Array(90);
  for (let vr = 0; vr < 10; vr++) for (let vf = 0; vf < 9; vf++) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'pt';
    el.style.left = `${vf * (100 / 9)}%`; el.style.top = `${vr * 10}%`;
    el.addEventListener('click', () => onPoint(pointAt(vf, vr)));
    boardEl.appendChild(el);
    ptEls[vr * 9 + vf] = el;
  }
  api.tray.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="pass"]')) return;
    if (playing && state.side === human && state.legal.includes(PASS)) commit(PASS);
  });
}
const elAt = (s) => { const [x, y] = vis(s); return ptEls[y * 9 + x]; };
function render(anim) {
  const st = state, targets = new Map();
  if (sel >= 0) for (const m of st.legal) if (m !== PASS && mFrom(m) === sel) targets.set(mTo(m), isCap(m));
  const last = st.last && st.last !== PASS ? st.last : 0, lf = last ? mFrom(last) : -1, lt = last ? mTo(last) : -1;
  const checkSq = st.check ? st.king : -1;
  for (let s = 0; s < 90; s++) {
    const el = elAt(s), p = st.b[s];
    el.classList.toggle('last', s === lt);
    el.classList.toggle('from', s === lf);
    el.classList.toggle('sel', s === sel);
    el.classList.toggle('check', s === checkSq);
    let h = p ? pieceSvg(p) : '';
    if (targets.has(s)) h += targets.get(s) ? '<span class="ring"></span>' : '<span class="dot"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    const name = p ? ` ${sideName(p & 8)} ${pieceName(p)}` : ' 빈 점';
    el.setAttribute('aria-label', ptName(s) + name + (targets.has(s) ? (targets.get(s) ? ', 잡으며 이동 가능' : ', 여기로 이동 가능') : '') + (s === checkSq ? ', 장군' : ''));
  }
  if (anim && anim !== PASS && !reduced()) {
    hopPiece(elAt(mTo(anim)).querySelector('.jp'), elAt(mFrom(anim)), elAt(mTo(anim)));
    trailLine(centre(mFrom(anim)), centre(mTo(anim)));
  }
}
function trailLine(a, b) { trail(boardEl, 9, [a[0] * 9 / 9, a[1] * 0.9], [b[0], b[1] * 0.9]); }
function scribble(s, p) {
  if (reduced()) return;
  const [x, y] = vis(s), el = document.createElement('div');
  el.className = 'ghost ' + colorOf(p & 8);
  el.style.left = `${x * (100 / 9)}%`; el.style.top = `${y * 10}%`;
  el.innerHTML = pieceSvg(p) + '<svg class="x" viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>';
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
const clearDoodles = () => { for (const e of boardEl.querySelectorAll('.trail, .ghost')) e.remove(); };
function stop() { g++; inBook = true; firstSearch = false; if (engine) engine.restart(); }

export default {
  id: 'janggi',
  name: '장기',
  sides: [
    { id: CHO, first: true, html: '<span class="chip cho"></span>초 · 선공' },
    { id: HAN, first: false, html: '<span class="chip han"></span>한 · 후공' },
  ],
  options: [{ key: 'arr', label: '내 상차림', choices: ARR_NAMES.map((n, i) => ({ id: String(i), html: n })), default: '2' },
    { key: 'script', label: '말 글씨', choices: [{ id: 'hangul', html: '한글' }, { id: 'hanja', html: '한자' }], default: 'hangul' }],
  optionChanged(key, val) {
    if (key === 'arr' && !playing) { myArr = Number(val); state = replay(); render(); }
    if (key === 'script') { script = val === 'hanja' ? 'hanja' : 'hangul'; render(); }
  },
  lines: LINES,
  chat: ['chatJanggi'],
  longGame: 90,
  rules: {
    title: '장기, 규칙도 몰라?',
    html: `
    <li><b>상대 궁을 잡히기 직전으로 몰고 피할 길이 없게 만들면 이긴다(외통).</b> 초가 먼저 둔다.
      <span class="aside">궁을 공격하는 수가 장군이야. 장군을 받으면 꼭 풀어야 해.</span></li>
    <li><b>궁과 사:</b> 궁성(빗금 그은 3×3) 안에서만 선을 따라 한 칸(대각선 선이 있으면 대각선도).</li>
    <li><b>차:</b> 가로·세로로 멀리. 궁성 안에서는 대각선 선을 따라서도. <b>포:</b> 말 하나를 꼭 뛰어넘어서 간다(잡을 때도).
      포는 포를 넘을 수도, 잡을 수도 없다.</li>
    <li><b>마:</b> 한 칸 곧게 가고 대각선으로 한 칸. <b>상:</b> 한 칸 곧게 가고 대각선으로 두 칸.
      <span class="aside">가는 길 중간에 말이 있으면 못 가. 상차림(마·상 자리)은 대국 전에 골라.</span></li>
    <li><b>졸·병:</b> 앞이나 옆으로 한 칸. 상대 궁성 안에서는 앞쪽 대각선 선을 따라서도. 뒤로는 못 간다.</li>
    <li><b>한수 쉼:</b> 장군을 받은 게 아니면 판 아래 단추로 한 번 쉴 수 있다.</li>
    <li><b>빅장:</b> 궁끼리 사이에 아무것도 없이 마주 보면, 받은 쪽은 그걸 푸는 수만 둘 수 있다. 안 풀고 쉬면 점수로 끝.</li>
    <li><b>점수로 끝나는 때:</b> 빅장을 받고 쉴 때, 둘 다 연달아 쉴 때, 같은 국면이 세 번 나올 때, 200수가 됐을 때. 차 13, 포 7, 마 5, 상 3, 사 3, 졸 2점이고 한은 1.5점을 더 받는다(덤). 그래서 비기지 않아.</li>`,
  },
  debug: () => ({ legal: state.legal.filter((m) => m !== PASS), pass: state.legal.includes(PASS), stm: state.side, human, over: !!state.result, playing,
    plies: moves.length, cells: (() => { const c = {}; for (let s = 0; s < 90; s++) { const [x, y] = vis(s); c[s] = y * 9 + x; } return c; })() }),
  mount(a) {
    api = a; boardEl = a.board;
    myArr = Number((a.options && a.options.arr) || 2);
    script = a.options && a.options.script === 'hanja' ? 'hanja' : 'hangul';
    build();
    state = replay();
    render();
  },
  start(side, opts) {
    stop();
    human = side; myArr = Number((opts && opts.arr) || 2); penArr = Math.floor(Math.random() * 4);
    script = opts && opts.script === 'hanja' ? 'hanja' : 'hangul';
    moves = []; sel = -1; playing = true; prevCapture = null;
    clearDoodles();
    boardEl.setAttribute('aria-label', `장기 판, 나는 ${sideName(side)}, 내 상차림 ${ARR_NAMES[myArr]}, ${api.name} 상차림 ${ARR_NAMES[penArr]}`);
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    const had = moves.length > 0;
    playing = false; moves = []; sel = -1; human = CHO; prevCapture = null; penArr = 2;
    tray();
    state = replay();
    if (had && !reduced()) wipe(boardEl, 9, () => { clearDoodles(); render(); });
    else { clearDoodles(); render(); }
  },
};
