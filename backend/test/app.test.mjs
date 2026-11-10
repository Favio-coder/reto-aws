import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/app.mjs';
import { createMemoryStore } from './memory-store.mjs';

const userPoolId = 'us-east-1_wkQY366JQ';
const clientId = '4b5jtn0tvsajtu8jv0j0bgnlla';
const appOrigin = 'http://localhost:5173';

const participantClaims = {
  sub: 'participant-sub',
  token_use: 'access',
  client_id: clientId,
  'cognito:groups': ['participante'],
};

const adminClaims = {
  sub: 'admin-sub',
  token_use: 'access',
  client_id: clientId,
  'cognito:groups': ['admin'],
};

const baseConfig = {
  tableName: 'test-table',
  userPoolId,
  clientId,
  edition: 'test-edition',
  appOrigin,
};

function setup({ labMode = true, store = createMemoryStore() } = {}) {
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  const config = { ...baseConfig, labMode };
  const verifyToken = async token => {
    if (token === 'participant-token') return participantClaims;
    if (token === 'admin-token') return adminClaims;
    if (token === 'id-token') return { ...participantClaims, token_use: 'id' };
    if (token === 'wrong-client') return { ...participantClaims, client_id: 'otro-cliente' };
    throw new Error('invalid token');
  };
  const handler = createHandler({ store, verifyToken, config, now: () => clock });
  return {
    handler,
    store,
    config,
    advance(ms) { clock += ms; },
  };
}

function httpEvent({
  method = 'GET',
  path = '/admin/flag',
  token = 'participant-token',
  body,
  origin = appOrigin,
} = {}) {
  return {
    requestContext: { http: { method, path }, requestId: 'test-request' },
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body === undefined ? {} : {
      body: typeof body === 'string' ? body : JSON.stringify(body),
      isBase64Encoded: false,
    }),
  };
}

function parse(response) {
  return response.body ? JSON.parse(response.body) : null;
}

test('rechaza token ausente, inválido, ID token o de otro cliente', async () => {
  const { handler } = setup();

  for (const token of [null, 'bad-token', 'id-token', 'wrong-client']) {
    const response = await handler(httpEvent({ token }));
    assert.equal(response.statusCode, 401, `token ${token}`);
    assert.ok(['unauthorized', 'invalid_token'].includes(parse(response).error));
  }
});

test('LAB_MODE=true permite al participante obtener su propia bandera', async () => {
  const { handler } = setup({ labMode: true });

  const response = await handler(httpEvent());
  const data = parse(response);
  assert.equal(response.statusCode, 200);
  assert.equal(data.challengeId, 'test-edition');
  assert.match(data.flag, /^FLAG\{[A-Za-z0-9_-]{43}\}$/);

  const adminResponse = await handler(httpEvent({ token: 'admin-token' }));
  assert.notEqual(parse(adminResponse).flag, data.flag);
});

test('LAB_MODE=false rechaza al participante y permite al admin', async () => {
  const { handler } = setup({ labMode: false });

  const participantResponse = await handler(httpEvent());
  assert.equal(participantResponse.statusCode, 403);
  assert.equal(parse(participantResponse).error, 'forbidden');
  assert.equal(parse(participantResponse).flag, undefined);

  const adminResponse = await handler(httpEvent({ token: 'admin-token' }));
  assert.equal(adminResponse.statusCode, 200);
  assert.match(parse(adminResponse).flag, /^FLAG\{/);
});

test('la bandera es estable y la creación condicional resiste concurrencia', async () => {
  const store = createMemoryStore({ delayConditionalPut: true });
  const { handler } = setup({ store });

  const [first, second] = await Promise.all([
    handler(httpEvent()),
    handler(httpEvent()),
  ]);
  const firstFlag = parse(first).flag;
  const secondFlag = parse(second).flag;

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(firstFlag, secondFlag);

  const third = await handler(httpEvent());
  assert.equal(parse(third).flag, firstFlag);
  assert.equal(store.items().filter(item => item.entity === 'flag').length, 1);
});

test('valida bandera y explicación antes de comparar', async () => {
  const { handler } = setup();
  const cases = [
    { body: undefined, code: 'invalid_body' },
    { body: {}, code: 'invalid_flag' },
    { body: { flag: '   ', explanation: 'Explicación válida.' }, code: 'invalid_flag' },
    { body: { flag: `FLAG{${'a'.repeat(300)}}`, explanation: 'Explicación válida.' }, code: 'invalid_flag' },
    { body: { flag: 'FLAG{x}', explanation: 'corta' }, code: 'invalid_explanation' },
    { body: { flag: 'FLAG{x}', explanation: 'x'.repeat(801) }, code: 'invalid_explanation' },
  ];

  for (const { body, code } of cases) {
    const response = await handler(httpEvent({ method: 'POST', path: '/submissions', body }));
    assert.equal(response.statusCode, 400, code);
    assert.equal(parse(response).error, code);
  }
});

test('la entrega correcta usa el sub del JWT y no duplica la resolución', async () => {
  const { handler, store } = setup();
  const flag = parse(await handler(httpEvent())).flag;

  const submission = {
    flag,
    explanation: 'La obtuve consultando la API con mi propia sesión.',
    userId: 'admin-sub',
    sub: 'admin-sub',
  };

  const first = await handler(httpEvent({ method: 'POST', path: '/submissions', body: submission }));
  const firstData = parse(first);
  assert.equal(first.statusCode, 200);
  assert.equal(firstData.correct, true);
  assert.equal(firstData.alreadySolved, false);

  let submissions = store.items().filter(item => item.entity === 'submission');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].userId, participantClaims.sub);
  assert.equal(submissions[0].result, 'correct');
  assert.equal(submissions[0].challengeId, 'test-edition');
  assert.match(submissions[0].submittedAt, /^\d{4}-\d{2}-\d{2}T/);

  const second = await handler(httpEvent({ method: 'POST', path: '/submissions', body: submission }));
  const secondData = parse(second);
  assert.equal(second.statusCode, 200);
  assert.equal(secondData.correct, true);
  assert.equal(secondData.alreadySolved, true);

  submissions = store.items().filter(item => item.entity === 'submission');
  assert.equal(submissions.length, 1);
});

test('dos entregas correctas concurrentes registran una sola resolución', async () => {
  const store = createMemoryStore({ delayConditionalPut: true });
  const { handler } = setup({ store });
  const flag = parse(await handler(httpEvent())).flag;

  const submit = () => handler(httpEvent({
    method: 'POST',
    path: '/submissions',
    body: { flag, explanation: 'Resolución concurrente para probar el duplicado.' },
  }));

  const [first, second] = await Promise.all([submit(), submit()]);
  const results = [parse(first), parse(second)];

  assert.ok(results.every(result => result.correct === true));
  assert.equal(results.filter(result => result.alreadySolved === false).length, 1);
  assert.equal(results.filter(result => result.alreadySolved === true).length, 1);
  assert.equal(store.items().filter(item => item.entity === 'submission').length, 1);
});

test('una bandera incorrecta no revela la esperada y registra el intento', async () => {
  const { handler, store } = setup();
  const expected = parse(await handler(httpEvent())).flag;

  const response = await handler(httpEvent({
    method: 'POST',
    path: '/submissions',
    body: { flag: 'FLAG{incorrecta}', explanation: 'Intento de prueba controlado.' },
  }));
  const data = parse(response);

  assert.equal(response.statusCode, 200);
  assert.equal(data.correct, false);
  assert.equal(data.attemptsRemaining, 2);
  assert.equal(JSON.stringify(data).includes(expected), false);

  const submissions = store.items().filter(item => item.entity === 'submission');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].result, 'incorrect');
  assert.equal(submissions[0].userId, participantClaims.sub);
});

test('tres fallos aplican una pausa de 60 s por usuario y el vencimiento se comprueba en código', async () => {
  const { handler, advance } = setup();
  const wrong = number => handler(httpEvent({
    method: 'POST',
    path: '/submissions',
    body: { flag: `FLAG{fallo-${number}}`, explanation: 'Explicación de intento incorrecto.' },
  }));

  const first = await wrong(1);
  assert.equal(first.statusCode, 200);
  assert.equal(parse(first).attemptsRemaining, 2);

  const second = await wrong(2);
  assert.equal(second.statusCode, 200);
  assert.equal(parse(second).attemptsRemaining, 1);

  const third = await wrong(3);
  assert.equal(third.statusCode, 429);
  assert.equal(parse(third).retryAfterSeconds, 60);

  const blocked = await wrong(4);
  assert.equal(blocked.statusCode, 429);
  assert.ok(parse(blocked).retryAfterSeconds > 0);

  // Otro usuario no queda bloqueado por la IP ni por el usuario anterior.
  const otherUser = await handler(httpEvent({
    method: 'POST',
    path: '/submissions',
    token: 'admin-token',
    body: { flag: 'FLAG{otro-usuario}', explanation: 'Intento de otro usuario.' },
  }));
  assert.equal(otherUser.statusCode, 200);

  advance(60_001);
  const afterCooldown = await wrong(5);
  assert.equal(afterCooldown.statusCode, 200);
  assert.equal(parse(afterCooldown).attemptsRemaining, 2);
});

test('LAB_MODE solo cambia GET /admin/flag; POST /submissions sigue disponible para participantes', async () => {
  const store = createMemoryStore();
  const labHandler = setup({ labMode: true, store }).handler;
  const protectedHandler = setup({ labMode: false, store }).handler;

  // La bandera del participante se obtiene en modo laboratorio y luego se
  // entrega con LAB_MODE=false: la ruta de entregas no depende del modo.
  const flag = parse(await labHandler(httpEvent())).flag;

  const submission = await protectedHandler(httpEvent({
    method: 'POST',
    path: '/submissions',
    body: { flag, explanation: 'Bandera obtenida durante la práctica.' },
  }));
  assert.equal(submission.statusCode, 200);
  assert.equal(parse(submission).correct, true);
});

test('CORS solo autoriza el origen configurado', async () => {
  const { handler } = setup();

  const allowed = await handler(httpEvent({ method: 'OPTIONS', token: null }));
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers['access-control-allow-origin'], appOrigin);

  const denied = await handler(httpEvent({ method: 'OPTIONS', token: null, origin: 'https://evil.example' }));
  assert.equal(denied.statusCode, 204);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('las rutas desconocidas devuelven 404', async () => {
  const { handler } = setup();
  const response = await handler(httpEvent({ method: 'GET', path: '/otra' }));
  assert.equal(response.statusCode, 404);
});
