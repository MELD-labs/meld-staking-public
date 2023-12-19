import { ethers } from "hardhat";
import {
  BigNumberish,
  Contract,
  HDNodeWallet,
  TransactionResponse,
} from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  MockERC20,
  MeldStakingCommon,
  MeldStakingStorage,
  MeldStakingOperator,
  MeldStakingDelegator,
  MeldStakingConfig,
  MeldStakingNFT,
  MeldStakingNFTMetadata,
  MeldStakingAddressProvider,
} from "../../typechain-types";

export interface StakingData {
  delegator?: {
    baseStakedAmount: bigint;
    lastStakedAmount: bigint;
    minStakedAmount: bigint;
  };
  operator?: {
    baseStakedAmount: bigint;
    lastStakedAmount: bigint;
    minStakedAmount: bigint;
  };
  node?: {
    baseStakedAmount: bigint;
    lastStakedAmount: bigint;
    minStakedAmount: bigint;
    excessWeightedStake: bigint;
  };
  global?: {
    baseStakedAmount: bigint;
    lastStakedAmount: bigint;
    minStakedAmount: bigint;
    excessWeightedStake: bigint;
  };
}

export interface StakerData {
  nftId: bigint;
  nodeId: string;
  lastEpochStakingUpdated: bigint;
  lastEpochRewardsUpdated: bigint;
  lockTierId: bigint;
  unclaimedRewards: bigint;
  stakingStartTimestamp: bigint;
  isStaker: boolean;
  isDelegator: boolean;
  isOperator: boolean;
}

export async function deployContracts(defaultAdmin: string) {
  const meldTokenContractFactory = await ethers.getContractFactory("MockERC20");
  const meldToken = await meldTokenContractFactory.deploy(
    "Meld",
    "MELD",
    18,
    1000000000
  );

  return {
    meldStakingStorage: (await deployContract(
      "MeldStakingStorage",
      defaultAdmin
    )) as MeldStakingStorage & Contract,
    meldStakingCommon: (await deployContract(
      "MeldStakingCommon",
      defaultAdmin
    )) as MeldStakingCommon & Contract,
    meldStakingOperator: (await deployContract(
      "MeldStakingOperator",
      defaultAdmin
    )) as MeldStakingOperator & Contract,
    meldStakingDelegator: (await deployContract(
      "MeldStakingDelegator",
      defaultAdmin
    )) as MeldStakingDelegator & Contract,
    meldStakingConfig: (await deployContract(
      "MeldStakingConfig",
      defaultAdmin
    )) as MeldStakingConfig & Contract,
    meldStakingNFT: (await deployContract(
      "MeldStakingNFT",
      defaultAdmin
    )) as MeldStakingNFT & Contract,
    meldStakingNFTMetadata: (await deployContract(
      "MeldStakingNFTMetadata",
      defaultAdmin
    )) as MeldStakingNFTMetadata & Contract,
    meldStakingAddressProvider: (await deployContract(
      "MeldStakingAddressProvider",
      defaultAdmin
    )) as MeldStakingAddressProvider & Contract,
    meldToken,
  };
}

export async function deployAndConfigContracts(
  defaultAdmin: string,
  initTimestamp: number,
  epochSize: number,
  slashReceiver: string,
  impersonationAddresses?: {
    common?: string;
    operator?: string;
    delegator?: string;
  }
) {
  const contracts = await deployContracts(defaultAdmin);

  // Initialize Address Provider
  await contracts.meldStakingAddressProvider.initialize(
    await contracts.meldToken.getAddress(),
    await contracts.meldStakingNFT.getAddress(),
    impersonationAddresses?.common
      ? impersonationAddresses?.common
      : await contracts.meldStakingCommon.getAddress(),
    impersonationAddresses?.operator
      ? impersonationAddresses?.operator
      : await contracts.meldStakingOperator.getAddress(),
    impersonationAddresses?.delegator
      ? impersonationAddresses?.delegator
      : await contracts.meldStakingDelegator.getAddress(),
    await contracts.meldStakingConfig.getAddress(), // This one can't be impersonated because it calls MeldStakingStorage.initializeConfig(), which is protected
    await contracts.meldStakingStorage.getAddress()
  );

  // Initialize everything else except config
  const addressProviderAddress =
    await contracts.meldStakingAddressProvider.getAddress();

  await contracts.meldStakingStorage.initialize(addressProviderAddress);
  await contracts.meldStakingCommon.initialize(addressProviderAddress);
  await contracts.meldStakingOperator.initialize(addressProviderAddress);
  await contracts.meldStakingDelegator.initialize(addressProviderAddress);
  await contracts.meldStakingNFT.initialize(addressProviderAddress);
  await contracts.meldStakingNFTMetadata.initialize(addressProviderAddress);

  // Initialize config
  await contracts.meldStakingConfig.initialize(
    initTimestamp,
    epochSize,
    slashReceiver,
    addressProviderAddress
  );

  return contracts;
}

async function deployContract(contractName: string, defaultAdmin: string) {
  const contractFactory = await ethers.getContractFactory(contractName);
  const contract = await contractFactory.deploy(defaultAdmin);
  return contract;
}

export async function transferAndApproveTokens(
  token: MockERC20,
  owner: SignerWithAddress,
  receiver: SignerWithAddress | HDNodeWallet,
  spender: string,
  amount: BigNumberish
) {
  // Make sure delegator has some tokens
  await token.connect(owner).transfer(receiver.address, amount);

  // Approve spender contract to spend delegator's tokens
  await token.connect(receiver).approve(spender, amount);
}

export function toMeldDecimals(amount: BigNumberish) {
  return ethers.parseUnits(amount.toString(), 18);
}

export async function getStakingData(
  meldStakingStorage: MeldStakingStorage,
  epoch: bigint,
  delegatorTokenId: bigint,
  operatorTokenId: bigint,
  nodeId: string,
  stakingTierId: bigint,
  endLockEpoch?: bigint
): Promise<StakingData> {
  let stakingData: StakingData = <StakingData>{};
  let nodeExcessWeightedStake = 0n;
  let globalExcessWeightedStake = 0n;

  const [
    delegatorBaseStakedAmount,
    delegaterLastStakedAmount,
    delegatorMinStakedAmount,
    operatorBaseStakedAmount,
    operatorLastStakedAmount,
    operatorMinStakedAmount,
    nodeBaseStakedAmount,
    nodeLastStakedAmount,
    nodeMinStakedAmount,
    globalBaseStakedAmount,
    globalLastStakedAmount,
    globalMinStakedAmount,
  ] = await Promise.all([
    meldStakingStorage.getStakerBaseStakedAmount(delegatorTokenId),
    meldStakingStorage.getStakerLastStakedAmountPerEpoch(
      delegatorTokenId,
      epoch
    ),
    meldStakingStorage.getStakerMinStakedAmountPerEpoch(
      delegatorTokenId,
      epoch
    ),
    meldStakingStorage.getStakerBaseStakedAmount(operatorTokenId),
    meldStakingStorage.getStakerLastStakedAmountPerEpoch(
      operatorTokenId,
      epoch
    ),
    meldStakingStorage.getStakerMinStakedAmountPerEpoch(operatorTokenId, epoch),
    meldStakingStorage.getNodeBaseStakedAmount(nodeId),
    meldStakingStorage.getNodeLastStakedAmountPerEpoch(nodeId, epoch),
    meldStakingStorage.getNodeMinStakedAmountPerEpoch(nodeId, epoch),
    meldStakingStorage.getTotalBaseStakedAmount(),
    meldStakingStorage.getLastStakedAmountPerEpoch(epoch),
    meldStakingStorage.getMinStakedAmountPerEpoch(epoch),
  ]);

  if (stakingTierId != 0n) {
    //get the node and global excess weighted stake for the locked staking tier
    const untilEpoch: bigint = endLockEpoch ? endLockEpoch : epoch;
    nodeExcessWeightedStake =
      await meldStakingStorage.getNodeLockingExcessWeightedStakePerEpoch(
        nodeId,
        untilEpoch
      );
    globalExcessWeightedStake =
      await meldStakingStorage.getLockingExcessWeightedStakePerEpoch(
        untilEpoch
      );
  }

  stakingData = {
    delegator: {
      baseStakedAmount: delegatorBaseStakedAmount,
      lastStakedAmount: delegaterLastStakedAmount,
      minStakedAmount: delegatorMinStakedAmount,
    },
    operator: {
      baseStakedAmount: operatorBaseStakedAmount,
      lastStakedAmount: operatorLastStakedAmount,
      minStakedAmount: operatorMinStakedAmount,
    },
    node: {
      baseStakedAmount: nodeBaseStakedAmount,
      lastStakedAmount: nodeLastStakedAmount,
      minStakedAmount: nodeMinStakedAmount,
      excessWeightedStake: nodeExcessWeightedStake,
    },
    global: {
      baseStakedAmount: globalBaseStakedAmount,
      lastStakedAmount: globalLastStakedAmount,
      minStakedAmount: globalMinStakedAmount,
      excessWeightedStake: globalExcessWeightedStake,
    },
  };

  return stakingData;
}

export async function getStakerStakingDataForEpochs(
  stakingStorage: MeldStakingStorage,
  nftId: bigint,
  startEpoch: bigint,
  untilEpoch: bigint,
  isDelegator: boolean = true
): Promise<{ stakingData: StakingData[]; lastEpochUpdated: bigint }> {
  const stakingData: StakingData[] = [];

  let stakerType: string = "delegator";
  const lastEpochUpdated =
    await stakingStorage.getStakerLastEpochStakingUpdated(nftId);

  if (!isDelegator) {
    stakerType = "operator";
  }

  // baseStakedAmount is not updated by updateStakerPreviousEpochs functions, so it will  be the same for all epochs
  const baseStakedAmount = await stakingStorage.getStakerBaseStakedAmount(
    nftId
  );

  for (let epoch = startEpoch; epoch <= untilEpoch; epoch++) {
    const lastStakedAmount =
      await stakingStorage.getStakerLastStakedAmountPerEpoch(nftId, epoch);
    const minStakedAmount =
      await stakingStorage.getStakerMinStakedAmountPerEpoch(nftId, epoch);

    const stakingDataItem: StakingData = {
      [stakerType]: {
        baseStakedAmount: baseStakedAmount,
        lastStakedAmount: lastStakedAmount,
        minStakedAmount: minStakedAmount,
      },
    };
    stakingData.push(stakingDataItem);
  }

  return { stakingData, lastEpochUpdated };
}

export async function getNodeStakingDataForEpochs(
  stakingStorage: MeldStakingStorage,
  nodeId: string,
  startEpoch: bigint,
  untilEpoch: bigint
): Promise<{ nodeStakingData: StakingData[]; lastEpochNodeUpdated: bigint }> {
  const nodeStakingData: StakingData[] = [];

  const lastEpochNodeUpdated =
    await stakingStorage.getNodeLastEpochStakingUpdated(nodeId);

  // baseStakedAmount is not updated by updateStakerPreviousEpochs functions, so it will  be the same for all epochs
  const baseStakedAmount = await stakingStorage.getNodeBaseStakedAmount(nodeId);

  for (let epoch = startEpoch; epoch <= untilEpoch; epoch++) {
    const lastStakedAmount =
      await stakingStorage.getNodeLastStakedAmountPerEpoch(nodeId, epoch);

    const minStakedAmount = await stakingStorage.getNodeMinStakedAmountPerEpoch(
      nodeId,
      epoch
    );

    const excessWeightedStake =
      await stakingStorage.getNodeLockingExcessWeightedStakePerEpoch(
        nodeId,
        epoch
      );

    const stakingDataItem: StakingData = {
      node: {
        baseStakedAmount: baseStakedAmount,
        lastStakedAmount: lastStakedAmount,
        minStakedAmount: minStakedAmount,
        excessWeightedStake: excessWeightedStake,
      },
    };

    nodeStakingData.push(stakingDataItem);
  }

  return { nodeStakingData, lastEpochNodeUpdated };
}

export async function getGlobalStakingDataForEpochs(
  stakingStorage: MeldStakingStorage,
  startEpoch: bigint,
  untilEpoch: bigint
): Promise<{
  globalStakingData: StakingData[];
  lastEpochGlobalUpdated: bigint;
}> {
  const globalStakingData: StakingData[] = [];

  const lastEpochGlobalUpdated =
    await stakingStorage.getLastEpochStakingUpdated();

  // baseStakedAmount is not updated by updateStakerPreviousEpochs functions, so it will  be the same for all epochs
  const baseStakedAmount = await stakingStorage.getTotalBaseStakedAmount();

  for (let epoch = startEpoch; epoch <= untilEpoch; epoch++) {
    const lastStakedAmount = await stakingStorage.getLastStakedAmountPerEpoch(
      epoch
    );

    const minStakedAmount = await stakingStorage.getMinStakedAmountPerEpoch(
      epoch
    );

    const excessWeightedStake =
      await stakingStorage.getLockingExcessWeightedStakePerEpoch(epoch);

    const stakingDataItem: StakingData = {
      global: {
        baseStakedAmount: baseStakedAmount,
        lastStakedAmount: lastStakedAmount,
        minStakedAmount: minStakedAmount,
        excessWeightedStake: excessWeightedStake,
      },
    };

    globalStakingData.push(stakingDataItem);
  }

  return { globalStakingData, lastEpochGlobalUpdated };
}

export async function getUnclaimedRewards(
  stakingStorage: MeldStakingStorage,
  nftId: bigint
): Promise<{ rewards: bigint; lastEpochUpdated: bigint }> {
  const lastEpochUpdated =
    await stakingStorage.getStakerLastEpochStakingUpdated(nftId);

  const rewards = await stakingStorage.getStakerUnclaimedRewards(nftId);

  return { rewards, lastEpochUpdated };
}

export async function setRewardsForEpochs(
  stakingConfig: MeldStakingConfig,
  rewardsSetter: SignerWithAddress,
  untilEpoch: bigint,
  startRewardsAmount: bigint,
  amountIncrease: bigint
): Promise<void> {
  // Start with epoch 2 because there are no rewards in epoch 1
  for (let epoch = 2; epoch <= untilEpoch; epoch++) {
    const rewards = startRewardsAmount + amountIncrease * BigInt(epoch);
    await stakingConfig.connect(rewardsSetter).setRewards(rewards, epoch);
  }
}

export async function requestNode(
  meldToken: MockERC20,
  meldStakingOperator: MeldStakingOperator,
  meldStakingNFT: MeldStakingNFT,
  deployer: SignerWithAddress,
  operator: SignerWithAddress,
  nodeName: string,
  delegatorFee: BigNumberish,
  amount: BigNumberish,
  lockTierId: BigNumberish,
  metadata: string
): Promise<TransactionResponse> {
  await transferAndApproveTokens(
    meldToken,
    deployer,
    operator,
    await meldStakingNFT.getAddress(),
    amount
  );

  // Operator requests a node
  return await meldStakingOperator
    .connect(operator)
    .requestNode(nodeName, delegatorFee, amount, lockTierId, metadata);
}

export async function delegateToNode(
  meldToken: MockERC20,
  meldStakingDelegator: MeldStakingDelegator,
  meldStakingNFT: MeldStakingNFT,
  deployer: SignerWithAddress,
  delegator: SignerWithAddress | HDNodeWallet,
  amount: BigNumberish,
  nodeId: string,
  lockTierId: BigNumberish
): Promise<TransactionResponse> {
  await transferAndApproveTokens(
    meldToken,
    deployer,
    delegator,
    await meldStakingNFT.getAddress(),
    amount
  );

  // Delegator delegates to the node
  return await meldStakingDelegator
    .connect(delegator)
    .stake(amount, nodeId, lockTierId);
}

export async function getStakerData(
  meldStakingStorage: MeldStakingStorage,
  nftId: bigint
): Promise<StakerData> {
  let stakerData: StakerData = <StakerData>{};

  const [
    nodeId,
    lastEpochStakingUpdated,
    lastEpochRewardsUpdated,
    lockTierId,
    unclaimedRewards,
    stakingStartTimestamp,
    isStaker,
    isDelegator,
    isOperator,
  ] = await Promise.all([
    meldStakingStorage.getStakerNodeId(nftId),
    meldStakingStorage.getStakerLastEpochStakingUpdated(nftId),
    meldStakingStorage.getStakerLastEpochRewardsUpdated(nftId),
    meldStakingStorage.getStakerLockTierId(nftId),
    meldStakingStorage.getStakerUnclaimedRewards(nftId),
    meldStakingStorage.getStakerStakingStartTimestamp(nftId),
    meldStakingStorage.isStaker(nftId),
    meldStakingStorage.isDelegator(nftId),
    meldStakingStorage.isOperator(nftId),
  ]);

  stakerData = {
    nftId: nftId,
    nodeId: nodeId,
    lastEpochStakingUpdated: lastEpochStakingUpdated,
    lastEpochRewardsUpdated: lastEpochRewardsUpdated,
    lockTierId: lockTierId,
    unclaimedRewards: unclaimedRewards,
    stakingStartTimestamp: stakingStartTimestamp,
    isStaker: isStaker,
    isDelegator: isDelegator,
    isOperator: isOperator,
  };

  return stakerData;
}
