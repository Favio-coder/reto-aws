// Cognito usa `logout_uri`, no `redirect_uri` ni `post_logout_redirect_uri`.
// La URL se construye con URLSearchParams para que los valores queden codificados
// exactamente una vez, por ejemplo:
// logout_uri=http%3A%2F%2Flocalhost%3A5173%2F
export function buildLogoutUrl({ domain, clientId, logoutUri }) {
  const url = new URL('/logout', domain);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('logout_uri', logoutUri);
  return url.toString();
}
