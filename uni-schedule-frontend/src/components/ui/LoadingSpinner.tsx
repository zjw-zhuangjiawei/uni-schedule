import React from "react";
import styled from "@emotion/styled";
import { COLORS } from "../../utils";

const LoaderWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
`;

const Spinner = styled.div`
  width: 20px;
  height: 20px;
  border: 2px solid ${COLORS.border.light};
  border-top: 2px solid ${COLORS.primary};
  border-radius: 50%;
  animation: spin 1s linear infinite;

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`;

const LoadingText = styled.span`
  margin-left: 8px;
  font-size: 14px;
  color: ${COLORS.text.secondary};
`;

interface LoadingSpinnerProps {
  text?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  text = "Loading...",
}) => {
  return (
    <LoaderWrapper>
      <Spinner />
      {text && <LoadingText>{text}</LoadingText>}
    </LoaderWrapper>
  );
};
