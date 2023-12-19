import { PERCENTAGE_SCALING } from "./constants";
import { MeldStakingStorage } from "../../typechain-types";
import { StakingData } from "./utils";

export const calculateExpectedStakingDataAfterNewStake = async (
  stakingStorage: MeldStakingStorage,
  stakingDataBefore: StakingData,
  newAmount: bigint,
  nftId: bigint,
  nodeId: string,
  lockTierId: bigint,
  isDelegator: boolean = true
): Promise<StakingData> => {
  const expectedStakingData: StakingData = <StakingData>{};

  let delegationFeeAmount: bigint = 0n;
  let excessWeightedStake: bigint = 0n;

  const weightedStakedAmount = await calculateWeightedAmount(
    stakingStorage,
    newAmount,
    lockTierId
  );

  if (isDelegator) {
    delegationFeeAmount = await calculateDelegationFeeAmount(
      stakingStorage,
      nodeId,
      newAmount
    );

    expectedStakingData.delegator = {
      baseStakedAmount: newAmount,
      lastStakedAmount: weightedStakedAmount - delegationFeeAmount,
      minStakedAmount: stakingDataBefore.delegator?.minStakedAmount ?? 0n,
    };

    expectedStakingData.operator = {
      baseStakedAmount: stakingDataBefore.operator?.baseStakedAmount ?? 0n,
      lastStakedAmount:
        (stakingDataBefore.operator?.lastStakedAmount ?? 0n) +
        delegationFeeAmount,
      minStakedAmount: stakingDataBefore.operator?.minStakedAmount ?? 0n,
    };
  } else {
    expectedStakingData.delegator = {
      baseStakedAmount: stakingDataBefore.delegator?.baseStakedAmount ?? 0n,
      lastStakedAmount: stakingDataBefore.delegator?.lastStakedAmount ?? 0n,
      minStakedAmount: stakingDataBefore.delegator?.minStakedAmount ?? 0n,
    };

    expectedStakingData.operator = {
      baseStakedAmount: newAmount,
      lastStakedAmount: weightedStakedAmount,
      minStakedAmount: stakingDataBefore.operator?.minStakedAmount ?? 0n,
    };
  }

  if (lockTierId != 0n) {
    const baseStakedAmount = await stakingStorage.getStakerBaseStakedAmount(
      nftId
    );
    excessWeightedStake = weightedStakedAmount - baseStakedAmount;
  }

  expectedStakingData.node = {
    baseStakedAmount:
      (stakingDataBefore.node?.baseStakedAmount ?? 0n) + newAmount,
    lastStakedAmount:
      (stakingDataBefore.node?.lastStakedAmount ?? 0n) + weightedStakedAmount,
    minStakedAmount: stakingDataBefore.node?.minStakedAmount ?? 0n,
    excessWeightedStake:
      (stakingDataBefore.node?.excessWeightedStake ?? 0n) + excessWeightedStake,
  };

  expectedStakingData.global = {
    baseStakedAmount:
      (stakingDataBefore.global?.baseStakedAmount ?? 0n) + newAmount,
    lastStakedAmount:
      (stakingDataBefore.global?.lastStakedAmount ?? 0n) + weightedStakedAmount,
    minStakedAmount: stakingDataBefore.global?.minStakedAmount ?? 0n,
    excessWeightedStake:
      (stakingDataBefore.global?.excessWeightedStake ?? 0n) +
      excessWeightedStake,
  };

  return expectedStakingData;
};

export async function calculateWeightedAmount(
  stakingStorage: MeldStakingStorage,
  amount: bigint,
  lockTierId: bigint
): Promise<bigint> {
  if (lockTierId == 0n) {
    // Liquid staking
    return amount;
  }

  const lockStakingTier = await stakingStorage.getLockStakingTier(lockTierId);
  const weight = lockStakingTier.weight;

  return (amount * weight) / PERCENTAGE_SCALING;
}

export async function calculateDelegationFeeAmount(
  stakingStorage: MeldStakingStorage,
  nodeId: string,
  amount: bigint
): Promise<bigint> {
  const delegatorFee = await stakingStorage.getNodeDelegatorFee(nodeId);
  const delegationFeeAmount = (amount * delegatorFee) / PERCENTAGE_SCALING;
  return delegationFeeAmount;
}

export async function calculateExcessWeightedStake(
  stakingStorage: MeldStakingStorage,
  nftId: bigint
): Promise<bigint> {
  const baseStakedAmount = await stakingStorage.getStakerBaseStakedAmount(
    nftId
  );
  const lockTierId = await stakingStorage.getStakerLockTierId(nftId);
  const weightedAmount = await calculateWeightedAmount(
    stakingStorage,
    baseStakedAmount,
    lockTierId
  );

  const excessWeightedStake = weightedAmount - baseStakedAmount;

  return excessWeightedStake;
}

export async function calculateRewards(
  stakingStorage: MeldStakingStorage,
  nftId: bigint,
  startEpoch: bigint,
  untilEpoch: bigint
): Promise<bigint> {
  let reward: bigint;
  let newUnclaimedRewards: bigint = 0n;

  for (let epoch = startEpoch; epoch <= untilEpoch; epoch++) {
    const stakerMinStakedAmountPerEpoch =
      await stakingStorage.getStakerMinStakedAmountPerEpoch(nftId, epoch);

    const totalRewardsPerEpoch = await stakingStorage.getTotalRewardsPerEpoch(
      epoch
    );

    const minStakedAmountPerEpoch =
      await stakingStorage.getMinStakedAmountPerEpoch(epoch);

    if (
      stakerMinStakedAmountPerEpoch == 0n ||
      totalRewardsPerEpoch == 0n ||
      minStakedAmountPerEpoch == 0n
    ) {
      reward = 0n;
    } else {
      reward =
        (stakerMinStakedAmountPerEpoch * totalRewardsPerEpoch) /
        minStakedAmountPerEpoch;
    }

    newUnclaimedRewards += reward;
  }

  return newUnclaimedRewards;
}

export async function calculateEndLockEpoch(
  stakingStorage: MeldStakingStorage,
  nftId: bigint
): Promise<bigint> {
  const lockTierId = await stakingStorage.getStakerLockTierId(nftId);
  if (lockTierId === 0n) {
    return 0n;
  }
  const startTimestamp = await stakingStorage.getStakerStakingStartTimestamp(
    nftId
  );
  const startEpoch = await stakingStorage.getEpoch(startTimestamp);

  const lockStakingTier = await stakingStorage.getLockStakingTier(lockTierId);
  const stakingLength = lockStakingTier.stakingLength;

  return startEpoch + stakingLength + 1n;
}

export async function calculateEndLockTimestamp(
  stakingStorage: MeldStakingStorage,
  nftId: bigint
): Promise<bigint> {
  const endEpoch = await calculateEndLockEpoch(stakingStorage, nftId);
  const initialTimestamp = await stakingStorage.getInitTimestamp();
  const epochSize = await stakingStorage.getEpochSize();
  return initialTimestamp + (endEpoch - 1n) * epochSize; // -1 because we want the timestamp at the start of the epoch
}

export const calculateExpectedStakingDataAfterWithdrawal = async (
  stakingStorage: MeldStakingStorage,
  stakingDataBefore: StakingData,
  nftId: bigint,
  nodeId: string,
  lockTierId: bigint
): Promise<StakingData> => {
  const expectedStakingData: StakingData = <StakingData>{};

  let excessWeightedStake: bigint = 0n;

  const weightedStakedAmount = await calculateWeightedAmount(
    stakingStorage,
    stakingDataBefore.delegator?.baseStakedAmount ?? 0n,
    lockTierId
  );

  const delegationFeeAmount = await calculateDelegationFeeAmount(
    stakingStorage,
    nodeId,
    stakingDataBefore.delegator?.baseStakedAmount ?? 0n
  );

  // Delegator gets removed in withraw function
  expectedStakingData.delegator = {
    baseStakedAmount: 0n,
    lastStakedAmount: 0n,
    minStakedAmount: 0n,
  };

  expectedStakingData.operator = {
    baseStakedAmount: stakingDataBefore.operator?.baseStakedAmount ?? 0n,
    lastStakedAmount:
      (stakingDataBefore.operator?.lastStakedAmount ?? 0n) -
      delegationFeeAmount,
    minStakedAmount: stakingDataBefore.operator?.minStakedAmount ?? 0n,
  };

  if (
    lockTierId != 0n &&
    stakingDataBefore.delegator?.baseStakedAmount !== undefined
  ) {
    const baseStakedAmount = await stakingStorage.getStakerBaseStakedAmount(
      nftId
    );
    excessWeightedStake = weightedStakedAmount - baseStakedAmount;
  }

  expectedStakingData.node = {
    baseStakedAmount:
      (stakingDataBefore.node?.baseStakedAmount ?? 0n) -
      (stakingDataBefore.delegator?.baseStakedAmount ?? 0n),
    lastStakedAmount:
      (stakingDataBefore.node?.lastStakedAmount ?? 0n) -
      (stakingDataBefore.delegator?.baseStakedAmount ?? 0n),
    minStakedAmount: stakingDataBefore.node?.minStakedAmount ?? 0n,
    excessWeightedStake:
      (stakingDataBefore.node?.excessWeightedStake ?? 0n) + excessWeightedStake,
  };

  expectedStakingData.global = {
    baseStakedAmount:
      (stakingDataBefore.global?.baseStakedAmount ?? 0n) -
      (stakingDataBefore.delegator?.baseStakedAmount ?? 0n),
    lastStakedAmount:
      (stakingDataBefore.global?.lastStakedAmount ?? 0n) -
      (stakingDataBefore.delegator?.baseStakedAmount ?? 0n),
    minStakedAmount: stakingDataBefore.global?.minStakedAmount ?? 0n,
    excessWeightedStake:
      (stakingDataBefore.global?.excessWeightedStake ?? 0n) +
      excessWeightedStake,
  };

  return expectedStakingData;
};
