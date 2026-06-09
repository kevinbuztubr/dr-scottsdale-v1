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
    // v1.5 — vanilla JS widget mirroring Natural Results UX (NOT iframed from it).
    // Single floating button → menu with 4 actions:
    //   1. Book a Consultation (full form)
    //   2. Get an Instant Quote (procedure picker + contact form)
    //   3. Text Us (composer — name/phone/message)
    //   4. Call Us (tel: handoff)
    //
    // All form submits POST to /api/lead which relays through nr-website's
    // /api/widget-relay → nrps-admin → GHL. siteSource is stamped server-side
    // to "drscottsdaleaz.com" so leads are attributed to the Dr. Scottsdale
    // property without any client-side trust.
    //
    // Why not iframe Natural Results' widget: simpler, fewer moving parts,
    // no cross-origin CSP friction, and dr-scottsdale-v1 stays self-contained.

    const fab = document.querySelector('.fab-book');

    // Quick procedure-card list for Instant Quote (curated, doesn't need
    // the full Natural Results services catalog since this is a brand site
    // not a procedure-catalog site).
    const QUICK_PROCEDURES = [
      { id: 'scottsdale-skinny', label: 'Scottsdale Skinny®', desc: 'Full-body lipo 360 + fat transfer + muscle etching' },
      { id: 'gladiator', label: 'Gladiator® Male Makeover', desc: 'High-def male sculpting + enhancement' },
      { id: 'magic-shot', label: 'Magic Shot®', desc: 'Non-surgical male enhancement injectable' },
      { id: 'breast-augmentation', label: 'Breast Augmentation', desc: 'Implants — silicone or saline' },
      { id: 'mommy-makeover', label: 'Mommy Makeover', desc: 'Tummy tuck + breast surgery combo' },
      { id: 'rhinoplasty', label: 'Rhinoplasty', desc: 'Nose reshaping' },
      { id: 'facelift', label: 'Facelift', desc: 'Mid-face / lower-face rejuvenation' },
      { id: 'other', label: 'Something else', desc: "We'll cover it on the consult" },
    ];

    const modal = document.createElement('div');
    modal.className = 'lead-modal';
    modal.id = 'lead-modal';
    modal.innerHTML = `
      <div class="lead-card lead-card-menu">
        <button class="lead-close" aria-label="Close">&times;</button>
        <div class="lead-step" data-step="menu" data-active="true">
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">How can we help?</span><span class="gold-bar"></span></div>
            <h3>Get started with Dr. Scottsdale</h3>
            <p>Pick the path that fits — every option lands with Dr. Scottsdale's team.</p>
          </div>
          <div class="lead-menu">
            <button class="lead-menu-row" data-go="instant-quote">
              <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 12v6"/><path d="M9 15h6"/></svg></span>
              <span class="txt"><span class="label">Instant Quote</span><span class="sub">Get a procedure-specific estimate</span></span>
              <span class="chev">›</span>
            </button>
            <button class="lead-menu-row primary" data-go="book-consult">
              <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
              <span class="txt"><span class="label">Book a Consultation</span><span class="sub">Virtual ($300), in-person ($500), or free PCC</span></span>
              <span class="chev">›</span>
            </button>
            <button class="lead-menu-row" data-go="text-us">
              <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span>
              <span class="txt"><span class="label">Text Us</span><span class="sub">Quick question? Send a message</span></span>
              <span class="chev">›</span>
            </button>
            <a class="lead-menu-row" href="tel:+14809148300">
              <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></span>
              <span class="txt"><span class="label">Call (480) 914-8300</span><span class="sub">Mon–Fri 9–5 Arizona time</span></span>
              <span class="chev">›</span>
            </a>
          </div>
        </div>

        <!-- Instant Quote step 1: pick procedure -->
        <div class="lead-step" data-step="instant-quote">
          <button class="lead-back" data-back="menu">‹ Back</button>
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">Step 1 of 2 · Procedure</span></div>
            <h3>What are you most interested in?</h3>
            <p>Pick the procedure closest to what you have in mind. You can refine on the consult.</p>
          </div>
          <div class="lead-procedures" id="lead-procedures">
            ${QUICK_PROCEDURES.map(p => `
              <button class="lead-proc-row" data-proc="${p.id}" data-label="${p.label}">
                <span class="lead-proc-label">${p.label}</span>
                <span class="lead-proc-desc">${p.desc}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Instant Quote step 2: contact -->
        <div class="lead-step" data-step="iq-contact">
          <button class="lead-back" data-back="instant-quote">‹ Back</button>
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">Step 2 of 2 · Your info</span></div>
            <h3>Where should Dr. Scottsdale's team reach you?</h3>
            <p id="iq-selected-proc">Selected: <em></em></p>
          </div>
          <form class="lead-form" id="iq-form" autocomplete="on">
            <div class="row-2">
              <label>First Name<input name="firstName" required maxlength="60" autocomplete="given-name" /></label>
              <label>Last Name<input name="lastName" required maxlength="60" autocomplete="family-name" /></label>
            </div>
            <label>Email<input name="email" type="email" required maxlength="120" autocomplete="email" /></label>
            <label>Phone<input name="phone" type="tel" required maxlength="30" autocomplete="tel" /></label>
            <label class="row" style="font-size:0.8125rem;color:rgba(245,240,230,0.7);"><input type="checkbox" name="agree" required style="margin-right:0.5rem;width:auto;" />I agree to be contacted by Dr. Scottsdale's team.</label>
            <input type="text" name="company_website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;top:-9999px;width:1px;opacity:0;pointer-events:none;" aria-hidden="true" />
            <div class="lead-actions">
              <button type="submit" class="btn-gold lead-submit">Send My Quote Request<svg class="btn-arrow" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" stroke-width="1.5"/></svg></button>
            </div>
            <div class="lead-status" aria-live="polite"></div>
          </form>
        </div>

        <!-- Book Consult (single-step contact form) -->
        <div class="lead-step" data-step="book-consult">
          <button class="lead-back" data-back="menu">‹ Back</button>
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">Book a Consultation</span></div>
            <h3>Tell us a bit about you</h3>
            <p>Dr. Scottsdale's team will reach out within one business day to schedule.</p>
          </div>
          <form class="lead-form" id="bc-form" autocomplete="on">
            <div class="row-2">
              <label>First Name<input name="firstName" required maxlength="60" autocomplete="given-name" /></label>
              <label>Last Name<input name="lastName" required maxlength="60" autocomplete="family-name" /></label>
            </div>
            <label>Email<input name="email" type="email" required maxlength="120" autocomplete="email" /></label>
            <label>Phone<input name="phone" type="tel" required maxlength="30" autocomplete="tel" /></label>
            <label>What are you interested in?<textarea name="message" rows="3" maxlength="1000" placeholder="Scottsdale Skinny®, Gladiator®, Magic Shot®, recovery questions, timeline, etc."></textarea></label>
            <label class="row" style="font-size:0.8125rem;color:rgba(245,240,230,0.7);"><input type="checkbox" name="agree" required style="margin-right:0.5rem;width:auto;" />I agree to be contacted by Dr. Scottsdale's team.</label>
            <input type="text" name="company_website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;top:-9999px;width:1px;opacity:0;pointer-events:none;" aria-hidden="true" />
            <div class="lead-actions">
              <button type="submit" class="btn-gold lead-submit">Request Consultation<svg class="btn-arrow" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" stroke-width="1.5"/></svg></button>
            </div>
            <div class="lead-status" aria-live="polite"></div>
          </form>
        </div>

        <!-- Text Us composer -->
        <div class="lead-step" data-step="text-us">
          <button class="lead-back" data-back="menu">‹ Back</button>
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">Text Us</span></div>
            <h3>Send Dr. Scottsdale's team a message</h3>
            <p>Replies come back to your phone as a real text from (480) 914-8300.</p>
          </div>
          <form class="lead-form" id="tx-form" autocomplete="on">
            <div class="row-2">
              <label>First Name<input name="firstName" required maxlength="60" autocomplete="given-name" /></label>
              <label>Last Name (optional)<input name="lastName" maxlength="60" autocomplete="family-name" /></label>
            </div>
            <label>Phone<input name="phone" type="tel" required maxlength="30" autocomplete="tel" /></label>
            <label>Message<textarea name="message" rows="4" required maxlength="1000" placeholder="What's your question?"></textarea></label>
            <input type="text" name="company_website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;top:-9999px;width:1px;opacity:0;pointer-events:none;" aria-hidden="true" />
            <div class="lead-actions">
              <button type="submit" class="btn-gold lead-submit">Send Message<svg class="btn-arrow" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" stroke-width="1.5"/></svg></button>
            </div>
            <div class="lead-status" aria-live="polite"></div>
          </form>
        </div>

        <!-- Confirmation -->
        <div class="lead-step" data-step="thanks">
          <div class="lead-head" style="text-align:center;">
            <div style="display:inline-flex;align-items:center;justify-content:center;width:4rem;height:4rem;border-radius:50%;background:rgba(212,168,83,0.15);border:1px solid var(--gold);margin-bottom:1.25rem;color:var(--gold);font-size:1.75rem;">✓</div>
            <h3 id="thanks-title">Got it.</h3>
            <p id="thanks-body">Dr. Scottsdale's team will reach out shortly. Keep an eye on your phone.</p>
            <div style="margin-top:1.5rem;">
              <button class="btn-ghost lead-done" type="button">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const card = modal.querySelector('.lead-card');
    const closeBtn = modal.querySelector('.lead-close');
    let currentStep = 'menu';
    let selectedProc = null;

    function showStep(step) {
      currentStep = step;
      modal.querySelectorAll('.lead-step').forEach(el => {
        el.dataset.active = el.dataset.step === step ? 'true' : 'false';
      });
      card.scrollTop = 0;
    }

    // v1.6 — corner-pop widget. NO body scroll lock and NO full-page backdrop.
    // The panel anchors next to the .fab-book pill in the bottom-right corner
    // and never takes over the page; clicking outside it (anywhere that isn't
    // the panel or the pill) closes it, matching the NRPS UX.
    function openModal() {
      modal.classList.add('show');
      showStep('menu');
      const askPanel = document.getElementById('ask-panel');
      if (askPanel) askPanel.classList.remove('show');
    }
    function closeModal() {
      modal.classList.remove('show');
    }

    if (fab) fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (modal.classList.contains('show')) closeModal(); else openModal();
    });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('show')) closeModal(); });
    // Outside-click handler — since the panel no longer has a covering backdrop,
    // we close on any click that isn't inside the panel or on the FAB pill.
    document.addEventListener('click', (e) => {
      if (!modal.classList.contains('show')) return;
      if (modal.contains(e.target)) return;
      if (fab && fab.contains(e.target)) return;
      // Also ignore clicks on the [data-book-cta] CTA buttons — those open it.
      if (e.target.closest && e.target.closest('[data-book-cta]')) return;
      closeModal();
    });
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-book-cta]');
      if (!target) return;
      e.preventDefault();
      openModal();
    });

    // Menu navigation
    modal.addEventListener('click', (e) => {
      const goTarget = e.target.closest('[data-go]');
      if (goTarget) { showStep(goTarget.dataset.go); return; }
      const backTarget = e.target.closest('[data-back]');
      if (backTarget) { showStep(backTarget.dataset.back); return; }
      const procRow = e.target.closest('[data-proc]');
      if (procRow) {
        selectedProc = { id: procRow.dataset.proc, label: procRow.dataset.label };
        modal.querySelector('#iq-selected-proc em').textContent = selectedProc.label;
        showStep('iq-contact');
      }
      const done = e.target.closest('.lead-done');
      if (done) closeModal();
    });

    async function submitForm(form, action, extras = {}) {
      const fd = new FormData(form);
      const status = form.querySelector('.lead-status');
      status.textContent = '';
      status.className = 'lead-status';
      const payload = {
        contact: {
          firstName: String(fd.get('firstName') || '').trim(),
          lastName: String(fd.get('lastName') || '(none)').trim() || '(none)',
          email: String(fd.get('email') || '').trim() || undefined,
          phone: String(fd.get('phone') || '').trim(),
        },
        message: String(fd.get('message') || '').trim() || undefined,
        leadSourceUrl: window.location.href,
        action,
        provider: 'dr-mata',
        selections: extras.selections || ['dr-scottsdale-consult'],
        company_website: fd.get('company_website') || '',
        _tStart: PAGE_LOAD_TS,
        ...extras.extra,
      };
      if (!payload.contact.firstName || !payload.contact.phone) {
        status.textContent = 'Please fill in all required fields.';
        status.classList.add('lead-status-err');
        return false;
      }
      const submitBtn = form.querySelector('.lead-submit');
      const originalLabel = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      try {
        const res = await fetch('/api/lead', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        let body = null; try { body = await res.json(); } catch (_) {}
        if (res.ok) {
          // Reset form, show thanks step
          form.querySelectorAll('input, textarea').forEach((el) => {
            if (el.type !== 'checkbox') el.value = '';
            else el.checked = false;
          });
          const isText = action === 'Text Us';
          modal.querySelector('#thanks-title').textContent = isText ? 'Message sent.' : 'Got it.';
          modal.querySelector('#thanks-body').textContent = isText
            ? "Dr. Scottsdale's team will text you back from (480) 914-8300 — keep an eye on your phone."
            : "Dr. Scottsdale's team will reach out within one business day to schedule.";
          showStep('thanks');
          return true;
        } else {
          status.textContent = body?.error || `Submission failed (${res.status}). Please call (480) 914-8300.`;
          status.classList.add('lead-status-err');
          return false;
        }
      } catch (err) {
        status.textContent = 'Network error. Please call (480) 914-8300.';
        status.classList.add('lead-status-err');
        return false;
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalLabel;
      }
    }

    // Instant Quote form submit
    modal.querySelector('#iq-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submitForm(e.target, 'Instant Quote', {
        selections: selectedProc ? [selectedProc.id] : ['dr-scottsdale-consult'],
      });
    });
    // Book Consult form submit
    modal.querySelector('#bc-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submitForm(e.target, 'Book Appointment');
    });
    // Text Us form submit
    modal.querySelector('#tx-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submitForm(e.target, 'Text Us', { selections: ['text-us'] });
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
