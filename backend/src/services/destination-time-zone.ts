const canonicalDestinationTimeZones: Record<string, string> = {
  berlin: "Europe/Berlin",
  global: "Europe/Berlin",
  lisbon: "Europe/Lisbon",
  online: "Europe/Berlin",
  salvador: "America/Bahia",
};

export function authoritativeDestinationTimeZone(name: string, persistedTimeZone: string) {
  return canonicalDestinationTimeZones[name.trim().toLocaleLowerCase()] ?? persistedTimeZone;
}

export function withAuthoritativeDestinationTimeZone<T extends { name: string; timeZone: string }>(
  destination: T,
): T {
  const timeZone = authoritativeDestinationTimeZone(destination.name, destination.timeZone);
  return timeZone === destination.timeZone ? destination : { ...destination, timeZone };
}
