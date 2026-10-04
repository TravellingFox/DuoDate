import { Redirect } from 'expo-router';
import { useSession } from '@/lib/auth/use-session';

export default function RootIndex() {
  const session = useSession();

  if (session.isLoading) return null;

  return <Redirect href={session.data?.user ? '/(tabs)' : '/login'} />;
}
