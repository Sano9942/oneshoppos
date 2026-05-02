/**
 * Manager PIN modal helper.
 *
 * Several POS / Sales-History flows pop a Manager PIN modal:
 *  - Void sale (Sales History)
 *  - Price override at POS (when promotion blocked / over discount cap)
 *  - Discount over the cashier's allowed limit
 *  - Refund / return that exceeds policy limits
 *  - Comp / void on restaurant tab
 *
 * The modal is a 4-digit numeric pad. PIN belongs to whichever role has
 * `override_void_comp` / `override_price` / `pos_discount` permission for
 * the action — typically the admin who provisioned the tenant.
 *
 * Helper assumes the modal is already visible. Times out fast if not.
 */

const MODAL_SELECTOR = '[role="dialog"]';
const PIN_INPUT_SELECTOR =
  'input[type="password"][maxlength="4"], input[name="pin"], input[aria-label*="PIN" i]';

export async function enterManagerPin(page, pin) {
  // Wait for any modal to be visible. Keep timeout short — if no modal, the
  // caller has the wrong assumption and should fail fast.
  await page.waitForSelector(MODAL_SELECTOR, { timeout: 5000 });

  const input = page.locator(PIN_INPUT_SELECTOR).first();
  if (await input.count()) {
    await input.fill(pin);
    // Most PIN modals submit on Enter, some need a button click.
    await page.keyboard.press("Enter").catch(() => {});
    // Fallback to clicking a visible "Submit / Confirm / OK" button.
    const submit = page.getByRole("button", {
      name: /submit|confirm|ok|verify|approve/i,
    });
    if (await submit.first().isVisible({ timeout: 1000 }).catch(() => false)) {
      await submit.first().click();
    }
  } else {
    // Some PIN modals are 0-9 button pads, not a single input.
    for (const digit of pin.split("")) {
      await page
        .getByRole("button", { name: new RegExp(`^${digit}$`) })
        .first()
        .click();
    }
    const submit = page.getByRole("button", {
      name: /submit|confirm|ok|verify|approve/i,
    });
    if (await submit.first().isVisible({ timeout: 1000 }).catch(() => false)) {
      await submit.first().click();
    }
  }

  // Modal should dismiss within a couple seconds on success.
  await page
    .waitForSelector(MODAL_SELECTOR, { state: "hidden", timeout: 5000 })
    .catch(() => {
      throw new Error(
        "Manager PIN modal did not dismiss after submit — wrong PIN or backend rejected.",
      );
    });
}
