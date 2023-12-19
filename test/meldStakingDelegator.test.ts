import { ethers } from "hardhat";
import { ZeroAddress } from "ethers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import {
  deployContracts,
  deployAndConfigContracts,
  transferAndApproveTokens,
  toMeldDecimals,
  getStakingData,
  StakingData,
  getStakerData,
  StakerData,
  delegateToNode,
  requestNode,
} from "./utils/utils";
import {
  calculateExpectedStakingDataAfterNewStake,
  calculateRewards,
  calculateExpectedStakingDataAfterWithdrawal,
  calculateEndLockEpoch,
  calculateDelegationFeeAmount,
  calculateWeightedAmount,
} from "./utils/calculations";
import { Errors } from "./utils/errors";
import { PERCENTAGE_SCALING } from "./utils/constants";

describe("MeldStakingDelegator", function () {
  async function onlyDeployFixture() {
    const [deployer, rando, trustedForwarderSetter] = await ethers.getSigners();
    const contracts = await deployContracts(deployer.address);
    return { deployer, rando, trustedForwarderSetter, ...contracts };
  }

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
    await contracts.meldStakingDelegator.grantRole(
      await contracts.meldStakingDelegator.TRUSTED_FORWARDER_SETTER_ROLE(),
      trustedForwarderSetter.address
    );

    // Grant REWARDS_SETTER_ROLE to rewardsSetter
    await contracts.meldStakingConfig.grantRole(
      await contracts.meldStakingConfig.REWARDS_SETTER_ROLE(),
      rewardsSetter.address
    );

    // Add staking tier one. Requires 10,000 MELD for 10 epochs and gets 120% weight. tierOneId is 1
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

    // Add staking tier two. Requires 50,000 MELD for 20 epochs and gets 175% weight. tierTwoId is 2
    minStakingAmount = toMeldDecimals(50_000);
    stakingLength = 20; // 20 epochs
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
    const operatorBaseStakeAmount = toMeldDecimals(100_000);
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
      operatorBaseStakeAmount,
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
      operatorBaseStakeAmount,
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
      meldToken,
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

    // Operator approves the NFT staking contract to be able to deposit the stake
    await transferAndApproveTokens(
      meldToken,
      deployer,
      operator,
      await contracts.meldStakingNFT.getAddress(),
      operatorBaseLockedStakeAmount
    );

    // Operator requests a node
    await contracts.meldStakingOperator
      .connect(operator)
      .requestNode(
        nodeName,
        delegatorFee,
        operatorBaseLockedStakeAmount,
        tierOneId,
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

    // Operator 2 approves the NFT staking contract to be able to deposit the stake
    await transferAndApproveTokens(
      meldToken,
      deployer,
      operator2,
      await contracts.meldStakingNFT.getAddress(),
      operator2BaseLockedStakeAmount
    );

    // Operator 2 requests a node
    await contracts.meldStakingOperator
      .connect(operator2)
      .requestNode(
        nodeName2,
        delegatorFee2,
        operator2BaseLockedStakeAmount,
        tierTwoId,
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
  context("Admin", function () {
    it("Should have granted the DEFAULT_ADMIN_ROLE to the deployer", async function () {
      const { deployer, meldStakingDelegator } = await loadFixture(
        onlyDeployFixture
      );
      expect(
        await meldStakingDelegator.hasRole(
          await meldStakingDelegator.DEFAULT_ADMIN_ROLE(),
          deployer.address
        )
      ).to.be.true;
    });
    it("Should not have granted the DEFAULT_ADMIN_ROLE to any other address", async function () {
      const { rando, meldStakingDelegator } = await loadFixture(
        onlyDeployFixture
      );
      expect(
        await meldStakingDelegator.hasRole(
          await meldStakingDelegator.DEFAULT_ADMIN_ROLE(),
          rando.address
        )
      ).to.be.false;
    });
  });

  context("TrustedForwarderSetter", function () {
    it("Should not have granted the TRUSTED_FORWARDER_SETTER_ROLE to the trustedForwarderSetter", async function () {
      const { trustedForwarderSetter, meldStakingDelegator } =
        await loadFixture(onlyDeployFixture);
      expect(
        await meldStakingDelegator.hasRole(
          await meldStakingDelegator.TRUSTED_FORWARDER_SETTER_ROLE(),
          trustedForwarderSetter.address
        )
      ).to.be.false;
    });
    it("Should have granted the TRUSTED_FORWARDER_SETTER_ROLE to the trustedForwarderSetter", async function () {
      const { trustedForwarderSetter, meldStakingDelegator } =
        await loadFixture(deployAndConfigContractsFixture);
      expect(
        await meldStakingDelegator.hasRole(
          await meldStakingDelegator.TRUSTED_FORWARDER_SETTER_ROLE(),
          trustedForwarderSetter.address
        )
      ).to.be.true;
    });
    it("Should not have granted the TRUSTED_FORWARDER_SETTER_ROLE to any other address", async function () {
      const { rando, meldStakingDelegator } = await loadFixture(
        deployAndConfigContractsFixture
      );
      expect(
        await meldStakingDelegator.hasRole(
          await meldStakingDelegator.TRUSTED_FORWARDER_SETTER_ROLE(),
          rando.address
        )
      ).to.be.false;
    });
  });

  context("Initialize", function () {
    context("Happy Flow test cases", function () {
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

        // Initialize Address Provider only
        meldStakingAddressProvider.initialize(
          await meldToken.getAddress(),
          await meldStakingNFT.getAddress(),
          await meldStakingCommon.getAddress(),
          await meldStakingOperator.getAddress(),
          await meldStakingDelegator.getAddress(),
          await meldStakingConfig.getAddress(),
          await meldStakingStorage.getAddress()
        );

        const meldStakingAddressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        await expect(
          meldStakingDelegator.initialize(meldStakingAddressProvider)
        )
          .to.emit(meldStakingDelegator, "Initialized")
          .withArgs(deployer.address, meldStakingAddressProviderAddress);
      });
    }); // End of Initialize Happy Flow test cases

    context("Error test cases", function () {
      it("Should revert if MeldStakingAddressProvider is zero address", async function () {
        const { meldStakingDelegator } = await loadFixture(onlyDeployFixture);

        await expect(
          meldStakingDelegator.initialize(ZeroAddress)
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);
      });
      it("Should revert if called by a non-admin", async function () {
        const { rando, meldStakingDelegator, meldStakingAddressProvider } =
          await loadFixture(onlyDeployFixture);

        const meldStakingAddressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingDelegator.DEFAULT_ADMIN_ROLE()}`;

        await expect(
          meldStakingDelegator
            .connect(rando)
            .initialize(meldStakingAddressProviderAddress)
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert if initialized twice", async function () {
        const { meldStakingDelegator, meldStakingAddressProvider } =
          await loadFixture(deployAndConfigContractsFixture); // this fixture initializes all contracts

        const meldStakingAddressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        await expect(
          meldStakingDelegator.initialize(meldStakingAddressProviderAddress)
        ).to.be.revertedWith(Errors.ALREADY_INITIALIZED);
      });

      it("Should revert if address provider returns zero address for an address being initialized", async function () {
        const { meldStakingDelegator, meldStakingAddressProvider } =
          await loadFixture(onlyDeployFixture);

        const meldStakingAddressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        await expect(
          meldStakingDelegator.initialize(meldStakingAddressProviderAddress)
        ).to.be.revertedWith(Errors.ADDRESS_PROVIDER_NOT_INITIALIZED);
      });
    }); // End of Initialize Error test cases
  }); // End of Initialize

  context("stake", function () {
    context("Happy Flow test cases", function () {
      it("Should emit correct events for liquid staking", async function () {
        const {
          deployer,
          delegator,
          meldStakingDelegator,
          meldStakingCommon,
          meldStakingNFT,
          meldStakingStorage,
          meldToken,
          nodeId,
          liquidStakingTierId,
        } = await loadFixture(nodeStakedFixture);

        const delegatorBaseStakeAmount = toMeldDecimals(10_000);

        const meldStakingNFTAddress = await meldStakingNFT.getAddress();
        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          meldStakingNFTAddress,
          delegatorBaseStakeAmount
        );

        const totalBaseStakedAmountBefore =
          await meldStakingStorage.getTotalBaseStakedAmount();
        const expectedNftId = (await meldStakingNFT.getTotalMintedNfts()) + 1n;

        const stakeTx = await meldStakingDelegator
          .connect(delegator)
          .stake(delegatorBaseStakeAmount, nodeId, liquidStakingTierId);

        const expectedTotalBaseStakedAmountAfter =
          totalBaseStakedAmountBefore + delegatorBaseStakeAmount;

        await expect(stakeTx)
          .to.emit(meldStakingDelegator, "StakingDelegationCreated")
          .withArgs(
            delegator.address,
            expectedNftId,
            nodeId,
            delegatorBaseStakeAmount,
            liquidStakingTierId
          );

        await expect(stakeTx)
          .to.emit(meldStakingDelegator, "TotalBaseStakedAmountChanged")
          .withArgs(
            delegator.address,
            totalBaseStakedAmountBefore,
            expectedTotalBaseStakedAmountAfter
          );

        await expect(stakeTx).to.not.emit(
          meldStakingCommon,
          "LockStakingRegistered"
        );
      });

      it("Should emit correct events for locked staking", async function () {
        const {
          deployer,
          delegator,
          meldStakingDelegator,
          meldStakingCommon,
          meldStakingNFT,
          meldStakingStorage,
          meldToken,
          nodeId,
          tierOneId,
        } = await loadFixture(nodeLockStakedFixture);

        const delegatorBaseStakeAmount = toMeldDecimals(10_000);

        const meldStakingNFTAddress = await meldStakingNFT.getAddress();
        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          meldStakingNFTAddress,
          delegatorBaseStakeAmount
        );

        const totalBaseStakedAmountBefore =
          await meldStakingStorage.getTotalBaseStakedAmount();
        const expectedNftId = (await meldStakingNFT.getTotalMintedNfts()) + 1n;

        const stakeTx = await meldStakingDelegator
          .connect(delegator)
          .stake(delegatorBaseStakeAmount, nodeId, tierOneId);

        const expectedTotalBaseStakedAmountAfter =
          totalBaseStakedAmountBefore + delegatorBaseStakeAmount;
        const endLockEpoch = await meldStakingCommon.getEndLockEpoch(
          expectedNftId
        );

        await expect(stakeTx)
          .to.emit(meldStakingDelegator, "StakingDelegationCreated")
          .withArgs(
            delegator.address,
            expectedNftId,
            nodeId,
            delegatorBaseStakeAmount,
            tierOneId
          );

        await expect(stakeTx)
          .to.emit(meldStakingDelegator, "TotalBaseStakedAmountChanged")
          .withArgs(
            delegator.address,
            totalBaseStakedAmountBefore,
            expectedTotalBaseStakedAmountAfter
          );

        await expect(stakeTx)
          .to.emit(meldStakingCommon, "LockStakingRegistered")
          .withArgs(expectedNftId, tierOneId, endLockEpoch);
      });

      it("Should update state correctly for liquid staking", async function () {
        const {
          deployer,
          delegator,
          meldStakingDelegator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
          nodeId,
          liquidStakingTierId,
          operatorTokenId,
        } = await loadFixture(nodeStakedFixture);
        const currentEpoch = await meldStakingStorage.getCurrentEpoch();
        const delegatorBaseStakeAmount = toMeldDecimals(1000);
        const totalBaseStakedAmountBefore =
          await meldStakingStorage.getTotalBaseStakedAmount();
        const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
          await meldStakingNFT.getAddress()
        );
        const expectedNftId = (await meldStakingNFT.getTotalMintedNfts()) + 1n;

        // Get staking data before delegation so that expected values can be calculated. Pass 0 for delegatorTokenId because delegator hasn't staked yet
        const stakingDataBefore = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          0n,
          operatorTokenId,
          nodeId,
          liquidStakingTierId
        );

        // delegator approves the NFT staking contract to be able to deposit the stake
        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          await meldStakingNFT.getAddress(),
          delegatorBaseStakeAmount
        );

        const stakeTx = await meldStakingDelegator
          .connect(delegator)
          .stake(delegatorBaseStakeAmount, nodeId, liquidStakingTierId);

        const block = await ethers.provider.getBlock(stakeTx.blockNumber!);
        const stakingStartTimestamp = block!.timestamp;

        const expectedStakingDataAfter =
          await calculateExpectedStakingDataAfterNewStake(
            meldStakingStorage,
            stakingDataBefore,
            delegatorBaseStakeAmount,
            expectedNftId,
            nodeId,
            liquidStakingTierId,
            true // isDelegator
          );

        // Get the staking data after the stake
        const stakingDataAfter: StakingData = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          expectedNftId,
          operatorTokenId,
          nodeId,
          liquidStakingTierId
        );

        // Get the staker data after the stake
        const stakerDataAfter: StakerData = await getStakerData(
          meldStakingStorage,
          expectedNftId
        );

        // Check staking data
        expect(stakingDataAfter).to.deep.equal(expectedStakingDataAfter);

        // Check staker data
        expect(stakerDataAfter.nftId).to.equal(expectedNftId);
        expect(stakerDataAfter.nodeId).to.equal(nodeId);
        expect(stakerDataAfter.lastEpochStakingUpdated).to.equal(currentEpoch);
        expect(stakerDataAfter.lastEpochRewardsUpdated).to.equal(currentEpoch);
        expect(stakerDataAfter.lockTierId).to.equal(liquidStakingTierId);
        expect(stakerDataAfter.unclaimedRewards).to.equal(0n);
        expect(stakerDataAfter.stakingStartTimestamp).to.equal(
          stakingStartTimestamp
        );
        expect(stakerDataAfter.isStaker).to.be.true;
        expect(stakerDataAfter.isDelegator).to.be.true;
        expect(stakerDataAfter.isOperator).to.be.false;

        // Check protocol state
        expect(await meldStakingStorage.getTotalBaseStakedAmount()).to.equal(
          totalBaseStakedAmountBefore + delegatorBaseStakeAmount
        );
        expect(
          await meldToken.balanceOf(await meldStakingNFT.getAddress())
        ).to.equal(meldStakingNFTBalanceBefore + delegatorBaseStakeAmount);
        expect(await meldStakingStorage.getNodeDelegators(nodeId)).to.include(
          expectedNftId
        );
      });

      it("Should update state correctly for locked staking", async function () {
        const {
          deployer,
          delegator,
          meldStakingDelegator,
          meldStakingStorage,
          meldStakingNFT,
          meldStakingCommon,
          meldToken,
          nodeId,
          tierOneId,
          operatorTokenId,
        } = await loadFixture(nodeStakedFixture);

        const currentEpoch = await meldStakingStorage.getCurrentEpoch();
        const delegatorBaseStakeAmount = toMeldDecimals(11_000);
        const totalBaseStakedAmountBefore =
          await meldStakingStorage.getTotalBaseStakedAmount();
        const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
          await meldStakingNFT.getAddress()
        );
        const expectedNftId = (await meldStakingNFT.getTotalMintedNfts()) + 1n;

        // Get staking data before delegation so that expected values can be calculated. Pass 0 for delegatorTokenId because delegator hasn't staked yet
        const stakingDataBefore = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          0n,
          operatorTokenId,
          nodeId,
          tierOneId
        );

        // delegator approves the NFT staking contract to be able to deposit the stake
        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          await meldStakingNFT.getAddress(),
          delegatorBaseStakeAmount
        );

        const stakeTx = await meldStakingDelegator
          .connect(delegator)
          .stake(delegatorBaseStakeAmount, nodeId, tierOneId);

        const block = await ethers.provider.getBlock(stakeTx.blockNumber!);
        const stakingStartTimestamp = block!.timestamp;

        const endLockEpoch = await meldStakingCommon.getEndLockEpoch(
          expectedNftId
        );

        const expectedStakingDataAfter =
          await calculateExpectedStakingDataAfterNewStake(
            meldStakingStorage,
            stakingDataBefore,
            delegatorBaseStakeAmount,
            expectedNftId,
            nodeId,
            tierOneId,
            true // isDelegator
          );

        // Get the staking data after the stake
        const stakingDataAfter: StakingData = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          expectedNftId,
          operatorTokenId,
          nodeId,
          tierOneId,
          endLockEpoch
        );

        // Get the staker data after the stake
        const stakerDataAfter: StakerData = await getStakerData(
          meldStakingStorage,
          expectedNftId
        );

        // Check staking data
        expect(stakingDataAfter).to.deep.equal(expectedStakingDataAfter);

        // Check staker data
        expect(stakerDataAfter.nftId).to.equal(expectedNftId);
        expect(stakerDataAfter.nodeId).to.equal(nodeId);
        expect(stakerDataAfter.lastEpochStakingUpdated).to.equal(currentEpoch);
        expect(stakerDataAfter.lastEpochRewardsUpdated).to.equal(currentEpoch);
        expect(stakerDataAfter.lockTierId).to.equal(tierOneId);
        expect(stakerDataAfter.unclaimedRewards).to.equal(0n);
        expect(stakerDataAfter.stakingStartTimestamp).to.equal(
          stakingStartTimestamp
        );
        expect(stakerDataAfter.isStaker).to.be.true;
        expect(stakerDataAfter.isDelegator).to.be.true;
        expect(stakerDataAfter.isOperator).to.be.false;

        // Check protocol state
        expect(await meldStakingStorage.getTotalBaseStakedAmount()).to.equal(
          totalBaseStakedAmountBefore + delegatorBaseStakeAmount
        );
        expect(
          await meldToken.balanceOf(await meldStakingNFT.getAddress())
        ).to.equal(meldStakingNFTBalanceBefore + delegatorBaseStakeAmount);
        expect(await meldStakingStorage.getNodeDelegators(nodeId)).to.include(
          expectedNftId
        );
      });

      it("Should allow for whitelisted users to stake in a whitelist active node", async function () {
        const {
          deployer,
          delegator,
          meldStakingDelegator,
          meldStakingConfig,
          meldStakingNFT,
          meldToken,
          liquidStakingTierId,
          nodeId,
        } = await loadFixture(nodeStakedFixture);

        // Lock node to whitelist only
        await meldStakingConfig
          .connect(deployer)
          .toggleDelegatorWhitelist(nodeId, true);

        // add user as whitelisted
        await meldStakingConfig
          .connect(deployer)
          .addDelegatorToWhitelist(nodeId, delegator);

        // proceed to stake

        const delegatorBaseStakeAmount = toMeldDecimals(100);

        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          await meldStakingNFT.getAddress(),
          delegatorBaseStakeAmount
        );

        await expect(
          meldStakingDelegator
            .connect(delegator)
            .stake(delegatorBaseStakeAmount, nodeId, liquidStakingTierId)
        ).not.to.be.reverted;
      });

      it("Should update state correctly when multiple delegators stake the same node", async function () {
        const {
          deployer,
          delegator,
          delegator2,
          meldStakingDelegator,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
          nodeId,
          liquidStakingTierId,
          operatorTokenId,
        } = await loadFixture(nodeStakedFixture);
        const currentEpoch = await meldStakingStorage.getCurrentEpoch();
        const delegatorBaseStakeAmount = toMeldDecimals(1000);
        const delegator2BaseStakeAmount = toMeldDecimals(5000);
        const totalBaseStakedAmountBefore =
          await meldStakingStorage.getTotalBaseStakedAmount();
        const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
          await meldStakingNFT.getAddress()
        );
        const expectedDelegatorNftId =
          (await meldStakingNFT.getTotalMintedNfts()) + 1n;
        const expectedDelegator2NftId =
          (await meldStakingNFT.getTotalMintedNfts()) + 2n;

        // Get staking data before stake 1 so that expected values can be calculated. Pass 0 for delegatorTokenId because delegator hasn't staked yet
        const stakingDataBeforeStake1 = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          0n,
          operatorTokenId,
          nodeId,
          liquidStakingTierId
        );

        // delegator approves the NFT staking contract to be able to deposit the stake
        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          await meldStakingNFT.getAddress(),
          delegatorBaseStakeAmount
        );

        // delegator approves the NFT staking contract to be able to deposit the stake
        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator2,
          await meldStakingNFT.getAddress(),
          delegator2BaseStakeAmount
        );

        // Delegator stakes
        const stakeTx = await meldStakingDelegator
          .connect(delegator)
          .stake(delegatorBaseStakeAmount, nodeId, liquidStakingTierId);

        let block = await ethers.provider.getBlock(stakeTx.blockNumber!);
        const stakingStartTimestamp1 = block!.timestamp;

        // Get the delegator staking data after stake 1
        const delegatorStakingDataAfter: StakingData = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          expectedDelegatorNftId,
          operatorTokenId,
          nodeId,
          liquidStakingTierId
        );

        // Get expected delegator staking data after stake 1
        const expectedDelegatorStakingDataAfter =
          await calculateExpectedStakingDataAfterNewStake(
            meldStakingStorage,
            stakingDataBeforeStake1,
            delegatorBaseStakeAmount,
            expectedDelegatorNftId,
            nodeId,
            liquidStakingTierId,
            true // isDelegator
          );

        // Get staking data before stake 2 so that expected values can be calculated. Pass 0 for delegatorTokenId because delegator hasn't staked yet
        const stakingDataBeforeStake2 = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          0n,
          operatorTokenId,
          nodeId,
          liquidStakingTierId
        );

        // Delegator 2 stakes
        const stake2Tx = await meldStakingDelegator
          .connect(delegator2)
          .stake(delegator2BaseStakeAmount, nodeId, liquidStakingTierId);

        block = await ethers.provider.getBlock(stake2Tx.blockNumber!);
        const stakingStartTimestamp2 = block!.timestamp;

        // Get expected delegator2 data after stake 2
        const expectedDelegator2StakingDataAfter =
          await calculateExpectedStakingDataAfterNewStake(
            meldStakingStorage,
            stakingDataBeforeStake2,
            delegator2BaseStakeAmount,
            expectedDelegator2NftId,
            nodeId,
            liquidStakingTierId,
            true // isDelegator
          );

        // Get the delegator2 staking data after the stake
        const delegator2StakingDataAfter: StakingData = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          expectedDelegator2NftId,
          operatorTokenId,
          nodeId,
          liquidStakingTierId
        );

        // Get the delegator staker data after both stakes
        const delegatorStakerDataAfter: StakerData = await getStakerData(
          meldStakingStorage,
          expectedDelegatorNftId
        );

        // Get the delegator staker data after both stakes
        const delegator2StakerDataAfter: StakerData = await getStakerData(
          meldStakingStorage,
          expectedDelegator2NftId
        );

        // Check staking data for delegator
        expect(delegatorStakingDataAfter).to.deep.equal(
          expectedDelegatorStakingDataAfter
        );

        // Check staker data for delegator
        expect(delegatorStakerDataAfter.nftId).to.equal(expectedDelegatorNftId);
        expect(delegatorStakerDataAfter.nodeId).to.equal(nodeId);
        expect(delegatorStakerDataAfter.lastEpochStakingUpdated).to.equal(
          currentEpoch
        );
        expect(delegatorStakerDataAfter.lastEpochRewardsUpdated).to.equal(
          currentEpoch
        );
        expect(delegatorStakerDataAfter.lockTierId).to.equal(
          liquidStakingTierId
        );
        expect(delegatorStakerDataAfter.unclaimedRewards).to.equal(0n);
        expect(delegatorStakerDataAfter.stakingStartTimestamp).to.equal(
          stakingStartTimestamp1
        );
        expect(delegatorStakerDataAfter.isStaker).to.be.true;
        expect(delegatorStakerDataAfter.isDelegator).to.be.true;
        expect(delegatorStakerDataAfter.isOperator).to.be.false;

        // Check staking data for delegator2
        expect(delegator2StakingDataAfter).to.deep.equal(
          expectedDelegator2StakingDataAfter
        );

        // Check staker data for delegator2
        expect(delegator2StakerDataAfter.nftId).to.equal(
          expectedDelegator2NftId
        );
        expect(delegator2StakerDataAfter.nodeId).to.equal(nodeId);
        expect(delegator2StakerDataAfter.lastEpochStakingUpdated).to.equal(
          currentEpoch
        );
        expect(delegator2StakerDataAfter.lastEpochRewardsUpdated).to.equal(
          currentEpoch
        );
        expect(delegator2StakerDataAfter.lockTierId).to.equal(
          liquidStakingTierId
        );
        expect(delegator2StakerDataAfter.unclaimedRewards).to.equal(0n);
        expect(delegator2StakerDataAfter.stakingStartTimestamp).to.equal(
          stakingStartTimestamp2
        );
        expect(delegator2StakerDataAfter.isStaker).to.be.true;
        expect(delegator2StakerDataAfter.isDelegator).to.be.true;
        expect(delegator2StakerDataAfter.isOperator).to.be.false;

        // Check protocol state
        expect(await meldStakingStorage.getTotalBaseStakedAmount()).to.equal(
          totalBaseStakedAmountBefore +
            delegatorBaseStakeAmount +
            delegator2BaseStakeAmount
        );
        expect(
          await meldToken.balanceOf(await meldStakingNFT.getAddress())
        ).to.equal(
          meldStakingNFTBalanceBefore +
            delegatorBaseStakeAmount +
            delegator2BaseStakeAmount
        );
        expect(await meldStakingStorage.getNodeDelegators(nodeId)).to.include(
          expectedDelegatorNftId
        );
        expect(await meldStakingStorage.getNodeDelegators(nodeId)).to.include(
          expectedDelegator2NftId
        );
      });

      it.skip("Should update state correctly when multiple delegators stake different nodes", async function () {
        const {
          deployer,
          delegator,
          delegator2,
          meldStakingDelegator,
          meldStakingStorage,
          meldStakingNFT,
          meldStakingCommon,
          meldToken,
          nodeId,
          node2Id,
          tierOneId,
          tierTwoId,
          operatorTokenId,
          operator2TokenId,
        } = await loadFixture(nodeLockStakedFixture);
        // Advance time by 1 epoch
        await time.increaseTo(await meldStakingStorage.getEpochStart(2n));

        const currentEpoch = await meldStakingStorage.getCurrentEpoch();
        const delegatorBaseStakeAmount = toMeldDecimals(10_000);
        const delegator2BaseStakeAmount = toMeldDecimals(50_000);
        const totalBaseStakedAmountBefore =
          await meldStakingStorage.getTotalBaseStakedAmount();
        const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
          await meldStakingNFT.getAddress()
        );
        const expectedDelegatorNftId =
          (await meldStakingNFT.getTotalMintedNfts()) + 1n;
        const expectedDelegator2NftId =
          (await meldStakingNFT.getTotalMintedNfts()) + 2n;

        // Get staking data before stake 1 so that expected values can be calculated. Pass 0 for delegatorTokenId because delegator hasn't staked yet
        const stakingDataBeforeStake1 = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          0n,
          operatorTokenId,
          nodeId,
          tierOneId
        );

        // delegator approves the NFT staking contract to be able to deposit the stake
        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          await meldStakingNFT.getAddress(),
          delegatorBaseStakeAmount
        );

        // delegator approves the NFT staking contract to be able to deposit the stake
        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator2,
          await meldStakingNFT.getAddress(),
          delegator2BaseStakeAmount
        );

        // Delegator stakes
        const stakeTx = await meldStakingDelegator
          .connect(delegator)
          .stake(delegatorBaseStakeAmount, nodeId, tierOneId);

        let block = await ethers.provider.getBlock(stakeTx.blockNumber!);
        const stakingStartTimestamp1 = block!.timestamp;
        const endLockEpoch1 = await meldStakingCommon.getEndLockEpoch(
          expectedDelegatorNftId
        );

        // Get the delegator staking data after stake 1
        const delegatorStakingDataAfter: StakingData = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          expectedDelegatorNftId,
          operatorTokenId,
          nodeId,
          tierOneId,
          endLockEpoch1
        );

        // Get expected delegator staking data after stake 1
        const expectedDelegatorStakingDataAfter =
          await calculateExpectedStakingDataAfterNewStake(
            meldStakingStorage,
            stakingDataBeforeStake1,
            delegatorBaseStakeAmount,
            expectedDelegatorNftId,
            nodeId,
            tierOneId,
            true // isDelegator
          );

        // Get staking data before stake 2 so that expected values can be calculated. Pass 0 for delegatorTokenId because delegator hasn't staked yet
        const stakingDataBeforeStake2 = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          0n,
          operator2TokenId,
          node2Id,
          tierTwoId
        );

        // Delegator 2 stakes
        const stake2Tx = await meldStakingDelegator
          .connect(delegator2)
          .stake(delegator2BaseStakeAmount, node2Id, tierTwoId);

        block = await ethers.provider.getBlock(stake2Tx.blockNumber!);
        const stakingStartTimestamp2 = block!.timestamp;
        const endLockEpoch2 = await meldStakingCommon.getEndLockEpoch(
          expectedDelegator2NftId
        );

        // Get expected delegator2 data after stake 2
        const expectedDelegator2StakingDataAfter =
          await calculateExpectedStakingDataAfterNewStake(
            meldStakingStorage,
            stakingDataBeforeStake2,
            delegator2BaseStakeAmount,
            expectedDelegator2NftId,
            node2Id,
            tierTwoId,
            true // isDelegator
          );

        // Get the delegator2 staking data after the stake
        const delegator2StakingDataAfter: StakingData = await getStakingData(
          meldStakingStorage,
          currentEpoch,
          expectedDelegator2NftId,
          operator2TokenId,
          node2Id,
          tierTwoId,
          endLockEpoch2
        );

        // Get the delegator staker data after both stakes
        const delegatorStakerDataAfter: StakerData = await getStakerData(
          meldStakingStorage,
          expectedDelegatorNftId
        );

        // Get the delegator staker data after both stakes
        const delegator2StakerDataAfter: StakerData = await getStakerData(
          meldStakingStorage,
          expectedDelegator2NftId
        );

        // Check staking data for delegator
        expect(delegatorStakingDataAfter).to.deep.equal(
          expectedDelegatorStakingDataAfter
        );

        // Check staker data for delegator
        expect(delegatorStakerDataAfter.nftId).to.equal(expectedDelegatorNftId);
        expect(delegatorStakerDataAfter.nodeId).to.equal(nodeId);
        expect(delegatorStakerDataAfter.lastEpochStakingUpdated).to.equal(
          currentEpoch
        );
        expect(delegatorStakerDataAfter.lastEpochRewardsUpdated).to.equal(
          currentEpoch
        );
        expect(delegatorStakerDataAfter.lockTierId).to.equal(tierOneId);
        expect(delegatorStakerDataAfter.unclaimedRewards).to.equal(0n);
        expect(delegatorStakerDataAfter.stakingStartTimestamp).to.equal(
          stakingStartTimestamp1
        );
        expect(delegatorStakerDataAfter.isStaker).to.be.true;
        expect(delegatorStakerDataAfter.isDelegator).to.be.true;
        expect(delegatorStakerDataAfter.isOperator).to.be.false;

        // Check staking data for delegator2
        expect(delegator2StakingDataAfter).to.deep.equal(
          expectedDelegator2StakingDataAfter
        );

        // Check staker data for delegator2
        expect(delegator2StakerDataAfter.nftId).to.equal(
          expectedDelegator2NftId
        );
        expect(delegator2StakerDataAfter.nodeId).to.equal(nodeId);
        expect(delegator2StakerDataAfter.lastEpochStakingUpdated).to.equal(
          currentEpoch
        );
        expect(delegator2StakerDataAfter.lastEpochRewardsUpdated).to.equal(
          currentEpoch
        );
        expect(delegator2StakerDataAfter.lockTierId).to.equal(tierTwoId);
        expect(delegator2StakerDataAfter.unclaimedRewards).to.equal(0n);
        expect(delegator2StakerDataAfter.stakingStartTimestamp).to.equal(
          stakingStartTimestamp2
        );
        expect(delegator2StakerDataAfter.isStaker).to.be.true;
        expect(delegator2StakerDataAfter.isDelegator).to.be.true;
        expect(delegator2StakerDataAfter.isOperator).to.be.false;

        // Check protocol state
        expect(await meldStakingStorage.getTotalBaseStakedAmount()).to.equal(
          totalBaseStakedAmountBefore +
            delegatorBaseStakeAmount +
            delegator2BaseStakeAmount
        );
        expect(
          await meldToken.balanceOf(await meldStakingNFT.getAddress())
        ).to.equal(
          meldStakingNFTBalanceBefore +
            delegatorBaseStakeAmount +
            delegator2BaseStakeAmount
        );
        expect(await meldStakingStorage.getNodeDelegators(nodeId)).to.include(
          expectedDelegatorNftId
        );
        expect(await meldStakingStorage.getNodeDelegators(nodeId)).to.include(
          expectedDelegator2NftId
        );
      });
    }); // End of stake Happy Flow test cases

    context("Error test cases", function () {
      it("Should revert if node is not active", async function () {
        const {
          delegator,
          meldStakingDelegator,
          liquidStakingTierId,
          delegatorBaseStakeAmount,
        } = await loadFixture(delegatorStakedFixture);

        const fakeNodeId = ethers.ZeroHash;

        await expect(
          meldStakingDelegator
            .connect(delegator)
            .stake(delegatorBaseStakeAmount, fakeNodeId, liquidStakingTierId)
        ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
      });

      it("Should revert if node only accessible by whitelist", async function () {
        const {
          deployer,
          delegator,
          meldStakingDelegator,
          meldStakingConfig,
          meldStakingNFT,
          meldToken,
          liquidStakingTierId,
          nodeId,
        } = await loadFixture(nodeStakedFixture);

        // Lock node to whitelist only
        await meldStakingConfig
          .connect(deployer)
          .toggleDelegatorWhitelist(nodeId, true);

        const delegatorBaseStakeAmount = toMeldDecimals(100);

        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          await meldStakingNFT.getAddress(),
          delegatorBaseStakeAmount
        );

        await expect(
          meldStakingDelegator
            .connect(delegator)
            .stake(delegatorBaseStakeAmount, nodeId, liquidStakingTierId)
        ).to.be.revertedWith(Errors.INVALID_WHITELIST_PERMISSIONS);
      });

      it("Should revert if amount  causes node staked amount to exceed the max for the node", async function () {
        const {
          deployer,
          delegator,
          meldStakingDelegator,
          meldStakingNFT,
          meldToken,
          liquidStakingTierId,
          nodeId,
        } = await loadFixture(nodeStakedFixture);

        // Max = 20,000,000. Operator stake = 100,000
        const delegatorBaseStakeAmount = toMeldDecimals(19_900_001);

        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          await meldStakingNFT.getAddress(),
          delegatorBaseStakeAmount
        );

        await expect(
          meldStakingDelegator
            .connect(delegator)
            .stake(delegatorBaseStakeAmount, nodeId, liquidStakingTierId)
        ).to.be.revertedWith(Errors.STAKING_AMOUNT_OUT_OF_RANGE);
      });

      it("Should revert if deposit amount is invalid", async function () {
        const { delegator, meldStakingDelegator, liquidStakingTierId, nodeId } =
          await loadFixture(nodeStakedFixture);

        await expect(
          meldStakingDelegator
            .connect(delegator)
            .stake(0n, nodeId, liquidStakingTierId)
        ).to.be.revertedWith(Errors.DEPOSIT_INVALID_AMOUNT);
      });
    }); // End of stake Error test cases
  }); // End of stake

  context("withdraw", function () {
    context("Happy Flow Test Cases", function () {
      context("Liquid Staking", function () {
        it("Should emit correct events when there are NO unclaimed rewards", async function () {
          const {
            delegator,
            meldStakingDelegator,
            meldStakingStorage,
            meldStakingCommon,
            meldStakingNFT,
            delegatorTokenId,
            delegatorBaseStakeAmount,
            nodeId,
          } = await loadFixture(delegatorStakedFixture);

          const oldTotalBaseStakedAmount =
            await meldStakingStorage.getTotalBaseStakedAmount();

          const withdrawTx = await meldStakingDelegator
            .connect(delegator)
            .withdraw(delegatorTokenId);

          const newTotalBaseStakedAmount =
            await meldStakingStorage.getTotalBaseStakedAmount();

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "StakeWithdrawn")
            .withArgs(delegatorTokenId, nodeId, delegatorBaseStakeAmount);

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "TotalBaseStakedAmountChanged")
            .withArgs(
              delegator.address,
              oldTotalBaseStakedAmount,
              newTotalBaseStakedAmount
            );

          await expect(withdrawTx).to.not.emit(
            meldStakingCommon,
            "RewardsClaimed"
          );

          await expect(withdrawTx)
            .to.emit(meldStakingNFT, "MeldWithdrawn")
            .withArgs(delegator.address, delegatorBaseStakeAmount);
        });

        it("Should emit correct events when there are unclaimed rewards", async function () {
          const {
            deployer,
            rewardsSetter,
            delegator,
            meldStakingDelegator,
            meldStakingStorage,
            meldStakingConfig,
            meldStakingNFT,
            meldToken,
            delegatorTokenId,
            delegatorBaseStakeAmount,
            delegatorStartStakeEpoch,
            nodeId,
          } = await loadFixture(delegatorStakedFixture);

          const oldTotalBaseStakedAmount =
            await meldStakingStorage.getTotalBaseStakedAmount();

          // Advance time by multiple epochs
          await time.increaseTo(await meldStakingStorage.getEpochStart(10n));

          const untilEpoch = await meldStakingStorage.getCurrentEpoch();

          // Rewards setter sets rewards
          const initialRewardAmount = toMeldDecimals(200_000);
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

          // Advance by one more epoch  so rewards can be set up to untilEpoch
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

          const withdrawTx = await meldStakingDelegator
            .connect(delegator)
            .withdraw(delegatorTokenId);

          const expectedUnclaimedRewards = await calculateRewards(
            meldStakingStorage,
            delegatorTokenId,
            delegatorStartStakeEpoch,
            untilEpoch
          );

          const newTotalBaseStakedAmount =
            await meldStakingStorage.getTotalBaseStakedAmount();

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "StakeWithdrawn")
            .withArgs(
              delegatorTokenId,
              nodeId,
              delegatorBaseStakeAmount + expectedUnclaimedRewards
            );

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "TotalBaseStakedAmountChanged")
            .withArgs(
              delegator.address,
              oldTotalBaseStakedAmount,
              newTotalBaseStakedAmount
            );

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "RewardsClaimed")
            .withArgs(delegatorTokenId, expectedUnclaimedRewards);

          await expect(withdrawTx)
            .to.emit(meldStakingNFT, "MeldWithdrawn")
            .withArgs(
              delegator.address,
              delegatorBaseStakeAmount + expectedUnclaimedRewards
            );
        });

        it("Should update state correctly", async function () {
          const {
            deployer,
            rewardsSetter,
            delegator,
            meldStakingDelegator,
            meldStakingStorage,
            meldStakingConfig,
            meldStakingNFT,
            meldToken,
            operatorTokenId,
            liquidStakingTierId,
            nodeId,
          } = await loadFixture(nodeStakedFixture);

          // Advance time by multiple epochs so delegator stakes in different epoch than operator
          await time.increaseTo(await meldStakingStorage.getEpochStart(2n));

          const currentEpoch = await meldStakingStorage.getCurrentEpoch();
          const depositAmount: bigint = toMeldDecimals(30_000);

          await delegateToNode(
            meldToken,
            meldStakingDelegator,
            meldStakingNFT,
            deployer,
            delegator,
            depositAmount,
            nodeId,
            liquidStakingTierId
          );

          const delegatorTokenId = await meldStakingNFT.getTotalMintedNfts();

          const delegatorBalanceBefore = await meldToken.balanceOf(
            delegator.address
          );

          // Advance time by multiple epochs to simulate delegator waiting to withdraw
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(currentEpoch + 10n)
          );

          const rewardsUpdateEpoch = await meldStakingStorage.getCurrentEpoch();

          // Rewards setter sets rewards
          const initialRewardAmount = toMeldDecimals(2_000_000);
          const amountIncrease = toMeldDecimals(20_000);

          const rewardAmounts = [];
          const numEpochs = rewardsUpdateEpoch;
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

          // Advance by one more epoch so rewards can be set up to untilEpoch
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(rewardsUpdateEpoch + 1n)
          );
          const untilEpoch = await meldStakingStorage.getCurrentEpoch();

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

          const delegatorLastEpochUpdated =
            await meldStakingStorage.getStakerLastEpochStakingUpdated(
              delegatorTokenId
            );

          // Get staking data before withdrawal so that expected values can be calculated.
          const stakingDataBefore = await getStakingData(
            meldStakingStorage,
            delegatorLastEpochUpdated,
            delegatorTokenId,
            operatorTokenId,
            nodeId,
            liquidStakingTierId
          );

          const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
            await meldStakingNFT.getAddress()
          );
          const lockedMeldTokensBefore =
            await meldStakingNFT.lockedMeldTokens();
          const redeemedNFTsBefore = await meldStakingNFT.redeemedNfts();

          await meldStakingDelegator
            .connect(delegator)
            .withdraw(delegatorTokenId);

          const expectedStakingDataAfter =
            await calculateExpectedStakingDataAfterWithdrawal(
              meldStakingStorage,
              stakingDataBefore,
              delegatorTokenId,
              nodeId,
              liquidStakingTierId
            );

          // Get the staking data after the stake
          const stakingDataAfter: StakingData = await getStakingData(
            meldStakingStorage,
            untilEpoch,
            delegatorTokenId,
            operatorTokenId,
            nodeId,
            liquidStakingTierId
          );

          const meldStakingNFTBalanceAfter = await meldToken.balanceOf(
            await meldStakingNFT.getAddress()
          );
          const delegatorBalanceAfter = await meldToken.balanceOf(
            delegator.address
          );
          const lockedMeldTokensAfter = await meldStakingNFT.lockedMeldTokens();
          const redeemedNFTsAfter = await meldStakingNFT.redeemedNfts();

          const expectedRewards = await calculateRewards(
            meldStakingStorage,
            delegatorTokenId,
            currentEpoch,
            untilEpoch
          );

          // Check state
          expect(stakingDataAfter).to.deep.equal(expectedStakingDataAfter);
          expect(
            await meldStakingStorage.getLastEpochStakingUpdated()
          ).to.equal(untilEpoch);
          expect(
            await meldStakingStorage.getLastEpochRewardsUpdated()
          ).to.equal(untilEpoch - 1n);
          expect(
            await meldStakingStorage.isStaker(delegatorTokenId)
          ).to.be.false;
          expect(
            await meldStakingStorage.isDelegator(delegatorTokenId)
          ).to.be.false;
          expect(
            await meldStakingStorage.isOperator(operatorTokenId)
          ).to.be.true;
          expect(
            await meldStakingStorage.getNodeDelegators(nodeId)
          ).to.not.include(delegatorTokenId);
          expect(
            await meldStakingStorage.getStakerUnclaimedRewards(delegatorTokenId)
          ).to.equal(0n);
          expect(delegatorBalanceAfter).to.equal(
            delegatorBalanceBefore + depositAmount + expectedRewards
          );
          expect(meldStakingNFTBalanceAfter).equal(
            meldStakingNFTBalanceBefore - depositAmount - expectedRewards
          );
          expect(lockedMeldTokensAfter).equal(
            lockedMeldTokensBefore - depositAmount - expectedRewards
          );
          expect(redeemedNFTsAfter).equal(redeemedNFTsBefore + 1n);
        });
        it("Should be able to withdraw from a partially slashed node", async function () {
          const {
            deployer,
            rewardsSetter,
            delegator,
            meldStakingDelegator,
            meldStakingCommon,
            meldStakingStorage,
            meldStakingConfig,
            meldStakingNFT,
            meldToken,
            liquidStakingTierId,
            nodeId,
          } = await loadFixture(nodeStakedFixture);

          // Advance time by multiple epochs so delegator stakes in different epoch than operator
          await time.increaseTo(await meldStakingStorage.getEpochStart(2n));

          const currentEpoch = await meldStakingStorage.getCurrentEpoch();
          const depositAmount: bigint = toMeldDecimals(30_000);

          await delegateToNode(
            meldToken,
            meldStakingDelegator,
            meldStakingNFT,
            deployer,
            delegator,
            depositAmount,
            nodeId,
            liquidStakingTierId
          );

          const delegatorTokenId = await meldStakingNFT.getTotalMintedNfts();

          const delegatorBalanceBefore = await meldToken.balanceOf(
            delegator.address
          );

          // Advance time by multiple epochs to simulate delegator waiting to withdraw
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(currentEpoch + 10n)
          );

          // Node gets partially slashed by 25%

          const slashPercentage = 25_00n; // 25%

          await meldStakingConfig.slashNode(nodeId, slashPercentage);

          expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;
          expect(
            await meldStakingStorage.isNodeFullySlashed(nodeId)
          ).to.be.false;

          expect(
            await meldStakingStorage.getNodeSlashedPercentage(nodeId)
          ).to.eq(slashPercentage);

          // Rewards setter sets rewards
          const rewardAmount = toMeldDecimals(2_000_000);

          const startRewardsEpoch = 2;
          const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

          await transferAndApproveTokens(
            meldToken,
            deployer,
            rewardsSetter,
            await meldStakingNFT.getAddress(),
            rewardAmount * (1n + newCurrentEpoch - BigInt(startRewardsEpoch))
          );

          for (
            let epoch = startRewardsEpoch;
            epoch < newCurrentEpoch;
            epoch++
          ) {
            await meldStakingConfig
              .connect(rewardsSetter)
              .setRewards(rewardAmount, epoch);
          }

          await meldStakingCommon.updateStakerPreviousEpochs(delegatorTokenId);

          const expectedRewards = await calculateRewards(
            meldStakingStorage,
            delegatorTokenId,
            0n,
            newCurrentEpoch
          );

          // Withdraw
          const expectedWithdrawAmount =
            (depositAmount * (PERCENTAGE_SCALING - slashPercentage)) / 100_00n +
            expectedRewards;
          const withdrawTx = await meldStakingDelegator
            .connect(delegator)
            .withdraw(delegatorTokenId);

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "StakeWithdrawn")
            .withArgs(delegatorTokenId, nodeId, expectedWithdrawAmount);

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "RewardsClaimed")
            .withArgs(delegatorTokenId, expectedRewards);

          const delegatorBalanceAfter = await meldToken.balanceOf(
            delegator.address
          );

          expect(delegatorBalanceAfter).to.equal(
            delegatorBalanceBefore + expectedWithdrawAmount
          );

          expect(
            await meldStakingStorage.isStaker(delegatorTokenId)
          ).to.be.false;
          expect(await meldStakingNFT.balanceOf(delegator.address)).to.equal(
            0n
          );
        });
      }); // End of Liquid Staking

      context("Locked Staking", function () {
        it("Should emit correct events when there are NO unclaimed rewards", async function () {
          const {
            delegator,
            meldStakingDelegator,
            meldStakingStorage,
            meldStakingCommon,
            meldStakingNFT,
            delegatorTokenId,
            delegatorBaseLockedStakeAmount,
            nodeId,
          } = await loadFixture(delegatorLockStakedFixture);

          const delegatorEndLockEpoch = await calculateEndLockEpoch(
            meldStakingStorage,
            delegatorTokenId
          );

          // Advance time by multiple epochs
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(delegatorEndLockEpoch + 1n)
          );

          const oldTotalBaseStakedAmount =
            await meldStakingStorage.getTotalBaseStakedAmount();

          const withdrawTx = await meldStakingDelegator
            .connect(delegator)
            .withdraw(delegatorTokenId);

          const newTotalBaseStakedAmount =
            await meldStakingStorage.getTotalBaseStakedAmount();

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "StakeWithdrawn")
            .withArgs(delegatorTokenId, nodeId, delegatorBaseLockedStakeAmount);

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "TotalBaseStakedAmountChanged")
            .withArgs(
              delegator.address,
              oldTotalBaseStakedAmount,
              newTotalBaseStakedAmount
            );

          await expect(withdrawTx).to.not.emit(
            meldStakingCommon,
            "RewardsClaimed"
          );

          await expect(withdrawTx)
            .to.emit(meldStakingNFT, "MeldWithdrawn")
            .withArgs(delegator.address, delegatorBaseLockedStakeAmount);
        });

        it("Should emit correct events when there are unclaimed rewards", async function () {
          const {
            deployer,
            delegator,
            rewardsSetter,
            meldStakingDelegator,
            meldStakingStorage,
            meldStakingConfig,
            meldStakingNFT,
            meldToken,
            delegatorTokenId,
            delegatorBaseLockedStakeAmount,
            delegatorStartLockStakeEpoch,
            nodeId,
          } = await loadFixture(delegatorLockStakedFixture);

          const delegatorEndLockEpoch = await calculateEndLockEpoch(
            meldStakingStorage,
            delegatorTokenId
          );

          // Advance time by multiple epochs
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(delegatorEndLockEpoch + 1n)
          );

          const oldTotalBaseStakedAmount =
            await meldStakingStorage.getTotalBaseStakedAmount();
          const untilEpoch = await meldStakingStorage.getCurrentEpoch();

          // Rewards setter sets rewards
          const initialRewardAmount = toMeldDecimals(200_000);
          const amountIncrease = toMeldDecimals(10_000);

          const rewardAmounts = [];
          const numEpochs = untilEpoch;
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

          // Advance by one more epoch  so rewards can be set up to untilEpoch
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

          const withdrawTx = await meldStakingDelegator
            .connect(delegator)
            .withdraw(delegatorTokenId);

          const expectedUnclaimedRewards = await calculateRewards(
            meldStakingStorage,
            delegatorTokenId,
            delegatorStartLockStakeEpoch,
            untilEpoch
          );

          const newTotalBaseStakedAmount =
            await meldStakingStorage.getTotalBaseStakedAmount();

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "StakeWithdrawn")
            .withArgs(
              delegatorTokenId,
              nodeId,
              delegatorBaseLockedStakeAmount + expectedUnclaimedRewards
            );

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "TotalBaseStakedAmountChanged")
            .withArgs(
              delegator.address,
              oldTotalBaseStakedAmount,
              newTotalBaseStakedAmount
            );

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "RewardsClaimed")
            .withArgs(delegatorTokenId, expectedUnclaimedRewards);

          await expect(withdrawTx)
            .to.emit(meldStakingNFT, "MeldWithdrawn")
            .withArgs(
              delegator.address,
              delegatorBaseLockedStakeAmount + expectedUnclaimedRewards
            );
        });
        it("Should update state correctly when operator lock period ends before delegator lock period", async function () {
          const {
            deployer,
            rewardsSetter,
            delegator,
            meldStakingDelegator,
            meldStakingStorage,
            meldStakingConfig,
            meldStakingNFT,
            meldToken,
            operator2TokenId,
            tierTwoId,
            tierOneId,
            node2Id,
            operator2BaseLockedStakeAmount,
            operatorBaseLockedStakeAmount,
          } = await loadFixture(nodeLockStakedFixture);

          // Advance time by multiple epochs so delegator stakes in different epoch than operator
          await time.increaseTo(await meldStakingStorage.getEpochStart(2n));

          const delegatorStakeEpoch =
            await meldStakingStorage.getCurrentEpoch();
          const delegatorBaseStakeAmount: bigint = toMeldDecimals(60_000);

          await delegateToNode(
            meldToken,
            meldStakingDelegator,
            meldStakingNFT,
            deployer,
            delegator,
            delegatorBaseStakeAmount,
            node2Id,
            tierTwoId
          );

          const delegatorTokenId = await meldStakingNFT.getTotalMintedNfts();

          const delegatorEndLockEpoch = await calculateEndLockEpoch(
            meldStakingStorage,
            delegatorTokenId
          );

          const delegatorBalanceBefore = await meldToken.balanceOf(
            delegator.address
          );

          // Advance time by multiple epochs to simulate delegator waiting to withdraw
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(
              delegatorStakeEpoch + delegatorEndLockEpoch
            )
          );

          const rewardsUpdateEpoch = await meldStakingStorage.getCurrentEpoch();

          // Rewards setter sets rewards
          const initialRewardAmount = toMeldDecimals(2_000_000);
          const amountIncrease = toMeldDecimals(20_000);

          const rewardAmounts = [];
          const numEpochs = rewardsUpdateEpoch;
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

          // Advance by one more epoch so rewards can be set up to rewardsUpdateEpoch
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(rewardsUpdateEpoch + 1n)
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

          // Get staking data before withdrawal so that expected values can be calculated.
          const stakingDataBeforeWithdrawal = await getStakingData(
            meldStakingStorage,
            delegatorStakeEpoch,
            delegatorTokenId,
            operator2TokenId,
            node2Id,
            tierTwoId,
            delegatorEndLockEpoch
          );

          const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
            await meldStakingNFT.getAddress()
          );
          const lockedMeldTokensBefore =
            await meldStakingNFT.lockedMeldTokens();
          const redeemedNFTsBefore = await meldStakingNFT.redeemedNfts();

          // Delegator withdraws
          const withdrawalEpoch = await meldStakingStorage.getCurrentEpoch();

          await meldStakingDelegator
            .connect(delegator)
            .withdraw(delegatorTokenId);

          const delegationFee = await calculateDelegationFeeAmount(
            meldStakingStorage,
            node2Id,
            delegatorBaseStakeAmount
          );

          // Operator 1 staked node 1 in epoch 1 and locked for 10 epochs, 120% weight
          const operator1WeightedAmount = await calculateWeightedAmount(
            meldStakingStorage,
            operatorBaseLockedStakeAmount,
            tierOneId
          );

          // Operator 2 staked node 2 in epoch 1 and locked for 20 epochs, 175% weight
          const operator2WeightedAmount = await calculateWeightedAmount(
            meldStakingStorage,
            operator2BaseLockedStakeAmount,
            tierTwoId
          );

          const delegatorWeightedAmount = await calculateWeightedAmount(
            meldStakingStorage,
            delegatorBaseStakeAmount,
            tierTwoId
          );

          const operator1ExcessWeightedAmount =
            operator1WeightedAmount - operatorBaseLockedStakeAmount;
          const operator2ExcessWeightedAmount =
            operator2WeightedAmount - operator2BaseLockedStakeAmount;
          const delegatorExcessWeightedAmount =
            delegatorWeightedAmount - delegatorBaseStakeAmount;

          let expectedStakingDataAfter: StakingData = <StakingData>{};

          // Operator, operator2 and delegator locked staking periods ended during the test.
          // Operator lock period ends in epoch 12, operator 2 lock period ended in epoch 22 and operator 2 loses delegator fee due to withdrawal
          expectedStakingDataAfter = {
            delegator: {
              baseStakedAmount: 0n,
              lastStakedAmount: 0n,
              minStakedAmount: 0n,
            },
            operator: {
              baseStakedAmount: operator2BaseLockedStakeAmount,
              lastStakedAmount:
                stakingDataBeforeWithdrawal.operator!.lastStakedAmount -
                operator2ExcessWeightedAmount -
                delegationFee,
              minStakedAmount:
                stakingDataBeforeWithdrawal.operator!.minStakedAmount -
                operator2ExcessWeightedAmount,
            },

            node: {
              baseStakedAmount:
                stakingDataBeforeWithdrawal.node!.baseStakedAmount -
                delegatorBaseStakeAmount,
              lastStakedAmount:
                stakingDataBeforeWithdrawal.node!.lastStakedAmount -
                operator2ExcessWeightedAmount -
                delegatorExcessWeightedAmount -
                delegatorBaseStakeAmount,
              minStakedAmount:
                stakingDataBeforeWithdrawal.node!.lastStakedAmount -
                operator2ExcessWeightedAmount -
                delegatorExcessWeightedAmount -
                delegatorBaseStakeAmount,
              excessWeightedStake: 0n,
            },

            global: {
              baseStakedAmount:
                stakingDataBeforeWithdrawal.global!.baseStakedAmount -
                delegatorBaseStakeAmount,
              lastStakedAmount:
                stakingDataBeforeWithdrawal.global!.lastStakedAmount -
                operator1ExcessWeightedAmount -
                operator2ExcessWeightedAmount -
                delegatorExcessWeightedAmount -
                delegatorBaseStakeAmount,
              minStakedAmount:
                stakingDataBeforeWithdrawal.global!.lastStakedAmount -
                operator1ExcessWeightedAmount -
                operator2ExcessWeightedAmount -
                delegatorExcessWeightedAmount -
                delegatorBaseStakeAmount,
              excessWeightedStake: 0n,
            },
          };

          // Get the staking data after the stake
          const stakingDataAfter: StakingData = await getStakingData(
            meldStakingStorage,
            withdrawalEpoch,
            delegatorTokenId,
            operator2TokenId,
            node2Id,
            tierTwoId,
            delegatorEndLockEpoch
          );

          const meldStakingNFTBalanceAfter = await meldToken.balanceOf(
            await meldStakingNFT.getAddress()
          );
          const delegatorBalanceAfter = await meldToken.balanceOf(
            delegator.address
          );
          const lockedMeldTokensAfter = await meldStakingNFT.lockedMeldTokens();
          const redeemedNFTsAfter = await meldStakingNFT.redeemedNfts();

          const expectedRewards = await calculateRewards(
            meldStakingStorage,
            delegatorTokenId,
            delegatorStakeEpoch,
            withdrawalEpoch
          );

          // Check state.
          expect(stakingDataAfter).to.deep.equal(expectedStakingDataAfter);
          expect(
            await meldStakingStorage.getLastEpochStakingUpdated()
          ).to.equal(withdrawalEpoch);
          expect(
            await meldStakingStorage.getLastEpochRewardsUpdated()
          ).to.equal(withdrawalEpoch - 1n);
          expect(
            await meldStakingStorage.isStaker(delegatorTokenId)
          ).to.be.false;
          expect(
            await meldStakingStorage.isDelegator(delegatorTokenId)
          ).to.be.false;
          expect(
            await meldStakingStorage.isOperator(operator2TokenId)
          ).to.be.true;
          expect(
            await meldStakingStorage.getNodeDelegators(node2Id)
          ).to.not.include(delegatorTokenId);
          expect(
            await meldStakingStorage.getStakerUnclaimedRewards(delegatorTokenId)
          ).to.equal(0n);
          expect(delegatorBalanceAfter).to.equal(
            delegatorBalanceBefore + delegatorBaseStakeAmount + expectedRewards
          );
          expect(meldStakingNFTBalanceAfter).equal(
            meldStakingNFTBalanceBefore -
              delegatorBaseStakeAmount -
              expectedRewards
          );
          expect(lockedMeldTokensAfter).equal(
            lockedMeldTokensBefore - delegatorBaseStakeAmount - expectedRewards
          );
          expect(redeemedNFTsAfter).equal(redeemedNFTsBefore + 1n);
        });

        it("Should update state correctly when operator lock period ends after delegator lock period", async function () {
          const {
            deployer,
            rewardsSetter,
            delegator,
            meldStakingDelegator,
            meldStakingStorage,
            meldStakingConfig,
            meldStakingNFT,
            meldToken,
            operator2TokenId,
            tierOneId,
            node2Id,
            operator2BaseLockedStakeAmount,
            operatorBaseLockedStakeAmount,
          } = await loadFixture(nodeLockStakedFixture);

          // Advance time by multiple epochs so delegator stakes in different epoch than operator
          await time.increaseTo(await meldStakingStorage.getEpochStart(2n));

          const delegatorStakeEpoch =
            await meldStakingStorage.getCurrentEpoch();
          const delegatorBaseStakeAmount: bigint = toMeldDecimals(60_000);

          // Delegator stakes node2 using tier 1, which has a lock period of 10 epochs
          // Operator2 staked node2 using tier 2, which has a lock period of 20 epochs.
          // Operator2's lock period ends after delegator's lock period.
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

          const delegatorTokenId = await meldStakingNFT.getTotalMintedNfts();

          const delegatorEndLockEpoch = await calculateEndLockEpoch(
            meldStakingStorage,
            delegatorTokenId
          );

          const delegatorBalanceBefore = await meldToken.balanceOf(
            delegator.address
          );

          // Advance time by multiple epochs to simulate delegator waiting to withdraw
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(
              delegatorStakeEpoch + delegatorEndLockEpoch
            )
          );

          const rewardsUpdateEpoch = await meldStakingStorage.getCurrentEpoch();

          // Rewards setter sets rewards
          const initialRewardAmount = toMeldDecimals(2_000_000);
          const amountIncrease = toMeldDecimals(20_000);

          const rewardAmounts = [];
          const numEpochs = rewardsUpdateEpoch;
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

          // Advance by one more epoch so rewards can be set up to rewardsUpdateEpoch
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(rewardsUpdateEpoch + 1n)
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

          // Get staking data before withdrawal so that expected values can be calculated.
          const stakingDataBeforeWithdrawal = await getStakingData(
            meldStakingStorage,
            delegatorStakeEpoch,
            delegatorTokenId,
            operator2TokenId,
            node2Id,
            tierOneId,
            delegatorEndLockEpoch
          );

          const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
            await meldStakingNFT.getAddress()
          );
          const lockedMeldTokensBefore =
            await meldStakingNFT.lockedMeldTokens();
          const redeemedNFTsBefore = await meldStakingNFT.redeemedNfts();

          // Delegator withdraws
          const withdrawalEpoch = await meldStakingStorage.getCurrentEpoch();

          await meldStakingDelegator
            .connect(delegator)
            .withdraw(delegatorTokenId);

          const delegationFee = await calculateDelegationFeeAmount(
            meldStakingStorage,
            node2Id,
            delegatorBaseStakeAmount
          );

          // Operator 1 staked node 1 in epoch 1 and locked for 10 epochs, 120% weight
          const operator1WeightedAmount = await calculateWeightedAmount(
            meldStakingStorage,
            operatorBaseLockedStakeAmount,
            tierOneId
          );

          // Delegator stakes node2 using tier 1, which has a lock period of 10 epochs, 120% weight
          const delegatorWeightedAmount = await calculateWeightedAmount(
            meldStakingStorage,
            delegatorBaseStakeAmount,
            tierOneId
          );

          const operator1ExcessWeightedAmount =
            operator1WeightedAmount - operatorBaseLockedStakeAmount;
          const delegatorExcessWeightedAmount =
            delegatorWeightedAmount - delegatorBaseStakeAmount;

          let expectedStakingDataAfter: StakingData = <StakingData>{};

          // Operator, and delegator locked staking periods ended during the test.
          // Operator lock period ended in epoch 12, delegator lock period ended in epoch 13, and operator 2 lost delegator fee due to withdrawal
          expectedStakingDataAfter = {
            delegator: {
              baseStakedAmount: 0n,
              lastStakedAmount: 0n,
              minStakedAmount: 0n,
            },
            operator: {
              baseStakedAmount: operator2BaseLockedStakeAmount,
              lastStakedAmount:
                stakingDataBeforeWithdrawal.operator!.lastStakedAmount -
                delegationFee,
              minStakedAmount:
                stakingDataBeforeWithdrawal.operator!.minStakedAmount,
            },

            node: {
              baseStakedAmount:
                stakingDataBeforeWithdrawal.node!.baseStakedAmount -
                delegatorBaseStakeAmount,
              lastStakedAmount:
                stakingDataBeforeWithdrawal.node!.lastStakedAmount -
                delegatorExcessWeightedAmount -
                delegatorBaseStakeAmount,
              minStakedAmount:
                stakingDataBeforeWithdrawal.node!.lastStakedAmount -
                delegatorExcessWeightedAmount -
                delegatorBaseStakeAmount,
              excessWeightedStake: 0n,
            },

            global: {
              baseStakedAmount:
                stakingDataBeforeWithdrawal.global!.baseStakedAmount -
                delegatorBaseStakeAmount,
              lastStakedAmount:
                stakingDataBeforeWithdrawal.global!.lastStakedAmount -
                operator1ExcessWeightedAmount -
                delegatorExcessWeightedAmount -
                delegatorBaseStakeAmount,
              minStakedAmount:
                stakingDataBeforeWithdrawal.global!.lastStakedAmount -
                operator1ExcessWeightedAmount -
                delegatorExcessWeightedAmount -
                delegatorBaseStakeAmount,
              excessWeightedStake: 0n,
            },
          };

          // Get the staking data after the stake
          const stakingDataAfter: StakingData = await getStakingData(
            meldStakingStorage,
            withdrawalEpoch,
            delegatorTokenId,
            operator2TokenId,
            node2Id,
            tierOneId,
            delegatorEndLockEpoch
          );

          const meldStakingNFTBalanceAfter = await meldToken.balanceOf(
            await meldStakingNFT.getAddress()
          );
          const delegatorBalanceAfter = await meldToken.balanceOf(
            delegator.address
          );
          const lockedMeldTokensAfter = await meldStakingNFT.lockedMeldTokens();
          const redeemedNFTsAfter = await meldStakingNFT.redeemedNfts();

          const expectedRewards = await calculateRewards(
            meldStakingStorage,
            delegatorTokenId,
            delegatorStakeEpoch,
            withdrawalEpoch
          );

          // Check state.
          expect(stakingDataAfter).to.deep.equal(expectedStakingDataAfter);
          expect(
            await meldStakingStorage.getLastEpochStakingUpdated()
          ).to.equal(withdrawalEpoch);
          expect(
            await meldStakingStorage.getLastEpochRewardsUpdated()
          ).to.equal(withdrawalEpoch - 1n);
          expect(
            await meldStakingStorage.isStaker(delegatorTokenId)
          ).to.be.false;
          expect(
            await meldStakingStorage.isDelegator(delegatorTokenId)
          ).to.be.false;
          expect(
            await meldStakingStorage.isOperator(operator2TokenId)
          ).to.be.true;
          expect(
            await meldStakingStorage.getNodeDelegators(node2Id)
          ).to.not.include(delegatorTokenId);
          expect(
            await meldStakingStorage.getStakerUnclaimedRewards(delegatorTokenId)
          ).to.equal(0n);
          expect(delegatorBalanceAfter).to.equal(
            delegatorBalanceBefore + delegatorBaseStakeAmount + expectedRewards
          );
          expect(meldStakingNFTBalanceAfter).equal(
            meldStakingNFTBalanceBefore -
              delegatorBaseStakeAmount -
              expectedRewards
          );
          expect(lockedMeldTokensAfter).equal(
            lockedMeldTokensBefore - delegatorBaseStakeAmount - expectedRewards
          );
          expect(redeemedNFTsAfter).equal(redeemedNFTsBefore + 1n);
        });

        it("Should be able to withdraw from a partially slashed node", async function () {
          const {
            deployer,
            rewardsSetter,
            delegator,
            meldStakingDelegator,
            meldStakingCommon,
            meldStakingStorage,
            meldStakingConfig,
            meldStakingNFT,
            meldToken,
            tierOneId,
            nodeId,
          } = await loadFixture(nodeLockStakedFixture);

          // Advance time by multiple epochs so delegator stakes in different epoch than operator
          await time.increaseTo(await meldStakingStorage.getEpochStart(2n));

          const currentEpoch = await meldStakingStorage.getCurrentEpoch();
          const depositAmount: bigint = toMeldDecimals(30_000);

          await delegateToNode(
            meldToken,
            meldStakingDelegator,
            meldStakingNFT,
            deployer,
            delegator,
            depositAmount,
            nodeId,
            tierOneId
          );

          const delegatorTokenId = await meldStakingNFT.getTotalMintedNfts();

          const delegatorBalanceBefore = await meldToken.balanceOf(
            delegator.address
          );

          // Advance time by multiple epochs to simulate delegator waiting to withdraw
          await time.increaseTo(
            await meldStakingStorage.getEpochStart(currentEpoch + 10n)
          );

          // Node gets partially slashed by 25%

          const slashPercentage = 25_00n; // 25%

          await meldStakingConfig.slashNode(nodeId, slashPercentage);

          expect(await meldStakingStorage.isNodeSlashed(nodeId)).to.be.true;
          expect(
            await meldStakingStorage.isNodeFullySlashed(nodeId)
          ).to.be.false;

          expect(
            await meldStakingStorage.getNodeSlashedPercentage(nodeId)
          ).to.eq(slashPercentage);

          // Rewards setter sets rewards
          const rewardAmount = toMeldDecimals(2_000_000);

          const startRewardsEpoch = 2;
          const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

          await transferAndApproveTokens(
            meldToken,
            deployer,
            rewardsSetter,
            await meldStakingNFT.getAddress(),
            rewardAmount * (1n + newCurrentEpoch - BigInt(startRewardsEpoch))
          );

          for (
            let epoch = startRewardsEpoch;
            epoch < newCurrentEpoch;
            epoch++
          ) {
            await meldStakingConfig
              .connect(rewardsSetter)
              .setRewards(rewardAmount, epoch);
          }

          await meldStakingCommon.updateStakerPreviousEpochs(delegatorTokenId);

          const expectedRewards = await calculateRewards(
            meldStakingStorage,
            delegatorTokenId,
            0n,
            newCurrentEpoch
          );

          // Withdraw
          const expectedWithdrawAmount =
            (depositAmount * (PERCENTAGE_SCALING - slashPercentage)) / 100_00n +
            expectedRewards;
          const withdrawTx = await meldStakingDelegator
            .connect(delegator)
            .withdraw(delegatorTokenId);

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "StakeWithdrawn")
            .withArgs(delegatorTokenId, nodeId, expectedWithdrawAmount);

          await expect(withdrawTx)
            .to.emit(meldStakingDelegator, "RewardsClaimed")
            .withArgs(delegatorTokenId, expectedRewards);

          const delegatorBalanceAfter = await meldToken.balanceOf(
            delegator.address
          );

          expect(delegatorBalanceAfter).to.equal(
            delegatorBalanceBefore + expectedWithdrawAmount
          );

          expect(
            await meldStakingStorage.isStaker(delegatorTokenId)
          ).to.be.false;
          expect(await meldStakingNFT.balanceOf(delegator.address)).to.equal(
            0n
          );
        });
      }); // End of Locked Staking
    }); // End of withdraw Happy Flow test cases

    context("Error test cases", function () {
      it("Should revert if the caller is not the owner of the nft", async function () {
        const { delegator, meldStakingDelegator } = await loadFixture(
          nodeStakedFixture
        );

        const delegatorTokenId = 1n;
        await expect(
          meldStakingDelegator.connect(delegator).withdraw(delegatorTokenId)
        ).to.be.revertedWith(Errors.NOT_NFT_OWNER);
      });
      it("Should revert if nftId is not a delegator", async function () {
        const { operator, meldStakingDelegator } = await loadFixture(
          nodeStakedFixture
        );

        const delegatorTokenId = 1n;
        await expect(
          meldStakingDelegator.connect(operator).withdraw(delegatorTokenId)
        ).to.be.revertedWith(Errors.NOT_DELEGATOR);
      });
      it("Should revert if the node is inactive", async function () {
        const {
          operator,
          delegator,
          meldStakingDelegator,
          meldStakingOperator,
          delegatorTokenId,
          operatorTokenId,
        } = await loadFixture(delegatorStakedFixture);

        // Operator leaves node
        await meldStakingOperator.connect(operator).leaveNode(operatorTokenId);

        await expect(
          meldStakingDelegator.connect(delegator).withdraw(delegatorTokenId)
        ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
      });
      it("Should revert if the node is fully slashed", async function () {
        const {
          deployer,
          delegator,
          nodeId,
          meldStakingConfig,
          meldStakingDelegator,
          delegatorTokenId,
        } = await loadFixture(delegatorStakedFixture);

        // Slash node fully
        await meldStakingConfig.connect(deployer).slashNode(nodeId, 100_00n);

        await expect(
          meldStakingDelegator.connect(delegator).withdraw(delegatorTokenId)
        ).to.be.revertedWith(Errors.NODE_FULLY_SLASHED);
      });
    }); // End of withdraw Error test cases
  }); // End of withdraw

  context("Change Delegation", function () {
    context("Happy path test cases", function () {
      it("Should allow for whitelisted user to delegate to whitelist enabled node", async function () {
        const {
          deployer,
          delegator,
          operator,
          meldStakingDelegator,
          meldStakingOperator,
          meldStakingConfig,
          meldStakingNFT,
          meldToken,
          liquidStakingTierId,
          nodeId,
        } = await loadFixture(nodeStakedFixture);

        // STEP 1 - Stake to Node 1
        const delegatorBaseStakeAmount = toMeldDecimals(100);

        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          await meldStakingNFT.getAddress(),
          delegatorBaseStakeAmount
        );

        await meldStakingDelegator
          .connect(delegator)
          .stake(delegatorBaseStakeAmount, nodeId, liquidStakingTierId);
        const nftId = await meldStakingNFT.getTotalMintedNfts();

        // STEP 2 - Setup node 2, and lock it

        // Params for the node request
        const node2Name = "test2Node";
        const delegatorFee = 10_00; // 10%
        const operatorBaseStakeAmount = toMeldDecimals(100_000);
        const metadata = "";

        // operator approves the NFT staking contract to be able to deposit the stake and requests node
        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          node2Name,
          delegatorFee,
          operatorBaseStakeAmount,
          liquidStakingTierId,
          metadata
        );

        const node2Id = await meldStakingOperator.hashNodeId(node2Name);
        await meldStakingConfig.connect(deployer).approveNodeRequest(node2Id);

        // Lock node to whitelist only
        await meldStakingConfig
          .connect(deployer)
          .toggleDelegatorWhitelist(node2Id, true);

        // Add delegator as whitelisted user for delegation to that node

        await meldStakingConfig
          .connect(deployer)
          .addDelegatorToWhitelist(node2Id, delegator);

        // STEP 3 - TRY TO DELEGATE TO LOCKED NODE 2
        await expect(
          meldStakingDelegator
            .connect(delegator)
            .changeDelegation(nftId, node2Id)
        ).not.to.be.reverted;
      });

      it("Should change delegation from inactive node, upgrading to liquid in the process", async function () {
        const {
          deployer,
          delegator,
          operator,
          operator2,
          rewardsSetter,
          meldToken,
          meldStakingDelegator,
          meldStakingCommon,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingStorage,
          meldStakingNFT,
          delegatorTokenId,
          nodeId,
        } = await loadFixture(delegatorLockStakedFixture);

        const oldBaseStakedAmount =
          await meldStakingStorage.getStakerBaseStakedAmount(delegatorTokenId);

        // Request a new node

        const nodeName = "node2";
        const nodeAmount = toMeldDecimals(500_000); // 500k
        const nodeTier = 0;
        const nodeFee = 30_00n; // 30%
        const nodeMetadata = "";

        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator2,
          nodeName,
          nodeFee,
          nodeAmount,
          nodeTier,
          nodeMetadata
        );

        const nodeId2 = await meldStakingOperator.hashNodeId(nodeName);

        // Approve node
        await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId2);

        const delegatorEndLockEpoch = await calculateEndLockEpoch(
          meldStakingStorage,
          delegatorTokenId
        );

        const oldNodeBaseStakedAmount =
          await meldStakingStorage.getNodeBaseStakedAmount(nodeId);

        const oldGlobalBaseStakedAmount =
          await meldStakingStorage.getTotalBaseStakedAmount();

        // Advance to 5 epochs before the end of the lock period
        await time.increaseTo(
          await meldStakingStorage.getEpochStart(delegatorEndLockEpoch - 5n)
        );

        // Operator leaves node
        const operatorTokenId = await meldStakingStorage.getNodeOperator(
          nodeId
        );

        await meldStakingOperator.connect(operator).leaveNode(operatorTokenId);

        const globalBaseStakedAmountAfterNodeLeft =
          await meldStakingStorage.getTotalBaseStakedAmount();

        expect(globalBaseStakedAmountAfterNodeLeft).to.equal(
          oldGlobalBaseStakedAmount - oldNodeBaseStakedAmount
        );

        // Advance to 5 epochs after the end of the lock period
        await time.increaseTo(
          await meldStakingStorage.getEpochStart(delegatorEndLockEpoch + 5n)
        );

        // Set rewards for all epochs until current

        const rewardAmount = toMeldDecimals(2_000_000);

        const startRewardsEpoch = 2;
        const currentEpoch = await meldStakingStorage.getCurrentEpoch();

        await transferAndApproveTokens(
          meldToken,
          deployer,
          rewardsSetter,
          await meldStakingNFT.getAddress(),
          rewardAmount * (1n + currentEpoch - BigInt(startRewardsEpoch))
        );

        for (let epoch = startRewardsEpoch; epoch < currentEpoch; epoch++) {
          await meldStakingConfig
            .connect(rewardsSetter)
            .setRewards(rewardAmount, epoch);
        }

        // Change delegation to node2
        const tx = await meldStakingDelegator
          .connect(delegator)
          .changeDelegation(delegatorTokenId, nodeId2);

        await expect(tx)
          .to.emit(meldStakingDelegator, "DelegatorNodeChanged")
          .withArgs(delegatorTokenId, nodeId, nodeId2);

        await expect(tx)
          .to.emit(meldStakingDelegator, "StakerUpgradedToLiquid")
          .withArgs(delegatorTokenId, delegatorEndLockEpoch);

        const newBaseStakedAmount =
          await meldStakingStorage.getStakerBaseStakedAmount(delegatorTokenId);

        expect(newBaseStakedAmount).to.equal(oldBaseStakedAmount);

        const weightedAmount = newBaseStakedAmount; // Should be liquid now

        const delegationFeeAmount = await calculateDelegationFeeAmount(
          meldStakingStorage,
          nodeId2,
          newBaseStakedAmount
        );

        const expectedLastStakedAmount = weightedAmount - delegationFeeAmount;

        expect(
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            delegatorTokenId,
            currentEpoch
          )
        ).to.equal(expectedLastStakedAmount);
        expect(
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            delegatorTokenId,
            currentEpoch
          )
        ).to.equal(0);

        const globalBaseStakedAmountAfterChangedDelegation =
          await meldStakingStorage.getTotalBaseStakedAmount();

        expect(globalBaseStakedAmountAfterChangedDelegation).to.equal(
          globalBaseStakedAmountAfterNodeLeft + newBaseStakedAmount
        );

        // Advance 5 epochs more
        await time.increaseTo(
          await meldStakingStorage.getEpochStart(currentEpoch + 5n)
        );

        // Set rewards for all epochs until current
        const newCurrentEpoch = await meldStakingStorage.getCurrentEpoch();

        const lastEpochRewardsUpdated =
          await meldStakingStorage.getLastEpochRewardsUpdated();

        await transferAndApproveTokens(
          meldToken,
          deployer,
          rewardsSetter,
          await meldStakingNFT.getAddress(),
          rewardAmount * (1n + newCurrentEpoch - lastEpochRewardsUpdated)
        );

        for (
          let epoch = lastEpochRewardsUpdated + 1n;
          epoch < newCurrentEpoch;
          epoch++
        ) {
          await meldStakingConfig
            .connect(rewardsSetter)
            .setRewards(rewardAmount, epoch);
        }

        // Update staker previous epochs
        await meldStakingCommon.updateStakerPreviousEpochs(delegatorTokenId);

        // Check rewards
        const expectedRewards = await calculateRewards(
          meldStakingStorage,
          delegatorTokenId,
          0n,
          newCurrentEpoch
        );

        // Update unclaimed rewards
        await meldStakingCommon.updateUnclaimedRewards(delegatorTokenId);

        const unclaimedRewards =
          await meldStakingStorage.getStakerUnclaimedRewards(delegatorTokenId);

        expect(unclaimedRewards).to.equal(expectedRewards);

        expect(
          await meldStakingStorage.getStakerLastStakedAmountPerEpoch(
            delegatorTokenId,
            newCurrentEpoch
          )
        ).to.equal(expectedLastStakedAmount);
        expect(
          await meldStakingStorage.getStakerMinStakedAmountPerEpoch(
            delegatorTokenId,
            newCurrentEpoch
          )
        ).to.equal(expectedLastStakedAmount);
      });
    }); // End of changeDelegation Happy Flow test cases
    context("Error test cases", function () {
      it("Should revert if trying to delegate to a node with whitelist enabled", async function () {
        const {
          deployer,
          delegator,
          operator,
          meldStakingDelegator,
          meldStakingOperator,
          meldStakingConfig,
          meldStakingNFT,
          meldToken,
          liquidStakingTierId,
          nodeId,
        } = await loadFixture(nodeStakedFixture);

        // STEP 1 - Stake to Node 1
        const delegatorBaseStakeAmount = toMeldDecimals(100);

        await transferAndApproveTokens(
          meldToken,
          deployer,
          delegator,
          await meldStakingNFT.getAddress(),
          delegatorBaseStakeAmount
        );

        await meldStakingDelegator
          .connect(delegator)
          .stake(delegatorBaseStakeAmount, nodeId, liquidStakingTierId);
        const nftId = await meldStakingNFT.getTotalMintedNfts();

        // STEP 2 - Setup node 2, and lock it

        // Params for the node request
        const node2Name = "test2Node";
        const delegatorFee = 10_00; // 10%
        const operatorBaseStakeAmount = toMeldDecimals(100_000);
        const metadata = "";

        // operator approves the NFT staking contract to be able to deposit the stake and requests node
        await requestNode(
          meldToken,
          meldStakingOperator,
          meldStakingNFT,
          deployer,
          operator,
          node2Name,
          delegatorFee,
          operatorBaseStakeAmount,
          liquidStakingTierId,
          metadata
        );

        const node2Id = await meldStakingOperator.hashNodeId(node2Name);
        await meldStakingConfig.connect(deployer).approveNodeRequest(node2Id);

        // Lock node to whitelist only
        await meldStakingConfig
          .connect(deployer)
          .toggleDelegatorWhitelist(node2Id, true);

        // STEP 3 - TRY TO DELEGATE TO LOCKED NODE 2
        await expect(
          meldStakingDelegator
            .connect(delegator)
            .changeDelegation(nftId, node2Id)
        ).to.be.revertedWith(Errors.INVALID_WHITELIST_PERMISSIONS);
      });
    });
  });
}); // End of MeldStakingDelegator
