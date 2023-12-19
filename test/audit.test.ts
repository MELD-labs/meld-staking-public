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
import { BigNumberish } from "ethers";
import { MeldStakingNFT, MeldStakingStorage } from "../typechain-types";

describe("Audit", function () {
  // Deploy the contracts and initialize them
  async function deployAndInitializeFixture() {
    const [deployer, slashReceiver, operator, operator2, operator3, delegator] =
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
      slashReceiver,
      operator,
      operator2,
      operator3,
      delegator,
      initTimestamp,
      epochSize,
      ...contracts,
    };
  }

  async function hal_03_04fixture() {
    const deployFixtureVars = await loadFixture(deployAndInitializeFixture);
    const {
      deployer,
      operator,
      delegator,
      meldToken,
      meldStakingDelegator,
      meldStakingOperator,
      meldStakingConfig,
      meldStakingNFT,
    } = deployFixtureVars;

    const nodeMeldTokenAmount = toMeldDecimals(100_000); // 100k MELD

    // Request 2 nodes

    await transferAndApproveTokens(
      meldToken,
      deployer,
      operator,
      await meldStakingNFT.getAddress(),
      nodeMeldTokenAmount * 2n
    );

    const nodeName1 = `NAME1`;
    const nodeId1 = await meldStakingOperator.hashNodeId(nodeName1);
    const fee1 = 5_00; // 5%
    console.log(`Requesting node ${nodeName1} with id ${nodeId1}`);
    await meldStakingOperator
      .connect(operator)
      .requestNode(nodeName1, fee1, nodeMeldTokenAmount, 0, "");
    const operatorNode1Nft = await meldStakingNFT.getTotalMintedNfts();

    const nodeName2 = `NAME2`;
    const nodeId2 = await meldStakingOperator.hashNodeId(nodeName2);
    const fee2 = 1_00; // 1%
    await meldStakingOperator
      .connect(operator)
      .requestNode(nodeName2, fee2, nodeMeldTokenAmount, 0, "");
    const operatorNode2Nft = await meldStakingNFT.getTotalMintedNfts();

    // Approve the node requests

    await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId1);
    await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId2);

    // Add 2 lock tiers
    await meldStakingConfig
      .connect(deployer)
      .addStakingLockTier(nodeMeldTokenAmount, 2, 150_00);

    await meldStakingConfig
      .connect(deployer)
      .addStakingLockTier(nodeMeldTokenAmount, 2, 200_00);

    // Delegate to node 1

    await transferAndApproveTokens(
      meldToken,
      deployer,
      delegator,
      await meldStakingNFT.getAddress(),
      nodeMeldTokenAmount
    );

    await meldStakingDelegator
      .connect(delegator)
      .stake(nodeMeldTokenAmount, nodeId1, 1);

    // Change delegation to node 2

    const delegatorNft = await meldStakingNFT.getTotalMintedNfts();

    await meldStakingDelegator
      .connect(delegator)
      .changeDelegation(delegatorNft, nodeId2);

    return {
      ...deployFixtureVars,
      nodeMeldTokenAmount,
      nodeName1,
      nodeId1,
      fee1,
      operatorNode1Nft,
      nodeName2,
      nodeId2,
      fee2,
      operatorNode2Nft,
      delegatorNft,
    };
  }

  context("HAL-01", async function () {
    it("Should withdraw from an inactive node successfully only after changing delegation", async function () {
      const {
        deployer,
        operator,
        delegator,
        meldToken,
        meldStakingDelegator,
        meldStakingOperator,
        meldStakingConfig,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(deployAndInitializeFixture);

      const nodeMeldTokenAmount = toMeldDecimals(100_000); // 100k MELD

      // Request node

      await transferAndApproveTokens(
        meldToken,
        deployer,
        operator,
        await meldStakingNFT.getAddress(),
        nodeMeldTokenAmount
      );

      const nodeName = `NAME1`;
      const nodeId = await meldStakingOperator.hashNodeId(nodeName);
      const fee = 5_00; // 5%
      console.log(`Requesting node ${nodeName} with id ${nodeId}`);
      await meldStakingOperator
        .connect(operator)
        .requestNode(nodeName, fee, nodeMeldTokenAmount, 0, "");
      const operatorNodeNft = await meldStakingNFT.getTotalMintedNfts();

      // Approve the node request

      console.log("Approving");
      await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

      // Create new secondary node and approve
      await transferAndApproveTokens(
        meldToken,
        deployer,
        operator,
        await meldStakingNFT.getAddress(),
        nodeMeldTokenAmount
      );

      const node2Name = `NAME2`;
      const node2Id = await meldStakingOperator.hashNodeId(node2Name);
      console.log(`Requesting node ${node2Name} with id ${node2Id}`);
      await meldStakingOperator
        .connect(operator)
        .requestNode(node2Name, fee, nodeMeldTokenAmount, 0, "");

      await meldStakingConfig.connect(deployer).approveNodeRequest(node2Id);

      // Add lock tier
      await meldStakingConfig
        .connect(deployer)
        .addStakingLockTier(nodeMeldTokenAmount, 2, 150_00);

      // Delegate to node

      await transferAndApproveTokens(
        meldToken,
        deployer,
        delegator,
        await meldStakingNFT.getAddress(),
        nodeMeldTokenAmount
      );

      console.log("Staking");
      await meldStakingDelegator
        .connect(delegator)
        .stake(nodeMeldTokenAmount, nodeId, 1);

      const userStakingNFTId = await meldStakingNFT.getTotalMintedNfts();

      // Advance 10 days

      await time.increase(10 * 24 * 60 * 60);

      // Operator leaves the node 1

      console.log("Leaving");
      await meldStakingOperator.connect(operator).leaveNode(operatorNodeNft);

      // Advance 15 days

      await time.increase(15 * 24 * 60 * 60);

      console.log(
        "MeldToken balance (operator)",
        (await meldToken.balanceOf(operator.address)) / toMeldDecimals(1)
      );
      console.log(
        "MeldToken balance (delegator)",
        (await meldToken.balanceOf(delegator.address)) / toMeldDecimals(1)
      );

      // Withdraw from the node should be blocked for inactive nodes

      await expect(
        meldStakingDelegator.connect(delegator).withdraw(userStakingNFTId)
      ).to.be.revertedWith("MeldStaking: Node is not active");

      console.log("changing delegation");
      // change delegation to active node

      await meldStakingDelegator
        .connect(delegator)
        .changeDelegation(userStakingNFTId, node2Id);

      console.log("withdraw");
      await expect(
        meldStakingDelegator.connect(delegator).withdraw(userStakingNFTId)
      ).not.to.be.reverted;

      // Validate data after withdraw
      await validateStakedAmounts(
        meldStakingStorage,
        meldStakingNFT,
        await meldStakingStorage.getCurrentEpoch()
      );
      await validateBaseStakedAmounts(meldStakingStorage, meldStakingNFT);
    });
  }); // end HAL-01

  context("HAL-02", async function () {
    it("Should be able to change delegation with the right amount", async function () {
      const {
        deployer,
        operator,
        delegator,
        meldToken,
        meldStakingDelegator,
        meldStakingOperator,
        meldStakingConfig,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(deployAndInitializeFixture);

      let sumBaseStakedAmount = 0n;

      const operatorMeldTokenAmount = toMeldDecimals(500_000); // 500k MELD
      await meldToken
        .connect(deployer)
        .transfer(operator.address, operatorMeldTokenAmount);

      const numNodes = 5;

      const nodeMeldTokenAmount = toMeldDecimals(100_000); // 100k MELD
      for (let index = 1; index <= numNodes; index++) {
        await meldToken
          .connect(operator)
          .approve(meldStakingNFT, nodeMeldTokenAmount);
        const nodeName = `NAME${index}`;
        const nodeId = await meldStakingOperator.hashNodeId(nodeName);
        console.log(`Requesting node ${nodeName} with id ${nodeId}`);

        const fee = 100 * index;

        await meldStakingOperator
          .connect(operator)
          .requestNode(nodeName, fee, nodeMeldTokenAmount, 0, "");
      }

      for (let index = 1; index <= numNodes; index++) {
        const nodeName = `NAME${index}`;
        const nodeId = await meldStakingOperator.hashNodeId(nodeName);
        console.log(`Approving node ${nodeName} with id ${nodeId}`);
        await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);
        sumBaseStakedAmount += nodeMeldTokenAmount;
      }

      // Add 2 lock tiers
      await meldStakingConfig
        .connect(deployer)
        .addStakingLockTier(nodeMeldTokenAmount, 2, 150_00);
      await meldStakingConfig
        .connect(deployer)
        .addStakingLockTier(nodeMeldTokenAmount, 2, 200_00);

      await transferAndApproveTokens(
        meldToken,
        deployer,
        delegator,
        await meldStakingNFT.getAddress(),
        nodeMeldTokenAmount
      );

      const nodeId1 = await meldStakingOperator.hashNodeId("NAME1");
      const nodeId5 = await meldStakingOperator.hashNodeId("NAME5");

      await meldStakingDelegator
        .connect(delegator)
        .stake(nodeMeldTokenAmount, nodeId5, 1);

      const weightedDelegationAmount =
        (nodeMeldTokenAmount * 150_00n) / 100_00n;

      sumBaseStakedAmount += weightedDelegationAmount;

      const userStakingNFTId = await meldStakingNFT.getTotalMintedNfts();

      // Change delegation from node 5 to node 1
      await meldStakingDelegator
        .connect(delegator)
        .changeDelegation(userStakingNFTId, nodeId1);

      const epoch = 1;
      const lastStakedAmountPerEpoch =
        await meldStakingStorage.getLastStakedAmountPerEpoch(epoch);
      const minStakedAmountPerEpoch =
        await meldStakingStorage.getMinStakedAmountPerEpoch(epoch);
      const stakerBaseStakedAmount =
        await meldStakingStorage.getStakerBaseStakedAmount(userStakingNFTId);
      const stakerLastStakedAmountPerEpoch =
        await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
          userStakingNFTId,
          epoch
        );
      const stakerMinStakedAmountPerEpoch =
        await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
          userStakingNFTId,
          epoch
        );

      console.log("========= EPOCH ", epoch, " =========");
      console.log(
        "getLastStakedAmountPerEpoch:",
        lastStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getMinStakedAmountPerEpoch:",
        minStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getStakerBaseStakedAmount:",
        stakerBaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getStakerLastStakedAmountPerEpoch:",
        stakerLastStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getStakerMinStakedAmountPerEpoch:",
        stakerMinStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log("");

      const feeNode1 = await meldStakingStorage.getNodeDelegatorFee(nodeId1);

      const newFeeAmount = (nodeMeldTokenAmount * feeNode1) / 100_00n;

      const delegatorLastStakedAmount = weightedDelegationAmount - newFeeAmount;

      expect(lastStakedAmountPerEpoch).to.equal(sumBaseStakedAmount);
      expect(minStakedAmountPerEpoch).to.equal(0);
      expect(stakerBaseStakedAmount).to.equal(nodeMeldTokenAmount);
      expect(stakerLastStakedAmountPerEpoch).to.equal(
        delegatorLastStakedAmount
      );
      expect(stakerMinStakedAmountPerEpoch).to.equal(0);

      await validateBaseStakedAmounts(meldStakingStorage, meldStakingNFT);

      await validateStakedAmounts(meldStakingStorage, meldStakingNFT, epoch);
    });
  }); // end HAL-02

  context("HAL-03", async function () {
    it("Should have the correct values after changing a delegation", async function () {
      const {
        meldStakingCommon,
        meldStakingStorage,
        meldStakingNFT,
        nodeMeldTokenAmount,
        nodeId1,
        operatorNode1Nft,
        nodeId2,
        operatorNode2Nft,
        delegatorNft,
      } = await loadFixture(hal_03_04fixture);

      // Advance 15 days

      await time.increase(15 * 24 * 60 * 60);

      const node1BaseStakedAmount =
        await meldStakingStorage.getNodeBaseStakedAmount(nodeId1);
      const node2BaseStakedAmount =
        await meldStakingStorage.getNodeBaseStakedAmount(nodeId2);
      const operatorNode1BaseStakedAmount =
        await meldStakingStorage.getStakerBaseStakedAmount(operatorNode1Nft);
      const operatorNode2BaseStakedAmount =
        await meldStakingStorage.getStakerBaseStakedAmount(operatorNode2Nft);
      const delegatorBaseStakedAmount =
        await meldStakingStorage.getStakerBaseStakedAmount(delegatorNft);
      const operatorNode1UnclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(operatorNode1Nft);
      const operatorNode2UnclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(operatorNode2Nft);
      const delegatorUnclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(delegatorNft);

      console.log(
        "getNodeBaseStakedAmount(nodeId1)\t\t",
        node1BaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getNodeBaseStakedAmount(nodeId2)\t\t",
        node2BaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getStakerBaseStakedAmount(operatorNode1Nft)\t",
        operatorNode1BaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getStakerBaseStakedAmount(operatorNode2Nft)\t",
        operatorNode2BaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getStakerBaseStakedAmount(delegatorNft)\t\t",
        delegatorBaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getStakerUnclaimedRewards(operatorNode1Nft)\t",
        operatorNode1UnclaimedRewards / toMeldDecimals(1)
      );
      console.log(
        "getStakerUnclaimedRewards(operatorNode2Nft)\t",
        operatorNode2UnclaimedRewards / toMeldDecimals(1)
      );
      console.log(
        "getStakerUnclaimedRewards(delegatorNft)\t\t",
        delegatorUnclaimedRewards / toMeldDecimals(1)
      );

      expect(node1BaseStakedAmount).to.equal(nodeMeldTokenAmount);
      expect(node2BaseStakedAmount).to.equal(nodeMeldTokenAmount * 2n);
      expect(operatorNode1BaseStakedAmount).to.equal(nodeMeldTokenAmount);
      expect(operatorNode2BaseStakedAmount).to.equal(nodeMeldTokenAmount);
      expect(delegatorBaseStakedAmount).to.equal(nodeMeldTokenAmount);
      expect(operatorNode1UnclaimedRewards).to.equal(0);
      expect(operatorNode2UnclaimedRewards).to.equal(0);
      expect(delegatorUnclaimedRewards).to.equal(0);

      // Update unclaimed rewards

      await meldStakingCommon.updateUnclaimedRewards(operatorNode1Nft);
      await meldStakingCommon.updateUnclaimedRewards(operatorNode2Nft);
      await meldStakingCommon.updateUnclaimedRewards(delegatorNft);

      const epoch = 1;

      const lastStakedAmountPerEpoch =
        await meldStakingStorage.getLastStakedAmountPerEpoch(epoch);
      const minStakedAmountPerEpoch =
        await meldStakingStorage.getMinStakedAmountPerEpoch(epoch);
      const node1LastStakedAmountPerEpoch =
        await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
          nodeId1,
          epoch
        );
      const node2LastStakedAmountPerEpoch =
        await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
          nodeId2,
          epoch
        );
      const delegatorLastStakedAmountPerEpoch =
        await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
          delegatorNft,
          epoch
        );
      const delegatorMinStakedAmountPerEpoch =
        await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
          delegatorNft,
          epoch
        );
      const operatorNode1MinStakedAmountPerEpoch =
        await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
          operatorNode1Nft,
          epoch
        );
      const operatorNode1LastStakedAmountPerEpoch =
        await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
          operatorNode1Nft,
          epoch
        );
      const operatorNode2MinStakedAmountPerEpoch =
        await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
          operatorNode2Nft,
          epoch
        );
      const operatorNode2LastStakedAmountPerEpoch =
        await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
          operatorNode2Nft,
          epoch
        );

      console.log("\n========= EPOCH ", epoch, " =========");
      console.log(
        "getLastStakedAmountPerEpoch:\t\t\t\t",
        lastStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getMinStakedAmountPerEpoch:\t\t\t\t",
        minStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getNodeLastStakedAmountPerEpoch(nodeId1):\t\t",
        node1LastStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getNodeLastStakedAmountPerEpoch(nodeId2):\t\t",
        node2LastStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getStakerLastStakedAmountPerEpoch(delegatorNft):\t",
        delegatorLastStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getStakerMinStakedAmountPerEpoch(delegatorNft):\t\t",
        delegatorMinStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getStakerLastStakedAmountPerEpoch(operatorNode1Nft):\t",
        operatorNode1LastStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getStakerMinStakedAmountPerEpoch(operatorNode1Nft):\t",
        operatorNode1MinStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getStakerLastStakedAmountPerEpoch(operatorNode2Nft):\t",
        operatorNode2LastStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log(
        "getStakerMinStakedAmountPerEpoch(operatorNode2Nft):\t",
        operatorNode2MinStakedAmountPerEpoch / toMeldDecimals(1)
      );
      console.log("");

      await validateBaseStakedAmounts(meldStakingStorage, meldStakingNFT);

      await validateStakedAmounts(meldStakingStorage, meldStakingNFT, epoch);
    });
  }); // end HAL-03

  context("HAL-04", async function () {
    it("Should have the correct values after changing a delegation for the next epochs", async function () {
      const {
        meldStakingCommon,
        meldStakingStorage,
        meldStakingNFT,
        nodeMeldTokenAmount,
        nodeId1,
        operatorNode1Nft,
        nodeId2,
        operatorNode2Nft,
        delegatorNft,
      } = await loadFixture(hal_03_04fixture);

      // Advance 15 days

      await time.increase(15 * 24 * 60 * 60);

      const node1BaseStakedAmount =
        await meldStakingStorage.getNodeBaseStakedAmount(nodeId1);
      const node2BaseStakedAmount =
        await meldStakingStorage.getNodeBaseStakedAmount(nodeId2);
      const operatorNode1BaseStakedAmount =
        await meldStakingStorage.getStakerBaseStakedAmount(operatorNode1Nft);
      const operatorNode2BaseStakedAmount =
        await meldStakingStorage.getStakerBaseStakedAmount(operatorNode2Nft);
      const delegatorBaseStakedAmount =
        await meldStakingStorage.getStakerBaseStakedAmount(delegatorNft);
      const operatorNode1UnclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(operatorNode1Nft);
      const operatorNode2UnclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(operatorNode2Nft);
      const delegatorUnclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(delegatorNft);

      console.log(
        "getNodeBaseStakedAmount(nodeId1)\t\t",
        node1BaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getNodeBaseStakedAmount(nodeId2)\t\t",
        node2BaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getStakerBaseStakedAmount(operatorNode1Nft)\t",
        operatorNode1BaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getStakerBaseStakedAmount(operatorNode2Nft)\t",
        operatorNode2BaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getStakerBaseStakedAmount(delegatorNft)\t\t",
        delegatorBaseStakedAmount / toMeldDecimals(1)
      );
      console.log(
        "getStakerUnclaimedRewards(operatorNode1Nft)\t",
        operatorNode1UnclaimedRewards / toMeldDecimals(1)
      );
      console.log(
        "getStakerUnclaimedRewards(operatorNode2Nft)\t",
        operatorNode2UnclaimedRewards / toMeldDecimals(1)
      );
      console.log(
        "getStakerUnclaimedRewards(delegatorNft)\t\t",
        delegatorUnclaimedRewards / toMeldDecimals(1)
      );

      expect(node1BaseStakedAmount).to.equal(nodeMeldTokenAmount);
      expect(node2BaseStakedAmount).to.equal(nodeMeldTokenAmount * 2n);
      expect(operatorNode1BaseStakedAmount).to.equal(nodeMeldTokenAmount);
      expect(operatorNode2BaseStakedAmount).to.equal(nodeMeldTokenAmount);
      expect(delegatorBaseStakedAmount).to.equal(nodeMeldTokenAmount);
      expect(operatorNode1UnclaimedRewards).to.equal(0);
      expect(operatorNode2UnclaimedRewards).to.equal(0);
      expect(delegatorUnclaimedRewards).to.equal(0);

      // Update unclaimed rewards

      await meldStakingCommon.updateUnclaimedRewards(operatorNode1Nft);
      await meldStakingCommon.updateUnclaimedRewards(operatorNode2Nft);
      await meldStakingCommon.updateUnclaimedRewards(delegatorNft);

      const currentEpoch = await meldStakingStorage.getCurrentEpoch();

      for (let epoch = 1; epoch <= currentEpoch; epoch++) {
        const lastStakedAmountPerEpoch =
          await meldStakingStorage.getLastStakedAmountPerEpoch(epoch);
        const minStakedAmountPerEpoch =
          await meldStakingStorage.getMinStakedAmountPerEpoch(epoch);
        const node1LastStakedAmountPerEpoch =
          await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId1,
            epoch
          );
        const node2LastStakedAmountPerEpoch =
          await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId2,
            epoch
          );
        const delegatorLastStakedAmountPerEpoch =
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            delegatorNft,
            epoch
          );
        const delegatorMinStakedAmountPerEpoch =
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            delegatorNft,
            epoch
          );
        const operatorNode1MinStakedAmountPerEpoch =
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            operatorNode1Nft,
            epoch
          );
        const operatorNode1LastStakedAmountPerEpoch =
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            operatorNode1Nft,
            epoch
          );
        const operatorNode2MinStakedAmountPerEpoch =
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            operatorNode2Nft,
            epoch
          );
        const operatorNode2LastStakedAmountPerEpoch =
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            operatorNode2Nft,
            epoch
          );

        console.log("\n========= EPOCH ", epoch, " =========");
        console.log(
          "getLastStakedAmountPerEpoch:\t\t\t\t",
          lastStakedAmountPerEpoch / toMeldDecimals(1)
        );
        console.log(
          "getMinStakedAmountPerEpoch:\t\t\t\t",
          minStakedAmountPerEpoch / toMeldDecimals(1)
        );
        console.log(
          "getNodeLastStakedAmountPerEpoch(nodeId1):\t\t",
          node1LastStakedAmountPerEpoch / toMeldDecimals(1)
        );
        console.log(
          "getNodeLastStakedAmountPerEpoch(nodeId2):\t\t",
          node2LastStakedAmountPerEpoch / toMeldDecimals(1)
        );
        console.log(
          "getStakerLastStakedAmountPerEpoch(delegatorNft):\t",
          delegatorLastStakedAmountPerEpoch / toMeldDecimals(1)
        );
        console.log(
          "getStakerMinStakedAmountPerEpoch(delegatorNft):\t\t",
          delegatorMinStakedAmountPerEpoch / toMeldDecimals(1)
        );
        console.log(
          "getStakerLastStakedAmountPerEpoch(operatorNode1Nft):\t",
          operatorNode1LastStakedAmountPerEpoch / toMeldDecimals(1)
        );
        console.log(
          "getStakerMinStakedAmountPerEpoch(operatorNode1Nft):\t",
          operatorNode1MinStakedAmountPerEpoch / toMeldDecimals(1)
        );
        console.log(
          "getStakerLastStakedAmountPerEpoch(operatorNode2Nft):\t",
          operatorNode2LastStakedAmountPerEpoch / toMeldDecimals(1)
        );
        console.log(
          "getStakerMinStakedAmountPerEpoch(operatorNode2Nft):\t",
          operatorNode2MinStakedAmountPerEpoch / toMeldDecimals(1)
        );
        console.log("");
        await validateStakedAmounts(meldStakingStorage, meldStakingNFT, epoch);
      }

      await validateBaseStakedAmounts(meldStakingStorage, meldStakingNFT);
    });
  }); // end HAL-04

  context("HAL-08", async function () {
    it("Should be able to cancel node requests keeping the correct values", async function () {
      const {
        deployer,
        operator,
        operator2,
        operator3,
        meldToken,
        meldStakingOperator,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(deployAndInitializeFixture);

      const nodeMeldTokenAmount = toMeldDecimals(100_000); // 100k MELD

      // Request 3 nodes

      await requestNode(
        meldToken,
        meldStakingOperator,
        meldStakingNFT,
        deployer,
        operator,
        "NAME1",
        10,
        nodeMeldTokenAmount,
        0,
        ""
      );
      await requestNode(
        meldToken,
        meldStakingOperator,
        meldStakingNFT,
        deployer,
        operator2,
        "NAME2",
        10,
        nodeMeldTokenAmount,
        0,
        ""
      );
      await requestNode(
        meldToken,
        meldStakingOperator,
        meldStakingNFT,
        deployer,
        operator3,
        "NAME3",
        10,
        nodeMeldTokenAmount,
        0,
        ""
      );
      const nodeId1 = await meldStakingOperator.hashNodeId("NAME1");
      const nodeId2 = await meldStakingOperator.hashNodeId("NAME2");
      const nodeId3 = await meldStakingOperator.hashNodeId("NAME3");

      // Should be in the correct order
      expect(await meldStakingStorage.activeNodeRequestsIds(0)).to.equal(
        nodeId1
      );
      expect(await meldStakingStorage.activeNodeRequestsIds(1)).to.equal(
        nodeId2
      );
      expect(await meldStakingStorage.activeNodeRequestsIds(2)).to.equal(
        nodeId3
      );

      // Remove node 2
      await meldStakingOperator.connect(operator2).cancelNodeRequest(nodeId2);

      // New order should be [0]=>node1 [1]=>node3
      expect(await meldStakingStorage.activeNodeRequestsIds(0)).to.equal(
        nodeId1
      );
      expect(await meldStakingStorage.activeNodeRequestsIds(1)).to.equal(
        nodeId3
      );
    });
  }); // end HAL-08

  context("Unclaimed rewards bug", async function () {
    it("Should be able to calculate unclaimed rewards from a slashed node for a delegator", async function () {
      const {
        deployer,
        operator,
        delegator,
        meldToken,
        meldStakingCommon,
        meldStakingConfig,
        meldStakingDelegator,
        meldStakingOperator,
        meldStakingNFT,
      } = await loadFixture(deployAndInitializeFixture);

      const nodeMeldTokenAmount = toMeldDecimals(100_000); // 100k MELD

      // Request nodes

      await requestNode(
        meldToken,
        meldStakingOperator,
        meldStakingNFT,
        deployer,
        operator,
        "NAME1",
        10,
        nodeMeldTokenAmount,
        0,
        ""
      );

      const nodeId1 = await meldStakingOperator.hashNodeId("NAME1");

      // Approve the node request

      await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId1);

      // Add lock tier

      await meldStakingConfig
        .connect(deployer)
        .addStakingLockTier(nodeMeldTokenAmount, 2, 150_00);

      // Delegate to node

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator,
        nodeMeldTokenAmount,
        nodeId1,
        0
      );

      const userStakingNFTId = await meldStakingNFT.getTotalMintedNfts();

      // Advance 10 days

      await time.increase(10 * 24 * 60 * 60);

      // Slash the node

      await meldStakingConfig.connect(deployer).slashNode(nodeId1, 100_00n);

      // Advance 30 days

      await time.increase(30 * 24 * 60 * 60);

      // Grant rewards setter role

      await meldStakingConfig
        .connect(deployer)
        .grantRole(
          await meldStakingConfig.REWARDS_SETTER_ROLE(),
          deployer.address
        );

      // Set rewards

      await meldToken.approve(meldStakingNFT, nodeMeldTokenAmount * 2n);

      await meldStakingConfig.setRewards(nodeMeldTokenAmount, 2);
      await meldStakingConfig.setRewards(nodeMeldTokenAmount, 3);

      await meldStakingCommon.updateUnclaimedRewards(userStakingNFTId);
    });
    it("Should be able to calculate unclaimed rewards from a slashed node for an operator", async function () {
      const {
        deployer,
        operator,
        meldToken,
        meldStakingCommon,
        meldStakingConfig,
        meldStakingOperator,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(deployAndInitializeFixture);

      const nodeMeldTokenAmount = toMeldDecimals(100_000); // 100k MELD

      // Request node

      await requestNode(
        meldToken,
        meldStakingOperator,
        meldStakingNFT,
        deployer,
        operator,
        "NAME1",
        10_00,
        nodeMeldTokenAmount,
        0,
        ""
      );

      const nodeId = await meldStakingOperator.hashNodeId("NAME1");

      // Approve
      await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

      // Advance 2 epochs

      await time.increase(2n * (await meldStakingStorage.getEpochSize()));

      expect(await meldStakingStorage.getCurrentEpoch()).to.equal(3);

      // Slash node

      await meldStakingConfig.connect(deployer).slashNode(nodeId, 100_00n);

      // Advance 10 days

      await time.increase(10 * 24 * 60 * 60);

      // Set rewards

      await meldStakingConfig
        .connect(deployer)
        .grantRole(
          await meldStakingConfig.REWARDS_SETTER_ROLE(),
          deployer.address
        );

      await meldToken
        .connect(deployer)
        .approve(meldStakingNFT, 10n * nodeMeldTokenAmount);

      await meldStakingConfig
        .connect(deployer)
        .setRewards(nodeMeldTokenAmount, 2);
      await meldStakingConfig
        .connect(deployer)
        .setRewards(nodeMeldTokenAmount, 3);

      // Update unclaimed rewards

      const operatorNFT = await meldStakingNFT.getTotalMintedNfts();

      // This used to fail because the node was slashed at the same epoch as the rewards were last set
      await meldStakingCommon.updateUnclaimedRewards(operatorNFT);

      const unclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT);

      expect(unclaimedRewards).to.equal(nodeMeldTokenAmount);
    });
    it("Should be able to calculate unclaimed rewards from an inactive node", async function () {
      const {
        deployer,
        operator,
        delegator,
        meldToken,
        meldStakingCommon,
        meldStakingConfig,
        meldStakingOperator,
        meldStakingDelegator,
        meldStakingStorage,
        meldStakingNFT,
      } = await loadFixture(deployAndInitializeFixture);

      const nodeMeldTokenAmount = toMeldDecimals(100_000); // 100k MELD

      // Request node

      await requestNode(
        meldToken,
        meldStakingOperator,
        meldStakingNFT,
        deployer,
        operator,
        "NAME1",
        0, // No fee
        nodeMeldTokenAmount,
        0,
        ""
      );

      const nodeId = await meldStakingOperator.hashNodeId("NAME1");

      // Approve
      await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

      const operatorNFT = await meldStakingNFT.getTotalMintedNfts();

      // Delegator stakes

      await delegateToNode(
        meldToken,
        meldStakingDelegator,
        meldStakingNFT,
        deployer,
        delegator,
        nodeMeldTokenAmount,
        nodeId,
        0
      );

      const delegatorNFT = await meldStakingNFT.getTotalMintedNfts();

      // Advance 2 epochs

      await time.increase(2n * (await meldStakingStorage.getEpochSize()));

      expect(await meldStakingStorage.getCurrentEpoch()).to.equal(3);

      // Operator leaves node

      await meldStakingOperator.connect(operator).leaveNode(operatorNFT);

      // Advance 10 days

      await time.increase(10 * 24 * 60 * 60);

      // Set rewards

      await meldStakingConfig
        .connect(deployer)
        .grantRole(
          await meldStakingConfig.REWARDS_SETTER_ROLE(),
          deployer.address
        );

      await meldToken
        .connect(deployer)
        .approve(meldStakingNFT, 10n * nodeMeldTokenAmount);

      await meldStakingConfig
        .connect(deployer)
        .setRewards(nodeMeldTokenAmount, 2);
      await meldStakingConfig
        .connect(deployer)
        .setRewards(nodeMeldTokenAmount, 3);

      // Update unclaimed rewards

      await meldStakingCommon.updateUnclaimedRewards(delegatorNFT);

      const unclaimedRewards =
        await meldStakingStorage.getStakerUnclaimedRewards(delegatorNFT);

      expect(unclaimedRewards).to.equal(nodeMeldTokenAmount / 2n); // Half of the rewards. The other half would have gone to the operator
    });
  }); // end Unclaimed rewards bug
});

async function validateStakedAmounts(
  meldStakingStorage: MeldStakingStorage,
  meldStakingNFT: MeldStakingNFT,
  epoch: BigNumberish
) {
  const globalLastStakedAmountPerEpoch =
    await meldStakingStorage.getLastStakedAmountPerEpoch(epoch);

  const sumLastStakedAmountPerNode: { [key: string]: bigint } = {};
  let sumNodeLastStakedAmount = 0n;
  let sumLastStakedAmount = 0n;

  const totalMintedNfts = await meldStakingNFT.getTotalMintedNfts();

  for (let nftId = 1; nftId <= totalMintedNfts; nftId++) {
    if (!(await meldStakingNFT.exists(nftId))) {
      continue;
    }
    const nodeId = await meldStakingStorage.getStakerNodeId(nftId);
    if (!(await meldStakingStorage.isNodeActive(nodeId))) {
      continue;
    }
    if (!sumLastStakedAmountPerNode[nodeId]) {
      sumLastStakedAmountPerNode[nodeId] = 0n;
    }
    const lastStakedAmount =
      await meldStakingStorage.getStakerLastStakedAmountPerEpoch(nftId, epoch);
    sumLastStakedAmount += lastStakedAmount;
    sumLastStakedAmountPerNode[nodeId] += lastStakedAmount;
  }
  for (const nodeId in sumLastStakedAmountPerNode) {
    sumNodeLastStakedAmount += sumLastStakedAmountPerNode[nodeId];
    expect(sumLastStakedAmountPerNode[nodeId]).to.equal(
      await meldStakingStorage.getNodeLastStakedAmountPerEpoch(nodeId, epoch)
    );
  }
  expect(sumNodeLastStakedAmount).to.equal(globalLastStakedAmountPerEpoch);
  expect(sumLastStakedAmount).to.equal(globalLastStakedAmountPerEpoch);
}

async function validateBaseStakedAmounts(
  meldStakingStorage: MeldStakingStorage,
  meldStakingNFT: MeldStakingNFT
) {
  const globalBaseStakedAmount =
    await meldStakingStorage.getTotalBaseStakedAmount();

  const sumBaseStakedAmountPerNode: { [key: string]: bigint } = {};
  let sumNodeBaseStakedAmount = 0n;
  let sumBaseStakedAmount = 0n;

  const totalMintedNfts = await meldStakingNFT.getTotalMintedNfts();

  for (let nftId = 1; nftId <= totalMintedNfts; nftId++) {
    if (!(await meldStakingNFT.exists(nftId))) {
      continue;
    }
    const nodeId = await meldStakingStorage.getStakerNodeId(nftId);
    if (!(await meldStakingStorage.isNodeActive(nodeId))) {
      continue;
    }
    if (!sumBaseStakedAmountPerNode[nodeId]) {
      sumBaseStakedAmountPerNode[nodeId] = 0n;
    }
    const baseStakedAmount = await meldStakingStorage.getStakerBaseStakedAmount(
      nftId
    );
    sumBaseStakedAmount += baseStakedAmount;
    sumBaseStakedAmountPerNode[nodeId] += baseStakedAmount;
  }
  for (const nodeId in sumBaseStakedAmountPerNode) {
    sumNodeBaseStakedAmount += sumBaseStakedAmountPerNode[nodeId];
    expect(sumBaseStakedAmountPerNode[nodeId]).to.equal(
      await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
    );
  }
  expect(sumNodeBaseStakedAmount).to.equal(globalBaseStakedAmount);
  expect(sumBaseStakedAmount).to.equal(globalBaseStakedAmount);
}
