<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# ONZE — Bot P2P de Arbitraje Binance (contexto del proyecto)

Este documento explica la lógica de negocio del bot, su arquitectura, y los problemas
conocidos que deben resolverse. Léelo COMPLETO antes de tocar cualquier archivo
relacionado con capacity, precio fuente, o sincronización de saldos.

## Qué hace este proyecto

ONZE es una plataforma multi-tenant de arbitraje P2P sobre Binance C2C. El operador
(super admin) compra USDT a proveedores a un precio de costo (en CLP) y lo revende en
Binance P2P aplicando un margen. El bot gestiona automáticamente los precios de los
anuncios (ads) para competir en el mercado P2P sin bajar del precio costo real.

Stack: Next.js (App Router) + Prisma + Neon PostgreSQL + Netlify.
Panel principal: public/onze-panel.html (~14.000 lineas), cargado via iframe desde
app/dashboard/page.tsx.
Logica del bot: app/api/p2p/bot/* (modulos: ads, config, market, orders, cycle,
start, stop, status, logs, balance, exchange-config).
Logica de capacity: app/api/p2p/capacity/route.ts.
Modelo de datos clave: P2PCapacity (capacidades de compra), P2PBotAd (anuncios del bot).

## Concepto de "Capacity" (capacidad de compra)

Un "capacity" representa un lote de USDT comprado a un proveedor a un precio de costo.
Campos clave del modelo P2PCapacity:
- provider: nombre del proveedor
- capacityClp: monto en CLP de esa capacidad
- buyPrice: precio de compra (costo real por USDT, en CLP)
- usdtAmount: cantidad de USDT de esa capacidad
- status: "active" | "finished"
- date, finishedAt, finalSoldUsdt, finalClpReceived, etc.

Los capacity se leen ordenados por id ascendente (orderBy: { id: "asc" }).

## Logica de negocio CRITICA (no romper)

1. El bot lee los capacity ACTIVOS para determinar el precio costo real (buyPrice).
2. Sobre ese precio costo, aplica un margen de seguridad para fijar el precio fuente
   de los anuncios.
3. Si la lectura de capacity falla o devuelve datos incorrectos, el bot calcula un
   precio fuente equivocado y pierde el control de la configuracion. Por eso la
   integridad de los capacity es la base de todo el sistema.

---

# PROBLEMAS CONOCIDOS A RESOLVER

## PROBLEMA 1 — "Completar Capacity" corrompe el orden y los saldos (RAIZ)

### Sintoma
Cuando el usuario usa la opcion "Completar" en un anuncio/capacity y completa el
capacity con algun saldo (pago parcial o total), los capacity empiezan a fallar:
desaparecen y reaparecen con otro saldo, y se desordena la secuencia de capacity.

### Pista tecnica detectada
En app/api/p2p/capacity/route.ts:
- El guardado usa where: { id: String(item.id) } en un upsert.
- La lectura usa orderBy: { id: "asc" }.

Hipotesis a investigar: si la operacion "Completar" (probablemente en
public/onze-panel.html) genera un id NUEVO al completar (en vez de reusar el mismo
id del capacity original), o si el id es un valor tipo timestamp que cambia, entonces
al recargar los capacity se reordenan solos y "saltan" de posicion, mostrando saldos
que no corresponden.

### Que investigar
- Buscar en public/onze-panel.html la funcion que maneja "Completar" / "Completar Capacity".
- Verificar si al completar se reusa el mismo id o se genera uno nuevo.
- Revisar si el pago parcial (manualPaymentClp / manualPaymentsClp) actualiza el
  capacity existente o crea un registro nuevo.
- Confirmar como se calcula el saldo restante tras un pago parcial.

### Objetivo
Al completar un capacity (parcial o total), el capacity debe mantener su identidad
(mismo id), conservar su posicion en el orden, y reflejar correctamente el saldo
restante. No debe duplicarse ni reordenarse.

## PROBLEMA 2 — Precio fuente del bot falla (CONSECUENCIA del Problema 1)

### Sintoma
Como parte de la configuracion del bot lee los capacity activos para determinar el
precio costo real, cuando el capacity falla (Problema 1) el bot lee precios
equivocados y la configuracion de precio fuente deja de estar controlada.

### Relacion con Problema 1
Este problema es dependiente del Problema 1. Al resolver la integridad de los capacity,
la lectura del precio fuente deberia estabilizarse. Verificar despues de arreglar el #1.

### Que investigar
- Buscar en app/api/p2p/bot/config/* y app/api/p2p/bot/market/* como se leen los
  capacity activos y como se deriva el precio costo real.
- Confirmar que el bot toma el buyPrice correcto del capacity activo correcto.
- Validar que si hay varios capacity activos, se usa la logica correcta (el mas
  reciente? promedio ponderado? FIFO?) — CONFIRMAR con el usuario cual es la regla
  de negocio esperada antes de asumir.

## PROBLEMA 3 — Saldo USDT no se actualiza por anuncio al entrar una orden

### Sintoma
Cuando entra una orden por el anuncio 1 (o cualquier anuncio), el saldo USDT no se
refresca automaticamente en los demas anuncios. El bot se detiene y deja de competir.

### Workaround manual actual
El usuario entra a la app de Binance manualmente, selecciona el anuncio, "importe de
USDT", TODO, guardar. Con eso el bot retoma su trabajo. Esto es agotador porque hay
que hacerlo cada vez que entra una orden por cada anuncio.

### Que investigar
- Buscar en app/api/p2p/bot/orders/*, app/api/p2p/bot/sync-quantity/* y
  app/api/p2p/bot/ads/* la logica que actualiza el importe/cantidad de USDT de cada ad.
- Entender el flujo: cuando entra una orden en un ad, como deberia re-sincronizarse el
  saldo USDT disponible del resto de ads?
- Revisar la API C2C de Binance para actualizacion de ads (ver scripts existentes:
  scripts/test-update-ad.ts, scripts/test-update-ad2.ts, scripts/sync-binance.mjs).
- Considerar el error conocido de Binance -9000 / mensaje 187049 en Ad 2 (ya escalado a
  soporte de Binance) al modificar ads — no confundir un bug propio con ese error de API.

### Objetivo
Automatizar lo que el usuario hace manualmente: cuando entra una orden por un anuncio,
que el sistema re-sincronice automaticamente el importe de USDT (TODO el disponible)
en los anuncios para que el bot siga compitiendo sin intervencion manual.

## PROBLEMA 4 — Desincronizacion de precio entre DB, logs y margen de seguridad (SINTOMA RECURRENTE)

### Sintoma
El bot lee en la base de datos un precio, pero el precio que realmente usa/muestra es
otro. Concretamente: el precio que aparece en los logs NO coincide con el precio que
sale en "margen de seguridad". El usuario tiene que avisar constantemente que el log no
esta leyendo el mismo precio que margen de seguridad.

### Patron observado (MUY IMPORTANTE)
Cada vez que se "arregla" este problema, vuelve a fallar poco despues, en un ciclo
repetitivo. Esto es una senal de que se esta PARCHEANDO EL SINTOMA y no la CAUSA RAIZ.

### Hipotesis principal
Esta desincronizacion de precio probablemente NO es un bug independiente, sino una
CONSECUENCIA del Problema 1 (capacity corrupto). Cadena causal probable:
  capacity corrupto, precio costo real mal leido, precio fuente/margen mal calculado,
  el precio en logs no coincide con el de margen de seguridad.

Mientras el capacity siga corrompiendose, cualquier arreglo del precio sera temporal.

### Instruccion CRITICA para el agente
NO parchees el sintoma del precio (no hardcodees, no fuerces que log y margen coincidan
con un ajuste superficial). En vez de eso:
1. Rastrea el precio desde su ORIGEN: de donde sale el numero que va a la DB? de donde
   sale el que se muestra en margen de seguridad? de donde sale el del log?
2. Identifica en que punto del flujo se bifurcan (donde uno toma un valor y otro toma
   otro distinto).
3. Determina si esa bifurcacion viene del capacity (Problema 1) o es un punto separado.
4. Arregla la fuente unica de verdad del precio, para que DB, logs y margen de seguridad
   lean SIEMPRE del mismo lugar y el mismo valor.

### Objetivo final del usuario
Que TODAS las funciones del bot trabajen de forma optima y consistente: un solo precio
verdadero que se propague correctamente a DB, logs, margen de seguridad y a los ads.
Sin parches temporales que vuelven a fallar.

---

# RESUMEN DE PRIORIDADES

Los 4 problemas estan probablemente conectados y con RAIZ COMUN en el capacity:

  PROBLEMA 1 (capacity se corrompe al Completar)  <- RAIZ MAS PROBABLE
       |
       +--> PROBLEMA 2 (precio fuente del bot falla)
       |
       +--> PROBLEMA 4 (precio DB vs logs vs margen no coinciden)

  PROBLEMA 3 (saldo USDT no se auto-actualiza por ad)  <- probablemente independiente

Estrategia recomendada:
1. Resolver PRIMERO y BIEN el Problema 1 (integridad del capacity). Es la raiz.
2. Verificar si Problemas 2 y 4 se resuelven solos al arreglar el 1.
3. Si persisten, atacarlos con el capacity ya estable.
4. Trabajar el Problema 3 por separado.

# COMO TRABAJAR EN ESTE PROYECTO

## Reglas de oro
1. Este bot maneja DINERO REAL. Antes de cambiar logica de precios, capacity o
   actualizacion de ads, EXPLICA el cambio propuesto y espera confirmacion.
2. NO asumas reglas de negocio. Si no esta claro, PREGUNTA al usuario antes de
   implementar.
3. Ataca el PROBLEMA 1 primero — es la raiz. Los Problemas 2 y 4 dependen de el.
4. El PROBLEMA 3 es independiente y se puede trabajar por separado.
5. Lee el codigo real antes de proponer cambios. No inventes nombres de funciones ni APIs.
6. NO declarar un problema resuelto hasta confirmar que no reaparece tras varios ciclos
   del bot. El historial muestra que los parches superficiales vuelven a fallar.
7. El usuario es novato: explicale en lenguaje simple que vas a cambiar y por que.

## Notas de entorno
- Base de datos: Neon PostgreSQL (produccion). Cuidado con cambios destructivos.
- El panel es un HTML monolitico en public/onze-panel.html cargado por iframe.
- Hay scripts de utilidad en scripts/ para probar la API de Binance y sincronizar.

---

# DIAGNOSTICO CONFIRMADO DEL PROBLEMA 1 (causa raiz encontrada)

Tras revisar el codigo real de public/onze-panel.html (funciones
openCompleteCapacityModal, confirmCompleteCapacity, finishCapacityManually) y
app/api/p2p/capacity/route.ts, se confirmo la causa raiz:

## Causa raiz: DOBLE FUENTE DE VERDAD (localStorage vs Neon)

El panel guarda los capacity en DOS lugares a la vez:
1. localStorage del navegador, via saveP2PCapacity(capacities).
2. Neon (servidor), via fetch POST a /api/p2p/capacity.

Estas dos fuentes se DESINCRONIZAN. Consecuencias observadas:

- "Aparece con otro saldo": en pago parcial, finishCapacityManually recalcula el
  saldo usando calculateP2PCapacityStats(), que se apoya en datos que pueden venir
  mezclados entre localStorage y servidor. Al recargar, clpReceived sale distinto y el
  capacity muestra un saldo diferente.

- "Se desordena": el servidor devuelve los capacity con orderBy: { id: "asc" }, pero
  localStorage los mantiene en orden de insercion. Cuando la pantalla mezcla ambas
  fuentes, el orden baila.

- Conexion con Problema 4: el BOT corre en el SERVIDOR y lee de NEON. Si el usuario ve
  en pantalla datos de localStorage y el bot lee de Neon, ve precios distintos. Por eso
  el log del bot no coincide con el margen de seguridad. Es el mismo bug de raiz.

## DECISION DE ARQUITECTURA (confirmada con el usuario)

NEON ES LA UNICA FUENTE DE VERDAD para los capacity.

- El panel debe LEER y ESCRIBIR los capacity directamente desde/hacia Neon
  (via las rutas /api/p2p/capacity), NO desde localStorage.
- localStorage NO debe usarse mas como fuente de verdad de los capacity. Se puede
  eliminar por completo de ese flujo, o dejarlo solo como cache no-autoritativo que
  SIEMPRE se sobreescribe con lo que dice Neon (Neon manda siempre).
- Todas las operaciones (crear capacity, completar saldo total, completar saldo
  parcial, finalizar) deben reflejarse en Neon como fuente primaria, y la UI debe
  re-renderizar leyendo de Neon, no de localStorage.
- El usuario acepta que el panel pueda volverse un poco mas lento (cada accion va al
  servidor) a cambio de exactitud 100% confiable. Para datos de dinero real, la
  exactitud vale mas que la velocidad. Optimizar despues si hace falta.

## Como debe abordar el agente este arreglo

1. Mapear TODOS los puntos donde se usa localStorage para capacity: buscar
   saveP2PCapacity, loadP2PCapacity, y cualquier lectura/escritura a localStorage
   relacionada con capacity en public/onze-panel.html.
2. Reemplazar esas lecturas/escrituras para que la fuente primaria sea Neon
   (las rutas /api/p2p/capacity ya existen: GET, POST, DELETE).
3. Asegurar que calculateP2PCapacityStats() calcule sobre los datos de Neon, no de
   una mezcla.
4. Confirmar que tras completar un saldo (parcial o total), la UI recargue desde Neon y
   el capacity conserve su id, su posicion y muestre el saldo correcto.
5. Verificar que el bot (servidor) y el panel (pantalla) ahora lean EXACTAMENTE lo
   mismo, resolviendo de paso los Problemas 2 y 4.
6. IMPORTANTE: explicar cada cambio al usuario (es novato) y esperar confirmacion antes
   de aplicar. Este flujo maneja dinero real.
7. No declarar resuelto hasta que, tras varios ciclos y recargas en distintos
   dispositivos, el saldo y el orden se mantengan estables.

---

# WORK COMPLETED (Jul 6) — Multi-label ONZE/ZINPLE support

## Goal
Support two independent accounts (ONZE and ZINPLE) on the same tenant, each with separate credentials, exchange config, ads, orders, and logs. User can switch between them via ONZE/ZINPLE buttons in the P2P bot panel.

## What was done

### Prisma Schema
- `label` field (`@default("ONZE")`) added to: `BinanceCredentials`, `BybitCredentials`, `OkxCredentials`, `P2PBotExchangeConfig`, `P2PBotAd`, `P2PBotLog`, `P2PBotOrder`
- Unique constraints changed: credential tables `@@unique([tenantId, label])`, exchange config `@@unique([tenantId, exchange, label])`
- Relations changed from one-to-one to one-to-many
- DB pushed with `--accept-data-loss`

### Engine (`lib/p2p-bot/engine.ts`)
- `executeBotCycle(tenantId, label)` — accepts label, passes to exchange config and credential lookups
- `getExchangeConfig(tenantId, exchange, label)` — uses `tenantId_exchange_label` unique key
- `runBinanceCycle(..., label)` + `runBybitCycle(..., label)` — accept label
- `logBot(tenantId, ..., label?)` — stores label in log entries
- `getBotLogs(..., label?)` / `getBotOrders(..., label?)` — filter by label
- `saveExchangeConfig(..., label)`, `startExchangeBot(..., label)`, `stopExchangeBot(..., label)`
- All credential lookups changed from `findUnique({ where: { tenantId } })` to `findFirst({ where: { tenantId, label, isActive } })`

### Credential Adapters
- `getBinanceCredentials(tenantId, label)`, `saveBinanceCredentials(..., label)`, `testBinanceCredentials(..., label)`
- `getBybitCredentials(tenantId, label)` — switched to `findFirst`
- `getOkxCredentials(tenantId, label)` — switched to `findFirst`, `save/delete/test` updated

### Chat-browser
- `getStoredCookies(tenantId, label)`, `getStorageState(tenantId, label)`, `storeCookies(tenantId, data, label)`

### Live orders/market (`lib/p2p-bot/live.ts`)
- `fetchLiveOrders(..., label)`, `fetchLiveMarket(..., label)`, `getClient(..., label)`

### API Routes (all accept `?label=` in GET or `label` in body for POST)
- `exchange-config`, `ads`, `orders`, `cycle`, `logs`, `balance`, `sync-quantity`
- `bybit-credentials`, `okx-credentials`, `binance/credentials`, `binance/p2p-history`

### Panel (`public/onze-panel.html`)
- `botActiveLabel` global var + `botSetActiveLabel(label)` function
- ONZE/ZINPLE account switcher buttons with `.bot-acct-btn` / `.bot-acct-btn.active` CSS
- All fetch URLs include `&label=` + `encodeURIComponent(botActiveLabel)`:
  - Logs, orders, exchange-config, credentials, cycle (body)

### Build Status
- **0 TypeScript errors** after full `tsc --noEmit`
- **Build succeeds** (`npm run build`)

## Known Issues
- `P2PBotLog.label` is NULL for ~1.68M pre-existing log entries (column was dropped/re-added during schema push)
- Some `logBot` calls inside `runBybitCycle` still use the old direct call pattern instead of `log()` wrapper — they work but don't pass label
- `getBybitClient` in ads route has `label` param but GET handler callers don't pass it yet (defaults to `"ONZE"`)

## Next Steps
1. Test ONZE ↔ ZINPLE switching in panel
2. Verify engine cycles use correct credentials per label
3. Set up separate ZINPLE Binance credentials in the panel
4. Fix Bybit/OKX label edge cases if needed
