# Seguridad del repositorio

Este repositorio contiene código fuente público del frontend (React + Vite) y del backend (Lambda).

**No subas nunca archivos con credenciales reales:**
- `.env`
- `.env.local`
- `.env.*.local`
- `samconfig.toml` (usa solo `samconfig.toml.example` con placeholders)

**El frontend es público:** cualquier persona puede inspeccionar el código JavaScript enviado al navegador. No confíes en el frontend para tomar decisiones de seguridad ni para ocultar banderas, tokens o claves AWS.

Toda la validación crítica (JWT, bandera, código de 6 dígitos, expiración, rate limit) ocurre en el backend de AWS Lambda, no en el navegador.
