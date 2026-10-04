import type { Idea, LetsDateResponse } from './api/duodate';
import {
  buildLetsDateRequest,
  canAdjustLetsDateFilters,
  letsDateRequestKey,
  letsDateShortfallMessage,
  shouldClearLetsDateResults,
  suggestionsInPositionOrder,
} from './lets-date';

function suggestion(position: number, ideaId: string) {
  return {
    position,
    scheduled: false,
    idea: { id: ideaId, title: ideaId } as Idea,
  };
}

describe("Let's Date request handling", () => {
  test('serializes only selected optional filters and normalizes weather order', () => {
    const request = buildLetsDateRequest({
      context: { kind: 'SPACE', id: 'space-1' },
      maximumBudget: { kind: 'BAND', costBand: 'FROM_20_TO_50' },
      maximumDuration: 'HALF_DAY',
      weather: ['OUTDOOR', 'SUNNY', 'OUTDOOR'],
    });

    expect(request).toEqual({
      context: { kind: 'SPACE', id: 'space-1' },
      maximumBudget: { kind: 'BAND', costBand: 'FROM_20_TO_50' },
      maximumDuration: 'HALF_DAY',
      weather: ['OUTDOOR', 'SUNNY'],
    });
  });

  test('keeps equivalent normalized filter combinations on one stable query key', () => {
    const first = buildLetsDateRequest({ weather: ['SUNNY', 'INDOOR'], maximumDuration: 'TWO_TO_FOUR_HOURS' });
    const second = buildLetsDateRequest({ weather: ['INDOOR', 'SUNNY', 'SUNNY'], maximumDuration: 'TWO_TO_FOUR_HOURS' });

    expect(letsDateRequestKey(first)).toBe(letsDateRequestKey(second));
  });

  test('does not add a client target date when asking for today', () => {
    const request = buildLetsDateRequest({ weather: [] });

    expect(request.targetDate).toBeUndefined();
  });

  test('clears submitted results only when the shared context changes', () => {
    expect(shouldClearLetsDateResults('SPACE:home', 'TRIP:active', true)).toBe(true);
    expect(shouldClearLetsDateResults('SPACE:home', 'SPACE:home', true)).toBe(false);
    expect(shouldClearLetsDateResults('SPACE:home', 'TRIP:active', false)).toBe(false);
  });
});

describe("Let's Date result handling", () => {
  test('preserves backend positions without randomizing suggestions', () => {
    const response = {
      suggestions: [suggestion(3, 'idea-c'), suggestion(1, 'idea-a'), suggestion(2, 'idea-b')],
    } as LetsDateResponse;

    expect(suggestionsInPositionOrder(response).map(({ idea }) => idea.id)).toEqual([
      'idea-a',
      'idea-b',
      'idea-c',
    ]);
    expect(response.suggestions.map(({ idea }) => idea.id)).toEqual(['idea-c', 'idea-a', 'idea-b']);
  });

  test.each([0, 1, 2, 3, 8])('gates adjustment by unique suggestions, not matchCount %i', (matchCount) => {
    for (const suggestionCount of [0, 1, 2, 3, 4]) {
      const response = {
        matchCount,
        status: matchCount >= 3 ? 'READY' : 'INSUFFICIENT_MATCHES',
        suggestions: Array.from({ length: suggestionCount }, (_, index) => suggestion(index + 1, `idea-${index}`)),
      } as LetsDateResponse;

      expect(canAdjustLetsDateFilters(response)).toBe(suggestionCount < 3);
    }
  });

  test('duplicate ideas cannot fill the three-valid-suggestions threshold', () => {
    const response = {
      matchCount: 8,
      status: 'READY',
      suggestions: [suggestion(1, 'idea-a'), suggestion(2, 'idea-a'), suggestion(3, 'idea-b')],
    } as LetsDateResponse;

    expect(canAdjustLetsDateFilters(response)).toBe(true);
    expect(canAdjustLetsDateFilters({
      ...response,
      suggestions: [...response.suggestions, suggestion(4, 'idea-c')],
    })).toBe(false);
    expect(response.suggestions.map(({ idea }) => idea.id)).toEqual(['idea-a', 'idea-a', 'idea-b']);
  });

  test('missing results or empty idea identifiers cannot lock adjustment', () => {
    expect(canAdjustLetsDateFilters(undefined)).toBe(true);
    expect(canAdjustLetsDateFilters({
      suggestions: [suggestion(1, 'idea-a'), suggestion(2, 'idea-b'), suggestion(3, '')],
    } as LetsDateResponse)).toBe(true);
  });

  test('explains shortfalls without duplicating or weakening results', () => {
    expect(letsDateShortfallMessage(0)).toContain('matches all of these filters');
    expect(letsDateShortfallMessage(1)).toContain('1 idea');
    expect(letsDateShortfallMessage(2)).toContain('2 ideas');
  });
});
