import type {
  DurationBand,
  LetsDateRequest,
  LetsDateResponse,
  MaximumBudget,
  PlanningContextRef,
  WeatherCondition,
} from '@/lib/api/duodate';
import type { PlanningContextKey } from '@/lib/planning-context';

export interface LetsDateFilterSelection {
  context?: PlanningContextRef;
  maximumBudget?: MaximumBudget;
  maximumDuration?: DurationBand;
  weather: WeatherCondition[];
}

export function shouldClearLetsDateResults(
  previousContextKey: PlanningContextKey | null,
  nextContextKey: PlanningContextKey | null,
  hasSubmittedRequest: boolean,
) {
  return hasSubmittedRequest && previousContextKey !== null && previousContextKey !== nextContextKey;
}

export function buildLetsDateRequest(selection: LetsDateFilterSelection): LetsDateRequest {
  return {
    ...(selection.context ? { context: selection.context } : {}),
    ...(selection.maximumBudget ? { maximumBudget: selection.maximumBudget } : {}),
    ...(selection.maximumDuration ? { maximumDuration: selection.maximumDuration } : {}),
    weather: [...new Set(selection.weather)].sort(),
  };
}

export function letsDateRequestKey(request: LetsDateRequest) {
  return JSON.stringify({
    context: request.context ?? null,
    maximumBudget: request.maximumBudget ?? null,
    maximumDuration: request.maximumDuration ?? null,
    weather: [...new Set(request.weather ?? [])].sort(),
  });
}

export function suggestionsInPositionOrder(response: LetsDateResponse) {
  return [...response.suggestions].sort((left, right) => left.position - right.position);
}

export function canAdjustLetsDateFilters(response: LetsDateResponse | undefined) {
  const uniqueIdeaIds = new Set(response?.suggestions.map(({ idea }) => idea.id).filter(Boolean));
  return uniqueIdeaIds.size < 3;
}

export function letsDateShortfallMessage(matchCount: number) {
  if (matchCount === 0) {
    return 'Nothing saved matches all of these filters today. Adjust any filter to widen the possibilities.';
  }
  return `We found ${matchCount} ${matchCount === 1 ? 'idea' : 'ideas'} that match everything. Adjust a filter if you would like three.`;
}
