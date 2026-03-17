import ssl
from http.server import HTTPServer, SimpleHTTPRequestHandler

httpd = HTTPServer(('localhost', 4443), SimpleHTTPRequestHandler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('localhost.pem', 'localhost-key.pem')
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
print("Serving at https://localhost:4443")
httpd.serve_forever()
