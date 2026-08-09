# Pruebas del chatbot P2P

Simulan una conversación completa (varios mensajes de ida y vuelta) contra el
bot de `lib/p2p-bot/chat-agent.ts`, sin tocar Binance/Bybit ni la base de
datos real, y sin gastar llamadas a la IA (Claude) real.

## Cómo correrlas

```
npm test
```

## Cómo funciona (para agregar una prueba nueva)

- `test/support/fake-prisma.ts` — reemplaza la base de datos por un array en
  memoria. Solo implementa lo que `chat-agent.ts` realmente usa hoy.
- `test/support/fake-client.ts` — reemplaza el cliente de Binance/Bybit.
  `pushClientMessage(texto)` / `pushClientImage(url)` simulan lo que escribe
  el comprador; `getSentMessages()` / `getLastSentMessage()` muestran lo que
  contestó el bot.
- `test/support/chat-brain-stub.ts` — reemplaza las llamadas reales a Claude.
  `chatBrainStub.queueImage({...})` / `queueIntent({...})` dejan lista la
  próxima respuesta "de la IA" para esa prueba, sin pegarle a la API real.
- `test/support/fixtures.ts` — `makeOrder()` / `makeDefaultAccounts()` arman
  una orden y cuentas bancarias de prueba con valores por defecto razonables.

Una prueba típica: crear la orden y el cliente falso, llamar
`processOrder(tenantId, exchange, client, order, activeAds, label)` una vez
por cada "turno" (empezando sin mensajes, para el saludo inicial), empujando
mensajes del comprador con `client.pushClientMessage(...)` entre turno y
turno, y revisando con `expect(...)` lo que el bot contestó o en qué quedó
guardado el estado de la conversación (`fakePrisma.__getChatStateByOrder(...)`).

**Importante**: las cuentas bancarias de prueba se siembran UNA vez por
archivo (no dentro de cada `it()`) — sembrarlas de nuevo en cada prueba deja
bancos duplicados (mismo banco, id distinto) y hace que el detector de "el
cliente nombró 2+ bancos" (`matchAllBanks`) se confunda.

## Por qué existe

Antes de esto, cada arreglo del chatbot solo se podía probar esperando a que
entrara una orden real (con dinero real) y viendo qué pasaba en producción —
así se encontraron casi todos los bugs documentados en `AGENTS.md`. Esta
carpeta deja simular esos mismos escenarios de forma repetible, para
detectar una regresión ANTES de que un comprador real la vea.
