// ---- Shared ticket data loader for CSR Dashboard + Tickets pages ----
// Pulls live rows from the published Google Sheet (CSV export) and
// normalizes them into a consistent shape both pages can use.
// Requires PapaParse to be loaded before this file.
(function (global) {
  // Multiple sheets feed the same brand's ticket pipeline (split by category).
  // Add more URLs here as new category sheets or brands come online.
  const SHEET_CSV_URLS = [
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRWWjiEZFlfiJNwLk_wpQAoG6eJaqGAf6UDyj-lycIY9qJfFVGBxzQV0ZYSTWOkMF9V50Kk9sO1iQ4b/pub?gid=0&single=true&output=csv", // Buenas PH — Deposit
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQyi3716uR8070u3tMdSgcDB9QmtJb6SkJ_3DHAyHfQkl0tgwNr9f5pBZxXrv0gxQOy3zb4QxXoyYgp/pub?gid=0&single=true&output=csv", // Buenas PH — Withdrawal
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTEEKoubJBG2YMrDjEPv0DUdmqYPWLBGRl8bM8uHKg1LCfwEjTYGRXpPcBGhDe_RdNPOROrw1PuNJ36/pub?gid=0&single=true&output=csv", // Buenas PH — Account
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTuLVCyL7fxmBpMn0Vlt1H3W5WhcMJSLzWX4NcEDol6mVrJf_et9J9Ai3cbLzdB4wtU_SsXsQ-c1p_f/pub?gid=0&single=true&output=csv", // TMTCash (confirmed working)
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTJjSjsokoykFPem4oIurq1-ex1Yho3IsHplupTHPiSs6wueznpFyx2OL2hdYHkXUPePZH1KnJKeiO0/pub?gid=0&single=true&output=csv" // Added sheet (unverified structure)
  ];

  const AVATAR_COLORS = ['#3B82F6','#F59E0B','#22C55E','#8B5CF6','#14B8A6','#EC4899','#64748B','#0EA5E9','#F97316','#A855F7'];

  // Maps the sheet's real Status values to display label + CSS class.
  const STATUS_MAP = {
    pending:  { label: 'New',         cls: 'pending'  },
    checking: { label: 'In Progress', cls: 'checking' },
    'otp pending verification': { label: 'OTP Pending', cls: 'checking' },
    done:     { label: 'Done',        cls: 'done'     },
    rejected: { label: 'Rejected',    cls: 'rejected' }
  };

  // Brand is encoded as the prefix of the Ticket ID (e.g. "BPH-20260830-66448" -> "BPH").
  const BRAND_MAP = {
    BPH: 'Buenas PH',
    TMT: 'TMTCash',
    MCP: 'Mobile Casino Play',
    MNP: 'ManilaPlay',
    HPP: 'HypePlay PH',
    CSY: 'Casinyeam',
    MGK: 'MasterGoldKey',
    LSP: 'LuckyStacks PH',
    SSP: 'SuperScatter PH'
  };

  function brandFromTicketId(ticketId) {
    const code = (ticketId || '').split('-')[0].toUpperCase();
    return { code, label: BRAND_MAP[code] || code || 'Unknown' };
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function colorForName(name) {
    let hash = 0;
    const s = name || '';
    for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function initialsForName(name) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function priorityBucket(raw) {
    const p = (raw || '').toUpperCase();
    if (p.includes('HIGH') || p.includes('URGENT') || p.includes('CRITICAL')) return 'high';
    if (p.includes('LOW')) return 'low';
    return 'medium';
  }

  function statusInfo(raw) {
    const key = (raw || '').trim().toLowerCase();
    return STATUS_MAP[key] || { label: raw || 'Unknown', cls: 'unknown' };
  }

  function relativeTime(dateStrOrDate) {
    const then = dateStrOrDate instanceof Date ? dateStrOrDate : new Date(dateStrOrDate);
    if (isNaN(then.getTime())) return '—';
    const diffMs = Date.now() - then.getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }

  // Compact elapsed-time label for badges, e.g. "42m", "3h 12m", "2d".
  function compactElapsed(fromDate, toDate) {
    const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
    const to = toDate || new Date();
    if (isNaN(from.getTime())) return '—';
    const mins = Math.max(0, Math.round((to - from) / 60000));
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs < 24) return remMins ? `${hrs}h ${remMins}m` : `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  }

  function formatDuration(totalSeconds) {
    if (totalSeconds == null || isNaN(totalSeconds) || totalSeconds < 0) return '—';
    const s = Math.round(totalSeconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  }

  function isSameLocalDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }

  function dayKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function pctChange(current, previous) {
    if (!previous) return null;
    return Math.round(((current - previous) / previous) * 100);
  }

  function parseSheetCsv(url) {
    return new Promise((resolve, reject) => {
      if (typeof Papa === 'undefined') {
        reject(new Error('PapaParse is required but was not found on the page.'));
        return;
      }
      const bustUrl = url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
      Papa.parse(bustUrl, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results.data || []),
        error: (err) => reject(err)
      });
    });
  }

  let cachedPromise = null;
  function fetchTickets(forceRefresh) {
    if (cachedPromise && !forceRefresh) return cachedPromise;
    cachedPromise = Promise.all(SHEET_CSV_URLS.map(parseSheetCsv))
      .then(resultsPerSheet => {
        const rows = [].concat(...resultsPerSheet);
        const seen = new Map();
        rows
          .filter(row => row['Ticket ID'])
          .forEach(row => {
            const name = row['Username'] || row['Full Name'] || 'Unknown';
            const category = (row['Category'] || '').trim();
            const subcategory = (row['Subcategory'] || '').trim();
            const submitted = new Date(row['Submitted At']);
            if (isNaN(submitted.getTime())) return;
            const acknowledgedAt = row['Acknowledged At'] ? new Date(row['Acknowledged At']) : null;
            const resolvedAt = row['Resolved At'] ? new Date(row['Resolved At']) : null;
            const ackDurationSec = row['Acknowledgement Duration'] !== '' ? Number(row['Acknowledgement Duration']) : null;
            const resolveDurationSec = row['Resolving Duration'] !== '' ? Number(row['Resolving Duration']) : null;
            const si = statusInfo(row['Status']);
            const brand = brandFromTicketId(row['Ticket ID']);
            const ticket = {
              id: row['Ticket ID'],
              name,
              init: initialsForName(name),
              color: colorForName(name),
              category,
              issue: subcategory || category || '—',
              channel: row['Source'] || '—',
              brandCode: brand.code,
              brandLabel: brand.label,
              priority: priorityBucket(row['Priority']),
              priorityLabel: row['Priority'] || 'NORMAL',
              statusRaw: row['Status'],
              statusCls: si.cls,
              statusLabel: si.label,
              submitted,
              acknowledgedBy: row['Acknowledged By'] || null,
              acknowledgedAt: acknowledgedAt && !isNaN(acknowledgedAt.getTime()) ? acknowledgedAt : null,
              resolvedBy: row['Resolved By'] || null,
              resolvedAt: resolvedAt && !isNaN(resolvedAt.getTime()) ? resolvedAt : null,
              ackDurationSec: isNaN(ackDurationSec) ? null : ackDurationSec,
              resolveDurationSec: isNaN(resolveDurationSec) ? null : resolveDurationSec
            };
            // De-dupe by Ticket ID in case the same ticket ever appears in more than one sheet.
            seen.set(ticket.id, ticket);
          });
        return Array.from(seen.values()).sort((a, b) => b.submitted - a.submitted);
      });
    return cachedPromise;
  }

  // Periodically re-fetches fresh data (bypassing the cache) and hands it to
  // the given callback. Returns an interval id so the caller can stop it via
  // clearInterval if needed. Both tickets.html and csr-dashboard.html use this
  // so the page keeps itself current without requiring a manual browser refresh.
  function startAutoRefresh(callback, intervalMs) {
    return setInterval(() => {
      fetchTickets(true)
        .then(callback)
        .catch(err => console.error('Auto-refresh failed:', err));
    }, intervalMs || 60000);
  }

  global.TicketData = {
    fetchTickets,
    startAutoRefresh,
    escapeHtml,
    colorForName,
    initialsForName,
    priorityBucket,
    statusInfo,
    brandFromTicketId,
    relativeTime,
    compactElapsed,
    formatDuration,
    isSameLocalDay,
    dayKey,
    pctChange,
    STATUS_MAP,
    BRAND_MAP
  };
})(window);
