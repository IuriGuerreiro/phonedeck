import type { Feature } from "./types";
import { feature as accounts } from "./accounts";
import { feature as devices } from "./devices";
import { feature as onboarding } from "./onboarding";

export type { Feature, FeatureStatus } from "./types";

/**
 * Every page in the sidebar, in this order. Add a line per new feature.
 * (_template is not listed on purpose; copy it to start a new one.)
 */
export const features: Feature[] = [onboarding, devices, accounts];
