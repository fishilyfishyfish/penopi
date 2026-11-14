// Dots and Boxes. The engine (engine.js) was written for this site: alpha-beta in plain JS, loaded on the page for
// the rules and in worker.js for thinking (the arrangement LOA 튀르크 used). Near the end it reads to the last line.
// A move is one tap on the gap between two dots. Closing a box claims it and the same side draws again, so a turn
// can be several lines; Penopi's lines come one after another. My boxes get pencil hatching, Penopi's red pen.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, CLAIM_MS = 700, HARD_LIMIT = THINK_MS + 4000;
const SIZES = { 3: 3, 4: 4, 5: 5 };

let api, boardEl, lineEls = [], boxEls = [], svgEl = null;
let N = 4, R = null, human = 1, moves = [], state = null, playing = false, g = 0;
let engine = null, localE = null, turnStart = { lines: 0, score: [0, 0, 0] };

function newEngine(tt) { return globalThis.DotsEngine({ rows: N, cols: N, ttBits: tt }); }
function replay() {
  R.setStart();
  for (const m of moves) R.play(m);
  const over = R.status() === 'over';
  return { stm: R.stm, over, legal: over ? [] : R.legalMoves(), score: [0, R.score(1), R.score(2)],
    owner: Array.from({ length: R.NB }, (_, b) => R.owner(b)), drawn: Array.from({ length: R.E }, (_, l) => R.isDrawn(l)), left: R.left,
    last: moves.length ? moves[moves.length - 1] : -1 };
}

// ---------- thinking ----------
function client() {
  if (!engine) engine = workerClient(new URL('./worker.js', import.meta.url), { type: 'classic' });
  return engine;
}
async function think(time) {
  try {
    return await client().call({ size: N, moves: moves.slice(), time }, { timeout: HARD_LIMIT });
  } catch (err) {
    if (/다시 시작/.test(err.message)) return null;
    if (!(err instanceof TimeoutError)) console.warn(err);
    if (!localE || localE.R !== N) localE = newEngine(16);
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600) });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ text: `${api.name} 차례 · 상자 ${scoreText()}` });
  render();
  const claimable = state.legal.some((l) => R.claims(l));
  const t0 = Date.now();
  const info = await think(claimable ? CLAIM_MS : THINK_MS);
  if (my !== g || !info) return;
  const pause = moves.length > turnStart.lines ? 300 : 500; // the second and later lines of a turn come quicker
  if (Date.now() - t0 < pause) await new Promise((r) => setTimeout(r, pause - (Date.now() - t0)));
  if (my !== g) return;
  commit(state.legal.includes(info.move) ? info.move : state.legal[0], info);
}

// ---------- moves ----------
let lastInfo = null;
function commit(l, info) {
  const mover = state.stm, safeBefore = state.legal.some((x) => R.safe(x)), gave = !R.claims(l) && !R.safe(l);
  moves.push(l);
  state = replay();
  if (info) lastInfo = info;
  render(l);
  if (state.over) { endTurn(mover, safeBefore, gave); finish(); return; }
  if (state.stm === mover) { proceed(); return; } // claimed a box: the same side draws again
  endTurn(mover, safeBefore, gave);
  proceed();
}
// a turn ended (the other side moves now, or the game is over): remark on it as a whole
function endTurn(mover, safeBefore, gave) {
  const got = state.score[mover] - turnStart.score[mover];
  const facts = [];
  const safeNow = state.legal.some((x) => R.safe(x));
  if (mover === human) {
    if (got >= 3) facts.push(['humanChain', { n: got }]);
    else if (got) facts.push(['humanClaim', { n: got }, 0.5]);
    if (gave && safeBefore) facts.push(['humanGives', null, 0.8]);
    if (!safeNow && safeBefore && !state.over) facts.push(['noSafe', null, 0.7]);
    if (!state.over) api.humanMoved({ facts, plies: moves.length });
  } else {
    // claimed this turn and stopped short, handing over two boxes: a double-deal to keep control
    const handed = state.legal.filter((x) => R.claims(x)).length;
    if (got && handed && !state.over) facts.push(['engineDoubleDeal', null, 0.9]);
    if (got >= 3) facts.push(['engineChain', { n: got }]);
    else if (got) facts.push(['engineClaim', { n: got }, 0.5]);
    if (gave && !safeBefore && !got) facts.push(['engineGives', null, 0.6]);
    if (!safeNow && safeBefore && !state.over) facts.push(['noSafe', null, 0.7]);
    if (!state.over && lastInfo) {
      const diff = (state.score[3 - human] - state.score[human]) * 100, sc = lastInfo.score;
      // the engine's score is the margin it expects from the boxes still free, before its last line; near enough
      const exact = lastInfo.exact, fin = exact ? lastInfo.final * 100 + (turnStart.score[3 - human] - turnStart.score[human]) * 100 : 0;
      api.engineMoved({
        p: exact ? (fin > 0 ? 0.99 : fin < 0 ? 0.01 : 0.5) : 1 / (1 + Math.exp(-(diff + sc - got * 100) / 250)),
        mate: 0,
        doomed: exact && fin < 0,
        nodes: lastInfo.nodes, depth: lastInfo.depth,
        facts,
      });
    }
  }
  turnStart = { lines: moves.length, score: state.score.slice() };
}
const scoreText = () => `${state.score[human]}:${state.score[3 - human]}`; // mine first (short: it shares a row with the rules button)
function proceed() {
  if (!playing) return;
  if (state.over) { finish(); return; }
  if (state.stm === human) api.yourTurn({ text: `내 차례 · 상자 ${scoreText()}` });
  else engineMove();
  render();
}
function finish() {
  playing = false;
  const a = state.score[human], b = state.score[3 - human];
  const vars = { a, b, n: Math.ceil(moves.length / 2) };
  if (a === b) { api.over({ winner: 'draw', key: 'drawBoxes', vars, text: `무승부 · ${a}:${b}` }); render(); return; }
  const won = a > b;
  api.over({ winner: won ? 'human' : 'penopi', key: !won && a === 0 ? 'engineWinAll' : undefined, vars, text: `${won ? '내가 이겼다' : `${api.name}가 이겼다`} · ${a}:${b}` });
  render();
}

// ---------- input ----------
function onLine(l) {
  if (!playing || state.over || state.stm !== human) return;
  if (state.legal.includes(l)) commit(l, null);
}

// ---------- drawing: dots on paper, pen lines, hatched boxes ----------
const GAP = 100, PAD = 40;
const dotXY = ([r, c]) => [PAD + c * GAP, PAD + r * GAP];
function jit(i, k) { const x = Math.sin(i * 12.9898 + 7.7) * 43758.5453; return (x - Math.floor(x) - 0.5) * k; }
function build() {
  boardEl.innerHTML = ''; lineEls = []; boxEls = [];
  const S = PAD * 2 + N * GAP;
  boardEl.style.setProperty('--n', N);
  let dots = '';
  for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) { const [x, y] = dotXY([r, c]); dots += `<circle cx="${x + jit(r * 9 + c, 2)}" cy="${y + jit(r * 7 + c * 3, 2)}" r="6.5" fill="#1b1b1b"/>`; }
  boardEl.insertAdjacentHTML('beforeend', `<svg class="dgrid" viewBox="0 0 ${S} ${S}" aria-hidden="true"><g class="boxes"></g><g class="lines"></g>${dots}</svg>`);
  svgEl = boardEl.querySelector('svg');
  boardEl.setAttribute('role', 'group');
  // a button over each gap between two dots
  for (let l = 0; l < R.E; l++) {
    const [a, b] = R.lineEnds(l), [x1, y1] = dotXY(a), [x2, y2] = dotXY(b), horiz = a[0] === b[0];
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'gap ' + (horiz ? 'h' : 'v');
    const cx = (x1 + x2) / 2 / S * 100, cy = (y1 + y2) / 2 / S * 100;
    el.style.left = cx + '%'; el.style.top = cy + '%';
    el.addEventListener('click', () => onLine(l));
    boardEl.appendChild(el); lineEls.push(el);
  }
}
function render(anim) {
  if (!svgEl) return;
  const st = state, mine = playing && st.stm === human && !st.over;
  let lines = '', boxes = '';
  for (let l = 0; l < R.E; l++) {
    const el = lineEls[l];
    el.disabled = st.drawn[l] || !mine;
    el.classList.toggle('can', mine && !st.drawn[l]);
    if (!st.drawn[l]) { el.setAttribute('aria-label', '빈 선'); continue; }
    el.setAttribute('aria-label', '그어진 선');
    const [a, b] = R.lineEnds(l), [x1, y1] = dotXY(a), [x2, y2] = dotXY(b);
    const d = `M${x1 + jit(l, 3)} ${y1 + jit(l + 1, 3)} Q${(x1 + x2) / 2 + jit(l + 2, 7)} ${(y1 + y2) / 2 + jit(l + 3, 7)} ${x2 + jit(l + 4, 3)} ${y2 + jit(l + 5, 3)}`;
    lines += `<path d="${d}" class="${l === st.last ? 'last' : ''}${l === anim && !reduced() ? ' new' : ''}"/>`;
  }
  for (let b = 0; b < R.NB; b++) {
    const o = st.owner[b];
    if (!o) continue;
    const r = Math.floor(b / N), c = b % N, x = PAD + c * GAP, y = PAD + r * GAP;
    let h = '';
    for (let k = 1; k < 7; k++) { // hatching: short diagonal strokes inside the box
      const t = k * 14;
      h += `M${x + 8 + Math.max(0, t - 84)} ${y + 8 + Math.min(t, 84)} L${x + 8 + Math.min(t, 84)} ${y + 8 + Math.max(0, t - 84)} `;
    }
    boxes += `<path d="${h}" class="hatch ${o === human ? 'me' : 'pen'}"/>`;
    if (o !== human) boxes += `<text x="${x + 50}" y="${y + 62}" class="mark">P</text>`;
  }
  svgEl.querySelector('.lines').innerHTML = lines;
  svgEl.querySelector('.boxes').innerHTML = boxes;
}
function stop() { g++; if (engine) engine.restart(); }

export default {
  id: 'dots',
  name: '점과 상자',
  sides: [
    { id: 1, first: true, html: '선공' },
    { id: 2, first: false, html: '후공' },
  ],
  options: [{ key: 'size', label: '판', choices: [{ id: '3', html: '3×3' }, { id: '4', html: '4×4' }, { id: '5', html: '5×5' }], default: '4' }],
  lines: LINES,
  chat: ['chatDots'],
  longGame: 60,
  rules: {
    title: '점과 상자, 규칙도 몰라?',
    html: `
    <li><b>상자를 더 많이 차지하면 이긴다.</b> 같으면 비긴다.</li>
    <li><b>번갈아 가며 이웃한 두 점 사이에 선을 하나씩 긋는다.</b> 가로나 세로로, 바로 옆 점끼리만.</li>
    <li><b>상자의 네 번째 변을 그은 사람이 그 상자를 갖고, 한 번 더 긋는다.</b> 한 번에 상자 두 개가 닫혀도 마찬가지.
      <span class="aside">그래서 한 차례에 선을 여러 개 그을 수도 있어. 다 먹을 때까지.</span></li>
    <li><b>모든 선을 다 그으면 끝.</b> 판 크기는 시작 전에 고른다(상자 3×3, 4×4, 5×5).</li>
    <li><b>팁: 세 변이 그어진 상자는 상대에게 주는 선물이다.</b> 안전한 선이 다 떨어지면, 누가 먼저 긴 줄을 내주느냐의 싸움이 된다.
      <span class="aside">마지막 두 개를 일부러 남겨 주는 수도 있어. 내가 쓰는 걸 보면 알 거야.</span></li>
    <li><b>판에서는</b> 두 점 사이 빈 곳을 누르면 선이 그어진다. 내 상자는 연필 빗금, 페노피 상자는 빨간 펜으로 칠해진다.</li>`,
  },
  debug: () => ({ legal: state.legal.slice(), stm: state.stm, human, over: state.over, playing, plies: moves.length, cells: null }),
  mount(a) {
    api = a; boardEl = a.board;
    R = newEngine(8);
    build();
    state = replay();
    render();
  },
  start(side, opts) {
    stop();
    const n = SIZES[(opts && opts.size) || '4'] || 4;
    if (n !== N || !R) { N = n; R = newEngine(8); build(); localE = null; }
    human = side; moves = []; playing = true; turnStart = { lines: 0, score: [0, 0, 0] }; lastInfo = null;
    boardEl.setAttribute('aria-label', `점과 상자 판 ${N}×${N}, 나는 ${side === 1 ? '선공' : '후공'}`);
    state = replay();
    render();
    proceed();
  },
  reset() {
    stop();
    playing = false; moves = [];
    state = replay();
    render();
  },
};
