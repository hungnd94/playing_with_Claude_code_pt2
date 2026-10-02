// Ambient declarations for the atlas dev harness bundle.
declare module "virtual:history" {
  export const simulateHistory: ((...args: any[]) => unknown) | undefined;
}
