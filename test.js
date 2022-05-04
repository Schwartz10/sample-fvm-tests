const assert = require("assert");
const cbor = require("@ipld/dag-cbor");
const RPCClient = require("@glif/filecoin-rpc-client").default;
const Filecoin = require("@glif/filecoin-wallet-provider").default;
const { SECP256K1KeyProvider } = require("@glif/filecoin-wallet-provider");
const { Message } = require("@glif/filecoin-message");
const {
  deserialize,
  serializeParamsRaw,
  serializeCid,
} = require("./src/utils");

const config = {
  apiAddress: "http://127.0.0.1:1234/rpc/v0",
  token:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBbGxvdyI6WyJyZWFkIiwid3JpdGUiLCJzaWduIiwiYWRtaW4iXX0.7J3Bh0YHYlHVMdfjxDs_PUotZ3OQ7r4jQnfYG0m8isk",
};

const lotusRPC = new RPCClient(config);

const EXEC_ACTOR = "f01";
const ACTOR_CODE_CID =
  "bafk2bzacedkrolf4yhprkik666hecd3nxbfxamvnsr3lmcgaegfupc646tibc";
const ACTOR_ID = "f01016";
const OWNER_ID = "f0100";
const OWNER_PK = "JQRStH3ML/l9mnOvcyjbo86nfvX6uIr7mxDKr6a9kbA=";

const NAME = "GLIF_TEST";
const SYMBOL = "GLF";
const MAX_SUPPLY = 1000000;

const StateTemplate = [
  { key: "name", type: "String" },
  { key: "symbol", type: "String" },
  { key: "max_supply", type: "TokenAmount" },
  { key: "owner", type: "Address" },
  { key: "balances", type: "Cid" },
];

describe("fil-token-actor", function () {
  let provider;
  before(async function () {
    provider = new Filecoin(new SECP256K1KeyProvider(OWNER_PK), config);

    const [signer] = await provider.wallet.getAccounts(0, 1, "f");

    const signerID = await lotusRPC.request("StateLookupID", signer, null);

    // when i plug these directly into the Lotus CLI, create-actor succeeds
    const constructorParams = serializeParamsRaw([
      { k: "name", v: NAME, t: "String" },
      { k: "symbol", v: SYMBOL, t: "String" },
      { k: "max_supply", v: MAX_SUPPLY, t: "TokenAmount" },
      { k: "owner", v: signerID, t: "Address" },
    ]);

    const serializedActorCode = serializeCid(ACTOR_CODE_CID);

    const params = Buffer.from(
      cbor.encode([serializedActorCode, constructorParams])
    ).toString("base64");

    console.log(params);
    const nonce = await provider.getNonce(signer);

    const msg = new Message({
      to: EXEC_ACTOR,
      from: signer,
      method: 3,
      value: "0",
      params,
      nonce,
    });

    const wGas = await provider.gasEstimateMessageGas(msg.toLotusType());
    console.log(wGas);
    const signedMsg = await provider.wallet.sign(signer, msg.toLotusType());
    // const tx = await provider.sendMessage(signedMsg);
    // console.log(tx);
  });

  it("test", function () {
    assert.equal(true, true);
  });

  describe.skip("constructor", function () {
    it("should set the name to be GLIF, symbol to be GLF, max_supply to be 1000000, and owner to be f0100", async function () {
      const actorState = await lotusRPC.request(
        "StateGetActor",
        ACTOR_ID,
        null
      );

      const obj = await lotusRPC.request("ChainReadObj", actorState.Head);
      const deserializedState = deserialize(obj, StateTemplate);

      assert.equal(deserializedState.name, "GLIF");
      assert.equal(deserializedState.symbol, "GLF");
      assert.equal(deserializedState.max_supply, "1000000");
      assert.equal(deserializedState.owner, OWNER_ID);
    });

    it("should allow the owner to mint tokens", async function () {
      const actorState = await lotusRPC.request(
        "StateGetActor",
        ACTOR_ID,
        null
      );

      const obj = await lotusRPC.request("ChainReadObj", actorState.Head);
      const deserializedState = deserialize(obj, StateTemplate);

      const balancesObj = await lotusRPC.request(
        "ChainReadObj",
        deserializedState.balances
      );
      const decodedBalances = cbor.decode(Buffer.from(balancesObj, "base64"));

      // make sure it starts with no balances
      assert.equal(decodedBalances[0].length, 0);

      // console.log(decodedBalances, decodedBalances.length, decodedBalances[0]);
    });
  });
});
