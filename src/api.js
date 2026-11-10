const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', retryAfterSeconds = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function endpoint(path) {
  if (!apiBaseUrl) {
    throw new ApiError(
      'La API del laboratorio no está configurada. Define VITE_API_URL con la URL del HTTP API desplegado.',
      { code: 'api_not_configured' },
    );
  }
  return `${apiBaseUrl}${path}`;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function request(path, { token, method = 'GET', body } = {}) {
  if (!token) {
    throw new ApiError('No hay un access token válido. Inicia sesión nuevamente.', {
      status: 401,
      code: 'missing_token',
    });
  }
  const url = endpoint(path);
  let response;
  try {
    response = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('No se pudo conectar con la API del laboratorio. Revisa VITE_API_URL y la red.', {
      code: 'network_error',
    });
  }

  const data = await readJson(response);
  if (!response.ok) {
    const retryAfter = Number(data.retryAfterSeconds || response.headers.get('retry-after') || 0);
    throw new ApiError(
      typeof data.message === 'string' && data.message
        ? data.message
        : 'La API rechazó la solicitud.',
      {
        status: response.status,
        code: typeof data.error === 'string' ? data.error : '',
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 0,
      },
    );
  }
  return data;
}

export function getAdminFlag(token) {
  return request('/admin/flag', { token });
}

export function submitFlag({ token, flag, explanation }) {
  return request('/submissions', {
    token,
    method: 'POST',
    body: { flag, explanation },
  });
}
