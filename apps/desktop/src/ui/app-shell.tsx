import { USER_ROLES, type UserRole } from "@anecites/shared";
import type { ReactElement, ReactNode } from "react";

import { Badge, Separator } from "./primitives.js";

export interface ShellIdentity {
  subject: string;
  displayName: string;
  role: UserRole;
}

export interface ShellNavigationItem {
  href: string;
  label: string;
  path: string;
}

export interface ApplicationShellProps {
  identity: ShellIdentity | null;
  activePath: string;
  contextLabel?: string | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
  onNavigate?: ((path: string) => void) | undefined;
  showNativeMonitor?: boolean | undefined;
}

const commonNavigation: readonly ShellNavigationItem[] = [
  { href: "#session-setup", label: "Meeting", path: "/workspace/session" },
  { href: "#interview-workspace", label: "Interview workspace", path: "/workspace/interview" },
  { href: "#native-monitor", label: "Native monitor", path: "/workspace/monitor" },
];

const reviewNavigationItem: ShellNavigationItem = {
  href: "#review-queue",
  label: "Review queue",
  path: "/review",
};

const roleWorkspaceLabel: Record<UserRole, string> = {
  candidate: "Candidate workspace",
  interviewer: "Interviewer workspace",
  reviewer: "Review workspace",
  admin: "Organization admin",
};

export function ApplicationShell({
  identity,
  activePath,
  contextLabel,
  actions,
  children,
  onNavigate,
  showNativeMonitor = true,
}: ApplicationShellProps): ReactElement {
  const navigationItems = getShellNavigation(identity?.role ?? null, { showNativeMonitor });
  const activeItem = navigationItems.find((item) => isNavigationItemActive(activePath, item.path));
  const initials = getInitials(identity?.displayName ?? "Anecites");

  return (
    <div className="application-shell" data-shell-role={identity?.role ?? "unknown"}>
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>

      <aside className="application-sidebar" aria-label="Application">
        <a className="application-brand" href="#main-content" aria-label="Anecites workspace">
          <span className="application-brand-mark" aria-hidden="true">
            A
          </span>
          <span>Anecites</span>
        </a>

        <Separator />

        <nav className="application-navigation" aria-label="Workspace navigation">
          <p className="application-navigation-label">Workspace</p>
          {navigationItems.map((item) => {
            const active = isNavigationItemActive(activePath, item.path);

            return (
              <a
                key={item.path}
                href={item.href}
                className="application-navigation-link"
                data-active={active || undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => onNavigate?.(item.path)}
              >
                <span className="application-navigation-marker" aria-hidden="true" />
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="application-identity">
          <Separator />
          <div className="application-identity-row">
            <span className="application-avatar" aria-hidden="true">
              {initials}
            </span>
            <div>
              <strong>{identity?.displayName ?? "Local workspace"}</strong>
              <span>{identity ? formatRole(identity.role) : "Role unavailable"}</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="application-main-column">
        <header className="application-topbar">
          <div className="application-context">
            <span>{identity ? roleWorkspaceLabel[identity.role] : "Interview operations"}</span>
            <span aria-hidden="true">/</span>
            <strong>{activeItem?.label ?? "Workspace"}</strong>
            {contextLabel ? <Badge tone="neutral">Session {contextLabel}</Badge> : null}
          </div>
          {actions ? <div className="application-actions">{actions}</div> : null}
        </header>

        <main className="application-content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function getShellNavigation(
  role: UserRole | null,
  options: { showNativeMonitor?: boolean } = {},
): readonly ShellNavigationItem[] {
  const workspaceNavigation = options.showNativeMonitor === false
    ? commonNavigation.filter((item) => item.path !== "/workspace/monitor")
    : commonNavigation;

  if (role === "reviewer" || role === "admin") {
    return [...workspaceNavigation, reviewNavigationItem];
  }

  return workspaceNavigation;
}

export function isNavigationItemActive(activePath: string, itemPath: string): boolean {
  const normalizedActivePath = normalizePath(activePath);
  const normalizedItemPath = normalizePath(itemPath);

  return (
    normalizedActivePath === normalizedItemPath || normalizedActivePath.startsWith(`${normalizedItemPath}/`)
  );
}

// These claims only drive presentation. The backend still verifies the JWT and enforces authorization.
export function readShellIdentity(authToken: string, displayName: string): ShellIdentity | null {
  try {
    const payloadSegment = authToken.split(".")[1];
    if (!payloadSegment) {
      return null;
    }

    const payload = JSON.parse(decodeBase64Url(payloadSegment)) as unknown;
    if (!isRecord(payload)) {
      return null;
    }

    const subject = payload.sub;
    const role = payload.role;
    if (typeof subject !== "string" || subject.trim().length === 0 || !isUserRole(role)) {
      return null;
    }

    const normalizedDisplayName = displayName.trim();
    return {
      subject: subject.trim(),
      displayName: normalizedDisplayName || subject.trim(),
      role,
    };
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "/") {
    return trimmed;
  }

  return trimmed.replace(/\/+$/g, "");
}

function formatRole(role: UserRole): string {
  if (role === "admin") {
    return "Organization admin";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}

function getInitials(value: string): string {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "A";
}
