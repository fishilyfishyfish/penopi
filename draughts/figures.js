// The little diagrams in the draughts rules sheet (draughts/game.js): a step, a capture (backwards too), a chain, the king.
import { diagram, figs } from '../shared/diagram.js';

const CROWN = (w) => `<path d="M10 27 L8 14 L15 20 L20 11 L25 20 L32 14 L30 27 Z" style="fill:none;stroke:${w ? 'var(--ink)' : 'var(--sheet)'};stroke-width:3;stroke-linejoin:round;stroke-linecap:round"/>`;
const man = (white, r, c, king = false) => ({
  t: 'piece', r, c, k: 2.6,
  g: (white ? '<ellipse cx="20" cy="20" rx="14" ry="13" style="fill:var(--sheet);stroke:var(--ink);stroke-width:2.4"/>' : '<ellipse cx="20" cy="20" rx="15" ry="14" style="fill:var(--ink)"/>') + (king ? CROWN(white) : ''),
});
const dots = (list) => list.map(([r, c]) => ({ t: 'dot', r, c }));
const caps = (list) => list.map(([r, c]) => ({ t: 'cap', r, c }));
const board6 = (items, caption) => diagram({ rows: 6, dark: (r, c) => (r + c) % 2 === 1, items, caption, label: caption, max: 146 });
const hop = (a, b) => ({ t: 'arrow', from: a, to: b, trim: 20 });

export const MOVE_FIGS = figs(
  board6([man(true, 4, 3), ...dots([[3, 2], [3, 4]])], '말: 대각선 앞으로 한 칸'),
  board6([man(true, 3, 2), man(false, 2, 3), man(false, 4, 1), ...caps([[2, 3], [4, 1]]), ...dots([[1, 4], [5, 0]])], '잡기: 옆 대각선의 상대 말을 넘어 빈칸에, 뒤로도 돼'),
  board6([man(true, 5, 0), man(false, 4, 1), man(false, 2, 3), ...caps([[4, 1], [2, 3]]), hop([5, 0], [3, 2]), hop([3, 2], [1, 4])], '넘은 뒤 또 넘을 수 있으면 계속 잡아'),
);
export const KING_FIGS = figs(
  board6([man(true, 3, 2, true), ...dots([[2, 1], [1, 0], [2, 3], [1, 4], [0, 5], [4, 1], [5, 0], [4, 3], [5, 4]])], '킹: 대각선으로 멀리'),
  board6([man(true, 5, 0, true), man(false, 3, 2), ...caps([[3, 2]]), ...dots([[2, 3], [1, 4], [0, 5]])], '킹은 멀리 있는 말도 넘어 그 너머 아무 빈칸에'),
);
