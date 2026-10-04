import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleOff, MapPinned, Plus, X } from 'lucide-react-native';
import {
  AppText,
  colors,
  ErrorState,
  FocusableTextInput,
  LoadingState,
  PaperCard,
  PrimaryButton,
  radii,
  Screen,
  SecondaryButton,
} from '@/components/ui';
import { CalendarDateInput } from '@/components/CalendarDateInput';
import { duodateApi, queryKeys } from '@/lib/api/duodate';
import { formatCalendarDate } from '@/lib/format';
import { usePlanningContextStore } from '@/lib/planning-context-store';
import {
  applyTripDateSelection,
  buildTripCreateInput,
  buildTripUpdateInput,
  destinationTimeZoneForCreation,
  initialTripDates,
  resolveTripDestinationTimeZone,
} from '@/lib/travel';

function inputContainerStyle() {
  return {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.lineStrong,
    borderRadius: radii.medium,
    minHeight: 54,
  };
}

export default function TripFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);
  const queryClient = useQueryClient();
  const selectedContextKey = usePlanningContextStore((state) => state.selectedContextKey);
  const setSelectedContextKey = usePlanningContextStore((state) => state.setSelectedContextKey);
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap });
  const destinations = useQuery({ queryKey: queryKeys.destinations, queryFn: duodateApi.destinations });
  const trip = useQuery({
    queryKey: queryKeys.trip(id ?? ''),
    queryFn: () => duodateApi.trip(id!),
    enabled: editing,
  });
  const initialized = useRef<boolean>(false);
  const datesTouched = useRef<boolean>(false);
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);
  const [creatingDestination, setCreatingDestination] = useState<boolean>(false);
  const [destinationName, setDestinationName] = useState<string>('');
  const [destinationCountry, setDestinationCountry] = useState<string>('');
  const [destinationTimeZone, setDestinationTimeZone] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<boolean>(false);

  useEffect(() => {
    if (initialized.current || !bootstrap.data || !destinations.data || (editing && !trip.data)) return;
    if (editing && trip.data) {
      setSelectedDestinationId(trip.data.destination.id);
      setName(trip.data.name ?? '');
      setStartDate(trip.data.startDate);
      setEndDate(trip.data.endDate);
    } else {
      const firstDestination = destinations.data[0] ?? null;
      const timeZone = firstDestination?.timeZone ?? bootstrap.data.household.defaultTimeZone;
      const dates = initialTripDates(timeZone);
      setStartDate(dates.startDate);
      setEndDate(dates.endDate);
      setSelectedDestinationId(firstDestination?.id ?? null);
      setCreatingDestination(destinations.data.length === 0);
    }
    initialized.current = true;
  }, [bootstrap.data, destinations.data, editing, trip.data]);

  const selectedDestination = useMemo(
    () => destinations.data?.find((destination) => destination.id === selectedDestinationId) ?? null,
    [destinations.data, selectedDestinationId],
  );
  const inferredDestinationTimeZone = resolveTripDestinationTimeZone(
    destinationName,
    bootstrap.data?.spaces ?? [],
  );
  const newDestinationTimeZone = destinationTimeZoneForCreation(
    destinationName,
    bootstrap.data?.spaces ?? [],
    destinationTimeZone,
  );
  const pickerTimeZone = editing
    ? trip.data?.destination.timeZone ?? bootstrap.data?.household.defaultTimeZone ?? 'UTC'
    : creatingDestination
      ? newDestinationTimeZone
      : selectedDestination?.timeZone ?? bootstrap.data?.household.defaultTimeZone ?? 'UTC';
  const localTimePlace = editing
    ? trip.data?.destination.name ?? 'the destination'
    : creatingDestination
      ? destinationName.trim() || 'the destination'
      : selectedDestination?.name ?? 'the destination';

  const updateTripDate = (target: 'start' | 'end', selectedDate: string) => {
    datesTouched.current = true;
    const next = applyTripDateSelection(startDate, endDate, target, selectedDate);
    setStartDate(next.startDate);
    setEndDate(next.endDate);
    if (Platform.OS === 'android') setPicker(null);
  };

  const selectDestination = (destinationId: string, timeZone: string) => {
    setSelectedDestinationId(destinationId);
    if (editing || datesTouched.current) return;
    const dates = initialTripDates(timeZone);
    setStartDate(dates.startDate);
    setEndDate(dates.endDate);
  };

  const updateDestinationDates = (timeZone: string | null) => {
    if (editing || datesTouched.current || !timeZone) return;
    const dates = initialTripDates(timeZone);
    setStartDate(dates.startDate);
    setEndDate(dates.endDate);
  };

  const updateDestinationName = (value: string) => {
    setDestinationName(value);
    updateDestinationDates(destinationTimeZoneForCreation(
      value,
      bootstrap.data?.spaces ?? [],
      destinationTimeZone,
    ));
  };

  const updateDestinationTimeZone = (value: string) => {
    setDestinationTimeZone(value);
    updateDestinationDates(destinationTimeZoneForCreation(
      destinationName,
      bootstrap.data?.spaces ?? [],
      value,
    ));
  };

  const openDatePicker = (target: 'start' | 'end') => {
    if (creatingDestination && !newDestinationTimeZone) {
      setClientError('Enter a valid IANA time zone before choosing dates.');
      return;
    }
    setClientError(null);
    setPicker(target);
  };

  const invalidateTravel = async (tripId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.trips }),
      queryClient.invalidateQueries({ queryKey: queryKeys.destinations }),
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
      queryClient.invalidateQueries({ queryKey: ['ideas'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.letsDateRoot }),
      ...(tripId ? [queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) })] : []),
    ]);
  };

  const save = useMutation({
    mutationFn: async () => {
      setClientError(null);
      if (!startDate || !endDate) throw new Error('Choose a start and end date.');
      if (startDate > endDate) throw new Error('The trip must end on or after it starts.');

      if (editing && id) {
        return duodateApi.updateTrip(id, buildTripUpdateInput({ name, startDate, endDate }));
      }

      let destinationId = selectedDestinationId;
      if (creatingDestination) {
        const normalizedName = destinationName.trim();
        if (!normalizedName) throw new Error('Give the destination a name.');
        const existing = destinations.data?.find(
          (destination) => destination.name.trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
        );
        if (existing) {
          destinationId = existing.id;
        } else {
          const timeZone = destinationTimeZoneForCreation(
            normalizedName,
            bootstrap.data?.spaces ?? [],
            destinationTimeZone,
          );
          if (!timeZone) {
            throw new Error('Enter a valid IANA time zone, such as Europe/Lisbon.');
          }
          const created = await duodateApi.createDestination({
            name: normalizedName,
            country: destinationCountry.trim() || null,
            timeZone,
          });
          destinationId = created.id;
          setSelectedDestinationId(created.id);
          setCreatingDestination(false);
          await queryClient.invalidateQueries({ queryKey: queryKeys.destinations });
        }
      }
      if (!destinationId) throw new Error('Choose a destination.');

      return duodateApi.createTrip(buildTripCreateInput({ destinationId, name, startDate, endDate }));
    },
    onSuccess: async (savedTrip) => {
      await invalidateTravel(savedTrip.id);
      if (editing) router.back();
      else router.replace({ pathname: '/trip/[id]', params: { id: savedTrip.id } });
    },
    onError: (error) => setClientError(error instanceof Error ? error.message : 'The trip could not be saved.'),
  });

  const cancelTrip = useMutation({
    mutationFn: () => duodateApi.deleteTrip(id!),
    onSuccess: async () => {
      if (selectedContextKey === `TRIP:${id}`) setSelectedContextKey(null);
      await invalidateTravel();
      queryClient.removeQueries({ queryKey: queryKeys.trip(id!), exact: true });
      router.dismissTo('/travel');
    },
  });

  const loading = bootstrap.isLoading || destinations.isLoading || (editing && trip.isLoading);
  const failed = bootstrap.isError || destinations.isError || (editing && (trip.isError || !trip.data));

  if (loading) return <Screen testID="trip-form-screen"><LoadingState label={editing ? 'Opening trip details…' : 'Preparing a new trip…'} /></Screen>;
  if (failed || !bootstrap.data || !destinations.data) {
    return (
      <Screen testID="trip-form-screen">
        <ErrorState
          message="We couldn't load the details needed for this trip."
          onRetry={() => void Promise.all([bootstrap.refetch(), destinations.refetch(), trip.refetch()])}
        />
      </Screen>
    );
  }

  const pickerDate = picker === 'end' ? endDate : startDate;

  return (
    <Screen testID="trip-form-screen" edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <View className="flex-row items-center justify-between px-5 py-3">
          <Pressable
            testID="trip-form-close"
            accessibilityRole="button"
            accessibilityLabel="Close trip form"
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
            style={{ backgroundColor: colors.surface }}>
            <X color={colors.ink} size={22} />
          </Pressable>
          <AppText variant="label" tone="muted">{editing ? 'EDIT TRIP' : 'NEW TRIP'}</AppText>
          <View className="h-12 w-12" />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="px-5 pb-36">
          <View className="pt-5">
            <AppText variant="display" className="leading-[44px]">{editing ? 'Trip details' : 'Where are you going?'}</AppText>
            <AppText variant="body" tone="soft" className="mt-2">
              A destination and date range are enough to start planning together.
            </AppText>
          </View>

          <View className="mt-8">
            <AppText variant="label">Destination</AppText>
            {editing && trip.data ? (
              <PaperCard testID="fixed-trip-destination" className="mt-3 flex-row items-center py-4">
                <View className="h-10 w-10 items-center justify-center rounded-2xl" style={{ backgroundColor: colors.sageSoft }}>
                  <MapPinned color={colors.sage} size={20} />
                </View>
                <View className="ml-3 flex-1">
                  <AppText variant="heading">{trip.data.destination.name}</AppText>
                  <AppText variant="meta" tone="muted" className="mt-0.5">
                    To change destination, create a new trip so this history stays intact.
                  </AppText>
                </View>
              </PaperCard>
            ) : (
              <>
                {!creatingDestination ? (
                  <View className="mt-2 flex-row flex-wrap">
                    {destinations.data.map((destination) => {
                      const selected = selectedDestinationId === destination.id;
                      return (
                        <Pressable
                          key={destination.id}
                          testID={`trip-destination-${destination.id}`}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => selectDestination(destination.id, destination.timeZone)}
                          className="mb-2 mr-2 min-h-11 justify-center border px-4 active:opacity-75"
                          style={{
                            backgroundColor: selected ? colors.ink : colors.surface,
                            borderColor: selected ? colors.ink : colors.lineStrong,
                            borderRadius: radii.pill,
                          }}>
                          <AppText variant="label" tone={selected ? 'inverse' : 'default'}>{destination.name}</AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <PaperCard testID="new-destination-fields" className="mt-3 py-4">
                    <AppText variant="heading">New destination</AppText>
                    <FocusableTextInput
                      testID="destination-name-input"
                      accessibilityLabel="Destination name"
                      value={destinationName}
                      onChangeText={updateDestinationName}
                      placeholder="Enter a destination"
                      placeholderTextColor={colors.inkMuted}
                      containerClassName="mt-4 border"
                      containerStyle={inputContainerStyle()}
                      className="flex-1 px-4 text-base"
                      style={{ color: colors.ink }}
                      maxLength={120}
                    />
                    <FocusableTextInput
                      testID="destination-country-input"
                      accessibilityLabel="Destination country, optional"
                      value={destinationCountry}
                      onChangeText={setDestinationCountry}
                      placeholder="Country, optional"
                      placeholderTextColor={colors.inkMuted}
                      containerClassName="mt-3 border"
                      containerStyle={inputContainerStyle()}
                      className="flex-1 px-4 text-base"
                      style={{ color: colors.ink }}
                      maxLength={100}
                    />
                    {inferredDestinationTimeZone ? (
                      <AppText testID="destination-time-zone-inferred" variant="meta" tone="muted" className="mt-3">
                        Local time zone: {inferredDestinationTimeZone}
                      </AppText>
                    ) : (
                      <FocusableTextInput
                        testID="destination-time-zone-input"
                        accessibilityLabel="Destination IANA time zone"
                        value={destinationTimeZone}
                        onChangeText={updateDestinationTimeZone}
                        placeholder="Time zone, e.g. Europe/Lisbon"
                        placeholderTextColor={colors.inkMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        containerClassName="mt-3 border"
                        containerStyle={inputContainerStyle()}
                        className="flex-1 px-4 text-base"
                        style={{ color: colors.ink }}
                        maxLength={100}
                      />
                    )}
                    <AppText variant="meta" tone="muted" className="mt-3">
                      Dates will follow the destination&apos;s local day.
                    </AppText>
                  </PaperCard>
                )}
                {destinations.data.length > 0 ? (
                  <Pressable
                    testID="toggle-new-destination"
                    accessibilityRole="button"
                    accessibilityLabel={creatingDestination ? 'Choose an existing destination' : 'Create a new destination'}
                    onPress={() => setCreatingDestination((current) => !current)}
                    className="mt-2 min-h-11 flex-row items-center self-start px-2 active:opacity-70">
                    <Plus color={colors.rose} size={17} />
                    <AppText variant="label" tone="accent" className="ml-2">
                      {creatingDestination ? 'Choose an existing destination' : 'Create a new destination'}
                    </AppText>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>

          <View className="mt-8">
            <View className="flex-row items-baseline">
              <AppText variant="label">Trip name</AppText>
              <AppText variant="meta" tone="muted" className="ml-2">Optional</AppText>
            </View>
            <FocusableTextInput
              testID="trip-name-input"
              accessibilityLabel="Optional trip name"
              value={name}
              onChangeText={setName}
              placeholder="Give this trip a name"
              placeholderTextColor={colors.inkMuted}
              containerClassName="mt-2 border"
              containerStyle={inputContainerStyle()}
              className="flex-1 px-4 text-base"
              style={{ color: colors.ink }}
              maxLength={160}
            />
          </View>

          <View className="mt-8">
            <AppText variant="label">Dates</AppText>
            <AppText variant="meta" tone="muted" className="mt-1">
              Dates follow {localTimePlace} local time.
            </AppText>
            <View className="mt-3 flex-row">
              <Pressable
                testID="trip-start-date"
                accessibilityRole="button"
                accessibilityLabel={`Trip starts ${startDate ? formatCalendarDate(startDate) : 'not selected'}`}
                onPress={() => openDatePicker('start')}
                className="mr-2 min-h-16 flex-1 justify-center border px-4 active:opacity-70"
                style={{ backgroundColor: colors.surface, borderColor: colors.lineStrong, borderRadius: radii.medium }}>
                <AppText variant="meta" tone="muted">From</AppText>
                <AppText variant="label" className="mt-1">{startDate ? formatCalendarDate(startDate) : 'Choose date'}</AppText>
              </Pressable>
              <Pressable
                testID="trip-end-date"
                accessibilityRole="button"
                accessibilityLabel={`Trip ends ${endDate ? formatCalendarDate(endDate) : 'not selected'}`}
                onPress={() => openDatePicker('end')}
                className="ml-2 min-h-16 flex-1 justify-center border px-4 active:opacity-70"
                style={{ backgroundColor: colors.surface, borderColor: colors.lineStrong, borderRadius: radii.medium }}>
                <AppText variant="meta" tone="muted">Until</AppText>
                <AppText variant="label" className="mt-1">{endDate ? formatCalendarDate(endDate) : 'Choose date'}</AppText>
              </Pressable>
            </View>
          </View>

          {picker && pickerDate && pickerTimeZone ? (
            <PaperCard testID="trip-date-picker" className="mt-4 py-3">
              <View className="flex-row items-center justify-between">
                <AppText variant="label">Choose {picker === 'start' ? 'start' : 'end'} date</AppText>
                <Pressable
                  testID="trip-date-picker-done"
                  accessibilityRole="button"
                  accessibilityLabel="Finish choosing date"
                  onPress={() => setPicker(null)}
                  className="min-h-11 justify-center px-3">
                  <AppText variant="label" tone="accent">Done</AppText>
                </Pressable>
              </View>
              <CalendarDateInput
                testID={Platform.OS === 'web' ? 'trip-web-date-input' : 'trip-native-date-picker'}
                value={pickerDate}
                minimumDate={picker === 'end' ? startDate : undefined}
                timeZone={pickerTimeZone}
                onChange={(value) => updateTripDate(picker, value)}
                onDismiss={() => setPicker(null)}
              />
            </PaperCard>
          ) : null}

          {clientError || save.isError ? (
            <View
              testID="trip-save-error"
              className="mt-6 border px-4 py-3"
              style={{ backgroundColor: colors.dangerSoft, borderColor: colors.roseSoft, borderRadius: radii.medium }}>
              <AppText variant="meta" tone="danger">{clientError ?? 'The trip could not be saved. Please try again.'}</AppText>
            </View>
          ) : null}

          {editing && trip.data && trip.data.status !== 'CANCELLED' ? (
            <View className="mt-10 border-t pt-7" style={{ borderColor: colors.line }}>
              <AppText variant="heading">Cancel this trip</AppText>
              <AppText variant="body" tone="soft" className="mt-1">
                The trip will move to your archive. Its destination and ideas stay preserved.
              </AppText>
              <View className="mt-4">
                <SecondaryButton
                  testID="cancel-trip-button"
                  label="Cancel trip"
                  icon={<CircleOff color={colors.danger} size={18} />}
                  onPress={() => setConfirmCancel(true)}
                />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View className="absolute bottom-0 left-0 right-0 border-t px-5 pb-4 pt-3" style={{ backgroundColor: colors.paper, borderColor: colors.line }}>
          <PrimaryButton
            testID="save-trip-button"
            label={editing ? 'Save changes' : 'Create trip'}
            loading={save.isPending}
            icon={<Check color={colors.surface} size={19} />}
            onPress={() => save.mutate()}
          />
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={confirmCancel}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!cancelTrip.isPending) setConfirmCancel(false);
        }}>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(40,38,33,0.34)' }}>
          <Pressable
            testID="cancel-trip-backdrop"
            accessibilityRole="button"
            accessibilityLabel="Keep trip"
            disabled={cancelTrip.isPending}
            onPress={() => setConfirmCancel(false)}
            className="flex-1"
          />
          <View className="px-5 pb-7 pt-5" style={{ backgroundColor: colors.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28 }}>
            <AppText variant="title">Cancel this trip?</AppText>
            <AppText variant="body" tone="soft" className="mt-2">
              The trip will be marked cancelled and kept in your archive. Its destination and saved ideas remain available.
            </AppText>
            {cancelTrip.isError ? (
              <AppText testID="cancel-trip-error" variant="meta" tone="danger" className="mt-4">
                This trip could not be cancelled. Please try again.
              </AppText>
            ) : null}
            <View className="mt-6">
              <PrimaryButton
                testID="confirm-cancel-trip"
                label="Cancel trip"
                loading={cancelTrip.isPending}
                icon={<CircleOff color={colors.surface} size={18} />}
                onPress={() => cancelTrip.mutate()}
              />
            </View>
            <Pressable
              testID="keep-trip-button"
              accessibilityRole="button"
              accessibilityLabel="Keep trip"
              disabled={cancelTrip.isPending}
              onPress={() => setConfirmCancel(false)}
              className="mt-2 min-h-12 items-center justify-center"
              style={{ opacity: cancelTrip.isPending ? 0.45 : 1 }}>
              <AppText variant="label">Keep trip</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
