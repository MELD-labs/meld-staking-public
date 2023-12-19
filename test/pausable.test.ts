import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAndConfigContracts } from "./utils/utils";

describe("Pausable", function () {
  async function pausableRolesFixture() {
    const [
      deployer,
      slashReceiver,
      operator,
      delegator,
      pauser,
      unpauser,
      rando,
    ] = await ethers.getSigners();
    const initTimestamp = (await time.latest()) + 1000;
    const epochSize = 5 * 24 * 60 * 60; // 5 days
    const contracts = await deployAndConfigContracts(
      deployer.address,
      initTimestamp,
      epochSize,
      slashReceiver.address
    );

    const {
      meldStakingCommon,
      meldStakingConfig,
      meldStakingOperator,
      meldStakingDelegator,
    } = contracts;

    const pauserRole = await meldStakingConfig.PAUSER_ROLE();
    const unpauserRole = await meldStakingConfig.UNPAUSER_ROLE();

    await meldStakingCommon.grantRole(pauserRole, pauser.address);
    await meldStakingCommon.grantRole(unpauserRole, unpauser.address);
    await meldStakingConfig.grantRole(pauserRole, pauser.address);
    await meldStakingConfig.grantRole(unpauserRole, unpauser.address);
    await meldStakingOperator.grantRole(pauserRole, pauser.address);
    await meldStakingOperator.grantRole(unpauserRole, unpauser.address);
    await meldStakingDelegator.grantRole(pauserRole, pauser.address);
    await meldStakingDelegator.grantRole(unpauserRole, unpauser.address);

    await time.increaseTo(initTimestamp + 1);
    return {
      deployer,
      slashReceiver,
      operator,
      delegator,
      pauser,
      unpauser,
      rando,
      initTimestamp,
      epochSize,
      pauserRole,
      unpauserRole,
      ...contracts,
    };
  }

  context("Pause-Unpause", async function () {
    context("Happy flow tests cases", async function () {
      it("Should pause and unpause", async function () {
        const {
          pauser,
          unpauser,
          meldStakingCommon,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingDelegator,
        } = await loadFixture(pausableRolesFixture);
        expect(await meldStakingCommon.paused()).to.be.false;
        await expect(meldStakingCommon.connect(pauser).pause())
          .to.emit(meldStakingCommon, "Paused")
          .withArgs(pauser.address);
        expect(await meldStakingCommon.paused()).to.be.true;
        await expect(meldStakingCommon.connect(unpauser).unpause())
          .to.emit(meldStakingCommon, "Unpaused")
          .withArgs(unpauser.address);
        expect(await meldStakingCommon.paused()).to.be.false;

        expect(await meldStakingConfig.paused()).to.be.false;
        await expect(meldStakingConfig.connect(pauser).pause())
          .to.emit(meldStakingConfig, "Paused")
          .withArgs(pauser.address);
        expect(await meldStakingConfig.paused()).to.be.true;
        await expect(meldStakingConfig.connect(unpauser).unpause())
          .to.emit(meldStakingConfig, "Unpaused")
          .withArgs(unpauser.address);
        expect(await meldStakingConfig.paused()).to.be.false;

        expect(await meldStakingOperator.paused()).to.be.false;
        await expect(meldStakingOperator.connect(pauser).pause())
          .to.emit(meldStakingOperator, "Paused")
          .withArgs(pauser.address);
        expect(await meldStakingOperator.paused()).to.be.true;
        await expect(meldStakingOperator.connect(unpauser).unpause())
          .to.emit(meldStakingOperator, "Unpaused")
          .withArgs(unpauser.address);
        expect(await meldStakingOperator.paused()).to.be.false;

        expect(await meldStakingDelegator.paused()).to.be.false;
        await expect(meldStakingDelegator.connect(pauser).pause())
          .to.emit(meldStakingDelegator, "Paused")
          .withArgs(pauser.address);
        expect(await meldStakingDelegator.paused()).to.be.true;
        await expect(meldStakingDelegator.connect(unpauser).unpause())
          .to.emit(meldStakingDelegator, "Unpaused")
          .withArgs(unpauser.address);
        expect(await meldStakingDelegator.paused()).to.be.false;
      });
    }); // end of context happy flow test cases
    context("Error flow test cases", async function () {
      it("Should not pause/unpause if not pauser/unpauser", async function () {
        const {
          pauser,
          rando,
          pauserRole,
          unpauserRole,
          meldStakingCommon,
          meldStakingConfig,
          meldStakingOperator,
          meldStakingDelegator,
        } = await loadFixture(pausableRolesFixture);

        const exceptedPauserException =
          "AccessControl: account " +
          rando.address.toLowerCase() +
          " is missing role " +
          pauserRole;
        const exceptedUnpauserException =
          "AccessControl: account " +
          rando.address.toLowerCase() +
          " is missing role " +
          unpauserRole;

        expect(await meldStakingCommon.paused()).to.be.false;
        await expect(
          meldStakingCommon.connect(rando).pause()
        ).to.be.revertedWith(exceptedPauserException);
        await meldStakingCommon.connect(pauser).pause();
        expect(await meldStakingCommon.paused()).to.be.true;
        await expect(
          meldStakingCommon.connect(rando).unpause()
        ).to.be.revertedWith(exceptedUnpauserException);

        expect(await meldStakingConfig.paused()).to.be.false;
        await expect(
          meldStakingConfig.connect(rando).pause()
        ).to.be.revertedWith(exceptedPauserException);
        await meldStakingConfig.connect(pauser).pause();
        expect(await meldStakingConfig.paused()).to.be.true;
        await expect(
          meldStakingConfig.connect(rando).unpause()
        ).to.be.revertedWith(exceptedUnpauserException);

        expect(await meldStakingOperator.paused()).to.be.false;
        await expect(
          meldStakingOperator.connect(rando).pause()
        ).to.be.revertedWith(exceptedPauserException);
        await meldStakingOperator.connect(pauser).pause();
        expect(await meldStakingOperator.paused()).to.be.true;
        await expect(
          meldStakingOperator.connect(rando).unpause()
        ).to.be.revertedWith(exceptedUnpauserException);

        expect(await meldStakingDelegator.paused()).to.be.false;
        await expect(
          meldStakingDelegator.connect(rando).pause()
        ).to.be.revertedWith(exceptedPauserException);
        await meldStakingDelegator.connect(pauser).pause();
        expect(await meldStakingDelegator.paused()).to.be.true;
        await expect(
          meldStakingDelegator.connect(rando).unpause()
        ).to.be.revertedWith(exceptedUnpauserException);
      });
      it("Should not be able to run a `whenNotPaused` function when paused", async function () {
        const { deployer, pauser, meldStakingConfig } = await loadFixture(
          pausableRolesFixture
        );

        await meldStakingConfig.connect(pauser).pause();
        await expect(
          meldStakingConfig
            .connect(deployer)
            .approveNodeRequest(ethers.ZeroHash)
        ).to.be.revertedWith("Pausable: paused");
      });
    }); // end of context Error flow test cases
  }); // end of context Roles
});
