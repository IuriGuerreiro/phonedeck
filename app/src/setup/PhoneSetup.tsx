import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, PackagePlus, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { api, type Device } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setupApi, type ApkResult, type PhoneInfo, type SetupStatus } from "./api";
import { CopyCommand, InstallUdevButton } from "./PcSetup";

const XIAOMI = /xiaomi|redmi|poco/i;

type Step = { title: string; detail?: string; done?: boolean };

const DEV_OPTIONS: Step = {
  title: "Turn on Developer options",
  detail: "Settings → About phone → tap Build number 7 times. On Xiaomi tap MIUI / OS version instead.",
};
const USB_DEBUGGING: Step = {
  title: "Turn on USB debugging",
  detail: "Settings → (Additional settings →) Developer options → USB debugging.",
};
const ACCEPT_RSA: Step = {
  title: "Allow this computer",
  detail: "Unlock the phone. On “Allow USB debugging?” tick “Always allow” and tap Allow.",
};
const XIAOMI_STEPS: Step[] = [
  {
    title: "Turn on “Install via USB”",
    detail: "Developer options → Install via USB. Xiaomi may ask you to sign in to a Mi account and insert a SIM.",
  },
  {
    title: "Turn on “USB debugging (Security settings)”",
    detail: "Developer options → USB debugging (Security settings). Without these two, helper installs fail with INSTALL_FAILED_USER_RESTRICTED.",
  },
];

export function PhoneSetup({ udev, refreshStatus }: { udev?: SetupStatus["udev"]; refreshStatus: () => Promise<void> }) {
  const [devices, setDevices] = useState<Device[]>([]);

  const refresh = useCallback(() => {
    api
      .listDevices()
      .then((list) => setDevices(list.filter((d) => d.state !== "disconnected")))
      .catch((e) => toast.error(String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (devices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No phone found</CardTitle>
          <CardDescription className="mt-1">Do these on the phone, then plug it in with a USB data cable.</CardDescription>
        </CardHeader>
        <CardContent>
          <Steps steps={[DEV_OPTIONS, USB_DEBUGGING, { title: "Plug the phone into this PC" }, ACCEPT_RSA]} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {devices.map((d) => (
        <PhoneCard key={d.serial} device={d} udev={udev} refreshStatus={refreshStatus} />
      ))}
    </div>
  );
}

function PhoneCard({
  device: d,
  udev,
  refreshStatus,
}: {
  device: Device;
  udev?: SetupStatus["udev"];
  refreshStatus: () => Promise<void>;
}) {
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [apkResults, setApkResults] = useState<ApkResult[] | null>(null);
  const [busy, setBusy] = useState<"apks" | "udev" | null>(null);
  const ready = d.state === "device";

  const loadInfo = useCallback(() => {
    setupApi.phoneInfo(d.serial).then(setInfo).catch(() => setInfo(null));
  }, [d.serial]);

  useEffect(() => {
    if (ready) loadInfo();
  }, [ready, loadInfo]);

  async function installApks() {
    setBusy("apks");
    setApkResults(null);
    try {
      setApkResults(await setupApi.installHelperApks(d.serial));
      loadInfo();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function installUdev() {
    setBusy("udev");
    try {
      await setupApi.installUdevRule();
      toast.success("Rule installed. Unplug and replug the phone.");
      await refreshStatus();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  const xiaomi = info ? XIAOMI.test(info.manufacturer) : false;
  const title = d.name ?? info?.model ?? d.model ?? d.serial;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <Smartphone className="size-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{title}</CardTitle>
          <CardDescription className="truncate text-xs">
            {[d.serial, info?.manufacturer, info && `Android ${info.androidVersion}`].filter(Boolean).join(" · ")}
          </CardDescription>
        </div>
        <Badge variant={ready ? "default" : "outline"}>{d.state}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {d.state === "no permissions" && (
          <>
            <NextStep>Linux is blocking USB access to this phone. Add the Android USB rule, then unplug and replug it.</NextStep>
            <InstallUdevButton busy={busy === "udev"} onClick={installUdev} again={udev?.installed} />
            {udev && <CopyCommand text={udev.manualCommand} />}
          </>
        )}
        {d.state === "unauthorized" && (
          <>
            <NextStep>Unlock the phone and allow USB debugging for this computer.</NextStep>
            <Steps steps={[{ ...DEV_OPTIONS, done: true }, { ...USB_DEBUGGING, done: true }, ACCEPT_RSA]} />
            <p className="text-xs text-muted-foreground">
              No prompt? Unplug and replug, or Developer options → Revoke USB debugging authorizations, then replug.
            </p>
          </>
        )}
        {d.state === "offline" && (
          <NextStep>
            The phone stopped answering. Unplug and replug the cable. If it stays offline, turn USB debugging off and on
            again.
          </NextStep>
        )}
        {!["device", "unauthorized", "offline", "no permissions"].includes(d.state) && (
          <NextStep>adb reports “{d.state}”. Try replugging the phone.</NextStep>
        )}

        {ready && (
          <>
            <Steps
              steps={[
                { ...DEV_OPTIONS, done: true },
                { ...USB_DEBUGGING, done: true },
                { ...ACCEPT_RSA, done: true },
                ...(xiaomi ? XIAOMI_STEPS.map((s) => ({ ...s, done: info?.helpersInstalled || undefined })) : []),
                {
                  title: "Install the Appium helper apps",
                  detail: xiaomi
                    ? "Watch the phone: Xiaomi asks you to confirm each install."
                    : "Appium installs these on first run anyway; doing it now finds problems early.",
                  done: info?.helpersInstalled,
                },
              ]}
            />
            <Button onClick={installApks} disabled={busy === "apks"} className="self-start">
              {busy === "apks" ? <Loader2 className="animate-spin" /> : <PackagePlus />}
              {busy === "apks" ? "Installing… (check the phone)" : info?.helpersInstalled ? "Reinstall helper apps" : "Install helper apps"}
            </Button>
            {apkResults && <ApkResults results={apkResults} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ApkResults({ results }: { results: ApkResult[] }) {
  const restricted = results.some((r) => r.userRestricted);
  return (
    <div className="flex flex-col gap-2">
      {results.map((r) => (
        <div key={r.file} className="flex items-start gap-2 text-xs">
          <Badge variant={r.ok ? "default" : "destructive"}>{r.ok ? "Installed" : "Failed"}</Badge>
          <span className="font-mono">{r.file}</span>
          {!r.ok && <span className="line-clamp-2 text-muted-foreground" title={r.output}>{r.output}</span>}
        </div>
      ))}
      {restricted && (
        <NextStep>
          The phone blocked the install. Turn on “Install via USB” and “USB debugging (Security settings)” in Developer
          options, then try again.
        </NextStep>
      )}
    </div>
  );
}

function NextStep({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <span className="font-medium">Next: </span>
      {children}
    </div>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          {s.done ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
          ) : (
            <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="text-sm">
            <div className={s.done ? "text-muted-foreground" : "font-medium"}>
              {i + 1}. {s.title}
            </div>
            {s.detail && !s.done && <div className="text-xs text-muted-foreground">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
