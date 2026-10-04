import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Archive, BookOpen, MapPin, Plus, Search, X } from 'lucide-react-native';
import { AuthenticatedMediaImage } from '@/components/AuthenticatedMediaImage';
import { AppText, FocusableTextInput, radii } from '@/components/ui';
import { duodateApi, queryKeys, type Memory } from '@/lib/api/duodate';
import { formatCalendarDate } from '@/lib/format';
import {
  groupMemoryAlbum,
  memoryAlbumCardRhythm,
  memoryExcerpt,
  memoryMatchesSearch,
  resolveMemoryCover,
} from '@/lib/memory-album';

const albumColors = {
  background: '#1C1916',
  backgroundRaised: '#25211D',
  panel: '#2D2823',
  panelRaised: '#37302A',
  cream: '#F7EDDA',
  creamSoft: '#DED1BD',
  muted: '#AD9F8D',
  line: '#4B4239',
  ember: '#DE8B7E',
  gold: '#C6A466',
  sage: '#8EAA91',
  danger: '#E49388',
} as const;

const imageTheme = {
  backgroundColor: albumColors.backgroundRaised,
  accentColor: albumColors.ember,
  mutedColor: albumColors.muted,
};

function memoryDate(memory: Memory, compact = false) {
  if (!memory.endDate || memory.endDate === memory.startDate) {
    return formatCalendarDate(memory.startDate, compact ? 'd MMM yyyy' : 'd MMMM yyyy');
  }
  return `${formatCalendarDate(memory.startDate, 'd MMM')} – ${formatCalendarDate(memory.endDate, 'd MMM yyyy')}`;
}

function MemoryAlbumCard({ memory, index }: { memory: Memory; index: number }) {
  const cover = resolveMemoryCover(memory);
  const rhythm = memoryAlbumCardRhythm(index);
  const featured = rhythm.span === 'full';
  const excerpt = memoryExcerpt(memory);

  return (
    <Pressable
      testID={`memory-card-${memory.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Open Memory ${memory.title}`}
      onPress={() => router.push({ pathname: '/memory/[id]', params: { id: memory.id } })}
      className="mb-4 overflow-hidden active:opacity-80"
      style={{
        width: featured ? '100%' : '48.5%',
        backgroundColor: albumColors.panel,
        borderColor: albumColors.line,
        borderRadius: featured ? 22 : 18,
        borderWidth: 1,
      }}>
      {cover ? (
        <AuthenticatedMediaImage
          key={cover.id}
          mediaId={cover.id}
          contentType={cover.contentType}
          height={rhythm.imageHeight}
          theme={imageTheme}
        />
      ) : (
        <View
          className="justify-between px-4 py-4"
          style={{ height: rhythm.imageHeight, backgroundColor: featured ? albumColors.panelRaised : albumColors.backgroundRaised }}>
          <BookOpen color={albumColors.gold} size={featured ? 22 : 19} strokeWidth={1.6} />
          {excerpt ? (
            <AppText
              variant={featured ? 'heading' : 'body'}
              numberOfLines={featured ? 5 : 4}
              style={{ color: albumColors.creamSoft }}>
              {excerpt}
            </AppText>
          ) : (
            <AppText variant="meta" style={{ color: albumColors.muted }}>A memory kept in words.</AppText>
          )}
        </View>
      )}

      <View className={featured ? 'px-5 pb-5 pt-4' : 'px-3.5 pb-4 pt-3'}>
        <AppText
          variant={featured ? 'heading' : 'body'}
          numberOfLines={featured ? 2 : 3}
          style={{ color: albumColors.cream, fontWeight: '600' }}>
          {memory.title}
        </AppText>
        <AppText
          variant="meta"
          numberOfLines={1}
          className="mt-1"
          style={{ color: albumColors.gold, fontSize: featured ? 13 : 12 }}>
          {memoryDate(memory, !featured)}
        </AppText>
        {memory.locationSnapshot ? (
          <View className="mt-2 flex-row items-center">
            <MapPin color={albumColors.muted} size={13} strokeWidth={1.8} />
            <AppText
              variant="meta"
              numberOfLines={1}
              className="ml-1.5 flex-1"
              style={{ color: albumColors.muted, fontSize: 12 }}>
              {memory.locationSnapshot}
            </AppText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function OpenCaptureCard({ memory }: { memory: Memory }) {
  return (
    <Pressable
      testID={`memory-capture-card-${memory.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Continue Memory ${memory.title}`}
      onPress={() => router.push({ pathname: '/memory/[id]', params: { id: memory.id } })}
      className="mr-3 min-h-28 justify-between border px-4 py-4 active:opacity-75"
      style={{ width: 224, backgroundColor: albumColors.backgroundRaised, borderColor: albumColors.line, borderRadius: 16 }}>
      <View className="flex-row items-center justify-between">
        <Archive color={albumColors.muted} size={17} strokeWidth={1.7} />
        <AppText variant="meta" style={{ color: albumColors.muted, fontSize: 11 }}>
          ADD A PIECE
        </AppText>
      </View>
      <View className="mt-4">
        <AppText variant="label" numberOfLines={2} style={{ color: albumColors.cream }}>{memory.title}</AppText>
        <AppText variant="meta" numberOfLines={1} className="mt-1" style={{ color: albumColors.muted, fontSize: 12 }}>
          {memoryDate(memory, true)}
        </AppText>
      </View>
    </Pressable>
  );
}

export default function MemoriesAlbumScreen() {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const memories = useQuery({
    queryKey: queryKeys.memories,
    queryFn: duodateApi.memories,
    refetchInterval: 60_000,
  });

  const filteredMemories = useMemo(
    () => (memories.data ?? []).filter((memory) => memoryMatchesSearch(memory, searchQuery)),
    [memories.data, searchQuery],
  );
  const groups = useMemo(() => groupMemoryAlbum(filteredMemories), [filteredMemories]);

  if (memories.isLoading) {
    return (
      <SafeAreaView testID="memories-screen" edges={['top']} className="flex-1 items-center justify-center" style={{ backgroundColor: albumColors.background }}>
        <StatusBar style="light" backgroundColor={albumColors.background} />
        <ActivityIndicator testID="loading-indicator" color={albumColors.ember} size="large" />
        <AppText variant="meta" className="mt-4" style={{ color: albumColors.muted }}>Opening your album…</AppText>
      </SafeAreaView>
    );
  }

  if (memories.isError || !memories.data) {
    return (
      <SafeAreaView testID="memories-screen" edges={['top']} className="flex-1 items-center justify-center px-8" style={{ backgroundColor: albumColors.background }}>
        <StatusBar style="light" backgroundColor={albumColors.background} />
        <AppText variant="heading" className="text-center" style={{ color: albumColors.cream }}>Album unavailable</AppText>
        <AppText variant="body" className="mt-2 text-center" style={{ color: albumColors.muted }}>We couldn’t open your Memories.</AppText>
        <Pressable
          testID="retry-memories-button"
          accessibilityRole="button"
          accessibilityLabel="Try opening Memories again"
          onPress={() => void memories.refetch()}
          className="mt-5 min-h-11 justify-center rounded-full border px-5 active:opacity-70"
          style={{ borderColor: albumColors.line }}>
          <AppText variant="label" style={{ color: albumColors.cream }}>Try again</AppText>
        </Pressable>
      </SafeAreaView>
    );
  }

  const hasMemories = memories.data.length > 0;
  const hasSearchResults = filteredMemories.length > 0;

  return (
    <SafeAreaView testID="memories-screen" edges={['top']} className="flex-1" style={{ backgroundColor: albumColors.background }}>
      <StatusBar style="light" backgroundColor={albumColors.background} />
      <ScrollView
        testID="memories-album-scroll"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="px-4 pb-32 pt-4"
        refreshControl={(
          <RefreshControl
            refreshing={memories.isRefetching}
            onRefresh={() => void memories.refetch()}
            tintColor={albumColors.ember}
            colors={[albumColors.ember]}
            progressBackgroundColor={albumColors.panel}
          />
        )}>
        <View className="flex-row items-end justify-between">
          <AppText
            variant="display"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            className="min-w-0 flex-1 pr-4"
            style={{ color: albumColors.cream }}>
            Memories
          </AppText>
          <AppText testID="memories-lifetime-count" variant="meta" className="pb-1" style={{ color: albumColors.muted }}>
            {memories.data.length} {memories.data.length === 1 ? 'date' : 'dates'}
          </AppText>
        </View>

        {hasMemories ? (
          <Pressable
            testID="new-spontaneous-memory-button"
            accessibilityRole="button"
            accessibilityLabel="Save an unplanned Memory"
            onPress={() => router.push('/memory/new')}
            className="mt-3 min-h-11 flex-row items-center self-start px-1 active:opacity-70">
            <Plus color={albumColors.ember} size={18} />
            <AppText variant="label" className="ml-2" style={{ color: albumColors.ember }}>Save another memory</AppText>
          </Pressable>
        ) : null}

        {hasMemories ? (
          <View
            className="mt-4 min-h-11 flex-row items-center border px-3"
            style={{ backgroundColor: albumColors.backgroundRaised, borderColor: albumColors.line, borderRadius: radii.pill }}>
            <Search color={albumColors.muted} size={17} strokeWidth={1.8} />
            <FocusableTextInput
              testID="memories-search-input"
              accessibilityLabel="Search Memory titles and notes"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search titles and notes"
              placeholderTextColor={albumColors.muted}
              selectionColor={albumColors.ember}
              returnKeyType="search"
              containerClassName="ml-2 min-w-0 flex-1"
              className="flex-1 py-2 text-sm"
              style={{ color: albumColors.cream }}
            />
            {searchQuery ? (
              <Pressable
                testID="clear-memories-search"
                accessibilityRole="button"
                accessibilityLabel="Clear Memories search"
                onPress={() => setSearchQuery('')}
                className="h-11 w-11 items-center justify-center">
                <X color={albumColors.muted} size={17} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!hasMemories ? (
          <View testID="memories-empty-state" className="mt-16 items-start">
            <BookOpen color={albumColors.gold} size={24} strokeWidth={1.5} />
            <AppText variant="title" className="mt-5" style={{ color: albumColors.cream }}>Your album starts here.</AppText>
            <AppText variant="body" className="mt-2" style={{ color: albumColors.muted }}>Keep one moment from a date, planned or spontaneous.</AppText>
            <Pressable
              testID="empty-state-action"
              accessibilityRole="button"
              accessibilityLabel="Save your first Memory"
              onPress={() => router.push('/memory/new')}
              className="mt-6 min-h-12 flex-row items-center justify-center rounded-full px-5 active:opacity-75"
              style={{ backgroundColor: albumColors.ember }}>
              <Plus color={albumColors.cream} size={18} />
              <AppText variant="label" className="ml-2" style={{ color: albumColors.cream }}>Save your first Memory</AppText>
            </Pressable>
          </View>
        ) : !hasSearchResults ? (
          <View testID="memories-no-search-results" className="mt-14 border-t pt-6" style={{ borderColor: albumColors.line }}>
            <AppText variant="heading" style={{ color: albumColors.cream }}>Nothing found</AppText>
            <AppText variant="body" className="mt-1" style={{ color: albumColors.muted }}>Try another title or phrase from a note.</AppText>
          </View>
        ) : (
          <>
            {groups.saved.length > 0 ? (
              <View testID="memories-saved-section" className="mt-8">
                <AppText variant="label" className="mb-3" style={{ color: albumColors.muted, fontSize: 12 }}>CHRONOLOGY</AppText>
                <View className="flex-row flex-wrap justify-between">
                  {groups.saved.map((memory, index) => (
                    <MemoryAlbumCard key={memory.id} memory={memory} index={index} />
                  ))}
                </View>
              </View>
            ) : null}

            {groups.captureRequired.length > 0 ? (
              <View testID="memories-capture-required-section" className={groups.saved.length > 0 ? 'mt-7' : 'mt-8'}>
                <View className="mb-3 flex-row items-baseline justify-between">
                  <AppText variant="label" style={{ color: albumColors.creamSoft }}>Finish these Memories</AppText>
                  <AppText variant="meta" style={{ color: albumColors.muted }}>{groups.captureRequired.length}</AppText>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={{ paddingRight: 4 }}>
                  {groups.captureRequired.map((memory) => <OpenCaptureCard key={memory.id} memory={memory} />)}
                </ScrollView>
              </View>
            ) : null}

          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
