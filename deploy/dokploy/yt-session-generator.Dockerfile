FROM ghcr.io/imputnet/yt-session-generator:webserver

# The upstream webserver image launches Chromium as root. Patch nodriver startup
# to disable the sandbox so token extraction works in containerized VPS deployments.
RUN python - <<'PY'
from pathlib import Path

path = Path("/app/potoken_generator/extractor.py")
text = path.read_text()
old = """            browser = await nodriver.start(headless=False,
                browser_executable_path=self.browser_path,
                user_data_dir=self.profile_path)"""
new = """            browser = await nodriver.start(headless=False,
                no_sandbox=True,
                browser_executable_path=self.browser_path,
                user_data_dir=self.profile_path)"""

if old not in text:
    raise SystemExit("expected nodriver.start block not found in extractor.py")

path.write_text(text.replace(old, new, 1))
PY
