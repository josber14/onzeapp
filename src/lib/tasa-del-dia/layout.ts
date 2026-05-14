import { PAIRS, type Pair, type PairId } from "./pairs";

export type DailyRateSlot = {
  index: number;
  pairId: PairId;
  pair: Pair;
  rateText: string;
};

export type DailyRateColumns = {
  left: DailyRateSlot[];
  right: DailyRateSlot[];
};

export function buildDailyRateColumns(
  pairIds: PairId[],
  ratesByPair: Partial<Record<PairId, string>> = {}
): DailyRateColumns {
  const left: DailyRateSlot[] = [];
  const right: DailyRateSlot[] = [];

  pairIds.forEach((pairId, index) => {
    const pair = PAIRS[pairId];
    if (!pair) return;

    const slot: DailyRateSlot = {
      index,
      pairId,
      pair,
      rateText: ratesByPair[pairId] || "",
    };

    if (index % 2 === 0) {
      left.push(slot);
    } else {
      right.push(slot);
    }
  });

  return { left, right };
}
