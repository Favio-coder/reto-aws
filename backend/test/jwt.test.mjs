import test from 'node:test';
import assert from 'node:assert/strict';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const userPoolId = 'us-east-1_EXAMPLE00000';
const clientId = 'TU_CLIENT_ID';
const issuer = `https://cognito-idp.us-east-1.amazonaws.com/${userPoolId}`;
const kid = 'test-key';

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: 'access',
  });
  // Carga una JWKS local: se ejercita la verificación real de firma,
  // emisor, cliente, expiración y token_use, sin llamar a Cognito.
  verifier.cacheJwks({ keys: [publicJwk] });

  return { verifier, privateKey };
}

async function makeToken(privateKey, overrides = {}, { tokenIssuer = issuer, expired = false } = {}) {
  const payload = {
    sub: 'user-sub',
    token_use: 'access',
    client_id: clientId,
    'cognito:groups': ['participante'],
    ...overrides,
  };

  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(tokenIssuer)
    .setIssuedAt();

  if (expired) {
    jwt.setExpirationTime(Math.floor(Date.now() / 1000) - 10);
  } else {
    jwt.setExpirationTime('1h');
  }

  return jwt.sign(privateKey);
}

test('acepta un access token firmado, vigente, del emisor y cliente correctos', async () => {
  const { verifier, privateKey } = await setup();
  const claims = await verifier.verify(await makeToken(privateKey));

  assert.equal(claims.sub, 'user-sub');
  assert.equal(claims.token_use, 'access');
  assert.equal(claims.client_id, clientId);
  assert.deepEqual(claims['cognito:groups'], ['participante']);
});

test('rechaza un ID token aunque la firma sea válida', async () => {
  const { verifier, privateKey } = await setup();
  const token = await makeToken(privateKey, { token_use: 'id', aud: clientId });
  await assert.rejects(() => verifier.verify(token));
});

test('rechaza un token de otro cliente', async () => {
  const { verifier, privateKey } = await setup();
  const token = await makeToken(privateKey, { client_id: 'otro-cliente' });
  await assert.rejects(() => verifier.verify(token));
});

test('rechaza un emisor distinto', async () => {
  const { verifier, privateKey } = await setup();
  const token = await makeToken(privateKey, {}, { tokenIssuer: 'https://evil.example.com' });
  await assert.rejects(() => verifier.verify(token));
});

test('rechaza un token vencido', async () => {
  const { verifier, privateKey } = await setup();
  const token = await makeToken(privateKey, {}, { expired: true });
  await assert.rejects(() => verifier.verify(token));
});

test('rechaza un token sin token_use=access', async () => {
  const { verifier, privateKey } = await setup();
  const token = await makeToken(privateKey, { token_use: undefined });
  await assert.rejects(() => verifier.verify(token));
});

test('rechaza una firma manipulada', async () => {
  const { verifier } = await setup();
  const { privateKey: otherKey } = await generateKeyPair('RS256');
  const token = await makeToken(otherKey);
  await assert.rejects(() => verifier.verify(token));
});

test('rechaza un JWT con formato inválido', async () => {
  const { verifier } = await setup();
  await assert.rejects(() => verifier.verify('no-es-un-jwt'));
});
