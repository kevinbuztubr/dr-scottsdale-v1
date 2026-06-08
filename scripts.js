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
    const fab = document.querySelector('.fab-book');
    // Build the modal once and reuse
    const modal = document.createElement('div');
    modal.className = 'lead-modal';
    modal.id = 'lead-modal';
    modal.innerHTML = `
      <div class="lead-card">
        <button class="lead-close" aria-label="Close">&times;</button>
        <div class="lead-head">
          <div class="row"><span class="gold-bar"></span><span class="eyebrow">Book a Consultation</span><span class="gold-bar"></span></div>
          <h3>Get on Dr. Scottsdale's calendar</h3>
          <p>Tell us a bit about you. Dr. Scottsdale's team will reach out — virtual ($300), in-person ($500), or a free Patient Care Coordinator orientation.</p>
        </div>
        <form class="lead-form" id="lead-form" autocomplete="on">
          <div class="row-2">
            <label>First Name<input name="firstName" required maxlength="60" autocomplete="given-name" /></label>
            <label>Last Name<input name="lastName" required maxlength="60" autocomplete="family-name" /></label>
          </div>
          <label>Email<input name="email" type="email" required maxlength="120" autocomplete="email" /></label>
          <label>Phone<input name="phone" type="tel" required maxlength="30" autocomplete="tel" /></label>
          <label>What are you interested in?<textarea name="message" rows="3" maxlength="1000" placeholder="Scottsdale Skinny, Gladiator, Magic Shot, recovery questions, etc."></textarea></label>
          <label class="row" style="font-size:0.8125rem;color:rgba(245,240,230,0.7);"><input type="checkbox" name="agree" required style="margin-right:0.5rem;width:auto;" />I agree to be contacted by Dr. Scottsdale's team about my inquiry.</label>
          <!-- honeypot: hidden field that bots will fill in. Humans never see it. -->
          <input type="text" name="company_website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" aria-hidden="true" />
          <div class="lead-actions">
            <button type="submit" class="btn-gold lead-submit">Request Consultation
              <svg class="btn-arrow" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
            <a href="tel:+14809148300" class="btn-ghost">Call (480) 914-8300</a>
          </div>
          <div class="lead-status" id="lead-status" aria-live="polite"></div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('.lead-close');
    const form = modal.querySelector('#lead-form');
    const status = modal.querySelector('#lead-status');

    function openModal() {
      modal.classList.add('show');
      document.body.style.overflow = 'hidden';
      const askPanel = document.getElementById('ask-panel');
      if (askPanel) askPanel.classList.remove('show');
      setTimeout(() => modal.querySelector('input[name=firstName]')?.focus(), 100);
    }
    function closeModal() {
      modal.classList.remove('show');
      document.body.style.overflow = '';
    }

    if (fab) fab.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-book-cta]');
      if (!target) return;
      e.preventDefault();
      openModal();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      status.textContent = '';

      const payload = {
        contact: {
          firstName: String(fd.get('firstName') || '').trim(),
          lastName: String(fd.get('lastName') || '').trim(),
          email: String(fd.get('email') || '').trim(),
          phone: String(fd.get('phone') || '').trim(),
        },
        message: String(fd.get('message') || '').trim(),
        leadSourceUrl: window.location.href,
        action: 'Book Appointment',
        provider: 'dr-mata',
        selections: ['dr-scottsdale-consult'],
        company_website: fd.get('company_website') || '',
        _tStart: PAGE_LOAD_TS,
      };

      // Minimal client-side validation (also enforced server + admin)
      const c = payload.contact;
      if (!c.firstName || !c.lastName || !c.email || !c.phone) {
        status.textContent = 'Please fill in all required fields.';
        status.className = 'lead-status lead-status-err';
        return;
      }

      const submitBtn = form.querySelector('.lead-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      try {
        const res = await fetch('/api/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        let body = null;
        try { body = await res.json(); } catch (_) {}
        if (res.ok) {
          status.textContent = "Got it. Dr. Scottsdale's team will reach out shortly.";
          status.className = 'lead-status lead-status-ok';
          form.querySelectorAll('input, textarea').forEach((el) => {
            if (el.type !== 'checkbox') el.value = '';
            else el.checked = false;
          });
          setTimeout(() => closeModal(), 2500);
        } else {
          status.textContent = body?.error || `Submission failed (${res.status}). Please call (480) 914-8300.`;
          status.className = 'lead-status lead-status-err';
        }
      } catch (err) {
        status.textContent = 'Network error. Please call (480) 914-8300.';
        status.className = 'lead-status lead-status-err';
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Request Consultation <svg class="btn-arrow" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" stroke-width="1.5"/></svg>';
      }
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
