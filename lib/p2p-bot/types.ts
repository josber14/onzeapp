export type BotStrategy = "top1" | "spread";
export type BotExchange = "binance" | "bybit" | "okx";
export type BotOrderSide = "BUY" | "SELL";

export interface P2PBotConfigData {
  id?: number;
  tenantId: number;
  enabled: boolean;
  strategy: BotStrategy;
  top1Diff: number; // CLP por debajo del mejor competidor
  spreadPct: number;
  priceFloorPct: number;
  priceSource: string;
  dailyVolumeCapUsdt: number | null;
  circuitBreakPct: number;
  pauseUntil: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  exchanges: BotExchange[];
  competePayTypes: string[] | null;
  commissionPct: number;
  safeMarginPct: number;
}

export interface P2PBotExchangeConfigData {
  id?: number;
  tenantId: number;
  exchange: BotExchange;
  enabled: boolean;
  strategy: BotStrategy;
  top1Diff: number;
  spreadPct: number;
  priceFloorPct: number;
  priceSource: string;
  dailyVolumeCapUsdt: number | null;
  circuitBreakPct: number;
  cycleInterval: number;
  minCompetitorCapital: number | null;
  competePayTypes: string[] | null;
  chatBotEnabled: boolean;
  chatCookies?: string | null;
  pauseUntil: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  adUpdateCount: number;
  commissionPct: number;
  safeMarginPct: number;
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

export interface P2PBotAdConfigData {
  id?: number;
  tenantId: number;
  exchange: string;
  adId: string | null;
  botEnabled: boolean;
  botStrategy: string;
  botTop1Diff: number;
  botSpreadPct: number;
  botPriceFloorPct: number;
  botPriceSource: string;
  botCommissionPct: number;
  botSafeMarginPct: number;
  botMinCompetitorCapital: number | null;
  botCompetePayTypes: string[] | null;
  botCycleInterval: number | null;
  botCircuitBreakPct: number | null;
  botDailyVolumeCapUsdt: number | null;
}

export interface BotAction {
  action: "update_price" | "create_ad" | "recreate_ad" | "pause" | "accept_order";
  exchange: BotExchange;
  adId?: string;
  currentPrice?: number;
  suggestedPrice?: number;
  reason: string;
  timestamp: number;
}

export type ChatState =
  | "new"
  | "awaiting_verification"
  | "awaiting_account_type"
  | "awaiting_previous_account"
  | "awaiting_single_confirm"
  | "awaiting_bank_choice"
  | "awaiting_company_type"
  | "awaiting_problem"
  | "awaiting_limit_amount"
  | "account_sent"
  | "payment_made"
  | "awaiting_comprobant"
  | "completed"
  | "appealed"
  | "closed";

export interface ChatMessage {
  id: string;
  type: string;
  content: string;
  self: boolean;
  createTime: number;
  imageUrl: string | null;
}

export interface ChatStateData {
  id?: number;
  tenantId: number;
  exchange: string;
  orderNumber: string;
  state: ChatState;
  counterparty: string | null;
  isCompany: boolean;
  isReturning: boolean;
  previousBank: string | null;
  chosenBank: string | null;
  chosenAccountIds: any;
  erutRequested: boolean;
  erutReceived: boolean;
  retryCount: number;
  partialAmount: number | null;
  totalAmount: number | null;
  lastClientMsgAt: string | null;
  lastBotMsgAt: string | null;
  lastBotMsg: string | null;
  appealAt: string | null;
  paidAt: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
}

export interface BotState {
  running: boolean;
  tenantId: number;
  config: P2PBotConfigData;
  lastCycleAt: number | null;
  lastError: string | null;
}
