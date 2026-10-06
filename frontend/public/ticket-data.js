<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Analytics — CSR Dashboard</title>
<link rel="icon" type="image/x-icon" href="favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
<script src="ticket-data.js?v=15"></script>
<style>
  :root{
    --primary:#2563EB; --primary-dark:#1D4ED8; --primary-tint:#EFF4FF;
    --success:#22C55E; --success-tint:#EAFBF1;
    --warning:#F59E0B; --warning-tint:#FEF6E7;
    --danger:#EF4444;  --danger-tint:#FDECEC;
    --purple:#8B5CF6;  --purple-tint:#F3EEFE;
    --teal:#14B8A6;    --teal-tint:#E9FAF8;
    --bg:#F8FAFC; --card:#FFFFFF;
    --ink:#0F172A; --ink-soft:#475569; --ink-faint:#94A3B8;
    --line:#EEF1F6; --rule:#D8DFE9;
    --radius-sm:10px; --radius-md:14px; --radius-lg:18px;
    --shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10);
    /* The two months keep the same colour in every chart, table and legend,
       so the eye never has to re-learn which is which. */
    --month-a:#94A3B8;   /* comparison month */
    --month-b:#2563EB;   /* report month */
  }
  *{box-sizing:border-box;}
  body{margin:0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:var(--bg);color:var(--ink);}
  a{color:inherit;text-decoration:none;}
  button{font-family:inherit;}
  .app{display:flex;min-height:100vh;}

  .sidebar{width:248px;flex-shrink:0;background:#0B1220;color:#CBD5E1;display:flex;flex-direction:column;padding:22px 16px;position:sticky;top:0;height:100vh;}
  .brand{display:flex;align-items:center;gap:10px;padding:4px 8px 22px;}
  .brand-mark{width:36px;height:36px;border-radius:10px;object-fit:cover;flex-shrink:0;}
  .brand-name{font-size:14px;font-weight:700;color:#fff;line-height:1.25;}
  .brand-name span{display:block;font-weight:500;color:#8DA2C0;font-size:12px;}
  .nav-group{margin-bottom:6px;}
  .nav-item{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;font-size:13.5px;font-weight:500;color:#AEBBD1;cursor:pointer;transition:background .15s,color .15s;margin-bottom:2px;}
  .nav-item svg{width:18px;height:18px;flex-shrink:0;}
  .nav-item:hover{background:#151E30;color:#fff;}
  .nav-item.active{background:var(--primary);color:#fff;}
  .sidebar-status{margin-top:auto;background:#151E30;border-radius:12px;padding:11px 12px;font-size:12.5px;display:flex;align-items:center;gap:8px;color:#AEBBD1;}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--success);flex-shrink:0;box-shadow:0 0 0 3px rgba(34,197,94,.18);}

  .main{flex:1;min-width:0;padding:26px 32px 40px;}

  /* TITLE BAR */
  .titlebar{background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--shadow);border-top:5px solid var(--primary);padding:26px 28px 0;margin-bottom:18px;}
  .titlebar-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;}
  .titlebar h1{margin:0;font-size:25px;font-weight:800;letter-spacing:-.02em;line-height:1.15;}
  .titlebar .period{display:block;font-size:25px;font-weight:400;color:var(--ink-faint);letter-spacing:-.02em;}
  .titlebar .meta{margin:10px 0 0;font-size:12.5px;color:var(--ink-soft);}
  .titlebar-actions{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;}
  .period-field{display:flex;flex-direction:column;gap:4px;}
  .period-field span{font-size:10.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-faint);}
  .period-select{font:inherit;font-size:12.5px;font-weight:700;padding:8px 12px;border-radius:8px;border:1px solid var(--rule);background:var(--card);color:var(--ink);cursor:pointer;min-width:170px;}
  .date-filter-wrap{position:relative;}
  .custom-date-pop{display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px -12px rgba(15,23,42,.25);padding:16px;z-index:60;width:300px;}
  .custom-date-pop.open{display:block;}
  .custom-date-pop .pop-title{font-size:12px;font-weight:800;color:var(--ink);margin-bottom:8px;}
  .custom-date-pop .pop-title span{font-weight:600;color:var(--ink-faint);font-size:11px;margin-left:4px;}
  .custom-date-pop .pop-row{display:flex;gap:8px;}
  .custom-date-pop .pop-row label{flex:1;display:flex;flex-direction:column;gap:4px;font-size:10.5px;font-weight:700;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.02em;}
  .custom-date-pop input[type="date"]{width:100%;padding:7px 8px;border-radius:8px;border:1px solid var(--line);font:inherit;font-size:12px;color:var(--ink);background:var(--bg);text-transform:none;}
  .custom-date-pop .pop-hint{font-size:11px;color:var(--ink-faint);margin-top:8px;line-height:1.45;}
  .custom-date-pop .pop-error{font-size:11.5px;color:var(--danger);min-height:14px;margin-top:6px;}
  .custom-date-actions{display:flex;gap:8px;margin-top:10px;}
  .custom-date-actions button{flex:1;padding:8px 10px;border-radius:8px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink-soft);}
  .custom-date-actions #rpApply{background:var(--primary);color:#fff;border-color:var(--primary);}
  #compareLine:empty{display:none;}
  #compareLine{color:var(--ink);font-weight:600;}

  .subtabs{display:flex;gap:2px;margin-top:22px;border-bottom:1px solid var(--line);overflow-x:auto;}
  .subtab{font-size:13px;font-weight:700;padding:12px 16px;color:var(--ink-faint);cursor:pointer;border:none;background:none;font-family:inherit;white-space:nowrap;border-bottom:3px solid transparent;margin-bottom:-1px;}
  .subtab:hover{color:var(--ink-soft);}
  .subtab.active{color:var(--primary);border-bottom-color:var(--primary);}
  .report-page{display:none;}
  .report-page.active{display:block;}

  .btn{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;padding:9px 14px;border-radius:8px;border:1px solid var(--rule);background:var(--card);color:var(--ink);cursor:pointer;}
  .btn svg{width:15px;height:15px;}
  .btn.primary{background:var(--primary);border-color:var(--primary);color:#fff;}
  .tabs{display:flex;gap:4px;background:#F1F5F9;border-radius:8px;padding:3px;}
  .tab{font-size:12px;font-weight:700;padding:6px 12px;border-radius:6px;color:var(--ink-soft);cursor:pointer;border:none;background:transparent;font-family:inherit;}
  .tab.active{background:var(--card);color:var(--primary);box-shadow:0 1px 2px rgba(0,0,0,.08);}

  .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:14px;margin-bottom:14px;}
  .kpi-card{background:var(--card);border-radius:var(--radius-md);padding:16px;box-shadow:var(--shadow);}
  .kpi-card.accent-a{border-left:4px solid var(--month-a);}
  .kpi-card.accent-b{border-left:4px solid var(--month-b);}
  .kpi-card.accent-ok{border-left:4px solid var(--success);}
  .kpi-card.accent-bad{border-left:4px solid var(--danger);}
  .kpi-label{font-size:12px;color:var(--ink-soft);font-weight:600;margin-bottom:8px;}
  .kpi-value{font-size:27px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1;}
  .kpi-delta{font-size:11.5px;font-weight:700;margin-top:6px;}
  .up{color:var(--success);} .down{color:var(--danger);} .flat{color:var(--ink-faint);}

  .panel{background:var(--card);border-radius:var(--radius-md);box-shadow:var(--shadow);padding:18px;margin-bottom:14px;}
  .panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px;flex-wrap:wrap;}
  .panel-head h3{margin:0;font-size:14.5px;font-weight:700;}
  .panel-head .hint{font-size:11.5px;color:var(--ink-faint);font-weight:600;}
  .cols-2{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;}

  .section-head{display:flex;align-items:baseline;gap:14px;padding-bottom:10px;border-bottom:2px solid var(--ink);margin-bottom:16px;flex-wrap:wrap;}
  .section-head h2{margin:0;font-weight:800;letter-spacing:-.015em;}
  .section-head .lede{margin-left:auto;font-size:12.5px;color:var(--ink-faint);font-weight:600;}

  /* Reasons stacked inside one table cell — the Top 5 players table shows
     every reason a player gave, each one opening its own conversation. */
  .reason-list{display:flex;flex-direction:column;gap:6px;}
  .reason-item{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;background:#F8FAFC;}
  .reason-item:hover{background:var(--primary-tint);}
  .reason-item .sev-pill{flex-shrink:0;margin-top:1px;}
  .reason-item .txt{font-size:12.5px;color:var(--ink);line-height:1.45;word-break:break-word;}
  .reason-item .when{margin-left:auto;font-size:11px;color:var(--ink-faint);white-space:nowrap;padding-left:8px;}
  .reason-none{font-size:12.5px;color:var(--ink-faint);font-style:italic;}

  .legend{display:flex;gap:16px;flex-wrap:wrap;}
  .legend-row{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ink-soft);font-weight:600;}
  .legend-row .sw{width:10px;height:10px;border-radius:3px;flex-shrink:0;}

  table.rt{width:100%;border-collapse:collapse;}
  table.rt th{text-align:left;font-size:11px;letter-spacing:.02em;color:var(--ink-faint);font-weight:700;padding:0 8px 9px;border-bottom:1px solid var(--rule);white-space:nowrap;}
  table.rt td{padding:10px 8px;font-size:13px;border-bottom:1px solid var(--line);}
  table.rt tr:last-child td{border-bottom:none;}
  table.rt td.num, table.rt th.num{text-align:right;font-variant-numeric:tabular-nums;}
  table.rt td.num{font-weight:700;}
  table.rt tfoot td{border-top:2px solid var(--rule);border-bottom:none;font-weight:800;background:#F8FAFC;}
  .scroll{overflow-x:auto;}
  .tall{max-height:440px;overflow-y:auto;}

  .bar-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);}
  .bar-row:last-child{border-bottom:none;}
  .bar-row.pick{cursor:pointer;padding-left:6px;padding-right:6px;margin:0 -6px;border-radius:8px;}
  .bar-row.pick:hover{background:#F8FAFC;}
  .bar-row.pick:hover .bar-label{color:var(--primary);}
  .bar-row.pick.on{background:var(--primary-tint);}
  .bar-label{font-size:12.5px;font-weight:600;width:140px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .bar-track{flex:1;height:8px;background:#F1F5F9;border-radius:4px;overflow:hidden;}
  .bar-fill{height:100%;border-radius:4px;}
  .bar-val{font-size:12.5px;font-weight:800;width:58px;text-align:right;font-variant-numeric:tabular-nums;}
  .bar-sub{font-size:11px;color:var(--ink-faint);width:108px;text-align:right;white-space:nowrap;}

  /* Ranked list — used for the top concerns, where the order is the point. */
  .rank-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);}
  .rank-row:last-child{border-bottom:none;}
  .rank-badge{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0;}
  .rank-main{flex:1;min-width:0;}
  .rank-name{font-size:13px;font-weight:700;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .rank-track{height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden;}
  .rank-fill{height:100%;border-radius:3px;}
  .rank-count{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;min-width:56px;text-align:right;}
  .rank-share{font-size:11px;color:var(--ink-faint);font-weight:600;min-width:44px;text-align:right;}

  .agent-cell{display:flex;align-items:center;gap:9px;}
  .av-xs{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:11px;overflow:hidden;}
  .av-xs img{width:100%;height:100%;object-fit:cover;display:block;}

  .donut-wrap{position:relative;display:flex;justify-content:center;}
  .donut-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;}
  .donut-center .num{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;}
  .donut-center .lab{font-size:10.5px;color:var(--ink-soft);font-weight:600;}

  .tag{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;display:inline-block;white-space:nowrap;}
  .tag.good{background:var(--success-tint);color:var(--success);}
  .tag.mid{background:var(--warning-tint);color:#B45309;}
  .tag.bad{background:var(--danger-tint);color:var(--danger);}
  .tag.neutral{background:#F1F5F9;color:var(--ink-soft);}
  .note{color:var(--ink-faint);font-size:12.5px;padding:20px 4px;text-align:center;}
  .speed-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .speed-card{border:1px solid var(--line);border-radius:12px;padding:16px;}
  .speed-card .kpi-value{font-size:30px;}
  .speed-note{font-size:12px;color:var(--ink-faint);line-height:1.6;margin-top:14px;}
  .t-fast{color:var(--success);}
  .sla-pass{color:var(--success);font-weight:800;letter-spacing:.02em;}
  .sla-fail{color:var(--danger);font-weight:800;letter-spacing:.02em;}
  .sla-table th:nth-child(4), .sla-table td:nth-child(4),
  .sla-table th:nth-child(7), .sla-table td:nth-child(7){border-left:1px solid var(--line);}
  .t-slow{color:#B45309;}
  .flag{background:var(--warning-tint);color:#92620A;border-radius:10px;padding:11px 14px;font-size:12.5px;font-weight:600;line-height:1.5;margin-bottom:14px;}

  /* Clickable KPI cards — used on Customer Satisfaction, where a figure is
     also the way into the remarks behind it. Same interaction as the
     Customers and QA pages: click to filter, click again to clear. */
  .kpi-card.clickable{cursor:pointer;border:2px solid transparent;transition:transform .12s,border-color .12s;}
  .kpi-card.clickable:hover{transform:translateY(-1px);}
  .kpi-card.clickable.on{border-color:var(--primary);}
  .kpi-card.clickable.on.bad{border-color:var(--danger);}

  .sev-pill{font-size:10px;font-weight:800;padding:3px 9px;border-radius:20px;display:inline-block;white-space:nowrap;}
  .sev-pill.high{background:var(--danger-tint);color:var(--danger);}
  .sev-pill.medium{background:var(--warning-tint);color:#B45309;}
  .sev-pill.low{background:#F1F5F9;color:var(--ink-faint);}
  .remarks{font-size:12.5px;color:var(--ink-soft);line-height:1.5;max-width:420px;word-break:break-word;}
  .remarks.empty{color:var(--ink-faint);font-style:italic;}
  .c-av{width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:11px;}
  .rowlink tbody tr{cursor:pointer;}
  .rowlink tbody tr:hover{background:#F8FAFC;}

  /* THREAD MODAL — same markup and behaviour as customers.html and qa.html,
     so a remark opens the actual conversation from inside the report. */
  .modal-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100;align-items:center;justify-content:center;padding:24px;}
  .modal-overlay.open{display:flex;}
  .modal-panel{background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--shadow);width:100%;max-width:560px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;}
  .modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--line);flex-shrink:0;}
  .modal-title{font-size:15px;font-weight:800;}
  .modal-sub{font-size:12px;color:var(--ink-faint);margin-top:2px;}
  .modal-close{width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:var(--card);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .modal-close svg{width:15px;height:15px;color:var(--ink-soft);}
  .modal-body{padding:18px 20px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:12px;}
  .msg-row{display:flex;flex-direction:column;max-width:82%;}
  .msg-row.from-customer{align-self:flex-start;align-items:flex-start;}
  .msg-row.from-agent{align-self:flex-end;align-items:flex-end;}
  .msg-meta{font-size:11px;color:var(--ink-faint);margin-bottom:3px;padding:0 3px;}
  .msg-bubble{padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}
  .from-customer .msg-bubble{background:var(--bg);color:var(--ink);border-bottom-left-radius:4px;}
  .from-agent .msg-bubble{background:var(--primary);color:#fff;border-bottom-right-radius:4px;}
  .from-agent.is-bot .msg-bubble{background:var(--purple);}
  .msg-row.from-system{align-self:center;align-items:center;max-width:90%;}
  .from-system .msg-bubble{background:#F1F5F9;color:var(--ink-faint);font-size:12px;font-style:italic;text-align:center;border-radius:10px;}

  @media (max-width:860px){
    .sidebar{display:none;}
    .main{padding:20px 16px 32px;}
    .titlebar{padding:20px 18px 0;}
    .titlebar h1,.titlebar .period{font-size:20px;}
    .cols-2{grid-template-columns:1fr;}
  }

  @media print{
    @page{size:A4 landscape;margin:12mm;}
    body{background:#fff;}
    .sidebar,.titlebar-actions,.subtabs,.no-print{display:none !important;}
    .app{display:block;}
    .main{padding:0;}
    .titlebar{box-shadow:none;border-radius:0;border-top:none;border-bottom:3px solid var(--ink);padding:0 0 14px;}
    .panel{box-shadow:none;border:1px solid var(--rule);break-inside:avoid;}
    .tall{max-height:none;overflow:visible;}
  }
</style>
<style>
  .grid-brands{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;}
  .brand-card{border:1px solid var(--line);border-radius:12px;padding:14px;}
  .brand-card h4{margin:0 0 2px;font-size:14px;font-weight:800;}
  .brand-card .sub{font-size:11.5px;color:var(--ink-faint);font-weight:600;margin-bottom:8px;}
  .mini-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:12.5px;}
  .mini-row:last-child{border-bottom:none;}
  .mini-row .n{margin-left:auto;font-weight:800;font-variant-numeric:tabular-nums;}
  .mini-row .p{color:var(--ink-faint);font-size:11px;min-width:46px;text-align:right;}
  .mini-row .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .pill-a,.pill-b{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px;}
  .pill-a{background:var(--month-a);} .pill-b{background:var(--month-b);}
  .loading{color:var(--ink-faint);font-size:12.5px;padding:16px 4px;}
  .err{background:var(--danger-tint);color:var(--danger);border-radius:10px;padding:10px 12px;font-size:12.5px;font-weight:600;}
  section.block{margin-top:26px;}
</style>
</head>
<body>
<script>
  // ---- Auth check: same pipeline_token + Railway API as the rest of the console ----
  const API_BASE = "https://pipeline-crm-production-412d.up.railway.app/api";
  const LOGIN_PATH = "/login";
  (async function checkAuth() {
    const token = localStorage.getItem("pipeline_token");
    if (!token) { window.location.href = LOGIN_PATH; return; }
    try {
      const res = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Invalid session");
      const data = await res.json();
      const user = data.user || data;
      if (user && user.name) document.getElementById('preparedBy').textContent = user.name;
    } catch (err) {
      localStorage.removeItem("pipeline_token");
      window.location.href = LOGIN_PATH;
    }
  })();
</script>
<div class="app">

  <aside class="sidebar">
    <div class="brand">
      <img src="logo.png" alt="CSR Dashboard logo" class="brand-mark">
      <div class="brand-name">CSR Dashboard<span>Support Console</span></div>
    </div>
    <div class="nav-group">
      <a href="csr-dashboard.html" class="nav-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>
        Dashboard
      </a>
      <a href="tickets.html" class="nav-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v3a2 2 0 000 4v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 000-4V8z"/></svg>
        Tickets
      </a>
      <a href="customers.html" class="nav-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        Customers
      </a>
      <a href="reports.html" class="nav-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
        Reports
      </a>
      <a href="analytics.html" class="nav-item active">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>
        Analytics
      </a>
      <a href="openai.html" class="nav-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        OpenAI
      </a>
      <a href="agents.html" class="nav-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        Agents
      </a>
      <a href="settings.html" class="nav-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.5-1.5M5.5 18.5L7 17M17 17l1.5 1.5M5.5 5.5L7 7"/></svg>
        Settings
      </a>
    </div>
    <div class="sidebar-status" style="margin-top:12px;"><span class="dot"></span> Online — Connected as CSR</div>
  </aside>

  <main class="main">
    <header class="titlebar" style="padding-bottom:22px;">
      <div class="titlebar-top">
        <div>
          <h1>Analytics — Month vs Month<span class="period" id="periodTitle">—</span></h1>
          <p class="meta"><span class="pill-a"></span><span id="legendA">—</span> &nbsp; <span class="pill-b"></span><span id="legendB">—</span><br>Prepared by <span id="preparedBy">—</span> · generated <span id="generatedAt">—</span></p>
        </div>
        <div class="titlebar-actions no-print">
          <div class="period-field">
            <span>Report month (vs month before)</span>
            <select class="period-select" id="modeSel"></select>
          </div>
          <button class="btn" id="refreshBtn">Refresh</button>
          <button class="btn primary" onclick="window.print()">Print / PDF</button>
        </div>
      </div>
    </header>

    <!-- 1. CHATS -->
    <section class="block">
      <div class="section-head"><h2>1. Chats comparison</h2><span class="lede">Chat volume sheet (messages received) · CSAT from live data</span></div>
      <div id="chatErr"></div>
      <div class="kpi-row" id="chatKpis"><div class="loading">Loading chats…</div></div>
      <div class="cols-2">
        <div class="panel">
          <div class="panel-head"><h3>Total chats by brand</h3><span class="hint">Messages received, from the chat volume sheet</span></div>
          <div style="height:340px;"><canvas id="chatChart"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Side by side</h3><span class="hint">Sorted by report month volume</span></div>
          <div class="scroll tall" id="chatTable"></div>
        </div>
      </div>
    </section>

    <!-- 2. TICKETS -->
    <section class="block">
      <div class="section-head"><h2>2. Tickets &amp; resolution</h2><span class="lede">Report month only · from the ticket sheets</span></div>
      <div id="tkErr"></div>
      <div class="kpi-row" id="tkKpis"><div class="loading">Loading ticket sheets…</div></div>
      <div class="cols-2">
        <div class="panel">
          <div class="panel-head"><h3>Top 5 ticket concerns</h3><span class="hint" id="topHint">—</span></div>
          <div id="topConcerns"></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Resolution by brand</h3><span class="hint">Report month only</span></div>
          <div class="scroll tall" id="resoTable"></div>
        </div>
      </div>
    </section>

    <!-- 3. CUSTOMERS PER BRAND -->
    <section class="block">
      <div class="section-head"><h2>3. Customers per brand</h2><span class="lede">Unique customers who filed a ticket · report month only</span></div>
      <div class="panel"><div class="scroll" id="custTable"><div class="loading">Loading…</div></div></div>
    </section>

    <!-- 4. TOP 5 REASONS PER BRAND -->
    <section class="block">
      <div class="section-head"><h2>4. Top 5 reasons per brand</h2><span class="lede" id="perBrandLede">Report month · comparison month in grey</span></div>
      <div class="grid-brands" id="perBrand"><div class="loading">Loading…</div></div>
    </section>

    <!-- 5. OPENAI -->
    <section class="block">
      <div class="section-head"><h2>5. OpenAI totals</h2><span class="lede">All accounts · OpenAI Costs API</span></div>
      <div id="aiErr"></div>
      <div class="kpi-row" id="aiKpis"><div class="loading">Loading OpenAI costs… (may take up to a minute)</div></div>
      <div class="panel"><div class="panel-head"><h3>Per account</h3><span class="hint" id="aiAsOf">—</span></div><div class="scroll" id="aiTable"></div></div>
    </section>
  </main>
</div>

<script>
const { escapeHtml } = TicketData;
const fmtInt = n => (n == null ? '—' : Math.round(n).toLocaleString());
const fmtUsd = n => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtPhp = n => (n == null ? '' : '₱' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const RANK_COLORS = ['#EF4444','#F59E0B','#EAB308','#3B82F6','#8B5CF6'];

// Same chat brand labels as reports.html
const CHAT_BRAND_LABELS = {
  buenasph: 'Buenas Cash', tmtcash: 'TMT Cash', mcp: 'Mobile Play Casino', manilaplayph: 'Manila Play',
  HypleplayPH: 'Hype Play', HypeplayBD: 'Hype BDT', Tmtplay: 'TMT Play', MGK: 'MGK',
  BuenasCredit: 'Buenas Credits', LuckystacksPH: 'LuckyStacks',
  casinyeam: 'Casinyeam', manilacasino: 'Mc88', superscatterph: 'Super Scatter PH',
  'livechat-general': 'LC General',
};
const chatBrandLabel = s => (!s ? 'Unknown' : CHAT_BRAND_LABELS[s] || s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

async function apiGet(path) {
  const token = localStorage.getItem('pipeline_token');
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j.error) msg += ` — ${j.error}`; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

// ---- Periods (Manila time, UTC+8) ----
// A = last month, B = this month to date. "same" mode trims A to the same
// number of days elapsed in B, so a partial month is compared fairly.
const MNL = 8 * 3600 * 1000;
function mnlMidnight(y, m, d) { return new Date(Date.UTC(y, m, d) - MNL); }
function mnlParts(date) { const t = new Date(date.getTime() + MNL); return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() }; }
function ymd(y, m, d) { const t = new Date(Date.UTC(y, m, d)); return t.toISOString().slice(0, 10); }

// offset = how many months back the REPORT month is (0 = this month, 1 = last
// month). The comparison is always the month before it, in full. When the
// report month is the running month, the comparison is trimmed to the same
// days (1 → today) so a partial month isn't compared with a full one.
function buildPeriods(offset) {
  const now = new Date();
  const p = mnlParts(now);
  const bStart = mnlMidnight(p.y, p.m - offset, 1);
  const bNext = mnlMidnight(p.y, p.m - offset + 1, 1);
  const bm = mnlParts(bStart);
  const aStart = mnlMidnight(bm.y, bm.m - 1, 1);
  const am = mnlParts(aStart);
  const daysInA = new Date(Date.UTC(am.y, am.m + 1, 0)).getUTCDate();
  const daysInB = new Date(Date.UTC(bm.y, bm.m + 1, 0)).getUTCDate();
  const running = offset === 0;
  const bDays = running ? p.d : daysInB;
  const aDays = running ? Math.min(p.d, daysInA) : daysInA;
  const bEnd = running ? now : new Date(bNext.getTime() - 1);
  const aEnd = new Date(mnlMidnight(am.y, am.m, aDays + 1).getTime() - 1);
  const lab = (m, last, full) => full ? `${SHORT[m]} 1–${last}` : `${SHORT[m]} 1–${last}`;
  return {
    running,
    A: { from: aStart, to: aEnd, days: aDays, label: lab(am.m, aDays), month: MONTHS[am.m],
         startYmd: ymd(am.y, am.m, 1), endYmd: ymd(am.y, am.m, aDays) },
    B: { from: bStart, to: bEnd, days: bDays, label: lab(bm.m, bDays), month: MONTHS[bm.m],
         startYmd: ymd(bm.y, bm.m, 1), endYmd: ymd(bm.y, bm.m, bDays) },
  };
}

// Month picker: last 6 months, default = last COMPLETED month (e.g. Sep → vs Aug).
(function fillMonths() {
  const sel = document.getElementById('modeSel');
  const p = mnlParts(new Date());
  for (let off = 1; off <= 6; off++) {
    const b = mnlParts(mnlMidnight(p.y, p.m - off, 1)), a = mnlParts(mnlMidnight(p.y, p.m - off - 1, 1));
    sel.add(new Option(`${MONTHS[a.m]} vs ${MONTHS[b.m]} ${b.y}`, String(off)));
  }
  const pa = mnlParts(mnlMidnight(p.y, p.m - 1, 1));
  sel.add(new Option(`${MONTHS[pa.m]} vs ${MONTHS[p.m]} (to date)`, '0'));
  sel.value = '1';
})();
let P = buildPeriods(1);
const qs = per => `from=${encodeURIComponent(per.from.toISOString())}&to=${encodeURIComponent(per.to.toISOString())}`;

function delta(cur, prev, invert) {
  if (cur == null || prev == null || prev === 0) return '<span class="flat">—</span>';
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return '<span class="flat">level</span>';
  const good = invert ? pct < 0 : pct > 0;
  return `<span class="${good ? 'up' : 'down'}">${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%</span>`;
}
function kpi(label, a, b, fmt, extra, invert) {
  fmt = fmt || fmtInt;
  return `<div class="kpi-card accent-b">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${fmt(b)}</div>
    <div class="kpi-delta">${delta(b, a, invert)} <span class="flat">vs ${fmt(a)} (${P.A.label})</span></div>
    ${extra ? `<div class="kpi-delta flat" style="font-weight:600;">${extra}</div>` : ''}
  </div>`;
}
function fmtDur(sec) {
  if (sec == null || isNaN(sec)) return '—';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h}h ${r}m` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const avg = arr => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

// ================= 1. CHATS =================
// Total chats come from the department's CHAT VOLUME SHEET (same source and
// same reading rules as reports.html → Chats Comparison): one block per
// month, a header row naming the month, then one row per division with a
// "Messages received" figure per day. Empty cells = not entered yet (NOT
// zero), so only filled days are counted. CSAT/DSAT stays on the live
// /chatwoot/stats endpoint because the sheet has no ratings.
const CHAT_SHEET_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS5SwAp040OOY7uZhK_VVOBDYXDGstlJ6KR00zfLsmpyhig7DhIVDVp4qBnP2wPo2b6ISD1zrcuIxAv/pub?gid=1620878570&single=true&output=csv';

function loadChatSheetRows() {
  return new Promise((resolve, reject) => {
    Papa.parse(CHAT_SHEET_CSV + '&_cb=' + Date.now(), {
      download: true, header: false, skipEmptyLines: true,
      complete: r => resolve(r.data || []),
      error: err => reject(err),
    });
  });
}

function parseSheetDaily(rows) {
  const UP = MONTHS.map(m => m.toUpperCase());
  const blocks = {};
  let current = null, dayForCol = null;
  for (const row of rows) {
    const first = String(row[0] || '').trim().toUpperCase();
    if (UP.includes(first)) {
      current = { divisions: {}, filled: new Set() };
      blocks[first] = current;
      dayForCol = {};
      row.forEach((cell, i) => {
        if (i < 2) return;
        const n = parseInt(String(cell || '').trim(), 10);
        if (n >= 1 && n <= 31) dayForCol[i] = n;
      });
      if (!Object.keys(dayForCol).length) dayForCol = null;
      continue;
    }
    if (!current) continue;
    const division = String(row[1] || '').trim();
    if (!division) continue;
    const daily = [];
    row.forEach((cell, i) => {
      if (i < 2) return;
      const day = dayForCol ? dayForCol[i] : i - 1;
      if (!day) return;
      const raw = String(cell == null ? '' : cell).replace(/[,\s]/g, '');
      if (raw === '') return;
      const n = parseFloat(raw);
      if (isNaN(n)) return;
      daily[day] = (daily[day] || 0) + n;
      current.filled.add(day);
    });
    current.divisions[division] = daily;
  }
  return blocks;
}

// Totals per division for one period (days 1..per.days of per.month).
function periodFromSheet(blocks, per) {
  const block = blocks[per.month.toUpperCase()];
  if (!block) return { ok: false, reason: `Walang "${per.month}" block sa chat volume sheet.` };
  const days = [];
  for (let d = 1; d <= per.days; d++) if (block.filled.has(d)) days.push(d);
  if (!days.length) return { ok: false, reason: `Wala pang naka-enter na figures para sa ${per.label}.` };
  const byDiv = {};
  Object.entries(block.divisions).forEach(([div, daily]) => {
    byDiv[div] = (byDiv[div] || 0) + days.reduce((s, d) => s + (daily[d] || 0), 0);
  });
  const total = Object.values(byDiv).reduce((s, v) => s + v, 0);
  return { ok: true, byDiv, total, filledDays: days.length, expectedDays: per.days, lastDay: days[days.length - 1] };
}

let chatChart = null;
async function loadChats() {
  const kp = document.getElementById('chatKpis');
  const errEl = document.getElementById('chatErr');
  errEl.innerHTML = '';
  kp.innerHTML = '<div class="loading">Loading chat volume sheet…</div>';
  try {
    const [rows, sA, sB] = await Promise.all([
      loadChatSheetRows(),
      apiGet(`/chatwoot/stats?${qs(P.A)}`).catch(() => null),
      apiGet(`/chatwoot/stats?${qs(P.B)}`).catch(() => null),
    ]);
    const blocks = parseSheetDaily(rows);
    const a = periodFromSheet(blocks, P.A), b = periodFromSheet(blocks, P.B);
    const notes = [];
    if (!a.ok) notes.push(a.reason);
    if (!b.ok) notes.push(b.reason);
    [[a, P.A], [b, P.B]].forEach(([r, per]) => {
      if (r.ok && r.filledDays < r.expectedDays) notes.push(`${per.month}: ${r.filledDays} sa ${r.expectedDays} araw pa lang ang may figures sa sheet (hanggang ${SHORT[MONTHS.indexOf(per.month)]} ${r.lastDay}).`);
    });
    errEl.innerHTML = notes.length ? `<div class="flag">${notes.map(escapeHtml).join(' ')}</div>` : '';

    const csatTot = s => Object.values((s && s.csatByBrand) || {}).reduce((t, x) => ({ csat: t.csat + x.csat, dsat: t.dsat + x.dsat, total: t.total + x.total }), { csat: 0, dsat: 0, total: 0 });
    const tA = csatTot(sA), tB = csatTot(sB);
    const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
    const fmtPct = v => (v == null ? '—' : v + '%');
    const totA = a.ok ? a.total : null, totB = b.ok ? b.total : null;
    const perDay = (r) => (r.ok ? r.total / r.filledDays : null);
    kp.innerHTML =
      kpi('Total chats (messages received)', totA, totB, null, a.ok && b.ok ? `Per day: ${fmtInt(perDay(b))} vs ${fmtInt(perDay(a))}` : '') +
      kpi('Chats per day', perDay(a), perDay(b), null, 'Fairer when a month is not fully entered') +
      kpi('CSAT %', pct(tA.csat, tA.total), pct(tB.csat, tB.total), fmtPct, `${fmtInt(tB.total)} ratings · live data`) +
      kpi('DSAT %', pct(tA.dsat, tA.total), pct(tB.dsat, tB.total), fmtPct, `${fmtInt(tB.dsat)} bad ratings · live data`, true);

    const dA = a.ok ? a.byDiv : {}, dB = b.ok ? b.byDiv : {};
    const divs = Array.from(new Set([...Object.keys(dA), ...Object.keys(dB)]))
      .sort((x, y) => (dB[y] || 0) - (dB[x] || 0) || (dA[y] || 0) - (dA[x] || 0));
    if (chatChart) chatChart.destroy();
    chatChart = new Chart(document.getElementById('chatChart'), {
      type: 'bar',
      data: { labels: divs, datasets: [
        { label: P.A.label, data: divs.map(d => dA[d] || 0), backgroundColor: '#94A3B8', borderRadius: 4 },
        { label: P.B.label, data: divs.map(d => dB[d] || 0), backgroundColor: '#2563EB', borderRadius: 4 },
      ] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } },
        scales: { x: { grid: { color: '#EEF1F6' } }, y: { grid: { display: false } } } },
    });
    const share = (n, t) => (t ? Math.round((n / t) * 1000) / 10 + '%' : '—');
    document.getElementById('chatTable').innerHTML = `<table class="rt"><thead><tr><th>Brand / division</th>
      <th class="num">${P.A.label}</th><th class="num">${P.B.label}</th><th class="num">Change</th><th class="num">Share</th></tr></thead><tbody>
      ${divs.map(d => `<tr><td>${escapeHtml(d)}</td><td class="num" style="color:var(--ink-faint)">${fmtInt(dA[d] || 0)}</td>
        <td class="num">${fmtInt(dB[d] || 0)}</td><td class="num">${delta(dB[d] || 0, dA[d] || 0)}</td>
        <td class="num" style="color:var(--ink-faint)">${share(dB[d] || 0, totB)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>Total</td><td class="num">${fmtInt(totA)}</td><td class="num">${fmtInt(totB)}</td>
      <td class="num">${delta(totB, totA)}</td><td class="num">100%</td></tr></tfoot></table>`;
  } catch (e) {
    kp.innerHTML = '';
    errEl.innerHTML = `<div class="err">Chat volume sheet could not load: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

// ================= 2–4. TICKETS =================
let allTickets = null;
function inPeriod(t, per) { return t.submitted >= per.from && t.submitted <= per.to; }
function isOpen(t) { return t.statusCls !== 'done' && t.statusCls !== 'rejected'; }

function renderTickets() {
  // Ticket sections show the REPORT MONTH only (no month-vs-month comparison,
  // per user Oct 6, 2026): older months in the ticket sheets are incomplete,
  // so a comparison would mislead.
  const B = allTickets.filter(t => inPeriod(t, P.B));
  const stats = list => {
    const done = list.filter(t => t.statusCls === 'done');
    const rej = list.filter(t => t.statusCls === 'rejected');
    const closed = done.length + rej.length;
    return {
      filed: list.length, done: done.length, rej: rej.length, open: list.filter(isOpen).length,
      rate: closed ? Math.round((done.length / closed) * 1000) / 10 : null,
      avgRes: avg(done.map(t => t.resolveDurationSec).filter(v => v != null && !isNaN(v) && v >= 0)),
    };
  };
  const one = (label, value, sub) => `<div class="kpi-card accent-b"><div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>${sub ? `<div class="kpi-delta flat" style="font-weight:600;">${sub}</div>` : ''}</div>`;
  const b = stats(B);
  document.getElementById('tkKpis').innerHTML =
    one('Tickets filed', fmtInt(b.filed), `${P.B.label} · ${fmtInt(b.filed / P.B.days)} per day`) +
    one('Resolved (Done)', fmtInt(b.done)) +
    one('Resolution rate', b.rate == null ? '—' : b.rate + '%', 'Done ÷ (Done + Rejected)') +
    one('Avg resolving time', fmtDur(b.avgRes)) +
    one('Rejected', fmtInt(b.rej)) +
    one('Still open', fmtInt(b.open), 'New / In Progress / OTP / Line Up');

  const countBy = (list, key) => list.reduce((m, t) => { const k = key(t); m[k] = (m[k] || 0) + 1; return m; }, {});
  const pctOf = (n, t) => (t ? Math.round((n / t) * 1000) / 10 + '%' : '—');

  // Top 5 concerns
  const cB = countBy(B, t => t.issue);
  const top = Object.entries(cB).sort((x, y) => y[1] - x[1]).slice(0, 5);
  document.getElementById('topHint').textContent = `${P.B.label} · share of all tickets`;
  document.getElementById('topConcerns').innerHTML = top.length ? top.map(([issue, n], i) => `
    <div class="rank-row">
      <div class="rank-badge" style="background:${RANK_COLORS[i]}22;color:${RANK_COLORS[i]};">${i + 1}</div>
      <div class="rank-main"><div class="rank-name" title="${escapeHtml(issue)}">${escapeHtml(issue)}</div>
        <div class="rank-track"><div class="rank-fill" style="width:${(n / top[0][1]) * 100}%;background:${RANK_COLORS[i]}"></div></div></div>
      <div class="rank-count">${fmtInt(n)}</div>
      <div class="rank-share">${pctOf(n, B.length)}</div>
    </div>`).join('') : '<div class="note">No tickets filed in the report month.</div>';

  // Resolution by brand
  const brands = Array.from(new Set(B.map(t => t.brandLabel)));
  const byBrand = brands.map(br => ({ br, list: B.filter(t => t.brandLabel === br) }))
    .map(r => ({ ...r, s: stats(r.list) })).sort((x, y) => y.s.filed - x.s.filed);
  document.getElementById('resoTable').innerHTML = `<table class="rt"><thead><tr><th>Brand</th>
    <th class="num">Filed</th><th class="num">Done</th><th class="num">Rejected</th>
    <th class="num">Open</th><th class="num">Rate</th><th class="num">Avg time</th></tr></thead><tbody>
    ${byBrand.map(r => `<tr><td>${escapeHtml(r.br)}</td><td class="num">${fmtInt(r.s.filed)}</td><td class="num">${fmtInt(r.s.done)}</td>
      <td class="num">${fmtInt(r.s.rej)}</td><td class="num">${fmtInt(r.s.open)}</td>
      <td class="num">${r.s.rate == null ? '—' : `<span class="tag ${r.s.rate >= 80 ? 'good' : r.s.rate >= 50 ? 'mid' : 'bad'}">${r.s.rate}%</span>`}</td>
      <td class="num">${fmtDur(r.s.avgRes)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td>All brands</td><td class="num">${fmtInt(b.filed)}</td><td class="num">${fmtInt(b.done)}</td>
      <td class="num">${fmtInt(b.rej)}</td><td class="num">${fmtInt(b.open)}</td><td class="num">${b.rate == null ? '—' : b.rate + '%'}</td>
      <td class="num">${fmtDur(b.avgRes)}</td></tr></tfoot></table>`;

  // 3. Customers per brand (unique usernames who filed a ticket)
  const uniq = list => new Set(list.map(t => String(t.name || '').trim().toLowerCase()).filter(n => n && n !== 'unknown')).size;
  const custRows = byBrand.map(r => ({ br: r.br, u: uniq(r.list), t: r.list.length })).sort((x, y) => y.u - x.u);
  const ub = custRows.reduce((s, x) => s + x.u, 0); // same username on two brands = two customers
  document.getElementById('custTable').innerHTML = `<table class="rt"><thead><tr><th>Brand</th>
    <th class="num">Customers</th><th class="num">Share</th><th class="num">Tickets</th><th class="num">Tickets per customer</th></tr></thead><tbody>
    ${custRows.map(r => `<tr><td>${escapeHtml(r.br)}</td><td class="num">${fmtInt(r.u)}</td>
      <td class="num" style="color:var(--ink-faint)">${pctOf(r.u, custRows.reduce((s, x) => s + x.u, 0))}</td>
      <td class="num">${fmtInt(r.t)}</td><td class="num">${r.u ? (r.t / r.u).toFixed(2) : '—'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td>All brands</td><td class="num">${fmtInt(ub)}</td><td class="num"></td>
    <td class="num">${fmtInt(B.length)}</td><td class="num">${ub ? (B.length / ub).toFixed(2) : '—'}</td></tr></tfoot></table>`;

  // 4. Top 5 reasons per brand
  document.getElementById('perBrandLede').textContent = `${P.B.label} · share of the brand's tickets`;
  document.getElementById('perBrand').innerHTML = byBrand.map(r => {
    const cb = countBy(r.list, t => t.issue);
    const t5 = Object.entries(cb).sort((x, y) => y[1] - x[1]).slice(0, 5);
    return `<div class="brand-card"><h4>${escapeHtml(r.br)}</h4>
      <div class="sub">${fmtInt(r.list.length)} tickets · ${P.B.label}</div>
      ${t5.map(([k, n], i) => `<div class="mini-row"><span class="rank-badge" style="width:20px;height:20px;font-size:11px;border-radius:6px;background:${RANK_COLORS[i]}22;color:${RANK_COLORS[i]}">${i + 1}</span>
        <span class="lbl" title="${escapeHtml(k)}">${escapeHtml(k)}</span><span class="n">${fmtInt(n)}</span><span class="p">${pctOf(n, r.list.length)}</span></div>`).join('')}
    </div>`;
  }).join('') || '<div class="note">No tickets in the report month.</div>';
}

async function loadTickets(force) {
  document.getElementById('tkErr').innerHTML = '';
  try {
    allTickets = await TicketData.fetchTickets(!!force, (partial, done, total) => {
      document.getElementById('tkKpis').innerHTML = `<div class="loading">Loading ticket sheets… ${done}/${total}</div>`;
    });
    renderTickets();
  } catch (e) {
    document.getElementById('tkErr').innerHTML = `<div class="err">Tickets could not load: ${escapeHtml(e.message)}</div>`;
  }
}

// ================= 5. OPENAI =================
async function loadOpenAI() {
  const kp = document.getElementById('aiKpis');
  document.getElementById('aiErr').innerHTML = '';
  kp.innerHTML = '<div class="loading">Loading OpenAI costs… (may take up to a minute)</div>';
  try {
    const q = per => `/openai-billing/summary?account=all&range=custom&start=${per.startYmd}&end=${per.endYmd}`;
    const [a, b, fx] = await Promise.all([
      apiGet(q(P.A)), apiGet(q(P.B)),
      fetch('https://open.er-api.com/v6/latest/USD').then(r => r.json()).catch(() => null),
    ]);
    const rate = fx && fx.rates && fx.rates.PHP ? fx.rates.PHP : null;
    const php = v => (rate && v != null ? ' · ≈ ' + fmtPhp(v * rate) : '');
    kp.innerHTML =
      kpi('OpenAI spend (USD)', a.totalUsd, b.totalUsd, fmtUsd, `${php(b.totalUsd).replace(' · ', '')}`, true) +
      kpi('Avg per day', a.totalUsd / P.A.days, b.totalUsd / P.B.days, fmtUsd, null, true) +
      kpi('Accounts', (a.byAccount || []).length, (b.byAccount || []).length);
    const mapA = new Map((a.byAccount || []).map(x => [x.name, x.totalUsd]));
    const names = Array.from(new Set([...(b.byAccount || []).map(x => x.name), ...mapA.keys()]));
    const mapB = new Map((b.byAccount || []).map(x => [x.name, x.totalUsd]));
    names.sort((x, y) => (mapB.get(y) || 0) - (mapB.get(x) || 0));
    document.getElementById('aiTable').innerHTML = `<table class="rt"><thead><tr><th>Account</th>
      <th class="num">${P.A.label}</th><th class="num">${P.B.label}</th><th class="num">Change</th><th class="num">${P.B.label} (PHP)</th></tr></thead><tbody>
      ${names.map(n => `<tr><td>${escapeHtml(n)}</td><td class="num" style="color:var(--ink-faint)">${fmtUsd(mapA.get(n) || 0)}</td>
        <td class="num">${fmtUsd(mapB.get(n) || 0)}</td><td class="num">${delta(mapB.get(n) || 0, mapA.get(n) || 0, true)}</td>
        <td class="num">${rate ? fmtPhp((mapB.get(n) || 0) * rate) : '—'}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>Total</td><td class="num">${fmtUsd(a.totalUsd)}</td><td class="num">${fmtUsd(b.totalUsd)}</td>
      <td class="num">${delta(b.totalUsd, a.totalUsd, true)}</td><td class="num">${rate ? fmtPhp(b.totalUsd * rate) : '—'}</td></tr></tfoot></table>`;
    const asOf = b.asOf ? new Date(b.asOf).toLocaleString() : null;
    document.getElementById('aiAsOf').textContent = (asOf ? `As of ${asOf}` : '') + (a.stale || b.stale ? ' · some figures cached' : '') + (rate ? ` · ₱${rate.toFixed(2)}/$` : '');
  } catch (e) {
    kp.innerHTML = '';
    document.getElementById('aiErr').innerHTML = `<div class="err">OpenAI totals could not load: ${escapeHtml(e.message)}</div>`;
  }
}

// ================= Boot =================
function setHeader() {
  document.getElementById('periodTitle').textContent = `${P.A.month} vs ${P.B.month}`;
  document.getElementById('legendA').textContent = `${P.A.label} (comparison)`;
  document.getElementById('legendB').textContent = `${P.B.label}${P.running ? ' (to date)' : ''}`;
  document.getElementById('generatedAt').textContent = new Date().toLocaleString();
}
function loadAll(force) {
  setHeader();
  loadChats();
  loadTickets(force);
  loadOpenAI();
}
document.getElementById('modeSel').addEventListener('change', e => {
  P = buildPeriods(Number(e.target.value));
  setHeader();
  loadChats();
  if (allTickets) renderTickets(); else loadTickets(false);
  loadOpenAI();
});
document.getElementById('refreshBtn').addEventListener('click', () => {
  P = buildPeriods(Number(document.getElementById('modeSel').value));
  loadAll(true);
});
loadAll(false);
</script>
</body>
</html>
