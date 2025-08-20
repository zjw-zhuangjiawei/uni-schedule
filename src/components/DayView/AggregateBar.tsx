import React from "react";
import { css } from "@emotion/react";
import type { LayoutGroup } from "./types";
import { formatTime } from "./utils";

interface AggregateBarProps {
	group: LayoutGroup;
	top: number;
	bottom: number;
	left: number;
	width: number;
	onClick: () => void;
}

export const AggregateBar: React.FC<AggregateBarProps> = ({
	group,
	top,
	bottom,
	left,
	width,
	onClick,
}) => {
	return (
		<div
			role="button"
			onClick={onClick}
			css={css`
				position: absolute;
				top: ${top}px;
				left: ${left}px;
				height: ${bottom - top}px;
				width: ${width}px;
				border-radius: 6px;
				background: linear-gradient(135deg, #64748b, #475569);
				color: #fff;
				padding: 4px 6px;
				font-size: 12px;
				cursor: pointer;
				display: flex;
				flex-direction: column;
				justify-content: space-between;
				box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
				outline: 1px dashed rgba(255, 255, 255, 0.35);
				transition: background 120ms;
				&:hover {
					background: linear-gradient(135deg, #334155, #1e293b);
				}
			`}
			title={`点击展开 ${group.itemIds.length} 条`}
		>
			<span style={{ fontWeight: 600 }}>{group.itemIds.length} 条</span>
			<span style={{ opacity: 0.85 }}>
				{formatTime(group.start)} - {formatTime(group.end)}
			</span>
			<span style={{ fontSize: 10, alignSelf: "flex-end", opacity: 0.7 }}>
				展开 ▸
			</span>
		</div>
	);
};
