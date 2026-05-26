export type BotStrategy = "top1" | "spread";
export type BotExchange = "binance" | "bybit";
export type BotOrderSide = "BUY" | "SELL";

export interface P2PBotConfigData {
  id?: number;
  tenantId: number;
  enabled: boolean;
  strategy: BotStrategy;
  top1Diff: number; // CLP por debajo del mejor competidor
  spreadPct: number;
  priceFloorPct: number;
  dailyVolumeCapUsdt: number | null;
  circuitBreakPct: number;
  pauseUntil: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  exchanges: BotExchange[];
}

export interface BotAd {
  exchange: BotExchange;
  adId: string;
  tradeType: BotOrderSide;
  asset: string;
  fiat: string;
  price: number;
  minAmount: number;
  maxAmount: number;
  availableAmount: number;
  paymentMethods: string[];
}

export interface BotCompetitorAd {
  price: number;
  merchantName: string;
  completionRate: number;
  minAmount: number;
  maxAmount: number;
  paymentMethods: string[];
}

export interface BotAction {
  action: "update_price" | "create_ad" | "pause" | "accept_order";
  exchange: BotExchange;
  adId?: string;
  currentPrice?: number;
  suggestedPrice?: number;
  reason: string;
  timestamp: number;
}

export interface BotState {
  running: boolean;
  tenantId: number;
  config: P2PBotConfigData;
  lastCycleAt: number | null;
  lastError: string | null;
}
