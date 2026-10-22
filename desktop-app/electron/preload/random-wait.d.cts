export interface WaitRange { minSeconds: number; maxSeconds: number }
export interface RandomWaitSettings { collectionJob: WaitRange; collectionStep: WaitRange; deliveryStep: WaitRange }
export const DEFAULT_RANDOM_WAITS: Readonly<RandomWaitSettings>;
export function normalizeRandomWaits(input?: Partial<RandomWaitSettings>): RandomWaitSettings;
export function sampleWaitMs(range: WaitRange, random?: () => number): number;
export function waitInterruptibly(ms: number, options?: {
  stopped?: () => boolean; paused?: () => boolean; sleep?: (ms: number) => Promise<unknown>; now?: () => number;
}): Promise<boolean>;
