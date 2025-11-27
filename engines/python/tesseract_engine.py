import sys
import json
import base64
import tempfile
import os
import pytesseract
from pdf2image import convert_from_path

def main():
    temp_path = None
    try:
        # Read base64-encoded PDF from stdin
        payload = sys.stdin.read()
        data = json.loads(payload)

        pdf_bytes = base64.b64decode(data["pdf"])

        # Write PDF bytes to a temporary file
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            temp_path = tmp.name

        # Convert PDF to images (one per page)
        images = convert_from_path(temp_path)

        extracted = []

        for img in images:
            text = pytesseract.image_to_string(img)
            extracted.append(text)

        output_text = "\n\n".join(extracted)

        output = {
            "success": True,
            "engine": "tesseract",
            "output": output_text
        }

        print(json.dumps(output))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({
            "success": False,
            "engine": "tesseract",
            "error": str(e)
        }))
        sys.exit(1)

    finally:
        # Clean up temporary file
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)

if __name__ == "__main__":
    main()