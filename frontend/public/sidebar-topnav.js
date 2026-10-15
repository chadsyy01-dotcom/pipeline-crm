/* =====================================================================
   SIDEBAR → TOP NAV (2026-10-13, utos ni Chad)
   Kapag hinide ang sidebar ("Hide sidebar" sa ibaba ng sidebar), lilipat
   ang menu sa ITAAS ng page bilang pahalang na top bar. Ang "☰ Sidebar"
   button sa kanan ng top bar ang magbabalik ng sidebar.
   - Iisang file para sa LAHAT ng page — isama lang sa dulo ng <body>:
       <script src="sidebar-topnav.js?v=2"></script>
   - Kinokopya ang mga link mula mismo sa sidebar ng page, kaya kapag
     may binago sa sidebar, kasama na agad sa top bar.
   - Naaalala ang pinili (localStorage 'csr_sidebar_hidden'), pareho ng
     dating "Hide sidebar" ng Dashboard.
   ===================================================================== */
(function () {
  if (window.__sbTopNav) return; window.__sbTopNav = true;

  // ===== ROLE GUARD (2026-10-14, utos ni Chad) =====
  // Ang role na 'CSR' ay Customers at Settings lang ang makikita (pati sariling
  // Profile). Ibang page → ililipat sa Customers. Ang role ay kinukuha sa
  // /api/auth/me at sine-save sa localStorage para walang "flash" sa susunod.
  // UI-level ito: itinatago ang menu at nire-redirect ang page.
  const ROLE_KEY = 'csr_role';
  const ROLE_API = (typeof window.API_BASE === 'string' && window.API_BASE) || 'https://pipeline-crm-production-412d.up.railway.app/api';
  // 2026-10-15 (utos ni Chad): Customers + BRAVO/DELTA/FOXTROT/ECHO LANG ang
  // nakikita ng CSR — tinanggal na ang Settings. (Profile = sariling account,
  // wala sa menu, mabubuksan lang mula sa avatar.)
  const CSR_ALLOWED = new Set(['customers', 'profile']);
  const pageKey = h => String(h || '').split(/[?#]/)[0].split('/').pop().replace(/\.html$/, '').toLowerCase();
  const isLimited = r => String(r || '').toUpperCase() === 'CSR';
  const getRole = () => { try { return localStorage.getItem(ROLE_KEY) || ''; } catch (e) { return ''; } };
  const setRole = r => { try { localStorage.setItem(ROLE_KEY, r || ''); } catch (e) {} };
  function guardPage(role) {
    if (!isLimited(role)) return false;
    const here = pageKey(location.pathname) || 'csr-dashboard';
    if (!CSR_ALLOWED.has(here)) { location.replace('customers.html'); return true; }
    return false;
  }
  function filterMenus(role) {
    const limited = isLimited(role);
    document.body.classList.toggle('role-csr', limited);
    if (!limited) return;
    document.querySelectorAll('aside.sidebar a.nav-item, .sb-topnav .tn-links > a, .sb-topnav .tn-links > .tn-drop').forEach(el => {
      const k = pageKey(el.getAttribute('href') || el.dataset.href || '');
      if (!CSR_ALLOWED.has(k)) el.style.display = 'none';
    });
    document.querySelectorAll('aside.sidebar .nav-sub, aside.sidebar .nav-chev, .page-tabs').forEach(el => { el.style.display = 'none'; });
    const brand = document.querySelector('.sb-topnav .tn-brand'); if (brand) brand.setAttribute('href', 'customers.html');
  }
  // 1) agad, mula sa naka-save na role (walang hintay)
  if (guardPage(getRole())) return;
  // 2) i-verify sa server
  (function refreshRole() {
    let token = ''; try { token = localStorage.getItem('pipeline_token') || ''; } catch (e) {}
    if (!token) return;
    fetch(ROLE_API + '/auth/me', { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const role = d && d.user ? (d.user.role || '') : null;
        if (role == null) return;
        setRole(role);
        if (guardPage(role)) return;
        const run = () => filterMenus(role);
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
      }).catch(() => {});
  })();
  const KEY = 'csr_sidebar_hidden';
  const SV = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${d}</svg>`;
  const ICON = {
    dash: SV('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    ticket: SV('<path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v3a2 2 0 000 4v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 000-4V8z"/>'),
    trophy: SV('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/>'),
    users: SV('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>'),
    shield: SV('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'),
    share: SV('<path d="M18 8a3 3 0 100-6 3 3 0 000 6z"/><path d="M6 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M18 22a3 3 0 100-6 3 3 0 000 6z"/><path d="M8.6 13.5l6.8 3.9M15.4 6.6L8.6 10.5"/>'),
    book: SV('<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>'),
    bars: SV('<path d="M18 20V10M12 20V4M6 20v-6"/>'),
    clock: SV('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
    card: SV('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
    chat: SV('<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>'),
    bank: SV('<path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/>'),
    flag: SV('<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>'),
    gear: SV('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.09-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>'),
  };
  // Kapag may bagong page: idagdag lang dito.
  const MENU = [
    { label: 'Dashboard', href: 'csr-dashboard.html', icon: 'dash' },
    { label: 'Tickets', href: 'tickets.html', icon: 'ticket', kids: [
      { label: 'Agent Performance', href: 'agent-performance.html', icon: 'trophy' } ] },
    { label: 'Customers', href: 'customers.html', icon: 'users' },
    // CSR TEAMS (2026-10-14): hiwalay na tab sa ibaba ng Customers
    { label: 'BRAVO', href: 'customers.html?team=bravo', icon: 'flag' },
    { label: 'DELTA', href: 'customers.html?team=delta', icon: 'flag' },
    { label: 'FOXTROT', href: 'customers.html?team=foxtrot', icon: 'flag' },
    { label: 'ECHO', href: 'customers.html?team=echo', icon: 'flag' },
    { label: 'Quality Assurance', href: 'qa.html', icon: 'shield', kids: [
      { label: 'Social Media Monitoring', href: 'social-media-monitoring.html', icon: 'share' } ] },
    { label: 'Knowledge Base', href: 'kb.html', icon: 'book' },
    { label: 'Reports', href: 'reports.html', icon: 'bars' },
    { label: 'OpenAI', mainLabel: 'Billing', mainIcon: 'card', href: 'openai.html', icon: 'clock', kids: [
      { label: 'SMS Monitoring', href: 'sms-monitoring.html', icon: 'chat' },
      { label: 'Division Billing', href: 'division-billing.html', icon: 'bank' } ] },
    { label: 'Settings', href: 'settings.html', icon: 'gear' },
  ];
  const getHidden = () => { try { return localStorage.getItem(KEY) === 'true'; } catch (e) { return false; } };
  const setHidden = v => { try { localStorage.setItem(KEY, v ? 'true' : 'false'); } catch (e) {} };

  const css = `
  body.sb-top .app > .sidebar, body.sb-top aside.sidebar{display:none !important;}
  body.sb-top .sidebar-show-btn{display:none !important;}
  body.sb-top .app{padding-top:56px;}
  .sb-topnav{display:none;position:fixed;top:0;left:0;right:0;height:56px;z-index:90;align-items:center;gap:6px;padding:0 14px;
    background:#0B1220;border-bottom:1px solid rgba(255,255,255,.08);box-shadow:0 6px 18px -10px rgba(0,0,0,.5);font-family:inherit;}
  body.sb-top .sb-topnav{display:flex;}
  .sb-topnav .tn-brand{display:flex;align-items:center;gap:8px;color:#fff;font-weight:700;font-size:13.5px;white-space:nowrap;margin-right:8px;text-decoration:none;}
  .sb-topnav .tn-brand img{width:28px;height:28px;border-radius:8px;object-fit:cover;}
  .sb-topnav .tn-links{display:flex;align-items:center;gap:2px;overflow-x:auto;flex:1;min-width:0;scrollbar-width:thin;}
  .sb-topnav .tn-links::-webkit-scrollbar{height:4px;}
  .sb-topnav .tn-links::-webkit-scrollbar-thumb{background:#1F2A40;border-radius:4px;}
  .sb-topnav .tn-links a{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border-radius:9px;color:#AEBBD1;text-decoration:none;
    font-size:13px;font-weight:600;white-space:nowrap;transition:background .15s,color .15s;}
  .sb-topnav .tn-links a:hover{background:#151E30;color:#fff;}
  .sb-topnav .tn-links a.active{background:#2563EB;color:#fff;}
  .sb-topnav .tn-links a.tn-sub{font-size:12px;font-weight:500;color:#8DA2C0;}
  .sb-topnav .tn-links a.tn-sub.active{color:#fff;}
  .sb-topnav .tn-links svg{width:16px;height:16px;flex-shrink:0;}
  .sb-topnav .tn-drop{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border-radius:9px;color:#AEBBD1;background:none;border:none;cursor:pointer;
    font-size:13px;font-weight:600;white-space:nowrap;font-family:inherit;transition:background .15s,color .15s;}
  .sb-topnav .tn-drop:hover{background:#151E30;color:#fff;}
  .sb-topnav .tn-drop.active{background:#2563EB;color:#fff;}
  .sb-topnav .tn-drop svg{width:16px;height:16px;flex-shrink:0;}
  .sb-topnav .tn-drop svg.caret{width:12px;height:12px;opacity:.75;margin-left:-2px;}
  .tn-menu{display:none;position:fixed;top:52px;z-index:95;min-width:220px;padding:6px;border-radius:12px;background:#0F1729;
    border:1px solid rgba(255,255,255,.1);box-shadow:0 16px 36px -12px rgba(0,0,0,.6);font-family:inherit;}
  .tn-menu.open{display:block;}
  .tn-menu a{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:8px;color:#C5D0E2;text-decoration:none;font-size:13px;font-weight:600;white-space:nowrap;}
  .tn-menu a:hover{background:#1C273B;color:#fff;}
  .tn-menu a.active{background:#2563EB;color:#fff;}
  .tn-menu svg{width:16px;height:16px;flex-shrink:0;}
  .sb-topnav .tn-show{display:inline-flex;align-items:center;gap:7px;flex-shrink:0;margin-left:6px;padding:8px 12px;border-radius:9px;border:none;cursor:pointer;
    background:#151E30;color:#AEBBD1;font-size:12.5px;font-weight:600;font-family:inherit;}
  .sb-topnav .tn-show:hover{background:#1C273B;color:#fff;}
  .sb-topnav .tn-show svg{width:15px;height:15px;}
  .sb-hide-btn{width:100%;margin-top:auto;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;border-radius:10px;
    background:#151E30;border:none;color:#AEBBD1;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;font-family:inherit;}
  .sb-hide-btn:hover{background:#1C273B;color:#fff;}
  .sb-hide-btn svg{width:15px;height:15px;flex-shrink:0;}
  @media (max-width:640px){ .sb-topnav .tn-brand span{display:none;} .sb-topnav .tn-show span{display:none;} }
  `;

  function init() {
    const sidebar = document.querySelector('aside.sidebar') || document.querySelector('.sidebar');
    if (!sidebar) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

    // ---- Top bar: kopya ng mga link ng sidebar ----
    const nav = document.createElement('nav');
    nav.className = 'sb-topnav'; nav.setAttribute('aria-label', 'Main menu');
    const logo = sidebar.querySelector('.brand img, .brand-mark');
    const brandName = (sidebar.querySelector('.brand-name')?.childNodes[0]?.textContent || 'CSR Dashboard').trim();
    nav.innerHTML = `<a class="tn-brand" href="csr-dashboard.html">${logo ? `<img src="${logo.getAttribute('src')}" alt="">` : ''}<span>${brandName}</span></a><div class="tn-links"></div>
      <button type="button" class="tn-show" title="Ibalik ang sidebar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg><span>Sidebar</span></button>`;
    const links = nav.querySelector('.tn-links');
    // IISANG MENU PARA SA LAHAT NG PAGE (v2, 2026-10-13): hindi na kinokopya
    // ang sidebar ng page (magkakaiba pala ang sidebar ng bawat page — hal.
    // walang laman ang top bar sa KB, at nawawala ang sub-pages ng OpenAI).
    // May dropdown (▾) ang item na may sub-pages.
    const here = (location.pathname.split('/').pop() || 'csr-dashboard').replace(/\.html$/, '') || 'csr-dashboard';
    const hereTeam = (new URLSearchParams(location.search).get('team') || '').toLowerCase();
    const isHere = h => {
      const [path, q] = h.split('?');
      if (path.replace(/\.html$/, '') !== here) return false;
      return (new URLSearchParams(q || '').get('team') || '').toLowerCase() === hereTeam;
    };
    // Ilagay ang 4 na team tab sa sidebar ng page, sa ibaba ng Customers
    (function addTeamsToSidebar() {
      const cust = [...sidebar.querySelectorAll('a.nav-item')].find(a => pageKey(a.getAttribute('href')) === 'customers' && !/team=/.test(a.getAttribute('href') || ''));
      if (!cust || sidebar.querySelector('a.nav-item[data-team]')) return;
      if (hereTeam) cust.classList.remove('active');
      let after = cust;
      MENU.filter(m => /\?team=/.test(m.href)).forEach(m => {
        const a = document.createElement('a');
        a.href = m.href; a.className = 'nav-item' + (isHere(m.href) ? ' active' : '');
        a.dataset.team = m.label.toLowerCase();
        a.innerHTML = ICON[m.icon] + '<span>' + m.label + '</span>';
        after.insertAdjacentElement('afterend', a); after = a;
      });
    })();
    MENU.forEach(item => {
      const kids = item.kids || [];
      const groupActive = isHere(item.href) || kids.some(k => isHere(k.href));
      if (!kids.length) {
        const a = document.createElement('a');
        a.href = item.href; a.innerHTML = ICON[item.icon] + item.label;
        if (groupActive) a.className = 'active';
        links.appendChild(a); return;
      }
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tn-drop' + (groupActive ? ' active' : ''); b.dataset.href = item.href;
      b.innerHTML = ICON[item.icon] + item.label + '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>';
      const menu = document.createElement('div');
      menu.className = 'tn-menu';
      [{ label: item.mainLabel || item.label, href: item.href, icon: item.mainIcon || item.icon }, ...kids].forEach(k => {
        const a = document.createElement('a');
        a.href = k.href; a.innerHTML = ICON[k.icon] + k.label;
        if (isHere(k.href)) a.className = 'active';
        menu.appendChild(a);
      });
      document.body.appendChild(menu);
      let closeT = null;
      const open = () => {
        clearTimeout(closeT);
        document.querySelectorAll('.tn-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
        const r = b.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 240)) + 'px';
        menu.classList.add('open');
      };
      const close = () => { closeT = setTimeout(() => menu.classList.remove('open'), 180); };
      b.addEventListener('mouseenter', open); b.addEventListener('mouseleave', close);
      menu.addEventListener('mouseenter', () => clearTimeout(closeT)); menu.addEventListener('mouseleave', close);
      b.addEventListener('click', e => { e.stopPropagation(); menu.classList.contains('open') ? menu.classList.remove('open') : open(); });
      links.appendChild(b);
    });
    document.addEventListener('click', () => document.querySelectorAll('.tn-menu.open').forEach(m => m.classList.remove('open')));
    links.addEventListener('scroll', () => document.querySelectorAll('.tn-menu.open').forEach(m => m.classList.remove('open')));
    document.body.insertBefore(nav, document.body.firstChild);

    // ---- "Hide sidebar" button sa ibaba ng sidebar ----
    let hideBtn = document.getElementById('sidebarToggleBtn');   // Dashboard: dati nang meron
    if (!hideBtn) {
      hideBtn = document.createElement('button');
      hideBtn.type = 'button'; hideBtn.className = 'sb-hide-btn'; hideBtn.title = 'Hide sidebar — ililipat ang menu sa itaas';
      hideBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>Hide sidebar';
      sidebar.appendChild(hideBtn);
    }
    hideBtn.onclick = e => { e.preventDefault(); apply(true); };
    nav.querySelector('.tn-show').onclick = () => apply(false);
    // Dashboard: ang lumang toggleSidebar() ay dito na rin dadaan
    window.toggleSidebar = () => apply(!document.body.classList.contains('sb-top'));

    function apply(hidden) {
      document.body.classList.toggle('sb-top', hidden);
      sidebar.classList.remove('collapsed');                 // lumang paraan ng Dashboard — hindi na gamit
      document.getElementById('sidebarShowBtn')?.classList.remove('visible');
      setHidden(hidden);
      // para mag-ayos ng sukat ang mga chart
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
    apply(getHidden());
    filterMenus(getRole());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
