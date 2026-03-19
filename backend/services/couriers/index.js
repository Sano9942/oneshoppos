const GenericAdapter = require("./generic-adapter");
const LeopardsAdapter = require("./leopards-adapter");

const ADAPTERS = {
  generic: GenericAdapter,
  leopards: LeopardsAdapter,
};

function getAdapter(adapterKey, config) {
  const AdapterClass = ADAPTERS[adapterKey] || GenericAdapter;
  return new AdapterClass(config);
}

module.exports = { getAdapter, ADAPTERS };
