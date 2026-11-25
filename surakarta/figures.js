// The little diagrams in the surakarta rules sheet (surakarta/game.js): the two loops, a step, a capture round a corner.
import { M, U, VIEW, px, boardArt, arc } from './art.js';

const stone = (black, r, c) => (black
  ? `<ellipse cx="${px(c)}" cy="${px(r)}" rx="34" ry="32" style="fill:var(--ink)"/>`
  : `<ellipse cx="${px(c)}" cy="${px(r)}" rx="33" ry="31" style="fill:var(--sheet);stroke:var(--ink);stroke-width:5"/>`);
const dot = (r, c) => `<ellipse cx="${px(c)}" cy="${px(r)}" rx="14" ry="13" style="fill:var(--pen)"/>`;
const ring = (r, c) => `<ellipse cx="${px(c)}" cy="${px(r)}" rx="44" ry="42" style="fill:none;stroke:var(--pen);stroke-width:6;stroke-dasharray:11 9;stroke-linecap:round"/>`;
const fig = (inner, caption, wide) => `<figure${wide ? ' class="wide"' : ''}><svg class="fig" viewBox="0 0 ${VIEW} ${VIEW}" role="img" aria-label="${caption}"${wide ? '' : ' style="max-width:146px"'}>${boardArt()}${inner}</svg><figcaption>${caption}</figcaption></figure>`;

const start = [];
for (let c = 0; c < 6; c++) for (const r of [0, 1]) start.push(stone(true, r, c));
for (let c = 0; c < 6; c++) for (const r of [4, 5]) start.push(stone(false, r, c));

export const LOOP_FIGS = `<div class="figs">${fig(start.join(''), '빨간 고리는 둘째·다섯째 줄, 검은 고리는 셋째·넷째 줄이야. 바깥 줄은 고리가 아니야. 구석의 동그란 길로 이어져', true)}</div>`;

export const STEP_FIGS = `<div class="figs">${fig(stone(true, 2, 2) + [[1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2], [3, 3]].map(([r, c]) => dot(r, c)).join(''), '걷기: 빈 칸 한 칸으로 어느 방향이든 한 칸')}</div>`;

// a capture round the top-left corner: from (1,2) left along row 1, round the arc, down column 1 to the white piece at (3,1)
const route = `M${px(2)} ${px(1)} L${px(0)} ${px(1)}${arc([0, 0], 1).replace(/^M[^C]*C/, ' C')} L${px(1)} ${px(3)}`;
export const CAPTURE_FIGS = `<div class="figs">${fig(
  `<path d="${route}" style="fill:none;stroke:var(--pen);stroke-width:9;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1 16" vector-effect="non-scaling-stroke"/>` + stone(true, 1, 2) + stone(false, 3, 1) + ring(3, 1),
  '잡기: 고리를 따라 빈 길을 달려서 처음 만나는 상대 말을 잡아. 코너를 돌아도 돼', true)}
${fig(stone(true, 1, 2) + stone(true, 1, 4) + stone(false, 1, 5) + `<path d="M${px(2)} ${px(1)} L${px(3.4)} ${px(1)}" style="fill:none;stroke:var(--pen);stroke-width:9;stroke-linecap:round" vector-effect="non-scaling-stroke"/>` + `<path d="M${px(3.5)-26} ${px(1)-26} L${px(3.5)+26} ${px(1)+26} M${px(3.5)+26} ${px(1)-26} L${px(3.5)-26} ${px(1)+26}" style="fill:none;stroke:var(--pen);stroke-width:9;stroke-linecap:round"/>`, '내 말이 길을 막고 있으면 못 가')}</div>`;
