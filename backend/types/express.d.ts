// Global augmentation of the Express Request type.
// This file is declaration-only — no runtime code, no imports needed.
// TypeScript picks it up automatically via tsconfig "include".

declare global {
  namespace Express {
    interface Request {
      /** Tenant database ID. Set by loadTenantAndPerms middleware. */
      tenantId?: number;

      /** Tenant URL slug (e.g. "packagesmall"). Set by resolveTenant middleware. */
      tenantSlug?: string;

      /** Authenticated employee. Set by loadTenantAndPerms after JWT decode. */
      employee?: {
        id: number;
        role_id: number;
        name?: string;
      };

      /**
       * Flat array of permission strings for the authenticated employee.
       * e.g. ["view_reports", "manage_inventory"]
       * Use requirePerm() / requireAnyPerm() middleware to check — don't read this directly in routes.
       */
      employeePerms?: string[];

      /** UUID assigned by pino-http (request-id middleware). Forwarded as X-Request-Id response header. */
      id?: string;

      /** Pino child logger enriched with tenantSlug + employeeId. Set by request-id middleware. */
      log?: {
        info: (msg: string, obj?: object) => void;
        warn: (msg: string, obj?: object) => void;
        error: (msg: string, obj?: object) => void;
        debug: (msg: string, obj?: object) => void;
      };
    }
  }
}

export {};
