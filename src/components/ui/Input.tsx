import React from "react";
import styled from "@emotion/styled";
import { COLORS } from "../../utils";

const StyledInput = styled.input`
  padding: 8px 12px;
  border: 1px solid ${COLORS.border.medium};
  border-radius: 4px;
  font-size: 14px;
  transition: border-color 0.2s ease;

  &:focus {
    outline: none;
    border-color: ${COLORS.primary};
    box-shadow: 0 0 0 2px ${COLORS.primary}33;
  }

  &:disabled {
    background-color: ${COLORS.background.secondary};
    cursor: not-allowed;
  }
`;

const StyledLabel = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: ${COLORS.text.primary};
`;

interface InputProps {
  label?: string;
  type?: "text" | "number" | "datetime-local" | "checkbox";
  value?: string | number | boolean;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

export const Input: React.FC<InputProps> = ({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  disabled,
  required,
}) => {
  const inputElement = (
    <StyledInput
      type={type}
      value={type === "checkbox" ? undefined : (value as string | number)}
      checked={type === "checkbox" ? (value as boolean) : undefined}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
    />
  );

  if (label) {
    return (
      <StyledLabel>
        {label}
        {inputElement}
      </StyledLabel>
    );
  }

  return inputElement;
};
