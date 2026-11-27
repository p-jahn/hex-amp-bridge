import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

// Amp and Hex have their own documented discovery locations. Only the bridge
// uses the operating system's native application configuration directory.
export function userPaths(
  platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
) {
  const path = platform === 'win32' ? win32 : posix
  const xdg = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME : undefined
  const configHome = platform === 'win32'
    ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : xdg || path.join(home, '.config')
  return {
    bridge: path.join(configHome, 'hex-amp-bridge'),
    ampPlugins: path.join(xdg || path.join(home, '.config'), 'amp', 'plugins'),
    hex: path.join(home, '.config', 'hex'),
  }
}
