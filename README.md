# Qryptum Contracts

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.34-blue.svg)](https://soliditylang.org)
[![Tests](https://img.shields.io/badge/Tests-169%20passing-brightgreen.svg)](test/)
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

### V3

| Contract | Description |
|---|---|
| `QryptSafeV3` | Factory: EIP-1167 clone, no Ownable, MINIMUM_SHIELD_AMOUNT constant |
| `PersonalQryptSafeV3` | Vault: changeVaultProof(), metaTransfer() EIP-712, zero admin keys |

### V2

| Contract | Description |
|---|---|
| `QryptSafeV2` | Factory: EIP-1167 clone, Ownable, setMinShieldAmount() |
| `PersonalQryptSafeV2` | Vault: commit-reveal, SafeERC20, nonce deduplication |
| `ShieldToken` | Non-transferable qToken (all versions) |

### V1

| Contract | Description |
|---|---|
| `ShieldFactory` | Genesis factory: Ownable + Pausable, deploys PersonalVault clones |
| `PersonalVault` | Genesis vault: string vault proofs, basic commit-reveal |

---

## Sepolia Deployments

### V6 (Active)

| Contract | Address |
|---|---|
| QryptSafeV6 factory | `0x04E4d410646a6c5268E003121023111e6328DA59` |
| PersonalQryptSafeV6 impl | `0x9b3F78B4abc41cf2c1C5E85F9c79789d5c99d1ca` |
| qUSDC (6 decimals) | `0x71f6fC3c252250F7602639B0D5458f8D682115d4` |

### V3 (Superseded)

Deployed and MIT-verified on Sepolia. Superseded by V4+.

| Contract | Address |
|---|---|
| QryptSafeV3 factory | [`0x88E8eAFafc99E83e687BCAbD53F783a92e51F75c`](https://sepolia.etherscan.io/address/0x88E8eAFafc99E83e687BCAbD53F783a92e51F75c) |
| PersonalQryptSafeV3 impl | [`0xaf2E91CDc70e81fA74b9aE9C322e8302bb51715e`](https://sepolia.etherscan.io/address/0xaf2E91CDc70e81fA74b9aE9C322e8302bb51715e) |
| VaultA (test clone) | [`0xA4f55574a666919cab62b23A11923f999dB1384a`](https://sepolia.etherscan.io/address/0xA4f55574a666919cab62b23A11923f999dB1384a) |
| qUSDC (6 decimals) | [`0xba89d6e805Af537aA61BA4437A0C781CD17B5637`](https://sepolia.etherscan.io/address/0xba89d6e805Af537aA61BA4437A0C781CD17B5637) |

### V2 (Historical)

Deployed and MIT-verified on Sepolia. Superseded by V3+.

| Contract | Address |
|---|---|
| QryptSafeV2 factory | [`0x26BAb8B6e88201ad4824ea1290a7C9c7b9B10fCf`](https://sepolia.etherscan.io/address/0x26BAb8B6e88201ad4824ea1290a7C9c7b9B10fCf) |
| PersonalQryptSafeV2 impl | [`0x675f70646713D4026612c673E644C61ae3aa7725`](https://sepolia.etherscan.io/address/0x675f70646713D4026612c673E644C61ae3aa7725) |

### V1 (Historical)

Deployed and MIT-verified on Sepolia. Superseded by V2+.

| Contract | Address |
|---|---|
| ShieldFactory v1 | [`0xd05F4fb3f24C7bF0cb482123186CF797E42CF17A`](https://sepolia.etherscan.io/address/0xd05F4fb3f24C7bF0cb482123186CF797E42CF17A) |
| PersonalVault v1 impl | [`0x5E398e1E0Ba28f9659013B1212f24b8B43d69393`](https://sepolia.etherscan.io/address/0x5E398e1E0Ba28f9659013B1212f24b8B43d69393) |

---

## Tests

169 tests passing across all contract suites.

| Suite | Tests | Description |
|---|---|---|
| `QryptSafeV6.test.js` | 49 | OTP sequential proofs, replay prevention, recharge, air bags, emergency withdraw |
| `QryptSafeV3.test.js` | 36 | Trustless factory, changeVaultProof, metaTransfer EIP-712, zero admin keys |
| `ShieldFactory.test.js` | 28 | V2 factory deploy, pause, clone integrity |
| `PersonalVault.test.js` | 46 | V2 vault shield, commit, reveal, expiry |
| `QToken.test.js` | 7 | Non-transferable qToken behavior |
| `integration.test.js` | 3 | Full shield, transfer, unshield flow |

```bash
pnpm install
pnpm hardhat test
```

---

## Compile

```bash
pnpm hardhat compile
```

Compiler: Solidity 0.8.34 with `viaIR: true` and optimizer enabled (200 runs).

---

## Deploy

### Deploy V3 to Sepolia

```bash
cp .env.example .env
# Fill in PRIVATE_KEY and ETHERSCAN_API_KEY
pnpm run deploy-verify:v3
```

### Deploy V6 to Sepolia

```bash
pnpm run deploy-verify:v6
```

### Historical Scripts

| Script | Purpose |
|---|---|
| `scripts/deploy-verify-v3.js` | V3 deploy and Etherscan verify |
| `scripts/deploy-v4.js` | QryptAir first version |
| `scripts/deploy-verify-v5.js` | V5 deploy and Etherscan verify |
| `scripts/deploy-verify-v6.js` | V6 deploy and Etherscan verify |

---

## Sepolia E2E

Run the live E2E suite against deployed contracts:

```bash
# V3 (5 on-chain scenarios)
pnpm run test:v3:e2e

# V6 (49 scenarios)
pnpm run test:v6:e2e
```

Requires `PRIVATE_KEY` and `SEPOLIA_RPC_URL` in `.env`.

---

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)
Copyright (c) 2026 [wei-zuan](https://github.com/wei-zuan). See [LICENSE](LICENSE) for full terms.
