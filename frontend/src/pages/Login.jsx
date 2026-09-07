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
        .csrLogin-screen{display:flex;min-height:100vh;font-family:'Plus Jakarta Sans',system-ui,sans-serif;}

        .csrLogin-brandPanel{
          flex:1;min-width:0;background:#0B1220;color:#fff;
          display:flex;flex-direction:column;justify-content:space-between;
          padding:56px 64px;position:relative;overflow:hidden;
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
        .csrLogin-brandMid h1{font-size:34px;font-weight:800;line-height:1.15;margin:0 0 16px;letter-spacing:-.015em;}
        .csrLogin-brandMid p{font-size:15px;line-height:1.6;color:#B7C2D6;margin:0;}

        .csrLogin-statStrip{position:relative;z-index:1;display:flex;gap:28px;flex-wrap:wrap;}
        .csrLogin-statStrip .num{font-size:22px;font-weight:800;}
        .csrLogin-statStrip .label{font-size:12px;color:#8DA2C0;font-weight:600;margin-top:2px;}

        .csrLogin-formPanel{
          flex:1;min-width:0;background:#fff;display:flex;align-items:center;justify-content:center;
          padding:40px;
        }
        .csrLogin-formWrap{width:100%;max-width:360px;}
        .csrLogin-formWrap h2{font-size:23px;font-weight:800;color:#0F172A;margin:0 0 6px;letter-spacing:-.01em;}
        .csrLogin-formWrap p.sub{font-size:13.5px;color:#475569;margin:0 0 32px;}

        .csrLogin-field{margin-bottom:18px;}
        .csrLogin-field label{display:block;font-size:12.5px;font-weight:700;color:#475569;margin-bottom:7px;}
        .csrLogin-field input{
          width:100%;padding:12px 14px;border-radius:10px;border:1px solid #EEF1F6;
          background:#F5F8FF;font-size:14px;font-family:inherit;color:#0F172A;
        }
        .csrLogin-field input:focus{outline:2px solid #2563EB;outline-offset:1px;background:#fff;}

        .csrLogin-errorText{color:#EF4444;font-size:13px;font-weight:600;margin:-6px 0 14px;}

        .csrLogin-btnPrimary{
          width:100%;padding:13px;border-radius:10px;border:none;background:#2563EB;
          color:#fff;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;margin-top:6px;
        }
        .csrLogin-btnPrimary:hover{background:#1D4ED8;}

        .csrLogin-formFooter{margin-top:18px;font-size:13px;color:#475569;text-align:center;}
        .csrLogin-formFooter a{color:#2563EB;font-weight:700;text-decoration:none;}

        @media (max-width:860px){
          .csrLogin-screen{flex-direction:column;}
          .csrLogin-brandPanel{padding:36px 28px;min-height:220px;}
          .csrLogin-brandMid h1{font-size:26px;}
          .csrLogin-formPanel{padding:32px 24px;}
        }
      `}</style>

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
  );
}
