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

---

# SOLUCIÓN DEFINITIVA — Error 187049/187040 al actualizar anuncios Binance (RESUELTO, jul 2026)

**NO ROMPER ESTO.** Costó días de debugging (varias sesiones, incluyendo contacto directo con
soporte de Binance) llegar a esta solución. Si en el futuro alguien "simplifica" o "limpia"
`updateAd`/`updateAdQuantity` en `lib/p2p-bot/binance-adapter.ts` sin leer esto primero, el
197049/187040 va a volver.

## Síntoma
Al llamar `/sapi/v1/c2c/ads/update` para cambiar precio o cantidad de un anuncio P2P, Binance
respondía `{"code":-9000,"msg":"187049"}` (a veces `"187040"`) y el anuncio dejaba de competir.
Pasaba más seguido cuando el anuncio tenía órdenes activas sin liberar.

## Causa raíz (confirmada por soporte oficial de Binance, vía chat de soporte)
1. **`/sapi/v1/c2c/ads/update` valida la configuración COMPLETA del anuncio en cada llamada.**
   No es un endpoint de "patch" — un payload parcial (solo `price` o solo `surplusAmount`) hace
   fallar la validación de cantidad/límite de tenencia, especialmente cuando hay órdenes
   pendientes que ya redujeron el inventario disponible. 187049 = "buyer holding limit" fuera
   de rango; 187040 = cantidad por debajo del mínimo. Ambos son de VALIDACIÓN, no un bloqueo
   automático por orden pendiente.
2. **`initAmount` no es un valor libre.** No se puede poner "el saldo de la wallet" ni "el saldo
   repartido entre anuncios" directamente en `initAmount` — eso fue lo que probamos primero y
   falló el 100% de las veces con 187040. La fórmula EXACTA que dio soporte de Binance:

   ```
   surplusAmount_antes - surplusAmount_después = initAmount_antes - initAmount_después
   ⇒ initAmount_después = initAmount_antes + (surplusAmount_deseado - surplusAmount_antes)
   ```

   `(initAmount - surplusAmount)` representa lo YA VENDIDO del anuncio — es un invariante que
   hay que preservar. Cambiar `surplusAmount` a un valor nuevo requiere mover `initAmount` por
   la MISMA diferencia, no ponerle un valor absoluto nuevo.

## La solución (implementada en `lib/p2p-bot/binance-adapter.ts`)

Ambos métodos (`updateAd` para precio, `updateAdQuantity` para cantidad) siguen el mismo patrón:

1. Leer el anuncio completo con `getAdDetail(adId)` (`/sapi/v1/c2c/ads/getDetailByNo`).
2. Armar el body con una **lista blanca EXACTA de 32 campos** — capturada del request real de
   la app web de Binance (no una lista negra "reenviar todo excepto X", eso fue un intento
   anterior que funcionaba ~80% de las veces pero no al 100%):
   `adAdditionalKycVerifyItems, adTags, advNo, advStatus, asset, assetScale, autoReplyMsg,
   buyerBtcPositionLimit, buyerRegDaysLimit, classify, fiatScale, fiatUnit, initAmount,
   isSafePayment, isStarTraderAdditionalKycExclusion, isStarTraderCounterpartyConditionsExclusion,
   launchCountry, maxSingleTransAmount, minSingleTransAmount, onlineDelayTime, onlineNow,
   payTimeLimit, price, priceFloatingRatio, priceScale, priceType, remarks,
   takerAdditionalKycRequired, tradeMethods, tradeType, visible, voucherTemplateNo`.
3. Todos los tipos EXACTOS de `getAdDetail` — `priceType`/`advStatus`/`assetScale`/`fiatScale`/
   `priceScale`/`visible` son NÚMEROS, no strings ni booleanos. NO usar `String()` en ellos.
4. Campos que `getAdDetail` NUNCA devuelve (hay que hardcodearlos, confirmados de una captura
   real): `isSafePayment: false`, `isStarTraderAdditionalKycExclusion: false`,
   `isStarTraderCounterpartyConditionsExclusion: false`, `launchCountry: []`,
   `onlineDelayTime: 0`, `onlineNow: true`, `visible: 1` (número), `voucherTemplateNo: ""`.
5. **`updateAd`**: único campo que cambia intencionalmente es `price` (`String(price)`).
   **`updateAdQuantity`**: único campo que cambia es `initAmount`, calculado con la fórmula de
   arriba — `price` se deja igual (`detail.price`, sin tocar).

## Qué NO hacer (ya se probó y falló)
- ❌ Mandar payload parcial (`{advNo, price}` o `{advNo, surplusAmount}` solo) → 187049 casi
  siempre.
- ❌ Poner `surplusAmount` directamente en el body → Binance a veces acepta con código 000000
  pero NO aplica el cambio (silent no-op) — confirmado leyendo el anuncio de nuevo después.
- ❌ Poner `initAmount` a un valor absoluto (saldo de wallet, o saldo repartido entre N
  anuncios) sin la fórmula → 187040 el 100% de las veces (0 de ~90 intentos en pruebas reales).
- ❌ Repartir el saldo entre anuncios activos (`balance / cantidad de anuncios`) — no es
  necesario con la fórmula correcta, y probarlo aisladamente sin la fórmula empeoró las cosas.
- ❌ Agregar `priceType: "0"` o cualquier transformación de tipo — la app web nunca lo hace.
- ❌ Bloquear/saltar el ciclo de precio cuando el "quantity sync" tocó el anuncio ese ciclo —
  causaba que el precio nunca se actualizara si el sync fallaba en loop (bug real, ya
  eliminado). El update de precio debe correr SIEMPRE, independiente del sync de cantidad.

## Automatización del sync de cantidad (`engine.ts`, dentro de `runBinanceCycle`)
Corre en cada ciclo si hay 2+ anuncios gestionados: compara el saldo real de la wallet
(`client.getBalance("USDT")`, vía `/sapi/v1/asset/get-funding-asset`) contra la cantidad
publicada de CADA anuncio (`myAds` del ciclo), y llama `updateAdQuantity(adId, balance)` — con
el **saldo COMPLETO**, no repartido — si difieren en más de 0.5 USDT. Esto reemplaza el "TODO"
manual que el usuario hacía en la app de Binance cada vez que entraba una orden por el anuncio
contrario.

## Verificación (jul 2026)
Confirmado en producción con monitoreo en vivo: tras aplicar la fórmula correcta, el sync de
cantidad pasó de 0% de éxito (~90 intentos fallidos seguidos) a funcionar de forma consistente
en el primer intento tras el fix. El update de precio ya tenía buena tasa de éxito desde la
lista blanca de 32 campos, con recuperación automática en el próximo ciclo cuando fallaba por
una orden activa.

---

# ACTUALIZACIÓN — Ambos anuncios (ONZE/ZINPLE) funcionando de forma estable (jul 10 2026)

Tras la sesión del jul 10 2026 (varias horas de monitoreo en vivo con ambos anuncios de ZINPLE
activos: "todos los bancos" y "Banco Estado"), se encontraron y arreglaron 4 problemas
DISTINTOS del original 187049 de más arriba. Si en el futuro alguno de los dos anuncios deja
de funcionar bien, revisar esta lista ANTES de escribirle a Binance — es muy probable que sea
uno de estos 4, ya resuelto una vez.

## 1. Límite de velocidad de cuenta NO revelado (confirmado por soporte de Binance)

Binance confirmó explícitamente (soporte, jul 2026): existe un límite de cuánto se puede
actualizar un anuncio (precio Y cantidad) en poco tiempo, **por CUENTA, no por anuncio**, y
**no revelan el número exacto ni la ventana de tiempo** ("para evitar manipulación").
Consecuencia: aunque el payload/fórmula sea 100% correcto, un update puede fallar con 187049
simplemente por exceso de actividad reciente en la cuenta (órdenes entrando, otros updates,
pruebas manuales, etc). Esto es ESPERADO y no indica que el código esté mal.

Evidencia empírica (jul 10): incrementos chicos de cantidad (+1 a +100 USDT) funcionaron
sueltos, pero acumular ~290 USDT de subida en ~10 min hizo fallar el siguiente intento. Luego,
tras dejar de martillar (ver punto 2), hasta saltos de ~5.300 USDT funcionaron sin problema —
el "cupo" se recupera solo con el tiempo si no se sigue insistiendo.

## 2. Bug real: cooldown "fantasma" que nunca se activaba (YA ARREGLADO)

El código de precio (`runBinanceCycle` en `engine.ts`) SIEMPRE tuvo un mecanismo de cooldown
por anuncio (`AdState.lastRateLimitError` / `rateLimitBackoffMs`, ya revisado antes de cada
intento de subida/bajada de precio) — pero **nunca se le asignaba un valor** en ningún lado del
código. Resultado: cuando un update de precio fallaba por 187049 (tras su reintento de 10s
inline), el bot NO esperaba nada y volvía a intentar el mismo cambio en el siguiente ciclo
(~10-30s después), sin parar, manteniendo el "cupo" de la cuenta siempre gastado.

**Arreglo**: en el catch del segundo intento (tras el retry de 10s) del bloque de 187049/187040
en el update de precio, ahora se asigna:
```js
as.lastRateLimitError = Date.now();
as.rateLimitBackoffMs = 5 * 60 * 1000; // 5 min
```
Con eso, el chequeo que YA existía al inicio del ciclo de precio (`if (as.lastRateLimitError > 0
&& Date.now() - as.lastRateLimitError < as.rateLimitBackoffMs) { saltar }`) empieza a funcionar
de verdad.

**NO BAJAR ESTE VALOR — ya se probó y falló (jul 14 2026).** El usuario pidió bajarlo primero a
5s, luego se acordó un término medio de 60s como prueba. A los pocos minutos de uso real, 60s
reprodujo el mismo problema que este punto 2 arregló originalmente (el 187049 volvió a repetirse
en vez de dar tiempo a que la cuenta recuperara cupo). Se revirtió a 5 minutos y el usuario
confirmó dejarlo así. Razón para NO seguir probando valores intermedios: el límite de cuenta de
Binance no tiene un número ni ventana revelados, así que no hay forma de "afinar" este valor de
forma confiable — cualquier valor más bajo que 5 min es apostar estabilidad comprobada por
velocidad incierta. Si se quiere que los anuncios reaccionen más rápido, atacar la FRECUENCIA de
187049 (menos causas de fallo), no el castigo después de que ya ocurrió.

## 3. Cooldown de cantidad solo cubría subidas (YA ARREGLADO)

El sync de cantidad (bloque nuevo agregado esta sesión, dentro de `runBinanceCycle`, después de
leer `myAds`) originalmente solo ponía en cooldown las SUBIDAS de cantidad al fallar con 187049,
asumiendo que las bajadas "siempre funcionan" (cierto la mayoría de las veces, pero NO siempre —
se confirmó en vivo un caso donde una bajada también chocó con 187049 y quedó reintentando sin
parar, sin cooldown, porque el código lo excluía a propósito).

**Arreglo**: el cooldown de 5 minutos (`AdState.qtySyncCooldownUntil`) ahora aplica a CUALQUIER
fallo 187049 en cantidad, sin importar si era subida o bajada.

**IMPORTANTE — el tamaño del salto de cantidad NO se limita.** Se probó limitar la subida a
pasos de 60 USDT por ciclo (en vez del salto completo al saldo real), y el usuario pidió
explícitamente revertirlo: el comportamiento correcto y confirmado por Binance es enviar el
**saldo COMPLETO de la wallet de una vez** (`client.updateAdQuantity(ma.adId, balance)`, sin
partir el salto). Si esto se vuelve a romper, NO reintroducir el límite de pasos sin que el
usuario lo pida explícitamente — el cooldown de 5 min tras un fallo es la única protección
que debe existir.

## 4. Bug real y raíz del "anuncio no compite": sin competidor viable, el precio se quedaba
   congelado en vez de caer al piso de seguridad (YA ARREGLADO)

Este fue el bug más importante encontrado. En el cálculo de precio por competidor
(`runBinanceCycle`, tras el filtro de "viable"): cuando NINGÚN competidor calificaba como
viable (ej: todo el mercado leído está por debajo de nuestro costo real, o los únicos viables
eran nuestros propios anuncios), el código original hacía `continue` — saltaba el anuncio ese
ciclo SIN TOCAR NADA, dejando el precio pegado en el último valor que tenía, indefinidamente,
aunque ese precio ya no tuviera nada que ver con el mercado ni con el piso de seguridad.

**Regla de negocio confirmada explícitamente por el usuario**: "el margen de seguridad es
únicamente para que no se baje de ese precio cuando otros competidores entren por debajo —
el anuncio NUNCA puede quedarse fijo". Es decir: el piso de seguridad es un límite INFERIOR,
no un valor de reposo. Si no hay a quién seguir, el anuncio debe caer directo al piso (el
precio más competitivo posible sin vender bajo costo), no quedarse donde estaba.

**Arreglo**: se quitaron los `continue` tempranos cuando `viable`/`sortedCompetitors` quedan
vacíos (ahora solo loguean y siguen el flujo), y el cálculo de `targetPrice` cambió de:
```js
let targetPrice = currentPrice;
if (targetCompetitor) targetPrice = Number(targetCompetitor.price) - adTop1Diff;
```
a:
```js
let targetPrice = targetCompetitor ? Number(targetCompetitor.price) - adTop1Diff : safeFloor;
```
Así, sin competidor objetivo, el default es el piso de seguridad — nunca el precio anterior.

## 5. Bug real: solo se leía 1 página (20) de competidores, perdiendo a los que quedan justo
   en el borde (YA ARREGLADO)

El fetch de competidores en modo "igualar métodos de pago del anuncio" (`__match_ad__`, usa
`client.getOnlineAds(...)`) pedía **una sola página de 20 resultados** ordenados del más barato
al más caro. Se confirmó en vivo un caso real: un competidor legítimo y "ganable" (Tyra SpA,
935.75, con BCI Chile) apareció exactamente en la posición #20 — el último lugar de esa página.
Por la volatilidad normal del mercado P2P (precios cambian cada pocos segundos), ese competidor
entraba y salía de la ventana de 20 constantemente, así que el bot lo veía a veces sí, a veces
no, sin ningún patrón visible en los logs — el precio parecía "no reaccionar" sin ningún error.

**Nota técnica importante**: Binance RECHAZA pedir más de 20 filas por página en este endpoint
(`/bapi/c2c/v2/friendly/c2c/adv/search`) — devuelve `{"code":"000002","message":"illegal
parameter"}` si se pide `rows > 20`. No se puede simplemente subir el número.

**Arreglo**: ahora se piden página 1 Y página 2 en paralelo (`Promise.all`) y se combinan — 40
competidores en vez de 20. Esto le da margen suficiente para no perder a alguien que esté justo
en el borde de la ventana anterior.

## 6. NO resuelto todavía — el bot depende de que la pestaña del panel esté abierta

El ciclo del bot NO corre en el servidor de forma independiente — lo dispara un timer en el
navegador (`scheduleBotCycle()` en `onze-panel.html`, llama a `/api/p2p/bot/cycle` cada ~300ms
mientras la vista del panel está montada). Si se navega a otra sección de la app (ej. "Ir a
admin", que es un link de navegación completa) o se cierra la pestaña, el ciclo se detiene por
completo aunque en la base de datos siga marcado como "activo". Se observaron varios cortes de
varios minutos por esto durante la sesión — cada corte genera un salto grande pendiente de
corregir al reactivar, lo cual puede a su vez chocar más fácil con el límite de velocidad del
punto 1.

**Propuesta pendiente de confirmar con el usuario**: mover el disparo del ciclo a una función
programada de Netlify (server-side, no depende del navegador). Limitación: Netlify solo permite
programar cada 1 minuto como mínimo (hoy reacciona cada ~10-30s), sería más lento pero nunca se
detendría por navegación. No implementado aún — requiere autorización explícita antes de tocar
infraestructura.

## Checklist de diagnóstico rápido si un anuncio "deja de funcionar" de nuevo

1. ¿Hay logs de 187049 recientes? Si sí, ¿aparece "en cooldown... saltando" después del primer
   fallo, o sigue reintentando cada ciclo sin parar? Si sigue martillando sin cooldown, revisar
   que los puntos 2 y 3 de arriba sigan aplicados (no se hayan revertido por accidente).
2. ¿El precio está pegado en un valor que no cambia hace muchos ciclos? Revisar si hay un log
   "viable vacío" repetido — si lo hay, confirmar que el `targetPrice` calculado sea el
   `safeFloor` y no el `currentPrice` (punto 4).
3. ¿Se ve en la app un competidor claramente ganable que el bot no está usando? Revisar cuántas
   páginas de competidores se están leyendo (punto 5) y en qué posición aparece ese competidor
   en una consulta directa a `/bapi/c2c/v2/friendly/c2c/adv/search` con los mismos payTypes y
   `tradeType: "BUY"` (OJO: `tradeType: "BUY"` es el que muestra anuncios de VENTA/competidores
   reales — usar `"SELL"` por error muestra el lado de compradores, no de competidores).
4. ¿El bot lleva minutos sin ciclar? Revisar `P2PBotLog` — si el último log tiene más de ~2
   minutos, es el problema del punto 6 (pestaña cerrada o navegación fuera del panel).
5. Antes de escribirle a Binance por un 187049/187040 "nuevo", revisar que el payload siga
   siendo exactamente la lista blanca de 32 campos con la fórmula de `initAmount` — si eso está
   intacto, casi seguro es el límite de velocidad del punto 1, no un problema de payload.
6. ¿El bot lleva minutos sin ciclar y el usuario dice que no salió del panel ni cerró la
   pestaña? Sospechar del punto 7 (cambio de pestaña ONZE/ZINPLE cortando el ciclo real) antes
   que del punto 6 (navegación fuera del panel) — confirmar revisando si el usuario cambió de
   cuenta en la UI justo antes del corte.

## 7. NO era solo el punto 5 — el fetch de 1 página también estaba en el caché general de
   competidores, y cambiar de pestaña ONZE/ZINPLE cortaba el ciclo real (AMBOS ARREGLADOS, jul 11 2026)

Dos bugs distintos encontrados el mismo día, ambos con síntomas parecidos a "el anuncio no
compite" o "el bot se detiene solo":

**7a. El modo "competir con todos los bancos" también leía solo 1 página.** El arreglo del
punto 5 (2 páginas) se aplicó primero solo al modo `__match_ad__` (igualar métodos de pago del
anuncio). Pero el anuncio configurado para competir contra TODO el mercado (`competePayTypes:
null`, `bs.cachedCompetitors`) usaba un fetch completamente distinto, en otra parte de
`runBinanceCycle`, que también solo pedía 1 página. Mismo síntoma: un competidor real y ganable
justo arriba del precio (ej. 936 cuando el piso estaba en 935.12) nunca entraba a la lista, y el
anuncio quedaba pegado en el piso de seguridad. **Arreglo**: ese fetch también pide 2 páginas
en paralelo ahora.

**7b. Cambiar de pestaña ONZE/ZINPLE en el panel cortaba el ciclo real del bot.** El timer que
dispara el ciclo cada ~300ms (`scheduleBotCycle()`) leía la variable global `botActiveLabel`
EN VIVO en cada vuelta, no la cuenta con la que se había iniciado. Si el usuario cambiaba de
pestaña a la OTRA cuenta mientras esta estaba apagada, el timer empezaba a mandar
`label: <cuenta apagada>` al backend, que respondía `running: false`, y el código **detenía el
timer por completo** (pensando que ya no había nada que hacer) — dejando de atender a la cuenta
que sí estaba corriendo, sin ningún error visible. Esto es MUY probablemente la explicación real
de varios de los cortes de "bot detenido" vistos en la sesión — no solo la navegación fuera del
panel (punto 6).

**Arreglo**: se agregó `botCyclingLabel` (variable separada de `botActiveLabel`) que se fija
al presionar "Iniciar" y no cambia por mirar la otra pestaña. El timer (`scheduleBotCycle`)
usa `botCyclingLabel`, no `botActiveLabel`. "Detener" solo corta el timer real si la cuenta que
se detiene es la que efectivamente está corriendo (`botCyclingLabel === botActiveLabel`); si se
detiene la cuenta que solo se está mirando (y no es la que corre), no toca el ciclo de la otra.

**Si se vuelve a tocar `botStartExchange`/`botStopExchange`/`scheduleBotCycle` en el futuro**:
NUNCA volver a leer `botActiveLabel` dentro del loop del timer — siempre usar la variable
capturada al iniciar (`botCyclingLabel`). Es la causa más sutil y con más impacto que se
encontró en toda la sesión, porque no deja ningún error en los logs, solo silencio.

## 8. "Ciclo de Ventas": cierre automático puede perder la ÚLTIMA orden por inconsistencia
   eventual entre dos endpoints de Binance (ARREGLADO, jul 13 2026)

### Síntoma
El ciclo 12 se cerró automáticamente sin incluir su última orden real (#22910010456569503744,
100.000 CLP, ya COMPLETED), aunque el bot había esperado correctamente 7 minutos (logs
"orden(es) pendiente(s) sin resolver") a que esa misma orden se resolviera antes de cerrar.

### Causa raíz (NO era una cancelación, NO era el chequeo de pendientes)
`autoCloseCycle` (en `engine.ts`) usa DOS lecturas distintas de Binance en el mismo cierre:
1. `client.getOrders({ page: 1, rows: 20 })` sin filtro de fecha — lista "en vivo" de órdenes
   recientes, usada solo para chequear si hay algo en estado `TRADING` (pendiente) antes de
   cerrar. Esta lectura se actualiza rápido.
2. `computeCycleOrderStats()` (en `cycle-stats.ts`) — pagina el endpoint de HISTORIAL
   (`listUserOrderHistory`) filtrado por `startTimestamp`/`endTimestamp`, usado para calcular
   los totales del ciclo (`totalUsdt`, `totalBinanceClp`, primera/última orden).

Estos dos endpoints de Binance NO se actualizan al mismo tiempo: el endpoint de historial puede
tardar unos segundos más en indexar una orden que ACABA de pasar a `COMPLETED`. En el ciclo 12,
la lectura (1) ya no vio la orden como pendiente (por eso el bot procedió a cerrar), pero en ese
mismo instante la lectura (2) todavía no la reflejaba — la orden se coló justo en ese hueco de
inconsistencia eventual y quedó fuera del total.

### Arreglo (`lib/p2p-bot/cycle-stats.ts` + `lib/p2p-bot/engine.ts`)
`computeCycleOrderStats()` ahora acepta un 4to parámetro opcional `extraOrders` — una lista de
órdenes ya obtenidas por el caller de una lectura más fresca. Esas órdenes se mezclan (con
dedup por `orderNumber`) con las que trae la paginación del historial, y se re-valida el rango
de fecha explícitamente (`createTime` dentro de `[startMs, endTimestamp]`) porque `extraOrders`
puede traer órdenes fuera de la ventana del ciclo. En `autoCloseCycle`, se pasa el `recentOrders`
que YA se había obtenido para el chequeo de pendientes (`computeCycleOrderStats(client, startMs,
endMs, recentOrders)`) — así la misma lectura que confirmó "ya no hay nada pendiente" es la que
alimenta el cálculo de totales, sin depender de que el endpoint de historial ya haya indexado
esa orden.

### Corrección del dato histórico
El ciclo 12 (ZINPLE) se corrigió manualmente en la base de datos: `lastOrderNumber` de
`22910009392536526848` (105.000 CLP) a `22910010456569503744` (100.000 CLP),
`totalBinanceClp` de `10428611` a `10528611`, `totalUsdt` de `11173.83` a `11280.38`.

### Si vuelve a pasar
Si un ciclo se cierra y falta la última orden real (verificable comparando `lastOrderNumber`
contra el historial real de Binance), sospechar primero de esta misma inconsistencia eventual
antes que de un bug nuevo — es un comportamiento normal de la infraestructura de Binance, no
algo 100% eliminable, solo mitigado. El `close/route.ts` (cierre MANUAL) no tiene este problema
de la misma forma porque no hace el chequeo de pendientes previo, pero en teoría podría sufrir
el mismo lag si el usuario cierra el ciclo justo al segundo en que se completa la última orden.

## 9. El chequeo de "pendiente" solo miraba el estado TRADING — se perdían órdenes en estados
   intermedios (ARREGLADO, jul 13 2026)

### Síntoma
El ciclo 13 se cerró sin 3 órdenes reales: dos completadas DENTRO de la ventana del ciclo
(19:08 y 19:13, más de 6 y 12 minutos antes del cierre a las 19:20) y una más de una hora
después (20:14, ya claramente fuera de cualquier ventana de "lag de segundos" del punto 8).

### Causa raíz (más amplia que el punto 8 — un chequeo incompleto, no solo un lag de índice)
El chequeo de "¿hay algo sin resolver?" en `autoCloseCycle` (`hasPending`) solo consideraba
pendiente una orden si su estado era exactamente `TRADING`. Pero Binance tiene estados
intermedios entre `TRADING` (comprador debe pagar) y `COMPLETED` (ej. comprador ya pagó,
esperando liberación) que NO son `TRADING` pero TAMPOCO son definitivos. Si el chequeo se
ejecuta justo cuando una orden está en uno de esos estados intermedios, `hasPending` decía
"no hay nada pendiente" y el ciclo se cerraba, dejando esa orden (que segundos o minutos
después sí se completaba) fuera del total — sin que fuera ni un lag de indexación ni una
cancelación, sino un chequeo que no cubría todos los estados "no finales" posibles.

### Arreglo (`lib/p2p-bot/engine.ts`, dentro de `autoCloseCycle`)
Se cambió el chequeo de "es TRADING" a "NO es un estado FINAL": ahora existe un set explícito
`FINAL_ORDER_STATUSES = new Set(["COMPLETED", "CANCELLED", "CANCELLED_BY_SYSTEM"])`, y
`hasPending` es `true` si CUALQUIER orden reciente tiene un estado que no está en ese set —
sin importar cuál sea el estado intermedio exacto. Esto implementa directamente la regla de
negocio que pidió el usuario: "para que el ciclo se pueda completar cada orden que entre se
debe finalizar".

### Corrección del dato histórico
El ciclo 13 (ZINPLE) se corrigió: `lastOrderNumber` de `22910059360554004480` (100.000 CLP,
18:57) a `22910078740815556608` (200.000 CLP, 20:14), `totalBinanceClp` de `7987325` a
`8487325`, `totalUsdt` de `8544.84` a `9078.35`. No hizo falta tocar `endTime` (el próximo
ciclo arranca desde `lastOrderTime`, no desde `endTime` — ver `start/route.ts`).

### Relación con el punto 8
Ambos arreglos son complementarios y deben coexistir: el punto 8 (pasar `recentOrders` como
`extraOrders` a `computeCycleOrderStats`) cubre el lag de indexación del buscador de historial
para una orden que YA está `COMPLETED` en la lectura fresca. Este punto 9 cubre el caso de que
esa lectura fresca todavía no la muestre como `COMPLETED` porque de verdad no lo es todavía —
en ese caso, `hasPending` ahora la sigue tratando como pendiente y el ciclo espera, en vez de
cerrar antes de tiempo. Si en el futuro vuelve a faltar una orden real en un cierre, revisar
PRIMERO si `hasPending` sigue usando el set de estados finales (no revertir a solo `TRADING`).

## 10. Sync de cantidad "se rompe" tras un cambio de saldo GRANDE hecho FUERA del flujo normal
    de órdenes del bot (NO es un bug — comportamiento esperado, jul 14 2026)

### Síntoma
El sync automático de cantidad (`updateAdQuantity`, el "TODO") empezó a fallar el 100% de las
veces durante ~1h50min (0 éxitos, 20+ fallos seguidos con 187049), mientras el precio seguía
actualizándose con éxito normal (~95%, cientos de updates exitosos en el mismo período). El
usuario tuvo que sincronizar la cantidad a mano varias veces mientras tanto.

### Causa raíz (confirmada por el usuario, NO relacionada al cambio de cooldown de ese día)
El usuario hizo una venta P2P directa (para comprar bs/VES) y un pago por Pay, **ambas por
FUERA de los anuncios gestionados por el bot**. Estas dos operaciones movieron el saldo real de
la wallet de golpe, en un salto grande y repentino — muy distinto a como baja el saldo cuando
entra una orden normal por los anuncios del bot (de a poco, orden por orden). Un salto grande de
una sola vez es exactamente el tipo de cambio que el límite de velocidad de cuenta no revelado
de Binance (punto 1) trata con más sospecha — el sync intentaba "alcanzar" ese salto grande en
`initAmount` y chocaba con 187049 una y otra vez, mientras el precio (cambios chicos, en
centavos) seguía pasando sin problema porque consume mucho menos "cupo" por cambio.

### Por qué NO se tocó el código
Se verificó con `git diff` que el código de `engine.ts` y `binance-adapter.ts` no cambió en
absoluto en los commits recientes (el experimento de cooldown 60s→revert dio diff vacío). El
sync automático para órdenes NORMALES del bot sigue funcionando exactamente igual que siempre —
el problema fue específico a un salto de saldo grande originado fuera del flujo del bot, no una
regresión de código.

### Resolución
Se resolvió solo, sin cambiar nada: tras el último fallo (17:41), el sync volvió a tener éxito
(o el usuario lo ajustó a mano) y desde las 17:44 ambos anuncios quedaron sincronizados con el
saldo real, estable, sin más fallos.

### Checklist si vuelve a pasar
Antes de sospechar de un bug: preguntar si el usuario hizo alguna operación de saldo POR FUERA
de los anuncios del bot (venta P2P directa, pago Pay, transferencia, retiro, etc.) justo antes
de que empezara a fallar. Si la respuesta es sí, es este mismo patrón — no requiere cambio de
código, solo esperar a que el "cupo" de la cuenta se recupere (igual que el punto 1). Confirmar
comparando la tasa de éxito del PRECIO en el mismo período: si el precio sigue actualizando bien
y solo la cantidad falla, es este patrón (salto grande específico de cantidad), no un bloqueo
general de cuenta.
