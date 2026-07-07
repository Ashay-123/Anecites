export const NATIVE_PERMISSION_SCOPES = [
  "process.scan",
  "window.scan",
  "capture_affinity.read",
  "vm.detect",
] as const;

export type NativePermissionScope = (typeof NATIVE_PERMISSION_SCOPES)[number];
