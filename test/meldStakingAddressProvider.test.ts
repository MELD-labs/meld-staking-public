import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployContracts } from "./utils/utils";
import { ZeroAddress } from "ethers";
import { Errors } from "./utils/errors";

describe("MeldStakingAddressProvider", function () {
  async function onlyDeployFixture() {
    const [deployer, rando] = await ethers.getSigners();
    const contracts = await deployContracts(deployer.address);
    return { deployer, rando, ...contracts };
  }

  context("Admin", function () {
    it("Should have granted the DEFAULT_ADMIN_ROLE to the deployer", async function () {
      const { deployer, meldStakingAddressProvider } = await loadFixture(
        onlyDeployFixture
      );
      expect(
        await meldStakingAddressProvider.hasRole(
          await meldStakingAddressProvider.DEFAULT_ADMIN_ROLE(),
          deployer.address
        )
      ).to.be.true;
    });
    it("Should not have granted the DEFAULT_ADMIN_ROLE to any other address", async function () {
      const { rando, meldStakingAddressProvider } = await loadFixture(
        onlyDeployFixture
      );
      expect(
        await meldStakingAddressProvider.hasRole(
          await meldStakingAddressProvider.DEFAULT_ADMIN_ROLE(),
          rando.address
        )
      ).to.be.false;
    });
  }); // End of Admin

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

        const meldTokenAddress = await meldToken.getAddress();
        const meldStakingNFTAddress = await meldStakingNFT.getAddress();
        const meldStakingCommonAddress = await meldStakingCommon.getAddress();
        const meldStakingOperatorAddress =
          await meldStakingOperator.getAddress();
        const meldStakingDelegatorAddress =
          await meldStakingDelegator.getAddress();
        const meldStakingConfigAddress = await meldStakingConfig.getAddress();
        const meldStakingStorageAddress = await meldStakingStorage.getAddress();
        await expect(
          meldStakingAddressProvider.initialize(
            meldTokenAddress,
            meldStakingNFTAddress,
            meldStakingCommonAddress,
            meldStakingOperatorAddress,
            meldStakingDelegatorAddress,
            meldStakingConfigAddress,
            meldStakingStorageAddress
          )
        )
          .to.emit(meldStakingAddressProvider, "Initialized")
          .withArgs(
            deployer.address,
            meldTokenAddress,
            meldStakingNFTAddress,
            meldStakingCommonAddress,
            meldStakingOperatorAddress,
            meldStakingDelegatorAddress,
            meldStakingConfigAddress,
            meldStakingStorageAddress
          );
      });
    }); // End of Happy flow test cases

    context("Error test cases", function () {
      it("Should not initialize if any address is zero address", async function () {
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

        const meldTokenAddress = await meldToken.getAddress();
        const meldStakingNFTAddress = await meldStakingNFT.getAddress();
        const meldStakingCommonAddress = await meldStakingCommon.getAddress();
        const meldStakingOperatorAddress =
          await meldStakingOperator.getAddress();
        const meldStakingDelegatorAddress =
          await meldStakingDelegator.getAddress();
        const meldStakingConfigAddress = await meldStakingConfig.getAddress();
        const meldStakingStorageAddress = await meldStakingStorage.getAddress();

        await expect(
          meldStakingAddressProvider.initialize(
            ZeroAddress,
            meldStakingNFTAddress,
            meldStakingCommonAddress,
            meldStakingOperatorAddress,
            meldStakingDelegatorAddress,
            meldStakingConfigAddress,
            meldStakingStorageAddress
          )
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);

        await expect(
          meldStakingAddressProvider.initialize(
            meldTokenAddress,
            ZeroAddress,
            meldStakingCommonAddress,
            meldStakingOperatorAddress,
            meldStakingDelegatorAddress,
            meldStakingConfigAddress,
            meldStakingStorageAddress
          )
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);

        await expect(
          meldStakingAddressProvider.initialize(
            meldTokenAddress,
            meldStakingNFTAddress,
            ZeroAddress,
            meldStakingOperatorAddress,
            meldStakingDelegatorAddress,
            meldStakingConfigAddress,
            meldStakingStorageAddress
          )
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);

        await expect(
          meldStakingAddressProvider.initialize(
            meldTokenAddress,
            meldStakingNFTAddress,
            meldStakingCommonAddress,
            ZeroAddress,
            meldStakingDelegatorAddress,
            meldStakingConfigAddress,
            meldStakingStorageAddress
          )
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);

        await expect(
          meldStakingAddressProvider.initialize(
            meldTokenAddress,
            meldStakingNFTAddress,
            meldStakingCommonAddress,
            meldStakingOperatorAddress,
            ZeroAddress,
            meldStakingConfigAddress,
            meldStakingStorageAddress
          )
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);

        await expect(
          meldStakingAddressProvider.initialize(
            meldTokenAddress,
            meldStakingNFTAddress,
            meldStakingCommonAddress,
            meldStakingOperatorAddress,
            meldStakingDelegatorAddress,
            ZeroAddress,
            meldStakingStorageAddress
          )
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);

        await expect(
          meldStakingAddressProvider.initialize(
            meldTokenAddress,
            meldStakingNFTAddress,
            meldStakingCommonAddress,
            meldStakingOperatorAddress,
            meldStakingDelegatorAddress,
            meldStakingConfigAddress,
            ZeroAddress
          )
        ).to.be.revertedWith(Errors.INVALID_ADDRESS);
      });
      it("Should not initialize if called by a non-admin", async function () {
        const {
          rando,
          meldStakingAddressProvider,
          meldToken,
          meldStakingNFT,
          meldStakingCommon,
          meldStakingOperator,
          meldStakingDelegator,
          meldStakingConfig,
          meldStakingStorage,
        } = await loadFixture(onlyDeployFixture);

        const meldTokenAddress = await meldToken.getAddress();
        const meldStakingNFTAddress = await meldStakingNFT.getAddress();
        const meldStakingCommonAddress = await meldStakingCommon.getAddress();
        const meldStakingOperatorAddress =
          await meldStakingOperator.getAddress();
        const meldStakingDelegatorAddress =
          await meldStakingDelegator.getAddress();
        const meldStakingConfigAddress = await meldStakingConfig.getAddress();
        const meldStakingStorageAddress = await meldStakingStorage.getAddress();

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await meldStakingAddressProvider.DEFAULT_ADMIN_ROLE()}`;

        await expect(
          meldStakingAddressProvider
            .connect(rando)
            .initialize(
              meldTokenAddress,
              meldStakingNFTAddress,
              meldStakingCommonAddress,
              meldStakingOperatorAddress,
              meldStakingDelegatorAddress,
              meldStakingConfigAddress,
              meldStakingStorageAddress
            )
        ).to.be.revertedWith(expectedException);
      });
      it("Should revert if already initialized", async function () {
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

        const meldTokenAddress = await meldToken.getAddress();
        const meldStakingNFTAddress = await meldStakingNFT.getAddress();
        const meldStakingCommonAddress = await meldStakingCommon.getAddress();
        const meldStakingOperatorAddress =
          await meldStakingOperator.getAddress();
        const meldStakingDelegatorAddress =
          await meldStakingDelegator.getAddress();
        const meldStakingConfigAddress = await meldStakingConfig.getAddress();
        const meldStakingStorageAddress = await meldStakingStorage.getAddress();

        await meldStakingAddressProvider
          .connect(deployer)
          .initialize(
            meldTokenAddress,
            meldStakingNFTAddress,
            meldStakingCommonAddress,
            meldStakingOperatorAddress,
            meldStakingDelegatorAddress,
            meldStakingConfigAddress,
            meldStakingStorageAddress
          );

        await expect(
          meldStakingAddressProvider
            .connect(deployer)
            .initialize(
              meldTokenAddress,
              meldStakingNFTAddress,
              meldStakingCommonAddress,
              meldStakingOperatorAddress,
              meldStakingDelegatorAddress,
              meldStakingConfigAddress,
              meldStakingStorageAddress
            )
        ).to.be.revertedWith(Errors.ALREADY_INITIALIZED);
      });
    }); // End of Error test cases
  }); // End of Initialize

  context("Getters", function () {
    it("Should get the correct address for the meldToken", async function () {
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

      const meldTokenAddress = await meldToken.getAddress();
      const meldStakingNFTAddress = await meldStakingNFT.getAddress();
      const meldStakingCommonAddress = await meldStakingCommon.getAddress();
      const meldStakingOperatorAddress = await meldStakingOperator.getAddress();
      const meldStakingDelegatorAddress =
        await meldStakingDelegator.getAddress();
      const meldStakingConfigAddress = await meldStakingConfig.getAddress();
      const meldStakingStorageAddress = await meldStakingStorage.getAddress();

      await meldStakingAddressProvider.initialize(
        meldTokenAddress,
        meldStakingNFTAddress,
        meldStakingCommonAddress,
        meldStakingOperatorAddress,
        meldStakingDelegatorAddress,
        meldStakingConfigAddress,
        meldStakingStorageAddress
      );
      expect(await meldStakingAddressProvider.meldToken()).to.equal(
        meldTokenAddress
      );
    });
    it("Should get the correct address for the meldStakingNFT", async function () {
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

      const meldTokenAddress = await meldToken.getAddress();
      const meldStakingNFTAddress = await meldStakingNFT.getAddress();
      const meldStakingCommonAddress = await meldStakingCommon.getAddress();
      const meldStakingOperatorAddress = await meldStakingOperator.getAddress();
      const meldStakingDelegatorAddress =
        await meldStakingDelegator.getAddress();
      const meldStakingConfigAddress = await meldStakingConfig.getAddress();
      const meldStakingStorageAddress = await meldStakingStorage.getAddress();

      await meldStakingAddressProvider.initialize(
        meldTokenAddress,
        meldStakingNFTAddress,
        meldStakingCommonAddress,
        meldStakingOperatorAddress,
        meldStakingDelegatorAddress,
        meldStakingConfigAddress,
        meldStakingStorageAddress
      );
      expect(await meldStakingAddressProvider.meldStakingNFT()).to.equal(
        meldStakingNFTAddress
      );
    });
    it("Should get the correct address for the meldStakingCommon", async function () {
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

      const meldTokenAddress = await meldToken.getAddress();
      const meldStakingNFTAddress = await meldStakingNFT.getAddress();
      const meldStakingCommonAddress = await meldStakingCommon.getAddress();
      const meldStakingOperatorAddress = await meldStakingOperator.getAddress();
      const meldStakingDelegatorAddress =
        await meldStakingDelegator.getAddress();
      const meldStakingConfigAddress = await meldStakingConfig.getAddress();
      const meldStakingStorageAddress = await meldStakingStorage.getAddress();

      await meldStakingAddressProvider.initialize(
        meldTokenAddress,
        meldStakingNFTAddress,
        meldStakingCommonAddress,
        meldStakingOperatorAddress,
        meldStakingDelegatorAddress,
        meldStakingConfigAddress,
        meldStakingStorageAddress
      );
      expect(await meldStakingAddressProvider.meldStakingCommon()).to.equal(
        meldStakingCommonAddress
      );
    });
    it("Should get the correct address for the meldStakingOperator", async function () {
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

      const meldTokenAddress = await meldToken.getAddress();
      const meldStakingNFTAddress = await meldStakingNFT.getAddress();
      const meldStakingCommonAddress = await meldStakingCommon.getAddress();
      const meldStakingOperatorAddress = await meldStakingOperator.getAddress();
      const meldStakingDelegatorAddress =
        await meldStakingDelegator.getAddress();
      const meldStakingConfigAddress = await meldStakingConfig.getAddress();
      const meldStakingStorageAddress = await meldStakingStorage.getAddress();

      await meldStakingAddressProvider.initialize(
        meldTokenAddress,
        meldStakingNFTAddress,
        meldStakingCommonAddress,
        meldStakingOperatorAddress,
        meldStakingDelegatorAddress,
        meldStakingConfigAddress,
        meldStakingStorageAddress
      );
      expect(await meldStakingAddressProvider.meldStakingOperator()).to.equal(
        meldStakingOperatorAddress
      );
    });
    it("Should get the correct address for the meldStakingDelegator", async function () {
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

      const meldTokenAddress = await meldToken.getAddress();
      const meldStakingNFTAddress = await meldStakingNFT.getAddress();
      const meldStakingCommonAddress = await meldStakingCommon.getAddress();
      const meldStakingOperatorAddress = await meldStakingOperator.getAddress();
      const meldStakingDelegatorAddress =
        await meldStakingDelegator.getAddress();
      const meldStakingConfigAddress = await meldStakingConfig.getAddress();
      const meldStakingStorageAddress = await meldStakingStorage.getAddress();

      await meldStakingAddressProvider.initialize(
        meldTokenAddress,
        meldStakingNFTAddress,
        meldStakingCommonAddress,
        meldStakingOperatorAddress,
        meldStakingDelegatorAddress,
        meldStakingConfigAddress,
        meldStakingStorageAddress
      );
      expect(await meldStakingAddressProvider.meldStakingDelegator()).to.equal(
        meldStakingDelegatorAddress
      );
    });
    it("Should get the correct address for the meldStakingConfig", async function () {
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

      const meldTokenAddress = await meldToken.getAddress();
      const meldStakingNFTAddress = await meldStakingNFT.getAddress();
      const meldStakingCommonAddress = await meldStakingCommon.getAddress();
      const meldStakingOperatorAddress = await meldStakingOperator.getAddress();
      const meldStakingDelegatorAddress =
        await meldStakingDelegator.getAddress();
      const meldStakingConfigAddress = await meldStakingConfig.getAddress();
      const meldStakingStorageAddress = await meldStakingStorage.getAddress();

      await meldStakingAddressProvider.initialize(
        meldTokenAddress,
        meldStakingNFTAddress,
        meldStakingCommonAddress,
        meldStakingOperatorAddress,
        meldStakingDelegatorAddress,
        meldStakingConfigAddress,
        meldStakingStorageAddress
      );
      expect(await meldStakingAddressProvider.meldStakingConfig()).to.equal(
        meldStakingConfigAddress
      );
    });
    it("Should get the correct address for the meldStakingStorage", async function () {
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

      const meldTokenAddress = await meldToken.getAddress();
      const meldStakingNFTAddress = await meldStakingNFT.getAddress();
      const meldStakingCommonAddress = await meldStakingCommon.getAddress();
      const meldStakingOperatorAddress = await meldStakingOperator.getAddress();
      const meldStakingDelegatorAddress =
        await meldStakingDelegator.getAddress();
      const meldStakingConfigAddress = await meldStakingConfig.getAddress();
      const meldStakingStorageAddress = await meldStakingStorage.getAddress();

      await meldStakingAddressProvider.initialize(
        meldTokenAddress,
        meldStakingNFTAddress,
        meldStakingCommonAddress,
        meldStakingOperatorAddress,
        meldStakingDelegatorAddress,
        meldStakingConfigAddress,
        meldStakingStorageAddress
      );
      expect(await meldStakingAddressProvider.meldStakingStorage()).to.equal(
        meldStakingStorageAddress
      );
    });
    it("Should get the correct value for the initialized variable", async function () {
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

      const meldTokenAddress = await meldToken.getAddress();
      const meldStakingNFTAddress = await meldStakingNFT.getAddress();
      const meldStakingCommonAddress = await meldStakingCommon.getAddress();
      const meldStakingOperatorAddress = await meldStakingOperator.getAddress();
      const meldStakingDelegatorAddress =
        await meldStakingDelegator.getAddress();
      const meldStakingConfigAddress = await meldStakingConfig.getAddress();
      const meldStakingStorageAddress = await meldStakingStorage.getAddress();

      expect(await meldStakingAddressProvider.initialized()).to.be.false;

      await meldStakingAddressProvider.initialize(
        meldTokenAddress,
        meldStakingNFTAddress,
        meldStakingCommonAddress,
        meldStakingOperatorAddress,
        meldStakingDelegatorAddress,
        meldStakingConfigAddress,
        meldStakingStorageAddress
      );

      expect(await meldStakingAddressProvider.initialized()).to.be.true;
    });
  }); // End of Getters
}); // End of MeldStakingAddressProvider
