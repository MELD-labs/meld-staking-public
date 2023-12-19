// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {MeldStakingBase} from "./base/MeldStakingBase.sol";
import {RescueTokens} from "./base/RescueTokens.sol";
import {IMeldStakingNFT} from "./interfaces/IMeldStakingNFT.sol";
import {IMeldStakingDelegator} from "./interfaces/IMeldStakingDelegator.sol";
import {IMeldStakingCommon} from "./interfaces/IMeldStakingCommon.sol";
import {IMeldStakingStorage} from "./interfaces/IMeldStakingStorage.sol";
import {IMeldStakingAddressProvider} from "./interfaces/IMeldStakingAddressProvider.sol";
import "./Errors.sol";

/**
 * @title MeldStakingDelegator
 * @notice This contract represents the staking contract for the MELD token.
 * @author MELD team
 */
contract MeldStakingDelegator is MeldStakingBase, RescueTokens, IMeldStakingDelegator {
    struct TempData {
        uint256 stakerBaseStakedAmount;
        uint256 oldFeeAmount;
        uint256 newFeeAmount;
        uint256 weightedAmountWithoutFee;
        uint256 lockTierId;
    }

    IMeldStakingStorage private stakingStorage;
    IMeldStakingCommon private stakingCommon;

    /**
     * @notice  Checks that the staking period has started and allows for actions around it
     * @dev     Uses the function isStakingStarted()
     */
    modifier stakingStarted() {
        require(stakingStorage.isStakingStarted(), STAKING_NOT_STARTED);
        _;
    }

    /**
     * @notice  Checks if the amount is greater than the amount needed for that tier
     * @dev     Takes into account if {_lockTierId} is 0 that the staking is liquid
     * @param   _lockTierId  ID of the lock tier to check with
     * @param   _amount  Amount of MELD tokens to check
     */
    modifier onlyValidLockTier(uint256 _lockTierId, uint256 _amount) {
        require(
            stakingCommon.isValidLockTier(_lockTierId, _amount),
            INVALID_STAKING_AMOUNT_FOR_TIER
        );
        _;
    }

    /**
     * @notice  Checks if the sender of the transaction is the owner of certain NFT
     * @dev     Uses NFTs ID for reference
     * @param   _nftId  NFT ID to check
     */
    modifier isNftOwner(uint256 _nftId) {
        require(stakingCommon.ownerOfStakingNFT(_nftId) == _msgSender(), NOT_NFT_OWNER);
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
     * @notice  ADMIN: Initializes the contract, setting the address of the MELD Staking Storage and the MELD Staking Common
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _stakingAddressProvider  Address of the MELD Staking Address Provider
     */
    function initialize(
        address _stakingAddressProvider
    ) external onlyRole(DEFAULT_ADMIN_ROLE) notTrustedForwarder {
        require(_stakingAddressProvider != address(0), INVALID_ADDRESS);
        require(
            address(stakingStorage) == address(0) && address(stakingCommon) == address(0),
            ALREADY_INITIALIZED
        );
        IMeldStakingAddressProvider addressProvider = IMeldStakingAddressProvider(
            _stakingAddressProvider
        );
        require(addressProvider.initialized(), ADDRESS_PROVIDER_NOT_INITIALIZED);

        stakingStorage = IMeldStakingStorage(addressProvider.meldStakingStorage());
        stakingCommon = IMeldStakingCommon(addressProvider.meldStakingCommon());
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

    ///// DELEGATOR FUNCTIONS /////

    /**
     * @notice  Creates an staking position for a user, delegating to a node
     * @dev     Manages total stake and rewards calculation. Further info can be found on docs
     * @param   _amount  Amount of MELD tokens to stake. Full decimals
     * @param   _nodeId  Node ID to delegate to.
     * @param   _lockTierId  Lock tier ID.
     */
    function stake(
        uint256 _amount,
        bytes32 _nodeId,
        uint256 _lockTierId
    ) external override onlyValidLockTier(_lockTierId, _amount) stakingStarted whenNotPaused {
        require(stakingStorage.isNodeActive(_nodeId), NODE_NOT_ACTIVE);
        require(canDelegateToNode(_msgSender(), _nodeId), INVALID_WHITELIST_PERMISSIONS);
        uint256 nodeMaxStakingAmount = stakingStorage.getNodeMaxStakingAmount(_nodeId);
        require(
            _amount + stakingStorage.getNodeBaseStakedAmount(_nodeId) <= nodeMaxStakingAmount,
            STAKING_AMOUNT_OUT_OF_RANGE
        );

        uint256 nftId = stakingCommon.mintStakingNFT(_msgSender(), _amount);

        stakingStorage.createStaker(
            nftId,
            2, // DELEGATOR
            _nodeId,
            _lockTierId
        );

        uint256 oldTotalBaseStakedAmount = stakingStorage.getTotalBaseStakedAmount();

        stakingCommon.newStake(nftId, _amount);

        stakingStorage.addDelegator(_nodeId, nftId);

        emit StakingDelegationCreated(_msgSender(), nftId, _nodeId, _amount, _lockTierId);
        emit TotalBaseStakedAmountChanged(
            _msgSender(),
            oldTotalBaseStakedAmount,
            stakingStorage.getTotalBaseStakedAmount()
        );
    }

    /**
     * @notice  Changes the delegation of a staking position to a new node
     * @dev     Adapts staking info and rewards for old and new node. Can only be done by owner of NFT
     * @param   _nftId  Staking position NFT ID to change
     * @param   _newNodeId  ID of the new node to delegate to
     */
    function changeDelegation(
        uint256 _nftId,
        bytes32 _newNodeId
    ) external override stakingStarted isNftOwner(_nftId) whenNotPaused {
        require(stakingStorage.isNodeActive(_newNodeId), NODE_NOT_ACTIVE);
        require(canDelegateToNode(_msgSender(), _newNodeId), INVALID_WHITELIST_PERMISSIONS);
        require(stakingStorage.isDelegator(_nftId), NOT_DELEGATOR);

        bytes32 oldNodeId = stakingStorage.getStakerNodeId(_nftId);
        require(oldNodeId != _newNodeId, ALREADY_DELEGATING_TO_NODE);
        require(!stakingStorage.isNodeSlashed(oldNodeId), NODE_SLASHED);

        uint256 currentEpoch = stakingStorage.getCurrentEpoch();

        // Update all relevant info to ensure we have latest context stored
        // Staker is updated until last active epoch of old node
        stakingCommon.updateStakerPreviousEpochs(_nftId);
        if (stakingStorage.isNodeActive(oldNodeId)) {
            stakingCommon.updateStakerPreviousEpochs(
                stakingStorage.getNodeOperator(oldNodeId),
                currentEpoch
            );
            stakingStorage.updateNodePreviousEpochs(oldNodeId, currentEpoch);
        } else {
            // old node inactive
            uint256 lastActiveEpoch = stakingStorage.getLastActiveEpoch(oldNodeId);
            stakingStorage.setStakerLastStakedAmountPerEpoch(_nftId, lastActiveEpoch, 0);
            // If during this period (from last active epoch of old node to now), the staker becomes liquid, we do it manually
            uint256 lockedToLiquidEpoch = stakingCommon.getEndLockEpoch(_nftId);
            if (lockedToLiquidEpoch > 0 && currentEpoch >= lockedToLiquidEpoch) {
                stakingStorage.setStakerLockTierId(_nftId, 0);
                emit StakerUpgradedToLiquid(_nftId, lockedToLiquidEpoch);
            }
        }
        stakingCommon.updateStakerPreviousEpochs(
            stakingStorage.getNodeOperator(_newNodeId),
            currentEpoch
        );
        stakingStorage.updateNodePreviousEpochs(_newNodeId, currentEpoch);
        stakingStorage.updateGlobalPreviousEpochs(currentEpoch);

        // Update unclaimed rewards from old node
        stakingCommon.updateUnclaimedRewards(_nftId);

        // Update all staking amounts in nodes
        _updateStakedAmountsDelegation(_nftId, oldNodeId, _newNodeId, currentEpoch);

        stakingStorage.removeDelegator(oldNodeId, _nftId);
        stakingStorage.addDelegator(_newNodeId, _nftId);

        stakingStorage.setStakerNodeId(_nftId, _newNodeId);
        emit DelegatorNodeChanged(_nftId, oldNodeId, _newNodeId);
    }

    /**
     * @notice  A delegator redeems their Staking NFT withdrawing their stake and unclaimed rewards
     * @dev     Can only be done by owner of NFT
     * @dev     Can only be done by a delegator
     * @dev     If the staking position is locked and the lock period has not ended, it will revert
     * @param   _nftId  Staking position NFT ID to redeem
     */
    function withdraw(uint256 _nftId) external override stakingStarted isNftOwner(_nftId) {
        require(stakingStorage.isDelegator(_nftId), NOT_DELEGATOR);
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);

        // If node is not active, user needs to delegate to an active node to withdraw
        require(!stakingStorage.isNodeInactive(nodeId), NODE_NOT_ACTIVE);

        if (stakingStorage.isNodeSlashed(nodeId)) {
            uint256 slashedPercentage = stakingStorage.getNodeSlashedPercentage(nodeId);
            uint256 PERCENTAGE_SCALING = stakingStorage.PERCENTAGE_SCALING();
            require(slashedPercentage < PERCENTAGE_SCALING, NODE_FULLY_SLASHED);

            uint256 epoch = stakingStorage.getLastActiveEpoch(nodeId);
            stakingCommon.updateStakerPreviousEpochs(_nftId, epoch);

            stakingStorage.updateGlobalPreviousEpochs(epoch);

            // Update unclaimed rewards
            uint256 unclaimedRewards = stakingCommon.updateUnclaimedRewards(_nftId);

            uint256 baseStakedAmount = stakingStorage.getStakerBaseStakedAmount(_nftId);

            uint256 totalAmount = (baseStakedAmount * (PERCENTAGE_SCALING - slashedPercentage)) /
                PERCENTAGE_SCALING +
                unclaimedRewards;

            stakingStorage.removeStaker(_nftId);
            stakingStorage.removeDelegator(nodeId, _nftId);
            stakingStorage.setStakerLastStakedAmountPerEpoch(_nftId, epoch, 0);

            // Transfer the staked amount + unclaimed rewards. Burn the NFT
            stakingCommon.redeemStakingNFT(_nftId);
            stakingCommon.withdrawMeld(_msgSender(), totalAmount);

            // Emit events
            if (unclaimedRewards > 0) {
                emit RewardsClaimed(_nftId, unclaimedRewards);
            }
            emit StakeWithdrawn(_nftId, nodeId, totalAmount);
        } else {
            if (stakingStorage.getStakerLockTierId(_nftId) != 0) {
                uint256 endOfLocking = stakingCommon.getEndLockTimestamp(_nftId);
                require(block.timestamp >= endOfLocking, STAKING_LOCKED);
            }

            uint256 epoch = stakingStorage.getLastActiveEpoch(nodeId);

            uint256 operator = stakingStorage.getNodeOperator(nodeId);
            // Update everything to current epoch
            stakingCommon.updateStakerPreviousEpochs(_nftId, epoch);
            bool operatorExists = stakingStorage.isStaker(operator);
            if (operatorExists) {
                // Inside if in case operator left the node and the NFT was burned
                stakingCommon.updateStakerPreviousEpochs(operator, epoch);
            }
            stakingStorage.updateNodePreviousEpochs(nodeId, epoch);
            stakingStorage.updateGlobalPreviousEpochs(epoch);

            // Update unclaimed rewards
            uint256 unclaimedRewards = stakingCommon.updateUnclaimedRewards(_nftId);
            uint256 baseStakedAmount = stakingStorage.getStakerBaseStakedAmount(_nftId);
            uint256 totalAmount = baseStakedAmount + unclaimedRewards;
            uint256 oldTotalBaseStakedAmount = stakingStorage.getTotalBaseStakedAmount();
            uint256 feeAmount = stakingStorage.calculateDelegationFeeAmount(
                nodeId,
                baseStakedAmount
            );
            // Update operator
            if (operatorExists) {
                stakingStorage.setStakerLastStakedAmountPerEpoch(
                    operator,
                    epoch,
                    stakingStorage.getStakerLastStakedAmountPerEpoch(operator, epoch) - feeAmount
                );
            }

            // Update node
            stakingStorage.setNodeBaseStakedAmount(
                nodeId,
                stakingStorage.getNodeBaseStakedAmount(nodeId) - baseStakedAmount
            );
            stakingStorage.setNodeLastStakedAmountPerEpoch(
                nodeId,
                epoch,
                stakingStorage.getNodeLastStakedAmountPerEpoch(nodeId, epoch) - baseStakedAmount
            );

            // Update global
            stakingStorage.setTotalBaseStakedAmount(oldTotalBaseStakedAmount - baseStakedAmount);
            stakingStorage.setLastStakedAmountPerEpoch(
                epoch,
                stakingStorage.getLastStakedAmountPerEpoch(epoch) - baseStakedAmount
            );

            // Delete staker and remove from delegator list
            stakingCommon.registerStuckRewardShares(_nftId);
            stakingStorage.removeStaker(_nftId);
            stakingStorage.removeDelegator(nodeId, _nftId);
            stakingStorage.setStakerLastStakedAmountPerEpoch(_nftId, epoch, 0);

            // Transfer the staked amount + unclaimed rewards. Burn the NFT
            stakingCommon.redeemStakingNFT(_nftId);
            stakingCommon.withdrawMeld(_msgSender(), totalAmount);

            // Emit events
            if (unclaimedRewards > 0) {
                emit RewardsClaimed(_nftId, unclaimedRewards);
            }
            emit StakeWithdrawn(_nftId, nodeId, totalAmount);
            emit TotalBaseStakedAmountChanged(
                _msgSender(),
                oldTotalBaseStakedAmount,
                stakingStorage.getTotalBaseStakedAmount()
            );
        }
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

    /////// VIEW FUNCTIONS ///////

    /**
     * @notice  Checks if an address can delegate to a specific node
     * @dev     If the node does not have whitlist enabled it will return true
     *          And if it has whitlist enabled it will return true or false if the address is in the whitelist
     * @param   _address The address to check
     * @param   _nodeId The node where the address tries to delegate
     */
    function canDelegateToNode(
        address _address,
        bytes32 _nodeId
    ) public view override returns (bool) {
        return
            stakingStorage.isNodeActive(_nodeId) &&
            (!stakingStorage.isDelegatorWhitelistEnabled(_nodeId) ||
                stakingStorage.isNodeDelegatorWhitelisted(_nodeId, _address));
    }

    ///// PRIVATE FUNCTIONS /////

    /**
     * @notice  Helper function to get data needed for a delegation change
     * @dev     This function was created to prevent a stack too deep error
     * @param   _nftId  ID of the delegator staking position
     * @param   _oldNodeId  ID of the old node of the delegator
     * @param   _newNodeId  ID of the new node of the delegator
     * @return  TempData  Struct with the data needed for the delegation change
     */
    function _getTempData(
        uint256 _nftId,
        bytes32 _oldNodeId,
        bytes32 _newNodeId
    ) private view returns (TempData memory) {
        uint256 stakerBaseStakedAmount = stakingStorage.getStakerBaseStakedAmount(_nftId);

        uint256 lockTierId = stakingStorage.getStakerLockTierId(_nftId);

        uint256 weightedAmountWithoutFee = stakingCommon.getWeightedAmount(
            stakerBaseStakedAmount,
            lockTierId
        );

        uint256 oldFeeAmount = stakingStorage.calculateDelegationFeeAmount(
            _oldNodeId,
            stakerBaseStakedAmount
        );

        return
            TempData({
                stakerBaseStakedAmount: stakerBaseStakedAmount,
                oldFeeAmount: oldFeeAmount,
                newFeeAmount: stakingStorage.calculateDelegationFeeAmount(
                    _newNodeId,
                    stakerBaseStakedAmount
                ),
                weightedAmountWithoutFee: weightedAmountWithoutFee,
                lockTierId: lockTierId
            });
    }

    function _updateStakedAmountsDelegation(
        uint256 _nftId,
        bytes32 _oldNodeId,
        bytes32 _newNodeId,
        uint256 _currentEpoch
    ) private {
        TempData memory t = _getTempData(_nftId, _oldNodeId, _newNodeId);

        if (stakingStorage.isNodeActive(_oldNodeId)) {
            // Update staker
            // baseStakedAmount remains the same
            // lastStakingAmount changes due to fee
            stakingStorage.setStakerLastStakedAmountPerEpoch(
                _nftId,
                _currentEpoch,
                stakingStorage.getStakerLastStakedAmountPerEpoch(_nftId, _currentEpoch) +
                    t.oldFeeAmount -
                    t.newFeeAmount
            );

            // Update oldOperator
            // lastStakingAmount loses delegator fee amount
            uint256 oldOperator = stakingStorage.getNodeOperator(_oldNodeId);
            stakingStorage.setStakerLastStakedAmountPerEpoch(
                oldOperator,
                _currentEpoch,
                stakingStorage.getStakerLastStakedAmountPerEpoch(oldOperator, _currentEpoch) -
                    t.oldFeeAmount
            );

            // Update newOperator
            // lastStakingAmount adds delegator fee amount
            uint256 newOperator = stakingStorage.getNodeOperator(_newNodeId);
            stakingStorage.setStakerLastStakedAmountPerEpoch(
                newOperator,
                _currentEpoch,
                stakingStorage.getStakerLastStakedAmountPerEpoch(newOperator, _currentEpoch) +
                    t.newFeeAmount
            );

            // Update old node
            // baseStakedAmount is reduced
            // lastStakingAmount is reduced by the staker's lastStakedAmount (except the fee)
            stakingStorage.setNodeBaseStakedAmount(
                _oldNodeId,
                stakingStorage.getNodeBaseStakedAmount(_oldNodeId) - t.stakerBaseStakedAmount
            );
            stakingStorage.setNodeLastStakedAmountPerEpoch(
                _oldNodeId,
                _currentEpoch,
                stakingStorage.getNodeLastStakedAmountPerEpoch(_oldNodeId, _currentEpoch) -
                    t.weightedAmountWithoutFee
            );

            // Update new node
            stakingStorage.setNodeBaseStakedAmount(
                _newNodeId,
                stakingStorage.getNodeBaseStakedAmount(_newNodeId) + t.stakerBaseStakedAmount
            );
            stakingStorage.setNodeLastStakedAmountPerEpoch(
                _newNodeId,
                _currentEpoch,
                stakingStorage.getNodeLastStakedAmountPerEpoch(_newNodeId, _currentEpoch) +
                    t.weightedAmountWithoutFee
            );

            // Global remains unchanged. Staked amount is just moved from one node to another
            // And fee amounts are just distributed between delegator and operator

            // Transfer the excess weight from the old node to the new node if necessary
            stakingCommon.transferExcessWeight(_nftId, _newNodeId);
        } else {
            // OLD NODE NOT ACTIVE.
            // Slashed is not an option since we are blocking this on the changeDelegation function

            // Update staker
            // baseStakedAmount remains the same
            // lastStakingAmount is updated to start it
            stakingStorage.setStakerLastStakedAmountPerEpoch(
                _nftId,
                _currentEpoch,
                t.weightedAmountWithoutFee - t.newFeeAmount
            );

            stakingStorage.setStakerLastEpochStakingUpdated(_nftId, _currentEpoch);

            // Update newOperator. Old operator does not need to be updated since it's inactive
            // lastStakingAmount adds delegator fee amount
            uint256 newOperator = stakingStorage.getNodeOperator(_newNodeId);
            stakingStorage.setStakerLastStakedAmountPerEpoch(
                newOperator,
                _currentEpoch,
                stakingStorage.getStakerLastStakedAmountPerEpoch(newOperator, _currentEpoch) +
                    t.newFeeAmount
            );

            // Update new node. Old node does not need to be updated since it's inactive
            stakingStorage.setNodeBaseStakedAmount(
                _newNodeId,
                stakingStorage.getNodeBaseStakedAmount(_newNodeId) + t.stakerBaseStakedAmount
            );
            stakingStorage.setNodeLastStakedAmountPerEpoch(
                _newNodeId,
                _currentEpoch,
                stakingStorage.getNodeLastStakedAmountPerEpoch(_newNodeId, _currentEpoch) +
                    t.weightedAmountWithoutFee
            );

            // Update global base and last stake
            stakingStorage.setTotalBaseStakedAmount(
                stakingStorage.getTotalBaseStakedAmount() + t.stakerBaseStakedAmount
            );

            stakingStorage.setLastStakedAmountPerEpoch(
                _currentEpoch,
                stakingStorage.getLastStakedAmountPerEpoch(_currentEpoch) +
                    t.weightedAmountWithoutFee
            );

            // Handle excess weight if needed.
            // dev: previous checks at the start will ensure the lock tier is adapted before this point
            if (t.lockTierId != 0) {
                uint256 endLockEpoch = stakingCommon.getEndLockEpoch(_nftId);
                if (endLockEpoch >= _currentEpoch) {
                    // Update excess weight for global and node
                    stakingStorage.setNodeLockingExcessWeightedStakePerEpoch(
                        _newNodeId,
                        endLockEpoch,
                        stakingStorage.getNodeLockingExcessWeightedStakePerEpoch(
                            _newNodeId,
                            endLockEpoch
                        ) + t.weightedAmountWithoutFee
                    );

                    stakingStorage.setLockingExcessWeightedStakePerEpoch(
                        endLockEpoch,
                        stakingStorage.getLockingExcessWeightedStakePerEpoch(endLockEpoch) +
                            t.weightedAmountWithoutFee
                    );
                }
            }
        }
    }
}
