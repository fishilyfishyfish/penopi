// The little diagram in the backgammon rules sheet (backgammon/game.js): the way my checkers travel round the board.
const W = 49.2, TOP = 10, BOT = 310, TIP = 138;
const tri = (x0, top, hatched) => `<polygon points="${x0.toFixed(1)},${top ? TOP : BOT} ${(x0 + W).toFixed(1)},${top ? TOP : BOT} ${(x0 + W / 2).toFixed(1)},${top ? TOP + TIP : BOT - TIP}" style="fill:${hatched ? 'var(--hatch)' : 'var(--sheet)'};stroke:var(--ink);stroke-width:2.4;stroke-linejoin:round"/>`;

export const ROUTE_FIG = (() => {
  let s = '<rect x="345" y="172" width="295" height="138" rx="10" style="fill:var(--marker);opacity:.6"/>'; // my home board: bottom right
  for (let i = 0; i < 6; i++) for (const x0 of [10 + i * W, 345 + i * W]) { s += tri(x0, true, i % 2 === 0); s += tri(x0, false, i % 2 === 1); }
  s += '<rect x="10" y="10" width="630" height="300" rx="8" style="fill:none;stroke:var(--ink);stroke-width:4.5"/>';
  s += '<rect x="305" y="10" width="40" height="300" style="fill:var(--sheet);stroke:var(--ink);stroke-width:3"/><text x="325" y="160" text-anchor="middle" dominant-baseline="central" style="fill:var(--ink);font-size:30px;font-weight:700">바</text>';
  s += '<path d="M600 36 L50 36 Q22 36 22 160 Q22 284 50 284 L592 284 M570 268 L596 284 L570 300" style="fill:none;stroke:var(--pen);stroke-width:8;stroke-linecap:round;stroke-linejoin:round"/>';
  s += '<path d="M628 36 L600 36 M613 22 L600 36 L613 50" style="fill:none;stroke:none"/>';
  s += '<circle cx="610" cy="36" r="11" style="fill:var(--pen)"/>';
  return `<div class="figs"><figure class="wide"><svg class="fig" viewBox="0 0 650 320" role="img" aria-label="내 말이 도는 방향" style="max-width:230px">${s}</svg><figcaption>내 말은 위 오른쪽(●)에서 출발해 위쪽은 왼쪽으로, 아래쪽은 오른쪽으로 돌아 아래 오른쪽 내 집(노란 칸)으로 들어와</figcaption></figure></div>`;
})();
