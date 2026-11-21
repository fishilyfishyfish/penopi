// The little diagrams in the reversi rules sheet (reversi/game.js): closing a line of discs turns them over.
import { diagram, figs } from '../shared/diagram.js';

const disc = (black, c) => ({ t: 'piece', r: 0, c, k: 2.6, g: black ? '<ellipse cx="20" cy="20" rx="15" ry="14" style="fill:var(--ink)"/>' : '<ellipse cx="20" cy="20" rx="14" ry="13" style="fill:var(--sheet);stroke:var(--ink);stroke-width:2.4"/>' });
const strip = (items, caption) => diagram({ rows: 1, cols: 5, items, caption, label: caption, max: 146 });

export const FLIP_FIGS = figs(
  strip([disc(true, 0), disc(false, 1), disc(false, 2), disc(false, 3), { t: 'dot', r: 0, c: 4 }], '검은 돌 사이에 흰 돌을 끼우는 칸(빨간 점)에'),
  strip([0, 1, 2, 3, 4].map((c) => disc(true, c)).concat([1, 2, 3].map((c) => ({ t: 'cap', r: 0, c }))), '두면 끼인 흰 돌이 전부 검은 돌이 돼'),
);
