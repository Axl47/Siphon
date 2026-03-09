FROM ghcr.io/imputnet/yt-session-generator:webserver

# The upstream webserver image launches Chromium as root. Patch nodriver startup
# to disable the sandbox so token extraction works in containerized VPS deployments.
RUN python - <<'PY'
from pathlib import Path
import re

path = Path("/app/potoken_generator/extractor.py")
text = path.read_text()

pattern = re.compile(
    r"(browser = await nodriver\.start\(headless=False,\n)"
    r"(\s+)(?!no_sandbox=True,)(browser_executable_path=self\.browser_path,\n)"
    r"(\s+)(user_data_dir=self\.profile_path\))"
)

updated, count = pattern.subn(
    r"\1\2no_sandbox=True,\n\2\3\4\5",
    text,
    count=1,
)

if count != 1:
    raise SystemExit("expected nodriver.start block not found or already patched in extractor.py")

path.write_text(updated)
PY
