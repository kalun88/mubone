-- mubone-mediakey-suppressor.lua
--
-- Hammerspoon snippet: suppresses macOS volume-key handling globally so the
-- ring's volume events (fired on hold gestures) don't change system volume
-- while you're playing. Brightness, play/pause, next/prev still work.
--
-- Max [hi] still sees the volume_increment HID reports — they're read at a
-- lower layer than this eventtap operates on. Use them in Max as
-- hold-gesture indicators.
--
-- Side effect: your laptop's built-in volume keys also stop working.
-- Manage volume via your audio interface, Audio MIDI Setup, or temporarily
-- disable this script when you need to adjust system volume.
--
-- Install:
--   1. Install Hammerspoon: https://www.hammerspoon.org (free, signed)
--   2. Launch Hammerspoon. Grant Accessibility permission when prompted.
--   3. Open ~/.hammerspoon/init.lua (create it if missing) and paste this
--      file's contents in. Or `ln -s` this file from ~/.hammerspoon/init.lua
--      if you want to keep it in the repo.
--   4. Click the Hammerspoon menu-bar icon → Reload Config.
--   5. Test: press Volume Up. The volume HUD should NOT appear and system
--      volume should not change. Open Console.app → search "mubone" to
--      confirm the suppressor announced itself on load.
--
-- Toggle off temporarily: menu-bar icon → Console → run `volumeKeySuppressor:stop()`.
-- Or just quit Hammerspoon — keys go back to normal immediately.

volumeKeySuppressor = hs.eventtap.new(
    { hs.eventtap.event.types.systemDefined },
    function(event)
        local data = event:systemKey()
        if data and data.key then
            if data.key == "SOUND_UP" or data.key == "SOUND_DOWN" or data.key == "MUTE" then
                return true   -- consume; macOS never sees it
            end
        end
        return false          -- everything else passes through
    end
)
volumeKeySuppressor:start()

print("[mubone] volume-key suppressor active — SOUND_UP / SOUND_DOWN / MUTE blocked at CGEvent layer")
