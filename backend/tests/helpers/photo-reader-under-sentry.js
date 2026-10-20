// Run in its own node process by tests/unit/ots-photo-reader-sentry.test.js.
// Sets Sentry up the way index.js does on the live server (a DSN is set),
// then reads a "photo" through the real photo reader against a fake AI
// server that streams back a tiny bill. Prints OK or FAIL <message>.
const http = require("http");
const path = require("path");

const Sentry = require("@sentry/node");
const { sentryOptions } = require(path.join(__dirname, "../../services/sentry-options"));
Sentry.init(sentryOptions({ SENTRY_DSN: "https://abc@o1.ingest.sentry.io/1", NODE_ENV: "test" }));

const bill = JSON.stringify({ supplier_name: null, bill_number: "171", bill_date: null, total: 10, lines: [] });
const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const server = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })
      + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } })
      + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: bill } })
      + ev("content_block_stop", { index: 0 })
      + ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } })
      + ev("message_stop", {}));
  });
});

server.listen(0, "127.0.0.1", async () => {
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const { readBillPhotos } = require(path.join(__dirname, "../../services/bill-readers/photo-reader"));
  let out;
  try {
    const r = await readBillPhotos([{ buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: "image/jpeg", file_name: "a.jpg" }]);
    out = `OK ${r.bill_number}`;
  } catch (err) {
    out = `FAIL ${err.message}`;
  }
  console.log(out);
  server.close();
  await Sentry.close(100);
  process.exit(0);
});
