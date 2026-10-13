#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = "https://mcp.pharos.xyz/mcp";
const REQUIRED_TOOLS = [
  "get_chain_info",
  "get_block_number",
  "get_code",
  "eth_call",
];

const ERC20_CALLS = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
};

function usage() {
  return "Usage: npm start -- <erc20-contract-address>";
}

function requireAddress(value) {
  if (!value) {
    throw new Error(`Missing contract address.\n${usage()}`);
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid EVM address: ${value}`);
  }

  return value;
}

function textPayload(result, toolName) {
  if (result.isError) {
    const detail = result.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    throw new Error(`${toolName} failed${detail ? `: ${detail}` : ""}`);
  }

  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error(`${toolName} returned no text result`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${toolName} returned invalid JSON: ${error.message}`);
  }
}

async function callJson(client, name, args = {}) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return textPayload(result, name);
  } catch (error) {
    throw new Error(`${name} call failed: ${error.message}`, { cause: error });
  }
}

function requireHex(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} returned invalid hex data`);
  }
  return value;
}

function hexBytes(value, label) {
  const hex = requireHex(value, label).slice(2);
  if (hex.length % 2 !== 0) {
    throw new Error(`${label} returned odd-length hex data`);
  }
  return Buffer.from(hex, "hex");
}

function wordToBigInt(bytes, offset, label) {
  if (offset < 0 || offset + 32 > bytes.length) {
    throw new Error(`${label} returned truncated ABI data`);
  }
  return BigInt(`0x${bytes.subarray(offset, offset + 32).toString("hex")}`);
}

function decodeAbiString(value, label) {
  const bytes = hexBytes(value, label);
  if (bytes.length < 32) {
    throw new Error(`${label} returned less than one ABI word`);
  }

  const offset = wordToBigInt(bytes, 0, label);
  if (offset <= BigInt(Number.MAX_SAFE_INTEGER)) {
    const start = Number(offset);
    if (start % 32 === 0 && start + 32 <= bytes.length) {
      const length = wordToBigInt(bytes, start, label);
      if (length > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${label} returned an unsupported string length`);
      }
      const lengthNumber = Number(length);
      const dataStart = start + 32;
      const dataEnd = dataStart + lengthNumber;
      if (dataEnd > bytes.length) {
        throw new Error(`${label} returned truncated string data`);
      }
      return bytes.subarray(dataStart, dataEnd).toString("utf8");
    }
  }

  // Some older ERC-20 contracts return bytes32 instead of ABI string.
  const zero = bytes.subarray(0, 32).indexOf(0);
  const end = zero === -1 ? 32 : zero;
  const decoded = bytes.subarray(0, end).toString("utf8");
  if (!decoded) {
    throw new Error(`${label} returned an empty or unsupported string`);
  }
  return decoded;
}

function decodeUint(value, label) {
  const bytes = hexBytes(value, label);
  if (bytes.length < 32) {
    throw new Error(`${label} returned less than one ABI word`);
  }
  return wordToBigInt(bytes, 0, label);
}

function formatUnits(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const remainder = value % base;

  if (remainder === 0n) {
    return whole.toString();
  }

  const fraction = remainder
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${whole}.${fraction}`;
}

async function main() {
  const address = requireAddress(process.argv[2]);
  const client = new Client({
    name: "pharos-contract-reader",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  let connected = false;

  try {
    await client.connect(transport);
    connected = true;

    const { tools } = await client.listTools();
    const available = new Set(tools.map((tool) => tool.name));
    const missing = REQUIRED_TOOLS.filter((tool) => !available.has(tool));
    if (missing.length > 0) {
      throw new Error(`Pharos MCP is missing required tools: ${missing.join(", ")}`);
    }

    const [chain, latest] = await Promise.all([
      callJson(client, "get_chain_info"),
      callJson(client, "get_block_number"),
    ]);

    const blockNumber = latest.blockNumber;
    if (chain.chainId !== 1672) {
      throw new Error(`Expected Pharos chain ID 1672, received ${chain.chainId}`);
    }
    if (!/^[0-9]+$/.test(blockNumber)) {
      throw new Error("get_block_number returned an invalid block number");
    }

    const code = await callJson(client, "get_code", {
      address,
      block: blockNumber,
    });
    const bytecode = requireHex(code.code, "get_code");
    if (bytecode === "0x" || /^0x0*$/.test(bytecode)) {
      throw new Error(
        `No contract bytecode found at ${address} at block ${blockNumber}`,
      );
    }

    const entries = await Promise.all(
      Object.entries(ERC20_CALLS).map(async ([field, data]) => {
        const response = await callJson(client, "eth_call", {
          transaction: { to: address, data },
          block: blockNumber,
        });
        return [field, requireHex(response.result, `eth_call ${field}()`)];
      }),
    );
    const raw = Object.fromEntries(entries);

    const name = decodeAbiString(raw.name, "name()");
    const symbol = decodeAbiString(raw.symbol, "symbol()");
    const decimalsBigInt = decodeUint(raw.decimals, "decimals()");
    if (decimalsBigInt > 255n) {
      throw new Error(`decimals() returned an invalid value: ${decimalsBigInt}`);
    }
    const decimals = Number(decimalsBigInt);
    const totalSupplyRaw = decodeUint(raw.totalSupply, "totalSupply()");

    console.log(`Network: ${chain.name}`);
    console.log(`Chain ID: ${chain.chainId}`);
    console.log(`Contract: ${address}`);
    console.log(`Block: ${blockNumber}`);
    console.log(`Name: ${name}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Decimals: ${decimals}`);
    console.log(`Total supply: ${formatUnits(totalSupplyRaw, decimals)} ${symbol}`);
    console.log(`Total supply (raw): ${totalSupplyRaw}`);
  } finally {
    if (connected) {
      try {
        await transport.terminateSession();
      } catch {
        // The hosted service may already have closed or moved the session.
      }
      await client.close();
    }
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
