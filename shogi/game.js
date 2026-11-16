// Shogi (쇼기). The engine (engine.js) was written for this site: alpha-beta in plain JS, loaded on the page for the
// rules and in worker.js for thinking, like janggi. The board is a 9×9 pen grid; pieces are five-sided tiles with the
// name drawn in pen (shared/glyphs.js: hangul or hanja, no font needed), pointing up for my pieces and down for
// Penopi's. Promoted pieces are written in red. Both hands sit in a row of seven slots, Penopi's above the board and mine
// below. Input: tap a piece, then where it goes (red dots); or tap a piece in my hand, then an empty point. A move that may
// or may not promote asks under the board. "입옥 선언" appears under the board when the declaration rule allows it.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { hopPiece, trail, wipe } from '../shared/sketch.js';
import { reduced } from '../shared/character.js';
import { GLYPHS } from '../shared/glyphs.js';

const THINK_MS = 2500, HARD_LIMIT = THINK_MS + 4000;
const R = globalThis.ShogiEngine({ ttBits: 8 });
const { SENTE, GOTE, DECLARE, K, MATE, MATE_BOUND, mFrom, mTo, isDrop, isPromo, isCap } = R;
const NAME_HANGUL = ['', '보', '향', '계', '은', '금', '각', '비', '왕', '토', '행', '규', '전', '마', '룡'];
const NAME_HANJA = ['', '歩', '香', '桂', '銀', '金', '角', '飛', '王', 'と', '杏', '圭', '全', '馬', '龍'];
const SCALE = [0, 0.84, 0.88, 0.9, 0.94, 0.94, 0.97, 0.97, 1, 0.84, 0.88, 0.9, 0.94, 0.97, 0.97];
const SLOTS = [7, 6, 5, 4, 3, 2, 1]; // hand slots left to right: 비 각 금 은 계 향 보
const sideName = (c) => (c === SENTE ? '선수' : '후수');
const colorOf = (c) => (c === SENTE ? 'b' : 'w');
const fx = (x) => String(x).replace(/\.0$/, '');

let api, boardEl, ptEls = [], slotEls = [[], []]; // slotEls[0]: top (Penopi's), [1]: bottom (mine)
let human = SENTE, moves = [], state = null, sel = null, promo = null, playing = false, g = 0, script = 'hangul', oppText = 'upright';
let engine = null, localE = null;

function replay() {
  R.setStart();
  for (const m of moves) R.play(m);
  const result = R.status();
  const b = Array.from(R.board), hands = [0, 1].map((c) => [0, 1, 2, 3, 4, 5, 6, 7].map((t) => (t ? R.hand(c, t) : 0)));
  return {
    b, hands, side: R.side, result, loser: R.loser, legal: result ? [] : R.legalMoves(), check: R.inCheck(),
    king: R.kings[R.side], last: moves.length && moves[moves.length - 1] !== DECLARE ? moves[moves.length - 1] : 0,
  };
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
    if (!localE) localE = globalThis.ShogiEngine({ ttBits: 16 });
    localE.setStart(); for (const m of moves) localE.play(m);
    return localE.think({ time: Math.min(time, 600) });
  }
}
async function engineMove() {
  const my = g;
  api.engineTurn({ color: colorOf(human ^ 1) });
  render();
  const t0 = Date.now();
  const info = await think(THINK_MS);
  if (my !== g || !info) return;
  if (Date.now() - t0 < 500) await new Promise((r) => setTimeout(r, 500 - (Date.now() - t0)));
  if (my !== g) return;
  commit(state.legal.includes(info.move) ? info.move : state.legal[0], info);
}

// ---------- moves ----------
function commit(m, info) {
  const mover = state.side, before = state.b;
  const taken = m !== DECLARE && isCap(m) ? before[mTo(m)] : 0;
  moves.push(m); sel = null; promo = null;
  if (taken) scribble(mTo(m), taken);
  state = replay();
  render(m);
  if (mover === human) humanTalk(m); else engineTalk(m, info, taken);
  if (taken && mover !== human) api.runTo((vis(mTo(m))[0] + 0.5) / 9);
  next();
}
function next() {
  tray();
  if (!playing) return;
  if (state.result) { finish(); return; }
  if (state.side === human) api.yourTurn({ color: colorOf(human), label: sideName(human), text: myStatus() });
  else engineMove();
  render();
}
function myStatus() {
  const base = `${api.chip(colorOf(human))}내 차례 (${sideName(human)})`;
  if (promo) return `${base} · 승급할래?`;
  return state.check ? `${base} · 장군!` : base;
}
function humanTalk(m) {
  if (state.result || m === DECLARE) return;
  const facts = [];
  if (state.check) facts.push(['humanCheck', null, 0.6]);
  if (isPromo(m)) facts.push(['humanPromote', null, 0.35]);
  if (isDrop(m)) facts.push(['humanDrop', null, 0.2]);
  api.humanMoved({ facts, plies: moves.length });
}
function engineTalk(m, info, taken) {
  if (state.result || m === DECLARE) return;
  const sc = info ? info.score : 0, facts = [];
  if (state.check) facts.push(['engineCheck', null, 0.8]);
  if (isPromo(m)) facts.push(['enginePromote', null, 0.4]);
  if (isDrop(m)) facts.push(['engineDrop', null, 0.3]);
  if (taken && [R.R, R.B, R.PR, R.PB].includes(taken & 15)) facts.push(['engineTakesBig', null, 0.4]);
  api.engineMoved({
    p: 1 / (1 + Math.exp(-sc / 350)),
    mate: sc >= MATE_BOUND ? Math.ceil((MATE - sc) / 2) : 0,
    doomed: sc <= -MATE_BOUND,
    nodes: info && info.nodes, depth: info && info.depth,
    facts,
  });
}
function finish() {
  playing = false;
  tray();
  const r = state.result, loser = state.loser, vars = { n: Math.ceil(moves.length / 2) };
  if (loser < 0) {
    api.over({ winner: 'draw', key: r === 'draw:limit' ? 'drawLimit' : 'drawRepetition', vars, text: r === 'draw:limit' ? '너무 길어서 · 무승부' : '같은 국면 네 번 · 무승부' });
    return;
  }
  const winner = loser ^ 1, mine = winner === human;
  const kind = r === 'declare' ? 'Declare' : r === 'perpetual' ? 'Perpetual' : 'Mate';
  const text = { Mate: '외통', Declare: '입옥 선언', Perpetual: '연속 장군 반칙' }[kind];
  api.over({
    winner: mine ? 'human' : 'penopi', key: (mine ? 'humanWin' : 'engineWin') + kind, vars,
    text: `${api.chip(colorOf(winner))}${text} · ${mine ? '내가 이겼다' : `${api.name}가 이겼다`}`,
  });
}

// ---------- input ----------
const movesFrom = (s) => state.legal.filter((m) => m !== DECLARE && !isDrop(m) && mFrom(m) === s);
const movesDrop = (t) => state.legal.filter((m) => m !== DECLARE && isDrop(m) && mFrom(m) - 81 === t);
function targets() {
  const out = new Map();
  if (!sel) return out;
  for (const m of sel.from !== undefined ? movesFrom(sel.from) : movesDrop(sel.drop)) out.set(mTo(m), isCap(m));
  return out;
}
function onSquare(s) {
  if (!playing || state.result || state.side !== human || promo) return;
  if (sel && targets().has(s)) {
    const ms = (sel.from !== undefined ? movesFrom(sel.from) : movesDrop(sel.drop)).filter((m) => mTo(m) === s);
    if (ms.length === 1) { commit(ms[0]); return; }
    promo = ms; render(); tray(); api.status(myStatus()); return; // promote or not?
  }
  const p = state.b[s];
  if (p && (p >> 4) === human && movesFrom(s).length) { sel = { from: s }; peek(s); }
  else sel = null;
  render();
}
function onSlot(t) {
  if (!playing || state.result || state.side !== human || promo) return;
  if (!movesDrop(t).length) return;
  sel = sel && sel.drop === t ? null : { drop: t };
  render();
}
let peekPly = -1;
function peek(s) { api.peek((vis(s)[0] + 0.5) / 9, peekPly !== moves.length); peekPly = moves.length; }
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (promo) { promo = null; tray(); render(); api.status(myStatus()); } else if (sel) { sel = null; render(); }
});
function tray() {
  const t = api.tray, mine = playing && state && !state.result && state.side === human;
  let html = '';
  if (mine && promo) {
    const p = state.b[promo[0] & 127] || 0, t0 = isDrop(promo[0]) ? 0 : p & 15;
    html = '<span class="q">승급?</span>'
      + `<button type="button" class="btn small promo" data-promo="1" aria-label="승급">${pieceSvg(human * 16 + R.PROMOTE_TO[t0], true)} 승급</button>`
      + `<button type="button" class="btn small promo" data-promo="0" aria-label="그대로">${pieceSvg(human * 16 + t0, true)} 그대로</button>`
      + '<button type="button" class="btn small" data-promo="x">취소</button>';
  } else if (mine && state.legal.includes(DECLARE)) html = '<button type="button" class="btn small" data-act="declare">입옥 선언</button>';
  if (!html) { t.hidden = true; t.innerHTML = ''; t.dataset.h = ''; return; }
  if (t.dataset.h !== html) { t.innerHTML = html; t.dataset.h = html; }
  t.hidden = false;
}

// ---------- drawing ----------
// my side at the bottom: as 선수 rank 9 on top; as 후수 the board turned around
const vis = (s) => { const r = (s / 9) | 0, f = s % 9; return human === SENTE ? [f, 8 - r] : [8 - f, r]; };
const pointAt = (vf, vr) => (human === SENTE ? (8 - vr) * 9 + vf : vr * 9 + (8 - vf));
const ptName = (s) => 'abcdefghi'[s % 9] + (((s / 9) | 0) + 1);
const glyphOf = (p) => {
  const t = p & 15;
  if (t === K) return script === 'hanja' ? ((p >> 4) === GOTE ? '玉' : '王') : ((p >> 4) === GOTE ? '옥' : '왕');
  return (script === 'hanja' ? NAME_HANJA : NAME_HANGUL)[t];
};
function pieceSvg(p, upright) {
  const t = p & 15, k = SCALE[t], pro = t > 8, turned = !upright && oppText === 'flipped';
  const gs = (0.6 * (script === 'hanja' ? 1.08 : 1)).toFixed(3), gy = upright || turned ? 57 : 43; // the tile's centre of mass moves when it points down
  const poly = '<polygon points="50,5 80,22 89,93 11,93 20,22"/>';
  const glyph = `<path class="g ${script}${pro ? ' pro' : ''}" d="${GLYPHS[script][glyphOf(p)]}" transform="translate(50 ${gy}) scale(${gs}) translate(-50 -50)"/>`;
  // pieces point at their owner; with the other side's names written upright (the default) only the tile turns round
  const inner = upright ? poly + glyph : turned ? poly + glyph : `<g transform="rotate(180 50 50)">${poly}</g>${glyph}`;
  const all = turned ? `<g transform="rotate(180 50 50)">${inner}</g>` : inner;
  return `<svg class="sp" viewBox="0 0 100 100" aria-hidden="true"><g transform="translate(50 50) scale(${k}) translate(-50 -50)">${all}</g></svg>`;
}
function build() {
  const W = 900, Hh = 1100, j = (k, i) => { const x = Math.sin(i * 12.9898 + 5.7) * 43758.5453; return (x - Math.floor(x) - 0.5) * k; };
  let d = '';
  for (let i = 0; i <= 9; i++) {
    const y = 100 + i * 100, x = i * 100;
    d += `M${(j(4, i)).toFixed(1)} ${(y + j(3, i + 20)).toFixed(1)} Q${W / 2 + j(8, i + 7)} ${(y + j(6, i + 9)).toFixed(1)} ${(W + j(4, i + 3)).toFixed(1)} ${(y + j(3, i + 5)).toFixed(1)} `;
    d += `M${(x + j(3, i + 60)).toFixed(1)} ${(100 + j(4, i + 70)).toFixed(1)} Q${(x + j(6, i + 80)).toFixed(1)} ${(550 + j(8, i + 90)).toFixed(1)} ${(x + j(3, i + 100)).toFixed(1)} ${(1000 + j(4, i + 110)).toFixed(1)} `;
  }
  const stars = [[3, 3], [3, 6], [6, 3], [6, 6]].map(([c, r]) => `<circle cx="${c * 100}" cy="${100 + r * 100}" r="9" fill="#1b1b1b"/>`).join('');
  boardEl.innerHTML = `<svg class="sgrid" viewBox="0 0 ${W} ${Hh}" aria-hidden="true"><path d="${d}" fill="none" stroke="#1b1b1b" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${stars}</svg>`;
  boardEl.setAttribute('role', 'grid');
  ptEls = new Array(81);
  for (let vr = 0; vr < 9; vr++) for (let vf = 0; vf < 9; vf++) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'pt';
    el.style.left = `${vf * (100 / 9)}%`; el.style.top = `${((100 + vr * 100) / Hh) * 100}%`;
    el.addEventListener('click', () => onSquare(pointAt(vf, vr)));
    boardEl.appendChild(el);
    ptEls[vr * 9 + vf] = el;
  }
  slotEls = [[], []];
  for (const row of [0, 1]) SLOTS.forEach((t, i) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'slot' + (row ? ' mine' : '');
    el.style.left = `${i * (100 / 7)}%`; el.style.top = row ? `${(1000 / Hh) * 100}%` : '0%';
    if (row) el.addEventListener('click', () => onSlot(t));
    else el.tabIndex = -1;
    boardEl.appendChild(el);
    slotEls[row].push(el);
  });
  api.tray.addEventListener('click', (e) => {
    const b = e.target.closest('[data-promo], [data-act]');
    if (!b || !playing || state.side !== human) return;
    if (b.dataset.act === 'declare') { commit(DECLARE); return; }
    if (!promo) return;
    if (b.dataset.promo === 'x') { promo = null; tray(); render(); api.status(myStatus()); return; }
    const m = promo.find((x) => isPromo(x) === (b.dataset.promo === '1'));
    if (m !== undefined) commit(m);
  });
}
const elAt = (s) => { const [x, y] = vis(s); return ptEls[y * 9 + x]; };
const centre = (s) => { const [x, y] = vis(s); return [x * 100 + 50, 100 + y * 100 + 50]; };
function render(anim) {
  const st = state, tg = targets();
  const last = st.last, lf = last && !isDrop(last) ? mFrom(last) : -1, lt = last ? mTo(last) : -1;
  const checkSq = st.check ? st.king : -1;
  for (let s = 0; s < 81; s++) {
    const el = elAt(s), p = st.b[s];
    el.classList.toggle('last', s === lt);
    el.classList.toggle('from', s === lf);
    el.classList.toggle('sel', !!sel && sel.from === s);
    el.classList.toggle('check', s === checkSq);
    let h = p ? pieceSvg(p, (p >> 4) === human) : '';
    if (tg.has(s)) h += tg.get(s) ? '<span class="ring"></span>' : '<span class="dot"></span>';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    const name = p ? ` ${sideName(p >> 4)} ${glyphOf(p)}` : ' 빈 점';
    el.setAttribute('aria-label', ptName(s) + name + (tg.has(s) ? (tg.get(s) ? ', 잡으며 이동 가능' : ', 여기로 갈 수 있음') : '') + (s === checkSq ? ', 장군' : ''));
  }
  for (const row of [0, 1]) {
    const c = row ? human : human ^ 1;
    SLOTS.forEach((t, i) => {
      const el = slotEls[row][i], n = st.hands[c][t];
      const h = n ? pieceSvg(c * 16 + t, c === human) + (n > 1 ? `<span class="cnt">${n}</span>` : '') : '';
      if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
      el.classList.toggle('sel', row === 1 && !!sel && sel.drop === t);
      el.classList.toggle('can', row === 1 && playing && st.side === human && !st.result && !!n && movesDrop(t).length > 0);
      el.setAttribute('aria-label', `${row ? '내' : `${api.name}의`} 손 ${glyphOf(c * 16 + t)} ${n}개`);
    });
  }
  if (anim && anim !== DECLARE && !reduced()) {
    const to = mTo(anim), piece = elAt(to).querySelector('.sp');
    if (isDrop(anim)) { if (piece) { piece.classList.add('drop'); setTimeout(() => piece.classList.remove('drop'), 400); } }
    else {
      hopPiece(piece, elAt(mFrom(anim)), elAt(to));
      trail(boardEl, 9, [centre(mFrom(anim))[0], centre(mFrom(anim))[1] * 9 / 11], [centre(to)[0], centre(to)[1] * 9 / 11]);
    }
  }
}
function scribble(s, p) {
  if (reduced()) return;
  const [x, y] = vis(s), el = document.createElement('div');
  el.className = 'ghost';
  el.style.left = `${x * (100 / 9)}%`; el.style.top = `${((100 + y * 100) / 1100) * 100}%`;
  el.innerHTML = pieceSvg(p, (p >> 4) === human) + '<svg class="x" viewBox="0 0 100 100" aria-hidden="true"><path d="M18 30 L82 22 L16 44 L84 38 L18 58 L82 54 L20 74 L80 70"/></svg>';
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
const clearDoodles = () => { for (const e of boardEl.querySelectorAll('.trail, .ghost')) e.remove(); };
function stop() { g++; if (engine) engine.restart(); }

export default {
  id: 'shogi',
  name: '쇼기',
  sides: [
    { id: SENTE, first: true, html: '<span class="chip b"></span>선수 · 먼저' },
    { id: GOTE, first: false, html: '<span class="chip w"></span>후수' },
  ],
  options: [
    { key: 'script', label: '말 글씨', choices: [{ id: 'hangul', html: '한글' }, { id: 'hanja', html: '한자' }], default: 'hangul' },
    { key: 'opp', label: '상대 말', choices: [{ id: 'upright', html: '글씨 바로' }, { id: 'flipped', html: '거꾸로' }], default: 'upright' },
  ],
  optionChanged(key, val) {
    if (key === 'script') script = val === 'hanja' ? 'hanja' : 'hangul';
    if (key === 'opp') oppText = val === 'flipped' ? 'flipped' : 'upright';
    render();
  },
  lines: LINES,
  chat: ['chatShogi'],
  longGame: 90,
  rules: {
    title: '쇼기, 규칙도 몰라?',
    html: `
    <li><b>상대 왕을 피할 수 없게 몰면 이긴다(외통).</b> 선수가 먼저 둔다.
      <span class="aside">왕이 공격받는 걸 장군이라고 해. 장군을 받으면 꼭 풀어야 해.</span></li>
    <li><b>말마다 가는 길이 달라.</b> 왕: 사방 한 칸. 비: 가로·세로로 멀리. 각: 대각선으로 멀리. 금: 앞·옆·뒤로 한 칸(뒤 대각선은 못 감).
      은: 앞 세 방향과 뒤 대각선 두 칸. 계: 앞으로 두 칸 가서 옆으로 한 칸(다른 말을 넘어, 앞으로만). 향: 앞으로 멀리. 보: 앞으로 한 칸.
      <span class="aside">말은 뒤로 돌아가지 못하는 게 많아. 보·향·계는 앞으로만 가.</span></li>
    <li><b>승급:</b> 상대 진영(앞쪽 세 줄)에 들어가거나, 거기서 나오거나, 거기서 움직이면 보·향·계·은·각·비를 뒤집어 승급시킬 수 있다.
      보·향·계·은은 금처럼 움직이고, 각은 마(각 + 사방 한 칸), 비는 룡(비 + 대각선 한 칸)이 돼. 승급한 말은 붉은 글씨야.
      갈 곳이 없어지는 승급 전 말은 꼭 승급해야 해. 잡히면 승급이 풀려.</li>
    <li><b>잡은 말은 내 말:</b> 잡은 말은 내 손에 들어와(판 아래 줄). 내 차례에 한 번 두는 대신 아무 빈 점에나 놓을 수 있어.
      말을 누르고 놓을 점을 누르면 돼. 윗줄은 페노피가 가진 말이야.</li>
    <li><b>놓을 때 안 되는 것:</b> 같은 줄에 내 보가 이미 있으면 보를 못 놓아(이보, 승급한 보는 상관없어). 갈 곳 없는 자리(보·향은 맨 끝줄, 계는 끝 두 줄)에는 못 놓아.
      보를 놓아서 바로 외통을 만드는 것도 반칙이야(다른 말로는 괜찮아).</li>
    <li><b>무승부:</b> 같은 국면이 네 번 나오면 비긴다. 다만 매번 장군으로 반복한 쪽은 반칙으로 진다.
      <span class="aside">너무 오래 끌면(600수) 비긴 걸로 쳐.</span></li>
    <li><b>입옥 선언:</b> 내 왕이 상대 진영에 들어가 있고 장군을 받지 않을 때, 상대 진영 안에 내 말(왕 빼고)이 열 개 이상이고 점수가 선수 28점·후수 27점 이상이면 선언해서 이긴다.
      비·각(승급 포함)은 5점, 나머지는 1점이고 손에 든 말도 세. 조건이 되면 판 아래에 단추가 나와.</li>`,
  },
  debug: () => ({
    legal: state.legal.filter((m) => m !== DECLARE), declare: state.legal.includes(DECLARE), stm: state.side, human, over: !!state.result, playing,
    plies: moves.length, promo: !!promo,
    cells: (() => { const c = {}; for (let s = 0; s < 81; s++) { const [x, y] = vis(s); c[s] = y * 9 + x; } return c; })(),
    slots: (() => { const c = {}; SLOTS.forEach((t, i) => { c[t] = 81 + 7 + i; }); return c; })(),
  }),
  mount(a) {
    api = a; boardEl = a.board;
    script = a.options && a.options.script === 'hanja' ? 'hanja' : 'hangul';
    oppText = a.options && a.options.opp === 'flipped' ? 'flipped' : 'upright';
    build();
    state = replay();
    render();
  },
  start(side, opts) {
    stop();
    human = side; moves = []; sel = null; promo = null; playing = true;
    script = opts && opts.script === 'hanja' ? 'hanja' : 'hangul';
    oppText = opts && opts.opp === 'flipped' ? 'flipped' : 'upright';
    clearDoodles();
    boardEl.setAttribute('aria-label', `쇼기 판, 나는 ${sideName(side)}`);
    state = replay();
    render();
    next();
  },
  reset() {
    stop();
    const had = moves.length > 0;
    playing = false; moves = []; sel = null; promo = null; human = SENTE;
    tray();
    state = replay();
    if (had && !reduced()) wipe(boardEl, 9, () => { clearDoodles(); render(); });
    else { clearDoodles(); render(); }
  },
};
