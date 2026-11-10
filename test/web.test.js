import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogoutUrl } from '../src/logoutUrl.js';
import { isAdminUser, normalizeGroups } from '../src/roles.js';

const domain = 'https://us-east-1wkqy366jq.auth.us-east-1.amazoncognito.com';
const clientId = '4b5jtn0tvsajtu8jv0j0bgnlla';
const logoutUri = 'http://localhost:5173/';

test('logout usa /logout con client_id y logout_uri codificados', () => {
  const result = buildLogoutUrl({ domain, clientId, logoutUri });
  const url = new URL(result);

  assert.equal(`${url.origin}${url.pathname}`, `${domain}/logout`);
  assert.equal(url.searchParams.get('client_id'), clientId);
  assert.equal(url.searchParams.get('logout_uri'), logoutUri);
  assert.equal(url.searchParams.has('redirect_uri'), false);
  assert.equal(url.searchParams.has('post_logout_redirect_uri'), false);
  assert.match(url.search, /logout_uri=http%3A%2F%2Flocalhost%3A5173%2F/);
});

test('normalizeGroups acepta arreglo, cadena o ausencia del claim', () => {
  assert.deepEqual(normalizeGroups(['admin', 'participante']), ['admin', 'participante']);
  assert.deepEqual(normalizeGroups('admin participante'), ['admin', 'participante']);
  assert.deepEqual(normalizeGroups(undefined), []);
  assert.deepEqual(normalizeGroups([null, 7, 'admin']), ['admin']);
});

test('solo cognito:groups decide el rol admin', () => {
  assert.equal(isAdminUser({ profile: { 'cognito:groups': ['admin'] } }), true);
  assert.equal(isAdminUser({ profile: { 'cognito:groups': ['participante'] } }), false);
  assert.equal(isAdminUser({ profile: { email: 'admin@example.com' } }), false);
  assert.equal(isAdminUser({ profile: { email: 'admin@example.com', 'cognito:groups': [] } }), false);
  assert.equal(isAdminUser(null), false);
});
