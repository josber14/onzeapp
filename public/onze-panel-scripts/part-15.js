
(function(){
  function readRoleText(){
    const parts = [
      document.body?.dataset?.role
    ];

    const keys = [
      "onzeUser",
      "onze_user",
      "currentUser",
      "onze_current_user",
      "onzeProfile",
      "profile",
      "user",
      "sessionUser"
    ];

    for(const key of keys){
      try{
        const raw = localStorage.getItem(key);
        if(!raw) continue;
        const obj = JSON.parse(raw);
        parts.push(
          obj?.role,
          obj?.type,
          obj?.userRole,
          obj?.mode,
          obj?.profile?.role,
          obj?.user?.role,
          obj?.isAdmin ? "admin" : ""
        );
      }catch(e){}
    }

    try{
      if(typeof IS_ADMIN_ROLE !== "undefined" && IS_ADMIN_ROLE) parts.push("admin");
      if(typeof CURRENT_USER_ROLE !== "undefined") parts.push(CURRENT_USER_ROLE);
    }catch(e){}

    return parts.filter(Boolean).join(" ").toLowerCase();
  }

  function isAdminLike(){
    const role = readRoleText();
    return (
      role.includes("super_admin") ||
      role.includes("super admin") ||
      role.includes("superadmin") ||
      role.includes("admin_global") ||
      role.includes("admin")
    );
  }

  function forceAdminVisibility(){
    const allowed = isAdminLike();
    document.body.classList.toggle("onze-admin-visible", allowed);

    document.querySelectorAll('[data-view-target="ajustes"], [data-view-target="p2p-bot"], #openProviderControlBtn').forEach(el=>{
      el.style.display = allowed ? "" : "none";
      el.setAttribute("aria-hidden", allowed ? "false" : "true");
    });

    document.querySelectorAll("#view-ajustes, #view-p2p-bot, #view-provider-control").forEach(view=>{
      if(!allowed){
        view.classList.remove("active");
        view.style.display = "none";
      }else{
        view.style.display = "";
      }
    });

    if(!allowed){
      const activeBlocked = document.querySelector("#view-ajustes.active, #view-p2p-bot.active, #view-provider-control.active");
      if(activeBlocked){
        activeBlocked.classList.remove("active");
      }

      const hasActive = document.querySelector(".view.active");
      if(!hasActive){
        const fallback = document.getElementById("view-inicio") || document.getElementById("view-dashboard");
        fallback?.classList.add("active");
      }
    }
  }

  document.addEventListener("DOMContentLoaded", forceAdminVisibility);
  setTimeout(forceAdminVisibility, 50);
  setTimeout(forceAdminVisibility, 300);
  setTimeout(forceAdminVisibility, 1000);

  document.addEventListener("click", function(){
    setTimeout(forceAdminVisibility, 50);
  }, true);

  window.forceAdminVisibility = forceAdminVisibility;

  // Pedido explícito del usuario (ago 2026), pensando el sistema como
  // vendible a otros clientes: el selector ONZE/ZINPLE y la pestaña Skipo
  // del panel P2P son específicos del negocio de ONZE (tenant id=1) -- se
  // ocultan por completo para cualquier tenant que no los tenga habilitados
  // (ver window.P2P_MULTI_ACCOUNT / window.SKIPO_ENABLED, cargados desde
  // app/dashboard/page.tsx). Mismo patrón de reintentos que
  // forceAdminVisibility, porque estos botones ya están en el HTML desde
  // el arranque (no hace falta esperar un fetch), pero por las dudas.
  function applyTenantFeatureFlags(){
    if(!window.P2P_MULTI_ACCOUNT){
      const acctSwitchers = document.querySelectorAll("#botAcctSwitcher, #ajustesAcctSwitcher");
      acctSwitchers.forEach(el => { el.style.display = "none"; });
    }
    if(!window.SKIPO_ENABLED){
      const skipoTab = document.querySelector('.bot-panel-tab[data-paneltab="skipo"]');
      if(skipoTab) skipoTab.style.display = "none";
      const skipoContent = document.getElementById("botPanelSkipo");
      if(skipoContent) skipoContent.style.display = "none";
    }
    if(!window.HAS_ONZE_CORE_BUSINESS){
      // Pedido explícito del usuario (ago 2026): Noticias, AKI TRANSFERS y
      // Clientes USDT son líneas de negocio de ONZE que no tienen que ver
      // con el bot P2P vendible -- se ocultan por completo para cualquier
      // tenant sin negocio ONZE. Inicio SÍ se mantiene visible (pedido
      // explícito del usuario, ago 2026 -- no es específico de ONZE).
      const hiddenNav = document.querySelectorAll(
        '[data-view-target="noticias"], [data-view-target="socio-bn"], [data-view-target="usdt-clients"]'
      );
      let wasOnHiddenView = false;
      hiddenNav.forEach(el => {
        if(el.classList.contains("active")) wasOnHiddenView = true;
        el.style.display = "none";
        el.setAttribute("aria-hidden", "true");
      });
      ["view-noticias", "view-socio-bn", "view-usdt-clients"].forEach(id => {
        const view = document.getElementById(id);
        if(view && view.classList.contains("active")){
          wasOnHiddenView = true;
          view.classList.remove("active");
          view.style.display = "none";
        }
      });
      if(wasOnHiddenView && !document.querySelector(".view.active")){
        const fallback = document.getElementById("view-p2p-bot") || document.getElementById("view-p2p-dashboard");
        fallback?.classList.add("active");
        document.querySelector('[data-view-target="p2p-bot"]')?.classList.add("active");
      }
    }
  }

  document.addEventListener("DOMContentLoaded", applyTenantFeatureFlags);
  setTimeout(applyTenantFeatureFlags, 50);
  setTimeout(applyTenantFeatureFlags, 300);
  setTimeout(applyTenantFeatureFlags, 1000);
})();
