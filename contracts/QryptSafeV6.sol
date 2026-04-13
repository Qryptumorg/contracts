// SPDX-License-Identifier: MIT
/*
 *
 *         ███████████████████████████████████████
 *         ███                                 ███
 *         ███                                 ███
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
import "./PersonalQryptSafeV6.sol";

contract QryptSafeV6 {
    using Clones for address;

    bytes32 private constant _QRYPTUM_SALT = keccak256("qryptum.v6.sepolia");

    address public immutable qryptSafeImpl;
    mapping(address => address) private vaults;

    event QryptSafeCreated(address indexed owner, address indexed vault);

    constructor() {
        qryptSafeImpl = address(new PersonalQryptSafeV6());
    }

    // initialChainHead = H100 of OTP chain, computed by frontend from vault proof
    function createQryptSafe(bytes32 initialChainHead) external returns (address vault) {
        require(vaults[msg.sender] == address(0), "Qrypt-Safe already exists for this wallet");
        require(initialChainHead != bytes32(0), "Invalid chain head");

        vault = qryptSafeImpl.clone();
        PersonalQryptSafeV6(vault).initialize(msg.sender, initialChainHead);
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
