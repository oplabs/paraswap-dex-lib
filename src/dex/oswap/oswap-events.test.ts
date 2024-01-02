/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { OSwapEventPool } from './oswap-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { OSwapPoolState } from './types';

/*
  README
  ======

  This test script adds unit tests for Oswap event based
  system. This is done by fetching the state on-chain before the
  event block, manually pushing the block logs to the event-subscriber,
  comparing the local state with on-chain state.

  Most of the logic for testing is abstracted by `testEventSubscriber`.
  You need to do two things to make the tests work:

  1. Fetch the block numbers where certain events were released. You
  can modify the `./scripts/fetch-event-blocknumber.ts` to get the
  block numbers for different events. Make sure to get sufficient
  number of blockNumbers to cover all possible cases for the event
  mutations.

  2. Complete the implementation for fetchPoolState function. The
  function should fetch the on-chain state of the event subscriber
  using just the blocknumber.

  The template tests only include the test for a single event
  subscriber. There can be cases where multiple event subscribers
  exist for a single DEX. In such cases additional tests should be
  added.

  You can run this individual test script by running:
  `npx jest src/dex/<dex-name>/<dex-name>-events.test.ts`

  (This comment should be removed from the final implementation)
*/

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  oswapPools: OSwapEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<OSwapPoolState> {
  // TODO: complete me!
  return {};
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('Oswap EventPool Mainnet', function () {
  const dexKey = 'Oswap';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let oswapPool: OSwapEventPool;

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    // TODO: complete me!
  };

  beforeEach(async () => {
    oswapPool = new OSwapEventPool(
      dexKey,
      network,
      dexHelper,
      logger,
      /* TODO: Put here additional constructor arguments if needed */
    );
  });

  Object.entries(eventsToTest).forEach(
    ([poolAddress, events]: [string, EventMappings]) => {
      describe(`Events for ${poolAddress}`, () => {
        Object.entries(events).forEach(
          ([eventName, blockNumbers]: [string, number[]]) => {
            describe(`${eventName}`, () => {
              blockNumbers.forEach((blockNumber: number) => {
                it(`State after ${blockNumber}`, async function () {
                  await testEventSubscriber(
                    oswapPool,
                    oswapPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(
                        oswapPool,
                        _blockNumber,
                        poolAddress,
                      ),
                    blockNumber,
                    `${dexKey}_${poolAddress}`,
                    dexHelper.provider,
                  );
                });
              });
            });
          },
        );
      });
    },
  );
});
