import React, { useState } from "react";
import { resetFakeData, addTestScenarios } from "../../api/fakeScheduleData";

interface DebugPanelProps {
	onDataChanged: () => void;
}

const DebugPanel: React.FC<DebugPanelProps> = ({ onDataChanged }) => {
	const [isOpen, setIsOpen] = useState(false);

	const handleResetData = () => {
		resetFakeData();
		onDataChanged();
		console.log("🔧 Fake data reset");
	};

	const handleAddTestScenarios = () => {
		addTestScenarios();
		onDataChanged();
		console.log("🔧 Test scenarios added");
	};

	// Check if we're using fake data
	const usingFakeData =
		typeof window !== "undefined" && !("__TAURI__" in window);

	if (!usingFakeData) {
		return null; // Don't show debug panel when using real Tauri backend
	}

	return (
		<div
			style={{
				position: "fixed",
				top: 10,
				right: 10,
				backgroundColor: "#f3f4f6",
				border: "1px solid #d1d5db",
				borderRadius: 8,
				padding: 8,
				boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
				zIndex: 1000,
				fontSize: 12,
				fontFamily: "monospace",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<span style={{ color: "#059669", fontWeight: "bold" }}>
					🔧 DEBUG MODE
				</span>
				<button
					onClick={() => setIsOpen(!isOpen)}
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						fontSize: 12,
						color: "#6b7280",
					}}
				>
					{isOpen ? "▼" : "▶"}
				</button>
			</div>

			{isOpen && (
				<div
					style={{
						marginTop: 8,
						display: "flex",
						flexDirection: "column",
						gap: 4,
					}}
				>
					<div style={{ color: "#6b7280", marginBottom: 4 }}>
						Using fake data (Tauri not available)
					</div>
					<button
						onClick={handleResetData}
						style={{
							padding: "4px 8px",
							backgroundColor: "#fbbf24",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
							fontSize: 11,
						}}
					>
						Reset Data
					</button>
					<button
						onClick={handleAddTestScenarios}
						style={{
							padding: "4px 8px",
							backgroundColor: "#3b82f6",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
							fontSize: 11,
						}}
					>
						Add Test Scenarios
					</button>
				</div>
			)}
		</div>
	);
};

export default DebugPanel;
