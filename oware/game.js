// Oware (abapa rules). The engine (engine.js) was written for this site: alpha-beta in plain JS, loaded on
// the page for the rules and in worker.js for thinking (the arrangement LOA 튀르크 used).
// My row is always the bottom one, sowing goes counterclockwise: along my row to the right, up, and back
// along Penopi's row to the left. My store is on the right, Penopi's on the left. A move is one tap on a pit;
// the seeds are then sown one by one and the captured pits are emptied into the store.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.OwareEngine({ ttBits: 8 });
const { WIN, WIN_BOUND } = R;

let api, boardEl, pitEls = [], storeEls = [];
let human = 0, moves = [], state = null, playing = false, g = 0, animating = false, shown = null, hot = new Set(), taken = new Set();
let engine = null, localE = null, early = null;

function replay() {
  R.setStart();
  for (const m of moves) R.play(m);
  const result = R.status();
  return { b: Array.from(R.board), stm: R.stm, result, legal: result ? [] : R.legalMoves(), last: moves.length ? moves[moves.length - 1] : -1,
    final: result ? R.finalScores() : null };
}
// which pit is drawn in which cell: bottom row (my pits) left to right, top row (Penopi's) right to left
const cellOf = (pit) => {
  const mine = Math.floor(pit / 6) === human, k = pit % 6;
  return mine ? { row: 1, col: k } : { row: 0, col: 5 - k };
};

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
    if (!localE) localE = globalThis.OwareEngine({ ttBits: 16 });
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600) });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ text: `${api.name} 차례` });
  render();
  const t0 = Date.now();
  // usually already started while my seeds were being sown
  const info = await (early && early.ply === moves.length ? early.p : think(THINK_MS));
  early = null;
  if (my !== g || !info) return;
  if (Date.now() - t0 < 500) await new Promise((r) => setTimeout(r, 500));
  if (my !== g) return;
  const m = state.legal.includes(info.move) ? info.move : state.legal[0];
  commit(m, info);
}

// ---------- moves ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function commit(m, info) {
  const my = g, mover = state.stm, opp = 1 - mover;
  R.setStart(); for (const x of moves) R.play(x);
  const pv = R.preview(m), seeds = state.b[m], starving = R.sideSeeds(opp) === 0;
  moves.push(m);
  const next = replay();
  if (!next.result && next.stm !== human) early = { ply: moves.length, p: think(THINK_MS) }; // think during the sowing
  // sow one seed at a time, then empty the captured pits into the store
  animating = true;
  if (!reduced()) {
    shown = state.b.slice(); shown[m] = 0; hot = new Set([m]);
    render();
    const step = Math.max(55, Math.min(170, 1900 / pv.path.length));
    for (const p of pv.path) {
      await wait(step);
      if (my !== g) return;
      shown[p]++; hot = new Set([p]);
      render();
    }
    if (pv.captured.length) {
      await wait(260);
      if (my !== g) return;
      taken = new Set(pv.captured); hot = new Set();
      for (const p of pv.captured) shown[p] = 0;
      shown[12 + mover] += pv.seeds;
      render();
      await wait(520);
      if (my !== g) return;
    }
  }
  animating = false; shown = null; hot = new Set(); taken = new Set();
  state = next;
  render();
  const facts = [];
  const lastCell = cellOf(pv.path[pv.path.length - 1]);
  if (mover === human) {
    if (pv.seeds >= 6) facts.push(['humanBigCapture', { n: pv.seeds }]);
    else if (pv.seeds) facts.push(['humanCapture', { n: pv.seeds }, 0.7]);
    if (pv.slam) facts.push(['humanSlam']);
    if (starving) facts.push(['humanFeeds', null, 0.6]);
    if (seeds >= 12) facts.push(['humanLap', null, 0.7]);
    api.humanMoved({ facts, plies: moves.length });
  } else {
    if (pv.seeds >= 6) facts.push(['engineBigCapture', { n: pv.seeds }]);
    else if (pv.seeds) facts.push(['engineCapture', { n: pv.seeds }, 0.6]);
    if (pv.slam) facts.push(['engineSlam']);
    if (starving) facts.push(['engineFeeds', null, 0.7]);
    if (seeds >= 12) facts.push(['engineLap', null, 0.7]);
    const sc = info ? info.score : 0;
    if (!state.result) api.engineMoved({
      p: 1 / (1 + Math.exp(-sc / 300)),
      mate: sc >= WIN_BOUND ? Math.max(1, Math.ceil((WIN - sc) / 2) - 1) : 0,
      doomed: sc <= -WIN_BOUND,
      nodes: info && info.nodes, depth: info && info.depth,
      facts,
    });
    if (pv.seeds) api.runTo((lastCell.col + 1.5) / 8);
  }
  proceed();
}
const storeText = () => `창고 ${state.b[12 + human]}:${state.b[13 - human]}`;
function proceed() {
  if (!playing) return;
  if (state.result) { finish(); return; }
  if (state.stm === human) api.yourTurn({ text: `뿌릴 칸을 골라 · ${storeText()}` });
  else engineMove();
  render();
}
function finish() {
  playing = false;
  const r = state.result, f = state.final, mine = f[human], theirs = f[1 - human];
  const vars = { n: Math.ceil(moves.length / 2), a: mine, b: theirs };
  if (mine === theirs) { api.over({ winner: 'draw', key: r === 'score' ? 'drawScore' : 'drawCycle', vars, text: `무승부 · ${mine}:${theirs}` }); render(); return; }
  const won = mine > theirs;
  const key = r === 'nofeed' ? (won ? 'humanWinNoFeed' : 'engineWinNoFeed') : r === 'repetition' || r === 'quiet' ? (won ? 'humanWinCycle' : 'engineWinCycle') : undefined;
  api.over({ winner: won ? 'human' : 'penopi', key, vars, text: `${won ? '내가 이겼다' : `${api.name}가 이겼다`} · ${mine}:${theirs}` });
  render();
}

// ---------- input ----------
function onPit(p) {
  if (!playing || animating || state.result || state.stm !== human) return;
  if (state.legal.includes(p)) commit(p);
  else if (Math.floor(p / 6) === human && state.b[p]) api.say('mustFeed'); // a full pit that isn't legal: it doesn't feed
}

// ---------- drawing ----------
// a seed's spot in a pit: a loose heap around the middle, fixed per (pit, seed) so redraws don't jitter
function seedSpot(key, k, spread) {
  const r = (i) => { const x = Math.sin((key * 97 + k * 13 + i) * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const a = k * 2.399 + r(1) * 0.6, d = Math.sqrt(k + 0.5) * spread * (0.85 + r(2) * 0.3);
  return [50 + Math.cos(a) * d, 50 + Math.sin(a) * d * 1.15, (r(3) - 0.5) * 70];
}
function seedsSvg(key, n, store) {
  const shown = Math.min(n, store ? 40 : 24), spread = store ? 6 : n > 14 ? 6.6 : 8.6, rr = store ? 5.6 : n > 14 ? 5.2 : 6.6;
  let s = '';
  for (let k = 0; k < shown; k++) {
    const [x, y, rot] = seedSpot(key, k, spread);
    s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rr}" ry="${(rr * 0.72).toFixed(1)}" transform="rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  return `<svg class="seeds" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g>${s}</g></svg>`;
}
function build() {
  boardEl.innerHTML = '';
  boardEl.setAttribute('role', 'group');
  pitEls = []; storeEls = [];
  const j = (i) => { const x = Math.sin(i * 7.31 + 1.7) * 43758.5453; return x - Math.floor(x); };
  const oval = (i) => `<svg class="hole" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M50 ${4 + j(i) * 3} C${88 + j(i + 1) * 6} ${5 + j(i + 2) * 4} ${96 - j(i + 3) * 3} ${92 - j(i + 4) * 4} 50 ${96 - j(i + 5) * 3} C${6 + j(i + 6) * 5} ${95 - j(i + 7) * 4} ${3 + j(i + 8) * 3} ${8 + j(i + 9) * 5} ${52 + j(i + 10) * 4} ${5 + j(i + 11) * 3}"/></svg>`;
  for (let p = 0; p < 12; p++) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'pit';
    el.innerHTML = oval(p * 13) + '<span class="seedbox"></span><span class="n"></span>';
    el.addEventListener('click', () => onPit(p));
    boardEl.appendChild(el); pitEls.push(el);
  }
  for (let s = 0; s < 2; s++) {
    const el = document.createElement('div');
    el.className = 'store';
    el.innerHTML = oval(200 + s * 17) + '<span class="seedbox"></span><span class="n"></span>';
    boardEl.appendChild(el); storeEls.push(el);
  }
}
function place() {
  for (let p = 0; p < 12; p++) {
    const { row, col } = cellOf(p), el = pitEls[p];
    el.style.gridRow = String(row + 1); el.style.gridColumn = String(col + 2);
    el.classList.toggle('top', row === 0);
  }
  // my store on the right, Penopi's on the left
  storeEls[human].style.gridColumn = '8'; storeEls[1 - human].style.gridColumn = '1';
  storeEls[human].classList.add('mine'); storeEls[1 - human].classList.remove('mine');
}
function render() {
  const st = state, b = shown || st.b, mine = playing && !animating && st.stm === human && !st.result;
  const legal = new Set(mine ? st.legal : []);
  for (let p = 0; p < 12; p++) {
    const el = pitEls[p], n = b[p];
    const h = `${n}|${taken.has(p) ? 1 : 0}`;
    if (el.dataset.h !== h) {
      el.dataset.h = h;
      el.querySelector('.seedbox').innerHTML = n ? seedsSvg(p, n, false) : '';
      el.querySelector('.n').textContent = n;
    }
    el.classList.toggle('can', legal.has(p));
    el.classList.toggle('hot', hot.has(p));
    el.classList.toggle('taken', taken.has(p));
    el.classList.toggle('last', !shown && st.last === p);
    const own = Math.floor(p / 6) === human;
    el.setAttribute('aria-label', `${own ? '내' : api.name + '의'} ${own ? p % 6 + 1 : 6 - (p % 6)}번째 칸, 씨앗 ${n}개${legal.has(p) ? ', 뿌릴 수 있음' : ''}`);
  }
  for (let s = 0; s < 2; s++) {
    const n = b[12 + s];
    const el = storeEls[s], h = String(n);
    if (el.dataset.h !== h) { el.dataset.h = h; el.querySelector('.seedbox').innerHTML = n ? seedsSvg(100 + s, n, true) : ''; el.querySelector('.n').textContent = n; }
    el.setAttribute('aria-label', `${s === human ? '내' : api.name + '의'} 창고, ${n}개`);
  }
}
function stop() { g++; early = null; animating = false; shown = null; hot = new Set(); taken = new Set(); if (engine) engine.restart(); }

export default {
  id: 'oware',
  name: '오와레',
  sides: [
    { id: 0, first: true, html: '선공' },
    { id: 1, first: false, html: '후공' },
  ],
  lines: LINES,
  chat: ['chatOware'],
  longGame: 70,
  rules: {
    title: '오와레, 규칙도 몰라?',
    html: `
    <li><b>씨앗을 25개 이상 가져가면 이긴다.</b> 처음엔 열두 칸에 넷씩, 모두 48개. 24개씩이면 비긴다.</li>
    <li><b>아래 줄 여섯 칸이 내 칸.</b> 내 칸 하나를 누르면 그 씨앗을 전부 집어서, 다음 칸부터 하나씩 뿌린다.
      방향은 시계 반대: 내 줄은 오른쪽으로, 끝에서 위로 올라가 상대 줄은 왼쪽으로.
      <span class="aside">씨앗이 12개 이상이면 한 바퀴를 돈다. 그때 집어 든 칸은 건너뛴다.</span></li>
    <li><b>마지막 씨앗이 상대 칸에 떨어져서 그 칸이 2개나 3개가 되면 그걸 가져간다.</b>
      바로 앞 칸들도 상대 칸이고 2개나 3개면 줄줄이 같이 가져간다. 내 칸에서는 아무리 2, 3이 돼도 못 가져가.</li>
    <li><b>상대 씨앗을 한 번에 몽땅 가져가는 수는 둘 수는 있지만, 하나도 못 가져간다.</b>
      <span class="aside">씨는 남겨 줘야 게임이 계속되니까.</span></li>
    <li><b>상대 칸이 다 비었으면 씨앗을 넘겨주는 수를 둬야 한다.</b> 넘겨줄 수가 없으면 거기서 끝나고, 내 줄에 남은 씨앗은 내가 갖는다.</li>
    <li><b>같은 자리가 같은 차례로 세 번 나오거나, 양쪽 100수씩 아무도 못 가져가면</b> 각자 자기 줄의 씨앗을 갖고 끝낸다.</li>
    <li><b>판에서는</b> 뿌릴 내 칸을 누른다. 가져간 씨앗은 양 끝 창고에 쌓인다(내 창고는 오른쪽).</li>`,
  },
  debug: () => ({ legal: animating ? [] : state.legal.slice(), stm: state.stm, human, over: !!state.result, playing: playing && !animating, plies: moves.length, cells: null }),
  mount(a) {
    api = a; boardEl = a.board;
    build(); place();
    state = replay();
    render();
  },
  start(side) {
    stop();
    human = side; moves = []; playing = true;
    boardEl.setAttribute('aria-label', '오와레 판, 나는 ' + (side === 0 ? '선공' : '후공'));
    place();
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
