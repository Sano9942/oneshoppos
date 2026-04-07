const GenericAdapter = require("./generic-adapter");
const LeopardsAdapter = require("./leopards-adapter");
const TCSAdapter = require("./tcs-adapter");
const BlueExAdapter = require("./blueex-adapter");
const TraxAdapter = require("./trax-adapter");

const ADAPTERS = {
  generic: GenericAdapter,
  leopards: LeopardsAdapter,
  tcs: TCSAdapter,
  blueex: BlueExAdapter,
  trax: TraxAdapter,
};

function getAdapter(adapterKey, config) {
  const AdapterClass = ADAPTERS[adapterKey] || GenericAdapter;
  return new AdapterClass(config);
}

module.exports = { getAdapter, ADAPTERS };
