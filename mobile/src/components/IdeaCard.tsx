import { Pressable, View } from 'react-native';
import { ArrowUpRight, CalendarCheck, Clock3, MapPin, RotateCcw, WalletCards } from 'lucide-react-native';
import { AppText, colors, PaperCard, radii } from '@/components/ui';
import type { Idea } from '@/lib/api/duodate';
import { costLabels, durationLabels } from '@/lib/format';

function MetaItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View className="mr-3 mt-2 max-w-full flex-row items-center">
      {icon}
      <AppText variant="meta" tone="soft" className="ml-1.5 shrink" numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

export function IdeaCard({ idea, onPress }: { idea: Idea; onPress: () => void }) {
  const scheduled = idea.schedules.find((schedule) => schedule.status === 'SCHEDULED');

  return (
    <Pressable
      testID={`idea-card-${idea.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Open ${idea.title}`}
      onPress={onPress}
      className="mb-3 active:opacity-80">
      <PaperCard className="py-4">
        <View className="flex-row items-start">
          <View className="flex-1 pr-4">
            {idea.category ? (
              <AppText variant="label" tone="accent" className="mb-1 uppercase">
                {idea.category.name}
              </AppText>
            ) : null}
            <AppText variant="heading" className="text-xl leading-7">
              {idea.title}
            </AppText>
            <AppText testID={`idea-card-creator-${idea.id}`} variant="meta" tone="muted" className="mt-1">
              by {idea.createdBy.displayName}
            </AppText>
          </View>
          <View
            className="h-9 w-9 items-center justify-center"
            style={{ backgroundColor: colors.paperDeep, borderRadius: radii.pill }}>
            <ArrowUpRight color={colors.inkSoft} size={18} />
          </View>
        </View>

        <View className="mt-2 flex-row flex-wrap items-center">
          {idea.costBand ? (
            <MetaItem icon={<WalletCards color={colors.inkMuted} size={15} />} label={costLabels[idea.costBand]} />
          ) : null}
          {idea.durationBand ? (
            <MetaItem icon={<Clock3 color={colors.inkMuted} size={15} />} label={durationLabels[idea.durationBand]} />
          ) : null}
          {idea.specificLocation ? (
            <MetaItem icon={<MapPin color={colors.inkMuted} size={15} />} label={idea.specificLocation} />
          ) : null}
          {scheduled ? (
            <MetaItem icon={<CalendarCheck color={colors.sage} size={15} />} label="Scheduled" />
          ) : null}
          {idea.lifecycle === 'COMPLETED' ? (
            <MetaItem icon={<RotateCcw color={colors.blue} size={15} />} label="Done before" />
          ) : null}
        </View>
      </PaperCard>
    </Pressable>
  );
}
