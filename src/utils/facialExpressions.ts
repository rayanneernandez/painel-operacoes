export type CanonicalFacialExpression = 'neutral' | 'happiness' | 'surprise' | 'anger';

export const FACIAL_EXPRESSION_SERIES = [
  { key: 'neutral' as const, label: 'Neutro' },
  { key: 'happiness' as const, label: 'Felicidade' },
  { key: 'surprise' as const, label: 'Surpresa' },
  { key: 'anger' as const, label: 'Raiva' },
];

const FACIAL_EXPRESSION_PRIORITY: CanonicalFacialExpression[] = ['happiness', 'surprise', 'anger', 'neutral'];

function normalizeBooleanish(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'on', 'sim'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', 'off', 'nao', 'não'].includes(normalized)) return false;
  }
  return null;
}

export function normalizeFacialExpression(value: unknown): CanonicalFacialExpression | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (['neutral', 'neutro', 'calm', 'normal', 'none', 'no_expression', 'noemotion'].includes(normalized)) {
    return 'neutral';
  }
  if (['happiness', 'happy', 'felicidade', 'joy', 'alegria', 'smile', 'smiling'].includes(normalized)) {
    return 'happiness';
  }
  if (['surprise', 'surprised', 'surpresa'].includes(normalized)) {
    return 'surprise';
  }
  if (['anger', 'angry', 'raiva'].includes(normalized)) {
    return 'anger';
  }
  return null;
}

function increment(counts: Record<CanonicalFacialExpression, number>, expression: CanonicalFacialExpression | null) {
  if (!expression) return;
  counts[expression] += 1;
}

function applyStructuredEmotionValue(value: unknown, counts: Record<CanonicalFacialExpression, number>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const candidates: Array<{ expression: CanonicalFacialExpression; value: number }> = [];

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const expression = normalizeFacialExpression(key);
    const numericValue = Number(raw);
    if (!expression || !Number.isFinite(numericValue) || numericValue <= 0) continue;
    candidates.push({ expression, value: numericValue });
  }

  candidates.sort((a, b) => b.value - a.value);
  increment(counts, candidates[0]?.expression ?? null);
}

function extractAdditionalAttributes(rawVisit: any): any[] {
  const nested = rawVisit?.additional_atributes ?? rawVisit?.additional_attributes ?? [];
  return Array.isArray(nested) ? nested : [];
}

function extractCountsFromEntry(entry: any, counts: Record<CanonicalFacialExpression, number>) {
  if (!entry || typeof entry !== 'object') return;

  const directCandidates = [
    entry.expression,
    entry.emotion,
    entry.mood,
    entry.facial_expression,
    entry.dominant_emotion,
  ];
  for (const candidate of directCandidates) {
    const normalized = normalizeFacialExpression(candidate);
    if (normalized) {
      increment(counts, normalized);
      return;
    }
  }

  applyStructuredEmotionValue(entry.emotions, counts);
  applyStructuredEmotionValue(entry.expression_scores, counts);
  applyStructuredEmotionValue(entry.emotion_scores, counts);

  const smile = normalizeBooleanish(entry.smile);
  if (smile === true) {
    increment(counts, 'happiness');
    return;
  }
  if (smile === false) {
    increment(counts, 'neutral');
  }
}

export function extractFacialExpressionCounts(rawVisit: any): Record<CanonicalFacialExpression, number> {
  const counts: Record<CanonicalFacialExpression, number> = {
    neutral: 0,
    happiness: 0,
    surprise: 0,
    anger: 0,
  };

  if (!rawVisit || typeof rawVisit !== 'object') {
    return counts;
  }

  const directCandidates = [
    rawVisit.expression,
    rawVisit.emotion,
    rawVisit.mood,
    rawVisit.facial_expression,
    rawVisit.dominant_emotion,
  ];
  for (const candidate of directCandidates) {
    increment(counts, normalizeFacialExpression(candidate));
  }

  applyStructuredEmotionValue(rawVisit.emotions, counts);
  applyStructuredEmotionValue(rawVisit.expression_scores, counts);
  applyStructuredEmotionValue(rawVisit.emotion_scores, counts);

  const nestedEntries = extractAdditionalAttributes(rawVisit);
  for (const entry of nestedEntries) {
    extractCountsFromEntry(entry, counts);
  }

  if (nestedEntries.length === 0) {
    const smile = normalizeBooleanish(rawVisit.smile);
    if (smile === true) increment(counts, 'happiness');
    if (smile === false) increment(counts, 'neutral');
  }

  return counts;
}

export function getDominantFacialExpression(rawVisit: any): CanonicalFacialExpression | null {
  const counts = extractFacialExpressionCounts(rawVisit);
  let winner: CanonicalFacialExpression | null = null;
  let best = 0;

  for (const expression of FACIAL_EXPRESSION_PRIORITY) {
    const value = counts[expression] ?? 0;
    if (value > best) {
      best = value;
      winner = expression;
    }
  }

  return winner;
}
