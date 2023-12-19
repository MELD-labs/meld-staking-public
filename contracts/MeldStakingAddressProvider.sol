// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import {IMeldStakingAddressProvider} from "./interfaces/IMeldStakingAddressProvider.sol";
import "./Errors.sol";

/**
 *  @title MeldStakingAddressProvider
 *  @notice This contract contains the address of the MELD Staking contracts
 *  @author MELD team
 */
contract MeldStakingAddressProvider is IMeldStakingAddressProvider, AccessControl {
    address public override meldToken;
    address public override meldStakingNFT;
    address public override meldStakingCommon;
    address public override meldStakingOperator;
    address public override meldStakingDelegator;
    address public override meldStakingConfig;
    address public override meldStakingStorage;

    bool public override initialized;

    /**
     * @notice  Constructor of the contract
     * @param   _defaultAdmin This address will have the `DEFAULT_ADMIN_ROLE`
     */
    constructor(address _defaultAdmin) {
        _setupRole(DEFAULT_ADMIN_ROLE, _defaultAdmin);
    }

    /**
     * @notice  ADMIN: Initializes the contract, setting the addresses of the MELD Staking contracts
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _meldToken  Address of the MELD token
     * @param   _meldStakingNFT  Address of the MELD Staking NFT
     * @param   _meldStakingCommon  Address of the MELD Staking Common
     * @param   _meldStakingOperator  Address of the MELD Staking Operator
     * @param   _meldStakingDelegator  Address of the MELD Staking Delegator
     * @param   _meldStakingConfig  Address of the MELD Staking Config
     * @param   _meldStakingStorage  Address of the MELD Staking Storage
     */
    function initialize(
        address _meldToken,
        address _meldStakingNFT,
        address _meldStakingCommon,
        address _meldStakingOperator,
        address _meldStakingDelegator,
        address _meldStakingConfig,
        address _meldStakingStorage
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!initialized, ALREADY_INITIALIZED);
        require(_meldToken != address(0), INVALID_ADDRESS);
        require(_meldStakingNFT != address(0), INVALID_ADDRESS);
        require(_meldStakingCommon != address(0), INVALID_ADDRESS);
        require(_meldStakingOperator != address(0), INVALID_ADDRESS);
        require(_meldStakingDelegator != address(0), INVALID_ADDRESS);
        require(_meldStakingConfig != address(0), INVALID_ADDRESS);
        require(_meldStakingStorage != address(0), INVALID_ADDRESS);

        meldToken = _meldToken;
        meldStakingNFT = _meldStakingNFT;
        meldStakingCommon = _meldStakingCommon;
        meldStakingOperator = _meldStakingOperator;
        meldStakingDelegator = _meldStakingDelegator;
        meldStakingConfig = _meldStakingConfig;
        meldStakingStorage = _meldStakingStorage;

        initialized = true;

        emit Initialized(
            _msgSender(),
            _meldToken,
            _meldStakingNFT,
            _meldStakingCommon,
            _meldStakingOperator,
            _meldStakingDelegator,
            _meldStakingConfig,
            _meldStakingStorage
        );
    }
}
