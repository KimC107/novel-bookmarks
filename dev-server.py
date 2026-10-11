"""本機開發伺服器：所有回應都帶 no-store，確保重新整理一定拿到最新檔案
用法：python3 dev-server.py  → 開 http://localhost:8765"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 禁止瀏覽器快取，開發時改了就看得到
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8765), NoCacheHandler).serve_forever()
