// ---- notif-sound.js — SHARED CSR notification engine (2026-09-23) ----
//
// Layunin: tumunog ang new-ticket at pending-ticket alerts KAHIT HINDI
// tickets.html ang bukas na page (Dashboard, Customers, KYC, Reports...).
//
// PAG-INSTALL sa isang page (bago ang </head> o kasunod ng ibang scripts):
//   <script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
//   <script src="ticket-data.js?v=8"></script>
//   <script src="notif-sound.js?v=1"></script>
// (Kung nasa page na ang unang dalawa — gaya ng customers.html at
// csr-dashboard.html — ang notif-sound.js line na lang ang idadagdag.)
//
// HUWAG isama sa tickets.html — may sarili itong inline engine na
// naka-integrate sa 10s refresh nito; dodoblehin lang ng file na ito ang
// tunog doon.
//
// CROSS-TAB LEADER ELECTION: kapag maraming bukas na tabs/pages ng
// dashboard, IISA lang ang tutunog (localStorage heartbeat; ang tickets.html
// ay kasali sa parehong eleksyon). Kapag isinara ang leader tab, ibang tab
// ang aako sa loob ng ~12 segundo.
//
// KEEP IN SYNC sa inline engine ng tickets.html: parehong constants,
// parehong tunog, parehong speech texts, parehong localStorage keys.

(function () {
  'use strict';

  // ---- Config (pareho ng tickets.html) ----
  var POLL_MS = 20000;                       // gaano kadalas kumuha ng sariwang tickets
  var NOTIF_SPEECH_TEXT = 'New ticket received!';
  var PENDING_ALERT_MINUTES = 10;
  var PENDING_REALERT_MINUTES = 5;
  var PENDING_SPEECH_TEXT = 'Alert! Pending tickets!';
  var INPROG_ALERT_MINUTES = 10;   // In Progress 10+ mins → "Ticket pending! <agent>" 3x
  var INPROG_REALERT_MINUTES = 5;
  // SPECIAL RULE: aliases sa binabanggit na pangalan (lowercase keys).
  // KEEP IN SYNC sa SPOKEN_NAME_ALIASES ng tickets.html.
  var SPOKEN_NAME_ALIASES = { 'sapphire': 'Johnlloyd' };
  function spokenName(n) {
    var key = String(n || '').trim().toLowerCase();
    return SPOKEN_NAME_ALIASES[key] || n;
  }

  if (typeof window.TicketData === 'undefined' || typeof window.Papa === 'undefined') {
    console.warn('[notif-sound] TicketData/PapaParse wala sa page na ito — isama muna ang papaparse + ticket-data.js bago ang notif-sound.js.');
    return;
  }
  if (window.__CSR_NOTIF_INLINE__) {
    // tickets.html (o ibang page na may sariling engine) — huwag doblehin.
    return;
  }

  // ---- Cross-tab leader election ----
  var LEADER_KEY = 'csr_notif_leader';
  var TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
  function heartbeat() {
    var cur = null;
    try { cur = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null'); } catch (e) {}
    var now = Date.now();
    if (!cur || now - cur.t > 12000 || cur.id === TAB_ID) {
      try { localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, t: now })); } catch (e) {}
    }
  }
  heartbeat();
  setInterval(heartbeat, 5000);
  function isLeader() {
    try {
      var cur = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null');
      return !cur || cur.id === TAB_ID || Date.now() - cur.t > 12000;
    } catch (e) { return true; }
  }

  // ---- Sound engine (kapareho ng tickets.html) ----
  var audioCtx = null;
  // LAGING ON (desisyon 2026-09-23): walang in-app off switch — browser
  // tab mute o system volume ang paraan kung gustong patahimikin.
  function soundEnabled() { return true; }
  function ensureAudioCtx() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
  }
  document.addEventListener('click', ensureAudioCtx, { once: true });

  function speak(text, delayMs) {
    if (!('speechSynthesis' in window)) return;
    setTimeout(function () {
      try {
        speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        var voices = speechSynthesis.getVoices();
        for (var i = 0; i < voices.length; i++) {
          if (/^en/i.test(voices[i].lang)) { u.voice = voices[i]; break; }
        }
        u.volume = 1;
        u.rate = 1;
        speechSynthesis.speak(u);
      } catch (e) { console.warn('[notif-sound] speech failed:', e); }
    }, delayMs);
  }

  function playNewTicketSound() {
    if (!soundEnabled() || !isLeader()) return;
    try {
      ensureAudioCtx();
      if (audioCtx) {
        var now = audioCtx.currentTime;
        var comp = audioCtx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-12, now);
        comp.ratio.setValueAtTime(12, now);
        comp.connect(audioCtx.destination);
        [[1318.5, 0, 0.26], [1318.5, 0.24, 0.26], [1567.98, 0.48, 0.45]].forEach(function (trip) {
          [[trip[0], 'triangle', 0.95], [trip[0] / 2, 'square', 0.35]].forEach(function (layer) {
            var osc = audioCtx.createOscillator();
            var gain = audioCtx.createGain();
            osc.type = layer[1];
            osc.frequency.value = layer[0];
            gain.gain.setValueAtTime(0.0001, now + trip[1]);
            gain.gain.exponentialRampToValueAtTime(layer[2], now + trip[1] + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + trip[1] + trip[2]);
            osc.connect(gain).connect(comp);
            osc.start(now + trip[1]);
            osc.stop(now + trip[1] + trip[2] + 0.05);
          });
        });
      }
      speak(NOTIF_SPEECH_TEXT, 800);
    } catch (e) { console.warn('[notif-sound] new-ticket sound failed:', e); }
  }

  function playPendingAlertSound() {
    if (!soundEnabled() || !isLeader()) return;
    try {
      ensureAudioCtx();
      if (audioCtx) {
        var now = audioCtx.currentTime;
        var comp = audioCtx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-12, now);
        comp.ratio.setValueAtTime(12, now);
        comp.connect(audioCtx.destination);
        [0, 0.4, 0.8].forEach(function (delay) {
          var osc = audioCtx.createOscillator();
          var gain = audioCtx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(500, now + delay);
          osc.frequency.exponentialRampToValueAtTime(1600, now + delay + 0.3);
          gain.gain.setValueAtTime(0.0001, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.9, now + delay + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.32);
          osc.connect(gain).connect(comp);
          osc.start(now + delay);
          osc.stop(now + delay + 0.36);
        });
      }
      speak(PENDING_SPEECH_TEXT, 1250);
    } catch (e) { console.warn('[notif-sound] pending alert failed:', e); }
  }

  function playInProgressAlertSound(names) {
    if (!soundEnabled() || !isLeader()) return;
    try {
      ensureAudioCtx();
      if (audioCtx) {
        var now = audioCtx.currentTime;
        var comp = audioCtx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-12, now);
        comp.ratio.setValueAtTime(12, now);
        comp.connect(audioCtx.destination);
        [0, 0.4, 0.8].forEach(function (delay) {
          var osc = audioCtx.createOscillator();
          var gain = audioCtx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(1600, now + delay);
          osc.frequency.exponentialRampToValueAtTime(500, now + delay + 0.3); // pababang sweep
          gain.gain.setValueAtTime(0.0001, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.9, now + delay + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.32);
          osc.connect(gain).connect(comp);
          osc.start(now + delay);
          osc.stop(now + delay + 0.36);
        });
      }
      if ('speechSynthesis' in window) {
        var phrase = 'Ticket pending! ' + (names && names.length ? names.join(', ') : '');
        setTimeout(function () {
          try {
            speechSynthesis.cancel();
            for (var i = 0; i < 3; i++) { // 3 beses sunod-sunod
              var u = new SpeechSynthesisUtterance(phrase);
              var voices = speechSynthesis.getVoices();
              for (var j = 0; j < voices.length; j++) {
                if (/^en/i.test(voices[j].lang)) { u.voice = voices[j]; break; }
              }
              u.volume = 1;
              u.rate = 1;
              speechSynthesis.speak(u);
            }
          } catch (e) { console.warn('[notif-sound] inprog speech failed:', e); }
        }, 1250);
      }
    } catch (e) { console.warn('[notif-sound] inprog alert failed:', e); }
  }

  // ---- Ticket watching ----
  var seeded = false;
  var notifiedIds = new Set();
  var pendingAlertedIds = new Set();
  var lastPendingReminderAt = 0;
  var inprogAlertedIds = new Set();
  var lastInprogReminderAt = 0;

  function checkTickets(tickets) {
    var pending = tickets.filter(function (t) { return t.statusCls === 'pending'; });

    // Unang matagumpay na load: i-seed nang tahimik ang existing backlog.
    if (!seeded) {
      pending.forEach(function (t) { notifiedIds.add(t.id); });
      seeded = true;
      return;
    }

    // Bagong tickets
    var fresh = pending.filter(function (t) { return !notifiedIds.has(t.id); });
    if (fresh.length) {
      fresh.forEach(function (t) { notifiedIds.add(t.id); });
      playNewTicketSound();
      if (localStorage.getItem('csr_desktop_notif') === 'true' &&
          typeof Notification !== 'undefined' && Notification.permission === 'granted' && isLeader()) {
        fresh.forEach(function (t) {
          new Notification('New ticket', { body: t.id + ' — ' + t.name + ': ' + t.issue });
        });
      }
    }

    // Overdue pending (10+ mins na New)
    var cutoff = Date.now() - PENDING_ALERT_MINUTES * 60000;
    var overdue = pending.filter(function (t) { return t.submitted && t.submitted.getTime() <= cutoff; });
    if (overdue.length) {
      var freshOverdue = overdue.filter(function (t) { return !pendingAlertedIds.has(t.id); });
      var remindDue = Date.now() - lastPendingReminderAt >= PENDING_REALERT_MINUTES * 60000;
      if (freshOverdue.length || remindDue) {
        freshOverdue.forEach(function (t) { pendingAlertedIds.add(t.id); });
        lastPendingReminderAt = Date.now();
        playPendingAlertSound();
        if (localStorage.getItem('csr_desktop_notif') === 'true' &&
            typeof Notification !== 'undefined' && Notification.permission === 'granted' && isLeader()) {
          new Notification('ALERT: Pending tickets!', { body: overdue.length + ' ticket' + (overdue.length === 1 ? '' : 's') + ' ' + PENDING_ALERT_MINUTES + '+ mins na walang umaako' });
        }
      }
    }
  }

  function checkInProgress(tickets) {
    var cutoff = Date.now() - INPROG_ALERT_MINUTES * 60000;
    var overdue = tickets.filter(function (t) {
      if (t.statusCls !== 'checking') return false;
      var basis = t.acknowledgedAt || t.submitted;
      return basis && basis.getTime() <= cutoff;
    });
    if (!overdue.length) return;
    var fresh = overdue.filter(function (t) { return !inprogAlertedIds.has(t.id); });
    var remindDue = Date.now() - lastInprogReminderAt >= INPROG_REALERT_MINUTES * 60000;
    if (fresh.length || remindDue) {
      fresh.forEach(function (t) { inprogAlertedIds.add(t.id); });
      lastInprogReminderAt = Date.now();
      var names = [];
      overdue.forEach(function (t) { var n = spokenName(t.acknowledgedBy); if (n && names.indexOf(n) === -1) names.push(n); });
      playInProgressAlertSound(names);
      if (localStorage.getItem('csr_desktop_notif') === 'true' &&
          typeof Notification !== 'undefined' && Notification.permission === 'granted' && isLeader()) {
        new Notification('TICKET PENDING!', { body: overdue.length + ' In Progress ' + INPROG_ALERT_MINUTES + '+ mins \u2014 ' + (names.join(', ') || 'walang pangalan') });
      }
    }
  }

  function poll() {
    TicketData.fetchTickets(true)
      .then(function (tickets) { checkTickets(tickets); checkInProgress(tickets); })
      .catch(function (err) { console.warn('[notif-sound] poll failed:', err && err.message); });
  }
  // Unang load: gamitin ang cache kung meron (mabilis), tapos regular poll.
  TicketData.fetchTickets(false).then(function (tickets) { checkTickets(tickets); checkInProgress(tickets); }).catch(function () {});
  setInterval(poll, POLL_MS);
})();
