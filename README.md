# Reto Ciber CTF — Frontend

Frontend en React + Vite con autenticación de Amazon Cognito (OIDC Authorization Code + PKCE) y registro público mediante Cognito Hosted UI / Managed Login.

## Despliegue en Vercel

1. Crea una copia de `.env.example` llamada `.env.local`.
2. Rellena todas las variables `VITE_COGNITO_*` y `VITE_API_URL` con tus propios valores.
3. Conecta este repositorio a Vercel.
4. Vercel detectará Vite y desplegará automáticamente la carpeta `dist/`.

## Backend

El backend (Lambda + API Gateway + DynamoDB) se despliega por separado en AWS con SAM o CloudFormation. Este repositorio solo contiene el frontend listo para Vercel.

## Registro público de participantes

El registro se hace exclusivamente a través de Cognito Hosted UI / Managed Login. **No hay formulario de registro propio en React.**

### Pasos para configurar Cognito

1. En **Amazon Cognito > User Pools > tu pool > App integration > App client**, configura tu cliente de aplicación:
   - Habilita **Authorization code grant** con PKCE.
   - Scopes: `openid`, `email`.
   - No habilites client secret (cliente SPA público).
2. En **App integration > Domain**, configura el dominio de Cognito (por ejemplo `https://tu-dominio.auth.us-east-1.amazoncognito.com`).
3. En **Login pages**, registra:
   - **Permitido callback URLs**: `http://localhost:5173/callback` (y tu dominio de producción en Vercel).
   - **Allowed sign-out URLs**: `http://localhost:5173/` (y tu dominio de producción).
4. Habilita **auto-verify** para el atributo `email` en el User Pool, para que Cognito envíe un código de confirmación al correo tras el registro.
5. Crea los grupos `admin` y `participante` en el User Pool y asigna usuarios manualmente. El frontend **nunca** agrega usuarios al grupo admin.

### Variables de entorno (`.env.local`)

Copia `.env.example` a `.env.local` y rellena:

```text
VITE_COGNITO_REGION=us-east-1
VITE_COGNITO_USER_POOL_ID=us-east-1_TU_POOL_ID
VITE_COGNITO_CLIENT_ID=tu_client_id
VITE_COGNITO_DOMAIN=https://tu-dominio.auth.us-east-1.amazoncognito.com
VITE_COGNITO_REDIRECT_URI=http://localhost:5173/callback
VITE_COGNITO_LOGOUT_URI=http://localhost:5173/
VITE_API_URL=https://tu-api-id.execute-api.us-east-1.amazonaws.com/prod
```

### Flujo de registro

1. El usuario hace clic en **Crear cuenta** en la página de bienvenida.
2. Se redirige a Cognito Hosted UI con `action=REGISTER`.
3. El usuario se registra con su correo y contraseña.
4. Cognito envía un código de confirmación al correo. El usuario debe hacer clic en el enlace de confirmación antes de poder iniciar sesión.
5. Tras confirmar, el usuario puede iniciar sesión con Cognito.
6. Todo usuario que no pertenezca al grupo `admin` se trata como **participante**.
7. El frontend **nunca** concede el rol admin; la autorización real ocurre en Lambda.

### Correo no confirmado

Si el usuario inició sesión pero aún no ha confirmado su correo, se muestra un mensaje claro:

> Antes de participar, confirma tu cuenta. Revisa tu bandeja de entrada (y correo no deseado) y haz clic en el enlace de confirmación que te envió Amazon Cognito.

Mientras no confirme, no puede acceder al reto (ni como admin ni como participante).

## Seguridad

- Nunca commitees `.env`, `.env.local` ni `.env.*.local`.
- No pongas claves AWS, client secrets, contraseñas, tokens ni banderas en variables `VITE_*`.
- El código del frontend es público: un participante puede inspeccionarlo. No confíes en el frontend para tomar decisiones de seguridad.
- Toda la validación crítica (JWT, bandera, código de 6 dígitos, expiración, rate limit) ocurre en el backend de AWS Lambda, no en el navegador.
