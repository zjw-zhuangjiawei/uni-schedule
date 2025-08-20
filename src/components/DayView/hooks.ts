import { useState, useCallback } from "react";
import { querySchedules } from "../../api/schedule";
import type { ScheduleItem } from "./types";
import { toItem } from "./utils";

export function useSchedules() {
	const [items, setItems] = useState<ScheduleItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const list = await querySchedules({});
			setItems(
				list.map(toItem).sort((a, b) => a.start.getTime() - b.start.getTime())
			);
		} catch (e: any) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	return {
		items,
		loading,
		error,
		refresh,
		setError,
	};
}
