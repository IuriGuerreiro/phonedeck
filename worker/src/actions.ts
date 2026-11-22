// Phone actions. Each takes the job payload and returns a small result.
import { withDevice } from "./devices.ts";

export type Job =
  | { action: "open_app"; serial: string; package: string }
  | { action: "swipe_up"; serial: string };

export function runJob(job: Job): Promise<unknown> {
  switch (job.action) {
    case "open_app":
      return withDevice(job.serial, async (s) => {
        await s.activateApp(job.package);
        return { opened: job.package };
      });
    case "swipe_up":
      return withDevice(job.serial, async (s) => {
        const { width, height } = await s.getWindowSize();
        const x = Math.round(width / 2);
        await s
          .action("pointer", { parameters: { pointerType: "touch" } })
          .move({ x, y: Math.round(height * 0.75) })
          .down()
          .pause(50)
          .move({ x, y: Math.round(height * 0.25), duration: 300 })
          .up()
          .perform();
        return { swiped: true };
      });
    default:
      throw new Error(`Unknown action: ${(job as { action: string }).action}`);
  }
}
