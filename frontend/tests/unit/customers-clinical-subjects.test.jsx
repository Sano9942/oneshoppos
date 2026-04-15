import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

// Stub the 3 context hooks CustomersRedesign consumes.
vi.mock("../../src/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ fmt: (n) => String(n), symbol: "PKR" }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("../../src/contexts/ToastContext", () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    warning: vi.fn(),
    toast: vi.fn(),
  }),
}));

let currentPreset = { label: (k) => k, industry_type: "veterinary" };
vi.mock("../../src/contexts/PresetContext", () => ({
  usePreset: () => currentPreset,
}));

// Mock api.js — record calls, return scripted responses per route.
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiDel = vi.fn();
vi.mock("../../src/api", () => ({
  api: {
    get: (...args) => apiGet(...args),
    post: (...args) => apiPost(...args),
    put: (...args) => apiPut(...args),
    del: (...args) => apiDel(...args),
    upload: vi.fn(),
    raw: vi.fn(),
  },
}));

import CustomersRedesign from "../../src/pages/redesign/CustomersRedesign";

const CUSTOMER = {
  id: 42,
  name: "Jane Doe",
  mobile: "",
  email: "",
  address: "",
  loyalty_points: 0,
  order_count: 0,
  total_spent: 0,
  tags: [],
};

function defaultApiGet(path, query) {
  // Customer list is fetched with the search string embedded in the URL, not as 2nd arg.
  if (path.startsWith("/api/customers?")) return Promise.resolve({ customers: [CUSTOMER] });
  if (path === "/api/loyalty/tiers") return Promise.resolve({ tiers: [] });
  if (path === "/api/customer-groups") return Promise.resolve({ groups: [] });
  if (path === "/api/customers/tags") return Promise.resolve({ tags: [] });
  if (path === `/api/customers/${CUSTOMER.id}/sales`) return Promise.resolve({ sales: [] });
  if (path === `/api/customers/${CUSTOMER.id}/wallet`) return Promise.resolve({ balance: 0, ledger: [] });
  if (path === `/api/customers/${CUSTOMER.id}/profile`) return Promise.resolve({});
  if (path === "/api/patient-subjects") return Promise.resolve({ subjects: [] });
  if (path === "/api/treatment-plans") return Promise.resolve({ plans: [] });
  return Promise.resolve({});
}

describe("CustomersRedesign — clinical subjects inline CRUD", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiDel.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    apiGet.mockImplementation(defaultApiGet);
    currentPreset = { label: (k) => k, industry_type: "veterinary" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the Subjects section with an Add button on a clinical preset even when list is empty", async () => {
    render(<CustomersRedesign />);
    // Wait for customer list to render + click the customer row to open the detail panel.
    const row = await screen.findByText("Jane Doe");
    fireEvent.click(row);

    const addBtn = await screen.findByTestId("subject-add");
    expect(addBtn).toBeInTheDocument();

    // Empty-state copy for veterinary preset.
    expect(screen.getByText(/no pets on file/i)).toBeInTheDocument();
  });

  it("submits a correctly shaped payload when Add Subject is saved", async () => {
    apiPost.mockResolvedValue({ id: 99 });
    // After POST, the refresh call returns the newly-created subject.
    apiGet.mockImplementation((path, query) => {
      if (path === "/api/patient-subjects" && query?.customer_id === 42) {
        if (apiPost.mock.calls.length > 0) {
          return Promise.resolve({
            subjects: [{ id: 99, subject_type: "pet", name: "Rex", species: "Dog", breed: "", weight_kg: null }],
          });
        }
        return Promise.resolve({ subjects: [] });
      }
      return defaultApiGet(path, query);
    });

    render(<CustomersRedesign />);
    fireEvent.click(await screen.findByText("Jane Doe"));

    fireEvent.click(await screen.findByTestId("subject-add"));

    // Modal rendered — default type defaults to "pet" under veterinary preset.
    const typeSelect = await screen.findByTestId("subject-type");
    expect(typeSelect.value).toBe("pet");

    fireEvent.change(screen.getByTestId("subject-name"), { target: { value: "Rex" } });
    // Species field only renders when subject_type === "pet".
    fireEvent.change(screen.getByPlaceholderText("Dog, Cat, Bird…"), { target: { value: "Dog" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("subject-save"));
    });

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [postPath, postBody] = apiPost.mock.calls[0];
    expect(postPath).toBe("/api/patient-subjects");
    expect(postBody).toMatchObject({
      customer_id: 42,
      subject_type: "pet",
      name: "Rex",
      species: "Dog",
    });
    // Optional fields absent from the form should serialize to null.
    expect(postBody.breed).toBeNull();
    expect(postBody.dob).toBeNull();
    expect(postBody.weight_kg).toBeNull();

    // Toast fired + list refetched.
    expect(toastSuccess).toHaveBeenCalledWith("Subject added");
    expect(await screen.findByText("Rex")).toBeInTheDocument();
  });

  it("defaults subject_type to 'dependent' on a non-veterinary clinical preset (dental_clinic)", async () => {
    currentPreset = { label: (k) => k, industry_type: "dental_clinic" };
    render(<CustomersRedesign />);
    fireEvent.click(await screen.findByText("Jane Doe"));
    fireEvent.click(await screen.findByTestId("subject-add"));
    const typeSelect = await screen.findByTestId("subject-type");
    expect(typeSelect.value).toBe("dependent");
    // Pet-only species/breed/weight rows are hidden for the dependent default.
    expect(screen.queryByPlaceholderText("Dog, Cat, Bird…")).toBeNull();
  });

  it("does not render the Subjects section on a non-clinical preset (retail)", async () => {
    currentPreset = { label: (k) => k, industry_type: "retail" };
    render(<CustomersRedesign />);
    fireEvent.click(await screen.findByText("Jane Doe"));
    // Give the detail panel a tick to render, then assert the clinical section
    // was not mounted. The panel re-render is synchronous after the click;
    // a single microtask flush is enough.
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("subject-add")).toBeNull();
  });
});
