// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "../Errors.sol";

/**
 * @title RescueTokens
 * @notice A contract that can rescue ERC20, ERC721, and ERC1155 tokens stuck in it
 * @dev This contract is abstract and must be inherited by another contract
 * @author MELD team
 */
abstract contract RescueTokens {
    using SafeERC20 for IERC20;

    /**
     * @notice  Rescue ERC20 tokens stuck in this contract
     * @param   _token The address of the ERC20 token
     * @param   _to The address to send the ERC20 tokens to
     */
    function _rescueERC20(address _token, address _to) internal virtual {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(balance > 0, NO_TOKENS_TO_RESCUE);
        IERC20(_token).safeTransfer(_to, balance);
    }

    /**
     * @notice  Rescue ERC721 tokens stuck in this contract
     * @param   _token The address of the ERC721 token
     * @param   _to The address to send the ERC721 tokens to
     * @param   _tokenId The ID of the ERC721 token
     */
    function _rescueERC721(address _token, address _to, uint256 _tokenId) internal virtual {
        require(IERC721(_token).ownerOf(_tokenId) == address(this), RESCUER_NOT_OWNER);
        IERC721(_token).safeTransferFrom(address(this), _to, _tokenId);
    }

    /**
     * @notice  Rescue ERC1155 tokens stuck in this contract
     * @param   _token The address of the ERC1155 token
     * @param   _to The address to send the ERC1155 tokens to
     * @param   _tokenId The ID of the ERC1155 token
     */
    function _rescueERC1155(address _token, address _to, uint256 _tokenId) internal virtual {
        uint256 balance = IERC1155(_token).balanceOf(address(this), _tokenId);
        require(balance > 0, NO_TOKENS_TO_RESCUE);
        IERC1155(_token).safeTransferFrom(address(this), _to, _tokenId, balance, "");
    }
}
