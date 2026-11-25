// The Surakarta board drawing, shared by the game page and the rules figures: a 6×6 point grid with the two loops.
// Units: 100 per point spacing; the points start at M units from the edge so the corner arcs have room outside.
import { wobble } from '../shared/sketch.js';

export const M = 1.4, U = 5 + 2 * M; // board width in point spacings
export const VIEW = U * 100;
export const px = (v) => (M + v) * 100;                         // a point coordinate (0..5) in svg units
export const pct = (v) => ((M + v) / U) * 100;                  // …in percent of the board's side

// a corner arc of loop `a` (1: the small loop, 2: the big one), 3/4 of a circle outside the corner, as a path
export function arc(corner, a) {
  const k = a === 1 ? 0.95 : 1.75, [ox, oy] = [corner[0] === 0 ? M : M + 5, corner[1] === 0 ? M : M + 5];
  const sx = corner[0] === 0 ? 1 : -1, sy = corner[1] === 0 ? 1 : -1; // towards the board's inside
  const P = [ox, oy + sy * a], Q = [ox + sx * a, oy];
  const c1 = [P[0] - sx * k, P[1]], c2 = [Q[0], Q[1] - sy * k];
  const f = (p) => `${(p[0] * 100).toFixed(1)} ${(p[1] * 100).toFixed(1)}`;
  return `M${f(P)} C${f(c1)} ${f(c2)} ${f(Q)}`;
}
// the board art as svg inner markup: thin grid, the small loop's lines and arcs in the pen colour, the big loop's in ink
export function boardArt() {
  let grid = '', small = '', big = '';
  for (let i = 0; i < 6; i++) {
    const l = (r1, c1, r2, c2) => wobble(px(c1), px(r1), px(c2), px(r2), 2.4);
    const h = l(i, 0, i, 5), v = l(0, i, 5, i);
    if (i === 1 || i === 4) small += h + v;
    else if (i === 2 || i === 3) big += h + v;
    else grid += h + v;
  }
  for (const corner of [[0, 0], [5, 0], [0, 5], [5, 5]]) { small += arc(corner, 1); big += arc(corner, 2); }
  return `<path d="${grid}" fill="none" stroke="#1b1b1b" stroke-width="1.6" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity=".55"/>
    <path d="${small}" fill="none" stroke="#d8452f" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="${big}" fill="none" stroke="#1b1b1b" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
}
