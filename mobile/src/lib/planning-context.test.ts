import type { BootstrapData, Space } from './api/duodate';
import {
  addIdeaParamsForPlanningContext,
  derivePlanningContext,
  effectivePlanningContextKey,
  ideaContextAssignments,
  planningContextOptions,
  postSaveIdeaTarget,
} from './planning-context';

function space(id: string, name: string, retiredAt: string | null = null): Space {
  return {
    id,
    householdId: 'household-1',
    name,
    colorToken: null,
    iconKey: null,
    sortOrder: 0,
    timeZone: 'Europe/Amsterdam',
    retiredAt,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function bootstrap(
  defaultPlanningContext: BootstrapData['defaultPlanningContext'],
): BootstrapData {
  return {
    user: { id: 'user-1', displayName: 'Alex' },
    household: { id: 'household-1', defaultTimeZone: 'Europe/Amsterdam' },
    settings: null,
    members: [{ id: 'user-1', displayName: 'Alex' }],
    spaces: [
      space('home', 'Close to home'),
      space('travel', 'Travel'),
      space('weekend', 'Weekend'),
      space('old', 'Old', '2026-01-01'),
    ],
    categories: [],
    defaultPlanningContext,
  };
}

const activePoolBootstrap = bootstrap({
  kind: 'ACTIVE_POOL',
  id: null,
  timeZone: 'Europe/Amsterdam',
  isDefault: true,
});

const tripBootstrap = bootstrap({
  kind: 'TRIP',
  id: 'trip-active',
  timeZone: 'Europe/Lisbon',
  isDefault: true,
  trip: {
    id: 'trip-active',
    name: 'Lisbon weekend',
    destination: { id: 'destination-lisbon', name: 'Lisbon', timeZone: 'Europe/Lisbon' },
  },
});

describe('planning context derivation', () => {
  test('lists active bootstrap spaces, All spaces, and only the authoritative active trip', () => {
    expect(planningContextOptions(tripBootstrap).map(({ key }) => key)).toEqual([
      'TRIP:trip-active',
      'ALL',
      'SPACE:home',
      'SPACE:weekend',
    ]);
  });

  test('filters a legacy generic Travel Space from options and references', () => {
    expect(planningContextOptions(activePoolBootstrap).map(({ key }) => key)).not.toContain('SPACE:travel');
    expect(derivePlanningContext(activePoolBootstrap, 'SPACE:travel').effectiveKey).toBe('ALL');
  });

  test('uses a valid explicit override without replacing it with the backend default', () => {
    const derived = derivePlanningContext(tripBootstrap, 'SPACE:weekend');

    expect(derived.backendDefaultKey).toBe('TRIP:trip-active');
    expect(derived.effectiveKey).toBe('SPACE:weekend');
    expect(derived.selectedSpace?.id).toBe('weekend');
    expect(derived.selectedTrip).toBeNull();
    expect(derived.apiContext).toEqual({ kind: 'SPACE', id: 'weekend' });
  });

  test('falls back to the backend default for stale or future-trip overrides', () => {
    const options = planningContextOptions(tripBootstrap);

    expect(effectivePlanningContextKey(options, 'TRIP:trip-active', 'TRIP:trip-future')).toBe('TRIP:trip-active');
    expect(derivePlanningContext(tripBootstrap, 'SPACE:retired').effectiveKey).toBe('TRIP:trip-active');
  });

  test('keeps active Trip and All semantics accurate for API calls', () => {
    const trip = derivePlanningContext(tripBootstrap, null);
    const all = derivePlanningContext(activePoolBootstrap, 'ALL');

    expect(trip.selectedTrip?.id).toBe('trip-active');
    expect(trip.apiContext).toEqual({ kind: 'TRIP', id: 'trip-active' });
    expect(all.apiContext).toBeUndefined();
    expect(all.selectedSpace).toBeNull();
    expect(all.selectedTrip).toBeNull();
  });

  test('maps shared context into Add Idea route parameters', () => {
    const selectedSpace = activePoolBootstrap.spaces[0];
    const selectedTrip = tripBootstrap.defaultPlanningContext.kind === 'TRIP'
      ? tripBootstrap.defaultPlanningContext.trip
      : null;

    expect(addIdeaParamsForPlanningContext(selectedSpace, null)).toEqual({ spaceId: 'home' });
    expect(addIdeaParamsForPlanningContext(null, selectedTrip)).toEqual({
      destinationId: 'destination-lisbon',
      tripId: 'trip-active',
    });
    expect(addIdeaParamsForPlanningContext(null, null)).toEqual({});
  });

  test('keeps destination-origin ideas out of every generic Space', () => {
    expect(ideaContextAssignments('destination-lisbon', ['home', 'travel'])).toEqual({
      destinationIds: ['destination-lisbon'],
      spaceIds: [],
    });
    expect(ideaContextAssignments(undefined, ['home'])).toEqual({
      destinationIds: [],
      spaceIds: ['home'],
    });
  });

  test('returns trip-origin saves directly to the trip', () => {
    expect(postSaveIdeaTarget('idea-1', 'trip-active')).toEqual({
      pathname: '/trip/[id]',
      params: { id: 'trip-active' },
    });
    expect(postSaveIdeaTarget('idea-1', undefined)).toEqual({
      pathname: '/idea/[id]',
      params: { id: 'idea-1' },
    });
  });
});
