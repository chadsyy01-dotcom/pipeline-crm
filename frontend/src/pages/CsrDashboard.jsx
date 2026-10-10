import { useCallback, useRef, useState } from 'react';

// CSR Dashboard shell (updated 2026-10-10).
// Lahat ng page (Dashboard, Tickets, Customers, …) ay plain .html sa public/
// na binubuksan sa loob ng iframe na ito. Dati laging /csr-dashboard.html ang
// src, kaya pag-refresh ay bumabalik sa Dashboard. Ngayon, isinusulat sa URL
// hash ng main page kung anong page ang bukas (hal. /#/tickets.html), at
// iyon ang binubuksan ulit pagka-refresh.

const DEFAULT_PAGE = '/csr-dashboard.html';

// Tumatanggap lang ng sariling .html page (may optional na ?query), para
// hindi magamit ang hash para magbukas ng ibang site sa loob ng iframe.
const SAFE_PAGE = /^\/[A-Za-z0-9_\-/]+\.html(\?[^#]*)?$/;

function pageFromHash() {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return DEFAULT_PAGE;
  let page;
  try {
    page = decodeURIComponent(raw);
  } catch {
    return DEFAULT_PAGE;
  }
  if (!page.startsWith('/')) page = '/' + page;
  if (page.startsWith('//') || page.includes('..') || !SAFE_PAGE.test(page)) return DEFAULT_PAGE;
  return page;
}

export default function CsrDashboard() {
  // Binabasa lang isang beses sa unang load — pagkatapos noon, ang iframe na
  // mismo ang naglilipat ng page sa pamamagitan ng sarili nitong links.
  const [initialSrc] = useState(pageFromHash);
  const frameRef = useRef(null);

  const handleLoad = useCallback(() => {
    let loc, title;
    try {
      // Parehong domain ang iframe kaya nababasa natin ang location nito.
      loc = frameRef.current.contentWindow.location;
      title = frameRef.current.contentDocument?.title;
    } catch {
      return; // ibang domain (hal. login redirect sa ibang host) — huwag galawin
    }
    const page = loc.pathname + loc.search;
    if (!SAFE_PAGE.test(page)) return;

    // replaceState (hindi pushState): ang iframe na ang gumagawa ng history
    // entry sa bawat lipat, kaya gumagana na ang Back/Forward nang walang
    // dobleng entry.
    const newHash = '#' + page;
    if (window.location.hash !== newHash) {
      window.history.replaceState(window.history.state, '', newHash);
    }
    if (title) document.title = title;
  }, []);

  return (
    <iframe
      ref={frameRef}
      src={initialSrc}
      onLoad={handleLoad}
      title="CSR Dashboard"
      style={{
        width: '100%',
        height: '100vh',
        border: 'none',
        display: 'block',
      }}
    />
  );
}
