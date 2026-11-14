// Go on 9×9 (area scoring, komi 7.5). The engine (engine.js) was written for this site: Monte Carlo tree search in
// plain JS, loaded on the page for the rules and the final count, and in worker.js for thinking.
// Penopi is still learning go (like chess: no record kept). A move is one tap on an intersection; "쉬기" under the
// board passes. Two passes in a row end the game: dead stones are found by playing the position out many times,
// crossed out, and the area is counted.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { reduced } from '../shared/character.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.GoEngine({ nodes: 20000 });
const N = R.N, PASS = R.PASS;
const colorOf = (c) => (c === 1 ? 'b' : 'w');
const sideName = (c) => (c === 1 ? '흑' : '백');

let api, boardEl, ptEls = [], svgEl = null;
let human = 1, moves = [], state = null, playing = false, g = 0, final = null, resigned = 0;
let engine = null, localE = null;

function replay() {
  R.setStart();
  for (const m of moves) R.play(m);
  const over = R.status() === 'over';
  return { b: Array.from(R.cells()), stm: R.stm, over, caps: [0, R.captures(1), R.captures(2)], last: moves.length ? moves[moves.length - 1] : null, ko: R.ko };
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
    if (!localE) localE = globalThis.GoEngine({ nodes: 60000 });
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600) });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorOf(3 - human), text: `${api.chip(colorOf(3 - human))}${api.name} 차례` });
  tray(); render();
  const t0 = Date.now();
  const info = await think(THINK_MS);
  if (my !== g || !info) return;
  if (Date.now() - t0 < 500) await new Promise((r) => setTimeout(r, 500));
  if (my !== g) return;
  if (info.resign) { resigned = 3 - human; finish(); return; }
  let m = info.move;
  if (m !== PASS && !R.legal(m)) m = PASS;
  commit(m, info);
}

// ---------- moves ----------
function commit(m, info) {
  const mover = state.stm, before = state.b;
  moves.push(m);
  state = replay();
  const gone = [];
  if (m !== PASS) for (let s = 0; s < N * N; s++) if (before[s] && !state.b[s]) gone.push(s);
  render(m, gone, before);
  const facts = [], n = gone.length;
  if (mover === human) {
    if (m === PASS) facts.push(['humanPass']);
    else if (n >= 3) facts.push(['humanBigCapture', { n }]);
    else if (n) facts.push(['humanCapture', { n }, 0.6]);
    if (!state.over) api.humanMoved({ facts, plies: moves.length });
  } else {
    if (m === PASS) facts.push(['enginePass']);
    else if (n >= 3) facts.push(['engineBigCapture', { n }]);
    else if (n) facts.push(['engineCapture', { n }, 0.6]);
    if (!state.over && info) api.engineMoved({ p: info.winrate, mate: 0, doomed: false, nodes: info.playouts, depth: 0, facts });
    if (m !== PASS) api.runTo(((m % N) + 0.5) / N);
  }
  proceed();
}
function proceed() {
  tray();
  if (!playing) return;
  if (state.over) { finish(); return; }
  if (state.stm === human) {
    const passed = moves.length && moves[moves.length - 1] === PASS;
    api.yourTurn({ color: colorOf(human), label: sideName(human), text: `${api.chip(colorOf(human))}내 차례${passed ? ` · ${api.name}가 쉬었어` : ''}` });
  } else engineMove();
  render();
}
function finish() {
  playing = false;
  tray();
  if (resigned) {
    api.over({ winner: 'human', key: 'engineResign', text: `${api.chip(colorOf(human))}${api.name}가 돌을 던졌다` });
    render();
    return;
  }
  // count: dead stones from many playouts, then area with komi
  const est = R.estimate(400);
  final = est;
  const black = est.margin; // Black's margin with komi
  const humanMargin = human === 1 ? black : -black;
  const vars = { m: Math.abs(black).toFixed(1).replace(/\.0$/, ''), n: Math.ceil(moves.length / 2) };
  const won = humanMargin > 0;
  api.over({ winner: won ? 'human' : 'penopi', vars, text: `${won ? '내가 이겼다' : `${api.name}가 이겼다`} · ${black > 0 ? '흑' : '백'} ${vars.m}집 승` });
  render();
}

// ---------- the tray: pass ----------
function tray() {
  const t = api.tray, mine = playing && state && !state.over && state.stm === human;
  if (!mine) { t.hidden = true; t.innerHTML = ''; t.dataset.h = ''; return; }
  const html = '<button type="button" class="btn small" data-act="pass">쉬기</button>';
  if (t.dataset.h !== html) { t.innerHTML = html; t.dataset.h = html; }
  t.hidden = false;
}

// ---------- input ----------
function onPoint(s) {
  if (!playing || state.over || state.stm !== human) return;
  if (state.b[s]) return;
  if (!R.legal(s)) { api.say(s === state.ko ? 'koBan' : 'suicideBan'); return; }
  commit(s, null);
}

// ---------- drawing: a pen grid of 9 lines, stones on the intersections ----------
const pos = (s) => [(s % N) * 100 + 50, Math.floor(s / N) * 100 + 50];
function build() {
  const S = N * 100, j = (k, i) => { const x = Math.sin(i * 12.9898 + 3.3) * 43758.5453; return (x - Math.floor(x) - 0.5) * k; };
  let d = '';
  for (let i = 0; i < N; i++) {
    const p = i * 100 + 50;
    d += `M${(50 + j(4, i)).toFixed(1)} ${(p + j(3, i + 50)).toFixed(1)} Q${S / 2 + j(8, i + 7)} ${(p + j(6, i + 9)).toFixed(1)} ${(S - 50 + j(4, i + 3)).toFixed(1)} ${(p + j(3, i + 5)).toFixed(1)} `;
    d += `M${(p + j(3, i + 60)).toFixed(1)} ${(50 + j(4, i + 70)).toFixed(1)} Q${(p + j(6, i + 80)).toFixed(1)} ${S / 2 + j(8, i + 90)} ${(p + j(3, i + 100)).toFixed(1)} ${(S - 50 + j(4, i + 110)).toFixed(1)} `;
  }
  const stars = [[2, 2], [2, 6], [4, 4], [6, 2], [6, 6]].map(([r, c]) => `<circle cx="${c * 100 + 50}" cy="${r * 100 + 50}" r="9" fill="#1b1b1b"/>`).join('');
  boardEl.innerHTML = `<svg class="gogrid" viewBox="0 0 ${S} ${S}" aria-hidden="true"><path d="${d}" fill="none" stroke="#1b1b1b" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${stars}</svg>`;
  svgEl = boardEl.querySelector('svg');
  boardEl.setAttribute('role', 'grid');
  ptEls = [];
  for (let s = 0; s < N * N; s++) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'pt';
    el.style.left = `${(s % N) * (100 / N)}%`; el.style.top = `${Math.floor(s / N) * (100 / N)}%`;
    el.addEventListener('click', () => onPoint(s));
    boardEl.appendChild(el); ptEls.push(el);
  }
}
const NAME = (s) => 'ABCDEFGHJ'[s % N] + (N - Math.floor(s / N));
function render(anim, gone, before) {
  const st = state;
  const dead = new Set(final && !playing ? final.dead : []);
  for (let s = 0; s < N * N; s++) {
    const el = ptEls[s], p = st.b[s];
    let h = '';
    if (p) h = `<span class="stone ${colorOf(p)}${s === st.last ? ' last' : ''}${anim === s && !reduced() ? ' drop' : ''}${dead.has(s) ? ' dead' : ''}"></span>`;
    else if (final && !playing) { const o = final.owner[s]; if (o > 0.5) h = '<span class="terr b"></span>'; else if (o < -0.5) h = '<span class="terr w"></span>'; }
    if (dead.has(s) && final && !playing) h += '<span class="cross"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.setAttribute('aria-label', NAME(s) + (p ? (p === 1 ? ' 흑' : ' 백') : ' 빈 점'));
  }
  // captured stones are scribbled out where they stood
  if (gone && gone.length && !reduced()) for (const s of gone) {
    const el = document.createElement('div');
    el.className = 'ghost';
    el.style.left = `${(s % N) * (100 / N)}%`; el.style.top = `${Math.floor(s / N) * (100 / N)}%`;
    el.innerHTML = `<span class="stone ${colorOf(before[s])}"></span><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>`;
    boardEl.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
}
function stop() { g++; if (engine) engine.restart(); }

export default {
  id: 'go',
  name: '바둑',
  practice: true, // Penopi is still learning: no record (shared/shell.js)
  sides: [
    { id: 1, first: true, html: '<span class="chip b"></span>흑 · 선공' },
    { id: 2, first: false, html: '<span class="chip w"></span>백 · 후공' },
  ],
  lines: LINES,
  chat: ['chatGo'],
  longGame: 80,
  rules: {
    title: '바둑, 규칙도 몰라?',
    html: `
    <li><b>9줄 판. 흑부터 번갈아 선이 만나는 점에 돌을 하나씩 놓는다.</b> 놓은 돌은 움직이지 않는다.</li>
    <li><b>돌이나 이어진 돌 덩어리의 숨 쉴 곳(바로 옆 빈 점)을 상대가 다 막으면 그 돌들을 들어낸다.</b></li>
    <li><b>놓자마자 내 돌이 숨 쉴 곳이 없어지는 자리는 못 둔다.</b> 그 수로 상대 돌을 잡는다면 괜찮다.</li>
    <li><b>패: 판 전체가 예전과 똑같아지는 수는 못 둔다.</b>
      <span class="aside">돌 하나를 서로 계속 따먹는 걸 막는 규칙이야. 한 번 딴 데 두고 와.</span></li>
    <li><b>둘 다 연달아 쉬면(판 아래 "쉬기") 끝난다.</b> 살 수 없는 돌은 죽은 돌로 치고 들어낸다(X 표시).</li>
    <li><b>계가: 내 돌 수 + 내 돌로만 둘러싸인 빈 점 수. 백은 나중에 두니까 7.5집을 더 받는다(덤).</b> 많은 쪽이 이긴다. 반 집이 있어서 비기지 않는다.</li>
    <li><b>팁: 끝날 무렵 쉬기 전에, 아직 경계가 열린 곳이 없는지 봐.</b>
      <span class="aside">나는 아직 바둑을 배우는 중이라 전적은 안 적어.</span></li>`,
  },
  debug: () => ({ legal: playing && !state.over ? Array.from({ length: N * N }, (_, s) => s).filter((s) => !state.b[s] && R.legal(s)) : [], stm: state.stm, human, over: state.over || !playing, playing, plies: moves.length, cells: null }),
  mount(a) {
    api = a; boardEl = a.board;
    build();
    api.tray.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="pass"]') && playing && !state.over && state.stm === human) commit(PASS, null);
    });
    state = replay();
    render();
  },
  start(side) {
    stop();
    human = side; moves = []; playing = true; final = null; resigned = 0;
    boardEl.setAttribute('aria-label', '바둑 판 9줄, 나는 ' + sideName(side));
    state = replay();
    render();
    proceed();
  },
  reset() {
    stop();
    playing = false; moves = []; final = null; resigned = 0;
    state = replay();
    tray();
    render();
  },
};
