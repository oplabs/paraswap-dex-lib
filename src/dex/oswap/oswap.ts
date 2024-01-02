import { Interface } from '@ethersproject/abi';
import { AsyncOrSync } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, getBigIntPow } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { OSwapData, OSwapPool, OSwapPoolState } from './types';
import { SimpleExchange } from '../simple-exchange';
import { OSwapConfig, Adapters, OSWAP_GAS_COST } from './config';
import { OSwapEventPool } from './oswap-pool';
import OSwapABI from '../../abi/oswap/oswap.abi.json';


export class OSwap
  extends SimpleExchange
  implements IDex<OSwapData>
{
  protected eventPools: { [id: string]: OSwapEventPool } = {};

  // OSwap pricing is constant, regardless of the swap amount.
  readonly hasConstantPriceLargeAmounts = true;
  
  // This may change in the future but currently OSwao works only with wrapped asset.
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(OSwapConfig);

  logger: Logger;

  readonly iOSwap: Interface;

  readonly pools: [OSwapPool];

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {}, // TODO: add any additional optional params to support other fork DEXes
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.iOSwap = new Interface(OSwapABI);

    this.pools = OSwapConfig[dexKey][network].pools;

    // Create an OSwapEventPool per pool, to track each pool's state by subscribing to on-chain events.
    for (const pool of this.pools) {
      this.eventPools[pool.id] = new OSwapEventPool(
        dexKey,
        pool,
        network,
        dexHelper,
        this.logger,
      );
    }
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    // FRANCK: should we fetch the traderate here????
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  // Returns the pool matching the specified token pair or null if none found.
  getPoolByTokenPair(srcToken: Token, destToken: Token): OSwapPool | null {
    const srcAddress = srcToken.address.toLowerCase();
    const destAddress = destToken.address.toLowerCase();
    for (const pool of this.pools) {
      if ((srcAddress === pool.token0 && destAddress === pool.token1) ||
          (srcAddress === pool.token1 && destAddress === pool.token0)) {
        return pool;
      }
    }
    return null;
  }

  // Returns a list of pool using the token.
  getPoolsByTokenAddress(tokenAddress: Address): OSwapPool[] {
    const address = tokenAddress.toLowerCase();
    let pools: OSwapPool[] = []
    for (const pool of this.pools) {
      if (address === pool.token0 || address === pool.token1) {
        pools.push(pool);
      }
    }
    return pools;
  }

  // Returns the list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const pool = this.getPoolByTokenPair(srcToken, destToken);
    return pool ? [pool.id] : []
  }

  // Given "amount" of "from" token, how much in "to" token will be received.
  calcPrice(pool: OSwapPool, state: OSwapPoolState, from: Token, amount: bigint) : bigint {
    const rate = from.address.toLowerCase() === pool.token0 ? 
      state.traderate0 :
      state.traderate1;
    // Note: traderate is at precision 36.
    return amount * rate / getBigIntPow(36);
  }

  // Returns true if the pool has enough liquidity for the swap. False otherwise.
  checkLiquidity(pool: OSwapPool, state: OSwapPoolState, from: Token, amount: bigint) : boolean {
    if (from.address.toLowerCase() === pool.token0) {
      const needed = amount * state.traderate0 / getBigIntPow(36);
      return (needed <= state.balance1)
    } else {
      const needed = amount * state.traderate1 / getBigIntPow(36);
      return (needed <= state.balance0)
    }
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<OSwapData>> {
    // Get the pool to use.
    const pool = this.getPoolByTokenPair(srcToken, destToken);
    if (!pool) return null;

    // Make sure the pool meets the optional limitPools filter.
    if (limitPools && !limitPools.includes(pool.id)) return null;
    
    const eventPool = this.eventPools[pool.id];
    if (!eventPool) throw new Error(`OSwap pool ${pool.id}: No EventPool found.`)

    const state = eventPool.getState(blockNumber);
    if (!state) throw new Error(`OSwap pool ${pool.id}: EventPool with no state.`)

    // Ensure there is enough liquidity in the pool to process all the requested swaps.
    const totalAmount = amounts.reduce((a: bigint, b: bigint) => a + b, BigInt(0));
    if (!this.checkLiquidity(pool, state, srcToken, totalAmount)) return null;

    // Calculate the prices
    const unitAmount = getBigIntPow((side === SwapSide.SELL ? srcToken : destToken).decimals);
    const unitPrice = this.calcPrice(pool, state, srcToken, unitAmount);
    const prices = amounts.map(amount => this.calcPrice(pool, state, srcToken, amount));

    return [{
      prices,
      unit: unitPrice,
      data: {
        pool: pool.address,
        receiver: this.augustusAddress,
        path: [srcToken.address, destToken.address]
      },
      exchange: this.dexKey,
      poolIdentifier: pool.id,
      gasCost: OSWAP_GAS_COST,
      poolAddresses: [pool.address],
    }];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<OSwapData>,
  ): number | number[] {
    // TODO: update if there is any payload in getAdapterParam
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  // Encode params required by the exchange adapter
  // Used for multiSwap, buy & megaSwap
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: OSwapData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          path: 'address[]',
          receiver: 'address',
        },
      },
      {
        path: data.path,
        receiver: data.receiver,
      },
    );
    return {
      targetExchange: data.pool,
      payload,
      networkFee: '0',
    };
  }

  // Encode call data used by simpleSwap like routers
  // Used for simpleSwap & simpleBuy
  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: OSwapData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    let method: string;
    let args: any;

    // Note: we set the deadline argument to zero since its value is ignored by the SmartDex adapter
    // which always uses block.timestamp as deadline when calling the swap method.
    if (side === SwapSide.SELL) {
      method = 'swapExactTokensForTokens';
      args = [srcAmount, destAmount, data.path, data.receiver, 0];
    } else {
      method = 'swapTokensForExactTokens';
      args = [destAmount, srcAmount, data.path, data.receiver, 0];
    }

    const swapData = this.iOSwap.encodeFunctionData(method, args);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      data.pool,
    );
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    return Promise.resolve();
  }

  // Returns a list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    // Get the list of pools using the token.
    const pools = this.getPoolsByTokenAddress(tokenAddress);
    if (!pools.length) return []

    const results = await Promise.all<PoolLiquidity>(
      pools.map(async pool => {
        // Get the pool's balance and its USD value.
        const eventPool = this.eventPools[pool.id];
        const state = eventPool.getState(eventPool.getStateBlockNumber())
        if (!state) throw new Error('OSwap: missing state for pool ${pool.id}');

        const usd0 = await this.dexHelper.getTokenUSDPrice(
          { address: pool.token0, decimals: 18 },
          state.balance0,
        );
        const usd1 = await this.dexHelper.getTokenUSDPrice(
          { address: pool.token1, decimals: 18 },
          state.balance1,
        )

        // Get the other token in the pair.
        const pairedToken = (pool.token0 === tokenAddress.toLowerCase()) ?
        { address: pool.token1, decimals: 18 } :
        { address: pool.token0, decimals: 18 }

        return {
            exchange: this.dexKey,
            address: pool.address,
            connectorTokens: [ pairedToken ],
            liquidityUSD: usd0 + usd1,
          }
        }
      )
    )
    return results
      .filter(r => r)
      .sort((a , b) => a.liquidityUSD - b.liquidityUSD)
      .slice(0, limit);
  }

  // This is optional function in case if your implementation has acquired any resources
  // you need to release for graceful shutdown. For example, it may be any interval timer
  releaseResources(): AsyncOrSync<void> {}
}