import type { Feature } from "./types";
import { feature as activity } from "./activity";
import { feature as accounts } from "./accounts";
import { feature as alerts } from "./alerts";
import { feature as controlRoom } from "./control-room";
import { feature as dashboard } from "./dashboard";
import { feature as devices } from "./devices";
import { feature as posting } from "./posting";
import { feature as schedule } from "./schedule";
import { feature as setup } from "./setup";

export type { Feature } from "./types";

/**
 * Every page in the sidebar, in this order. Add a line per new feature.
 * The first one is the home page.
 */
export const features: Feature[] = [
  dashboard,
  activity,
  alerts,
  devices,
  controlRoom,
  accounts,
  schedule,
  posting,
  setup,
];
