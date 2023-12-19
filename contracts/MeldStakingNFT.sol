// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import {
    ERC721,
    ERC721Enumerable
} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {RescueTokens} from "./base/RescueTokens.sol";
import {IMeldStakingNFT} from "./interfaces/IMeldStakingNFT.sol";
import {IMeldStakingStorage} from "./interfaces/IMeldStakingStorage.sol";
import {IMeldStakingAddressProvider} from "./interfaces/IMeldStakingAddressProvider.sol";
import {IMeldStakingNFTMetadata} from "./interfaces/IMeldStakingNFTMetadata.sol";
import "@opengsn/contracts/src/ERC2771Recipient.sol";
import "./Errors.sol";

/**
 * @title MeldStakingNFT
 * @dev Interface Id is 0x80ac58cd
 * @notice This contract represents the NFTs that are minted when a user stakes MELD tokens.
 * These NFTs are used to track the amount staked and the rewards that are owed to the user.
 * @author MELD team
 */
contract MeldStakingNFT is
    ERC721Enumerable,
    RescueTokens,
    IMeldStakingNFT,
    AccessControl,
    ERC2771Recipient
{
    using Counters for Counters.Counter;
    using SafeERC20 for IERC20;

    bytes32 public constant TRUSTED_FORWARDER_SETTER_ROLE =
        keccak256("TRUSTED_FORWARDER_SETTER_ROLE");

    Counters.Counter private _tokenIdCounter;

    /// @dev The addresses of the MeldStaking contracts.
    address private meldStakingCommonAddress;
    address private meldStakingConfigAddress;
    IMeldStakingStorage private meldStakingStorageAddress;
    IERC20 private meldToken;
    address public override nftMetadata;

    /// @dev The number of NFTs that have been redeemed.
    uint256 public override redeemedNfts;

    /// @dev The number of MELD tokens that have been deposited (staked + unclaimedRewards)
    uint256 public override lockedMeldTokens;

    /// @dev Modifier that checks that the sender is not the trusted forwarder
    /// @dev This is used to prevent meta-transactions from being sent to the centralized functions
    modifier notTrustedForwarder() {
        require(
            !isTrustedForwarder(msg.sender),
            "EIP2771Recipient: meta transaction is not allowed"
        );
        _;
    }

    /**
     * @notice  Checks that the sender of the transaction is the MeldStaking contract
     */
    modifier onlyMeldStaking() {
        require(
            _msgSender() == meldStakingCommonAddress || _msgSender() == meldStakingConfigAddress,
            CALLER_NOT_STAKING
        );
        _;
    }

    /**
     * Constructor of the contract
     * @param _defaultAdmin This address will have the `DEFAULT_ADMIN_ROLE`
     */
    constructor(address _defaultAdmin) ERC721("MeldStakingNFT", "MELD-STAKING-NFT") {
        _setupRole(DEFAULT_ADMIN_ROLE, _defaultAdmin);
    }

    ///// ADMIN FUNCTIONS /////

    /**
     * @notice  ADMIN: Initializes the contract, setting the MELD Token and the MELD Staking Common addresses
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _stakingAddressProvider  Address of the MELD Staking Address Provider
     */
    function initialize(
        address _stakingAddressProvider
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) notTrustedForwarder {
        require(_stakingAddressProvider != address(0), INVALID_ADDRESS);
        require(
            meldStakingCommonAddress == address(0) &&
                meldStakingConfigAddress == address(0) &&
                address(meldStakingStorageAddress) == address(0),
            ALREADY_INITIALIZED
        );
        IMeldStakingAddressProvider addressProvider = IMeldStakingAddressProvider(
            _stakingAddressProvider
        );
        require(addressProvider.initialized(), ADDRESS_PROVIDER_NOT_INITIALIZED);
        meldStakingCommonAddress = addressProvider.meldStakingCommon();
        meldStakingConfigAddress = addressProvider.meldStakingConfig();
        meldStakingStorageAddress = IMeldStakingStorage(addressProvider.meldStakingStorage());
        meldToken = IERC20(addressProvider.meldToken());

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

    /**
     * @notice  ADMIN: Sets the address of the MELD Staking NFT Metadata contract
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _metadataAddress  Address of the MELD Staking NFT Metadata contract
     */
    function setMetadataAddress(
        address _metadataAddress
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) notTrustedForwarder {
        require(_metadataAddress != address(0), INVALID_ADDRESS);
        emit MetadataAddressUpdated(_msgSender(), address(nftMetadata), _metadataAddress);
        nftMetadata = _metadataAddress;
    }

    /////// EXTERNAL STAKING COMMON FUNCTIONS ///////

    /**
     * @notice  Mints a new NFT and assigns it to the `_to` address, depositing the `_amount` of MELD tokens
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @dev     The NFT ID is incremented by 1 every time a new NFT is minted
     * @param   _to  The address that will receive the NFT
     * @param   _amount  The amount of MELD tokens to deposit
     * @return  uint256  Returns the ID of the minted NFT
     */
    function mint(
        address _to,
        uint256 _amount
    ) external override onlyMeldStaking returns (uint256) {
        _depositMeld(_to, _amount);
        _tokenIdCounter.increment();
        uint256 tokenId = _tokenIdCounter.current();
        _safeMint(_to, tokenId);
        return tokenId;
    }

    /**
     * @notice  Burns the NFT with the `_tokenId` ID
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @param   _tokenId  The ID of the NFT to burn
     */
    function redeem(uint256 _tokenId) external override onlyMeldStaking {
        address owner = _ownerOf(_tokenId);
        _burn(_tokenId);
        redeemedNfts++;
        emit Redeemed(owner, _tokenId);
    }

    /**
     * @notice  Deposits `_amount` of MELD tokens to the contract
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @param   _from  Address from which the MELD tokens will be transferred
     * @param   _amount  The amount of MELD tokens to deposit
     */
    function depositMeld(address _from, uint256 _amount) external override onlyMeldStaking {
        _depositMeld(_from, _amount);
    }

    /**
     * @notice  Withdraws `_amount` of MELD tokens from the contract
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @param   _to  Address to which the MELD tokens will be transferred
     * @param   _amount  The amount of MELD tokens to withdraw
     */
    function withdrawMeld(address _to, uint256 _amount) external override onlyMeldStaking {
        require(_amount > 0 && _amount <= lockedMeldTokens, WITHDRAW_INVALID_AMOUNT);
        lockedMeldTokens -= _amount;
        meldToken.safeTransfer(_to, _amount);
        emit MeldWithdrawn(_to, _amount);
    }

    /**
     * @notice  Subtracts `_amount` from the total amount of MELD tokens that are locked in the contract
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @param   _amount  The amount of MELD tokens to subtract
     */
    function reduceLockedMeldTokens(uint256 _amount) external override onlyMeldStaking {
        require(_amount > 0 && _amount <= lockedMeldTokens, REDUCE_LOCKED_TOKENS_INVALID_AMOUNT);
        lockedMeldTokens -= _amount;
    }

    /////// RESCUE TOKENS ///////

    /**
     * @notice  Allows the admin to rescue the MELD tokens sent to this contract (except the ones staked and the rewards)
     * @dev     Only callable by an account with DEFAULT_ADMIN_ROLE
     * @param   _to The account to transfer the ERC20 tokens to
     */
    function rescueMeldTokens(address _to) public override onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 amount = meldToken.balanceOf(address(this)) - lockedMeldTokens;
        meldToken.safeTransfer(_to, amount);
        emit MeldRescued(_to, amount);
    }

    /**
     * @notice Allows the admin to rescue ERC20 tokens sent to this contract
     * @dev Only callable by an account with DEFAULT_ADMIN_ROLE
     * @param _token The address of the ERC20 token to rescue
     * @param _to The account to transfer the ERC20 tokens to
     */
    function rescueERC20(address _token, address _to) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_token != address(meldToken), NO_RESCUE_STAKING_TOKEN);
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
        require(_token != address(this), NO_RESCUE_STAKING_NFT);
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

    ///// VIEW FUNCTIONS /////

    function tokenURI(uint256 _nftId) public view virtual override returns (string memory) {
        require(nftMetadata != address(0), METADATA_ADDRESS_NOT_SET);
        _requireMinted(_nftId);
        return IMeldStakingNFTMetadata(nftMetadata).getMetadata(_nftId);
    }

    /**
     * @notice  Returns if an NFT currently exists in the collection
     * @dev     Extends the internal exists function from ERC721 standard
     * @param   _tokenId  NFT ID to check for existance
     * @return  bool  Returns if the NFT exists or not
     */
    function exists(uint256 _tokenId) external view override returns (bool) {
        return _exists(_tokenId);
    }

    /**
     * @notice  Returns the total number of minted NFTs
     * @dev     Uses the internal Counters to manage the active NFTs
     * @return  uint256  Returns the number of minted NFTs on the collection
     */
    function getTotalMintedNfts() external view override returns (uint256) {
        return _tokenIdCounter.current();
    }

    /**
     * @notice  Returns all the NFTs owned by the `_owner` address
     * @param   _owner  The address to query for NFTs
     * @return  uint256[]  Returns an array of NFT IDs owned by the `_owner` address
     */
    function getAllTokensByOwner(address _owner) external view returns (uint256[] memory) {
        uint256 tokenCount = balanceOf(_owner);
        uint256[] memory result = new uint256[](tokenCount);
        for (uint256 i = 0; i < tokenCount; i++) {
            result[i] = tokenOfOwnerByIndex(_owner, i);
        }
        return result;
    }

    /**
     * @notice  Returns true if the contract implements the interface defined by `_interfaceId`
     * @param   _interfaceId  The interface identifier, as specified in ERC-165
     * @return  bool  Result of the check for interface implemented
     */
    function supportsInterface(
        bytes4 _interfaceId
    ) public view override(AccessControl, ERC721Enumerable, IERC165) returns (bool) {
        return super.supportsInterface(_interfaceId);
    }

    ///// PRIVATE FUNCTIONS /////

    /**
     * @notice  Deposits `_amount` of MELD tokens to the contract
     * @dev     This function can only be called from the MeldStakingCommon contract
     * @param   _from  Address from which the MELD tokens will be transferred
     * @param   _amount  The amount of MELD tokens to deposit
     */
    function _depositMeld(address _from, uint256 _amount) private {
        require(_from != address(0), INVALID_ADDRESS);
        require(_amount > 0 && _amount <= meldToken.balanceOf(_from), DEPOSIT_INVALID_AMOUNT);
        require(meldToken.allowance(_from, address(this)) >= _amount, INSUFFICIENT_ALLOWANCE);
        lockedMeldTokens += _amount;
        meldToken.safeTransferFrom(_from, address(this), _amount);
        emit MeldDeposited(_from, _amount);
    }

    /// @notice Overrides _msgSender hook to add support for meta-transactions using the ERC2771 standard
    function _msgSender()
        internal
        view
        override(Context, ERC2771Recipient)
        returns (address sender)
    {
        sender = ERC2771Recipient._msgSender();
    }

    /// @notice Overrides _msgData hook to add support for meta-transactions using the ERC2771 standard
    function _msgData() internal view override(Context, ERC2771Recipient) returns (bytes calldata) {
        return ERC2771Recipient._msgData();
    }

    /**
     * @notice  Transfer management of an NFT
     * @dev     Prevents operator NFTs from being moved
     * @param   from  Current owner of the NFT
     * @param   to  Recepient of the transfer
     * @param   tokenId  ID of the token to be moved
     */
    function _transfer(address from, address to, uint256 tokenId) internal override {
        // Custom check to prevent operator NFTs being moved
        require(meldStakingStorageAddress.isDelegator(tokenId), NO_OPERATOR_NFT_TRANSFER);

        // Call the original _transfer function
        super._transfer(from, to, tokenId);
    }
}
