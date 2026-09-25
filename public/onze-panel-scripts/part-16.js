
// Fallback global reset
try{
  window.resetP2PFullFreshStart = window.resetP2PFullFreshStart || function(){
    if(typeof showP2PResetConfirmModal === 'function'){ showP2PResetConfirmModal(); return; }
    fetch('/api/p2p/reset', { method:'POST', credentials:'include' }).then(r=>r.json()).then(d=>{ if(d.ok) console.log("✅ Servidor limpiado"); }).catch(e=>console.warn(e));
    'onze_p2p_capacity_items,onze_p2p_capacity_baseline_at,onze_p2p_binance_orders,onze_binance_sales,onze_p2p_initial_capital_usdt,onze_p2p_profit_day,onze_p2p_profit_start,onze_p2p_capacity_carryover,__p2pCapitalCarryoverDate,__p2pCapitalCarryoverProfit,onze_p2p_own_capital_items,__p2pManualMode,__p2pCapacityLastClear'.split(',').forEach(k => { localStorage.removeItem(k); localStorage.removeItem(k + (window.__p2pTenantSuffix || '')); });
    console.log("🧹 RESET COMPLETO");
    location.reload();
  };
}catch(e){}

// Auto-reset via URL parameter ?fullreset=1
try{
  if(location.search.includes('fullreset=1')){
    fetch('/api/p2p/reset', { method:'POST', credentials:'include' }).catch(()=>{});
    'onze_p2p_capacity_items,onze_p2p_capacity_baseline_at,onze_p2p_binance_orders,onze_binance_sales,onze_p2p_initial_capital_usdt,onze_p2p_profit_day,onze_p2p_profit_start,onze_p2p_capacity_carryover,__p2pCapitalCarryoverDate,__p2pCapitalCarryoverProfit,onze_p2p_own_capital_items,__p2pManualMode,__p2pCapacityLastClear'.split(',').forEach(k => { localStorage.removeItem(k); localStorage.removeItem(k + (window.__p2pTenantSuffix || '')); });
    const url = new URL(location.href);
    url.searchParams.delete('fullreset');
    history.replaceState({}, '', url);
    location.reload();
  }
}catch(e){}
