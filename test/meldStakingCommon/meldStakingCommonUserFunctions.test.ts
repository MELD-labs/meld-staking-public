import { ethers } from "hardhat";
import { Signer } from "ethers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import {
  deployAndConfigContracts,
  toMeldDecimals,
  getStakerStakingDataForEpochs,
  getNodeStakingDataForEpochs,
  getGlobalStakingDataForEpochs,
  transferAndApproveTokens,
  requestNode,
  delegateToNode,
} from "../utils/utils";
import {
  calculateDelegationFeeAmount,
  calculateExcessWeightedStake,
  calculateWeightedAmount,
  calculateRewards,
} from "../utils/calculations";
import { Errors } from "../utils/errors";

describe("MeldStakingCommon - User Functions", function () {
  async function deployAndConfigContractsFixture() {
    const [
      deployer,
      rando,
      trustedForwarderSetter,
      rewardsSetter,
      slashReceiver,
      trustedForwarder,
      delegator,
      delegator2,
      operator,
      operator2,
      meldStakingImpersonator,
    ] = await ethers.getSigners();

    const initTimestamp = (await time.latest()) + 1000;
    const epochSize = 5 * 24 * 60 * 60; // 5 days

    const contracts = await deployAndConfigContracts(
      deployer.address,
      initTimestamp,
      epochSize,
      slashReceiver.address
    );

    // Grant TRUSTED_FORWARDER_SETTER_ROLE to trustedForwarderSetter
    await contracts.meldStakingCommon.grantRole(
      await contracts.meldStakingCommon.TRUSTED_FORWARDER_SETTER_ROLE(),
      trustedForwarderSetter.address
    );

    // Grant REWARDS_SETTER_ROLE to rewardsSetter
    await contracts.meldStakingConfig.grantRole(
      await contracts.meldStakingConfig.REWARDS_SETTER_ROLE(),
      rewardsSetter.address
    );

    // Add a staking tier one. Requires 10,000 MELD for 10 epochs and get 120% weight. tierOneId is 1
    let minStakingAmount = toMeldDecimals(10_000);
    let stakingLength = 10; // 10 epochs
    let weight = 120_00n; // 120%

    await expect(
      contracts.meldStakingConfig.addStakingLockTier(
        minStakingAmount,
        stakingLength,
        weight
      )
    )
      .to.emit(contracts.meldStakingConfig, "StakingLockTierAdded")
      .withArgs(deployer.address, 1n, minStakingAmount, stakingLength, weight);

    const tierOneId = 1n;

    // Add a staking tier two. Requires 50,000 MELD for 10 epochs and get 175% weight. tierTwoId is 2
    minStakingAmount = toMeldDecimals(50_000);
    stakingLength = 10; // 10 epochs
    weight = 175_00n; // 175%

    await expect(
      contracts.meldStakingConfig.addStakingLockTier(
        minStakingAmount,
        stakingLength,
        weight
      )
    )
      .to.emit(contracts.meldStakingConfig, "StakingLockTierAdded")
      .withArgs(deployer.address, 2n, minStakingAmount, stakingLength, weight);

    const tierTwoId = 2n;

    return {
      deployer,
      rando,
      trustedForwarderSetter,
      rewardsSetter,
      trustedForwarder,
      delegator,
      delegator2,
      operator,
      operator2,
      meldStakingImpersonator,
      initTimestamp,
      epochSize,
      tierOneId,
      tierTwoId,
      ...contracts,
    };
  }

  async function deployAndConfigContractsDelayedStakingStartFixture() {
    const [
      deployer,
      rando,
      trustedForwarderSetter,
      rewardsSetter,
      slashReceiver,
      trustedForwarder,
      delegator,
      delegator2,
      operator,
      operator2,
      meldStakingImpersonator,
    ] = await ethers.getSigners();

    const epochSize = 5 * 24 * 60 * 60; // 5 days
    const initTimestamp = (await time.latest()) + epochSize;

    const contracts = await deployAndConfigContracts(
      deployer.address,
      initTimestamp,
      epochSize,
      slashReceiver.address
    );

    // Grant TRUSTED_FORWARDER_SETTER_ROLE to trustedForwarderSetter
    await contracts.meldStakingCommon.grantRole(
      await contracts.meldStakingCommon.TRUSTED_FORWARDER_SETTER_ROLE(),
      trustedForwarderSetter.address
    );

    // Grant REWARDS_SETTER_ROLE to rewardsSetter
    await contracts.meldStakingConfig.grantRole(
      await contracts.meldStakingConfig.REWARDS_SETTER_ROLE(),
      rewardsSetter.address
    );

    // Add a staking tier one. Requires 10,000 MELD for 10 epochs and get 120% weight. tierOneId is 1
    let minStakingAmount = toMeldDecimals(10_000);
    let stakingLength = 10; // 10 epochs
    let weight = 120_00n; // 120%

    await expect(
      contracts.meldStakingConfig.addStakingLockTier(
        minStakingAmount,
        stakingLength,
        weight
      )
    )
      .to.emit(contracts.meldStakingConfig, "StakingLockTierAdded")
      .withArgs(deployer.address, 1n, minStakingAmount, stakingLength, weight);

    const tierOneId = 1n;

    // Add a staking tier two. Requires 50,000 MELD for 10 epochs and get 175% weight. tierTwoId is 2
    minStakingAmount = toMeldDecimals(50_000);
    stakingLength = 10; // 10 epochs
    weight = 175_00n; // 175%

    await expect(
      contracts.meldStakingConfig.addStakingLockTier(
        minStakingAmount,
        stakingLength,
        weight
      )
    )
      .to.emit(contracts.meldStakingConfig, "StakingLockTierAdded")
      .withArgs(deployer.address, 2n, minStakingAmount, stakingLength, weight);

    const tierTwoId = 2n;

    return {
      deployer,
      rando,
      trustedForwarderSetter,
      rewardsSetter,
      trustedForwarder,
      delegator,
      delegator2,
      operator,
      operator2,
      meldStakingImpersonator,
      initTimestamp,
      epochSize,
      tierOneId,
      tierTwoId,
      ...contracts,
    };
  }

  async function stakingStartedFixture() {
    const deployAndConfigContractsFixtureVars =
      await deployAndConfigContractsFixture();
    await time.increaseTo(
      deployAndConfigContractsFixtureVars.initTimestamp + 1
    );
    return deployAndConfigContractsFixtureVars;
  }

  // Deploy the contracts, initialize them, start staking and request and approve a node
  async function nodeStakedFixture() {
    const stakingStartedFixtureVars = await stakingStartedFixture();
    const { deployer, operator, ...contracts } = stakingStartedFixtureVars;

    // Params for the node request
    const nodeName = "testNode";
    const delegatorFee = 10_00; // 10%
    const amount = toMeldDecimals(100_000);
    const liquidStakingTierId = 0n;
    const metadata = "";

    // operator approves the NFT staking contract to be able to deposit the stake and requests node
    await requestNode(
      contracts.meldToken,
      contracts.meldStakingOperator,
      contracts.meldStakingNFT,
      deployer,
      operator,
      nodeName,
      delegatorFee,
      amount,
      liquidStakingTierId,
      metadata
    );

    // Node id is the hash of the node name
    const nodeId = await contracts.meldStakingOperator.hashNodeId(nodeName);
    await contracts.meldStakingConfig
      .connect(deployer)
      .approveNodeRequest(nodeId);

    const operatorTokenId = await contracts.meldStakingNFT.getTotalMintedNfts();

    return {
      ...stakingStartedFixtureVars,
      nodeId,
      liquidStakingTierId,
      operatorTokenId,
    };
  }

  async function delegatorStakedFixture() {
    const nodeStakedFixtureVars = await nodeStakedFixture();
    const { deployer, delegator, nodeId, liquidStakingTierId, ...contracts } =
      nodeStakedFixtureVars;

    // Params for the delegator stake
    const delegatorBaseStakeAmount = toMeldDecimals(100);

    // Delegator stakes node
    await delegateToNode(
      contracts.meldToken,
      contracts.meldStakingDelegator,
      contracts.meldStakingNFT,
      deployer,
      delegator,
      delegatorBaseStakeAmount,
      nodeId,
      liquidStakingTierId
    );

    const delegatorTokenId =
      await contracts.meldStakingNFT.getTotalMintedNfts();

    const delegatorStartStakeEpoch =
      await contracts.meldStakingStorage.getCurrentEpoch();

    return {
      ...nodeStakedFixtureVars,
      delegatorTokenId,
      delegatorStartStakeEpoch,
      delegatorBaseStakeAmount,
    };
  }

  async function nodeLockStakedFixture() {
    const stakingStartedFixtureVars = await stakingStartedFixture();
    const {
      deployer,
      operator,
      operator2,
      tierOneId,
      tierTwoId,
      ...contracts
    } = stakingStartedFixtureVars;

    // Operator creates a node

    // Params for the node request
    const nodeName = "testNode";
    const delegatorFee = 10_00; // 10%
    const operatorBaseLockedStakeAmount = toMeldDecimals(100_000);
    const metadata = "";

    // operator approves the NFT staking contract to be able to deposit the stake and requests node
    await requestNode(
      contracts.meldToken,
      contracts.meldStakingOperator,
      contracts.meldStakingNFT,
      deployer,
      operator,
      nodeName,
      delegatorFee,
      operatorBaseLockedStakeAmount,
      tierTwoId,
      metadata
    );

    // Node id is the hash of the node name
    const nodeId = await contracts.meldStakingOperator.hashNodeId(nodeName);
    await contracts.meldStakingConfig
      .connect(deployer)
      .approveNodeRequest(nodeId);

    const operatorTokenId = await contracts.meldStakingNFT.getTotalMintedNfts();

    // Operator2 creates a new node

    // Params for the node request
    const nodeName2 = "testNode2";
    const delegatorFee2 = 5_00; // 50%
    const operator2BaseLockedStakeAmount = toMeldDecimals(200_000);
    const metadata2 = "";

    // operator 2 approves the NFT staking contract to be able to deposit the stake and requests node
    await requestNode(
      contracts.meldToken,
      contracts.meldStakingOperator,
      contracts.meldStakingNFT,
      deployer,
      operator2,
      nodeName2,
      delegatorFee2,
      operator2BaseLockedStakeAmount,
      tierOneId,
      metadata2
    );

    // Node id is the hash of the node name
    const node2Id = await contracts.meldStakingOperator.hashNodeId(nodeName2);
    await contracts.meldStakingConfig
      .connect(deployer)
      .approveNodeRequest(node2Id);

    const operator2TokenId =
      await contracts.meldStakingNFT.getTotalMintedNfts();

    return {
      ...stakingStartedFixtureVars,
      nodeId,
      operatorTokenId,
      operatorBaseLockedStakeAmount,
      node2Id,
      operator2TokenId,
      operator2BaseLockedStakeAmount,
    };
  }

  async function delegatorLockStakedFixture() {
    const nodeStakedFixtureVars = await nodeLockStakedFixture();
    const {
      deployer,
      delegator,
      node2Id,
      nodeId,
      tierOneId,
      tierTwoId,
      ...contracts
    } = nodeStakedFixtureVars;

    // Params for the delegator stake 1
    const delegatorBaseLockedStakeAmount = toMeldDecimals(50_000);

    // Delegator approves the NFT staking contract to be able to deposit the stake and stakes node
    await delegateToNode(
      contracts.meldToken,
      contracts.meldStakingDelegator,
      contracts.meldStakingNFT,
      deployer,
      delegator,
      delegatorBaseLockedStakeAmount,
      nodeId,
      tierTwoId
    );

    const delegatorTokenId =
      await contracts.meldStakingNFT.getTotalMintedNfts();

    // Params for the delegator stake 2
    const delegatorBaseLockedStakeAmount2 = toMeldDecimals(15_000);

    // Delegator approves the NFT staking contract to be able to deposit the stake and stakes node
    await delegateToNode(
      contracts.meldToken,
      contracts.meldStakingDelegator,
      contracts.meldStakingNFT,
      deployer,
      delegator,
      delegatorBaseLockedStakeAmount2,
      node2Id,
      tierOneId
    );

    const delegatorToken2Id =
      await contracts.meldStakingNFT.getTotalMintedNfts();

    const delegatorStartLockStakeEpoch =
      await contracts.meldStakingStorage.getCurrentEpoch();

    return {
      ...nodeStakedFixtureVars,
      delegatorTokenId,
      delegatorBaseLockedStakeAmount,
      delegatorToken2Id,
      delegatorStartLockStakeEpoch,
      delegatorBaseLockedStakeAmount2,
    };
  }

  context("User Functions", function () {
    context("updateStakerPreviousEpochs(uint256 _nftId)", function () {
      context("Happy Flow test cases", function () {
        context("Liquid Staking", function () {
          it("Should not update state if delegator updates again in same epoch", async function () {
            const {
              delegator,
              meldStakingCommon,
              meldStakingStorage,
              delegatorTokenId,
              delegatorStartStakeEpoch,
            } = await loadFixture(delegatorStakedFixture);

            //This epoch is same as original staking epoch
            const delegatorlastStakedAmountPerEpochBefore =
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorTokenId,
                delegatorStartStakeEpoch
              );

            const delegatorMinStakedAmountPerEpochBefore =
              await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
                delegatorTokenId,
                delegatorStartStakeEpoch
              );

            const delegatorLastUpdatedEpochBefore =
              await meldStakingStorage.getStakerLastEpochStakingUpdated(
                delegatorTokenId
              );

            await meldStakingCommon
              .connect(delegator)
              ["updateStakerPreviousEpochs(uint256)"](delegatorTokenId);

            const delegatorlastStakedAmountPerEpochAfter =
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorTokenId,
                delegatorStartStakeEpoch
              );

            const delegatorMinStakedAmountPerEpochAfter =
              await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
                delegatorTokenId,
                delegatorStartStakeEpoch
              );

            const delegatorLastUpdatedEpochAfter =
              await meldStakingStorage.getStakerLastEpochStakingUpdated(
                delegatorTokenId
              );

            // Check state
            expect(delegatorLastUpdatedEpochBefore).to.equal(
              delegatorLastUpdatedEpochAfter
            );
            expect(delegatorlastStakedAmountPerEpochBefore).to.equal(
              delegatorlastStakedAmountPerEpochAfter
            );
            expect(delegatorMinStakedAmountPerEpochBefore).to.equal(
              delegatorMinStakedAmountPerEpochAfter
            );
          });

          it("Should correctly make minimal state changes if delegator updates after several epochs but no actions occur to change state", async function () {
            const {
              delegator,
              meldStakingCommon,
              meldStakingStorage,
              delegatorTokenId,
            } = await loadFixture(delegatorStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 10 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 10n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Call the updateStakerPreviousEpochs function to update delegator state
            await meldStakingCommon
              .connect(delegator)
              ["updateStakerPreviousEpochs(uint256)"](delegatorTokenId);

            // Call the getStakerStakingDataForEpochs function
            const { stakingData, lastEpochUpdated } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                delegatorTokenId,
                startEpoch,
                untilEpoch,
                true //isDelegator
              );

            // Check that the data hasn't changed throughout the epochs
            // The minStakedAmount doesn't get updated until the second epoch that is updated
            expect(stakingData[1].operator?.baseStakedAmount).to.equal(
              stakingData[0].operator?.baseStakedAmount
            ); // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(stakingData[0].delegator?.lastStakedAmount).to.equal(
              stakingData[stakingData.length - 1].delegator?.lastStakedAmount
            );
            expect(stakingData[0].delegator?.minStakedAmount).to.equal(0n);
            expect(stakingData[1].delegator?.minStakedAmount).to.equal(
              stakingData[stakingData.length - 1].delegator?.minStakedAmount
            );
            expect(lastEpochUpdated).to.equal(untilEpoch);
          });

          it("Should update operator state correctly when updating 1 epoch later after an action (new delegator stake)", async function () {
            const {
              deployer,
              delegator,
              operator,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingDelegator,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
              nodeId,
              liquidStakingTierId,
            } = await loadFixture(delegatorStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 1 epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 1n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            const delegatorBaseStakeAmount2 = toMeldDecimals(2000);

            // Delegator stakes node
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              delegatorBaseStakeAmount2,
              nodeId,
              liquidStakingTierId
            );

            // Call the updateStakerPreviousEpochs function to update operator state
            await meldStakingCommon
              .connect(operator)
              ["updateStakerPreviousEpochs(uint256)"](operatorTokenId);

            // Call the getStakerStakingDataForEpochs function
            const { stakingData: stakingDataAfter, lastEpochUpdated } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operatorTokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

            // Check state
            const expectedDelegationFee = await calculateDelegationFeeAmount(
              meldStakingStorage,
              nodeId,
              delegatorBaseStakeAmount2
            );

            const expectedLastStakedAmount =
              stakingDataAfter[0].operator!.lastStakedAmount +
              expectedDelegationFee;

            // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(stakingDataAfter[1].operator?.baseStakedAmount).to.equal(
              stakingDataAfter[0].operator?.baseStakedAmount
            );
            expect(stakingDataAfter[1].operator?.lastStakedAmount).to.equal(
              expectedLastStakedAmount
            );
            expect(stakingDataAfter[1].operator?.minStakedAmount).to.equal(
              stakingDataAfter[0].operator?.lastStakedAmount
            );
            expect(lastEpochUpdated).to.equal(untilEpoch);
          });

          it("Should update operator state correctly when updating 100 epochs later after an action (new delegator stake)", async function () {
            const {
              deployer,
              delegator,
              operator,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingDelegator,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
              nodeId,
              liquidStakingTierId,
            } = await loadFixture(delegatorStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 50 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 50n)
            );
            const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

            const delegatorBaseStakeAmount2 = toMeldDecimals(5000);

            // Delegator stakes node
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              delegatorBaseStakeAmount2,
              nodeId,
              liquidStakingTierId
            );

            // Advance time by another 50 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(newCurrentEpoch + 50n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Call the updateStakerPreviousEpochs function to update operator state
            await meldStakingCommon
              .connect(operator)
              ["updateStakerPreviousEpochs(uint256)"](operatorTokenId);

            // Call the getStakerStakingDataForEpochs function
            const { stakingData: stakingDataAfter, lastEpochUpdated } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operatorTokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

            // Check state
            const expectedDelegationFee = await calculateDelegationFeeAmount(
              meldStakingStorage,
              nodeId,
              delegatorBaseStakeAmount2
            );

            // Delegator staked again in epoch 50 (index 49), so the lastStakedAmount should be updated for epoch 51 (index 50)
            const expectedLastStakedAmount =
              stakingDataAfter[49].operator!.lastStakedAmount +
              expectedDelegationFee;

            // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.baseStakedAmount
            ).to.equal(stakingDataAfter[0].operator?.baseStakedAmount);
            expect(stakingDataAfter[50].operator?.lastStakedAmount).to.equal(
              expectedLastStakedAmount
            );
            expect(stakingDataAfter[51].operator?.minStakedAmount).to.equal(
              stakingDataAfter[50].operator?.lastStakedAmount
            );
            expect(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.minStakedAmount
            ).to.equal(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.lastStakedAmount
            );
            expect(lastEpochUpdated).to.equal(untilEpoch);
          });

          it("Should update state correctly when last active epoch was in the past", async function () {
            const {
              operator,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              nodeId,
              operatorTokenId,
            } = await loadFixture(nodeStakedFixture);
            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 20 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 20n)
            );

            const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Admin slashes node. LastActive epoch is 21
            await meldStakingConfig.slashNode(nodeId, 100_00n);

            // Increase time another 10 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(newCurrentEpoch + 10n)
            );

            // Operator calls updateStakerPreviousEpochs
            await meldStakingCommon
              .connect(operator)
              ["updateStakerPreviousEpochs(uint256)"](operatorTokenId);

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Call the getStakerStakingDataForEpochs function
            const { stakingData: stakingDataAfter, lastEpochUpdated } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operatorTokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

            // Check state
            expect(lastEpochUpdated).to.equal(newCurrentEpoch);
            // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.baseStakedAmount
            ).to.equal(stakingDataAfter[0].operator?.baseStakedAmount);
            expect(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.lastStakedAmount
            ).to.equal(0n);
            expect(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.minStakedAmount
            ).to.equal(0n);
          });

          it("Should update the state for the correct operator", async function () {
            const {
              deployer,
              delegator,
              operator2,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingDelegator,
              meldStakingOperator,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
              liquidStakingTierId,
            } = await loadFixture(delegatorStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Operator2 creates a new node

            // Params for the node request
            const nodeName = "testNode2";
            const delegatorFee = 5_00; // 50%
            const amount = toMeldDecimals(200_000);
            const metadata = "";

            // Operator 2 approves the NFT staking contract to be able to deposit the stake and requests node
            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator2,
              nodeName,
              delegatorFee,
              amount,
              liquidStakingTierId,
              metadata
            );

            // Node id is the hash of the node name
            const node2Id = await meldStakingOperator.hashNodeId(nodeName);
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(node2Id);

            const operator2TokenId = await meldStakingNFT.getTotalMintedNfts();

            // Advance time by 1 epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 1n)
            );
            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            const delegatorBaseStakeAmount2 = toMeldDecimals(2000);

            const { stakingData: stakingDataOperatorBefore } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operatorTokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

            // Delegator stakes operator2's node in epoch 2. This action should NOT change operator's staking data
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              delegatorBaseStakeAmount2,
              node2Id,
              liquidStakingTierId
            );

            // Operator2 Calls the updateStakerPreviousEpochs function to update own state
            await meldStakingCommon
              .connect(operator2)
              ["updateStakerPreviousEpochs(uint256)"](operator2TokenId);

            // Operator data should NOT have been updated
            const {
              stakingData: stakingDataOperatorAfter,
              lastEpochUpdated: lastEpochUpdatedOperator,
            } = await getStakerStakingDataForEpochs(
              meldStakingStorage,
              operatorTokenId,
              startEpoch,
              untilEpoch,
              false //!isDelegator
            );

            // Call the getStakerStakingDataForEpochs function
            const {
              stakingData: stakingDataOperator2After,
              lastEpochUpdated: lastEpochUpdatedOperator2,
            } = await getStakerStakingDataForEpochs(
              meldStakingStorage,
              operator2TokenId,
              startEpoch,
              untilEpoch,
              false //!isDelegator
            );

            // Check state
            expect(stakingDataOperatorBefore).to.deep.equal(
              stakingDataOperatorAfter
            );
            expect(lastEpochUpdatedOperator).to.equal(startEpoch);

            const expectedDelegationFee = await calculateDelegationFeeAmount(
              meldStakingStorage,
              node2Id,
              delegatorBaseStakeAmount2
            );
            const expectedLastStakedAmount =
              stakingDataOperator2After[0].operator!.lastStakedAmount +
              expectedDelegationFee;

            // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(
              stakingDataOperator2After[1].operator?.baseStakedAmount
            ).to.equal(stakingDataOperator2After[0].operator?.baseStakedAmount);
            expect(
              stakingDataOperator2After[1].operator?.lastStakedAmount
            ).to.equal(expectedLastStakedAmount);
            expect(
              stakingDataOperator2After[1].operator?.minStakedAmount
            ).to.equal(stakingDataOperator2After[0].operator?.lastStakedAmount);
            expect(lastEpochUpdatedOperator2).to.equal(untilEpoch);
          });

          it("Should update state correctly when anyone calls the function", async function () {
            const {
              rando,
              meldStakingCommon,
              meldStakingStorage,
              delegatorTokenId,
            } = await loadFixture(delegatorStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 10 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 10n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Random address makes the call to the updateStakerPreviousEpochs function to update delegator state
            await meldStakingCommon
              .connect(rando)
              ["updateStakerPreviousEpochs(uint256)"](delegatorTokenId);

            // Call the getStakerStakingDataForEpochs function
            const { stakingData, lastEpochUpdated } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                delegatorTokenId,
                startEpoch,
                untilEpoch,
                true //isDelegator
              );

            // Check that the data hasn't changed throughout the epochs
            // The minStakedAmount doesn't get updated until the second epoch that is updated
            expect(stakingData[1].operator?.baseStakedAmount).to.equal(
              stakingData[0].operator?.baseStakedAmount
            ); // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(stakingData[0].delegator?.lastStakedAmount).to.equal(
              stakingData[stakingData.length - 1].delegator?.lastStakedAmount
            );
            expect(stakingData[0].delegator?.minStakedAmount).to.equal(0n);
            expect(stakingData[1].delegator?.minStakedAmount).to.equal(
              stakingData[stakingData.length - 1].delegator?.minStakedAmount
            );
            expect(lastEpochUpdated).to.equal(untilEpoch);
          });
        }); // End of Liquid Staking

        context("Locked Staking", function () {
          it("Should not update state if delegator updates again in same epoch", async function () {
            const {
              delegator,
              meldStakingCommon,
              meldStakingStorage,
              delegatorToken2Id,
              delegatorStartLockStakeEpoch,
            } = await loadFixture(delegatorLockStakedFixture);

            //This epoch is same as original staking epoch
            const delegatorlastStakedAmountPerEpochBefore =
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorToken2Id,
                delegatorStartLockStakeEpoch
              );

            const delegatorMinStakedAmountPerEpochBefore =
              await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
                delegatorToken2Id,
                delegatorStartLockStakeEpoch
              );

            const delegatorLastUpdatedEpochBefore =
              await meldStakingStorage.getStakerLastEpochStakingUpdated(
                delegatorToken2Id
              );

            await meldStakingCommon
              .connect(delegator)
              ["updateStakerPreviousEpochs(uint256)"](delegatorToken2Id);

            const delegatorlastStakedAmountPerEpochAfter =
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorToken2Id,
                delegatorStartLockStakeEpoch
              );

            const delegatorMinStakedAmountPerEpochAfter =
              await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
                delegatorToken2Id,
                delegatorStartLockStakeEpoch
              );

            const delegatorLastUpdatedEpochAfter =
              await meldStakingStorage.getStakerLastEpochStakingUpdated(
                delegatorToken2Id
              );

            // Check state
            expect(delegatorLastUpdatedEpochBefore).to.equal(
              delegatorLastUpdatedEpochAfter
            );
            expect(delegatorlastStakedAmountPerEpochBefore).to.equal(
              delegatorlastStakedAmountPerEpochAfter
            );
            expect(delegatorMinStakedAmountPerEpochBefore).to.equal(
              delegatorMinStakedAmountPerEpochAfter
            );
          });

          it("Should correctly make minimal state changes if delegator updates after several epochs but no actions occur to change state", async function () {
            const {
              delegator,
              meldStakingCommon,
              meldStakingStorage,
              delegatorToken2Id,
            } = await loadFixture(delegatorLockStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 10 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 10n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Call the updateStakerPreviousEpochs function to update delegator state
            await meldStakingCommon
              .connect(delegator)
              ["updateStakerPreviousEpochs(uint256)"](delegatorToken2Id);

            // Call the getStakerStakingDataForEpochs function
            const { stakingData, lastEpochUpdated } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                delegatorToken2Id,
                startEpoch,
                untilEpoch,
                true //isDelegator
              );

            // Check that the data hasn't changed throughout the epochs
            // The minStakedAmount doesn't get updated until the second epoch that is updated
            expect(stakingData[1].operator?.baseStakedAmount).to.equal(
              stakingData[0].operator?.baseStakedAmount
            ); // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(stakingData[0].delegator?.lastStakedAmount).to.equal(
              stakingData[stakingData.length - 1].delegator?.lastStakedAmount
            );
            expect(stakingData[0].delegator?.minStakedAmount).to.equal(0n);
            expect(stakingData[1].delegator?.minStakedAmount).to.equal(
              stakingData[stakingData.length - 1].delegator?.minStakedAmount
            );
            expect(lastEpochUpdated).to.equal(untilEpoch);
          });

          it("Should update operator state correctly when updating 1 epoch later after an action (new delegator stake)", async function () {
            const {
              deployer,
              delegator,
              operator2,
              meldStakingDelegator,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
              node2Id,
              tierOneId,
              operator2TokenId,
            } = await loadFixture(delegatorLockStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 1 epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 1n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            const delegatorBaseStakeAmount2 = toMeldDecimals(10_000);

            // New staking position on same node will change operator's staking data
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              delegatorBaseStakeAmount2,
              node2Id,
              tierOneId
            );

            // Call the updateStakerPreviousEpochs function to update operator state
            await meldStakingCommon
              .connect(operator2)
              ["updateStakerPreviousEpochs(uint256)"](operator2TokenId);

            // Call the getStakerStakingDataForEpochs function
            const { stakingData: stakingDataAfter, lastEpochUpdated } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operator2TokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

            // Check state
            const expectedDelegationFee = await calculateDelegationFeeAmount(
              meldStakingStorage,
              node2Id,
              delegatorBaseStakeAmount2
            );

            const expectedLastStakedAmount =
              stakingDataAfter[0].operator!.lastStakedAmount +
              expectedDelegationFee;

            // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(stakingDataAfter[1].operator?.baseStakedAmount).to.equal(
              stakingDataAfter[0].operator?.baseStakedAmount
            );
            expect(stakingDataAfter[1].operator?.lastStakedAmount).to.equal(
              expectedLastStakedAmount
            );
            expect(stakingDataAfter[1].operator?.minStakedAmount).to.equal(
              stakingDataAfter[0].operator?.lastStakedAmount
            );
            expect(lastEpochUpdated).to.equal(untilEpoch);
          });

          it("Should update operator state correctly when updating 100 epochs later after an action (new delegator stake)", async function () {
            const {
              deployer,
              delegator,
              operator2,
              meldStakingDelegator,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
              node2Id,
              tierOneId,
              operator2TokenId,
            } = await loadFixture(delegatorLockStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 50 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 50n)
            );
            const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

            const delegatorBaseStakeAmount2 = toMeldDecimals(20_000);

            // New staking position on same node will change operator's staking data
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              delegatorBaseStakeAmount2,
              node2Id,
              tierOneId
            );

            // Advance time by 50 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(newCurrentEpoch + 50n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Call the updateStakerPreviousEpochs function to update operator state
            await meldStakingCommon
              .connect(operator2)
              ["updateStakerPreviousEpochs(uint256)"](operator2TokenId);

            // Call the getStakerStakingDataForEpochs function
            const { stakingData: stakingDataAfter, lastEpochUpdated } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operator2TokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

            // Check state
            const expectedDelegationFee = await calculateDelegationFeeAmount(
              meldStakingStorage,
              node2Id,
              delegatorBaseStakeAmount2
            );

            // Delegator staked again in epoch 50 (index 49), so the lastStakedAmount should be updated for epoch 51 (index 50)
            const expectedLastStakedAmount =
              stakingDataAfter[49].operator!.lastStakedAmount +
              expectedDelegationFee;

            // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.baseStakedAmount
            ).to.equal(stakingDataAfter[0].operator?.baseStakedAmount);
            expect(stakingDataAfter[50].operator?.lastStakedAmount).to.equal(
              expectedLastStakedAmount
            );
            expect(stakingDataAfter[51].operator?.minStakedAmount).to.equal(
              stakingDataAfter[50].operator?.lastStakedAmount
            );
            expect(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.minStakedAmount
            ).to.equal(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.lastStakedAmount
            );
            expect(lastEpochUpdated).to.equal(untilEpoch);
          });

          it("Should update state correctly when last active epoch was in the past", async function () {
            const {
              operator2,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              node2Id,
              operator2TokenId,
            } = await loadFixture(nodeLockStakedFixture);
            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 20 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 20n)
            );

            const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Admin slashes node. LastActive epoch is 21
            await meldStakingConfig.slashNode(node2Id, 100_00n);

            // Increase time another 10 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(newCurrentEpoch + 10n)
            );

            // Operator2 calls updateStakerPreviousEpochs
            await meldStakingCommon
              .connect(operator2)
              ["updateStakerPreviousEpochs(uint256)"](operator2TokenId);

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Call the getStakerStakingDataForEpochs function
            const { stakingData: stakingDataAfter, lastEpochUpdated } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operator2TokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

            // Check state
            expect(lastEpochUpdated).to.equal(newCurrentEpoch);
            // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.baseStakedAmount
            ).to.equal(stakingDataAfter[0].operator?.baseStakedAmount);
            expect(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.lastStakedAmount
            ).to.equal(0n);
            expect(
              stakingDataAfter[stakingDataAfter.length - 1].operator
                ?.minStakedAmount
            ).to.equal(0n);
          });

          it("Should update the state for the correct operator", async function () {
            const {
              deployer,
              delegator,
              operator,
              meldStakingDelegator,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
              nodeId,
              tierTwoId,
              operatorTokenId,
              operator2TokenId,
            } = await loadFixture(delegatorLockStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 1 epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 1n)
            );
            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Get operator2 staking data before update
            const { stakingData: stakingDataOperator2Before } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operator2TokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

            const stakeAmount = toMeldDecimals(60_000);

            // Delegator stakes operator's node. This action should NOT change operator2's staking data
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              stakeAmount,
              nodeId,
              tierTwoId
            );

            // Operator Calls the updateStakerPreviousEpochs function to update own state
            await meldStakingCommon
              .connect(operator)
              ["updateStakerPreviousEpochs(uint256)"](operatorTokenId);

            // Operator2 data should NOT have been updated
            const {
              stakingData: stakingDataOperator2After,
              lastEpochUpdated: lastEpochUpdatedOperator2,
            } = await getStakerStakingDataForEpochs(
              meldStakingStorage,
              operator2TokenId,
              startEpoch,
              untilEpoch,
              false //!isDelegator
            );

            // Call the getStakerStakingDataForEpochs function for operator
            const {
              stakingData: stakingDataOperatorAfter,
              lastEpochUpdated: lastEpochUpdatedOperator,
            } = await getStakerStakingDataForEpochs(
              meldStakingStorage,
              operatorTokenId,
              startEpoch,
              untilEpoch,
              false //!isDelegator
            );

            // Check state
            expect(stakingDataOperator2Before).to.deep.equal(
              stakingDataOperator2After
            );
            expect(lastEpochUpdatedOperator2).to.equal(startEpoch);

            const expectedDelegationFee = await calculateDelegationFeeAmount(
              meldStakingStorage,
              nodeId,
              stakeAmount
            );
            const expectedLastStakedAmount =
              stakingDataOperatorAfter[0].operator!.lastStakedAmount +
              expectedDelegationFee;

            // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(
              stakingDataOperatorAfter[1].operator?.baseStakedAmount
            ).to.equal(stakingDataOperatorAfter[0].operator?.baseStakedAmount);
            expect(
              stakingDataOperatorAfter[1].operator?.lastStakedAmount
            ).to.equal(expectedLastStakedAmount);
            expect(
              stakingDataOperatorAfter[1].operator?.minStakedAmount
            ).to.equal(stakingDataOperatorAfter[0].operator?.lastStakedAmount);
            expect(lastEpochUpdatedOperator).to.equal(untilEpoch);
          });

          it("Should update state correctly when anyone calls the function", async function () {
            const {
              rando,
              meldStakingCommon,
              meldStakingStorage,
              delegatorToken2Id,
            } = await loadFixture(delegatorLockStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 10 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 10n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Call the updateStakerPreviousEpochs function to update delegator state
            await meldStakingCommon
              .connect(rando)
              ["updateStakerPreviousEpochs(uint256)"](delegatorToken2Id);

            // Call the getStakerStakingDataForEpochs function
            const { stakingData, lastEpochUpdated } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                delegatorToken2Id,
                startEpoch,
                untilEpoch,
                true //isDelegator
              );

            // Check that the data hasn't changed throughout the epochs
            // The minStakedAmount doesn't get updated until the second epoch that is updated
            expect(stakingData[1].operator?.baseStakedAmount).to.equal(
              stakingData[0].operator?.baseStakedAmount
            ); // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
            expect(stakingData[0].delegator?.lastStakedAmount).to.equal(
              stakingData[stakingData.length - 1].delegator?.lastStakedAmount
            );
            expect(stakingData[0].delegator?.minStakedAmount).to.equal(0n);
            expect(stakingData[1].delegator?.minStakedAmount).to.equal(
              stakingData[stakingData.length - 1].delegator?.minStakedAmount
            );
            expect(lastEpochUpdated).to.equal(untilEpoch);
          });
        }); // End of Locked Staking

        context(
          "Locked Staking Term Expires and Changes to Liquid Staking",
          function () {
            it("Should emit StakerUpgradedToLiquid if locked period ends in current epoch", async function () {
              const {
                delegator,
                meldStakingCommon,
                meldStakingStorage,
                delegatorToken2Id,
              } = await loadFixture(delegatorLockStakedFixture);

              // Delegator has already staked node 2 for 10 epochs
              const startEpoch = await meldStakingStorage.getCurrentEpoch();

              // Advance time by 20 epochs
              await time.increaseTo(
                await meldStakingStorage.getEpochStart(startEpoch + 20n)
              );

              // Delegator Calls the updateStakerPreviousEpochs function to update own state
              await expect(
                meldStakingCommon
                  .connect(delegator)
                  ["updateStakerPreviousEpochs(uint256)"](delegatorToken2Id)
              ).to.emit(meldStakingCommon, "StakerUpgradedToLiquid");
            });

            it("Should emit StakerUpgradedToLiquid if locked period ended in previous epoch", async function () {
              const {
                delegator,
                meldStakingCommon,
                meldStakingStorage,
                delegatorToken2Id,
              } = await loadFixture(delegatorLockStakedFixture);

              // Delegator has already staked node 2 for 10 epochs
              const startEpoch = await meldStakingStorage.getCurrentEpoch();

              // Advance time by 11 epochs
              await time.increaseTo(
                await meldStakingStorage.getEpochStart(startEpoch + 11n)
              );

              // Delegator Calls the updateStakerPreviousEpochs function to update own state
              await expect(
                meldStakingCommon
                  .connect(delegator)
                  ["updateStakerPreviousEpochs(uint256)"](delegatorToken2Id)
              ).to.emit(meldStakingCommon, "StakerUpgradedToLiquid");
            });

            it("Should update state correctly if locked period ends in current epoch", async function () {
              const {
                delegator,
                meldStakingCommon,
                meldStakingStorage,
                node2Id,
                tierOneId,
                tierTwoId,
                delegatorBaseLockedStakeAmount,
                delegatorTokenId,
                delegatorToken2Id,
                delegatorBaseLockedStakeAmount2,
                operator2BaseLockedStakeAmount,
                operatorBaseLockedStakeAmount,
                operator2TokenId,
                operatorTokenId,
              } = await loadFixture(delegatorLockStakedFixture);
              // Delegator and operator have already staked node 2 for 10 epochs, starting in epoch 1. End epoch should be 12 because.
              // The stake tier locks funds for 10 epochs. In epoch 1, the position does not have any impact, since it’s not been locked
              // for the full epoch. Only after epoch 11 is completed is the lock period over.
              // This time is the same as epoch 12 starts, therefore the epoch ends at the beginning of epoch 12.

              const startEpoch = await meldStakingStorage.getCurrentEpoch();

              // Advance time to epoch 12
              await time.increaseTo(
                await meldStakingStorage.getEpochStart(startEpoch + 11n)
              );

              const untilEpoch = await meldStakingStorage.getCurrentEpoch();

              const delegatorPosition1WeightedAmount =
                await calculateWeightedAmount(
                  meldStakingStorage,
                  delegatorBaseLockedStakeAmount,
                  tierTwoId
                );
              const delegatorPosition1ExcessWeightedStake =
                await calculateExcessWeightedStake(
                  meldStakingStorage,
                  delegatorTokenId
                );
              const delegatorPosition2WeightedAmount =
                await calculateWeightedAmount(
                  meldStakingStorage,
                  delegatorBaseLockedStakeAmount2,
                  tierOneId
                );
              const delegatorPosition2ExcessWeightedStake =
                await calculateExcessWeightedStake(
                  meldStakingStorage,
                  delegatorToken2Id
                );
              const operatorWeightedAmount = await calculateWeightedAmount(
                meldStakingStorage,
                operatorBaseLockedStakeAmount,
                tierTwoId
              );
              const operatorExcessWeightedStake =
                await calculateExcessWeightedStake(
                  meldStakingStorage,
                  operatorTokenId
                );
              const operator2WeightedAmount = await calculateWeightedAmount(
                meldStakingStorage,
                operator2BaseLockedStakeAmount,
                tierOneId
              );
              const operator2ExcessWeightedStake =
                await calculateExcessWeightedStake(
                  meldStakingStorage,
                  operator2TokenId
                );
              const delegatorPosition2DelegationFeeAmount =
                await calculateDelegationFeeAmount(
                  meldStakingStorage,
                  node2Id,
                  delegatorBaseLockedStakeAmount2
                );

              // Expected values for delegator position 2 (delegator staked node 2)
              const expectedDelegatorStakedAmount =
                delegatorPosition2WeightedAmount -
                delegatorPosition2DelegationFeeAmount;

              // Expected values for node 2 (node staked by delegator position 2 and operator2)
              const expectedNodeBaseStakedAmount =
                delegatorBaseLockedStakeAmount2 +
                operator2BaseLockedStakeAmount;

              const expectedNodeWeightedAmount =
                delegatorPosition2WeightedAmount + operator2WeightedAmount;

              const expectedNodeExcessWeightedAmount =
                delegatorPosition2ExcessWeightedStake +
                operator2ExcessWeightedStake;

              // Expected global values
              const expectedGlobalBaseStakedAmount =
                expectedNodeBaseStakedAmount +
                operatorBaseLockedStakeAmount +
                delegatorBaseLockedStakeAmount;

              const expectedGlobalWeightedAmount =
                expectedNodeWeightedAmount +
                operatorWeightedAmount +
                delegatorPosition1WeightedAmount;

              const expectedGlobalExcessWeightedAmount =
                expectedNodeExcessWeightedAmount +
                delegatorPosition1ExcessWeightedStake +
                operatorExcessWeightedStake;

              const { nodeStakingData: nodeStakingDataBefore } =
                await getNodeStakingDataForEpochs(
                  meldStakingStorage,
                  node2Id,
                  startEpoch,
                  untilEpoch
                );

              const { globalStakingData: globalStakingDataBefore } =
                await getGlobalStakingDataForEpochs(
                  meldStakingStorage,
                  startEpoch,
                  untilEpoch
                );

              // Delegator Calls the updateStakerPreviousEpochs function to update position 2. This should transition the delegator to liquid staking.
              await meldStakingCommon
                .connect(delegator)
                ["updateStakerPreviousEpochs(uint256)"](delegatorToken2Id);

              const {
                stakingData: delegatorStakingData,
                lastEpochUpdated: lastEpochDelegatorUpdated,
              } = await getStakerStakingDataForEpochs(
                meldStakingStorage,
                delegatorToken2Id,
                startEpoch,
                untilEpoch,
                true //isDelegator
              );

              const {
                nodeStakingData: nodeStakingDataAfter,
                lastEpochNodeUpdated,
              } = await getNodeStakingDataForEpochs(
                meldStakingStorage,
                node2Id,
                startEpoch,
                untilEpoch
              );

              const {
                globalStakingData: globalStakingDataAfter,
                lastEpochGlobalUpdated,
              } = await getGlobalStakingDataForEpochs(
                meldStakingStorage,
                startEpoch,
                untilEpoch
              );

              /** Check delegator data **/

              // Check that data includes weighted amount for first epoch
              expect(
                delegatorStakingData[0].delegator?.baseStakedAmount
              ).to.equal(delegatorBaseLockedStakeAmount2);
              expect(
                delegatorStakingData[0].delegator?.lastStakedAmount
              ).to.equal(expectedDelegatorStakedAmount);
              expect(
                delegatorStakingData[0].delegator?.minStakedAmount
              ).to.equal(0);

              // Check that data includes weighted amount for epoch before transition to liquid
              expect(
                delegatorStakingData[delegatorStakingData.length - 2].delegator
                  ?.baseStakedAmount
              ).to.equal(delegatorBaseLockedStakeAmount2);
              expect(
                delegatorStakingData[delegatorStakingData.length - 2].delegator
                  ?.lastStakedAmount
              ).to.equal(expectedDelegatorStakedAmount);
              expect(
                delegatorStakingData[delegatorStakingData.length - 2].delegator
                  ?.minStakedAmount
              ).to.equal(expectedDelegatorStakedAmount);

              // Check that data changed for epoch 12 (index 11)
              expect(
                delegatorStakingData[11].delegator?.baseStakedAmount
              ).to.equal(delegatorBaseLockedStakeAmount2);
              expect(
                delegatorStakingData[11].delegator?.lastStakedAmount
              ).to.equal(
                delegatorStakingData[11].delegator!.baseStakedAmount -
                  delegatorPosition2DelegationFeeAmount
              );
              expect(
                delegatorStakingData[11].delegator?.minStakedAmount
              ).to.equal(
                delegatorStakingData[11].delegator!.baseStakedAmount -
                  delegatorPosition2DelegationFeeAmount
              );

              // Check that delegator was transitioned to liquid staking
              expect(
                await meldStakingStorage.getStakerLockTierId(delegatorToken2Id)
              ).to.equal(0);
              expect(lastEpochDelegatorUpdated).to.equal(untilEpoch);

              /** Check node data **/

              // Check that node data is correct before update (specifically the excessWeightedStake)
              expect(nodeStakingDataBefore[0].node?.baseStakedAmount).to.equal(
                expectedNodeBaseStakedAmount
              );
              expect(nodeStakingDataBefore[0].node?.lastStakedAmount).to.equal(
                expectedNodeWeightedAmount
              );
              expect(nodeStakingDataBefore[0].node?.minStakedAmount).to.equal(
                0
              );
              expect(
                nodeStakingDataBefore[0].node?.excessWeightedStake
              ).to.equal(0);
              expect(
                nodeStakingDataBefore[nodeStakingDataBefore.length - 1].node
                  ?.excessWeightedStake
              ).to.equal(expectedNodeExcessWeightedAmount);

              // Check that data included weighted amount for epoch before transition to liquid
              expect(
                nodeStakingDataAfter[nodeStakingDataAfter.length - 2].node
                  ?.baseStakedAmount
              ).to.equal(expectedNodeBaseStakedAmount);
              expect(
                nodeStakingDataAfter[nodeStakingDataAfter.length - 2].node
                  ?.lastStakedAmount
              ).to.equal(expectedNodeWeightedAmount);
              expect(
                nodeStakingDataAfter[nodeStakingDataAfter.length - 2].node
                  ?.minStakedAmount
              ).to.equal(expectedNodeWeightedAmount);
              expect(
                nodeStakingDataAfter[nodeStakingDataAfter.length - 2].node
                  ?.excessWeightedStake
              ).to.equal(0);

              // Check that data changed for epoch 12 (index 11)
              expect(nodeStakingDataAfter[11].node?.baseStakedAmount).to.equal(
                expectedNodeBaseStakedAmount
              );
              expect(nodeStakingDataAfter[11].node?.lastStakedAmount).to.equal(
                expectedNodeBaseStakedAmount
              );
              expect(nodeStakingDataAfter[11].node?.minStakedAmount).to.equal(
                expectedNodeBaseStakedAmount
              );
              expect(
                nodeStakingDataAfter[11].node?.excessWeightedStake
              ).to.equal(0); // updateStakerPreviousEpochs sets this to 0

              expect(lastEpochNodeUpdated).to.equal(untilEpoch);

              /** Check global data **/

              // Check that global data is correct before update (specifically the excessWeightedStake)
              expect(
                globalStakingDataBefore[0].global?.baseStakedAmount
              ).to.equal(expectedGlobalBaseStakedAmount);
              expect(
                globalStakingDataBefore[0].global?.lastStakedAmount
              ).to.equal(expectedGlobalWeightedAmount);
              expect(
                globalStakingDataBefore[0].global?.minStakedAmount
              ).to.equal(0);
              expect(
                globalStakingDataBefore[0].global?.excessWeightedStake
              ).to.equal(0);
              expect(
                globalStakingDataBefore[globalStakingDataBefore.length - 1]
                  .global?.excessWeightedStake
              ).to.equal(expectedGlobalExcessWeightedAmount);

              // Check that data includes weighted amount for epoch before transition to liquid
              expect(
                globalStakingDataAfter[globalStakingDataAfter.length - 2].global
                  ?.baseStakedAmount
              ).to.equal(expectedGlobalBaseStakedAmount);
              expect(
                globalStakingDataAfter[globalStakingDataAfter.length - 2].global
                  ?.lastStakedAmount
              ).to.equal(expectedGlobalWeightedAmount);
              expect(
                globalStakingDataAfter[globalStakingDataAfter.length - 2].global
                  ?.minStakedAmount
              ).to.equal(expectedGlobalWeightedAmount);
              expect(
                globalStakingDataAfter[globalStakingDataAfter.length - 2].global
                  ?.excessWeightedStake
              ).to.equal(0);

              // Check that data changed for epoch 12 (index 11)
              expect(
                globalStakingDataAfter[11].global?.baseStakedAmount
              ).to.equal(expectedGlobalBaseStakedAmount);
              expect(
                globalStakingDataAfter[11].global?.lastStakedAmount
              ).to.equal(expectedGlobalBaseStakedAmount);
              expect(
                globalStakingDataAfter[11].global?.minStakedAmount
              ).to.equal(expectedGlobalBaseStakedAmount);
              expect(
                globalStakingDataAfter[11].global?.excessWeightedStake
              ).to.equal(0); // updateStakerPreviousEpochs sets this to 0

              expect(lastEpochGlobalUpdated).to.equal(untilEpoch);
            });

            it("Should update state correctly if locked period ends in past epoch", async function () {
              const {
                delegator,
                meldStakingCommon,
                meldStakingStorage,
                node2Id,
                tierOneId,
                tierTwoId,
                delegatorBaseLockedStakeAmount,
                delegatorTokenId,
                delegatorToken2Id,
                delegatorBaseLockedStakeAmount2,
                operator2BaseLockedStakeAmount,
                operatorBaseLockedStakeAmount,
                operator2TokenId,
                operatorTokenId,
              } = await loadFixture(delegatorLockStakedFixture);
              // Delegator and operator have already staked node 2 for 10 epochs, starting in epoch 1. End epoch should be 12 because.
              // The stake tier locks funds for 10 epochs. In epoch 1, the position does not have any impact, since it’s not been locked
              // for the full epoch. Only after epoch 11 is completed is the lock period over.
              // This time is the same as epoch 12 starts, therefore the epoch ends at the beginning of epoch 12.

              const startEpoch = await meldStakingStorage.getCurrentEpoch();

              // Advance time by 20 epochs
              await time.increaseTo(
                await meldStakingStorage.getEpochStart(startEpoch + 20n)
              );

              const untilEpoch = await meldStakingStorage.getCurrentEpoch();
              const endEpoch = await meldStakingCommon.getEndLockEpoch(
                delegatorToken2Id
              );

              const delegatorPosition1WeightedAmount =
                await calculateWeightedAmount(
                  meldStakingStorage,
                  delegatorBaseLockedStakeAmount,
                  tierTwoId
                );
              const delegatorPosition1ExcessWeightedStake =
                await calculateExcessWeightedStake(
                  meldStakingStorage,
                  delegatorTokenId
                );
              const delegatorPosition2WeightedAmount =
                await calculateWeightedAmount(
                  meldStakingStorage,
                  delegatorBaseLockedStakeAmount2,
                  tierOneId
                );
              const delegatorPosition2ExcessWeightedStake =
                await calculateExcessWeightedStake(
                  meldStakingStorage,
                  delegatorToken2Id
                );
              const operatorWeightedAmount = await calculateWeightedAmount(
                meldStakingStorage,
                operatorBaseLockedStakeAmount,
                tierTwoId
              );
              const operatorExcessWeightedStake =
                await calculateExcessWeightedStake(
                  meldStakingStorage,
                  operatorTokenId
                );
              const operator2WeightedAmount = await calculateWeightedAmount(
                meldStakingStorage,
                operator2BaseLockedStakeAmount,
                tierOneId
              );
              const operator2ExcessWeightedStake =
                await calculateExcessWeightedStake(
                  meldStakingStorage,
                  operator2TokenId
                );
              const delegatorPosition2DelegationFeeAmount =
                await calculateDelegationFeeAmount(
                  meldStakingStorage,
                  node2Id,
                  delegatorBaseLockedStakeAmount2
                );

              // Expected values for delegator position 2 (delegator staked node 2)
              const expectedDelegatorStakedAmount =
                delegatorPosition2WeightedAmount -
                delegatorPosition2DelegationFeeAmount;

              // Expected values for node 2 (node staked by delegator position 2 and operator2)
              const expectedNodeBaseStakedAmount =
                delegatorBaseLockedStakeAmount2 +
                operator2BaseLockedStakeAmount;

              const expectedNodeWeightedAmount =
                delegatorPosition2WeightedAmount + operator2WeightedAmount;

              const expectedNodeExcessWeightedAmount =
                delegatorPosition2ExcessWeightedStake +
                operator2ExcessWeightedStake;

              // Expected global values
              const expectedGlobalBaseStakedAmount =
                expectedNodeBaseStakedAmount +
                operatorBaseLockedStakeAmount +
                delegatorBaseLockedStakeAmount;

              const expectedGlobalWeightedAmount =
                expectedNodeWeightedAmount +
                operatorWeightedAmount +
                delegatorPosition1WeightedAmount;

              const expectedGlobalExcessWeightedAmount =
                expectedNodeExcessWeightedAmount +
                delegatorPosition1ExcessWeightedStake +
                operatorExcessWeightedStake;

              const { nodeStakingData: nodeStakingDataBefore } =
                await getNodeStakingDataForEpochs(
                  meldStakingStorage,
                  node2Id,
                  startEpoch,
                  untilEpoch
                );

              const { globalStakingData: globalStakingDataBefore } =
                await getGlobalStakingDataForEpochs(
                  meldStakingStorage,
                  startEpoch,
                  untilEpoch
                );

              // delegator Calls the updateStakerPreviousEpochs function to update position 2. This should transition the delegator to liquid staking.
              await meldStakingCommon
                .connect(delegator)
                ["updateStakerPreviousEpochs(uint256)"](delegatorToken2Id);

              const {
                stakingData: delegatorStakingData,
                lastEpochUpdated: lastEpochDelegatorUpdated,
              } = await getStakerStakingDataForEpochs(
                meldStakingStorage,
                delegatorToken2Id,
                startEpoch,
                untilEpoch,
                true //isDelegator
              );

              const {
                nodeStakingData: nodeStakingDataAfter,
                lastEpochNodeUpdated,
              } = await getNodeStakingDataForEpochs(
                meldStakingStorage,
                node2Id,
                startEpoch,
                untilEpoch
              );

              const {
                globalStakingData: globalStakingDataAfter,
                lastEpochGlobalUpdated,
              } = await getGlobalStakingDataForEpochs(
                meldStakingStorage,
                startEpoch,
                untilEpoch
              );

              /** Check delegator data **/

              // Check that data includes weighted amount for first epoch
              expect(
                delegatorStakingData[0].delegator?.baseStakedAmount
              ).to.equal(delegatorBaseLockedStakeAmount2);
              expect(
                delegatorStakingData[0].delegator?.lastStakedAmount
              ).to.equal(expectedDelegatorStakedAmount);
              expect(
                delegatorStakingData[0].delegator?.minStakedAmount
              ).to.equal(0);

              // Check that data includes weighted amount for epoch before transition to liquid
              expect(
                delegatorStakingData[10].delegator?.baseStakedAmount
              ).to.equal(delegatorBaseLockedStakeAmount2);
              expect(
                delegatorStakingData[10].delegator?.lastStakedAmount
              ).to.equal(expectedDelegatorStakedAmount);
              expect(
                delegatorStakingData[10].delegator?.minStakedAmount
              ).to.equal(expectedDelegatorStakedAmount);

              // Check that data changed for epoch 12 (index 11)
              expect(
                delegatorStakingData[11].delegator?.baseStakedAmount
              ).to.equal(delegatorBaseLockedStakeAmount2);
              expect(
                delegatorStakingData[11].delegator?.lastStakedAmount
              ).to.equal(
                delegatorStakingData[11].delegator!.baseStakedAmount -
                  delegatorPosition2DelegationFeeAmount
              );
              expect(
                delegatorStakingData[11].delegator?.minStakedAmount
              ).to.equal(
                delegatorStakingData[11].delegator!.baseStakedAmount -
                  delegatorPosition2DelegationFeeAmount
              );

              // Check that delegator was transitioned to liquid staking
              expect(
                await meldStakingStorage.getStakerLockTierId(delegatorToken2Id)
              ).to.equal(0);
              expect(lastEpochDelegatorUpdated).to.equal(untilEpoch);

              /** Check node data **/

              // Check that node data is correct before update (specifically the excessWeightedStake)
              expect(nodeStakingDataBefore[0].node?.baseStakedAmount).to.equal(
                expectedNodeBaseStakedAmount
              );
              expect(nodeStakingDataBefore[0].node?.lastStakedAmount).to.equal(
                expectedNodeWeightedAmount
              );
              expect(nodeStakingDataBefore[0].node?.minStakedAmount).to.equal(
                0
              );
              expect(
                nodeStakingDataBefore[0].node?.excessWeightedStake
              ).to.equal(0);
              expect(
                nodeStakingDataBefore[11].node?.excessWeightedStake
              ).to.equal(expectedNodeExcessWeightedAmount); // epoch 12

              // Check that data includes weighted amount for epoch before transition to liquid
              expect(nodeStakingDataAfter[10].node?.baseStakedAmount).to.equal(
                expectedNodeBaseStakedAmount
              );
              expect(nodeStakingDataAfter[10].node?.lastStakedAmount).to.equal(
                expectedNodeWeightedAmount
              );
              expect(nodeStakingDataAfter[10].node?.minStakedAmount).to.equal(
                expectedNodeWeightedAmount
              );
              expect(
                nodeStakingDataAfter[10].node?.excessWeightedStake
              ).to.equal(0);

              // Check that data changed for epoch 12 (index 11)
              expect(nodeStakingDataAfter[11].node?.baseStakedAmount).to.equal(
                expectedNodeBaseStakedAmount
              );
              expect(nodeStakingDataAfter[11].node?.lastStakedAmount).to.equal(
                expectedNodeBaseStakedAmount
              );
              expect(nodeStakingDataAfter[11].node?.minStakedAmount).to.equal(
                expectedNodeBaseStakedAmount
              );
              expect(
                nodeStakingDataAfter[11].node?.excessWeightedStake
              ).to.equal(0); // updateStakerPreviousEpochs sets this to 0

              expect(lastEpochNodeUpdated).to.equal(endEpoch);

              /** Check global data **/

              // Check that global data is correct before update (specifically the excessWeightedStake)
              expect(
                globalStakingDataBefore[0].global?.baseStakedAmount
              ).to.equal(expectedGlobalBaseStakedAmount);
              expect(
                globalStakingDataBefore[0].global?.lastStakedAmount
              ).to.equal(expectedGlobalWeightedAmount);
              expect(
                globalStakingDataBefore[0].global?.minStakedAmount
              ).to.equal(0);
              expect(
                globalStakingDataBefore[0].global?.excessWeightedStake
              ).to.equal(0);
              expect(
                globalStakingDataBefore[11].global?.excessWeightedStake
              ).to.equal(expectedGlobalExcessWeightedAmount);

              // Check that data includes weighted amount for epoch before transition to liquid
              expect(
                globalStakingDataAfter[10].global?.baseStakedAmount
              ).to.equal(expectedGlobalBaseStakedAmount);
              expect(
                globalStakingDataAfter[10].global?.lastStakedAmount
              ).to.equal(expectedGlobalWeightedAmount);
              expect(
                globalStakingDataAfter[10].global?.minStakedAmount
              ).to.equal(expectedGlobalWeightedAmount);
              expect(
                globalStakingDataAfter[10].global?.excessWeightedStake
              ).to.equal(0);

              // Check that data changed for epoch 12 (index 11)
              expect(
                globalStakingDataAfter[11].global?.baseStakedAmount
              ).to.equal(expectedGlobalBaseStakedAmount);
              expect(
                globalStakingDataAfter[11].global?.lastStakedAmount
              ).to.equal(expectedGlobalBaseStakedAmount);
              expect(
                globalStakingDataAfter[11].global?.minStakedAmount
              ).to.equal(expectedGlobalBaseStakedAmount);
              expect(
                globalStakingDataAfter[11].global?.excessWeightedStake
              ).to.equal(0); // updateStakerPreviousEpochs sets this to 0

              expect(lastEpochGlobalUpdated).to.equal(endEpoch);
            });
          }
        ); // End of Locked Staking Term Expires and Changes to Liquid Staking
      }); // End of updateStakerPreviousEpochs(uint256 _nftId) Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if operator updates after leaving node", async function () {
          const {
            operator,
            meldStakingOperator,
            meldStakingStorage,
            meldStakingCommon,
            operatorTokenId,
          } = await loadFixture(nodeStakedFixture);
          const startEpoch = await meldStakingStorage.getCurrentEpoch();

          // Advance time by 20 epochs
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(startEpoch + 20n)
          );

          const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

          // Operator leaves node.
          meldStakingOperator.connect(operator).leaveNode(operatorTokenId);

          // Increase time another 10 epochs
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(newCurrentEpoch + 10n)
          );

          // Operator calls updateStakerPreviousEpochs

          //the call below to updateStakerPreviousEpochs should revert with STAKER_DOES_NOT_EXIST
          await expect(
            meldStakingCommon
              .connect(operator)
              ["updateStakerPreviousEpochs(uint256)"](operatorTokenId)
          ).to.be.revertedWith(Errors.STAKER_DOES_NOT_EXIST);
        });

        it("Should revert if nftId does not exist", async function () {
          const { operator, meldStakingCommon, operatorTokenId } =
            await loadFixture(nodeStakedFixture);

          await expect(
            meldStakingCommon
              .connect(operator)
              ["updateStakerPreviousEpochs(uint256)"](operatorTokenId + 5n)
          ).to.be.revertedWith(Errors.STAKER_DOES_NOT_EXIST);
        });

        it("Should revert if nftId is 0", async function () {
          const { operator, meldStakingCommon } = await loadFixture(
            nodeStakedFixture
          );

          await expect(
            meldStakingCommon
              .connect(operator)
              ["updateStakerPreviousEpochs(uint256)"](0n)
          ).to.be.revertedWith(Errors.STAKER_DOES_NOT_EXIST);
        });
      }); // End of updateStakerPreviousEpochs(uint256 _nftId) Error test cases
    }); // End of updateStakerPreviousEpochs(uint256 _nftId)

    context(
      "updateStakerPreviousEpochs(uint256 _nftId, uint256 _untilEpoch)",
      function () {
        context("Happy Flow test cases", function () {
          context("Liquid Staking", function () {
            // This is a subset of the updateStakerPreviousEpochs(uint256 _nftId) test cases
            it("Should update operator state correctly when updating 100 epochs later after an action (new delegator stake)", async function () {
              const {
                deployer,
                delegator,
                operator,
                meldStakingCommon,
                meldStakingStorage,
                meldStakingDelegator,
                meldStakingNFT,
                meldToken,
                operatorTokenId,
                nodeId,
                liquidStakingTierId,
              } = await loadFixture(delegatorStakedFixture);

              // Time advances to epoch 150, but the operator only wants to update until epoch 100

              const startEpoch = await meldStakingStorage.getCurrentEpoch();

              // Advance time by 50 epochs
              await time.increaseTo(
                await meldStakingStorage.getEpochStart(startEpoch + 50n)
              );
              const newCurrentEpoch =
                await meldStakingStorage.getCurrentEpoch();

              const delegatorBaseStakeAmount2 = toMeldDecimals(5000);

              // New staking position on same node will change operator's staking data
              await delegateToNode(
                meldToken,
                meldStakingDelegator,
                meldStakingNFT,
                deployer,
                delegator,
                delegatorBaseStakeAmount2,
                nodeId,
                liquidStakingTierId
              );

              // Advance time by another 50 epochs
              await time.increaseTo(
                await meldStakingStorage.getEpochStart(newCurrentEpoch + 50n)
              );

              const untilEpoch = await meldStakingStorage.getCurrentEpoch();

              // Call the updateStakerPreviousEpochs function to update operator state
              await meldStakingCommon
                .connect(operator)
                ["updateStakerPreviousEpochs(uint256,uint256)"](
                  operatorTokenId,
                  untilEpoch
                );

              // Call the getStakerStakingDataForEpochs function
              const { stakingData: stakingDataAfter, lastEpochUpdated } =
                await getStakerStakingDataForEpochs(
                  meldStakingStorage,
                  operatorTokenId,
                  startEpoch,
                  untilEpoch,
                  false //!isDelegator
                );

              // Check state
              const expectedDelegationFee = await calculateDelegationFeeAmount(
                meldStakingStorage,
                nodeId,
                delegatorBaseStakeAmount2
              );

              // Delegator staked again in epoch 50 (index 49), so the lastStakedAmount should be updated for epoch 51 (index 50)
              const expectedLastStakedAmount =
                stakingDataAfter[49].operator!.lastStakedAmount +
                expectedDelegationFee;

              // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
              expect(
                stakingDataAfter[stakingDataAfter.length - 1].operator
                  ?.baseStakedAmount
              ).to.equal(stakingDataAfter[0].operator?.baseStakedAmount);
              expect(stakingDataAfter[50].operator?.lastStakedAmount).to.equal(
                expectedLastStakedAmount
              );
              expect(stakingDataAfter[51].operator?.minStakedAmount).to.equal(
                stakingDataAfter[50].operator?.lastStakedAmount
              );
              expect(
                stakingDataAfter[stakingDataAfter.length - 1].operator
                  ?.minStakedAmount
              ).to.equal(
                stakingDataAfter[stakingDataAfter.length - 1].operator
                  ?.lastStakedAmount
              );
              expect(lastEpochUpdated).to.equal(untilEpoch);
            });

            it("Should update the state for the correct operator when untilEpoch is in the past", async function () {
              const {
                deployer,
                delegator,
                operator2,
                meldStakingCommon,
                meldStakingStorage,
                meldStakingDelegator,
                meldStakingOperator,
                meldStakingConfig,
                meldStakingNFT,
                meldToken,
                operatorTokenId,
                liquidStakingTierId,
              } = await loadFixture(delegatorStakedFixture);

              const startEpoch = await meldStakingStorage.getCurrentEpoch();

              // Operator2 creates a new node

              // Params for the node request
              const nodeName = "testNode2";
              const delegatorFee = 5_00; // 50%
              const amount = toMeldDecimals(200_000);
              const metadata = "";

              // Operator 2 approves the NFT staking contract to be able to deposit the stake and requests a node
              await requestNode(
                meldToken,
                meldStakingOperator,
                meldStakingNFT,
                deployer,
                operator2,
                nodeName,
                delegatorFee,
                amount,
                liquidStakingTierId,
                metadata
              );

              // Node id is the hash of the node name
              const node2Id = await meldStakingOperator.hashNodeId(nodeName);
              await meldStakingConfig
                .connect(deployer)
                .approveNodeRequest(node2Id);

              const operator2TokenId =
                await meldStakingNFT.getTotalMintedNfts();

              // Advance time by 1 epoch
              await time.increaseTo(
                await meldStakingStorage.getEpochStart(startEpoch + 1n)
              );

              const untilEpoch = 2n;

              const delegatorBaseStakeAmount2 = toMeldDecimals(2000);

              const { stakingData: stakingDataOperatorBefore } =
                await getStakerStakingDataForEpochs(
                  meldStakingStorage,
                  operatorTokenId,
                  startEpoch,
                  untilEpoch,
                  false //!isDelegator
                );

              // Delegator stakes operator2's node in epoch 2. This action should NOT change operator's staking data
              await delegateToNode(
                meldToken,
                meldStakingDelegator,
                meldStakingNFT,
                deployer,
                delegator,
                delegatorBaseStakeAmount2,
                node2Id,
                liquidStakingTierId
              );

              // Advance time by 200 epochs
              await time.increaseTo(
                await meldStakingStorage.getEpochStart(startEpoch + 200n)
              );

              // Operator2 Calls the updateStakerPreviousEpochs function to update own state
              await meldStakingCommon
                .connect(operator2)
                ["updateStakerPreviousEpochs(uint256,uint256)"](
                  operator2TokenId,
                  untilEpoch
                );

              // Operator data should NOT have been updated
              const {
                stakingData: stakingDataOperatorAfter,
                lastEpochUpdated: lastEpochUpdatedOperator,
              } = await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operatorTokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

              // Call the getStakerStakingDataForEpochs function
              const {
                stakingData: stakingDataOperator2After,
                lastEpochUpdated: lastEpochUpdatedOperator2,
              } = await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operator2TokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

              // Check operator state
              expect(stakingDataOperatorBefore).to.deep.equal(
                stakingDataOperatorAfter
              );
              expect(lastEpochUpdatedOperator).to.equal(startEpoch);

              // Check operator2 state
              const expectedDelegationFee = await calculateDelegationFeeAmount(
                meldStakingStorage,
                node2Id,
                delegatorBaseStakeAmount2
              );
              const expectedLastStakedAmount =
                stakingDataOperator2After[0].operator!.lastStakedAmount +
                expectedDelegationFee;

              // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
              expect(
                stakingDataOperator2After[1].operator?.baseStakedAmount
              ).to.equal(
                stakingDataOperator2After[0].operator?.baseStakedAmount
              );
              expect(
                stakingDataOperator2After[1].operator?.lastStakedAmount
              ).to.equal(expectedLastStakedAmount);
              expect(
                stakingDataOperator2After[1].operator?.minStakedAmount
              ).to.equal(
                stakingDataOperator2After[0].operator?.lastStakedAmount
              );
              expect(lastEpochUpdatedOperator2).to.equal(untilEpoch);
            });
          }); // End of Liquid Staking

          context("Locked Staking", function () {
            it("Should not update state if delegator updates again in same epoch", async function () {
              const {
                delegator,
                meldStakingCommon,
                meldStakingStorage,
                delegatorToken2Id,
                delegatorStartLockStakeEpoch,
              } = await loadFixture(delegatorLockStakedFixture);

              //This epoch is same as original staking epoch
              const delegatorlastStakedAmountPerEpochBefore =
                await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                  delegatorToken2Id,
                  delegatorStartLockStakeEpoch
                );

              const delegatorMinStakedAmountPerEpochBefore =
                await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
                  delegatorToken2Id,
                  delegatorStartLockStakeEpoch
                );

              const delegatorLastUpdatedEpochBefore =
                await meldStakingStorage.getStakerLastEpochStakingUpdated(
                  delegatorToken2Id
                );

              await meldStakingCommon
                .connect(delegator)
                ["updateStakerPreviousEpochs(uint256,uint256)"](
                  delegatorToken2Id,
                  delegatorStartLockStakeEpoch
                );

              const delegatorlastStakedAmountPerEpochAfter =
                await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                  delegatorToken2Id,
                  delegatorStartLockStakeEpoch
                );

              const delegatorMinStakedAmountPerEpochAfter =
                await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
                  delegatorToken2Id,
                  delegatorStartLockStakeEpoch
                );

              const delegatorLastUpdatedEpochAfter =
                await meldStakingStorage.getStakerLastEpochStakingUpdated(
                  delegatorToken2Id
                );

              // Check state
              expect(delegatorLastUpdatedEpochBefore).to.equal(
                delegatorLastUpdatedEpochAfter
              );
              expect(delegatorlastStakedAmountPerEpochBefore).to.equal(
                delegatorlastStakedAmountPerEpochAfter
              );
              expect(delegatorMinStakedAmountPerEpochBefore).to.equal(
                delegatorMinStakedAmountPerEpochAfter
              );
            });

            it("Should update state correctly when last active epoch was in the past", async function () {
              const {
                operator2,
                meldStakingStorage,
                meldStakingCommon,
                meldStakingConfig,
                node2Id,
                operator2TokenId,
              } = await loadFixture(nodeLockStakedFixture);
              const startEpoch = await meldStakingStorage.getCurrentEpoch();

              // Advance time by 20 epochs
              await time.increaseTo(
                await meldStakingStorage.getEpochStart(startEpoch + 20n)
              );

              const newCurrentEpoch =
                await meldStakingStorage.getCurrentEpoch();

              // Admin slashes node. LastActive epoch is 21
              await meldStakingConfig.slashNode(node2Id, 100_00n);

              // Increase time another 10 epochs
              await time.increaseTo(
                await meldStakingStorage.getEpochStart(newCurrentEpoch + 10n)
              );

              // Operator2 calls updateStakerPreviousEpochs
              await meldStakingCommon
                .connect(operator2)
                ["updateStakerPreviousEpochs(uint256,uint256)"](
                  operator2TokenId,
                  newCurrentEpoch
                );

              const untilEpoch = await meldStakingStorage.getCurrentEpoch();

              // Call the getStakerStakingDataForEpochs function
              const { stakingData: stakingDataAfter, lastEpochUpdated } =
                await getStakerStakingDataForEpochs(
                  meldStakingStorage,
                  operator2TokenId,
                  startEpoch,
                  untilEpoch,
                  false //!isDelegator
                );

              // Check state
              expect(lastEpochUpdated).to.equal(newCurrentEpoch);
              // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function
              expect(
                stakingDataAfter[stakingDataAfter.length - 1].operator
                  ?.baseStakedAmount
              ).to.equal(stakingDataAfter[0].operator?.baseStakedAmount);
              expect(
                stakingDataAfter[stakingDataAfter.length - 1].operator
                  ?.lastStakedAmount
              ).to.equal(0n);
              expect(
                stakingDataAfter[stakingDataAfter.length - 1].operator
                  ?.minStakedAmount
              ).to.equal(0n);
            });
          });

          context(
            "Locked Staking Term Expires and Changes to Liquid Staking",
            function () {
              it("Should emit StakerUpgradedToLiquid if locked period ends in current epoch", async function () {
                const {
                  delegator,
                  meldStakingCommon,
                  meldStakingStorage,
                  delegatorToken2Id,
                } = await loadFixture(delegatorLockStakedFixture);

                // Delegator has already staked node 2 for 10 epochs
                const startEpoch = await meldStakingStorage.getCurrentEpoch();

                // Advance time by 20 epochs
                await time.increaseTo(
                  await meldStakingStorage.getEpochStart(startEpoch + 20n)
                );

                const untilEpoch = await meldStakingStorage.getCurrentEpoch();

                // Delegator Calls the updateStakerPreviousEpochs function to update own state
                await expect(
                  meldStakingCommon
                    .connect(delegator)
                    ["updateStakerPreviousEpochs(uint256,uint256)"](
                      delegatorToken2Id,
                      untilEpoch
                    )
                ).to.emit(meldStakingCommon, "StakerUpgradedToLiquid");
              });

              it("Should update state correctly if locked period ends in past epoch", async function () {
                const {
                  delegator,
                  meldStakingCommon,
                  meldStakingStorage,
                  node2Id,
                  tierOneId,
                  tierTwoId,
                  delegatorBaseLockedStakeAmount,
                  delegatorTokenId,
                  delegatorToken2Id,
                  delegatorBaseLockedStakeAmount2,
                  operator2BaseLockedStakeAmount,
                  operatorBaseLockedStakeAmount,
                  operator2TokenId,
                  operatorTokenId,
                } = await loadFixture(delegatorLockStakedFixture);
                // Delegator and operator have already staked node 2 for 10 epochs, starting in epoch 1. End epoch should be 12 because.
                // The stake tier locks funds for 10 epochs. In epoch 1, the position does not have any impact, since it’s not been locked
                // for the full epoch. Only after epoch 11 is completed is the lock period over.
                // This time is the same as epoch 12 starts, therefore the epoch ends at the beginning of epoch 12.

                const startEpoch = await meldStakingStorage.getCurrentEpoch();

                // Advance time to epoch 20
                await time.increaseTo(
                  await meldStakingStorage.getEpochStart(startEpoch + 20n)
                );

                const untilEpoch = await meldStakingStorage.getCurrentEpoch();
                const endEpoch = await meldStakingCommon.getEndLockEpoch(
                  delegatorToken2Id
                );

                const delegatorPosition1WeightedAmount =
                  await calculateWeightedAmount(
                    meldStakingStorage,
                    delegatorBaseLockedStakeAmount,
                    tierTwoId
                  );
                const delegatorPosition1ExcessWeightedStake =
                  await calculateExcessWeightedStake(
                    meldStakingStorage,
                    delegatorTokenId
                  );
                const delegatorPosition2WeightedAmount =
                  await calculateWeightedAmount(
                    meldStakingStorage,
                    delegatorBaseLockedStakeAmount2,
                    tierOneId
                  );
                const delegatorPosition2ExcessWeightedStake =
                  await calculateExcessWeightedStake(
                    meldStakingStorage,
                    delegatorToken2Id
                  );
                const operatorWeightedAmount = await calculateWeightedAmount(
                  meldStakingStorage,
                  operatorBaseLockedStakeAmount,
                  tierTwoId
                );
                const operatorExcessWeightedStake =
                  await calculateExcessWeightedStake(
                    meldStakingStorage,
                    operatorTokenId
                  );
                const operator2WeightedAmount = await calculateWeightedAmount(
                  meldStakingStorage,
                  operator2BaseLockedStakeAmount,
                  tierOneId
                );
                const operator2ExcessWeightedStake =
                  await calculateExcessWeightedStake(
                    meldStakingStorage,
                    operator2TokenId
                  );
                const delegatorPosition2DelegationFeeAmount =
                  await calculateDelegationFeeAmount(
                    meldStakingStorage,
                    node2Id,
                    delegatorBaseLockedStakeAmount2
                  );

                // Expected values for delegator position 2 (delegator staked node 2)
                const expectedDelegatorStakedAmount =
                  delegatorPosition2WeightedAmount -
                  delegatorPosition2DelegationFeeAmount;

                // Expected values for node 2 (node staked by delegator position 2 and operator2)
                const expectedNodeBaseStakedAmount =
                  delegatorBaseLockedStakeAmount2 +
                  operator2BaseLockedStakeAmount;

                const expectedNodeWeightedAmount =
                  delegatorPosition2WeightedAmount + operator2WeightedAmount;

                const expectedNodeExcessWeightedAmount =
                  delegatorPosition2ExcessWeightedStake +
                  operator2ExcessWeightedStake;

                // Expected global values
                const expectedGlobalBaseStakedAmount =
                  expectedNodeBaseStakedAmount +
                  operatorBaseLockedStakeAmount +
                  delegatorBaseLockedStakeAmount;

                const expectedGlobalWeightedAmount =
                  expectedNodeWeightedAmount +
                  operatorWeightedAmount +
                  delegatorPosition1WeightedAmount;

                const expectedGlobalExcessWeightedAmount =
                  expectedNodeExcessWeightedAmount +
                  delegatorPosition1ExcessWeightedStake +
                  operatorExcessWeightedStake;

                const { nodeStakingData: nodeStakingDataBefore } =
                  await getNodeStakingDataForEpochs(
                    meldStakingStorage,
                    node2Id,
                    startEpoch,
                    untilEpoch
                  );

                const { globalStakingData: globalStakingDataBefore } =
                  await getGlobalStakingDataForEpochs(
                    meldStakingStorage,
                    startEpoch,
                    untilEpoch
                  );

                // Delegator Calls the updateStakerPreviousEpochs function to update position 2. This should transition the delegator to liquid staking.
                await meldStakingCommon
                  .connect(delegator)
                  ["updateStakerPreviousEpochs(uint256,uint256)"](
                    delegatorToken2Id,
                    untilEpoch
                  );

                const {
                  stakingData: delegatorStakingData,
                  lastEpochUpdated: lastEpochDelegatorUpdated,
                } = await getStakerStakingDataForEpochs(
                  meldStakingStorage,
                  delegatorToken2Id,
                  startEpoch,
                  untilEpoch,
                  true //isDelegator
                );

                const {
                  nodeStakingData: nodeStakingDataAfter,
                  lastEpochNodeUpdated,
                } = await getNodeStakingDataForEpochs(
                  meldStakingStorage,
                  node2Id,
                  startEpoch,
                  untilEpoch
                );

                const {
                  globalStakingData: globalStakingDataAfter,
                  lastEpochGlobalUpdated,
                } = await getGlobalStakingDataForEpochs(
                  meldStakingStorage,
                  startEpoch,
                  untilEpoch
                );

                /** Check delegator data **/

                // Check that data includes weighted amount for first epoch
                expect(
                  delegatorStakingData[0].delegator?.baseStakedAmount
                ).to.equal(delegatorBaseLockedStakeAmount2);
                expect(
                  delegatorStakingData[0].delegator?.lastStakedAmount
                ).to.equal(expectedDelegatorStakedAmount);
                expect(
                  delegatorStakingData[0].delegator?.minStakedAmount
                ).to.equal(0);

                // Check that data includes weighted amount for epoch before transition to liquid
                expect(
                  delegatorStakingData[10].delegator?.baseStakedAmount
                ).to.equal(delegatorBaseLockedStakeAmount2);
                expect(
                  delegatorStakingData[10].delegator?.lastStakedAmount
                ).to.equal(expectedDelegatorStakedAmount);
                expect(
                  delegatorStakingData[10].delegator?.minStakedAmount
                ).to.equal(expectedDelegatorStakedAmount);

                // Check that data changed for epoch 12 (index 11)
                expect(
                  delegatorStakingData[11].delegator?.baseStakedAmount
                ).to.equal(delegatorBaseLockedStakeAmount2);
                expect(
                  delegatorStakingData[11].delegator?.lastStakedAmount
                ).to.equal(
                  delegatorStakingData[11].delegator!.baseStakedAmount -
                    delegatorPosition2DelegationFeeAmount
                );
                expect(
                  delegatorStakingData[11].delegator?.minStakedAmount
                ).to.equal(
                  delegatorStakingData[11].delegator!.baseStakedAmount -
                    delegatorPosition2DelegationFeeAmount
                );

                // Check that delegator was transitioned to liquid staking
                expect(
                  await meldStakingStorage.getStakerLockTierId(
                    delegatorToken2Id
                  )
                ).to.equal(0);
                expect(lastEpochDelegatorUpdated).to.equal(untilEpoch);

                /** Check node data **/

                // Check that node data is correct before update (specifically the excessWeightedStake)
                expect(
                  nodeStakingDataBefore[0].node?.baseStakedAmount
                ).to.equal(expectedNodeBaseStakedAmount);
                expect(
                  nodeStakingDataBefore[0].node?.lastStakedAmount
                ).to.equal(expectedNodeWeightedAmount);
                expect(nodeStakingDataBefore[0].node?.minStakedAmount).to.equal(
                  0
                );
                expect(
                  nodeStakingDataBefore[0].node?.excessWeightedStake
                ).to.equal(0);
                expect(
                  nodeStakingDataBefore[11].node?.excessWeightedStake
                ).to.equal(expectedNodeExcessWeightedAmount); // epoch 12

                // Check that data includes weighted amount for epoch before transition to liquid
                expect(
                  nodeStakingDataAfter[10].node?.baseStakedAmount
                ).to.equal(expectedNodeBaseStakedAmount);
                expect(
                  nodeStakingDataAfter[10].node?.lastStakedAmount
                ).to.equal(expectedNodeWeightedAmount);
                expect(nodeStakingDataAfter[10].node?.minStakedAmount).to.equal(
                  expectedNodeWeightedAmount
                );
                expect(
                  nodeStakingDataAfter[10].node?.excessWeightedStake
                ).to.equal(0);

                // Check that data changed for epoch 12 (index 11)
                expect(
                  nodeStakingDataAfter[11].node?.baseStakedAmount
                ).to.equal(expectedNodeBaseStakedAmount);
                expect(
                  nodeStakingDataAfter[11].node?.lastStakedAmount
                ).to.equal(expectedNodeBaseStakedAmount);
                expect(nodeStakingDataAfter[11].node?.minStakedAmount).to.equal(
                  expectedNodeBaseStakedAmount
                );
                expect(
                  nodeStakingDataAfter[11].node?.excessWeightedStake
                ).to.equal(0); // updateStakerPreviousEpochs sets this to 0

                expect(lastEpochNodeUpdated).to.equal(endEpoch);

                /** Check global data **/

                // Check that global data is correct before update (specifically the excessWeightedStake)
                expect(
                  globalStakingDataBefore[0].global?.baseStakedAmount
                ).to.equal(expectedGlobalBaseStakedAmount);
                expect(
                  globalStakingDataBefore[0].global?.lastStakedAmount
                ).to.equal(expectedGlobalWeightedAmount);
                expect(
                  globalStakingDataBefore[0].global?.minStakedAmount
                ).to.equal(0);
                expect(
                  globalStakingDataBefore[0].global?.excessWeightedStake
                ).to.equal(0);
                expect(
                  globalStakingDataBefore[11].global?.excessWeightedStake
                ).to.equal(expectedGlobalExcessWeightedAmount);

                // Check that data included weighted amount for epoch before transition to liquid
                expect(
                  globalStakingDataAfter[10].global?.baseStakedAmount
                ).to.equal(expectedGlobalBaseStakedAmount);
                expect(
                  globalStakingDataAfter[10].global?.lastStakedAmount
                ).to.equal(expectedGlobalWeightedAmount);
                expect(
                  globalStakingDataAfter[10].global?.minStakedAmount
                ).to.equal(expectedGlobalWeightedAmount);
                expect(
                  globalStakingDataAfter[10].global?.excessWeightedStake
                ).to.equal(0);

                // Check that data changed for epoch 12 (index 11)
                expect(
                  globalStakingDataAfter[11].global?.baseStakedAmount
                ).to.equal(expectedGlobalBaseStakedAmount);
                expect(
                  globalStakingDataAfter[11].global?.lastStakedAmount
                ).to.equal(expectedGlobalBaseStakedAmount);
                expect(
                  globalStakingDataAfter[11].global?.minStakedAmount
                ).to.equal(expectedGlobalBaseStakedAmount);
                expect(
                  globalStakingDataAfter[11].global?.excessWeightedStake
                ).to.equal(0); // updateStakerPreviousEpochs sets this to 0

                expect(lastEpochGlobalUpdated).to.equal(endEpoch);
              });
            }
          ); // End of Locked Staking Term Expires and Changes to Liquid Staking
        }); // End of Happy Flow test cases
        context("Error test cases", function () {
          it("Should revert if operator updates after leaving node (node does not exist)", async function () {
            const {
              operator,
              meldStakingOperator,
              meldStakingStorage,
              meldStakingCommon,
              operatorTokenId,
            } = await loadFixture(nodeStakedFixture);
            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 20 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 20n)
            );

            const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Operator leaves node.
            meldStakingOperator.connect(operator).leaveNode(operatorTokenId);

            // Increase time another 10 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(newCurrentEpoch + 10n)
            );

            // The call below to updateStakerPreviousEpochs should revert with STAKER_DOES_NOT_EXIST
            await expect(
              meldStakingCommon
                .connect(operator)
                ["updateStakerPreviousEpochs(uint256,uint256)"](
                  operatorTokenId,
                  newCurrentEpoch
                )
            ).to.be.revertedWith(Errors.NODE_DOES_NOT_EXIST);
          });

          it("Should revert if nftId does not exist", async function () {
            const {
              operator,
              meldStakingCommon,
              meldStakingStorage,
              operatorTokenId,
            } = await loadFixture(nodeStakedFixture);

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            await expect(
              meldStakingCommon
                .connect(operator)
                ["updateStakerPreviousEpochs(uint256,uint256)"](
                  operatorTokenId + 5n,
                  currentEpoch
                )
            ).to.be.revertedWith(Errors.NODE_DOES_NOT_EXIST);
          });

          it("Should revert if nftId is 0", async function () {
            const { operator, meldStakingCommon, meldStakingStorage } =
              await loadFixture(nodeStakedFixture);

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            await expect(
              meldStakingCommon
                .connect(operator)
                ["updateStakerPreviousEpochs(uint256,uint256)"](
                  0n,
                  currentEpoch
                )
            ).to.be.revertedWith(Errors.NODE_DOES_NOT_EXIST);
          });

          it("Should revert if lastActiveEpoch was in the past", async function () {
            const {
              operator,
              meldStakingConfig,
              meldStakingCommon,
              meldStakingStorage,
              operatorTokenId,
              nodeId,
            } = await loadFixture(nodeStakedFixture);

            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time  20 epochs to epoch 21
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 20n)
            );

            // Admin slashes node. LastActive epoch is 21
            await meldStakingConfig.slashNode(nodeId, 100_00n);

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Increase time another 20 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 20n)
            );

            const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

            await expect(
              meldStakingCommon
                .connect(operator)
                ["updateStakerPreviousEpochs(uint256,uint256)"](
                  operatorTokenId,
                  newCurrentEpoch
                )
            ).to.be.revertedWith(Errors.INVALID_EPOCH);
          });
        }); // End of updateStakerPreviousEpochs(uint256 _nftId) Error test cases
      }
    ); // End of updateStakerPreviousEpochs(uint256 _nftId, uint256 _untilEpoch)

    context(
      "updateStakersPreviousEpochs(uint256[] memory _nftIds)",
      function () {
        context("Happy Flow Test Cases", function () {
          it("Should not update state if nftIds array is empty", async function () {
            const {
              deployer,
              delegator,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingNFT,
              meldStakingDelegator,
              meldToken,
              operatorTokenId,
              nodeId,
              liquidStakingTierId,
            } = await loadFixture(nodeStakedFixture);
            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by 5 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 5n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Delegator stakes operator's node in epoch 5.
            const delegatorStakeAmount = toMeldDecimals(1000);

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              delegatorStakeAmount,
              nodeId,
              liquidStakingTierId
            );

            // Get operator staking data before update call
            const { lastEpochUpdated: lastUpdatedBefore } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operatorTokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

            // Even though the delegator staked in epoch 5, the updateStakerPreviousEpochs function should not update the operator's state
            await meldStakingCommon["updateStakersPreviousEpochs(uint256[])"](
              []
            );

            // Get operator staking data after update call
            const { lastEpochUpdated: lastUpdatedAfter } =
              await getStakerStakingDataForEpochs(
                meldStakingStorage,
                operatorTokenId,
                startEpoch,
                untilEpoch,
                false //!isDelegator
              );

            expect(lastUpdatedAfter).to.equal(lastUpdatedBefore);
          });

          it("Should update state correctly when random account updates multiple NFTs after multiple epochs", async function () {
            const {
              deployer,
              rando,
              meldStakingConfig,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingDelegator,
              meldStakingNFT,
              meldToken,
              nodeId,
              tierTwoId,
            } = await loadFixture(nodeLockStakedFixture);

            let nftId: bigint;
            const nftIds: bigint[] = [];

            const ethAmount: bigint = ethers.parseEther("2");
            const delegatorBaseLockedStakeAmount: bigint =
              toMeldDecimals(100_000);

            // Generate multiple staking positions for different addresses with the Hardhat Ethers provider
            for (let i = 0; i < 5; i++) {
              const provider = ethers.provider;
              const delegator = ethers.Wallet.createRandom().connect(provider);

              // Send ETH to the delegator's address for gas
              await deployer.sendTransaction({
                to: delegator.address,
                value: ethAmount,
              });

              // Delegator stakes node
              await delegateToNode(
                meldToken,
                meldStakingDelegator,
                meldStakingNFT,
                deployer,
                delegator,
                delegatorBaseLockedStakeAmount,
                nodeId,
                tierTwoId
              );

              nftId = await meldStakingNFT.getTotalMintedNfts();
              nftIds.push(nftId);
            }

            // All positions have the same lock end epoch
            const lockEndEpoch = await meldStakingCommon.getEndLockEpoch(
              nftIds[0]
            );

            // Advance time past when lock period ends (ends in epoch 12)
            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 15n)
            );

            // Admin slashes node that all delegators staked in epoch 16
            await meldStakingConfig.slashNode(nodeId, 100_00n);

            const slashEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance a few more epochs to check if slashed epoch data is correct
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(slashEpoch + 1n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // A random account calls the updateStakerPreviousEpochs, passing all nftIds
            await meldStakingCommon
              .connect(rando)
              ["updateStakersPreviousEpochs(uint256[])"](nftIds);

            const expectedDelegationFee = await calculateDelegationFeeAmount(
              meldStakingStorage,
              nodeId,
              delegatorBaseLockedStakeAmount
            );
            const expectedWeightedAmount = await calculateWeightedAmount(
              meldStakingStorage,
              delegatorBaseLockedStakeAmount,
              tierTwoId
            );
            const expectedLastStakedAmountBeforeLockExpires =
              expectedWeightedAmount - expectedDelegationFee;
            const expectedLastStakedAmountAfterLockExpires =
              delegatorBaseLockedStakeAmount - expectedDelegationFee;

            for (const nftId of nftIds) {
              // Call the getStakerStakingDataForEpochs function to get delegator data for each nftId
              const {
                stakingData: stakingDataDelegatorAfter,
                lastEpochUpdated: lastlastEpochDelegatorUpdated,
              } = await getStakerStakingDataForEpochs(
                meldStakingStorage,
                nftId,
                startEpoch,
                untilEpoch,
                true //isDelegator
              );

              // Check state
              expect(lastlastEpochDelegatorUpdated).to.equal(untilEpoch - 1n);

              // baseStakedAmount should NOT be updated by the updateStakerPreviousEpochs function

              // Check data for epoch 2 (after lastMinStakedAmount was updated)
              expect(
                stakingDataDelegatorAfter[1].delegator?.baseStakedAmount
              ).to.equal(delegatorBaseLockedStakeAmount);
              expect(
                stakingDataDelegatorAfter[1].delegator?.lastStakedAmount
              ).to.equal(expectedLastStakedAmountBeforeLockExpires);
              expect(
                stakingDataDelegatorAfter[1].delegator?.minStakedAmount
              ).to.equal(expectedLastStakedAmountBeforeLockExpires);

              // Check data for lock end epoch
              expect(
                stakingDataDelegatorAfter[Number(lockEndEpoch) - 1].delegator
                  ?.baseStakedAmount
              ).to.equal(delegatorBaseLockedStakeAmount);
              expect(
                stakingDataDelegatorAfter[Number(lockEndEpoch) - 1].delegator
                  ?.lastStakedAmount
              ).to.equal(expectedLastStakedAmountAfterLockExpires);
              expect(
                stakingDataDelegatorAfter[Number(lockEndEpoch) - 1].delegator
                  ?.minStakedAmount
              ).to.equal(expectedLastStakedAmountAfterLockExpires);

              // Check data for epoch after node is slashed
              expect(
                stakingDataDelegatorAfter[Number(slashEpoch)].delegator
                  ?.baseStakedAmount
              ).to.equal(delegatorBaseLockedStakeAmount);
              expect(
                stakingDataDelegatorAfter[Number(slashEpoch)].delegator
                  ?.lastStakedAmount
              ).to.equal(0n);
              expect(
                stakingDataDelegatorAfter[Number(slashEpoch)].delegator
                  ?.minStakedAmount
              ).to.equal(0n);
            } // End of for loop
          });

          it("Should allow one NFT owner to update all NFT staking positions, even those that caller does not own", async function () {
            const {
              deployer,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingDelegator,
              meldStakingNFT,
              meldToken,
              nodeId,
              liquidStakingTierId,
            } = await loadFixture(nodeStakedFixture);

            // Values won't change if nothing happens in the protocol to change the delegator's position.
            // The mappings will get updated for each epoch, but the values will be the same.

            const ethAmount: bigint = ethers.parseEther("2");
            const delegatorBaseLockedStakeAmount: bigint = toMeldDecimals(1000);
            let nftId: bigint;
            const nftIds: bigint[] = [];

            // Generate multiple staking positions with the Hardhat Ethers provider
            const stakers: Array<Signer> = [];
            for (let i = 0; i < 5; i++) {
              const provider = ethers.provider;
              const delegator = ethers.Wallet.createRandom().connect(provider);

              // Send ETH to the delegator's address for gas
              await deployer.sendTransaction({
                to: delegator.address,
                value: ethAmount,
              });

              stakers.push(delegator);

              // Delegator stakes node
              await delegateToNode(
                meldToken,
                meldStakingDelegator,
                meldStakingNFT,
                deployer,
                delegator,
                delegatorBaseLockedStakeAmount,
                nodeId,
                liquidStakingTierId
              );

              nftId = await meldStakingNFT.getTotalMintedNfts();
              nftIds.push(nftId);
            }

            // Advance time by 1 epoch
            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 1n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // One of the NFT account owners calls the updateStakerPreviousEpochs, passing all nftIds
            await meldStakingCommon
              .connect(stakers[1])
              ["updateStakersPreviousEpochs(uint256[])"](nftIds);

            const expectedDelegationFee = await calculateDelegationFeeAmount(
              meldStakingStorage,
              nodeId,
              delegatorBaseLockedStakeAmount
            );

            for (const nftId of nftIds) {
              // Call the getStakerStakingDataForEpochs function to get delegator data for each nftId
              const {
                stakingData: stakingDataDelegatorAfter,
                lastEpochUpdated: lastlastEpochDelegatorUpdated,
              } = await getStakerStakingDataForEpochs(
                meldStakingStorage,
                nftId,
                startEpoch,
                untilEpoch,
                true //isDelegator
              );

              // Check state of last epoch updated
              expect(lastlastEpochDelegatorUpdated).to.equal(untilEpoch);

              expect(
                stakingDataDelegatorAfter[Number(untilEpoch) - 1].delegator
                  ?.baseStakedAmount
              ).to.equal(delegatorBaseLockedStakeAmount);
              expect(
                stakingDataDelegatorAfter[Number(untilEpoch) - 1].delegator
                  ?.lastStakedAmount
              ).to.equal(
                delegatorBaseLockedStakeAmount - expectedDelegationFee
              );
              expect(
                stakingDataDelegatorAfter[1].delegator?.minStakedAmount
              ).to.equal(
                delegatorBaseLockedStakeAmount - expectedDelegationFee
              );
            } // End of for loop
          });
        }); // End of Happy Flow Test Cases

        context("Error Test Cases", function () {
          it("Should revert if one of the nftIds does not exist", async function () {
            const { meldStakingCommon, delegatorTokenId } = await loadFixture(
              delegatorStakedFixture
            );
            const nftIds: bigint[] = [];
            nftIds.push(delegatorTokenId);
            nftIds.push(delegatorTokenId + 20n);

            await expect(
              meldStakingCommon["updateStakersPreviousEpochs(uint256[])"](
                nftIds
              )
            ).to.be.revertedWith(Errors.STAKER_DOES_NOT_EXIST);
          });
        }); // End of Error Test Cases
      }
    ); // End of updateStakersPreviousEpochs(uint256[] memory _nftIds)

    context("updateAllMyStakersPreviousEpochs()", function () {
      context("Happy Flow Test Cases", function () {
        it("Should update all staking positions for a staker address", async function () {
          const {
            deployer,
            operator,
            delegator,
            meldStakingCommon,
            meldStakingStorage,
            meldStakingOperator,
            meldStakingDelegator,
            meldStakingConfig,
            meldStakingNFT,
            meldToken,
            liquidStakingTierId,
          } = await loadFixture(nodeStakedFixture);

          let nodeId: string;
          let nftId: bigint;
          const nftIds: bigint[] = [];
          const delegatorFee = 5_00; // 5%
          const operatorBaseStakeAmount = toMeldDecimals(2_000_000);
          const metadata = "";
          const delegatorBaseStakeAmount = toMeldDecimals(1000);

          // Generate multiple staking positions for the same operator
          for (let i = 0; i < 5; i++) {
            // Params for the node request
            const nodeName = `testNode${i}`;

            // Operator approves the NFT staking contract to be able to deposit the stake and request a node
            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              operatorBaseStakeAmount,
              liquidStakingTierId,
              metadata
            );

            nftId = await meldStakingNFT.getTotalMintedNfts();
            nftIds.push(nftId);

            // Node id is the hash of the node name
            nodeId = await meldStakingOperator.hashNodeId(nodeName);
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            // Delegator stakes node
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              delegatorBaseStakeAmount,
              nodeId,
              liquidStakingTierId
            );
          }

          // Advance time by 5 epochs
          const startEpoch = await meldStakingStorage.getCurrentEpoch();
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(startEpoch + 5n)
          );

          const untilEpoch = await meldStakingStorage.getCurrentEpoch();

          // Operator Updates all staking positions for all previous epochs
          await meldStakingCommon
            .connect(operator)
            .updateAllMyStakersPreviousEpochs();

          // Same for each
          const expectedDelegationFee = await calculateDelegationFeeAmount(
            meldStakingStorage,
            await meldStakingOperator.hashNodeId("testNode1"), // same fee for each node
            delegatorBaseStakeAmount
          );

          for (const nftId of nftIds) {
            // Call the getStakerStakingDataForEpochs function to get staker data for each nftId
            const {
              stakingData: stakingDataStakerAfter,
              lastEpochUpdated: lastEpochStakerUpdated,
            } = await getStakerStakingDataForEpochs(
              meldStakingStorage,
              nftId,
              startEpoch,
              untilEpoch,
              false // isDelegator
            );

            expect(lastEpochStakerUpdated).to.equal(untilEpoch);

            for (let i = 0; i < Number(untilEpoch); i++) {
              // Check state of epoch updated
              expect(
                stakingDataStakerAfter[i].operator?.baseStakedAmount
              ).to.equal(operatorBaseStakeAmount);
              expect(
                stakingDataStakerAfter[i].operator?.lastStakedAmount
              ).to.equal(operatorBaseStakeAmount + expectedDelegationFee);
              expect(
                stakingDataStakerAfter[i].operator?.minStakedAmount
              ).to.equal(
                i === 0 ? 0n : operatorBaseStakeAmount + expectedDelegationFee
              );
            }
          } // End of for loop
        });
      }); // End of Happy Flow Test Cases

      context("Error Test Cases", function () {
        it("Should revert if called by user who has no staking positions", async function () {
          const { rando, meldStakingCommon } = await loadFixture(
            delegatorStakedFixture
          );

          await expect(
            meldStakingCommon.connect(rando).updateAllMyStakersPreviousEpochs()
          ).to.be.revertedWith(Errors.NO_STAKING_POSITIONS);
        });
      }); // End of Error Test Cases
    }); // End of updateAllMyStakersPreviousEpochs()

    context("updateUnclaimedRewards(uint256 _nftId)", function () {
      context("Happy Flow Test Cases", function () {
        context("Liquid Staking", function () {
          it("Should emit UnclaimedRewardsUpdated event correctly in epoch 1", async function () {
            const {
              delegator,
              meldStakingCommon,
              meldStakingStorage,
              delegatorTokenId,
            } = await loadFixture(delegatorStakedFixture);

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();
            const fromEpoch =
              (await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                delegatorTokenId
              )) + 1n;

            await expect(
              meldStakingCommon
                .connect(delegator)
                .updateUnclaimedRewards(delegatorTokenId)
            )
              .to.emit(meldStakingCommon, "UnclaimedRewardsUpdated")
              .withArgs(delegatorTokenId, 0n, 0n, fromEpoch, untilEpoch);
          });

          it("Should emit UnclaimedRewardsUpdated event correctly in epoch > 1 if epoch rewards have NOT been set", async function () {
            const {
              delegator,
              meldStakingCommon,
              meldStakingStorage,
              delegatorTokenId,
            } = await loadFixture(delegatorStakedFixture);

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance time by 1 epoch to epoch 2
            await time.increaseTo(await meldStakingStorage.getEpochStart(2n));

            const fromEpoch =
              (await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                delegatorTokenId
              )) + 1n;

            await expect(
              meldStakingCommon
                .connect(delegator)
                .updateUnclaimedRewards(delegatorTokenId)
            )
              .to.emit(meldStakingCommon, "UnclaimedRewardsUpdated")
              .withArgs(
                delegatorTokenId,
                0n,
                0n,
                fromEpoch,
                lastEpochRewardsUpdated
              );
          });

          it("Should emit UnclaimedRewardsUpdated event correctly in epoch > 1 if epoch rewards have been set", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
              delegatorStartStakeEpoch,
            } = await loadFixture(delegatorStakedFixture);

            // Advance to epoch 3
            await time.increaseTo(await meldStakingStorage.getEpochStart(3n));

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Epoch 2
            const fromEpoch =
              (await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                delegatorTokenId
              )) + 1n;

            const rewardAmount = toMeldDecimals(100_000);

            // Set rewards for epoch 2
            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              rewardAmount
            );

            await meldStakingConfig
              .connect(rewardsSetter)
              .setRewards(rewardAmount, 2n);

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            const txData = meldStakingCommon.interface.encodeFunctionData(
              "updateUnclaimedRewards",
              [delegatorTokenId]
            );
            const txResult = await ethers.provider.call({
              to: await meldStakingCommon.getAddress(),
              data: txData,
            });
            const decodedResult = ethers.AbiCoder.defaultAbiCoder().decode(
              ["uint256"],
              txResult
            );

            const updateTx = await meldStakingCommon
              .connect(delegator)
              .updateUnclaimedRewards(delegatorTokenId);

            const expectedNewUnclaimedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              delegatorStartStakeEpoch,
              untilEpoch
            );

            expect(decodedResult[0]).to.equal(expectedNewUnclaimedRewards);

            await expect(updateTx)
              .to.emit(meldStakingCommon, "UnclaimedRewardsUpdated")
              .withArgs(
                delegatorTokenId,
                0n,
                expectedNewUnclaimedRewards,
                fromEpoch,
                lastEpochRewardsUpdated
              );
          });

          it("Should update state correctly if user calls updateUnclaimedRewards after user previously called updateUnclaimedRewards before epoch rewards had been set", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
              delegatorStartStakeEpoch,
            } = await loadFixture(delegatorStakedFixture);

            // Advance time to epoch 2
            await time.increaseTo(await meldStakingStorage.getEpochStart(2n));

            // Delegator updates unclaimed rewards in epoch 2
            meldStakingCommon
              .connect(delegator)
              .updateUnclaimedRewards(delegatorTokenId);

            // Unclaimed rewards should be 0 because rewards for epoch 2 have not been set yet
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);

            // Advance time to epoch 3
            await time.increaseTo(await meldStakingStorage.getEpochStart(3n));

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Set rewards for epoch 2
            const rewardAmount = toMeldDecimals(500_000);

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              rewardAmount
            );

            await meldStakingConfig
              .connect(rewardsSetter)
              .setRewards(rewardAmount, 2n);

            // Delegator updates unclaimed rewards in epoch 3
            meldStakingCommon
              .connect(delegator)
              .updateUnclaimedRewards(delegatorTokenId);

            const expectedNewUnclaimedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              delegatorStartStakeEpoch,
              untilEpoch
            );

            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(expectedNewUnclaimedRewards);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                delegatorTokenId
              )
            ).to.equal(untilEpoch - 1n);
          });

          it("Should update state to 0 for epoch 1", async function () {
            const {
              operator,
              meldStakingStorage,
              meldStakingCommon,
              operatorTokenId,
            } = await loadFixture(nodeStakedFixture);

            await meldStakingCommon
              .connect(operator)
              .updateUnclaimedRewards(operatorTokenId);

            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                operatorTokenId
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                operatorTokenId
              )
            ).to.equal(1n);
          });

          it("Should update state to 0 for first staked epoch when first staked epoch  > 1", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingDelegator,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              nodeId,
              liquidStakingTierId,
            } = await loadFixture(nodeStakedFixture);

            // Advance time to epoch 10
            await time.increaseTo(await meldStakingStorage.getEpochStart(10n));

            // Delegator stakes in epoch 10
            const delegatorBaseStakeAmount = toMeldDecimals(5000);

            // Delegator stakes node
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              delegatorBaseStakeAmount,
              nodeId,
              liquidStakingTierId
            );

            const delegatorTokenId = await meldStakingNFT.getTotalMintedNfts();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 10n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to 11 so rewards can be set up to epoch 10
            await time.increaseTo(await meldStakingStorage.getEpochStart(11n));

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            await meldStakingCommon
              .connect(delegator)
              .updateUnclaimedRewards(delegatorTokenId);

            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                delegatorTokenId
              )
            ).to.equal(10n);
          });

          it("Should update state correctly for multiple epochs", async function () {
            const {
              deployer,
              operator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
            } = await loadFixture(nodeStakedFixture);

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            await meldStakingCommon
              .connect(operator)
              .updateUnclaimedRewards(operatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              operatorTokenId,
              1n,
              currentEpoch
            );

            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                operatorTokenId
              )
            ).to.equal(expectedRewards);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                operatorTokenId
              )
            ).to.equal(currentEpoch);
          });

          it("Should only update rewards to last active epoch -1 if last active epoch is in the past", async function () {
            const {
              deployer,
              rewardsSetter,
              operator,
              delegator,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              nodeId,
              operatorTokenId,
              delegatorTokenId,
            } = await loadFixture(delegatorStakedFixture);
            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time to epoch 20
            await time.increaseTo(await meldStakingStorage.getEpochStart(20n));

            const nodeSlahedEpoch = await meldStakingStorage.getCurrentEpoch();

            // Admin slashes node. LastActive epoch is 20
            await meldStakingConfig.slashNode(nodeId, 100_00n);

            // Increase time another 10 epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(nodeSlahedEpoch + 10n)
            );

            const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 30n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(newCurrentEpoch + 1n)
            );

            const setRewardsEpoch = await meldStakingStorage.getCurrentEpoch();

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            // Operator updates rewards
            await meldStakingCommon
              .connect(operator)
              .updateUnclaimedRewards(operatorTokenId);

            // Delegator updates rewards
            await meldStakingCommon
              .connect(delegator)
              .updateUnclaimedRewards(delegatorTokenId);

            // Calculate expected rewards
            const expectedOperatorRewards = await calculateRewards(
              meldStakingStorage,
              operatorTokenId,
              startEpoch,
              setRewardsEpoch
            );

            const expectedDelegatorRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              startEpoch,
              setRewardsEpoch
            );

            // Check operator and delegator rewards
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                operatorTokenId
              )
            ).to.equal(expectedOperatorRewards);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                operatorTokenId
              )
            ).to.equal(nodeSlahedEpoch - 1n);

            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(expectedDelegatorRewards);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                delegatorTokenId
              )
            ).to.equal(nodeSlahedEpoch - 1n);
          });

          it("Should update state correctly for multiple stakers", async function () {
            const {
              deployer,
              operator,
              delegator,
              rewardsSetter,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              liquidStakingTierId,
              operatorTokenId,
            } = await loadFixture(nodeStakedFixture);

            let nodeId: string;
            let nftId: bigint;
            const nftIds: bigint[] = [];
            const delegatorFee = 5_00; // 5%
            const operatorBaseStakeAmount = toMeldDecimals(2_000_000);
            const metadata = "";
            const delegatorBaseStakeAmount = toMeldDecimals(1000);

            // Generate multiple staking positions for the same operator
            for (let i = 0; i < 5; i++) {
              // Params for the node request
              const nodeName = `testNode${i}`;

              // Operator approves the NFT staking contract to be able to deposit the stake and requests a node
              await requestNode(
                meldToken,
                meldStakingOperator,
                meldStakingNFT,
                deployer,
                operator,
                nodeName,
                delegatorFee,
                operatorBaseStakeAmount,
                liquidStakingTierId,
                metadata
              );

              nftId = await meldStakingNFT.getTotalMintedNfts();
              nftIds.push(nftId);

              // Node id is the hash of the node name
              nodeId = await meldStakingOperator.hashNodeId(nodeName);
              await meldStakingConfig
                .connect(deployer)
                .approveNodeRequest(nodeId);

              // Delegator stakes node
              await delegateToNode(
                meldToken,
                meldStakingDelegator,
                meldStakingNFT,
                deployer,
                delegator,
                delegatorBaseStakeAmount,
                nodeId,
                liquidStakingTierId
              );
            }

            // Advance time by 5 epochs
            const startEpoch = await meldStakingStorage.getCurrentEpoch();
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(startEpoch + 5n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(200_000);
            const amountIncrease = toMeldDecimals(20_000);

            const rewardAmounts = [];
            const numEpochs = 5n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch so rewards can be set up to epoch 6
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(untilEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            // Operator updates rewards
            await meldStakingCommon
              .connect(operator)
              .updateUnclaimedRewards(operatorTokenId);

            const expecteOperatorRewards = await calculateRewards(
              meldStakingStorage,
              operatorTokenId,
              startEpoch,
              untilEpoch
            );

            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                operatorTokenId
              )
            ).to.equal(expecteOperatorRewards);

            // Update delegator rewards for each nftId

            let expectedDelegatorRewards;

            for (const nftId of nftIds) {
              // Anyone can call the function. It doesn't have to be the owner of the nft
              await meldStakingCommon.updateUnclaimedRewards(nftId);

              expectedDelegatorRewards = await calculateRewards(
                meldStakingStorage,
                nftId,
                startEpoch,
                untilEpoch
              );

              expect(
                await meldStakingStorage.getStakerUnclaimedRewards(nftId)
              ).to.equal(expectedDelegatorRewards);
              expect(
                await meldStakingStorage.getStakerLastEpochRewardsUpdated(nftId)
              ).to.equal(untilEpoch - 1n);
            } // End of for loop
          });
        }); // End of Liquid Staking

        context("Locked Staking", function () {
          // A subset of test cases to make sure the updateUnclaimedRewards function works for locked staking
          it("Should emit UnclaimedRewardsUpdated event correctly in epoch > 1 if epoch rewards have been set", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingCommon,
              meldStakingStorage,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
              delegatorStartLockStakeEpoch,
            } = await loadFixture(delegatorLockStakedFixture);

            // Advance to epoch 3
            await time.increaseTo(await meldStakingStorage.getEpochStart(3n));

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Epoch 2
            const fromEpoch =
              (await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                delegatorTokenId
              )) + 1n;

            const rewardAmount = toMeldDecimals(1_000_000);

            // Set rewards for epoch 2
            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              rewardAmount
            );

            await meldStakingConfig
              .connect(rewardsSetter)
              .setRewards(rewardAmount, 2n);

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            const updateTx = await meldStakingCommon
              .connect(delegator)
              .updateUnclaimedRewards(delegatorTokenId);

            const expectedNewUnclaimedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              delegatorStartLockStakeEpoch,
              untilEpoch
            );

            await expect(updateTx)
              .to.emit(meldStakingCommon, "UnclaimedRewardsUpdated")
              .withArgs(
                delegatorTokenId,
                0n,
                expectedNewUnclaimedRewards,
                fromEpoch,
                lastEpochRewardsUpdated
              );
          });

          it("Should update state correctly for multiple epochs", async function () {
            const {
              deployer,
              operator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
            } = await loadFixture(nodeLockStakedFixture);

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            await meldStakingCommon
              .connect(operator)
              .updateUnclaimedRewards(operatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              operatorTokenId,
              1n,
              currentEpoch
            );

            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                operatorTokenId
              )
            ).to.equal(expectedRewards);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                operatorTokenId
              )
            ).to.equal(currentEpoch);
          });

          it("Should only update state to last active epoch -1 if last active epoch is in the past (lock period ended)", async function () {
            const {
              deployer,
              rewardsSetter,
              operator,
              delegator,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
              delegatorTokenId,
              tierTwoId,
            } = await loadFixture(delegatorLockStakedFixture);
            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            const lockStakingTier = await meldStakingStorage.getLockStakingTier(
              tierTwoId
            );

            // Advance time to 1 epoch past end of lock period
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(
                startEpoch + lockStakingTier.stakingLength
              )
            );

            const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = lockStakingTier.stakingLength;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(newCurrentEpoch + 1n)
            );

            const setRewardsEpoch = await meldStakingStorage.getCurrentEpoch();

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            // Increase time another 5
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(setRewardsEpoch + 5n)
            );

            const untilEpoch = await meldStakingStorage.getCurrentEpoch();

            // Operator updates rewards
            await meldStakingCommon
              .connect(operator)
              .updateUnclaimedRewards(operatorTokenId);

            // Delegator updates rewards
            await meldStakingCommon
              .connect(delegator)
              .updateUnclaimedRewards(delegatorTokenId);

            // Calculate expected rewards
            const expectedOperatorRewards = await calculateRewards(
              meldStakingStorage,
              operatorTokenId,
              startEpoch,
              untilEpoch
            );

            const expectedDelegatorRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              startEpoch,
              untilEpoch
            );

            // Check operator and delegator rewards
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                operatorTokenId
              )
            ).to.equal(expectedOperatorRewards);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                operatorTokenId
              )
            ).to.equal(lockStakingTier.stakingLength);

            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(expectedDelegatorRewards);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                delegatorTokenId
              )
            ).to.equal(lockStakingTier.stakingLength);
          });

          it("Should not update state again if update has already been done through current epoch", async function () {
            const {
              deployer,
              operator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
            } = await loadFixture(nodeStakedFixture);
            const startEpoch = await meldStakingStorage.getCurrentEpoch();

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            await meldStakingCommon
              .connect(operator)
              .updateUnclaimedRewards(operatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              operatorTokenId,
              startEpoch,
              currentEpoch
            );

            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                operatorTokenId
              )
            ).to.equal(expectedRewards);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                operatorTokenId
              )
            ).to.equal(currentEpoch);

            // Operator updates rewards again
            await meldStakingCommon
              .connect(operator)
              .updateUnclaimedRewards(operatorTokenId);

            // Values should be the same
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                operatorTokenId
              )
            ).to.equal(expectedRewards);
            expect(
              await meldStakingStorage.getStakerLastEpochRewardsUpdated(
                operatorTokenId
              )
            ).to.equal(currentEpoch);
          });
        }); // End of Locked Staking
      }); // End of Happy Flow Test Cases

      context("Error Test Cases", function () {
        it("Should revert if operator updates after leaving node (node does not exist)", async function () {
          const {
            operator,
            meldStakingOperator,
            meldStakingStorage,
            meldStakingCommon,
            operatorTokenId,
          } = await loadFixture(nodeStakedFixture);
          const startEpoch = await meldStakingStorage.getCurrentEpoch();

          // Advance time by 20 epochs
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(startEpoch + 20n)
          );

          const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

          // Operator leaves node.
          meldStakingOperator.connect(operator).leaveNode(operatorTokenId);

          // Increase time another 10 epochs
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(newCurrentEpoch + 10n)
          );

          await expect(
            meldStakingCommon
              .connect(operator)
              .updateUnclaimedRewards(operatorTokenId)
          ).to.be.revertedWith(Errors.STAKER_DOES_NOT_EXIST);
        });

        it("Should revert if nftId does not exist", async function () {
          const { operator, meldStakingCommon, operatorTokenId } =
            await loadFixture(nodeStakedFixture);

          await expect(
            meldStakingCommon
              .connect(operator)
              .updateUnclaimedRewards(operatorTokenId + 5n)
          ).to.be.revertedWith(Errors.STAKER_DOES_NOT_EXIST);
        });

        it("Should revert if nftId is 0", async function () {
          const { operator, meldStakingCommon } = await loadFixture(
            nodeStakedFixture
          );

          await expect(
            meldStakingCommon.connect(operator).updateUnclaimedRewards(0n)
          ).to.be.revertedWith(Errors.STAKER_DOES_NOT_EXIST);
        });
      }); // End of Error Test Cases
    }); // End of updateUnclaimedRewards(uint256 _nftId)

    context("claimRewards(uint256 _nftId)", function () {
      context("Happy Flow Test Cases", function () {
        context("Liquid Staking", function () {
          it("Should emit RewardsClaimed event correctly", async function () {
            const {
              deployer,
              operator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
            } = await loadFixture(nodeStakedFixture);

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            // Operator claims rewards
            const claimTx = meldStakingCommon
              .connect(operator)
              ["claimRewards(uint256)"](operatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              operatorTokenId,
              1n,
              currentEpoch
            );

            await expect(claimTx)
              .to.emit(meldStakingCommon, "RewardsClaimed")
              .withArgs(operatorTokenId, expectedRewards);
          });

          it("Should not emit  RewardsClaimed event if unlcaimed rewards == 0", async function () {
            const { operator, meldStakingCommon, operatorTokenId } =
              await loadFixture(nodeStakedFixture);

            // There should be no rewards in epoch 1
            await expect(
              meldStakingCommon
                .connect(operator)
                ["claimRewards(uint256)"](operatorTokenId)
            ).to.not.emit(meldStakingCommon, "RewardsClaimed");
          });

          it("Should update state correctly", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
            } = await loadFixture(delegatorStakedFixture);

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            const delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            expect(
              await meldStakingStorage.getStakerCumulativeRewards(
                delegatorTokenId
              )
            ).to.equal(0n);

            // Delegator claims rewards
            await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              1n,
              currentEpoch
            );

            // Check state
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getStakerCumulativeRewards(
                delegatorTokenId
              )
            ).to.equal(expectedRewards);
          });

          it("Should maintain same state if staker claims rewards a second time in same epoch", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
            } = await loadFixture(delegatorStakedFixture);

            // Advance time by several epoch
            await time.increaseTo(await meldStakingStorage.getEpochStart(10n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 10n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            const delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            // Delegator claims rewards first time
            await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              1n,
              currentEpoch
            );

            // Check state after first time
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);

            // Delegator claims rewards second time in same epoch
            await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Check state
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);
          });

          it("Should update state state correctly if staker claims rewards a second time several epochs later", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
            } = await loadFixture(delegatorStakedFixture);

            // Advance time by several epoch
            await time.increaseTo(await meldStakingStorage.getEpochStart(10n));

            const firstCurrentEpoch =
              await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            let initialRewardAmount = toMeldDecimals(100_000);
            let amountIncrease = toMeldDecimals(10_000);

            let rewardAmounts = [];
            let numEpochs = 10n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            let lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(firstCurrentEpoch + 1n)
            );

            const setRewardsEpoch = await meldStakingStorage.getCurrentEpoch();

            let firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            let meldStakingNFTAddress = await meldStakingNFT.getAddress();
            let meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            let delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            // Delegator claims rewards first time
            await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            let expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              1n,
              firstCurrentEpoch
            );

            // Check state after first time
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);

            // Advance time by several more epochs
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(setRewardsEpoch + 10n)
            );
            const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards again
            initialRewardAmount = toMeldDecimals(200_000);
            amountIncrease = toMeldDecimals(20_000);

            rewardAmounts = [];
            numEpochs = 10n;
            sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(newCurrentEpoch + 1n)
            );

            firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            meldStakingNFTAddress = await meldStakingNFT.getAddress();
            meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            // Delegator claims rewards first time
            await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              firstCurrentEpoch + 1n,
              newCurrentEpoch + 1n
            );

            // Check state
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);
          });

          it("Should update state correctly for operator if node has been fully slashed", async function () {
            const {
              deployer,
              operator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
              nodeId,
            } = await loadFixture(delegatorStakedFixture);

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            // Slash node
            await meldStakingConfig.slashNode(nodeId, 100_00n);
            const slashNodeEpoch = await meldStakingStorage.getCurrentEpoch();

            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            const operatorBalanceBefore = await meldToken.balanceOf(
              operator.address
            );

            // Operator claims rewards
            const claimTX = await meldStakingCommon
              .connect(operator)
              ["claimRewards(uint256)"](operatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              operatorTokenId,
              1n,
              slashNodeEpoch
            );

            // Check that Redeem event is emitted by the NFT contract
            await expect(claimTX)
              .to.emit(meldStakingNFT, "Redeemed")
              .withArgs(operator.address, operatorTokenId);

            // Check state
            expect(await meldToken.balanceOf(operator.address)).to.equal(
              operatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                operatorTokenId
              )
            ).to.equal(0n);
            expect(await meldStakingStorage.isStaker(operatorTokenId)).to.equal(
              false
            );
            expect(
              await meldStakingStorage.isOperator(operatorTokenId)
            ).to.equal(false);
          });

          it("Should update state correctly for operator if node has been partially slashed", async function () {
            const {
              deployer,
              operator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
              nodeId,
            } = await loadFixture(delegatorStakedFixture);

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            // Slash node 30%
            await meldStakingConfig.slashNode(nodeId, 30_00n);
            const slashNodeEpoch = await meldStakingStorage.getCurrentEpoch();

            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            const operatorBalanceBefore = await meldToken.balanceOf(
              operator.address
            );

            // Operator claims rewards
            const claimTX = await meldStakingCommon
              .connect(operator)
              ["claimRewards(uint256)"](operatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              operatorTokenId,
              1n,
              slashNodeEpoch
            );

            // Check that Redeem event is emitted by the NFT contract
            await expect(claimTX)
              .to.emit(meldStakingNFT, "Redeemed")
              .withArgs(operator.address, operatorTokenId);

            // Check state
            expect(await meldToken.balanceOf(operator.address)).to.equal(
              operatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                operatorTokenId
              )
            ).to.equal(0n);
            expect(await meldStakingStorage.isStaker(operatorTokenId)).to.equal(
              false
            );
            expect(
              await meldStakingStorage.isOperator(operatorTokenId)
            ).to.equal(false);
          });

          it("Should update state correctly for delegator if node has been slashed and node has one delegator", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
              nodeId,
            } = await loadFixture(delegatorStakedFixture);

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            // Get node delegators
            const nodeDelegatorsBefore: bigint[] =
              await meldStakingStorage.getNodeDelegators(nodeId);

            expect(nodeDelegatorsBefore.includes(delegatorTokenId)).to.equal(
              true
            );

            // Slash node
            await meldStakingConfig.slashNode(nodeId, 100_00n);
            const slashNodeEpoch = await meldStakingStorage.getCurrentEpoch();

            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            const delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            // Delegator claims rewards
            const claimTX = await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              1n,
              slashNodeEpoch
            );

            const nodeDelegatorsAfter: bigint[] =
              await meldStakingStorage.getNodeDelegators(nodeId);

            // Check that Redeem event is emitted by the NFT contract
            await expect(claimTX)
              .to.emit(meldStakingNFT, "Redeemed")
              .withArgs(delegator.address, delegatorTokenId);

            // Check state
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.isStaker(delegatorTokenId)
            ).to.equal(false);
            expect(
              await meldStakingStorage.isDelegator(delegatorTokenId)
            ).to.equal(false);
            expect(nodeDelegatorsAfter.includes(delegatorTokenId)).to.equal(
              false
            );
          });

          it("Should update state correctly for delegator if node has been slashed and node has two delegators", async function () {
            const {
              deployer,
              delegator,
              delegator2,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingDelegator,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
              nodeId,
              liquidStakingTierId,
            } = await loadFixture(delegatorStakedFixture);

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // A delegator2 stakes the operator's node
            const delegatorBaseStakeAmount2 = toMeldDecimals(2000);

            // Delegator stakes node
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator2,
              delegatorBaseStakeAmount2,
              nodeId,
              liquidStakingTierId
            );

            const delegator2TokenId = await meldStakingNFT.getTotalMintedNfts();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            // Get node delegators
            const nodeDelegatorsBefore: bigint[] =
              await meldStakingStorage.getNodeDelegators(nodeId);

            expect(nodeDelegatorsBefore.includes(delegatorTokenId)).to.equal(
              true
            );

            // Slash node
            await meldStakingConfig.slashNode(nodeId, 100_00n);
            const slashNodeEpoch = await meldStakingStorage.getCurrentEpoch();

            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            const delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            // Delegator claims rewards
            const claimTX = await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              1n,
              slashNodeEpoch
            );

            const nodeDelegatorsAfter: bigint[] =
              await meldStakingStorage.getNodeDelegators(nodeId);

            // Check that Redeem event is emitted by the NFT contract
            await expect(claimTX)
              .to.emit(meldStakingNFT, "Redeemed")
              .withArgs(delegator.address, delegatorTokenId);

            // Check state
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.isStaker(delegatorTokenId)
            ).to.equal(false);
            expect(
              await meldStakingStorage.isDelegator(delegatorTokenId)
            ).to.equal(false);
            expect(nodeDelegatorsAfter.includes(delegatorTokenId)).to.equal(
              false
            );
            expect(nodeDelegatorsAfter.includes(delegator2TokenId)).to.equal(
              true
            );
          });

          it("Should let a delegator claim rewards from a partially slashed node but the NFT won't be redeemed", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
              nodeId,
            } = await loadFixture(delegatorStakedFixture);

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            // Get node delegators
            const nodeDelegatorsBefore: bigint[] =
              await meldStakingStorage.getNodeDelegators(nodeId);

            expect(nodeDelegatorsBefore.includes(delegatorTokenId)).to.equal(
              true
            );

            // Slash node partially (30%)
            await meldStakingConfig.slashNode(nodeId, 30_00n);
            const slashNodeEpoch = await meldStakingStorage.getCurrentEpoch();

            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            const delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            // Delegator claims rewards
            const claimTX = await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              1n,
              slashNodeEpoch
            );

            const nodeDelegatorsAfter: bigint[] =
              await meldStakingStorage.getNodeDelegators(nodeId);

            // Check that Redeem event is not emitted by the NFT contract
            await expect(claimTX).not.to.emit(meldStakingNFT, "Redeemed");

            // Check state
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.isStaker(delegatorTokenId)
            ).to.be.true;
            expect(
              await meldStakingStorage.isDelegator(delegatorTokenId)
            ).to.be.true;
            expect(nodeDelegatorsAfter.includes(delegatorTokenId)).to.be.true;
            expect(await meldStakingNFT.balanceOf(delegator.address)).to.equal(
              1n
            );
          });
        }); // End of Liquid Staking

        context("Locked Staking", function () {
          // A subset of test cases to make sure the claimRewards function works for locked staking
          it("Should emit RewardsClaimed event correctly", async function () {
            const {
              deployer,
              operator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              operatorTokenId,
            } = await loadFixture(nodeLockStakedFixture);

            // Advance time by many epochs
            await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 50n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            // Operator claims rewards
            const claimTx = meldStakingCommon
              .connect(operator)
              ["claimRewards(uint256)"](operatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              operatorTokenId,
              1n,
              currentEpoch
            );

            await expect(claimTx)
              .to.emit(meldStakingCommon, "RewardsClaimed")
              .withArgs(operatorTokenId, expectedRewards);
          });

          it("Should update state correctly even if lock period has not ended", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
            } = await loadFixture(delegatorLockStakedFixture);

            // Advance time to epoch 9
            await time.increaseTo(await meldStakingStorage.getEpochStart(9n));
            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 9n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            const delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            // Delegator claims rewards
            await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              1n,
              currentEpoch
            );

            // Check state
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);
          });

          it("Should update state correctly if lock period has ended", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
            } = await loadFixture(delegatorLockStakedFixture);

            // Advance time to epoch 25 (past lock period end)
            await time.increaseTo(await meldStakingStorage.getEpochStart(25n));
            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            const initialRewardAmount = toMeldDecimals(100_000);
            const amountIncrease = toMeldDecimals(10_000);

            const rewardAmounts = [];
            const numEpochs = 25n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            const lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(currentEpoch + 1n)
            );

            const firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            const delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            // Operator claims rewards
            await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              1n,
              currentEpoch
            );

            // Check state
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);
          });

          it("Should update state state correctly if staker claims rewards a second time after lock period end", async function () {
            const {
              deployer,
              delegator,
              rewardsSetter,
              meldStakingStorage,
              meldStakingCommon,
              meldStakingConfig,
              meldStakingNFT,
              meldToken,
              delegatorTokenId,
            } = await loadFixture(delegatorLockStakedFixture);

            // Advance time by several epoch
            await time.increaseTo(await meldStakingStorage.getEpochStart(10n));

            const firstCurrentEpoch =
              await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards
            let initialRewardAmount = toMeldDecimals(100_000);
            let amountIncrease = toMeldDecimals(10_000);

            let rewardAmounts = [];
            let numEpochs = 10n;
            let sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            let lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(firstCurrentEpoch + 1n)
            );

            const setRewardsEpoch = await meldStakingStorage.getCurrentEpoch();

            let firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            let meldStakingNFTAddress = await meldStakingNFT.getAddress();
            let meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            let delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            // Delegator claims rewards first time
            await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            let expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              1n,
              firstCurrentEpoch
            );

            // Check state after first time
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);

            // Advance time by several more epochs (past lock end period)
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(setRewardsEpoch + 10n)
            );
            const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Rewards setter sets rewards again
            initialRewardAmount = toMeldDecimals(200_000);
            amountIncrease = toMeldDecimals(20_000);

            rewardAmounts = [];
            numEpochs = 10n;
            sumRewards = 0n;
            for (let i = 0n; i < numEpochs; i++) {
              const amount = initialRewardAmount + amountIncrease * i;
              rewardAmounts.push(amount);
              sumRewards += amount;
            }

            await transferAndApproveTokens(
              meldToken,
              deployer,
              rewardsSetter,
              await meldStakingNFT.getAddress(),
              sumRewards
            );

            lastEpochRewardsUpdated =
              await meldStakingStorage.getLastEpochRewardsUpdated();

            // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
            await time.increaseTo(
              await meldStakingStorage.getEpochStart(newCurrentEpoch + 1n)
            );

            firstEpoch = lastEpochRewardsUpdated + 1n;
            for (let index = 0; index < rewardAmounts.length - 1; index++) {
              const epoch = firstEpoch + BigInt(index);
              await meldStakingConfig
                .connect(rewardsSetter)
                .setRewards(rewardAmounts[index], epoch);
              expect(
                await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
              ).to.equal(rewardAmounts[index]);
            }

            meldStakingNFTAddress = await meldStakingNFT.getAddress();
            meldStakingNFTBalanceBefore = await meldToken.balanceOf(
              meldStakingNFTAddress
            );
            delegatorBalanceBefore = await meldToken.balanceOf(
              delegator.address
            );

            // Delegator claims rewards first time
            await meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](delegatorTokenId);

            // Calculate expected rewards
            expectedRewards = await calculateRewards(
              meldStakingStorage,
              delegatorTokenId,
              firstCurrentEpoch + 1n,
              newCurrentEpoch + 1n
            );

            // Check state
            expect(await meldToken.balanceOf(delegator.address)).to.equal(
              delegatorBalanceBefore + expectedRewards
            );
            expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
              meldStakingNFTBalanceBefore - expectedRewards
            );
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(
                delegatorTokenId
              )
            ).to.equal(0n);
          });
        });
      }); // End of Happy Flow Test Cases

      context("Error Test Cases", function () {
        it("Should revert if nftId does not exist", async function () {
          const { operator, meldStakingCommon, operatorTokenId } =
            await loadFixture(nodeStakedFixture);

          const expectedException = `ERC721: invalid token ID`;

          await expect(
            meldStakingCommon
              .connect(operator)
              ["claimRewards(uint256)"](operatorTokenId + 5n)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if nftId is 0", async function () {
          const { operator, meldStakingCommon } = await loadFixture(
            nodeStakedFixture
          );

          const expectedException = `ERC721: invalid token ID`;

          await expect(
            meldStakingCommon.connect(operator)["claimRewards(uint256)"](0n)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if caller is not NFT owner", async function () {
          const { delegator, meldStakingCommon, operatorTokenId } =
            await loadFixture(nodeStakedFixture);

          await expect(
            meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256)"](operatorTokenId)
          ).to.be.revertedWith(Errors.NOT_NFT_OWNER);
        });

        it("Should revert if staking has not started", async function () {
          const { delegator, meldStakingCommon } = await loadFixture(
            deployAndConfigContractsDelayedStakingStartFixture
          );

          await expect(
            meldStakingCommon.connect(delegator)["claimRewards(uint256)"](1n)
          ).to.be.revertedWith(Errors.STAKING_NOT_STARTED);
        });

        it("Should revert if staker calls function again after having been removed (node slashed)", async function () {
          const {
            deployer,
            operator,
            rewardsSetter,
            meldStakingStorage,
            meldStakingCommon,
            meldStakingConfig,
            meldStakingNFT,
            meldToken,
            operatorTokenId,
            nodeId,
          } = await loadFixture(delegatorStakedFixture);

          // Advance time by many epochs
          await time.increaseTo(await meldStakingStorage.getEpochStart(50n));

          const currentEpoch = await meldStakingStorage.getCurrentEpoch();

          // Rewards setter sets rewards
          const initialRewardAmount = toMeldDecimals(100_000);
          const amountIncrease = toMeldDecimals(10_000);

          const rewardAmounts = [];
          const numEpochs = 50n;
          let sumRewards = 0n;
          for (let i = 0n; i < numEpochs; i++) {
            const amount = initialRewardAmount + amountIncrease * i;
            rewardAmounts.push(amount);
            sumRewards += amount;
          }

          await transferAndApproveTokens(
            meldToken,
            deployer,
            rewardsSetter,
            await meldStakingNFT.getAddress(),
            sumRewards
          );

          const lastEpochRewardsUpdated =
            await meldStakingStorage.getLastEpochRewardsUpdated();

          // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(currentEpoch + 1n)
          );

          const firstEpoch = lastEpochRewardsUpdated + 1n;
          for (let index = 0; index < rewardAmounts.length - 1; index++) {
            const epoch = firstEpoch + BigInt(index);
            await meldStakingConfig
              .connect(rewardsSetter)
              .setRewards(rewardAmounts[index], epoch);
            expect(
              await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
            ).to.equal(rewardAmounts[index]);
          }

          // Slash node
          await meldStakingConfig.slashNode(nodeId, 100_00n);

          // Operator claims rewards
          await meldStakingCommon
            .connect(operator)
            ["claimRewards(uint256)"](operatorTokenId);

          expect(await meldStakingStorage.isStaker(operatorTokenId)).to.equal(
            false
          );

          const expectedException = `ERC721: invalid token ID`;

          // Operator claims rewards again
          await expect(
            meldStakingCommon
              .connect(operator)
              ["claimRewards(uint256)"](operatorTokenId)
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases
    }); // End of claimRewards(uint256 _nftId)

    context("claimRewards(uint256[] memory _nftIds)", function () {
      context("Happy Flow Test Cases", function () {
        it("Should not update state if nftIds array is empty", async function () {
          const {
            deployer,
            delegator,
            rewardsSetter,
            meldStakingStorage,
            meldStakingCommon,
            meldStakingConfig,
            meldStakingNFT,
            meldToken,
            delegatorTokenId,
          } = await loadFixture(delegatorStakedFixture);

          // Advance time by many epochs
          await time.increaseTo(await meldStakingStorage.getEpochStart(5n));

          const currentEpoch = await meldStakingStorage.getCurrentEpoch();

          // Rewards setter sets rewards
          const initialRewardAmount = toMeldDecimals(500_000);
          const amountIncrease = toMeldDecimals(5_000);

          const rewardAmounts = [];
          const numEpochs = 5n;
          let sumRewards = 0n;
          for (let i = 0n; i < numEpochs; i++) {
            const amount = initialRewardAmount + amountIncrease * i;
            rewardAmounts.push(amount);
            sumRewards += amount;
          }

          await transferAndApproveTokens(
            meldToken,
            deployer,
            rewardsSetter,
            await meldStakingNFT.getAddress(),
            sumRewards
          );

          const lastEpochRewardsUpdated =
            await meldStakingStorage.getLastEpochRewardsUpdated();

          // Advance by one more epoch to next epoch so that rewards can be set up through current epoch
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(currentEpoch + 1n)
          );

          const firstEpoch = lastEpochRewardsUpdated + 1n;
          for (let index = 0; index < rewardAmounts.length - 1; index++) {
            const epoch = firstEpoch + BigInt(index);
            await meldStakingConfig
              .connect(rewardsSetter)
              .setRewards(rewardAmounts[index], epoch);
            expect(
              await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
            ).to.equal(rewardAmounts[index]);
          }

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
            meldStakingNFTAddress
          );
          const delegatorBalanceBefore = await meldToken.balanceOf(
            delegator.address
          );

          // Delegator claims rewards
          await meldStakingCommon
            .connect(delegator)
            ["claimRewards(uint256[])"]([]);

          // Calculate expected rewards
          const expectedRewards = await calculateRewards(
            meldStakingStorage,
            delegatorTokenId,
            1n,
            currentEpoch
          );

          const meldStakingNFTBalanceAfter = await meldToken.balanceOf(
            meldStakingNFTAddress
          );
          const delegatorBalanceAfter = await meldToken.balanceOf(
            delegator.address
          );

          // Check state
          expect(meldStakingNFTBalanceAfter).to.equal(
            meldStakingNFTBalanceBefore
          );
          expect(delegatorBalanceAfter).to.equal(delegatorBalanceBefore);
          expect(
            await meldStakingStorage.getStakerUnclaimedRewards(delegatorTokenId)
          ).to.equal(expectedRewards);
        });

        it("Should update state correctly for all NFT Ids in _nftIds array", async function () {
          const {
            deployer,
            operator,
            meldStakingConfig,
            meldStakingCommon,
            meldStakingStorage,
            meldStakingOperator,
            meldStakingNFT,
            meldToken,
            tierOneId,
          } = await loadFixture(stakingStartedFixture);

          let nodeId: string;
          let nftId: bigint;
          const nftIds: bigint[] = [];
          const delegatorFee = 5_00; // 5%
          const operatorBaseStakeAmount = toMeldDecimals(2_000_000);
          const metadata = "";

          // Generate multipl staking positions for the same operator
          for (let i = 0; i < 5; i++) {
            // Params for the node request
            const nodeName = `testNode${i}`;

            // Operator approves the NFT staking contract to be able to deposit the stake and requests node
            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              operatorBaseStakeAmount,
              tierOneId,
              metadata
            );

            nftId = await meldStakingNFT.getTotalMintedNfts();
            nftIds.push(nftId);

            // Node id is the hash of the node name
            nodeId = await meldStakingOperator.hashNodeId(nodeName);
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
          }

          // Advance time past when lock period ends (epoch 12)
          const startEpoch = await meldStakingStorage.getCurrentEpoch();

          await time.increaseTo(
            await meldStakingStorage.getEpochStart(startEpoch + 15n)
          );

          const untilEpoch = await meldStakingStorage.getCurrentEpoch();

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
            meldStakingNFTAddress
          );
          const operatorBalanceBefore = await meldToken.balanceOf(
            operator.address
          );

          // Operator calls the claimRewards, passing all nftIds
          await meldStakingCommon
            .connect(operator)
            ["claimRewards(uint256[])"](nftIds);

          let sumExpectedRewards: bigint = 0n;
          for (const nftId of nftIds) {
            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              nftId,
              startEpoch,
              untilEpoch
            );

            sumExpectedRewards += expectedRewards;

            // Check state of each NFT
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(nftId)
            ).to.equal(0n);
          } // End of for loop

          // Check state
          expect(await meldToken.balanceOf(operator.address)).to.equal(
            operatorBalanceBefore + sumExpectedRewards
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            meldStakingNFTBalanceBefore - sumExpectedRewards
          );
        });
      }); // End of Happy Flow Test Cases

      context("Error Test Cases", function () {
        it("Should revert if one of the nftIds does not exist", async function () {
          const { delegator, meldStakingCommon, delegatorTokenId } =
            await loadFixture(delegatorStakedFixture);
          const nftIds: bigint[] = [];
          nftIds.push(delegatorTokenId);
          nftIds.push(delegatorTokenId + 20n);

          const expectedException = `ERC721: invalid token ID`;

          await expect(
            meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256[])"](nftIds)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if caller is not NFT owner of all NFTs", async function () {
          const {
            delegator,
            meldStakingCommon,
            delegatorTokenId,
            operatorTokenId,
          } = await loadFixture(delegatorStakedFixture);

          const nftIds: bigint[] = [];
          nftIds.push(delegatorTokenId);
          nftIds.push(operatorTokenId);

          await expect(
            meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256[])"](nftIds)
          ).to.be.revertedWith(Errors.NOT_NFT_OWNER);
        });

        it("Should revert if staking has not started", async function () {
          const { delegator, meldStakingCommon } = await loadFixture(
            deployAndConfigContractsDelayedStakingStartFixture
          );

          await expect(
            meldStakingCommon
              .connect(delegator)
              ["claimRewards(uint256[])"]([1n, 2n])
          ).to.be.revertedWith(Errors.STAKING_NOT_STARTED);
        });
      }); // End of Error Test Cases
    }); // End of claimRewards(uint256[] memory _nftIds)

    context("claimAllMyRewards", function () {
      context("Happy Flow Test Cases", function () {
        it("Should update all awards for a staker address", async function () {
          const {
            deployer,
            delegator,
            meldStakingCommon,
            meldStakingStorage,
            meldStakingDelegator,
            meldStakingNFT,
            meldToken,
            tierOneId,
            nodeId,
            node2Id,
          } = await loadFixture(nodeLockStakedFixture);

          let nftId: bigint;
          const nftIds: bigint[] = [];
          const liquidStakingTierId = 0n;

          const amount = toMeldDecimals(200_000);

          // Generate multiple liquid staking positions for the same delegator
          for (let i = 0; i < 5; i++) {
            const delegatorBaseStakeAmount = amount * BigInt(i + 1);

            // Delegator stakes node
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              delegatorBaseStakeAmount,
              nodeId,
              liquidStakingTierId
            );

            nftId = await meldStakingNFT.getTotalMintedNfts();
            nftIds.push(nftId);
          }

          // Generate multiple locked staking positions for the same delegator
          for (let i = 0; i < 5; i++) {
            const delegatorBaseStakeAmount = amount * BigInt(i + 1);

            // Delegator stakes node
            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              delegatorBaseStakeAmount,
              node2Id,
              tierOneId
            );

            nftId = await meldStakingNFT.getTotalMintedNfts();
            nftIds.push(nftId);
          }

          // Advance time past when lock period ends
          const startEpoch = await meldStakingStorage.getCurrentEpoch();

          await time.increaseTo(
            await meldStakingStorage.getEpochStart(startEpoch + 20n)
          );

          const untilEpoch = await meldStakingStorage.getCurrentEpoch();

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
            meldStakingNFTAddress
          );
          const delegatorBalanceBefore = await meldToken.balanceOf(
            delegator.address
          );

          // Operator calls the claimRewards, passing all nftIds
          await meldStakingCommon.connect(delegator)["claimAllMyRewards()"]();

          let sumExpectedRewards: bigint = 0n;
          for (const nftId of nftIds) {
            // Calculate expected rewards
            const expectedRewards = await calculateRewards(
              meldStakingStorage,
              nftId,
              startEpoch,
              untilEpoch
            );

            sumExpectedRewards += expectedRewards;

            // Check state of each NFT
            expect(
              await meldStakingStorage.getStakerUnclaimedRewards(nftId)
            ).to.equal(0n);
          } // End of for loop

          // Check state
          expect(await meldToken.balanceOf(delegator.address)).to.equal(
            delegatorBalanceBefore + sumExpectedRewards
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            meldStakingNFTBalanceBefore - sumExpectedRewards
          );
        });
      }); // End of Happy Flow Test Cases

      context("Error Test Cases", function () {
        it("Should revert if called by user who has no staking positions", async function () {
          const { rando, meldStakingCommon } = await loadFixture(
            delegatorStakedFixture
          );

          await expect(
            meldStakingCommon.connect(rando)["claimAllMyRewards()"]()
          ).to.be.revertedWith(Errors.NO_STAKING_POSITIONS);
        });
      }); // End of Error Test Cases
    }); // End of claimAllMyRewards
  }); // End of User Functions
}); // End of MeldStakingCommon contract - User Functions
