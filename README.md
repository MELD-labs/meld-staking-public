# MELD Staking

This is the implementation of the Staking protocol in the MELD network. The operators of the nodes will stake their MELD tokens and will receive rewards for doing so. Other users can also stake their MELD tokens, delegating to existing nodes. The rewards will be distributed to the node operators and the delegators of the node.

## Installation

Run `npm install` or `yarn install` to install the dependencies.

## Configuration

The network configuration is in the `hardhat.config.ts` file. You can add or modify networks there. There is a `.sample.env` file that you can use as a template to create a `.env` file with the private keys of the accounts you want to interact with the different networks. You can also configure a different RPC URL for each network, as well as set your own `ETHERSCAN_API_KEY`.

## Testing

Run `npm run test` or `yarn test` to run the tests.

## Deployment

There are two deployment hardhat tasks, one to deploy the staking ecosystem in the usual way and another one to deploy the staking ecosystem deterministically, so the addresses of the contracts can be calculated beforehand using salts.

The scripts will not only deploy the contracts, but also initialize them with the required parameters, leaving them ready to be used.

Both scripts will require two params, a path to a file containing the info about the deployment and the private key of the default admin address.

The file with the info about the deployment will be slightly different depending on the deployment type, but it will always contain the following fields:

- `defaultAdminAddress`: The address of the default admin of the contracts. This address will be able to change the admin of the contracts, as well as execute some admin functions.
- `initTimestamp`: The timestamp of the start of the staking ecosystem. This timestamp will be used to calculate the epochs.
- `epochSize`: The size of the epochs in seconds.
- `slashReceiver`: The address that will receive the slashed tokens.
- `meldTokenAddress`: The address of the MELD token.

The information about the deployments will be exported to a file in the deployments folder with the pattern `deployments/<network>/<datetime>.json`.

## Regular deployment

This task deploys the Meld Staking contracts classically without VADD.
An info file is required with the following structure:

```
{
    "defaultAdminAddress": "0x...",
    "initTimestamp": 1625097600,
    "epochSize": 432000,
    "slashReceiver": "0x...",
    "meldTokenAddress": "0x..."
}
```

The `defaultadminpk` parameter is the private key of the default admin address and its address must match the one in the info file.

The command to deploy the contracts is:

```
yarn hardhat deployStakingClassically --infofile <path> --defaultadminpk <admin-private-key> --network <network>
```

Example:

```
yarn hardhat deployStakingClassically --infofile ./deployment-info-files/classic.json --defaultadminpk 0x513428372b86e2526209e9c60782d154699e113dfa0ae901b4fd8895688cf5e6 --network kanazawa
```

## Deterministic deployment

This task deploys the Meld Staking contracts deterministically using a salt for each contract and the Seaport factory contract.
An info file is required with the following structure:

```
{
    "defaultAdminAddress": "0x...",
    "initTimestamp": 1625097600,
    "epochSize": 432000,
    "slashReceiver": "0x...",
    "meldTokenAddress": "0x...",
    "salts": {
        "MeldStakingCommon": "1",
        "MeldStakingOperator": "2",
        "MeldStakingDelegator": "3",
        "MeldStakingNFT": "4"
    }
}
```

The salts are optional, every contract that doesn't have a salt will be deployed classically.

The `defaultadminpk` parameter is the private key of the default admin address and its address must match the one in the info file.

The command to deploy the contracts is:

```
yarn hardhat deployStakingDeterministically --infofile <path> --defaultadminpk <admin-private-key> --network <network>
```

Example:

```
yarn hardhat deployStakingDeterministically --infofile ./deployment-info-files/classic.json --defaultadminpk 0x513428372b86e2526209e9c60782d154699e113dfa0ae901b4fd8895688cf5e6 --network kanazawa
```

To know more about the deterministic deployment, check the VADD documentation [here](./VADD.md).

## Functional documentation

### Key points and takeaways

- All staking is linked to a node validating the MELD network.
- Nodes total staked amount can be between 100k and 20M MELD tokens.
- Rewards are calculated in epochs of 5 days. Only the liquidity staked during the full length of the epoch will get rewarded.
- All staking positions get represented by NFTs.
- Staking positions can be liquid or locked in different modular tiers, therefore increasing the weight of rewards distributed to them
- Users need to delegate stake to a node operator to generate rewards.
- Nodes will have the capacity to set a delegator fee when they register their node. This cannot be changed later.
- Users can change the node they delegate to at any time.
- Nodes can be slashed if they misbehave or go offline. Users that delegate to that node will also get slashed.

### General description of the process

The MELD network is an avalanche subnet that is validated by multiple nodes. Anyone can run a node but there are multiple requirements. The main ones are:

- Be an avalanche validator (needs 2000 AVAX staked on the node)
- Maintain a high uptime on the node
- Fluent communication with the MELD team for updates of the network and software
- Stake of 100k MELD tokens, up to a maximum of 20M

Running a node improves the security of the network and allows for robust applications to be developed on the MELD network. As reward, MELD splits the revenue generated by the protocol with the network operators. The reward structure is divided on 3 main timelines:

- 8% from treasury of all the MELD staked for the first 12 months of the network (network was created on May 2023)
- x% from treasury of all MELD staked + protocol revenue share (6 months)
- protocol revenue share (forever)

All users can create staking positions and delegate to a node that has capacity to hold their stake in the limits. When creating a staking position, an NFT is minted to the user to represent the position. This NFT can be transferred and sold, and a user can create as many as they want.

When a position is created, it needs to be delegated to a node before starting to accumulate rewards. It’s important that users do their own research on what node to delegate to, since there is a risk of the node being slashed and their stake lost in the process.

Rewards get distributed on an epoch based system. Each epoch is 5 days. Only liquidity staked during a full epoch will generate rewards. The owner of the NFT is able to claim their rewards at any given time, without having to wait for their locking period to end. Rewards get calculated on a position by position basis, adjusting depending on the weight of the locking tier.

Most of the parameters that describe the system (like min/max stake) are configurable and we reserve the right to change them in the future subject to agreements and potential DAO votes.

### Operating a node

Anyone can request to run a node. In order to do so, the process is as follows:

- You setup your validator node on the AVAX network
- You stake the 2000 AVAX needed to be an active validator in the AVAX network
- You setup the node to track the MELD subnet (our partnered providers will do this for you if you run a node on their infra)
- You create the request to run a node on the MELD network. We will verify all the information and make sure the node is operational.
  1. At this stage, you will need to create the initial stake deposit of at least 100k MELD. It will get returned to you if you are rejected.
  2. Your node will be identified by the AVAX node, and you will be able to setup delegation fee.
- If you are accepted, you will start participating in rewards distribution on the first complete epoch that your node is part of. People will be able to delegate to your node at this point.
- Every epoch, you will be able to claim rewards. The fee generated by your delegators will also accumulate for you to claim

When you decide to stop validating the network, you will need to indicate this to the protocol. You will be able to get your stake back (if locking period allows you to do so) and will prevent you and your delegators to get slashed when the node goes down.

**RISKS OF OPERATING A NODE**

You are responsible of the maintenance of the node. If your node has a lot of downtime or is detected as an attacker to the network, you will get slashed (and all the people delegating to you).

Slashed positions lose their stake, but can still claim the rewards generated in the past.

<aside>
⚠️ We recommend node operators to not lock their base 100k tokens in prolonged periods of time, otherwise they will not be able to leave the system and stop operating the node. If the node stops operating while the node is active in the system, it will get slashed and both operator and delegators will lose their stake

</aside>

### Delegating to a node

As a user, in order to get rewards for your staked MELD, it needs to be delegated to an active node. Different nodes will have different delegation fees, and nodes can be slashed for misbehaviour so make sure you do some research on who is operating the node before committing to a delegation.

Users can create as many staking positions as they want, there is no limit to the total amount of positions created. Each position will be managed independently for rewards, locks and delegators.

Every epoch, when rewards are distributed, each one of the positions will get their corresponding rewards assigned. You can claim the staking rewards at any point in time.

If the node you are delegating to stops being active, you are able to:

1. Change delegator to a new one. Only when your liquidity is delegated during a complete epoch it will generate rewards.
2. Withdraw your stake and rewards, if your locking position allows for that.

<aside>
ℹ️ We are aware of the risks of delegating to a node, and therefore we are not limiting the amount of times you can change delegation and there is no time constrain while doing this action.

</aside>

### Rewards calculation. Locked vs liquid stake

When creating a staking positions, you can decide to create a liquid staking or a time locked staking. Time locked positions get extra weight for rewards calculation. The initial set of locked staking we will be opening are:

| LOCK PERIOD | EPOCHS | WEIGHTING FOR REWARDS | MINIMUM DEPOSIT |
| ----------- | ------ | --------------------- | --------------- |
| LIQUID      | -      | 100                   | 0               |
| 6 MONTHS    | 37     | 120                   | 0               |
| 1 YEAR      | 73     | 175                   | 0               |
| 5 YEARS     | 365    | 350                   | 0               |

Rewards are weighted with these ratios to provide more rewards for tiers that need a bigger commitment from the user. This distribution system makes it very complex to calculate real world reward distributions, since the calculation is not only affected by your position but also by the rest of the ecosystem.
