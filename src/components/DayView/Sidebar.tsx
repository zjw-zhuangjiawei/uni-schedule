import React from "react";
import { css } from "@emotion/react";
import { levelColors } from "./utils";

interface SidebarProps {
	pxPerHour: number;
	maxLevel: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ pxPerHour, maxLevel }) => {
	return (
		<div
			css={css`
				width: 220px;
				font-size: 12px;
				display: flex;
				flex-direction: column;
				gap: 12px;
			`}
		>
			<div>
				<label
					css={css`
						display: flex;
						flex-direction: column;
						gap: 4px;
					`}
				>
					<span
						css={css`
							font-weight: 600;
						`}
					>
						Zoom (px/hour)
					</span>
					<input
						type="range"
						min={30}
						max={200}
						value={pxPerHour}
						onChange={() => {}}
						disabled
					/>
					<span>{pxPerHour}</span>
				</label>
			</div>
			<div>
				<div
					css={css`
						font-weight: 600;
						margin-bottom: 4px;
					`}
				>
					Levels
				</div>
				{[...Array(maxLevel + 1).keys()].map((l) => (
					<div
						key={l}
						css={css`
							display: flex;
							align-items: center;
							gap: 6px;
							margin-bottom: 4px;
						`}
					>
						<div
							css={css`
								width: 14px;
								height: 14px;
								border-radius: 4px;
								background: ${levelColors[l % levelColors.length]};
							`}
						/>
						<span>Level {l}</span>
					</div>
				))}
				<div
					css={css`
						margin-top: 8px;
					`}
				>
					Exclusive bars have diagonal hatch overlay.
				</div>
			</div>
		</div>
	);
};
