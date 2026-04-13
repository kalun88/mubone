import ssl
from http.server import HTTPServer, SimpleHTTPRequestHandler

class COOPCOEPHandler(SimpleHTTPRequestHandler):
    """Adds cross-origin isolation headers required for SharedArrayBuffer.
    Without these, browsers block SAB construction entirely."""
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        # Kill all caching in dev mode — every refresh loads fresh files
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

httpd = HTTPServer(('localhost', 4443), COOPCOEPHandler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('localhost.pem', 'localhost-key.pem')
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
print("Serving at https://localhost:4443 (cross-origin isolated)")
httpd.serve_forever()
