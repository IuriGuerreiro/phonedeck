// First-run wizard: install tools, connect a phone, prepare it. Based on app/src/setup/.
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Download, Loader2, PartyPopper, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { onboardingApi, PHONE_STEPS, type Tool } from "./mock";

const STEPS = ["Install tools", "Connect device", "Install helpers", "Done"] as const;

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [tools, setTools] = useState<Tool[]>([]);
  const [phone, setPhone] = useState<{ model: string; android: string } | null>(null);
  const [helpers, setHelpers] = useState(onboardingApi.helpersInstalled);

  useEffect(() => {
    onboardingApi.tools().then(setTools);
  }, []);

  const toolsDone = tools.length > 0 && tools.every((t) => t.ok || t.optional);
  const canNext = [toolsDone, phone !== null, helpers, false][step];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Setup</h1>
        <p className="text-sm text-muted-foreground">Install dependencies and connect your first device.</p>
      </div>

      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-xs",
                i < step && "border-primary bg-primary text-primary-foreground",
                i === step && "border-primary text-foreground",
                i > step && "text-muted-foreground",
              )}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("text-sm", i === step ? "font-medium" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
          </li>
        ))}
      </ol>

      {step === 0 && <ToolsStep tools={tools} onTools={setTools} />}
      {step === 1 && <PhoneStep phone={phone} onPhone={setPhone} />}
      {step === 2 && <HelpersStep phone={phone} done={helpers} onDone={() => setHelpers(true)} />}
      {step === 3 && <DoneStep />}

      {step < 3 && (
        <div className="flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            <ArrowLeft /> Back
          </Button>
          <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
            Next <ArrowRight />
          </Button>
        </div>
      )}
    </div>
  );
}

function ToolsStep({ tools, onTools }: { tools: Tool[]; onTools: (t: Tool[]) => void }) {
  const [installing, setInstalling] = useState<{ id: string; pct: number } | null>(null);
  const missing = tools.filter((t) => !t.ok);

  async function install(list: Tool[]) {
    for (const t of list) {
      await onboardingApi.install(t.id, (pct) => setInstalling({ id: t.id, pct }));
      onTools(await onboardingApi.tools());
    }
    setInstalling(null);
    toast.success("Tools installed");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Dependencies</CardTitle>
          <CardDescription>Installed locally in Tapfleet's app folder.</CardDescription>
        </div>
        {missing.length > 0 && (
          <Button disabled={!!installing} onClick={() => install(missing)}>
            <Download /> Install all
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {tools.length === 0 && <p className="text-sm text-muted-foreground">Checking…</p>}
        {tools.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2.5">
            {t.ok ? (
              <CheckCircle2 className="size-5 text-primary" />
            ) : installing?.id === t.id ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Circle className="size-5 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {t.name}
                {t.optional && <Badge variant="outline">Optional</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">
                {installing?.id === t.id ? `Installing… ${installing.pct}%` : t.ok ? `v${t.version}` : t.why}
              </div>
            </div>
            {!t.ok && (
              <Button size="sm" variant="outline" disabled={!!installing} onClick={() => install([t])}>
                Install
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PhoneStep(props: {
  phone: { model: string; android: string } | null;
  onPhone: (p: { model: string; android: string } | null) => void;
}) {
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    const p = await onboardingApi.findPhone();
    setChecking(false);
    props.onPhone(p);
    if (!p) toast.error("No device detected. Check USB debugging and retry.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.phone ? `${props.phone.model} connected` : "Connect a device"}</CardTitle>
        <CardDescription>
          {props.phone ? `Android ${props.phone.android}` : "Follow these steps on your device."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol className="flex flex-col gap-3">
          {PHONE_STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              {props.phone ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div>
                <div className="text-sm font-medium">
                  {i + 1}. {s.title}
                </div>
                {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
        {!props.phone && (
          <Button onClick={check} disabled={checking} className="self-start">
            {checking ? <Loader2 className="animate-spin" /> : <Search />} Detect device
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function HelpersStep(props: { phone: { model: string } | null; done: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function install() {
    setBusy(true);
    await onboardingApi.installHelpers();
    setBusy(false);
    props.onDone();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Install helpers</CardTitle>
        <CardDescription>
          Installs Appium helper APKs on {props.phone?.model ?? "your device"}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {props.done ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-primary" /> Helpers installed
          </div>
        ) : (
          <Button onClick={install} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />} Install helpers
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function DoneStep() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <PartyPopper className="size-10 text-primary" />
        <div className="text-lg font-semibold">Ready to go</div>
        <p className="max-w-sm text-sm text-muted-foreground">
          Sign in to TikTok on the device, then sync accounts.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" render={<a href="#devices" />}>
            Devices
          </Button>
          <Button render={<a href="#accounts" />}>Accounts</Button>
        </div>
      </CardContent>
    </Card>
  );
}
