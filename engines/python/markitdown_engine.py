import sys
import json
import base64
import tempfile
import os
from markitdown import MarkItDown

def main():
    temp_path = None
    try:
        # Read base64-encoded PDF from stdin
        payload = sys.stdin.read()
        data = json.loads(payload)

        pdf_bytes = base64.b64decode(data["pdf"])

        # Write PDF bytes to a temporary file (MarkItDown expects a file path)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            temp_path = tmp.name

        md = MarkItDown()
        result = md.convert(temp_path)

        output = {
            "success": True,
            "engine": "markitdown",
            "output": result.text_content if result.text_content else ""
        }

        # Only output JSON to stdout - nothing else
        print(json.dumps(output))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({
            "success": False,
            "engine": "markitdown",
            "error": str(e)
        }))
        sys.exit(1)

    finally:
        # Clean up temporary file
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)

if __name__ == "__main__":
    main()