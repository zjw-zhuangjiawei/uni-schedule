import { useState, useEffect, useCallback } from "react";
import { querySchedules } from "../api/schedule";
import type { Schedule, QueryScheduleOptions, LoadingState } from "../types";

export function useSchedules(options: QueryScheduleOptions = {}) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoading: false,
    error: null,
  });

  const fetchSchedules = useCallback(async () => {
    setLoadingState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const data = await querySchedules(options);
      setSchedules(data);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setLoadingState((prev) => ({ ...prev, error: errorMessage }));
    } finally {
      setLoadingState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [options]);

  const refreshSchedules = useCallback(() => {
    return fetchSchedules();
  }, [fetchSchedules]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  return {
    schedules,
    setSchedules,
    isLoading: loadingState.isLoading,
    error: loadingState.error,
    refreshSchedules,
  };
}
