// frontend/public/bot-health.js
//
// OpenAI credit alert (added 2026-09-21).
//
// When a brand's OpenAI credits run out — or its auto recharge fails — its
// AI bot can't generate answers and sends a canned "nararanasang technical
// issues … submit a ticket here" message instead. OpenAI offers no balance
// API, so rather than asking anyone to type balances in by hand, the backend
// watches for that fallback message (see /bot-health in chatwoot.js).
//
// Polls GET /api/chatwoot/bot-health every POLL_MS and shows a red banner at
// the top of the page for every brand whose bot is sending the fallback. The
// banner clears on its own once the bot answers normally again.
//
// HOW TO USE: put this file in frontend/public/ and add, just before </body>:
//     <script src="bot-health.js"></script>
// It needs API_BASE (defined by every dashboard page) and the pipeline_token
// in localStorage — nothing else.
//
// Dismissing (×) hides that brand's alert for the CURRENT incident only: if
// the bot recovers and later starts sending the fallback again, it's a new
// incident and the banner comes back.
(function () {
  const POLL_MS = 2 * 60 * 1000;
  const WINDOW_MINUTES = 30;
  const MIN_FALLBACKS = 2;
  const DISMISS_KEY = 'csr_bot_alert_dismissed';

  const BRAND_LABELS = {
    buenasph: 'Buenas PH', tmtcash: 'TMTCash', mcp: 'Mobile Casino Play', manilaplayph: 'Manila Play PH',
    HypleplayPH: 'HypePlay PH', HypeplayBD: 'HypePlay BD', Tmtplay: 'TMTPLAY', MGK: '88MGK',
    BuenasCredit: 'Buenas Credit', LuckystacksPH: 'LuckyStacks PH',
    casinyeam: 'Casinyeam', manilacasino: 'Manila Casino', superscatterph: 'SuperScatter PH',
    'livechat-general': 'LC General',
  };
  const label = s => BRAND_LABELS[s] || String(s || 'Unknown').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function readDismissed() {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeDismissed(map) {
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(map)); } catch (e) { /* private mode — fine */ }
  }

  function sinceText(iso) {
    if (!iso) return 'recently';
    const d = new Date(iso);
    const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    const clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return mins < 1 ? `${clock} (just now)` : `${clock} (${mins} min ago)`;
  }

  // ---- styles, injected once so each page needs only the script tag ----
  const style = document.createElement('style');
  style.textContent = `
    .bh-wrap{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;}
    .bh-alert{display:flex;align-items:flex-start;gap:12px;background:#FEF2F2;border:1px solid #FECACA;border-left:4px solid #EF4444;border-radius:12px;padding:12px 14px;color:#7F1D1D;font-family:inherit;}
    .bh-icon{font-size:18px;line-height:1.2;flex-shrink:0;}
    .bh-body{flex:1;min-width:0;font-size:13px;line-height:1.5;}
    .bh-body b{font-weight:800;color:#991B1B;}
    .bh-sub{font-size:12px;color:#B91C1C;opacity:.9;margin-top:2px;}
    .bh-close{border:none;background:none;color:#B91C1C;font-size:18px;line-height:1;cursor:pointer;padding:0 2px;flex-shrink:0;}
    .bh-close:hover{color:#7F1D1D;}
  `;
  document.head.appendChild(style);

  let wrap = null;
  function mount() {
    if (wrap) return wrap;
    const main = document.querySelector('.main') || document.body;
    wrap = document.createElement('div');
    wrap.className = 'bh-wrap';
    wrap.id = 'botHealthAlerts';
    main.insertBefore(wrap, main.firstChild);
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.bh-close');
      if (!btn) return;
      const dismissed = readDismissed();
      dismissed[btn.dataset.brand] = btn.dataset.since;   // this silence only
      writeDismissed(dismissed);
      btn.closest('.bh-alert').remove();
    });
    return wrap;
  }

  function render(alerts) {
    const el = mount();
    const dismissed = readDismissed();
    // Forget dismissals for brands that have recovered, so a later silence
    // shows up again.
    const silentBrands = new Set(alerts.map(a => a.brand));
    let changed = false;
    Object.keys(dismissed).forEach(b => { if (!silentBrands.has(b)) { delete dismissed[b]; changed = true; } });
    if (changed) writeDismissed(dismissed);

    const visible = alerts.filter(a => dismissed[a.brand] !== a.since);
    el.innerHTML = visible.map(a => `
      <div class="bh-alert" role="alert">
        <div class="bh-icon">⚠️</div>
        <div class="bh-body">
          <b>${esc(label(a.brand))}</b> — OpenAI credits have most likely run out.
          The AI bot has sent its <b>"technical issues"</b> fallback <b>${a.fallbacks} time${a.fallbacks === 1 ? '' : 's'}</b>
          to ${a.affectedConversations} customer${a.affectedConversations === 1 ? '' : 's'}, since ${sinceText(a.since)}.
          <div class="bh-sub">Top up this brand's OpenAI balance (or check why its auto recharge failed). This clears on its own once the bot answers normally again.</div>
        </div>
        <button class="bh-close" title="Hide until the bot recovers" data-brand="${esc(a.brand)}" data-since="${esc(a.since)}">×</button>
      </div>`).join('');
    el.style.display = visible.length ? '' : 'none';
  }

  async function check() {
    const base = typeof API_BASE !== 'undefined' ? API_BASE : 'https://pipeline-crm-production-412d.up.railway.app/api';
    const token = localStorage.getItem('pipeline_token');
    if (!token) return;
    try {
      const res = await fetch(`${base}/chatwoot/bot-health?minutes=${WINDOW_MINUTES}&minFallbacks=${MIN_FALLBACKS}`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;   // endpoint not deployed yet, or a hiccup — stay quiet
      const data = await res.json();
      render(data.alerts || []);
    } catch (e) {
      console.warn('Bot health check failed:', e.message);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check);
  else check();
  setInterval(check, POLL_MS);
})();
