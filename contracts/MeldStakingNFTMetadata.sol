// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import {IMeldStakingNFTMetadata} from "./interfaces/IMeldStakingNFTMetadata.sol";
import {IMeldStakingAddressProvider} from "./interfaces/IMeldStakingAddressProvider.sol";
import {IMeldStakingStorage} from "./interfaces/IMeldStakingStorage.sol";
import "./Errors.sol";
import "./libraries/BokkyPooBahsDateTimeLibrary.sol";

/**
 * @title MeldStakingNFTMetadata
 * @notice A contract that generates the dynamic metadata of the MELD Staking NFTs
 * @author MELD team
 */
contract MeldStakingNFTMetadata is IMeldStakingNFTMetadata, AccessControl {
    using BokkyPooBahsDateTimeLibrary for uint256;
    using Strings for uint256;

    struct StakingParams {
        uint256 nftId;
        uint256 baseStakedAmount;
        uint256 baseStakedAmountUnits;
        bool isNodeRequest;
        bool isDelegator;
        bool isOperator;
        string nodeName;
        uint256 delegatorFee;
        uint256 unclaimedRewards;
        uint256 unclaimedRewardsUnits;
        uint256 cumulativeRewards;
        uint256 cumulativeRewardsUnits;
        uint256 stakingStartTimestamp;
        uint256 epochsSinceLastUnclaimedRewardsUpdate;
        uint256 lockTierId;
        uint256 stakingLength;
        uint256 currentLockedEpochs;
        uint256 lockTierWeight;
        uint256 lockEndingTimestamp;
        string humanLockDuration;
        string humanStartStaking;
        string humanPendingLockStaking;
        string backgroundURL;
        string titleHEX;
    }

    IMeldStakingStorage private stakingStorage;

    string private constant EXTERNAL_URL = "https://meld.com";

    /**
     * Constructor of the contract
     * @param _defaultAdmin This address will have the `DEFAULT_ADMIN_ROLE`
     */
    constructor(address _defaultAdmin) {
        _setupRole(DEFAULT_ADMIN_ROLE, _defaultAdmin);
    }

    /**
     * @notice  ADMIN: Initializes the contract, getting the necessary addresses from the MELD Staking Address Provider
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _stakingAddressProvider  Address of the MELD Staking Address Provider
     */
    function initialize(
        address _stakingAddressProvider
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_stakingAddressProvider != address(0), INVALID_ADDRESS);
        require(address(stakingStorage) == address(0), ALREADY_INITIALIZED);
        IMeldStakingAddressProvider addressProvider = IMeldStakingAddressProvider(
            _stakingAddressProvider
        );
        require(addressProvider.initialized(), ADDRESS_PROVIDER_NOT_INITIALIZED);
        stakingStorage = IMeldStakingStorage(addressProvider.meldStakingStorage());
        emit Initialized(_msgSender(), _stakingAddressProvider);
    }

    /**
     * @notice  Generates metadata on the fly, based on the `_tokenId`
     * @dev     It gathers information about the Staking NFT and generates a JSON string
     * @param   _nftId  ID of the NFT
     * @return  string  JSON string containing the metadata of the NFT
     */
    function getMetadata(uint256 _nftId) external view returns (string memory) {
        (
            string memory name,
            string memory description,
            string memory image,
            string memory attributes
        ) = _buildMetadata(_nftId);

        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(
                        bytes(
                            abi.encodePacked(
                                '{"name":"',
                                name,
                                '", "description":"',
                                description,
                                '", "image": "',
                                "data:image/svg+xml;base64,",
                                Base64.encode(bytes(image)),
                                '", "external_url": "',
                                EXTERNAL_URL,
                                '", "attributes": [',
                                attributes,
                                "]}"
                            )
                        )
                    )
                )
            );
    }

    /**
     * @notice  Builds the metadata of the NFT, including name, description, image and attributes
     * @param   _nftId  ID of the NFT
     * @return  name  Name of the NFT in the metadata
     * @return  description  Description of the NFT
     * @return  image  SVG image of the NFT, includes info about the position
     * @return  attributes  Attributes of the NFT, includes info about the position
     */
    function _buildMetadata(
        uint256 _nftId
    )
        private
        view
        returns (
            string memory name,
            string memory description,
            string memory image,
            string memory attributes
        )
    {
        StakingParams memory params = _getStakingParams(_nftId);
        name = string.concat("MELD staking position #", _nftId.toString());
        if (params.isNodeRequest) {
            description = string.concat(
                "This NFT represents a request to become a node operator with ",
                params.baseStakedAmountUnits.toString(),
                " MELD tokens"
            );
            image = "https://meld-assets.fra1.cdn.digitaloceanspaces.com/stake_nft_apply_bkgd.png";
            attributes = _buildRequestAttributes(_getStakingParams(_nftId));
        } else {
            string memory stakingType = params.lockTierId == 0 ? "liquid" : "locked";
            description = string.concat(
                "This NFT represents the ",
                stakingType,
                " staking of ",
                params.baseStakedAmountUnits.toString(),
                " MELD tokens"
            );
            image = _buildSVG(params);
            attributes = _buildAttributes(_getStakingParams(_nftId));
        }
    }

    /**
     * @notice  Retrieves the info of the NFT Staking Position and returns them in a struct
     * @param   _nftId  ID of the NFT
     * @return  StakingParams  Struct containing the info of the NFT
     */
    function _getStakingParams(uint256 _nftId) private view returns (StakingParams memory) {
        if (!stakingStorage.isStaker(_nftId)) {
            return _getRequestStakingParams(_nftId);
        }
        StakingParams memory params;
        params.nftId = _nftId;
        params.baseStakedAmount = stakingStorage.getStakerBaseStakedAmount(_nftId);
        params.baseStakedAmountUnits = params.baseStakedAmount / 1e18;
        bytes32 nodeId = stakingStorage.getStakerNodeId(_nftId);
        params.nodeName = stakingStorage.getNodeName(nodeId);

        params.isDelegator = stakingStorage.isDelegator(_nftId);
        params.unclaimedRewards = stakingStorage.getStakerUnclaimedRewards(_nftId);
        params.cumulativeRewards = stakingStorage.getStakerCumulativeRewards(_nftId);
        params.unclaimedRewardsUnits = params.unclaimedRewards / 1e18;
        params.cumulativeRewardsUnits = params.cumulativeRewards / 1e18;
        params.delegatorFee = stakingStorage.getNodeDelegatorFee(nodeId);
        uint256 currentEpoch = stakingStorage.getCurrentEpoch();
        params.epochsSinceLastUnclaimedRewardsUpdate =
            currentEpoch -
            stakingStorage.getStakerLastEpochRewardsUpdated(_nftId);

        params.lockTierId = stakingStorage.getStakerLockTierId(_nftId);
        params.stakingStartTimestamp = stakingStorage.getStakerStakingStartTimestamp(_nftId);

        {
            (uint yearStart, uint monthStart, uint dayStart, , , ) = params
                .stakingStartTimestamp
                .timestampToDateTime();
            params.humanStartStaking = string.concat(
                dayStart.toString(),
                "/",
                monthStart.toString(),
                "/",
                yearStart.toString()
            );
        }

        if (params.lockTierId != 0) {
            IMeldStakingStorage.LockStakingTier memory lockTier = stakingStorage.getLockStakingTier(
                params.lockTierId
            );
            params.stakingLength = lockTier.stakingLength;
            params.lockTierWeight = lockTier.weight;

            uint256 startLockEpoch = stakingStorage.getEpoch(params.stakingStartTimestamp) + 1;
            if (currentEpoch > startLockEpoch) {
                params.currentLockedEpochs = currentEpoch - startLockEpoch;
            }
            uint256 endLockEpoch = startLockEpoch + params.stakingLength;
            params.lockEndingTimestamp = stakingStorage.getEpochEnd(endLockEpoch);

            if (params.lockEndingTimestamp > block.timestamp) {
                uint year = BokkyPooBahsDateTimeLibrary.diffYears(
                    params.stakingStartTimestamp,
                    params.lockEndingTimestamp
                );
                uint month = BokkyPooBahsDateTimeLibrary.diffMonths(
                    params.stakingStartTimestamp,
                    params.lockEndingTimestamp
                );
                uint day = BokkyPooBahsDateTimeLibrary.diffDays(
                    params.stakingStartTimestamp,
                    params.lockEndingTimestamp
                );
                uint hour = BokkyPooBahsDateTimeLibrary.diffHours(
                    params.stakingStartTimestamp,
                    params.lockEndingTimestamp
                );
                uint min = BokkyPooBahsDateTimeLibrary.diffMinutes(
                    params.stakingStartTimestamp,
                    params.lockEndingTimestamp
                );
                string memory tempDateTime;
                uint counter;

                // Only showing 3 most significant values
                if (year > 0) {
                    tempDateTime = string.concat(tempDateTime, year.toString(), "Years, ");
                    counter++;
                }
                if (month > 0) {
                    tempDateTime = string.concat(tempDateTime, month.toString(), "Months, ");
                    counter++;
                }

                tempDateTime = string.concat(tempDateTime, day.toString(), "Days ");

                if (counter < 2) {
                    tempDateTime = string.concat(tempDateTime, ", ", hour.toString(), " Hours");
                }
                if (counter < 1) {
                    tempDateTime = string.concat(tempDateTime, ", ", min.toString(), " Mins.");
                }

                params.humanPendingLockStaking = tempDateTime;
            } else {
                params.humanPendingLockStaking = "UNLOCKED";
            }
        }

        if (params.lockTierId == 0) {
            params.humanLockDuration = "Liquid";
            params
                .backgroundURL = "https://meld-assets.fra1.cdn.digitaloceanspaces.com/stake_nft_ls_bkgd.png";
            params.titleHEX = "#4949b8";
        } else if (params.lockTierId == 1) {
            params.humanLockDuration = "6 Months";
            params
                .backgroundURL = "https://meld-assets.fra1.cdn.digitaloceanspaces.com/stake_nft_6m_bkgd.png";
            params.titleHEX = "#d23449";
        } else if (params.lockTierId == 2) {
            params.humanLockDuration = "1 Year";
            params
                .backgroundURL = "https://meld-assets.fra1.cdn.digitaloceanspaces.com/stake_nft_1y_bkgd.png";
            params.titleHEX = "#bb7025";
        } else if (params.lockTierId == 3) {
            params.humanLockDuration = "5 Years";
            params
                .backgroundURL = "https://meld-assets.fra1.cdn.digitaloceanspaces.com/stake_nft_5y_bkgd.png";
            params.titleHEX = "#528063";
        } else {
            params.humanLockDuration = "MELDING";
            params
                .backgroundURL = "https://meld-assets.fra1.cdn.digitaloceanspaces.com/stake_nft_ls_bkgd.png";
            params.titleHEX = "#ffffff";
        }

        if (stakingStorage.isOperator(_nftId)) {
            params.humanLockDuration = "OPERATOR";
            params
                .backgroundURL = "https://meld-assets.fra1.cdn.digitaloceanspaces.com/stake_nft_no_bkgd.png";
            params.isOperator = true;
            params.titleHEX = "#ffffff";
        }

        return params;
    }

    /**
     * @notice  Retrieves the info of the NFT Node Request and returns them in a struct
     * @param   _nftId  ID of the NFT
     * @return  StakingParams  Struct containing the info of the NFT
     */
    function _getRequestStakingParams(uint256 _nftId) private view returns (StakingParams memory) {
        StakingParams memory params;
        params.nftId = _nftId;
        params.isNodeRequest = true;
        bytes32 nodeId = stakingStorage.nodeRequestsPerOperator(_nftId);
        IMeldStakingStorage.NodeRequest memory nodeRequest = stakingStorage.getNodeRequest(nodeId);
        params.baseStakedAmount = nodeRequest.stakingAmount;
        params.baseStakedAmountUnits = params.baseStakedAmount / 1e18;
        params.nodeName = stakingStorage.getNodeName(nodeId);
        params.lockTierId = nodeRequest.lockTierId;
        params.delegatorFee = nodeRequest.delegatorFee;

        if (params.lockTierId != 0) {
            IMeldStakingStorage.LockStakingTier memory lockTier = stakingStorage.getLockStakingTier(
                params.lockTierId
            );
            params.stakingLength = lockTier.stakingLength;
            params.lockTierWeight = lockTier.weight;
        }
        return params;
    }

    /**
     * @notice  Builds the SVG image of the NFT, including the info of the position
     * @param   params  Struct containing the info of the NFT
     * @return  svg  SVG image of the NFT
     */
    function _buildSVG(StakingParams memory params) private pure returns (string memory svg) {
        svg = string.concat(
            unicode'<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"	 viewBox="0 0 1000 1000" style="enable-background:new 0 0 1000 1000;" xml:space="preserve"><style type="text/css">	.st0{fill:#EACAD4;}	.st1{opacity:0.5;fill:#00AEEF;enable-background:new    ;}	.st2{font-family:"Menlo-Regular";}	.st3{font-size:30px;}	.st4{fill:#231F20;enable-background:new    ;}	.st5{font-family:"BRHendrix-Bold";}	.st6{font-size:24px;}	.st7{fill:#E61B44;enable-background:new    ;}	.st8{font-family:"BRHendrix-Black";}	.st9{font-size:19px;}	.st10{font-size:42px;}	.st11{opacity:0.5;fill:#231F20;enable-background:new    ;}	.st12{fill:',
            // Title color
            params.titleHEX,
            unicode';}	.st13{font-size:132px;}</style><g id="bkgd">	<rect class="st0" width="1000" height="1000"/></g><g id="bkgd_x5F_graphic">			<image style="overflow:visible;enable-background:new    ;" width="3000" height="3000" xlink:href="',
            // BACKGROUND IMG
            params.backgroundURL,
            '"',
            unicode' transform="matrix(0.3333 0 0 0.3333 -0.1382 0)">	</image></g><g id="Layer_3">	<text onload="asset_no" transform="matrix(1 0 0 1 63 543)" class="st1 st2 st3">',
            // NFT ID
            "N-",
            uint256ToStringPadded(params.nftId, 10),
            unicode'</text>	<text onload="pool_ticker" transform="matrix(1 0 0 1 63 808)" class="st4 st5 st6">',
            // POOL NAME
            params.nodeName,
            unicode"</text>",
            '<text onload="staked_meld" transform="matrix(1 0 0 1 100 745)" class="st4 st5 st10">',
            // STAKED AMOUNT
            params.baseStakedAmountUnits.toString(),
            "</text>",
            unicode'<text onload="staked_meld" transform="matrix(-1 0 0 -1 92 715)" class="st4 st5 st10">₩</text>',
            '<text onload="stake_start" transform="matrix(1 0 0 1 499 808)" class="st4 st5 st6">',
            // STAKE START DATE
            params.humanStartStaking,
            "</text>"
        );

        svg = string.concat(
            svg,
            '<text onload="reward_date" transform="matrix(1 0 0 1 85 873)" class="st4 st5 st6">',
            // REWARDS TO DATE
            params.cumulativeRewardsUnits.toString(),
            unicode"</text>",
            unicode'<text onload="staked_meld" transform="matrix(-1 0 0 -1 80 856)" class="st4 st5 st6">₩</text>',
            '<text onload="unclaimed_rewards" transform="matrix(1 0 0 1 525 873)" class="st4 st5 st6">',
            // UNCLAIMED REWARDS
            params.unclaimedRewardsUnits.toString(),
            "</text>",
            unicode'<text onload="staked_meld" transform="matrix(-1 0 0 -1 518 857)" class="st4 st5 st6">₩</text>',
            '</g><text transform="matrix(1 0 0 1 63 79.2438)" class="st11 st8 st9">',
            params.isOperator ? "MELD NODE" : "STAKING NFT",
            "</text>",
            '<text transform="matrix(1 0 0 1 63 782)" class="st11 st8 st9">POOL</text>',
            '<text transform="matrix(1 0 0 1 63 704.4359)" class="st11 st8 st9">STAKED</text>',
            '<text transform="matrix(1 0 0 1 499 782)" class="st11 st8 st9">STAKED ON</text>',
            '<text transform="matrix(1 0 0 1 63 845)" class="st11 st8 st9">REWARDS TO DATE</text>',
            '<text transform="matrix(1 0 0 1 499 845)" class="st11 st8 st9">UNCLAIMED REWARDS</text>',
            '<text transform="matrix(1 0 0 1 59.7923 186.2092)" class="st12 st8 st13">',
            // LOCK PERIOD IN HUMAN (can be liquid)
            params.humanLockDuration,
            "</text>"
        );

        if (params.lockTierId != 0) {
            svg = string.concat(
                svg,
                '<text onload="lockup_end" transform="matrix(1 0 0 1 720 912)" class="st7 st8 st9">',
                // STAKE LOCK FINISH DATE
                params.humanPendingLockStaking,
                "</text>",
                '<text transform="matrix(1 0 0 1 63 912)" class="st11 st8 st9">LOCKUP TIME REMAINING</text>'
            );
        }

        svg = string.concat(svg, "</svg>");
    }

    /**
     * @notice  Builds the attributes of the NFT, including the info of the position
     * @param   params  Struct containing the info of the NFT
     * @return  attributes  Attributes of the NFT
     */
    function _buildAttributes(StakingParams memory params) private pure returns (string memory) {
        string memory attributes = string.concat(
            '{"display_type": "number", "trait_type": "Staked amount", "value": "',
            params.baseStakedAmountUnits.toString(),
            '"},',
            '{"trait_type": "Staker type", "value": "',
            params.isDelegator ? "Delegator" : "Node operator",
            '"},',
            '{"trait_type": "Node ID", "value": "',
            params.nodeName,
            '"},',
            '{"display_type": "number", "trait_type": "Delegator fee", "value": "',
            params.delegatorFee.toString(),
            '"},',
            '{"display_type": "number", "trait_type": "Unclaimed rewards", "value": "',
            params.unclaimedRewardsUnits.toString(),
            '"},',
            '{"display_type": "number", "trait_type": "Cumulative rewards", "value": "',
            params.cumulativeRewardsUnits.toString(),
            '"},',
            '{"trait_type": "Rewards updated", "value": "',
            params.epochsSinceLastUnclaimedRewardsUpdate.toString(),
            ' epochs ago"}',
            ',{"display_type": "date", "trait_type": "Staking starting time", "value": "',
            params.stakingStartTimestamp.toString(),
            '"}'
        );

        if (params.lockTierId != 0) {
            attributes = string.concat(
                attributes,
                ',{"display_type": "date", "trait_type": "Locked ending time", "value": "',
                params.lockEndingTimestamp.toString(),
                '"},',
                '{"display_type": "number", "trait_type": "Current locked epochs", "value": "',
                params.currentLockedEpochs.toString(),
                '"},',
                '{"display_type": "number", "trait_type": "Total locked epochs", "value": "',
                params.stakingLength.toString(),
                '"},',
                '{"display_type": "number", "trait_type": "Weighting for rewards", "value": "',
                params.lockTierWeight.toString(),
                '"}'
            );
        }

        return attributes;
    }

    /**
     * @notice  Builds the attributes of the NFT Node Request, including the info of the position
     * @param   params  Struct containing the info of the NFT
     * @return  attributes  Attributes of the NFT
     */
    function _buildRequestAttributes(
        StakingParams memory params
    ) private pure returns (string memory) {
        string memory attributes = string.concat(
            '{"trait_type": "Staked amount", "value": "',
            params.baseStakedAmountUnits.toString(),
            ' MELD"},',
            '{"trait_type": "Node ID", "value": "',
            params.nodeName,
            '"},',
            '{"trait_type": "Delegator fee", "value": "',
            params.delegatorFee.toString(),
            '"}'
        );

        if (params.lockTierId != 0) {
            attributes = string.concat(
                attributes,
                ',{"trait_type": "Total locked epochs", "value": "',
                params.stakingLength.toString(),
                '"},',
                '{"trait_type": "Weighting for rewards", "value": "',
                params.lockTierWeight.toString(),
                '"}'
            );
        }

        return attributes;
    }

    function uint256ToStringPadded(
        uint256 _value,
        uint256 _padding
    ) public pure returns (string memory) {
        // Convert the uint256 to a string
        string memory stringValue = Strings.toString(_value);

        // Calculate the number of zeros to pad
        uint256 length = bytes(stringValue).length;
        uint256 padding = _padding - length;

        // Pad the string with zeros
        string memory paddedString = "";
        for (uint256 i = 0; i < padding; i++) {
            paddedString = string(abi.encodePacked("0", paddedString));
        }

        return string(abi.encodePacked(paddedString, stringValue));
    }
}
