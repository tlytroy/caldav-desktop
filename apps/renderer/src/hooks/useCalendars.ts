import { useEffect, useCallback } from "react";
import { useCalendarStore } from "../store/calendarStore";
import { fetchCalendars, fetchConfig } from "../api/calendar";

export function useCalendars() {
  const {
    calendars,
    setCalendars,
    selectedCalendarUrl,
    setSelectedCalendarUrl,
    config,
    setConfig: setStoreConfig,
    setIsConfigModalOpen,
  } = useCalendarStore();

  const loadCalendars = useCallback(async () => {
    try {
      const fetchedCalendars = await fetchCalendars();
      setCalendars(fetchedCalendars);

      if (fetchedCalendars.length > 0 && !selectedCalendarUrl) {
        setSelectedCalendarUrl(fetchedCalendars[0].url);
      }
    } catch (err) {
      console.error("Failed to load calendars:", err);
      setIsConfigModalOpen(true);
    }
  }, [
    setCalendars,
    selectedCalendarUrl,
    setSelectedCalendarUrl,
    setIsConfigModalOpen,
  ]);

  const loadConfig = useCallback(async () => {
    try {
      const fetchedConfig = await fetchConfig();
      setStoreConfig(fetchedConfig);
    } catch (err) {
      console.warn("Failed to load config:", err);
    }
  }, [setStoreConfig]);

  useEffect(() => {
    loadCalendars();
    loadConfig();
  }, [loadCalendars, loadConfig]);

  return {
    calendars,
    selectedCalendarUrl,
    config,
    setSelectedCalendarUrl,
    setIsConfigModalOpen,
    refreshCalendars: loadCalendars,
  };
}
