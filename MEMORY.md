# MEMORY — ONZE / ZINPLE

> Bitácora viva del proyecto. Actualizar después de cada cambio significativo.

---

## Descripción del proyecto

Plataforma multi-tenant para operadores de cambio de divisas y remesas. Marca comercial: **ZINPLE**. Desarrollada por ZINPLE SpA (RUT 77.570.383-0), Santiago, Chile.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16.2.1 (App Router) |
| Lenguaje | TypeScript strict |
| UI | React 19 + Tailwind CSS v4 |
| DB | PostgreSQL (NeonDB serverless) |
| ORM | Prisma v7.5 (adapter pg) |
| Auth | Sesiones custom HMAC-SHA256 (no next-auth) |
| Email | Resend |
| Deploy | Vercel (primario) + Netlify |

---

## Arquitectura clave

- **App Router** con Server/Client Components
- **Rutas API** en `app/api/**/route.ts`
- **Middleware** en `app/middleware.ts` — verifica cookie `onze_session`
- **Panel principal** es un iframe (`/dashboard` embebe `public/onze-panel.html`)
- **Multi-tenant**: datos scoped por `tenantId`
- **Roles**: `super_admin_global` > `super_admin_cliente` > `operador`

---

## Features implementadas

- [x] Auth completo (login, register, logout, forgot/reset password)
- [x] Admin: CRUD usuarios y tenants
- [x] Admin: settings por tenant (invite code, whatsapp, sheet URL)
- [x] Dashboard con panel embebido
- [x] Operaciones CRUD (cambio de divisas)
- [x] Países y pares de divisas
- [x] Capital inicial por país
- [x] Gastos por país/categoría
- [x] Listas de Tasa del Día (rate lists + pares + templates)
- [x] Generación de imágenes de tasa del día
- [x] Integración Binance P2P (credenciales, órdenes, capacity)
- [x] Movimientos de balance y auditoría
- [x] Alertas de liquidez
- [x] Fondeo interno entre países
- [x] Earnings y pagos a colaboradores
- [x] Export/import de rate lists vía scripts

---

## Próximos pasos / Pendientes

- [ ] Módulo KYC completo
- [ ] Panel de reporting / analytics
- [ ] Notificaciones en tiempo real
- [ ] Onboarding multi-paso para nuevos tenants
- [ ] Tests automatizados
- [ ] Documentación de API para integraciones externas

---

## Decisiones arquitectónicas (ADR)

### ADR-001: Sesiones custom vs next-auth
**Fecha**: Inicio del proyecto
**Decisión**: Se implementó autenticación propia con HMAC-SHA256 en cookies httpOnly.
**Motivo**: Control total sobre el payload de sesión y evitar dependencia pesada.
**Consecuencias**: No usar next-auth a pesar de estar en package.json.

### ADR-002: Panel principal como iframe estático
**Fecha**: Inicio del proyecto
**Decisión**: El dashboard operativo es un HTML estático (`public/onze-panel.html`) embebido via iframe.
**Motivo**: El panel de operaciones existía antes que el proyecto Next.js; se reutilizó como standalone.
**Consecuencias**: La comunicación con el panel es vía URL params (sesión, tenant).

### ADR-003: Multi-tenant con Tenant model
**Fecha**: Inicio del proyecto
**Decisión**: Cada cliente es un `Tenant`. Usuarios pertenecen a un tenant via `tenantId`.
**Motivo**: Aislamiento de datos entre clientes (requisito de negocio).
**Consecuencias**: Toda query relevante debe filtrar por `tenantId`.

---

## Convenciones de código

- **Nombres de archivo**: `kebab-case` para rutas, `PascalCase` para componentes
- **API routes**: export named functions (`GET`, `POST`, `PATCH`, `PUT`, `DELETE`)
- **Prisma**: Singleton en `lib/prisma.ts`
- **Errores API**: responder con `NextResponse.json({ error: "mensaje" }, { status })`
- **Auth en API**: validar sesión manualmente en cada handler

---

## Variables de entorno requeridas

```
DATABASE_URL, SESSION_SECRET, RESEND_API_KEY,
BINANCE_API_KEY, BINANCE_SECRET_KEY
```

---

## Changelog

### 2026-05-17 — Sistema de memoria persistente creado
- Creado `MEMORY.md`: bitácora viva del proyecto
- Actualizado `AGENTS.md`: contexto del proyecto + reglas de desarrollo
- Creado `.opencode/opencode.json`: configuración con agente `onze-dev` y skill `onze-memory`
- Creado `.opencode/skills/onze-memory/SKILL.md`: skill para actualizar memoria automáticamente
- Creado `.opencode/agents/` (directorio para futuros agentes personalizados)

### 2026-05-17 — Restaurado onze-panel.html al estado del último commit (HEAD)
- Bug: cambios locales en `public/onze-panel.html` rompieron la lógica del Dashboard P2P
- Fix: revertido `public/onze-panel.html` al estado de HEAD para que coincida con la versión deployada en www.onze-pay.com
- Archivos modificados: `public/onze-panel.html` (revertido)

### 2026-05-17 — Fix lógica de pagos manuales en capacities P2P
- **Bug**: `finishCapacityManually` reducía `capacityClp` original en pagos parciales, desordenando la asignación de ventas Binance a capacities posteriores
- **Fix**: Ahora los pagos manuales se trackean como array (`manualPayments`) sin modificar el total original del capacity. Solo se marca como "finished" cuando está completamente cubierto.
- **Nuevas funciones helper**: `getP2PManualPaymentsArray()`, `getP2PManualPaymentsTotal()`
- **Mejora modal completar saldo**: Muestra historial de pagos manuales anteriores, botones separados para "Pago parcial" y "Completar total", validación de monto máximo
- **Detalle del capacity (ojo)**: Nueva sección que muestra pagos manuales registrados con fecha y monto
- **Tarjeta de capacity**: Nueva mini-card "Pago manual" con total CLP y USDT
- **Capital automático**: Al iniciar un nuevo día, el capital inicial se actualiza automáticamente sumando la ganancia del día anterior (rollover)
- **Fix asignación de ventas**: `loadP2PBinanceSales` ahora retorna TODAS las ventas CLP completadas (sin filtrar por "hoy" o "última VES"), el filtro lo hace el baseline en `calculateP2PCapacityStats`. Se eliminó el filtro por `capStartTs` que impedía asignar ventas anteriores a la fecha de creación del capacity
- **Editar capacity**: Nuevo botón de editar (lápiz) al lado del badge Activo/Finalizado. Modal con todos los campos editables usando el mismo diseño que el formulario de crear. Al guardar se actualiza localStorage y servidor (PATCH)
- **Dashboard muestra total del capacity activo**: Cuando hay un capacity activo consumiendo ventas, el dashboard principal muestra los totales agregados de ese capacity (no solo las ventas de "Hoy"). La etiqueta cambia a "Capacity" en lugar de "Hoy". Cuando no hay capacity activo, vuelve a mostrar el rango "Hoy" normal
- **Fix IIFE scope**: `openP2PCapacityEditModal` no era global porque está dentro de un IIFE. Se asignó a `window.openP2PCapacityEditModal`
- **Auto-clear locks al borrar**: Cuando se borra el último capacity activo, se limpian automáticamente los `finalSaleParts` de capacities finalizados para liberar ventas bloqueadas
- **Unassigned visible siempre**: La tarjeta de ventas sin asignar ahora se muestra incluso cuando hay capacities activos, con mensaje contextual según el caso
- Archivos modificados: `public/onze-panel.html`
- Reference: `public/onze-panel.html`, funciones `finishCapacityManually`, `openCompleteCapacityModal`, `openP2PCapacityDetail`, `calculateP2PCapacityStats`, `loadP2PBinanceSales`, `initP2PCapacity`

### 2026-05-17 — Nivel comerciante en Perfil, break-even usa fee del perfil
- **Nuevo campo en Perfil**: Selector "Nivel comerciante Binance P2P" (Sin comisión 0% / No verificado 0.20% / Bronce 0.175% / Plata 0.14% / Oro 0.12%)
- **Nueva función global**: `window.getMerchantFeePct()` — lee el nivel desde el perfil, fallback al dropdown de la calculadora, fallback a 0.14%
- **Calculadora P2P**: `currentBinanceFee()` ahora consulta el perfil primero antes del dropdown
- **Capacity break-even**: La tasa mínima de venta usa `getMerchantFeePct()` en lugar de leer el DOM inline
- Archivos modificados: `public/onze-panel.html`, `MEMORY.md`
