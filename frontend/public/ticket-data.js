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
  //
  // Optional `sheetId`: the REAL Google Sheet ID (from the normal .../d/{ID}/edit
  // share link — NOT the long "Publish to web" ID already in `url`). When present,
  // each ticket gets a `sheetLink` that deep-links straight to its row in the live,
  // editable sheet. Add it per-brand as those real IDs become available; sources
  // without it simply get no link (Ticket ID renders as plain text, same as before).
  const SHEET_SOURCES = [
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRWWjiEZFlfiJNwLk_wpQAoG6eJaqGAf6UDyj-lycIY9qJfFVGBxzQV0ZYSTWOkMF9V50Kk9sO1iQ4b/pub?gid=0&single=true&output=csv", sheetId: "17ECCBVQYC9Ke8Hg5u-YCuUJ1VDjl43OCwfkLi2WV_3I" }, // Buenas PH — Deposit
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQyi3716uR8070u3tMdSgcDB9QmtJb6SkJ_3DHAyHfQkl0tgwNr9f5pBZxXrv0gxQOy3zb4QxXoyYgp/pub?gid=0&single=true&output=csv", sheetId: "1hovlnQrr4mIpZ1Q5HkGBSPKhJjg3Up_z-4S77D2lkpk" }, // Buenas PH — Withdrawal
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTEEKoubJBG2YMrDjEPv0DUdmqYPWLBGRl8bM8uHKg1LCfwEjTYGRXpPcBGhDe_RdNPOROrw1PuNJ36/pub?gid=0&single=true&output=csv", sheetId: "1kTiIf9sHUHzLdVi0hgntI4cA8FxNQBhqEYgM97BVV84" }, // Buenas PH — Account
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTEEKoubJBG2YMrDjEPv0DUdmqYPWLBGRl8bM8uHKg1LCfwEjTYGRXpPcBGhDe_RdNPOROrw1PuNJ36/pub?gid=906571162&single=true&output=csv", sheetId: "1kTiIf9sHUHzLdVi0hgntI4cA8FxNQBhqEYgM97BVV84" }, // Buenas PH — Error/Bug
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTEEKoubJBG2YMrDjEPv0DUdmqYPWLBGRl8bM8uHKg1LCfwEjTYGRXpPcBGhDe_RdNPOROrw1PuNJ36/pub?gid=2007332310&single=true&output=csv", sheetId: "1kTiIf9sHUHzLdVi0hgntI4cA8FxNQBhqEYgM97BVV84" }, // Buenas PH — Bonus/Reward
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTEEKoubJBG2YMrDjEPv0DUdmqYPWLBGRl8bM8uHKg1LCfwEjTYGRXpPcBGhDe_RdNPOROrw1PuNJ36/pub?gid=1356077885&single=true&output=csv", sheetId: "1kTiIf9sHUHzLdVi0hgntI4cA8FxNQBhqEYgM97BVV84" }, // Buenas PH — Callback Request (uses standard Ticket ID schema)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTuLVCyL7fxmBpMn0Vlt1H3W5WhcMJSLzWX4NcEDol6mVrJf_et9J9Ai3cbLzdB4wtU_SsXsQ-c1p_f/pub?gid=0&single=true&output=csv", sheetId: "1JbqhUcOTIwF-YLA7Eo6FWomUS8c8t8EKMeXeBsQTeQU" }, // TMTCash
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTJjSjsokoykFPem4oIurq1-ex1Yho3IsHplupTHPiSs6wueznpFyx2OL2hdYHkXUPePZH1KnJKeiO0/pub?gid=0&single=true&output=csv", sheetId: "1FxrmHVwYcfNdjVMvBmldmDjbIIqDaP7NvBi-IEvVVu8" }, // Mobile Casino Play (MCP)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR_bnVsZoQgdUNpkcG6ZSG1ep_6ky5xZ915I-JJ0VhW_LjNGKmA6RnRr002k-mY1b7590B92s2ROcel/pub?gid=0&single=true&output=csv", sheetId: "1pJK2JqPY5o4IICyl6bpIvOtuklveSsRFUfTqIRMcyVc" }, // ManilaPlay (MNP)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR_bnVsZoQgdUNpkcG6ZSG1ep_6ky5xZ915I-JJ0VhW_LjNGKmA6RnRr002k-mY1b7590B92s2ROcel/pub?gid=1958931723&single=true&output=csv", kind: 'followup', sheetId: "1pJK2JqPY5o4IICyl6bpIvOtuklveSsRFUfTqIRMcyVc" }, // ManilaPlay — Follow Up
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR_bnVsZoQgdUNpkcG6ZSG1ep_6ky5xZ915I-JJ0VhW_LjNGKmA6RnRr002k-mY1b7590B92s2ROcel/pub?gid=1198722654&single=true&output=csv", kind: 'callback', sheetId: "1pJK2JqPY5o4IICyl6bpIvOtuklveSsRFUfTqIRMcyVc" }, // ManilaPlay — Callback
    // NOTE: ManilaPlay also has an OTP Log tab (gid=793559768) containing live customer
    // OTP codes. Deliberately excluded — publishing it would expose real one-time
    // passwords via an unauthenticated public CSV link. Same call made for TMTCash.
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTkYplUz2eq5TzFEYmvHlXDltCZe6RnoYTak5xEtrXZxEb2EvfDTz5LUOZ0AaouuOGcNWJRDQGYGZB4/pub?gid=0&single=true&output=csv", sheetId: "1hQ067jbyADkFlRYecv7mxfn-SG5F4F-wSmyHl_LT-z0" }, // HypePlay PH (HPP)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTbB_0D7eB9mxUQUoeBlP8fPRgLcrPhwzmuUpIUl1wyT5NUS4B45YC_yuVvfMFfEVA9tqPqedGSMQSb/pub?gid=0&single=true&output=csv", sheetId: "1WCinfp7w5FEUvE_FpaI9ap9JwekBE019kQ-oErbmaCQ" }, // MasterGoldKey (MGK)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0Sbf9dckRTWoYtJJnXD6uaxrqSn8-wnCHGJk-R8ZU34VvlttKyThhLknBcmm_vQgfERoIAXSRFHth/pub?gid=0&single=true&output=csv", sheetId: "1CnJ4xHHyJu6j8n2ZcUu3zOUSdYBIPOge5IseAvpRotQ" }, // LuckyStacks PH (LSP)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSk8cISAKqAHVdanIILWO4Cm0BX16C7h2fbM-I7ldCqm7_-xfhYTMap1yGktFAMSJTnRm-BjV1jy7Af/pub?gid=0&single=true&output=csv", sheetId: "1Hzk4kcDbrznlexhlRmvkij-MpEsJ0pOa6W6ijHm4RlE" }, // Casinyeam (CSY)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSk8cISAKqAHVdanIILWO4Cm0BX16C7h2fbM-I7ldCqm7_-xfhYTMap1yGktFAMSJTnRm-BjV1jy7Af/pub?gid=1668001762&single=true&output=csv", kind: 'followup', sheetId: "1Hzk4kcDbrznlexhlRmvkij-MpEsJ0pOa6W6ijHm4RlE" }, // Casinyeam — Follow Up
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSk8cISAKqAHVdanIILWO4Cm0BX16C7h2fbM-I7ldCqm7_-xfhYTMap1yGktFAMSJTnRm-BjV1jy7Af/pub?gid=2070863895&single=true&output=csv", kind: 'callback', sheetId: "1Hzk4kcDbrznlexhlRmvkij-MpEsJ0pOa6W6ijHm4RlE" }, // Casinyeam — Callback
    // NOTE: Casinyeam also has an OTP Log tab (gid=633742038) containing live customer
    // OTP codes. Deliberately excluded — publishing it would expose real one-time
    // passwords via an unauthenticated public CSV link. Same call made for ManilaPlay/TMTCash.
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTBUDcdD5qJtw1GjRwHkWKKaIgcvMQUcYlMIq61H8JV-6piChgqQIn-8K0RyyU6KnrCcvkfhxkp1VWd/pub?gid=0&single=true&output=csv", brandOverride: { code: 'HPP_BD', label: 'HypePlay BD' }, sheetId: "1Tm444iBlAx2S79MbXIo3tlCkZeiHut21-Se8P1CXCIA" }, // HypePlay BD — shares the "HPP" ticket-ID prefix with HypePlay PH, disambiguated by source sheet
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTuLVCyL7fxmBpMn0Vlt1H3W5WhcMJSLzWX4NcEDol6mVrJf_et9J9Ai3cbLzdB4wtU_SsXsQ-c1p_f/pub?gid=1849805921&single=true&output=csv", kind: 'followup', sheetId: "1JbqhUcOTIwF-YLA7Eo6FWomUS8c8t8EKMeXeBsQTeQU" }, // TMTCash — Follow Up (different columns: Reference ID / Query / Query Type instead of Ticket ID / Username)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTuLVCyL7fxmBpMn0Vlt1H3W5WhcMJSLzWX4NcEDol6mVrJf_et9J9Ai3cbLzdB4wtU_SsXsQ-c1p_f/pub?gid=1915138821&single=true&output=csv", kind: 'callback', sheetId: "1JbqhUcOTIwF-YLA7Eo6FWomUS8c8t8EKMeXeBsQTeQU" }, // TMTCash — Callback (Reference ID / Username / Mobile / Concern / Concern Category)
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ2finxr4w7O8FK0KhhGQFB7s7Xs8arcLIZOk4vFS_DxpbJNUElnIN802VNzOYcy0HT-zJUIcGvDjso/pub?output=csv", brandOverride: { code: 'TMT_PLAY', label: 'TMTPLAY' }, sheetId: "12lRRNvsG_o-AOD6_FggRA87yvqxVwJPXDTgV79TcTpI" }, // TMTPLAY — shares the "TMT" ticket-ID prefix with TMTCash, disambiguated by source sheet
    { url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQpnmq17Q7n0uLYDgH2WvE2SZFNkvqPgQKnTLY0LT8gqJPlxQQZUmyL1JSlHF9xPGYfvBDLpCpK2Cjp/pub?gid=648660778&single=true&output=csv", kind: 'division', sheetId: "1YB5OBsZ3aqY5Hs5CZeNEU0yO36GcQI74pJYJvjADOww" } // SuperScatter PH / Manila Casino / Casinyeam — REQUEST MONITORING tab (brand comes from the Division column per row, see DIVISION_BRAND_MAP; any other Division value is filtered out)
  ];

  const AVATAR_COLORS = ['#3B82F6','#F59E0B','#22C55E','#8B5CF6','#14B8A6','#EC4899','#64748B','#0EA5E9','#F97316','#A855F7'];

  // Maps the sheet's real Status values to display label + CSS class.
  const STATUS_MAP = {
    pending:  { label: 'New',         cls: 'pending'  },
    new:      { label: 'New',         cls: 'pending'  }, // may sheets (hal. MCP) na literal "NEW" ang sinusulat (2026-09-23)
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
    SSP: 'SuperScatter PH',
    TMT_PLAY: 'TMTPLAY',
    MNC: 'Manila Casino'
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

  // Sheet date parser (added 2026-09-21): iba-iba ang date format ng mga
  // sheets — ang ilan (hal. HypePlay BD) ay DD/MM/YYYY, na binabasa ng
  // JavaScript bilang MM/DD/YYYY. Ang "12/09/2026" (Sep 12) ay nagiging
  // Dec 9 — HINAHARAP — kaya "just now" ang Updated at umaakyat pa sa
  // taas ng list ang mga lumang ticket. Ayos: kapag slash-format at ang
  // MM/DD na basa ay lampas sa kasalukuyan (imposible para sa submitted/
  // resolved timestamps), i-swap sa DD/MM. Ang mga malinaw na format
  // (ISO, "Sep 12, 2026") ay hindi ginagalaw.
  function parseSheetDate(raw) {
    if (raw == null) return new Date(NaN);
    const s = String(raw).trim();
    if (!s) return new Date(NaN);
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]), rest = m[4] || '';
      const build = (mm, dd) => new Date(`${mm}/${dd}/${y}${rest}`);
      const now = Date.now() + 24 * 60 * 60 * 1000; // 1 araw na palugit (timezone drift)
      if (a > 12 && b <= 12) return build(b, a); // tiyak na DD/MM (hal. 25/09/2026)
      if (b > 12 && a <= 12) return build(a, b); // tiyak na MM/DD (hal. 09/25/2026)
      const asMdy = build(a, b);
      if (!isNaN(asMdy.getTime()) && asMdy.getTime() <= now) return asMdy; // MM/DD, makatwiran
      const asDmy = build(b, a);
      if (!isNaN(asDmy.getTime()) && asDmy.getTime() <= now) return asDmy; // future ang MM/DD → DD/MM pala
      return asMdy;
    }
    return new Date(s);
  }

  // Rejection reason (added 2026-09-21): kinukuha mula sa kung anong column
  // ang ginagamit ng sheet. Ang standard ay "Reject Reason" — idagdag ito
  // sa mga ticket sheets at punan tuwing nirereject; ang mga lumang sheets
  // na Remarks/Notes ang gamit ay sakop pa rin ng fallbacks.
  function rejectReasonFrom(row) {
    const v = row['Reject Reason'] || row['Rejection Reason'] || row['Reject Remarks'] || row['Remarks'] || row['Notes'] || '';
    return String(v).trim() || null;
  }

  // Used only by mapDivisionRow — this sheet has no Ticket ID prefix scheme
  // (Reference IDs are just timestamp+username), so brand comes from its
  // "Division" column instead. Any Division not listed here is deliberately
  // excluded from the dataset (per-brand opt-in, not opt-out).
  const DIVISION_BRAND_MAP = {
    'superscatter ph': { code: 'SSP', label: 'SuperScatter PH' },
    'manila casino': { code: 'MNC', label: 'Manila Casino' },
    'casinyeam': { code: 'CSY', label: 'Casinyeam' }
  };

  // Parses "H:MM:SS" / "M:SS" duration text (e.g. "0:18:25") into seconds.
  // Returns null for empty/unparseable values.
  function parseHmsToSeconds(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.trim().split(':').map(Number);
    if (parts.some(isNaN) || parts.length === 0) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  // Deep-links straight to a ticket's row in the live, editable sheet (not the
  // published CSV snapshot). null when we don't have a real sheetId for that
  // brand yet — callers should just render plain text in that case.
  function buildSheetLink(sheetMeta, rowNumber) {
    if (!sheetMeta || !sheetMeta.sheetId || rowNumber == null) return null;
    return `https://docs.google.com/spreadsheets/d/${sheetMeta.sheetId}/edit#gid=${sheetMeta.gid}&range=A${rowNumber}`;
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

  function parseSheetCsv(source, bust) {
    return new Promise((resolve, reject) => {
      if (typeof Papa === 'undefined') {
        reject(new Error('PapaParse is required but was not found on the page.'));
        return;
      }
      // Cache-bust LANG kapag force refresh (auto-refresh / Refresh button):
      // ang unang page load ay dumadaan sa Google/browser cache para mabilis
      // ang first paint — ang 10s auto-refresh naman agad ang magpapasariwa.
      const bustUrl = bust ? source.url + (source.url.includes('?') ? '&' : '?') + '_cb=' + Date.now() : source.url;
      const gidMatch = source.url.match(/[?&]gid=(\d+)/);
      const gid = gidMatch ? gidMatch[1] : '0';
      Papa.parse(bustUrl, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          // Row 1 is the header, so the first data row is sheet row 2. This only
          // stays accurate if there are no blank rows *within* the data range —
          // skipEmptyLines would otherwise shift later rows out of sync.
          const rows = (results.data || []).map((row, i) => ({ ...row, __rowNumber: i + 2 }));
          resolve({ rows, brandOverride: source.brandOverride || null, kind: source.kind || 'ticket', sheetId: source.sheetId || null, gid });
        },
        error: (err) => reject(err)
      });
    });
  }

  // Kinokolekta ang LAHAT ng photo/Drive links mula sa KAHIT ANONG column
  // ng row (ID photo, selfie holding ID, resibo...) — generic, para kahit
  // magkaiba-iba ang column names kada sheet/category ay mahuhuli pa rin.
  // Ginagamit ng ticket popup sa tickets.html. (2026-09-24)
  const URL_IN_CELL_RE = /https?:\/\/[^\s,;|"'\\]+/g;

  // INTERNAL COLUMNS (2026-09-25): ang ticket automation (bot/n8n) ay
  // nagsusulat din ng sarili nitong mga variable sa sheet bilang columns —
  // shouldUpdate, rowData (buong row bilang JSON), valid, type, refId,
  // command, updateData, chatId, _waitSeconds, atbp. Hindi ito para sa tao.
  // Panuntunan: ang totoong sheet columns ay Title Case na may espasyo
  // ("Ticket ID", "OTP Status"); ang internal ay nagsisimula sa maliit na
  // titik o underscore. Kasama rin ang kahit anong cell na JSON blob.
  function isInternalColumn(col, val) {
    const name = String(col || '').trim();
    if (!name || name === '__rowNumber') return true;
    if (/^[a-z_]/.test(name)) return true;
    const v = String(val ?? '').trim();
    if (/^[\[{]/.test(v) && /[\]}]$/.test(v) && v.indexOf('":') !== -1) return true; // totoong JSON lang
    return false;
  }

  function collectPhotoLinks(row) {
    const photos = [];
    const seenUrls = new Set();
    for (const col in row) {
      const val = row[col];
      if (typeof val !== 'string' || val.indexOf('http') === -1 || isInternalColumn(col, val)) continue;
      const urls = val.match(URL_IN_CELL_RE) || [];
      for (const url of urls) {
        const isDrive = /drive\.google\.com|googleusercontent\.com/i.test(url);
        const isImage = /\.(jpe?g|png|gif|webp|heic)([?#].*)?$/i.test(url);
        if (!isDrive && !isImage) continue;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        photos.push({ label: col, url });
        if (photos.length >= 8) return photos;
      }
    }
    return photos;
  }

  // RAW ROW (2026-09-25): kopya ng BUONG row mula sa sheet (lahat ng columns,
  // sa orihinal na pagkakasunod), para sa ticket detail popup sa tickets.html
  // — kung ano ang nasa sheet, yun ang makikita, kahit bagong column pa.
  function rawRow(row) {
    const out = {};
    for (const col in row) {
      if (isInternalColumn(col, row[col])) continue; // automation fields — tingnan sa itaas
      out[col] = row[col];
    }
    return out;
  }

  // Maps a normal ticket-sheet row (Ticket ID / Username / Category / ...) to our common shape.
  function mapTicketRow(row, brandOverride, sheetMeta) {
    if (!row['Ticket ID']) return null;
    const submitted = parseSheetDate(row['Submitted At']);
    if (isNaN(submitted.getTime())) return null;
    const name = row['Username'] || row['Full Name'] || 'Unknown';
    const category = (row['Category'] || '').trim();
    const subcategory = (row['Subcategory'] || '').trim();
    const acknowledgedAt = row['Acknowledged At'] ? parseSheetDate(row['Acknowledged At']) : null;
    const resolvedAt = row['Resolved At'] ? parseSheetDate(row['Resolved At']) : null;
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
      resolveDurationSec: isNaN(resolveDurationSec) ? null : resolveDurationSec,
      rejectReason: rejectReasonFrom(row),
      photos: collectPhotoLinks(row),
      raw: rawRow(row),
      sheetLink: buildSheetLink(sheetMeta, row.__rowNumber)
    };
  }

  // Maps a "Follow Up" sheet row (Reference ID / Query / Query Type / ...) to the
  // same common shape, so it flows through every KPI/chart/list alongside real tickets.
  function mapFollowupRow(row, sheetMeta) {
    if (!row['Reference ID']) return null;
    const submitted = parseSheetDate(row['Submitted At']);
    if (isNaN(submitted.getTime())) return null;
    const query = row['Query'] || 'Unknown';
    const queryType = row['Query Type'] || 'General';
    const acknowledgedAt = row['Acknowledged At'] ? parseSheetDate(row['Acknowledged At']) : null;
    const resolvedAt = row['Resolved At'] ? parseSheetDate(row['Resolved At']) : null;
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
      resolveDurationSec: isNaN(resolveDurationSec) ? null : resolveDurationSec,
      rejectReason: rejectReasonFrom(row),
      photos: collectPhotoLinks(row),
      raw: rawRow(row),
      sheetLink: buildSheetLink(sheetMeta, row.__rowNumber)
    };
  }

  // Maps a "Callback" sheet row (Reference ID / Username / Mobile / Concern / ...) to the
  // same common shape.
  function mapCallbackRow(row, sheetMeta) {
    if (!row['Reference ID']) return null;
    const submitted = parseSheetDate(row['Submitted At']);
    if (isNaN(submitted.getTime())) return null;
    const name = row['Username'] || row['Full Name'] || row['Mobile'] || 'Unknown';
    const concernCategory = (row['Concern Category'] || '').trim();
    const acknowledgedAt = row['Acknowledged At'] ? parseSheetDate(row['Acknowledged At']) : null;
    const resolvedAt = row['Resolved At'] ? parseSheetDate(row['Resolved At']) : null;
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
      resolveDurationSec: isNaN(resolveDurationSec) ? null : resolveDurationSec,
      rejectReason: rejectReasonFrom(row),
      photos: collectPhotoLinks(row),
      raw: rawRow(row),
      sheetLink: buildSheetLink(sheetMeta, row.__rowNumber)
    };
  }

  // Maps a "REQUEST MONITORING"-style row (Reference ID / Division / Bot Notif Time /
  // Checking Time / Done Time / Handled By / ...) — used for sheets that track
  // multiple brands in one tab via a Division column instead of a Ticket ID prefix.
  // Returns null (filtered out) for any Division not in DIVISION_BRAND_MAP, so only
  // explicitly opted-in brands ever make it into the dataset.
  function mapDivisionRow(row, sheetMeta) {
    if (!row['Reference ID']) return null;
    const brand = DIVISION_BRAND_MAP[(row['Division'] || '').trim().toLowerCase()];
    if (!brand) return null;
    const submitted = parseSheetDate(row['Bot Notif Time']);
    if (isNaN(submitted.getTime())) return null;
    const name = row['Username'] || 'Unknown';
    const category = (row['Concern Type'] || '').trim();
    const subcategory = (row['Subcategory'] || '').trim();
    const acknowledgedAt = row['Checking Time'] ? parseSheetDate(row['Checking Time']) : null;
    const resolvedAt = row['Done Time'] ? parseSheetDate(row['Done Time']) : null;
    const si = statusInfo(row['Status']);
    const handledBy = row['Handled By'] || null;
    return {
      id: row['Reference ID'],
      name,
      init: initialsForName(name),
      color: colorForName(name),
      category,
      issue: subcategory || category || '—',
      channel: 'Bot Request',
      brandCode: brand.code,
      brandLabel: brand.label,
      priority: 'medium',
      priorityLabel: 'NORMAL',
      statusRaw: row['Status'],
      statusCls: si.cls,
      statusLabel: si.label,
      submitted,
      acknowledgedBy: handledBy,
      acknowledgedAt: acknowledgedAt && !isNaN(acknowledgedAt.getTime()) ? acknowledgedAt : null,
      resolvedBy: handledBy,
      resolvedAt: resolvedAt && !isNaN(resolvedAt.getTime()) ? resolvedAt : null,
      ackDurationSec: parseHmsToSeconds(row['Acknowledge Duration']),
      resolveDurationSec: parseHmsToSeconds(row['Task Duration']),
      rejectReason: rejectReasonFrom(row),
      photos: collectPhotoLinks(row),
      raw: rawRow(row),
      sheetLink: buildSheetLink(sheetMeta, row.__rowNumber)
    };
  }
  // Guards against a single hung request (e.g. a fetch that never calls back)
  // blocking Promise.allSettled forever, which would otherwise freeze the
  // whole dashboard on "Loading…" indefinitely. After `ms`, the source is
  // treated as failed (skipped, same as a network error) so everything else
  // can still render.
  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
      promise.then(
        val => { clearTimeout(timer); resolve(val); },
        err => { clearTimeout(timer); reject(err); }
      );
    });
  }

  const SOURCE_TIMEOUT_MS = 15000;

  let cachedPromise = null;
  // PROGRESSIVE LOADING (2026-09-23): dati, hinihintay ang LAHAT ng 20+ na
  // sheets (ang pinakamabagal ang gate ng buong page, hanggang 15s). Ngayon,
  // habang dumarating ang bawat sheet, tinatawag agad ang optional
  // onProgress(partialTickets, doneCount, totalCount) para makapag-render na
  // ang page nang maaga; ang final promise ay nagre-resolve pa rin sa
  // kumpletong dataset (parehong shape ng dati — backward compatible).
  function fetchTickets(forceRefresh, onProgress) {
    if (cachedPromise && !forceRefresh) return cachedPromise;
    const seen = new Map();
    let completed = 0;
    const total = SHEET_SOURCES.length;
    const build = () => Array.from(seen.values()).sort((a, b) => b.submitted - a.submitted);
    const tasks = SHEET_SOURCES.map((source, i) =>
      withTimeout(parseSheetCsv(source, !!forceRefresh), SOURCE_TIMEOUT_MS, source.url)
        .then(({ rows, brandOverride, kind, sheetId, gid }) => {
          const sheetMeta = { sheetId, gid };
          rows.forEach(row => {
            const ticket = kind === 'followup' ? mapFollowupRow(row, sheetMeta)
              : kind === 'callback' ? mapCallbackRow(row, sheetMeta)
              : kind === 'division' ? mapDivisionRow(row, sheetMeta)
              : mapTicketRow(row, brandOverride, sheetMeta);
            if (!ticket) return;
            // De-dupe by ticket ID, GLOBAL na (2026-09-24, dating brand+id):
            // ang shared-prefix pairs (HPP/HPP_BD, TMT/TMT_PLAY) ay may
            // PAREHONG pisikal na ticket sa dalawang sheets — kapag
            // in-update ang isa (hal. Rejected na) pero luma pa ang copy sa
            // kabila (In Progress pa), dating dalawang magkahiwalay na entry
            // sila at ang stale copy ay hindi nawawala sa open view. Ngayon:
            // iisa na sila, at ang MAS ADVANCED na status ang mananalo
            // (Done/Rejected > In Progress > New). Ligtas ito globally dahil
            // unique per brand ang ID prefixes.
            const STATUS_RANK = { pending: 0, checking: 1, done: 2, rejected: 2 };
            const prev = seen.get(ticket.id);
            if (prev) {
              const prevRank = STATUS_RANK[prev.statusCls] !== undefined ? STATUS_RANK[prev.statusCls] : -1;
              const newRank = STATUS_RANK[ticket.statusCls] !== undefined ? STATUS_RANK[ticket.statusCls] : -1;
              // PHOTO CARRY-OVER (2026-09-24, v12): sa shared pairs
              // (HPP/HPP_BD, TMT/TMT_PLAY), madalas IISANG sheet lang ang may
              // ID Front/Selfie Link columns. Kahit sino ang manalo sa rank,
              // huwag itapon ang photos ng natalo — kunin ng panalo kapag
              // wala siyang sarili.
              if (newRank < prevRank) {
                if ((!prev.photos || !prev.photos.length) && ticket.photos && ticket.photos.length) prev.photos = ticket.photos;
                return; // panatilihin ang mas advanced na copy
              }
              if ((!ticket.photos || !ticket.photos.length) && prev.photos && prev.photos.length) ticket.photos = prev.photos;
            }
            seen.set(ticket.id, ticket);
          });
        })
        .catch(err => {
          // One flaky/unreachable sheet shouldn't break every other brand's
          // data — log it and continue with whatever did load successfully.
          console.warn(`Skipping sheet source #${i} (${source.url}) — failed to load:`, err);
        })
        .then(() => {
          completed++;
          if (onProgress) {
            try { onProgress(build(), completed, total); } catch (e) { console.error('onProgress error:', e); }
          }
        })
    );
    cachedPromise = Promise.all(tasks).then(build);
    return cachedPromise;
  }

  // Periodically re-fetches fresh data (bypassing the cache) and hands it to
  // the given callback. Returns an interval id so the caller can stop it via
  // clearInterval if needed. Both tickets.html and csr-dashboard.html use this
  // so the page keeps itself current without requiring a manual browser refresh.
  //
  // OVERLAP GUARD (2026-09-25, memory fix): kapag hindi pa tapos ang naunang
  // refresh (hal. mabagal ang isang sheet, hanggang 15s timeout), LALAKTAW
  // ang susunod na tick imbes na magsimula ng panibagong 20+ na sabay-sabay
  // na downloads — iyon ang nagpapatong-patong sa memory kapag naka-idle.
  function startAutoRefresh(callback, intervalMs) {
    let running = false;
    return setInterval(() => {
      if (running) return;
      running = true;
      fetchTickets(true)
        .then(callback)
        .catch(err => console.error('Auto-refresh failed:', err))
        .finally(() => { running = false; });
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
    isInternalColumn,
    isSameLocalDay,
    dayKey,
    pctChange,
    STATUS_MAP,
    BRAND_MAP
  };
})(window);
