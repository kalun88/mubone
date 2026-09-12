#!/usr/bin/env python3
"""Serve the app over https, cross-origin isolated.

    ./serve.py                  # https://localhost:4443
    ./serve.py --port 8443      # somewhere else
    ./serve.py --host 0.0.0.0   # reachable from a phone on the same network

https is not optional here: the microphone, SharedArrayBuffer and Web Serial
all require a secure context, and so does reaching an instrument over ws://.
"""
import argparse
import errno
import os
import ssl
import sys
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


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--port', '-p', type=int, default=4443)
    parser.add_argument('--host', default='localhost',
                        help='0.0.0.0 to reach the app from another device')
    parser.add_argument('--cert', default='localhost.pem')
    parser.add_argument('--key', default='localhost-key.pem')
    args = parser.parse_args()

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    try:
        ctx.load_cert_chain(args.cert, args.key)
    except FileNotFoundError:
        # The certificates are machine-specific and gitignored, so a fresh
        # clone always lands here. Say how to fix it rather than tracebacking.
        missing = ', '.join(p for p in (args.cert, args.key) if not os.path.exists(p))
        sys.exit(f'no TLS certificate ({missing}). Generate one with:\n'
                 f'    mkcert -cert-file {args.cert} -key-file {args.key} localhost 127.0.0.1 ::1\n'
                 f'or, if mkcert is not installed:\n'
                 f'    nix run nixpkgs#mkcert -- -cert-file {args.cert} '
                 f'-key-file {args.key} localhost 127.0.0.1 ::1')

    try:
        httpd = HTTPServer((args.host, args.port), COOPCOEPHandler)
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        sys.exit(f'port {args.port} is already in use — something else is serving there.\n'
                 f'Pick another with --port, or find what holds it:\n'
                 f'    ss -ltnp | grep {args.port}')

    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    # flush: the request log goes to stderr, so without this the startup line
    # is the one thing you never see when the output is redirected to a file.
    print(f'Serving at https://{args.host}:{args.port} (cross-origin isolated)', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print()


if __name__ == '__main__':
    main()
