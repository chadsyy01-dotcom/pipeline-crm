/* =====================================================================
   OFFICE AVATAR + WARDROBE (2026-11-02)
   Detalyadong karakter para sa Opisina (office.html): mukha (balat, hugis,
   mata, kilay, ilong, bibig), buhok, accessories, at WARDROBE — listahan ng
   mga outfit na puwedeng palitan anumang oras.
   - OfficeAvatar.draw(ctx, cfg, x, y, opts)  → iginuguhit ang karakter;
     (x, y) = pagitan ng mga paa. opts: { scale, t, walking, sitting, sleep }
   - OfficeAvatar.defaults(seed, hints)        → itsura bago mag-customize
   - OfficeAvatar.sanitize(cfg, seed, hints)   → sinusuri ang galing sa server
   - OfficeAvatar.openEditor(cfg, onSave)      → wardrobe modal
   ===================================================================== */
(function () {
  const OPT = {
    skin: ['#ffe3cc', '#f6cba5', '#e9b48a', '#d49b6c', '#b97b50', '#8e5a3b', '#6a3f28'],
    shape: ['round', 'oval', 'square'],
    eyes: ['round', 'big', 'almond', 'happy', 'sleepy'],
    eyeColor: ['#2b1d14', '#4a2f1d', '#6b4a2a', '#1f3a5f', '#2f5a2f', '#55595f'],
    brows: ['flat', 'arched', 'thick', 'none'],
    nose: ['dot', 'button', 'line'],
    mouth: ['smile', 'grin', 'neutral', 'open', 'smirk'],
    hair: ['short', 'side', 'spiky', 'buzz', 'curly', 'pixie', 'bob', 'long', 'ponytail', 'bun', 'bald'],
    hairColor: ['#161212', '#3b2a20', '#5a3a22', '#7a4b2a', '#a8743a', '#d9b26f', '#8a8f99', '#b03a48', '#4b3a8f', '#2f6f8f'],
    glasses: ['none', 'round', 'square', 'shades'],
    facial: ['none', 'mustache', 'goatee', 'beard'],
    earrings: ['none', 'studs', 'hoops'],
    top: ['tshirt', 'polo', 'longsleeve', 'blouse', 'blazer', 'sweater', 'hoodie', 'dress'],
    bottom: ['slacks', 'jeans', 'shorts', 'skirt', 'longskirt'],
    shoes: ['shoes', 'sneakers', 'heels', 'sandals'],
    tie: ['none', 'tie', 'bow'],
    cloth: ['#111827', '#334155', '#64748b', '#0f3d5e', '#1e40af', '#38bdf8', '#0d9488', '#16a34a', '#a3e635',
      '#facc15', '#f97316', '#dc2626', '#9f1239', '#db2777', '#f9a8d4', '#c084fc', '#7c3aed', '#f5f5f4', '#d6c7a1', '#8b5e3c'],
  };
  const LABEL = {
    round: 'Bilog', oval: 'Oval', square: 'Kuwadrado', big: 'Malaki', almond: 'Almond', happy: 'Masaya', sleepy: 'Antok',
    flat: 'Tuwid', arched: 'Arko', thick: 'Makapal', none: 'Wala', dot: 'Maliit', button: 'Button', line: 'Matangos',
    smile: 'Ngiti', grin: 'Tawa', neutral: 'Seryoso', open: 'Bukas', smirk: 'Smirk',
    short: 'Maikli', side: 'Side part', spiky: 'Spiky', buzz: 'Buzz cut', curly: 'Kulot', pixie: 'Pixie', bob: 'Bob',
    long: 'Mahaba', ponytail: 'Ponytail', bun: 'Bun', bald: 'Kalbo', shades: 'Shades',
    mustache: 'Bigote', goatee: 'Goatee', beard: 'Balbas', studs: 'Studs', hoops: 'Hoops',
    tshirt: 'T-shirt', polo: 'Polo', longsleeve: 'Long sleeves', blouse: 'Blouse', blazer: 'Blazer', sweater: 'Sweater',
    hoodie: 'Hoodie', dress: 'Dress', slacks: 'Slacks', jeans: 'Jeans', shorts: 'Shorts', skirt: 'Palda',
    longskirt: 'Mahabang palda', shoes: 'Sapatos', sneakers: 'Sneakers', heels: 'Heels', sandals: 'Sandals',
    tie: 'Necktie', bow: 'Bow tie',
  };
  const HEX = /^#[0-9a-f]{6}$/i;

  // ---------- defaults / sanitize ----------
  function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function picker(seed) { let h = hash(seed); return arr => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; return arr[h % arr.length]; }; }
  function defaults(seed, hints) {
    const p = picker(seed), hs = hints || {};
    const office = { name: 'Office', top: p(['polo', 'blazer', 'blouse', 'longsleeve']), topColor: p(['#1e40af', '#0f3d5e', '#f5f5f4', '#334155', '#0d9488', '#9f1239']),
      bottom: p(['slacks', 'slacks', 'skirt']), bottomColor: p(['#111827', '#334155', '#64748b']), shoes: 'shoes', shoesColor: '#111827',
      tie: 'none', tieColor: '#dc2626' };
    const casual = { name: 'Casual', top: p(['tshirt', 'hoodie', 'sweater', 'tshirt']), topColor: p(OPT.cloth),
      bottom: p(['jeans', 'shorts', 'jeans']), bottomColor: p(['#1e40af', '#334155', '#d6c7a1']), shoes: 'sneakers', shoesColor: '#f5f5f4',
      tie: 'none', tieColor: '#dc2626' };
    return {
      v: 1, skin: p(OPT.skin), shape: p(OPT.shape), eyes: p(['round', 'big', 'almond', 'happy']), eyeColor: p(OPT.eyeColor),
      brows: p(['flat', 'arched', 'thick']), nose: p(OPT.nose), mouth: p(['smile', 'grin', 'smile', 'smirk']), blush: false,
      hair: p(OPT.hair.filter(h => h !== 'bald')), hairColor: p(OPT.hairColor.slice(0, 6)), glasses: 'none', facial: 'none', earrings: 'none',
      headset: !!hs.headset, outfits: [office, casual], current: 0,
    };
  }
  const inList = (v, list, d) => (list.includes(v) ? v : d);
  const color = (v, d) => (typeof v === 'string' && HEX.test(v) ? v : d);
  function sanitize(cfg, seed, hints) {
    const d = defaults(seed, hints);
    if (!cfg || typeof cfg !== 'object') return d;
    const c = {
      v: 1, skin: color(cfg.skin, d.skin), shape: inList(cfg.shape, OPT.shape, d.shape), eyes: inList(cfg.eyes, OPT.eyes, d.eyes),
      eyeColor: color(cfg.eyeColor, d.eyeColor), brows: inList(cfg.brows, OPT.brows, d.brows), nose: inList(cfg.nose, OPT.nose, d.nose),
      mouth: inList(cfg.mouth, OPT.mouth, d.mouth), blush: !!cfg.blush, hair: inList(cfg.hair, OPT.hair, d.hair),
      hairColor: color(cfg.hairColor, d.hairColor), glasses: inList(cfg.glasses, OPT.glasses, d.glasses),
      facial: inList(cfg.facial, OPT.facial, d.facial), earrings: inList(cfg.earrings, OPT.earrings, d.earrings),
      headset: cfg.headset === undefined ? d.headset : !!cfg.headset, outfits: [], current: 0,
    };
    (Array.isArray(cfg.outfits) ? cfg.outfits : []).slice(0, 8).forEach((o, i) => {
      if (!o || typeof o !== 'object') return;
      const b = d.outfits[i % 2];
      c.outfits.push({
        name: String(o.name || `Outfit ${i + 1}`).slice(0, 24), top: inList(o.top, OPT.top, b.top), topColor: color(o.topColor, b.topColor),
        bottom: inList(o.bottom, OPT.bottom, b.bottom), bottomColor: color(o.bottomColor, b.bottomColor),
        shoes: inList(o.shoes, OPT.shoes, b.shoes), shoesColor: color(o.shoesColor, b.shoesColor),
        tie: inList(o.tie, OPT.tie, 'none'), tieColor: color(o.tieColor, '#dc2626'),
      });
    });
    if (!c.outfits.length) c.outfits = d.outfits;
    c.current = Math.max(0, Math.min(c.outfits.length - 1, Number(cfg.current) || 0));
    return c;
  }
  const outfit = cfg => cfg.outfits[cfg.current] || cfg.outfits[0];

  // ---------- drawing ----------
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16), f = v => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  function draw(c, cfg, x, y, o) {
    o = o || {};
    const u = o.scale || 1, t = o.t || 0, of = outfit(cfg);
    const X = dx => x + dx * u, Y = dy => y + dy * u;
    const rr = (dx, dy, w, h, r) => { c.beginPath(); const L = X(dx), T = Y(dy), W = w * u, H = h * u, R = Math.min(r * u, W / 2, H / 2);
      c.moveTo(L + R, T); c.arcTo(L + W, T, L + W, T + H, R); c.arcTo(L + W, T + H, L, T + H, R); c.arcTo(L, T + H, L, T, R); c.arcTo(L, T, L + W, T, R); c.closePath(); };
    const circ = (dx, dy, r) => { c.beginPath(); c.arc(X(dx), Y(dy), r * u, 0, Math.PI * 2); };
    const ell = (dx, dy, rx, ry, rot) => { c.beginPath(); c.ellipse(X(dx), Y(dy), rx * u, ry * u, rot || 0, 0, Math.PI * 2); };
    const fill = col => { c.fillStyle = col; c.fill(); };
    const stroke = (col, w) => { c.strokeStyle = col; c.lineWidth = w * u; c.lineCap = 'round'; c.stroke(); };
    const path = (pts, close) => { c.beginPath(); pts.forEach(([a, b], i) => (i ? c.lineTo(X(a), Y(b)) : c.moveTo(X(a), Y(b)))); if (close) c.closePath(); };

    const walk = o.walking ? Math.sin(t * 12) : 0;
    const sit = !!o.sitting;
    const lift = sit ? 3.5 : 0;                       // naka-upo: mas mababa ang katawan
    const bob = o.walking ? Math.abs(Math.sin(t * 12)) * 1.1 : Math.sin(t * 2.4) * 0.35;
    const B = -bob + lift;                            // offset ng katawan pababa
    const skin = cfg.skin, skinD = shade(skin, -0.12), hairC = cfg.hairColor;
    const isDress = of.top === 'dress';
    const legCol = isDress ? skin : of.bottom === 'shorts' || of.bottom === 'skirt' ? skin : of.bottomColor;

    // --- shoes + legs
    const legTop = -11 + B, legLen = sit ? 6 : 9.5;
    [[-2.4, walk], [2.4, -walk]].forEach(([lx, sw]) => {
      const fx = lx + sw * 1.6;
      path([[lx - 1.6, legTop], [lx + 1.6, legTop], [fx + 1.6, legTop + legLen], [fx - 1.6, legTop + legLen]], true); fill(legCol);
      if (!isDress && of.bottom === 'shorts') { path([[lx - 1.7, legTop], [lx + 1.7, legTop], [lx + 1.7 + sw * 0.6, legTop + 4.5], [lx - 1.7 + sw * 0.6, legTop + 4.5]], true); fill(of.bottomColor); }
      const sy = legTop + legLen;
      if (of.shoes === 'heels') { ell(fx, sy, 1.9, 1.1); fill(of.shoesColor); path([[fx + 0.9, sy], [fx + 1.3, sy + 1.6]]); stroke(of.shoesColor, 0.8); }
      else if (of.shoes === 'sandals') { ell(fx, sy + 0.2, 2.1, 1); fill(skinD); path([[fx - 1.6, sy - 0.2], [fx + 1.6, sy - 0.2]]); stroke(of.shoesColor, 0.9); }
      else { ell(fx, sy + 0.1, 2.4, 1.4); fill(of.shoesColor); if (of.shoes === 'sneakers') { ell(fx, sy + 0.9, 2.4, 0.5); fill('#f5f5f4'); } }
    });

    // --- skirts / dress
    if (isDress) { path([[-5, -13 + B], [5, -13 + B], [7, -3.5 + B], [-7, -3.5 + B]], true); fill(of.topColor); path([[-7, -3.5 + B], [7, -3.5 + B]]); stroke(shade(of.topColor, -0.15), 0.7); }
    else if (of.bottom === 'skirt' || of.bottom === 'longskirt') {
      const hem = of.bottom === 'skirt' ? -5.5 : -2.2;
      path([[-5, -12 + B], [5, -12 + B], [6.6, hem + B], [-6.6, hem + B]], true); fill(of.bottomColor);
      path([[-1, -11 + B], [-1.6, hem + B]]); stroke(shade(of.bottomColor, -0.12), 0.5);
    }

    // --- buhok sa likod (bago ang katawan, para nasa likod ng balikat)
    const HY = -30.5 + B;                               // gitna ng ulo
    const hb = cfg.hair;
    if (hb === 'long') { rr(-8.6, HY - 4, 17.2, 17.5, 5); fill(shade(hairC, -0.06)); }
    if (hb === 'bob') { rr(-8.8, HY - 4, 17.6, 11, 5); fill(shade(hairC, -0.06)); }
    if (hb === 'curly') { [[-7, -2], [7, -2], [-6, 3], [6, 3], [-8, 1], [8, 1]].forEach(([a, b]) => { circ(a, HY + b, 3.2); fill(shade(hairC, -0.05)); }); }
    if (hb === 'ponytail') { const sw = Math.sin(t * 3) * 0.6; path([[6, HY - 3], [10 + sw, HY + 1], [9.4 + sw, HY + 9], [7, HY + 3]], true); fill(shade(hairC, -0.05)); }

    // --- torso + arms
    const top = of.top, tc = of.topColor, tcD = shade(tc, -0.14);
    const longSleeve = ['longsleeve', 'blazer', 'sweater', 'hoodie'].includes(top);
    const armSwing = o.walking ? walk * 1.4 : 0;
    [[-6.6, armSwing], [6.6, -armSwing]].forEach(([ax, sw]) => {
      path([[ax - 1.3, -21 + B], [ax + 1.3, -21 + B], [ax + 1.3 + sw * 0.6, -12.5 + B], [ax - 1.3 + sw * 0.6, -12.5 + B]], true); fill(longSleeve ? tcD : skin);
      if (!longSleeve && top !== 'dress') { path([[ax - 1.5, -21.2 + B], [ax + 1.5, -21.2 + B], [ax + 1.6, -17.2 + B], [ax - 1.6, -17.2 + B]], true); fill(tcD); }
      circ(ax + sw * 0.6, -12 + B, 1.5); fill(skin);
    });
    if (top === 'hoodie') { ell(0, -21.5 + B, 5.5, 2.6); fill(tcD); }
    rr(-5.3, -22 + B, 10.6, 11.5, 3.2); fill(isDress ? tc : tc);
    if (!isDress && (of.bottom === 'slacks' || of.bottom === 'jeans' || of.bottom === 'shorts')) {
      rr(-5.3, -12.4 + B, 10.6, 2.2, 1); fill(of.bottomColor);
      path([[-5.2, -12.3 + B], [5.2, -12.3 + B]]); stroke(shade(of.bottomColor, -0.25), 0.6);
    }
    if (top === 'polo') { path([[-2.6, -22 + B], [0, -19.6 + B], [2.6, -22 + B], [1.2, -22 + B], [0, -21 + B], [-1.2, -22 + B]], true); fill(shade(tc, 0.18));
      circ(0, -18.4 + B, 0.35); fill(shade(tc, -0.3)); circ(0, -16.8 + B, 0.35); fill(shade(tc, -0.3)); }
    if (top === 'blazer') {
      path([[-2.4, -22 + B], [2.4, -22 + B], [0, -15 + B]], true); fill('#f5f5f4');
      path([[-2.4, -22 + B], [0, -15 + B], [-3.4, -18.5 + B]], true); fill(tcD);
      path([[2.4, -22 + B], [0, -15 + B], [3.4, -18.5 + B]], true); fill(tcD);
      circ(0.9, -13.8 + B, 0.4); fill(shade(tc, -0.35));
    }
    if (top === 'blouse') { for (let i = -2; i <= 2; i++) { circ(i * 1.2, -21.6 + B, 0.85); fill(shade(tc, 0.2)); } }
    if (top === 'sweater') { [-13.4, -12.6].forEach(yy => { path([[-5, yy + B], [5, yy + B]]); stroke(tcD, 0.35); }); path([[-2.2, -22 + B], [0, -20.2 + B], [2.2, -22 + B]]); stroke(tcD, 0.6); }
    if (top === 'hoodie') { path([[-1.2, -21 + B], [-1.4, -17.5 + B]]); stroke('#f5f5f4', 0.4); path([[1.2, -21 + B], [1.4, -17.5 + B]]); stroke('#f5f5f4', 0.4);
      rr(-3.2, -16 + B, 6.4, 2.6, 1); fill(tcD); }
    if (top === 'tshirt' || top === 'longsleeve' || top === 'dress') { path([[-2.2, -22 + B], [0, -20.4 + B], [2.2, -22 + B]]); stroke(tcD, 0.6); }
    if (of.tie === 'tie' && top !== 'dress') { path([[-0.8, -21.6 + B], [0.8, -21.6 + B], [1.1, -15 + B], [0, -13.8 + B], [-1.1, -15 + B]], true); fill(of.tieColor); }
    if (of.tie === 'bow' && top !== 'dress') { path([[0, -21.3 + B], [-2.2, -22.3 + B], [-2.2, -20.3 + B]], true); fill(of.tieColor); path([[0, -21.3 + B], [2.2, -22.3 + B], [2.2, -20.3 + B]], true); fill(of.tieColor); }

    // --- leeg
    rr(-1.6, -24.5 + B, 3.2, 3.2, 1); fill(skinD);
    // --- headset band (likod)
    if (cfg.headset) { c.beginPath(); c.arc(X(0), Y(HY - 0.5), 9 * u, Math.PI * 1.05, Math.PI * 1.95); stroke('#1b1e2e', 1.2); }

    // --- ulo
    if (cfg.shape === 'oval') ell(0, HY, 7.4, 8.7);
    else if (cfg.shape === 'square') rr(-7.6, HY - 7.8, 15.2, 15.6, 4.6);
    else circ(0, HY, 8);
    fill(skin);
    circ(-7.9, HY + 0.6, 1.8); fill(skinD); circ(7.9, HY + 0.6, 1.8); fill(skinD);
    if (cfg.earrings === 'studs') { circ(-8, HY + 2.3, 0.6); fill('#fde68a'); circ(8, HY + 2.3, 0.6); fill('#fde68a'); }
    if (cfg.earrings === 'hoops') { [-8, 8].forEach(ex => { c.beginPath(); c.arc(X(ex), Y(HY + 3.2), 1.1 * u, 0, Math.PI * 2); stroke('#fbbf24', 0.45); }); }
    if (cfg.facial === 'beard') { path([[-7.4, HY + 0.5], [7.4, HY + 0.5], [5.5, HY + 7], [0, HY + 8.6], [-5.5, HY + 7]], true); fill(shade(hairC, 0.05)); }

    // --- mukha
    const ex = 3.1, ey = HY + 0.4, closed = o.sleep || cfg.eyes === 'sleepy';
    const blink = !closed && ((t + (o.seed || 0)) % 4.2) < 0.12;
    [-ex, ex].forEach(dx => {
      if (closed || blink) { c.beginPath(); c.arc(X(dx), Y(ey - 0.4), 1.5 * u, Math.PI * 0.15, Math.PI * 0.85); stroke('#2b1d14', 0.55); return; }
      if (cfg.eyes === 'happy') { c.beginPath(); c.arc(X(dx), Y(ey + 0.6), 1.5 * u, Math.PI * 1.15, Math.PI * 1.85); stroke('#2b1d14', 0.6); return; }
      const big = cfg.eyes === 'big', alm = cfg.eyes === 'almond';
      if (alm) ell(dx, ey, 2.1, 1.35); else circ(dx, ey, big ? 2.25 : 1.75);
      fill('#ffffff');
      circ(dx + 0.15, ey + 0.15, big ? 1.45 : alm ? 1.05 : 1.15); fill(cfg.eyeColor);
      circ(dx + 0.15, ey + 0.15, big ? 0.7 : 0.5); fill('#0b0b0b');
      circ(dx + 0.65, ey - 0.45, big ? 0.55 : 0.4); fill('#ffffff');
    });
    const browC = shade(hairC, -0.05), by = ey - 3;
    if (cfg.brows === 'flat') { [-ex, ex].forEach(dx => { path([[dx - 1.5, by], [dx + 1.5, by]]); stroke(browC, 0.55); }); }
    if (cfg.brows === 'arched') { [-ex, ex].forEach(dx => { c.beginPath(); c.arc(X(dx), Y(by + 1.2), 1.8 * u, Math.PI * 1.2, Math.PI * 1.8); stroke(browC, 0.55); }); }
    if (cfg.brows === 'thick') { [-ex, ex].forEach(dx => { path([[dx - 1.7, by + 0.2], [dx + 1.7, by - 0.2]]); stroke(browC, 1.1); }); }
    const ny = HY + 2.6;
    if (cfg.nose === 'dot') { circ(0, ny, 0.55); fill(shade(skin, -0.2)); }
    if (cfg.nose === 'button') { ell(0, ny, 1.1, 0.75); fill(shade(skin, -0.1)); circ(-0.4, ny + 0.2, 0.25); fill(shade(skin, -0.3)); circ(0.4, ny + 0.2, 0.25); fill(shade(skin, -0.3)); }
    if (cfg.nose === 'line') { path([[0.2, ny - 2], [0.8, ny + 0.5], [-0.3, ny + 0.7]]); stroke(shade(skin, -0.25), 0.45); }
    if (cfg.blush) { ell(-4.7, HY + 3, 1.5, 0.9); fill('rgba(244,114,182,0.38)'); ell(4.7, HY + 3, 1.5, 0.9); fill('rgba(244,114,182,0.38)'); }
    if (cfg.facial === 'mustache') { path([[-2.4, HY + 4.3], [0, HY + 3.7], [2.4, HY + 4.3], [0, HY + 4.6]], true); fill(shade(hairC, 0.04)); }
    const my = HY + 5, mc = '#7a2e2e';
    if (cfg.mouth === 'smile') { c.beginPath(); c.arc(X(0), Y(my - 1), 1.9 * u, Math.PI * 0.2, Math.PI * 0.8); stroke(mc, 0.55); }
    if (cfg.mouth === 'grin') { c.beginPath(); c.moveTo(X(-2), Y(my - 0.4)); c.arc(X(0), Y(my - 0.4), 2 * u, 0, Math.PI); c.closePath(); fill(mc);
      c.beginPath(); c.moveTo(X(-1.6), Y(my - 0.3)); c.lineTo(X(1.6), Y(my - 0.3)); stroke('#ffffff', 0.5); }
    if (cfg.mouth === 'neutral') { path([[-1.4, my], [1.4, my]]); stroke(mc, 0.55); }
    if (cfg.mouth === 'open') { ell(0, my, 1.1, 1.3); fill(mc); }
    if (cfg.mouth === 'smirk') { path([[-1.6, my + 0.2], [0.6, my + 0.1], [1.9, my - 0.8]]); stroke(mc, 0.55); }
    if (cfg.facial === 'goatee') { path([[-1.3, HY + 6.6], [1.3, HY + 6.6], [0, HY + 8.6]], true); fill(shade(hairC, 0.04)); }

    // --- buhok (harap)
    const hc = hairC, hy = HY;
    // bubong ng buhok: bahagi ng ulo sa itaas ng hairline (hindi tinatakpan ang mata)
    const cap = (low) => { c.save(); c.beginPath(); c.rect(X(-10), Y(hy - 12), 20 * u, (8.6 + low * 10) * u); c.clip();
      c.beginPath(); c.arc(X(0), Y(hy), 8.4 * u, 0, Math.PI * 2); fill(hc); c.restore(); };
    switch (hb) {
      case 'short': cap(0.02); path([[-8, hy - 1], [-4, hy - 3.2], [0, hy - 2.2], [4, hy - 3.4], [8, hy - 1], [8, hy - 4], [-8, hy - 4]], true); fill(hc); break;
      case 'side': cap(0.05); path([[-8.2, hy - 0.5], [-6, hy - 2], [3, hy - 4.8], [8.2, hy - 1.5], [8.2, hy - 4], [-8.2, hy - 4]], true); fill(hc);
        path([[-2, hy - 5.2], [2.5, hy - 4]]); stroke(shade(hc, 0.15), 0.5); break;
      case 'spiky': cap(0); for (let i = -3; i <= 3; i++) { path([[i * 2.4 - 1.6, hy - 6], [i * 2.4, hy - 11 - (i % 2 ? 0 : 1.2)], [i * 2.4 + 1.6, hy - 6]], true); fill(hc); } break;
      case 'buzz': c.save(); c.globalAlpha *= 0.75; cap(-0.02); c.restore(); break;
      case 'curly': for (let i = -3; i <= 3; i++) { circ(i * 2.3, hy - 6.4 - (Math.abs(i) < 2 ? 1 : 0), 2.7); fill(hc); }
        circ(-6.8, hy - 3, 2.4); fill(hc); circ(6.8, hy - 3, 2.4); fill(hc); break;
      case 'pixie': cap(0.04); path([[-8.3, hy], [-3, hy - 4.6], [6, hy - 2.6], [8.3, hy - 2], [8.3, hy - 4], [-8.3, hy - 4]], true); fill(hc); break;
      case 'bob': cap(0.05); path([[-8.6, hy - 1], [-8.8, hy + 6], [-6.6, hy + 6], [-6.4, hy - 1.6]], true); fill(hc);
        path([[8.6, hy - 1], [8.8, hy + 6], [6.6, hy + 6], [6.4, hy - 1.6]], true); fill(hc);
        path([[-8, hy - 1.4], [8, hy - 1.4], [8, hy - 4], [-8, hy - 4]], true); fill(hc); break;
      case 'long': cap(0.05); path([[-8.6, hy - 1], [-8.6, hy + 11], [-6.2, hy + 11], [-6.2, hy - 2]], true); fill(hc);
        path([[8.6, hy - 1], [8.6, hy + 11], [6.2, hy + 11], [6.2, hy - 2]], true); fill(hc);
        path([[-7, hy - 2], [0, hy - 4.2], [7, hy - 2], [7, hy - 4], [-7, hy - 4]], true); fill(hc); break;
      case 'ponytail': cap(0); circ(6.6, hy - 2.2, 1.1); fill('#f472b6'); break;
      case 'bun': cap(0); circ(0, hy - 9.5, 3.6); fill(hc); circ(-1.1, hy - 10.6, 0.9); fill(shade(hc, 0.15)); break;
      case 'bald': ell(-2.6, hy - 5.2, 1.6, 0.8, -0.4); fill('rgba(255,255,255,0.35)'); break;
    }
    // --- salamin
    if (cfg.glasses !== 'none') {
      const gc = cfg.glasses === 'shades' ? '#111827' : '#1f2937';
      [-ex, ex].forEach(dx => {
        if (cfg.glasses === 'square') { rr(dx - 2.4, ey - 1.9, 4.8, 3.8, 0.8); stroke(gc, 0.5); }
        else { circ(dx, ey, 2.5); if (cfg.glasses === 'shades') fill('rgba(17,24,39,0.88)'); stroke(gc, 0.5); }
      });
      path([[-ex + 2.4, ey], [ex - 2.4, ey]]); stroke(gc, 0.5);
    }
    // --- headset mic + earcups (harap)
    if (cfg.headset) { rr(-9.6, HY - 1.8, 2.6, 4.4, 1.2); fill('#1b1e2e'); rr(7, HY - 1.8, 2.6, 4.4, 1.2); fill('#1b1e2e');
      path([[-8.3, HY + 2.4], [-6, HY + 6], [-3.2, HY + 6.2]]); stroke('#1b1e2e', 0.6); circ(-3, HY + 6.2, 0.7); fill('#1b1e2e'); }
    return { headY: Y(HY - 9) };
  }

  // ---------- wardrobe editor ----------
  let css = false;
  function injectCss() {
    if (css) return; css = true;
    const st = document.createElement('style');
    st.textContent = `
    .wd-back{position:fixed;inset:0;z-index:200;background:rgba(5,6,12,.72);display:flex;align-items:center;justify-content:center;padding:16px}
    .wd{background:#131524;color:#e8eaf6;border:1px solid #262a45;border-radius:16px;width:min(920px,100%);max-height:calc(100vh - 32px);display:grid;grid-template-columns:260px minmax(0,1fr);overflow:hidden;font-family:"IBM Plex Sans",system-ui,sans-serif}
    .wd-prev{background:radial-gradient(90% 70% at 50% 60%,#232848,#131524);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px}
    .wd canvas{position:static;inset:auto}
    .wd-prev canvas{width:220px;height:280px}
    .wd-prev b{font-family:"Bricolage Grotesque",system-ui,sans-serif;font-size:20px}
    .wd-prev small{color:#8b90b2;font-family:"IBM Plex Mono",monospace;font-size:11px}
    .wd-main{display:flex;flex-direction:column;min-height:0;min-width:0}
    .wd-tabs{display:flex;gap:4px;padding:12px 14px 0;flex-wrap:wrap}
    .wd-tabs button{background:none;border:1px solid #262a45;color:#8b90b2;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}
    .wd-tabs button[aria-selected="true"]{background:#38e1ff;color:#06222b;border-color:#38e1ff;font-weight:600}
    .wd-body{overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px;min-height:0;flex:1}
    .wd-field h4{margin:0 0 6px;font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8b90b2;font-weight:500}
    .wd-opts{display:flex;flex-wrap:wrap;gap:6px}
    .wd-opts button{background:#1a1d31;border:1px solid #262a45;color:#e8eaf6;border-radius:8px;padding:5px 10px;font:inherit;font-size:12.5px;cursor:pointer}
    .wd-opts button[aria-pressed="true"]{border-color:#38e1ff;box-shadow:inset 0 0 0 1px #38e1ff}
    .wd-opts button.sw{width:26px;height:26px;padding:0;border-radius:50%}
    .wd-opts button.sw[aria-pressed="true"]{box-shadow:0 0 0 2px #131524,0 0 0 4px #38e1ff}
    .wd-outfits{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
    .wd-of{background:#1a1d31;border:1px solid #262a45;border-radius:12px;padding:8px;display:flex;flex-direction:column;align-items:center;gap:6px}
    .wd-of.on{border-color:#38e1ff}
    .wd-of canvas{width:72px;height:92px}
    .wd-of input{width:100%;box-sizing:border-box;background:#131524;border:1px solid #262a45;color:#e8eaf6;border-radius:6px;padding:4px 6px;font:inherit;font-size:12px;text-align:center}
    .wd-of .row2{display:flex;gap:4px}
    .wd-of .row2 button,.wd-add{background:#131524;border:1px solid #262a45;color:#e8eaf6;border-radius:6px;padding:4px 8px;font:inherit;font-size:11.5px;cursor:pointer}
    .wd-add{border-style:dashed;min-height:120px;border-radius:12px;color:#8b90b2}
    .wd-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 14px;border-top:1px solid #262a45;align-items:center}
    .wd-foot span{margin-right:auto;color:#8b90b2;font-size:12.5px}
    .wd-foot button{border-radius:9px;padding:8px 14px;font:inherit;font-weight:600;font-size:13px;cursor:pointer;border:1px solid #262a45;background:#1a1d31;color:#e8eaf6}
    .wd-foot button.pri{background:#38e1ff;color:#06222b;border-color:#38e1ff}
    .wd button:focus-visible,.wd input:focus-visible{outline:2px solid #38e1ff;outline-offset:2px}
    @media (max-width:720px){.wd{grid-template-columns:1fr}.wd-prev{flex-direction:row;padding:10px}.wd-prev canvas{width:110px;height:140px}}`;
    document.head.appendChild(st);
  }
  function renderTo(cv, cfg, scale, t, w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(w / 2, h - 10, 9 * scale, 2.6 * scale, 0, 0, Math.PI * 2); c.fill();
    draw(c, cfg, w / 2, h - 10 - 0.5 * scale, { scale, t });
  }
  function portrait(cv, cfg, w, h, t) { renderTo(cv, cfg, Math.min(w / 26, h / 44), t || 0, w, h); }

  function openEditor(cfgIn, onSave, who) {
    injectCss();
    let cfg = JSON.parse(JSON.stringify(cfgIn));
    let tab = 'face', anim = 0, closed = false;
    const back = document.createElement('div'); back.className = 'wd-back';
    back.innerHTML = `<div class="wd" role="dialog" aria-modal="true" aria-label="Wardrobe">
      <div class="wd-prev"><canvas width="220" height="280"></canvas><div style="text-align:center"><b></b><br><small></small></div></div>
      <div class="wd-main">
        <div class="wd-tabs" role="tablist">
          <button data-tab="face" role="tab">Mukha</button><button data-tab="hair" role="tab">Buhok</button>
          <button data-tab="clothes" role="tab">Damit</button><button data-tab="wardrobe" role="tab">Wardrobe</button>
          <button data-tab="extras" role="tab">Accessories</button>
        </div>
        <div class="wd-body"></div>
        <div class="wd-foot"><span class="wd-msg"></span><button class="cancel">Kanselahin</button><button class="pri save">I-save</button></div>
      </div></div>`;
    document.body.appendChild(back);
    const cv = back.querySelector('.wd-prev canvas'), body = back.querySelector('.wd-body'), msg = back.querySelector('.wd-msg');
    back.querySelector('.wd-prev b').textContent = who || 'Ikaw';
    const cur = () => cfg.outfits[cfg.current];
    const field = (title, get, set, list, swatch) => {
      const f = document.createElement('div'); f.className = 'wd-field';
      f.innerHTML = `<h4></h4><div class="wd-opts"></div>`; f.querySelector('h4').textContent = title;
      const box = f.querySelector('.wd-opts');
      list.forEach(v => {
        const b = document.createElement('button'); b.type = 'button';
        if (swatch) { b.className = 'sw'; b.style.background = v; b.title = v; b.setAttribute('aria-label', title + ' ' + v); }
        else b.textContent = typeof v === 'boolean' ? (v ? 'Meron' : 'Wala') : (LABEL[v] || v);
        b.setAttribute('aria-pressed', get() === v);
        b.onclick = () => { set(v); box.querySelectorAll('button').forEach((x, i) => x.setAttribute('aria-pressed', list[i] === get())); };
        box.appendChild(b);
      });
      body.appendChild(f);
    };
    function renderTab() {
      body.textContent = '';
      back.querySelectorAll('.wd-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
      const S = k => v => { cfg[k] = v; }, G = k => () => cfg[k];
      const SO = k => v => { cur()[k] = v; }, GO = k => () => cur()[k];
      if (tab === 'face') {
        field('Kulay ng balat', G('skin'), S('skin'), OPT.skin, true);
        field('Hugis ng mukha', G('shape'), S('shape'), OPT.shape);
        field('Mata', G('eyes'), S('eyes'), OPT.eyes);
        field('Kulay ng mata', G('eyeColor'), S('eyeColor'), OPT.eyeColor, true);
        field('Kilay', G('brows'), S('brows'), OPT.brows);
        field('Ilong', G('nose'), S('nose'), OPT.nose);
        field('Bibig', G('mouth'), S('mouth'), OPT.mouth);
        field('Blush', G('blush'), S('blush'), [false, true]);
        field('Bigote / balbas', G('facial'), S('facial'), OPT.facial);
      } else if (tab === 'hair') {
        field('Estilo ng buhok', G('hair'), S('hair'), OPT.hair);
        field('Kulay ng buhok', G('hairColor'), S('hairColor'), OPT.hairColor, true);
      } else if (tab === 'clothes') {
        const note = document.createElement('p'); note.style.cssText = 'margin:0;color:#8b90b2;font-size:12.5px';
        note.textContent = `Binabago mo ang outfit na "${cur().name}". Para sa ibang outfit, pumunta sa Wardrobe.`; body.appendChild(note);
        field('Pang-itaas', GO('top'), SO('top'), OPT.top);
        field('Kulay ng pang-itaas', GO('topColor'), SO('topColor'), OPT.cloth, true);
        field('Pang-ibaba', GO('bottom'), SO('bottom'), OPT.bottom);
        field('Kulay ng pang-ibaba', GO('bottomColor'), SO('bottomColor'), OPT.cloth, true);
        field('Sapatos', GO('shoes'), SO('shoes'), OPT.shoes);
        field('Kulay ng sapatos', GO('shoesColor'), SO('shoesColor'), OPT.cloth, true);
        field('Necktie', GO('tie'), SO('tie'), OPT.tie);
        field('Kulay ng necktie', GO('tieColor'), SO('tieColor'), OPT.cloth, true);
      } else if (tab === 'extras') {
        field('Salamin', G('glasses'), S('glasses'), OPT.glasses);
        field('Hikaw', G('earrings'), S('earrings'), OPT.earrings);
        field('Headset', G('headset'), S('headset'), [true, false]);
      } else {
        const grid = document.createElement('div'); grid.className = 'wd-outfits';
        cfg.outfits.forEach((of, i) => {
          const card = document.createElement('div'); card.className = 'wd-of' + (i === cfg.current ? ' on' : '');
          const pc = document.createElement('canvas'); card.appendChild(pc);
          portrait(pc, Object.assign({}, cfg, { current: i }), 72, 92);
          const inp = document.createElement('input'); inp.value = of.name; inp.maxLength = 24; inp.setAttribute('aria-label', 'Pangalan ng outfit');
          inp.oninput = () => { of.name = inp.value || `Outfit ${i + 1}`; }; card.appendChild(inp);
          const r = document.createElement('div'); r.className = 'row2';
          const wear = document.createElement('button'); wear.type = 'button'; wear.textContent = i === cfg.current ? 'Suot' : 'Isuot';
          wear.onclick = () => { cfg.current = i; renderTab(); };
          const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'I-edit';
          edit.onclick = () => { cfg.current = i; tab = 'clothes'; renderTab(); };
          r.append(wear, edit);
          if (cfg.outfits.length > 1) {
            const del = document.createElement('button'); del.type = 'button'; del.textContent = '✕'; del.setAttribute('aria-label', 'Burahin ang outfit');
            del.onclick = () => { cfg.outfits.splice(i, 1); cfg.current = Math.min(cfg.current, cfg.outfits.length - 1); renderTab(); };
            r.append(del);
          }
          card.appendChild(r); grid.appendChild(card);
        });
        if (cfg.outfits.length < 8) {
          const add = document.createElement('button'); add.type = 'button'; add.className = 'wd-add'; add.textContent = '+ Bagong outfit';
          add.onclick = () => { const copy = JSON.parse(JSON.stringify(cur())); copy.name = `Outfit ${cfg.outfits.length + 1}`; cfg.outfits.push(copy); cfg.current = cfg.outfits.length - 1; tab = 'clothes'; renderTab(); };
          grid.appendChild(add);
        }
        body.appendChild(grid);
      }
    }
    back.querySelectorAll('.wd-tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderTab(); });
    const close = () => { closed = true; cancelAnimationFrame(anim); back.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    back.querySelector('.cancel').onclick = close;
    back.querySelector('.save').onclick = async () => {
      const btn = back.querySelector('.save'); btn.disabled = true; msg.textContent = 'Sine-save…';
      try { await onSave(cfg); close(); } catch (e) { msg.textContent = 'Hindi na-save: ' + (e && e.message || 'error'); btn.disabled = false; }
    };
    const tick = ms => { if (closed) return; portrait(cv, cfg, 220, 280, ms / 1000); back.querySelector('.wd-prev small').textContent = 'Suot: ' + cur().name; anim = requestAnimationFrame(tick); };
    renderTab(); anim = requestAnimationFrame(tick);
    back.querySelector('.wd-tabs button').focus();
  }

  window.OfficeAvatar = { OPT, LABEL, defaults, sanitize, draw, portrait, openEditor, outfit };
})();
