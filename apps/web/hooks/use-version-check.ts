"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const GITHUB_REPO =
  process.env.NEXT_PUBLIC_GITHUB_REPO || "zhangjf108/Home-Network-Monitor";
const GITHUB_PACKAGE_URL =
  `https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/main/package.json`;
const GITHUB_API_URL =
  `https://api.github.com/repos/${GITHUB_REPO}`;
const CHECK_INTERVAL = 30 * 60 * 1000; // Check every 30 minutes
const FETCH_TIMEOUT = 10000; // 10 seconds

/**
 * Compare two semver version strings.
 * Returns > 0 if remote is newer, 0 if equal, < 0 if current is newer.
 */
function compareVersions(current: string, remote: string): number {
  const a = current.replace(/^v/, "").split(".").map(Number);
  const b = remote.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] || 0) - (a[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

interface VersionCheckResult {
  /** The latest version from GitHub, null if not yet checked or failed */
  latestVersion: string | null;
  /** Whether a newer version is available */
  hasUpdate: boolean;
  /** Whether the check is currently in progress */
  isChecking: boolean;
  /** GitHub stars count, null if not yet fetched or failed */
  stars: number | null;
  /** Manually trigger a version check */
  checkNow: () => void;
}

export function useVersionCheck(currentVersion: string): VersionCheckResult {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [stars, setStars] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    // Abort any in-flight request before starting a new one
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsChecking(true);
    try {
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      // Fetch version and stars in parallel
      const [pkgRes, repoRes] = await Promise.allSettled([
        fetch(GITHUB_PACKAGE_URL, {
          cache: "no-store",
          signal: controller.signal,
        }),
        fetch(GITHUB_API_URL, {
          cache: "no-store",
          signal: controller.signal,
        }),
      ]);

      clearTimeout(timeoutId);

      // Don't update state if aborted (e.g. component unmounted)
      if (controller.signal.aborted) return;

      // Handle version check
      if (pkgRes.status === "fulfilled" && pkgRes.value.ok) {
        const pkg = await pkgRes.value.json();
        if (pkg.version) {
          setLatestVersion(pkg.version);
          setHasUpdate(compareVersions(currentVersion, pkg.version) > 0);
        }
      }

      // Handle stars count
      if (repoRes.status === "fulfilled" && repoRes.value.ok) {
        const repo = await repoRes.value.json();
        if (typeof repo.stargazers_count === "number") {
          setStars(repo.stargazers_count);
        }
      }
    } catch {
      // Silently fail — network errors, timeouts, CORS issues, etc.
    } finally {
      if (!controller.signal.aborted) {
        setIsChecking(false);
      }
    }
  }, [currentVersion]);

  useEffect(() => {
    // Initial check with a short delay to avoid blocking page load
    const initialTimer = setTimeout(check, 3000);

    // Periodic checks
    const interval = setInterval(check, CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      // Abort any in-flight request on unmount
      abortRef.current?.abort();
    };
  }, [check]);

  return { latestVersion, hasUpdate, isChecking, stars, checkNow: check };
}
