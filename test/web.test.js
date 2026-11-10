import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogoutUrl } from '../src/logoutUrl.js';
import { isAdminUser, isEmailVerified, normalizeGroups } from '../src/roles.js';

const domain = 'https://tu_dominio.auth.us-east-1.amazoncognito.com';
const clientId = 'TU_CLIENT_ID';
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
  // Usuario admin
  assert.equal(isAdminUser({ profile: { 'cognito:groups': ['admin'] } }), true);
  // Usuario registrado sin grupo -> participante
  assert.equal(isAdminUser({ profile: { 'cognito:groups': [] } }), false);
  // Usuario participante
  assert.equal(isAdminUser({ profile: { 'cognito:groups': ['participante'] } }), false);
  // Usuario sin claim de grupos -> participante
  assert.equal(isAdminUser({ profile: { email: 'usuario@example.com' } }), false);
  // Un correo con "admin" no otorga el rol si no está en cognito:groups
  assert.equal(isAdminUser({ profile: { email: 'admin@example.com' } }), false);
  assert.equal(isAdminUser({ profile: { email: 'admin@example.com', 'cognito:groups': [] } }), false);
  // Sin usuario -> no admin
  assert.equal(isAdminUser(null), false);
});

test('isEmailVerified acepta booleán o cadena "true"', () => {
  assert.equal(isEmailVerified({ profile: { email_verified: true } }), true);
  assert.equal(isEmailVerified({ profile: { email_verified: 'true' } }), true);
  assert.equal(isEmailVerified({ profile: { email_verified: false } }), false);
  assert.equal(isEmailVerified({ profile: { email_verified: 'false' } }), false);
  assert.equal(isEmailVerified({ profile: { email: 'a@b.com' } }), false);
  assert.equal(isEmailVerified(null), false);
});

test('datos del frontend no otorgan el rol admin', () => {
  // Incluso si el frontend recibe un perfil con email de administrador,
  // el rol admin solo se concede por cognito:groups.
  const perfilEngañoso = {
    profile: {
      email: 'admin@organizador.com',
      'cognito:username': 'admin',
      given_name: 'Administrador',
    },
  };
  assert.equal(isAdminUser(perfilEngañoso), false);
  assert.equal(isEmailVerified(perfilEngañoso), false);

  // Solo cuando Cognito emite el grupo admin en el token, es admin.
  const perfilAdminReal = {
    profile: {
      email: 'admin@organizador.com',
      'cognito:groups': ['admin'],
    },
  };
  assert.equal(isAdminUser(perfilAdminReal), true);
});
