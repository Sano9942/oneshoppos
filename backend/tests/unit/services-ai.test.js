/**
 * services/ai.js — unit tests. Pattern A: call the real exported functions with
 * a hand-built fake Anthropic client (no network, no key needed). Verifies
 * prompt assembly, response parsing (incl. code fences / prose wrapping), and
 * canonical-field shaping for the import pipeline.
 */
import { describe, it, expect, vi } from "vitest";
import {
  parseJsonFromText,
  generateProductContent,
  extractInvoiceLineItems,
  MODELS,
} from "../../services/ai.js";

// Build a fake client whose messages.create returns a canned text block and
// records the request so we can assert on the prompt/model.
function fakeClient(responseText) {
  const calls = [];
  return {
    calls,
    messages: {
      create: vi.fn(async (req) => {
        calls.push(req);
        return { content: [{ type: "text", text: responseText }] };
      }),
    },
  };
}

describe("parseJsonFromText", () => {
  it("parses a bare JSON object", () => {
    expect(parseJsonFromText('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses JSON wrapped in a ```json fence", () => {
    expect(parseJsonFromText('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it("parses a JSON array with leading prose", () => {
    expect(parseJsonFromText('Here you go:\n[{"x":1},{"x":2}]')).toEqual([{ x: 1 }, { x: 2 }]);
  });
  it("throws when there is no JSON", () => {
    expect(() => parseJsonFromText("sorry, no idea")).toThrow();
  });
});

describe("generateProductContent", () => {
  it("returns description + normalized tags and uses the Haiku model", async () => {
    const client = fakeClient('{"description":"A red cotton t-shirt.","tags":["Shirt","COTTON","red","  "]}');
    const out = await generateProductContent(
      { name: "Red T-Shirt", category: "Apparel", brand: "Acme" },
      { client },
    );
    expect(out.description).toBe("A red cotton t-shirt.");
    // lowercased, trimmed, blanks dropped
    expect(out.tags).toEqual(["shirt", "cotton", "red"]);
    expect(client.calls[0].model).toBe(MODELS.text);
    // the product facts made it into the prompt
    expect(client.calls[0].messages[0].content).toMatch(/Red T-Shirt/);
    expect(client.calls[0].messages[0].content).toMatch(/Apparel/);
  });

  it("throws when name is missing", async () => {
    await expect(generateProductContent({}, { client: fakeClient("{}") })).rejects.toThrow(/name/i);
  });

  it("degrades to empty tags when the model omits them", async () => {
    const client = fakeClient('{"description":"Just a description."}');
    const out = await generateProductContent({ name: "Widget" }, { client });
    expect(out.description).toBe("Just a description.");
    expect(out.tags).toEqual([]);
  });
});

describe("extractInvoiceLineItems", () => {
  it("maps line items to canonical import fields and uses the vision model", async () => {
    const client = fakeClient(
      JSON.stringify([
        { name: "Sugar 1kg", quantity: 24, unit_cost: 110, unit: "pcs", barcode: "8964000112233" },
        { name: "Tea 250g", quantity: 12, unit_cost: 300, unit: "", barcode: "" },
      ]),
    );
    const { rows } = await extractInvoiceLineItems({ imageBase64: "ZmFrZQ==", mediaType: "image/png" }, { client });
    expect(client.calls[0].model).toBe(MODELS.vision);
    // image block passed through with the given media type
    expect(client.calls[0].messages[0].content[0].source.media_type).toBe("image/png");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: "Sugar 1kg",
      cost_price: 110,
      stock_quantity: 24,
      unit: "pcs",
      barcode: "8964000112233",
    });
    // empty unit defaults to pcs
    expect(rows[1].unit).toBe("pcs");
  });

  it("drops nameless rows and coerces bad numbers to 0", async () => {
    const client = fakeClient(
      JSON.stringify([
        { name: "", quantity: 5, unit_cost: 10 },
        { name: "Real Item", quantity: "x", unit_cost: "y" },
      ]),
    );
    const { rows } = await extractInvoiceLineItems({ imageBase64: "ZmFrZQ==" }, { client });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Real Item");
    expect(rows[0].cost_price).toBe(0);
    expect(rows[0].stock_quantity).toBe(0);
  });

  it("throws when imageBase64 is missing", async () => {
    await expect(extractInvoiceLineItems({}, { client: fakeClient("[]") })).rejects.toThrow(/imageBase64/i);
  });
});
