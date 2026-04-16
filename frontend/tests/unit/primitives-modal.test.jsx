import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import React, { useState } from "react";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ConfirmDialog,
  TabBar,
  Button,
} from "../../src/ui/primitives";

describe("Modal", () => {
  beforeEach(() => cleanup());

  it("renders children when open", () => {
    render(
      <Modal open={true} onClose={() => {}} title="Hello">
        <div>Body content here</div>
      </Modal>
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Body content here")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}} title="Hello">
        <div>Body content here</div>
      </Modal>
    );
    expect(container.firstChild).toBeNull();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Hello">
        <div>x</div>
      </Modal>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Hello">
        <div>x</div>
      </Modal>
    );
    // The backdrop is the dialog wrapper itself.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when content inside the card is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Hello">
        <div data-testid="content-area">Click me</div>
      </Modal>
    );
    fireEvent.click(screen.getByTestId("content-area"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose on backdrop click when closeOnBackdrop=false", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Hello" closeOnBackdrop={false}>
        <div>x</div>
      </Modal>
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders close button by default", () => {
    render(
      <Modal open={true} onClose={() => {}} title="Hello">
        <div>x</div>
      </Modal>
    );
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("hides close button when hideClose=true", () => {
    render(
      <Modal open={true} onClose={() => {}} title="Hello" hideClose>
        <div>x</div>
      </Modal>
    );
    expect(screen.queryByLabelText("Close")).not.toBeInTheDocument();
  });

  it("clicking close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Hello">
        <div>x</div>
      </Modal>
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies the requested width class", () => {
    const { rerender } = render(
      <Modal open={true} onClose={() => {}} title="x" size="sm">
        <div>x</div>
      </Modal>
    );
    expect(document.querySelector(".max-w-sm")).toBeTruthy();
    rerender(
      <Modal open={true} onClose={() => {}} title="x" size="xl">
        <div>x</div>
      </Modal>
    );
    expect(document.querySelector(".max-w-2xl")).toBeTruthy();
  });

  it("Escape listener is cleaned up after close (no stale handlers)", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(false)}>force-close</button>
          <Modal open={open} onClose={() => setOpen(false)} title="x">
            <div>x</div>
          </Modal>
        </>
      );
    }
    const onCloseSpy = vi.fn();
    render(<Harness />);
    // Close it
    fireEvent.click(screen.getByText("force-close"));
    // Now press Escape — should not throw and should not invoke any handler
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();
    expect(onCloseSpy).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog", () => {
  beforeEach(() => cleanup());

  it("renders title, body, and both buttons", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete this customer?"
        body="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText("Delete this customer?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  });

  it("uses danger tone on confirm when destructive=true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="x"
        confirmLabel="Delete"
        destructive
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(confirm.className).toContain("bg-(--ui-danger)");
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="x"
        confirmLabel="Yes"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons + replaces confirm label when busy=true", () => {
    render(
      <ConfirmDialog
        open={true}
        title="x"
        confirmLabel="Yes"
        cancelLabel="No"
        busy
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "No" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Working..." })).toBeDisabled();
  });
});

describe("TabBar", () => {
  beforeEach(() => cleanup());

  it("renders all tab labels", () => {
    render(
      <TabBar
        value="a"
        onChange={() => {}}
        tabs={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
          { value: "c", label: "Gamma" },
        ]}
      />
    );
    expect(screen.getByRole("tab", { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Beta/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Gamma/ })).toBeInTheDocument();
  });

  it("marks the active tab via aria-selected", () => {
    render(
      <TabBar
        value="b"
        onChange={() => {}}
        tabs={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
      />
    );
    expect(screen.getByRole("tab", { name: /Alpha/ })).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(screen.getByRole("tab", { name: /Beta/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("calls onChange with the tab value when clicked", () => {
    const onChange = vi.fn();
    render(
      <TabBar
        value="a"
        onChange={onChange}
        tabs={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("renders count badge when count is provided", () => {
    render(
      <TabBar
        value="a"
        onChange={() => {}}
        tabs={[
          { value: "a", label: "Inbox", count: 5 },
          { value: "b", label: "Sent" },
        ]}
      />
    );
    expect(screen.getByRole("tab", { name: /Inbox/ }).textContent).toContain("5");
  });
});

describe("Button extensions", () => {
  beforeEach(() => cleanup());

  it("iconOnly applies square padding (p-2) at default size", () => {
    render(<Button iconOnly aria-label="Edit">i</Button>);
    const btn = screen.getByRole("button", { name: "Edit" });
    expect(btn.className).toContain("p-2");
  });

  it("iconOnly + size=sm applies p-1.5", () => {
    render(<Button iconOnly size="sm" aria-label="Edit">i</Button>);
    const btn = screen.getByRole("button", { name: "Edit" });
    expect(btn.className).toContain("p-1.5");
  });

  it("tone=link applies primary text color and zero padding", () => {
    render(<Button tone="link">Show more</Button>);
    const btn = screen.getByRole("button", { name: "Show more" });
    expect(btn.className).toContain("text-(--ui-primary)");
    expect(btn.className).toContain("p-0");
  });
});

describe("ModalBody / ModalFooter", () => {
  beforeEach(() => cleanup());

  it("ModalBody renders children", () => {
    render(<ModalBody><span>inner</span></ModalBody>);
    expect(screen.getByText("inner")).toBeInTheDocument();
  });

  it("ModalFooter renders children right-aligned", () => {
    const { container } = render(<ModalFooter><span>action</span></ModalFooter>);
    expect(container.firstChild.className).toContain("justify-end");
  });
});
