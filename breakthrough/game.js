// Breakthrough. The engine (engine.js) was written for this site: alpha-beta search in plain JS, loaded twice,
// on the page for the rules and in worker.js for thinking (the arrangement LOA 튀르크 used).
// Board and doodles follow LOA 튀르크: a hand-drawn 8×8 grid, hatched squares, pencil trails, scribbled captures.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { gridSvg, hopPiece, trail, wipe } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.BreakthroughEngine({ ttBits: 8 });
const WIN = R.WIN, MATE = R.MATE_BOUND;
const sideName = (p) => (p === 1 ? '백' : '흑');
const colorOf = (p) => (p === 1 ? 'w' : 'b');
const advanceOf = (side, s) => (side === 1 ? s >> 3 : 7 - (s >> 3));

let api, boardEl, sqEls = [];
let human = 1, moves = [], state = null, sel = -1, playing = false, g = 0;
let engine = null, localE = null, deepSaid = { h: false, e: false }, homeSaid = false;

function replay() {
  R.setStart();
  let over = false, winner = 0, how = '';
  for (const m of moves) {
    const side = R.stm;
    R.play(m);
    if (R.resultAfter(side, m)) {
      over = true; winner = side;
      how = R.pieceCount(3 - side) === 0 ? 'wipe' : ((m >> 6) & 63) >> 3 === (side === 1 ? 7 : 0) ? 'break' : 'stuck';
      break;
    }
  }
  return { b: Array.from(R.board), stm: R.stm, over, winner, how, legal: over ? [] : R.legalMoves(), last: moves.length ? moves[moves.length - 1] : -1 };
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
    // no worker, or it hung: think on the page for a moment
    if (!localE) localE = globalThis.BreakthroughEngine({ ttBits: 16 });
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
  if (Date.now() - t0 < 400) await new Promise((r) => setTimeout(r, 400));
  if (my !== g) return;
  let m = info.move;
  if (!state.legal.includes(m)) m = state.legal[0];
  commit(m, info);
}

// ---------- moves ----------
function commit(m, info) {
  const mover = state.stm, to = (m >> 6) & 63, taken = m & 4096 ? state.b[to] : 0;
  moves.push(m); sel = -1;
  if (taken) scribble(to, taken);
  state = replay();
  render(m & 63, to);
  if (mover === human) humanTalk(m); else engineTalk(m, info);
  if (taken && mover !== human) api.runTo((visual(to) % 8 + 0.5) / 8);
  next();
}
function next() {
  if (!playing) return;
  if (state.over) { finish(); return; }
  if (state.stm === human) api.yourTurn({ color: colorOf(human), label: sideName(human) });
  else engineMove();
  render();
}
// a capture that wins a piece: not a taking back, and the other side can't take one back right away
// (an exchange says nothing)
function freeCapture(m) {
  if (!(m & 4096)) return false;
  const prev = moves.length >= 2 ? moves[moves.length - 2] : 0;
  return !(prev & 4096) && !state.legal.some((x) => x & 4096);
}
function humanTalk(m) {
  if (state.over) return;
  const facts = [], from = m & 63, to = (m >> 6) & 63;
  if (freeCapture(m)) facts.push(['humanCap', null, 0.7]);
  if (!deepSaid.h && advanceOf(human, to) >= 5) { deepSaid.h = true; facts.push(['humanDeep']); }
  if (!homeSaid && moves.length > 12 && advanceOf(human, from) === 0) { homeSaid = true; facts.push(['homeLeft', null, 0.5]); }
  api.humanMoved({ facts, plies: moves.length });
}
function engineTalk(m, info) {
  if (state.over) return;
  const sc = info.score, to = (m >> 6) & 63, facts = [];
  if (freeCapture(m)) facts.push(['engineCap', null, 0.7]);
  if (!deepSaid.e && advanceOf(3 - human, to) >= 5) { deepSaid.e = true; facts.push(['engineDeep']); }
  api.engineMoved({
    p: 1 / (1 + Math.exp(-sc / 200)),
    mate: sc >= MATE ? Math.ceil((WIN - sc) / 2) - 1 : 0,
    doomed: sc <= -MATE,
    nodes: info.nodes, depth: info.depth,
    facts,
  });
}
function finish() {
  playing = false;
  const st = state, mine = st.winner === human;
  api.over({
    winner: mine ? 'human' : 'penopi',
    vars: { n: Math.ceil(moves.length / 2) },
    key: !mine && st.how === 'wipe' ? 'engineWinWipe' : undefined,
    text: `${api.chip(colorOf(st.winner))}${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
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
  api.peek((visual(s) % 8 + 0.5) / 8, peekPly !== moves.length);
  peekPly = moves.length;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel >= 0 && !document.querySelector('dialog[open]')) { sel = -1; render(); } });

// ---------- drawing ----------
// my side at the bottom: as White, row 0 (rank 1) at the bottom; as Black, the board turned around
const visual = (s) => (human === 1 ? (7 - (s >> 3)) * 8 + (s & 7) : (s >> 3) * 8 + (7 - (s & 7)));
const squareAt = (v) => (human === 1 ? (7 - (v >> 3)) * 8 + (v & 7) : (v >> 3) * 8 + (7 - (v & 7)));
const centre = (s) => { const v = visual(s); return [(v & 7) * 100 + 50, (v >> 3) * 100 + 50]; };
const sqName = (s) => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
// a piece: a blob with a little point toward the way it moves (up for my pieces, down for Penopi's)
function pieceSvg(side, s) {
  const up = (side === human), k = ((s * 47) % 13) - 6;
  // turned inside the svg: a CSS rotate on the svg would turn the hop animation's direction too
  return `<svg class="pc ${colorOf(side)}" viewBox="0 0 40 40" aria-hidden="true" style="--d:${((s & 7) + (s >> 3)) * 28}ms">
    <path transform="rotate(${k + (up ? 0 : 180)} 20 20)" d="M20 4 C23 9 30 12 33 19 C36 27 31 35 20 35 C9 35 4 27 7 19 C10 12 17 9 20 4 Z"/></svg>`;
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
  const st = state, targets = new Map();
  if (sel >= 0) for (const m of st.legal) if ((m & 63) === sel) targets.set((m >> 6) & 63, (m & 4096) !== 0);
  const lf = st.last >= 0 ? st.last & 63 : -1, lt = st.last >= 0 ? (st.last >> 6) & 63 : -1;
  for (let v = 0; v < 64; v++) {
    const s = squareAt(v), el = sqEls[v], p = st.b[s];
    el.classList.toggle('last', s === lf || s === lt);
    el.classList.toggle('sel', s === sel);
    let h = p ? pieceSvg(p, s) : '';
    if (targets.has(s)) h += targets.get(s) ? '<span class="ring"></span>' : '<span class="dot"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.setAttribute('aria-label', sqName(s) + (p ? (p === 1 ? ' 백' : ' 흑') : ' 빈칸') + (targets.has(s) ? (targets.get(s) ? ', 잡으며 이동 가능' : ', 여기로 이동 가능') : ''));
  }
  if (animFrom >= 0 && animTo >= 0 && !reduced()) {
    hopPiece(sqEls[visual(animTo)].querySelector('.pc'), sqEls[visual(animFrom)], sqEls[visual(animTo)]);
    trail(boardEl, 8, centre(animFrom), centre(animTo));
  }
}
function scribble(s, colour) {
  if (reduced()) return;
  const v = visual(s), el = document.createElement('div');
  el.className = 'ghost ' + colorOf(colour);
  el.style.left = (v & 7) * 12.5 + '%'; el.style.top = (v >> 3) * 12.5 + '%';
  el.innerHTML = pieceSvg(colour, s) + '<svg class="x" viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>';
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
const clearDoodles = () => { for (const e of boardEl.querySelectorAll('.trail, .ghost')) e.remove(); };

function stop() {
  g++;
  if (engine) engine.restart();
}

export default {
  id: 'breakthrough',
  name: '브레이크스루',
  sides: [
    { id: 1, first: true, html: '<span class="chip w"></span>백 · 선공' },
    { id: 2, first: false, html: '<span class="chip b"></span>흑 · 후공' },
  ],
  lines: LINES,
  chat: ['chatBreakthrough'],
  longGame: 50,
  rules: {
    html: `
    <li><b>내 말 하나라도 상대 쪽 맨 끝 줄에 닿으면 이긴다.</b> 상대 말을 전부 잡아도 이겨.
      <span class="aside">한 명만 도착하면 돼. 다 같이 갈 필요 없어.</span></li>
    <li><b>각자 말 16개를 자기 쪽 두 줄에 놓고 시작한다.</b> 백이 먼저 둔다.</li>
    <li><b>말은 앞으로 한 칸씩만 간다. 바로 앞이나 앞 대각선으로.</b> 뒤로도 옆으로도 못 가.
      <svg viewBox="0 0 300 110" aria-label="말 하나가 갈 수 있는 앞쪽 세 칸과, 대각선으로만 잡을 수 있다는 그림">
        <g fill="none" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round">
          <path d="M40 4 V106 M100 4 V106 M160 4 V106 M220 4 V106 M280 4 V106 M40 4 H280 M40 55 H280 M40 106 H280"/>
          <path d="M130 64 C134 72 142 76 144 84 C146 93 140 99 130 99 C120 99 114 93 116 84 C118 76 126 72 130 64 Z" fill="#fdfdfb" stroke-width="2.4"/>
          <path d="M120 70 L80 40 M130 62 L130 36 M140 70 L180 40" stroke="#d8452f" stroke-width="2.4"/>
          <circle cx="190" cy="30" r="17" stroke="#d8452f" stroke-dasharray="5 5"/>
        </g>
        <circle cx="70" cy="30" r="5" fill="#d8452f"/><circle cx="130" cy="30" r="5" fill="#d8452f"/>
        <path d="M190 14 C193 19 200 22 203 29 C206 37 201 45 190 45 C179 45 174 37 177 29 C180 22 187 19 190 14 Z" fill="#1b1b1b" transform="rotate(180 190 30)"/>
      </svg>
      <span class="aside">빨간 점이 갈 수 있는 칸, 점선 동그라미가 잡는 칸이야.</span></li>
    <li><b>바로 앞은 비어 있을 때만 간다. 대각선은 비어 있거나 상대 말이 있으면 간다(그 말을 잡는다).</b>
      <span class="aside">정면으로 마주친 두 말은 서로 잡지도 못하고 앞으로도 못 가. 잡는 건 비스듬히만.</span></li>
    <li><b>내 차례에 둘 수 있는 수가 없으면 진다.</b> 거의 안 일어나지만.
      <span class="aside">비기는 일은 없어. 앞으로만 가니까 언젠가는 끝나.</span></li>
    <li><b>팁: 상대 말이 내 쪽 두 번째 줄까지 오면 바로 잡아.</b> 다음 수에 끝줄로 들어오니까.
      <span class="aside">규칙은 아니고 충고야. 근데 거의 규칙이야.</span></li>`,
    note: '브레이크스루(Breakthrough)는 댄 트로이카(Dan Troyka)가 2000년에 만든 게임입니다.',
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
    deepSaid = { h: false, e: false }; homeSaid = false;
    clearDoodles();
    boardEl.setAttribute('aria-label', '브레이크스루 판, 나는 ' + sideName(side));
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
