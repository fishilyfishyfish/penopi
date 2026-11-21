// The little diagram in the 육각잇기 rules sheet (yukgak/game.js): touching hexagons are connected; black joins its top and bottom edges.
const R = 46, DX = R * Math.sqrt(3), DY = R * 1.5;
const cell = (r, c) => [c * DX + r * DX / 2 + 70, r * DY + 62]; // pointy-top hexagons, each row shifted half a cell to the right
const hex = ([x, y]) => `<polygon points="${[0, 1, 2, 3, 4, 5].map((i) => { const a = Math.PI / 6 + i * Math.PI / 3; return `${(x + R * Math.cos(a)).toFixed(1)},${(y + R * Math.sin(a)).toFixed(1)}`; }).join(' ')}" style="fill:var(--sheet);stroke:var(--ink);stroke-width:2.4;stroke-linejoin:round"/>`;

export const HEX_FIG = (() => {
  const N = 5, path = [[0, 2], [1, 2], [2, 1], [3, 1], [4, 1]];
  let s = '';
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) s += hex(cell(r, c));
  const [x0, y0] = cell(0, 0), [x1] = cell(0, N - 1), [, y4] = cell(N - 1, 0), [x2] = cell(N - 1, N - 1);
  // black's edges (top and bottom): heavy; white's (left and right): two lines
  s += `<path d="M${x0 - 40} ${y0 - 36} L${x1 + 40} ${y0 - 36} M${cell(N - 1, 0)[0] - 40} ${y4 + 36} L${x2 + 40} ${y4 + 36}" style="fill:none;stroke:var(--ink);stroke-width:7;stroke-linecap:round"/>`;
  const left = (a, b) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`;
  s += `<path d="${left([x0 - 56, y0 - 28], [cell(N - 1, 0)[0] - 56, y4 + 28])} ${left([x0 - 48, y0 - 28], [cell(N - 1, 0)[0] - 48, y4 + 28])} ${left([x1 + 56, y0 - 28], [x2 + 56, y4 + 28])} ${left([x1 + 64, y0 - 28], [x2 + 64, y4 + 28])}" style="fill:none;stroke:var(--ink);stroke-width:3;stroke-linecap:round"/>`;
  s += path.map(([r, c]) => { const [x, y] = cell(r, c); return `<ellipse cx="${x}" cy="${y}" rx="30" ry="29" style="fill:var(--ink)"/>`; }).join('');
  s += `<path d="${path.map(([r, c], i) => `${i ? 'L' : 'M'}${cell(r, c)[0]} ${cell(r, c)[1]}`).join(' ')}" style="fill:none;stroke:var(--pen);stroke-width:7;stroke-linecap:round;stroke-linejoin:round"/>`;
  const W = cell(N - 1, N - 1)[0] + 90, H = y4 + 70;
  return `<div class="figs"><figure class="wide"><svg class="fig" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="붙은 육각형으로 위아래 변을 잇는 흑" style="max-width:230px">${s}</svg><figcaption>붙은 육각형끼리 끊김 없이 이어서 내 두 변(흑은 위아래 굵은 선)을 잇는다</figcaption></figure></div>`;
})();
