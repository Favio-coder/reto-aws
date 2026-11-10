import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { buildLogoutUrl } from './logoutUrl.js';

// Configuración pública. Nunca colocar un client_secret ni claves AWS aquí.
// Confirma mayúsculas/minúsculas del User Pool ID en tu consola de Cognito.
export const authConfig = {
  authority: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wkQY366JQ',
  client_id: '4b5jtn0tvsajtu8jv0j0bgnlla',
  redirect_uri: 'http://localhost:5173/callback',
  response_type: 'code',
  scope: 'openid email',
  // No se define post_logout_redirect_uri: Cognito /logout espera logout_uri.
};

export const cognitoDomain = 'https://us-east-1wkqy366jq.auth.us-east-1.amazoncognito.com';

// Cognito exige este valor exacto en Allowed sign-out URLs.
// Se envía como `logout_uri`; nunca como `redirect_uri`.
export const logoutUri = 'http://localhost:5173/';

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
