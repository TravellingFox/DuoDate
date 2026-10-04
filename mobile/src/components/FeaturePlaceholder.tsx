import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { AppText, colors, PaperCard, Screen } from '@/components/ui';

export function FeaturePlaceholder({
  title,
  message,
  Icon,
  testID,
}: {
  title: string;
  message: string;
  Icon: LucideIcon;
  testID: string;
}) {
  return (
    <Screen testID={testID} edges={['top']}>
      <View className="flex-1 justify-center px-6 pb-24">
        <PaperCard>
          <View
            className="mb-5 h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.roseSoft }}>
            <Icon color={colors.danger} size={22} />
          </View>
          <AppText variant="title">{title}</AppText>
          <AppText variant="body" tone="soft" className="mt-3">
            {message}
          </AppText>
        </PaperCard>
      </View>
    </Screen>
  );
}
