import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { AppText, colors, radii } from '@/components/ui';
import { useAuthenticatedPrivateMediaUri } from '@/lib/authenticated-media';
import type { IdeaImage } from '@/lib/api/duodate';

export function IdeaVideoPreview({ uri, onRetry }: { uri: string; onRetry?: () => void }) {
  const player = useVideoPlayer(uri, (value) => { value.loop = false; });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  return (
    <View testID="idea-video-preview">
      <VideoView
        accessibilityLabel="Idea video"
        player={player}
        nativeControls
        allowsPictureInPicture={false}
        contentFit="contain"
        style={{ width: '100%', height: 180, backgroundColor: colors.ink }}
      />
      {status === 'error' ? (
        <View testID="idea-video-playback-error" className="px-3 py-2">
          <AppText variant="meta" tone="danger">This video could not be played on this device.</AppText>
          {onRetry ? (
            <Pressable testID="idea-video-playback-retry" accessibilityRole="button" onPress={onRetry} className="min-h-11 justify-center">
              <AppText variant="label" tone="accent">Retry video</AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function AuthenticatedIdeaVideo({ image }: { image: IdeaImage }) {
  const content = useAuthenticatedPrivateMediaUri(image.id, image.contentPath, image.contentType);
  const [retryVersion, setRetryVersion] = useState<number>(0);
  const retry = () => { setRetryVersion((value) => value + 1); void content.refetch(); };
  if (content.isLoading) {
    return <View testID="idea-video-loading" className="h-44 items-center justify-center"><ActivityIndicator color={colors.rose} /></View>;
  }
  if (content.isError || !content.data) {
    return (
      <Pressable
        testID="idea-video-retry"
        accessibilityRole="button"
        accessibilityLabel="Retry opening idea video"
        onPress={retry}
        className="h-44 items-center justify-center"
        style={{ backgroundColor: colors.paperDeep, borderRadius: radii.large }}>
        <AppText variant="meta" tone="muted">Video could not be opened. Tap to retry.</AppText>
      </Pressable>
    );
  }
  return <IdeaVideoPreview key={`${content.data}-${retryVersion}`} uri={content.data} onRetry={retry} />;
}
