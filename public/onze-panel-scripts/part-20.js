// Inicio: escaparate animado (sep 2026) -- pedido explícito del usuario para
// que la pantalla de bienvenida "impacte" y refleje lo que hace ONZE (bot P2P,
// USDT, operaciones en tiempo real). Puramente visual/decorativo -- no toca
// ningún dato real, no llama a ninguna API, y no depende de nada del resto
// del panel: si este archivo fallara por completo, el resto de la web sigue
// funcionando exactamente igual (todo el código corre dentro de un solo
// try/catch implícito por función, con chequeos de existencia de elementos).
(function () {
  "use strict";

  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ── Red animada de fondo del hero ──
  var canvas = null, ctx = null, rafId = null;
  var nodes = [], pulses = [];
  var canvasW = 0, canvasH = 0;
  var dpr = Math.max(1, window.devicePixelRatio || 1);
  var NODE_COUNT = 16;
  var LINK_DIST = 130;

  function initNodes() {
    nodes = [];
    for (var i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * canvasW,
        y: Math.random() * canvasH,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: 1.6 + Math.random() * 1.6,
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
    if (Math.random() > 0.02 || nodes.length < 2) return;
    var a = nodes[Math.floor(Math.random() * nodes.length)];
    var candidates = [];
    for (var i = 0; i < nodes.length; i++) {
      var b = nodes[i];
      if (b === a) continue;
      var dx = a.x - b.x, dy = a.y - b.y;
      if (Math.sqrt(dx * dx + dy * dy) < LINK_DIST) candidates.push(b);
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
        if (dist < LINK_DIST) {
          var alpha = (1 - dist / LINK_DIST) * 0.35;
          ctx.strokeStyle = "rgba(56,189,248," + alpha.toFixed(3) + ")";
          ctx.lineWidth = 1;
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

  function startCanvas() {
    if (!canvas) {
      canvas = document.getElementById("onzeHeroCanvas");
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

  function stopCanvas() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // Solo corre mientras la vista Inicio esté visible Y la pestaña del
  // navegador esté activa -- mismo criterio ya usado varias veces esta
  // sesión para no gastar CPU/batería de fondo sin necesidad.
  function isInicioActive() {
    var view = document.getElementById("view-inicio");
    return !!(view && view.classList.contains("active") && document.visibilityState === "visible");
  }

  function syncCanvasState() {
    if (isInicioActive()) startCanvas();
    else stopCanvas();
  }

  document.addEventListener("visibilitychange", syncCanvasState);
  window.addEventListener("resize", function () {
    if (isInicioActive()) resizeCanvas();
  });

  function initCanvasObserver() {
    var view = document.getElementById("view-inicio");
    if (!view) { setTimeout(initCanvasObserver, 300); return; }
    new MutationObserver(syncCanvasState).observe(view, { attributes: true, attributeFilter: ["class"] });
    syncCanvasState();
  }

  // ── Inclinación 3D de las tarjetas rápidas ──
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

  function init() {
    initCanvasObserver();
    initTilt();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
