import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ZeroAddress, ZeroHash } from "ethers";
import { ethers } from "hardhat";
import { Errors } from "./utils/errors";
import {
  delegateToNode,
  deployAndConfigContracts,
  deployContracts,
  requestNode,
  toMeldDecimals,
  transferAndApproveTokens,
} from "./utils/utils";

describe("MeldStakingOperator", function () {
  // Only deploy the contracts, no initialization
  async function onlyDeployFixture() {
    const [deployer, rando, slashReceiver, operator, operator2] =
      await ethers.getSigners();
    const contracts = await deployContracts(deployer.address);
    return {
      deployer,
      rando,
      slashReceiver,
      operator,
      operator2,
      ...contracts,
    };
  }

  // Deploy the contracts and initialize them
  async function deployAndInitializeFixture() {
    const [
      deployer,
      rando,
      rando2,
      rewardsSetter,
      slashReceiver,
      operator,
      operator2,
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
      operator2,
      initTimestamp,
      epochSize,
      ...contracts,
    };
  }

  // Deploy the contracts, initialize them, created a lock staking tier and start staking
  async function stakingStartedFixture() {
    const deployAndInitializeFixtureVars = await deployAndInitializeFixture();
    const { rewardsSetter, meldStakingConfig } = deployAndInitializeFixtureVars;

    const lockTierMinStakingAmount = toMeldDecimals(110_000);
    const lockTierStakingLength = 10; // 10 epochs
    const lockTierWeight = 105_00; // 105%

    await meldStakingConfig.grantRole(
      await meldStakingConfig.REWARDS_SETTER_ROLE(),
      rewardsSetter.address
    );

    await meldStakingConfig.addStakingLockTier(
      lockTierMinStakingAmount,
      lockTierStakingLength,
      lockTierWeight
    );
    await time.increaseTo(deployAndInitializeFixtureVars.initTimestamp + 1);

    return deployAndInitializeFixtureVars;
  }

  // Deploy the contracts, initialize them, created a lock staking, start staking and node requested
  async function stakingStartedWithNodeRequestsFixture() {
    const stakingStartedFixtureVars = await stakingStartedFixture();
    const {
      deployer,
      operator,
      meldStakingOperator,
      meldStakingNFT,
      meldToken,
    } = stakingStartedFixtureVars;
    const stakingAmount = toMeldDecimals(300_000);
    const lockTierId = 0;
    const nodeName = "testNode";
    const delegatorFee = 10_00; // 10%
    const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

    await requestNode(
      meldToken,
      meldStakingOperator,
      meldStakingNFT,
      deployer,
      operator,
      nodeName,
      delegatorFee,
      stakingAmount,
      lockTierId,
      metadata
    );

    const nodeId = ethers.keccak256(ethers.toUtf8Bytes(nodeName));

    return { nodeId, stakingAmount, ...stakingStartedFixtureVars };
  }

  // Deploy the contracts, initialize them, created a lock staking, start staking and node approved
  async function stakingStartedWithNodeApproved() {
    const stakingStartedWithNodeRequestsFixtureVars =
      await stakingStartedWithNodeRequestsFixture();
    const { deployer, meldStakingConfig, nodeId } =
      stakingStartedWithNodeRequestsFixtureVars;

    // Approve node
    await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

    return stakingStartedWithNodeRequestsFixtureVars;
  }

  context("Admin", function () {
    it("Should have granted the DEFAULT_ADMIN_ROLE to the deployer", async function () {
      const { deployer, meldStakingOperator } = await loadFixture(
        onlyDeployFixture
      );
      expect(
        await meldStakingOperator.hasRole(
          await meldStakingOperator.DEFAULT_ADMIN_ROLE(),
          deployer.address
        )
      ).to.be.true;
    });
    it("Should not have granted the DEFAULT_ADMIN_ROLE to any other address", async function () {
      const { rando, meldStakingOperator } = await loadFixture(
        onlyDeployFixture
      );
      expect(
        await meldStakingOperator.hasRole(
          await meldStakingOperator.DEFAULT_ADMIN_ROLE(),
          rando.address
        )
      ).to.be.false;
    });
  }); // End of Admin context

  context("Initialize", function () {
    context("Happy flow test cases", function () {
      it("Should emit an event when initialized", async function () {
        const {
          deployer,
          meldStakingAddressProvider,
          meldToken,
          meldStakingNFT,
          meldStakingCommon,
          meldStakingOperator,
          meldStakingDelegator,
          meldStakingConfig,
          meldStakingStorage,
        } = await loadFixture(onlyDeployFixture);

        // Initialize Address Provider
        await meldStakingAddressProvider.initialize(
          await meldToken.getAddress(),
          await meldStakingNFT.getAddress(),
          await meldStakingCommon.getAddress(),
          await meldStakingOperator.getAddress(),
          await meldStakingDelegator.getAddress(),
          await meldStakingConfig.getAddress(),
          await meldStakingStorage.getAddress()
        );

        const addressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        // Initialize operator

        await expect(meldStakingOperator.initialize(addressProviderAddress))
          .to.emit(meldStakingOperator, "Initialized")
          .withArgs(deployer.address, addressProviderAddress);
      });
    }); // End of Initialize Happy flow test cases

    context("Error test cases", function () {
      it("Should revert when trying to initialize twice", async function () {
        const {
          meldStakingAddressProvider,
          meldToken,
          meldStakingNFT,
          meldStakingCommon,
          meldStakingOperator,
          meldStakingDelegator,
          meldStakingConfig,
          meldStakingStorage,
        } = await loadFixture(onlyDeployFixture);
        const addressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        // Initialize Address Provider
        await meldStakingAddressProvider.initialize(
          await meldToken.getAddress(),
          await meldStakingNFT.getAddress(),
          await meldStakingCommon.getAddress(),
          await meldStakingOperator.getAddress(),
          await meldStakingDelegator.getAddress(),
          await meldStakingConfig.getAddress(),
          await meldStakingStorage.getAddress()
        );

        await meldStakingOperator.initialize(addressProviderAddress);

        await expect(
          meldStakingOperator.initialize(addressProviderAddress)
        ).to.be.revertedWith(Errors.ALREADY_INITIALIZED);
      });
      it("Should revert when trying to initialize with a zero address", async function () {
        const { meldStakingOperator } = await loadFixture(onlyDeployFixture);

        await expect(
          meldStakingOperator.initialize(ZeroAddress)
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);
      });
      it("Should revert when trying to initialize before initializing the address provider", async function () {
        const { meldStakingOperator, meldStakingAddressProvider } =
          await loadFixture(onlyDeployFixture);

        await expect(
          meldStakingOperator.initialize(
            await meldStakingAddressProvider.getAddress()
          )
        ).to.be.revertedWith(Errors.ADDRESS_PROVIDER_NOT_INITIALIZED);
      });
      it("Should revert if called by a non-admin", async function () {
        const { rando, meldStakingOperator } = await loadFixture(
          onlyDeployFixture
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingOperator.DEFAULT_ADMIN_ROLE()}`;

        await expect(
          meldStakingOperator.connect(rando).initialize(ZeroAddress)
        ).to.be.revertedWith(expectedException);
      });
    }); // End of Initialize Error test cases
  }); // End of Initialize context

  context("hashNodeId", function () {
    it("Should hash a node name correctly", async function () {
      const { meldStakingOperator } = await loadFixture(onlyDeployFixture);
      const nodeName = "test-node";
      const expectedHashedNodeId = ethers.keccak256(
        ethers.toUtf8Bytes(nodeName)
      );

      expect(await meldStakingOperator.hashNodeId(nodeName)).to.equal(
        expectedHashedNodeId
      );
    });
  }); // End of hashNodeId context

  context("requestNode", function () {
    context("Happy flow test cases", function () {
      it("Emits an event when a node is requested with liquid staking", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(100_000);
        const lockTierId = 0;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        const nodeId = ethers.keccak256(ethers.toUtf8Bytes(nodeName));

        const requestNodeTx = await requestNode(
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

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        await expect(requestNodeTx)
          .to.emit(meldStakingOperator, "NodeRequestCreated")
          .withArgs(
            operator.address,
            nodeId,
            nodeName,
            nftId,
            delegatorFee,
            amount,
            lockTierId,
            metadata
          );

        await expect(requestNodeTx)
          .to.emit(meldStakingNFT, "Transfer")
          .withArgs(ZeroAddress, operator.address, nftId);

        await expect(requestNodeTx)
          .to.emit(meldStakingNFT, "MeldDeposited")
          .withArgs(operator.address, amount);

        await expect(requestNodeTx).to.emit(meldToken, "Transfer");
      });
      it("Emits an event when a node is requested with locked staking", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(190_000);
        const lockTierId = 1;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        const nodeId = ethers.keccak256(ethers.toUtf8Bytes(nodeName));

        const requestNodeTx = await requestNode(
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

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        await expect(requestNodeTx)
          .to.emit(meldStakingOperator, "NodeRequestCreated")
          .withArgs(
            operator.address,
            nodeId,
            nodeName,
            nftId,
            delegatorFee,
            amount,
            lockTierId,
            metadata
          );

        await expect(requestNodeTx)
          .to.emit(meldStakingNFT, "Transfer")
          .withArgs(ZeroAddress, operator.address, nftId);

        await expect(requestNodeTx)
          .to.emit(meldStakingNFT, "MeldDeposited")
          .withArgs(operator.address, amount);

        await expect(requestNodeTx).to.emit(meldToken, "Transfer");
      });
      it("Should have created a node request with liquid staking", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(105_000);
        const lockTierId = 0;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        const nodeId = ethers.keccak256(ethers.toUtf8Bytes(nodeName));

        const requestNodeTx = await requestNode(
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

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        const requestTimestamp = (await requestNodeTx.getBlock())!.timestamp;

        const expectedNodeRequestInfo = [
          nftId,
          delegatorFee,
          amount,
          requestTimestamp,
          lockTierId,
        ];

        const fakeNodeId = ethers.keccak256(ethers.toUtf8Bytes("fakeNode"));

        // Check node request info

        const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
        expect(nodeRequest).to.deep.equal(expectedNodeRequestInfo);

        const fakeNodeRequest = await meldStakingStorage.getNodeRequest(
          fakeNodeId
        );
        expect(fakeNodeRequest).to.deep.equal(Array(5).fill(0)); // Non-existing node request info should be empty

        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.true;
        expect(
          await meldStakingStorage.nodeRequestExists(fakeNodeId) // Fake node request should not exist
        ).to.be.false;

        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId)
        ).to.equal(nodeId);

        expect(
          await meldStakingStorage.activeNodeRequestsIds(0) // First position
        ).to.equal(nodeId);

        await expect(
          meldStakingStorage.activeNodeRequestsIds(1) // Out of bounds
        ).to.be.reverted;
      });
      it("Should have created a node request with locked staking", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(110_000);
        const lockTierId = 1;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        const nodeId = ethers.keccak256(ethers.toUtf8Bytes(nodeName));

        const requestNodeTx = await requestNode(
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

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        const requestTimestamp = (await requestNodeTx.getBlock())!.timestamp;

        const expectedNodeRequestInfo = [
          nftId,
          delegatorFee,
          amount,
          requestTimestamp,
          lockTierId,
        ];

        const fakeNodeId = ethers.keccak256(ethers.toUtf8Bytes("fakeNode"));

        // Check node request info

        const nodeRequest = await meldStakingStorage.getNodeRequest(nodeId);
        expect(nodeRequest).to.deep.equal(expectedNodeRequestInfo);

        const fakeNodeRequest = await meldStakingStorage.getNodeRequest(
          fakeNodeId
        );
        expect(fakeNodeRequest).to.deep.equal(Array(5).fill(0)); // Non-existing node request info should be empty

        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.true;
        expect(
          await meldStakingStorage.nodeRequestExists(fakeNodeId) // Fake node request should not exist
        ).to.be.false;

        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId)
        ).to.equal(nodeId);

        expect(
          await meldStakingStorage.activeNodeRequestsIds(0) // First position
        ).to.equal(nodeId);

        await expect(
          meldStakingStorage.activeNodeRequestsIds(1) // Out of bounds
        ).to.be.reverted;
      });
      it("Should create multiple node requests by the same user", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node 1

        const nodeName1 = "testNode1";
        const delegatorFee1 = 10_00; // 10%
        const amount1 = toMeldDecimals(115_000);
        const lockTierId1 = 0;
        const metadata1 = `{"name": ${nodeName1}, "otherData": "data1"}`;

        const nodeId1 = ethers.keccak256(ethers.toUtf8Bytes(nodeName1));

        const requestNodeTx1 = await requestNode(
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

        const nftId1 = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        const requestTimestamp1 = (await requestNodeTx1.getBlock())!.timestamp;

        const expectedNodeRequestInfo1 = [
          nftId1,
          delegatorFee1,
          amount1,
          requestTimestamp1,
          lockTierId1,
        ];

        // Request node 2

        const nodeName2 = "testNode2";
        const delegatorFee2 = 13_00; // 13%
        const amount2 = toMeldDecimals(120_000);
        const lockTierId2 = 1;
        const metadata2 = `{"name": ${nodeName2}, "otherData": "data2"}`;

        const nodeId2 = ethers.keccak256(ethers.toUtf8Bytes(nodeName2));

        const requestNodeTx2 = await requestNode(
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

        const nftId2 = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          1
        );

        const requestTimestamp2 = (await requestNodeTx2.getBlock())!.timestamp;

        const expectedNodeRequestInfo2 = [
          nftId2,
          delegatorFee2,
          amount2,
          requestTimestamp2,
          lockTierId2,
        ];

        // Check node request info 1

        const nodeRequest1 = await meldStakingStorage.getNodeRequest(nodeId1);
        expect(nodeRequest1).to.deep.equal(expectedNodeRequestInfo1);

        expect(await meldStakingStorage.nodeRequestExists(nodeId1)).to.be.true;

        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId1)
        ).to.equal(nodeId1);

        expect(
          await meldStakingStorage.activeNodeRequestsIds(0) // First position
        ).to.equal(nodeId1);

        // Check node request info 2

        const nodeRequest2 = await meldStakingStorage.getNodeRequest(nodeId2);
        expect(nodeRequest2).to.deep.equal(expectedNodeRequestInfo2);

        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.true;

        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId2)
        ).to.equal(nodeId2);

        expect(
          await meldStakingStorage.activeNodeRequestsIds(1) // Second position
        ).to.equal(nodeId2);

        // Check user's NFTs

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);
      });
      it("Should create multiple node requests by different users", async function () {
        const {
          deployer,
          operator,
          operator2,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node 1

        const nodeName1 = "testNode1";
        const delegatorFee1 = 10_00; // 10%
        const amount1 = toMeldDecimals(125_000);
        const lockTierId1 = 1;
        const metadata1 = `{"name": ${nodeName1}, "otherData": "data1"}`;

        const nodeId1 = ethers.keccak256(ethers.toUtf8Bytes(nodeName1));

        const requestNodeTx1 = await requestNode(
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

        const nftId1 = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        const requestTimestamp1 = (await requestNodeTx1.getBlock())!.timestamp;

        const expectedNodeRequestInfo1 = [
          nftId1,
          delegatorFee1,
          amount1,
          requestTimestamp1,
          lockTierId1,
        ];

        // Request node 2

        const nodeName2 = "testNode2";
        const delegatorFee2 = 13_00; // 13%
        const amount2 = toMeldDecimals(130_000);
        const lockTierId2 = 0;
        const metadata2 = `{"name": ${nodeName2}, "otherData": "data2"}`;

        const nodeId2 = ethers.keccak256(ethers.toUtf8Bytes(nodeName2));

        const requestNodeTx2 = await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator2,
          nodeName2,
          delegatorFee2,
          amount2,
          lockTierId2,
          metadata2
        );

        const nftId2 = await meldStakingNFT.tokenOfOwnerByIndex(
          operator2.address,
          0
        );

        const requestTimestamp2 = (await requestNodeTx2.getBlock())!.timestamp;

        const expectedNodeRequestInfo2 = [
          nftId2,
          delegatorFee2,
          amount2,
          requestTimestamp2,
          lockTierId2,
        ];

        // Check node request info 1

        const nodeRequest1 = await meldStakingStorage.getNodeRequest(nodeId1);
        expect(nodeRequest1).to.deep.equal(expectedNodeRequestInfo1);

        expect(await meldStakingStorage.nodeRequestExists(nodeId1)).to.be.true;

        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId1)
        ).to.equal(nodeId1);

        expect(
          await meldStakingStorage.activeNodeRequestsIds(0) // First position
        ).to.equal(nodeId1);

        // Check node request info 2

        const nodeRequest2 = await meldStakingStorage.getNodeRequest(nodeId2);
        expect(nodeRequest2).to.deep.equal(expectedNodeRequestInfo2);

        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.true;

        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId2)
        ).to.equal(nodeId2);

        expect(
          await meldStakingStorage.activeNodeRequestsIds(1) // Second position
        ).to.equal(nodeId2);

        // Check user's NFTs

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1);
        expect(await meldStakingNFT.balanceOf(operator2.address)).to.equal(1);
      });
    }); // End of requestNode Happy flow test cases

    context("Error test cases", function () {
      it("Should revert if staking has not started yet", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(deployAndInitializeFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(135_000);
        const lockTierId = 0;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        await expect(
          requestNode(
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
          )
        ).to.be.revertedWith(Errors.STAKING_NOT_STARTED);
      });
      it("Should revert if the lock tier is invalid", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(140_000);
        const fakeLockTierId = 100; // Invalid lock tier
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        await expect(
          requestNode(
            meldToken,
            meldStakingOperator,
            meldStakingNFT,
            deployer,
            operator,
            nodeName,
            delegatorFee,
            amount,
            fakeLockTierId,
            metadata
          )
        ).to.be.revertedWith(Errors.INVALID_STAKING_AMOUNT_FOR_TIER);

        const lockTierId = 1; // Valid lock tier
        const lowAmount = toMeldDecimals(100_000); // Amount too low for the lock tier

        await expect(
          requestNode(
            meldToken,
            meldStakingOperator,
            meldStakingNFT,
            deployer,
            operator,
            nodeName,
            delegatorFee,
            lowAmount,
            lockTierId,
            metadata
          )
        ).to.be.revertedWith(Errors.INVALID_STAKING_AMOUNT_FOR_TIER);
      });
      it("Should revert if the fee amount is out of range", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Setting a minFee > 0% to test the minFee check
        await meldStakingConfig.connect(deployer).setMinDelegationFee(5_00); // 5%

        const minFee = await meldStakingStorage.getMinDelegationFee();
        const maxFee = await meldStakingStorage.getMaxDelegationFee();

        // Request node

        const nodeName = "testNode";
        const highDelegatorFee = 200_00; // 200%, out of range
        const lowDelegatorFee = 2_00; // 2%, out of range
        const amount = toMeldDecimals(145_000);
        const lockTierId = 0;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        expect(lowDelegatorFee).to.be.lt(minFee);
        expect(highDelegatorFee).to.be.gt(maxFee);

        await expect(
          requestNode(
            meldToken,
            meldStakingOperator,
            meldStakingNFT,
            deployer,
            operator,
            nodeName,
            lowDelegatorFee,
            amount,
            lockTierId,
            metadata
          )
        ).to.be.revertedWith(Errors.FEE_OUT_OF_RANGE);

        await expect(
          requestNode(
            meldToken,
            meldStakingOperator,
            meldStakingNFT,
            deployer,
            operator,
            nodeName,
            highDelegatorFee,
            amount,
            lockTierId,
            metadata
          )
        ).to.be.revertedWith(Errors.FEE_OUT_OF_RANGE);

        await expect(
          requestNode(
            meldToken,
            meldStakingOperator,
            meldStakingNFT,
            deployer,
            operator,
            nodeName,
            minFee,
            amount,
            lockTierId,
            metadata
          )
        ).not.to.be.reverted;

        const nodeName2 = "testNode2";

        await expect(
          requestNode(
            meldToken,
            meldStakingOperator,
            meldStakingNFT,
            deployer,
            operator,
            nodeName2,
            maxFee,
            amount,
            lockTierId,
            metadata
          )
        ).not.to.be.reverted;
      });
      it("Should revert if the stake amount is out of range", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        const minAmount = await meldStakingStorage.getMinStakingAmount();
        const maxAmount = await meldStakingStorage.getMaxStakingAmount();

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const lowAmount = toMeldDecimals(5_000); // 5000 MELD, out of range
        const lockTierId = 0;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        expect(lowAmount).to.be.lt(minAmount);

        await expect(
          requestNode(
            meldToken,
            meldStakingOperator,
            meldStakingNFT,
            deployer,
            operator,
            nodeName,
            delegatorFee,
            lowAmount,
            lockTierId,
            metadata
          )
        ).to.be.revertedWith(Errors.STAKING_AMOUNT_OUT_OF_RANGE);

        const highAmount = toMeldDecimals(50_000_000); // 50 million MELD, out of range

        expect(highAmount).to.be.gt(maxAmount);

        await expect(
          requestNode(
            meldToken,
            meldStakingOperator,
            meldStakingNFT,
            deployer,
            operator,
            nodeName,
            delegatorFee,
            highAmount,
            lockTierId,
            metadata
          )
        ).to.be.revertedWith(Errors.STAKING_AMOUNT_OUT_OF_RANGE);

        await expect(
          requestNode(
            meldToken,
            meldStakingOperator,
            meldStakingNFT,
            deployer,
            operator,
            nodeName,
            delegatorFee,
            minAmount,
            lockTierId,
            metadata
          )
        ).not.to.be.reverted;

        const nodeName2 = "testNode2";

        await expect(
          requestNode(
            meldToken,
            meldStakingOperator,
            meldStakingNFT,
            deployer,
            operator,
            nodeName2,
            delegatorFee,
            maxAmount,
            lockTierId,
            metadata
          )
        ).not.to.be.reverted;
      });
      it("Should revert if the node request already exists", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(150_000);
        const lockTierId = 1;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

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

        // Try to request same node again

        await expect(
          requestNode(
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
          )
        ).to.be.revertedWith(Errors.NODE_REQUEST_ALREADY_EXISTS);
      });
      it("Should revert if the node already exists", async function () {
        const {
          deployer,
          operator,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(155_000);
        const lockTierId = 1;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

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

        const nodeId = ethers.keccak256(ethers.toUtf8Bytes(nodeName));

        // Admin approves node request
        await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

        // Try to request a node that already exists

        await expect(
          requestNode(
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
          )
        ).to.be.revertedWith(Errors.NODE_ALREADY_EXISTS);
      });
    }); // End of requestNode Error test cases
  }); // End of requestNode context
  context("cancelNodeRequest", function () {
    context("Happy flow test cases", function () {
      it("Should emit an event when a node request is cancelled", async function () {
        const {
          operator,
          nodeId,
          stakingAmount,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedWithNodeRequestsFixture);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Cancel node request

        const cancelNodeRequestTx = await meldStakingOperator
          .connect(operator)
          .cancelNodeRequest(nodeId);

        await expect(cancelNodeRequestTx)
          .to.emit(meldStakingOperator, "NodeRequestCancelled")
          .withArgs(nodeId, nftId, stakingAmount);

        await expect(cancelNodeRequestTx)
          .to.emit(meldStakingNFT, "MeldWithdrawn")
          .withArgs(operator.address, stakingAmount);

        await expect(cancelNodeRequestTx)
          .to.emit(meldStakingNFT, "Redeemed")
          .withArgs(operator.address, nftId);

        await expect(cancelNodeRequestTx)
          .to.emit(meldStakingNFT, "Transfer")
          .withArgs(operator.address, ZeroAddress, nftId);

        await expect(cancelNodeRequestTx)
          .to.emit(meldToken, "Transfer")
          .withArgs(
            await meldStakingNFT.getAddress(),
            operator.address,
            stakingAmount
          );
      });
      it("Should cancel a node request when there is only one", async function () {
        const {
          operator,
          nodeId,
          stakingAmount,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedWithNodeRequestsFixture);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        const balanceBefore = await meldToken.balanceOf(operator.address);
        expect(await meldStakingStorage.activeNodeRequestsIds(0)).to.equal(
          nodeId
        );

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1);
        expect(await meldStakingNFT.ownerOf(nftId)).to.equal(operator.address);

        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.true;
        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId)
        ).to.equal(nodeId);

        // Cancel node request

        await meldStakingOperator.connect(operator).cancelNodeRequest(nodeId);

        // Check state

        const balanceAfter = await meldToken.balanceOf(operator.address);

        expect(balanceAfter).to.equal(balanceBefore + stakingAmount);
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(0);
        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.false;
        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId)
        ).to.equal(ZeroHash);
        await expect(
          meldStakingStorage.activeNodeRequestsIds(0)
        ).to.be.reverted;
      });
      it("Should cancel a node request when there are multiple node requests", async function () {
        const {
          deployer,
          operator,
          nodeId,
          stakingAmount,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedWithNodeRequestsFixture);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        const nodeName2 = "testNode2";
        const delegatorFee2 = 8_00; // 8%
        const stakingAmount2 = toMeldDecimals(250_000);
        const lockTierId2 = 1;
        const metadata2 = `{"name": ${nodeName2}, "otherData": "data2"}`;

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName2,
          delegatorFee2,
          stakingAmount2,
          lockTierId2,
          metadata2
        );

        const nodeId2 = ethers.keccak256(ethers.toUtf8Bytes(nodeName2));

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);

        const balanceBefore = await meldToken.balanceOf(operator.address);
        expect(await meldStakingStorage.activeNodeRequestsIds(0)).to.equal(
          nodeId
        );
        expect(await meldStakingStorage.activeNodeRequestsIds(1)).to.equal(
          nodeId2
        );

        // Cancel node request

        await meldStakingOperator.connect(operator).cancelNodeRequest(nodeId);

        // Check state

        const balanceAfter = await meldToken.balanceOf(operator.address);

        expect(balanceAfter).to.equal(balanceBefore + stakingAmount);
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1);
        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.false;
        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId)
        ).to.equal(ZeroHash);

        expect(await meldStakingStorage.activeNodeRequestsIds(0)).to.equal(
          nodeId2
        );
        await expect(
          meldStakingStorage.activeNodeRequestsIds(1)
        ).to.be.reverted;
      });
      it("Should cancel every node request when there are multiple node requests", async function () {
        const {
          deployer,
          operator,
          nodeId,
          stakingAmount,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedWithNodeRequestsFixture);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        const nodeName2 = "testNode2";
        const delegatorFee2 = 8_00; // 8%
        const stakingAmount2 = toMeldDecimals(250_000);
        const lockTierId2 = 1;
        const metadata2 = `{"name": ${nodeName2}, "otherData": "data2"}`;

        const nodeId2 = ethers.keccak256(ethers.toUtf8Bytes(nodeName2));

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName2,
          delegatorFee2,
          stakingAmount2,
          lockTierId2,
          metadata2
        );

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);

        const nftId2 = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          1
        );

        const balanceBefore = await meldToken.balanceOf(operator.address);
        expect(await meldStakingStorage.activeNodeRequestsIds(0)).to.equal(
          nodeId
        );
        expect(await meldStakingStorage.activeNodeRequestsIds(1)).to.equal(
          nodeId2
        );

        // Cancel node request 2

        await meldStakingOperator.connect(operator).cancelNodeRequest(nodeId2);

        const balanceAfterFirst = await meldToken.balanceOf(operator.address);

        // Cancel node request 1

        await meldStakingOperator.connect(operator).cancelNodeRequest(nodeId);

        // Check state

        const balanceAfterSecond = await meldToken.balanceOf(operator.address);

        expect(balanceAfterFirst).to.equal(balanceBefore + stakingAmount2);
        expect(balanceAfterSecond).to.equal(balanceAfterFirst + stakingAmount);
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(0);
        expect(await meldStakingStorage.nodeRequestExists(nodeId)).to.be.false;
        expect(await meldStakingStorage.nodeRequestExists(nodeId2)).to.be.false;
        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId)
        ).to.equal(ZeroHash);
        expect(
          await meldStakingStorage.nodeRequestsPerOperator(nftId2)
        ).to.equal(ZeroHash);
        await expect(
          meldStakingStorage.activeNodeRequestsIds(0)
        ).to.be.reverted;
      });
    }); // End of cancelNodeRequest Happy flow test cases

    context("Error test cases", function () {
      it("Should revert if the node request does not exist", async function () {
        const { operator, meldStakingOperator, meldStakingStorage } =
          await loadFixture(stakingStartedWithNodeRequestsFixture);

        const fakeNodeId = ethers.keccak256(ethers.toUtf8Bytes("fakeNode"));

        expect(
          await meldStakingStorage.nodeRequestExists(fakeNodeId)
        ).to.be.false;

        await expect(
          meldStakingOperator.connect(operator).cancelNodeRequest(fakeNodeId)
        ).to.be.revertedWith(Errors.NODE_REQUEST_DOES_NOT_EXIST);
      });
      it("Should revert if tries to cancel a node request twice", async function () {
        const { operator, nodeId, meldStakingOperator } = await loadFixture(
          stakingStartedWithNodeRequestsFixture
        );

        // Cancel node request

        await meldStakingOperator.connect(operator).cancelNodeRequest(nodeId);

        // Try to cancel node request again

        await expect(
          meldStakingOperator.connect(operator).cancelNodeRequest(nodeId)
        ).to.be.revertedWith(Errors.NODE_REQUEST_DOES_NOT_EXIST);
      });
      it("Should revert if msg sender is not the node request operator", async function () {
        const { rando, nodeId, meldStakingOperator } = await loadFixture(
          stakingStartedWithNodeRequestsFixture
        );

        // Try to cancel node request from a different address

        await expect(
          meldStakingOperator.connect(rando).cancelNodeRequest(nodeId)
        ).to.be.revertedWith(Errors.NOT_NODE_OPERATOR);
      });
    }); // End of cancelNodeRequest Error test cases
  }); // End of cancelNodeRequest context

  context("leaveNode", function () {
    context("Happy flow test cases", function () {
      it("Should emit an event when an operator leaves a node (without rewards)", async function () {
        const {
          operator,
          nodeId,
          stakingAmount,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedWithNodeApproved);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Leave node

        const leaveNodeTx = await meldStakingOperator
          .connect(operator)
          .leaveNode(nftId);

        await expect(leaveNodeTx)
          .to.emit(meldStakingOperator, "NodeLeft")
          .withArgs(nftId, nodeId, stakingAmount);

        await expect(leaveNodeTx)
          .to.emit(meldStakingNFT, "MeldWithdrawn")
          .withArgs(operator.address, stakingAmount);

        await expect(leaveNodeTx)
          .to.emit(meldStakingNFT, "Redeemed")
          .withArgs(operator.address, nftId);

        await expect(leaveNodeTx)
          .to.emit(meldStakingNFT, "Transfer")
          .withArgs(operator.address, ZeroAddress, nftId);

        await expect(leaveNodeTx)
          .to.emit(meldToken, "Transfer")
          .withArgs(
            await meldStakingNFT.getAddress(),
            operator.address,
            stakingAmount
          );
      });
      it("Should emit an event when an operator leaves a node (with rewards)", async function () {
        const {
          operator,
          deployer,
          rewardsSetter,
          nodeId,
          stakingAmount,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingNFT,
          meldStakingStorage,
          meldToken,
        } = await loadFixture(stakingStartedWithNodeApproved);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Advance to epoch 3

        const startEpoch = await meldStakingStorage.getCurrentEpoch();
        await time.increaseTo(
          await meldStakingStorage.getEpochStart(startEpoch + 2n)
        );

        expect(await meldStakingStorage.getCurrentEpoch()).to.equal(3n);

        // Set rewards

        const rewardsAmount = toMeldDecimals(10_000);
        const rewardsEpoch = 2n;
        await transferAndApproveTokens(
          meldToken,
          deployer,
          rewardsSetter,
          await meldStakingNFT.getAddress(),
          rewardsAmount
        );
        await meldStakingConfig
          .connect(rewardsSetter)
          .setRewards(rewardsAmount, rewardsEpoch);

        // Leave node

        const leaveNodeTx = await meldStakingOperator
          .connect(operator)
          .leaveNode(nftId);

        await expect(leaveNodeTx)
          .to.emit(meldStakingOperator, "RewardsClaimed")
          .withArgs(nftId, rewardsAmount);

        await expect(leaveNodeTx)
          .to.emit(meldStakingOperator, "NodeLeft")
          .withArgs(nftId, nodeId, stakingAmount + rewardsAmount);

        await expect(leaveNodeTx)
          .to.emit(meldStakingNFT, "MeldWithdrawn")
          .withArgs(operator.address, stakingAmount + rewardsAmount);

        await expect(leaveNodeTx)
          .to.emit(meldStakingNFT, "Redeemed")
          .withArgs(operator.address, nftId);

        await expect(leaveNodeTx)
          .to.emit(meldStakingNFT, "Transfer")
          .withArgs(operator.address, ZeroAddress, nftId);

        await expect(leaveNodeTx)
          .to.emit(meldToken, "Transfer")
          .withArgs(
            await meldStakingNFT.getAddress(),
            operator.address,
            stakingAmount + rewardsAmount
          );
      });
      it("Should leave a node when there is only one", async function () {
        const {
          operator,
          nodeId,
          stakingAmount,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedWithNodeApproved);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        const balanceBefore = await meldToken.balanceOf(operator.address);
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1);
        expect(await meldStakingNFT.ownerOf(nftId)).to.equal(operator.address);
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isOperator(nftId)).to.be.true;

        // Leave node

        await meldStakingOperator.connect(operator).leaveNode(nftId);

        // Check data

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(0);
        await expect(meldStakingNFT.ownerOf(nftId)).to.be.reverted;
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.true;
        expect(await meldToken.balanceOf(operator.address)).to.equal(
          balanceBefore + stakingAmount
        );
        expect(await meldStakingStorage.isOperator(nftId)).to.be.false;
      });
      it("Should leave a node when there are multiple", async function () {
        const {
          deployer,
          operator,
          nodeId,
          stakingAmount,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedWithNodeApproved);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Request node 2

        const nodeName2 = "testNode2";
        const delegatorFee2 = 8_00; // 8%
        const stakingAmount2 = toMeldDecimals(260_000);
        const lockTierId2 = 1;
        const metadata2 = `{"name": ${nodeName2}, "otherData": "data2"}`;

        const nodeId2 = ethers.keccak256(ethers.toUtf8Bytes(nodeName2));

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName2,
          delegatorFee2,
          stakingAmount2,
          lockTierId2,
          metadata2
        );

        const nftId2 = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          1
        );

        // Approve node 2

        await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId2);

        const balanceBefore = await meldToken.balanceOf(operator.address);
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);

        expect(await meldStakingNFT.ownerOf(nftId)).to.equal(operator.address);
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isOperator(nftId)).to.be.true;

        expect(await meldStakingNFT.ownerOf(nftId2)).to.equal(operator.address);
        expect(await meldStakingStorage.isNodeActive(nodeId2)).to.be.true;
        expect(await meldStakingStorage.isNodeInactive(nodeId2)).to.be.false;
        expect(await meldStakingStorage.isOperator(nftId2)).to.be.true;

        // Leave node 1

        await meldStakingOperator.connect(operator).leaveNode(nftId);

        // Check data

        // Node 1 should be inactive now
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1);
        await expect(meldStakingNFT.ownerOf(nftId)).to.be.reverted;
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.true;
        expect(await meldToken.balanceOf(operator.address)).to.equal(
          balanceBefore + stakingAmount
        );
        expect(await meldStakingStorage.isOperator(nftId)).to.be.false;

        // Node 2 should remain the same
        expect(await meldStakingNFT.ownerOf(nftId2)).to.equal(operator.address);
        expect(await meldStakingStorage.isNodeActive(nodeId2)).to.be.true;
        expect(await meldStakingStorage.isNodeInactive(nodeId2)).to.be.false;
        expect(await meldStakingStorage.isOperator(nftId2)).to.be.true;
      });
      it("Should leave every node when there are multiple", async function () {
        const {
          deployer,
          operator,
          nodeId,
          stakingAmount,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedWithNodeApproved);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Request node 2

        const nodeName2 = "testNode2";
        const delegatorFee2 = 8_00; // 8%
        const stakingAmount2 = toMeldDecimals(260_000);
        const lockTierId2 = 1;
        const metadata2 = `{"name": ${nodeName2}, "otherData": "data2"}`;

        const nodeId2 = ethers.keccak256(ethers.toUtf8Bytes(nodeName2));

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          nodeName2,
          delegatorFee2,
          stakingAmount2,
          lockTierId2,
          metadata2
        );

        const nftId2 = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          1
        );

        // Approve node 2

        await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId2);

        const balanceBefore = await meldToken.balanceOf(operator.address);
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(2);

        expect(await meldStakingNFT.ownerOf(nftId)).to.equal(operator.address);
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isOperator(nftId)).to.be.true;

        expect(await meldStakingNFT.ownerOf(nftId2)).to.equal(operator.address);
        expect(await meldStakingStorage.isNodeActive(nodeId2)).to.be.true;
        expect(await meldStakingStorage.isNodeInactive(nodeId2)).to.be.false;
        expect(await meldStakingStorage.isOperator(nftId2)).to.be.true;

        const startEpoch = await meldStakingStorage.getCurrentEpoch();
        await time.increaseTo(
          await meldStakingStorage.getEpochStart(startEpoch + 50n)
        );

        // Leave node 2

        await meldStakingOperator.connect(operator).leaveNode(nftId2);

        const balanceAfter1 = await meldToken.balanceOf(operator.address);

        // Leave node 1

        await meldStakingOperator.connect(operator).leaveNode(nftId);

        const balanceAfter2 = await meldToken.balanceOf(operator.address);

        // Check data

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(0);

        // Node 1 should be inactive now
        await expect(meldStakingNFT.ownerOf(nftId)).to.be.reverted;
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.true;
        expect(balanceAfter2).to.equal(balanceAfter1 + stakingAmount);
        expect(await meldStakingStorage.isOperator(nftId)).to.be.false;

        // Node 2 should be inactive now
        await expect(meldStakingNFT.ownerOf(nftId)).to.be.reverted;
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.true;
        expect(balanceAfter1).to.equal(balanceBefore + stakingAmount2);
        expect(await meldStakingStorage.isOperator(nftId)).to.be.false;
      });

      it("Should leave a node with rewards", async function () {
        const {
          operator,
          deployer,
          rewardsSetter,
          nodeId,
          stakingAmount,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingNFT,
          meldStakingStorage,
          meldToken,
        } = await loadFixture(stakingStartedWithNodeApproved);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Advance to epoch 3

        const startEpoch = await meldStakingStorage.getCurrentEpoch();
        await time.increaseTo(
          await meldStakingStorage.getEpochStart(startEpoch + 2n)
        );

        expect(await meldStakingStorage.getCurrentEpoch()).to.equal(3n);

        // Set rewards

        const rewardsAmount = toMeldDecimals(10_000);
        const rewardsEpoch = 2n;
        await transferAndApproveTokens(
          meldToken,
          deployer,
          rewardsSetter,
          await meldStakingNFT.getAddress(),
          rewardsAmount
        );
        await meldStakingConfig
          .connect(rewardsSetter)
          .setRewards(rewardsAmount, rewardsEpoch);

        const balanceBefore = await meldToken.balanceOf(operator.address);
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1);
        expect(await meldStakingNFT.ownerOf(nftId)).to.equal(operator.address);
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isOperator(nftId)).to.be.true;

        // Leave node

        await meldStakingOperator.connect(operator).leaveNode(nftId);

        // Check data

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(0);
        await expect(meldStakingNFT.ownerOf(nftId)).to.be.reverted;
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.true;
        expect(await meldToken.balanceOf(operator.address)).to.equal(
          balanceBefore + stakingAmount + rewardsAmount
        );
        expect(await meldStakingStorage.isOperator(nftId)).to.be.false;
        expect(
          await meldStakingStorage.getStakerUnclaimedRewards(nftId)
        ).to.equal(0);
      });
      it("Should leave a node after the locked staking position turns into liquid staking position", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingConfig,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(290_000);
        const lockTierId = 1;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        const nodeId = ethers.keccak256(ethers.toUtf8Bytes(nodeName));

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

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Admin approves node request

        await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

        // Wait until the lock period is over

        const startEpoch = await meldStakingStorage.getCurrentEpoch();
        const lockTier = await meldStakingStorage.getLockStakingTier(
          lockTierId
        );

        const endEpoch = await meldStakingStorage.getEpochStart(
          startEpoch + lockTier.stakingLength + 5n
        ); // some epochs after the lock period ends

        await time.increaseTo(endEpoch);

        const balanceBefore = await meldToken.balanceOf(operator.address);
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1);
        expect(await meldStakingNFT.ownerOf(nftId)).to.equal(operator.address);
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isOperator(nftId)).to.be.true;

        // Leave node

        await meldStakingOperator.connect(operator).leaveNode(nftId);

        // Check data

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(0);
        await expect(meldStakingNFT.ownerOf(nftId)).to.be.reverted;
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.true;
        expect(await meldToken.balanceOf(operator.address)).to.equal(
          balanceBefore + amount
        );
        expect(await meldStakingStorage.isOperator(nftId)).to.be.false;
      });
      it("Should leave a node after the locked staking position turns into liquid staking position (with rewards)", async function () {
        const {
          operator,
          deployer,
          rewardsSetter,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingNFT,
          meldStakingStorage,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(290_000);
        const lockTierId = 1;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        const nodeId = ethers.keccak256(ethers.toUtf8Bytes(nodeName));

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

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Admin approves node request

        await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

        const startEpoch = await meldStakingStorage.getCurrentEpoch();
        const lockTier = await meldStakingStorage.getLockStakingTier(
          lockTierId
        );

        const endEpoch = await meldStakingStorage.getEpochStart(
          startEpoch + lockTier.stakingLength + 5n
        ); // some epochs after the lock period ends

        // Advance to epoch 3

        await time.increaseTo(
          await meldStakingStorage.getEpochStart(startEpoch + 2n)
        );

        expect(await meldStakingStorage.getCurrentEpoch()).to.equal(3n);

        // Set rewards

        const rewardsAmount = toMeldDecimals(10_000);
        const rewardsEpoch = 2n;
        await transferAndApproveTokens(
          meldToken,
          deployer,
          rewardsSetter,
          await meldStakingNFT.getAddress(),
          rewardsAmount
        );
        await meldStakingConfig
          .connect(rewardsSetter)
          .setRewards(rewardsAmount, rewardsEpoch);

        const balanceBefore = await meldToken.balanceOf(operator.address);
        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(1);
        expect(await meldStakingNFT.ownerOf(nftId)).to.equal(operator.address);
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.true;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isOperator(nftId)).to.be.true;

        // Wait until the lock period is over

        await time.increaseTo(endEpoch);

        // Leave node

        await meldStakingOperator.connect(operator).leaveNode(nftId);

        // Check data

        expect(await meldStakingNFT.balanceOf(operator.address)).to.equal(0);
        await expect(meldStakingNFT.ownerOf(nftId)).to.be.reverted;
        expect(await meldStakingStorage.isNodeActive(nodeId)).to.be.false;
        expect(await meldStakingStorage.isNodeInactive(nodeId)).to.be.true;
        expect(await meldToken.balanceOf(operator.address)).to.equal(
          balanceBefore + amount + rewardsAmount
        );
        expect(await meldStakingStorage.isOperator(nftId)).to.be.false;
        expect(
          await meldStakingStorage.getStakerUnclaimedRewards(nftId)
        ).to.equal(0);
      });
    }); // End of leaveNode Happy flow test cases

    context("Error test cases", function () {
      it("Should revert if msg sender is not the owner of the operator NFT", async function () {
        const { rando, operator, meldStakingOperator, meldStakingNFT } =
          await loadFixture(stakingStartedWithNodeApproved);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        await expect(
          meldStakingOperator.connect(rando).leaveNode(nftId)
        ).to.be.revertedWith(Errors.NOT_NFT_OWNER);
      });
      it("Should revert if the NFT is not the operator of the node", async function () {
        const {
          deployer,
          rando,
          meldStakingOperator,
          meldStakingDelegator,
          meldStakingNFT,
          meldToken,
          nodeId,
        } = await loadFixture(stakingStartedWithNodeApproved);

        // Delegate to node

        const amount = toMeldDecimals(6_000);
        const lockTierId = 0;

        await delegateToNode(
          meldToken,
          meldStakingDelegator,
          meldStakingNFT,
          deployer,
          rando,
          amount,
          nodeId,
          lockTierId
        );

        const delegatorNftId = await meldStakingNFT.tokenOfOwnerByIndex(
          rando.address,
          0
        );

        await expect(
          meldStakingOperator.connect(rando).leaveNode(delegatorNftId)
        ).to.be.revertedWith(Errors.NOT_OPERATOR);
      });
      it("Should revert if the node is still a node request", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(100_000);
        const lockTierId = 0;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

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

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        await expect(
          meldStakingOperator.connect(operator).leaveNode(nftId)
        ).to.be.revertedWith(Errors.NOT_OPERATOR);
      });
      it("Should revert if the staking is locked", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingConfig,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        // Request node

        const nodeName = "testNode";
        const delegatorFee = 10_00; // 10%
        const amount = toMeldDecimals(290_000);
        const lockTierId = 1;
        const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

        const nodeId = ethers.keccak256(ethers.toUtf8Bytes(nodeName));

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

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Admin approves node request

        await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

        // Leave node

        await expect(
          meldStakingOperator.connect(operator).leaveNode(nftId)
        ).to.be.revertedWith(Errors.STAKING_LOCKED);
      });
      it("Should revert if tries to leave a node twice", async function () {
        const { operator, meldStakingOperator, meldStakingNFT } =
          await loadFixture(stakingStartedWithNodeApproved);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Leave node
        await meldStakingOperator.connect(operator).leaveNode(nftId);

        // Try to leave node again
        await expect(
          meldStakingOperator.connect(operator).leaveNode(nftId)
        ).to.be.revertedWith("ERC721: invalid token ID"); // NFT no longer exists
      });
      it("Should revert if tries to leave a slashed node", async function () {
        const {
          deployer,
          operator,
          meldStakingOperator,
          meldStakingConfig,
          meldStakingNFT,
          nodeId,
        } = await loadFixture(stakingStartedWithNodeApproved);

        const nftId = await meldStakingNFT.tokenOfOwnerByIndex(
          operator.address,
          0
        );

        // Slash node
        await meldStakingConfig.connect(deployer).slashNode(nodeId, 100_00n);

        // Try to leave node
        await expect(
          meldStakingOperator.connect(operator).leaveNode(nftId)
        ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
      });
    }); // End of leaveNode Error test cases
  }); // End of leaveNode context
});
