// Ambient declarations for the globe dev harness bundle.
declare module "virtual:geo" {
  export const generatePhysical: ((params: unknown, rng: unknown, onProgress?: (stage: string, f: number) => void) => unknown) | undefined;
}
declare const __GLOBE_WORKER__: string;
