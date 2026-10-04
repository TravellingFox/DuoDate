import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  MapPinned,
  Plus,
  Route,
} from 'lucide-react-native';
import {
  AppText,
  colors,
  EmptyState,
  ErrorState,
  LoadingState,
  PageScroll,
  PaperCard,
  radii,
  Screen,
  SectionHeader,
} from '@/components/ui';
import { duodateApi, queryKeys, type Trip } from '@/lib/api/duodate';
import { formatCalendarDate } from '@/lib/format';
import { groupTrips } from '@/lib/travel';

function tripTitle(trip: Trip) {
  return trip.name ?? trip.destination.name;
}

function tripDateRange(trip: Trip) {
  return `${formatCalendarDate(trip.startDate, 'd MMM yyyy')} – ${formatCalendarDate(trip.endDate, 'd MMM yyyy')}`;
}

function TripCard({ trip, emphasis = 'standard' }: { trip: Trip; emphasis?: 'active' | 'standard' | 'past' }) {
  const active = emphasis === 'active';
  const past = emphasis === 'past';
  const statusLabel = active
    ? trip.isPrimaryActive
      ? 'CURRENT TRIP'
      : 'ALSO ACTIVE'
    : past
      ? trip.status === 'CANCELLED'
        ? 'CANCELLED'
        : 'PAST TRIP'
      : 'UPCOMING';

  return (
    <Pressable
      testID={`trip-card-${trip.id}`}
      accessibilityRole={trip.status === 'CANCELLED' ? undefined : 'button'}
      accessibilityLabel={trip.status === 'CANCELLED'
        ? `${tripTitle(trip)}, cancelled and archived`
        : `Open ${tripTitle(trip)}, ${statusLabel.toLowerCase()}`}
      disabled={trip.status === 'CANCELLED'}
      onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id } })}
      className="mb-4 active:opacity-80">
      <PaperCard
        className={active ? 'overflow-hidden p-0' : past ? 'py-4' : 'overflow-hidden p-0'}
        style={past ? { backgroundColor: colors.paperDeep } : undefined}>
        {past ? (
          <View className="flex-row items-center">
            <View className="h-11 w-11 items-center justify-center rounded-2xl" style={{ backgroundColor: colors.surface }}>
              <MapPinned color={colors.inkMuted} size={20} />
            </View>
            <View className="ml-3 min-w-0 flex-1">
              <AppText variant="label" tone="muted">{statusLabel}</AppText>
              <AppText variant="heading" className="mt-0.5" numberOfLines={1}>{tripTitle(trip)}</AppText>
              <AppText variant="meta" tone="muted" className="mt-0.5">{tripDateRange(trip)}</AppText>
            </View>
            <ArrowUpRight color={colors.inkMuted} size={18} />
          </View>
        ) : (
          <>
            <View
              className={active ? 'min-h-36 justify-between px-5 py-5' : 'min-h-24 justify-between px-5 py-4'}
              style={{ backgroundColor: active ? colors.sageSoft : colors.blueSoft }}>
              <View className="flex-row items-start justify-between">
                <View
                  className="min-h-8 justify-center rounded-full px-3"
                  style={{ backgroundColor: active ? colors.sage : colors.blue }}>
                  <AppText variant="label" tone="inverse" className="text-xs">{statusLabel}</AppText>
                </View>
                <Route color={active ? colors.sage : colors.blue} size={active ? 28 : 23} />
              </View>
              <View className="mt-5">
                <AppText variant={active ? 'title' : 'heading'}>{tripTitle(trip)}</AppText>
                {trip.name ? (
                  <AppText variant="body" tone="soft" className="mt-1">{trip.destination.name}</AppText>
                ) : null}
              </View>
            </View>
            <View className="flex-row items-center px-5 py-4">
              <CalendarDays color={colors.inkMuted} size={18} />
              <AppText variant="body" tone="soft" className="ml-2 flex-1">{tripDateRange(trip)}</AppText>
              <ArrowUpRight color={colors.inkSoft} size={19} />
            </View>
          </>
        )}
      </PaperCard>
    </Pressable>
  );
}

export default function TravelOverviewScreen() {
  const [pastExpanded, setPastExpanded] = useState<boolean>(false);
  const trips = useQuery({ queryKey: queryKeys.trips, queryFn: duodateApi.trips, refetchInterval: 60_000 });
  const groups = useMemo(() => groupTrips(trips.data ?? []), [trips.data]);

  if (trips.isLoading) {
    return <Screen testID="travel-overview-screen"><LoadingState label="Opening your trips…" /></Screen>;
  }

  if (trips.isError) {
    return (
      <Screen testID="travel-overview-screen">
        <View className="px-5 pt-3">
          <Pressable
            testID="travel-back-button"
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.surface }}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
        </View>
        <ErrorState message="We couldn't load your trips." onRetry={() => void trips.refetch()} />
      </Screen>
    );
  }

  const hasTrips = groups.active.length + groups.upcoming.length + groups.past.length > 0;

  return (
    <Screen testID="travel-overview-screen" edges={['top']}>
      <PageScroll
        refreshing={trips.isRefetching}
        onRefresh={() => void trips.refetch()}
        contentContainerClassName="pt-3">
        <View className="flex-row items-center justify-between">
          <Pressable
            testID="travel-back-button"
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
            style={{ backgroundColor: colors.surface }}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
          <Pressable
            testID="create-trip-button"
            accessibilityRole="button"
            accessibilityLabel="Create a trip"
            onPress={() => router.push('/trip-form')}
            className="min-h-12 flex-row items-center px-4 active:opacity-80"
            style={{ backgroundColor: colors.ink, borderRadius: radii.pill }}>
            <Plus color={colors.surface} size={18} />
            <AppText variant="label" tone="inverse" className="ml-2">Create trip</AppText>
          </Pressable>
        </View>

        <View className="mt-7">
          <AppText variant="display">Travel</AppText>
        </View>

        {!hasTrips ? (
          <View className="mt-9">
            <EmptyState
              testID="travel-empty-state"
              title="No trips yet"
              message="Your upcoming journeys will appear here."
            />
          </View>
        ) : (
          <>
            {groups.active.length > 0 ? (
              <View className="mt-10" testID="active-trips-section">
                <SectionHeader eyebrow="Right now" title={groups.active.length === 1 ? 'Current trip' : 'Current trips'} />
                {groups.active.map((trip) => <TripCard key={trip.id} trip={trip} emphasis="active" />)}
              </View>
            ) : null}

            <View className="mt-10" testID="upcoming-trips-section">
              <SectionHeader eyebrow="Plan ahead" title="Upcoming trips" />
              {groups.upcoming.length > 0 ? (
                groups.upcoming.map((trip) => <TripCard key={trip.id} trip={trip} />)
              ) : (
                <PaperCard testID="upcoming-trips-empty" className="py-4">
                  <AppText variant="body" tone="soft">No upcoming trips are planned.</AppText>
                </PaperCard>
              )}
            </View>

            <View className="mt-10" testID="past-trips-section">
              <Pressable
                testID="toggle-past-trips"
                accessibilityRole="button"
                accessibilityState={{ expanded: pastExpanded }}
                accessibilityLabel={`${pastExpanded ? 'Hide' : 'Show'} past trips`}
                onPress={() => setPastExpanded((current) => !current)}
                className="min-h-12 flex-row items-center justify-between active:opacity-70">
                <View>
                  <AppText variant="label" tone="muted" className="uppercase">Archive</AppText>
                  <AppText variant="title" className="mt-1">Past trips</AppText>
                </View>
                <View className="flex-row items-center">
                  <AppText variant="meta" tone="muted" className="mr-2">{groups.past.length}</AppText>
                  {pastExpanded ? <ChevronUp color={colors.inkMuted} size={20} /> : <ChevronDown color={colors.inkMuted} size={20} />}
                </View>
              </Pressable>
              {pastExpanded ? (
                groups.past.length > 0 ? (
                  <View className="mt-4">
                    {groups.past.map((trip) => <TripCard key={trip.id} trip={trip} emphasis="past" />)}
                  </View>
                ) : (
                  <PaperCard testID="past-trips-empty" className="mt-4 py-4">
                    <AppText variant="body" tone="soft">Past trips will rest here quietly.</AppText>
                  </PaperCard>
                )
              ) : null}
            </View>
          </>
        )}
      </PageScroll>
    </Screen>
  );
}
