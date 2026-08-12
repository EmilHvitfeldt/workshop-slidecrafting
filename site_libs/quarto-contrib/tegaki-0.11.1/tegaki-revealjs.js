import { TegakiEngine } from './index.mjs';
import caveat     from './caveat.mjs';
import italianno  from './italianno.mjs';
import tangerine  from './tangerine.mjs';
import parisienne from './parisienne.mjs';

const fonts = { Caveat: caveat, Italianno: italianno, Tangerine: tangerine, Parisienne: parisienne, ...(window.__tegakiUserFonts || {}) };
const registeredFonts = Object.keys(fonts);

function resolveFont(el, text) {
  // Explicit font attribute takes priority
  const explicit = el.dataset.tegakiFont;
  if (explicit) {
    const match = registeredFonts.find(f => f.toLowerCase() === explicit.toLowerCase());
    if (match) return match;
  }
  // Fall back to inherited CSS font-family
  const computedFont = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/['"]/g, '');
  return registeredFonts.find(f => f.toLowerCase() === computedFont.toLowerCase()) ?? 'Caveat';
}

function applyScale(div, revealScale) {
  const size = parseFloat(div.dataset.tegakiSize || '5.15');
  div.style.fontSize = `${size * revealScale}em`;
  div.style.transform = `scale(${1 / revealScale})`;
  div.style.transformOrigin = 'top left';
}

function initTegakiElements() {
  const initialScale = window.Reveal?.getScale() ?? 1;

  document.querySelectorAll('.tegaki-span').forEach(el => {
    const div = document.createElement('div');
    div.classList.add('tegaki-target');
    if (el.classList.contains('fragment')) {
      // 'custom' opts out of RevealJS's built-in opacity/visibility transitions,
      // letting us control visibility ourselves via the canvas content.
      div.classList.add('fragment', 'custom');
    }

    // Copy data attributes
    div.dataset.tegakiText     = el.dataset.tegakiText;
    div.dataset.tegakiFont     = el.dataset.tegakiFont || '';
    div.dataset.tegakiSize     = el.dataset.tegakiSize || '5.15';
    div.dataset.tegakiDuration = el.dataset.tegakiDuration || '0.75';

    el.replaceWith(div);

    const fontName = resolveFont(div, div.dataset.tegakiText);
    const duration = parseFloat(div.dataset.tegakiDuration);
    const bundle   = fonts[fontName] ?? fonts['Caveat'];
    if (!bundle) { console.warn(`tegaki: no bundle for font "${fontName}"`); return; }

    div.style.cssText = 'white-space: nowrap; display: block;';
    applyScale(div, initialScale);

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
    div._tegakiDuration = duration;
  });
}

function layoutTegakiOnSlide(slide) {
  slide.querySelectorAll('.tegaki-target').forEach(div => {
    const engine = div._tegakiEngine;
    if (!engine) return;
    engine._measure();
    engine._recomputeLayout();
    const alreadyShown = div.classList.contains('fragment') && div.classList.contains('visible');
    if (alreadyShown) {
      engine.seek(engine._timeline.totalDuration);
      div.style.display = 'block';
    } else {
      engine.seek(0);
    }
  });
}

// Wait for Reveal to be ready before initializing
function setup() {
  initTegakiElements();

  Reveal.on('ready', ({ currentSlide }) => layoutTegakiOnSlide(currentSlide));
  Reveal.on('slidechanged', ({ currentSlide }) => layoutTegakiOnSlide(currentSlide));
  Reveal.on('resize', ({ scale }) => {
    document.querySelectorAll('.tegaki-target').forEach(div => applyScale(div, scale));
    layoutTegakiOnSlide(Reveal.getCurrentSlide());
  });
  Reveal.on('fragmentshown', ({ fragment }) => {
    const engine = fragment._tegakiEngine;
    if (!engine) return;
    const duration = fragment._tegakiDuration;
    fragment.style.display = 'block';
    engine.update({ time: { mode: 'uncontrolled', speed: 1 / duration } });
    // Only reset to start if reverse already completed; otherwise resume from current position.
    if (engine._internalTime <= 0) {
      engine.seek(0);
    }
    engine.play();
  });

  Reveal.on('fragmenthidden', ({ fragment }) => {
    const engine = fragment._tegakiEngine;
    if (!engine) return;
    const duration = fragment._tegakiDuration;
    const totalDur = engine._timeline.totalDuration;

    // The tick has an early-return guard: if _internalTime >= totalDuration it
    // does nothing. Break out of that guard by nudging _internalTime just below
    // the end before switching to negative speed. Only needed if the forward
    // animation already completed; if it's still mid-way, keep the current position.
    if (engine._internalTime >= totalDur) {
      engine._internalTime = totalDur - 1e-6;
    }

    engine.update({
      time: {
        mode: 'uncontrolled',
        speed: -1 / duration,
        onTimeChange: (t) => {
          if (t <= 0) {
            engine.pause();
            // Do NOT call engine.seek(0) here — seek() calls _notifyTimeChange()
            // which would re-enter this callback, causing infinite recursion and
            // a stack overflow before display:none is ever reached.
            // fragmentshown calls seek(0) before playing, so this is safe.
            engine.update({ time: { mode: 'uncontrolled', speed: 1 / duration } });
            fragment.style.display = 'none';
          }
        },
      },
    });
    engine.play();
  });
}

// Module scripts run after DOMContentLoaded (after Reveal init in Quarto)
setup();
