import { api } from './api';

export type CostBasis = 'PER_PERSON' | 'TOTAL_FOR_TWO';
export type CostBand = 'FREE' | 'UNDER_20' | 'FROM_20_TO_50' | 'FROM_50_TO_100' | 'FROM_100';
export type DurationBand =
  | 'UNDER_ONE_HOUR'
  | 'ONE_TO_TWO_HOURS'
  | 'TWO_TO_FOUR_HOURS'
  | 'HALF_DAY'
  | 'FULL_DAY'
  | 'OVERNIGHT_OR_MULTI_DAY';
export type WeatherState = 'NEUTRAL' | 'GOOD' | 'IMPOSSIBLE';
export type WeatherCondition = 'SUNNY' | 'RAINY' | 'INDOOR' | 'OUTDOOR';
export type AvailabilityMode = 'ANYTIME' | 'DATE_RANGE' | 'SPECIFIC_OCCURRENCES';
export type RecurrenceWeekday =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';
export type IdeaRecurrence =
  | { kind: 'NONE' }
  | { kind: 'WEEKLY'; startDate: string; endDate?: string | null; weekdays: RecurrenceWeekday[] }
  | {
      kind: 'MONTHLY_ORDINAL_WEEKDAY';
      startDate: string;
      endDate?: string | null;
      ordinal: number;
      weekday: RecurrenceWeekday;
    };

export interface HouseholdMemberSummary {
  id: string;
  displayName: string;
}

export interface Space {
  id: string;
  householdId: string;
  name: string;
  colorToken: string | null;
  iconKey: string | null;
  sortOrder: number;
  timeZone: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Destination {
  id: string;
  householdId: string;
  name: string;
  timeZone: string;
  country: string | null;
  notes: string | null;
  colorToken: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { trips: number; ideas: number };
}

export type TripStatus = 'ACTIVE' | 'UPCOMING' | 'PAST' | 'CANCELLED';

export interface Trip {
  id: string;
  householdId: string;
  destinationId: string;
  name: string | null;
  startDate: string;
  endDate: string;
  cancelledAt: string | null;
  hero: TripHeroImage | null;
  createdAt: string;
  updatedAt: string;
  destination: Destination;
  localToday: string;
  status: TripStatus;
  isActive: boolean;
  isCancelled: boolean;
  isPrimaryActive: boolean;
}

export interface TripHeroImage {
  id: string;
  tripId: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  uploader: HouseholdMemberSummary;
  contentPath: string;
}

export interface Category {
  id: string;
  householdId: string;
  name: string;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaLink {
  id: string;
  ideaId: string;
  url: string;
  label: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WeatherSuitability {
  sunny: WeatherState;
  rainy: WeatherState;
  indoor: WeatherState;
  outdoor: WeatherState;
}

export interface Availability {
  mode: AvailabilityMode;
  rangeStartDate: string | null;
  rangeEndDate: string | null;
}

export interface SpecificOccurrence {
  id: string;
  ideaId: string;
  localDate: string;
  startMinute: number | null;
  endMinute: number | null;
  startLocalTime: string | null;
  endLocalTime: string | null;
  timeZone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaScheduleSummary {
  id: string;
  occurrenceId: string | null;
  scheduledDate: string;
  startLocalTime: string | null;
  endLocalTime: string | null;
  status: ScheduleStatus;
  timeZone: string;
}

export interface IdeaImage {
  id: string;
  ideaId: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  uploader: HouseholdMemberSummary;
  contentPath: string;
}

export interface Idea {
  id: string;
  householdId: string;
  createdById: string;
  categoryId: string | null;
  title: string;
  specificLocation: string | null;
  notes: string | null;
  lifecycle: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  costBand: CostBand | null;
  exactCostCents: number | null;
  costBasisAtEntry: CostBasis | null;
  costMinTotalCents: number | null;
  costMaxTotalCents: number | null;
  exactCostTotalCents: number | null;
  durationBand: DurationBand | null;
  durationRank: number | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  category: Category | null;
  createdBy: HouseholdMemberSummary;
  spaces: Space[];
  destinations: { id: string; name: string; timeZone: string }[];
  links: IdeaLink[];
  weatherSuitability: WeatherSuitability | null;
  availability: Availability | null;
  recurrence: IdeaRecurrence;
  image: IdeaImage | null;
  occurrences: SpecificOccurrence[];
  schedules: IdeaScheduleSummary[];
}

export interface TripPlanningIdea extends Idea {
  planning: {
    scheduled: boolean;
    weatherPreferenceScore: number;
  };
}

export interface TripPlanning extends Omit<Trip, 'destination' | 'isPrimaryActive'> {
  destination: Destination & { ideas: TripPlanningIdea[] };
}

export type ScheduleStatus = 'SCHEDULED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';

export interface Schedule {
  id: string;
  householdId: string;
  ideaId: string;
  occurrenceId: string | null;
  createdById: string;
  scheduledDate: string;
  startMinute: number | null;
  endMinute: number | null;
  startLocalTime: string | null;
  endLocalTime: string | null;
  timeZone: string;
  startsAt: string | null;
  endsAt: string | null;
  cleanupDueAt: string | null;
  status: ScheduleStatus;
  activeSlot: string | null;
  createdAt: string;
  updatedAt: string;
  idea: { id: string; title: string };
  occurrence: SpecificOccurrence | null;
}

export type MemoryMediaKind = 'PHOTO' | 'VIDEO' | 'VOICE_NOTE';

export interface MemoryContribution {
  id: string;
  memoryId: string;
  authorId: string;
  kind: 'TEXT' | MemoryMediaKind;
  text: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  author: HouseholdMemberSummary;
}

export interface MemoryMediaSummary {
  id: string;
  memoryId: string;
  kind: MemoryMediaKind;
  contentType: string;
  byteSize: number;
  caption: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  uploader: HouseholdMemberSummary;
}

export interface Memory {
  id: string;
  householdId: string;
  sourceIdeaId: string | null;
  sourceScheduleId: string | null;
  createdById: string;
  updatedById: string;
  title: string;
  locationSnapshot: string | null;
  categorySnapshot: string | null;
  startDate: string;
  endDate: string | null;
  generalText: string | null;
  status: 'CAPTURE_REQUIRED' | 'CONTENT_VALID';
  captureDueAt: string | null;
  resolvedAt: string | null;
  coverMediaId: string | null;
  createdAt: string;
  updatedAt: string;
  contributions: MemoryContribution[];
  mediaItems: MemoryMediaSummary[];
  createdBy: HouseholdMemberSummary;
  updatedBy: HouseholdMemberSummary;
  contributionCount: number;
  mediaCount: number;
  captureOverdue: boolean;
}

export interface MemoryCreateInput {
  title: string;
  startDate?: string;
  endDate?: string | null;
  specificLocation?: string | null;
  initialText?: string;
}

export interface CreateMemoryContributionResult {
  contribution: MemoryContribution;
  memory: Memory;
}

export interface BootstrapData {
  user: HouseholdMemberSummary;
  household: { id: string; defaultTimeZone: string };
  settings: {
    id: string;
    householdId: string;
    costBasis: CostBasis;
    createdAt: string;
    updatedAt: string;
  } | null;
  members: HouseholdMemberSummary[];
  spaces: Space[];
  categories: Category[];
  defaultPlanningContext:
    | { kind: 'ACTIVE_POOL'; id: null; timeZone: string; isDefault: true }
    | { kind: 'SPACE'; id: string; timeZone: string; isDefault: boolean; space: Space }
    | {
        kind: 'TRIP';
        id: string;
        timeZone: string;
        isDefault: boolean;
        trip: {
          id: string;
          name: string | null;
          destination: { id: string; name: string; timeZone: string };
        };
      };
}

export interface IdeaCreateInput {
  clientRequestId: string;
  title: string;
  categoryId?: string | null;
  specificLocation?: string | null;
  notes?: string | null;
  costBand?: CostBand | null;
  exactCostCents?: number | null;
  durationBand?: DurationBand | null;
  spaceIds: string[];
  destinationIds: string[];
  links: { url: string; label?: string | null; sortOrder?: number }[];
  weather: WeatherSuitability;
  availability:
    | { mode: 'ANYTIME' }
    | { mode: 'DATE_RANGE'; rangeStartDate: string; rangeEndDate: string }
    | { mode: 'SPECIFIC_OCCURRENCES' };
  recurrence: IdeaRecurrence;
  occurrences: OccurrenceCreateInput[];
}

export interface OccurrenceCreateInput {
  localDate: string;
  startLocalTime?: string | null;
  endLocalTime?: string | null;
  timeZone?: string | null;
}

export interface DestinationCreateInput {
  name: string;
  timeZone: string;
  country?: string | null;
  notes?: string | null;
  colorToken?: string | null;
}

export interface TripCreateInput {
  destinationId: string;
  name?: string | null;
  startDate: string;
  endDate: string;
}

export interface TripUpdateInput {
  name?: string | null;
  startDate?: string;
  endDate?: string;
}

export interface ScheduleCreateInput {
  ideaId: string;
  occurrenceId?: string | null;
  scheduledDate: string;
  startLocalTime?: string | null;
  endLocalTime?: string | null;
  timeZone: string;
}

export interface ScheduleUpdateInput {
  occurrenceId?: string | null;
  scheduledDate?: string;
  startLocalTime?: string | null;
  endLocalTime?: string | null;
  timeZone?: string;
}

export type MaximumBudget =
  | { kind: 'BAND'; costBand: Exclude<CostBand, 'FROM_100'> }
  | { kind: 'EXACT'; exactCostCents: number };

export interface LetsDateRequest {
  context?: PlanningContextRef | null;
  targetDate?: string;
  maximumBudget?: MaximumBudget | null;
  maximumDuration?: DurationBand | null;
  weather?: WeatherCondition[];
}

export type ResolvedPlanningContext =
  | { kind: 'ACTIVE_POOL'; id: null; timeZone: string; isDefault: boolean }
  | { kind: 'SPACE'; id: string; timeZone: string; isDefault: boolean; space: Space }
  | {
      kind: 'TRIP';
      id: string;
      timeZone: string;
      isDefault: boolean;
      trip: {
        id: string;
        name: string | null;
        startDate: string;
        endDate: string;
        destination: { id: string; name: string; timeZone: string };
      };
    };

export interface LetsDateResponse {
  status: 'READY' | 'INSUFFICIENT_MATCHES';
  requestedCount: 3;
  matchCount: number;
  missingPositions: number[];
  targetDate: string;
  context: ResolvedPlanningContext;
  suggestions: {
    position: number;
    scheduled: boolean;
    idea: Idea;
  }[];
}

export interface PlanningContextRef {
  kind: 'SPACE' | 'TRIP';
  id: string;
}

export const queryKeys = {
  bootstrap: ['bootstrap'] as const,
  schedules: ['schedules'] as const,
  memories: ['memories'] as const,
  memory: (memoryId: string) => ['memory', memoryId] as const,
  ideas: (contextKey = 'all') => ['ideas', contextKey] as const,
  idea: (ideaId: string) => ['idea', ideaId] as const,
  destinations: ['destinations'] as const,
  trips: ['trips'] as const,
  tripRoot: ['trip'] as const,
  trip: (tripId: string) => ['trip', tripId] as const,
  letsDateRoot: ['lets-date'] as const,
  letsDate: (requestKey: string) => ['lets-date', requestKey] as const,
};

export const duodateApi = {
  bootstrap: () => api.get<BootstrapData>('/api/bootstrap'),
  schedules: () => api.get<Schedule[]>('/api/schedules'),
  memories: () => api.get<Memory[]>('/api/memories'),
  createMemory: (input: MemoryCreateInput) => api.post<Memory>('/api/memories', input),
  memory: (memoryId: string) => api.get<Memory>(`/api/memories/${encodeURIComponent(memoryId)}`),
  addMemoryText: (memoryId: string, text: string, sortOrder?: number, clientRequestId?: string, nativeTransport = false) =>
    api.post<CreateMemoryContributionResult>(
      `/api/memories/${encodeURIComponent(memoryId)}/contributions`,
      { kind: 'TEXT', text, ...(sortOrder === undefined ? {} : { sortOrder }), ...(clientRequestId ? { clientRequestId } : {}) },
      { timeoutMs: 15000, nativeTransport },
    ),
  ideas: (context?: PlanningContextRef) =>
    api.get<Idea[]>(
      context
        ? `/api/ideas?scope=SAVED&contextKind=${context.kind}&contextId=${encodeURIComponent(context.id)}`
        : '/api/ideas?scope=SAVED',
    ),
  idea: (ideaId: string) => api.get<Idea>(`/api/ideas/${ideaId}`),
  createIdea: (input: IdeaCreateInput) => api.post<Idea>('/api/ideas', input),
  createOccurrence: (ideaId: string, input: OccurrenceCreateInput) =>
    api.post<SpecificOccurrence>(`/api/ideas/${ideaId}/occurrences`, input),
  destinations: () => api.get<Destination[]>('/api/destinations'),
  createDestination: (input: DestinationCreateInput) =>
    api.post<Destination>('/api/destinations', input),
  trips: () => api.get<Trip[]>('/api/trips'),
  trip: (tripId: string) => api.get<TripPlanning>(`/api/trips/${encodeURIComponent(tripId)}`),
  createTrip: (input: TripCreateInput) => api.post<Trip>('/api/trips', input),
  updateTrip: (tripId: string, input: TripUpdateInput) =>
    api.patch<Trip>(`/api/trips/${encodeURIComponent(tripId)}`, input),
  deleteTrip: (tripId: string) => api.delete<void>(`/api/trips/${encodeURIComponent(tripId)}`),
  deleteTripHero: (tripId: string) =>
    api.delete<{ imageId: string; deleted: boolean; deletionPending: boolean }>(
      `/api/trips/${encodeURIComponent(tripId)}/hero`,
    ),
  createSchedule: (input: ScheduleCreateInput) => api.post<Schedule>('/api/schedules', input),
  rescheduleSchedule: (scheduleId: string, input: ScheduleUpdateInput) =>
    api.post<Schedule>(`/api/schedules/${encodeURIComponent(scheduleId)}/reschedule`, input),
  dateSchedule: (scheduleId: string) =>
    api.post<Memory>(`/api/schedules/${encodeURIComponent(scheduleId)}/dated`, {}),
  letsDate: (input: LetsDateRequest) => api.post<LetsDateResponse>('/api/lets-date', input),
};
