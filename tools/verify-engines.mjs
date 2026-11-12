// Checks that the engines copied here answer exactly like the original sites' engines.
//   node tools/verify-engines.mjs <backgammon pkg dir>
// The pkg dir is a WASM build of the original repo (backgammon-palamedes), made the
// way their own scripts do. For each game, positions from a seeded random game are searched by both engines
// with the same fixed settings (fixed depth / iterations / seeds, so time doesn't matter) and the moves and
// evaluations must be identical.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [bgPkg] = process.argv.slice(2);
if (!bgPkg) { console.log('usage: node tools/verify-engines.mjs <backgammon pkg dir>'); process.exit(2); }
let bad = 0;
const same = (what, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) bad++;
  console.log(`${ok ? 'same' : 'DIFFERENT'}  ${what}: ${JSON.stringify(a).slice(0, 90)}${ok ? '' : '  vs  ' + JSON.stringify(b).slice(0, 90)}`);
};
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

// ---------- WASM engines ----------
async function loadPkg(dir, name) {
  const mod = await import(path.resolve(dir, name + '.js'));
  await mod.default({ module_or_path: fs.readFileSync(path.resolve(dir, name + '_bg.wasm')) });
  return mod;
}
{
  const A = await loadPkg(bgPkg, 'palamedes'), B = await loadPkg(path.join(here, 'backgammon', 'pkg'), 'palamedes');
  const bots = JSON.parse(B.bots_json()), bot = bots.findIndex((x) => x.id === 'palamedes');
  same('Backgammon bots', JSON.parse(A.bots_json()), bots);
  let board = Array.from(A.start_board()), side = 0;
  const ctx = JSON.stringify({ cube: { value: 1, owner: null }, match: null });
  for (let turn = 0; turn < 30; turn++) {
    const d1 = 1 + rnd(6), d2 = 1 + rnd(6);
    if (turn % 5 === 0) {
      const run = (E) => [JSON.parse(E.ai_move_json(Uint8Array.from(board), side, d1, d2, bot, 99, ctx)).notation,
        JSON.parse(E.rank_moves_json(Uint8Array.from(board), side, d1, d2, 1, 2, ctx)).slice(0, 3).map((m) => [m.notation, m.equity]),
        JSON.parse(E.cube_decision_json(Uint8Array.from(board), side, 1, ctx)).action];
      same(`Backgammon turn ${turn} (${d1}-${d2})`, run(A), run(B));
    }
    const moves = JSON.parse(A.legal_moves_json(Uint8Array.from(board), side, d1, d2));
    board = moves[rnd(moves.length)].board;
    if (JSON.parse(A.result_json(Uint8Array.from(board)))) break;
    side = 1 - side;
  }
}
console.log(bad ? `${bad} different` : 'all the same');
process.exit(bad ? 1 : 0);
