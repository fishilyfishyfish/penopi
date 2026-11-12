// International draughts. The engine (engine.js) was written for this site: alpha-beta in plain JS, loaded on
// the page for the rules and in worker.js for thinking (as LOA 튀르크 did). Board and doodles follow LOA 튀르크.
// Input: tap a piece, then where it ends up. Capturing is compulsory, so when I must capture only the pieces
// that can are ringed. If two capture routes end on the same square, the page asks for the route: tap the
// squares it lands on along the way.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { gridSvg, hopPiece, trail, wipe } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.DraughtsEngine({ ttBits: 8 });
const WIN = R.WIN, MATE = R.MATE_BOUND, NUM = R.NUM;
const sideName = (p) => (p === 1 ? '백' : '흑');
const colorOf = (p) => (p === 1 ? 'w' : 'b');
const pieceSide = (v) => (v === 0 ? 0 : v <= 2 ? 1 : 2);
const plain = (m) => ({ from: m.from, to: m.to, caps: m.caps.slice() }); // what the worker needs to replay a move

let api, boardEl, sqEls = [];
let human = 1, moves = [], state = null, sel = -1, via = [], playing = false, g = 0, askRoute = false;
let engine = null, localE = null;

function replay() {
  R.setStart();
  let result = '';
  for (const m of moves) { R.play(m); result = R.status(); if (result) break; }
  const legal = result ? [] : R.legalMoves();
  return { b: Array.from(R.board), stm: R.stm, result, legal, last: moves.length ? moves[moves.length - 1] : null,
           mustCapture: legal.length > 0 && legal[0].caps.length > 0 };
}

// ---------- thinking ----------
function client() {
  if (!engine) engine = workerClient(new URL('./worker.js', import.meta.url), { type: 'classic' });
  return engine;
}
async function think(time) {
  try {
    return await client().call({ moves: moves.map(plain), time }, { timeout: HARD_LIMIT });
  } catch (err) {
    if (/다시 시작/.test(err.message)) return null;
    if (!(err instanceof TimeoutError)) console.warn(err);
    if (!localE) localE = globalThis.DraughtsEngine({ ttBits: 16 });
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600) });
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
  const same = (a, b) => a.from === b.from && a.to === b.to && a.caps.length === b.caps.length && a.caps.every((c, i) => c === b.caps[i]);
  const m = (info.move && state.legal.find((x) => same(x, info.move))) || state.legal[0];
  commit(m, info);
}

// ---------- moves ----------
function commit(m, info) {
  const mover = state.stm, before = state.b;
  moves.push(m); sel = -1; via = []; askRoute = false;
  for (const c of m.caps) scribble(c, before[c]);
  state = replay();
  render(m);
  if (mover === human) humanTalk(m); else engineTalk(m, info);
  if (m.caps.length && mover !== human) api.runTo((visual(m.to) % 10 + 0.5) / 10);
  next();
}
function next() {
  if (!playing) return;
  if (state.result) { finish(); return; }
  if (state.stm === human) api.yourTurn({ color: colorOf(human), label: sideName(human), text: myStatus() });
  else engineMove();
  render();
}
function myStatus() {
  const base = `${api.chip(colorOf(human))}내 차례 (${sideName(human)})`;
  if (sel >= 0 && (via.length || askRoute)) return `${base} · 거쳐 갈 칸을 눌러`;
  return state.mustCapture ? `${base} · 잡아야 해` : base;
}
function humanTalk(m) {
  if (state.result) return;
  const facts = [], k = m.caps.length;
  if (k >= 3) facts.push(['humanBigCap', { k }]);
  else if (k) facts.push(['humanCap', null, 0.6]);
  if (m.promote) facts.unshift(['humanKing']);
  api.humanMoved({ facts, plies: moves.length });
}
function engineTalk(m, info) {
  if (state.result) return;
  const sc = info ? info.score : 0, k = m.caps.length, facts = [];
  if (m.promote) facts.push(['engineKing']);
  if (k >= 3) facts.push(['engineBigCap', { k }]);
  else if (k) facts.push(['engineCap', null, 0.6]);
  if (state.mustCapture && !k) facts.push(['offerCapture', null, 0.5]);
  api.engineMoved({
    p: 1 / (1 + Math.exp(-sc / 200)),
    mate: sc >= MATE ? Math.ceil((WIN - sc) / 2) - 1 : 0,
    doomed: sc <= -MATE,
    nodes: info && info.nodes, depth: info && info.depth,
    facts,
  });
}
function finish() {
  playing = false;
  const r = state.result;
  if (r.startsWith('draw')) {
    const why = r.split(':')[1];
    api.over({ winner: 'draw', key: { repetition: 'drawRepetition', endgame: 'drawEndgame', kings: 'drawKings' }[why], text: '무승부' });
    return;
  }
  const winner = 3 - state.stm, mine = winner === human; // the side to move has no move
  api.over({
    winner: mine ? 'human' : 'penopi',
    vars: { n: Math.ceil(moves.length / 2) },
    text: `${api.chip(colorOf(winner))}${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
}

// ---------- input ----------
// legal moves from the selected piece that follow the route tapped so far
const candidates = () => state.legal.filter((m) => m.from === sel && via.every((v, i) => m.path[i] === v));
function onSquare(s) {
  if (!playing || state.result || state.stm !== human) return;
  if (sel >= 0) {
    const cands = candidates();
    const ending = cands.filter((m) => m.to === s);
    if (ending.length === 1) { commit(ending[0]); return; }
    const along = cands.filter((m) => m.path.length > via.length + 1 && m.path[via.length] === s);
    if (along.length) { // a square on the way: remember it and narrow the choice
      via.push(s); askRoute = false;
      const left = candidates();
      if (left.length === 1) { commit(left[0]); return; }
      changed(); return;
    }
    if (ending.length > 1) { askRoute = true; changed(); return; } // two routes end here: which way?
  }
  askRoute = false;
  if (pieceSide(state.b[s]) === human && state.legal.some((m) => m.from === s)) {
    sel = s; via = [];
    peek(s);
  } else { sel = -1; via = []; }
  changed();
}
function changed() { api.status(myStatus()); render(); }
let peekPly = -1;
function peek(s) {
  api.peek((visual(s) % 10 + 0.5) / 10, peekPly !== moves.length);
  peekPly = moves.length;
}
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sel >= 0 && !document.querySelector('dialog[open]')) { sel = -1; via = []; changed(); }
});

// ---------- drawing ----------
// my side at the bottom: as White as is (White starts at the bottom), as Black the board turned around
const visual = (s) => (human === 1 ? s : 99 - s);
const centre = (s) => { const v = visual(s); return [(v % 10) * 100 + 50, Math.floor(v / 10) * 100 + 50]; };
function pieceHtml(v, s) {
  const c = v <= 2 ? 'w' : 'b', king = v === 2 || v === 4;
  // no CSS rotate here: it would also turn the hop animation (see CLAUDE.md); the wobbly outline is enough
  return `<span class="piece ${c}${king ? ' k' : ''}" style="--d:${(s % 10 + Math.floor(s / 10)) * 22}ms">${king
    ? '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M10 27 L8 14 L15 20 L20 11 L25 20 L32 14 L30 27 Z"/></svg>' : ''}</span>`;
}
function build() {
  boardEl.setAttribute('role', 'grid');
  for (let v = 0; v < 100; v++) {
    const el = document.createElement('button');
    el.type = 'button';
    const dark = (Math.floor(v / 10) + (v % 10)) % 2 === 1;
    el.className = 'sq' + (dark ? ' dk' : ' lt');
    if (dark) el.addEventListener('click', () => onSquare(human === 1 ? v : 99 - v));
    else el.tabIndex = -1;
    boardEl.appendChild(el); sqEls.push(el);
  }
  boardEl.insertAdjacentHTML('beforeend', gridSvg(10));
}
function render(anim) {
  const st = state;
  const cands = sel >= 0 ? candidates() : [];
  const ends = new Set(), steps = new Set(), capsShown = new Set();
  const byTo = new Map();
  for (const m of cands) byTo.set(m.to, (byTo.get(m.to) || 0) + 1);
  for (const m of cands) {
    ends.add(m.to);
    if (byTo.get(m.to) > 1 && m.path.length > via.length + 1) steps.add(m.path[via.length]); // route choice needed
    if (cands.length === 1 || via.length) m.caps.forEach((c) => capsShown.add(c));
  }
  const movable = new Set(st.mustCapture && playing && st.stm === human && sel < 0 ? st.legal.map((m) => m.from) : []);
  const last = st.last, lastSet = new Set(last ? [last.from, last.to] : []);
  for (let v = 0; v < 100; v++) {
    const s = human === 1 ? v : 99 - v, el = sqEls[v];
    if (!el.classList.contains('dk')) continue;
    const p = st.b[s];
    el.classList.toggle('last', lastSet.has(s));
    el.classList.toggle('sel', s === sel);
    el.classList.toggle('via', via.includes(s));
    let h = p ? pieceHtml(p, s) : '';
    if (movable.has(s)) h += '<span class="must"></span>';
    if (capsShown.has(s)) h += '<span class="ring"></span>';
    if (ends.has(s)) h += '<span class="dot"></span>';
    else if (steps.has(s)) h += '<span class="step"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    const name = p ? (p === 1 ? ' 백' : p === 2 ? ' 백 킹' : p === 3 ? ' 흑' : ' 흑 킹') : ' 빈칸';
    el.setAttribute('aria-label', NUM[s] + name + (ends.has(s) ? ', 여기로 이동 가능' : steps.has(s) ? ', 거쳐 가는 칸' : ''));
  }
  if (anim && !reduced()) {
    const to = sqEls[visual(anim.to)], from = sqEls[visual(anim.from)];
    hopPiece(to.querySelector('.piece'), from, to);
    let at = anim.from;
    for (const l of anim.path) { trail(boardEl, 10, centre(at), centre(l)); at = l; }
  }
}
function scribble(s, v) {
  if (reduced() || !v) return;
  const vv = visual(s), el = document.createElement('div');
  el.className = 'ghost ' + (v <= 2 ? 'w' : 'b');
  el.style.left = (vv % 10) * 10 + '%'; el.style.top = Math.floor(vv / 10) * 10 + '%';
  el.innerHTML = pieceHtml(v, s) + '<svg class="x" viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>';
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
const clearDoodles = () => { for (const e of boardEl.querySelectorAll('.trail, .ghost')) e.remove(); };
function stop() { g++; if (engine) engine.restart(); }

export default {
  id: 'draughts',
  name: '국제 드래프트',
  sides: [
    { id: 1, first: true, html: '<span class="chip w"></span>백 · 선공' },
    { id: 2, first: false, html: '<span class="chip b"></span>흑 · 후공' },
  ],
  lines: LINES,
  chat: ['chatDraughts'],
  longGame: 90,
  rules: {
    html: `
    <li><b>상대가 둘 수 없게 만들면 이긴다.</b> 말을 다 잡거나, 남은 말이 전부 꼼짝 못 하게 막으면 돼.</li>
    <li><b>10×10 판의 빗금 친 칸만 쓴다. 각자 말 20개, 백이 먼저.</b></li>
    <li><b>말은 대각선 앞으로 한 칸씩 간다.</b> 잡을 때만 뒤로도 갈 수 있어: 바로 옆 대각선의 상대 말을 뛰어넘어 그 너머 빈칸에 내려.
      <span class="aside">한 번 넘은 뒤에도 또 넘을 수 있으면 계속 넘어. 한 수에 여러 개 잡는 거야.</span></li>
    <li><b>잡을 수 있으면 반드시 잡아야 한다. 여러 방법이 있으면 가장 많이 잡는 방법으로.</b>
      <span class="aside">그래서 일부러 하나 내주고 여러 개 쓸어 가는 수가 나와. 내가 좋아하는 거.</span></li>
    <li><b>잡힌 말은 그 수가 끝난 뒤에 치운다.</b> 그때까지는 판에 남아 있어서, 같은 말을 두 번 넘을 수도, 그 말을 지나갈 수도 없어.</li>
    <li><b>상대 쪽 끝 줄에서 수를 마치면 킹이 된다.</b> 잡는 도중에 끝 줄을 지나가기만 하면 안 돼.
      <span class="aside">킹은 대각선으로 멀리 날아다녀. 잡을 때도 멀리 있는 말을 넘어 그 너머 아무 빈칸에나 내려.</span></li>
    <li><b>무승부:</b> 같은 국면이 같은 차례로 세 번 나올 때, 양쪽이 잡지 않고 킹만 25수씩 움직였을 때,
      킹 하나만 남은 쪽을 상대가 말 셋(킹 포함)으로 16수, 둘 이하로 5수 안에 못 이길 때.</li>
    <li><b>판에서는</b> 말을 누르고 갈 칸(빨간 점)을 누르면 돼. 잡아야 할 때는 잡을 수 있는 말에 빨간 점선이 둘려 있어.
      <span class="aside">다른 길로 같은 칸에 가는 잡기가 여럿이면, 거쳐 갈 칸(작은 빨간 원)을 먼저 눌러.</span></li>`,
  },
  debug: () => ({ legal: state.legal.map((m) => ({ from: m.from, to: m.to, path: m.path.slice() })), stm: state.stm, human, over: !!state.result, playing,
    plies: moves.length, cells: Array.from({ length: 100 }, (_, s) => visual(s)) }),
  mount(a) {
    api = a; boardEl = a.board;
    build();
    state = replay();
    render();
  },
  start(side) {
    stop();
    human = side; moves = []; sel = -1; via = []; playing = true;
    clearDoodles();
    boardEl.setAttribute('aria-label', '국제 드래프트 판, 나는 ' + sideName(side));
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    const had = moves.length > 0;
    playing = false; moves = []; sel = -1; via = []; human = 1;
    state = replay();
    if (had && !reduced()) wipe(boardEl, 10, () => { clearDoodles(); render(); });
    else { clearDoodles(); render(); }
  },
};
