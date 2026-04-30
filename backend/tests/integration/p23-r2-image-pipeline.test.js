/**
 * P23 — R2 image pipeline must work under Vercel-frontend / Railway-backend split host.
 *
 * Two compounding bugs found in production walkthrough 2026-04-30:
 *
 * (a) `backend/utils/r2.js` returned a relative path `/r2/<key>` when R2_PUBLIC_URL
 *     was unset. The frontend at sanopos.com (Vercel) resolves that against itself,
 *     so the request never reaches the backend at api.sanopos.com (Railway). Vercel
 *     returns its SPA shell HTML and the <img> fails to decode (naturalWidth=0).
 *
 * (b) `backend/index.js` registered `/r2/*key` as the proxy route. In Express 5 the
 *     named-wildcard `*key` puts the matched segments in req.params.key as an ARRAY
 *     ["products", "product_x.webp"], not a string. Sending the array as Key to
 *     GetObjectCommand fails inside the AWS SDK and the catch block returns 404.
 *
 * Fix:
 * - r2.js returns an absolute URL: prefer R2_PUBLIC_URL, else APP_PUBLIC_BASE_URL,
 *   else throw at upload time so ops sees the misconfig immediately. No more
 *   relative `/r2/<key>` that breaks under split-host.
 * - index.js joins req.params.key when it's an array before sending to S3.
 */
const path = require("path");

describe("P23 — R2 image pipeline", () => {
  describe("utils/r2.js URL builder", () => {
    let savedEnv;

    beforeEach(() => {
      // Snapshot env vars we mutate
      savedEnv = {
        R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
        R2_BUCKET: process.env.R2_BUCKET,
        R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
        APP_PUBLIC_BASE_URL: process.env.APP_PUBLIC_BASE_URL,
      };
      // Drop the cached r2.js module so it re-reads env on next require
      delete require.cache[require.resolve("../../utils/r2")];
    });

    afterEach(() => {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      delete require.cache[require.resolve("../../utils/r2")];
    });

    test("returns absolute URL using R2_PUBLIC_URL when set", async () => {
      process.env.R2_ACCOUNT_ID = "abc";
      process.env.R2_ACCESS_KEY_ID = "k";
      process.env.R2_SECRET_ACCESS_KEY = "s";
      process.env.R2_BUCKET = "test-bucket";
      process.env.R2_PUBLIC_URL = "https://cdn.example.com";
      delete process.env.APP_PUBLIC_BASE_URL;

      const { uploadToR2 } = require("../../utils/r2");
      // Stub the S3Client.send so PutObject doesn't actually fire
      const r2Module = require("../../utils/r2");
      r2Module.r2.send = async () => ({});

      const url = await uploadToR2(Buffer.from("x"), "products/test.webp", "image/webp");
      expect(url).toBe("https://cdn.example.com/products/test.webp");
    });

    test("returns absolute URL using APP_PUBLIC_BASE_URL when R2_PUBLIC_URL absent", async () => {
      process.env.R2_ACCOUNT_ID = "abc";
      process.env.R2_ACCESS_KEY_ID = "k";
      process.env.R2_SECRET_ACCESS_KEY = "s";
      process.env.R2_BUCKET = "test-bucket";
      delete process.env.R2_PUBLIC_URL;
      process.env.APP_PUBLIC_BASE_URL = "https://api.sanopos.com";

      const { uploadToR2, r2 } = require("../../utils/r2");
      r2.send = async () => ({});

      const url = await uploadToR2(Buffer.from("x"), "products/test.webp", "image/webp");
      expect(url).toBe("https://api.sanopos.com/r2/products/test.webp");
    });

    test("does NOT return relative /r2/<key> when both URL env vars unset (split-host trap)", async () => {
      process.env.R2_ACCOUNT_ID = "abc";
      process.env.R2_ACCESS_KEY_ID = "k";
      process.env.R2_SECRET_ACCESS_KEY = "s";
      process.env.R2_BUCKET = "test-bucket";
      delete process.env.R2_PUBLIC_URL;
      delete process.env.APP_PUBLIC_BASE_URL;

      const { uploadToR2, r2 } = require("../../utils/r2");
      r2.send = async () => ({});

      // The pre-fix code returned `/r2/${key}` here. Post-fix must throw
      // (fail loudly) so ops notices the misconfig instead of silently
      // serving broken images.
      await expect(
        uploadToR2(Buffer.from("x"), "products/test.webp", "image/webp")
      ).rejects.toThrow(/R2_PUBLIC_URL.*APP_PUBLIC_BASE_URL/i);
    });

    test("trims trailing slash from R2_PUBLIC_URL", async () => {
      process.env.R2_ACCOUNT_ID = "abc";
      process.env.R2_ACCESS_KEY_ID = "k";
      process.env.R2_SECRET_ACCESS_KEY = "s";
      process.env.R2_BUCKET = "test-bucket";
      process.env.R2_PUBLIC_URL = "https://cdn.example.com/";

      const { uploadToR2, r2 } = require("../../utils/r2");
      r2.send = async () => ({});

      const url = await uploadToR2(Buffer.from("x"), "products/test.webp", "image/webp");
      expect(url).toBe("https://cdn.example.com/products/test.webp");
    });

    test("trims trailing slash from APP_PUBLIC_BASE_URL", async () => {
      process.env.R2_ACCOUNT_ID = "abc";
      process.env.R2_ACCESS_KEY_ID = "k";
      process.env.R2_SECRET_ACCESS_KEY = "s";
      process.env.R2_BUCKET = "test-bucket";
      delete process.env.R2_PUBLIC_URL;
      process.env.APP_PUBLIC_BASE_URL = "https://api.sanopos.com/";

      const { uploadToR2, r2 } = require("../../utils/r2");
      r2.send = async () => ({});

      const url = await uploadToR2(Buffer.from("x"), "products/test.webp", "image/webp");
      expect(url).toBe("https://api.sanopos.com/r2/products/test.webp");
    });

    test("local-fallback path remains for missing R2 credentials", async () => {
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;

      const { uploadToR2 } = require("../../utils/r2");
      // No need to stub r2 (it's null without creds)

      const fs = require("fs");
      const url = await uploadToR2(Buffer.from("x"), "products/test_local.webp", "image/webp");
      expect(url).toBe("exports/products/test_local.webp");
      // Cleanup the file the helper just wrote
      const written = path.join(__dirname, "..", "..", "exports", "products", "test_local.webp");
      try { fs.unlinkSync(written); } catch (_) {}
    });
  });

  describe("/r2/*key proxy in Express 5", () => {
    test("forwards a string Key (not array) to S3 GetObjectCommand", async () => {
      const express = require("express");
      const app = express();
      const sentKeys = [];
      // Stub r2 client capturing the Key it would request
      const stubR2 = {
        send: async (cmd) => {
          sentKeys.push(cmd.input.Key);
          return {
            ContentType: "image/webp",
            Body: { pipe: (res) => res.end(Buffer.from("ok")) },
          };
        },
      };

      // Mount the same proxy logic as backend/index.js but with stubbed r2
      const { GetObjectCommand } = require("@aws-sdk/client-s3");
      app.get("/r2/*key", async (req, res) => {
        const raw = req.params.key;
        const key = Array.isArray(raw) ? raw.join("/") : raw;
        try {
          const data = await stubR2.send(new GetObjectCommand({ Bucket: "x", Key: key }));
          res.setHeader("Content-Type", data.ContentType || "application/octet-stream");
          data.Body.pipe(res);
        } catch (err) {
          res.status(404).json({ error: "Not found" });
        }
      });

      await new Promise((resolve, reject) => {
        const server = app.listen(0, async () => {
          try {
            const port = server.address().port;
            const http = require("http");
            const got = await new Promise((res2) => {
              http.get(`http://127.0.0.1:${port}/r2/products/product_xyz.webp`, (r) => {
                const chunks = [];
                r.on("data", (c) => chunks.push(c));
                r.on("end", () => res2({ status: r.statusCode, body: Buffer.concat(chunks).toString() }));
              });
            });
            expect(got.status).toBe(200);
            expect(got.body).toBe("ok");
            // The critical assertion: S3 must receive a string, not an array.
            expect(sentKeys).toEqual(["products/product_xyz.webp"]);
            server.close(resolve);
          } catch (e) {
            server.close(() => reject(e));
          }
        });
      });
    });

    test("preserves nested-path keys with multiple slashes", async () => {
      const express = require("express");
      const app = express();
      const sentKeys = [];
      const stubR2 = {
        send: async (cmd) => {
          sentKeys.push(cmd.input.Key);
          return { ContentType: "image/png", Body: { pipe: (res) => res.end("") } };
        },
      };
      const { GetObjectCommand } = require("@aws-sdk/client-s3");
      app.get("/r2/*key", async (req, res) => {
        const raw = req.params.key;
        const key = Array.isArray(raw) ? raw.join("/") : raw;
        try {
          const data = await stubR2.send(new GetObjectCommand({ Bucket: "x", Key: key }));
          res.setHeader("Content-Type", data.ContentType);
          data.Body.pipe(res);
        } catch (err) {
          res.status(404).json({ error: "Not found" });
        }
      });

      await new Promise((resolve, reject) => {
        const server = app.listen(0, async () => {
          try {
            const port = server.address().port;
            const http = require("http");
            await new Promise((res2) => {
              http.get(`http://127.0.0.1:${port}/r2/consents/42/sig_x.png`, (r) => {
                r.on("data", () => {});
                r.on("end", () => res2());
              });
            });
            expect(sentKeys).toEqual(["consents/42/sig_x.png"]);
            server.close(resolve);
          } catch (e) {
            server.close(() => reject(e));
          }
        });
      });
    });
  });
});
