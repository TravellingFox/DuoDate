import { readFileSync } from 'node:fs';
// @ts-expect-error Tests run in Bun, whose globals are intentionally not added to the app tsconfig.
import { describe, expect, test } from 'bun:test';

const source = readFileSync(new URL('../app/(tabs)/lets-date.tsx', import.meta.url).pathname, 'utf8');
const addIdea = readFileSync(new URL('../app/add-idea.tsx', import.meta.url).pathname, 'utf8');

describe("Let's Date current match count", () => {
  test('revalidates on intentional search instead of keeping an infinite cached shortfall', () => {
    expect(source).toContain('queryClient.invalidateQueries({ queryKey: queryKeys.letsDateRoot })');
    expect(source).toContain('staleTime: 0');
    expect(source).toContain('results.isLoading || results.isFetching');
    expect(addIdea).toContain('queryClient.invalidateQueries({ queryKey: queryKeys.letsDateRoot })');
  });

  test('both result adjustment controls use the unique-suggestion gate', () => {
    expect(source).toContain('const canAdjustFilters = canAdjustLetsDateFilters(results.data)');
    for (const testID of ['lets-date-adjust-filters', 'lets-date-adjust-filters-bottom']) {
      expect(source).toMatch(new RegExp(
        `\\{canAdjustFilters \\? \\(\\s*<(?:Pressable|SecondaryButton)\\s+testID="${testID}"[\\s\\S]*?\\) : null\\}`,
      ));
    }
  });

  test('hardware back leaves full results intact and only overrides navigation while focused', () => {
    expect(source).toContain('useFocusEffect(useCallback(() => {');
    expect(source).toMatch(/if \(!submittedRequest\) return;\s*const subscription = BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{/);
    expect(source).toMatch(/if \(!canAdjustFilters\) return false;\s*setSubmittedRequest\(null\);\s*return true;/);
    expect(source).toContain('return () => subscription.remove()');
    expect(source).toContain('}, [submittedRequest, canAdjustFilters]));');
    expect(source).not.toContain('setMaximumDuration(null)');
    expect(source).not.toContain('setMaximumBudget(null)');
    expect(source).not.toContain('setWeather([])');
  });

  test('only renders insufficient-match copy for the backend shortfall status', () => {
    expect(source).toContain("results.data.status === 'INSUFFICIENT_MATCHES' ? (");
    expect(source).toContain('orderedSuggestions.map((suggestion)');
  });
});
