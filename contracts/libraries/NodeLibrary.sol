// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title NodeLibrary
 * @notice This library contains the struct of the MELD Staking at a node level and relevant functions
 * @author MELD team
 */
library NodeLibrary {
    enum NodeStatus {
        None,
        Active,
        Inactive,
        Slashed
    }

    struct Node {
        bytes32 nodeId;
        NodeStatus status;
        uint256 operator;
        uint256 baseStakedAmount;
        uint256 lastEpochStakingUpdated;
        uint256 delegatorFee;
        uint256 maxStakingAmount;
        uint256 endTimestamp;
        uint256 slashedPercentage;
        bool delegatorWhitelistEnabled;
        uint256[] delegators;
        uint256[] lockingExcessWeightEpochs;
        mapping(uint256 epoch => uint256 minStakedAmount) minStakedAmountPerEpoch;
        mapping(uint256 epoch => uint256 lastStakedAmount) lastStakedAmountPerEpoch;
        mapping(uint256 epoch => uint256 excessStake) lockingExcessWeightedStakePerEpoch;
        mapping(uint256 delegator => uint256 index) delegatorIndexes;
        mapping(address delegatorAddress => bool whitelisted) delegatorWhitelist;
    }

    uint256 private constant PERCENTAGE_SCALING = 10000;

    /**
     * @notice  Sets to true the whitelisted status of a delegator.
     * @param   self  Struct that contains the information of the node
     * @param   _address  Address of the delegator
     */
    function addDelegatorToWhitelist(Node storage self, address _address) internal {
        self.delegatorWhitelist[_address] = true;
    }

    /**
     * @notice  Sets to false the whitelisted status of a delegator.
     * @param   self  Struct that contains the information of the node
     * @param   _address  Address of the delegator
     */
    function removeDelegatorFromWhitelist(Node storage self, address _address) internal {
        self.delegatorWhitelist[_address] = false;
    }

    /**
     * @notice  Enables whitelisting for the node (if needed).
     * @param   self  Struct that contains the information of the node
     */
    function enableWhitelistIfNeeded(Node storage self) internal {
        if (!self.delegatorWhitelistEnabled) {
            self.delegatorWhitelistEnabled = true;
        }
    }

    /**
     * @notice  Adds a delegator to the node.
     * @param   self  Struct that contains the information of the node
     * @param   _nftId  NFT ID of the delegator
     */
    function addDelegator(Node storage self, uint256 _nftId) internal {
        self.delegatorIndexes[_nftId] = self.delegators.length;
        self.delegators.push(_nftId);
    }

    /**
     * @notice  Removes a delegator from the node.
     * @param   self  Struct that contains the information of the node
     * @param   _nftId  NFT ID of the delegator
     */
    function removeDelegator(Node storage self, uint256 _nftId) internal {
        uint256 idx = self.delegatorIndexes[_nftId];
        uint256 lastIdx = self.delegators.length - 1;
        uint256 lastNftId = self.delegators[lastIdx];

        // Only need to pop if the element to be removed is the last element
        if (idx != lastIdx) {
            self.delegators[lastIdx] = _nftId;
            delete self.delegatorIndexes[_nftId];

            self.delegatorIndexes[lastNftId] = idx;
            self.delegators[idx] = lastNftId;
        }

        self.delegators.pop();
    }

    /**
     * @notice  Updates the node information of the MELD Staking, since the last epoch that was updated.
     * @param   self  Struct that contains the information of the node
     * @param   _untilEpoch  Epoch until the node information will be updated.
     */
    function updatePreviousEpochs(Node storage self, uint256 _untilEpoch) internal {
        uint256 lastEpochUpdated = self.lastEpochStakingUpdated;

        if (lastEpochUpdated >= _untilEpoch) {
            return;
        }

        uint256 rollingAmount = self.lastStakedAmountPerEpoch[lastEpochUpdated];

        uint256 tempExcessWeightedStake;
        for (uint256 epoch = lastEpochUpdated + 1; epoch <= _untilEpoch; epoch++) {
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
     * @param   self  Struct that contains the information of the node
     * @param   _epoch  Epoch that will be updated.
     */
    function updateMin(Node storage self, uint256 _epoch) internal {
        if (self.lastStakedAmountPerEpoch[_epoch] < self.minStakedAmountPerEpoch[_epoch]) {
            self.minStakedAmountPerEpoch[_epoch] = self.lastStakedAmountPerEpoch[_epoch];
        }
    }

    /**
     * @notice  Calculates the delegation fee amount.
     * @param   self  Struct that contains the information of the node
     * @param   _amount  Amount that will be delegated
     * @return  The delegation fee amount
     */
    function calculateDelegationFeeAmount(
        Node storage self,
        uint256 _amount
    ) internal view returns (uint256) {
        return (_amount * self.delegatorFee) / PERCENTAGE_SCALING;
    }
}
