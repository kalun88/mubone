{
  description = "mubone — a spatial granular synthesizer for live acoustic instrumentalists";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system:
        f nixpkgs.legacyPackages.${system});
    in {
      devShells = forEachSystem (pkgs:
        let
          inherit (pkgs) lib stdenv;
        in {
          default = pkgs.mkShell {
            # The app itself is vanilla HTML/JS with no build step. Everything
            # here exists for the two places that touch the machine underneath:
            # the native audio addon, and the browsers we drive during QA.
            packages = with pkgs; [
              nodejs_24
              python3          # node-gyp shells out to it
              pkg-config
              gnumake
              mkcert           # serve.py wants a localhost certificate pair
            ]
            # audify compiles RtAudio against whichever backends it finds.
            # On macOS that is CoreAudio, which needs nothing from us.
            ++ lib.optionals stdenv.hostPlatform.isLinux (with pkgs; [
              alsa-lib
              libjack2
              libpulseaudio
              chromium         # the QA harness drives a real browser
            ]);

            # Electron deliberately does NOT come from nixpkgs. Every version
            # packaged there is marked EOL, and this app is heading for a signed
            # release — so npm owns that dependency, where the current release
            # lives and where electron-builder expects to find it. The binary it
            # unpacks is also a real executable rather than a distro wrapper
            # script, which is what lets Playwright drive the app.
            shellHook = ''
              export CHROMIUM_BIN=${lib.optionalString stdenv.hostPlatform.isLinux "${pkgs.chromium}/bin/chromium"}
              export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

              echo "mubone dev shell — node $(node --version)"
              if [ ! -d node_modules/electron/dist ]; then
                echo "  first run here: npm install && npm run rebuild"
              fi
            '';
          };
        });
    };
}
