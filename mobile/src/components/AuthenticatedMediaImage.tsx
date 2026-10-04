import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { ImageOff } from 'lucide-react-native';
import { AppText, colors } from '@/components/ui';
import { useAuthenticatedMediaUri } from '@/lib/authenticated-media';

type AuthenticatedMediaImageTheme = {
  backgroundColor?: string;
  accentColor?: string;
  mutedColor?: string;
};

type AuthenticatedMediaImageProps = {
  mediaId: string;
  contentType?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  theme?: AuthenticatedMediaImageTheme;
};

export function AuthenticatedMediaImage({
  mediaId,
  contentType,
  height = 160,
  style,
  backgroundColor,
  theme,
}: AuthenticatedMediaImageProps) {
  const content = useAuthenticatedMediaUri(mediaId, contentType);
  const [loading, setLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState<boolean>(false);
  const surfaceColor = backgroundColor ?? theme?.backgroundColor ?? colors.paperDeep;
  const accentColor = theme?.accentColor ?? colors.rose;
  const mutedColor = theme?.mutedColor ?? colors.inkMuted;
  const containerStyle: StyleProp<ViewStyle> = [{ height, backgroundColor: surfaceColor }, style];

  if (content.isLoading) {
    return (
      <View
        testID={`memory-image-loading-${mediaId}`}
        className="items-center justify-center"
        style={containerStyle}>
        <ActivityIndicator color={accentColor} />
      </View>
    );
  }

  if (content.isError || !content.data || failed) {
    return (
      <Pressable
        testID={`memory-image-retry-${mediaId}`}
        accessibilityRole="button"
        accessibilityLabel="Retry opening photo"
        onPress={() => {
          setFailed(false);
          setLoading(true);
          void content.refetch();
        }}
        className="items-center justify-center"
        style={containerStyle}>
        <ImageOff color={mutedColor} size={22} />
        <AppText variant="meta" className="mt-2" style={{ color: mutedColor }}>
          Tap to retry
        </AppText>
      </Pressable>
    );
  }

  return (
    <View className="overflow-hidden" style={containerStyle}>
      <Image
        testID={`memory-image-${mediaId}`}
        accessibilityLabel="Memory photo"
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
        <View className="absolute inset-0 items-center justify-center" style={{ backgroundColor: surfaceColor }}>
          <ActivityIndicator color={accentColor} />
        </View>
      ) : null}
    </View>
  );
}
