// Options for Sentry.init (index.js). Kept here so a test can use the same ones.
//
// Sentry's Anthropic wrapper is left out: it swaps the SDK's stream for its
// own object without `controller`, so client.beta.messages.stream(...)
// .finalMessage() throws "reading 'signal'" after the AI has finished (and
// been paid for). Live 2026-10-20, bill photo reader. AI errors still reach
// Sentry through the routes that catch them.
function sentryOptions(env = process.env) {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV || "development",
    tracesSampleRate: 0, // No tracing — we use our own request timing
    integrations: (defaults) => defaults.filter((i) => i.name !== "Anthropic_AI"),
  };
}

module.exports = { sentryOptions };
