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

describe("MeldStakingAddressProvider", function () {
  // Deploy the contracts and initialize them
  async function deployAndInitializeFixture() {
    const [deployer, operator, delegator1, delegator2, slashReceiver] =
      await ethers.getSigners();
    const initTimestamp = (await time.latest()) + 1000;
    const epochSize = 5 * 24 * 60 * 60; // 5 days
    const contracts = await deployAndConfigContracts(
      deployer.address,
      initTimestamp,
      epochSize,
      slashReceiver.address
    );
    await time.increaseTo(initTimestamp + 1);
    return {
      deployer,
      operator,
      delegator1,
      delegator2,
      initTimestamp,
      epochSize,
      ...contracts,
    };
  }

  async function workingNodeFixture() {
    const initFixtureVars = await loadFixture(deployAndInitializeFixture);
    const {
      deployer,
      operator,
      meldStakingConfig,
      meldStakingOperator,
      meldStakingNFT,
      meldToken,
    } = initFixtureVars;

    // REQUEST NODE

    // Params for the node request
    const nodeName = "testNode";
    const delegatorFee = 10_00n; // 10%
    const amount = toMeldDecimals(200_000); // 200k MELD
    const metadata = "";

    await requestNode(
      meldToken,
      meldStakingOperator,
      meldStakingNFT,
      deployer,
      operator,
      nodeName,
      delegatorFee,
      amount,
      0,
      metadata
    );

    // Node id is the hash of the node name
    const nodeId = await meldStakingOperator.hashNodeId(nodeName);

    const operatorNFT = await meldStakingNFT.getTotalMintedNfts();

    // Admin approves the node request
    await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

    return {
      nodeId,
      operatorNFT,
      ...initFixtureVars,
    };
  }

  context("Only one operator with lock tier stake position", function () {
    it("Should not fail if a node is slashed with excess weight", async function () {
      const {
        deployer,
        operator,
        meldStakingConfig,
        meldStakingCommon,
        meldStakingOperator,
        meldStakingStorage,
        meldStakingNFT,
        meldToken,
      } = await loadFixture(deployAndInitializeFixture);

      // Add a staking tier
      const minStakingAmount = toMeldDecimals(110_000);
      const stakingLength = 10n; // 10 epochs
      const weight = 120_00n; // 120%
      await meldStakingConfig.addStakingLockTier(
        minStakingAmount,
        stakingLength,
        weight
      );

      // REQUEST NODE

      // Params for the node request
      const nodeName = "testNode";
      const delegatorFee = 10_00n; // 10%
      const amount = toMeldDecimals(200_000); // 200k MELD
      const lockTierId = await meldStakingStorage.lastLockStakingTierId();
      const metadata = "";

      await requestNode(
        meldToken,
        meldStakingOperator,
        meldStakingNFT,
        deployer,
        operator,
        nodeName,
        delegatorFee,
        amount,
        lockTierId,
        metadata
      );

      // Node id is the hash of the node name
      const nodeId = await meldStakingOperator.hashNodeId(nodeName);

      // Admin approves the node request
      await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

      // Slash the node
      await meldStakingConfig.connect(deployer).slashNode(nodeId, 100_00n);

      await time.increase(
        stakingLength * 2n * (await meldStakingStorage.getEpochSize())
      );

      const currentEpoch = await meldStakingStorage.getCurrentEpoch();

      // When updating the global state, it will uderflow, since only one node was staked and was slashed
      // And when updating in the epoch when the staker would change from locked to liquid, it will try to
      // subtract the excess weight (20% of 200k MELD) which was already removed in the slash
      await expect(
        meldStakingCommon.updateGlobalPreviousEpochs(currentEpoch)
      ).not.to.be.reverted;
    });
  }); // End of context Basic checks

  context("Delegators with lock tier stake position", function () {
    it("Should get the correct values for one delegator", async function () {
      const {
        deployer,
        delegator1,
        nodeId,
        meldStakingConfig,
        meldStakingDelegator,
        meldStakingStorage,
        meldStakingNFT,
        meldToken,
      } = await loadFixture(workingNodeFixture);

      // Add a staking tier
      const minStakingAmount = 0n;
      const stakingLength = 10n; // 10 epochs
      const weight = 120_00n; // 120%
      await meldStakingConfig.addStakingLockTier(
        minStakingAmount,
        stakingLength,
        weight
      );

      // Stake
      const amount = toMeldDecimals(100_000);
      const lockTierId = await meldStakingStorage.lastLockStakingTierId();

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator1,
        amount,
        nodeId,
        lockTierId
      );

      const currentEpoch = await meldStakingStorage.getCurrentEpoch();

      // Get node excess weight epochs array
      const nodeExcessWeightEpochs =
        await meldStakingStorage.getNodeLockingExcessWeightEpochs(nodeId);

      const endEpoch = currentEpoch + stakingLength + 1n;

      expect(nodeExcessWeightEpochs).to.eql([endEpoch]);

      const globalExcessWeightBeforeSlash =
        await meldStakingStorage.getLockingExcessWeightedStakePerEpoch(
          endEpoch
        );

      expect(globalExcessWeightBeforeSlash).to.equal(
        (amount * (weight - PERCENTAGE_SCALING)) / PERCENTAGE_SCALING
      );

      // Slash the node

      await meldStakingConfig.connect(deployer).slashNode(nodeId, 100_00n);

      const globalExcessWeightAfterSlash =
        await meldStakingStorage.getLockingExcessWeightedStakePerEpoch(
          endEpoch
        );

      expect(globalExcessWeightAfterSlash).to.equal(0);
    });
    it("Should get the correct values for two delegators in order", async function () {
      const {
        deployer,
        delegator1,
        delegator2,
        nodeId,
        meldStakingConfig,
        meldStakingDelegator,
        meldStakingStorage,
        meldStakingNFT,
        meldToken,
      } = await loadFixture(workingNodeFixture);

      // Add a staking tier
      const minStakingAmount = 0n;
      const stakingLength = 10n; // 10 epochs
      const weight = 120_00n; // 120%
      await meldStakingConfig.addStakingLockTier(
        minStakingAmount,
        stakingLength,
        weight
      );

      const lockTierId = await meldStakingStorage.lastLockStakingTierId();

      let nodeExcessWeightEpochs: Array<bigint>;

      // Stake 1
      const amount1 = toMeldDecimals(100_000);

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator1,
        amount1,
        nodeId,
        lockTierId
      );

      const delegateEpoch1 = await meldStakingStorage.getCurrentEpoch();

      // Get node excess weight epochs array
      nodeExcessWeightEpochs =
        await meldStakingStorage.getNodeLockingExcessWeightEpochs(nodeId);

      const endEpoch1 = delegateEpoch1 + stakingLength + 1n;

      expect(nodeExcessWeightEpochs).to.eql([endEpoch1]);

      const globalExcessWeightBeforeSlash1 =
        await meldStakingStorage.getLockingExcessWeightedStakePerEpoch(
          endEpoch1
        );

      expect(globalExcessWeightBeforeSlash1).to.equal(
        (amount1 * (weight - PERCENTAGE_SCALING)) / PERCENTAGE_SCALING
      );

      // Wait for one epoch
      await time.increase(await meldStakingStorage.getEpochSize());

      // Stake 2
      const amount2 = toMeldDecimals(200_000);

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator2,
        amount2,
        nodeId,
        lockTierId
      );

      const delegateEpoch2 = await meldStakingStorage.getCurrentEpoch();

      // Get node excess weight epochs array
      nodeExcessWeightEpochs =
        await meldStakingStorage.getNodeLockingExcessWeightEpochs(nodeId);

      const endEpoch2 = delegateEpoch2 + stakingLength + 1n;

      expect(nodeExcessWeightEpochs).to.eql([endEpoch1, endEpoch2]);

      const globalExcessWeightBeforeSlash2 =
        await meldStakingStorage.getLockingExcessWeightedStakePerEpoch(
          endEpoch2
        );

      expect(globalExcessWeightBeforeSlash2).to.equal(
        (amount2 * (weight - PERCENTAGE_SCALING)) / PERCENTAGE_SCALING
      );

      // Slash the node

      await meldStakingConfig.connect(deployer).slashNode(nodeId, 100_00n);

      const globalExcessWeightAfterSlash =
        await meldStakingStorage.getLockingExcessWeightedStakePerEpoch(
          endEpoch1
        );

      expect(globalExcessWeightAfterSlash).to.equal(0);
    });
    it("Should get the correct values for two delegators out of order", async function () {
      const {
        deployer,
        delegator1,
        delegator2,
        nodeId,
        meldStakingConfig,
        meldStakingDelegator,
        meldStakingStorage,
        meldStakingNFT,
        meldToken,
      } = await loadFixture(workingNodeFixture);

      // Add a staking tier
      const minStakingAmount1 = 0n;
      const stakingLength1 = 10n; // 10 epochs
      const weight1 = 120_00n; // 120%
      await meldStakingConfig.addStakingLockTier(
        minStakingAmount1,
        stakingLength1,
        weight1
      );

      const lockTierId1 = await meldStakingStorage.lastLockStakingTierId();

      // Add another staking tier
      const minStakingAmount2 = 0n;
      const stakingLength2 = 7n; // 7 epochs
      const weight2 = 110_00n; // 110%
      await meldStakingConfig.addStakingLockTier(
        minStakingAmount2,
        stakingLength2,
        weight2
      );

      const lockTierId2 = await meldStakingStorage.lastLockStakingTierId();

      let nodeExcessWeightEpochs: Array<bigint>;

      // Stake 1
      const amount1 = toMeldDecimals(100_000);

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator1,
        amount1,
        nodeId,
        lockTierId1
      );

      const delegateEpoch1 = await meldStakingStorage.getCurrentEpoch();

      // Get node excess weight epochs array
      nodeExcessWeightEpochs =
        await meldStakingStorage.getNodeLockingExcessWeightEpochs(nodeId);

      const endEpoch1 = delegateEpoch1 + stakingLength1 + 1n;

      expect(nodeExcessWeightEpochs).to.eql([endEpoch1]);

      const globalExcessWeightBeforeSlash1 =
        await meldStakingStorage.getLockingExcessWeightedStakePerEpoch(
          endEpoch1
        );

      expect(globalExcessWeightBeforeSlash1).to.equal(
        (amount1 * (weight1 - PERCENTAGE_SCALING)) / PERCENTAGE_SCALING
      );

      // Stake 2
      const amount2 = toMeldDecimals(200_000);

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator2,
        amount2,
        nodeId,
        lockTierId2
      );

      const delegateEpoch2 = await meldStakingStorage.getCurrentEpoch();

      // Get node excess weight epochs array
      nodeExcessWeightEpochs =
        await meldStakingStorage.getNodeLockingExcessWeightEpochs(nodeId);

      const endEpoch2 = delegateEpoch2 + stakingLength2 + 1n;

      expect(endEpoch1).gt(endEpoch2);
      expect(nodeExcessWeightEpochs).to.eql([endEpoch1, endEpoch2]);

      const globalExcessWeightBeforeSlash2 =
        await meldStakingStorage.getLockingExcessWeightedStakePerEpoch(
          endEpoch2
        );

      expect(globalExcessWeightBeforeSlash2).to.equal(
        (amount2 * (weight2 - PERCENTAGE_SCALING)) / PERCENTAGE_SCALING
      );

      // Slash the node

      await meldStakingConfig.connect(deployer).slashNode(nodeId, 100_00n);

      const globalExcessWeightAfterSlash =
        await meldStakingStorage.getLockingExcessWeightedStakePerEpoch(
          endEpoch1
        );

      expect(globalExcessWeightAfterSlash).to.equal(0);
    });
    it.skip(
      "Should create one lock stake position each epoch for 5 years",
      async function () {
        const {
          deployer,
          delegator1,
          nodeId,
          meldStakingConfig,
          meldStakingDelegator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(workingNodeFixture);

        // Add a staking tier
        const minStakingAmount = 0n;
        const stakingLength = 365; // 365 epochs
        const weight = 120_00n; // 120%
        await meldStakingConfig.addStakingLockTier(
          minStakingAmount,
          stakingLength,
          weight
        );

        const lockTierId = await meldStakingStorage.lastLockStakingTierId();

        const amount = toMeldDecimals(1_000);
        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator1,
          await meldStakingNFT.getAddress(),
          BigInt(stakingLength) * amount
        );

        const numberOfPositions = stakingLength;
        // const numberOfPositions = 200;

        console.log("numberOfPositions: ", numberOfPositions);

        for (let i = 0; i < numberOfPositions; i++) {
          if (i % 20 == 0) console.log("i: ", i);
          // console.log("i: ", i);
          await meldStakingDelegator
            .connect(delegator1)
            .stake(amount, nodeId, lockTierId);

          await time.increase(await meldStakingStorage.getEpochSize());
        }

        const excessWeightEpochs =
          await meldStakingStorage.getNodeLockingExcessWeightEpochs(nodeId);

        expect(excessWeightEpochs.length).to.equal(numberOfPositions);

        // Slash the node

        const tx = await meldStakingConfig
          .connect(deployer)
          .slashNode(nodeId, 100_00n);

        const receipt = await tx.wait();

        console.log("Gas used to slash node:");
        console.log(receipt!.gasUsed.toString());
      }
    ).timeout(1000000);
  }); // End of context Delegators with lock tier stake position

  context("Change delegation", function () {
    it("Should be able to change delegation and keep track of the excess weight epochs correctly", async function () {
      const {
        deployer,
        operator,
        delegator1,
        nodeId,
        meldStakingConfig,
        meldStakingCommon,
        meldStakingOperator,
        meldStakingDelegator,
        meldStakingStorage,
        meldStakingNFT,
        meldToken,
      } = await loadFixture(workingNodeFixture);

      // Add a staking tier
      const minStakingAmount = 0n;
      const stakingLength = 10n; // 10 epochs
      const weight = 120_00n; // 120%
      await meldStakingConfig.addStakingLockTier(
        minStakingAmount,
        stakingLength,
        weight
      );

      // Stake
      const amount = toMeldDecimals(100_000);
      const lockTierId = await meldStakingStorage.lastLockStakingTierId();

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator1,
        amount,
        nodeId,
        lockTierId
      );

      const delegatorNFT = await meldStakingNFT.getTotalMintedNfts();

      const currentEpoch = await meldStakingStorage.getCurrentEpoch();

      // Get node excess weight epochs array
      const nodeExcessWeightEpochs =
        await meldStakingStorage.getNodeLockingExcessWeightEpochs(nodeId);

      const endEpoch = currentEpoch + stakingLength + 1n;

      expect(nodeExcessWeightEpochs).to.eql([endEpoch]);

      // Request a new node
      const nodeName = "testNode2";
      const delegatorFee = 10_00n; // 10%
      const amount2 = toMeldDecimals(200_000); // 200k MELD
      const metadata = "";

      await requestNode(
        meldToken,
        meldStakingOperator,
        meldStakingNFT,
        deployer,
        operator,
        nodeName,
        delegatorFee,
        amount2,
        lockTierId,
        metadata
      );

      const nodeId2 = await meldStakingOperator.hashNodeId(nodeName);

      // Admin approves the node request
      await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId2);

      // Change delegation
      await meldStakingDelegator
        .connect(delegator1)
        .changeDelegation(delegatorNFT, nodeId2);

      // Slash first node
      await meldStakingConfig.connect(deployer).slashNode(nodeId, 100_00n);

      // Slash second node
      await meldStakingConfig.connect(deployer).slashNode(nodeId2, 100_00n);

      // Advance time
      await time.increase(
        stakingLength * 2n * (await meldStakingStorage.getEpochSize())
      );

      // Update global state
      await expect(
        meldStakingCommon.updateGlobalPreviousEpochs(
          await meldStakingStorage.getCurrentEpoch()
        )
      ).not.to.be.reverted;
    });
  }); // End of context Change delegation
});
