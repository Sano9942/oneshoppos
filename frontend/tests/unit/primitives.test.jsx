import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { Button, Input, Badge, EmptyState } from "../../src/ui/primitives";

describe("UI Primitives", () => {
  describe("Button", () => {
    it("should render children correctly", () => {
      render(<Button>Click Me</Button>);
      expect(
        screen.getByRole("button", { name: /click me/i }),
      ).toBeInTheDocument();
    });

    it("should call onClick when clicked", () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);
      fireEvent.click(screen.getByRole("button"));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("should apply primary tone classes", () => {
      render(<Button tone="primary">Primary</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("bg-(--ui-primary)");
    });

    it("should apply danger tone classes", () => {
      render(<Button tone="danger">Danger</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("bg-(--ui-danger)");
    });
  });

  describe("Input", () => {
    it("should render with placeholder", () => {
      render(<Input placeholder="Enter name" />);
      expect(screen.getByPlaceholderText(/enter name/i)).toBeInTheDocument();
    });

    it("should update value on change", () => {
      render(<Input placeholder="test" />);
      const input = screen.getByPlaceholderText("test");
      fireEvent.change(input, { target: { value: "New Value" } });
      expect(input.value).toBe("New Value");
    });
  });

  describe("Badge", () => {
    it("should render correctly with different tones", () => {
      const { rerender } = render(<Badge tone="success">Success</Badge>);
      expect(screen.getByText("Success")).toHaveClass("bg-(--ui-success-bg)");

      rerender(<Badge tone="warning">Warning</Badge>);
      expect(screen.getByText("Warning")).toHaveClass("bg-(--ui-warning-bg)");

      rerender(<Badge tone="danger">Danger</Badge>);
      expect(screen.getByText("Danger")).toHaveClass("bg-(--ui-danger-bg)");
    });
  });

  describe("EmptyState", () => {
    it("should render title and body", () => {
      render(<EmptyState title="No Data" body="Try searching again" />);
      expect(screen.getByText("No Data")).toBeInTheDocument();
      expect(screen.getByText("Try searching again")).toBeInTheDocument();
    });
  });
});
