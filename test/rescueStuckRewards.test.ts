import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  delegateToNode,
  deployAndConfigContracts,
  requestNode,
  toMeldDecimals,
  transferAndApproveTokens,
} from "./utils/utils";
import { PERCENTAGE_SCALING } from "./utils/constants";

describe("Stuck Rewards", function () {
  // Deploy the contracts and initialize them
  async function rewardsStuckFixture() {
    const [
      deployer,
      rando,
      rewardsSetter,
      slashReceiver,
      operator,
      operator2,
      delegator,
      delegator2,
    ] = await ethers.getSigners();
    const initTimestamp = (await time.latest()) + 1000;
    const epochSize = 5 * 24 * 60 * 60; // 5 days
    const contracts = await deployAndConfigContracts(
      deployer.address,
      initTimestamp,
      epochSize,
      slashReceiver.address
    );
    await time.increaseTo(initTimestamp + 1);

    // Params for the node request
    const nodeName = "testNode";
    const delegatorFee = 10_00; // 10%
    const operatorAmount = toMeldDecimals(110_000);
    const lockTierId = 0;
    const metadata = "";

    await requestNode(
      contracts.meldToken,
      contracts.meldStakingOperator,
      contracts.meldStakingNFT,
      deployer,
      operator,
      nodeName,
      delegatorFee,
      operatorAmount,
      lockTierId,
      metadata
    );

    // Node id is the hash of the node name
    const nodeId = await contracts.meldStakingOperator.hashNodeId(nodeName);
    await contracts.meldStakingConfig
      .connect(deployer)
      .approveNodeRequest(nodeId);

    const operatorNFT = await contracts.meldStakingNFT.getTotalMintedNfts();
    await contracts.meldStakingConfig
      .connect(deployer)
      .grantRole(
        await contracts.meldStakingConfig.REWARDS_SETTER_ROLE(),
        rewardsSetter.address
      );
    return {
      deployer,
      rando,
      rewardsSetter,
      slashReceiver,
      operator,
      operator2,
      delegator,
      delegator2,
      initTimestamp,
      epochSize,
      operatorAmount,
      nodeId,
      operatorNFT,
      ...contracts,
    };
  }
  context("Happy flow test cases", function () {
    it("Should emit the StuckRewardsUpdated event when updating the stuck rewards", async function () {
      const {
        deployer,
        operator,
        rewardsSetter,
        meldToken,
        meldStakingConfig,
        meldStakingOperator,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(rewardsStuckFixture);

      // Since there are no stuck rewards, the event should not be emitted
      expect(await meldStakingConfig.updateStuckRewards()).not.to.emit(
        meldStakingConfig,
        "StuckRewardsUpdated"
      );

      const epochSize = await meldStakingStorage.getEpochSize();
      // Advance 2 epochs so operator is entitled to rewards
      time.increase(2n * epochSize);

      // Operator then leaves node without claiming rewards (they are not set yet)
      const nftId = await meldStakingNFT.getTotalMintedNfts();
      await meldStakingOperator.connect(operator).leaveNode(nftId);

      // Rewards are set for the epoch after the operator left the node
      const rewardsAmount = toMeldDecimals(10_000);
      await transferAndApproveTokens(
        meldToken,
        deployer,
        rewardsSetter,
        await meldStakingNFT.getAddress(),
        rewardsAmount
      );

      const setRewardsEpoch = 2n;

      await meldStakingConfig
        .connect(rewardsSetter)
        .setRewards(rewardsAmount, setRewardsEpoch);

      // Update stuck rewards
      expect(await meldStakingConfig.updateStuckRewards())
        .to.emit(meldStakingConfig, "StuckRewardsUpdated")
        .withArgs(deployer.address, 0, setRewardsEpoch, rewardsAmount);
    });
    it("Should update the stuck rewards with just one operator", async function () {
      const {
        deployer,
        operator,
        rewardsSetter,
        operatorAmount,
        meldToken,
        meldStakingConfig,
        meldStakingOperator,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(rewardsStuckFixture);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(operatorAmount);

      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(0n)
      ).to.equal(0n);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(1n)
      ).to.equal(0n);

      // Since there are no stuck rewards, the event should not be emitted
      expect(await meldStakingConfig.updateStuckRewards()).not.to.emit(
        meldStakingConfig,
        "StuckRewardsUpdated"
      );

      const epochSize = await meldStakingStorage.getEpochSize();
      // Advance 2 epochs so operator is entitled to rewards
      time.increase(2n * epochSize);

      // Operator then leaves node without claiming rewards (they are not set yet)
      const nftId = await meldStakingNFT.getTotalMintedNfts();
      await meldStakingOperator.connect(operator).leaveNode(nftId);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(0n);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(2n)
      ).to.equal(operatorAmount);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(3n)
      ).to.equal(0n);

      // Rewards are set for the epoch after the operator left the node
      const rewardsAmount = toMeldDecimals(10_000);
      await transferAndApproveTokens(
        meldToken,
        deployer,
        rewardsSetter,
        await meldStakingNFT.getAddress(),
        rewardsAmount
      );

      const setRewardsEpoch = 2n;

      await meldStakingConfig
        .connect(rewardsSetter)
        .setRewards(rewardsAmount, setRewardsEpoch);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(rewardsAmount);

      await meldStakingConfig.updateStuckRewards();

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(0n);

      const balanceBefore = await meldToken.balanceOf(deployer.address);
      await meldStakingNFT.rescueMeldTokens(deployer.address);
      const balanceAfter = await meldToken.balanceOf(deployer.address);

      expect(balanceAfter).to.equal(balanceBefore + rewardsAmount);
    });
    it("Should update the stuck rewards with one operator and one delegator. Operator leaves", async function () {
      const {
        deployer,
        operator,
        delegator,
        nodeId,
        rewardsSetter,
        operatorAmount,
        meldToken,
        meldStakingConfig,
        meldStakingCommon,
        meldStakingOperator,
        meldStakingDelegator,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(rewardsStuckFixture);
      const operatorNFT = await meldStakingNFT.getTotalMintedNfts();

      // Delegator stakes

      const delegationAmount = toMeldDecimals(50_000);

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator,
        delegationAmount,
        nodeId,
        0
      );

      const delegatorNFT = await meldStakingNFT.getTotalMintedNfts();

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        operatorAmount + delegationAmount
      );

      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(0n)
      ).to.equal(0n);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(1n)
      ).to.equal(0n);

      // Since there are no stuck rewards, the event should not be emitted
      expect(await meldStakingConfig.updateStuckRewards()).not.to.emit(
        meldStakingConfig,
        "StuckRewardsUpdated"
      );

      const epochSize = await meldStakingStorage.getEpochSize();
      // Advance 2 epochs so operator is entitled to rewards
      time.increase(2n * epochSize);

      // Operator leaves node

      await meldStakingOperator.connect(operator).leaveNode(operatorNFT);

      // Advance 10 days

      await time.increase(10 * 24 * 60 * 60);

      const fee = await meldStakingStorage.getNodeDelegatorFee(nodeId);
      const feeAmount = (delegationAmount * fee) / PERCENTAGE_SCALING;

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        delegationAmount
      );
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(2n)
      ).to.equal(operatorAmount + feeAmount);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(3n)
      ).to.equal(0n);

      // Rewards are set for the epoch after the operator left the node
      const rewardsAmount = toMeldDecimals(10_000);
      await transferAndApproveTokens(
        meldToken,
        deployer,
        rewardsSetter,
        await meldStakingNFT.getAddress(),
        rewardsAmount
      );

      const setRewardsEpoch = 2n;

      await meldStakingConfig
        .connect(rewardsSetter)
        .setRewards(rewardsAmount, setRewardsEpoch);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        rewardsAmount + delegationAmount
      );

      await meldStakingConfig.updateStuckRewards();

      await meldStakingCommon
        .connect(delegator)
        .updateUnclaimedRewards(delegatorNFT);

      const delegatorUnclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(delegatorNFT);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        delegatorUnclaimedRewards + delegationAmount
      );

      const balanceBefore = await meldToken.balanceOf(deployer.address);
      await meldStakingNFT.rescueMeldTokens(deployer.address);
      const balanceAfter = await meldToken.balanceOf(deployer.address);

      expect(balanceAfter).to.equal(
        balanceBefore + (rewardsAmount - delegatorUnclaimedRewards)
      );
    });
    it("Should update the stuck rewards with one operator and one delegator. Delegator leaves", async function () {
      const {
        deployer,
        operator,
        delegator,
        nodeId,
        rewardsSetter,
        operatorAmount,
        meldToken,
        meldStakingConfig,
        meldStakingCommon,
        meldStakingDelegator,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(rewardsStuckFixture);
      const operatorNFT = await meldStakingNFT.getTotalMintedNfts();

      // Delegator stakes

      const delegationAmount = toMeldDecimals(50_000);

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator,
        delegationAmount,
        nodeId,
        0
      );

      const delegatorNFT = await meldStakingNFT.getTotalMintedNfts();

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        operatorAmount + delegationAmount
      );

      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(0n)
      ).to.equal(0n);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(1n)
      ).to.equal(0n);

      // Since there are no stuck rewards, the event should not be emitted
      expect(await meldStakingConfig.updateStuckRewards()).not.to.emit(
        meldStakingConfig,
        "StuckRewardsUpdated"
      );

      const epochSize = await meldStakingStorage.getEpochSize();
      // Advance 2 epochs so operator is entitled to rewards
      time.increase(2n * epochSize);

      // Delegator withdraws stake

      await meldStakingDelegator.connect(delegator).withdraw(delegatorNFT);

      // Advance 10 days

      await time.increase(10 * 24 * 60 * 60);

      const fee = await meldStakingStorage.getNodeDelegatorFee(nodeId);
      const feeAmount = (delegationAmount * fee) / PERCENTAGE_SCALING;

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(operatorAmount);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(2n)
      ).to.equal(delegationAmount - feeAmount);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(3n)
      ).to.equal(0n);

      // Rewards are set for the epoch after the operator left the node
      const rewardsAmount = toMeldDecimals(10_000);
      await transferAndApproveTokens(
        meldToken,
        deployer,
        rewardsSetter,
        await meldStakingNFT.getAddress(),
        rewardsAmount
      );

      const setRewardsEpoch = 2n;

      await meldStakingConfig
        .connect(rewardsSetter)
        .setRewards(rewardsAmount, setRewardsEpoch);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        rewardsAmount + operatorAmount
      );

      await meldStakingConfig.updateStuckRewards();

      await meldStakingCommon
        .connect(operator)
        .updateUnclaimedRewards(operatorNFT);

      const operatorUnclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        operatorUnclaimedRewards + operatorAmount
      );

      const balanceBefore = await meldToken.balanceOf(deployer.address);
      await meldStakingNFT.rescueMeldTokens(deployer.address);
      const balanceAfter = await meldToken.balanceOf(deployer.address);

      expect(balanceAfter).to.equal(
        balanceBefore + (rewardsAmount - operatorUnclaimedRewards)
      );
    });
    it("Should update the stuck rewards with one operator and one delegator. Both leave", async function () {
      const {
        deployer,
        operator,
        delegator,
        nodeId,
        rewardsSetter,
        operatorAmount,
        meldToken,
        meldStakingConfig,
        meldStakingOperator,
        meldStakingDelegator,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(rewardsStuckFixture);
      const operatorNFT = await meldStakingNFT.getTotalMintedNfts();

      // Delegator stakes

      const delegationAmount = toMeldDecimals(50_000);

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator,
        delegationAmount,
        nodeId,
        0
      );

      const delegatorNFT = await meldStakingNFT.getTotalMintedNfts();

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        operatorAmount + delegationAmount
      );

      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(0n)
      ).to.equal(0n);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(1n)
      ).to.equal(0n);

      // Since there are no stuck rewards, the event should not be emitted
      expect(await meldStakingConfig.updateStuckRewards()).not.to.emit(
        meldStakingConfig,
        "StuckRewardsUpdated"
      );

      const epochSize = await meldStakingStorage.getEpochSize();
      // Advance 2 epochs so operator is entitled to rewards
      time.increase(2n * epochSize);

      // Delegator withdraws stake

      await meldStakingDelegator.connect(delegator).withdraw(delegatorNFT);

      // Operator leaves node

      await meldStakingOperator.connect(operator).leaveNode(operatorNFT);

      // Advance 10 days

      await time.increase(10 * 24 * 60 * 60);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(0n);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(2n)
      ).to.equal(delegationAmount + operatorAmount);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(3n)
      ).to.equal(0n);

      // Rewards are set for the epoch after the operator left the node
      const rewardsAmount = toMeldDecimals(10_000);
      await transferAndApproveTokens(
        meldToken,
        deployer,
        rewardsSetter,
        await meldStakingNFT.getAddress(),
        rewardsAmount
      );

      const setRewardsEpoch = 2n;

      await meldStakingConfig
        .connect(rewardsSetter)
        .setRewards(rewardsAmount, setRewardsEpoch);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(rewardsAmount);

      await meldStakingConfig.updateStuckRewards();

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(0n);

      const balanceBefore = await meldToken.balanceOf(deployer.address);
      await meldStakingNFT.rescueMeldTokens(deployer.address);
      const balanceAfter = await meldToken.balanceOf(deployer.address);

      expect(balanceAfter).to.equal(balanceBefore + rewardsAmount);
    });
    it("Should update the stuck rewards with one operator and two delegators. Both delegators leave", async function () {
      const {
        deployer,
        operator,
        delegator,
        delegator2,
        nodeId,
        rewardsSetter,
        operatorAmount,
        meldToken,
        meldStakingConfig,
        meldStakingCommon,
        meldStakingDelegator,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(rewardsStuckFixture);
      const operatorNFT = await meldStakingNFT.getTotalMintedNfts();

      // Delegator stakes

      const delegationAmount = toMeldDecimals(50_000);

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator,
        delegationAmount,
        nodeId,
        0
      );
      const delegatorNFT1 = await meldStakingNFT.getTotalMintedNfts();

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator2,
        delegationAmount * 2n,
        nodeId,
        0
      );

      const delegatorNFT2 = await meldStakingNFT.getTotalMintedNfts();

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        operatorAmount + 3n * delegationAmount
      );

      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(0n)
      ).to.equal(0n);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(1n)
      ).to.equal(0n);

      const fee = await meldStakingStorage.getNodeDelegatorFee(nodeId);

      const feeAmount1 = (delegationAmount * fee) / PERCENTAGE_SCALING;

      const feeAmount2 = (delegationAmount * 2n * fee) / PERCENTAGE_SCALING;

      const totalFeeAmount = feeAmount1 + feeAmount2;

      // Since there are no stuck rewards, the event should not be emitted
      expect(await meldStakingConfig.updateStuckRewards()).not.to.emit(
        meldStakingConfig,
        "StuckRewardsUpdated"
      );

      const epochSize = await meldStakingStorage.getEpochSize();
      // Advance 2 epochs so operator is entitled to rewards
      time.increase(2n * epochSize);

      // Delegator withdraws stake

      await meldStakingDelegator.connect(delegator).withdraw(delegatorNFT1);
      await meldStakingDelegator.connect(delegator2).withdraw(delegatorNFT2);

      // Advance 10 days

      await time.increase(10 * 24 * 60 * 60);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(operatorAmount);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(2n)
      ).to.equal(3n * delegationAmount - totalFeeAmount);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(3n)
      ).to.equal(0n);

      // Rewards are set for the epoch after the operator left the node
      const rewardsAmount = toMeldDecimals(10_000);
      await transferAndApproveTokens(
        meldToken,
        deployer,
        rewardsSetter,
        await meldStakingNFT.getAddress(),
        rewardsAmount
      );

      const setRewardsEpoch = 2n;

      await meldStakingConfig
        .connect(rewardsSetter)
        .setRewards(rewardsAmount, setRewardsEpoch);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        rewardsAmount + operatorAmount
      );

      await meldStakingConfig.updateStuckRewards();

      await meldStakingCommon
        .connect(operator)
        .updateUnclaimedRewards(operatorNFT);

      const operatorUnclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        operatorUnclaimedRewards + operatorAmount + 1n // 1n is the rounding error
      );

      const balanceBefore = await meldToken.balanceOf(deployer.address);

      await meldStakingNFT.rescueMeldTokens(deployer.address);

      const balanceAfter = await meldToken.balanceOf(deployer.address);

      expect(balanceAfter).to.equal(
        balanceBefore + (rewardsAmount - operatorUnclaimedRewards) - 1n // 1n is the rounding error
      );
    });
    it("Should update the stuck rewards with one operator and a delegator with a locked position that leaves", async function () {
      const {
        deployer,
        operator,
        delegator,
        nodeId,
        rewardsSetter,
        operatorAmount,
        meldToken,
        meldStakingConfig,
        meldStakingCommon,
        meldStakingDelegator,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(rewardsStuckFixture);
      const operatorNFT = await meldStakingNFT.getTotalMintedNfts();

      // Create lock tier

      const minStakingAmount = 0;
      const stakingLength = 1; // 1 epochs
      const weight = 120_00n; // 120%

      await meldStakingConfig.addStakingLockTier(
        minStakingAmount,
        stakingLength,
        weight
      );

      const lockTierId = await meldStakingStorage.lastLockStakingTierId();

      // Delegator stakes

      const delegationAmount = toMeldDecimals(50_000);

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator,
        delegationAmount,
        nodeId,
        lockTierId
      );

      const delegatorNFT = await meldStakingNFT.getTotalMintedNfts();

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        operatorAmount + delegationAmount
      );

      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(0n)
      ).to.equal(0n);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(1n)
      ).to.equal(0n);

      // Since there are no stuck rewards, the event should not be emitted
      expect(await meldStakingConfig.updateStuckRewards()).not.to.emit(
        meldStakingConfig,
        "StuckRewardsUpdated"
      );

      const epochSize = await meldStakingStorage.getEpochSize();
      // Advance 2 epochs so operator is entitled to rewards
      time.increase(2n * epochSize);

      // Delegator withdraws stake

      await meldStakingDelegator.connect(delegator).withdraw(delegatorNFT);

      // Advance 10 days

      await time.increase(10 * 24 * 60 * 60);

      const fee = await meldStakingStorage.getNodeDelegatorFee(nodeId);
      const feeAmount = (delegationAmount * fee) / PERCENTAGE_SCALING;

      const calculatedDelegationAmount =
        (delegationAmount * weight) / PERCENTAGE_SCALING - feeAmount;

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(operatorAmount);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(2n)
      ).to.equal(calculatedDelegationAmount);
      expect(
        await meldStakingStorage.getStuckRewardSharesPerEpoch(3n)
      ).to.equal(0n);

      // Rewards are set for the epoch after the operator left the node
      const rewardsAmount = toMeldDecimals(10_000);
      await transferAndApproveTokens(
        meldToken,
        deployer,
        rewardsSetter,
        await meldStakingNFT.getAddress(),
        rewardsAmount
      );

      const setRewardsEpoch = 2n;

      await meldStakingConfig
        .connect(rewardsSetter)
        .setRewards(rewardsAmount, setRewardsEpoch);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        rewardsAmount + operatorAmount
      );

      await meldStakingConfig.updateStuckRewards();

      await meldStakingCommon
        .connect(operator)
        .updateUnclaimedRewards(operatorNFT);

      const operatorUnclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT);

      expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
        operatorUnclaimedRewards + operatorAmount + 1n // 1n is the rounding error
      );

      const balanceBefore = await meldToken.balanceOf(deployer.address);
      await meldStakingNFT.rescueMeldTokens(deployer.address);
      const balanceAfter = await meldToken.balanceOf(deployer.address);

      expect(balanceAfter).to.equal(
        balanceBefore + (rewardsAmount - operatorUnclaimedRewards) - 1n // 1n is the rounding error
      );
    });
  }); // End of Stuck Rewards Happy flow test cases
});
