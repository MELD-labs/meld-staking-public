// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {MeldStakingBase} from "./base/MeldStakingBase.sol";
import {RescueTokens} from "./base/RescueTokens.sol";
import {IMeldStakingNFT} from "./interfaces/IMeldStakingNFT.sol";
import {IMeldStakingOperator} from "./interfaces/IMeldStakingOperator.sol";
import {IMeldStakingCommon} from "./interfaces/IMeldStakingCommon.sol";
import {IMeldStakingStorage} from "./interfaces/IMeldStakingStorage.sol";
import {IMeldStakingAddressProvider} from "./interfaces/IMeldStakingAddressProvider.sol";
import "./Errors.sol";

/**
 * @title MeldStakingOperator
 * @notice This contract represents the staking contract for the MELD token.
 * @author MELD team
 */
contract MeldStakingOperator is MeldStakingBase, RescueTokens, IMeldStakingOperator {
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

    ///// OPERATOR FUNCTIONS /////

    /**
     * @notice  Operator requests a new node to be added
     * @dev     Node ID must be different to previously created nodes. Creates temporary nodeRequest struct to hold the information until admin accepts or rejects request
     * @param   _nodeName  Node ID to be added (string that will be hashed)
     * @param   _delegatorFee  Fee to be taken from delegators, can't be modified in the future
     * @param   _amount  Initial amount to be staked
     * @param   _lockTierId  Lock tier for the staked tokens
     */
    function requestNode(
        string memory _nodeName,
        uint256 _delegatorFee,
        uint256 _amount,
        uint256 _lockTierId,
        string memory _metadata
    ) external override onlyValidLockTier(_lockTierId, _amount) stakingStarted whenNotPaused {
        uint256 minStakingAmount = stakingStorage.getMinStakingAmount();
        uint256 maxStakingAmount = stakingStorage.getMaxStakingAmount();
        require(
            _delegatorFee >= stakingStorage.getMinDelegationFee() &&
                _delegatorFee <= stakingStorage.getMaxDelegationFee(),
            FEE_OUT_OF_RANGE
        );
        require(
            _amount >= minStakingAmount && _amount <= maxStakingAmount,
            STAKING_AMOUNT_OUT_OF_RANGE
        );
        bytes32 nodeId = hashNodeId(_nodeName);
        require(!stakingStorage.isNode(nodeId), NODE_ALREADY_EXISTS);
        require(!stakingStorage.nodeRequestExists(nodeId), NODE_REQUEST_ALREADY_EXISTS);

        stakingStorage.setNodeName(nodeId, _nodeName);

        uint256 nftId = stakingCommon.mintStakingNFT(_msgSender(), _amount);

        stakingStorage.createNodeRequest(nodeId, nftId, _delegatorFee, _amount, _lockTierId);

        emit NodeRequestCreated(
            _msgSender(),
            nodeId,
            _nodeName,
            nftId,
            _delegatorFee,
            _amount,
            _lockTierId,
            _metadata
        );
    }

    /**
     * @notice  Operator cancels an open request to add a node
     * @dev     After request is cancelled, the Node ID is open for other users to use.
     * @param   _nodeId  Node ID to be cancelled
     */
    function cancelNodeRequest(bytes32 _nodeId) external override {
        require(stakingStorage.nodeRequestExists(_nodeId), NODE_REQUEST_DOES_NOT_EXIST);
        IMeldStakingStorage.NodeRequest memory nodeRequest = stakingStorage.getNodeRequest(_nodeId);
        uint256 operator = nodeRequest.operator;
        require(stakingCommon.ownerOfStakingNFT(operator) == _msgSender(), NOT_NODE_OPERATOR);
        uint256 stakingAmount = nodeRequest.stakingAmount;

        stakingStorage.removeNodeRequest(_nodeId);

        stakingCommon.redeemStakingNFT(operator);
        stakingCommon.withdrawMeld(_msgSender(), stakingAmount);

        emit NodeRequestCancelled(_nodeId, operator, stakingAmount);
    }

    /**
     * @notice  Operator leaves a node, withdrawing their stake and unclaimed rewards
     * @dev     Can only be done by owner of NFT
     * @dev     Can only be the operator of the node
     * @dev     If the staking position is locked and the lock period has not ended, it will revert
     * @param   _nftId  Staking position NFT ID to leave
     */
    function leaveNode(uint256 _nftId) external override isNftOwner(_nftId) {
        require(stakingStorage.isOperator(_nftId), NOT_OPERATOR);
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);
        require(stakingStorage.isNodeActive(nodeId), NODE_NOT_ACTIVE);

        if (stakingStorage.getStakerLockTierId(_nftId) != 0) {
            uint256 endOfLocking = stakingCommon.getEndLockTimestamp(_nftId);
            require(block.timestamp >= endOfLocking, STAKING_LOCKED);
        }

        uint256 currentEpoch = stakingStorage.getCurrentEpoch();

        // Update everything to current epoch
        stakingCommon.updateStakerPreviousEpochs(_nftId, currentEpoch);
        stakingStorage.updateNodePreviousEpochs(nodeId, currentEpoch);
        stakingStorage.updateGlobalPreviousEpochs(currentEpoch);

        // Update unclaimed rewards
        uint256 unclaimedRewards = stakingCommon.updateUnclaimedRewards(_nftId);
        uint256 baseStakedAmount = stakingStorage.getStakerBaseStakedAmount(_nftId);
        uint256 totalAmount = baseStakedAmount + unclaimedRewards;

        uint256 oldTotalBaseStakedAmount = stakingStorage.getTotalBaseStakedAmount();
        uint256 oldNodeBaseStakedAmount = stakingStorage.getNodeBaseStakedAmount(nodeId);

        // Update node
        stakingStorage.setNodeBaseStakedAmount(nodeId, 0);
        uint256 nodeLastStakedAmount = stakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId,
            currentEpoch
        );
        stakingStorage.setNodeLastStakedAmountPerEpoch(nodeId, currentEpoch, 0);
        stakingStorage.setNodeInactive(nodeId);

        // Update global

        stakingStorage.setTotalBaseStakedAmount(oldTotalBaseStakedAmount - oldNodeBaseStakedAmount);
        uint256 lastStakedAmount = stakingStorage.getLastStakedAmountPerEpoch(currentEpoch);
        stakingStorage.setLastStakedAmountPerEpoch(
            currentEpoch,
            lastStakedAmount - nodeLastStakedAmount
        );

        // Update excess weights to make sure the global excess weight is correct
        stakingStorage.fixExcessWeights(nodeId);

        // Delete staker
        stakingCommon.registerStuckRewardShares(_nftId);
        stakingStorage.removeStaker(_nftId);

        // Transfer the staked amount + unclaimed rewards. Burn the NFT
        stakingCommon.redeemStakingNFT(_nftId);
        stakingCommon.withdrawMeld(_msgSender(), totalAmount);

        // Emit events
        if (unclaimedRewards > 0) {
            emit RewardsClaimed(_nftId, unclaimedRewards);
        }
        emit NodeLeft(_nftId, nodeId, totalAmount);
        emit TotalBaseStakedAmountChanged(
            _msgSender(),
            oldTotalBaseStakedAmount,
            stakingStorage.getTotalBaseStakedAmount()
        );
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

    /////// PURE FUNCTIONS ///////

    /**
     * @notice  Hashes a node ID string
     * @dev     Uses keccak256
     * @param   _nodeName  Node ID string to hash
     * @return  bytes32  Hashed node ID
     */
    function hashNodeId(string memory _nodeName) public pure override returns (bytes32) {
        return keccak256(abi.encodePacked(_nodeName));
    }
}
