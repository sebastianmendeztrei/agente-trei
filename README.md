# Asistente BI — Paso 1: Scaffold

Estructura base del proyecto Next.js + TypeScript + Tailwind. El endpoint de
chat (`src/app/api/chat/route.ts`) es un stub — se implementa en el Paso 2
(tool calling con OpenAI + conexión segura a Supabase).

## Estructura

```
src/
  app/
    layout.tsx        # layout raíz
    page.tsx           # UI del chat (placeholder por ahora)
    globals.css         # Tailwind
    api/
      chat/route.ts      # API Route — único punto con acceso a las keys
  lib/                  # (Paso 2) validador de SQL, cliente Supabase, tools
```

## Cómo correrlo localmente

1. Instala dependencias:
   ```
   npm install
   ```
2. Copia el archivo de variables de entorno:
   ```
   cp .env.local.example .env.local
   ```
3. Completa `.env.local` con tu API key de OpenAI (revocada/nueva, nunca la
   compartida antes en texto plano) y tus credenciales de Supabase.
4. Corre el servidor de desarrollo:
   ```
   npm run dev
   ```
5. Abre http://localhost:3000

## Seguridad — reglas que se mantienen en todo el proyecto

- `SUPABASE_SERVICE_ROLE_KEY` y `OPENAI_API_KEY` solo existen en el servidor
  (API Routes), nunca en componentes de cliente ni en el bundle del navegador.
- El modelo de IA nunca ejecuta SQL directamente: solo puede pedir una "tool
  call", que el backend valida (solo SELECT, sin sentencias de escritura,
  con LIMIT obligatorio) antes de correrla.
- `.env.local` está en `.gitignore` — nunca se sube al repositorio.

## Próximos pasos

- Paso 2: definir el esquema de tools (get_schema, query_table, run_select)
  y el loop de tool calling en `src/app/api/chat/route.ts`.
- Paso 3: UI del chat en `src/app/page.tsx`.
- Paso 4: validador de SQL en `src/lib/sql-guard.ts`.
- Paso 5: despliegue en Vercel.

## Deploy en Cloudflare Workers (OpenNext)

Este proyecto usa el adaptador `@opennextjs/cloudflare` porque Cloudflare
ejecuta Next.js sobre Workers (runtime `workerd`), no como Node tradicional.

### Opción A — deploy manual desde tu máquina

```
npm install
npx wrangler login
npm run deploy
```

`wrangler login` abre el navegador para autenticarte con tu cuenta de
Cloudflare — nunca pegues tokens de Cloudflare en el chat.

Antes de desplegar, carga tus variables de entorno como *secrets* de
Cloudflare (no van en `wrangler.jsonc`):

```
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

### Opción B — CI/CD automático conectando el repo de Git

1. Sube este código a tu repo: `https://github.com/sebastianmendeztrei/agente-trei.git`
2. En el dashboard de Cloudflare: Workers & Pages → Create → conecta ese
   repositorio.
3. Configura las variables/secrets de entorno en la sección "Build
   variables and secrets" del proyecto.
4. Cada `git push` a la rama principal dispara un build y deploy
   automático (Workers Builds).
