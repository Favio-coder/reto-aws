export function loadConfig(env = process.env) {
  const required = ['TABLE_NAME', 'USER_POOL_ID', 'CLIENT_ID'];
  const missing = required.filter(key => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }

  return {
    tableName: env.TABLE_NAME,
    userPoolId: env.USER_POOL_ID,
    clientId: env.CLIENT_ID,
    // Solo el valor exacto "true" activa el laboratorio.
    labMode: env.LAB_MODE === 'true',
    edition: env.CHALLENGE_ID || 'TU_CHALLENGE_ID',
    appOrigin: env.APP_ORIGIN || 'http://localhost:5173',
  };
}
