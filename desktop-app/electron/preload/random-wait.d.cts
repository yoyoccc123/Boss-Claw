export interface WaitRange { minSeconds: number; maxSeconds: number }
export interface RandomWaitRanges { collectionJob: WaitRange; collectionStep: WaitRange; deliveryStep: WaitRange }
type Platform = 'boss' | 'liepin' | 'zhaopin' | 'job51' | 'wuba';
export interface PlatformRandomWaitSettings extends RandomWaitRanges { collectionEnabled: boolean; deliveryEnabled: boolean }
export interface RandomWaitSettings extends RandomWaitRanges { platforms?: Partial<Record<Platform, Partial<PlatformRandomWaitSettings>>> }
export const DEFAULT_RANDOM_WAITS: Readonly<RandomWaitSettings>;
export function normalizeRandomWaits(input?: Partial<RandomWaitSettings>, platform?: Platform | null): RandomWaitSettings;
export function platformRandomWaits(input: Partial<RandomWaitSettings> | undefined, platform: Platform): PlatformRandomWaitSettings;
export function sampleWaitMs(range: WaitRange, random?: () => number): number;
export function waitInterruptibly(ms: number, options?: {
  stopped?: () => boolean; paused?: () => boolean; sleep?: (ms: number) => Promise<unknown>; now?: () => number;
}): Promise<boolean>;
