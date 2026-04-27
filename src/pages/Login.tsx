import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import globaliaLogo from '../assets/globalia.png';
import { Lock, Mail, ArrowRight, Eye, EyeOff } from 'lucide-react';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [metricsCycleKey, setMetricsCycleKey] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setMetricsCycleKey((k) => k + 1), 7000);
    return () => clearInterval(id);
  }, []);
  const { login } = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    el.style.setProperty('--mx', `${x}px`);
    el.style.setProperty('--my', `${y}px`);
    el.style.setProperty('--glow-opacity', '1');
  };

  const handleMouseLeave = () => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty('--glow-opacity', '0');
  };

  useEffect(() => {
    try {
      const storedRemember = localStorage.getItem('login_remember_me');
      const remember = storedRemember ? storedRemember === '1' : true;
      setRememberMe(remember);

      const storedEmail = localStorage.getItem('login_email');
      if (remember && storedEmail) setEmail(storedEmail);
    } catch {
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      try {
        localStorage.setItem('login_remember_me', rememberMe ? '1' : '0');
        if (rememberMe) localStorage.setItem('login_email', email);
        else localStorage.removeItem('login_email');
      } catch {}
      navigate('/dashboard');
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Email ou senha incorretos');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={rootRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="min-h-screen lg:h-screen bg-[#07070c] text-white relative overflow-hidden cursor-glow"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 w-[740px] h-[740px] bg-gradient-to-br from-violet-600/25 via-indigo-600/10 to-transparent blur-[140px] rounded-full" />
        <div className="absolute -bottom-40 -right-40 w-[760px] h-[760px] bg-gradient-to-tr from-fuchsia-600/15 via-violet-600/10 to-transparent blur-[160px] rounded-full" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(139,92,246,0.10),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(99,102,241,0.10),transparent_45%),radial-gradient(circle_at_50%_90%,rgba(16,185,129,0.06),transparent_50%)]" />
        <div className="absolute inset-0 grid-pattern opacity-50" />
      </div>

      <div className="relative z-10 w-full min-h-screen lg:h-full flex flex-col lg:flex-row">
        <section className="px-6 py-10 lg:px-14 lg:py-10 lg:h-full flex flex-col justify-between lg:w-[55%] xl:w-[58%]">
          <div>
            <div className="flex items-center">
              <img
                src={globaliaLogo}
                alt="Global IA"
                className="h-7 w-auto sm:h-8 lg:h-9 object-contain drop-shadow-[0_0_10px_rgba(139,92,246,0.35)]"
              />
            </div>

            <div className="mt-16">
              <h1 className="text-4xl sm:text-5xl font-semibold leading-[1.05]">
                Reconhecimento{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-300 to-fuchsia-300 glow-text">Inteligente</span>
              </h1>

              <p className="mt-5 max-w-lg text-sm sm:text-base text-gray-400 leading-relaxed">
                Sensores e IA transformando interações em dados anonimizados e acionáveis. Sem rostos. Sem gravações. Apenas inteligência real.
              </p>
            </div>

            <div className="mt-12 hidden md:block">
              <div className="relative w-full max-w-xl">
                <div className="absolute inset-0 bg-gradient-to-r from-violet-500/10 to-transparent blur-2xl" />

                <div className="relative rounded-3xl border border-white/10 bg-white/[0.02] backdrop-blur-md p-6 overflow-hidden">
                  <div className="absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_30%_30%,rgba(139,92,246,0.10),transparent_40%),radial-gradient(circle_at_70%_60%,rgba(236,72,153,0.08),transparent_45%)]" />

                  <div className="relative grid grid-cols-[1fr_auto] gap-6 items-center">
                    <div className="relative">
                      <svg viewBox="0 0 360 220" className="w-full h-auto">
                        <defs>
                          <linearGradient id="scan" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0" stopColor="rgba(139,92,246,0.9)" />
                            <stop offset="0.5" stopColor="rgba(236,72,153,0.75)" />
                            <stop offset="1" stopColor="rgba(99,102,241,0.7)" />
                          </linearGradient>
                        </defs>

                        <g opacity="0.45">
                          <circle cx="42" cy="44" r="1" fill="rgba(255,255,255,0.20)" />
                          <circle cx="74" cy="86" r="1" fill="rgba(255,255,255,0.18)" />
                          <circle cx="118" cy="38" r="1" fill="rgba(255,255,255,0.14)" />
                          <circle cx="148" cy="70" r="1" fill="rgba(255,255,255,0.18)" />
                          <circle cx="210" cy="42" r="1" fill="rgba(255,255,255,0.14)" />
                          <circle cx="250" cy="64" r="1" fill="rgba(255,255,255,0.18)" />
                          <circle cx="290" cy="96" r="1" fill="rgba(255,255,255,0.16)" />
                          <circle cx="320" cy="58" r="1" fill="rgba(255,255,255,0.12)" />
                          <circle cx="314" cy="154" r="1" fill="rgba(255,255,255,0.14)" />
                          <circle cx="286" cy="180" r="1" fill="rgba(255,255,255,0.16)" />
                          <circle cx="244" cy="170" r="1" fill="rgba(255,255,255,0.12)" />
                          <circle cx="196" cy="184" r="1" fill="rgba(255,255,255,0.14)" />
                          <circle cx="110" cy="174" r="1" fill="rgba(255,255,255,0.12)" />
                          <circle cx="66" cy="152" r="1" fill="rgba(255,255,255,0.14)" />
                        </g>

                        <g className="mesh-lines" stroke="rgba(167,139,250,0.28)" strokeWidth="1" fill="none">
                          <polyline points="180,8 210,14 240,30 265,54 284,84 292,114 288,138 276,160 258,182 236,198 210,210 190,214 180,216 170,214 150,210 124,198 102,182 84,160 72,138 68,114 76,84 95,54 120,30 150,14 180,8" />
                        </g>

                        <g className="mesh-dash" stroke="rgba(167,139,250,0.35)" strokeWidth="1" fill="none" opacity="0.55">
                          <polyline points="124,98 138,88 156,88 170,98 156,108 138,108 124,98" />
                          <polyline points="190,98 204,88 222,88 236,98 222,108 204,108 190,98" />
                          <polyline points="180,112 170,132 180,142 190,132 180,112" opacity="0.7" />
                          <polyline points="150,156 168,150 180,152 192,150 210,156 196,170 180,174 164,170 150,156" opacity="0.75" />
                        </g>

                        <g className="mesh-points" fill="rgba(167,139,250,0.95)">
                          <circle className="mesh-point" cx="180" cy="8" r="2" style={{ animationDelay: '0ms' }} />
                          <circle className="mesh-point" cx="210" cy="14" r="2" style={{ animationDelay: '120ms' }} />
                          <circle className="mesh-point" cx="240" cy="30" r="2" style={{ animationDelay: '240ms' }} />
                          <circle className="mesh-point" cx="265" cy="54" r="2" style={{ animationDelay: '360ms' }} />
                          <circle className="mesh-point" cx="284" cy="84" r="2" style={{ animationDelay: '480ms' }} />
                          <circle className="mesh-point" cx="292" cy="114" r="2" style={{ animationDelay: '600ms' }} />
                          <circle className="mesh-point" cx="288" cy="138" r="2" style={{ animationDelay: '720ms' }} />
                          <circle className="mesh-point" cx="276" cy="160" r="2" style={{ animationDelay: '840ms' }} />
                          <circle className="mesh-point" cx="258" cy="182" r="2" style={{ animationDelay: '960ms' }} />
                          <circle className="mesh-point" cx="236" cy="198" r="2" style={{ animationDelay: '1080ms' }} />
                          <circle className="mesh-point" cx="210" cy="210" r="2" style={{ animationDelay: '1200ms' }} />
                          <circle className="mesh-point" cx="190" cy="214" r="2" style={{ animationDelay: '1320ms' }} />
                          <circle className="mesh-point" cx="180" cy="216" r="2" style={{ animationDelay: '1440ms' }} />
                          <circle className="mesh-point" cx="170" cy="214" r="2" style={{ animationDelay: '1560ms' }} />
                          <circle className="mesh-point" cx="150" cy="210" r="2" style={{ animationDelay: '1680ms' }} />
                          <circle className="mesh-point" cx="124" cy="198" r="2" style={{ animationDelay: '1800ms' }} />
                          <circle className="mesh-point" cx="102" cy="182" r="2" style={{ animationDelay: '1920ms' }} />
                          <circle className="mesh-point" cx="84" cy="160" r="2" style={{ animationDelay: '2040ms' }} />
                          <circle className="mesh-point" cx="72" cy="138" r="2" style={{ animationDelay: '2160ms' }} />
                          <circle className="mesh-point" cx="68" cy="114" r="2" style={{ animationDelay: '2280ms' }} />
                          <circle className="mesh-point" cx="76" cy="84" r="2" style={{ animationDelay: '2400ms' }} />
                          <circle className="mesh-point" cx="95" cy="54" r="2" style={{ animationDelay: '2520ms' }} />
                          <circle className="mesh-point" cx="120" cy="30" r="2" style={{ animationDelay: '2640ms' }} />
                          <circle className="mesh-point" cx="150" cy="14" r="2" style={{ animationDelay: '2760ms' }} />

                          <circle className="mesh-point" cx="138" cy="88" r="1.6" style={{ animationDelay: '260ms' }} />
                          <circle className="mesh-point" cx="156" cy="88" r="1.6" style={{ animationDelay: '520ms' }} />
                          <circle className="mesh-point" cx="124" cy="98" r="1.6" style={{ animationDelay: '780ms' }} />
                          <circle className="mesh-point" cx="170" cy="98" r="1.6" style={{ animationDelay: '1040ms' }} />
                          <circle className="mesh-point" cx="138" cy="108" r="1.6" style={{ animationDelay: '1300ms' }} />
                          <circle className="mesh-point" cx="156" cy="108" r="1.6" style={{ animationDelay: '1560ms' }} />

                          <circle className="mesh-point" cx="204" cy="88" r="1.6" style={{ animationDelay: '360ms' }} />
                          <circle className="mesh-point" cx="222" cy="88" r="1.6" style={{ animationDelay: '620ms' }} />
                          <circle className="mesh-point" cx="190" cy="98" r="1.6" style={{ animationDelay: '880ms' }} />
                          <circle className="mesh-point" cx="236" cy="98" r="1.6" style={{ animationDelay: '1140ms' }} />
                          <circle className="mesh-point" cx="204" cy="108" r="1.6" style={{ animationDelay: '1400ms' }} />
                          <circle className="mesh-point" cx="222" cy="108" r="1.6" style={{ animationDelay: '1660ms' }} />

                          <circle className="mesh-point" cx="180" cy="112" r="1.6" style={{ animationDelay: '420ms' }} />
                          <circle className="mesh-point" cx="170" cy="132" r="1.6" style={{ animationDelay: '760ms' }} />
                          <circle className="mesh-point" cx="190" cy="132" r="1.6" style={{ animationDelay: '980ms' }} />
                          <circle className="mesh-point" cx="180" cy="142" r="1.6" style={{ animationDelay: '1240ms' }} />

                          <circle className="mesh-point" cx="150" cy="156" r="1.6" style={{ animationDelay: '520ms' }} />
                          <circle className="mesh-point" cx="168" cy="150" r="1.6" style={{ animationDelay: '780ms' }} />
                          <circle className="mesh-point" cx="180" cy="152" r="1.6" style={{ animationDelay: '1040ms' }} />
                          <circle className="mesh-point" cx="192" cy="150" r="1.6" style={{ animationDelay: '1300ms' }} />
                          <circle className="mesh-point" cx="210" cy="156" r="1.6" style={{ animationDelay: '1560ms' }} />
                          <circle className="mesh-point" cx="196" cy="170" r="1.6" style={{ animationDelay: '1820ms' }} />
                          <circle className="mesh-point" cx="180" cy="174" r="1.6" style={{ animationDelay: '2080ms' }} />
                          <circle className="mesh-point" cx="164" cy="170" r="1.6" style={{ animationDelay: '2340ms' }} />
                        </g>

                        <rect x="18" y="18" width="44" height="44" rx="10" fill="none" stroke="rgba(139,92,246,0.35)" />
                        <rect x="298" y="18" width="44" height="44" rx="10" fill="none" stroke="rgba(139,92,246,0.35)" />
                        <rect x="18" y="158" width="44" height="44" rx="10" fill="none" stroke="rgba(139,92,246,0.25)" />
                        <rect x="298" y="158" width="44" height="44" rx="10" fill="none" stroke="rgba(139,92,246,0.25)" />
                      </svg>
                      <div className="absolute inset-0 overflow-hidden rounded-[28px] pointer-events-none">
                        <div className="scan-sweep" />
                        <div className="scan-line" />
                      </div>
                    </div>

                    <div className="min-w-[170px] text-xs text-gray-300">
                      <div key={metricsCycleKey} className="space-y-3">
                        <div className="reveal-up" style={{ animationDelay: '0ms' }}>
                          <div className="text-gray-500">ID anônimo</div>
                          <div className="font-semibold">#4821</div>
                        </div>
                        <div className="reveal-up" style={{ animationDelay: '350ms' }}>
                          <div className="text-gray-500">Idade</div>
                          <div className="font-semibold">28 ± 2</div>
                        </div>
                        <div className="reveal-up" style={{ animationDelay: '700ms' }}>
                          <div className="text-gray-500">Gênero</div>
                          <div className="font-semibold">Masculino</div>
                        </div>
                        <div className="reveal-up" style={{ animationDelay: '1050ms' }}>
                          <div className="text-gray-500">Expressão</div>
                          <div className="font-semibold">Neutro</div>
                        </div>
                        <div className="reveal-up" style={{ animationDelay: '1400ms' }}>
                          <div className="text-gray-500">Permanência</div>
                          <div className="font-semibold">02:47</div>
                        </div>
                        <div className="reveal-up" style={{ animationDelay: '1750ms' }}>
                          <div className="text-gray-500">Confiança</div>
                          <div className="font-semibold">97.3%</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          
        </section>

        <section className="relative px-6 py-10 lg:px-14 lg:py-10 lg:h-full flex items-center justify-center lg:w-[45%] xl:w-[42%]">
          <div className="hidden lg:block absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-violet-500/20 to-transparent" />

          <div className="w-full max-w-md">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-2xl shadow-black/30 p-8">
              <h2 className="text-xl font-semibold">Acessar Painel</h2>
              <p className="mt-1 text-sm text-gray-400">Entre com suas credenciais para continuar</p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <div className="space-y-2">
                  <label className="text-[11px] tracking-wider text-gray-400">E-MAIL</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input
                    name="email"
                    autoComplete="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full bg-white/[0.03] text-white placeholder-gray-600 border border-white/10 rounded-2xl py-3 pl-10 pr-4 outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20 transition"
                  />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] tracking-wider text-gray-400">SENHA</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input
                      name="password"
                      autoComplete="current-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-white/[0.03] text-white placeholder-gray-600 border border-white/10 rounded-2xl py-3 pl-10 pr-12 outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <label className="inline-flex items-center gap-2 text-gray-500 select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setRememberMe(checked);
                        try {
                          localStorage.setItem('login_remember_me', checked ? '1' : '0');
                          if (!checked) localStorage.removeItem('login_email');
                        } catch {}
                      }}
                      className="h-4 w-4 rounded border-white/10 bg-white/5 text-violet-500 focus:ring-violet-500/30"
                    />
                    Lembrar-me
                  </label>

                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setError('Fale com o administrador para recuperar o acesso.');
                    }}
                    className="text-violet-300 hover:text-violet-200 transition"
                  >
                    Esqueceu a senha?
                  </a>
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 text-red-200 text-sm px-3 py-2">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl px-4 py-3 font-semibold text-white bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-900/25 transition flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      Entrar no Painel
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>

              </form>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}