import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api/client';

// Login page — redesigned 2026-09-21 to the approved mockup (dark-to-light
// blue sweep, hero on the left, 3D console with floating brand tiles in the
// middle, sign-in card on the right), keeping the NEUMORPHIC finish of the
// previous login: the card is a flat #e6e9ef surface, fields are pressed in,
// the button is raised and fills blue on hover, and the icons and tiles on
// the blue side use the same technique in dark blue.
//
// The sign-in logic is the same as before: api.login({ email, password }) →
// setToken(token) → navigate('/'). Only two things were added around it:
//   - a show/hide toggle on the password field (it's in the design);
//   - the button is disabled while the request is in flight, so a double
//     click can't send two logins.
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await api.login({ email, password });
      setToken(token);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="csrLogin-screen">
      <style>{`
        .csrLogin-screen, .csrLogin-screen *, .csrLogin-screen *::before, .csrLogin-screen *::after{box-sizing:border-box;}
        .csrLogin-screen{
          --ink:#0B1B4D; --ink-soft:#475569; --ink-faint:#8A97AE;
          --cyan:#22D3EE; --blue:#1D6FF2; --blue-deep:#0B4BD6;
          /* Neumorphism, carried over from the previous login page: one flat
             surface colour, a dark and a light shadow cast from it. */
          --nm-bg:#e6e9ef; --nm-shadow-dark:#b8bfcc; --nm-shadow-light:#ffffff;
          --nm-accent:#2563EB;
          /* The same idea on the blue side of the page. */
          --nm-dark-bg:#10245f; --nm-dark-shadow-dark:#06112f; --nm-dark-shadow-light:#1c3a8c;
          position:relative;min-height:100vh;overflow:hidden;
          font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#fff;
          background:linear-gradient(112deg,#050E2B 0%,#08205F 30%,#1446B8 52%,#4F8BF0 70%,#B9D2F8 86%,#E8F1FE 100%);
        }
        /* The two sweeping curves from the mockup: a deep navy arc across the
           bottom-left and a pale glow behind the card. */
        .csrLogin-screen::before{
          content:"";position:absolute;left:-32%;bottom:-78%;width:100%;height:120%;
          border-radius:50%;
          background:radial-gradient(ellipse at 50% 0%,rgba(40,90,230,.55),rgba(6,16,52,.0) 60%),
                     linear-gradient(180deg,#0A1E63 0%,#06123A 70%);
          box-shadow:0 -2px 0 rgba(120,170,255,.35), 0 -30px 80px rgba(40,110,255,.25);
          transform:rotate(-8deg);
        }
        .csrLogin-screen::after{
          content:"";position:absolute;right:-20%;top:-30%;width:70%;height:120%;
          border-radius:50%;
          background:radial-gradient(circle,rgba(255,255,255,.55),rgba(255,255,255,0) 62%);
          pointer-events:none;
        }

        /* ---------- header ---------- */
        .csrLogin-header{
          position:relative;z-index:3;display:flex;align-items:center;justify-content:space-between;
          padding:40px 7vw 0;gap:20px;
        }
        .csrLogin-brand{display:flex;align-items:center;gap:22px;}
        .csrLogin-brand img{width:72px;height:72px;object-fit:contain;filter:drop-shadow(0 6px 18px rgba(34,130,255,.45));}
        .csrLogin-brand span{font-size:29px;font-weight:500;letter-spacing:-.01em;}
        .csrLogin-brand b{font-weight:800;}
        .csrLogin-values{display:flex;align-items:center;gap:18px;font-size:14px;font-weight:500;color:rgba(255,255,255,.92);}
        .csrLogin-values i{width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.7;}

        /* ---------- body grid ---------- */
        .csrLogin-body{
          position:relative;z-index:2;display:grid;
          grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr) clamp(420px,32vw,580px);
          align-items:center;gap:0;padding:40px 7vw 60px;min-height:calc(100vh - 112px);
        }

        /* ---------- hero ---------- */
        .csrLogin-hero{max-width:600px;}
        .csrLogin-hero h1{margin:0 0 26px;font-size:clamp(34px,3.2vw,52px);line-height:1.08;font-weight:800;letter-spacing:-.025em;}
        /* Two lines, as in the design: the first never breaks on a desktop
           screen, and may run into the (decorative) illustration beside it. */
        .csrLogin-hero h1 .l1, .csrLogin-hero h1 .l2{white-space:nowrap;}
        .csrLogin-hero h1 .l1{display:block;}
        /* inline-block, not block: the gradient is painted on the element's
           own box, so the box must be exactly as wide as the text or the part
           that overflows (the full stop) comes out transparent. */
        .csrLogin-hero h1 .l2{
          display:inline-block;
          background:linear-gradient(90deg,#22D3EE,#38BDF8 60%,#60A5FA);
          -webkit-background-clip:text;background-clip:text;color:transparent;
        }
        .csrLogin-hero p{margin:0 0 44px;font-size:clamp(15px,1.15vw,19px);line-height:1.62;color:rgba(255,255,255,.92);max-width:470px;}

        .csrLogin-stats{display:flex;align-items:stretch;}
        .csrLogin-stat{padding-right:34px;margin-right:34px;border-right:1px solid rgba(120,160,255,.25);}
        .csrLogin-stat:last-child{border-right:none;margin-right:0;padding-right:0;}
        .csrLogin-stat .ic{
          width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;
          margin-bottom:22px;background:var(--nm-dark-bg);
          box-shadow:6px 6px 14px var(--nm-dark-shadow-dark), -5px -5px 12px var(--nm-dark-shadow-light);
        }
        .csrLogin-stat .ic svg{width:24px;height:24px;}
        .csrLogin-stat .num{font-size:26px;font-weight:800;letter-spacing:-.01em;}
        .csrLogin-stat .lab{font-size:14px;color:rgba(200,215,245,.85);margin-top:8px;}

        .csrLogin-rule{height:1px;width:260px;margin:44px 0 26px;background:linear-gradient(90deg,rgba(80,150,255,.6),rgba(80,150,255,0));}
        .csrLogin-motto{font-size:14px;letter-spacing:.22em;color:#5AA2FF;font-weight:500;}

        /* ---------- console illustration ---------- */
        .csrLogin-stage{position:relative;height:520px;}
        .csrLogin-device{
          position:absolute;left:0;top:26%;width:74%;
          transform:perspective(1300px) rotateY(-24deg) rotateX(14deg) rotateZ(-9deg);
          transform-style:preserve-3d;
        }
        .csrLogin-screenPanel{
          position:relative;border-radius:22px;padding:18px;
          background:linear-gradient(160deg,rgba(24,44,112,.95),rgba(9,20,62,.97));
          box-shadow:0 0 0 2px rgba(80,150,255,.55), 0 0 40px rgba(40,120,255,.55), inset 0 0 30px rgba(30,90,220,.35);
          display:grid;grid-template-columns:36% 1fr;gap:14px;
        }
        .csrLogin-menu{background:rgba(20,40,110,.7);border-radius:14px;padding:14px 12px;display:flex;flex-direction:column;gap:12px;}
        .csrLogin-menu .bar{height:9px;width:70%;border-radius:6px;background:rgba(120,160,255,.35);margin-bottom:6px;}
        .csrLogin-menu div.item{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#E3ECFF;}
        .csrLogin-menu div.item svg{width:13px;height:13px;flex-shrink:0;}
        .csrLogin-panelR{display:flex;flex-direction:column;gap:12px;}
        .csrLogin-panelR .top{height:42px;border-radius:12px;background:rgba(40,70,160,.55);display:flex;flex-direction:column;justify-content:center;gap:6px;padding:0 12px;}
        .csrLogin-panelR .top i{display:block;height:6px;border-radius:4px;background:rgba(140,175,255,.4);}
        .csrLogin-chart{border-radius:12px;background:rgba(18,36,100,.8);padding:10px;}
        .csrLogin-chart svg{display:block;width:100%;height:auto;}
        .csrLogin-base{
          position:absolute;left:-6%;right:-6%;bottom:-34px;height:46px;border-radius:18px;
          background:linear-gradient(180deg,#1D4FD8,#0C2A8A);
          box-shadow:0 0 0 2px rgba(90,170,255,.8), 0 0 50px rgba(40,140,255,.8);
          transform:translateZ(-40px);
        }

        .csrLogin-tile{
          position:absolute;width:62px;height:62px;border-radius:16px;display:flex;align-items:center;justify-content:center;
          background:var(--nm-dark-bg);
          box-shadow:8px 8px 18px var(--nm-dark-shadow-dark), -6px -6px 14px var(--nm-dark-shadow-light), 0 0 18px rgba(40,120,255,.25);
          font-weight:800;font-size:30px;
          animation:csrLoginFloat 6s ease-in-out infinite;
        }
        .csrLogin-tile svg{width:30px;height:30px;}
        .csrLogin-tile.sm{width:50px;height:50px;border-radius:14px;}
        .csrLogin-tile.sm svg{width:22px;height:22px;}
        @keyframes csrLoginFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}

        /* ---------- sign-in card ---------- */
        .csrLogin-card{
          justify-self:end;width:100%;
          background:var(--nm-bg);border-radius:32px;padding:46px 58px 48px;color:var(--ink);
          box-shadow:
            22px 22px 50px rgba(6,20,64,.38),
            -14px -14px 38px rgba(255,255,255,.28),
            inset 2px 2px 0 rgba(255,255,255,.75),
            inset -2px -2px 0 rgba(184,191,204,.45);
        }
        .csrLogin-card .logoDisc{
          width:84px;height:84px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:18px;
          background:var(--nm-bg);
          box-shadow:8px 8px 16px var(--nm-shadow-dark), -8px -8px 16px var(--nm-shadow-light);
        }
        .csrLogin-card .logo{width:60px;height:60px;object-fit:contain;}
        .csrLogin-card h2{margin:0 0 8px;font-size:34px;font-weight:800;letter-spacing:-.02em;color:var(--ink);}
        .csrLogin-card .sub{margin:0 0 36px;font-size:16px;color:var(--ink-soft);}

        .csrLogin-field{margin-bottom:26px;}
        .csrLogin-field label{display:block;font-size:16px;font-weight:700;color:#1E2A44;margin-bottom:10px;}
        .csrLogin-inputWrap{position:relative;}
        .csrLogin-inputWrap .lead{position:absolute;left:18px;top:50%;transform:translateY(-50%);width:20px;height:20px;color:#5B6B87;pointer-events:none;}
        .csrLogin-inputWrap input{
          width:100%;height:54px;padding:0 54px 0 52px;border-radius:999px;
          border:none;background:var(--nm-bg);
          font:inherit;font-size:15px;color:var(--ink);outline:none;
          box-shadow:inset 6px 6px 12px var(--nm-shadow-dark), inset -6px -6px 12px var(--nm-shadow-light);
          transition:box-shadow .15s ease;
        }
        .csrLogin-inputWrap input:focus{
          box-shadow:inset 4px 4px 8px var(--nm-shadow-dark), inset -4px -4px 8px var(--nm-shadow-light), 0 0 0 2px rgba(37,99,235,.28);
        }
        .csrLogin-eye{
          position:absolute;right:14px;top:50%;transform:translateY(-50%);
          width:34px;height:34px;border:none;background:var(--nm-bg);border-radius:50%;cursor:pointer;
          display:flex;align-items:center;justify-content:center;color:#5B6B87;
          box-shadow:3px 3px 6px var(--nm-shadow-dark), -3px -3px 6px var(--nm-shadow-light);
          transition:box-shadow .15s ease, color .15s ease;
        }
        .csrLogin-eye:hover{color:var(--nm-accent);}
        .csrLogin-eye[aria-pressed="true"]{color:var(--nm-accent);box-shadow:inset 2px 2px 5px var(--nm-shadow-dark), inset -2px -2px 5px var(--nm-shadow-light);}
        .csrLogin-eye svg{width:21px;height:21px;}

        .csrLogin-error{color:#DC2626;font-size:13.5px;font-weight:600;margin:-12px 0 16px;}

        .csrLogin-submit{
          position:relative;width:100%;height:54px;margin-top:10px;border:none;border-radius:999px;cursor:pointer;
          background:var(--nm-bg);color:var(--nm-accent);
          font:inherit;font-size:17px;font-weight:700;
          box-shadow:6px 6px 14px var(--nm-shadow-dark), -6px -6px 14px var(--nm-shadow-light);
          transition:all .15s ease;
        }
        .csrLogin-submit:hover{
          color:#fff;background:var(--nm-accent);
          box-shadow:4px 4px 10px var(--nm-shadow-dark), -4px -4px 10px var(--nm-shadow-light);
        }
        .csrLogin-submit:active{
          box-shadow:inset 4px 4px 8px rgba(0,0,0,.25), inset -4px -4px 8px rgba(255,255,255,.15);
        }
        .csrLogin-submit:disabled{cursor:wait;color:#fff;background:var(--nm-accent);opacity:.8;
          box-shadow:inset 4px 4px 8px rgba(0,0,0,.2), inset -4px -4px 8px rgba(255,255,255,.12);}
        .csrLogin-submit svg{position:absolute;right:22px;top:50%;transform:translateY(-50%);width:22px;height:22px;}

        .csrLogin-or{display:flex;align-items:center;gap:18px;margin:32px 0 22px;font-size:13px;color:var(--ink-faint);}
        .csrLogin-or::before,.csrLogin-or::after{content:"";flex:1;height:3px;border-radius:3px;background:var(--nm-bg);
          box-shadow:inset 1px 1px 2px var(--nm-shadow-dark), inset -1px -1px 2px var(--nm-shadow-light);}
        .csrLogin-foot{text-align:center;font-size:15px;color:#334155;}
        .csrLogin-foot a{color:var(--blue);font-weight:700;text-decoration:none;}
        .csrLogin-foot a:hover{text-decoration:underline;}

        .csrLogin-screen :focus-visible{outline:3px solid #60A5FA;outline-offset:2px;}

        /* ---------- responsive ---------- */
        @media (max-width:1320px){
          .csrLogin-body{grid-template-columns:minmax(0,1fr) clamp(400px,42vw,540px);}
          .csrLogin-stage{display:none;}
          .csrLogin-hero h1 .l1, .csrLogin-hero h1 .l2{white-space:normal;}
          .csrLogin-card{padding:44px 48px;}
        }
        @media (max-width:900px){
          .csrLogin-header{padding:26px 22px 0;}
          .csrLogin-values{display:none;}
          .csrLogin-brand img{width:52px;height:52px;}
          .csrLogin-brand span{font-size:22px;}
          .csrLogin-body{grid-template-columns:1fr;padding:28px 22px 40px;min-height:0;}
          .csrLogin-hero{display:none;}
          .csrLogin-card{justify-self:center;padding:34px 26px;border-radius:24px;}
          .csrLogin-card h2{font-size:28px;}
        }
        @media (prefers-reduced-motion:reduce){
          .csrLogin-tile{animation:none;}
        }
      `}</style>

      <header className="csrLogin-header">
        <div className="csrLogin-brand">
          <img src="/logo.png" alt="" />
          <span><b>CSR</b> Dashboard</span>
        </div>
        <div className="csrLogin-values" aria-hidden="true">
          <span>Better Support</span><i /><span>Happier Players</span><i /><span>Stronger Brands</span>
        </div>
      </header>

      <div className="csrLogin-body">
        {/* ---- hero ---- */}
        <section className="csrLogin-hero">
          <h1><span className="l1">One console for every</span> <span className="l2">brand you support.</span></h1>
          <p>Tickets, KYC, reports, and billing across all your brands — live, in one place.</p>

          <div className="csrLogin-stats">
            <div className="csrLogin-stat">
              <div className="ic" style={{ color: '#7DD3FC' }}>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 012 2v10a2 2 0 01-2 2H9l-5 4v-4a2 2 0 01-2-2V6a2 2 0 012-2z"/><circle cx="8" cy="11" r="1.3" fill="#0B2A7A"/><circle cx="12" cy="11" r="1.3" fill="#0B2A7A"/><circle cx="16" cy="11" r="1.3" fill="#0B2A7A"/></svg>
              </div>
              <div className="num">11,106</div>
              <div className="lab">Tickets tracked</div>
            </div>
            <div className="csrLogin-stat">
              <div className="ic" style={{ color: '#A5B4FC' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5"/></svg>
              </div>
              <div className="num">8</div>
              <div className="lab">Brands connected</div>
            </div>
            <div className="csrLogin-stat">
              <div className="ic" style={{ color: '#5EEAD4', background: 'rgba(15,110,120,.45)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
              </div>
              <div className="num">20s</div>
              <div className="lab">Refresh rate</div>
            </div>
          </div>

          <div className="csrLogin-rule" />
          <div className="csrLogin-motto">CENTRALIZED &nbsp;/&nbsp; EFFICIENT &nbsp;/&nbsp; ALWAYS ON</div>
        </section>

        {/* ---- console illustration (decorative) ---- */}
        <div className="csrLogin-stage" aria-hidden="true">
          <div className="csrLogin-device">
            <div className="csrLogin-screenPanel">
              <div className="csrLogin-menu">
                <div className="bar" />
                <div className="item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 10h8"/></svg>Tickets</div>
                <div className="item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>KYC</div>
                <div className="item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>Reports</div>
                <div className="item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8"/></svg>Billing</div>
              </div>
              <div className="csrLogin-panelR">
                <div className="top"><i style={{ width: '55%' }} /><i style={{ width: '35%' }} /></div>
                <div className="csrLogin-chart">
                  <svg viewBox="0 0 200 110">
                    <defs>
                      <linearGradient id="csrLoginArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#38BDF8" stopOpacity=".55" />
                        <stop offset="1" stopColor="#38BDF8" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d="M0 92 C20 80 30 88 46 70 S72 74 86 56 S112 66 126 44 S154 50 168 26 S188 20 200 8 L200 110 L0 110 Z" fill="url(#csrLoginArea)" />
                    <path d="M0 92 C20 80 30 88 46 70 S72 74 86 56 S112 66 126 44 S154 50 168 26 S188 20 200 8" fill="none" stroke="#5EC8FF" strokeWidth="3" />
                    <path d="M40 100 H190" stroke="#7C5CFF" strokeWidth="5" strokeLinecap="round" strokeDasharray="30 8" opacity=".85" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="csrLogin-base" />
          </div>

          <div className="csrLogin-tile" style={{ left: '52%', top: '4%', color: '#FACC15', animationDelay: '0s' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/></svg>
          </div>
          <div className="csrLogin-tile" style={{ left: '74%', top: '13%', color: '#22D3EE', animationDelay: '-1.2s' }}>G</div>
          <div className="csrLogin-tile" style={{ left: '63%', top: '25%', color: '#2DD4BF', animationDelay: '-2.4s' }}>M</div>
          <div className="csrLogin-tile" style={{ left: '82%', top: '34%', color: '#E879F9', animationDelay: '-3.1s' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round"><path d="M5 20L10 5l2 5 2-5 5 15"/><path d="M8.5 14h7"/></svg>
          </div>
          <div className="csrLogin-tile" style={{ left: '68%', top: '46%', color: '#34D399', animationDelay: '-1.8s' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3z"/></svg>
          </div>
          <div className="csrLogin-tile sm" style={{ left: '84%', top: '51%', color: '#60A5FA', opacity: 0.8, animationDelay: '-4s' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3z"/></svg>
          </div>
          <div className="csrLogin-tile sm" style={{ left: '70%', top: '63%', color: '#93C5FD', animationDelay: '-2.8s' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>
          </div>
        </div>

        {/* ---- sign-in card ---- */}
        <main className="csrLogin-card">
          <div className="logoDisc"><img className="logo" src="/logo.png" alt="CSR Dashboard" /></div>
          <h2>Welcome back</h2>
          <p className="sub">Sign in to your support console.</p>

          <form onSubmit={handleSubmit} noValidate={false}>
            <div className="csrLogin-field">
              <label htmlFor="csrLoginEmail">Email</label>
              <div className="csrLogin-inputWrap">
                <svg className="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 7l8 6 8-6"/></svg>
                <input
                  id="csrLoginEmail"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="csrLogin-field">
              <label htmlFor="csrLoginPassword">Password</label>
              <div className="csrLogin-inputWrap">
                <svg className="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 018 0v3"/><circle cx="12" cy="16" r="1.3" fill="currentColor"/></svg>
                <input
                  id="csrLoginPassword"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="csrLogin-eye"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3l18 18"/><path d="M10.6 5.1A9.9 9.9 0 0112 5c6.5 0 10 7 10 7a17.6 17.6 0 01-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>
                  )}
                </button>
              </div>
            </div>

            {error && <div className="csrLogin-error" role="alert">{error}</div>}

            <button className="csrLogin-submit" type="submit" disabled={loading}>
              {loading ? 'Logging in…' : 'Log in'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          </form>

          <div className="csrLogin-or">OR</div>
          <div className="csrLogin-foot">No account? <Link to="/register">Create one</Link></div>
        </main>
      </div>
    </div>
  );
}
