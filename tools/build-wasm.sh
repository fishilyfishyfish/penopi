#!/usr/bin/env bash
# Builds the Rust engines to WebAssembly: amazons/pkg/ and backgammon/pkg/ (not committed, CI builds them).
# Needs: rustup target wasm32-unknown-unknown, wasm-bindgen-cli 0.2.129 (same as the engines' Cargo.lock).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
build() { # game folder, crate file name
  (cd "$root/$1/engine" && cargo build --release --target wasm32-unknown-unknown --lib --locked)
  wasm-bindgen --target web --no-typescript --out-dir "$root/$1/pkg" \
    "$root/$1/engine/target/wasm32-unknown-unknown/release/$2.wasm"
}
build amazons amazons_engine
build backgammon palamedes
ls -l "$root/amazons/pkg" "$root/backgammon/pkg"
