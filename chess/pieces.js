// The six chess pieces as pen doodles, drawn in a 40×40 box (chess/game.js draws them on the board, and the rules sheet draws
// them in its little diagrams). Colour comes from CSS: .pc.w / .pc.b (chess/game.css).
export const SHAPES = {
  1: '<path class="b" d="M14 33 C15 27 17 23 20 21 C23 23 25 27 26 33 Z"/><circle class="b" cx="20" cy="15" r="5.5"/>',
  2: '<path class="b" d="M13 33 C13 26 16 23 19 19 C15 20 12 19 11.5 16 C13 12 17 9 21 8 L23 5 L25 8.5 C29 12 30 19 28.5 33 Z"/><circle class="d" cx="19" cy="12.5" r="1.3"/>',
  3: '<path class="b" d="M14 33 C14 28 15 25 17.5 23 C13.5 19 15 12 20 8 C25 12 26.5 19 22.5 23 C25 25 26 28 26 33 Z"/><path class="l" d="M22 12.5 L18.5 17"/><circle class="b" cx="20" cy="6" r="2"/>',
  4: '<path class="b" d="M12.5 33 L13.5 18 L12 10 H16 V13 H18.5 V10 H21.5 V13 H24 V10 H28 L26.5 18 L27.5 33 Z"/><path class="l" d="M14 18 H26"/>',
  5: '<path class="b" d="M11 33 L9 14 L14.5 22 L16 10 L20 20.5 L24 10 L25.5 22 L31 14 L29 33 Z"/><circle class="b" cx="9" cy="12.5" r="2"/><circle class="b" cx="16" cy="8.5" r="2"/><circle class="b" cx="24" cy="8.5" r="2"/><circle class="b" cx="31" cy="12.5" r="2"/>',
  6: '<path class="b" d="M12 33 C12 25 14 21 20 19.5 C26 21 28 25 28 33 Z"/><path class="b" d="M15 20 C15 16 17 14.5 20 14.5 C23 14.5 25 16 25 20"/><path class="l x" d="M20 4.5 V13 M16.5 8 H23.5"/>',
};
