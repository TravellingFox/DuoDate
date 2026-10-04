import { newIdeaDraftSession } from '@/lib/idea-draft-session';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  ImagePlus,
  MapPinned,
  Pencil,
  Plus,
  Route,
  Sparkles,
  Trash2,
} from 'lucide-react-native';
import { AuthenticatedTripHeroImage } from '@/components/AuthenticatedTripHeroImage';
import { IdeaCard } from '@/components/IdeaCard';
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
} from '@/components/ui';
import {
  duodateApi,
  queryKeys,
  type TripPlanning,
  type TripPlanningIdea,
  type TripStatus,
} from '@/lib/api/duodate';
import { uploadTripHero } from '@/lib/api/trip-hero';
import { formatCalendarDate } from '@/lib/format';
import { usePlanningContextStore } from '@/lib/planning-context-store';

function statusPresentation(status: TripStatus, primary: boolean) {
  if (status === 'ACTIVE') {
    return {
      eyebrow: primary ? 'CURRENT TRIP' : 'ACTIVE TRIP',
      background: colors.sageSoft,
      accent: colors.sage,
      note: primary ? 'Your ideas are ready for the days you are here.' : 'This trip is active in local time.',
    };
  }
  if (status === 'UPCOMING') {
    return {
      eyebrow: 'PLANNING AHEAD',
      background: colors.blueSoft,
      accent: colors.blue,
      note: 'Save a few possibilities now. Decide what fits when the trip gets closer.',
    };
  }
  if (status === 'CANCELLED') {
    return {
      eyebrow: 'CANCELLED',
      background: colors.paperDeep,
      accent: colors.inkMuted,
      note: 'This trip is preserved in your archive with its destination ideas.',
    };
  }
  return {
    eyebrow: 'PAST TRIP',
    background: colors.paperDeep,
    accent: colors.inkMuted,
    note: 'Unfinished ideas stay saved for another visit.',
  };
}

function categoryKey(idea: TripPlanningIdea) {
  return idea.category?.id ?? 'uncategorized';
}

function tripLocationLine(country: string | null) {
  return country ? `${country} · Dates and times are local` : 'Dates and times are shown in local time';
}

export default function TripPlanningScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<string>('all');
  const [heroError, setHeroError] = useState<string | null>(null);
  const [confirmRemoveHero, setConfirmRemoveHero] = useState<boolean>(false);
  const setSelectedContextKey = usePlanningContextStore((state) => state.setSelectedContextKey);
  const trip = useQuery({
    queryKey: queryKeys.trip(id),
    queryFn: () => duodateApi.trip(id),
    enabled: Boolean(id),
    refetchInterval: 60_000,
  });
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap });

  const uploadHero = useMutation({
    mutationFn: (asset: ImagePicker.ImagePickerAsset) => uploadTripHero(id, asset),
    onSuccess: (savedHero) => {
      setHeroError(null);
      queryClient.setQueryData<TripPlanning>(queryKeys.trip(id), (current) =>
        current ? { ...current, hero: savedHero } : current,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips });
    },
    onError: (error) => {
      setHeroError(error instanceof Error ? error.message : 'The trip photo could not be saved.');
    },
  });
  const removeHero = useMutation({
    mutationFn: () => duodateApi.deleteTripHero(id),
    onSuccess: () => {
      setHeroError(null);
      queryClient.setQueryData<TripPlanning>(queryKeys.trip(id), (current) =>
        current ? { ...current, hero: null } : current,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips });
      setConfirmRemoveHero(false);
    },
    onError: () => setHeroError('The trip photo could not be removed.'),
  });

  const categories = useMemo(() => {
    const seen = new Set<string>();
    return (trip.data?.destination.ideas ?? []).flatMap((idea) => {
      if (!idea.category || seen.has(idea.category.id)) return [];
      seen.add(idea.category.id);
      return [{ id: idea.category.id, name: idea.category.name }];
    });
  }, [trip.data?.destination.ideas]);

  const visibleIdeas = useMemo(() => {
    const ideas = trip.data?.destination.ideas ?? [];
    return categoryId === 'all' ? ideas : ideas.filter((idea) => categoryKey(idea) === categoryId);
  }, [categoryId, trip.data?.destination.ideas]);

  const chooseHero = async () => {
    setHeroError(null);
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setHeroError('Photo-library access is needed to choose a trip photo.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.84 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > 15 * 1024 * 1024) {
      setHeroError('Choose a photo smaller than 15 MB.');
      return;
    }
    uploadHero.mutate(asset);
  };

  if (trip.isLoading || bootstrap.isLoading) {
    return <Screen testID="trip-planning-screen"><LoadingState label="Opening your trip…" /></Screen>;
  }
  if (trip.isError || bootstrap.isError || !trip.data || !bootstrap.data) {
    return (
      <Screen testID="trip-planning-screen">
        <View className="px-5 pt-3">
          <Pressable
            testID="trip-back-button"
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.surface }}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
        </View>
        <ErrorState message="We couldn't open this trip." onRetry={() => void Promise.all([trip.refetch(), bootstrap.refetch()])} />
      </Screen>
    );
  }

  const value = trip.data;
  const isPrimaryActive =
    value.status === 'ACTIVE' &&
    bootstrap.data.defaultPlanningContext.kind === 'TRIP' &&
    bootstrap.data.defaultPlanningContext.id === value.id;
  const presentation = statusPresentation(value.status, isPrimaryActive);
  const title = value.name ?? value.destination.name;
  const initialScheduleDate = value.status === 'UPCOMING' ? value.startDate : value.localToday;
  const scheduledCount = value.destination.ideas.filter((idea) => idea.planning.scheduled).length;
  const canPlan = value.status === 'ACTIVE' || value.status === 'UPCOMING';
  const heroBusy = uploadHero.isPending || removeHero.isPending;

  return (
    <Screen testID="trip-planning-screen" edges={['top']}>
      <PageScroll
        refreshing={trip.isRefetching || bootstrap.isRefetching}
        onRefresh={() => void Promise.all([trip.refetch(), bootstrap.refetch()])}
        contentContainerClassName="pt-3">
        <View className="flex-row items-center justify-between">
          <Pressable
            testID="trip-back-button"
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
            style={{ backgroundColor: colors.surface }}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
          {value.status !== 'CANCELLED' ? (
            <Pressable
              testID="edit-trip-button"
              accessibilityRole="button"
              accessibilityLabel={`Edit ${title}`}
              onPress={() => router.push({ pathname: '/trip-form', params: { id: value.id } })}
              className="min-h-12 flex-row items-center px-4 active:opacity-70">
              <Pencil color={colors.inkSoft} size={17} />
              <AppText variant="label" className="ml-2">Edit trip</AppText>
            </Pressable>
          ) : <View className="h-12" />}
        </View>

        <PaperCard testID="trip-hero" className="mt-5 overflow-hidden p-0">
          {value.hero ? (
            <View className="relative">
              <AuthenticatedTripHeroImage key={value.hero.id} hero={value.hero} />
              <View className="absolute left-0 right-0 top-0 flex-row items-start justify-between px-5 py-5">
                <View className="min-h-8 justify-center rounded-full px-3" style={{ backgroundColor: presentation.accent }}>
                  <AppText variant="label" tone="inverse" className="text-xs">{presentation.eyebrow}</AppText>
                </View>
              </View>
              <View className="absolute bottom-0 left-0 right-0 px-5 py-4" style={{ backgroundColor: 'rgba(24,24,22,0.68)' }}>
                <AppText variant="display" tone="inverse" className="leading-[42px]">{title}</AppText>
                {value.name ? <AppText variant="body" tone="inverse" className="mt-0.5 opacity-90">{value.destination.name}</AppText> : null}
              </View>
            </View>
          ) : (
            <View className="min-h-52 justify-between px-5 py-5" style={{ backgroundColor: presentation.background }}>
              <View className="flex-row items-start justify-between">
                <View className="min-h-8 justify-center rounded-full px-3" style={{ backgroundColor: presentation.accent }}>
                  <AppText variant="label" tone="inverse" className="text-xs">{presentation.eyebrow}</AppText>
                </View>
                <Route color={presentation.accent} size={31} />
              </View>
              <View className="mt-8">
                <AppText variant="display" className="leading-[44px]">{title}</AppText>
                {value.name ? <AppText variant="body" tone="soft" className="mt-1">{value.destination.name}</AppText> : null}
              </View>
            </View>
          )}
          <View className="px-5 py-5">
            <View className="flex-row items-center">
              <CalendarDays color={colors.inkMuted} size={18} />
              <AppText variant="body" className="ml-2">
                {formatCalendarDate(value.startDate, 'd MMM yyyy')} – {formatCalendarDate(value.endDate, 'd MMM yyyy')}
              </AppText>
            </View>
            <View className="mt-3 flex-row items-center">
              <MapPinned color={colors.inkMuted} size={18} />
              <AppText variant="meta" tone="muted" className="ml-2">{tripLocationLine(value.destination.country)}</AppText>
            </View>
            <AppText variant="body" tone="soft" className="mt-4">{presentation.note}</AppText>
            <View testID="trip-hero-photo-actions" className="mt-4 flex-row border-t pt-3" style={{ borderColor: colors.line }}>
              <Pressable
                testID={value.hero ? 'change-trip-hero-button' : 'add-trip-hero-button'}
                accessibilityRole="button"
                accessibilityLabel={value.hero ? 'Change trip photo' : 'Add trip photo'}
                disabled={heroBusy}
                onPress={() => void chooseHero()}
                className="min-h-11 flex-row items-center pr-4 active:opacity-70"
                style={{ opacity: heroBusy ? 0.45 : 1 }}>
                <ImagePlus color={colors.rose} size={18} />
                <AppText variant="label" tone="accent" className="ml-2">{value.hero ? 'Change' : 'Add photo'}</AppText>
              </Pressable>
              {value.hero ? (
                <Pressable
                  testID="remove-trip-hero-button"
                  accessibilityRole="button"
                  accessibilityLabel="Remove trip photo"
                  disabled={heroBusy}
                  onPress={() => setConfirmRemoveHero(true)}
                  className="min-h-11 flex-row items-center px-4 active:opacity-70"
                  style={{ opacity: heroBusy ? 0.45 : 1 }}>
                  <Trash2 color={colors.danger} size={17} />
                  <AppText variant="label" tone="danger" className="ml-2">Remove</AppText>
                </Pressable>
              ) : null}
            </View>
            {heroError ? (
              <AppText testID="trip-hero-error" variant="meta" tone="danger" className="mt-2">
                {heroError ?? 'The trip photo could not be loaded. Pull down to try again.'}
              </AppText>
            ) : null}
          </View>
        </PaperCard>

        {isPrimaryActive ? (
          <Pressable
            testID="trip-lets-date-button"
            accessibilityRole="button"
            accessibilityLabel={`Use Let's Date for ${title}`}
            onPress={() => {
              setSelectedContextKey(`TRIP:${value.id}`);
              router.navigate('/(tabs)/lets-date');
            }}
            className="mt-5 flex-row items-center px-5 py-4 active:opacity-80"
            style={{ backgroundColor: colors.ink, borderRadius: radii.large }}>
            <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: colors.rose }}>
              <Sparkles color={colors.surface} size={21} />
            </View>
            <View className="ml-4 min-w-0 flex-1">
              <AppText variant="heading" tone="inverse">Let&apos;s Date here</AppText>
              <AppText variant="meta" tone="inverse" className="mt-0.5 opacity-80">Choose from ideas that fit today</AppText>
            </View>
          </Pressable>
        ) : null}

        <View className="mt-10 flex-row items-end justify-between">
          <View className="min-w-0 flex-1 pr-4">
            <AppText variant="title">Ideas</AppText>
            <AppText variant="meta" tone="muted" className="mt-1">
              {value.destination.ideas.length} {value.destination.ideas.length === 1 ? 'idea' : 'ideas'}
              {scheduledCount > 0 ? ` · ${scheduledCount} planned` : null}
            </AppText>
          </View>
          {canPlan ? (
            <Pressable
              testID="trip-add-idea-button"
              accessibilityRole="button"
              accessibilityLabel={`Add an idea for ${value.destination.name}`}
              onPress={() => router.push({
                pathname: '/add-idea',
                params: { destinationId: value.destination.id, tripId: value.id, draftSession: newIdeaDraftSession() },
              })}
              className="min-h-11 flex-row items-center px-2 active:opacity-70">
              <Plus color={colors.rose} size={18} />
              <AppText variant="label" tone="accent" className="ml-1">Add idea</AppText>
            </Pressable>
          ) : null}
        </View>

        {categories.length > 1 ? (
          <View testID="trip-category-filters" className="mt-4 flex-row flex-wrap">
            {[{ id: 'all', name: 'All' }, ...categories].map((category) => {
              const selected = categoryId === category.id;
              return (
                <Pressable
                  key={category.id}
                  testID={`trip-category-${category.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCategoryId(category.id)}
                  className="mb-2 mr-2 min-h-11 justify-center border px-4 active:opacity-75"
                  style={{
                    backgroundColor: selected ? colors.ink : colors.surface,
                    borderColor: selected ? colors.ink : colors.lineStrong,
                    borderRadius: radii.pill,
                  }}>
                  <AppText variant="label" tone={selected ? 'inverse' : 'default'}>{category.name}</AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View testID="trip-ideas-list" className="mt-5">
          {visibleIdeas.length > 0 ? (
            visibleIdeas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onPress={() => router.push({
                  pathname: '/idea/[id]',
                  params: {
                    id: idea.id,
                    contextTimeZone: value.destination.timeZone,
                    initialScheduleDate,
                  },
                })}
              />
            ))
          ) : categoryId !== 'all' ? (
            <EmptyState
              testID="trip-category-empty"
              title="No ideas in this category"
              message="Choose another category to keep browsing."
            />
          ) : (
            <EmptyState
              testID="trip-ideas-empty"
              title="No ideas yet"
              message={canPlan
                ? 'Save a place, event, or simple thing you might enjoy together.'
                : 'Ideas saved for this destination will be ready for another visit.'}
            />
          )}
        </View>
      </PageScroll>

      <Modal
        visible={confirmRemoveHero}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!removeHero.isPending) setConfirmRemoveHero(false);
        }}>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(40,38,33,0.34)' }}>
          <Pressable
            testID="remove-trip-hero-backdrop"
            accessibilityRole="button"
            accessibilityLabel="Keep trip photo"
            disabled={removeHero.isPending}
            onPress={() => setConfirmRemoveHero(false)}
            className="flex-1"
          />
          <View className="px-5 pb-7 pt-5" style={{ backgroundColor: colors.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28 }}>
            <AppText variant="title">Remove this photo?</AppText>
            <AppText variant="body" tone="soft" className="mt-2">The trip and all of its ideas will stay unchanged.</AppText>
            <View className="mt-6">
              <Pressable
                testID="confirm-remove-trip-hero"
                accessibilityRole="button"
                accessibilityLabel="Remove trip photo"
                disabled={removeHero.isPending}
                onPress={() => removeHero.mutate()}
                className="min-h-14 flex-row items-center justify-center rounded-full"
                style={{ backgroundColor: colors.ink, opacity: removeHero.isPending ? 0.6 : 1 }}>
                <Trash2 color={colors.surface} size={18} />
                <AppText variant="label" tone="inverse" className="ml-2">
                  {removeHero.isPending ? 'Removing…' : 'Remove photo'}
                </AppText>
              </Pressable>
            </View>
            <Pressable
              testID="keep-trip-hero-button"
              accessibilityRole="button"
              accessibilityLabel="Keep trip photo"
              disabled={removeHero.isPending}
              onPress={() => setConfirmRemoveHero(false)}
              className="mt-2 min-h-12 items-center justify-center"
              style={{ opacity: removeHero.isPending ? 0.45 : 1 }}>
              <AppText variant="label">Keep photo</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
