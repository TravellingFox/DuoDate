import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { ImageOff } from 'lucide-react-native';
import { AppText, colors, radii } from '@/components/ui';
import { useAuthenticatedPrivateMediaUri } from '@/lib/authenticated-media';
import type { IdeaImage } from '@/lib/api/duodate';

export function AuthenticatedIdeaImage({ image }: { image: IdeaImage }) {
  const content = useAuthenticatedPrivateMediaUri(image.id, image.contentPath, image.contentType);
  const [loading, setLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState<boolean>(false);

  if (content.isLoading) {
    return (
      <View
        testID="idea-image-loading"
        className="h-44 items-center justify-center"
        style={{ backgroundColor: colors.paperDeep, borderRadius: radii.large }}>
        <ActivityIndicator color={colors.rose} />
      </View>
    );
  }

  if (content.isError || !content.data || failed) {
    return (
      <Pressable
        testID="idea-image-retry"
        accessibilityRole="button"
        accessibilityLabel="Retry opening idea image"
        onPress={() => {
          setFailed(false);
          setLoading(true);
          void content.refetch();
        }}
        className="h-44 items-center justify-center"
        style={{ backgroundColor: colors.paperDeep, borderRadius: radii.large }}>
        <ImageOff color={colors.inkMuted} size={22} />
        <AppText variant="meta" tone="muted" className="mt-2">Tap to retry</AppText>
      </Pressable>
    );
  }

  return (
    <View className="h-44 overflow-hidden" style={{ backgroundColor: colors.paperDeep, borderRadius: radii.large }}>
      <Image
        testID="idea-image"
        accessibilityLabel="Idea photo or flyer"
        source={{ uri: content.data }}
        cachePolicy="none"
        recyclingKey={content.data}
        contentFit="cover"
        style={{ width: '100%', height: '100%' }}
        onLoadStart={() => {
          setFailed(false);
          setLoading(true);
        }}
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
      />
      {loading ? (
        <View className="absolute inset-0 items-center justify-center" style={{ backgroundColor: colors.paperDeep }}>
          <ActivityIndicator color={colors.rose} />
        </View>
      ) : null}
    </View>
  );
}
