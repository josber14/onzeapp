
/* ===== ONZE: Menú desplegable Calculadora/Dashboard ===== */
(function(){
  if(window.__onzeProDropdownMenuLoaded) return;
  window.__onzeProDropdownMenuLoaded = true;

  function addOnzeDropdownMenuStyles(){
    if(document.getElementById("onzeProDropdownMenuStyles")) return;

    const style = document.createElement("style");
    style.id = "onzeProDropdownMenuStyles";
    style.textContent = `
      .onze-menu-group{
        width:100%;
        margin:0 0 10px 0;
      }

      .onze-menu-group-toggle{
        width:100%;
        border:1px solid rgba(59,130,246,.35);
        background:rgba(30,64,175,.28);
        color:#dbeafe;
        border-radius:18px;
        padding:16px 18px;
        font-size:16px;
        font-weight:950;
        cursor:pointer;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        transition:.18s ease;
      }

      .onze-menu-group-toggle:hover{
        border-color:rgba(52,211,153,.36);
        background:rgba(15,23,42,.72);
      }

      .onze-menu-group-toggle.active{
        border-color:rgba(52,211,153,.38);
        background:rgba(52,211,153,.12);
        color:#34d399;
      }

      .onze-menu-group-arrow{
        font-size:13px;
        opacity:.85;
        transition:.18s ease;
      }

      .onze-menu-group.open .onze-menu-group-arrow{
        transform:rotate(180deg);
      }

      .onze-submenu{
        display:none;
        padding:8px 0 0 14px;
        border-left:1px solid rgba(52,211,153,.20);
        margin-left:14px;
      }

      .onze-menu-group.open .onze-submenu{
        display:block;
      }

      .onze-submenu-btn{
        width:100%;
        border:1px solid rgba(148,163,184,.16);
        background:rgba(15,23,42,.58);
        color:#a8b3c7;
        border-radius:14px;
        padding:13px 15px;
        font-size:14px;
        font-weight:900;
        cursor:pointer;
        text-align:left;
        margin-bottom:8px;
        transition:.18s ease;
      }

      .onze-submenu-btn:hover{
        color:#e5e7eb;
        border-color:rgba(52,211,153,.28);
        background:rgba(52,211,153,.08);
      }

      .onze-submenu-btn.active{
        color:#34d399;
        border-color:rgba(52,211,153,.38);
        background:rgba(52,211,153,.12);
      }
    `;

    document.head.appendChild(style);
  }

  function goToOnzeView(viewName){
    if(typeof switchView === "function"){
      switchView(viewName);
    }else{
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      document.getElementById("view-" + viewName)?.classList.add("active");
    }

    setTimeout(updateOnzeDropdownActiveState, 80);

    // Refrescar datos al navegar al Dashboard P2P
    if(viewName === 'p2p-dashboard'){
      setTimeout(function(){
        if(typeof syncP2PCapacityFromServer === 'function') syncP2PCapacityFromServer();
        if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
        if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
      }, 100);
    }
  }

  function createMenuGroup(title, items){
    const group = document.createElement("div");
    group.className = "onze-menu-group";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "onze-menu-group-toggle";
    toggle.innerHTML = `<span>${title}</span><span class="onze-menu-group-arrow">▼</span>`;

    const submenu = document.createElement("div");
    submenu.className = "onze-submenu";

    items.forEach(item=>{
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "onze-submenu-btn";
      btn.dataset.dropdownViewTarget = item.view;
      btn.textContent = item.label;
      btn.addEventListener("click", function(e){
        e.stopPropagation();
        goToOnzeView(item.view);
      });
      submenu.appendChild(btn);
    });

    toggle.addEventListener("click", function(){
      group.classList.toggle("open");
    });

    group.appendChild(toggle);
    group.appendChild(submenu);

    return group;
  }

  function updateOnzeDropdownActiveState(){
    const activeView = document.querySelector(".view.active");
    const activeId = activeView?.id?.replace(/^view-/, "") || "";

    document.querySelectorAll(".onze-submenu-btn").forEach(btn=>{
      const isActive = btn.dataset.dropdownViewTarget === activeId;
      btn.classList.toggle("active", isActive);

      const group = btn.closest(".onze-menu-group");
      const toggle = group?.querySelector(".onze-menu-group-toggle");

      if(isActive){
        group?.classList.add("open");
        toggle?.classList.add("active");
      }
    });

    document.querySelectorAll(".onze-menu-group").forEach(group=>{
      const hasActive = !!group.querySelector(".onze-submenu-btn.active");
      const toggle = group.querySelector(".onze-menu-group-toggle");
      toggle?.classList.toggle("active", hasActive);
    });
  }

  function buildOnzeProDropdownMenu(){
    addOnzeDropdownMenuStyles();

    const calcOnze = document.querySelector('[data-view-target="calculadora"]');
    const dashOnze = document.querySelector('[data-view-target="dashboard"]');
    const calcP2P = document.querySelector('[data-view-target="p2p-calculator"]');
    const dashP2P = document.querySelector('[data-view-target="p2p-dashboard"]');

    const nav = calcOnze?.parentNode || dashOnze?.parentNode || calcP2P?.parentNode || dashP2P?.parentNode;
    if(!nav) return;

    document.querySelectorAll(".onze-menu-group").forEach(el => el.remove());

    const calcGroup = createMenuGroup("Calculadora", [
      { label:"Calculadora ONZE", view:"calculadora" },
      { label:"Calculadora P2P", view:"p2p-calculator" }
    ]);

    // Pedido explícito del usuario (ago 2026): un tenant sin negocio ONZE
    // (ej. Hector) no ve "Dashboard ONZE", solo "Dashboard P2P".
    const dashGroup = createMenuGroup("Dashboard", window.HAS_ONZE_CORE_BUSINESS
      ? [
          { label:"Dashboard ONZE", view:"dashboard" },
          { label:"Dashboard P2P", view:"p2p-dashboard" }
        ]
      : [
          { label:"Dashboard P2P", view:"p2p-dashboard" }
        ]);

    const anchor = calcOnze || dashOnze || calcP2P || dashP2P;
    nav.insertBefore(calcGroup, anchor);
    nav.insertBefore(dashGroup, anchor);

    [calcOnze, dashOnze, calcP2P, dashP2P].forEach(btn=>{
      if(btn){
        btn.style.display = "none";
        btn.setAttribute("aria-hidden", "true");
      }
    });

    updateOnzeDropdownActiveState();
  }

  function bootOnzeProDropdownMenu(){
    buildOnzeProDropdownMenu();

    // Reaplicar porque otros módulos del panel agregan/reordenan botones después de cargar.
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", bootOnzeProDropdownMenu);
  }else{
    bootOnzeProDropdownMenu();
  }

  document.addEventListener("click", function(){
    setTimeout(updateOnzeDropdownActiveState, 80);
  });
})();
