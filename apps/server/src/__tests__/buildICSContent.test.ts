import { describe, it, expect } from "vitest";
import { buildICSContent } from "../routes/calendar.js";

describe("buildICSContent", () => {
  const baseParams = {
    uid: "test-uid-123",
    title: "Test Event",
    start: "2026-08-15T10:00:00.000Z",
    end: "2026-08-15T11:00:00.000Z",
  };

  it("should generate basic ICS content with required fields", () => {
    const ics = buildICSContent(baseParams);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//CalDAV Desktop//EN");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain(`UID:${baseParams.uid}`);
    expect(ics).toContain("SUMMARY:Test Event");
    expect(ics).toContain("DTSTART:20260815T100000");
    expect(ics).toContain("DTEND:20260815T110000");
    expect(ics).toContain("DTSTAMP:");
  });

  it("should generate all-day event correctly", () => {
    const ics = buildICSContent({
      ...baseParams,
      allDay: true,
    });

    expect(ics).toContain("DTSTART;VALUE=DATE:20260815");
    expect(ics).toContain("DTEND;VALUE=DATE:20260815");
  });

  it("should include description when provided", () => {
    const ics = buildICSContent({
      ...baseParams,
      description: "Test description",
    });

    expect(ics).toContain("DESCRIPTION:Test description");
  });

  it("should include CATEGORIES when category is provided", () => {
    const ics = buildICSContent({
      ...baseParams,
      category: { name: "Meeting" },
    });

    expect(ics).toContain("CATEGORIES:Meeting");
  });

  it("should include tags in DESCRIPTION when tags are provided without description", () => {
    const ics = buildICSContent({
      ...baseParams,
      tags: [{ name: "work" }, { name: "urgent" }],
    });

    expect(ics).toContain("DESCRIPTION:Tags: work, urgent");
  });

  it("should append tags to DESCRIPTION when both tags and description are provided", () => {
    const ics = buildICSContent({
      ...baseParams,
      description: "Original description",
      tags: [{ name: "work" }],
    });

    expect(ics).toContain("DESCRIPTION:Original description\\n\\nTags: work");
  });

  it("should include RRULE for daily recurrence", () => {
    const ics = buildICSContent({
      ...baseParams,
      recurrence: {
        frequency: "daily",
        interval: 1,
      },
    });

    expect(ics).toContain("RRULE:FREQ=DAILY");
  });

  it("should include RRULE for weekly recurrence with interval", () => {
    const ics = buildICSContent({
      ...baseParams,
      recurrence: {
        frequency: "weekly",
        interval: 2,
      },
    });

    expect(ics).toContain("RRULE:FREQ=WEEKLY;INTERVAL=2");
  });

  it("should include RRULE with UNTIL when endDate is provided", () => {
    const ics = buildICSContent({
      ...baseParams,
      recurrence: {
        frequency: "daily",
        endDate: "2026-09-01T00:00:00.000Z",
      },
    });

    expect(ics).toContain("RRULE:FREQ=DAILY;UNTIL=20260901");
  });

  it("should include RRULE with COUNT when count is provided", () => {
    const ics = buildICSContent({
      ...baseParams,
      recurrence: {
        frequency: "weekly",
        count: 5,
      },
    });

    expect(ics).toContain("RRULE:FREQ=WEEKLY;COUNT=5");
  });

  it("should handle monthly recurrence", () => {
    const ics = buildICSContent({
      ...baseParams,
      recurrence: { frequency: "monthly" },
    });

    expect(ics).toContain("RRULE:FREQ=MONTHLY");
  });

  it("should handle yearly recurrence", () => {
    const ics = buildICSContent({
      ...baseParams,
      recurrence: { frequency: "yearly" },
    });

    expect(ics).toContain("RRULE:FREQ=YEARLY");
  });

  it("should use CRLF line endings", () => {
    const ics = buildICSContent(baseParams);

    expect(ics).toContain("\r\n");
    // Every line should end with CRLF
    const lines = ics.split("\r\n");
    expect(lines.length).toBeGreaterThan(5);
    // Check structure
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
  });

  it("should produce valid ICS structure with all optional fields", () => {
    const ics = buildICSContent({
      uid: "full-test-uid",
      title: "Full Event",
      start: "2026-08-15T09:00:00.000Z",
      end: "2026-08-15T10:30:00.000Z",
      allDay: false,
      description: "Full description",
      category: { name: "Important" },
      tags: [{ name: "tag1" }, { name: "tag2" }],
      recurrence: {
        frequency: "weekly",
        interval: 1,
        count: 10,
      },
    });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:full-test-uid");
    expect(ics).toContain("SUMMARY:Full Event");
    expect(ics).toContain("DTSTART:20260815T090000");
    expect(ics).toContain("DTEND:20260815T103000");
    expect(ics).toContain("DESCRIPTION:Full description");
    expect(ics).toContain("CATEGORIES:Important");
    expect(ics).toContain("Tags: tag1, tag2");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;COUNT=10");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("should handle event with no optional fields", () => {
    const ics = buildICSContent({
      uid: "minimal-uid",
      title: "Minimal",
      start: "2026-08-15T00:00:00.000Z",
      end: "2026-08-15T01:00:00.000Z",
    });

    // Should NOT contain optional fields
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("CATEGORIES:");
    expect(ics).not.toContain("RRULE:");
  });
});
