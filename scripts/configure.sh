#!/usr/bin/env bash
# Create local configuration files from their tracked templates.
set -euo pipefail

REPO_ROOT="$(builtin cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd -P)"
cd "$REPO_ROOT"

for existing in config.yaml config.yml configure.yml; do
    if [ -e "$existing" ]; then
        echo "Error: configuration file already exists (config.yaml/config.yml/configure.yml). Aborting."
        exit 1
    fi
done

copy_template() {
    local source="$1" target="$2"
    if [ ! -f "$source" ]; then
        echo "Error: missing template file: $source" >&2
        exit 1
    fi
    mkdir -p "$(dirname "$target")"
    cp "$source" "$target"
}

copy_template config.example.yaml config.yaml
copy_template .env.example .env
copy_template frontend/.env.example frontend/.env
echo "✓ Configuration files generated"
