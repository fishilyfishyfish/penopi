// The little diagrams in the chess rules sheet (chess/game.js): where each piece can go, castling, en passant.
import { diagram, figs } from '../shared/diagram.js';
import { SHAPES } from './pieces.js';

const BASE = '<path class="b base" d="M10 33 Q20 31.5 30 33 L30 35.5 Q20 34.5 10 35.5 Z"/>';
const piece = (t, white, r, c) => ({ t: 'piece', r, c, g: SHAPES[t] + BASE, cls: `pc ${white ? 'w' : 'b'}` });
const dots = (list) => list.map(([r, c]) => ({ t: 'dot', r, c }));
const board7 = (items, caption) => diagram({ rows: 7, dark: (r, c) => (r + c) % 2 === 1, items, caption, label: caption, max: 146 });
const ray = (r0, c0, dr, dc) => { const out = []; for (let r = r0 + dr, c = c0 + dc; r >= 0 && r < 7 && c >= 0 && c < 7; r += dr, c += dc) out.push([r, c]); return out; };
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]], DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const rays = (dirs) => dirs.flatMap(([dr, dc]) => ray(3, 3, dr, dc));

export const MOVE_FIGS = figs(
  board7([piece(6, true, 3, 3), ...dots(ray(3, 3, 1, 0).slice(0, 1).concat(ray(3, 3, -1, 0).slice(0, 1), ray(3, 3, 0, 1).slice(0, 1), ray(3, 3, 0, -1).slice(0, 1), ray(3, 3, 1, 1).slice(0, 1), ray(3, 3, -1, -1).slice(0, 1), ray(3, 3, 1, -1).slice(0, 1), ray(3, 3, -1, 1).slice(0, 1)))], '킹: 사방 한 칸'),
  board7([piece(5, true, 3, 3), ...dots(rays([...ORTHO, ...DIAG]))], '퀸: 가로·세로·대각선 멀리'),
  board7([piece(4, true, 3, 3), ...dots(rays(ORTHO))], '룩: 가로·세로 멀리'),
  board7([piece(3, true, 3, 3), ...dots(rays(DIAG))], '비숍: 대각선 멀리'),
  board7([piece(2, true, 3, 3), ...dots([[1, 2], [1, 4], [2, 1], [2, 5], [4, 1], [4, 5], [5, 2], [5, 4]])], '나이트: 두 칸 가고 옆으로 한 칸, 넘어갈 수 있어'),
  board7([piece(1, true, 5, 3), piece(1, false, 4, 2), piece(1, false, 4, 4), ...dots([[4, 3], [3, 3]]), { t: 'cap', r: 4, c: 2 }, { t: 'cap', r: 4, c: 4 }], '폰: 앞으로 한 칸(처음엔 두 칸), 잡을 땐 대각선'),
);

const strip = (items, caption) => diagram({ rows: 1, cols: 4, dark: (r, c) => (c % 2) === 1, items, caption, label: caption, max: 146 });
export const CASTLE_FIGS = figs(
  strip([piece(6, true, 0, 0), piece(4, true, 0, 3), { t: 'arrow', from: [0, 0], to: [0, 2], trim: 24 }], '캐슬링 전'),
  strip([piece(4, true, 0, 1), piece(6, true, 0, 2), { t: 'arrow', from: [0, 3], to: [0, 1], trim: 24 }], '킹은 두 칸, 룩은 킹 너머로'),
);

export const EP_FIG = figs(diagram({
  rows: 3, cols: 3, dark: (r, c) => (r + c) % 2 === 1, max: 146,
  caption: '검은 폰이 두 칸 나와 옆에 서면, 바로 다음 수에 대각선으로 잡을 수 있어',
  label: '앙파상',
  items: [piece(1, true, 2, 1), piece(1, false, 2, 2), { t: 'arrow', from: [0, 2], to: [2, 2], col: 'var(--ink)', trim: 26 }, { t: 'dot', r: 1, c: 2 }, { t: 'arrow', from: [2, 1], to: [1, 2], trim: 26 }],
}));
