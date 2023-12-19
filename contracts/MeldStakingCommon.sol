// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {MeldStakingBase} from "./base/MeldStakingBase.sol";
import {RescueTokens} from "./base/RescueTokens.sol";
import {IMeldStakingCommon} from "./interfaces/IMeldStakingCommon.sol";
import {IMeldStakingStorage} from "./interfaces/IMeldStakingStorage.sol";
import {IMeldStakingAddressProvider} from "./interfaces/IMeldStakingAddressProvider.sol";
import {IMeldStakingNFT} from "./interfaces/IMeldStakingNFT.sol";
import "./Errors.sol";

/**
 * @title MeldStakingCommon
 * @notice This contract contains functions that are common to both the MELD Staking Operator and Delegator
 * @author MELD team
 */
contract MeldStakingCommon is MeldStakingBase, RescueTokens, IMeldStakingCommon {
    IMeldStakingStorage private stakingStorage;
    IMeldStakingAddressProvider private stakingAddressProvider;

    mapping(address => bool) private validConfigOrStakingAddress;

    /**
     * @notice  Checks that the sender of the transaction is one of the staking contracts
     */
    modifier onlyStakingOrConfig() {
        require(validConfigOrStakingAddress[_msgSender()], CALLER_NOT_STAKING_OR_CONFIG);
        _;
    }

    /**
     * @notice  Checks that the staking period has started and allows for actions around it
     * @dev     Uses the function isStakingStarted() from the storage contract
     */
    modifier stakingStarted() {
        require(stakingStorage.isStakingStarted(), STAKING_NOT_STARTED);
        _;
    }

    /**
     * @notice  Checks if the sender of the transaction is the owner of certain NFT
     * @param   _nftId  NFT ID to check
     */
    modifier isNftOwner(uint256 _nftId) {
        require(ownerOfStakingNFT(_nftId) == _msgSender(), NOT_NFT_OWNER);
        _;
    }

    /**
     * @notice  Checks if the NFT ID corresponds to a staker
     * @param   _nftId  NFT ID to check
     */
    modifier isStaker(uint256 _nftId) {
        require(stakingStorage.isStaker(_nftId), STAKER_DOES_NOT_EXIST);
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
     * @notice  ADMIN: Initializes the contract, setting the address of the MELD Staking Storage, and a list of valid staking and config contracts
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _stakingAddressProvider  Address of the MELD Staking Address Provider
     */
    function initialize(
        address _stakingAddressProvider
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) notTrustedForwarder {
        require(_stakingAddressProvider != address(0), INVALID_ADDRESS);
        require(
            address(stakingStorage) == address(0) && address(stakingAddressProvider) == address(0),
            ALREADY_INITIALIZED
        );
        stakingAddressProvider = IMeldStakingAddressProvider(_stakingAddressProvider);
        require(stakingAddressProvider.initialized(), ADDRESS_PROVIDER_NOT_INITIALIZED);
        stakingStorage = IMeldStakingStorage(stakingAddressProvider.meldStakingStorage());

        validConfigOrStakingAddress[stakingAddressProvider.meldStakingDelegator()] = true;
        validConfigOrStakingAddress[stakingAddressProvider.meldStakingOperator()] = true;
        validConfigOrStakingAddress[stakingAddressProvider.meldStakingConfig()] = true;
        emit Initialized(_msgSender(), _stakingAddressProvider);
    }

    /**
     * @notice Sets the trusted forwarder address
     * @dev Only callable by an account with TRUSTED_FORWARDER_SETTER_ROLE
     * @dev The trusted forwarder is used to support meta-transactions
     * @param _forwarder The address of the trusted forwarder
     */
    function setTrustedForwarder(
        address _forwarder
    ) public virtual onlyRole(TRUSTED_FORWARDER_SETTER_ROLE) notTrustedForwarder {
        emit TrustedForwarderChanged(_msgSender(), getTrustedForwarder(), _forwarder);
        _setTrustedForwarder(_forwarder);
    }

    /////// EXTERNAL STAKING CONTRACTS FUNCTIONS ///////

    /**
     * @notice  Calls the Staking NFT contract to deposit MELD tokens in it
     * @dev     This function acts as a bridge to the Staking NFT contract to be called from the other Staking Contracts
     * @param   _from  Address to deposit the MELD tokens from
     * @param   _amount  Amount of MELD tokens to deposit
     */
    function depositMeld(address _from, uint256 _amount) external override onlyStakingOrConfig {
        _getMeldStakingNFT().depositMeld(_from, _amount);
    }

    /**
     * @notice  Calls the Staking NFT contract to withdraw MELD tokens from it
     * @dev     This function acts as a bridge to the Staking NFT contract to be called from the other Staking Contracts
     * @param   _to  Address to withdraw the MELD tokens to
     * @param   _amount  Amount of MELD tokens to withdraw
     */
    function withdrawMeld(address _to, uint256 _amount) external override onlyStakingOrConfig {
        _getMeldStakingNFT().withdrawMeld(_to, _amount);
    }

    /**
     * @notice  Calls the Staking NFT contract to mint a new NFT
     * @dev     This function acts as a bridge to the Staking NFT contract to be called from the other Staking Contracts
     * @dev     Minting an NFT will also deposit the MELD tokens in the Staking NFT contract
     * @param   _to  Address to mint the NFT to
     * @param   _amount  Amount of MELD tokens to deposit in order to mint the NFT
     * @return  uint256  Returns the ID of the minted NFT
     */
    function mintStakingNFT(
        address _to,
        uint256 _amount
    ) external override onlyStakingOrConfig returns (uint256) {
        return _getMeldStakingNFT().mint(_to, _amount);
    }

    /**
     * @notice  Calls the Staking NFT contract to redeem an NFT
     * @dev     This function acts as a bridge to the Staking NFT contract to be called from the other Staking Contracts
     * @param   _nftId  ID of the NFT to redeem
     */
    function redeemStakingNFT(uint256 _nftId) external override onlyStakingOrConfig {
        _getMeldStakingNFT().redeem(_nftId);
    }

    /**
     * @notice  Common logic to be called when a new stake is made. Will update values in the storage contract
     * @dev     This function will be called from the other Staking Contracts
     * @param   _nftId  ID of the staking position
     * @param   _newAmount  Amount of MELD tokens to stake
     */
    function newStake(uint256 _nftId, uint256 _newAmount) external onlyStakingOrConfig {
        uint256 lockTierId = stakingStorage.getStakerLockTierId(_nftId);
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);

        uint256 currentEpoch = stakingStorage.getCurrentEpoch();

        // Not updating staker because it's a brand new stake
        stakingStorage.updateNodePreviousEpochs(nodeId, currentEpoch);
        stakingStorage.updateGlobalPreviousEpochs(currentEpoch);

        uint256 feeAmount = 0;
        uint256 weightedAmount = getWeightedAmount(_newAmount, lockTierId);

        if (stakingStorage.isDelegator(_nftId)) {
            // update operator's previous epochs
            uint256 operator = stakingStorage.getNodeOperator(nodeId);
            _updateStakerPreviousEpochs(operator, currentEpoch);
            feeAmount = stakingStorage.calculateDelegationFeeAmount(nodeId, _newAmount);
            stakingStorage.setStakerLastStakedAmountPerEpoch(
                operator,
                currentEpoch,
                stakingStorage.getStakerLastStakedAmountPerEpoch(operator, currentEpoch) + feeAmount
            );
        }

        stakingStorage.setStakerLastStakedAmountPerEpoch(
            _nftId,
            currentEpoch,
            weightedAmount - feeAmount
        );
        stakingStorage.setNodeLastStakedAmountPerEpoch(
            nodeId,
            currentEpoch,
            stakingStorage.getNodeLastStakedAmountPerEpoch(nodeId, currentEpoch) + weightedAmount
        );
        stakingStorage.setLastStakedAmountPerEpoch(
            currentEpoch,
            stakingStorage.getLastStakedAmountPerEpoch(currentEpoch) + weightedAmount
        );

        stakingStorage.setStakerBaseStakedAmount(_nftId, _newAmount);
        stakingStorage.setNodeBaseStakedAmount(
            nodeId,
            stakingStorage.getNodeBaseStakedAmount(nodeId) + _newAmount
        );
        stakingStorage.setTotalBaseStakedAmount(
            stakingStorage.getTotalBaseStakedAmount() + _newAmount
        );

        if (lockTierId != 0) {
            _registerLockStaking(_nftId, lockTierId);
        }
    }

    /**
     * @notice  This function transfers then excess weight of the node of the `nftId` to another node
     * @dev     This function will be called from the Delegator Staking Contract when changing a delegation
     * @param   _nftId  ID of the staking position
     * @param   _newNodeId  ID of the new node to transfer the excess weight to
     */
    function transferExcessWeight(
        uint256 _nftId,
        bytes32 _newNodeId
    ) external override onlyStakingOrConfig {
        uint256 lockTierId = stakingStorage.getStakerLockTierId(_nftId);

        if (lockTierId == 0) {
            return;
        }
        uint256 endLockEpoch = _getEndLockEpoch(_nftId);
        uint256 excessWeightedStake = _getExcessWeightedStake(_nftId);
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);

        // Remove excess weighted stake from the old node
        stakingStorage.setNodeLockingExcessWeightedStakePerEpoch(
            nodeId,
            endLockEpoch,
            stakingStorage.getNodeLockingExcessWeightedStakePerEpoch(nodeId, endLockEpoch) -
                excessWeightedStake
        );

        // Add excess weighted stake to the new node
        stakingStorage.setNodeLockingExcessWeightedStakePerEpoch(
            _newNodeId,
            endLockEpoch,
            stakingStorage.getNodeLockingExcessWeightedStakePerEpoch(_newNodeId, endLockEpoch) +
                excessWeightedStake
        );
    }

    /////// USER FUNCTIONS ///////

    /**
     * @notice  Claims the pending rewards of past epochs of a staking position
     * @dev     Can only be done by owner of position
     * @param   _nftId  Staking position NFT ID to claim rewards from
     */
    function claimRewards(
        uint256 _nftId
    ) public override stakingStarted isNftOwner(_nftId) isStaker(_nftId) {
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);

        uint256 unclaimedRewards = updateUnclaimedRewards(_nftId);

        if (unclaimedRewards == 0) {
            return;
        }

        stakingStorage.setStakerUnclaimedRewards(_nftId, 0);
        stakingStorage.addStakerCumulativeRewards(_nftId, unclaimedRewards);

        _getMeldStakingNFT().withdrawMeld(_msgSender(), unclaimedRewards);

        // If node is slashed, redeem the NFT and remove the staker
        // Only if the staker is an operator (they are always 100% slashed)
        // Or if the staker is a delegator and the node is 100% slashed
        if (
            stakingStorage.isNodeSlashed(nodeId) &&
            (stakingStorage.isOperator(_nftId) ||
                (stakingStorage.isDelegator(_nftId) && stakingStorage.isNodeFullySlashed(nodeId)))
        ) {
            _getMeldStakingNFT().redeem(_nftId);

            if (stakingStorage.isDelegator(_nftId)) {
                stakingStorage.removeDelegator(nodeId, _nftId);
            }
            _registerStuckRewardShares(_nftId);
            stakingStorage.removeStaker(_nftId);
        }

        emit RewardsClaimed(_nftId, unclaimedRewards);
    }

    /**
     * @notice  Claims the pending rewards of past epochs of multiple staking positions
     * @dev     Can only be done by owner of the NFTs
     * @param   _nftIds  List of NFT IDs to claim rewards from
     */
    function claimRewards(uint256[] memory _nftIds) public override {
        for (uint i = 0; i < _nftIds.length; i++) {
            claimRewards(_nftIds[i]);
        }
    }

    /**
     * @notice  Claims the pending rewards of past epochs of all staking positions of a user
     * @dev     Can only be done by owner of the NFTs
     */
    function claimAllMyRewards() external override {
        uint256[] memory myNfts = _getMeldStakingNFT().getAllTokensByOwner(_msgSender());
        require(myNfts.length > 0, NO_STAKING_POSITIONS);
        claimRewards(myNfts);
    }

    /**
     * @notice  Updates the unclaimed rewards of a staker
     * @param   _nftId  ID of the staker to update
     */
    function updateUnclaimedRewards(
        uint256 _nftId
    ) public override isStaker(_nftId) returns (uint256) {
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);
        require(stakingStorage.isNode(nodeId), NODE_DOES_NOT_EXIST);
        uint256 untilEpoch = stakingStorage.getLastActiveEpoch(nodeId);
        _updateStakerPreviousEpochs(_nftId, untilEpoch);
        stakingStorage.updateNodePreviousEpochs(nodeId, untilEpoch);
        stakingStorage.updateGlobalPreviousEpochs(untilEpoch);

        uint256 stakerLastEpochRewardsUpdated = stakingStorage.getStakerLastEpochRewardsUpdated(
            _nftId
        );
        uint256 fromEpoch = stakerLastEpochRewardsUpdated == 0
            ? 2
            : stakerLastEpochRewardsUpdated + 1;
        uint256 oldUnclaimedRewards = stakingStorage.getStakerUnclaimedRewards(_nftId);
        uint256 calculateUntilEpoch = stakingStorage.getLastEpochRewardsUpdated();
        uint256 newUnclaimedRewards = oldUnclaimedRewards;

        if (untilEpoch > 1 && untilEpoch <= calculateUntilEpoch) {
            // If this is true, the node ended operations before (or at the same epoch) the last rewards were set
            // So only should update rewards until the last epoch the node was active for a full epoch
            calculateUntilEpoch = untilEpoch - 1; // The -1 is because no rewards should be awarded for the epoch the node stopped
        }

        for (uint256 epoch = fromEpoch; epoch <= calculateUntilEpoch; epoch++) {
            uint256 rewards = (stakingStorage.getStakerMinStakedAmountPerEpoch(_nftId, epoch) *
                stakingStorage.getTotalRewardsPerEpoch(epoch)) /
                stakingStorage.getMinStakedAmountPerEpoch(epoch);
            newUnclaimedRewards += rewards;
        }

        stakingStorage.setStakerUnclaimedRewards(_nftId, newUnclaimedRewards);
        stakingStorage.setStakerLastEpochRewardsUpdated(_nftId, calculateUntilEpoch);
        emit UnclaimedRewardsUpdated(
            _nftId,
            oldUnclaimedRewards,
            newUnclaimedRewards,
            fromEpoch,
            calculateUntilEpoch
        );
        return newUnclaimedRewards;
    }

    /**
     * @notice  Updates the staking information of a staker in previous epochs
     * @param   _nftId  ID of the staker to update
     */
    function updateStakerPreviousEpochs(
        uint256 _nftId
    ) public override isStaker(_nftId) whenNotPaused {
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);
        require(stakingStorage.isNode(nodeId), NODE_DOES_NOT_EXIST);
        uint256 untilEpoch = stakingStorage.getLastActiveEpoch(nodeId);
        _updateStakerPreviousEpochs(_nftId, untilEpoch);
    }

    /**
     * @notice  Updates the staking information of a staker in previous epochs until a certain epoch
     * @param   _nftId  ID of the staker to update
     * @param   _untilEpoch  Epoch until the staking information will be updated
     */
    function updateStakerPreviousEpochs(uint256 _nftId, uint256 _untilEpoch) external override {
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);
        require(stakingStorage.isNode(nodeId), NODE_DOES_NOT_EXIST);
        uint256 untilEpoch = stakingStorage.getLastActiveEpoch(nodeId);
        require(_untilEpoch <= untilEpoch, INVALID_EPOCH);
        _updateStakerPreviousEpochs(_nftId, _untilEpoch);
    }

    /**
     * @notice  Updates the staking information of multiple stakers in previous epochs
     * @dev     This function is useful to update the staking information of multiple stakers in a single transaction
     * @param   _nftIds  List of IDs of the stakers to update
     */
    function updateStakersPreviousEpochs(uint256[] memory _nftIds) public override {
        for (uint i = 0; i < _nftIds.length; i++) {
            updateStakerPreviousEpochs(_nftIds[i]);
        }
    }

    /**
     * @notice  Updates the staking information of all staking positions owned by an address
     */
    function updateAllMyStakersPreviousEpochs() external override {
        uint256[] memory myNfts = _getMeldStakingNFT().getAllTokensByOwner(_msgSender());
        require(myNfts.length > 0, NO_STAKING_POSITIONS);
        updateStakersPreviousEpochs(myNfts);
    }

    /**
     * @notice  Registers the stuck rewards when a staker NFT is redeemed if necessary
     * @param   _nftId  Id of the staking position
     */
    function registerStuckRewardShares(uint256 _nftId) public override onlyStakingOrConfig {
        _registerStuckRewardShares(_nftId);
    }

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _nodeId  Node ID to update
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateNodePreviousEpochs(bytes32 _nodeId, uint256 _untilEpoch) external override {
        uint256 currentEpoch = stakingStorage.getCurrentEpoch();
        require(_untilEpoch <= currentEpoch, INVALID_EPOCH);
        stakingStorage.updateNodePreviousEpochs(_nodeId, _untilEpoch);
    }

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateGlobalPreviousEpochs(uint256 _untilEpoch) external override {
        uint256 currentEpoch = stakingStorage.getCurrentEpoch();
        require(_untilEpoch <= currentEpoch, INVALID_EPOCH);
        stakingStorage.updateGlobalPreviousEpochs(_untilEpoch);
    }

    /////// RESCUE TOKENS ///////

    /**
     * @notice Allows the admin to rescue ERC20 tokens sent to this contract
     * @dev Only callable by an account with DEFAULT_ADMIN_ROLE
     * @param _token The address of the ERC20 token to rescue
     * @param _to The account to transfer the ERC20 tokens to
     */
    function rescueERC20(address _token, address _to) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _rescueERC20(_token, _to);
    }

    /**
     * @notice Allows the admin to rescue ERC721 tokens sent to this contract
     * @dev Only callable by an account with DEFAULT_ADMIN_ROLE
     * @param _token The address of the ERC721 token to rescue
     * @param _to The account to transfer the ERC721 tokens to
     * @param _tokenId The ID of the ERC721 token to rescue
     */
    function rescueERC721(
        address _token,
        address _to,
        uint256 _tokenId
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _rescueERC721(_token, _to, _tokenId);
    }

    /**
     * @notice Allows the admin to rescue ERC1155 tokens sent to this contract
     * @dev Only callable by an account with DEFAULT_ADMIN_ROLE
     * @param _token The address of the ERC1155 token to rescue
     * @param _to The account to transfer the ERC1155 tokens to
     * @param _tokenId The ID of the ERC1155 token to rescue
     */
    function rescueERC1155(
        address _token,
        address _to,
        uint256 _tokenId
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _rescueERC1155(_token, _to, _tokenId);
    }

    /////// PUBLIC VIEWS ///////

    /**
     * @notice  Checks if an amount is valid for a certain lock tier
     * @dev     If the lock tier is 0, then it's a liquid staking position and no further checks are needed
     * @dev     The lock tier id must correspond to an active lock tier
     * @param   _lockTierId  Lock tier ID to check
     * @param   _amount  Amount to check
     * @return  bool  True if the amount is valid for the lock tier, false otherwise
     */
    function isValidLockTier(
        uint256 _lockTierId,
        uint256 _amount
    ) external view override returns (bool) {
        if (_lockTierId != 0) {
            if (!stakingStorage.isActiveLockStakingTierId(_lockTierId)) {
                return false;
            }
            if (stakingStorage.getLockStakingTier(_lockTierId).minStakingAmount > _amount) {
                return false;
            }
        }
        return true;
    }

    /**
     * @notice  Return the owner of a staking position
     * @param   _nftId ID of the staking position
     * @return  address  Owner of the staking position
     */
    function ownerOfStakingNFT(uint256 _nftId) public view override returns (address) {
        return _getMeldStakingNFT().ownerOf(_nftId);
    }

    /**
     * @notice  Returns the timestamp when the end of the locking position will occur
     * @dev     It will returns 0 if the staking position is liquid
     * @param   _nftId  ID of the staking position
     * @return  uint256  Timestamp of the end of the locking position
     */
    function getEndLockTimestamp(
        uint256 _nftId
    ) public view override isStaker(_nftId) returns (uint256) {
        return _getEndLockTimestamp(_nftId);
    }

    /**
     * @notice  Returns the epoch when the end of the locking position will occur
     * @dev     It will returns 0 if the staking position is liquid
     * @param   _nftId  ID of the staking position
     * @return  uint256  Epoch of the end of the locking position
     */
    function getEndLockEpoch(
        uint256 _nftId
    ) public view override isStaker(_nftId) returns (uint256) {
        return _getEndLockEpoch(_nftId);
    }

    /**
     * @notice  Returns the equivalent weight of rewards of an amount locked in certain lock tier
     * @param   _amount  Amount of MELD tokens to calculate
     * @param   _lockTierId  Lock tier ID
     * @return  uint256  Equivalent weight for rewards calculation
     */
    function getWeightedAmount(
        uint256 _amount,
        uint256 _lockTierId
    ) public view override returns (uint256) {
        if (_lockTierId == 0) {
            // Liquid staking
            return _amount;
        }

        uint256 weight = stakingStorage.getLockStakingTier(_lockTierId).weight;
        return (_amount * weight) / stakingStorage.PERCENTAGE_SCALING();
    }

    /////// PRIVATE FUNCTIONS ///////

    /**
     * @notice  Updates the staking information of a staker in previous epochs until a certain epoch
     * @param   _nftId  ID of the staker to update
     * @param   _untilEpoch  Epoch until the staking information will be updated
     */
    function _updateStakerPreviousEpochs(uint256 _nftId, uint256 _untilEpoch) private {
        uint256 lastEpochUpdated = stakingStorage.getStakerLastEpochStakingUpdated(_nftId);
        if (lastEpochUpdated >= _untilEpoch) {
            return;
        }
        uint256 rollingAmount = stakingStorage.getStakerLastStakedAmountPerEpoch(
            _nftId,
            lastEpochUpdated
        );

        uint256 endLockEpoch = _getEndLockEpoch(_nftId);

        for (uint256 epoch = lastEpochUpdated + 1; epoch <= _untilEpoch; epoch++) {
            stakingStorage.setStakerLastStakedAmountPerEpoch(_nftId, epoch, rollingAmount);
            stakingStorage.setStakerMinStakedAmountPerEpoch(_nftId, epoch, rollingAmount);
            if (epoch == endLockEpoch) {
                uint256 newAmount = _upgradeLockedToLiquid(_nftId, epoch);
                // Update rollingAmount since it has decreased when upgrading to liquid
                rollingAmount = newAmount;
            }
        }
        stakingStorage.setStakerLastEpochStakingUpdated(_nftId, _untilEpoch);
    }

    /**
     * @notice  Upgrades a locked staking position to a liquid staking position
     * @dev     This is called when the end of the locking period is reached
     * @param   _nftId  ID of the staking position
     * @param   _epoch  Epoch when the upgrade will occur
     * @return  uint256  Returns the new staked amount of the staking position
     */
    function _upgradeLockedToLiquid(uint256 _nftId, uint256 _epoch) private returns (uint256) {
        // Calculate how much the stake position will decrease
        uint256 excessWeightedStake = _getExcessWeightedStake(_nftId);

        // Reduce staker weighted stake
        uint256 newStakerLastStakedAmount = stakingStorage.getStakerLastStakedAmountPerEpoch(
            _nftId,
            _epoch
        ) - excessWeightedStake;
        stakingStorage.setStakerLastStakedAmountPerEpoch(_nftId, _epoch, newStakerLastStakedAmount);

        // Updated node
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);
        stakingStorage.updateNodePreviousEpochs(nodeId, _epoch);

        // Updated global
        stakingStorage.updateGlobalPreviousEpochs(_epoch);

        // Change staker type to liquid
        stakingStorage.setStakerLockTierId(_nftId, 0);

        emit StakerUpgradedToLiquid(_nftId, _epoch);
        return newStakerLastStakedAmount;
    }

    /**
     * @notice  Registers the excess weighted stake of a staking position in the storage contract
     * @dev     The excess weighted stake is the amount of calculated stake that a position gets for having a locked position
     * @param   _nftId  ID of the staking position
     * @param   _lockTierId  Lock tier ID of the staking position
     */
    function _registerLockStaking(uint256 _nftId, uint256 _lockTierId) private {
        if (_lockTierId == 0) {
            return;
        }
        uint256 endLockEpoch = _getEndLockEpoch(_nftId);
        uint256 excessWeightedStake = _getExcessWeightedStake(_nftId);

        // Set excess weighted stake for the node
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);
        stakingStorage.setNodeLockingExcessWeightedStakePerEpoch(
            nodeId,
            endLockEpoch,
            stakingStorage.getNodeLockingExcessWeightedStakePerEpoch(nodeId, endLockEpoch) +
                excessWeightedStake
        );

        // Set excess weighted stake for the global info
        stakingStorage.setLockingExcessWeightedStakePerEpoch(
            endLockEpoch,
            stakingStorage.getLockingExcessWeightedStakePerEpoch(endLockEpoch) + excessWeightedStake
        );
        emit LockStakingRegistered(_nftId, _lockTierId, endLockEpoch);
    }

    /**
     * @notice  Registers the stuck rewards when a staker NFT is redeemed if necessary
     * @param   _nftId  Id of the staking position
     */
    function _registerStuckRewardShares(uint256 _nftId) private {
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);
        uint256 lastEpochRewardsUpdated = stakingStorage.getLastEpochRewardsUpdated();
        uint256 lastActiveEpoch = stakingStorage.getLastActiveEpoch(nodeId);

        if (!(lastActiveEpoch > 2 && lastEpochRewardsUpdated < (lastActiveEpoch - 1))) {
            return;
        }

        uint256 stakerStuckRewardShares;
        uint256 oldStuckRewardShares;
        for (uint256 epoch = lastEpochRewardsUpdated + 1; epoch < lastActiveEpoch; epoch++) {
            stakerStuckRewardShares = stakingStorage.getStakerMinStakedAmountPerEpoch(
                _nftId,
                epoch
            );
            if (stakerStuckRewardShares > 0) {
                oldStuckRewardShares = stakingStorage.getStuckRewardSharesPerEpoch(epoch);
                stakingStorage.setStuckRewardSharesPerEpoch(
                    epoch,
                    oldStuckRewardShares + stakerStuckRewardShares
                );
            }
        }
    }

    /**
     * @notice  Returns the excess weighted stake of a staking position
     * @dev     The excess weighted stake is the amount of calculated stake that a position get for having a locked position
     * @param   _nftId  ID of the staking position
     * @return  uint256  Excess weighted stake of the staking position
     */
    function _getExcessWeightedStake(uint256 _nftId) private view returns (uint256) {
        uint256 baseStakedAmount = stakingStorage.getStakerBaseStakedAmount(_nftId);

        return
            getWeightedAmount(baseStakedAmount, stakingStorage.getStakerLockTierId(_nftId)) -
            baseStakedAmount;
    }

    /**
     * @notice  Returns the MELD Staking NFT contract
     * @return  IMeldStakingNFT  MELD Staking NFT contract
     */
    function _getMeldStakingNFT() private view returns (IMeldStakingNFT) {
        return IMeldStakingNFT(stakingAddressProvider.meldStakingNFT());
    }

    /**
     * @notice  Returns the epoch when the end of the locking position will occur
     * @param   _nftId  ID of the staking position
     * @return  uint256  Epoch of the end of the locking position
     */
    function _getEndLockEpoch(uint256 _nftId) private view returns (uint256) {
        uint256 lockTierId = stakingStorage.getStakerLockTierId(_nftId);
        if (stakingStorage.getStakerLockTierId(_nftId) == 0) {
            return 0;
        }
        uint256 startEpoch = stakingStorage.getEpoch(
            stakingStorage.getStakerStakingStartTimestamp(_nftId)
        );
        return startEpoch + stakingStorage.getLockStakingTier(lockTierId).stakingLength + 1;
    }

    /**
     * @notice  Returns the timestamp when the end of the locking position will occur
     * @param   _nftId  ID of the staking position
     * @return  uint256  Timestamp of the end of the locking position
     */
    function _getEndLockTimestamp(uint256 _nftId) private view returns (uint256) {
        if (stakingStorage.getStakerLockTierId(_nftId) == 0) {
            return 0;
        }
        uint256 endEpoch = _getEndLockEpoch(_nftId);
        return stakingStorage.getEpochStart(endEpoch);
    }
}
