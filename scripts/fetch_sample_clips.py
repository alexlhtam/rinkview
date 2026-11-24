"""Download authorized 4K calibration excerpts into the ignored sample directory."""

import argparse
from pathlib import Path
import shutil
import subprocess

VIDEO_IDS = ("LIDsyAwBd_o", "OC6jzS1GYe4", "F1Vrobt1uj0")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookies-from-browser", metavar="BROWSER[:PROFILE]",
                        help="pass a local browser profile to yt-dlp, only if needed")
    args = parser.parse_args()
    for executable in ("yt-dlp", "ffmpeg", "deno"):
        if not shutil.which(executable):
            parser.exit(2, f"{executable} must be on PATH\n")

    samples = Path(__file__).resolve().parents[1] / "data" / "samples"
    command = [
        "yt-dlp", "--ignore-config", "--no-playlist", "--no-overwrites",
        "--js-runtimes", "deno", "--remote-components", "ejs:github",
        "--download-sections", "*00:10:00-00:13:00",
        "-f", "bv[width=3840][height=2160][ext=webm]/bv[width=3840][height=2160]",
        "-o", str(samples / "%(id)s.%(ext)s"),
    ]
    if args.cookies_from_browser:
        command.extend(("--cookies-from-browser", args.cookies_from_browser))
    result = subprocess.run([*command, *[f"https://www.youtube.com/watch?v={vid}" for vid in VIDEO_IDS]])
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
