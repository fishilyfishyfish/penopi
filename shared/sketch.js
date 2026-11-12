// Pen-on-paper drawing helpers shared by the boards.

const j = (k) => (Math.random() - 0.5) * k;

// A line drawn by hand: it bends a little and its ends wander (k = how shaky).
export function wobble(x1, y1, x2, y2, k = 4) {
  return `M${(x1 + j(k)).toFixed(1)} ${(y1 + j(k)).toFixed(1)} Q${((x1 + x2) / 2 + j(k * 2)).toFixed(1)} ${((y1 + y2) / 2 + j(k * 2)).toFixed(1)} ${(x2 + j(k)).toFixed(1)} ${(y2 + j(k)).toFixed(1)}`;
}

// An n×n grid drawn by hand over a square board: every line bends a little and the frame overshoots its corners.
// Drawn in a 100n-unit box that stretches to the board.
export function gridSvg(n) {
  const S = n * 100;
  let inner = '';
  for (let i = 1; i < n; i++) inner += wobble(i * 100, 0, i * 100, S) + wobble(0, i * 100, S, i * 100);
  const frame = wobble(-6, 0, S + 6, 0, 5) + wobble(S, -6, S, S + 6, 5) + wobble(S + 6, S, -6, S, 5) + wobble(0, S + 6, 0, -6, 5);
  return `<svg class="grid" viewBox="0 0 ${S} ${S}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${inner}" fill="none" stroke="#1b1b1b" stroke-width="1.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="${frame}" fill="none" stroke="#1b1b1b" stroke-width="2.8" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

// Overlay svg in the board's n×n unit box (for trails, loops, the eraser).
export function overlay(cls, n) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls); svg.setAttribute('viewBox', `0 0 ${n * 100} ${n * 100}`);
  svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  return svg;
}

// A pencil arc from one cell centre to another (cells are 100 units): returns the path d.
export function arc([x1, y1], [x2, y2]) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, bend = Math.min(60, len * 0.3);
  const mx = (x1 + x2) / 2 + ((y1 - y2) / len) * bend * Math.sign(x2 - x1 || 1), my = (y1 + y2) / 2 - Math.abs((x2 - x1) / len) * bend;
  return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`;
}

// A piece hopping from one square element to another along the arc, squashing as it lands.
export function hopPiece(pieceEl, fromEl, toEl) {
  if (!pieceEl) return;
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  const dx = a.left - b.left, dy = a.top - b.top, lift = Math.min(40, 14 + Math.hypot(dx, dy) * 0.12), tilt = dx > 0 ? -10 : 10;
  pieceEl.animate([
    { transform: `translate(${dx}px, ${dy}px)` },
    { transform: `translate(${dx / 2}px, ${dy / 2 - lift}px) rotate(${tilt}deg) scale(1.08)`, offset: 0.5 },
    { transform: 'translate(0, 0) scale(1.12, .88)', offset: 0.85 },
    { transform: 'none' },
  ], { duration: 460, easing: 'ease-in-out' });
}

// The trail left by a move: a pencil arc, then an eraser rubs it out (n = board size in cells).
export function trail(boardEl, n, from, to) {
  const svg = overlay('trail', n), d = arc(from, to);
  svg.innerHTML = `<path class="smudge" pathLength="1" vector-effect="non-scaling-stroke" d="${d}"/><path class="line" pathLength="1" vector-effect="non-scaling-stroke" d="${d}"/>`;
  boardEl.appendChild(svg);
  setTimeout(() => svg.remove(), 2000);
}

// new game: a fat eraser stroke zigzags over the board, then fades; then() runs once the board is covered
export function wipe(boardEl, n, then) {
  const S = n * 100, svg = overlay('wipe', n);
  const pts = [];
  for (let i = 0; i < 5; i++) pts.push(`L${S + 40} ${i * S / 5 + 30} L-40 ${(i + 1) * S / 5 + 20}`);
  svg.innerHTML = `<path pathLength="1" d="M-40 ${S * 0.075} ${pts.join(' ')}"/>`;
  boardEl.appendChild(svg);
  setTimeout(() => {
    then();
    boardEl.classList.add('drawin');
    svg.classList.add('done');
    setTimeout(() => { svg.remove(); boardEl.classList.remove('drawin'); }, 900);
  }, 520);
}
