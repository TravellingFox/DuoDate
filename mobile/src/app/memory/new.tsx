import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '@/components/ui';
import { duodateApi, queryKeys } from '@/lib/api/duodate';
import { initialMemoryDate, memoryDateTimeZone } from '@/lib/memory-date';
import { usePlanningContext } from '@/lib/planning-context';

// Direct creation opens the same capture experience as a planned Memory.
export default function NewMemoryScreen() {
  const queryClient = useQueryClient();
  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: duodateApi.bootstrap });
  const planningContext = usePlanningContext(bootstrap.data);
  const started = useRef<boolean>(false);
  const active = useRef<boolean>(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const create = useMutation({
    mutationFn: () => duodateApi.createMemory({
      title: 'Our spontaneous memory',
      startDate: initialMemoryDate(memoryDateTimeZone(planningContext.timeZone)),
    }),
    onSuccess: (memory) => {
      queryClient.setQueryData(queryKeys.memory(memory.id), memory);
      void queryClient.invalidateQueries({ queryKey: queryKeys.memories });
      if (active.current) router.replace({ pathname: '/memory/[id]', params: { id: memory.id, editDetails: '1', emptyTitle: '1' } });
    },
  });

  useEffect(() => {
    if (!bootstrap.data || started.current) return;
    started.current = true;
    create.mutate();
  }, [bootstrap.data, create.mutate]);

  return (
    <SafeAreaView testID="new-memory-screen" className="flex-1 items-center justify-center px-6" style={{ backgroundColor: '#1C1916' }}>
      <StatusBar style="light" backgroundColor="#1C1916" />
      <AppText variant="title" style={{ color: '#F7EDDA' }}>Let&apos;s save this memory</AppText>
      {create.isError || bootstrap.isError ? (
        <>
          <AppText testID="new-memory-error" variant="body" className="mt-4 text-center" style={{ color: '#E49388' }}>This Memory could not be opened. Please try again.</AppText>
          <Pressable testID="retry-new-memory" accessibilityRole="button" onPress={() => bootstrap.isError ? void bootstrap.refetch() : create.mutate()} className="mt-5 min-h-12 justify-center rounded-full px-5" style={{ backgroundColor: '#583B35' }}>
            <AppText variant="label" style={{ color: '#F7EDDA' }}>Try again</AppText>
          </Pressable>
        </>
      ) : <ActivityIndicator testID="new-memory-loading" className="mt-5" color="#DE8B7E" />}
      <Pressable testID="new-memory-close" accessibilityRole="button" accessibilityLabel="Go back" onPress={() => { active.current = false; router.back(); }} className="mt-5 min-h-11 justify-center px-5">
        <AppText variant="label" style={{ color: '#AD9F8D' }}>Go back</AppText>
      </Pressable>
    </SafeAreaView>
  );
}
