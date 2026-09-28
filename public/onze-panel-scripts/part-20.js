// Escaparates animados (sep 2026) -- fondo de red de nodos reutilizable.
// Nació para la pantalla de Inicio ("que impacte y refleje lo que hace
// ONZE") y se generalizó para poder reusarlo también detrás de la lista de
// Anuncios (pedido explícito: "el fondo de los anuncios quiero que se vean
// como el fondo que hiciste en la pantalla de inicio"). Puramente
// visual/decorativo -- no toca ningún dato real, no llama a ninguna API, y
// no depende de nada del resto del panel: si este archivo fallara por
// completo, el resto de la web sigue funcionando exactamente igual (todo el
// código corre con chequeos de existencia de elementos).
(function () {
  "use strict";

  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var dpr = Math.max(1, window.devicePixelRatio || 1);

  // Crea un fondo de red animada independiente para el <canvas> con el id
  // dado. `isActiveFn` decide si le toca correr en cada sync (cada instancia
  // tiene su propio criterio: Inicio mira su .view.active, Anuncios mira si
  // el modal + esa pestaña están realmente visibles).
  function createNetworkBackground(canvasId, opts) {
    opts = opts || {};
    var nodeCount = opts.nodeCount || 32;
    var linkDist = opts.linkDist || 175;

    var canvas = null, ctx = null, rafId = null;
    var nodes = [], pulses = [];
    var canvasW = 0, canvasH = 0;

    function initNodes() {
      nodes = [];
      for (var i = 0; i < nodeCount; i++) {
        nodes.push({
          x: Math.random() * canvasW,
          y: Math.random() * canvasH,
          vx: (Math.random() - 0.5) * 0.32,
          vy: (Math.random() - 0.5) * 0.32,
          r: 1.6 + Math.random() * 1.8,
        });
      }
    }

    function resizeCanvas() {
      if (!canvas) return;
      var rect = canvas.parentElement.getBoundingClientRect();
      canvasW = Math.max(1, rect.width);
      canvasH = Math.max(1, rect.height);
      canvas.width = Math.round(canvasW * dpr);
      canvas.height = Math.round(canvasH * dpr);
      canvas.style.width = canvasW + "px";
      canvas.style.height = canvasH + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initNodes();
    }

    function maybeSpawnPulse() {
      if (Math.random() > 0.045 || nodes.length < 2 || pulses.length >= 6) return;
      var a = nodes[Math.floor(Math.random() * nodes.length)];
      var candidates = [];
      for (var i = 0; i < nodes.length; i++) {
        var b = nodes[i];
        if (b === a) continue;
        var dx = a.x - b.x, dy = a.y - b.y;
        if (Math.sqrt(dx * dx + dy * dy) < linkDist) candidates.push(b);
      }
      if (!candidates.length) return;
      pulses.push({ a: a, b: candidates[Math.floor(Math.random() * candidates.length)], t: 0 });
    }

    function drawLinksAndNodes() {
      for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
          var a = nodes[i], b = nodes[j];
          var dx = a.x - b.x, dy = a.y - b.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < linkDist) {
            var alpha = (1 - dist / linkDist) * 0.5;
            ctx.strokeStyle = "rgba(94,208,255," + alpha.toFixed(3) + ")";
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        ctx.beginPath();
        ctx.fillStyle = "rgba(125,211,252,.55)";
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawFrame() {
      ctx.clearRect(0, 0, canvasW, canvasH);

      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > canvasW) n.vx *= -1;
        if (n.y < 0 || n.y > canvasH) n.vy *= -1;
      }

      drawLinksAndNodes();

      maybeSpawnPulse();
      for (var i = pulses.length - 1; i >= 0; i--) {
        var p = pulses[i];
        p.t += 0.02;
        if (p.t >= 1) { pulses.splice(i, 1); continue; }
        var x = p.a.x + (p.b.x - p.a.x) * p.t;
        var y = p.a.y + (p.b.y - p.a.y) * p.t;
        ctx.beginPath();
        ctx.fillStyle = "rgba(52,211,153,.9)";
        ctx.shadowColor = "rgba(52,211,153,.8)";
        ctx.shadowBlur = 8;
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      rafId = requestAnimationFrame(drawFrame);
    }

    function start() {
      if (!canvas) {
        canvas = document.getElementById(canvasId);
        if (!canvas) return;
        ctx = canvas.getContext("2d");
      }
      if (rafId) return; // ya corriendo
      resizeCanvas();
      if (reduceMotion) {
        drawLinksAndNodes();
        return;
      }
      rafId = requestAnimationFrame(drawFrame);
    }

    function stop() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }

    return {
      sync: function (active) { if (active) start(); else stop(); },
      resize: function (active) { if (active) resizeCanvas(); },
    };
  }

  // ── Inicio ──
  // Subido de 16 a 32 nodos y de 130 a 175px de distancia de enlace (pedido
  // explícito del usuario, sep 2026: "que se vean más líneas así
  // moviéndose") -- más nodos + más alcance = red visualmente más densa.
  var heroNet = createNetworkBackground("onzeHeroCanvas", { nodeCount: 32, linkDist: 175 });

  function isInicioActive() {
    var view = document.getElementById("view-inicio");
    return !!(view && view.classList.contains("active") && document.visibilityState === "visible");
  }

  function syncHero() { heroNet.sync(isInicioActive()); }

  function initHeroObserver() {
    var view = document.getElementById("view-inicio");
    if (!view) { setTimeout(initHeroObserver, 300); return; }
    new MutationObserver(syncHero).observe(view, { attributes: true, attributeFilter: ["class"] });
    syncHero();
  }

  // ── Anuncios (vista grande "P2P Bot", NO el modal chico) -- pedido
  //    explícito del usuario, sep 2026: "el fondo de los anuncios... es en
  //    los anuncios de afuera los que tiene su propia configuración"
  //    (primer intento lo puso por error dentro del modal). Contenedor más
  //    chico que el hero de Inicio, por eso una red algo menos densa (24
  //    nodos / 150px). Solo corre mientras la vista "P2P Bot" esté activa Y
  //    la sección de Anuncios no esté oculta (se oculta con display:none
  //    cuando el exchange elegido es Bybit, que usa su propia sección
  //    aparte) -- mismo criterio de "no gastar CPU de fondo sin necesidad"
  //    que Inicio. ──
  var adsNet = createNetworkBackground("onzeAdsCanvas", { nodeCount: 24, linkDist: 150 });

  function isVisible(el) {
    return !!(el && el.offsetWidth > 0 && el.offsetHeight > 0);
  }

  function isAdsActive() {
    return !!(isVisible(document.getElementById("botAdsSection")) && document.visibilityState === "visible");
  }

  function syncAds() { adsNet.sync(isAdsActive()); }

  function initAdsObserver() {
    var view = document.getElementById("view-p2p-bot");
    var section = document.getElementById("botAdsSection");
    if (!view || !section) { setTimeout(initAdsObserver, 300); return; }
    // La vista "P2P Bot" cambia con classList (.view.active, igual que
    // Inicio), pero la sección de Anuncios en sí se oculta con su propio
    // style.display cuando el exchange es Bybit -- se observan los dos.
    var obs = new MutationObserver(syncAds);
    obs.observe(view, { attributes: true, attributeFilter: ["class"] });
    obs.observe(section, { attributes: true, attributeFilter: ["style"] });
    syncAds();
  }

  document.addEventListener("visibilitychange", function () {
    syncHero();
    syncAds();
  });
  window.addEventListener("resize", function () {
    heroNet.resize(isInicioActive());
    adsNet.resize(isAdsActive());
  });

  // ── Inclinación 3D de las tarjetas rápidas (Inicio) ──
  function initTilt() {
    if (reduceMotion) return;
    var cards = document.querySelectorAll("#view-inicio .quick-card-tilt");
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        card.addEventListener("mousemove", function (e) {
          var rect = card.getBoundingClientRect();
          var px = (e.clientX - rect.left) / rect.width - 0.5;
          var py = (e.clientY - rect.top) / rect.height - 0.5;
          var maxTilt = 8;
          card.style.transform = "rotateX(" + (-py * maxTilt).toFixed(2) + "deg) rotateY(" + (px * maxTilt).toFixed(2) + "deg)";
        });
        card.addEventListener("mouseleave", function () {
          card.style.transform = "rotateX(0deg) rotateY(0deg)";
        });
      })(cards[i]);
    }
  }

  // ── Brillo que sigue al mouse dentro del hero (pedido explícito: "más
  //    producción", sep 2026) -- reacciona a la posición real del cursor,
  //    no es una animación automática, así que no depende de reduceMotion. ──
  function initSpotlight() {
    var hero = document.getElementById("onzeHero");
    if (!hero) return;
    hero.addEventListener("mousemove", function (e) {
      var rect = hero.getBoundingClientRect();
      var mx = ((e.clientX - rect.left) / rect.width) * 100;
      var my = ((e.clientY - rect.top) / rect.height) * 100;
      hero.style.setProperty("--onze-mx", mx.toFixed(1) + "%");
      hero.style.setProperty("--onze-my", my.toFixed(1) + "%");
    });
  }

  function init() {
    initHeroObserver();
    initAdsObserver();
    initTilt();
    initSpotlight();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
