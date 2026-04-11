# Qryptum Contracts

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.34-blue.svg)](https://soliditylang.org)
[![Tests](https://img.shields.io/badge/Tests-133%20passing-brightgreen.svg)](test/)
[![Network](https://img.shields.io/badge/Network-Sepolia-orange.svg)](https://sepolia.etherscan.io)

Solidity smart contracts for the Qryptum protocol. Non-custodial ERC-20 privacy vaults on Ethereum L1 with three transfer modes: QryptSafe (OTP chain), QryptShield (ZK pool), and QryptAir (offline voucher).

---

## Transfer Modes

### QryptSafe (OTP Chain)
Sequential keccak256 hash chain. Each transfer consumes the next proof in the chain. Replay attacks are impossible since each proof is single-use and verified on-chain before the commit-reveal swap.

### QryptShield (ZK Pool)
Atomic unshield into a Railgun privacy pool via `unshieldToRailgun()`. Breaks the on-chain link between sender and recipient using zero-knowledge proofs.

### QryptAir (EIP-712 Voucher)
Owner signs an EIP-712 typed-data voucher offline. Recipient redeems it on-chain without the sender broadcasting a transaction. Transfer code hash verified on-chain; nonce prevents replay.

---

## Contracts

### V6 (Current)

| Contract | Description |
|---|---|
| `QryptSafeV6` | Factory: deploys `PersonalQryptSafeV6` via EIP-1167 clone |
| `PersonalQryptSafeV6` | Vault: OTP chain proof, rechargeChain, air bags isolation |
| `MockERC20` | Test token for local development |

### V5

| Contract | Description |
|---|---|
| `QryptSafe` (V5 factory) | Factory using EIP-1167 clone pattern |
| `PersonalQryptSafeV5` | Vault: bytes32 proofHash, QryptAir EIP-712, QryptShield |

### V2 to V4 (Historical)

| Contract | Description |
|---|---|
| `ShieldFactory` | V2 factory with Ownable and Pausable |
| `PersonalVault` | V2 vault using string vault proofs |
| `ShieldToken` | Non-transferable qToken (all versions) |

---

## Sepolia Deployments

### V6 (Active)

| Contract | Address |
|---|---|
| QryptSafeV6 factory | `0x04E4d410646a6c5268E003121023111e6328DA59` |
| PersonalQryptSafeV6 impl | `0x9b3F78B4abc41cf2c1C5E85F9c79789d5c99d1ca` |
| qUSDC (6 decimals) | `0x71f6fC3c252250F7602639B0D5458f8D682115d4` |

### V5 (Historical)

Deployed and verified on Sepolia via `scripts/deploy-verify-v5.js`. Superseded by V6.

### V2 (Historical)

| Contract | Address |
|---|---|
| ShieldFactory v2 | `0x0c060e880A405B1231Ce1263c6a52a272cC1cE05` |
| PersonalVault impl | `0x5A77630B5D49943f71785BC57aF37380bBea0c5e` |
| qUSDC (6 decimals) | `0xcD1569A66F01023a8587D69F3D3ad9C4DA12c3Cf` |

---

## Tests

133 tests passing across all contract suites.

| Suite | Tests | Description |
|---|---|---|
| `QryptSafeV6.test.js` | 49 | OTP sequential proofs, replay prevention, recharge, air bags, emergency withdraw |
| `ShieldFactory.test.js` | 28 | V2 factory deploy, pause, clone integrity |
| `PersonalVault.test.js` | 46 | V2 vault shield, commit, reveal, expiry |
| `QToken.test.js` | 7 | Non-transferable qToken behavior |
| `integration.test.js` | 3 | Full shield, transfer, unshield flow |

```bash
npm install
npx hardhat test
```

---

## Compile

```bash
npx hardhat compile
```

Compiler: Solidity 0.8.34 with `viaIR: true` and optimizer enabled (200 runs).

---

## Deploy

### Deploy V6 to Sepolia

```bash
cp .env.example .env
# Fill in PRIVATE_KEY and ETHERSCAN_API_KEY
npm run deploy:v6
```

Alternatively, deploy and verify in one step:

```bash
npm run deploy-verify:v6
```

### Historical Scripts

| Script | Purpose |
|---|---|
| `scripts/deploy-v4.js` | QryptAir first version |
| `scripts/deploy-v5.js` | QryptSafeV5 deployment |
| `scripts/deploy-verify-v5.js` | V5 deploy and Etherscan verify |
| `scripts/deploy-verify-v6.js` | V6 deploy and Etherscan verify |

---

## Sepolia E2E

Run the 49-scenario live E2E suite against the deployed V6 contracts:

```bash
npm run test:v6:e2e
```

Requires `PRIVATE_KEY` and `SEPOLIA_RPC_URL` in `.env`.

---

## License

MIT License. Copyright (c) 2024-2026 Qryptum.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
