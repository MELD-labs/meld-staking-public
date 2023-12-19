import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployAndConfigContracts,
  deployContracts,
  requestNode,
  toMeldDecimals,
  transferAndApproveTokens,
} from "../utils/utils";
import { ZeroAddress } from "ethers";
import { Errors } from "../utils/errors";

describe("MeldStakingConfig - General", function () {
  // Only deploy the contracts, no initialization
  async function onlyDeployFixture() {
    const [deployer, rando, slashReceiver, operator] =
      await ethers.getSigners();
    const contracts = await deployContracts(deployer.address);
    return { deployer, rando, slashReceiver, operator, ...contracts };
  }

  // Deploy the contracts and initialize them
  async function deployAndInitializeFixture() {
    const [deployer, rando, rando2, rewardsSetter, slashReceiver, operator] =
      await ethers.getSigners();
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

  // Deploy the contracts, initialize them, start staking and set the rewards setter role
  async function rewardsFixture() {
    const stakingStartedFixtureVars = await deployAndInitializeFixture();
    const { deployer, rewardsSetter, meldStakingConfig } =
      stakingStartedFixtureVars;
    await meldStakingConfig
      .connect(deployer)
      .grantRole(
        await meldStakingConfig.REWARDS_SETTER_ROLE(),
        rewardsSetter.address
      );
    return stakingStartedFixtureVars;
  }

  // Deploy the contracts, initialize them, start staking and request and approve a node
  async function nodeStakedFixture() {
    const stakingStartedFixtureVars = await stakingStartedFixture();
    const {
      deployer,
      operator,
      meldStakingConfig,
      meldStakingOperator,
      meldStakingNFT,
      meldToken,
    } = stakingStartedFixtureVars;

    // Params for the node request
    const nodeName = "testNode";
    const delegatorFee = 10_00; // 10%
    const amount = toMeldDecimals(110_000);
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
    await meldStakingConfig.connect(deployer).approveNodeRequest(nodeId);

    return { ...stakingStartedFixtureVars, nodeId };
  }

  context("Admin", function () {
    it("Should have granted the DEFAULT_ADMIN_ROLE to the deployer", async function () {
      const { deployer, meldStakingConfig } = await loadFixture(
        onlyDeployFixture
      );
      expect(
        await meldStakingConfig.hasRole(
          await meldStakingConfig.DEFAULT_ADMIN_ROLE(),
          deployer.address
        )
      ).to.be.true;
    });
    it("Should not have granted the DEFAULT_ADMIN_ROLE to any other address", async function () {
      const { rando, meldStakingConfig } = await loadFixture(onlyDeployFixture);
      expect(
        await meldStakingConfig.hasRole(
          await meldStakingConfig.DEFAULT_ADMIN_ROLE(),
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
          slashReceiver,
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

        // Initialize storage (only this is needed for now)

        const addressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        await meldStakingStorage.initialize(addressProviderAddress);

        // Initialize config

        const initTimestamp = (await time.latest()) + 1000;
        const epochSize = 5 * 24 * 60 * 60; // 5 days
        const slashReceiverAddress = slashReceiver.address;

        await expect(
          meldStakingConfig.initialize(
            initTimestamp,
            epochSize,
            slashReceiverAddress,
            addressProviderAddress
          )
        )
          .to.emit(meldStakingConfig, "Initialized")
          .withArgs(
            deployer.address,
            initTimestamp,
            epochSize,
            slashReceiverAddress,
            addressProviderAddress
          );
      });

      it("Should have the initial values correctly set", async function () {
        const {
          slashReceiver,
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

        // Initialize storage (only this is needed for now)

        const addressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        await meldStakingStorage.initialize(addressProviderAddress);

        // Initialize config

        const initTimestamp = (await time.latest()) + 1000;
        const epochSize = 5 * 24 * 60 * 60; // 5 days
        const slashReceiverAddress = slashReceiver.address;

        await meldStakingConfig.initialize(
          initTimestamp,
          epochSize,
          slashReceiverAddress,
          addressProviderAddress
        );

        expect(await meldStakingStorage.getInitTimestamp()).to.equal(
          initTimestamp
        );
        expect(await meldStakingStorage.getEpochSize()).to.equal(epochSize);
        expect(await meldStakingStorage.slashReceiver()).to.equal(
          slashReceiverAddress
        );
        expect(await meldStakingStorage.isStakingStarted()).to.be.false;

        await time.increaseTo(initTimestamp + 1);
        expect(await meldStakingStorage.isStakingStarted()).to.be.true;
      });
    }); // End of Initialize Happy flow test cases

    context("Error test cases", function () {
      it("Should revert when trying to initialize twice", async function () {
        const {
          slashReceiver,
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

        // Initialize storage (only this is needed for now)

        const addressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        await meldStakingStorage.initialize(addressProviderAddress);

        // Initialize config

        const initTimestamp = (await time.latest()) + 1000;
        const epochSize = 5 * 24 * 60 * 60; // 5 days
        const slashReceiverAddress = slashReceiver.address;

        await meldStakingConfig.initialize(
          initTimestamp,
          epochSize,
          slashReceiverAddress,
          addressProviderAddress
        );

        await expect(
          meldStakingConfig.initialize(
            initTimestamp,
            epochSize,
            slashReceiverAddress,
            addressProviderAddress
          )
        ).to.be.revertedWith(Errors.ALREADY_CONFIGURED);
      });

      it("Should revert when trying to initialize before the address provider is initialized", async function () {
        const { slashReceiver, meldStakingAddressProvider, meldStakingConfig } =
          await loadFixture(onlyDeployFixture);

        const addressProviderAddress =
          await meldStakingAddressProvider.getAddress();

        // Initialize config

        const initTimestamp = (await time.latest()) + 1000;
        const epochSize = 5 * 24 * 60 * 60; // 5 days
        const slashReceiverAddress = slashReceiver.address;

        await expect(
          meldStakingConfig.initialize(
            initTimestamp,
            epochSize,
            slashReceiverAddress,
            addressProviderAddress
          )
        ).to.be.revertedWith(Errors.ADDRESS_PROVIDER_NOT_INITIALIZED);
      });
      it("Should revert when trying to initialize before the storage is initialized", async function () {
        const {
          slashReceiver,
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

        // Initialize config

        const initTimestamp = (await time.latest()) + 1000;
        const epochSize = 5 * 24 * 60 * 60; // 5 days
        const slashReceiverAddress = slashReceiver.address;

        await expect(
          meldStakingConfig.initialize(
            initTimestamp,
            epochSize,
            slashReceiverAddress,
            addressProviderAddress
          )
        ).to.be.revertedWith(Errors.CALLER_NOT_CONFIG);
      });
      it("Should not initialize if called by a non-admin", async function () {
        const {
          rando,
          slashReceiver,
          meldStakingAddressProvider,
          meldStakingConfig,
        } = await loadFixture(onlyDeployFixture);

        // Initialize config

        const initTimestamp = (await time.latest()) + 1000;
        const epochSize = 5 * 24 * 60 * 60; // 5 days
        const slashReceiverAddress = slashReceiver.address;

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

        await expect(
          meldStakingConfig
            .connect(rando)
            .initialize(
              initTimestamp,
              epochSize,
              slashReceiverAddress,
              await meldStakingAddressProvider.getAddress()
            )
        ).to.be.revertedWith(expectedException);
      });
      it("Should not initialize if the init timestamp is in the past", async function () {
        const { slashReceiver, meldStakingAddressProvider, meldStakingConfig } =
          await loadFixture(onlyDeployFixture);

        // Initialize config

        const initTimestamp = (await time.latest()) - 1000;
        const epochSize = 5 * 24 * 60 * 60; // 5 days
        const slashReceiverAddress = slashReceiver.address;

        await expect(
          meldStakingConfig.initialize(
            initTimestamp,
            epochSize,
            slashReceiverAddress,
            await meldStakingAddressProvider.getAddress()
          )
        ).to.be.revertedWith(Errors.INVALID_INIT_TIMESTAMP);
      });
      it("Should not initialize if the epoch size is 0", async function () {
        const { slashReceiver, meldStakingAddressProvider, meldStakingConfig } =
          await loadFixture(onlyDeployFixture);

        // Initialize config

        const initTimestamp = (await time.latest()) + 1000;
        const epochSize = 0;
        const slashReceiverAddress = slashReceiver.address;

        await expect(
          meldStakingConfig.initialize(
            initTimestamp,
            epochSize,
            slashReceiverAddress,
            await meldStakingAddressProvider.getAddress()
          )
        ).to.be.revertedWith(Errors.INVALID_EPOCH_SIZE);
      });
      it("Should not initialize if the slash receiver is the zero address", async function () {
        const { meldStakingAddressProvider, meldStakingConfig } =
          await loadFixture(onlyDeployFixture);

        // Initialize config

        const initTimestamp = (await time.latest()) + 1000;
        const epochSize = 5 * 24 * 60 * 60; // 5 days
        const slashReceiverAddress = ZeroAddress;

        await expect(
          meldStakingConfig.initialize(
            initTimestamp,
            epochSize,
            slashReceiverAddress,
            await meldStakingAddressProvider.getAddress()
          )
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);
      });
      it("Should not initialize if the address provider is the zero address", async function () {
        const { slashReceiver, meldStakingConfig } = await loadFixture(
          onlyDeployFixture
        );

        // Initialize config

        const initTimestamp = (await time.latest()) + 1000;
        const epochSize = 5 * 24 * 60 * 60; // 5 days
        const slashReceiverAddress = slashReceiver.address;

        await expect(
          meldStakingConfig.initialize(
            initTimestamp,
            epochSize,
            slashReceiverAddress,
            ZeroAddress
          )
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);
      });
    }); // End of Initialize Error test cases
  }); // End of Initialize context

  context("Setters", function () {
    context("setMinStakingAmount", function () {
      context("Happy flow test cases", function () {
        it("Should emit an event when the min staking amount is set", async function () {
          const { deployer, meldStakingConfig, meldStakingStorage } =
            await loadFixture(deployAndInitializeFixture);

          const oldMinStakingAmount =
            await meldStakingStorage.getMinStakingAmount();

          const minStakingAmount = toMeldDecimals(110_000);
          await expect(meldStakingConfig.setMinStakingAmount(minStakingAmount))
            .to.emit(meldStakingConfig, "MinStakingAmountUpdated")
            .withArgs(deployer.address, oldMinStakingAmount, minStakingAmount);
        });
        it("Should have the min staking amount correctly set", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount = toMeldDecimals(110_000);
          await meldStakingConfig.setMinStakingAmount(minStakingAmount);

          expect(await meldStakingStorage.getMinStakingAmount()).to.equal(
            minStakingAmount
          );
        });
      }); // End of setMinStakingAmount Happy flow test cases

      context("Error test cases", function () {
        it("Should revert if called by a non-admin", async function () {
          const { rando, meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount = toMeldDecimals(110_000);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .setMinStakingAmount(minStakingAmount)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the min staking amount is greater than the max staking amount", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const maxStakingAmount =
            await meldStakingStorage.getMaxStakingAmount();

          const minStakingAmount = maxStakingAmount + 1n;

          await expect(
            meldStakingConfig.setMinStakingAmount(minStakingAmount)
          ).to.be.revertedWith(Errors.MIN_STAKING_AMOUNT_GREATER_THAN_MAX);
        });
      }); // End of setMinStakingAmount Error test cases
    }); // End of setMinStakingAmount context

    context("setMaxStakingAmount", function () {
      context("Happy flow test cases", function () {
        it("Should emit an event when the max staking amount is set", async function () {
          const { deployer, meldStakingConfig, meldStakingStorage } =
            await loadFixture(deployAndInitializeFixture);

          const oldMaxStakingAmount =
            await meldStakingStorage.getMaxStakingAmount();

          const maxStakingAmount = toMeldDecimals(30_000_000);
          await expect(meldStakingConfig.setMaxStakingAmount(maxStakingAmount))
            .to.emit(meldStakingConfig, "MaxStakingAmountUpdated")
            .withArgs(deployer.address, oldMaxStakingAmount, maxStakingAmount);
        });
        it("Should have the max staking amount correctly set", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const maxStakingAmount = toMeldDecimals(30_000_000);
          await meldStakingConfig.setMaxStakingAmount(maxStakingAmount);

          expect(await meldStakingStorage.getMaxStakingAmount()).to.equal(
            maxStakingAmount
          );
        });
      }); // End of setMaxStakingAmount Happy flow test cases

      context("Error test cases", function () {
        it("Should revert if called by a non-admin", async function () {
          const { rando, meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const maxStakingAmount = toMeldDecimals(30_000_000);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .setMaxStakingAmount(maxStakingAmount)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the max staking amount is less than the min staking amount", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount =
            await meldStakingStorage.getMinStakingAmount();

          const maxStakingAmount = minStakingAmount - 1n;

          await expect(
            meldStakingConfig.setMaxStakingAmount(maxStakingAmount)
          ).to.be.revertedWith(Errors.MAX_STAKING_AMOUNT_LESS_THAN_MIN);
        });
      }); // End of setMaxStakingAmount Error test cases
    }); // End of setMaxStakingAmount context

    context("setMinDelegationFee", function () {
      context("Happy flow test cases", function () {
        it("Should emit an event when the min delegation fee is set", async function () {
          const { deployer, meldStakingConfig, meldStakingStorage } =
            await loadFixture(deployAndInitializeFixture);

          const oldMinDelegationFee =
            await meldStakingStorage.getMinDelegationFee();

          const minDelegationFee = 10_00; // 10%
          await expect(meldStakingConfig.setMinDelegationFee(minDelegationFee))
            .to.emit(meldStakingConfig, "MinDelegationFeeUpdated")
            .withArgs(deployer.address, oldMinDelegationFee, minDelegationFee);
        });
        it("Should have the min delegation fee correctly set", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const minDelegationFee = 10_00; // 10%
          await meldStakingConfig.setMinDelegationFee(minDelegationFee);

          expect(await meldStakingStorage.getMinDelegationFee()).to.equal(
            minDelegationFee
          );
        });
      }); // End of setMinDelegationFee Happy flow test cases

      context("Error test cases", function () {
        it("Should revert if called by a non-admin", async function () {
          const { rando, meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const minDelegationFee = 10_00; // 10%

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .setMinDelegationFee(minDelegationFee)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the min delegation fee is greater than the max delegation fee", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const maxDelegationFee =
            await meldStakingStorage.getMaxDelegationFee();

          const minDelegationFee = maxDelegationFee + 1n;

          await expect(
            meldStakingConfig.setMinDelegationFee(minDelegationFee)
          ).to.be.revertedWith(Errors.MIN_FEE_GREATER_THAN_MAX);
        });
      });
    }); // End of setMinDelegationFee context

    context("setMaxDelegationFee", function () {
      context("Happy flow test cases", function () {
        it("Should emit an event when the max delegation fee is set", async function () {
          const { deployer, meldStakingConfig, meldStakingStorage } =
            await loadFixture(deployAndInitializeFixture);

          const oldMaxDelegationFee =
            await meldStakingStorage.getMaxDelegationFee();

          const maxDelegationFee = 10_00; // 10%
          await expect(meldStakingConfig.setMaxDelegationFee(maxDelegationFee))
            .to.emit(meldStakingConfig, "MaxDelegationFeeUpdated")
            .withArgs(deployer.address, oldMaxDelegationFee, maxDelegationFee);
        });
        it("Should have the max delegation fee correctly set", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const maxDelegationFee = 10_00; // 10%
          await meldStakingConfig.setMaxDelegationFee(maxDelegationFee);

          expect(await meldStakingStorage.getMaxDelegationFee()).to.equal(
            maxDelegationFee
          );
        });
      }); // End of setMaxDelegationFee Happy flow test cases

      context("Error test cases", function () {
        it("Should revert if called by a non-admin", async function () {
          const { rando, meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const maxDelegationFee = 10_00; // 10%

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .setMaxDelegationFee(maxDelegationFee)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the max delegation fee is less than the min delegation fee", async function () {
          const { meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const minDelegationFee = 30_00n; // 30%

          await meldStakingConfig.setMinDelegationFee(minDelegationFee);

          const maxDelegationFee = minDelegationFee - 1n;

          await expect(
            meldStakingConfig.setMaxDelegationFee(maxDelegationFee)
          ).to.be.revertedWith(Errors.MAX_FEE_LESS_THAN_MIN);
        });
        it("Should revert if the max delegation fee is greater than 100%", async function () {
          const { meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const maxDelegationFee = 100_01; // 100.01%

          await expect(
            meldStakingConfig.setMaxDelegationFee(maxDelegationFee)
          ).to.be.revertedWith(Errors.MAX_FEE_LESS_THAN_100);
        });
      }); // End of setMaxDelegationFee Error test cases
    }); // End of setMaxDelegationFee context

    context("setSlashReceiver", function () {
      context("Happy flow test cases", function () {
        it("Should emit an event when the slash receiver is set", async function () {
          const { deployer, rando, meldStakingConfig, meldStakingStorage } =
            await loadFixture(deployAndInitializeFixture);

          const oldSlashReceiver = await meldStakingStorage.slashReceiver();

          await expect(meldStakingConfig.setSlashReceiver(rando.address))
            .to.emit(meldStakingConfig, "SlashReceiverUpdated")
            .withArgs(deployer.address, oldSlashReceiver, rando.address);
        });
        it("Should have the slash receiver correctly set", async function () {
          const { rando, meldStakingConfig, meldStakingStorage } =
            await loadFixture(deployAndInitializeFixture);

          await meldStakingConfig.setSlashReceiver(rando.address);

          expect(await meldStakingStorage.slashReceiver()).to.equal(
            rando.address
          );
        });
      }); // End of setSlashReceiver Happy flow test cases

      context("Error test cases", function () {
        it("Should revert if called by a non-admin", async function () {
          const { rando, meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig.connect(rando).setSlashReceiver(rando.address)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the slash receiver is the zero address", async function () {
          const { meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          await expect(
            meldStakingConfig.setSlashReceiver(ZeroAddress)
          ).to.be.revertedWith(Errors.INVALID_ADDRESS);
        });
      }); // End of setSlashReceiver Error test cases
    }); // End of setSlashReceiver context
  }); // End of Setters context

  context("Staking tiers", function () {
    context("addStakingLockTier", function () {
      context("Happy flow test cases", function () {
        it("Should emit an event when a staking tier is added", async function () {
          const { deployer, meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount = toMeldDecimals(110_000);
          const stakingLength = 10; // 10 epochs
          const weight = 120_00; // 120%

          const expectedLockTierId = 1;

          await expect(
            meldStakingConfig.addStakingLockTier(
              minStakingAmount,
              stakingLength,
              weight
            )
          )
            .to.emit(meldStakingConfig, "StakingLockTierAdded")
            .withArgs(
              deployer.address,
              expectedLockTierId,
              minStakingAmount,
              stakingLength,
              weight
            );
        });
        it("Should have the staking tier correctly set", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount = toMeldDecimals(110_000);
          const stakingLength = 10; // 10 epochs
          const weight = 120_00; // 120%

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.be.empty;

          await meldStakingConfig.addStakingLockTier(
            minStakingAmount,
            stakingLength,
            weight
          );

          const lockTierId = await meldStakingStorage.lastLockStakingTierId();

          const stakingTier = await meldStakingStorage.getLockStakingTier(
            lockTierId
          );

          expect(stakingTier.minStakingAmount).to.equal(minStakingAmount);
          expect(stakingTier.stakingLength).to.equal(stakingLength);
          expect(stakingTier.weight).to.equal(weight);
          expect(stakingTier.active).to.be.true;

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.eql([lockTierId]);
        });
        it("Should have the staking tier correctly set when adding multiple tiers", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount1 = toMeldDecimals(110_000);
          const stakingLength1 = 10; // 10 epochs
          const weight1 = 120_00; // 120%

          const minStakingAmount2 = toMeldDecimals(220_000);
          const stakingLength2 = 20; // 20 epochs
          const weight2 = 130_00; // 130%

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.be.empty;

          await meldStakingConfig.addStakingLockTier(
            minStakingAmount1,
            stakingLength1,
            weight1
          );

          const lockTierId1 = await meldStakingStorage.lastLockStakingTierId();

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.eql([lockTierId1]);

          await meldStakingConfig.addStakingLockTier(
            minStakingAmount2,
            stakingLength2,
            weight2
          );
          const lockTierId2 = await meldStakingStorage.lastLockStakingTierId();

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.eql([lockTierId1, lockTierId2]);

          const stakingTier1 = await meldStakingStorage.getLockStakingTier(
            lockTierId1
          );
          const stakingTier2 = await meldStakingStorage.getLockStakingTier(
            lockTierId2
          );

          expect(stakingTier1.minStakingAmount).to.equal(minStakingAmount1);
          expect(stakingTier1.stakingLength).to.equal(stakingLength1);
          expect(stakingTier1.weight).to.equal(weight1);
          expect(stakingTier1.active).to.be.true;
          expect(stakingTier2.minStakingAmount).to.equal(minStakingAmount2);
          expect(stakingTier2.stakingLength).to.equal(stakingLength2);
          expect(stakingTier2.weight).to.equal(weight2);
          expect(stakingTier2.active).to.be.true;
        });
      }); // End of addStakingLockTier Happy flow test cases

      context("Error test cases", function () {
        it("Should revert if called by a non-admin", async function () {
          const { rando, meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount = toMeldDecimals(110_000);
          const stakingLength = 10; // 10 epochs
          const weight = 120_00; // 120%

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .addStakingLockTier(minStakingAmount, stakingLength, weight)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the min staking amount is higher than the max staking amount", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const maxStakingAmount =
            await meldStakingStorage.getMaxStakingAmount();

          const minStakingAmount = maxStakingAmount + 1n;
          const stakingLength = 10; // 10 epochs
          const weight = 120_00; // 120%

          await expect(
            meldStakingConfig.addStakingLockTier(
              minStakingAmount,
              stakingLength,
              weight
            )
          ).to.be.revertedWith(
            Errors.STAKING_TIER_MIN_STAKING_AMOUNT_HIGHER_THAN_GLOBAL_MAX
          );
        });
        it("Should revert if the staking length is 0", async function () {
          const { meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount = toMeldDecimals(110_000);
          const stakingLength = 0; // 0 epochs
          const weight = 120_00; // 120%

          await expect(
            meldStakingConfig.addStakingLockTier(
              minStakingAmount,
              stakingLength,
              weight
            )
          ).to.be.revertedWith(Errors.STAKING_TIER_LENGTH_ZERO);
        });
        it("Should revert if the weight is not greater than 100%", async function () {
          const { meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount = toMeldDecimals(110_000);
          const stakingLength = 10; // 10 epochs
          const weight = 100_00; // 100%

          await expect(
            meldStakingConfig.addStakingLockTier(
              minStakingAmount,
              stakingLength,
              weight
            )
          ).to.be.revertedWith(Errors.STAKING_TIER_WEIGHT_BELOW_100);
        });
      }); // End of addStakingLockTier Error test cases
    }); // End of addStakingLockTier context

    context("removeStakingLockTier", function () {
      context("Happy flow test cases", function () {
        it("Should emit an event when a staking tier is removed", async function () {
          const { deployer, meldStakingConfig, meldStakingStorage } =
            await loadFixture(deployAndInitializeFixture);

          const minStakingAmount = toMeldDecimals(110_000);
          const stakingLength = 10; // 10 epochs
          const weight = 120_00; // 120%

          await meldStakingConfig.addStakingLockTier(
            minStakingAmount,
            stakingLength,
            weight
          );

          const lockTierId = await meldStakingStorage.lastLockStakingTierId();

          await expect(meldStakingConfig.removeStakingLockTier(lockTierId))
            .to.emit(meldStakingConfig, "StakingLockTierRemoved")
            .withArgs(deployer.address, lockTierId);
        });
        it("Should have the staking tier correctly removed", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount = toMeldDecimals(110_000);
          const stakingLength = 10; // 10 epochs
          const weight = 120_00; // 120%

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.be.empty;

          await meldStakingConfig.addStakingLockTier(
            minStakingAmount,
            stakingLength,
            weight
          );

          const lockTierId = await meldStakingStorage.lastLockStakingTierId();
          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.eql([lockTierId]);
          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId)
          ).to.be.true;

          await meldStakingConfig.removeStakingLockTier(lockTierId);

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.be.empty;

          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId)
          ).to.be.false;
        });

        it("Should have the staking tier correctly removed when removing multiple tiers", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount1 = toMeldDecimals(110_000);
          const stakingLength1 = 10; // 10 epochs
          const weight1 = 120_00; // 120%

          const minStakingAmount2 = toMeldDecimals(220_000);
          const stakingLength2 = 20; // 20 epochs
          const weight2 = 130_00; // 130%

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.be.empty;

          // Add tier 1
          await meldStakingConfig.addStakingLockTier(
            minStakingAmount1,
            stakingLength1,
            weight1
          );

          const lockTierId1 = await meldStakingStorage.lastLockStakingTierId();

          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId1)
          ).to.be.true;

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.eql([lockTierId1]);

          // Add tier 2
          await meldStakingConfig.addStakingLockTier(
            minStakingAmount2,
            stakingLength2,
            weight2
          );

          const lockTierId2 = await meldStakingStorage.lastLockStakingTierId();

          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId2)
          ).to.be.true;

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.eql([lockTierId1, lockTierId2]);

          // Remove tier 1
          await meldStakingConfig.removeStakingLockTier(lockTierId1);

          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId1)
          ).to.be.false;
          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId2)
          ).to.be.true;

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.eql([lockTierId2]);

          // Remove tier 2
          await meldStakingConfig.removeStakingLockTier(lockTierId2);

          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId2)
          ).to.be.false;

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.be.empty;
        });
        it("Should have the staking tier correctly removed when removing multiple tiers in reverse order", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount1 = toMeldDecimals(110_000);
          const stakingLength1 = 10; // 10 epochs
          const weight1 = 120_00; // 120%

          const minStakingAmount2 = toMeldDecimals(220_000);
          const stakingLength2 = 20; // 20 epochs
          const weight2 = 130_00; // 130%

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.be.empty;

          // Add tier 1
          await meldStakingConfig.addStakingLockTier(
            minStakingAmount1,
            stakingLength1,
            weight1
          );

          const lockTierId1 = await meldStakingStorage.lastLockStakingTierId();

          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId1)
          ).to.be.true;

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.eql([lockTierId1]);

          // Add tier 2
          await meldStakingConfig.addStakingLockTier(
            minStakingAmount2,
            stakingLength2,
            weight2
          );

          const lockTierId2 = await meldStakingStorage.lastLockStakingTierId();

          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId2)
          ).to.be.true;

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.eql([lockTierId1, lockTierId2]);

          // Remove tier 2
          await meldStakingConfig.removeStakingLockTier(lockTierId2);

          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId2)
          ).to.be.false;

          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId1)
          ).to.be.true;

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.eql([lockTierId1]);

          // Remove tier 1
          await meldStakingConfig.removeStakingLockTier(lockTierId1);

          expect(
            await meldStakingStorage.isActiveLockStakingTierId(lockTierId1)
          ).to.be.false;

          expect(
            await meldStakingStorage.getActiveLockStakingTierIdList()
          ).to.be.empty;
        });
      }); // End of removeStakingLockTier Happy flow test cases

      context("Error test cases", function () {
        it("Should revert if called by a non-admin", async function () {
          const { rando, meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig.connect(rando).removeStakingLockTier(1)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the staking tier id does not exist", async function () {
          const { meldStakingConfig } = await loadFixture(
            deployAndInitializeFixture
          );

          await expect(
            meldStakingConfig.removeStakingLockTier(1)
          ).to.be.revertedWith(Errors.STAKING_TIER_DOES_NOT_EXIST);
        });
        it("Should revert if the staking tier id has already been removed", async function () {
          const { meldStakingConfig, meldStakingStorage } = await loadFixture(
            deployAndInitializeFixture
          );

          const minStakingAmount = toMeldDecimals(110_000);
          const stakingLength = 10; // 10 epochs
          const weight = 120_00; // 120%

          await meldStakingConfig.addStakingLockTier(
            minStakingAmount,
            stakingLength,
            weight
          );

          const lockTierId = await meldStakingStorage.lastLockStakingTierId();

          await meldStakingConfig.removeStakingLockTier(lockTierId);

          await expect(
            meldStakingConfig.removeStakingLockTier(lockTierId)
          ).to.be.revertedWith(Errors.STAKING_TIER_ALREADY_REMOVED);
        });
      }); // End of removeStakingLockTier Error test cases
    }); // End of removeStakingLockTier context
  }); // End of Staking tiers context

  context("Node config", function () {
    context("setMaxStakingAmountForNode", function () {
      context("Happy flow test cases", function () {
        it("Should emit the MaxStakingAmountForNodeUpdated event when setting the max staking amount for a node", async function () {
          const { deployer, meldStakingConfig, meldStakingStorage, nodeId } =
            await loadFixture(nodeStakedFixture);

          const oldMaxStakingAmount =
            await meldStakingStorage.getNodeMaxStakingAmount(nodeId);
          const newMaxStakingAmount = toMeldDecimals(500_000);
          await expect(
            meldStakingConfig
              .connect(deployer)
              .setMaxStakingAmountForNode(nodeId, newMaxStakingAmount)
          )
            .to.emit(meldStakingConfig, "MaxStakingAmountForNodeUpdated")
            .withArgs(
              deployer.address,
              nodeId,
              oldMaxStakingAmount,
              newMaxStakingAmount
            );
        });
        it("Should update the max staking amount for a node", async function () {
          const { deployer, meldStakingConfig, meldStakingStorage, nodeId } =
            await loadFixture(nodeStakedFixture);

          const newMaxStakingAmount = toMeldDecimals(500_000);
          await meldStakingConfig
            .connect(deployer)
            .setMaxStakingAmountForNode(nodeId, newMaxStakingAmount);
          const updatedMaxStakingAmount =
            await meldStakingStorage.getNodeMaxStakingAmount(nodeId);
          expect(updatedMaxStakingAmount).to.equal(newMaxStakingAmount);
        });
      }); // End of setMaxStakingAmountForNode Happy flow test cases

      context("Error test cases", function () {
        it("Should fail to set the max staking amount for a node if the caller is not the admin", async function () {
          const { rando, meldStakingConfig, nodeId } = await loadFixture(
            nodeStakedFixture
          );

          const fakeMaxStakingAmount = toMeldDecimals(500_000);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .setMaxStakingAmountForNode(nodeId, fakeMaxStakingAmount)
          ).to.be.revertedWith(expectedException);
        });
        it("Should fail to set the max staking amount for a node if the node is not active", async function () {
          const { deployer, meldStakingConfig } = await loadFixture(
            stakingStartedFixture
          );

          const fakeNodeId = ethers.ZeroHash;
          const fakeMaxStakingAmount = toMeldDecimals(500_000);

          await expect(
            meldStakingConfig
              .connect(deployer)
              .setMaxStakingAmountForNode(fakeNodeId, fakeMaxStakingAmount)
          ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
        });
        it("Should fail to set the max staking amount for a node if the max staking amount is less than the min", async function () {
          const { deployer, meldStakingConfig, meldStakingStorage, nodeId } =
            await loadFixture(nodeStakedFixture);

          const minStakingAmount =
            await meldStakingStorage.getMinStakingAmount();
          const fakeMaxStakingAmount = minStakingAmount - 1n;

          await expect(
            meldStakingConfig
              .connect(deployer)
              .setMaxStakingAmountForNode(nodeId, fakeMaxStakingAmount)
          ).to.be.revertedWith(Errors.MAX_STAKING_AMOUNT_LESS_THAN_MIN);
        });
      }); // End of setMaxStakingAmountForNode Error test cases
    }); // End of setMaxStakingAmountForNode context

    context("toggleDelegatorWhitelist", function () {
      context("Happy flow test cases", function () {
        it("Should emit the NodeDelegatorWhitlistToggled event when toggling the delegator whitelist for a node to true", async function () {
          const { deployer, meldStakingConfig, nodeId } = await loadFixture(
            nodeStakedFixture
          );

          await expect(
            meldStakingConfig
              .connect(deployer)
              .toggleDelegatorWhitelist(nodeId, true)
          )
            .to.emit(meldStakingConfig, "NodeDelegatorWhitlistToggled")
            .withArgs(deployer.address, nodeId, true);
        });
        it("Should emit the NodeDelegatorWhitlistToggled event when toggling the delegator whitelist for a node to false", async function () {
          const { deployer, meldStakingConfig, nodeId } = await loadFixture(
            nodeStakedFixture
          );

          await expect(
            meldStakingConfig
              .connect(deployer)
              .toggleDelegatorWhitelist(nodeId, false)
          )
            .to.emit(meldStakingConfig, "NodeDelegatorWhitlistToggled")
            .withArgs(deployer.address, nodeId, false);
        });
        it("Should update the delegator whitelist for a node to true", async function () {
          const { deployer, meldStakingConfig, meldStakingStorage, nodeId } =
            await loadFixture(nodeStakedFixture);

          await meldStakingConfig
            .connect(deployer)
            .toggleDelegatorWhitelist(nodeId, true);
          const updatedDelegatorWhitelist =
            await meldStakingStorage.isDelegatorWhitelistEnabled(nodeId);
          expect(updatedDelegatorWhitelist).to.be.true;
        });
        it("Should update the delegator whitelist for a node to false", async function () {
          const { deployer, meldStakingConfig, meldStakingStorage, nodeId } =
            await loadFixture(nodeStakedFixture);

          await meldStakingConfig
            .connect(deployer)
            .toggleDelegatorWhitelist(nodeId, false);
          const updatedDelegatorWhitelist =
            await meldStakingStorage.isDelegatorWhitelistEnabled(nodeId);
          expect(updatedDelegatorWhitelist).to.be.false;
        });
      }); // End of toggleDelegatorWhitelist Happy flow test cases

      context("Error test cases", function () {
        it("Should fail to toggle the delegator whitelist for a node if the caller is not the admin", async function () {
          const { rando, meldStakingConfig, nodeId } = await loadFixture(
            nodeStakedFixture
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .toggleDelegatorWhitelist(nodeId, true)
          ).to.be.revertedWith(expectedException);
        });
        it("Should fail to toggle the delegator whitelist for a node if the node is not active", async function () {
          const { deployer, meldStakingConfig } = await loadFixture(
            stakingStartedFixture
          );

          const fakeNodeId = ethers.ZeroHash;

          await expect(
            meldStakingConfig
              .connect(deployer)
              .toggleDelegatorWhitelist(fakeNodeId, true)
          ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
        });
      }); // End of toggleDelegatorWhitelist Error test cases
    }); // End of toggleDelegatorWhitelist context

    context("addDelegatorToWhitelist", function () {
      context("Happy flow test cases", function () {
        it("Should emit the NodeDelegatorAddedToWhitelist event when adding a delegator to the whitelist", async function () {
          const { deployer, meldStakingConfig, rando, nodeId } =
            await loadFixture(nodeStakedFixture);

          await expect(
            meldStakingConfig
              .connect(deployer)
              .addDelegatorToWhitelist(nodeId, rando.address)
          )
            .to.emit(meldStakingConfig, "NodeDelegatorAddedToWhitelist")
            .withArgs(deployer.address, nodeId, rando.address);
        });
        it("Should add a delegator to the whitelist", async function () {
          const {
            deployer,
            meldStakingConfig,
            rando,
            meldStakingStorage,
            nodeId,
          } = await loadFixture(nodeStakedFixture);

          await meldStakingConfig
            .connect(deployer)
            .addDelegatorToWhitelist(nodeId, rando.address);
          expect(
            await meldStakingStorage.isNodeDelegatorWhitelisted(
              nodeId,
              rando.address
            )
          ).to.be.true;
        });
        it("Should add multiple delegators to the whitelist individually", async function () {
          const {
            deployer,
            meldStakingConfig,
            rando,
            rando2,
            meldStakingStorage,
            nodeId,
          } = await loadFixture(nodeStakedFixture);

          await meldStakingConfig
            .connect(deployer)
            .addDelegatorToWhitelist(nodeId, rando.address);
          expect(
            await meldStakingStorage.isNodeDelegatorWhitelisted(
              nodeId,
              rando.address
            )
          ).to.be.true;

          await meldStakingConfig
            .connect(deployer)
            .addDelegatorToWhitelist(nodeId, rando2.address);
          expect(
            await meldStakingStorage.isNodeDelegatorWhitelisted(
              nodeId,
              rando2.address
            )
          ).to.be.true;
        });
        it("Should add multiple delegators to the whitelist in a single transaction", async function () {
          const {
            deployer,
            meldStakingConfig,
            rando,
            rando2,
            meldStakingStorage,
            nodeId,
          } = await loadFixture(nodeStakedFixture);

          await meldStakingConfig
            .connect(deployer)
            .addDelegatorsToWhitelist(nodeId, [rando.address, rando2.address]);
          expect(
            await meldStakingStorage.isNodeDelegatorWhitelisted(
              nodeId,
              rando.address
            )
          ).to.be.true;
          expect(
            await meldStakingStorage.isNodeDelegatorWhitelisted(
              nodeId,
              rando2.address
            )
          ).to.be.true;
        });
      }); // End of addDelegatorToWhitelist Happy flow test cases

      context("Error test cases", function () {
        it("Should fail to add a delegator to the whitelist if the caller is not the admin", async function () {
          const { rando, meldStakingConfig, nodeId } = await loadFixture(
            nodeStakedFixture
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .addDelegatorToWhitelist(nodeId, rando.address)
          ).to.be.revertedWith(expectedException);
        });
        it("Should fail to add multiple delegators in batch to the whitelist if the caller is not the admin", async function () {
          const { rando, rando2, meldStakingConfig, nodeId } =
            await loadFixture(nodeStakedFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .addDelegatorsToWhitelist(nodeId, [rando.address, rando2.address])
          ).to.be.revertedWith(expectedException);
        });
        it("Should fail to add a delegator to the whitelist if the node is not active", async function () {
          const { deployer, meldStakingConfig, rando } = await loadFixture(
            stakingStartedFixture
          );

          const fakeNodeId = ethers.ZeroHash;

          await expect(
            meldStakingConfig
              .connect(deployer)
              .addDelegatorToWhitelist(fakeNodeId, rando.address)
          ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
        });
        it("Should fail to add multiple delegators in batch to the whitelist if the node is not active", async function () {
          const { deployer, meldStakingConfig, rando, rando2 } =
            await loadFixture(stakingStartedFixture);

          const fakeNodeId = ethers.ZeroHash;

          await expect(
            meldStakingConfig
              .connect(deployer)
              .addDelegatorsToWhitelist(fakeNodeId, [
                rando.address,
                rando2.address,
              ])
          ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
        });
      }); // End of addDelegatorToWhitelist Error test cases
    }); // End of addDelegatorToWhitelist context

    context("removeDelegatorFromWhitelist", function () {
      context("Happy flow test cases", function () {
        it("Should emit the NodeDelegatorRemovedFromWhitelist event when removing a delegator from the whitelist", async function () {
          const { deployer, meldStakingConfig, rando, nodeId } =
            await loadFixture(nodeStakedFixture);

          await meldStakingConfig
            .connect(deployer)
            .addDelegatorToWhitelist(nodeId, rando.address);

          await expect(
            meldStakingConfig
              .connect(deployer)
              .removeDelegatorFromWhitelist(nodeId, rando.address)
          )
            .to.emit(meldStakingConfig, "NodeDelegatorRemovedFromWhitelist")
            .withArgs(deployer.address, nodeId, rando.address);
        });
        it("Should remove a delegator from the whitelist", async function () {
          const {
            deployer,
            meldStakingConfig,
            rando,
            meldStakingStorage,
            nodeId,
          } = await loadFixture(nodeStakedFixture);

          await meldStakingConfig
            .connect(deployer)
            .addDelegatorToWhitelist(nodeId, rando.address);

          await meldStakingConfig
            .connect(deployer)
            .removeDelegatorFromWhitelist(nodeId, rando.address);

          expect(
            await meldStakingStorage.isNodeDelegatorWhitelisted(
              nodeId,
              rando.address
            )
          ).to.be.false;
        });
        it("Should remove multiple delegators from the whitelist individually", async function () {
          const {
            deployer,
            meldStakingConfig,
            rando,
            rando2,
            meldStakingStorage,
            nodeId,
          } = await loadFixture(nodeStakedFixture);

          await meldStakingConfig
            .connect(deployer)
            .addDelegatorToWhitelist(nodeId, rando.address);
          await meldStakingConfig
            .connect(deployer)
            .addDelegatorToWhitelist(nodeId, rando2.address);

          await meldStakingConfig
            .connect(deployer)
            .removeDelegatorFromWhitelist(nodeId, rando.address);
          expect(
            await meldStakingStorage.isNodeDelegatorWhitelisted(
              nodeId,
              rando.address
            )
          ).to.be.false;

          await meldStakingConfig
            .connect(deployer)
            .removeDelegatorFromWhitelist(nodeId, rando2.address);
          expect(
            await meldStakingStorage.isNodeDelegatorWhitelisted(
              nodeId,
              rando2.address
            )
          ).to.be.false;
        });
        it("Should remove multiple delegators from the whitelist in a single transaction", async function () {
          const {
            deployer,
            meldStakingConfig,
            rando,
            rando2,
            meldStakingStorage,
            nodeId,
          } = await loadFixture(nodeStakedFixture);

          await meldStakingConfig
            .connect(deployer)
            .addDelegatorToWhitelist(nodeId, rando.address);
          await meldStakingConfig
            .connect(deployer)
            .addDelegatorToWhitelist(nodeId, rando2.address);

          await meldStakingConfig
            .connect(deployer)
            .removeDelegatorsFromWhitelist(nodeId, [
              rando.address,
              rando2.address,
            ]);
          expect(
            await meldStakingStorage.isNodeDelegatorWhitelisted(
              nodeId,
              rando.address
            )
          ).to.be.false;
          expect(
            await meldStakingStorage.isNodeDelegatorWhitelisted(
              nodeId,
              rando2.address
            )
          ).to.be.false;
        });
      }); // End of removeDelegatorFromWhitelist Happy flow test cases

      context("Error test cases", function () {
        it("Should fail to remove a delegator from the whitelist if the caller is not the admin", async function () {
          const { rando, meldStakingConfig, nodeId } = await loadFixture(
            nodeStakedFixture
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .removeDelegatorFromWhitelist(nodeId, rando.address)
          ).to.be.revertedWith(expectedException);
        });
        it("Should fail to remove multiple delegators in batch from the whitelist if the caller is not the admin", async function () {
          const { rando, rando2, meldStakingConfig, nodeId } =
            await loadFixture(nodeStakedFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldStakingConfig
              .connect(rando)
              .removeDelegatorsFromWhitelist(nodeId, [
                rando.address,
                rando2.address,
              ])
          ).to.be.revertedWith(expectedException);
        });
        it("Should fail to remove a delegator from the whitelist if the node is not active", async function () {
          const { deployer, meldStakingConfig, rando } = await loadFixture(
            stakingStartedFixture
          );

          const fakeNodeId = ethers.ZeroHash;

          await expect(
            meldStakingConfig
              .connect(deployer)
              .removeDelegatorFromWhitelist(fakeNodeId, rando.address)
          ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
        });
        it("Should fail to remove multiple delegators in batch from the whitelist if the node is not active", async function () {
          const { deployer, meldStakingConfig, rando, rando2 } =
            await loadFixture(stakingStartedFixture);

          const fakeNodeId = ethers.ZeroHash;

          await expect(
            meldStakingConfig
              .connect(deployer)
              .removeDelegatorsFromWhitelist(fakeNodeId, [
                rando.address,
                rando2.address,
              ])
          ).to.be.revertedWith(Errors.NODE_NOT_ACTIVE);
        });
      }); // End of removeDelegatorFromWhitelist Error test cases
    }); // End of removeDelegatorFromWhitelist context
  }); // End of Node config context

  context("Rewards", function () {
    context("Happy flow test cases", function () {
      it("Should emit the RewardsSet event when setting rewards", async function () {
        const {
          deployer,
          rewardsSetter,
          meldStakingConfig,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(stakingStartedFixture);

        const rewardsSetterRole = await meldStakingConfig.REWARDS_SETTER_ROLE();

        const expectedrewardsSetterRole = ethers.keccak256(
          ethers.toUtf8Bytes("REWARDS_SETTER_ROLE")
        );

        expect(rewardsSetterRole).to.equal(expectedrewardsSetterRole);

        await expect(
          meldStakingConfig
            .connect(deployer)
            .grantRole(rewardsSetterRole, rewardsSetter.address)
        )
          .to.emit(meldStakingConfig, "RoleGranted")
          .withArgs(rewardsSetterRole, rewardsSetter.address, deployer.address);

        const rewardAmount = toMeldDecimals(100_000);

        // Go to start of epoch 3 to able to set rewards for epoch 2
        // Note: No rewards can be set for epoch 1
        await time.increaseTo(await meldStakingStorage.getEpochStart(3n));
        const lastEpochRewardsUpdated =
          await meldStakingStorage.getLastEpochRewardsUpdated();

        const epoch = lastEpochRewardsUpdated + 1n;

        await transferAndApproveTokens(
          meldToken,
          deployer,
          rewardsSetter,
          await meldStakingNFT.getAddress(),
          rewardAmount
        );

        const setRewardsTx = await meldStakingConfig
          .connect(rewardsSetter)
          .setRewards(rewardAmount, epoch);

        await expect(setRewardsTx)
          .to.emit(meldStakingConfig, "RewardsSet")
          .withArgs(rewardsSetter.address, epoch, rewardAmount);

        await expect(setRewardsTx)
          .to.emit(meldStakingNFT, "MeldDeposited")
          .withArgs(rewardsSetter.address, rewardAmount);

        await expect(setRewardsTx)
          .to.emit(meldToken, "Transfer")
          .withArgs(
            rewardsSetter.address,
            await meldStakingNFT.getAddress(),
            rewardAmount
          );
      });
      it("Should set the rewards for an epoch", async function () {
        const {
          deployer,
          rewardsSetter,
          meldStakingConfig,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(rewardsFixture);

        const rewardAmount = toMeldDecimals(100_000);

        // Go to start of epoch 3 to able to set rewards for epoch 2
        // Note: No rewards can be set for epoch 1
        await time.increaseTo(await meldStakingStorage.getEpochStart(3n));
        const getLastEpochRewardsUpdated =
          await meldStakingStorage.getLastEpochRewardsUpdated();

        const epoch = getLastEpochRewardsUpdated + 1n;

        await transferAndApproveTokens(
          meldToken,
          deployer,
          rewardsSetter,
          await meldStakingNFT.getAddress(),
          rewardAmount
        );

        await meldStakingConfig
          .connect(rewardsSetter)
          .setRewards(rewardAmount, epoch);

        expect(
          await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
        ).to.equal(rewardAmount);
        expect(
          await meldStakingStorage.getTotalRewardsPerEpoch(epoch - 1n)
        ).to.equal(0n);
        expect(
          await meldStakingStorage.getTotalRewardsPerEpoch(epoch + 1n)
        ).to.equal(0n);
        expect(
          await meldToken.balanceOf(await meldStakingNFT.getAddress())
        ).to.equal(rewardAmount);
        expect(await meldStakingNFT.lockedMeldTokens()).to.equal(rewardAmount);
      });
      it("Should set the rewards for multiple epochs", async function () {
        const {
          deployer,
          rewardsSetter,
          meldStakingConfig,
          meldStakingStorage,
          meldStakingNFT,
          meldToken,
        } = await loadFixture(rewardsFixture);

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

        await time.increaseTo(
          await meldStakingStorage.getEpochStart(
            lastEpochRewardsUpdated + numEpochs + 1n
          )
        );
        const firstEpoch = lastEpochRewardsUpdated + 1n;
        for (let index = 0; index < rewardAmounts.length; index++) {
          const epoch = firstEpoch + BigInt(index);
          await meldStakingConfig
            .connect(rewardsSetter)
            .setRewards(rewardAmounts[index], epoch);
          expect(
            await meldStakingStorage.getTotalRewardsPerEpoch(epoch)
          ).to.equal(rewardAmounts[index]);
        }
        expect(
          await meldToken.balanceOf(await meldStakingNFT.getAddress())
        ).to.equal(sumRewards);
        expect(await meldStakingNFT.lockedMeldTokens()).to.equal(sumRewards);
      });
    }); // End of Rewards Happy flow test cases

    context("Error test cases", function () {
      it("Should fail to set the rewards for an epoch if the caller is not the rewards setter", async function () {
        const { rando, meldStakingConfig, meldStakingStorage } =
          await loadFixture(rewardsFixture);

        const rewardAmount = toMeldDecimals(100_000);

        // Go to start of epoch 3 to able to set rewards for epoch 2
        // Note: No rewards can be set for epoch 1
        await time.increaseTo(await meldStakingStorage.getEpochStart(3n));
        const getLastEpochRewardsUpdated =
          await meldStakingStorage.getLastEpochRewardsUpdated();

        const epoch = getLastEpochRewardsUpdated + 1n;

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingConfig.REWARDS_SETTER_ROLE()}`;
        await expect(
          meldStakingConfig.connect(rando).setRewards(rewardAmount, epoch)
        ).to.be.revertedWith(expectedException);
      });
      it("Should fail to set the rewards for an epoch if the epoch is in the future", async function () {
        const { rewardsSetter, meldStakingConfig, meldStakingStorage } =
          await loadFixture(rewardsFixture);

        const rewardAmount = toMeldDecimals(100_000);

        const getLastEpochRewardsUpdated =
          await meldStakingStorage.getLastEpochRewardsUpdated();

        // We're  currently in epoch 1, so we can't set rewards for epoch 2
        const epoch = getLastEpochRewardsUpdated + 1n;

        await expect(
          meldStakingConfig
            .connect(rewardsSetter)
            .setRewards(rewardAmount, epoch)
        ).to.be.revertedWith(Errors.REWARDS_CURRENT_OR_FUTURE_EPOCH);
      });
      it("Should fail to set the rewards for an epoch skipping epochs without rewards", async function () {
        const { rewardsSetter, meldStakingConfig, meldStakingStorage } =
          await loadFixture(rewardsFixture);

        const rewardAmount = toMeldDecimals(100_000);

        await time.increaseTo(await meldStakingStorage.getEpochStart(5n));

        // It is not allowed to set rewards for epoch 3, since epoch 2 has no rewards
        const epoch = 3n;

        await expect(
          meldStakingConfig
            .connect(rewardsSetter)
            .setRewards(rewardAmount, epoch)
        ).to.be.revertedWith(Errors.REWARDS_INVALID_EPOCH);
      });
    }); // End of Rewards Error test cases
  }); // End of Rewards context
});
