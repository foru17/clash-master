"use client";

import Image from "next/image";
import { ExternalLink, ArrowUpCircle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { useVersionCheck } from "@/hooks/use-version-check";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
const GITHUB_REPO =
  process.env.NEXT_PUBLIC_GITHUB_REPO || "zhangjf108/Home-Network-Monitor";
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
const UPSTREAM_URL = "https://github.com/foru17/neko-master";

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const aboutT = useTranslations("about");
  const { latestVersion, hasUpdate, isChecking, stars, checkNow } =
    useVersionCheck(APP_VERSION);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-[560px] relative">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              About
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* App Info */}
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
              <Image
                src="/logo.png"
                alt="Home Network Monitor"
                width={64}
                height={64}
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <h3 className="text-xl font-bold">{aboutT("projectName")}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {aboutT("description")}
              </p>
            </div>
          </div>

          {/* All card rows with consistent spacing */}
          <div className="space-y-2">
            {/* Current Version */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/50">
              <span className="text-sm font-medium">
                {aboutT("currentVersion")}
              </span>
              <span className="text-sm font-mono tabular-nums text-primary font-semibold">
                v{APP_VERSION}
              </span>
            </div>

            {/* Latest Version / Update Status */}
            {hasUpdate && latestVersion ? (
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-xl border min-h-[3rem] bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10 transition-colors group">
                <div>
                  <span className="text-sm font-medium">
                    {aboutT("latestVersion")}
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {aboutT("updateAvailable")} · v{APP_VERSION} → v
                    {latestVersion}
                  </p>
                </div>
                <div className="flex items-center gap-2 h-7 shrink-0">
                  <span className="text-sm font-mono tabular-nums text-emerald-500 font-semibold flex items-center gap-1.5">
                    <ArrowUpCircle className="w-4 h-4" />v{latestVersion}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-emerald-500 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </a>
            ) : (
              <div className="flex items-center justify-between p-3 rounded-xl border min-h-[3rem] bg-secondary/50 border-border/50">
                <span className="text-sm font-medium">
                  {aboutT("latestVersion")}
                </span>
                <div className="flex items-center gap-2 h-7 min-w-[5.5rem] justify-end">
                  {isChecking ? (
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      {aboutT("checkingUpdate")}
                    </span>
                  ) : latestVersion ? (
                    <span className="text-sm text-muted-foreground">
                      ✓ {aboutT("upToDate")}
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={checkNow}>
                      <RefreshCw className="w-3 h-3 mr-1" />
                      {aboutT("checkNow")}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* License */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/50">
              <span className="text-sm font-medium">{aboutT("license")}</span>
              <span className="text-sm text-muted-foreground">MIT</span>
            </div>

            <a
              href={UPSTREAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/50 hover:bg-secondary/80 hover:border-primary/30 transition-all group gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{aboutT("basedOn")}</p>
                <p className="text-xs text-muted-foreground truncate">{aboutT("upstreamProject")}</p>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
            </a>

            {/* GitHub Link */}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/50 hover:bg-secondary/80 hover:border-primary/30 transition-all group gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <svg
                  viewBox="0 0 24 24"
                  className="w-5 h-5 fill-foreground shrink-0"
                  aria-hidden="true">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {aboutT("openSource")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {stars !== null && (
                  <span className="flex items-center gap-1 text-xs font-medium">
                    <svg
                      viewBox="0 0 16 16"
                      className="w-3.5 h-3.5 fill-amber-500 shrink-0"
                      aria-hidden="true">
                      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z" />
                    </svg>
                    <span className="text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                      {stars >= 1000
                        ? `${(stars / 1000).toFixed(1)}k`
                        : stars}
                    </span>
                  </span>
                )}
                <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              </div>
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
