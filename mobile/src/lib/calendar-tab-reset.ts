type CalendarResetListener = () => void;

const listeners = new Set<CalendarResetListener>();

export function requestCalendarScrollToTop() {
  for (const listener of listeners) listener();
}

export function subscribeToCalendarScrollToTop(listener: CalendarResetListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
