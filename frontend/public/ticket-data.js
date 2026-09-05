// ---- Shared ticket data loader for CSR Dashboard + Tickets pages ----
// Pulls live rows from the published Google Sheet (CSV export) and
// normalizes them into a consistent shape both pages can use.
// Requires PapaParse to be loaded before this file.
(function (global) {
  // Multiple sheets feed the ticket pipeline (split by category and/or brand).
  // Add more sources here as new category sheets or brands come online.
  // Normally the brand is derived from the Ticket ID prefix (see brandFromTicketId).
  // If two brands ever share the same prefix (e.g. "HPP" reused across countries),
  // give the affected source an explicit `brandOverride` so it isn't misattributed
  // to whichever brand that prefix normally maps to.
  const SHEET_SOURCES = [
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRWWjiEZFlfiJNwLk_wpQAoG6eJaqGAf6UDyj-lycIY9qJfFVGBxzQV0ZYSTWOkMF9V50Kk9sO1iQ4b/pub?gid=0&single=true&output=csv" }, // Buenas PH — Deposit
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQyi3716uR8070u3tMdSgcDB9QmtJb6SkJ_3DHAyHfQkl0tgwNr9f5pBZxXrv0gxQOy3zb4QxXoyYgp/pub?gid=0&single=true&output=csv" }, // Buenas PH — Withdrawal
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTEEKoubJBG2YMrDjEPv0DUdmqYPWLBGRl8bM8uHKg1LCfwEjTYGRXpPcBGhDe_RdNPOROrw1PuNJ36/pub?gid=0&single=true&output=csv" }, // Buenas PH — Account
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTuLVCyL7fxmBpMn0Vlt1H3W5WhcMJSLzWX4NcEDol6mVrJf_et9J9Ai3cbLzdB4wtU_SsXsQ-c1p_f/pub?gid=0&single=true&output=csv" }, // TMTCash
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTJjSjsokoykFPem4oIurq1-ex1Yho3IsHplupTHPiSs6wueznpFyx2OL2hdYHkXUPePZH1KnJKeiO0/pub?gid=0&single=true&output=csv" }, // Mobile Casino Play (MCP)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR_bnVsZoQgdUNpkcG6ZSG1ep_6ky5xZ915I-JJ0VhW_LjNGKmA6RnRr002k-mY1b7590B92s2ROcel/pub?gid=0&single=true&output=csv" }, // ManilaPlay (MNP)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTkYplUz2eq5TzFEYmvHlXDltCZe6RnoYTak5xEtrXZxEb2EvfDTz5LUOZ0AaouuOGcNWJRDQGYGZB4/pub?gid=0&single=true&output=csv" }, // HypePlay PH (HPP)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTbB_0D7eB9mxUQUoeBlP8fPRgLcrPhwzmuUpIUl1wyT5NUS4B45YC_yuVvfMFfEVA9tqPqedGSMQSb/pub?gid=0&single=true&output=csv" }, // MasterGoldKey (MGK)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0Sbf9dckRTWoYtJJnXD6uaxrqSn8-wnCHGJk-R8ZU34VvlttKyThhLknBcmm_vQgfERoIAXSRFHth/pub?gid=0&single=true&output=csv" }, // LuckyStacks PH (LSP)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSk8cISAKqAHVdanIILWO4Cm0BX16C7h2fbM-I7ldCqm7_-xfhYTMap1yGktFAMSJTnRm-BjV1jy7Af/pub?gid=0&single=true&output=csv" }, // Casinyeam (CSY)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTBUDcdD5qJtw1GjRwHkWKKaIgcvMQUcYlMIq61H8JV-6piChgqQIn-8K0RyyU6KnrCcvkfhxkp1VWd/pub?gid=0&single=true&output=csv", brandOverride: { code: 'HPP_BD', label: 'HypePlay BD' } }, // HypePlay BD — shares the "HPP" ticket-ID prefix with HypePlay PH, disambiguated by source sheet
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTuLVCyL7fxmBpMn0Vlt1H3W5WhcMJSLzWX4NcEDol6mVrJf_et9J9Ai3cbLzdB4wtU_SsXsQ-c1p_f/pub?gid=1849805921&single=true&output=csv", kind: 'followup' }, // TMTCash — Follow Up (different columns: Reference ID / Query / Query Type instead of Ticket ID / Username)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTuLVCyL7fxmBpMn0Vlt1H3W5WhcMJSLzWX4NcEDol6mVrJf_et9J9Ai3cbLzdB4wtU_SsXsQ-c1p_f/pub?gid=1915138821&single=true&output=csv", kind: 'callback' } // TMTCash — Callback (Reference ID / Username / Mobile / Concern / Concern Category)
  ];

  const AVATAR_COLORS = ['#3B82F6','#F59E0B','#22C55E','#8B5CF6','#14B8A6','#EC4899','#64748B','#0EA5E9','#F97316','#A855F7'];

  // Maps the sheet's real Status values to display label + CSS class.
  const STATUS_MAP = {
    pending:  { label: 'New',         cls: 'pending'  },
    checking: { label: 'In Progress', cls: 'checking' },
    'otp pending verification': { label: 'OTP Pending', cls: 'checking' },
    'line up': { label: 'Line Up',    cls: 'checking' },
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

  function parseSheetCsv(source) {
    return new Promise((resolve, reject) => {
      if (typeof Papa === 'undefined') {
        reject(new Error('PapaParse is required but was not found on the page.'));
        return;
      }
      const bustUrl = source.url + (source.url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
      Papa.parse(bustUrl, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve({ rows: results.data || [], brandOverride: source.brandOverride || null, kind: source.kind || 'ticket' }),
        error: (err) => reject(err)
      });
    });
  }

  // Maps a normal ticket-sheet row (Ticket ID / Username / Category / ...) to our common shape.
  function mapTicketRow(row, brandOverride) {
    if (!row['Ticket ID']) return null;
    const submitted = new Date(row['Submitted At']);
    if (isNaN(submitted.getTime())) return null;
    const name = row['Username'] || row['Full Name'] || 'Unknown';
    const category = (row['Category'] || '').trim();
    const subcategory = (row['Subcategory'] || '').trim();
    const acknowledgedAt = row['Acknowledged At'] ? new Date(row['Acknowledged At']) : null;
    const resolvedAt = row['Resolved At'] ? new Date(row['Resolved At']) : null;
    const ackDurationSec = row['Acknowledgement Duration'] !== '' ? Number(row['Acknowledgement Duration']) : null;
    const resolveDurationSec = row['Resolving Duration'] !== '' ? Number(row['Resolving Duration']) : null;
    const si = statusInfo(row['Status']);
    const brand = brandOverride || brandFromTicketId(row['Ticket ID']);
    return {
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
  }

  // Maps a "Follow Up" sheet row (Reference ID / Query / Query Type / ...) to the
  // same common shape, so it flows through every KPI/chart/list alongside real tickets.
  function mapFollowupRow(row) {
    if (!row['Reference ID']) return null;
    const submitted = new Date(row['Submitted At']);
    if (isNaN(submitted.getTime())) return null;
    const query = row['Query'] || 'Unknown';
    const queryType = row['Query Type'] || 'General';
    const acknowledgedAt = row['Acknowledged At'] ? new Date(row['Acknowledged At']) : null;
    const resolvedAt = row['Resolved At'] ? new Date(row['Resolved At']) : null;
    const ackDurationSec = row['Acknowledgement Duration'] !== '' ? Number(row['Acknowledgement Duration']) : null;
    const resolveDurationSec = row['Resolving Duration'] !== '' ? Number(row['Resolving Duration']) : null;
    const si = statusInfo(row['Status']);
    const brand = brandFromTicketId(row['Reference ID']);
    return {
      id: row['Reference ID'],
      name: query,
      init: initialsForName(query),
      color: colorForName(query),
      category: 'Follow Up',
      issue: `Follow-up (${queryType})`,
      channel: 'Follow Up',
      brandCode: brand.code,
      brandLabel: brand.label,
      priority: 'medium',
      priorityLabel: 'NORMAL',
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
  }

  // Maps a "Callback" sheet row (Reference ID / Username / Mobile / Concern / ...) to the
  // same common shape.
  function mapCallbackRow(row) {
    if (!row['Reference ID']) return null;
    const submitted = new Date(row['Submitted At']);
    if (isNaN(submitted.getTime())) return null;
    const name = row['Username'] || row['Full Name'] || row['Mobile'] || 'Unknown';
    const concernCategory = (row['Concern Category'] || '').trim();
    const acknowledgedAt = row['Acknowledged At'] ? new Date(row['Acknowledged At']) : null;
    const resolvedAt = row['Resolved At'] ? new Date(row['Resolved At']) : null;
    const ackDurationSec = row['Acknowledgement Duration'] !== '' ? Number(row['Acknowledgement Duration']) : null;
    const resolveDurationSec = row['Resolving Duration'] !== '' ? Number(row['Resolving Duration']) : null;
    const si = statusInfo(row['Status']);
    const brand = brandFromTicketId(row['Reference ID']);
    return {
      id: row['Reference ID'],
      name,
      init: initialsForName(name),
      color: colorForName(name),
      category: 'Callback',
      issue: concernCategory ? `Callback: ${concernCategory}` : 'Callback Request',
      channel: 'Callback',
      brandCode: brand.code,
      brandLabel: brand.label,
      priority: 'medium',
      priorityLabel: 'NORMAL',
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
  }

  let cachedPromise = null;
  function fetchTickets(forceRefresh) {
    if (cachedPromise && !forceRefresh) return cachedPromise;
    cachedPromise = Promise.all(SHEET_SOURCES.map(parseSheetCsv))
      .then(sheetResults => {
        const seen = new Map();
        sheetResults.forEach(({ rows, brandOverride, kind }) => {
          rows.forEach(row => {
            const ticket = kind === 'followup' ? mapFollowupRow(row)
              : kind === 'callback' ? mapCallbackRow(row)
              : mapTicketRow(row, brandOverride);
            if (!ticket) return;
            // De-dupe by brand+id (scoped per brand so that two different
            // brands sharing the same ID prefix/format can never collide with
            // or overwrite each other, even in the rare case their generated
            // IDs happen to match).
            seen.set(`${ticket.brandCode}::${ticket.id}`, ticket);
          });
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
