import { describe, expect, test } from "bun:test";
import type { Destination, Trip } from "@prisma/client";
import {
  selectPrimaryActiveTrip,
  tripStatusAt,
  type TripWithDestination,
} from "./services/planning-context-service";
import { authoritativeDestinationTimeZone } from "./services/destination-time-zone";

function trip(input: {
  id: string;
  timeZone: string;
  startDate: string;
  endDate: string;
  cancelledAt?: Date | null;
}): TripWithDestination {
  const destination: Destination = {
    id: `destination-${input.id}`,
    householdId: "household-1",
    name: input.id,
    timeZone: input.timeZone,
    country: null,
    notes: null,
    colorToken: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const value: Trip = {
    id: input.id,
    householdId: "household-1",
    destinationId: destination.id,
    name: null,
    startDate: input.startDate,
    endDate: input.endDate,
    cancelledAt: input.cancelledAt ?? null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  return { ...value, destination };
}

describe("Destination timezone authority", () => {
  test("corrects known destinations instead of inheriting an incorrect household fallback", () => {
    expect(authoritativeDestinationTimeZone("Lisbon", "Europe/Berlin")).toBe("Europe/Lisbon");
    expect(authoritativeDestinationTimeZone("Berlin", "America/Bahia")).toBe("Europe/Berlin");
    expect(authoritativeDestinationTimeZone("Salvador", "Europe/Berlin")).toBe("America/Bahia");
    expect(authoritativeDestinationTimeZone("Online", "America/Bahia")).toBe("Europe/Berlin");
    expect(authoritativeDestinationTimeZone("Porto", "Europe/Lisbon")).toBe("Europe/Lisbon");
  });
});

describe("Travel lifecycle status", () => {
  test("derives status from each Destination's local date", () => {
    const instant = new Date("2026-09-13T23:30:00.000Z");
    expect(tripStatusAt(trip({
      id: "kiritimati",
      timeZone: "Pacific/Kiritimati",
      startDate: "2026-09-14",
      endDate: "2026-09-14",
    }), instant)).toBe("ACTIVE");
    expect(tripStatusAt(trip({
      id: "honolulu",
      timeZone: "Pacific/Honolulu",
      startDate: "2026-09-14",
      endDate: "2026-09-14",
    }), instant)).toBe("UPCOMING");
  });

  test("uses Europe/Lisbon rather than the caller's calendar date", () => {
    const instant = new Date("2026-09-14T23:30:00.000Z");
    expect(tripStatusAt(trip({
      id: "lisbon",
      timeZone: "Europe/Berlin",
      startDate: "2026-09-15",
      endDate: "2026-09-15",
    }), instant)).toBe("ACTIVE");
  });

  test("cancelled Trips are never active regardless of destination-local dates", () => {
    const now = new Date("2026-09-14T12:00:00.000Z");
    const cancelled = trip({
      id: "cancelled",
      timeZone: "Europe/Lisbon",
      startDate: "2026-09-14",
      endDate: "2026-09-15",
      cancelledAt: new Date("2026-09-14T10:00:00.000Z"),
    });
    expect(tripStatusAt(cancelled, now)).toBe("CANCELLED");
    expect(selectPrimaryActiveTrip([cancelled], now)).toBeNull();
  });

  test("selects the latest-starting active Trip deterministically", () => {
    const now = new Date("2026-09-14T12:00:00.000Z");
    const trips = [
      trip({ id: "earlier", timeZone: "Europe/Berlin", startDate: "2026-09-01", endDate: "2026-09-20" }),
      trip({ id: "tie-b", timeZone: "Europe/Berlin", startDate: "2026-09-10", endDate: "2026-09-18" }),
      trip({ id: "tie-a", timeZone: "Europe/Berlin", startDate: "2026-09-10", endDate: "2026-09-16" }),
    ];

    expect(selectPrimaryActiveTrip(trips, now)?.id).toBe("tie-a");
  });
});
