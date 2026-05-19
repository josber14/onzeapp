@MEMORY.md

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ONZE / ZINPLE — Project Context

## Stack
- **Next.js 16.2.1** (App Router) + **React 19** + **TypeScript**
- **Prisma 7.5** + PostgreSQL (NeonDB)
- **Tailwind CSS v4**, ESLint 9
- Auth: sesiones custom HMAC-SHA256 (cookie `onze_session`)
- Deploy: Vercel (primario) / Netlify

## Estructura clave
- `app/` — rutas y API handlers
- `components/` — componentes React
- `lib/` — utilidades compartidas (prisma, session, resend)
- `prisma/schema.prisma` — esquema DB (23 modelos)
- `public/onze-panel.html` — panel operativo (iframe)
- `scripts/` — utilidades CLI (rate lists, sync binance)

## Reglas al escribir código
1. Toda query relevante debe filtrar por `tenantId` (multi-tenant)
2. API routes: export named functions (`GET`, `POST`, `PATCH`, `DELETE`)
3. Errores: `NextResponse.json({ error: "mensaje" }, { status: xxx })`
4. Auth en API: validar sesión manualmente en cada handler
5. Validar con schemas antes de escribir DB
6. Preferir Server Components cuando sea posible
7. No exponer secrets ni datos sensibles en logs o respuestas
