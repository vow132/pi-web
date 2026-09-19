import { NextRequest, NextResponse } from "next/server";
import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { isApiRequestAllowed } from "@/lib/request-security";

// The customized build lives in a git checkout whose single custom commit sits
// on top of upstream agegr/pi-web main. Updates = merge upstream, rebuild,
// swap the deployed .next, restart — handled by the detached script below so
// the service restart never kills the HTTP response.
const SRC_DIR = "/root/pi-web-src";
const SCRIPT = "/root/piweb-config-backups/auto-update.sh";
const STATUS_FILE = "/root/piweb-config-backups/auto-update-status.json";
const RUNNING_FILE = "/root/piweb-config-backups/auto-update.running";
const DEPLOYED_PACKAGE = "/usr/lib/node_modules/@agegr/pi-web/package.json";
const CHECK_CACHE_TTL_MS = 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __piCustomUpdateCache: { checkedAt: number; result: UpdateStatus } | undefined;
}

interface UpdateStatus {
  available: boolean;
  running: boolean;
  deployedVersion: string | null;
  upstreamVersion: string | null;
  head: string | null;
  upstreamHead: string | null;
  lastStatus: { ok: boolean; message: string; finishedAt?: string } | null;
  checkedAt: string;
}

function git(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", SRC_DIR, ...args], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString().trim() || error.message));
        return;
      }
      resolve(stdout.toString().trim());
    });
  });
}

async function readUpstreamVersion(): Promise<string | null> {
  try {
    const raw = await git(["show", "upstream/main:package.json"]);
    return JSON.parse(raw).version ?? null;
  } catch {
    return null;
  }
}

function readDeployedVersion(): string | null {
  try {
    return JSON.parse(fs.readFileSync(DEPLOYED_PACKAGE, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function readLastStatus(): UpdateStatus["lastStatus"] {
  try {
    const raw = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
    return {
      ok: Boolean(raw.ok),
      message: String(raw.message ?? ""),
      finishedAt: raw.finishedAt,
    };
  } catch {
    return null;
  }
}

async function collectStatus(): Promise<UpdateStatus> {
  const deployedVersion = readDeployedVersion();
  const base: UpdateStatus = {
    available: false,
    running: fs.existsSync(RUNNING_FILE),
    deployedVersion,
    upstreamVersion: null,
    head: null,
    upstreamHead: null,
    lastStatus: readLastStatus(),
    checkedAt: new Date().toISOString(),
  };

  try {
    const head = await git(["rev-parse", "HEAD"]);
    await git(["fetch", "upstream", "main"]);
    const upstreamHead = await git(["rev-parse", "upstream/main"]);
    // Ancestor check: when upstream/main is already contained in HEAD there is
    // nothing newer; otherwise upstream moved and an update can be applied.
    let available = false;
    try {
      await git(["merge-base", "--is-ancestor", "upstream/main", "HEAD"]);
    } catch {
      available = true;
    }
    return {
      ...base,
      available,
      head,
      upstreamHead,
      upstreamVersion: await readUpstreamVersion(),
    };
  } catch {
    return base;
  }
}

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const cached = globalThis.__piCustomUpdateCache;
  if (cached && Date.now() - cached.checkedAt < CHECK_CACHE_TTL_MS && !cached.result.running) {
    return NextResponse.json(cached.result);
  }
  const result = await collectStatus();
  globalThis.__piCustomUpdateCache = { checkedAt: Date.now(), result };
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!fs.existsSync(SCRIPT)) {
    return NextResponse.json({ error: "Update script is missing on the server" }, { status: 500 });
  }
  if (fs.existsSync(RUNNING_FILE)) {
    return NextResponse.json({ error: "An update is already running" }, { status: 409 });
  }

  const status = await collectStatus();
  if (!status.available) {
    return NextResponse.json({ error: "Already up to date" }, { status: 409 });
  }

  // Detached so the swap + service restart survives this response and this
  // process being stopped mid-flight.
  const child = spawn("bash", [SCRIPT], { detached: true, stdio: "ignore" });
  child.unref();
  globalThis.__piCustomUpdateCache = undefined;

  return NextResponse.json({ ok: true, started: true });
}
