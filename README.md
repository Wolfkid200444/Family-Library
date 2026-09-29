# Family Library for Millennium

Creates a Steam collection for each other member of your Steam Family and adds owner avatars and names beside **From your Steam Family library** on game pages.

Collections include games shared by that person, including games you also own. A game owned by several members appears in each relevant collection. Games excluded from Family Sharing are not included merely because another member owns them.

## Use

Open **Steam → Millennium → Plugins → Family Library → Configure**.

- **Refresh collections** updates the managed collections immediately.
- **Update collections automatically** checks the library each minute and refreshes ownership at least every five minutes.
- **Show game owners** controls the inline avatar and name display. Click an owner to open their Steam profile.

Collections start with `Family · Name`. You can rename them. Their contents are managed by the plugin, so manual additions will be replaced on the next sync. Existing collections are not adopted or overwritten by name. Disabling or removing the plugin leaves its collections in Steam.

The owner badge is added to the ordinary Family Library label. Steam retains its existing preferred-copy display when copies have different DLC.

## Install on Linux

Requires Millennium 3.x with `.star` plugin support. Developed against Millennium 3.5.0.

1. Run `npm ci` and `npm run build` in this repository.
2. Close Steam.
3. Copy `build/family-library.star` to `${XDG_DATA_HOME:-$HOME/.local/share}/millennium/plugins/local.steam-family-library.star`.
4. Start Steam and enable **Family Library** in Millennium's Plugins settings.

To update, close Steam and replace the same file. Do not install a second copy under another name.

## Build

Requires Node.js/npm. Tests use Bun; the patch compatibility check uses Python 3 and Node.js.

```sh
npm ci
npm run typecheck
npm test
python scripts/verify_hook.py
npm run build
node_modules/.bin/starlight verify build/family-library.star
```

The output is `build/family-library.star`. `verify_hook.py` reads the installed Steam JavaScript and checks that the badge patch matches one component and preserves valid JavaScript. It does not modify Steam files. Pass a different Steam `steamui` directory as its first argument if necessary.

## Implementation notes

The plugin uses Steam's local family membership, app overview, available lender and collection interfaces. It does not require a Steam Web API key. Owner requests run four at a time and are cached for five minutes. Personally owned games with a single copy are skipped, avoiding thousands of unnecessary requests in large free-to-play libraries.

Steam's internal interfaces and minified JavaScript can change. The collection adapter validates their shape and reports failures in Configure. The badge patch is narrow; an incompatible Steam update may require an updated patch. The plugin does not remove licenses or hide free-to-play games, and makes no guarantee about overall Steam performance.

Sources: [Millennium](https://github.com/SteamClientHomebrew/Millennium) and the locally installed Steam client.
