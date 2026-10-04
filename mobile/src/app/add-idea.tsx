import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from 'date-fns';
import {
  CalendarDays,
  Camera,
  Check,
  Clock3,
  ImagePlus,
  Link2,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';
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
} from '@/components/ui';
import {
  type AvailabilityMode,
  type CostBand,
  duodateApi,
  type DurationBand,
  type IdeaCreateInput,
  queryKeys,
  type RecurrenceWeekday,
  type WeatherState,
  type WeatherSuitability,
} from '@/lib/api/duodate';
import { uploadIdeaImage } from '@/lib/api/idea-image';
import { ApiError } from '@/lib/api/api';
import { prepareIdeaAttachment } from '@/lib/idea-attachment';
import { nativePickerAsset } from '@/lib/native-picker-asset';
import { launchNativeMediaPicker, useNativeMediaPicker } from '@/lib/native-media-picker';
import { mediaStorage } from '@/lib/media-storage';
import { createIdeaPhotoDraft, ideaPhotoDraftKey } from '@/lib/idea-photo-draft';
import { normalizeWebsiteUrl, websiteValidationMessage } from '@/lib/website';
import {
  calendarDateInTimeZone,
  costLabels,
  dateForZonedWallTime,
  durationLabels,
  formatCalendarDate,
  localTimeInTimeZone,
  readableLinkLabel,
  todayCalendarDate,
} from '@/lib/format';
import { hasRequiredText, selectedPickerAsset } from '@/lib/form-state';
import {
  activePlanningSpaces,
  ideaContextAssignments,
  postSaveIdeaTarget,
} from '@/lib/planning-context';

interface LinkDraft {
  key: number;
  url: string;
  label: string;
  editing: boolean;
  error?: string | null;
}

interface OccurrenceDraft {
  key: number;
  date: string;
  time: Date | null;
}

type PickerTarget =
  | { kind: 'range-start' }
  | { kind: 'range-end' }
  | { kind: 'recurrence-start' }
  | { kind: 'occurrence-date'; index: number }
  | { kind: 'occurrence-time'; index: number };

type RecurrenceKind = 'NONE' | 'WEEKLY' | 'MONTHLY_ORDINAL_WEEKDAY';

const weekdayOptions: { value: RecurrenceWeekday; shortLabel: string; label: string }[] = [
  { value: 'MONDAY', shortLabel: 'M', label: 'Monday' },
  { value: 'TUESDAY', shortLabel: 'T', label: 'Tuesday' },
  { value: 'WEDNESDAY', shortLabel: 'W', label: 'Wednesday' },
  { value: 'THURSDAY', shortLabel: 'T', label: 'Thursday' },
  { value: 'FRIDAY', shortLabel: 'F', label: 'Friday' },
  { value: 'SATURDAY', shortLabel: 'S', label: 'Saturday' },
  { value: 'SUNDAY', shortLabel: 'S', label: 'Sunday' },
];

const ordinalOptions = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: 5, label: 'Fifth' },
];

const costOptions: { value: CostBand; label: string }[] = Object.entries(costLabels).map(
  ([value, label]) => ({ value: value as CostBand, label }),
);
const durationOptions: { value: DurationBand; label: string }[] = Object.entries(durationLabels).map(
  ([value, label]) => ({ value: value as DurationBand, label }),
);
const weatherOrder: WeatherState[] = ['NEUTRAL', 'GOOD', 'IMPOSSIBLE'];

function ChoiceChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className="mr-2 mt-2 min-h-11 justify-center border px-4 active:opacity-75"
      style={{
        backgroundColor: selected ? colors.ink : colors.surfaceRaised,
        borderColor: selected ? colors.ink : colors.lineStrong,
        borderRadius: radii.pill,
      }}>
      <AppText variant="label" tone={selected ? 'inverse' : 'default'}>{label}</AppText>
    </Pressable>
  );
}

function FieldLabel({ title, optional = true }: { title: string; optional?: boolean }) {
  return (
    <View className="mb-2 flex-row items-baseline">
      <AppText variant="label">{title}</AppText>
      {optional ? <AppText variant="meta" tone="muted" className="ml-2">Optional</AppText> : null}
    </View>
  );
}

function inputContainerStyle(multiline = false) {
  return {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.lineStrong,
    borderRadius: radii.medium,
    minHeight: multiline ? 112 : 54,
    width: '100%' as const,
    alignSelf: 'stretch' as const,
  };
}

function inputTextStyle(multiline = false) {
  return {
    color: colors.ink,
    textAlignVertical: multiline ? ('top' as const) : ('center' as const),
  };
}

function WeatherButton({
  label,
  state,
  onPress,
  testID,
}: {
  label: string;
  state: WeatherState;
  onPress: () => void;
  testID: string;
}) {
  const stateText = state === 'GOOD' ? 'Good' : state === 'IMPOSSIBLE' ? 'Not possible' : 'Neutral';
  const Icon = state === 'GOOD' ? Check : state === 'IMPOSSIBLE' ? X : Minus;
  const accent = state === 'GOOD' ? colors.sage : state === 'IMPOSSIBLE' ? colors.danger : colors.inkMuted;
  const background = state === 'GOOD' ? colors.sageSoft : state === 'IMPOSSIBLE' ? colors.dangerSoft : colors.paperDeep;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${stateText}. Tap to change.`}
      onPress={onPress}
      className="mb-2 min-h-14 flex-1 flex-row items-center border px-3 active:opacity-75"
      style={{ backgroundColor: background, borderColor: colors.line, borderRadius: radii.medium }}>
      <View className="h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: colors.surface }}>
        <Icon color={accent} size={16} />
      </View>
      <View className="ml-3 flex-1">
        <AppText variant="label">{label}</AppText>
        <AppText variant="meta" tone="soft">{stateText}</AppText>
      </View>
    </Pressable>
  );
}

export default function AddIdeaScreen() {
  const { spaceId, destinationId, tripId, draftSession } = useLocalSearchParams<{
    spaceId?: string;
    destinationId?: string;
    tripId?: string;
    draftSession?: string;
  }>();
  const queryClient = useQueryClient();
  const sessionId = useRef(draftSession ?? `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  useEffect(() => { if (!draftSession) router.setParams({ draftSession: sessionId.current }); }, [draftSession]);
  const clientRequestId = useRef(
    `idea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
  );
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap, staleTime: 0, refetchOnMount: 'always' });
  const destinations = useQuery({
    queryKey: queryKeys.destinations,
    queryFn: duodateApi.destinations,
    enabled: Boolean(destinationId),
  });
  const [title, setTitle] = useState<string>('');
  const [photoAsset, setPhotoAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoOperation = useRef<boolean>(false);
  const [photoBusy, setPhotoBusy] = useState<boolean>(false);
  const [savedIdeaId, setSavedIdeaId] = useState<string | null>(null);
  const savedAsset = useRef<ImagePicker.ImagePickerAsset | null>(null);
  const pendingCreate = useRef<IdeaCreateInput | null>(null);
  const [createUnconfirmed, setCreateUnconfirmed] = useState<boolean>(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>('');
  const [costBand, setCostBand] = useState<CostBand | null>(null);
  const [showExactCost, setShowExactCost] = useState<boolean>(false);
  const [exactCost, setExactCost] = useState<string>('');
  const [durationBand, setDurationBand] = useState<DurationBand | null>(null);
  const [weather, setWeather] = useState<WeatherSuitability>({
    sunny: 'NEUTRAL',
    rainy: 'NEUTRAL',
    indoor: 'NEUTRAL',
    outdoor: 'NEUTRAL',
  });
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [nextLinkKey, setNextLinkKey] = useState<number>(1);
  const [location, setLocation] = useState<string>('');
  const [availabilityMode, setAvailabilityMode] = useState<AvailabilityMode>('ANYTIME');
  const [rangeStart, setRangeStart] = useState<string>(todayCalendarDate());
  const [rangeEnd, setRangeEnd] = useState<string>(todayCalendarDate(addDays(new Date(), 1)));
  const [recurrenceKind, setRecurrenceKind] = useState<RecurrenceKind>('NONE');
  const [recurrenceStart, setRecurrenceStart] = useState<string>(todayCalendarDate());
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<RecurrenceWeekday[]>(['SATURDAY']);
  const [recurrenceOrdinal, setRecurrenceOrdinal] = useState<number>(1);
  const [recurrenceWeekday, setRecurrenceWeekday] = useState<RecurrenceWeekday>('SATURDAY');
  const [occurrences, setOccurrences] = useState<OccurrenceDraft[]>([
    { key: 1, date: todayCalendarDate(addDays(new Date(), 1)), time: null },
  ]);
  const [nextOccurrenceKey, setNextOccurrenceKey] = useState<number>(2);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>(() =>
    spaceId ? [spaceId] : [],
  );
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const datesInitialized = useRef<boolean>(false);
  const destination = destinations.data?.find((item) => item.id === destinationId) ?? null;
  const planningSpaces = activePlanningSpaces(bootstrap.data?.spaces ?? []);
  const originSpace = planningSpaces.find((item) => item.id === spaceId) ?? null;
  const contextTimeZone =
    destination?.timeZone ??
    originSpace?.timeZone ??
    bootstrap.data?.household.defaultTimeZone ??
    'UTC';

  const formSnapshot = {
    categoryId, notes, costBand, showExactCost, exactCost, durationBand, weather, links, nextLinkKey,
    location, availabilityMode, rangeStart, rangeEnd, recurrenceKind, recurrenceStart,
    recurrenceWeekdays, recurrenceOrdinal, recurrenceWeekday, occurrences, nextOccurrenceKey,
    selectedSpaceIds, pendingCreate: pendingCreate.current,
  };

  const draftKey = bootstrap.data && Platform.OS !== 'web'
    ? `${ideaPhotoDraftKey(bootstrap.data.household.id, bootstrap.data.user.id, { spaceId, destinationId, tripId })}:${sessionId.current}`
    : null;
  const photoDraft = useMemo(() => draftKey ? createIdeaPhotoDraft(mediaStorage, draftKey, {
    title: '', photo: null, pickerPending: false, clientRequestId: clientRequestId.current, savedIdeaId: null,
  }, nativePickerAsset) : null, [draftKey]);
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const draftReady = !draftKey || hydratedDraftKey === draftKey;
  const persistDraft = useCallback((patch: Parameters<NonNullable<typeof photoDraft>['update']>[0]) => {
    if (photoDraft) void photoDraft.update(patch).catch(() => {
      setPhotoError('Your attachment is kept here, but could not be backed up on this device. Please save the idea before leaving.');
    });
  }, [photoDraft]);

  const acceptPhotoAsset = useCallback((selected: ImagePicker.ImagePickerAsset) => {
    const asset = nativePickerAsset(selected);
    const validationError = prepareIdeaAttachment(asset).error;
    if (validationError) {
      setPhotoError(validationError);
      return;
    }
    setPhotoError(null);
    setPhotoAsset(asset);
    // Save reads the accepted photo immediately, even before the next render.
    savedAsset.current = asset;
    persistDraft({ photo: asset });
  }, [persistDraft]);

  useEffect(() => {
    if (!photoDraft || !draftKey) return;
    let active = true;
    void photoDraft.restore().then((draft) => {
      if (!active) return;
      setTitle(draft.title);
      setPhotoAsset(draft.photo);
      setSavedIdeaId(draft.savedIdeaId);
      savedAsset.current = draft.photo;
      clientRequestId.current = draft.clientRequestId;
      if (draft.form) {
        const form = draft.form as typeof formSnapshot;
        setCategoryId(form.categoryId ?? null); setNotes(form.notes ?? '');
        setCostBand(form.costBand ?? null); setShowExactCost(form.showExactCost ?? false);
        setExactCost(form.exactCost ?? ''); setDurationBand(form.durationBand ?? null);
        if (form.weather) setWeather(form.weather);
        if (form.links) setLinks(form.links);
        setNextLinkKey(form.nextLinkKey ?? 1); setLocation(form.location ?? '');
        if (form.availabilityMode) setAvailabilityMode(form.availabilityMode);
        if (form.rangeStart) setRangeStart(form.rangeStart);
        if (form.rangeEnd) setRangeEnd(form.rangeEnd);
        if (form.recurrenceKind) setRecurrenceKind(form.recurrenceKind);
        if (form.recurrenceStart) setRecurrenceStart(form.recurrenceStart);
        if (form.recurrenceWeekdays) setRecurrenceWeekdays(form.recurrenceWeekdays);
        if (form.recurrenceOrdinal) setRecurrenceOrdinal(form.recurrenceOrdinal);
        if (form.recurrenceWeekday) setRecurrenceWeekday(form.recurrenceWeekday);
        if (form.occurrences) setOccurrences(form.occurrences.map((item) => ({ ...item, time: item.time ? new Date(item.time) : null })));
        setNextOccurrenceKey(form.nextOccurrenceKey ?? 2);
        if (form.selectedSpaceIds) setSelectedSpaceIds(form.selectedSpaceIds);
        pendingCreate.current = form.pendingCreate ?? null;
        setCreateUnconfirmed(Boolean(form.pendingCreate && !draft.savedIdeaId));
        datesInitialized.current = true;
      }
    }).catch(() => {
      if (active) setPhotoError('The previous attachment draft could not be restored. Please choose the photo again.');
    }).finally(() => {
      if (!active) return;
      setHydratedDraftKey(draftKey);
    });
    return () => {
      active = false;
    };
  }, [acceptPhotoAsset, draftKey, photoDraft]);

  const acceptPhotoReceipt = useCallback(async (_id: string, result: ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult) => {
    if (!draftReady) throw new Error('Your attachment draft is still restoring.');
    if ('code' in result) setPhotoError(result.message);
    else {
      const asset = selectedPickerAsset(result);
      if (asset) {
        acceptPhotoAsset(asset);
        if (!prepareIdeaAttachment(asset).error) await photoDraft?.update({ photo: nativePickerAsset(asset), pickerPending: false });
      }
    }
    await photoDraft?.update({ pickerPending: false });
  }, [acceptPhotoAsset, photoDraft, draftReady]);
  const pickerBusy = useNativeMediaPicker(draftKey ?? `idea:${sessionId.current}`, acceptPhotoReceipt, setPhotoError);
  useEffect(() => { if (draftReady && !pickerBusy) persistDraft({ pickerPending: false }); }, [draftReady, pickerBusy, persistDraft]);

  useEffect(() => {
    if (datesInitialized.current || !bootstrap.data || (destinationId && !destinations.data)) return;
    const today = calendarDateInTimeZone(new Date(), contextTimeZone);
    const tomorrow = calendarDateInTimeZone(addDays(dateForZonedWallTime(today, '12:00', contextTimeZone), 1), contextTimeZone);
    setRangeStart(today);
    setRangeEnd(tomorrow);
    setRecurrenceStart(today);
    setOccurrences([{ key: 1, date: tomorrow, time: null }]);
    datesInitialized.current = true;
  }, [bootstrap.data, contextTimeZone, destinationId, destinations.data]);

  const exactCostCents = useMemo(() => {
    if (!exactCost.trim()) return null;
    const normalized = Number(exactCost.replace(',', '.'));
    return Number.isFinite(normalized) && normalized >= 0 ? Math.round(normalized * 100) : Number.NaN;
  }, [exactCost]);

  const finishSave = async (ideaId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ideas'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.letsDateRoot }),
      queryClient.invalidateQueries({ queryKey: queryKeys.idea(ideaId) }),
      ...(tripId ? [queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) })] : []),
    ]);
    const target = postSaveIdeaTarget(ideaId, tripId);
    if (tripId) router.dismissTo(target);
    else router.replace(target);
  };

  const saveIdea = useMutation({
    mutationFn: async () => {
      setClientError(null);
      if (photoOperation.current || pickerBusy) {
        throw new Error('Please wait for the photo to return before saving.');
      }
      if (savedIdeaId) {
        if (savedAsset.current) await uploadIdeaImage(savedIdeaId, savedAsset.current);
        await photoDraft?.clear();
        return savedIdeaId;
      }
      const activeLinks = links.filter((link) => link.url.trim() || link.label.trim());
      const invalidLinks = activeLinks.filter((link) => !normalizeWebsiteUrl(link.url));
      if (invalidLinks.length > 0) {
        setLinks((current) => current.map((link) => invalidLinks.some((invalid) => invalid.key === link.key)
          ? { ...link, editing: true, error: websiteValidationMessage } : link));
        throw new Error('Check the highlighted website field.');
      }
      const normalizedLinks = activeLinks.map((link) => ({
        ...link, url: normalizeWebsiteUrl(link.url)!, label: link.label.trim(),
      }));
      if (Number.isNaN(exactCostCents)) throw new Error('Enter the exact cost as a number, such as 24.50.');
      if (availabilityMode === 'DATE_RANGE' && rangeStart > rangeEnd) {
        throw new Error('The availability end date must be on or after its start date.');
      }
      if (recurrenceKind === 'WEEKLY' && recurrenceWeekdays.length === 0) {
        throw new Error('Choose at least one weekday for a weekly idea.');
      }
      if (!bootstrap.data?.household.defaultTimeZone) throw new Error('Your shared time zone could not be loaded.');

      const assignments = ideaContextAssignments(
        destinationId,
        selectedSpaceIds.filter((id) => planningSpaces.some((space) => space.id === id)),
      );
      const input: IdeaCreateInput = {
        clientRequestId: clientRequestId.current,
        title: title.trim(),
        categoryId,
        specificLocation: location.trim() || null,
        notes: notes.trim() || null,
        costBand,
        exactCostCents,
        durationBand,
        spaceIds: assignments.spaceIds,
        destinationIds: assignments.destinationIds,
        links: normalizedLinks.map((link, index) => ({
          url: link.url,
          label: link.label || null,
          sortOrder: index,
        })),
        weather,
        recurrence:
          recurrenceKind === 'WEEKLY'
            ? {
                kind: 'WEEKLY',
                startDate: recurrenceStart,
                endDate: null,
                weekdays: recurrenceWeekdays,
              }
            : recurrenceKind === 'MONTHLY_ORDINAL_WEEKDAY'
              ? {
                  kind: 'MONTHLY_ORDINAL_WEEKDAY',
                  startDate: recurrenceStart,
                  endDate: null,
                  ordinal: recurrenceOrdinal,
                  weekday: recurrenceWeekday,
                }
              : { kind: 'NONE' },
        availability:
          availabilityMode === 'DATE_RANGE'
            ? { mode: 'DATE_RANGE', rangeStartDate: rangeStart, rangeEndDate: rangeEnd }
            : availabilityMode === 'SPECIFIC_OCCURRENCES'
              ? { mode: 'SPECIFIC_OCCURRENCES' }
              : { mode: 'ANYTIME' },
        occurrences:
          availabilityMode === 'SPECIFIC_OCCURRENCES'
            ? occurrences.map((occurrence) => ({
                localDate: occurrence.date,
                startLocalTime: occurrence.time
                  ? localTimeInTimeZone(occurrence.time, contextTimeZone)
                  : null,
                timeZone: occurrence.time ? contextTimeZone : null,
              }))
            : [],
      };
      if (!pendingCreate.current) {
        pendingCreate.current = input;
        savedAsset.current = photoDraft?.value.photo ?? photoAsset;
      }
      await photoDraft?.update({ form: { ...formSnapshot, pendingCreate: pendingCreate.current } });
      let created;
      try {
        created = await duodateApi.createIdea(pendingCreate.current);
        setCreateUnconfirmed(false);
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          pendingCreate.current = null;
          savedAsset.current = null;
          setCreateUnconfirmed(false);
        } else {
          setCreateUnconfirmed(true);
        }
        throw error;
      }
      setSavedIdeaId(created.id);
      await photoDraft?.update({ savedIdeaId: created.id });
      if (savedAsset.current) await uploadIdeaImage(created.id, savedAsset.current);
      await photoDraft?.clear();
      return created.id;
    },
    onSuccess: finishSave,
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'The idea could not be saved.';
      setClientError(message);
      if (savedAsset.current) setPhotoError(`Attachment not saved: ${message}`);
    },
  });

  if (bootstrap.isLoading || (destinationId && destinations.isLoading) || !draftReady) {
    return <Screen testID="add-idea-screen"><LoadingState /></Screen>;
  }
  if (bootstrap.isError || !bootstrap.data || (destinationId && destinations.isError)) {
    return (
      <Screen testID="add-idea-screen">
        <ErrorState
          message="We couldn't load the details needed to add an idea."
          onRetry={() => void Promise.all([bootstrap.refetch(), destinations.refetch()])}
        />
      </Screen>
    );
  }

  const cycleWeather = (key: keyof WeatherSuitability) => {
    setWeather((current) => {
      const currentIndex = weatherOrder.indexOf(current[key]);
      return { ...current, [key]: weatherOrder[(currentIndex + 1) % weatherOrder.length] };
    });
  };

  const choosePhoto = async (source: 'library' | 'camera') => {
    if (photoOperation.current || pickerBusy || saveIdea.isPending) return;
    photoOperation.current = true;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setPhotoError('Camera access is needed to take a photo.');
          return;
        }
      } else if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setPhotoError('Library access is needed to choose a photo or flyer.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      };
      // Finish writing before Android can destroy the activity in the picker.
      await photoDraft?.update({ title, form: formSnapshot, pickerPending: true });
      console.info('[Idea photo]', 'launch', source);
      await launchNativeMediaPicker(draftKey ?? `idea:${sessionId.current}`, () => source === 'camera'
        ? ImagePicker.launchCameraAsync(options)
        : ImagePicker.launchImageLibraryAsync(options));
    } catch (error) {
      await photoDraft?.update({ pickerPending: false });
      setPhotoError(error instanceof Error ? error.message : 'The photo could not be opened. Please try again.');
    } finally {
      photoOperation.current = false;
      setPhotoBusy(false);
    }
  };

  const openPickerValue = () => {
    if (!pickerTarget) return new Date();
    if (pickerTarget.kind === 'range-start') return dateForZonedWallTime(rangeStart, '12:00', contextTimeZone);
    if (pickerTarget.kind === 'range-end') return dateForZonedWallTime(rangeEnd, '12:00', contextTimeZone);
    if (pickerTarget.kind === 'recurrence-start') {
      return dateForZonedWallTime(recurrenceStart, '12:00', contextTimeZone);
    }
    const occurrence = occurrences[pickerTarget.index];
    if (pickerTarget.kind === 'occurrence-time') return occurrence?.time ?? new Date();
    return dateForZonedWallTime(
      occurrence?.date ?? calendarDateInTimeZone(new Date(), contextTimeZone),
      '12:00',
      contextTimeZone,
    );
  };

  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') setPickerTarget(null);
    if (event.type !== 'set' || !value || !pickerTarget) return;
    if (pickerTarget.kind === 'range-start') {
      const next = calendarDateInTimeZone(value, contextTimeZone);
      setRangeStart(next);
      if (next > rangeEnd) setRangeEnd(next);
      return;
    }
    if (pickerTarget.kind === 'range-end') {
      setRangeEnd(calendarDateInTimeZone(value, contextTimeZone));
      return;
    }
    if (pickerTarget.kind === 'recurrence-start') {
      setRecurrenceStart(calendarDateInTimeZone(value, contextTimeZone));
      return;
    }
    const occurrenceTarget = pickerTarget;
    setOccurrences((current) =>
      current.map((occurrence, index) => {
        if (index !== occurrenceTarget.index) return occurrence;
        return occurrenceTarget.kind === 'occurrence-time'
          ? { ...occurrence, time: value }
          : { ...occurrence, date: calendarDateInTimeZone(value, contextTimeZone) };
      }),
    );
  };

  const pickerMode = pickerTarget?.kind === 'occurrence-time' ? 'time' : 'date';
  const hasRecurrence = recurrenceKind !== 'NONE';
  const costBasisLabel = bootstrap.data.settings?.costBasis === 'TOTAL_FOR_TWO' ? 'total for both of you' : 'per person';

  return (
    <Screen testID="add-idea-screen" edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <View className="flex-row items-center justify-between px-5 py-3">
          <Pressable
            testID="add-idea-close-button"
            accessibilityRole="button"
            accessibilityLabel="Close add idea"
            disabled={saveIdea.isPending}
            onPress={() => savedIdeaId ? void finishSave(savedIdeaId) : router.back()}
            className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
            style={{ backgroundColor: colors.surface }}>
            <X color={colors.ink} size={22} />
          </Pressable>
          <AppText variant="label" tone="muted">NEW IDEA</AppText>
          <View className="h-12 w-12" />
        </View>

        <ScrollView
          testID="add-idea-form-scroll"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="px-5"
          contentContainerStyle={{ paddingBottom: 168 }}>
          <View className="pt-5">
            <AppText variant="display" className="leading-[44px]">What do you want to do?</AppText>
          </View>
          {savedIdeaId ? (
            <PaperCard testID="idea-attachment-save-status" className="mt-5">
              {photoAsset ? (
                <View testID="idea-pending-attachment-preview" className="mb-3 overflow-hidden" style={{ borderRadius: radii.medium }}>
                  <Image source={{ uri: photoAsset.uri }} style={{ width: '100%', height: 150 }} contentFit="cover" />
                </View>
              ) : null}
              <AppText variant="label">Your idea is saved.</AppText>
              <AppText variant="meta" tone="muted" className="mt-2">
                {saveIdea.isPending ? 'Saving your attachment…' : 'The attachment has not saved yet. Retry below, or open the saved idea without it.'}
              </AppText>
              {!saveIdea.isPending ? (
                <Pressable testID="open-idea-without-attachment" accessibilityRole="button" onPress={() => void finishSave(savedIdeaId)} className="mt-2 min-h-11 justify-center">
                  <AppText variant="label" tone="accent">Open saved idea</AppText>
                </Pressable>
              ) : null}
            </PaperCard>
          ) : null}
          {createUnconfirmed ? (
            <PaperCard testID="idea-save-unconfirmed" className="mt-5">
              <AppText variant="label">We couldn't confirm your save.</AppText>
              <AppText variant="meta" tone="muted" className="mt-2">Retry to confirm the same idea without creating a duplicate. Your details and attachment are kept below.</AppText>
            </PaperCard>
          ) : null}
          {!savedIdeaId ? <View pointerEvents={saveIdea.isPending || createUnconfirmed ? 'none' : 'auto'} accessibilityElementsHidden={createUnconfirmed}>

          {destination ? (
            <PaperCard testID="idea-destination-context" className="mt-6 flex-row items-center py-4" style={{ backgroundColor: colors.sageSoft }}>
              <View className="min-w-0 flex-1">
                <AppText variant="meta" tone="muted">SAVING TO DESTINATION</AppText>
                <AppText variant="heading" className="mt-1">{destination.name}</AppText>
              </View>
              <CalendarDays color={colors.sage} size={21} />
            </PaperCard>
          ) : null}

          <View className="mt-8">
            <FieldLabel title="Title" optional={false} />
            <FocusableTextInput
              testID="idea-title-input"
              accessibilityLabel="Idea title"
              autoFocus={Platform.OS !== 'android'}
              value={title}
              onChangeText={(value: string) => {
                setTitle(value);
                persistDraft({ title: value });
              }}
              placeholder="See an outdoor film"
              placeholderTextColor={colors.placeholder}
              containerClassName="border"
              containerStyle={inputContainerStyle()}
              className="flex-1 px-4 text-lg"
              style={inputTextStyle()}
              maxLength={200}
            />
          </View>

          <View className="mt-7">
            <FieldLabel title="Photo or flyer" />
            {photoAsset ? (
              <View
                testID="idea-photo-preview"
                className="overflow-hidden border"
                style={{ borderColor: colors.line, borderRadius: radii.medium }}>
                <Image source={{ uri: photoAsset.uri }} style={{ width: '100%', height: 150 }} contentFit="cover" />
                <View className="flex-row items-center justify-between px-3 py-2" style={{ backgroundColor: colors.surface }}>
                  <Check color={colors.sage} size={18} />
                  <View className="ml-2 mr-3 min-w-0 flex-1">
                    <AppText testID="idea-photo-attached-status" variant="label">Photo attached</AppText>
                    <AppText variant="meta" tone="muted">{savedIdeaId ? 'Waiting to finish upload' : 'Ready to save with your idea'}</AppText>
                    <AppText variant="meta" tone="muted" numberOfLines={1}>
                      {photoAsset.fileName ?? 'Selected image'}
                    </AppText>
                  </View>
                  <Pressable
                    testID="remove-idea-photo-button"
                    accessibilityRole="button"
                    accessibilityLabel="Remove selected attachment"
                    onPress={() => {
                      setPhotoAsset(null);
                      savedAsset.current = null;
                      setPhotoError(null);
                      persistDraft({ photo: null, pickerPending: false });
                    }}
                    className="min-h-11 flex-row items-center px-2 active:opacity-70">
                    <Trash2 color={colors.danger} size={17} />
                    <AppText variant="label" tone="danger" className="ml-1">Remove</AppText>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View className="flex-row gap-3">
                <Pressable
                  testID="choose-idea-photo-button"
                  accessibilityRole="button"
                  accessibilityLabel="Choose a photo or flyer"
                  onPress={() => void choosePhoto('library')}
                  className="min-h-14 flex-1 flex-row items-center justify-center border border-dashed px-3 active:opacity-70"
                  style={{ backgroundColor: colors.surface, borderColor: colors.lineStrong, borderRadius: radii.medium }}>
                  <ImagePlus color={colors.rose} size={19} />
                  <AppText variant="label" tone="accent" className="ml-2">Choose photo</AppText>
                </Pressable>
                {Platform.OS !== 'web' ? (
                  <Pressable
                    testID="take-idea-photo-button"
                    accessibilityRole="button"
                    accessibilityLabel="Take a photo"
                    onPress={() => void choosePhoto('camera')}
                    className="min-h-14 flex-1 flex-row items-center justify-center border px-3 active:opacity-70"
                    style={{ backgroundColor: colors.surface, borderColor: colors.lineStrong, borderRadius: radii.medium }}>
                    <Camera color={colors.inkSoft} size={19} />
                    <AppText variant="label" className="ml-2">Camera</AppText>
                  </Pressable>
                ) : null}
              </View>
            )}
            {photoError ? <AppText testID="idea-photo-error" variant="meta" tone="danger" className="mt-2">{photoError}</AppText> : null}
          </View>

          <View className="mt-7">
            <FieldLabel title="Category" />
            <View className="flex-row flex-wrap">
              <ChoiceChip label="None" selected={categoryId === null} onPress={() => setCategoryId(null)} testID="idea-category-none" />
              {bootstrap.data.categories.map((category) => (
                <ChoiceChip
                  key={category.id}
                  label={category.name}
                  selected={categoryId === category.id}
                  onPress={() => setCategoryId(category.id)}
                  testID={`idea-category-${category.id}`}
                />
              ))}
            </View>
          </View>

          <View className="mt-7">
            <FieldLabel title="Notes" />
            <FocusableTextInput
              testID="idea-notes-input"
              accessibilityLabel="Idea notes"
              multiline
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything worth remembering…"
              placeholderTextColor={colors.placeholder}
              containerClassName="border"
              containerStyle={inputContainerStyle(true)}
              className="flex-1 px-4 py-4 text-base"
              style={inputTextStyle(true)}
              maxLength={10000}
            />
          </View>

          <PaperCard className="mt-8">
            <View>
              <FieldLabel title="Cost" />
              <AppText variant="meta" tone="muted">Amounts are interpreted {costBasisLabel}.</AppText>
              <View className="mt-1 flex-row flex-wrap">
                {costOptions.map((option) => (
                  <ChoiceChip
                    key={option.value}
                    label={option.label}
                    selected={costBand === option.value}
                    onPress={() => setCostBand(costBand === option.value ? null : option.value)}
                    testID={`idea-cost-${option.value.toLowerCase()}`}
                  />
                ))}
              </View>
              {showExactCost ? (
                <View className="mt-3 flex-row items-center">
                  <FocusableTextInput
                    testID="idea-exact-cost-input"
                    accessibilityLabel={`Exact cost ${costBasisLabel}`}
                    keyboardType="decimal-pad"
                    value={exactCost}
                    onChangeText={setExactCost}
                    placeholder="Exact amount"
                    placeholderTextColor={colors.placeholder}
                    containerClassName="min-h-12 flex-1 border"
                    containerStyle={inputContainerStyle()}
                    className="flex-1 px-4 text-base"
                    style={inputTextStyle()}
                  />
                  <Pressable
                    testID="hide-exact-cost-button"
                    accessibilityRole="button"
                    accessibilityLabel="Remove exact cost"
                    onPress={() => {
                      setExactCost('');
                      setShowExactCost(false);
                    }}
                    className="ml-2 h-11 w-11 items-center justify-center">
                    <X color={colors.inkMuted} size={18} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  testID="show-exact-cost-button"
                  accessibilityRole="button"
                  accessibilityLabel="Add an exact cost"
                  onPress={() => setShowExactCost(true)}
                  className="mt-2 min-h-11 flex-row items-center self-start px-2 active:opacity-70">
                  <Plus color={colors.rose} size={16} />
                  <AppText variant="meta" tone="accent" className="ml-1">Add exact amount</AppText>
                </Pressable>
              )}
            </View>

            <View className="mt-7">
              <FieldLabel title="Duration" />
              <View className="flex-row flex-wrap">
                {durationOptions.map((option) => (
                  <ChoiceChip
                    key={option.value}
                    label={option.label}
                    selected={durationBand === option.value}
                    onPress={() => setDurationBand(durationBand === option.value ? null : option.value)}
                    testID={`idea-duration-${option.value.toLowerCase()}`}
                  />
                ))}
              </View>
            </View>

            <View className="mt-7">
              <FieldLabel title="Weather" />
              <AppText variant="meta" tone="muted" className="mb-3">Tap to cycle between neutral, good, and not possible.</AppText>
              <View className="flex-row">
                <View className="mr-1 flex-1">
                  <WeatherButton label="Sunny" state={weather.sunny} onPress={() => cycleWeather('sunny')} testID="weather-sunny" />
                  <WeatherButton label="Indoor" state={weather.indoor} onPress={() => cycleWeather('indoor')} testID="weather-indoor" />
                </View>
                <View className="ml-1 flex-1">
                  <WeatherButton label="Rainy" state={weather.rainy} onPress={() => cycleWeather('rainy')} testID="weather-rainy" />
                  <WeatherButton label="Outdoor" state={weather.outdoor} onPress={() => cycleWeather('outdoor')} testID="weather-outdoor" />
                </View>
              </View>
            </View>
          </PaperCard>

          <View className="mt-8">
            <FieldLabel title="Links" />
            {links.map((link, index) => link.editing ? (
              <PaperCard key={link.key} className="mb-3 py-4">
                <FocusableTextInput
                  testID={`idea-link-url-${index}`}
                  accessibilityLabel={`Link ${index + 1} web address`}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  value={link.url}
                  onChangeText={(value: string) => setLinks((current) => current.map((item) => item.key === link.key ? { ...item, url: value, error: null } : item))}
                  placeholder="abc.com or https://…"
                  placeholderTextColor={colors.placeholder}
                  containerClassName="border"
                  containerStyle={inputContainerStyle()}
                  className="flex-1 px-4 text-base"
                  style={inputTextStyle()}
                  maxLength={2000}
                />
                {link.error ? <AppText testID={`idea-link-error-${index}`} variant="meta" tone="danger" className="mt-2">{link.error}</AppText> : null}
                <FocusableTextInput
                  testID={`idea-link-label-${index}`}
                  accessibilityLabel={`Link ${index + 1} label`}
                  value={link.label}
                  onChangeText={(value: string) => setLinks((current) => current.map((item) => item.key === link.key ? { ...item, label: value } : item))}
                  placeholder="Optional label"
                  placeholderTextColor={colors.placeholder}
                  containerClassName="mt-2 border"
                  containerStyle={inputContainerStyle()}
                  className="flex-1 px-4 text-base"
                  style={inputTextStyle()}
                  maxLength={120}
                />
                <View className="mt-2 flex-row justify-end">
                  <Pressable
                    testID={`remove-link-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove link ${index + 1}`}
                    onPress={() => setLinks((current) => current.filter((item) => item.key !== link.key))}
                    className="min-h-11 justify-center px-3 active:opacity-70">
                    <AppText variant="label" tone="danger">Remove</AppText>
                  </Pressable>
                  <Pressable
                    testID={`save-link-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Save link ${index + 1}`}
                    onPress={() => {
                      const normalized = normalizeWebsiteUrl(link.url);
                      setLinks((current) => current.map((item) => item.key === link.key
                        ? normalized ? { ...item, url: normalized, editing: false, error: null }
                          : { ...item, error: websiteValidationMessage }
                        : item));
                    }}
                    className="min-h-11 justify-center px-3 active:opacity-70">
                    <AppText variant="label" tone="accent">Done</AppText>
                  </Pressable>
                </View>
              </PaperCard>
            ) : (
              <View
                key={link.key}
                testID={`saved-link-${index}`}
                className="mb-2 min-h-14 flex-row items-center border px-4"
                style={{ backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radii.medium }}>
                <Link2 color={colors.inkMuted} size={18} />
                <AppText variant="label" className="ml-3 min-w-0 flex-1" numberOfLines={1}>
                  {readableLinkLabel(link.url, link.label)}
                </AppText>
                <Pressable
                  testID={`edit-link-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit link ${index + 1}`}
                  onPress={() => setLinks((current) => current.map((item) => item.key === link.key ? { ...item, editing: true } : item))}
                  className="h-11 w-11 items-center justify-center">
                  <Pencil color={colors.inkMuted} size={17} />
                </Pressable>
                <Pressable
                  testID={`remove-link-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove link ${index + 1}`}
                  onPress={() => setLinks((current) => current.filter((item) => item.key !== link.key))}
                  className="h-11 w-11 items-center justify-center">
                  <Trash2 color={colors.danger} size={17} />
                </Pressable>
              </View>
            ))}
            {!links.some((link) => link.editing) ? (
              <Pressable
                testID="add-link-button"
                accessibilityRole="button"
                accessibilityLabel={links.length === 0 ? 'Add a website link' : 'Add another website link'}
                onPress={() => {
                  setLinks((current) => [...current, { key: nextLinkKey, url: '', label: '', editing: true }]);
                  setNextLinkKey((value) => value + 1);
                }}
                className="min-h-14 flex-row items-center border border-dashed px-4 active:opacity-70"
                style={{ borderColor: colors.lineStrong, borderRadius: radii.medium }}>
                <Plus color={colors.rose} size={17} />
                <AppText variant="label" tone="accent" className="ml-2">
                  {links.length === 0 ? 'Add link' : 'Add another link'}
                </AppText>
              </Pressable>
            ) : null}
          </View>

          <View className="mt-7">
            <FieldLabel title="Specific location" />
            <FocusableTextInput
              testID="idea-location-input"
              accessibilityLabel="Specific location"
              value={location}
              onChangeText={setLocation}
              placeholder="Venue, neighbourhood, or meeting point"
              placeholderTextColor={colors.placeholder}
              containerClassName="border"
              containerStyle={inputContainerStyle()}
              className="flex-1 px-4 text-base"
              style={inputTextStyle()}
              maxLength={300}
            />
          </View>

          <View className="mt-8">
            <FieldLabel title="When it could work" />
            <View className="flex-row flex-wrap">
              <ChoiceChip
                label={hasRecurrence ? 'Repeating days' : 'Anytime'}
                selected={availabilityMode === 'ANYTIME'}
                onPress={() => setAvailabilityMode('ANYTIME')}
                testID="availability-anytime"
              />
              <ChoiceChip
                label={hasRecurrence ? 'Repeating days in range' : 'Date range'}
                selected={availabilityMode === 'DATE_RANGE'}
                onPress={() => setAvailabilityMode('DATE_RANGE')}
                testID="availability-range"
              />
              <ChoiceChip
                label={hasRecurrence ? 'Repeating + specific dates' : 'Specific dates'}
                selected={availabilityMode === 'SPECIFIC_OCCURRENCES'}
                onPress={() => setAvailabilityMode('SPECIFIC_OCCURRENCES')}
                testID="availability-specific"
              />
            </View>

            {availabilityMode === 'DATE_RANGE' ? (
              <PaperCard className="mt-3 py-4">
                <View className="flex-row">
                  <Pressable
                    testID="availability-start-date"
                    accessibilityRole="button"
                    accessibilityLabel={`Availability starts ${formatCalendarDate(rangeStart)}`}
                    onPress={() => setPickerTarget({ kind: 'range-start' })}
                    className="mr-2 min-h-14 flex-1 justify-center border px-3 active:opacity-70"
                    style={{ borderColor: colors.line, borderRadius: radii.medium }}>
                    <AppText variant="meta" tone="muted">From</AppText>
                    <AppText variant="label" className="mt-1">{formatCalendarDate(rangeStart)}</AppText>
                  </Pressable>
                  <Pressable
                    testID="availability-end-date"
                    accessibilityRole="button"
                    accessibilityLabel={`Availability ends ${formatCalendarDate(rangeEnd)}`}
                    onPress={() => setPickerTarget({ kind: 'range-end' })}
                    className="ml-2 min-h-14 flex-1 justify-center border px-3 active:opacity-70"
                    style={{ borderColor: colors.line, borderRadius: radii.medium }}>
                    <AppText variant="meta" tone="muted">Until</AppText>
                    <AppText variant="label" className="mt-1">{formatCalendarDate(rangeEnd)}</AppText>
                  </Pressable>
                </View>
              </PaperCard>
            ) : null}

            {availabilityMode === 'SPECIFIC_OCCURRENCES' ? (
              <View className="mt-3">
                {occurrences.map((occurrence, index) => (
                  <PaperCard key={occurrence.key} className="mb-3 py-4">
                    <View className="flex-row items-center">
                      <Pressable
                        testID={`occurrence-date-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Choose date ${index + 1}`}
                        onPress={() => setPickerTarget({ kind: 'occurrence-date', index })}
                        className="min-h-12 flex-1 flex-row items-center border px-3 active:opacity-70"
                        style={{ borderColor: colors.line, borderRadius: radii.medium }}>
                        <CalendarDays color={colors.inkMuted} size={17} />
                        <AppText variant="label" className="ml-2">{formatCalendarDate(occurrence.date)}</AppText>
                      </Pressable>
                      <Pressable
                        testID={`occurrence-time-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Choose optional time for date ${index + 1}`}
                        onPress={() => setPickerTarget({ kind: 'occurrence-time', index })}
                        className="ml-2 min-h-12 flex-row items-center border px-3 active:opacity-70"
                        style={{ borderColor: colors.line, borderRadius: radii.medium }}>
                        <Clock3 color={colors.inkMuted} size={17} />
                        <AppText variant="label" className="ml-2">
                          {occurrence.time
                            ? localTimeInTimeZone(occurrence.time, contextTimeZone)
                            : 'Time'}
                        </AppText>
                      </Pressable>
                      {occurrences.length > 1 ? (
                        <Pressable
                          testID={`remove-occurrence-${index}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove date ${index + 1}`}
                          onPress={() => setOccurrences((current) => current.filter((item) => item.key !== occurrence.key))}
                          className="ml-1 h-11 w-11 items-center justify-center">
                          <X color={colors.danger} size={18} />
                        </Pressable>
                      ) : null}
                    </View>
                    {occurrence.time ? (
                      <Pressable
                        testID={`clear-occurrence-time-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove time from date ${index + 1}`}
                        onPress={() => setOccurrences((current) => current.map((item) => item.key === occurrence.key ? { ...item, time: null } : item))}
                        className="mt-2 min-h-11 self-start justify-center">
                        <AppText variant="meta" tone="accent">Remove time</AppText>
                      </Pressable>
                    ) : null}
                  </PaperCard>
                ))}
                <Pressable
                  testID="add-occurrence-button"
                  accessibilityRole="button"
                  accessibilityLabel="Add another specific date"
                  onPress={() => {
                    const today = calendarDateInTimeZone(new Date(), contextTimeZone);
                    const tomorrow = calendarDateInTimeZone(
                      addDays(dateForZonedWallTime(today, '12:00', contextTimeZone), 1),
                      contextTimeZone,
                    );
                    setOccurrences((current) => [...current, { key: nextOccurrenceKey, date: tomorrow, time: null }]);
                    setNextOccurrenceKey((value) => value + 1);
                  }}
                  className="min-h-11 flex-row items-center self-start px-2 active:opacity-70">
                  <Plus color={colors.rose} size={17} />
                  <AppText variant="label" tone="accent" className="ml-2">Add another date</AppText>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View className="mt-8">
            <FieldLabel title="Repeats" />
            <View className="flex-row flex-wrap">
              <ChoiceChip
                label="None"
                selected={recurrenceKind === 'NONE'}
                onPress={() => setRecurrenceKind('NONE')}
                testID="recurrence-none"
              />
              <ChoiceChip
                label="Weekly"
                selected={recurrenceKind === 'WEEKLY'}
                onPress={() => setRecurrenceKind('WEEKLY')}
                testID="recurrence-weekly"
              />
              <ChoiceChip
                label="Monthly"
                selected={recurrenceKind === 'MONTHLY_ORDINAL_WEEKDAY'}
                onPress={() => setRecurrenceKind('MONTHLY_ORDINAL_WEEKDAY')}
                testID="recurrence-monthly"
              />
            </View>

            {recurrenceKind !== 'NONE' ? (
              <PaperCard className="mt-3 py-4">
                <Pressable
                  testID="recurrence-start-date"
                  accessibilityRole="button"
                  accessibilityLabel={`Recurrence starts ${formatCalendarDate(recurrenceStart)}`}
                  onPress={() => setPickerTarget({ kind: 'recurrence-start' })}
                  className="min-h-12 flex-row items-center border px-3 active:opacity-70"
                  style={{ borderColor: colors.line, borderRadius: radii.medium }}>
                  <CalendarDays color={colors.inkMuted} size={17} />
                  <View className="ml-2">
                    <AppText variant="meta" tone="muted">Starts</AppText>
                    <AppText variant="label">{formatCalendarDate(recurrenceStart)}</AppText>
                  </View>
                </Pressable>

                {recurrenceKind === 'WEEKLY' ? (
                  <View className="mt-4">
                    <AppText variant="meta" tone="muted">Repeat on</AppText>
                    <View className="mt-1 flex-row flex-wrap">
                      {weekdayOptions.map((option) => (
                        <ChoiceChip
                          key={option.value}
                          label={option.shortLabel}
                          selected={recurrenceWeekdays.includes(option.value)}
                          onPress={() => setRecurrenceWeekdays((current) =>
                            current.includes(option.value)
                              ? current.filter((weekday) => weekday !== option.value)
                              : [...current, option.value]
                          )}
                          testID={`recurrence-weekday-${option.value.toLowerCase()}`}
                        />
                      ))}
                    </View>
                  </View>
                ) : (
                  <View className="mt-4">
                    <AppText variant="meta" tone="muted">Repeat on the</AppText>
                    <View className="mt-1 flex-row flex-wrap">
                      {ordinalOptions.map((option) => (
                        <ChoiceChip
                          key={option.value}
                          label={option.label}
                          selected={recurrenceOrdinal === option.value}
                          onPress={() => setRecurrenceOrdinal(option.value)}
                          testID={`recurrence-ordinal-${option.value}`}
                        />
                      ))}
                    </View>
                    <View className="mt-1 flex-row flex-wrap">
                      {weekdayOptions.map((option) => (
                        <ChoiceChip
                          key={option.value}
                          label={option.label}
                          selected={recurrenceWeekday === option.value}
                          onPress={() => setRecurrenceWeekday(option.value)}
                          testID={`recurrence-monthly-weekday-${option.value.toLowerCase()}`}
                        />
                      ))}
                    </View>
                  </View>
                )}
              </PaperCard>
            ) : null}
          </View>

          {!destinationId ? (
            <View className="mt-8" testID="idea-space-assignment">
              <FieldLabel title="Spaces" />
              <AppText variant="meta" tone="muted">Choose every place where this idea belongs.</AppText>
              <View className="mt-1 flex-row flex-wrap">
                {planningSpaces.map((space) => (
                  <ChoiceChip
                    key={space.id}
                    label={space.name}
                    selected={selectedSpaceIds.includes(space.id)}
                    onPress={() => setSelectedSpaceIds((current) => current.includes(space.id) ? current.filter((id) => id !== space.id) : [...current, space.id])}
                    testID={`idea-space-${space.id}`}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {pickerTarget ? (
            <PaperCard className="mt-5 py-3">
              <View className="flex-row items-center justify-between">
                <AppText variant="label">Choose {pickerMode === 'time' ? 'time' : 'date'}</AppText>
                <Pressable
                  testID="date-picker-done"
                  accessibilityRole="button"
                  accessibilityLabel="Finish choosing date or time"
                  onPress={() => setPickerTarget(null)}
                  className="min-h-11 justify-center px-3">
                  <AppText variant="label" tone="accent">Done</AppText>
                </Pressable>
              </View>
              <DateTimePicker
                testID="idea-date-time-picker"
                value={openPickerValue()}
                mode={pickerMode}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                timeZoneName={contextTimeZone}
                minimumDate={
                  pickerMode === 'date'
                    ? dateForZonedWallTime(
                        calendarDateInTimeZone(new Date(), contextTimeZone),
                        '12:00',
                        contextTimeZone,
                      )
                    : undefined
                }
                onChange={onPickerChange}
              />
            </PaperCard>
          ) : null}

          </View> : null}
          {clientError || saveIdea.isError ? (
            <View
              testID="idea-save-error"
              className="mt-6 border px-4 py-3"
              style={{ backgroundColor: colors.dangerSoft, borderColor: colors.roseSoft, borderRadius: radii.medium }}>
              <AppText variant="meta" tone="danger">
                {clientError ?? 'The idea could not be saved. Please try again.'}
              </AppText>
            </View>
          ) : null}
        </ScrollView>

        <View
          testID="add-idea-save-area"
          className="absolute bottom-0 left-0 right-0 border-t px-5 pb-4 pt-3"
          style={{ backgroundColor: colors.paper, borderColor: colors.line }}>
          <PrimaryButton
            testID="save-idea-button"
            label={savedIdeaId ? 'Retry attachment' : createUnconfirmed ? 'Confirm save' : 'Save idea'}
            disabled={!hasRequiredText(title) || photoBusy || pickerBusy}
            loading={saveIdea.isPending}
            icon={<Check color={colors.surface} size={19} />}
            onPress={() => saveIdea.mutate()}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
