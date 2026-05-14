export type PairId =
  | 'CHILE_VENEZUELA'
  | 'USA_VENEZUELA'
  | 'USA_CHILE'
  | 'CHILE_USA'
  | 'CHILE_COLOMBIA'
  | 'COLOMBIA_CHILE'
  | 'PERU_VENEZUELA'
  | 'CHILE_PERU'
  | 'ARGENTINA_VENEZUELA'
  | 'CHILE_ARGENTINA'
  | 'MEXICO_VENEZUELA'
  | 'CHILE_MEXICO'
  | 'ESPANA_VENEZUELA'
  | 'ESPANA_CHILE'
  | 'COLOMBIA_VENEZUELA'
  | 'CHILE_ECUADOR'
  | 'PERU_CHILE'
  | 'ARGENTINA_CHILE'
  | 'CHILE_ESPANA'
  | 'CHILE_BRASIL';

export type Pair = {
  id: PairId;
  label: string;
  paisOrigen: string;
  paisDestino: string;
};

export const PAIRS: Record<PairId, Pair> = {
  CHILE_VENEZUELA: { id: 'CHILE_VENEZUELA', label: 'CHILE - VZLA', paisOrigen: 'CHILE', paisDestino: 'VENEZUELA' },
  USA_VENEZUELA: { id: 'USA_VENEZUELA', label: 'USA - VZLA', paisOrigen: 'USA', paisDestino: 'VENEZUELA' },
  USA_CHILE: { id: 'USA_CHILE', label: 'USA - CHILE', paisOrigen: 'USA', paisDestino: 'CHILE' },
  CHILE_USA: { id: 'CHILE_USA', label: 'CHILE - USA', paisOrigen: 'CHILE', paisDestino: 'USA' },
  CHILE_COLOMBIA: { id: 'CHILE_COLOMBIA', label: 'CHILE - COLOMBIA', paisOrigen: 'CHILE', paisDestino: 'COLOMBIA' },
  COLOMBIA_CHILE: { id: 'COLOMBIA_CHILE', label: 'COLOMBIA - CHILE', paisOrigen: 'COLOMBIA', paisDestino: 'CHILE' },
  PERU_VENEZUELA: { id: 'PERU_VENEZUELA', label: 'PERÚ - VZLA', paisOrigen: 'PERÚ', paisDestino: 'VENEZUELA' },
  CHILE_PERU: { id: 'CHILE_PERU', label: 'CHILE - PERÚ', paisOrigen: 'CHILE', paisDestino: 'PERÚ' },
  ARGENTINA_VENEZUELA: { id: 'ARGENTINA_VENEZUELA', label: 'ARGENTINA - VZLA', paisOrigen: 'ARGENTINA', paisDestino: 'VENEZUELA' },
  CHILE_ARGENTINA: { id: 'CHILE_ARGENTINA', label: 'CHILE - ARGENTINA', paisOrigen: 'CHILE', paisDestino: 'ARGENTINA' },
  MEXICO_VENEZUELA: { id: 'MEXICO_VENEZUELA', label: 'MÉXICO - VZLA', paisOrigen: 'MÉXICO', paisDestino: 'VENEZUELA' },
  CHILE_MEXICO: { id: 'CHILE_MEXICO', label: 'CHILE - MEXICO', paisOrigen: 'CHILE', paisDestino: 'MÉXICO' },
  ESPANA_VENEZUELA: { id: 'ESPANA_VENEZUELA', label: 'ESPAÑA - VZLA', paisOrigen: 'ESPAÑA', paisDestino: 'VENEZUELA' },
  ESPANA_CHILE: { id: 'ESPANA_CHILE', label: 'ESPAÑA - CHILE', paisOrigen: 'ESPAÑA', paisDestino: 'CHILE' },
  COLOMBIA_VENEZUELA: { id: 'COLOMBIA_VENEZUELA', label: 'COLOMBIA - VZLA', paisOrigen: 'COLOMBIA', paisDestino: 'VENEZUELA' },
  CHILE_ECUADOR: { id: 'CHILE_ECUADOR', label: 'CHILE - ECUADOR', paisOrigen: 'CHILE', paisDestino: 'ECUADOR' },
  PERU_CHILE: { id: 'PERU_CHILE', label: 'PERÚ - CHILE', paisOrigen: 'PERÚ', paisDestino: 'CHILE' },
  ARGENTINA_CHILE: { id: 'ARGENTINA_CHILE', label: 'ARGENTINA - CHILE', paisOrigen: 'ARGENTINA', paisDestino: 'CHILE' },
  CHILE_ESPANA: { id: 'CHILE_ESPANA', label: 'CHILE - ESPAÑA', paisOrigen: 'CHILE', paisDestino: 'ESPAÑA' },
  CHILE_BRASIL: { id: 'CHILE_BRASIL', label: 'CHILE - BRASIL', paisOrigen: 'CHILE', paisDestino: 'BRASIL' },
};
