// A null Expo pending result means "not delivered through recovery", not
// cancellation: the live launch promise may still be copying a large file.
export async function recoverPickerReturn<T>({
  read,
  ownsReturn,
  accept,
  complete,
}: {
  read: () => Promise<T | null>;
  ownsReturn: () => boolean;
  accept: (result: T) => void;
  complete: () => Promise<void>;
}): Promise<boolean> {
  const result = await read();
  if (result === null || !ownsReturn()) return false;
  accept(result);
  // Acceptance can synchronously change ownership. Never clear a newer launch.
  if (!ownsReturn()) return false;
  await complete();
  return true;
}
