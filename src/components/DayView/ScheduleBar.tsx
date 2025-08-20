import React from "react";
import { css } from "@emotion/react";
import type { ScheduleItem } from "./types";
import { formatTime, colorFor } from "./utils";

interface ScheduleBarProps {
	item: ScheduleItem;
	top: number;
	bottom: number;
	left: number;
	width: number;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
}

export const ScheduleBar: React.FC<ScheduleBarProps> = ({
	item,
	top,
	bottom,
	left,
	width,
	onMouseEnter,
	onMouseLeave,
}) => {
	const color = colorFor(item);
	const exclusivePattern = item.exclusive
		? "repeating-linear-gradient(45deg, rgba(0,0,0,0.15) 0 6px, transparent 6px 12px)"
		: "none";

	return (
		<div
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
			css={css`
				position: absolute;
				top: ${top}px;
				left: ${left}px;
				height: ${bottom - top}px;
				width: ${width}px;
				border-radius: 6px;
				background: ${color};
				box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
				color: #fff;
				padding: 2px 4px;
				font-size: 12px;
				overflow: hidden;
				cursor: pointer;
				display: flex;
				flex-direction: column;
				justify-content: space-between;
				background-image: ${exclusivePattern};
				background-blend-mode: overlay;
				transition: box-shadow 120ms, transform 120ms;
				&:hover {
					box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
				}
			`}
		>
			<span
				css={css`
					font-weight: 600;
					line-height: 1.1;
				`}
			>
				{item.name}
			</span>
			<span
				css={css`
					opacity: 0.85;
				`}
			>
				{formatTime(item.start)} - {formatTime(item.end)}
			</span>
		</div>
	);
};
