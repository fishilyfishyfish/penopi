// Reversi. The engine (engine.js) was written for this site: alpha-beta in plain JS, loaded on the page for the
// rules and in worker.js for thinking (the arrangement LOA 튀르크 used). Late in the game it reads to the end
// and knows the exact result.
// A move is one tap on a square with a red dot; the discs it closes turn over one after another. A side with no
// move passes by itself (the status line and Penopi say so).
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { gridSvg } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.ReversiEngine({ ttBits: 8 });
const { WIN, WIN_BOUND, PASS, NAME } = R;
const sideName = (c) => (c === 1 ? '흑' : '백');
const colorOf = (c) => (c === 1 ? 'b' : 'w');
const CORNERS = [0, 7, 56, 63];

let api, boardEl, sqEls = [];
let human = 1, moves = [], state = null, playing = false, g = 0, flipping = new Map(), placed = -1;
let engine = null, localE = null;

function replay() {
  R.setStart();
  for (const m of moves) R.play(m);
  const over = R.status() === 'over', legal = over ? [] : R.legalMoves();
  return { b: Array.from(R.cells()), stm: R.stm, over, legal, n: [0, R.count(1), R.count(2)], empties: R.empties, last: moves.length ? moves[moves.length - 1] : PASS };
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
    if (!localE) localE = globalThis.ReversiEngine({ ttBits: 16 });
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600) });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorOf(3 - human), text: `${api.chip(colorOf(3 - human))}${api.name} 차례 · ${countText()}` });
  render();
  if (state.legal[0] === PASS) { // nothing to play: pass after a moment
    await new Promise((r) => setTimeout(r, 900));
    if (my !== g) return;
    commit(PASS, null);
    return;
  }
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
  const mover = state.stm, before = state;
  R.setStart(); for (const x of moves) R.play(x);
  const flips = m === PASS ? [] : R.flipsOf(m);
  const cornerOpenBefore = CORNERS.some((c) => before.b[c] === 0 && cornerMoveFor(3 - mover, before, c));
  moves.push(m);
  state = replay();
  // the discs turn over one after another, nearest first
  flipping = new Map();
  if (m !== PASS && !reduced()) {
    const r0 = m >> 3, c0 = m & 7;
    for (const f of flips) flipping.set(f, Math.max(Math.abs((f >> 3) - r0), Math.abs((f & 7) - c0)));
  }
  placed = m;
  render();
  setTimeout(() => { flipping = new Map(); placed = -1; }, 700);
  const facts = [], n = flips.length;
  if (mover === human) {
    if (m === PASS) facts.push(['humanPass']);
    if (CORNERS.includes(m)) facts.push(['humanCorner']);
    else if (n >= 6) facts.push(['humanBigFlip', { n }, 0.7]);
    // my move let Penopi into a corner it couldn't reach before
    if (!cornerOpenBefore && state.legal.some((x) => CORNERS.includes(x))) facts.push(['cornerOpen', null, 0.8]);
    api.humanMoved({ facts, plies: moves.length });
  } else {
    if (m === PASS) facts.push(['enginePass']);
    if (CORNERS.includes(m)) facts.push(['engineCorner', null, 0.8]);
    else if (n >= 6) facts.push(['engineBigFlip', { n }, 0.7]);
    if (!state.over) {
      if (info) {
        const sc = info.score;
        api.engineMoved({
          p: info.exact ? (info.final > 0 ? 0.99 : info.final < 0 ? 0.01 : 0.5) : 1 / (1 + Math.exp(-sc / 150)),
          mate: info.exact && info.final > 0 ? Math.max(1, Math.ceil(state.empties / 2)) : 0,
          doomed: info.exact && info.final < 0,
          nodes: info.nodes, depth: info.depth,
          facts,
        });
      } else if (facts.length) api.say(facts[0][0]); // a pass
    }
    if (m !== PASS) api.runTo(((m & 7) + 0.5) / 8);
  }
  next();
}
// could colour c play the corner square in position st? (the page's engine is set to st when called)
function cornerMoveFor(c, st, corner) {
  if (st.b[corner]) return false;
  const r0 = corner >> 3, c0 = corner & 7;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    let r = r0 + dr, cc = c0 + dc, k = 0;
    while (r >= 0 && r < 8 && cc >= 0 && cc < 8 && st.b[r * 8 + cc] === 3 - c) { r += dr; cc += dc; k++; }
    if (k && r >= 0 && r < 8 && cc >= 0 && cc < 8 && st.b[r * 8 + cc] === c) return true;
  }
  return false;
}
const countText = () => `${sideName(human)} ${state.n[human]} : ${sideName(3 - human)} ${state.n[3 - human]}`;
function next() {
  if (!playing) return;
  if (state.over) { finish(); return; }
  if (state.stm === human) {
    if (state.legal[0] === PASS) { // I can't move: say so and pass by myself
      const my = g;
      api.status(`${api.chip(colorOf(human))}둘 곳이 없어 · 넘어간다`);
      setTimeout(() => { if (my === g && playing && state.stm === human) commit(PASS, null); }, 1300);
      render();
      return;
    }
    api.yourTurn({ color: colorOf(human), label: sideName(human), text: `${api.chip(colorOf(human))}내 차례 · ${countText()}` });
  } else engineMove();
  render();
}
function finish() {
  playing = false;
  const a = state.n[human], b = state.n[3 - human];
  const vars = { a, b, n: Math.ceil(moves.length / 2) };
  if (a === b) { api.over({ winner: 'draw', key: 'drawCount', vars, text: `무승부 · ${a}:${b}` }); render(); return; }
  const won = a > b;
  api.over({
    winner: won ? 'human' : 'penopi',
    key: !won && a === 0 ? 'engineWinWipe' : !won && b - a >= 30 ? 'engineWinBig' : undefined,
    vars,
    text: `${won ? '내가 이겼다' : `${api.name}가 이겼다`} · ${a}:${b}`,
  });
  render();
}

// ---------- input ----------
function onSquare(s) {
  if (!playing || state.over || state.stm !== human) return;
  if (state.legal.includes(s)) commit(s, null);
}

// ---------- drawing ----------
function discSvg(c, s, cls) {
  const k = ((s * 37) % 11) - 5;
  return `<span class="disc ${colorOf(c)}${cls}" style="--k:${k}deg${flipping.has(s) ? `;--d:${flipping.get(s) * 70}ms` : ''}"></span>`;
}
function build() {
  boardEl.setAttribute('role', 'grid');
  for (let s = 0; s < 64; s++) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'sq';
    el.addEventListener('click', () => onSquare(s));
    boardEl.appendChild(el); sqEls.push(el);
  }
  boardEl.insertAdjacentHTML('beforeend', gridSvg(8));
}
function render() {
  const st = state, mine = playing && st.stm === human && !st.over;
  const targets = new Set(mine ? st.legal.filter((m) => m !== PASS) : []);
  for (let s = 0; s < 64; s++) {
    const el = sqEls[s], c = st.b[s];
    let h = '';
    if (c) h = discSvg(c, s, flipping.has(s) ? ' flip' : s === placed ? ' drop' : '');
    if (targets.has(s)) h += '<span class="dot"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.classList.toggle('last', st.last === s);
    el.setAttribute('aria-label', NAME(s) + (c ? (c === 1 ? ' 흑' : ' 백') : ' 빈칸') + (targets.has(s) ? ', 둘 수 있음' : ''));
  }
}
function stop() { g++; flipping = new Map(); placed = -1; if (engine) engine.restart(); }

export default {
  id: 'reversi',
  name: '리버시',
  sides: [
    { id: 1, first: true, html: '<span class="chip b"></span>흑 · 선공' },
    { id: 2, first: false, html: '<span class="chip w"></span>백 · 후공' },
  ],
  lines: LINES,
  chat: ['chatReversi'],
  longGame: 50,
  rules: {
    title: '리버시, 규칙도 몰라?',
    html: `
    <li><b>끝났을 때 판 위에 내 색 돌이 더 많으면 이긴다.</b> 같으면 비긴다.</li>
    <li><b>가운데 네 개(흑 둘, 백 둘)로 시작하고 흑이 먼저 둔다.</b></li>
    <li><b>빈칸에 돌을 놓아서, 그 돌과 내 다른 돌 사이에 상대 돌을 한 줄로 끼우면 끼인 돌이 전부 내 색으로 뒤집힌다.</b>
      가로, 세로, 대각선 다 되고, 한 번에 여러 줄을 뒤집어도 된다.
      <span class="aside">빈칸이나 판 끝을 사이에 두면 안 끼인 거야.</span></li>
    <li><b>하나라도 뒤집을 수 있는 칸에만 둘 수 있다.</b> 판에서는 그런 칸에 빨간 점을 찍어 줄게.</li>
    <li><b>둘 곳이 없으면 차례를 넘긴다.</b> 둘 다 둘 곳이 없으면 끝.
      <span class="aside">판이 다 차기 전에 끝날 수도 있어.</span></li>
    <li><b>팁: 네 귀퉁이는 한 번 놓으면 절대 안 뒤집힌다.</b> 그래서 귀퉁이 바로 옆 칸은 함부로 두면 안 돼.
      <span class="aside">규칙은 아니고 충고야. 지금 들었으니 핑계는 없다.</span></li>`,
  },
  debug: () => ({ legal: state.legal.filter((m) => m !== PASS), stm: state.stm, human, over: state.over, playing, plies: moves.length, cells: null }),
  mount(a) {
    api = a; boardEl = a.board;
    build();
    state = replay();
    render();
  },
  start(side) {
    stop();
    human = side; moves = []; playing = true;
    boardEl.setAttribute('aria-label', '리버시 판, 나는 ' + sideName(side));
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    playing = false; moves = [];
    state = replay();
    render();
  },
};
