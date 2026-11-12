// Game of the Amazons. The engine is amazons-hippolyta's Rust engine (WASM, built into pkg/), unchanged.
// Penopi plays its strongest setting, as on amazons-hippolyta's page (difficulty 5): MCTS for 2 s on
// several workers at once, root statistics merged (combineInfos below is that page's code).
// A move is two steps: move an amazon, then shoot an arrow from where it landed. The page shows which
// step I'm on, draws the amazon at its new square while I aim, and lets me take the step back or cancel.
import { LINES } from './lines.js';
import { workerClient, spareCores } from '../shared/engine.js';
import { gridSvg, hopPiece, trail, overlay, wipe } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2000, HARD_LIMIT = THINK_MS + 6000;
const SEARCHERS = spareCores(4);
const FILES = 'abcdefghij';
const sqName = (sq) => FILES[sq % 10] + (Math.floor(sq / 10) + 1);
const colorName = (c) => (c === 0 ? '백' : '흑');
const colorCls = (c) => (c === 0 ? 'w' : 'b');
const START = (() => { // the starting position, drawn before any worker has answered
  const c = new Array(100).fill(0);
  for (const s of [3, 6, 30, 39]) c[s] = 1;
  for (const s of [60, 69, 93, 96]) c[s] = 2;
  return c;
})();
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

let api, boardEl, cellEls = [];
let human = 0, history = [], state = null, tree = new Map(), sel = { from: -1, to: -1 };
let playing = false, g = 0, workers = [], provenSaid = false, splitSaid = false, sending = false;

// ---------- workers ----------
const pool = () => {
  while (workers.length < SEARCHERS) workers.push(workerClient(new URL('./worker.js', import.meta.url)));
  return workers;
};
async function load() {
  const r = await pool()[0].call({ type: 'state', history: history.slice() }, { timeout: 15000 });
  setState(r.state);
}
// every searcher searches the same position with its own seed; jitter makes them explore differently
async function parallelSearch() {
  const jobs = pool().map((w, i) =>
    w.call({ type: 'search', history: history.slice(), ms: THINK_MS, seed: i ? 1 + i + Math.floor(Math.random() * 1e9) : 0, jitter: i ? 0.5 : 0 }, { timeout: HARD_LIMIT })
      .then((r) => r.info, () => null));
  const infos = (await Promise.all(jobs)).filter(Boolean);
  return infos.length ? combineInfos(infos) : null;
}
// Merge root statistics of independent searches: visits add up, values are visit-weighted.
// A proven result from any searcher wins outright. (amazons-hippolyta web/main.js)
function combineInfos(infos) {
  const byMove = new Map();
  let iterations = 0, proven = 0, provenMove = null;
  for (const info of infos) {
    iterations += info.iterations;
    if (info.proven && !proven) { proven = info.proven; provenMove = info.candidates[0]; }
    for (const c of info.candidates) {
      const o = byMove.get(c.move);
      if (o) { if (c.visits) { o.qsum += c.q * c.visits; o.visits += c.visits; } }
      else byMove.set(c.move, { ...c, qsum: c.visits ? c.q * c.visits : 0 });
    }
  }
  const candidates = [...byMove.values()].sort((a, b) => b.visits - a.visits || b.prior - a.prior);
  for (const c of candidates) c.q = c.visits ? c.qsum / c.visits : null;
  const best = candidates[0];
  const value = proven || (best && best.q != null ? best.q : 0);
  return { iterations, proven, value, best: proven ? provenMove : best };
}

function setState(s) {
  state = s;
  tree = new Map();
  const L = s.legal;
  for (let i = 0; i < L.length; i += 3) {
    let tos = tree.get(L[i]);
    if (!tos) tree.set(L[i], (tos = new Map()));
    let arrows = tos.get(L[i + 1]);
    if (!arrows) tos.set(L[i + 1], (arrows = new Set()));
    arrows.add(L[i + 2]);
  }
  sel = { from: -1, to: -1 };
}

// ---------- reading the board (for what Penopi says) ----------
const rc = (s) => [Math.floor(s / 10), s % 10];
function reach(cells, s) { // squares an amazon on s could move to
  let n = 0;
  const [r0, c0] = rc(s);
  for (const [dr, dc] of DIRS) for (let r = r0 + dr, c = c0 + dc; r >= 0 && r < 10 && c >= 0 && c < 10 && !cells[r * 10 + c]; r += dr, c += dc) n++;
  return n;
}
const amazons = (cells, colour) => cells.flatMap((v, s) => (v === colour + 1 ? [s] : []));
const stuck = (cells, colour) => amazons(cells, colour).filter((s) => reach(cells, s) === 0).length;
// Rooms of empty squares (joined by king steps). Split = no room touches amazons of both colours;
// then each side's count is the size of the rooms only it touches.
function rooms(cells) {
  const seen = new Array(100).fill(false);
  let mixed = false;
  const own = [0, 0];
  for (let s = 0; s < 100; s++) {
    if (cells[s] || seen[s]) continue;
    const stack = [s], touch = new Set();
    let size = 0;
    seen[s] = true;
    while (stack.length) {
      const q = stack.pop(); size++;
      const [r0, c0] = rc(q);
      for (const [dr, dc] of DIRS) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || r > 9 || c < 0 || c > 9) continue;
        const t = r * 10 + c;
        if (cells[t] === 1 || cells[t] === 2) touch.add(cells[t] - 1);
        else if (!cells[t] && !seen[t]) { seen[t] = true; stack.push(t); }
      }
    }
    if (touch.size === 2) mixed = true;
    else if (touch.size === 1) own[[...touch][0]] += size;
  }
  return { split: !mixed, own };
}
const adjacent = (a, b) => { const [r1, c1] = rc(a), [r2, c2] = rc(b); return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)) === 1; };

// ---------- flow ----------
async function next() {
  if (!playing) return;
  if (state.over) { finish(); return; }
  if (state.side === human) {
    api.yourTurn({ text: humanStatus() });
    renderTray();
  } else await engineMove();
  render();
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorCls(1 - human) });
  renderTray();
  render();
  const info = await parallelSearch();
  if (my !== g) return;
  let move = info && info.best && info.best.sq;
  if (!move || !state.legal.length) { // no search answer: any legal move (never expected)
    if (!state.legal.length) return;
    move = state.legal.slice(0, 3);
  }
  const before = state.cells.slice();
  await play(move);
  if (my !== g) return;
  engineTalk(info, before, move);
  next();
}
async function play(move) {
  const before = state.cells.slice();
  history.push(...move);
  const my = g;
  let r;
  try { r = await pool()[0].call({ type: 'state', history: history.slice() }, { timeout: 15000 }); }
  catch { return; }
  if (my !== g) return;
  setState(r.state);
  render(move, before);
}
function humanStatus() {
  const c = colorCls(human), chip = api.chip(c), who = `내 차례 (${colorName(human)})`;
  if (sel.to >= 0) return `${chip}${who} · 화살 쏠 칸`;
  if (sel.from >= 0) return `${chip}${who} · 옮길 칸`;
  return `${chip}${who} · 아마존을 골라`;
}
async function humanMove(move) {
  if (sending) return;
  sending = true;
  const before = state.cells.slice();
  api.status(`${api.chip(colorCls(human))}${sqName(move[0])}-${sqName(move[1])}(${sqName(move[2])})`);
  await play(move);
  sending = false;
  const facts = [];
  if (!state.over) {
    if (stuck(state.cells, 1 - human) > stuck(before, 1 - human)) facts.push(['humanTrap']);
    else if (stuck(state.cells, human) > stuck(before, human)) facts.push(['selfTrap', null, 0.8]);
  }
  api.humanMoved({ facts, plies: history.length / 3 });
  next();
}
function engineTalk(info, before, move) {
  if (state.over) return;
  const me = 1 - human, v = info ? (me === 0 ? info.value : -info.value) : 0;
  const facts = [];
  if (info && info.proven && v > 0 && !provenSaid) { provenSaid = true; facts.push(['provenWin']); }
  if (stuck(state.cells, human) > stuck(before, human)) facts.push(['engineTrap']);
  const room = rooms(state.cells);
  if (room.split && !splitSaid) { splitSaid = true; facts.push(['split', { a: room.own[me], b: room.own[human] }]); }
  if (amazons(state.cells, human).some((s) => adjacent(s, move[2]))) facts.push(['arrowClose', null, 0.25]);
  api.engineMoved({
    p: (v + 1) / 2,
    doomed: !!(info && info.proven && v < 0),
    nodes: info ? info.iterations : 0,
    facts,
  });
}
function finish() {
  playing = false;
  renderTray();
  const mine = state.winner === human;
  api.over({
    winner: mine ? 'human' : 'penopi',
    vars: { n: Math.ceil(history.length / 6) },
    text: `${api.chip(colorCls(state.winner))}${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
}

// ---------- input: amazon → where it goes → where it shoots ----------
function onCell(sq) {
  if (sending || !playing || !state || state.over || state.side !== human) return;
  if (sel.to >= 0) { // aiming
    if (tree.get(sel.from).get(sel.to).has(sq)) { humanMove([sel.from, sel.to, sq]); return; }
    if (sq === sel.to) { sel.to = -1; changed(); return; } // tap the moved amazon again: back to step 1
    if (tree.has(sq) && sq !== sel.from) { sel = { from: sq, to: -1 }; changed(); peek(sq); return; }
    return; // a stray tap while aiming does nothing: the arrow step is easy to lose otherwise
  }
  if (sel.from >= 0 && tree.get(sel.from).has(sq)) sel.to = sq;
  else if (tree.has(sq) && sq !== sel.from) { sel.from = sq; peek(sq); }
  else sel.from = -1;
  changed();
}
function changed() { api.status(humanStatus()); renderTray(); render(); }
let peekPly = -1;
function peek(sq) {
  const col = flipped() ? 9 - (sq % 10) : sq % 10;
  api.peek((col + 0.5) / 10, peekPly !== history.length);
  peekPly = history.length;
}
function cancel() { if (sel.from >= 0) { sel = { from: -1, to: -1 }; changed(); } }
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.querySelector('dialog[open]')) cancel();
});
// under the board: ① move ② shoot, which one I'm on, and buttons to step back or cancel
function renderTray() {
  const t = api.tray;
  const mine = playing && state && !state.over && state.side === human;
  if (!mine) { t.hidden = true; t.innerHTML = ''; return; }
  const step = sel.to >= 0 ? 2 : 1;
  const b = (n, label) => `<b class="${n < step ? 'done' : n === step ? 'now' : ''}">${n}</b>${label}`;
  const html = `<span class="step">${b(1, '이동')}</span><span class="step">${b(2, '화살')}</span>`
    + (sel.to >= 0 ? '<button type="button" class="btn small" data-act="back">이동 다시</button>' : '')
    + `<button type="button" class="btn small" data-act="cancel"${sel.from < 0 ? ' disabled' : ''}>취소</button>`;
  if (t.dataset.h !== html) { t.innerHTML = html; t.dataset.h = html; }
  t.hidden = false;
}

// ---------- drawing ----------
const flipped = () => human === 1; // my side at the bottom
function squareAt(i) {
  const vr = Math.floor(i / 10), vc = i % 10;
  return flipped() ? vr * 10 + (9 - vc) : (9 - vr) * 10 + vc;
}
const visualOf = (sq) => { const r = Math.floor(sq / 10), c = sq % 10; return flipped() ? r * 10 + (9 - c) : (9 - r) * 10 + c; };
const centre = (sq) => { const v = visualOf(sq); return [(v % 10) * 100 + 50, Math.floor(v / 10) * 100 + 50]; };
// a little crown, wobbled per square so no two look quite the same
function amazonSvg(colour, sq, extra = '') {
  const k = ((sq * 37) % 7) - 3;
  return `<svg class="amz ${colorCls(colour)} ${extra}" viewBox="0 0 40 40" aria-hidden="true" style="rotate:${k * 2}deg">
    <path class="body" d="M7 33 L5.5 13 L13.5 21 L20 7.5 L26.5 21 L34.5 12.5 L33 33 Z"/>
    <path class="band" fill="none" d="M9 28.5 C16 27 24 27.5 31 28.5"/></svg>`;
}
function build() {
  boardEl.setAttribute('role', 'grid');
  for (let i = 0; i < 100; i++) {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'sq' + ((Math.floor(i / 10) + i) % 2 ? ' dk' : '');
    d.addEventListener('click', () => onCell(squareAt(i)));
    boardEl.appendChild(d); cellEls.push(d);
  }
  boardEl.insertAdjacentHTML('beforeend', gridSvg(10));
  api.tray.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'cancel') cancel();
    if (a.dataset.act === 'back' && sel.to >= 0) { sel.to = -1; changed(); }
  });
}
function render(move, before) {
  const cells = state ? state.cells : START;
  const aiming = sel.to >= 0;
  const dests = sel.from >= 0 && !aiming ? tree.get(sel.from) : null;
  const aims = aiming ? tree.get(sel.from).get(sel.to) : null;
  const last = history.length ? history.slice(-3) : [];
  for (let i = 0; i < 100; i++) {
    const sq = squareAt(i), el = cellEls[i], v = cells[sq];
    let h = '';
    if (aiming && sq === sel.from) h = amazonSvg(human, sq, 'left');        // the square it left
    else if (aiming && sq === sel.to) h = amazonSvg(human, sq);             // drawn where it will land
    else if (v === 1 || v === 2) h = amazonSvg(v - 1, sq);
    else if (v === 3) h = `<span class="burn${move && sq === move[2] ? ' new' : ''}" style="--r:${((sq * 53) % 9) - 4}deg"></span>`;
    if (dests && dests.has(sq)) h += '<span class="dot"></span>';
    if (aims && aims.has(sq)) h += '<span class="aim"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.classList.toggle('sel', sq === (aiming ? sel.to : sel.from));
    el.classList.toggle('last', last.includes(sq) && !aiming);
    const what = v === 1 ? ' 백 아마존' : v === 2 ? ' 흑 아마존' : v === 3 ? ' 화살' : ' 빈칸';
    el.setAttribute('aria-label', sqName(sq) + what + (dests && dests.has(sq) ? ', 여기로 이동' : aims && aims.has(sq) ? ', 여기로 화살' : ''));
  }
  if (move && !reduced()) {
    const [f, t, a] = move, fromEl = cellEls[visualOf(f)], toEl = cellEls[visualOf(t)];
    hopPiece(toEl.querySelector('.amz'), fromEl, toEl);
    trail(boardEl, 10, centre(f), centre(t));
    const burn = cellEls[visualOf(a)].querySelector('.burn');
    if (burn) { burn.style.animationDelay = '.45s'; burn.style.animationFillMode = 'backwards'; }
    setTimeout(() => shot(centre(t), centre(a)), 420);
  }
}
function shot(from, to) { // the arrow's flight: a quick red pen stroke
  const svg = overlay('trail', 10);
  svg.innerHTML = `<path class="shot" pathLength="1" vector-effect="non-scaling-stroke" d="M${from[0]} ${from[1]} L${to[0]} ${to[1]}"/>`;
  boardEl.appendChild(svg);
  setTimeout(() => svg.remove(), 1500);
}

function stop() {
  g++;
  for (const w of workers) w.restart(); // don't wait out a search
}

export default {
  id: 'amazons',
  name: '아마존',
  sides: [
    { id: 0, first: true, html: '<span class="chip w"></span>백 · 선공' },
    { id: 1, first: false, html: '<span class="chip b"></span>흑 · 후공' },
  ],
  lines: LINES,
  chat: ['chatAmazons'],
  longGame: 70,
  rules: {
    html: `
    <li><b>내 차례에 둘 수가 없으면 진다.</b> 비기는 일은 없어.
      <span class="aside">그러니까 끝까지 움직일 자리를 남겨 두는 쪽이 이겨.</span></li>
    <li><b>각자 아마존 넷으로 시작한다.</b> 판은 10×10, 백이 먼저 둔다.
      <span class="aside">처음 자리는 판에 그려진 그대로야.</span></li>
    <li><b>한 수는 두 단계다. ① 아마존 하나를 옮기고 ② 옮긴 그 아마존이 화살을 쏜다.</b>
      둘 다 해야 한 수가 끝나.
      <svg viewBox="0 0 400 96" aria-label="아마존이 세 칸 옮긴 뒤 대각선으로 화살을 쏘는 그림">
        <g fill="none" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round">
          <path d="M2 6 H398 M2 90 H398"/>
          <path d="M14 70 L12 40 L24 52 L33 32 L42 52 L54 40 L52 70 Z" fill="#fdfdfb" stroke-width="2.4" stroke-dasharray="4 4" opacity=".5"/>
          <path d="M44 36 Q110 0 176 34" stroke="#d8452f" stroke-width="2.6"/><path d="M162 26 L177 35 L160 40" stroke="#d8452f" stroke-width="2.6"/>
          <path d="M184 70 L182 40 L194 52 L203 32 L212 52 L224 40 L222 70 Z" fill="#fdfdfb" stroke-width="2.4"/>
          <path d="M228 44 L300 20" stroke="#d8452f" stroke-width="2.6" stroke-dasharray="6 5"/>
          <path d="M306 10 L338 42 M338 10 L306 42" stroke-width="3"/>
        </g>
        <text x="96" y="86" font-size="18" text-anchor="middle" fill="#1b1b1b">① 이동</text>
        <text x="300" y="86" font-size="18" text-anchor="middle" fill="#1b1b1b">② 화살</text>
      </svg>
      <span class="aside">판에서는 아마존을 누르고, 갈 칸(빨간 점), 쏠 칸(빨간 ×) 순서로 누르면 돼. 화살 고르다 마음이 바뀌면 옮긴 아마존을 다시 누르거나 아래 '이동 다시'.</span></li>
    <li><b>아마존도 화살도 체스의 퀸처럼 간다.</b> 가로, 세로, 대각선으로 원하는 만큼.
      <span class="aside">대신 빈칸으로만. 아마존이든 화살이든 뭔가 있으면 거기서 막혀.</span></li>
    <li><b>화살이 꽂힌 칸은 끝까지 아무도 못 쓴다.</b>
      <span class="aside">방금 떠난 칸에 쏴도 돼. 뒷문 잠그는 거지.</span></li>
    <li><b>판이 갈라지면 칸 수 싸움이다.</b> 내 아마존만 있는 방에서 한 칸씩 채워 나가는 셈이야.
      <span class="aside">그때 가서 칸 세는 건 내가 더 빨라.</span></li>`,
    note: 'El Juego de las Amazonas는 Ediciones de Mente의 상표입니다.',
  },
  debug: () => ({ legal: state ? state.legal.slice() : [], side: state && state.side, human, over: !!(state && state.over), playing, plies: history.length / 3,
    cells: Array.from({ length: 100 }, (_, sq) => visualOf(sq)) }),
  mount(a) {
    api = a; boardEl = a.board;
    build();
    render();
    load().then(render).catch(() => {});
  },
  async start(side) {
    stop();
    const my = g;
    human = side; history = []; playing = true; provenSaid = splitSaid = false;
    for (const e of boardEl.querySelectorAll('.trail')) e.remove();
    boardEl.setAttribute('aria-label', '아마존 판, 나는 ' + colorName(side));
    try { await load(); } catch (err) { if (my === g) api.status('엔진을 불러오지 못했어'); return; }
    if (my !== g) return;
    render();
    next();
  },
  reset() {
    stop();
    const had = history.length > 0;
    playing = false; history = []; human = 0;
    renderTray();
    const redraw = () => { state = null; sel = { from: -1, to: -1 }; render(); load().then(render).catch(() => {}); };
    if (had && !reduced()) wipe(boardEl, 10, redraw); else redraw();
  },
};
