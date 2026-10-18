// ---------------------------------------------------------------------------
// GEO (2026-10-18) — para sa Concerns Map (frontend/public/concerns-map.html).
//
// POST /api/geo/lookup   { ips: ["111.90.198.194", "2001:fd8:…", …] }
//   → { results: { "<ip>": { city, region, country, countryCode, lat, lon } | null },
//       pending: <ilang IP ang hindi pa nahanap (subukan ulit mamaya)> }
//   IP → lungsod gamit ang ip-api.com batch API (walang API key; 100 IP kada
//   request, max 15 request kada minuto). Lahat ng resulta ay naka-cache sa
//   Postgres table "GeoIpCache" kaya isang beses lang hinahanap ang bawat IP.
//
// GET /api/geo/ph-map
//   → mapa ng mga probinsya ng Pilipinas (Highcharts map collection, TopoJSON
//   o GeoJSON). Kinukuha ng server at naka-cache sa memory, para hindi na
//   umasa ang browser sa CDN/CORS.
// ---------------------------------------------------------------------------
const express = require('express');
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

sequelize.query(`
  CREATE TABLE IF NOT EXISTS "GeoIpCache" (
    "ip" VARCHAR(64) PRIMARY KEY,
    "data" JSONB,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).then(() => console.log('[geo] GeoIpCache table ready'))
  .catch(err => console.error('[geo] could not create GeoIpCache:', err.message));

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;
const isPrivate = ip => /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(ip) || /^(::1$|fc|fd|fe80)/i.test(ip);
const cleanIp = v => {
  const s = String(v || '').trim().replace(/^\[|\]$/g, '').split(/[\s,]+/)[0];
  if (IPV4.test(s)) return s;
  if (s.includes(':') && IPV6.test(s) && s.length <= 45) return s.toLowerCase();
  return null;
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
let batchTimes = [];   // para sa 15 batch/min na limit ng ip-api

async function ipApiBatch(ips) {
  const now = Date.now();
  batchTimes = batchTimes.filter(t => now - t < 60000);
  if (batchTimes.length >= 14) return null;   // sa susunod na lang
  batchTimes.push(now);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch('http://ip-api.com/batch?fields=status,message,country,countryCode,regionName,city,lat,lon,query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ips), signal: ctl.signal,
    });
    if (r.status === 429) { batchTimes = Array(15).fill(now); return null; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

router.post('/lookup', requireAuth, async (req, res) => {
  try {
    const list = Array.isArray(req.body?.ips) ? req.body.ips : [];
    const ips = [...new Set(list.map(cleanIp).filter(ip => ip && !isPrivate(ip)))].slice(0, 5000);
    const results = {};
    if (!ips.length) return res.json({ results, pending: 0 });

    const cached = await sequelize.query(
      `SELECT "ip", "data" FROM "GeoIpCache" WHERE "ip" IN (:ips)`,
      { replacements: { ips }, type: QueryTypes.SELECT });
    cached.forEach(r => { results[r.ip] = r.data; });

    const missing = ips.filter(ip => !(ip in results));
    let pending = 0;
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      let rows = null;
      try { rows = await ipApiBatch(chunk); } catch (e) { console.warn('[geo] ip-api batch failed:', e.message); }
      if (!rows) { pending += missing.length - i; break; }
      const toSave = [];
      rows.forEach((r, k) => {
        const ip = chunk[k];
        const data = r && r.status === 'success'
          ? { city: r.city || null, region: r.regionName || null, country: r.country || null, countryCode: r.countryCode || null, lat: r.lat, lon: r.lon }
          : null;
        results[ip] = data;
        toSave.push({ ip, data });
      });
      if (toSave.length) {
        await sequelize.query(
          `INSERT INTO "GeoIpCache" ("ip", "data", "updatedAt")
           SELECT x.ip, x.data::jsonb, NOW() FROM json_to_recordset(CAST(:rows AS json)) AS x(ip text, data text)
           ON CONFLICT ("ip") DO UPDATE SET "data" = EXCLUDED."data", "updatedAt" = NOW()`,
          { replacements: { rows: JSON.stringify(toSave.map(s => ({ ip: s.ip, data: JSON.stringify(s.data) }))) } });
      }
      if (i + 100 < missing.length) await sleep(250);
    }
    res.json({ results, pending });
  } catch (err) {
    console.error('[geo] lookup error:', err);
    res.status(500).json({ error: 'Hindi mahanap ang lokasyon ng mga IP ngayon.' });
  }
});

// Mapa ng Pilipinas (mga probinsya) — unang source na gumana, naka-cache 24h
const MAP_SOURCES = [
  'https://code.highcharts.com/mapdata/countries/ph/ph-all.topo.json',
  'https://cdn.jsdelivr.net/npm/@highcharts/map-collection@2.3.3/countries/ph/ph-all.topo.json',
  'https://unpkg.com/@highcharts/map-collection@2.3.3/countries/ph/ph-all.topo.json',
  'https://code.highcharts.com/mapdata/countries/ph/ph-all.geo.json',
  'https://cdn.jsdelivr.net/npm/@highcharts/map-collection@2.3.3/countries/ph/ph-all.geo.json',
];
let mapCache = null;   // { at, body }
router.get('/ph-map', requireAuth, async (req, res) => {
  try {
    if (mapCache && Date.now() - mapCache.at < 24 * 3600 * 1000) {
      res.set('Content-Type', 'application/json'); return res.send(mapCache.body);
    }
    for (const url of MAP_SOURCES) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 12000);
        const r = await fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
        if (!r.ok) continue;
        const body = await r.text();
        const j = JSON.parse(body);
        if (!(j.type === 'Topology' || (j.features && j.features.length))) continue;
        mapCache = { at: Date.now(), body };
        res.set('Content-Type', 'application/json');
        return res.send(body);
      } catch (e) { console.warn('[geo] map source failed', url, e.message); }
    }
    res.status(502).json({ error: 'Hindi makuha ang mapa ng Pilipinas.' });
  } catch (err) {
    console.error('[geo] ph-map error:', err);
    res.status(500).json({ error: 'Hindi makuha ang mapa ng Pilipinas.' });
  }
});

module.exports = router;
