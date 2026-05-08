export declare function getDisplayforceAuthCookie(): Promise<string>;
export declare function resolveDisplayforcePlatform(clientId: string): Promise<{
  platformId: number;
  platformSlug: string;
} | null>;
export declare function fetchFacialExpressionHourlyMap(
  clientId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<Record<string, Record<string, number>> | null>;
export declare function totalsFromHourlyMap(
  hourlyMap: Record<string, Record<string, number>> | null | undefined,
): Record<string, number>;
export declare function percentFromTotals(
  totals: Record<string, number> | null | undefined,
): Record<string, number>;
