import { TegakiEngine } from './index.mjs';
import caveat     from './caveat.mjs';
import italianno  from './italianno.mjs';
import tangerine  from './tangerine.mjs';
import parisienne from './parisienne.mjs';

const fonts = { Caveat: caveat, Italianno: italianno, Tangerine: tangerine, Parisienne: parisienne, ...(window.__tegakiUserFonts || {}) };
const registeredFonts = Object.keys(fonts);

function resolveFont(el) {
  const explicit = el.dataset.tegakiFont;
  if (explicit) {
    const match = registeredFonts.find(f => f.toLowerCase() === explicit.toLowerCase());
    if (match) return match;
  }
  const computedFont = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/['"]/g, '');
  return registeredFonts.find(f => f.toLowerCase() === computedFont.toLowerCase()) ?? 'Caveat';
}

document.querySelectorAll('.tegaki-span').forEach(el => {
  const div = document.createElement('div');
  div.classList.add('tegaki-target');

  div.dataset.tegakiText     = el.dataset.tegakiText;
  div.dataset.tegakiFont     = el.dataset.tegakiFont || '';
  div.dataset.tegakiSize     = el.dataset.tegakiSize || '5.15';
  div.dataset.tegakiDuration = el.dataset.tegakiDuration || '0.75';

  div.style.cssText = 'white-space: nowrap; display: inline-block;';
  el.replaceWith(div);

  const fontName = resolveFont(div);
  const duration = parseFloat(div.dataset.tegakiDuration);
  const size     = parseFloat(div.dataset.tegakiSize);
  const bundle   = fonts[fontName] ?? fonts['Caveat'];
  if (!bundle) { console.warn(`tegaki: no bundle for font "${fontName}"`); return; }

  div.style.fontSize = `${size}em`;

  const engine = new TegakiEngine(div, {
    text: div.dataset.tegakiText,
    font: bundle,
    time: { mode: 'uncontrolled', speed: 1 / duration },
  });

  engine.pause();
  engine.seek(0);

  const overlay = div.querySelector('[data-tegaki="overlay"]');
  if (overlay) overlay.style.setProperty('white-space', 'nowrap', 'important');

  div._tegakiEngine = engine;

  // Trigger animation once when element first scrolls into view
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          engine.seek(0);
          engine.play();
          observer.unobserve(div);
        }
      });
    },
    { threshold: 0.5 }
  );

  observer.observe(div);
});
