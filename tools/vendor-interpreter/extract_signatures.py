#!/usr/bin/env python3
"""Vendor Interpreter — stage 2: signature extraction.

DEV-ONLY. Reads the vendored douyin-downloader source (path = argv[1]), walks
the allowlisted modules with stdlib `ast` (never executing target code), and
prints a JSON array of signature records to stdout. The tally stage (W1.3)
filters this full dump down to the consumed surface.

Record shape:
  { "module", "qualname", "kind", "async", "decorators",
    "params": [{"name","annotation","default","kind"}],
    "vararg", "kwarg", "returns", "lineno", ("bases" for classes) }

Requires Python 3.9+ (for ast.unparse).
"""
from __future__ import annotations

import ast
import json
import os
import sys
from typing import Any, List, Optional

ALLOWLIST_DIRS = ("core", "utils", "auth")
SKIP_DIR_NAMES = {"__pycache__", "tests", ".git"}


def _unparse(node: Optional[ast.AST]) -> Optional[str]:
    if node is None:
        return None
    try:
        return ast.unparse(node).strip()
    except Exception:
        return None


def _decorator_name(node: ast.AST) -> str:
    if isinstance(node, ast.Call):
        node = node.func
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Name):
        return node.id
    return _unparse(node) or "<decorator>"


def _params(fn: Any) -> dict:
    a = fn.args
    out: List[dict] = []
    posonly = list(getattr(a, "posonlyargs", []))
    pos_all = posonly + list(a.args)
    defaults = list(a.defaults)
    default_offset = len(pos_all) - len(defaults)
    for i, arg in enumerate(pos_all):
        default = _unparse(defaults[i - default_offset]) if i >= default_offset else None
        kind = "positional_only" if i < len(posonly) else "positional_or_keyword"
        out.append({
            "name": arg.arg,
            "annotation": _unparse(arg.annotation),
            "default": default,
            "kind": kind,
        })
    for arg, kd in zip(a.kwonlyargs, a.kw_defaults):
        out.append({
            "name": arg.arg,
            "annotation": _unparse(arg.annotation),
            "default": _unparse(kd) if kd is not None else None,
            "kind": "keyword_only",
        })
    return {
        "params": out,
        "vararg": a.vararg.arg if a.vararg else None,
        "kwarg": a.kwarg.arg if a.kwarg else None,
    }


def _fn_kind(decorators: List[str], in_class: bool) -> str:
    if "staticmethod" in decorators:
        return "staticmethod"
    if "classmethod" in decorators:
        return "classmethod"
    if "property" in decorators:
        return "property"
    return "method" if in_class else "function"


def _emit_function(records, module, qualname, fn, in_class):
    decorators = [_decorator_name(d) for d in fn.decorator_list]
    p = _params(fn)
    records.append({
        "module": module,
        "qualname": qualname,
        "kind": _fn_kind(decorators, in_class),
        "async": isinstance(fn, ast.AsyncFunctionDef),
        "decorators": decorators,
        "params": p["params"],
        "vararg": p["vararg"],
        "kwarg": p["kwarg"],
        "returns": _unparse(fn.returns),
        "lineno": fn.lineno,
    })


def _walk_module(records, module, tree):
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            _emit_function(records, module, node.name, node, in_class=False)
        elif isinstance(node, ast.ClassDef):
            bases = [b for b in (_unparse(x) for x in node.bases) if b]
            records.append({
                "module": module,
                "qualname": node.name,
                "kind": "class",
                "async": False,
                "decorators": [_decorator_name(d) for d in node.decorator_list],
                "bases": bases,
                "lineno": node.lineno,
            })
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    _emit_function(records, module, f"{node.name}.{sub.name}", sub, in_class=True)


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: extract_signatures.py <vendor-root>\n")
        return 2
    root = sys.argv[1]
    if not os.path.isdir(root):
        sys.stderr.write(f"vendor root not found: {root}\n")
        return 1

    records: List[dict[str, Any]] = []
    for sub in ALLOWLIST_DIRS:
        base = os.path.join(root, sub)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]
            for fname in sorted(filenames):
                if not fname.endswith(".py"):
                    continue
                fpath = os.path.join(dirpath, fname)
                rel = os.path.relpath(fpath, root).replace(os.sep, "/")
                try:
                    with open(fpath, "r", encoding="utf-8") as fh:
                        tree = ast.parse(fh.read(), filename=rel)
                except SyntaxError as exc:
                    sys.stderr.write(f"syntax error in {rel}: {exc}\n")
                    return 1
                _walk_module(records, rel, tree)

    records.sort(key=lambda r: (r["module"], r["qualname"]))
    json.dump(records, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
