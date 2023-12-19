// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IMeldStakingStorage {
    /////// STRUCTS ///////

    struct NodeRequest {
        uint256 operator;
        uint256 delegatorFee;
        uint256 stakingAmount;
        uint256 requestTimestamp;
        uint256 lockTierId;
    }

    struct LockStakingTier {
        uint256 minStakingAmount;
        uint256 stakingLength;
        uint256 weight;
        bool active;
    }

    /////// EVENTS ///////

    /**
     * @notice  Event emitted when the contract is initialized.
     * @param   stakingAddressProvider  Address of the staking address provider
     */
    event Initialized(address indexed executedBy, address indexed stakingAddressProvider);

    /////// GETTERS ///////

    // GENERAL

    /**
     * @notice  Returns the value of the `PERCENTAGE_SCALING` constant.
     * @dev     It is a constant with value `10000`, representing basis points (10000 = 100%).
     * @return  uint256  The value of the `PERCENTAGE_SCALING` constant
     */
    function PERCENTAGE_SCALING() external view returns (uint256);

    /**
     * @notice  Returns the address that will receive the slashed tokens
     * @return  address  Address that will receive the slashed tokens
     */
    function slashReceiver() external view returns (address);

    /**
     * @notice  Returns the actual (un-hashed) node ID
     * @return  string Actual (un-hashed) node ID
     */
    function getNodeName(bytes32 _nodeId) external view returns (string memory);

    // GLOBAL INFO

    /**
     * @notice  Returns the minimum amount of MELD tokens that can be staked to become a staker
     * @return  uint256  Minimum amount of MELD tokens that can be staked to become a staker
     */
    function getMinStakingAmount() external view returns (uint256);

    /**
     * @notice  Returns the maximum amount of MELD tokens that can be staked to become a staker
     * @return  uint256  Maximum amount of MELD tokens that can be staked to become a staker
     */
    function getMaxStakingAmount() external view returns (uint256);

    /**
     * @notice  Returns the minimum delegation fee that can be set by a node
     * @return  uint256  Minimum delegation fee that can be set by a node
     */
    function getMinDelegationFee() external view returns (uint256);

    /**
     * @notice  Returns the maximum delegation fee that can be set by a node
     * @return  uint256  Maximum delegation fee that can be set by a node
     */
    function getMaxDelegationFee() external view returns (uint256);

    /**
     * @notice  Returns the timestamp when the staking system started
     * @return  uint256  Timestamp when the staking system started
     */
    function getInitTimestamp() external view returns (uint256);

    /**
     * @notice  Returns the duration of an epoch in seconds
     * @return  uint256  Duration of an epoch in seconds
     */
    function getEpochSize() external view returns (uint256);

    /**
     * @notice  Returns the total base amount of MELD tokens staked in the system
     * @return  uint256  Total amount of MELD tokens staked in the system
     */
    function getTotalBaseStakedAmount() external view returns (uint256);

    /**
     * @notice  Returns the last epoch when the global info was updated
     * @return  uint256  Last epoch when the global info was updated
     */
    function getLastEpochStakingUpdated() external view returns (uint256);

    /**
     * @notice  Returns the last epoch when the rewards were updated
     * @return  uint256  Last epoch when the rewards were updated
     */
    function getLastEpochRewardsUpdated() external view returns (uint256);

    /**
     * @notice  Returns the last epoch when the stuck rewards were updated
     * @return  uint256  Last epoch when the stuck rewards were updated
     */
    function getLastEpochStuckRewardsUpdated() external view returns (uint256);

    /**
     * @notice  Returns the total rewards for a given epoch
     * @param   _epoch  Epoch to get the rewards for
     * @return  uint256  Total rewards for the given epoch
     */
    function getTotalRewardsPerEpoch(uint256 _epoch) external view returns (uint256);

    /**
     * @notice  Returns the minimum amount of MELD tokens staked in a given epoch
     * @param   _epoch  Epoch to get the minimum amount of MELD tokens staked for
     * @return  uint256  Minimum amount of MELD tokens staked in the given epoch
     */
    function getMinStakedAmountPerEpoch(uint256 _epoch) external view returns (uint256);

    /**
     * @notice  Returns the last amount of MELD tokens staked in a given epoch
     * @param   _epoch  Epoch to get the last amount of MELD tokens staked for
     * @return  uint256  Last amount of MELD tokens staked in the given epoch
     */
    function getLastStakedAmountPerEpoch(uint256 _epoch) external view returns (uint256);

    /**
     * @notice  Returns the excess weighted stake for a given epoch
     * @dev     This value accounts for the extra weight represented by the staked amount
     *          of locked staking positions that expire in the given epoch
     * @param   _epoch  Epoch to get the excess weighted stake for
     * @return  uint256  Excess weighted stake for the given epoch
     */
    function getLockingExcessWeightedStakePerEpoch(uint256 _epoch) external view returns (uint256);

    /**
     * @notice  Returns the stuck rewards shares for a given epoch
     * @dev     This value accounts for the unclaimed rewards shares that belong to a
     *          staking position that is redeemed
     * @param   _epoch  Epoch to get the stuck rewards shares for
     * @return  uint256  Stuck rewards shares for the given epoch
     */
    function getStuckRewardSharesPerEpoch(uint256 _epoch) external view returns (uint256);

    // EPOCHS INFO

    /**
     * @notice  Informs about the status of the staking system
     * @dev     Takes into account if the contract has been initialised and the starting timestamp
     * @return  bool  Returns if staking system has started
     */
    function isStakingStarted() external view returns (bool);

    /**
     * @notice  Returns the current epoch number
     * @dev     Uses helper function to get epoch from the timestamp of the block
     * @return  uint256  Current epoch number
     */
    function getCurrentEpoch() external view returns (uint256);

    /**
     * @notice  Returns the epoch of an arbitrary timestamp
     * @dev     Used for offchain support
     * @param   _timestamp  Timestamp in seconds since epoch (traditional CS epoch)
     * @return  uint256  Epoch number of given timestamp
     */
    function getEpoch(uint256 _timestamp) external view returns (uint256);

    /**
     * @notice  Returns the initial timestamp of a given epoch
     * @param   _epoch  Epoch number to get the start of
     * @return  uint256  Timestamp of the start of the epoch
     */
    function getEpochStart(uint256 _epoch) external view returns (uint256);

    /**
     * @notice  Returns the ending timestamp of a given epoch
     * @param   _epoch  Epoch number to get the end of
     * @return  uint256  Timestamp of the end of the epoch
     */
    function getEpochEnd(uint256 _epoch) external view returns (uint256);

    /**
     * @notice  Returns the last epoch that a node was active
     * @param   _nodeId  ID of the node
     * @return  uint256  Last epoch that the node was active
     */
    function getLastActiveEpoch(bytes32 _nodeId) external view returns (uint256);

    // LOCK STAKING TIERS

    /**
     * @notice  Return the info of a given lock staking tier
     * @param   _tierId  ID of the lock staking tier to get the info for
     * @return  LockStakingTier  Info of the given lock staking tier
     */
    function getLockStakingTier(uint256 _tierId) external view returns (LockStakingTier memory);

    /**
     * @notice  Returns the list of lock staking tiers ids
     * @dev Only the active lock staking tiers are returned
     * @return  uint256[]  List of lock staking tiers ids
     */
    function getActiveLockStakingTierIdList() external view returns (uint256[] memory);

    /**
     * @notice  Returns the last lock staking tier id used
     * @return  uint256  Last lock staking tier id used
     */
    function lastLockStakingTierId() external view returns (uint256);

    /**
     * @notice  Checks if a given lock staking tier is active
     * @param   _lockTierId  ID of the lock staking tier to check
     * @return  bool  Returns if the given lock staking tier is active
     */
    function isActiveLockStakingTierId(uint256 _lockTierId) external view returns (bool);

    // STAKERS

    /**
     * @notice  Returns if a given NFT ID is a staker
     * @param   _nftId  NFT ID to check if it is a staker
     * @return  bool  Returns if the given NFT ID is a staker
     */
    function isStaker(uint256 _nftId) external view returns (bool);

    /**
     * @notice  Returns if a given NFT ID is an operator
     * @param   _nftId  NFT ID to check if it is an operator
     * @return  bool  Returns if the given NFT ID is an operator
     */
    function isOperator(uint256 _nftId) external view returns (bool);

    /**
     * @notice  Returns if a given NFT ID is a delegator
     * @param   _nftId  NFT ID to check if it is a delegator
     * @return  bool  Returns if the given NFT ID is a delegator
     */
    function isDelegator(uint256 _nftId) external view returns (bool);

    /**
     * @notice  Returns the base staked amount of a staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Staked amount of the staker
     */
    function getStakerBaseStakedAmount(uint256 _nftId) external view returns (uint256);

    /**
     * @notice  Returns the node ID of a staker
     * @param   _nftId  NFT ID of the staker
     * @return  bytes32  Node ID of the staker
     */
    function getStakerNodeId(uint256 _nftId) external view returns (bytes32);

    /**
     * @notice  Returns the last epoch when the staked amount was updated for a staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Last epoch when the staked amount was updated for the staker
     */
    function getStakerLastEpochStakingUpdated(uint256 _nftId) external view returns (uint256);

    /**
     * @notice  Returns the last epoch when the rewards were updated for a staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Last epoch when the rewards were updated for the staker
     */
    function getStakerLastEpochRewardsUpdated(uint256 _nftId) external view returns (uint256);

    /**
     * @notice  Returns the lock tier ID of a staker
     * @dev     If the value is 0 it means it is a liquid staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Lock tier ID of the staker
     */
    function getStakerLockTierId(uint256 _nftId) external view returns (uint256);

    /**
     * @notice  Returns the unclaimed rewards of a staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Unclaimed rewards of the staker
     */
    function getStakerUnclaimedRewards(uint256 _nftId) external view returns (uint256);

    /**
     * @notice  Returns the cumulative claimed rewards of a staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Cumulative claimed rewards of the staker
     */
    function getStakerCumulativeRewards(uint256 _nftId) external view returns (uint256);

    /**
     * @notice  Returns the timestamp when the staker started
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Timestamp when the staker started
     */
    function getStakerStakingStartTimestamp(uint256 _nftId) external view returns (uint256);

    /**
     * @notice  Returns the minimum staked amount the staker had during the given epoch
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Minimum staked amount the staker had during the given epoch
     */
    function getStakerMinStakedAmountPerEpoch(
        uint256 _nftId,
        uint256 _epoch
    ) external view returns (uint256);

    /**
     * @notice  Returns the last staked amount the staker had during the given epoch
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Last staked amount the staker had during the given epoch
     */
    function getStakerLastStakedAmountPerEpoch(
        uint256 _nftId,
        uint256 _epoch
    ) external view returns (uint256);

    // NODES

    /**
     * @notice  Returns if a given node ID is a node
     * @param   _nodeId  ID of the node
     * @return  bool  Returns if the given node ID is a node
     */
    function isNode(bytes32 _nodeId) external view returns (bool);

    /**
     * @notice  Returns if a given node ID is an active node
     * @param   _nodeId  ID of the node
     * @return  bool  Returns if the given node ID is an active node
     */
    function isNodeActive(bytes32 _nodeId) external view returns (bool);

    /**
     * @notice  Returns if a given node ID is an inactive node
     * @param   _nodeId  ID of the node
     * @return  bool  Returns if the given node ID is an inactive node
     */
    function isNodeInactive(bytes32 _nodeId) external view returns (bool);

    /**
     * @notice  Returns if a given node ID is a slashed node
     * @param   _nodeId  ID of the node
     * @return  bool  Returns if the given node ID is a slashed node
     */
    function isNodeSlashed(bytes32 _nodeId) external view returns (bool);

    /**
     * @notice  Returns if the node has been slashed with a 100% percentage
     * @param   _nodeId  ID of the node
     * @return  bool  `true` if the slash percentage is 100%, `false` otherwise
     */
    function isNodeFullySlashed(bytes32 _nodeId) external view returns (bool);

    /**
     * @notice  Returns the NFT ID of the operator of a node
     * @param   _nodeId  ID of the node
     * @return  uint256  NFT ID of the operator of the node
     */
    function getNodeOperator(bytes32 _nodeId) external view returns (uint256);

    /**
     * @notice  Returns the staked amount of a node
     * @param   _nodeId  ID of the node
     * @return  uint256  Staked amount of the node
     */
    function getNodeBaseStakedAmount(bytes32 _nodeId) external view returns (uint256);

    /**
     * @notice  Returns the last epoch when the staked amount was updated for a node
     * @param   _nodeId  ID of the node
     * @return  uint256  Last epoch when the staked amount was updated for the node
     */
    function getNodeLastEpochStakingUpdated(bytes32 _nodeId) external view returns (uint256);

    /**
     * @notice  Returns the delegator fee of the node
     * @param   _nodeId  ID of the node
     * @return  uint256  Delegator fee of the node
     */
    function getNodeDelegatorFee(bytes32 _nodeId) external view returns (uint256);

    /**
     * @notice  Returns the maximum amount of MELD tokens that can be staked in the node
     * @param   _nodeId  ID of the node
     * @return  uint256  Maximum amount of MELD tokens that can be staked in the node
     */
    function getNodeMaxStakingAmount(bytes32 _nodeId) external view returns (uint256);

    /**
     * @notice  Returns the timestamp when the node ended its operation
     * @dev If it's 0 it means the node is active
     * @dev This value is only set when the node is slashed or inactive (operator left)
     * @param   _nodeId  ID of the node
     * @return  uint256  Timestamp when the node ended its operation
     */
    function getNodeEndTimestamp(bytes32 _nodeId) external view returns (uint256);

    /**
     * @notice  Returns the percentage of the node that has been slashed
     * @dev     This value is in basis points (10000 = 100%)
     * @dev     If the node has not been slashed, it returns 0
     * @param   _nodeId  ID of the node
     * @return  uint256  Last epoch when the rewards were updated for the node
     */
    function getNodeSlashedPercentage(bytes32 _nodeId) external view returns (uint256);

    /**
     * @notice  Returns if the node has the delegator whitelist enabled
     * @param   _nodeId  ID of the node
     * @return  bool  Returns if the node has the delegator whitelist enabled
     */
    function isDelegatorWhitelistEnabled(bytes32 _nodeId) external view returns (bool);

    /**
     * @notice  Returns the list of delegators of a node
     * @param   _nodeId  ID of the node
     * @return  uint256[]  List of delegators of the node
     */
    function getNodeDelegators(bytes32 _nodeId) external view returns (uint256[] memory);

    /**
     * @notice  Returns the list of epochs when at least a locked position of a node expires
     * @param   _nodeId  ID of the node
     * @return  uint256[]  List of epochs when at least a locked position of a node expires
     */
    function getNodeLockingExcessWeightEpochs(
        bytes32 _nodeId
    ) external view returns (uint256[] memory);

    /**
     * @notice  Returns the minimum staked amount of a node for a given epoch
     * @param   _nodeId  ID of the node
     * @param   _epoch  Epoch to get the minimum staked amount
     * @return  uint256  Minimum staked amount of the node for the given epoch
     */
    function getNodeMinStakedAmountPerEpoch(
        bytes32 _nodeId,
        uint256 _epoch
    ) external view returns (uint256);

    /**
     * @notice  Returns the last staked amount of a node for a given epoch
     * @param   _nodeId  ID of the node
     * @param   _epoch  Epoch to get the last staked amount
     * @return  uint256  Last staked amount of the node for the given epoch
     */
    function getNodeLastStakedAmountPerEpoch(
        bytes32 _nodeId,
        uint256 _epoch
    ) external view returns (uint256);

    /**
     * @notice  Returns the excess weighted stake for a given epoch for a node
     * @dev     This value accounts for the extra weight represented by the staked amount
     *          of locked staking positions that expire in the given epoch
     * @param _nodeId ID of the node that is requested
     * @param   _epoch  Epoch to get the excess weighted stake for
     * @return  uint256  Excess weighted stake for the given epoch
     */
    function getNodeLockingExcessWeightedStakePerEpoch(
        bytes32 _nodeId,
        uint256 _epoch
    ) external view returns (uint256);

    /**
     * @notice  Checks if the address is whitelisted to be a delegator
     * @param   _nodeId  ID of the node
     * @param   _delegatorAddress  Address to check if it is whitelisted to be a delegator
     * @return  bool  Returns if the address is whitelisted to be a delegator
     */
    function isNodeDelegatorWhitelisted(
        bytes32 _nodeId,
        address _delegatorAddress
    ) external view returns (bool);

    /**
     * @notice  Returns the node IDs at a given index
     * @param   _index  Index of the node ID to return
     * @return  bytes32  Node ID in position `_index`
     */
    function nodeIds(uint256 _index) external view returns (bytes32);

    /**
     * @notice  Returns the index of a given node ID
     * @param   _nodeId  ID of the node
     * @return  uint256  Index of the node ID
     */
    function nodeIdsIndex(bytes32 _nodeId) external view returns (uint256);

    /**
     * @notice  Returns the number of nodes
     * @return  uint256  Number of nodes
     */
    function getNumNodes() external view returns (uint256);

    /**
     * @notice  Calculates the delegation fee amount
     * @dev     This is the amount multiplied by the fee %
     * @param   _nodeId  ID of the node
     * @param   _baseAmount  Amount to calculate the fee for
     * @return  uint256  Delegation fee amount
     */
    function calculateDelegationFeeAmount(
        bytes32 _nodeId,
        uint256 _baseAmount
    ) external view returns (uint256);

    // NODE REQUESTS

    /**
     * @notice Returns if a given node request ID is an active node request
     * @param _nodeId ID of the node that is requested
     */
    function nodeRequestExists(bytes32 _nodeId) external view returns (bool);

    /**
     * @notice Returns if a given node request ID is an active node request
     * @param _nodeId ID of the node that is requested
     */
    function getNodeRequest(bytes32 _nodeId) external view returns (NodeRequest memory);

    /**
     * @notice  Returns the node ID of a node request given the operator that requested it
     * @param   _operator  Operator that requested the node
     * @return  bytes32  Node ID of the node requested
     */
    function nodeRequestsPerOperator(uint256 _operator) external view returns (bytes32);

    /**
     * @notice  Returns the node ID of a node request given the index
     * @param   _index  Index of the node request
     * @return  bytes32  Node ID of the node requested
     */
    function activeNodeRequestsIds(uint256 _index) external view returns (bytes32);

    /////// SETTERS ///////

    // GENERAL

    /**
     * @notice  Called from the MeldStakingConfig contract to set the initial values of the staking system
     * @param   _initTimestamp  Timestamp when the staking system starts
     * @param   _epochSize  Duration of an epoch in seconds
     * @param   _slashReceiver  Address that will receive the slashed tokens
     */
    function initializeConfig(
        uint256 _initTimestamp,
        uint256 _epochSize,
        address _slashReceiver
    ) external;

    /**
     * @notice  Sets the address that will receive the slashed tokens
     * @param   _slashReceiver  Address that will receive the slashed tokens
     */
    function setSlashReceiver(address _slashReceiver) external;

    /**
     * @notice  Correlates an actual (un-hashed) node ID with a node ID
     * @param   _nodeId  Hashed node ID
     * @param   _nodeName  Actual (un-hashed) node ID
     */
    function setNodeName(bytes32 _nodeId, string memory _nodeName) external;

    // GLOBAL INFO

    /**
     * @notice  Sets the minimum amount of MELD tokens that can be staked to become an Operator
     * @param   _minStakingAmount  Minimum amount of MELD tokens that can be staked to become an Operator
     */
    function setMinStakingAmount(uint256 _minStakingAmount) external;

    /**
     * @notice  Sets the maximum amount of MELD tokens that can be staked in a node
     * @param   _maxStakingAmount  Maximum amount of MELD tokens that can be staked in a node
     */
    function setMaxStakingAmount(uint256 _maxStakingAmount) external;

    /**
     * @notice  Sets the minimum delegation fee that can be set by a node
     * @param   _minDelegationFee  Minimum delegation fee that can be set by a node
     */
    function setMinDelegationFee(uint256 _minDelegationFee) external;

    /**
     * @notice  Sets the maximum delegation fee that can be set by a node
     * @param   _maxDelegationFee  Maximum delegation fee that can be set by a node
     */
    function setMaxDelegationFee(uint256 _maxDelegationFee) external;

    /**
     * @notice  Sets the total base amount of MELD tokens staked in the system
     * @param   _totalBaseStakedAmount  Total amount of MELD tokens staked in the system
     */
    function setTotalBaseStakedAmount(uint256 _totalBaseStakedAmount) external;

    /**
     * @notice  Sets the total rewards for a given epoch
     * @param   _epoch  Epoch to set the rewards for
     * @param   _totalRewards  Total rewards for the given epoch
     */
    function setRewards(uint256 _epoch, uint256 _totalRewards) external;

    /**
     * @notice  Sets the last epoch when the stuck rewards were updated
     * @param   _epoch  Last epoch when the rewards were updated
     */
    function setLastEpochStuckRewardsUpdated(uint256 _epoch) external;

    /**
     * @notice  Sets the last amount of MELD tokens staked in a given epoch
     * @param   _epoch  Epoch to set the last amount of MELD tokens staked for
     * @param   _lastStakedAmount  Last amount of MELD tokens staked in the given epoch
     */
    function setLastStakedAmountPerEpoch(uint256 _epoch, uint256 _lastStakedAmount) external;

    /**
     * @notice  Sets the excess weighted stake for a given epoch
     * @dev     This value accounts for the extra weight represented by the staked amount
     *          of locked staking positions that expire in the given epoch
     * @param   _epoch  Epoch to set the excess weighted stake for
     * @param   _excessStake  Excess weighted stake for the given epoch
     */
    function setLockingExcessWeightedStakePerEpoch(uint256 _epoch, uint256 _excessStake) external;

    /**
     * @notice  Sets the stuck rewards shares for a given epoch
     * @dev     This value accounts for the unclaimed rewards shares that belong to a
     *          staking position that is redeemed
     * @param   _epoch  Epoch to set the stuck rewards shares for
     * @param   _stuckRewardShares  Stuck rewards shares for the given epoch
     */
    function setStuckRewardSharesPerEpoch(uint256 _epoch, uint256 _stuckRewardShares) external;

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateGlobalPreviousEpochs(uint256 _untilEpoch) external;

    /**
     * @notice  Removes the excess weight of a node from the global excess weight
     * @dev     This is called when a node is slashed, or inactive.
     * @param   _nodeId  ID of the node to remove the excess weight from
     */
    function fixExcessWeights(bytes32 _nodeId) external;

    // LOCK STAKING TIERS

    /**
     * @notice  Adds a new lock staking tier
     * @param   _minStakingAmount  Minimum amount of MELD tokens to stake for this lock staking tieer
     * @param   _stakingLength  Length of the lock staking tier in epochs
     * @param   _weight  Weight to apply to the staked amount to earn rewards
     * @return  uint256  ID of the lock staking tier
     */
    function addLockStakingTier(
        uint256 _minStakingAmount,
        uint256 _stakingLength,
        uint256 _weight
    ) external returns (uint256);

    /**
     * @notice  Removes a lock staking tier
     * @param   _lockTierId  ID of the lock staking tier to remove
     */
    function removeStakingLockTier(uint256 _lockTierId) external;

    // STAKERS

    /**
     * @notice  Creates a new staker
     * @param   _nftId  NFT ID of the staker
     * @param   _stakerTypeValue  Value of the staker type
     * @param   _nodeId  Node ID of the staker
     * @param   _lockTierId  Lock tier ID of the staker
     */
    function createStaker(
        uint256 _nftId,
        uint256 _stakerTypeValue,
        bytes32 _nodeId,
        uint256 _lockTierId
    ) external;

    /**
     * @notice  Removes a staker
     * @param   _nftId  NFT ID of the staker
     */
    function removeStaker(uint256 _nftId) external;

    /**
     * @notice  Sets the node ID of a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _nodeId  Node ID of the staker
     */
    function setStakerNodeId(uint256 _nftId, bytes32 _nodeId) external;

    /**
     * @notice  Sets the base staked amount of a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _baseStakedAmount  Staked amount of the staker
     */
    function setStakerBaseStakedAmount(uint256 _nftId, uint256 _baseStakedAmount) external;

    /**
     * @notice  Sets the last epoch when the staked amount was updated for a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _lastEpochStakingUpdated  Last epoch when the staked amount was updated for the staker
     */
    function setStakerLastEpochStakingUpdated(
        uint256 _nftId,
        uint256 _lastEpochStakingUpdated
    ) external;

    /**
     * @notice  Sets the last epoch when the rewards were updated for a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _lastEpochRewardsUpdated  Last epoch when the rewards were updated for the staker
     */
    function setStakerLastEpochRewardsUpdated(
        uint256 _nftId,
        uint256 _lastEpochRewardsUpdated
    ) external;

    /**
     * @notice  Sets the lock tier ID of a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _lockTierId  Lock tier ID of the staker
     */
    function setStakerLockTierId(uint256 _nftId, uint256 _lockTierId) external;

    /**
     * @notice  Sets the unclaimed rewards of a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _unclaimedRewards  Unclaimed rewards of the staker
     */
    function setStakerUnclaimedRewards(uint256 _nftId, uint256 _unclaimedRewards) external;

    /**
     * @notice  Adds to the cumulative claimed rewards of a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _unclaimedRewards  New rewards to be added to the staker
     */
    function addStakerCumulativeRewards(uint256 _nftId, uint256 _unclaimedRewards) external;

    /**
     * @notice  Sets the minimum staked amount the staker had during the given epoch
     * @param   _nftId  NFT ID of the staker
     * @param   _epoch  Epoch to set the minimum staked amount
     * @param   _minStakedAmount  Minimum staked amount the staker had during the given epoch
     */
    function setStakerMinStakedAmountPerEpoch(
        uint256 _nftId,
        uint256 _epoch,
        uint256 _minStakedAmount
    ) external;

    /**
     * @notice  Sets the last staked amount the staker had during the given epoch
     * @param   _nftId  NFT ID of the staker
     * @param   _epoch  Epoch to set the last staked amount
     * @param   _lastStakedAmount  Last staked amount the staker had during the given epoch
     */
    function setStakerLastStakedAmountPerEpoch(
        uint256 _nftId,
        uint256 _epoch,
        uint256 _lastStakedAmount
    ) external;

    // NODE

    /**
     * @notice  Creates a new node
     * @param   _nodeId  ID of the node
     * @param   _operator  NFT ID of the operator of the node
     * @param   _delegatorFee  Delegator fee of the node
     */
    function createNode(bytes32 _nodeId, uint256 _operator, uint256 _delegatorFee) external;

    /**
     * @notice  Sets a node as inactive
     * @dev     This happens when the node operator leaves the node
     * @param   _nodeId  ID of the node
     */
    function setNodeInactive(bytes32 _nodeId) external;

    /**
     * @notice  Sets a node as slashed
     * @dev     This happens when the node is slashed
     * @param   _nodeId  ID of the node
     * @param   _slashPercentage Percentage of the delegators stake to be slashed in basis points (100 = 1%)
     */
    function setNodeSlashed(bytes32 _nodeId, uint256 _slashPercentage) external;

    /**
     * @notice  Sets the base staked amount of a node
     * @param   _nodeId  ID of the node
     * @param   _baseStakedAmount  Staked amount of the node
     */
    function setNodeBaseStakedAmount(bytes32 _nodeId, uint256 _baseStakedAmount) external;

    /**
     * @notice  Sets the maximum amount of MELD tokens that can be staked in this specific node
     * @param   _nodeId  ID of the node
     * @param   _maxStakingAmount  Max staking amount for the node
     */
    function setNodeMaxStakingAmount(bytes32 _nodeId, uint256 _maxStakingAmount) external;

    /**
     * @notice  Toggles the delegator whitelist of a node
     * @dev     It can enable or disable the delegator whitelist
     * @param   _nodeId  ID of the node
     * @param   _enabled  If the delegator whitelist should be enabled or disabled
     */
    function toggleDelegatorWhitelist(bytes32 _nodeId, bool _enabled) external;

    /**
     * @notice  Enables the delegator whitelist of a node if it's not enabled
     * @param   _nodeId  ID of the node
     */
    function enableNodeWhitelistIfNeeded(bytes32 _nodeId) external;

    /**
     * @notice  Adds a delegator to the whitelist of a node
     * @param   _nodeId  ID of the node
     * @param   _address  Address to add to the whitelist of the node
     */
    function addDelegatorToWhitelist(bytes32 _nodeId, address _address) external;

    /**
     * @notice  Removes a delegator from the whitelist of a node
     * @param   _nodeId  ID of the node
     * @param   _address  Address to remove from the whitelist of the node
     */
    function removeDelegatorFromWhitelist(bytes32 _nodeId, address _address) external;

    /**
     * @notice  Adds a delegator to a node
     * @param   _nodeId  ID of the node
     * @param   _nftId  NFT ID of the delegator
     */
    function addDelegator(bytes32 _nodeId, uint256 _nftId) external;

    /**
     * @notice  Removes a delegator from a node
     * @param   _nodeId  ID of the node
     * @param   _nftId  NFT ID of the delegator
     */
    function removeDelegator(bytes32 _nodeId, uint256 _nftId) external;

    /**
     * @notice  Updates the last and min staked amount of previous epochs for a node
     * @param   _nodeId  ID of the node
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateNodePreviousEpochs(bytes32 _nodeId, uint256 _untilEpoch) external;

    /**
     * @notice  Sets the last staked amount of a node for a given epoch
     * @param   _nodeId  ID of the node
     * @param   _epoch  Epoch to set the last staked amount
     * @param   _lastStakedAmount  Last staked amount of the node for the given epoch
     */
    function setNodeLastStakedAmountPerEpoch(
        bytes32 _nodeId,
        uint256 _epoch,
        uint256 _lastStakedAmount
    ) external;

    /**
     * @notice  Sets the excess weighted stake for a given epoch for a node
     * @dev     This value accounts for the extra weight represented by the staked amount
     *          of locked staking positions that expire in the given epoch
     * @param   _nodeId  ID of the node
     * @param   _epoch  Epoch to set the excess weighted stake for
     * @param   _excessStake  Excess weighted stake for the given epoch
     */
    function setNodeLockingExcessWeightedStakePerEpoch(
        bytes32 _nodeId,
        uint256 _epoch,
        uint256 _excessStake
    ) external;

    // NODE REQUESTS

    /**
     * @notice  Creates a new node request
     * @param   _nodeId  ID of the requested node
     * @param   _operator  NFT ID of the operator of the requested node
     * @param   _delegatorFee  Delegator fee of the requested node
     * @param   _stakingAmount  Staking amount of the requested node
     * @param   _lockTierId  Lock tier ID of the requested node
     */
    function createNodeRequest(
        bytes32 _nodeId,
        uint256 _operator,
        uint256 _delegatorFee,
        uint256 _stakingAmount,
        uint256 _lockTierId
    ) external;

    /**
     * @notice  Removes a node request
     * @param   _nodeId  ID of the requested node
     */
    function removeNodeRequest(bytes32 _nodeId) external;
}
