
    // Aviso de versión nueva (sep 2026, ajustado a pedido explícito del
    // usuario): antes esto recargaba la pestaña SOLA apenas detectaba un
    // deploy nuevo -- necesario para que una pestaña vieja no se quedara
    // corriendo código viejo para siempre (bank-quota y el sync de Bybit
    // llegaron a llamar a Binance a la frecuencia vieja por días, porque
    // nadie refrescaba). Pero recargar sin avisar interrumpe al usuario a
    // mitad de una acción real dentro del panel -- reportado en vivo. Ahora
    // NUNCA se recarga sola: se muestra un avisito chico y fijo, y el
    // usuario decide cuándo actualizar (o lo ignora y sigue como estaba,
    // bajo su propio riesgo de quedarse en código viejo un rato más).
    // window.__ONZE_PANEL_VERSION lo inyecta /api/panel con un hash del
    // contenido real del archivo (ver esa ruta y /api/panel-version).
    (function(){
      var CHECK_INTERVAL_MS = 3 * 60 * 1000;
      var shown = false;
      function showUpdateBanner(){
        if(shown || document.getElementById("onzeVersionBanner")) return;
        shown = true;
        var el = document.createElement("div");
        el.id = "onzeVersionBanner";
        el.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2000000;display:flex;align-items:center;gap:10px;background:#0f172a;border:1px solid rgba(52,211,153,.35);color:#e2e8f0;padding:10px 12px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);font:600 13px/1.3 inherit;max-width:calc(100vw - 24px);";
        el.innerHTML =
          '<span>🆕 Hay una versión nueva del panel.</span>' +
          '<button type="button" id="onzeVersionBannerReload" style="background:#059669;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-weight:800;cursor:pointer;">Actualizar</button>' +
          '<button type="button" id="onzeVersionBannerDismiss" title="Cerrar" style="background:transparent;color:#94a3b8;border:none;font-size:16px;line-height:1;cursor:pointer;padding:2px 4px;">✕</button>';
        document.body.appendChild(el);
        document.getElementById("onzeVersionBannerReload").addEventListener("click", function(){
          location.reload();
        });
        document.getElementById("onzeVersionBannerDismiss").addEventListener("click", function(){
          el.remove();
        });
      }
      function checkVersion(){
        if(typeof window.__ONZE_PANEL_VERSION !== "string") return;
        fetch("/api/panel-version", { cache: "no-store" })
          .then(function(r){ return r.json(); })
          .then(function(d){
            if(d && d.ok && typeof d.hash === "string" && d.hash !== window.__ONZE_PANEL_VERSION){
              showUpdateBanner();
            }
          })
          .catch(function(){});
      }
      setInterval(checkVersion, CHECK_INTERVAL_MS);
    })();
  