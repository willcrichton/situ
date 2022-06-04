import { cli, copyPlugin } from "@nota-lang/esbuild-utils";
import alias from "esbuild-plugin-alias";
import { sassPlugin } from "esbuild-sass-plugin";
import { createRequire } from "module";

let build = cli();
const require = createRequire(import.meta.url);
build({
  format: "iife",
  bundle: true,
  plugins: [
    copyPlugin({ extensions: [".html"] }),
    sassPlugin(),
    alias({
      // Allow vscode imports in browser
      vscode: require.resolve("monaco-languageclient/vscode-compatibility"),
    }),
  ],
});
