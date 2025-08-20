import React from "react";
import { css } from "@emotion/react";

interface TimeAxisProps {
	hours: number[];
	pxPerHour: number;
	height: number;
}

export const TimeAxis: React.FC<TimeAxisProps> = ({
	hours,
	pxPerHour,
	height,
}) => {
	return (
		<div
			css={css`
				position: relative;
				height: ${height}px;
				border-right: 1px solid #e2e8f0;
				padding-right: 8px;
			`}
		>
			{hours.map((h) => {
				const top = h * pxPerHour;
				return (
					<div
						key={h}
						css={css`
							position: absolute;
							top: ${top}px;
							transform: translateY(-50%);
							font-size: 12px;
							color: #475569;
						`}
					>
						{h.toString().padStart(2, "0")}:00
					</div>
				);
			})}
		</div>
	);
};
