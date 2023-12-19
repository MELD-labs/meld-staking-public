// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IMeldStakingCommonEvents {
    /**
     * @notice  Event emitted when the total staked amount is changed
     * @param   oldTotalStakingAmount  Previous total staked amount
     * @param   newTotalStakingAmount  New total staked amount
     */
    event TotalBaseStakedAmountChanged(
        address indexed executedBy,
        uint256 oldTotalStakingAmount,
        uint256 newTotalStakingAmount
    );

    /**
     * @notice  Event emitted when a staker claims their rewards
     * @param   nftId  ID of the staker
     * @param   amount  Amount of rewards claimed
     */
    event RewardsClaimed(uint256 indexed nftId, uint256 amount);

    /**
     * @notice  Event emitted when the locked staker is upgraded to liquid.
     * @param   nftId  ID of the staker
     * @param   epoch  Epoch of the upgrade
     */
    event StakerUpgradedToLiquid(uint256 indexed nftId, uint256 indexed epoch);
}
