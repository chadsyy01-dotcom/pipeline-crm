// ph-network.js — Philippine mobile prefix -> network lookup (added 2026-09-20)
//
// Maps the first 4 digits of a PH mobile number to its ORIGINAL assigned
// network. Used to show a NETWORK column beside NUMBER in SMS Monitoring.
//
// IMPORTANT — Mobile Number Portability (RA 11202): since 2021 a subscriber
// can switch telcos and keep the same number, so the prefix identifies the
// network the number was ORIGINALLY issued under, not necessarily the one
// serving it today. Treat this column as a strong hint, not proof. If exact
// current-network routing ever matters (e.g. per-network SMS pricing), the
// SMS provider's delivery receipt is the only reliable source — most PH
// gateways return the actual network in the DLR payload.
//
// USAGE (plain script tag):
//   <script src="ph-network.js"></script>
//   const net = phNetwork('+639274848254');
//   // -> { network: 'Globe', brand: 'Globe/TM', color: '#2563EB', prefix: '0927' }
//
// Accepts +639XXXXXXXXX, 639XXXXXXXXX, 09XXXXXXXXX, or a bare 0917 prefix.

(function (global) {
  'use strict';

  // Grouped by network family. Sub-brands (TM, TNT, Sun, GOMO) are kept in
  // `brand` for display but roll up to the same parent network.
  const PREFIXES = {
    // ---- GLOBE ----
    Globe: [
      '0817', '0904', '0905', '0906', '0915', '0916', '0917', '0926', '0927',
      '0935', '0936', '0937', '0945', '0953', '0954', '0955', '0956', '0957',
      '0958', '0959', '0965', '0966', '0967', '0973', '0975', '0977', '0978',
      '0979', '0995', '0996', '0997',
    ],
    // GOMO is Globe's all-digital prepaid brand — same network, own products.
    GOMO: ['0976'],
    // ---- SMART ----
    Smart: [
      '0813', '0908', '0918', '0919', '0920', '0921', '0928', '0929', '0939',
      '0947', '0949', '0951', '0961', '0963', '0964', '0968', '0969', '0970',
      '0971', '0972', '0980', '0981', '0989', '0998', '0999',
    ],
    // TNT (Talk 'N Text) — Smart's prepaid brand.
    TNT: ['0907', '0909', '0910', '0912', '0930', '0938', '0946', '0948', '0950'],
    // Sun Cellular — legacy, now under Smart.
    Sun: ['0922', '0923', '0924', '0925', '0931', '0932', '0933', '0934',
          '0940', '0941', '0942', '0943', '0944'],
    // ---- DITO ----
    DITO: ['0895', '0896', '0897', '0898', '0991', '0992', '0993', '0994'],
  };

  // Sub-brand -> parent network, for grouping/totals.
  const PARENT = {
    Globe: 'Globe', GOMO: 'Globe',
    Smart: 'Smart', TNT: 'Smart', Sun: 'Smart',
    DITO: 'DITO',
  };

  // Display colors, matched to the dashboard palette.
  const COLORS = {
    Globe: '#2563EB',   // primary blue
    Smart: '#22C55E',   // success green
    DITO:  '#F59E0B',   // warning amber
    Unknown: '#94A3B8', // ink-faint
  };

  // Flatten into a single lookup once, at load.
  const LOOKUP = {};
  for (const brand in PREFIXES) {
    for (const p of PREFIXES[brand]) LOOKUP[p] = brand;
  }

  // Normalizes any of the accepted input formats to a 4-digit 0XXX prefix.
  // Returns null when the input isn't a recognizable PH mobile number.
  function normalizePrefix(input) {
    let s = String(input == null ? '' : input).replace(/[^\d+]/g, '');
    if (s.startsWith('+63')) s = '0' + s.slice(3);
    else if (s.startsWith('63') && s.length >= 12) s = '0' + s.slice(2);
    else if (s.startsWith('9') && s.length === 10) s = '0' + s;
    if (!s.startsWith('0') || s.length < 4) return null;
    return s.slice(0, 4);
  }

  // Main lookup. Always returns an object — unknown prefixes come back with
  // network 'Unknown' so callers never have to null-check.
  function phNetwork(input) {
    const prefix = normalizePrefix(input);
    if (!prefix) return { network: 'Unknown', brand: 'Unknown', color: COLORS.Unknown, prefix: null };
    const brand = LOOKUP[prefix];
    if (!brand) return { network: 'Unknown', brand: 'Unknown', color: COLORS.Unknown, prefix };
    const network = PARENT[brand];
    return { network, brand: brand === network ? network : `${network}/${brand}`, color: COLORS[network], prefix };
  }

  // Convenience: a ready-made pill for table cells.
  function phNetworkBadge(input) {
    const n = phNetwork(input);
    return '<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;'
      + `color:${n.color};background:${n.color}1A;">${n.network}</span>`;
  }

  // Convenience: counts per network for a list of numbers, for KPI cards.
  function phNetworkCounts(numbers) {
    const out = { Globe: 0, Smart: 0, DITO: 0, Unknown: 0 };
    (numbers || []).forEach(num => { out[phNetwork(num).network]++; });
    return out;
  }

  global.phNetwork = phNetwork;
  global.phNetworkBadge = phNetworkBadge;
  global.phNetworkCounts = phNetworkCounts;
  global.PH_PREFIXES = PREFIXES;
})(typeof window !== 'undefined' ? window : globalThis);
