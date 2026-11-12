// Penopi: a plain little dome that peeks over the top edge of the board and wanders along it.
// It is LOA 튀르크's Turk under another name (fishilyfishyfish/LOA_turk): same drawing, same moves.
// The body runs on to the bottom of the box; that part stays hidden behind the board. One face, always.

export const NAME = '페노피';

export const SVG = `<svg viewBox="0 0 64 90" aria-hidden="true" focusable="false">
    <path d="M8 90 L8 60 C6 38 14 8 28 4 C34 2 40 3 44 6 C52 14 57 34 57 60 L57 90 Z" fill="#fdfdfb" stroke="#1b1b1b" stroke-width="2.4" stroke-linejoin="round"/>
    <g class="face" fill="none" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round"><circle cx="25" cy="26" r="2"/><circle cx="37" cy="26" r="2"/><path d="M22 41 C27 40 32 37 40 36"/></g></svg>`;

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// The perch: Penopi, its bubble, the thinking dots and the z's. Returns the element.
export function perchHtml(label) {
  return `<section class="perch" aria-label="${label}">
    <p class="bubble" aria-live="polite"></p>
    <div class="portrait" role="button" tabindex="0" aria-label="${NAME} 찌르기"></div>
    <div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="zz" aria-hidden="true"><span>z</span><span>z</span><span>Z</span></div>
  </section>`;
}

// Brings a perch to life. `say(key)` speaks a line; `busy()` says whether a dialog or something else
// should keep it awake. Returns the controls the page uses to act things out.
export function animate(perchEl, say, busy = () => false) {
  const portrait = perchEl.querySelector('.portrait'), bubble = perchEl.querySelector('.bubble');
  const cls = portrait.classList;
  portrait.innerHTML = SVG;
  let x = 0.2, wanderTimer = 0, walkTimer = 0, actUntil = 0, hiding = false;

  // only a walk glides; the first placement, a new line and a resize put Penopi straight where it belongs
  function place(nx, walk) {
    x = nx;
    perchEl.classList.toggle('walking', !!walk);
    const W = perchEl.clientWidth;
    perchEl.style.setProperty('--w', W + 'px');
    perchEl.style.setProperty('--bw', bubble.offsetWidth + 'px');
    perchEl.style.setProperty('--x', Math.max(42, Math.min(W - 42, nx * W)) + 'px'); // never past the board's corners
  }
  function wander() {
    if (Date.now() > actUntil && !cls.contains('thinking') && !cls.contains('sunk') && !cls.contains('doze') && Math.random() < 0.8) {
      const nx = 0.1 + Math.random() * 0.8;
      if (Math.abs(nx - x) > 0.08 && !reduced()) {
        portrait.dataset.dir = nx < x ? 'l' : 'r';
        cls.add('walk');
        clearTimeout(walkTimer);
        walkTimer = setTimeout(() => cls.remove('walk'), 1800);
        place(nx, true);
      }
    }
    wanderTimer = setTimeout(wander, 2500 + Math.random() * 4000);
  }
  addEventListener('resize', () => place(x));
  // a walk to a spot along the edge, taking ms; wandering waits a little after it
  function walkTo(nx, ms = 1800) {
    actUntil = Date.now() + ms + 1500;
    if (reduced()) { place(nx); return; }
    portrait.dataset.dir = nx < x ? 'l' : 'r';
    perchEl.style.setProperty('--walk', ms + 'ms');
    cls.add('walk'); cls.toggle('run', ms < 1000);
    clearTimeout(walkTimer);
    walkTimer = setTimeout(() => { cls.remove('walk', 'run'); perchEl.style.removeProperty('--walk'); }, ms);
    place(nx, true);
  }
  function act(name, ms) {
    cls.remove(name); void portrait.offsetWidth; cls.add(name);
    if (ms) setTimeout(() => cls.remove(name), ms);
  }
  // pacing back and forth while waiting
  function pace(still = () => true) {
    walkTo(0.12, 600);
    setTimeout(() => { if (still()) walkTo(0.88, 600); }, 650);
    setTimeout(() => { if (still()) walkTo(0.5, 600); }, 1300);
  }

  // a minute with nothing happening (not while it thinks or sulks) and it nods off
  let idleTimer = 0;
  const armIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(doze, 60000); };
  function doze() {
    if (cls.contains('thinking') || cls.contains('sunk') || hiding || busy() || document.querySelector('dialog[open]')) { armIdle(); return; }
    cls.add('doze');
    say('doze');
  }
  const wake = () => { cls.remove('doze'); armIdle(); };
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, (e) => { if (!portrait.contains(e.target)) wake(); }, true);

  // poking: squashes and says something; the fifth poke in a row sends it behind the board for a while
  let pokes = 0, pokeTimer = 0;
  function poke() {
    if (hiding) return;
    if (cls.contains('doze')) { wake(); act('poked', 400); say('wake'); return; }
    act('poked', 400);
    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => { pokes = 0; }, 4000); // a pause and it forgets
    if (cls.contains('sunk')) { say('pokeSunk'); return; }
    if (cls.contains('thinking')) { say('pokeThinking'); return; }
    pokes++;
    if (pokes < 3) say('poke');
    else if (pokes < 5) say('pokeMore');
    else {
      pokes = 0; hiding = true;
      say('pokeHide');
      cls.add('duck');
      actUntil = Date.now() + 5000;
      setTimeout(() => { cls.remove('duck'); hiding = false; say('pokeBack'); }, 3000);
    }
  }
  portrait.addEventListener('click', poke);
  portrait.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); poke(); } });

  place(x);
  wanderTimer = setTimeout(wander, 2000);
  armIdle();
  return {
    portrait, bubble,
    get x() { return x; },
    get hiding() { return hiding; },
    walking: () => cls.contains('walk'),
    place, walkTo, act, pace, wake,
    thinking: (on) => cls.toggle('thinking', !!on),
    sunk: (on) => cls.toggle('sunk', !!on),
    is: (name) => cls.contains(name),
  };
}
