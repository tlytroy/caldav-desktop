import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingSpinner } from "../components/ui/LoadingSpinner";

describe("LoadingSpinner", () => {
  it("should render with default size", () => {
    const { container } = render(<LoadingSpinner />);
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass("w-8", "h-8");
  });

  it("should render with small size", () => {
    const { container } = render(<LoadingSpinner size="sm" />);
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toHaveClass("w-4", "h-4");
  });

  it("should render with large size", () => {
    const { container } = render(<LoadingSpinner size="lg" />);
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toHaveClass("w-12", "h-12");
  });

  it("should display message when provided", () => {
    render(<LoadingSpinner message="Loading..." />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("should not display message when not provided", () => {
    const { container } = render(<LoadingSpinner />);
    expect(container.querySelector("p")).not.toBeInTheDocument();
  });
});