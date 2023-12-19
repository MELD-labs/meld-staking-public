// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IMeldStakingCommonEvents} from "./IMeldStakingCommonEvents.sol";

interface IMeldStakingConfig is IMeldStakingCommonEvents {
    /////// EVENTS ///////

    /**
     * @notice  Event emitted when the contract is initialized.
     * @param   executedBy  Address that executed the initialization
     * @param   initTimestamp  Timestamp of the initialization
     * @param   epochSize  Size of an epoch
     * @param   slashReceiver  Address of the slash receiver
     * @param   stakingAddressProvider  Address of the staking address provider
     */
    event Initialized(
        address indexed executedBy,
        uint256 initTimestamp,
        uint256 epochSize,
        address slashReceiver,
        address stakingAddressProvider
    );

    /**
     * @notice  Event emitted when the minimum staking amount is updated.
     * @param   executedBy  Address that executed the initialization
     * @param   oldMinStakingAmount  Previous minimum staking amount
     * @param   newMinStakingAmount  New minimum staking amount
     */
    event MinStakingAmountUpdated(
        address indexed executedBy,
        uint256 oldMinStakingAmount,
        uint256 newMinStakingAmount
    );

    /**
     * @notice  Event emitted when the maximum staking amount is updated.
     * @param   executedBy  Address that executed the initialization
     * @param   oldMaxStakingAmount  Previous maximum staking amount
     * @param   newMaxStakingAmount  New maximum staking amount
     */
    event MaxStakingAmountUpdated(
        address indexed executedBy,
        uint256 oldMaxStakingAmount,
        uint256 newMaxStakingAmount
    );

    /**
     * @notice  Event emitted when the maximum staking amount for a node is updated.
     * @param   executedBy  Address that executed the initialization
     * @param   nodeId  ID of the node
     * @param   oldMaxStakingAmount  Previous maximum staking amount
     * @param   newMaxStakingAmount  New maximum staking amount
     */
    event MaxStakingAmountForNodeUpdated(
        address indexed executedBy,
        bytes32 indexed nodeId,
        uint256 oldMaxStakingAmount,
        uint256 newMaxStakingAmount
    );

    /**
     * @notice  Event emitted when the minimum delegation fee is updated.
     * @param   executedBy  Address that executed the initialization
     * @param   oldMinDelegationFee  Previous minimum delegation fee
     * @param   newMinDelegationFee  New minimum delegation fee
     */
    event MinDelegationFeeUpdated(
        address indexed executedBy,
        uint256 oldMinDelegationFee,
        uint256 newMinDelegationFee
    );

    /**
     * @notice  Event emitted when the maximum delegation fee is updated.
     * @param   executedBy  Address that executed the initialization
     * @param   oldMaxDelegationFee  Previous maximum delegation fee
     * @param   newMaxDelegationFee  New maximum delegation fee
     */
    event MaxDelegationFeeUpdated(
        address indexed executedBy,
        uint256 oldMaxDelegationFee,
        uint256 newMaxDelegationFee
    );

    /**
     * @notice  Event emitted when the slash receiver is updated.
     * @param   executedBy  Address that executed the initialization
     * @param   oldSlashReceiver  Previous slash receiver
     * @param   newSlashReceiver  New slash receiver
     */
    event SlashReceiverUpdated(
        address indexed executedBy,
        address oldSlashReceiver,
        address newSlashReceiver
    );

    /**
     * @notice  Event emitted when a node request is approved.
     * @param   executedBy  Address that executed the initialization
     * @param   nodeId  ID of the node
     * @param   operator  Operator of the node
     * @param   amount  Amount staked by the node
     */
    event NodeRequestApproved(
        address indexed executedBy,
        bytes32 indexed nodeId,
        uint256 indexed operator,
        uint256 amount
    );

    /**
     * @notice  Event emitted when a node request is rejected.
     * @param   executedBy  Address that executed the initialization
     * @param   nodeId  ID of the node
     * @param   operator  Operator of the node
     * @param   amount  Amount staked by the node
     */
    event NodeRequestRejected(
        address indexed executedBy,
        bytes32 indexed nodeId,
        uint256 indexed operator,
        uint256 amount
    );

    /**
     * @notice  Event emitted when a a StakingLockTier is added.
     * @param   executedBy  Address that executed the initialization
     * @param   lockTierId  ID of the lock tier
     * @param   minStakingAmount  Minimum staking amount
     * @param   stakingLength  Length of the staking lock
     * @param   weight  Weight of the lock tier
     */
    event StakingLockTierAdded(
        address indexed executedBy,
        uint256 indexed lockTierId,
        uint256 minStakingAmount,
        uint256 stakingLength,
        uint256 weight
    );

    /**
     * @notice  Event emitted when a a StakingLockTier is removed.
     * @param   executedBy  Address that executed the initialization
     * @param   lockTierId  ID of the lock tier
     */
    event StakingLockTierRemoved(address indexed executedBy, uint256 indexed lockTierId);

    /**
     * @notice  Event emitted when the rewards are set.
     * @param   executedBy  Address that executed the initialization
     * @param   epoch  Epoch of the rewards
     * @param   amount  Amount of rewards
     */
    event RewardsSet(address indexed executedBy, uint256 indexed epoch, uint256 amount);

    /**
     * @notice  Event emitted when a node is slashed.
     * @param   executedBy  Address that executed the initialization
     * @param   nodeId  ID of the node
     * @param   amount  Amount slashed
     * @param   percentageSlashed  Percentage of the stake slashed from the delegators in basis points (100 = 1%)
     */
    event NodeSlashed(
        address indexed executedBy,
        bytes32 indexed nodeId,
        uint256 amount,
        uint256 percentageSlashed
    );

    /**
     * @notice  Event emitted when the delegator whitelist is toggled.
     * @param   executedBy  Address that executed the initialization
     * @param   nodeId  ID of the node
     * @param   flag  Flag of the whitelist
     */
    event NodeDelegatorWhitlistToggled(
        address indexed executedBy,
        bytes32 indexed nodeId,
        bool flag
    );

    /**
     * @notice  Event emitted when a delegator is added to the whitelist.
     * @param   executedBy  Address that executed the initialization
     * @param   nodeId  ID of the node
     * @param   delegator  Address of the delegator
     */
    event NodeDelegatorAddedToWhitelist(
        address indexed executedBy,
        bytes32 indexed nodeId,
        address indexed delegator
    );

    /**
     * @notice  Event emitted when a delegator is removed from the whitelist.
     * @param   executedBy  Address that executed the initialization
     * @param   nodeId  ID of the node
     * @param   delegator  Address of the delegator
     */
    event NodeDelegatorRemovedFromWhitelist(
        address indexed executedBy,
        bytes32 indexed nodeId,
        address indexed delegator
    );

    /**
     * @notice  Event emitted when the stuck rewards are updated.
     * @param   executedBy  Address that executed the initialization
     * @param   lastEpochStuckRewardsUpdated  Last epoch that the stuck rewards were updated
     * @param   lastEpochRewardsUpdated  Last epoch that the rewards were updated
     * @param   newStuckRewards  Amount of stuck rewards subtracted from the locked tokens
     */
    event StuckRewardsUpdated(
        address indexed executedBy,
        uint256 lastEpochStuckRewardsUpdated,
        uint256 lastEpochRewardsUpdated,
        uint256 newStuckRewards
    );

    /////// FUNCTIONS ///////

    /**
     * @notice  Returns the role that controls the rewards
     * @return  bytes32 Id of the rewards setter role
     */
    function REWARDS_SETTER_ROLE() external view returns (bytes32);

    /**
     * @notice  ADMIN: Initial configurations of the protocol
     * @dev     Can only be called by admin once
     * @dev     `_initTimestamp` must be set in the future
     * @param   _initTimestamp  Starting time of the staking process
     * @param   _epochSize  Amount of seconds that an epoch will last
     * @param   _slashReceiver  Address that will receive the stake of slashed nodes
     * @param   _stakingAddressProvider  Address of the data provider contract
     */
    function initialize(
        uint256 _initTimestamp,
        uint256 _epochSize,
        address _slashReceiver,
        address _stakingAddressProvider
    ) external;

    /**
     * @notice  ADMIN: Sets the minimum amount of MELD tokens that can be staked to become an Operator
     * @dev     Must be lower than the current maximum. If you intend to increase it, please modify the maximum first
     * @param   _minStakingAmount  New minimum amount needed for operating a node, with all decimals
     */
    function setMinStakingAmount(uint256 _minStakingAmount) external;

    /**
     * @notice  ADMIN: Sets the maximum amount of MELD tokens that can be staked in a node
     * @dev     Must be higher than the current minimum. If you intend to decrease it, please modify the minimum first
     * @param   _maxStakingAmount  New maximum amount needed for operating a node, with all decimals
     */
    function setMaxStakingAmount(uint256 _maxStakingAmount) external;

    /**
     * @notice  ADMIN: Overrides the general maximum of MELD tokens to be staked/delegated for a particular node
     * @dev     Must be higer than the operator minimum stake
     * @param   _nodeId  ID of the node to modify
     * @param   _maxStakingAmount  New amount of maximum staking/delegations allowed
     */
    function setMaxStakingAmountForNode(bytes32 _nodeId, uint256 _maxStakingAmount) external;

    /**
     * @notice  ADMIN: Sets a new minimum for delegator fees
     * @dev     Must be lower than the current maximum.
     * @param   _minDelegationFee  New delegation fee minimum with two basis points (100 = 1%)
     */
    function setMinDelegationFee(uint256 _minDelegationFee) external;

    /**
     * @notice  ADMIN: Sets a new maximum for delegator fees
     * @dev     Must be higer than the current minimum
     * @param   _maxDelegationFee  New delegation fee maximum with two basis points (100 = 1%)
     */
    function setMaxDelegationFee(uint256 _maxDelegationFee) external;

    /**
     * @notice  ADMIN: Sets a new address to receive the slashed funds
     * @param   _slashReceiver  Address of the new slash receiver
     */
    function setSlashReceiver(address _slashReceiver) external;

    /**
     * @notice  ADMIN: Creates a new staking lock tier for users to be able to lock their tokens
     * @param   _minStakingAmount  Minimum amount of MELD tokens to stake in this tier (with all decimals)
     * @param   _stakingLength  Duration of the lock period, in epochs
     * @param   _weight  Weight of the tokens for rewards calculation
     */
    function addStakingLockTier(
        uint256 _minStakingAmount,
        uint256 _stakingLength,
        uint256 _weight
    ) external;

    /**
     * @notice  ADMIN: Removes a staking lock tier avoiding new stake to happen in this tier
     * @dev     Does not affect existing locked positions on this tier
     * @param   _lockTierId  ID of the tier to remove
     */
    function removeStakingLockTier(uint256 _lockTierId) external;

    /**
     * @notice  ADMIN: Updates the stuck rewards
     * @dev     This function calculates the actual rewards that should go to the redeemed NFTs
     *          and subtracts them from the locked meld tokens of the NFT contract
     */
    function updateStuckRewards() external;

    /**
     * @notice  ADMIN: Approves a request from a new operator to create a new node
     * @dev     Until the node is approved, the operator's stake will not count towards rewards
     * @param   _nodeId  ID of the node to approve
     */
    function approveNodeRequest(bytes32 _nodeId) external;

    /**
     * @notice  ADMIN: Rejects a request from a new operator to create a new node. NFT is burned and stake is returned to operator
     * @dev     MELD tokens are automatically returned to the user
     * @param   _nodeId  ID of the node to reject
     */
    function rejectNodeRequest(bytes32 _nodeId) external;

    /**
     * @notice  ADMIN: Slashes a node, sending node staking amount to the slash receiver
     * @dev     The node becomes SLASHED, preventing any further staking or accruing new rewards
     *          Only allows operator and delegators to claim their unclaimed rewards
     * @param   _nodeId  Id of the node to be slashed
     * @param   _slashPercentage Percentage of the delegators stake to be slashed in basis points (100 = 1%)
     */
    function slashNode(bytes32 _nodeId, uint256 _slashPercentage) external;

    /**
     * @notice  ADMIN: Sets if a node is able to be delegated into only via whitelist
     * @dev     Requires node to be active
     * @param   _nodeId  Target node ID
     * @param   _flag  true=whitelist active, false=whitelist disabled
     */
    function toggleDelegatorWhitelist(bytes32 _nodeId, bool _flag) external;

    /**
     * @notice  ADMIN: Adds an address to the whitelist of a node delegators
     * @dev     Requires node to be active
     * @param   _nodeId  Target node ID
     * @param   _address  Address to be added to the whitelist
     */
    function addDelegatorToWhitelist(bytes32 _nodeId, address _address) external;

    /**
     * @notice  ADMIN: Adds a list of addresses to the whitelist of a node delegators
     * @dev     Requires node to be active
     * @param   _nodeId  Target node ID
     * @param   _addresses  List of addresses to be added to the whitelist
     */
    function addDelegatorsToWhitelist(bytes32 _nodeId, address[] calldata _addresses) external;

    /**
     * @notice  ADMIN: Removes an address from the whitelist of a node delegators
     * @dev     Requires node to be active
     * @param   _nodeId  Target node ID
     * @param   _address  Address to be removed from the whitelist
     */
    function removeDelegatorFromWhitelist(bytes32 _nodeId, address _address) external;

    /**
     * @notice  ADMIN: Removes a list of addresses from the whitelist of a node delegators
     * @dev     Requires node to be active
     * @param   _nodeId  Target node ID
     * @param   _addresses  List of addresses to be removed from the whitelist
     */
    function removeDelegatorsFromWhitelist(bytes32 _nodeId, address[] calldata _addresses) external;

    /**
     * @notice  REWARD_SETTER: Sets the amount of rewards to be distributed in one epoch.
     * @dev     The signer of this transaction must be the rewards setter
     * @dev     Needs previous epochs to be "rewarded"
     * @param   _amount  Rewarded amount in MELD tokens with all decimals
     * @param   _epoch  Epoch to distribute rewards to
     */
    function setRewards(uint256 _amount, uint256 _epoch) external;
}
