import { useEffect, useRef, useState } from 'react';
import { initializeSession, login, logout, userManager, buildRegisterUrl } from './auth';
import { ApiError, getAdminFlag, submitFlag } from './api';
import { isAdminUser, isEmailVerified } from './roles';

const sessionError = 'No se pudo completar el acceso. Revisa las URLs de Cognito y vuelve a iniciar sesión desde esta pestaña.';

function displayName(user) {
  return user.profile.email || user.profile['cognito:username'] || user.profile.sub;
}

function errorMessage(error, fallback) {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

function SessionBar({ user, admin }) {
  const expires = user.expires_at
    ? new Date(user.expires_at * 1000).toLocaleString('es-PE')
    : 'No disponible';

  return (
    <div className="session-bar">
      <div>
        <p className="eyebrow">SESIÓN ACTIVA</p>
        <p className="session-user">{displayName(user)}</p>
        <p className="hint session-expiry">Válida hasta {expires}</p>
      </div>
      <span className={`pill${admin ? ' pill-admin' : ''}`}>{admin ? 'ADMIN' : 'PARTICIPANTE'}</span>
    </div>
  );
}

function AdminPanel({ user }) {
  const [flag, setFlag] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState('');
  const [attempt, setAttempt] = useState(0);
  const copyTimer = useRef();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getAdminFlag(user.access_token)
      .then(data => {
        if (!active) return;

        // Respuesta de administrador: solo mensaje, sin bandera.
        if (typeof data.message === 'string' && data.message) {
          setAdminMessage(data.message);
          setFlag('');
          return;
        }

        // Ya completado: no mostrar la bandera nuevamente.
        if (data.alreadySolved || typeof data.flag !== 'string' || !data.flag) {
          setAdminMessage(data.message || 'Ya completaste el reto.');
          setFlag('');
          return;
        }

        // Participante con bandera válida (solo en LAB_MODE=true).
        setFlag(data.flag);
        setAdminMessage('');
      })
      .catch(failure => {
        if (active) setError(errorMessage(failure, 'No se pudo obtener la bandera desde la API.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [user.access_token, attempt]);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
  }, []);

  async function copyFlag() {
    if (!flag) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(flag);
      setCopyState('copied');
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopyState(''), 2200);
    } catch {
      setCopyState('error');
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopyState(''), 3000);
    }
  }

  return (
    <div className="panel">
      <div className="icon" aria-hidden="true">◆</div>
      <p className="eyebrow">BANDERA DE ADMINISTRADOR</p>
      <h2>{loading ? 'Obteniendo bandera…' : flag ? 'Tu bandera está lista.' : adminMessage ? adminMessage : 'No se pudo cargar.'}</h2>

      {error && <p className="error" role="alert">{error}</p>}

      {loading && <div className="skeleton" aria-hidden="true" />}

      {!loading && flag && (
        <>
          <p className="description">Es única para tu usuario en esta edición. No la compartas fuera del laboratorio.</p>
          <div className="flag-box"><code>{flag}</code></div>
          <button type="button" className="secondary" onClick={copyFlag}>
            {copyState === 'copied' ? 'Bandera copiada' : copyState === 'error' ? 'No se pudo copiar; selecciónala manualmente' : 'Copiar bandera'}
          </button>
          <p className="hint">La API la entrega en GET /admin/flag validando tu access token.</p>
        </>
      )}

      {!loading && adminMessage && !flag && (
        <div className="admin-message" role="status">
          <p>{adminMessage}</p>
        </div>
      )}

      {!loading && error && !adminMessage && !flag && (
        <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>
          Reintentar
        </button>
      )}
    </div>
  );
}

function ParticipantPanel({ user }) {
  const [flag, setFlag] = useState('');
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [code, setCode] = useState('');
  const [codeInstruction, setCodeInstruction] = useState('');
  const [codeExpiresAt, setCodeExpiresAt] = useState(0);

  useEffect(() => {
    if (!cooldownUntil) {
      setRemaining(0);
      return undefined;
    }
    const update = () => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setCooldownUntil(0);
    };
    update();
    const id = window.setInterval(update, 500);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const blocked = remaining > 0;

  useEffect(() => {
    if (!codeExpiresAt) return undefined;
    const update = () => {
      const left = Math.max(0, Math.ceil((codeExpiresAt - Date.now()) / 1000));
      if (left === 0) {
        setCodeExpiresAt(0);
        setCode('');
        setCodeInstruction('');
      }
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [codeExpiresAt]);

  const codeExpired = codeExpiresAt > 0 && Date.now() >= codeExpiresAt;

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy || blocked || code) return;

    const cleanFlag = flag.trim();
    const cleanExplanation = explanation.trim();

    if (!cleanFlag) {
      setMessage({ type: 'error', text: 'Escribe la bandera que encontraste.' });
      return;
    }
    if (cleanFlag.length > 200) {
      setMessage({ type: 'error', text: 'La bandera es demasiado larga.' });
      return;
    }
    if (cleanExplanation.length < 10 || cleanExplanation.length > 800) {
      setMessage({ type: 'error', text: 'La explicación debe tener entre 10 y 800 caracteres.' });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const data = await submitFlag({
        token: user.access_token,
        flag: cleanFlag,
        explanation: cleanExplanation,
      });

      if (data.correct) {
        if (data.code) {
          setCode(data.code);
          setCodeInstruction(data.instruction || 'Envía este código al organizador por WhatsApp.');
          setCodeExpiresAt(Date.now() + (data.expiresIn || 0) * 1000);
          setMessage({
            type: 'ok',
            text: data.message || '¡Felicidades! Completaste el reto.',
          });
        } else {
          setMessage({
            type: 'ok',
            text: data.alreadySolved
              ? 'Ya tenías esta resolución registrada. No se creó un duplicado.'
              : 'Bandera correcta. Tu resolución quedó registrada.',
          });
        }
        setFlag('');
        setExplanation('');
      } else {
        const remainingAttempts = Number(data.attemptsRemaining);
        setMessage({
          type: 'error',
          text: `${data.message || 'Bandera incorrecta.'}${Number.isFinite(remainingAttempts) ? ` Intentos restantes: ${remainingAttempts}.` : ''}`,
        });
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 429) {
        const seconds = failure.retryAfterSeconds > 0 ? Math.ceil(failure.retryAfterSeconds) : 60;
        setCooldownUntil(Date.now() + seconds * 1000);
        setMessage({
          type: 'error',
          text: `Demasiados intentos incorrectos. Espera ${seconds} segundos antes de volver a entregar.`,
        });
      } else {
        setMessage({
          type: 'error',
          text: errorMessage(failure, 'No se pudo enviar la bandera. Revisa tu conexión e inténtalo de nuevo.'),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="icon" aria-hidden="true">↗</div>
      <p className="eyebrow">RETO ACTIVO</p>
      <h2>Entrega tu bandera.</h2>
      <p className="description">
        Investiga la API del laboratorio con tu propia sesión. Cuando encuentres la bandera,
        envíala con una explicación breve. No se muestra automáticamente.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="flag">Bandera</label>
        <input
          id="flag"
          name="flag"
          type="text"
          autoComplete="off"
          spellCheck="false"
          placeholder="FLAG{...}"
          maxLength={200}
          value={flag}
          onChange={event => setFlag(event.target.value)}
          disabled={busy || blocked}
          required
        />

        <label htmlFor="explanation">Explicación breve</label>
        <textarea
          id="explanation"
          name="explanation"
          rows={3}
          maxLength={800}
          placeholder="¿Cómo la obtuviste?"
          value={explanation}
          onChange={event => setExplanation(event.target.value)}
          disabled={busy || blocked}
          required
        />
        <div className="form-meta">
          <span>{explanation.trim().length}/800</span>
          <span>Mínimo 10 caracteres</span>
        </div>

        {message && (
          <p className={message.type === 'ok' ? 'success' : 'error'} role={message.type === 'ok' ? 'status' : 'alert'}>
            {message.text}
          </p>
        )}

        <button type="submit" disabled={busy || blocked || code || codeExpired}>
          {busy ? 'Enviando…' : blocked ? `Espera ${remaining} s` : code ? 'Reto completado' : 'Enviar bandera'}
        </button>
        <p className="hint">La comparación y el registro ocurren en el servidor.</p>
      </form>

      {code && !codeExpired && (
        <div className="code-display" role="status">
          <p className="ok">{message?.text}</p>
          <p className="code-instruction">{codeInstruction}</p>
          <div className="code-box"><code>{code}</code></div>
          <p className="hint">El código expira en 10 minutos. Solo se muestra una vez.</p>
        </div>
      )}

      {codeExpired && (
        <div className="code-expired" role="status">
          <p>El código de verificación expiró. Contacta al organizador.</p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    initializeSession()
      .then(value => { if (active) setUser(value); })
      .catch(() => { if (active) setError(sessionError); })
      .finally(() => { if (active) setLoading(false); });
    const expired = () => {
      setUser(null);
      setError('Tu sesión venció. Inicia sesión nuevamente.');
      void userManager.removeUser().catch(() => {});
    };
    userManager.events.addAccessTokenExpired(expired);
    return () => {
      active = false;
      userManager.events.removeAccessTokenExpired(expired);
    };
  }, []);

  async function run(action) {
    setError('');
    setBusy(true);
    try { await action(); }
    catch { setError('No se pudo conectar con Cognito. Revisa tu conexión y las variables VITE_COGNITO_* de .env.local.'); }
    finally { setBusy(false); }
  }

  async function handleLogout() {
    setError('');
    setBusy(true);
    // Limpia primero el estado de React. logout() elimina el usuario de
    // sessionStorage antes de navegar al endpoint /logout de Cognito.
    setUser(null);
    try {
      await logout();
    } catch {
      setBusy(false);
      setError('Se limpió el estado de la pantalla, pero no se pudo completar el cierre de sesión local. Recarga la página e inténtalo de nuevo.');
    }
  }

  const admin = user ? isAdminUser(user) : false;
  const emailVerified = user ? isEmailVerified(user) : false;
  const intro = user
    ? !emailVerified
      ? {
        eyebrow: '01 / CORREO NO CONFIRMADO',
        title: <>Confirma tu<br />correo electrónico.</>,
        lead: 'Antes de continuar, revisa tu bandeja de entrada y haz clic en el enlace de confirmación que te envió Amazon Cognito.',
      }
      : admin
        ? {
          eyebrow: '02 / ADMINISTRACIÓN',
          title: <>Control del<br />laboratorio.</>,
          lead: 'Tu cuenta pertenece al grupo admin. Esta bandera es única para tu usuario y esta edición.',
        }
        : {
          eyebrow: '02 / PARTICIPANTE',
          title: <>Encuentra<br />la bandera.</>,
          lead: 'Tu cuenta pertenece al grupo participante. Explora la API y entrega lo que encuentres.',
        }
    : {
      eyebrow: '01 / IDENTIDAD',
      title: <>Todo empieza<br />con el acceso.</>,
      lead: 'Tu espacio para explorar la seguridad de aplicaciones en la nube.',
    };

  return (
    <main>
      <header>
        <a className="brand" href="/">RC<span>RETO CIBER</span></a>
        <span className="badge">LABORATORIO AWS</span>
      </header>
      <section className="layout">
        <div className="intro">
          <p className="eyebrow">{intro.eyebrow}</p>
          <h1>{intro.title}</h1>
          <p className="lead">{intro.lead}</p>
          <div className="steps">
            <span className={user ? 'done' : 'current'}>01 Autenticación</span>
            <span className={user ? 'current' : ''}>02 API</span>
            <span>03 Reto</span>
          </div>
        </div>

        <section className={`card${user ? ' lab-card' : ''}`} aria-label="Laboratorio de seguridad">
          {loading && (
            <>
              <div className="icon" aria-hidden="true">…</div>
              <p className="eyebrow">ACCESO AL LABORATORIO</p>
              <h2>Comprobando sesión…</h2>
            </>
          )}

          {!loading && !user && (
            <>
              <div className="icon" aria-hidden="true">↗</div>
              <p className="eyebrow">ACCESO AL LABORATORIO</p>
              <h2>Bienvenido al reto.</h2>
              {error && <p className="error" role="alert">{error}</p>}
              <p className="description">Ingresa con la cuenta que te proporcionó el organizador.</p>
              <button disabled={busy} onClick={() => run(login)}>
                {busy ? 'Conectando…' : 'Iniciar sesión con Cognito'}<span aria-hidden="true"> →</span>
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => window.location.assign(buildRegisterUrl())}
              >
                Crear cuenta
              </button>
              <p className="hint">Se abrirá la página de acceso y registro de Amazon Cognito.</p>
            </>
          )}

          {!loading && user && !emailVerified && (
            <>
              <div className="icon" aria-hidden="true">✉️</div>
              <p className="eyebrow">ACCESO AL LABORATORIO</p>
              <h2>Confirma tu correo electrónico.</h2>
              <p className="error" role="alert">
                Antes de participar, confirma tu cuenta. Revisa tu bandeja de entrada (y correo no deseado)
                y haz clic en el enlace de confirmación que te envió Amazon Cognito.
              </p>
              <p className="description">
                Si no recibiste el correo, inicia sesión nuevamente para solicitar un código de confirmación.
              </p>
              <button disabled={busy} onClick={() => run(login)}>
                {busy ? 'Conectando…' : 'Iniciar sesión con Cognito'}<span aria-hidden="true"> →</span>
              </button>
              <p className="hint">Sin la confirmación de correo no se puede acceder al reto.</p>
            </>
          )}

          {!loading && user && emailVerified && (
            <>
              <SessionBar user={user} admin={admin} />
              {error && <p className="error" role="alert">{error}</p>}
              {admin ? <AdminPanel user={user} /> : <ParticipantPanel user={user} />}
              <button type="button" className="secondary logout" disabled={busy} onClick={handleLogout}>
                {busy ? 'Cerrando…' : 'Cerrar sesión'}
              </button>
            </>
          )}
        </section>
      </section>
      <footer>
        <span>Entorno de práctica · Datos de prueba</span>
        <span>{user ? (admin ? 'Vista de administrador' : 'Vista de participante') : 'Acceso con Cognito'}</span>
      </footer>
    </main>
  );
}
