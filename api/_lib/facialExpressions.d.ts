export type FacialExpressionKey = "neutral" | "happiness" | "surprise" | "anger" | "disgust";

export interface FacialExpressionSeriesEntry {
  key: FacialExpressionKey;
  label: string;
}

export declare const FACIAL_EXPRESSION_SERIES: FacialExpressionSeriesEntry[];
export declare function normalizeFacialExpression(value: unknown): FacialExpressionKey | null;
export declare function extractFacialExpressionCounts(rawVisit: unknown): Record<FacialExpressionKey, number>;
export declare function getDominantFacialExpression(rawVisit: unknown): FacialExpressionKey | null;
