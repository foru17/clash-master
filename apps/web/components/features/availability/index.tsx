"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CircleAlert, Clock3, Plus, RefreshCw, Trash2, Wifi } from "lucide-react";
import type { AvailabilityMonitor, MonitorType } from "@neko-master/shared";
import { toast } from "sonner";
import { api, type TimeRange } from "@/lib/api";
import { getMonitorOverviewQueryKey, getMonitorsQueryKey } from "@/lib/stats-query-keys";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import { cn, formatAppDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface AvailabilityContentProps {
  timeRange: TimeRange;
}

type MonitorForm = {
  name: string;
  type: MonitorType;
  target: string;
  port: string;
  dnsServer: string;
  intervalSeconds: string;
  timeoutMs: string;
  failureThreshold: string;
};

const EMPTY_FORM: MonitorForm = {
  name: "",
  type: "icmp",
  target: "",
  port: "",
  dnsServer: "",
  intervalSeconds: "60",
  timeoutMs: "5000",
  failureThreshold: "3",
};

export function AvailabilityContent({ timeRange }: AvailabilityContentProps) {
  const t = useTranslations("availability");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const stableRange = useStableTimeRange(timeRange, { roundToMinute: true });
  const queryRange = stableRange ?? timeRange;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MonitorForm>(EMPTY_FORM);
  const [webhookDraft, setWebhookDraft] = useState<{ enabled: boolean; url: string } | null>(null);

  const monitorsQuery = useQuery({
    queryKey: getMonitorsQueryKey(),
    queryFn: api.getMonitors,
    refetchInterval: 15_000,
  });
  const incidentsQuery = useQuery({
    queryKey: ["availability", "incidents"],
    queryFn: () => api.getMonitorIncidents(50),
    refetchInterval: 30_000,
  });
  const overviewQuery = useQuery({
    queryKey: getMonitorOverviewQueryKey(queryRange),
    queryFn: () => api.getMonitorOverview(queryRange, 96),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const webhookQuery = useQuery({
    queryKey: ["availability", "webhook"],
    queryFn: api.getMonitorWebhook,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["availability"] });
  };
  const createMutation = useMutation({
    mutationFn: () => api.createMonitor({
      name: form.name,
      type: form.type,
      target: form.target,
      port: form.port ? Number(form.port) : null,
      dnsServer: form.dnsServer || null,
      intervalSeconds: Number(form.intervalSeconds),
      timeoutMs: Number(form.timeoutMs),
      failureThreshold: Number(form.failureThreshold),
    }),
    onSuccess: async () => {
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      await invalidate();
      toast.success(t("created"));
    },
    onError: () => toast.error(t("operationFailed")),
  });
  const toggleMutation = useMutation({
    mutationFn: (monitor: AvailabilityMonitor) => api.updateMonitor(monitor.id, { enabled: !monitor.enabled }),
    onSuccess: invalidate,
    onError: () => toast.error(t("operationFailed")),
  });
  const deleteMutation = useMutation({
    mutationFn: api.deleteMonitor,
    onSuccess: async () => {
      await invalidate();
      toast.success(t("deleted"));
    },
    onError: () => toast.error(t("operationFailed")),
  });
  const testMutation = useMutation({
    mutationFn: api.testMonitor,
    onSuccess: (result) => toast[result.status === "down" ? "error" : "success"](
      `${t(`status.${result.status}`)} · ${result.latencyMs ?? "—"}ms · ${result.message}`,
    ),
    onError: () => toast.error(t("operationFailed")),
  });
  const webhookMutation = useMutation({
    mutationFn: () => api.updateMonitorWebhook(webhookDraft ?? webhookQuery.data ?? { enabled: false, url: "" }),
    onSuccess: (config) => {
      setWebhookDraft(config);
      toast.success(t("webhookSaved"));
    },
    onError: () => toast.error(t("operationFailed")),
  });

  const monitors = useMemo(() => monitorsQuery.data ?? [], [monitorsQuery.data]);
  const webhookConfig = webhookDraft ?? webhookQuery.data ?? { enabled: false, url: "" };
  const summary = useMemo(() => ({
    up: monitors.filter((monitor) => monitor.status === "up").length,
    down: monitors.filter((monitor) => monitor.status === "down").length,
    degraded: monitors.filter((monitor) => monitor.status === "degraded").length,
    total: monitors.length,
  }), [monitors]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Activity className="w-5 h-5" />{t("title")}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}><Plus className="w-4 h-4 mr-2" />{t("add")}</Button>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatusMetric label={t("total")} value={summary.total} icon={<Wifi className="w-4 h-4" />} />
        <StatusMetric label={t("online")} value={summary.up} tone="up" icon={<Activity className="w-4 h-4" />} />
        <StatusMetric label={t("offline")} value={summary.down} tone="down" icon={<CircleAlert className="w-4 h-4" />} />
        <StatusMetric label={t("degraded")} value={summary.degraded} tone="degraded" icon={<Clock3 className="w-4 h-4" />} />
      </div>

      {monitorsQuery.isError ? (
        <Card><CardContent className="p-8 text-center space-y-3"><p>{t("loadError")}</p><Button variant="outline" onClick={() => monitorsQuery.refetch()}>{t("retry")}</Button></CardContent></Card>
      ) : monitorsQuery.isLoading ? (
        <div className="grid md:grid-cols-2 gap-3">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 rounded-xl bg-muted/50 animate-pulse" />)}</div>
      ) : monitors.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground"><Activity className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>{t("noMonitors")}</p></CardContent></Card>
      ) : (
        <TooltipProvider delayDuration={150}>
          <div className="grid gap-4 md:grid-cols-2">
            {monitors.map((monitor) => {
              const overview = overviewQuery.data?.find((item) => item.monitorId === monitor.id);
              return (
                <Card key={monitor.id} className="overflow-hidden">
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <StatusDot status={monitor.status} />
                          <span className="font-medium truncate">{monitor.name}</span>
                          <span className="text-[10px] uppercase text-muted-foreground border rounded px-1.5 py-0.5">{monitor.type}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">{monitor.target}{monitor.port ? `:${monitor.port}` : ""}</p>
                        <p className="text-xs mt-2 truncate">{t(`status.${monitor.status}`)} · {monitor.latencyMs ?? "—"}ms · {monitor.message || t("waiting")}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => testMutation.mutate(monitor.id)} disabled={testMutation.isPending}><RefreshCw className="w-4 h-4" /><span className="sr-only">{t("test")}</span></Button>
                        <Switch checked={monitor.enabled} onCheckedChange={() => toggleMutation.mutate(monitor)} aria-label={t("toggle")} />
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => {
                          if (window.confirm(t("confirmDelete", { name: monitor.name }))) deleteMutation.mutate(monitor.id);
                        }}><Trash2 className="w-4 h-4" /><span className="sr-only">{t("delete")}</span></Button>
                      </div>
                    </div>

                    <div className="border-t pt-3 space-y-2">
                      <div className="flex items-end justify-between gap-3">
                        <span className="text-xs text-muted-foreground">{t("uptime")}</span>
                        <span className="text-xl font-semibold tabular-nums">
                          {overview?.availability == null ? "—" : `${(overview.availability * 100).toFixed(2)}%`}
                        </span>
                      </div>
                      {overviewQuery.isError ? (
                        <button className="text-xs text-destructive underline" onClick={() => overviewQuery.refetch()}>{t("historyError")} {t("retry")}</button>
                      ) : overviewQuery.isLoading ? (
                        <div className="h-10 rounded bg-muted/50 animate-pulse" />
                      ) : overview?.history.length ? (
                        <div className="flex h-10 items-end gap-px" aria-label={t("history")}>
                          {overview.history.map((point) => (
                            <Tooltip key={point.time}>
                              <TooltipTrigger asChild>
                                <span
                                  className={cn("flex-1 min-w-px rounded-sm", point.status === "down" ? "bg-rose-500" : point.status === "degraded" ? "bg-amber-500" : "bg-emerald-500")}
                                  style={{ height: `${Math.max(28, Math.min(100, (point.averageLatencyMs ?? 20) / 5))}%` }}
                                />
                              </TooltipTrigger>
                              <TooltipContent className="space-y-1 text-xs">
                                <p>{formatAppDateTime(point.time, locale)} · {t(`status.${point.status}`)}</p>
                                <p>{t("latencyDetails", { average: point.averageLatencyMs ?? "—", min: point.minLatencyMs ?? "—", max: point.maxLatencyMs ?? "—" })}</p>
                                <p>{t("checkDetails", { checks: point.checks, down: point.downChecks, degraded: point.degradedChecks })}</p>
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      ) : <p className="text-xs text-muted-foreground">{t("noHistory")}</p>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TooltipProvider>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t("recentIncidents")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {incidentsQuery.isError ? <p className="text-sm text-destructive">{t("loadError")}</p> : !incidentsQuery.data?.length ? <p className="text-sm text-muted-foreground">{t("noIncidents")}</p> : incidentsQuery.data.slice(0, 8).map((incident) => (
            <div key={incident.id} className="border-b last:border-0 pb-2 last:pb-0">
              <div className="flex justify-between gap-2 text-sm"><span className="font-medium truncate">{incident.monitorName}</span><span className={incident.status === "open" ? "text-rose-500" : "text-emerald-500"}>{t(`incident.${incident.status}`)}</span></div>
              <p className="text-xs text-muted-foreground mt-1">{formatAppDateTime(incident.startedAt, locale)} · {incident.message}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t("webhook")}</CardTitle></CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <Switch checked={webhookConfig.enabled} onCheckedChange={(enabled) => setWebhookDraft({ ...webhookConfig, enabled })} aria-label={t("webhookEnabled")} />
          <Input value={webhookConfig.url} onChange={(event) => setWebhookDraft({ ...webhookConfig, url: event.target.value })} placeholder={t("webhookPlaceholder")} aria-label={t("webhookUrl")} />
          <Button variant="outline" onClick={() => webhookMutation.mutate()} disabled={webhookMutation.isPending}>{t("save")}</Button>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("addTitle")}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <FormField label={t("name")}><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></FormField>
            <FormField label={t("type")}>
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as MonitorType })} className="h-9 rounded-md border bg-background px-3 text-sm">
                {(["icmp", "tcp", "http", "dns"] as MonitorType[]).map((type) => <option key={type} value={type}>{t(`types.${type}`)}</option>)}
              </select>
            </FormField>
            <FormField label={t("target")}><Input value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} placeholder={form.type === "http" ? "https://example.com" : "10.0.1.1"} /></FormField>
            {form.type === "tcp" && <FormField label={t("port")}><Input type="number" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></FormField>}
            {form.type === "dns" && <FormField label={t("dnsServer")}><Input value={form.dnsServer} onChange={(event) => setForm({ ...form, dnsServer: event.target.value })} placeholder="10.0.1.10" /></FormField>}
            <div className="grid grid-cols-3 gap-3">
              <FormField label={t("interval")}><Input type="number" value={form.intervalSeconds} onChange={(event) => setForm({ ...form, intervalSeconds: event.target.value })} /></FormField>
              <FormField label={t("timeout")}><Input type="number" value={form.timeoutMs} onChange={(event) => setForm({ ...form, timeoutMs: event.target.value })} /></FormField>
              <FormField label={t("retries")}><Input type="number" value={form.failureThreshold} onChange={(event) => setForm({ ...form, failureThreshold: event.target.value })} /></FormField>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button><Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name.trim() || !form.target.trim()}>{t("create")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusDot({ status }: { status: AvailabilityMonitor["status"] }) {
  return <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", status === "up" ? "bg-emerald-500" : status === "down" ? "bg-rose-500" : status === "degraded" ? "bg-amber-500" : "bg-slate-400")} />;
}

function StatusMetric({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone?: "up" | "down" | "degraded" }) {
  return <div className="rounded-xl p-4 border bg-card shadow-xs"><div className={cn("flex items-center gap-2 text-muted-foreground", tone === "up" && "text-emerald-500", tone === "down" && "text-rose-500", tone === "degraded" && "text-amber-500")}>{icon}<span className="text-xs">{label}</span></div><p className="text-xl font-semibold mt-2 tabular-nums">{value}</p></div>;
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
