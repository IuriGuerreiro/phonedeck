// Starts a local Appium server as a child process and waits until it is ready.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type AppiumServer = { port: number; stop: () => void };

export async function startAppium(port: number, logDir: string): Promise<AppiumServer> {
  if (await isUp(port)) {
    // Something already serves Appium here (e.g. a manual `appium` run). Reuse it.
    return { port, stop: () => {} };
  }

  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(path.join(logDir, "appium.log"), { flags: "a" });
  const appiumMain = createRequire(import.meta.url).resolve("appium");

  const child: ChildProcess = spawn(
    process.execPath,
    [appiumMain, "--address", "127.0.0.1", "--port", String(port), "--log-no-colors"],
    {
      env: toolEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);

  let exited = false;
  child.once("exit", () => (exited = true));

  // A cold first start (driver load, disk cache empty) can take a while.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Appium exited during startup. See ${logDir}/appium.log`);
    if (await isUp(port)) return { port, stop: () => child.kill() };
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error("Appium did not start within 90s");
}

async function isUp(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Appium needs ANDROID_HOME and JAVA_HOME. Fill them in from common spots or from PATH. */
function toolEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.APPIUM_HOME ??= path.join(workerRoot, ".appium");
  if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
    const fromAdb = binDir("adb"); // <sdk>/platform-tools/adb
    const guesses = [fromAdb && path.dirname(fromAdb), path.join(os.homedir(), "Android/Sdk")];
    const sdk = guesses.find((g) => g && existsSync(path.join(g, "platform-tools")));
    if (sdk) env.ANDROID_HOME = sdk;
  }
  if (!env.JAVA_HOME) {
    const fromJava = binDir("java"); // <jdk>/bin/java
    if (fromJava) env.JAVA_HOME = path.dirname(fromJava);
  }
  return env;
}

function binDir(bin: string): string | undefined {
  try {
    const found = execFileSync("which", [bin], { encoding: "utf8" }).trim();
    return found ? path.dirname(realpathSync(found)) : undefined;
  } catch {
    return undefined;
  }
}
