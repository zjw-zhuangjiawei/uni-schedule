import React from "react";
import styled from "@emotion/styled";
import { COLORS } from "../../utils";

const ErrorWrapper = styled.div`
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 4px;
  padding: 12px;
  margin: 8px 0;
`;

const ErrorText = styled.div`
  color: ${COLORS.danger};
  font-size: 14px;
  font-weight: 500;
`;

const ErrorDescription = styled.div`
  color: #7f1d1d;
  font-size: 12px;
  margin-top: 4px;
`;

interface ErrorMessageProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  title = "Error",
  message,
  onRetry,
}) => {
  return (
    <ErrorWrapper>
      <ErrorText>{title}</ErrorText>
      <ErrorDescription>{message}</ErrorDescription>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: "8px",
            padding: "4px 8px",
            fontSize: "12px",
            backgroundColor: COLORS.danger,
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </ErrorWrapper>
  );
};
