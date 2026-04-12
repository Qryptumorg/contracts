# Qryptum Contracts

Smart contract source code for the Qryptum protocol. All versions are deployed on Sepolia testnet and MIT-verified on Etherscan.

## Contracts Overview

| Version | Key Feature | Tests | Status |
|---|---|---|---|
| V1 | Genesis: EIP-1167 proxy, Ownable + Pausable factory | 12 | Superseded |
| V2 | Pausable removed, nonce commit, SafeERC20 | 23 | Superseded |
| V3 | Ownable removed, rotateProof, ECDSA metaTransfer | 36 | Superseded |
| V4 | Custom errors (13), vault metadata, partial unshield | 47 | Superseded |
| V5 | bytes32 proofHash, qrypt/unqrypt/veilTransfer/railgun branding, 51/51 E2E | 51 | Active |

## Sepolia Contract Addresses

### V5 (Active)
| Contract | Address | Etherscan |
|---|---|---|
| QryptSafeV5 (factory) | `0xB757fb0511A6d305370a20a0647C751D7E76D2ce` | [View](https://sepolia.etherscan.io/address/0xB757fb0511A6d305370a20a0647C751D7E76D2ce#code) |
| PersonalQryptSafeV5 (impl) | `0x06e29f9309Afa42A3f5E5640717bd8db952F12ba` | [View](https://sepolia.etherscan.io/address/0x06e29f9309Afa42A3f5E5640717bd8db952F12ba#code) |

E2E result: 51/51 tests passed on Sepolia. Full run: `scripts/test-v5-results.json`

### V4 (Superseded)
| Contract | Address | Etherscan |
|---|---|---|
| QryptSafeV4 (factory) | `0x611Ba6F93fAeC0203eBee1c3e35d72C1e5ba560F` | [View](https://sepolia.etherscan.io/address/0x611Ba6F93fAeC0203eBee1c3e35d72C1e5ba560F#code) |
| PersonalQryptSafeV4 (impl) | `0x8E0c9350CdF384a208F6005A2F632f35FB4e413E` | [View](https://sepolia.etherscan.io/address/0x8E0c9350CdF384a208F6005A2F632f35FB4e413E#code) |

### V3 (Superseded)
| Contract | Address | Etherscan |
|---|---|---|
| QryptSafeV3 (factory) | `0xd05F4fb3f24C7bF0cb482123186CF797E42CF17A` | [View](https://sepolia.etherscan.io/address/0xd05F4fb3f24C7bF0cb482123186CF797E42CF17A#code) |
| PersonalQryptSafeV3 (impl) | `0x5E398e1E0Ba28f9659013B1212f24b8B43d69393` | [View](https://sepolia.etherscan.io/address/0x5E398e1E0Ba28f9659013B1212f24b8B43d69393#code) |

### V2 (Superseded)
| Contract | Address | Etherscan |
|---|---|---|
| QryptSafeV2 (factory) | `0x26BAb8B6e88201ad4824ea1290a7C9c7b9B10fCf` | [View](https://sepolia.etherscan.io/address/0x26BAb8B6e88201ad4824ea1290a7C9c7b9B10fCf#code) |
| PersonalQryptSafeV2 (impl) | `0x675f70646713D4026612c673E644C61ae3aa7725` | [View](https://sepolia.etherscan.io/address/0x675f70646713D4026612c673E644C61ae3aa7725#code) |

### V1 (Superseded)
| Contract | Address | Etherscan |
|---|---|---|
| QryptSafeV1 (factory) | `0x88E8eAFafc99E83e687BCAbD53F783a92e51F75c` | [View](https://sepolia.etherscan.io/address/0x88E8eAFafc99E83e687BCAbD53F783a92a51F75c#code) |
| PersonalQryptSafeV1 (impl) | `0x6aA7d78f4c61DBD93e9cE5E0D5Be68eBc4E11001` | [View](https://sepolia.etherscan.io/address/0x6aA7d78f4c61DBD93e9cE5E0D5Be68eBc4E11001#code) |

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)
Copyright (c) 2026 [wei-zuan](https://github.com/wei-zuan). See [LICENSE](LICENSE) for full terms.
