import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react-native';
import { IdeaCard } from '@/components/IdeaCard';
import {
  AppText,
  colors,
  EmptyState,
  ErrorState,
  LoadingState,
  PageScroll,
  radii,
  Screen,
} from '@/components/ui';
import { newIdeaDraftSession } from '@/lib/idea-draft-session';
import { duodateApi, queryKeys } from '@/lib/api/duodate';

export default function SpaceIdeasScreen() {
  const { id, contextKind, contextLabel, contextTimeZone, destinationId } =
    useLocalSearchParams<{
      id: string;
      contextKind?: string;
      contextLabel?: string;
      contextTimeZone?: string;
      destinationId?: string;
    }>();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap });
  const isAllSpaces = id === 'all' || contextKind === 'ALL';
  const isTrip = contextKind === 'TRIP';
  const ideas = useQuery({
    queryKey: ['ideas', contextKind ?? 'SPACE', id, isAllSpaces, isTrip],
    queryFn: () =>
      duodateApi.ideas(
        isAllSpaces ? undefined : { kind: isTrip ? 'TRIP' : 'SPACE', id },
      ),
    enabled: Boolean(id),
    refetchInterval: 60_000,
  });

  const filteredIdeas = useMemo(
    () => (categoryId ? (ideas.data ?? []).filter((idea) => idea.categoryId === categoryId) : (ideas.data ?? [])),
    [categoryId, ideas.data],
  );
  const space = bootstrap.data?.spaces.find((item) => item.id === id) ?? null;
  const spaceName = isAllSpaces
    ? 'All ideas'
    : isTrip
      ? contextLabel ?? 'Trip ideas'
      : space?.name ?? null;

  if (bootstrap.isLoading || ideas.isLoading) {
    return <Screen testID="space-ideas-screen"><LoadingState label="Opening this space…" /></Screen>;
  }
  if (bootstrap.isError || ideas.isError || !spaceName) {
    return (
      <Screen testID="space-ideas-screen">
        <View className="px-5 pt-3">
          <Pressable
            testID="space-back-button"
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.surface }}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
        </View>
        <ErrorState
          message={
            isTrip
              ? `We couldn't load ideas for ${spaceName ?? 'this Trip'}.`
              : space
                ? `We couldn't load ideas for ${space.name}.`
                : 'That space could not be found.'
          }
          onRetry={() => void Promise.all([bootstrap.refetch(), ideas.refetch()])}
        />
      </Screen>
    );
  }

  const targetSpaceId = isTrip ? null : space?.id;
  const targetDestinationId = isTrip ? destinationId : null;

  return (
    <Screen testID="space-ideas-screen" edges={['top']}>
      <View className="px-5 pt-3">
        <View className="flex-row items-center justify-between">
          <Pressable
            testID="space-back-button"
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
            style={{ backgroundColor: colors.surface }}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
          <Pressable
            testID="space-add-idea-button"
            accessibilityRole="button"
            accessibilityLabel={
              targetSpaceId || targetDestinationId
                ? `Add an idea to ${spaceName}`
                : 'Add an idea'
            }
            onPress={() =>
              router.push({
                pathname: '/add-idea',
                params: {
                  draftSession: newIdeaDraftSession(),
                  ...(targetSpaceId ? { spaceId: targetSpaceId } : targetDestinationId ? { destinationId: targetDestinationId } : {}),
                },
              })
            }
            className="min-h-12 flex-row items-center px-4 active:opacity-80"
            style={{ backgroundColor: colors.ink, borderRadius: radii.pill }}>
            <Plus color={colors.surface} size={18} />
            <AppText variant="label" tone="inverse" className="ml-2">Add idea</AppText>
          </Pressable>
        </View>

        <View className="mt-7">
          <AppText variant="label" tone="muted" className="uppercase">
            {isTrip ? 'Trip' : space ? 'Space' : 'Shared collection'}
          </AppText>
          <AppText variant="display" className="mt-1">{spaceName}</AppText>
          <AppText variant="body" tone="soft" className="mt-2">
            {ideas.data?.length ?? 0} saved {(ideas.data?.length ?? 0) === 1 ? 'idea' : 'ideas'}
          </AppText>
        </View>
      </View>

      <View className="mt-6">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-5"
          style={{ flexGrow: 0 }}>
          <Pressable
            testID="category-filter-all"
            accessibilityRole="button"
            accessibilityState={{ selected: categoryId === null }}
            onPress={() => setCategoryId(null)}
            className="mr-2 min-h-11 justify-center border px-4 active:opacity-75"
            style={{
              backgroundColor: categoryId === null ? colors.ink : colors.surface,
              borderColor: categoryId === null ? colors.ink : colors.lineStrong,
              borderRadius: radii.pill,
            }}>
            <AppText variant="label" tone={categoryId === null ? 'inverse' : 'default'}>All</AppText>
          </Pressable>
          {(bootstrap.data?.categories ?? []).map((category) => {
            const selected = category.id === categoryId;
            return (
              <Pressable
                key={category.id}
                testID={`category-filter-${category.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setCategoryId(category.id)}
                className="mr-2 min-h-11 justify-center border px-4 active:opacity-75"
                style={{
                  backgroundColor: selected ? colors.ink : colors.surface,
                  borderColor: selected ? colors.ink : colors.lineStrong,
                  borderRadius: radii.pill,
                }}>
                <AppText variant="label" tone={selected ? 'inverse' : 'default'}>{category.name}</AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <PageScroll
        refreshing={ideas.isRefetching}
        onRefresh={() => void ideas.refetch()}
        contentContainerClassName="pt-6">
        {ideas.data?.length === 0 ? (
          <EmptyState
            title={
              targetSpaceId || targetDestinationId
                ? `No ideas in ${spaceName} yet`
                : 'No ideas saved yet'
            }
            message="Add the first thing you'd like to do together here."
          />
        ) : filteredIdeas.length === 0 ? (
          <EmptyState
            testID="category-no-results"
            title="No ideas in this category"
            message="Try another category or add a new idea."
            actionLabel="Show all ideas"
            onAction={() => setCategoryId(null)}
          />
        ) : (
          <View testID="idea-list">
            {filteredIdeas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onPress={() =>
                  router.push({
                    pathname: '/idea/[id]',
                    params: {
                      id: idea.id,
                      ...(contextTimeZone ? { contextTimeZone } : {}),
                    },
                  })
                }
              />
            ))}
          </View>
        )}
      </PageScroll>
    </Screen>
  );
}
