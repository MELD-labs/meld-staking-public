// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title StakerLibrary
 * @notice This library contains the struct of the MELD Staking at a staker level and relevant functions
 * @author MELD team
 */
library StakerLibrary {
    enum StakerType {
        None,
        Operator,
        Delegator
    }

    struct Staker {
        uint256 nftId;
        StakerType stakerType;
        uint256 baseStakedAmount;
        bytes32 nodeId;
        uint256 lastEpochStakingUpdated;
        uint256 lastEpochRewardsUpdated;
        uint256 lockTierId;
        uint256 unclaimedRewards;
        uint256 cumulativeRewards;
        uint256 stakingStartTimestamp;
        mapping(uint256 epoch => uint256 minStakedAmount) minStakedAmountPerEpoch;
        mapping(uint256 epoch => uint256 lastStakedAmount) lastStakedAmountPerEpoch;
    }

    /**
     * @notice  If the last staked amount of the epoch is lower than the minimum staked amount of the epoch, then the minimum staked amount of the epoch is updated.
     * @param   self  Struct that contains the information of the staker
     * @param   _epoch  Epoch to be updated
     */
    function updateMin(Staker storage self, uint256 _epoch) internal {
        if (self.lastStakedAmountPerEpoch[_epoch] < self.minStakedAmountPerEpoch[_epoch]) {
            self.minStakedAmountPerEpoch[_epoch] = self.lastStakedAmountPerEpoch[_epoch];
        }
    }
}
