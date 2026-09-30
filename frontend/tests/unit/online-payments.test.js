// One Toy Store pilot F2 (D52): the till's Online button saves a payment as
// "Online - <choice>". The receipt must print that name as saved; the old
// label formatter lower-cased the rest of each word ("Online - jazzcash").
import { describe, it, expect } from "vitest";
import { formatPaymentMethodLabel } from "../../src/utils/receipt";
import {
  DEFAULT_ONLINE_OPTIONS,
  isOnlineMethod,
  onlineChoiceOf,
  onlineMethodName,
} from "../../src/utils/onlinePayments";

describe("F2 — Online payment names", () => {
  it("the owner's 7 choices, in the owner's order", () => {
    expect(DEFAULT_ONLINE_OPTIONS).toEqual(["EasyPaisa", "JazzCash", "Allied", "Meezan", "MCB", "HBL", "Alfalah"]);
  });

  it("builds and reads back the saved name", () => {
    expect(onlineMethodName("JazzCash")).toBe("Online - JazzCash");
    expect(isOnlineMethod("Online - MCB")).toBe(true);
    expect(onlineChoiceOf("Online - MCB")).toBe("MCB");
    expect(isOnlineMethod("Card")).toBe(false);
    expect(isOnlineMethod("Online Store")).toBe(false);
    expect(onlineChoiceOf("Cash")).toBe(null);
  });
});

describe("F2 — receipt payment labels", () => {
  it("prints an Online choice exactly as saved", () => {
    expect(formatPaymentMethodLabel("Online - JazzCash")).toBe("Online - JazzCash");
    expect(formatPaymentMethodLabel("Online - EasyPaisa")).toBe("Online - EasyPaisa");
    expect(formatPaymentMethodLabel("Online - MCB")).toBe("Online - MCB");
  });

  it("keeps other pretty names as they are", () => {
    expect(formatPaymentMethodLabel("Return Credit")).toBe("Return Credit");
    expect(formatPaymentMethodLabel("Cash")).toBe("Cash");
  });

  it("still tidies machine ids", () => {
    expect(formatPaymentMethodLabel("gift_card")).toBe("Gift Card");
    expect(formatPaymentMethodLabel("charge_to_room")).toBe("Charge To Room");
  });
});
