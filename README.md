# Qryptum Contracts

Smart contract source code for the Qryptum protocol. All versions are deployed on Sepolia testnet and MIT-verified on Etherscan.

## Contracts Overview

| Version | Key Feature | Tests | Status |
|---|---|---|---|
| V1 | Genesis: EIP-1167 proxy, Ownable + Pausable factory | 12 | Superseded |
| V2 | Pausable removed, nonce commit, SafeERC20 | 23 | Superseded |
| V3 | Ownable removed, changeVaultProof, ECDSA metaTransfer | 36 | Superseded |
| V4 | Custom errors (13), vault metadata, partial unshield | 47 | Active |

## Sepolia Contract Addresses

### V4 (Active)
| Contract | Address | Etherscan |
|---|---|---|
| QryptSafeV4 (factory) | `0x611Ba6F93fAeC0203eBee1c3e35d72C1e5ba560F` | [View](https://sepolia.etherscan.io/address/0x611Ba6F93fAeC0203eBee1c3e35d72C1e5ba560F#code) |
| PersonalQryptSafeV4 (impl) | `0x8E0c9350CdF384a208F6005A2F632f35FB4e413E` | [View](https://sepolia.etherscan.io/address/0x8E0c9350CdF384a208F6005A2F632f35FB4e413E#code) |

Deploy TX: [`0x6d5ccda...`](https://sepolia.etherscan.io/tx/0x6d5ccda226bf57e7b0e2c03e676c0de2fc6031a8060840936d909f2ed920cc2a)

### V3
| Contract | Address | Etherscan |
|---|---|---|
| QryptSafeV3 (factory) | `0xd05F4fb3f24C7bF0cb482123186CF797E42CF17A` | [View](https://sepolia.etherscan.io/address/0xd05F4fb3f24C7bF0cb482123186CF797E42CF17A#code) |
| PersonalQryptSafeV3 (impl) | `0x5E398e1E0Ba28f9659013B1212f24b8B43d69393` | [View](https://sepolia.etherscan.io/address/0x5E398e1E0Ba28f9659013B1212f24b8B43d69393#code) |

### V2
| Contract | Address | Etherscan |
|---|---|---|
| QryptSafeV2 (factory) | `0x26BAb8B6e88201ad4824ea1290a7C9c7b9B10fCf` | [View](https://sepolia.etherscan.io/address/0x26BAb8B6e88201ad4824ea1290a7C9c7b9B10fCf#code) |
| PersonalQryptSafeV2 (impl) | `0x675f70646713D4026612c673E644C61ae3aa7725` | [View](https://sepolia.etherscan.io/address/0x675f70646713D4026612c673E644C61ae3aa7725#code) |

### V1
| Contract | Address | Etherscan |
|---|---|---|
| QryptSafeV1 (factory) | `0x88E8eAFafc99E83e687BCAbD53F783a92e51F75c` | [View](https://sepolia.etherscan.io/address/0x88E8eAFafc99E83e687BCAbD53F783a92e51F75c#code) |
| PersonalQryptSafeV1 (impl) | `0xaf2E91CDc70e81fA74b9aE9C322e8302bb51715e` | [View](https://sepolia.etherscan.io/address/0xaf2E91CDc70e81fA74b9aE9C322e8302bb51715e#code) |

## Stack

- Solidity 0.8.34
- Hardhat
- OpenZeppelin Contracts 5.x (Clones, SafeERC20)
- Ethers v6 (tests)

## Test

```
pnpm test
```

## Deploy (Sepolia)

```
npx hardhat run scripts/deploy-verify-v4.js --network sepolia
```

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)
Copyright (c) 2026 [wei-zuan](https://github.com/wei-zuan). See [LICENSE](LICENSE) for full terms.
