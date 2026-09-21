/* Verso · Web Translator — site interactions */

(function () {
  'use strict';

  /* ---------- 1. Sticky nav scroll state ---------- */
  const nav = document.getElementById('nav');
  let ticking = false;
  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 8);
        ticking = false;
      });
      ticking = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 2. Hero title word rise (staggered) ---------- */
  function wrapHeroWords() {
    const lines = document.querySelectorAll('.hero__line');
    if (!lines.length) return;
    lines.forEach((line) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, null, false);
      const texts = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.trim()) texts.push(node);
      }
      texts.forEach((text) => {
        const frag = document.createDocumentFragment();
        const parts = text.textContent.split(/(\s+)/);
        parts.forEach((part) => {
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(part));
          } else if (part) {
            const span = document.createElement('span');
            span.className = 'word-rise';
            span.textContent = part;
            frag.appendChild(span);
          }
        });
        text.parentNode.replaceChild(frag, text);
      });
    });
    let idx = 0;
    document.querySelectorAll('.word-rise').forEach((w) => {
      w.style.animationDelay = `${0.4 + idx * 0.045}s`;
      idx++;
    });
  }
  wrapHeroWords();

  /* ---------- 2b. Bilingual toggle in demo ---------- */
  const demoPage = document.getElementById('demoPage');
  const chips = document.querySelectorAll('.demo__bar .chip');
  if (demoPage && chips.length) {
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => {
          c.classList.remove('is-active');
          c.setAttribute('aria-selected', 'false');
        });
        chip.classList.add('is-active');
        chip.setAttribute('aria-selected', 'true');
        demoPage.setAttribute('data-mode', chip.dataset.mode);
      });
    });
  }

  /* ---------- 3. Manuscript phrase → margin note ---------- */
  const phrases = document.querySelectorAll('.manuscript__body .phrase');
  const notes = document.querySelectorAll('.manuscript__margin .margin-note');
  function bindPair(phrase, note) {
    if (!phrase || !note) return;
    const enter = () => {
      if (phrase.classList.contains('is-in')) note.classList.add('is-active');
    };
    const leave = () => note.classList.remove('is-active');
    phrase.addEventListener('mouseenter', enter);
    phrase.addEventListener('mouseleave', leave);
    phrase.addEventListener('focus', enter);
    phrase.addEventListener('blur', leave);
  }
  phrases.forEach((p, i) => bindPair(p, notes[i]));

  /* ---------- 3b. Manuscript typewriter + scan loop ---------- */
  (function animateManuscript() {
    const manuscript = document.querySelector('.manuscript');
    const phrases = document.querySelectorAll('.manuscript__body .phrase');
    const notes = document.querySelectorAll('.manuscript__margin .margin-note');
    if (!manuscript || !phrases.length) return;

    const scanLine = document.createElement('div');
    scanLine.className = 'scan-line';
    scanLine.setAttribute('aria-hidden', 'true');
    manuscript.appendChild(scanLine);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      phrases.forEach((p) => p.classList.add('is-in'));
      notes.forEach((n) => n.classList.add('is-in'));
      return;
    }

    const PHRASE_GAP = 750;
    const NOTE_DELAY = 280;
    const HOLD = 2200;
    const PAUSE = 400;

    function reset() {
      phrases.forEach((p) => p.classList.remove('is-in'));
      notes.forEach((n) => n.classList.remove('is-in'));
      manuscript.classList.remove('is-complete');
    }

    function animateScan() {
      let start = null;
      const duration = 1300;
      function frame(ts) {
        if (start === null) start = ts;
        const t = (ts - start) / duration;
        if (t < 1) {
          scanLine.style.left = (-10 + t * 120) + '%';
          scanLine.style.opacity = t < 0.2
            ? t * 5
            : Math.max(0, 1 - (t - 0.2) / 0.6);
          requestAnimationFrame(frame);
        } else {
          scanLine.style.opacity = 0;
          scanLine.style.left = '-10%';
        }
      }
      requestAnimationFrame(frame);
    }

    function run(cycleIdx) {
      const initialDelay = cycleIdx === 0 ? 900 : 0;
      setTimeout(() => {
        phrases.forEach((p, i) => {
          setTimeout(() => {
            p.classList.add('is-in');
            setTimeout(() => {
              if (notes[i]) notes[i].classList.add('is-in');
            }, NOTE_DELAY);
          }, i * PHRASE_GAP);
        });
        setTimeout(() => {
          manuscript.classList.add('is-complete');
          animateScan();
        }, phrases.length * PHRASE_GAP);
      }, initialDelay);

      setTimeout(() => {
        reset();
        setTimeout(() => run(cycleIdx + 1), PAUSE);
      }, initialDelay + phrases.length * PHRASE_GAP + HOLD);
    }

    run(0);
  })();

  /* ---------- 4. Copy-to-clipboard ---------- */
  document.querySelectorAll('.copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy || '';
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch (_) { /* fall through */ }
      if (!ok) {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          ok = true;
        } catch (_) { ok = false; }
      }
      const original = btn.dataset.label || btn.textContent;
      btn.dataset.label = original;
      btn.textContent = ok ? '已复制 ✓' : '复制失败';
      btn.classList.toggle('is-copied', ok);
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('is-copied');
      }, 1600);
    });
  });

  /* ---------- 5. Scroll reveal ---------- */
  if ('IntersectionObserver' in window) {
    const targets = document.querySelectorAll(
      '.section__head, .feature, .step, .faq__item, .demo__wrap, .install__cta'
    );
    targets.forEach((el) => el.classList.add('reveal'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    targets.forEach((el) => io.observe(el));
  }

  /* ---------- 6. Smooth in-page anchors with offset ---------- */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
})();