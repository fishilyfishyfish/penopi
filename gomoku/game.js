// Gomoku. The engine (engine.js) was written for this site: alpha-beta with continuous-four search in plain JS,
// loaded on the page for the rules and in worker.js for thinking (the arrangement LOA 튀르크 used).
// Rules are chosen before the game: free, Black's double three banned, or renju.
// Input: tap an intersection to put a pale stone there, tap it again to play (fingers are bigger than
// the points of a 15×15 board). Forbidden points for Black are crossed out when I'm Black.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { reduced } from '../shared/character.js';

const N = 15, THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.GomokuEngine({ ttBits: 8 });
const WIN = R.WIN, WIN_BOUND = R.WIN_BOUND;
const RULE_NAMES = { free: '자유', ban33: '흑 쌍삼 금지', renju: '렌주' };
const colorOf = (p) => (p === 1 ? 'b' : 'w');
const sideName = (p) => (p === 1 ? '흑' : '백');

let api, boardEl, svgEl, ptEls = [];
let human = 1, rule = 'ban33', moves = [], state = null, pending = -1, playing = false, g = 0;
let engine = null, localE = null;

function replay() {
  R.setRule(rule); R.setStart();
  let result = '';
  for (const m of moves) { R.play(m); result = R.status(); if (result) break; }
  const forb = new Set();
  if (!result && R.stm === 1 && rule !== 'free' && playing && human === 1) for (let s = 0; s < N * N; s++) if (!R.board[s] && R.forbidden(s)) forb.add(s);
  return { b: Array.from(R.board), stm: R.stm, result, forb, last: moves.length ? moves[moves.length - 1] : -1,
           five: result === 'win' ? R.fiveLine(moves[moves.length - 1]) : null };
}

// ---------- thinking ----------
function client() {
  if (!engine) engine = workerClient(new URL('./worker.js', import.meta.url), { type: 'classic' });
  return engine;
}
async function think(time) {
  try {
    return await client().call({ moves: moves.slice(), rule, time }, { timeout: HARD_LIMIT });
  } catch (err) {
    if (/다시 시작/.test(err.message)) return null;
    if (!(err instanceof TimeoutError)) console.warn(err);
    if (!localE) localE = globalThis.GomokuEngine({ ttBits: 16 });
    localE.setRule(rule); localE.setStart(); for (const m of moves) localE.play(m);
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
  let m = info.move;
  if (m < 0 || state.b[m] || state.forb.has(m)) { R.setRule(rule); R.setStart(); for (const x of moves) R.play(x); m = R.legalMoves()[0]; }
  commit(m, info);
}

// ---------- moves ----------
function commit(m, info) {
  const mover = state.stm;
  // what the opponent threatened before this move (to see whether it was a block)
  R.setRule(rule); R.setStart(); for (const x of moves) R.play(x);
  const theirFives = R.fivePoints(3 - mover);
  moves.push(m); pending = -1;
  state = replay();
  render(m);
  R.setRule(rule); R.setStart(); for (const x of moves) R.play(x);
  const sh = R.shape(m), myFives = R.fivePoints(mover);
  if (mover === human) humanTalk(sh); else engineTalk(info, sh, myFives, theirFives.includes(m));
  next();
}
function next() {
  if (!playing) return;
  if (state.result) { finish(); return; }
  if (state.stm === human) api.yourTurn({ color: colorOf(human), label: `${sideName(human)} · ${RULE_NAMES[rule]}` });
  else engineMove();
  render();
}
function humanTalk(sh) {
  if (state.result) return;
  const facts = [];
  if (sh.fours) facts.push(['humanFour', null, 0.7]);
  else if (sh.threes) facts.push(['humanThree', null, 0.4]);
  api.humanMoved({ facts, plies: moves.length });
}
function engineTalk(info, sh, myFives, blocked) {
  if (state.result) return;
  const sc = info ? info.score : 0, facts = [];
  if (myFives.length >= 2 || (sh.fours && sh.threes) || sh.threes >= 2) facts.push(['engineDoubleThreat']);
  else if (sh.fours) facts.push(['engineFour', null, 0.8]);
  else if (sh.threes) facts.push(['engineThree', null, 0.5]);
  if (blocked) facts.push(['engineBlock', null, 0.5]);
  api.engineMoved({
    p: 1 / (1 + Math.exp(-sc / 2000)),
    mate: sc >= WIN_BOUND ? Math.max(1, Math.ceil((WIN - sc) / 2) - 1) : 0,
    doomed: sc <= -WIN_BOUND,
    nodes: info && info.nodes, depth: info && info.depth,
    facts,
  });
}
function finish() {
  playing = false;
  if (state.result === 'draw') { api.over({ winner: 'draw', text: '무승부 · 판이 꽉 찼다' }); return; }
  const winner = 3 - state.stm, mine = winner === human;
  api.over({
    winner: mine ? 'human' : 'penopi',
    vars: { n: Math.ceil(moves.length / 2) },
    text: `${api.chip(colorOf(winner))}${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
  render();
}

// ---------- input: tap once to aim, again to play ----------
function onPoint(s) {
  if (!playing || state.result || state.stm !== human || state.b[s]) return;
  if (state.forb.has(s)) { api.say('forbiddenTap'); return; }
  if (pending === s) { commit(s); return; }
  pending = s;
  api.peek((visual(s) % N + 0.5) / N, true);
  render();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && pending >= 0) { pending = -1; render(); } });

// ---------- drawing: a pen grid of 15 lines, stones on the intersections ----------
const visual = (s) => (human === 1 ? s : N * N - 1 - s); // as White the board is turned around (cosmetic)
const pos = (s) => { const v = visual(s); return [(v % N) * 100 + 50, Math.floor(v / N) * 100 + 50]; };
function build() {
  const S = N * 100, j = (k, i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return (x - Math.floor(x) - 0.5) * k; };
  let d = '';
  for (let i = 0; i < N; i++) {
    const p = i * 100 + 50;
    d += `M${(50 + j(4, i)).toFixed(1)} ${(p + j(3, i + 50)).toFixed(1)} Q${S / 2 + j(8, i + 7)} ${(p + j(6, i + 9)).toFixed(1)} ${(S - 50 + j(4, i + 3)).toFixed(1)} ${(p + j(3, i + 5)).toFixed(1)} `;
    d += `M${(p + j(3, i + 60)).toFixed(1)} ${(50 + j(4, i + 70)).toFixed(1)} Q${(p + j(6, i + 80)).toFixed(1)} ${S / 2 + j(8, i + 90)} ${(p + j(3, i + 100)).toFixed(1)} ${(S - 50 + j(4, i + 110)).toFixed(1)} `;
  }
  const stars = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]].map(([r, c]) => `<circle cx="${c * 100 + 50}" cy="${r * 100 + 50}" r="9" fill="#1b1b1b"/>`).join('');
  boardEl.innerHTML = `<svg class="gogrid" viewBox="0 0 ${S} ${S}" aria-hidden="true"><path d="${d}" fill="none" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${stars}<g class="win"></g></svg>`;
  svgEl = boardEl.querySelector('svg');
  boardEl.setAttribute('role', 'grid');
  for (let v = 0; v < N * N; v++) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'pt';
    el.style.left = `${(v % N) * (100 / N)}%`; el.style.top = `${Math.floor(v / N) * (100 / N)}%`;
    el.addEventListener('click', () => onPoint(human === 1 ? v : N * N - 1 - v));
    boardEl.appendChild(el); ptEls.push(el);
  }
}
function render(anim) {
  const st = state;
  for (let v = 0; v < N * N; v++) {
    const s = human === 1 ? v : N * N - 1 - v, el = ptEls[v], p = st.b[s];
    let h = '';
    if (p) h = `<span class="stone ${colorOf(p)}${s === st.last ? ' last' : ''}${anim === s && !reduced() ? ' drop' : ''}"></span>`;
    else if (s === pending) h = `<span class="stone ${colorOf(human)} ghost"></span>`;
    else if (st.forb.has(s)) h = '<span class="ban"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    const r = Math.floor(s / N), c = s % N;
    el.setAttribute('aria-label', `${'ABCDEFGHJKLMNOP'[c]}${N - r}${p ? (p === 1 ? ' 흑' : ' 백') : st.forb.has(s) ? ' 금수' : ' 빈 곳'}${s === pending ? ', 한 번 더 누르면 둠' : ''}`);
  }
  const win = svgEl.querySelector('.win');
  if (st.five) {
    const [a, b] = st.five.map(pos);
    win.innerHTML = `<path d="M${a[0]} ${a[1]} L${b[0]} ${b[1]}" pathLength="1" fill="none" stroke="#d8452f" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke" class="winline"/>`;
  } else win.innerHTML = '';
}
function stop() { g++; if (engine) engine.restart(); }

export default {
  id: 'gomoku',
  name: '오목',
  sides: [
    { id: 1, first: true, html: '<span class="chip b"></span>흑 · 선공' },
    { id: 2, first: false, html: '<span class="chip w"></span>백 · 후공' },
  ],
  options: [{ key: 'rule', label: '규칙', default: 'ban33',
    choices: [{ id: 'free', html: '자유' }, { id: 'ban33', html: '흑 쌍삼 금지' }, { id: 'renju', html: '렌주' }] }],
  lines: LINES,
  chat: ['chatGomoku'],
  longGame: 80,
  rules: {
    title: '오목, 규칙도 몰라?',
    html: `
    <li><b>가로, 세로, 대각선 중 한 줄로 내 돌 다섯 개를 먼저 이으면 이긴다.</b> 흑이 먼저 두고, 번갈아 빈 점에 하나씩 놓는다.
      <span class="aside">판에서는 한 번 누르면 흐린 돌이 놓이고, 같은 곳을 한 번 더 누르면 둔다.</span></li>
    <li><b>규칙은 대국 전에 고른다.</b>
      <span class="aside">흑이 먼저 둬서 유리하니까, 규칙이 흑을 얼마나 묶느냐가 다르다.</span></li>
    <li><b>자유:</b> 다섯 개 이상이면 누구든 이긴다. 금지된 자리 없음.</li>
    <li><b>흑 쌍삼 금지:</b> 흑은 열린 삼(한 수 더 두면 양쪽이 열린 사가 되는 셋)을 한 번에 두 개 만들 수 없다. 여섯 개 이상도 이긴 걸로 친다.</li>
    <li><b>렌주:</b> 흑은 쌍삼, 쌍사(사를 한 번에 두 개), 장목(여섯 개 이상)을 둘 수 없고, 정확히 다섯 개로만 이긴다. 백은 다섯 개 이상이면 이긴다.
      다섯을 만드는 수는 금지된 모양이 같이 생겨도 둘 수 있다.
      <span class="aside">흑이 금지된 자리는 판에 빨간 ×로 표시해 줄게. 착하지?</span></li>
    <li><b>판이 꽉 찰 때까지 아무도 못 이으면 무승부.</b></li>`,
  },
  debug: () => ({ legal: state.b.map((v, s) => (!v && !state.forb.has(s) ? s : -1)).filter((s) => s >= 0), stm: state.stm, human, over: !!state.result,
    playing, plies: moves.length, cells: Array.from({ length: N * N }, (_, s) => visual(s)) }),
  mount(a) {
    api = a; boardEl = a.board;
    rule = (a.options && a.options.rule) || rule;
    build();
    state = replay();
    render();
  },
  optionChanged(key, val) { if (key === 'rule') rule = val; },
  start(side, opts = {}) {
    stop();
    human = side; rule = opts.rule || rule; moves = []; pending = -1; playing = true;
    boardEl.setAttribute('aria-label', `오목 판(${RULE_NAMES[rule]}), 나는 ${sideName(side)}`);
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    playing = false; moves = []; pending = -1; human = 1;
    state = replay();
    render();
  },
};
