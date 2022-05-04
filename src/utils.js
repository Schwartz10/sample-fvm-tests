const cbor = require("@ipld/dag-cbor");
const leb = require("leb128");
const base32Decode = require("base32-decode");
const borc = require("borc");
const blake = require("blakejs");
const BN = require("bn.js");
const { Address } = require("@glif/filecoin-address");
const { CID } = require("multiformats/cid");

const ProtocolIndicator = {
  ID: 0,
  SECP256K1: 1,
  ACTOR: 2,
  BLS: 3,
};

function getChecksum(payload) {
  const blakeCtx = blake.blake2bInit(4);
  blake.blake2bUpdate(blakeCtx, payload);
  return Buffer.from(blake.blake2bFinal(blakeCtx));
}

function serializeAddress(address) {
  let address_decoded, payload, checksum;
  const protocolIndicator = address[1];
  const protocolIndicatorByte = `0${protocolIndicator}`;
  switch (Number(protocolIndicator)) {
    case ProtocolIndicator.ID:
      if (address.length > 18) {
        throw new Error("Invalid payload length");
      }
      return Buffer.concat([
        Buffer.from(protocolIndicatorByte, "hex"),
        Buffer.from(leb.unsigned.encode(address.substr(2))),
      ]);
    case ProtocolIndicator.SECP256K1:
      address_decoded = base32Decode(address.slice(2).toUpperCase(), "RFC4648");

      payload = address_decoded.slice(0, -4);
      checksum = Buffer.from(address_decoded.slice(-4));

      if (payload.byteLength !== 20) {
        throw new Error("Invalid payload length");
      }
      break;
    case ProtocolIndicator.ACTOR:
      address_decoded = base32Decode(address.slice(2).toUpperCase(), "RFC4648");

      payload = address_decoded.slice(0, -4);
      checksum = Buffer.from(address_decoded.slice(-4));

      if (payload.byteLength !== 20) {
        throw new Error("Invalid payload length");
      }
      break;
    case ProtocolIndicator.BLS:
      address_decoded = base32Decode(address.slice(2).toUpperCase(), "RFC4648");

      payload = address_decoded.slice(0, -4);
      checksum = Buffer.from(address_decoded.slice(-4));

      if (payload.byteLength !== 48) {
        throw new Error("Invalid payload length");
      }
      break;
    default:
      throw new Error("Unknown protocol");
  }

  const bytes_address = Buffer.concat([
    Buffer.from(protocolIndicatorByte, "hex"),
    Buffer.from(payload),
  ]);

  if (getChecksum(bytes_address).toString("hex") !== checksum.toString("hex")) {
    throw new Error("Invalid checksum");
  }
  return bytes_address;
}

function deserializeAddress(addressBytes) {
  const address = new Address(addressBytes, "f");
  return address.toString();
}

function serializeTokenAmount(tokenAmount) {
  if (tokenAmount == "0") {
    return Buffer.from("");
  }
  const tokenAmountBigInt = new BN(tokenAmount, 10);
  const tokenAmountBuffer = tokenAmountBigInt.toArrayLike(
    Buffer,
    "be",
    tokenAmountBigInt.byteLength()
  );
  return Buffer.concat([Buffer.from("00", "hex"), tokenAmountBuffer]);
}

function deserializeTokenAmount(tokenAmount) {
  const tokenAmountBigInt = new BN(tokenAmount);
  return tokenAmountBigInt.toString(10);
}

function serializeCid(cid) {
  try {
    const codeCid = CID.parse(cid);
    // Needs a zero byte in front
    const codeCidBytes = new Uint8Array(codeCid.bytes.length + 1);
    codeCidBytes.set(codeCid.bytes, 1);
    return new borc.Tagged(42, codeCidBytes);
  } catch (err) {
    console.log({ err });
  }
}

function deserializeCid({ code, version, multihash, bytes }) {
  const cid = new CID(version, code, multihash, bytes);
  return { "/": cid.toString() };
}

const serializeParamsRaw = (params) => {
  return cbor.encode(
    params.reduce((accum, toSerialize) => {
      if (toSerialize.t === "String") accum.push(toSerialize.v);
      else if (toSerialize.t === "Address")
        accum.push(serializeAddress(toSerialize.v));
      else if (toSerialize.t === "TokenAmount")
        accum.push(serializeTokenAmount(toSerialize.v));

      return accum;
    }, [])
  );
};

const serializeParams = (params) => {
  const rawCbor = serializeParamsRaw(params);
  return Buffer.from(rawCbor).toString("base64");
};

const deserialize = (base64Encoded, template) => {
  const decodedState = cbor.decode(Buffer.from(base64Encoded, "base64"));
  const stateObj = template.reduce((accum, toDeserialize, i) => {
    if (toDeserialize.type === "String")
      accum[toDeserialize.key] = decodedState[i];
    else if (toDeserialize.type === "Address")
      accum[toDeserialize.key] = deserializeAddress(decodedState[i]);
    else if (toDeserialize.type === "TokenAmount")
      accum[toDeserialize.key] = deserializeTokenAmount(decodedState[i]);
    else if (toDeserialize.type === "Cid")
      accum[toDeserialize.key] = deserializeCid(decodedState[i]);

    return accum;
  }, {});

  return stateObj;
};

module.exports = {
  serializeCid,
  deserialize,
  serializeParams,
  serializeParamsRaw,
};
