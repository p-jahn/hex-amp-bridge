# Hex → Amp rewrite bridge

Clean up [Hex](https://github.com/anomalyco/hex) dictation with Amp as an alternative to Hex's built-in OpenCode-backed rewrite.

A Hex Output transform sends text to an authenticated local plugin, which rewrites it through Amp's cloud generation API.

<img src="assets/bridge.gif" width="400" alt="A speech bubble travels from a speaking mouth through Hex and the Amp bridge to a cloud model, then returns as clean text in your app. Config cues show Hex enabling cleanup and the bridge selecting the model and routing.">

> **Experimental:** Built as a personal learning project and shared as-is. Use at your own risk; review rewritten text before relying on it.

> **A quick heads-up:** It's worth checking [Amp's Acceptable Use Policy](https://ampcode.com/terms/aup) before using the bridge, especially the restriction on using free credits as raw inference or a generic model backend outside Amp.

## Setup

Requires authenticated Amp with `amp.ai.generate`, Hex with custom Output transforms, and [Bun](https://bun.sh) for setup and tests.

1. Choose an accessible Amp thread and copy its ID.
2. Run from this directory, replacing `<THREAD_ID>`:

   ```sh copy Copy Setup Command
   bun setup.ts --thread <THREAD_ID> --model openai/gpt-6-luna --install-hex
   ```

3. If you already have a Hex config, merge the registration from [`hex.config.example.ts`](hex.config.example.ts) into it.
4. Reload Amp plugins and confirm `hex-rewrite` is active.
5. In Hex's **Output** pane, approve fetch and program access, then select **Rewrite with Amp**. Leave Hex's built-in rewrite off to avoid rewriting twice.

Setup preserves existing settings and credentials and refuses to overwrite differing installed files. For upgrades, review and replace those files manually, then reload. Changes to Hex's loaded files require reapproval.

## Configuration

Runtime files live outside the source checkout:

| Platform | Bridge directory |
| --- | --- |
| Windows | `%APPDATA%\hex-amp-bridge` |
| macOS | `~/Library/Application Support/hex-amp-bridge` |
| Linux | `$XDG_CONFIG_HOME/hex-amp-bridge` or `~/.config/hex-amp-bridge` |

- `config.json`: `threadID` for billing/routing and optional `model`. A null or omitted model uses Amp's default generation model. Reload the plugin after editing.
- `credentials.json`: generated bearer token. Keep it private; never commit it.
- Amp plugin: `$XDG_CONFIG_HOME/amp/plugins/hex-rewrite` or `~/.config/amp/plugins/hex-rewrite`.
- Hex files: `~/.config/hex` on every platform, including a protected `amp-bridge.private.json` copy of the token.

Show resolved paths with `bun setup.ts --print-paths`. Installed files are independent of the source checkout.

## Operation

- Keep one Amp host running with the plugin loaded. It can be idle; no active agent turn is needed. Keep the configured thread accessible.
- The bridge listens on the fixed loopback address `127.0.0.1:47823`. Only one host can use the port. No startup service is installed.
- On failure, Hex falls back to the original transcript. Windows also attempts a notification, at most once every five minutes; OS settings can suppress it. This warns on use, not at startup.
- Requests require the bearer token; browser origins are rejected. Never share either credential file. Local authentication does not protect against malicious programs running as your user.
- Maximum input: 8 KiB. One rewrite at a time, no automatic retries, 45-second bridge deadline. A timeout does not guarantee cancellation or prevent cloud charges.
- Reloading interrupts pending requests. To uninstall, remove the installed Amp plugin and reload, then remove the Hex transformation registration and bridge files.

## Tests

Offline installer and path tests:

```sh copy Copy Offline Tests
bun test setup.test.ts
```

With the plugin running:

```sh copy Copy Live Checks
bun verify.ts
```

Live checks make two billable rewrites and test authentication, validation, and the transform under Bun—not installed Hex or microphone/paste behavior.

Integration has been tested on Windows. macOS/Linux path resolution has tests; native integration and reboot recovery remain unverified.

## License

[0BSD](LICENSE): free to use, modify, and redistribute, with no attribution requirement. See the license for warranty and liability disclaimers.

And yeah, AI was used here. That probably comes as no surprise.
