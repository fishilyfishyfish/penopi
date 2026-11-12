// Tests for draughts/engine.js (run in CI): node tools/test-draughts.mjs
//  1. perft from the start against the published values, and every position of random games against a
//     separate naive implementation (2D grid, copies the board at every step);
//  2. hand-made positions for each tricky rule: majority capture, flying king capture, no promotion when a
//     capture only passes the far row, backward capture by men, the endgame draw count (blocking by captured
//     pieces is covered by the random games: the naive implementation keeps them on the board too);
//  3. strength: the engine beats a random player every game.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DraughtsEngine } = require(path.join(root, 'draughts', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 99;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
const E = DraughtsEngine({ ttBits: 14 });
const key = (m) => `${m.from}-${m.to}:${m.caps.join(',')}${m.promote ? 'K' : ''}`;

// ---------- the naive implementation ----------
const naive = {
  side: (p) => (p === 0 ? 0 : p <= 2 ? 1 : 2),
  moves(b, side) { // b: 10x10 [r][c]
    const caps = [];
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      const p = b[r][c];
      if (naive.side(p) !== side) continue;
      const g = b.map((row) => row.slice());
      g[r][c] = 0;
      naive.jumps(g, side, p === 2 || p === 4, r, c, [], new Set(), (tr, tc, taken) => caps.push({ from: r * 10 + c, to: tr * 10 + tc, caps: taken.slice().sort((x, y) => x - y), p }));
    }
    const out = [];
    if (caps.length) {
      const most = Math.max(...caps.map((m) => m.caps.length));
      for (const m of caps) if (m.caps.length === most) out.push(m);
    } else {
      for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
        const p = b[r][c];
        if (naive.side(p) !== side) continue;
        const king = p === 2 || p === 4;
        for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          if (!king && dr !== (side === 1 ? -1 : 1)) continue;
          for (let k = 1; k < 10; k++) {
            const nr = r + dr * k, nc = c + dc * k;
            if (nr < 0 || nr > 9 || nc < 0 || nc > 9 || b[nr][nc]) break;
            out.push({ from: r * 10 + c, to: nr * 10 + nc, caps: [], p });
            if (!king) break;
          }
        }
      }
    }
    const seen = new Set(), res = [];
    for (const m of out) {
      m.promote = (m.p === 1 && Math.floor(m.to / 10) === 0) || (m.p === 3 && Math.floor(m.to / 10) === 9);
      const k = key(m);
      if (!seen.has(k)) { seen.add(k); res.push(m); }
    }
    return res;
  },
  // every capture sequence from (r, c); taken: captured squares (still on the board, they block)
  jumps(g, side, king, r, c, taken, takenSet, emit) {
    let any = false;
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      let k = 1;
      if (king) while (r + dr * k >= 0 && r + dr * k < 10 && c + dc * k >= 0 && c + dc * k < 10 && g[r + dr * k][c + dc * k] === 0) k++;
      const er = r + dr * k, ec = c + dc * k;
      if (er < 0 || er > 9 || ec < 0 || ec > 9) continue;
      if (naive.side(g[er][ec]) !== 3 - side || takenSet.has(er * 10 + ec)) continue;
      for (let j = 1; j < 10; j++) {
        const lr = er + dr * j, lc = ec + dc * j;
        if (lr < 0 || lr > 9 || lc < 0 || lc > 9 || g[lr][lc] !== 0) break;
        any = true;
        takenSet.add(er * 10 + ec); taken.push(er * 10 + ec);
        naive.jumps(g, side, king, lr, lc, taken, takenSet, emit);
        takenSet.delete(er * 10 + ec); taken.pop();
        if (!king) break;
      }
    }
    if (!any && taken.length) emit(r, c, taken);
  },
  grid(arr) { const b = []; for (let r = 0; r < 10; r++) b.push(Array.from(arr.slice(r * 10, r * 10 + 10))); return b; },
};
const sorted = (ms) => ms.map(key).sort();

// ---------- 1. perft and random games ----------
{
  const want = [9, 81, 658, 4265, 27117, 167140];
  for (let d = 1; d <= want.length; d++) {
    E.setStart();
    const n = E.perft(d);
    check(n === want[d - 1], `perft(${d}) = ${n}, published ${want[d - 1]}`);
  }
  console.log(`perft 1..${want.length}: ${want.join(', ')}`);
  let positions = 0, captures = 0, kings = 0;
  for (let gm = 0; gm < 40; gm++) {
    E.setStart();
    for (let k = 0; k < 300; k++) {
      const a = sorted(E.legalMoves()), b = sorted(naive.moves(naive.grid(E.board), E.stm));
      positions++;
      if (JSON.stringify(a) !== JSON.stringify(b)) { check(false, `game ${gm} ply ${k}: engine ${a.length} moves, naive ${b.length}\n${a.join(' ')}\n${b.join(' ')}`); break; }
      if (!a.length) break;
      const list = E.legalMoves(), m = list[rnd(list.length)];
      if (m.caps.length) captures++;
      if (m.promote) kings++;
      E.play(m);
      if (E.status()) break;
    }
  }
  console.log(`random games: ${positions} positions match the naive implementation (${captures} captures, ${kings} promotions on the way)`);
}

// ---------- 2. the tricky rules, by hand ----------
const S = E.SQ, N = E.NUM;
function position(white, black, side = 1) { // {square number: 'm'|'k'}
  const b = new Int8Array(100);
  for (const [n, t] of Object.entries(white)) b[S[n]] = t === 'k' ? 2 : 1;
  for (const [n, t] of Object.entries(black)) b[S[n]] = t === 'k' ? 4 : 3;
  E.setPosition(b, side);
  return E.legalMoves().map((m) => `${N[m.from]}${m.caps.length ? 'x' : '-'}${N[m.to]}${m.promote ? '=K' : ''}[${m.caps.map((c) => N[c]).join(',')}]`).sort();
}
{
  // majority: the man on 37 can take two (32, then 22), the man on 40 only one (34): only 37's capture is legal
  const ms = position({ 37: 'm', 40: 'm' }, { 32: 'm', 22: 'm', 34: 'm', 1: 'm' });
  check(JSON.stringify(ms) === JSON.stringify(['37x17[22,32]']), `majority capture: ${ms.join(' ')}`);
  // flying king: the king on 46 takes the man on 23 from afar and may land on any empty square beyond it
  const fk = position({ 46: 'k' }, { 23: 'm', 1: 'm' });
  check(JSON.stringify(fk) === JSON.stringify(['46x10[23]', '46x14[23]', '46x19[23]', '46x5[23]']), `flying king capture: ${fk.join(' ')}`);
  // passing the far row in the middle of a capture doesn't promote (13x2 over 8, then on over 7 to 11) ...
  const pass = position({ 13: 'm' }, { 8: 'm', 7: 'm', 50: 'm' });
  check(JSON.stringify(pass) === JSON.stringify(['13x11[7,8]']), `no promotion passing the far row: ${pass.join(' ')}`);
  // ... ending there does
  const end = position({ 13: 'm' }, { 8: 'm', 50: 'm' });
  check(JSON.stringify(end) === JSON.stringify(['13x2=K[8]']), `promotion ending on the far row: ${end.join(' ')}`);
  // men capture backward too
  const back = position({ 23: 'm' }, { 28: 'm', 1: 'm' });
  check(JSON.stringify(back) === JSON.stringify(['23x32[28]']), `men capture backward: ${back.join(' ')}`);
  console.log('rules by hand: majority, flying king, promotion only at the end, backward capture');
}
{
  // draws: a lone black king against two white kings is drawn after 5 moves each
  position({ 46: 'k', 50: 'k' }, { 5: 'k' });
  let st = '';
  for (let k = 0; k < 12 && !st; k++) { const ms = E.legalMoves(); E.play(ms.find((m) => !m.caps.length) || ms[0]); st = E.status(); }
  check(st === 'draw:endgame' || st === 'draw:repetition', `2 kings vs 1: ${st || 'not drawn after 12 plies'}`);
  console.log(`draw: ${st}`);
}

// ---------- 3. strength ----------
{
  let wins = 0, games = 0;
  const t0 = Date.now();
  for (let g = 0; g < 4; g++) {
    const A = DraughtsEngine({ ttBits: 16 }), R = DraughtsEngine({ ttBits: 8 });
    const engWhite = g % 2 === 0;
    R.setStart(); A.setStart();
    let result = '';
    for (let k = 0; k < 400 && !result; k++) {
      const mine = (R.stm === 1) === engWhite;
      let m;
      if (mine) { m = A.think({ nodes: 20000 }).move; }
      else { const l = R.legalMoves(); m = l[rnd(l.length)]; }
      R.play(m); A.play(m);
      const st = R.status();
      if (st === 'win') result = mine ? 'engine' : 'random';
      else if (st) result = 'draw';
    }
    games++;
    if (result === 'engine') wins++;
  }
  check(wins === games, `engine won ${wins} of ${games} against random`);
  console.log(`strength: ${wins}/${games} against random (${Date.now() - t0} ms)`);
  const T = DraughtsEngine({ ttBits: 20 });
  T.setStart();
  const info = T.think({ time: 1000 });
  console.log(`start position, 1 s: depth ${info.depth}, ${info.nodes} nodes, ${T.notation(info.move)}, score ${info.score}`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');
