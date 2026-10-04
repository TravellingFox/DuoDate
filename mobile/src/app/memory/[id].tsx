import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { memorySaveRequest } from '@/lib/memory-save-request';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { deferMediaAction } from '@/lib/deferred-media-action';
import { createContributionOperation } from '@/lib/contribution-operation';
import { launchNativeMediaPicker, useNativeMediaPicker, retainMediaFile } from '@/lib/native-media-picker';
import { writeMediaDraft, readMediaDraft } from '@/lib/media-draft-journal';
import { receiptAssetId } from '@/lib/media-receipt-id';
import { canCompleteMemory, hasActiveContributions } from '@/lib/memory-completion';
import { nativePickerAsset } from '@/lib/native-picker-asset';
import { mediaStorage } from '@/lib/media-storage';
import { KeyboardAwareScrollView, KeyboardProvider, KeyboardStickyView } from 'react-native-keyboard-controller';
import { CalendarDateInput } from '@/components/CalendarDateInput';
import { memoryDateTimeZone } from '@/lib/memory-date';
import { usePlanningContext } from '@/lib/planning-context';
import { api } from '@/lib/api/api';
import * as ImagePicker from 'expo-image-picker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  Check,
  CircleStop,
  ImagePlus,
  Images,
  MapPin,
  Mic,
  PencilLine,
  Play,
  RotateCcw,
  Star,
  Trash2,
  Video,
  X,
} from 'lucide-react-native';
import { AuthenticatedMediaImage } from '@/components/AuthenticatedMediaImage';
import {
  AuthenticatedMemoryAudio,
  AuthenticatedMemoryVideo,
} from '@/components/AuthenticatedMediaPlayback';
import { AppText, FocusableTextInput, radii } from '@/components/ui';
import { ApiError } from '@/lib/api/api';
import {
  duodateApi,
  queryKeys,
  type Memory,
  type MemoryMediaSummary,
} from '@/lib/api/duodate';
import {
  deleteMemoryMedia,
  reorderMemoryMedia,
  setMemoryCover,
  updateMemoryMediaCaption,
  uploadMemoryMedia,
  type UploadMemoryMediaInput,
} from '@/lib/api/memory-media';
import { formatCalendarDate } from '@/lib/format';
import {
  formatMediaDuration,
  hasMemoryContent,
  mediaFileName,
  nextMemoryContributionSortOrder,
  nextMemoryMediaSortOrder,
  prepareMemoryPickerAssets,
  upsertMemoryInList,
  validateMemoryMedia,
} from '@/lib/memory-capture';
import { useSession } from '@/lib/auth/use-session';

const memoryColors = {
  background: '#1C1916',
  backgroundRaised: '#25211D',
  panel: '#2D2823',
  panelRaised: '#37302A',
  cream: '#F7EDDA',
  creamSoft: '#DED1BD',
  muted: '#AD9F8D',
  line: '#4B4239',
  ember: '#DE8B7E',
  emberSoft: '#583B35',
  gold: '#C6A466',
  sage: '#8EAA91',
  danger: '#E49388',
} as const;

type UploadPhase = 'preparing' | 'uploading' | 'success' | 'error';

type UploadDraft = {
  id: string;
  label: string;
  phase: UploadPhase;
  progress: number;
  error: string | null;
  input: UploadMemoryMediaInput;
};

function uploadMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'MEDIA_TOO_LARGE') return 'This file is too large to save.';
    if (error.code === 'UNSUPPORTED_MEDIA_TYPE' || error.code === 'MEDIA_SIGNATURE_MISMATCH') {
      return 'This file format could not be saved.';
    }
    if (error.code === 'MEDIA_STORAGE_NOT_CONFIGURED' || error.code === 'MEDIA_STORAGE_WRITE_FAILED') {
      return 'Private media storage is unavailable right now.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'This item could not be saved.';
}

function CaptureAction({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-14 flex-1 items-center justify-center border px-2 active:opacity-70"
      style={{ backgroundColor: memoryColors.panel, borderColor: memoryColors.line, borderRadius: radii.large }}>
      {icon}
      <AppText variant="meta" className="mt-1 text-center" style={{ color: memoryColors.creamSoft }}>
        {label}
      </AppText>
    </Pressable>
  );
}

function DraftVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} nativeControls contentFit="contain" style={{ width: '100%', aspectRatio: 16 / 9 }} />;
}

function UploadRow({ draft, onRetry, onDiscard }: { draft: UploadDraft; onRetry: () => void; onDiscard: () => void }) {
  const label = draft.phase === 'preparing'
    ? 'Preparing…'
    : draft.phase === 'uploading'
      ? `Uploading ${Math.max(1, Math.round(draft.progress * 100))}%`
      : draft.phase === 'success'
        ? 'Saved privately'
        : draft.error ?? 'Upload failed';
  return (
    <View
      testID={`memory-upload-${draft.id}`}
      className="mt-3 overflow-hidden border"
      style={{ backgroundColor: memoryColors.panel, borderColor: memoryColors.line, borderRadius: radii.medium }}>
      {draft.input.kind === 'PHOTO' ? (
        <Image testID={`memory-draft-photo-${draft.id}`} accessibilityLabel="Selected Memory photo" source={{ uri: draft.input.uri }} contentFit="cover" style={{ width: '100%', height: 160 }} />
      ) : draft.input.kind === 'VIDEO' ? (
        <View testID={`memory-draft-video-${draft.id}`}><DraftVideo uri={draft.input.uri} /></View>
      ) : null}
      <View className="flex-row items-center px-4 py-3">
      {draft.phase === 'success' ? (
        <Check color={memoryColors.sage} size={19} />
      ) : draft.phase === 'error' ? (
        <X color={memoryColors.danger} size={19} />
      ) : (
        <ActivityIndicator color={memoryColors.ember} size="small" />
      )}
      <View className="ml-3 min-w-0 flex-1">
        <AppText variant="label" numberOfLines={1} style={{ color: memoryColors.cream }}>
          {draft.label}
        </AppText>
        <AppText variant="meta" className="mt-0.5" style={{ color: draft.phase === 'error' ? memoryColors.danger : memoryColors.muted }}>
          {label}
        </AppText>
        {draft.phase === 'uploading' ? (
          <View className="mt-2 h-1 overflow-hidden rounded-full" style={{ backgroundColor: memoryColors.line }}>
            <View
              className="h-full rounded-full"
              style={{ backgroundColor: memoryColors.ember, width: `${Math.max(4, draft.progress * 100)}%` }}
            />
          </View>
        ) : null}
      </View>
      {draft.phase === 'error' ? (
        <View className="flex-row">
        <Pressable
          testID={`discard-memory-upload-${draft.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Discard unsaved ${draft.label}`}
          onPress={onDiscard}
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-70">
          <Trash2 color={memoryColors.muted} size={18} />
        </Pressable>
        <Pressable
          testID={`retry-memory-upload-${draft.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Retry ${draft.label}`}
          onPress={onRetry}
          className="ml-3 h-11 w-11 items-center justify-center rounded-full active:opacity-70"
          style={{ backgroundColor: memoryColors.emberSoft }}>
          <RotateCcw color={memoryColors.ember} size={18} />
        </Pressable>
        </View>
      ) : null}
      </View>
    </View>
  );
}

function MemoryMediaCard({
  media,
  index,
  count,
  isCover,
  captionEditing,
  captionDraft,
  mutationPending,
  onCaptionDraft,
  onEditCaption,
  onSaveCaption,
  onMove,
  onCover,
  onRemove,
}: {
  media: MemoryMediaSummary;
  index: number;
  count: number;
  isCover: boolean;
  captionEditing: boolean;
  captionDraft: string;
  mutationPending: boolean;
  onCaptionDraft: (value: string) => void;
  onEditCaption: () => void;
  onSaveCaption: () => void;
  onMove: (direction: -1 | 1) => void;
  onCover: () => void;
  onRemove: () => void;
}) {
  return (
    <View
      testID={`memory-media-${media.id}`}
      className="mb-4 overflow-hidden border"
      style={{ backgroundColor: memoryColors.panel, borderColor: isCover ? memoryColors.gold : memoryColors.line, borderRadius: radii.large }}>
      {media.kind === 'PHOTO' ? (
        <AuthenticatedMediaImage mediaId={media.id} contentType={media.contentType} theme={{ backgroundColor: memoryColors.backgroundRaised, accentColor: memoryColors.ember, mutedColor: memoryColors.muted }} />
      ) : media.kind === 'VIDEO' ? (
        <AuthenticatedMemoryVideo mediaId={media.id} contentType={media.contentType} />
      ) : (
        <AuthenticatedMemoryAudio mediaId={media.id} contentType={media.contentType} durationMs={media.durationMs} />
      )}
      <View className="px-4 pb-4 pt-3">
        <View className="flex-row items-center justify-between">
          <View className="min-w-0 flex-1 pr-3">
            <AppText variant="label" numberOfLines={1} style={{ color: memoryColors.cream }}>
              {media.kind === 'PHOTO' ? 'Photo' : media.kind === 'VIDEO' ? 'Video' : 'Voice note'} · {media.uploader.displayName}
            </AppText>
            {media.kind !== 'PHOTO' && media.durationMs ? (
              <AppText variant="meta" className="mt-0.5" style={{ color: memoryColors.muted }}>
                {formatMediaDuration(media.durationMs)}
              </AppText>
            ) : null}
          </View>
          {isCover ? (
            <View className="rounded-full px-3 py-1" style={{ backgroundColor: memoryColors.gold }}>
              <AppText variant="meta" style={{ color: memoryColors.background }}>Cover</AppText>
            </View>
          ) : null}
        </View>

        {captionEditing ? (
          <View className="mt-3">
            <FocusableTextInput
              testID={`memory-caption-input-${media.id}`}
              accessibilityLabel="Media caption"
              value={captionDraft}
              editable={!mutationPending}
              onChangeText={onCaptionDraft}
              placeholder="Add a small detail…"
              placeholderTextColor={memoryColors.muted}
              maxLength={2000}
              multiline
              containerClassName="min-h-20 border"
              containerStyle={{ backgroundColor: memoryColors.backgroundRaised, borderColor: memoryColors.line, borderRadius: radii.medium }}
              className="flex-1 px-3 py-3 text-base"
              style={{ color: memoryColors.cream }}
            />
            <Pressable
              testID={`save-memory-caption-${media.id}`}
              accessibilityRole="button"
              accessibilityLabel="Save caption"
              disabled={mutationPending}
              onPress={onSaveCaption}
              className="mt-2 min-h-11 items-center justify-center rounded-full active:opacity-70"
              style={{ backgroundColor: memoryColors.ember }}>
              <AppText variant="label" style={{ color: memoryColors.cream }}>Save caption</AppText>
            </Pressable>
          </View>
        ) : media.caption ? (
          <AppText variant="body" className="mt-3" style={{ color: memoryColors.creamSoft }}>{media.caption}</AppText>
        ) : null}

        <View className="mt-3 flex-row items-center">
          <Pressable
            testID={`edit-memory-caption-${media.id}`}
            accessibilityRole="button"
            accessibilityLabel={media.caption ? 'Edit caption' : 'Add caption'}
            onPress={onEditCaption}
            className="mr-1 h-11 flex-row items-center px-2 active:opacity-70">
            <PencilLine color={memoryColors.muted} size={16} />
            <AppText variant="meta" className="ml-1" style={{ color: memoryColors.muted }}>
              {media.caption ? 'Edit' : 'Caption'}
            </AppText>
          </Pressable>
          {media.kind === 'PHOTO' && !isCover ? (
            <Pressable
              testID={`set-memory-cover-${media.id}`}
              accessibilityRole="button"
              accessibilityLabel="Set as Memory cover"
              disabled={mutationPending}
              onPress={onCover}
              className="h-11 flex-row items-center px-2 active:opacity-70">
              <Star color={memoryColors.gold} size={16} />
              <AppText variant="meta" className="ml-1" style={{ color: memoryColors.gold }}>Cover</AppText>
            </Pressable>
          ) : null}
          <View className="flex-1" />
          <Pressable
            testID={`move-memory-media-up-${media.id}`}
            accessibilityRole="button"
            accessibilityLabel="Move earlier"
            disabled={index === 0 || mutationPending}
            onPress={() => onMove(-1)}
            className="h-11 w-10 items-center justify-center disabled:opacity-30">
            <ArrowUp color={memoryColors.muted} size={17} />
          </Pressable>
          <Pressable
            testID={`move-memory-media-down-${media.id}`}
            accessibilityRole="button"
            accessibilityLabel="Move later"
            disabled={index === count - 1 || mutationPending}
            onPress={() => onMove(1)}
            className="h-11 w-10 items-center justify-center disabled:opacity-30">
            <ArrowDown color={memoryColors.muted} size={17} />
          </Pressable>
          <Pressable
            testID={`remove-memory-media-${media.id}`}
            accessibilityRole="button"
            accessibilityLabel="Remove this item"
            disabled={mutationPending}
            onPress={onRemove}
            className="h-11 w-10 items-center justify-center">
            <Trash2 color={memoryColors.danger} size={17} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function MemoryCaptureScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; editDetails?: string; emptyTitle?: string }>();
  const memoryId = Array.isArray(params.id) ? params.id[0] : params.id;
  const queryClient = useQueryClient();
  const session = useSession();
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap });
  const planningContext = usePlanningContext(bootstrap.data);
  const isMounted = useRef<boolean>(true);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [text, setText] = useState<string>('');
  const [textError, setTextError] = useState<string | null>(null);
  const textRequest = useRef<{ id: string; text: string } | null>(null);
  const acknowledgedMemory = useRef<Memory | null>(null);
  const saveOperation = useRef<boolean>(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [photoMenu, setPhotoMenu] = useState<boolean>(false);
  const [videoMenu, setVideoMenu] = useState<boolean>(false);
  const [voiceOpen, setVoiceOpen] = useState<boolean>(false);
  const [uploads, setUploadState] = useState<UploadDraft[]>([]);
  const setUploads = (update: UploadDraft[] | ((current: UploadDraft[]) => UploadDraft[])) => {
    uploadsRef.current = typeof update === 'function' ? update(uploadsRef.current) : update;
    setUploadState(uploadsRef.current);
  };
  const [captionMediaId, setCaptionMediaId] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState<string>('');
  const [removeMedia, setRemoveMedia] = useState<MemoryMediaSummary | null>(null);
  const [mediaAction, setMediaAction] = useState<(() => Promise<void>) | null>(null);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(params.editDetails === '1');
  const [details, setDetails] = useState<{ title: string; date: string; location: string } | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState<boolean>(false);
  const [voiceBusy, setVoiceBusy] = useState<boolean>(false);
  const voiceOperation = useRef<boolean>(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const uploadAnchor = useRef<number>(0);
  const pickerOperation = useRef(createContributionOperation());
  const uploadsRef = useRef<UploadDraft[]>([]);
  const claimedReceipts = useRef<string[]>([]);
  const [voiceRecording, setVoiceRecording] = useState<boolean>(false);
  const voiceRecordingRef = useRef<boolean>(false);
  const [mediaBusy, setMediaBusy] = useState<boolean>(false);
  const [draftReady, setDraftReady] = useState<boolean>(Platform.OS !== 'android');


  const memory = useQuery({
    queryKey: queryKeys.memory(memoryId ?? ''),
    queryFn: () => duodateApi.memory(memoryId!),
    enabled: Boolean(memoryId),
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  });

  useEffect(() => {
    if (params.emptyTitle !== '1' || !memory.data) return;
    setDetails((current) => current ?? { title: '', date: memory.data!.startDate, location: memory.data!.locationSnapshot ?? '' });
  }, [params.emptyTitle, memory.data]);

  const refreshSession = session.refetch;
  useEffect(() => {
    if (!memoryId || (memory.error instanceof ApiError && [403, 404].includes(memory.error.status))) {
      router.replace('/');
    }
    if (memory.error instanceof ApiError && memory.error.status === 401) {
      void refreshSession();
    }
  }, [memory.error, memoryId, refreshSession]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // useAudioRecorder owns disposal; its cleanup releases the recorder before this runs.
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch((error) => {
        console.warn('Could not restore playback audio mode:', error);
      });
    };
  }, []);

  const acceptMemory = (value: Memory) => {
    acknowledgedMemory.current = value;
    // A detail fetch started before the upload must not replace newly saved media.
    void queryClient.cancelQueries({ queryKey: queryKeys.memory(value.id) });
    queryClient.setQueryData(queryKeys.memory(value.id), value);
    queryClient.setQueryData<Memory[]>(queryKeys.memories, (current) =>
      upsertMemoryInList(current, value));
    void queryClient.invalidateQueries({ queryKey: queryKeys.memories });
  };

  const contributionScope = { id: `memory-contributions:${memoryId}` };
  const addText = useMutation({
    scope: contributionScope,
    mutationFn: async (value: string) => {
      if (!textRequest.current || textRequest.current.text !== value) {
        textRequest.current = { id: randomUUID(), text: value };
      }
      const submitted = textRequest.current;
      if (Platform.OS === 'android') {
        // Persist identity before dispatch, including when the activity is later
        // recreated after a committed write whose response never arrived.
        await draftStorageQueue.current;
        await mediaStorage.setItem(`${draftStorageKey}.text-request`, JSON.stringify(submitted));
      }
      return memorySaveRequest('text', memoryId!, (nativeTransport) => duodateApi.addMemoryText(
        memoryId!, value, nextMemoryContributionSortOrder(memory.data?.contributions ?? []), submitted.id, nativeTransport,
      ), (error) => !(error instanceof ApiError));
    },
    onSuccess: (result, submitted) => {
      acceptMemory(result.memory);
      setText((current) => current.trim() === submitted ? '' : current);
      setTextError(null);
      textRequest.current = null;
      if (Platform.OS === 'android') {
        draftStorageQueue.current = draftStorageQueue.current
          .then(() => mediaStorage.removeItem(`${draftStorageKey}.text-request`)).catch(() => {});
      }
    },
    onError: (error) => setTextError(uploadMessage(error)),
  });

  const upload = useMutation({
    scope: contributionScope,
    mutationFn: (draft: UploadDraft) => uploadMemoryMedia(memoryId!, draft.input, (progress) => {
      setUploads((current) => current.map((item) => item.id === draft.id ? { ...item, progress } : item));
    }),
    onSuccess: (result, draft) => {
      acceptMemory(result.memory);
      setUploads((current) => current.map((item) => item.id === draft.id
        ? { ...item, phase: 'success', progress: 1, error: null }
        : item));
      setCaptureError(null);
      setTimeout(() => {
        setUploads((current) => current.filter((item) => item.id !== draft.id));
      }, 1200);
    },
    onError: (error, draft) => {
      setUploads((current) => current.map((item) => item.id === draft.id
        ? { ...item, phase: 'error', error: uploadMessage(error) }
        : item));
    },
  });

  const caption = useMutation({
    scope: contributionScope,
    mutationFn: ({ mediaId, value }: { mediaId: string; value: string }) =>
      updateMemoryMediaCaption(memoryId!, mediaId, value.trim() || null),
    onSuccess: (saved) => {
      if (acknowledgedMemory.current) {
        acknowledgedMemory.current = {
          ...acknowledgedMemory.current,
          mediaItems: acknowledgedMemory.current.mediaItems.map((item) => item.id === saved.id
            ? { ...item, caption: saved.caption, updatedAt: saved.updatedAt } : item),
        };
      }
      queryClient.setQueryData<Memory>(queryKeys.memory(memoryId!), (current) => current ? {
        ...current,
        mediaItems: current.mediaItems.map((item) => item.id === saved.id ? { ...item, caption: saved.caption, updatedAt: saved.updatedAt } : item),
      } : current);
      void queryClient.invalidateQueries({ queryKey: queryKeys.memories });
      setCaptionMediaId(null);
      setCaptionDraft('');
    },
    onError: (error) => setCaptureError(uploadMessage(error)),
  });

  const reorder = useMutation({
    scope: contributionScope,
    mutationFn: (mediaIds: string[]) => reorderMemoryMedia(memoryId!, mediaIds),
    onSuccess: acceptMemory,
    onError: (error) => setCaptureError(uploadMessage(error)),
  });

  const cover = useMutation({
    scope: contributionScope,
    mutationFn: (mediaId: string) => setMemoryCover(memoryId!, mediaId),
    onSuccess: acceptMemory,
    onError: (error) => setCaptureError(uploadMessage(error)),
  });

  const remove = useMutation({
    scope: contributionScope,
    mutationFn: (mediaId: string) => deleteMemoryMedia(memoryId!, mediaId),
    onSuccess: async (_result, mediaId) => {
      acknowledgedMemory.current = null;
      setRemoveMedia(null);
      if (captionMediaId === mediaId) {
        setCaptionMediaId(null);
        setCaptionDraft('');
      }
      await memory.refetch();
      void queryClient.invalidateQueries({ queryKey: queryKeys.memories });
    },
    onError: (error) => setCaptureError(uploadMessage(error)),
  });

  const persistUploadDraft = () => writeMediaDraft(mediaStorage, draftStorageKey, JSON.stringify({ text, details, uploads: uploadsRef.current }));
  const runUpload = async (draft: UploadDraft) => {
    if (draftClosed.current || saveMemory.isPending) return;
    try { if (Platform.OS !== 'web') await persistUploadDraft(); }
    catch {
      setUploads((current) => current.map((item) => item.id === draft.id ? { ...item, phase: 'error', error: 'Device backup failed. Tap retry before leaving.' } : item));
      return;
    }
    setUploads((current) => current.map((item) => item.id === draft.id
      ? { ...item, phase: 'uploading', progress: 0, error: null }
      : item));
    try {
      await upload.mutateAsync({ ...draft, phase: 'uploading', progress: 0, error: null });
    } catch {
      // The mutation keeps the real file available for an explicit retry.
    }
  };

  const enqueueUploads = async (inputs: UploadMemoryMediaInput[]) => {
    const drafts = inputs.map((input) => {
      const id = input.clientRequestId ?? randomUUID();
      return {
        id, label: input.kind === 'PHOTO' ? 'Photo' : input.kind === 'VIDEO' ? 'Video' : 'Voice note',
        phase: 'preparing' as const, progress: 0, error: null,
        input: { ...input, clientRequestId: id, uri: retainMediaFile(input.uri, id, input.fileName) },
      };
    });
    const fresh = drafts.filter((draft) => !uploadsRef.current.some((item) => item.id === draft.id));
    uploadsRef.current = [...uploadsRef.current, ...fresh];
    setUploads(uploadsRef.current);
    if (Platform.OS !== 'web') {
      await draftStorageQueue.current.catch(() => {});
      try { await persistUploadDraft(); }
      catch (error) {
        uploadsRef.current = uploadsRef.current.map((item) => drafts.some((draft) => draft.id === item.id)
          ? { ...item, phase: 'error', error: 'Device backup failed. Tap retry before leaving.' } : item);
        setUploads(uploadsRef.current);
        throw error;
      }
    }
    setTimeout(() => scrollRef.current?.scrollTo({ y: uploadAnchor.current, animated: true }), 100);
    void (async () => { for (const draft of drafts) {
      const current = uploadsRef.current.find((item) => item.id === draft.id);
      if (current && (current.phase === 'preparing' || current.phase === 'error')) await runUpload(current);
    } })();
  };

  const nextQueuedMediaSortOrder = () => Math.max(
    nextMemoryMediaSortOrder(memory.data?.mediaItems ?? []),
    uploadsRef.current.reduce(
      (next, draft) => Math.max(next, (draft.input.sortOrder ?? -1) + 1),
      0,
    ),
  );

  const draftStorageKey = `duodate.memory-capture.${memoryId}`;
  const draftStorageQueue = useRef<Promise<void>>(Promise.resolve());
  const draftClosed = useRef<boolean>(false);
  useEffect(() => {
    if (Platform.OS !== 'android' || !memoryId) return;
    let active = true;
    void readMediaDraft(mediaStorage, draftStorageKey).then((raw) => Promise.all([
      Promise.resolve(raw),
      mediaStorage.getItem(`${draftStorageKey}.text-request`),
      mediaStorage.getItem(`${draftStorageKey}.receipts`),
    ])).then(([raw, pendingText, receipts]) => {
      if (!active) return;
      if (pendingText) textRequest.current = JSON.parse(pendingText);
      if (receipts) claimedReceipts.current = JSON.parse(receipts);
      if (!raw) return;
      const draft = JSON.parse(raw) as { text?: string; details?: typeof details; uploads?: UploadDraft[] };
      setText((current) => current || draft.text || '');
      if (draft.details) setDetails((current) => current ?? draft.details ?? null);
      if (draft.uploads?.length) {
        const restored = draft.uploads.filter((item) => item.input?.uri && item.phase !== 'success');
        uploadsRef.current = restored.map((item) => ({ ...item, phase: 'error' as const, error: 'Upload interrupted. Tap retry to save this item.' }));
        setUploads(uploadsRef.current);
      }
    }).catch(() => {
      if (active) setCaptureError('Your local draft could not be restored. Saved contributions are still available.');
    }).finally(() => { if (active) setDraftReady(true); });
    return () => { active = false; };
  }, [draftStorageKey, memoryId]);

  // Progress is transient. Writing every upload byte update can leave a long
  // storage queue blocking the next camera/video handoff.

  const serializedDraft = JSON.stringify({ text, details, uploads: uploads
    .filter((item) => item.phase !== 'success')
    .map((item) => ({ ...item, progress: 0 })) });
  useEffect(() => {
    if (Platform.OS !== 'android' || !draftReady || draftClosed.current) return;
    draftStorageQueue.current = draftStorageQueue.current
      .then(() => writeMediaDraft(mediaStorage, draftStorageKey, serializedDraft))
      .catch(() => { if (isMounted.current) setCaptureError('Your draft could not be kept on this device. Please finish saving before leaving.'); });
  }, [draftReady, draftStorageKey, serializedDraft]);

  const acceptPickerReceipt = async (receiptId: string, result: ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult) => {
    if (!draftReady) throw new Error('Your media draft is still restoring.');
    if (!claimedReceipts.current.includes(receiptId)) {
      if ('code' in result) setCaptureError(result.message);
      else if (!result.canceled) {
        const inputs: UploadMemoryMediaInput[] = [];
        for (const [index, selected] of result.assets.entries()) {
          const asset = nativePickerAsset(selected);
          const kind = asset.type === 'video' || asset.mimeType?.startsWith('video/') ? 'VIDEO' : 'PHOTO';
          const prepared = prepareMemoryPickerAssets([asset], kind, nextQueuedMediaSortOrder() + inputs.length);
          if (prepared.errors.length) setCaptureError(prepared.errors.join(' '));
          inputs.push(...prepared.inputs.map((input) => ({ ...input, clientRequestId: receiptAssetId(receiptId, index) })));
        }
        await enqueueUploads(inputs);
      }
      claimedReceipts.current.push(receiptId);
    }
    await writeMediaDraft(mediaStorage, `${draftStorageKey}.receipts`, JSON.stringify(claimedReceipts.current));
  };
  const acceptPickerReceiptRef = useRef(acceptPickerReceipt);
  acceptPickerReceiptRef.current = acceptPickerReceipt;
  const claimPickerReceipt = useCallback((id: string, result: ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult) => acceptPickerReceiptRef.current(id, result), []);
  const sharedPickerBusy = useNativeMediaPicker(`memory:${memoryId}`, claimPickerReceipt, setCaptureError);


  const selectMediaAction = (action: () => Promise<void>) => {
    if (voiceRecordingRef.current || voiceOperation.current || saveMemory.isPending) return;
    if (!draftReady) { setCaptureError('Your media draft is still restoring. Please try again in a moment.'); return; }
    const token = pickerOperation.current.begin();
    if (token === null || sharedPickerBusy) {
      if (token !== null) pickerOperation.current.finish(token);
      setCaptureError('The previous media selection is still returning. Please wait for it to finish.');
      return;
    }
    setMediaBusy(true);
    const hadMenu = photoMenu || videoMenu;
    setPhotoMenu(false);
    setVideoMenu(false);
    const run = async () => {
      try { await action(); }
      catch (error) { if (isMounted.current) setCaptureError(uploadMessage(error)); }
      finally { pickerOperation.current.finish(token); if (isMounted.current) setMediaBusy(false); }
    };
    if (Platform.OS === 'web' || !hadMenu) void run();
    else setMediaAction(() => run);
  };

  const pendingAction = useRef<(() => Promise<void>) | null>(null);
  pendingAction.current = mediaAction;
  const launchMediaAction = useCallback(() => {
    const action = pendingAction.current;
    if (!action) return;
    pendingAction.current = null;
    setMediaAction(null);
    void action();
  }, []);

  useEffect(() => {
    if (!mediaAction || photoMenu || videoMenu || Platform.OS === 'ios') return;
    return deferMediaAction(launchMediaAction, Platform.OS === 'android' ? 350 : 0);
  }, [mediaAction, photoMenu, videoMenu, launchMediaAction]);

  const choosePhotos = async () => {
    await draftStorageQueue.current;
    await launchNativeMediaPicker(`memory:${memoryId}`, () => ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 8,
      quality: Platform.OS === 'android' ? 1 : 0.85, base64: false,
    }));
  };

  const chooseVideo = async () => {
    await draftStorageQueue.current;
    await launchNativeMediaPicker(`memory:${memoryId}`, () => ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'], allowsMultipleSelection: false, quality: 1, base64: false,
    }));
  };

  const captureWithCamera = async (kind: 'PHOTO' | 'VIDEO') => {
    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    if (!cameraPermission.granted) { setCaptureError('Camera access is needed only when you choose to capture something new.'); return; }
    if (kind === 'VIDEO') {
      const microphonePermission = await requestRecordingPermissionsAsync();
      if (!microphonePermission.granted) { setCaptureError('Microphone access is needed to record a video with sound.'); return; }
    }
    await draftStorageQueue.current;
    await launchNativeMediaPicker(`memory:${memoryId}`, () => ImagePicker.launchCameraAsync({
      mediaTypes: kind === 'PHOTO' ? ['images'] : ['videos'],
      quality: Platform.OS === 'android' ? 1 : 0.85, base64: false, videoMaxDuration: 60,
    }));
  };

  const startVoiceNote = async () => {
    if (voiceOperation.current || voiceRecordingRef.current || recorder.isRecording || saveMemory.isPending) return;
    if (pickerOperation.current.busy || sharedPickerBusy) {
      setCaptureError('The previous media selection is still returning. Please wait for it to finish.');
      return;
    }
    voiceOperation.current = true;
    setVoiceBusy(true);
    setCaptureError(null);
    try {
      console.info('[Memory voice]', 'requesting-permission');
      const permission = await requestRecordingPermissionsAsync();
      if (!isMounted.current) return;
      if (!permission.granted) {
        setCaptureError('Microphone access is needed only when you choose to record a voice note.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (!isMounted.current) {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        return;
      }
      console.info('[Memory voice]', 'preparing');
      await recorder.prepareToRecordAsync();
      if (!isMounted.current) return;
      recorder.record();
      if (!recorder.getStatus().isRecording) throw new Error('Recording did not start. Please try again.');
      console.info('[Memory voice]', 'recording');
      voiceRecordingRef.current = true;
      setVoiceRecording(true);
    } catch (error) {
      if (isMounted.current) {
        setCaptureError(uploadMessage(error));
        try { await recorder.stop(); } catch { /* Preparation may not have completed. */ }
      }
    } finally {
      if (!voiceRecordingRef.current) {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch((error) => {
          console.warn('Could not restore playback audio mode:', error);
        });
      }
      voiceOperation.current = false;
      if (isMounted.current) setVoiceBusy(false);
    }
  };

  const stopVoiceNote = async () => {
    if (voiceOperation.current) return;
    voiceOperation.current = true;
    setVoiceBusy(true);
    try {
      const durationMs = Math.max(0, Math.round(recorder.getStatus().durationMillis));
      await recorder.stop();
      if (!isMounted.current) return;
      const uri = recorder.uri;
      voiceRecordingRef.current = false;
      setVoiceRecording(false);
      // Playback-mode reset is cleanup, not a prerequisite for accepting the file.
      if (!uri) throw new Error('The recording could not be prepared.');
      let file: Blob | undefined;
      let byteSize: number | undefined;
      if (Platform.OS === 'web') {
        file = await (await fetch(uri)).blob();
        byteSize = file.size;
      } else {
        byteSize = new File(uri).size;
      }
      const contentType = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      const validationError = validateMemoryMedia('VOICE_NOTE', contentType, byteSize);
      if (validationError) throw new Error(validationError);
      if (!isMounted.current) return;
      await enqueueUploads([{
        kind: 'VOICE_NOTE',
        uri,
        file,
        fileName: mediaFileName('VOICE_NOTE', contentType),
        contentType,
        durationMs,
        sortOrder: nextQueuedMediaSortOrder(),
      }]);
      setVoiceOpen(false);
    } catch (error) {
      if (isMounted.current) setCaptureError(uploadMessage(error));
    } finally {
      // The screen may have unmounted while stop() or file preparation was pending.
      if (isMounted.current) {
        try {
          if (recorder.isRecording) await recorder.stop();
        } catch {
          // The recording session may already have stopped after an interruption.
        } finally {
          voiceRecordingRef.current = false;
          setVoiceRecording(false);
        }
      }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch((error) => {
        console.warn('Could not restore playback audio mode:', error);
      });
      voiceOperation.current = false;
      if (isMounted.current) setVoiceBusy(false);
    }
  };

  const saveMemory = useMutation({
    mutationFn: async () => {
      if (voiceOperation.current || voiceRecordingRef.current || recorder.isRecording || pickerOperation.current.busy || sharedPickerBusy || hasActiveContributions(uploads)) {
        throw new Error('Please wait for your contribution to finish saving.');
      }
      if (details) {
        if (!details.title.trim()) throw new Error('Give this Memory a title.');
        const updated = await memorySaveRequest('details', memoryId!, (nativeTransport) =>
          api.patch<Memory>(`/api/memories/${encodeURIComponent(memoryId!)}`, {
            title: details.title.trim(), startDate: details.date,
            specificLocation: details.location.trim() || null,
          }, { timeoutMs: 15000, nativeTransport }), (error) => !(error instanceof ApiError));
        acceptMemory(updated);
        setDetails(null);
        setDetailsOpen(false);
      }
      if (text.trim()) await addText.mutateAsync(text.trim());
      if (captionMediaId) await caption.mutateAsync({ mediaId: captionMediaId, value: captionDraft });
      // Contributions are committed before their response is accepted. Do not
      // make a successfully saved Memory depend on an extra Android stream GET.
      // If no write was acknowledged here, read independently of the observer.
      const saved = acknowledgedMemory.current ?? await memorySaveRequest('verify', memoryId!, (nativeTransport) =>
        api.get<Memory>(`/api/memories/${encodeURIComponent(memoryId!)}`, { timeoutMs: 15000, nativeTransport }),
      (error) => !(error instanceof ApiError));
      if (!hasMemoryContent(saved)) {
        throw new Error('Add a written moment, photo, video, or voice note before saving.');
      }
      return saved;
    },
    onSuccess: (saved) => {
      draftClosed.current = true;
      acceptMemory(saved);
      // Local draft cleanup must not keep a successfully saved Memory open.
      // Queue removal behind older writes without waiting to leave the screen.
      if (Platform.OS === 'android') {
        void draftStorageQueue.current
          .then(() => mediaStorage.removeItem(draftStorageKey))
          .catch(() => {});
      }
      router.dismissTo('/memories');
    },
    onError: (error) => setCaptureError(uploadMessage(error)),
    onSettled: () => { saveOperation.current = false; },
  });

  const orderedMedia = useMemo(
    () => [...(memory.data?.mediaItems ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)),
    [memory.data?.mediaItems],
  );

  if (!memoryId || memory.isLoading) {
    return (
      <SafeAreaView testID="memory-capture-screen" className="flex-1 items-center justify-center" style={{ backgroundColor: memoryColors.background }}>
        <StatusBar style="light" backgroundColor={memoryColors.background} />
        <ActivityIndicator color={memoryColors.ember} size="large" />
        <AppText variant="meta" className="mt-4" style={{ color: memoryColors.muted }}>Opening your shared memory…</AppText>
      </SafeAreaView>
    );
  }
  if (memory.isError || !memory.data) {
    return (
      <SafeAreaView testID="memory-capture-screen" className="flex-1 items-center justify-center px-8" style={{ backgroundColor: memoryColors.background }}>
        <StatusBar style="light" backgroundColor={memoryColors.background} />
        <X color={memoryColors.danger} size={28} />
        <AppText variant="heading" className="mt-4 text-center" style={{ color: memoryColors.cream }}>Memory unavailable</AppText>
        <AppText variant="body" className="mt-2 text-center" style={{ color: memoryColors.muted }}>This shared Memory could not be opened.</AppText>
        <Pressable
          testID="retry-memory-button"
          accessibilityRole="button"
          accessibilityLabel="Try opening Memory again"
          onPress={() => void memory.refetch()}
          className="mt-5 min-h-12 justify-center rounded-full border px-5 active:opacity-70"
          style={{ borderColor: memoryColors.line }}>
          <AppText variant="label" style={{ color: memoryColors.cream }}>Try again</AppText>
        </Pressable>
      </SafeAreaView>
    );
  }

  const value = memory.data;
  const firstContentSaved = hasMemoryContent(value);
  const mutationPending = caption.isPending || reorder.isPending || cover.isPending || remove.isPending || saveMemory.isPending;
  const canSaveMemory = canCompleteMemory({
    hasSavedContent: firstContentSaved, text, title: details?.title ?? (params.emptyTitle === '1' ? '' : value.title),
    draftReady, uploads, mutationPending: addText.isPending || mutationPending,
    recording: voiceRecording, voiceBusy, mediaBusy: mediaBusy || sharedPickerBusy,
  });
  const detailValue = details ?? { title: params.emptyTitle === '1' ? '' : value.title, date: value.startDate, location: value.locationSnapshot ?? '' };

  return (
    <SafeAreaView testID="memory-capture-screen" className="flex-1" style={{ backgroundColor: memoryColors.background }}>
      <StatusBar style="light" backgroundColor={memoryColors.background} />
      <KeyboardProvider preload={false} preserveEdgeToEdge>
        <View className="absolute -right-20 top-10 h-64 w-64 rounded-full" style={{ backgroundColor: '#30241F', opacity: 0.72 }} />
        <View className="absolute -left-24 top-72 h-56 w-56 rounded-full" style={{ backgroundColor: '#242B25', opacity: 0.62 }} />
        <KeyboardAwareScrollView
          ref={scrollRef}
          testID="memory-capture-scroll"
          bottomOffset={24}
          disableScrollOnKeyboardHide
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
          <View className="flex-row items-center justify-between pb-2 pt-1">
            <Pressable
              testID="memory-back-button"
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => router.back()}
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
              style={{ backgroundColor: memoryColors.panel }}>
              <ArrowLeft color={memoryColors.cream} size={21} />
            </Pressable>
            <View
              testID="memory-capture-status"
              className="rounded-full border px-3 py-2"
              style={{ backgroundColor: firstContentSaved ? '#293229' : memoryColors.emberSoft, borderColor: firstContentSaved ? memoryColors.sage : memoryColors.ember }}>
              <AppText variant="meta" style={{ color: firstContentSaved ? memoryColors.sage : memoryColors.creamSoft }}>
                {firstContentSaved ? 'SAVED TOGETHER' : 'ADD A MOMENT'}
              </AppText>
            </View>
          </View>

          <View className="pt-2">
            <AppText variant="title" className="leading-[34px]" style={{ color: memoryColors.cream }}>
              Let&apos;s save this memory
            </AppText>
            <AppText variant="label" className="mt-3" style={{ color: memoryColors.gold }}>
              {formatCalendarDate(value.startDate, 'EEEE · d MMMM yyyy').toUpperCase()}
            </AppText>
            {detailValue.title ? (
              <AppText variant="heading" className="mt-1" style={{ color: memoryColors.cream }}>
                {params.emptyTitle === '1' ? detailValue.title : value.title}
              </AppText>
            ) : null}
            {value.locationSnapshot ? (
              <View className="mt-1 flex-row items-center">
                <MapPin color={memoryColors.muted} size={15} />
                <AppText variant="meta" className="ml-2" style={{ color: memoryColors.creamSoft }}>{value.locationSnapshot}</AppText>
              </View>
            ) : null}
          </View>

          <Pressable testID="edit-memory-details" accessibilityRole="button" accessibilityLabel="Edit Memory title, date and location" onPress={() => setDetailsOpen((current) => !current)} className="mt-2 min-h-11 flex-row items-center self-start">
            <PencilLine color={memoryColors.gold} size={16} />
            <AppText variant="meta" className="ml-2" style={{ color: memoryColors.gold }}>{detailsOpen ? 'Hide details' : 'Edit details'}</AppText>
          </Pressable>
          {detailsOpen ? (
            <View testID="memory-details-form" pointerEvents={saveMemory.isPending ? 'none' : 'auto'} className="mt-2 gap-3">
              <AppText variant="label" style={{ color: memoryColors.creamSoft }}>Title</AppText>
              <FocusableTextInput testID="memory-title-input" accessibilityLabel="Memory title" editable={!saveMemory.isPending} value={detailValue.title} placeholder="Our spontaneous memory" onChangeText={(title) => setDetails({ ...detailValue, title })} maxLength={200} placeholderTextColor={memoryColors.muted} containerClassName="min-h-14 border" containerStyle={{ backgroundColor: memoryColors.backgroundRaised, borderColor: memoryColors.line, borderRadius: radii.medium }} className="flex-1 px-4 text-base" style={{ color: memoryColors.cream }} />
              <Pressable testID="memory-date-button" accessibilityRole="button" accessibilityLabel="Edit Memory date" onPress={() => setDatePickerOpen((current) => !current)} className="min-h-12 justify-center rounded-xl border px-4" style={{ borderColor: memoryColors.line, backgroundColor: memoryColors.panel }}>
                <AppText variant="label" style={{ color: memoryColors.gold }}>{formatCalendarDate(detailValue.date)}</AppText>
              </Pressable>
              {datePickerOpen ? <CalendarDateInput testID="memory-date-picker" value={detailValue.date} timeZone={memoryDateTimeZone(planningContext.timeZone)} onChange={(date) => { setDetails({ ...detailValue, date }); setDatePickerOpen(false); }} onDismiss={() => setDatePickerOpen(false)} /> : null}
              <AppText variant="label" style={{ color: memoryColors.creamSoft }}>Location · Optional</AppText>
              <FocusableTextInput testID="memory-location-input" accessibilityLabel="Memory location" editable={!saveMemory.isPending} value={detailValue.location} onChangeText={(location) => setDetails({ ...detailValue, location })} placeholder="The corner café" maxLength={300} placeholderTextColor={memoryColors.muted} containerClassName="min-h-14 border" containerStyle={{ backgroundColor: memoryColors.backgroundRaised, borderColor: memoryColors.line, borderRadius: radii.medium }} className="flex-1 px-4 text-base" style={{ color: memoryColors.cream }} />
            </View>
          ) : null}

          {value.generalText ? (
            <View className="mt-3 border-l-2 pl-4" style={{ borderColor: memoryColors.gold }}>
              <AppText variant="body" style={{ color: memoryColors.creamSoft }}>{value.generalText}</AppText>
            </View>
          ) : null}

          {value.contributions.map((contribution) => contribution.kind === 'TEXT' && contribution.text ? (
            <View
              key={contribution.id}
              testID={`memory-text-${contribution.id}`}
              className="mt-3 border px-4 py-3"
              style={{ backgroundColor: memoryColors.panel, borderColor: memoryColors.line, borderRadius: radii.large }}>
              <AppText variant="body" style={{ color: memoryColors.cream }}>{contribution.text}</AppText>
              <AppText variant="meta" className="mt-3" style={{ color: memoryColors.muted }}>
                {contribution.author.displayName}
              </AppText>
            </View>
          ) : null)}

          <View className="mt-4">
            <AppText variant="label" style={{ color: memoryColors.creamSoft }}>Write something</AppText>
            <FocusableTextInput
              testID="memory-text-input"
              accessibilityLabel="Write something for this Memory"
              value={text}
              editable={!saveMemory.isPending}
              onChangeText={(value: string) => {
                setText(value);
                if (textError) setTextError(null);
              }}
              placeholder="The detail you don’t want to lose…"
              placeholderTextColor={memoryColors.muted}
              maxLength={20000}
              multiline
              textAlignVertical="top"
              containerClassName="mt-2 min-h-20 border"
              containerStyle={{ backgroundColor: memoryColors.backgroundRaised, borderColor: memoryColors.line, borderRadius: radii.large }}
              className="flex-1 px-4 py-3 text-base leading-6"
              style={{ color: memoryColors.cream }}
            />
            <Pressable
              testID="save-memory-text-button"
              accessibilityRole="button"
              accessibilityLabel="Save written memory"
              disabled={!text.trim() || addText.isPending || saveMemory.isPending}
              onPress={() => {
                setTextError(null);
                addText.mutate(text.trim());
              }}
              className="mt-2 min-h-11 flex-row items-center justify-center rounded-full px-5 active:opacity-75 disabled:opacity-40"
              style={{ backgroundColor: memoryColors.ember }}>
              {addText.isPending ? <ActivityIndicator color={memoryColors.cream} /> : <Check color={memoryColors.cream} size={18} />}
              {!addText.isPending ? (
                <AppText variant="label" className="ml-2" style={{ color: memoryColors.cream }}>Add to memory</AppText>
              ) : null}
            </Pressable>
            {textError ? (
              <View
                testID="memory-text-error"
                className="mt-2 flex-row items-center border px-4 py-3"
                style={{ backgroundColor: '#3B2925', borderColor: memoryColors.danger, borderRadius: radii.medium }}>
                <AppText variant="meta" className="min-w-0 flex-1" style={{ color: memoryColors.danger }}>
                  {textError}
                </AppText>
                <Pressable
                  testID="retry-memory-text-button"
                  accessibilityRole="button"
                  accessibilityLabel="Retry saving written memory"
                  disabled={!text.trim() || addText.isPending || saveMemory.isPending}
                  onPress={() => {
                    setTextError(null);
                    addText.mutate(text.trim());
                  }}
                  className="ml-3 min-h-11 flex-row items-center rounded-full px-3 active:opacity-70 disabled:opacity-40"
                  style={{ backgroundColor: memoryColors.emberSoft }}>
                  <RotateCcw color={memoryColors.ember} size={16} />
                  <AppText variant="meta" className="ml-1" style={{ color: memoryColors.ember }}>Retry</AppText>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View className="mt-4" pointerEvents={saveMemory.isPending ? 'none' : 'auto'}>
            <AppText variant="label" style={{ color: memoryColors.creamSoft }}>Add a photo, video, or voice note</AppText>
            <View className="mt-2 flex-row gap-2">
              <CaptureAction testID="add-memory-photo" label="Photo" icon={<ImagePlus color={memoryColors.ember} size={23} />} onPress={() => setPhotoMenu(true)} />
              <CaptureAction testID="add-memory-video" label="Video" icon={<Video color={memoryColors.gold} size={23} />} onPress={() => setVideoMenu(true)} />
              <CaptureAction testID="add-memory-voice" label="Voice" icon={<Mic color={memoryColors.sage} size={23} />} onPress={() => { if (!voiceOperation.current && !voiceRecordingRef.current) setVoiceOpen((current) => !current); }} />
            </View>

          </View>

          {voiceOpen ? (
            <View
              testID="memory-voice-recorder"
              className="mt-4 border px-5 py-5"
              style={{ backgroundColor: memoryColors.panel, borderColor: voiceRecording ? memoryColors.ember : memoryColors.line, borderRadius: radii.large }}>
              <View className="flex-row items-center justify-between">
                <View>
                  <AppText variant="heading" style={{ color: memoryColors.cream }}>Voice note</AppText>
                  <AppText variant="meta" className="mt-1" style={{ color: memoryColors.muted }}>
                    {voiceRecording ? `Recording · ${formatMediaDuration(recorderState.durationMillis)}` : 'Record only when you are ready.'}
                  </AppText>
                </View>
                <Pressable
                  testID="close-memory-voice-recorder"
                  accessibilityRole="button"
                  accessibilityLabel="Close voice recorder"
                  disabled={voiceRecording || voiceBusy}
                  onPress={() => setVoiceOpen(false)}
                  className="h-11 w-11 items-center justify-center rounded-full disabled:opacity-30">
                  <X color={memoryColors.muted} size={19} />
                </Pressable>
              </View>
              <Pressable
                testID={voiceRecording ? 'stop-memory-voice-note' : 'record-memory-voice-note'}
                accessibilityRole="button"
                accessibilityLabel={voiceRecording ? 'Stop and save voice note' : 'Start voice note'}
                disabled={voiceBusy}
                onPress={() => voiceRecording ? void stopVoiceNote() : void startVoiceNote()}
                className="mt-5 min-h-14 flex-row items-center justify-center rounded-full active:opacity-75"
                style={{ backgroundColor: voiceRecording ? memoryColors.cream : memoryColors.ember }}>
                {voiceRecording ? <CircleStop color={memoryColors.background} size={20} /> : <Mic color={memoryColors.cream} size={20} />}
                <AppText variant="label" className="ml-2" style={{ color: voiceRecording ? memoryColors.background : memoryColors.cream }}>
                  {voiceRecording ? 'Stop & save' : 'Start recording'}
                </AppText>
              </Pressable>
            </View>
          ) : null}

          {captureError ? (
            <View
              testID="memory-capture-error"
              className="mt-4 border px-4 py-3"
              style={{ backgroundColor: '#3B2925', borderColor: memoryColors.danger, borderRadius: radii.medium }}>
              <AppText variant="meta" style={{ color: memoryColors.danger }}>{captureError}</AppText>
            </View>
          ) : null}

          <View testID="memory-upload-feedback" pointerEvents={saveMemory.isPending ? 'none' : 'auto'} onLayout={(event) => { uploadAnchor.current = event.nativeEvent.layout.y; }}>
            {uploads.map((draft) => (
              <UploadRow key={draft.id} draft={draft} onRetry={() => void runUpload(draft)} onDiscard={() => {
                if (draft.phase !== 'error') return;
                setUploads((current) => current.filter((item) => item.id !== draft.id || item.phase !== 'error'));
              }} />
            ))}
          </View>

          {orderedMedia.length > 0 ? (
            <View className="mt-10">
              <AppText variant="label" style={{ color: memoryColors.creamSoft }}>Saved in this Memory</AppText>
              <View className="mt-3">
                {orderedMedia.map((media, index) => (
                  <MemoryMediaCard
                    key={media.id}
                    media={media}
                    index={index}
                    count={orderedMedia.length}
                    isCover={value.coverMediaId === media.id}
                    captionEditing={captionMediaId === media.id}
                    captionDraft={captionMediaId === media.id ? captionDraft : ''}
                    mutationPending={mutationPending}
                    onCaptionDraft={setCaptionDraft}
                    onEditCaption={() => {
                      setCaptionMediaId(media.id);
                      setCaptionDraft(media.caption ?? '');
                    }}
                    onSaveCaption={() => caption.mutate({ mediaId: media.id, value: captionDraft })}
                    onMove={(direction) => {
                      const next = [...orderedMedia];
                      const target = index + direction;
                      [next[index], next[target]] = [next[target], next[index]];
                      reorder.mutate(next.map((item) => item.id));
                    }}
                    onCover={() => cover.mutate(media.id)}
                    onRemove={() => setRemoveMedia(media)}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </KeyboardAwareScrollView>
        <KeyboardStickyView enabled={Platform.OS === 'ios'} testID="save-memory-area" style={{ paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, backgroundColor: memoryColors.background, borderColor: memoryColors.line }}>
          <Pressable
            testID="save-memory-button"
            accessibilityRole="button"
            accessibilityLabel="Save Memory"
            disabled={!canSaveMemory || saveMemory.isPending}
            onPress={() => {
              if (saveOperation.current) return;
              saveOperation.current = true;
              saveMemory.mutate();
            }}
            className="min-h-14 flex-row items-center justify-center rounded-full active:opacity-75 disabled:opacity-40"
            style={{ backgroundColor: memoryColors.ember }}>
            {saveMemory.isPending ? <ActivityIndicator color={memoryColors.cream} /> : <Check color={memoryColors.cream} size={19} />}
            <AppText variant="label" className="ml-2" style={{ color: memoryColors.cream }}>{saveMemory.isPending ? 'Saving Memory…' : 'Save Memory'}</AppText>
          </Pressable>
        </KeyboardStickyView>
      </KeyboardProvider>

      {(photoMenu || Platform.OS !== 'android') ? <Modal visible={photoMenu} transparent animationType={Platform.OS === 'android' ? 'none' : 'fade'} onDismiss={launchMediaAction} onRequestClose={() => setPhotoMenu(false)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.62)' }}>
          <Pressable testID="photo-source-backdrop" accessibilityRole="button" accessibilityLabel="Close photo choices" className="flex-1" onPress={() => setPhotoMenu(false)} />
          <View className="px-5 pb-8 pt-5" style={{ backgroundColor: memoryColors.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28 }}>
            <AppText variant="title" style={{ color: memoryColors.cream }}>Add a photo</AppText>
            <View className="mt-5 gap-3">
              <Pressable testID="take-memory-photo" accessibilityRole="button" accessibilityLabel="Take a photo" onPress={() => selectMediaAction(() => captureWithCamera('PHOTO'))} className="min-h-14 flex-row items-center rounded-full px-5 active:opacity-75" style={{ backgroundColor: memoryColors.ember }}>
                <Camera color={memoryColors.cream} size={20} />
                <AppText variant="label" className="ml-3" style={{ color: memoryColors.cream }}>Take a photo</AppText>
              </Pressable>
              <Pressable testID="choose-memory-photos" accessibilityRole="button" accessibilityLabel="Choose photos from library" onPress={() => selectMediaAction(choosePhotos)} className="min-h-14 flex-row items-center rounded-full border px-5 active:opacity-75" style={{ borderColor: memoryColors.line }}>
                <Images color={memoryColors.creamSoft} size={20} />
                <AppText variant="label" className="ml-3" style={{ color: memoryColors.creamSoft }}>Choose photos</AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal> : null}

      {(videoMenu || Platform.OS !== 'android') ? <Modal visible={videoMenu} transparent animationType={Platform.OS === 'android' ? 'none' : 'fade'} onDismiss={launchMediaAction} onRequestClose={() => setVideoMenu(false)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.62)' }}>
          <Pressable testID="video-source-backdrop" accessibilityRole="button" accessibilityLabel="Close video choices" className="flex-1" onPress={() => setVideoMenu(false)} />
          <View className="px-5 pb-8 pt-5" style={{ backgroundColor: memoryColors.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28 }}>
            <AppText variant="title" style={{ color: memoryColors.cream }}>Add a video</AppText>
            <AppText variant="meta" className="mt-2" style={{ color: memoryColors.muted }}>New recordings are limited to one minute for a smooth private upload.</AppText>
            <View className="mt-5 gap-3">
              <Pressable testID="record-memory-video" accessibilityRole="button" accessibilityLabel="Record a video" onPress={() => selectMediaAction(() => captureWithCamera('VIDEO'))} className="min-h-14 flex-row items-center rounded-full px-5 active:opacity-75" style={{ backgroundColor: memoryColors.ember }}>
                <Video color={memoryColors.cream} size={20} />
                <AppText variant="label" className="ml-3" style={{ color: memoryColors.cream }}>Record a video</AppText>
              </Pressable>
              <Pressable testID="choose-memory-video" accessibilityRole="button" accessibilityLabel="Choose a video from library" onPress={() => selectMediaAction(chooseVideo)} className="min-h-14 flex-row items-center rounded-full border px-5 active:opacity-75" style={{ borderColor: memoryColors.line }}>
                <Play color={memoryColors.creamSoft} size={20} />
                <AppText variant="label" className="ml-3" style={{ color: memoryColors.creamSoft }}>Choose a video</AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal> : null}

      <Modal visible={Boolean(removeMedia)} transparent animationType="fade" onRequestClose={() => setRemoveMedia(null)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.62)' }}>
          <Pressable testID="remove-media-backdrop" accessibilityRole="button" accessibilityLabel="Keep this item" className="flex-1" onPress={() => setRemoveMedia(null)} />
          <View className="px-5 pb-8 pt-5" style={{ backgroundColor: memoryColors.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28 }}>
            <AppText variant="title" style={{ color: memoryColors.cream }}>Remove this {removeMedia?.kind === 'PHOTO' ? 'photo' : removeMedia?.kind === 'VIDEO' ? 'video' : 'voice note'}?</AppText>
            <AppText variant="body" className="mt-2" style={{ color: memoryColors.muted }}>
              It will be removed from this shared Memory. If it is the only contribution, capture will remain open.
            </AppText>
            <Pressable testID="confirm-remove-memory-media" accessibilityRole="button" accessibilityLabel="Remove this item" disabled={remove.isPending} onPress={() => removeMedia && remove.mutate(removeMedia.id)} className="mt-6 min-h-14 flex-row items-center justify-center rounded-full active:opacity-75" style={{ backgroundColor: memoryColors.danger }}>
              {remove.isPending ? <ActivityIndicator color={memoryColors.background} /> : <Trash2 color={memoryColors.background} size={19} />}
              {!remove.isPending ? <AppText variant="label" className="ml-2" style={{ color: memoryColors.background }}>Remove item</AppText> : null}
            </Pressable>
            <Pressable testID="keep-memory-media" accessibilityRole="button" accessibilityLabel="Keep this item" onPress={() => setRemoveMedia(null)} className="mt-2 min-h-12 items-center justify-center">
              <AppText variant="label" style={{ color: memoryColors.creamSoft }}>Keep it</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
