// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IMeldStakingAddressProvider {
    event Initialized(
        address indexed executedBy,
        address meldToken,
        address meldStakingNFT,
        address meldStakingCommon,
        address meldStakingOperator,
        address meldStakingDelegator,
        address meldStakingConfig,
        address meldStakingStorage
    );

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
    ) external;

    /**
     * @notice  Returns the address of the MELD token
     * @return  address  Address of the MELD token
     */
    function meldToken() external view returns (address);

    /**
     * @notice  Returns the address of the MELD Staking NFT
     * @return  address  Address of the MELD Staking NFT
     */
    function meldStakingNFT() external view returns (address);

    /**
     * @notice  Returns the address of the MELD Staking Common
     * @return  address  Address of the MELD Staking Common
     */
    function meldStakingCommon() external view returns (address);

    /**
     * @notice  Returns the address of the MELD Staking Operator
     * @return  address  Address of the MELD Staking Operator
     */
    function meldStakingOperator() external view returns (address);

    /**
     * @notice  Returns the address of the MELD Staking Delegator
     * @return  address  Address of the MELD Staking Delegator
     */
    function meldStakingDelegator() external view returns (address);

    /**
     * @notice  Returns the address of the MELD Staking Config
     * @return  address  Address of the MELD Staking Config
     */
    function meldStakingConfig() external view returns (address);

    /**
     * @notice  Returns the address of the MELD Staking Storage
     * @return  address  Address of the MELD Staking Storage
     */
    function meldStakingStorage() external view returns (address);

    /**
     * @notice  Returns if the contract is initialized
     */
    function initialized() external view returns (bool);
}
