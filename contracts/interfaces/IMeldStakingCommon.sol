// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IMeldStakingCommonEvents} from "./IMeldStakingCommonEvents.sol";

interface IMeldStakingCommon is IMeldStakingCommonEvents {
    /////// EVENTS ///////

    /**
     * @notice  Event emitted when the contract is initialized.
     * @param   stakingAddressProvider  Address of the staking address provider
     */
    event Initialized(address indexed executedBy, address indexed stakingAddressProvider);

    /**
     * @notice  Event emitted when the uncleared rewards of a staker are updated.
     * @param   nftId  ID of the staker
     * @param   oldUnclaimedRewards  Old unclaimed rewards of the staker
     * @param   newUnclaimedRewards  New unclaimed rewards of the staker
     * @param   fromEpoch  Epoch from which the rewards are updated
     * @param   toEpoch  Epoch until which the rewards are updated
     */
    event UnclaimedRewardsUpdated(
        uint256 indexed nftId,
        uint256 oldUnclaimedRewards,
        uint256 newUnclaimedRewards,
        uint256 fromEpoch,
        uint256 toEpoch
    );

    /**
     * @notice  Event emitted when a new locking position is created
     * @param   nftId  ID of the staker
     * @param   lockTierId  ID of the lock tier
     * @param   endLockEpoch  Epoch when the locking position will end
     */
    event LockStakingRegistered(uint256 nftId, uint256 lockTierId, uint256 endLockEpoch);

    /////// ADMIN FUNCTIONS ///////

    /**
     * @notice  ADMIN: Initializes the contract, setting the address of the MELD Staking Storage, and a list of valid staking and config contracts
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _stakingAddressProvider  Address of the MELD Staking Address Provider
     */
    function initialize(address _stakingAddressProvider) external;

    /////// EXTERNAL STAKING CONTRACTS FUNCTIONS ///////

    /**
     * @notice  Calls the Staking NFT contract to deposit MELD tokens in it
     * @dev     This function acts as a bridge to the Staking NFT contract to be called from the other Staking Contracts
     * @param   _from  Address to deposit the MELD tokens from
     * @param   _amount  Amount of MELD tokens to deposit
     */
    function depositMeld(address _from, uint256 _amount) external;

    /**
     * @notice  Calls the Staking NFT contract to withdraw MELD tokens from it
     * @dev     This function acts as a bridge to the Staking NFT contract to be called from the other Staking Contracts
     * @param   _to  Address to withdraw the MELD tokens to
     * @param   _amount  Amount of MELD tokens to withdraw
     */
    function withdrawMeld(address _to, uint256 _amount) external;

    /**
     * @notice  Calls the Staking NFT contract to mint a new NFT
     * @dev     This function acts as a bridge to the Staking NFT contract to be called from the other Staking Contracts
     * @dev     Minting an NFT will also deposit the MELD tokens in the Staking NFT contract
     * @param   _to  Address to mint the NFT to
     * @param   _amount  Amount of MELD tokens to deposit in order to mint the NFT
     * @return  uint256  Returns the ID of the minted NFT
     */
    function mintStakingNFT(address _to, uint256 _amount) external returns (uint256);

    /**
     * @notice  Calls the Staking NFT contract to redeem an NFT
     * @dev     This function acts as a bridge to the Staking NFT contract to be called from the other Staking Contracts
     * @param   _nftId  ID of the NFT to redeem
     */
    function redeemStakingNFT(uint256 _nftId) external;

    /**
     * @notice  Common logic to be called when a new stake is made. Will update values in the storage contract
     * @dev     This function will be called from the other Staking Contracts
     * @param   _nftId  ID of the staking position
     * @param   _newAmount  Amount of MELD tokens to stake
     */
    function newStake(uint256 _nftId, uint256 _newAmount) external;

    /**
     * @notice  This function transfers then excess weight of the node of the `nftId` to another node
     * @dev     This function will be called from the Delegator Staking Contract when changing a delegation
     * @param   _nftId  ID of the staking position
     * @param   _newNodeId  ID of the new node to transfer the excess weight to
     */
    function transferExcessWeight(uint256 _nftId, bytes32 _newNodeId) external;

    /////// USER FUNCTIONS ///////

    /**
     * @notice  Claims the pending rewards of past epochs of a staking position
     * @dev     Can only be done by owner of position
     * @param   _nftId  Staking position NFT ID to claim rewards from
     */
    function claimRewards(uint256 _nftId) external;

    /**
     * @notice  Claims the pending rewards of past epochs of multiple staking positions
     * @dev     Can only be done by owner of the NFTs
     * @param   _nftIds  List of NFT IDs to claim rewards from
     */
    function claimRewards(uint256[] memory _nftIds) external;

    /**
     * @notice  Claims the pending rewards of past epochs of all staking positions of a user
     * @dev     Can only be done by owner of the NFTs
     */
    function claimAllMyRewards() external;

    /**
     * @notice  Updates the unclaimed rewards of a staker
     * @param   _nftId  ID of the staker to update
     */
    function updateUnclaimedRewards(uint256 _nftId) external returns (uint256);

    /**
     * @notice  Updates the staking information of a staker in previous epochs
     * @param   _nftId  ID of the staker to update
     */
    function updateStakerPreviousEpochs(uint256 _nftId) external;

    /**
     * @notice  Updates the staking information of a staker in previous epochs until a certain epoch
     * @param   _nftId  ID of the staker to update
     * @param   _untilEpoch  Epoch until the staking information will be updated
     */
    function updateStakerPreviousEpochs(uint256 _nftId, uint256 _untilEpoch) external;

    /**
     * @notice  Updates the staking information of multiple stakers in previous epochs
     * @dev     This function is useful to update the staking information of multiple stakers in a single transaction
     * @param   _nftIds  List of IDs of the stakers to update
     */
    function updateStakersPreviousEpochs(uint256[] memory _nftIds) external;

    /**
     * @notice  Updates the staking information of all staking positions owned by an address
     */
    function updateAllMyStakersPreviousEpochs() external;

    /**
     * @notice  Registers the stuck rewards when a staker NFT is redeemed if necessary
     * @param   _nftId  Id of the staking position
     */
    function registerStuckRewardShares(uint256 _nftId) external;

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _nodeId  Node ID to update
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateNodePreviousEpochs(bytes32 _nodeId, uint256 _untilEpoch) external;

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateGlobalPreviousEpochs(uint256 _untilEpoch) external;

    /////// PUBLIC VIEWS ///////

    /**
     * @notice  Checks if an amount is valid for a certain lock tier
     * @dev     If the lock tier is 0, then it's a liquid staking position and no further checks are needed
     * @dev     The lock tier id must correspond to an active lock tier
     * @param   _lockTierId  Lock tier ID to check
     * @param   _amount  Amount to check
     * @return  bool  True if the amount is valid for the lock tier, false otherwise
     */
    function isValidLockTier(uint256 _lockTierId, uint256 _amount) external view returns (bool);

    /**
     * @notice  Return the owner of a staking position
     * @param   _nftId ID of the staking position
     * @return  address  Owner of the staking position
     */
    function ownerOfStakingNFT(uint256 _nftId) external view returns (address);

    /**
     * @notice  Returns the timestamp when the end of the locking position will occur
     * @dev     It will returns 0 if the locking position is liquid
     * @param   _nftId  ID of the staking position
     * @return  uint256  Timestamp of the end of the locking position
     */
    function getEndLockTimestamp(uint256 _nftId) external view returns (uint256);

    /**
     * @notice  Returns the epoch when the end of the locking position will occur
     * @dev     It will returns 0 if the locking position is liquid
     * @param   _nftId  ID of the staking position
     * @return  uint256  Epoch of the end of the locking position
     */
    function getEndLockEpoch(uint256 _nftId) external view returns (uint256);

    /**
     * @notice  Returns the equivalent weight of rewards of an amount locked in certain lock tier
     * @param   _amount  Amount of MELD tokens to calculate
     * @param   _lockTierId  Lock tier ID
     * @return  uint256  Equivalent weight for rewards calculation
     */
    function getWeightedAmount(
        uint256 _amount,
        uint256 _lockTierId
    ) external view returns (uint256);
}
