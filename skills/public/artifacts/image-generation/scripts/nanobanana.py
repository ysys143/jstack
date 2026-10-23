#!/usr/bin/env python3
"""nanobanana - Gemini REST API caller for text/image understanding and generation."""

import argparse
import base64
import os
import sys
from io import BytesIO
from pathlib import Path

import requests
from dotenv import load_dotenv
from PIL import Image

# Load API key: ~/.claude/.env.nanobanana first, then local .env (local overrides)
load_dotenv(Path.home() / ".claude" / ".env.nanobanana")
load_dotenv()

MODEL = "gemini-nano-banana-2.1"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"


def get_mime_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
    }.get(ext, "image/jpeg")


def encode_image(image_path: str, resolution: tuple[int, int] | None = None) -> tuple[str, str]:
    img = Image.open(image_path)

    if resolution:
        img = img.resize(resolution, Image.Resampling.LANCZOS)

    mime_type = get_mime_type(image_path)
    fmt = "PNG" if mime_type == "image/png" else "JPEG"

    buf = BytesIO()
    img.save(buf, format=fmt)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return b64, mime_type


def call_gemini(
    text: str,
    image_path: str | None = None,
    resolution: tuple[int, int] | None = None,
    generate: bool = False,
    aspect_ratio: str | None = None,
    image_size: str | None = None,
    output: str | None = None,
) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        sys.exit("Error: GEMINI_API_KEY not found. Set it in ~/.claude/.env.nanobanana")

    parts = []

    if text:
        parts.append({"text": text})

    if image_path:
        b64_data, mime_type = encode_image(image_path, resolution)
        parts.append({
            "inline_data": {
                "mime_type": mime_type,
                "data": b64_data,
            }
        })

    payload: dict = {"contents": [{"parts": parts}]}

    if generate:
        gen_config: dict = {"responseModalities": ["TEXT", "IMAGE"]}
        image_config: dict = {}
        if aspect_ratio:
            image_config["aspectRatio"] = aspect_ratio
        if image_size:
            image_config["imageSize"] = image_size
        if image_config:
            gen_config["imageConfig"] = image_config
        payload["generationConfig"] = gen_config

    resp = requests.post(
        API_URL,
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
        },
        json=payload,
    )

    if resp.status_code != 200:
        sys.exit(f"API error {resp.status_code}: {resp.text}")

    data = resp.json()

    if "candidates" not in data:
        sys.exit(f"No candidates in response: {data}")

    candidate = data["candidates"][0]
    if "content" not in candidate:
        sys.exit(f"No content in candidate: {candidate}")

    result_parts = candidate["content"]["parts"]

    texts = []
    for part in result_parts:
        if "text" in part:
            texts.append(part["text"])
        elif "inline_data" in part or "inlineData" in part:
            inline = part.get("inlineData") or part["inline_data"]
            img_data = base64.b64decode(inline["data"])
            out_path = output or "output.png"
            Path(out_path).write_bytes(img_data)
            texts.append(f"Image saved to {out_path}")

    return "\n".join(texts)


def parse_resolution(value: str) -> tuple[int, int]:
    try:
        w, h = value.lower().split("x")
        return int(w), int(h)
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid resolution: '{value}'. Use WxH format (e.g. 512x512)")


def main():
    parser = argparse.ArgumentParser(description="Nano Banana API - text/image understanding & generation")
    parser.add_argument("text", help="Text prompt to send")
    parser.add_argument("-i", "--image", help="Path to input image file")
    parser.add_argument("-r", "--resolution", type=parse_resolution, help="Resize input image to WxH (e.g. 512x512)")
    parser.add_argument("-g", "--generate", action="store_true", help="Enable image generation mode")
    parser.add_argument("-a", "--aspect-ratio", choices=["1:1", "16:9", "9:16", "21:9", "4:3", "3:4"], help="Output aspect ratio")
    parser.add_argument("-s", "--size", choices=["1K", "2K", "4K"], help="Output image size")
    parser.add_argument("-o", "--output", help="Output file path (default: output.png)")

    args = parser.parse_args()

    if args.resolution and not args.image:
        parser.error("--resolution requires --image")

    result = call_gemini(
        args.text,
        args.image,
        args.resolution,
        generate=args.generate,
        aspect_ratio=args.aspect_ratio,
        image_size=args.size,
        output=args.output,
    )
    print(result)


if __name__ == "__main__":
    main()
