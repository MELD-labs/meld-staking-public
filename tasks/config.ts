import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

type TierInfo = {
  minStakingAmount: number;
  stakingLength: number;
  weight: number;
};

type NodeInfo = {
  nodeName: string;
  delegatorFee: number;
  amount: number;
  lockTierId: number;
  metadata: object;
};

task("grantAdminRole", "Grant admin role to a specific address")
  .addParam("contractaddress", "The address of the contract")
  .addParam("destinationaddress", "The address to grant the roles")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Grant admin role to a specific address
     * The command to run this task is:
     * `yarn hardhat grantAdminRole --contractaddress <contract address> --destinationaddress <destination address> --network <network name>`
     */
    const { ethers } = hre;
    const contractAddress = taskArgs.contractaddress;
    const destinationAddress = taskArgs.destinationaddress;
    const [adminSigner] = await ethers.getSigners();

    const contract = await ethers.getContractAt(
      "AccessControl",
      contractAddress
    );

    if (
      !(await checkRole(contract, "DEFAULT_ADMIN_ROLE", adminSigner.address))
    ) {
      throw new Error("Admin address does not have DEFAULT_ADMIN_ROLE");
    }

    await grantRole(
      contract,
      adminSigner,
      "DEFAULT_ADMIN_ROLE",
      destinationAddress
    );

    console.log(
      `Address ${destinationAddress} has admin role: ${await checkRole(
        contract,
        "DEFAULT_ADMIN_ROLE",
        destinationAddress
      )}`
    );
  });

task(
  "grantRewardsSetterRole",
  "Grant rewards setter role to a specific address"
)
  .addParam("contractaddress", "The address of the MeldStakingConfig contract")
  .addParam("destinationaddress", "The address to grant the roles")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Grant rewards setter role to a specific address
     * The command to run this task is:
     * `yarn hardhat grantRewardsSetterRole --contractaddress <MeldStakingConfig contract address> --destinationaddress <destination address> --network <network name>`
     */
    const { ethers } = hre;
    const contractAddress = taskArgs.contractaddress;
    const destinationAddress = taskArgs.destinationaddress;
    const [adminSigner] = await ethers.getSigners();

    const contract = await ethers.getContractAt(
      "MeldStakingConfig",
      contractAddress
    );

    if (
      !(await checkRole(contract, "DEFAULT_ADMIN_ROLE", adminSigner.address))
    ) {
      throw new Error("Admin address does not have DEFAULT_ADMIN_ROLE");
    }

    await grantRole(
      contract,
      adminSigner,
      "REWARDS_SETTER_ROLE",
      destinationAddress
    );

    console.log(
      `Address ${destinationAddress} has rewards setter role: ${await checkRole(
        contract,
        "REWARDS_SETTER_ROLE",
        destinationAddress
      )}`
    );
  });

task("renounceAdminRole", "Renounce admin role")
  .addParam("contractaddress", "The address of the BaseToken contract")
  .addParam("backupaddress", "Another admin address (to avoid locking)")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Renounce admin role
     * The command to run this task is:
     * `yarn hardhat renounceAdminRole --contractaddress <contract address> --backupaddress <backup address> --network <network name>`
     */
    const { ethers } = hre;
    const contractAddress = taskArgs.contractaddress;
    const backupaddress = taskArgs.backupaddress;
    const [adminSigner] = await ethers.getSigners();

    const contract = await ethers.getContractAt(
      "AccessControl",
      contractAddress
    );

    if (
      !(await checkRole(contract, "DEFAULT_ADMIN_ROLE", adminSigner.address))
    ) {
      throw new Error("Admin address does not have DEFAULT_ADMIN_ROLE");
    }

    if (!(await checkRole(contract, "DEFAULT_ADMIN_ROLE", backupaddress))) {
      throw new Error(
        "Backup address does not have DEFAULT_ADMIN_ROLE. Please give it the role before renouncing"
      );
    }

    console.log("Renouncing admin role");
    const renounceAdminRoleTx = await contract
      .connect(adminSigner)
      .renounceRole(await contract.DEFAULT_ADMIN_ROLE(), adminSigner.address);
    console.log(
      "Tx hash:",
      renounceAdminRoleTx.hash,
      "waiting for confirmation..."
    );
    await renounceAdminRoleTx.wait();
  });

task("addStakingTiers", "Add lock staking tiers")
  .addParam("contractaddress", "The address of the MeldStakingConfig contract")
  .addParam("infofile", "File with info about staking lock tiers to add (JSON)")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Add lock staking tiers.
     * An info file is required with the following structure:
     * [
     *   {
     *     "minStakingAmount": 0,
     *     "stakingLength": 1,
     *     "weight": 12000
     *   },
     *   ...
     * ]
     * The command to run this task is:
     * `yarn hardhat addStakingTiers --contractaddress <MeldStakingConfig contract address> --infofile <info file path> --network <network name>`
     */
    const { ethers } = hre;
    const contractAddress = taskArgs.contractaddress;
    const [adminSigner] = await ethers.getSigners();

    const contract = await ethers.getContractAt(
      "MeldStakingConfig",
      contractAddress
    );

    if (
      !(await checkRole(contract, "DEFAULT_ADMIN_ROLE", adminSigner.address))
    ) {
      throw new Error("Admin address does not have DEFAULT_ADMIN_ROLE");
    }

    let infoFilePath = taskArgs.infofile;
    if (!infoFilePath.startsWith("/")) {
      infoFilePath = `${process.cwd()}/${infoFilePath}`;
    }

    console.log("Info file path: ", infoFilePath);

    const info = require(infoFilePath);

    console.log("Adding staking tiers");
    // Check that info is an array
    if (!Array.isArray(info)) {
      throw new Error("Info file must be an array");
    }

    for (let i = 0; i < info.length; i++) {
      const tier = info[i] as TierInfo;
      console.log(`Adding tier: ${JSON.stringify(tier)}`);
      const addStakingTierTx = await contract
        .connect(adminSigner)
        .addStakingLockTier(
          tier.minStakingAmount,
          tier.stakingLength,
          tier.weight
        );
      console.log(
        "Tx hash:",
        addStakingTierTx.hash,
        "waiting for confirmation..."
      );
      await addStakingTierTx.wait();
      console.log("Tier added\n");
    }
    console.log("Finished");
  });

task("addNodes", "Request nodes and approve them")
  .addParam(
    "contractaddress",
    "The address of the MeldStakingAddressProvider contract"
  )
  .addParam("infofile", "File with info about nodes to add (JSON)")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Request nodes and approve them.
     * An info file is required with the following structure:
     * [
     *   {
     *     "nodeName": "MyNode",
     *     "delegatorFee": 0,
     *     "amount": 300000,
     *     "lockTierId": 0,
     *     "metadata": {...}
     *   },
     *   ...
     * ]
     * The command to run this task is:
     * `yarn hardhat addNodes --contractaddress <MeldStakingAddressProvider contract address> --infofile <info file path> --network <network name>`
     * Note: The signer must have the DEFAULT_ADMIN_ROLE and will become the operator of the nodes
     * So that address needs to have enough MELD tokens to stake for all the nodes
     */
    const { ethers } = hre;
    const contractAddress = taskArgs.contractaddress;
    const [adminSigner] = await ethers.getSigners();

    const addressProvider = await ethers.getContractAt(
      "MeldStakingAddressProvider",
      contractAddress
    );

    const operatorContract = await ethers.getContractAt(
      "MeldStakingOperator",
      await addressProvider.meldStakingOperator()
    );

    const configContract = await ethers.getContractAt(
      "MeldStakingConfig",
      await addressProvider.meldStakingConfig()
    );

    const meldToken = await ethers.getContractAt(
      "IERC20",
      await addressProvider.meldToken()
    );

    if (
      !(await checkRole(
        configContract,
        "DEFAULT_ADMIN_ROLE",
        adminSigner.address
      ))
    ) {
      throw new Error("Admin address does not have DEFAULT_ADMIN_ROLE");
    }

    let infoFilePath = taskArgs.infofile;
    if (!infoFilePath.startsWith("/")) {
      infoFilePath = `${process.cwd()}/${infoFilePath}`;
    }

    console.log("Info file path: ", infoFilePath);

    const info = require(infoFilePath);

    // Check that info is an array
    if (!Array.isArray(info)) {
      throw new Error("Info file must be an array");
    }

    const toMeldDecimals = (amount: number) =>
      ethers.parseUnits(amount.toString(), 18);

    const totalAmount = toMeldDecimals(
      info.reduce((total, obj) => total + obj.amount, 0)
    );

    console.log(
      "Total amount of MELD tokens to approve:",
      totalAmount.toString()
    );

    if (totalAmount > (await meldToken.balanceOf(adminSigner.address))) {
      throw new Error(
        `Admin address does not have enough MELD tokens. Required: ${totalAmount}`
      );
    }

    console.log("Approving MELD tokens");
    const approveTx = await meldToken
      .connect(adminSigner)
      .approve(await addressProvider.meldStakingNFT(), totalAmount);
    console.log("Tx hash:", approveTx.hash, "waiting for confirmation...");
    await approveTx.wait();
    console.log("MELD tokens approved\n");

    console.log("Adding nodes");

    const nodeOutput = [];

    for (let i = 0; i < info.length; i++) {
      const node = info[i] as NodeInfo;

      const nodeId = await operatorContract.hashNodeId(node.nodeName);
      nodeOutput.push({
        nodeId: nodeId,
        nodeName: node.nodeName,
        tier: node.lockTierId,
      });

      console.log(`Requesting node: ${node.nodeName}`);
      const requestNodeTx = await operatorContract
        .connect(adminSigner)
        .requestNode(
          node.nodeName,
          node.delegatorFee,
          toMeldDecimals(node.amount),
          node.lockTierId,
          JSON.stringify(node.metadata)
        );
      console.log(
        "Tx hash:",
        requestNodeTx.hash,
        "waiting for confirmation..."
      );
      await requestNodeTx.wait();
      console.log("Node requested\n");

      console.log("Approving node");
      const approveNodeTx = await configContract
        .connect(adminSigner)
        .approveNodeRequest(nodeId);
      console.log(
        "Tx hash:",
        approveNodeTx.hash,
        "waiting for confirmation..."
      );
      await approveNodeTx.wait();
      console.log("Node approved\n\n");
    }
    console.log("Finished");

    console.log("------------------");
    for (let i = 0; i < nodeOutput.length; i++) {
      console.log(`Node name: ${nodeOutput[i].nodeName}`);
      console.log(`Node ID: ${nodeOutput[i].nodeId}`);
      console.log(`Tier: ${nodeOutput[i].tier}`);
      console.log();
    }
  });

async function checkRole(
  contract: any,
  role: string,
  address: string
): Promise<boolean> {
  const roleCode = await contract[role]();
  return await contract.hasRole(roleCode, address);
}

export async function grantRole(
  contract: any,
  adminSigner: any,
  role: string,
  address: string
) {
  console.log(`Granting role ${role} to ${address}`);
  const roleCode = await contract[role]();
  const grantRoleTx = await contract
    .connect(adminSigner)
    .grantRole(roleCode, address);
  console.log("Tx hash:", grantRoleTx.hash, "waiting for confirmation...");
  await grantRoleTx.wait();
}
