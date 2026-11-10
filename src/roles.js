// El rol se deriva exclusivamente del claim cognito:groups del token de identidad.
// Un usuario sin el grupo "admin" se trata como participante.
export function normalizeGroups(value) {
  if (Array.isArray(value)) {
    return value.filter(group => typeof group === 'string' && group.length > 0);
  }
  if (typeof value === 'string') {
    return value.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

export function isAdminUser(user) {
  return normalizeGroups(user?.profile?.['cognito:groups']).includes('admin');
}

// Indica si el usuario confirmó su correo electrónico en Cognito.
// Cognito puede devolver email_verified como booleán o como cadena "true"/"false".
export function isEmailVerified(user) {
  const verified = user?.profile?.email_verified;
  return verified === true || verified === 'true';
}
