import React from "react";
import { css } from "@emotion/react";
import type { ScheduleItem } from "./types";
import { formatTime } from "./utils";

interface TooltipProps {
	item: ScheduleItem;
	top: number;
	left: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ item, top, left }) => {
	return (
		<div
			css={css`
				position: absolute;
				top: ${top}px;
				left: ${left}px;
				background: #0f172a;
				color: #fff;
				padding: 6px 8px;
				border-radius: 6px;
				font-size: 12px;
				max-width: 220px;
				z-index: 20;
			`}
		>
			<div
				css={css`
					font-weight: 600;
					margin-bottom: 4px;
				`}
			>
				{item.name}
			</div>
			<div>Level: {item.level}</div>
			<div>Exclusive: {item.exclusive ? "Yes" : "No"}</div>
			<div>
				{formatTime(item.start)} - {formatTime(item.end)}
			</div>
			<div
				css={css`
					opacity: 0.7;
				`}
			>
				ID: {item.id}
			</div>
		</div>
	);
};
