import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type TextInput,
  View,
} from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Eye, EyeOff } from "lucide-react-native";
import { ApiError } from "@/lib/api/api";
import {
  authClient,
  type DevAuthProfile,
} from "@/lib/auth/auth-client";
import { useInvalidateSession } from "@/lib/auth/use-session";
import {
  AppText,
  colors,
  FocusableTextInput,
  PaperCard,
  PrimaryButton,
  radii,
  Screen,
  SecondaryButton,
} from "@/components/ui";

export default function LoginScreen() {
  const invalidateSession = useInvalidateSession();
  const passphraseInputRef = useRef<TextInput | null>(null);
  const [handle, setHandle] = useState<string>("");
  const [passphrase, setPassphrase] = useState<string>("");
  const [showPassphrase, setShowPassphrase] = useState<boolean>(false);

  const developmentAccess = useQuery({
    queryKey: ["development-auth-availability"],
    queryFn: authClient.developmentAvailability,
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 3,
  });

  const signIn = useMutation({
    mutationFn: () =>
      authClient.signIn({
        handle: handle.trim(),
        passphrase,
        deviceLabel: Platform.OS === "android" ? "DuoDate Android" : "DuoDate",
      }),
    onSuccess: async () => {
      await invalidateSession();
    },
  });

  const developmentSignIn = useMutation({
    mutationFn: (profile: DevAuthProfile) =>
      authClient.signInDevelopment({
        profile,
        deviceLabel: Platform.OS === "android" ? "DuoDate Android" : "DuoDate",
      }),
    onSuccess: async () => {
      await invalidateSession();
    },
  });

  const canSubmit = handle.trim().length > 0 && passphrase.length > 0;

  return (
    <Screen testID="login-screen" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerClassName="flex-grow justify-center px-6 py-8"
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-9">
            <View className="mb-7 h-16 w-24">
              <View
                className="absolute left-0 top-1 h-14 w-14 border-2"
                style={{ borderColor: colors.rose, borderRadius: 28 }}
              />
              <View
                className="absolute left-9 top-1 h-14 w-14 border-2"
                style={{ borderColor: colors.sage, borderRadius: 28 }}
              />
            </View>
            <AppText variant="display">DuoDate</AppText>
            <AppText variant="body" tone="soft" className="mt-3 max-w-xs">
              Our ideas, our dates, our shared history.
            </AppText>
          </View>

          <PaperCard>
            <AppText variant="heading">Welcome back</AppText>
            <AppText variant="meta" tone="muted" className="mt-1">
              Sign in with your private handle.
            </AppText>

            <View className="mt-6">
              <AppText variant="label" className="mb-2">
                Handle
              </AppText>
              <FocusableTextInput
                testID="login-handle-input"
                accessibilityLabel="Private handle"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                importantForAutofill="yes"
                textContentType="username"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passphraseInputRef.current?.focus()}
                value={handle}
                onChangeText={(value) => {
                  setHandle(value);
                  if (signIn.isError) signIn.reset();
                }}
                placeholder="Your private handle"
                placeholderTextColor={colors.inkMuted}
                containerClassName="min-h-14 border"
                containerStyle={{
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.lineStrong,
                  borderRadius: radii.medium,
                }}
                className="flex-1 px-4 text-base"
                style={{ color: colors.ink }}
              />
            </View>

            <View className="mt-4">
              <AppText variant="label" className="mb-2">
                Passphrase
              </AppText>
              <View
                className="min-h-14 flex-row items-center border px-4"
                style={{
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.lineStrong,
                  borderRadius: radii.medium,
                }}
              >
                <FocusableTextInput
                  ref={passphraseInputRef}
                  testID="login-passphrase-input"
                  accessibilityLabel="Passphrase"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  importantForAutofill="yes"
                  textContentType="password"
                  secureTextEntry={!showPassphrase}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (canSubmit && !signIn.isPending && !developmentSignIn.isPending) {
                      signIn.mutate();
                    }
                  }}
                  value={passphrase}
                  onChangeText={(value) => {
                    setPassphrase(value);
                    if (signIn.isError) signIn.reset();
                  }}
                  placeholder="Your passphrase"
                  placeholderTextColor={colors.inkMuted}
                  containerClassName="min-h-12 flex-1"
                  className="flex-1 text-base"
                  style={{ color: colors.ink }}
                />
                <Pressable
                  testID="toggle-passphrase-visibility"
                  accessibilityRole="button"
                  accessibilityLabel={
                    showPassphrase ? "Hide passphrase" : "Show passphrase"
                  }
                  hitSlop={10}
                  onPress={() => setShowPassphrase((value) => !value)}
                  className="h-11 w-11 items-center justify-center"
                >
                  {showPassphrase ? (
                    <EyeOff color={colors.inkSoft} size={20} />
                  ) : (
                    <Eye color={colors.inkSoft} size={20} />
                  )}
                </Pressable>
              </View>
            </View>

            {signIn.isError ? (
              <View
                testID="login-error"
                className="mt-4 border px-4 py-3"
                style={{
                  backgroundColor: colors.dangerSoft,
                  borderColor: colors.roseSoft,
                  borderRadius: radii.medium,
                }}
              >
                <AppText variant="meta" tone="danger">
                  {signIn.error instanceof Error
                    ? signIn.error.message
                    : "We could not sign you in. Check your details and try again."}
                </AppText>
              </View>
            ) : null}

            <View className="mt-6">
              <PrimaryButton
                testID="login-submit-button"
                label="Enter DuoDate"
                disabled={!canSubmit || developmentSignIn.isPending}
                loading={signIn.isPending}
                onPress={() => signIn.mutate()}
              />
            </View>
          </PaperCard>

          {developmentAccess.isSuccess &&
          developmentAccess.data.profiles.length > 0 ? (
            <PaperCard testID="development-access-section" className="mt-4">
              <AppText variant="label">Development access</AppText>
              <AppText variant="meta" tone="muted" className="mt-1">
                Continue with a configured development profile.
              </AppText>

              <View className="mt-4 gap-3">
                {developmentAccess.data.profiles.map((profile) => (
                  <SecondaryButton
                    key={profile.profile}
                    testID={`development-login-${profile.profile.toLowerCase()}-button`}
                    label={`Continue as ${profile.displayName}`}
                    disabled={signIn.isPending || developmentSignIn.isPending}
                    onPress={() => developmentSignIn.mutate(profile.profile)}
                  />
                ))}
              </View>

              {__DEV__ ? (
                <Pressable
                  testID="input-diagnostic-link"
                  accessibilityRole="button"
                  accessibilityLabel="Open input diagnostic"
                  onPress={() => router.push("/input-diagnostic")}
                  className="mt-3 min-h-11 items-center justify-center active:opacity-70"
                >
                  <AppText variant="meta" tone="muted">
                    Input diagnostic
                  </AppText>
                </Pressable>
              ) : null}

              {developmentSignIn.isError ? (
                <AppText
                  testID="development-login-error"
                  variant="meta"
                  tone="danger"
                  className="mt-3"
                >
                  Development sign-in failed. Please try again.
                </AppText>
              ) : null}
            </PaperCard>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
