// 얼티메이트 틱택토. The engine (engine.js) was written for this site: alpha-beta in plain JS, loaded on the page for
// the rules and in worker.js for thinking (the arrangement LOA 튀르크 used).
// A move is one tap on a cell. The cell you play in (its place inside its small board) says which small board the
// other side plays in next: the light-yellow one. If that board is already decided, the other side may play anywhere open.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { easePlan } from '../shared/ease.js';
import { wobble } from '../shared/sketch.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.Ttt9Engine({ ttBits: 8 });
const { WIN, WIN_BOUND, NAME } = R;
const mark = (p) => (p === 1 ? 'X' : 'O');
const colorOf = (p) => (p === 1 ? 'b' : 'w');
const boardOf = (m) => ((m / 27) | 0) * 3 + (((m % 9) / 3) | 0);
const placeOf = (m) => (((m / 9) | 0) % 3) * 3 + (m % 3);
const cellOf = (b, s) => (((b / 3) | 0) * 3 + ((s / 3) | 0)) * 9 + (b % 3) * 3 + (s % 3);
const LN = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

let api, boardEl, cellEls = [], hlSvg, lineSvg, wonSvg;
let human = 1, moves = [], state = null, playing = false, g = 0, dropped = -1;
let engine = null, localE = null;

function replay() {
  R.setStart();
  for (const m of moves) R.play(m);
  const over = R.status() === 'over';
  return {
    c: Array.from(R.cells()), own: Array.from(R.owners()), next: R.next, stm: R.stm, over, result: R.result,
    legal: over ? [] : R.legalMoves(), won: [0, R.countWon(1), R.countWon(2)], line: over ? R.bigLine() : 0,
    last: moves.length ? moves[moves.length - 1] : -1,
  };
}

// ---------- thinking ----------
function client() {
  if (!engine) engine = workerClient(new URL('./worker.js', import.meta.url), { type: 'classic' });
  return engine;
}
async function think(time) {
  const ez = easePlan('ttt9', time); time = ez.time; // 봐주기 (shared/ease.js)
  try {
    return await client().call({ moves: moves.slice(), time, depth: ez.depth }, { timeout: HARD_LIMIT });
  } catch (err) {
    if (/다시 시작/.test(err.message)) return null;
    if (!(err instanceof TimeoutError)) console.warn(err);
    if (!localE) localE = globalThis.Ttt9Engine({ ttBits: 16 });
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600), depth: ez.depth });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorOf(3 - human), text: `${api.name} 차례 · ${mark(3 - human)} · ${countText()}` });
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
// the cells of one small board held by player p (a 9-bit mask), in position st
function maskOf(st, b, p) { let x = 0; for (let s = 0; s < 9; s++) if (st.c[cellOf(b, s)] === p) x |= 1 << s; return x; }
function completes(mask, s) { const x = mask | (1 << s); return LN.some((l) => l.every((i) => x >> i & 1)); }
// could player p win a small board with one of the moves available in st?
function canWinBoard(st, p) {
  return st.legal.some((m) => { const b = boardOf(m); return completes(maskOf(st, b, p), placeOf(m)); });
}
function commit(m, info) {
  const mover = state.stm, before = state, b = boardOf(m);
  moves.push(m);
  state = replay();
  dropped = m;
  render();
  setTimeout(() => { dropped = -1; }, 400);
  const facts = [], wonBoard = state.own[b] === mover;
  if (mover === human) {
    if (wonBoard) facts.push(['humanSmallWin', null, 0.8]);
    if (!state.over && state.next < 0 && before.next >= 0) facts.push(['humanSentFree', null, 0.7]);
    // my move left Penopi a board it can win at once
    if (!state.over && state.next >= 0 && canWinBoard(state, 3 - human) && !wonBoard) facts.push(['humanGift', null, 0.7]);
    api.humanMoved({ facts, plies: moves.length });
  } else {
    if (wonBoard) facts.push(['engineSmallWin', null, 0.8]);
    if (!state.over && state.next < 0 && before.next >= 0) facts.push(['engineSentFree', null, 0.6]);
    if (!state.over) {
      if (info) {
        const sc = info.score, plies = WIN - sc;
        api.engineMoved({
          p: 1 / (1 + Math.exp(-sc / 200)),
          mate: sc > WIN_BOUND ? Math.max(1, (plies - 1) >> 1) : 0,
          doomed: sc < -WIN_BOUND,
          nodes: info.nodes, depth: info.depth,
          facts,
        });
      } else if (facts.length) api.say(facts[0][0]);
    }
    api.runTo(((m % 9) + 0.5) / 9);
  }
  next();
}
const countText = () => `${mark(human)} ${state.won[human]} : ${mark(3 - human)} ${state.won[3 - human]}`;
function next() {
  if (!playing) return;
  if (state.over) { finish(); return; }
  if (state.stm === human) api.yourTurn({ color: colorOf(human), label: mark(human), text: `내 차례 · ${mark(human)} · ${countText()}` });
  else engineMove();
  render();
}
function finish() {
  playing = false;
  const a = state.won[human], b = state.won[3 - human], vars = { a, b, n: Math.ceil(moves.length / 2) };
  if (state.result === 3) { api.over({ winner: 'draw', key: 'drawCount', vars, text: `무승부 · ${a}:${b}` }); render(); return; }
  const won = state.result === human, byLine = state.line !== 0;
  api.over({
    winner: won ? 'human' : 'penopi',
    key: byLine ? undefined : won ? 'humanWinCount' : 'engineWinCount',
    vars,
    text: `${won ? '내가 이겼다' : `${api.name}가 이겼다`} · ${byLine ? '큰 줄' : '판 수'} ${a}:${b}`,
  });
  render();
}

// ---------- input ----------
function onCell(m) {
  if (!playing || state.over || state.stm !== human) return;
  if (state.legal.includes(m)) commit(m, null);
}

// ---------- drawing ----------
const jit = (m, k) => (((m * 37 + k * 11) % 9) - 4) / 2; // a steady hand-drawn wobble, so redrawing doesn't shake
function markSvg(p, m, cls) {
  const a = jit(m, 1), c = jit(m, 2);
  return p === 1
    ? `<svg class="mk${cls}" viewBox="0 0 100 100" aria-hidden="true"><path d="M${22 + a} ${20 + c} Q50 50 ${78 - a} ${80 - c} M${78 + c} ${22 - a} Q50 52 ${22 - c} ${78 + a}"/></svg>`
    : `<svg class="mk${cls}" viewBox="0 0 100 100" aria-hidden="true"><ellipse cx="${50 + a / 2}" cy="${50 + c / 2}" rx="${29 + c / 2}" ry="${30 + a / 2}"/></svg>`;
}
const centre = (b) => [(b % 3) * 300 + 150, ((b / 3) | 0) * 300 + 150];
function build() {
  boardEl.setAttribute('role', 'grid');
  boardEl.insertAdjacentHTML('afterbegin', '<svg class="hl" viewBox="0 0 900 900" preserveAspectRatio="none" aria-hidden="true"></svg>');
  for (let m = 0; m < 81; m++) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'tc';
    el.addEventListener('click', () => onCell(m));
    boardEl.appendChild(el); cellEls.push(el);
  }
  let thin = '', thick = '';
  for (let i = 1; i < 9; i++) if (i % 3) thin += wobble(i * 100, 4, i * 100, 896, 3) + wobble(4, i * 100, 896, i * 100, 3);
  for (const i of [300, 600]) thick += wobble(i, 0, i, 900, 5) + wobble(0, i, 900, i, 5);
  const frame = wobble(-6, 0, 906, 0, 5) + wobble(900, -6, 900, 906, 5) + wobble(906, 900, -6, 900, 5) + wobble(0, 906, 0, -6, 5);
  boardEl.insertAdjacentHTML('beforeend', `<svg class="lines" viewBox="0 0 900 900" preserveAspectRatio="none" aria-hidden="true">
    <path d="${thin}" fill="none" stroke="#1b1b1b" stroke-width="1.3" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="${thick + frame}" fill="none" stroke="#1b1b1b" stroke-width="3.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
    <svg class="won" viewBox="0 0 900 900" preserveAspectRatio="none" aria-hidden="true"></svg>`);
  hlSvg = boardEl.querySelector('svg.hl'); lineSvg = boardEl.querySelector('svg.lines'); wonSvg = boardEl.querySelector('svg.won');
}
let wonKey = '';
function render() {
  const st = state, mine = playing && st.stm === human && !st.over;
  const targets = new Set(mine ? st.legal : []);
  for (let m = 0; m < 81; m++) {
    const el = cellEls[m], p = st.c[m];
    let h = '';
    if (p) h = markSvg(p, m, m === dropped ? ' drop' : '');
    else if (targets.has(m)) h = '<span class="dot"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.classList.toggle('last', st.last === m);
    el.setAttribute('aria-label', NAME(m) + (p ? ` ${mark(p)}` : ' 빈칸') + (targets.has(m) ? ', 둘 수 있음' : ''));
  }
  // the board(s) the side to move may play in
  let hl = '';
  if (playing && !st.over) for (let b = 0; b < 9; b++) if (!st.own[b] && (st.next < 0 || st.next === b)) hl += `<rect x="${(b % 3) * 300 + 4}" y="${((b / 3) | 0) * 300 + 4}" width="292" height="292" rx="14"/>`;
  if (hlSvg.dataset.h !== hl) { hlSvg.innerHTML = hl; hlSvg.dataset.h = hl; }
  // won boards: a veil and a big mark; a full board with no winner: hatched
  let won = '';
  for (let b = 0; b < 9; b++) {
    const o = st.own[b]; if (!o) continue;
    const x = (b % 3) * 300, y = ((b / 3) | 0) * 300, [cx, cy] = centre(b), a = jit(b, 3) * 3;
    if (o === 3) { won += `<rect class="veil full" x="${x + 6}" y="${y + 6}" width="288" height="288" rx="12"/>`; continue; }
    won += `<rect class="veil" x="${x + 6}" y="${y + 6}" width="288" height="288" rx="12"/>`;
    won += o === 1
      ? `<path class="big" d="M${x + 50 + a} ${y + 46} Q${cx} ${cy} ${x + 250 - a} ${y + 254} M${x + 250} ${y + 50 + a} Q${cx + 4} ${cy - 2} ${x + 52 - a} ${y + 252}"/>`
      : `<ellipse class="big" cx="${cx}" cy="${cy}" rx="${100 + a}" ry="${104 - a}"/>`;
  }
  if (st.over && st.line) {
    const bs = LN.find((l) => l.every((i) => st.line >> i & 1));
    if (bs) { const [x1, y1] = centre(bs[0]), [x2, y2] = centre(bs[2]); won += `<path class="win" d="M${x1} ${y1} L${x2} ${y2}"/>`; }
  }
  if (wonKey !== won) { wonSvg.innerHTML = won; wonKey = won; }
}
function stop() { g++; dropped = -1; if (engine) engine.restart(); }

export default {
  id: 'ttt9',
  name: '얼티메이트 틱택토',
  sides: [
    { id: 1, first: true, html: '<b class="xo">X</b> · 선공' },
    { id: 2, first: false, html: '<b class="xo">O</b> · 후공' },
  ],
  lines: LINES,
  chat: ['chatTtt9'],
  longGame: 40,
  rules: {
    title: '얼티메이트 틱택토, 규칙도 몰라?',
    html: `
    <li><b>틱택토 판 아홉 개가 큰 틱택토 판 하나를 이루고 있다.</b> 작은 판에서 줄 셋을 먼저 만들면 그 작은 판은 내 거야.</li>
    <li><b>큰 판에서 내 작은 판 셋이 한 줄이 되면 이긴다.</b> 가로, 세로, 대각선 다 된다.</li>
    <li><b>내가 둔 자리가 상대가 둘 판을 정한다.</b> 내가 작은 판의 오른쪽 아래 칸에 두면, 상대는 큰 판의 오른쪽 아래 작은 판에서 둬야 해.
      <span class="aside">판에서는 둘 수 있는 판을 노랗게 칠해 줄게.</span></li>
    <li><b>보내야 할 판이 이미 끝났거나 꽉 찼으면, 상대는 끝나지 않은 아무 판에서나 둘 수 있다.</b>
      <span class="aside">그러니까 일부러 끝난 판으로 보내면 상대한테 선물을 주는 거야.</span></li>
    <li><b>첫 수는 어디든 된다.</b> 선공이 먼저 둔다.</li>
    <li><b>줄 없이 모든 작은 판이 끝나면, 작은 판을 더 많이 가진 쪽이 이긴다.</b> 같으면 비긴다. 꽉 차서 아무도 못 가진 판은 세지 않아.</li>`,
    note: '틱택토를 겹쳐 놓은 놀이야. 만든 사람은 알려지지 않았어.',
  },
  debug: () => ({ legal: state.legal, stm: state.stm, human, over: state.over, playing, plies: moves.length, cells: null }),
  mount(a) {
    api = a; boardEl = a.board;
    build();
    state = replay();
    render();
  },
  start(side) {
    stop();
    human = side; moves = []; playing = true; wonKey = '';
    boardEl.setAttribute('aria-label', '얼티메이트 틱택토 판, 나는 ' + mark(side));
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
