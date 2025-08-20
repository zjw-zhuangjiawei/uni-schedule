import React, { useCallback } from "react";
import type { FormState } from "./types";
import type { CreateSchedulePayload } from "../../api/schedule";
import { createSchedule } from "../../api/schedule";
import { HOUR_MS } from "./utils";

interface ScheduleFormProps {
	form: FormState;
	setForm: React.Dispatch<React.SetStateAction<FormState>>;
	submitting: boolean;
	setSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
	setError: React.Dispatch<React.SetStateAction<string | null>>;
	onSuccess: () => void;
	pxPerHour: number;
	setPxPerHour: React.Dispatch<React.SetStateAction<number>>;
	onRefresh: () => void;
	loading: boolean;
}

export const ScheduleForm: React.FC<ScheduleFormProps> = ({
	form,
	setForm,
	submitting,
	setSubmitting,
	setError,
	onSuccess,
	pxPerHour,
	setPxPerHour,
	onRefresh,
	loading,
}) => {
	const onChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
			const { name, value, type, checked } = e.target as any;
			setForm((f) => ({
				...f,
				[name]:
					type === "checkbox"
						? checked
						: name === "durationHours" || name === "level"
						? Number(value)
						: value,
			}));
		},
		[setForm]
	);

	const onSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setSubmitting(true);
			setError(null);
			try {
				const start = new Date(form.start);
				const end = new Date(start.getTime() + form.durationHours * HOUR_MS);
				const payload: CreateSchedulePayload = {
					start: start.toISOString(),
					end: end.toISOString(),
					level: form.level,
					exclusive: form.exclusive,
					name: form.name || "(untitled)",
					parents: [],
				};
				await createSchedule(payload);
				onSuccess();
				setForm((f) => ({ ...f, name: "" }));
			} catch (e: any) {
				setError(String(e));
			} finally {
				setSubmitting(false);
			}
		},
		[form, setSubmitting, setError, onSuccess, setForm]
	);

	return (
		<div
			style={{
				width: 300,
				display: "flex",
				flexDirection: "column",
				gap: 16,
			}}
		>
			<form
				onSubmit={onSubmit}
				style={{ display: "flex", flexDirection: "column", gap: 8 }}
			>
				<h3 style={{ margin: 0, fontSize: 16 }}>New Schedule</h3>
				<label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
					<span>Name</span>
					<input
						name="name"
						value={form.name}
						onChange={onChange}
						placeholder="Title"
					/>
				</label>
				<label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
					<span>Start</span>
					<input
						type="datetime-local"
						name="start"
						value={form.start}
						onChange={onChange}
					/>
				</label>
				<label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
					<span>Duration (hours)</span>
					<input
						name="durationHours"
						type="number"
						min={0.25}
						step={0.25}
						value={form.durationHours}
						onChange={onChange}
					/>
				</label>
				<label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
					<span>Level</span>
					<input
						name="level"
						type="number"
						min={0}
						value={form.level}
						onChange={onChange}
					/>
				</label>
				<label style={{ display: "flex", alignItems: "center", gap: 6 }}>
					<input
						type="checkbox"
						name="exclusive"
						checked={form.exclusive}
						onChange={onChange}
					/>
					<span>Exclusive</span>
				</label>
				<button
					type="submit"
					disabled={submitting}
					style={{ padding: "6px 10px" }}
				>
					{submitting ? "Creating…" : "Create"}
				</button>
				<button
					type="button"
					onClick={onRefresh}
					style={{ padding: "4px 8px" }}
					disabled={loading}
				>
					Refresh
				</button>
				<label
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 2,
						marginTop: 8,
					}}
				>
					<span>Zoom (px/hour)</span>
					<input
						type="range"
						min={30}
						max={200}
						value={pxPerHour}
						onChange={(e) => setPxPerHour(Number(e.target.value))}
					/>
					<span>{pxPerHour}</span>
				</label>
			</form>
		</div>
	);
};
