
    // Auto-recarga (sep 2026): sin esto, una pestaña que ya estaba abierta
    // antes de un deploy se queda corriendo el código VIEJO en memoria para
    // siempre -- confirmado en vivo varias veces esta semana (bank-quota y
    // el sync de Bybit siguieron llamando a Binance a la frecuencia vieja
    // por días, porque nadie refrescó). window.__ONZE_PANEL_VERSION lo
    // inyecta /api/panel con un hash del contenido real del archivo (ver
    // esa ruta y /api/panel-version) -- si el hash actual del servidor es
    // distinto al que esta pestaña cargó, se recarga sola. Intervalo de
    // 3 min: no hace falta más frecuencia para esto, y así no suma carga
    // de más al servidor.
    (function(){
      var CHECK_INTERVAL_MS = 3 * 60 * 1000;
      function checkVersion(){
        if(typeof window.__ONZE_PANEL_VERSION !== "string") return;
        fetch("/api/panel-version", { cache: "no-store" })
          .then(function(r){ return r.json(); })
          .then(function(d){
            if(d && d.ok && typeof d.hash === "string" && d.hash !== window.__ONZE_PANEL_VERSION){
              location.reload();
            }
          })
          .catch(function(){});
      }
      setInterval(checkVersion, CHECK_INTERVAL_MS);
    })();
  