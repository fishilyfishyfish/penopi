// Backgammon, money game with the doubling cube. The engine is backgammon-palamedes's Rust engine (WASM,
// neural net included), unchanged. Penopi plays as that site's strongest bot, 팔라메데스 (3-ply search);
// if a 3-ply move takes over 4 s (a slow phone) the worker is restarted and a 2-ply move is used instead.
// Who starts is decided by the first roll, so I only pick a colour. I am always engine side 0 (bottom,
// home on the right); the colour is only how my checkers look, as in backgammon-palamedes.
// Input is that site's "바로 이동": tap a checker and it moves by the left die; tap the dice to swap them.
import { LINES } from './lines.js';
import { workerClient, TimeoutError } from '../shared/engine.js';
import { reduced } from '../shared/character.js';

const HUMAN = 0, AI = 1, BAR = 25;
const BAD = 0.08; // a "bad" move or cube action (GNU Backgammon's threshold, as in backgammon-palamedes)
const AI_LIMIT = 4000;
const idx = (side, p) => side * 26 + p;
const other = (s) => 1 - s;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 120) : ms));
const seed32 = () => crypto.getRandomValues(new Uint32Array(1))[0];
function rollDie() { // unbiased: reject the top sliver of the range
  const buf = new Uint32Array(1), limit = Math.floor(0x100000000 / 6) * 6;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return (buf[0] % 6) + 1;
}

let api, svg, client = null, BOT = 9, g = 0;
const S = {
  phase: 'idle', // idle | opening | roll | move | ai | cube (Penopi doubled, my answer) | over
  board: null, color: 'w', dice: null, opening: null, turnStart: null, groups: [], ts: null, swap: false,
  lastMove: null, cube: { value: 1, owner: null }, turns: 0, verdict: undefined, said: {},
};

// ---------- engine ----------
function engine() {
  if (!client) client = workerClient(new URL('./worker.js', import.meta.url));
  return client;
}
const call = (fn, ...args) => engine().call({ fn, args });
const ctx = () => JSON.stringify({ cube: { value: S.cube.value, owner: S.cube.owner }, match: null });
const canDouble = (side) => S.cube.owner !== other(side) && S.cube.value < 64;
async function aiMove(dice) {
  try {
    return await engine().call({ fn: 'ai_move_json', args: [S.board, AI, dice[0], dice[1], BOT, seed32(), ctx()] }, { timeout: AI_LIMIT });
  } catch (err) {
    if (!(err instanceof TimeoutError)) throw err;
    const ranked = await call('rank_moves_json', S.board, AI, dice[0], dice[1], 1, 2, ctx());
    return ranked[0];
  }
}

// ---------- board helpers ----------
const flatSteps = () => S.groups.flat().map(({ from, to, die }) => ({ from, to, die }));
function diceList(dice, used = []) {
  const [a, c] = dice, list = a === c ? [a, a, a, a] : [a, c], u = list.map(() => false);
  for (const st of used) { const i = list.findIndex((d, k) => d === st.die && !u[k]); if (i >= 0) u[i] = true; }
  return list.map((d, i) => ({ d, used: u[i] }));
}
const diceOrder = () => (S.swap ? [S.dice[1], S.dice[0]] : S.dice);
const remaining = () => diceList(diceOrder(), flatSteps()).filter((f) => !f.used).map((f) => f.d);
function applyStep(board, side, s) {
  const b = board.slice();
  b[idx(side, s.from)] -= 1; b[idx(side, s.to)] += 1;
  if (s.hit) { b[idx(other(side), 25 - s.to)] -= 1; b[idx(other(side), BAR)] += 1; }
  return b;
}
function isRace(b) { // nobody can hit anybody any more
  let mine = 0, theirs = 26;
  for (let p = 1; p <= 25; p++) if (b[idx(HUMAN, p)]) mine = p;
  for (let q = 1; q <= 25; q++) if (b[idx(AI, q)]) theirs = Math.min(theirs, 25 - q);
  return mine < theirs;
}
const allHome = (b, side) => { for (let p = 7; p <= 25; p++) if (b[idx(side, p)]) return false; return true; };

// ---------- flow ----------
function opening() {
  S.phase = 'opening';
  api.status('주사위 하나씩 굴려서 큰 쪽이 먼저');
  tray();
  draw();
}
async function onRoll() {
  const my = g;
  if (S.phase === 'opening') {
    const m = rollDie(), o = rollDie();
    S.opening = [m, o];
    draw();
    if (m === o) { api.say('openTie', { m }); api.status(`둘 다 ${m}. 다시 굴려`); return; }
    api.say(m > o ? 'openHuman' : 'openEngine', { m, o });
    S.phase = 'wait'; tray();
    await sleep(900);
    if (my !== g) return;
    S.opening = null;
    const dice = [Math.max(m, o), Math.min(m, o)];
    if (m > o) { api.yourTurn({ text: myStatus() }); await beginHumanTurn(dice); }
    else await aiRollAndMove(dice);
    return;
  }
  if (S.phase !== 'roll') return;
  S.phase = 'wait'; tray();
  await beginHumanTurn([rollDie(), rollDie()]);
}
async function beginHumanTurn(dice) {
  Object.assign(S, { dice, turnStart: S.board.slice(), groups: [], swap: false, ts: null, phase: 'move' });
  await refresh();
}
async function refresh() {
  const my = g;
  let ts;
  try { ts = await call('turn_state_json', S.turnStart, HUMAN, S.dice[0], S.dice[1], JSON.stringify(flatSteps())); }
  catch (err) { if (my === g) console.error('turn state failed', err.message, JSON.stringify(S.turnStart), JSON.stringify(flatSteps()), S.dice); return; }
  if (my !== g) return;
  S.ts = ts; S.board = ts.board;
  api.status(myStatus());
  tray(); draw();
}
function myStatus() {
  const chip = api.chip(S.color);
  if (S.phase === 'roll' || !S.dice) return `${chip}내 차례 · 굴려${canDouble(HUMAN) ? ' (더블도 돼)' : ''}`;
  const d = `${S.dice[0]}-${S.dice[1]}`;
  if (!S.ts) return `${chip}${d}`;
  if (S.ts.need === 0) return `${chip}${d} · 둘 수 있는 수가 없어`;
  if (S.ts.done) return `${chip}${S.ts.notation}`;
  return `${chip}${d} · 말을 눌러 (${S.ts.played}/${S.ts.need})`;
}
let refreshing = false;
async function onPoint(p) {
  if (refreshing || S.phase !== 'move' || !S.ts || S.ts.done) return;
  const step = remaining().map((d) => S.ts.next.find((s) => s.from === p && s.die === d)).find(Boolean);
  if (!step) return;
  api.peek(pointX(p) / 932, S.groups.length === 0);
  S.groups.push([step]);
  refreshing = true;
  try { await refresh(); } finally { refreshing = false; }
}
function onSwap() {
  if (S.phase !== 'move' || remaining().length < 2 || S.dice[0] === S.dice[1]) return;
  S.swap = !S.swap;
  draw();
}
async function onUndoStep() {
  if (refreshing || S.phase !== 'move' || !S.groups.length) return;
  S.groups.pop();
  refreshing = true;
  try { await refresh(); } finally { refreshing = false; }
}
async function onDone() {
  if (refreshing || S.phase !== 'move' || !S.ts || !S.ts.done) return;
  const my = g, ts = S.ts, dice = S.dice;
  S.phase = 'ai'; tray();
  // judge my move with the engine (2-ply), for what Penopi says after its reply
  S.verdict = null;
  if (ts.need > 0) {
    try {
      const a = await call('analyze_move_json', S.turnStart, HUMAN, dice[0], dice[1], ts.board, 1, 2, ctx());
      if (a.loss >= BAD) S.verdict = 'blunder';
      else if (a.rank === 1 && a.top && a.top.length > 1 && a.top[0].equity - a.top[1].equity >= BAD) S.verdict = 'good';
    } catch { /* no verdict */ }
  }
  if (my !== g) return;
  S.lastMove = { side: HUMAN, steps: ts.steps };
  S.turns++;
  const facts = [];
  if (ts.need === 0 && S.turnStart[idx(HUMAN, BAR)] > 0) facts.push(['humanDance']);
  else if (ts.steps.some((s) => s.hit)) facts.push(['humanHit', null, 0.8]);
  if (!S.said.race && isRace(S.board)) { S.said.race = true; facts.push(['race']); }
  if (dice[0] === dice[1]) facts.push(['humanDoubles', null, 0.35]);
  if (await checkOver()) return;
  api.humanMoved({ facts, plies: S.turns });
  await aiTurn();
}
// Penopi's turn: maybe double first, then roll and move
async function aiTurn() {
  const my = g;
  Object.assign(S, { phase: 'ai', ts: null });
  api.engineTurn({ color: S.color === 'w' ? 'b' : 'w' });
  tray(); draw();
  if (canDouble(AI)) {
    let d = null;
    try { d = await call('ai_cube_json', S.board, AI, BOT, seed32(), ctx()); } catch { /* no double */ }
    if (my !== g) return;
    if (d && d.double) {
      S.phase = 'cube';
      api.thinking(false);
      api.say('cubeOffer', { v: S.cube.value * 2 });
      api.status(`${api.name}가 더블했어 · 큐브 ${S.cube.value * 2}`);
      tray(); draw();
      return;
    }
  }
  await aiRollAndMove();
}
async function aiRollAndMove(dice = null) {
  const my = g;
  dice = dice || [rollDie(), rollDie()];
  Object.assign(S, { phase: 'ai', dice, ts: null });
  api.engineTurn({ color: S.color === 'w' ? 'b' : 'w', text: `${api.chip(S.color === 'w' ? 'b' : 'w')}${api.name} ${dice[0]}-${dice[1]}` });
  tray(); draw(true);
  const t0 = Date.now();
  let m;
  try { m = await aiMove(dice); } catch (err) { if (my === g) console.error('ai move failed', err.message, JSON.stringify(S.board), JSON.stringify(S.lastMove)); return; } // stopped (new game)
  if (my !== g) return;
  await sleep(Math.max(0, 650 - (Date.now() - t0)));
  const before = S.board.slice();
  for (const s of m.steps) {
    if (my !== g) return;
    S.board = applyStep(S.board, AI, s);
    draw();
    await sleep(330);
  }
  if (my !== g) return;
  S.board = m.board;
  S.lastMove = { side: AI, steps: m.steps };
  S.turns++;
  draw();
  if (await checkOver()) return;
  const facts = [];
  if (!m.steps.length && before[idx(AI, BAR)] > 0) facts.push(['engineDance']);
  else if (m.steps.some((s) => s.hit)) facts.push(['engineHit', null, 0.8]);
  if (!S.said.race && isRace(S.board)) { S.said.race = true; facts.push(['race']); }
  else if (!S.said.bear && allHome(S.board, AI)) { S.said.bear = true; facts.push(['bearoff', null, 0.6]); }
  if (dice[0] === dice[1]) facts.push(['engineDoubles', null, 0.3]);
  api.engineMoved({ p: m.probs ? m.probs.win : 0.5, verdict: S.verdict, facts });
  S.verdict = undefined;
  S.phase = 'roll'; S.dice = null;
  api.yourTurn({ text: myStatus() });
  tray(); draw();
}
// I double
async function onDouble() {
  if (S.phase !== 'roll' || !canDouble(HUMAN)) return;
  const my = g;
  S.phase = 'ai'; tray();
  api.engineTurn({ text: `큐브 ${S.cube.value * 2} · ${api.name}가 생각 중` });
  api.say('thinkCube');
  let take = true;
  try { ({ take } = await call('ai_cube_json', S.board, HUMAN, BOT, seed32(), ctx())); } catch { if (my !== g) return; }
  await sleep(700);
  if (my !== g) return;
  api.thinking(false);
  if (!take) { await endGame(HUMAN, S.cube.value, 'pass'); return; }
  S.cube = { value: S.cube.value * 2, owner: AI };
  api.say('engineTakes', { v: S.cube.value });
  S.phase = 'roll';
  api.status(myStatus());
  tray(); draw();
}
// Penopi doubled: take or pass
async function onAnswer(take) {
  if (S.phase !== 'cube') return;
  S.phase = 'ai'; tray(); // one answer only, however fast the taps
  if (!take) { await endGame(AI, S.cube.value, 'pass'); return; }
  S.cube = { value: S.cube.value * 2, owner: HUMAN };
  api.say('humanTook', { v: S.cube.value });
  await sleep(900);
  await aiRollAndMove();
}
async function checkOver() {
  let r = null;
  try { r = await call('result_json', S.board); } catch { return false; }
  if (!r) return false;
  await endGame(r.winner, r.points * S.cube.value, r.points === 3 ? 'backgammon' : r.points === 2 ? 'gammon' : 'single');
  return true;
}
async function endGame(winner, points, how) {
  S.phase = 'over';
  tray(); draw();
  const mine = winner === HUMAN, kind = { pass: '포기', backgammon: '백개먼', gammon: '개먼', single: '' }[how];
  const key = mine
    ? (how === 'pass' ? 'humanWinPass' : how !== 'single' ? 'humanWinGammon' : undefined)
    : (how === 'pass' ? 'engineWinPass' : how === 'backgammon' ? 'engineWinBackgammon' : how === 'gammon' ? 'engineWinGammon' : undefined);
  api.over({
    winner: mine ? 'human' : 'penopi',
    key,
    vars: { pts: points, n: Math.ceil(S.turns / 2), v: S.cube.value },
    text: `${api.chip(mine ? S.color : S.color === 'w' ? 'b' : 'w')}${mine ? '내가 이겼다' : `${api.name}가 이겼다`} · ${kind ? kind + ', ' : ''}${points}점`,
  });
}

// ---------- the buttons under the board ----------
function tray() {
  const t = api.tray;
  let html = '';
  if (S.phase === 'opening') html = '<button type="button" class="btn" data-act="roll">굴리기</button>';
  else if (S.phase === 'roll') html = '<button type="button" class="btn" data-act="roll">굴리기</button>'
    + `<button type="button" class="btn" data-act="double"${canDouble(HUMAN) ? '' : ' disabled'}>더블 (${S.cube.value * 2})</button>`;
  else if (S.phase === 'move') html = `<button type="button" class="btn small" data-act="undo"${S.groups.length ? '' : ' disabled'}>되돌리기</button>`
    + `<button type="button" class="btn" data-act="done"${S.ts && S.ts.done ? '' : ' disabled'}>${S.ts && S.ts.need === 0 ? '넘기기' : '턴 끝내기'}</button>`;
  else if (S.phase === 'cube') html = `<span class="q">큐브 ${S.cube.value * 2}, 받을래?</span>`
    + '<button type="button" class="btn" data-act="take">받기</button><button type="button" class="btn" data-act="pass">포기</button>';
  if (t.dataset.h !== html) { t.innerHTML = html; t.dataset.h = html; }
  t.hidden = !html;
  t.dataset.waiting = html ? '1' : '';
}

// ---------- drawing (geometry from backgammon-palamedes web/board-view.js) ----------
const G = { PW: 62, D: 56, R: 27, leftX: 22, barX: 394, barW: 56, rightX: 450, top: 42, bottom: 666, mid: 354, trayX: 846, trayW: 76 };
const PT_LEN = 5 * G.D;
const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
function pointX(p) {
  if (p === BAR) return G.barX + G.barW / 2;
  if (p === 0) return G.trayX + G.trayW / 2;
  if (p <= 6) return G.rightX + (6 - p + 0.5) * G.PW;
  if (p <= 12) return G.leftX + (12 - p + 0.5) * G.PW;
  if (p <= 18) return G.leftX + (p - 13 + 0.5) * G.PW;
  return G.rightX + (p - 19 + 0.5) * G.PW;
}
const isTop = (p) => p >= 13;
const slotY = (top, i) => (top ? G.top + G.R + 1 + i * G.D : G.bottom - G.R - 1 - i * G.D);
const barSlotY = (side, i) => (side === HUMAN ? G.mid + 34 + i * G.D : G.mid - 34 - i * G.D);
// steady wobble: the same item always gets the same shake, so redrawing doesn't jitter
const jit = (seed, k) => { const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return (x - Math.floor(x) - 0.5) * k; };
function line(x1, y1, x2, y2, seed, k = 3) {
  return `M${(x1 + jit(seed, k)).toFixed(1)} ${(y1 + jit(seed + 1, k)).toFixed(1)} Q${((x1 + x2) / 2 + jit(seed + 2, k * 2)).toFixed(1)} ${((y1 + y2) / 2 + jit(seed + 3, k * 2)).toFixed(1)} ${(x2 + jit(seed + 4, k)).toFixed(1)} ${(y2 + jit(seed + 5, k)).toFixed(1)}`;
}
const box = (x, y, w, h, seed, k = 4) => line(x - 5, y, x + w + 5, y, seed, k) + line(x + w, y - 5, x + w, y + h + 5, seed + 10, k)
  + line(x + w + 5, y + h, x - 5, y + h, seed + 20, k) + line(x, y + h + 5, x, y - 5, seed + 30, k);
function staticLayer() {
  const parts = [`<defs><pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
    <rect width="9" height="9" fill="#fdfdfb"/><line x1="0" y1="0" x2="0" y2="9" stroke="rgba(27,27,27,.28)" stroke-width="3"/></pattern></defs>`];
  parts.push(`<rect class="paper" x="10" y="30" width="824" height="648"/><rect class="paper" x="${G.trayX - 6}" y="30" width="${G.trayW + 12}" height="648"/>`);
  for (let p = 1; p <= 24; p++) {
    const x = pointX(p), top = isTop(p), half = G.PW / 2 - 2, baseY = top ? G.top : G.bottom;
    const tipY = top ? G.top + PT_LEN - 10 : G.bottom - PT_LEN + 10;
    parts.push(`<path class="${p % 2 ? 'pt-h' : 'pt-o'}" d="M${(x - half + jit(p, 3)).toFixed(1)} ${baseY} L${(x + jit(p + 50, 4)).toFixed(1)} ${(tipY + jit(p + 9, 6)).toFixed(1)} L${(x + half + jit(p + 7, 3)).toFixed(1)} ${baseY}"/>`);
    parts.push(`<text class="lbl" x="${x}" y="${top ? 18 : 692}">${p}</text>`);
  }
  let pen = box(10, 30, 824, 648, 1) + box(G.trayX - 6, 30, G.trayW + 12, 648, 100)
    + line(G.barX, 30, G.barX, 678, 200) + line(G.barX + G.barW, 30, G.barX + G.barW, 678, 210)
    + line(G.trayX - 6, G.mid, G.trayX + G.trayW + 6, G.mid, 220, 2);
  parts.push(`<path class="pen" stroke-width="2.8" d="${pen}"/>`);
  return parts.join('');
}
function checker(x, y, colour, seed, label) {
  const rx = G.R + jit(seed, 2), ry = G.R + jit(seed + 3, 2), rot = jit(seed + 5, 40);
  let s = `<ellipse class="ck-${colour}" cx="${x}" cy="${y}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${rot.toFixed(0)} ${x} ${y})"/>`;
  if (label) s += `<text class="ck-n ${colour}" x="${x}" y="${y}">${label}</text>`;
  return s;
}
function die(x, y, v, used, seed, fresh) {
  const h = 23, rot = jit(seed, 10);
  let s = `<g class="${used ? 'used' : ''}${fresh ? ' roll' : ''}" transform="rotate(${rot.toFixed(0)} ${x} ${y})"><rect class="die" x="${x - h}" y="${y - h}" width="${2 * h}" height="${2 * h}" rx="8"/>`;
  for (const [dx, dy] of PIPS[v]) s += `<circle class="pip" cx="${x + dx * 12}" cy="${y + dy * 12}" r="4.6"/>`;
  return s + '</g>';
}
let staticHtml = '';
function draw(freshDice = false) {
  const b = S.board;
  if (!b) return;
  const tone = (side) => (side === HUMAN ? S.color : S.color === 'w' ? 'b' : 'w');
  const parts = [staticHtml];
  // highlighter on the last move's points
  if (S.lastMove && S.phase !== 'move') {
    const marks = new Set();
    for (const s of S.lastMove.steps) for (const q of [s.from, s.to]) {
      const p = q === 0 || q === BAR ? q : S.lastMove.side === HUMAN ? q : 25 - q;
      if (p >= 1 && p <= 24) marks.add(p);
    }
    for (const p of marks) {
      const x = pointX(p), top = isTop(p);
      parts.push(`<rect class="last" x="${x - G.PW / 2 + 4}" y="${top ? G.top - 2 : G.bottom - 12}" width="${G.PW - 8}" height="14" rx="5" transform="rotate(${jit(p, 4).toFixed(1)} ${x} ${top ? G.top : G.bottom})"/>`);
    }
  }
  const movable = S.phase === 'move' && S.ts && !S.ts.done ? new Set(remaining().flatMap((d) => S.ts.next.filter((s) => s.die === d).map((s) => s.from))) : new Set();
  for (let p = 1; p <= 24; p++) {
    const x = pointX(p), top = isTop(p), w = b[idx(HUMAN, p)], k = b[idx(AI, 25 - p)], n = w || k, side = w ? HUMAN : AI;
    for (let i = 0; i < Math.min(n, 5); i++) parts.push(checker(x, slotY(top, i), tone(side), p * 7 + i, i === 4 && n > 5 ? n : ''));
    if (w && movable.has(p)) parts.push(`<circle class="can" cx="${x}" cy="${slotY(top, Math.min(n, 5) - 1)}" r="${G.R + 5}"/>`);
  }
  const bx = pointX(BAR);
  for (const side of [HUMAN, AI]) {
    const n = b[idx(side, BAR)];
    for (let i = 0; i < Math.min(n, 3); i++) parts.push(checker(bx, barSlotY(side, i), tone(side), 300 + side * 10 + i, i === 2 && n > 3 ? n : ''));
  }
  if (b[idx(HUMAN, BAR)] && movable.has(BAR)) parts.push(`<circle class="can" cx="${bx}" cy="${barSlotY(HUMAN, 0)}" r="${G.R + 5}"/>`);
  const tw = G.trayW - 12, tx = G.trayX + 6;
  for (let i = 0; i < b[idx(HUMAN, 0)]; i++) parts.push(`<rect class="off-${tone(HUMAN)}" x="${tx + jit(i, 3)}" y="${G.bottom - 4 - (i + 1) * 17}" width="${tw}" height="14" rx="6"/>`);
  for (let i = 0; i < b[idx(AI, 0)]; i++) parts.push(`<rect class="off-${tone(AI)}" x="${tx + jit(i + 40, 3)}" y="${G.top + 4 + i * 17}" width="${tw}" height="14" rx="6"/>`);
  // dice: mine on the right half, Penopi's on the left; the opening roll one each
  let diceHit = '';
  if (S.opening) {
    parts.push(die(G.rightX + 3 * G.PW, G.mid, S.opening[0], false, 1, true));
    parts.push(die(G.leftX + 3 * G.PW, G.mid, S.opening[1], false, 2, true));
  } else if (S.dice && (S.phase === 'move' || S.phase === 'ai')) {
    const human = S.phase === 'move';
    const list = human ? diceList(diceOrder(), flatSteps()) : diceList(S.dice);
    const cx = human ? G.rightX + 3 * G.PW : G.leftX + 3 * G.PW, gap = 56, x0 = cx - ((list.length - 1) * gap) / 2;
    list.forEach((f, i) => parts.push(die(x0 + i * gap, G.mid, f.d, f.used, i + (human ? 10 : 20), freshDice)));
    if (human && S.dice[0] !== S.dice[1] && remaining().length === 2 && !S.ts?.done)
      diceHit = `<rect class="hit dice-hit" data-dice="1" tabindex="0" role="button" aria-label="주사위 순서 바꾸기" x="${x0 - 30}" y="${G.mid - 30}" width="${(list.length - 1) * gap + 60}" height="60" rx="8"/>`;
  }
  // the doubling cube between the trays: in the middle at 64, or moved to its owner's side
  {
    const size = 44, cx = G.trayX + G.trayW / 2, owner = S.cube.owner;
    const cy = owner === null ? G.mid : owner === HUMAN ? G.mid + 70 : G.mid - 70;
    parts.push(`<g class="cube${owner === HUMAN ? ' mine' : owner === AI ? ' theirs' : ''}" transform="rotate(${jit(S.cube.value, 8).toFixed(0)} ${cx} ${cy})"><rect x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" rx="7"/><text x="${cx}" y="${cy}">${owner === null ? 64 : S.cube.value}</text></g>`);
  }
  // touch areas on top: each point's half of the board, the bar, the tray (bearing off)
  for (let p = 1; p <= 24; p++) {
    const x = pointX(p), top = isTop(p);
    parts.push(`<rect class="hit" data-point="${p}" x="${x - G.PW / 2}" y="${top ? G.top : G.mid}" width="${G.PW}" height="${G.mid - G.top}"${movable.has(p) ? ` tabindex="0" role="button" aria-label="${p}포인트"` : ''}/>`);
  }
  parts.push(`<rect class="hit" data-point="${BAR}" x="${G.barX}" y="${G.top}" width="${G.barW}" height="${G.bottom - G.top}"${movable.has(BAR) ? ' tabindex="0" role="button" aria-label="바"' : ''}/>`);
  parts.push(diceHit);
  svg.innerHTML = parts.join('');
  svg.setAttribute('aria-label', `백개먼 판. 핍 나 ${pips(b, HUMAN)}, ${api.name} ${pips(b, AI)}`);
}
const pips = (b, side) => { let n = 0; for (let p = 1; p <= 25; p++) n += p * b[idx(side, p)]; return n; };

function stop() {
  g++;
  if (client) client.restart();
}
async function startBoard() {
  S.board = await call('start_board');
  const bots = await call('bots_json');
  const i = bots.findIndex((x) => x.id === 'palamedes');
  if (i >= 0) BOT = i;
}

export default {
  id: 'backgammon',
  name: '백개먼',
  sides: [
    { id: 'w', html: '<span class="chip w"></span>흰 말' },
    { id: 'b', html: '<span class="chip b"></span>검은 말' },
  ],
  lines: LINES,
  chat: ['chatBackgammon'],
  longGame: 60,
  rules: {
    html: `
    <li><b>자기 말 15개를 먼저 판 밖으로 다 빼는 쪽이 이긴다.</b> 네 말은 위 오른쪽 끝에서 출발해서, 위쪽을 따라 왼쪽으로, 아래쪽을 따라 오른쪽으로 돌아 아래 오른쪽 네 집(1–6)으로 들어와.
      <span class="aside">내 말은 반대로 돌아서 위 오른쪽 내 집으로 가. 서로 마주 보고 지나가는 거야.</span></li>
    <li><b>주사위 둘을 굴려 나온 두 숫자만큼 말을 옮긴다.</b> 한 말로 둘 다 써도 되고 두 말에 나눠도 돼. 같은 숫자 둘이면 네 번 옮겨.
      <span class="aside">쓸 수 있는 숫자는 다 써야 해. 하나만 쓸 수 있으면 큰 걸 써야 하고.</span></li>
    <li><b>상대 말이 둘 이상 있는 칸에는 못 간다. 하나만 있으면 맞혀서 바(가운데 기둥)로 보낸다.</b>
      <span class="aside">바에 간 말은 상대 집으로 다시 들어와야 하고, 들어오기 전엔 다른 말을 못 움직여.</span></li>
    <li><b>말이 전부 내 집에 들어와야 빼기 시작할 수 있다.</b> 주사위 숫자가 그 말이 있는 칸 번호와 같으면 빼. 더 먼 칸에 말이 없으면 큰 숫자로도 뺄 수 있어.</li>
    <li><b>처음엔 서로 주사위 하나씩 굴려서 큰 쪽이 그 두 숫자로 먼저 둔다.</b> 그래서 색만 고르면 돼.
      <span class="aside">선은 운이야. 그다음은 아니고.</span></li>
    <li><b>더블링 큐브: 굴리기 전에 '더블'을 누르면 판의 값을 두 배로 올리자고 할 수 있다.</b> 상대는 받거나(판 값 두 배, 큐브는 받은 쪽 차지), 포기한다(지금 값만큼 지고 끝). 큐브를 가진 쪽만 다시 더블할 수 있어.
      <span class="aside">내가 더블하면 받을지 말지 잘 생각해. 생각해도 소용없겠지만.</span></li>
    <li><b>상대가 하나도 못 뺐을 때 이기면 개먼(두 배), 그 상대 말이 아직 바나 내 집에 있으면 백개먼(세 배).</b>
      <span class="aside">점수는 거기에 큐브 숫자를 곱한 거야.</span></li>
    <li><b>판에서는</b> 내 말을 누르면 왼쪽 주사위만큼 바로 가. 그 숫자로 못 가면 오른쪽 숫자로. 주사위를 누르면 순서가 바뀌어. 다 옮겼으면 '턴 끝내기'.
      <span class="aside">빨간 점선 동그라미가 지금 움직일 수 있는 말이야.</span></li>`,
  },
  debug: () => ({ phase: S.phase, turns: S.turns, cube: S.cube }),
  mount(a) {
    api = a;
    a.board.innerHTML = '<svg class="bg" viewBox="0 0 932 706" role="img" aria-label="백개먼 판"></svg>';
    svg = a.board.querySelector('svg');
    staticHtml = staticLayer();
    svg.addEventListener('click', (e) => {
      const t = e.target.closest('[data-point], [data-dice]');
      if (!t) return;
      if (t.dataset.dice) onSwap(); else onPoint(Number(t.dataset.point));
    });
    svg.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target.closest('[data-point], [data-dice]');
      if (!t) return;
      e.preventDefault();
      if (t.dataset.dice) onSwap(); else onPoint(Number(t.dataset.point));
    });
    api.tray.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      ({ roll: onRoll, double: onDouble, undo: onUndoStep, done: onDone, take: () => onAnswer(true), pass: () => onAnswer(false) })[b.dataset.act]();
    });
    startBoard().then(() => draw()).catch(() => api.status('엔진을 불러오지 못했어'));
  },
  async start(colour) {
    stop();
    const my = g;
    Object.assign(S, { phase: 'idle', color: colour, dice: null, opening: null, groups: [], ts: null, swap: false, lastMove: null,
      cube: { value: 1, owner: null }, turns: 0, verdict: undefined, said: {} });
    try { await startBoard(); } catch { api.status('엔진을 불러오지 못했어'); return; }
    if (my !== g) return;
    opening();
  },
  reset() {
    stop();
    Object.assign(S, { phase: 'idle', dice: null, opening: null, groups: [], ts: null, lastMove: null, cube: { value: 1, owner: null } });
    startBoard().then(() => draw()).catch(() => {});
  },
};
