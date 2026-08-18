"use client";

import { Fragment, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  DatabaseZap,
  EyeOff,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { VendorProbeResult } from "@neko-master/shared";
import { toast } from "sonner";
import { api, type TimeRange } from "@/lib/api";
import { getVendorEndpointsQueryKey, getVendorStatsQueryKey } from "@/lib/stats-query-keys";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import { formatBytes, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface VendorContentProps {
  activeBackendId?: number;
  timeRange: TimeRange;
  onRefresh?: () => Promise<void> | void;
}

interface ManualRuleRow {
  id: number;
  vendorId: number;
  vendorName: string;
  vendorColor: string;
  pattern: string;
  matchType: "exact" | "suffix";
  priority: number;
}

interface ManualRuleEditorState {
  ruleId: number | null;
  replaceExisting: boolean;
  sourceVendorId: number | null;
  vendorId: number;
  customVendorName: string;
  customVendorColor: string;
  rules: Array<{
    id?: number;
    pattern: string;
    matchType: "exact" | "suffix";
    priority: number;
  }>;
}

export function VendorContent({ activeBackendId, timeRange, onRefresh }: VendorContentProps) {
  const t = useTranslations("vendors");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [sourceIP, setSourceIP] = useState("");
  const [expandedVendorId, setExpandedVendorId] = useState<number | null>(null);
  const [endpointLimit, setEndpointLimit] = useState(10);
  const [ruleEditor, setRuleEditor] = useState<ManualRuleEditorState | null>(null);
  const [deletingRule, setDeletingRule] = useState<ManualRuleRow | null>(null);
  const [probeDomain, setProbeDomain] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<VendorProbeResult | null>(null);
  const stableRange = useStableTimeRange(timeRange, { roundToMinute: true });
  const queryRange = stableRange ?? timeRange;
  const query = useQuery({
    queryKey: getVendorStatsQueryKey(activeBackendId, queryRange, sourceIP),
    queryFn: () => api.getVendorStats(activeBackendId!, queryRange, sourceIP || undefined),
    enabled: !!activeBackendId,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const allDevicesQuery = useQuery({
    queryKey: getVendorStatsQueryKey(activeBackendId, queryRange),
    queryFn: () => api.getVendorStats(activeBackendId!, queryRange),
    enabled: !!activeBackendId && !!sourceIP,
    staleTime: 60_000,
  });
  const vendorsQuery = useQuery({
    queryKey: ["vendors", "dictionary"],
    queryFn: api.getVendors,
    staleTime: 5 * 60_000,
  });
  const automationQuery = useQuery({
    queryKey: ["vendors", "automation", activeBackendId],
    queryFn: () => api.getVendorAutomation(activeBackendId!),
    enabled: !!activeBackendId,
    staleTime: 60_000,
  });
  const endpointsQuery = useQuery({
    queryKey: getVendorEndpointsQueryKey(activeBackendId, expandedVendorId ?? undefined, queryRange, sourceIP, endpointLimit),
    queryFn: () => api.getVendorEndpoints(
      activeBackendId!, expandedVendorId!, queryRange, sourceIP || undefined, endpointLimit,
    ),
    enabled: !!activeBackendId && !!expandedVendorId,
    placeholderData: keepPreviousData,
  });
  const updateEndpointLimit = (limit: number) => {
    setEndpointLimit(limit);
  };
  const syncMutation = useMutation({
    mutationFn: api.syncVendorCatalog,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vendors"] }),
        queryClient.invalidateQueries({ queryKey: ["stats", "vendors"] }),
      ]);
    },
  });
  const runAutomationMutation = useMutation({
    mutationFn: api.runVendorAutomation,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vendors"] }),
        queryClient.invalidateQueries({ queryKey: ["stats", "vendors"] }),
      ]);
      toast.success(t("automationRunFinished", {
        domains: result.domainSubjects,
        suggestions: result.suggestionsCreated,
        autoApplied: result.autoApplied,
      }));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("automationRunFailed")),
  });
  const applySuggestionMutation = useMutation({
    mutationFn: (id: number) => api.applyVendorSuggestion(id),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vendors"] }),
        queryClient.invalidateQueries({ queryKey: ["stats", "vendors"] }),
      ]);
      toast.success(t("suggestionApplied", { rows: result.reclassification.scannedRows }));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("suggestionApplyFailed")),
  });
  const dismissSuggestionMutation = useMutation({
    mutationFn: (id: number) => api.dismissVendorSuggestion(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["vendors"] });
      await queryClient.invalidateQueries({ queryKey: ["stats", "vendors"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("suggestionDismissFailed")),
  });
  const probeMutation = useMutation({
    mutationFn: (domain: string) => api.probeVendorDomains(activeBackendId!, [domain]),
    onSuccess: (response) => setProbeResult(response.results[0] ?? null),
    onError: () => toast.error(t("probeFailed")),
  });
  const openProbe = (domain: string) => {
    setProbeDomain(domain);
    setProbeResult(null);
    probeMutation.mutate(domain);
  };
  const addProbeRule = (result: VendorProbeResult, vendorId: number) => {
    setProbeDomain(null);
    setProbeResult(null);
    probeMutation.reset();
    setRuleEditor({
      ruleId: null,
      replaceExisting: false,
      sourceVendorId: null,
      vendorId,
      customVendorName: "",
      customVendorColor: "#64748b",
      rules: [{ pattern: result.normalizedDomain, matchType: "suffix", priority: 100 }],
    });
  };
  const saveRuleMutation = useMutation({
    mutationFn: async (draft: ManualRuleEditorState) => {
      const normalizedRules = draft.rules
        .map((rule) => ({
          pattern: rule.pattern.trim().replace(/^=/, "").trim(),
          matchType: rule.matchType,
          priority: Math.max(1, Math.min(1000, Math.round(rule.priority || 100))),
        }))
        .filter((rule) => rule.pattern);
      if (!normalizedRules.length) throw new Error(t("manualRuleDomainRequired"));
      if (draft.vendorId === -1) {
        const name = draft.customVendorName.trim();
        if (!name) throw new Error(t("customVendorNameRequired"));
        const slugHint = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        await api.createVendor({
          slug: `custom-${slugHint || "vendor"}-${Date.now().toString(36)}`,
          name,
          color: draft.customVendorColor || "#64748b",
          priority: 50,
          moveFromVendorId: draft.sourceVendorId ?? undefined,
          rules: normalizedRules,
        });
        return api.reclassifyVendorHistory(30);
      }
      const vendor = vendorsQuery.data?.find((item) => item.id === draft.vendorId);
      if (!vendor) throw new Error(t("vendorNotFound"));
      const existing = vendor.rules
        .filter((rule) => rule.source === "manual")
        .map((rule) => ({
          pattern: rule.pattern,
          matchType: rule.matchType,
          priority: rule.priority,
        }));
      await api.updateVendor(vendor.id, {
        moveFromVendorId: draft.sourceVendorId !== null && draft.sourceVendorId !== vendor.id
          ? draft.sourceVendorId
          : undefined,
        rules: draft.replaceExisting ? normalizedRules : [...existing, ...normalizedRules],
      });
      return api.reclassifyVendorHistory(30);
    },
    onSuccess: async (result) => {
      setRuleEditor(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vendors"] }),
        queryClient.invalidateQueries({ queryKey: ["stats", "vendors"] }),
      ]);
      toast.success(t("rulesSaved", { rows: result.scannedRows }));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("rulesSaveFailed")),
  });
  const deleteRuleMutation = useMutation({
    mutationFn: async (rule: ManualRuleRow) => {
      const vendor = vendorsQuery.data?.find((item) => item.id === rule.vendorId);
      if (!vendor) throw new Error(t("vendorNotFound"));
      const rules = vendor.rules
        .filter((item) => item.source === "manual" && item.id !== rule.id)
        .map((item) => ({
          pattern: item.pattern,
          matchType: item.matchType,
          priority: item.priority,
        }));
      await api.updateVendor(vendor.id, { rules });
      return api.reclassifyVendorHistory(30);
    },
    onSuccess: async (result) => {
      setDeletingRule(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vendors"] }),
        queryClient.invalidateQueries({ queryKey: ["stats", "vendors"] }),
      ]);
      toast.success(t("ruleDeleted", { rows: result.scannedRows }));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("ruleDeleteFailed")),
  });

  const sourceIPs = useMemo(() => {
    const sourceData = allDevicesQuery.data ?? query.data;
    const values = new Set(sourceData?.byDevice.map((item) => item.sourceIP) ?? []);
    return [...values].sort();
  }, [allDevicesQuery.data, query.data]);
  const editableVendors = useMemo(
    () => (vendorsQuery.data ?? []).filter((vendor) => vendor.enabled),
    [vendorsQuery.data],
  );
  const manualRules = useMemo(() => (vendorsQuery.data ?? [])
    .flatMap((vendor) => vendor.rules
      .filter((rule) => rule.source === "manual")
      .map((rule): ManualRuleRow => ({
        id: rule.id,
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorColor: vendor.color,
        pattern: rule.pattern,
        matchType: rule.matchType,
        priority: rule.priority,
      })))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName) || a.pattern.localeCompare(b.pattern)),
  [vendorsQuery.data]);
  const manualRuleGroups = useMemo(() => {
    const groups = new Map<number, { vendorId: number; vendorName: string; vendorColor: string; rules: ManualRuleRow[] }>();
    for (const rule of manualRules) {
      const group = groups.get(rule.vendorId) ?? {
        vendorId: rule.vendorId,
        vendorName: rule.vendorName,
        vendorColor: rule.vendorColor,
        rules: [],
      };
      group.rules.push(rule);
      groups.set(rule.vendorId, group);
    }
    return [...groups.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  }, [manualRules]);
  const totalTraffic = query.data?.totals.reduce(
    (sum, item) => sum + item.upload + item.download,
    0,
  ) ?? 0;
  const unknownTraffic = query.data?.totals
    .filter((item) => item.vendorSlug === "unknown")
    .reduce((sum, item) => sum + item.upload + item.download, 0) ?? 0;
  const fallbackRecognition = totalTraffic > 0 ? (totalTraffic - unknownTraffic) / totalTraffic : 0;
  const quality = query.data?.quality;

  if (!activeBackendId) {
    return (
      <Card><CardContent className="p-12 text-center text-muted-foreground">{t("selectBackend")}</CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sourceIP}
            onChange={(event) => setSourceIP(event.target.value)}
            aria-label={t("deviceFilter")}
            className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">{t("allDevices")}</option>
            {sourceIPs.map((ip) => <option key={ip} value={ip}>{ip}</option>)}
          </select>
          <Button variant="outline" size="icon" onClick={() => onRefresh ? onRefresh() : query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`w-4 h-4 ${query.isFetching ? "animate-spin" : ""}`} />
            <span className="sr-only">{t("refresh")}</span>
          </Button>
        </div>
      </div>

      {query.isError ? (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <TriangleAlert className="w-8 h-8 text-destructive mx-auto" />
            <p className="font-medium">{t("loadError")}</p>
            <Button variant="outline" onClick={() => query.refetch()}>{t("retry")}</Button>
          </CardContent>
        </Card>
      ) : query.isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-28 rounded-xl bg-muted/50 animate-pulse" />)}
        </div>
      ) : !query.data?.totals.length ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t("noData")}</p>
            <p className="text-sm mt-1 opacity-70">{t("noDataHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <MetricCard label={t("totalTraffic")} value={formatBytes(quality?.totalTraffic ?? totalTraffic)} />
            <MetricCard label={t("recognized")} value={formatPercent(quality?.totalRecognitionRate ?? fallbackRecognition)} />
            <MetricCard label={t("domainObservation")} value={formatPercent(quality?.domainObservationRate ?? 0)} />
            <MetricCard label={t("recognizedDomains")} value={formatPercent(quality?.recognizedDomainRate ?? 0)} />
            <MetricCard label={t("rulesLoaded")} value={formatNumber(vendorsQuery.data?.reduce((sum, item) => sum + item.rules.length, 0) ?? 0)} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">{t("vendorRanking")}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>{t("vendor")}</TableHead>
                  <TableHead className="text-right">{t("download")}</TableHead>
                  <TableHead className="text-right">{t("upload")}</TableHead>
                  <TableHead className="text-right">{t("connections")}</TableHead>
                  <TableHead className="text-right">{t("share")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {query.data.totals.map((item) => {
                    const traffic = item.upload + item.download;
                    const protocols = (query.data.protocols ?? []).filter((protocol) => protocol.vendorId === item.vendorId);
                    const protocolTotals = protocols.reduce(
                      (total, protocol) => ({
                        upload: total.upload + protocol.upload,
                        download: total.download + protocol.download,
                        connections: total.connections + protocol.connections,
                      }),
                      { upload: 0, download: 0, connections: 0 },
                    );
                    const protocolOverflow =
                      protocolTotals.upload > item.upload ||
                      protocolTotals.download > item.download ||
                      protocolTotals.connections > item.connections;
                    const visibleProtocols = protocolOverflow ? [] : protocols;
                    const missingProtocol = {
                      upload: protocolOverflow ? item.upload : Math.max(0, item.upload - protocolTotals.upload),
                      download: protocolOverflow ? item.download : Math.max(0, item.download - protocolTotals.download),
                      connections: protocolOverflow
                        ? item.connections
                        : Math.max(0, item.connections - protocolTotals.connections),
                    };
                    const missingProtocolTraffic = missingProtocol.upload + missingProtocol.download;
                    const expanded = expandedVendorId === item.vendorId;
                    return (
                      <Fragment key={item.vendorId}>
                        <TableRow>
                          <TableCell className="font-medium">
                            <button
                              type="button"
                              className="inline-flex items-center text-left hover:text-primary"
                              onClick={() => setExpandedVendorId(expanded ? null : item.vendorId)}
                              aria-expanded={expanded}
                            >
                              {expanded ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
                              <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: item.color }} />
                              {item.vendorName}
                            </button>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatBytes(item.download)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBytes(item.upload)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(item.connections)}</TableCell>
                          <TableCell className="text-right tabular-nums">{totalTraffic > 0 ? `${(traffic / totalTraffic * 100).toFixed(1)}%` : "—"}</TableCell>
                        </TableRow>
                        {expanded && (visibleProtocols.length > 0 || missingProtocolTraffic > 0 ? (
                          <>
                            {visibleProtocols.map((protocol) => {
                              const protocolTraffic = protocol.upload + protocol.download;
                              return (
                                <TableRow key={`${item.vendorId}:${protocol.transport}:${protocol.applicationProtocol}:${protocol.confidence}`} className="bg-muted/30">
                                  <TableCell className="pl-12 text-sm text-muted-foreground">
                                    {t(`protocol.${protocol.applicationProtocol}`)} · {protocol.transport.toUpperCase()}
                                    <span className="ml-2 text-xs opacity-70">{t(`confidence.${protocol.confidence}`)}</span>
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-sm">{formatBytes(protocol.download)}</TableCell>
                                  <TableCell className="text-right tabular-nums text-sm">{formatBytes(protocol.upload)}</TableCell>
                                  <TableCell className="text-right tabular-nums text-sm">{formatNumber(protocol.connections)}</TableCell>
                                  <TableCell className="text-right tabular-nums text-sm">{traffic > 0 ? `${(protocolTraffic / traffic * 100).toFixed(1)}%` : "—"}</TableCell>
                                </TableRow>
                              );
                            })}
                            {missingProtocolTraffic > 0 && (
                              <TableRow key={`${item.vendorId}:historical-unavailable`} className="bg-muted/30">
                                <TableCell className="pl-12 text-sm text-muted-foreground">{t("protocolHistoricalUnavailable")}</TableCell>
                                <TableCell className="text-right tabular-nums text-sm">{formatBytes(missingProtocol.download)}</TableCell>
                                <TableCell className="text-right tabular-nums text-sm">{formatBytes(missingProtocol.upload)}</TableCell>
                                <TableCell className="text-right tabular-nums text-sm">{formatNumber(missingProtocol.connections)}</TableCell>
                                <TableCell className="text-right tabular-nums text-sm">{traffic > 0 ? `${(missingProtocolTraffic / traffic * 100).toFixed(1)}%` : "—"}</TableCell>
                              </TableRow>
                            )}
                          </>
                        ) : (
                          <TableRow className="bg-muted/30"><TableCell colSpan={5} className="pl-12 text-sm text-muted-foreground">{t("protocolNoData")}</TableCell></TableRow>
                        ))}
                        {expanded && (
                          <TableRow className="bg-muted/15">
                            <TableCell colSpan={5} className="px-6 py-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium">{t("topEndpoints", { count: endpointLimit })}</p>
                                  {item.vendorSlug === "unknown" && (
                                    <p className="mt-1 text-xs text-muted-foreground">{t("networkOwnerHint")}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">{t("canonicalEndpointHint")}</span>
                                  <select
                                    value={endpointLimit}
                                    onChange={(event) => updateEndpointLimit(Number(event.target.value))}
                                    aria-label={t("endpointCount")}
                                    className="h-8 rounded-md border bg-background px-2 text-xs"
                                  >
                                    {[10, 20, 50].map((count) => (
                                      <option key={count} value={count}>{t("endpointCountOption", { count })}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              {endpointsQuery.isLoading ? (
                                <div className="h-16 rounded bg-muted/40 animate-pulse" />
                              ) : endpointsQuery.isError ? (
                                <p className="text-sm text-destructive">{t("endpointLoadError")}</p>
                              ) : !endpointsQuery.data?.endpoints.length ? (
                                <p className="text-sm text-muted-foreground">{t("endpointNoData")}</p>
                              ) : (
                                <div className="space-y-2">
                                  {endpointsQuery.data.endpoints.map((endpoint, index) => {
                                    const endpointTraffic = endpoint.upload + endpoint.download;
                                    return (
                                      <div key={`${endpoint.endpointType}:${endpoint.endpoint}`} className="grid gap-2 rounded-lg border bg-background/60 px-3 py-2 text-xs md:grid-cols-[32px_minmax(0,1fr)_150px_110px_90px] md:items-center">
                                        <span className="text-muted-foreground tabular-nums">#{index + 1}</span>
                                        <div className="min-w-0">
                                          <p className="truncate font-mono">{endpoint.endpoint}</p>
                                          {endpoint.resolvedDomain ? (
                                            <p className="truncate text-muted-foreground mt-0.5">
                                              {endpoint.resolvedDomain}
                                              {endpoint.resolvedVendorName ? ` · ${endpoint.resolvedVendorName}` : ""}
                                              {endpoint.resolutionSource ? ` · ${t(`resolutionSource.${endpoint.resolutionSource}`)}` : ""}
                                            </p>
                                          ) : endpoint.endpointType === "ip" ? (
                                            <p className="truncate text-muted-foreground mt-0.5">
                                              {formatEndpointRegion(
                                                endpoint.networkOwner,
                                                endpoint.city,
                                                endpoint.country,
                                                endpoint.countryName,
                                                locale,
                                              ) || t("regionUnknown")}
                                            </p>
                                          ) : null}
                                        </div>
                                        <span className="text-muted-foreground">
                                          {endpoint.applicationProtocol === "other" && endpoint.transport === "unknown"
                                            ? t("protocolHistoricalUnavailable")
                                            : `${t(`protocol.${endpoint.applicationProtocol}`)} · ${endpoint.transport.toUpperCase()}`}
                                        </span>
                                        <span className="text-right tabular-nums">{formatBytes(endpointTraffic)}</span>
                                        <span className="text-right text-muted-foreground">{formatNumber(endpoint.connections)} · {formatNumber(endpoint.devices)} {t("devicesShort")}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><DatabaseZap className="w-4 h-4" />{t("automation")}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">{automationQuery.data?.sniffer.message ?? t("automationLoading")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={runAutomationMutation.isPending}
                  onClick={() => runAutomationMutation.mutate()}
                >
                  <Play className={`w-4 h-4 mr-2 ${runAutomationMutation.isPending ? "animate-spin" : ""}`} />
                  {t("runAutomation")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncMutation.isPending}
                  onClick={() => syncMutation.mutate()}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  {t("syncCatalog")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-3 text-sm">
                <StatusItem label={t("catalogStatus")} value={automationQuery.data ? t(`catalog.${automationQuery.data.catalog.status}`) : "—"} />
                <StatusItem label={t("catalogRevision")} value={automationQuery.data?.catalog.revision?.slice(0, 12) ?? "—"} mono />
                <StatusItem label={t("catalogRules")} value={formatNumber(automationQuery.data?.catalog.rulesCount ?? 0)} />
              </div>
              {syncMutation.isError && <p className="text-sm text-destructive">{t("syncError")}</p>}
              {automationQuery.data?.catalog.error && <p className="text-sm text-destructive">{automationQuery.data.catalog.error}</p>}
              {automationQuery.data?.snifferImpact && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium">{t("snifferImpactTitle")}</p>
                  <p className="mt-1 text-muted-foreground">
                    {t("snifferImpactText", {
                      unknown: formatBytes(automationQuery.data.snifferImpact.unknownIPTraffic),
                      total: formatBytes(automationQuery.data.snifferImpact.totalTraffic),
                      rate: ((automationQuery.data.snifferImpact.potentialRate ?? 0) * 100).toFixed(1),
                      protocols: automationQuery.data.snifferImpact.protocols.join(", ") || "—",
                    })}
                  </p>
                </div>
              )}
              {!!automationQuery.data?.suggestions?.length && (
                <div>
                  <p className="text-sm font-medium mb-2">{t("vendorSuggestions")}</p>
                  <p className="mb-3 text-xs text-muted-foreground">{t("vendorSuggestionsHint")}</p>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>{t("domain")}</TableHead>
                      <TableHead>{t("suggestedVendor")}</TableHead>
                      <TableHead>{t("confidence")}</TableHead>
                      <TableHead className="text-right">{t("traffic")}</TableHead>
                      <TableHead className="text-right">{t("actions")}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {automationQuery.data.suggestions.map((suggestion) => (
                        <TableRow key={suggestion.id}>
                          <TableCell className="font-mono text-xs">
                            <div>{suggestion.subject}</div>
                            {suggestion.reasons.length > 0 && (
                              <div className="mt-1 max-w-[320px] truncate text-muted-foreground">
                                {suggestion.reasons.slice(0, 3).join(" · ")}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: suggestion.suggestedVendorColor }} />
                              {suggestion.suggestedVendorName}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={suggestion.confidence === "high" ? "text-emerald-600" : "text-amber-600"}>
                              {t(`suggestionConfidence.${suggestion.confidence}`)} · {suggestion.score}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatBytes(suggestion.trafficBytes)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={applySuggestionMutation.isPending}
                              onClick={() => applySuggestionMutation.mutate(suggestion.id)}
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />{t("applySuggestion")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={dismissSuggestionMutation.isPending}
                              onClick={() => dismissSuggestionMutation.mutate(suggestion.id)}
                            >
                              <EyeOff className="mr-1 h-3.5 w-3.5" />{t("dismissSuggestion")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {!!automationQuery.data?.unknownCandidates.length && (
                <div>
                  <p className="text-sm font-medium mb-2">{t("unknownCandidates")}</p>
                  <p className="mb-3 text-xs text-muted-foreground">{t("unknownCandidatesHint")}</p>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>{t("domain")}</TableHead>
                      <TableHead className="text-right">{t("traffic")}</TableHead>
                      <TableHead className="text-right">{t("connections")}</TableHead>
                      <TableHead className="text-right">{t("devices")}</TableHead>
                      <TableHead className="text-right">{t("actions")}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {automationQuery.data.unknownCandidates.slice(0, 12).map((candidate) => (
                        <TableRow key={candidate.registrableDomain}>
                          <TableCell className="font-mono text-xs">{candidate.registrableDomain}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBytes(candidate.upload + candidate.download)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(candidate.connections)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(candidate.devices)}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => openProbe(candidate.registrableDomain)} disabled={probeMutation.isPending}>
                              <Search className="mr-1 h-3.5 w-3.5" />{t("probeDomain")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">{t("manualRulesTitle")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t("manualRulesDescription")}</p>
              </div>
              <Button
                size="sm"
                disabled={!editableVendors.length}
                onClick={() => setRuleEditor({
                  ruleId: null,
                  replaceExisting: false,
                  sourceVendorId: null,
                  vendorId: 0,
                  customVendorName: "",
                  customVendorColor: "#64748b",
                  rules: [{ pattern: "", matchType: "suffix", priority: 100 }],
                })}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("addManualRule")}
              </Button>
            </CardHeader>
            <CardContent>
              {vendorsQuery.isLoading ? (
                <div className="h-20 rounded bg-muted/40 animate-pulse" />
              ) : manualRules.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("manualRulesEmpty")}</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t("vendor")}</TableHead>
                    <TableHead>{t("manualRuleDomains")}</TableHead>
                    <TableHead>{t("manualRuleMatchType")}</TableHead>
                    <TableHead className="text-right">{t("manualRuleCount")}</TableHead>
                    <TableHead className="w-[92px] text-right">{t("actions")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {manualRuleGroups.map((group) => (
                      <TableRow key={group.vendorId}>
                        <TableCell>
                          <span className="inline-flex items-center">
                            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.vendorColor }} />
                            {group.vendorName}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div className="space-y-1">
                            {group.rules.map((rule) => (
                              <div key={rule.id} className="flex items-center gap-2">
                                <span>{rule.pattern}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive hover:text-destructive"
                                  title={t("deleteManualRule")}
                                  onClick={() => setDeletingRule(rule)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 text-xs">
                            {group.rules.map((rule) => <div key={rule.id}>{t(`manualRuleMatch.${rule.matchType}`)} · {rule.priority}</div>)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{group.rules.length}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={t("editManualRule")}
                            onClick={() => setRuleEditor({
                              ruleId: group.rules[0]?.id ?? null,
                              replaceExisting: true,
                              sourceVendorId: group.vendorId,
                              vendorId: group.vendorId,
                              customVendorName: "",
                              customVendorColor: "#64748b",
                              rules: group.rules.map((rule) => ({
                                id: rule.id,
                                pattern: rule.pattern,
                                matchType: rule.matchType,
                                priority: rule.priority,
                              })),
                            })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {!sourceIP && query.data.byDevice.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">{t("deviceVendorRanking")}</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t("device")}</TableHead>
                    <TableHead>{t("vendor")}</TableHead>
                    <TableHead className="text-right">{t("traffic")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {query.data.byDevice.slice(0, 30).map((item) => (
                      <TableRow key={`${item.sourceIP}:${item.vendorId}`}>
                        <TableCell className="font-mono text-xs">{item.sourceIP}</TableCell>
                        <TableCell>{item.vendorName}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBytes(item.upload + item.download)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={ruleEditor !== null} onOpenChange={(open) => !open && setRuleEditor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{ruleEditor?.replaceExisting ? t("editManualRule") : t("addManualRule")}</DialogTitle></DialogHeader>
          {ruleEditor && <div className="space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span>{t("vendor")}</span>
              <select
                value={ruleEditor.vendorId}
                onChange={(event) => setRuleEditor({ ...ruleEditor, vendorId: Number(event.target.value) })}
                className="h-10 w-full rounded-md border bg-background px-3"
              >
                <option value={0} disabled>{t("selectVendorForRule")}</option>
                <option value={-1}>{t("createCustomVendor")}</option>
                {editableVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </select>
              {ruleEditor.ruleId !== null && <span className="block text-xs text-muted-foreground">{t("manualRuleVendorChangeHint")}</span>}
            </label>
            {ruleEditor.vendorId === -1 && <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-3 rounded-lg border bg-muted/20 p-3">
              <label className="block space-y-1.5 text-sm">
                <span>{t("customVendorName")}</span>
                <input
                  value={ruleEditor.customVendorName}
                  onChange={(event) => setRuleEditor({ ...ruleEditor, customVendorName: event.target.value })}
                  className="h-10 w-full rounded-md border bg-background px-3"
                  placeholder={t("customVendorNamePlaceholder")}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span>{t("customVendorColor")}</span>
                <input
                  type="color"
                  value={ruleEditor.customVendorColor}
                  onChange={(event) => setRuleEditor({ ...ruleEditor, customVendorColor: event.target.value })}
                  className="h-10 w-full cursor-pointer rounded-md border bg-background p-1"
                />
              </label>
              <p className="col-span-2 text-xs text-muted-foreground">{t("customVendorHint")}</p>
            </div>}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("manualRuleDomains")}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setRuleEditor({
                  ...ruleEditor,
                  rules: [...ruleEditor.rules, { pattern: "", matchType: "suffix", priority: 100 }],
                })}>
                  <Plus className="mr-1 h-3.5 w-3.5" />{t("addDomain")}
                </Button>
              </div>
              {ruleEditor.rules.map((rule, index) => (
                <div key={rule.id ?? `new-${index}`} className="grid grid-cols-[minmax(0,1fr)_130px_82px_32px] gap-2 items-end rounded-lg border p-2">
                  <label className="block space-y-1.5 text-sm">
                    <span>{t("manualRuleDomain")}</span>
                    <input
                      value={rule.pattern}
                      onChange={(event) => setRuleEditor({ ...ruleEditor, rules: ruleEditor.rules.map((item, itemIndex) => itemIndex === index ? { ...item, pattern: event.target.value } : item) })}
                      className="h-10 w-full rounded-md border bg-background px-3 font-mono"
                      placeholder="example.com"
                      autoFocus={index === 0}
                    />
                  </label>
                  <label className="block space-y-1.5 text-sm">
                    <span>{t("manualRuleMatchType")}</span>
                    <select
                      value={rule.matchType}
                      onChange={(event) => setRuleEditor({ ...ruleEditor, rules: ruleEditor.rules.map((item, itemIndex) => itemIndex === index ? { ...item, matchType: event.target.value as "exact" | "suffix" } : item) })}
                      className="h-10 w-full rounded-md border bg-background px-3"
                    >
                      <option value="suffix">{t("manualRuleMatch.suffix")}</option>
                      <option value="exact">{t("manualRuleMatch.exact")}</option>
                    </select>
                  </label>
                  <label className="block space-y-1.5 text-sm">
                    <span>{t("manualRulePriority")}</span>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={rule.priority}
                      onChange={(event) => setRuleEditor({ ...ruleEditor, rules: ruleEditor.rules.map((item, itemIndex) => itemIndex === index ? { ...item, priority: Number(event.target.value) } : item) })}
                      className="h-10 w-full rounded-md border bg-background px-3"
                    />
                  </label>
                  <Button type="button" variant="ghost" size="icon" className="h-10 w-8 text-destructive" disabled={ruleEditor.rules.length === 1} onClick={() => setRuleEditor({ ...ruleEditor, rules: ruleEditor.rules.filter((_, itemIndex) => itemIndex !== index) })}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("manualRuleEditorHint")}</p>
          </div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleEditor(null)}>{t("cancel")}</Button>
            <Button
              onClick={() => ruleEditor && saveRuleMutation.mutate(ruleEditor)}
              disabled={saveRuleMutation.isPending || !ruleEditor?.vendorId || !ruleEditor.rules.some((rule) => rule.pattern.trim())
                || (ruleEditor.vendorId === -1 && !ruleEditor.customVendorName.trim())}
            >
              {t("saveRules")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={probeDomain !== null} onOpenChange={(open) => { if (!open) { setProbeDomain(null); setProbeResult(null); probeMutation.reset(); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t("probeDomainTitle")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{probeDomain} · {t("probeDomainHint")}</p>
          {probeMutation.isPending && <p className="py-8 text-center text-sm text-muted-foreground">{t("probeLoading")}</p>}
          {probeResult && <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <Evidence title={t("probeDns")} value={[...probeResult.dns.addresses, ...probeResult.dns.cnames].join(", ") || probeResult.dns.error || t("probeError")} />
              <Evidence title={t("probeHttp")} value={[probeResult.http.status, probeResult.http.title, probeResult.http.server].filter(Boolean).join(" · ") || probeResult.http.error || t("probeError")} />
              <Evidence title={t("probeRdap")} value={[probeResult.rdap.organization, probeResult.rdap.registrar, probeResult.rdap.country].filter(Boolean).join(" · ") || probeResult.rdap.error || t("probeError")} />
              <Evidence title={t("probeFinalUrl")} value={probeResult.http.finalUrl || t("probeError")} />
            </div>
            <div className="rounded-lg border p-3">
              <p className="mb-2 font-medium">{t("probeSuggestions")}</p>
              <p className="mb-3 text-xs text-muted-foreground">{t("probeSuggestionHint")}</p>
              {probeResult.suggestions.length === 0 && <p className="text-muted-foreground">{t("probeNoSuggestion")}</p>}
              <div className="space-y-2">
                {probeResult.suggestions.map((suggestion) => <div key={suggestion.vendorId} className="flex items-center justify-between gap-3 rounded-md bg-muted/30 p-2">
                  <div><span className="font-medium">{suggestion.vendorName}</span><span className="ml-2 text-xs text-muted-foreground">{t(`probeConfidence.${suggestion.confidence}`)}</span><p className="text-xs text-muted-foreground">{suggestion.reasons.join(" · ")}</p></div>
                  <Button size="sm" onClick={() => addProbeRule(probeResult, suggestion.vendorId)}>{t("addProbeRule")}</Button>
                </div>)}
              </div>
            </div>
          </div>}
          <DialogFooter>
            {probeResult && <Button variant="outline" onClick={() => addProbeRule(probeResult, 0)}>{t("addProbeRuleChoose")}</Button>}
            <Button variant="outline" onClick={() => setProbeDomain(null)}>{t("cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingRule !== null} onOpenChange={(open) => !open && setDeletingRule(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("deleteManualRuleTitle")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deletingRule ? t("deleteManualRuleDescription", {
              pattern: deletingRule.pattern,
              vendor: deletingRule.vendorName,
            }) : ""}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingRule(null)}>{t("cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => deletingRule && deleteRuleMutation.mutate(deletingRule)}
              disabled={deleteRuleMutation.isPending}
            >
              {t("deleteManualRule")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Evidence({ title, value }: { title: string; value: string }) {
  return <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{title}</p><p className="mt-1 break-all font-mono text-xs">{value}</p></div>;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatEndpointRegion(
  networkOwner: string | null,
  city: string | null,
  countryCode: string | null,
  countryName: string | null,
  locale: string,
): string {
  if (networkOwner?.trim()) {
    return [networkOwner.trim(), countryCode].filter(Boolean).join(" · ");
  }

  let localizedCountry = countryName ?? countryCode;
  if (countryCode) {
    try {
      localizedCountry = new Intl.DisplayNames([locale], { type: "region" }).of(countryCode) ?? localizedCountry;
    } catch {
      // Keep the GeoIP country name when the runtime cannot localize the region code.
    }
  }
  return [city, localizedCountry].filter(Boolean).join(" · ");
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-4 border bg-card shadow-xs">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold mt-2 tabular-nums">{value}</p>
    </div>
  );
}

function StatusItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-medium mt-1 ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}
