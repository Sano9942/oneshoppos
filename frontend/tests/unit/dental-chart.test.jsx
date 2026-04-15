import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import DentalChart from "../../src/pages/redesign/treatment/DentalChart";

describe("DentalChart — adult preset", () => {
  it("renders 32 adult teeth (1-32)", () => {
    render(<DentalChart preset="dental_adult" entries={[]} />);
    for (let n = 1; n <= 32; n++) {
      const btn = screen.getByTestId(`tooth-${n}`);
      expect(btn).toBeInTheDocument();
      expect(btn.textContent).toContain(String(n));
    }
  });

  it("splits upper (1-16) and lower (17-32) into two rows", () => {
    const { container } = render(<DentalChart preset="dental_adult" entries={[]} />);
    const upper = container.querySelector('[data-testid="dental-chart-upper"]');
    const lower = container.querySelector('[data-testid="dental-chart-lower"]');
    expect(upper).toBeTruthy();
    expect(lower).toBeTruthy();
    // Each row has 16 teeth
    expect(upper.querySelectorAll('[data-testid^="tooth-"]').length).toBe(16);
    expect(lower.querySelectorAll('[data-testid^="tooth-"]').length).toBe(16);
  });

  it("fires onToothClick with the area_code when a tooth is clicked", () => {
    const onClick = vi.fn();
    render(<DentalChart preset="dental_adult" entries={[]} onToothClick={onClick} />);
    fireEvent.click(screen.getByTestId("tooth-16"));
    expect(onClick).toHaveBeenCalledWith("16");
  });

  it("renders a colored marker on teeth with a chart entry", () => {
    const entries = [
      { area_code: "16", condition_code: "caries", severity: "moderate" },
    ];
    render(<DentalChart preset="dental_adult" entries={entries} />);
    const marker = screen.getByTestId("tooth-16-marker");
    expect(marker).toBeTruthy();
    // Caries color is #ef4444 (red)
    expect(marker.style.backgroundColor).toBe("rgb(239, 68, 68)");
  });

  it("does NOT render a marker on teeth without an entry", () => {
    const entries = [{ area_code: "16", condition_code: "caries" }];
    render(<DentalChart preset="dental_adult" entries={entries} />);
    expect(screen.queryByTestId("tooth-1-marker")).toBeNull();
    expect(screen.queryByTestId("tooth-32-marker")).toBeNull();
  });

  it("title attribute on a tooth with entry shows the condition", () => {
    const entries = [{ area_code: "8", condition_code: "crown", severity: null }];
    render(<DentalChart preset="dental_adult" entries={entries} />);
    const tooth = screen.getByTestId("tooth-8");
    expect(tooth.getAttribute("title")).toMatch(/crown/);
  });

  it("handles string and numeric area_codes interchangeably", () => {
    const entries = [{ area_code: 16, condition_code: "restoration" }];
    render(<DentalChart preset="dental_adult" entries={entries} />);
    // Number 16 should match tooth-16
    expect(screen.getByTestId("tooth-16-marker")).toBeTruthy();
  });
});

describe("DentalChart — primary preset", () => {
  it("renders 20 primary teeth (A-T)", () => {
    render(<DentalChart preset="dental_primary" entries={[]} />);
    const letters = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T"];
    for (const ltr of letters) {
      expect(screen.getByTestId(`tooth-${ltr}`)).toBeInTheDocument();
    }
  });

  it("adult teeth are NOT rendered in primary mode", () => {
    render(<DentalChart preset="dental_primary" entries={[]} />);
    expect(screen.queryByTestId("tooth-1")).toBeNull();
    expect(screen.queryByTestId("tooth-32")).toBeNull();
  });

  it("entries map correctly to letter-coded teeth", () => {
    const entries = [{ area_code: "K", condition_code: "extraction" }];
    render(<DentalChart preset="dental_primary" entries={entries} />);
    const marker = screen.getByTestId("tooth-K-marker");
    expect(marker).toBeTruthy();
  });
});

describe("DentalChart legend", () => {
  it("renders the condition color legend", () => {
    render(<DentalChart preset="dental_adult" entries={[]} />);
    expect(screen.getByText(/caries/i)).toBeTruthy();
    expect(screen.getByText(/crown/i)).toBeTruthy();
    expect(screen.getByText(/gingivitis/i)).toBeTruthy();
  });
});
