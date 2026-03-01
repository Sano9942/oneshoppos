/**
 * Wave C — Shopify Integration Redesign
 *
 * Strategy: ShopifyIntegration is a large, complex page with many API
 * interactions, state pieces, and tab sections (Config, Status, Sync, Mapping,
 * Events, Reconciliation).  All of that logic is battle-tested and lives in
 * ShopifyIntegration.jsx.  We wrap it in the design-system chrome so the
 * page header / shell matches every other redesigned page, without duplicating
 * any Shopify-specific code.
 */
import ShopifyIntegration from "../ShopifyIntegration";

export default function ShopifyIntegrationRedesign() {
  return (
    <div className="flex h-full flex-col">
      {/* Design-system header strip */}
      <div className="shrink-0 border-b border-(--ui-border) bg-(--ui-surface) px-6 py-4">
        <div className="flex items-center gap-3">
          {/* Shopify wordmark colour dot */}
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#96BF48]/10">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 fill-[#96BF48]"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path d="M15.337 3.27c-.01-.06-.06-.1-.12-.1-.05 0-1.1.22-1.1.22s-.72-.7-.8-.77c-.08-.08-.22-.06-.28-.04l-.38 1.18C11.52 3.7 10.69 4 10.69 4l-.43 1.29h-.86v.03c-.04 0-4.4.14-4.4.14L3.4 18.97 15.5 21l5.1-1.24L15.337 3.27zM13.1 4.11l-.95.29.73-2.22.22.05c-.01.02-.01.03 0 .04v-.04l-.01.06.01.07v.05l-.01 1.75zm-1.53.47-.26.08.3-.9.24.07-.28.75zm1.17-3.08c-.4-.15-1.02-.17-1.52 0 0-.38.27-.67.66-.67.4 0 .86.3.86.67z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-(--ui-text)">Shopify Integration</h1>
            <p className="mt-0.5 text-sm text-(--ui-text-muted)">
              Sync products, inventory, and customers between OneShop POS and Shopify.
            </p>
          </div>
        </div>
      </div>
      {/* Delegate all Shopify logic to the proven original component */}
      <div className="min-h-0 flex-1 overflow-auto">
        <ShopifyIntegration />
      </div>
    </div>
  );
}
