import { useMemo } from 'react';
import type { BootstrapData, PlanningContextRef, Space } from '@/lib/api/duodate';
import { usePlanningContextStore } from '@/lib/planning-context-store';

export type PlanningContextKey = 'ALL' | `SPACE:${string}` | `TRIP:${string}`;
export type PlanningContextKind = 'ALL' | 'SPACE' | 'TRIP';
export type ActiveTrip = Extract<BootstrapData['defaultPlanningContext'], { kind: 'TRIP' }>['trip'];

export interface PlanningContextOption {
  key: PlanningContextKey;
  kind: PlanningContextKind;
  label: string;
  detail: string;
}

export interface AddIdeaContextParams {
  [key: string]: string | undefined;
  spaceId?: string;
  destinationId?: string;
  tripId?: string;
}

export interface DerivedPlanningContext {
  options: PlanningContextOption[];
  backendDefaultKey: PlanningContextKey | null;
  effectiveKey: PlanningContextKey | null;
  selectedOption: PlanningContextOption | null;
  selectedSpace: Space | null;
  selectedTrip: ActiveTrip | null;
  apiContext: PlanningContextRef | undefined;
  addIdeaParams: AddIdeaContextParams;
  timeZone: string | null;
}

export function isGenericTravelSpace(space: Pick<Space, 'name'>) {
  return space.name.trim().toLocaleLowerCase() === 'travel';
}

export function activePlanningSpaces(spaces: Space[]) {
  return spaces.filter((space) => space.retiredAt === null && !isGenericTravelSpace(space));
}

export function ideaContextAssignments(destinationId: string | undefined, selectedSpaceIds: string[]) {
  return {
    destinationIds: destinationId ? [destinationId] : [],
    spaceIds: destinationId ? [] : selectedSpaceIds,
  };
}

export function postSaveIdeaTarget(ideaId: string, tripId: string | undefined) {
  return tripId
    ? { pathname: '/trip/[id]' as const, params: { id: tripId } }
    : { pathname: '/idea/[id]' as const, params: { id: ideaId } };
}

export function planningContextKeyForBackendDefault(
  bootstrap: BootstrapData | undefined,
): PlanningContextKey | null {
  if (!bootstrap) return null;
  const context = bootstrap.defaultPlanningContext;
  if (context.kind === 'ACTIVE_POOL') return 'ALL';
  return `${context.kind}:${context.id}`;
}

export function planningContextOptions(
  bootstrap: BootstrapData | undefined,
): PlanningContextOption[] {
  if (!bootstrap) return [];

  const activeTrip = bootstrap.defaultPlanningContext.kind === 'TRIP'
    ? bootstrap.defaultPlanningContext.trip
    : null;

  return [
    ...(activeTrip
      ? [{
          key: `TRIP:${activeTrip.id}` as const,
          kind: 'TRIP' as const,
          label: activeTrip.name ?? activeTrip.destination.name,
          detail: 'Active trip',
        }]
      : []),
    {
      key: 'ALL' as const,
      kind: 'ALL' as const,
      label: 'All spaces',
      detail: 'Your full active idea pool',
    },
    ...activePlanningSpaces(bootstrap.spaces)
      .map((space) => ({
        key: `SPACE:${space.id}` as const,
        kind: 'SPACE' as const,
        label: space.name,
        detail: 'Space',
      })),
  ];
}

export function effectivePlanningContextKey(
  options: PlanningContextOption[],
  backendDefaultKey: PlanningContextKey | null,
  explicitOverride: string | null,
): PlanningContextKey | null {
  if (explicitOverride && options.some((option) => option.key === explicitOverride)) {
    return explicitOverride as PlanningContextKey;
  }
  if (backendDefaultKey && options.some((option) => option.key === backendDefaultKey)) {
    return backendDefaultKey;
  }
  return options.some((option) => option.key === 'ALL') ? 'ALL' : options[0]?.key ?? null;
}

export function planningContextRef(
  bootstrap: BootstrapData | undefined,
  key: PlanningContextKey | null,
): PlanningContextRef | undefined {
  if (!bootstrap || !key || key === 'ALL') return undefined;

  if (key.startsWith('SPACE:')) {
    const id = key.slice('SPACE:'.length);
    return activePlanningSpaces(bootstrap.spaces).some((space) => space.id === id)
      ? { kind: 'SPACE', id }
      : undefined;
  }

  if (
    bootstrap.defaultPlanningContext.kind === 'TRIP' &&
    key === `TRIP:${bootstrap.defaultPlanningContext.id}`
  ) {
    return { kind: 'TRIP', id: bootstrap.defaultPlanningContext.id };
  }

  return undefined;
}

export function addIdeaParamsForPlanningContext(
  selectedSpace: Space | null,
  selectedTrip: ActiveTrip | null,
): AddIdeaContextParams {
  if (selectedSpace) return { spaceId: selectedSpace.id };
  if (selectedTrip) {
    return {
      destinationId: selectedTrip.destination.id,
      tripId: selectedTrip.id,
    };
  }
  return {};
}

export function derivePlanningContext(
  bootstrap: BootstrapData | undefined,
  explicitOverride: string | null,
): DerivedPlanningContext {
  const options = planningContextOptions(bootstrap);
  const backendDefaultKey = planningContextKeyForBackendDefault(bootstrap);
  const effectiveKey = effectivePlanningContextKey(options, backendDefaultKey, explicitOverride);
  const selectedOption = options.find((option) => option.key === effectiveKey) ?? null;

  const selectedSpace = effectiveKey?.startsWith('SPACE:')
    ? activePlanningSpaces(bootstrap?.spaces ?? []).find(
        (space) => space.id === effectiveKey.slice('SPACE:'.length),
      ) ?? null
    : null;
  const selectedTrip =
    effectiveKey?.startsWith('TRIP:') &&
    bootstrap?.defaultPlanningContext.kind === 'TRIP' &&
    effectiveKey === `TRIP:${bootstrap.defaultPlanningContext.id}`
      ? bootstrap.defaultPlanningContext.trip
      : null;
  const apiContext = planningContextRef(bootstrap, effectiveKey);
  const timeZone = selectedSpace
    ? selectedSpace.timeZone ?? bootstrap?.household.defaultTimeZone ?? null
    : selectedTrip
      ? selectedTrip.destination.timeZone
      : bootstrap?.household.defaultTimeZone ?? null;

  return {
    options,
    backendDefaultKey,
    effectiveKey,
    selectedOption,
    selectedSpace,
    selectedTrip,
    apiContext,
    addIdeaParams: addIdeaParamsForPlanningContext(selectedSpace, selectedTrip),
    timeZone,
  };
}

export function usePlanningContext(bootstrap: BootstrapData | undefined) {
  const explicitOverride = usePlanningContextStore((state) => state.selectedContextKey);
  const setExplicitOverride = usePlanningContextStore((state) => state.setSelectedContextKey);
  const context = useMemo(
    () => derivePlanningContext(bootstrap, explicitOverride),
    [bootstrap, explicitOverride],
  );

  return {
    ...context,
    explicitOverride,
    selectContext: setExplicitOverride,
  };
}
