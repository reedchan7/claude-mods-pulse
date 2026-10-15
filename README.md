# claude-mods-pulse

Pulse is a Claude Code mod that keeps live model metrics in the status line under the input box:

```
Pulse  TTFT 1.03s · Avg 1.21s  │  94 tok/s · Avg 112  │  Cache Hit 99.8%  │  5H 62% left · Resets 18:40  │  Weekly 76% left · Resets Sat 08:00
```

It is built on Claude Code's function-hooks API, which is in early access and may change between releases.

## What it shows

| Figure | Meaning |
| --- | --- |
| **TTFT** | Time from sending the latest request to the first chunk of its response stream, and the session average. When Claude thinks with its thinking hidden, the stream can stay silent until thinking ends, and that wait is included. |
| **tok/s** | Output speed of the latest request and the session average, weighted by tokens. `●` marks a live estimate from the visible text while a reply streams. |
| **Cache Hit** | Prompt-cache hit rate of the latest request: `cache_read / (input + cache_read + cache_creation)`, the total input as [Anthropic defines it](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching). One decimal, never rounded up to 100%. |
| **5H / Weekly** | Subscription usage left in the five-hour and weekly windows, and when each resets (local time; a weekday or date when it is not today). |

Run `/pulse` for a details pane: a card that follows the light/dark theme in the desktop app, plus the raw figures (requests measured, tokens, cache tokens, reset times).

## How it measures

- Only main-thread requests count; subagent requests are left out. A request that fails before answering adds nothing.
- `output_tokens` includes hidden thinking, so the speed window starts when generation did: at the first chunk of the response stream, or, when that chunk arrives more than twice as late as the session's median TTFT (hidden thinking that streamed nothing), at that median.
- A speed above 250 tok/s is treated as a mismeasured window: it is neither shown nor averaged.
- Figures belong to the session: `/clear` resets them, and they start over when the app restarts. The usage windows appear once an API response has reported them (subscription accounts).

The desktop app draws a plugin's status line as plain dimmed text at a fixed size, prefixed with the plugin's name; a mod cannot change any of that.

## Install

From a clone, for every Claude Code session of your user, in the terminal and the desktop app:

```bash
make install
```

This adds the clone as the `claude-mods-pulse` marketplace and installs `Pulse@claude-mods-pulse` at user scope. The marketplace is read in place, so an edit reaches a running session after `/reload-plugins`, with no reinstall. `make status` shows what is installed; `make uninstall` removes it.

From GitHub, typed at a terminal session's prompt:

```
/plugin install Pulse --marketplace reedchan7/claude-mods-pulse
```

## Develop

```bash
make check
```

Validates the manifests, runs each mod's tests and type-checks it. Type-checking needs the types the engine lays in `.claude-plugin/types` the first time it loads a mod from a watched folder, so a fresh clone runs `claude --plugin-dir mods/pulse` once.

Run a session with the mod loaded from disk, hot-reloading on save:

```bash
claude --plugin-dir mods/pulse
```

## License

[MIT](LICENSE)
