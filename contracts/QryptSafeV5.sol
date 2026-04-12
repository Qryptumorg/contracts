// SPDX-License-Identifier: MIT
/*
 *
 *           ███m███████████████████████████m███
 *           ███                             ███
 *           ███                             ███
 * ███████████████████████████████████████████████████████
 * ███████████████████████████████████████████████████████
 * ███                                                 ███
 * ███     ███  ████  █   █ ████  █████ █   █ █   █    ███
 * ███    █   █ █   █ █   █ █   █   █   █   █ ██ ██    ███
 * ███    █   █ ████   █ █  ████    █   █   █ █ █ █    ███
 * ███    █  ██ █ █     █   █       █   █   █ █   █    ███
 * ███     ██ █ █  █    █   █       █    ███  █   █    ███
 * ███                                                 ███
 * ███                      ████                       ███
 * ███                     ██  ██                      ███
 * ███                     ██  ██                      ███
 * ███                      ████                       ███
 * ███                       ██                        ███
 * ███                       ██                        ███
 * ███                                                 ███
 * ███████████████████████████████████████████████████████
 * ███████████████████████████████████████████████████████
 *
 */
// https://qryptum.org
pragma solidity 0.8.34;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PersonalQryptSafeV5.sol";

contract QryptSafeV5 {
    using Clones for address;

    address public immutable qryptSafeImpl;
    mapping(address => address) private vaults;

    event QryptSafeCreated(address indexed owner, address indexed vault);

    constructor() {
        qryptSafeImpl = address(new PersonalQryptSafeV5());
    }

    // passwordHash = keccak256(password) computed by frontend — raw password never on-chain
    function createQryptSafe(bytes32 passwordHash) external returns (address vault) {
        require(vaults[msg.sender] == address(0), "QryptSafe already exists for this wallet");

        vault = qryptSafeImpl.clone();
        PersonalQryptSafeV5(vault).initialize(msg.sender, passwordHash);
        vaults[msg.sender] = vault;

        emit QryptSafeCreated(msg.sender, vault);
    }

    function hasQryptSafe(address wallet) external view returns (bool) {
        return vaults[wallet] != address(0);
    }

    function getQryptSafe(address wallet) external view returns (address) {
        return vaults[wallet];
    }
}
