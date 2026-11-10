import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { buildLogoutUrl } from './logoutUrl.js';

// Configuración pública de Cognito para una SPA. Nunca colocar aquí un
// client_secret, AWS Access Key, AWS Secret Access Key, contraseñas, tokens
// ni banderas. Vite expone todas las variables VITE_* en el bundle público.
const env = import.meta.env;

const requiredEnv = {
  VITE_COGNITO_REGION: env.VITE_COGNITO_REGION,
  VITE_COGNITO_USER_POOL_ID: env.VITE_COGNITO_USER_POOL_ID,
  VITE_COGNITO_CLIENT_ID: env.VITE_COGNITO_CLIENT_ID,
  VITE_COGNITO_DOMAIN: env.VITE_COGNITO_DOMAIN,
  VITE_COGNITO_REDIRECT_URI: env.VITE_COGNITO_REDIRECT_URI,
  VITE_COGNITO_LOGOUT_URI: env.VITE_COGNITO_LOGOUT_URI,
};

const missing = Object.entries(requiredEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  throw new Error(
    `Faltan variables de entorno de Cognito: ${missing.join(', ')}. `
    + 'Copia .env.example a .env.local, completa los valores y reinicia Vite.',
  );
}

const region = requiredEnv.VITE_COGNITO_REGION;
const userPoolId = requiredEnv.VITE_COGNITO_USER_POOL_ID;
const clientId = requiredEnv.VITE_COGNITO_CLIENT_ID;

function withoutTrailingSlashes(value) {
  return value.replace(/\/+$/, '');
}

export const authConfig = {
  authority: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
  client_id: clientId,
  redirect_uri: requiredEnv.VITE_COGNITO_REDIRECT_URI,
  response_type: 'code',
  scope: 'openid email',
  // No se define post_logout_redirect_uri: Cognito /logout espera logout_uri.
};

export const cognitoDomain = withoutTrailingSlashes(requiredEnv.VITE_COGNITO_DOMAIN);

// Cognito exige este valor exacto en Allowed sign-out URLs.
// Se envía como `logout_uri`; nunca como `redirect_uri`.
export const logoutUri = requiredEnv.VITE_COGNITO_LOGOUT_URI;

export const userManager = new UserManager({
  ...authConfig,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: false,
  monitorSession: false,
  loadUserInfo: false,
  revokeTokenTypes: ['refresh_token'],
  // Authorization Code usa PKCE de forma predeterminada en oidc-client-ts.
});

// Construye la URL de registro (Sign up) de Cognito Hosted UI / Managed Login.
// Redirige al usuario al flujo de registro de Cognito sin crear un formulario
// propio en React. Tras registrarse, Cognito envía un código de confirmación
// por correo y el usuario debe confirmar antes de poder iniciar sesión.
export function buildRegisterUrl() {
  const url = new URL('/login', cognitoDomain);
  url.searchParams.set('client_id', authConfig.client_id);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('redirect_uri', requiredEnv.VITE_COGNITO_REDIRECT_URI);
  url.searchParams.set('action', 'REGISTER');
  return url.toString();
}

export async function login() {
  await userManager.clearStaleState();
  await userManager.signinRedirect();
}

export async function logout() {
  // Primero se elimina el usuario de sessionStorage. React limpia su estado antes
  // de llamar a esta función. Después se navega al endpoint de Cognito.
  // No se usa userManager.signoutRedirect(): Cognito espera `logout_uri`, mientras
  // que oidc-client-ts enviaría `post_logout_redirect_uri`.
  await userManager.removeUser();
  const url = buildLogoutUrl({
    domain: cognitoDomain,
    clientId: authConfig.client_id,
    logoutUri,
  });
  window.location.assign(url);
}

// Una sola promesa evita canjear el mismo código dos veces con React StrictMode.
let initialization;
export function initializeSession() {
  initialization ??= (async () => {
    if (window.location.pathname === '/callback') {
      try {
        return await userManager.signinRedirectCallback();
      } catch (error) {
        await userManager.removeUser();
        throw error;
      } finally {
        // Elimina el código OAuth de la barra de direcciones.
        window.history.replaceState({}, document.title, '/');
      }
    }
    const user = await userManager.getUser();
    if (user?.expired) {
      await userManager.removeUser();
      return null;
    }
    return user;
  })();
  return initialization;
}
