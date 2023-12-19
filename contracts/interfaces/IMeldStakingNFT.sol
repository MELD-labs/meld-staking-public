// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {
    IERC721Enumerable
} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

/**
 * @title IMeldStakingNFT
 * @dev Interface Id is 0x80ac58cd
 * @notice This the interface definition for the contract thar represents the NFTs that are minted when a user stakes MELD tokens.
 * These NFTs are used to track the amount staked and the rewards that are owed to the user.
 * @author MELD team
 */
interface IMeldStakingNFT is IERC721Enumerable {
    /////// EVENTS ///////

    /**
     * @notice  Event emitted when the contract is initialized.
     * @param   stakingAddressProvider  Address of the staking address provider
     */
    event Initialized(address indexed executedBy, address indexed stakingAddressProvider);

    /**
     * @notice  Event emitted when the NFT Metadata contract address is updated
     * @param   oldNftMetadata  Address of the old NFT Metadata contract
     * @param   newNftMetadataAddress  Address of the new NFT Metadata contract
     */
    event MetadataAddressUpdated(
        address indexed executedBy,
        address oldNftMetadata,
        address newNftMetadataAddress
    );

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
     * @notice  Event emitted when MELD tokens are deposited into this contract
     * @param   from  Address from which the MELD tokens are deposited
     * @param   amount  Amount of MELD tokens staked
     */
    event MeldDeposited(address indexed from, uint256 amount);

    /**
     * @notice  Event emitted when MELD tokens are withdrawn from this contract
     * @param   to  Address to which the MELD tokens are withdrawn
     * @param   amount  Amount of MELD tokens withdrawn
     */
    event MeldWithdrawn(address indexed to, uint256 amount);

    /**
     * @notice  Event emitted when MELD tokens are rescued from this contract (except the ones staked and the rewards)
     * @param   to  Address to which the MELD tokens are withdrawn
     * @param   amount  Amount of MELD tokens withdrawn
     */
    event MeldRescued(address indexed to, uint256 amount);

    /**
     * @notice  Event emitted when a MELD staking NFT is redeemed
     * @param   owner  Owner of the token being redeemed
     * @param   tokenId  The ID of the NFT to being redeemed
     */
    event Redeemed(address indexed owner, uint256 tokenId);

    ///// ADMIN FUNCTIONS /////

    /**
     * @notice  ADMIN: Initializes the contract, setting the MELD Token and the MELD Staking Common addresses
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _stakingAddressProvider  Address of the MELD Staking Address Provider
     */
    function initialize(address _stakingAddressProvider) external;

    /**
     * @notice  ADMIN: Sets the address of the MELD Staking NFT Metadata contract
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _metadataAddress  Address of the MELD Staking NFT Metadata contract
     */
    function setMetadataAddress(address _metadataAddress) external;

    /**
     * @notice  Allows the admin to rescue the MELD tokens sent to this contract (except the ones staked and the rewards)
     * @dev     Only callable by an account with DEFAULT_ADMIN_ROLE
     * @param   _to The account to transfer the ERC20 tokens to
     */
    function rescueMeldTokens(address _to) external;

    /////// EXTERNAL STAKING COMMON FUNCTIONS ///////

    /**
     * @notice  Mints a new NFT and assigns it to the `_to` address, depositing the `_amount` of MELD tokens
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @dev     The NFT ID is incremented by 1 every time a new NFT is minted
     * @param   _to  The address that will receive the NFT
     * @param   _amount  The amount of MELD tokens to deposit
     * @return  uint256  Returns the ID of the minted NFT
     */
    function mint(address _to, uint256 _amount) external returns (uint256);

    /**
     * @notice  Burns the NFT with the `_tokenId` ID
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @param   _tokenId  The ID of the NFT to burn
     */
    function redeem(uint256 _tokenId) external;

    /**
     * @notice  Deposits `_amount` of MELD tokens to the contract
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @param   _from  Address from which the MELD tokens will be transferred
     * @param   _amount  The amount of MELD tokens to deposit
     */
    function depositMeld(address _from, uint256 _amount) external;

    /**
     * @notice  Withdraws `_amount` of MELD tokens from the contract
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @param   _to  Address to which the MELD tokens will be transferred
     * @param   _amount  The amount of MELD tokens to withdraw
     */
    function withdrawMeld(address _to, uint256 _amount) external;

    /**
     * @notice  Subtracts `_amount` from the total amount of MELD tokens that are locked in the contract
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @param   _amount  The amount of MELD tokens to subtract
     */
    function reduceLockedMeldTokens(uint256 _amount) external;

    ///// VIEW FUNCTIONS /////

    /**
     * @notice  Returns the address of the MELD Staking NFT Metadata contract
     * @return  address  Address of the MELD Staking NFT Metadata contract
     */
    function nftMetadata() external view returns (address);

    /**
     * @notice  Returns the number of NFTs that have been redeemed
     * @return  uint256  The number of NFTs that have been redeemed
     */
    function redeemedNfts() external view returns (uint256);

    /**
     * @notice  Returns the amount of MELD tokens that have been deposited (staked + unclaimedRewards)
     * @return  uint256  The amount of MELD tokens that have been deposited
     */
    function lockedMeldTokens() external view returns (uint256);

    /**
     * @notice  Returns if an NFT currently exists in the collection
     * @dev     Extends the internal exists function from ERC721 standard
     * @param   _tokenId  NFT ID to check for existance
     * @return  bool  Returns if the NFT exists or not
     */
    function exists(uint256 _tokenId) external view returns (bool);

    /**
     * @notice  Returns the total number of minted NFTs
     * @dev     Uses the internal Counters to manage the active NFTs
     * @return  uint256  Returns the number of minted NFTs on the collection
     */
    function getTotalMintedNfts() external view returns (uint256);

    /**
     * @notice  Returns all the NFTs owned by the `_owner` address
     * @param   _owner  The address to query for NFTs
     * @return  uint256[]  Returns an array of NFT IDs owned by the `_owner` address
     */
    function getAllTokensByOwner(address _owner) external view returns (uint256[] memory);
}
