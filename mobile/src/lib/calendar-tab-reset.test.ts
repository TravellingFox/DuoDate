import {
  requestCalendarScrollToTop,
  subscribeToCalendarScrollToTop,
} from './calendar-tab-reset';

describe('calendar tab reset signal', () => {
  test('notifies mounted calendar lists and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToCalendarScrollToTop(listener);

    requestCalendarScrollToTop();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    requestCalendarScrollToTop();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
