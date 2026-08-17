import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"], // The entry point of your application
  format: ["esm"], // Output ES Modules
  dts: true, // Generate declaration files (.d.ts)
  splitting: false, // Disable code splitting (optional)
  sourcemap: false, // Source maps for debugging
  clean: true, // Clean the dist folder before each build
});
