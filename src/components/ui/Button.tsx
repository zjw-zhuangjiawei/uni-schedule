import React from "react";
import styled from "@emotion/styled";
import { COLORS } from "../../utils";
import type { ButtonProps } from "../../types";

const StyledButton = styled.button<{
  variant: ButtonProps["variant"];
  size: ButtonProps["size"];
}>`
  padding: ${(props) => {
    switch (props.size) {
      case "small":
        return "4px 8px";
      case "large":
        return "12px 24px";
      default:
        return "8px 16px";
    }
  }};

  font-size: ${(props) => {
    switch (props.size) {
      case "small":
        return "12px";
      case "large":
        return "16px";
      default:
        return "14px";
    }
  }};

  background-color: ${(props) => {
    switch (props.variant) {
      case "primary":
        return COLORS.primary;
      case "danger":
        return COLORS.danger;
      case "secondary":
      default:
        return COLORS.secondary;
    }
  }};

  color: ${(props) =>
    props.variant === "secondary" ? COLORS.text.primary : "white"};
  border: 1px solid
    ${(props) => {
      switch (props.variant) {
        case "primary":
          return COLORS.primary;
        case "danger":
          return COLORS.danger;
        case "secondary":
        default:
          return COLORS.border.medium;
      }
    }};

  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

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
  return (
    <StyledButton
      variant={variant}
      size={size}
      disabled={disabled}
      type={type}
      onClick={onClick}
      className={className}
      style={style}
    >
      {children}
    </StyledButton>
  );
};
