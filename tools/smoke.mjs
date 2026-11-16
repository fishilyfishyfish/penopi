// Automatic check of the built site in Chromium: the lobby lists every game, and in each game I pick a side
// and play by tapping the board (random legal moves) while Penopi answers, until the game ends or a move cap.
// Fails on any page error, an engine answer slower than the cap, or a game that stops moving.
//   node tools/smoke.mjs [moves per game = 40] [screenshot folder]
// PHONE=4 node tools/smoke.mjs 8: the same with the page's CPU slowed 4 times, reporting for each game how long
// the page took to be ready and the longest stretch the page itself was busy (a frozen screen) while playing.
// Needs the WASM built (tools/build-wasm.sh) and playwright (npm i playwright, or the one on this machine).
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOVES = Number(process.argv[2] || 40), SHOTS = process.argv[3] || '';
const ENGINE_CAP = { backgammon: 9000, oware: 9000, reversi: 9000, dots: 12000, go: 9000, gomoku: 9000, morris: 9000, breakthrough: 9000, draughts: 9000, chess: 9000, janggi: 9000, yukgak: 9000, morris6: 9000, morris12: 9000, shogi: 9000 }; // ms from my move to my next turn, generous for CI

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
let failed = false;
const fail = (msg) => { failed = true; console.log('FAIL', msg); };

const PHONE = Number(process.env.PHONE || 0);
async function page(url) {
  const p = await browser.newPage({ viewport: { width: 400, height: 860 } });
  if (PHONE) {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: PHONE });
    // (only the page is slowed: workers think for a fixed time anyway, so a slow phone costs them depth, not time)
    await p.addInitScript(() => {
      globalThis.__long = { max: 0, total: 0, n: 0 };
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { const L = globalThis.__long; L.max = Math.max(L.max, e.duration); L.total += e.duration; L.n++; } }).observe({ entryTypes: ['longtask'] });
    });
  }
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e.stack || e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await p.goto(url);
  return { p, errors };
}
const dbg = (p) => p.evaluate(() => globalThis.__penopi.debug());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(p, cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return Date.now() - t0; await sleep(100); }
  return -1;
}

// ---------- lobby ----------
{
  const { p, errors } = await page(base);
  await p.waitForSelector('.card');
  const n = await p.$$eval('.card', (els) => els.length);
  const games = fs.readFileSync(path.join(root, 'games.js'), 'utf8').match(/^\s*\{ id: '/gm).length; // a commented-out line is a game hidden for now
  if (n !== games) fail(`lobby shows ${n} cards, games.js has ${games}`);
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'lobby.png') });
  if (errors.length) fail('lobby: ' + errors.join(' | '));
  console.log(`lobby: ${n} games`);
  await p.close();
}

// ---------- how long a line about a move stays up (shared/shell.js, tools/bubble-test.html) ----------
{
  const { p, errors } = await page(base + 'tools/bubble-test.html');
  const r = await p.waitForFunction(() => window.__result).then((h) => h.jsonValue());
  if (!r.ok) fail('bubble: ' + r.log.map(([what, got]) => `${what} → "${got}"`).join(', '));
  if (errors.length) fail('bubble: ' + errors.join(' | '));
  console.log(`bubble: ${r.ok ? 'move lines expire on time' : 'WRONG'}`);
  await p.close();
}

// ---------- board games: tap squares ----------
async function boardGame(id, sideIdx) {
  const { p, errors } = await page(base + id + '/');
  await p.waitForTimeout(800);
  await p.click(`[data-side="${sideIdx}"]`);
  const sq = (i) => p.locator('#board button').nth(i);
  let mine = 0, slowest = 0;
  for (let k = 0; k < MOVES * 2; k++) {
    const turn = await waitFor(p, async () => { const d = await dbg(p); return d.over || (d.legal.length && ('stm' in d ? d.stm === d.human : d.side === d.human)); }, ENGINE_CAP[id] + 3000);
    if (turn < 0) { fail(`${id}: no turn for me after ${ENGINE_CAP[id] + 3000} ms`); break; }
    if (k > 0) slowest = Math.max(slowest, turn);
    const d = await dbg(p);
    if (d.over || mine >= MOVES) break;
    if (id === 'go') { // moves: the point 0..80; the intersections are the board's only buttons
      await sq(d.legal[Math.floor(Math.random() * d.legal.length)]).click();
    } else if (id === 'dots') { // moves: the line; the gap buttons are the board's only buttons, in line order
      await sq(d.legal[Math.floor(Math.random() * d.legal.length)]).click();
    } else if (id === 'reversi') { // moves: the square 0..63 (a8 = 0), the board's buttons in square order
      await sq(d.legal[Math.floor(Math.random() * d.legal.length)]).click();
    } else if (id === 'oware') { // moves: the pit (0–11); the pits are the board's only buttons, in pit order
      await sq(d.legal[Math.floor(Math.random() * d.legal.length)]).click();
    } else if (id === 'morris' || id === 'morris6' || id === 'morris12') { // moves: (from + 1) | to << 5 | (removed + 1) << 10; tap from (if any), to, removed (if any)
      const m = d.legal[Math.floor(Math.random() * d.legal.length)], f = (m & 31) - 1, t = (m >> 5) & 31, r = ((m >> 10) & 31) - 1;
      if (f >= 0) await sq(f).click();
      await sq(t).click();
      if (r >= 0) await sq(r).click();
    } else if (id === 'yukgak') { // tap a cell twice (pale stone, then play); the cells are the board's only buttons, in cell order
      const s = d.legal[Math.floor(Math.random() * d.legal.length)];
      await sq(s).click(); await sq(s).click();
    } else if (id === 'gomoku') { // tap a point twice: the first puts a pale stone, the second plays it
      const s = d.legal[Math.floor(Math.random() * d.legal.length)];
      await sq(d.cells[s]).click(); await sq(d.cells[s]).click();
    } else if (id === 'chess') { // moves: from | to << 7 (0x88 squares), promotion piece << 14
      const m = d.legal[Math.floor(Math.random() * d.legal.length)];
      await sq(d.cells[m & 127]).click();
      await sq(d.cells[(m >> 7) & 127]).click();
      if ((await dbg(p)).promo) await p.click(`#tray [data-promo="${(m >> 14) & 7}"]`);
    } else if (id === 'janggi') { // moves: from | to << 7 (points rank*9+file); d.cells maps a point to its button
      const m = d.legal[Math.floor(Math.random() * d.legal.length)];
      await sq(d.cells[m & 127]).click();
      await sq(d.cells[(m >> 7) & 127]).click();
    } else if (id === 'shogi') { // moves: from | to << 7 | promotion << 14 (a drop: from = 81 + the piece type); d.cells maps a point to its button, d.slots a hand piece to its button
      const m = d.legal[Math.floor(Math.random() * d.legal.length)], from = m & 127;
      await sq(from > 81 ? d.slots[from - 81] : d.cells[from]).click();
      await sq(d.cells[(m >> 7) & 127]).click();
      if ((await dbg(p)).promo) await p.click(`#tray [data-promo="${(m >> 14) & 1}"]`);
    } else if (id === 'draughts') { // moves: {from, to, path}; tap the piece, the squares on the way, the end
      const m = d.legal[Math.floor(Math.random() * d.legal.length)];
      await sq(d.cells[m.from]).click();
      for (const l of m.path) {
        if ((await dbg(p)).plies > d.plies) break; // already played (the route was clear)
        await sq(d.cells[l]).click();
      }
    } else if (id === 'breakthrough') { // moves: from | to << 6; a game with a turned board gives d.cells
      const m = d.legal[Math.floor(Math.random() * d.legal.length)], cell = (s) => (d.cells ? d.cells[s] : s);
      await sq(cell(m & 63)).click();
      await sq(cell((m >> 6) & 63)).click();
    } else {
      const i = 3 * Math.floor(Math.random() * (d.legal.length / 3));
      const [f, t, a] = d.legal.slice(i, i + 3);
      await sq(d.cells[f]).click();
      await sq(d.cells[t]).click();
      if (k === 1 && SHOTS) await p.screenshot({ path: path.join(SHOTS, `${id}-aiming.png`) });
      await sq(d.cells[a]).click();
    }
    mine++;
    await waitFor(p, async () => { const e = await dbg(p); return e.over || (e.plies > d.plies && ('stm' in e ? e.stm : e.side) !== d.human); }, 3000);
  }
  if (slowest > ENGINE_CAP[id]) fail(`${id}: Penopi took ${slowest} ms`);
  const d = await dbg(p);
  if (PHONE) {
    const L = await p.evaluate(() => ({ ...globalThis.__long, ready: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd) }));
    console.log(`  phone ×${PHONE} ${id}: ready ${L.ready} ms, page busy at most ${Math.round(L.max)} ms (${L.n} long tasks, ${Math.round(L.total)} ms in all)`);
  }
  console.log(`${id}: ${mine} moves of mine, ${d.plies} plies, over=${d.over}, slowest reply ${slowest} ms, says "${await p.textContent('.bubble')}"`);
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${id}.png`) });
  if (errors.length) fail(`${id}: ` + errors.join(' | '));
  await p.close();
}

// ---------- backgammon: buttons and checkers ----------
async function backgammon(sideIdx) {
  const { p, errors } = await page(base + 'backgammon/');
  await p.waitForTimeout(800);
  await p.click(`[data-side="${sideIdx}"]`);
  let turns = 0, idle = 0, lastTurns = -1;
  for (let k = 0; k < MOVES * 12; k++) {
    const d = await dbg(p);
    if (d.phase === 'over' || turns >= MOVES) break;
    if (d.turns !== lastTurns) { lastTurns = d.turns; idle = 0; } else if (++idle > 120) { fail(`backgammon: stuck in ${d.phase}`); break; }
    const acts = await p.evaluate(() => [...document.querySelectorAll('#tray [data-act]:not([disabled])')].map((e) => e.dataset.act));
    if (acts.includes('roll')) { await p.click('#tray [data-act="roll"]'); turns++; }
    else if (acts.includes('take')) await p.click('#tray [data-act="take"]');
    else if (acts.includes('next')) await p.click('#tray [data-act="next"]');
    else if (acts.includes('done')) await p.click('#tray [data-act="done"]');
    else {
      const hits = await p.$$('rect.hit[tabindex="0"][data-point]');
      if (hits.length) await hits[Math.floor(Math.random() * hits.length)].click({ force: true }).catch(() => {});
    }
    if (k === 8 && SHOTS) await p.screenshot({ path: path.join(SHOTS, 'backgammon-moving.png') });
    await sleep(250);
  }
  const d = await dbg(p);
  console.log(`backgammon: ${d.turns} turns, phase ${d.phase}, cube ${d.cube.value}, says "${await p.textContent('.bubble')}"`);
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'backgammon.png') });
  if (errors.length) fail('backgammon: ' + errors.join(' | '));
  await p.close();
}

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // ONLY=chess,go: just those games
if (!ONLY || ONLY.includes('breakthrough')) await boardGame('breakthrough', 1);
if (!ONLY || ONLY.includes('draughts')) await boardGame('draughts', 1);
if (!ONLY || ONLY.includes('chess')) await boardGame('chess', 1);
if (!ONLY || ONLY.includes('gomoku')) await boardGame('gomoku', 1);
if (!ONLY || ONLY.includes('morris')) await boardGame('morris', 1);
if (!ONLY || ONLY.includes('morris6')) await boardGame('morris6', 1);
if (!ONLY || ONLY.includes('morris12')) await boardGame('morris12', 0);
if (!ONLY || ONLY.includes('oware')) await boardGame('oware', 1);
if (!ONLY || ONLY.includes('reversi')) await boardGame('reversi', 1);
if (!ONLY || ONLY.includes('dots')) await boardGame('dots', 1);
if (!ONLY || ONLY.includes('go')) await boardGame('go', 1);
if (!ONLY || ONLY.includes('janggi')) await boardGame('janggi', 1);
if (!ONLY || ONLY.includes('janggi')) await boardGame('janggi', 0);
if (!ONLY || ONLY.includes('shogi')) await boardGame('shogi', 1);
if (!ONLY || ONLY.includes('shogi')) await boardGame('shogi', 0);
if (!ONLY || ONLY.includes('yukgak')) await boardGame('yukgak', 1);
if (!ONLY || ONLY.includes('yukgak')) await boardGame('yukgak', 0);
if (!ONLY || ONLY.includes('backgammon')) await backgammon(1);
await browser.close();
server.close();
if (failed) process.exit(1);
console.log('ok');
