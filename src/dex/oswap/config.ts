import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

// TODO: get exact estimate;
export const OSWAP_GAS_COST = 50_000;

// Important:
//  - All addresses should be lower case.
//  - Only tokens with 18 decimals are supported.
export const OSwapConfig: DexConfigMap<DexParams> = {
  OSwap: {
    [Network.MAINNET]: {
      pools: [ 
        {
          id: 'OSwap_0x85b78aca6deae198fbf201c82daf6ca21942acc6', // Pool identifier: `{dex_key}_{pool_address}`
          address: '0x85b78aca6deae198fbf201c82daf6ca21942acc6', // Address of the pool
          token0: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
          token1: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', // STETH
        }]
      }
    }
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    // Re-use the SmarDex adapters.
    // They are Uniswap V2 router compatible, which OSWap supports.
    [SwapSide.SELL]: [{ name: 'Adapter04', index: 6 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter02', index: 2 }],
  }
};
