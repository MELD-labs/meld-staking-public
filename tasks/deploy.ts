import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import fs from "fs";
import path from "path";

import {
  MeldStakingCommon,
  MeldStakingStorage,
  MeldStakingOperator,
  MeldStakingDelegator,
  MeldStakingConfig,
  MeldStakingNFT,
  MeldStakingNFTMetadata,
  MeldStakingAddressProvider,
} from "../typechain-types";

type StakingArgs = {
  infofile: string;
  defaultadminpk: string;
};

type StakingContracts = {
  meldStakingStorage: MeldStakingStorage;
  meldStakingCommon: MeldStakingCommon;
  meldStakingOperator: MeldStakingOperator;
  meldStakingDelegator: MeldStakingDelegator;
  meldStakingConfig: MeldStakingConfig;
  meldStakingNFT: MeldStakingNFT;
  meldStakingNFTMetadata: MeldStakingNFTMetadata;
  meldStakingAddressProvider: MeldStakingAddressProvider;
};

task(
  "deployStakingDeterministically",
  "Deploys and initialize the Meld Staking contracts deterministically"
)
  .addParam("infofile", "File with necessary info for the deployment")
  .addParam("defaultadminpk", "Private key of the default admin")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /*
     * This task deploys the Meld Staking contracts deterministically using a salt for each contract and the Seaport factory contract.
     * An info file is required with the following structure:
     * {
     *   "defaultAdminAddress": "0x...",
     *   "initTimestamp": 1625097600,
     *   "epochSize": 432000,
     *   "slashReceiver": "0x...",
     *   "meldTokenAddress": "0x...",
     *   "salts": {
     *     "MeldStakingCommon": "1",
     *     "MeldStakingOperator": "2",
     *     "MeldStakingDelegator": "3",
     *     "MeldStakingNFT": "4"
     *   }
     * }
     * The file contains the default admin address, the init timestamp, the epoch size, the slash receiver address, the MELD token address and the salts for each contract.
     * The salts are optional, every contract that doesn't have a salt will be deployed classically.
     * The `defaultadminpk` parameter is the private key of the default admin address and its address must match the one in the info file.
     * The information about the deployments will be exported to a file in the deployments folder with the pattern `deployments/<network>/<datetime>.json`.
     * The command to deploy the contracts is:
     * `yarn hardhat deployStakingDeterministically --infofile <path> --defaultadminpk <admin-private-key> --network <network>`
     * Example:
     * `yarn hardhat deployStakingDeterministically --infofile ./deployment-info-files/classic.json --defaultadminpk 0x513428372b86e2526209e9c60782d154699e113dfa0ae901b4fd8895688cf5e6 --network kanazawa`
     */
    await deployAndConfigStaking(hre, taskArgs, true);
  });

task(
  "deployStakingClassically",
  "Deploys and initialize the Meld Staking contracts classically"
)
  .addParam("infofile", "File with necessary info for the deployment")
  .addParam("defaultadminpk", "Private key of the default admin")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /*
     * This task deploys the Meld Staking contracts classically without VADD.
     * An info file is required with the following structure:
     * {
     *   "defaultAdminAddress": "0x...",
     *   "initTimestamp": 1625097600,
     *   "epochSize": 432000,
     *   "slashReceiver": "0x...",
     *   "meldTokenAddress": "0x..."
     * }
     * The file contains the default admin address, the init timestamp, the epoch size, the slash receiver address and the MELD token address.
     * The `defaultadminpk` parameter is the private key of the default admin address and its address must match the one in the info file.
     * The information about the deployments will be exported to a file in the deployments folder with the pattern `deployments/<network>/<datetime>.json`.
     * The command to deploy the contracts is:
     * `yarn hardhat deployStakingClassically --infofile <path> --defaultadminpk <admin-private-key> --network <network>`
     * Example:
     * `yarn hardhat deployStakingClassically --infofile ./deployment-info-files/classic.json --defaultadminpk 0x513428372b86e2526209e9c60782d154699e113dfa0ae901b4fd8895688cf5e6 --network kanazawa`
     */
    await deployAndConfigStaking(hre, taskArgs, false);
  });

async function deployAndConfigStaking(
  hre: HardhatRuntimeEnvironment,
  args: StakingArgs,
  deterministically: boolean
) {
  const { ethers } = hre;

  const [deployer] = await ethers.getSigners();
  const defaultAdmin = new ethers.Wallet(
    args.defaultadminpk,
    deployer.provider
  );

  let infoFilePath = args.infofile;
  if (!infoFilePath.startsWith("/")) {
    infoFilePath = `${process.cwd()}/${infoFilePath}`;
  }

  console.log("Info file path: ", infoFilePath);

  const info = require(infoFilePath);

  if (info.defaultAdminAddress !== defaultAdmin.address) {
    throw new Error(
      `The default admin address in the info file is different from the one provided in the private key. Info file: ${info.defaultAdminAddress}, provided: ${defaultAdmin.address}`
    );
  }

  const networkName = hre.network.name;

  console.log(
    `\n# Deploying Staking contracts ${
      deterministically ? "" : "non-"
    }deterministically on ${networkName}`
  );

  console.log("\nInfo:");
  console.log(info);

  const salts = deterministically ? info.salts : {};

  console.log("\n## Deploying contracts...");
  const contracts = await deployContracts(hre, defaultAdmin.address, salts);
  console.log("\nDone\n");

  console.log("## Initializing contracts...\n");

  // Initialize Address Provider
  const addressProviderInitTx = await contracts.meldStakingAddressProvider
    .connect(defaultAdmin)
    .initialize(
      info.meldTokenAddress,
      await contracts.meldStakingNFT.getAddress(),
      await contracts.meldStakingCommon.getAddress(),
      await contracts.meldStakingOperator.getAddress(),
      await contracts.meldStakingDelegator.getAddress(),
      await contracts.meldStakingConfig.getAddress(),
      await contracts.meldStakingStorage.getAddress()
    );
  await logAndWaitInitTx("MeldStakingAddressProvider", addressProviderInitTx);

  // Initialize everything else except config

  const addressProviderAddress =
    await contracts.meldStakingAddressProvider.getAddress();

  const storageInitTx = await contracts.meldStakingStorage
    .connect(defaultAdmin)
    .initialize(addressProviderAddress);
  await logAndWaitInitTx("MeldStakingStorage", storageInitTx);
  const commonInitTx = await contracts.meldStakingCommon
    .connect(defaultAdmin)
    .initialize(addressProviderAddress);
  await logAndWaitInitTx("MeldStakingCommon", commonInitTx);
  const operatorInitTx = await contracts.meldStakingOperator
    .connect(defaultAdmin)
    .initialize(addressProviderAddress);
  await logAndWaitInitTx("MeldStakingOperator", operatorInitTx);
  const delegatorInitTx = await contracts.meldStakingDelegator
    .connect(defaultAdmin)
    .initialize(addressProviderAddress);
  await logAndWaitInitTx("MeldStakingDelegator", delegatorInitTx);
  const nFTInitTx = await contracts.meldStakingNFT
    .connect(defaultAdmin)
    .initialize(addressProviderAddress);
  await logAndWaitInitTx("MeldStakingNFT", nFTInitTx);
  const nFTMetadataInitTx = await contracts.meldStakingNFTMetadata
    .connect(defaultAdmin)
    .initialize(addressProviderAddress);
  await logAndWaitInitTx("MeldStakingNFTMetadata", nFTMetadataInitTx);

  // Initialize config

  const configInitTx = await contracts.meldStakingConfig
    .connect(defaultAdmin)
    .initialize(
      info.initTimestamp,
      info.epochSize,
      info.slashReceiver,
      addressProviderAddress
    );
  await logAndWaitInitTx("MeldStakingConfig", configInitTx);

  // Setting MeldStakingNFTMetadata address in MeldStakingNFT
  console.log("- Setting MeldStakingNFTMetadata address in MeldStakingNFT.");
  const setMetadataAddressTx = await contracts.meldStakingNFT
    .connect(defaultAdmin)
    .setMetadataAddress(await contracts.meldStakingNFTMetadata.getAddress());
  console.log("Tx:", setMetadataAddressTx.hash);
  await setMetadataAddressTx.wait();
  console.log("Done\n");

  const contractsAddresses: any = {};
  console.log("##########################################");
  for (const [key, value] of Object.entries(contracts)) {
    const contractName = toTitleCase(key);
    console.log(`${contractName}: \t${await value.getAddress()}`);
    contractsAddresses[contractName] = await value.getAddress();
  }
  console.log("##########################################");

  await exportDeploymentsToFile(
    info,
    contractsAddresses,
    networkName,
    deterministically
  );
}

async function deployContracts(
  hre: HardhatRuntimeEnvironment,
  defaultAdmin: string,
  salts: { [key: string]: string }
): Promise<StakingContracts> {
  return {
    meldStakingStorage: (await deployContract(
      hre,
      "MeldStakingStorage",
      defaultAdmin,
      salts["MeldStakingStorage"]
    )) as MeldStakingStorage,
    meldStakingCommon: (await deployContract(
      hre,
      "MeldStakingCommon",
      defaultAdmin,
      salts["MeldStakingCommon"]
    )) as MeldStakingCommon,
    meldStakingOperator: (await deployContract(
      hre,
      "MeldStakingOperator",
      defaultAdmin,
      salts["MeldStakingOperator"]
    )) as MeldStakingOperator,
    meldStakingDelegator: (await deployContract(
      hre,
      "MeldStakingDelegator",
      defaultAdmin,
      salts["MeldStakingDelegator"]
    )) as MeldStakingDelegator,
    meldStakingConfig: (await deployContract(
      hre,
      "MeldStakingConfig",
      defaultAdmin,
      salts["MeldStakingConfig"]
    )) as MeldStakingConfig,
    meldStakingNFT: (await deployContract(
      hre,
      "MeldStakingNFT",
      defaultAdmin,
      salts["MeldStakingNFT"]
    )) as MeldStakingNFT,
    meldStakingNFTMetadata: (await deployContract(
      hre,
      "MeldStakingNFTMetadata",
      defaultAdmin,
      salts["MeldStakingNFTMetadata"]
    )) as MeldStakingNFTMetadata,
    meldStakingAddressProvider: (await deployContract(
      hre,
      "MeldStakingAddressProvider",
      defaultAdmin,
      salts["MeldStakingAddressProvider"]
    )) as MeldStakingAddressProvider,
  };
}

async function deployContract(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  defaultAdminAddress: string,
  salt: string
) {
  console.log("\n- Deploying contract:", contractName);
  if (salt !== undefined) {
    return deployContractDeterministically(
      hre,
      contractName,
      defaultAdminAddress,
      salt
    );
  }
  return deployContractClassically(hre, contractName, defaultAdminAddress);
}

async function deployContractClassically(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  defaultAdmin: string
) {
  const contractFactory = await hre.ethers.getContractFactory(contractName);
  const contract = await contractFactory.deploy(defaultAdmin);
  console.log("Tx:", contract.deploymentTransaction()!.hash);
  await contract.deploymentTransaction()!.wait();
  console.log("Deployed at:", await contract.getAddress());
  return contract;
}

async function deployContractDeterministically(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  defaultAdminAddress: string,
  salt: string
) {
  const originalConsoleLog = console.log;

  let capturedLog = "";
  console.log = (...args) => {
    capturedLog += args.map((arg) => String(arg)).join(" ") + "\n";
  };
  await hre.run("deployDeterministically", {
    salt,
    contract: contractName,
    constructorArgs: [defaultAdminAddress],
  });

  console.log = originalConsoleLog;
  const addressPattern = /Deployment address: (0x[0-9a-fA-F]+)/;

  // Use match() to find the first match
  const addressMatch = capturedLog.match(addressPattern);

  let deploymentAddress;
  if (addressMatch) {
    deploymentAddress = addressMatch[1];
  } else {
    console.log(capturedLog);
    throw "Error deploying token";
  }

  const txPattern = /Tx hash: (0x[0-9a-fA-F]+)/;
  const txMatch = capturedLog.match(txPattern);
  if (txMatch) {
    console.log("Tx:", txMatch[1]);
  }

  console.log("Deployed at:", deploymentAddress);

  const contractFactory = await hre.ethers.getContractFactory(contractName);
  return contractFactory.attach(deploymentAddress);
}

async function logAndWaitInitTx(contractName: string, tx: any) {
  console.log(`- Initializing ${contractName}. Tx: ${tx.hash}`);
  await tx.wait();
  console.log("Done\n");
}

async function exportDeploymentsToFile(
  info: any,
  contractsAddresses: { [key: string]: string },
  networkName: string,
  deterministically: boolean
) {
  // Check if deployments folder exists
  const deploymentsPath = path.join(process.cwd(), "deployments");
  if (!fs.existsSync(deploymentsPath)) {
    fs.mkdirSync(deploymentsPath);
  }

  // Check if network folder exists
  const networkPath = path.join(deploymentsPath, networkName);
  if (!fs.existsSync(networkPath)) {
    fs.mkdirSync(networkPath);
  }

  // File name will be current datetime
  const now = new Date();
  const nowString = now.toISOString();
  const filename = `${nowString}.json`;
  const filePath = path.join(networkPath, filename);

  const data = {
    network: networkName,
    datetime: nowString,
    deterministically,
    info,
    contracts: contractsAddresses,
  };

  const dataString = JSON.stringify(data, null, 2);

  console.log("\nExporting deployments to file:", filePath);

  // Write to file
  fs.writeFileSync(filePath, dataString);
}

function toTitleCase(key: string) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}
