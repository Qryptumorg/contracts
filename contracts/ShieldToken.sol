// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ShieldToken is ERC20 {
    address public vault;
    uint8 private _decimals;

    modifier onlyVault() {
        require(msg.sender == vault, "Only Qrypt-Safe can call this");
        _;
    }

    constructor(string memory name, string memory symbol, address _vault, uint8 decimals_) ERC20(name, symbol) {
        vault = _vault;
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert("qToken: transfers disabled, use Qryptum app");
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert("qToken: transfers disabled, use Qryptum app");
    }

    function approve(address, uint256) public pure override returns (bool) {
        revert("qToken: approvals disabled");
    }
}
