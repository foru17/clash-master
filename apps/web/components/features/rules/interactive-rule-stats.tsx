"use client";

import { useState, useCallback, useMemo, useEffect, useRef, startTransition } from "react";
import { BarChart3, Link2, Waypoints } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell as BarCell, LabelList } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { api, type GatewayRulesResponse, type TimeRange } from "@/lib/api";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import { useStatsWebSocket } from "@/lib/websocket";
import {
  getRuleDomainsQueryKey,
  getRuleIPsQueryKey,
} from "@/lib/stats-query-keys";
import { useRules, useGatewayRules, useRuleDomains, useRuleIPs } from "@/hooks/api/use-rules";
import {
  DomainStatsTable,
  IPStatsTable,
} from "@/components/features/stats/table";
import { Favicon } from "@/components/common/favicon";
import { useIsWindows } from "@/lib/hooks/use-is-windows";
import type { PageSize } from "@/lib/stats-utils";
import { UnifiedRuleChainFlow } from "@/components/features/rules/rule-chain-flow";
import { InsightChartSkeleton, InsightDetailSectionSkeleton, InsightThreePanelSkeleton } from "@/components/ui/insight-skeleton";
import type { RuleStats, StatsSummary } from "@neko-master/shared";

interface InteractiveRuleStatsProps {
  data?: RuleStats[];
  activeBackendId?: number;
  timeRange?: TimeRange;
  backendStatus?: "healthy" | "unhealthy" | "unknown";
  autoRefresh?: boolean;
}

const COLORS = [
  "#3B82F6", "#8B5CF6", "#06B6D4", "#10B981", "#F59E0B",
  "#EF4444", "#EC4899", "#6366F1", "#14B8A6", "#F97316",
];

const CHART_COLORS = [
  "#3B82F6", "#8B5CF6", "#06B6D4", "#10B981", "#F59E0B",
  "#EF4444", "#EC4899", "#6366F1", "#14B8A6", "#F97316",
];

const RULE_DETAIL_WS_MIN_PUSH_MS = 5_000;

interface RuleChartItem {
  name: string;
  rawName: string;
  value: number;
  download: number;
  upload: number;
  connections: number;
  finalProxy?: string;
  color: string;
  rank: number;
  hasTraffic: boolean;
}

interface RuleDomainChartItem {
  name: string;
  fullDomain: string;
  total: number;
  download: number;
  upload: number;
  connections: number;
  color: string;
}

// Custom label renderer for bar chart
function renderCustomBarLabel(props: any) {
  const { x, y, width, value, height } = props;
  return (
    <text
      x={x + width + 6}
      y={y + height / 2}
      fill="currentColor"
      fontSize={11}
      dominantBaseline="central"
      textAnchor="start"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {formatBytes(value, 0)}
    </text>
  );
}

// Hook to detect container width for responsive chart items
function useContainerWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  
  useEffect(() => {
    if (!ref.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    
    observer.observe(ref.current);
    setWidth(ref.current.getBoundingClientRect().width);
    
    return () => observer.disconnect();
  }, [ref]);
  
  return width;
}

export function InteractiveRuleStats({
  data,
  activeBackendId,
  timeRange,
  backendStatus,
  autoRefresh = true,
}: InteractiveRuleStatsProps) {
  const t = useTranslations("rules");
  const domainsT = useTranslations("domains");
  const ipsT = useTranslations("ips");
  const backendT = useTranslations("dashboard");
  const queryClient = useQueryClient();
  const stableTimeRange = useStableTimeRange(timeRange, { roundToMinute: true });
  const detailTimeRange = stableTimeRange;
  const isWindows = useIsWindows();

  const { data: listData, isLoading: listQueryLoading } = useRules({
    activeBackendId,
    limit: 50,
    range: stableTimeRange,
    enabled: !data && !!activeBackendId,
  });
  const rulesData = data ?? listData ?? [];
  const listLoading = !data && listQueryLoading && !listData;
  
  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("domains");
  const [detailPageSize, setDetailPageSize] = useState<PageSize>(10);
  const [showDomainBarLabels, setShowDomainBarLabels] = useState(true);
  
  // Ref for TOP DOMAINS card to detect container width
  const topDomainsCardRef = useRef<HTMLDivElement>(null);
  const topDomainsWidth = useContainerWidth(topDomainsCardRef);
  const topDomainsItemCount = topDomainsWidth >= 500 ? 15 : 10;

  // Fetch Gateway rules to find zero-traffic rules.
  const { data: gatewayRules = null } = useGatewayRules({
    activeBackendId,
    enabled: !!activeBackendId,
  });

  useEffect(() => {
    const media = window.matchMedia("(min-width: 640px)");
    const update = () => setShowDomainBarLabels(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Fetch Gateway rules to find zero-traffic rules.
  // Ruleset metadata changes infrequently, so load on mount/backend switch only.

  const chartData = useMemo<RuleChartItem[]>(() => {
    if (!rulesData) return [];
    
    // Normalize rule names for deduplication (trim whitespace)
    const normalizeRuleName = (name: string) => name?.trim() || '';
    
    const existingRuleNames = new Set(rulesData.map(r => normalizeRuleName(r.rule)));
    const trafficItems: RuleChartItem[] = rulesData.map((rule, index) => ({
      name: normalizeRuleName(rule.rule),
      rawName: normalizeRuleName(rule.rule),
      value: rule.totalDownload + rule.totalUpload,
      download: rule.totalDownload,
      upload: rule.totalUpload,
      connections: rule.totalConnections,
      finalProxy: rule.finalProxy,
      color: COLORS[index % COLORS.length],
      rank: index,
      hasTraffic: true,
    }));

    // Append zero-traffic rules from Gateway API, using the target proxy group name
    // (rule.proxy) which matches how traffic data stores rule names for Surge.
    // Multiple low-level rules (RuleSet, ProcessName, etc.) can target the same
    // proxy group, so we deduplicate by proxy group name.
    if (gatewayRules?.rules) {
      const zeroTrafficItems: typeof trafficItems = [];
      for (const rule of gatewayRules.rules) {
        // Filter out internal/system rules that users typically don't configure manually or don't want to see
        // - 'GeoIP': Built-in country rules
        // - 'RuleSet': Surge's internal expansion of rulesets
        // - Empty payload: Invalid/Internal
        if (!rule.payload) continue;
        if (['GeoIP', 'RuleSet'].includes(rule.type)) continue;

        const proxyGroup = normalizeRuleName(rule.proxy);
        // Skip empty proxy names
        if (!proxyGroup) continue;
        // Skip if already exists (case-sensitive for emoji names)
        if (existingRuleNames.has(proxyGroup)) continue;
        existingRuleNames.add(proxyGroup);
        zeroTrafficItems.push({
          name: proxyGroup,
          rawName: proxyGroup,
          value: 0,
          download: 0,
          upload: 0,
          connections: 0,
          finalProxy: proxyGroup,
          color: "#9CA3AF",
          rank: trafficItems.length + zeroTrafficItems.length,
          hasTraffic: false,
        });
      }
      return [...trafficItems, ...zeroTrafficItems];
    }

    return trafficItems;
  }, [rulesData, gatewayRules]);

  const totalTraffic = useMemo(() => {
    return chartData.reduce((sum, item) => sum + item.value, 0);
  }, [chartData]);

  const topRules = useMemo(
    () => [...chartData].sort((a, b) => b.value - a.value).slice(0, 4),
    [chartData]
  );

  const maxTotal = useMemo(() => {
    if (!chartData.length) return 1;
    return Math.max(...chartData.map(r => r.value));
  }, [chartData]);

  // Compute set of visible rule names for filtering the graph
  const visibleRuleNames = useMemo(() => {
    return new Set(chartData.map(item => item.rawName));
  }, [chartData]);

  const wsDetailEnabled = autoRefresh && !!activeBackendId && !!selectedRule;
  const { status: wsDetailStatus } = useStatsWebSocket({
    backendId: activeBackendId,
    range: detailTimeRange,
    minPushIntervalMs: RULE_DETAIL_WS_MIN_PUSH_MS,
    includeSummary: false,
    includeRuleDetails: wsDetailEnabled,
    ruleName: selectedRule ?? undefined,
    ruleDetailLimit: 5000,
    trackLastMessage: false,
    enabled: wsDetailEnabled,
    onMessage: useCallback((stats: StatsSummary) => {
      if (!selectedRule) return;
      if (stats.ruleDetailName !== selectedRule) return;
      
      if (stats.ruleDomains) {
        queryClient.setQueryData(
          getRuleDomainsQueryKey(selectedRule, activeBackendId, detailTimeRange),
          stats.ruleDomains
        );
      }
      if (stats.ruleIPs) {
        queryClient.setQueryData(
          getRuleIPsQueryKey(selectedRule, activeBackendId, detailTimeRange),
          stats.ruleIPs
        );
      }
    }, [selectedRule, activeBackendId, detailTimeRange, queryClient]),
  });

  const { data: ruleDomains = [], isLoading: domainsLoading } = useRuleDomains({
    rule: selectedRule,
    activeBackendId,
    range: detailTimeRange,
    enabled: !wsDetailEnabled || wsDetailStatus !== "connected",
  });

  const { data: ruleIPs = [], isLoading: ipsLoading } = useRuleIPs({
    rule: selectedRule,
    activeBackendId,
    range: detailTimeRange,
    enabled: !wsDetailEnabled || wsDetailStatus !== "connected",
  });

  const loading = !!selectedRule && (domainsLoading || ipsLoading) && ruleDomains.length === 0 && ruleIPs.length === 0;

  // Default select first rule when data loads
  useEffect(() => {
    if (chartData.length === 0) {
      setSelectedRule(null);
      return;
    }
    const exists = !!selectedRule && chartData.some((item) => item.rawName === selectedRule);
    if (!exists) {
      setSelectedRule(chartData[0].rawName);
    }
  }, [chartData, selectedRule]);

  const handleRuleClick = useCallback((rule: string) => {
    if (selectedRule !== rule) {
      setSelectedRule(rule);
    }
  }, [selectedRule]);

  const selectedRuleData = useMemo(() => {
    return chartData.find(r => r.rawName === selectedRule);
  }, [chartData, selectedRule]);

  // Chart data
  const domainChartData = useMemo<RuleDomainChartItem[]>(() => {
    if (!ruleDomains?.length) return [];
    // Show more items in wide container (single column layout)
    const itemCount = topDomainsWidth >= 500 ? 15 : 10;
    const maxNameLength = topDomainsWidth >= 500 ? 35 : 15;
    return ruleDomains
      .slice(0, itemCount)
      .map((domain, index) => ({
        name: domain.domain.length > maxNameLength ? domain.domain.slice(0, maxNameLength - 3) + "..." : domain.domain,
        fullDomain: domain.domain,
        total: domain.totalDownload + domain.totalUpload,
        download: domain.totalDownload,
        upload: domain.totalUpload,
        connections: domain.totalConnections,
        color: CHART_COLORS[index % CHART_COLORS.length],
      }));
  }, [ruleDomains, topDomainsWidth]);

  const isBackendUnavailable = backendStatus === "unhealthy";
  const emptyHint = isBackendUnavailable
    ? backendT("backendUnavailableHint")
    : t("noDataHint");

  if (listLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-5 sm:p-6">
            <InsightThreePanelSkeleton />
          </CardContent>
        </Card>
        <InsightDetailSectionSkeleton />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="min-h-[220px] rounded-xl border border-dashed border-border/60 bg-card/30 px-4 py-6 flex flex-col items-center justify-center text-center">
            <Waypoints className="h-8 w-8 text-muted-foreground/70 mb-2" />
            <p className="text-sm font-medium text-muted-foreground">{t("noData")}</p>
            <p className="text-xs text-muted-foreground/80 mt-1 max-w-xs">{emptyHint}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Section: Three Column Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-6">
        {/* Left: Pie Chart */}
        <Card className="min-w-0 md:col-span-1 xl:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t("distribution")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2 pb-4">
            <div className="h-[165px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    isAnimationActive={false}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload;
                        return (
                          <div className="bg-background border border-border p-3 rounded-lg shadow-lg">
                            <p className="font-medium text-sm mb-1">{item.name}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(item.value)}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {topRules.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider text-center">
                  Top 4
                </p>
                <div className="mt-1 space-y-1.5">
                  {topRules.map((item, idx) => {
                    const rankBadgeClass = idx === 0
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      : idx === 1
                      ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      : idx === 2
                      ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                      : "bg-muted text-muted-foreground";

                    return (
                    <div
                      key={item.rawName}
                      title={item.name}
                      className="flex items-center gap-1.5 min-w-0"
                    >
                      <span
                        className={cn(
                          "w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0",
                          rankBadgeClass
                        )}
                      >
                        {idx + 1}
                      </span>
                      <span
                        className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-medium text-white/90 truncate min-w-0", isWindows && "emoji-flag-font")}
                        style={{ backgroundColor: item.color }}
                      >
                        {item.name}
                      </span>
                    </div>
                  );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Middle: Rule List */}
        <Card className="min-w-0 md:col-span-1 xl:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t("ruleList")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <ScrollArea className="h-[280px] pr-3">
              <div className="space-y-2">
                {chartData.map((item) => {
                const percentage = totalTraffic > 0 ? (item.value / totalTraffic) * 100 : 0;
                const barPercent = maxTotal > 0 ? (item.value / maxTotal) * 100 : 0;
                const isSelected = selectedRule === item.rawName;
                const noTraffic = !item.hasTraffic;

                // Badge color based on rank
                const badgeColor = noTraffic
                  ? "bg-muted text-muted-foreground"
                  : item.rank === 0
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : item.rank === 1
                  ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  : item.rank === 2
                  ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                  : "bg-muted text-muted-foreground";

                return (
                  <button
                    key={item.rawName}
                    onClick={() => !noTraffic && handleRuleClick(item.rawName)}
                    className={cn(
                      "w-full p-2.5 rounded-xl border text-left transition-all duration-200 overflow-hidden @container",
                      noTraffic
                        ? "border-border/30 bg-card/30 opacity-50 cursor-default"
                        : isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "border-border/50 bg-card/50 hover:bg-card hover:border-primary/30"
                    )}>
                    {/* Layout for wide container (default) */}
                    <div className="hidden @min-[200px]:block">
                      {/* Row 1: Rank + Name + Total */}
                      <div className="flex items-center gap-2 mb-1.5 min-w-0">
                        <span className={cn(
                          "w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0",
                          badgeColor
                        )}>
                          {noTraffic ? "–" : item.rank + 1}
                        </span>

                        <span 
                          className={cn("flex-1 text-sm font-medium truncate min-w-0", isWindows && "emoji-flag-font")} 
                          title={item.name}
                        >
                          {item.name}
                        </span>

                        <span className="text-sm font-bold tabular-nums shrink-0 whitespace-nowrap ml-auto">
                          {noTraffic ? (
                            <span className="text-xs font-normal text-muted-foreground">{t("noTrafficRecord")}</span>
                          ) : formatBytes(item.value)}
                        </span>
                      </div>

                      {/* Row 2: Progress bar + Stats (hidden for zero-traffic) */}
                      {!noTraffic && (
                      <div className="pl-7 space-y-1">
                        {/* Progress bar - dual color */}
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                          <div
                            className="h-full bg-blue-500 dark:bg-blue-400"
                            style={{ width: `${item.value > 0 ? (item.download / item.value) * barPercent : 0}%` }}
                          />
                          <div
                            className="h-full bg-purple-500 dark:bg-purple-400"
                            style={{ width: `${item.value > 0 ? (item.upload / item.value) * barPercent : 0}%` }}
                          />
                        </div>
                        {/* Stats */}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-blue-500 dark:text-blue-400 whitespace-nowrap">↓ {formatBytes(item.download)}</span>
                            <span className="text-purple-500 dark:text-blue-400 whitespace-nowrap">↑ {formatBytes(item.upload)}</span>
                            <span className="flex items-center gap-1 tabular-nums">
                              <Link2 className="w-3 h-3" />
                              {formatNumber(item.connections)}
                            </span>
                          </div>
                          <span className="tabular-nums">{percentage.toFixed(1)}%</span>
                        </div>
                      </div>
                      )}
                    </div>

                    {/* Layout for narrow container (vertical stack) */}
                    <div className="block @min-[200px]:hidden space-y-2">
                      {/* Row 1: Rank + Name */}
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0",
                          badgeColor
                        )}>
                          {noTraffic ? "–" : item.rank + 1}
                        </span>
                        <span className={cn("flex-1 text-sm font-medium line-clamp-2 leading-tight", isWindows && "emoji-flag-font")} title={item.name}>
                          {item.name}
                        </span>
                      </div>
                      
                      {/* Row 2: Stats Grid (hidden for zero-traffic) */}
                      {!noTraffic && (
                      <div className="pl-7 space-y-2">
                        {/* Total Traffic */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{t("total")}</span>
                          <span className="text-sm font-bold tabular-nums">{formatBytes(item.value)}</span>
                        </div>
                        
                        {/* Progress bar */}
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                          <div
                            className="h-full bg-blue-500 dark:bg-blue-400"
                            style={{ width: `${item.value > 0 ? (item.download / item.value) * 100 : 0}%` }}
                          />
                          <div
                            className="h-full bg-purple-500 dark:bg-purple-400"
                            style={{ width: `${item.value > 0 ? (item.upload / item.value) * 100 : 0}%` }}
                          />
                        </div>
                        
                        {/* Download / Upload / Connections */}
                        <div className="grid grid-cols-3 gap-1 text-xs">
                          <div className="text-center p-1 rounded bg-blue-50 dark:bg-blue-950/30">
                            <div className="text-blue-500 dark:text-blue-400 mb-0.5">↓</div>
                            <div className="font-medium tabular-nums truncate">{formatBytes(item.download)}</div>
                          </div>
                          <div className="text-center p-1 rounded bg-purple-50 dark:bg-purple-950/30">
                            <div className="text-purple-500 dark:text-purple-400 mb-0.5">↑</div>
                            <div className="font-medium tabular-nums truncate">{formatBytes(item.upload)}</div>
                          </div>
                          <div className="text-center p-1 rounded bg-muted/50">
                            <div className="text-muted-foreground mb-0.5"><Link2 className="w-3 h-3 mx-auto" /></div>
                            <div className="font-medium tabular-nums">{formatNumber(item.connections)}</div>
                          </div>
                        </div>
                      </div>
                      )}
                      
                      {/* Zero traffic message */}
                      {noTraffic && (
                        <div className="pl-7 text-xs text-muted-foreground">{t("noTrafficRecord")}</div>
                      )}
                    </div>
                  </button>
                );
              })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right: Top Domains Chart - Full width on single column, adapts to container */}
        <Card className="min-w-0 md:col-span-2 xl:col-span-5 @container h-full" ref={topDomainsCardRef}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                {t("topDomains")}
              </CardTitle>
              {selectedRuleData && (
                <span className={cn("text-xs text-muted-foreground", isWindows && "emoji-flag-font")}>
                  {selectedRuleData.name}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <InsightChartSkeleton />
            ) : domainChartData.length === 0 ? (
              <div className="h-[280px] rounded-xl border border-dashed border-border/60 bg-card/30 px-4 py-5 flex flex-col items-center justify-center text-center">
                <BarChart3 className="h-5 w-5 text-muted-foreground/70 mb-2" />
                <p className="text-sm font-medium text-muted-foreground">{domainsT("noData")}</p>
                <p className="text-xs text-muted-foreground/80 mt-1 max-w-xs">{emptyHint}</p>
              </div>
            ) : (
              <div className="h-[280px] @min-[500px]:h-[360px] w-full min-w-0 overflow-hidden sm:overflow-visible">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={domainChartData}
                    layout="vertical"
                    margin={{ top: 5, right: showDomainBarLabels ? 60 : 10, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid 
                      strokeDasharray="3 3" 
                      stroke="#888888" 
                      opacity={0.2} 
                      horizontal={false} 
                    />
                    <XAxis
                      type="number"
                      tickFormatter={(value) => formatBytes(value, 0)}
                      tick={{ fill: "#888888", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={{ fontSize: 10, fill: "currentColor" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <RechartsTooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0].payload;
                          return (
                            <div className="bg-background border border-border p-3 rounded-lg shadow-lg min-w-[200px] max-w-[90vw] sm:min-w-[280px]">
                              <div className="flex items-center gap-2 mb-3">
                                <Favicon domain={item.fullDomain} size="sm" />
                                <span className="font-medium text-sm text-foreground truncate max-w-[200px]">
                                  {item.fullDomain}
                                </span>
                              </div>
                              <div className="space-y-2 text-xs">
                                <div className="flex justify-between items-center">
                                  <span className="text-muted-foreground">Total Traffic</span>
                                  <span className="font-semibold text-foreground">{formatBytes(item.total)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-blue-500">Download</span>
                                  <span className="text-foreground">{formatBytes(item.download)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-purple-500">Upload</span>
                                  <span className="text-foreground">{formatBytes(item.upload)}</span>
                                </div>
                                <div className="flex justify-between items-center pt-1 border-t border-border/50">
                                  <span className="text-emerald-500">Connections</span>
                                  <span className="text-foreground">{formatNumber(item.connections)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                      cursor={{ fill: "rgba(128, 128, 128, 0.1)" }} 
                    />
                    <Bar
                      dataKey="total"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={24}
                      isAnimationActive={false}
                    >
                      {domainChartData.map((entry, index) => (
                        <BarCell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    {showDomainBarLabels && (
                      <LabelList
                        dataKey="total"
                        position="right"
                        content={renderCustomBarLabel}
                      />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Unified Chain Flow Visualization - shows all rules, highlights selected */}
      <UnifiedRuleChainFlow
        selectedRule={selectedRule}
        activeBackendId={activeBackendId}
        timeRange={stableTimeRange}
        autoRefresh={autoRefresh}
        visibleRuleNames={visibleRuleNames}
      />

      {/* Bottom Section: Domain List & IP Addresses with pagination */}
      {selectedRule ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Simplified Tabs - no icons, no counts, like Domains page */}
          <TabsList className="glass">
            <TabsTrigger value="domains">
              {domainsT("domainList")}
            </TabsTrigger>
            <TabsTrigger value="ips">
              {ipsT("ipList")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="domains" className="mt-4">
            <DomainStatsTable
              domains={ruleDomains}
              loading={loading}
              pageSize={detailPageSize}
              onPageSizeChange={setDetailPageSize}
              activeBackendId={activeBackendId}
              timeRange={timeRange}
              richExpand
              ruleName={selectedRule}
              contextKey={selectedRule}
            />
          </TabsContent>

          <TabsContent value="ips" className="mt-4">
            <IPStatsTable
              ips={ruleIPs}
              loading={loading}
              pageSize={detailPageSize}
              onPageSizeChange={setDetailPageSize}
              activeBackendId={activeBackendId}
              timeRange={timeRange}
              richExpand
              ruleName={selectedRule}
              contextKey={selectedRule}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <InsightDetailSectionSkeleton />
      )}
    </div>
  );
}
