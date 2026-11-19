// Easter egg: the owner's own hand-drawn font. A flag in localStorage puts class "mine" on <html> (paper.css then
// puts the font first); the lobby flips it when the title is tapped 7 times in a row (lobby.js).
import { store } from './record.js';

const KEY = 'penopi.font.mine';
export const isMine = () => !!store.get(KEY, false);
const apply = () => document.documentElement.classList.toggle('mine', isMine());
apply();
export function toggleMine() { store.set(KEY, !isMine()); apply(); return isMine(); }
