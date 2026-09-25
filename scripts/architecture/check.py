#!/usr/bin/env python3
"""
Architecture policy checker for Quill.

Inspired by ZCode's architecture policy enforcement with automated checks
for file size limits, import cycle detection, and module boundary rules.

Usage:
    python scripts/architecture/check.py
    python scripts/architecture/check.py --policy scripts/architecture/policy.yaml
    python scripts/architecture/check.py --fix  # Auto-fix where possible

Exit codes:
    0 - All checks passed
    1 - One or more checks failed
"""

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Any

import yaml


# ---------------------------------------------------------------------------
# Policy loading
# ---------------------------------------------------------------------------

def load_policy(policy_path: str) -> dict[str, Any]:
    """Load architecture policy from YAML file."""
    with open(policy_path, "r") as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Checkers
# ---------------------------------------------------------------------------

class CheckResult:
    """Result of a single architecture check."""

    def __init__(self, check_name: str, passed: bool, message: str, file: str = ""):
        self.check_name = check_name
        self.passed = passed
        self.message = message
        self.file = file

    def __str__(self) -> str:
        status = "PASS" if self.passed else "FAIL"
        location = f" [{self.file}]" if self.file else ""
        return f"[{status}] {self.check_name}{location}: {self.message}"


def check_file_sizes(files: list[Path], policy: dict[str, Any]) -> list[CheckResult]:
    """Check that files don't exceed the maximum line count."""
    results = []
    max_lines = policy.get("max_lines_per_file", 600)
    exemptions = {
        item["path"]: item.get("max_lines", max_lines)
        for item in policy.get("exemptions", [])
    }

    for file_path in files:
        rel_path = str(file_path)
        limit = exemptions.get(rel_path, max_lines)

        try:
            lines = len(file_path.read_text(encoding="utf-8").splitlines())
        except (OSError, UnicodeDecodeError):
            continue

        if lines > limit:
            results.append(CheckResult(
                "file_size",
                False,
                f"File has {lines} lines (limit: {limit})",
                rel_path,
            ))
        else:
            results.append(CheckResult(
                "file_size",
                True,
                f"File has {lines} lines (limit: {limit})",
                rel_path,
            ))

    return results


def check_import_cycles(files: list[Path], _policy: dict[str, Any]) -> list[CheckResult]:
    """Check for circular imports between modules."""
    results = []
    # Build import graph
    import_graph: dict[str, list[str]] = {}

    for file_path in files:
        rel_path = str(file_path)
        module_dir = str(file_path.parent)

        try:
            content = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        # Find relative imports
        imports = re.findall(r'from ["\'](\.\.?/[^"\']+)["\']', content)
        import_graph[rel_path] = []

        for imp in imports:
            # Resolve relative import to absolute path
            resolved = (Path(module_dir) / imp).resolve()
            # Try to find the actual file
            for ext in [".ts", "/index.ts"]:
                candidate = Path(str(resolved) + ext)
                if candidate.exists():
                    import_graph[rel_path].append(str(candidate))
                    break

    # Detect cycles using DFS
    visited: set[str] = set()
    rec_stack: set[str] = set()
    cycles: list[list[str]] = []

    def dfs(node: str, path: list[str]) -> None:
        visited.add(node)
        rec_stack.add(node)

        for neighbor in import_graph.get(node, []):
            if neighbor not in visited:
                dfs(neighbor, path + [neighbor])
            elif neighbor in rec_stack:
                # Found a cycle
                cycle_start = path.index(neighbor) if neighbor in path else -1
                if cycle_start >= 0:
                    cycles.append(path[cycle_start:] + [neighbor])

        rec_stack.discard(node)

    for node in import_graph:
        if node not in visited:
            dfs(node, [node])

    if cycles:
        for cycle in cycles:
            cycle_str = " -> ".join(cycle)
            results.append(CheckResult(
                "import_cycles",
                False,
                f"Circular import detected: {cycle_str}",
            ))
    else:
        results.append(CheckResult(
            "import_cycles",
            True,
            "No circular imports detected",
        ))

    return results


def check_module_boundaries(files: list[Path], policy: dict[str, Any]) -> list[CheckResult]:
    """Check that module boundary rules are respected."""
    results = []
    boundaries = policy.get("module_boundaries", [])

    for boundary in boundaries:
        from_prefix = boundary["from"]
        to_prefix = boundary["to"]
        rule = boundary["rule"]

        for file_path in files:
            rel_path = str(file_path)

            # Check if file is in the "from" module
            if not rel_path.replace("/", ".").startswith(from_prefix.replace("quill.", "")):
                continue

            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Check for imports from the "to" module
            to_module_path = to_prefix.replace(".", "/")
            pattern = rf'(?:from|import)\s+["\'].*{re.escape(to_module_path)}'
            if re.search(pattern, content):
                results.append(CheckResult(
                    "module_boundary",
                    False,
                    f"Violates rule: {rule}",
                    rel_path,
                ))

    if not results:
        results.append(CheckResult(
            "module_boundary",
            True,
            "All module boundary rules respected",
        ))

    return results


def check_public_api_limits(files: list[Path], policy: dict[str, Any]) -> list[CheckResult]:
    """Check that modules don't exceed the public API limit."""
    results = []
    max_public = policy.get("max_public_per_module", 15)

    for file_path in files:
        # Only check index.ts files (public API surface)
        if file_path.name != "index.ts":
            continue

        try:
            content = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        # Count export statements
        export_count = len(re.findall(r"^export\s+", content, re.MULTILINE))

        if export_count > max_public:
            results.append(CheckResult(
                "public_api_limit",
                False,
                f"Module exports {export_count} items (limit: {max_public})",
                str(file_path),
            ))
        else:
            results.append(CheckResult(
                "public_api_limit",
                True,
                f"Module exports {export_count} items (limit: {max_public})",
                str(file_path),
            ))

    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def get_files_to_check(policy: dict[str, Any], root_dir: str) -> list[Path]:
    """Get list of files to check based on policy include/exclude patterns."""
    include_patterns = policy.get("include_patterns", ["**/*.ts"])
    exclude_patterns = policy.get("exclude_patterns", [])

    files: set[Path] = set()
    root = Path(root_dir)

    for pattern in include_patterns:
        for f in root.glob(pattern):
            if f.is_file():
                files.add(f.resolve())

    # Apply exclusions — filter out files whose path matches any exclude pattern
    # Also exclude files in node_modules, dist, .git directories by path inspection
    def should_exclude(file_path: Path) -> bool:
        path_str = str(file_path)
        # Always exclude dependency/build directories
        for part in file_path.parts:
            if part in ("node_modules", "dist", ".git", ".next", ".quill-dist"):
                return True
        # Check against exclude patterns
        for pattern in exclude_patterns:
            if file_path.match(pattern):
                return True
        return False

    return sorted(f for f in files if not should_exclude(f))


def main() -> int:
    parser = argparse.ArgumentParser(description="Quill architecture policy checker")
    parser.add_argument("--policy", default="scripts/architecture/policy.yaml",
                        help="Path to policy YAML file")
    parser.add_argument("--root", default=".",
                        help="Root directory to check")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Show all results (including passes)")
    args = parser.parse_args()

    # Load policy
    policy_data = load_policy(args.policy)
    policy = policy_data.get("policy", policy_data)

    # Get files
    files = get_files_to_check(policy, args.root)

    if not files:
        print("No files to check.")
        return 0

    print(f"Checking {len(files)} files against architecture policy...\n")

    # Run checks
    all_results: list[CheckResult] = []
    all_results.extend(check_file_sizes(files, policy))
    all_results.extend(check_import_cycles(files, policy))
    all_results.extend(check_module_boundaries(files, policy))
    all_results.extend(check_public_api_limits(files, policy))

    # Print results
    failures = [r for r in all_results if not r.passed]
    passes = [r for r in all_results if r.passed]

    if failures:
        print(f"FAILURES ({len(failures)}):")
        for result in failures:
            print(f"  {result}")
        print()

    if args.verbose:
        print(f"PASSES ({len(passes)}):")
        for result in passes:
            print(f"  {result}")
        print()

    # Summary
    total = len(all_results)
    passed = len(passes)
    failed = len(failures)

    print(f"Summary: {passed}/{total} checks passed, {failed} failed")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
