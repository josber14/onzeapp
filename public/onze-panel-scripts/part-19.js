
(function(){
  if(window.__onzeMarketingStudioLoaded) return;
  window.__onzeMarketingStudioLoaded = true;

  // Fuente redondeada y gruesa (parecida a la tipografía real de AKI Transfer)
  // -- se auto-hospeda vía Google Fonts. html2canvas necesita que la fuente ya
  // esté cargada antes de capturar, por eso mktEnsureFont() espera
  // document.fonts.ready antes de generar el PNG.
  if(!document.getElementById("mktFontLink")){
    var fontLink = document.createElement("link");
    fontLink.id = "mktFontLink";
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Nunito:wght@600;700;800&display=swap";
    document.head.appendChild(fontLink);
  }
  function mktEnsureFont(){
    try{
      return Promise.all([
        document.fonts.load('800 60px "Baloo 2"'),
        document.fonts.load('700 24px "Nunito"')
      ]).then(function(){ return document.fonts.ready; }).catch(function(){});
    }catch(e){ return Promise.resolve(); }
  }

  var MKT_FONT_DISPLAY = '"Baloo 2", Arial, sans-serif';
  var MKT_FONT_TEXT = '"Nunito", Arial, sans-serif';
  var MKT_GREEN_BG = "linear-gradient(165deg,#0c6c4d 0%,#0a6044 40%,#064f38 100%)";
  var MKT_GOLD = "#f4b700";
  var MKT_GREEN_DARK = "#07583d";

  function mktEsc(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  var MKT_FLAGS = {
    "venezuela":"🇻🇪","chile":"🇨🇱","colombia":"🇨🇴","argentina":"🇦🇷",
    "mexico":"🇲🇽","méxico":"🇲🇽","uruguay":"🇺🇾","espana":"🇪🇸","españa":"🇪🇸",
    "estados unidos":"🇺🇸","ecuador":"🇪🇨","peru":"🇵🇪","perú":"🇵🇪",
    "brasil":"🇧🇷","panama":"🇵🇦","panamá":"🇵🇦","honduras":"🇭🇳",
    "puerto rico":"🇵🇷"
  };
  function mktFlagFor(name){
    return MKT_FLAGS[String(name||"").trim().toLowerCase()] || "🏳️";
  }

  // ── Íconos propios en SVG plano (nada de emojis de interfaz ni fotos de
  // stock) para que el material se vea diseñado, no genérico. ──
  var MKT_ICON_SIGN =
    '<svg viewBox="0 0 200 170" width="150" height="128" fill="none">' +
      '<circle cx="100" cy="12" r="8" fill="' + MKT_GOLD + '"/>' +
      '<line x1="100" y1="12" x2="30" y2="70" stroke="#ffffff" stroke-width="4"/>' +
      '<line x1="100" y1="12" x2="170" y2="70" stroke="#ffffff" stroke-width="4"/>' +
      '<circle cx="30" cy="70" r="6" fill="' + MKT_GOLD + '"/>' +
      '<circle cx="170" cy="70" r="6" fill="' + MKT_GOLD + '"/>' +
      '<rect x="14" y="70" width="172" height="76" rx="14" fill="#ffffff"/>' +
      '<text x="100" y="123" text-anchor="middle" font-family="' + MKT_FONT_DISPLAY + '" font-weight="800" font-size="44" fill="' + MKT_GREEN_DARK + '">CERRADO</text>' +
    '</svg>';

  var MKT_ICON_CLOCK =
    '<svg viewBox="0 0 120 120" width="96" height="96" fill="none">' +
      '<circle cx="60" cy="60" r="52" stroke="#ffffff" stroke-width="7"/>' +
      '<line x1="60" y1="60" x2="60" y2="30" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>' +
      '<line x1="60" y1="60" x2="82" y2="72" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>' +
      '<circle cx="60" cy="60" r="6" fill="' + MKT_GOLD + '"/>' +
    '</svg>';

  var MKT_ICON_GLOBE =
    '<svg viewBox="0 0 160 160" width="130" height="130" fill="none">' +
      '<circle cx="80" cy="80" r="58" fill="rgba(255,255,255,.10)" stroke="#ffffff" stroke-width="4"/>' +
      '<ellipse cx="80" cy="80" rx="58" ry="22" stroke="#ffffff" stroke-width="2.5" opacity=".55"/>' +
      '<ellipse cx="80" cy="80" rx="22" ry="58" stroke="#ffffff" stroke-width="2.5" opacity=".55"/>' +
      '<path d="M28 50 A72 72 0 0 1 132 60" stroke="' + MKT_GOLD + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<path d="M124 43 L132 60 L113 58" fill="' + MKT_GOLD + '"/>' +
      '<path d="M132 110 A72 72 0 0 1 28 100" stroke="' + MKT_GOLD + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<path d="M36 117 L28 100 L47 102" fill="' + MKT_GOLD + '"/>' +
    '</svg>';

  var MKT_ICON_PHONE =
    '<svg viewBox="0 0 90 150" width="70" height="118" fill="none">' +
      '<rect x="4" y="4" width="82" height="142" rx="16" fill="#ffffff"/>' +
      '<rect x="14" y="24" width="62" height="94" rx="4" fill="' + MKT_GREEN_DARK + '"/>' +
      '<circle cx="45" cy="133" r="7" fill="' + MKT_GREEN_DARK + '"/>' +
      '<circle cx="45" cy="70" r="18" fill="' + MKT_GOLD + '"/>' +
    '</svg>';

  var MKT_ICON_STAR =
    '<svg viewBox="0 0 100 100" width="72" height="72" fill="none">' +
      '<path d="M50 6 L61 38 L96 38 L68 58 L79 92 L50 71 L21 92 L32 58 L4 38 L39 38 Z" fill="' + MKT_GOLD + '"/>' +
    '</svg>';

  function mktLogoBlock(){
    return '' +
      '<div style="text-align:center;">' +
        '<div style="display:inline-flex;align-items:center;gap:10px;">' +
          '<div style="width:34px;height:34px;background:' + MKT_GOLD + ';clip-path:polygon(50% 0%,100% 100%,0% 100%);"></div>' +
          '<div style="font-family:' + MKT_FONT_DISPLAY + ';font-weight:800;font-size:46px;color:#ffffff;letter-spacing:-1px;">AKI</div>' +
        '</div>' +
        '<div style="font-family:' + MKT_FONT_TEXT + ';font-weight:800;font-size:15px;color:#ffffff;letter-spacing:.42em;margin-top:2px;">TRANSFER</div>' +
        '<div style="font-family:' + MKT_FONT_TEXT + ';font-weight:700;font-style:italic;font-size:11px;color:' + MKT_GOLD + ';letter-spacing:.08em;margin-top:2px;">¡Aquí y Ahora!</div>' +
      '</div>';
  }

  function mktCanvasOpen(bg){
    return '<div class="mkt-canvas" style="width:900px;height:1600px;box-sizing:border-box;position:relative;overflow:hidden;background:' + (bg || MKT_GREEN_BG) + ';font-family:' + MKT_FONT_TEXT + ';">' +
      '<div style="position:absolute;left:-170px;top:-140px;width:540px;height:540px;border-radius:999px;background:rgba(244,183,0,.10);"></div>' +
      '<div style="position:absolute;right:-190px;bottom:100px;width:540px;height:540px;border-radius:999px;background:rgba(255,255,255,.05);"></div>' +
      '<div style="position:absolute;left:0;right:0;top:0;height:14px;background:' + MKT_GOLD + ';"></div>' +
      '<div style="position:relative;z-index:1;height:100%;box-sizing:border-box;padding:86px 66px 56px;display:flex;flex-direction:column;">';
  }
  var MKT_CANVAS_CLOSE = '</div></div>';

  var AKI_COUNTRIES = ["Venezuela","Chile","Colombia","Argentina","México","Uruguay","España","Estados Unidos","Ecuador","Perú","Brasil","Panamá"];
  var AKI_PHONE = "+56 951333777";

  // ── Plantillas, ya con la informacion real de AKI Transfer -- nada que llenar ──

  function mktRenderCerrado(){
    return mktCanvasOpen() +
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">' +
        MKT_ICON_SIGN +
        '<div style="margin-top:56px;font-family:' + MKT_FONT_DISPLAY + ';color:#ffffff;font-size:50px;font-weight:800;line-height:1.2;max-width:640px;">GRACIAS POR<br>TU PREFERENCIA</div>' +
      '</div>' +
      '<div>' + mktLogoBlock() + '</div>' +
    MKT_CANVAS_CLOSE;
  }

  function mktRenderHorario(){
    return mktCanvasOpen() +
      '<div style="text-align:center;color:#ffffff;">' +
        '<div style="display:flex;justify-content:center;margin-bottom:14px;">' + MKT_ICON_CLOCK + '</div>' +
        '<div style="font-family:' + MKT_FONT_TEXT + ';font-size:24px;font-weight:800;letter-spacing:.22em;">CONOCE NUESTRO</div>' +
        '<div style="margin-top:12px;display:inline-block;background:' + MKT_GOLD + ';color:' + MKT_GREEN_DARK + ';border-radius:20px;padding:14px 48px;font-family:' + MKT_FONT_DISPLAY + ';font-size:56px;font-weight:800;box-shadow:0 16px 30px rgba(0,0,0,.2);">HORARIO</div>' +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:36px;">' +
        '<div style="display:flex;align-items:center;gap:24px;">' +
          '<div style="background:#ffffff;color:' + MKT_GREEN_DARK + ';border-radius:24px;padding:24px 40px;font-family:' + MKT_FONT_DISPLAY + ';font-size:50px;font-weight:800;box-shadow:0 14px 26px rgba(0,0,0,.18);">9AM</div>' +
          '<div style="color:#ffffff;font-family:' + MKT_FONT_TEXT + ';font-size:30px;font-weight:800;">A</div>' +
          '<div style="background:#ffffff;color:' + MKT_GREEN_DARK + ';border-radius:24px;padding:24px 36px;font-family:' + MKT_FONT_DISPLAY + ';font-size:50px;font-weight:800;box-shadow:0 14px 26px rgba(0,0,0,.18);">8:30PM</div>' +
        '</div>' +
        '<div style="text-align:center;color:#ffffff;font-family:' + MKT_FONT_TEXT + ';font-size:26px;font-weight:800;line-height:1.7;max-width:640px;">' +
          'DE LUNES A SÁBADO<br>' +
          '<span style="color:' + MKT_GOLD + ';">DOMINGOS DESDE LAS 10:30 AM</span>' +
        '</div>' +
      '</div>' +
      '<div>' + mktLogoBlock() + '</div>' +
    MKT_CANVAS_CLOSE;
  }

  function mktRenderPaises(){
    var chips = AKI_COUNTRIES.map(function(name){
      return '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;width:120px;">' +
        '<div style="width:92px;height:92px;border-radius:999px;background:rgba(255,255,255,.10);border:3px solid ' + MKT_GOLD + ';display:flex;align-items:center;justify-content:center;font-size:42px;box-shadow:0 10px 20px rgba(0,0,0,.15);">' + mktFlagFor(name) + '</div>' +
        '<div style="color:#ffffff;font-family:' + MKT_FONT_TEXT + ';font-size:15px;font-weight:800;text-align:center;">' + mktEsc(name) + '</div>' +
      '</div>';
    }).join("");

    return mktCanvasOpen() +
      '<div>' + mktLogoBlock() + '</div>' +
      '<div style="text-align:center;margin-top:34px;">' +
        '<div style="color:#ffffff;font-family:' + MKT_FONT_DISPLAY + ';font-size:48px;font-weight:800;line-height:1.08;">PAÍSES DONDE<br>ENVIAMOS</div>' +
        '<div style="margin-top:16px;display:inline-block;background:' + MKT_GOLD + ';color:' + MKT_GREEN_DARK + ';border-radius:999px;padding:10px 26px;font-family:' + MKT_FONT_TEXT + ';font-size:18px;font-weight:800;">ESTAMOS EN TODOS LADOS</div>' +
      '</div>' +
      '<div style="flex:1;display:flex;align-items:center;justify-content:center;">' +
        '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:18px;max-width:780px;">' + chips + '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;">' + MKT_ICON_STAR +
        '<div style="color:#ffffff;font-family:' + MKT_FONT_DISPLAY + ';font-size:30px;font-weight:800;">N.º 1 en confianza</div>' +
      '</div>' +
    MKT_CANVAS_CLOSE;
  }

  function mktRenderCTA(){
    var flagsRow = AKI_COUNTRIES.slice(0,10).map(function(name){
      return '<span style="font-size:30px;">' + mktFlagFor(name) + '</span>';
    }).join("");
    return mktCanvasOpen() +
      '<div style="text-align:center;">' +
        '<div style="display:flex;justify-content:center;gap:8px;margin-bottom:26px;">' + flagsRow + '</div>' +
        '<div style="color:#ffffff;font-family:' + MKT_FONT_TEXT + ';font-size:30px;font-weight:800;letter-spacing:.12em;">TRANSFIERE</div>' +
        '<div style="margin-top:10px;display:inline-block;background:#ffffff;color:' + MKT_GREEN_DARK + ';border-radius:20px;padding:14px 50px;font-family:' + MKT_FONT_DISPLAY + ';font-size:60px;font-weight:800;box-shadow:0 16px 30px rgba(0,0,0,.22);">AHORA</div>' +
        '<div style="margin-top:30px;">' + mktLogoBlock() + '</div>' +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px;">' +
        MKT_ICON_PHONE +
        '<div style="border:3px solid ' + MKT_GOLD + ';border-radius:999px;padding:18px 38px;color:#ffffff;font-family:' + MKT_FONT_DISPLAY + ';font-size:34px;font-weight:800;letter-spacing:.03em;">' + mktEsc(AKI_PHONE) + '</div>' +
      '</div>' +
    MKT_CANVAS_CLOSE;
  }

  function mktRenderTasaCompetente(){
    return mktCanvasOpen("linear-gradient(115deg,#0a0a0a 0%,#0a0a0a 42%,#0a6044 42%,#064f38 100%)") +
      '<div style="display:flex;justify-content:flex-end;">' + mktLogoBlock() + '</div>' +
      '<div style="flex:1;display:flex;align-items:center;justify-content:center;">' + MKT_ICON_GLOBE + '</div>' +
      '<div>' +
        '<div style="color:#ffffff;font-family:' + MKT_FONT_DISPLAY + ';font-size:56px;font-weight:800;line-height:.95;">LA TASA<br>MÁS<br>COMPETENTE</div>' +
        '<div style="margin-top:18px;display:flex;flex-wrap:wrap;gap:8px;max-width:640px;">' +
          AKI_COUNTRIES.slice(0,8).map(function(n){ return '<span style="font-size:26px;">' + mktFlagFor(n) + '</span>'; }).join("") +
        '</div>' +
      '</div>' +
    MKT_CANVAS_CLOSE;
  }

  var MKT_TEMPLATES = [
    { id: "cerrado", name: "Cerrado", render: mktRenderCerrado },
    { id: "horario", name: "Horario", render: mktRenderHorario },
    { id: "paises", name: "Países donde enviamos", render: mktRenderPaises },
    { id: "cta", name: "Transfiere ahora", render: mktRenderCTA },
    { id: "tasa", name: "La tasa más competente", render: mktRenderTasaCompetente }
  ];

  function mktBuildGallery(){
    var grid = document.getElementById("mktTemplateGrid");
    if(!grid) return;
    grid.innerHTML = MKT_TEMPLATES.map(function(tpl){
      return '' +
        '<div class="mkt-template-card">' +
          '<div class="mkt-template-thumb" id="mktThumb_' + tpl.id + '"></div>' +
          '<div class="mkt-template-name">' + tpl.name + '</div>' +
          '<button class="btn primary" type="button" style="width:100%;margin-top:8px;" onclick="window.mktDownload(\'' + tpl.id + '\')" id="mktBtn_' + tpl.id + '">Descargar</button>' +
        '</div>';
    }).join("");
    MKT_TEMPLATES.forEach(function(tpl){
      var thumb = document.getElementById("mktThumb_" + tpl.id);
      if(thumb) thumb.innerHTML = tpl.render();
    });
  }

  function mktLoadHtml2Canvas(){
    return new Promise(function(resolve, reject){
      if(window.html2canvas){ resolve(window.html2canvas); return; }
      var existing = document.getElementById("html2canvasScript");
      if(existing){
        existing.addEventListener("load", function(){ resolve(window.html2canvas); });
        return;
      }
      var script = document.createElement("script");
      script.id = "html2canvasScript";
      script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
      script.onload = function(){
        if(window.html2canvas) resolve(window.html2canvas);
        else reject(new Error("html2canvas no quedó disponible"));
      };
      script.onerror = function(){ reject(new Error("No pude cargar html2canvas")); };
      document.head.appendChild(script);
    });
  }

  window.mktDownload = async function(id){
    var tpl = MKT_TEMPLATES.find(function(t){ return t.id === id; });
    var thumb = document.getElementById("mktThumb_" + id);
    var btn = document.getElementById("mktBtn_" + id);
    if(!tpl || !thumb) return;
    var oldText = btn ? btn.textContent : "";
    try{
      if(btn){ btn.disabled = true; btn.textContent = "Preparando..."; }
      await mktEnsureFont();
      var node = thumb.querySelector(".mkt-canvas");
      var html2canvas = await mktLoadHtml2Canvas();
      var canvas = await html2canvas(node, { backgroundColor: null, scale: 3, useCORS: true, allowTaint: true, logging: false });
      var dataUrl = canvas.toDataURL("image/png", 1);
      var link = document.createElement("a");
      link.href = dataUrl;
      link.download = "aki-transfer-" + id + ".png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }catch(e){
      onzeAlert("No se pudo generar la imagen: " + e.message);
    }finally{
      if(btn){ btn.disabled = false; btn.textContent = oldText; }
    }
  };

  function mktInit(){
    if(document.getElementById("mktTemplateGrid")) mktBuildGallery();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", function(){ setTimeout(mktInit, 400); });
  }else{
    setTimeout(mktInit, 400);
  }
})();
