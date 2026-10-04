import { ActivityIndicator, Pressable, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { AlertCircle, Mic, Pause, Play } from 'lucide-react-native';
import { AppText } from '@/components/ui';
import { useAuthenticatedMediaUri } from '@/lib/authenticated-media';
import { formatMediaDuration } from '@/lib/memory-capture';

const playbackColors = {
  panel: '#27231F',
  panelRaised: '#322C27',
  cream: '#F7EEDC',
  muted: '#BFB3A3',
  accent: '#DF8D80',
  line: '#4A4139',
};

function PlaybackUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <Pressable
      testID="memory-media-retry"
      accessibilityRole="button"
      accessibilityLabel="Retry opening media"
      onPress={onRetry}
      className="min-h-28 items-center justify-center px-5">
      <AlertCircle color={playbackColors.accent} size={22} />
      <AppText variant="meta" className="mt-2 text-center" style={{ color: playbackColors.muted }}>
        This item could not be opened. Tap to retry.
      </AppText>
    </Pressable>
  );
}

export function AuthenticatedMemoryVideo({
  mediaId,
  contentType,
}: {
  mediaId: string;
  contentType: string;
}) {
  const content = useAuthenticatedMediaUri(mediaId, contentType);
  const player = useVideoPlayer(content.data ?? null, (value) => {
    value.loop = false;
  });

  if (content.isLoading) {
    return (
      <View testID={`memory-video-loading-${mediaId}`} className="aspect-video items-center justify-center">
        <ActivityIndicator color={playbackColors.accent} />
      </View>
    );
  }
  if (content.isError || !content.data) {
    return <PlaybackUnavailable onRetry={() => void content.refetch()} />;
  }

  return (
    <VideoView
      testID={`memory-video-${mediaId}`}
      accessibilityLabel="Memory video"
      player={player}
      nativeControls
      contentFit="contain"
      allowsPictureInPicture={false}
      style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' }}
    />
  );
}

export function AuthenticatedMemoryAudio({
  mediaId,
  contentType,
  durationMs,
}: {
  mediaId: string;
  contentType: string;
  durationMs: number | null;
}) {
  const content = useAuthenticatedMediaUri(mediaId, contentType);
  const player = useAudioPlayer(content.data ?? null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  if (content.isLoading) {
    return (
      <View testID={`memory-audio-loading-${mediaId}`} className="h-24 items-center justify-center">
        <ActivityIndicator color={playbackColors.accent} />
      </View>
    );
  }
  if (content.isError || !content.data) {
    return <PlaybackUnavailable onRetry={() => void content.refetch()} />;
  }

  const currentMs = Math.round(status.currentTime * 1000);
  const totalMs = status.duration > 0 ? Math.round(status.duration * 1000) : durationMs;
  return (
    <View testID={`memory-audio-${mediaId}`} className="flex-row items-center px-4 py-4">
      <Pressable
        testID={`memory-audio-toggle-${mediaId}`}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice note' : 'Play voice note'}
        onPress={() => {
          if (status.playing) player.pause();
          else {
            if (status.didJustFinish) void player.seekTo(0);
            player.play();
          }
        }}
        className="h-12 w-12 items-center justify-center rounded-full active:opacity-75"
        style={{ backgroundColor: playbackColors.accent }}>
        {status.playing ? (
          <Pause color={playbackColors.cream} fill={playbackColors.cream} size={19} />
        ) : (
          <Play color={playbackColors.cream} fill={playbackColors.cream} size={19} />
        )}
      </Pressable>
      <View className="ml-4 flex-1">
        <View className="flex-row items-center">
          <Mic color={playbackColors.muted} size={15} />
          <AppText variant="label" className="ml-2" style={{ color: playbackColors.cream }}>
            Voice note
          </AppText>
        </View>
        <AppText variant="meta" className="mt-1" style={{ color: playbackColors.muted }}>
          {formatMediaDuration(currentMs)} / {formatMediaDuration(totalMs)}
        </AppText>
      </View>
    </View>
  );
}
