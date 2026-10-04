import { forwardRef, useCallback, useRef, type PropsWithChildren, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertCircle, ArrowRight, RefreshCw } from 'lucide-react-native';
import { colors, radii, shadows, spacing } from '@/lib/design/theme';
import { cn } from '@/lib/cn';

export type AppTextVariant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'meta';

const textClasses: Record<AppTextVariant, string> = {
  display: 'text-4xl font-semibold tracking-tight',
  title: 'text-2xl font-semibold tracking-tight',
  heading: 'text-lg font-semibold',
  body: 'text-base leading-6',
  label: 'text-sm font-semibold tracking-wide',
  meta: 'text-sm leading-5',
};

export function AppText({
  variant = 'body',
  tone = 'default',
  className,
  style,
  ...props
}: TextProps & {
  variant?: AppTextVariant;
  tone?: 'default' | 'soft' | 'muted' | 'accent' | 'danger' | 'inverse';
}) {
  const toneColor = {
    default: colors.ink,
    soft: colors.inkSoft,
    muted: colors.inkMuted,
    accent: colors.rose,
    danger: colors.danger,
    inverse: colors.surface,
  }[tone];

  return (
    <Text
      className={cn(textClasses[variant], className)}
      style={[{ color: toneColor }, style]}
      {...props}
    />
  );
}

export function Screen({
  children,
  testID,
  edges = ['top'],
  className,
}: PropsWithChildren<{
  testID: string;
  edges?: ('top' | 'right' | 'bottom' | 'left')[];
  className?: string;
}>) {
  return (
    <SafeAreaView
      testID={testID}
      edges={edges}
      className={cn('flex-1', className)}
      style={{ backgroundColor: colors.paper }}>
      {children}
    </SafeAreaView>
  );
}

export function PaperCard({
  children,
  className,
  style,
  testID,
}: PropsWithChildren<Pick<ViewProps, 'className' | 'style' | 'testID'>>) {
  return (
    <View
      testID={testID}
      className={cn('border px-5 py-5', className)}
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          borderRadius: radii.large,
        },
        shadows.paper,
        style,
      ]}>
      {children}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      disabled={disabled || loading}
      onPress={onPress}
      className="min-h-14 flex-row items-center justify-center px-6 active:opacity-80"
      style={{
        backgroundColor: disabled ? colors.lineStrong : colors.ink,
        borderRadius: radii.pill,
      }}>
      {loading ? <ActivityIndicator color={colors.surface} /> : null}
      {!loading && icon ? <View className="mr-2">{icon}</View> : null}
      {!loading ? (
        <AppText variant="label" tone="inverse" className="text-base">
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  icon,
  testID,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  testID: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      className="min-h-12 flex-row items-center justify-center border px-5 active:opacity-70"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.lineStrong,
        borderRadius: radii.pill,
      }}>
      {icon ? <View className="mr-2">{icon}</View> : null}
      <AppText variant="label">{label}</AppText>
    </Pressable>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <View className="mb-4 flex-row items-end justify-between">
      <View className="flex-1 pr-4">
        {eyebrow ? (
          <AppText variant="label" tone="muted" className="mb-1 uppercase">
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="title">{title}</AppText>
      </View>
      {action}
    </View>
  );
}

export function LoadingState({ label = 'Gathering your shared plans…' }: { label?: string }) {
  return (
    <View testID="loading-indicator" className="flex-1 items-center justify-center px-8">
      <ActivityIndicator color={colors.rose} size="large" />
      <AppText variant="meta" tone="soft" className="mt-4 text-center">
        {label}
      </AppText>
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View testID="error-view" className="flex-1 items-center justify-center px-8">
      <View
        className="mb-4 h-12 w-12 items-center justify-center"
        style={{ backgroundColor: colors.dangerSoft, borderRadius: radii.pill }}>
        <AlertCircle color={colors.danger} size={23} />
      </View>
      <AppText variant="heading" className="text-center">
        {title}
      </AppText>
      <AppText variant="body" tone="soft" className="mt-2 text-center">
        {message}
      </AppText>
      {onRetry ? (
        <Pressable
          testID="retry-button"
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={onRetry}
          className="mt-5 min-h-12 flex-row items-center px-5 active:opacity-70">
          <RefreshCw color={colors.ink} size={17} />
          <AppText variant="label" className="ml-2">
            Try again
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  testID = 'empty-state',
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  return (
    <PaperCard testID={testID} className="items-start py-7">
      <AppText variant="heading">{title}</AppText>
      <AppText variant="body" tone="soft" className="mt-2">
        {message}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          testID="empty-state-action"
          onPress={onAction}
          className="mt-5 min-h-11 flex-row items-center active:opacity-70">
          <AppText variant="label" tone="accent">
            {actionLabel}
          </AppText>
          <ArrowRight color={colors.rose} size={17} className="ml-2" />
        </Pressable>
      ) : null}
    </PaperCard>
  );
}

export function PageScroll({
  children,
  refreshing,
  onRefresh,
  contentContainerClassName,
}: PropsWithChildren<{
  refreshing?: boolean;
  onRefresh?: () => void;
  contentContainerClassName?: string;
}>) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      contentContainerClassName={cn('px-5 pb-32', contentContainerClassName)}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing ?? false}
            onRefresh={onRefresh}
            tintColor={colors.rose}
            colors={[colors.rose]}
          />
        ) : undefined
      }>
      {children}
    </ScrollView>
  );
}

export function Divider() {
  return <View className="my-4 h-px" style={{ backgroundColor: colors.line }} />;
}

export function InitialBadge({ name, size = 34 }: { name: string; size?: number }) {
  const initial = name.trim().charAt(0).toUpperCase() || '•';
  return (
    <View
      accessibilityLabel={`Created by ${name}`}
      className="items-center justify-center border"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.roseSoft,
        borderColor: colors.surface,
      }}>
      <AppText variant="label" style={{ color: colors.danger }}>
        {initial}
      </AppText>
    </View>
  );
}

/**
 * Workaround for facebook/react-native#46989 — Samsung Compose AndroidView
 * drops touch-to-focus on TextInput. The TextInput itself claims the touch
 * responder, so a parent Pressable never sees taps on the field: onPressIn must
 * live on the TextInput to call .focus() explicitly. The wrapper Pressable only
 * covers taps on container padding.
 */
export const FocusableTextInput = forwardRef<
  TextInput,
  TextInputProps & {
    containerStyle?: StyleProp<ViewStyle>;
    containerClassName?: string;
  }
>(function FocusableTextInput({ containerStyle, containerClassName, ...props }, forwardedRef) {
  const innerRef = useRef<TextInput | null>(null);

  const handleRef = useCallback(
    (node: TextInput | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<TextInput | null>).current = node;
    },
    [forwardedRef],
  );

  return (
    <Pressable style={containerStyle} className={containerClassName} onPressIn={() => innerRef.current?.focus()}>
      <TextInput
        ref={handleRef}
        {...props}
        onPressIn={(event) => {
          innerRef.current?.focus();
          props.onPressIn?.(event);
        }}
      />
    </Pressable>
  );
});

export { colors, radii, shadows, spacing };
