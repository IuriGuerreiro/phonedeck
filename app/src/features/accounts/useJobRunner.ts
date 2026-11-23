// Runs one phone job at a time and shows the worker's live progress for it.
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api } from "@/api";

type Running = { label: string; serial: string };

export function useJobRunner(onDone: () => void) {
  const [running, setRunning] = useState<Running | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    const unlisten = api.onJobProgress((p) => {
      if (p.serial === running.serial) setProgress(p.message);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [running]);

  /** Runs `job`; returns false if it failed (the error is shown as a toast). */
  async function run(label: string, serial: string, job: () => Promise<unknown>): Promise<boolean> {
    setRunning({ label, serial });
    setProgress(null);
    try {
      await job();
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    } finally {
      setRunning(null);
      setProgress(null);
      onDone();
    }
  }

  function stop() {
    if (running) api.stopJob(running.serial).catch((e) => toast.error(String(e)));
  }

  return { running, progress, run, stop };
}
