import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { Button } from "../components/ui/Button";

describe("Button component", () => {
  it("renders children text", () => {
    render(<Button>Click Me</Button>);
    expect(
      screen.getByRole("button", { name: /click me/i }),
    ).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const handler = vi.fn();
    render(<Button onClick={handler}>Submit</Button>);
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled</Button>);
    const btn = screen.getByRole("button", { name: /disabled/i });
    expect(btn).toBeDisabled();
  });
});
