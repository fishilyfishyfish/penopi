// Checks that the engines copied here answer exactly like the original sites' engines.
//   node tools/verify-engines.mjs <LOA_turk dir> <amazons pkg dir> <backgammon pkg dir>
// The two pkg dirs are WASM builds of the original repos (amazons-hippolyta, backgammon-palamedes), made the
// way their own scripts do. For each game, positions from a seeded random game are searched by both engines
// with the same fixed settings (fixed depth / iterations / seeds, so time doesn't matter) and the moves and
// evaluations must be identical.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [loaDir, amzPkg, bgPkg] = process.argv.slice(2);
if (!bgPkg) { console.log('usage: node tools/verify-engines.mjs <LOA_turk dir> <amazons pkg dir> <backgammon pkg dir>'); process.exit(2); }
let bad = 0;
const same = (what, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) bad++;
  console.log(`${ok ? 'same' : 'DIFFERENT'}  ${what}: ${JSON.stringify(a).slice(0, 90)}${ok ? '' : '  vs  ' + JSON.stringify(b).slice(0, 90)}`);
};
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

// ---------- LOA: engine.js (page script) ----------
function loadLoa(file) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nthis.LoaEngine = LoaEngine; this.W = TUNED_WEIGHTS;', ctx);
  const E = ctx.LoaEngine({ ttBits: 16 });
  E.setWeights(ctx.W);
  return E;
}
{
  const A = loadLoa(path.join(loaDir, 'engine.js')), B = loadLoa(path.join(here, 'loa', 'engine.js'));
  const moves = [];
  A.setStart();
  for (let ply = 0; ply <= 30; ply++) {
    if (ply % 6 === 0) {
      const run = (E) => { E.setStart(); for (const m of moves) E.play(m); E.ttClear(); const i = E.think({ depth: 5, clearTT: true }); return [i.move, i.score, i.depth]; };
      same(`LOA ply ${ply} depth 5`, run(A), run(B));
    }
    A.setStart(); for (const m of moves) A.play(m);
    const legal = A.legalMoves();
    if (!legal.length) break;
    moves.push(legal[rnd(legal.length)]);
  }
}

// ---------- WASM engines ----------
async function loadPkg(dir, name) {
  const mod = await import(path.resolve(dir, name + '.js'));
  await mod.default({ module_or_path: fs.readFileSync(path.resolve(dir, name + '_bg.wasm')) });
  return mod;
}
{
  const A = await loadPkg(amzPkg, 'amazons_engine'), B = await loadPkg(path.join(here, 'amazons', 'pkg'), 'amazons_engine');
  const ga = new A.Game(1), gb = new B.Game(1);
  const hist = [];
  for (let ply = 0; ply <= 40; ply++) {
    if (ply % 8 === 0) {
      const run = (G) => { G.load_history(Uint8Array.from(hist)); G.search_start_seeded(7, 0); G.search_run(1500); const i = JSON.parse(G.search_info(3)); return [i.candidates.map((c) => [c.move, c.visits]), i.value]; };
      same(`Amazons ply ${ply} MCTS 1500`, run(ga), run(gb));
    }
    ga.load_history(Uint8Array.from(hist));
    const legal = Array.from(ga.legal_moves());
    if (!legal.length) break;
    const i = 3 * rnd(legal.length / 3);
    hist.push(...legal.slice(i, i + 3));
  }
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
