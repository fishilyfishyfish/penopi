// Tunes chess/engine.js's evaluation parameters (PV) on self-play positions (tools/chess-selfplay.mjs), the
// "Texel" way: find the parameters whose evaluation, through a logistic curve, best predicts the game results.
//   node tools/chess-tune.mjs <data file> [epochs = 1500] [--write]
// The evaluation is linear in PV (engine features()), so each position is turned into a sparse coefficient
// vector once and the loss is minimised with Adam on the whole set. One position in ten is kept aside to
// check that the result holds on positions the tuner didn't see. --write puts the result into engine.js
// (the line marked "tuned-params").
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const enginePath = path.join(root, 'chess', 'engine.js');
const { ChessEngine } = createRequire(import.meta.url)(enginePath);
const [dataFile, epochsArg, ...flags] = process.argv.slice(2);
const EPOCHS = Number(epochsArg || 1500), WRITE = flags.includes('--write');

const E = ChessEngine({ ttBits: 10 });
const P0 = Float64Array.from(E.params()), NP = P0.length;
const lines = fs.readFileSync(dataFile, 'utf8').trim().split('\n');
// sparse rows: start[i]..start[i+1] in idx / coef
const start = new Int32Array(lines.length + 1), res = new Float64Array(lines.length), fixed = new Float64Array(lines.length);
let idx = new Int32Array(lines.length * 80), coef = new Float64Array(lines.length * 80), nz = 0;
const seen = new Int32Array(NP);
let n = 0;
const t0 = Date.now();
for (const l of lines) {
  const [fen, r] = l.split('\t');
  E.setFen(fen);
  const f = E.features();
  if (nz + f.idx.length > idx.length) { const i2 = new Int32Array(idx.length * 2); i2.set(idx); idx = i2; const c2 = new Float64Array(coef.length * 2); c2.set(coef); coef = c2; }
  start[n] = nz;
  for (let k = 0; k < f.idx.length; k++) { idx[nz] = f.idx[k]; coef[nz] = f.coef[k]; nz++; seen[f.idx[k]]++; }
  res[n] = Number(r);
  n++;
}
start[n] = nz;
console.log(`${n} positions, ${nz} coefficients, ${((Date.now() - t0) / 1000).toFixed(0)} s to extract`);
const isVal = (i) => i % 10 === 0;
// parameters seen in fewer than 200 positions stay as they are (too little evidence)
const free = Uint8Array.from(seen, (c) => (c >= 200 ? 1 : 0));

function evalRow(P, i) { let v = 0; for (let k = start[i]; k < start[i + 1]; k++) v += coef[k] * P[idx[k]]; return v; }
const sig = (x) => 1 / (1 + Math.exp(-x));
function loss(P, K, val) {
  let s = 0, m = 0;
  for (let i = 0; i < n; i++) { if (isVal(i) !== val) continue; const e = res[i] - sig(K * evalRow(P, i) / 400); s += e * e; m++; }
  return s / m;
}
// the curve's steepness that fits the starting parameters best
let K = 1, best = Infinity;
for (let k = 0.3; k <= 2.5; k += 0.05) { const L = loss(P0, k, false); if (L < best) { best = L; K = k; } }
console.log(`K = ${K.toFixed(2)}, start loss train ${best.toFixed(6)}, validation ${loss(P0, K, true).toFixed(6)}`);

const P = Float64Array.from(P0), g = new Float64Array(NP), m1 = new Float64Array(NP), m2 = new Float64Array(NP);
const LR = 1.0, B1 = 0.9, B2 = 0.999, REG = 1e-7; // REG pulls gently toward the starting values
for (let ep = 1; ep <= EPOCHS; ep++) {
  g.fill(0);
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (isVal(i)) continue;
    const s = sig(K * evalRow(P, i) / 400), d = -2 * (res[i] - s) * s * (1 - s) * K / 400;
    for (let k = start[i]; k < start[i + 1]; k++) g[idx[k]] += d * coef[k];
    m++;
  }
  for (let j = 0; j < NP; j++) {
    if (!free[j]) continue;
    const gj = g[j] / m + REG * (P[j] - P0[j]);
    m1[j] = B1 * m1[j] + (1 - B1) * gj; m2[j] = B2 * m2[j] + (1 - B2) * gj * gj;
    P[j] -= LR * (m1[j] / (1 - B1 ** ep)) / (Math.sqrt(m2[j] / (1 - B2 ** ep)) + 1e-12);
  }
  if (ep % 100 === 0 || ep === EPOCHS) console.log(`epoch ${ep}: train ${loss(P, K, false).toFixed(6)}, validation ${loss(P, K, true).toFixed(6)} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
}
const out = Array.from(P, (v) => Math.round(v));
// a short report: material and the scalar terms
for (const [name, o, len] of E.PDEF) if (len <= 8 && !name.startsWith('pst')) console.log(`${name}: ${Array.from(P0.slice(o, o + len)).join(' ')} → ${out.slice(o, o + len).join(' ')}`);
const outFile = path.join(path.dirname(dataFile), 'tuned.json');
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`wrote ${outFile}`);
if (WRITE) {
  const src = fs.readFileSync(enginePath, 'utf8');
  const re = /const TUNED = .*; \/\/ tuned-params/;
  if (!re.test(src)) throw new Error('marker not found');
  fs.writeFileSync(enginePath, src.replace(re, `const TUNED = [${out.join(',')}]; // tuned-params`));
  console.log('engine.js updated');
}
