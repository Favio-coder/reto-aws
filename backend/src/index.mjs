import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createHandler } from './app.mjs';
import { loadConfig } from './config.mjs';
import { createDynamoStore } from './store.mjs';

const config = loadConfig();
const store = createDynamoStore({ tableName: config.tableName });

// Verifica firma RS256 con el JWKS del User Pool, emisor, client_id,
// expiración y token_use=access. No acepta ID tokens ni tokens manipulados.
const verifier = CognitoJwtVerifier.create({
  userPoolId: config.userPoolId,
  clientId: config.clientId,
  tokenUse: 'access',
});

export const handler = createHandler({
  store,
  verifyToken: token => verifier.verify(token),
  config,
});
