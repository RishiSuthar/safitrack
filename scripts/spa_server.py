#!/usr/bin/env python3
"""Local static server with SPA fallback for CRM routes.

Usage:
  python3 scripts/spa_server.py
  python3 scripts/spa_server.py 8080
"""

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
import sys


class CRMRouterHandler(SimpleHTTPRequestHandler):
    def _maybe_rewrite_to_crm_index(self):
        parsed = urlsplit(self.path)
        request_path = parsed.path

        if request_path == "/crm" or request_path == "/crm/":
            self.path = "/crm/index.html"
            return

        if not request_path.startswith("/crm/"):
            return

        candidate = Path(self.translate_path(request_path))
        looks_like_file = "." in Path(request_path).name

        if not candidate.exists() and not looks_like_file:
            self.path = "/crm/index.html"

    def do_GET(self):
        self._maybe_rewrite_to_crm_index()
        return super().do_GET()

    def do_HEAD(self):
        self._maybe_rewrite_to_crm_index()
        return super().do_HEAD()


def main():
    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])

    server = ThreadingHTTPServer(("", port), CRMRouterHandler)
    print(f"Serving on http://localhost:{port}")
    print("CRM SPA fallback active for /crm/* routes")
    server.serve_forever()


if __name__ == "__main__":
    main()
