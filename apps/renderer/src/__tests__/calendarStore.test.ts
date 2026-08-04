import { describe, it, expect, beforeEach } from "vitest";
import { useCalendarStore } from "../store/calendarStore";

describe("calendarStore", () => {
  beforeEach(() => {
    // Reset the store to initial state before each test
    useCalendarStore.setState({
      calendars: [],
      selectedCalendarUrl: null,
      config: { url: "", username: "", password: "" },
      isConfigModalOpen: false,
      categories: [
        { id: "1", name: "工作", color: "#3b82f6" },
        { id: "2", name: "个人", color: "#10b981" },
      ],
      tags: [{ id: "1", name: "重要", color: "#ef4444" }],
      eventFilter: {},
    });
  });

  it("should initialize with default values", () => {
    const state = useCalendarStore.getState();
    expect(state.calendars).toEqual([]);
    expect(state.selectedCalendarUrl).toBeNull();
    expect(state.config).toEqual({ url: "", username: "", password: "" });
    expect(state.isConfigModalOpen).toBe(false);
    expect(state.categories).toHaveLength(2);
    expect(state.tags).toHaveLength(1);
    expect(state.eventFilter).toEqual({});
  });

  it("should set calendars", () => {
    const calendars = [
      { id: "1", displayName: "Work", url: "http://example.com/cal1" },
      { id: "2", displayName: "Personal", url: "http://example.com/cal2" },
    ];
    useCalendarStore.getState().setCalendars(calendars);
    expect(useCalendarStore.getState().calendars).toEqual(calendars);
  });

  it("should set selected calendar URL", () => {
    useCalendarStore
      .getState()
      .setSelectedCalendarUrl("http://example.com/cal");
    expect(useCalendarStore.getState().selectedCalendarUrl).toBe(
      "http://example.com/cal",
    );
  });

  it("should set selected calendar URL to null", () => {
    useCalendarStore.getState().setSelectedCalendarUrl(null);
    expect(useCalendarStore.getState().selectedCalendarUrl).toBeNull();
  });

  it("should update config partially", () => {
    useCalendarStore.getState().setConfig({ url: "http://example.com" });
    expect(useCalendarStore.getState().config.url).toBe("http://example.com");
    expect(useCalendarStore.getState().config.username).toBe("");
    expect(useCalendarStore.getState().config.password).toBe("");

    useCalendarStore.getState().setConfig({ username: "testuser" });
    expect(useCalendarStore.getState().config.url).toBe("http://example.com");
    expect(useCalendarStore.getState().config.username).toBe("testuser");
  });

  it("should reset config to empty", () => {
    useCalendarStore.getState().setConfig({
      url: "http://example.com",
      username: "user",
      password: "pass",
    });
    useCalendarStore.getState().resetConfig();
    expect(useCalendarStore.getState().config).toEqual({
      url: "",
      username: "",
      password: "",
    });
  });

  it("should toggle config modal", () => {
    expect(useCalendarStore.getState().isConfigModalOpen).toBe(false);
    useCalendarStore.getState().setIsConfigModalOpen(true);
    expect(useCalendarStore.getState().isConfigModalOpen).toBe(true);
    useCalendarStore.getState().setIsConfigModalOpen(false);
    expect(useCalendarStore.getState().isConfigModalOpen).toBe(false);
  });

  it("should set categories", () => {
    const categories = [{ id: "10", name: "Test", color: "#000000" }];
    useCalendarStore.getState().setCategories(categories);
    expect(useCalendarStore.getState().categories).toEqual(categories);
  });

  it("should add a category", () => {
    const newCategory = { id: "99", name: "New", color: "#ff0000" };
    useCalendarStore.getState().addCategory(newCategory);
    const categories = useCalendarStore.getState().categories;
    expect(categories).toContainEqual(newCategory);
  });

  it("should remove a category", () => {
    useCalendarStore.getState().removeCategory("1");
    const categories = useCalendarStore.getState().categories;
    expect(categories).not.toContainEqual(expect.objectContaining({ id: "1" }));
  });

  it("should set tags", () => {
    const tags = [{ id: "10", name: "TestTag", color: "#000000" }];
    useCalendarStore.getState().setTags(tags);
    expect(useCalendarStore.getState().tags).toEqual(tags);
  });

  it("should add a tag", () => {
    const newTag = { id: "99", name: "NewTag", color: "#00ff00" };
    useCalendarStore.getState().addTag(newTag);
    const tags = useCalendarStore.getState().tags;
    expect(tags).toContainEqual(newTag);
  });

  it("should remove a tag", () => {
    useCalendarStore.getState().removeTag("1");
    const tags = useCalendarStore.getState().tags;
    expect(tags).not.toContainEqual(expect.objectContaining({ id: "1" }));
  });

  it("should set event filter", () => {
    useCalendarStore
      .getState()
      .setEventFilter({ searchText: "test", categoryId: "1" });
    expect(useCalendarStore.getState().eventFilter).toEqual({
      searchText: "test",
      categoryId: "1",
    });
  });

  it("should clear event filter", () => {
    useCalendarStore
      .getState()
      .setEventFilter({ searchText: "test", categoryId: "1" });
    // setEventFilter merges with existing state, so passing {} won't clear it
    // The store's setEventFilter uses spread merge: { ...get().eventFilter, ...filter }
    // To clear we need to explicitly set searchText and categoryId to undefined
    useCalendarStore
      .getState()
      .setEventFilter({ searchText: undefined, categoryId: undefined });
    expect(useCalendarStore.getState().eventFilter.searchText).toBeUndefined();
    expect(useCalendarStore.getState().eventFilter.categoryId).toBeUndefined();
  });
});
