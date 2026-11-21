// Small pen drawings for the rules sheets: a board of rows × cols cells (100 units each) with hatched dark squares,
// highlighted areas, pieces, red dots (where it can go), dashed rings (what it can take), arrows, crosses and labels.
//   diagram({ rows, cols, dark?, thick?, hl?, items, caption?, label?, max? })
//     dark   (r, c) => true for hatched squares (a chess board)      thick  every n cells a heavier line (nine small boards)
//     wide   true: a bigger figure (230 px), alone on its row
//     hl     [{ r, c, rows = 1, cols = 1 }] light-yellow areas       max    widest the figure is shown, in px
//     items  { t: 'piece', r, c, g: svg inner markup, k: scale, b: box the markup is drawn in (40, or 100 for shogi/janggi tiles), cls }  { t: 'dot'|'cap'|'x'|'ring', r, c }
//            { t: 'pt', r, c, rad? } a dot  { t: 'seg', from, to, col?, w?, dash? } a line between two centres  { t: 'box', r, c } the square from this centre to the next
//            { t: 'mx'|'mo', r, c, s?, w? } an X / O drawn in pen (s: scale, for a won small board)
//            { t: 'arrow', from: [r, c], to: [r, c], c?: colour }    { t: 'text', r, c, s }
// figs(...) puts several next to each other (they wrap on a phone).
import { wobble } from './sketch.js';

let uid = 0;
const cx = (c) => c * 100 + 50, cy = (r) => r * 100 + 50;
const PEN = 'var(--pen)', INK = 'var(--ink)';

function item(it) {
  const x = cx(it.c || 0), y = cy(it.r || 0);
  switch (it.t) {
    case 'piece': { const k = it.k || 2.9, h = (it.b || 40) / 2; return `<g class="${it.cls || ''}" transform="translate(${x - h * k} ${y - h * k}) scale(${k})">${it.g}</g>`; }
    case 'dot': return `<ellipse cx="${x}" cy="${y}" rx="13" ry="12" style="fill:${PEN}"/>`;
    case 'cap': return `<ellipse cx="${x}" cy="${y}" rx="43" ry="41" style="fill:none;stroke:${PEN};stroke-width:6;stroke-dasharray:11 9;stroke-linecap:round"/>`;
    case 'ring': return `<ellipse cx="${x}" cy="${y}" rx="44" ry="42" style="fill:none;stroke:${PEN};stroke-width:6"/>`;
    case 'mx': return `<path d="M${x - 26} ${y - 26} L${x + 26} ${y + 26} M${x + 26} ${y - 26} L${x - 26} ${y + 26}" style="fill:none;stroke:${INK};stroke-width:${it.w || 9};stroke-linecap:round"/>`;
    case 'mo': return `<ellipse cx="${x}" cy="${y}" rx="${26 * (it.s || 1)}" ry="${27 * (it.s || 1)}" style="fill:none;stroke:${INK};stroke-width:${it.w || 9};"/>`;
    case 'pt': return `<circle cx="${x}" cy="${y}" r="${it.rad || 11}" style="fill:${INK}"/>`;
    case 'box': return `<rect x="${x}" y="${y}" width="100" height="100" style="fill:${it.col || 'var(--marker)'};opacity:.75"/>`;
    case 'seg': { const [r1, c1] = it.from, [r2, c2] = it.to; return `<path d="M${cx(c1)} ${cy(r1)} L${cx(c2)} ${cy(r2)}" style="fill:none;stroke:${it.col || INK};stroke-width:${it.w || 9};stroke-linecap:round${it.dash ? ';stroke-dasharray:14 14' : ''}"/>`; }
    case 'x': return `<path d="M${x - 30} ${y - 28} L${x + 30} ${y + 30} M${x + 30} ${y - 29} L${x - 30} ${y + 29}" style="fill:none;stroke:${PEN};stroke-width:9;stroke-linecap:round"/>`;
    case 'text': return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" style="fill:${it.c || INK};font-size:${it.size || 64}px;font-weight:700">${it.s}</text>`;
    case 'arrow': {
      const [r1, c1] = it.from, [r2, c2] = it.to;
      let x1 = cx(c1), y1 = cy(r1), x2 = cx(c2), y2 = cy(r2);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len, trim = it.trim === undefined ? 34 : it.trim;
      x1 += ux * trim; y1 += uy * trim; x2 -= ux * trim; y2 -= uy * trim;
      const hx = 22, nx = -uy, ny = ux;
      const col = it.col || PEN;
      return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} M${(x2 - ux * hx + nx * 14).toFixed(1)} ${(y2 - uy * hx + ny * 14).toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${(x2 - ux * hx - nx * 14).toFixed(1)} ${(y2 - uy * hx - ny * 14).toFixed(1)}" style="fill:none;stroke:${col};stroke-width:8;stroke-linecap:round;stroke-linejoin:round"/>`;
    }
    default: return '';
  }
}

export function diagram(o) {
  const R = o.rows, C = o.cols || R, W = C * 100, H = R * 100, id = `dg${uid++}`;
  let s = `<svg class="fig" viewBox="-10 -10 ${W + 20} ${H + 20}" role="img" aria-label="${o.label || ''}"${o.max ? ` style="max-width:${o.max}px"` : ''}>`;
  if (o.dark) {
    s += `<defs><pattern id="${id}" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0 V16" style="stroke:var(--hatch);stroke-width:3"/></pattern></defs>`;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (o.dark(r, c)) s += `<rect x="${c * 100}" y="${r * 100}" width="100" height="100" fill="url(#${id})"/>`;
  }
  for (const h of o.hl || []) s += `<rect x="${h.c * 100 + 4}" y="${h.r * 100 + 4}" width="${(h.cols || 1) * 100 - 8}" height="${(h.rows || 1) * 100 - 8}" rx="14" style="fill:var(--marker);opacity:.6"/>`;
  if (o.pts) { // pieces stand on the crossings (janggi, go): lines run through the cell centres; o.diag = [[r1, c1, r2, c2]] adds diagonals
    let d = '';
    if (o.segs) for (const [r1, c1, r2, c2] of o.segs) d += wobble(cx(c1), cy(r1), cx(c2), cy(r2), 3); // only these lines (morris)
    else {
      for (let r = 0; r < R; r++) d += wobble(50, cy(r), W - 50, cy(r), 3);
      for (let c = 0; c < C; c++) d += wobble(cx(c), 50, cx(c), H - 50, 3);
    }
    for (const [r1, c1, r2, c2] of o.diag || []) d += wobble(cx(c1), cy(r1), cx(c2), cy(r2), 3);
    s += `<path d="${d}" style="fill:none;stroke:${INK};stroke-width:3;stroke-linecap:round"/>`;
    for (const it of o.items || []) s += item(it);
    return `<figure${o.wide ? ' class="wide"' : ''}>${s}</svg>${o.caption ? `<figcaption>${o.caption}</figcaption>` : ''}</figure>`;
  }
  let thin = '', thick = '';
  for (let i = 1; i < C; i++) (o.thick && i % o.thick === 0 ? (thick += wobble(i * 100, 0, i * 100, H, 4)) : (thin += wobble(i * 100, 0, i * 100, H, 3)));
  for (let i = 1; i < R; i++) (o.thick && i % o.thick === 0 ? (thick += wobble(0, i * 100, W, i * 100, 4)) : (thin += wobble(0, i * 100, W, i * 100, 3)));
  const frame = wobble(-5, 0, W + 5, 0, 4) + wobble(W, -5, W, H + 5, 4) + wobble(W + 5, H, -5, H, 4) + wobble(0, H + 5, 0, -5, 4);
  s += `<path d="${thin}" style="fill:none;stroke:${INK};stroke-width:2.2;stroke-linecap:round"/>`;
  s += `<path d="${thick + frame}" style="fill:none;stroke:${INK};stroke-width:${o.thick ? 5 : 4};stroke-linecap:round"/>`;
  for (const it of o.items || []) s += item(it);
  s += '</svg>';
  return `<figure${o.wide ? ' class="wide"' : ''}>${s}${o.caption ? `<figcaption>${o.caption}</figcaption>` : ''}</figure>`;
}
export const figs = (...list) => `<div class="figs">${list.join('')}</div>`;
