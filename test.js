const assert = require("assert");
const cbor = require("@ipld/dag-cbor");
const RPCClient = require("@glif/filecoin-rpc-client").default;
const Filecoin = require("@glif/filecoin-wallet-provider").default;
const { SECP256K1KeyProvider } = require("@glif/filecoin-wallet-provider");
const { Message } = require("@glif/filecoin-message");
const confirmMessage = require("@glif/filecoin-message-confirmer").default;
const {
  deserialize,
  serializeParams,
  serializeParamsRaw,
  serializeCid,
  deserializeAddress,
} = require("./src/utils");

const config = {
  apiAddress: "http://127.0.0.1:1234/rpc/v0",
  token:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBbGxvdyI6WyJyZWFkIiwid3JpdGUiLCJzaWduIiwiYWRtaW4iXX0.6faf8aAtaSpf_xsXhdXbH9LRDkBxKMqvixud_l-hoyE",
};

const lotusRPC = new RPCClient(config);

const EXEC_ACTOR = "f01";
const ACTOR_CODE_CID =
  "bafk2bzacec7zcunm3nkh3xn24a7golnnxdu54wukwwdll267ejbmykspd67og";
const OWNER_PK = "JQRStH3ML/l9mnOvcyjbo86nfvX6uIr7mxDKr6a9kbA=";

const NAME = "GLIF_TEST";
const SYMBOL = "GLF";
const MAX_SUPPLY = "1000000";

const StateTemplate = [
  { key: "name", type: "String" },
  { key: "symbol", type: "String" },
  { key: "max_supply", type: "TokenAmount" },
  { key: "owner", type: "Address" },
  { key: "balances", type: "Cid" },
];

const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

const getBalance = async (cid, id) => {
  const balancesObj = await lotusRPC.request("ChainReadObj", cid);
  const decodedBalances = cbor.decode(Buffer.from(balancesObj, "base64"));
  const hamt = decodedBalances[1][0][0];
  const [actorID, bal] = hamt;
  return { actorID, balance: bal["1"] };
};

describe("fil-token-actor", function () {
  let provider;
  let signer, signerID, actorID, actorRobust;
  before(async function () {
    this.timeout(100000);
    console.log("Creating actor instance from: ", ACTOR_CODE_CID);
    provider = new Filecoin(new SECP256K1KeyProvider(OWNER_PK), config);

    [signer] = await provider.wallet.getAccounts(0, 1, "f");
    signerID = await lotusRPC.request("StateLookupID", signer, null);
    const constructorParams = serializeParamsRaw([
      { k: "name", v: NAME, t: "String" },
      { k: "symbol", v: SYMBOL, t: "String" },
      { k: "max_supply", v: MAX_SUPPLY, t: "TokenAmount" },
      { k: "owner", v: signerID, t: "Address" },
    ]);

    // serialize ExecParams...
    const serializedActorCode = serializeCid(ACTOR_CODE_CID);
    const params = Buffer.from(
      cbor.encode([serializedActorCode, constructorParams])
    ).toString("base64");

    const nonce = await provider.getNonce(signer);

    const msg = new Message({
      to: EXEC_ACTOR,
      from: signer,
      method: 2,
      value: "0",
      params,
      nonce,
    });

    const wGas = await provider.gasEstimateMessageGas(msg.toLotusType());
    const signedMsg = await provider.wallet.sign(signer, wGas.toLotusType());
    const tx = await provider.sendMessage(signedMsg);
    console.log("Transaction submitted, confirming... ", tx["/"]);

    await sleep(90000);
    const confirmed = await confirmMessage(tx["/"], config);
    if (!confirmed) throw new Error("Error creating actor");

    const exit = await lotusRPC.request("StateSearchMsg", tx);
    const [cborBytesID, cborBytesRobust] = cbor.decode(
      Buffer.from(exit.Receipt.Return, "base64")
    );
    actorID = deserializeAddress(cborBytesID);
    actorRobust = deserializeAddress(cborBytesRobust);

    console.log(
      "Successfully created actor, robust: ",
      actorRobust,
      " id: ",
      actorID
    );
  });

  describe("constructor", function () {
    it("should set the name to be GLIF, symbol to be GLF, max_supply to be 1000000, and owner to be f0100", async function () {
      const actorState = await lotusRPC.request(
        "StateGetActor",
        ACTOR_ID,
        null
      );

      const obj = await lotusRPC.request("ChainReadObj", actorState.Head);
      const deserializedState = deserialize(obj, StateTemplate);

      assert.equal(deserializedState.name, NAME);
      assert.equal(deserializedState.symbol, SYMBOL);
      assert.equal(deserializedState.max_supply, MAX_SUPPLY);
      assert.equal(deserializedState.owner.slice(1), signerID.slice(1));
    });

    it("should allow the owner to mint tokens", async function (done) {
      const actorState = await lotusRPC.request(
        "StateGetActor",
        ACTOR_ID,
        null
      );

      const obj = await lotusRPC.request("ChainReadObj", actorState.Head);
      const deserializedState = deserialize(obj, StateTemplate);
      const { balance: preBalance } = await getBalance(
        deserializedState.balances,
        signerID
      );
      console.log("ActorID: ", signerID, " Balance: ", preBalance);

      const params = serializeParams([
        { k: "recipient", v: signerID, t: "Address" },
        { k: "amount", v: "1", t: "TokenAmount" },
      ]);

      const nonce = await provider.getNonce(signer);

      const msg = new Message({
        to: ACTOR_ID,
        from: signer,
        method: 2,
        value: "0",
        params,
        nonce,
      });

      const wGas = await provider.gasEstimateMessageGas(msg.toLotusType());
      const signedMsg = await provider.wallet.sign(signer, wGas.toLotusType());
      // const tx = await provider.sendMessage(signedMsg);
      // console.log("Transaction hash: ", tx["/"]);

      // const confirmed = await confirmMessage(tx["/"], config);

      // assert.equal(confirmed, true);
      // const { balance: postBalance } = await getBalance(
      //   deserializedState.balances,
      //   signerID
      // );

      // assert.equal(postBalance - preBalance, 1);

      // done();
    });
  });
});
