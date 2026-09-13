import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api/client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { token } = await api.login({ email, password });
      setToken(token);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="csrLogin-screen">
      <style>{`
        :root{
          --nm-bg: #e6e9ef;
          --nm-shadow-dark: #b8bfcc;
          --nm-shadow-light: #ffffff;
          --nm-dark-bg: #131a29;
          --nm-dark-shadow-dark: #0a0f19;
          --nm-dark-shadow-light: #1c2539;
          --nm-accent: #2563EB;
        }

        .csrLogin-screen{
          display:flex;align-items:center;justify-content:center;min-height:100vh;
          font-family:'Plus Jakarta Sans',system-ui,sans-serif;
          background:var(--nm-bg);padding:40px 24px;
        }

        .csrLogin-shell{
          display:flex;width:100%;max-width:900px;min-height:560px;
          border-radius:32px;overflow:hidden;background:var(--nm-bg);
          box-shadow:
            18px 18px 40px var(--nm-shadow-dark),
            -18px -18px 40px var(--nm-shadow-light);
        }

        .csrLogin-brandPanel{
          flex:1;min-width:0;color:#fff;
          display:flex;flex-direction:column;justify-content:space-between;
          padding:48px 44px;position:relative;overflow:hidden;
          background:var(--nm-dark-bg);
          margin:14px;border-radius:24px;
          box-shadow:
            inset 8px 8px 18px var(--nm-dark-shadow-dark),
            inset -8px -8px 18px var(--nm-dark-shadow-light);
        }
        .csrLogin-brandPanel::before{
          content:"";position:absolute;top:-120px;right:-120px;width:420px;height:420px;
          background:radial-gradient(circle, rgba(37,99,235,.35), transparent 70%);
          border-radius:50%;
        }
        .csrLogin-brandPanel::after{
          content:"";position:absolute;bottom:-160px;left:-100px;width:360px;height:360px;
          background:radial-gradient(circle, rgba(96,165,250,.18), transparent 70%);
          border-radius:50%;
        }
        .csrLogin-brandTop{position:relative;z-index:1;display:flex;align-items:center;gap:12px;}
        .csrLogin-brandTop img{width:44px;height:44px;object-fit:contain;}
        .csrLogin-brandTop span{font-weight:800;font-size:16px;letter-spacing:-.01em;}

        .csrLogin-brandMid{position:relative;z-index:1;max-width:420px;}
        .csrLogin-brandMid h1{font-size:32px;font-weight:800;line-height:1.15;margin:0 0 16px;letter-spacing:-.015em;}
        .csrLogin-brandMid p{font-size:15px;line-height:1.6;color:#B7C2D6;margin:0;}

        .csrLogin-statStrip{position:relative;z-index:1;display:flex;gap:28px;flex-wrap:wrap;}
        .csrLogin-statStrip .num{font-size:22px;font-weight:800;}
        .csrLogin-statStrip .label{font-size:12px;color:#8DA2C0;font-weight:600;margin-top:2px;}

        .csrLogin-formPanel{
          flex:1;min-width:0;display:flex;align-items:center;justify-content:center;
          padding:40px;
        }
        .csrLogin-formWrap{width:100%;max-width:340px;}
        .csrLogin-formWrap h2{font-size:23px;font-weight:800;color:#0F172A;margin:0 0 6px;letter-spacing:-.01em;}
        .csrLogin-formWrap p.sub{font-size:13.5px;color:#475569;margin:0 0 30px;}

        .csrLogin-field{margin-bottom:20px;}
        .csrLogin-field label{display:block;font-size:12.5px;font-weight:700;color:#475569;margin-bottom:9px;}
        .csrLogin-field input{
          width:100%;padding:13px 15px;border-radius:14px;border:none;
          background:var(--nm-bg);font-size:14px;font-family:inherit;color:#0F172A;
          box-shadow:
            inset 6px 6px 12px var(--nm-shadow-dark),
            inset -6px -6px 12px var(--nm-shadow-light);
          outline:none;transition:box-shadow .15s ease;
        }
        .csrLogin-field input:focus{
          box-shadow:
            inset 4px 4px 8px var(--nm-shadow-dark),
            inset -4px -4px 8px var(--nm-shadow-light),
            0 0 0 2px rgba(37,99,235,.25);
        }

        .csrLogin-errorText{color:#EF4444;font-size:13px;font-weight:600;margin:-8px 0 16px;}

        .csrLogin-btnPrimary{
          width:100%;padding:13px;border-radius:14px;border:none;background:var(--nm-bg);
          color:var(--nm-accent);font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;margin-top:8px;
          box-shadow:
            6px 6px 14px var(--nm-shadow-dark),
            -6px -6px 14px var(--nm-shadow-light);
          transition:all .15s ease;
        }
        .csrLogin-btnPrimary:hover{
          color:#fff;background:var(--nm-accent);
          box-shadow:
            4px 4px 10px var(--nm-shadow-dark),
            -4px -4px 10px var(--nm-shadow-light);
        }
        .csrLogin-btnPrimary:active{
          box-shadow:
            inset 4px 4px 8px rgba(0,0,0,.25),
            inset -4px -4px 8px rgba(255,255,255,.15);
        }

        .csrLogin-formFooter{margin-top:20px;font-size:13px;color:#475569;text-align:center;}
        .csrLogin-formFooter a{color:var(--nm-accent);font-weight:700;text-decoration:none;}

        @media (max-width:860px){
          .csrLogin-shell{flex-direction:column;min-height:0;}
          .csrLogin-brandPanel{padding:32px 26px;min-height:200px;margin:14px 14px 0;}
          .csrLogin-brandMid h1{font-size:24px;}
          .csrLogin-formPanel{padding:32px 24px;}
        }
      `}</style>

      <div className="csrLogin-shell">
        <div className="csrLogin-brandPanel">
          <div className="csrLogin-brandTop">
            <img src="/logo.png" alt="CSR logo" />
            <span>CSR Dashboard</span>
          </div>
          <div className="csrLogin-brandMid">
            <h1>One console for every brand you support.</h1>
            <p>Tickets, KYC, reports, and billing across all your brands — live, in one place.</p>
          </div>
          <div className="csrLogin-statStrip">
            <div><div className="num">11,106</div><div className="label">Tickets tracked</div></div>
            <div><div className="num">8</div><div className="label">Brands connected</div></div>
            <div><div className="num">20s</div><div className="label">Refresh rate</div></div>
          </div>
        </div>

        <div className="csrLogin-formPanel">
          <div className="csrLogin-formWrap">
            <h2>Welcome back</h2>
            <p className="sub">Sign in to your support console.</p>
            <form onSubmit={handleSubmit}>
              <div className="csrLogin-field">
                <label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="csrLogin-field">
                <label>Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && <div className="csrLogin-errorText">{error}</div>}
              <button className="csrLogin-btnPrimary" type="submit">Log in</button>
            </form>
            <div className="csrLogin-formFooter">No account? <Link to="/register">Create one</Link></div>
          </div>
        </div>
      </div>
    </div>
  );
}
