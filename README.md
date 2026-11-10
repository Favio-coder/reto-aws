# Reto Ciber — React + Cognito + API Gateway/Lambda

Laboratorio CTF educativo con dos vistas:

- **admin** (`cognito:groups` contiene `admin`): panel con la bandera propia y botón para copiarla.
- **participante** (cualquier usuario sin `admin`): instrucciones y formulario para entregar la bandera. La bandera no se muestra automáticamente.

El frontend está en React + Vite + `oidc-client-ts`. El backend es API Gateway HTTP API + Lambda en JavaScript, con DynamoDB. La vulnerabilidad didáctica está aislada en `GET /admin/flag` y solo se activa con `LAB_MODE=true`.

> Este repositorio contiene el código y la plantilla de despliegue. **No se ha desplegado nada en AWS desde este entorno.** Los pasos que requieren consola, credenciales o AWS CLI quedan indicados como pendientes.

## 1. Arquitectura

```text
Navegador (React/Vite)
  ├─ OIDC Authorization Code + PKCE ──> Cognito Hosted UI
  └─ Authorization: Bearer <access token>
          │
          ▼
API Gateway HTTP API (prod)
  ├─ GET  /admin/flag
  ├─ POST /submissions
  └─ OPTIONS (preflight CORS)
          │
          ▼
Lambda Node.js 22 (ESM)
  ├─ valida JWT con aws-jwt-verify
  ├─ lee/escribe DynamoDB
  └─ aplica la omisión educativa solo si LAB_MODE=true
          │
          ▼
DynamoDB (on-demand, una tabla)
```

Sin EC2, NAT Gateway, RDS ni WAF. Los logs tienen retención de 7 días y el HTTP API tiene throttling. Eso reduce el consumo, pero **no es un tope monetario garantizado**; configura AWS Budgets.

## 2. Código y archivos

| Archivo | Función |
|---|---|
| `src/auth.js` | Configuración OIDC, login y logout corregido |
| `src/logoutUrl.js` | Construcción pura de la URL `/logout` de Cognito |
| `src/roles.js` | Rol derivado solo de `cognito:groups` |
| `src/api.js` | Llamadas a `GET /admin/flag` y `POST /submissions` |
| `src/App.jsx` | Vistas de administrador y participante |
| `src/styles.css` | Diseño existente, ampliado para paneles y formulario |
| `backend/src/index.mjs` | Entrada Lambda: verifier + DynamoDB + handler |
| `backend/src/app.mjs` | Rutas, validación JWT, flag, entregas y rate limit |
| `backend/src/flags.mjs` | Generación y comparación de banderas |
| `backend/src/store.mjs` | Acceso a DynamoDB con creación condicional |
| `backend/src/config.mjs` | Variables de entorno |
| `template.yaml` | SAM: HTTP API, Lambda, DynamoDB, IAM y logs |
| `backend/test/` | Pruebas locales del backend y del verificador JWT |

## 3. Configuración de Cognito

Región: `us-east-1`

| Dato | Valor |
|---|---|
| User Pool ID | `us-east-1_wkQY366JQ` |
| Client ID | `4b5jtn0tvsajtu8jv0j0bgnlla` |
| Dominio | `https://us-east-1wkqy366jq.auth.us-east-1.amazoncognito.com` |
| Callback | `http://localhost:5173/callback` |
| Salida | `http://localhost:5173/` |

En **Cognito > User pools > tu pool > Applications > App clients > tu cliente > Login pages > Edit**:

1. Callback permitido: `http://localhost:5173/callback`
2. **Allowed sign-out URLs**: `http://localhost:5173/`
3. OAuth grant: Authorization code grant.
4. Scopes: `openid`, `email`.
5. Cliente SPA público, sin client secret.
6. Dominio de Cognito configurado y Hosted UI/Managed login habilitado.

Crea los grupos `admin` y `participante` y asigna cada usuario a uno. Un usuario sin `admin` se trata como participante.

La vista se elige con `cognito:groups`, pero la interfaz no es la frontera de seguridad. Manipular `sessionStorage`, el HTML o el estado de React para mostrar el panel de administrador no cambia el access token firmado: la Lambda valida el token y, con `LAB_MODE=false`, responde `403` si el usuario no pertenece a `admin`.

### Logout: qué registrar exactamente

El código construye esta URL (puedes comprobarla con `npm test`):

```text
https://us-east-1wkqy366jq.auth.us-east-1.amazoncognito.com/logout?client_id=4b5jtn0tvsajtu8jv0j0bgnlla&logout_uri=http%3A%2F%2Flocalhost%3A5173%2F
```

Registra exactamente, con barra final:

```text
http://localhost:5173/
```

No registres `http://localhost:5173` sin barra, `http://localhost:5173/callback`, comodines ni una URL con otro puerto. Cognito compara el valor de `logout_uri` contra esa lista. Si no coincide, muestra **“Invalid request. Please check your input and try again”**.

El logout:

1. Borra el usuario de `sessionStorage` con `userManager.removeUser()`.
2. Limpia el estado de React antes de navegar.
3. Navega a `/logout` con `client_id` y `logout_uri` codificados.

No se usa `userManager.signoutRedirect()` porque esa API envía `post_logout_redirect_uri`, que no es el parámetro que Cognito espera en `/logout`. Tampoco se envía `redirect_uri`.

En producción, reemplaza `http://localhost:5173` por tu origen HTTPS en `redirect_uri`, `logoutUri`, `AppOrigin` y `VITE_API_URL`, y registra esas URLs exactas en Cognito. El hosting debe servir `index.html` también para `/callback`.

**Importante:** corregir `src/auth.js` no corrige la configuración de AWS. Si `http://localhost:5173/` no está en Allowed sign-out URLs, Cognito seguirá mostrando el error. La SPA no puede ocultar ni detectar ese error porque la navegación sale de la aplicación. El cierre local sí se completa antes de navegar; el cierre remoto depende de Cognito. Si Cognito muestra “Invalid request”, la cookie de sesión de Cognito no se habrá limpiado, aunque `sessionStorage` local sí. Los JWT ya emitidos no se revocan de inmediato: conservan su expiración.

## 4. Ejecutar el frontend

```powershell
npm ci
npm run dev
```

Abre `http://localhost:5173/` (no uses `127.0.0.1` ni cambies el puerto).

Crea `.env.local` a partir de `.env.example` cuando tengas el HTTP API desplegado:

```text
VITE_API_URL=https://TU-API-ID.execute-api.us-east-1.amazonaws.com/prod
```

`VITE_API_URL` es pública y no es un secreto. **Nunca** pongas banderas, tokens, contraseñas ni claves AWS en variables `VITE_*` ni en archivos públicos.

## 5. Desplegar el backend en AWS

Requisitos: AWS CLI v2 configurado, AWS SAM CLI y Node.js 22.12+.

```powershell
cd backend
npm ci
cd ..
sam build
sam deploy --guided
```

Parámetros recomendados:

| Parámetro | Valor |
|---|---|
| `UserPoolId` | `us-east-1_wkQY366JQ` |
| `ClientId` | `4b5jtn0tvsajtu8jv0j0bgnlla` |
| `AppOrigin` | `http://localhost:5173` |
| `LabMode` | `true` para el ejercicio, `false` para exigir admin |
| `ChallengeId` | `reto-ciber-2026` (o el identificador de tu edición) |

También puedes copiar `samconfig.toml.example` a `samconfig.toml` y ejecutar `sam deploy`. El stack no requiere secretos ni un bucket propio: SAM resuelve el artefacto S3.

> **Estado de esta entrega:** en este entorno no se ejecutó `sam build`, `sam validate` ni `sam deploy` porque SAM CLI no está instalado y no hay acceso a AWS. La plantilla se comprobó como YAML, pero la validación y el despliegue reales quedan pendientes. Si `ReservedConcurrentExecutions: 5` falla por el límite de concurrencia de la cuenta, usa `1` o elimina esa propiedad.

Al terminar, la salida `ApiUrl` se usa como `VITE_API_URL`. La plantilla crea:

- HTTP API con stage `prod`.
- Lambda Node.js 22, 256 MB, timeout 10 s, concurrencia reservada 5.
- DynamoDB on-demand con cifrado en reposo.
- IAM limitado a `GetItem`, `PutItem` y `UpdateItem` sobre la tabla.
- Logs de API y Lambda con retención de 7 días.
- Throttling de 5 solicitudes/s y burst 10.

### Cambiar entre modo laboratorio y modo protegido

```powershell
sam deploy --parameter-overrides `
  UserPoolId=us-east-1_wkQY366JQ `
  ClientId=4b5jtn0tvsajtu8jv0j0bgnlla `
  AppOrigin=http://localhost:5173 `
  LabMode=false `
  ChallengeId=reto-ciber-2026
```

`LAB_MODE` se lee como el string exacto `true`. Cualquier otro valor, incluido `false`, exige el grupo `admin` en `GET /admin/flag`.

## 6. API

Todas las rutas autenticadas esperan:

```text
Authorization: Bearer <access token de Cognito>
```

El token se valida en la Lambda con `aws-jwt-verify`:

- Firma RS256 contra el JWKS del User Pool.
- Emisor `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wkQY366JQ`.
- `client_id` del cliente `4b5jtn0tvsajtu8jv0j0bgnlla`.
- Expiración.
- `token_use=access`.

Además se comprueba que exista `sub` y que `client_id` coincida. No se aceptan ID tokens ni tokens manipulados. No hay autenticación en `OPTIONS` (preflight CORS); `GET` y `POST` siempre la exigen.

### `GET /admin/flag`

- `LAB_MODE=true`: cualquier access token válido puede leer **su propia** bandera. Es la vulnerabilidad educativa deliberada.
- `LAB_MODE=false`: exige `cognito:groups` con `admin`; si no, `403`.
- Respuesta: `{ "challengeId": "...", "flag": "FLAG{...}" }`.

### `POST /submissions`

Cuerpo:

```json
{
  "flag": "FLAG{...}",
  "explanation": "Explicación breve de cómo la obtuve."
}
```

- El usuario se obtiene del `sub` del JWT validado. Cualquier campo `userId`, `sub` o correo enviado en el cuerpo se ignora.
- `flag`: 1–200 caracteres; `explanation`: 10–800 caracteres.
- Compara en el servidor y nunca devuelve la bandera esperada cuando la respuesta es incorrecta.
- Guarda en DynamoDB: usuario, reto, fecha, resultado y explicación.
- Evita duplicar una resolución correcta mediante una creación condicional de `SOLVE#<edición>/USER#<sub>`.
- Tras 3 entregas incorrectas aplica una pausa de 60 s **por usuario** (`sub`), no por IP. El vencimiento se comprueba en el código consultando `blockedUntil`; no se depende de TTL de DynamoDB.

Respuestas habituales:

```json
{ "correct": true, "alreadySolved": false, "message": "Bandera correcta..." }
{ "correct": false, "attemptsRemaining": 2, "message": "Bandera incorrecta." }
{ "error": "rate_limited", "retryAfterSeconds": 60, "correct": false }
```

## 7. Bandera y persistencia

- Se generan 32 bytes con `crypto.randomBytes` y se codifican en base64url: `FLAG{...}`.
- La clave es `FLAG#<ChallengeId>` / `USER#<sub>`: una bandera por usuario y edición.
- La primera solicitud usa `PutItem` con `ConditionExpression: attribute_not_exists(pk)`. Si dos solicitudes concurrentes intentan crearla, solo una gana; la otra vuelve a leer el valor estable.
- No se genera una bandera nueva en cada recarga. No está en React, en variables `VITE_*` ni en archivos públicos.
- Obtener la bandera no modifica grupos de Cognito ni concede permisos IAM. La Lambda no llama a Cognito ni a IAM.

Tabla DynamoDB:

| `pk` | `sk` | Contenido |
|---|---|---|
| `FLAG#<edición>` | `USER#<sub>` | Bandera estable |
| `SOLVE#<edición>` | `USER#<sub>` | Resolución correcta única |
| `RATE#<edición>` | `USER#<sub>` | Fallos y `blockedUntil` |
| `USER#<sub>` | `SUB#<fecha>#<uuid>` | Registro de cada entrega |

## 8. Vulnerabilidad educativa (solo para el organizador)

> Este README contiene la explicación del reto. No lo distribuyas a los participantes.

**Nombre:** control de acceso roto a nivel de función (BFLA) / omisión de autorización por grupo.

**Mecánica intencional:** con `LAB_MODE=true`, `GET /admin/flag` valida completamente el JWT, pero omite a propósito la comprobación de `cognito:groups`. Un participante puede reutilizar **su propio access token válido** para leer **su propia** bandera y luego entregarla en `POST /submissions`.

**Qué no se relaja:**

- La firma, el emisor, el cliente, la expiración y `token_use=access` se siguen verificando.
- No se aceptan tokens alterados ni se omite la autenticación.
- Solo esa ruta contiene la omisión. `POST /submissions` no depende de `admin`. Si agregas otras operaciones administrativas, deben comprobar `admin` en el servidor.
- La bandera obtenida no cambia grupos de Cognito ni permisos IAM.

**Cómo cerrarla:** desplegar con `LabMode=false` (o cambiar `LAB_MODE` a `false` en la Lambda). En ese modo, un participante recibe `403` en `GET /admin/flag`.

La pantalla del participante no explica la ruta ni el token a reutilizar; solo invita a investigar la API. La vista de administrador sí muestra la ruta porque está destinada al organizador. No uses `LAB_MODE=true` en un entorno real.

## 9. Pruebas realizadas localmente

Ejecutadas en este entorno:

```text
npm test                 # 3 pruebas del frontend puro: URL de logout y roles
npm run build            # compilación de Vite correcta
cd backend && npm test   # 20 pruebas del backend
```

Cobertura local:

- URL de logout con `/logout`, `client_id`, `logout_uri` codificado y sin `redirect_uri`/`post_logout_redirect_uri`.
- Rol derivado solo de `cognito:groups`; un correo con “admin” no concede el rol.
- Verificación criptográfica real con claves RS256 locales y JWKS en memoria usando `aws-jwt-verify`: acepta un access token válido y rechaza ID token, cliente distinto, emisor distinto, token vencido, `token_use` incorrecto, firma manipulada y JWT mal formado.
- Handler con almacén en memoria (simula DynamoDB): participante obtiene su bandera con `LAB_MODE=true`; `403` con `LAB_MODE=false`; admin permitido; bandera estable y concurrente; validación del formulario; entrega correcta sin duplicados, incluso con dos entregas concurrentes; respuesta incorrecta sin revelar la bandera; pausa de 60 s por usuario; otro usuario no queda bloqueado; CORS.
- `npm run build` demuestra que JSX y módulos compilan, no que el login real funcione.

**Comprobado contra AWS (solo lectura):** el endpoint JWKS público del pool `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wkQY366JQ/.well-known/jwks.json` respondió `200` con 2 claves RS256. Eso confirma el emisor/JWKS configurado, no un login real. La llamada sin sesión a `/logout` devolvió `302` hacia `/login`, por lo que no permite confirmar la lista de Allowed sign-out URLs; para eso hace falta una sesión real.

**No verificado realmente en AWS:** despliegue SAM, API Gateway, DynamoDB real, login/logout con una sesión de Cognito, CORS del navegador y las dos vistas con una sesión real. Esas comprobaciones requieren credenciales y la configuración de Cognito.

### Comprobaciones manuales pendientes en AWS

1. Registrar `http://localhost:5173/` en **Allowed sign-out URLs**.
2. Confirmar `http://localhost:5173/callback` en callback URLs.
3. Crear los grupos `admin` y `participante`, y asignar usuarios.
4. Desplegar el stack y anotar `ApiUrl`.
5. Crear `.env.local` con `VITE_API_URL` y reiniciar Vite.
6. Probar login, logout, vista admin y vista participante.
7. Probar `GET /admin/flag` con un access token de participante en `LAB_MODE=true` (200) y en `LAB_MODE=false` (403).
8. Probar `POST /submissions` con bandera incorrecta, correcta, duplicada y tras 3 fallos.
9. Comprobar que las dos llamadas a `GET /admin/flag` devuelven la misma bandera.
10. Configurar AWS Budgets y una alarma de costos.

Puedes usar `curl` con una variable de entorno, sin pegar tokens en el historial ni en capturas:

```powershell
$env:API_URL = "https://TU-API-ID.execute-api.us-east-1.amazonaws.com/prod"
$env:ACCESS_TOKEN = "<access token>"
curl.exe -i "$env:API_URL/admin/flag" -H "Authorization: Bearer $env:ACCESS_TOKEN"
curl.exe -i "$env:API_URL/admin/flag" -H "Authorization: Bearer token-invalido"
```

## 10. Costos y límites

La arquitectura usa servicios gestionados de bajo consumo:

- Cognito: autenticaciones según el plan del User Pool.
- HTTP API: solicitudes y transferencia.
- Lambda: invocaciones y GB-s; concurrencia reservada 5.
- DynamoDB: capacidad on-demand y almacenamiento.
- CloudWatch Logs: retención 7 días.

Límites configurados: throttling 5 rps / burst 10, concurrencia 5, cuerpo máximo 8 KB, explicación máxima 800 caracteres, logs 7 días. **Ninguno garantiza un gasto máximo.** Configura un presupuesto y alarmas en AWS Budgets, y elimina el stack cuando termine el laboratorio. La tabla se elimina con el stack (`DeletionPolicy: Delete`).

No hay WAF, NAT Gateway, EC2 ni RDS.

## 11. Solución de problemas

| Error | Revisión |
|---|---|
| Cognito: “Invalid request” al salir | Registrar exactamente `http://localhost:5173/` en Allowed sign-out URLs; verificar dominio, client ID y barra final |
| `redirect_mismatch` | Callback exacto `http://localhost:5173/callback` |
| `invalid_scope` | Habilitar `openid` y `email` |
| `invalid_client` | Client ID correcto, mismo pool, cliente SPA sin secreto |
| `401` en la API | Access token ausente, vencido, de otro cliente, ID token o firma inválida |
| `403` en `/admin/flag` | `LAB_MODE=false` y el usuario no pertenece a `admin` |
| Error CORS | `AppOrigin` debe coincidir exactamente con el origen del navegador, sin barra final |
| “La API del laboratorio no está configurada” | Falta `VITE_API_URL` en `.env.local`; reinicia Vite |
| La API no responde | Revisa la URL de `ApiUrl`, el stage `prod` y los logs de API Gateway |
| No regresa al cerrar sesión | La URL de salida no está registrada en Cognito; no es un problema de React |
| Puerto 5173 ocupado | Detén el otro servidor con Ctrl+C |

## 12. Referencias

- `oidc-client-ts`: https://authts.github.io/oidc-client-ts/
- Logout de Cognito: https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html
- Clientes de aplicación Cognito: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html
- `aws-jwt-verify`: https://github.com/awslabs/aws-jwt-verify
- AWS SAM: https://docs.aws.amazon.com/serverless-application-model/
- HTTP API CORS: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html
