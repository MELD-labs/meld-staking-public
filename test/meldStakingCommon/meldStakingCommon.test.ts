import { ethers } from "hardhat";
import { ZeroAddress } from "ethers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import {
  StakingData,
  deployContracts,
  deployAndConfigContracts,
  toMeldDecimals,
  transferAndApproveTokens,
  getStakingData,
  requestNode,
} from "../utils/utils";
import {
  calculateExpectedStakingDataAfterNewStake,
  calculateEndLockTimestamp,
  calculateEndLockEpoch,
  calculateWeightedAmount,
} from "../utils/calculations";
import { Errors } from "../utils/errors";

describe("MeldStakingCommon - General", function () {
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

    // Add staking tier two. Requires 100,000 MELD for 20 epochs and gets 175% weight. tierTwoId is 2
    minStakingAmount = toMeldDecimals(50_000);
    stakingLength = 20; // 10 epochs
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

  async function deployAndConfigContractsWithImpersonationFixture() {
    const [
      deployer,
      rando,
      trustedForwarderSetter,
      rewardsSetter,
      slashReceiver,
      trustedForwarder,
      delegator,
      operator,
      meldStakingImpersonator,
    ] = await ethers.getSigners();

    const initTimestamp = (await time.latest()) + 1000;
    const epochSize = 5 * 24 * 60 * 60; // 5 days

    const contracts = await deployAndConfigContracts(
      deployer.address,
      initTimestamp,
      epochSize,
      slashReceiver.address,
      {
        // impersonationAddresses
        operator: meldStakingImpersonator.address,
        delegator: meldStakingImpersonator.address,
      }
    );

    // Grant TRUSTED_FORWARDER_SETTER_ROLE to trustedForwarderSetter
    await contracts.meldStakingCommon.grantRole(
      await contracts.meldStakingCommon.TRUSTED_FORWARDER_SETTER_ROLE(),
      trustedForwarderSetter.address
    );

    return {
      deployer,
      rando,
      trustedForwarderSetter,
      rewardsSetter,
      trustedForwarder,
      delegator,
      operator,
      meldStakingImpersonator,
      initTimestamp,
      epochSize,
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

    // Operator approves the NFT staking contract to be able to deposit the stake and requests node
    await requestNode(
      meldToken,
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

    // Operator 2 approves the NFT staking contract to be able to deposit the stake and request node
    await requestNode(
      meldToken,
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

  async function setUpReadyToMintFixture() {
    const {
      deployer,
      rando,
      trustedForwarderSetter,
      trustedForwarder,
      delegator,
      meldStakingImpersonator,
      ...contracts
    } = await deployAndConfigContractsWithImpersonationFixture();

    // Make sure delegator has some MELD and approves meldStakingNFT to spend the MELD
    const depositAmount = toMeldDecimals(100);
    const meldStakingNFTAddress = await contracts.meldStakingNFT.getAddress();
    await transferAndApproveTokens(
      contracts.meldToken,
      deployer,
      delegator,
      meldStakingNFTAddress,
      depositAmount * 2n
    );

    return {
      deployer,
      rando,
      trustedForwarderSetter,
      trustedForwarder,
      delegator,
      meldStakingImpersonator,
      depositAmount,
      ...contracts,
    };
  }

  async function setUpTokenMinted() {
    // Call the setUpReadyToMintFixture
    const {
      deployer,
      rando,
      trustedForwarderSetter,
      trustedForwarder,
      delegator,
      meldStakingImpersonator,
      depositAmount,
      ...contracts
    } = await setUpReadyToMintFixture();

    // Call the mint function as the impersonator of the Meld staking contracts to mint an NFT
    await contracts.meldStakingCommon
      .connect(meldStakingImpersonator)
      .mintStakingNFT(delegator.address, depositAmount);

    const tokenId = await contracts.meldStakingNFT.getTotalMintedNfts();

    return {
      deployer,
      rando,
      trustedForwarderSetter,
      trustedForwarder,
      delegator,
      meldStakingImpersonator,
      tokenId,
      depositAmount,
      ...contracts,
    };
  }

  async function setUpDepositFixture() {
    // Call the deployAndConfigContractsFixture
    const {
      deployer,
      rando,
      trustedForwarderSetter,
      rewardsSetter,
      trustedForwarder,
      delegator,
      meldStakingImpersonator,
      ...contracts
    } = await deployAndConfigContractsWithImpersonationFixture();

    // Make sure rewardsSetter has some MELD and approves meldStakingNFT to spend the MELD
    const meldStakingNFTAddress = await contracts.meldStakingNFT.getAddress();
    const depositAmount = toMeldDecimals(100_000);
    await transferAndApproveTokens(
      contracts.meldToken,
      deployer,
      rewardsSetter,
      meldStakingNFTAddress,
      depositAmount
    );

    return {
      deployer,
      rando,
      trustedForwarderSetter,
      rewardsSetter,
      trustedForwarder,
      delegator,
      meldStakingImpersonator,
      depositAmount,
      ...contracts,
    };
  }

  context("Admin", function () {
    it("Should have granted the DEFAULT_ADMIN_ROLE to the deployer", async function () {
      const { deployer, meldStakingCommon } = await loadFixture(
        onlyDeployFixture
      );
      expect(
        await meldStakingCommon.hasRole(
          await meldStakingCommon.DEFAULT_ADMIN_ROLE(),
          deployer.address
        )
      ).to.be.true;
    });
    it("Should not have granted the DEFAULT_ADMIN_ROLE to any other address", async function () {
      const { rando, meldStakingCommon } = await loadFixture(onlyDeployFixture);
      expect(
        await meldStakingCommon.hasRole(
          await meldStakingCommon.DEFAULT_ADMIN_ROLE(),
          rando.address
        )
      ).to.be.false;
    });
  });

  context("TrustedForwarderSetter", function () {
    it("Should not have granted the TRUSTED_FORWARDER_SETTER_ROLE to the trustedForwarderSetter", async function () {
      const { trustedForwarderSetter, meldStakingCommon } = await loadFixture(
        onlyDeployFixture
      );
      expect(
        await meldStakingCommon.hasRole(
          await meldStakingCommon.TRUSTED_FORWARDER_SETTER_ROLE(),
          trustedForwarderSetter.address
        )
      ).to.be.false;
    });
    it("Should have granted the TRUSTED_FORWARDER_SETTER_ROLE to the trustedForwarderSetter", async function () {
      const { trustedForwarderSetter, meldStakingCommon } = await loadFixture(
        deployAndConfigContractsFixture
      );
      expect(
        await meldStakingCommon.hasRole(
          await meldStakingCommon.TRUSTED_FORWARDER_SETTER_ROLE(),
          trustedForwarderSetter.address
        )
      ).to.be.true;
    });
    it("Should not have granted the TRUSTED_FORWARDER_SETTER_ROLE to any other address", async function () {
      const { rando, meldStakingCommon } = await loadFixture(
        deployAndConfigContractsFixture
      );
      expect(
        await meldStakingCommon.hasRole(
          await meldStakingCommon.TRUSTED_FORWARDER_SETTER_ROLE(),
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
        await meldStakingAddressProvider.initialize(
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

        await expect(meldStakingCommon.initialize(meldStakingAddressProvider))
          .to.emit(meldStakingCommon, "Initialized")
          .withArgs(deployer.address, meldStakingAddressProviderAddress);
      });
    }); // End of Initialize Happy Flow test cases

    context("Error test cases", function () {
      it("Should revert if MeldStakingAddressProvider is zero address", async function () {
        const { meldStakingCommon } = await loadFixture(onlyDeployFixture);

        await expect(
          meldStakingCommon.initialize(ZeroAddress)
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);
      });
      it("Should revert if called by a non-admin", async function () {
        const { rando, meldStakingCommon, meldStakingAddressProvider } =
          await loadFixture(onlyDeployFixture);

        const meldStakingAddressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingCommon.DEFAULT_ADMIN_ROLE()}`;

        await expect(
          meldStakingCommon
            .connect(rando)
            .initialize(meldStakingAddressProviderAddress)
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert if initialized twice", async function () {
        const { meldStakingCommon, meldStakingAddressProvider } =
          await loadFixture(deployAndConfigContractsFixture); // this fixture initializes all contracts

        const meldStakingAddressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        await expect(
          meldStakingCommon.initialize(meldStakingAddressProviderAddress)
        ).to.be.revertedWith(Errors.ALREADY_INITIALIZED);
      });

      it("Reverts if address provider returns zero address for an address being initialized", async function () {
        const { meldStakingCommon, meldStakingAddressProvider } =
          await loadFixture(onlyDeployFixture);

        const meldStakingAddressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        await expect(
          meldStakingCommon.initialize(meldStakingAddressProviderAddress)
        ).to.be.revertedWith(Errors.ADDRESS_PROVIDER_NOT_INITIALIZED);
      });
    }); // End of Initialize Error test cases
  }); // End of Initialize

  context("Setters", function () {
    context("setTrustedForwarder", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct event", async function () {
          const {
            meldStakingCommon,
            trustedForwarderSetter,
            trustedForwarder,
            rando,
          } = await loadFixture(deployAndConfigContractsFixture);

          await expect(
            meldStakingCommon
              .connect(trustedForwarderSetter)
              .setTrustedForwarder(trustedForwarder.address)
          )
            .to.emit(meldStakingCommon, "TrustedForwarderChanged")
            .withArgs(
              trustedForwarderSetter.address,
              ZeroAddress,
              trustedForwarder.address
            );

          await expect(
            meldStakingCommon
              .connect(trustedForwarderSetter)
              .setTrustedForwarder(rando.address)
          )
            .to.emit(meldStakingCommon, "TrustedForwarderChanged")
            .withArgs(
              trustedForwarderSetter.address,
              trustedForwarder.address,
              rando.address
            );
        });

        it("Should update state correctly", async function () {
          const {
            meldStakingCommon,
            trustedForwarderSetter,
            trustedForwarder,
          } = await loadFixture(deployAndConfigContractsFixture);

          await meldStakingCommon
            .connect(trustedForwarderSetter)
            .setTrustedForwarder(trustedForwarder.address);

          expect(await meldStakingCommon.getTrustedForwarder()).to.equal(
            trustedForwarder.address
          );
          expect(
            await meldStakingCommon.isTrustedForwarder(trustedForwarder.address)
          ).to.be.true;
        });
      }); // End of Setters Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if called by a non-TrustedForwarderSetter", async function () {
          const { rando, meldStakingCommon, trustedForwarder } =
            await loadFixture(deployAndConfigContractsFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingCommon.TRUSTED_FORWARDER_SETTER_ROLE()}`;
          await expect(
            meldStakingCommon
              .connect(rando)
              .setTrustedForwarder(trustedForwarder.address)
          ).to.be.revertedWith(expectedException);
        });
      }); // End of setTrustedForwarder Error test cases
    }); // End of setTrustedForwarder
  }); // End of Setters

  context("Meld Staking Contract Functions", function () {
    context("mintStakingNFT", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct events", async function () {
          const {
            delegator,
            meldStakingImpersonator,
            meldStakingCommon,
            meldStakingNFT,
            depositAmount,
          } = await loadFixture(setUpReadyToMintFixture);

          const mintTx = await meldStakingCommon
            .connect(meldStakingImpersonator)
            .mintStakingNFT(delegator.address, depositAmount);

          // Check for event.
          await expect(mintTx)
            .to.emit(meldStakingNFT, "MeldDeposited")
            .withArgs(delegator.address, depositAmount);

          await expect(mintTx)
            .to.emit(meldStakingNFT, "Transfer")
            .withArgs(ZeroAddress, delegator.address, 1);
        });

        it("Should update state correctly", async function () {
          const {
            delegator,
            meldStakingImpersonator,
            meldStakingCommon,
            meldStakingNFT,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpReadyToMintFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .mintStakingNFT(delegator.address, depositAmount);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount
          );
          expect(await meldStakingNFT.totalSupply()).to.equal(1);
          expect(await meldStakingNFT.balanceOf(delegator.address)).to.equal(1);
          expect(
            await meldStakingNFT.tokenOfOwnerByIndex(delegator.address, 0)
          ).to.equal(1);
          expect(await meldStakingCommon.ownerOfStakingNFT(1)).to.equal(
            delegator.address
          );
          expect(await meldStakingNFT.tokenByIndex(0)).to.equal(1);
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(1);
          expect(await meldStakingNFT.exists(1)).to.be.true;

          const allTokensByOwner = await meldStakingNFT.getAllTokensByOwner(
            delegator.address
          );

          expect(allTokensByOwner).to.eql([1n]);
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            depositAmount
          );
        });

        it("Should update state correctly after multiple mints", async function () {
          const {
            deployer,
            meldStakingImpersonator,
            meldStakingCommon,
            meldStakingNFT,
            meldToken,
          } = await loadFixture(
            deployAndConfigContractsWithImpersonationFixture
          );

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const ethAmount: bigint = ethers.parseEther("2");
          const depositAmount: bigint = toMeldDecimals(100);

          // Generate multiple stakers with the Hardhat Ethers provider and Mint an NFT for each delegator
          const stakers = [];
          for (let i = 0; i < 5; i++) {
            const provider = ethers.provider;
            const delegator = ethers.Wallet.createRandom().connect(provider);

            // Send ETH to the delegator's address for gas
            await deployer.sendTransaction({
              to: delegator.address,
              value: ethAmount,
            });

            // Make sure delegator has some MELD and approves meldStakingNFT to spend the MELD
            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            await transferAndApproveTokens(
              meldToken,
              deployer,
              delegator,
              meldStakingNFTAddress,
              depositAmount
            );

            stakers.push(delegator);

            // Call the mint function as the meldStakingCommon account
            await meldStakingCommon
              .connect(meldStakingImpersonator)
              .mintStakingNFT(delegator.address, depositAmount);

            // Do some state checks
            expect(await meldStakingNFT.balanceOf(delegator.address)).to.equal(
              1
            );
            expect(
              await meldStakingNFT.tokenOfOwnerByIndex(delegator.address, 0)
            ).to.equal(i + 1);
            expect(await meldStakingCommon.ownerOfStakingNFT(i + 1)).to.equal(
              delegator.address
            );
            expect(await meldStakingNFT.tokenByIndex(i)).to.equal(i + 1);
            expect(await meldStakingNFT.exists(i + 1)).to.be.true;

            const allTokensByOwner = await meldStakingNFT.getAllTokensByOwner(
              delegator.address
            );

            expect(allTokensByOwner).to.eql([BigInt(i) + 1n]);
          }

          // Cummulative state checks
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount * BigInt(stakers.length)
          );
          expect(await meldStakingNFT.totalSupply()).to.equal(
            BigInt(stakers.length)
          );
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(
            BigInt(stakers.length)
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            depositAmount * BigInt(stakers.length)
          );
        });

        it("Should update state correctly when same delegator mints multiple NFTs", async function () {
          const {
            delegator,
            meldStakingImpersonator,
            meldStakingCommon,
            meldStakingNFT,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpReadyToMintFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .mintStakingNFT(delegator.address, depositAmount);
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .mintStakingNFT(delegator.address, depositAmount);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount * 2n
          );
          expect(await meldStakingNFT.totalSupply()).to.equal(2n);
          expect(await meldStakingNFT.balanceOf(delegator.address)).to.equal(2);
          expect(
            await meldStakingNFT.tokenOfOwnerByIndex(delegator.address, 0)
          ).to.equal(1);
          expect(
            await meldStakingNFT.tokenOfOwnerByIndex(delegator.address, 1)
          ).to.equal(2);
          expect(await meldStakingCommon.ownerOfStakingNFT(1)).to.equal(
            delegator.address
          );
          expect(await meldStakingCommon.ownerOfStakingNFT(2)).to.equal(
            delegator.address
          );
          expect(await meldStakingNFT.tokenByIndex(0)).to.equal(1);
          expect(await meldStakingNFT.tokenByIndex(1)).to.equal(2);
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(2n);
          expect(await meldStakingNFT.exists(1)).to.be.true;
          expect(await meldStakingNFT.exists(2)).to.be.true;

          const allTokensByOwner = await meldStakingNFT.getAllTokensByOwner(
            delegator.address
          );

          expect(allTokensByOwner).to.eql([1n, 2n]);
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            depositAmount * 2n
          );
        });
      }); // End of mint Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if not called by the MeldStakingDelegator, MeldStakingOperator, or MeldStakingConfig contracts", async function () {
          const { rando, delegator, meldStakingCommon, depositAmount } =
            await loadFixture(setUpReadyToMintFixture);

          await expect(
            meldStakingCommon
              .connect(rando)
              .mintStakingNFT(delegator.address, depositAmount)
          ).to.be.revertedWith(Errors.CALLER_NOT_STAKING_OR_CONFIG);
        });

        it("Should revert if from address is the zero address", async function () {
          const { meldStakingImpersonator, meldStakingCommon, depositAmount } =
            await loadFixture(setUpReadyToMintFixture);

          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .mintStakingNFT(ZeroAddress, depositAmount)
          ).to.be.revertedWith(Errors.INVALID_ADDRESS);
        });

        it("Should revert if amount is zero", async function () {
          const { delegator, meldStakingImpersonator, meldStakingCommon } =
            await loadFixture(setUpReadyToMintFixture);

          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .mintStakingNFT(delegator.address, 0)
          ).to.be.revertedWith(Errors.DEPOSIT_INVALID_AMOUNT);
        });

        it("Should revert if the delegator does not have enough Meld tokens to deposit the specified amount", async function () {
          const {
            deployer,
            delegator,
            meldStakingImpersonator,
            meldStakingCommon,
            meldStakingNFT,
            meldToken,
          } = await loadFixture(
            deployAndConfigContractsWithImpersonationFixture
          );

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const depositAmount = toMeldDecimals(100);

          // Make sure delegator has some MELD, but not enough
          await meldToken
            .connect(deployer)
            .transfer(delegator.address, depositAmount / 2n);

          // delegator approves meldStakingNFT to spend the MELD -- the correct amount
          await meldToken
            .connect(delegator)
            .approve(meldStakingNFTAddress, depositAmount);

          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .mintStakingNFT(delegator.address, depositAmount)
          ).to.be.revertedWith(Errors.DEPOSIT_INVALID_AMOUNT);
        });

        it("Should revert if allowance is too low to deposit the specified amount of Meld tokens", async function () {
          const {
            deployer,
            delegator,
            meldStakingImpersonator,
            meldStakingCommon,
            meldToken,
          } = await loadFixture(
            deployAndConfigContractsWithImpersonationFixture
          );
          const depositAmount = toMeldDecimals(100);

          // Make sure delegator has some MELD
          await meldToken
            .connect(deployer)
            .transfer(delegator.address, depositAmount);

          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .mintStakingNFT(delegator.address, depositAmount)
          ).to.be.revertedWith(Errors.INSUFFICIENT_ALLOWANCE);
        });
      }); // End of mint Error test cases
    }); // End of mint

    context("redeemStakingNFT", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct events", async function () {
          const {
            delegator,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            tokenId,
          } = await loadFixture(setUpTokenMinted);

          const redeemTx = await meldStakingCommon
            .connect(meldStakingImpersonator)
            .redeemStakingNFT(tokenId);

          //Check for Redeemed and Transfer events
          await expect(redeemTx)
            .to.emit(meldStakingNFT, "Redeemed")
            .withArgs(delegator.address, tokenId);

          await expect(redeemTx)
            .to.emit(meldStakingNFT, "Transfer")
            .withArgs(delegator.address, ZeroAddress, tokenId);
        });

        it("Should update state correctly", async function () {
          const {
            delegator,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            tokenId,
          } = await loadFixture(setUpTokenMinted);

          let expectedException;

          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .redeemStakingNFT(tokenId);

          // Check state
          expect(await meldStakingNFT.redeemedNfts()).to.equal(1);
          expect(await meldStakingNFT.totalSupply()).to.equal(0);
          expect(await meldStakingNFT.balanceOf(delegator.address)).to.equal(0);
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(1);
          expect(await meldStakingNFT.exists(tokenId)).to.be.false;

          const allTokensByOwner = await meldStakingNFT.getAllTokensByOwner(
            delegator.address
          );
          expect(allTokensByOwner).to.eql([]);

          expectedException = `ERC721: invalid token ID`;
          await expect(
            meldStakingCommon.ownerOfStakingNFT(tokenId)
          ).to.be.revertedWith(expectedException);

          expectedException = `ERC721Enumerable: global index out of bounds`;
          await expect(meldStakingNFT.tokenByIndex(0)).to.be.revertedWith(
            expectedException
          );

          expectedException = `ERC721Enumerable: owner index out of bounds`;
          await expect(
            meldStakingNFT.tokenOfOwnerByIndex(delegator.address, 0)
          ).to.be.revertedWith(expectedException);
        });

        it("Should update state correctly when same delegator has multiple NFTs and redeems 1", async function () {
          const {
            delegator,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            tokenId,
          } = await loadFixture(setUpTokenMinted);

          let expectedException;
          const depositAmount = toMeldDecimals(100);

          // Call the mint function as impersonator of a Meld staking contract
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .mintStakingNFT(delegator.address, depositAmount);

          // Redeem an NFT
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .redeemStakingNFT(tokenId);

          // Check state
          expect(await meldStakingNFT.redeemedNfts()).to.equal(1);
          expect(await meldStakingNFT.totalSupply()).to.equal(1);
          expect(await meldStakingNFT.balanceOf(delegator.address)).to.equal(1);
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(2);
          expect(await meldStakingNFT.exists(tokenId)).to.be.false;
          expect(await meldStakingNFT.exists(tokenId + 1n)).to.be.true;

          const allTokensByOwner = await meldStakingNFT.getAllTokensByOwner(
            delegator.address
          );
          expect(allTokensByOwner.length).to.equal(1);

          expectedException = `ERC721: invalid token ID`;
          await expect(
            meldStakingCommon.ownerOfStakingNFT(tokenId)
          ).to.be.revertedWith(expectedException);
          expect(
            await meldStakingCommon.ownerOfStakingNFT(tokenId + 1n)
          ).to.equal(delegator.address);

          expectedException = `ERC721Enumerable: global index out of bounds`;
          await expect(meldStakingNFT.tokenByIndex(1)).to.be.revertedWith(
            expectedException
          ); //due to swap and pop
          expect(await meldStakingNFT.tokenByIndex(0)).to.equal(tokenId + 1n); //due to swap and pop

          expectedException = `ERC721Enumerable: owner index out of bounds`;
          await expect(
            meldStakingNFT.tokenOfOwnerByIndex(delegator.address, 1)
          ).to.be.revertedWith(expectedException); //due to swap and pop
          expect(
            await meldStakingNFT.tokenOfOwnerByIndex(delegator.address, 0)
          ).to.equal(tokenId + 1n); //due to swap and pop
        });
      }); // End of redeem Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if not called MeldStakingDelegator, MeldStakingOperator, or MeldStakingConfig", async function () {
          const { rando, meldStakingCommon, tokenId } = await loadFixture(
            setUpTokenMinted
          );

          await expect(
            meldStakingCommon.connect(rando).redeemStakingNFT(tokenId)
          ).to.be.revertedWith(Errors.CALLER_NOT_STAKING_OR_CONFIG);
        });
      }); // End of redeem Error test cases
    }); // End of redeem

    context("depositMeld", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct events", async function () {
          const {
            rewardsSetter,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpDepositFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          // The "from" address will be the address with the REWARDS_SETTER_ROLE
          const depositMeldTx = await meldStakingCommon
            .connect(meldStakingImpersonator)
            .depositMeld(rewardsSetter.address, depositAmount);

          // Check for event.
          await expect(depositMeldTx)
            .to.emit(meldStakingNFT, "MeldDeposited")
            .withArgs(rewardsSetter.address, depositAmount);

          await expect(depositMeldTx)
            .to.emit(meldToken, "Transfer")
            .withArgs(
              rewardsSetter.address,
              meldStakingNFTAddress,
              depositAmount
            );
        });

        it("Should update state correctly", async function () {
          const {
            rewardsSetter,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpDepositFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .depositMeld(rewardsSetter.address, depositAmount);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount
          );

          expect(await meldToken.balanceOf(rewardsSetter.address)).to.equal(0);
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            depositAmount
          );
        });

        it("Should update state correctly after multiple deposits", async function () {
          const {
            rewardsSetter,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            meldToken,
            depositAmount: initialAmount,
          } = await loadFixture(setUpDepositFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const depositAmount1: bigint = initialAmount / 2n;
          const depositAmount2: bigint = initialAmount / 10n;

          // Deposit MELD twice
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .depositMeld(rewardsSetter.address, depositAmount1);
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .depositMeld(rewardsSetter.address, depositAmount2);

          const expectedDepositorBalance =
            initialAmount - depositAmount1 - depositAmount2;
          const expectedNFTContractBalance = depositAmount1 + depositAmount2;

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            expectedNFTContractBalance
          );

          expect(await meldToken.balanceOf(rewardsSetter.address)).to.equal(
            expectedDepositorBalance
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            expectedNFTContractBalance
          );
        });
      }); // End of depositMeld Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if not called MeldStakingDelegator, MeldStakingOperator, or MeldStakingConfig", async function () {
          const { rando, meldStakingCommon, depositAmount } = await loadFixture(
            setUpDepositFixture
          );

          await expect(
            meldStakingCommon
              .connect(rando)
              .depositMeld(rando.address, depositAmount)
          ).to.be.revertedWith(Errors.CALLER_NOT_STAKING_OR_CONFIG);
        });

        it("Should revert if the amount to deposit is zero", async function () {
          const { rewardsSetter, meldStakingCommon, meldStakingImpersonator } =
            await loadFixture(setUpDepositFixture);

          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .depositMeld(rewardsSetter.address, 0)
          ).to.be.revertedWith(Errors.DEPOSIT_INVALID_AMOUNT);
        });

        it("Should revert if the rewards setter does not have enough Meld tokens to deposit the specified amount", async function () {
          const {
            deployer,
            rewardsSetter,
            meldStakingImpersonator,
            meldStakingCommon,
            meldStakingNFT,
            meldToken,
          } = await loadFixture(
            deployAndConfigContractsWithImpersonationFixture
          );

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const depositAmount = toMeldDecimals(100);

          // Make sure delegator has some MELD, but not enough
          await meldToken
            .connect(deployer)
            .transfer(rewardsSetter.address, depositAmount / 2n);

          // rewardsSetter approves meldStakingNFT to spend the MELD -- the correct amount
          await meldToken
            .connect(rewardsSetter)
            .approve(meldStakingNFTAddress, toMeldDecimals(100));

          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .depositMeld(rewardsSetter.address, depositAmount)
          ).to.be.revertedWith(Errors.DEPOSIT_INVALID_AMOUNT);
        });

        it("Should revert if allowance is too low to deposit the specified amount of Meld tokens", async function () {
          const {
            deployer,
            rewardsSetter,
            meldStakingImpersonator,
            meldStakingCommon,
            meldToken,
          } = await loadFixture(
            deployAndConfigContractsWithImpersonationFixture
          );
          const depositAmount = toMeldDecimals(100);

          // Make sure rewardsSetter has some MELD
          await meldToken
            .connect(deployer)
            .transfer(rewardsSetter.address, depositAmount);

          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .depositMeld(rewardsSetter.address, depositAmount)
          ).to.be.revertedWith(Errors.INSUFFICIENT_ALLOWANCE);
        });
      }); // End of depositMeld Error test cases
    }); // End of depositMeld

    context("withdrawMeld", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct events", async function () {
          const {
            delegator,
            meldToken,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          const withdrawMeldTx = await meldStakingCommon
            .connect(meldStakingImpersonator)
            .withdrawMeld(delegator.address, depositAmount);

          //Check for MeldWithdrawn and Transfer events
          await expect(withdrawMeldTx)
            .to.emit(meldStakingNFT, "MeldWithdrawn")
            .withArgs(delegator.address, depositAmount);

          await expect(withdrawMeldTx)
            .to.emit(meldToken, "Transfer")
            .withArgs(meldStakingNFTAddress, delegator.address, depositAmount);
        });

        it("Should update state correctly for delegator that withdraws whole amount", async function () {
          const {
            delegator,
            meldToken,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const stakerBalanceBefore = await meldToken.balanceOf(
            delegator.address
          );

          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .withdrawMeld(delegator.address, depositAmount);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(0n);
          expect(await meldToken.balanceOf(delegator.address)).to.equal(
            stakerBalanceBefore + depositAmount
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(0n);
        });

        it("Should update state correctly for rewards setter that withdraws whole amount", async function () {
          const {
            rewardsSetter,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpDepositFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          // Rewards setter deposits MELD
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .depositMeld(rewardsSetter.address, depositAmount);

          const rewardsSetterBalanceBefore = await meldToken.balanceOf(
            rewardsSetter.address
          );

          // Rewards setter withdraws MELD
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .withdrawMeld(rewardsSetter.address, depositAmount);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(0n);
          expect(await meldToken.balanceOf(rewardsSetter.address)).to.equal(
            rewardsSetterBalanceBefore + depositAmount
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(0n);
        });

        it("Should update state correctly when delegator withdraws partial amount", async function () {
          const {
            delegator,
            meldToken,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const stakerBalanceBefore = await meldToken.balanceOf(
            delegator.address
          );

          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .withdrawMeld(delegator.address, depositAmount / 2n);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount / 2n
          );
          expect(await meldToken.balanceOf(delegator.address)).to.equal(
            stakerBalanceBefore + depositAmount / 2n
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            depositAmount / 2n
          );
        });

        it("Should update state correctly when rewards setter withdraws partial amount", async function () {
          const {
            rewardsSetter,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpDepositFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          // Rewards setter deposits MELD
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .depositMeld(rewardsSetter.address, depositAmount);

          const rewardsSetterBalanceBefore = await meldToken.balanceOf(
            rewardsSetter.address
          );

          // Rewards setter withdraws MELD
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .withdrawMeld(rewardsSetter.address, depositAmount / 2n);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount / 2n
          );
          expect(await meldToken.balanceOf(rewardsSetter.address)).to.equal(
            rewardsSetterBalanceBefore + depositAmount / 2n
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            depositAmount / 2n
          );
        });

        it("Should update state correctly when multiple stakers deposit but only one withdraws", async function () {
          const {
            deployer,
            rando,
            meldToken,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);

          // Make sure rando has some MELD and has aprpoved the meldStakingNFT to spend it
          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const depositAmount2 = toMeldDecimals(200);

          await transferAndApproveTokens(
            meldToken,
            deployer,
            rando,
            meldStakingNFTAddress,
            depositAmount2
          );

          // Second depositor deposits MELD. delegator deposited in fixture.
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .depositMeld(rando.address, depositAmount2);

          const randoBalanceBefore = await meldToken.balanceOf(rando.address);
          const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
            meldStakingNFTAddress
          );

          // Rando withdraws MELD
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .withdrawMeld(rando.address, depositAmount2);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount
          ); // depositAmount is amount deposited by delegator in fixture
          expect(await meldToken.balanceOf(rando.address)).to.equal(
            randoBalanceBefore + depositAmount2
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            meldStakingNFTBalanceBefore - depositAmount2
          );
        });
      }); // End of withdrawMeld Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if not called by MeldStakingDelegator, MeldStakingOperator, or MeldStakingConfig", async function () {
          const { rando, meldStakingCommon, depositAmount } = await loadFixture(
            setUpTokenMinted
          );

          await expect(
            meldStakingCommon
              .connect(rando)
              .withdrawMeld(rando.address, depositAmount)
          ).to.be.revertedWith(Errors.CALLER_NOT_STAKING_OR_CONFIG);
        });

        it("Reverts if to address is the zero address", async function () {
          const { meldStakingCommon, meldStakingImpersonator, depositAmount } =
            await loadFixture(setUpTokenMinted);

          const expectedException = `ERC20: transfer to the zero address`;

          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .withdrawMeld(ZeroAddress, depositAmount)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if the amount to withdraw is zero", async function () {
          const { delegator, meldStakingCommon, meldStakingImpersonator } =
            await loadFixture(setUpTokenMinted);

          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .withdrawMeld(delegator.address, 0)
          ).to.be.revertedWith(Errors.WITHDRAW_INVALID_AMOUNT);
        });

        it("Should revert if amount exceeds total deposits by multiple depositors", async function () {
          const {
            deployer,
            rando,
            meldToken,
            meldStakingNFT,
            meldStakingCommon,
            meldStakingImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);

          // Make sure rando has some MELD and has aprpoved the meldStakingNFT to spend it
          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const depositAmount2 = toMeldDecimals(200);

          await transferAndApproveTokens(
            meldToken,
            deployer,
            rando,
            meldStakingNFTAddress,
            depositAmount2
          );

          // Second depositor deposits MELD. delegator deposited in fixture.
          await meldStakingCommon
            .connect(meldStakingImpersonator)
            .depositMeld(rando.address, depositAmount2);

          const additionalAmount = 1n;

          // Rando attempts to withdraw more than the total deposited by both depositors
          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .withdrawMeld(
                rando.address,
                depositAmount + depositAmount2 + additionalAmount
              )
          ).to.be.revertedWith(Errors.WITHDRAW_INVALID_AMOUNT);
        });

        it("Should revert if amount exceeds own deposited amount", async function () {
          //delegator tries to withdraw more than s/he deposited
          const {
            delegator,
            meldStakingCommon,
            meldStakingImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);
          // delegator deposited in fixture

          const additionalAmount = ethers.parseUnits("1", "wei");

          await expect(
            meldStakingCommon
              .connect(meldStakingImpersonator)
              .withdrawMeld(delegator.address, depositAmount + additionalAmount)
          ).to.be.revertedWith(Errors.WITHDRAW_INVALID_AMOUNT);
        });
      }); // End of withdrawMeld Error test cases
    }); // End of withdrawMeld

    context("newStake", function () {
      context("Happy Flow test cases", function () {
        context("Delegator", function () {
          // It's not possible to call meldStakingCommon.newStake() directly, even with impersonation. This is because MeldStakingDelegator.stake()
          // calls some functions before calling newStake() that would have to be recreated first. Those are also protected functions, which fail when calling with impersonation.
          // This is because the MeldStakingDelegator address can't be the real address and the impersonated address at the same time.
          it("Should NOT emit LockStakingRegistered event for liquid staking", async function () {
            const {
              deployer,
              delegator,
              meldStakingDelegator,
              meldStakingNFT,
              meldStakingCommon,
              meldToken,
              nodeId,
              liquidStakingTierId,
            } = await loadFixture(nodeStakedFixture);

            const delegatorBaseStakeAmount = toMeldDecimals(1000);

            // delegator approves the NFT staking contract to be able to deposit the stake
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
            ).to.not.emit(meldStakingCommon, "LockStakingRegistered");
          });

          it("Should emit LockStakingRegistered event for locked staking", async function () {
            const {
              deployer,
              delegator,
              meldStakingDelegator,
              meldStakingNFT,
              meldStakingCommon,
              meldToken,
              nodeId,
              tierOneId,
            } = await loadFixture(nodeStakedFixture);

            const delegatorBaseStakeAmount = toMeldDecimals(20_000);

            // delegator approves the NFT staking contract to be able to deposit the stake
            await transferAndApproveTokens(
              meldToken,
              deployer,
              delegator,
              await meldStakingNFT.getAddress(),
              delegatorBaseStakeAmount
            );

            const expectedNftId =
              (await meldStakingNFT.getTotalMintedNfts()) + 1n;

            const stakeTX = await meldStakingDelegator
              .connect(delegator)
              .stake(delegatorBaseStakeAmount, nodeId, tierOneId);

            const endLockEpoch = await meldStakingCommon.getEndLockEpoch(
              expectedNftId
            );

            await expect(stakeTX)
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

            // Get staking data before delegation so that expected values can be calculated. Pass 0 for delegatorTokenId because delegator hasn't staked yet
            const stakingDataBefore = await getStakingData(
              meldStakingStorage,
              currentEpoch,
              0n,
              operatorTokenId,
              nodeId,
              liquidStakingTierId
            );

            const delegatorBaseStakeAmount = toMeldDecimals(1000);

            // delegator approves the NFT staking contract to be able to deposit the stake
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

            const delegatorTokenId = await meldStakingNFT.getTotalMintedNfts();

            const expectedStakingDataAfter =
              await calculateExpectedStakingDataAfterNewStake(
                meldStakingStorage,
                stakingDataBefore,
                delegatorBaseStakeAmount,
                delegatorTokenId,
                nodeId,
                liquidStakingTierId,
                true // isDelegator
              );

            // Get the staking data after the stake
            const stakingDataAfter: StakingData = await getStakingData(
              meldStakingStorage,
              currentEpoch,
              delegatorTokenId,
              operatorTokenId,
              nodeId,
              liquidStakingTierId
            );
            expect(stakingDataAfter).to.deep.equal(expectedStakingDataAfter);
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

            // Get staking data before delegation so that expected values can be calculated. Pass 0 for delegatorTokenId because delegator hasn't staked yet
            const stakingDataBefore = await getStakingData(
              meldStakingStorage,
              currentEpoch,
              0n,
              operatorTokenId,
              nodeId,
              tierOneId
            );

            const delegatorBaseStakeAmount = toMeldDecimals(10_000);

            // delegator approves the NFT staking contract to be able to deposit the stake
            await transferAndApproveTokens(
              meldToken,
              deployer,
              delegator,
              await meldStakingNFT.getAddress(),
              delegatorBaseStakeAmount
            );

            await meldStakingDelegator
              .connect(delegator)
              .stake(delegatorBaseStakeAmount, nodeId, tierOneId);

            const delegatorTokenId = await meldStakingNFT.getTotalMintedNfts();

            const endLockEpoch = await meldStakingCommon.getEndLockEpoch(
              delegatorTokenId
            );

            const expectedStakingDataAfter =
              await calculateExpectedStakingDataAfterNewStake(
                meldStakingStorage,
                stakingDataBefore,
                delegatorBaseStakeAmount,
                delegatorTokenId,
                nodeId,
                tierOneId,
                true // isDelegator
              );

            // Get the staking data after the stake
            const stakingDataAfter: StakingData = await getStakingData(
              meldStakingStorage,
              currentEpoch,
              delegatorTokenId,
              operatorTokenId,
              nodeId,
              tierOneId,
              endLockEpoch
            );
            expect(stakingDataAfter).to.deep.equal(expectedStakingDataAfter);
          });
        }); // End of Delegator

        context("Operator", function () {
          it("Should NOT LockStakingRegistered event emit for liquid staking", async function () {
            const {
              deployer,
              operator,
              meldStakingOperator,
              meldStakingNFT,
              meldStakingCommon,
              meldStakingConfig,
              meldToken,
            } = await loadFixture(stakingStartedFixture);

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00; // 10%
            const amount = toMeldDecimals(250_000);
            const liquidStakingTierId = 0n;
            const metadata = "";

            // operator approves the NFT staking contract to be able to deposit the stake and requests a node
            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount,
              liquidStakingTierId,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            await expect(
              meldStakingConfig.connect(deployer).approveNodeRequest(nodeId)
            ).to.not.emit(meldStakingCommon, "LockStakingRegistered");
          });

          it("Should LockStakingRegistered event emit for locked staking", async function () {
            const {
              deployer,
              operator,
              meldStakingOperator,
              meldStakingNFT,
              meldStakingCommon,
              meldStakingConfig,
              meldToken,
              tierOneId,
            } = await loadFixture(stakingStartedFixture);

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00; // 10%
            const amount = toMeldDecimals(500_000);
            const metadata = "";

            // operator approves the NFT staking contract to be able to deposit the stake and requests a node
            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount,
              tierOneId,
              metadata
            );

            // Node id is the hash of the node name
            const nodeId = await meldStakingOperator.hashNodeId(nodeName);
            const expectedNftId = await meldStakingNFT.getTotalMintedNfts();

            const approveTX = await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);
            const endLockEpoch = await meldStakingCommon.getEndLockEpoch(
              expectedNftId
            );

            await expect(approveTX)
              .to.emit(meldStakingCommon, "LockStakingRegistered")
              .withArgs(expectedNftId, tierOneId, endLockEpoch);
          });

          it("Should update state correctly for liquid staking", async function () {
            const {
              deployer,
              operator,
              meldStakingOperator,
              meldStakingNFT,
              meldStakingConfig,
              meldStakingStorage,
              meldToken,
            } = await loadFixture(stakingStartedFixture);
            const currentEpoch = await meldStakingStorage.getCurrentEpoch();
            const liquidStakingTierId = 0n;

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00; // 10%
            const amount = toMeldDecimals(1_000_000);
            const metadata = "";

            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Get staking data before delegation so that expected values can be calculated. Pass 0 for operatorTokenId because operator hasn't staked yet
            const stakingDataBefore = await getStakingData(
              meldStakingStorage,
              currentEpoch,
              0n,
              0n,
              nodeId,
              liquidStakingTierId
            );

            // operator approves the NFT staking contract to be able to deposit the stake and requests node

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount,
              liquidStakingTierId,
              metadata
            );

            const operatorTokenId = await meldStakingNFT.getTotalMintedNfts();

            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            const expectedStakingDataAfter =
              await calculateExpectedStakingDataAfterNewStake(
                meldStakingStorage,
                stakingDataBefore,
                amount,
                operatorTokenId,
                nodeId,
                liquidStakingTierId,
                false // !isDelegator
              );

            // Get the staking data after the stake
            const stakingDataAfter: StakingData = await getStakingData(
              meldStakingStorage,
              currentEpoch,
              0n,
              operatorTokenId,
              nodeId,
              liquidStakingTierId
            );
            expect(stakingDataAfter).to.deep.equal(expectedStakingDataAfter);
          });

          it("Should update state correctly for locked staking", async function () {
            const {
              deployer,
              operator,
              meldStakingOperator,
              meldStakingNFT,
              meldStakingConfig,
              meldStakingStorage,
              meldStakingCommon,
              meldToken,
              tierOneId,
            } = await loadFixture(stakingStartedFixture);
            const currentEpoch = await meldStakingStorage.getCurrentEpoch();

            // Params for the node request
            const nodeName = "testNode";
            const delegatorFee = 10_00; // 10%
            const amount = toMeldDecimals(100_000);
            const metadata = "";

            const nodeId = await meldStakingOperator.hashNodeId(nodeName);

            // Get staking data before delegation so that expected values can be calculated. Pass 0 for operatorTokenId because operator hasn't staked yet
            const stakingDataBefore = await getStakingData(
              meldStakingStorage,
              currentEpoch,
              0n,
              0n,
              nodeId,
              tierOneId
            );

            await requestNode(
              meldToken,
              meldStakingOperator,
              meldStakingNFT,
              deployer,
              operator,
              nodeName,
              delegatorFee,
              amount,
              tierOneId,
              metadata
            );

            const operatorTokenId = await meldStakingNFT.getTotalMintedNfts();

            await meldStakingConfig
              .connect(deployer)
              .approveNodeRequest(nodeId);

            const endLockEpoch = await meldStakingCommon.getEndLockEpoch(
              operatorTokenId
            );

            const expectedStakingDataAfter =
              await calculateExpectedStakingDataAfterNewStake(
                meldStakingStorage,
                stakingDataBefore,
                amount,
                operatorTokenId,
                nodeId,
                tierOneId,
                false // !isDelegator
              );

            // Get the staking data after the stake
            const stakingDataAfter: StakingData = await getStakingData(
              meldStakingStorage,
              currentEpoch,
              0n,
              operatorTokenId,
              nodeId,
              tierOneId,
              endLockEpoch
            );
            expect(stakingDataAfter).to.deep.equal(expectedStakingDataAfter);
          });
        }); // End of Operator
      }); // End of newStake Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if not called by MeldStakingDelegator, MeldStakingOperator, or MeldStakingConfig", async function () {
          const { rando, meldStakingCommon } = await loadFixture(
            nodeStakedFixture
          );

          const delegatorBaseStakeAmount = toMeldDecimals(1000);

          await expect(
            meldStakingCommon
              .connect(rando)
              .newStake(rando.address, delegatorBaseStakeAmount)
          ).to.be.revertedWith(Errors.CALLER_NOT_STAKING_OR_CONFIG);
        });
      }); // End of newStake Error test cases
    }); // End of newStake
  }); // End of Meld Staking Contract Functions

  context("Getters", function () {
    context("isValidLockTier", function () {
      context("Happy Flow test cases", function () {
        it("Should return true for liquid staking tier", async function () {
          const {
            meldStakingCommon,
            liquidStakingTierId,
            operatorBaseStakeAmount,
          } = await loadFixture(nodeStakedFixture);

          expect(
            await meldStakingCommon.isValidLockTier(
              liquidStakingTierId,
              operatorBaseStakeAmount
            )
          ).to.be.true;
        });

        it("Should return true for valid lock staking tier", async function () {
          const {
            meldStakingCommon,
            tierTwoId,
            operatorBaseLockedStakeAmount,
          } = await loadFixture(nodeLockStakedFixture);

          expect(
            await meldStakingCommon.isValidLockTier(
              tierTwoId,
              operatorBaseLockedStakeAmount
            )
          ).to.be.true;
        });
      }); // End of Happy Flow test cases

      context("Error test cases", function () {
        it("Should return false for invalid lock staking tier", async function () {
          const { meldStakingCommon, operatorBaseLockedStakeAmount } =
            await loadFixture(nodeLockStakedFixture);

          expect(
            await meldStakingCommon.isValidLockTier(
              100n,
              operatorBaseLockedStakeAmount
            )
          ).to.be.false;
        });

        it("Should return false if lock staking tier is not active", async function () {
          const {
            meldStakingCommon,
            meldStakingConfig,
            tierOneId,
            operatorBaseLockedStakeAmount,
          } = await loadFixture(nodeLockStakedFixture);

          await meldStakingConfig.removeStakingLockTier(tierOneId);
          expect(
            await meldStakingCommon.isValidLockTier(
              tierOneId,
              operatorBaseLockedStakeAmount
            )
          ).to.be.false;
        });

        it("Should return false if amount is not valid for the lock staking tier", async function () {
          const { meldStakingCommon, tierOneId } = await loadFixture(
            nodeLockStakedFixture
          );

          const amount = toMeldDecimals(100);
          expect(
            await meldStakingCommon.isValidLockTier(tierOneId, amount)
          ).to.be.false;
        });
      }); // End of Error test cases
    }); // End of isValidLockTier

    context("ownerOfStakingNFT", function () {
      context("Happy Flow test cases", function () {
        it("Should return the correct value", async function () {
          const { delegator, meldStakingCommon, tokenId } = await loadFixture(
            setUpTokenMinted
          );

          expect(await meldStakingCommon.ownerOfStakingNFT(tokenId)).to.equal(
            delegator.address
          );
        });
      }); // End of ownerOf Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if the token does not exist", async function () {
          const { meldStakingCommon } = await loadFixture(
            deployAndConfigContractsFixture
          );

          const expectedException = `ERC721: invalid token ID`;
          await expect(
            meldStakingCommon.ownerOfStakingNFT(1n)
          ).to.be.revertedWith(expectedException);
        });
      }); // End of ownerOf Error test cases
    }); // End of ownerOf

    context("getEndLockTimestamp", function () {
      context("Happy Flow test cases", function () {
        it("Should return 0 if the staking position is liquid", async function () {
          const { meldStakingCommon, operatorTokenId } = await loadFixture(
            nodeStakedFixture
          );

          expect(
            await meldStakingCommon.getEndLockTimestamp(operatorTokenId)
          ).to.equal(0n);
        });

        it("Should return the correct timestamp for a locked staking position", async function () {
          const { meldStakingCommon, meldStakingStorage, operatorTokenId } =
            await loadFixture(nodeLockStakedFixture);

          const expectedEndLockTimestamp = await calculateEndLockTimestamp(
            meldStakingStorage,
            operatorTokenId
          );

          expect(
            await meldStakingCommon.getEndLockTimestamp(operatorTokenId)
          ).to.equal(expectedEndLockTimestamp);
        });
      }); // End of Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if the staker does not exist", async function () {
          const { meldStakingCommon } = await loadFixture(
            nodeLockStakedFixture
          );

          await expect(
            meldStakingCommon.getEndLockTimestamp(0n)
          ).to.be.revertedWith(Errors.STAKER_DOES_NOT_EXIST);
        });
      }); // End of Error test cases
    }); // End of getEndLockTimestamp

    context("getEndLockEpoch", function () {
      context("Happy Flow test cases", function () {
        it("Should return 0 if the staking position is liquid", async function () {
          const { meldStakingCommon, operatorTokenId } = await loadFixture(
            nodeStakedFixture
          );

          expect(
            await meldStakingCommon.getEndLockEpoch(operatorTokenId)
          ).to.equal(0n);
        });
        it("Should return the correct epoch for a locked staking position", async function () {
          const { meldStakingCommon, meldStakingStorage, operatorTokenId } =
            await loadFixture(nodeLockStakedFixture);

          const expectedEndLockEpoch = await calculateEndLockEpoch(
            meldStakingStorage,
            operatorTokenId
          );

          expect(
            await meldStakingCommon.getEndLockEpoch(operatorTokenId)
          ).to.equal(expectedEndLockEpoch);
        });
      }); // End of Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if the staker does not exist", async function () {
          const { meldStakingCommon } = await loadFixture(
            nodeLockStakedFixture
          );

          await expect(
            meldStakingCommon.getEndLockEpoch(0n)
          ).to.be.revertedWith(Errors.STAKER_DOES_NOT_EXIST);
        });
      }); // End of Error test cases
    }); // End of getEndLockEpoch

    context("getWeightedAmount", function () {
      it("Should return the input amount if the staking position is liquid", async function () {
        const {
          meldStakingCommon,
          liquidStakingTierId,
          operatorBaseStakeAmount,
        } = await loadFixture(nodeStakedFixture);

        expect(
          await meldStakingCommon.getWeightedAmount(
            operatorBaseStakeAmount,
            liquidStakingTierId
          )
        ).to.equal(operatorBaseStakeAmount);
      });

      it("Should return the correct weighted amount for a locked staking position", async function () {
        const {
          meldStakingCommon,
          meldStakingStorage,
          tierTwoId,
          operatorBaseLockedStakeAmount,
        } = await loadFixture(nodeLockStakedFixture);

        const expectedWeightedAmount = await calculateWeightedAmount(
          meldStakingStorage,
          operatorBaseLockedStakeAmount,
          tierTwoId
        );
        expect(
          await meldStakingCommon.getWeightedAmount(
            operatorBaseLockedStakeAmount,
            tierTwoId
          )
        ).to.equal(expectedWeightedAmount);
      });
    });
  }); // End of Getters
}); // End of MeldStakingCommon contract
