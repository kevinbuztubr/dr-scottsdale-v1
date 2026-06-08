/* Dr. Scottsdale shared client scripts (v1.3).
   Loaded by every page. Handles:
   1. Ask Dr. Scottsdale — full streaming chat → /api/chat → nr-website ask-dr-mata
   2. Book Consult — opens lead-capture modal → /api/lead → nrps-admin → GHL
   3. 18+ B&A age-gate — modal that gates surgical results imagery
   No external dependencies. Vanilla DOM. */

(() => {
  // Stable session id for chat logging (one per page load — same back-and-forth groups together)
  const SESSION_ID = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  // Capture page-load time for lead-form bot deterrent
  const PAGE_LOAD_TS = Date.now();

  // ────────────────────────────────────────────────────────────────────
  // Ask Dr. Scottsdale chat — streaming
  // ────────────────────────────────────────────────────────────────────

  function wireAskWidget() {
    const fab = document.querySelector('.fab-ask');
    if (!fab) return;

    const panel = document.createElement('div');
    panel.className = 'ask-panel ask-panel-chat';
    panel.id = 'ask-panel';
    panel.innerHTML = `
      <div class="head">
        <span class="avatar-s">S</span>
        <div class="who">
          <div class="name">Ask Dr. Scottsdale</div>
          <div class="tag">AI Assistant · Trained on the practice</div>
        </div>
        <button class="close" aria-label="Close">&times;</button>
      </div>
      <div class="body chat-body" id="ask-chat-body">
        <div class="msg msg-assistant">
          <div class="bubble">
            Hi — I can answer questions about Scottsdale Skinny®, Gladiator®, Magic Shot®,
            recovery, candidacy, or anything else about the practice. What's on your mind?
          </div>
        </div>
        <div class="chip-row" id="ask-chips">
          <button class="chip" data-q="What is the Scottsdale Skinny?">Scottsdale Skinny&reg;</button>
          <button class="chip" data-q="Tell me about the Gladiator male makeover.">Gladiator&reg;</button>
          <button class="chip" data-q="How does the Magic Shot work?">Magic Shot&reg;</button>
          <button class="chip" data-q="How much is a consultation with Dr. Scottsdale?">Consultation fee</button>
        </div>
      </div>
      <form class="ask-composer" id="ask-composer" autocomplete="off">
        <input type="text" id="ask-input" placeholder="Ask a question…" maxlength="1500" />
        <button type="submit" id="ask-send" aria-label="Send">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </form>
    `;
    document.body.appendChild(panel);

    const close = panel.querySelector('.close');
    const form = panel.querySelector('#ask-composer');
    const input = panel.querySelector('#ask-input');
    const body = panel.querySelector('#ask-chat-body');
    const chips = panel.querySelector('#ask-chips');

    fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      panel.classList.toggle('show');
      if (panel.classList.contains('show')) input.focus();
    });
    close.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.remove('show'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.remove('show'); });
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('show')) return;
      if (panel.contains(e.target) || fab.contains(e.target)) return;
      panel.classList.remove('show');
    });

    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-q]');
      if (!btn) return;
      input.value = btn.dataset.q;
      form.requestSubmit();
    });

    const messages = []; // {role, content}
    let streaming = false;

    function appendMsg(role, content) {
      const wrap = document.createElement('div');
      wrap.className = `msg msg-${role}`;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = content;
      wrap.appendChild(bubble);
      body.appendChild(wrap);
      body.scrollTop = body.scrollHeight;
      return bubble;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (streaming) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      // Hide preset chips after the first real question
      if (chips) chips.style.display = 'none';

      messages.push({ role: 'user', content: text });
      appendMsg('user', text);
      const assistantBubble = appendMsg('assistant', '');
      assistantBubble.classList.add('thinking');
      streaming = true;

      let assistantText = '';
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            sessionId: SESSION_ID,
            procedureSlug: 'dr-scottsdale',
            procedureName: "Dr. Scottsdale's signature procedures",
          }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`Upstream ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        assistantBubble.classList.remove('thinking');
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          assistantText += chunk;
          assistantBubble.textContent = assistantText;
          body.scrollTop = body.scrollHeight;
        }
      } catch (err) {
        assistantBubble.classList.remove('thinking');
        assistantBubble.textContent = "Sorry — I couldn't reach the assistant. Try calling (480) 914-8300 or use Book Consult below.";
      } finally {
        streaming = false;
        if (assistantText.trim()) {
          messages.push({ role: 'assistant', content: assistantText });
        }
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Book Consult lead-capture modal — submits to /api/lead → GHL
  // ────────────────────────────────────────────────────────────────────

  function wireBookWidget() {
    // v1.4 — switched from a hand-rolled lead form to an iframe of nr-website's
    // FloatingContactWidget. One source of truth for the widget across both
    // properties; any fix on Natural Results flows here automatically.
    // The iframe sets ?source=drscottsdaleaz.com so submissions stamp the right
    // GHL contact + opportunity source.
    const fab = document.querySelector('.fab-book');
    const WIDGET_SRC = 'https://naturalresultsaz.com/widget-embed?source=drscottsdaleaz.com';

    const modal = document.createElement('div');
    modal.className = 'lead-modal lead-modal-iframe';
    modal.id = 'lead-modal';
    modal.innerHTML = `
      <button class="lead-close" aria-label="Close" style="position:fixed;top:1.25rem;right:1.25rem;z-index:1001;background:rgba(14,0,31,0.9);border:1px solid rgba(212,168,83,0.4);color:var(--gold);width:2.5rem;height:2.5rem;border-radius:50%;font-size:1.25rem;cursor:pointer;">&times;</button>
      <iframe class="lead-iframe" id="lead-iframe" title="Book a consultation with Dr. Scottsdale" allow="clipboard-write" loading="lazy" style="position:fixed;inset:0;width:100vw;height:100vh;border:0;background:transparent;"></iframe>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('.lead-close');
    const iframe = modal.querySelector('#lead-iframe');

    function openModal() {
      // Set src on open so analytics fires on actual usage, not page load.
      if (!iframe.src) iframe.src = WIDGET_SRC;
      modal.classList.add('show');
      document.body.style.overflow = 'hidden';
      const askPanel = document.getElementById('ask-panel');
      if (askPanel) askPanel.classList.remove('show');
    }
    function closeModal() {
      modal.classList.remove('show');
      document.body.style.overflow = '';
    }

    if (fab) fab.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
    closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-book-cta]');
      if (!target) return;
      e.preventDefault();
      openModal();
    });

    // Listen for postMessage from the iframe (widget-ready, close, etc.)
    window.addEventListener('message', (e) => {
      // Only accept messages from the nr-website origin.
      if (!/^https:\/\/(naturalresultsaz\.com|nr-website\.vercel\.app)$/.test(e.origin)) return;
      if (e.data && e.data.type === 'widget-close') closeModal();
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // 18+ B&A age-gate
  // ────────────────────────────────────────────────────────────────────

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

  // ────────────────────────────────────────────────────────────────────
  // Boot
  // ────────────────────────────────────────────────────────────────────

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
