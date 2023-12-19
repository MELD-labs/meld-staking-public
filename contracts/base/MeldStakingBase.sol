// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {AccessControl, Context} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC2771Recipient} from "@opengsn/contracts/src/ERC2771Recipient.sol";

/**
 * @title MeldStakingBase
 * @notice A contract that contains common functionality for the MELD staking contracts, such as pausing and meta-transaction support
 * @author MELD team
 */
abstract contract MeldStakingBase is AccessControl, Pausable, ERC2771Recipient {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");
    bytes32 public constant TRUSTED_FORWARDER_SETTER_ROLE =
        keccak256("TRUSTED_FORWARDER_SETTER_ROLE");

    /**
     * @notice  Event emitted when the trusted forwarder address is updated
     * @param   executedBy  Address of the user that executed teh change
     * @param   oldForwarder  Address of the old trusted forwarder
     * @param   newForwarder  Address of the new trusted forwarder
     */
    event TrustedForwarderChanged(
        address indexed executedBy,
        address oldForwarder,
        address newForwarder
    );

    /**
     * @dev Modifier that checks that the sender is not the trusted forwarder
     * @dev This is used to prevent meta-transactions from being sent to the centralized functions
     */
    modifier notTrustedForwarder() {
        require(
            !isTrustedForwarder(msg.sender),
            "EIP2771Recipient: meta transaction is not allowed"
        );
        _;
    }

    /**
     * @dev Grants `_role` to `_account`.
     * @dev Created to ensure it is not called by the trusted forwarder
     * @param _role The role to grant
     * @param _account The account to grant the role to
     */
    function grantRole(
        bytes32 _role,
        address _account
    ) public virtual override notTrustedForwarder {
        super.grantRole(_role, _account);
    }

    /**
     * @dev Revokes `_role` from `_account`.
     * @dev Created to ensure it is not called by the trusted forwarder
     * @param _role The role to revoke
     * @param _account The account to revoke the role from
     */
    function revokeRole(
        bytes32 _role,
        address _account
    ) public virtual override notTrustedForwarder {
        super.revokeRole(_role, _account);
    }

    /**
     * @dev Revokes `_role` from the calling account.
     * @dev Created to ensure it is not called by the trusted forwarder
     * @param _role The role to renounce
     * @param _account The account to renounce the role from. Must be equal to the _msgSender()
     */
    function renounceRole(
        bytes32 _role,
        address _account
    ) public virtual override notTrustedForwarder {
        super.renounceRole(_role, _account);
    }

    /////// PAUSABLE FUNCTIONS ///////

    /**
     * @notice  Pauses the contract.
     * @dev     This function can only be called by an account with the `PAUSER_ROLE`.
     */
    function pause() public virtual onlyRole(PAUSER_ROLE) notTrustedForwarder {
        _pause();
    }

    /**
     * @notice  Unpauses the contract.
     * @dev     This function can only be called by an account with the `UNPAUSER_ROLE`.
     */
    function unpause() public virtual onlyRole(UNPAUSER_ROLE) notTrustedForwarder {
        _unpause();
    }

    /**
     * @notice Use this method the contract anywhere instead of msg.sender to support relayed transactions.
     * @dev Overrides _msgSender hook to add support for meta-transactions using the ERC2771 standard
     * @return sender The real sender of this call.
     * For a call that came through the Forwarder the real sender is extracted from the last 20 bytes of the `msg.data`.
     * Otherwise simply returns `msg.sender`.
     */
    function _msgSender()
        internal
        view
        override(Context, ERC2771Recipient)
        returns (address sender)
    {
        sender = ERC2771Recipient._msgSender();
    }

    /**
     * @notice Use this method in the contract instead of `msg.data` when difference matters (hashing, signature, etc.)
     * @dev Overrides _msgData hook to add support for meta-transactions using the ERC2771 standard
     * @return data The real `msg.data` of this call.
     * For a call that came through the Forwarder, the real sender address was appended as the last 20 bytes
     * of the `msg.data` - so this method will strip those 20 bytes off.
     * Otherwise (if the call was made directly and not through the forwarder) simply returns `msg.data`.
     */
    function _msgData() internal view override(Context, ERC2771Recipient) returns (bytes calldata) {
        return ERC2771Recipient._msgData();
    }
}
