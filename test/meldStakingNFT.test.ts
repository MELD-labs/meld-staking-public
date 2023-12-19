import { ethers } from "hardhat";
import { ZeroAddress } from "ethers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import {
  deployContracts,
  deployAndConfigContracts,
  transferAndApproveTokens,
  toMeldDecimals,
  requestNode,
  delegateToNode,
} from "./utils/utils";
import { Errors } from "./utils/errors";
import isBase64 from "validator/lib/isBase64";
import validDataUrl from "valid-data-url";

describe("MeldStakingNFT", function () {
  async function stakingStartedWithNodeRequestsFixture() {
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

    const lockTierMinStakingAmount = toMeldDecimals(110_000);
    const lockTierStakingLength = 10; // 10 epochs
    const lockTierWeight = 105_00; // 105%

    await contracts.meldStakingConfig.grantRole(
      await contracts.meldStakingConfig.REWARDS_SETTER_ROLE(),
      rewardsSetter.address
    );

    await contracts.meldStakingConfig.addStakingLockTier(
      lockTierMinStakingAmount,
      lockTierStakingLength,
      lockTierWeight
    );
    await time.increaseTo(initTimestamp + 1);

    const stakingAmount = toMeldDecimals(300_000);
    const lockTierId = 0;
    const nodeName = "testNode";
    const nodeId = ethers.keccak256(ethers.toUtf8Bytes(nodeName));
    const delegatorFee = 10_00; // 10%
    const metadata = `{"name": ${nodeName}, "otherData": "data"}`;

    await requestNode(
      contracts.meldToken,
      contracts.meldStakingOperator,
      contracts.meldStakingNFT,
      deployer,
      operator,
      nodeName,
      delegatorFee,
      stakingAmount,
      lockTierId,
      metadata
    );

    return {
      ...contracts,
      deployer,
      rando,
      rando2,
      rewardsSetter,
      slashReceiver,
      operator,
      delegator,
      nodeId,
    };
  }
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
      staker,
      meldStakingCommonImpersonator,
    ] = await ethers.getSigners();

    const initTimestamp = (await time.latest()) + 1000;
    const epochSize = 5 * 24 * 60 * 60; // 5 days

    const contracts = await deployAndConfigContracts(
      deployer.address,
      initTimestamp,
      epochSize,
      slashReceiver.address,
      { common: meldStakingCommonImpersonator.address }
    );

    // Grant TRUSTED_FORWARDER_SETTER_ROLE to trustedForwarderSetter
    await contracts.meldStakingNFT.grantRole(
      await contracts.meldStakingNFT.TRUSTED_FORWARDER_SETTER_ROLE(),
      trustedForwarderSetter.address
    );

    return {
      deployer,
      rando,
      trustedForwarderSetter,
      rewardsSetter,
      trustedForwarder,
      staker,
      meldStakingCommonImpersonator,
      ...contracts,
    };
  }

  async function setUpReadyToMintFixture() {
    // call the deployAndConfigContractsFixture
    const {
      deployer,
      rando,
      trustedForwarderSetter,
      trustedForwarder,
      staker,
      meldStakingCommonImpersonator,
      ...contracts
    } = await deployAndConfigContractsFixture();

    // Make sure staker has some MELD and approves meldStakingNFT to spend the MELD
    const depositAmount = toMeldDecimals(100);
    const meldStakingNFTAddress = await contracts.meldStakingNFT.getAddress();
    await transferAndApproveTokens(
      contracts.meldToken,
      deployer,
      staker,
      meldStakingNFTAddress,
      depositAmount * 2n
    );

    return {
      deployer,
      rando,
      trustedForwarderSetter,
      trustedForwarder,
      staker,
      meldStakingCommonImpersonator,
      depositAmount,
      ...contracts,
    };
  }

  async function setUpTokenMinted() {
    // call the setUpReadyToMintFixture
    const {
      deployer,
      rando,
      trustedForwarderSetter,
      trustedForwarder,
      staker,
      meldStakingCommonImpersonator,
      depositAmount,
      ...contracts
    } = await setUpReadyToMintFixture();

    // Call the mint function as the meldStakingCommon account to mint an NFT
    await contracts.meldStakingNFT
      .connect(meldStakingCommonImpersonator)
      .mint(staker.address, depositAmount);

    const tokenId = await contracts.meldStakingNFT.getTotalMintedNfts();

    return {
      deployer,
      rando,
      trustedForwarderSetter,
      trustedForwarder,
      staker,
      meldStakingCommonImpersonator,
      tokenId,
      depositAmount,
      ...contracts,
    };
  }

  async function setUpDepositFixture() {
    // call the deployAndConfigContractsFixture
    const {
      deployer,
      rando,
      trustedForwarderSetter,
      rewardsSetter,
      trustedForwarder,
      staker,
      meldStakingCommonImpersonator,
      ...contracts
    } = await deployAndConfigContractsFixture();

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
      staker,
      meldStakingCommonImpersonator,
      depositAmount,
      ...contracts,
    };
  }

  context("Admin", function () {
    it("Should have granted the DEFAULT_ADMIN_ROLE to the deployer", async function () {
      const { deployer, meldStakingNFT } = await loadFixture(onlyDeployFixture);
      expect(
        await meldStakingNFT.hasRole(
          await meldStakingNFT.DEFAULT_ADMIN_ROLE(),
          deployer.address
        )
      ).to.be.true;
    });
    it("Should not have granted the DEFAULT_ADMIN_ROLE to any other address", async function () {
      const { rando, meldStakingNFT } = await loadFixture(onlyDeployFixture);
      expect(
        await meldStakingNFT.hasRole(
          await meldStakingNFT.DEFAULT_ADMIN_ROLE(),
          rando.address
        )
      ).to.be.false;
    });
  });

  context("TrustedForwarderSetter", function () {
    it("Should not have granted the TRUSTED_FORWARDER_SETTER_ROLE to the trustedForwarderSetter", async function () {
      const { trustedForwarderSetter, meldStakingNFT } = await loadFixture(
        onlyDeployFixture
      );
      expect(
        await meldStakingNFT.hasRole(
          await meldStakingNFT.TRUSTED_FORWARDER_SETTER_ROLE(),
          trustedForwarderSetter.address
        )
      ).to.be.false;
    });
    it("Should have granted the TRUSTED_FORWARDER_SETTER_ROLE to the trustedForwarderSetter", async function () {
      const { trustedForwarderSetter, meldStakingNFT } = await loadFixture(
        deployAndConfigContractsFixture
      );
      expect(
        await meldStakingNFT.hasRole(
          await meldStakingNFT.TRUSTED_FORWARDER_SETTER_ROLE(),
          trustedForwarderSetter.address
        )
      ).to.be.true;
    });
    it("Should not have granted the TRUSTED_FORWARDER_SETTER_ROLE to any other address", async function () {
      const { rando, meldStakingNFT } = await loadFixture(
        deployAndConfigContractsFixture
      );
      expect(
        await meldStakingNFT.hasRole(
          await meldStakingNFT.TRUSTED_FORWARDER_SETTER_ROLE(),
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

        await expect(meldStakingNFT.initialize(meldStakingAddressProvider))
          .to.emit(meldStakingNFT, "Initialized")
          .withArgs(deployer.address, meldStakingAddressProviderAddress);
      });
    }); // End of Initialize Happy Flow test cases

    context("Error test cases", function () {
      it("Should revert if MeldStakingAddressProvider is zero address", async function () {
        const { meldStakingNFT } = await loadFixture(onlyDeployFixture);

        await expect(meldStakingNFT.initialize(ZeroAddress)).to.be.revertedWith(
          Errors.INVALID_ADDRESS
        );
      });
      it("Should revert if called by a non-admin", async function () {
        const { rando, meldStakingNFT, meldStakingAddressProvider } =
          await loadFixture(onlyDeployFixture);

        const meldStakingAddressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingNFT.DEFAULT_ADMIN_ROLE()}`;

        await expect(
          meldStakingNFT
            .connect(rando)
            .initialize(meldStakingAddressProviderAddress)
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert if initialized twice", async function () {
        const { meldStakingNFT, meldStakingAddressProvider } =
          await loadFixture(deployAndConfigContractsFixture); // this fixture initializes all contracts

        const meldStakingAddressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        await expect(
          meldStakingNFT.initialize(meldStakingAddressProviderAddress)
        ).to.be.revertedWith(Errors.ALREADY_INITIALIZED);
      });

      it("Should revert if address provider returns zero address for an address being initialized", async function () {
        const { meldStakingNFT, meldStakingAddressProvider } =
          await loadFixture(onlyDeployFixture);

        const meldStakingAddressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        await expect(
          meldStakingNFT.initialize(meldStakingAddressProviderAddress)
        ).to.be.revertedWith(Errors.ADDRESS_PROVIDER_NOT_INITIALIZED);
      });
    }); // End of Initialize Error test cases
  }); // End of Initialize

  context("Setters", function () {
    context("setTrustedForwarder", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct event", async function () {
          const {
            meldStakingNFT,
            trustedForwarderSetter,
            trustedForwarder,
            rando,
          } = await loadFixture(deployAndConfigContractsFixture);

          await expect(
            meldStakingNFT
              .connect(trustedForwarderSetter)
              .setTrustedForwarder(trustedForwarder.address)
          )
            .to.emit(meldStakingNFT, "TrustedForwarderChanged")
            .withArgs(
              trustedForwarderSetter.address,
              ZeroAddress,
              trustedForwarder.address
            );

          await expect(
            meldStakingNFT
              .connect(trustedForwarderSetter)
              .setTrustedForwarder(rando.address)
          )
            .to.emit(meldStakingNFT, "TrustedForwarderChanged")
            .withArgs(
              trustedForwarderSetter.address,
              trustedForwarder.address,
              rando.address
            );
        });

        it("Should update state correctly", async function () {
          const { meldStakingNFT, trustedForwarderSetter, trustedForwarder } =
            await loadFixture(deployAndConfigContractsFixture);

          await meldStakingNFT
            .connect(trustedForwarderSetter)
            .setTrustedForwarder(trustedForwarder.address);

          expect(await meldStakingNFT.getTrustedForwarder()).to.equal(
            trustedForwarder.address
          );
          expect(
            await meldStakingNFT.isTrustedForwarder(trustedForwarder.address)
          ).to.be.true;
        });
      }); // End of setTrustedForwarder Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if called by a non-TrustedForwarderSetter", async function () {
          const { rando, meldStakingNFT, trustedForwarder } = await loadFixture(
            deployAndConfigContractsFixture
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingNFT.TRUSTED_FORWARDER_SETTER_ROLE()}`;
          await expect(
            meldStakingNFT
              .connect(rando)
              .setTrustedForwarder(trustedForwarder.address)
          ).to.be.revertedWith(expectedException);
        });
      }); // End of setTrustedForwarder Error test cases
    }); // End of setTrustedForwarder

    context("setMetadataAddress", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct event", async function () {
          const { deployer, rando, meldStakingNFT, meldStakingNFTMetadata } =
            await loadFixture(deployAndConfigContractsFixture);

          const metadataAddress = await meldStakingNFTMetadata.getAddress();
          await expect(meldStakingNFT.setMetadataAddress(metadataAddress))
            .to.emit(meldStakingNFT, "MetadataAddressUpdated")
            .withArgs(deployer.address, ZeroAddress, metadataAddress);

          await expect(meldStakingNFT.setMetadataAddress(rando))
            .to.emit(meldStakingNFT, "MetadataAddressUpdated")
            .withArgs(deployer.address, metadataAddress, rando.address);
        });

        it("Should update state correctly", async function () {
          const { meldStakingNFT, meldStakingNFTMetadata } = await loadFixture(
            deployAndConfigContractsFixture
          );

          const metadataAddress = await meldStakingNFTMetadata.getAddress();
          await meldStakingNFT.setMetadataAddress(metadataAddress);

          expect(await meldStakingNFT.nftMetadata()).to.equal(metadataAddress);
        });
      }); // End of setMetadataAddress Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if called by non-admin", async function () {
          const { rando, meldStakingNFT, meldStakingNFTMetadata } =
            await loadFixture(deployAndConfigContractsFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingNFT.DEFAULT_ADMIN_ROLE()}`;
          await expect(
            meldStakingNFT
              .connect(rando)
              .setMetadataAddress(await meldStakingNFTMetadata.getAddress())
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if address is the zero address", async function () {
          const { meldStakingNFT } = await loadFixture(
            deployAndConfigContractsFixture
          );

          await expect(
            meldStakingNFT.setMetadataAddress(ZeroAddress)
          ).to.be.revertedWith(Errors.INVALID_ADDRESS);
        });
      }); // End of setMetadataAddress Error test cases
    }); // End of setMetadataAddress
  }); // End of Setters

  context("Meld Staking Contract Functions", function () {
    context("mint", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct events", async function () {
          const {
            staker,
            meldStakingCommonImpersonator,
            meldStakingNFT,
            depositAmount,
          } = await loadFixture(setUpReadyToMintFixture);

          const mintTx = await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .mint(staker.address, depositAmount);

          // Check for event.
          await expect(mintTx)
            .to.emit(meldStakingNFT, "MeldDeposited")
            .withArgs(staker.address, toMeldDecimals(100));

          await expect(mintTx)
            .to.emit(meldStakingNFT, "Transfer")
            .withArgs(ZeroAddress, staker.address, 1);
        });

        it("Should update state correctly", async function () {
          const {
            staker,
            meldStakingCommonImpersonator,
            meldStakingNFT,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpReadyToMintFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .mint(staker.address, depositAmount);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount
          );
          expect(await meldStakingNFT.totalSupply()).to.equal(1);
          expect(await meldStakingNFT.balanceOf(staker.address)).to.equal(1);
          expect(
            await meldStakingNFT.tokenOfOwnerByIndex(staker.address, 0)
          ).to.equal(1);
          expect(await meldStakingNFT.ownerOf(1)).to.equal(staker.address);
          expect(await meldStakingNFT.tokenByIndex(0)).to.equal(1);
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(1);
          expect(await meldStakingNFT.exists(1)).to.be.true;

          const allTokensByOwner = await meldStakingNFT.getAllTokensByOwner(
            staker.address
          );

          expect(allTokensByOwner).to.eql([1n]);
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            depositAmount
          );
        });

        it("Should update state correctly after multiple mints", async function () {
          const {
            deployer,
            meldStakingCommonImpersonator,
            meldStakingNFT,
            meldToken,
          } = await loadFixture(deployAndConfigContractsFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const ethAmount: bigint = toMeldDecimals(2);
          const initialAmount: bigint = toMeldDecimals(100);

          // Generate 10 stakers with the Hardhat Ethers provider
          const stakers = [];
          for (let i = 0; i < 10; i++) {
            const provider = ethers.provider;
            const staker = ethers.Wallet.createRandom().connect(provider);

            // Send ETH to the staker's address for gas
            await deployer.sendTransaction({
              to: staker.address,
              value: ethAmount,
            });

            const approvedAmount = initialAmount * BigInt(i + 1);

            // Make sure staker has some MELD and approves meldStakingNFT to spend the MELD
            const meldStakingNFTAddress = await meldStakingNFT.getAddress();
            await transferAndApproveTokens(
              meldToken,
              deployer,
              staker,
              meldStakingNFTAddress,
              approvedAmount
            );
            stakers.push(staker);
          }

          let totalStakedAmount: bigint = 0n;
          let depositAmount: bigint = 0n;
          // Mint an NFT for each staker
          for (let i = 0; i < stakers.length; i++) {
            const staker = stakers[i];
            depositAmount = initialAmount * BigInt(i + 1);

            // Call the mint function as the meldStakingCommon account
            await meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .mint(staker.address, depositAmount);

            totalStakedAmount += depositAmount;

            // Do some state checks
            expect(await meldStakingNFT.balanceOf(staker.address)).to.equal(1);
            expect(
              await meldStakingNFT.tokenOfOwnerByIndex(staker.address, 0)
            ).to.equal(i + 1);
            expect(await meldStakingNFT.ownerOf(i + 1)).to.equal(
              staker.address
            );
            expect(await meldStakingNFT.tokenByIndex(i)).to.equal(i + 1);
            expect(await meldStakingNFT.exists(i + 1)).to.be.true;
            expect(
              await meldStakingNFT.getAllTokensByOwner(staker.address)
            ).to.eql([BigInt(i) + 1n]);
          }

          // Cummulative state checks
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            totalStakedAmount
          );
          expect(await meldStakingNFT.totalSupply()).to.equal(
            BigInt(stakers.length)
          );
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(
            BigInt(stakers.length)
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            totalStakedAmount
          );
        });

        it("Should update state correctly when same staker mints multiple NFTs", async function () {
          const {
            staker,
            meldStakingCommonImpersonator,
            meldStakingNFT,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpReadyToMintFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .mint(staker.address, depositAmount);
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .mint(staker.address, depositAmount);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount * 2n
          );
          expect(await meldStakingNFT.totalSupply()).to.equal(2n);
          expect(await meldStakingNFT.balanceOf(staker.address)).to.equal(2);
          expect(
            await meldStakingNFT.tokenOfOwnerByIndex(staker.address, 0)
          ).to.equal(1);
          expect(
            await meldStakingNFT.tokenOfOwnerByIndex(staker.address, 1)
          ).to.equal(2);
          expect(await meldStakingNFT.ownerOf(1)).to.equal(staker.address);
          expect(await meldStakingNFT.ownerOf(2)).to.equal(staker.address);
          expect(await meldStakingNFT.tokenByIndex(0)).to.equal(1);
          expect(await meldStakingNFT.tokenByIndex(1)).to.equal(2);
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(2n);
          expect(await meldStakingNFT.exists(1)).to.be.true;
          expect(await meldStakingNFT.exists(2)).to.be.true;

          const allTokensByOwner = await meldStakingNFT.getAllTokensByOwner(
            staker.address
          );

          expect(allTokensByOwner).to.eql([1n, 2n]);
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            depositAmount * 2n
          );
        });
      }); // End of mint Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if not called by the MeldStakingCommon contract", async function () {
          const { rando, staker, meldStakingNFT, depositAmount } =
            await loadFixture(setUpReadyToMintFixture);

          await expect(
            meldStakingNFT.connect(rando).mint(staker.address, depositAmount)
          ).to.be.revertedWith(Errors.CALLER_NOT_STAKING);
        });

        it("Should revert if from address is the zero address", async function () {
          const {
            meldStakingCommonImpersonator,
            meldStakingNFT,
            depositAmount,
          } = await loadFixture(setUpReadyToMintFixture);

          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .mint(ZeroAddress, depositAmount)
          ).to.be.revertedWith(Errors.INVALID_ADDRESS);
        });

        it("Should revert if amount is zero", async function () {
          const { staker, meldStakingCommonImpersonator, meldStakingNFT } =
            await loadFixture(deployAndConfigContractsFixture);

          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .mint(staker.address, 0)
          ).to.be.revertedWith(Errors.DEPOSIT_INVALID_AMOUNT);
        });

        it("Should revert if the staker does not have enough Meld tokens to deposit the specified amount", async function () {
          const {
            deployer,
            staker,
            meldStakingCommonImpersonator,
            meldStakingNFT,
            meldToken,
          } = await loadFixture(deployAndConfigContractsFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const depositAmount = toMeldDecimals(100);

          // Make sure staker has some MELD, but not enough
          await meldToken
            .connect(deployer)
            .transfer(staker.address, depositAmount / 2n);

          // Staker approves meldStakingNFT to spend the MELD -- the correct amount
          await meldToken
            .connect(staker)
            .approve(meldStakingNFTAddress, toMeldDecimals(100));

          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .mint(staker.address, depositAmount)
          ).to.be.revertedWith(Errors.DEPOSIT_INVALID_AMOUNT);
        });

        it("Should revert if allowance is too low to deposit the specified amount of Meld tokens", async function () {
          const {
            deployer,
            staker,
            meldStakingCommonImpersonator,
            meldStakingNFT,
            meldToken,
          } = await loadFixture(deployAndConfigContractsFixture);
          const depositAmount = toMeldDecimals(100);

          // Make sure staker has some MELD
          await meldToken
            .connect(deployer)
            .transfer(staker.address, depositAmount);

          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .mint(staker.address, depositAmount)
          ).to.be.revertedWith(Errors.INSUFFICIENT_ALLOWANCE);
        });
      }); // End of mint Error test cases
    }); // End of mint

    context("redeem", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct events", async function () {
          const {
            staker,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            tokenId,
          } = await loadFixture(setUpTokenMinted);

          const redeemTx = await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .redeem(tokenId);

          //Check for Redeemed and Transfer events
          await expect(redeemTx)
            .to.emit(meldStakingNFT, "Redeemed")
            .withArgs(staker.address, tokenId);

          await expect(redeemTx)
            .to.emit(meldStakingNFT, "Transfer")
            .withArgs(staker.address, ZeroAddress, tokenId);
        });

        it("Should update state correctly", async function () {
          const {
            staker,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            tokenId,
          } = await loadFixture(setUpTokenMinted);

          let expectedException;

          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .redeem(tokenId);

          // Check state
          expect(await meldStakingNFT.redeemedNfts()).to.equal(1);
          expect(await meldStakingNFT.totalSupply()).to.equal(0);
          expect(await meldStakingNFT.balanceOf(staker.address)).to.equal(0);
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(1);
          expect(await meldStakingNFT.exists(tokenId)).to.be.false;

          const allTokensByOwner = await meldStakingNFT.getAllTokensByOwner(
            staker.address
          );
          expect(allTokensByOwner).to.eql([]);

          expectedException = `ERC721: invalid token ID`;
          await expect(meldStakingNFT.ownerOf(tokenId)).to.be.revertedWith(
            expectedException
          );

          expectedException = `ERC721Enumerable: global index out of bounds`;
          await expect(meldStakingNFT.tokenByIndex(0)).to.be.revertedWith(
            expectedException
          );

          expectedException = `ERC721Enumerable: owner index out of bounds`;
          await expect(
            meldStakingNFT.tokenOfOwnerByIndex(staker.address, 0)
          ).to.be.revertedWith(expectedException);
        });

        it("Should update state correctly when same staker has multiple NFTs and redeems 1", async function () {
          const {
            staker,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            tokenId,
          } = await loadFixture(setUpTokenMinted);

          let expectedException;

          // Call the mint function as the meldStakingCommon account to mint a second NFT
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .mint(staker.address, toMeldDecimals(100));

          // Redeem an NFT
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .redeem(tokenId);

          const newTokenId = await meldStakingNFT.getTotalMintedNfts();

          // Check state
          expect(await meldStakingNFT.redeemedNfts()).to.equal(1);
          expect(await meldStakingNFT.totalSupply()).to.equal(1);
          expect(await meldStakingNFT.balanceOf(staker.address)).to.equal(1);
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(2);
          expect(await meldStakingNFT.exists(tokenId)).to.be.false;
          expect(await meldStakingNFT.exists(newTokenId)).to.be.true;
          expect(
            await meldStakingNFT.getAllTokensByOwner(staker.address)
          ).to.eql([newTokenId]);

          expectedException = `ERC721: invalid token ID`;
          await expect(meldStakingNFT.ownerOf(tokenId)).to.be.revertedWith(
            expectedException
          );
          expect(await meldStakingNFT.ownerOf(tokenId + 1n)).to.equal(
            staker.address
          );

          expectedException = `ERC721Enumerable: global index out of bounds`;
          await expect(meldStakingNFT.tokenByIndex(1)).to.be.revertedWith(
            expectedException
          ); //due to swap and pop
          expect(await meldStakingNFT.tokenByIndex(0)).to.equal(tokenId + 1n); //due to swap and pop

          expectedException = `ERC721Enumerable: owner index out of bounds`;
          await expect(
            meldStakingNFT.tokenOfOwnerByIndex(staker.address, 1)
          ).to.be.revertedWith(expectedException); //due to swap and pop
          expect(
            await meldStakingNFT.tokenOfOwnerByIndex(staker.address, 0)
          ).to.equal(tokenId + 1n); //due to swap and pop
        });
      }); // End of redeem Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if not called by the MeldStakingCommon contract", async function () {
          const { rando, meldStakingNFT, tokenId } = await loadFixture(
            setUpTokenMinted
          );

          await expect(
            meldStakingNFT.connect(rando).redeem(tokenId)
          ).to.be.revertedWith(Errors.CALLER_NOT_STAKING);
        });
      }); // End of redeem Error test cases
    }); // End of redeem

    context("depositMeld", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct events", async function () {
          const {
            rewardsSetter,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpDepositFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          // The "from" address will be the address with the REWARDS_SETTER_ROLE
          const depositMeldTx = await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
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
            meldStakingCommonImpersonator,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpDepositFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
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
            deployer,
            staker,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            meldToken,
          } = await loadFixture(setUpDepositFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const initialAmount = toMeldDecimals(100_000);
          const depositAmount: bigint = initialAmount / 2n;
          const depositAmount2: bigint = initialAmount / 10n;

          await transferAndApproveTokens(
            meldToken,
            deployer,
            staker,
            meldStakingNFTAddress,
            initialAmount
          );

          // Deposit MELD twice
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .depositMeld(staker.address, depositAmount);
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .depositMeld(staker.address, depositAmount2);

          const expectedDepositorBalance =
            initialAmount - depositAmount - depositAmount2;
          const expectedNFTContractBalance = depositAmount + depositAmount2;

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            expectedNFTContractBalance
          );

          expect(await meldToken.balanceOf(staker.address)).to.equal(
            expectedDepositorBalance
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            expectedNFTContractBalance
          );
        });
      }); // End of depositMeld Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if not called by the MeldStakingCommon contract", async function () {
          const { rando, meldStakingNFT, depositAmount } = await loadFixture(
            setUpDepositFixture
          );

          await expect(
            meldStakingNFT
              .connect(rando)
              .depositMeld(rando.address, depositAmount)
          ).to.be.revertedWith(Errors.CALLER_NOT_STAKING);
        });

        it("Should revert if the amount to deposit is zero", async function () {
          const { staker, meldStakingNFT, meldStakingCommonImpersonator } =
            await loadFixture(setUpDepositFixture);

          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .depositMeld(staker.address, 0)
          ).to.be.revertedWith(Errors.DEPOSIT_INVALID_AMOUNT);
        });

        it("Should revert if the rewards setter does not have enough Meld tokens to deposit the specified amount", async function () {
          const {
            deployer,
            rewardsSetter,
            meldStakingCommonImpersonator,
            meldStakingNFT,
            meldToken,
          } = await loadFixture(deployAndConfigContractsFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const depositAmount = toMeldDecimals(100);

          // Make sure staker has some MELD, but not enough
          await meldToken
            .connect(deployer)
            .transfer(rewardsSetter.address, depositAmount / 2n);

          // rewardsSetter approves meldStakingNFT to spend the MELD -- the correct amount
          await meldToken
            .connect(rewardsSetter)
            .approve(meldStakingNFTAddress, toMeldDecimals(100));

          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .depositMeld(rewardsSetter.address, depositAmount)
          ).to.be.revertedWith(Errors.DEPOSIT_INVALID_AMOUNT);
        });

        it("Should revert if allowance is too low to deposit the specified amount of Meld tokens", async function () {
          const {
            deployer,
            rewardsSetter,
            meldStakingCommonImpersonator,
            meldStakingNFT,
            meldToken,
          } = await loadFixture(deployAndConfigContractsFixture);

          const depositAmount = toMeldDecimals(100);

          // Make sure rewardsSetter has some MELD
          await meldToken
            .connect(deployer)
            .transfer(rewardsSetter.address, depositAmount);

          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .depositMeld(rewardsSetter.address, depositAmount)
          ).to.be.revertedWith(Errors.INSUFFICIENT_ALLOWANCE);
        });
      }); // End of depositMeld Error test cases
    }); // End of depositMeld

    context("withdrawMeld", function () {
      context("Happy Flow test cases", function () {
        it("Should emit the correct events", async function () {
          const {
            staker,
            meldToken,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          const withdrawMeldTx = await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .withdrawMeld(staker.address, depositAmount);

          //Check for MeldWithdrawn and Transfer events
          await expect(withdrawMeldTx)
            .to.emit(meldStakingNFT, "MeldWithdrawn")
            .withArgs(staker.address, depositAmount);

          await expect(withdrawMeldTx)
            .to.emit(meldToken, "Transfer")
            .withArgs(meldStakingNFTAddress, staker.address, depositAmount);
        });

        it("Should update state correctly for staker that withdraws whole amount", async function () {
          const {
            staker,
            meldToken,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const stakerBalanceBefore = await meldToken.balanceOf(staker.address);

          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .withdrawMeld(staker.address, depositAmount);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(0n);
          expect(await meldToken.balanceOf(staker.address)).to.equal(
            stakerBalanceBefore + depositAmount
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(0n);
        });

        it("Should update state correctly for rewards setter that withdraws whole amount", async function () {
          const {
            rewardsSetter,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpDepositFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          // Rewards setter deposits MELD
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .depositMeld(rewardsSetter.address, depositAmount);

          const rewardsSetterBalanceBefore = await meldToken.balanceOf(
            rewardsSetter.address
          );

          // Rewards setter withdraws MELD
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .withdrawMeld(rewardsSetter.address, depositAmount);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(0n);
          expect(await meldToken.balanceOf(rewardsSetter.address)).to.equal(
            rewardsSetterBalanceBefore + depositAmount
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(0n);
        });

        it("Should update state correctly when staker withdraws partial amount", async function () {
          const {
            staker,
            meldToken,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();
          const stakerBalanceBefore = await meldToken.balanceOf(staker.address);

          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .withdrawMeld(staker.address, depositAmount / 2n);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount / 2n
          );
          expect(await meldToken.balanceOf(staker.address)).to.equal(
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
            meldStakingCommonImpersonator,
            meldToken,
            depositAmount,
          } = await loadFixture(setUpDepositFixture);

          const meldStakingNFTAddress = await meldStakingNFT.getAddress();

          // Rewards setter deposits MELD
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .depositMeld(rewardsSetter.address, depositAmount);

          const rewardsSetterBalanceBefore = await meldToken.balanceOf(
            rewardsSetter.address
          );

          // Rewards setter withdraws MELD
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
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
            meldStakingCommonImpersonator,
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

          // Second depositor deposits MELD. Staker deposited in fixture.
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .depositMeld(rando.address, depositAmount2);

          const randoBalanceBefore = await meldToken.balanceOf(rando.address);
          const meldStakingNFTBalanceBefore = await meldToken.balanceOf(
            meldStakingNFTAddress
          );

          // Rando withdraws MELD
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .withdrawMeld(rando.address, depositAmount2);

          // Check state
          expect(await meldStakingNFT.lockedMeldTokens()).to.equal(
            depositAmount
          ); // depositAmount is amount deposited by staker in fixture
          expect(await meldToken.balanceOf(rando.address)).to.equal(
            randoBalanceBefore + depositAmount2
          );
          expect(await meldToken.balanceOf(meldStakingNFTAddress)).to.equal(
            meldStakingNFTBalanceBefore - depositAmount2
          );
        });
      }); // End of withdrawMeld Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if not called by the MeldStakingCommon contract", async function () {
          const { rando, meldStakingNFT, depositAmount } = await loadFixture(
            setUpTokenMinted
          );

          await expect(
            meldStakingNFT
              .connect(rando)
              .withdrawMeld(rando.address, depositAmount)
          ).to.be.revertedWith(Errors.CALLER_NOT_STAKING);
        });

        it("Should revert if to address is the zero address", async function () {
          const {
            meldStakingNFT,
            meldStakingCommonImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);

          const expectedException = `ERC20: transfer to the zero address`;

          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .withdrawMeld(ZeroAddress, depositAmount)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if the amount to withdraw is zero", async function () {
          const { staker, meldStakingNFT, meldStakingCommonImpersonator } =
            await loadFixture(setUpTokenMinted);

          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .withdrawMeld(staker.address, 0)
          ).to.be.revertedWith(Errors.WITHDRAW_INVALID_AMOUNT);
        });

        it("Should revert if amount exceeds total deposits by multiple depositors", async function () {
          const {
            deployer,
            rando,
            meldToken,
            meldStakingNFT,
            meldStakingCommonImpersonator,
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

          // Second depositor deposits MELD. Staker deposited in fixture.
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .depositMeld(rando.address, depositAmount2);

          const additionalAmount = ethers.parseUnits("1", "wei");

          // Rando attempts to withdraw more than the total deposited by both depositors
          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .withdrawMeld(
                rando.address,
                depositAmount + depositAmount2 + additionalAmount
              )
          ).to.be.revertedWith(Errors.WITHDRAW_INVALID_AMOUNT);
        });

        it("Should revert if amount exceeds own deposited amount", async function () {
          //staker tries to withdraw more than s/he deposited
          const {
            staker,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            depositAmount,
          } = await loadFixture(setUpTokenMinted);

          const additionalAmount = ethers.parseUnits("1", "wei");

          await expect(
            meldStakingNFT
              .connect(meldStakingCommonImpersonator)
              .withdrawMeld(staker.address, depositAmount + additionalAmount)
          ).to.be.revertedWith(Errors.WITHDRAW_INVALID_AMOUNT);
        });
      }); // End of withdrawMeld Error test cases
    }); // End of withdrawMeld
  }); // End of Meld Staking Contract Functions

  context("Getters", function () {
    context("name and symbol", function () {
      it("Should return the correct value", async function () {
        const { meldStakingNFT } = await loadFixture(
          deployAndConfigContractsFixture
        );

        expect(await meldStakingNFT.name()).to.equal("MeldStakingNFT");
        expect(await meldStakingNFT.symbol()).to.equal("MELD-STAKING-NFT");
      });
    }); // End of name and symbol

    context(
      "totalSupply, redeemedNFTs, getTotalMintedNfts, balanceOf, getAllTokensByOwner, exists",
      function () {
        it("Should return the correct value", async function () {
          const {
            staker,
            meldStakingNFT,
            meldStakingCommonImpersonator,
            tokenId,
          } = await loadFixture(setUpTokenMinted);

          // Call the mint function as the meldStakingCommon account to mint a second NFT
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .mint(staker.address, toMeldDecimals(100));

          const newTokenId = await meldStakingNFT.getTotalMintedNfts();

          // Redeem an NFT
          await meldStakingNFT
            .connect(meldStakingCommonImpersonator)
            .redeem(tokenId);

          expect(await meldStakingNFT.redeemedNfts()).to.equal(1);
          expect(await meldStakingNFT.totalSupply()).to.equal(1);
          expect(await meldStakingNFT.balanceOf(staker.address)).to.equal(1);
          expect(await meldStakingNFT.getTotalMintedNfts()).to.equal(2);
          expect(await meldStakingNFT.exists(tokenId)).to.be.false;
          expect(await meldStakingNFT.exists(newTokenId)).to.be.true;
          expect(
            await meldStakingNFT.getAllTokensByOwner(staker.address)
          ).to.eql([newTokenId]);
        });
      }
    ); // End of totalSupply, redeemedNFTs, getTotalMintedNfts, balanceOf, getAllTokensByOwner, exists

    context("supportsInterface", function () {
      it("Should return the correct value", async function () {
        const { meldStakingNFT } = await loadFixture(onlyDeployFixture);

        expect(await meldStakingNFT.supportsInterface("0x80ac58cd")).to.be.true;
      });
    }); // End of supportsInterface

    context("ownerOf", function () {
      context("Happy Flow test cases", function () {
        it("Should return the correct value", async function () {
          const { staker, meldStakingNFT, tokenId } = await loadFixture(
            setUpTokenMinted
          );

          expect(await meldStakingNFT.ownerOf(tokenId)).to.equal(
            staker.address
          );
        });
      }); // End of ownerOf Happy Flow test cases

      context("Error test cases", function () {
        it("Should revert if the token does not exist", async function () {
          const { meldStakingNFT } = await loadFixture(onlyDeployFixture);

          const expectedException = `ERC721: invalid token ID`;

          await expect(meldStakingNFT.ownerOf(1)).to.be.revertedWith(
            expectedException
          );
        });
      }); // End of ownerOf Error test cases
    }); // End of ownerOf

    context("getTrustedForwarder", function () {
      it("Should return the correct value before and after value is set", async function () {
        const { meldStakingNFT, trustedForwarderSetter, trustedForwarder } =
          await loadFixture(deployAndConfigContractsFixture);

        expect(await meldStakingNFT.getTrustedForwarder()).to.equal(
          ZeroAddress
        );

        await meldStakingNFT
          .connect(trustedForwarderSetter)
          .setTrustedForwarder(trustedForwarder.address);

        expect(await meldStakingNFT.getTrustedForwarder()).to.equal(
          trustedForwarder.address
        );
      });
    }); // End of getTrustedForwarder

    context("isTrustedForwarder", function () {
      it("Should return the correct value before and after a value is set", async function () {
        const {
          meldStakingNFT,
          trustedForwarderSetter,
          trustedForwarder,
          rando,
        } = await loadFixture(deployAndConfigContractsFixture);

        expect(
          await meldStakingNFT.isTrustedForwarder(trustedForwarder.address)
        ).to.be.false;

        await meldStakingNFT
          .connect(trustedForwarderSetter)
          .setTrustedForwarder(trustedForwarder.address);

        expect(
          await meldStakingNFT.isTrustedForwarder(trustedForwarder.address)
        ).to.be.true;
        expect(
          await meldStakingNFT.isTrustedForwarder(rando.address)
        ).to.be.false;
      });
    });

    context("tokenURI", function () {
      context("Happy Flow test cases", function () {
        it("Should return the correct value", async function () {
          const { meldStakingNFT, meldStakingNFTMetadata, tokenId } =
            await loadFixture(setUpTokenMinted);

          // Set MeldStakingNFTMetadata address
          await meldStakingNFT.setMetadataAddress(
            await meldStakingNFTMetadata.getAddress()
          );

          const uri = await meldStakingNFT.tokenURI(tokenId);

          /* Note: The final design for the dynamic metadata is still being worked out. This test case is just testing that a valid data url with valid JSON is returned.
           * After the design is finished, more specific tests for the values returend in the metadata will be added.
           */

          // Check that the URI is a valid data URI
          expect(validDataUrl(uri)).to.be.true;

          // Check that the URI is a valid base64-encoded string
          expect(isBase64(uri.substring(29))).to.be.true;

          // 29 = length of "data:application/json;base64,"
          const jsonString = Buffer.from(
            uri.substring(29),
            "base64"
          ).toString();
          const json = JSON.parse(jsonString);

          // Check that the JSON object has the required properties
          expect(json).to.have.property("name");
          expect(json).to.have.property("description");
          expect(json).to.have.property("image");
          expect(json).to.have.property("attributes");
        });
      });

      context("Error test cases", function () {
        it("Should revert if the token does not exist", async function () {
          const { meldStakingNFT, meldStakingNFTMetadata } = await loadFixture(
            onlyDeployFixture
          );

          // Set MeldStakingNFTMetadata address
          await meldStakingNFT.setMetadataAddress(
            await meldStakingNFTMetadata.getAddress()
          );

          const expectedException = `ERC721: invalid token ID`;

          await expect(meldStakingNFT.tokenURI(1)).to.be.revertedWith(
            expectedException
          );
        });
        it("Should revert if nftMetadata address is not set", async function () {
          const { meldStakingNFT, tokenId } = await loadFixture(
            setUpTokenMinted
          ); // A token has been minted

          await expect(meldStakingNFT.tokenURI(tokenId)).to.be.revertedWith(
            Errors.METADATA_ADDRESS_NOT_SET
          );
        });
      }); // End of tokenURI Error test cases
    }); // End of tokenURI
  });

  context("NFT transfer", function () {
    context("Block transfers test cases", function () {
      it("Should block transfer correctly if Operator Request NFT", async function () {
        const { rando, operator, meldStakingNFT } = await loadFixture(
          stakingStartedWithNodeRequestsFixture
        );

        const tokenList = await meldStakingNFT.getAllTokensByOwner(
          operator.address
        );
        const tokenId = tokenList[0];

        await expect(
          meldStakingNFT
            .connect(operator)
            .transferFrom(operator.address, rando, tokenId)
        ).to.be.revertedWith(Errors.NO_OPERATOR_NFT_TRANSFER);

        // Check owner remains the same
        expect(await meldStakingNFT.ownerOf(tokenId)).to.equal(
          operator.address
        );
      });

      it("Should block transfer correctly if Operator NFT", async function () {
        const {
          rando,
          operator,
          deployer,
          meldStakingNFT,
          meldStakingConfig,
          nodeId,
        } = await loadFixture(stakingStartedWithNodeRequestsFixture);

        const tokenList = await meldStakingNFT.getAllTokensByOwner(
          operator.address
        );
        const tokenId = tokenList[0];

        // Approve request so that NFT is operator type
        await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

        await expect(
          meldStakingNFT
            .connect(operator)
            .transferFrom(operator.address, rando, tokenId)
        ).to.be.revertedWith(Errors.NO_OPERATOR_NFT_TRANSFER);

        // Check owner remains the same
        expect(await meldStakingNFT.ownerOf(tokenId)).to.equal(
          operator.address
        );
      });
    });

    context("Happy Flow test cases", function () {
      it("Should allow transfer if Delegator NFT", async function () {
        const {
          rando,
          delegator,
          deployer,
          meldStakingNFT,
          meldStakingConfig,
          meldStakingDelegator,
          meldToken,
          nodeId,
        } = await loadFixture(stakingStartedWithNodeRequestsFixture);

        // Approve request so that pool is active
        await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

        // Create a position in the staking system

        // Params for the delegator stake
        const delegatorBaseStakeAmount = toMeldDecimals(100);

        // Delegator stakes node
        await delegateToNode(
          meldToken,
          meldStakingDelegator,
          meldStakingNFT,
          deployer,
          delegator,
          delegatorBaseStakeAmount,
          nodeId,
          0 // liquid staking
        );

        const tokenList = await meldStakingNFT.getAllTokensByOwner(
          delegator.address
        );
        const tokenId = tokenList[0];

        await expect(
          meldStakingNFT
            .connect(delegator)
            .transferFrom(delegator.address, rando.address, tokenId)
        )
          .to.emit(meldStakingNFT, "Transfer")
          .withArgs(delegator.address, rando.address, tokenId);

        // Check owner is changed to the new owner
        expect(await meldStakingNFT.ownerOf(tokenId)).to.equal(rando.address);
      });
    });
  }); // End of NFT transfers
});
