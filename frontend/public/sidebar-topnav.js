/* =====================================================================
   SIDEBAR → TOP NAV (2026-10-13, utos ni Chad)
   Kapag hinide ang sidebar ("Hide sidebar" sa ibaba ng sidebar), lilipat
   ang menu sa ITAAS ng page bilang pahalang na top bar. Ang "☰ Sidebar"
   button sa kanan ng top bar ang magbabalik ng sidebar.
   - Iisang file para sa LAHAT ng page — isama lang sa dulo ng <body>:
       <script src="sidebar-topnav.js?v=1"></script>
   - Kinokopya ang mga link mula mismo sa sidebar ng page, kaya kapag
     may binago sa sidebar, kasama na agad sa top bar.
   - Naaalala ang pinili (localStorage 'csr_sidebar_hidden'), pareho ng
     dating "Hide sidebar" ng Dashboard.
   ===================================================================== */
(function () {
  if (window.__sbTopNav) return; window.__sbTopNav = true;
  const KEY = 'csr_sidebar_hidden';
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
    sidebar.querySelectorAll('.nav-group a.nav-item, nav a.nav-item').forEach(a => {
      if (!a.getAttribute('href')) return;
      const c = a.cloneNode(true);
      c.removeAttribute('id'); c.removeAttribute('onclick');
      c.querySelectorAll('.nav-chev, .badge, [id]').forEach(x => { if (x.classList.contains('nav-chev')) x.remove(); else x.removeAttribute('id'); });
      c.className = (a.classList.contains('active') ? 'active ' : '') + (a.closest('.nav-sub') ? 'tn-sub' : '');
      links.appendChild(c);
    });
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
