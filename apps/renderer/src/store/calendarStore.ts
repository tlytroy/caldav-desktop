import { create } from "zustand";
import type {
  Calendar,
  CalDAVConfig,
  EventCategory,
  EventTag,
  EventFilter,
} from "../types";

interface CalendarState {
  calendars: Calendar[];
  selectedCalendarUrl: string | null;
  config: CalDAVConfig;
  isConfigModalOpen: boolean;
  categories: EventCategory[];
  tags: EventTag[];
  eventFilter: EventFilter;
  setCalendars: (calendars: Calendar[]) => void;
  setSelectedCalendarUrl: (url: string | null) => void;
  setConfig: (config: Partial<CalDAVConfig>) => void;
  setIsConfigModalOpen: (open: boolean) => void;
  resetConfig: () => void;
  setCategories: (categories: EventCategory[]) => void;
  setTags: (tags: EventTag[]) => void;
  setEventFilter: (filter: EventFilter) => void;
  addCategory: (category: EventCategory) => void;
  addTag: (tag: EventTag) => void;
  removeCategory: (categoryId: string) => void;
  removeTag: (tagId: string) => void;
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  calendars: [],
  selectedCalendarUrl: null,
  config: {
    url: "",
    username: "",
    password: "",
  },
  isConfigModalOpen: false,
  categories: [
    { id: "1", name: "工作", color: "#3b82f6" },
    { id: "2", name: "个人", color: "#10b981" },
    { id: "3", name: "家庭", color: "#f59e0b" },
  ],
  tags: [
    { id: "1", name: "重要", color: "#ef4444" },
    { id: "2", name: "紧急", color: "#f97316" },
  ],
  eventFilter: {},
  setCalendars: (calendars) => set({ calendars }),
  setSelectedCalendarUrl: (url) => set({ selectedCalendarUrl: url }),
  setConfig: (config) =>
    set((state) => ({ config: { ...state.config, ...config } })),
  setIsConfigModalOpen: (open) => set({ isConfigModalOpen: open }),
  resetConfig: () =>
    set({
      config: {
        url: "",
        username: "",
        password: "",
      },
    }),
  setCategories: (categories) => set({ categories }),
  setTags: (tags) => set({ tags }),
  setEventFilter: (filter) =>
    set({ eventFilter: { ...get().eventFilter, ...filter } }),
  addCategory: (category) =>
    set((state) => ({ categories: [...state.categories, category] })),
  addTag: (tag) => set((state) => ({ tags: [...state.tags, tag] })),
  removeCategory: (categoryId) =>
    set((state) => ({
      categories: state.categories.filter((cat) => cat.id !== categoryId),
    })),
  removeTag: (tagId) =>
    set((state) => ({
      tags: state.tags.filter((tag) => tag.id !== tagId),
    })),
}));
