# Pharos Contract Reader

A minimal Node.js command-line client for the Pharos Agent Arena **Read Contract State** task. It connects to the official Pharos Chain MCP server over Streamable HTTP and reads ERC-20 state at one explicit block.

All blockchain access goes through MCP tools. The application does not connect to a JSON-RPC endpoint directly and has no RPC fallback.

## What it reads

For the supplied contract address, the CLI:

1. Connects to `https://mcp.pharos.xyz/mcp` with the official Model Context Protocol TypeScript SDK.
2. Gets the Pharos network information and latest block number.
3. Calls `get_code` at that block and rejects addresses without contract bytecode.
4. Calls `name()`, `symbol()`, `decimals()`, and `totalSupply()` through the MCP `eth_call` tool at the same block.
5. ABI-decodes the results and formats `totalSupply` with `BigInt` arithmetic.

## Selected mainnet contract

- Token: USDC
- Network: Pharos mainnet
- Chain ID: `1672`
- Contract: `0xC879C018dB60520F4355C26eD1a6D572cdAC1815`
- Official source: [PharosNetwork/Token-List — tokenlist.json](https://github.com/PharosNetwork/Token-List/blob/main/tokenlist.json)
- MCP server source: [PharosNetwork/pharos-mcp](https://github.com/PharosNetwork/pharos-mcp)

The official token list identifies this address as an ERC-20 contract on chain `1672`. Native PROS is not used as the example contract.

## Requirements

- Node.js 20 or newer
- npm
- Network access to `https://mcp.pharos.xyz/mcp`

No wallet, private key, RPC URL, or API key is required.

## Install

```bash
npm install
```

## Run

Pass any deployed ERC-20 address on Pharos mainnet:

```bash
npm start -- 0xC879C018dB60520F4355C26eD1a6D572cdAC1815
```

The CLI exits with a clear error for a missing or invalid address, missing bytecode at the pinned block, unavailable required MCP tools, or failed contract calls.

## Recorded successful output snapshot

Captured from a successful live run through Pharos MCP on 2026-10-13. This is a historical snapshot at block `20166241`, not the contract's current supply:

```text
Network: Pharos
Chain ID: 1672
Contract: 0xC879C018dB60520F4355C26eD1a6D572cdAC1815
Block: 20166241
Name: USDC
Symbol: USDC
Decimals: 6
Total supply: 18093728.134024 USDC
Total supply (raw): 18093728134024
```

`totalSupply()` is decoded as a JavaScript `BigInt`; it is never converted to a JavaScript `Number`.
