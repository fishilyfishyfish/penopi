// The little diagrams in the janggi rules sheet (janggi/game.js): where each piece can go. Pieces stand on the crossings.
import { diagram, figs } from '../shared/diagram.js';
import { GLYPHS } from '../shared/glyphs.js';

const NAMES = ['', '졸', '사', '상', '마', '포', '차', '궁'], SIZE = [0, 0.64, 0.66, 0.78, 0.78, 0.78, 0.84, 0.96];
// the board's tile (janggi/game.js pieceSvg), hangul names; 초 in ink, 한 in red
const tile = (t, cho, r, c) => {
  const k = SIZE[t], rr = 46 * k, a = rr * 0.414, fs = t === 7 ? 44 : 40 * k / 0.78;
  const pts = [[-a, -rr], [a, -rr], [rr, -a], [rr, a], [a, rr], [-a, rr], [-rr, a], [-rr, -a]].map(([x, y]) => `${(50 + x).toFixed(1)},${(50 + y).toFixed(1)}`).join(' ');
  const name = t === 7 ? (cho ? '초' : '한') : (!cho && t === 1 ? '병' : NAMES[t]);
  return { t: 'piece', r, c, b: 100, k: 1.22, cls: `jp ${cho ? 'cho' : 'han'}`,
    g: `<polygon points="${pts}"/><polygon class="in" points="${pts}" transform="translate(50 50) scale(.8) translate(-50 -50)"/><path class="g hangul" d="${GLYPHS.hangul[name]}" transform="translate(50 50) scale(${(fs / 100 * 1.05).toFixed(3)}) translate(-50 -50)"/>` };
};
const dots = (list) => list.map(([r, c]) => ({ t: 'dot', r, c }));
const fig = (rows, cols, items, caption, extra = {}) => diagram({ rows, cols, pts: true, items, caption, label: caption, max: 146, ...extra });
const ray = (n, r0, c0, dr, dc) => { const out = []; for (let r = r0 + dr, c = c0 + dc; r >= 0 && r < n && c >= 0 && c < n; r += dr, c += dc) out.push([r, c]); return out; };
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const PALACE = [[1, 1, 3, 3], [1, 3, 3, 1]]; // the palace is the middle 3×3 of the 5×5 figure
export const MOVE_FIGS = figs(
  fig(5, 5, [tile(6, true, 2, 2), ...dots(ORTHO.flatMap(([dr, dc]) => ray(5, 2, 2, dr, dc)))], '차: 가로·세로로 멀리'),
  fig(5, 5, [tile(5, true, 4, 2), tile(1, true, 2, 2), tile(1, false, 0, 2), ...dots([[1, 2]]), { t: 'cap', r: 0, c: 2 }], '포: 말 하나를 꼭 뛰어넘어서(잡을 때도)'),
  fig(5, 5, [tile(4, true, 2, 2), tile(1, false, 1, 2), ...dots([[1, 0], [1, 4], [3, 0], [3, 4], [4, 1], [4, 3]]), { t: 'x', r: 0, c: 1 }, { t: 'x', r: 0, c: 3 }], '마: 곧게 한 칸 + 대각선 한 칸, 곧은 길이 막히면 못 가'),
  fig(7, 7, [tile(3, true, 3, 3), ...dots([[0, 1], [0, 5], [1, 0], [1, 6], [5, 0], [5, 6], [6, 1], [6, 5]])], '상: 곧게 한 칸 + 대각선 두 칸'),
  fig(5, 5, [tile(1, true, 3, 2), ...dots([[2, 2], [3, 1], [3, 3]])], '졸·병: 앞이나 옆으로 한 칸'),
  fig(5, 5, [tile(7, true, 2, 2), ...dots([[1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2], [3, 3]])], '궁·사: 궁성 안에서 선을 따라 한 칸', { diag: PALACE }),
);
