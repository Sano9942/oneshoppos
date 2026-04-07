const GenericAdapter = require("./generic-adapter");
const LeopardsAdapter = require("./leopards-adapter");
const TCSAdapter = require("./tcs-adapter");
const BlueExAdapter = require("./blueex-adapter");
const TraxAdapter = require("./trax-adapter");
const CallCourierAdapter = require("./callcourier-adapter");
const MnPAdapter = require("./mnp-adapter");
const PostExAdapter = require("./postex-adapter");
const RiderAdapter = require("./rider-adapter");
const SwyftAdapter = require("./swyft-adapter");
const BykeaAdapter = require("./bykea-adapter");

const ADAPTERS = {
  generic: GenericAdapter,
  leopards: LeopardsAdapter,
  tcs: TCSAdapter,
  blueex: BlueExAdapter,
  trax: TraxAdapter,
  callcourier: CallCourierAdapter,
  mnp: MnPAdapter,
  postex: PostExAdapter,
  rider: RiderAdapter,
  swyft: SwyftAdapter,
  bykea: BykeaAdapter,
};

function getAdapter(adapterKey, config) {
  const AdapterClass = ADAPTERS[adapterKey] || GenericAdapter;
  return new AdapterClass(config);
}

module.exports = { getAdapter, ADAPTERS };
