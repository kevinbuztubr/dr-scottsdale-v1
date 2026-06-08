/* Dr. Scottsdale shared client scripts.
   Loaded by every page. Handles:
   1. Ask Dr. Scottsdale floating widget — opens a slide-out panel
   2. Book Consult floating widget — scrolls to #book or hops to index.html#book
   3. 18+ B&A age-gate — modal that gates surgical results imagery
   No external dependencies. Vanilla DOM. */

(() => {
  // ---------- Ask Dr. Scottsdale slide-out ----------
  function wireAskWidget() {
    const fab = document.querySelector('.fab-ask');
    if (!fab) return;

    // Build the panel once and append to <body>
    const panel = document.createElement('div');
    panel.className = 'ask-panel';
    panel.id = 'ask-panel';
    panel.innerHTML = `
      <div class="head">
        <span class="avatar-s">S</span>
        <div class="who">
          <div class="name">Ask Dr. Scottsdale</div>
          <div class="tag">AI Assistant · Coming soon</div>
        </div>
        <button class="close" aria-label="Close">&times;</button>
      </div>
      <div class="body">
        <p class="intro">
          Dr. Scottsdale's AI assistant is being trained on the practice's
          knowledge base — procedures, recovery, candidacy, the trademarked
          signature operations.
        </p>
        <div class="chip-row">
          <span class="chip">Scottsdale Skinny&reg;</span>
          <span class="chip">Gladiator&reg;</span>
          <span class="chip">Magic Shot&reg;</span>
          <span class="chip">Recovery</span>
        </div>
        <p class="intro" style="margin-bottom: 0.75rem;">
          In the meantime, the fastest path to an answer is a real
          consultation with Dr. Scottsdale or his Patient Care team.
        </p>
        <div class="cta-row">
          <a class="gold-cta" href="#book" data-book-cta>Book a Consultation</a>
          <a class="ghost-cta" href="tel:+14809148300">Call (480) 914-8300</a>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    const close = panel.querySelector('.close');
    fab.addEventListener('click', (e) => {
      // stopPropagation prevents the document-level outside-click handler from
      // immediately closing the panel on the same click. Without this, the click
      // bubbles to document, the handler sees the just-opened panel, and even
      // though fab.contains(target) should return true, some browsers fire the
      // document handler in capture order with target retargeting making the
      // contains() check unreliable. stopPropagation is the bulletproof fix.
      e.preventDefault();
      e.stopPropagation();
      panel.classList.toggle('show');
    });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.remove('show');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') panel.classList.remove('show');
    });
    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('show')) return;
      if (panel.contains(e.target) || fab.contains(e.target)) return;
      panel.classList.remove('show');
    });
  }

  // ---------- Book Consult floating button ----------
  function wireBookWidget() {
    const fab = document.querySelector('.fab-book');
    if (!fab) return;
    fab.addEventListener('click', (e) => {
      e.preventDefault();
      goToBook();
    });
    // Also wire the in-panel "Book a Consultation" CTA + any `[data-book-cta]`
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-book-cta]');
      if (!target) return;
      e.preventDefault();
      goToBook();
    });
  }

  function goToBook() {
    const onSite = document.getElementById('book');
    if (onSite) {
      onSite.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Close ask panel if open
      const panel = document.getElementById('ask-panel');
      if (panel) panel.classList.remove('show');
    } else {
      window.location.href = 'index.html#book';
    }
  }

  // ---------- 18+ B&A age-gate ----------
  function wireAgeGate() {
    const gate = document.querySelector('.age-gate');
    if (!gate) return;
    const STORAGE_KEY = 'drs_age_confirmed_v1';
    let confirmed = false;
    try { confirmed = sessionStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}
    if (confirmed) return;
    gate.classList.add('show');
    document.body.style.overflow = 'hidden';
    gate.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (!action) return;
      if (action === 'confirm') {
        try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
        gate.classList.remove('show');
        document.body.style.overflow = '';
      } else if (action === 'exit') {
        window.location.href = 'index.html';
      }
    });
  }

  // ---------- boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      wireAskWidget();
      wireBookWidget();
      wireAgeGate();
    });
  } else {
    wireAskWidget();
    wireBookWidget();
    wireAgeGate();
  }
})();
