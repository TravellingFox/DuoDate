import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarCheck,
  Clock3,
  CloudRain,
  Sparkles,
  House,
  MapPin,
  RotateCcw,
  Sun,
  Trees,
  WalletCards,
} from 'lucide-react-native';
import {
  AppText,
  colors,
  ErrorState,
  PageScroll,
  PaperCard,
  PrimaryButton,
  radii,
  Screen,
  SecondaryButton,
} from '@/components/ui';
import {
  duodateApi,
  queryKeys,
  type CostBand,
  type DurationBand,
  type Idea,
  type LetsDateRequest,
  type WeatherCondition,
} from '@/lib/api/duodate';
import { costLabels, durationLabels } from '@/lib/format';
import {
  buildLetsDateRequest,
  canAdjustLetsDateFilters,
  letsDateRequestKey,
  letsDateShortfallMessage,
  shouldClearLetsDateResults,
  suggestionsInPositionOrder,
} from '@/lib/lets-date';
import { usePlanningContext } from '@/lib/planning-context';

interface ChoiceOption<T extends string> {
  value: T | null;
  label: string;
}

function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  testIDPrefix: string;
}) {
  return (
    <View className="flex-row flex-wrap">
      {options.map((option) => {
        const selected = value === option.value;
        const optionKey = option.value ?? 'any';
        return (
          <Pressable
            key={optionKey}
            testID={`${testIDPrefix}-${optionKey.toLowerCase().replace(/_/g, '-')}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            className="mb-2 mr-2 min-h-11 justify-center border px-4 active:opacity-75"
            style={{
              backgroundColor: selected ? colors.ink : colors.surface,
              borderColor: selected ? colors.ink : colors.lineStrong,
              borderRadius: radii.pill,
            }}>
            <AppText variant="label" tone={selected ? 'inverse' : 'default'}>{option.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function FilterSection({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View className="mt-7">
      <AppText variant="heading">{title}</AppText>
      {note ? <AppText variant="meta" tone="muted" className="mb-3 mt-1">{note}</AppText> : <View className="h-3" />}
      {children}
    </View>
  );
}

function ResultMeta({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View className="mr-3 mt-2 flex-row items-center">
      {icon}
      <AppText variant="meta" tone="soft" className="ml-1.5 shrink" numberOfLines={1}>{label}</AppText>
    </View>
  );
}

function ResultCard({
  idea,
  scheduled,
  position,
  targetDate,
  timeZone,
}: {
  idea: Idea;
  scheduled: boolean;
  position: number;
  targetDate: string;
  timeZone: string;
}) {
  const exactCost = idea.exactCostCents !== null
    ? `Exact ${(idea.exactCostCents / 100).toFixed(idea.exactCostCents % 100 === 0 ? 0 : 2)}`
    : null;
  const cost = exactCost ?? (idea.costBand ? costLabels[idea.costBand] : null);

  return (
    <Pressable
      testID={`lets-date-result-${position}`}
      accessibilityRole="button"
      accessibilityLabel={`Open ${idea.title}`}
      onPress={() =>
        router.push({
          pathname: '/idea/[id]',
          params: {
            id: idea.id,
            contextTimeZone: timeZone,
            initialScheduleDate: targetDate,
          },
        })
      }
      className="mb-4 active:opacity-80">
      <PaperCard className="py-5">
        <View className="flex-row items-start">
          <View className="min-w-0 flex-1 pr-4">
            {idea.category ? (
              <AppText variant="label" tone="accent" className="uppercase">{idea.category.name}</AppText>
            ) : (
              <AppText variant="label" tone="muted" className="uppercase">Saved idea</AppText>
            )}
            <AppText variant="heading" className="mt-1 text-xl leading-7">{idea.title}</AppText>
            <AppText testID={`lets-date-creator-${position}`} variant="meta" tone="muted" className="mt-1">
              by {idea.createdBy.displayName}
            </AppText>
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: colors.paperDeep }}>
            <ArrowUpRight color={colors.inkSoft} size={19} />
          </View>
        </View>
        <View className="mt-2 flex-row flex-wrap">
          {cost ? <ResultMeta icon={<WalletCards color={colors.inkMuted} size={15} />} label={cost} /> : null}
          {idea.durationBand ? (
            <ResultMeta icon={<Clock3 color={colors.inkMuted} size={15} />} label={durationLabels[idea.durationBand]} />
          ) : null}
          {idea.specificLocation ? (
            <ResultMeta icon={<MapPin color={colors.inkMuted} size={15} />} label={idea.specificLocation} />
          ) : null}
          {scheduled ? (
            <ResultMeta icon={<CalendarCheck color={colors.sage} size={15} />} label="Already scheduled" />
          ) : null}
          {idea.lifecycle === 'COMPLETED' ? (
            <ResultMeta icon={<RotateCcw color={colors.blue} size={15} />} label="Dated before" />
          ) : null}
        </View>
      </PaperCard>
    </Pressable>
  );
}

const durationOptions: ChoiceOption<DurationBand>[] = [
  { value: null, label: 'Any length' },
  { value: 'UNDER_ONE_HOUR', label: 'Under 1h' },
  { value: 'ONE_TO_TWO_HOURS', label: 'Up to 2h' },
  { value: 'TWO_TO_FOUR_HOURS', label: 'Up to 4h' },
  { value: 'HALF_DAY', label: 'Half day' },
  { value: 'FULL_DAY', label: 'Full day' },
  { value: 'OVERNIGHT_OR_MULTI_DAY', label: 'Overnight+' },
];

const budgetOptions: ChoiceOption<Exclude<CostBand, 'FROM_100'>>[] = [
  { value: null, label: 'Any budget' },
  { value: 'FREE', label: 'Free' },
  { value: 'UNDER_20', label: 'Low' },
  { value: 'FROM_20_TO_50', label: 'Medium' },
  { value: 'FROM_50_TO_100', label: 'High' },
];

const weatherOptions: {
  value: WeatherCondition;
  label: string;
  Icon: typeof Sun;
}[] = [
  { value: 'SUNNY', label: 'Sunny', Icon: Sun },
  { value: 'RAINY', label: 'Rainy', Icon: CloudRain },
  { value: 'INDOOR', label: 'Indoor', Icon: House },
  { value: 'OUTDOOR', label: 'Outdoor', Icon: Trees },
];

export default function LetsDateScreen() {
  const queryClient = useQueryClient();
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap });
  const planningContext = usePlanningContext(bootstrap.data);
  const [maximumDuration, setMaximumDuration] = useState<DurationBand | null>(null);
  const [maximumBudget, setMaximumBudget] = useState<Exclude<CostBand, 'FROM_100'> | null>(null);
  const [weather, setWeather] = useState<WeatherCondition[]>([]);
  const [submittedRequest, setSubmittedRequest] = useState<LetsDateRequest | null>(null);
  const previousContextKey = useRef(planningContext.effectiveKey);

  useEffect(() => {
    if (shouldClearLetsDateResults(
      previousContextKey.current,
      planningContext.effectiveKey,
      submittedRequest !== null,
    )) {
      setSubmittedRequest(null);
    }
    previousContextKey.current = planningContext.effectiveKey;
  }, [planningContext.effectiveKey, submittedRequest]);

  const requestKey = submittedRequest ? letsDateRequestKey(submittedRequest) : 'idle';
  const results = useQuery({
    queryKey: [...queryKeys.letsDate(requestKey), submittedRequest],
    queryFn: () => duodateApi.letsDate(submittedRequest!),
    enabled: Boolean(submittedRequest),
    staleTime: 0,
    refetchOnMount: true,
  });
  const canAdjustFilters = canAdjustLetsDateFilters(results.data);

  useFocusEffect(useCallback(() => {
    if (!submittedRequest) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // A full set stays locked; let the navigator handle back without changing filters.
      if (!canAdjustFilters) return false;
      setSubmittedRequest(null);
      return true;
    });
    return () => subscription.remove();
  }, [submittedRequest, canAdjustFilters]));

  if (bootstrap.isLoading) {
    return (
      <Screen testID="lets-date-screen">
        <View className="flex-1 items-center justify-center px-8">
          <Sparkles color={colors.rose} size={30} />
          <AppText variant="body" tone="soft" className="mt-4 text-center">Gathering your saved ideas…</AppText>
        </View>
      </Screen>
    );
  }

  if (bootstrap.isError || !bootstrap.data) {
    return (
      <Screen testID="lets-date-screen">
        <ErrorState message="We couldn't open Let's Date." onRetry={() => void bootstrap.refetch()} />
      </Screen>
    );
  }

  if (!submittedRequest) {
    return (
      <Screen testID="lets-date-screen" edges={['top']}>
        <PageScroll contentContainerClassName="pt-4">
          <AppText variant="display">Let&apos;s Date</AppText>
          <AppText variant="body" tone="soft" className="mt-2">
            Start with what fits today. We&apos;ll choose from things you already wanted to do.
          </AppText>

          <FilterSection title="Where?">
            <View className="flex-row flex-wrap">
              {planningContext.options.map((option) => {
                const selected = planningContext.effectiveKey === option.key;
                return (
                  <Pressable
                    key={option.key}
                    testID={`lets-date-context-${option.key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => planningContext.selectContext(option.key)}
                    className="mb-2 mr-2 min-h-11 justify-center border px-4 active:opacity-75"
                    style={{
                      backgroundColor: selected ? colors.ink : colors.surface,
                      borderColor: selected ? colors.ink : colors.lineStrong,
                      borderRadius: radii.pill,
                    }}>
                    <AppText variant="label" tone={selected ? 'inverse' : 'default'}>{option.label}</AppText>
                  </Pressable>
                );
              })}
            </View>
          </FilterSection>

          <FilterSection title="Available time">
            <ChoiceChips
              options={durationOptions}
              value={maximumDuration}
              onChange={setMaximumDuration}
              testIDPrefix="lets-date-duration"
            />
          </FilterSection>

          <FilterSection title="Budget">
            <ChoiceChips
              options={budgetOptions}
              value={maximumBudget}
              onChange={setMaximumBudget}
              testIDPrefix="lets-date-budget"
            />
          </FilterSection>

          <FilterSection title="Weather">
            <View className="flex-row flex-wrap">
              {weatherOptions.map(({ value, label, Icon }) => {
                const selected = weather.includes(value);
                return (
                  <Pressable
                    key={value}
                    testID={`lets-date-weather-${value.toLowerCase()}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setWeather((current) =>
                      current.includes(value)
                        ? current.filter((item) => item !== value)
                        : [...current, value]
                    )}
                    className="mb-2 mr-2 min-h-11 flex-row items-center border px-4 active:opacity-75"
                    style={{
                      backgroundColor: selected ? colors.blueSoft : colors.surface,
                      borderColor: selected ? colors.blue : colors.lineStrong,
                      borderRadius: radii.pill,
                    }}>
                    <Icon color={selected ? colors.blue : colors.inkMuted} size={17} />
                    <AppText variant="label" className="ml-2">{label}</AppText>
                  </Pressable>
                );
              })}
            </View>
          </FilterSection>

          <View className="mt-7">
            <PrimaryButton
              testID="show-three-ideas-button"
              label="Show us 3 ideas"
              icon={<Sparkles color={colors.surface} size={19} />}
              onPress={() => {
                void queryClient.invalidateQueries({ queryKey: queryKeys.letsDateRoot });
                setSubmittedRequest(buildLetsDateRequest({
                  context: planningContext.apiContext,
                  maximumBudget: maximumBudget ? { kind: 'BAND', costBand: maximumBudget } : undefined,
                  maximumDuration: maximumDuration ?? undefined,
                  weather,
                }));
              }}
            />
          </View>
        </PageScroll>
      </Screen>
    );
  }

  if (results.isLoading || results.isFetching) {
    return (
      <Screen testID="lets-date-results-screen">
        <View className="flex-1 items-center justify-center px-8">
          <Sparkles color={colors.rose} size={30} />
          <AppText variant="body" tone="soft" className="mt-4 text-center">Looking through your saved ideas…</AppText>
        </View>
      </Screen>
    );
  }

  if (results.isError || !results.data) {
    return (
      <Screen testID="lets-date-results-screen">
        <View className="px-5 pt-4">
          <Pressable
            testID="lets-date-adjust-filters-error"
            accessibilityRole="button"
            accessibilityLabel="Go back to filters"
            onPress={() => setSubmittedRequest(null)}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.surface }}>
            <ArrowLeft color={colors.ink} size={21} />
          </Pressable>
        </View>
        <ErrorState
          title="We couldn't choose just now"
          message="Your filters are still here. Try the same search again when you're ready."
          onRetry={() => void results.refetch()}
        />
      </Screen>
    );
  }

  const orderedSuggestions = suggestionsInPositionOrder(results.data);

  return (
    <Screen testID="lets-date-results-screen" edges={['top']}>
      <PageScroll contentContainerClassName="pt-4">
        {canAdjustFilters ? (
          <Pressable
            testID="lets-date-adjust-filters"
            accessibilityRole="button"
            accessibilityLabel="Adjust filters"
            onPress={() => setSubmittedRequest(null)}
            className="mb-6 min-h-11 flex-row items-center self-start active:opacity-70">
            <ArrowLeft color={colors.ink} size={19} />
            <AppText variant="label" className="ml-2">Adjust filters</AppText>
          </Pressable>
        ) : null}

        <AppText variant="display" className="leading-[44px]">How about one of these? ♡</AppText>
        <AppText variant="body" tone="soft" className="mt-2">
          {results.data.status === 'READY'
            ? 'Three equal possibilities for today. The order stays steady for these filters.'
            : 'Every available match for today is shown below, in a steady order.'}
        </AppText>

        {results.data.status === 'INSUFFICIENT_MATCHES' ? (
          <View
            testID="lets-date-shortfall"
            className="mt-6 border px-4 py-4"
            style={{ backgroundColor: colors.ochreSoft, borderColor: colors.ochre, borderRadius: radii.medium }}>
            <AppText variant="label">Not quite three matches</AppText>
            <AppText variant="body" tone="soft" className="mt-1">
              {letsDateShortfallMessage(results.data.matchCount)}
            </AppText>
          </View>
        ) : null}

        <View testID="lets-date-results" className="mt-7">
          {orderedSuggestions.map((suggestion) => (
            <ResultCard
              key={`${suggestion.position}-${suggestion.idea.id}`}
              idea={suggestion.idea}
              scheduled={suggestion.scheduled}
              position={suggestion.position}
              targetDate={results.data.targetDate}
              timeZone={results.data.context.timeZone}
            />
          ))}
        </View>

        {canAdjustFilters ? (
          <SecondaryButton
            testID="lets-date-adjust-filters-bottom"
            label="Adjust filters"
            onPress={() => setSubmittedRequest(null)}
          />
        ) : null}
      </PageScroll>
    </Screen>
  );
}
