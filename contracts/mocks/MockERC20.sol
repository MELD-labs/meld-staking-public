// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private __decimals;

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _initialSupply
    ) ERC20(_name, _symbol) {
        __decimals = _decimals;
        _mint(msg.sender, (10 ** __decimals) * _initialSupply);
    }

    function decimals() public view virtual override returns (uint8) {
        return __decimals;
    }
}
