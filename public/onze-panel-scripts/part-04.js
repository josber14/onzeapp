
/* ===== ONZE P2P BOT ===== */
(function(){
  let botSelectedExchange = "binance";
  // Cronómetros del ciclo en vivo, UNO POR CUENTA (label) -- Bybit/OKX
  // siempre corren bajo "ONZE" (cuenta única) mientras Binance puede correr
  // bajo "ONZE" o "ZINPLE". Antes había un solo cronómetro compartido para
  // todo el panel: si Binance corría bajo ZINPLE y el usuario entraba a la
  // pestaña Bybit (que fuerza "ONZE") y tocaba Iniciar/Detener, el código
  // veía una cuenta distinta a la que estaba corriendo y apagaba el único
  // cronómetro que existía -- dejando a Binance/ZINPLE sin nadie pidiéndole
  // ciclos al servidor, aunque en la base de datos siguiera "activo". Bug
  // real confirmado en vivo (ago 2026): "al cambiar a Bybit se para
  // Binance, y al volver a Binance se para Bybit". Con un cronómetro por
  // cuenta, entrar/salir de las pestañas Binance/Bybit nunca toca el
  // cronómetro de la otra cuenta.
  // Forma: { [label]: { active, timer, chatActive, chatTimer } }
  let botCyclesByLabel = {};
  function getBotCycleEntry(label){
    const key = label || "ONZE";
    if(!botCyclesByLabel[key]) botCyclesByLabel[key] = { active: false, timer: null, chatActive: false, chatTimer: null };
    return botCyclesByLabel[key];
  }
  function botStopCycleForLabel(label){
    const entry = botCyclesByLabel[label || "ONZE"];
    if(!entry) return;
    entry.active = false;
    entry.chatActive = false;
    if(entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    if(entry.chatTimer) clearTimeout(entry.chatTimer);
    entry.chatTimer = null;
  }
  // Cronómetro local del contador "Límite Binance" — el dato real (resetEnMs)
  // solo llega cada vez que responde /api/p2p/bot/cycle (varios segundos entre
  // respuestas, no cada 1s), así que mostrarlo directo se ve "pegado" y salta.
  // Este timer cuenta hacia atrás cada segundo en el navegador, resincronizado
  // con el servidor en cada respuesta nueva (botRateLimitResetAt).
  let botRateLimitResetAt = 0;
  let botRateLimitHidden = false;
  let botRateLimitTickTimer = null;
  function botRateLimitTick(){
    const el = document.getElementById('botKpiRateLimitSub');
    if(!el) return;
    if(botRateLimitHidden){
      el.textContent = '🔒 anuncio oculto (recuperando)';
      el.style.color = '#ef4444';
      return;
    }
    const resetS = Math.max(0, Math.round((botRateLimitResetAt - Date.now()) / 1000));
    el.textContent = resetS > 0 ? 'libera cupo en ' + resetS + 's' : 'con cupo libre';
    el.style.color = '#64748b';
  }
  if(!botRateLimitTickTimer) botRateLimitTickTimer = setInterval(botRateLimitTick, 1000);

function addP2PBotStyles(){
  if(document.getElementById("onze-bot-styles")) return;
  const style = document.createElement("style");
  style.id = "onze-bot-styles";
  style.textContent = `
    /* ===== TRADING DASHBOARD THEME ===== */
    .bot-view-inner{display:flex;flex-direction:column;gap:16px;}
    .bot-exchange-tabs{display:flex;gap:6px;flex-wrap:wrap;}
    .bot-exchange-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:12px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.5);color:#94a3b8;cursor:pointer;font-weight:700;font-size:13px;transition:all .15s;font-family:inherit;backdrop-filter:blur(8px);}
    .bot-exchange-btn:hover{border-color:rgba(148,163,184,.3);background:rgba(15,23,42,.7);color:#e2e8f0;}
    .bot-exchange-btn.active{border-color:var(--brand);background:linear-gradient(135deg,rgba(37,99,235,.2),rgba(37,99,235,.08));color:#fff;box-shadow:0 0 20px rgba(37,99,235,.15),inset 0 1px 0 rgba(255,255,255,.06);}
    .bot-exchange-btn img,.bot-exchange-btn svg{width:20px;height:20px;flex:0 0 auto;border-radius:3px;}
    .bot-exchange-btn .exchange-label{font-size:12px;}
    .bot-control-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px;background:rgba(15,23,42,.35);border:1px solid rgba(148,163,184,.08);border-radius:14px;backdrop-filter:blur(8px);}
    .bot-control-row .btn{font-size:12px;padding:8px 18px;border-radius:8px;font-weight:700;letter-spacing:.2px;}
    .bot-buyprice-card{display:inline-flex;align-items:center;gap:12px;padding:6px 16px 6px 14px;border-radius:10px;background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(16,185,129,.02));border:1px solid rgba(16,185,129,.15);margin-left:auto;}
    .bot-buyprice-card .ticker{display:flex;flex-direction:column;gap:1px;}
    .bot-buyprice-card .label{font-size:9px;color:#6ee7b7;font-weight:600;text-transform:uppercase;letter-spacing:.5px;}
    .bot-buyprice-card .value{font-size:20px;font-weight:900;color:#34d399;line-height:1.1;font-variant-numeric:tabular-nums;}
    .bot-buyprice-card .unit{font-size:10px;color:#6ee7b7;font-weight:600;margin-left:1px;}
    .bot-buyprice-card .provider{font-size:10px;color:#64748b;}
    @keyframes botTicker{0%{opacity:1;}50%{opacity:.5;}100%{opacity:1;}}
    .bot-buyprice-card .ticker.pulse{animation:botTicker 2s ease-in-out infinite;}
    .bot-section{margin-top:8px;}
    .bot-section-title{font-size:13px;font-weight:700;color:#e2e8f0;margin:0 0 10px;display:flex;align-items:center;gap:8px;letter-spacing:.2px;}
    .bot-section-title .badge{font-size:9px;background:rgba(99,102,241,.15);color:#818cf8;padding:2px 8px;border-radius:8px;font-weight:500;}

    /* KPI Cards */
    .bot-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;}
    .bot-kpi{display:flex;flex-direction:column;padding:12px 14px;background:rgba(15,23,42,.35);border:1px solid rgba(148,163,184,.08);border-radius:12px;backdrop-filter:blur(8px);transition:border-color .15s;}
    .bot-kpi:hover{border-color:rgba(148,163,184,.18);}
    .bot-kpi .kpi-label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:600;}
    .bot-kpi .kpi-value{font-size:20px;font-weight:800;color:#f1f5f9;margin-top:2px;font-variant-numeric:tabular-nums;}
    .bot-kpi .kpi-sub{font-size:10px;color:#64748b;margin-top:1px;}
    .bot-kpi .kpi-trend{font-size:10px;font-weight:600;margin-top:2px;}

    /* Status Indicator */
    .bot-status-indicator{display:inline-flex;align-items:center;gap:8px;padding:5px 14px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.2px;}
    .bot-status-indicator.running{color:#34d399;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.2);}
    .bot-status-indicator.stopped{color:#94a3b8;background:rgba(148,163,184,.08);border:1px solid rgba(148,163,184,.15);}
    .bot-status-indicator.paused{color:#fbbf24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.2);}
    .bot-status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;}
    .bot-status-dot.running{background:#34d399;box-shadow:0 0 10px rgba(52,211,153,.5);animation:pulse-dot 1.5s infinite;}
    .bot-status-dot.stopped{background:#64748b;}
    .bot-status-dot.paused{background:#fbbf24;}
    @keyframes pulse-dot{0%,100%{opacity:1;}50%{opacity:.3;}}

    /* Config Grid */
    .bot-config-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
    .bot-config-grid label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:#94a3b8;font-weight:600;letter-spacing:.2px;}
    .bot-config-grid input,.bot-config-grid select{padding:7px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.5);color:#f8fafc;font-size:13px;outline:none;font-family:inherit;transition:border-color .15s;}
    .bot-config-grid input:focus,.bot-config-grid select:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.1);}
    .bot-config-grid input::placeholder{color:#475569;}
    .bot-config-grid .help-text{font-size:9px;color:#475569;margin-top:1px;}

    /* Credentials */
    .bot-cred-fields{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;}
    .bot-cred-fields label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:#94a3b8;font-weight:600;}
    .bot-cred-fields input{padding:7px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.5);color:#f8fafc;font-size:13px;outline:none;font-family:inherit;transition:border-color .15s;}
    .bot-cred-fields input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.1);}

    /* Log Container */
    .bot-log-container{max-height:260px;overflow-y:auto;border:1px solid rgba(148,163,184,.08);border-radius:10px;background:rgba(15,23,42,.25);backdrop-filter:blur(4px);}
    .bot-log-entry{padding:7px 12px;font-size:11px;line-height:1.5;border-bottom:1px solid rgba(148,163,184,.04);display:flex;align-items:flex-start;gap:6px;}
    .bot-log-entry:last-child{border-bottom:none;}
    .bot-log-entry.info{border-left:2px solid var(--brand);}
    .bot-log-entry.warn{border-left:2px solid #fbbf24;}
    .bot-log-entry.error{border-left:2px solid #fb7185;background:rgba(251,113,133,.04);}
    .bot-log-time{color:#475569;font-size:10px;white-space:nowrap;flex:0 0 auto;font-variant-numeric:tabular-nums;}
    .bot-log-msg{color:#cbd5e1;flex:1;overflow-wrap:break-word;word-break:break-word;min-width:0;}
    .bot-log-exchange{display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;background:rgba(148,163,184,.08);color:#94a3b8;text-transform:uppercase;flex:0 0 auto;}

    /* Orders Container */
    .bot-orders-container{max-height:300px;overflow-y:auto;}
    .bot-order-card{transition:border-color .15s, box-shadow .15s;}
    .bot-order-card:hover{border-color:rgba(148,163,184,.15) !important;box-shadow:0 2px 12px rgba(0,0,0,.2);}
    /* Chat overlay */
    #botOrderChatOverlay{transition:opacity .15s ease;}
    #botOrderChatOverlay[style*="display: block"]{opacity:1;}
    #botOrderChatMessages::-webkit-scrollbar{width:4px;}
    /* Fondo del chat, 8va vuelta (sep 2026): probando un wallpaper de íconos
       de videojuegos (public/images/chat-bg-gaming.jpg, sin marca de agua,
       confirmado) -- viene diseñado como wallpaper completo de una pantalla
       (no como tile chico), así que va a "cover" igual que el anterior. Un
       velo oscuro semitransparente liviano encima para legibilidad. */
    .bot-chat-canvas{
      background-color:#0b0e11;
      background-image:
        linear-gradient(rgba(11,14,17,.25), rgba(11,14,17,.25)),
        url('/images/chat-bg-gaming.jpg');
      background-repeat:no-repeat, no-repeat;
      background-position:center, center;
      background-size:auto, cover;
    }
    .bot-chat-bubble{box-shadow:0 2px 8px rgba(0,0,0,.22);}
    /* Chat como panel lateral acoplable en escritorio (pedido explícito del
       usuario, sep 2026): poder seguir cambiando precio u otra cosa del
       panel mientras el chat sigue abierto con alguien. Mismo límite de
       700px que ya usa el resto del panel para distinguir escritorio de
       móvil -- en móvil se deja exactamente como estaba (pantalla
       completa). pointer-events:none en el overlay + auto en el chat
       mismo deja pasar los clics al resto de la página en el área que el
       panel lateral no cubre. */
    @media (min-width: 701px){
      #botOrderChatOverlay{
        background:transparent!important;
        backdrop-filter:none!important;
        pointer-events:none;
        transition:none;
      }
      #botOrderChatOverlay > div{
        pointer-events:auto;
        /* Bug real confirmado en vivo (sep 2026): el estilo inline original
           trae "margin:0 auto" (centrado -- margen automático en LOS DOS
           lados). Yo solo había anulado margin-left, dejando margin-right
           todavía en auto -- con los dos lados en auto, el navegador
           reparte el espacio sobrante por igual en ambos, es decir, queda
           CENTRADO en vez de pegado a la derecha ("atravesado en el
           medio", como lo describió el usuario). Hay que anular los DOS. */
        margin-left:auto!important;
        margin-right:0!important;
        max-width:400px!important;
        width:400px!important;
        height:100%!important;
        box-shadow:-10px 0 36px rgba(0,0,0,.5);
        border-left:1px solid rgba(148,163,184,.12);
      }
      /* display:none simple en vez de una animación de deslizamiento -- se
         probó con transform:translateX() y, por alguna razón no resuelta
         (una regla con más especificidad + !important no se aplicaba pese
         a confirmarse el match del selector), no se reflejaba en pantalla.
         display:none es inequívoco y no depende de esa duda. */
      #botOrderChatOverlay.bot-chat-collapsed > div{
        display:none!important;
      }
    }
    /* Lista de chats desplegable a la izquierda del chat acoplado (pedido
       explícito del usuario, sep 2026) -- panel aparte, pegado justo a la
       izquierda del chat de 400px, para cambiar de conversación sin cerrar
       el chat actual. Solo aplica en escritorio (chat acoplado), igual que
       el resto de este bloque. */
    #botChatListPanel{
      display:none;
      position:fixed;
      top:0;
      right:400px;
      bottom:0;
      width:320px;
      background:linear-gradient(180deg,rgba(15,20,32,.99),rgba(9,13,22,.99));
      border-left:1px solid rgba(148,163,184,.12);
      box-shadow:-10px 0 30px rgba(0,0,0,.4);
      z-index:999998;
      flex-direction:column;
    }
    #botChatListPanel.show{display:flex;}
    #botChatListHeader{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(148,163,184,.1);}
    #botChatListHeader h3{margin:0;font-size:14px;font-weight:700;color:#f1f5f9;}
    #botChatListItems{flex:1;overflow-y:auto;}
    /* Panel de "Órdenes" desplegable a la izquierda del chat acoplado
       (pedido explícito del usuario, sep 2026) -- misma mecánica que
       #botChatListPanel de arriba, pero muestra la pestaña "Ordenes"
       COMPLETA (filtros, Liberar, etc.) moviendo ese mismo nodo del DOM
       hacia acá en vez de duplicar todo su HTML/JS. Solo uno de los dos
       paneles (chats u órdenes) se muestra a la vez. */
    #botChatOrdersPanel{
      display:none;
      position:fixed;
      top:0;
      right:400px;
      bottom:0;
      width:380px;
      background:linear-gradient(180deg,rgba(15,20,32,.99),rgba(9,13,22,.99));
      border-left:1px solid rgba(148,163,184,.12);
      box-shadow:-10px 0 30px rgba(0,0,0,.4);
      z-index:999998;
      flex-direction:column;
    }
    #botChatOrdersPanel.show{display:flex;}
    #botChatOrdersPanelHeader{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(148,163,184,.1);}
    #botChatOrdersPanelHeader h3{margin:0;font-size:14px;font-weight:700;color:#f1f5f9;}
    /* Bug real confirmado en vivo (sep 2026): la lista de órdenes
       (#botPanelOrdersList) trae de fábrica un alto fijo de 350px pensado
       para el modal chiquito original -- acá, adentro de este panel que
       ocupa el alto completo de la pantalla, eso dejaba un hueco vacío
       abajo en vez de estirarse. Se vuelve todo un flex vertical: lo de
       arriba (pestañas, filtros) mantiene su alto normal, y la lista
       ocupa y scrollea sola el resto del espacio disponible. */
    #botChatOrdersPanelBody{flex:1;overflow:hidden;padding:14px 16px;display:flex;flex-direction:column;}
    #botChatOrdersPanelBody #botPanelOrders{position:relative;display:flex;flex-direction:column;flex:1;min-height:0;}
    #botChatOrdersPanelBody #botPanelOrdersList{flex:1;min-height:0;max-height:none!important;}
    /* Círculo con la inicial del nombre, donde iría la foto -- pedido
       explícito del usuario (sep 2026), igual a como Binance lo muestra en
       su propia lista de chats. */
    .bot-chat-list-item{position:relative;display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(148,163,184,.06);cursor:pointer;transition:background .12s;}
    .bot-chat-list-item:hover{background:rgba(148,163,184,.06);}
    .bot-chat-list-item.active{background:rgba(37,99,235,.12);border-left:2px solid var(--brand);}
    .bot-chat-avatar{position:relative;flex-shrink:0;width:36px;height:36px;border-radius:50%;background:#475569;color:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;}
    .bot-chat-list-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;}
    .bot-chat-list-item .name{font-size:13px;font-weight:600;color:#e2e8f0;}
    .bot-chat-list-item .name .realname{font-size:12px;font-weight:500;color:#8fd9c4;}
    .bot-chat-list-item .meta{font-size:11px;color:#8391a8;}
    #botChatReopenTab{
      display:none;
      position:fixed;
      top:50%;
      right:0;
      transform:translateY(-50%);
      z-index:999998;
      background:linear-gradient(135deg,#2f6ff0,#2451c9);
      color:#fff;
      padding:12px 10px;
      border-radius:10px 0 0 10px;
      box-shadow:-4px 0 16px rgba(0,0,0,.35);
      cursor:pointer;
      font-size:13px;
      font-weight:600;
      writing-mode:vertical-rl;
      text-orientation:mixed;
    }
    #botChatReopenTab.show{display:flex;align-items:center;gap:6px;}
    @media (min-width: 701px){
      #botChatCollapseBtn, #botChatListToggleBtn, #botChatOrdersToggleBtn{display:flex!important;}
    }
    /* Orders tabs */
    .bot-orders-main-tab{background:transparent;border:none;color:#64748b;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;transition:color .15s,border-color .15s;}
    .bot-orders-main-tab:hover{color:#94a3b8;}
    .bot-orders-main-tab.active{color:#e2e8f0;border-bottom-color:var(--brand);}
    .bot-orders-filter{background:transparent;border:1px solid rgba(148,163,184,.1);color:#94a3b8;padding:3px 10px;font-size:11px;border-radius:14px;cursor:pointer;transition:all .12s;}
    .bot-orders-filter:hover{border-color:rgba(148,163,184,.25);color:#cbd5e1;}
    .bot-orders-filter.active{background:rgba(37,99,235,.12);border-color:var(--brand);color:var(--brand);}
    .bot-orders-icon-btn{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.4);color:#94a3b8;cursor:pointer;transition:all .12s;}
    .bot-orders-icon-btn:hover{border-color:rgba(148,163,184,.25);color:#cbd5e1;background:rgba(15,23,42,.6);}
    .bot-orders-icon-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
    .bot-orders-filter-dropdown select:focus,.bot-orders-filter-dropdown input:focus{outline:none;border-color:var(--brand);}

    /* Accounts Grid */
    .bot-accounts-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
    .bot-account-card{background:rgba(15,23,42,.35);border:1px solid rgba(148,163,184,.08);border-radius:10px;padding:12px;transition:border-color .15s;}
    .bot-account-card:hover{border-color:rgba(148,163,184,.18);}
    .bot-account-card .acct-label{font-weight:700;color:#f1f5f9;font-size:13px;}
    .bot-account-card .acct-detail{font-size:11px;color:#94a3b8;margin-top:3px;line-height:1.5;}
    .bot-account-card .acct-actions{display:flex;gap:6px;margin-top:8px;justify-content:flex-end;}
    .acct-icon-btn{
      width:26px;height:26px;padding:0;display:inline-flex;align-items:center;justify-content:center;
      border-radius:7px;border:1px solid rgba(148,163,184,.15);background:rgba(148,163,184,.06);
      font-size:12px;line-height:1;cursor:pointer;transition:filter .15s,border-color .15s;
    }
    .acct-icon-btn:hover{filter:brightness(1.25);}
    .acct-icon-btn.is-warn{border-color:rgba(248,113,113,.25);background:rgba(220,38,38,.08);}
    .acct-icon-btn.is-ok{border-color:rgba(74,222,128,.3);background:rgba(22,163,74,.14);}
    .acct-icon-btn.is-danger{border-color:rgba(248,113,113,.2);background:rgba(127,29,29,.12);}
    .bot-acct-btn{background:transparent;border:none;color:#94a3b8;cursor:pointer;transition:all .15s;}
    .bot-acct-btn.active{background:rgba(0,212,255,.12);color:#00d4ff;}
    .p2p-resumen-tab{background:rgba(148,163,184,.08);border:1px solid rgba(148,163,184,.15);color:#94a3b8;cursor:pointer;transition:all .15s;padding:5px 14px;border-radius:999px;font-size:12px;font-weight:700;}
    .p2p-resumen-tab.active{background:rgba(52,211,153,.14);border-color:rgba(52,211,153,.35);color:#34d399;}
    .ajustes-acct-btn{background:transparent;border:none;color:#94a3b8;cursor:pointer;transition:all .15s;}
    .ajustes-acct-btn.active{background:rgba(0,212,255,.12);color:#00d4ff;}

    /* Chat */
    .bot-chat-box{max-height:200px;overflow-y:auto;border:1px solid rgba(148,163,184,.08);border-radius:8px;padding:8px;background:rgba(15,23,42,.25);}
    .bot-chat-msg{padding:5px 10px;border-radius:6px;margin-bottom:4px;font-size:12px;background:rgba(37,99,235,.08);border-left:2px solid var(--brand);}
    .bot-chat-msg .sender{font-weight:700;color:#cbd5e1;}
    .bot-chat-msg .text{color:#e2e8f0;}
    .bot-chat-msg .time{font-size:10px;color:#64748b;margin-left:8px;}

    /* Panel Tabs */
    .bot-panel-tab{padding:8px 18px;border-radius:8px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.4);color:#94a3b8;cursor:pointer;font-weight:600;font-size:12px;transition:all .15s;font-family:inherit;}
    .bot-panel-tab:hover{border-color:rgba(148,163,184,.25);color:#e2e8f0;background:rgba(15,23,42,.6);}
    .bot-panel-tab.active{background:var(--brand);border-color:var(--brand);color:#fff;box-shadow:0 0 20px rgba(37,99,235,.2);}
    .bot-panel-tab-content{animation:fadeIn .2s ease;}

    /* Panel Modal - Full screen */
    #botPanelModal .modal-dialog{max-width:1100px;width:95vw;}
    #botPanelModal .modal-card{max-width:100% !important;background:linear-gradient(145deg,rgba(15,23,42,.97),rgba(15,23,42,.99));border:1px solid rgba(148,163,184,.1);border-radius:16px;backdrop-filter:blur(20px);box-shadow:0 25px 80px rgba(0,0,0,.5);}
    #botPanelModal .modal-head{border-bottom:1px solid rgba(148,163,184,.08);padding:16px 20px;}
    #botPanelModal .modal-head .modal-title{font-size:16px;font-weight:800;color:#f1f5f9;letter-spacing:.2px;}
    #botPanelModal .modal-head .close-btn{width:32px;height:32px;border-radius:8px;border:1px solid rgba(148,163,184,.1);background:rgba(15,23,42,.5);color:#94a3b8;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;}
    #botPanelModal .modal-head .close-btn:hover{border-color:rgba(248,113,113,.3);background:rgba(248,113,113,.1);color:#fb7185;}
    #botPanelModal .modal-content{padding:16px 20px;max-height:75vh;overflow-y:auto;}

    /* Stat cards (small) */
    #botMercadoStats{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;width:100%;}
    .stat-card-sm{display:flex;flex-direction:column;background:linear-gradient(135deg,rgba(15,23,42,.5),rgba(15,23,42,.3));border:1px solid rgba(148,163,184,.08);border-radius:10px;padding:10px 14px;min-width:0;overflow:hidden;}
    .stat-card-sm .stat-label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600;}
    .stat-card-sm .stat-value{font-size:15px;font-weight:800;color:#f1f5f9;font-variant-numeric:tabular-nums;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

    /* Market sections */
    .mercado-section-title{font-size:12px;font-weight:700;color:#e2e8f0;margin:14px 0 8px;display:flex;align-items:center;gap:8px;letter-spacing:.2px;}
    .mercado-section-title .badge{font-size:9px;background:rgba(99,102,241,.12);color:#818cf8;padding:2px 7px;border-radius:8px;font-weight:500;}

    /* Oráculo de mercado */
    .oracle-wrap{border:1px solid rgba(99,102,241,.22);border-radius:16px;background:linear-gradient(160deg,rgba(30,27,75,.35),rgba(15,23,42,.5));padding:14px;}
    .oracle-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;}
    .oracle-head-title{font-size:13px;font-weight:800;color:#e2e8f0;display:flex;align-items:center;gap:6px;}
    .oracle-head-meta{font-size:10px;color:#64748b;display:flex;align-items:center;gap:8px;}
    .oracle-direction{border:1px solid rgba(99,102,241,.18);background:rgba(15,23,42,.4);border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;}
    .oracle-direction .od-left{display:flex;align-items:center;gap:10px;}
    .oracle-streak{font-size:10px;font-weight:700;color:#fbbf24;background:rgba(251,191,36,.1);padding:2px 8px;border-radius:8px;margin-left:6px;}
    .oracle-badge{font-size:11px;font-weight:800;padding:6px 12px;border-radius:10px;white-space:nowrap;}
    .oracle-badge.up{background:rgba(52,211,153,.14);color:#34d399;}
    .oracle-badge.down{background:rgba(251,113,133,.14);color:#fb7185;}
    .oracle-badge.flat{background:rgba(148,163,184,.14);color:#94a3b8;}
    .oracle-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;}
    @media (max-width:700px){ .oracle-grid{grid-template-columns:1fr;} }
    .oracle-card{border:1px solid rgba(148,163,184,.1);background:rgba(15,23,42,.4);border-radius:14px;padding:12px;}
    .oracle-card-title{font-size:11px;font-weight:700;color:#94a3b8;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
    .oracle-score-value{font-size:34px;font-weight:900;font-variant-numeric:tabular-nums;}
    .oracle-score-bar{height:6px;border-radius:4px;background:rgba(148,163,184,.12);margin-top:8px;overflow:hidden;}
    .oracle-score-bar > div{height:100%;border-radius:4px;}
    .oracle-mini-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;font-size:10px;}
    .oracle-mini-row div{background:rgba(15,23,42,.5);border-radius:8px;padding:5px 8px;color:#94a3b8;display:flex;justify-content:space-between;}
    .oracle-mini-row span{color:#e2e8f0;font-weight:700;}
    .oracle-obi-bar{height:22px;border-radius:6px;overflow:hidden;display:flex;font-size:10px;font-weight:800;margin-top:6px;}
    .oracle-obi-bar .buy{background:#34d399;color:#022c22;display:flex;align-items:center;padding-left:6px;}
    .oracle-obi-bar .sell{background:#fb7185;color:#450a0a;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;}
    .oracle-obi-pct{display:flex;justify-content:space-between;font-size:10px;margin-top:4px;}
    .oracle-history{display:flex;gap:3px;margin-top:10px;height:26px;align-items:flex-end;}
    .oracle-history > div{flex:1;border-radius:3px 3px 0 0;min-height:3px;}
    .oracle-mini-stat{display:flex;justify-content:space-between;background:rgba(15,23,42,.5);border-radius:8px;padding:8px 10px;margin-top:8px;font-size:11px;color:#94a3b8;}
    .oracle-mini-stat strong{color:#e2e8f0;font-size:13px;}
    .oracle-recommend{border:1px solid rgba(99,102,241,.25);background:rgba(30,27,75,.4);border-radius:14px;padding:12px 14px;font-size:12px;color:#cbd5e1;line-height:1.5;}
    .oracle-recommend .head{display:flex;align-items:center;gap:8px;font-weight:800;color:#a5b4fc;margin-bottom:6px;font-size:12px;}
    .oracle-recommend .score-tag{font-size:10px;background:rgba(99,102,241,.16);color:#a5b4fc;padding:2px 8px;border-radius:8px;margin-left:auto;}

    /* Merchant cards */
    .merchant-card{background:linear-gradient(135deg,rgba(15,23,42,.45),rgba(15,23,42,.25));border:1px solid rgba(148,163,184,.08);border-radius:10px;padding:10px 14px;flex:1;min-width:160px;max-width:220px;transition:all .15s;}
    .merchant-card:hover{border-color:rgba(148,163,184,.2);transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.2);}
    .merchant-card .m-rank{font-size:10px;font-weight:700;color:#fbbf24;margin-bottom:2px;}
    .merchant-card .m-name{font-size:12px;font-weight:600;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .merchant-card .m-price{font-size:16px;font-weight:800;color:#34d399;font-variant-numeric:tabular-nums;margin-top:1px;}
    .merchant-card .m-meta{display:flex;gap:8px;margin-top:3px;font-size:10px;color:#64748b;flex-wrap:wrap;}
    .merchant-card .m-meta span{display:flex;align-items:center;gap:3px;}
    .merchant-card .m-banks{display:flex;flex-wrap:wrap;gap:2px;margin-top:4px;}
    .merchant-card .m-bank-chip{background:rgba(99,102,241,.1);color:#818cf8;padding:1px 5px;border-radius:3px;font-size:8px;}

    /* Bank bars */
    .bank-bar{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;}
    .bank-bar .bank-name{min-width:80px;color:#cbd5e1;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;}
    .bank-bar .bank-track{flex:1;height:16px;background:rgba(15,23,42,.4);border-radius:3px;overflow:hidden;}
    .bank-bar .bank-fill{height:100%;border-radius:3px;transition:width .4s ease;display:flex;align-items:center;justify-content:flex-end;padding-right:3px;font-size:8px;color:#fff;font-weight:700;min-width:18px;background:linear-gradient(90deg,rgba(99,102,241,.5),rgba(99,102,241,.8));}
    .bank-bar .bank-pct{min-width:30px;text-align:right;color:#64748b;font-size:10px;font-variant-numeric:tabular-nums;}

    /* Insight cards */
    .insight-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(130px,1fr));gap:8px;}
    .insight-card{background:linear-gradient(135deg,rgba(15,23,42,.4),rgba(15,23,42,.2));border:1px solid rgba(148,163,184,.06);border-radius:10px;padding:10px;text-align:center;}
    .insight-card .i-value{font-size:17px;font-weight:800;color:#f1f5f9;font-variant-numeric:tabular-nums;}
    .insight-card .i-label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-top:2px;font-weight:600;}
    .insight-card .i-sub{font-size:10px;color:#64748b;margin-top:1px;}

    /* Orders */
    .bot-order-actions{display:flex;gap:6px;flex-wrap:wrap;}
    .bot-order-actions .btn{min-height:30px;padding:4px 12px;font-size:11px;border-radius:6px;}

    /* Ads / Accounts Panel */
    .bot-panel-form{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:14px;background:rgba(15,23,42,.3);border:1px solid rgba(148,163,184,.08);border-radius:12px;margin-bottom:12px;}
    .bot-panel-form .full{grid-column:1/-1;}
    .bot-panel-form label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:#94a3b8;font-weight:600;}
    .bot-panel-form input,.bot-panel-form select{width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.5);color:#f8fafc;font-size:12px;font-family:inherit;box-sizing:border-box;transition:border-color .15s;}
    .bot-panel-form input:focus,.bot-panel-form select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.1);}
    .bot-panel-form .radio-group{display:flex;gap:12px;align-items:center;padding:4px 0;}
    .bot-panel-form .radio-group label{flex-direction:row;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:#cbd5e1;}
    .bot-panel-form .radio-group input[type=radio]{width:auto;}
    .bot-panel-form .form-row{display:flex;gap:8px;align-items:flex-end;}
    .bot-panel-form .form-row > *{flex:1;}
    .bot-panel-form .form-row .btn{flex:0 0 auto;}
    .bot-payment-methods{display:flex;flex-wrap:wrap;gap:4px;padding:4px 0;}
    .bot-payment-methods .pm-chip{display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:16px;font-size:11px;background:rgba(37,99,235,.12);border:1px solid rgba(37,99,235,.2);color:#93c5fd;cursor:pointer;transition:all .1s;}
    .bot-payment-methods .pm-chip.selected{background:rgba(37,99,235,.3);border-color:var(--brand);color:#fff;}
    .bot-payment-methods .pm-chip .remove{color:#fb7185;font-size:13px;line-height:1;margin-left:2px;}
    .bot-payment-input{display:flex;gap:6px;}
    .bot-payment-input input{flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.5);color:#f8fafc;font-size:12px;font-family:inherit;}
    .bot-ads-list{display:flex;flex-direction:column;gap:8px;max-height:400px;overflow-y:auto;}
    .bot-ad-card{background:rgba(15,23,42,.35);border:1px solid rgba(148,163,184,.08);border-radius:12px;padding:14px;transition:border-color .15s,box-shadow .15s;}
    .bot-ad-card:hover{border-color:rgba(148,163,184,.16);box-shadow:0 1px 6px rgba(0,0,0,.15);}
    .bot-ad-card .ad-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;}
    .bot-ad-card .ad-header .ad-type{font-weight:700;font-size:12px;padding:3px 10px;border-radius:6px;}
    .bot-ad-card .ad-header .ad-type.buy{color:#34d399;background:rgba(52,211,153,.1);}
    .bot-ad-card .ad-header .ad-type.sell{color:#fb7185;background:rgba(251,113,133,.1);}
    .bot-ad-card .ad-body{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px;font-size:11px;color:#94a3b8;}
    .bot-ad-card .ad-body span{display:flex;flex-direction:column;}
    .bot-ad-card .ad-body .val{color:#cbd5e1;font-weight:600;font-variant-numeric:tabular-nums;}
    .bot-ad-card .ad-footer{display:flex;justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:6px;}
    .bot-ad-card .ad-status{font-size:10px;padding:3px 10px;border-radius:6px;font-weight:600;}
    .bot-ad-card .ad-status.online,
    .bot-ad-card .ad-status.active{background:rgba(52,211,139,.12);color:#34d399;}
    .bot-ad-card .ad-status.private{background:rgba(251,191,36,.12);color:#fbbf24;}
    .bot-ad-card .ad-status.offline{background:rgba(148,163,184,.12);color:#94a3b8;}
    .bot-ad-card .ad-actions{display:flex;align-items:center;gap:4px;}
    .bot-ad-card .ad-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;border:1px solid rgba(148,163,184,.08);background:rgba(15,23,42,.4);color:#94a3b8;cursor:pointer;transition:all .12s;}
    .bot-ad-card .ad-icon-btn:hover{background:rgba(148,163,184,.08);color:#e2e8f0;border-color:rgba(148,163,184,.15);}
    .bot-ad-card .ad-icon-btn.danger:hover{background:rgba(248,113,113,.08);color:#fb7185;border-color:rgba(248,113,113,.15);}
    .bot-ad-card .ad-icon-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
    /* Mismo look del "ad-icon-btn" de arriba pero sin depender de estar
       dentro de .bot-ad-card -- pedido explícito del usuario (sep 2026): el
       botón de borrar venta manual se veía como un botón grande con borde
       rojo (.btn.small.danger), quería el mismo cuadrito discreto que usan
       los anuncios. */
    .icon-btn-sm{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;border:1px solid rgba(148,163,184,.08);background:rgba(15,23,42,.4);color:#94a3b8;cursor:pointer;transition:all .12s;flex-shrink:0;}
    .icon-btn-sm:hover{background:rgba(248,113,113,.08);color:#fb7185;border-color:rgba(248,113,113,.15);}
    .icon-btn-sm svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
    .bot-ad-card .ad-actions .toggle-switch{width:36px;height:20px;}
    .bot-ad-card .ad-actions .toggle-switch .slider::before{width:16px;height:16px;}
    .ad-bot-config{margin-top:10px;border-top:1px solid rgba(148,163,184,.1);padding-top:10px;}
    .ad-bot-config-inner{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
    .ad-bot-config-inner label{display:flex;flex-direction:column;font-size:10px;color:#94a3b8;gap:2px;}
    .ad-bot-config-inner label input,.ad-bot-config-inner label select{padding:4px 6px;border-radius:4px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.5);color:#f8fafc;font-size:11px;outline:none;}
    .bot-panel-form .tag-list{display:flex;flex-wrap:wrap;gap:4px;}
    .bot-panel-form .tag-list .tag{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;font-size:10px;background:rgba(37,99,235,.12);color:#93c5fd;}
    .bot-panel-form .tag-list .tag .remove{color:#fb7185;cursor:pointer;font-size:12px;line-height:1;}

    /* Pro Ad Form */
    .bot-panel-form.af-pro{padding:0;background:transparent;border:none;margin:0;display:block;}
    .bot-panel-form.af-pro .af-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid rgba(148,163,184,.08);}
    .bot-panel-form.af-pro .af-header h3{margin:0;font-size:16px;font-weight:700;color:#f1f5f9;display:flex;align-items:center;gap:8px;}
    .bot-panel-form.af-pro .af-header h3 .af-badge{font-size:10px;font-weight:500;color:#94a3b8;background:rgba(148,163,184,.08);padding:2px 7px;border-radius:4px;letter-spacing:.3px;}
    .bot-panel-form.af-pro .af-header .af-close{background:none;border:none;color:#64748b;font-size:18px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:all .12s;line-height:1;}
    .bot-panel-form.af-pro .af-header .af-close:hover{background:rgba(248,113,113,.08);color:#fb7185;}
    .bot-panel-form.af-pro .af-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
    .bot-panel-form.af-pro .af-grid .af-full{grid-column:1/-1;}
    .bot-panel-form.af-pro .af-field{display:flex;flex-direction:column;gap:4px;}
    .bot-panel-form.af-pro .af-field label{font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.3px;text-transform:uppercase;}
    .bot-panel-form.af-pro .af-field input,.bot-panel-form.af-pro .af-field select{width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.5);color:#f8fafc;font-size:13px;font-family:inherit;box-sizing:border-box;transition:border-color .15s,box-shadow .15s;}
    .bot-panel-form.af-pro .af-field input:focus,.bot-panel-form.af-pro .af-field select:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.12);}
    .bot-panel-form.af-pro .af-field input::placeholder{color:#475569;}
    .bot-panel-form.af-pro .af-field .af-input-wrap{position:relative;display:flex;align-items:center;}
    .bot-panel-form.af-pro .af-field .af-input-wrap input{flex:1;padding-right:50px;}
    .bot-panel-form.af-pro .af-field .af-input-wrap .af-suffix{position:absolute;right:10px;font-size:11px;color:#64748b;pointer-events:none;font-weight:500;}
    .bot-panel-form.af-pro .af-field .af-hint{font-size:11px;color:#64748b;margin-top:1px;}
    .bot-panel-form.af-pro .af-max-btn{position:absolute;right:4px;top:4px;bottom:4px;padding:0 10px;border:none;border-radius:5px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.5px;transition:opacity .12s;text-transform:uppercase;}
    .bot-panel-form.af-pro .af-max-btn:hover{opacity:.85;}
    .bot-panel-form.af-pro .af-toggle{display:flex;gap:4px;padding:2px;background:rgba(15,23,42,.4);border-radius:8px;border:1px solid rgba(148,163,184,.08);}
    .bot-panel-form.af-pro .af-toggle .af-toggle-btn{flex:1;padding:6px 0;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:all .15s;text-align:center;background:transparent;color:#64748b;}
    .bot-panel-form.af-pro .af-toggle .af-toggle-btn.active-buy{background:rgba(52,211,153,.15);color:#34d399;}
    .bot-panel-form.af-pro .af-toggle .af-toggle-btn.active-sell{background:rgba(251,113,133,.15);color:#fb7185;}
    .bot-panel-form.af-pro .af-toggle .af-toggle-btn input{display:none;}

    .bot-panel-form.af-pro .af-limits{display:flex;gap:8px;}
    .bot-panel-form.af-pro .af-limits .af-limit{flex:1;display:flex;flex-direction:column;gap:4px;}
    .bot-panel-form.af-pro .af-limits .af-limit input{padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.5);color:#f8fafc;font-size:13px;font-family:inherit;transition:border-color .15s,box-shadow .15s;}
    .bot-panel-form.af-pro .af-limits .af-limit input:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.12);}
    .bot-panel-form.af-pro .af-limits .af-limit .af-hint{font-size:10px;color:#64748b;}

    .bot-panel-form.af-pro .af-pm-wrap{display:flex;flex-wrap:wrap;gap:5px;}
    .bot-panel-form.af-pro .af-pm-wrap .af-pm-chip{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:20px;font-size:11px;font-weight:500;background:rgba(15,23,42,.4);border:1px solid rgba(148,163,184,.1);color:#cbd5e1;cursor:pointer;transition:all .12s;}
    .bot-panel-form.af-pro .af-pm-wrap .af-pm-chip:hover{border-color:rgba(148,163,184,.25);}
    .bot-panel-form.af-pro .af-pm-wrap .af-pm-chip.selected{background:rgba(59,130,246,.15);border-color:#3b82f6;color:#93c5fd;}
    .bot-panel-form.af-pro .af-pm-input{display:flex;gap:6px;margin-top:6px;}
    .bot-panel-form.af-pro .af-pm-input input{flex:1;padding:7px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.5);color:#f8fafc;font-size:12px;font-family:inherit;transition:border-color .15s;}
    .bot-panel-form.af-pro .af-pm-input input:focus{outline:none;border-color:#3b82f6;}
    .bot-panel-form.af-pro .af-pm-input .af-pm-add{padding:7px 14px;border:none;border-radius:8px;background:rgba(59,130,246,.15);color:#93c5fd;font-size:11px;font-weight:600;cursor:pointer;transition:all .12s;white-space:nowrap;}
    .bot-panel-form.af-pro .af-pm-input .af-pm-add:hover{background:rgba(59,130,246,.25);}
    .bot-panel-form.af-pro .af-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:4px;padding-top:14px;border-top:1px solid rgba(148,163,184,.08);}
    .bot-panel-form.af-pro .af-actions .af-btn-save{padding:9px 24px;border:none;border-radius:8px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .12s,transform .12s;}
    .bot-panel-form.af-pro .af-actions .af-btn-save:hover{opacity:.9;transform:translateY(-1px);}
    .bot-panel-form.af-pro .af-actions .af-btn-save:active{transform:translateY(0);}
    .bot-panel-form.af-pro .af-actions .af-btn-cancel{padding:9px 18px;border:none;border-radius:8px;background:rgba(148,163,184,.08);color:#94a3b8;font-size:13px;font-weight:500;cursor:pointer;transition:all .12s;}
    .bot-panel-form.af-pro .af-actions .af-btn-cancel:hover{background:rgba(148,163,184,.14);color:#cbd5e1;}

    /* Chart container */
    .bot-chart-wrap{background:rgba(15,23,42,.3);border:1px solid rgba(148,163,184,.06);border-radius:12px;padding:14px;position:relative;}

    /* Sub-header for panel */
    .bot-panel-sub{padding:0 20px 12px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid rgba(148,163,184,.06);}

    /* Two-column layout for main view */
    .bot-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
    .bot-cols-full{grid-column:1/-1;}
    .bot-card{background:rgba(15,23,42,.3);border:1px solid rgba(148,163,184,.06);border-radius:12px;padding:14px;}
    .bot-cycle-tile{background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.1);border-radius:10px;padding:9px 12px;}
    .bot-cycle-tile-label{font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px;}
    .bot-cycle-tile-value{font-size:14px;color:#e2e8f0;font-weight:700;}

    /* Config collapsible */
    .bot-config-toggle{display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 14px;font-size:11px;color:#64748b;font-weight:600;transition:all .15s;background:none;border:none;font-family:inherit;width:100%;text-align:left;border-top:1px solid rgba(148,163,184,.05);}
    .bot-config-toggle:hover{color:#94a3b8;background:rgba(148,163,184,.03);}
    .bot-config-toggle .arrow{transition:transform .2s;display:inline-flex;font-size:8px;color:#475569;}
    .bot-config-toggle .arrow.open{transform:rotate(180deg);}
    .bot-config-toggle .cfg-label{flex:1;}
    .bot-config-toggle .cfg-count{font-size:9px;background:rgba(148,163,184,.06);color:#64748b;padding:1px 7px;border-radius:4px;font-weight:500;}
    /* Ads row layout */
    .bot-ads-row{display:flex;flex-direction:column;gap:8px;}
    .bot-ad-pill{display:flex;flex-direction:column;border-radius:14px;background:rgba(15,23,42,.45);border:1px solid rgba(148,163,184,.08);transition:all .15s;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.15);}
    .bot-ad-pill:hover{border-color:rgba(148,163,184,.16);background:rgba(15,23,42,.55);box-shadow:0 2px 8px rgba(0,0,0,.2);}
    .bot-ad-pill.selected{border-color:var(--brand);background:rgba(37,99,235,.06);box-shadow:0 0 0 1px rgba(37,99,235,.15);}

    .bot-ad-card-header{display:flex;align-items:center;gap:10px;row-gap:6px;flex-wrap:wrap;padding:12px 14px 0;font-size:12px;font-weight:600;color:#e2e8f0;}

    .bot-ad-card-header .sell-label{display:inline-flex;align-items:center;gap:5px;color:#fb7185;font-weight:700;font-size:11px;background:rgba(251,113,133,.08);padding:2px 10px 2px 8px;border-radius:6px;letter-spacing:.3px;text-transform:uppercase;}
    .bot-ad-card-header .sell-label::before{content:'';width:6px;height:6px;border-radius:50%;background:#fb7185;}

    .bot-ad-card-header .status-badge{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;margin-left:auto;padding:3px 10px;border-radius:6px;white-space:nowrap;letter-spacing:.2px;}

    .bot-ad-card-header .status-badge .dot{width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 6px rgba(52,211,153,.4);}
    .bot-ad-card-header .status-badge.offline{background:rgba(100,116,139,.1);color:#94a3b8;}
    .bot-ad-card-header .status-badge.offline .dot{background:#64748b;box-shadow:none;}

    .bot-ad-card-body{padding:6px 14px 2px;display:flex;flex-direction:row;align-items:center;gap:16px;flex-wrap:wrap;}

    .bot-ad-card-price{font-size:24px;font-weight:800;color:#34d399;line-height:1.2;font-variant-numeric:tabular-nums;letter-spacing:-.3px;flex:0 0 auto;}
    .bot-ad-card-price .currency{font-size:12px;font-weight:600;color:#6ee7b7;margin-left:4px;}

    .bot-ad-card-pair{font-size:11px;color:#64748b;font-weight:500;flex:1 1 auto;min-width:0;}

    .bot-ad-card-rows{display:flex;flex-direction:column;gap:3px;padding:0 14px;font-size:11px;color:#94a3b8;min-width:0;}
    .bot-ad-card-rows .row{display:flex;align-items:center;gap:5px;padding:1px 0;}
    .bot-ad-card-rows .row .label{color:#64748b;font-size:10px;}
    .bot-ad-card-rows .row .value{color:#e2e8f0;font-weight:600;font-variant-numeric:tabular-nums;}
    .bot-ad-card-rows .row .sync-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;background:rgba(148,163,184,.06);color:#64748b;font-size:11px;cursor:pointer;transition:all .12s;flex-shrink:0;border:1px solid transparent;}
    .bot-ad-card-rows .row .sync-btn:hover{background:rgba(52,211,153,.1);color:#34d399;border-color:rgba(52,211,153,.2);}
    .bot-ad-card-rows .row .sync-btn:active{transform:rotate(180deg);}

    .bot-ad-card-methods{display:flex;flex-wrap:wrap;gap:4px;padding:4px 14px 8px;}
    .bot-ad-card-methods .pm-badge{font-size:10px;padding:2px 10px;border-radius:6px;background:rgba(37,99,235,.08);color:#93c5fd;font-weight:500;white-space:nowrap;border:1px solid rgba(37,99,235,.12);}

    .bot-ad-card-header .menu-btn{background:rgba(148,163,184,.06);border:1px solid transparent;color:#64748b;font-size:16px;cursor:pointer;padding:2px 8px;line-height:1;letter-spacing:1px;transition:all .12s;border-radius:6px;height:28px;display:flex;align-items:center;}
    .bot-ad-card-header .menu-btn:hover{background:rgba(148,163,184,.12);color:#e2e8f0;border-color:rgba(148,163,184,.1);}

    .bot-ad-menu-dropdown{position:fixed;background:#1e293b;border:1px solid rgba(148,163,184,.15);border-radius:8px;padding:4px;z-index:9999;min-width:150px;box-shadow:0 8px 24px rgba(0,0,0,.3);opacity:0;visibility:hidden;transition:opacity .12s,visibility .12s;}
    .bot-ad-menu-dropdown.open{opacity:1;visibility:visible;}
    .bot-ad-menu-dropdown .menu-item{display:block;width:100%;text-align:left;padding:8px 12px;background:none;border:none;color:#e2e8f0;font-size:13px;cursor:pointer;border-radius:6px;transition:background .1s;white-space:nowrap;}
    .bot-ad-menu-dropdown .menu-item:hover{background:rgba(148,163,184,.1);}
    .bot-ad-menu-dropdown .menu-item.danger{color:#ef4444;}
    .bot-ad-menu-dropdown .menu-item.danger:hover{background:rgba(239,68,68,.1);}

    /* iOS toggle switch */
    .toggle-switch{position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0;}
    .toggle-switch input{opacity:0;width:0;height:0;}
    .toggle-switch .slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#475569;border-radius:22px;transition:.2s;}
    .toggle-switch .slider::before{content:"";position:absolute;height:18px;width:18px;left:2px;bottom:2px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2);}
    .toggle-switch input:checked+.slider{background:#22c55e;}
    .toggle-switch input:checked+.slider::before{transform:translateX(18px);}
    /* Distingue el switch "Anuncio" (prende/apaga en Binance) del switch
       "Bot" -- ambos son toggle-switch idénticos y sin texto, fácil
       confundirlos y apagar el que no era (pedido explícito del usuario). */
    .toggle-switch-ad input:checked+.slider{background:#2563eb;}

    /* Mobile: colapsa a una sola columna las grillas que asumían escritorio.
       Sin esto, columnas con contenido ancho (ej. Ordenes) empujan a las
       angostas (ej. Actividad) a un ancho casi nulo, partiendo el texto
       letra por letra. */
    @media (max-width:700px){
      .bot-cols,
      .bot-config-grid,
      .bot-accounts-grid,
      .bot-panel-form,
      .bot-panel-form.af-pro .af-grid,
      .bot-ad-card .ad-body,
      .ad-bot-config-inner,
      .bot-filter-grid{grid-template-columns:1fr!important;}
      .bot-cred-fields{grid-template-columns:1fr!important;}
      #botFilterDateCustom{grid-template-columns:1fr!important;}
    }
  `;
  document.head.appendChild(style);
}

  function buildP2PBotView(){
    if(document.getElementById("view-p2p-bot")) return;

    const section = document.createElement("section");
    section.className = "view admin-only-view";
    section.id = "view-p2p-bot";
    section.innerHTML = `
    <section class="section-card">
      <div class="section-top">
        <div>
          <h2 class="section-title" style="font-size:18px;">P2P Bot</h2>
          <p class="section-text" style="margin-top:2px;font-size:12px;color:#64748b;">Bot autom\u00E1tico de P2P Market Making</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <div id="botAcctSwitcher" style="display:flex;gap:4px;margin-right:8px;border:1px solid rgba(148,163,184,.15);border-radius:8px;overflow:hidden;">
            <button class="btn bot-acct-btn active" data-label="ONZE" onclick="window.botSetActiveLabel('ONZE')" style="border-radius:0;padding:5px 14px;font-size:12px;font-weight:700;">ONZE</button>
            <button class="btn bot-acct-btn" data-label="ZINPLE" onclick="window.botSetActiveLabel('ZINPLE')" style="border-radius:0;padding:5px 14px;font-size:12px;font-weight:700;">ZINPLE</button>
          </div>
          <span id="botStatusIndicator" class="bot-status-indicator stopped">
            <span class="bot-status-dot stopped" id="botStatusDot"></span>
            <span id="botStatusText">Detenido</span>
          </span>
        </div>
      </div>

      <div class="bot-view-inner">
        <!-- Exchange Tabs -->
        <div class="bot-exchange-tabs" id="botExchangeTabs">
          <button class="bot-exchange-btn active" data-exchange="binance" onclick="window.botSelectExchange('binance')">
            <svg viewBox="0 0 127 127" width="20" height="20"><polygon fill="#F3BA2F" points="38.2,53.2 62.8,28.6 87.4,53.2 101.7,38.9 62.8,0 23.9,38.9"/><rect x="3.6" y="53.2" transform="matrix(0.7071 0.7071 -0.7071 0.7071 48.8 8.8)" fill="#F3BA2F" width="20.2" height="20.2"/><polygon fill="#F3BA2F" points="38.2,73.4 62.8,98 87.4,73.4 101.7,87.7 101.7,87.7 62.8,126.6 23.9,87.7 23.8,87.7"/><rect x="101.6" y="53.2" transform="matrix(-0.7071 0.7071 -0.7071 -0.7071 235.5 29.1)" fill="#F3BA2F" width="20.2" height="20.2"/><polygon fill="#F3BA2F" points="77.3,63.3 77.3,63.3 62.8,48.8 52,59.5 52,59.5 50.8,60.7 48.3,63.3 48.3,63.3 48.2,63.3 48.3,63.3 62.8,77.8 77.3,63.3 77.3,63.3"/></svg>
            <span class="exchange-label">Binance</span>
          </button>
          <button class="bot-exchange-btn" data-exchange="bybit" onclick="window.botSelectExchange('bybit')">
            <svg viewBox="0 0 2500 2500" width="20" height="20"><rect y="0" fill="#1B1B2F" width="2500" height="2500"/><polygon fill="#F7A600" points="1622,1408 1622,958 1713,958 1713,1408"/><path fill="#fff" d="M569,1542H375v-450h186c90,0,143,49,143,126c0,50-34,82-57,93c28,13,64,41,64,101c0,84-59,129-142,129V1542z M554,1171h-89v104h89c38,0,60-21,60-52S592,1171,554,1171z M560,1354h-94v111h94c41,0,61-25,61-56c0-30-20-55-60-55H560z"/><polygon fill="#fff" points="986,1357 986,1542 896,1542 896,1357 757,1092 856,1092 942,1273 1027,1092 1125,1092"/><path fill="#fff" d="M1382,1542h-194v-450h186c90,0,143,49,143,126c0,50-34,82-57,93c28,13,64,41,64,101c0,84-59,129-142,129V1542z M1367,1171h-88v104h88c38,0,60-21,60-52S1405,1171,1367,1171z M1373,1354h-94v111h94c41,0,61-25,61-56C1434,1379,1414,1354,1373,1354z"/><polygon fill="#fff" points="2004,1170 2004,1542 1914,1542 1914,1170 1793,1170 1793,1092 2125,1092 2125,1170"/></svg>
            <span class="exchange-label">Bybit</span>
          </button>
          <button class="bot-exchange-btn" data-exchange="okx" onclick="window.botSelectExchange('okx')">
            <svg viewBox="0 0 1024 1024" width="20" height="20"><rect width="1024" height="1024" rx="140" fill="#000"/><g transform="translate(512,512)" fill="#fff"><rect x="-320" y="-320" width="160" height="160" rx="28"/><rect x="160" y="-320" width="160" height="160" rx="28"/><rect x="-320" y="160" width="160" height="160" rx="28"/><rect x="160" y="160" width="160" height="160" rx="28"/><rect x="-130" y="-130" width="260" height="260" rx="40"/></g></svg>
            <span class="exchange-label">OKX</span>
          </button>
        </div>

        <!-- Control Bar -->
        <div class="bot-control-row">
          <button class="btn" type="button" id="botStartBtn" onclick="window.botStartExchange()" style="background:linear-gradient(135deg,#059669,#047857);border:none;color:#fff;">▶ Iniciar</button>
          <button class="btn secondary" type="button" id="botStopBtn" onclick="window.botStopExchange()">■ Detener</button>
          <button class="btn" type="button" id="botPanelBtn" onclick="window.botOpenPanel()" style="background:rgba(37,99,235,.15);border:1px solid rgba(37,99,235,.25);color:#93c5fd;">📊 Panel P2P</button>
          <div class="bot-buyprice-card" id="botBuyPriceCard" style="display:none;">
            <div>
              <div class="label" id="botBuyPriceLabel">PRECIO MINIMO VENTA</div>
              <div><span class="value" id="botBuyPriceValue">—</span><span class="unit">CLP</span></div>
            </div>
            <div id="botBuyPriceProvider" style="font-size:10px;color:#64748b;text-align:right;"></div>
          </div>
        </div>

        <!-- KPI Dashboard -->
        <div class="bot-kpi-grid" id="botKpiGrid">
          <div class="bot-kpi"><div class="kpi-label">Exchange</div><div class="kpi-value" id="botKpiExchange" style="font-size:14px;font-weight:600;">—</div><div class="kpi-sub" id="botKpiExchangeStatus"></div></div>
          <div class="bot-kpi"><div class="kpi-label">Ciclos</div><div class="kpi-value" id="botKpiCycles">0</div><div class="kpi-sub">ejecutados</div></div>
          <div class="bot-kpi"><div class="kpi-label">Ordenes</div><div class="kpi-value" id="botKpiOrders">0</div><div class="kpi-sub">totales</div></div>
          <div class="bot-kpi"><div class="kpi-label">Spread #1-#2</div><div class="kpi-value" id="botKpiSpread">—</div><div class="kpi-sub">CLP</div></div>
          <div class="bot-kpi"><div class="kpi-label">Competidores</div><div class="kpi-value" id="botKpiCompetitors">0</div><div class="kpi-sub" id="botKpiCompetitorsSub">en mercado</div></div>
          <div class="bot-kpi"><div class="kpi-label">Anuncio propio</div><div class="kpi-value" id="botKpiOurAd" style="font-size:14px;">—</div><div class="kpi-sub" id="botKpiOurAdStatus"></div></div>
          <div class="bot-kpi"><div class="kpi-label">Cambios/hora</div><div class="kpi-value" id="botKpiCambios">0/30</div><div class="kpi-sub" id="botKpiUltimoCambio">—</div></div>
          <div class="bot-kpi"><div class="kpi-label">Weight API</div><div class="kpi-value" id="botKpiWeight">0</div><div class="kpi-sub">/ 4000</div></div>
          <div class="bot-kpi"><div class="kpi-label">Límite Binance (1 min)</div><div class="kpi-value" id="botKpiRateLimit">0/32</div><div class="kpi-sub" id="botKpiRateLimitSub">—</div></div>
        </div>

        <!-- Four cards: Config exchange → Anuncios → Credenciales → Config anuncio -->
        <div class="bot-cols">
          <!-- Exchange-level config (hidden for Binance, visible for Bybit) -->
          <div id="botExchangeConfigSection" class="bot-card bot-cols-full">
            <button class="bot-config-toggle" id="botExConfigToggle" onclick="var c=document.getElementById('botExchangeConfigGrid');var a=this.querySelector('.arrow');c.style.display=c.style.display==='none'?'grid':'none';a.classList.toggle('open');">
              <span class="arrow open">▶</span> Config del exchange <span style="font-size:10px;color:#64748b;font-weight:400;">(default para todos los anuncios)</span>
            </button>
            <div class="bot-config-grid" id="botExchangeConfigGrid">
              <label>
                Estrategia
                <select id="botExStrategy" onchange="window.botSaveExchangeConfig();var g=document.getElementById('botExchangeConfigGrid');var t=g.querySelector('#botExTop1DiffLabel');var s=g.querySelector('#botExSpreadPctLabel');if(t)t.style.display=this.value==='spread'?'none':'';if(s)s.style.display=this.value==='top1'?'none':''">
                  <option value="top1">Top 1</option>
                  <option value="spread">Spread fijo</option>
                </select>
              </label>
              <label id="botExTop1DiffLabel">
                <span style="display:flex;align-items:center;justify-content:space-between;width:100%;"><span>Diferencia top 1 (CLP)</span><button class="btn small ghost" type="button" onclick="window.botSaveExchangeConfig()" title="Guardar" style="font-size:12px;padding:2px 6px;">💾</button></span>
                <input id="botExTop1Diff" type="number" step="0.01" value="0.1" onchange="window.botSaveExchangeConfig()">
                <span class="help-text">Precio = mejor competidor − este valor</span>
              </label>
              <label id="botExSpreadPctLabel" style="display:none;">
                Spread (%)
                <input id="botExSpreadPct" type="number" step="0.1" value="0.5" onchange="window.botSaveExchangeConfig()">
              </label>
              <label>
                Precio fuente
                <div style="display:flex;gap:6px;align-items:center;margin-top:2px;">
                  <select id="botExPriceSource" onchange="window.botSaveExchangeConfig();botUpdateBuyPrice()" style="flex:0 0 100px;padding:7px 10px;border-radius:6px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.5);color:#f8fafc;font-size:12px;outline:none;font-family:inherit;">
                    <option value="capacity">Capacity</option>
                    <option value="manual">Manual</option>
                  </select>
                  <input id="botExPriceFloorPct" type="number" step="0.01" value="0" placeholder="895.83" onchange="botUpdateBuyPrice();window.botSaveExchangeConfig()" style="flex:1;min-width:0;">
                </div>
                <span class="help-text">Precio mínimo de venta en CLP</span>
              </label>
              <label id="botExCommissionPctLabel" style="display:none;">
                Comisión (%)
                <input id="botExCommissionPct" type="number" step="0.01" value="0.14" onchange="window.botSaveExchangeConfig()">
              </label>
              <label>
                Margen seguridad (%)
                <div style="display:flex;align-items:center;gap:4px;">
                  <button type="button" class="btn small ghost" onclick="window.botMarginStep('botExSafeMarginPct',-0.01)" style="flex:0 0 auto;padding:6px 12px;font-size:15px;line-height:1;">−</button>
                  <input id="botExSafeMarginPct" type="number" step="0.01" value="0" onchange="window.botSaveExchangeConfig();window.botExUpdateSafeMarginHint()" oninput="window.botExUpdateSafeMarginHint()" style="flex:1;min-width:0;text-align:center;">
                  <button type="button" class="btn small ghost" onclick="window.botMarginStep('botExSafeMarginPct',0.01)" style="flex:0 0 auto;padding:6px 12px;font-size:15px;line-height:1;">+</button>
                </div>
                <span id="botExSafeMarginHint" style="font-size:10px;color:#64748b;"></span>
                <span class="help-text">No competir si el #1 está a menos de este % sobre tu costo real</span>
              </label>
              <label>
                Capital min competidor (USDT)
                <input id="botExMinCompetitorCapital" type="number" step="1" value="" placeholder="Sin filtro" onchange="window.botSaveExchangeConfig()">
              </label>
              <label>
                Filtrar pago
                <select id="botExCompetePayType" onchange="window.botSaveExchangeConfig()">
                  <option value="all">Todos</option>
                  <option value="match">Mismos del anuncio</option>
                </select>
              </label>
              <label>
                Circuit breaker (% caída)
                <input id="botCircuitBreakPct" type="number" step="0.1" value="3" autocomplete="off" onblur="window.botSaveExchangeConfig()" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
              </label>
              <form autocomplete="off" style="display:contents"><label>
                Límite diferencia anuncios (%)
                <input id="botMinAdPriceDiffPct" type="number" step="0.01" value="0.1" autocomplete="off" onblur="window.botSaveExchangeConfig()" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
                <span class="help-text">Distancia mínima entre precios de tus propios anuncios (Binance exige ≥0.1%)</span>
              </label></form>
              <label>
                Intervalo ciclo (seg)
                <input id="botCycleInterval" type="number" step="0.1" value="10" min="1" autocomplete="off" onblur="window.botSaveExchangeConfig()" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
                <span class="help-text">Tiempo entre cada ciclo</span>
              </label>
            </div>
          </div>

          <!-- Anuncios (second) -->
          <div id="botAdsSection" class="bot-card" style="grid-column:1/-1;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
              <span style="font-size:14px;font-weight:800;color:#f1f5f9;letter-spacing:.2px;">Anuncios</span>
              <span class="bot-section-title" style="margin:0;font-size:12px;font-weight:500;color:#64748b;"><span id="botAdsExchangeLabel">Binance</span></span>
              <span style="font-size:11px;font-weight:600;color:#fbbf24;" id="botCambiosCounter"></span>
              <span style="flex:1;"></span>
              <button class="btn small ghost" type="button" onclick="window.botSyncNow()" style="font-size:10px;padding:5px 10px;border-radius:6px;">↻ Sincronizar</button>
              <button class="btn small" type="button" onclick="window.botPanelNewAd()" style="font-size:10px;padding:5px 12px;border-radius:6px;">+ Nuevo anuncio</button>
            </div>
            <div id="botAdsList" class="bot-ads-row">
              <div style="color:#64748b;font-size:12px;text-align:center;padding:16px 0;">Cargando anuncios...</div>
            </div>
          </div>
          <div id="botBybitAdSection" class="bot-card" style="grid-column:1/-1;display:none;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
              <span style="font-size:13px;font-weight:700;color:#e2e8f0;">Anuncio Bybit</span>
              <span style="flex:1;"></span>
              <button class="btn small ghost" type="button" onclick="window.botSyncNow()" style="font-size:10px;">↻</button>
            </div>
            <div id="botBybitAdContent"></div>
          </div>

          <!-- Credenciales (third) -->
          <div id="botCredentialsSection" class="bot-card" style="grid-column:1/-1;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:13px;font-weight:700;color:#e2e8f0;">Credenciales</span>
              <span style="font-size:11px;color:#64748b;" id="botCredExchangeLabel">Binance</span>
            </div>
            <div id="botCredFields" class="bot-cred-fields" style="margin-top:10px;"></div>
            <div id="botCredStatus" style="margin-top:8px;font-size:12px;color:#94a3b8;"></div>
          </div>
          <!-- Cycle de ventas P2P -->
          <div id="botCycleSection" class="bot-card" style="grid-column:1/-1;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:14px;font-weight:800;color:#f1f5f9;letter-spacing:.2px;">🔄 Ciclo de Ventas</span>
                <span id="botCycleLabel" style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:999px;background:rgba(148,163,184,.12);color:#94a3b8;">Inactivo</span>
              </div>
              <span style="flex:1;"></span>
              <button class="btn small" id="botCycleStartBtn" onclick="window.botCycleStart()" style="font-size:11px;padding:6px 14px;border-radius:7px;background:linear-gradient(135deg,#059669,#047857);border:none;color:#fff;font-weight:700;">▶ Iniciar Ciclo</button>
              <button class="btn small secondary" id="botCycleAddSaleBtn" onclick="window.botCycleAddSale()" style="font-size:11px;padding:6px 14px;border-radius:7px;display:none;font-weight:700;">+ Venta Manual</button>
              <button class="btn small" id="botCycleCloseBtn" onclick="window.botCycleClose()" style="font-size:11px;padding:6px 14px;border-radius:7px;display:none;background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.3);color:#fca5a5;font-weight:700;">■ Cerrar Ciclo</button>
              <button class="btn small secondary" onclick="window.botCycleShowHistory()" style="font-size:11px;padding:6px 14px;border-radius:7px;font-weight:700;">📜 Historial</button>
            </div>
            <p id="botCycleEmptyHint" style="margin-top:10px;font-size:12px;color:#64748b;">No hay un ciclo activo. Inicia uno para llevar el conteo automático de ventas de esta cuenta.</p>
            <div id="botCycleInfo" style="margin-top:12px;display:none;">
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;">
                <div class="bot-cycle-tile">
                  <div class="bot-cycle-tile-label">Inicio</div>
                  <div class="bot-cycle-tile-value" id="botCycleStartTime" style="font-size:13px;">—</div>
                </div>
                <div class="bot-cycle-tile">
                  <div class="bot-cycle-tile-label">USDT vendidos</div>
                  <div class="bot-cycle-tile-value" id="botCycleUsdt">0</div>
                </div>
                <div class="bot-cycle-tile">
                  <div class="bot-cycle-tile-label" id="botCycleClpLabel">CLP Binance</div>
                  <div class="bot-cycle-tile-value" id="botCycleBinanceClp">0</div>
                </div>
                <div class="bot-cycle-tile">
                  <div class="bot-cycle-tile-label">CLP manual</div>
                  <div class="bot-cycle-tile-value" id="botCycleManualClp">0</div>
                </div>
                <div class="bot-cycle-tile" style="border-color:rgba(0,212,255,.25);">
                  <div class="bot-cycle-tile-label">Total CLP</div>
                  <div class="bot-cycle-tile-value" id="botCycleTotalClp" style="color:#00d4ff;">0</div>
                </div>
                <div class="bot-cycle-tile" onclick="window.botCycleEditMinClose()" style="cursor:pointer;" title="Click para editar el monto de auto-cierre">
                  <div class="bot-cycle-tile-label">Auto-cierre en ✏️</div>
                  <div class="bot-cycle-tile-value" id="botCycleMinClose" style="font-size:13px;">—</div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:8px;">
                <div class="bot-cycle-tile" style="border-color:rgba(52,211,153,.25);">
                  <div class="bot-cycle-tile-label">Ganancia estimada</div>
                  <div class="bot-cycle-tile-value" id="botCycleProfit" style="color:#34d399;font-size:13px;">—</div>
                </div>
                <div class="bot-cycle-tile">
                  <div class="bot-cycle-tile-label">Cambios de precio</div>
                  <div class="bot-cycle-tile-value" id="botCycleProdUpdates" style="font-size:13px;">—</div>
                </div>
                <div class="bot-cycle-tile">
                  <div class="bot-cycle-tile-label">Cambios / hora</div>
                  <div class="bot-cycle-tile-value" id="botCycleProdRate" style="font-size:13px;">—</div>
                </div>
                <div class="bot-cycle-tile">
                  <div class="bot-cycle-tile-label">Promedio por orden</div>
                  <div class="bot-cycle-tile-value" id="botCycleAvgOrder" style="font-size:13px;">—</div>
                </div>
              </div>
              <p id="botCycleProfitHint" style="margin-top:6px;font-size:10px;color:#64748b;"></p>
              <div style="margin-top:10px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                  <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.3px;">Órdenes de este ciclo</div>
                  <span id="botCycleSetAsideChip" onclick="window.botCycleToggleSetAsideList()" style="display:none;cursor:pointer;font-size:10px;font-weight:700;padding:2px 9px;border-radius:999px;background:rgba(251,191,36,.14);border:1px solid rgba(251,191,36,.3);color:#fbbf24;"></span>
                </div>
                <div id="botCycleOrdersList" style="max-height:220px;overflow-y:auto;border:1px solid rgba(148,163,184,.12);border-radius:8px;">
                  <div style="color:#64748b;font-size:11px;text-align:center;padding:12px 0;">Sin órdenes todavía</div>
                </div>
                <div id="botCycleSetAsideList" style="display:none;margin-top:8px;border:1px solid rgba(251,191,36,.2);border-radius:8px;background:rgba(251,191,36,.04);"></div>
              </div>
            </div>
            <div id="botCycleManualList" style="margin-top:10px;font-size:11px;color:#94a3b8;display:none;"></div>
          </div>
          <!-- no more separate per-ad config container -- config is inline in each ad pill -->
        </div>

        <!-- Two-column: Log + Orders -->
        <div class="bot-cols">
          <div class="bot-card">
            <div class="bot-section-title">Actividad <span class="badge">en vivo</span></div>
            <div id="botLogContainer" class="bot-log-container">
              <div style="color:#64748b;font-size:11px;text-align:center;padding:16px 0;">Cargando actividad...</div>
            </div>
          </div>
          <div class="bot-card">
            <div class="bot-section-title">Ordenes <span class="badge">recientes</span></div>
            <div id="botOrdersContainer" class="bot-orders-container">
              <div style="color:#64748b;font-size:11px;text-align:center;padding:16px 0;">Sin ordenes registradas</div>
            </div>
          </div>
        </div>
      </div>
    </section>
    <!-- Panel P2P Modal -->
    <div id="botPanelModal" class="modal" style="display:none;" onclick="if(event.target===this)window.botClosePanel()">
      <div class="modal-dialog">
        <div class="modal-card" style="max-width:800px;">
          <div class="modal-head">
            <h3 class="modal-title"><span style="color:var(--brand);">●</span> Panel P2P &mdash; <span id="botPanelExchangeLabel">Binance</span></h3>
            <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
              <button id="botSoundToggle" class="btn small ghost" type="button" onclick="window.botToggleSound()" style="padding:4px 6px;display:inline-flex;align-items:center;" title="Activar/desactivar sonido de notificaciones">
                <svg id="botSoundIcon" viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              </button>
              <button class="close-btn" type="button" onclick="window.botClosePanel()">&times;</button>
            </div>
          </div>
          <div class="bot-panel-sub">
            <button class="bot-panel-tab active" data-paneltab="orders" onclick="window.botSwitchPanelTab('orders')">📋 Ordenes</button>
            <button class="bot-panel-tab" data-paneltab="ads" onclick="window.botSwitchPanelTab('ads')">📢 Anuncios</button>
            <button class="bot-panel-tab" data-paneltab="accounts" onclick="window.botSwitchPanelTab('accounts')">🏦 Cuentas</button>
            <button class="bot-panel-tab" data-paneltab="mercado" onclick="window.botSwitchPanelTab('mercado')">📈 Mercado</button>
            <button class="bot-panel-tab" data-paneltab="security" onclick="window.botSwitchPanelTab('security')">🔐 Seguridad</button>
            <button class="bot-panel-tab" data-paneltab="skipo" onclick="window.botSwitchPanelTab('skipo')">💱 Skipo</button>
          </div>
          <div class="modal-content">
            <!-- Tab: Ordenes activas -->
            <div id="botPanelOrders" class="bot-panel-tab-content" style="position:relative;">
              <!-- Main tabs: En curso / Procesadas -->
              <div style="display:flex;align-items:center;border-bottom:1px solid rgba(148,163,184,.08);margin-bottom:10px;">
                <div style="display:flex;flex:1;">
                  <button class="bot-orders-main-tab active" data-orders-tab="active" onclick="window.botSwitchOrdersTab('active')">🔴 En curso</button>
                  <button class="bot-orders-main-tab" data-orders-tab="history" onclick="window.botSwitchOrdersTab('history')">✅ Procesadas</button>
                </div>
                <div id="botOrdersHistoryIcons" style="display:none;gap:4px;padding-bottom:4px;">
                  <button class="bot-orders-icon-btn" onclick="window.botToggleOrdersSearch()" title="Buscar">
                    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.35-4.35"/></svg>
                  </button>
                  <button class="bot-orders-icon-btn" onclick="window.botToggleOrdersFilters()" title="Filtros">
                    <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M7 12h10"/><path d="M10 17h4"/></svg>
                  </button>
                </div>
                <div id="botChatToggleInline" style="display:flex;align-items:center;gap:5px;padding-bottom:4px;padding-left:8px;border-left:1px solid rgba(148,163,184,.15);margin-left:4px;">
                  <input id="botChatBotEnabled" type="checkbox" onchange="window.botSaveExchangeConfig()" style="width:14px;height:14px;accent-color:#22c55e;">
                  <span style="font-size:10px;color:#94a3b8;white-space:nowrap;">Chat 🤖</span>
                </div>
              </div>
              <!-- Sub-filters for "En curso" -->
               <div id="botOrdersActiveFilters" style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">
                <button class="bot-orders-filter active" data-filter="unpaid" onclick="window.botSetOrdersFilter('unpaid')">No pagado <span class="bot-filter-count" data-filter="unpaid" style="font-size:9px;background:rgba(251,191,36,.2);color:#fbbf24;padding:0px 4px;border-radius:3px;margin-left:3px;">0</span></button>
                <button class="bot-orders-filter" data-filter="paid" onclick="window.botSetOrdersFilter('paid')">Pagado <span class="bot-filter-count" data-filter="paid" style="font-size:9px;background:rgba(96,165,250,.2);color:#60a5fa;padding:0px 4px;border-radius:3px;margin-left:3px;">0</span></button>
                <button class="bot-orders-filter" data-filter="appealed" onclick="window.botSetOrdersFilter('appealed')">Apelación <span class="bot-filter-count" data-filter="appealed" style="font-size:9px;background:rgba(239,68,68,.2);color:#fb7185;padding:0px 4px;border-radius:3px;margin-left:3px;">0</span></button>
              </div>
              <!-- Sub-filters + search for "Procesadas" -->
              <div id="botOrdersHistoryFilters" style="display:none;margin-bottom:8px;">
                <div id="botOrdersSearchBox" style="display:none;margin-bottom:6px;">
                  <div style="position:relative;">
                    <svg viewBox="0 0 24 24" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);width:14px;height:14px;stroke:#64748b;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.35-4.35"/></svg>
                    <input id="botOrdersSearchInput" type="text" placeholder="Buscar orden o contraparte..." oninput="window.botApplyOrdersFilters()" onkeydown="if(event.key==='Escape')window.botToggleOrdersSearch()" style="width:100%;padding:6px 10px 6px 28px;border-radius:8px;border:1px solid rgba(148,163,184,.1);background:rgba(15,23,42,.4);color:#e2e8f0;font-size:12px;font-family:inherit;outline:none;">
                  </div>
                </div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;" id="botOrdersFilterPills">
                  <button class="bot-orders-filter active" data-filter="all" onclick="window.botSetOrdersFilter('all')">Todo</button>
                  <button class="bot-orders-filter" data-filter="completed" onclick="window.botSetOrdersFilter('completed')">Completadas</button>
                  <button class="bot-orders-filter" data-filter="cancelled" onclick="window.botSetOrdersFilter('cancelled')">Canceladas</button>
                  <button class="bot-orders-filter" data-filter="appealed" onclick="window.botSetOrdersFilter('appealed')">Apelación</button>
                </div>
                <!-- Filter dropdown -->
                <div id="botOrdersFilterDropdown" style="display:none;margin-bottom:8px;background:rgba(15,23,42,.95);border:1px solid rgba(148,163,184,.1);border-radius:12px;padding:14px;">
                  <div class="bot-filter-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div>
                      <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Tipo</div>
                      <select id="botFilterType" onchange="window.botApplyOrdersFilters()" style="width:100%;padding:5px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.1);background:rgba(15,23,42,.5);color:#e2e8f0;font-size:11px;font-family:inherit;">
                        <option value="all">Todo</option>
                        <option value="BUY">Compra</option>
                        <option value="SELL">Venta</option>
                      </select>
                    </div>
                    <div>
                      <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Divisa</div>
                      <select id="botFilterFiat" onchange="window.botApplyOrdersFilters()" style="width:100%;padding:5px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.1);background:rgba(15,23,42,.5);color:#e2e8f0;font-size:11px;font-family:inherit;"></select>
                    </div>
                    <div>
                      <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Moneda</div>
                      <select id="botFilterCoin" onchange="window.botApplyOrdersFilters()" style="width:100%;padding:5px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.1);background:rgba(15,23,42,.5);color:#e2e8f0;font-size:11px;font-family:inherit;"></select>
                    </div>
                    <div>
                      <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Rango de fecha</div>
                      <select id="botFilterDateRange" onchange="window.botToggleDateRange()" style="width:100%;padding:5px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.1);background:rgba(15,23,42,.5);color:#e2e8f0;font-size:11px;font-family:inherit;">
                        <option value="all">Todo</option>
                        <option value="month">Mes</option>
                        <option value="quarter">Trimestre</option>
                        <option value="custom">Personalizado</option>
                      </select>
                    </div>
                  </div>
                  <div id="botFilterDateCustom" style="display:none;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
                    <div>
                      <div style="font-size:10px;color:#64748b;margin-bottom:2px;">Desde</div>
                      <input id="botFilterDateFrom" type="date" onchange="window.botApplyOrdersFilters()" style="width:100%;padding:4px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.1);background:rgba(15,23,42,.5);color:#e2e8f0;font-size:11px;font-family:inherit;">
                    </div>
                    <div>
                      <div style="font-size:10px;color:#64748b;margin-bottom:2px;">Hasta</div>
                      <input id="botFilterDateTo" type="date" onchange="window.botApplyOrdersFilters()" style="width:100%;padding:4px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.1);background:rgba(15,23,42,.5);color:#e2e8f0;font-size:11px;font-family:inherit;">
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px;">
                    <button class="btn small ghost" type="button" onclick="window.botToggleOrdersFilters()">Listo</button>
                    <button class="btn small ghost" type="button" onclick="window.botResetOrdersFilters()">Restablecer</button>
                  </div>
                </div>
              </div>
              <!-- Order list -->
              <div id="botPanelOrdersList" class="bot-orders-container" style="max-height:350px;"></div>
               <!-- Chat overlay moved to body by JS -->
            </div>
            <!-- Tab: Anuncios -->
            <div id="botPanelAds" class="bot-panel-tab-content" style="display:none;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px;">
                <p class="section-text" style="margin:0;">Tus anuncios en el exchange.</p>
              </div>
              <!-- Ad form -->
              <div id="botPanelAdForm" style="display:none;"></div>
              <!-- Ad list -->
              <div id="botPanelAdsList" class="bot-ads-list">
                <div style="color:#64748b;font-size:12px;text-align:center;padding:20px 0;">Cargando anuncios...</div>
              </div>
            </div>
            <!-- Tab: Cuentas bancarias -->
            <div id="botPanelAccounts" class="bot-panel-tab-content" style="display:none;">
              <p class="section-text" style="margin-bottom:10px;">Cuentas bancarias guardadas para <b id="botPanelAccountsLabelHint">ONZE</b>. Se guardan por separado para ONZE y ZINPLE — si usas ambas cuentas, agrégalas en cada una.</p>
              <!-- Account form -->
              <div id="botPanelAcctForm" class="bot-panel-form" style="margin-bottom:12px;">
                <label>Banco <input id="botPanelAcctBank" type="text" placeholder="Ej: Banco Estado"></label>
                <label>Nombre del titular <input id="botPanelAcctHolder" type="text" placeholder="Nombre completo del titular"></label>
                <label>RUT <input id="botPanelAcctRut" type="text" placeholder="12.345.678-9"></label>
                <label>Tipo de cuenta <select id="botPanelAcctType">
                  <option value="">Selecciona tipo...</option>
                  <option value="corriente">Cuenta Corriente</option>
                  <option value="vista">Cuenta Vista</option>
                  <option value="ahorro">Cuenta de Ahorro</option>
                  <option value="rut">Cuenta RUT</option>
                  <option value="otro">Otro</option>
                </select></label>
                <label>Numero de cuenta <input id="botPanelAcctNumber" type="text" placeholder="123456789"></label>
                <label>Correo <input id="botPanelAcctEmail" type="email" placeholder="correo@ejemplo.com"></label>
                <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
                  <button class="btn small" type="button" onclick="window.botPanelSaveAccount()">Guardar</button>
                </div>
              </div>
              <div id="botPanelAccountsList" class="bot-accounts-grid"></div>
            </div>
            <!-- Tab: Mercado -->
            <div id="botPanelMercado" class="bot-panel-tab-content" style="display:none;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:12px;font-weight:600;color:#e2e8f0;">📈 Mercado <span id="botMercadoExchange" style="font-size:10px;color:#64748b;font-weight:400;"></span></span>
              </div>
              <div id="botOracleCard" style="margin-bottom:16px;"></div>
              <div style="margin-bottom:12px;">
                <div id="botMercadoStats"></div>
              </div>
              <div id="botMercadoChartHeader"></div>
              <div id="botMercadoChartContainer" style="background:linear-gradient(135deg,rgba(15,23,42,0.6),rgba(30,41,59,0.4));border-radius:12px;padding:4px 16px 16px 16px;margin-bottom:12px;height:300px;border:1px solid rgba(148,163,184,0.08);box-shadow:0 4px 24px rgba(0,0,0,0.3);">
                <canvas id="botMercadoChart"></canvas>
              </div>
              <!-- Top 5 merchants -->
              <div class="mercado-section-title">Top merchants <span class="badge">más activos</span></div>
              <div id="botMercadoTopMerchants" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px;"></div>
              <!-- Banks distribution -->
              <div class="mercado-section-title">Bancos m&aacute;s usados <span class="badge">entre competidores</span></div>
              <div id="botMercadoBanks" style="margin-bottom:4px;"></div>
              <!-- Bot insights -->
              <div class="mercado-section-title">Rendimiento del bot <span class="badge">insights</span></div>
              <div id="botMercadoInsights" style="margin-bottom:12px;"></div>
              <!-- Ranking -->
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;margin-top:4px;">
                <p class="section-text" style="margin:0;font-weight:600;">Ranking de competidores</p>
                <span id="botMercadoUpdatedAt" style="font-size:11px;color:#64748b;"></span>
              </div>
              <div id="botMercadoRanking" style="max-height:380px;overflow-y:auto;"></div>
            </div>
            <!-- Tab: Seguridad -->
            <div id="botPanelSecurity" class="bot-panel-tab-content" style="display:none;">
              <p class="section-text" style="margin-bottom:14px;">Protege la liberación de órdenes con una clave de 4 dígitos y/o tu huella. Se te pedirá una de las dos cada vez que liberes una orden.</p>

              <div style="background:rgba(15,23,42,.4);border:1px solid rgba(148,163,184,.1);border-radius:12px;padding:14px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:8px;">Clave de 4 dígitos</div>
                <div id="botSecPinStatus" style="font-size:12px;color:#94a3b8;margin-bottom:10px;">Cargando...</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
                  <label style="font-size:11px;color:#94a3b8;">Nueva clave
                    <input id="botSecPinNew" type="password" inputmode="numeric" maxlength="4" placeholder="••••" style="display:block;width:80px;padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.6);color:#e2e8f0;font-size:14px;letter-spacing:4px;margin-top:4px;">
                  </label>
                  <label style="font-size:11px;color:#94a3b8;">Confirmar
                    <input id="botSecPinConfirm" type="password" inputmode="numeric" maxlength="4" placeholder="••••" style="display:block;width:80px;padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.6);color:#e2e8f0;font-size:14px;letter-spacing:4px;margin-top:4px;">
                  </label>
                  <button class="btn small" type="button" onclick="window.botPanelSavePin()">Guardar clave</button>
                </div>
                <div id="botSecPinMsg" style="font-size:12px;margin-top:8px;"></div>
              </div>

              <div style="background:rgba(15,23,42,.4);border:1px solid rgba(148,163,184,.1);border-radius:12px;padding:14px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:8px;">Contraseña de fondos de Binance (<span id="botSecFundPwdLabel">ONZE</span>)</div>
                <div id="botSecFundPwdStatus" style="font-size:12px;color:#94a3b8;margin-bottom:10px;">Cargando...</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
                  <label style="font-size:11px;color:#94a3b8;">Nueva contraseña de fondos
                    <input id="botSecFundPwdNew" type="password" placeholder="Contraseña de fondos" style="display:block;width:220px;padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.6);color:#e2e8f0;font-size:14px;margin-top:4px;">
                  </label>
                  <button class="btn small" type="button" onclick="window.botPanelSaveFundPassword()">Guardar</button>
                </div>
                <div id="botSecFundPwdMsg" style="font-size:12px;margin-top:8px;"></div>
              </div>

              <div style="background:rgba(15,23,42,.4);border:1px solid rgba(148,163,184,.1);border-radius:12px;padding:14px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:8px;">Huella / Face ID</div>
                <div id="botSecCredsList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;"></div>
                <button class="btn small ghost" type="button" onclick="window.botPanelRegisterFingerprint()">+ Registrar huella en este dispositivo</button>
                <div id="botSecCredMsg" style="font-size:12px;margin-top:8px;"></div>
              </div>

              <div style="background:rgba(15,23,42,.4);border:1px solid rgba(148,163,184,.1);border-radius:12px;padding:14px;">
                <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:8px;">WhatsApp del dueño de la cuenta (<span id="botSecWhatsappLabel">ONZE</span>)</div>
                <p class="section-text" style="margin-bottom:10px;">Órdenes sobre $500 USD no se pueden liberar automático -- Binance exige liberarlas manual desde la app. Deja aquí el WhatsApp de quien puede hacerlo, para avisarle rápido desde el chat de la orden.</p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
                  <label style="font-size:11px;color:#94a3b8;">Número (con código de país, ej: 56912345678)
                    <input id="botExOperatorWhatsapp" type="text" placeholder="56912345678" onchange="window.botSaveExchangeConfig()" style="display:block;width:220px;padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.6);color:#e2e8f0;font-size:14px;margin-top:4px;">
                  </label>
                </div>
              </div>
            </div>
            <!-- Tab: Skipo (cotizar/comprar USDT al mayor) -->
            <div id="botPanelSkipo" class="bot-panel-tab-content" style="display:none;">
              <p class="section-text" style="margin-bottom:14px;">Cotiza y compra USDT directo a Skipo con tu saldo en CLP. La compra es real e irreversible.</p>

              <div style="display:flex;gap:8px;margin-bottom:14px;">
                <div style="flex:1;background:rgba(15,23,42,.4);border:1px solid rgba(148,163,184,.1);border-radius:12px;padding:12px;">
                  <div style="font-size:11px;color:#94a3b8;">Saldo CLP en Skipo</div>
                  <div id="skipoBalanceClp" style="font-size:16px;font-weight:700;color:#e2e8f0;">—</div>
                </div>
                <div style="flex:1;background:rgba(15,23,42,.4);border:1px solid rgba(148,163,184,.1);border-radius:12px;padding:12px;">
                  <div style="font-size:11px;color:#94a3b8;">Saldo USDT en Skipo</div>
                  <div id="skipoBalanceUsdt" style="font-size:16px;font-weight:700;color:#e2e8f0;">—</div>
                </div>
              </div>

              <div id="skipoPriceCard" style="background:linear-gradient(135deg,rgba(52,211,153,.12),rgba(15,23,42,.4));border:1px solid rgba(52,211,153,.25);border-radius:14px;padding:18px;text-align:center;">
                <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:4px;">
                  <div style="font-size:11px;color:#94a3b8;">Precio actual USDT/CLP en Skipo</div>
                  <span id="skipoPriceCountdown" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:9999px;border:2px solid #fbbf24;color:#fbbf24;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0;">5</span>
                </div>
                <div id="skipoCurrentRate" style="font-size:28px;font-weight:800;color:#34d399;">Cargando...</div>
              </div>
              <div id="skipoPriceMsg" style="font-size:12px;margin-top:8px;color:#fb7185;"></div>

              <div style="margin-top:16px;background:rgba(15,23,42,.4);border:1px solid rgba(148,163,184,.1);border-radius:14px;padding:16px;">
                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:10px;">Monto a pagar (CLP)
                  <input id="skipoBuyClp" type="text" inputmode="numeric" placeholder="Ej: 100.000" oninput="window.skipoFormatClpInput(this)" style="display:block;width:100%;padding:10px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.6);color:#e2e8f0;font-size:16px;margin-top:4px;">
                </label>
                <button id="skipoBuyBtn" class="btn small" type="button" style="width:100%;" onclick="window.skipoBuy()">Comprar</button>

                <div id="skipoQuoteBox" style="display:none;background:linear-gradient(180deg,rgba(52,211,153,.08) 0%,rgba(15,23,42,.5) 100%);border:1px solid rgba(52,211,153,.2);border-radius:14px;padding:18px;margin-top:14px;text-align:center;">
                  <div style="font-size:11px;color:#94a3b8;letter-spacing:.04em;text-transform:uppercase;">Estás comprando</div>
                  <div id="skipoQuoteUsdt" style="font-size:30px;font-weight:800;color:#34d399;margin-top:4px;letter-spacing:-.02em;"></div>
                  <div id="skipoQuoteRate" style="font-size:13px;color:#94a3b8;margin-top:6px;"></div>
                  <div style="height:1px;background:rgba(148,163,184,.15);margin:14px 0;"></div>
                  <div style="font-size:11px;color:#94a3b8;">Cotización válida por</div>
                  <div id="skipoQuoteTimer" style="font-size:26px;font-weight:800;color:#fbbf24;margin-top:2px;font-variant-numeric:tabular-nums;">5s</div>
                </div>

                <div id="skipoBuyMsg" style="font-size:12px;margin-top:10px;min-height:16px;text-align:center;"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      <div id="releaseAuthModal" class="modal" style="display:none;" onclick="if(event.target===this)window.botCloseReleaseAuthModal()">
        <div class="modal-dialog">
          <div class="modal-card" style="max-width:360px;">
            <div class="modal-head">
              <h3 class="modal-title">Liberar orden #<span id="releaseAuthOrderLabel"></span></h3>
              <button class="close-btn" type="button" onclick="window.botCloseReleaseAuthModal()">&times;</button>
            </div>
            <div class="modal-content">
              <p class="section-text" style="margin-bottom:10px;">Confirma con tu clave o tu huella para liberar los activos de esta orden. Esta acción es irreversible.</p>
              <div style="display:flex;gap:8px;align-items:end;margin-bottom:10px;">
                <label style="font-size:11px;color:#94a3b8;flex:1;">Clave de 4 dígitos
                  <input id="releaseAuthPin" type="password" inputmode="numeric" maxlength="4" placeholder="••••" style="display:block;width:100%;padding:8px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.6);color:#e2e8f0;font-size:16px;letter-spacing:6px;margin-top:4px;">
                </label>
                <button class="btn small" type="button" onclick="window.botReleaseAuthWithPin()">Confirmar</button>
              </div>
              <div style="text-align:center;color:#64748b;font-size:11px;margin:8px 0;">— o —</div>
              <button class="btn small ghost" type="button" style="width:100%;" onclick="window.botReleaseAuthWithFingerprint()">👆 Usar huella / Face ID</button>
              <div id="releaseAuthMsg" style="font-size:12px;margin-top:10px;min-height:16px;"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    if(!document.querySelector(".views-container")){
      const lastView = document.querySelector(".view:last-of-type");
      if(lastView) lastView.parentNode.insertBefore(section, lastView.nextSibling);
      else document.querySelector("main")?.appendChild(section);
    }
  }

  function addP2PBotNavButton(){
    const btn = document.querySelector('[data-view-target="p2p-bot"]')
      || (() => {
        const target = document.querySelector('[data-view-target="p2p-dashboard"]')
          || document.querySelector('[data-view-target="tasa-del-dia"]');
        if(!target || !target.parentNode) return null;
        const b = document.createElement("button");
        b.className = "nav-btn admin-only-control";
        b.type = "button";
        b.dataset.viewTarget = "p2p-bot";
        b.textContent = "P2P Bot";
        target.parentNode.insertBefore(b, target.nextSibling);
        return b;
      })();
    if(!btn) return;
    btn.addEventListener("click", function(){
      if(typeof switchView === "function") switchView("p2p-bot");
      else{
        document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
        document.getElementById("view-p2p-bot")?.classList.add("active");
      }
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      if(!window.botSelectedExchange) window.botSelectedExchange = "binance";
      setTimeout(function(){ window.botSelectExchange(window.botSelectedExchange); }, 50);
      setTimeout(window.botRefreshExchange, 300);
    });
  }

  var botActiveLabel = localStorage.getItem("botActiveLabel") || "ONZE";
  window.botActiveLabel = botActiveLabel; // otros bloques <script> (ej. sync de ventas Binance) leen esto
  var botLabelData = {}; // separate state per label

  window.botSetActiveLabel = function(label){
    botActiveLabel = label;
    window.botActiveLabel = label;
    localStorage.setItem("botActiveLabel", label);
    // Bug real confirmado en vivo (sep 2026): botLastOrderIds nunca se
    // reseteaba al cambiar de cuenta -- las órdenes de la cuenta nueva son
    // TODAS distintas a las de la cuenta anterior, así que el próximo poll
    // las veía como "nuevas" y sonaba la alarma sin que hubiera llegado
    // ninguna orden real. Al limpiar el set acá, el próximo poll toma la
    // lista de la cuenta nueva como punto de partida, sin sonido de más.
    if(typeof botLastOrderIds !== "undefined") botLastOrderIds = new Set();
    document.querySelectorAll(".bot-acct-btn").forEach(function(b){
      b.classList.toggle("active", b.getAttribute("data-label") === label);
    });
    // Reinitialize view for the new label
    if(typeof botRefreshExchange === "function") botRefreshExchange(false);
    if(typeof botLoadAds === "function") botLoadAds();
    botCycleRefresh();
  };

  window.botSelectExchange = function(exchange){
    // Mismo fix que botSetActiveLabel: sin esto, cambiar de exchange
    // (Binance/Bybit/OKX) también hacía sonar la alarma de "orden nueva"
    // sin que llegara ninguna orden real -- ver el comentario de arriba.
    if(typeof botLastOrderIds !== "undefined") botLastOrderIds = new Set();
    // ONZE/ZINPLE es exclusivo de Binance -- Bybit/OKX son cuenta única.
    // Forzamos botActiveLabel a "ONZE" mientras se ve Bybit/OKX (así TODOS
    // los fetch de este panel que arman su label con botActiveLabel quedan
    // apuntando a la cuenta correcta sin tener que tocar cada uno), y
    // restauramos el label real guardado al volver a Binance.
    if(exchange === "binance"){
      const stored = localStorage.getItem("botActiveLabel") || "ONZE";
      botActiveLabel = stored;
      window.botActiveLabel = stored;
    } else {
      botActiveLabel = "ONZE";
      window.botActiveLabel = "ONZE";
    }

    botSelectedExchange = exchange;
    botSelectedAdId = null;
    document.querySelectorAll(".bot-exchange-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.exchange === exchange);
    });
    document.getElementById("botCredExchangeLabel").textContent = exchange.charAt(0).toUpperCase() + exchange.slice(1);
    document.getElementById("botAdsExchangeLabel").textContent = exchange.charAt(0).toUpperCase() + exchange.slice(1);

    // ONZE/ZINPLE es exclusivo de Binance -- no aplica a Bybit ni OKX
    const acctSwitcher = document.getElementById("botAcctSwitcher");
    if(acctSwitcher) acctSwitcher.style.display = exchange === "binance" ? "" : "none";

    // Show sections
    const adsSection = document.getElementById("botAdsSection");
    const bybitSection = document.getElementById("botBybitAdSection");
    if(exchange === "bybit"){
      if(adsSection) adsSection.style.display = "none";
      if(bybitSection) bybitSection.style.display = "";
    }else{
      if(adsSection) adsSection.style.display = "";
      if(bybitSection) bybitSection.style.display = "none";
    }

    // Show/hide exchange config section (hidden for Binance, visible for others like Bybit)
    const exchangeConfigSection = document.getElementById("botExchangeConfigSection");
    if(exchangeConfigSection) exchangeConfigSection.style.display = exchange === "binance" ? "none" : "";

    // Show exchange config grid (circuit breaker, volume, interval)
    const exchangeConfigGrid = document.getElementById("botExchangeConfigGrid");
    if(exchangeConfigGrid) exchangeConfigGrid.style.display = "grid";

    // Show/hide commission fields based on exchange
    var commLabel = document.getElementById("botExCommissionPctLabel");
    if(commLabel) commLabel.style.display = exchange === "bybit" ? "none" : "";
    botUpdateBuyPrice();
    window.botRefreshExchange();
    window.botLoadAds();
    botCycleRefresh();
  };

  /* Per-ad functions for main view */

  window.botSyncNow = async function(){
    try{
      await fetch("/api/p2p/bot/cycle", { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ label: botActiveLabel || "ONZE", force: true }) });
    }catch(_){}
    window.botLoadAds();
  };

  window.botLoadAds = async function(){
    const container = document.getElementById("botAdsList");
    if(botSelectedExchange === "bybit"){
      await botLoadBybitSimpleAd();
      return;
    }
    if(!container) return;
    try{
      var labelParam = (typeof botActiveLabel !== 'undefined' && botActiveLabel) ? '&label=' + encodeURIComponent(botActiveLabel) : '';
      const r = await fetch("/api/p2p/bot/ads?exchange=" + botSelectedExchange + labelParam, { credentials:"include" });
      const d = await r.json();
      if(d?.ok && Array.isArray(d.ads)){
        console.log("[botLoadAds] ads:", d.ads.map(function(a){ return { id: a.id, adId: a.adId, botEnabled: a.botEnabled, price: a.price, status: a.status, priceSource: a.botPriceSource }; }));
      }
      if(!d?.ok || !d?.ads?.length){
        container.innerHTML = '<div style="color:#64748b;font-size:13px;text-align:center;padding:20px 0;border:1px dashed rgba(148,163,184,.08);border-radius:10px;margin-top:4px;">Sin anuncios disponibles</div>';
        return;
      }
      const sellAds = d.ads.filter(a => (a.tradeType||'').toUpperCase() === 'SELL' && (a.asset||'').toUpperCase() === 'USDT' && (a.fiat||'').toUpperCase() === 'CLP');
      if(!sellAds.length){
        container.innerHTML = '<div style="color:#64748b;font-size:13px;text-align:center;padding:20px 0;border:1px dashed rgba(148,163,184,.08);border-radius:10px;margin-top:4px;">Sin anuncios de venta USDT/CLP</div>';
        return;
      }
      container.innerHTML = sellAds.map(function(a, idx){
        return botRenderAdPill(a, idx);
      }).join('');
      botUpdateBuyPrice();
      botRefreshAdPrices();
      sellAds.forEach(function(a){
        if(a.botSafeMarginPct > 0 && window.botAdUpdateSafeMarginHint) botAdUpdateSafeMarginHint(a.id);
        if(window.botAdUpdateRealCost) botAdUpdateRealCost(a.id);
      });
    }catch(e){ console.warn("[P2P Bot] botLoadAds error:", e); }
  };

  async function botLoadBybitSimpleAd(){
    const content = document.getElementById("botBybitAdContent");
    if(!content) return;
    try{
      var labelParam = (typeof botActiveLabel !== 'undefined' && botActiveLabel) ? '&label=' + encodeURIComponent(botActiveLabel) : '';
      const r = await fetch("/api/p2p/bot/ads?exchange=bybit" + labelParam, { credentials:"include" });
      const d = await r.json();
      if(!d?.ok || !d?.ads?.length){
        content.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:8px 0;">Sin anuncio</div>';
        return;
      }
      const a = d.ads.find(ad => (ad.tradeType||'').toUpperCase() === 'SELL' && (ad.asset||'').toUpperCase() === 'USDT' && (ad.fiat||'').toUpperCase() === 'CLP');
      if(!a){
        content.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:8px 0;">Sin anuncio de venta</div>';
        return;
      }
      const botEnabled = a.botEnabled === true;
    const isOnline = botEnabled && (a.status === 'online' || a.status === 'active' || a.isActive === true);
      var pms = a.paymentMethods;
      if(pms && typeof pms === 'string') pms = [pms];
      var pmBadges = (pms && Array.isArray(pms)) ? pms.slice(0,3) : [];
      var pmExtra = (pms && Array.isArray(pms) && pms.length > 3) ? '+' + (pms.length - 3) : '';
      function pmName(pm){ return typeof pm === 'object' && pm !== null ? String(pm.name || pm.id || '') : String(pm); }
      content.innerHTML = `
        <div class="bot-ad-pill" data-ad-real-id="${a.id}" data-ad-adid="${a.adId||''}">
          <div class="bot-ad-card-header">
            <span class="sell-label">Vender</span>
            <span style="flex:1;font-size:12px;font-weight:500;color:#94a3b8;">${a.asset||'USDT'} / ${a.fiat||'CLP'}</span>
            <span class="status-badge${isOnline?'':' offline'}"><span class="dot"></span>${isOnline ? 'En línea' : 'Desconectado'}</span>
            <span class="toggle-switch" onclick="event.stopPropagation();window.botToggleAdMain('${escHtml(String(a.id))}','${escHtml(a.adId||'')}',!${botEnabled})">
              <input type="checkbox" ${botEnabled?'checked':''}>
              <span class="slider"></span>
            </span>
            <button class="menu-btn" onclick="event.stopPropagation();window.botToggleAdMenu(${a.id},event);">⋯</button>
            <div class="bot-ad-menu-dropdown" id="botAdMenu_${a.id}">
              <button class="menu-item" onclick="event.stopPropagation();window.botSimpleEditAd(${a.id})">Editar anuncio</button>
              <button class="menu-item danger" onclick="event.stopPropagation();window.botPanelDeleteAd(${a.id},'${escHtml(a.adId||'')}')">Borrar anuncio</button>
            </div>
          </div>
          <div class="bot-ad-card-body" style="flex-direction:column;align-items:flex-start;gap:6px;">
            <div class="bot-ad-card-price"><span id="botAdPrice_${a.id}">${fmt(a.price)}</span><span class="currency">CLP</span></div>
            <div class="bot-ad-card-rows" style="padding:0;">
              <div class="row"><span class="label">Balance</span><span class="value" id="botAdAmount_${a.id}">${fmtFlex(a.amount)} ${a.asset||'USDT'}</span></div>
              <div class="row"><span class="label">Límite</span><span class="value" id="botAdLimits_${a.id}">$${fmtInt(a.minAmount||0)} – $${fmtInt(a.maxAmount||0)}</span></div>
            </div>
          </div>
          <div class="bot-ad-card-methods">
            ${pmBadges.map(function(pm){ return '<span class="pm-badge">'+fmtPayName(pmName(pm))+'</span>'; }).join('')}
            ${pmExtra ? '<span class="pm-badge" style="background:rgba(148,163,184,.06);color:#64748b;border-color:rgba(148,163,184,.08);">'+escHtml(pmExtra)+'</span>' : ''}
          </div>
        </div>
      `;
    }catch(e){
      content.innerHTML = '<div style="color:#fb7185;font-size:12px;text-align:center;padding:8px 0;">Error cargando anuncio</div>';
    }
  }

  function botRenderAdPill(a, idx){
    const isFirst = idx === 0;
    const botEnabled = a.botEnabled === true;
    const realId = a.id;
    var pms = a.paymentMethods;
    if(pms && typeof pms === 'string') pms = [pms];
    var pmStr = (pms && Array.isArray(pms) && pms.length) ? pms.slice(0,2).join(', ') + (pms.length > 2 ? '...' : '') : '-';
    var pmBadges = (pms && Array.isArray(pms)) ? pms.slice(0,3) : [];
    var pmExtra = (pms && Array.isArray(pms) && pms.length > 3) ? '+' + (pms.length - 3) : '';
    const isOnline = botEnabled && (a.status === 'online' || a.isActive === true);
    const cfgDisplay = (window['_adCfgOpen'] && window['_adCfgOpen'][realId]) ? '' : 'none';
    // Config grid template
    var strategy = a.botStrategy || 'top1';
    var top1Diff = a.botTop1Diff != null ? a.botTop1Diff : '';
    var spreadPct = a.botSpreadPct != null ? a.botSpreadPct : '';
    var priceSource = a.botPriceSource || 'capacity';
    var priceFloor = a.botPriceFloorPct != null ? a.botPriceFloorPct : '';
    var commission = a.botCommissionPct != null ? a.botCommissionPct : '';
    var safeMargin = a.botSafeMarginPct != null ? a.botSafeMarginPct : '';
    var minCapital = a.botMinCompetitorCapital != null ? a.botMinCompetitorCapital : '';
    var competeTransAmount = a.botCompeteTransAmount != null ? a.botCompeteTransAmount : '';
    var payType = (a.botCompetePayTypes && a.botCompetePayTypes.length && a.botCompetePayTypes[0] === '__match_ad__') ? 'match' : 'all';
    var top1Style = strategy === 'spread' ? 'display:none;' : '';
    var spreadStyle = strategy === 'top1' ? 'display:none;' : '';
    const cfgFields = [];
    if (strategy !== 'spread') cfgFields.push('Top1Diff');
    if (strategy !== 'top1') cfgFields.push('SpreadPct');
    cfgFields.push('PriceSource','CommissionPct','SafeMarginPct','MinCompetitorCapital','CompeteTransAmount','CompetePayType','ExcludedMerchants','CycleInterval','CircuitBreakPct','MinAdPriceDiffPct');
    const cfgCount = cfgFields.length;
    return `<div class="bot-ad-pill" data-ad-real-id="${realId}" data-ad-adid="${a.adId||''}" data-ad-paytype="${payType}" data-ad-paymethods="${escHtml(JSON.stringify(pms || []))}">
      <div class="bot-ad-card-header">
        <span class="sell-label">Vender</span>
        <span style="flex:1;min-width:0;font-size:12px;font-weight:500;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${a.asset||'USDT'} / ${a.fiat||'CLP'}">${a.nickname ? '<span style=\"color:#f8fafc;font-weight:700;\">'+escHtml(a.nickname)+'</span> · ' : ''}${a.asset||'USDT'} / ${a.fiat||'CLP'}</span>
        <span class="status-badge${isOnline?'':' offline'}"><span class="dot"></span>${isOnline ? 'En línea' : 'Desconectado'}</span>
        <span style="display:flex;align-items:center;gap:3px;font-size:9px;font-weight:600;color:${botEnabled ? '#34d399' : '#64748b'};letter-spacing:.3px;text-transform:uppercase;">
          <span>Bot</span>
          <span class="toggle-switch" title="${botEnabled ? 'Apagar bot' : 'Prender bot'}" onclick="event.stopPropagation();window.botToggleAdMain('${escHtml(String(a.id))}','${escHtml(a.adId||'')}',!${botEnabled})">
            <input type="checkbox" ${botEnabled?'checked':''}>
            <span class="slider"></span>
          </span>
        </span>
        ${a.fromBinance ? (() => {
          const isAdOnline = a.status === 'online' || a.status === 'active';
          return `<span style="display:flex;align-items:center;gap:3px;font-size:9px;font-weight:600;color:${isAdOnline ? '#60a5fa' : '#64748b'};letter-spacing:.3px;text-transform:uppercase;">
          <span>Anuncio</span>
          <span class="toggle-switch toggle-switch-ad" title="${isAdOnline ? 'Apagar anuncio en Binance' : 'Prender anuncio en Binance'}" onclick="event.stopPropagation();toggleBinanceAdOnline('${escHtml(a.adId||'')}',!${isAdOnline},this)">
            <input type="checkbox" ${isAdOnline?'checked':''}>
            <span class="slider"></span>
          </span>
        </span>`;
        })() : ''}
        <button class="menu-btn" onclick="event.stopPropagation();window.botToggleAdMenu(${realId},event);">⋯</button>
        <div class="bot-ad-menu-dropdown" id="botAdMenu_${realId}">
          <button class="menu-item" onclick="event.stopPropagation();window.botSimpleEditAd(${realId})">Editar anuncio</button>
          <button class="menu-item" onclick="event.stopPropagation();window.renameBotAd(${realId},'${escHtml(a.adId||'')}','${escHtml(a.exchange||'binance')}','${escHtml(a.nickname||'')}')">Nombre del anuncio</button>
          <button class="menu-item danger" onclick="event.stopPropagation();window.botPanelDeleteAd(${realId},'${escHtml(a.adId||'')}')">Borrar anuncio</button>
        </div>
      </div>
      <div class="bot-ad-card-body" style="cursor:pointer;" onclick="botToggleAdCfg(${realId})">
        <div class="bot-ad-card-price"><span id="botAdPrice_${realId}">${fmt(a.price)}</span><span class="currency">CLP</span></div>
        <div class="bot-ad-card-pair">USDT → CLP</div>
        <div class="bot-ad-card-rows">
          <div class="row"><span class="label">Balance</span><span class="value" id="botAdAmount_${realId}">${fmtFlex(a.amount)} USDT</span><span class="sync-btn" onclick="event.stopPropagation();botSyncQuantity(${realId})" title="Sincronizar saldo">⟳</span></div>
          <div class="row"><span class="label">Límite</span><span class="value" id="botAdLimits_${realId}">$${fmtInt(a.minAmount||0)} – $${fmtInt(a.maxAmount||0)}</span></div>
        </div>
      </div>
      <div class="bot-ad-card-methods">
        ${pmBadges.map(function(pm){ return '<span class="pm-badge">'+fmtPayName(pm)+'</span>'; }).join('')}
        ${pmExtra ? '<span class="pm-badge" style="background:rgba(148,163,184,.06);color:#64748b;border-color:rgba(148,163,184,.08);">'+escHtml(pmExtra)+'</span>' : ''}
      </div>
      <button class="bot-config-toggle" type="button" onclick="botToggleAdCfg(${realId})">
        <span class="arrow" id="adCfgArrow_${realId}">▼</span>
        <span class="cfg-label">Configuración</span>
        <span class="cfg-count">${cfgCount} campos</span>
      </button>
      <div class="bot-ad-pill-cfg" id="adCfg_${realId}" style="display:${cfgDisplay};padding:8px 14px 12px;">
        <div class="bot-config-grid">
          <label>Estrategia
            <select id="adCfg_${realId}_Strategy" onchange="botAdCfgStrategyChange(${realId},this.value);botSaveAdCfgField(${realId},'botStrategy',this.value)">
              <option value="top1" ${strategy==='top1'?'selected':''}>Top 1</option>
              <option value="spread" ${strategy==='spread'?'selected':''}>Spread fijo</option>
            </select>
          </label>
          <label id="adCfg_${realId}_Top1DiffLabel" style="${top1Style}">Diferencia top 1 (CLP)
            <span style="display:flex;align-items:center;gap:4px;"><input id="adCfg_${realId}_Top1Diff" type="number" step="0.01" value="${top1Diff}" placeholder="0.10" onchange="botSaveAdCfgField(${realId},'botTop1Diff',this.value)" style="flex:1;"><button class="btn small ghost" type="button" onclick="botSaveAdCfgBulk(${realId})" title="Guardar" style="font-size:12px;padding:1px 4px;">💾</button></span>
          </label>
          <label id="adCfg_${realId}_SpreadPctLabel" style="${spreadStyle}">Precio spread (CLP)
            <input id="adCfg_${realId}_SpreadPct" type="number" step="0.01" data-stored-pct="${spreadPct}" placeholder="923.00" oninput="window.botAdUpdateSpreadHint(${realId})" onchange="window.botAdSpreadPriceChanged(${realId},this.value)">
            <span id="adCfg_${realId}_SpreadHint" style="font-size:10px;color:#34d399;"></span>
          </label>
          <label>Precio fuente
            <div style="display:flex;gap:6px;align-items:center;margin-top:2px;">
              <select id="adCfg_${realId}_PriceSource" onchange="botSaveAdCfgField(${realId},'botPriceSource',this.value);botUpdateAdCostBadge(${realId});botAdUpdateSafeMarginHint(${realId})" style="flex:0 0 100px;padding:7px 10px;border-radius:6px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.5);color:#f8fafc;font-size:12px;outline:none;font-family:inherit;">
                <option value="capacity" ${priceSource==='capacity'?'selected':''}>Capacity</option>
                <option value="manual" ${priceSource==='manual'?'selected':''}>Manual</option>
              </select>
              <input id="adCfg_${realId}_PriceFloorPct" type="number" step="0.01" value="${priceFloor}" placeholder="895.83" onchange="botUpdateAdCostBadge(${realId});botSaveAdCfgField(${realId},'botPriceFloorPct',this.value);botAdUpdateRealCost(${realId});botAdUpdateSafeMarginHint(${realId})" oninput="botAdUpdateRealCost(${realId});botAdUpdateSafeMarginHint(${realId})" style="flex:1;min-width:0;">
            </div>
          </label>
          <label id="adCfg_${realId}_CommissionPctLabel" class="ad-pill-comm-field" style="display:${botSelectedExchange==='bybit'?'none':''};">Comisión (%)
            <input id="adCfg_${realId}_CommissionPct" type="number" step="0.01" value="${commission}" placeholder="0.14" onchange="botSaveAdCfgField(${realId},'botCommissionPct',this.value);botUpdateAdCostBadge(${realId})">
            <span id="adCfg_${realId}_RealCost" style="font-size:11px;color:#34d399;font-weight:600;"></span>
          </label>
          <form autocomplete="off" style="display:contents"><label>Margen seguridad (%)
            <div style="display:flex;align-items:center;gap:4px;">
              <button type="button" class="btn small ghost" onclick="window.botMarginStep('adCfg_${realId}_SafeMarginPct',-0.01)" style="flex:0 0 auto;padding:6px 12px;font-size:15px;line-height:1;">−</button>
              <input id="adCfg_${realId}_SafeMarginPct" type="number" step="0.01" value="${safeMargin}" placeholder="0" autocomplete="off" oninput="botAdUpdateSafeMarginHint(${realId});window.botSafeSave(${realId},this)" style="flex:1;min-width:0;text-align:center;">
              <button type="button" class="btn small ghost" onclick="window.botMarginStep('adCfg_${realId}_SafeMarginPct',0.01)" style="flex:0 0 auto;padding:6px 12px;font-size:15px;line-height:1;">+</button>
            </div>
            <span id="adCfg_${realId}_SafeMarginHint" style="font-size:10px;color:#34d399;"></span>
          </label></form>
          <label>Capital min competidor (USDT)
            <input id="adCfg_${realId}_MinCompetitorCapital" type="number" step="1" value="${minCapital}" placeholder="Sin filtro" onchange="botSaveAdCfgField(${realId},'botMinCompetitorCapital',this.value)">
          </label>
          <label>Competir en lista de monto (CLP)
            <input id="adCfg_${realId}_CompeteTransAmount" type="text" inputmode="numeric" value="${competeTransAmount !== '' ? Number(competeTransAmount).toLocaleString('es-CL') : ''}" placeholder="Todos los montos" oninput="window.botFormatAdTransAmountInput(this)" onchange="botSaveAdCfgField(${realId},'botCompeteTransAmount',this.value.replace(/[^\d]/g,''))">
            <span class="help-text">Solo compite contra anuncios que aceptarían este monto (ej. 50.000). Vacío = como ahora, contra toda la lista.</span>
          </label>
          <label>Filtrar pago
            <select id="adCfg_${realId}_CompetePayType" onchange="botSaveAdCfgField(${realId},'botCompetePayTypes',this.value)">
              <option value="all" ${payType==='all'?'selected':''}>Todos</option>
              <option value="match" ${payType==='match'?'selected':''}>Mismos del anuncio</option>
            </select>
          </label>
          <form autocomplete="off" style="display:contents"><label>Excluir comerciantes
            <span style="display:flex;align-items:center;gap:4px;">
              <input id="adCfg_${realId}_ExcludedMerchants" type="text" value="${escHtml(Array.isArray(a.botExcludedMerchants) ? a.botExcludedMerchants.join(', ') : '')}" placeholder="Ninguno" autocomplete="off" onblur="botSaveAdCfgField(${realId},'botExcludedMerchants',this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" style="flex:1;min-width:0;">
              <button type="button" class="btn small ghost" onclick="window.botOpenExcludeMerchantsModal(${realId})" title="Elegir de la lista de comerciantes en el mercado ahora" style="flex:0 0 auto;padding:6px 10px;font-size:12px;white-space:nowrap;">Elegir</button>
            </span>
            <span class="help-text">Nunca se les sigue el precio a estos comerciantes</span>
          </label></form>
          <label>Intervalo ciclo (seg)
            <input id="adCfg_${realId}_CycleInterval" type="number" step="1" min="1" value="${a.botCycleInterval != null ? a.botCycleInterval : ''}" placeholder="10" autocomplete="off" onblur="botSaveAdCfgField(${realId},'botCycleInterval',this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
          </label>
          <label>Circuit breaker (% caída)
            <input id="adCfg_${realId}_CircuitBreakPct" type="number" step="0.1" value="${a.botCircuitBreakPct != null ? a.botCircuitBreakPct : ''}" placeholder="3" autocomplete="off" onblur="botSaveAdCfgField(${realId},'botCircuitBreakPct',this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
          </label>
          <form autocomplete="off" style="display:contents"><label>Límite diferencia anuncios (%)
            <input id="adCfg_${realId}_MinAdPriceDiffPct" type="number" step="0.01" value="${a.botMinAdPriceDiffPct != null ? a.botMinAdPriceDiffPct : ''}" placeholder="0.1" autocomplete="off" onblur="botSaveAdCfgField(${realId},'botMinAdPriceDiffPct',this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
            <span class="help-text">Distancia mínima con tus otros anuncios (Binance exige ≥0.1%)</span>
          </label></form>
        </div>
      </div>
    </div>`;
  }

  window.botToggleAdCfg = async function(realId){
    if(!window._adCfgOpen) window._adCfgOpen = {};
    var open = !window._adCfgOpen[realId];
    window._adCfgOpen[realId] = open;
    var el = document.getElementById("adCfg_" + realId);
    if(el) el.style.display = open ? '' : 'none';
    var arrow = document.getElementById("adCfgArrow_" + realId);
    if(arrow) arrow.style.transform = open ? 'rotate(180deg)' : '';
    // Sincronizar capacities del servidor antes de leer
    if(typeof syncP2PCapacityFromServer === 'function'){
      await syncP2PCapacityFromServer();
    }
    botUpdateAdCostBadge(realId);
    botAdUpdateSafeMarginHint(realId);
    botAdUpdateRealCost(realId);
    window.botAdUpdateSpreadPriceField(realId);
  };

  window.botAdCfgStrategyChange = function(realId, value){
    var t = document.getElementById("adCfg_" + realId + "_Top1DiffLabel");
    var s = document.getElementById("adCfg_" + realId + "_SpreadPctLabel");
    if(t) t.style.display = value === 'spread' ? 'none' : '';
    if(s) s.style.display = value === 'top1' ? 'none' : '';
    if(value === 'spread') window.botAdUpdateSpreadPriceField(realId);
  };

  // Pedido explícito del usuario (ago 2026): "Spread fijo" se escribe como un
  // PRECIO en CLP (ej. 923), no como %, igual que ya funciona "Precio fuente:
  // Manual" -- el motor de precios (engine.ts) sigue guardando/usando
  // botSpreadPct como % sin cambios, esto solo traduce precio↔% en el panel.
  async function botAdGetRefPriceAndCommission(realId){
    var refPrice = null;
    var src = document.getElementById("adCfg_" + realId + "_PriceSource")?.value;
    if(src === 'capacity'){
      var activePrice = getActiveCapacityBuyPrice();
      if(activePrice){
        refPrice = activePrice;
      } else {
        try {
          const r = await fetch('/api/p2p/capacity', { credentials: 'include' });
          const d = await r.json();
          if(d?.ok && Array.isArray(d.items)){
            var found = findActiveCapacityFrom(d.items);
            if(found) refPrice = Number(found.buyPrice);
          }
        } catch(e) {}
      }
    } else {
      var floorInp = document.getElementById("adCfg_" + realId + "_PriceFloorPct");
      if(floorInp && floorInp.value !== '' && !isNaN(parseFloat(floorInp.value))){
        refPrice = parseFloat(floorInp.value);
      }
      if(!refPrice){
        var activePrice = getActiveCapacityBuyPrice();
        if(activePrice) refPrice = activePrice;
      }
    }
    var commPct = 0;
    if(botSelectedExchange === 'binance'){
      commPct = parseFloat(document.getElementById("adCfg_" + realId + "_CommissionPct").value);
      if(!commPct || isNaN(commPct)) commPct = parseFloat(document.getElementById("botExCommissionPct").value) || 0;
    }
    return { refPrice: refPrice, commPct: commPct };
  }

  // Rellena el campo con el precio equivalente al % ya guardado (data-stored-pct,
  // fijado al renderizar la tarjeta) -- solo si el usuario no está escribiendo
  // ahí mismo ahora, para no pisarle lo que está tipeando.
  window.botAdUpdateSpreadPriceField = async function(realId){
    var input = document.getElementById("adCfg_" + realId + "_SpreadPct");
    if(!input || document.activeElement === input) return;
    var storedPct = parseFloat(input.getAttribute('data-stored-pct'));
    if(isNaN(storedPct)) storedPct = 0;
    var ref = await botAdGetRefPriceAndCommission(realId);
    if(ref.refPrice > 0){
      var price = ref.refPrice * (1 + (ref.commPct + storedPct) / 100);
      input.value = price.toFixed(2);
    }
    window.botAdUpdateSpreadHint(realId);
  };

  // Feedback en vivo mientras se escribe el precio -- muestra a qué % equivale,
  // igual que el hint de "Margen de seguridad" pero en la dirección contraria.
  window.botAdUpdateSpreadHint = async function(realId){
    var hint = document.getElementById("adCfg_" + realId + "_SpreadHint");
    var input = document.getElementById("adCfg_" + realId + "_SpreadPct");
    if(!hint || !input) return;
    var price = parseFloat(input.value);
    if(isNaN(price)){ hint.textContent = ""; return; }
    var ref = await botAdGetRefPriceAndCommission(realId);
    if(!ref.refPrice || ref.refPrice <= 0){ hint.textContent = "Sin costo real detectado todavía"; hint.style.color = "#fbbf24"; return; }
    var spreadPct = ((price / ref.refPrice) - 1) * 100 - ref.commPct;
    hint.textContent = "→ equivale a " + spreadPct.toFixed(2) + "% sobre tu costo real ($" + ref.refPrice.toFixed(2) + ")";
    hint.style.color = spreadPct >= 0 ? "#34d399" : "#fb7185";
  };

  // Al guardar: traduce el precio escrito a % (lo que de verdad usa
  // engine.ts) y lo manda por el mismo camino de guardado de siempre
  // (botSaveAdCfgField) -- sin tocar el motor de precios para nada.
  window.botAdSpreadPriceChanged = async function(realId, priceValue){
    var input = document.getElementById("adCfg_" + realId + "_SpreadPct");
    var price = parseFloat(priceValue);
    if(isNaN(price)){
      botSaveAdCfgField(realId, 'botSpreadPct', '');
      return;
    }
    var ref = await botAdGetRefPriceAndCommission(realId);
    if(!ref.refPrice || ref.refPrice <= 0){
      if(input) input.style.outline = "2px solid #fb7185";
      setTimeout(function(){ if(input) input.style.outline = ""; }, 1500);
      return;
    }
    var spreadPct = ((price / ref.refPrice) - 1) * 100 - ref.commPct;
    if(input) input.setAttribute('data-stored-pct', spreadPct);
    botSaveAdCfgField(realId, 'botSpreadPct', spreadPct);
    window.botAdUpdateSpreadHint(realId);
  };

  // Botones +/- para "Margen seguridad (%)" -- pedido explícito del usuario
  // (ago 2026): en móvil el <input type="number"> no muestra flechitas
  // nativas, así que solo se podía escribir el número a mano, sin forma de
  // hacer ajustes finos a golpe de dedo. Paso de 0.01 en ambos botones (mismo
  // paso que el input ya tenía, subida y bajada se mueven igual). Dispara
  // 'input' Y 'change' porque el campo del anuncio
  // solo escucha 'input' (botAdUpdateSafeMarginHint + botSafeSave) mientras
  // que el de la config del exchange solo escucha 'change'
  // (botSaveExchangeConfig) -- así el mismo botón sirve para los dos sin
  // duplicar la lógica de guardado que ya existe en cada uno.
  window.botMarginStep = function(inputId, delta){
    var el = document.getElementById(inputId);
    if(!el) return;
    var cur = parseFloat(el.value);
    if(isNaN(cur)) cur = 0;
    var next = Math.round((cur + delta) * 100) / 100;
    el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  window.botSafeSave = function(realId, el){
    var val = el.value;
    var saveVal;
    if(val === '' || isNaN(Number(val))) {
      saveVal = null; // clear per-ad override → usa exchange config
    } else {
      saveVal = Number(val);
    }
    var container = document.querySelector('[data-ad-real-id="' + realId + '"]');
    var adId = container ? container.getAttribute('data-ad-adid') : '';
    fetch('/api/p2p/bot/ads',{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({exchange:window.botSelectedExchange||'Binance',id:realId,adId:adId||'',botSafeMarginPct:saveVal,label:window.botActiveLabel||'ONZE'})}).then(function(r){el.style.outline=r.ok?'2px solid #22c55e':'2px solid #fb7185';setTimeout(function(){el.style.outline=''},800)}).catch(function(){el.style.outline='2px solid #fb7185';setTimeout(function(){el.style.outline=''},800)});
  };
  window.botSafeFieldFlash = function(el){ el.style.outline='2px solid #22c55e'; setTimeout(function(){ el.style.outline=''; }, 800); };
  // Formato con puntos de miles mientras se escribe (ej. "100.000") -- pedido
  // explícito del usuario (sep 2026), mismo patrón ya usado en otros campos
  // de CLP del panel (ver socioBnFormatClpInput/usdtFormatClpInput). El
  // guardado real (botSaveAdCfgField) recibe el valor sin puntos.
  window.botFormatAdTransAmountInput = function(el){
    const digits = el.value.replace(/[^\d]/g, '');
    el.value = digits ? Number(digits).toLocaleString('es-CL') : '';
  };

  window.botSaveAdCfgField = function(realId, field, value){
    var body = { exchange: botSelectedExchange, id: realId, label: botActiveLabel || "ONZE" };
    // Read adId from the parent container's data attribute
    var container = document.querySelector('[data-ad-real-id="' + realId + '"]');
    var adId = container ? container.getAttribute('data-ad-adid') : '';
    if (adId) body.adId = adId;
    if(field === 'botCompetePayTypes'){
      body[field] = value === 'match' ? ['__match_ad__'] : ['all'];
    } else if(field === 'botExcludedMerchants'){
      // Nicknames de Binance separados por coma -- guardado como lista,
      // vacío = sin exclusiones (comportamiento normal de siempre).
      var excludedList = String(value || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      body[field] = excludedList.length ? excludedList : null;
    } else {
      body[field] = value === '' ? null : (field === 'botStrategy' || field === 'botPriceSource' ? value : Number(value));
    }
    // Resalta el campo que realmente se está guardando (antes siempre
    // resaltaba "Margen seguridad" sin importar cuál campo fuera).
    var suffix = field === 'botCompetePayTypes' ? 'CompetePayType' : field.replace(/^bot/, '');
    var targetInput = document.getElementById("adCfg_" + realId + "_" + suffix);
    if(targetInput) targetInput.style.outline = "2px solid #fbbf24";
    fetch("/api/p2p/bot/ads", {
      method:"PUT", credentials:"include",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(body)
    }).then(function(r){
      if(r.ok && targetInput) targetInput.style.outline = "2px solid #34d399";
      else if(!r.ok){
        if(targetInput) targetInput.style.outline = "2px solid #fb7185";
        console.warn("[P2P Bot] save cfg error: HTTP", r.status, r.statusText);
      }
      setTimeout(function(){ if(targetInput) targetInput.style.outline = ""; }, 1500);
    }).catch(function(e){
      if(targetInput) targetInput.style.outline = "2px solid #fb7185";
      setTimeout(function(){ if(targetInput) targetInput.style.outline = ""; }, 1500);
      console.warn("[P2P Bot] save cfg error:", e);
    });
  };

  // Pedido explícito del usuario (ago 2026): en vez de escribir el nickname
  // a mano, poder ELEGIR de una lista real de comerciantes vistos en el
  // mercado ahora mismo. Reusa /api/p2p/bot/market (ya existente, guarda una
  // foto de los competidores en cada ciclo del bot) -- no crea ningún
  // endpoint nuevo. Solo llena el mismo input de texto de siempre y dispara
  // el mismo guardado (botSaveAdCfgField) -- cero cambios en cómo se guarda.
  window.botOpenExcludeMerchantsModal = async function(realId){
    var input = document.getElementById("adCfg_" + realId + "_ExcludedMerchants");
    var current = new Set(
      (input ? input.value : "").split(",").map(function(s){ return s.trim(); }).filter(Boolean)
    );

    // Pedido explícito del usuario (ago 2026): el anuncio "Banco Estado" debe
    // mostrar solo comerciantes que acepten Banco Estado (igual que compite
    // de verdad ese anuncio, __match_ad__ en engine.ts); el anuncio "todos
    // los bancos" sigue mostrando el mercado completo, sin cambios.
    var container = document.querySelector('[data-ad-real-id="' + realId + '"]');
    var adPayType = container ? container.getAttribute('data-ad-paytype') : 'all';
    var adPayMethods = [];
    try{ adPayMethods = JSON.parse((container && container.getAttribute('data-ad-paymethods')) || '[]'); }catch(e){}
    var adPayMethodsLower = adPayMethods.map(function(p){ return String(p).trim().toLowerCase(); });

    var backdrop = document.getElementById("botExcludeMerchantsModal");
    if(backdrop) backdrop.remove();
    backdrop = document.createElement("div");
    backdrop.id = "botExcludeMerchantsModal";
    backdrop.style.cssText = "position:fixed;inset:0;z-index:1000002;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px;background:rgba(2,6,23,.72);backdrop-filter:blur(10px);";
    backdrop.addEventListener("mousedown", function(e){ if(e.target === backdrop) backdrop.remove(); });

    backdrop.innerHTML = '<div style="width:min(440px,100%);border:1px solid rgba(148,163,184,.18);background:linear-gradient(180deg,rgba(15,23,42,.98),rgba(2,6,23,.98));border-radius:16px;padding:20px;position:relative;">'
      + '<button type="button" onclick="document.getElementById(\'botExcludeMerchantsModal\').remove()" style="position:absolute;top:14px;right:14px;width:26px;height:26px;border-radius:8px;border:1px solid rgba(148,163,184,.2);background:rgba(148,163,184,.1);color:#cbd5e1;cursor:pointer;font-size:15px;line-height:1;">✕</button>'
      + '<h3 style="color:#f8fafc;margin-bottom:4px;padding-right:30px;font-size:16px;">Excluir comerciantes</h3>'
      + '<p style="color:#8aa0ba;font-size:12px;margin-bottom:14px;">Marca a quién NO seguirle el precio. Lista tomada del último ciclo del bot' + (adPayType === 'match' ? ' — filtrada al mismo método de pago de este anuncio' : ' — mercado completo') + '.</p>'
      + '<div id="botExcludeMerchantsList" style="max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:2px;">Cargando comerciantes…</div>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">'
      + '<button type="button" class="btn secondary" onclick="document.getElementById(\'botExcludeMerchantsModal\').remove()">Cancelar</button>'
      + '<button type="button" class="btn" id="botExcludeMerchantsSaveBtn" onclick="window.botSaveExcludedMerchantsFromModal(' + realId + ')">Guardar</button>'
      + '</div></div>';
    document.body.appendChild(backdrop);

    try{
      var res = await fetch("/api/p2p/bot/market?type=latest&exchange=" + encodeURIComponent(botSelectedExchange) + "&label=" + encodeURIComponent(botActiveLabel || "ONZE") + "&limit=60&live=true", { credentials: "include" });
      var data = await res.json();
      var listEl = document.getElementById("botExcludeMerchantsList");
      if(!listEl) return;
      if(!data.ok){
        listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#fb7185;font-size:13px;">Error trayendo el mercado: ' + escHtml(data.error || 'desconocido') + '</div>';
        return;
      }
      var ranked = (data.data && Array.isArray(data.data.ranked)) ? data.data.ranked : [];
      if(adPayType === 'match' && adPayMethodsLower.length > 0){
        // El propio anuncio guarda su método de pago como IDENTIFICADOR
        // (código interno de Binance, ver /api/p2p/bot/ads), no como nombre
        // legible -- por eso se compara contra ambos campos (identifier Y
        // name) de cada competidor, igual que hace engine.ts para no
        // quedarse sin coincidencias por comparar cosas distintas.
        ranked = ranked.filter(function(c){
          var cmpValues = (c.paymentMethods || []).reduce(function(acc, pm){
            if(pm.identifier) acc.push(String(pm.identifier).trim().toLowerCase());
            if(pm.name) acc.push(String(pm.name).trim().toLowerCase());
            return acc;
          }, []);
          return cmpValues.some(function(v){ return adPayMethodsLower.indexOf(v) !== -1; });
        });
      }
      // Por si algún nickname que ya estaba excluido ya no aparece en el mercado ahora mismo -- lo mostramos igual, marcado, al final.
      var seenNick = new Set(ranked.map(function(c){ return c.nickName; }));
      var extra = Array.from(current).filter(function(n){ return !seenNick.has(n); }).map(function(n){ return { nickName: n, price: null, available: null }; });
      var all = ranked.concat(extra);
      if(all.length === 0){
        listEl.innerHTML = adPayType === 'match'
          ? '<div style="padding:16px;text-align:center;color:#64748b;font-size:13px;">Ningún comerciante con este método de pago apareció en el último ciclo. Vuelve a intentar en un momento, o escribe el nombre a mano.</div>'
          : '<div style="padding:16px;text-align:center;color:#64748b;font-size:13px;">Sin datos de mercado todavía. Deja el bot corriendo un momento y vuelve a intentar, o escribe el nombre a mano.</div>';
        return;
      }
      listEl.innerHTML = all.map(function(c){
        var nick = c.nickName || "(sin nombre)";
        var checked = current.has(c.nickName) ? "checked" : "";
        var fmtNum = function(n, dec){ return Number(n).toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec }); };
        var meta = (c.price != null ? fmtNum(c.price, 2) + " CLP" : "") + (c.available != null ? " · " + fmtNum(c.available, 0) + " USDT disp." : "");
        return '<label style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid rgba(148,163,184,.08);cursor:pointer;">'
          + '<input type="checkbox" value="' + escHtml(c.nickName || "") + '" ' + checked + ' style="flex:0 0 auto;width:16px;height:16px;">'
          + '<span style="flex:1;min-width:0;"><div style="color:#f8fafc;font-size:13px;font-weight:600;">' + escHtml(nick) + '</div>'
          + (meta ? '<div style="color:#8aa0ba;font-size:11px;margin-top:1px;">' + escHtml(meta) + '</div>' : '') + '</span>'
          + '</label>';
      }).join("");
    }catch(e){
      var listEl2 = document.getElementById("botExcludeMerchantsList");
      if(listEl2) listEl2.innerHTML = '<div style="padding:16px;text-align:center;color:#fb7185;font-size:13px;">Error cargando la lista: ' + escHtml(e.message || "") + '</div>';
    }
  };

  window.botSaveExcludedMerchantsFromModal = function(realId){
    var modal = document.getElementById("botExcludeMerchantsModal");
    if(!modal) return;
    var checked = Array.from(modal.querySelectorAll('input[type="checkbox"]:checked')).map(function(el){ return el.value; }).filter(Boolean);
    var input = document.getElementById("adCfg_" + realId + "_ExcludedMerchants");
    if(input){
      input.value = checked.join(", ");
      botSaveAdCfgField(realId, "botExcludedMerchants", input.value);
    }
    modal.remove();
  };

  window.botSaveAdCfgBulk = function(realId){
    if(!realId) return;
    var body = { exchange: botSelectedExchange, id: realId, label: botActiveLabel || "ONZE" };
    // Read adId from the parent container's data attribute
    var container = document.querySelector('[data-ad-real-id="' + realId + '"]');
    var adId = container ? container.getAttribute('data-ad-adid') : '';
    if (adId) body.adId = adId;
    body.botStrategy       = document.getElementById("adCfg_" + realId + "_Strategy").value;
    body.botTop1Diff       = parseFloat(document.getElementById("adCfg_" + realId + "_Top1Diff").value);
    if(isNaN(body.botTop1Diff)) body.botTop1Diff = null;
    // El campo ahora muestra un PRECIO (CLP), no el %; el % real que usa el
    // motor de precios queda guardado en data-stored-pct (lo actualiza
    // botAdSpreadPriceChanged cada vez que se edita el precio).
    var spreadPctInp = document.getElementById("adCfg_" + realId + "_SpreadPct");
    body.botSpreadPct = spreadPctInp ? parseFloat(spreadPctInp.getAttribute('data-stored-pct')) : NaN;
    if(isNaN(body.botSpreadPct)) body.botSpreadPct = null;
    body.botPriceSource    = document.getElementById("adCfg_" + realId + "_PriceSource").value;
    body.botPriceFloorPct  = parseFloat(document.getElementById("adCfg_" + realId + "_PriceFloorPct").value);
    if(isNaN(body.botPriceFloorPct)) body.botPriceFloorPct = null;
    body.botCommissionPct  = parseFloat(document.getElementById("adCfg_" + realId + "_CommissionPct").value);
    if(isNaN(body.botCommissionPct)) body.botCommissionPct = null;
    body.botSafeMarginPct  = parseFloat(document.getElementById("adCfg_" + realId + "_SafeMarginPct").value);
    if(isNaN(body.botSafeMarginPct)) body.botSafeMarginPct = null;
    body.botMinCompetitorCapital = parseFloat(document.getElementById("adCfg_" + realId + "_MinCompetitorCapital").value);
    if(isNaN(body.botMinCompetitorCapital)) body.botMinCompetitorCapital = null;
    var payType = document.getElementById("adCfg_" + realId + "_CompetePayType").value;
    body.botCompetePayTypes = payType === "match" ? ["__match_ad__"] : null;
    var excludedInp = document.getElementById("adCfg_" + realId + "_ExcludedMerchants");
    if(excludedInp){
      var excludedList2 = String(excludedInp.value || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      body.botExcludedMerchants = excludedList2.length ? excludedList2 : null;
    }
    var cycleInp = document.getElementById("adCfg_" + realId + "_CycleInterval");
    body.botCycleInterval = cycleInp ? parseInt(cycleInp.value) || null : null;
    var cbInp = document.getElementById("adCfg_" + realId + "_CircuitBreakPct");
    body.botCircuitBreakPct = cbInp ? parseFloat(cbInp.value) || null : null;
    var mdInp = document.getElementById("adCfg_" + realId + "_MinAdPriceDiffPct");
    body.botMinAdPriceDiffPct = mdInp ? parseFloat(mdInp.value) || null : null;
    var _r = Math.random().toString(36).slice(2);
    fetch("/api/p2p/bot/ads?_=" + _r, {
      method:"PUT", credentials:"include",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(body)
    }).then(function(r){
      if(r.ok) window.botLoadAds();
      else console.warn("[P2P Bot] save bulk error: HTTP", r.status, r.statusText);
    }).catch(function(e){ console.warn("[P2P Bot] save bulk error:", e); });
  };

  window.botUpdateAdCostBadge = function(realId){
    var source = document.getElementById("adCfg_" + realId + "_PriceSource")?.value || 'manual';
    if(source === 'manual') { botRefreshAdPrices(); botAdUpdateRealCost(realId); return; }
    var cache = window.__p2pCapacityCache;
    var active;
      if(cache && Array.isArray(cache) && cache.length > 0){
        active = findActiveCapacityFrom(cache);
      }
      if(!active){
        fetch('/api/p2p/capacity', { credentials: 'include' }).then(function(r){ return r.json(); }).then(function(data){
          if(data?.ok && Array.isArray(data.items)){
            var fetched = findActiveCapacityFrom(data.items);
          if(fetched){
            var fi = document.getElementById("adCfg_" + realId + "_PriceFloorPct");
            if(fi) { fi.value = Number(fetched.buyPrice).toFixed(2); botSaveAdCfgField(realId, 'botPriceFloorPct', fi.value); }
          } else {
            var fi2 = document.getElementById("adCfg_" + realId + "_PriceFloorPct");
            if(fi2) { fi2.value = "0"; botSaveAdCfgField(realId, 'botPriceFloorPct', "0"); }
          }
        } else {
          var fi3 = document.getElementById("adCfg_" + realId + "_PriceFloorPct");
          if(fi3) { fi3.value = "0"; botSaveAdCfgField(realId, 'botPriceFloorPct', "0"); }
        }
        botRefreshAdPrices();
        botAdUpdateRealCost(realId);
      }).catch(function(){});
      return;
    }
    var floorInp = document.getElementById("adCfg_" + realId + "_PriceFloorPct");
    if(floorInp) {
      floorInp.value = Number(active.buyPrice).toFixed(2);
      botSaveAdCfgField(realId, 'botPriceFloorPct', floorInp.value);
    }
    botRefreshAdPrices();
    botAdUpdateRealCost(realId);
  };

  window.botAdUpdateRealCost = function(realId){
    var costEl = document.getElementById("adCfg_" + realId + "_RealCost");
    if(!costEl) return;
    var source = document.getElementById("adCfg_" + realId + "_PriceSource")?.value || 'manual';
    var basePrice = 0;
    var priceSource = "";
    if(source === 'capacity'){
      var cache = window.__p2pCapacityCache;
      if(cache && Array.isArray(cache)){
        var active = findActiveCapacityFrom(cache);
        if(active?.buyPrice){
          basePrice = Number(active.buyPrice);
          priceSource = active.provider || active.country || "Capacity";
        }
      }
    }else{
      var manualVal = document.getElementById("adCfg_" + realId + "_PriceFloorPct")?.value;
      basePrice = parseFloat(manualVal) || 0;
      priceSource = "Manual";
    }
    if(basePrice > 0){
      var commPct = parseFloat(document.getElementById("adCfg_" + realId + "_CommissionPct").value);
      if(!commPct || isNaN(commPct)) commPct = parseFloat(document.getElementById("botExCommissionPct").value) || 0.14;
      var realCost = basePrice * (1 + commPct / 100);
      if(botSelectedExchange === 'binance'){
        costEl.textContent = "COSTO REAL: $" + realCost.toFixed(2) + " (" + priceSource + " + " + commPct + "%)";
      }else{
        costEl.textContent = "PRECIO: $" + basePrice.toFixed(2);
      }
      costEl.style.display = '';
    }else{
      costEl.style.display = 'none';
    }
  };

  window.botRefreshAdPrices = async function(){
    var ex = botSelectedExchange;
    if(!ex) return;
    try{
      var r = await fetch("/api/p2p/bot/ads?exchange=" + encodeURIComponent(ex) + "&label=" + encodeURIComponent(botActiveLabel || "ONZE"), { credentials:"include" });
      var d = await r.json();
      if(!d?.ok || !Array.isArray(d.ads)) return;
      d.ads.forEach(function(a){
        var priceSpan = document.getElementById("botAdPrice_" + a.id);
        if(priceSpan && a.price != null) priceSpan.textContent = a.price.toFixed(2);
        var amountSpan = document.getElementById("botAdAmount_" + a.id);
        if(amountSpan && a.amount != null) amountSpan.textContent = fmtFlex(a.amount) + " " + (a.asset||'USDT');
        var limitsSpan = document.getElementById("botAdLimits_" + a.id);
        if(limitsSpan && a.minAmount != null) limitsSpan.textContent = "$" + fmtInt(a.minAmount) + " - $" + fmtInt(a.maxAmount) + " CLP";
      });
    }catch(e){}
  };

  window.botToggleAdMenu = function(id, e){
    var menu = document.getElementById("botAdMenu_" + id);
    if(!menu) return;
    var open = menu.classList.contains("open");
    document.querySelectorAll(".bot-ad-menu-dropdown.open").forEach(function(m){ m.classList.remove("open"); });
    if(!open){
      var rect = e.currentTarget.getBoundingClientRect();
      menu.style.left = Math.max(5, Math.min(rect.right - 160, window.innerWidth - 165)) + "px";
      menu.style.top = (rect.bottom + 4) + "px";
      menu.classList.add("open");
    }
  };
  document.addEventListener("click", function(e){
    document.querySelectorAll(".bot-ad-menu-dropdown.open").forEach(function(m){ m.classList.remove("open"); });
  });

  window.botToggleAdMain = function(id, adId, enabled){
    var body = { exchange: botSelectedExchange, botEnabled: enabled, botManaged: enabled, label: botActiveLabel || "ONZE" };
    if(adId) body.adId = String(adId);
    else if(id) body.id = Number(id);
    fetch("/api/p2p/bot/ads", {
      method:"PUT", credentials:"include",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(body)
    }).then(function(r){
      return r.json().then(function(d){
        if(!d.ok) console.warn("[P2P Bot] toggle error:", d);
        window.botLoadAds();
      });
    }).catch(function(e){ console.warn("[P2P Bot] toggle error", e); });
  };

  window.botSyncQuantity = async function(realId){
    var adId = document.querySelector('[data-ad-real-id="' + realId + '"]')?.dataset?.adAdid;
    if(!adId) return;
    var btn = document.querySelector('[data-ad-real-id="' + realId + '"] .bot-ad-card-rows .sync-btn');
    if(btn) btn.textContent = '···';
    try{
      var r = await fetch("/api/p2p/bot/sync-quantity", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ exchange: botSelectedExchange, adId: adId, label: botActiveLabel || "ONZE" })
      });
      var d = await r.json();
      if(d?.ok){
        window.botLoadAds();
      }else{
        console.warn("[P2P Bot] sync error:", d?.error);
      }
    }catch(e){ console.warn("[P2P Bot] sync error", e); }
    if(btn) btn.textContent = '↻';
  };

  /* end per-ad functions */

  // Pedido explícito del usuario (sep 2026): "Actividad en vivo" se quedaba
  // congelada minutos enteros -- medido en vivo: el llamado a
  // /api/p2p/bot/cycle desde el navegador debería completarse cada ~1s, pero
  // en producción (no en localhost, que pega directo a Binance desde la
  // conexión de casa) los huecos reales entre ciclos promediaron 27s y
  // llegaron a 131s -- coincide con el límite de 35s que ya existe del lado
  // del servidor para el procesamiento de chat de una orden (ver
  // processOrder en chat-agent.ts), que en Vercel tarda más en responder.
  // Como scheduleBotCycle espera a que ESTA llamada termine antes de volver
  // a pintar la pantalla (botRefreshExchange) Y antes de programar el
  // siguiente ciclo, un solo procesamiento lento congelaba TODO el panel
  // hasta que terminaba. Esto NO toca el procesamiento de chat en sí (sigue
  // corriendo igual, con su propio límite de 35s en el servidor) -- solo
  // hace que el NAVEGADOR deje de esperarlo indefinidamente: si no responde
  // en FETCH_TIMEOUT_MS, se aborta esta vuelta puntual y se sigue con el
  // próximo tick normal, así la pantalla no se queda pegada.
  const BOT_CYCLE_FETCH_TIMEOUT_MS = 20_000;
  function fetchBotCycleWithTimeout(label){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BOT_CYCLE_FETCH_TIMEOUT_MS);
    return fetch("/api/p2p/bot/cycle", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  }

  window.botStartExchange = async function(){
    const ex = botSelectedExchange;
    const startLabel = botActiveLabel; // fija la cuenta a la que se le da "Iniciar", no la variable en vivo
    await fetch("/api/p2p/bot/exchange-config", {
      method:"POST",
      credentials:"include",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ exchange: ex, action: "start", label: startLabel })
    });
    // Cada cuenta (label) tiene su propio cronómetro -- si esta cuenta ya
    // tiene uno corriendo, no hace falta reiniciarlo (y nunca se toca el
    // cronómetro de OTRA cuenta que pueda estar corriendo en paralelo).
    const startEntry = getBotCycleEntry(startLabel);
    if(startEntry.active) return;
    // Save interval to backend (used for rate-limit cooldown)
    const interval = Math.round(parseFloat(document.getElementById("botCycleInterval").value)) || 10;
    // Timer runs every 1 second — backend handles rate limits internally
    const botStopExchange = window.botStopExchange;
    startEntry.active = true;
    async function scheduleBotCycle(){
      try{
        const res = await fetchBotCycleWithTimeout(startLabel);
        const data = await res.json();
        if(data?.state?.binance){
          const st = data.state.binance;
          const el = id=>document.getElementById(id);
          el('botKpiCambios').textContent = st.cambiosEstaHora + '/' + (st.cambiosMax||30);
          const ultimo = st.ultimoCambioHace >= 0 ? 'hace ' + st.ultimoCambioHace + 's' : '—';
          el('botKpiUltimoCambio').textContent = ultimo;
          el('botKpiWeight').textContent = st.weightActual;
          el('botKpiCompetitors').textContent = st.competidores || '—';
          const fetchEn = st.proximoFetchEn || 0;
          el('botKpiCompetitorsSub').textContent = fetchEn > 0 ? 'próximo fetch en ' + fetchEn + 's' : 'actualizando...';
          const puede = st.puedeActualizar;
          const statusEl = el('botKpiExchangeStatus');
          if(statusEl){
            statusEl.textContent = puede ? '● Listo' : '● Esperando';
            statusEl.style.color = puede ? '#34d399' : '#fbbf24';
          }
          // Counter next to "Anuncios" header
          const counterEl = el('botCambiosCounter');
          if(counterEl){
            const used = st.cambiosEstaHora || 0;
            const max = st.cambiosMax || 30;
            counterEl.textContent = used + '/' + max + ' cambios';
            if(used >= max) counterEl.style.color = '#ef4444';
            else if(used >= max * 0.8) counterEl.style.color = '#fbbf24';
            else counterEl.style.color = '#34d399';
          }
          // Autolímite real de Binance (36 llamadas/min por cuenta, confirmado
          // por soporte jul 2026) — self-throttle propio del bot a 32/min.
          const rlEl = el('botKpiRateLimit');
          const rlSubEl = el('botKpiRateLimitSub');
          if(rlEl){
            const rlUsed = st.rateLimitUsado || 0;
            const rlCap = st.rateLimitCap || 32;
            const rlReserved = st.rateLimitReservado || 4;
            rlEl.textContent = rlUsed + '/' + rlCap;
            if(rlUsed >= rlCap) rlEl.style.color = '#ef4444';
            else if(rlUsed >= rlCap - rlReserved) rlEl.style.color = '#fbbf24';
            else rlEl.style.color = '#34d399';
            // Resincroniza el cronómetro local con el dato real del servidor;
            // el "tick" de cada segundo lo pinta botRateLimitTick() aparte.
            botRateLimitHidden = !!st.anuncioOculto;
            botRateLimitResetAt = Date.now() + (st.rateLimitResetEnMs || 0);
            botRateLimitTick();
          }
        }
        window.botRefreshExchange(true);
        botCycleRefresh(false);
        // If backend says nothing is running, stop the cycle
        if(data?.ok && data?.running === false){
          botStopCycleForLabel(startLabel);
          return;
        }
      }catch(e){}
      // Antes 300ms -- sin ningún freno real en el servidor, cada tick hacía
      // llamadas reales a Binance/Bybit (ver MIN_CYCLE_GAP_MS en engine.ts),
      // disparando el uso de CPU en Vercel muy por encima de lo necesario
      // (ago 2026, la cuenta quedó bloqueada por exceder el límite de uso
      // justo). 1000ms calza con el freno del servidor -- pedir más seguido
      // que eso solo generaba pedidos que el servidor iba a ignorar igual.
      if(startEntry.active) startEntry.timer = setTimeout(scheduleBotCycle, 1000);
    }
    scheduleBotCycle();
    await window.botRefreshExchange();
  };

  function botStartChatCycle(){
    const chatLabel = botActiveLabel; // fija la cuenta, misma razón que en botStartExchange
    const entry = getBotCycleEntry(chatLabel);
    if(entry.chatTimer) return;
    entry.chatActive = true;
    async function scheduleBotCycle(){
      try{
        await fetchBotCycleWithTimeout(chatLabel);
        window.botRefreshExchange(true);
      }catch(e){}
      if(entry.chatActive) entry.chatTimer = setTimeout(scheduleBotCycle, 2000);
    }
    scheduleBotCycle();
  }

  window.botStopExchange = async function(){
    const ex = botSelectedExchange;
    // Update UI immediately
    const stopBtn = document.getElementById("botStopBtn");
    if(stopBtn) stopBtn.textContent = "■ Detener";
    updateBotUI({ running: false });
    // Fire-and-forget API call to save state
    fetch("/api/p2p/bot/exchange-config", {
      method:"POST",
      credentials:"include",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ exchange: ex, action: "stop", label: botActiveLabel })
    }).then(async r => {
      if(!r.ok){
        const errData = await r.json().catch(()=>({}));
        console.error("[Stop] Error del servidor:", r.status, errData);
      }
    }).finally(() => window.botRefreshExchange());
    // Cada cuenta tiene su propio cronómetro (ver getBotCycleEntry) -- esto
    // solo apaga el de la cuenta que se está mirando ahora mismo, nunca el
    // de otra cuenta que pueda seguir corriendo en paralelo.
    botStopCycleForLabel(botActiveLabel);
  };

  async function botRefreshExchange(skipConfig){
    const ex = botSelectedExchange;
    const requestedLabel = botActiveLabel; // para descartar la respuesta si el usuario cambia de pestaña antes de que llegue
    const lbl = "&label=" + encodeURIComponent(botActiveLabel);
    // Each fetch is independent so one failure doesn't block the rest
    try{
      fetch("/api/p2p/bot/config", { credentials:"include" }).then(r=>r.json()).then(d=>{ if(d?.ok && d?.config) updateBotConfig(d.config); }).catch(()=>{});
    }catch(e){}
    try{
      fetch("/api/p2p/bot/logs?limit=200&exchange=" + encodeURIComponent(ex) + lbl, { credentials:"include" }).then(r=>r.json()).then(d=>{ if(d?.ok) renderBotLogs(d.logs); }).catch(()=>{});
    }catch(e){}
    try{
      fetch("/api/p2p/bot/orders?limit=20&live=true&exchange=" + ex + lbl, { credentials:"include" }).then(r=>r.json()).then(d=>{ if(d?.ok) renderBotOrders(d.orders); }).catch(()=>{});
    }catch(e){}

    fetch("/api/p2p/bot/exchange-config?_=" + Math.random().toString(36).slice(2) + lbl, { credentials:"include" })
      .then(r=>r.json()).then(exData=>{
        // Descartar respuesta si el usuario ya cambió de pestaña — evita que una
        // respuesta vieja (de la cuenta que se estaba mirando antes) pise por un
        // instante el estado correcto de la cuenta que se está mirando ahora.
        if(botActiveLabel !== requestedLabel) return;
        var allExchanges = {};
        var runningLabel = "";
        if(exData?.ok && exData?.configs){
          for(var exKey in exData.configs){
            var enabled = exData.configs[exKey]?.enabled;
            allExchanges[exKey] = enabled;
            if(enabled){
              runningLabel = runningLabel ? runningLabel + ", " + exKey.charAt(0).toUpperCase() + exKey.slice(1) : exKey.charAt(0).toUpperCase() + exKey.slice(1);
            }
          }
        }
        var exStatus = exData?.ok && exData?.configs?.[ex];
        if(exStatus){
          updateBotUI({ running: exStatus.enabled, config: exStatus, _allExchanges: allExchanges, _runningLabel: runningLabel });
          if(!skipConfig) updateExchangeConfig(exStatus);
        }else{
          updateBotUI({ running: false, _allExchanges: allExchanges, _runningLabel: runningLabel });
        }
      }).catch(()=>{});

    loadCredentials(ex).catch(()=>{});
    botUpdateBuyPrice();
    botRefreshAdPrices();
  }

  function updateBotUI(status){
    var indicator = document.getElementById("botStatusIndicator");
    var dot = document.getElementById("botStatusDot");
    var text = document.getElementById("botStatusText");
    if(!indicator || !dot || !text) return;

    // If we have all exchange statuses, use the aggregate
    var anyRunning = status._allExchanges ? Object.values(status._allExchanges).some(function(v){ return v; }) : status.running;
    var runningLabel = status._runningLabel || (status.running ? botSelectedExchange : "");

    if(anyRunning){
      indicator.className = "bot-status-indicator running";
      dot.className = "bot-status-dot running";
      text.textContent = runningLabel ? "Ejecutando (" + runningLabel + ")" : "Ejecutando";
    }else if(status.config?.pauseUntil && new Date(status.config.pauseUntil) > new Date()){
      indicator.className = "bot-status-indicator paused";
      dot.className = "bot-status-dot paused";
      text.textContent = "Pausado";
    }else{
      indicator.className = "bot-status-indicator stopped";
      dot.className = "bot-status-dot stopped";
      text.textContent = "Detenido";
    }
    // Update exchange KPI
    var kpiEx = document.getElementById("botKpiExchange");
    var kpiExStatus = document.getElementById("botKpiExchangeStatus");
    if(kpiEx) kpiEx.textContent = botSelectedExchange.charAt(0).toUpperCase() + botSelectedExchange.slice(1);
    if(kpiExStatus) kpiExStatus.textContent = anyRunning ? "En ejecución" : "Detenido";
  }

  function setField(id, value){
    var el = document.getElementById(id);
    if(el){
      if(el.type === 'checkbox') el.checked = !!value;
      else el.value = value;
    }
  }

  window.botExUpdateSafeMarginHint = function(){
    var pct = parseFloat(document.getElementById("botExSafeMarginPct").value) || 0;
    var hint = document.getElementById("botExSafeMarginHint");
    if(!hint) return;
    // Leer del input PriceFloorPct (lo actualiza botUpdateBuyPrice / el motor),
    // no del cache, para que coincida con el valor que el motor usa en safeFloor.
    var refPrice = parseFloat(document.getElementById("botExPriceFloorPct")?.value) || 0;
    if(!refPrice){
      var priceEl = document.querySelector(".bot-ad-card-price span");
      if(priceEl){
        var txt = priceEl.textContent.replace(/[^0-9.,]/g, "").replace(",", ".");
        refPrice = parseFloat(txt) || 0;
      }
    }
    if(!refPrice){
      refPrice = getActiveCapacityBuyPrice() || 0;
    }
    // Bybit/OKX no cobran comisión -- el piso ahí es solo costo + margen.
    var commPct = botSelectedExchange === 'binance' ? (parseFloat(document.getElementById("botExCommissionPct").value) || 0) : 0;
    var realCost = refPrice > 0 ? refPrice * (1 + commPct / 100) : refPrice;
    var threshold = realCost > 0 ? realCost * (1 + pct / 100) : 0;
    hint.textContent = refPrice > 0
      ? "→ ignora bajo $" + threshold.toFixed(2)
      : "→ " + pct + "% sobre tu costo real";
    hint.style.color = "#34d399";
  };

  window.botAdUpdateSafeMarginHint = async function(realId){
    var hint = document.getElementById("adCfg_" + realId + "_SafeMarginHint");
    if(!hint) return;
    var pctInput = document.getElementById("adCfg_" + realId + "_SafeMarginPct").value;
    var pct = parseFloat(pctInput);
    if(pctInput === "" || isNaN(pct)) pct = parseFloat(document.getElementById("botExSafeMarginPct").value) || 0;
    var refPrice = null;
    var src = document.getElementById("adCfg_" + realId + "_PriceSource")?.value;
    if(src === 'capacity'){
      var activePrice = getActiveCapacityBuyPrice();
      if(activePrice){
        refPrice = activePrice;
      } else {
        try {
          const r = await fetch('/api/p2p/capacity', { credentials: 'include' });
          const d = await r.json();
          if(d?.ok && Array.isArray(d.items)){
            var found = findActiveCapacityFrom(d.items);
            if(found) refPrice = Number(found.buyPrice);
          }
        } catch(e) {}
      }
    } else {
      var floorInp = document.getElementById("adCfg_" + realId + "_PriceFloorPct");
      if(floorInp && floorInp.value !== '' && !isNaN(parseFloat(floorInp.value))){
        refPrice = parseFloat(floorInp.value);
      }
      if(!refPrice){
        var activePrice = getActiveCapacityBuyPrice();
        if(activePrice) refPrice = activePrice;
      }
    }
    // Bybit/OKX no cobran comisión -- el piso ahí es solo costo + margen.
    var commPct = 0;
    if(botSelectedExchange === 'binance'){
      commPct = parseFloat(document.getElementById("adCfg_" + realId + "_CommissionPct").value);
      if(!commPct || isNaN(commPct)) commPct = parseFloat(document.getElementById("botExCommissionPct").value) || 0;
    }
    var threshold = refPrice > 0 ? refPrice * (1 + (commPct + pct) / 100) : 0;
    hint.textContent = refPrice > 0
      ? "→ ignora bajo $" + threshold.toFixed(2)
      : "→ " + pct + "% sobre tu costo real";
    hint.style.color = "#34d399";
  };

  function updateExchangeConfig(cfg){
    if(!cfg) return;
    setField("botExStrategy", cfg.strategy || "top1");
    setField("botExTop1Diff", cfg.top1Diff ?? 0.1);
    setField("botExSpreadPct", cfg.spreadPct || 0.5);
    setField("botExPriceSource", cfg.priceSource || "capacity");
    setField("botExPriceFloorPct", cfg.priceFloorPct ?? 0);
    setField("botExCommissionPct", cfg.commissionPct ?? 0.14);
    setField("botExSafeMarginPct", cfg.safeMarginPct ?? 0);
    if(window.botExUpdateSafeMarginHint) window.botExUpdateSafeMarginHint();
    setField("botExMinCompetitorCapital", cfg.minCompetitorCapital ?? "");
    const payTypes = cfg.competePayTypes;
    setField("botExCompetePayType", (payTypes && payTypes.length > 0 && payTypes[0] === "__match_ad__") ? "match" : "all");
    setField("botCircuitBreakPct", cfg.circuitBreakPct || 3);
    setField("botMinAdPriceDiffPct", cfg.minAdPriceDiffPct ?? 0.1);
    setField("botCycleInterval", cfg.cycleInterval ?? 10);
    var chatCb = document.getElementById("botChatBotEnabled");
    if(chatCb) chatCb.checked = !!cfg.chatBotEnabled;
    setField("botExOperatorWhatsapp", cfg.operatorWhatsapp || "");
    // Show/hide strategy-specific fields
    var g = document.getElementById("botExchangeConfigGrid");
    if(g){
      var t = g.querySelector("#botExTop1DiffLabel");
      var s = g.querySelector("#botExSpreadPctLabel");
      if(t) t.style.display = (cfg.strategy || "top1") === "spread" ? "none" : "";
      if(s) s.style.display = (cfg.strategy || "top1") === "top1" ? "none" : "";
    }
  }

  function updateBotConfig(config){
    if(!config) return;
  }

  function getActiveCapacityBuyPrice(){
    const cache = window.__p2pCapacityCache;
    if(cache && Array.isArray(cache)){
      const sorted = cache.slice().sort(function(a,b){
        return new Date(a.createdAt || a.date || 0).getTime() - new Date(b.createdAt || b.date || 0).getTime();
      });
      const active = sorted.find(c => c.buyPrice && c.status !== "finished" && c.status !== "_capital");
      if(active?.buyPrice) return Number(active.buyPrice);
    }
    return null;
  }

  function findActiveCapacityFrom(arr){
    if(!Array.isArray(arr) || arr.length === 0) return null;
    var sorted = arr.slice().sort(function(a,b){
      return new Date(a.createdAt || a.date || 0).getTime() - new Date(b.createdAt || b.date || 0).getTime();
    });
    return sorted.find(function(c){ return c.buyPrice && c.status !== "finished" && c.status !== "_capital"; }) || null;
  }

  function renderBotLogs(logs){
    const container = document.getElementById("botLogContainer");
    if(!container) return;
    if(!logs || !logs.length){
      container.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px 0;">Sin actividad registrada</div>';
      return;
    }
    container.innerHTML = logs.map(l => `
      <div class="bot-log-entry ${l.level}">
        <span class="bot-log-time">${new Date(l.createdAt).toLocaleString("es-CL",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>
        ${l.exchange ? `<span class="bot-log-exchange">${l.exchange.toUpperCase()}</span>` : ""}
        <span class="bot-log-msg">${l.message}</span>
      </div>
    `).join("");
  }

  function renderBotOrders(orders){
    const container = document.getElementById("botOrdersContainer");
    if(!container) return;
    if(!orders || !orders.length){
      container.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px 0;">Sin ordenes registradas</div>';
      return;
    }
    const recent = orders.slice(0, 8);
    container.innerHTML = recent.map(o => {
      const color = o.status === "completed" ? "#34d399" : o.status === "pending" ? "#fbbf24" : "#ef4444";
      const label = o.status === "completed" ? "Completada" : o.status === "pending" ? "En curso" : "Cancelada";
      const isSell = o.tradeType === "SELL";
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 8px;border-bottom:1px solid rgba(148,163,184,.04);font-size:11px;">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">
          <span style="color:${isSell ? "#ef4444" : "#34d399"};font-weight:700;">${isSell ? "S" : "B"}</span>
          <span style="color:#e2e8f0;font-weight:600;">${fmt(o.amount)}</span>
          <span style="color:#64748b;">@</span>
          <span style="color:#cbd5e1;">${fmt(o.unitPrice)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span style="color:${color};font-size:10px;background:${color}1a;padding:1px 6px;border-radius:4px;">${label}</span>
          <span style="color:#64748b;font-size:10px;">${o.counterparty ? escHtml(o.counterparty) : ""}</span>
        </div>
      </div>`;
    }).join("");
  }

  window.botSaveExchangeConfig = async function(){
    const ex = botSelectedExchange;
    const strategy = document.getElementById("botExStrategy").value;
    const top1Diff = parseFloat(document.getElementById("botExTop1Diff").value) || 0.1;
    const spreadPct = parseFloat(document.getElementById("botExSpreadPct").value) || 0.5;
    const priceSource = document.getElementById("botExPriceSource").value;
    const priceFloorPct = parseFloat(document.getElementById("botExPriceFloorPct").value) || 0;
    const commissionPct = parseFloat(document.getElementById("botExCommissionPct").value) || 0;
    const safeMarginPct = parseFloat(document.getElementById("botExSafeMarginPct").value) || 0;
    const minV = document.getElementById("botExMinCompetitorCapital").value;
    const minCompetitorCapital = minV ? parseFloat(minV) : null;
    const competePayType = document.getElementById("botExCompetePayType").value;
    const competePayTypes = competePayType === "all" ? null : ["__match_ad__"];
    const circuitBreakPct = parseFloat(document.getElementById("botCircuitBreakPct").value) || 3;
    const cycleInterval = Math.round(parseFloat(document.getElementById("botCycleInterval").value)) || 10;
    const minAdPriceDiffPct = parseFloat(document.getElementById("botMinAdPriceDiffPct").value) || 0.1;
    const chatBotEnabled = document.getElementById("botChatBotEnabled").checked;
    const operatorWhatsappInp = document.getElementById("botExOperatorWhatsapp");
    const operatorWhatsapp = operatorWhatsappInp ? operatorWhatsappInp.value.trim().replace(/[^0-9]/g,'') : undefined;

    var _r = Math.random().toString(36).slice(2);
    await fetch("/api/p2p/bot/exchange-config?_=" + _r, {
      method:"PUT",
      credentials:"include",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ exchange: ex, label: botActiveLabel || "ONZE", strategy, top1Diff, spreadPct, priceSource, priceFloorPct, commissionPct, safeMarginPct, minCompetitorCapital, competePayTypes, circuitBreakPct, minAdPriceDiffPct, cycleInterval, chatBotEnabled, operatorWhatsapp })
    });
    var cb = document.getElementById("botChatBotEnabled");
    if(cb) cb.checked = chatBotEnabled;
    botUpdateBuyPrice();
    window.botRefreshExchange(true);
    // Start/stop chat-only cycle based on toggle
    var cycleEntry = getBotCycleEntry(botActiveLabel || "ONZE");
    if(chatBotEnabled && !cycleEntry.timer && !cycleEntry.chatTimer){
      botStartChatCycle();
    }else if(!chatBotEnabled && cycleEntry.chatTimer){
      clearTimeout(cycleEntry.chatTimer);
      cycleEntry.chatTimer = null;
      cycleEntry.chatActive = false;
    }
  };

  async function loadCredentials(exchange){
    const fields = document.getElementById("botCredFields");
    const status = document.getElementById("botCredStatus");
    if(!fields) return;

    if(exchange === "binance"){
      fields.innerHTML = `
        <form id="cred-form-binance" autocomplete="off">
        <label>API Key <input id="botCredApiKey" type="text" autocomplete="off" style="-webkit-text-security:disc" placeholder="Binance API Key" form="cred-form-binance"></label>
        <label>Secret Key <input id="botCredSecret" type="text" autocomplete="off" style="-webkit-text-security:disc" placeholder="Binance Secret Key" form="cred-form-binance"></label>
        <button class="btn" type="button" style="margin-bottom:4px;" onclick="window.botSaveCredentials()">Guardar</button>
        </form>
      `;
      try{
        const r = await fetch("/api/binance/credentials?label=" + encodeURIComponent(botActiveLabel || "ONZE"), { credentials:"include" });
        const d = await r.json();
        if(d?.ok && d?.credentials){
          document.getElementById("botCredApiKey").placeholder = "Ya configurada (" + (d.credentials.apiKeyMasked || "") + ") -- escribe para reemplazarla";
          document.getElementById("botCredSecret").placeholder = "Ya configurada (" + (d.credentials.secretKeyMasked || "") + ") -- escribe para reemplazarla";
          status.innerHTML = d.credentials.testStatus === "success"
            ? '<span style="color:#34d399;">Conectado</span>'
            : d.credentials.testStatus === "failed"
              ? '<span style="color:#fb7185;">Error</span>'
              : '<span style="color:#94a3b8;">Sin probar</span>';
        }else status.innerHTML = '<span style="color:#94a3b8;">No configurado</span>';
      }catch(e){ status.innerHTML = '<span style="color:#94a3b8;">Sin configurar</span>'; }
    }else if(exchange === "bybit"){
      fields.innerHTML = `
        <form id="cred-form-bybit" autocomplete="off">
        <label>API Key <input id="botCredApiKey" type="text" autocomplete="off" style="-webkit-text-security:disc" placeholder="Bybit API Key" form="cred-form-bybit"></label>
        <label>Secret Key <input id="botCredSecret" type="text" autocomplete="off" style="-webkit-text-security:disc" placeholder="Bybit Secret Key" form="cred-form-bybit"></label>
        <button class="btn" type="button" style="margin-bottom:4px;" onclick="window.botSaveCredentials()">Guardar</button>
        </form>
      `;
      try{
        const r = await fetch("/api/p2p/bot/bybit-credentials?label=ONZE", { credentials:"include" });
        const d = await r.json();
        if(d?.ok && d?.credentials){
          document.getElementById("botCredApiKey").placeholder = "Ya configurada (" + (d.credentials.apiKeyMasked || "") + ") -- escribe para reemplazarla";
          document.getElementById("botCredSecret").placeholder = "Ya configurada (" + (d.credentials.secretKeyMasked || "") + ") -- escribe para reemplazarla";
          status.innerHTML = d.credentials.testStatus === "success"
            ? '<span style="color:#34d399;">Conectado</span>'
            : d.credentials.testStatus === "failed"
              ? '<span style="color:#fb7185;">Error</span>'
              : '<span style="color:#94a3b8;">Sin probar</span>';
        }else status.innerHTML = '<span style="color:#94a3b8;">No configurado</span>';
      }catch(e){ status.innerHTML = '<span style="color:#94a3b8;">Sin configurar</span>'; }
    }else if(exchange === "okx"){
      fields.innerHTML = `
        <form id="cred-form-okx" autocomplete="off">
        <label>API Key <input id="botCredApiKey" type="text" autocomplete="off" style="-webkit-text-security:disc" placeholder="OKX API Key" form="cred-form-okx"></label>
        <label>Secret Key <input id="botCredSecret" type="text" autocomplete="off" style="-webkit-text-security:disc" placeholder="OKX Secret Key" form="cred-form-okx"></label>
        <label>Passphrase <input id="botCredPassphrase" type="text" autocomplete="off" style="-webkit-text-security:disc" placeholder="OKX Passphrase" form="cred-form-okx"></label>
        <button class="btn" type="button" style="margin-bottom:4px;" onclick="window.botSaveCredentials()">Guardar</button>
        </form>
      `;
      try{
        const r = await fetch("/api/p2p/bot/okx-credentials?label=ONZE", { credentials:"include" });
        const d = await r.json();
        if(d?.ok && d?.credentials){
          document.getElementById("botCredApiKey").placeholder = "Ya configurada (" + (d.credentials.apiKeyMasked || "") + ") -- escribe para reemplazarla";
          document.getElementById("botCredSecret").placeholder = "Ya configurada (" + (d.credentials.secretKeyMasked || "") + ") -- escribe para reemplazarla";
          document.getElementById("botCredPassphrase").placeholder = "Ya configurada (" + (d.credentials.passphraseMasked || "") + ") -- escribe para reemplazarla";
          status.innerHTML = d.credentials.testStatus === "success"
            ? '<span style="color:#34d399;">Conectado</span>'
            : d.credentials.testStatus === "failed"
              ? '<span style="color:#fb7185;">Error</span>'
              : '<span style="color:#94a3b8;">Sin probar</span>';
        }else status.innerHTML = '<span style="color:#94a3b8;">No configurado</span>';
      }catch(e){ status.innerHTML = '<span style="color:#94a3b8;">Sin configurar</span>'; }
    }
  }

  window.botSaveCredentials = async function(){
    const ex = botSelectedExchange;
    const apiKey = document.getElementById("botCredApiKey").value.trim();
    const secretKey = document.getElementById("botCredSecret").value.trim();
    if(!apiKey || !secretKey){
      document.getElementById("botCredStatus").innerHTML = '<span style="color:#fb7185;">Completa los campos requeridos</span>';
      return;
    }

    // ONZE/ZINPLE es un concepto exclusivo de Binance -- Bybit y OKX siempre
    // usan una sola cuenta fija, sin depender de que sesion tengas
    // seleccionada en Binance (antes esto causaba que las credenciales
    // parecieran "borrarse": se guardaban con una sesion y se leian con otra).
    let url, body;
    if(ex === "binance"){
      const lbl = botActiveLabel || "ONZE";
      url = "/api/binance/credentials";
      body = { apiKey, secretKey, test: true, label: lbl };
    }else if(ex === "bybit"){
      url = "/api/p2p/bot/bybit-credentials";
      body = { apiKey, secretKey, test: true, label: "ONZE" };
    }else if(ex === "okx"){
      const passphrase = document.getElementById("botCredPassphrase")?.value.trim();
      url = "/api/p2p/bot/okx-credentials";
      body = { apiKey, secretKey, passphrase, test: true, label: "ONZE" };
    }

    const res = await fetch(url, {
      method:"POST", credentials:"include",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const ok = data?.ok || data?.testResult?.ok;
    if(ok) document.getElementById("botCredStatus").innerHTML = '<span style="color:#34d399;">Conectado correctamente</span>';
    else document.getElementById("botCredStatus").innerHTML = '<span style="color:#fb7185;">Error al conectar</span>';
  };

  async function botUpdateBuyPrice(){
    const card = document.getElementById("botBuyPriceCard");
    const label = document.getElementById("botBuyPriceLabel");
    const value = document.getElementById("botBuyPriceValue");
    const provider = document.getElementById("botBuyPriceProvider");
    if(!card || !label || !value || !provider) return;

    // Read from exchange-level fields (defaults)
    const sourceEl = document.getElementById("botExPriceSource");
    if(!sourceEl){
      card.style.display = "none";
      return;
    }

    let basePrice = null;
    let priceSource = "";
    const sourceVal = sourceEl.value;

    if(sourceVal === "manual"){
      const inp = document.getElementById("botExPriceFloorPct");
      const manualPrice = inp ? parseFloat(inp.value) : null;
      if(manualPrice !== null && !isNaN(manualPrice)){
        basePrice = manualPrice;
        priceSource = "Manual";
      }
    }

    if(basePrice === null){
      // Capacity mode
      let cache = window.__p2pCapacityCache;
      if(!cache || !Array.isArray(cache) || cache.length === 0){
        try {
          const res = await fetch('/api/p2p/capacity', { credentials: 'include' });
          const data = await res.json();
          if(data?.ok && Array.isArray(data.items)){
            cache = data.items;
          }
        } catch(e) {}
      }
      if(cache && Array.isArray(cache)){
        const active = findActiveCapacityFrom(cache);
        if(active?.buyPrice){
          basePrice = Number(active.buyPrice);
          priceSource = active.provider || active.country || "Capacity";
          // Show capacity price in the input field for reference
          const floorInput = document.getElementById("botExPriceFloorPct");
          if(floorInput) floorInput.value = basePrice.toFixed(2);
        }
      }
    }

    if(basePrice !== null && !isNaN(basePrice)){
      card.style.display = "inline-flex";
      const exchange = botSelectedExchange || "binance";
      if(exchange === "binance"){
        const commissionPct = parseFloat(document.getElementById("botExCommissionPct")?.value || "0.14");
        const realCost = basePrice * (1 + commissionPct / 100);
        label.textContent = "COSTO REAL (con comisi\u00F3n)";
        value.textContent = realCost.toFixed(2);
        provider.textContent = priceSource ? `${priceSource} + ${commissionPct}% comisi\u00F3n` : '';
      }else{
        label.textContent = "PRECIO MINIMO VENTA";
        value.textContent = basePrice.toFixed(2);
        provider.textContent = priceSource;
      }
    }else{
      card.style.display = "none";
    }

    // Refresh all per-ad cost badges
    document.querySelectorAll('[id^="botCostBadge_"]').forEach(function(el){
      var rid = el.id.replace('botCostBadge_', '');
      if(rid) window.botUpdateAdCostBadge(rid);
    });
  }
  window.botUpdateBuyPrice = botUpdateBuyPrice;

  window.botOpenPanel = function(){
    const modal = document.getElementById("botPanelModal");
    if(!modal) return;
    modal.style.display = "block";
    document.getElementById("botPanelExchangeLabel").textContent = botSelectedExchange.charAt(0).toUpperCase() + botSelectedExchange.slice(1);
    botSwitchPanelTab('orders');
    loadPanelAds();
    loadPanelAccounts();
  };

  window.botClosePanel = function(){
    window.botStopMercadoRefresh();
    if(botPanelSimpleEditMode){
      var sub = document.querySelector(".bot-panel-sub");
      if(sub) sub.style.display = "";
      var modalHead = document.querySelector("#botPanelModal .modal-head");
      if(modalHead) modalHead.style.display = "";
      document.getElementById("botPanelExchangeLabel").textContent = botSelectedExchange.charAt(0).toUpperCase() + botSelectedExchange.slice(1);
      var adsList = document.getElementById("botPanelAdsList");
      if(adsList) adsList.style.display = "";
      window.botSwitchPanelTab('orders');
      document.getElementById("botPanelAdForm").style.display = "none";
      botPanelSimpleEditMode = false;
    }
    const modal = document.getElementById("botPanelModal");
    if(modal) modal.style.display = "none";
  };

  window.botSwitchPanelTab = function(tab){
    document.querySelectorAll(".bot-panel-tab").forEach(t => t.classList.toggle("active", t.dataset.paneltab === tab));
    document.querySelectorAll(".bot-panel-tab-content").forEach(c => c.style.display = "none");
    const map = { orders:"botPanelOrders", ads:"botPanelAds", accounts:"botPanelAccounts", mercado:"botPanelMercado", security:"botPanelSecurity", skipo:"botPanelSkipo" };
    const el = document.getElementById(map[tab]);
    if(el) el.style.display = "";
    if(tab === "orders"){ loadPanelOrders(); window.botStopMercadoRefresh(); }
    else if(tab === "ads"){ loadPanelAds(); window.botStopMercadoRefresh(); }
    else if(tab === "accounts"){ loadPanelAccounts(); window.botStopMercadoRefresh(); }
    else if(tab === "mercado"){ loadPanelMercado(); window.botStartMercadoRefresh(); }
    else if(tab === "security"){ window.botLoadPanelSecurity(); window.botStopMercadoRefresh(); }
    else if(tab === "skipo"){ window.botStopMercadoRefresh(); window.skipoStartRefresh(); }
    if(tab !== "skipo") window.skipoStopRefresh();
  };

  let botOrdersMainTab = "active";
  let botOrdersFilter = "unpaid";
  let botOrdersSearchQuery = "";

  window.botSwitchOrdersTab = function(tab){
    botOrdersMainTab = tab;
    botOrdersFilter = tab === "active" ? "unpaid" : "all";
    // Reset search visibility
    document.getElementById("botOrdersSearchBox").style.display = "none";
    document.getElementById("botOrdersSearchInput").value = "";
    document.getElementById("botOrdersFilterDropdown").style.display = "none";
    botOrdersSearchQuery = "";
    document.querySelectorAll(".bot-orders-main-tab").forEach(t => t.classList.toggle("active", t.dataset.ordersTab === tab));
    document.getElementById("botOrdersActiveFilters").style.display = tab === "active" ? "" : "none";
    document.getElementById("botOrdersHistoryFilters").style.display = tab === "history" ? "" : "none";
    document.getElementById("botOrdersHistoryIcons").style.display = tab === "history" ? "flex" : "none";
    // Show filter pills by default for history
    if(tab === "history"){
      document.getElementById("botOrdersFilterPills").style.display = "";
    }
    document.querySelectorAll("#botOrdersActiveFilters .bot-orders-filter, #botOrdersHistoryFilters .bot-orders-filter").forEach(b => b.classList.remove("active"));
    const defaultFilter = tab === "active" ? "unpaid" : "all";
    document.querySelector(`.bot-orders-filter[data-filter="${defaultFilter}"]`)?.classList.add("active");
    botApplyOrdersFilters();
  };

  window.botToggleOrdersSearch = function(){
    const box = document.getElementById("botOrdersSearchBox");
    const input = document.getElementById("botOrdersSearchInput");
    const isVisible = box.style.display !== "none";
    box.style.display = isVisible ? "none" : "";
    if(isVisible){
      input.value = "";
      botOrdersSearchQuery = "";
      botApplyOrdersFilters();
    } else {
      setTimeout(() => input.focus(), 50);
    }
  };

  window.botToggleOrdersFilters = function(){
    const dropdown = document.getElementById("botOrdersFilterDropdown");
    dropdown.style.display = dropdown.style.display === "none" ? "" : "none";
  };

  window.botToggleDateRange = function(){
    const val = document.getElementById("botFilterDateRange").value;
    document.getElementById("botFilterDateCustom").style.display = val === "custom" ? "grid" : "none";
    botApplyOrdersFilters();
  };

  window.botResetOrdersFilters = function(){
    document.getElementById("botFilterType").value = "all";
    document.getElementById("botFilterFiat").value = "all";
    document.getElementById("botFilterCoin").value = "all";
    document.getElementById("botFilterDateRange").value = "all";
    document.getElementById("botFilterDateCustom").style.display = "none";
    document.getElementById("botFilterDateFrom").value = "";
    document.getElementById("botFilterDateTo").value = "";
    botApplyOrdersFilters();
  };

  window.botPopulateFilterDropdowns = function(){
    const orders = window.botPanelOrdersData || [];
    const fiats = [...new Set(orders.map(o => o.fiat).filter(Boolean))].sort();
    const coins = [...new Set(orders.map(o => o.asset).filter(Boolean))].sort();
    const fiatSel = document.getElementById("botFilterFiat");
    const coinSel = document.getElementById("botFilterCoin");
    const currentFiat = fiatSel.value;
    const currentCoin = coinSel.value;
    fiatSel.innerHTML = '<option value="all">Todas</option>' + fiats.map(f => '<option value="' + f + '" ' + (f === currentFiat ? 'selected' : '') + '>' + f + '</option>').join("");
    coinSel.innerHTML = '<option value="all">Todas</option>' + coins.map(c => '<option value="' + c + '" ' + (c === currentCoin ? 'selected' : '') + '>' + c + '</option>').join("");
  };

  window.botSetOrdersFilter = function(filter){
    botOrdersFilter = filter;
    const parentId = botOrdersMainTab === "active" ? "botOrdersActiveFilters" : "botOrdersHistoryFilters";
    document.querySelectorAll(`#${parentId} .bot-orders-filter`).forEach(b => b.classList.remove("active"));
    document.querySelector(`#${parentId} .bot-orders-filter[data-filter="${filter}"]`)?.classList.add("active");
    botApplyOrdersFilters();
  };

  window.botApplyOrdersFilters = function(){
    botOrdersSearchQuery = (document.getElementById("botOrdersSearchInput")?.value || "").toLowerCase();
    applyOrdersDisplay();
  };

  function applyOrdersDisplay(){
    const container = document.getElementById("botPanelOrdersList");
    if(!container) return;
    const allOrders = window.botPanelOrdersData || [];
    let filtered;

    if(botOrdersMainTab === "active"){
      const activeStatuses = botOrdersFilter === "unpaid" ? ["pending"]
        : botOrdersFilter === "paid" ? ["paid"]
        : ["appealed"];
      filtered = allOrders.filter(o => activeStatuses.includes(o.status));
    } else {
      if(botOrdersFilter === "all"){
        filtered = allOrders.filter(o => o.status === "completed" || o.status === "cancelled" || o.status === "appealed");
      } else {
        filtered = allOrders.filter(o => o.status === botOrdersFilter);
      }

      // Advanced filters (only for Procesadas)
      const filterType = document.getElementById("botFilterType")?.value || "all";
      const filterFiat = document.getElementById("botFilterFiat")?.value || "all";
      const filterCoin = document.getElementById("botFilterCoin")?.value || "all";
      const filterDateRange = document.getElementById("botFilterDateRange")?.value || "all";
      const filterDateFrom = document.getElementById("botFilterDateFrom")?.value || "";
      const filterDateTo = document.getElementById("botFilterDateTo")?.value || "";

      if(filterType !== "all") filtered = filtered.filter(o => o.tradeType === filterType);
      if(filterFiat !== "all") filtered = filtered.filter(o => o.fiat === filterFiat);
      if(filterCoin !== "all") filtered = filtered.filter(o => o.asset === filterCoin);

      if(filterDateRange === "month" || filterDateRange === "quarter"){
        const cutoff = Date.now() - (filterDateRange === "month" ? 30 : 90) * 24 * 60 * 60 * 1000;
        filtered = filtered.filter(o => Number(o.createdAt || 0) >= cutoff);
      } else if(filterDateRange === "custom"){
        if(filterDateFrom){
          const from = new Date(filterDateFrom).getTime();
          filtered = filtered.filter(o => Number(o.createdAt || 0) >= from);
        }
        if(filterDateTo){
          const to = new Date(filterDateTo).getTime() + 86400000; // end of day
          filtered = filtered.filter(o => Number(o.createdAt || 0) <= to);
        }
      }
    }

    // Apply search
    if(botOrdersSearchQuery){
      filtered = filtered.filter(o =>
        o.orderNumber.toLowerCase().includes(botOrdersSearchQuery) ||
        (o.counterparty || "").toLowerCase().includes(botOrdersSearchQuery)
      );
    }

    // Sort by createdAt descending
    filtered.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    // Update filter counts -- bug real confirmado en vivo (sep 2026): esto
    // vivía DESPUÉS del "if(!filtered.length) return" de abajo, así que en
    // cuanto la pestaña actual se quedaba en 0 órdenes (ej. se liberó la
    // única pagada), la función cortaba antes de recontar y el número viejo
    // (ej. "1") quedaba pegado en el chip hasta recargar todo el panel.
    // Ahora se recalcula SIEMPRE, esté vacía o no la lista visible.
    const all = window.botPanelOrdersData || [];
    const pendingCount = all.filter(o => o.status === "pending").length;
    const paidCount = all.filter(o => o.status === "paid").length;
    const appealedCount = all.filter(o => o.status === "appealed").length;
    document.querySelectorAll('.bot-filter-count[data-filter="unpaid"]').forEach(el => el.textContent = pendingCount);
    document.querySelectorAll('.bot-filter-count[data-filter="paid"]').forEach(el => el.textContent = paidCount);
    document.querySelectorAll('.bot-filter-count[data-filter="appealed"]').forEach(el => el.textContent = appealedCount);

    // Numerito de "no pagadas" sobre el botón de Órdenes del chat acoplado
    // (pedido explícito del usuario, sep 2026) -- se apoya en el mismo
    // pendingCount de arriba para no duplicar la lógica de conteo.
    const ordersBadge = document.getElementById("botChatOrdersBadge");
    if(ordersBadge) ordersBadge.style.display = pendingCount > 0 ? "" : "none";

    if(!filtered.length){
      const emptyMsg = botOrdersMainTab === "active"
        ? (botOrdersFilter === "unpaid" ? "No hay ordenes sin pagar" : botOrdersFilter === "paid" ? "No hay ordenes pagadas" : "No hay apelaciones")
        : "No se encontraron ordenes";
      container.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px 0;">' + emptyMsg + '</div>';
      return;
    }

    container.innerHTML = filtered.map(orderCard).join("");
    updateOrderTimers();
  }

  function orderCard(o){
    const isSell = o.tradeType === "SELL";
    const isActive = o.status === "pending" || o.status === "paid" || o.status === "appealed";
    const statusColor = o.status === "completed" ? "#34d399" : o.status === "cancelled" ? "#ef4444" : o.status === "paid" ? "#60a5fa" : o.status === "appealed" ? "#f59e0b" : "#fbbf24";
    const statusBg = o.status === "completed" ? "rgba(52,211,153,.12)" : o.status === "cancelled" ? "rgba(239,68,68,.12)" : o.status === "paid" ? "rgba(96,165,250,.12)" : o.status === "appealed" ? "rgba(245,158,11,.15)" : "rgba(251,191,36,.12)";
    const statusLabel = o.status === "completed" ? "Completada" : o.status === "cancelled" ? "Cancelada" : o.status === "paid" ? "Pagado" : o.status === "appealed" ? "⚠️ Apelada" : "En curso";
    // Unread badge
    const lastReadStr = localStorage.getItem("botChatLastRead_" + o.orderNumber);
    const lastRead = lastReadStr ? Number(lastReadStr) : 0;
    const lastMsgAt = o.lastClientMsgAt ? new Date(o.lastClientMsgAt).getTime() : 0;
    const hasUnread = lastMsgAt > lastRead;
    const dateStr = o.createdAt ? new Date(Number(o.createdAt)).toLocaleDateString("es-CL", { day:"2-digit", month:"short", year:"numeric" }) : "";
    const timeStr = o.createdAt ? new Date(Number(o.createdAt)).toLocaleTimeString("es-CL", { hour:"2-digit", minute:"2-digit" }) : "";
    return `
    <div class="bot-order-card" style="background:rgba(15,23,42,.5);border-radius:10px;padding:0;margin-bottom:8px;border:1px solid ${o.status === "appealed" ? "rgba(245,158,11,.3)" : "rgba(148,163,184,.06)"};${o.status === "appealed" ? "border-left:3px solid #f59e0b;" : ""}overflow:hidden;">
      <!-- Row 1: Trade type + Status -->
      <div style="display:flex;align-items:center;padding:10px 12px 6px;">
        <span style="font-size:13px;font-weight:700;color:${isSell ? "#ef4444" : "#34d399"};">${isSell ? "↗ Venta" : "↙ Compra"}</span>
        <span style="margin-left:auto;font-size:10px;font-weight:700;color:${statusColor};background:${statusBg};padding:2px 8px;border-radius:4px;letter-spacing:.3px;">${statusLabel}</span>
      </div>
      <div style="padding:0 12px 8px;">
        <!-- Cantidad -->
        <div style="display:flex;align-items:center;padding:2px 0;font-size:12px;">
          <span style="color:#64748b;">Cantidad</span>
          <span style="margin-left:auto;color:#e2e8f0;font-weight:600;">$${window.fmtInt(o.totalPrice)} CLP</span>
        </div>
        <!-- Precio -->
        <div style="display:flex;align-items:center;padding:2px 0;font-size:12px;">
          <span style="color:#64748b;">Precio</span>
          <span style="margin-left:auto;color:#e2e8f0;font-weight:600;">$${window.fmt(o.unitPrice)}</span>
        </div>
        <!-- Cantidad total -->
        <div style="display:flex;align-items:center;padding:2px 0;font-size:12px;">
          <span style="color:#64748b;">Cantidad total</span>
          <span style="margin-left:auto;color:#e2e8f0;font-weight:600;">${window.fmt(o.amount)} ${o.asset || "USDT"}</span>
        </div>
        <!-- Orden -->
        <div style="display:flex;align-items:center;padding:2px 0;font-size:12px;">
          <span style="color:#64748b;">Orden</span>
          <span style="margin-left:auto;color:#94a3b8;font-family:monospace;font-size:11px;">${o.orderNumber.slice(-12)}</span>
        </div>
        <!-- Timer (debajo del número de orden) -->
        ${o.status === "pending" ? `<div style="display:flex;justify-content:flex-end;padding:2px 0 4px;">
          <span class="bot-order-timer" data-created="${Number(o.createdAt || 0)}" data-paytime="${Number(o.payTime || 15)}" style="font-size:11px;color:#fbbf24;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:0.5px;">⏳ --:--</span>
        </div>` : ""}
        ${o.status === "appealed" ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 0 0;font-size:11px;color:#f59e0b;">
          <span>⚠️ Esta orden fue apelada — revisa el chat para más detalles</span>
        </div>` : ""}
      </div>
      <!-- Footer: Chat + Date -->
      <div style="display:flex;align-items:center;padding:6px 12px;border-top:1px solid rgba(148,163,184,.04);background:rgba(0,0,0,.1);">
        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
          ${o.status !== "cancelled" ? `
          <button class="btn small ghost" type="button" style="font-size:10px;padding:3px 8px;display:inline-flex;align-items:center;gap:4px;position:relative;" onclick="window.botPanelOpenChat('${escHtml(o.orderNumber)}')">
            <svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            ${escHtml(o.counterparty || "Chat")}
            ${hasUnread ? '<span style="position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:#60a5fa;box-shadow:0 0 4px rgba(96,165,250,.6);"></span>' : ""}
          </button>` : ""}
          ${o.status === "pending" && botSelectedExchange === "binance" && !botIsOrderVerified(o.orderNumber, o.verified) ? `
          <button id="btn-verify-${escHtml(o.orderNumber)}" class="btn small" type="button" style="font-size:10px;padding:3px 8px;" onclick="window.botPanelVerifyOrder('${escHtml(o.orderNumber)}')">✓ Verificar</button>` : ""}
          ${o.status === "paid" ? `
          <button class="btn small danger" type="button" style="font-size:10px;padding:3px 8px;" onclick="window.botPanelReleaseOrder('${escHtml(o.orderNumber)}')">Liberar</button>` : ""}
        </div>
        <span style="margin-left:auto;font-size:10px;color:#64748b;">${dateStr} ${timeStr}</span>
      </div>
    </div>`;
  }

  async function loadPanelOrders(){
    const container = document.getElementById("botPanelOrdersList");
    if(!container) return;
    try{
      const r = await fetch("/api/p2p/bot/orders?limit=50&live=true&exchange=" + botSelectedExchange + "&label=" + encodeURIComponent(botActiveLabel || "ONZE"), { credentials:"include" });
      const d = await r.json();
      window.botPanelOrdersData = d?.ok && d?.orders ? d.orders : [];
      window.botPopulateFilterDropdowns();
      applyOrdersDisplay();
      updateOrderTimers();
    }catch(e){ console.warn("Orders load error:", e); }
  }

  // ─── Real-time polling & timers ───────────────────────────────

  let botOrdersPollInterval = null;
  let botOrdersTimerInterval = null;
  let botSoundEnabled = localStorage.getItem("botSoundEnabled") !== "false"; // Default ON

  function botIsOrderVerified(orderNumber, apiVerified){
    if(apiVerified) return true;
    try{
      const verified = JSON.parse(localStorage.getItem("botVerifiedOrders") || "[]");
      return verified.includes(orderNumber);
    }catch(e){ return false; }
  }

  function botVerifyOrderSave(orderNumber){
    try{
      const verified = JSON.parse(localStorage.getItem("botVerifiedOrders") || "[]");
      if(!verified.includes(orderNumber)){
        verified.push(orderNumber);
        localStorage.setItem("botVerifiedOrders", JSON.stringify(verified));
      }
    }catch(e){}
  }
  let botLastOrderIds = new Set();
  let botAudioContext = null;

  function botInitSound(){
    const btn = document.getElementById("botSoundToggle");
    const icon = document.getElementById("botSoundIcon");
    if(!btn) return;
    if(botSoundEnabled){
      btn.style.color = "#34d399";
      icon.innerHTML = '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';
    } else {
      btn.style.color = "#ef4444";
      icon.innerHTML = '<path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
    }
  }

  window.botToggleSound = function(){
    botSoundEnabled = !botSoundEnabled;
    localStorage.setItem("botSoundEnabled", botSoundEnabled);
    botInitSound();
    if(botSoundEnabled && botAudioContext){
      botAudioContext.resume();
    }
  };

  // Pedido explícito del usuario (sep 2026): el beep de 3 notas (sine,
  // 880-1100-880Hz) no le gustaba, quería algo más parecido a la
  // notificación de WhatsApp -- dos notas cortas tipo "campanita" (onda
  // triangular, más suave que sine puro), cada una con su propio
  // oscilador/ganancia para un decaimiento limpio por nota. Extraído a un
  // helper (botPlayTone) para poder reusarlo con otro sonido distinto
  // cuando una orden pasa a "pagado" (pedido explícito, sep 2026).
  function botPlayTone(notes){
    if(!botSoundEnabled) return;
    try{
      if(!botAudioContext){
        botAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = botAudioContext;
      for(const note of notes){
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "triangle";
        const t0 = ctx.currentTime + note.start;
        osc.frequency.setValueAtTime(note.freq, t0);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(note.gain, t0 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.duration);
        osc.start(t0);
        osc.stop(t0 + note.duration + 0.02);
      }
    }catch(e){ console.warn("Sound error:", e); }
  }

  function botPlayOrderSound(){
    // Dos notas ASCENDENTES (E6 -> A6) para "llegó una orden nueva".
    botPlayTone([
      { freq: 1318.5, start: 0, duration: 0.16, gain: 0.28 },
      { freq: 1760, start: 0.13, duration: 0.22, gain: 0.24 },
    ]);
  }

  function botPlayPaidSound(){
    // Dos notas DESCENDENTES, más graves (B5 -> E5), tipo "confirmación" --
    // a propósito muy distinto al de "orden nueva" (que sube de tono) para
    // poder diferenciarlos de oído sin mirar la pantalla.
    botPlayTone([
      { freq: 987.8, start: 0, duration: 0.18, gain: 0.28 },
      { freq: 659.3, start: 0.15, duration: 0.28, gain: 0.26 },
    ]);
  }

  let botLastOrderStatuses = {};
  function botCheckNewOrders(newOrders){
    const currentIds = new Set(newOrders.map(o => o.orderNumber));
    const hadPreviousData = botLastOrderIds.size > 0;
    const newOnes = newOrders.filter(o => !botLastOrderIds.has(o.orderNumber));
    if(newOnes.length > 0 && hadPreviousData){
      botPlayOrderSound();
    }
    // Sonido distinto cuando una orden que YA conocíamos pasa a "pagado"
    // (pedido explícito del usuario, sep 2026) -- para diferenciarlo de la
    // alarma de "orden nueva".
    if(hadPreviousData){
      for(const o of newOrders){
        const prevStatus = botLastOrderStatuses[o.orderNumber];
        if(prevStatus && prevStatus !== "paid" && o.status === "paid"){
          botPlayPaidSound();
          break; // un solo sonido aunque varias pasen a pagado en el mismo ciclo
        }
      }
    }
    botLastOrderIds = currentIds;
    const nextStatuses = {};
    for(const o of newOrders) nextStatuses[o.orderNumber] = o.status;
    botLastOrderStatuses = nextStatuses;
  }

  function botCreateChatOverlay(){
    if(document.getElementById("botOrderChatOverlay")) return;
    const div = document.createElement("div");
    div.id = "botOrderChatOverlay";
    div.style.cssText = "display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(2,6,23,.85);backdrop-filter:blur(8px);z-index:999999;border-radius:0;overflow:hidden;";
    div.innerHTML = '<div style="display:flex;flex-direction:column;height:100%;max-width:900px;margin:0 auto;">' +
      '<div style="display:flex;align-items:center;gap:8px;padding:12px 20px;background:linear-gradient(180deg,rgba(20,28,48,.97),rgba(13,19,35,.97));border-bottom:1px solid rgba(148,163,184,.1);box-shadow:0 1px 0 rgba(255,255,255,.02) inset;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:center;gap:6px;">' +
            '<div style="font-size:15px;font-weight:700;color:#f1f5f9;" id="botOrderChatCounterparty">—</div>' +
            '<button id="botChatListToggleBtn" type="button" onclick="window.botToggleChatList()" title="Ver lista de chats" style="display:none;background:none;border:none;color:#94a3b8;cursor:pointer;padding:2px;width:22px;height:22px;align-items:center;justify-content:center;flex-shrink:0;">' +
              '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>' +
            '</button>' +
          '</div>' +
          '<div style="font-size:11px;color:#c3cee0;" id="botOrderChatOrderInfo">#0000000000</div>' +
          '<div style="font-size:12px;color:#5eead4;font-weight:600;margin-top:2px;display:none;" id="botOrderChatBuyerName"></div>' +
        '</div>' +
        '<button id="botOrderChatReleaseBtn" type="button" onclick="window.botPanelReleaseCurrentChatOrder()" style="display:none;background:#fcd535;border:none;color:#1e2329;font-weight:700;font-size:13px;padding:8px 14px;border-radius:8px;cursor:pointer;white-space:nowrap;">Liberar</button>' +
        '<button id="botChatOrdersToggleBtn" type="button" onclick="window.botToggleOrdersPanel()" title="Ver órdenes" style="display:none;position:relative;background:none;border:none;color:#94a3b8;cursor:pointer;padding:4px;width:32px;height:32px;align-items:center;justify-content:center;">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="7" y1="14" x2="13" y2="14"/></svg>' +
          '<span id="botChatOrdersBadge" class="bot-filter-count" data-filter="unpaid" style="display:none;position:absolute;top:1px;right:1px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:#ef4444;color:#fff;font-size:9px;font-weight:700;line-height:15px;text-align:center;">0</span>' +
        '</button>' +
        '<button id="botChatCollapseBtn" type="button" onclick="window.botToggleChatCollapse()" title="Ocultar el chat sin cerrarlo (sigue abierto, puedes seguir trabajando en el resto del panel)" style="display:none;background:none;border:none;color:#94a3b8;cursor:pointer;padding:4px;width:32px;height:32px;align-items:center;justify-content:center;">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>' +
        '</button>' +
        '<button class="close-btn" type="button" onclick="window.botPanelCloseChat()" style="font-size:22px;width:36px;height:36px;">&times;</button>' +
        '<button type="button" onclick="window.botCallOperator()" title="Avisar por WhatsApp al dueño de la cuenta" style="background:none;border:none;color:#34d399;cursor:pointer;font-size:16px;padding:4px;">📞</button>' +
      '</div>' +
      '<div id="botOrderChatMessages" class="bot-chat-canvas" style="flex:1;overflow-y:auto;padding:16px 20px;">' +
        '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px 0;">No hay mensajes previos. El chat se habilitará al conectarse con el exchange.</div>' +
      '</div>' +
      '<div style="display:flex;align-items:flex-end;gap:10px;padding:12px 20px;background:linear-gradient(0deg,rgba(20,28,48,.97),rgba(13,19,35,.97));border-top:1px solid rgba(148,163,184,.1);">' +
        '<textarea id="botOrderChatInput" rows="1" placeholder="Escribe un mensaje..." onkeydown="if(event.key===\'Enter\' && !event.shiftKey){event.preventDefault();window.botPanelSendChatMessage();}" oninput="this.style.height=\'auto\';this.style.height=Math.min(this.scrollHeight,120)+\'px\';" style="flex:1;padding:10px 14px;border-radius:20px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.5);color:#f8fafc;font-size:14px;font-family:inherit;outline:none;resize:none;overflow-y:auto;min-height:0;max-height:120px;height:42px;line-height:1.4;"></textarea>' +
        '<button class="btn" type="button" onclick="window.botPanelSendChatMessage()" style="border-radius:20px;padding:10px 18px;box-shadow:0 2px 10px rgba(37,99,235,.35);">Enviar</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(div);

    // Pestaña flotante para reabrir el chat acoplado cuando está oculto
    // (solo aplica en escritorio, ver CSS de #botChatReopenTab) -- clic
    // vuelve a mostrarlo sin perder nada (mensajes, polling, todo sigue
    // corriendo mientras estaba oculto).
    if(!document.getElementById("botChatReopenTab")){
      const tab = document.createElement("div");
      tab.id = "botChatReopenTab";
      tab.onclick = function(){ window.botToggleChatCollapse(); };
      tab.innerHTML = '💬 <span id="botChatReopenTabName">Chat</span>';
      document.body.appendChild(tab);
    }

    // Lista de chats desplegable a la izquierda del chat acoplado (pedido
    // explícito del usuario, sep 2026) -- para cambiar de conversación sin
    // cerrar la que está abierta. Solo tiene efecto real en escritorio, ver
    // CSS de #botChatListPanel.
    if(!document.getElementById("botChatListPanel")){
      const panel = document.createElement("div");
      panel.id = "botChatListPanel";
      panel.innerHTML =
        '<div id="botChatListHeader"><h3>Chats</h3><button type="button" onclick="window.botToggleChatList(false)" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;line-height:1;padding:2px 6px;">&times;</button></div>' +
        '<div id="botChatListItems"></div>';
      document.body.appendChild(panel);
    }

    // Panel de "Órdenes" desplegable a la izquierda del chat acoplado
    // (pedido explícito del usuario, sep 2026) -- reusa la pestaña
    // "Ordenes" COMPLETA del panel P2P (filtros, Liberar, etc.) moviendo
    // ese mismo nodo del DOM hacia acá, en vez de duplicar su HTML/JS.
    if(!document.getElementById("botChatOrdersPanel")){
      const panel = document.createElement("div");
      panel.id = "botChatOrdersPanel";
      panel.innerHTML =
        '<div id="botChatOrdersPanelHeader"><h3>Órdenes</h3><button type="button" onclick="window.botToggleOrdersPanel(false)" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;line-height:1;padding:2px 6px;">&times;</button></div>' +
        '<div id="botChatOrdersPanelBody"></div>';
      document.body.appendChild(panel);
    }
  }

  // Oculta/muestra el chat SIN cerrarlo -- pedido explícito del usuario
  // (sep 2026): poder seguir cambiando precio u otra cosa del panel
  // mientras el chat sigue abierto con alguien, en vez de tener que
  // cerrarlo del todo. Solo tiene efecto visual en escritorio (>700px,
  // ver CSS) -- en móvil el chat sigue siendo pantalla completa, no hay
  // nada que acoplar al costado.
  window.botToggleChatCollapse = function(){
    const overlay = document.getElementById("botOrderChatOverlay");
    const tab = document.getElementById("botChatReopenTab");
    if(!overlay) return;
    const collapsed = overlay.classList.toggle("bot-chat-collapsed");
    if(tab){
      tab.classList.toggle("show", collapsed);
      const nameEl = document.getElementById("botChatReopenTabName");
      const counterparty = document.getElementById("botOrderChatCounterparty")?.textContent;
      if(nameEl) nameEl.textContent = counterparty && counterparty !== "—" ? counterparty : "Chat";
    }
    // Si se oculta el chat, no tiene sentido dejar la lista de chats abierta
    // sola al lado -- se cierra junto con él.
    if(collapsed) window.botToggleChatList(false);
  };

  // Lista de chats a la izquierda del chat acoplado -- pedido explícito del
  // usuario (sep 2026): poder cambiar de conversación sin cerrar el chat
  // actual. force=true/false abre/cierra explícito; sin argumento alterna.
  window.botToggleChatList = function(force){
    const panel = document.getElementById("botChatListPanel");
    if(!panel) return;
    const show = force !== undefined ? force : !panel.classList.contains("show");
    panel.classList.toggle("show", show);
    if(show){
      window.botToggleOrdersPanel(false); // los dos paneles no se muestran a la vez
      botRenderChatListItems();
    }
  };

  // Panel de "Órdenes" a la izquierda del chat acoplado -- pedido explícito
  // del usuario (sep 2026), respondió "igual a la pestaña completa" cuando
  // se le preguntó el alcance. En vez de duplicar todo el HTML/JS de la
  // pestaña "Ordenes" (filtros, sub-tabs, Liberar, etc.), se MUEVE ese mismo
  // nodo del DOM (#botPanelOrders) hacia este panel mientras está abierto,
  // y se devuelve a su lugar original dentro del modal al cerrarlo -- así
  // todo el código existente (botSetOrdersFilter, orderCard, etc.), que
  // busca sus elementos por id, sigue funcionando sin tocarlo.
  window.botToggleOrdersPanel = function(force){
    const panel = document.getElementById("botChatOrdersPanel");
    const body = document.getElementById("botChatOrdersPanelBody");
    const ordersTab = document.getElementById("botPanelOrders");
    if(!panel || !body || !ordersTab) return;
    const show = force !== undefined ? force : !panel.classList.contains("show");
    if(show === panel.classList.contains("show")) return;
    panel.classList.toggle("show", show);
    if(show){
      window.botToggleChatList(false); // los dos paneles no se muestran a la vez
      if(!document.getElementById("botPanelOrdersAnchor")){
        const anchor = document.createElement("div");
        anchor.id = "botPanelOrdersAnchor";
        anchor.style.display = "none";
        ordersTab.parentNode.insertBefore(anchor, ordersTab);
      }
      ordersTab.style.display = "";
      body.appendChild(ordersTab);
      loadPanelOrders();
      botStartOrdersPolling();
    } else {
      const anchor = document.getElementById("botPanelOrdersAnchor");
      if(anchor) anchor.parentNode.insertBefore(ordersTab, anchor);
      // Si el modal P2P sigue con la pestaña "Ordenes" activa, se deja tal
      // cual (visible ahí, siguiendo cargando) -- solo se oculta/detiene el
      // polling si nadie más la está mirando.
      const modalOnOrdersTab = document.querySelector('.bot-panel-tab[data-paneltab="orders"]')?.classList.contains("active");
      if(!modalOnOrdersTab){
        ordersTab.style.display = "none";
        botStopOrdersPolling();
      }
    }
  };

  // Caché de nombres reales por orden (pedido explícito del usuario, sep
  // 2026) -- una vez consultado a Binance/Bybit para una orden, se reusa
  // mientras dure la sesión del panel, para no volver a pedirlo cada vez
  // que se abre la lista.
  var botChatListNameCache = {};
  var botChatListRenderGen = 0;

  function botRenderChatListItems(){
    const container = document.getElementById("botChatListItems");
    if(!container) return;
    const orders = window.botPanelOrdersData || [];
    if(!orders.length){
      container.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px 16px;">Sin chats disponibles</div>';
      return;
    }
    const gen = ++botChatListRenderGen;
    container.innerHTML = orders.map(o => {
      const isActive = o.orderNumber === botPanelChatActiveOrder;
      const name = o.counterparty || "Sin nombre";
      const meta = (o.tradeType === "SELL" ? "Venta" : "Compra") + " " + window.fmt(o.amount) + " USDT" +
        (o.totalPrice ? ' = <span style="color:#fbbf24;font-weight:700;">$' + window.fmtInt(o.totalPrice) + ' CLP</span>' : "") +
        " · #" + escHtml(o.orderNumber?.slice(-10) || "");
      // Punto azul de "mensaje sin leer" -- misma lógica y estilo que ya
      // usa la tarjeta de la lista de órdenes (ver orderCard/hasUnread).
      const lastReadStr = localStorage.getItem("botChatLastRead_" + o.orderNumber);
      const lastRead = lastReadStr ? Number(lastReadStr) : 0;
      const lastMsgAt = o.lastClientMsgAt ? new Date(o.lastClientMsgAt).getTime() : 0;
      const hasUnread = lastMsgAt > lastRead;
      const cachedReal = botChatListNameCache[o.orderNumber];
      // Círculo con la inicial, donde iría la foto -- pedido explícito del
      // usuario (sep 2026), igual a como lo muestra Binance en su propia
      // lista de chats. Usa el nombre real si ya se cargó, si no la
      // primera letra del nombre enmascarado (casi siempre coincide).
      const avatarLetter = escHtml(((cachedReal || name || "?").trim().charAt(0) || "?").toUpperCase());
      return '<div class="bot-chat-list-item' + (isActive ? ' active' : '') + '" data-order="' + escHtml(o.orderNumber) + '" onclick="window.botPanelOpenChat(\'' + o.orderNumber + '\');window.botToggleChatList(false);">' +
        '<div class="bot-chat-avatar">' + avatarLetter +
          (hasUnread ? '<span style="position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:50%;background:#60a5fa;box-shadow:0 0 4px rgba(96,165,250,.6);border:2px solid #0f1420;"></span>' : '') +
        '</div>' +
        '<div class="bot-chat-list-text">' +
          '<span class="name">' + escHtml(name) + (cachedReal ? ' <span class="realname">— ' + escHtml(cachedReal) + '</span>' : '') + '</span>' +
          '<span class="meta">' + meta + '</span>' +
        '</div>' +
      '</div>';
    }).join("");

    // Trae el nombre real de a poco (con pausa entre cada uno) para no
    // saturar el límite de llamadas de Binance/Bybit -- reusa la misma ruta
    // que ya carga el nombre real dentro del chat abierto.
    (async () => {
      for (const o of orders) {
        if (gen !== botChatListRenderGen) return; // la lista se volvió a abrir/cerrar, se corta
        if (botChatListNameCache[o.orderNumber]) continue;
        try {
          const r = await fetch("/api/p2p/bot/chat/buyer-name?orderNo=" + encodeURIComponent(o.orderNumber) + "&exchange=" + botSelectedExchange + "&label=" + encodeURIComponent(botActiveLabel || "ONZE"), { credentials:"include" });
          const d = await r.json();
          if (gen !== botChatListRenderGen) return;
          if (d?.ok && d?.name) {
            botChatListNameCache[o.orderNumber] = d.name;
            const item = container.querySelector('[data-order="' + CSS.escape(o.orderNumber) + '"] .name');
            if (item && !item.querySelector(".realname")) {
              const span = document.createElement("span");
              span.className = "realname";
              span.textContent = " — " + d.name;
              item.appendChild(span);
            }
          }
        } catch(_){}
        await new Promise(res => setTimeout(res, 350));
      }
    })();
  }

  function botStartOrdersPolling(){
    botStopOrdersPolling();
    botCreateChatOverlay();
    // Poll for new orders every 8s
    botOrdersPollInterval = setInterval(async () => {
      const container = document.getElementById("botPanelOrdersList");
      if(!container) return;
      try{
        const r = await fetch("/api/p2p/bot/orders?limit=50&live=true&exchange=" + botSelectedExchange + "&label=" + encodeURIComponent(botActiveLabel || "ONZE"), { credentials:"include" });
        const d = await r.json();
        // Bug real confirmado en vivo (sep 2026): a Hector le seguía sonando
        // la alarma de "orden nueva" sin haber ninguna, incluso después de
        // arreglar el servidor para que ya no tratara "0 órdenes" como un
        // error. Causa: sus llamadas a Binance pasan por el proxy de la IP
        // fija (droplet de Singapur, ver lib/p2p-bot/binance-proxy.ts) --
        // un salto de red extra que a veces sí falla de verdad (no solo
        // "0 órdenes"). Cuando eso pasa, el servidor cae al respaldo de la
        // base de datos local (live:false), que puede traer MENOS órdenes
        // que las reales. Este código no distinguía esa respuesta de
        // respaldo de una respuesta en vivo real, así que la lista se
        // achicaba un instante y, al volver los datos en vivo reales en el
        // siguiente ciclo, las órdenes "de siempre" parecían nuevas y
        // sonaba la alarma sin motivo. Ahora, si la respuesta es de
        // respaldo (live:false), se ignora por completo ese ciclo --se
        // deja la pantalla como estaba hasta el próximo ciclo con datos en
        // vivo de verdad, en vez de arriesgarse a mostrar/alarmar con datos
        // incompletos.
        if(d?.live === false) return;
        const newOrders = d?.ok && d?.orders ? d.orders : [];
        const oldData = window.botPanelOrdersData || [];
        // Check if data changed
        const newKey = JSON.stringify(newOrders.map(o => o.orderNumber + o.status));
        const oldKey = JSON.stringify(oldData.map(o => o.orderNumber + o.status));
        if(newKey !== oldKey){
          window.botPanelOrdersData = newOrders;
          window.botPopulateFilterDropdowns();
          applyOrdersDisplay();
          botCheckNewOrders(newOrders);
        }
      }catch(e){}
    }, 8000);
    // Start timer loop - update every second
    updateOrderTimers(); // Update immediately
    botOrdersTimerInterval = setInterval(updateOrderTimers, 1000);
  }

  function botStopOrdersPolling(){
    if(botOrdersPollInterval){ clearInterval(botOrdersPollInterval); botOrdersPollInterval = null; }
    if(botOrdersTimerInterval){ clearInterval(botOrdersTimerInterval); botOrdersTimerInterval = null; }
  }

  function updateOrderTimers(){
    const timers = document.querySelectorAll(".bot-order-timer");
    if(!timers.length) return;
    const now = Date.now();
    timers.forEach(el => {
      const created = parseInt(el.dataset.created, 10);
      const payTimeMinutes = parseInt(el.dataset.paytime, 10) || 15;
      if(!created) return;
      const elapsed = now - created;
      const payWindowMs = payTimeMinutes * 60 * 1000;
      const remaining = Math.max(0, payWindowMs - elapsed);
      const min = Math.floor(remaining / 60000);
      const sec = Math.floor((remaining % 60000) / 1000);
      if(remaining <= 0){
        el.textContent = "⏰ Expirado";
        el.style.color = "#ef4444";
        return;
      }
      const timeStr = String(min).padStart(2,"0") + ":" + String(sec).padStart(2,"0");
      el.textContent = "⏳ " + timeStr;
      // Warn when less than 3 min
      if(remaining < 180000){
        el.style.color = "#fb7185";
      } else if(remaining < 300000){
        el.style.color = "#fbbf24";
      } else {
        el.style.color = "#fbbf24";
      }
    });
  }

  // Start/stop polling when switching tabs
  const origSwitchPanelTab = window.botSwitchPanelTab;
  window.botSwitchPanelTab = function(tab){
    origSwitchPanelTab(tab);
    if(tab === "orders"){ botStartOrdersPolling(); }
    else { botStopOrdersPolling(); }
  };

  /* ————— Anuncios (Ads) ————— */

  let botPanelAdEditingId = null;
  var botPanelSimpleEditMode = false;

  async function loadPanelAds(){
    const container = document.getElementById("botPanelAdsList");
    if(!container) return;
    try{
      const r = await fetch("/api/p2p/bot/ads?exchange=" + botSelectedExchange + "&label=" + encodeURIComponent(botActiveLabel || "ONZE"), { credentials:"include" });
      const d = await r.json();
      // Bug real confirmado en vivo (sep 2026): a Hector se le "desaparecían"
      // los anuncios -- causa: si esta llamada fallaba por un problema
      // pasajero de conexión (ej. el mismo salto extra por el proxy de la IP
      // fija que ya afectaba las órdenes), el servidor respondía d.ok:false,
      // y este código lo trataba igual que "0 anuncios de verdad", borrando
      // la lista que ya se estaba mostrando bien. Ahora, si la llamada
      // falló (d.ok:false), no se toca nada -- se deja lo que ya había
      // hasta el próximo intento. Solo se muestra "Sin anuncios" cuando el
      // servidor respondió BIEN y de verdad no hay ninguno.
      if(!d?.ok) return;
      if(!d?.ads?.length){
        container.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px 0;">Sin anuncios para ' + botSelectedExchange + '. Crea uno nuevo.</div>';
        return;
      }
      container.innerHTML = d.ads.map(a => {
        const isLive = a.fromBybit || a.fromBinance;
        const exchangeLabel = a.fromBybit ? 'Bybit' : a.fromBinance ? 'Binance' : null;
        const botEnabled = a.botEnabled === true;
        return `
        <div class="bot-ad-card">
          <div class="ad-header">
            <div>
              <span class="ad-type ${a.tradeType === 'BUY' ? 'buy' : 'sell'}">${a.tradeType === 'BUY' ? 'Compra' : 'Venta'}</span>
              ${a.nickname ? '<span style="font-weight:700;color:#fff;font-size:14px;margin-left:8px;">'+escHtml(a.nickname)+'</span> <span style="color:#64748b;font-size:12px;">('+escHtml(a.asset)+'/'+escHtml(a.fiat)+')</span>' : '<span style="font-weight:700;color:#fff;font-size:14px;margin-left:8px;">'+escHtml(a.asset)+' / '+escHtml(a.fiat)+'</span>'}
              <button class="ad-icon-btn" type="button" onclick="event.stopPropagation();window.renameBotAd(${a.id != null ? a.id : "'" + escHtml(String(a.adId)) + "'"},'${escHtml(a.adId||'')}','${escHtml(a.exchange||'binance')}','${escHtml(a.nickname||'')}')" title="Ponerle nombre a este anuncio" style="width:22px;height:22px;margin-left:4px;">
                <svg viewBox="0 0 24 24" width="12" height="12"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
              ${isLive ? '<span style="font-size:10px;background:rgba(37,99,235,.2);color:#93c5fd;padding:1px 6px;border-radius:4px;margin-left:4px;">' + exchangeLabel + '</span>' : ''}
              ${botEnabled ? '<span style="font-size:10px;background:rgba(5,150,105,.2);color:#6ee7b7;padding:1px 6px;border-radius:4px;margin-left:4px;">Bot activo</span>' : ''}
            </div>
            <div class="ad-actions">
              <button class="ad-icon-btn" type="button" onclick="window.botPanelEditAd(${a.id != null ? a.id : "'" + escHtml(String(a.adId)) + "'"})" title="Editar anuncio">
                <svg viewBox="0 0 24 24"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              </button>
              <span style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:${botEnabled ? '#34d399' : '#64748b'};letter-spacing:.3px;text-transform:uppercase;">
                <span>Bot</span>
                <span class="toggle-switch" title="${botEnabled ? 'Apagar bot' : 'Prender bot'}" onclick="event.stopPropagation();toggleBotAdEnabled(${a.id},!${botEnabled},'${escHtml(a.adId||'')}')">
                  <input type="checkbox" ${botEnabled?'checked':''}>
                  <span class="slider"></span>
                </span>
              </span>
              ${a.fromBinance ? (() => {
                const isAdOnline = a.status === 'online' || a.status === 'active';
                return `
              <span style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:${isAdOnline ? '#60a5fa' : '#64748b'};letter-spacing:.3px;text-transform:uppercase;">
                <span>Anuncio</span>
                <span class="toggle-switch toggle-switch-ad" title="${isAdOnline ? 'Apagar anuncio en Binance' : 'Prender anuncio en Binance'}" onclick="event.stopPropagation();toggleBinanceAdOnline('${escHtml(a.adId||'')}',!${isAdOnline},this)">
                  <input type="checkbox" ${isAdOnline?'checked':''}>
                  <span class="slider"></span>
                </span>
              </span>`;
              })() : ''}
              <button class="ad-icon-btn danger" type="button" onclick="window.botPanelDeleteAd(${a.id},${isLive ? "'" + a.adId + "'" : 'null'})" title="Eliminar anuncio">
                <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            </div>
          </div>
          <div class="ad-body">
            <span>Precio <span class="val">${fmt(a.price)} ${escHtml(a.fiat)}</span></span>
            <span>Monto <span class="val">${fmt(a.amount)} ${escHtml(a.asset)}</span></span>
            <span>Limites <span class="val">${fmtInt(a.minAmount)} - ${fmtInt(a.maxAmount)} ${escHtml(a.fiat)}</span></span>
            <span>Metodos <span class="val">${a.paymentMethods && a.paymentMethods.length ? a.paymentMethods.join(', ') : '-'}</span></span>
            <span>Pago max <span class="val">${a.payTime} min</span></span>
            <span>Tipo <span class="val">${a.priceType === 'fixed' ? 'Fijo' : 'Flotante'}</span></span>
          </div>
          <div class="ad-footer">
            <span class="ad-status ${a.status === 'active' ? 'online' : a.status}" title="Estado crudo: ${a.status}">${a.status === 'online' || a.status === 'active' ? 'Activo' : a.status === 'private' ? 'Privado' : 'Desconectado'}</span>
            <span style="font-size:11px;color:#64748b;">${new Date(a.createdAt).toLocaleDateString('es-CL')} ${isLive ? '· Sincronizado' : ''}</span>
          </div>
          
        </div>`;
      }).join("");
    }catch(e){}
  }

  window.botPanelNewAd = function(){
    botPanelAdEditingId = null;
    var modal = document.getElementById("botPanelModal");
    if(modal && modal.style.display !== "block"){
      window.botOpenPanel();
      setTimeout(function(){ window.botSwitchPanelTab('ads'); }, 50);
      setTimeout(function(){ renderAdForm(); }, 100);
    }else{
      renderAdForm();
    }
  };

  window.botPanelEditAd = async function(id){
    botPanelAdEditingId = id;
    botPanelSimpleEditMode = true;
    var sub = document.querySelector(".bot-panel-sub");
    if(sub) sub.style.display = "none";
    document.querySelectorAll(".bot-panel-tab-content").forEach(function(c){
      c.style.display = c.id === "botPanelAds" ? "" : "none";
    });
    var adsList = document.getElementById("botPanelAdsList");
    if(adsList) adsList.style.display = "none";
    try{
      var labelParam = (typeof botActiveLabel !== 'undefined' && botActiveLabel) ? '&label=' + encodeURIComponent(botActiveLabel) : '';
      const r = await fetch("/api/p2p/bot/ads?exchange=" + botSelectedExchange + labelParam, { credentials:"include" });
      const d = await r.json();
      const ad = d?.ads?.find(a => a.id === id);
      if(ad) renderAdForm(ad);
      else renderAdForm();
    }catch(e){ renderAdForm(); }
  };

  window.botSimpleEditAd = async function(id){
    botPanelAdEditingId = id;
    var modal = document.getElementById("botPanelModal");
    if(!modal) return;
    modal.style.display = "block";
    botPanelSimpleEditMode = true;
    var sub = document.querySelector(".bot-panel-sub");
    if(sub) sub.style.display = "none";
    document.querySelectorAll(".bot-panel-tab-content").forEach(function(c){
      c.style.display = c.id === "botPanelAds" ? "" : "none";
    });
    var adsContent = document.getElementById("botPanelAdsList");
    if(adsContent) adsContent.style.display = "none";
    var modalHead = document.querySelector("#botPanelModal .modal-head");
    if(modalHead) modalHead.style.display = "none";
    try{
      var labelParam = (typeof botActiveLabel !== 'undefined' && botActiveLabel) ? '&label=' + encodeURIComponent(botActiveLabel) : '';
      const r = await fetch("/api/p2p/bot/ads?exchange=" + botSelectedExchange + labelParam, { credentials:"include" });
      const d = await r.json();
      const ad = d?.ads?.find(a => a.id === id);
      if(ad) renderAdForm(ad);
      else renderAdForm();
    }catch(e){ renderAdForm(); }
  };

  window.botPanelCancelAdForm = function(){
    var sub = document.querySelector(".bot-panel-sub");
    if(sub) sub.style.display = "";
    var modalHead = document.querySelector("#botPanelModal .modal-head");
    if(modalHead) modalHead.style.display = "";
    document.getElementById("botPanelExchangeLabel").textContent = botSelectedExchange.charAt(0).toUpperCase() + botSelectedExchange.slice(1);
    var adsList = document.getElementById("botPanelAdsList");
    if(adsList){ adsList.style.display = ""; loadPanelAds(); }
    window.botSwitchPanelTab('ads');
    document.getElementById("botPanelAdForm").style.display = "none";
    botPanelAdEditingId = null;
    botPanelSimpleEditMode = false;
  };

  function fmt(n){
    if(n === "" || n === null || n === undefined) return "";
    n = Number(n);
    if(isNaN(n)) return "";
    return n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtInt(n){
    if(n === "" || n === null || n === undefined) return "";
    n = Number(n);
    if(isNaN(n)) return "";
    return n.toLocaleString("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtFlex(n){
    if(n === "" || n === null || n === undefined) return "";
    n = Number(n);
    if(isNaN(n)) return "";
    return n.toLocaleString("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

   function fmtPayName(name){
    if(!name) return "";
    var s = String(name)
      .replace(/_/g, " ")
      .replace(/([a-záéíóú])([A-ZÁÉÍÓÚ])/g, "$1 $2")
      .replace(/([A-ZÁÉÍÓÚ])([A-ZÁÉÍÓÚ][a-záéíóú])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    // Split before common Spanish embedded particles (bancode → banco de)
    s = s.replace(/^(banco)(de|del|la|los|las)/i, "$1 $2");
    // Remove trailing "chile" unless word before is "de" (keep "Banco de Chile", strip "Santander Chile")
    var words = s.split(/\s+/);
    if(words.length > 1 && words[words.length-1] === 'chile' && words[words.length-2] !== 'de') {
      words.pop();
      s = words.join(' ');
    }
    // Title case
    return s.replace(/\b\w/g, function(c){ return c.toUpperCase(); });
  }

  function parseFmt(v){
    if(!v) return 0;
    return parseFloat(String(v).replace(/\./g, "").replace(",", ".")) || 0;
  }

  function updateAdEquivalents(){
    const price = parseFmt(document.getElementById("p2pAdPrice")?.value);
    const amount = parseFmt(document.getElementById("p2pAdAmount")?.value);
    const min = parseFmt(document.getElementById("p2pAdMinAmount")?.value);
    const max = parseFmt(document.getElementById("p2pAdMaxAmount")?.value);
    const fiat = document.getElementById("p2pAdFiat")?.value || "CLP";

    const amtEq = document.getElementById("p2pAdAmountEq");
    if(amtEq && price && amount){
      amtEq.textContent = "≈ " + fmtInt(price * amount) + " " + fiat;
      amtEq.style.display = "";
    }else if(amtEq) amtEq.style.display = "none";

    const minEq = document.getElementById("p2pAdMinEq");
    if(minEq && price && min){
      minEq.textContent = "≈ " + fmt(min / price) + " USDT";
      minEq.style.display = "";
    }else if(minEq) minEq.style.display = "none";

    const maxEq = document.getElementById("p2pAdMaxEq");
    if(maxEq && price && max){
      maxEq.textContent = "≈ " + fmt(max / price) + " USDT";
      maxEq.style.display = "";
    }else if(maxEq) maxEq.style.display = "none";
  }

  function formatLiveInt(el){
    if(!el) return;
    const start = el.selectionStart;
    const oldLen = el.value.length;
    const digits = el.value.replace(/\D/g, "");
    if(!digits || digits === "0"){
      el.value = "";
      return;
    }
    el.value = parseInt(digits, 10).toLocaleString("es-CL");
    const diff = el.value.length - oldLen;
    try{ el.setSelectionRange(Math.min(start + diff, el.value.length), Math.min(start + diff, el.value.length)); }catch(e){}
  }

  function formatLiveDecimal(el){
    if(!el) return;
    const start = el.selectionStart;
    const oldLen = el.value.length;
    let raw = el.value.replace(/\./g, "");
    const parts = raw.split(",");
    let intPart = (parts[0] || "").replace(/\D/g, "");
    let decPart = parts.length > 1 ? parts.slice(1).join("").replace(/\D/g, "") : "";
    if(!intPart && !decPart){ el.value = ""; return; }
    const num = parseFloat((intPart || "0") + "." + decPart);
    if(!isNaN(num)){
      const opts = decPart ? { minimumFractionDigits: Math.min(decPart.length, 8), maximumFractionDigits: Math.min(decPart.length, 8) } : { minimumFractionDigits: 0, maximumFractionDigits: 0 };
      el.value = num.toLocaleString("es-CL", opts);
    }
    const diff = el.value.length - oldLen;
    try{ el.setSelectionRange(Math.min(start + diff, el.value.length), Math.min(start + diff, el.value.length)); }catch(e){}
  }

  window.botToggleRadio = function(btn){
    var parent = btn.parentNode;
    parent.querySelectorAll('.af-toggle-btn').forEach(function(b){ b.className = 'af-toggle-btn'; });
    btn.classList.add(btn.dataset.activeClass || 'active-buy');
    var radio = btn.querySelector('input[type="radio"]');
    if(radio) radio.checked = true;
  };

  // Expose to window for inline event handlers
  window.fmt = fmt;
  window.fmtInt = fmtInt;
  window.parseFmt = parseFmt;
  window.updateAdEquivalents = updateAdEquivalents;
  window.formatLiveInt = formatLiveInt;
  window.formatLiveDecimal = formatLiveDecimal;

  function renderAdForm(editAd){
    const container = document.getElementById("botPanelAdForm");
    if(!container) return;
    const isEdit = !!editAd;
    const tradeType = editAd ? editAd.tradeType : "SELL";
    const asset = editAd ? editAd.asset : "USDT";
    const fiat = editAd ? editAd.fiat : "CLP";
    const priceType = editAd ? editAd.priceType : "fixed";
    const price = editAd ? fmt(editAd.price) : "";
    const amount = editAd ? fmt(editAd.amount) : "";
    const minAmount = editAd ? fmtInt(editAd.minAmount) : "";
    const maxAmount = editAd ? fmtInt(editAd.maxAmount) : "";
    const paymentMethods = editAd && editAd.paymentMethods ? editAd.paymentMethods : [];
    const payTime = editAd ? editAd.payTime : 15;
    const status = editAd ? editAd.status : "online";

    container.style.display = "block";
    var buyActive = tradeType === 'BUY' ? 'active-buy' : '';
    var sellActive = tradeType === 'SELL' ? 'active-sell' : '';
    var fixedActive = priceType === 'fixed' ? 'active-buy' : '';
    var floatActive = priceType === 'float' ? 'active-buy' : '';
    var pmChipsHtml = ['Banco Estado','Santander','BCI','Banco Chile','Itau','Mercado Pago','Mach','Tenpo','ScotiaBank','Banco Falabella'].map(function(pm){
      return '<span class="af-pm-chip ' + (paymentMethods.includes(pm) ? 'selected' : '') + '" data-pm="' + escHtml(pm) + '">' + escHtml(pm) + '</span>';
    }).join('');
    container.innerHTML = `
      <div class="bot-panel-form af-pro">
        <div class="af-header">
          <h3>
            ${isEdit ? 'Editar Anuncio' : 'Nuevo Anuncio'}
            <span class="af-badge">${escHtml(asset)}/${escHtml(fiat)}</span>
          </h3>
          <button class="af-close" type="button" onclick="window.botPanelCancelAdForm()">&times;</button>
        </div>

        <div class="af-grid">

          <div class="af-field">
            <label>Tipo</label>
            <div class="af-toggle" id="afToggleTradeType">
              <button class="af-toggle-btn ${buyActive}" data-active-class="active-buy" onclick="window.botToggleRadio(this)">
                <input type="radio" name="p2pAdTradeType" value="BUY" ${tradeType === 'BUY' ? 'checked' : ''}> Comprar
              </button>
              <button class="af-toggle-btn ${sellActive}" data-active-class="active-sell" onclick="window.botToggleRadio(this)">
                <input type="radio" name="p2pAdTradeType" value="SELL" ${tradeType === 'SELL' ? 'checked' : ''}> Vender
              </button>
            </div>
          </div>

          <div class="af-field">
            <label>Estado</label>
            <div class="af-input-wrap">
              <select id="p2pAdStatus" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.5);color:#f8fafc;font-size:13px;font-family:inherit;width:100%;">
                <option value="online" ${status === 'online' ? 'selected' : ''}>Online (Publico)</option>
                <option value="private" ${status === 'private' ? 'selected' : ''}>Privado</option>
                <option value="offline" ${status === 'offline' ? 'selected' : ''}>Desconectado</option>
              </select>
            </div>
          </div>

          <div class="af-field">
            <label>Moneda</label>
            <input id="p2pAdAsset" type="text" value="${escHtml(asset)}" placeholder="USDT">
          </div>

          <div class="af-field">
            <label>Fiat</label>
            <input id="p2pAdFiat" type="text" value="${escHtml(fiat)}" placeholder="CLP">
          </div>

          <div class="af-field">
            <label>Tipo Precio</label>
            <div class="af-toggle" id="afTogglePriceType">
              <button class="af-toggle-btn ${fixedActive}" data-active-class="active-buy" onclick="window.botToggleRadio(this)">
                <input type="radio" name="p2pAdPriceType" value="fixed" ${priceType === 'fixed' ? 'checked' : ''}> Fijo
              </button>
              <button class="af-toggle-btn ${floatActive}" data-active-class="active-buy" onclick="window.botToggleRadio(this)">
                <input type="radio" name="p2pAdPriceType" value="float" ${priceType === 'float' ? 'checked' : ''}> Flotante
              </button>
            </div>
          </div>

          <div class="af-field">
            <label>Precio (${escHtml(fiat)})</label>
            <div class="af-input-wrap">
              <input id="p2pAdPrice" type="text" inputmode="decimal" value="${price}" placeholder="0.00">
              <span class="af-suffix">CLP</span>
            </div>
          </div>

          <div class="af-field">
            <label>Cantidad (${escHtml(asset)})</label>
            <div class="af-input-wrap">
              <input id="p2pAdAmount" type="text" inputmode="decimal" value="${amount}" placeholder="0.00">
              <button class="af-max-btn" type="button" onclick="window.botPanelCheckBalance()" title="Usar saldo disponible">MAX</button>
            </div>
            <span class="af-hint" id="p2pAdAmountEq"></span>
          </div>

          <div class="af-full af-field">
            <label>L\u00EDmites por operaci\u00F3n (${escHtml(fiat)})</label>
            <div class="af-limits">
              <div class="af-limit">
                <input id="p2pAdMinAmount" type="text" inputmode="numeric" value="${minAmount}" placeholder="M\u00EDnimo">
                <span class="af-hint" id="p2pAdMinEq"></span>
              </div>
              <div class="af-limit">
                <input id="p2pAdMaxAmount" type="text" inputmode="numeric" value="${maxAmount}" placeholder="M\u00E1ximo">
                <span class="af-hint" id="p2pAdMaxEq"></span>
              </div>
            </div>
          </div>

          <div class="af-field">
            <label>Duraci\u00F3n de pago</label>
            <div class="af-input-wrap">
              <select id="p2pAdPayTime" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.5);color:#f8fafc;font-size:13px;font-family:inherit;width:100%;">
                <option value="15" ${payTime == 15 ? 'selected' : ''}>15 minutos</option>
                <option value="30" ${payTime == 30 ? 'selected' : ''}>30 minutos</option>
                <option value="45" ${payTime == 45 ? 'selected' : ''}>45 minutos</option>
                <option value="60" ${payTime == 60 ? 'selected' : ''}>60 minutos</option>
              </select>
            </div>
          </div>

        </div>

        <div class="af-full" style="margin-top:6px;">
          <label style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.3px;text-transform:uppercase;display:block;margin-bottom:6px;">M\u00E9todos de pago</label>
          <div class="af-pm-wrap" id="p2pAdPaymentMethods">
            ${pmChipsHtml}
          </div>
          <div class="af-pm-input" style="margin-top:6px;">
            <input id="p2pAdCustomPm" type="text" placeholder="Agregar metodo...">
            <button class="af-pm-add" type="button" onclick="window.botPanelAddPaymentMethod()">+ Agregar</button>
          </div>
        </div>

        <div class="af-actions">
          <button class="af-btn-cancel" type="button" onclick="window.botPanelCancelAdForm()">Cancelar</button>
          <button class="af-btn-save" type="button" onclick="window.botPanelSaveAd()">Guardar</button>
        </div>
      </div>
    `;

    // Live formatting + equivalents
    const decFields = ["p2pAdPrice","p2pAdAmount"];
    decFields.forEach(id => {
      const el = document.getElementById(id);
      if(!el) return;
      el.addEventListener("input", function(){
        window.formatLiveDecimal(this);
        window.updateAdEquivalents();
      });
    });

    const intFields = ["p2pAdMinAmount","p2pAdMaxAmount"];
    intFields.forEach(id => {
      const el = document.getElementById(id);
      if(!el) return;
      el.addEventListener("input", function(){
        window.formatLiveInt(this);
        window.updateAdEquivalents();
      });
    });

    document.querySelectorAll("#p2pAdPaymentMethods .af-pm-chip").forEach(el => {
      el.onclick = function(){ this.classList.toggle("selected"); };
    });

    setTimeout(window.updateAdEquivalents, 80);
  }

  window.botPanelSaveAd = async function(){
    const tradeType = document.querySelector('input[name="p2pAdTradeType"]:checked')?.value || "SELL";
    const asset = document.getElementById("p2pAdAsset")?.value.trim() || "USDT";
    const fiat = document.getElementById("p2pAdFiat")?.value.trim() || "CLP";
    const priceType = document.querySelector('input[name="p2pAdPriceType"]:checked')?.value || "fixed";
    const price = parseFmt(document.getElementById("p2pAdPrice")?.value);
    const amount = parseFmt(document.getElementById("p2pAdAmount")?.value);
    const minAmount = parseFmt(document.getElementById("p2pAdMinAmount")?.value);
    const maxAmount = parseFmt(document.getElementById("p2pAdMaxAmount")?.value);
    const payTime = parseInt(document.getElementById("p2pAdPayTime")?.value) || 15;
    const status = document.getElementById("p2pAdStatus")?.value || "online";

    const paymentMethods = [];
    document.querySelectorAll("#p2pAdPaymentMethods .af-pm-chip.selected").forEach(el => {
      paymentMethods.push(el.dataset.pm);
    });
    const customPm = document.getElementById("p2pAdCustomPm")?.value?.trim();
    if(customPm) paymentMethods.push(customPm);

    if(!price || !amount){
      onzeAlert("Completa precio y cantidad");
      return;
    }

    const body = {
      id: botPanelAdEditingId || undefined,
      exchange: botSelectedExchange,
      label: botActiveLabel || "ONZE",
      tradeType,
      asset,
      fiat,
      priceType,
      price,
      amount,
      minAmount,
      maxAmount,
      paymentMethods,
      payTime,
      status,
      isActive: true,
    };

    try{
      const r = await fetch("/api/p2p/bot/ads", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if(d?.ok){
        botPanelAdEditingId = null;
        document.getElementById("botPanelAdForm").style.display = "none";
        if(botPanelSimpleEditMode){
          var sub = document.querySelector(".bot-panel-sub");
          if(sub) sub.style.display = "";
          var modalHead = document.querySelector("#botPanelModal .modal-head");
          if(modalHead) modalHead.style.display = "";
          document.getElementById("botPanelExchangeLabel").textContent = botSelectedExchange.charAt(0).toUpperCase() + botSelectedExchange.slice(1);
          var adsList = document.getElementById("botPanelAdsList");
          if(adsList) adsList.style.display = "";
          window.botSwitchPanelTab('ads');
          botPanelSimpleEditMode = false;
          loadPanelAds();
        }else{
          loadPanelAds();
        }
        window.botLoadAds();
      }else{
        onzeAlert("Error: " + (d?.error || "Desconocido"));
      }
    }catch(e){
      onzeAlert("Error al guardar anuncio");
    }
  };

  window.botPanelDeleteAd = async function(id, adId){
    if(!(await onzeConfirm("Eliminar este anuncio?"))) return;
    try{
      let url = "/api/p2p/bot/ads?id=" + id;
      if(adId) url += "&adId=" + encodeURIComponent(adId) + "&exchange=" + botSelectedExchange;
      await fetch(url, { method:"DELETE", credentials:"include" });
      loadPanelAds();
      window.botLoadAds();
    }catch(e){}
  };

  window.botPanelToggleAd = async function(id, isActive){
    try{
      await fetch("/api/p2p/bot/ads", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ id, exchange: botSelectedExchange, isActive, label: botActiveLabel || "ONZE" })
      });
      loadPanelAds();
    }catch(e){}
  };

  window.toggleBotManaged = async function(id){
    try{
      const r = await fetch("/api/p2p/bot/ads?exchange=" + botSelectedExchange + "&label=" + encodeURIComponent(botActiveLabel || "ONZE"), { credentials:"include" });
      const d = await r.json();
      const ad = d?.ads?.find(a => a.id === id);
      if(!ad) return;
      await fetch("/api/p2p/bot/ads", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ id, exchange: botSelectedExchange, botManaged: !ad.botManaged, label: botActiveLabel || "ONZE" })
      });
      loadPanelAds();
    }catch(e){}
  };

  /* Per-ad bot config */
  window.toggleBotAdEnabled = async function(id, enabled, adId){
    try{
      const body = { id, exchange: botSelectedExchange, botEnabled: enabled, botManaged: enabled, label: botActiveLabel || "ONZE" };
      if (adId) body.adId = adId;
      const r = await fetch("/api/p2p/bot/ads", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(body)
      });
      if(!r.ok) console.warn("[P2P Bot] toggleBotAdEnabled error: HTTP", r.status, r.statusText);
      loadPanelAds();
    }catch(e){ console.warn("[P2P Bot] toggleBotAdEnabled error:", e); }
  };

  // Botón independiente "prender/apagar anuncio" (pedido explícito del
  // usuario, sep 2026): distinto del switch "Bot" de arriba -- este NO toca
  // la gestión del bot para nada, solo prende/apaga el anuncio en Binance
  // (igual que el switch on/off de la propia app de Binance). El precio
  // sigue actualizándose igual mientras el anuncio esté apagado, tal como
  // pasa hoy cuando se apaga manualmente desde la app.
  window.toggleBinanceAdOnline = async function(adId, online, switchEl){
    if(switchEl){ switchEl.style.opacity = '0.5'; switchEl.style.pointerEvents = 'none'; }
    try{
      const r = await fetch("/api/p2p/bot/ads", {
        method:"PUT", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ exchange: "binance", adId, adOnline: online, label: botActiveLabel || "ONZE" })
      });
      const d = await r.json().catch(() => null);
      if(!r.ok || !d?.ok) console.warn("[P2P Bot] toggleBinanceAdOnline error:", d?.error || r.status);
    }catch(e){ console.warn("[P2P Bot] toggleBinanceAdOnline error:", e); }
    // Este switch aparece en dos pantallas distintas (la principal con la
    // configuración, y la lista dentro del modal de anuncios) -- refresca
    // las dos, la que no aplique simplemente no hace nada (container null).
    if(typeof window.botLoadAds === 'function') window.botLoadAds();
    if(typeof loadPanelAds === 'function') loadPanelAds();
  };

  // Nombre propio por anuncio (pedido explícito del usuario, sep 2026):
  // puramente cosmético para distinguir anuncios del mismo exchange/cuenta
  // de un vistazo -- no se manda a Binance/Bybit, solo vive en Neon.
  window.renameBotAd = async function(id, adId, exchange, currentNickname){
    const next = prompt("Nombre para este anuncio (ej. \"Todos los bancos\", \"Banco Estado\"):", currentNickname || "");
    if(next === null) return; // canceló
    const body = { exchange: exchange || botSelectedExchange, nickname: next.trim(), label: botActiveLabel || "ONZE" };
    if (typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id))) body.id = id;
    if (adId) body.adId = adId;
    try{
      const r = await fetch("/api/p2p/bot/ads", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(body)
      });
      if(!r.ok) console.warn("[P2P Bot] renameBotAd error: HTTP", r.status, r.statusText);
    }catch(e){ console.warn("[P2P Bot] renameBotAd error:", e); }
    if(typeof window.botLoadAds === 'function') window.botLoadAds();
    if(typeof loadPanelAds === 'function') loadPanelAds();
  };

  window.saveBotAdConfig = async function(id, field, value, adId){
    const body = { id, exchange: botSelectedExchange, label: botActiveLabel || "ONZE" };
    if (adId) body.adId = adId;
    if(field === 'botCompetePayTypes'){
      body[field] = value === 'match' ? ['__match_ad__'] : ['all'];
    } else {
      body[field] = value === '' ? null : (field === 'botStrategy' || field === 'botPriceSource' ? value : Number(value));
    }
    try{
      const r = await fetch("/api/p2p/bot/ads", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(body)
      });
      if(!r.ok) console.warn("[P2P Bot] saveBotAdConfig error: HTTP", r.status, r.statusText);
    }catch(e){ console.warn("[P2P Bot] saveBotAdConfig error:", e); }
  };
  /* end per-ad bot config */

  window.botPanelAddPaymentMethod = function(){
    const input = document.getElementById("p2pAdCustomPm");
    if(!input || !input.value.trim()) return;
    const val = input.value.trim();
    const container = document.getElementById("p2pAdPaymentMethods");
    if(!container) return;
    const chip = document.createElement("span");
    chip.className = "af-pm-chip selected";
    chip.dataset.pm = val;
    chip.textContent = val;
    chip.onclick = function(){ this.classList.toggle('selected'); };
    container.appendChild(chip);
    input.value = "";
  };

  window.botPanelCheckBalance = async function(){
    try{
      const r = await fetch("/api/p2p/bot/balance?exchange=" + botSelectedExchange + "&label=" + encodeURIComponent(botActiveLabel || "ONZE"), { credentials:"include" });
      const d = await r.json();
      if(d?.ok && d?.available !== undefined && d?.available > 0){
        document.getElementById("p2pAdAmount").value = fmt(d.available);
        updateAdEquivalents();
      }else{
        onzeAlert("No se pudo leer el saldo. " + (d?.error || d?.message || "API del exchange no disponible"));
      }
    }catch(e){
      onzeAlert("Error al consultar saldo");
    }
  };

  /* ————— Cuentas Bancarias (Accounts) ————— */

  async function loadPanelAccounts(){
    const container = document.getElementById("botPanelAccountsList");
    if(!container) return;
    try{
      const r = await fetch("/api/p2p/bot/accounts", { credentials:"include" });
      const d = await r.json();
      if(!d?.ok || !d?.accounts){
        container.innerHTML = '<div style="color:#64748b;font-size:12px;grid-column:1/-1;text-align:center;padding:12px;">Error al cargar</div>';
        return;
      }
      const acctLabel = botActiveLabel || "ONZE";
      const hintEl = document.getElementById("botPanelAccountsLabelHint");
      if(hintEl) hintEl.textContent = acctLabel;
      const filtered = d.accounts.filter(a => a.exchange === botSelectedExchange && a.label === acctLabel && a.isActive);
      if(!filtered.length){
        container.innerHTML = '<div style="color:#64748b;font-size:12px;grid-column:1/-1;text-align:center;padding:12px;">Sin cuentas guardadas para ' + botSelectedExchange + ' (' + escHtml(acctLabel) + ')</div>';
        return;
      }
      container.innerHTML = filtered.map(a => {
        let infoStr = "";
        let bankTitle = "";
        try{
          const info = typeof a.accountInfo === "string" ? JSON.parse(a.accountInfo) : (a.accountInfo || {});
          bankTitle = [info.bank, info.holder].filter(Boolean).join(" - ");
          const parts = [];
          if(info.bank) parts.push("Banco: " + info.bank);
          if(info.holder) parts.push("Titular: " + info.holder);
          if(info.rut) parts.push("RUT: " + info.rut);
          if(info.accountType) parts.push("Tipo: " + info.accountType);
          if(info.accountNumber) parts.push("Nro: " + info.accountNumber);
          if(info.email) parts.push("Email: " + info.email);
          infoStr = parts.join("<br>");
        }catch(e){}
        const isUnavailable = !!a.unavailable;
        return `
        <div class="bot-account-card"${isUnavailable ? ' style="border-color:rgba(220,38,38,0.5);background:rgba(220,38,38,0.06);"' : ''}>
          <div class="acct-label">${escHtml(bankTitle || a.label)}${isUnavailable ? ' <span style="color:#dc2626;font-weight:800;font-size:11px;">🚨 NO DISPONIBLE</span>' : ''}</div>
          <div class="acct-detail">${infoStr || escHtml(a.accountType || '')}</div>
          <div class="acct-actions">
            <button class="acct-icon-btn" type="button" title="Editar" onclick="window.botPanelEditAccount(${a.id})">✏️</button>
            <button class="acct-icon-btn ${isUnavailable ? 'is-ok' : 'is-warn'}" type="button" title="${isUnavailable ? 'Marcar disponible' : 'Marcar no disponible'}" onclick="window.botPanelToggleAccountUnavailable(${a.id}, ${!isUnavailable})">${isUnavailable ? '✅' : '🚫'}</button>
            <button class="acct-icon-btn is-danger" type="button" title="Eliminar" onclick="window.botPanelDeleteAccount(${a.id})">🗑️</button>
          </div>
        </div>
      `}).join("");
    }catch(e){}
  }

  let mercadoChartInstance = null;
  let mercadoChartJsLoaded = false;

  var mercadoRefreshTimer = null;
  var mercadoFullRefreshCount = 0;

  async function loadPanelMercado(){
    const container = document.getElementById("botPanelMercado");
    if(!container) return;

    var isFull = mercadoFullRefreshCount === 0 || mercadoFullRefreshCount % 4 === 0;
    var exLabel = botSelectedExchange.charAt(0).toUpperCase() + botSelectedExchange.slice(1);
    var exEl = document.getElementById("botMercadoExchange");
    if(exEl) exEl.textContent = "— " + exLabel;
    var loadingMsg = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px;">Sin datos de mercado para ' + exLabel + '</div>';

    try{
      var r = await fetch("/api/p2p/bot/market?type=oracle&exchange=" + botSelectedExchange, { credentials:"include" });
      var d = await r.json();
      if(d?.ok && d?.data) renderMercadoOracle(d.data);
      else document.getElementById("botOracleCard").innerHTML = "";
    }catch(e){}

    try{
      var r = await fetch("/api/p2p/bot/market?type=latest&limit=50&live=true&exchange=" + botSelectedExchange, { credentials:"include" });
      var d = await r.json();
      if(d?.ok && d?.data) renderMercadoRanking(d.data);
      else if(d?.ok) document.getElementById("botMercadoRanking").innerHTML = loadingMsg;
    }catch(e){}

    if(isFull){
      try{
        var r = await fetch("/api/p2p/bot/market?type=history&limit=60&exchange=" + botSelectedExchange, { credentials:"include" });
        var d = await r.json();
        if(d?.ok && d?.data) renderMercadoChart(d.data);
        else if(d?.ok) document.getElementById("botMercadoUpdatedAt").textContent = "";
      }catch(e){}
    }

    try{
      var r = await fetch("/api/p2p/bot/market?type=stats&exchange=" + botSelectedExchange, { credentials:"include" });
      var d = await r.json();
      if(d?.ok && d?.data) renderMercadoStats(d.data);
      else if(d?.ok) document.getElementById("botMercadoStats").innerHTML = loadingMsg;
    }catch(e){}

    try{
      var r = await fetch("/api/p2p/bot/market?type=merchants&exchange=" + botSelectedExchange, { credentials:"include" });
      var d = await r.json();
      if(d?.ok && d?.data) renderMercadoTopMerchants(d.data);
      else if(d?.ok) document.getElementById("botMercadoTopMerchants").innerHTML = loadingMsg;
    }catch(e){}

    try{
      var r = await fetch("/api/p2p/bot/market?type=banks&exchange=" + botSelectedExchange, { credentials:"include" });
      var d = await r.json();
      if(d?.ok && d?.data) renderMercadoBanks(d.data);
      else if(d?.ok) document.getElementById("botMercadoBanks").innerHTML = loadingMsg;
    }catch(e){}

    if(isFull){
      try{
        var r = await fetch("/api/p2p/bot/market?type=insights&exchange=" + botSelectedExchange, { credentials:"include" });
        var d = await r.json();
        if(d?.ok && d?.data) renderMercadoInsights(d.data);
        else if(d?.ok) document.getElementById("botMercadoInsights").innerHTML = loadingMsg;
      }catch(e){}
    }

    mercadoFullRefreshCount++;
  }

  // Auto-refresh mercado every 8 seconds
  window.botStartMercadoRefresh = function(){
    window.botStopMercadoRefresh();
    mercadoRefreshTimer = setInterval(loadPanelMercado, 8000);
  };

  window.botStopMercadoRefresh = function(){
    if(mercadoRefreshTimer){
      clearInterval(mercadoRefreshTimer);
      mercadoRefreshTimer = null;
    }
  };

  function renderMercadoOracle(o){
    const el = document.getElementById("botOracleCard");
    if(!el) return;
    if(!o){
      el.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:16px;">Sin lecturas todavía para el Oráculo.</div>';
      return;
    }

    const dirColor = o.direccion === "alza" ? "up" : o.direccion === "baja" ? "down" : "flat";
    const dirLabel = o.direccion === "alza" ? "▲ ALZA" : o.direccion === "baja" ? "▼ BAJA" : "● LATERAL";
    const scoreColor = o.score >= 70 ? "#34d399" : o.score >= 45 ? "#fbbf24" : "#fb7185";
    const ofertaLabel = o.oferta === "toxica" ? "Oferta tóxica" : o.oferta === "demanda_fuerte" ? "Demanda fuerte" : "Equilibrado";
    const ofertaColor = o.oferta === "toxica" ? "#fb7185" : o.oferta === "demanda_fuerte" ? "#34d399" : "#94a3b8";

    const historyBars = (o.obiHistory || []).map(function(v){
      var h = Math.max(3, Math.round(v / 100 * 26));
      var c = v >= 50 ? "#34d399" : "#fb7185";
      return '<div style="height:' + h + 'px;background:' + c + ';" title="' + v + '% buy"></div>';
    }).join("");

    el.innerHTML = `
      <div class="oracle-wrap">
        <div class="oracle-head">
          <div class="oracle-head-title">🔮 Oráculo de Mercado</div>
          <div class="oracle-head-meta">${o.readingsCount}/10 lecturas · ${new Date(o.cycleAt).toLocaleTimeString("es-CL")}</div>
        </div>

        <div class="oracle-direction">
          <div class="od-left">
            <span style="font-size:11px;font-weight:700;color:#e2e8f0;">DIRECCIÓN DEL PRECIO</span>
            ${o.racha > 1 ? '<span class="oracle-streak">🔥 ' + o.racha + ' racha</span>' : ''}
            <span style="font-size:11px;color:#64748b;">· Régimen: <strong style="color:#a5b4fc;">${o.regimen}</strong> · spread MA3/MA10: ${o.spreadMa}%</span>
          </div>
          <div style="text-align:right;">
            <div class="oracle-badge ${dirColor}">${dirLabel}</div>
            <div style="font-size:10px;color:#64748b;margin-top:3px;">WAP: ${fmt(o.wapSell)}</div>
          </div>
        </div>

        <div class="oracle-grid">
          <div class="oracle-card">
            <div class="oracle-card-title">🎯 Maker Score <span>0-100</span></div>
            <div class="oracle-score-value" style="color:${scoreColor};">${o.score}</div>
            <div class="oracle-score-bar"><div style="width:${o.score}%;background:${scoreColor};"></div></div>
            <div class="oracle-mini-row">
              <div>OBI <span>${o.obiBuyPct}%</span></div>
              <div>Racha <span>${o.racha}x</span></div>
              <div>Vacío <span>${o.hasVacuum ? "Sí" : "No"}</span></div>
              <div>Asimetría <span>${o.asimetriaLabel}</span></div>
            </div>
          </div>

          <div class="oracle-card">
            <div class="oracle-card-title">⚖️ OBI <span style="color:${ofertaColor};">${ofertaLabel}</span></div>
            <div style="font-size:10px;color:#64748b;">Presión del libro de órdenes</div>
            <div class="oracle-obi-bar">
              <div class="buy" style="width:${o.obiBuyPct}%;">BUY</div>
              <div class="sell" style="width:${o.obiSellPct}%;">SELL</div>
            </div>
            <div class="oracle-obi-pct"><span style="color:#34d399;">${o.obiBuyPct}%</span><span style="color:#fb7185;">${o.obiSellPct}%</span></div>
            <div style="font-size:9px;color:#64748b;margin-top:8px;">HISTORIAL OBI BUY%</div>
            <div class="oracle-history">${historyBars}</div>
          </div>

          <div class="oracle-card">
            <div class="oracle-card-title">📐 Asimetría <span>Mínimos por lado</span></div>
            <div class="oracle-mini-stat"><span>Retail (Min)</span><strong style="color:#34d399;">${fmtInt(o.retailMin)}</strong></div>
            <div class="oracle-mini-stat"><span>Ballena (Min)</span><strong style="color:#fb7185;">${fmtInt(o.whaleMin)}</strong></div>
            <div class="oracle-mini-stat"><span>${o.hasVacuum ? "⚠️ Spread Vacuum" : "Spread"}</span><strong>${o.vacuumPct}% ${o.hasVacuum ? "· Vacío" : "· Comprimido"}</strong></div>
          </div>
        </div>

        <div class="oracle-recommend">
          <div class="head">✅ Oráculo Maker Recomienda <span class="score-tag">Score ${o.score}/100</span></div>
          <div>${escHtml(o.recomendacion)}</div>
          <div style="margin-top:8px;color:#a5b4fc;">🧠 Acción: ${o.accion.emoji} ${escHtml(o.accion.texto)}</div>
        </div>
      </div>
    `;
  }

  function renderMercadoStats(stats){
    const el = document.getElementById("botMercadoStats");
    if(!el) return;
    el.innerHTML = [
      '<div class="stat-card-sm"><span class="stat-label">Ordenes totales</span><span class="stat-value">' + stats.totalOrders + '</span></div>',
      '<div class="stat-card-sm"><span class="stat-label">Completadas</span><span class="stat-value" style="color:#34d399">' + stats.completedOrders + '</span></div>',
      '<div class="stat-card-sm"><span class="stat-label">Pendientes</span><span class="stat-value" style="color:#fbbf24">' + stats.pendingOrders + '</span></div>',
      '<div class="stat-card-sm"><span class="stat-label">Vol. total USDT</span><span class="stat-value">' + Number(stats.totalVolumeUsdt).toLocaleString("es-CL", { maximumFractionDigits: 0 }) + '</span></div>',
      '<div class="stat-card-sm"><span class="stat-label">Precio prom.</span><span class="stat-value">$' + stats.avgUnitPrice.toFixed(2) + '</span></div>',
      '<div class="stat-card-sm"><span class="stat-label">Ciclos</span><span class="stat-value">' + stats.totalSnapshots + '</span></div>',
    ].join("");
    // Update main KPIs
    var kpiOrders = document.getElementById("botKpiOrders");
    if(kpiOrders) kpiOrders.textContent = stats.totalOrders;
    var kpiCycles = document.getElementById("botKpiCycles");
    if(kpiCycles) kpiCycles.textContent = stats.totalSnapshots;
  }

  async function renderMercadoChart(history){
    const canvas = document.getElementById("botMercadoChart");
    if(!canvas || !history.length) return;
    if(!mercadoChartJsLoaded){
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      mercadoChartJsLoaded = true;
    }
    if(mercadoChartInstance) mercadoChartInstance.destroy();

    const ctx = canvas.getContext("2d");
    const labels = history.map(h => {
      const d = new Date(h.cycleAt);
      return d.toLocaleTimeString("es-CL", { hour:"2-digit", minute:"2-digit" });
    });

    const ourPrices = history.map(h => h.ourPrice ?? h.targetPrice);
    const minPrices = history.map(h => h.minPrice);
    const maxPrices = history.map(h => h.maxPrice);

    const datasets = [
      {
        label:"Rango mercado",
        data:maxPrices,
        borderColor:"rgba(148,163,184,0.1)",
        backgroundColor:"transparent",
        pointRadius:0,
        fill:false,
        tension:0.3,
        borderWidth:0,
      },
      {
        label:"",
        data:minPrices,
        borderColor:"rgba(148,163,184,0.1)",
        backgroundColor:"rgba(148,163,184,0.06)",
        pointRadius:0,
        fill:"-1",
        tension:0.3,
        borderWidth:0,
      },
      {
        label:"#1",
        data:history.map(h => h.top1Price),
        borderColor:"#ef4444",
        backgroundColor:"transparent",
        tension:0.35,
        pointRadius:0,
        pointHitRadius:10,
        pointHoverRadius:5,
        pointHoverBackgroundColor:"#ef4444",
        pointHoverBorderColor:"#fff",
        pointHoverBorderWidth:2,
        borderWidth:2,
      },
      {
        label:"#2",
        data:history.map(h => h.top2Price),
        borderColor:"#f97316",
        backgroundColor:"transparent",
        tension:0.35,
        pointRadius:0,
        pointHitRadius:10,
        pointHoverRadius:5,
        pointHoverBackgroundColor:"#f97316",
        pointHoverBorderColor:"#fff",
        pointHoverBorderWidth:2,
        borderWidth:1.5,
      },
      {
        label:"#3",
        data:history.map(h => h.top3Price),
        borderColor:"#eab308",
        backgroundColor:"transparent",
        tension:0.35,
        pointRadius:0,
        pointHitRadius:10,
        pointHoverRadius:5,
        pointHoverBackgroundColor:"#eab308",
        pointHoverBorderColor:"#fff",
        pointHoverBorderWidth:2,
        borderWidth:1.5,
      },
      {
        label:"Promedio mercado",
        data:history.map(h => h.avgPrice),
        borderColor:"rgba(148,163,184,0.4)",
        backgroundColor:"transparent",
        borderDash:[3,4],
        tension:0.35,
        pointRadius:0,
        borderWidth:1,
      },
      {
        label:"Tu precio",
        data:ourPrices,
        borderColor:"#22d3ee",
        backgroundColor:"transparent",
        borderDash:[6,4],
        tension:0.35,
        pointRadius:0,
        pointHitRadius:12,
        pointHoverRadius:6,
        pointHoverBackgroundColor:"#22d3ee",
        pointHoverBorderColor:"#fff",
        pointHoverBorderWidth:2.5,
        borderWidth:2.5,
      },
    ];

    var last = history[history.length - 1];
    var first = history[0];
    var currentSpread = last.top1Price && last.top2Price ? Math.abs(last.top2Price - last.top1Price) : null;
    var priceChange = last.top1Price && first.top1Price ? last.top1Price - first.top1Price : 0;
    var changePct = first.top1Price && first.top1Price > 0 ? ((priceChange / first.top1Price) * 100) : 0;
    var headerEl = document.getElementById("botMercadoChartHeader");
    if(headerEl){
      headerEl.innerHTML =
        '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:6px;padding:8px 4px;">' +
          '<span style="display:flex;flex-direction:column;">' +
            '<span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Precio #1</span>' +
            '<span style="font-size:18px;font-weight:700;color:#f8fafc;">$' + (last.top1Price || 0).toFixed(2) + '</span>' +
          '</span>' +
          (currentSpread !== null ?
            '<span style="display:flex;flex-direction:column;">' +
              '<span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Spread #1-#2</span>' +
              '<span style="font-size:18px;font-weight:700;color:' + (currentSpread < 1 ? '#34d399' : currentSpread < 3 ? '#fbbf24' : '#ef4444') + ';">$' + currentSpread.toFixed(2) + '</span>' +
            '</span>' : '') +
          '<span style="display:flex;flex-direction:column;">' +
            '<span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Competidores</span>' +
            '<span style="font-size:18px;font-weight:700;color:#f8fafc;">' + (last.competitorCount || 0) + '</span>' +
          '</span>' +
          '<span style="display:flex;flex-direction:column;">' +
            '<span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Variación</span>' +
            '<span style="font-size:18px;font-weight:700;color:' + (changePct >= 0 ? '#34d399' : '#ef4444') + ';">' + (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%</span>' +
          '</span>' +
          (last.totalVolume ?
            '<span style="display:flex;flex-direction:column;">' +
              '<span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Volumen disp.</span>' +
              '<span style="font-size:18px;font-weight:700;color:#f8fafc;">' + (last.totalVolume > 1000 ? (last.totalVolume / 1000).toFixed(0) + 'k' : last.totalVolume.toFixed(0)) + ' USDT</span>' +
            '</span>' : '') +
        '</div>';
    }

    mercadoChartInstance = new Chart(ctx, {
      type:"line",
      data:{ labels, datasets },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        animation:{ duration:800, easing:"easeOutQuart" },
        interaction:{ mode:"index", intersect:false },
        plugins:{
          legend:{
            labels:{ color:"#94a3b8", font:{ size:10, family:"'Inter',system-ui,sans-serif" }, usePointStyle:true, pointStyle:"circle", padding:16 },
            position:"top",
            align:"center",
          },
          tooltip:{
            backgroundColor:"rgba(15,23,42,0.95)",
            titleColor:"#f1f5f9",
            bodyColor:"#cbd5e1",
            borderColor:"rgba(148,163,184,0.2)",
            borderWidth:1,
            padding:12,
            cornerRadius:8,
            titleFont:{ size:11, family:"'Inter',system-ui,sans-serif" },
            bodyFont:{ size:11, family:"'Inter',system-ui,sans-serif" },
            callbacks:{
              title:function(items){
                if(!items.length) return "";
                var idx = items[0].dataIndex;
                var d = new Date(history[idx].cycleAt);
                return d.toLocaleDateString("es-CL") + " " + d.toLocaleTimeString("es-CL", { hour:"2-digit", minute:"2-digit" });
              }
            }
          }
        },
        scales:{
          x:{
            ticks:{ color:"#64748b", font:{ size:9, family:"'Inter',system-ui,sans-serif" }, maxTicksLimit:8, maxRotation:0 },
            grid:{ color:"rgba(148,163,184,0.06)", drawTicks:false },
            border:{ display:false },
          },
          y:{
            ticks:{ color:"#64748b", font:{ size:9, family:"'Inter',system-ui,sans-serif" }, callback:function(v){ return "$" + Number(v).toFixed(2); } },
            grid:{ color:"rgba(148,163,184,0.06)", drawTicks:false },
            border:{ display:false },
          }
        }
      }
    });
  }

  function renderMercadoRanking(data){
    const updatedEl = document.getElementById("botMercadoUpdatedAt");
    if(updatedEl && data.cycleAt){
      const d = new Date(data.cycleAt);
      const hours = Math.round((Date.now() - d.getTime()) / 3600000);
      const stale = hours > 2 ? ' <span style="color:#ef4444;">(hace ' + hours + 'h — datos antiguos)</span>' : '';
      updatedEl.innerHTML = "Actualizado: " + d.toLocaleDateString("es-CL") + " " + d.toLocaleTimeString("es-CL", { hour:"2-digit", minute:"2-digit" }) + stale;
    // Update main KPIs
    var kpiComp = document.getElementById("botKpiCompetitors");
    if(kpiComp) kpiComp.textContent = data.totalCompetitors || 0;
    var kpiOurAd = document.getElementById("botKpiOurAd");
    var kpiOurAdStatus = document.getElementById("botKpiOurAdStatus");
    if(kpiOurAd && data.ourAd && data.ourAd.price){
      kpiOurAd.textContent = "$" + Number(data.ourAd.price).toFixed(2);
      if(kpiOurAdStatus) kpiOurAdStatus.textContent = "En ranking";
    }else{
      if(kpiOurAd) kpiOurAd.textContent = "Sin anuncio";
      if(kpiOurAdStatus) kpiOurAdStatus.textContent = "No publicado";
    }
    // Update spread KPI from first 2 competitors
    if(data.ranked && data.ranked.length >= 2){
      var spread = Math.abs(Number(data.ranked[1].price) - Number(data.ranked[0].price));
      var kpiSpread = document.getElementById("botKpiSpread");
      if(kpiSpread) kpiSpread.textContent = spread.toFixed(2);
    }
    }
    const container = document.getElementById("botMercadoRanking");
    if(!container) return;
    if(!data.ranked || !data.ranked.length){
      container.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px;">Sin datos de mercado</div>';
      return;
    }
    const ourPrice = data.ourAd?.price;
    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="color:#64748b;border-bottom:1px solid rgba(148,163,184,0.2);">
            <th style="padding:4px 6px;text-align:left;">#</th>
            <th style="padding:4px 6px;text-align:left;">Merchant</th>
            <th style="padding:4px 6px;text-align:right;">Precio</th>
            <th style="padding:4px 6px;text-align:right;">Disp.</th>
            <th style="padding:4px 6px;text-align:right;">Min</th>
            <th style="padding:4px 6px;text-align:right;">Max</th>
            <th style="padding:4px 6px;text-align:center;">% Compl.</th>
            <th style="padding:4px 6px;text-align:center;">Ordenes</th>
            <th style="padding:4px 6px;text-align:left;">Formas de pago</th>
          </tr>
        </thead>
        <tbody>
          ${data.ranked.map(c => {
            const isOurs = ourPrice && Math.abs(Number(c.price) - ourPrice) < 0.01;
            const banks = (c.paymentMethods || []).map(p => p.name).filter(Boolean);
            const uniqueBanks = [...new Set(banks)].slice(0, 3);
            return `
            <tr style="${isOurs ? 'background:rgba(34,211,238,0.08);' : ''}border-bottom:1px solid rgba(148,163,184,0.1);${isOurs ? 'outline:1px solid rgba(34,211,238,0.3);' : ''}">
              <td style="padding:4px 6px;font-weight:600;${c.rank <= 3 ? 'color:#fbbf24;' : ''}">${c.rank}</td>
              <td style="padding:4px 6px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(c.nickName)}">${escHtml(c.nickName || "")}</td>
              <td style="padding:4px 6px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">$${Number(c.price).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td style="padding:4px 6px;text-align:right;font-variant-numeric:tabular-nums;">${Number(c.available).toFixed(0)}</td>
              <td style="padding:4px 6px;text-align:right;font-variant-numeric:tabular-nums;">$${Number(c.minAmount).toLocaleString("es-CL", { maximumFractionDigits: 0 })}</td>
              <td style="padding:4px 6px;text-align:right;font-variant-numeric:tabular-nums;">$${Number(c.maxAmount).toLocaleString("es-CL", { maximumFractionDigits: 0 })}</td>
              <td style="padding:4px 6px;text-align:center;">${c.completionRate}%</td>
              <td style="padding:4px 6px;text-align:center;">${c.orderCount}</td>
              <td style="padding:4px 6px;max-width:140px;">
                ${uniqueBanks.length ? uniqueBanks.map(b => `<span style="display:inline-block;background:rgba(99,102,241,0.15);color:#818cf8;padding:1px 5px;border-radius:3px;font-size:10px;margin:1px;">${escHtml(b)}</span>`).join("") : '<span style="color:#64748b;">-</span>'}
                ${banks.length > 3 ? `<span style="color:#64748b;font-size:10px;">+${banks.length - 3}</span>` : ""}
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  function renderMercadoTopMerchants(merchants){
    const el = document.getElementById("botMercadoTopMerchants");
    if(!el) return;
    if(!merchants || !merchants.length){
      el.innerHTML = '<div style="color:#64748b;font-size:11px;padding:8px 0;">A&uacute;n sin datos suficientes</div>';
      return;
    }
    const top5 = merchants.slice(0, 5);
    el.innerHTML = top5.map((m, i) => {
      const rankColors = ["#fbbf24","#94a3b8","#cd7f32","#64748b","#64748b"];
      return `
        <div class="merchant-card">
          <div class="m-rank" style="color:${rankColors[i]}">#${i + 1}</div>
          <div class="m-name" title="${escHtml(m.nickName)}">${escHtml(m.nickName)}</div>
          <div class="m-price">$${m.avgPrice.toFixed(2)}</div>
          <div class="m-meta">
            <span>📦 ${m.avgAvailable.toFixed(0)} USDT</span>
            <span>🏆 ${m.avgRank.toFixed(1)}° prom.</span>
            <span>✅ ${m.avgCompletionRate.toFixed(0)}%</span>
          </div>
          <div class="m-meta">
            <span>${m.appearances} apariciones</span>
            <span>${m.avgOrdersPerCycle.toFixed(1)} ord/ciclo</span>
          </div>
          ${m.banks && m.banks.length ? `
          <div class="m-banks">
            ${m.banks.slice(0, 5).map(b => `<span class="m-bank-chip">${escHtml(b)}</span>`).join("")}
            ${m.banks.length > 5 ? `<span class="m-bank-chip" style="background:rgba(148,163,184,.1);color:#94a3b8;">+${m.banks.length - 5}</span>` : ""}
          </div>` : ""}
        </div>`;
    }).join("");
  }

  function renderMercadoBanks(data){
    const el = document.getElementById("botMercadoBanks");
    if(!el) return;
    if(!data?.banks || !data.banks.length){
      el.innerHTML = '<div style="color:#64748b;font-size:11px;padding:8px 0;">Sin datos de bancos</div>';
      return;
    }
    const maxCount = data.banks[0].merchantCount;
    el.innerHTML = `
      <div style="font-size:10px;color:#64748b;margin-bottom:4px;">
        Basado en ${data.merchantsWithBanks} competidores &middot; ${data.banks.length} bancos distintos
      </div>
      ${data.banks.slice(0, 10).map(b => `
        <div class="bank-bar">
          <span class="bank-name">${escHtml(b.name)}</span>
          <div class="bank-track">
            <div class="bank-fill" style="width:${Math.max((b.merchantCount / maxCount) * 100, 3)}%">${b.merchantCount}</div>
          </div>
          <span class="bank-pct">${b.pct}%</span>
        </div>
      `).join("")}
    `;
  }

  function renderMercadoInsights(insights){
    const el = document.getElementById("botMercadoInsights");
    if(!el) return;
    if(!insights){
      el.innerHTML = '<div style="color:#64748b;font-size:11px;padding:8px 0;">A&uacute;n sin datos de rendimiento</div>';
      return;
    }
    var rd = insights.rankDistribution || {};
    var totalRanked = 0;
    for(var k in rd){ totalRanked += rd[k]; }
    var rankBars = "";
    var rankLabels = { top1:"#1", top2:"#2", top3:"#3", top5:"#4-#5", top10:"#6-#10", otros:"+10" };
    var rankColors = { top1:"#34d399", top2:"#60a5fa", top3:"#fbbf24", top5:"#f97316", top10:"#a78bfa", otros:"#64748b" };
    for(var key in rankLabels){
      var count = rd[key] || 0;
      var pct = totalRanked > 0 ? (count / totalRanked) * 100 : 0;
      rankBars += [
        '<div class="bank-bar" style="padding:2px 0;">',
          '<span class="bank-name" style="min-width:50px;">' + rankLabels[key] + '</span>',
          '<div class="bank-track" style="height:14px;">',
            '<div class="bank-fill" style="width:' + pct + '%;background:' + rankColors[key] + ';font-size:8px;">' + count + '</div>',
          '</div>',
          '<span class="bank-pct">' + pct.toFixed(0) + '%</span>',
        '</div>'
      ].join("");
    }
    el.innerHTML = [
      '<div class="insight-grid" style="margin-bottom:8px;">',
        '<div class="insight-card">',
          '<div class="i-value">' + insights.totalSnapshots + '</div>',
          '<div class="i-label">Ciclos totales</div>',
        '</div>',
        '<div class="insight-card">',
          '<div class="i-value" style="color:' + (insights.ourAdPresentPct > 80 ? "#34d399" : "#fbbf24") + '">' + insights.ourAdPresentPct + '%</div>',
          '<div class="i-label">Tiempo con anuncio</div>',
        '</div>',
        '<div class="insight-card">',
          '<div class="i-value">$' + insights.avgSpread12.toFixed(2) + '</div>',
          '<div class="i-label">Spread #1-#2</div>',
        '</div>',
        '<div class="insight-card">',
          '<div class="i-value">$' + insights.avgSpread13.toFixed(2) + '</div>',
          '<div class="i-label">Spread #1-#3</div>',
        '</div>',
        '<div class="insight-card">',
          '<div class="i-value">' + insights.avgDepthFirst10.toLocaleString("es-CL") + '</div>',
          '<div class="i-label">Profundidad top 10</div>',
          '<div class="i-sub">USDT disponibles</div>',
        '</div>',
        '<div class="insight-card">',
          '<div class="i-value" style="color:' + (insights.avgPriceDeviation < 1 ? "#34d399" : "#fbbf24") + '">$' + insights.avgPriceDeviation.toFixed(2) + '</div>',
          '<div class="i-label">Desviaci&oacute;n precio</div>',
          '<div class="i-sub">vs precio objetivo</div>',
        '</div>',
      '</div>',
      totalRanked > 0 ? [
        '<div style="font-size:11px;font-weight:600;color:#94a3b8;margin:4px 0 2px;">Distribuci&oacute;n de posici&oacute;n</div>',
        rankBars
      ].join("") : ""
    ].join("");
  }

  let botPanelAccountEditingId = null;

  window.botPanelSaveAccount = async function(){
    const bank = document.getElementById("botPanelAcctBank").value.trim();
    const holder = document.getElementById("botPanelAcctHolder").value.trim();
    const rut = document.getElementById("botPanelAcctRut").value.trim();
    const accountType = document.getElementById("botPanelAcctType").value.trim() || "otro";
    const accountNumber = document.getElementById("botPanelAcctNumber").value.trim();
    const email = document.getElementById("botPanelAcctEmail").value.trim();
    if(!bank || !holder || !accountNumber){
      onzeAlert("Completa banco, titular y numero de cuenta");
      return;
    }

    // label = ONZE/ZINPLE (misma cuenta activa que el resto del panel), no el
    // nombre del banco — así el chatbot solo ofrece las cuentas de la cuenta
    // que realmente está corriendo esa orden.
    const label = botActiveLabel || "ONZE";
    const accountInfo = { bank, holder, rut, accountType, accountNumber, email };

    const body = {
      id: botPanelAccountEditingId || undefined,
      exchange: botSelectedExchange,
      label,
      accountType,
      accountInfo,
    };

    await fetch("/api/p2p/bot/accounts", {
      method:"POST", credentials:"include",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });

    document.getElementById("botPanelAcctBank").value = "";
    document.getElementById("botPanelAcctHolder").value = "";
    document.getElementById("botPanelAcctRut").value = "";
    document.getElementById("botPanelAcctType").value = "";
    document.getElementById("botPanelAcctNumber").value = "";
    document.getElementById("botPanelAcctEmail").value = "";
    botPanelAccountEditingId = null;
    loadPanelAccounts();
  };

  window.botPanelEditAccount = async function(id){
    botPanelAccountEditingId = id;
    try{
      const r = await fetch("/api/p2p/bot/accounts?exchange=" + botSelectedExchange, { credentials:"include" });
      const d = await r.json();
      const acct = d?.accounts?.find(a => a.id === id);
      if(acct){
        document.getElementById("botPanelAcctBank").value = "";
        document.getElementById("botPanelAcctHolder").value = "";
        document.getElementById("botPanelAcctRut").value = "";
        document.getElementById("botPanelAcctType").value = acct.accountType || "";
        document.getElementById("botPanelAcctNumber").value = "";
        document.getElementById("botPanelAcctEmail").value = "";
        try{
          const info = typeof acct.accountInfo === "string" ? JSON.parse(acct.accountInfo) : (acct.accountInfo || {});
          if(info.bank) document.getElementById("botPanelAcctBank").value = info.bank;
          if(info.holder) document.getElementById("botPanelAcctHolder").value = info.holder;
          if(info.rut) document.getElementById("botPanelAcctRut").value = info.rut;
          if(info.accountNumber) document.getElementById("botPanelAcctNumber").value = info.accountNumber;
          if(info.email) document.getElementById("botPanelAcctEmail").value = info.email;
        }catch(e){}
        document.getElementById("botPanelAcctBank").focus();
      }
    }catch(e){}
  };

  window.botPanelDeleteAccount = async function(id){
    await fetch("/api/p2p/bot/accounts?id=" + id, { method:"DELETE", credentials:"include" });
    loadPanelAccounts();
  };

  // Botón de emergencia (ago 2026): marca/desmarca una cuenta como "no
  // disponible" sin borrarla. El bot deja de ofrecerla a compradores nuevos
  // y manda un aviso corto antes del saludo en cualquier orden nueva
  // mientras quede marcada así.
  window.botPanelToggleAccountUnavailable = async function(id, unavailable){
    await fetch("/api/p2p/bot/accounts", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, unavailable }),
    });
    loadPanelAccounts();
  };

  let botPanelChatActiveOrder = null;
  let botPanelChatRefreshInterval = null;
  let botPanelChatLastMsgTime = 0;

  // botPanelChatActiveOrder es una variable interna (no vive en window), así
  // que un onclick="..." en el HTML del botón (que corre en el scope global
  // de la página, no acá) no puede leerla directo -- bug real encontrado al
  // probar el botón "Liberar" del chat (sep 2026): el click no hacía nada.
  window.botPanelReleaseCurrentChatOrder = function(){
    if(!botPanelChatActiveOrder) return;
    window.botPanelReleaseOrder(botPanelChatActiveOrder);
  };

  function renderChatMessageHtml(m){
    if(m.type === "system" || m.type === "auto_reply" && m.self === false){
      return '<div style="display:flex;justify-content:center;margin-bottom:8px;"><div style="background:rgba(148,163,184,.06);color:#94a3b8;padding:4px 12px;border-radius:12px;font-size:11px;text-align:center;">' + escHtml(m.content) + '</div></div>';
    }
    if(m.type === "image"){
      const time = m.createTime ? new Date(Number(m.createTime)).toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"}) : "";
      const isSelf = m.self;
      const sender = isSelf ? "Tú" : (m.fromNickName || "Contraparte");
      const imgUrl = m.imageUrl || m.thumbnailUrl;
      const proxyUrl = "/api/p2p/bot/chat/image?url=" + encodeURIComponent(imgUrl);
      return '<div style="display:flex;flex-direction:column;align-items:' + (isSelf ? 'flex-end' : 'flex-start') + ';margin-bottom:8px;">' +
        '<div style="font-size:10px;color:#64748b;margin-bottom:3px;padding:0 4px;">' + escHtml(sender) + ' subió un comprobante</div>' +
        '<div onclick="window.botOpenImagePreview(\'' + encodeURIComponent(imgUrl) + '\')" style="max-width:200px;border-radius:12px;overflow:hidden;border:1px solid rgba(148,163,184,.12);cursor:pointer;">' +
        '<img src="' + proxyUrl + '" alt="Comprobante de pago" style="width:100%;display:block;" loading="lazy">' +
        '</div>' +
        '<div style="font-size:9px;color:#64748b;margin-top:2px;">' + time + '</div></div>';
    }
    const time = m.createTime ? new Date(Number(m.createTime)).toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"}) : "";
    const isSelf = m.self;
    const sender = isSelf ? "Tú" : (m.fromNickName || "Contraparte");
    return '<div style="display:flex;flex-direction:column;align-items:' + (isSelf ? 'flex-end' : 'flex-start') + ';margin-bottom:10px;">' +
      '<div style="font-size:10px;color:#64748b;margin-bottom:3px;padding:0 4px;">' + escHtml(sender) + '</div>' +
      '<div class="bot-chat-bubble" style="background:' + (isSelf ? 'linear-gradient(135deg,#2f6ff0,#2451c9)' : '#1c2438') + ';color:' + (isSelf ? '#fff' : '#e7ecf5') + ';padding:9px 14px;border-radius:' + (isSelf ? '16px 16px 3px 16px' : '16px 16px 16px 3px') + ';font-size:13px;line-height:1.45;max-width:85%;word-wrap:break-word;border:1px solid ' + (isSelf ? 'transparent' : 'rgba(148,163,184,.1)') + ';white-space:pre-wrap;min-width:120px;">' +
      escHtml(m.content) +
      '<div style="font-size:9px;color:' + (isSelf ? 'rgba(255,255,255,.55)' : '#7c8aa3') + ';margin-top:3px;text-align:right;">' + time + '</div></div></div>';
  }

  window.botOpenImagePreview = function(imgUrl){
    if(!imgUrl) return;
    const url = decodeURIComponent(imgUrl);
    const proxyUrl = "/api/p2p/bot/chat/image?url=" + encodeURIComponent(url);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.85);z-index:99999999;display:flex;align-items:center;justify-content:center;cursor:pointer;";
    overlay.onclick = () => overlay.remove();
    const img = document.createElement("img");
    img.src = proxyUrl;
    img.style.cssText = "max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);";
    overlay.appendChild(img);
    document.body.appendChild(overlay);
  };

  window.botPanelOpenChat = async function(orderNumber){
    if(botPanelChatRefreshInterval) clearInterval(botPanelChatRefreshInterval);
    botPanelChatRefreshInterval = null;
    botPanelChatLastMsgTime = 0;

    // Mark as read
    localStorage.setItem("botChatLastRead_" + orderNumber, String(Date.now()));

    botPanelChatActiveOrder = orderNumber;
    const orders = window.botPanelOrdersData || [];
    const order = orders.find(o => o.orderNumber === orderNumber);
    document.getElementById("botOrderChatCounterparty").textContent = order?.counterparty || "—";
    document.getElementById("botOrderChatOrderInfo").innerHTML =
      (order?.tradeType === "SELL" ? "Venta" : "Compra") + " " +
      (order ? window.fmt(order.amount) + " USDT x " + window.fmt(order.unitPrice) + ' = <span style="color:#fbbf24;font-weight:700;">$' + window.fmtInt(order.totalPrice) + ' CLP</span>' : "") +
      " · #" + (orderNumber?.slice(-10) || "");
    document.getElementById("botOrderChatInput").value = "";

    // Botón "Liberar" en el chat, igual al que muestra la propia app de
    // Binance cuando el comprador ya pagó (pedido explícito del usuario,
    // sep 2026) -- reusa exactamente el mismo flujo de confirmación por
    // clave/huella que ya existe en la lista de órdenes, no un mecanismo
    // nuevo. Solo se muestra con status "paid", igual que Binance.
    const releaseBtn = document.getElementById("botOrderChatReleaseBtn");
    if(releaseBtn) releaseBtn.style.display = order?.status === "paid" ? "" : "none";

    // Nombre real del comprador (ej. "MAMANI CHOQUE NOEMI") -- el mismo dato
    // que Binance/Bybit ya muestran en su propia app ("Nombre del
    // comprador"), para validar el pago sin depender del teléfono. Pedido
    // explícito del usuario (sep 2026). Se pide apenas se abre el chat, sin
    // esperar a que el comprador marque "pagado" -- confirmado en vivo que
    // Binance ya lo entrega desde el inicio de la orden.
    const buyerNameEl = document.getElementById("botOrderChatBuyerName");
    if(buyerNameEl){ buyerNameEl.style.display = "none"; buyerNameEl.textContent = ""; }
    fetch("/api/p2p/bot/chat/buyer-name?orderNo=" + encodeURIComponent(orderNumber) + "&exchange=" + botSelectedExchange + "&label=" + encodeURIComponent(botActiveLabel || "ONZE"), { credentials:"include" })
      .then(r => r.json())
      .then(d => {
        if(botPanelChatActiveOrder !== orderNumber) return; // el usuario ya cambió de orden
        if(d?.ok && d?.name && buyerNameEl){
          buyerNameEl.textContent = "👤 " + d.name;
          buyerNameEl.style.display = "";
        }
      }).catch(() => {});

    const msgContainer = document.getElementById("botOrderChatMessages");
    msgContainer.innerHTML = '<div data-chat-placeholder style="color:#64748b;font-size:12px;text-align:center;padding:20px 0;">Cargando mensajes...</div>';
    const overlayEl = document.getElementById("botOrderChatOverlay");
    overlayEl.style.display = "";
    overlayEl.classList.remove("bot-chat-collapsed");
    document.getElementById("botChatReopenTab")?.classList.remove("show");

    // Fetch real chat messages from Binance API
    try{
      const r = await fetch("/api/p2p/bot/chat?orderNo=" + encodeURIComponent(orderNumber) + "&exchange=" + botSelectedExchange, { credentials:"include" });
      const d = await r.json();
      if(d?.ok && d?.messages?.length){
        msgContainer.innerHTML = d.messages.map(renderChatMessageHtml).join("");
        botPanelChatLastMsgTime = Math.max(...d.messages.map(m => Number(m.createTime)));
        msgContainer.scrollTop = msgContainer.scrollHeight;
      } else {
        msgContainer.innerHTML = '<div data-chat-placeholder style="color:#64748b;font-size:12px;text-align:center;padding:20px 0;">No hay mensajes previos.</div>';
      }
    } catch(e){
      msgContainer.innerHTML = '<div data-chat-placeholder style="color:#fb7185;font-size:12px;text-align:center;padding:20px 0;">Error al cargar mensajes: ' + escHtml(e.message) + '</div>';
    }

    // Auto-refresh every 5 seconds (reload all messages each time)
    botPanelChatRefreshInterval = setInterval(async () => {
      if(!botPanelChatActiveOrder) return;
      try{
        // Update counterparty name if order status changed (paid reveals real name)
        const updatedOrders = window.botPanelOrdersData || [];
        const updatedOrder = updatedOrders.find(o => o.orderNumber === botPanelChatActiveOrder);
        if(updatedOrder?.counterparty){
          const currentName = document.getElementById("botOrderChatCounterparty").textContent;
          if(updatedOrder.counterparty !== currentName && updatedOrder.counterparty !== "—"){
            document.getElementById("botOrderChatCounterparty").textContent = updatedOrder.counterparty;
          }
        }
        const releaseBtn2 = document.getElementById("botOrderChatReleaseBtn");
        if(releaseBtn2) releaseBtn2.style.display = updatedOrder?.status === "paid" ? "" : "none";

        // Fetch all messages and replace entire content (avoids filtering/sync issues)
        const r2 = await fetch("/api/p2p/bot/chat?orderNo=" + encodeURIComponent(botPanelChatActiveOrder) + "&exchange=" + botSelectedExchange, { credentials:"include" });
        const d2 = await r2.json();
        if(!d2?.ok || !d2?.messages?.length) return;
        const container = document.getElementById("botOrderChatMessages");
        if(!container) return;
        const html = d2.messages.map(renderChatMessageHtml).join("");
        // Only update if content actually changed (prevents flicker)
        if(container.innerHTML !== html){
          container.innerHTML = html;
          container.scrollTop = container.scrollHeight;
        }

        // Reintento silencioso del nombre real -- por si la primera llamada
        // (al abrir el chat) falló momentáneamente (ej. límite de Binance).
        // No pisa un nombre que ya se mostró con éxito.
        const buyerNameEl2 = document.getElementById("botOrderChatBuyerName");
        if(buyerNameEl2 && buyerNameEl2.style.display === "none"){
          fetch("/api/p2p/bot/chat/buyer-name?orderNo=" + encodeURIComponent(botPanelChatActiveOrder) + "&exchange=" + botSelectedExchange + "&label=" + encodeURIComponent(botActiveLabel || "ONZE"), { credentials:"include" })
            .then(r => r.json())
            .then(d => {
              if(botPanelChatActiveOrder && d?.ok && d?.name && buyerNameEl2){
                buyerNameEl2.textContent = "👤 " + d.name;
                buyerNameEl2.style.display = "";
              }
            }).catch(() => {});
        }
      } catch(_){}
    }, 5000);
  };

  window.botPanelCloseChat = function(){
    // Pedido explícito del usuario (sep 2026): en escritorio, la X ya no
    // cierra el chat del todo -- lo oculta igual que la flecha de
    // "minimizar" (deja la pestañita "Chat" a la izquierda de la pantalla),
    // para poder volver a entrar sin tener que ir a Panel P2P > Ordenes a
    // buscar de nuevo la orden. En el teléfono (pantalla completa) la X
    // sigue cerrando todo como siempre, porque ahí no hay pestañita a la
    // que volver.
    const isDesktop = window.matchMedia("(min-width: 701px)").matches;
    if(isDesktop && botPanelChatActiveOrder){
      const overlayEl = document.getElementById("botOrderChatOverlay");
      if(!overlayEl.classList.contains("bot-chat-collapsed")) window.botToggleChatCollapse();
      return;
    }
    if(botPanelChatRefreshInterval) clearInterval(botPanelChatRefreshInterval);
    botPanelChatRefreshInterval = null;
    const overlayEl = document.getElementById("botOrderChatOverlay");
    overlayEl.style.display = "none";
    overlayEl.classList.remove("bot-chat-collapsed");
    document.getElementById("botChatReopenTab")?.classList.remove("show");
    document.getElementById("botChatListPanel")?.classList.remove("show");
    document.getElementById("botChatOrdersPanel")?.classList.remove("show");
    botPanelChatActiveOrder = null;
    botPanelChatLastMsgTime = 0;
  };

  // Punto de entrada ÚNICO y SIEMPRE presente al chat -- pedido explícito
  // del usuario (sep 2026): antes, la única forma de volver a un chat sin
  // ir a Panel P2P > Ordenes era la pestañita "Chat" que solo aparecía
  // DESPUÉS de haber abierto al menos una conversación esa sesión. Ahora,
  // el botón flotante verde (antes de WhatsApp, ver el <a id="waFloatBtn">)
  // llama a esto en la vista admin/escritorio: si ya hay un chat abierto
  // (aunque esté minimizado), lo vuelve a mostrar; si no hay ninguno
  // todavía (recién entrando a la web), abre el chat acoplado vacío + la
  // lista para elegir con quién chatear directamente.
  window.botOpenMainChatEntry = async function(){
    botCreateChatOverlay();
    const overlay = document.getElementById("botOrderChatOverlay");
    if(botPanelChatActiveOrder){
      if(overlay.classList.contains("bot-chat-collapsed")) window.botToggleChatCollapse();
    } else {
      overlay.style.display = "";
      overlay.classList.remove("bot-chat-collapsed");
      document.getElementById("botChatReopenTab")?.classList.remove("show");
      // Se espera a que carguen las órdenes ANTES de pintar la lista --
      // si no, como recién se está entrando a la web y todavía no hay
      // nada en window.botPanelOrdersData, la lista se pintaba vacía y no
      // se volvía a pintar sola cuando los datos llegaban un instante
      // después.
      await loadPanelOrders();
      botStartOrdersPolling();
      window.botToggleChatList(true);
    }
  };

  window.botPanelSendChatMessage = async function(){
    if(!botPanelChatActiveOrder) return;
    const input = document.getElementById("botOrderChatInput");
    if(!input || !input.value.trim()) return;
    const msgContainer = document.getElementById("botOrderChatMessages");
    if(!msgContainer) return;
    const text = input.value.trim();
    input.value = "";
    input.style.height = "auto";
    // Show message instantly (optimistic)
    const placeholder = msgContainer.querySelector('[data-chat-placeholder]');
    if(placeholder) msgContainer.innerHTML = "";
    msgContainer.innerHTML += '<div data-msg="' + escHtml(text).slice(0, 50) + '" style="display:flex;justify-content:flex-end;margin-bottom:10px;"><div class="bot-chat-bubble" style="background:linear-gradient(135deg,#2f6ff0,#2451c9);color:#fff;padding:9px 14px;border-radius:16px 16px 3px 16px;font-size:13px;line-height:1.45;max-width:85%;word-wrap:break-word;">' + escHtml(text) + '<div style="font-size:9px;color:rgba(255,255,255,.55);margin-top:3px;text-align:right;">' + new Date().toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"}) + '</div></div></div>';
    window._lastSentText = text;
    msgContainer.scrollTop = msgContainer.scrollHeight;
    // Send in background
    try{
      const r = await fetch("/api/p2p/bot/orders", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action: "chat", orderNumber: botPanelChatActiveOrder, exchange: botSelectedExchange, message: text })
      });
      const d = await r.json();
      if(!d?.ok){
        const errEl = document.createElement("div");
        errEl.style.cssText = "color:#ef4444;font-size:11px;text-align:center;padding:6px;background:rgba(239,68,68,.08);border-radius:6px;margin-bottom:6px;";
        errEl.textContent = "❌ Error al enviar: " + (d?.error || "No se pudo enviar el mensaje");
        msgContainer.appendChild(errEl);
        msgContainer.scrollTop = msgContainer.scrollHeight;
      }
    } catch(e){
      const errEl = document.createElement("div");
      errEl.style.cssText = "color:#ef4444;font-size:11px;text-align:center;padding:6px;background:rgba(239,68,68,.08);border-radius:6px;margin-bottom:6px;";
      errEl.textContent = "❌ Error de conexión al enviar mensaje";
      msgContainer.appendChild(errEl);
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }
  };

  // Pedido explícito del usuario (sep 2026): reemplaza la lupa de diagnóstico
  // Playwright (ya no servía para nada, era de cuando se armó la integración
  // del chat) por un acceso rápido para avisarle al dueño real de la cuenta
  // (vía WhatsApp) cuando el operador necesita que libere una orden a mano
  // -- ver FUND_PWD_MAX_USD en binance-adapter.ts: Binance no permite
  // liberar automático (con contraseña de fondos) órdenes de más de $500 USD.
  window.botCallOperator = async function(){
    try{
      const label = botActiveLabel || "ONZE";
      const r = await fetch("/api/p2p/bot/exchange-config?label=" + encodeURIComponent(label), { credentials:"include" });
      const d = await r.json();
      const number = d?.configs?.[botSelectedExchange]?.operatorWhatsapp;
      if(!number){
        onzeAlert("Todavía no has configurado un WhatsApp para " + label + ". Ve a Seguridad y agrégalo.");
        return;
      }
      window.open("https://wa.me/" + number, "_blank");
    }catch(e){ console.warn("[P2P Bot] botCallOperator error:", e); }
  };

  window.botPanelAcceptOrder = async function(orderNumber){
    if(!(await onzeConfirm("Aceptar orden #" + orderNumber + "?"))) return;
    try{
      await fetch("/api/p2p/bot/orders", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action: "accept", orderNumber, exchange: botSelectedExchange })
      });
      loadPanelOrders();
    }catch(e){}
  };

  window.botPanelVerifyOrder = async function(orderNumber){
    const btn = document.getElementById("btn-verify-" + orderNumber);
    if(btn){
      btn.textContent = "⏳ Verificando...";
      btn.disabled = true;
      btn.style.opacity = "0.7";
    }
    try{
      const r = await fetch("/api/p2p/bot/orders", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action: "verify", orderNumber, exchange: botSelectedExchange })
      });
      const d = await r.json();
      if(d?.ok){
        botVerifyOrderSave(orderNumber);
        if(btn){
          btn.textContent = "✓ Verificado";
          btn.style.background = "rgba(52,211,153,.2)";
          btn.style.color = "#34d399";
          btn.style.borderColor = "rgba(52,211,153,.3)";
        }
        setTimeout(() => applyOrdersDisplay(), 800);
      } else {
        if(btn){
          btn.textContent = "✓ Verificar";
          btn.disabled = false;
          btn.style.opacity = "1";
        }
        onzeAlert("❌ Error: " + (d.error || "Desconocido"));
      }
    }catch(e){ 
      if(btn){
        btn.textContent = "✓ Verificar";
        btn.disabled = false;
        btn.style.opacity = "1";
      }
      onzeAlert("❌ Error de red"); 
    }
  };

  window.botPanelReleaseOrder = function(orderNumber){
    window._releaseOrderNumber = orderNumber;
    const label = document.getElementById("releaseAuthOrderLabel");
    if(label) label.textContent = orderNumber;
    const pinInput = document.getElementById("releaseAuthPin");
    if(pinInput) pinInput.value = "";
    const msg = document.getElementById("releaseAuthMsg");
    if(msg){ msg.textContent = ""; }
    const modal = document.getElementById("releaseAuthModal");
    if(modal) modal.style.display = "flex";
  };

  window.botCloseReleaseAuthModal = function(){
    const modal = document.getElementById("releaseAuthModal");
    if(modal) modal.style.display = "none";
  };

  window.botFinishRelease = async function(orderNumber, token){
    const msg = document.getElementById("releaseAuthMsg");
    if(msg){ msg.textContent = "Liberando..."; msg.style.color = "#94a3b8"; }
    try{
      const r = await fetch("/api/p2p/bot/orders", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"release", orderNumber, exchange: botSelectedExchange, label: botActiveLabel, token })
      });
      const d = await r.json();
      if(!d.ok){
        if(msg){ msg.textContent = d.error || "No se pudo liberar"; msg.style.color = "#fb7185"; }
        return;
      }
      window.botCloseReleaseAuthModal();
      loadPanelOrders();
    }catch(e){
      if(msg){ msg.textContent = "Error de red"; msg.style.color = "#fb7185"; }
    }
  };

  window.botReleaseAuthWithPin = async function(){
    const orderNumber = window._releaseOrderNumber;
    const pin = (document.getElementById("releaseAuthPin").value || "").trim();
    const msg = document.getElementById("releaseAuthMsg");
    if(!/^\d{4}$/.test(pin)){ msg.textContent = "Ingresa los 4 dígitos"; msg.style.color = "#fb7185"; return; }
    msg.textContent = "Verificando..."; msg.style.color = "#94a3b8";
    try{
      const r = await fetch("/api/security/pin/verify", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ pin, orderNumber })
      });
      const d = await r.json();
      if(!d.ok){ msg.textContent = d.error || "Clave incorrecta"; msg.style.color = "#fb7185"; return; }
      await window.botFinishRelease(orderNumber, d.token);
    }catch(e){ msg.textContent = "Error de red"; msg.style.color = "#fb7185"; }
  };

  window.botReleaseAuthWithFingerprint = async function(){
    const orderNumber = window._releaseOrderNumber;
    const msg = document.getElementById("releaseAuthMsg");
    if(!window.SimpleWebAuthnBrowser){ msg.textContent = "Huella no disponible en este navegador"; msg.style.color = "#fb7185"; return; }
    msg.textContent = "Esperando tu huella..."; msg.style.color = "#94a3b8";
    try{
      const optRes = await fetch("/api/security/webauthn/auth-options", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ orderNumber })
      });
      const optData = await optRes.json();
      if(!optData.ok){ msg.textContent = optData.error || "No se pudo iniciar la verificación"; msg.style.color = "#fb7185"; return; }
      const authResp = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: optData.options });
      const verifyRes = await fetch("/api/security/webauthn/auth-verify", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ orderNumber, response: authResp })
      });
      const verifyData = await verifyRes.json();
      if(!verifyData.ok){ msg.textContent = verifyData.error || "Huella no verificada"; msg.style.color = "#fb7185"; return; }
      await window.botFinishRelease(orderNumber, verifyData.token);
    }catch(e){
      msg.textContent = (e && e.name === "NotAllowedError") ? "Cancelado" : "Error al verificar huella";
      msg.style.color = "#fb7185";
    }
  };

  /* ————— Seguridad: PIN + huella ————— */

  window.botLoadPanelSecurity = async function(){
    const pinStatus = document.getElementById("botSecPinStatus");
    const credsList = document.getElementById("botSecCredsList");
    if(pinStatus) pinStatus.textContent = "Cargando...";
    try{
      const r = await fetch("/api/security/pin", { credentials:"include" });
      const d = await r.json();
      if(pinStatus){
        pinStatus.textContent = d.ok && d.configured ? "✅ Clave configurada" : "⚠️ Todavía no has configurado una clave";
        pinStatus.style.color = d.ok && d.configured ? "#8df0b2" : "#ffd36e";
      }
    }catch(e){
      if(pinStatus) pinStatus.textContent = "No se pudo cargar el estado de la clave";
    }
    try{
      const label = botActiveLabel || "ONZE";
      const fundLabelEl = document.getElementById("botSecFundPwdLabel");
      if(fundLabelEl) fundLabelEl.textContent = label;
      const whatsappLabelEl = document.getElementById("botSecWhatsappLabel");
      if(whatsappLabelEl) whatsappLabelEl.textContent = label;
      const waInp = document.getElementById("botExOperatorWhatsapp");
      if(waInp){
        const wr = await fetch("/api/p2p/bot/exchange-config?label=" + encodeURIComponent(label), { credentials:"include" });
        const wd = await wr.json();
        waInp.value = wd?.configs?.[botSelectedExchange]?.operatorWhatsapp || "";
      }
      const fr = await fetch("/api/security/binance-fund-password?label=" + encodeURIComponent(label), { credentials:"include" });
      const fd = await fr.json();
      const fundStatus = document.getElementById("botSecFundPwdStatus");
      if(fundStatus){
        fundStatus.textContent = fd.ok && fd.configured ? "✅ Configurada" : "⚠️ Todavía no has configurado tu contraseña de fondos";
        fundStatus.style.color = fd.ok && fd.configured ? "#8df0b2" : "#ffd36e";
      }
    }catch(e){
      const fundStatus = document.getElementById("botSecFundPwdStatus");
      if(fundStatus) fundStatus.textContent = "No se pudo cargar el estado";
    }
    try{
      const r2 = await fetch("/api/security/webauthn/credentials", { credentials:"include" });
      const d2 = await r2.json();
      window._botSecHasCredential = !!(d2.ok && d2.credentials?.length);
      if(credsList){
        if(!d2.ok || !d2.credentials?.length){
          credsList.innerHTML = '<div style="font-size:12px;color:#64748b;">Sin huellas registradas todavía.</div>';
        } else {
          credsList.innerHTML = d2.credentials.map(c => {
            const date = new Date(c.createdAt).toLocaleString("es-CL");
            return `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.1);border-radius:8px;padding:6px 10px;font-size:12px;">
              <span>${c.deviceLabel || "Dispositivo"} <span style="color:#64748b;">— ${date}</span></span>
              <button class="btn small danger" type="button" style="font-size:10px;padding:2px 8px;" onclick="window.botPanelDeleteFingerprint(${c.id})">Eliminar</button>
            </div>`;
          }).join("");
        }
      }
    }catch(e){
      if(credsList) credsList.innerHTML = '<div style="font-size:12px;color:#fb7185;">No se pudo cargar la lista.</div>';
    }
  };

  // Si ya hay al menos una huella registrada, cambiar el PIN o agregar OTRA
  // huella exige confirmar primero con una huella existente — pide el
  // sensor directamente y devuelve el token de un solo uso que el backend
  // exige (ver requireSettingsAuthIfConfigured en lib/security-pin.ts).
  // Si todavía no hay ninguna huella (primera configuración), no hay nada
  // que verificar y devuelve null sin pedir nada.
  window.botGetSettingsAuthToken = async function(msg){
    if(!window._botSecHasCredential) return { ok:true, token: null };
    if(!window.SimpleWebAuthnBrowser){
      if(msg){ msg.textContent = "Este navegador no soporta huella/Face ID"; msg.style.color = "#fb7185"; }
      return { ok:false };
    }
    if(msg){ msg.textContent = "Confirma con tu huella para continuar..."; msg.style.color = "#94a3b8"; }
    try{
      const optRes = await fetch("/api/security/webauthn/auth-options", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ orderNumber: "__security_settings__" })
      });
      const optData = await optRes.json();
      if(!optData.ok){ if(msg){ msg.textContent = optData.error || "No se pudo iniciar la verificación"; msg.style.color = "#fb7185"; } return { ok:false }; }
      const authResp = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: optData.options });
      const verifyRes = await fetch("/api/security/webauthn/auth-verify", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ orderNumber: "__security_settings__", response: authResp })
      });
      const verifyData = await verifyRes.json();
      if(!verifyData.ok){ if(msg){ msg.textContent = verifyData.error || "Huella no verificada"; msg.style.color = "#fb7185"; } return { ok:false }; }
      return { ok:true, token: verifyData.token };
    }catch(e){
      if(msg){ msg.textContent = (e && e.name === "NotAllowedError") ? "Cancelado" : "Error al verificar huella"; msg.style.color = "#fb7185"; }
      return { ok:false };
    }
  };

  window.botPanelSaveFundPassword = async function(){
    const fundPassword = (document.getElementById("botSecFundPwdNew").value || "").trim();
    const msg = document.getElementById("botSecFundPwdMsg");
    if(!fundPassword){ msg.textContent = "Ingresa la contraseña de fondos"; msg.style.color = "#fb7185"; return; }
    const auth = await window.botGetSettingsAuthToken(msg);
    if(!auth.ok) return;
    msg.textContent = "Guardando..."; msg.style.color = "#94a3b8";
    try{
      const r = await fetch("/api/security/binance-fund-password", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ label: botActiveLabel || "ONZE", fundPassword, token: auth.token })
      });
      const d = await r.json();
      if(!d.ok){ msg.textContent = d.error || "No se pudo guardar"; msg.style.color = "#fb7185"; return; }
      msg.textContent = "✅ Contraseña de fondos guardada"; msg.style.color = "#8df0b2";
      document.getElementById("botSecFundPwdNew").value = "";
      window.botLoadPanelSecurity();
    }catch(e){ msg.textContent = "Error de red"; msg.style.color = "#fb7185"; }
  };

  window.botPanelSavePin = async function(){
    const pin = (document.getElementById("botSecPinNew").value || "").trim();
    const confirmPin = (document.getElementById("botSecPinConfirm").value || "").trim();
    const msg = document.getElementById("botSecPinMsg");
    if(!/^\d{4}$/.test(pin)){ msg.textContent = "La clave debe ser exactamente 4 dígitos"; msg.style.color = "#fb7185"; return; }
    if(pin !== confirmPin){ msg.textContent = "Las claves no coinciden"; msg.style.color = "#fb7185"; return; }
    const auth = await window.botGetSettingsAuthToken(msg);
    if(!auth.ok) return;
    msg.textContent = "Guardando..."; msg.style.color = "#94a3b8";
    try{
      const r = await fetch("/api/security/pin", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ pin, token: auth.token })
      });
      const d = await r.json();
      if(!d.ok){ msg.textContent = d.error || "No se pudo guardar"; msg.style.color = "#fb7185"; return; }
      msg.textContent = "✅ Clave guardada"; msg.style.color = "#8df0b2";
      document.getElementById("botSecPinNew").value = "";
      document.getElementById("botSecPinConfirm").value = "";
      window.botLoadPanelSecurity();
    }catch(e){ msg.textContent = "Error de red"; msg.style.color = "#fb7185"; }
  };

  window.botPanelRegisterFingerprint = async function(){
    const msg = document.getElementById("botSecCredMsg");
    if(!window.SimpleWebAuthnBrowser){ msg.textContent = "Este navegador no soporta huella/Face ID"; msg.style.color = "#fb7185"; return; }
    const auth = await window.botGetSettingsAuthToken(msg);
    if(!auth.ok) return;
    msg.textContent = "Sigue las instrucciones de tu dispositivo..."; msg.style.color = "#94a3b8";
    try{
      const optRes = await fetch("/api/security/webauthn/register-options", { method:"POST", credentials:"include" });
      const optData = await optRes.json();
      if(!optData.ok){ msg.textContent = optData.error || "No se pudo iniciar el registro"; msg.style.color = "#fb7185"; return; }
      const regResp = await window.SimpleWebAuthnBrowser.startRegistration({ optionsJSON: optData.options });
      const deviceLabel = (navigator.userAgentData?.platform || navigator.platform || "Dispositivo");
      const verifyRes = await fetch("/api/security/webauthn/register-verify", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ response: regResp, deviceLabel, token: auth.token })
      });
      const verifyData = await verifyRes.json();
      if(!verifyData.ok){ msg.textContent = verifyData.error || "No se pudo registrar"; msg.style.color = "#fb7185"; return; }
      msg.textContent = "✅ Huella registrada"; msg.style.color = "#8df0b2";
      window.botLoadPanelSecurity();
    }catch(e){
      msg.textContent = (e && e.name === "NotAllowedError") ? "Cancelado" : "Error al registrar";
      msg.style.color = "#fb7185";
    }
  };

  window.botPanelDeleteFingerprint = async function(id){
    if(!(await onzeConfirm("¿Eliminar esta huella registrada?"))) return;
    try{
      await fetch("/api/security/webauthn/credentials", {
        method:"DELETE", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ id })
      });
      window.botLoadPanelSecurity();
    }catch(e){}
  };

  /* ————— Skipo (cotizar/comprar USDT al mayor) ————— */

  let skipoRefreshInterval = null;
  window._skipoLastQuote = null;

  window.skipoStartRefresh = function(){
    window.skipoLoadBalances();
    window.skipoRefreshPrice();
    if(skipoRefreshInterval) return;
    skipoRefreshInterval = setInterval(window.skipoRefreshPrice, 5000);
  };
  window.skipoStopRefresh = function(){
    if(skipoRefreshInterval){ clearInterval(skipoRefreshInterval); skipoRefreshInterval = null; }
    skipoStopPriceCountdown();
  };

  // Cuenta regresiva del precio en pantalla, sincronizada con el refresco
  // real cada 5s — mismo temporizador que usa Skipo de verdad para la
  // validez de sus cotizaciones (confirmado por el usuario). Se reinicia
  // cada vez que el precio se actualiza de verdad, nunca queda
  // desincronizada del refresco real.
  var skipoPriceCountdownInterval = null;
  function skipoStopPriceCountdown(){
    if(skipoPriceCountdownInterval){ clearInterval(skipoPriceCountdownInterval); skipoPriceCountdownInterval = null; }
  }
  function skipoStartPriceCountdown(){
    skipoStopPriceCountdown();
    let secondsLeft = 5;
    const el = document.getElementById("skipoPriceCountdown");
    if(!el) return;
    el.textContent = secondsLeft;
    skipoPriceCountdownInterval = setInterval(function(){
      secondsLeft--;
      if(secondsLeft < 0) secondsLeft = 5;
      el.textContent = secondsLeft;
    }, 1000);
  }

  // Formatea el monto en CLP con puntos de miles mientras se escribe (ej.
  // "1.000.000") — el input es de texto, no numérico, así que se guarda el
  // dígito crudo aparte y se muestra ya formateado.
  window.skipoFormatClpInput = function(el){
    const raw = (el.value || "").replace(/\D/g, "");
    el.value = raw ? Number(raw).toLocaleString("es-CL") : "";
  };
  window.skipoGetClpValue = function(){
    const el = document.getElementById("skipoBuyClp");
    return (el && el.value || "").replace(/\D/g, "");
  };

  window.skipoLoadBalances = async function(){
    try{
      const r = await fetch("/api/admin/skipo/balance", { credentials:"include" });
      const d = await r.json();
      if(!d.ok) return;
      const clp = (d.balances||[]).find(b => b.currency === "CLP");
      const usdt = (d.balances||[]).find(b => b.currency === "USDT");
      const clpEl = document.getElementById("skipoBalanceClp");
      const usdtEl = document.getElementById("skipoBalanceUsdt");
      if(clpEl) clpEl.textContent = clp ? Number(clp.balance).toLocaleString("es-CL") + " CLP" : "—";
      if(usdtEl) usdtEl.textContent = usdt ? Number(usdt.balance).toLocaleString("es-CL", {minimumFractionDigits:2, maximumFractionDigits:2}) + " USDT" : "—";
    }catch(e){}
  };

  // Cotiza un monto de referencia SOLO para mostrar la tasa en la tarjeta —
  // no confirma nada. Cada 5s, igual al temporizador real de Skipo.
  window.skipoRefreshPrice = async function(){
    const rateEl = document.getElementById("skipoCurrentRate");
    const msgEl = document.getElementById("skipoPriceMsg");
    try{
      const r = await fetch("/api/admin/skipo/quote", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ quantity: "100000", qtyCurrencyId: "CLP", side: "BUY" })
      });
      const d = await r.json();
      if(!d.ok){ if(msgEl) msgEl.textContent = d.error || "No se pudo cotizar"; return; }
      if(rateEl) rateEl.textContent = Number(d.quote.rate).toLocaleString("es-CL", {minimumFractionDigits:2, maximumFractionDigits:2}) + " CLP";
      if(msgEl) msgEl.textContent = "";
      skipoStartPriceCountdown();
    }catch(e){
      if(msgEl) msgEl.textContent = "Error de red";
    }
  };

  var skipoQuoteCountdown = null;

  function skipoStopCountdown(){
    if(skipoQuoteCountdown){ clearInterval(skipoQuoteCountdown); skipoQuoteCountdown = null; }
  }

  // Deja el panel inline listo para una nueva compra — ya no hay modal que
  // cerrar, solo se resetea el formulario.
  window.skipoResetBuyForm = function(){
    skipoStopCountdown();
    const clpInput = document.getElementById("skipoBuyClp");
    const quoteBox = document.getElementById("skipoQuoteBox");
    const msg = document.getElementById("skipoBuyMsg");
    const btn = document.getElementById("skipoBuyBtn");
    if(clpInput) clpInput.value = "";
    if(quoteBox) quoteBox.style.display = "none";
    if(msg) msg.textContent = "";
    if(btn) btn.disabled = false;
    window._skipoLastQuote = null;
  };

  // Un solo click: cotiza y confirma de inmediato — pedido explícito del
  // usuario (jul 2026), sin PIN ni huella para este flujo puntual. El
  // temporizador es informativo (misma ventana de validez que muestra la
  // web de Skipo), la confirmación llega antes de que se agote.
  window.skipoBuy = async function(){
    const clp = window.skipoGetClpValue();
    const msg = document.getElementById("skipoBuyMsg");
    const btn = document.getElementById("skipoBuyBtn");
    if(!clp || Number(clp) < 500){ msg.textContent = "Ingresa al menos 500 CLP"; msg.style.color = "#fb7185"; return; }

    btn.disabled = true;
    skipoStopCountdown();
    msg.textContent = "Cotizando..."; msg.style.color = "#94a3b8";
    document.getElementById("skipoQuoteBox").style.display = "none";

    try{
      const qr = await fetch("/api/admin/skipo/quote", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ quantity: clp, qtyCurrencyId: "CLP", side: "BUY" })
      });
      const qd = await qr.json();
      if(!qd.ok){ msg.textContent = qd.error || "No se pudo cotizar"; msg.style.color = "#fb7185"; btn.disabled = false; return; }

      const quote = qd.quote;
      window._skipoLastQuote = quote;
      document.getElementById("skipoQuoteUsdt").textContent = Number(quote.baseQty).toLocaleString("es-CL",{minimumFractionDigits:2,maximumFractionDigits:8}) + " USDT";
      document.getElementById("skipoQuoteRate").textContent = "a " + Number(quote.rate).toLocaleString("es-CL",{minimumFractionDigits:2,maximumFractionDigits:2}) + " CLP/USDT";
      document.getElementById("skipoQuoteBox").style.display = "";

      let secondsLeft = 5;
      const timerEl = document.getElementById("skipoQuoteTimer");
      timerEl.textContent = secondsLeft + "s";
      timerEl.style.color = "#fbbf24";
      skipoQuoteCountdown = setInterval(function(){
        secondsLeft--;
        if(secondsLeft <= 0){ skipoStopCountdown(); timerEl.textContent = "0s"; timerEl.style.color = "#fb7185"; return; }
        timerEl.textContent = secondsLeft + "s";
      }, 1000);

      msg.textContent = "Confirmando compra..."; msg.style.color = "#94a3b8";
      const cr = await fetch("/api/admin/skipo/confirm", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ ordId: quote.ordId })
      });
      const cd = await cr.json();
      skipoStopCountdown();
      if(!cd.ok){ msg.textContent = cd.error || "No se pudo confirmar"; msg.style.color = "#fb7185"; btn.disabled = false; return; }

      msg.textContent = "✅ Compra confirmada"; msg.style.color = "#8df0b2";
      window.skipoLoadBalances();
      setTimeout(window.skipoResetBuyForm, 1500);
    }catch(e){
      skipoStopCountdown();
      msg.textContent = "Error de red"; msg.style.color = "#fb7185"; btn.disabled = false;
    }
  };

  window.botRefreshExchange = botRefreshExchange;

  function escHtml(str){
    if(!str) return "";
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  let botCycleLastRefreshAt = 0;
  // Bug real confirmado en vivo (sep 2026): /api/p2p/cycle/status hace hasta
  // 5 llamadas SEGUIDAS (no en paralelo) a Binance más una consulta de TODOS
  // los ciclos históricos -- y esta función la llamaba cada 1s desde el
  // timer del bot (scheduleBotCycle), sin ningún freno propio, aunque el
  // "Ciclo de Ventas" no necesita esa frescura de subsegundo. Resultado:
  // trabajo pesado corriendo todo el día de fondo, compitiendo con las
  // acciones reales del usuario (por eso "cerrar ciclo"/"ver historial" se
  // sentían lentos) y sumando costo de CPU en Vercel sin necesidad. El
  // parámetro `force` (true por default) deja las llamadas disparadas por
  // una acción real del usuario (cerrar, iniciar, sacar venta, etc.)
  // siempre inmediatas -- solo el tick del timer pasa force=false.
  const BOT_CYCLE_REFRESH_THROTTLE_MS = 12000;
  async function botCycleRefresh(force = true){
    if(!force){
      const now = Date.now();
      if(now - botCycleLastRefreshAt < BOT_CYCLE_REFRESH_THROTTLE_MS) return;
    }
    botCycleLastRefreshAt = Date.now();
    // Bug real confirmado en vivo (jul 2026): esta función se llama cada
    // ~300ms mientras el bot está corriendo (scheduleBotCycle). Si el
    // usuario cambia de pestaña Binance/Bybit justo mientras una de esas
    // llamadas está en vuelo, las respuestas pueden llegar DESORDENADAS --
    // una respuesta VIEJA (ej. de Binance) puede llegar DESPUÉS de una más
    // nueva (ej. de Bybit) y pintar en pantalla los datos de una cuenta
    // etiquetados con el nombre de la OTRA (el ciclo activo de Binance
    // apareciendo bajo el rótulo "Activo · BYBIT"). Se capturan la cuenta y
    // el exchange pedidos en este llamado puntual, y si para cuando la
    // respuesta llega el usuario ya cambió de pestaña, se descarta sin
    // tocar el DOM -- la próxima llamada (unos 300ms después) va a traer los
    // datos correctos de la pestaña actual de todos modos.
    const requestedLabel = botActiveLabel || "ONZE";
    const requestedExchange = botSelectedExchange || "binance";
    const lbl = "?label=" + encodeURIComponent(requestedLabel) + "&exchange=" + encodeURIComponent(requestedExchange);
    try{
      const res = await fetch("/api/p2p/cycle/status" + lbl, { credentials:"include" });
      const data = await res.json();
      if(!data?.ok) return;
      if((botActiveLabel || "ONZE") !== requestedLabel || (botSelectedExchange || "binance") !== requestedExchange) return;
      const cycle = data.active;
      const startBtn = document.getElementById("botCycleStartBtn");
      const addBtn = document.getElementById("botCycleAddSaleBtn");
      const closeBtn = document.getElementById("botCycleCloseBtn");
      const info = document.getElementById("botCycleInfo");
      const labelEl = document.getElementById("botCycleLabel");
      const emptyHint = document.getElementById("botCycleEmptyHint");
      if(cycle){
        startBtn.style.display = "none";
        addBtn.style.display = "";
        closeBtn.style.display = "";
        info.style.display = "block";
        if(emptyHint) emptyHint.style.display = "none";
        // ONZE/ZINPLE solo tiene sentido en Binance -- en Bybit/OKX (cuenta
        // única) mostrar el nombre del exchange en vez del label interno.
        const cycleTag = botSelectedExchange === "binance" ? (cycle.label || "ONZE") : botSelectedExchange.toUpperCase();
        labelEl.textContent = "Activo · " + cycleTag;
        labelEl.style.background = "rgba(0,255,136,.14)";
        labelEl.style.color = "#00ff88";
        const clpLabelEl = document.getElementById("botCycleClpLabel");
        if(clpLabelEl) clpLabelEl.textContent = "CLP " + (botSelectedExchange || "binance").charAt(0).toUpperCase() + (botSelectedExchange || "binance").slice(1);
        document.getElementById("botCycleStartTime").textContent = new Date(cycle.startTime).toLocaleString();
        document.getElementById("botCycleUsdt").textContent = Number(cycle.totalUsdt || 0).toFixed(2);
        document.getElementById("botCycleBinanceClp").textContent = "$" + Math.round(Number(cycle.totalBinanceClp || 0)).toLocaleString();
        document.getElementById("botCycleManualClp").textContent = "$" + Math.round(Number(cycle.totalManualClp || 0)).toLocaleString();
        const totalClpNum = Number(cycle.totalBinanceClp || 0) + Number(cycle.totalManualClp || 0);
        document.getElementById("botCycleTotalClp").textContent = "$" + Math.round(totalClpNum).toLocaleString();
        document.getElementById("botCycleMinClose").textContent = cycle.minCloseBalance ? Number(cycle.minCloseBalance).toFixed(2) + " USDT" : "—";
        window.__botCycleActiveMinClose = cycle.minCloseBalance ? Number(cycle.minCloseBalance) : 0;

        // Ganancia estimada (viene calculada del servidor con el costo de la
        // capacity activa AHORA -- se marca como estimado, no contabilidad exacta).
        const profitEl = document.getElementById("botCycleProfit");
        const profitHintEl = document.getElementById("botCycleProfitHint");
        if(data.profitEstimate != null){
          const p = Number(data.profitEstimate);
          const pUsdt = Number(data.profitEstimateUsdt || 0);
          const sign = p >= 0 ? "+" : "-";
          profitEl.innerHTML = sign + "$" + Math.round(Math.abs(p)).toLocaleString() +
            "<span style='font-size:10px;font-weight:600;color:#94a3b8;margin-left:4px;'>(" + sign + Math.abs(pUsdt).toFixed(2) + " USDT)</span>";
          profitEl.style.color = p >= 0 ? "#34d399" : "#fb7185";
          if(profitHintEl) profitHintEl.textContent = "Estimado con costo actual ($" + Number(data.costPriceUsed).toFixed(2) + "/USDT) -- no es contabilidad exacta por capacity";
        }else{
          profitEl.textContent = "—";
          if(profitHintEl) profitHintEl.textContent = "Sin capacity activa para estimar costo";
        }

        // Producción del bot
        const prod = data.production;
        document.getElementById("botCycleProdUpdates").textContent = prod ? prod.priceUpdates : "—";
        document.getElementById("botCycleProdRate").textContent = prod ? prod.priceUpdatesPerHour.toFixed(1) : "—";
        const orderCountForAvg = Number(cycle.totalUsdt || 0) > 0 ? (data.orders || []).length : 0;
        document.getElementById("botCycleAvgOrder").textContent = orderCountForAvg > 0
          ? "$" + Math.round(totalClpNum / orderCountForAvg).toLocaleString()
          : "—";

        // Chip de "ventas apartadas" (botón "Sacar del ciclo", ago 2026)
        const setAsideChipEl = document.getElementById("botCycleSetAsideChip");
        if(setAsideChipEl){
          const n = Number(data.setAsideCount || 0);
          if(n > 0){
            setAsideChipEl.style.display = "inline-block";
            setAsideChipEl.textContent = "🅿️ " + n + " apartada" + (n === 1 ? "" : "s") + " · $" + Math.round(Number(data.setAsideTotalClp || 0)).toLocaleString();
          }else{
            setAsideChipEl.style.display = "none";
            const listEl2 = document.getElementById("botCycleSetAsideList");
            if(listEl2) listEl2.style.display = "none";
          }
        }

        // Lista de órdenes que van entrando en este ciclo
        const ordersListEl = document.getElementById("botCycleOrdersList");
        if(ordersListEl){
          const orders = data.orders || [];
          if(orders.length){
            ordersListEl.innerHTML = orders.map(o => {
              const t = o.executedAt || o.createTime;
              const tMs = o.executedAt ? new Date(o.executedAt).getTime() : (Number(t) || 0);
              const dateStr = t ? new Date(Number(t) || t).toLocaleString("es-CL", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "—";
              const orderNumber = o.orderNumber || o.orderNo || "";
              const setAsideBtn = orderNumber ? "<button onclick=\"window.botCycleSetAside('" + orderNumber + "', " + (Number(o.amount) || 0) + ", " + Math.round(Number(o.totalPrice) || 0) + ", " + tMs + ")\" title='Sacar del ciclo activo' style='margin-left:8px;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3);color:#fbbf24;border-radius:6px;padding:2px 7px;font-size:10px;cursor:pointer;'>Sacar</button>" : "";
              return "<div style='display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-bottom:1px solid rgba(148,163,184,.08);font-size:11px;'>" +
                "<span style='color:#94a3b8;'>" + dateStr + "</span>" +
                "<span style='color:#e2e8f0;'>" + Number(o.amount || 0).toFixed(2) + " USDT</span>" +
                "<span style='color:#fbbf24;font-weight:700;'>$" + Math.round(Number(o.totalPrice || 0)).toLocaleString() + "</span>" +
                setAsideBtn +
              "</div>";
            }).join("");
          }else{
            ordersListEl.innerHTML = "<div style='color:#64748b;font-size:11px;text-align:center;padding:12px 0;'>Sin órdenes todavía</div>";
          }
        }

        const listEl = document.getElementById("botCycleManualList");
        if(cycle.manualSales?.length){
          listEl.style.display = "block";
          listEl.innerHTML = "<div style='font-weight:700;color:#cbd5e1;margin-bottom:6px;font-size:11px;text-transform:uppercase;letter-spacing:.3px;'>Ventas manuales</div>" +
            cycle.manualSales.map(s =>
              "<div style='display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(148,163,184,.08);'>" +
                "<span>" + escHtml(s.concept) + "</span>" +
                "<span style='display:flex;align-items:center;gap:6px;'>" +
                  "<span style='color:#fbbf24;font-weight:700;'>$" + Math.round(Number(s.amountClp)).toLocaleString() + "</span>" +
                  "<button class=\"icon-btn-sm\" type=\"button\" onclick=\"window.deleteCycleManualSale(" + s.id + ")\" title=\"Borrar esta venta manual\">" +
                    "<svg viewBox=\"0 0 24 24\"><path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/><line x1=\"10\" y1=\"11\" x2=\"10\" y2=\"17\"/><line x1=\"14\" y1=\"11\" x2=\"14\" y2=\"17\"/></svg>" +
                  "</button>" +
                "</span>" +
              "</div>"
            ).join("");
        }else{
          listEl.style.display = "none";
        }
      }else{
        startBtn.style.display = "";
        addBtn.style.display = "none";
        closeBtn.style.display = "none";
        info.style.display = "none";
        if(emptyHint) emptyHint.style.display = "";
        labelEl.textContent = "Inactivo";
        labelEl.style.background = "rgba(148,163,184,.12)";
        labelEl.style.color = "#94a3b8";
        // Bug real confirmado en vivo (sep 2026): esta rama nunca tocaba
        // listEl -- al cerrar un ciclo, sus ventas manuales quedaban
        // visibles en pantalla (del ciclo YA cerrado) hasta que se
        // iniciaba el ciclo siguiente, que recién ahí las limpiaba.
        const listEl2 = document.getElementById("botCycleManualList");
        if(listEl2) listEl2.style.display = "none";
      }
    }catch(e){}
  }

  function botCycleModalShell(id, titleHtml, bodyHtml){
    let modal = document.getElementById(id);
    if(modal) modal.remove();
    modal = document.createElement("div");
    modal.id = id;
    modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px;";
    modal.innerHTML = `
      <div style="background:#0d2137;border:1px solid #2a4a6a;border-radius:16px;padding:24px;max-width:420px;width:90%;">
        <h3 style="color:#00d4ff;margin-bottom:8px;">${titleHtml}</h3>
        ${bodyHtml}
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("mousedown", (e) => { if(e.target === modal) modal.remove(); });
    return modal;
  }

  window.botCycleStart = function(){
    const lbl = botActiveLabel || "ONZE";
    const cuentaTag = botSelectedExchange === "binance" ? lbl : botSelectedExchange.toUpperCase();
    botCycleModalShell("botCycleStartModal", "▶ Iniciar ciclo de ventas", `
      <p style="color:#aaa;font-size:13px;margin-bottom:16px;">
        Cuenta: <strong style="color:#fff;">${escHtml(cuentaTag)}</strong><br>
        Se contarán las ventas P2P y manuales desde este momento hasta que cierres el ciclo.
      </p>
      <label style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">Monto mínimo USDT para auto-cierre</label>
      <p style="color:#64748b;font-size:11px;margin-bottom:8px;">Cuando el saldo del bot baje a este nivel, el ciclo se cerrará solo. Deja 0 para cerrarlo solo al llegar a 0.</p>
      <input id="botCycleStartMinInput" type="text" inputmode="decimal" value="90"
        style="width:100%;box-sizing:border-box;padding:10px;background:#071828;border:1px solid #1a3a5a;border-radius:6px;color:#fff;margin-bottom:8px;">
      <p id="botCycleStartErr" style="color:#fca5a5;font-size:12px;margin-bottom:8px;display:none;"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px;">
        <button onclick="document.getElementById('botCycleStartModal').remove()"
          style="padding:10px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cancelar</button>
        <button onclick="window.botCycleStartConfirm()"
          style="padding:10px 16px;background:#00ff88;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">Iniciar</button>
      </div>
    `);
    setTimeout(() => document.getElementById("botCycleStartMinInput")?.focus(), 50);
  };

  window.botCycleStartConfirm = async function(){
    const lbl = botActiveLabel || "ONZE";
    const errEl = document.getElementById("botCycleStartErr");
    const minClose = parseFloat(document.getElementById("botCycleStartMinInput")?.value || "0") || 0;
    try{
      const res = await fetch("/api/p2p/cycle/start", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ label: lbl, exchange: botSelectedExchange || "binance", minCloseBalance: minClose })
      });
      const data = await res.json();
      if(!data.ok){
        if(errEl){ errEl.textContent = data.error || "Error al iniciar ciclo"; errEl.style.display = "block"; }
        return;
      }
      document.getElementById("botCycleStartModal")?.remove();
      botCycleRefresh();
    }catch(e){
      if(errEl){ errEl.textContent = "Error al iniciar ciclo"; errEl.style.display = "block"; }
    }
  };

  // Pedido explícito del usuario (ago 2026): poder editar el monto mínimo de
  // auto-cierre del ciclo YA ACTIVO en cualquier momento, no solo al
  // iniciarlo -- tanto en la cuenta propia (ONZE) como en la de Hector, cada
  // una con su propio ciclo aislado por tenant.
  window.botCycleEditMinClose = function(){
    const current = Number(window.__botCycleActiveMinClose || 0);
    botCycleModalShell("botCycleEditMinCloseModal", "✏️ Editar auto-cierre", `
      <p style="color:#aaa;font-size:13px;margin-bottom:16px;">
        Cuando el saldo del bot baje a este nivel, el ciclo se cerrará solo.
      </p>
      <label style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">Monto mínimo USDT para auto-cierre</label>
      <input id="botCycleEditMinInput" type="text" inputmode="decimal" value="${current}"
        style="width:100%;box-sizing:border-box;padding:10px;background:#071828;border:1px solid #1a3a5a;border-radius:6px;color:#fff;margin-bottom:8px;">
      <p id="botCycleEditMinErr" style="color:#fca5a5;font-size:12px;margin-bottom:8px;display:none;"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px;">
        <button onclick="document.getElementById('botCycleEditMinCloseModal').remove()"
          style="padding:10px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cancelar</button>
        <button onclick="window.botCycleEditMinCloseConfirm()"
          style="padding:10px 16px;background:#00ff88;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">Guardar</button>
      </div>
    `);
    setTimeout(() => { const el = document.getElementById("botCycleEditMinInput"); el?.focus(); el?.select(); }, 50);
  };

  window.botCycleEditMinCloseConfirm = async function(){
    const lbl = botActiveLabel || "ONZE";
    const errEl = document.getElementById("botCycleEditMinErr");
    const raw = document.getElementById("botCycleEditMinInput")?.value;
    const minClose = parseFloat(raw || "");
    if(raw === "" || isNaN(minClose) || minClose < 0){
      if(errEl){ errEl.textContent = "Ingresa un monto válido (0 o mayor)"; errEl.style.display = "block"; }
      return;
    }
    try{
      const res = await fetch("/api/p2p/cycle/min-close", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ label: lbl, exchange: botSelectedExchange || "binance", minCloseBalance: minClose })
      });
      const data = await res.json();
      if(!data.ok){
        if(errEl){ errEl.textContent = data.error || "Error al guardar"; errEl.style.display = "block"; }
        return;
      }
      document.getElementById("botCycleEditMinCloseModal")?.remove();
      botCycleRefresh();
    }catch(e){
      if(errEl){ errEl.textContent = "Error al guardar"; errEl.style.display = "block"; }
    }
  };

  window.botCycleAddSale = function(){
    botCycleModalShell("botCycleAddSaleModal", "+ Venta manual", `
      <p style="color:#aaa;font-size:13px;margin-bottom:16px;">
        Registra una venta que no pasó por Binance (ej. pago directo a un cliente) dentro del ciclo activo.
      </p>
      <label style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">Concepto</label>
      <input id="botCycleSaleConceptInput" type="text" placeholder="Ej: PayPal - Juan Pérez"
        style="width:100%;box-sizing:border-box;padding:10px;background:#071828;border:1px solid #1a3a5a;border-radius:6px;color:#fff;margin-bottom:12px;">
      <label style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">Monto en CLP</label>
      <input id="botCycleSaleAmountInput" type="text" inputmode="decimal" placeholder="Ej: 150.000" oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g,'.');"
        style="width:100%;box-sizing:border-box;padding:10px;background:#071828;border:1px solid #1a3a5a;border-radius:6px;color:#fff;margin-bottom:8px;">
      <p id="botCycleSaleErr" style="color:#fca5a5;font-size:12px;margin-bottom:8px;display:none;"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px;">
        <button onclick="document.getElementById('botCycleAddSaleModal').remove()"
          style="padding:10px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cancelar</button>
        <button onclick="window.botCycleAddSaleConfirm()"
          style="padding:10px 16px;background:#00ff88;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">Agregar</button>
      </div>
    `);
    setTimeout(() => document.getElementById("botCycleSaleConceptInput")?.focus(), 50);
  };

  window.botCycleAddSaleConfirm = async function(){
    const errEl = document.getElementById("botCycleSaleErr");
    const showErr = (msg) => { if(errEl){ errEl.textContent = msg; errEl.style.display = "block"; } };
    const concept = (document.getElementById("botCycleSaleConceptInput")?.value || "").trim();
    const amountClp = Number((document.getElementById("botCycleSaleAmountInput")?.value || "").replace(/[^0-9]/g, ""));
    if(!concept){ showErr("Ingresa un concepto"); return; }
    if(!amountClp || amountClp <= 0){ showErr("Ingresa un monto válido"); return; }
    try{
      const res = await fetch("/api/p2p/cycle/status?label=" + encodeURIComponent(botActiveLabel || "ONZE") + "&exchange=" + encodeURIComponent(botSelectedExchange || "binance"), { credentials:"include" });
      const status = await res.json();
      if(!status?.ok || !status?.active){ showErr("No hay ciclo activo"); return; }
      const addRes = await fetch("/api/p2p/cycle/manual-sale", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ cycleId: status.active.id, concept, amountClp })
      });
      const addData = await addRes.json();
      if(!addData.ok){ showErr(addData.error || "Error al agregar venta manual"); return; }
      document.getElementById("botCycleAddSaleModal")?.remove();
      botCycleRefresh();
    }catch(e){ showErr("Error al agregar venta manual"); }
  };

  window.botCycleClose = async function(){
    const lbl = botActiveLabel || "ONZE";
    let preview = null;
    try{
      const res = await fetch("/api/p2p/cycle/status?label=" + encodeURIComponent(lbl) + "&exchange=" + encodeURIComponent(botSelectedExchange || "binance"), { credentials:"include" });
      const status = await res.json();
      preview = status?.active || null;
    }catch(e){}
    const totalUsdt = preview ? Number(preview.totalUsdt || 0).toFixed(2) : "—";
    const totalClp = preview ? Math.round(Number(preview.totalBinanceClp || 0) + Number(preview.totalManualClp || 0)).toLocaleString() : "—";
    botCycleModalShell("botCycleCloseModal", "■ Cerrar ciclo de ventas", `
      <p style="color:#aaa;font-size:13px;margin-bottom:16px;">
        Se calcularán los totales finales de este ciclo y quedará archivado.
      </p>
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <div class="bot-cycle-tile" style="flex:1;"><div class="bot-cycle-tile-label">USDT vendidos</div><div class="bot-cycle-tile-value">${totalUsdt}</div></div>
        <div class="bot-cycle-tile" style="flex:1;border-color:rgba(0,212,255,.25);"><div class="bot-cycle-tile-label">Total CLP</div><div class="bot-cycle-tile-value" style="color:#00d4ff;">$${totalClp}</div></div>
      </div>
      <p id="botCycleCloseErr" style="color:#fca5a5;font-size:12px;margin-bottom:8px;display:none;"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('botCycleCloseModal').remove()"
          style="padding:10px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cancelar</button>
        <button onclick="window.botCycleCloseConfirm()"
          style="padding:10px 16px;background:rgba(239,68,68,.85);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">Cerrar ciclo</button>
      </div>
    `);
  };

  window.botCycleCloseConfirm = async function(){
    const errEl = document.getElementById("botCycleCloseErr");
    try{
      const res = await fetch("/api/p2p/cycle/close", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ label: botActiveLabel || "ONZE", exchange: botSelectedExchange || "binance" })
      });
      const data = await res.json();
      if(!data.ok){
        if(errEl){ errEl.textContent = data.error || "Error al cerrar ciclo"; errEl.style.display = "block"; }
        return;
      }
      document.getElementById("botCycleCloseModal")?.remove();
      window.botCycleShowCloseResult(data.cycle);
      botCycleRefresh();
    }catch(e){
      if(errEl){ errEl.textContent = "Error al cerrar ciclo"; errEl.style.display = "block"; }
    }
  };

  function botCycleOrderRow(label, orderNumber, clp){
    if(!orderNumber) return `<div class="bot-cycle-tile" style="flex:1;"><div class="bot-cycle-tile-label">${label}</div><div class="bot-cycle-tile-value" style="font-size:12px;color:#64748b;">Sin órdenes</div></div>`;
    return `<div class="bot-cycle-tile" style="flex:1;">
      <div class="bot-cycle-tile-label">${label}</div>
      <div class="bot-cycle-tile-value" style="font-size:12px;">#${escHtml(String(orderNumber))}</div>
      <div style="font-size:12px;color:#fbbf24;font-weight:700;margin-top:2px;">$${Math.round(Number(clp || 0)).toLocaleString()}</div>
    </div>`;
  }

  window.botCycleShowCloseResult = function(cycle){
    const totalUsdt = Number(cycle.totalUsdt || 0).toFixed(2);
    const totalClp = Math.round(Number(cycle.totalBinanceClp || 0) + Number(cycle.totalManualClp || 0)).toLocaleString();
    botCycleModalShell("botCycleResultModal", "✅ Ciclo cerrado", `
      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <div class="bot-cycle-tile" style="flex:1;"><div class="bot-cycle-tile-label">USDT vendidos</div><div class="bot-cycle-tile-value">${totalUsdt}</div></div>
        <div class="bot-cycle-tile" style="flex:1;border-color:rgba(0,212,255,.25);"><div class="bot-cycle-tile-label">Total CLP</div><div class="bot-cycle-tile-value" style="color:#00d4ff;">$${totalClp}</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        ${botCycleOrderRow("Primera orden", cycle.firstOrderNumber, cycle.firstOrderClp)}
        ${botCycleOrderRow("Última orden", cycle.lastOrderNumber, cycle.lastOrderClp)}
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button onclick="document.getElementById('botCycleResultModal').remove()"
          style="padding:10px 16px;background:#00ff88;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">Cerrar</button>
      </div>
    `);
  };

  let botCycleHistoryCache = [];

  window.botCycleShowHistory = async function(){
    const lbl = botActiveLabel || "ONZE";
    let cycles = [];
    try{
      const res = await fetch("/api/p2p/cycle/status?historyOnly=1&label=" + encodeURIComponent(lbl) + "&exchange=" + encodeURIComponent(botSelectedExchange || "binance"), { credentials:"include" });
      const data = await res.json();
      cycles = data?.recent || [];
    }catch(e){}
    botCycleHistoryCache = cycles;
    const exLabel = (botSelectedExchange || "binance").charAt(0).toUpperCase() + (botSelectedExchange || "binance").slice(1);
    const rows = cycles.length ? cycles.map(c => {
      const totalClp = Math.round(Number(c.totalBinanceClp || 0) + Number(c.totalManualClp || 0)).toLocaleString();
      const binanceClp = Math.round(Number(c.totalBinanceClp || 0)).toLocaleString();
      const manualClp = Math.round(Number(c.totalManualClp || 0)).toLocaleString();
      const dateFmt = (d) => d ? new Date(d).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" }) : "—";
      const timeFmt = (d) => d ? new Date(d).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : "—";
      const sameDay = c.startTime && c.endTime && dateFmt(c.startTime) === dateFmt(c.endTime);
      const dateRangeLabel = sameDay
        ? `${dateFmt(c.startTime)} · ${timeFmt(c.startTime)} → ${timeFmt(c.endTime)}`
        : `${dateFmt(c.startTime)} ${timeFmt(c.startTime)} → ${dateFmt(c.endTime)} ${timeFmt(c.endTime)}`;
      return `<div style="background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.1);border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;">
          <div>
            <div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Ciclo #${c.displayNumber ?? c.id}</div>
            <div style="font-size:12px;color:#cbd5e1;margin-top:2px;">${dateRangeLabel}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button onclick="window.botCycleShowDetail(${c.id})" title="Ver detalle completo"
              style="padding:5px 9px;background:rgba(0,212,255,.14);border:1px solid rgba(0,212,255,.3);color:#5fd4ff;border-radius:6px;cursor:pointer;font-size:12px;">👁</button>
            <button onclick="window.botCycleDelete(${c.id})" title="Eliminar este ciclo"
              style="padding:5px 9px;background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.3);color:#fca5a5;border-radius:6px;cursor:pointer;font-size:12px;">🗑</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:6px;margin-bottom:10px;">
          <div class="bot-cycle-tile" style="padding:7px 10px;"><div class="bot-cycle-tile-label">USDT</div><div class="bot-cycle-tile-value" style="font-size:13px;">${Number(c.totalUsdt || 0).toFixed(2)}</div></div>
          <div class="bot-cycle-tile" style="padding:7px 10px;"><div class="bot-cycle-tile-label">CLP ${exLabel}</div><div class="bot-cycle-tile-value" style="font-size:13px;">$${binanceClp}</div></div>
          <div class="bot-cycle-tile" style="padding:7px 10px;"><div class="bot-cycle-tile-label">CLP Manual</div><div class="bot-cycle-tile-value" style="font-size:13px;">$${manualClp}</div></div>
          <div class="bot-cycle-tile" style="padding:7px 10px;border-color:rgba(0,212,255,.25);"><div class="bot-cycle-tile-label">Total CLP</div><div class="bot-cycle-tile-value" style="font-size:13px;color:#00d4ff;">$${totalClp}</div></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;border-top:1px solid rgba(148,163,184,.08);padding-top:8px;">
          <span>Primera: <strong style="color:#94a3b8;">#${escHtml(String(c.firstOrderNumber || "—"))}</strong></span>
          <span>Última: <strong style="color:#94a3b8;">#${escHtml(String(c.lastOrderNumber || "—"))}</strong></span>
        </div>
      </div>`;
    }).join("") : `<p style="color:#64748b;font-size:13px;">Todavía no hay ciclos cerrados para ${escHtml(botSelectedExchange === "binance" ? lbl : exLabel)}.</p>`;
    botCycleModalShell("botCycleHistoryModal", "📜 Historial de ciclos", `
      <div style="max-height:440px;overflow-y:auto;margin-bottom:16px;">${rows}</div>
      <div style="display:flex;justify-content:space-between;">
        ${cycles.length ? `<button onclick="window.botCycleDeleteAll()"
          style="padding:10px 16px;background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.3);color:#fca5a5;border-radius:6px;cursor:pointer;font-weight:700;">Vaciar historial</button>` : `<span></span>`}
        <button onclick="document.getElementById('botCycleHistoryModal').remove()"
          style="padding:10px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
      </div>
    `);
  };

  window.botCycleShowDetail = async function(id){
    const c = botCycleHistoryCache.find(x => x.id === id);
    if(!c){ onzeAlert("No se encontró el detalle de este ciclo."); return; }
    const totalClp = Math.round(Number(c.totalBinanceClp || 0) + Number(c.totalManualClp || 0));
    const start = c.startTime ? new Date(c.startTime).toLocaleString() : "—";
    const end = c.endTime ? new Date(c.endTime).toLocaleString() : "—";
    const durationMs = (c.startTime && c.endTime) ? (new Date(c.endTime) - new Date(c.startTime)) : null;
    const durationLabel = durationMs != null ? formatDurationMs(durationMs) : "—";
    const manualSales = c.manualSales || [];
    const manualRows = manualSales.length ? manualSales.map(s => `
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(148,163,184,.08);font-size:12px;">
        <span>${escHtml(s.concept)}</span>
        <span style="color:#fbbf24;font-weight:700;">$${Math.round(Number(s.amountClp)).toLocaleString()}</span>
      </div>`).join("") : `<p style="color:#64748b;font-size:12px;">Sin ventas manuales en este ciclo.</p>`;
    const cuentaTag = botSelectedExchange === "binance" ? (c.label || "ONZE") : botSelectedExchange.toUpperCase();
    const exLabelDetail = (botSelectedExchange || "binance").charAt(0).toUpperCase() + (botSelectedExchange || "binance").slice(1);
    botCycleModalShell("botCycleDetailModal", `📋 Detalle del ciclo #${c.displayNumber ?? c.id}`, `
      <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:14px;font-size:12px;color:#94a3b8;">
        <div><strong style="color:#e2e8f0;">Cuenta:</strong> ${escHtml(cuentaTag)}</div>
        <div><strong style="color:#e2e8f0;">Inicio:</strong> ${start}</div>
        <div><strong style="color:#e2e8f0;">Fin:</strong> ${end}</div>
        <div><strong style="color:#e2e8f0;">Duración:</strong> ${durationLabel}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
        <div class="bot-cycle-tile"><div class="bot-cycle-tile-label">USDT vendidos</div><div class="bot-cycle-tile-value">${Number(c.totalUsdt || 0).toFixed(2)}</div></div>
        <div class="bot-cycle-tile" style="border-color:rgba(0,212,255,.25);"><div class="bot-cycle-tile-label">Total CLP</div><div class="bot-cycle-tile-value" style="color:#00d4ff;">$${totalClp.toLocaleString()}</div></div>
        <div class="bot-cycle-tile"><div class="bot-cycle-tile-label">CLP ${exLabelDetail}</div><div class="bot-cycle-tile-value">$${Math.round(Number(c.totalBinanceClp || 0)).toLocaleString()}</div></div>
        <div class="bot-cycle-tile"><div class="bot-cycle-tile-label">CLP manual</div><div class="bot-cycle-tile-value">$${Math.round(Number(c.totalManualClp || 0)).toLocaleString()}</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        ${botCycleOrderRow("Primera orden", c.firstOrderNumber, c.firstOrderClp)}
        ${botCycleOrderRow("Última orden", c.lastOrderNumber, c.lastOrderClp)}
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-weight:700;color:#cbd5e1;margin-bottom:6px;font-size:11px;text-transform:uppercase;letter-spacing:.3px;">Ventas manuales (${manualSales.length})</div>
        <div style="max-height:150px;overflow-y:auto;">${manualRows}</div>
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-weight:700;color:#cbd5e1;margin-bottom:6px;font-size:11px;text-transform:uppercase;letter-spacing:.3px;">Órdenes del ciclo</div>
        <div id="botCycleOrdersList" style="max-height:220px;overflow-y:auto;">
          <p style="color:#64748b;font-size:12px;">Cargando órdenes...</p>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button onclick="document.getElementById('botCycleDetailModal').remove()"
          style="padding:10px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
      </div>
    `);

    // Las órdenes reales del ciclo NUNCA se guardaron en la base de datos
    // (P2PCycle solo tiene totales + primera/última orden) -- se recalculan
    // en vivo pidiéndolas a este endpoint nuevo, igual que ya se hace para
    // el ciclo activo. Se carga aparte (no bloquea la apertura del modal)
    // porque puede tardar unos segundos en paginar el historial de Binance.
    try {
      // Timeout de seguridad -- caso real (ago 2026): sin esto, si la
      // petición se demoraba de más (navegador ocupado con el polling del
      // bot cada ~300ms, o Binance lento) el modal se quedaba en "Cargando
      // órdenes..." para siempre, sin ningún error ni forma de reintentar.
      const abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => abortCtrl.abort(), 15000);
      let ordersRes;
      try {
        ordersRes = await fetch("/api/p2p/cycle/orders?id=" + encodeURIComponent(id), { credentials: "include", signal: abortCtrl.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      const ordersData = await ordersRes.json();
      const listEl = document.getElementById("botCycleOrdersList");
      if (!listEl) return; // el usuario ya cerró el modal
      if (!ordersData?.ok) {
        listEl.innerHTML = `<p style="color:#f87171;font-size:12px;">No se pudo cargar la lista de órdenes.</p>`;
        return;
      }
      const orders = ordersData.orders || [];
      if (!orders.length) {
        listEl.innerHTML = `<p style="color:#64748b;font-size:12px;">Sin órdenes registradas en este ciclo.</p>`;
        return;
      }
      listEl.innerHTML = orders.map(o => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(148,163,184,.08);font-size:12px;">
          <div>
            <div style="color:#e2e8f0;font-family:monospace;">${escHtml(String(o.orderNumber || "—"))}</div>
            <div style="color:#64748b;font-size:10px;">${o.createTime ? new Date(o.createTime).toLocaleString() : "—"}</div>
          </div>
          <div style="text-align:right;">
            <div style="color:#00d4ff;font-weight:700;">$${Math.round(Number(o.totalPrice) || 0).toLocaleString()}</div>
            <div style="color:#94a3b8;font-size:10px;">${Number(o.amount || 0).toFixed(2)} USDT</div>
          </div>
        </div>`).join("");
    } catch (e) {
      const listEl = document.getElementById("botCycleOrdersList");
      if (listEl) listEl.innerHTML = `<p style="color:#f87171;font-size:12px;">No se pudo cargar la lista de órdenes.</p>`;
    }
  };

  function formatDurationMs(ms){
    if(!Number.isFinite(ms) || ms < 0) return "—";
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if(h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  }

  window.botCycleDelete = async function(id){
    if(!(await onzeConfirm("¿Eliminar este ciclo del historial? No se puede deshacer."))) return;
    try{
      const res = await fetch("/api/p2p/cycle/delete", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if(!data.ok){ onzeAlert(data.error || "No se pudo eliminar"); return; }
      window.botCycleShowHistory();
    }catch(e){ onzeAlert("Error al eliminar"); }
  };

  window.botCycleDeleteAll = async function(){
    const lbl = botActiveLabel || "ONZE";
    if(!(await onzeConfirm(`¿Vaciar TODO el historial de ciclos cerrados de ${lbl}? No se puede deshacer.`))) return;
    try{
      const res = await fetch("/api/p2p/cycle/delete", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ all: true, label: lbl, exchange: botSelectedExchange || "binance" })
      });
      const data = await res.json();
      if(!data.ok){ onzeAlert(data.error || "No se pudo vaciar"); return; }
      window.botCycleShowHistory();
    }catch(e){ onzeAlert("Error al vaciar historial"); }
  };

  // Botón "Sacar del ciclo" (ago 2026): saca una venta puntual del ciclo
  // activo, queda apartada sin contar en ningún ciclo hasta que se inicie el
  // próximo (ver /api/p2p/cycle/set-aside y start/route.ts).
  window.botCycleSetAside = async function(orderNumber, amount, totalPrice, createTime){
    if(!(await onzeConfirm("¿Sacar esta venta del ciclo activo? Queda apartada hasta que inicies el próximo ciclo."))) return;
    try{
      const res = await fetch("/api/p2p/cycle/set-aside", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, amount, totalPrice, createTime, label: botActiveLabel || "ONZE", exchange: botSelectedExchange || "binance" }),
      });
      const data = await res.json();
      if(!data.ok){ onzeAlert(data.error || "No se pudo sacar la venta"); return; }
      botCycleRefresh();
    }catch(e){ onzeAlert("Error al sacar la venta"); }
  };

  window.botCycleToggleSetAsideList = function(){
    const el = document.getElementById("botCycleSetAsideList");
    if(!el) return;
    if(el.style.display === "none"){
      el.style.display = "block";
      window.botCycleLoadSetAsideList();
    }else{
      el.style.display = "none";
    }
  };

  window.botCycleLoadSetAsideList = async function(){
    const el = document.getElementById("botCycleSetAsideList");
    if(!el) return;
    el.innerHTML = "<div style='padding:8px;font-size:11px;color:#94a3b8;'>Cargando...</div>";
    try{
      const lbl = botActiveLabel || "ONZE";
      const ex = botSelectedExchange || "binance";
      const res = await fetch("/api/p2p/cycle/set-aside?label=" + encodeURIComponent(lbl) + "&exchange=" + encodeURIComponent(ex), { credentials: "include" });
      const data = await res.json();
      const orders = data?.orders || [];
      if(!orders.length){
        el.innerHTML = "<div style='padding:8px;font-size:11px;color:#94a3b8;'>Sin ventas apartadas.</div>";
        return;
      }
      el.innerHTML = orders.map(o => {
        const dateStr = o.createTime ? new Date(o.createTime).toLocaleString("es-CL", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "—";
        return "<div style='display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-bottom:1px solid rgba(251,191,36,.12);font-size:11px;'>" +
          "<span style='color:#94a3b8;'>" + dateStr + "</span>" +
          "<span style='color:#e2e8f0;'>" + Number(o.amount || 0).toFixed(2) + " USDT</span>" +
          "<span style='color:#fbbf24;font-weight:700;'>$" + Math.round(Number(o.totalPrice || 0)).toLocaleString() + "</span>" +
          "<span style='display:flex;gap:5px;'>" +
          "<button onclick=\"window.botCycleReturnSetAside(" + o.id + ")\" title='Devolver al ciclo activo' style='background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.3);color:#93c5fd;border-radius:6px;padding:2px 7px;font-size:10px;cursor:pointer;'>Devolver</button>" +
          "<button onclick=\"window.botCycleDiscardSetAside(" + o.id + ")\" title='Eliminar (no la reclama ningún ciclo)' style='background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#fca5a5;border-radius:6px;padding:2px 7px;font-size:10px;cursor:pointer;'>🗑️</button>" +
          "</span>" +
        "</div>";
      }).join("");
    }catch(e){
      el.innerHTML = "<div style='padding:8px;font-size:11px;color:#f87171;'>Error al cargar.</div>";
    }
  };

  window.botCycleReturnSetAside = async function(id){
    try{
      await fetch("/api/p2p/cycle/set-aside?id=" + id, { method: "DELETE", credentials: "include" });
      window.botCycleLoadSetAsideList();
      botCycleRefresh();
    }catch(e){ onzeAlert("Error al devolver la venta"); }
  };

  window.botCycleDiscardSetAside = async function(id){
    if(!(await onzeConfirm("¿Eliminar esta venta apartada? No se sumará a este ciclo ni al próximo -- no se puede deshacer."))) return;
    try{
      await fetch("/api/p2p/cycle/set-aside?id=" + id + "&mode=discard", { method: "DELETE", credentials: "include" });
      window.botCycleLoadSetAsideList();
      botCycleRefresh();
    }catch(e){ onzeAlert("Error al eliminar la venta"); }
  };

  function initP2PBot(){
    try{ console.log("[P2P Bot] init started"); }catch(e){}

    addP2PBotStyles();
    buildP2PBotView();
    // Corrige el botón ONZE/ZINPLE que aparece resaltado por defecto en el HTML
    // (venía "active" hardcodeado en el template) — recién ahora existen los
    // botones en el DOM, por eso este ajuste no puede ir antes de esta línea.
    // Sin esto, el botón ONZE se ve seleccionado aunque en realidad se esté
    // mostrando la cuenta ZINPLE (que sí puede estar corriendo), y parece que
    // "ONZE está ejecutando" cuando en verdad son datos de ZINPLE.
    document.querySelectorAll(".bot-acct-btn").forEach(function(b){
      b.classList.toggle("active", b.getAttribute("data-label") === botActiveLabel);
    });
    addP2PBotNavButton();
    setTimeout(function(){ window.botSelectExchange('binance'); }, 100);
    setTimeout(window.botRefreshExchange, 500);
    setTimeout(botCycleRefresh, 800);
    setTimeout(function(){
      var chatCb = document.getElementById("botChatBotEnabled");
      var initEntry = getBotCycleEntry(botActiveLabel || "ONZE");
      if(chatCb?.checked && !initEntry.timer && !initEntry.chatTimer) botStartChatCycle();
    }, 1500);
    setTimeout(botInitSound, 1000);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", ()=>{
      setTimeout(initP2PBot, 500);
    });
  }else{
    setTimeout(initP2PBot, 500);
  }
})();
