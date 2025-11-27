import sys
import json
import base64
import tempfile
import shutil
import subprocess
import os
from pathlib import Path

def find_markdown_files(out_dir: Path):
    md_files = list(out_dir.rglob("*.md"))
    # prefer top-level markdown if present (common)
    if not md_files:
        return []
    # sort to deterministic order: smallest path string first
    md_files.sort(key=lambda p: str(p))
    return md_files

def main():
    try:
        payload = sys.stdin.read()
        if not payload:
            raise ValueError("No input payload provided on stdin")

        data = json.loads(payload)
        if "pdf" not in data:
            raise ValueError("Payload must include base64 'pdf' field")

        pdf_bytes = base64.b64decode(data["pdf"])

        # create temp dir for input and output
        tmp_dir = Path(tempfile.mkdtemp(prefix="mineru_run_"))
        try:
            input_pdf = tmp_dir / "input.pdf"
            out_dir = tmp_dir / "out"
            out_dir.mkdir(parents=True, exist_ok=True)

            # write pdf
            with open(input_pdf, "wb") as f:
                f.write(pdf_bytes)

            # Build the mineru CLI command.
            # The simplest usage is: mineru -p <input_path> -o <output_path>
            # MinerU will write one or more markdown/json files in out_dir.
            cmd = ["mineru", "-p", str(input_pdf), "-o", str(out_dir)]

            # Allow caller to override additional args by passing cli_args in payload
            # (e.g. {"pdf": "...", "cli_args": ["--method","ocr"]})
            if isinstance(data.get("cli_args"), list):
                cmd.extend(data["cli_args"])

            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=data.get("timeout_seconds", 240)
            )

            stdout = proc.stdout
            stderr = proc.stderr
            rc = proc.returncode

            if rc != 0:
                # return stderr for debugging
                out_json = {
                    "success": False,
                    "engine": "mineru",
                    "error": "mineru CLI failed",
                    "returncode": rc,
                    "stdout": stdout,
                    "stderr": stderr
                }
                print(json.dumps(out_json))
                sys.exit(1)

            # find markdown files produced
            md_files = find_markdown_files(out_dir)
            files_read = []
            combined_md_parts = []

            for p in md_files:
                try:
                    text = p.read_text(encoding="utf-8")
                except Exception:
                    # fallback binary read -> decode
                    text = p.read_bytes().decode("utf-8", errors="replace")
                files_read.append({
                    "path": str(p.relative_to(out_dir)),
                    "full_path": str(p),
                    "size": p.stat().st_size
                })
                combined_md_parts.append(text)

            combined_md = "\n\n---\n\n".join(combined_md_parts)

            result = {
                "success": True,
                "engine": "mineru",
                "output": combined_md,
                "files": files_read,
                "mineru_stdout": stdout,
                "mineru_stderr": stderr
            }

            print(json.dumps(result))
            sys.exit(0)

        finally:
            # cleanup temp dir
            try:
                shutil.rmtree(tmp_dir)
            except Exception:
                pass

    except Exception as e:
        print(json.dumps({
            "success": False,
            "engine": "mineru",
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()