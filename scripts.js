/* Dr. Scottsdale shared client scripts (v1.7).
   Loaded by every page. Handles:
   1. Ask Dr. Scottsdale — full streaming chat → /api/chat → nr-website ask-dr-mata
   2. Book Consult widget — same UX/flow as the Natural Results FloatingContactWidget
      • 4-action menu: Instant Quote, Book a Consultation, Text Us, Call
      • Instant Quote: 6-step flow (gender → area → services → estimate → contact → confirm)
        identical to NRPS, with Dr. Mata's full procedure catalog pulled live from
        https://naturalresultsaz.com/api/widget-services (filtered to provider="dr-mata"
        — NO medspa services, since this brand site is Dr. Mata's surgical practice).
      • Phone (Call + Text fallback) matches the NRPS widget: (480) 852-4999.
      • All submissions POST to /api/lead → nr-website /api/widget-relay → nrps-admin
        /api/widget/quote → GHL, stamped with siteSource="drscottsdaleaz.com" server-side.
   3. 18+ B&A age-gate — modal that gates surgical results imagery
   No external dependencies. Vanilla DOM. */

(() => {
  // Stable session id for chat logging
  const SESSION_ID = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const PAGE_LOAD_TS = Date.now();

  // ────────────────────────────────────────────────────────────────────
  // Analytics — GTM dataLayer push helper
  // ────────────────────────────────────────────────────────────────────
  //
  // GTM-NN23WX4F is installed in <head> of every page. This site's GTM
  // container is its own — explicitly NOT the Natural Results container.
  // Inside GTM, configure your GA4 / Google Ads / Meta pixels and use these
  // event names as triggers. Naming convention is consistent across the
  // whole site so dashboards can group/funnel cleanly.
  //
  // Events emitted (full coverage of the patient journey):
  //   page_view_extra        — once on load (in addition to GTM's default page view)
  //                            includes page_category derived from URL
  //   widget_open            — Book Consult pill click → menu opens
  //   widget_close           — Menu / flow closed without conversion
  //   instant_quote_start    — User picked Instant Quote from the menu
  //   iq_gender_selected     — Step 1 complete (value: female|male)
  //   iq_area_selected       — Step 2 complete (value: area key, e.g. "body")
  //   iq_service_selected    — Each service add (value: service id, running total)
  //   iq_estimate_view       — Step 4 estimate rendered (value: estimate_min/max, monthly)
  //   instant_quote_submit   — Form submission successful → GHL created lead
  //   book_consult_start     — User picked Book a Consultation from the menu
  //   book_consult_submit    — Book Consult form successfully submitted
  //   text_us_start          — User picked Text Us
  //   text_us_submit         — Text Us form successfully submitted
  //   phone_call_click       — User tapped a tel: link (Call Us, etc.)
  //   ask_dr_scottsdale_open — Ask Dr. Scottsdale chat opened
  //   ask_dr_scottsdale_q    — User submitted a question to the chat
  //   age_gate_confirmed     — 18+ confirmation on results pages
  //
  // All events carry: event (name), event_session (the per-page-load session id),
  // event_property ("drscottsdaleaz.com"), and event_value (when meaningful).
  // GTM converts these to GA4 events with parameters via the gtag dataLayer
  // recipe, so you get Looker / Explorations slicing out of the box.

  const SITE = "drscottsdaleaz.com";
  function pageCategory() {
    const p = window.location.pathname.toLowerCase().replace(/\/$/, "");
    if (p === "" || p === "/") return "home";
    if (p.includes("scottsdale-skinny") || p.includes("gladiator") || p.includes("magic-shot")) return "signature_procedure";
    if (p.includes("breast-aug") || p.includes("breast-lift") || p.includes("tummy") || p.includes("gynecomastia") || p.includes("safe-bbl")) return "procedure";
    if (p.includes("about")) return "about";
    if (p.includes("scottsdale-plastic-surgeon")) return "local_landing";
    if (p.includes("results")) return "results_gallery";
    if (p.includes("testimonials")) return "testimonials";
    if (p.includes("media")) return "media";
    return "other";
  }
  const PAGE_CATEGORY = pageCategory();

  function track(event, props) {
    try {
      window.dataLayer = window.dataLayer || [];
      const payload = Object.assign(
        {
          event,
          event_session: SESSION_ID,
          event_property: SITE,
          page_category: PAGE_CATEGORY,
        },
        props || {},
      );
      window.dataLayer.push(payload);
    } catch (_) {
      // Never break the page over a tracking failure.
    }
  }

  // Emit on every load — gives GTM a hook beyond its built-in page_view
  // so we can distinguish "Dr. Scottsdale page_view" from default.
  track("page_view_extra", { page_url: window.location.href, page_title: document.title });

  // Global tel: click instrumentation — catches every call CTA across the site
  // even ones outside the widget (footer phone, hero CTA, etc.).
  document.addEventListener("click", (e) => {
    const tel = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (!tel) return;
    track("phone_call_click", {
      tel: tel.getAttribute("href"),
      from_widget: !!tel.closest(".lead-menu-row"),
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Phone & catalog config
  // ────────────────────────────────────────────────────────────────────

  // Same number the NRPS FloatingContactWidget uses — both sites funnel into
  // the same GHL location and the practice answers calls/texts on this line.
  // (480) 914-8300 is the office switchboard; (480) 852-4999 is the GHL-routed
  // dedicated widget line. Per Gunn: brand-site widget must use the GHL line
  // so call & text flows match Natural Results 1:1.
  const PHONE = "+14808524999";
  const PHONE_DISPLAY = "(480) 852-4999";

  // Same-origin catalog endpoint — /api/catalog.js proxies to
  // naturalresultsaz.com/api/widget-services server-side and filters to
  // provider==='dr-mata' before responding. Browser never sees a cross-origin
  // request, so no CORS / preflight failure modes.
  const CATALOG_URL = "/api/catalog";

  // ────────────────────────────────────────────────────────────────────
  // Catalog helpers (mirrors lib/quote/services.ts on nr-website)
  // ────────────────────────────────────────────────────────────────────

  // Area metadata — same labels/emojis/sublabels as nr-website's AREAS const,
  // filtered to the dr-mata areas (no injectables/skin/contouring).
  const AREAS = {
    body: { label: "Body", sublabel: "Abdomen, waist, buttocks", emoji: "🫄" },
    breast: { label: "Breast", sublabel: "Augmentation, lift, reduction", emoji: "💗" },
    "chest-male": { label: "Chest", sublabel: "Gynecomastia & contouring", emoji: "💪" },
    face: { label: "Face", sublabel: "Facelift, rhinoplasty, eyes", emoji: "✨" },
    "arms-legs": { label: "Arms & Legs", sublabel: "Lifts & contouring", emoji: "🦵" },
    "female-intimate": { label: "Intimate", sublabel: "Private consultation", emoji: "🌸" },
    "male-intimate": { label: "Male Enhancement", sublabel: "Private consultation", emoji: "🔒" },
  };

  // Same mapping nr-website uses (AREA_MAP.dr-mata)
  const AREA_MAP = {
    female: ["body", "breast", "face", "arms-legs", "female-intimate"],
    male: ["body", "chest-male", "face", "arms-legs", "male-intimate"],
  };

  let CATALOG = []; // Service[] — populated by loadCatalog()
  let CATALOG_LOADED = false;
  let CATALOG_LOADING = null; // Promise during in-flight fetch

  function loadCatalog() {
    if (CATALOG_LOADED) return Promise.resolve(CATALOG);
    if (CATALOG_LOADING) return CATALOG_LOADING;
    CATALOG_LOADING = fetch(CATALOG_URL, { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((all) => {
        if (!Array.isArray(all)) throw new Error("Bad catalog shape");
        // /api/catalog already filters to provider="dr-mata" server-side,
        // but defensive re-filter in case the upstream shape ever changes.
        CATALOG = all.filter((s) => s && s.provider === "dr-mata");
        CATALOG_LOADED = true;
        return CATALOG;
      })
      .catch((err) => {
        console.error("[widget] catalog fetch failed:", err);
        CATALOG_LOADING = null;
        throw err;
      });
    return CATALOG_LOADING;
  }

  function getServices(gender, area) {
    return CATALOG.filter(
      (s) =>
        s.area === area &&
        (s.genderRelevance === "all" || s.genderRelevance === gender),
    );
  }
  function findService(serviceId) {
    return CATALOG.find((s) => s.id === serviceId);
  }
  function parseSelection(token) {
    const [serviceId, variantId] = String(token || "").split("::");
    return { serviceId, variantId };
  }
  function formatSelection(serviceId, variantId) {
    return variantId ? `${serviceId}::${variantId}` : serviceId;
  }
  function calcRange(selections) {
    let min = 0, max = 0;
    for (const token of selections) {
      const { serviceId, variantId } = parseSelection(token);
      const svc = findService(serviceId);
      if (!svc) continue;
      if (variantId && svc.variants) {
        const v = svc.variants.find((x) => x.id === variantId);
        if (v) { min += v.priceMin; max += v.priceMax; continue; }
      }
      min += svc.priceMin; max += svc.priceMax;
    }
    return { min, max };
  }
  function monthlyPayment(amount, apr = 0.12, months = 60) {
    if (amount <= 0) return 0;
    const r = apr / 12;
    return Math.round((amount * r) / (1 - Math.pow(1 + r, -months)));
  }
  function fmtMoney(n) {
    return "$" + Number(n || 0).toLocaleString();
  }
  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ────────────────────────────────────────────────────────────────────
  // Ask Dr. Scottsdale chat — streaming  (unchanged from v1.5)
  // ────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────
  // Homepage Ask Dr. Scottsdale — SELF-CONTAINED INLINE CHAT.
  //
  // Mirrors nr-website's HomepageAskDrMata.tsx component exactly: the
  // homepage section IS the chat. It does NOT open the floating widget.
  // The two chats are fully independent — user can chat in either; one
  // does not prompt the other open.
  //
  // Wire:
  //   - section.ask .body becomes a scrollable message list
  //   - preset clicks send the message inline (stream into body)
  //   - composer input/Enter/Send sends inline (stream into body)
  //   - POSTs to /api/chat (same-origin proxy → nr-website /api/ask-dr-mata
  //     → nrps-admin /api/public/log-chat with siteSource: drscottsdaleaz.com)
  //   - Body has a fixed height so the page below it doesn't shift as
  //     answers stream in (NRPS lesson: scroll inside container, never
  //     scrollIntoView on a sentinel — that yanks the whole page).
  // ────────────────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────────
  // Mobile hamburger menu — injected into every nav.top on page load.
  //
  // The shared CSS hides nav.top .links at ≤900px (display:none) but
  // there was no fallback navigation, leaving mobile users stranded on
  // whatever page they landed on. This injects:
  //   1. A hamburger button visible only on mobile (CSS handles the
  //      show/hide via media query).
  //   2. A full-screen drawer that mirrors the desktop links + adds a
  //      Book Consult CTA at the bottom.
  // ────────────────────────────────────────────────────────────────────
  function wireMobileNav() {
    const nav = document.querySelector('nav.top .row');
    if (!nav) return;
    if (nav.querySelector('.nav-hamburger')) return; // idempotent

    // Mirror the existing desktop links so we have a single source of truth.
    const desktopLinks = nav.querySelector('.links');
    const linksHtml = desktopLinks ? desktopLinks.innerHTML : '';

    // Build the hamburger button.
    const hb = document.createElement('button');
    hb.className = 'nav-hamburger';
    hb.setAttribute('aria-label', 'Open navigation menu');
    hb.setAttribute('aria-expanded', 'false');
    hb.innerHTML = '<span></span><span></span><span></span>';

    // Build the drawer.
    const drawer = document.createElement('div');
    drawer.className = 'nav-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML =
      '<div class="nav-drawer-inner">' +
        '<button class="nav-drawer-close" aria-label="Close menu">×</button>' +
        '<div class="nav-drawer-links">' + linksHtml + '</div>' +
        '<a href="#book" class="nav-drawer-cta" data-book-cta>Book Consult</a>' +
        '<div class="nav-drawer-foot">' +
          '<a href="tel:+14809148300">(480) 914-8300</a>' +
          '<span>7930 E Thompson Peak Pkwy · Scottsdale</span>' +
        '</div>' +
      '</div>';

    // Insert hamburger before the desktop CTA, drawer at body end.
    const cta = nav.querySelector('.cta');
    if (cta) nav.insertBefore(hb, cta); else nav.appendChild(hb);
    document.body.appendChild(drawer);

    function open() {
      drawer.classList.add('show');
      drawer.setAttribute('aria-hidden', 'false');
      hb.setAttribute('aria-expanded', 'true');
      hb.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      drawer.classList.remove('show');
      drawer.setAttribute('aria-hidden', 'true');
      hb.setAttribute('aria-expanded', 'false');
      hb.classList.remove('open');
      document.body.style.overflow = '';
    }
    hb.addEventListener('click', (e) => {
      e.stopPropagation();
      drawer.classList.contains('show') ? close() : open();
    });
    drawer.querySelector('.nav-drawer-close').addEventListener('click', close);
    // Close drawer on any in-drawer link click (so the user navigates).
    drawer.querySelectorAll('.nav-drawer-links a, .nav-drawer-cta').forEach((a) => {
      a.addEventListener('click', () => close());
    });
    // Esc closes the drawer.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('show')) close();
    });
  }

  function wireMobileNav();
      wireHomepageAskInline() {
    const section = document.querySelector('section.ask');
    if (!section) return;
    const body = section.querySelector('.chat .body');
    const composer = section.querySelector('.composer');
    const presets = section.querySelectorAll('.preset');
    const input = composer?.querySelector('input');
    const sendBtn = composer?.querySelector('.send');
    if (!body || !composer || !input || !sendBtn) return;

    // Stable session id so multi-turn conversation logs group in admin
    const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

    // Conversation history (role/content)
    const messages = [];
    let streaming = false;

    // Lock the body to a fixed height so it doesn't grow & push elements
    // below it down as messages stream in. Same lesson as NRPS.
    body.style.height = '360px';
    body.style.maxHeight = '360px';
    body.style.overflowY = 'auto';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '0.75rem';

    // Stash original intro contents so we can mark it as the welcome message
    // The HTML already had: <p>Hello...</p>, then a "Try Asking" label, then presets.
    // We keep the welcome <p> + presets visible until the first user message
    // is sent; then we hide presets but keep the welcome.

    const presetWrap = section.querySelector('.presets');
    const presetEyebrow = body.querySelector('.eyebrow');

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function renderMessage(role, content) {
      const div = document.createElement('div');
      div.className = role === 'user' ? 'iq-msg iq-msg-user' : 'iq-msg iq-msg-bot';
      div.dataset.role = role;
      const bubble = document.createElement('div');
      bubble.className = 'iq-bubble';
      bubble.innerHTML = escapeHtml(content).replace(/\n/g, '<br/>');
      div.appendChild(bubble);
      body.appendChild(div);
      // Scroll the body container, NOT the page. scrollIntoView on a
      // sentinel yanks the page up — direct scrollTop is scoped.
      requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
      return bubble;
    }
    function streamInto(bubble, content) {
      bubble.innerHTML = escapeHtml(content).replace(/\n/g, '<br/>');
      requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
    }

    async function sendMessage(text) {
      const trimmed = (text || '').trim();
      if (!trimmed || streaming) return;
      streaming = true;

      // Hide the presets after the first user message so the inline chat
      // can use the full body. Welcome <p> stays for context.
      if (presetWrap) presetWrap.style.display = 'none';
      if (presetEyebrow) presetEyebrow.style.display = 'none';

      track('ask_dr_scottsdale_q', { source: 'homepage_section' });

      renderMessage('user', trimmed);
      const botBubble = renderMessage('assistant', '…');
      botBubble.classList.add('iq-thinking');
      input.value = '';

      messages.push({ role: 'user', content: trimmed });

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            procedureSlug: 'homepage',
            procedureName: 'Dr. Scottsdale® — Natural Results Plastic Surgery',
            context: 'Topic: drscottsdaleaz.com homepage Ask. Dr. Scottsdale® (Dr. Carlos Mata) is a Harvard-trained, board-certified plastic surgeon in Scottsdale, AZ. Signature trademarked procedures: Scottsdale Skinny® (lipo 360 + fat transfer + high-def etching), Gladiator® (male high-def body contouring), Magic Shot® (non-surgical penile enhancement). Practice: Natural Results Plastic Surgery, AAAASF-accredited surgical suite. 25,000+ procedures. Help the visitor narrow down what they want, point to procedure pages for specifics, refer them to a consultation for candidacy or plan recommendations. Do not quote dollar prices — refer to the Instant Quote Tool or consult. Never refer users outside the practice ("see your doctor" / "consult a physician") — always default to "schedule a consultation with Dr. Scottsdale" since they\'re already on his site.',
            messages: messages.slice(),
            sessionId,
          }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Could not reach Dr. Scottsdale right now.');
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = '';
        botBubble.classList.remove('iq-thinking');
        botBubble.innerHTML = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          streamInto(botBubble, acc);
        }
        messages.push({ role: 'assistant', content: acc });
      } catch (e) {
        botBubble.classList.remove('iq-thinking');
        botBubble.innerHTML = escapeHtml('Sorry — I couldn\'t reach Dr. Scottsdale right now. Please try again, or use the floating Ask widget in the corner.');
      } finally {
        streaming = false;
      }
    }

    // Wire preset buttons → send inline (no floating-widget bridge).
    presets.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        sendMessage(btn.textContent.trim());
      });
    });

    // Wire composer input → Enter sends, Send button sends.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });
    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sendMessage(input.value);
    });
  }

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
      const willOpen = !panel.classList.contains('show');
      panel.classList.toggle('show');
      if (willOpen) {
        input.focus();
        track('ask_dr_scottsdale_open');
      }
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

    const messages = [];
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
      if (chips) chips.style.display = 'none';

      track('ask_dr_scottsdale_q', { question_chars: text.length, question_count: messages.filter((m) => m.role === 'user').length + 1 });

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
        if (!res.ok || !res.body) throw new Error(`Upstream ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        assistantBubble.classList.remove('thinking');
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantText += decoder.decode(value, { stream: true });
          assistantBubble.textContent = assistantText;
          body.scrollTop = body.scrollHeight;
        }
      } catch (err) {
        assistantBubble.classList.remove('thinking');
        assistantBubble.textContent = `Sorry — I couldn't reach the assistant. Try calling ${PHONE_DISPLAY} or use Book Consult below.`;
      } finally {
        streaming = false;
        if (assistantText.trim()) messages.push({ role: 'assistant', content: assistantText });
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Book Consult widget — NRPS-parity (Instant Quote uses full Dr. Mata catalog)
  // ────────────────────────────────────────────────────────────────────

  function wireBookWidget() {
    const fab = document.querySelector('.fab-book');

    const modal = document.createElement('div');
    modal.className = 'lead-modal';
    modal.id = 'lead-modal';
    modal.innerHTML = `
      <div class="lead-card lead-card-menu">
        <button class="lead-close" aria-label="Close">&times;</button>

        <!-- ───── MAIN MENU ───── -->
        <div class="lead-step" data-step="menu" data-active="true">
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">How can we help?</span></div>
            <h3>Get started with Dr. Scottsdale</h3>
            <p>Pick the path that fits — every option lands with Dr. Scottsdale's team.</p>
          </div>
          <div class="lead-menu">
            <button class="lead-menu-row primary" data-go="iq-gender">
              <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 12v6"/><path d="M9 15h6"/></svg></span>
              <span class="txt"><span class="label">Instant Quote</span><span class="sub">Get a personalized estimate</span></span>
              <span class="chev">›</span>
            </button>
            <button class="lead-menu-row" data-go="book-consult">
              <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
              <span class="txt"><span class="label">Book a Consultation</span><span class="sub">Schedule with our team</span></span>
              <span class="chev">›</span>
            </button>
            <button class="lead-menu-row" data-go="text-us">
              <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span>
              <span class="txt"><span class="label">Text Us</span><span class="sub">${PHONE_DISPLAY}</span></span>
              <span class="chev">›</span>
            </button>
            <a class="lead-menu-row" href="tel:${PHONE}">
              <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></span>
              <span class="txt"><span class="label">Call Us</span><span class="sub">${PHONE_DISPLAY}</span></span>
              <span class="chev">›</span>
            </a>
          </div>
        </div>

        <!-- ───── INSTANT QUOTE: GENDER ───── -->
        <div class="lead-step" data-step="iq-gender">
          <button class="lead-back" data-back="menu">‹ Back</button>
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">Step 1 of 5 · About you</span></div>
            <h3>Select your gender</h3>
            <p>This helps us show services most relevant to you.</p>
          </div>
          <div class="iq-gender-grid">
            <button class="iq-gender-card" data-gender="female">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M12 13v8"/><path d="M9 18h6"/></svg>
              <span>Female</span>
            </button>
            <button class="iq-gender-card" data-gender="male">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="14" r="5"/><line x1="19" y1="5" x2="13.5" y2="10.5"/><polyline points="14 5 19 5 19 10"/></svg>
              <span>Male</span>
            </button>
          </div>
        </div>

        <!-- ───── INSTANT QUOTE: AREA ───── -->
        <div class="lead-step" data-step="iq-area">
          <button class="lead-back" data-back="iq-gender">‹ Back</button>
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">Step 2 of 5 · Area of concern</span></div>
            <h3>What area would you like to focus on?</h3>
            <p>Pick the area you're most interested in — you'll select specific treatments next.</p>
          </div>
          <div class="iq-area-list" id="iq-area-list"></div>
        </div>

        <!-- ───── INSTANT QUOTE: SERVICES ───── -->
        <div class="lead-step" data-step="iq-services">
          <button class="lead-back" data-back="iq-area">‹ Back</button>
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow" id="iq-services-eyebrow">Step 3 of 5</span></div>
            <h3>Select services</h3>
            <p>Choose any that interest you — combining procedures may reduce cost.</p>
          </div>
          <div class="iq-services-scroll" id="iq-services-list"></div>
          <div class="iq-services-footer">
            <div class="iq-services-summary">
              <span class="iq-count" id="iq-count">0 selected</span>
              <span class="iq-range" id="iq-range"></span>
            </div>
            <button class="btn-gold iq-continue" id="iq-continue" disabled>See My Estimate
              <svg class="btn-arrow" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
        </div>

        <!-- ───── INSTANT QUOTE: ESTIMATE ───── -->
        <div class="lead-step" data-step="iq-estimate">
          <button class="lead-back" data-back="iq-services">‹ Back</button>
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">Step 4 of 5 · Your estimate</span></div>
            <h3>Your estimate</h3>
          </div>
          <div class="iq-price-card" id="iq-price-card"></div>
          <div class="iq-breakdown">
            <div class="iq-breakdown-head">Included in your quote</div>
            <div id="iq-breakdown-list"></div>
          </div>
          <div class="iq-includes">
            <div class="iq-includes-head">Every quote includes</div>
            <ul>
              <li>Dr. Mata's surgeon fee</li>
              <li>Accredited facility &amp; anesthesia</li>
              <li>All post-operative visits</li>
              <li>Compression garments (where applicable)</li>
            </ul>
          </div>
          <div class="lead-actions">
            <button type="button" class="btn-gold lead-submit" data-go="iq-contact">Request Consultation
              <svg class="btn-arrow" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
            <button type="button" class="btn-ghost" data-back="iq-services">Refine selection</button>
          </div>
        </div>

        <!-- ───── INSTANT QUOTE: CONTACT ───── -->
        <div class="lead-step" data-step="iq-contact">
          <button class="lead-back" data-back="iq-estimate">‹ Back</button>
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">Step 5 of 5 · Let's connect</span></div>
            <h3>Where should Dr. Scottsdale's team reach you?</h3>
            <p>Your info stays private. We'll reach out within 24 hours.</p>
          </div>
          <form class="lead-form" id="iq-form" autocomplete="on">
            <div class="row-2">
              <label>First Name<input name="firstName" required maxlength="60" autocomplete="given-name" /></label>
              <label>Last Name<input name="lastName" required maxlength="60" autocomplete="family-name" /></label>
            </div>
            <label>Email<input name="email" type="email" required maxlength="120" autocomplete="email" /></label>
            <label>Phone<input name="phone" type="tel" required maxlength="30" autocomplete="tel" /></label>
            <div class="iq-pref-group">
              <span class="iq-pref-label">Preferred contact method</span>
              <div class="iq-pref-row" data-pref="preferredContact">
                <button type="button" data-val="phone" class="active">Phone</button>
                <button type="button" data-val="email">Email</button>
                <button type="button" data-val="text">Text</button>
              </div>
            </div>
            <div class="iq-pref-group">
              <span class="iq-pref-label">Best time to reach you</span>
              <div class="iq-pref-row iq-pref-row-4" data-pref="bestTime">
                <button type="button" data-val="morning">Morning</button>
                <button type="button" data-val="afternoon">Afternoon</button>
                <button type="button" data-val="evening">Evening</button>
                <button type="button" data-val="any" class="active">Any</button>
              </div>
            </div>
            <input type="text" name="company_website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;top:-9999px;width:1px;opacity:0;pointer-events:none;" aria-hidden="true" />
            <div class="lead-actions">
              <button type="submit" class="btn-gold lead-submit">Submit Request
                <svg class="btn-arrow" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" stroke-width="1.5"/></svg>
              </button>
            </div>
            <div class="lead-status" aria-live="polite"></div>
            <p class="iq-fineprint">By submitting, you agree to be contacted by Dr. Scottsdale's team about your request.</p>
          </form>
        </div>

        <!-- ───── BOOK CONSULTATION (simple form) ───── -->
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
            <input type="text" name="company_website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;top:-9999px;width:1px;opacity:0;pointer-events:none;" aria-hidden="true" />
            <div class="lead-actions">
              <button type="submit" class="btn-gold lead-submit">Request Consultation
                <svg class="btn-arrow" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" stroke-width="1.5"/></svg>
              </button>
            </div>
            <div class="lead-status" aria-live="polite"></div>
          </form>
        </div>

        <!-- ───── TEXT US composer ───── -->
        <div class="lead-step" data-step="text-us">
          <button class="lead-back" data-back="menu">‹ Back</button>
          <div class="lead-head">
            <div class="row"><span class="gold-bar"></span><span class="eyebrow">Text Us</span></div>
            <h3>Send Dr. Scottsdale's team a message</h3>
            <p>Replies come back to your phone as a real text from ${PHONE_DISPLAY}.</p>
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
              <button type="submit" class="btn-gold lead-submit">Send Message
                <svg class="btn-arrow" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" stroke-width="1.5"/></svg>
              </button>
            </div>
            <div class="lead-status" aria-live="polite"></div>
          </form>
        </div>

        <!-- ───── CONFIRMATION ───── -->
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

    // Quote-flow state — mirrors the React useState in InstantQuoteFlow.tsx
    const state = {
      step: 'menu',
      gender: null,
      area: null,
      selections: [], // array of selection tokens
      expandedId: null, // service id whose variant picker is expanded
      preferredContact: 'phone',
      bestTime: 'any',
    };

    function showStep(step) {
      state.step = step;
      modal.querySelectorAll('.lead-step').forEach((el) => {
        el.dataset.active = el.dataset.step === step ? 'true' : 'false';
      });
      card.scrollTop = 0;
    }

    function openModal() {
      modal.classList.add('show');
      showStep('menu');
      const askPanel = document.getElementById('ask-panel');
      if (askPanel) askPanel.classList.remove('show');
      // Kick off catalog load if not already loaded (so it's ready when they
      // reach the services step).
      loadCatalog().catch(() => { /* swallow — services step will show error */ });
      track('widget_open');
    }
    function closeModal() {
      // Only fire widget_close if user closed without converting (didn't reach thanks).
      const wasOnThanks = state.step === 'thanks';
      modal.classList.remove('show');
      if (!wasOnThanks) track('widget_close', { last_step: state.step });
    }

    if (fab) fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (modal.classList.contains('show')) closeModal(); else openModal();
    });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('show')) closeModal(); });
    document.addEventListener('click', (e) => {
      if (!modal.classList.contains('show')) return;
      if (modal.contains(e.target)) return;
      if (fab && fab.contains(e.target)) return;
      if (e.target.closest && e.target.closest('[data-book-cta]')) return;
      closeModal();
    });
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-book-cta]');
      if (!target) return;
      e.preventDefault();
      openModal();
    });

    // ───── Menu / Navigation ─────
    modal.addEventListener('click', (e) => {
      const goTarget = e.target.closest('[data-go]');
      if (goTarget) {
        const next = goTarget.dataset.go;
        if (next === 'iq-area') renderAreas();
        if (next === 'iq-services') renderServices();
        if (next === 'iq-estimate') renderEstimate();
        // Top-level menu choices fire start events so funnel reports can
        // see how many people pick each path off the corner pill.
        if (next === 'iq-gender') track('instant_quote_start');
        if (next === 'book-consult') track('book_consult_start');
        if (next === 'text-us') track('text_us_start');
        if (next === 'iq-estimate') {
          const range = calcRange(state.selections);
          track('iq_estimate_view', {
            selection_count: state.selections.length,
            estimate_min: range.min,
            estimate_max: range.max,
            gender: state.gender || undefined,
            area_of_concern: state.area ? (AREAS[state.area]?.label || undefined) : undefined,
          });
        }
        showStep(next);
        return;
      }
      const backTarget = e.target.closest('[data-back]');
      if (backTarget) { showStep(backTarget.dataset.back); return; }
      const done = e.target.closest('.lead-done');
      if (done) closeModal();
    });

    // ───── Step: GENDER ─────
    modal.querySelectorAll('.iq-gender-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.gender = btn.dataset.gender;
        track('iq_gender_selected', { gender: state.gender });
        state.area = null;
        state.selections = [];
        modal.querySelectorAll('.iq-gender-card').forEach((b) =>
          b.classList.toggle('active', b === btn));
        renderAreas();
        showStep('iq-area');
      });
    });

    // ───── Step: AREA ─────
    function renderAreas() {
      const list = modal.querySelector('#iq-area-list');
      const areas = AREA_MAP[state.gender] || [];
      list.innerHTML = areas.map((key) => {
        const a = AREAS[key];
        return `
          <button class="iq-area-row" data-area="${key}">
            <span class="iq-area-emoji">${a.emoji}</span>
            <span class="iq-area-text">
              <span class="iq-area-label">${escapeHTML(a.label)}</span>
              <span class="iq-area-sub">${escapeHTML(a.sublabel)}</span>
            </span>
            <span class="chev">›</span>
          </button>
        `;
      }).join('');
      list.querySelectorAll('.iq-area-row').forEach((btn) => {
        btn.addEventListener('click', async () => {
          state.area = btn.dataset.area;
          track('iq_area_selected', { area: state.area, area_label: AREAS[state.area]?.label });
          state.selections = [];
          // Make sure the catalog has loaded before we render services.
          try {
            await loadCatalog();
          } catch (_) {
            // We'll show a "couldn't load" message in renderServices.
          }
          renderServices();
          showStep('iq-services');
        });
      });
    }

    // ───── Step: SERVICES (multi-select, with variants) ─────
    function renderServices() {
      const list = modal.querySelector('#iq-services-list');
      const eyebrow = modal.querySelector('#iq-services-eyebrow');
      eyebrow.textContent = `Step 3 of 5 · ${AREAS[state.area]?.label || ''}`;

      if (!CATALOG_LOADED) {
        list.innerHTML = `<div class="iq-empty">Couldn't load the procedure catalog. Please call ${escapeHTML(PHONE_DISPLAY)} or try again in a moment.</div>`;
        updateServicesFooter();
        return;
      }

      const services = getServices(state.gender, state.area);
      if (services.length === 0) {
        list.innerHTML = `<div class="iq-empty">No services in this category yet.</div>`;
        updateServicesFooter();
        return;
      }

      list.innerHTML = services.map((svc) => serviceRowHTML(svc)).join('');
      // Wire up each row's interactions
      services.forEach((svc) => {
        const row = list.querySelector(`[data-svc="${svc.id}"]`);
        if (!row) return;
        const mainBtn = row.querySelector('.iq-svc-main');
        const removeBtn = row.querySelector('.iq-svc-remove');
        const expandBtns = row.querySelectorAll('.iq-svc-variant');

        mainBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          handleRowMain(svc);
        });
        removeBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          deselect(svc.id);
        });
        expandBtns.forEach((vb) => {
          vb.addEventListener('click', (e) => {
            e.stopPropagation();
            const vid = vb.dataset.variant;
            select(svc.id, vid);
            state.expandedId = null;
          });
        });
      });
      updateServicesFooter();
    }

    function serviceRowHTML(svc) {
      const pricedVariants = (svc.variants || []).filter((v) => v.priceMin > 0 || v.priceMax > 0);
      const hasVariants = pricedVariants.length > 1;
      const singleVariant = pricedVariants.length === 1 ? pricedVariants[0] : null;
      const sel = state.selections.find((t) => parseSelection(t).serviceId === svc.id);
      const isSelected = !!sel;
      const selectedVariantId = sel ? parseSelection(sel).variantId : undefined;
      const selectedVariant = selectedVariantId && svc.variants
        ? svc.variants.find((v) => v.id === selectedVariantId)
        : null;

      const variantMins = pricedVariants.map((v) => v.priceMin).filter((p) => p > 0);
      const fromPrice = variantMins.length ? Math.min.apply(null, variantMins) : svc.priceMin;

      // Price label under the service name
      let priceHTML;
      if (selectedVariant) {
        const label = selectedVariant.label && selectedVariant.label !== 'Standard'
          ? `<span class="iq-svc-variant-label">${escapeHTML(selectedVariant.label)}</span> · `
          : '';
        priceHTML = `${label}<span class="iq-svc-price-num">${fmtMoney(selectedVariant.priceMin)}${selectedVariant.priceMax > selectedVariant.priceMin ? `–${fmtMoney(selectedVariant.priceMax)}` : ''}</span>`;
      } else if (hasVariants) {
        priceHTML = `from ${fmtMoney(fromPrice)} · ${pricedVariants.length} options`;
      } else if (singleVariant) {
        priceHTML = `${fmtMoney(singleVariant.priceMin)}${singleVariant.priceMax > singleVariant.priceMin ? `–${fmtMoney(singleVariant.priceMax)}` : ''}`;
      } else {
        priceHTML = `${fmtMoney(svc.priceMin)}${svc.priceMax > svc.priceMin ? `–${fmtMoney(svc.priceMax)}` : ''}`;
      }

      const isExpanded = state.expandedId === svc.id && hasVariants && !isSelected;

      const variantPicker = isExpanded ? `
        <div class="iq-svc-variants">
          <div class="iq-svc-variants-head">Choose an option</div>
          ${pricedVariants.map((v) => `
            <button class="iq-svc-variant" data-variant="${escapeHTML(v.id)}">
              <span class="iq-svc-variant-dot"></span>
              <span class="iq-svc-variant-info">
                <span class="iq-svc-variant-lbl">${escapeHTML(v.label)}</span>
                <span class="iq-svc-variant-px">${fmtMoney(v.priceMin)}${v.priceMax > v.priceMin ? `–${fmtMoney(v.priceMax)}` : ''}</span>
              </span>
            </button>
          `).join('')}
        </div>
      ` : '';

      const indicator = (!hasVariants || isSelected)
        ? `<span class="iq-svc-check ${isSelected ? 'on' : ''}">${isSelected ? '✓' : ''}</span>`
        : `<span class="iq-svc-spacer"></span>`;

      const rightAff = hasVariants
        ? (isSelected
            ? `<button class="iq-svc-remove" aria-label="Remove">×</button>`
            : `<span class="iq-svc-chev ${isExpanded ? 'open' : ''}">▾</span>`)
        : '';

      return `
        <div class="iq-svc-row ${isSelected ? 'on' : ''}" data-svc="${escapeHTML(svc.id)}">
          <button class="iq-svc-main">
            ${indicator}
            <span class="iq-svc-info">
              <span class="iq-svc-name">${escapeHTML(svc.name)}</span>
              ${svc.blurb ? `<span class="iq-svc-blurb">${escapeHTML(svc.blurb)}</span>` : ''}
              <span class="iq-svc-price">${priceHTML}</span>
            </span>
            ${rightAff}
          </button>
          ${variantPicker}
        </div>
      `;
    }

    function handleRowMain(svc) {
      const pricedVariants = (svc.variants || []).filter((v) => v.priceMin > 0 || v.priceMax > 0);
      const hasVariants = pricedVariants.length > 1;
      const singleVariant = pricedVariants.length === 1 ? pricedVariants[0] : null;
      const isSelected = state.selections.some((t) => parseSelection(t).serviceId === svc.id);

      if (singleVariant) {
        if (isSelected) deselect(svc.id); else select(svc.id, singleVariant.id);
      } else if (!hasVariants) {
        if (isSelected) deselect(svc.id); else select(svc.id);
      } else if (!isSelected) {
        state.expandedId = state.expandedId === svc.id ? null : svc.id;
        renderServices();
      }
    }

    function select(serviceId, variantId) {
      const token = formatSelection(serviceId, variantId);
      state.selections = state.selections.filter((t) => parseSelection(t).serviceId !== serviceId);
      state.selections.push(token);
      state.expandedId = null;
      renderServices();
    }
    function deselect(serviceId) {
      state.selections = state.selections.filter((t) => parseSelection(t).serviceId !== serviceId);
      if (state.expandedId === serviceId) state.expandedId = null;
      renderServices();
    }

    function updateServicesFooter() {
      const range = calcRange(state.selections);
      const countEl = modal.querySelector('#iq-count');
      const rangeEl = modal.querySelector('#iq-range');
      const contBtn = modal.querySelector('#iq-continue');
      countEl.textContent = `${state.selections.length} selected`;
      if (state.selections.length > 0) {
        rangeEl.textContent = `${fmtMoney(range.min)}${range.max > range.min ? `–${fmtMoney(range.max)}` : ''}`;
        contBtn.removeAttribute('disabled');
      } else {
        rangeEl.textContent = '';
        contBtn.setAttribute('disabled', '');
      }
    }

    // The "See My Estimate" button uses data-go="iq-estimate" — captured in the
    // main navigation handler above.
    modal.querySelector('#iq-continue').addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.selections.length === 0) return;
      renderEstimate();
      showStep('iq-estimate');
    });

    // ───── Step: ESTIMATE ─────
    function renderEstimate() {
      const range = calcRange(state.selections);
      const mMin = monthlyPayment(range.min);
      const mMax = monthlyPayment(range.max);

      const priceCard = `
        <div class="iq-price-inner">
          <span class="iq-price-eyebrow">Estimated investment</span>
          <div class="iq-price-big">${fmtMoney(range.min)}${range.max > range.min ? `<span class="iq-price-max">–${fmtMoney(range.max)}</span>` : ''}</div>
          ${mMin > 0 ? `<div class="iq-price-monthly">or as low as <strong>${fmtMoney(mMin)}${mMax > mMin ? `–${fmtMoney(mMax)}` : ''}</strong>/month*</div>` : ''}
          <div class="iq-price-fineprint">*Financing subject to credit approval. 60mo at 12% APR est.</div>
        </div>
      `;
      modal.querySelector('#iq-price-card').innerHTML = priceCard;

      const list = state.selections.map((token) => {
        const { serviceId, variantId } = parseSelection(token);
        const svc = findService(serviceId);
        if (!svc) return null;
        let pMin = svc.priceMin, pMax = svc.priceMax, vLabel = null;
        if (variantId && svc.variants) {
          const v = svc.variants.find((x) => x.id === variantId);
          if (v) { pMin = v.priceMin; pMax = v.priceMax; if (v.label !== 'Standard') vLabel = v.label; }
        }
        return `
          <div class="iq-bd-row">
            <div class="iq-bd-name">
              <span>${escapeHTML(svc.name)}</span>
              ${vLabel ? `<span class="iq-bd-variant">${escapeHTML(vLabel)}</span>` : ''}
            </div>
            <span class="iq-bd-price">${fmtMoney(pMin)}${pMax > pMin ? `–${fmtMoney(pMax)}` : ''}</span>
          </div>
        `;
      }).filter(Boolean).join('');
      modal.querySelector('#iq-breakdown-list').innerHTML = list;
    }

    // ───── Step: CONTACT (preferred contact + best time toggles) ─────
    modal.querySelectorAll('.iq-pref-row').forEach((row) => {
      const key = row.dataset.pref;
      row.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-val]');
        if (!b) return;
        e.stopPropagation();
        state[key] = b.dataset.val;
        row.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      });
    });

    // ───── Submission ─────
    async function submitForm(form, action, extras) {
      extras = extras || {};
      const fd = new FormData(form);
      const status = form.querySelector('.lead-status');
      if (status) { status.textContent = ''; status.className = 'lead-status'; }

      const payload = {
        contact: {
          firstName: String(fd.get('firstName') || '').trim(),
          lastName: String(fd.get('lastName') || '').trim() || '(none)',
          email: String(fd.get('email') || '').trim() || undefined,
          phone: String(fd.get('phone') || '').trim(),
        },
        message: String(fd.get('message') || '').trim() || undefined,
        leadSourceUrl: window.location.href,
        action,
        provider: 'dr-mata',
        selections: extras.selections || ['dr-scottsdale-consult'],
        preferredContact: extras.preferredContact,
        bestTime: extras.bestTime,
        gender: extras.gender,
        areaOfConcern: extras.areaOfConcern,
        company_website: fd.get('company_website') || '',
        _tStart: PAGE_LOAD_TS,
      };
      if (!payload.contact.firstName || !payload.contact.phone) {
        if (status) {
          status.textContent = 'Please fill in all required fields.';
          status.classList.add('lead-status-err');
        }
        return false;
      }

      const submitBtn = form.querySelector('.lead-submit');
      const originalLabel = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }
      try {
        const res = await fetch('/api/lead', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        let body = null; try { body = await res.json(); } catch (_) {}
        if (res.ok) {
          form.querySelectorAll('input, textarea').forEach((el) => {
            if (el.type !== 'checkbox') el.value = '';
            else el.checked = false;
          });
          const isText = action === 'Text Us';
          modal.querySelector('#thanks-title').textContent = isText ? 'Message sent.' : `Thank you, ${escapeHTML(payload.contact.firstName)}.`;
          modal.querySelector('#thanks-body').textContent = isText
            ? `Dr. Scottsdale's team will text you back from ${PHONE_DISPLAY} — keep an eye on your phone.`
            : `Your request has been received. A member of our team will reach out within 24 hours.`;
          // Conversion events fired ONLY after GHL upstream returned ok.
          // These map to GA4 conversion / Google Ads conversion / Meta lead event in GTM.
          if (action === 'Instant Quote') {
            const range = calcRange(state.selections);
            track('instant_quote_submit', {
              selection_count: state.selections.length,
              estimate_min: range.min,
              estimate_max: range.max,
              gender: state.gender || undefined,
              area_of_concern: state.area ? (AREAS[state.area]?.label || undefined) : undefined,
              preferred_contact: state.preferredContact,
              best_time: state.bestTime,
            });
          } else if (action === 'Book Appointment') {
            track('book_consult_submit');
          } else if (action === 'Text Us') {
            track('text_us_submit');
          }
          showStep('thanks');
          return true;
        } else {
          if (status) {
            status.textContent = (body && body.error) || `Submission failed (${res.status}). Please call ${PHONE_DISPLAY}.`;
            status.classList.add('lead-status-err');
          }
          return false;
        }
      } catch (err) {
        if (status) {
          status.textContent = `Network error. Please call ${PHONE_DISPLAY}.`;
          status.classList.add('lead-status-err');
        }
        return false;
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalLabel; }
      }
    }

    modal.querySelector('#iq-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submitForm(e.target, 'Instant Quote', {
        selections: state.selections.length ? state.selections : ['dr-scottsdale-consult'],
        preferredContact: state.preferredContact,
        bestTime: state.bestTime,
        gender: state.gender || undefined,
        areaOfConcern: state.area ? (AREAS[state.area]?.label || undefined) : undefined,
      });
    });
    modal.querySelector('#bc-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submitForm(e.target, 'Book Appointment');
    });
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
        track('age_gate_confirmed');
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
      wireMobileNav();
      wireHomepageAskInline();
    });
  } else {
    wireAskWidget();
    wireBookWidget();
    wireAgeGate();
    wireMobileNav();
      wireHomepageAskInline();
  }
})();
