import { render, screen, fireEvent } from "@testing-library/react";
// Ensure TypeScript recognizes jest-dom matchers
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { Button } from "../components/ui/Button";
import { AppThemeProvider } from "../theme/EmotionThemeProvider";

const wrap = (ui: React.ReactElement) => (
  <AppThemeProvider mode="light">{ui}</AppThemeProvider>
);

describe("Button component", () => {
  it("renders children text", () => {
    render(wrap(<Button>Click Me</Button>));
    expect(
      screen.getByRole("button", { name: /click me/i }),
    ).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const handler = vi.fn();
    render(wrap(<Button onClick={handler}>Submit</Button>));
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("is disabled when disabled prop is true", () => {
    render(wrap(<Button disabled>Disabled</Button>));
    const btn = screen.getByRole("button", { name: /disabled/i });
    expect(btn).toBeDisabled();
  });
});
