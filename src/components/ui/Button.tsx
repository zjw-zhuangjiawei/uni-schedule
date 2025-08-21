import React from "react";
import MUIButton from "@mui/material/Button";
import type { ButtonProps } from "../../types";

// This component is a thin wrapper around MUI Button.
// English comments and strings are intentionally used inside the file.
export const Button: React.FC<ButtonProps & { children: React.ReactNode }> = ({
  children,
  variant = "secondary",
  size = "medium",
  disabled = false,
  type = "button",
  onClick,
  className,
  style,
}) => {
  // Map project variants to MUI variants
  const variantMap: Record<string, "contained" | "outlined" | "text"> = {
    primary: "contained",
    secondary: "outlined",
    ghost: "text",
  };

  const muiVariant = variantMap[variant as string] || "outlined";

  // Map sizes directly; default to 'medium' which is supported by MUI
  const muiSize = (size as "small" | "medium" | "large") || "medium";

  // Map project color variants to MUI color prop so theme palette is used
  const colorMap: Record<string, "primary" | "inherit" | "error" | "success"> =
    {
      primary: "primary",
      secondary: "inherit",
      danger: "error",
      ghost: "inherit",
    };

  const muiColor = colorMap[variant as string] || "inherit";

  return (
    <MUIButton
      variant={muiVariant}
      size={muiSize}
      color={muiColor}
      disabled={disabled}
      type={type}
      onClick={onClick}
      className={className}
      style={style}
    >
      {children}
    </MUIButton>
  );
};
