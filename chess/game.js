// Chess. The engine (engine.js) was written for this site: alpha-beta in plain JS, loaded on the page for the
// rules and in worker.js for thinking (as LOA). Board and doodles follow LOA; the pieces are pen doodles.
// Input: tap a piece, then where it goes. Promotion asks which piece under the board.
// Penopi plays from a small opening book (book.js) while the game follows one of its lines, and thinks on my
// time too (short searches of my position fill the worker's table, as LOA does).
import { LINES } from './lines.js';
import { BOOK } from './book.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { gridSvg, hopPiece, trail, wipe } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, PONDER_MS = 700, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.ChessEngine({ ttBits: 8 });
const { MATE, MATE_BOUND, mFrom, mTo, mPromo, mFlags } = R;
const NAMES = ['', '폰', '나이트', '비숍', '룩', '퀸', '킹'];
const colorOf = (c) => (c === 0 ? 'w' : 'b'); // engine colour 0 white, 8 black
const sideName = (c) => (c === 0 ? '백' : '흑');

let api, boardEl, sqEls = [];
let human = 0, moves = [], state = null, sel = -1, promo = null, playing = false, g = 0;
let engine = null, localE = null, ponder = null, inBook = true, firstSearch = false;

function replay() {
  R.setStart();
  let result = '';
  for (const m of moves) { R.play(m); }
  result = R.status();
  return { b: Array.from(R.board), side: R.side, result, legal: result ? [] : R.legalMoves(), check: R.inCheck(),
           king: R.kings[R.side >> 3], last: moves.length ? moves[moves.length - 1] : 0 };
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
    if (!localE) localE = globalThis.ChessEngine({ ttBits: 16 });
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600) });
  }
}
// the book: position (FEN without the move counters) → book moves, built once from the SAN lines
let book = null;
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
function buildBook() {
  book = new Map();
  const B = globalThis.ChessEngine({ ttBits: 4 });
  for (const line of BOOK) {
    B.setStart();
    for (const tok of line.split(' ')) {
      const m = B.legalMoves().find((x) => B.san(x).replace(/[+#]/g, '') === tok.replace(/[+#]/g, ''));
      if (m === undefined) break;
      const k = posKey(B.fen());
      if (!book.has(k)) book.set(k, new Set());
      book.get(k).add(m);
      B.play(m);
    }
  }
}
function bookMove() {
  if (!inBook) return 0;
  if (!book) buildBook();
  const set = book.get(posKey(R.fen()));
  const options = set ? [...set].filter((m) => state.legal.includes(m)) : [];
  if (!options.length) { inBook = false; return 0; }
  return options[Math.floor(Math.random() * options.length)];
}
// on my time: short searches of my position, one after another, until I move
function startPonder() {
  const my = g, ply = moves.length;
  ponder = (async () => {
    while (my === g && playing && moves.length === ply && !state.result && state.side === human) {
      if (!(await think(PONDER_MS))) break;
    }
  })();
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorOf(human ^ 8) });
  render();
  const t0 = Date.now();
  R.setStart(); for (const x of moves) R.play(x);
  const bm = bookMove();
  if (bm) {
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 600));
    if (my !== g) return;
    commit(bm, { score: 0, nodes: 0, book: true });
    return;
  }
  if (ponder) await ponder;
  if (my !== g) return;
  const info = await think(THINK_MS);
  if (my !== g || !info) return;
  if (Date.now() - t0 < 400) await new Promise((r) => setTimeout(r, 400));
  if (my !== g) return;
  const m = state.legal.includes(info.move) ? info.move : state.legal[0];
  commit(m, info);
}

// ---------- moves ----------
function commit(m, info) {
  const mover = state.side, before = state.b, to = mTo(m), fl = mFlags(m);
  const capSq = fl & R.FLAG_EP ? (mover === 0 ? to - 16 : to + 16) : to;
  const taken = fl & R.FLAG_CAP ? before[capSq] & 7 : 0;
  moves.push(m); sel = -1; promo = null;
  if (taken) scribble(capSq, before[capSq]);
  state = replay();
  render(m);
  if (mover === human) humanTalk(m, taken); else engineTalk(m, info, taken);
  if (taken && mover !== human) api.runTo((visual(to) % 8 + 0.5) / 8);
  next();
}
function next() {
  tray();
  if (!playing) return;
  if (state.result) { finish(); return; }
  if (state.side === human) { api.yourTurn({ color: colorOf(human), label: sideName(human), text: myStatus() }); if (!inBook) startPonder(); }
  else engineMove();
  render();
}
function myStatus() {
  const base = `${api.chip(colorOf(human))}내 차례 (${sideName(human)})`;
  if (promo) return `${base} · 무엇으로 승진할래?`;
  return state.check ? `${base} · 체크!` : base;
}
function humanTalk(m, taken) {
  if (state.result) return;
  const facts = [], fl = mFlags(m);
  if (state.check) facts.push(['humanCheck', null, 0.6]);
  if (taken === R.Q) facts.push(['humanTakesQueen']);
  else if (taken) facts.push(['humanCap', { pc: NAMES[taken] }, 0.5]);
  if (fl & R.FLAG_CASTLE) facts.push(['humanCastle', null, 0.6]);
  if (mPromo(m)) facts.push(['humanPromote']);
  api.humanMoved({ facts, plies: moves.length });
}
function engineTalk(m, info, taken) {
  if (state.result) return;
  const sc = info ? info.score : 0, fl = mFlags(m), facts = [];
  if (mPromo(m)) facts.push(['enginePromote']);
  if (taken === R.Q) facts.push(['engineTakesQueen']);
  if (state.check) facts.push(['engineCheck', null, 0.8]);
  if (taken && taken !== R.Q) facts.push(['engineCap', { pc: NAMES[taken] }, 0.6]);
  if (fl & R.FLAG_CASTLE) facts.push(['engineCastle', null, 0.5]);
  const fresh = info && info.book ? true : firstSearch;
  firstSearch = !!(info && info.book);
  api.engineMoved({
    verdict: fresh ? null : undefined, // the book has no evaluation to compare against
    p: 1 / (1 + Math.exp(-sc / 300)),
    mate: sc >= MATE_BOUND ? Math.ceil((MATE - sc) / 2) - 1 : 0,
    doomed: sc <= -MATE_BOUND,
    nodes: info && info.nodes, depth: info && info.depth,
    facts,
  });
}
function finish() {
  playing = false;
  tray();
  const r = state.result;
  if (r !== 'mate') {
    const key = { stalemate: 'drawStalemate', 'draw:repetition': 'drawRepetition', 'draw:fifty': 'drawFifty', 'draw:material': 'drawMaterial' }[r];
    api.over({ winner: 'draw', key, text: r === 'stalemate' ? '스테일메이트 · 무승부' : '무승부' });
    return;
  }
  const winner = state.side ^ 8, mine = winner === human; // the side to move is mated
  api.over({
    winner: mine ? 'human' : 'penopi',
    key: mine ? 'humanWinMate' : 'engineWinMate',
    vars: { n: Math.ceil(moves.length / 2) },
    text: `${api.chip(colorOf(winner))}체크메이트 · ${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
}

// ---------- input ----------
function onSquare(s) {
  if (!playing || state.result || state.side !== human || promo) return;
  if (sel >= 0) {
    const ms = state.legal.filter((m) => mFrom(m) === sel && mTo(m) === s);
    if (ms.length === 1) { commit(ms[0]); return; }
    if (ms.length > 1) { promo = ms; changed(); tray(); return; } // a promotion: which piece?
  }
  const p = state.b[s];
  if (p && (p & 8) === human && state.legal.some((m) => mFrom(m) === s)) { sel = s; peek(s); }
  else sel = -1;
  changed();
}
function changed() { api.status(myStatus()); render(); }
let peekPly = -1;
function peek(s) { api.peek((visual(s) % 8 + 0.5) / 8, peekPly !== moves.length); peekPly = moves.length; }
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (promo) { promo = null; tray(); changed(); } else if (sel >= 0) { sel = -1; changed(); }
});
function tray() {
  const t = api.tray;
  if (!promo || !playing) { t.hidden = true; t.innerHTML = ''; t.dataset.h = ''; return; }
  const html = '<span class="q">승진:</span>' + [R.Q, R.R, R.B, R.N].map((pt) =>
    `<button type="button" class="btn small promo" data-promo="${pt}" aria-label="${NAMES[pt]}">${pieceSvg(human | pt)}</button>`).join('')
    + '<button type="button" class="btn small" data-promo="0">취소</button>';
  if (t.dataset.h !== html) { t.innerHTML = html; t.dataset.h = html; }
  t.hidden = false;
}

// ---------- drawing ----------
// my side at the bottom: as White rank 8 on top; as Black the board turned around
const visual = (s) => { const r = s >> 4, f = s & 7; return human === 0 ? (7 - r) * 8 + f : r * 8 + (7 - f); };
const squareAt = (v) => { const vr = v >> 3, vf = v & 7; return human === 0 ? (7 - vr) * 16 + vf : vr * 16 + (7 - vf); };
const centre = (s) => { const v = visual(s); return [(v & 7) * 100 + 50, (v >> 3) * 100 + 50]; };
const sqName = (s) => 'abcdefgh'[s & 7] + ((s >> 4) + 1);
// pen doodles, 40×40; white pieces paper with ink lines, black pieces ink with paper details
const SHAPES = {
  1: '<path class="b" d="M14 33 C15 27 17 23 20 21 C23 23 25 27 26 33 Z"/><circle class="b" cx="20" cy="15" r="5.5"/>',
  2: '<path class="b" d="M13 33 C13 26 16 23 19 19 C15 20 12 19 11.5 16 C13 12 17 9 21 8 L23 5 L25 8.5 C29 12 30 19 28.5 33 Z"/><circle class="d" cx="19" cy="12.5" r="1.3"/>',
  3: '<path class="b" d="M14 33 C14 28 15 25 17.5 23 C13.5 19 15 12 20 8 C25 12 26.5 19 22.5 23 C25 25 26 28 26 33 Z"/><path class="l" d="M22 12.5 L18.5 17"/><circle class="b" cx="20" cy="6" r="2"/>',
  4: '<path class="b" d="M12.5 33 L13.5 18 L12 10 H16 V13 H18.5 V10 H21.5 V13 H24 V10 H28 L26.5 18 L27.5 33 Z"/><path class="l" d="M14 18 H26"/>',
  5: '<path class="b" d="M11 33 L9 14 L14.5 22 L16 10 L20 20.5 L24 10 L25.5 22 L31 14 L29 33 Z"/><circle class="b" cx="9" cy="12.5" r="2"/><circle class="b" cx="16" cy="8.5" r="2"/><circle class="b" cx="24" cy="8.5" r="2"/><circle class="b" cx="31" cy="12.5" r="2"/>',
  6: '<path class="b" d="M12 33 C12 25 14 21 20 19.5 C26 21 28 25 28 33 Z"/><path class="b" d="M15 20 C15 16 17 14.5 20 14.5 C23 14.5 25 16 25 20"/><path class="l x" d="M20 4.5 V13 M16.5 8 H23.5"/>',
};
function pieceSvg(p) {
  return `<svg class="pc ${colorOf(p & 8)}" viewBox="0 0 40 40" aria-hidden="true">${SHAPES[p & 7]}<path class="b base" d="M10 33 Q20 31.5 30 33 L30 35.5 Q20 34.5 10 35.5 Z"/></svg>`;
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
  api.tray.addEventListener('click', (e) => {
    const b = e.target.closest('[data-promo]');
    if (!b || !promo) return;
    const pt = Number(b.dataset.promo);
    if (!pt) { promo = null; tray(); changed(); return; }
    const m = promo.find((x) => mPromo(x) === pt);
    if (m) commit(m);
  });
}
function render(anim) {
  const st = state, targets = new Map();
  if (sel >= 0) for (const m of st.legal) if (mFrom(m) === sel) targets.set(mTo(m), (mFlags(m) & R.FLAG_CAP) !== 0);
  const last = st.last, lf = last ? mFrom(last) : -1, lt = last ? mTo(last) : -1;
  const checkSq = st.check ? st.king : -1;
  for (let v = 0; v < 64; v++) {
    const s = squareAt(v), el = sqEls[v], p = st.b[s];
    el.classList.toggle('last', s === lf || s === lt);
    el.classList.toggle('sel', s === sel);
    el.classList.toggle('check', s === checkSq);
    let h = p ? pieceSvg(p) : '';
    if (targets.has(s)) h += targets.get(s) ? '<span class="ring"></span>' : '<span class="dot"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    const name = p ? `${p & 8 ? ' 흑' : ' 백'} ${NAMES[p & 7]}` : ' 빈칸';
    el.setAttribute('aria-label', sqName(s) + name + (targets.has(s) ? (targets.get(s) ? ', 잡으며 이동 가능' : ', 여기로 이동 가능') : '') + (s === checkSq ? ', 체크' : ''));
  }
  if (anim && !reduced()) {
    const from = mFrom(anim), to = mTo(anim);
    hopPiece(sqEls[visual(to)].querySelector('.pc'), sqEls[visual(from)], sqEls[visual(to)]);
    trail(boardEl, 8, centre(from), centre(to));
    if (mFlags(anim) & R.FLAG_CASTLE) { // the rook jumps over too
      const [rf, rt] = to > from ? [from + 3, from + 1] : [from - 4, from - 1];
      hopPiece(sqEls[visual(rt)].querySelector('.pc'), sqEls[visual(rf)], sqEls[visual(rt)]);
    }
  }
}
function scribble(s, p) {
  if (reduced()) return;
  const v = visual(s), el = document.createElement('div');
  el.className = 'ghost ' + colorOf(p & 8);
  el.style.left = (v & 7) * 12.5 + '%'; el.style.top = (v >> 3) * 12.5 + '%';
  el.innerHTML = pieceSvg(p) + '<svg class="x" viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>';
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
const clearDoodles = () => { for (const e of boardEl.querySelectorAll('.trail, .ghost')) e.remove(); };
function stop() { g++; ponder = null; inBook = true; firstSearch = false; if (engine) engine.restart(); }

export default {
  id: 'chess',
  name: '체스',
  sides: [
    { id: 0, first: true, html: '<span class="chip w"></span>백 · 선공' },
    { id: 8, first: false, html: '<span class="chip b"></span>흑 · 후공' },
  ],
  lines: LINES,
  chat: ['chatChess'],
  longGame: 100,
  rules: {
    html: `
    <li><b>상대 킹을 잡히기 직전에 몰아넣고 피할 길이 없게 만들면 이긴다(체크메이트).</b>
      <span class="aside">킹을 실제로 잡지는 않아. 피할 수 없게 되면 끝.</span></li>
    <li><b>말마다 움직이는 법이 다르다.</b> 킹: 사방 한 칸. 퀸: 가로·세로·대각선 멀리. 룩: 가로·세로 멀리. 비숍: 대각선 멀리.
      나이트: 두 칸 가고 옆으로 한 칸(다른 말을 넘어감). 폰: 앞으로 한 칸(처음엔 두 칸까지), 잡을 때만 대각선 앞으로.
      <span class="aside">나이트 빼고는 다른 말을 넘어갈 수 없어.</span></li>
    <li><b>내 킹이 공격받는 자리(체크)에 남거나 들어가는 수는 둘 수 없다.</b>
      <span class="aside">체크를 받으면 피하거나, 막거나, 공격하는 말을 잡아.</span></li>
    <li><b>캐슬링:</b> 킹과 룩이 둘 다 한 번도 안 움직였고 사이가 비었으면, 킹을 룩 쪽으로 두 칸 옮기고 룩을 킹 너머에 놓는다.
      체크 중이거나, 킹이 지나가는 칸이 공격받고 있으면 안 돼.
      <span class="aside">판에서는 킹을 누르고 두 칸 옆을 누르면 돼.</span></li>
    <li><b>앙파상:</b> 상대 폰이 두 칸 전진해서 내 폰 바로 옆에 서면, 바로 다음 수에 한 칸만 온 것처럼 대각선으로 잡을 수 있다.</li>
    <li><b>승진:</b> 폰이 끝 줄에 닿으면 퀸·룩·비숍·나이트 중 하나로 바꾼다. 판 아래에서 고르면 돼.</li>
    <li><b>무승부:</b> 둘 차례인데 체크는 아니고 둘 수가 없을 때(스테일메이트), 같은 국면이 같은 차례로 세 번 나올 때,
      양쪽이 50수 동안 잡지도 폰을 움직이지도 않았을 때, 남은 말로는 누구도 메이트할 수 없을 때.</li>`,
  },
  debug: () => ({ legal: state.legal.slice(), stm: state.side, human, over: !!state.result, playing,
    plies: moves.length, promo: !!promo, cells: (() => { const c = {}; for (let s = 0; s < 128; s++) if (!(s & 0x88)) c[s] = visual(s); return c; })() }),
  mount(a) {
    api = a; boardEl = a.board;
    build();
    state = replay();
    render();
  },
  start(side) {
    stop();
    human = side; moves = []; sel = -1; promo = null; playing = true;
    clearDoodles();
    boardEl.setAttribute('aria-label', '체스 판, 나는 ' + sideName(side));
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    const had = moves.length > 0;
    playing = false; moves = []; sel = -1; promo = null; human = 0;
    tray();
    state = replay();
    if (had && !reduced()) wipe(boardEl, 8, () => { clearDoodles(); render(); });
    else { clearDoodles(); render(); }
  },
};
