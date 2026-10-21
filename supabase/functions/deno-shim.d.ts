// Type-checking only (npm run typecheck): the bits of the Deno runtime the Edge Functions use.
// Deno itself never loads this file.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
