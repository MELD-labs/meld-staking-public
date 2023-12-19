// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IMeldStakingCommonEvents} from "./IMeldStakingCommonEvents.sol";

interface IMeldStakingDelegator is IMeldStakingCommonEvents {
    /////// EVENTS ///////

    /**
     * @notice  Event emitted when the contract is initialized.
     * @param   stakingAddressProvider  Address of the staking address provider
     */
    event Initialized(address indexed executedBy, address indexed stakingAddressProvider);

    /**
     * @notice  Event emitted when a staker delegates their stake to a node
     * @param   user  Address of the staker
     * @param   nftId  ID of the staker
     * @param   nodeId  ID of the node
     * @param   amount  Amount of MELD tokens staked
     * @param   lockTierId  ID of the lock tier
     */
    event StakingDelegationCreated(
        address indexed user,
        uint256 indexed nftId,
        bytes32 indexed nodeId,
        uint256 amount,
        uint256 lockTierId
    );

    /**
     * @notice  Event emitted when a staker changes their delegation from a node to another
     * @param   nftId  ID of the staker
     * @param   oldNodeId  ID of the old node
     * @param   newNodeId  ID of the new node
     */
    event DelegatorNodeChanged(
        uint256 indexed nftId,
        bytes32 indexed oldNodeId,
        bytes32 indexed newNodeId
    );

    /**
     * @notice  Event emitted when a staker removes their delegation from a node
     * @param   nodeId  ID of the node
     * @param   nftId  ID of the staker
     */
    event DelegatorRemoved(bytes32 indexed nodeId, uint256 indexed nftId);

    /**
     * @notice  Event emitted when a staker withdraws their stake from a node
     * @param   nftId  ID of the staker
     * @param   nodeId  ID of the node
     * @param   amount  Amount of MELD tokens withdrawn
     */
    event StakeWithdrawn(uint256 indexed nftId, bytes32 indexed nodeId, uint256 amount);

    ///// ADMIN FUNCTIONS /////

    /**
     * @notice  ADMIN: Initializes the contract, setting the address of the MELD Staking Storage and the MELD Staking Common
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _stakingAddressProvider  Address of the MELD Staking Address Provider
     */
    function initialize(address _stakingAddressProvider) external;

    ///// DELEGATOR FUNCTIONS /////

    /**
     * @notice  Creates an staking position for a user, delegating to a node
     * @dev     Manages total stake and rewards calculation. Further info can be found on docs
     * @param   _amount  Amount of MELD tokens to stake. Full decimals
     * @param   _nodeId  Node ID to delegate to.
     * @param   _lockTierId  Lock tier ID.
     */
    function stake(uint256 _amount, bytes32 _nodeId, uint256 _lockTierId) external;

    /**
     * @notice  Changes the delegation of a staking position to a new node
     * @dev     Adapts staking info and rewards for old and new node. Can only be done by owner of NFT
     * @param   _nftId  Staking position NFT ID to change
     * @param   _newNodeId  ID of the new node to delegate to
     */
    function changeDelegation(uint256 _nftId, bytes32 _newNodeId) external;

    /**
     * @notice  A delegator redeems their Staking NFT withdrawing their stake and unclaimed rewards
     * @dev     Can only be done by owner of NFT
     * @dev     Can only be done by a delegator
     * @dev     If the staking position is locked and the lock period has not ended, it will revert
     * @param   _nftId  Staking position NFT ID to redeem
     */
    function withdraw(uint256 _nftId) external;

    /**
     * @notice  Checks if an address can delegate to a specific node
     * @dev     If the node does not have whitlist enabled it will return true
     *          And if it has whitlist enabled it will return true or false if the address is in the whitelist
     * @param   _address The address to check
     * @param   _nodeId The node where the address tries to delegate
     */
    function canDelegateToNode(address _address, bytes32 _nodeId) external view returns (bool);
}
