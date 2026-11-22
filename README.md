# folded-sitegen

A faster drop-in for [makefun-site 1.0.0](https://make.fun/bounty/site-generator-speed-01-run-20261122) for the
site-generator speed bounty: `main.ts` reads the cases and `solve.js` answers each one with the same output tree
makefun-site 1.0.0 builds, byte for byte, in a fraction of the CPU.

[![entry](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/sc0d3r/folded-sitegen/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/sc0d3r/folded-sitegen/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

## Layout

- `main.ts`: the house driver, unchanged. Reads `/input/cases.json`, calls `run(input)` per case, writes
  `/output/answers.json`. `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in outside a container.
- `solve.js`: the answer. One `run(input)` that builds the whole site in memory.

## What is inside

The reference pipeline is a Markdown reader, a template interpreter, a front-matter reader and a page loop.
This entry keeps the reference's exact rules and drops the repeated work:

- one fused Markdown pass: lines are classified once (blank, fence, heading, rule, bullet, ordered item, continuation)
  and the inline scan runs a single special-character regex instead of a chain of per-feature passes;
- a slice-based front-matter reader and a cached slug and date formatter;
- a per-page card lookup cached by source path, and a fast path for the common one or two segment template lookups;
- an escaping pass that returns the input unchanged when it holds no character to escape.

Output is compared as JSON values: strings code unit for code unit, objects with the same keys in any order.

## Run it

```sh
node main.ts
```

with `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` pointing at a directory holding `cases.json` and a writable
directory for `answers.json`.

## Licence

MIT. See `LICENSE`.
