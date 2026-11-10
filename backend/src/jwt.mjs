import { CognitoJwtVerifier } from 'aws-jwt-verify';

export function createCognitoVerifier({ userPoolId, clientId }) {
  return CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: 'access',
  });
}
