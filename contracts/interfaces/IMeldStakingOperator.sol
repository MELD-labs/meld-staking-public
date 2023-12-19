// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IMeldStakingCommonEvents} from "./IMeldStakingCommonEvents.sol";

interface IMeldStakingOperator is IMeldStakingCommonEvents {
    /////// EVENTS ///////

    /**
     * @notice  Event emitted when the contract is initialized.
     * @param   stakingAddressProvider  Address of the staking address provider
     */
    event Initialized(address indexed executedBy, address indexed stakingAddressProvider);

    /**
     * @notice  Event emitted when a node request is created
     * @param   user  Address of the node operator
     * @param   nodeId  ID of the node
     * @param   operator  ID of the node operator
     * @param   delegatorFee  Delegator fee of the node
     * @param   stakingAmount  Amount of MELD tokens staked
     * @param   stakingTierId  ID of the staking tier
     * @param   metadata  Metadata of the node
     */
    event NodeRequestCreated(
        address indexed user,
        bytes32 indexed nodeId,
        string nodeName,
        uint256 indexed operator,
        uint256 delegatorFee,
        uint256 stakingAmount,
        uint256 stakingTierId,
        string metadata
    );

    /**
     * @notice  Event emitted when a node request is cancelled
     * @param   nodeId  ID of the node
     * @param   operator  ID of the node operator
     * @param   amount  Amount of MELD tokens withdrawn
     */
    event NodeRequestCancelled(bytes32 indexed nodeId, uint256 indexed operator, uint256 amount);

    /**
     * @notice  Event emitted when a node is left by the operator
     * @param   nftId  ID of the NFT of the operator
     * @param   nodeId  ID of the node
     * @param   amount  Amount of MELD tokens staked
     */
    event NodeLeft(uint256 indexed nftId, bytes32 indexed nodeId, uint256 amount);

    ///// ADMIN FUNCTIONS /////

    /**
     * @notice  ADMIN: Initializes the contract, setting the address of the MELD Staking Storage and the MELD Staking Common
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _stakingAddressProvider  Address of the MELD Staking Address Provider
     */
    function initialize(address _stakingAddressProvider) external;

    ///// OPERATOR FUNCTIONS /////

    /**
     * @notice  Operator requests a new node to be added
     * @dev     Node ID must be different to previously created nodes. Creates temporary nodeRequest struct to hold the information until admin accepts or rejects request
     * @param   _nodeIdString  Node ID to be added (string that will be hashed)
     * @param   _delegatorFee  Fee to be taken from delegators, can't be modified in the future
     * @param   _amount  Initial amount to be staked
     * @param   _lockTierId  Lock tier for the staked tokens
     */
    function requestNode(
        string memory _nodeIdString,
        uint256 _delegatorFee,
        uint256 _amount,
        uint256 _lockTierId,
        string memory _metadata
    ) external;

    /**
     * @notice  Operator cancels an open request to add a node
     * @dev     After request is cancelled, the Node ID is open for other users to use.
     * @param   _nodeId  Node ID to be cancelled
     */
    function cancelNodeRequest(bytes32 _nodeId) external;

    /**
     * @notice  Operator leaves a node, withdrawing their stake and unclaimed rewards
     * @dev     Can only be done by owner of NFT
     * @dev     Can only be the operator of the node
     * @dev     If the staking position is locked and the lock period has not ended, it will revert
     * @param   _nftId  Staking position NFT ID to leave
     */
    function leaveNode(uint256 _nftId) external;

    /**
     * @notice  Hashes a node ID string
     * @dev     Uses keccak256
     * @param   _nodeIdString  Node ID string to hash
     * @return  bytes32  Hashed node ID
     */
    function hashNodeId(string memory _nodeIdString) external pure returns (bytes32);
}
