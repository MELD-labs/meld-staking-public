// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {MeldStakingBase} from "./base/MeldStakingBase.sol";
import {IMeldStakingConfig} from "./interfaces/IMeldStakingConfig.sol";
import {IMeldStakingStorage} from "./interfaces/IMeldStakingStorage.sol";
import {IMeldStakingCommon} from "./interfaces/IMeldStakingCommon.sol";
import {IMeldStakingNFT} from "./interfaces/IMeldStakingNFT.sol";
import {IMeldStakingAddressProvider} from "./interfaces/IMeldStakingAddressProvider.sol";
import "./Errors.sol";

/**
 *  @title MeldStakingConfig
 *  @notice This contract represents the staking contract for the MELD token.
 *  @dev Although this contract inherits from MeldStakingBase to provide pausing functionality, it does not have the setTrustedForwarder function.
 *  Meta-transactions are therefore not supported in this contract.
 *  @author MELD team
 */

contract MeldStakingConfig is MeldStakingBase, IMeldStakingConfig {
    IMeldStakingStorage private stakingStorage;
    IMeldStakingCommon private stakingCommon;
    IMeldStakingNFT private stakingNFT;

    bytes32 public constant override REWARDS_SETTER_ROLE = keccak256("REWARDS_SETTER_ROLE");

    /**
     * @notice  Checks the node is active
     * @param   _nodeId  ID of the node to check
     */
    modifier nodeActive(bytes32 _nodeId) {
        require(stakingStorage.isNodeActive(_nodeId), NODE_NOT_ACTIVE);
        _;
    }

    /**
     * @notice  Constructor of the contract
     * @param   _defaultAdmin This address will have the `DEFAULT_ADMIN_ROLE`
     */
    constructor(address _defaultAdmin) {
        _setupRole(DEFAULT_ADMIN_ROLE, _defaultAdmin);
    }

    ///// ADMIN FUNCTIONS /////

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
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_initTimestamp > block.timestamp, INVALID_INIT_TIMESTAMP);
        require(_epochSize > 0, INVALID_EPOCH_SIZE);
        require(_slashReceiver != address(0), INVALID_ADDRESS);
        require(_stakingAddressProvider != address(0), INVALID_ADDRESS);
        require(address(stakingStorage) == address(0), ALREADY_CONFIGURED);
        IMeldStakingAddressProvider addressProvider = IMeldStakingAddressProvider(
            _stakingAddressProvider
        );
        require(addressProvider.initialized(), ADDRESS_PROVIDER_NOT_INITIALIZED);

        stakingStorage = IMeldStakingStorage(addressProvider.meldStakingStorage());
        stakingCommon = IMeldStakingCommon(addressProvider.meldStakingCommon());
        stakingNFT = IMeldStakingNFT(addressProvider.meldStakingNFT());
        stakingStorage.initializeConfig(_initTimestamp, _epochSize, _slashReceiver);

        emit Initialized(
            _msgSender(),
            _initTimestamp,
            _epochSize,
            _slashReceiver,
            _stakingAddressProvider
        );
    }

    /**
     * @notice  ADMIN: Sets the minimum amount of MELD tokens that can be staked to become an Operator
     * @dev     Must be lower than the current maximum. If you intend to increase it, please modify the maximum first
     * @param   _minStakingAmount  New minimum amount needed for operating a node, with all decimals
     */
    function setMinStakingAmount(
        uint256 _minStakingAmount
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 maxStakingAmount = stakingStorage.getMaxStakingAmount();
        uint256 minStakingAmount = stakingStorage.getMinStakingAmount();
        require(_minStakingAmount <= maxStakingAmount, MIN_STAKING_AMOUNT_GREATER_THAN_MAX);
        stakingStorage.setMinStakingAmount(_minStakingAmount);
        emit MinStakingAmountUpdated(_msgSender(), minStakingAmount, _minStakingAmount);
    }

    /**
     * @notice  ADMIN: Sets the maximum amount of MELD tokens that can be staked in a node
     * @dev     Must be higher than the current minimum. If you intend to decrease it, please modify the minimum first
     * @param   _maxStakingAmount  New maximum amount needed for operating a node, with all decimals
     */
    function setMaxStakingAmount(
        uint256 _maxStakingAmount
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 maxStakingAmount = stakingStorage.getMaxStakingAmount();
        uint256 minStakingAmount = stakingStorage.getMinStakingAmount();
        require(_maxStakingAmount >= minStakingAmount, MAX_STAKING_AMOUNT_LESS_THAN_MIN);
        stakingStorage.setMaxStakingAmount(_maxStakingAmount);
        emit MaxStakingAmountUpdated(_msgSender(), maxStakingAmount, _maxStakingAmount);
    }

    /**
     * @notice  ADMIN: Overrides the general maximum of MELD tokens to be staked/delegated for a particular node
     * @dev     Must be higer than the operator minimum stake
     * @param   _nodeId  ID of the node to modify
     * @param   _maxStakingAmount  New amount of maximum staking/delegations allowed
     */
    function setMaxStakingAmountForNode(
        bytes32 _nodeId,
        uint256 _maxStakingAmount
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) nodeActive(_nodeId) {
        uint256 minStakingAmount = stakingStorage.getMinStakingAmount();
        require(_maxStakingAmount >= minStakingAmount, MAX_STAKING_AMOUNT_LESS_THAN_MIN);
        uint256 oldMaxStakingAmount = stakingStorage.getNodeMaxStakingAmount(_nodeId);
        stakingStorage.setNodeMaxStakingAmount(_nodeId, _maxStakingAmount);
        emit MaxStakingAmountForNodeUpdated(
            _msgSender(),
            _nodeId,
            oldMaxStakingAmount,
            _maxStakingAmount
        );
    }

    /**
     * @notice  ADMIN: Sets a new minimum for delegator fees
     * @dev     Must be lower than the current maximum.
     * @param   _minDelegationFee  New delegation fee minimum with two basis points (100 = 1%)
     */
    function setMinDelegationFee(
        uint256 _minDelegationFee
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 maxDelegationFee = stakingStorage.getMaxDelegationFee();
        uint256 minDelegationFee = stakingStorage.getMinDelegationFee();
        require(_minDelegationFee <= maxDelegationFee, MIN_FEE_GREATER_THAN_MAX);
        stakingStorage.setMinDelegationFee(_minDelegationFee);
        emit MinDelegationFeeUpdated(_msgSender(), minDelegationFee, _minDelegationFee);
    }

    /**
     * @notice  ADMIN: Sets a new maximum for delegator fees
     * @dev     Must be higer than the current minimum
     * @param   _maxDelegationFee  New delegation fee maximum with two basis points (100 = 1%)
     */
    function setMaxDelegationFee(
        uint256 _maxDelegationFee
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 maxDelegationFee = stakingStorage.getMaxDelegationFee();
        uint256 minDelegationFee = stakingStorage.getMinDelegationFee();
        require(_maxDelegationFee <= stakingStorage.PERCENTAGE_SCALING(), MAX_FEE_LESS_THAN_100);
        require(_maxDelegationFee >= minDelegationFee, MAX_FEE_LESS_THAN_MIN);
        stakingStorage.setMaxDelegationFee(_maxDelegationFee);
        emit MaxDelegationFeeUpdated(_msgSender(), maxDelegationFee, _maxDelegationFee);
    }

    /**
     * @notice  ADMIN: Sets a new address to receive the slashed funds
     * @param   _slashReceiver  Address of the new slash receiver
     */
    function setSlashReceiver(
        address _slashReceiver
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_slashReceiver != address(0), INVALID_ADDRESS);
        address slashReceiver = stakingStorage.slashReceiver();
        stakingStorage.setSlashReceiver(_slashReceiver);
        emit SlashReceiverUpdated(_msgSender(), slashReceiver, _slashReceiver);
    }

    /**
     * @notice  ADMIN: Creates a new staking lock tier for users to be able to lock their tokens
     * @param   _minStakingAmount  Minimum amount of MELD tokens to stake in this tier (with all decimals)
     * @param   _stakingLength  Duration of the lock period, in number of epochs
     * @param   _weight  Weight of the tokens for rewards calculation
     */
    function addStakingLockTier(
        uint256 _minStakingAmount,
        uint256 _stakingLength,
        uint256 _weight
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 maxStakingAmount = stakingStorage.getMaxStakingAmount();
        require(
            _minStakingAmount <= maxStakingAmount,
            STAKING_TIER_MIN_STAKING_AMOUNT_HIGHER_THAN_GLOBAL_MAX
        );
        require(_stakingLength > 0, STAKING_TIER_LENGTH_ZERO);
        require(_weight > stakingStorage.PERCENTAGE_SCALING(), STAKING_TIER_WEIGHT_BELOW_100);

        uint256 lastLockStakingTierId = stakingStorage.addLockStakingTier(
            _minStakingAmount,
            _stakingLength,
            _weight
        );

        emit StakingLockTierAdded(
            _msgSender(),
            lastLockStakingTierId,
            _minStakingAmount,
            _stakingLength,
            _weight
        );
    }

    /**
     * @notice  ADMIN: Removes a staking lock tier avoiding new stake to happen in this tier
     * @dev     Does not affect existing locked positions on this tier
     * @param   _lockTierId  ID of the tier to remove
     */
    function removeStakingLockTier(
        uint256 _lockTierId
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_lockTierId <= stakingStorage.lastLockStakingTierId(), STAKING_TIER_DOES_NOT_EXIST);
        require(
            stakingStorage.isActiveLockStakingTierId(_lockTierId),
            STAKING_TIER_ALREADY_REMOVED
        );

        stakingStorage.removeStakingLockTier(_lockTierId);

        emit StakingLockTierRemoved(_msgSender(), _lockTierId);
    }

    /**
     * @notice  ADMIN: Updates the stuck rewards
     * @dev     This function calculates the actual rewards that should go to the redeemed NFTs
     *          and subtracts them from the locked meld tokens of the NFT contract
     */
    function updateStuckRewards() external override {
        uint256 lastEpochStuckRewardsUpdated = stakingStorage.getLastEpochStuckRewardsUpdated();
        uint256 lastEpochRewardsUpdated = stakingStorage.getLastEpochRewardsUpdated();
        require(lastEpochRewardsUpdated > lastEpochStuckRewardsUpdated, NO_STUCK_REWARDS_TO_UPDATE);
        uint256 newStuckRewards = 0;

        // If the last epoch stuck rewards updated is 0, then we start from epoch 2
        uint256 fromEpoch = lastEpochStuckRewardsUpdated == 0
            ? 2
            : lastEpochStuckRewardsUpdated + 1;

        for (uint256 epoch = fromEpoch; epoch <= lastEpochRewardsUpdated; epoch++) {
            newStuckRewards +=
                (stakingStorage.getStuckRewardSharesPerEpoch(epoch) *
                    stakingStorage.getTotalRewardsPerEpoch(epoch)) /
                stakingStorage.getMinStakedAmountPerEpoch(epoch);
        }

        if (newStuckRewards == 0) {
            return;
        }

        stakingStorage.setLastEpochStuckRewardsUpdated(lastEpochRewardsUpdated);
        stakingNFT.reduceLockedMeldTokens(newStuckRewards);
        emit StuckRewardsUpdated(
            _msgSender(),
            lastEpochStuckRewardsUpdated,
            lastEpochRewardsUpdated,
            newStuckRewards
        );
    }

    /**
     * @notice  ADMIN: Approves a request from a new operator to create a new node
     * @dev     Until the node is approved, the operator's stake will not count towards rewards
     * @param   _nodeId  ID of the node to approve
     */
    function approveNodeRequest(
        bytes32 _nodeId
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        require(stakingStorage.nodeRequestExists(_nodeId), NODE_REQUEST_DOES_NOT_EXIST);
        IMeldStakingStorage.NodeRequest memory nodeRequest = stakingStorage.getNodeRequest(_nodeId);

        uint256 operator = nodeRequest.operator;
        uint256 stakingAmount = nodeRequest.stakingAmount;

        stakingStorage.createNode(_nodeId, operator, nodeRequest.delegatorFee);

        stakingStorage.createStaker(
            operator,
            1, // OPERATOR TYPE
            _nodeId,
            nodeRequest.lockTierId
        );

        uint256 oldTotalBaseStakedAmount = stakingStorage.getTotalBaseStakedAmount();

        stakingCommon.newStake(operator, stakingAmount);
        stakingStorage.removeNodeRequest(_nodeId);

        emit NodeRequestApproved(_msgSender(), _nodeId, operator, stakingAmount);

        emit TotalBaseStakedAmountChanged(
            _msgSender(),
            oldTotalBaseStakedAmount,
            stakingStorage.getTotalBaseStakedAmount()
        );
    }

    /**
     * @notice  ADMIN: Rejects a request from a new operator to create a new node. NFT is burned and stake is returned to operator
     * @dev     MELD tokens are automatically returned to the user
     * @param   _nodeId  ID of the node to reject
     */
    function rejectNodeRequest(
        bytes32 _nodeId
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        require(stakingStorage.nodeRequestExists(_nodeId), NODE_REQUEST_DOES_NOT_EXIST);
        IMeldStakingStorage.NodeRequest memory nodeRequest = stakingStorage.getNodeRequest(_nodeId);
        stakingStorage.removeNodeRequest(_nodeId);

        address operatorOwner = stakingCommon.ownerOfStakingNFT(nodeRequest.operator);
        stakingCommon.redeemStakingNFT(nodeRequest.operator);
        stakingCommon.withdrawMeld(operatorOwner, nodeRequest.stakingAmount);

        emit NodeRequestRejected(
            _msgSender(),
            _nodeId,
            nodeRequest.operator,
            nodeRequest.stakingAmount
        );
    }

    /**
     * @notice  ADMIN: Slashes a node, sending node staking amount to the slash receiver
     * @dev     The node becomes SLASHED, preventing any further staking or accruing new rewards
     *          Only allows operator and delegators to claim their unclaimed rewards
     * @param   _nodeId  Id of the node to be slashed
     * @param   _slashPercentage Percentage of the delegators stake to be slashed in basis points (100 = 1%)
     */
    function slashNode(
        bytes32 _nodeId,
        uint256 _slashPercentage
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nodeActive(_nodeId) whenNotPaused {
        require(_slashPercentage <= stakingStorage.PERCENTAGE_SCALING(), SLASH_PERCENTAGE_TOO_HIGH);
        uint256 currentEpoch = stakingStorage.getCurrentEpoch();

        // Update everything to current epoch
        stakingStorage.updateNodePreviousEpochs(_nodeId, currentEpoch);
        stakingStorage.updateGlobalPreviousEpochs(currentEpoch);

        uint256 oldTotalBaseStakedAmount = stakingStorage.getTotalBaseStakedAmount();

        uint256 nodeBaseStakedAmount = stakingStorage.getNodeBaseStakedAmount(_nodeId);

        uint256 operatorBaseStakedAmount = stakingStorage.getStakerBaseStakedAmount(
            stakingStorage.getNodeOperator(_nodeId)
        );

        uint256 amountToSlash = operatorBaseStakedAmount +
            ((nodeBaseStakedAmount - operatorBaseStakedAmount) * _slashPercentage) /
            stakingStorage.PERCENTAGE_SCALING();

        // Update node
        uint256 nodeLastStakedAmount = stakingStorage.getNodeLastStakedAmountPerEpoch(
            _nodeId,
            currentEpoch
        );
        stakingStorage.setNodeBaseStakedAmount(_nodeId, 0);
        stakingStorage.setNodeLastStakedAmountPerEpoch(_nodeId, currentEpoch, 0);
        stakingStorage.setNodeSlashed(_nodeId, _slashPercentage);

        // Update global
        uint256 newTotalBaseStakedAmount = oldTotalBaseStakedAmount - nodeBaseStakedAmount;
        stakingStorage.setTotalBaseStakedAmount(newTotalBaseStakedAmount);
        stakingStorage.setLastStakedAmountPerEpoch(
            currentEpoch,
            stakingStorage.getLastStakedAmountPerEpoch(currentEpoch) - nodeLastStakedAmount
        );

        // Update excess weights to make sure the global excess weight is correct
        stakingStorage.fixExcessWeights(_nodeId);

        // Transfer the slashed amount to the slashReceiver
        stakingCommon.withdrawMeld(stakingStorage.slashReceiver(), amountToSlash);

        // Emit events
        emit NodeSlashed(_msgSender(), _nodeId, amountToSlash, _slashPercentage);
        emit TotalBaseStakedAmountChanged(
            _msgSender(),
            oldTotalBaseStakedAmount,
            newTotalBaseStakedAmount
        );
    }

    /**
     * @notice  ADMIN: Sets if a node is able to be delegated into only via whitelist
     * @dev     Requires node to be active
     * @param   _nodeId  Target node ID
     * @param   _flag  true=whitelist active, false=whitelist disabled
     */
    function toggleDelegatorWhitelist(
        bytes32 _nodeId,
        bool _flag
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nodeActive(_nodeId) whenNotPaused {
        stakingStorage.toggleDelegatorWhitelist(_nodeId, _flag);
        emit NodeDelegatorWhitlistToggled(_msgSender(), _nodeId, _flag);
    }

    /**
     * @notice  ADMIN: Adds an address to the node delegator whitelist
     * @dev     Requires node to be active
     * @param   _nodeId  Target node ID
     * @param   _address  Address to be added to the whitelist
     */
    function addDelegatorToWhitelist(
        bytes32 _nodeId,
        address _address
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) nodeActive(_nodeId) {
        stakingStorage.enableNodeWhitelistIfNeeded(_nodeId);
        _addDelegatorToWhitelist(_nodeId, _address);
    }

    /**
     * @notice  ADMIN: Adds a list of addresses to the whitelist of a node delegators
     * @dev     Requires node to be active
     * @param   _nodeId  Target node ID
     * @param   _addresses  List of addresses to be added to the whitelist
     */
    function addDelegatorsToWhitelist(
        bytes32 _nodeId,
        address[] calldata _addresses
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) nodeActive(_nodeId) {
        stakingStorage.enableNodeWhitelistIfNeeded(_nodeId);
        for (uint i = 0; i < _addresses.length; i++) {
            _addDelegatorToWhitelist(_nodeId, _addresses[i]);
        }
    }

    /**
     * @notice  ADMIN: Removes an address from the whitelist of a node delegators
     * @dev     Requires node to be active
     * @param   _nodeId  Target node ID
     * @param   _address  Address to be removed from the whitelist
     */
    function removeDelegatorFromWhitelist(
        bytes32 _nodeId,
        address _address
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) nodeActive(_nodeId) {
        _removeDelegatorFromWhitelist(_nodeId, _address);
    }

    /**
     * @notice  ADMIN: Removes a list of addresses from the whitelist of a node delegators
     * @dev     Requires node to be active
     * @param   _nodeId  Target node ID
     * @param   _addresses  List of addresses to be removed from the whitelist
     */
    function removeDelegatorsFromWhitelist(
        bytes32 _nodeId,
        address[] calldata _addresses
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) nodeActive(_nodeId) {
        for (uint i = 0; i < _addresses.length; i++) {
            _removeDelegatorFromWhitelist(_nodeId, _addresses[i]);
        }
    }

    /**
     * @notice  REWARD_SETTER: Sets the amount of rewards to be distributed in one epoch.
     * @dev     The signer of this transaction must be the rewards setter
     * @dev     Needs previous epochs to be "rewarded"
     * @param   _amount  Rewarded amount in MELD tokens with all decimals
     * @param   _epoch  Epoch to distribute rewards to
     */
    function setRewards(
        uint256 _amount,
        uint256 _epoch
    ) external override onlyRole(REWARDS_SETTER_ROLE) whenNotPaused {
        require(_epoch == stakingStorage.getLastEpochRewardsUpdated() + 1, REWARDS_INVALID_EPOCH);
        require(_epoch < stakingStorage.getCurrentEpoch(), REWARDS_CURRENT_OR_FUTURE_EPOCH);
        require(_amount > 0, REWARDS_INVALID_AMOUNT);
        stakingStorage.setRewards(_epoch, _amount);
        stakingCommon.depositMeld(_msgSender(), _amount);

        emit RewardsSet(_msgSender(), _epoch, _amount);
    }

    ///// PRIVATE FUNCTIONS /////

    /**
     * @notice  Adds a delegator to the whitelist of a node
     * @dev     Calls the storage contract to add the delegator to the whitelist
     * @param   _nodeId  ID of the node to add the delegator to
     * @param   _address  Address of the delegator to add
     */
    function _addDelegatorToWhitelist(bytes32 _nodeId, address _address) private {
        stakingStorage.addDelegatorToWhitelist(_nodeId, _address);
        emit NodeDelegatorAddedToWhitelist(_msgSender(), _nodeId, _address);
    }

    /**
     * @notice  Removes a delegator from the whitelist of a node
     * @dev     Calls the storage contract to remove the delegator from the whitelist
     * @param   _nodeId  ID of the node to remove the delegator from
     * @param   _address  Address of the delegator to remove
     */
    function _removeDelegatorFromWhitelist(bytes32 _nodeId, address _address) private {
        stakingStorage.removeDelegatorFromWhitelist(_nodeId, _address);
        emit NodeDelegatorRemovedFromWhitelist(_msgSender(), _nodeId, _address);
    }
}
