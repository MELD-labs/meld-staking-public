// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title GlobalLibrary
 * @notice This library contains the struct of the information of the MELD Staking at a global level and relevant functions
 * @author MELD team
 */
library GlobalLibrary {
    struct GlobalInfo {
        uint256 minStakingAmount;
        uint256 maxStakingAmount;
        uint256 minDelegationFee;
        uint256 maxDelegationFee;
        uint256 initTimestamp;
        uint256 epochSize;
        uint256 totalBaseStakedAmount;
        uint256 lastEpochStakingUpdated;
        uint256 lastEpochRewardsUpdated;
        uint256 lastEpochStuckRewardsUpdated;
        mapping(uint256 epoch => uint256 totalRewards) totalRewardsPerEpoch;
        mapping(uint256 epoch => uint256 minStakedAmount) minStakedAmountPerEpoch;
        mapping(uint256 epoch => uint256 lastStakedAmount) lastStakedAmountPerEpoch;
        mapping(uint256 epoch => uint256 excessStake) lockingExcessWeightedStakePerEpoch;
        mapping(uint256 epoch => uint256 stuckRewardShares) stuckRewardSharesPerEpoch;
    }

    /**
     * @notice  Updates the global information of the MELD Staking, since the last epoch that was updated.
     * @dev     If the last epoch that was updated is the same or higher than the current epoch, then the function does nothing.
     * @param   self  Struct that contains the global information of the MELD Staking.
     * @param   _untilEpoch  Epoch until the global information will be updated.
     */
    function updatePreviousEpochs(GlobalInfo storage self, uint256 _untilEpoch) internal {
        if (self.lastEpochStakingUpdated >= _untilEpoch) {
            return;
        }
        uint256 rollingAmount = self.lastStakedAmountPerEpoch[self.lastEpochStakingUpdated];
        uint256 tempExcessWeightedStake;
        for (uint256 epoch = self.lastEpochStakingUpdated + 1; epoch <= _untilEpoch; epoch++) {
            // Subtracting the weighted stake of NFTs that change from locked to liquid this epoch
            tempExcessWeightedStake = self.lockingExcessWeightedStakePerEpoch[epoch];
            if (tempExcessWeightedStake > 0) {
                rollingAmount -= tempExcessWeightedStake;
                self.lockingExcessWeightedStakePerEpoch[epoch] = 0;
            }
            self.lastStakedAmountPerEpoch[epoch] = rollingAmount;
            self.minStakedAmountPerEpoch[epoch] = rollingAmount;
        }
        self.lastEpochStakingUpdated = _untilEpoch;
    }

    /**
     * @notice  If the last staked amount of the epoch is lower than the minimum staked amount of the epoch, then the minimum staked amount of the epoch is updated.
     * @param   self  Struct that contains the global information of the MELD Staking.
     * @param   _epoch  Epoch that will be updated.
     */
    function updateMin(GlobalInfo storage self, uint256 _epoch) internal {
        if (self.lastStakedAmountPerEpoch[_epoch] < self.minStakedAmountPerEpoch[_epoch]) {
            self.minStakedAmountPerEpoch[_epoch] = self.lastStakedAmountPerEpoch[_epoch];
        }
    }
}
