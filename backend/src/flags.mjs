import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// 32 bytes aleatorios => 256 bits de entropía. No se deriva del usuario ni del reloj.
export function generateFlag() {
  return `FLAG{${randomBytes(32).toString('base64url')}}`;
}

// Compara hashes para no filtrar la longitud mediante el tiempo de comparación.
export function flagsEqual(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const left = createHash('sha256').update(candidate, 'utf8').digest();
  const right = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(left, right);
}
