import {
  Address,
  GetContractReturnType,
  Hash,
  Hex,
  Log,
  decodeEventLog,
  encodeEventTopics,
  getAddress,
  getContract,
} from 'viem'

import {
  BaseClientMixin,
  BaseGasEstimatesMixin,
  BaseTransactions,
} from './base'
import {
  TransactionType,
  PASS_THROUGH_WALLET_CHAIN_IDS,
  getPassThroughWalletFactoryAddress,
} from '../constants'
import { passThroughWalletFactoryAbi } from '../constants/abi/passThroughWalletFactory'
import { passThroughWalletAbi } from '../constants/abi/passThroughWallet'
import { InvalidAuthError, TransactionFailedError } from '../errors'
import { applyMixins } from './mixin'
import type {
  CallData,
  CreatePassThroughWalletConfig,
  PassThroughTokensConfig,
  PassThroughWalletExecCallsConfig,
  PassThroughWalletPauseConfig,
  SetPassThroughConfig,
  SplitsClientConfig,
  SplitsPublicClient,
  TransactionConfig,
  TransactionFormat,
} from '../types'
import { validateAddress } from '../utils/validation'

type PassThroughWalletAbi = typeof passThroughWalletAbi

class PassThroughWalletTransactions extends BaseTransactions {
  constructor(transactionClientArgs: SplitsClientConfig & TransactionConfig) {
    super({
      supportedChainIds: PASS_THROUGH_WALLET_CHAIN_IDS,
      ...transactionClientArgs,
    })
  }

  protected async _createPassThroughWalletTransaction({
    owner,
    paused = false,
    passThrough,
    chainId,
    transactionOverrides = {},
  }: CreatePassThroughWalletConfig): Promise<TransactionFormat> {
    validateAddress(owner)
    validateAddress(passThrough)
    if (this._shouldRequireWalletClient) this._requireWalletClient()

    const functionChainId = this._getFunctionChainId(chainId)

    const result = await this._executeContractFunction({
      contractAddress: getPassThroughWalletFactoryAddress(functionChainId),
      contractAbi: passThroughWalletFactoryAbi,
      functionName: 'createPassThroughWallet',
      functionArgs: [[owner, paused, passThrough]],
      transactionOverrides,
    })

    return result
  }

  protected async _passThroughTokensTransaction({
    passThroughWalletAddress,
    tokens,
    transactionOverrides = {},
  }: PassThroughTokensConfig): Promise<TransactionFormat> {
    validateAddress(passThroughWalletAddress)
    tokens.map((token) => validateAddress(token))
    if (this._shouldRequireWalletClient) this._requireWalletClient()

    const result = await this._executeContractFunction({
      contractAddress: getAddress(passThroughWalletAddress),
      contractAbi: passThroughWalletAbi,
      functionName: 'passThroughTokens',
      functionArgs: [tokens],
      transactionOverrides,
    })

    return result
  }

  protected async _setPassThroughTransaction({
    passThroughWalletAddress,
    passThrough,
    transactionOverrides = {},
  }: SetPassThroughConfig): Promise<TransactionFormat> {
    validateAddress(passThroughWalletAddress)
    validateAddress(passThrough)
    if (this._shouldRequireWalletClient) {
      this._requireWalletClient()
      await this._requireOwner(passThroughWalletAddress)
    }

    const result = await this._executeContractFunction({
      contractAddress: getAddress(passThroughWalletAddress),
      contractAbi: passThroughWalletAbi,
      functionName: 'setPassThrough',
      functionArgs: [passThrough],
      transactionOverrides,
    })

    return result
  }

  protected async _setPausedTransaction({
    passThroughWalletAddress,
    paused,
    transactionOverrides = {},
  }: PassThroughWalletPauseConfig): Promise<TransactionFormat> {
    validateAddress(passThroughWalletAddress)
    if (this._shouldRequireWalletClient) {
      this._requireWalletClient()
      await this._requireOwner(passThroughWalletAddress)
    }

    const result = await this._executeContractFunction({
      contractAddress: getAddress(passThroughWalletAddress),
      contractAbi: passThroughWalletAbi,
      functionName: 'setPaused',
      functionArgs: [paused],
      transactionOverrides,
    })

    return result
  }

  protected async _execCallsTransaction({
    passThroughWalletAddress,
    calls,
    transactionOverrides = {},
  }: PassThroughWalletExecCallsConfig): Promise<TransactionFormat> {
    validateAddress(passThroughWalletAddress)
    calls.map((callData) => validateAddress(callData.to))
    if (this._shouldRequireWalletClient) {
      this._requireWalletClient()
      await this._requireOwner(passThroughWalletAddress)
    }

    const formattedCalls = calls.map((callData) => {
      return [callData.to, callData.value, callData.data]
    })

    const result = await this._executeContractFunction({
      contractAddress: getAddress(passThroughWalletAddress),
      contractAbi: passThroughWalletAbi,
      functionName: 'execCalls',
      functionArgs: [formattedCalls],
      transactionOverrides,
    })

    return result
  }

  private async _requireOwner(passThroughWalletAddress: string) {
    this._requireWalletClient()
    const walletAddress = this._walletClient!.account?.address

    const passThroughWalletContract = this._getPassThroughWalletContract(
      passThroughWalletAddress,
      this._walletClient!.chain!.id,
    )
    const owner = await passThroughWalletContract.read.owner()

    if (owner !== walletAddress)
      throw new InvalidAuthError(
        `Action only available to the pass through wallet owner. Pass through wallet address: ${passThroughWalletAddress}, owner: ${owner}, wallet address: ${walletAddress}`,
      )
  }

  protected _getPassThroughWalletContract(
    passThroughWallet: string,
    chainId: number,
  ): GetContractReturnType<PassThroughWalletAbi, SplitsPublicClient> {
    const publicClient = this._getPublicClient(chainId)

    return getContract({
      address: getAddress(passThroughWallet),
      abi: passThroughWalletAbi,
      client: publicClient,
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class PassThroughWalletClient extends PassThroughWalletTransactions {
  readonly eventTopics: { [key: string]: Hex[] }
  readonly callData: PassThroughWalletCallData
  readonly estimateGas: PassThroughWalletGasEstimates

  constructor(clientArgs: SplitsClientConfig) {
    super({
      transactionType: TransactionType.Transaction,
      ...clientArgs,
    })

    this.eventTopics = {
      createPassThroughWallet: [
        encodeEventTopics({
          abi: passThroughWalletFactoryAbi,
          eventName: 'CreatePassThroughWallet',
        })[0],
      ],
      passThroughTokens: [
        encodeEventTopics({
          abi: passThroughWalletAbi,
          eventName: 'PassThrough',
        })[0],
      ],
      setPassThrough: [
        encodeEventTopics({
          abi: passThroughWalletAbi,
          eventName: 'SetPassThrough',
        })[0],
      ],
      setPaused: [
        encodeEventTopics({
          abi: passThroughWalletAbi,
          eventName: 'SetPaused',
        })[0],
      ],
      execCalls: [
        encodeEventTopics({
          abi: passThroughWalletAbi,
          eventName: 'ExecCalls',
        })[0],
      ],
    }

    this.callData = new PassThroughWalletCallData(clientArgs)
    this.estimateGas = new PassThroughWalletGasEstimates(clientArgs)
  }

  // Write actions
  async _submitCreatePassThroughWalletTransaction(
    createPassThroughArgs: CreatePassThroughWalletConfig,
  ): Promise<{
    txHash: Hash
  }> {
    const txHash = await this._createPassThroughWalletTransaction(
      createPassThroughArgs,
    )
    if (!this._isContractTransaction(txHash))
      throw new Error('Invalid response')

    return { txHash }
  }

  async createPassThroughWallet(
    createPassThroughArgs: CreatePassThroughWalletConfig,
  ): Promise<{
    passThroughWalletAddress: Address
    event: Log
  }> {
    const { txHash } = await this._submitCreatePassThroughWalletTransaction(
      createPassThroughArgs,
    )
    const events = await this.getTransactionEvents({
      txHash,
      eventTopics: this.eventTopics.createPassThroughWallet,
    })
    const event = events.length > 0 ? events[0] : undefined
    if (event) {
      const log = decodeEventLog({
        abi: passThroughWalletFactoryAbi,
        data: event.data,
        topics: event.topics,
      })
      return {
        passThroughWalletAddress: log.args.passThroughWallet,
        event,
      }
    }

    throw new TransactionFailedError()
  }

  async _submitPassThroughTokensTransaction(
    passThroughArgs: PassThroughTokensConfig,
  ): Promise<{
    txHash: Hash
  }> {
    const txHash = await this._passThroughTokensTransaction(passThroughArgs)
    if (!this._isContractTransaction(txHash))
      throw new Error('Invalid response')

    return { txHash }
  }

  async passThroughTokens(passThroughArgs: PassThroughTokensConfig): Promise<{
    event: Log
  }> {
    const { txHash } =
      await this._submitPassThroughTokensTransaction(passThroughArgs)
    const events = await this.getTransactionEvents({
      txHash,
      eventTopics: this.eventTopics.passThroughTokens,
    })
    const event = events.length > 0 ? events[0] : undefined
    if (event)
      return {
        event,
      }

    throw new TransactionFailedError()
  }

  async _submitSetPassThroughTransaction(args: SetPassThroughConfig): Promise<{
    txHash: Hash
  }> {
    const txHash = await this._setPassThroughTransaction(args)
    if (!this._isContractTransaction(txHash))
      throw new Error('Invalid response')

    return { txHash }
  }

  async setPassThrough(args: SetPassThroughConfig): Promise<{ event: Log }> {
    const { txHash } = await this._submitSetPassThroughTransaction(args)
    const events = await this.getTransactionEvents({
      txHash,
      eventTopics: this.eventTopics.setPassThrough,
    })
    const event = events.length > 0 ? events[0] : undefined
    if (event)
      return {
        event,
      }

    throw new TransactionFailedError()
  }

  async _submitSetPausedTransaction(
    pauseArgs: PassThroughWalletPauseConfig,
  ): Promise<{
    txHash: Hash
  }> {
    const txHash = await this._setPausedTransaction(pauseArgs)
    if (!this._isContractTransaction(txHash)) throw new Error('Invalid reponse')

    return { txHash }
  }

  async setPaused(pauseArgs: PassThroughWalletPauseConfig): Promise<{
    event: Log
  }> {
    const { txHash } = await this._submitSetPausedTransaction(pauseArgs)
    const events = await this.getTransactionEvents({
      txHash,
      eventTopics: this.eventTopics.setPaused,
    })
    const event = events.length > 0 ? events[0] : undefined
    if (event)
      return {
        event,
      }

    throw new TransactionFailedError()
  }

  async _submitExecCallsTransaction(
    args: PassThroughWalletExecCallsConfig,
  ): Promise<{
    txHash: Hash
  }> {
    const txHash = await this._execCallsTransaction(args)
    if (!this._isContractTransaction(txHash))
      throw new Error('Invalid response')

    return { txHash }
  }

  async execCalls(args: PassThroughWalletExecCallsConfig): Promise<{
    event: Log
  }> {
    const { txHash } = await this._submitExecCallsTransaction(args)
    const events = await this.getTransactionEvents({
      txHash,
      eventTopics: this.eventTopics.execCalls,
    })
    const event = events.length > 0 ? events[0] : undefined
    if (event)
      return {
        event,
      }

    throw new TransactionFailedError()
  }

  // Read actions
  async getPassThrough({
    passThroughWalletAddress,
    chainId,
  }: {
    passThroughWalletAddress: string
    chainId?: number
  }): Promise<{
    passThrough: string
  }> {
    validateAddress(passThroughWalletAddress)

    const functionChainId = this._getReadOnlyFunctionChainId(chainId)
    const passThroughWalletContract = this._getPassThroughWalletContract(
      passThroughWalletAddress,
      functionChainId,
    )
    const passThrough = await passThroughWalletContract.read.passThrough()

    return {
      passThrough,
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface PassThroughWalletClient extends BaseClientMixin {}
applyMixins(PassThroughWalletClient, [BaseClientMixin])

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
class PassThroughWalletGasEstimates extends PassThroughWalletTransactions {
  constructor(clientArgs: SplitsClientConfig) {
    super({
      transactionType: TransactionType.GasEstimate,
      ...clientArgs,
    })
  }

  async createPassThroughWallet(
    args: CreatePassThroughWalletConfig,
  ): Promise<bigint> {
    const gasEstimate = await this._createPassThroughWalletTransaction(args)
    if (!this._isBigInt(gasEstimate)) throw new Error('Invalid response')

    return gasEstimate
  }

  async passThroughTokens(args: PassThroughTokensConfig): Promise<bigint> {
    const gasEstimate = await this._passThroughTokensTransaction(args)
    if (!this._isBigInt(gasEstimate)) throw new Error('Invalid response')

    return gasEstimate
  }

  async setPassThrough(args: SetPassThroughConfig): Promise<bigint> {
    const gasEstimate = await this._setPassThroughTransaction(args)
    if (!this._isBigInt(gasEstimate)) throw new Error('Invalid response')

    return gasEstimate
  }

  async setPaused(args: PassThroughWalletPauseConfig): Promise<bigint> {
    const gasEstimate = await this._setPausedTransaction(args)
    if (!this._isBigInt(gasEstimate)) throw new Error('Invalid response')

    return gasEstimate
  }

  async execCalls(args: PassThroughWalletExecCallsConfig): Promise<bigint> {
    const gasEstimate = await this._execCallsTransaction(args)
    if (!this._isBigInt(gasEstimate)) throw new Error('Invalid response')

    return gasEstimate
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
interface PassThroughWalletGasEstimates extends BaseGasEstimatesMixin {}
applyMixins(PassThroughWalletGasEstimates, [BaseGasEstimatesMixin])

class PassThroughWalletCallData extends PassThroughWalletTransactions {
  constructor(clientArgs: SplitsClientConfig) {
    super({
      transactionType: TransactionType.CallData,
      ...clientArgs,
    })
  }

  async createPassThroughWallet(
    args: CreatePassThroughWalletConfig,
  ): Promise<CallData> {
    const callData = await this._createPassThroughWalletTransaction(args)
    if (!this._isCallData(callData)) throw new Error('Invalid response')

    return callData
  }

  async passThroughTokens(args: PassThroughTokensConfig): Promise<CallData> {
    const callData = await this._passThroughTokensTransaction(args)
    if (!this._isCallData(callData)) throw new Error('Invalid response')

    return callData
  }

  async setPassThrough(args: SetPassThroughConfig): Promise<CallData> {
    const callData = await this._setPassThroughTransaction(args)
    if (!this._isCallData(callData)) throw new Error('Invalid response')

    return callData
  }

  async setPaused(args: PassThroughWalletPauseConfig): Promise<CallData> {
    const callData = await this._setPausedTransaction(args)
    if (!this._isCallData(callData)) throw new Error('Invalid response')

    return callData
  }

  async execCalls(args: PassThroughWalletExecCallsConfig): Promise<CallData> {
    const callData = await this._execCallsTransaction(args)
    if (!this._isCallData(callData)) throw new Error('Invalid response')

    return callData
  }
}
