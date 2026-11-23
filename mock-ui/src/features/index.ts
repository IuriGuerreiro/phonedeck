import type { Feature } from "./types";
import { feature as accounts } from "./accounts";
import { feature as alerts } from "./alerts";
import { feature as controlRoom } from "./control-room";
import { feature as dashboard } from "./dashboard";
import { feature as devices } from "./devices";
import { feature as onboarding } from "./onboarding";

export type { Feature, FeatureStatus } from "./types";

/**
 * Every page in the sidebar, in this order. Add a line per new feature.
 * The first one is the home page. (_template is not listed on purpose.)
 */
export const features: Feature[] = [dashboard, alerts, devices, controlRoom, accounts, onboarding];
