// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import {IMeldStakingStorage} from "./interfaces/IMeldStakingStorage.sol";
import {StakerLibrary} from "./libraries/StakerLibrary.sol";
import {NodeLibrary} from "./libraries/NodeLibrary.sol";
import {GlobalLibrary} from "./libraries/GlobalLibrary.sol";
import {IMeldStakingAddressProvider} from "./interfaces/IMeldStakingAddressProvider.sol";
import "./Errors.sol";

/**
 * @title MeldStakingStorage
 * @notice This contract contains the storage of the MELD Staking contracts
 * @author MELD team
 */
contract MeldStakingStorage is IMeldStakingStorage, AccessControl {
    using StakerLibrary for StakerLibrary.Staker;
    using NodeLibrary for NodeLibrary.Node;
    using GlobalLibrary for GlobalLibrary.GlobalInfo;

    uint256 public constant override PERCENTAGE_SCALING = 10000; // 100% = 10000 basis points

    address public override slashReceiver;

    mapping(bytes32 nodeId => string nodeName) private nodeNames;

    GlobalLibrary.GlobalInfo private globalInfo;

    mapping(uint256 tierId => LockStakingTier) private lockStakingTiers;
    uint256[] private activeLockStakingTierIds;
    mapping(uint256 tierId => uint256) private activeLockStakingTierIdsIndex;
    uint256 public override lastLockStakingTierId;

    mapping(uint256 nftId => StakerLibrary.Staker) private stakers;
    mapping(bytes32 nodeId => NodeLibrary.Node) private nodes;
    bytes32[] public override nodeIds;
    mapping(bytes32 nodeId => uint256 index) public override nodeIdsIndex;

    mapping(bytes32 nodeRequestId => NodeRequest) private nodeRequests;
    mapping(uint256 operator => bytes32 nodeRequestId) public override nodeRequestsPerOperator;
    bytes32[] public override activeNodeRequestsIds;
    mapping(bytes32 nodeRequestId => uint256) private activeNodeRequestsIdsIndex;

    mapping(address => bool) private validConfigAddress;
    mapping(address => bool) private validConfigOrStakingAddress;

    bool private initialized;

    /**
     * @notice  Checks that the sender of the transaction is the MeldStakingConfig contract
     */
    modifier onlyStakingConfig() {
        require(validConfigAddress[_msgSender()], CALLER_NOT_CONFIG);
        _;
    }

    /**
     * @notice  Checks that the sender of the transaction is any of the other MELD Staking contracts
     */
    modifier onlyStakingOrConfig() {
        require(validConfigOrStakingAddress[_msgSender()], CALLER_NOT_STAKING_OR_CONFIG);
        _;
    }

    /**
     * @notice  Constructor of the contract
     * @param   _defaultAdmin This address will have the `DEFAULT_ADMIN_ROLE`
     */
    constructor(address _defaultAdmin) {
        _setupRole(DEFAULT_ADMIN_ROLE, _defaultAdmin);
    }

    /////// ADMIN FUNCTIONS ///////

    /**
     * @notice  ADMIN: Initializes the contract, setting the addresses of the MELD Staking contracts
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _stakingAddressProvider  Address of the MELD Staking Address Provider
     */
    function initialize(address _stakingAddressProvider) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_stakingAddressProvider != address(0), INVALID_ADDRESS);
        require(!initialized, ALREADY_INITIALIZED);
        IMeldStakingAddressProvider stakingAddressProvider = IMeldStakingAddressProvider(
            _stakingAddressProvider
        );
        require(stakingAddressProvider.initialized(), ADDRESS_PROVIDER_NOT_INITIALIZED);
        validConfigAddress[stakingAddressProvider.meldStakingConfig()] = true;
        validConfigOrStakingAddress[stakingAddressProvider.meldStakingCommon()] = true;
        validConfigOrStakingAddress[stakingAddressProvider.meldStakingDelegator()] = true;
        validConfigOrStakingAddress[stakingAddressProvider.meldStakingOperator()] = true;
        validConfigOrStakingAddress[stakingAddressProvider.meldStakingConfig()] = true;
        initialized = true;
        emit Initialized(_msgSender(), _stakingAddressProvider);
    }

    /////// CONFIG ///////

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
    ) external override onlyStakingConfig {
        globalInfo.minStakingAmount = 100_000 * 1e18; // 100k MELD
        globalInfo.maxStakingAmount = 20_000_000 * 1e18; // 20M MELD
        globalInfo.minDelegationFee = 0; // 0% in basis points
        globalInfo.maxDelegationFee = 10000; // 100% in basis points
        globalInfo.initTimestamp = _initTimestamp;
        globalInfo.epochSize = _epochSize;
        globalInfo.lastEpochRewardsUpdated = 1; // Set to 1 since epoch 1 will not have rewards
        slashReceiver = _slashReceiver;
    }

    /////// GETTERS ///////

    // GENERAL

    /**
     * @notice  Returns the actual (un-hashed) node ID
     * @return  string Actual (un-hashed) node ID
     */
    function getNodeName(bytes32 _nodeId) external view returns (string memory) {
        return nodeNames[_nodeId];
    }

    // GLOBAL INFO

    /**
     * @notice  Returns the minimum amount of MELD tokens that can be staked to become an Operator
     * @return  uint256  Minimum amount of MELD tokens that can be staked to become an Operator
     */
    function getMinStakingAmount() external view override returns (uint256) {
        return globalInfo.minStakingAmount;
    }

    /**
     * @notice  Returns the maximum amount of MELD tokens that can be staked in a node
     * @return  uint256  Maximum amount of MELD tokens that can be staked in a node
     */
    function getMaxStakingAmount() external view override returns (uint256) {
        return globalInfo.maxStakingAmount;
    }

    /**
     * @notice  Returns the minimum delegation fee that can be set by a node
     * @return  uint256  Minimum delegation fee that can be set by a node
     */
    function getMinDelegationFee() external view override returns (uint256) {
        return globalInfo.minDelegationFee;
    }

    /**
     * @notice  Returns the maximum delegation fee that can be set by a node
     * @return  uint256  Maximum delegation fee that can be set by a node
     */
    function getMaxDelegationFee() external view override returns (uint256) {
        return globalInfo.maxDelegationFee;
    }

    /**
     * @notice  Returns the timestamp when the staking system started
     * @return  uint256  Timestamp when the staking system started
     */
    function getInitTimestamp() external view override returns (uint256) {
        return globalInfo.initTimestamp;
    }

    /**
     * @notice  Returns the duration of an epoch in seconds
     * @return  uint256  Duration of an epoch in seconds
     */
    function getEpochSize() external view override returns (uint256) {
        return globalInfo.epochSize;
    }

    /**
     * @notice  Returns the total base amount of MELD tokens staked in the system
     * @return  uint256  Total amount of MELD tokens staked in the system
     */
    function getTotalBaseStakedAmount() external view override returns (uint256) {
        return globalInfo.totalBaseStakedAmount;
    }

    /**
     * @notice  Returns the last epoch when the global info was updated
     * @return  uint256  Last epoch when the global info was updated
     */
    function getLastEpochStakingUpdated() external view override returns (uint256) {
        return globalInfo.lastEpochStakingUpdated;
    }

    /**
     * @notice  Returns the last epoch when the rewards were updated
     * @return  uint256  Last epoch when the rewards were updated
     */
    function getLastEpochRewardsUpdated() external view override returns (uint256) {
        return globalInfo.lastEpochRewardsUpdated;
    }

    /**
     * @notice  Returns the last epoch when the stuck rewards were updated
     * @return  uint256  Last epoch when the stuck rewards were updated
     */
    function getLastEpochStuckRewardsUpdated() external view override returns (uint256) {
        return globalInfo.lastEpochStuckRewardsUpdated;
    }

    /**
     * @notice  Returns the total rewards for a given epoch
     * @param   _epoch  Epoch to get the rewards for
     * @return  uint256  Total rewards for the given epoch
     */
    function getTotalRewardsPerEpoch(uint256 _epoch) external view override returns (uint256) {
        return globalInfo.totalRewardsPerEpoch[_epoch];
    }

    /**
     * @notice  Returns the minimum amount of MELD tokens staked in a given epoch
     * @param   _epoch  Epoch to get the minimum amount of MELD tokens staked for
     * @return  uint256  Minimum amount of MELD tokens staked in the given epoch
     */
    function getMinStakedAmountPerEpoch(uint256 _epoch) external view override returns (uint256) {
        return globalInfo.minStakedAmountPerEpoch[_epoch];
    }

    /**
     * @notice  Returns the last amount of MELD tokens staked in a given epoch
     * @param   _epoch  Epoch to get the last amount of MELD tokens staked for
     * @return  uint256  Last amount of MELD tokens staked in the given epoch
     */
    function getLastStakedAmountPerEpoch(uint256 _epoch) external view override returns (uint256) {
        return globalInfo.lastStakedAmountPerEpoch[_epoch];
    }

    /**
     * @notice  Returns the excess weighted stake for a given epoch
     * @dev     This value accounts for the extra weight represented by the staked amount
     *          of locked staking positions that expire in the given epoch
     * @param   _epoch  Epoch to get the excess weighted stake for
     * @return  uint256  Excess weighted stake for the given epoch
     */
    function getLockingExcessWeightedStakePerEpoch(
        uint256 _epoch
    ) public view override returns (uint256) {
        return globalInfo.lockingExcessWeightedStakePerEpoch[_epoch];
    }

    /**
     * @notice  Returns the stuck rewards shares for a given epoch
     * @dev     This value accounts for the unclaimed rewards shares that belong to a
     *          staking position that is redeemed
     * @param   _epoch  Epoch to get the stuck rewards shares for
     * @return  uint256  Stuck rewards shares for the given epoch
     */
    function getStuckRewardSharesPerEpoch(uint256 _epoch) external view override returns (uint256) {
        return globalInfo.stuckRewardSharesPerEpoch[_epoch];
    }

    // EPOCHS INFO

    /**
     * @notice  Informs about the status of the staking system
     * @dev     Takes into account if the contract has been initialised and the starting timestamp
     * @return  bool  Returns if staking system has started
     */
    function isStakingStarted() public view override returns (bool) {
        return globalInfo.initTimestamp != 0 && block.timestamp >= globalInfo.initTimestamp;
    }

    /**
     * @notice  Returns the current epoch number
     * @dev     Uses helper function to get epoch from the timestamp of the block
     * @return  uint256  Current epoch number
     */
    function getCurrentEpoch() public view override returns (uint256) {
        return getEpoch(block.timestamp);
    }

    /**
     * @notice  Returns the epoch of an arbitrary timestamp
     * @dev     Used for offchain support
     * @param   _timestamp  Timestamp in seconds since epoch (traditional CS epoch)
     * @return  uint256  Epoch number of given timestamp
     */
    function getEpoch(uint256 _timestamp) public view override returns (uint256) {
        if (globalInfo.initTimestamp == 0 || _timestamp < globalInfo.initTimestamp) {
            return 0;
        }
        return ((_timestamp - globalInfo.initTimestamp) / globalInfo.epochSize) + 1;
    }

    /**
     * @notice  Returns the initial timestamp of a given epoch
     * @param   _epoch  Epoch number to get the start of
     * @return  uint256  Timestamp of the start of the epoch
     */
    function getEpochStart(uint256 _epoch) public view override returns (uint256) {
        if (globalInfo.initTimestamp == 0 || _epoch == 0) {
            return 0;
        }
        return globalInfo.initTimestamp + ((_epoch - 1) * globalInfo.epochSize);
    }

    /**
     * @notice  Returns the ending timestamp of a given epoch
     * @param   _epoch  Epoch number to get the end of
     * @return  uint256  Timestamp of the end of the epoch
     */
    function getEpochEnd(uint256 _epoch) public view override returns (uint256) {
        if (globalInfo.initTimestamp == 0 || _epoch == 0) {
            return 0;
        }
        return globalInfo.initTimestamp + (_epoch * globalInfo.epochSize);
    }

    /**
     * @notice  Returns the last epoch that a node was active
     * @param   _nodeId  ID of the node
     * @return  uint256  Last epoch that the node was active
     */
    function getLastActiveEpoch(bytes32 _nodeId) external view override returns (uint256) {
        uint256 endTimestamp = getNodeEndTimestamp(_nodeId);

        if (endTimestamp != 0) {
            // Node is no longer active, so only update until node stopped being active
            return getEpoch(endTimestamp);
        }
        return getCurrentEpoch();
    }

    // LOCK STAKING TIERS

    /**
     * @notice  Return the info of a given lock staking tier
     * @param   _tierId  ID of the lock staking tier to get the info for
     * @return  LockStakingTier  Info of the given lock staking tier
     */
    function getLockStakingTier(
        uint256 _tierId
    ) external view override returns (LockStakingTier memory) {
        return (lockStakingTiers[_tierId]);
    }

    /**
     * @notice  Returns the list of lock staking tiers ids
     * @dev Only the active lock staking tiers are returned
     * @return  uint256[]  List of lock staking tiers ids
     */
    function getActiveLockStakingTierIdList() external view override returns (uint256[] memory) {
        return activeLockStakingTierIds;
    }

    /**
     * @notice  Checks if a given lock staking tier is active
     * @param   _lockTierId  ID of the lock staking tier to check
     * @return  bool  Returns if the given lock staking tier is active
     */
    function isActiveLockStakingTierId(uint256 _lockTierId) external view override returns (bool) {
        return lockStakingTiers[_lockTierId].active;
    }

    // STAKERS

    /**
     * @notice  Returns if a given NFT ID is a staker
     * @param   _nftId  NFT ID to check if it is a staker
     * @return  bool  Returns if the given NFT ID is a staker
     */
    function isStaker(uint256 _nftId) external view override returns (bool) {
        return stakers[_nftId].stakerType != StakerLibrary.StakerType.None;
    }

    /**
     * @notice  Returns if a given NFT ID is an operator
     * @param   _nftId  NFT ID to check if it is an operator
     * @return  bool  Returns if the given NFT ID is an operator
     */
    function isOperator(uint256 _nftId) external view override returns (bool) {
        return stakers[_nftId].stakerType == StakerLibrary.StakerType.Operator;
    }

    /**
     * @notice  Returns if a given NFT ID is a delegator
     * @param   _nftId  NFT ID to check if it is a delegator
     * @return  bool  Returns if the given NFT ID is a delegator
     */
    function isDelegator(uint256 _nftId) external view override returns (bool) {
        return stakers[_nftId].stakerType == StakerLibrary.StakerType.Delegator;
    }

    /**
     * @notice  Returns the base staked amount of a staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Staked amount of the staker
     */
    function getStakerBaseStakedAmount(uint256 _nftId) external view returns (uint256) {
        return stakers[_nftId].baseStakedAmount;
    }

    /**
     * @notice  Returns the node ID of a staker
     * @param   _nftId  NFT ID of the staker
     * @return  bytes32  Node ID of the staker
     */
    function getStakerNodeId(uint256 _nftId) external view override returns (bytes32) {
        return stakers[_nftId].nodeId;
    }

    /**
     * @notice  Returns the last epoch when the staked amount was updated for a staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Last epoch when the staked amount was updated for the staker
     */
    function getStakerLastEpochStakingUpdated(
        uint256 _nftId
    ) external view override returns (uint256) {
        return stakers[_nftId].lastEpochStakingUpdated;
    }

    /**
     * @notice  Returns the last epoch when the rewards were updated for a staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Last epoch when the rewards were updated for the staker
     */
    function getStakerLastEpochRewardsUpdated(
        uint256 _nftId
    ) external view override returns (uint256) {
        return stakers[_nftId].lastEpochRewardsUpdated;
    }

    /**
     * @notice  Returns the lock tier ID of a staker
     * @dev     If the value is 0 it means it is a liquid staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Lock tier ID of the staker
     */
    function getStakerLockTierId(uint256 _nftId) external view override returns (uint256) {
        return stakers[_nftId].lockTierId;
    }

    /**
     * @notice  Returns the unclaimed rewards of a staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Unclaimed rewards of the staker
     */
    function getStakerUnclaimedRewards(uint256 _nftId) external view override returns (uint256) {
        return stakers[_nftId].unclaimedRewards;
    }

    /**
     * @notice  Returns the cumulative claimed rewards of a staker
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Cumulative claimed rewards of the staker
     */
    function getStakerCumulativeRewards(uint256 _nftId) external view override returns (uint256) {
        return stakers[_nftId].cumulativeRewards;
    }

    /**
     * @notice  Returns the timestamp when the staker started
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Timestamp when the staker started
     */
    function getStakerStakingStartTimestamp(
        uint256 _nftId
    ) external view override returns (uint256) {
        return stakers[_nftId].stakingStartTimestamp;
    }

    /**
     * @notice  Returns the minimum staked amount the staker had during the given epoch
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Minimum staked amount the staker had during the given epoch
     */
    function getStakerMinStakedAmountPerEpoch(
        uint256 _nftId,
        uint256 _epoch
    ) external view override returns (uint256) {
        return stakers[_nftId].minStakedAmountPerEpoch[_epoch];
    }

    /**
     * @notice  Returns the last staked amount the staker had during the given epoch
     * @param   _nftId  NFT ID of the staker
     * @return  uint256  Last staked amount the staker had during the given epoch
     */
    function getStakerLastStakedAmountPerEpoch(
        uint256 _nftId,
        uint256 _epoch
    ) external view override returns (uint256) {
        return stakers[_nftId].lastStakedAmountPerEpoch[_epoch];
    }

    // NODES

    /**
     * @notice  Returns if a given node ID is a node
     * @param   _nodeId  ID of the node
     * @return  bool  Returns if the given node ID is a node
     */
    function isNode(bytes32 _nodeId) external view override returns (bool) {
        return nodes[_nodeId].status != NodeLibrary.NodeStatus.None;
    }

    /**
     * @notice  Returns if a given node ID is an active node
     * @param   _nodeId  ID of the node
     * @return  bool  Returns if the given node ID is an active node
     */
    function isNodeActive(bytes32 _nodeId) external view override returns (bool) {
        return nodes[_nodeId].status == NodeLibrary.NodeStatus.Active;
    }

    /**
     * @notice  Returns if a given node ID is an inactive node
     * @param   _nodeId  ID of the node
     * @return  bool  Returns if the given node ID is an inactive node
     */
    function isNodeInactive(bytes32 _nodeId) external view override returns (bool) {
        return nodes[_nodeId].status == NodeLibrary.NodeStatus.Inactive;
    }

    /**
     * @notice  Returns if a given node ID is a slashed node
     * @param   _nodeId  ID of the node
     * @return  bool  Returns if the given node ID is a slashed node
     */
    function isNodeSlashed(bytes32 _nodeId) external view override returns (bool) {
        return nodes[_nodeId].status == NodeLibrary.NodeStatus.Slashed;
    }

    /**
     * @notice  Returns if the node has been slashed with a 100% percentage
     * @param   _nodeId  ID of the node
     * @return  bool  `true` if the slash percentage is 100%, `false` otherwise
     */
    function isNodeFullySlashed(bytes32 _nodeId) external view override returns (bool) {
        return nodes[_nodeId].slashedPercentage == PERCENTAGE_SCALING;
    }

    /**
     * @notice  Returns the NFT ID of the operator of a node
     * @param   _nodeId  ID of the node
     * @return  uint256  NFT ID of the operator of the node
     */
    function getNodeOperator(bytes32 _nodeId) external view override returns (uint256) {
        return nodes[_nodeId].operator;
    }

    /**
     * @notice  Returns the staked amount of a node
     * @param   _nodeId  ID of the node
     * @return  uint256  Staked amount of the node
     */
    function getNodeBaseStakedAmount(bytes32 _nodeId) external view override returns (uint256) {
        return nodes[_nodeId].baseStakedAmount;
    }

    /**
     * @notice  Returns the last epoch when the staked amount was updated for a node
     * @param   _nodeId  ID of the node
     * @return  uint256  Last epoch when the staked amount was updated for the node
     */
    function getNodeLastEpochStakingUpdated(
        bytes32 _nodeId
    ) external view override returns (uint256) {
        return nodes[_nodeId].lastEpochStakingUpdated;
    }

    /**
     * @notice  Returns the delegator fee of the node
     * @param   _nodeId  ID of the node
     * @return  uint256  Delegator fee of the node
     */
    function getNodeDelegatorFee(bytes32 _nodeId) external view override returns (uint256) {
        return nodes[_nodeId].delegatorFee;
    }

    /**
     * @notice  Returns the maximum amount of MELD tokens that can be staked in the node
     * @param   _nodeId  ID of the node
     * @return  uint256  Maximum amount of MELD tokens that can be staked in the node
     */
    function getNodeMaxStakingAmount(bytes32 _nodeId) external view override returns (uint256) {
        return nodes[_nodeId].maxStakingAmount;
    }

    /**
     * @notice  Returns the timestamp when the node ended its operation
     * @dev If it's 0 it means the node is active
     * @dev This value is only set when the node is slashed or inactive (operator left)
     * @param   _nodeId  ID of the node
     * @return  uint256  Timestamp when the node ended its operation
     */
    function getNodeEndTimestamp(bytes32 _nodeId) public view override returns (uint256) {
        return nodes[_nodeId].endTimestamp;
    }

    /**
     * @notice  Returns the percentage of the node that has been slashed
     * @dev     This value is in basis points (10000 = 100%)
     * @dev     If the node has not been slashed, it returns 0
     * @param   _nodeId  ID of the node
     * @return  uint256  Last epoch when the rewards were updated for the node
     */
    function getNodeSlashedPercentage(bytes32 _nodeId) external view override returns (uint256) {
        return nodes[_nodeId].slashedPercentage;
    }

    /**
     * @notice  Returns if the node has the delegator whitelist enabled
     * @param   _nodeId  ID of the node
     * @return  bool  Returns if the node has the delegator whitelist enabled
     */
    function isDelegatorWhitelistEnabled(bytes32 _nodeId) external view override returns (bool) {
        return nodes[_nodeId].delegatorWhitelistEnabled;
    }

    /**
     * @notice  Returns the list of delegators of a node
     * @param   _nodeId  ID of the node
     * @return  uint256[]  List of delegators of the node
     */
    function getNodeDelegators(bytes32 _nodeId) external view override returns (uint256[] memory) {
        return nodes[_nodeId].delegators;
    }

    /**
     * @notice  Returns the list of epochs when at least a locked position of a node expires
     * @param   _nodeId  ID of the node
     * @return  uint256[]  List of epochs when at least a locked position of a node expires
     */
    function getNodeLockingExcessWeightEpochs(
        bytes32 _nodeId
    ) public view override returns (uint256[] memory) {
        return nodes[_nodeId].lockingExcessWeightEpochs;
    }

    /**
     * @notice  Returns the minimum staked amount of a node for a given epoch
     * @param   _nodeId  ID of the node
     * @param   _epoch  Epoch to get the minimum staked amount
     * @return  uint256  Minimum staked amount of the node for the given epoch
     */
    function getNodeMinStakedAmountPerEpoch(
        bytes32 _nodeId,
        uint256 _epoch
    ) external view override returns (uint256) {
        return nodes[_nodeId].minStakedAmountPerEpoch[_epoch];
    }

    /**
     * @notice  Returns the last staked amount of a node for a given epoch
     * @param   _nodeId  ID of the node
     * @param   _epoch  Epoch to get the last staked amount
     * @return  uint256  Last staked amount of the node for the given epoch
     */
    function getNodeLastStakedAmountPerEpoch(
        bytes32 _nodeId,
        uint256 _epoch
    ) external view override returns (uint256) {
        return nodes[_nodeId].lastStakedAmountPerEpoch[_epoch];
    }

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
    ) public view override returns (uint256) {
        return nodes[_nodeId].lockingExcessWeightedStakePerEpoch[_epoch];
    }

    /**
     * @notice  Checks if the address is whitelisted to be a delegator
     * @param   _nodeId  ID of the node
     * @param   _delegatorAddress  Address to check if it is whitelisted to be a delegator
     * @return  bool  Returns if the address is whitelisted to be a delegator
     */
    function isNodeDelegatorWhitelisted(
        bytes32 _nodeId,
        address _delegatorAddress
    ) external view override returns (bool) {
        return nodes[_nodeId].delegatorWhitelist[_delegatorAddress];
    }

    /**
     * @notice  Returns the number of nodes
     * @return  uint256  Number of nodes
     */
    function getNumNodes() external view override returns (uint256) {
        return nodeIds.length;
    }

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
    ) external view returns (uint256) {
        return nodes[_nodeId].calculateDelegationFeeAmount(_baseAmount);
    }

    // NODE REQUESTS

    /**
     * @notice Returns if a given node request ID is an active node request
     * @param _nodeId ID of the node that is requested
     */
    function nodeRequestExists(bytes32 _nodeId) external view override returns (bool) {
        return nodeRequests[_nodeId].requestTimestamp != 0;
    }

    /**
     * @notice Returns if a given node request ID is an active node request
     * @param _nodeId ID of the node that is requested
     */
    function getNodeRequest(bytes32 _nodeId) external view override returns (NodeRequest memory) {
        return nodeRequests[_nodeId];
    }

    /////// SETTERS ///////

    // GENERAL

    /**
     * @notice  Sets the address that will receive the slashed tokens
     * @param   _slashReceiver  Address that will receive the slashed tokens
     */
    function setSlashReceiver(address _slashReceiver) external override onlyStakingConfig {
        slashReceiver = _slashReceiver;
    }

    /**
     * @notice  Correlates an actual (un-hashed) node ID with a node ID
     * @param   _nodeId  Hashed node ID
     * @param   _nodeName  Actual (un-hashed) node ID
     */
    function setNodeName(
        bytes32 _nodeId,
        string memory _nodeName
    ) external override onlyStakingOrConfig {
        nodeNames[_nodeId] = _nodeName;
    }

    // GLOBAL INFO

    /**
     * @notice  Sets the minimum amount of MELD tokens that can be staked to become an Operator
     * @param   _minStakingAmount  Minimum amount of MELD tokens that can be staked to become an Operator
     */
    function setMinStakingAmount(uint256 _minStakingAmount) external override onlyStakingConfig {
        globalInfo.minStakingAmount = _minStakingAmount;
    }

    /**
     * @notice  Sets the maximum amount of MELD tokens that can be staked in a node
     * @param   _maxStakingAmount  Maximum amount of MELD tokens that can be staked in a node
     */
    function setMaxStakingAmount(uint256 _maxStakingAmount) external override onlyStakingConfig {
        globalInfo.maxStakingAmount = _maxStakingAmount;
    }

    /**
     * @notice  Sets the minimum delegation fee that can be set by a node
     * @param   _minDelegationFee  Minimum delegation fee that can be set by a node
     */
    function setMinDelegationFee(uint256 _minDelegationFee) external override onlyStakingConfig {
        globalInfo.minDelegationFee = _minDelegationFee;
    }

    /**
     * @notice  Sets the maximum delegation fee that can be set by a node
     * @param   _maxDelegationFee  Maximum delegation fee that can be set by a node
     */
    function setMaxDelegationFee(uint256 _maxDelegationFee) external override onlyStakingConfig {
        globalInfo.maxDelegationFee = _maxDelegationFee;
    }

    /**
     * @notice  Sets the total base amount of MELD tokens staked in the system
     * @param   _totalBaseStakedAmount  Total amount of MELD tokens staked in the system
     */
    function setTotalBaseStakedAmount(
        uint256 _totalBaseStakedAmount
    ) external override onlyStakingOrConfig {
        globalInfo.totalBaseStakedAmount = _totalBaseStakedAmount;
    }

    /**
     * @notice  Sets the total rewards for a given epoch
     * @param   _epoch  Epoch to set the rewards for
     * @param   _totalRewards  Total rewards for the given epoch
     */
    function setRewards(uint256 _epoch, uint256 _totalRewards) external override onlyStakingConfig {
        globalInfo.totalRewardsPerEpoch[_epoch] = _totalRewards;
        globalInfo.updatePreviousEpochs(_epoch);
        globalInfo.lastEpochRewardsUpdated = _epoch;
    }

    /**
     * @notice  Sets the last epoch when the stuck rewards were updated
     * @param   _epoch  Last epoch when the rewards were updated
     */
    function setLastEpochStuckRewardsUpdated(uint256 _epoch) external override onlyStakingConfig {
        globalInfo.lastEpochStuckRewardsUpdated = _epoch;
    }

    /**
     * @notice  Sets the last amount of MELD tokens staked in a given epoch
     * @param   _epoch  Epoch to set the last amount of MELD tokens staked for
     * @param   _lastStakedAmount  Last amount of MELD tokens staked in the given epoch
     */
    function setLastStakedAmountPerEpoch(
        uint256 _epoch,
        uint256 _lastStakedAmount
    ) external override onlyStakingOrConfig {
        globalInfo.lastStakedAmountPerEpoch[_epoch] = _lastStakedAmount;
        globalInfo.updateMin(_epoch);
    }

    /**
     * @notice  Sets the excess weighted stake for a given epoch
     * @dev     This value accounts for the extra weight represented by the staked amount
     *          of locked staking positions that expire in the given epoch
     * @param   _epoch  Epoch to set the excess weighted stake for
     * @param   _excessStake  Excess weighted stake for the given epoch
     */
    function setLockingExcessWeightedStakePerEpoch(
        uint256 _epoch,
        uint256 _excessStake
    ) public override onlyStakingOrConfig {
        globalInfo.lockingExcessWeightedStakePerEpoch[_epoch] = _excessStake;
    }

    /**
     * @notice  Sets the stuck rewards shares for a given epoch
     * @dev     This value accounts for the unclaimed rewards shares that belong to a
     *          staking position that is redeemed
     * @param   _epoch  Epoch to set the stuck rewards shares for
     * @param   _stuckRewardShares  Stuck rewards shares for the given epoch
     */
    function setStuckRewardSharesPerEpoch(
        uint256 _epoch,
        uint256 _stuckRewardShares
    ) external override onlyStakingOrConfig {
        globalInfo.stuckRewardSharesPerEpoch[_epoch] = _stuckRewardShares;
    }

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateGlobalPreviousEpochs(uint256 _untilEpoch) external override onlyStakingOrConfig {
        globalInfo.updatePreviousEpochs(_untilEpoch);
    }

    /**
     * @notice  Removes the excess weight of a node from the global excess weight
     * @dev     This is called when a node is slashed, or inactive.
     * @param   _nodeId  ID of the node to remove the excess weight from
     */
    function fixExcessWeights(bytes32 _nodeId) external override onlyStakingOrConfig {
        uint256[] memory epochs = getNodeLockingExcessWeightEpochs(_nodeId);

        for (uint256 i = 0; i < epochs.length; i++) {
            uint256 epoch = epochs[i];
            uint256 nodeExcessWeight = getNodeLockingExcessWeightedStakePerEpoch(_nodeId, epoch);
            uint256 globalExcessWeight = getLockingExcessWeightedStakePerEpoch(epoch);
            setLockingExcessWeightedStakePerEpoch(epoch, globalExcessWeight - nodeExcessWeight);
        }
    }

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
    ) external override onlyStakingConfig returns (uint256) {
        lastLockStakingTierId++;
        lockStakingTiers[lastLockStakingTierId] = LockStakingTier({
            minStakingAmount: _minStakingAmount,
            stakingLength: _stakingLength,
            weight: _weight,
            active: true
        });
        activeLockStakingTierIdsIndex[lastLockStakingTierId] = activeLockStakingTierIds.length;
        activeLockStakingTierIds.push(lastLockStakingTierId);
        return lastLockStakingTierId;
    }

    /**
     * @notice  Removes a lock staking tier
     * @param   _lockTierId  ID of the lock staking tier to remove
     */
    function removeStakingLockTier(uint256 _lockTierId) external override onlyStakingConfig {
        uint256 lastLockStakingTierIdIndex = activeLockStakingTierIds.length - 1;
        if (lastLockStakingTierIdIndex != 0) {
            uint256 lockStakingTierIdIndex = activeLockStakingTierIdsIndex[_lockTierId];
            activeLockStakingTierIds[lockStakingTierIdIndex] = activeLockStakingTierIds[
                lastLockStakingTierIdIndex
            ];
            activeLockStakingTierIdsIndex[_lockTierId] = 0;
            activeLockStakingTierIdsIndex[
                activeLockStakingTierIds[lockStakingTierIdIndex]
            ] = lockStakingTierIdIndex;
        }
        activeLockStakingTierIds.pop();
        lockStakingTiers[_lockTierId].active = false;
    }

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
    ) external override onlyStakingOrConfig {
        uint256 currentEpoch = getCurrentEpoch();
        StakerLibrary.Staker storage staker = stakers[_nftId];
        staker.nftId = _nftId;
        staker.stakerType = StakerLibrary.StakerType(_stakerTypeValue);
        staker.nodeId = _nodeId;
        staker.lockTierId = _lockTierId;
        staker.lastEpochStakingUpdated = currentEpoch;
        staker.lastEpochRewardsUpdated = currentEpoch;
        staker.stakingStartTimestamp = block.timestamp;
    }

    /**
     * @notice  Removes a staker
     * @param   _nftId  NFT ID of the staker
     */
    function removeStaker(uint256 _nftId) external override onlyStakingOrConfig {
        delete stakers[_nftId];
    }

    /**
     * @notice  Sets the node ID of a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _nodeId  Node ID of the staker
     */
    function setStakerNodeId(
        uint256 _nftId,
        bytes32 _nodeId
    ) external override onlyStakingOrConfig {
        stakers[_nftId].nodeId = _nodeId;
    }

    /**
     * @notice  Sets the base staked amount of a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _baseStakedAmount  Staked amount of the staker
     */
    function setStakerBaseStakedAmount(
        uint256 _nftId,
        uint256 _baseStakedAmount
    ) external override onlyStakingOrConfig {
        stakers[_nftId].baseStakedAmount = _baseStakedAmount;
    }

    /**
     * @notice  Sets the last epoch when the staked amount was updated for a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _lastEpochStakingUpdated  Last epoch when the staked amount was updated for the staker
     */
    function setStakerLastEpochStakingUpdated(
        uint256 _nftId,
        uint256 _lastEpochStakingUpdated
    ) external override onlyStakingOrConfig {
        stakers[_nftId].lastEpochStakingUpdated = _lastEpochStakingUpdated;
    }

    /**
     * @notice  Sets the last epoch when the rewards were updated for a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _lastEpochRewardsUpdated  Last epoch when the rewards were updated for the staker
     */
    function setStakerLastEpochRewardsUpdated(
        uint256 _nftId,
        uint256 _lastEpochRewardsUpdated
    ) external override onlyStakingOrConfig {
        stakers[_nftId].lastEpochRewardsUpdated = _lastEpochRewardsUpdated;
    }

    /**
     * @notice  Sets the lock tier ID of a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _lockTierId  Lock tier ID of the staker
     */
    function setStakerLockTierId(
        uint256 _nftId,
        uint256 _lockTierId
    ) external override onlyStakingOrConfig {
        stakers[_nftId].lockTierId = _lockTierId;
    }

    /**
     * @notice  Sets the unclaimed rewards of a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _unclaimedRewards  Unclaimed rewards of the staker
     */
    function setStakerUnclaimedRewards(
        uint256 _nftId,
        uint256 _unclaimedRewards
    ) external override onlyStakingOrConfig {
        stakers[_nftId].unclaimedRewards = _unclaimedRewards;
    }

    /**
     * @notice  Adds to the cumulative rewards of a staker
     * @param   _nftId  NFT ID of the staker
     * @param   _addRewardsAmount  Rewards rewards of the staker to add to the cumulative
     */
    function addStakerCumulativeRewards(
        uint256 _nftId,
        uint256 _addRewardsAmount
    ) external override onlyStakingOrConfig {
        stakers[_nftId].cumulativeRewards += _addRewardsAmount;
    }

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
    ) external override onlyStakingOrConfig {
        stakers[_nftId].minStakedAmountPerEpoch[_epoch] = _minStakedAmount;
    }

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
    ) external override onlyStakingOrConfig {
        stakers[_nftId].lastStakedAmountPerEpoch[_epoch] = _lastStakedAmount;
        stakers[_nftId].updateMin(_epoch);
    }

    // NODE

    /**
     * @notice  Creates a new node
     * @param   _nodeId  ID of the node
     * @param   _operator  NFT ID of the operator of the node
     * @param   _delegatorFee  Delegator fee of the node
     */
    function createNode(
        bytes32 _nodeId,
        uint256 _operator,
        uint256 _delegatorFee
    ) external override onlyStakingConfig {
        NodeLibrary.Node storage node = nodes[_nodeId];
        node.nodeId = _nodeId;
        node.status = NodeLibrary.NodeStatus.Active;
        node.operator = _operator;
        node.delegatorFee = _delegatorFee;
        node.maxStakingAmount = globalInfo.maxStakingAmount;
        // node.delegators.push(0);
        node.lastEpochStakingUpdated = getCurrentEpoch();

        nodeIdsIndex[_nodeId] = nodeIds.length;
        nodeIds.push(_nodeId);
    }

    /**
     * @notice  Sets a node as inactive
     * @dev     This happens when the node operator leaves the node
     * @param   _nodeId  ID of the node
     */
    function setNodeInactive(bytes32 _nodeId) external override onlyStakingOrConfig {
        nodes[_nodeId].status = NodeLibrary.NodeStatus.Inactive;
        nodes[_nodeId].endTimestamp = block.timestamp;
    }

    /**
     * @notice  Sets a node as slashed
     * @dev     This happens when the node is slashed
     * @param   _nodeId  ID of the node
     * @param   _slashPercentage Percentage of the delegators stake to be slashed in basis points (100 = 1%)
     */
    function setNodeSlashed(
        bytes32 _nodeId,
        uint256 _slashPercentage
    ) external override onlyStakingConfig {
        nodes[_nodeId].status = NodeLibrary.NodeStatus.Slashed;
        nodes[_nodeId].endTimestamp = block.timestamp;
        nodes[_nodeId].slashedPercentage = _slashPercentage;
    }

    /**
     * @notice  Sets the base staked amount of a node
     * @param   _nodeId  ID of the node
     * @param   _baseStakedAmount  Staked amount of the node
     */
    function setNodeBaseStakedAmount(
        bytes32 _nodeId,
        uint256 _baseStakedAmount
    ) external override onlyStakingOrConfig {
        nodes[_nodeId].baseStakedAmount = _baseStakedAmount;
    }

    /**
     * @notice  Sets the maximum amount of MELD tokens that can be staked in this specific node
     * @param   _nodeId  ID of the node
     * @param   _maxStakingAmount  Max staking amount for the node
     */
    function setNodeMaxStakingAmount(
        bytes32 _nodeId,
        uint256 _maxStakingAmount
    ) external override onlyStakingConfig {
        nodes[_nodeId].maxStakingAmount = _maxStakingAmount;
    }

    /**
     * @notice  Toggles the delegator whitelist of a node
     * @dev     It can enable or disable the delegator whitelist
     * @param   _nodeId  ID of the node
     * @param   _enabled  If the delegator whitelist should be enabled or disabled
     */
    function toggleDelegatorWhitelist(
        bytes32 _nodeId,
        bool _enabled
    ) external override onlyStakingConfig {
        nodes[_nodeId].delegatorWhitelistEnabled = _enabled;
    }

    /**
     * @notice  Enables the delegator whitelist of a node if it's not enabled
     * @param   _nodeId  ID of the node
     */
    function enableNodeWhitelistIfNeeded(bytes32 _nodeId) external override onlyStakingConfig {
        nodes[_nodeId].enableWhitelistIfNeeded();
    }

    /**
     * @notice  Adds a delegator to the whitelist of a node
     * @param   _nodeId  ID of the node
     * @param   _address  Address to add to the whitelist of the node
     */
    function addDelegatorToWhitelist(
        bytes32 _nodeId,
        address _address
    ) external override onlyStakingConfig {
        nodes[_nodeId].addDelegatorToWhitelist(_address);
    }

    /**
     * @notice  Removes a delegator from the whitelist of a node
     * @param   _nodeId  ID of the node
     * @param   _address  Address to remove from the whitelist of the node
     */
    function removeDelegatorFromWhitelist(
        bytes32 _nodeId,
        address _address
    ) external override onlyStakingConfig {
        nodes[_nodeId].removeDelegatorFromWhitelist(_address);
    }

    /**
     * @notice  Adds a delegator to a node
     * @param   _nodeId  ID of the node
     * @param   _nftId  NFT ID of the delegator
     */
    function addDelegator(bytes32 _nodeId, uint256 _nftId) external override onlyStakingOrConfig {
        nodes[_nodeId].addDelegator(_nftId);
    }

    /**
     * @notice  Removes a delegator from a node
     * @param   _nodeId  ID of the node
     * @param   _nftId  NFT ID of the delegator
     */
    function removeDelegator(
        bytes32 _nodeId,
        uint256 _nftId
    ) external override onlyStakingOrConfig {
        nodes[_nodeId].removeDelegator(_nftId);
    }

    /**
     * @notice  Updates the last and min staked amount of previous epochs for a node
     * @param   _nodeId  ID of the node
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateNodePreviousEpochs(
        bytes32 _nodeId,
        uint256 _untilEpoch
    ) external override onlyStakingOrConfig {
        nodes[_nodeId].updatePreviousEpochs(_untilEpoch);
    }

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
    ) external override onlyStakingOrConfig {
        nodes[_nodeId].lastStakedAmountPerEpoch[_epoch] = _lastStakedAmount;
        nodes[_nodeId].updateMin(_epoch);
    }

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
    ) external override onlyStakingOrConfig {
        if (nodes[_nodeId].lockingExcessWeightedStakePerEpoch[_epoch] == 0) {
            nodes[_nodeId].lockingExcessWeightEpochs.push(_epoch);
        }
        nodes[_nodeId].lockingExcessWeightedStakePerEpoch[_epoch] = _excessStake;
    }

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
    ) external override onlyStakingOrConfig {
        NodeRequest memory nodeRequest = NodeRequest({
            operator: _operator,
            requestTimestamp: block.timestamp,
            delegatorFee: _delegatorFee,
            stakingAmount: _stakingAmount,
            lockTierId: _lockTierId
        });
        nodeRequests[_nodeId] = nodeRequest;
        nodeRequestsPerOperator[_operator] = _nodeId;
        activeNodeRequestsIds.push(_nodeId);
        activeNodeRequestsIdsIndex[_nodeId] = activeNodeRequestsIds.length - 1;
    }

    /**
     * @notice  Removes a node request
     * @param   _nodeId  ID of the requested node
     */
    function removeNodeRequest(bytes32 _nodeId) external override onlyStakingOrConfig {
        require(
            activeNodeRequestsIdsIndex[_nodeId] != 0 || activeNodeRequestsIds[0] == _nodeId,
            NODE_REQUEST_DOES_NOT_EXIST
        );
        uint256 operator = nodeRequests[_nodeId].operator;
        // remove from nodeRequests
        delete nodeRequests[_nodeId];

        // remove from nodeRequestsPerOperator
        delete nodeRequestsPerOperator[operator];

        // remove from activeNodeRequestsIds
        uint256 lastIdx = activeNodeRequestsIds.length - 1;
        if (lastIdx != 0) {
            uint256 idx = activeNodeRequestsIdsIndex[_nodeId];
            bytes32 lastNodeId = activeNodeRequestsIds[lastIdx];

            delete activeNodeRequestsIdsIndex[_nodeId];

            activeNodeRequestsIds[idx] = lastNodeId;
            activeNodeRequestsIdsIndex[lastNodeId] = idx;
        }
        activeNodeRequestsIds.pop();
    }
}
