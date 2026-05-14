import type { PairId } from "./pairs";

export type DailyRateListSeed = {
  id: string;
  ownerUserId: string | null;
  name: string;
  pairIds: PairId[];
};

export const ONZE_DEFAULT_DAILY_RATE_LIST: DailyRateListSeed = {
  id: "onze_default",
  ownerUserId: null,
  name: "ONZE (default)",
  pairIds: [
    "CHILE_VENEZUELA",
    "USA_VENEZUELA",
    "USA_CHILE",
    "CHILE_USA",
    "CHILE_COLOMBIA",
    "COLOMBIA_CHILE",
    "PERU_VENEZUELA",
    "CHILE_PERU",
    "ARGENTINA_VENEZUELA",
    "CHILE_ARGENTINA",
    "MEXICO_VENEZUELA",
    "CHILE_MEXICO",
    "ESPANA_VENEZUELA",
    "ESPANA_CHILE",
    "COLOMBIA_VENEZUELA",
    "CHILE_ECUADOR",
    "PERU_CHILE",
    "ARGENTINA_CHILE",
    "CHILE_ESPANA",
    "CHILE_BRASIL",
  ],
};

export const DAILY_RATE_LISTS_SEED: DailyRateListSeed[] = [
  ONZE_DEFAULT_DAILY_RATE_LIST,
];
