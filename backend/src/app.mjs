import { randomUUID, randomInt, createHash } from 'node:crypto';
import { flagsEqual, generateFlag } from './flags.mjs';

const MAX_BODY_BYTES = 8 * 1024;
const MAX_FLAG_LENGTH = 200;
const MIN_EXPLANATION_LENGTH = 10;
const MAX_EXPLANATION_LENGTH = 800;
const MAX_FAILURES = 3;
const COOLDOWN_MS = 60_000;
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutos

class HttpError extends Error {
  constructor(statusCode, code, message, extra = {}, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}

function corsHeaders(origin, appOrigin) {
  const headers = { Vary: 'Origin' };
  if (origin && appOrigin && origin === appOrigin) {
    headers['access-control-allow-origin'] = appOrigin;
  }
  return headers;
}

function json(statusCode, body, { origin, config, extraHeaders = {} }) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...corsHeaders(origin, config.appOrigin),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function preflight(origin, config) {
  return {
    statusCode: 204,
    headers: {
      ...(origin && origin === config.appOrigin
        ? { 'access-control-allow-origin': config.appOrigin }
        : {}),
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Authorization, Content-Type',
      'access-control-max-age': '600',
      'cache-control': 'no-store',
      Vary: 'Origin',
    },
    body: '',
  };
}

function getHeader(event, name) {
  const headers = event?.headers || {};
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function getMethod(event) {
  return event?.requestContext?.http?.method || event?.httpMethod || 'GET';
}

function getPath(event) {
  return event?.requestContext?.http?.path || event?.path || event?.rawPath || '/';
}

function pathMatches(event, method, expectedPath) {
  if (getMethod(event) !== method) return false;
  const actual = getPath(event).replace(/\/+$/, '') || '/';
  return actual === expectedPath || actual.endsWith(expectedPath);
}

function normalizeGroups(value) {
  if (Array.isArray(value)) {
    return value.filter(group => typeof group === 'string' && group.length > 0);
  }
  if (typeof value === 'string') {
    return value.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

function isAdmin(groups) {
  return groups.includes('admin');
}

async function authenticate(event, verifyToken, config) {
  const authorization = getHeader(event, 'authorization');
  if (typeof authorization !== 'string' || !/^Bearer\s+\S+$/i.test(authorization.trim())) {
    throw new HttpError(401, 'unauthorized', 'Falta el token de acceso Bearer.');
  }

  const token = authorization.trim().replace(/^Bearer\s+/i, '');
  let claims;
  try {
    claims = await verifyToken(token);
  } catch {
    // No se registra el token ni el detalle del error.
    throw new HttpError(401, 'invalid_token', 'El token de acceso no es válido o venció.');
  }

  if (
    !claims
    || claims.token_use !== 'access'
    || typeof claims.sub !== 'string'
    || claims.sub.length === 0
    || claims.client_id !== config.clientId
  ) {
    throw new HttpError(401, 'invalid_token', 'El token de acceso no es válido para este cliente.');
  }

  return {
    sub: claims.sub,
    groups: normalizeGroups(claims['cognito:groups']),
  };
}

function parseJsonBody(event) {
  const raw = event?.body;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new HttpError(400, 'invalid_body', 'Envía un cuerpo JSON.');
  }
  if (raw.length > MAX_BODY_BYTES * 2) {
    throw new HttpError(413, 'payload_too_large', 'El cuerpo de la solicitud es demasiado grande.');
  }

  const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large', 'El cuerpo de la solicitud es demasiado grande.');
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'El cuerpo no es JSON válido.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'invalid_body', 'El cuerpo debe ser un objeto JSON.');
  }
  return data;
}

function flagKey(edition, sub) {
  return { pk: `FLAG#${edition}`, sk: `USER#${sub}` };
}

function solveKey(edition, sub) {
  return { pk: `SOLVE#${edition}`, sk: `USER#${sub}` };
}

function rateKey(edition, sub) {
  return { pk: `RATE#${edition}`, sk: `USER#${sub}` };
}

function submissionKey(sub, submittedAt) {
  return { pk: `USER#${sub}`, sk: `SUB#${submittedAt}#${randomUUID()}` };
}

function codeKey(edition, sub) {
  return { pk: `CODE#${edition}`, sk: `USER#${sub}` };
}

async function getOrCreateFlag(store, edition, sub, nowMs) {
  const key = flagKey(edition, sub);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await store.get(key.pk, key.sk);
    if (typeof existing?.flag === 'string' && existing.flag.length > 0) {
      return existing.flag;
    }

    const flag = generateFlag();
    const created = await store.putIfAbsent({
      ...key,
      entity: 'flag',
      userId: sub,
      challengeId: edition,
      flag,
      createdAt: new Date(nowMs).toISOString(),
    });
    if (created) return flag;
  }

  // Si otra solicitud ganó la creación condicional, se lee el valor estable.
  const finalItem = await store.get(key.pk, key.sk);
  if (typeof finalItem?.flag === 'string' && finalItem.flag.length > 0) {
    return finalItem.flag;
  }
  throw new Error('No se pudo crear ni leer la bandera');
}

async function getRateState(store, edition, sub, nowMs) {
  const key = rateKey(edition, sub);
  const item = await store.get(key.pk, key.sk);
  if (!item) return { key, failures: 0, blockedUntil: 0 };

  const blockedUntil = Number(item.blockedUntil) || 0;
  if (blockedUntil > nowMs) {
    return { key, failures: Number(item.failures) || 0, blockedUntil };
  }

  if (blockedUntil > 0) {
    // El vencimiento se comprueba aquí, no mediante TTL de DynamoDB.
    await store.update(key.pk, key.sk, {
      set: { failures: 0, blockedUntil: 0, updatedAt: new Date(nowMs).toISOString() },
    });
    return { key, failures: 0, blockedUntil: 0 };
  }

  return { key, failures: Number(item.failures) || 0, blockedUntil: 0 };
}

async function handleAdminFlag({ event, store, verifyToken, config, now }) {
  const identity = await authenticate(event, verifyToken, config);
  const nowMs = now();

  // Usuario real del grupo admin: mensaje de felicitaciones, sin bandera.
  // Nunca se llama a Cognito AdminAddUserToGroup ni se modifican grupos.
  if (isAdmin(identity.groups)) {
    return {
      statusCode: 200,
      body: {
        challengeId: config.edition,
        message: '¡Felicidades, ingresaste como administrador!',
      },
    };
  }

  // VULNERABILIDAD EDUCATIVA (solo LAB_MODE=true):
  // esta ruta omite a propósito la comprobación de cognito:groups.
  // El JWT se sigue validando por completo (firma, emisor, cliente,
  // expiración y token_use=access). La omisión está aislada aquí.
  if (!config.labMode) {
    throw new HttpError(403, 'forbidden', 'Se requiere pertenecer al grupo admin.');
  }

  // Evitar mostrar la bandera nuevamente después de resolverla.
  const solvedKey = solveKey(config.edition, identity.sub);
  const existingSolve = await store.get(solvedKey.pk, solvedKey.sk);
  if (existingSolve) {
    return {
      statusCode: 200,
      body: {
        challengeId: config.edition,
        message: 'Ya completaste el reto.',
        alreadySolved: true,
      },
    };
  }

  const flag = await getOrCreateFlag(store, config.edition, identity.sub, nowMs);
  return {
    statusCode: 200,
    body: { challengeId: config.edition, flag },
  };
}

async function handleSubmission({ event, store, verifyToken, config, now }) {
  const identity = await authenticate(event, verifyToken, config);
  const data = parseJsonBody(event);
  const nowMs = now();
  const submittedAt = new Date(nowMs).toISOString();

  const candidate = typeof data.flag === 'string' ? data.flag.trim() : '';
  const explanation = typeof data.explanation === 'string' ? data.explanation.trim() : '';

  if (!candidate || candidate.length > MAX_FLAG_LENGTH) {
    throw new HttpError(400, 'invalid_flag', 'Indica una bandera válida.');
  }
  if (explanation.length < MIN_EXPLANATION_LENGTH || explanation.length > MAX_EXPLANATION_LENGTH) {
    throw new HttpError(400, 'invalid_explanation', `La explicación debe tener entre ${MIN_EXPLANATION_LENGTH} y ${MAX_EXPLANATION_LENGTH} caracteres.`);
  }

  const solvedKey = solveKey(config.edition, identity.sub);
  const existingSolve = await store.get(solvedKey.pk, solvedKey.sk);
  if (existingSolve) {
    return {
      statusCode: 200,
      body: {
        correct: true,
        alreadySolved: true,
        message: 'Ya registraste una resolución correcta para este reto.',
      },
    };
  }

  const rate = await getRateState(store, config.edition, identity.sub, nowMs);
  if (rate.blockedUntil > nowMs) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rate.blockedUntil - nowMs) / 1000));
    throw new HttpError(
      429,
      'rate_limited',
      `Demasiados intentos incorrectos. Espera ${retryAfterSeconds} segundos.`,
      { correct: false, retryAfterSeconds },
      { 'retry-after': String(retryAfterSeconds) },
    );
  }

  const expected = await getOrCreateFlag(store, config.edition, identity.sub, nowMs);

  if (flagsEqual(candidate, expected)) {
    const created = await store.putIfAbsent({
      ...solvedKey,
      entity: 'solve',
      userId: identity.sub,
      challengeId: config.edition,
      solvedAt: submittedAt,
    });

    if (!created) {
      return {
        statusCode: 200,
        body: {
          correct: true,
          alreadySolved: true,
          message: 'Ya registraste una resolución correcta para este reto.',
        },
      };
    }

    // Generar código numérico aleatorio de 6 dígitos en el backend
    // (nunca únicamente en React).
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = createHash('sha256').update(code, 'utf8').digest('hex');
    const expiresAt = new Date(nowMs + CODE_TTL_MS).toISOString();

    // Guardar únicamente el hash del código, asociado al usuario y al challenge,
    // con expiración de 10 minutos. No se almacena el código en texto plano.
    await store.put({
      ...codeKey(config.edition, identity.sub),
      entity: 'code',
      userId: identity.sub,
      challengeId: config.edition,
      codeHash,
      expiresAt,
      createdAt: submittedAt,
    });

    await store.put({
      ...submissionKey(identity.sub, submittedAt),
      entity: 'submission',
      userId: identity.sub,
      challengeId: config.edition,
      submittedAt,
      result: 'correct',
      explanation,
    });

    // La pausa ya no aplica. Un fallo al limpiar el contador no invalida
    // la resolución correcta que acaba de registrarse.
    try {
      await store.update(rate.key.pk, rate.key.sk, {
        set: { failures: 0, blockedUntil: 0, updatedAt: submittedAt },
      });
    } catch {
      // Best effort.
    }

    return {
      statusCode: 200,
      body: {
        correct: true,
        alreadySolved: false,
        message: '¡Felicidades! Completaste el reto.',
        code,
        instruction: 'Envía este código al organizador por WhatsApp.',
        expiresIn: CODE_TTL_MS / 1000,
      },
    };
  }

  await store.put({
    ...submissionKey(identity.sub, submittedAt),
    entity: 'submission',
    userId: identity.sub,
    challengeId: config.edition,
    submittedAt,
    result: 'incorrect',
    explanation,
  });

  const updated = await store.update(rate.key.pk, rate.key.sk, {
    add: { failures: 1 },
    set: { lastFailureAt: submittedAt, updatedAt: submittedAt },
  });
  const failures = Number(updated?.failures) || 1;

  if (failures >= MAX_FAILURES) {
    const blockedUntil = nowMs + COOLDOWN_MS;
    await store.update(rate.key.pk, rate.key.sk, {
      set: { failures: 0, blockedUntil, updatedAt: submittedAt },
    });
    throw new HttpError(
      429,
      'rate_limited',
      'Bandera incorrecta. Alcanzaste 3 intentos incorrectos; espera 60 segundos.',
      { correct: false, retryAfterSeconds: COOLDOWN_MS / 1000 },
      { 'retry-after': String(COOLDOWN_MS / 1000) },
    );
  }

  return {
    statusCode: 200,
    body: {
      correct: false,
      message: 'Bandera incorrecta.',
      attemptsRemaining: MAX_FAILURES - failures,
    },
  };
}

export function createHandler({ store, verifyToken, config, now = () => Date.now() }) {
  return async function handler(event) {
    const origin = getHeader(event, 'origin');

    try {
      if (getMethod(event) === 'OPTIONS') {
        return preflight(origin, config);
      }

      if (pathMatches(event, 'GET', '/admin/flag')) {
        const result = await handleAdminFlag({ event, store, verifyToken, config, now });
        return json(result.statusCode, result.body, { origin, config });
      }

      if (pathMatches(event, 'POST', '/submissions')) {
        const result = await handleSubmission({ event, store, verifyToken, config, now });
        return json(result.statusCode, result.body, { origin, config });
      }

      return json(404, { error: 'not_found', message: 'Ruta no encontrada.' }, { origin, config });
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          error.statusCode,
          { error: error.code, message: error.message, ...error.extra },
          { origin, config, extraHeaders: error.headers },
        );
      }

      // Registro mínimo: sin cabeceras, cuerpos, JWT ni banderas.
      console.error('Unhandled API error', {
        name: error?.name,
        requestId: event?.requestContext?.requestId,
      });
      return json(
        500,
        { error: 'internal_error', message: 'No se pudo procesar la solicitud.' },
        { origin, config },
      );
    }
  };
}

export { HttpError };
