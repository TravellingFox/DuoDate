import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { ImageOff } from 'lucide-react-native';
import { AppText, colors } from '@/components/ui';
import type { TripHeroImage } from '@/lib/api/duodate';
import { useAuthenticatedPrivateMediaUri } from '@/lib/authenticated-media';

export function AuthenticatedTripHeroImage({ hero }: { hero: TripHeroImage }) {
  const content = useAuthenticatedPrivateMediaUri(hero.id, hero.contentPath, hero.contentType);
  const [loading, setLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState<boolean>(false);

  if (content.isLoading) {
    return (
      <View
        testID="trip-hero-photo-loading"
        className="h-56 items-center justify-center"
        style={{ backgroundColor: colors.paperDeep }}>
        <ActivityIndicator color={colors.rose} />
      </View>
    );
  }

  if (content.isError || !content.data || failed) {
    return (
      <Pressable
        testID="trip-hero-photo-retry"
        accessibilityRole="button"
        accessibilityLabel="Retry opening trip photo"
        onPress={() => {
          setFailed(false);
          setLoading(true);
          void content.refetch();
        }}
        className="h-56 items-center justify-center"
        style={{ backgroundColor: colors.paperDeep }}>
        <ImageOff color={colors.inkMuted} size={23} />
        <AppText variant="meta" tone="muted" className="mt-2">Tap to retry</AppText>
      </Pressable>
    );
  }

  return (
    <View className="h-56 overflow-hidden" style={{ backgroundColor: colors.paperDeep }}>
      <Image
        testID="trip-hero-photo"
        accessibilityLabel="Trip hero photo"
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
        <View
          testID="trip-hero-photo-image-loading"
          className="absolute inset-0 items-center justify-center"
          style={{ backgroundColor: colors.paperDeep }}>
          <ActivityIndicator color={colors.rose} />
        </View>
      ) : null}
    </View>
  );
}
