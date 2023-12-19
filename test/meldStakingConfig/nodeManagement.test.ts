import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  delegateToNode,
  deployAndConfigContracts,
  requestNode,
  toMeldDecimals,
} from "../utils/utils";
import { PERCENTAGE_SCALING } from "../utils/constants";
import { Errors } from "../utils/errors";

describe("MeldStakingConfig - Node Management", function () {
  // Deploy the contracts and initialize them
  async function deployAndInitializeFixture() {
    const [
      deployer,
      rando,
      rando2,
      rewardsSetter,
      slashReceiver,
      operator,
      delegator,
    ] = await ethers.getSigners();
    const initTimestamp = (await time.latest()) + 1000;
    const epochSize = 5 * 24 * 60 * 60; // 5 days
    const contracts = await deployAndConfigContracts(
      deployer.address,
      initTimestamp,
      epochSize,
      slashReceiver.address
    );
    return {
      deployer,
      rando,
      rando2,
      rewardsSetter,
      slashReceiver,
      operator,
      delegator,
      initTimestamp,
      epochSize,
      ...contracts,
    };
  }

  // Deploy the contracts, initialize them and start staking
  async function stakingStartedFixture() {
    const deployAndInitializeFixtureVars = await deployAndInitializeFixture();
    await time.increaseTo(deployAndInitializeFixtureVars.initTimestamp + 1);
    return deployAndInitializeFixtureVars;
  }

  context("approveNodeRequest", function () {
    context("Happy flow test cases", function () {
      it("Should emit an event when a node request is approved", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Params for the node request
        const nodeName = "testNode";
        const delegatorFee = 10_00n; // 10%
        const amount = toMeldDecimals(115_000);
        const lockTierId = 0;
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

        const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);

        // Admin approves the node request
        const approveTx = await meldStakingConfig
          .connect(deployer)
          .approveNodeRequest(nodeId);

        // Check events emitted

        // Emits NodeRequestApproved event
        await expect(approveTx)
          .to.emit(meldStakingConfig, "NodeRequestApproved")
          .withArgs(deployer.address, nodeId, nodeRequest.operator, amount);

        // Emits TotalBaseStakedAmountChanged
        await expect(approveTx)
          .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
          .withArgs(deployer.address, 0, amount);
      });
      it("Should have the node request with liquid staking correctly approved", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingCommon,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Params for the node request
        const nodeName = "testNode";
        const delegatorFee = 10_00n; // 10%
        const amount = toMeldDecimals(120_000);
        const lockTierId = 0;
        const metadata = "";

        const calculatedAmount = amount;

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

        const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
        const operatorNFT = nodeRequest.operator;

        const currentEpoch = await meldStakingStorage.getCurrentEpoch();

        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.true;
        expect(await meldStakingStorage.isNode(nodeId)).to.be.false;

        // Admin approves the node request
        const approveTx = await meldStakingConfig
          .connect(deployer)
          .approveNodeRequest(nodeId);

        const block = await ethers.provider.getBlock(approveTx.blockNumber!);
        const approveTimestamp = block!.timestamp;

        // Check that the node request has been removed and the node has been created
        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.false;

        expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;

        expect(
          await meldStakingCommon.getWeightedAmount(amount, lockTierId)
        ).to.equal(calculatedAmount);

        // Check node data
        expect(await meldStakingStorage.getNodeName(nodeId)).to.equal(nodeName);
        expect(await meldStakingStorage.getNodeOperator(nodeId)).to.equal(
          operatorNFT
        );
        expect(
          await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
        ).to.equal(amount);
        expect(
          await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
        ).to.equal(currentEpoch);
        expect(await meldStakingStorage.getNodeDelegatorFee(nodeId)).to.equal(
          delegatorFee
        );
        expect(
          await meldStakingStorage.getNodeMaxStakingAmount(nodeId)
        ).to.equal(await meldStakingStorage.getMaxStakingAmount());
        expect(await meldStakingStorage.getNodeEndTimestamp(nodeId)).to.equal(
          0n
        );
        expect(
          await meldStakingStorage.isDelegatorWhitelistEnabled(nodeId)
        ).to.be.false;
        expect(await meldStakingStorage.getNodeDelegators(nodeId)).to.eql([]);
        expect(
          await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
            nodeId,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId,
            currentEpoch
          )
        ).to.equal(calculatedAmount);
        expect(await meldStakingStorage.getNumNodes()).to.eql(1n);

        // Check that the operator has the node NFT
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1);
        expect(await meldStakingNFT.ownerOf(operatorNFT)).to.equal(
          operator.address
        );
        expect(
          await meldStakingNFT.getAllTokensByOwner(operator.address)
        ).to.eql([operatorNFT]);

        // Check the Staker NFT data
        expect(await meldStakingStorage.isStaker(operatorNFT)).to.be.true;
        expect(await meldStakingStorage.isOperator(operatorNFT)).to.be.true;
        expect(await meldStakingStorage.isDelegator(operatorNFT)).to.be.false;
        expect(
          await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
        ).to.equal(amount);
        expect(await meldStakingStorage.getStakerNodeId(operatorNFT)).to.equal(
          nodeId
        );
        expect(
          await meldStakingStorage.getStakerLastEpochStakingUpdated(operatorNFT)
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLastEpochRewardsUpdated(operatorNFT)
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLockTierId(operatorNFT)
        ).to.equal(lockTierId);
        expect(
          await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT)
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerStakingStartTimestamp(operatorNFT)
        ).to.equal(approveTimestamp);
        expect(
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            operatorNFT,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            operatorNFT,
            currentEpoch
          )
        ).to.equal(calculatedAmount);
      });
      it("Should have the node request with lock staking correctly approved", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingCommon,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Add a staking tier
        const minStakingAmount = toMeldDecimals(110_000);
        const stakingLength = 10; // 10 epochs
        const weight = 120_00n; // 120%
        await meldStakingConfig.addStakingLockTier(
          minStakingAmount,
          stakingLength,
          weight
        );

        // Params for the node request
        const nodeName = "testNode";
        const delegatorFee = 8_00n; // 8%
        const amount = toMeldDecimals(130_000);
        const lockTierId = await meldStakingStorage.lastLockStakingTierId();
        const metadata = "";

        const calculatedAmount = (amount * weight) / PERCENTAGE_SCALING;

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

        const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
        const operatorNFT = nodeRequest.operator;

        const currentEpoch = await meldStakingStorage.getCurrentEpoch();

        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.true;
        expect(await meldStakingStorage.isNode(nodeId)).to.be.false;

        // Admin approves the node request
        const approveTx = await meldStakingConfig
          .connect(deployer)
          .approveNodeRequest(nodeId);

        const block = await ethers.provider.getBlock(approveTx.blockNumber!);
        const approveTimestamp = block!.timestamp;

        // Check that the node request has been removed and the node has been created
        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.false;

        expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;

        expect(
          await meldStakingCommon.getWeightedAmount(amount, lockTierId)
        ).to.equal(calculatedAmount);

        // Check node data
        expect(await meldStakingStorage.getNodeName(nodeId)).to.equal(nodeName);
        expect(await meldStakingStorage.getNodeOperator(nodeId)).to.equal(
          operatorNFT
        );
        expect(
          await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
        ).to.equal(amount);
        expect(
          await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
        ).to.equal(currentEpoch);
        expect(await meldStakingStorage.getNodeDelegatorFee(nodeId)).to.equal(
          delegatorFee
        );
        expect(
          await meldStakingStorage.getNodeMaxStakingAmount(nodeId)
        ).to.equal(await meldStakingStorage.getMaxStakingAmount());
        expect(await meldStakingStorage.getNodeEndTimestamp(nodeId)).to.equal(
          0n
        );
        expect(
          await meldStakingStorage.isDelegatorWhitelistEnabled(nodeId)
        ).to.be.false;
        expect(await meldStakingStorage.getNodeDelegators(nodeId)).to.eql([]);
        expect(
          await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
            nodeId,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId,
            currentEpoch
          )
        ).to.equal(calculatedAmount);
        expect(await meldStakingStorage.getNumNodes()).to.eql(1n);

        // Check that the operator has the node NFT
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1);
        expect(await meldStakingNFT.ownerOf(operatorNFT)).to.equal(
          operator.address
        );
        expect(
          await meldStakingNFT.getAllTokensByOwner(operator.address)
        ).to.eql([operatorNFT]);

        // Check the Staker NFT data
        expect(await meldStakingStorage.isStaker(operatorNFT)).to.be.true;
        expect(await meldStakingStorage.isOperator(operatorNFT)).to.be.true;
        expect(await meldStakingStorage.isDelegator(operatorNFT)).to.be.false;
        expect(
          await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
        ).to.equal(amount);
        expect(await meldStakingStorage.getStakerNodeId(operatorNFT)).to.equal(
          nodeId
        );
        expect(
          await meldStakingStorage.getStakerLastEpochStakingUpdated(operatorNFT)
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLastEpochRewardsUpdated(operatorNFT)
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLockTierId(operatorNFT)
        ).to.equal(lockTierId);
        expect(
          await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT)
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerStakingStartTimestamp(operatorNFT)
        ).to.equal(approveTimestamp);
        expect(
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            operatorNFT,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            operatorNFT,
            currentEpoch
          )
        ).to.equal(calculatedAmount);
      });
      it("Should appprove two liquid staking node requests correctly", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingCommon,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // REQUEST NODE 1

        // Params for the node request
        const nodeName1 = "testNode1";
        const delegatorFee1 = 10_00; // 10%
        const amount1 = toMeldDecimals(175_000);
        const lockTierId1 = 0;
        const metadata1 = "";

        const calculatedAmount1 = amount1;

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName1,
          delegatorFee1,
          amount1,
          lockTierId1,
          metadata1
        );

        // Node id is the hash of the node name
        const nodeId1 = await meldStakingOperator.hashNodeId(nodeName1);

        const nodeRequest1 = await meldStakingStorage.getNodeRequest(nodeId1);
        const operatorNFT1 = nodeRequest1.operator;

        expect(await meldStakingStorage.nodeRequestExists(nodeId1)).to.be.true;
        expect(await meldStakingStorage.isNode(nodeId1)).to.be.false;

        // REQUEST NODE 2

        // Params for the node request
        const nodeName2 = "testNode2";
        const delegatorFee2 = 20_00; // 20%
        const amount2 = toMeldDecimals(225_000);
        const lockTierId2 = 0;
        const metadata2 = "";

        const calculatedAmount2 = amount2;

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName2,
          delegatorFee2,
          amount2,
          lockTierId2,
          metadata2
        );

        // Node id is the hash of the node name
        const nodeId2 = await meldStakingOperator.hashNodeId(nodeName2);

        const nodeRequest2 = await meldStakingStorage.getNodeRequest(nodeId2);
        const operatorNFT2 = nodeRequest2.operator;

        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.true;
        expect(await meldStakingStorage.isNode(nodeId2)).to.be.false;

        const currentEpoch = await meldStakingStorage.getCurrentEpoch();

        // Admin approves the node request1
        const approveTx1 = await meldStakingConfig
          .connect(deployer)
          .approveNodeRequest(nodeId1);

        const block1 = await ethers.provider.getBlock(approveTx1.blockNumber!);
        const approveTimestamp1 = block1!.timestamp;

        // Admin approves the node request2
        const approveTx2 = await meldStakingConfig
          .connect(deployer)
          .approveNodeRequest(nodeId2);

        const block2 = await ethers.provider.getBlock(approveTx2.blockNumber!);
        const approveTimestamp2 = block2!.timestamp;

        // Check node 1 data

        // Check that the node request has been removed and the node has been created
        expect(await meldStakingStorage.nodeRequestExists(nodeId1)).to.be.false;

        expect(await meldStakingStorage.isNode(nodeId1)).to.be.true;
        expect(await meldStakingStorage.isNodeActive(nodeId1)).to.be.true;

        expect(
          await meldStakingCommon.getWeightedAmount(amount1, lockTierId1)
        ).to.equal(calculatedAmount1);

        // Check node data
        expect(await meldStakingStorage.getNodeName(nodeId1)).to.equal(
          nodeName1
        );
        expect(await meldStakingStorage.getNodeOperator(nodeId1)).to.equal(
          operatorNFT1
        );
        expect(
          await meldStakingStorage.getNodeBaseStakedAmount(nodeId1)
        ).to.equal(amount1);
        expect(
          await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId1)
        ).to.equal(currentEpoch);
        expect(await meldStakingStorage.getNodeDelegatorFee(nodeId1)).to.equal(
          delegatorFee1
        );
        expect(
          await meldStakingStorage.getNodeMaxStakingAmount(nodeId1)
        ).to.equal(await meldStakingStorage.getMaxStakingAmount());
        expect(await meldStakingStorage.getNodeEndTimestamp(nodeId1)).to.equal(
          0n
        );
        expect(
          await meldStakingStorage.isDelegatorWhitelistEnabled(nodeId1)
        ).to.be.false;
        expect(await meldStakingStorage.getNodeDelegators(nodeId1)).to.eql([]);
        expect(
          await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
            nodeId1,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId1,
            currentEpoch
          )
        ).to.equal(calculatedAmount1);
        expect(await meldStakingStorage.getNumNodes()).to.eql(2n);

        // Check that the operator has the node NFT
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);
        expect(await meldStakingNFT.ownerOf(operatorNFT1)).to.equal(
          operator.address
        );
        expect(
          await meldStakingNFT.getAllTokensByOwner(operator.address)
        ).to.eql([operatorNFT1, operatorNFT2]);

        // Check the Staker NFT data
        expect(await meldStakingStorage.isStaker(operatorNFT1)).to.be.true;
        expect(await meldStakingStorage.isOperator(operatorNFT1)).to.be.true;
        expect(await meldStakingStorage.isDelegator(operatorNFT1)).to.be.false;
        expect(
          await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT1)
        ).to.equal(amount1);
        expect(await meldStakingStorage.getStakerNodeId(operatorNFT1)).to.equal(
          nodeId1
        );
        expect(
          await meldStakingStorage.getStakerLastEpochStakingUpdated(
            operatorNFT1
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLastEpochRewardsUpdated(
            operatorNFT1
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLockTierId(operatorNFT1)
        ).to.equal(lockTierId1);
        expect(
          await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT1)
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerStakingStartTimestamp(operatorNFT1)
        ).to.equal(approveTimestamp1);
        expect(
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            operatorNFT1,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            operatorNFT1,
            currentEpoch
          )
        ).to.equal(calculatedAmount1);

        // Check node 2 data

        // Check that the node request has been removed and the node has been created
        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.false;

        expect(await meldStakingStorage.isNode(nodeId2)).to.be.true;
        expect(await meldStakingStorage.isNodeActive(nodeId2)).to.be.true;

        expect(
          await meldStakingCommon.getWeightedAmount(amount2, lockTierId2)
        ).to.equal(calculatedAmount2);

        // Check node data
        expect(await meldStakingStorage.getNodeName(nodeId2)).to.equal(
          nodeName2
        );
        expect(await meldStakingStorage.getNodeOperator(nodeId2)).to.equal(
          operatorNFT2
        );
        expect(
          await meldStakingStorage.getNodeBaseStakedAmount(nodeId2)
        ).to.equal(amount2);
        expect(
          await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId2)
        ).to.equal(currentEpoch);
        expect(await meldStakingStorage.getNodeDelegatorFee(nodeId2)).to.equal(
          delegatorFee2
        );
        expect(
          await meldStakingStorage.getNodeMaxStakingAmount(nodeId2)
        ).to.equal(await meldStakingStorage.getMaxStakingAmount());
        expect(await meldStakingStorage.getNodeEndTimestamp(nodeId2)).to.equal(
          0n
        );
        expect(
          await meldStakingStorage.isDelegatorWhitelistEnabled(nodeId2)
        ).to.be.false;
        expect(await meldStakingStorage.getNodeDelegators(nodeId2)).to.eql([]);
        expect(
          await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
            nodeId2,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId2,
            currentEpoch
          )
        ).to.equal(calculatedAmount2);
        expect(await meldStakingStorage.getNumNodes()).to.eql(2n);

        // Check that the operator has the node NFT
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);
        expect(await meldStakingNFT.ownerOf(operatorNFT2)).to.equal(
          operator.address
        );
        expect(
          await meldStakingNFT.getAllTokensByOwner(operator.address)
        ).to.eql([operatorNFT1, operatorNFT2]);

        // Check the Staker NFT data
        expect(await meldStakingStorage.isStaker(operatorNFT2)).to.be.true;
        expect(await meldStakingStorage.isOperator(operatorNFT2)).to.be.true;
        expect(await meldStakingStorage.isDelegator(operatorNFT2)).to.be.false;
        expect(
          await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT2)
        ).to.equal(amount2);
        expect(await meldStakingStorage.getStakerNodeId(operatorNFT2)).to.equal(
          nodeId2
        );
        expect(
          await meldStakingStorage.getStakerLastEpochStakingUpdated(
            operatorNFT2
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLastEpochRewardsUpdated(
            operatorNFT2
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLockTierId(operatorNFT2)
        ).to.equal(lockTierId2);
        expect(
          await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT2)
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerStakingStartTimestamp(operatorNFT2)
        ).to.equal(approveTimestamp2);
        expect(
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            operatorNFT2,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            operatorNFT2,
            currentEpoch
          )
        ).to.equal(calculatedAmount2);
      });
      it("Should appprove two lock staking node requests correctly", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingCommon,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // REQUEST NODE 1

        // Add a staking tier
        const minStakingAmount1 = toMeldDecimals(110_000);
        const stakingLength1 = 10; // 10 epochs
        const weight1 = 120_00n; // 120%
        await meldStakingConfig.addStakingLockTier(
          minStakingAmount1,
          stakingLength1,
          weight1
        );

        // Params for the node request
        const nodeName1 = "testNode1";
        const delegatorFee1 = 10_00; // 10%
        const amount1 = toMeldDecimals(180_000);
        const lockTierId1 = await meldStakingStorage.lastLockStakingTierId();
        const metadata1 = "";

        const calculatedAmount1 = (amount1 * weight1) / PERCENTAGE_SCALING;

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName1,
          delegatorFee1,
          amount1,
          lockTierId1,
          metadata1
        );

        // Node id is the hash of the node name
        const nodeId1 = await meldStakingOperator.hashNodeId(nodeName1);

        const nodeRequest1 = await meldStakingStorage.getNodeRequest(nodeId1);
        const operatorNFT1 = nodeRequest1.operator;

        expect(await meldStakingStorage.nodeRequestExists(nodeId1)).to.be.true;
        expect(await meldStakingStorage.isNode(nodeId1)).to.be.false;

        // REQUEST NODE 2

        // Add a staking tier
        const minStakingAmount2 = toMeldDecimals(140_000);
        const stakingLength2 = 20; // 20 epochs
        const weight2 = 150_00n; // 150%
        await meldStakingConfig.addStakingLockTier(
          minStakingAmount2,
          stakingLength2,
          weight2
        );

        // Params for the node request
        const nodeName2 = "testNode2";
        const delegatorFee2 = 20_00; // 20%
        const amount2 = toMeldDecimals(230_000);
        const lockTierId2 = await meldStakingStorage.lastLockStakingTierId();
        const metadata2 = "";

        const calculatedAmount2 = (amount2 * weight2) / PERCENTAGE_SCALING;

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName2,
          delegatorFee2,
          amount2,
          lockTierId2,
          metadata2
        );

        // Node id is the hash of the node name
        const nodeId2 = await meldStakingOperator.hashNodeId(nodeName2);

        const nodeRequest2 = await meldStakingStorage.getNodeRequest(nodeId2);
        const operatorNFT2 = nodeRequest2.operator;

        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.true;
        expect(await meldStakingStorage.isNode(nodeId2)).to.be.false;

        const currentEpoch = await meldStakingStorage.getCurrentEpoch();

        // Admin approves the node request1
        const approveTx1 = await meldStakingConfig
          .connect(deployer)
          .approveNodeRequest(nodeId1);

        const block1 = await ethers.provider.getBlock(approveTx1.blockNumber!);
        const approveTimestamp1 = block1!.timestamp;

        // Check that the node request has been removed and the node has been created
        expect(await meldStakingStorage.nodeRequestExists(nodeId1)).to.be.false;

        expect(await meldStakingStorage.isNode(nodeId1)).to.be.true;
        expect(await meldStakingStorage.isNodeActive(nodeId1)).to.be.true;

        expect(
          await meldStakingCommon.getWeightedAmount(amount1, lockTierId1)
        ).to.equal(calculatedAmount1);

        // Admin approves the node request2
        const approveTx2 = await meldStakingConfig
          .connect(deployer)
          .approveNodeRequest(nodeId2);

        const block2 = await ethers.provider.getBlock(approveTx2.blockNumber!);
        const approveTimestamp2 = block2!.timestamp;

        // Check node 1 data

        // Check node data
        expect(await meldStakingStorage.getNodeName(nodeId1)).to.equal(
          nodeName1
        );
        expect(await meldStakingStorage.getNodeOperator(nodeId1)).to.equal(
          operatorNFT1
        );
        expect(
          await meldStakingStorage.getNodeBaseStakedAmount(nodeId1)
        ).to.equal(amount1);
        expect(
          await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId1)
        ).to.equal(currentEpoch);
        expect(await meldStakingStorage.getNodeDelegatorFee(nodeId1)).to.equal(
          delegatorFee1
        );
        expect(
          await meldStakingStorage.getNodeMaxStakingAmount(nodeId1)
        ).to.equal(await meldStakingStorage.getMaxStakingAmount());
        expect(await meldStakingStorage.getNodeEndTimestamp(nodeId1)).to.equal(
          0n
        );
        expect(
          await meldStakingStorage.isDelegatorWhitelistEnabled(nodeId1)
        ).to.be.false;
        expect(await meldStakingStorage.getNodeDelegators(nodeId1)).to.eql([]);
        expect(
          await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
            nodeId1,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId1,
            currentEpoch
          )
        ).to.equal(calculatedAmount1);
        expect(await meldStakingStorage.getNumNodes()).to.eql(2n);

        // Check that the operator has the node NFT
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);
        expect(await meldStakingNFT.ownerOf(operatorNFT1)).to.equal(
          operator.address
        );
        expect(
          await meldStakingNFT.getAllTokensByOwner(operator.address)
        ).to.eql([operatorNFT1, operatorNFT2]);

        // Check the Staker NFT data
        expect(await meldStakingStorage.isStaker(operatorNFT1)).to.be.true;
        expect(await meldStakingStorage.isOperator(operatorNFT1)).to.be.true;
        expect(await meldStakingStorage.isDelegator(operatorNFT1)).to.be.false;
        expect(
          await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT1)
        ).to.equal(amount1);
        expect(await meldStakingStorage.getStakerNodeId(operatorNFT1)).to.equal(
          nodeId1
        );
        expect(
          await meldStakingStorage.getStakerLastEpochStakingUpdated(
            operatorNFT1
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLastEpochRewardsUpdated(
            operatorNFT1
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLockTierId(operatorNFT1)
        ).to.equal(lockTierId1);
        expect(
          await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT1)
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerStakingStartTimestamp(operatorNFT1)
        ).to.equal(approveTimestamp1);
        expect(
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            operatorNFT1,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            operatorNFT1,
            currentEpoch
          )
        ).to.equal(calculatedAmount1);

        // Check node 2 data

        // Check that the node request has been removed and the node has been created
        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.false;

        expect(await meldStakingStorage.isNode(nodeId2)).to.be.true;
        expect(await meldStakingStorage.isNodeActive(nodeId2)).to.be.true;

        expect(
          await meldStakingCommon.getWeightedAmount(amount2, lockTierId2)
        ).to.equal(calculatedAmount2);

        // Check node data
        expect(await meldStakingStorage.getNodeName(nodeId2)).to.equal(
          nodeName2
        );
        expect(await meldStakingStorage.getNodeOperator(nodeId2)).to.equal(
          operatorNFT2
        );
        expect(
          await meldStakingStorage.getNodeBaseStakedAmount(nodeId2)
        ).to.equal(amount2);
        expect(
          await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId2)
        ).to.equal(currentEpoch);
        expect(await meldStakingStorage.getNodeDelegatorFee(nodeId2)).to.equal(
          delegatorFee2
        );
        expect(
          await meldStakingStorage.getNodeMaxStakingAmount(nodeId2)
        ).to.equal(await meldStakingStorage.getMaxStakingAmount());
        expect(await meldStakingStorage.getNodeEndTimestamp(nodeId2)).to.equal(
          0n
        );
        expect(
          await meldStakingStorage.isDelegatorWhitelistEnabled(nodeId2)
        ).to.be.false;
        expect(await meldStakingStorage.getNodeDelegators(nodeId2)).to.eql([]);
        expect(
          await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
            nodeId2,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId2,
            currentEpoch
          )
        ).to.equal(calculatedAmount2);
        expect(await meldStakingStorage.getNumNodes()).to.eql(2n);

        // Check that the operator has the node NFT
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);
        expect(await meldStakingNFT.ownerOf(operatorNFT2)).to.equal(
          operator.address
        );
        expect(
          await meldStakingNFT.getAllTokensByOwner(operator.address)
        ).to.eql([operatorNFT1, operatorNFT2]);

        // Check the Staker NFT data
        expect(await meldStakingStorage.isStaker(operatorNFT2)).to.be.true;
        expect(await meldStakingStorage.isOperator(operatorNFT2)).to.be.true;
        expect(await meldStakingStorage.isDelegator(operatorNFT2)).to.be.false;
        expect(
          await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT2)
        ).to.equal(amount2);
        expect(await meldStakingStorage.getStakerNodeId(operatorNFT2)).to.equal(
          nodeId2
        );
        expect(
          await meldStakingStorage.getStakerLastEpochStakingUpdated(
            operatorNFT2
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLastEpochRewardsUpdated(
            operatorNFT2
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLockTierId(operatorNFT2)
        ).to.equal(lockTierId2);
        expect(
          await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT2)
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerStakingStartTimestamp(operatorNFT2)
        ).to.equal(approveTimestamp2);
        expect(
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            operatorNFT2,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            operatorNFT2,
            currentEpoch
          )
        ).to.equal(calculatedAmount2);
      });
      it("Should appprove two node requests (liquid and locked) correctly in reverse order", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingCommon,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // REQUEST NODE 1

        // Add a staking tier
        const minStakingAmount1 = toMeldDecimals(110_000);
        const stakingLength1 = 10; // 10 epochs
        const weight1 = 120_00n; // 120%
        await meldStakingConfig.addStakingLockTier(
          minStakingAmount1,
          stakingLength1,
          weight1
        );

        // Params for the node request
        const nodeName1 = "testNode1";
        const delegatorFee1 = 10_00; // 10%
        const amount1 = toMeldDecimals(185_000);
        const lockTierId1 = await meldStakingStorage.lastLockStakingTierId();
        const metadata1 = "";

        const calculatedAmount1 = (amount1 * weight1) / PERCENTAGE_SCALING;

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName1,
          delegatorFee1,
          amount1,
          lockTierId1,
          metadata1
        );

        // Node id is the hash of the node name
        const nodeId1 = await meldStakingOperator.hashNodeId(nodeName1);

        const nodeRequest1 = await meldStakingStorage.getNodeRequest(nodeId1);
        const operatorNFT1 = nodeRequest1.operator;

        expect(await meldStakingStorage.nodeRequestExists(nodeId1)).to.be.true;
        expect(await meldStakingStorage.isNode(nodeId1)).to.be.false;

        // REQUEST NODE 2

        // Params for the node request
        const nodeName2 = "testNode2";
        const delegatorFee2 = 20_00; // 20%
        const amount2 = toMeldDecimals(235_000);
        const lockTierId2 = 0;
        const metadata2 = "";

        const calculatedAmount2 = amount2;

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName2,
          delegatorFee2,
          amount2,
          lockTierId2,
          metadata2
        );

        // Node id is the hash of the node name
        const nodeId2 = await meldStakingOperator.hashNodeId(nodeName2);

        const nodeRequest2 = await meldStakingStorage.getNodeRequest(nodeId2);
        const operatorNFT2 = nodeRequest2.operator;

        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.true;
        expect(await meldStakingStorage.isNode(nodeId2)).to.be.false;

        const currentEpoch = await meldStakingStorage.getCurrentEpoch();

        // Admin approves the node request2
        const approveTx2 = await meldStakingConfig
          .connect(deployer)
          .approveNodeRequest(nodeId2);

        const block2 = await ethers.provider.getBlock(approveTx2.blockNumber!);
        const approveTimestamp2 = block2!.timestamp;

        // Check that the node request has been removed and the node has been created
        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.false;

        expect(await meldStakingStorage.isNode(nodeId2)).to.be.true;
        expect(await meldStakingStorage.isNodeActive(nodeId2)).to.be.true;

        expect(
          await meldStakingCommon.getWeightedAmount(amount2, lockTierId2)
        ).to.equal(calculatedAmount2);

        // Check node data
        expect(await meldStakingStorage.getNodeName(nodeId2)).to.equal(
          nodeName2
        );
        expect(await meldStakingStorage.getNodeOperator(nodeId2)).to.equal(
          operatorNFT2
        );
        expect(
          await meldStakingStorage.getNodeBaseStakedAmount(nodeId2)
        ).to.equal(amount2);
        expect(
          await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId2)
        ).to.equal(currentEpoch);
        expect(await meldStakingStorage.getNodeDelegatorFee(nodeId2)).to.equal(
          delegatorFee2
        );
        expect(
          await meldStakingStorage.getNodeMaxStakingAmount(nodeId2)
        ).to.equal(await meldStakingStorage.getMaxStakingAmount());
        expect(await meldStakingStorage.getNodeEndTimestamp(nodeId2)).to.equal(
          0n
        );
        expect(
          await meldStakingStorage.isDelegatorWhitelistEnabled(nodeId2)
        ).to.be.false;
        expect(await meldStakingStorage.getNodeDelegators(nodeId2)).to.eql([]);
        expect(
          await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
            nodeId2,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId2,
            currentEpoch
          )
        ).to.equal(calculatedAmount2);
        expect(await meldStakingStorage.getNumNodes()).to.eql(1n);

        // Check that the operator has the node NFT
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);
        expect(await meldStakingNFT.ownerOf(operatorNFT2)).to.equal(
          operator.address
        );
        expect(
          await meldStakingNFT.getAllTokensByOwner(operator.address)
        ).to.eql([operatorNFT1, operatorNFT2]);

        // Check the Staker NFT data
        expect(await meldStakingStorage.isStaker(operatorNFT2)).to.be.true;
        expect(await meldStakingStorage.isOperator(operatorNFT2)).to.be.true;
        expect(await meldStakingStorage.isDelegator(operatorNFT2)).to.be.false;
        expect(
          await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT2)
        ).to.equal(amount2);
        expect(await meldStakingStorage.getStakerNodeId(operatorNFT2)).to.equal(
          nodeId2
        );
        expect(
          await meldStakingStorage.getStakerLastEpochStakingUpdated(
            operatorNFT2
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLastEpochRewardsUpdated(
            operatorNFT2
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLockTierId(operatorNFT2)
        ).to.equal(lockTierId2);
        expect(
          await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT2)
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerStakingStartTimestamp(operatorNFT2)
        ).to.equal(approveTimestamp2);
        expect(
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            operatorNFT2,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            operatorNFT2,
            currentEpoch
          )
        ).to.equal(calculatedAmount2);

        // Admin approves the node request1
        const approveTx1 = await meldStakingConfig
          .connect(deployer)
          .approveNodeRequest(nodeId1);

        const block1 = await ethers.provider.getBlock(approveTx1.blockNumber!);
        const approveTimestamp1 = block1!.timestamp;

        // Check that the node request has been removed and the node has been created
        expect(await meldStakingStorage.nodeRequestExists(nodeId1)).to.be.false;

        expect(await meldStakingStorage.isNode(nodeId1)).to.be.true;
        expect(await meldStakingStorage.isNodeActive(nodeId1)).to.be.true;

        expect(
          await meldStakingCommon.getWeightedAmount(amount1, lockTierId1)
        ).to.equal(calculatedAmount1);

        // Check node data
        expect(await meldStakingStorage.getNodeName(nodeId1)).to.equal(
          nodeName1
        );
        expect(await meldStakingStorage.getNodeOperator(nodeId1)).to.equal(
          operatorNFT1
        );
        expect(
          await meldStakingStorage.getNodeBaseStakedAmount(nodeId1)
        ).to.equal(amount1);
        expect(
          await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId1)
        ).to.equal(currentEpoch);
        expect(await meldStakingStorage.getNodeDelegatorFee(nodeId1)).to.equal(
          delegatorFee1
        );
        expect(
          await meldStakingStorage.getNodeMaxStakingAmount(nodeId1)
        ).to.equal(await meldStakingStorage.getMaxStakingAmount());
        expect(await meldStakingStorage.getNodeEndTimestamp(nodeId1)).to.equal(
          0n
        );
        expect(
          await meldStakingStorage.isDelegatorWhitelistEnabled(nodeId1)
        ).to.be.false;
        expect(await meldStakingStorage.getNodeDelegators(nodeId1)).to.eql([]);
        expect(
          await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
            nodeId1,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
            nodeId1,
            currentEpoch
          )
        ).to.equal(calculatedAmount1);
        expect(await meldStakingStorage.getNumNodes()).to.eql(2n);

        // Check that the operator has the node NFT
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);
        expect(await meldStakingNFT.ownerOf(operatorNFT1)).to.equal(
          operator.address
        );
        expect(
          await meldStakingNFT.getAllTokensByOwner(operator.address)
        ).to.eql([operatorNFT1, operatorNFT2]);

        // Check the Staker NFT data
        expect(await meldStakingStorage.isStaker(operatorNFT1)).to.be.true;
        expect(await meldStakingStorage.isOperator(operatorNFT1)).to.be.true;
        expect(await meldStakingStorage.isDelegator(operatorNFT1)).to.be.false;
        expect(
          await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT1)
        ).to.equal(amount1);
        expect(await meldStakingStorage.getStakerNodeId(operatorNFT1)).to.equal(
          nodeId1
        );
        expect(
          await meldStakingStorage.getStakerLastEpochStakingUpdated(
            operatorNFT1
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLastEpochRewardsUpdated(
            operatorNFT1
          )
        ).to.equal(currentEpoch);
        expect(
          await meldStakingStorage.getStakerLockTierId(operatorNFT1)
        ).to.equal(lockTierId1);
        expect(
          await meldStakingStorage.getStakerUnclaimedRewards(operatorNFT1)
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerStakingStartTimestamp(operatorNFT1)
        ).to.equal(approveTimestamp1);
        expect(
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            operatorNFT1,
            currentEpoch
          )
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            operatorNFT1,
            currentEpoch
          )
        ).to.equal(calculatedAmount1);
      });
    }); // End of approveNodeRequest Happy flow test cases

    context("Error test cases", function () {
      it("Should fail to approve a node request if the caller is not the admin", async function () {
        const { rando, meldStakingConfig } = await loadFixture(
          stakingStartedFixture
        );

        const fakeNodeId = ethers.ZeroHash;

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

        await expect(
          meldStakingConfig.connect(rando).approveNodeRequest(fakeNodeId)
        ).to.be.revertedWith(expectedException);
      });
      it("Should fail to approve a node request if the node request does not exist", async function () {
        const { deployer, meldStakingConfig } = await loadFixture(
          stakingStartedFixture
        );

        const fakeNodeId = ethers.ZeroHash;

        await expect(
          meldStakingConfig.connect(deployer).approveNodeRequest(fakeNodeId)
        ).to.be.revertedWith(Errors.NODE_REQUEST_DOES_NOT_EXIST);
      });
      it("Should fail to approve a node request if the node request has already been approved", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Params for the node request
        const nodeName = "testNode";
        const delegatorFee = 10_00n; // 10%
        const amount = toMeldDecimals(135_000);
        const lockTierId = 0;
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

        await expect(
          meldStakingConfig.connect(deployer).approveNodeRequest(nodeId)
        ).to.be.revertedWith(Errors.NODE_REQUEST_DOES_NOT_EXIST);
      });
    }); // End of approveNodeRequest Error test cases
  }); // End of approveNodeRequest context

  context("rejectNodeRequest", function () {
    context("Happy flow test cases", function () {
      it("Should emit the NodeRequestRejected event when rejecting a node request", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Params for the node request
        const nodeName = "testNode";
        const delegatorFee = 10_00n; // 10%
        const amount = toMeldDecimals(140_000);
        const lockTierId = 0;
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

        const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);

        const rejectNodeRequestTx = await meldStakingConfig
          .connect(deployer)
          .rejectNodeRequest(nodeId);

        await expect(rejectNodeRequestTx)
          .to.emit(meldStakingConfig, "NodeRequestRejected")
          .withArgs(deployer.address, nodeId, nodeRequest.operator, amount);

        await expect(rejectNodeRequestTx)
          .to.emit(meldToken, "Transfer")
          .withArgs(
            await meldStakingNFT.getAddress(),
            operator.address,
            amount
          );

        await expect(rejectNodeRequestTx)
          .to.emit(meldStakingNFT, "MeldWithdrawn")
          .withArgs(operator.address, amount);

        await expect(rejectNodeRequestTx)
          .to.emit(meldStakingNFT, "Redeemed")
          .withArgs(operator.address, nodeRequest.operator);
      });
      it("Should remove the node request when rejecting a node request", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Params for the node request
        const nodeName = "testNode";
        const delegatorFee = 10_00n; // 10%
        const amount = toMeldDecimals(145_000);
        const lockTierId = 0;
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

        const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);

        const operatorMeldBalanceBefore = await meldToken.balanceOf(
          operator.address
        );

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1n);
        expect(await meldStakingNFT.ownerOf(nodeRequest.operator)).to.equal(
          operator.address
        );

        await meldStakingConfig.connect(deployer).rejectNodeRequest(nodeId);

        const operatorMeldBalanceAfter = await meldToken.balanceOf(
          operator.address
        );

        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.false;

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(0n);
        expect(await meldStakingNFT.exists(nodeRequest.operator)).to.be.false;

        expect(operatorMeldBalanceAfter).to.equal(
          operatorMeldBalanceBefore + amount
        );
      });
      it("Should remove remove multiple node requests", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // REQUEST NODE 1

        // Params for the node request
        const nodeName1 = "testNode1";
        const delegatorFee1 = 10_00; // 10%
        const amount1 = toMeldDecimals(190_000);
        const lockTierId1 = 0;
        const metadata1 = "";

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName1,
          delegatorFee1,
          amount1,
          lockTierId1,
          metadata1
        );

        // Node id is the hash of the node name
        const nodeId1 = await meldStakingOperator.hashNodeId(nodeName1);

        const nodeRequest1 = await meldStakingStorage.getNodeRequest(nodeId1);

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1n);
        expect(await meldStakingNFT.ownerOf(nodeRequest1.operator)).to.equal(
          operator.address
        );

        expect(await meldStakingStorage.nodeRequestExists(nodeId1)).to.be.true;
        expect(await meldStakingStorage.isNode(nodeId1)).to.be.false;

        // REQUEST NODE 2

        // Params for the node request
        const nodeName2 = "testNode2";
        const delegatorFee2 = 20_00; // 20%
        const amount2 = toMeldDecimals(240_000);
        const lockTierId2 = 0;
        const metadata2 = "";

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName2,
          delegatorFee2,
          amount2,
          lockTierId2,
          metadata2
        );

        // Node id is the hash of the node name
        const nodeId2 = await meldStakingOperator.hashNodeId(nodeName2);

        const nodeRequest2 = await meldStakingStorage.getNodeRequest(nodeId2);

        const operatorMeldBalanceBefore = await meldToken.balanceOf(
          operator.address
        );

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2n);
        expect(await meldStakingNFT.ownerOf(nodeRequest2.operator)).to.equal(
          operator.address
        );

        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.true;
        expect(await meldStakingStorage.isNode(nodeId2)).to.be.false;

        // Admin rejects the node request2

        await meldStakingConfig.connect(deployer).rejectNodeRequest(nodeId2);

        const operatorMeldBalanceAfter2 = await meldToken.balanceOf(
          operator.address
        );

        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.false;

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1n);
        expect(await meldStakingNFT.exists(nodeRequest2.operator)).to.be.false;

        expect(operatorMeldBalanceAfter2).to.equal(
          operatorMeldBalanceBefore + amount2
        );

        // Admin rejects the node request1

        await meldStakingConfig.connect(deployer).rejectNodeRequest(nodeId1);

        const operatorMeldBalanceAfter1 = await meldToken.balanceOf(
          operator.address
        );

        expect(await meldStakingStorage.nodeRequestExists(nodeId1)).to.be.false;

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(0n);
        expect(await meldStakingNFT.exists(nodeRequest1.operator)).to.be.false;

        expect(operatorMeldBalanceAfter1).to.equal(
          operatorMeldBalanceAfter2 + amount1
        );
      });
    }); // End of rejectNodeRequest Happy flow test cases

    context("Error test cases", function () {
      it("Should fail to reject a node request if the caller is not the admin", async function () {
        const { rando, meldStakingConfig } = await loadFixture(
          stakingStartedFixture
        );

        const fakeNodeId = ethers.ZeroHash;

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

        await expect(
          meldStakingConfig.connect(rando).rejectNodeRequest(fakeNodeId)
        ).to.be.revertedWith(expectedException);
      });
      it("Should fail to reject a node request if the node request does not exist", async function () {
        const { deployer, meldStakingConfig } = await loadFixture(
          stakingStartedFixture
        );

        const fakeNodeId = ethers.ZeroHash;

        await expect(
          meldStakingConfig.connect(deployer).rejectNodeRequest(fakeNodeId)
        ).to.be.revertedWith(Errors.NODE_REQUEST_DOES_NOT_EXIST);
      });
    }); // End of rejectNodeRequest Error test cases
  }); // End of rejectNodeRequest context

  context("slashNode", function () {
    context("slashNode fully", function () {
      context("Only operator", function () {
        context("Liquid staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount = toMeldDecimals(150_000);
            const lockTierId = 0;
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
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            // Slash the node
            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, 100_00n);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(deployer.address, nodeId, amount, 100_00n);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, amount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, amount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount = toMeldDecimals(155_000);
            const lockTierId = 0;
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

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(amount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(amount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, 100_00n);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFT data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(amount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              amount
            );
          });
        }); // End of Only operator Liquid staking context
        context("Locked staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount = toMeldDecimals(160_000);
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
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            // Slash the node
            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, 100_00n);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(deployer.address, nodeId, amount, 100_00n);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, amount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, amount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount = toMeldDecimals(165_000);
            const lockTierId = await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            const calculatedAmount = (amount * weight) / PERCENTAGE_SCALING;

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

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, 100_00n);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFT data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              amount
            );
          });
        }); // End of Only operator Locked staking context
      }); // End of Only operator test cases
      context("Operator and delegators", function () {
        context("Liquid staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount1 = toMeldDecimals(195_000);
            const lockTierId1 = 0;
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
            totalStakedAmount += amount1;

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(245_000);
            const lockTierId2 = 0;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            totalStakedAmount += amount2;

            // Slash the node
            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, 100_00n);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(deployer.address, nodeId, totalStakedAmount, 100_00n);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, totalStakedAmount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, totalStakedAmount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount1 = toMeldDecimals(200_000);
            const lockTierId1 = 0;
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            totalStakedAmount += amount1;
            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(250_000);
            const lockTierId2 = 0;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            const delegatorNFT = (
              await meldStakingStorage.getNodeDelegators(nodeId)
            )[0];

            totalStakedAmount += amount2;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, 100_00n);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFTs data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn

            const feeAmount = (amount2 * delegatorFee) / PERCENTAGE_SCALING;
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount1);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(amount1 + feeAmount);

            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(delegatorNFT)
            ).to.equal(amount2);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorNFT,
                currentEpoch
              )
            ).to.equal(amount2 - feeAmount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              totalStakedAmount
            );
          });
        }); // End of Operator and delegators Liquid staking context
        context("Locked staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(205_000);
            const lockTierId1 =
              await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
            totalStakedAmount += amount1;

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(255_000);
            const lockTierId2 =
              await meldStakingStorage.lastLockStakingTierId();

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            totalStakedAmount += amount2;

            // Slash the node
            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, 100_00n);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(deployer.address, nodeId, totalStakedAmount, 100_00n);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, totalStakedAmount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, totalStakedAmount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(210_000);
            const lockTierId1 =
              await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            const calculatedAmount1 = (amount1 * weight) / PERCENTAGE_SCALING;

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            totalStakedAmount += amount1;
            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(260_000);
            const lockTierId2 =
              await meldStakingStorage.lastLockStakingTierId();

            const calculatedAmount2 = (amount2 * weight) / PERCENTAGE_SCALING;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            const delegatorNFT = (
              await meldStakingStorage.getNodeDelegators(nodeId)
            )[0];

            totalStakedAmount += amount2;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, 100_00n);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFTs data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn

            const feeAmount = (amount2 * delegatorFee) / PERCENTAGE_SCALING;
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount1);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount1 + feeAmount);

            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(delegatorNFT)
            ).to.equal(amount2);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount2 - feeAmount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              totalStakedAmount
            );
          });
        }); // End of Operator and delegators Locked staking context
        context("Mixed staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(215_000);
            const lockTierId1 =
              await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
            totalStakedAmount += amount1;

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(265_000);
            const lockTierId2 = 0;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            totalStakedAmount += amount2;

            // Slash the node
            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, 100_00n);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(deployer.address, nodeId, totalStakedAmount, 100_00n);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, totalStakedAmount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, totalStakedAmount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(220_000);
            const lockTierId1 = 0;
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            totalStakedAmount += amount1;
            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(270_000);
            const lockTierId2 =
              await meldStakingStorage.lastLockStakingTierId();

            const calculatedAmount2 = (amount2 * weight) / PERCENTAGE_SCALING;

            await await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            const delegatorNFT = (
              await meldStakingStorage.getNodeDelegators(nodeId)
            )[0];

            totalStakedAmount += amount2;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, 100_00n);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFTs data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn

            const feeAmount = (amount2 * delegatorFee) / PERCENTAGE_SCALING;
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount1);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(amount1 + feeAmount);

            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(delegatorNFT)
            ).to.equal(amount2);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount2 - feeAmount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              totalStakedAmount
            );
          });
        }); // End of Operator and delegators Mixed staking context
      }); // End of Operator and delegators test cases
    }); // End of slashNode fully context

    context("slashNode partially 25%", function () {
      context("Only operator", function () {
        context("Liquid staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount = toMeldDecimals(150_000);
            const lockTierId = 0;
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
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            // Slash the node
            const slashPercentage = 25_00n; // 25%

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(deployer.address, nodeId, amount, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, amount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, amount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount = toMeldDecimals(155_000);
            const lockTierId = 0;
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

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(amount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(amount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashPercentage = 25_00n; // 25%

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFT data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(amount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              amount
            );
          });
        }); // End of Only operator Liquid staking context
        context("Locked staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount = toMeldDecimals(160_000);
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
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            // Slash the node
            const slashPercentage = 25_00n; // 25%

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(deployer.address, nodeId, amount, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, amount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, amount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount = toMeldDecimals(165_000);
            const lockTierId = await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            const calculatedAmount = (amount * weight) / PERCENTAGE_SCALING;

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

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashPercentage = 25_00n; // 25%

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFT data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              amount
            );
          });
        }); // End of Only operator Locked staking context
      }); // End of Only operator test cases
      context("Operator and delegators", function () {
        context("Liquid staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount1 = toMeldDecimals(195_000);
            const lockTierId1 = 0;
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
            totalStakedAmount += amount1;

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(245_000);
            const lockTierId2 = 0;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            totalStakedAmount += amount2;

            // Slash the node
            const slashPercentage = 25_00n; // 25%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount =
              amount1 + (slashPercentage * amount2) / PERCENTAGE_SCALING;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(
                deployer.address,
                nodeId,
                expectedSlashAmount,
                slashPercentage
              );

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, totalStakedAmount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, expectedSlashAmount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount1 = toMeldDecimals(200_000);
            const lockTierId1 = 0;
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            totalStakedAmount += amount1;
            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(250_000);
            const lockTierId2 = 0;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            const delegatorNFT = (
              await meldStakingStorage.getNodeDelegators(nodeId)
            )[0];

            totalStakedAmount += amount2;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashPercentage = 25_00n; // 25%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount =
              amount1 + (slashPercentage * amount2) / PERCENTAGE_SCALING;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFTs data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn

            const feeAmount = (amount2 * delegatorFee) / PERCENTAGE_SCALING;
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount1);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(amount1 + feeAmount);

            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(delegatorNFT)
            ).to.equal(amount2);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorNFT,
                currentEpoch
              )
            ).to.equal(amount2 - feeAmount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              expectedSlashAmount
            );
          });
        }); // End of Operator and delegators Liquid staking context
        context("Locked staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(205_000);
            const lockTierId1 =
              await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
            totalStakedAmount += amount1;

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(255_000);
            const lockTierId2 =
              await meldStakingStorage.lastLockStakingTierId();

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            totalStakedAmount += amount2;

            // Slash the node
            const slashPercentage = 25_00n; // 25%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount =
              amount1 + (slashPercentage * amount2) / PERCENTAGE_SCALING;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(
                deployer.address,
                nodeId,
                expectedSlashAmount,
                slashPercentage
              );

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, totalStakedAmount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, expectedSlashAmount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(210_000);
            const lockTierId1 =
              await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            const calculatedAmount1 = (amount1 * weight) / PERCENTAGE_SCALING;

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            totalStakedAmount += amount1;
            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(260_000);
            const lockTierId2 =
              await meldStakingStorage.lastLockStakingTierId();

            const calculatedAmount2 = (amount2 * weight) / PERCENTAGE_SCALING;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            const delegatorNFT = (
              await meldStakingStorage.getNodeDelegators(nodeId)
            )[0];

            totalStakedAmount += amount2;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashPercentage = 25_00n; // 25%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount =
              amount1 + (slashPercentage * amount2) / PERCENTAGE_SCALING;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFTs data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn

            const feeAmount = (amount2 * delegatorFee) / PERCENTAGE_SCALING;
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount1);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount1 + feeAmount);

            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(delegatorNFT)
            ).to.equal(amount2);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount2 - feeAmount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              expectedSlashAmount
            );
          });
        }); // End of Operator and delegators Locked staking context
        context("Mixed staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(215_000);
            const lockTierId1 =
              await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
            totalStakedAmount += amount1;

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(265_000);
            const lockTierId2 = 0;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            totalStakedAmount += amount2;

            // Slash the node
            const slashPercentage = 25_00n; // 25%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount =
              amount1 + (slashPercentage * amount2) / PERCENTAGE_SCALING;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(
                deployer.address,
                nodeId,
                expectedSlashAmount,
                slashPercentage
              );

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, totalStakedAmount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, expectedSlashAmount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(220_000);
            const lockTierId1 = 0;
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            totalStakedAmount += amount1;
            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(270_000);
            const lockTierId2 =
              await meldStakingStorage.lastLockStakingTierId();

            const calculatedAmount2 = (amount2 * weight) / PERCENTAGE_SCALING;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            const delegatorNFT = (
              await meldStakingStorage.getNodeDelegators(nodeId)
            )[0];

            totalStakedAmount += amount2;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashPercentage = 25_00n; // 25%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount =
              amount1 + (slashPercentage * amount2) / PERCENTAGE_SCALING;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFTs data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn

            const feeAmount = (amount2 * delegatorFee) / PERCENTAGE_SCALING;
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount1);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(amount1 + feeAmount);

            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(delegatorNFT)
            ).to.equal(amount2);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount2 - feeAmount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              expectedSlashAmount
            );
          });
        }); // End of Operator and delegators Mixed staking context
      }); // End of Operator and delegators test cases
    }); // End of slashNode partially context

    context("slashNode partially 0%", function () {
      context("Only operator", function () {
        context("Liquid staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount = toMeldDecimals(150_000);
            const lockTierId = 0;
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
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            // Slash the node
            const slashPercentage = 0; //0%

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(deployer.address, nodeId, amount, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, amount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, amount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount = toMeldDecimals(155_000);
            const lockTierId = 0;
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

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(amount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(amount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashPercentage = 0; //0%

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFT data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(amount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              amount
            );
          });
        }); // End of Only operator Liquid staking context
        context("Locked staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount = toMeldDecimals(160_000);
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
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            // Slash the node
            const slashPercentage = 0; //0%

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(deployer.address, nodeId, amount, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, amount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, amount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount = toMeldDecimals(165_000);
            const lockTierId = await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            const calculatedAmount = (amount * weight) / PERCENTAGE_SCALING;

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

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashPercentage = 0; //0%

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFT data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              amount
            );
          });
        }); // End of Only operator Locked staking context
      }); // End of Only operator test cases
      context("Operator and delegators", function () {
        context("Liquid staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount1 = toMeldDecimals(195_000);
            const lockTierId1 = 0;
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
            totalStakedAmount += amount1;

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(245_000);
            const lockTierId2 = 0;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            totalStakedAmount += amount2;

            // Slash the node
            const slashPercentage = 0; //0%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount = amount1;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(
                deployer.address,
                nodeId,
                expectedSlashAmount,
                slashPercentage
              );

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, totalStakedAmount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, expectedSlashAmount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // REQUEST NODE

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00n; // 10%
            const amount1 = toMeldDecimals(200_000);
            const lockTierId1 = 0;
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            totalStakedAmount += amount1;
            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(250_000);
            const lockTierId2 = 0;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            const delegatorNFT = (
              await meldStakingStorage.getNodeDelegators(nodeId)
            )[0];

            totalStakedAmount += amount2;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashPercentage = 0; //0%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount = amount1;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFTs data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn

            const feeAmount = (amount2 * delegatorFee) / PERCENTAGE_SCALING;
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount1);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(amount1 + feeAmount);

            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(delegatorNFT)
            ).to.equal(amount2);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorNFT,
                currentEpoch
              )
            ).to.equal(amount2 - feeAmount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              expectedSlashAmount
            );
          });
        }); // End of Operator and delegators Liquid staking context
        context("Locked staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(205_000);
            const lockTierId1 =
              await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
            totalStakedAmount += amount1;

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(255_000);
            const lockTierId2 =
              await meldStakingStorage.lastLockStakingTierId();

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            totalStakedAmount += amount2;

            // Slash the node
            const slashPercentage = 0; //0%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount = amount1;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(
                deployer.address,
                nodeId,
                expectedSlashAmount,
                slashPercentage
              );

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, totalStakedAmount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, expectedSlashAmount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(210_000);
            const lockTierId1 =
              await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            const calculatedAmount1 = (amount1 * weight) / PERCENTAGE_SCALING;

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            totalStakedAmount += amount1;
            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(260_000);
            const lockTierId2 =
              await meldStakingStorage.lastLockStakingTierId();

            const calculatedAmount2 = (amount2 * weight) / PERCENTAGE_SCALING;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            const delegatorNFT = (
              await meldStakingStorage.getNodeDelegators(nodeId)
            )[0];

            totalStakedAmount += amount2;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashPercentage = 0; //0%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount = amount1;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFTs data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn

            const feeAmount = (amount2 * delegatorFee) / PERCENTAGE_SCALING;
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount1);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount1 + feeAmount);

            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(delegatorNFT)
            ).to.equal(amount2);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount2 - feeAmount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              expectedSlashAmount
            );
          });
        }); // End of Operator and delegators Locked staking context
        context("Mixed staking", function () {
          it("Should emit the NodeSlashed event when slashing a node", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(215_000);
            const lockTierId1 =
              await meldStakingStorage.lastLockStakingTierId();
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
            totalStakedAmount += amount1;

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(265_000);
            const lockTierId2 = 0;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            totalStakedAmount += amount2;

            // Slash the node
            const slashPercentage = 0; //0%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount = amount1;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            await expect(slashTx)
              .to.emit(meldStakingConfig, "NodeSlashed")
              .withArgs(
                deployer.address,
                nodeId,
                expectedSlashAmount,
                slashPercentage
              );

            await expect(slashTx)
              .to.emit(meldStakingConfig, "TotalBaseStakedAmountChanged")
              .withArgs(deployer.address, totalStakedAmount, 0);

            await expect(slashTx)
              .to.emit(meldStakingNFT, "MeldWithdrawn")
              .withArgs(slashReceiver.address, expectedSlashAmount);
          });
          it("Should slash the node correctly", async function () {
            const {
              deployer,
              operator,
              delegator,
              slashReceiver,
              meldStakingConfig,
              meldStakingOperator,
              meldStakingDelegator,
              meldStakingStorage,
              meldStakingNFT,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            let totalStakedAmount = 0n;

            // Add a staking tier
            const minStakingAmount = toMeldDecimals(110_000);
            const stakingLength = 10; // 10 epochs
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
            const amount1 = toMeldDecimals(220_000);
            const lockTierId1 = 0;
            const metadata = "";

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount1,
              lockTierId1,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
            const operatorNFT = nodeRequest.operator;

            // Admin approves the node request
            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            totalStakedAmount += amount1;
            expect(await meldStakingStorage.isNode(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.false;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // DELEGATE TO THE NODE
            // Params for the delegator stake
            const amount2 = toMeldDecimals(270_000);
            const lockTierId2 =
              await meldStakingStorage.lastLockStakingTierId();

            const calculatedAmount2 = (amount2 * weight) / PERCENTAGE_SCALING;

            await delegateToNode(
              meldToken,
              meldStakingDelegator,
              meldStakingNFT,
              deployer,
              delegator,
              amount2,
              nodeId,
              lockTierId2
            );

            const delegatorNFT = (
              await meldStakingStorage.getNodeDelegators(nodeId)
            )[0];

            totalStakedAmount += amount2;
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(totalStakedAmount);
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(totalStakedAmount);

            // Check the slash receiver balance before the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              0n
            );

            // Slash the node
            const slashPercentage = 0; //0%

            // Slashes 100% of operator stake + slashPercentage of delegators stake
            const expectedSlashAmount = amount1;

            const slashTx = await meldStakingConfig
              .connect(deployer)
              .slashNode(nodeId, slashPercentage);

            // get tx timestamp
            const block = await ethers.provider.getBlock(slashTx.blockNumber!);
            const slashTimestamp = block!.timestamp;

            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Check node data
            expect(
              await meldStakingStorage.getNodeBaseStakedAmount(nodeId)
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeMinStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastStakedAmountPerEpoch(
                nodeId,
                currentEpoch
              )
            ).to.equal(0n);
            expect(
              await meldStakingStorage.getNodeLastEpochStakingUpdated(nodeId)
            ).to.equal(currentEpoch);
            expect(
              await meldStakingStorage.getNodeEndTimestamp(nodeId)
            ).to.equal(slashTimestamp);
            expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
            expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;

            // Check the Staker NFTs data
            // The NFT staked amount values don't change when slashing a node
            // But they can't withdraw the staked amount if the node is slashed
            // Only the unclaimed rewards can be withdrawn

            const feeAmount = (amount2 * delegatorFee) / PERCENTAGE_SCALING;
            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(operatorNFT)
            ).to.equal(amount1);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                operatorNFT,
                currentEpoch
              )
            ).to.equal(amount1 + feeAmount);

            expect(
              await meldStakingStorage.getStakerBaseStakedAmount(delegatorNFT)
            ).to.equal(amount2);
            expect(
              await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
                delegatorNFT,
                currentEpoch
              )
            ).to.equal(calculatedAmount2 - feeAmount);

            // Check total base staked amount
            expect(
              await meldStakingStorage.getTotalBaseStakedAmount()
            ).to.equal(0n);

            // Check the slash receiver balance after the slash
            expect(await meldToken.balanceOf(slashReceiver.address)).to.equal(
              expectedSlashAmount
            );
          });
        }); // End of Operator and delegators Mixed staking context
      }); // End of Operator and delegators test cases
    }); // End of slashNode partially context

    context("Error test cases", function () {
      it("Should fail to slash a node if the caller is not the admin", async function () {
        const { rando, meldStakingConfig } = await loadFixture(
          stakingStartedFixture
        );

        const fakeNodeId = ethers.ZeroHash;
        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

        await expect(
          meldStakingConfig.connect(rando).slashNode(fakeNodeId, 100_00n)
        ).to.be.revertedWith(expectedException);
      });
      it("Should fail to slash a node if the node is not active", async function () {
        const { deployer, meldStakingConfig } = await loadFixture(
          stakingStartedFixture
        );

        const fakeNodeId = ethers.ZeroHash;

        await expect(
          meldStakingConfig.connect(deployer).slashNode(fakeNodeId, 100_00n)
        ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
      });
      it("Should fail to slash a node if the node has already been slashed", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Params for the node request
        const nodeName = "testNode";
        const delegatorFee = 10_00n; // 10%
        const amount = toMeldDecimals(170_000);
        const lockTierId = 0;
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

        await expect(
          meldStakingConfig.connect(deployer).slashNode(nodeId, 100_00n)
        ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
      });

      it("Should fail to slash a node if the slash percentage is over 100%", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Params for the node request
        const nodeName = "testNode";
        const delegatorFee = 10_00n; // 10%
        const amount = toMeldDecimals(170_000);
        const lockTierId = 0;
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
        const slashPercentage = 101_00n;
        await expect(
          meldStakingConfig.connect(deployer).slashNode(nodeId, slashPercentage)
        ).to.be.revertedWith(Errors.SLASH_PERCENTAGE_TOO_HIGH);
      });
    }); // End of slashNode Error test cases
  }); // End of slashNode context
});
