// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IMeldStakingNFTMetadata {
    /////// EVENTS ///////

    /**
     * @notice  Event emitted when the contract is initialized.
     * @param   stakingAddressProvider  Address of the staking address provider
     */
    event Initialized(address indexed executedBy, address indexed stakingAddressProvider);

    /////// FUNCTIONS ///////

    /**
     * @notice  ADMIN: Initializes the contract, getting the necessary addresses from the MELD Staking Address Provider
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _stakingAddressProvider  Address of the MELD Staking Address Provider
     */
    function initialize(address _stakingAddressProvider) external;

    /**
     * @notice  Generates metadata on the fly, based on the `_tokenId`
     * @dev     It gathers information about the Staking NFT and generates a JSON string
     * @param   _nftId  ID of the NFT
     * @return  string  JSON string containing the metadata of the NFT
     */
    function getMetadata(uint256 _nftId) external view returns (string memory);
}
