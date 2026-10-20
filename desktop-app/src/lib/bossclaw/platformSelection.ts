import type { AppConfig, JobPlatform } from './types';
import { PLATFORM_IDS, sortedEnabledPlatforms } from './platforms';

export const NEW_TAB_PAGE = '__newtab__';
export type NewTabPlatform = JobPlatform | typeof NEW_TAB_PAGE;
type PlatformConfig = Pick<AppConfig, 'platforms'>;

export function selectedDeliveryPlatforms(config: PlatformConfig, saved: unknown): JobPlatform[] {
  const enabled = sortedEnabledPlatforms(config);
  // Older installations retain their previous all-enabled delivery behavior.
  // An explicit empty/disabled selection never broadens to other platforms.
  if (saved == null) return enabled;
  if (!Array.isArray(saved)) return [];
  return enabled.filter(p => saved.includes(p));
}

export function rememberedCollectionPlatforms(config: PlatformConfig, saved: unknown): JobPlatform[] {
  const enabled = sortedEnabledPlatforms(config);
  const selected = Array.isArray(saved) ? [...new Set(saved)].filter((p): p is JobPlatform => enabled.includes(p)) : [];
  return selected.length ? selected : enabled.slice(0, 1);
}

export function rememberedNewTabPlatform(config: PlatformConfig, saved: unknown): NewTabPlatform {
  if (saved === NEW_TAB_PAGE) return NEW_TAB_PAGE;
  const enabled = sortedEnabledPlatforms(config);
  return PLATFORM_IDS.includes(saved as JobPlatform) && enabled.includes(saved as JobPlatform)
    ? saved as JobPlatform : enabled[0] || NEW_TAB_PAGE;
}
